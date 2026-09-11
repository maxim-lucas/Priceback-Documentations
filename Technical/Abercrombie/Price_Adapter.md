# Abercrombie & Fitch — the price adapter

How A&F's current price gets into `price_points`. Companion to
`Price_Adjustment_Policy.md` (what a price entitles a shopper to) and to the
store-neutral checklist in `Technical/Store_Price_Adapters.md`
(the adapter contract itself).

**Status:** adapter built and **inert on purpose** — it quotes nothing until a
Canadian capture supplies a storefront id. Audited and corrected 2026-09-10.

> ⚠️ **The 2026-09-07 finding was under-specified and read wrongly for three
> days.** "Measured from a non-Canadian egress" meant **Egyptian** egress
> (`41.45.134.97`, AS8452 TE-AS, Alexandria). No request to A&F has ever been made
> from a Canadian IP, so nothing below is evidence about A&F Canada's pricing —
> only about what the rest of the world sees. The measurement that settles it is
> `Canadian_Egress_Verification.md`.

---

## Capture session — what A&F actually publishes

Step 1 of the checklist is "read `robots.txt` first and write down what it
allows", because whether a retailer is walled decides whether it gets an adapter
at all. A&F comes out on the **Best Buy** side of that line, not the Costco side.

| Probe | Result |
| --- | --- |
| `robots.txt` | Disallows only checkout, account and `/shop/*/search`. **Product pages are not disallowed.** No `Crawl-delay`. |
| `GET /shop/<store>/p/<slug>` with a *minimal* header set | **403**, 149-byte `Bad Request` body |
| `GET /shop/<store>/p/<slug>` with a **full browser header set** | **200**, ~525 KB |
| `GET /api/ecomm/util/sitemap/index/anf` | **403** on 2026-09-07; **no response at all** (60 s timeout) on 2026-09-10 |
| First-byte latency | ~0.5–3.6 s warm; one 45 s timeout on a cold first hit |

### 🔴 The 403 was header completeness, not an anti-bot wall

This is the single most misleading result of the session and it nearly produced
the wrong verdict. A `User-Agent` alone gets 403. Adding the rest of what a real
Chrome navigation sends — `Accept`, `Accept-Language`, `Accept-Encoding`,
`Upgrade-Insecure-Requests`, the four `Sec-Fetch-*` headers and the three
`sec-ch-ua*` client hints — returns a full 200.

So A&F is **not** Akamai-walled the way costco.ca is. There is no session, no
challenge and no browser to drive. It is a plain server-side `fetch`, like Best
Buy — it just requires a complete, honest browser header set.

The adapter's `HEADERS` constant is therefore **load-bearing, not cosmetic**.
Trimming it "because it looked redundant" reintroduces a 403 that arrives as a
counted `http_403` rejection — silent data loss, not a visible error.

The sitemap route is unreachable regardless. It is not needed for the scan: like
Best Buy, that is **watchlist-driven** (SKUs on live watched receipt lines), never
a crawl. It *would* have solved the slug problem, which is why its loss matters.

### The price is inline in the HTML

No JSON API is required. Every product page carries two things:

1. JSON-LD `Product` → `offers.priceSpecification[].price` / `priceCurrency`.
2. A `productPrices` global, keyed by the 8-digit product id, which is richer and
   is what the adapter reads:

```js
productPrices[63504014] = {
  productId: "63504014",
  contractPrice: 76, lowContractPrice: 76, highContractPrice: 76,
  items: {
    "669031968": { itemId: "63495062", listPrice: 95, offerPrice: 95, priceFlag: "1" },
    ...
  }
}
```

`listPrice` vs `offerPrice` **per variant** is exactly the "purchased at the full
price" and "of the same color and size" test the policy requires. This is a
better shape than Best Buy's offers endpoint, not a worse one.

---

## 🔴 The currency gate — Abercrombie's "marketplace gate" equivalent

Every retailer has one rule that separates a price a shopper can actually claim
from one they cannot, and it is never optional. Best Buy's is `isMarketplace`.
**A&F's is currency**, and it is worse than Best Buy's because it fails *silently
and plausibly*.

**A&F geo-routes by IP.** Measured 2026-09-07 **from Egyptian egress** (and
re-confirmed 2026-09-10), every one of these landed on the **worldwide**
storefront (`data-storeid="11203"`) priced in **USD**:

| Attempt | Final path | Currency |
| --- | --- | --- |
| `/shop/us/p/<slug>` | `/shop/wd/p/<slug>?originalStore=us` | USD |
| `/shop/ca/p/<slug>` | `/shop/wd/p/<slug>?originalStore=ca` | USD |
| `/shop/ca/…` + `Accept-Language: en-CA` | `/shop/wd/…` | USD |
| `/shop/ca/…` + country cookies | `/shop/wd/…` | USD |
| `/shop/ca/…?originalStore=ca` | `/shop/wd/…` | USD |

Neither the URL path, `Accept-Language`, nor a guessed country cookie overrides
it. The `/shop/ca` path exists but is only *served* to Canadian egress — which is
exactly the thing nobody has tested. See `Canadian_Egress_Verification.md`.

### Why this is dangerous rather than merely wrong

`price_points` stores a number; the currency is assumed by context. A USD list
price written against a receipt line paid in CAD is **numerically lower**, so it
does not look like an error — it looks like a **price drop of roughly the
exchange rate, on every single item, forever.** And `findNotifiable` charges
commission at detection, before any human sees it.

That is the same failure class as the receipt parser reading `2210 BANK ST` as an
item costing $22.10: *a plausible wrong number is worse than a visible gap,
because the user acts on it* — except this one bills the user.

### 🔴 The gate has TWO halves — checking currency alone is not enough

**This was the audit's headline defect (2026-09-10).** The first implementation
required `priceCurrency === "CAD"` and read `data-storeid` only to decorate the
rejection message. That is insufficient, and reachably so.

**A&F ships a multi-currency selector.** The worldwide storefront's own page
carries AUD, COP and USD, and offers a "Search Currencies" picker. So a *foreign*
storefront can render an **FX-converted** price and honestly declare that currency
in its JSON-LD. `priceCurrency: "CAD"` is therefore **not** evidence the price is
A&F Canada's — it may be a worldwide page with the dropdown flipped, which is
precisely the fabricated number the gate exists to refuse.

The test suite had encoded the hole rather than catching it: its `deriveCad()`
helper stamped `data-storeid="10051"` — **A&F's real US storefront** — so every
"CAD is accepted" case asserted that *a US page carrying a CAD string is
accepted*.

### The rule, as it now stands

Two assertions, storefront first, both before any price is read:

1. **Storefront** — `data-storeid` must be in `CANADIAN_STORE_IDS`, else
   `rejected: "storefront_mismatch"`. Known foreign ids are named in the detail
   (`11203` worldwide, `10051` US) so a run summary says *which* storefront
   answered rather than just "not ours".
2. **Currency** — then `priceCurrency` must be `CAD`, else
   `rejected: "currency_mismatch"`.

Storefront first because a worldwide page declaring CAD must be refused on the
storefront, not accepted on its own say-so about currency.

**`CANADIAN_STORE_IDS` is EMPTY, deliberately.** The real value can only be read
off a page served to Canadian egress, and no such page has ever been captured.
Guessing it would defeat the gate on the first guess that is wrong in the
permissive direction. Empty means every page is refused — the correct conservative
answer, and it matches today's real behaviour anyway, since with no slug source
nothing reaches the gate in production.

**Filling that list in from a real capture is the single edit that turns the
adapter on.** Procedure: `Canadian_Egress_Verification.md`.

### Owed before the scan flag is ever flipped

In order — each step is blocked by the one above it.

1. 🔴 **Establish whether A&F serves CAD to Canadian egress at all.** Nothing else
   on this list can be decided first, and it has never been measured. Scheduled
   for on/after **2026-09-24**; full procedure and decision tree in
   `Canadian_Egress_Verification.md`.
2. **Fill in `CANADIAN_STORE_IDS`** from that capture. One edit; it is what turns
   the adapter from "refuses everything" into "refuses everything foreign".
3. **Give the backend a Canadian egress path.** Railway has **no Canadian
   region**, so its own egress is US and it will see storefront 11203 forever —
   a laptop in Canada proves nothing about the host. The shape that fits is a thin
   fetch-relay on **GCP Cloud Run in `northamerica-northeast1` (Montréal)** called
   by the Railway job; GCP project `695135372222` already exists and a nightly
   watchlist sweep sits inside the free tier. Verify the relay's *own* egress
   before trusting it.
4. **Re-measure latency from wherever the fetch actually egresses**; the one cold
   45 s timeout is why the timeout is generous (Best Buy needed 30 s for the same
   reason).
5. **Replace the derived CAD fixtures with a real Canadian capture.** The suite's
   `deriveCad()` / `deriveSale()` helpers exist only because no real one does.
6. **Solve the slug source** — see the colour-family finding above, which makes
   the catalogue one entry per *style*.

Only after all six is `hasDbPriceFeed` even a question.

---

## The four gates

| Gate | Rule | Rejection |
| --- | --- | --- |
| **Storefront** | `data-storeid` must be in `CANADIAN_STORE_IDS` | `storefront_mismatch` |
| **Currency** | `priceCurrency === "CAD"` | `currency_mismatch` |
| **Variant** | quote the shopper's `itemId` (size + colour), never the product-level `low/highContractPrice`, which span variants | `variant_unresolved` |
| **Availability** | no price / out of range | `no_price`, `price_out_of_range` |

> The **variant** gate is genuinely new to this codebase. Best Buy and Costco
> SKUs identify a product; an apparel SKU identifies a *size and colour*.
> `lowContractPrice`/`highContractPrice` span every variant of a style, so
> quoting them would price a different size than the shopper bought — a valid
> number for the wrong thing, which the policy explicitly excludes.

---

## Reused, not rebuilt

- **The `NATIONAL` province** (migration 0007) already exists for exactly this
  case — A&F publishes one national price, so no schema change and no write-path
  special case. Paying for it once with Best Buy bought it for every national
  retailer.
- **Write-on-change only.** Re-stamping an unchanged price pushes `observed_at`
  forward and would tell every shopper who ever paid that price that it just
  dropped — and charge each of them commission.
- **The neutral Quote/Rejection contract** in `services/storePriceAdapters.js`.
  Never throw; a rejection is data; unit prices in the store's own currency.

---

## Two more findings that change the adapter's shape

### 🔴 A&F throttles hard, and the 403 is transient

Rapid-fire probing turned a URL that had just returned 200 into a **403**, and a
single request **75 s later returned 200 again**. So `http_403` is *not* a
permanent verdict on a SKU — it is backpressure.

Consequences:

- **Pace far more conservatively than Best Buy's 1 s.** Best Buy's throughput was
  latency-bound; this one is politeness-bound.
- **A 403 must be retryable, not terminal.** Treating it as a dead SKU would
  silently drop items from the sweep and look like "the product is gone".
- Never re-probe in a tight loop while developing. The block is IP-wide, so it
  takes out the capture session too.

### 🔴 The product SLUG is required — an id alone 404s

`/shop/ca/p/63504014` → **404**. Only `/shop/<store>/p/<slug>-<productId>`
resolves. Best Buy's API takes a bare SKU, so this is a genuinely new problem:
**a receipt carries an item number, not a URL slug.**

The sanctioned slug source would be the sitemap, which robots.txt explicitly
`Allow`s (`Allow: /api/ecomm/util/sitemap/*`, and it is the declared `SITEMAP:`)
— but that route is not usable server-side. It answered **403** on 2026-09-07
regardless of headers, XML or navigation-shaped, and on **2026-09-10 it stopped
answering at all**: a 60 s timeout with no response, from an egress that fetched
`robots.txt` in 1.2 s the same minute. It was reachable during the 2026-08-31
triage, so this is a deliberate change on A&F's side, not a header problem.

**Therefore the adapter cannot resolve a slug on its own today**, and it must not
guess one. Identity and addressing are separated:

- **Identity** = `"<productId>:<itemId>"` — both 8-digit, retailer-issued, and
  variant-level, which is what the "same color and size" rule requires.
- **Addressing** = the slug, supplied through an injectable `slugFor(productId)`
  seam. Unresolved ⇒ a distinct, counted `slug_unknown` rejection, never a guess.

### 🟢 One slug covers a whole colour family — the problem is smaller than it looks

Found while auditing the committed capture (2026-09-10), and it changes the size
of the slug catalogue by roughly the number of colours per style.

A single product page carries `productPrices[...]` for **every colour sibling of
the style**, not just the one addressed. The capture for
`lyocell-cotton-pleated-baggy-trouser-63504014` also contains complete variant
price maps for `63504015` and `63503945`, plus a `productCatalog[...]` entry
naming each. All three are the same trouser in different colours.

`extractProductPrices(html, productId)` already keys off the **requested**
product id, so it reads a sibling's prices out of that page today with no change
at all. The consequence:

> A slug catalogue needs **one entry per style**, not one per productId. Fetching
> any colour's page prices every colour of that style.

That is one request and one slug covering N products, which makes both the
harvest and the nightly sweep materially cheaper against a store that throttles
IP-wide. It does not make the slug problem go away — a style still needs *a* slug
from somewhere — it makes it roughly N times smaller.

Candidate slug sources, in preference order:

1. **The order confirmation itself.** A&F order emails/PDFs link to the product,
   so the parser may be able to capture the slug at scan time — the receipt half
   feeding the price half. Confirm when the first real receipt arrives.
2. A harvested `productId → slug` catalogue, refreshed periodically — the same
   shape as the Costco barcode harvester.
3. A browser-assisted harvest, as Costco's flyer already requires.

Until one exists the feed quotes nothing, which is the correct conservative
answer and is why `hasDbPriceFeed` must **not** list Abercrombie yet.
