# Costco flyer (coupons.html): province comparison & crawl rules

Findings from manually comparing `costco.ca/o/-/coupons` ("Great Savings This
Week") across Ontario, Quebec and British Columbia delivery locations on
2026-09-27, plus the rules this established for every future crawl. See also
[[Flyer-ingestion]] for the three ingestion mechanisms and the `commitFlyerImport()`
fan-out.

## 1. The catalog is national — only fees/tax vary by province

Checked ON, QC and BC for the same flyer cycle (2026-09-14 to 2026-09-27
2-week + 2026-08-31 to 2026-09-27 4-week offers): **identical SKUs, identical
`In-Warehouse` regular price, identical `Instant Savings`** in all three
provinces. The only per-province differences observed:

- **Eco-fee.** Shown as a separate `Eco Fee` line between `Instant Savings`
  and `Price` on the page, and it varies a lot by province — e.g. the
  Samsung 55" TV (SKU 5707055) carried **no eco-fee in Ontario or Quebec**
  but **+$11.00 in British Columbia**; the Champion generator (SKU 2309000)
  was +$0.00 in ON, +$0.35 in QC, +$0.28 in BC.
- **Quebec "Taxable Food" tag.** A handful of grocery/supplement items
  (C4 Jolly Rancher, the Vega line, Dymatize, Organika, Emergen-C, Metamucil)
  show a "Taxable Food" badge only on the QC-region page. Purely a QST
  display artifact — no effect on price.

**Standing rule (Maxim, 2026-09-27): eco-fees and taxes are never part of the
product price, in any province.** `promoPrice` is always computed as
`regularPrice - instantSavings`, ignoring whatever the page's own `Price`
line shows once the eco-fee is folded in. This is why a single national
import (`region: "ALL"`) is correct here instead of separate per-province
batches — once fees/tax are stripped out, ON/QC/BC (and by inference the
other provinces) carry the same price. The `import-flyer.mjs` national path
stores a single item list ONCE, as `NATIONAL`, and every province reads it
(since 2026-09-28 — it used to write one `price_points` row per province; see
[[Flyer-ingestion]] §4), so this needs no new backend logic — just crawl
discipline: strip the `Eco Fee` line, never read the post-fee `Price`.

## 2. Golden rule: one SKU = one price_points entry, always

**Never merge multiple item numbers into a single import line — including in
the JSON files themselves.** Costco's own flyer page frequently groups
variants into one tile for layout reasons; the crawl must not carry that
grouping into `price_points`:

- **Comma-separated SKU lists** (e.g. `Item 2628214, 2628215` for "Purex
  After The Rain or Purex Coldwater") → one entry per literal SKU, same
  price data, different `name` per variant where the tile names both.
- **Clothing size-dash-ranges** (e.g. `Item 1758504-9` for "sizes XS to
  XXL") → Costco's shorthand for a sequential SKU run, one number per size.
  Confirmed on all 4 instances seen this cycle: the trailing digit count
  always matches the size count exactly (`1758504-9` = 6 digits = XS,S,M,L,
  XL,XXL; `2038250-6` = 7 digits = XS..XXXL; `2037640-5` = 6 digits =
  S..XXXL; `2013430-4` = 5 digits = XS..XL). Expand these to individual SKUs
  using that pattern rather than importing the range as one row.

## 3. Hot Buy tiles are not price drops

`HOT BUY` tiles (this cycle: Beats Studio Pro headphones SKU 2080899, Green
Pan Spectra skillets SKU 1901845) show a **flat price with no regular-price
comparison** — there is no "was $X" above it. Maxim's call: these are a
merchandising price tier, not a discount, and must never register as a price
drop. Import convention: set `regularPrice = promoPrice` (i.e.
`instantSavings: 0`) and flag `hotBuy: true, noPriceDrop: true` so any
price-drop-detection logic skips them.

## 4. Online-only tiles need a follow-up click — the flyer tile price can be wrong

`COSTCO.CA ONLY` tiles on the coupons page sometimes show incomplete or
**incorrect** figures. Checked this cycle:

| SKU | Flyer tile said | Actual product page |
|---|---|---|
| 5758577 (Samsung 77" S85H OLED) | SAVE $500, no regular/promo shown | regular **$2,998.00**, savings **$700** (not $500), promo **$2,298.00** |
| 9163009 (Hisense 6 cu.ft fridge/freezer) | SAVE $40, no regular/promo shown | regular $339.99, promo $299.99 |
| 1931020/59/64/68/71 (Farm Girl cereal, 5 SKUs) | SAVE $10, no regular/promo shown | promo $39.99 (regular derived: $49.99) |

**Rule: never import a `COSTCO.CA ONLY` tile's price straight off the
coupons page — click through to the product page and use those figures.**
The coupons-page savings badge is not reliable for these.

## 5. Duracell AA/AAA batteries: 4 flyer SKUs, only 3 resolve online, prices differ from what's shown

Tile listed `Item 1625149, 1627198, 1806329, 1806358` under one "Duracell AA
or AAA batteries" line, SAVE $6, no price shown. Clicking through to the
online catalog found only **3 of the 4** SKUs:

| SKU | Product | Online price |
|---|---|---|
| 1806358 | AA Batteries, 40ct | $19.99 (was $25.99, -$6, +$1.60 eco fee — fee excluded per policy) |
| 1806329 | AAA Batteries (Power Boost), 40ct | $19.99 (was $25.99, -$6) |
| 1627198 | AAA Batteries (PowerBoost, distinct listing), 40ct | $19.99 (was $25.99, -$6), showed out-of-stock at one test warehouse |
| 1625149 | *(not found in the online catalog at all)* | unconfirmed — likely a warehouse-exclusive variant; Maxim's expectation is the **in-warehouse price is cheaper** than the $19.99 online price, consistent with every other item on this page carrying "Available for delivery at a higher price" (online is the expensive channel, not the cheap one) |

Imported all 4 SKUs per the golden rule; SKU 1625149 carries
`promoPrice: null` and `priceUnconfirmed: true` rather than a guessed value.

## 6. `priceSource` flag

Every imported item now carries `flags.priceSource`:

- `"warehouse"` — the flyer's base price; tile said "Available for delivery
  at a higher price," meaning online/delivery costs more (amount unknown).
  This is the majority of items.
- `"both"` — tile said "Also available on Costco.ca" with no higher-price
  caveat: same price in-warehouse and online.
- `"online"` — `COSTCO.CA ONLY` tiles, or the 3 resolved Duracell SKUs where
  only the online catalog had a confirmable price.
- `"unconfirmed"` — price genuinely unknown (Duracell SKU 1625149 only).

## 7. Rebate/conditional offers don't fit `price_points` — needs a new feature

"Receive $100 instantly when you buy any set of 4 eligible Bridgestone
tires" is not a single-SKU price — it's a conditional rebate tied to a
qualifying multi-item purchase Priceback can't independently verify.
**Roadmap ask (flagged, not yet built):** a "special offers" / rebate table,
surfaced somewhere like a Special Offers section in the app. When a matching
purchase (e.g. 4 Bridgestone tires) is detected on a receipt, the app should
**ask the user to confirm** whether they actually received the rebate — and
this must **never** auto-deduct from Priceback's credit/commission math,
since Priceback cannot confirm the rebate independently the way it can a
posted flyer price. See [[commission-charged-once]] for why the existing
commission math is deliberately conservative about unverifiable price
movements.

## 8. Desired crawl cadence (not yet automated)

Maxim wants this crawl run **automatically, within the first hour of a new
Costco deals cycle going live**. Costco's warehouse coupons ("Great Savings
This Week") run **2-week and 4-week cycles that both roll over on
Sunday/Monday** (this cycle: 2-week ran 2026-09-14 to 09-27; the 4-week
cycle before it ran 08-31 to 09-27 — both end the same Sunday, so the whole
page refreshes together). In addition to the coupons page, Costco surfaces
separate deal categories that are **not** covered by this crawl yet and
would need their own cadence:

- **Treasure Hunt** (costco.ca nav: "Treasure Hunt") — rotates faster/less
  predictably than the 2-week coupon cycle.
- **Offers Ending Sunday** — a subset/preview of the same coupon cycle.
- **Online deals** — costco.ca-only promotions outside the printed-style
  flyer.
- **Executive Member-only deals** — gated behind Executive membership tier;
  needs an Executive-tier account/session to even see, which the current
  Claude-in-Chrome routine doesn't have.

**Not yet implemented:** an automated recurring trigger for the coupons-page
crawl, and no coverage at all yet for the other 4 categories. This is a
scheduling/infra decision for Maxim to make (see the flagged options in the
2026-09-27 Task Log entry) rather than something silently defaulted.

See [[Costco_Coupons_Ingestion_Roadmap]] for the open work list this page
feeds into. Its first item — storing a national batch once under the reserved
`NATIONAL` province instead of 13 rows per SKU — shipped on 2026-09-28.
