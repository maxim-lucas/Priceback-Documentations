# Weekly catalogue harvest: official product names, misread item numbers fixed

Built 2026-10-26/27 (hotfix on `main`, branch `hotfix/catalog-harvest`). Backend migration
**0037**. Same style as the daily savings harvest (`Technical/Savings-Harvest.md`): sources in
the database, an hourly in-process tick, one run row per run, no extra service, no browser, no
OCR — **no extra cost**.

The ask: *"another cron script, same style as the savings one, using costco.ca, the Business
Centre and both Same-Day sites, to make sure all products are filled correctly in the database,
autofix the product names (English and French), fix the errored ones (banana / banane in the
product table with a different SKU misread from receipts), and feed the database with the full
product list of Costco nationwide in Canada, so the reference is always good when a receipt is
read: the parser checks the best match in the database and autofixes the SKU and the product
name if misread again. Weekly, Sunday at midnight, configurable."*

## What it does

| Source (`catalog_sources.code`) | What is read | Seeded schedule | Trust |
|---|---|---|---|
| `sameday_costco_catalog` | sameday.costco.ca: its **products sitemap** (8,394 products, 2026-10-26), each read through Same-Day's own `Items` query at one warehouse per province, then again in **French** | Sunday 00:00 | **1** |
| `sameday_business_centre_catalog` | the same on sameday.costcobusinesscentre.ca | Sunday 00:00 | 2 |
| `costco_ca_catalog` | costco.ca: its public **image sitemap** (15,505 pages; the photo is named after the item number for ~8,300 of them) and, capped per run (`config.maxPages`, 400), the public product pages in English and French | Sunday 00:00 | 10 |
| `costco_business_centre_catalog` | the same on costcobusinesscentre.ca (`maxPages` 200) | Sunday 00:00 | 11 |

Hours are America/Toronto. A source runs on `days_per_week` days spread from `start_day`
(0 = Monday … 6 = Sunday), at `start_hour` (+ `24 / runs_per_day`). The tick fires at minute 35
of every hour and runs every source whose latest slot has passed and that has not run since; a
slot missed while the process was down or busy (a redeploy at midnight, the savings tick still
reading Same-Day) is **caught up** within `config.catchUpHours` (default 24) — a weekly job must
not lose a week. It waits while the savings tick is running (one session on Same-Day at a time).

The first full Same-Day run on dev (2026-10-27): 8,155 items with a warehouse item number out of
8,394 (230 not carried by any of the 25 warehouses read, 9 without an item number), 8,133 with a
French name, 7,636 new products, 274 English names made official, 519 French names filled —
720 requests, 13 minutes.

### How each site is read

- **Same-Day** (`services/catalog/sources/samedayCatalogSource.js`): the products sitemap the
  site publishes for crawlers lists every product by Instacart id. `Items` reads 50 per call at
  one warehouse (`items_<location>-<productId>`); a product that warehouse does not carry is
  absent. Warehouses: one per province first (most warehouses first), then the next one per
  province, each reading only what is still missing, up to `config.maxLocations` (25) — regional
  items (Québec, BC) are found where they are sold. Then the guest session is switched to French
  with the storefront's own language switch (`AccountUpdateUserLocale { locale: "fr_CA" }`) and
  every found item is read again: its French name and size. Every item carries the WAREHOUSE
  item number (`retailerReferenceCodeString`).
- **costco.ca / costcobusinesscentre.ca** (`…/costcoWebCatalogSource.js`): public pages only.
  The image sitemap gives LISTINGS (this site sells that item number — the photo is named
  `<item>-894__1.avif` on costco.ca, `<item>-frca__1.avif` on the Business Centre; 8,276 of 15,505
  and 328 of 5,329 pages on 2026-10-27); a product page's JSON-LD gives the item number with its
  name. A page the sitemap still lists but Costco took down (404) is skipped, not a failure. Each language is asked for explicitly (`?langId=-24` /
  `-25`) and a name counts only in the language the page says it is in (`<html lang>`) — a cached
  page answered in French to an English request once (2026-10-26). A page is ~1.7 MB, so the
  reader stops at the JSON-LD (~20 % in). The item numbers PriceBack needs come first: products on
  receipts that Same-Day did not verify (`productCatalogRepo.wantedSkus`); the rest of the budget walks
  the sitemap in a different order each week, skipping what this source verified lately.
  Costco's internal APIs are deliberately not used.

## What is stored

- **`catalog_items`** — one row per (source, product): English and French name, sizes, brand,
  photo, page, the source's own id, first/last run and time seen. `verified` = the names were read
  off the item's own data; an unverified row (a website listing) only says the item number is
  real, and is recorded only for products already on file — a listing never creates a product
  and never names one.
- **`products`** — every verified item number becomes a product, named in both languages
  (`display_name`, `display_name_fr`). An existing product **takes the official names** (the
  register shorthand "KS ORG PASTE" gives way to the catalogue's name) unless:
  - an admin saved its name on Admin · Product names (`products.name_locked_at`): then the harvest
    only fills an empty slot. `DELETE /api/admin/products/:id/name-lock` hands it back.
  - a MORE trusted source names it within `CATALOG_LISTING_FRESH_DAYS` (35): costco.ca never
    renames what Same-Day names.
  A French name equal to the English one is no French name.
- **Run history**: `catalog_runs` — start/finish, status (`success`, `partial`, `failed`,
  `blocked`, `sanity_skipped`), locations read, items found, products new, names updated, French
  names filled, item numbers merged, photos uploaded, error, details (skipped items by reason,
  locations, the fix pass's merges and suspects). Kept 180 days (`RETENTION_CATALOG_RUNS_DAYS`).
- **Sanity floor**: a run that finds fewer than the source's `min_items` (Same-Day 2,000, Business
  Centre 300), or less than half its last good run, writes nothing — a layout change can never
  rename the catalogue.
- **Photos**: Same-Day product photos go to the R2 bucket by item number, once (the savings
  harvest's `productPhotos.uploadMissing`, `config.maxImages` 300 per run). No-op without R2 keys.

## Misread item numbers

A misread of a printed item number is **one edit away** from the real one: one digit changed,
dropped, added, or two neighbours swapped. Every decision is in `services/catalog/skuMatch.js`
(pure, unit-tested); the evidence, strongest first:

1. **The printed text.** A register prints the same short text for the same item every time, so a
   line whose text equals what receipts printed for a catalogue item one edit away is near-proof
   (`printedMatch`: equal once normalized, or one OCR slip on a text of ≥ 6 characters, two on
   ≥ 12 — **never in a size**: "KS WATER 24PK" and "KS WATER 40PK" are two items). Two candidates
   that printed the same text: no decision.
2. **The catalogue's name**, matched with the register's abbreviations in mind ("ORG" → organic,
   "CHKN" → chicken, "KS" → Kirkland Signature), English or French — only at ≥ 0.85, **0.2 ahead
   of every other candidate**, and at a price within 30 % of the candidate's usual price (an
   unknown price is not enough for this weaker evidence).
3. **The price**: a price far from the candidate's usual one rules it out, whatever the name says.

### On every receipt save (`lib/receiptCatalogMatch.js`)

Each line with a real item number that no catalogue lists within 35 days is checked: an alias
(a number already folded away, below) becomes the real number; otherwise the catalogue items one
edit away are candidates and the rules above pick one or none. A corrected line:
- files under the real product (the misread never becomes a product), priced and watched like any
  line read right;
- keeps the number read: **`receipt_items.sku_read`**; the receipt desk shows *"Item number
  corrected · the scan read …"*;
- keeps its printed name (the shopper's record); the app shows the product's official name.

It runs on the scan's own upload (`POST /api/receipts`, and the back-fill of a header that lost
its lines) and on every Gemini proposal of the desk's *Fix automatically*; never on a repair's or
an admin's typed lines. In a savepoint of the save's transaction: a failed read leaves the lines
as read, never the receipt unsaved. No catalogue yet = no check. Live switch:
**`CATALOG_SKU_FIX_ENABLED`** (default on).

### Weekly, for products already on file (`services/catalog/catalogFixer.js`)

After a tick's runs, a **suspect** is a product with a real item number that no catalogue lists
and that only shoppers' scans ever saw — no saving, no pending saving, no price from a flyer, an
import, the savings harvest or anything but a receipt or a shopper's tag, no barcode, no locked
name. It is **folded into** its real product when every text receipts printed for it is that one
candidate's (or, when no receipt ever named the candidate, every text fits its catalogue name at
≥ 0.85 with a 0.2 lead at an agreeing price). Folding (`productCatalogRepo.mergeProducts`, one
transaction): receipt lines move (keeping `sku_read`), price points, pending savings, savings, tag
reviews and tag settlements move (a row the real product already has the twin of is dropped),
phones' watch registrations are re-pointed, the merge is recorded in **`product_merges`**, and
the misread product is deleted. Its number becomes an **alias** of the real product: a receipt
that reads it again is corrected on save, and a phone that still names the old product id or the
old number (`/api/watch`) is answered with the real product. A catalogue that later lists the
number for real retires the alias.

Anything weaker is a suspect only, listed in the run's `details.fix.suspects` for the admin.
The pass runs only when **every enabled source has a good run within 35 days** — a catalogue
missing a source would call real items misreads. Live switch: **`CATALOG_AUTO_MERGE_ENABLED`**
(default on; off = merges are listed as suspects with `heldBy`).

### Proof on the receipt corpus

`node --env-file=.env scripts/harvest-catalog.mjs --corpus` replays every line the receipt golden
snapshot pins (127 receipts, 1,495 lines) through the save check, read-only. On dev with all four
sources loaded (2026-10-27): 1,402 lines carry an item number, 1,296 (92 %) are listed (1,237 with
Same-Day Costco alone), and **3 are corrected — each a misread**, the same three with one source
or four:

| Receipt | Read | Printed | Corrected to | Why |
|---|---|---|---|---|
| `r_1791748180975_8wims` (c77, QC) | 30659 | BANANES 1.99 | **30669** Banana / Bananes, 1,36 kg | 5↔6; the catalogue's French name |
| `r_1791748180975_8wims` (c77, QC) | 845009 | RACLT SUISSE 13.99 | **846009** Raclette Swiss Cheese | 5↔6; same price to the cent |
| `PXL_20260702_024316732` | 373328 | UNSALTED BTR 4.95 | **373323** Natrel Unsalted Butter | 8↔3; the same receipt prints "373323 UNSALTED BTR" on another line |

Run it against production (read-only) before switching anything on there; the printed-name
evidence is much richer in production, so most corrections there rest on it.

The weekly pass on dev (`--fix --dry-run`, 2.5 s, all four sources fresh): 2 scan-only products
no catalogue lists; **0 merged, 1 suspect** — "HYTREND COMPOSTABLE PAPER BAGS FACK OF 50" read
as 1846733, the catalogue's 1845733 one digit away at a name fit of 0.82 with no price on file:
probably a misread, held for the admin rather than guessed.

## Operating it

- **Sources** (console token, `x-admin-token`): `GET/POST /api/admin/catalog/sources`,
  `PATCH /api/admin/catalog/sources/:code` (`enabled`, `runsPerDay` 1–24, `daysPerWeek` 1–7,
  `startDay` 0–6, `startHour` 0–23, `trustRank`, `minItems`, `config`), `POST …/:code/run`
  (202; the fix pass follows a good run), `GET /api/admin/catalog/runs[?source=&limit=]`,
  `GET …/runs/:id` (the run, the products it first listed, its merges),
  `POST /api/admin/catalog/fix[?dryRun=1]`, `GET /api/admin/catalog/merges`,
  `POST /api/admin/catalog/merge { fromProductId, toProductId }` (an admin's merge),
  `GET /api/admin/catalog/items?sku=` (every source's listing of one number). Or SQL on
  `priceback.catalog_sources`.
- **Rescheduling**: e.g. Saturday 23:00 → `PATCH … { "startDay": 5, "startHour": 23 }`; twice a
  week → `{ "daysPerWeek": 2 }` (from the start day, spread over the week).
- **CLI** (from `backend/`): `node --env-file=.env scripts/harvest-catalog.mjs --list |
  --source <code> [--dry-run --limit N --only 151,503 --max-pages N --max-locations N] | --fix
  [--dry-run] | --due | --run <id> | --corpus`.
- **Switches** (app_config, live): `CATALOG_HARVEST_ENABLED` (master), `CATALOG_SKU_FIX_ENABLED`
  (the save check), `CATALOG_AUTO_MERGE_ENABLED` (the weekly merges),
  `CATALOG_LISTING_FRESH_DAYS` (35), `RETENTION_CATALOG_RUNS_DAYS` (180).
- **Health**: `select s.code, st.code, r.started_at, r.items_found, r.products_new,
  r.names_updated, r.names_fr_filled, r.skus_merged, r.error from priceback.catalog_runs r join
  priceback.catalog_sources s on s.id = r.source_id join priceback.catalog_run_statuses st on
  st.id = r.status_id order by r.id desc limit 20;` A source with no good run in a week + 36 h is
  emailed at 09:00 (Toronto).
- **Production**: migration 0037 must be applied (by hand, then the ledger row) **before** the
  code deploys — every receipt save writes `receipt_items.sku_read`.

## Old app builds

The receipt POST answers each line's product id as before; a corrected line's product is the
real one, so builds since 3.0.6 show its official name, and every build keeps its own printed
text and number (`applyLineProducts` keeps "what was printed"). A shopper's edit that sends the
number READ back (`PUT /api/receipts/:id/lines`) is not a change: the line keeps its real
product. A phone naming a folded-away product by id or number (`POST /api/watch`, every build) is
answered with the real product. Every new field is additive (`skuRead` on line reads, admin
routes only otherwise); no route, field or status changed.

## Risks

- Costco's terms restrict automated access; the harvest reads once a week, politely spaced,
  public pages and the sitemaps the sites publish, and every source can be switched off
  (`enabled = false`).
- Same-Day is a third-party view of Costco: an item it does not sell is not in its catalogue —
  which is why a missing listing alone never proves a misread (the website sources and the
  "nothing official behind it" rule guard the fix pass).
- A wrong correction would file a line under a neighbouring item. The evidence rules, the live
  switches, `sku_read` on every corrected line and the merge records keep every change visible and
  reversible.
