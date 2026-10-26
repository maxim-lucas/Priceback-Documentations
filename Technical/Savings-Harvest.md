# Automated savings harvest (daily, $0) and savings-based price drops

Built 2026-10-26 (Maxim's request; "Solution B" confirmed twice by Monica the same day,
with every resulting drop held for admin approval). Backend migration **0036**.

## What it does

Every hour (minute 5) the API process checks `savings_sources` and runs the sources due
that hour. No extra Railway service, no browser, no OCR — **no extra cost**. Each source
is read by a script (an adapter), never by hand:

| Source (`savings_sources.code`) | What is read | Schedule (seeded) | Trust |
|---|---|---|---|
| `sameday_costco` | sameday.costco.ca **"Warehouse Savings"** collection (`rc-weekly-savings`) for **every warehouse** Same-Day lists (106) — in-store price, regular, saving, end date; delivery price; product photo | daily 00:00 | **1 = source of truth** |
| `sameday_business_centre` | the same on sameday.costcobusinesscentre.ca (11 Business Centres) | daily 01:00 | 1 |
| `costco_coupons` | costco.ca/o/-/coupons (coupon book: item numbers incl. ranges, "Valid … to …", "SAVE $N") | daily 02:00 | 10 |
| `costco_business_centre_web` | costcobusinesscentre.ca/o/-/warehouse-instant-savings | daily 02:00 | 10 |
| `yepsavings` | yepsavings.com store pages (≈20 warehouses): price-tag photos, clearance prices, amounts off | Mon + Thu 03:00 | 20 |

Hours are America/Toronto. A full Same-Day run takes ~25 min (~1,200 GraphQL GETs,
politely spaced). Facebook / Instagram are registered source **types** with no adapter
yet (Meta needs Graph API access): such a source's runs end `failed: adapter_not_implemented`.

### How Same-Day is read (no browser)

The storefront is an Apollo app on persisted queries. The script loads the storefront
(guest cookie `__Host-instacart_sid`), finds the lazy chunk named `operation-hashes` in the
webpack runtime (its file name changes every Instacart deploy, so it is rediscovered each
run) and calls `/graphql?operationName=…&extensions={persistedQuery:{sha256Hash}}` with
the operations the site itself uses: `WarehouseLocations` (every warehouse with its
warehouse number and postal code), `RetailersZone`, `ShopByRetailerLocation` (INSTORE and
DELIVERY shops), `CollectionProductsWithFeaturedProducts`, `Items`. Code:
`backend/services/savings/samedayClient.js`. If Instacart changes its app the run ends
`failed: layout_changed` (and the 09:00 stale alert emails ops).

## What is stored (and never duplicated)

- **`savings`** — an AMOUNT OFF (never a price) per product, province, end date, amount,
  minimum quantity — unique `NULLS NOT DISTINCT`, so reading the same saving again only
  updates `last_run_id` / `updated_at`. `saving_warehouses` links it to the warehouses that
  listed it (none = every warehouse of the province, e.g. the national coupon book).
- **Source of truth:** a less trusted source that disagrees with an active Same-Day saving
  (same product, province, end, different amount) is not written; a less trusted saving
  Same-Day contradicts gets `superseded_at`. Same for prices: a yepsavings tag price that
  Same-Day's in-store price contradicts is excluded (`flags.excluded`).
- **Prices** (`price_points`, `price_tag_scan`, device `d8c1b0f3a9e44d27` like the admin
  uploads): Same-Day in-store prices (`flags.sourceKind = "sameday_instore"`) and yepsavings
  tag photos (`"social_price_tag"` — a photographed tag is a warehouse price, Maxim).
  In-store prices count as **verified** only when uniform in the province and matching a
  real warehouse regular (receipts / tags / flyers); `.97`/`.00`/`.88` prices stay on their
  warehouse, never verified (`Technical/Costco-Price-Rules.md`). Delivery prices only set
  `products.price_sameday`.
- **Photos**: Same-Day product photos are copied to the R2 bucket
  `priceback-product-images` as `costco/<sku>.jpg`, once per SKU (HEAD check first).
- **Run history**: `savings_source_runs` — start/finish, status (`success`, `partial`,
  `failed`, `blocked`, `sanity_skipped`), warehouses checked, items found, savings confirmed
  / new, prices written, duplicates skipped, conflicts resolved, photos uploaded, error,
  details. Kept 180 days (`RETENTION_SAVINGS_RUNS_DAYS`). A saving's `first_run_id` /
  `last_run_id` say which run found it and which last confirmed it.
- **Sanity floor**: a run finding fewer than the source's `min_items`, or under half its
  last good run, writes nothing (`sanity_skipped`) — a layout change can't wipe data.

## Missing end dates (Admin · Saving dates)

A saving is **never skipped for a missing date** (Maxim, 2026-10-26): it is kept with
`valid_until` NULL. Every run dates what it can (an undated read of an offer already on
file with a date takes that date; an undated row on file is dated when a run reads the
offer with one — folded into its dated twin if one exists), then runs a capped per-item
lookup (costco.ca pages, yepsavings' item API). What is still undated waits on
**Admin · Saving dates → "Harvested savings without an end date"**, where the admin can
**Find dates** (one item or all — the server looks each item up: costco.ca pages,
yepsavings, one Same-Day warehouse of the province, the Same-Day product page; never the
full harvest) or enter the dates. An undated saving is never offered as a drop.

## Savings-based price drops ("Solution B")

`priceDropRepo.findNotifiable` now adds, for lines that have **no price-group drop**, the
drops found by `repos/savingDropRepo.js`: a live watched line whose receipt line carried
**no TPD** (`OFFERABLE_LINE`), bought at a warehouse the saving is linked to (or the saving
is province-wide, or the receipt names no warehouse), no later than the saving's last day
and no more than the store window before it started, while the saving still runs and the
store window is open — `new price = paid − saving`, `drop = saving` — unless a Same-Day
in-store price for the same window shows the shopper already paid the sale price. Same
materiality floor, same reachability rule, same dedupe ledger. The queue row carries
`saving_id`; the admin desk shows "Saving $X off · <source> · no TPD on the receipt".

Switches (app_config, live): `SAVING_DROPS_ENABLED` (default on),
`SAVING_DROP_REVIEW_REQUIRED` (default on — savings drops wait for an admin even when
`PRICE_DROP_REVIEW_REQUIRED` is off), `SAVINGS_HARVEST_ENABLED` (master switch).

## Operating it

- **Sources** (admin token, `x-admin-token`): `GET/POST /api/admin/savings/sources`,
  `PATCH /api/admin/savings/sources/:code` (`enabled`, `runsPerDay` 1–24, `daysPerWeek`
  1–7, `startHour` 0–23, `trustRank`, `minItems`, `config`), `POST …/:code/run` (starts a
  run now, 202), `GET /api/admin/savings/runs[?source=&limit=]`, `GET …/runs/:id` (the run
  and the savings it found / confirmed). Or SQL on `priceback.savings_sources`.
- **CLI** (from `backend/`, `.env` → DEV): `node --env-file=.env scripts/harvest-savings.mjs
  --list | --source <code> [--dry-run] [--only 531,524] [--limit 5] | --due | --run <id>`.
- **Health**: `select s.code, st.code, r.started_at, r.items_found, r.savings_confirmed, r.error
  from priceback.savings_source_runs r join priceback.savings_sources s on s.id = r.source_id
  join priceback.savings_run_statuses st on st.id = r.status_id order by r.id desc limit 20;`
  A source with no good run in its period + 36 h is emailed at 09:00 (Toronto).
- **Production**: migration 0036 must be applied (by hand, then the ledger row) **before**
  the code deploys — the review queue reads `saving_id`.

## Risks

- Costco's and yepsavings' terms restrict automated access / reuse; every source can be
  switched off (`enabled = false`). Runs are once a day, spaced, idempotent.
- Same-Day and yepsavings are third-party views of Costco; the admin approval on every
  savings drop is the safety net until the data has a track record.
