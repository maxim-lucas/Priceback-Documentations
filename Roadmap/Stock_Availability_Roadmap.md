# Stock availability: what is live, and what is left

**Why (Maxim, 2026-11-13):** Costco adjusts a price only while the item is still in stock at the warehouse. Until
now that was checked by hand. Item 2833285 (Fanta Soda Variety Pack, $3.50 off, Nov 12 to 22) showed a saving in 7
provinces while most warehouses had none left.

How it works today: `Technical/Savings-Harvest.md` § Stock per warehouse.

## Live (Priceback PR "stock availability", branch `feat/saving-stock-availability`)

| What | Where |
| --- | --- |
| One stock rule (`in_stock` / `out_of_stock` / `unknown`, never guessed) | `backend/services/savings/stockStatus.js` |
| Stock stored on the saving, per warehouse, by every Same-Day harvest run | `savings.flags.stock`, `savingsRepo.recordHarvestStock` |
| Stock refreshed by every live read (the queue's sweep, the desk's Auto-check) | `savings.flags.liveChecks.<warehouse>.available` |
| Stock badge on Admin · Price-drop queue (`IN STOCK · WH 540` / `OUT OF STOCK · WH 505`) | `AdminPriceDropQueueScreen.stockBadge` |
| An out-of-stock drop is still a drop: the check is shown, never blocking | `dropConfidence` → `in_stock_at_warehouse` (advisory) |
| The desk's manual "Check on Sameday" reads the province the item was bought in | `receiptProvinceCode` |
| Backend for the shopper's button | `POST /api/receipts/:id/items/:index/stock-check` |

## Built 2026-11-21 (Priceback #617; Maxim: admins only for now)

| Item | What | Where |
| --- | --- | --- |
| 1 | "Check stock now" under a drop's claim buttons, **admins only** (renders nothing for a shopper); in stock / out of stock / couldn't check, with the time; labels already EN + FR | `src/components/StockCheckButton.js`, `src/services/stockCheckService.js`, `DetailScreen` |
| 2 | Every savings drop carries its saving's stock across the linked warehouses; the queue card says "In stock at 18 of 63 linked warehouses · out at 30 · 15 not read" (readings older than 48 h say nothing). On the queue, not on Saving dates: Saving dates lists prices without an end date, not savings | `stockStatus.stockAcross`, `dropVerifier` → `stockAcross`, `AdminPriceDropQueueScreen.stockAcrossText` |
| 3 | **Admin view only, no change to drops** (Maxim's pick): the lines every drop rule accepts except the warehouse link, and a "Check stock" tap that reads the item at those warehouses (≤ 40 reads a tap, kept in `savings.flags.unlinkedChecks`, never read by a drop rule) | `savingDropRepo.findSavingDrops({ unlinked: true })`, `services/savings/unlinkedStock.js`, `GET /api/admin/savings/unlinked`, `POST /api/admin/savings/unlinked/check`, Admin · Unlinked warehouses |
| 6 | **Back in stock → admin push** (admins only): the queue's live re-read (every 6 h) finding in stock what the reading before it found out of stock pushes each admin, typed `price_drop_review` (a tap opens the queue). No extra request | `dropVerifier.setRestockListener` / `restockEvents`, `server.js sendRestockAlerts` |

Still open: 1 and 6 for shoppers (Maxim's switch, not built); 3's decision (link a warehouse found in stock, or not), once the
admin view has shown how often it happens; 4 and 5 below.

## Left to do

### 1. The shopper's "Check stock now" button (waits for the new design)

The backend is done and no build calls it yet. When the design is ready:

- **Call:** `POST /api/receipts/:id/items/:index/stock-check`, body `{ itemId?, lineTotal?, quantity? }` (the same
  line fingerprint as the claim route). Owner only.
- **Answer:** `{ ok, status: "in_stock" | "out_of_stock" | "unknown", checkedAt, cached, warehouseCode,
  warehouseName, reason? }`. `unknown` is a normal answer, with `reason` `not_checkable` (no warehouse on the
  receipt, a non-Costco store, an item Same-Day does not carry), `off` (the live reads are switched off) or
  `unreadable` (Same-Day did not answer).
- **Limits:** 10 a minute per shopper (429 `RATE_LIMITED` with `Retry-After`); an answer is shared for 10 minutes
  per warehouse and item.
- **To build:** the button and its three states on the claim screen (and wherever the design puts it), the labels
  in every language (`en` + `fr`), a client service beside `receiptSyncService`, and tests. Show the time of the
  check. Say plainly that Costco usually adjusts a price only while the item is in stock.
- **Decide in the design:** whether a drop's card shows the stock before the shopper taps (it would need the
  stock in the price-drop payload), and whether the push for an out-of-stock drop says so.

### 2. Stock of every warehouse on Admin · Saving dates

`savings.flags.stock` already holds it for every warehouse a saving is linked to. Not shown anywhere but the
price-drop queue (the shopper's warehouse only). A saving's detail could list "in stock at 18 of 63".

### 3. A warehouse where the item was out of stock at every harvest run is never linked to the saving

Same-Day's savings list holds only in-stock items, and a drop needs the receipt's warehouse linked to the saving.
On 2026-11-13 the Fanta saving ran at 63 warehouses and was linked to 33. A shopper of the other 30 gets no drop,
even after the item is back for an hour between two runs. Options: read the item's own page at the warehouses of
the province that do not list it (about 1 request each, only for savings with receipts waiting), or treat a
Same-Day saving listed at most warehouses of a province as province-wide. Needs a decision: it changes who is
notified and charged.

### 4. The Same-Day link the desk opens is not at the shopper's warehouse

**Status 2026-11-21:** covered on `main-test-features` by Priceback #613 (a headless browser reads the price at the
warehouse's exact address, `POST /api/admin/address-price`, off unless `ADDRESS_PRICE_READER=on`) and #612 (street
address of every warehouse). Not built again on `main`; it arrives with the next promotion.

The page a browser opens shows the stock and price of the address set in that browser. The server's reads are at
the right warehouse (Auto-check) or province (manual check), but the opened page is not. To look at: whether
Same-Day accepts a postal code in the link; otherwise show the read's result on the card and drop the need to open
the page.

### 5. Stock for a drop that did not come from a saving

**Status 2026-11-21:** not built. Two routes to the product id, both measured or built elsewhere: #613's search (on
`main-test-features`), or the in-store listing of item 7 below, which maps item number → product id for the whole shop
(the id is the same at every warehouse).

A drop from a price group (a shopper's receipt, a price tag) has no Same-Day product id unless some saving of the
product was harvested once. The check answers `unknown` for it. A lookup of the product id by item number
(Same-Day's search) would cover them.

### 6. Tell the shopper when a claimed-for item comes back in stock

Out of stock today is often back within the 30-day window. A push "back in stock at your warehouse, claim before
<date>" needs a watch on out-of-stock drops; each is one request per check.

### 7. Warehouse prices of every item, by warehouse (asked 2026-11-13)

*"While the harvest is on can it bring the warehouse prices not sameday prices only? By warehouse?"*

**What the harvest already brings.** For every item on a warehouse's savings list it reads the **in-store** shop,
which is the warehouse shelf price, not the Same-Day delivery price (item 2833285 on 2026-11-13: shelf $10.39 in
Ontario and $9.67 in Quebec; delivery $11.79 and $10.98). They are stored as price points of kind
`sameday_instore`, per warehouse when warehouses differ, else one row for the province. The delivery price is read
once per item for the product's online price.

**What it does not bring.** The shelf price of items that are **not** on saving. The same in-store shop lists
them, department by department, so the read is possible with the client the harvest has.

**Before building, measure** (the infrastructure rule): how many items a warehouse's in-store shop lists and how
many requests a full read costs. The savings list is about 300 to 430 items a warehouse and the run takes about 30
minutes for 104 warehouses. A full catalogue is likely several thousand items a warehouse, so a blind daily read
of every warehouse is not affordable. Options to size: only the items shoppers have on a receipt inside its
30-day window, at that receipt's warehouse (one `Items` request per 50 items); or one warehouse per province a
day, rotating.

**What it would give.** A regular price on file for every watched item at its own warehouse (today the queue
holds a drop when "the warehouse's regular price is unknown"), and stock for items that are not on saving.

### 7a. Measured 2026-11-21 (from Maxim's Windows PC; Railway's vantage not measured)

One guest session on the Costco storefront, warehouse 540 (in-store shop):

| Measure | Value |
| --- | --- |
| Warehouses on Same-Day Costco | 107 |
| Collections in the in-store shop (`DepartmentNavCollections`) | 186 |
| Distinct items across them | **2,654** (the savings collection alone: 491) |
| Largest collections | popular 971, savings 491, pantry 456, Kirkland 382, health 359 |
| Requests to list every item id | 186 (one `CollectionProductsWithFeaturedProducts` each, `first: 1`), 214 s at 400 ms spacing |
| Requests to price them all | +54 `Items` batches of 50 |
| A full read, one warehouse | ≈ 240 requests, ≈ 4–5 min |
| A full read, every warehouse, daily | ≈ 25,700 requests, ≈ 8 h: not affordable (infrastructure rule) |

Prod, the same day: **1,849** (warehouse, item) pairs on watched, unclaimed Costco lines bought in the last 30 days, at
**47** warehouses; **277** of those items have a Same-Day product id on file (from a saving).

**Recommendation (not built, Maxim decides):** a weekly listing of ONE warehouse (186 requests) to learn item number →
product id for the whole shop, then a daily targeted read of the 1,849 pairs only (one `Items` batch of 50 per
warehouse: ≈ 100–150 requests a day). It gives a regular price and the stock for every watched item at its own
warehouse, and closes item 5. A second Same-Day session opened right after a first one was refused once
(`no_session`), then worked: space the runs.

## What each store taught this doc

- 2026-11-21: the Saving dates screen lists prices without an end date, not savings: a saving's stock belongs on the queue.
