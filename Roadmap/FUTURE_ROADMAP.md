# PriceBack — Future Roadmap

Status legend: **✅ SHIPPED** · **🟡 PARTIAL** · **🔵 OPEN**

When picking up the next round of work, **skip everything tagged ✅** and use it
as already-baseline. Treat 🟡 items as candidates for completion before any new
🔵 work is started.

> **Defects take priority over this file.** The register is
> [`App_Audit_2026-08-07.md`](./App_Audit_2026-08-07.md) — a whole-app path + bug
> audit at `66a14e4` / v2.8.4: 0 Critical, 2 High, 4 Medium, 7 Low.
>
> **All 13 findings were fixed the same day** (Priceback #242–#246,
> Priceback-Website #13; write-ups in `Operations/Bugs_Common_Fixes.md`
> **#149–#154**). The audit document is now a *history* of what was found, not a
> to-do list — read it for the reasoning, not for outstanding work.
>
> **One item is NOT closed: L5.** `DATA_DIR` is unset in `backend/railway.json`,
> so the price-watch registry, the notify dedupe ledger and the flyer overlay may
> be sitting on ephemeral container disk. It is an ops action, not a code change:
> mount a Railway Volume on **both** the production and development services, set
> `DATA_DIR` to its mount path, then confirm `GET /health` + `x-admin-token` →
> `checks.storage.status` reads `volume`. Do that before anything below.
>
> Two consequences of the fixes that need a human decision, not a commit: preview
> builds now tag Sentry `environment: preview` (alerts filtered on
> `environment:production` stop seeing them), and the first production
> `eas update` must be a no-op bundle verified on a device — H1 activated a
> delivery path that has never carried traffic, and store binaries up to 2.8.3
> can never receive one at all.
>
> ⚠️ **This file itself is stale.** Its "recently shipped" table stops at
> 2026-05-20 and it cites a 187-test suite that has since grown into the
> thousands. Treat the ✅ table as a floor, not as current state, until it is
> rewritten (see §7 of the audit).

---

## ✅ Recently shipped — skip in next rounds

| Item | Commit / date | Notes |
|---|---|---|
| **Receipt editing after save** | `bc37371` · 2026-05-20 | DetailScreen editor extended (qty, warehouseId, "+ Add item"). `addItemToReceipt` helper + 6 tests. |
| **PDF export — full** | `bc37371` · 2026-05-20 | `exportClaimsAsPdf({ range })` accepts month / quarter / year / all. Profile modal: range chip group + contextual pickers. 5 tests. |
| **Costco weekly-flyer overlay** | `bc37371` · 2026-05-19 | `flyerPricing.js` module, `/api/flyer/import`, `/api/flyer/active`, /api/check-price priority flyer → sameday → (crowdsourced as parallel signal), append-only price history, 103-item Ontario flyer JSON. 12 tests. |
| **Crowdsourced ≥6-user gate** | `bc37371` · 2026-05-19 | `MIN_DISTINCT_USERS_FOR_ALERT=6` — crowdsourced data only attaches to /api/check-price when ≥6 distinct devices have contributed. Median is still computed; just not broadcast below the threshold. |
| **Urgency colour codes** | `bc37371` · 2026-05-19 | Green / yellow / red tied to fraction of adjustment window remaining (>2/3, 1/3–2/3, <1/3). `priceDropUrgency()`, `COLORS.urgency`, applied across Home / Receipts / Detail / push titles. |
| **Audit pass #5** | `bc37371` · 2026-05-19 | province now flows through /api/watch, flyer import items cap, constant-time admin token, daily prune cron, scrape cron skips flyer-covered SKUs to avoid double-notify. |
| **iOS build prep** | `bc37371` · 2026-05-20 | `expo-apple-authentication` added, `usesAppleSignIn`, `googleClientIdIos` placeholder, `signInWithGoogle` passes iOS client. Still needs GCP iOS OAuth client + GoogleService-Info.plist before first build. |

Total since last roadmap touch: **187/187 mobile + 47/47 backend tests passing**.

---

## 🟡 Partial — finish before new 🔵 work

### Warehouse-pricing Phase 2 — UI surface
**Status:** Backend done (flyer + crowdsourced complement + priority chain), mobile lookup wired. **Missing:**
- "Deals this week" feed in the app — `getActiveFlyerOffers(region)` helper exists in `priceService.js` but no screen renders it yet.
- DetailScreen badge for the new `crowdsourced` complement field on /api/check-price (currently only the old "From your warehouse · N obs" chip path is wired).

### iOS first build
**Status:** All code-side prep landed in `bc37371`. **Missing user-side prep before EAS / local build:**
1. `npm install` so `expo-apple-authentication@~8.0.0` lands in `node_modules/`.
2. GCP → create iOS OAuth client for `com.priceback`. Paste client ID into `app.json` `extra.googleClientIdIos`.
3. Download `GoogleService-Info.plist` from GCP, drop in repo root.
4. App Store Connect → enable "Sign In with Apple" capability on the bundle ID.
5. `eas build --platform ios --profile preview` (needs macOS or EAS cloud; local iOS build isn't possible from Windows).

### Plan A + Plan B production rollout
**Status:** Both merged + dormant per `PLAN_AB_ROLLOUT.md`. Plan B is now superseded by the flyer overlay as the *primary* Costco price source (see strategy memo); Plan B remains as the complement signal. Plan A (LLM OCR reconciliation) is still useful and untouched.

**Open:** Backend env vars + new EAS build to enable the Profile toggles.

---

### Best Buy — open to shoppers 🟡

**Code finished (Priceback #504, 2026-10-28)**: the parser ships in every build as an
**admin-preview** store. Admins scan it in production, shoppers see "Coming soon". Opening
it to shoppers is Maxim's call. What has to be true first (`Technical/BestBuy/Price_Feed.md`
§"Owed"):

- 🔴 Reviewer notes: **when the store opens to shoppers**, add Best Buy to the third-party
  services table and re-render + re-upload the PDF. Admin-only features are never
  mentioned in store submissions, so nothing changes while it is admin-only.
- ✅ PIA: `Publishing-Compliance/PIA/bestbuy-price-feed.md`.
- 🔴 Confirm **Railway** reaches bestbuy.ca: prod `/health?token=` →
  `checks.priceFeeds.bestbuy`. From Canada the API still answers (2026-10-28).
- 🔴 Prod drizzle ledger row for `0041_national_province`. The data is already there; hash
  in `Price_Feed.md`.
- Then flip, in this order: prod `BESTBUY_SCAN_ENABLED` (an admin tests the feed on their
  own receipts), then the `stores.enabled` row for shoppers.

## 🔵 Open — not yet started

### Abercrombie & Fitch price feed — ⏸ ON HOLD (Maxim, 2026-10-28)

**Status:** adapter built and inert (`backend/lib/abercrombieCatalog.js`,
`CANADIAN_STORE_IDS` empty). Held because A&F has no free, automatic route to its prices
that we're willing to build. Detail: `Technical/Abercrombie/Price_Adapter.md` and
`Canadian_Egress_Verification.md`.

**Settled:**
- A&F Canada prices in **CAD** to Canadian shoppers. Maxim saw this in his own browser
  from Orléans.
- The whole site sits behind **F5 Bot Defense** (formerly Shape). curl, a Node fetch and a
  headless real Chrome all stop at its "Client Challenge" page, from a Canadian home
  connection as well.

**Ruled out by Maxim:** a paid unlocker or scraping API (no spend), a shopper-run manual
check in an in-app browser (users won't use it), and an A&F affiliate feed (we can't be
affiliated).

**Ruled out technically:**
- **A self-built scraper that hides its automation from F5.** That is an arms race against
  a product built to detect exactly that.
- **A shopper-type A&F account used by a cron.** F5 judges the *browser*, not the person.
  It sits in front of every page, the login page included, and stopping automated logins
  (credential stuffing) is what it is mainly sold for. A login would pass through the same
  wall first, gain nothing, and put the account at risk of a ban.

**Why Costco is different.** We never beat Costco's wall either: costco.ca is still
Akamai-walled to every script. The two routes that work went *around* it.
- **Same-Day** reads Instacart's own storefront for Costco (`sameday.costco.ca`, plain
  GraphQL with a guest cookie). It is a second front door with no wall, and it powers the
  nightly cron.
- The **barcode harvest** runs in Maxim's real Chrome through Claude in Chrome: a person's
  real browser, run by hand on a schedule, not a server.

**Free routes left, if this is ever resumed:**
1. **Find A&F's "Same-Day"**: a second front door that publishes A&F Canada's CAD prices
   without F5 (a partner storefront or marketplace listing). Research only. Nothing is
   known to exist yet.
2. **A weekly Claude-in-Chrome run** in Maxim's own Chrome, the barcode-harvest pattern.
   It opens the A&F page for each *watched* line only (a live check, as with Best Buy; no
   catalogue stored), reads the price, and submits it through an admin endpoint. It is
   free, but it needs Maxim's PC and Chrome, so it is not an unattended cron.

**Owed whichever route is chosen:** read `data-storeid` off a real Canadian page into
`CANADIAN_STORE_IDS`, replace the derived CAD fixtures with a real capture, and solve
product→slug addressing (a receipt prints ids, the page URL needs a slug).

### Costco Pricing Accuracy — Phase 3 (paid scraper fallback chain)

> Note: Phase 2 reframed as the *flyer overlay* (shipped). This is now the
> NEXT step — a paid-API fallback when both flyer and sameday miss.

If sameday scraping ever becomes unreliable, fall back to a commercial API.
All are paid but handle anti-bot / CAPTCHA / page-structure churn for us.

| Service | Pricing | Pros | Cons |
|---|---|---|---|
| [Unwrangle](https://docs.unwrangle.com/costco-product-data-api/) | Pay-per-call | Search + product detail, UPC in search API, warehouse ID param | Paid |
| [Apify Costco Scraper](https://apify.com/sovereigntaylor/costco-scraper/api) | Pay-per-run | Search + detail + warehouse pages, member-only status | Paid |
| [ScrapingBee](https://www.scrapingbee.com/scrapers/costco-scraper-api/) | 1000 free credits | Easy setup, CA/US/UK | Paid after trial |

**Decision criteria:**
- Stay on sameday at low volume (free, current approach).
- Add a provider fallback chain after flyer: flyer → sameday → Unwrangle → ScrapingBee.
- Monitor sameday error rate. If >15% over 24h, auto-switch to paid provider.

**Sketch:**
```js
async function costcoLookup(sku, name, warehouseId, province) {
  const flyer = getActiveFlyerPrice(province, sku);  // ✅ shipped
  if (flyer) return flyer;
  try { return await scrapeSameday(sku, warehouseId); }
  catch { /* fall through */ }
  if (process.env.UNWRANGLE_KEY) {
    try { return await scrapeViaUnwrangle(sku, warehouseId); } catch {}
  }
  if (process.env.SCRAPINGBEE_KEY) {
    try { return await scrapeViaScrapingBee(sku); } catch {}
  }
  return null;
}
```

---

### Canadian "Warehouse Runner" full product

**Inspiration:** [Warehouse Runner](https://app.warehouserunner.com/) tracks
Costco prices across 600+ US warehouses and alerts on local drops.

**Canadian opportunity:** No equivalent for the Canadian market.
PriceBack already has the heavy infrastructure done (✅ flyer overlay,
✅ receipt OCR + warehouse ID, ✅ crowdsourced contributions, ✅ push pipeline).
What's left is the **product surface**.

#### Timeline (revised after flyer overlay shipped)

- **v3.0** — Warehouse price history visible in-app (read-only). Now feasible because `flyerHistory.json` already persists every flyer price observation.
- **v3.5** — ✅ Opt-in crowd contribution from scans *(shipped via Plan B + ≥6-user gate)*.
- **v4.0** — Dedicated "Deals near you" feed (🟡 backend ready, mobile screen still 🔵), push alerts for local price drops (✅ shipped via flyer sweep).

#### Revenue models still to consider
- Free tier: see prices at your warehouse only.
- Pro tier (add-on): see prices at all warehouses in a 50 km radius.
- Higher tier ($19.99/mo) for power users / cross-province comparisons.

#### Still required for the full vision
- Geocoding: warehouse ID → lat/lng for "near me" features.
- Outlier detection for OCR'd prices (prices 10× the median get flagged) — minimal version already present in `warehousePricing.js` (±30% off the high-confidence median).
- Per-region flyer ingestion beyond Ontario (currently only ON; QC / BC / AB etc. each need their own weekly upload).

---

### US receipts (Costco US) — price-drop tracking 🔵

**Why it is on the list.** On 2026-10-02 a Quebec customer scanned a receipt from
Costco Bayonne, NJ #1334 and was promised by push: *"Price-drop tracking isn't
available yet for US Costco stores. It's coming soon, and we'll notify you as soon
as it's live."* Since that day US receipts are refused (app) and stored unpriced as
`unsupported_country` (server) — `shared/receiptCountry.js`, Bugs #304.

**What "live" needs, at minimum:** a USD price pool that never mixes with CAD
(price points keyed by country/currency, not by the shopper's province); US
warehouses registered under a US state, not a province; Costco US's own
price-adjustment policy (30 days, same as Canada, but its own claim copy and
online form); store availability (the app is Canada + Egypt only today); and
`SUPPORTED_RECEIPT_COUNTRIES` gaining `"US"` only once all of that exists.

**🔴 Owed on launch:** notify every account holding an `unsupported_country`
receipt — at minimum `002010.0696…0013` (receipts `r_1790986971714_tl5wo`,
`r_1790986803639_sgftf`). Query: `select distinct user_sub from priceback.receipts r
join priceback.receipt_statuses s on s.id = r.status_id where s.code in
('unsupported_country')` plus the two ids above (flagged `rejected` before the code
existed).

### Sync integrity: deferred (audit 2026-10-23) 🔵

From `Technical/Device_Server_Sync_Audit_2026-10-23.md`. The High findings shipped (Priceback #481–#484 and #486). These are the rest, most harmful first. Each is a phone-side change, so it reaches shoppers
only with a store build; the server-side half is noted where one exists.

| # | Gap | Proposed fix |
|---|---|---|
| D9 | An offline-scan flush whose answer names no `applied` refs clears every sent ref (`purchaseService._flushOfflineScanLogOnce`) | Clear only the refs the server lists; an empty list clears nothing |
| D3 | A 500 on the line-delete route answers `retryable:false`, so the phone drops its queued delete and the line comes back | Server: answer 500 as retryable; phone: keep the entry on any 5xx |
| D1 | A receipt the server refuses for good keeps `syncError`, shown nowhere | A per-receipt "not backed up" line on the Detail screen (en + fr) |
| D6 | The push-token back-fill reports success without checking the answer | Return `syncProfileToBackend`'s result |
| D5 | The profile outbox retries a 400 forever | Drop a field the server refused for good, and report it |
| D2 | `/api/watch` answer unchecked; an empty list never sent | Check the answer; send `[]` when the last watched line goes |
| D4 | Claim/watch queue entries expire after 90 days | Keep a claim until its receipt is gone; a line id makes the retry safe |
| D7 | A file re-upload answered not-retryable is dropped | Retry on 5xx; a 4xx says why on the Detail screen |
| D8 | A tag-scan photo has no retry | Queue it like the receipt file |
| D10 | Postal-code edits are fire-and-forget | Route them through the profile outbox |
| D11 | Preferences compare the phone's clock with the server's | A server-issued version per write |
| D12 | `deletedReceiptIds` capped at 500; restore capped at 25 pages | Page the deleted ids like the receipts |
| D13 | Photos stay on disk after an account switch | Delete the account's files in `clearAccountScopedStorage` |
| D14 | A receipt added from the server sorts by its upload time | Send the phone's scan time with the upload |
| D15 | Restoring an account in its grace window keeps its receipts deleted | **Product decision**, matches the copy "Your data has been erased" |
| R1′ | An **admin repair** has the same crowd-pool gap the re-read guard closed (#484): a phone that has not synced re-files the bad parse's prices | Extend `crowdCopyGuards` to admin-repaired receipts |

**Gemini re-read: residual risks (the switch ships OFF).** Maxim, 2026-10-22: "all receipts should be read by the
server for any builds, if there is a risk of regression we can drop the concept or force OTA updates if this is the
solution. if the risk is high drop that for now but document it in the roadmap md file". Assessed **moderate**: it
shipped behind its own switch with the guards in the design rules, §7. What can still go wrong once it is on:
- builds 2.8.3–3.1.3 pair lines by **position** when they sync. On a re-read that changes the number of lines, a
  phone-only drop chip or an unsent watch-off can land on the neighbouring line until the next check. Claims cannot
  move: a receipt with a claim is never re-read;
- a phone that registered its watch list before the re-read finished filed crowd copies of the bad parse. The repair
  takes them back once, and the #484 guard stops the next registrations;
- **OTA cannot fix an old build.** OTA needs EAS Enterprise, and even then reaches only the same binary version
  (`runtimeVersion.policy = appVersion`). A build from 3.0.7 on can be **forced to update** (Admin · App version)
  once a fixed build is live to 100%. 3.0.6 and older can only be asked.

Turn it on from the web console on **dev** first, watch *Read by* on the desk and the Gemini budget on `/health`,
then production.

**Small follow-ups found on the way:** the admin *Price-drop queue* doesn't say why a drop on a shopper-corrected
line waits with review off. There is also no desk filter for "corrected by the shopper"; the receipt detail shows
it.

### 🔵 Other parked ideas

#### ✅ Tax reader: fill a missing tax from receipt tax codes, product tax class, price check — MERGED 2026-10-19
- Costco prints a tax letter per line (`FP`/`F` in QC, `H`/`G` in ON, `Y`/`B`/`N` on digital receipts), and the
  receipt prints each tax separately. A separate reader takes the letters from the OCR as received (the parser loses
  them during denoise) and checks them against the printed taxes.
- **Scope (Monica, 2026-10-18):** only a helper. When the scan read no tax (missing, or 0 while a line carries a
  code), the reader fills the printed tax the codes confirm, or the tax the codes give when no printed tax can be
  read. A tax the scan read is never replaced.
- **Merged:** Priceback PR #455 (2026-10-18). On the corpus it closes on 56 of 138 fixtures, always on the paper's
  tax; one golden fixture changes (c88: no tax → 7.49, the paper's).
- **Merged 2026-10-19:** each line's tax class (federal, provincial, both, none) is saved, so the database learns each
  product's tax per province (PR #467, migration `0029`), and a "Check price in database" button in the scan review
  fills a line from the database and flags it for the admin (PR #456, migration `0028`). Design:
  `Technical/Receipt_Tax_Codes_Estimate.md` §0 and §11. The app side ships with the next build.

#### 🔵 Flyer parser — "SAVE $N"-only banner tiles
- The geometry flyer parser (`backend/services/flyerTextParser.parseFlyerWords`,
  shipped 2026-06-26) extracts every tile that has an item number **and** a
  readable price block. Some flyer tiles are pure marketing banners — a big
  "SAVE $100" headline with **no SKU and no `was/-savings/promo` block** (e.g. a
  category teaser pointing at Costco.ca). These are intentionally **skipped** for
  now (no SKU = no `price_points` join key; no price = nothing to record).
- Future: optionally surface them as a separate "category promo" signal (banner
  text + savings headline + the section's valid-from/until), shown in review but
  not written to `price_points`. Low priority — they carry no per-item price.

#### ✅ ~~PDF export~~ — SHIPPED 2026-05-20
Annual + month/quarter/all-time PDF reports via `expo-print`. See `src/services/exportService.js`. Profile → Export Data.

#### 🔵 Family sharing (Unlimited tier)
- Share receipts across up to 6 household members
- Already listed as Unlimited tier feature in `purchaseService.js`
- Needs: real auth/user accounts beyond local — `users.json` backend table exists but no household join model
- Requires backend user schema redesign

#### 🔵 Advanced analytics (Unlimited tier)
- Category breakdown, spending trends, best-value-store-per-category
- Already listed in `purchaseService` features
- Most data already captured; needs UI work

#### 🔵 Receipt photo persistence
- Currently images live in app cache (lost on reinstall)
- Copy to permanent storage via `expo-file-system`'s persistent directory
- Low priority — receipts don't usually need viewing after claiming

#### 🔵 Barcode database
- `BarcodeScanScreen` lets users enter barcodes but doesn't look up product info
- Future: hit UPC database API (upcitemdb.com or similar) to auto-fill product name
- Would make barcode scanning much smoother

#### ✅ ~~Receipt editing after save~~ — SHIPPED 2026-05-20
DetailScreen editor now covers item name / price / qty / sku, header date / total / tax / warehouseId, and "+ Add item". See commit `bc37371`.

#### 🔵 Dark mode toggle
- Removed in v2.5.0 but can come back as proper theme context with full re-render
- Users have asked for this
