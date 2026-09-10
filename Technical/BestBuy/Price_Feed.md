# Best Buy — the daily price feed

Best Buy Canada's price adapter (`backend/lib/bestBuyCatalog.js`) and the nightly
job that drives it (`backend/jobs/bestBuyPriceRefresh.js`).

Store-neutral architecture — the adapter contract, the NATIONAL province, the
`scrape` source type, the checklist for adding a store — lives in
`Technical/Store_Price_Adapters.md`. This file is Best Buy's half only.

Companions in this folder: `Receipt_Parser.md` (how a Best Buy receipt is read),
`Integration_Audit_2026-09-10.md` (what was missing end to end, and what was
fixed).

---

## What Best Buy Canada actually publishes

Verified against the live site, 2026-08-31. This is the finding the whole design
rests on, so it is written down rather than left to be rediscovered.

**Best Buy is not walled. Costco is.** That single difference is why this feed
may be a server-side `fetch` on a cron while Costco's flyer needs a real browser
session and a human.

| Probe | Result |
| --- | --- |
| `robots.txt` | `/en-ca/product/` and `/en-ca/category/` **explicitly `Allow`ed**. `/en-ca/search` **`Disallow`ed** — do not crawl it. Sitemap published. No `Crawl-delay`. |
| `GET /api/offers/v1/products/<sku>/offers` | 200, ~300 bytes. `regularPrice`, `salePrice`, `saleStartDate`, `saleEndDate`, `isMarketplace`, `isWinner`, `isOnClearance`, `sellerId`, `sellerNameEn`, per-province `ehf`. **This is the price read.** |
| `GET /api/v2/json/product/<sku>` | 200, the same price fields plus `name`, `categoryName`, `availability`. Heavier; useful for catalogue metadata, not for a nightly price refresh. |
| `GET /api/v2/json/search?query=…` | 100 products/page **with prices**, but **hard-caps between page 20 and 25** (~2,000 results) no matter what `total` claims. |
| `GET /ecomm-api/availability/products?skus=a\|b` | Accepts pipe-separated SKUs — but carries **no price**. There is no batch price endpoint. |
| `sitemap_index.xml` | 38 gzipped sitemaps × ≤50k URLs. `en-ca` and `fr-ca` mirror 1:1 → **~400k unique SKUs**. |

### 🔴 Best Buy's API is SLOW — ~9-10s to first byte

Measured 2026-08-31, repeatedly, across all three endpoints:

```
dns=0.03s  connect=0.08s  tls=0.17s  ttfb=8.5-10.7s
```

DNS, TCP and TLS are all fast, so this is **the far end**, not our network and
not the endpoint choice — offers (442-764 B), product (5-7 KB) and search
(17 KB) all land in the same 8.5-10.7s band. Payload size is irrelevant.

Two consequences, both of which bit during development:

1. **The timeout cannot be the usual 10s.** `SCRAPE_TIMEOUT_MS` is 10_000, and
   an adapter that inherited it failed live SKUs *intermittently* — right on the
   boundary, so it looked like flakiness rather than a misconfiguration, and the
   failures arrive as counted `network_error` rejections (silent data loss)
   rather than as an error anyone sees. The adapter uses **30s**, tunable via
   `BESTBUY_SCAN_TIMEOUT_MS`.
2. **Throughput is latency-bound, not pacing-bound.** At ~10s per request,
   serial, `BESTBUY_SCAN_MAX_SKUS = 500` is roughly **85 minutes** of wall clock.
   That is fine for a nightly job with an overlap guard and no deadline, but it
   is the number to reason about before raising the cap. The 1s politeness pace
   is noise next to the 10s wait.

Worth re-measuring from Railway: this was measured from a laptop, and the same
band may not hold from a datacenter.

### Three consequences

1. **No OCR, no browser, no LLM.** The retailer publishes clean structured JSON.
2. **The catalogue cannot be enumerated by search** (the ~2,000-result cap), and
   mirroring all ~400k SKUs would be ~57k requests/day of mostly third-party
   accessories nobody bought. So the scan is **watchlist-driven**.
3. **`isMarketplace` is load-bearing.** See below.

### 🔴 The marketplace gate

Best Buy does **not** price-adjust items sold by third-party marketplace
sellers. Quoting one sends a shopper to make a claim that gets refused.

This is the same failure class as the receipt parser reading `2210 BANK ST` as
an item costing $22.10: **a plausible wrong number is worse than a visible gap,
because the user acts on it.** Sitemap 1 is dominated by marketplace phone
cases and cables, so this is the common case, not an edge one.

`isMarketplace === false` is required, **and** `sellerId === "bbyca"` must agree.
When the two disagree the offer is refused under its own reason
(`seller_mismatch`) rather than resolved — an unclaimable price is worse than a
missing one, and a distinct reason means an upstream shape change appears in the
run summary instead of hiding.

Provincial `ehf` (environmental handling fees) are a **fee, not the price**, and
are deliberately not folded in.

---


## The daily job

### Targets — a watchlist refresh, not a crawl

Distinct Best Buy SKUs on a **live watched receipt line** (unclaimed, undeleted,
undeleted receipt) whose purchase is still inside the store's adjustment window
(`COALESCE(stores.adjustment_days, 30)` — store-configured, never hardcoded).

Mirrors the `watched` CTE in `findNotifiable` on purpose: the job never fetches a
price the sweep could not act on. Bounded today at a few hundred requests, capped
by `BESTBUY_SCAN_MAX_SKUS`, and it grows only with real users.

Synthetic receipt-line SKUs (`ln:<receiptId>:<idx>`) are excluded at the query —
asking Best Buy for one is a guaranteed 404.

### 🔴 Write-on-change is correctness, not thrift

A row is written only on a first sighting or a **changed** price (compared in
cents, so a float round-trip through `numeric` cannot register a phantom change).

`observed_at` is what the appeared-after-purchase rule (Bugs #64) reads to decide
whether a price became available **after** a shopper bought. One row per actual
change makes `observed_at` mean *"the day this price started"*:

- a price that already dropped **before** the purchase stays ineligible — its
  only row pre-dates the purchase, and the shopper paid the going rate;
- a drop **after** the purchase writes a new row dated after it — claimable.

Re-stamping an unchanged price every night would push `observed_at` forward and
make every old price look like it appeared today — telling **every shopper who
ever paid the current price that it just dropped, and charging each of them
commission.**

A same-day re-run is idempotent regardless: `sourceRef` is
`bestbuy:<YYYY-MM-DD>:<sku>`, so `price_points_source_ref_uq` makes the second
write an ON CONFLICT update of the same row.

### Scheduling — no new cron host

A leg of the existing `_runPriceSweep` in `server.js`, so it inherits the
runtime-tunable cadence, the overlap guard, the boot catch-up (Bug #114) and
`job_runs` history via `trackJob("bestBuyPriceRefresh", …)`. Gated by its own
config pair so it can be paused independently of the legacy scrape leg — the two
read different upstreams and fail for different reasons.

| Key | Default | Meaning |
| --- | --- | --- |
| `BESTBUY_SCAN_ENABLED` | **`false`** | Master switch. **Ships OFF**, same shape as `ADS_ENABLED`. |
| `BESTBUY_SCAN_INTERVAL_MINUTES` | `1440` | Once a day. Floor 15. |
| `BESTBUY_SCAN_MAX_SKUS` | `500` | Hard cap on SKUs per run. |
| `BESTBUY_SCAN_PACE_MS` | `1000` | Delay between requests. |

`BESTBUY_SCAN_DEVICE_ID` (env, default `bestbuy-scan-bot`) is the bot identity
for the app-enforced NOT NULL `device_hash`, exactly as `import-flyer.mjs` mints
`flyer-importer-bot`. Rows under it collapse into the shared `anon` contributor
bucket, which is correct: they verify through `pp.verified`, never by
manufacturing consensus.

### Serving it

`/api/check-price`'s `price_points` branch was hardcoded to
`storeId === "costco"`. It now asks `hasDbPriceFeed(storeId)` — an explicit
**allow-list** of `costco` and `bestbuy`, not "any store". The other `SCRAPERS`
entries (walmart, canadiantire, homedepot, staples, sportchek) still answer from
a live scrape, and this branch returns `null` rather than falling through to one,
so adding a store here that has no feed would silently turn its working price
into "no price".

---


## 🔴 Owed before `BESTBUY_SCAN_ENABLED` is turned on **in production**

> **Amended 2026-09-10.** The list below was written as "before the flag flips",
> full stop. The audit split it by environment, because the two are not the same
> risk and reading them as one is what kept the flag off everywhere:
>
> * **Dev** — flipped ON 2026-09-10. Items 1 and 2 are compliance obligations
>   owed to App Review and to Quebec Law 25 respectively; neither has any force
>   on an internal database with no real users. Item 3 is *verified by* turning
>   it on, not before. The flip is also doubly inert today: dev holds zero Best
>   Buy receipts, so `selectTargetSkus` returns an empty list, and the deployed
>   dev backend still runs `main`, which does not contain the job at all.
> * **Prod** — the list stands unchanged and every item is still owed. Do not
>   flip it. The prod flag writes `verified=true` price points, which reach
>   `priceDropRepo.findNotifiable`, which **charges commission**.

1. **`REVIEWER_NOTES.md` declares exactly one scraping source** (Costco
   Same-Day Delivery, "read-only price scrapes"). Enabling this adds a second
   and needs a row. That file renders to `PriceBack_App_Review_Guide.pdf` via
   `Publishing-Compliance/tools/render-reviewer-guide.js` and **nothing syncs
   the PDF to its source** — re-render and re-upload.
2. **A PIA.** `PUBLISH_CHECKLIST.md` (Quebec Law 25 §3.3) claims a PIA exists
   for every ingestion pipeline the privacy policy references. This is a third
   one. Note it reads *catalogue* data only — no personal information — which
   should make it a short assessment, not an absent one.
3. **Verify Railway egress reaches bestbuy.ca.** The existing `SCRAPERS.bestbuy`
   already calls it from Railway, which is good evidence, but Costco is proof
   that egress can be blocked where a laptop is not.
4. **Apply migration 0007 on production by hand.** Prod's drizzle ledger is
   hand-maintained — never run `db:migrate` there. Apply the DDL and insert the
   hash. Until it is applied the national clauses resolve to `-1` and the feed
   writes nothing usable (fails closed, by design).

   **Audited 2026-09-10 — half done, and the missing half is the ledger, not the
   DDL.** `provinces` carries a real `NATIONAL` row on **both** databases (prod
   id 49640, dev id 383365), so the national clauses resolve and the feed would
   write usable rows. What is missing is the bookkeeping: prod's
   `drizzle.__drizzle_migrations` stops at `0006_auth_outcomes`, dev's stops at
   `0005_object_retention`. Both ledgers therefore under-report what is applied.
   That is not a Best Buy blocker — it is a reconciliation hazard, and the reason
   to fix it is that the next person to ask "is 0007 on prod?" gets `no` from the
   ledger and `yes` from the data. Insert the hashes; do not re-run the DDL.
5. ~~Best Buy is still `enabled: false` and lab-lane.~~ **Done 2026-09-02** —
   the store was promoted off the lab lane and `BESTBUY_SCAN_ENABLED` now
   defaults to `true` in code. Note what that does and does not mean: the
   default only applies where `app_config` has no explicit row, and the store
   the app shows still comes from the `stores` DB row, which is untouched. Both
   remain deliberate production acts.

   🔴 **And both were false in both databases** — discovered 2026-09-10, eight
   days later. `app_config.BESTBUY_SCAN_ENABLED` carried an explicit `false`
   written on 2026-08-31 (dev) and 2026-09-01 (prod), *before* the default was
   flipped — so the code default never applied anywhere, and `stores.enabled`
   was still `false` for `bestbuy` on both. Dev is fixed. **Prod is deliberately
   untouched**: `main` still registers the parser in `LAB_STORE_PARSERS`, so
   enabling the store there would accept Best Buy receipts and parse them with
   the *generic* parser — wrong numbers on a real receipt, which is worse than
   "not supported yet". Prod's store row flips when the parser reaches `main`,
   not before. See `Integration_Audit_2026-09-10.md`.

## The live probe, and what an unfiltered sweep found (2026-09-02)

`npm run bestbuy:probe` (`backend/scripts/bestbuy-quote-probe.js`) fetches SKUs
through `resolvePriceAdapter("bestbuy")` — the adapter, not a raw URL, so what
it prints is what the JOB would have seen, rejections included. `--save <dir>`
writes the raw bodies as fixtures.

Its default SKU list is the **eleven pinned by the real-OCR receipt corpus**, so
it exercises the same products the receipt side already asserts on. That makes
it a check of the mechanism end to end rather than of the API in isolation.

First run: **`quoted=10/11 rejected={"marketplace":1} in 115.1s`**. Captures are
committed under `tests/fixtures/bestbuy-api/live-2026-09-02/` with a README
tabulating receipt price vs live price for every SKU.

Three findings, none of which the four curated fixtures could have produced —
each of those was chosen to demonstrate a rule the adapter already had:

1. **The marketplace gate fired on live data.** `18145276` (Roborock Qrevo Pro)
   is a product a real shopper bought *from Best Buy* whose buy box is now held
   by a third-party seller. Best Buy does not price-adjust those. This is the
   first evidence the most important rule in the adapter works outside a fixture
   written to trip it.
2. **Two bad `validUntil` values, from opposite directions** — a six-year-stale
   `offerEndDate` and a sale-end date on a price already back to regular. Both
   were being stored. **Bugs #237**, fixed in the adapter.
3. **Prices move a lot, and mostly upward.** Nine of eleven rose since purchase;
   `19204882` went $3,699.99 → $5,499.99. A quiet night from the drop sweep is
   the expected case, not a broken feed — worth remembering before debugging one.

### 🔴 A stored `valid_until` is read by only one of its two consumers

The reason (2) mattered enough to fix inside the adapter rather than shrug at:

- `pricesRepo`'s active-offer read filters `valid_until IS NULL OR valid_until
  >= today`;
- `priceDropRepo.findNotifiable` — **the query that charges commission** — does
  not filter on it at all.

A past-dated row is therefore invisible to the display path and still visible to
the money path. Fixing it in `bestBuyCatalog.js` keeps the change off Costco's
live code path entirely; teaching the shared queries about expiry would not.

## Commission is charged exactly once, and that is now pinned

Adding a second store put a second store on the money path for the first time.
The funnel was audited end to end on 2026-09-02 and is singular:

- **one** writer to `price_drop_notifications` (`priceDropRepo.recordNotified`);
- **one** charge site, reached only by the winner of that insert
  (`ON CONFLICT (receipt_item_id, price) DO NOTHING … RETURNING`);
- a **per-item advisory lock**, taken before the prior-minimum read and in
  sorted id order, so the three schedulers that can reach it at once (cron tick,
  post-flyer sweep, `POST /api/me/check-drops`) cannot each bill the full delta;
- **telescoping totals** — `dropChargeCredits(paid − new) − dropChargeCredits
  (paid − prior)` — so an item's lifetime charge is exactly
  `dropChargeCredits(paid − lowest)` however many drops it saw. Per-step
  rounding does not have this property.

The legacy in-memory flyer sweep notifies but never charges.

Two suites hold it: `commissionChargedOnce.test.js` (no DB) pins the *shape*
that makes double-charging impossible — including that no store identifier
appears anywhere in the charge arithmetic — and `commissionAnyStoreDb.test.js`
exercises it end to end for a Best Buy national price, including **three
concurrent sweeps**, which is the only test that actually exercises the advisory
lock (a sequential one passes with the lock deleted).
