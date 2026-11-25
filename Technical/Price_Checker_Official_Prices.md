# Price Checker: official prices, by warehouse (2026-11-25)

**Asked (Maxim, 2026-11-25):** *"The price checker is not linked to the warehouse prices which should be done, but dont drop the price checker behavior to list the purchase history for the product, same photo is missing and the SKU should be on the result page, remove the unverified results (official prices only as the other prices screen) … mention the warehouse of the default settings for the user and also the nearby warehouse prices in a wide 25 mile radius with the stock availability if we have the info even in the past, add a link to buy online for the items if we have the link, if it is too heavy dont do it but keep it in the roadmap with decision details."*

## What the screen shows now

Scan or type a barcode → `GET /api/me/price-check?barcode=&warehouse=` (authenticated, new route; `services/priceCheck.js`):

| Block | Source (one definition each) |
| --- | --- |
| Product: picture, name (FR when the app is French), **item number (SKU)**, barcode | `products.barcode` → `priceHistoryService.harvestHistoryFor` (the catalogue harvest's picture and names). The external catalogue's picture is only the fallback. |
| Price at the warehouse | The same official line as Warehouse prices: the regular price less the official saving (`harvestHistoryFor`). **No unverified crowd price, no tag, no receipt, no source name.** |
| Which warehouse | The one picked on the screen, else the shopper's profile warehouse (said "Your warehouse"), else their province. |
| Price evaluation chip | `PriceSignalChip` (Good deal / Best price + Corporate markdown, Store clearance, …, or Regular price). One rule, `shared/priceSignal.js`. |
| Stock | `warehouse_stock_reads` (0057): the LAST reading, **any age, always dated** ("In stock · seen Nov 20"). A warehouse with no reading says nothing: never guessed. |
| Nearby | Official warehouses within **25 miles** (`lib/nearbyWarehouses`, official list coordinates, nearest first, at most 6): official price + chip + last stock reading. A neighbour with neither a price nor a stock reading is not listed. |
| See price history | Opens `WarehousePriceHistory` for the product at that warehouse. |
| Your purchase history | Unchanged: `GET /api/me/price-history` (last 90 days). |

A barcode our catalogue does not know still falls back to the external name (Open Food Facts / UPCitemdb), display only. A known product with no official price at the warehouse says so ("No official price yet at …"); it never shows a community price. The old public `GET /api/barcode/resolve` is unchanged for installed builds.

**Why this changes what a shopper saw:** a barcode linked to a product on 2026-11-25 used to show an unverified crowd price ("Unverified · 1/3 shoppers"). It now shows only what the harvest and the savings feed state.

## Price evaluation everywhere

Every price a shopper (and the admin history) sees is judged by the same decoder: Warehouse prices rows, Deals rows, the Price Checker, the price history's current card and its chart tooltip (`describeShopperStep`; admin `describeStep` in English). A price ending .97 / .88 / .00 / .X9 is never just "Regular price". **Known limit:** a harvested regular price that happens to end in .00 reads "Manager markdown" (the rule keys on the ending only). If that reads wrong on real products, the fix is to evaluate only prices that are not the official regular price (decide with Maxim; not changed without asking).

## Roadmap: "Buy online" link (NOT built: decision)

*Asked: a link to buy online when we have it.* **Decision: not built, kept here.**
- We store **no** product URL. The only deterministic form is `https://www.costco.ca/.product.<item number>.html` (used by `server.js` to probe pages), and many warehouse-only items have no such page: a guessed link would open a dead page, against "be accurate all over the screens".
- Options when it is picked up: (a) the catalogue harvest records the product page URL it read (`catalog_items.url`, one migration, additive) and the app shows the link only when one is stored for that item; (b) Same-Day's listing URL (`samedayItems.productUrl`) as a second link, labelled by retailer. (a) is the recommended one: no live request on the shopper's path, no dead links, about one column.
- Not heavy to build once (a) exists (one field on the price-check answer, one button); the cost is the harvest change and its backfill. Needs a decision: Costco.ca only, or also Same-Day.

## Other roadmap items from the same session

- Alternative warehouse names: `src/constants/warehouseAliases.js` (search only; the official name never changes). 503 = "Lebourgneuf". Add a name = one line keyed by the warehouse number.
- Stock for nearby warehouses is only as fresh as the daily read of **watched** items (`warehouse_stock_reads`), so most products have none. A broader read (every product on Deals) is a cost decision (`Operations/Infrastructure_Cost_Rules.md`).
