# One screen for Deals and Warehouse prices (design, 2026-11-24)

Status: **design approved by Maxim, 2026-11-24** (with the 24-hour stock rule). Next: the implementation plan.
Asked by Maxim, 2026-11-24, on `main-test-features`. Approach 1 of 3 picked by Maxim.

## Intent

Today the shopper has two screens that browse Costco products by warehouse and look different: **Deals**
(`DealsScreen`, 358 lines, store pills, a Filters sheet, quick filters, paged, was/now/saving rows) and **Warehouse
prices** (`WarehousePricesScreen`, 147 lines, a search box and a warehouse picker, 60 rows at most, a bare row).
Maxim's words: *"same screen but the title is different, same filters, different product level … the existing
navigation to these screens remains as of today … simplify the code, same structure, filters, avoid duplicating
code … both should show the same infos + the deals for deals section."*

The reason is twofold: a shopper who moves between the two must not get lost, and the code must hold the rule
"one rule, one function, called everywhere" (CLAUDE.md, 2026-11-10) by construction.

## Goals

1. One component, `ProductBrowseScreen`, owns the layout, search, warehouse filter, category filter, price filter,
   sort, the filter sheet, paging and the list. `DealsScreen` and `WarehousePricesScreen` stay as the routes the
   app already navigates to, each a thin wrapper that passes a **mode** (`deals` | `warehousePrices`) and its data
   source.
2. Both modes show the same product facts: image placeholder, name (language aware), item number, price, and the
   "You bought this" chip. **Deals adds** was / now / saving, the Ends chip, Executive / Business chips, and
   stock (see below). Nothing about a saving is shown on Warehouse prices.
3. One warehouse filter, the one Warehouse prices uses today (`WarehouseSelector` + `WarehousePickerModal`),
   replaces Deals' own warehouse pills and is the filter wherever a shopper picks a warehouse for browsing.
4. Category filter (new). Price-range filter on both screens (Deals has it today, Warehouse prices gets it).
5. A link between the two that blends in the design, carrying the warehouse and the search words across.
6. A title row where the Costco badge sits on the same line as the title on Deals, to give the list more room.
7. A cleaner, grouped filter sheet.

## Non-goals / anti-goals

- **Nothing on Deals' top level is removed or moved**: the store pills, the Filters pill with its count, the quick
  filters (Executive only, etc.), the search button, the sort button. Maxim loves them. Only the Costco badge's
  position changes (goal 6), and only if it fits.
- No filter nobody asked for. The set is: warehouse, category, price, sort, plus what Deals already has.
  **No product-type filter** (the TV vs accessories case was an example: the category filter plus search covers
  any kind). **No custom min/max price fields** (my call: the existing price bands, the "most used").
- **No stock on Warehouse prices, no price history on either** (Deals has none today; none is added).
- **No new stock reading, and no back-in-stock bell or notification** — held for cost, see
  `Roadmap/Stock_Availability_Roadmap.md` § "Held for cost (2026-11-24)".
- No change to the price-drop rules, the window rule or any receipt code (Costco immutability test untouched).

## Constraints

- The backend never breaks an installed build: every route change is additive, every new parameter optional,
  an old request behaves exactly as before. `/api/deals` and `/api/me/warehouse-prices` have been live since the
  builds that call them; no older build calls the new fields.
- Every label in EN + FR (`npm run i18n:check`), friendly, no raw codes; category names come from the server's
  `name_en`/`name_fr` through the overlay pattern, the server string as last resort.
- One definition per rule: the search words (`shared/productSearch`), the filters, the price bands, the stock
  verdict (`services/savings/stockStatus.stockStatusOf` — never a second "is it in stock?").
- The admin sees what the shopper sees: not touched here.

## Approaches considered

| # | Approach | Trade-off | Verdict |
| --- | --- | --- | --- |
| 1 | `ProductBrowseScreen` with a mode; two thin wrapper routes | One refactor of Deals (has a test suite) | **Picked by Maxim** |
| 2 | Fold Warehouse prices into Deals as a toggle, delete its screen | Least code, but breaks "existing navigation stays" | Rejected |
| 3 | Keep two screens, share only filter components | Safest, but the structure stays duplicated | Rejected |

## Design

### Screen (shared)

```
[ Costco ]  Deals / Warehouse prices        [search]     <- badge on the title line
  Costco · Warehouse 540 ▾                               <- one WarehouseSelector (shared)
  (Filters · 2)  | quick filters (Deals only, unchanged)
  ── See Costco warehouse prices ›  /  See this week's savings ›    <- the link
  list header: "n items" · sort
  rows
```

- **Store pills** stay on Deals (it has several stores); on Warehouse prices there is one store, so none.
- **Filters sheet**, grouped: *Where* (warehouse, warehouse type) · *What* (category) · *Price* (the existing
  bands) · *Sort*. Deals' savings-only options (quick filters stay in the top row).
  A tap applies at once and "Show n" closes, as today; Reset keeps the quick filters, as today.
- **Search**: server side, in both modes, through `shared/productSearch` (every word, any order, accents,
  plurals). Deals today narrows only the 50 rows already loaded; it moves to the same server search.
- **Paging**: both modes page 50 at a time with the total (Warehouse prices today caps at 60 with no total).

### The link

A single text-style row under the filters, accent ink, chevron, no card: "See warehouse prices ›" on Deals,
"See this week's savings ›" on Warehouse prices. It navigates to the other route with `{ warehouse, q }` so the
shopper lands on the same place and search. It never changes the profile's warehouse.

### Rows

One `ProductRow` renders the shared facts; Deals passes a `saving` slot (was / now / −$, Ends, chips, stock).
`DealRow` becomes the saving slot's content, not a second row layout.

### Stock (Deals only, existing readings only)

**Freshness rule (Maxim, 2026-11-24, approved): a stock line is shown only for a reading at most 24 hours old.**
*"I don't want to show the user a message like was in stock 5 days ago, it has to be meaningful with 1 day maximum
window, not even 25 hours."* The window is `stockStatusOf(read, { maxAgeHours: 24 })`, one constant in the one stock
rule, never a screen-local age check. An older reading is "unknown": **no stock line at all**, never "was in stock
N days ago". The shown date is the reading's own time, so it can only read "today" or "yesterday".
Measured on prod, 2026-11-24 (read-only): savings harvest readings 94,933, of which 49,850 (52%) are inside 24 h
(newest 0 h, oldest 233 h); live checks 163, 5 inside 24 h; `warehouse_stock_reads` 1,609, all inside 24 h (4 h).
So about half of the savings will carry a line today; the coverage of the savings the feed actually lists is
measured at plan time. Raising it means a fresher harvest, not a looser window.

Each saving carries the newest reading it holds for the chosen warehouse (`flags.liveChecks`, `flags.stock`,
`warehouse_stock_reads`), judged by `stockStatusOf`: **In stock** / **Out of stock** / nothing when unknown (never
guessed), with "updated Nov 23". One line under the list header says stock can change between the update and the
shopper's visit. **Out-of-stock savings are listed, not hidden**, with an "Out of stock" label. The bell is not built.
Warehouse prices shows no stock.

### Backend (additive)

- `backend/lib/productFilters.js`: the one module for the search words, category and price-band predicates, used
  by `dealsRepo` and the warehouse-prices lookup.
- `GET /api/deals`: new optional `q`, `category`; rows gain optional `sku`, `categoryId`, `stock: { status, at }`;
  response gains `categories` (the place's categories with counts).
- `GET /api/me/warehouse-prices`: new optional `offset`, `category`, `price`, `sort`; response gains `total`,
  `categories`; rows gain `categoryId`. Official-prices-only rule unchanged.
- No migration (`products.category_id` exists since 0054, live in prod).

### Rollout (Maxim's rule, 2026-11-24)

Backend and shared code go to **`main`** (prod), as their own commits, so the beta build, built from
**`main-test-features`** to the internal track, tests the new design against the production backend. The PR states
which commits go to `main` and which stay. Order: backend to `main` first, then the app build.

### Old app builds

Installed builds that call `/api/deals` or `/api/me/warehouse-prices` ignore the new fields and never send the new
parameters; ordering, paging and the old parameters are unchanged. A build older than these routes never called them.

## Tests

Screen tests for both modes through the one component (filters, paging, link carrying the warehouse and search,
stock label only on Deals, out-of-stock listed); backend tests for `productFilters`, both routes' new parameters
and the unchanged old request; a parity test that both modes use one filter module; i18n check; mutation-check the
new tests. Existing `DealsScreen` tests must pass unchanged where behaviour is kept.

## Left to the builder / open

- **Category coverage in prod is not measured yet.** Measure `products.category_id` coverage at plan time; if low,
  the category filter shows only categories that have products at the place, and a product without one is never
  hidden unless a category is chosen.
- Whether the badge fits on the title line at the smallest supported width (fallback: it stays where it is).
- Audit of every other warehouse picker in the shopper UI to switch it to the shared one (list in the plan).
- Calls Maxim approved with the design: price = existing bands only; no product-type filter; stock = existing readings
  inside 24 h, no bell.
