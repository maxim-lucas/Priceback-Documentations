# Price history and price lookup: the rules

**Standing rules (Maxim, 2026-11-17).** They apply to Admin · Price lookup and Admin · Price history today, and to the
shopper's warehouse price view in the next versions. Never change one of them without Maxim asking for it; a rule
change he did not ask for is a bug.

> *"the price history screen in admin console and price lookup should never include the user receipts data by
> default, it should be with a toggle in the screen. structure this feature with the better class architecture
> because the next versions of the app will allow users to check these prices by warehouses based on their default
> warehouse with a possibility to check in the nearby warehouses including also business centers if available."*
>
> *"social post should be excluded also same behavior as the receipt, i want this screen to have the main focus on
> the catalogue harvest and savings based on the jobs we have, if not found a fallback on the social post and the
> receipts should be done based on the warehouse or province of the user"* — *"the target is that our jobs will
> update the prices in warehouses regularly"* — *"the search also should be more smart"* — *"all rules should be
> documented to be respected for future features and edits"*.

## The rules

1. **Every price has an evidence kind and a tier, and is shown by them, never by a source's name.**

   | Tier | Kind | What it is | Shown as |
   |---|---|---|---|
   | 1 Official | `official_regular` | the catalogue harvest's shelf regular price (kind `warehouse`) | Regular price |
   | 1 | `official_saving` | a saving from an official source (`savingRules.isOfficial`: Same-Day, costco.ca) | Official saving |
   | 1 | `official_store` | an in-warehouse price the savings harvest read (`sourceKind: sameday_instore`) | In-warehouse price |
   | 1 | `official_flyer` | the weekly flyer | Weekly flyer |
   | 1 | `verified_tag` | a price tag an admin verified (or the `verified` column) | Verified price tag |
   | 1 | `admin_entry` | a price an admin entered (`manual`) | Entered by an admin |
   | 2 Community | `social` | every source that is not official: social posts, blogs (yepsavings), websites (`scrape`), third-party savings | Seen on social media |
   | 2 | `shopper_receipt` | a line of a shopper's receipt (`receipt_ocr`, the crowd pool's receipt rows) | Shopper's receipt |
   | 3 Shopper's flag | `shopper_tag` | a tag a shopper sent, not verified; any row no rule names | Flagged by a shopper (unverified) |

   A verified tag behaves like a trusted saving (tier 1, never a fallback). A social post is social media whatever its
   flags say (in production 3,403 social rows carry `verified = true`). A receipt of an admin is still a receipt here.

2. **The place.** What the viewer picked (nationwide, a province, one or several warehouses), else their **home**: the
   preferred warehouse (`user_preferences.preferred_warehouse_id`), else their province, else nationwide. A warehouse
   counts its own prices and its province's prices that name no warehouse (a flyer, a province-wide price). A place
   never hides a product from the lookup; it is listed with its fallback or "No price".

3. **The main line is official.** For each day: the shelf regular price in force at the place, less the deepest
   official one-unit saving running that day, or an official price seen that day (flyer, in-warehouse, verified tag,
   admin entry; a sale price holds through its printed end), whichever is lower. A warehouse's own regular price beats
   its province's. With several warehouses (home + nearby) each warehouse gets its own regular less its own saving and
   the lowest is drawn. Nationwide: the lowest province. A saving counts at the warehouses that list it (costco.ca's
   flyer, `costco_web`, in the whole province) and on its storefront's channel (Costco or Business Centre). An undated
   saving runs to the day it was last read. A multi-buy saving is never a unit price. A price holds until the next one.

4. **The fallback.** Only when there is no official price: tier 2 at the place, then tier 2 in the place's whole
   province, then tier 3 at the place, then tier 3 in the province. Said on screen: "No official price · showing …".
   Never mixed into the official line.

5. **The switch** ("Social media and shoppers' prices", off by default). On: tiers 2 and 3 are listed and drawn as a
   second, faint line beside the official one, at the place; everywhere when the place has none. Off: they are only
   counted ("8 prices from social media and shoppers are hidden").

6. **Old prices are said.** Nothing reported for `STALE_AFTER_DAYS` (14) days: "No prices reported since <date>".
   The jobs' reads count (a regular price's `last_seen_at`, a saving's `updated_at`), so a price the harvest re-reads
   daily is never old.

7. **The jobs keep what they replace.** `productCatalogRepo.writeRegularPrices` (the one writer of
   `product_regular_prices`) keeps every regular price it changes or removes in `product_regular_price_history`
   (migration 0051) with the span it held; `price_since` says since when the current one holds. The online kinds
   (`sameday`, `website`) are never a warehouse's shelf price and are never drawn.

8. **Filters.** Source, verified only and the period narrow the prices (a product with none matching is left out).
   **Savings only** lists products with a saving running in the period (today when none) at the place, official only
   unless the switch is on.

9. **The search** (`shared/productSearch`): case and accents aside ("creme" finds "Crème", "oeuf" finds "Œuf"); every
   word in any order, in any of the product's names (English, French, the full names with size, the register's short
   labels); a plural finds its singular; digits are an item number (exact, then prefix) or a barcode. Best first: an
   exact item number / barcode, a name that starts with the words, every word at a word start, then the most recent.

10. **The chart** reads like a price-comparison site: one stepped line with a soft fill, the price axis on the right
    with round values and dashed grid lines, the current price in a pill at the line's end, dates along the bottom, a
    touch shows the price that day and what it is. The component draws only; it holds no rule and no text of its own.

## One definition each

| Rule | Defined in | Its twin |
|---|---|---|
| Evidence kinds, tiers, `POINT_RULES` (first match wins) | `shared/priceHistory.js` → `classifyPoint`, `classifySaving`, `tierOf` | SQL: `backend/lib/priceEvidenceSql.js` (`evidenceKindSql`, `evidenceTierSql`), built from the same table |
| The scope (place, filters, switch) and the request | `shared/priceHistory.js` → `PriceHistoryScope` (`toQuery`, `nearHome`) | server parse: `adminPriceLookupRepo.resolveFilters` / `atPlace` |
| The official line, the community line, freshness, axes | `shared/priceHistory.js` → `PriceHistorySeries.officialLine` / `observedLine`, `freshness` | — |
| Which jobs' rows count at a place | `backend/services/priceHistory/priceHistoryService.js` → `officialInputs` | — |
| Home place, fallback order, the switch | `priceHistoryService` → `resolvePlace`, `fallbackSteps`, `historyFor`, `searchFor` | — |
| Data: price points | `backend/repos/adminPriceLookupRepo.js` | — |
| Data: regular prices (current + history), savings, home | `backend/repos/priceHistoryRepo.js` | writer: `productCatalogRepo.writeRegularPrices` |
| Search folding | `shared/productSearch.js` → `foldText`, `parseSearch` | SQL: `backend/lib/productSearchSql.js` → `foldSql` |
| Words on the admin screens | `src/services/adminPriceLookup.js` (`EVIDENCE_LABELS`, `placeText`, `staleText`, `fallbackText`, `scopeFromFilters`) | a shopper screen adds i18n keys keyed by the evidence kind (en + fr) |
| The chart | `src/components/PriceHistoryChart.js` | — |
| The product's picture (2026-11-17) | SQL: `adminPriceLookupRepo` `PRODUCT_COLUMNS` → `imageUrl` (the catalogue harvest's `catalog_items.image_url`, https only, lowest `trust_rank` first, then verified, then latest seen) | draw: `src/components/ProductImage.js` — the picture, else the PriceBack placeholder (brand glyph on the mint surface); a picture that fails to load falls back too |

Tests that pin them: `__tests__/priceHistoryShared.test.js` (rules, scope, lines, search, chart geometry),
`__tests__/adminPriceHistoryScreen.test.js`, `__tests__/adminPriceLookupScreen.test.js`,
`backend/tests/priceHistoryRules.test.js` (SQL twins run on rows, `officialInputs`, the 0051 writer),
`backend/tests/adminPriceLookupDb.test.js` (the routes, the defaults, the fallback, social posts hidden, the official
line from the jobs' rows, Savings only, the search).

## For the next features and edits

- A new price source: add its rule to `POINT_RULES` (and its tier). The SQL twin follows; add the row shape to
  `priceHistoryRules.test.js`. Never decide a tier in a screen or a route.
- A new place kind (nearby warehouses, Business Centres): build it with `PriceHistoryScope.nearHome` and send
  `warehouses=`; the server reads several warehouses already (at most 25).
- The shopper's view: call `priceHistoryService.historyFor` / `searchFor` with the shopper's sub; render with
  `PriceHistoryChart` and translated formatters; map every evidence kind to an i18n key (never print the kind).
- Changing a rule: change its one definition, its twin and the tests in the same PR, and this page.

## Old app builds

Admin-only routes. Every new parameter is optional; every response field is additive. A build before the switch
sends no `community`, so it reads official prices only, at the admin's home: that is the rule, not a regression.

## Deploy

Migration 0051 (`price_since`, `product_regular_price_history`, RLS) must be applied to production **before** the
backend deploys: the catalogue harvest writes `price_since` from this version on. Applied to dev on 2026-11-17.
