# Privacy Impact Assessment — Best Buy Price Feed

**Project:** the nightly Best Buy Canada price check (`backend/jobs/bestBuyPriceRefresh.js`,
adapter `backend/lib/bestBuyCatalog.js`)
**Date:** 2026-10-28 · **Owner / Privacy Officer:** Maxim Lucas (privacy@priceback.ca)

This is the fourth PIA (Quebec Law 25 §3.3). The first three live in the app repo,
`Priceback/legal/pia/` (flyer pipeline, crowdsourced pricing, Sentry). This one is in the
docs hub per the documentation rule. `PUBLISH_CHECKLIST.md` §1 points to both places.

## 1. Data collected
Best Buy's public product data for a **list of SKUs**: current price, regular price, sale
end date, clearance flag and seller. Retailer-published catalogue data, **not personal
information**. Each SKU is requested on its own, as
`GET https://www.bestbuy.ca/api/offers/v1/products/<sku>/offers`. Nothing else is sent: no account id, receipt id, device id, location or purchase
date.

## 2. Purpose
To tell a shopper when a Best Buy item they bought has dropped in price inside Best Buy's
adjustment window. The job checks **only the SKUs on live, watched receipt lines still
inside that window**. It is a watchlist refresh, not a catalogue crawl, so it grows only
with real purchases.

## 3. Legal basis
Legitimate interest (PIPEDA Principle 4.3) for the catalogue data, which is not personal
information. Choosing *which* SKUs to check reads the shoppers' own receipt lines, already
collected under the consent covered by the crowdsourced-pricing PIA. The job derives a
de-duplicated SKU list from them and keeps nothing else from those lines.

## 4. Retention
A price is written to `price_points` (province `NATIONAL`) **only when it changes**, under
a bot contributor identity (`device_hash` = the importer bot), never a shopper's. It is
kept like every other price observation. It describes Best Buy, not a person, so it
carries no shopper link to erase on account deletion.

## 5. Recipients / cross-border transfer
- **Best Buy Canada** receives bare SKU numbers from our server's IP. No personal
  information.
- **Railway** (US) hosts the job and the resulting price rows, as it already does for
  all pricing data.
- **Supabase** (Canada, `ca-central-1`) stores them.

## 6. Security measures
- Off by default (`BESTBUY_SCAN_ENABLED`). Production keeps it off until Maxim turns
  it on.
- Read-only GETs, paced at 1 request per second, with a hard timeout. A failure is
  recorded, never retried in a tight loop.
- The marketplace gate drops third-party sellers' prices, and a past sale end date is
  ignored, so a wrong price cannot become a drop alert.

## 7. Residual risk
Low. Nothing personal leaves our systems. The worst case is a wrong or stale price, a
product-quality issue that the gates in §6 and the verified-drop rules downstream
already limit.

## 8. Review trigger
Re-assess if the job ever sends anything beyond a SKU (a postal code, a store number tied
to a shopper, an account), or if Best Buy data starts being fetched on a shopper's device.
