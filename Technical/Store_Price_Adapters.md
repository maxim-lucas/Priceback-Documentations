# Store price adapters

How a non-Costco retailer's current price gets into `price_points`, and how to
add the next one. **Store-neutral by design** — per-retailer specifics live in
that retailer's own folder (`Technical/BestBuy/`, `Technical/Abercrombie/`),
never here.

Companion to `Receipt_Parser_Registry_And_Store_Parsers.md` (the receipt half),
`Flyer-ingestion.md` (Costco's price half) and `priceDrop.md` (what a price
becomes once it is stored).

> **Split note (2026-09-10).** This file was
> `Store_Price_Adapters_And_The_BestBuy_Feed.md` and described the registry and
> Best Buy's feed together. Best Buy's half moved to
> `Technical/BestBuy/Price_Feed.md` under the standing one-store-one-folder rule;
> what remains is the shared architecture every store adapter builds on.

---

## Why this exists

A retailer can have a receipt parser and no price feed — receipts scan, items
save, and then nothing ever re-checks the price, so a drop can never be detected
and never earns a claim. Best Buy was in exactly that state as store #2.

The gap was structural, not an oversight: the **ingestion** architecture was
Costco-only (weekly flyer + crowd scans), while the **parser** architecture was
explicitly multi-store. Nothing bridged them for a second retailer. This registry
is the bridge, built so the third retailer plugs in rather than forks.

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


## Adding the next store

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

### Per-store notes live in that store's own folder

Abercrombie's triage, capture session and adapter design were moved out of this
file on 2026-09-07 and now live in **`Technical/Abercrombie/`**. Standing rule:
one store = one parser file and one documentation folder; never describe two
stores in one document. This file stays Best Buy's, plus the store-neutral
checklist above.

