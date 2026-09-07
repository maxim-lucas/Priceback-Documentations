# Abercrombie & Fitch — the price adapter

How A&F's current price gets into `price_points`. Companion to
`Price_Adjustment_Policy.md` (what a price entitles a shopper to) and to the
store-neutral checklist in `Technical/Store_Price_Adapters_And_The_BestBuy_Feed.md`
(the adapter contract itself).

**Status:** capture session done 2026-09-07; adapter in progress.

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
| `GET /api/ecomm/util/sitemap/index/anf` | **403**, even with full headers |
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

The sitemap route stays 403 regardless. It is not needed: like Best Buy, the scan
is **watchlist-driven** (SKUs on live watched receipt lines), never a crawl.

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

**A&F geo-routes by IP.** Measured 2026-09-07 from a non-Canadian egress, every
one of these landed on the **worldwide** storefront (`data-storeid="11203"`)
priced in **USD**:

| Attempt | Final path | Currency |
| --- | --- | --- |
| `/shop/us/p/<slug>` | `/shop/wd/p/<slug>?originalStore=us` | USD |
| `/shop/ca/p/<slug>` | `/shop/wd/p/<slug>?originalStore=ca` | USD |
| `/shop/ca/…` + `Accept-Language: en-CA` | `/shop/wd/…` | USD |
| `/shop/ca/…` + country cookies | `/shop/wd/…` | USD |
| `/shop/ca/…?originalStore=ca` | `/shop/wd/…` | USD |

Neither the URL path, `Accept-Language`, nor a guessed country cookie overrides
it. The `/shop/ca` path exists but is only *served* to Canadian egress.

### Why this is dangerous rather than merely wrong

`price_points` stores a number; the currency is assumed by context. A USD list
price written against a receipt line paid in CAD is **numerically lower**, so it
does not look like an error — it looks like a **price drop of roughly the
exchange rate, on every single item, forever.** And `findNotifiable` charges
commission at detection, before any human sees it.

That is the same failure class as the receipt parser reading `2210 BANK ST` as an
item costing $22.10: *a plausible wrong number is worse than a visible gap,
because the user acts on it* — except this one bills the user.

### The rule

The adapter **asserts the storefront and refuses to quote when it is not the
Canadian one.** Concretely: parse `data-storeid` and the JSON-LD `priceCurrency`
out of every response, require `CAD`, and return a distinct
`rejected: "currency_mismatch"` otherwise. A distinct counted reason means a
storefront change shows up in the run summary instead of hiding.

**Fail closed.** Until Canadian egress is confirmed the adapter quotes nothing,
which is the correct conservative answer — a missing price costs an opportunity,
a wrong one costs the shopper money and PriceBack's credibility.

### Owed before the scan flag is ever flipped

1. **Confirm Railway's egress reaches A&F as Canadian.** Railway regions are
   largely US; if egress is US, the worldwide/USD storefront is all we can see
   and the feed cannot ship on the current host without a Canadian egress path.
   Best Buy is the precedent for verifying this on the real host — a laptop
   proves nothing about Railway.
2. Re-measure latency from Railway; the one cold 45 s timeout means the timeout
   must be generous (Best Buy needed 30 s for the same reason).
3. Capture real responses as fixtures **once CAD is reachable** — a USD fixture
   would pin the wrong currency into the test suite.

---

## The four gates

| Gate | Rule | Rejection |
| --- | --- | --- |
| **Currency** | storefront must be Canadian; `priceCurrency === "CAD"` | `currency_mismatch` |
| **Full price** | policy adjusts only items bought at full price | `not_full_price` |
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
