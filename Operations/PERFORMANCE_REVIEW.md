# PriceBack — Database & Backend Performance Review

**Date:** 2026-06-03
**Reviewed against:** Neon Postgres 18, project `Priceback` (`dawn-meadow-95806361`), **Preview** branch `br-steep-breeze-aqeg0i38` / database `priceback_db`
**Backend version:** 2.7.0 · **App version:** 2.6.0
**Scope:** every server-side database write/read path (`backend/repos/*`, `backend/db/*`, the receipt + crowdsource + webhook routes in `backend/server.js`) and the mobile→backend sync layer (`src/services/*`).

> ℹ️ The Preview branch holds only test-scale data (largest table ≈ 200 rows — see [Appendix B](#appendix-b--table-sizes-preview-branch)). Postgres therefore picks sequential scans there regardless of indexing, so `EXPLAIN` on this branch is **not** representative of production. This review validates performance structurally — by confirming the indexes that back each hot query pattern actually exist (see [Appendix A](#appendix-a--materialized-indexes)) and by analysing query/round-trip patterns in code — rather than by trusting plans chosen on empty tables.

---

## Executive summary

The data layer is **well-architected for scale**. Schema design is disciplined (lookup tables instead of enums, real FKs with explicit `ON DELETE`, one unified `price_points` table, money as `numeric(10,2)`, all timestamps `timestamptz`), and **every hot query pattern is backed by an appropriate index that is confirmed present in the database**. Code↔id lookups are cached for the process lifetime, so the row-decoration fan-outs are **not** N+1 round-trips to the database.

There is **one high-value optimization** (batch the receipt-create write path) and a few minor cleanups. Nothing here is a launch blocker; item #1 is the one worth doing before traffic scales.

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 1 | Receipt create issued ~`2N+6` **sequential** round-trips per receipt (N = line items) — **✅ implemented**, now ~5–6 constant | **High** (hottest write path) | Done |
| 2 | `receipts_hash_idx` is written on every insert but **never queried** | Low | Trivial |
| 3 | Production compute cold-start latency (scale-to-zero) | Medium (UX, first request) | Trivial (ops) |
| 4 | `marketingPushConsentMap` scans all push-token users + LATERAL | Low (batch job only) | Low |
| 5 | Connection pool `max: 5` per instance | Informational | — |
| 6 | Test suite: parallel DB files exhausted branch connections (flaky) | **Fixed** | Done |

---

## 1. Receipt create — sequential round-trips (High) — ✅ IMPLEMENTED 2026-06-03

> **Status:** Done. `receiptsRepo.create` now batches via the new `pricesRepo.recordReceiptPricePointsBulk()` — **one** product upsert + **one** price-point insert for the whole receipt (was two round-trips per line). Round-trips dropped from ~`2N+6` to ~`5–6` regardless of N. Atomicity, idempotency, TPD handling, warehouse/province scoping, and `watchEnabled` defaults are all unchanged and verified by the receipt test suite (incl. a new same-sku-twice de-dupe regression test). The analysis below documents the original problem and the approach taken.

**Where:** `backend/repos/receiptsRepo.js` → `create()` (the per-item loop) calling `backend/repos/pricesRepo.js` → `recordPricePoint()`.

The receipt header, every receipt item, every product, and every price point are written in **one transaction** (correctly — this is the atomicity guarantee that prevents the half-saved-receipt data-loss bug). But within that transaction the work is issued **serially, one item at a time**:

```
BEGIN
  INSERT receipts … ON CONFLICT DO NOTHING RETURNING          → 1 round-trip
  (warehouse) resolveProvinceId SELECT + INSERT warehouses     → 2 round-trips
  for each item with a sku/barcode:
      recordPricePoint():
        INSERT products … ON CONFLICT DO UPDATE RETURNING      → 1 round-trip
        INSERT price_points … ON CONFLICT DO UPDATE RETURNING  → 1 round-trip   ← ×N
  INSERT receipt_items (single multi-row insert) RETURNING     → 1 round-trip
COMMIT
```

**Cost ≈ `2N + 6` round-trips, fully serialized, inside an open transaction**, where N is the number of priced line items. A typical 30-item Costco receipt ⇒ **~66 sequential round-trips**, each paying network latency to Neon, holding one pooled connection and an open transaction for the whole duration. Under concurrent scanning load this is the dominant scalability constraint (it multiplies latency *and* connection-hold time).

The lookup-id resolutions (`stores`, `receipt_sources`, `price_source_types`) are **not** part of this cost after warmup — they hit the process cache in `backend/db/client.js` (`_lookupCache`). The cost is purely the per-item product + price-point inserts.

### Recommended fix — batch the inserts

Collapse the per-item inserts into set-based statements so the round-trip count becomes **constant (~6) regardless of N**:

1. Resolve `storeId` / `sourceTypeId` once (already cached).
2. **One** multi-row upsert of all products, returning the id↔sku/barcode mapping:
   ```sql
   INSERT INTO products (store_id, sku, barcode, display_name, last_seen_at)
   VALUES (…), (…), …
   ON CONFLICT (store_id, sku) DO UPDATE
     SET last_seen_at = excluded.last_seen_at,
         display_name = excluded.display_name,
         barcode      = COALESCE(products.barcode, excluded.barcode)
   RETURNING id, sku, barcode;
   ```
   Build a `sku → productId` (and `barcode → productId`) map from the returned rows.
3. **One** multi-row insert of all price points, using the mapped `productId`s, `ON CONFLICT (product_id, region, source_type_id, source_ref) DO UPDATE …`.
4. The existing **single** batched `receipt_items` insert (unchanged), using the same `productId`s for the FK.

**Impact:** ~`2N+6` → ~`6` round-trips. For a 30-item receipt that's roughly a **10× reduction** in round-trips and transaction-hold time on the busiest write path.

**Risk & guardrails:** this touches the atomicity-critical path, but it is now well-protected by tests added in this pass:
- `backend/tests/receiptAtomicity.test.js` — a failing price point still rolls the **entire** receipt back.
- `backend/tests/receiptPricePoints.test.js` — every item (incl. TPD-discounted) becomes a `receipt_ocr` price point, warehouse/province-scoped, no duplicates on replay.
- `backend/tests/pricePointUpsertDb.test.js` — product reuse + flyer-dedupe upsert semantics.

Edge cases the refactor must preserve: barcode-only items (synthetic `sku = bc:<barcode>`), TPD `regularPrice`/`instantSavings`, `watchEnabled` defaulting, and `receipt_items.position` ordering.

---

## 2. `receipts_hash_idx` is an unused write cost (Low)

**Where:** `backend/db/schema.js:463` — `index("receipts_hash_idx").on(t.rawOcrHash)`.

`raw_ocr_hash` is **written** on every receipt insert (`server.js` → `receiptsRepo.create`) but a full search of the backend shows **no query that filters by it**. The index therefore adds maintenance cost to every receipt insert (and the hot path in #1) while serving no read.

**Recommendation:** decide its intent:
- If OCR-hash de-duplication is planned (skip re-saving an identical scan), wire up the lookup (`SELECT … WHERE raw_ocr_hash = $1`) and keep the index.
- Otherwise **drop the index** (keep the column) to remove the write overhead.

---

## 3. Production compute cold-start (Medium — UX)

The project's default compute uses autoscaling `0.25–2 CU` with scale-to-zero. After an idle period the **first** request pays a cold-start (compute resume), adding hundreds of ms — and `connectionTimeoutMillis` is `5000` (`backend/db/client.js`), so a cold resume under load can surface as a connection timeout. (This is also what made the parallel test suite occasionally flake — see #6.)

**Recommendation (ops, production branch only):** give the **production** branch a small always-on floor (raise the autoscale minimum / lengthen the suspend timeout) so the first user request after a lull isn't slow. The Preview branch can stay scale-to-zero to save cost.

---

## 4. `marketingPushConsentMap` (Low)

**Where:** `backend/repos/usersRepo.js` → `marketingPushConsentMap()`.

Scans **all** users with a non-null `push_token` and runs a `LATERAL` "latest marketing_push consent" subquery per user. The subquery is well-supported by `consent_events_user_type_idx (user_sub, consent_type_id, occurred_at)`, and the call only runs in the **batch marketing send job** (not a per-request path), so it's fine today. At six-figure user counts, consider materializing "current consent state" (a small table updated on each consent write) to avoid the full scan. **Not needed pre-launch.**

---

## 5. Connection pool sizing (Informational)

`backend/db/client.js` sets `max: 5`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`, and connects through Neon's **PgBouncer pooler** (`…-pooler…` host in `DATABASE_URL`). For a single Railway instance this is appropriate, and PgBouncer absorbs short connection bursts. The relevant interaction is with #1: a long receipt-create transaction holds one of the 5 client slots for its full duration, so reducing that duration (#1) directly increases effective write concurrency. Revisit `max` only when scaling Railway horizontally.

---

## 6. Test-suite reliability (Fixed in this pass)

Two issues surfaced while making the suite trustworthy for "everything green before publishing":

- **Parallel DB contention.** `node --test` ran all ~21 DB-backed test files concurrently, each opening a pool to the same autoscaling branch — enough connection pressure to cause a transient `signupCredits` failure and 84s runs. **Fix:** capped file concurrency at `--test-concurrency=4` in `backend/package.json` (`test` + `test:coverage`). Result: **stable and faster** — 463 pass at ~16s, vs ~54s fully-serial and the flaky default.
- **Flaky mobile sync test (real bug, fixed).** `__tests__/storageService.syncRetry.test.js` mocked `receiptSyncService`, which `saveReceipt` loads via a **dynamic `import()`**. Under full-suite CPU contention, `jest.mock` intermittently failed to intercept that dynamic require, so the **real** sync ran, saw no configured API, and returned `skipped` — silently turning the assertion into a no-op (passed alone, failed ~30–50% in the full run). **Fix:** drive the *real* `receiptSyncService` and mock its **static** `authService` dependency instead (static-import mocks are reliable), plus a small `flushPendingReceiptSyncs()` hook in `storageService.js` to await the fire-and-forget mirror deterministically (also useful for graceful shutdown). Verified **0 failures across 12 consecutive full-suite runs**.

---

## What's already good (no action)

- **Index coverage is complete** for every hot pattern — see [Appendix A](#appendix-a--materialized-indexes). Notably: receipts `(user_sub, purchase_date)`; price_points `(product_id, observed_at)`, the flyer-active `(store_id, region, valid_until)`, and the dedupe unique `(product_id, region, source_type_id, source_ref)`; products `(store_id, sku)` unique + `barcode`; watched_items `(push_token, sku, store_id)` unique + `last_touched` for TTL prune; consent_events `(user_sub, consent_type_id, occurred_at)`; subscription_events unique `rc_event_id` for webhook idempotency.
- **Lookup caching** (`backend/db/client.js`) makes code↔id translation O(1) after warmup; the `decorate*` helpers and list endpoints are **not** N+1 against the DB.
- **Idempotency is enforced at the database**, not just in app code: receipt id PK + `ON CONFLICT DO NOTHING`, RevenueCat `rc_event_id` unique, `users.trial_credits_granted_at` guard, top-up `lastTopupEventId`.
- **Retention prunes are indexed** (`watched_touched_idx`, `sub_events_occurred_idx`, `audit_created_idx`).

---

## Prioritized action list

1. ~~**(High)** Batch receipt-create product + price-point inserts (§1).~~ **✅ Done 2026-06-03.**
2. **(Medium)** Set an always-on compute floor on the production branch (§3).
3. **(Low)** Resolve `receipts_hash_idx`: use it for OCR de-dupe or drop it (§2).
4. **(Low / later)** Revisit `marketingPushConsentMap` only at large user scale (§4).
5. **(Done)** Test concurrency cap + sync-test determinism (§6).

---

## Appendix A — materialized indexes
Confirmed present on `br-steep-breeze-aqeg0i38` / `priceback_db` (`pg_indexes`, non-PK shown):

| Table | Index | Definition |
|---|---|---|
| receipts | `receipts_user_date_idx` | `(user_sub, purchase_date)` |
| receipts | `receipts_hash_idx` | `(raw_ocr_hash)` — **unused, see §2** |
| receipt_items | `receipt_items_receipt_idx` / `_sku_idx` / `_product_idx` | `(receipt_id)` / `(sku)` / `(product_id)` |
| price_points | `price_points_product_date_idx` | `(product_id, observed_at)` |
| price_points | `price_points_active_flyer_idx` | `(store_id, region, valid_until)` |
| price_points | `price_points_source_date_idx` | `(source_type_id, observed_at)` |
| price_points | `price_points_source_ref_uq` | **unique** `(product_id, region, source_type_id, source_ref)` |
| products | `products_store_sku_uq` / `products_barcode_idx` | **unique** `(store_id, sku)` / `(barcode)` |
| watched_items | `watched_token_sku_store_uq` | **unique** `(push_token, sku, store_id)` |
| watched_items | `watched_token_idx` / `watched_touched_idx` | `(push_token)` / `(last_touched)` |
| consent_events | `consent_events_user_type_idx` | `(user_sub, consent_type_id, occurred_at)` |
| credits_ledger | `credits_user_date_idx` | `(user_sub, created_at)` |
| subscription_events | `subscription_events_rc_event_id_unique` | **unique** `(rc_event_id)` |
| subscription_events | `sub_events_user_date_idx` / `sub_events_occurred_idx` | `(user_sub, occurred_at)` / `(occurred_at)` |
| users | `users_email_idx` / `users_referral_code_unique` / `users_referred_by_idx` | `(email)` / **unique** `(referral_code)` / `(referred_by)` |
| devices | `devices_owner_idx` | `(owner_sub)` |
| warehouses | `warehouses_store_code_idx` / `warehouses_province_idx` | **unique** `(store_id, code)` / `(province_id)` |
| ~~api_audit_log~~ | *(removed 2026-07-23 — audit log moved to stdout, migration 0008)* | — |

## Appendix B — table sizes (Preview branch)
`pg_stat_user_tables`, largest first (test-scale data — context for why `EXPLAIN` here is unrepresentative):

| Table | ~rows | size |
|---|---|---|
| warehouses | 204 | 96 kB |
| ~~api_audit_log~~ | *(removed 2026-07-23 — now stdout, migration 0008)* | — |
| price_points | 152 | 144 kB |
| products | 75 | 96 kB |
| app_config | 21 | 48 kB |
| store_policies | 20 | 136 kB |
| users | 6 | 112 kB |
| receipt_items | 7 | 112 kB |

## Appendix C — measured test-suite timings
| Mode | Result | Wall time |
|---|---|---|
| Backend default (full parallel) | flaky — 1 transient fail observed | up to 84s |
| Backend `--test-concurrency=1` (serial) | 463 pass, deterministic | ~54s |
| **Backend `--test-concurrency=4` (chosen)** | **463 pass, 0 fail × 4 runs** | **~16s** |
| Frontend full suite (post sync-test fix) | 1058 pass, 0 fail × 12 runs | ~9s |
