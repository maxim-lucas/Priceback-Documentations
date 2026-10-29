# Receipt desk: Gemini balance, database fill, deleted receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make *Fix automatically* retry until Gemini's proposal balances and never splits a grouped line, fill missing values from the database (tagged), show confidence, fix and extend the desk's deleted-receipt view, and unify the costco.ca / Sameday lookup buttons.

**Architecture:** Server first. These pure modules are unit-tested in isolation and then wired into the existing routes and repos:
- `receiptAutoFix` gains a retry loop, the grouping check and confidence;
- new `receiptDatabaseFill` (name similarity + fills);
- `receiptsRepo` (deletion actor, deleted filter, sku-guess safeguard).

The desk UI (3.1.5) consumes the new additive response fields through shared view helpers and one shared button component.

**Tech Stack:** Node/Express + Drizzle (Postgres, `priceback` schema), node:test + c8 (backend), React Native/Expo + Jest (app).

**Spec:** `Technical/Receipt_Desk_Gemini_Balance_And_Database_Fill_Design.md` (this folder).

## Global Constraints

- Hotfix branch `hotfix/receipt-desk-gemini-balance-db-fill` off `main`, PR into `main`. Merging = Railway prod deploy, which needs Maxim's go.
- Backend additive only. `status=database_prices` stays accepted. New body fields are optional. The 3.1.4 desk must keep working.
- Migration `0035_receipt_deletion_and_db_fill.sql`: additive and idempotent, RLS on the new table, and applied to dev with drizzle-kit and to prod by hand (with its ledger row) before the deploy.
- One write path for desk line edits: `POST /api/admin/receipts/:id/lines` → `lib/badScanRepair`.
- Admin screens: plain English, never raw codes. No shopper-visible copy changes.
- `RETRY_ATTEMPTS = 3`; every try reserves 1 unit of the Gemini daily budget; all tries run inside `DESK_BUDGET.deadlineMs = 150000`.
- Best match: `MIN_MATCH_SCORE = 0.6`, `MIN_MATCH_MARGIN = 0.05`.
- Tests ship in the same commit, and each new rule is mutation-checked (red on the old code).

## Review Focus

1. A proposal with the same item number at the **same** price and **different** coupons, against a stored qty-2 line → `grouping_kept` fails (the Feta receipt `r_1792860056497_170i0` as a fixture).
2. A weighed item (same SKU, two different regular prices) against a stored qty-2 line → `grouping_kept` passes.
3. A printed name that looks unread but is real (e.g. "ITEM" alone, all digits) → database fill never overwrites a non-placeholder name.
4. The Gemini budget is refused mid-loop → the loop stops and returns the best try so far (no 503).
5. A deleted receipt on the all-accounts desk under `status=all` → still hidden. Only `status=deleted` lists it.

---

### Task 1: Grouping check, retry loop, confidence (`backend/lib/receiptAutoFix.js`)

**Files:** Modify `backend/lib/receiptAutoFix.js`, `backend/lib/receiptLlmRules.js` (prompt text). Test: `backend/tests/receiptAutoFix.test.js`.

**Interfaces — produces:**
- `checkProposal(proposal, { rawOcr, headerOcr, currentItems })` adds the hard check `grouping_kept` and `splitSkus: string[]` on its return.
- `restoreGrouping(proposalItems, currentItems, splitSkus) → items`.
- `receiptConfidence({ checks, attempts = 1, autoEdits = [], filled = 0 }) → { level: "high"|"medium"|"low", passed, of, reasons: string[] }`.
- `proposeReceiptFix(receipt, { ..., attempts = 1, reserveTry?: () => boolean, fill?: async (items) => {items, filled} })` returns, in addition to today's fields: `attempts`, `autoEdits`, `confidence` (object), `geminiConfidence` (number|null).
- `RETRY_ATTEMPTS = 3`.

- [ ] Tests:
  - `grouping_kept fails when a grouped line is split at one regular price` (Feta: stored qty 2, 55.98/71.98; proposal two lines 27.99/35.99 and 29.99/35.99 → ok false, `splitSkus` ['1025480']).
  - `grouping_kept passes for a weighed item` (stored qty 2; proposal 23.30 and 20.85, no originals).
  - `retry feeds failed checks back and stops at the first applicable try` (fake fetch: first answer splits, second answer correct → `attempts` 2, applicable, prompt of call 2 contains "grouping_kept" detail).
  - `retry stops when reserveTry refuses`.
  - `fallback restores grouping and is medium` (3 split answers → applicable after restore, `autoEdits.length` 1, `confidence.level` 'medium').
  - `confidence levels`.
- [ ] Implement. Retry prompt: append "Your previous answer failed these checks:" + one line per failed hard check (`key: detail`) + "Your previous lines (JSON): …". Best try = applicable first, then max passed hard checks, then fewest diff entries.
- [ ] Add the grouping sentence to `PARSER_RULES_PROMPT` (spec §5).
- [ ] Run `node --test tests/receiptAutoFix.test.js tests/receiptLlmRules.test.js tests/receiptGeminiReader.test.js` → all pass (read the `skipped` count).
- [ ] Commit.

### Task 2: Database fill (`backend/lib/receiptDatabaseFill.js` + repo reads)

**Files:** Create `backend/lib/receiptDatabaseFill.js`. Modify `backend/repos/pricesRepo.js` (two reads). Test: `backend/tests/receiptDatabaseFill.test.js` (pure), `backend/tests/receiptDatabaseFillDb.test.js`.

**Interfaces — produces:**
- `nameIsUnread(name) → boolean` (empty, `(unnamed)`, `Item #…`, `Item <digits>`, `Unknown item`, digits only).
- `normalizeName(s)`, `nameSimilarity(a, b) → 0..1` (bigram Dice + 0.15 bonus for an equal token set, capped at 1).
- `bestMatch(name, candidates[{sku, name}]) → {sku, name, score} | null` (applies `MIN_MATCH_SCORE` / `MIN_MATCH_MARGIN`).
- `fillLines(items, { storeCode, provinceCode, lookups }) → { items, filled }`: each item gains `nameFromDatabase` / `skuFromDatabase` / `priceFromDatabase` and `databaseMatch: {name, score}` where filled. `lookups = { productBySku(sku), productsForMatch(storeCode), priceFor(sku) }`.
- `dbLookups({ storeCode, provinceCode }) → lookups` (real DB adapter).
- `pricesRepo.productNameBySku({ sku, storeCode })`, `pricesRepo.namedProductsForStore(storeCode) → [{sku, name}]` (real SKU only, not a stand-in).

- [ ] Tests: name filled only when unread; never replaces a printed name; SKU filled by best match ≥ 0.6, refused on a near-tie; price filled only when missing/0 and not ignored or refund; no lookup at all when nothing is missing.
- [ ] Implement; run; commit.

### Task 3: Migration 0035 + persistence + safeguard + deletion actor

**Files:** Create `backend/db/migrations/0035_receipt_deletion_and_db_fill.sql` (+ drizzle meta journal), modify `backend/db/schema.js`, `backend/db/seed.js`, `backend/repos/receiptsRepo.js`, `backend/repos/usersRepo.js`, `backend/lib/badScanRepair.js`, `backend/db/deploy/schema.sql` (regenerate). Tests: `backend/tests/receiptDeletionActorDb.test.js`, `backend/tests/receiptDbFillPersistDb.test.js`, additions to `badScanRepair` tests.

**Interfaces — produces:**
- Table `receipt_deletion_types(id, code, label)`, seeded with `owner`, `owner_last_line`, `data_reset`, `account_deletion`, `admin`.
- `receipts.deleted_by_type_id`, `receipts.deleted_by_sub`, `receipt_items.name_from_database`, `receipt_items.sku_from_database`.
- `receiptsRepo.softDeleteForAdmin(id, adminSub) → {deleted, alreadyDeleted?}`.
- `listForAdmin` rows gain `deletedBy: { type, label, adminEmail } | null`, and `getForAdmin` gains the same; `getForAdmin` items gain `nameFromDatabase`, `skuFromDatabase`.
- `persistReceiptItems` runs `fillLines` (skipped when `allItems` has nothing missing). A `skuFromDatabase` line files no price point and `watchEnabled=false`.
- `setAdminFlags({ adminReviewed: true })` turns on watch for live `sku_from_database` lines that are not ignored, not discounted and not claimed.
- `listForAdmin({ status: "deleted" })` without `userSub` lists deleted receipts, ordered by `deleted_at desc`.

- [ ] Tests for each delete path's stamp, the backfill (data_reset match), the all-accounts deleted chip, the safeguard (no price point, unwatched; watched after Mark reviewed), and the repair carrying the flags.
- [ ] Apply 0035 to dev; run the DB suites; commit.

### Task 4: Routes (`backend/server.js`)

**Files:** Modify `backend/server.js`. Tests: route tests next to the existing `adminReceipt*` tests.

**Interfaces — produces:**
- `POST /api/admin/receipts/:id/auto-fix` passes `attempts: RETRY_ATTEMPTS`, `reserveTry` (the `reserveBudget` call) and `fill`. The first try's budget stays as today (a 503 only if the very first is refused).
- `GET /api/admin/receipts/:id` adds `readingConfidence` (`checkProposal` on the stored lines → `receiptConfidence`; `null` without raw OCR).
- `GET /api/admin/receipts/:id/database-check?sku=&name=&quantity=` → `{ bySku: {sku, name, price, observedAt} | null, byName: [{sku, name, score, price}] }` (top 3).
- `POST /api/admin/receipts/:id/delete` → `{ ok, deleted, alreadyDeleted }`, 404 when the receipt doesn't exist.
- `GET /api/admin/receipts?status=deleted`.

- [ ] Tests, implement, run, commit.

### Task 5: Shared store-lookup buttons (app)

**Files:** Create `src/services/storeLookup.js`, `src/components/StoreLookupButtons.js`; modify `src/screens/AdminSavingDatesScreen.js`, `AdminPotentialDropsScreen.js`, `AdminPriceDropQueueScreen.js`. Tests: `src/services/__tests__/storeLookup.test.js` and the screens' existing tests updated.

**Interfaces — produces:**
- `costcoSearchUrl({ sku, name }) → string|null` (SKU first).
- `samedaySearchUrl(query)` (moved from Saving dates; re-exported there for its tests).
- `<StoreLookupButtons storeCode sku name provinceCode clubsText? onSamedayResult? testIDPrefix />`.

- [ ] Tests, implement, run Jest for these files, commit.

### Task 6: Desk UI (app)

**Files:** Modify `src/screens/AdminReceiptDetailScreen.js`, `src/services/adminAutoFix.js`, `src/services/adminReceiptView.js`, `src/screens/AdminHomeScreen.js`, plus `AdminReceiptsReviewScreen.js` for the deleted row. Tests: the services' existing test files + the screen smoke test.

- [ ] Chips: remove `database_prices`; `deleted` is no longer per-account-only; drop the admin-home counter tile.
- [ ] Deleted row text: `deletedByText(row)` → "Deleted by Shopper · Oct 24, 2026" / "Deleted by Admin a@b · …" / "Deleted — who not recorded".
- [ ] Line tags: "Price from database" (exists), "Name from database", "Item number from database — check it (matched X, 82%)".
- [ ] Header badge: `confidenceText(c)` → "Reading confidence: High · 8 of 8 checks".
- [ ] Auto-fix panel: the confidence badge, "Tries: k", "Automatic edits" block, Gemini's own number in small print.
- [ ] Line editor: a **Check database** button per line, with a panel offering **Use name**, **Use item number** and **Use price** (sets the flags in the body sent to `/lines`).
- [ ] `StoreLookupButtons` on each line in the detail.
- [ ] **Delete receipt** button behind a confirm.
- [ ] Run the mobile Jest for the touched files, then the full suite; `npm run i18n:check`; commit.

### Task 6b: Product names screen (spec §9.5)

**Files:** Modify `backend/lib/costcoSameday.js` (`productName`), `backend/server.js` (3 routes: `GET /api/admin/products?q=&filter=&limit=&offset=`, `POST /api/admin/products/:id/official-name`, `PUT /api/admin/products/:id/name`), `backend/repos/pricesRepo.js` (`listProductsForAdmin`). Create `src/screens/AdminProductNamesScreen.js`; register it in the app navigator and on `AdminHomeScreen`. Tests: route tests (Sameday stubbed: a proven page → name; an unproven page → `found:false`), a repo DB test for the list filter, a screen smoke test.

- [ ] Tests, implement, run, commit.

### Task 7: Docs, verification, PR

- [ ] Full backend c8 run + full mobile Jest; record the numbers.
- [ ] Bugs entry (deleted chip never matched; Gemini split a grouped line), RC note for the Feta receipt (no repair: the stored reading is right), Task_Log entry, and the runbook `Operations/Receipt_Auto_Fix_Admin_Button.md` updated.
- [ ] PR into `main` with the **Old app builds** section; docs PR.
