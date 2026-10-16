# Costco-coupons ingestion: open work

Roadmap items surfaced while importing the `costco-coupons-2026-09-14-ALL.json`
batch (119 items × 13 provinces = 1,547 `price_points` rows, production,
2026-09-27). A punch list, not a design doc. **Status 2026-09-28: §1 shipped,
§2 partly** (on branch `merge/main-and-development`); §3–§5 open. See
[[Flyer-ingestion]] and [[Costco_Flyer_Province_Comparison]] for the ingestion
mechanism and crawl findings this work builds on.

---

## 1. Use the `NATIONAL` province for `costco-coupons`, instead of fanning out to 13 rows

> **✅ SHIPPED 2026-09-28** — with one deliberate difference from the plan
> below. Maxim's rule was broader than this item: *"all national offers should
> be stored as national not duplicated even for costco"*. So **every** import
> scoped `"ALL"` is stored once as `NATIONAL` — the scheduled crawl, the CLI and
> the in-app Flyer Scan's national scope alike — not only `source:
> 'costco-coupons'`. `"ALL"` is the explicit statement that a batch is national;
> a provincial import stays provincial. The checklist, answered:
>
> - *Money-path tests with a real Costco NATIONAL row* — `costcoNationalOfferDb.test.js`
>   (11, against Postgres): detection `(province || NATIONAL)`, a province's own
>   cheaper flyer winning there only, commission charged exactly once under two
>   racing sweeps, and the charged drop locked (`lockedDropsForUser`). It also
>   found a real bug: a region-scoped sweep's buyer filter sat only on the
>   products prefilter, so a national row reached other provinces' buyers — fixed.
> - *Gate the write path* — superseded by the rule above.
> - *A future province-specific coupon* — import it provincially; a province's
>   own offer and the national one are both read, and the cheaper wins there.
> - *Update `Store_Price_Adapters.md`'s "no Costco row" invariant* — done.
>
> Existing fanned-out batches collapse when re-imported (a provincial copy is
> deleted only next to its `NATIONAL` replacement): re-importing
> `ALL-2026-09-14` takes production from 1,547 rows to 119. Full mechanics:
> [[Flyer-ingestion]] §4.

**The ask:** avoid writing 13 near-identical `price_points` rows per SKU per
change for a source that is confirmed nationwide-identical, the same way
`NATIONAL` already avoids it for Best Buy/Sport Chek.

**What already exists:** `Technical/Store_Price_Adapters.md` § "The NATIONAL
province" — a reserved `provinces.code = 'NATIONAL'` row, resolved through the
ordinary `resolveProvinceId` write path (no schema change, no write-path
special case). Four province-scoped reads in `priceDropRepo` were updated to
recognize it: `getLatestVerifiedPrice`, and three spots in `findNotifiable`
(buyer join, region scope, provinces join).

**Why it isn't already used for Costco — read this before touching it:**
`Store_Price_Adapters.md` states the design explicitly assumes Costco never
uses it: *"That is correct for Costco — warehouse prices genuinely differ by
province — and wrong for every other retailer."* The safety argument for the
riskiest edit in that feature (`findNotifiable`, which joins a price row's
province to the buyer's province and is **the query that charges commission**)
rests partly on: *"no Costco row is ever written with the national province, so
no Costco result set can change."* Writing a Costco row with `province:
"NATIONAL"` breaks that invariant for the first time. This is a money-path
change, not a plumbing change.

**What's actually true for `costco-coupons` specifically (not Costco in
general):** `Costco_Flyer_Province_Comparison.md` §1 confirmed the digital
coupon book (`costco.ca/coupons.html`) publishes identical SKUs, regular
price, and instant savings nationwide for one cycle, checked across ON/QC/BC —
only eco-fee and tax differ, and those are already excluded from
`promoPrice`/`regularPrice` by policy. Regular warehouse flyer pricing
(admin Flyer Scan, per-warehouse tag scans, receipts) is **not** claimed to be
uniform and must keep writing province-scoped rows — this item is scoped to
the `costco-coupons` **source type** only, per the per-store-isolation
standing rule (don't widen a store-gated branch to a set).

**Before implementing:**
- [ ] Re-run (or write new) money-path tests for `findNotifiable` with an
  actual `province: 'NATIONAL'` Costco row present — the existing 60-test
  baseline this feature shipped with only proves *"a Costco row never uses
  NATIONAL, so nothing changes"*; that premise is exactly what this item
  removes. Commission-charged-once and locked-drop-price invariants both need
  re-checking against a national row.
- [ ] Gate the write path so only `source: 'costco-coupons'` writes
  `province: 'NATIONAL'` — `commitFlyerImport`'s `region: 'ALL'` fan-out is
  shared by the in-app admin Flyer Scan and manual JSON imports too, neither
  of which has the same "confirmed uniform" guarantee.
- [ ] Decide what happens if a future coupons cycle turns out to have a
  province-specific SKU/price after all (the confirmation was one cycle,
  three provinces) — a wrong NATIONAL row is wrong in all 13 provinces at
  once, not one.
- [ ] Update `Store_Price_Adapters.md`'s "no Costco row" invariant once this
  ships, since another reader will trust it as currently written.

---

## 2. `commitFlyerImport`'s background DB persist silently loses rows under load

> **◐ PARTLY DONE 2026-09-28.** `recordPricePointsBulk` now isolates each row —
> a row that throws is logged and skipped, the rest are written — and both
> failure logs use `describeError`, so the Postgres cause is printed. A national
> batch is also 13× fewer writes (119 instead of 1,547 for this batch), which
> removes most of the pool contention. **Still open:** surfacing a partial
> persist somewhere visible (the third checkbox below).

**Found live in production during this import.** `commitFlyerImport`
(`backend/server.js`) persists each region's accepted offers via
`pricesRepo.recordPricePointsBulk`, which loops `await recordPricePoint(row)`
per row with no per-row try/catch — one failing row aborts every row after it
in that region, but rows already inserted before the failure stay committed
(no transaction wraps the loop). Re-importing `ALL-2026-09-14` needed **3
identical, idempotent re-runs** before all 13 provinces reached the full
119/119 rows; partial region counts (e.g. `AB: 8/119`, `MB: 2/119`) sat
silently in prod between runs with no alert.

Root cause not fully confirmed, but the shape (varying, non-deterministic
failure point per region per run, `AB` failing consistently at row 1 across
runs while other regions varied) points at contention on the small (max 5)
production connection pool — `db/client.js` sizes it for Railway's single
instance, shared with live app traffic, while this write path does ~6+
sequential round trips per row (three `lookupId` calls, `resolveProvinceId`,
`resolveWarehouseId`, `upsertProduct`, the insert itself) × up to 1,547 rows in
one import.

**Compounding bug:** the failure handler logs `e.message`, which for a
drizzle query error is just `"Failed query: <sql>\nparams: [redacted]"` — the
actual Postgres error (SQLSTATE, constraint, driver message) lives on
`e.cause` and is never printed. `backend/lib/errorRedaction.js`'s
`describeError()` was built for exactly this class of bug (see its own
doc comment, citing a 2026-09-22 incident) but isn't wired into this call
site, so diagnosing this required a separate live investigation instead of
reading the log.

**Needed:**
- [ ] Swap `console.warn(..., e.message)` → `console.warn(..., describeError(e))`
  at the two `[Flyer] DB price_points write failed` sites in `commitFlyerImport`.
- [ ] Either wrap each region's bulk write in a transaction (all-or-nothing,
  simplest) or add per-row retry/catch so a single bad/contended row doesn't
  silently drop every row behind it.
- [ ] Surface partial persistence somewhere visible (the API response only
  reports the in-memory overlay's accept count, not what actually reached
  `price_points` — Phase 1 and Phase 2 can silently disagree, as they did
  here for ~2 minutes across 3 runs).

---

## 3. Admin "flag for next warehouse visit" — no feature exists yet

`Costco_Flyer_Province_Comparison.md` §5: 3 of 4 Duracell AA/AAA battery SKUs
in this cycle only resolve to an **online** price (`priceSource: "online"`,
`warehousePriceLikelyLower: true`), and the 4th SKU had no resolvable price at
all until confirmed manually this session. There is currently no mechanism —
DB column, admin console view, or otherwise — to flag a SKU for someone to
verify in-warehouse on their next visit and feed the corrected price back in.
Today this lives only as a flag in the imported JSON's `flags` object, which
nothing reads after import.

**Needed:** a lightweight admin-reviewable queue (reuse the existing
`price-tag-reviews` admin pattern if it fits) keyed on SKU + reason
(`priceUnconfirmed`, `warehousePriceLikelyLower`), surfaced somewhere an admin
checks before/during a warehouse trip.

---

## 4. Rebate/conditional offers don't fit `price_points`

Already flagged in `Costco_Flyer_Province_Comparison.md` §7 (the Bridgestone
"$100 instantly on any set of 4 eligible tires" tile) — not a single priced
SKU, needs its own table, and must never auto-deduct credit/commission since
Priceback can't independently confirm a qualifying purchase happened. Carried
here so it isn't lost outside that doc.

---

## 5. Coupon-crawl coverage and cadence

Already flagged in `Costco_Flyer_Province_Comparison.md` §8:
- No automated recurring trigger for the coupons-page crawl yet (Maxim wants
  it to run within the first hour of a new cycle going live; this is a
  scheduling/infra decision, not a silent default).
- Zero coverage for Treasure Hunt, Offers Ending Sunday, Online deals, and
  Executive Member-only deals (the last needs an Executive-tier
  Claude-in-Chrome session, which doesn't exist today).
