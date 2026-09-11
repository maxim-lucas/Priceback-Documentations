# Sport Chek — the price feed

`backend/lib/sportChekCatalog.js`. **Built, tested, and inert by design.**

Store-neutral architecture — the adapter contract, the NATIONAL province, the
`scrape` source type — lives in `Technical/Store_Price_Adapters.md`. The
procedure for any store is `Technical/Adding_A_New_Store.md`.

---

## The short version

Sport Chek **cannot** have an automatic price feed today, for a reason that has
nothing to do with permission and everything to do with three separate walls:

| # | Wall | Status |
| --- | --- | --- |
| 1 | The receipt's identifier does not address the catalogue | 🔴 **blocking**, needs a resolver |
| 2 | Node cannot reach sportchek.ca at all | 🔴 **blocking**, needs a different transport |
| 3 | The price is not on any record we can reach for multi-SKU products | ⚠️ partial — single-SKU products do quote |

The adapter is registered in `PRICE_ADAPTERS` and **absent from
`hasDbPriceFeed`**, exactly as Abercrombie's is: listing it would turn "no feed
yet" into "this store has no price", which is a regression, not a feature.

---

## What was measured (2026-09-11)

> ⚠️ **This verdict was corrected twice, in both directions.** The first probe
> said "Akamai-walled like Costco" and was wrong; the correction said "not walled,
> like Best Buy" and was also wrong. Both errors came from stopping the probe one
> step early. The sequence is written out below so the next store's investigation
> runs all of it.

| Probe | Result |
| --- | --- |
| any URL, **User-Agent only** | **403** Akamai (`errors.edgesuite.net`) |
| same URLs, **full browser header set, via curl** | **200** |
| same URLs, **full browser header set, via Node `fetch`** | **403**, Akamai "Access Denied" |
| `robots.txt` | Disallows only cart, checkout, account, banners, modals. **Product, category and search are allowed.** Publishes a sitemap and an `llms.txt`. |
| `sitemap_Product-en_CA-CAD-{1,2}.xml` | the catalogue **is** enumerable — 42,912 URLs in file 1 alone. PDP shape `/en/pdp/<slug>-<8-digit>f.html`. |
| a PDP's HTML | **no price, and no Product JSON-LD** — the two `ld+json` blocks are `WPHeader`/`WPFooter` navigation |
| the PDP's markup | carries the whole API catalogue: `apimEndPointPriceAvailability`, `apimEndPointSearch`, and the `Ocp-Apim-Subscription-Key` the front end sends |
| `/api/v1/search/v2/search`, cold | **403** |
| same, after one HTML page load for `_abck`/`bm_sz`/`ak_bmsc` | **200**, real JSON |
| `/v1/product/api/v2/product/sku/PriceAvailability` | **403** at the edge, GET and POST alike, cookies or not |

### 🔴 Wall 2: curl is not Node

The two requests, issued seconds apart, with a byte-identical header set:

```
curl  https://www.sportchek.ca/en.html  → 200
node  fetch(same url, same headers)     → 403, Akamai "Access Denied"
```

Adding `Accept-Encoding` changes nothing. Akamai Bot Manager fingerprints the
client **below the header layer** — TLS ClientHello, HTTP/2 framing — and
undici's fingerprint is refused where curl's is not.

**The nightly job runs on Node.** So every capture in
`backend/tests/fixtures/sportchek-api/live-2026-09-11/` is evidence about the
*catalogue* and is **not** evidence that Railway could fetch it. `npm run
sportchek:probe` reports `warmup_http_403` on every row today, which is the
honest state.

This puts Sport Chek on the **Costco** side of the line rather than the Best Buy
side — but for a different reason than Costco, and the distinction matters:
`robots.txt` permits everything this feed would do. The obstacle is a bot-
detection gate, not a policy.

### 🔴 Wall 1: the addressability gap

A Sport Chek receipt prints the product's **UPC**. Sport Chek addresses its own
catalogue by a **9-digit SKU code** under an 8-digit family code.

```
search?q=334488188      → 200, redirectUrl → /en/pdp/…-83111944f.html   ✓ exact
search?q=627555628505   → 200, resultCount 0, redirectUrl null          ✗
search?q=0627555628505  → 200, resultCount 0                            ✗
```

The UPC appears in **no** response body. So the adapter is keyed on the SKU code
and rejects a UPC up front under `upc_not_addressable` — refused without
spending a request, and counted. That reason is the most useful thing the run
summary can say, because today **every** Sport Chek receipt line carries a UPC
and nothing else: a silent miss would read as "the feed found no drops", which is
false.

**A free-text fallback was never an option.** `q=diamondback motown` returns
`resultCount: 100` and three different Diamondback bikes. Picking one means
guessing which bike a shopper bought, and the wrong guess is a price the store
will never match, filed against a real purchase.

Closing this is its own piece of work. The `products.barcode` harvester is the
precedent.

### Wall 3: the price is on the variant

| Family | Product | `currentPrice` | `badges` |
| --- | --- | --- | --- |
| `83111944F` | Diamondback Motown 27.5" — **the receipt's own product** | `null` | `["CLEARANCE"]` |
| `83111936F` | Diamondback Expresso (multi-SKU) | `null` | — |
| `83130274F` | Diamondback Speedtrail (single-SKU) | `{value: 669.99}` | — |

A **single-SKU** product quotes end to end. A multi-SKU family carries its price
per variant, and reading that needs `PriceAvailability`, which is edge-blocked.
The adapter returns `price_requires_pdp_api` — its own reason, so the run
summary measures exactly how much of the catalogue this costs.

---

## 🔴 The claim gate

From the published policy (`/en/customer-service/policies/pricing.html`, read
2026-09-11): **15 days** — which matches `stores.js`, now verified rather than
assumed. Adjustments are **refused** on:

> demo products · third-party offers · advertising errors · rebates · coupons ·
> free or combined offers · limited-time offers · flash sales · special pricing
> events (VIP, Friends & Family, Black Friday, Cyber Monday, Boxing Day) ·
> **closeout** · **liquidation**

The catalogue exposes these as `badges`, and the **first real product this
adapter was pointed at carries `CLEARANCE`** — so the gate is the common case,
exactly as `isMarketplace` turned out to be for Best Buy. `EXCLUDED_BADGE_RE`
matches the policy's vocabulary rather than one spelling, and the check runs
**before** the price is read: an excluded item has a price and is not claimable,
and that combination must never become a quote.

---

## 🔴 Two money-path questions, both open

Neither is a coding question and neither can be answered here.

**1. Is a sportchek.ca price admissible evidence for an in-store purchase?** The
policy says price-matching "applies only to retail store locations, not to online
orders at SportChek.ca". The adapter reads the *website*. If a web price cannot
support an in-store claim, a Sport Chek drop must not charge commission — and
`priceDropRepo.findNotifiable` is the query that charges it. **Product decision,
owed before any row is written.**

**2. Is the price national or store-scoped?** Every call takes a store
(`storeId=330`), and the site picks a default — its own analytics reported
`store_id: 383, SC ST. JOHN'S - STAVANGER, Newfoundland and Labrador` for an
unlocated visitor. If the price moves with the store, the reserved `NATIONAL`
province is **wrong** here and `findNotifiable` would join a national row to the
wrong buyers. **Measure it** (the same SKU at two store ids) before the feed
writes anything.

---

## Owed, in order

1. **A transport whose fingerprint is a browser's.** Nothing else can start
   until a Node process can reach the host. Options, cheapest first: re-measure
   from Railway (a different egress may or may not help — it will not change the
   TLS fingerprint, so expect no); a headless-browser fetch for this store only;
   or accept that Sport Chek is crowd-priced like Costco and drop the feed.
2. **A UPC → SKU-code resolver.** Without it the feed cannot address a single
   real watched line.
3. **Answer the two money-path questions above.**
4. **Then** `PriceAvailability`'s request shape, captured from a real browser
   session — the exact v2 parameters are still unknown (GET and POST both 403
   from a server, and Chrome's own call was not visible to the network monitor,
   most likely because it goes through a service worker).
5. **Only then** `hasDbPriceFeed`, `SCHEDULED_PRICE_FEEDS`, a nightly job, a
   `REVIEWER_NOTES.md` row for the new scraping source, and a PIA.

Everything in the adapter is already written against the rules the real captures
proved, so none of it needs rewriting when a transport arrives — the file's rules
were validated over a transport that *did* get in.
