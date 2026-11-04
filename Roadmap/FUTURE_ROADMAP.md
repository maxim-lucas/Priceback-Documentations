# PriceBack — Roadmap by priority

**Re-prioritised 2026-11-04** against `main` @ `adc94e5` (store build **3.5.0 / 58**, tag `v3.5.0`),
production's database and `/health`. Every open row below was checked against the code or prod that day:
**open ✔** = seen open in code/prod · **re-check** = carried over, not re-verified · **✅** = done (cites the PR).

How to work this file:
- **Top to bottom.** P0 before P1, P1 before P2. Nothing in P3 starts while a P0/P1 row is open.
- **P0 and P1 ship as hotfixes**: a `hotfix/<slug>` branch off `main`, one PR each, merged and carried to prod
  (migrations applied to prod *before* the merge: prod deploys automatically once `main`'s CI finishes). P1 rows are server-only, so
  one deploy fixes every installed build. They still follow the backend-compat rule (`Technical/Backend_Backward_Compatibility.md`),
  audited against `v3.5.0..HEAD`.
- **P2 rows change the phone**, so they reach shoppers only with a store build. They are bundled into the next
  release (3.5.1), not hotfixed one by one.
- **Defects outrank this file.** A production bug goes straight to `Operations/Bugs_Common_Fixes.md` and a hotfix.

---

## P0: production risk before the Kickstarter launch (Nov 10, 10:00 ET)

| # | Item | Status 2026-11-04 | What's left |
|---|---|---|---|
| P0-1 | **Prod schema in step with `main`** | ✅ prod ledger = `main` through **0044** (ids 53/54 applied 11-04 after the admin-403 outage). All 21 crons green over 48 h (`job_runs`). | Standing rule: compare the prod ledger with `backend/db/migrations/meta/_journal.json` **before every merge** that carries a migration. ⚠️ Ledger trap: row id 52 holds **0042**'s hash at **0041**'s `when` (1793300000000). When `0041_national_province` reaches `main`, the migrator will skip it (the last `created_at` is 0044's). Insert its ledger row by hand, as `Technical/BestBuy/Price_Feed.md` already says. |
| P0-2 | **RevenueCat on prod** (partner plan codes for Kickstarter rewards, #527, grant through RC) | ✅ prod `/health`: `revenuecat: configured, webhook: configured, syncApi: configured` (supersedes the July "webhook never delivered" note). | Before Nov 10: redeem **one** plan code on a real prod account end to end (code → RC promotional `unlimited` → app shows Unlimited → `partner_attributions.plan_granted_at` set). Generate the reward codes with `scripts/generate-partner-codes.js --per-pack` only after that passes. |
| P0-3 | **Bug #359 queue rows**: 5 corrected $5.00 drumstick drops (4536/4537/4540/4541/4711) | pending in prod | Maxim approves them on the desk. No code. |

---

## P1: server-side hotfixes (one deploy fixes every build)

| # | Item | Status | Fix (server only) | Old builds |
|---|---|---|---|---|
| P1-1 | **Flyer overlay lost on every deploy** (what's left of audit **L5**) | open ✔: `backend/server.js` `FLYER_OFFERS_FILE`/`FLYER_HISTORY_FILE` live only under `DATA_DIR`, and prod has no volume. The watch registry, notify ledger and budgets are already durable (#354, `durableWatchState.js`, `kv_state`). | Rebuild `flyerOffers`/`flyerHistory` at boot from the flyer `price_points` rows (already durable, see the comment at `server.js` ~L647). Keep the files as a local mirror. This closes L5 **without** a Railway Volume, and so without downtime on every deploy. | `/api/check-price` and `/api/flyer/active` keep their shape. Only the data stops vanishing. |
| P1-2 | **D3**: a failed line/receipt delete answers `500 retryable:false`, so the phone drops its queued delete and the line comes back | open ✔: `server.js` `DELETE /api/receipts/:id` and the line-delete route (~L13592, ~L13633) | Answer a deterministic failure retryable, the same as the 503 branch. | Builds that read `retryable` keep the tombstone and retry. That's the queue's existing 503 path, so nothing new. Phone half (keep on any 5xx) is P2. |
| P1-3 | **R1′**: an admin-repaired receipt has the crowd-pool gap the re-read guard closed (#484). A phone that hasn't synced re-files the bad parse's prices on every `/api/watch` | open ✔: `receiptsRepo.crowdCopyGuards` covers `gemini_reread` and shopper edits only | Add admin-repaired receipts (the badScanRepair / desk marker) to the `reread`-style guard: a crowd copy files only when it matches the repaired line's unit price. | Same `/api/watch` request. Refused copies were never shown to the shopper. |
| P1-4 | **Admin price-drop queue**: say why a drop on a shopper-corrected line waits with review off; add a "corrected by the shopper" filter | open (desk follow-up from the re-read work) | Admin screens only (exempt from translation, plain English). | Admin-only, so no shopper build is affected. |
| P1-5 | **D5 server half**: the profile outbox retries a 400 forever | re-check | If the route can name the refused field, return it (additive field) so the P2 phone fix can drop just that one. | Additive response field. |

---

## P2: phone-side fixes → bundle into the next store build (3.5.1)

From `Technical/Device_Server_Sync_Audit_2026-10-23.md` (the High findings shipped in #481–#484, #486). Most harmful first.

| # | Gap | Status | Proposed fix |
|---|---|---|---|
| D3 | Phone drops a queued line delete on a 500 | open ✔ | Keep the entry on any 5xx (server half = P1-2) |
| D1 | A receipt the server refuses for good keeps `syncError`, shown nowhere | open ✔: no screen reads `syncError` | A per-receipt "not backed up" line on the Detail screen (en + fr) |
| D2 | `/api/watch` answer unchecked; an empty list is never sent | open ✔: `priceService.js` returns early when `activeItems.length === 0` and never reads the response | Check the answer; send `[]` when the last watched line goes |
| D12 | `deletedReceiptIds` capped at 500; restore capped at 25 pages | open ✔: `receiptsRepo.deletedIdsForUser({ limit = 500 })` | Page the deleted ids like the receipts (server adds an optional cursor, so additive) |
| D6 | The push-token back-fill reports success without checking the answer | re-check | Return `syncProfileToBackend`'s result |
| D5 | The profile outbox retries a 400 forever | re-check | Drop a field the server refused for good, and report it (needs P1-5) |
| D4 | Claim/watch queue entries expire after 90 days | re-check | Keep a claim until its receipt is gone; a line id makes the retry safe |
| D7 | A file re-upload answered not-retryable is dropped | re-check | Retry on 5xx; a 4xx says why on the Detail screen |
| D8 | A tag-scan photo has no retry | re-check | Queue it like the receipt file |
| D10 | Postal-code edits are fire-and-forget | re-check | Route them through the profile outbox |
| D11 | Preferences compare the phone's clock with the server's | re-check | A server-issued version per write |
| D13 | Photos stay on disk after an account switch | re-check | Delete the account's files in `clearAccountScopedStorage` |
| D14 | A receipt added from the server sorts by its upload time | re-check | Send the phone's scan time with the upload |
| D9 | An offline-scan flush with no `applied` refs cleared every sent ref | ✅ fixed: `purchaseService._flushOfflineScanLogOnce` clears only the refs in `applied[]` | — |
| D15 | Restoring an account in its grace window keeps its receipts deleted | **product decision** | Matches the copy "Your data has been erased". Maxim decides. |

**Release note for 3.5.1:** OTA is unavailable, so every row here reaches only shoppers who update. Once 3.5.1 is
live to 100% in a store, consider raising `MIN_SUPPORTED_BUILD_*` (prod today: Android 52, iOS 52) only if a
row can't be made safe for older builds.

---

## P3: features and launches (Maxim sets the order)

### Best Buy: open to shoppers 🟡
**Code finished (Priceback #504, 2026-10-28)**: the parser ships in every build as an **admin-preview** store.
Prod `BESTBUY_SCAN_ENABLED = false` (checked 2026-11-04). Owed first (`Technical/BestBuy/Price_Feed.md` §"Owed"):
- 🔴 Reviewer notes: **when the store opens to shoppers**, add Best Buy to the third-party services table and
  re-render + re-upload the PDF. Admin-only features are never mentioned in store submissions.
- ✅ PIA: `Publishing-Compliance/PIA/bestbuy-price-feed.md`.
- 🔴 Confirm **Railway** reaches bestbuy.ca: prod `/health?token=` → `checks.priceFeeds.bestbuy`.
- 🔴 Prod drizzle ledger row for `0041_national_province` (see the P0-1 ledger trap).
- Then flip, in this order: prod `BESTBUY_SCAN_ENABLED` (an admin tests the feed on their own receipts), then the
  `stores.enabled` row for shoppers.

### Gemini re-read switch (ships OFF; prod `RECEIPT_GEMINI_REREAD = false`, `RECEIPT_GEMINI_FIRST = false`)
Maxim, 2026-10-22: "all receipts should be read by the server for any builds, if there is a risk of regression we
can drop the concept or force OTA updates if this is the solution. if the risk is high drop that for now but
document it in the roadmap md file". Assessed **moderate**: it shipped behind its own switch with the guards in the
design rules, §7. What can still go wrong once it is on:
- builds 2.8.3–3.1.3 pair lines by **position** when they sync. On a re-read that changes the number of lines, a
  phone-only drop chip or an unsent watch-off can land on the neighbouring line until the next check. Claims cannot
  move: a receipt with a claim is never re-read;
- a phone that registered its watch list before the re-read finished filed crowd copies of the bad parse. The repair
  takes them back once, and the #484 guard stops the next registrations;
- **OTA cannot fix an old build.** A build from 3.0.7 on can be **forced to update** (Admin · App version) once a
  fixed build is live to 100%. 3.0.6 and older can only be asked.

Turn it on from the web console on **dev** first, watch *Read by* on the desk and the Gemini budget on `/health`,
then production. Do P1-3 first: the admin-repair gap is the same class as the re-read gap.

### "Deals this week" feed 🟡
Backend done: `GET /api/flyer/active?region=` (sorted by savings %). **No screen consumes it** (checked
2026-11-04). Needs P1-1 first, or the feed is empty after every deploy. Also open from the old Phase 2: a
DetailScreen badge for the `crowdsourced` complement on `/api/check-price`.

### US receipts (Costco US): price-drop tracking 🔵
**Why it is on the list.** On 2026-10-02 a Quebec customer scanned a receipt from Costco Bayonne, NJ #1334 and was
promised by push: *"Price-drop tracking isn't available yet for US Costco stores. It's coming soon, and we'll notify
you as soon as it's live."* Since that day US receipts are refused (app) and stored unpriced as
`unsupported_country` (server): `shared/receiptCountry.js`, Bugs #304.

**What "live" needs, at minimum:** a USD price pool that never mixes with CAD (price points keyed by
country/currency, not by the shopper's province); US warehouses registered under a US state, not a province; Costco
US's own price-adjustment policy (30 days, same as Canada, but its own claim copy and online form); store
availability (the app is Canada + Egypt only today); and `SUPPORTED_RECEIPT_COUNTRIES` gaining `"US"` only once all
of that exists.

**🔴 Owed on launch:** notify every account holding an `unsupported_country` receipt, at minimum
`002010.0696…0013` (receipts `r_1790986971714_tl5wo`, `r_1790986803639_sgftf`). Query: `select distinct user_sub from
priceback.receipts r join priceback.receipt_statuses s on s.id = r.status_id where s.code in
('unsupported_country')` plus the two ids above (flagged `rejected` before the code existed).

### Canadian "Warehouse Runner" full product 🔵
**Inspiration:** [Warehouse Runner](https://app.warehouserunner.com/) tracks Costco prices across 600+ US warehouses
and alerts on local drops. No Canadian equivalent. PriceBack already has the infrastructure (flyer overlay, receipt
OCR + warehouse ID, crowd contributions, savings harvest, push pipeline). What's left is the **product surface**:
- Warehouse price history visible in-app (read-only).
- "Deals near you" feed (see above).
- Geocoding: warehouse ID → lat/lng for "near me".
- Revenue ideas: free = own warehouse; Pro add-on = all warehouses within 50 km; power tier for cross-province.

### Plan A: LLM OCR reconciliation 🔵
Merged and dormant per `PLAN_AB_ROLLOUT.md`. Plan B is superseded by the flyer overlay + savings harvest as the
primary price source and stays as the complement signal. **Open:** backend env vars + an EAS build to enable the
Profile toggles. Overlaps the Gemini re-read work, so decide whether it is still wanted.

### Ops decisions carried from the 2026-08-07 audit (not code)
- Preview builds tag Sentry `environment: preview`; alerts filtered on `environment:production` don't see them.
- The first production `eas update` must be a no-op bundle verified on a device (moot while OTA is off-plan).

---

## Parked / on hold (don't start without Maxim)

### Abercrombie & Fitch price feed: ⏸ ON HOLD (Maxim, 2026-10-28)

**Status:** adapter built and inert (`backend/lib/abercrombieCatalog.js`, `CANADIAN_STORE_IDS` empty). Held because
A&F has no free, automatic route to its prices that we're willing to build. Detail:
`Technical/Abercrombie/Price_Adapter.md` and `Canadian_Egress_Verification.md`.

**Settled:**
- A&F Canada prices in **CAD** to Canadian shoppers. Maxim saw this in his own browser from Orléans.
- The whole site sits behind **F5 Bot Defense** (formerly Shape). curl, a Node fetch and a headless real Chrome all
  stop at its "Client Challenge" page, from a Canadian home connection as well.

**Ruled out by Maxim:** a paid unlocker or scraping API (no spend), a shopper-run manual check in an in-app browser
(users won't use it), and an A&F affiliate feed (we can't be affiliated).

**Ruled out technically:**
- **A self-built scraper that hides its automation from F5.** That is an arms race against a product built to
  detect exactly that.
- **A shopper-type A&F account used by a cron.** F5 judges the *browser*, not the person. It sits in front of every
  page, the login page included, and stopping automated logins (credential stuffing) is what it is mainly sold for.

**Why Costco is different.** We never beat Costco's wall either: costco.ca is still Akamai-walled to every script.
The routes that work went *around* it: **Same-Day** (Instacart's storefront for Costco, plain GraphQL with a guest
cookie) and the **barcode harvest** in Maxim's real Chrome through Claude in Chrome.

**Free routes left, if this is ever resumed:**
1. **Find A&F's "Same-Day"**: a second front door that publishes A&F Canada's CAD prices without F5. Research only.
2. **A weekly Claude-in-Chrome run** in Maxim's own Chrome for *watched* lines only, submitted through an admin
   endpoint. Free, but it needs Maxim's PC, so it is not an unattended cron.

**Owed whichever route is chosen:** read `data-storeid` off a real Canadian page into `CANADIAN_STORE_IDS`, replace
the derived CAD fixtures with a real capture, and solve product→slug addressing.

### Costco pricing: paid scraper fallback chain
Only if Same-Day becomes unreliable (Maxim: no spend today). Candidates: Unwrangle (pay-per-call, UPC search,
warehouse param), Apify Costco Scraper (pay-per-run), ScrapingBee (1000 free credits). Trigger: Same-Day error rate
>15 % over 24 h. Chain: flyer → Same-Day → Unwrangle → ScrapingBee.

### Flyer parser: "SAVE $N"-only banner tiles
`flyerTextParser.parseFlyerWords` skips tiles with no SKU and no price block (category teasers). Could surface
them as a "category promo" signal in review, never written to `price_points`. Low priority.

### Family sharing (Unlimited tier)
Share receipts across up to 6 household members. Needs a household join model on `users`.

### Advanced analytics (Unlimited tier)
Category breakdown, spending trends, best-value store per category. Data is captured; needs UI.

### Dark mode toggle
Removed in v2.5.0; could return as a proper theme context. Users have asked for it.

---

## Superseded / done (history: read the PRs, don't re-open)

| Item | Outcome |
|---|---|
| iOS first build | Superseded: iOS ships (App Store update gate #440, prod `MIN_SUPPORTED_BUILD_IOS = 52`, Apple + Google iOS sign-in configured on prod `/health`). |
| Barcode database | Superseded by barcode→SKU linking and `services/barcodeLookup` (`fetchExternalName`), plus the admin Barcode Feeder (#498). |
| Receipt photo persistence | Superseded by R2 receipt-photo upload and its retention prune (Bug #108). Re-check only if shoppers report lost photos. |
| Audit 2026-08-07 (13 findings) | All fixed the same day (#242–#246, Website #13; Bugs #149–#154). L5 shrank to P1-1 above. |
| Tax reader (receipt tax codes, product tax class, DB price check) | Merged 2026-10-18/19 (#455, #456, #467; migrations 0028/0029). Design: `Technical/Receipt_Tax_Codes_Estimate.md`. |
| Receipt editing after save; PDF export; Costco weekly-flyer overlay; crowd ≥6-user gate; urgency colours | Shipped May 2026 (`bc37371`). |
| Crowd contribution from scans (old "v3.5" milestone) | Shipped via Plan B + the ≥6-user gate. |

For everything shipped since, read the GitHub releases (`gh release list`): every store version has a tag and
release notes.
