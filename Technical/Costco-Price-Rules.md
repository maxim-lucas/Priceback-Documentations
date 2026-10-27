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

### What Same-Day's badges really say (measured 2026-10-27)

- **A badge outlives its end date.** At 00:45 Toronto on Tuesday Oct 27, warehouse 524
  (Etobicoke) still showed the Samsung QN80H TV (5708165) at $1,194.99, "reg. $1,794.99",
  "$600 off", **"Ends Oct 26"** — and two other items the same. Instacart removes ended
  promotions on its own schedule, so a midnight read sees last week's badges. A saving is
  over when its printed end is before the warehouse's own day (its province's clock): a BC
  warehouse read at 00:30 Toronto is still on Oct 26.
- **The end dates are not one weekly cycle.** One warehouse on Oct 27 listed savings
  ending Oct 26, 27, 28, 29, 30, 31, Nov 1, 4, 5, 8, 15, 22, 29, 30 — mostly Sundays (the
  coupon book's), but not only.
- **Same-Day and costco.ca can print different ends for the same saving.** The ASUS
  Vivobook (2082745), $400 off: the coupon book says "to November 22", Same-Day "Ends Nov
  29". The shopper is given the earlier date; a claim is still possible after it as long as
  Same-Day lists the saving at their warehouse.
- **Weighed items carry a per-package saving on a per-kg price.** "Asiago Cheese — per kg —
  $15.81, reg. $20.81, $5 off"; "Whole Brisket — per lb — $119.70". The shelf price is a
  rate, the receipt line a weight × rate: never a drop.
- **An item's identity.** `retailerReferenceCodeString` is the warehouse item number (3 to
  7 digits — old items have short ones: 680 Kraft Singles, 2679 Lee Kum Kee); `productId` is
  Instacart's product, the same at every warehouse of a storefront (the Business Centre
  storefront has its own ids); the item's page is `/store/<retailer>/products/<productId>-<slug>`
  (it loads for anyone, at any warehouse). Many Same-Day items are warehouse-only and do not
  exist on costco.ca under that item number — searching costco.ca for one finds nothing.

## Price adjustment policy (context)

Costco Canada refunds the difference when its own price drops within **30 days** of the
purchase, at the same channel (warehouse purchase → warehouse counter; online → online).
No price matching against other retailers. Clearance, gold/bullion and some
manufacturer-funded deals are reported as excluded. PriceBack's claim deadline is the
earlier of the store window and the saving's last day (`shared/claimDeadline`).

**The refund is paid − today's price, not the saving.** An instant saving lowers today's
price from today's regular. When the regular moved since the purchase, the refund moves
with it: paid $17.99, today $18.49 − $4.50 = $13.99 → $4.00 back, not $4.50 (Bugs #352). A
shopper who paid a clearance price (`.97`, Ferrero 48 ct at $17.97) did not pay the regular
the saving comes off.

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
