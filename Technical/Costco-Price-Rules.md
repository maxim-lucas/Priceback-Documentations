# Costco Canada price rules — what a price or a saving says about its reach

Researched 2026-10-26 for the automated savings harvest (`Technical/Savings-Harvest.md`).
**Costco has never published these codes.** They are the conventions shoppers, former
employees and the press agree on; the sources disagree on details (noted below). The
harvest applies them through `backend/services/savings/costcoPriceRules.js`.

## Price endings (the cents of a shelf price)

| Ending | Meaning | How PriceBack stores it |
|---|---|---|
| `.99` | Regular price | Province-wide warehouse price |
| `.49` / `.79` | Manufacturer promotion (temporary) | Province-wide |
| `.97` | Clearance / corporate markdown — one warehouse, several, or a whole region (buyer's decision) | **Warehouse only** (`price_points.warehouse_id`), never verified for the province-wide drop sweep |
| `.00` / `.88` | Manager markdown, that warehouse only (`.88` is also used for some Asian goods around Lunar New Year) | **Warehouse only**, always |
| other cents | Weighted packs (meat, cheese: price = weight × rate) | Province, but the product is `is_weighted` and never a drop |

## The asterisk ("death star")

An `*` in the top-right corner of the tag: the item will not be reordered **at that
warehouse** (seasonal items and discontinued items both carry it; some come back,
repackaged or as Kirkland Signature). Location-specific. Not a price code — the harvest
does not read tags directly yet; yepsavings' photos are kept as warehouse prices.

## Savings (instant savings, coupon book, Same-Day "$N off")

- The **coupon book discount is the same across Canada**; shelf prices still vary by
  province (taxes, regional costs, Québec sub-prices).
- Measured on Same-Day 2026-10-26 (11 warehouses, 6 provinces, 353 items): the saving
  amount was identical inside every province (949/949 province groups), but **can differ
  between regions** (e.g. $3.00 in BC/AB/SK vs $3.50 in ON/QC/NS for the same item and
  week). So a saving is stored **per province**, linked to the warehouses that list it.
- Not every warehouse lists every saving (139 of 353 items were at all 11 sampled
  warehouses). A saving linked to warehouses applies only to receipts from those
  warehouses; a saving with no warehouse links (the national coupon book) applies to
  every warehouse of its province.

## Same-Day (sameday.costco.ca, Instacart) prices

- **Delivery** prices are officially higher than the warehouse ("item pricing is higher
  than your local warehouse in order to cover the service and delivery fees charged by
  Instacart" — Costco's Same-Day page). Stored only as `products.price_sameday`.
- The **in-store** shop of the same storefront (`serviceType: INSTORE`) shows prices that
  look like the warehouse shelf (2,209 of 2,732 sampled end in `.99`). Stored as a
  warehouse price observation (`flags.sourceKind = "sameday_instore"`), and counted as
  **verified only when its regular matches** what receipts / shoppers' tags / flyers
  saw for the item in the province, and every sampled warehouse of the province agrees.

## Price adjustment policy (context)

Costco Canada refunds the difference when its own price drops within **30 days** of the
purchase, at the same channel (warehouse purchase → warehouse counter; online → online).
No price matching against other retailers. Clearance, gold/bullion and some
manufacturer-funded deals are reported as excluded. PriceBack's claim deadline is the
earlier of the store window and the saving's last day (`shared/claimDeadline`).

## Sources

- Daily Hive — "Secret meaning Costco price tags" — https://dailyhive.com/canada/secret-meaning-costco-price-tags
- CostcoGuides — "Costco Price Tags Decoded" — https://costcoguides.com/costco-price-tags/
- Food Republic — "Every Costco Price Tag Code, Explained" — https://www.foodrepublic.com/1669862/every-costco-price-tag-code-explained
- Tasting Table — price endings — https://tastingtable.com/1934590/costco-price-tag-number-meanings
- Tasting Table — the asterisk — https://www.tastingtable.com/1720890/meaning-behind-costco-price-tag-asterisk
- Eat This — "Costco death star" — https://www.eatthis.com/costco-death-star/
- Chowhound — the asterisk — https://www.chowhound.com/1548705/costco-price-tag-asterisk-meaning
- Costco — Same-Day page — https://www.costco.com/same-day.html
- Chowhound — Same-Day prices — https://www.chowhound.com/1574179/costco-same-day-grocery-delivery-prices
- CostRefund — Canada vs US coupon books — https://costrefund.com/blog/costco-canada-vs-us-coupon-books-key-differences
- Savvy New Canadians — price adjustment in Canada — https://www.savvynewcanadians.com/costco-price-adjustment-canada/
