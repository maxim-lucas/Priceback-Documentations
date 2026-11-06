# Best Buy — launch readiness, 2026-11-06

**Question (Maxim):** *"Are we ready to publish Best Buy and 100% support their receipts? What is the remaining
roadmap?"* Then: *"work on main-test-features only now, I will merge all the branches to main later. main-test-features
is used to prepare the launch for Best Buy"* — port, check the parser against the design rules, and *"I want the store
enabled only for admins … with a switch to enable stores in the admin desk for any store."*

Branch: `feat/bestbuy-launch-prep` off `main-test-features` @ `bcedbf0` — **Priceback #535** into `main-test-features`.

**Short answer: not yet.** The parser is finished and admin-only on `main-test-features` (Priceback #504), but
`main` does not have it, no build in the stores carries it, and the corpus cannot back a "100 %" claim. What this
branch adds and what is still owed are below.

---

## 1. Where things stood (checked 2026-11-06)

| | `main` | `main-test-features` | Prod |
|---|---|---|---|
| Parser | `LAB_STORE_PARSERS` (generic parse in a store build) | `STORE_PARSERS` + admin-only (#504) | — |
| Nightly price feed, `/health` feed check, store-content generator | absent | present | — |
| `stores.enabled` (bestbuy) | `false` | `false` | `false` |
| `BESTBUY_SCAN_ENABLED` | — | default off | `false` |
| Best Buy receipts | — | — | **0** |
| Shoppers waiting for the launch push | — | — | **3** |

Every build in the stores — **v3.3.0, v3.4.0, v3.5.0** — has Best Buy on the lab lane. Opening the store to shoppers
today would let those phones read Best Buy receipts with the generic parser: plausible, wrong numbers on real
purchases. That is the backward-compatibility constraint (§4, step 6).

Dev (`gnedluuylimjwdmtvswl`) still has `bestbuy.enabled = true` from the 2026-09-10 audit (`Integration_Audit_2026-09-10.md`
finding 1) — every dev build shows Best Buy as open. Left as is; switch it from Admin · Stores if it should be held.

## 2. The parser against the design rules (`Technical/Receipt_Parser_Design_Rules.md`)

The corpus is still the **nine** real captures in `__tests__/fixtures/receipts-bestbuy/` (1 in-store photo, 8 bestbuy.ca
order PDFs). A search of every other fixture folder found no further Best Buy receipt: the photo taken right after
the in-store slip (`receipts/PXL_20260415_185101810`) is a Costco Gloucester receipt.

Every capture, re-parsed on this branch:

| Capture | Format | Items (SKU · price) | Tax | Total | Closes |
|---|---|---|---|---|---|
| `PXL_20260415_185052976` | in-store photo | 19204882 · 3,699.99 | 481.00 † | 4,180.99 | ✅ |
| `receipt-1016175126` | online, QC | 10158121 · 84.99 | 12.73 | 97.72 | ✅ |
| `receipt-1016247380` | online, QC | 15990615 · 129.99 | 19.47 | 149.46 | ✅ |
| `receipt-1026227427` | online, ON | 17922261 · 499.99 | 65.00 | 564.99 | ✅ |
| `receipt-1026461393` | online, ON | 19204884 · 1,899.99 | 247.00 | 2,146.99 | ✅ |
| `receipt-1026463972` | online, ON (Marketplace) | 18145276 · 649.99 | 84.50 | 734.49 | ✅ |
| `receipt-798045533` | online, QC, 2 items | 13579755 · 299.00, 11509461 · 79.98 | 56.76 | 435.74 | ✅ |
| `receipt-874161038` | online, QC, eco-fee | 12917124 · 49.99, 10255247 · 0.25 | 7.52 | 57.76 | ✅ |
| `receipt-878581255` | online, QC, eco-fee | 12917122 · 39.99, 10255247 · 0.25 | 6.02 | 46.26 | ✅ |

Rule by rule:

| Rule | Online path | In-store path (before this branch) |
|---|---|---|
| 1. Identify first | ✅ store, order date, no store # — from the raw text | ✅ store, BUS DATE, `S-###` — from the raw text |
| 2–3. Denoise, keep body + totals | ✅ items read only from the item table (header row → `Payment Information`); totals from the geometry rows | ❌ **the whole slip** went to the extraction engine: header, `SALE` banner, delivery block, payment, returns-policy bleed-through |
| 4. Extract | ✅ | ✅ |
| 5. Verify, never re-derive | ✅ | ⚠️ † see below |
| 6. Special cases are image problems | ✅ | ✅ bleed-through trim, thousands separator, faint print |

**Fixed on this branch — the in-store denoise step** (`src/services/bestBuyReceiptSections.js`, Best Buy only):
the slip is divided into Header / Body / Totals / Payment / Footer, EN + FR, and only Body + Totals reach the engine.
Identity is still read from the raw slip first. Fail-open: no totals block found → the slip passes unchanged.
Proof it is not cosmetic — each of these fails with the step removed (`__tests__/bestBuyReceiptSections.test.js`):

- the `SALE` banner was welded into the first item's name (`"SALE SONY"`);
- a header banner with an amount above the register line had the same effect;
- the delivery stub printed between SUBTOTAL and TAX (`Deliver01 K1A0B1 1-R-…`) became a **phantom $12 item**;
- a fulfilment line carrying a number was folded into an item.

On the real photo the header now ends at `SALE` and the delivery block, `Deliver01` stub and card line are gone; the
parse is unchanged (it already closed). All 127 real-OCR assertions and the 1,000+ synthetic tests pass unchanged.

**Open, for Maxim's decision — not changed:**

- † **The in-store tax is re-derived** (`repairTaxFromPrintedRate`): OCR read the printed tax as `$461.00` (0.986
  confidence); the parser replaces it with 13 % × 3,699.99 = 481.00 because three printed figures agree (rate, base,
  TOTAL). Rule 5 says a receipt that does not close is *flagged*, never balanced by re-deriving a tax. This is a
  reading of other printed figures rather than an invention, but it is still a re-derivation. Keep, or flag instead?
- **Bleed-through inside an item row** stays in the name: `Samsung 85LS03FW PRO stall 6 ( e`. Mirror text from the
  back of the slip sits between the name and the price on the same row; only words *after* the price are trimmed.
  An image problem (rule 6) — the photo-quality gate or geometry, not text rules.
- **French in-store vocabulary is unproven.** `VENTE`, `SOUS-TOTAL`, `TPS/TVQ`, `DÉBIT`, `Date de livraison` are in
  the section lists and pass synthetic slips; no Québec in-store slip exists in the corpus.

## 3. Admin · Stores — the switch for any store (this branch)

Before: "admins only" was the hard-coded `ADMIN_PREVIEW_STORES` set in the bundle, so holding or releasing a store
for admins needed a build. Now each store is in one of three states, switched from the admin desk:

| Desk | `enabled` | `admin_preview` | The app |
|---|---|---|---|
| Coming soon | false | false | "Coming soon" for everyone |
| Admins only | false | true | "Coming soon" for shoppers; an admin can pick and scan it ("Admins only" badge) |
| Everyone | true | false | open; the waiting shoppers are pushed within 15 min |

- **Migration `0046_store_admin_preview`** (first written as `0045_store_admin_preview`; renumbered 2026-11-06 when
  `main` gained its own `0045_receipt_auto_approval` — see §5) — additive, idempotent; holds Best Buy for admins.
  **Apply it on prod BEFORE deploying this backend**: `storePoliciesRepo` selects
  every column, so without it `GET /api/v1/policies.json` fails and every launch keeps its cached stores.
  Applied on dev 2026-11-06.
- `GET /api/admin/stores`, `POST /api/admin/stores/:code/availability` (`lib/storeAvailability.js` is the only
  word ↔ columns mapping). The trigger moves `updated_at` → the payload's `rev` → phones apply it on next launch.
- Payload: `adminPreview` per store (additive). The app reads the store's own field; the bundled set is only the
  fallback when a record does not carry it. Builds that predate the field ignore it.
- **`store-content-sync.sql` no longer writes availability on an existing row** — it would silently undo the desk.
  `enabled` / `admin_preview` are written on INSERT only.
- The desk warns before "Everyone" (waiting-shopper count; older builds may lack the reader; no dedicated reader in
  this build) and before closing a live store.

Old builds (rule 3 of the backend-compat rule): "Admins only" reaches only builds that know `adminPreview`; older
builds keep their bundle. "Everyone" reaches every build — which is why step 6 below comes first.

## 4. Remaining roadmap to a shopper launch

1. **Merge this branch into `main-test-features`**, then `main-test-features` into `main` (Maxim's plan). The merge
   must keep Costco byte-identical (`costcoPathImmutability`, the registry parity block, the golden snapshot).
2. **Real receipts the corpus has never seen** — collect as an admin in production, capture, scrub, pin:
   a **return** (either format), an **in-store slip with a markdown** (Regular Price / Instant Savings), a **second
   in-store slip**, and a **Québec in-store slip** (proves the French section vocabulary).
3. **Decide †** (re-derived tax) and the in-row bleed-through (§2).
4. **Ship a build that carries the parser** (first release cut from `main` after the merge), tag + GitHub release per
   the release rule. Test it live in production as an admin.
5. **Deploy the backend from `main`**, after applying `0046_store_admin_preview` (and `main`'s own pending migrations) on prod. Confirm
   Railway reaches bestbuy.ca: prod `/health?token=` → `checks.priceFeeds.bestbuy`.
6. **Before "Everyone": protect the installed builds.** v3.5.0 and older read Best Buy with the generic parser. Once
   the new build is live to 100 % in BOTH stores, raise **Admin · App version** to it. Builds that don't report
   themselves (≤ 3.0.6) can't be forced — the update reminder and "Refuse builds before 3.0.7" are the only levers.
7. **Paperwork at shopper launch:** `REVIEWER_NOTES.md` gains Best Buy as a second scraping source → re-render and
   re-upload the reviewer PDF; prod drizzle-ledger row for the national-province migration. (PIA already done.)
8. **Go live — Maxim's call:** Admin · Stores → Best Buy → **Everyone** (pushes the 3 waiting shoppers), then turn on
   `BESTBUY_SCAN_ENABLED` on prod last (it writes verified price points, which charge commission).

## 5. Status update — 2026-11-06 (later)

Maxim changed step 1: *"merge main into main-test-features instead, dont merge anything on main yet … prepare
main-test-features to be the ready to merge code to main but i will do it at my pace"*.

**Step 1 — `main` merged into `main-test-features`** (`origin/main` @ `b2ea5f8`, 33 commits). Resolved:

| Conflict | Resolution |
|---|---|
| Two migrations numbered **0045** (`main`: `0045_receipt_auto_approval`, #537; branch: `0045_store_admin_preview`) | Branch's renamed **`0046_store_admin_preview`**, SQL unchanged; journal 41→46 in order; `schema.sql` regenerated (47 migrations); comments citing it point at 0046 |
| `usersRepo.js` exports | both kept (`PUSH_PERMISSIONS` + `_touchUpdatedAt`) |
| `priceService.registerForPriceWatch` | `main`'s refusal handling + `WATCH_REGISTERED_KEY` (sync audit D2) **and** the branch's once-a-day fingerprint de-dupe; a fingerprint is stored only after an accepted, non-`retry` answer |
| `flyerAdminRoutes.test.js` | `main`'s capture-only-this-batch filter on the branch's `recordPricePointsBulkDetailed` |

Tests the merge surfaced, fixed on the merge branch (test or wiring only, no behaviour change for a shopper):

- `costcoPathImmutability` — `costcoReceiptParser.js` / `receiptParsingShared.js` re-pinned to `main`'s bytes
  (#512, #517 — reviewed Costco changes shipped on `main`). Costco stays byte-identical to `main`.
- `homeHeroToClaim` (main's) — its storage mock gains `getStatsAndReceipts`, which the branch's Home uses.
- `detailScreenDeep` (branch's) — a Costco receipt now shows its per-channel claim steps (#519), not the policy
  paragraph; the test asserts those.
- `/health` `checks.priceFeeds` gets a roll-up `status` (like `revenuecat`) so Admin · Health never shows it as
  "unknown"; the public check-set test lists `priceFeeds`. `checks.priceFeeds.bestbuy` is unchanged.
- **Two red tests already on `main`** (its last Full Coverage run, 2026-11-05, failed on exactly these):
  `adminReviewEditing` "edits, adds and removes lines" (#532 made line edits update the total; the test now covers
  that and the hand-typed-total refusal) and `badScanRepairDb` "the admin desk's line editor updates the in-memory
  registry" (its receipt id `r_badscan_desk_<RUN>` collided with the approval-desk test's, which is dated outside
  the window → `expired` → 0 entries written; it now uses `deskedit`). `main` itself still carries both until the
  merge.

**Prod database, checked read-only 2026-11-06:**

| Migration | Prod |
|---|---|
| `0041_national_province` | data present (`NATIONAL` province row); **no ledger row** (still owed) |
| `0042`–`0045_receipt_auto_approval` | applied, in the ledger |
| **`0046_store_admin_preview`** | **NOT applied** — `stores.admin_preview` does not exist. Apply it (by hand; idempotent) **before** deploying a backend built from `main-test-features`, or `GET /api/v1/policies.json` fails |

**Step 7 (paperwork) — done on `docs/bestbuy-reviewer-notes`:** `REVIEWER_NOTES.md` lists Best Buy as the second
active retailer and bestbuy.ca as a read-only price source, plus a "checked once a day" testing note; the reviewer PDF
is re-rendered. **Upload it to App Store Connect only when Best Buy is open to Everyone** — before then the
reviewer would read about a store they can't select.

**The 3 waiting shoppers** (prod `store_launch_subscriptions`, `store_code = 'bestbuy'`, none notified yet) signed up
2026-10-07, 2026-10-22 and 2026-10-27 (two Google accounts, one Apple). Identities are in the database, not here.

Not done, by design: anything on `main`, any prod write, the build/tag/release (cut from `main` after Maxim's
merge), raising the minimum app version, flipping Best Buy to Everyone, `BESTBUY_SCAN_ENABLED`.
