# Store price adapters, and the Best Buy daily feed

How a non-Costco retailer's current price gets into `price_points`, and how to
add the next one.

Companion to `Receipt_Parser_Registry_And_Store_Parsers.md` (the receipt half),
`Flyer-ingestion.md` (Costco's price half) and `priceDrop.md` (what a price
becomes once it is stored).

---

## Why this exists

Best Buy was store #2 with a receipt parser and no price feed. Its receipts
could be scanned and their items saved, and then nothing ever re-checked the
price — so a Best Buy price drop could never be detected and never earned a
claim.

The gap was structural, not an oversight: the **ingestion** architecture was
Costco-only (weekly flyer + crowd scans), while the **parser** architecture was
explicitly multi-store. Nothing bridged them for a second retailer. This is the
bridge, built as a registry so the third retailer plugs in rather than forking.

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

## The pieces

```
targets ──► resolvePriceAdapter(storeCode) ──► the store's adapter ──► recordPricePoint
            services/storePriceAdapters.js     lib/bestBuyCatalog.js   repos/pricesRepo.js
```

| File | Role |
| --- | --- |
| `backend/lib/bestBuyCatalog.js` | Best Buy's adapter. **The only file that knows Best Buy's JSON shape.** Injectable `fetchImpl`. |
| `backend/services/storePriceAdapters.js` | The registry + `resolvePriceAdapter` + `hasDbPriceFeed`. |
| `backend/jobs/bestBuyPriceRefresh.js` | The daily job: target selection → paced fetch → write-on-change. |
| `backend/db/migrations/0007_national_province.sql` | The reserved `NATIONAL` province. |
| `backend/tests/fixtures/bestbuy-api/` | Four real captured API responses. |

### The adapter contract

```js
fetchQuote(sku, { fetchImpl, timeoutMs })  => Promise<Quote | Rejection>
fetchQuotes(skus, { fetchImpl, paceMs })   => Promise<Array<Quote|Rejection>>

Quote:     { sku, price, regularPrice, isOnSale, validUntil, isClearance,
             sellerName, currency }
Rejection: { sku, rejected: "<reason>", detail? }
```

Three rules, carried over from the parser registry because each was learned the
expensive way:

1. **Never throw.** A malformed payload, a 404, a timeout — all become a
   Rejection. An adapter that throws takes down the whole night's run.
2. **A rejection is data.** Every reason is distinct and counted. "Silently
   returned nothing" is how an upstream change hides for a month.
3. **Unit prices in the store's own currency.** No tax, fees or shipping.

---

## The NATIONAL province

`price_points.province_id` is NOT NULL and every price read is province-scoped.
That is correct for Costco — warehouse prices genuinely differ by province — and
wrong for every other retailer, which publish one national price.

Two options existed:

1. Fan one price out to all 13 provinces (the flyer's `region:"ALL"` shape).
   13 near-identical rows per SKU per change, each asserting something false —
   that we observed a *Manitoba* price.
2. Reserve one province meaning "everywhere".

**We chose (2).** Reserved by **code** (`"NATIONAL"`), not by a hardcoded
`id = 0`: `provinces.id` is a serial, so a literal would fight the sequence and
still need a real row to satisfy the FK. Reserving the code means
`recordPricePoint({ province: "NATIONAL" })` resolves through the existing
`resolveProvinceId` — **no schema change, and no write-path special case at
all.** "NATIONAL" is eight characters, so it cannot collide with a
two-character ISO 3166-2 subdivision.

### The cost: four province-scoped reads had to learn it

| Location | Change |
| --- | --- |
| `priceDropRepo.getLatestVerifiedPrice` | `province_id = $p` → `IN ($p, $national)` |
| `priceDropRepo.findNotifiable` — buyer join ⚠️ | `u.province_id = v.province_id` → also match a national row |
| `priceDropRepo.findNotifiable` — region scope | region-scoped sweep still sees national rows |
| `priceDropRepo.findNotifiable` — `provinces` join | reordered below `users` so a national row reports the **buyer's** province, not the sentinel |

⚠️ **`findNotifiable` is the query that charges the commission.** It joins a
price row's province to the *buyer's* province, so a national row matched no
buyer until this changed. It is the riskiest edit in the whole feature.

Two things make it safe:

- `nationalProvinceId` resolves to **`-1` when migration 0007 has not been
  applied**, which makes every clause referencing it dead and the functions
  byte-identical to their previous behaviour.
- The predicates only ever **widen** (`= x` → `IN (x, national)`), and no Costco
  row is ever written with the national province, so no Costco result set can
  change. Verified: the 60-test money-query baseline passes unchanged, including
  *"a price in another province is not returned"*.

**Paying this once buys it for every future national retailer.**

---

## The `scrape` source type was seeded but orphaned

`scrape` has existed in `price_source_types` since the v2 schema, with **no
writer** — and, more quietly, in neither `CROWD_SOURCE_CODES` nor
`ADMIN_SOURCE_CODE` and in neither `srcRank` CASE. A scraped row would have been
written and then **never served, never swept, never notified.**

- New `MACHINE_SOURCE_CODES = ["scrape"]`, included in `allSourceIds`.
- Deliberately **not** in `CROWD_SOURCE_CODES` — that list drives
  `markNewlyVerified`'s rule-of-N stamp, and crowd consensus is meaningless for
  a first-party reading. Three shoppers agreeing adds nothing to what the
  retailer itself published.
- Ranked **below flyer**:

  | rank | source |
  | --- | --- |
  | 1 | `flyer`, `flyer_user_scan` |
  | **2** | **`scrape`** |
  | 3 | `price_tag_scan` |
  | 4 | `receipt_ocr` |

  A flyer price was uploaded and checked by a human against the printed page; a
  scrape is a machine reading an API whose shape can change without notice. When
  both exist for one product the human-checked price wins, **even though the
  scrape is fresher and possibly cheaper.**

### `recordPricePoint` gained a `verified` param

It previously neither accepted nor set `verified`, so passing the flag was
**silently ignored** — the feed would have looked verified in the code and not
been in the database. An exported guard that nothing calls is not a guard; a
parameter nothing reads is the same bug. The param is additive and defaults to
`false`, so every existing caller is unchanged.

Only sources authoritative **by construction** may pass it. Crowd and receipt
rows must never: their entire verification model is N distinct shoppers
agreeing, and setting this opts out of it.

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

## Adding the next store (Abercrombie, …)

1. **Read the store's `robots.txt` first and write down what it allows.** This
   feed exists because `/en-ca/product/` is Allowed and there is nothing to
   defeat. Costco needs a human and a real browser because it is Akamai-walled.
   Which of the two a retailer is decides whether it gets an adapter at all.
2. Write `backend/lib/<store>Catalog.js` against the contract, with an
   injectable `fetchImpl`.
3. Add one line to `PRICE_ADAPTERS`.
4. **Capture real API responses as fixtures and pin them.** Synthetic payloads
   prove the rules; only captures prove the rules apply. The Best Buy *receipt*
   parser passed 1,070 synthetic tests and got all nine real receipts wrong. The
   same trap exists here.
5. **Work out the store's marketplace-gate equivalent before shipping** —
   whatever separates a price the shopper can actually claim from one they
   cannot. Every retailer has one and it is never optional.
6. Add the store to `hasDbPriceFeed` **only** once it actually has a feed.

### Abercrombie, spot-checked

Same shape as Best Buy: product pages not disallowed, a published sitemap
(`Allow: /api/ecomm/util/sitemap/*`), and an `/api/ecomm/` JSON namespace.
`abercrombie.ca` redirects to `abercrombie.com/shop/ca/`, so a Canadian
storefront exists. It is a viable next adapter — but nothing has been captured
or verified beyond `robots.txt`, and step 4 above applies in full.

---

## 🔴 Owed before `BESTBUY_SCAN_ENABLED` is turned on

The feature ships inert, so none of these are owed **yet**. All of them are owed
before the flag flips.

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
5. Best Buy is still `enabled: false` and lab-lane. Promoting the *store* is a
   separate decision from enabling the *feed*.
