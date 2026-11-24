# Unified Product Browse Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared `ProductBrowseScreen` serves Deals and Warehouse prices (modes), with one warehouse filter, category and price filters, a link between the two, stock on savings (≤ 24 h old only), and a shared backend filter module.

**Architecture:** Backend first, additive only: `backend/lib/productFilters.js` is the one definition of search words, price bands and category facets; `dealsRepo` and the warehouse-prices route call it. App second: `DealsScreen` and `WarehousePricesScreen` stay as the routes (navigation unchanged) and become thin wrappers over `ProductBrowseScreen`; `DealsFilterSheet` becomes `BrowseFilterSheet`; `DealRow` becomes the saving slot of a shared `ProductRow`.

**Tech Stack:** React Native (Expo), Jest (`npm test`), Node `node --test` backend with drizzle/Postgres, i18n in `src/services/i18n.js` (EN + FR).

**Spec:** `Technical/Unified_Product_Browse_Screen.md` (approved by Maxim, 2026-11-24).

## Global Constraints

- Backend is additive only: new request parameters optional, an old request returns exactly what it returned before; no migration (`products.category_id`, 0054, is live in prod).
- **Stock rule (Maxim):** a stock line only for a reading ≤ 24 h old, judged by `stockStatusOf(read, { maxAgeHours: STOCK_SHOWN_MAX_AGE_HOURS })`, constant = 24, defined once in `backend/services/savings/stockStatus.js`. Older or unknown: no line. Never "was in stock N days ago". No stock on Warehouse prices, no bell, no new stock read.
- Keep every Deals top-level control (store pills, Filters pill + count, quick filters, search button, sort button). Only the Costco badge moves onto the title line, if it fits.
- Filters are exactly: warehouse, category, price (existing bands `any,u25,25,100,500`), sort, plus Deals' existing type and quick filters. No product-type filter, no custom min/max.
- Every user-visible string in EN + FR, via `t()`; `npm run i18n:check` clean. Category names from the server (`name_en`/`name_fr`), no raw codes.
- One rule, one function: price bands, search words, stock verdict, category facets each have one definition.
- Costco parser files and `receiptParsingShared.js` are not touched.
- Commit and merge every task (Maxim, 2026-11-24). Backend commits are kept separate from app commits: Maxim merges the backend into `main`, the app builds from `main-test-features`.

## Review Focus

- A reading exactly 24 h old shows its line; one 24 h + 1 min old shows nothing (Task 2).
- A product with no category is never hidden unless a category is chosen; 64% of live savings and 37% of products have one (Tasks 2, 3).
- A request with none of the new parameters returns the same items as before the change (Tasks 2, 3).
- Accents, plurals and word order find the same products in the JS matcher as in the SQL search (Task 1).
- An out-of-stock saving is listed with its label; a saving with no warehouse chosen shows no stock (Tasks 2, 7).

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/lib/productFilters.js` (new) | `PRICE_BANDS`, `inPriceBand`, `searchMatcher`/`matchesSearch`, `categoryFacets` |
| `backend/repos/dealsRepo.js` | raw rows gain sku, category, stock flags; `q`, `category`; `stock`; `categories` |
| `backend/repos/adminPriceLookupRepo.js`, `server.js` (`/api/me/warehouse-prices`) | `offset`, `category`; price/sort in a candidate window; `total`, `categories` |
| `src/services/productBrowse.js` (new) | shared constants, `browseActiveFilterCount`, `categoryName`, `stockLine` |
| `src/services/dealsService.js`, `warehousePricesService.js` | new parameters and fields, same item shape |
| `src/components/spaces/WarehouseFilter.js` (new) | the one warehouse filter (selector + picker modal) |
| `src/components/spaces/BrowseFilterSheet.js`, `CategoryPicker.js` (new) | grouped sheet; searchable category list |
| `src/components/spaces/ProductRow.js` (new), `DealRow.js` | shared row; saving slot |
| `src/screens/ProductBrowseScreen.js` (new), `DealsScreen.js`, `WarehousePricesScreen.js` | the screen and the two wrappers |

---

### Task 1: Shared filter module (backend)

**Files:** Create `backend/lib/productFilters.js`; Test `backend/tests/productFilters.test.js`.

**Interfaces:**
- Produces: `PRICE_BANDS: string[]` (`["any","u25","25","100","500"]`); `inPriceBand(band: string, price: number|null): boolean` (the rule `dealsRepo._inPriceBand` has today: `any` true; null price false otherwise; `u25` < 25; `25` 25–<100; `100` 100–<500; `500` ≥ 500); `searchMatcher(q: string): object|null` (null for an empty query); `matchesSearch(matcher, { names: string[], sku: string|null }): boolean` (every token, folded, in any name; or sku exact/prefix for 3–12 digit queries); `categoryFacets(rows: {categoryId, categoryName, categoryNameFr}[]): {id, name, nameFr, count}[]` (most products first, then name; rows without a category are not counted).

- [ ] **Step 1: Write failing tests** in `productFilters.test.js`: `inPriceBand("25", 24.99) === false`, `inPriceBand("25", 25) === true`, `inPriceBand("u25", null) === false`; `matchesSearch(searchMatcher("televisions"), { names: ["Samsung 65\" Television"] })` true (plural, via `shared/productSearch.stem`); accent/case: `"crème"` matches `"Creme brulee"`; word order `"65 samsung"`; sku prefix `"283"` matches sku `"2833285"`; `categoryFacets` of 3 rows (2 in A, 1 uncategorized) returns `[{id:A,count:2}]`.
- [ ] **Step 2: Run** `cd backend && node --test tests/productFilters.test.js`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the four exports in `backend/lib/productFilters.js` using `shared/productSearch` (`foldText`, `parseSearch`); no SQL.
- [ ] **Step 4: Parity test** (dev DB, same file or `productFiltersDb.test.js`): for 6 fixed queries (accent, plural, word order, sku prefix, no match, multi-word), the ids `adminPriceLookupRepo.search` returns for a seeded product set equal the ids `matchesSearch` accepts over the same products. Run; expect PASS (read `skipped`, not the exit code).
- [ ] **Step 5: Commit and merge** (backend only): `feat(backend): productFilters, the one definition of price bands, search words and category facets`.

### Task 2: Deals feed: search, category, stock, facets (backend)

**Files:** Modify `backend/repos/dealsRepo.js`, `backend/services/savings/stockStatus.js` (export `STOCK_SHOWN_MAX_AGE_HOURS = 24`), `backend/server.js` (`/api/deals` doc comment only); Test `backend/tests/dealsDb.test.js`, `backend/tests/dealsStock.test.js` (new, pure).

**Interfaces:**
- Consumes: Task 1; `stockStatusOf`, `newestStockRead(flags, warehouseCode)`.
- Produces: `parseDealsQuery` also returns `q: string` and `category: number|null`; raw rows gain `sku, categoryId, categoryName, categoryNameFr, stockRead` (the newest read at the chosen warehouse, or null; none when no warehouse); `toItem(row, bought, { now })` gains `sku, categoryId, stock: { status: "in_stock"|"out_of_stock", at: ISO } | null`; the response gains `categories: {id,name,nameFr,count}[]` (over the rows left after q, price, type and quick, before category).

- [ ] **Step 1: Write failing tests** (`dealsStock.test.js`): a row whose `stockRead.at` is `now − 24 h` yields `stock.status`; at `now − 24 h − 1 min` yields `stock: null`; `available: false` yields `out_of_stock` and the item is still in the list; no warehouse yields `stock: null`. `dealsDb.test.js`: a request with none of the new parameters returns the same ids and order as a snapshot taken before the change; `category=<id>` keeps only that category; an uncategorized product stays when no category is chosen; `q` narrows by the Task 1 matcher; `categories` counts equal the rows.
- [ ] **Step 2: Run both**; expect FAIL.
- [ ] **Step 3: Implement** in `dealsRepo.js`: select `p.sku`, `p.category_id` and the category names in `loadRawRows`, and the saving's `flags` stock readings; evaluate freshness at request time in `toItem` (the cache holds raw rows 30 min, so never at load time); replace `_inPrice` with `productFilters.inPriceBand`; filter `q`, `category` in `applyDealsQuery` before sort/paging; build `categories` with `categoryFacets`.
- [ ] **Step 4: Run** `node --test tests/dealsStock.test.js tests/dealsDb.test.js tests/dealsCache.test.js`; expect PASS, 0 skipped.
- [ ] **Step 5: Commit and merge** (backend): `feat(backend): /api/deals search, category, stock (≤ 24 h) and category facets, all optional`.

### Task 3: Warehouse prices route: paging, category, price, sort (backend)

**Files:** Modify `backend/repos/adminPriceLookupRepo.js` (`resolveFilters` accepts `categoryId`, `offset`; both search paths apply `p.category_id` and `OFFSET`), `backend/server.js` (`/api/me/warehouse-prices`); Test `backend/tests/warehousePricesRoute.test.js` (new, DB).

**Interfaces:**
- Consumes: Task 1; `priceHistoryService.searchFor`.
- Produces: optional `offset`, `category`, `price` (a `PRICE_BANDS` value), `sort` (`recent` default | `low` | `high` | `name`); response gains `total: number`, `categories: {id,name,nameFr,count}[]` (store-level, most products first, at most 300, cached 30 min per process), rows gain `categoryId`.
- Decision (price and sort are computed from the official price after SQL): when `price != any` or `sort` is `low`/`high`/`name`, fetch a candidate window of 300 (`WINDOW`), filter by `inPriceBand` on the official price, sort, slice `offset..offset+limit`, and `total` = the filtered count (so capped at 300); otherwise SQL `OFFSET` paging and `total` from one COUNT over the same where.

- [ ] **Step 1: Write failing tests**: no new parameters returns the same body shape and order as before (fields only added); `category=<id>` returns only that category; `price=u25` returns only official prices under 25 and a product with no official price is excluded by a band, kept under `any`; `offset=30&limit=30` is the second page without overlap; `total` matches.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** as specified above; keep "official prices only" and the rate limit unchanged.
- [ ] **Step 4: Run** `node --test tests/warehousePricesRoute.test.js tests/adminPriceLookupDb.test.js tests/verifiedPriceLookup.test.js`; expect PASS, 0 skipped.
- [ ] **Step 5: Commit and merge** (backend): `feat(backend): /api/me/warehouse-prices paging, category, price band and sort, all optional`.

### Task 4: Shared app helpers and services

**Files:** Create `src/services/productBrowse.js`; Modify `src/services/dealsService.js`, `src/services/warehousePricesService.js`; Test `__tests__/productBrowse.test.js`, extend `__tests__/deals.test.js`.

**Interfaces:**
- Produces: `BROWSE_PRICES` (same values as `DEAL_PRICES`, which stays exported as an alias); `browseActiveFilterCount(f, { warehouseStore, defaultWarehouse }): number` (the Deals rule plus 1 for a chosen category); `categoryName(cat, lang): string` (French in French when present, else English, never empty); `stockLine(stock, todayISO): { kind: "in"|"out", when: "today"|"yesterday" } | null` (null when absent); `dealsQuery`/`warehousePricesQuery` gain `q`, `category`; `fetchDeals`/`fetchWarehousePrices` return `{ items, total, categories, warehouse }` with items normalised to the same fields (`productId, name, nameFr, sku, categoryId`, plus the saving fields or `price/since/stale/lastSeen`).

- [ ] **Step 1: Write failing tests**: query strings contain `q=` and `category=` only when set, in the documented order; `categoryName` falls back to English; `stockLine({status:"out_of_stock", at: yesterday})` is `{kind:"out", when:"yesterday"}`; an unavailable answer is still `{ unavailable: true }`.
- [ ] **Step 2: Run** `npm test -- productBrowse deals`; expect FAIL.
- [ ] **Step 3: Implement** the helpers and extend both services (additive fields only).
- [ ] **Step 4: Run**; expect PASS, existing `dealsService` tests unchanged.
- [ ] **Step 5: Commit and merge.**

### Task 5: The one warehouse filter

**Files:** Create `src/components/spaces/WarehouseFilter.js`; Test `__tests__/warehouseFilter.test.js`.

**Interfaces:**
- Produces: `<WarehouseFilter value={{warehouseId, name}|null} defaultValue onChange={(preferredWarehouseShape)=>void} />` wrapping `WarehouseSelector` + `WarehousePickerModal` + `useWarehouseSelection({ persist: false })` exactly as `WarehousePricesScreen` does today; never changes the profile's warehouse.
- Audit step: `grep -rn "searchWarehouses(" src` and list every place that renders warehouse pills or its own list; the known ones (`BarcodeScanScreen`, `CostcoProfileScreen`, `PriceTagScanScreen`, `ScanScreen`) already use `WarehousePicker`; replace any other with `WarehouseFilter` and note the result in the PR.

- [ ] **Step 1: Write failing test**: picking a warehouse in the modal calls `onChange` with the picked warehouse and closes the modal; the profile prefs are not written.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** by moving the selector/modal wiring out of `WarehousePricesScreen`. **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit and merge.**

### Task 6: Grouped filter sheet and category picker

**Files:** Create `src/components/spaces/BrowseFilterSheet.js`, `CategoryPicker.js`; Modify `src/services/i18n.js` (EN + FR keys); Test `__tests__/browseFilterSheet.test.js`; the deals test "the sheet" case is updated deliberately (warehouse is now the `WarehouseFilter` row, Category is shown).

**Interfaces:**
- Produces: `<BrowseFilterSheet mode filters onChange onReset warehouse categories count … />`, sections in order **Where** (`WarehouseFilter`; warehouse type only in `deals`) · **What** (category row opening `CategoryPicker`) · **Price** (`BROWSE_PRICES`) · **Sort** (mode's sorts: Deals `saving,pct,low,high,ends`; Warehouse prices `recent,low,high,name`); testIDs of Deals' existing sections kept. `<CategoryPicker categories value onPick />`: a searchable list (1,605 categories in prod), most products first, count beside each name, "All categories" first; search uses `foldText` semantics.

- [ ] **Step 1: Write failing tests**: sections render in order; a tap applies at once; Reset keeps quick filters; the category row shows the chosen name and opens the picker; the picker filters by typed text ignoring accents; "Show n" reads `count`.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement**; add the i18n keys in both languages in the same edit. **Step 4: Run** the suite and `npm run i18n:check`; expect PASS.
- [ ] **Step 5: Commit and merge.**

### Task 7: Shared row, stock line, and the screen

**Files:** Create `src/components/spaces/ProductRow.js`, `src/screens/ProductBrowseScreen.js`; Modify `DealRow.js`, `DealsScreen.js`, `WarehousePricesScreen.js`, `src/services/i18n.js`; Test `__tests__/productBrowseScreen.test.js`, update `__tests__/deals.test.js`.

**Interfaces:**
- Produces: `<ProductRow item lang todayISO saving={node|null} />` (placeholder image, name, `#sku`, price line, "You bought this" chip; Warehouse prices passes no `saving`); `DealRow` renders `ProductRow` with a saving slot (was/now/−$, Ends, Executive, Business, stock line). `ProductBrowseScreen({ mode: "deals"|"warehousePrices", navigation, route })` owns title row (Costco badge on the title line; if it does not fit the smallest supported width, it stays where it is), search (server `q`, debounced), warehouse row, Filters pill + count, quick filters and store pills (Deals only), list header (count, sort), paging 50, the link row. `DealsScreen` and `WarehousePricesScreen` become `export default (p) => <ProductBrowseScreen mode=… {...p} />`; route names `Deals` / `WarehousePrices` and `tools.js` unchanged.
- Link row: Deals shows "See warehouse prices ›", Warehouse prices shows "See this week's savings ›"; accent ink, no card; navigates to the other route with `{ warehouse, q }` and does not write the profile warehouse.
- Stock line under the Deals row only: "In stock · updated today/yesterday" or "Out of stock · updated …" (never a date older than yesterday, because the server sends nothing older); one info line under the list header: stock can change between the update and the visit. No bell.

- [ ] **Step 1: Write failing tests**: both modes render the same `ProductRow` facts for the same item; the saving slot appears only in `deals`; `stock` out-of-stock row is listed with "Out of stock"; `stock: null` shows no line; no stock UI in `warehousePrices`; the link carries warehouse and `q` and the profile prefs are untouched; typing in search sends `q` (replaces "search narrows the loaded rows without a request"); paging asks the next 50 in both modes; every Deals top-level control still renders (store pills, Filters pill, quick filters, search button, sort button).
- [ ] **Step 2: Run** `npm test -- productBrowseScreen deals`; expect FAIL.
- [ ] **Step 3: Implement** by moving `DealsScreen`'s logic into `ProductBrowseScreen` with a per-mode config object (title key, fetcher, sorts, whether store pills/quick filters/saving slot are shown); keep `DEFAULT_DEAL_FILTERS` exported.
- [ ] **Step 4: Run** the full mobile suite (`npm test`) and `npm run i18n:check`; expect only the failures that fail the same way on a clean tree (trackingClock, paywallAnnualBadge, adjustmentWindowTimezone.matrix).
- [ ] **Step 5: Mutation-check** the stock freshness test and the link test (count occurrences before/after the edit); then commit and merge.

### Task 8: Docs, roll-out record, PR notes

**Files:** Modify `Technical/Unified_Product_Browse_Screen.md` (status, measured category coverage), `Operations/Task_Log.md`.

- [ ] **Step 1:** Record in the design: 1,605 categories, 289 in live savings, 516 of 801 live-saving products categorized, 5,966 of 15,920 Costco products categorized (measured 2026-11-24).
- [ ] **Step 2:** Each backend PR states **Old app builds**: which builds call the changed routes and why they are unaffected (additive fields and optional parameters); state which commits go to `main` (Tasks 1–3) and which stay on `main-test-features` (Tasks 4–7).
- [ ] **Step 3:** Mark the Task Log entry done with the PR numbers; commit and merge the docs.

## Self-review

- Spec coverage: shared screen and wrappers (7); warehouse filter (5); category and price filters (2, 3, 6); link and title row (7); stock ≤ 24 h, Deals only, out-of-stock listed (2, 7); grouped sheet (6); roadmap hold (done); rollout (8).
- Types: `categories: {id,name,nameFr,count}[]`, `stock: {status, at}|null`, `total`, `STOCK_SHOWN_MAX_AGE_HOURS` are named the same in every task.
- Open and flagged: Warehouse prices' price band and non-recent sorts work over a 300-product window (total capped), because the official price is computed after SQL; a deeper fix would move the official price into SQL and is out of scope.
