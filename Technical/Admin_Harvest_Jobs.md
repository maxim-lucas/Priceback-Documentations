# Admin · Harvest jobs: any harvest now, one warehouse or every warehouse

**Ask (Maxim, 2026-11-21):** *"a job run in the admin panel to initiate all jobs for harvest savings or catalogue
harvest or any harvest by warehouse and the possibility to have a full warehouses including business centers too as
the price sweep behavior. this should go in a separate screen in the admin desk."*

Screen: **Admin desk → Price Management → Harvest jobs** (`src/screens/AdminHarvestJobsScreen.js`), next to Price
sweep. The price sweep picks *a province or all*; this screen picks *a warehouse or all*.

## 1. The jobs

| Job | What runs | Every warehouse | One warehouse |
| --- | --- | --- | --- |
| Savings harvest | every enabled `savings_sources` row | each source exactly as its scheduled run (Same-Day Costco, Same-Day Business Centre, costco.ca, blogs) | the enabled Same-Day source(s) of that warehouse's storefront, reading that warehouse only |
| Catalogue harvest | every enabled `catalog_sources` row, then the misread fix pass | each source as its weekly run | a **prices pass** of the products already on file, at that warehouse only (no discovery, no names, no categories, no fix pass) |
| Stock read | the daily stock read (`watchedStock`) | every watched item | the watched items at that warehouse |
| Every harvest | the three above | one after the other: savings → catalogue → stock read | same, for that warehouse |

The storefront is the warehouse's channel (`warehouses.channel_id`, migration 0044): a Business Centre runs the
Business Centre sources, any other warehouse the Costco ones. A source with no warehouses (costco.ca, a blog) runs
only with **every warehouse**; for one warehouse it is listed as *not run* with the reason. The warehouse list is the
official one (`adminPriceLookupRepo.filterOptions().warehouses`, `lib/officialWarehouses`), the same as the price
lookup's.

"Every harvest" is sequential on purpose: one Same-Day reader at a time, as the scheduler keeps it. The stock read
still obeys its switch (`WAREHOUSE_STOCK_READ_ENABLED`) and waits while a scheduled harvest reads Same-Day.

## 2. A scoped run (one warehouse) never changes what the schedule sees

A run for one warehouse is **scoped**: its run row carries `details.scope = { warehouses: ["552"] }` from its start
(`startRun(id, { scope })`) through the heartbeat, its finish and an abandon (`finishRun` keeps the scope).

| Rule | Where |
| --- | --- |
| Never the schedule's last run, never the day's run, never the sanity baseline: `lastRun` / `runsSince` leave scoped rows out unless `{ includeScoped: true }` | `savingsRepo`, `productCatalogRepo` (`NOT_SCOPED`) |
| Still one run per source at a time: `runningRun` keeps scoped rows | same |
| An interrupted scoped run is never resumed (it is not the source's last run) | `jobs/harvestSavings` tick |
| Its prices speak for that warehouse: savings in-store prices are warehouse rows (`…:wh<code>:…` refs), never the province row, never verified | `savingsIngest.planHarvest` (`config.harvestScope`) |
| Its catalogue regular prices are warehouse rows only (`warehouseRowsOnly`); a province row is never written, so no warehouse row of the province is deleted. The next full run's province row removes any that equal it | `catalogIngest` |
| The source's floor (`min_items`) and the half-of-last check are for a full run; a scoped run that found nothing still writes nothing | `planHarvest`, `planCatalog` (prices mode) |
| A watched source's probe memory (what "new" is compared against) is never rewritten by it | `harvestSavings.runSource` |
| Savings links are additive and stock is recorded for the warehouses read only, as in a full run | `writeHarvest`, `recordHarvestStock` |

`config.harvestScope` is the in-memory marker the job puts on its copy of the source; it never touches the
`savings_sources` / `catalog_sources` row. (Not `config.scope`: costco.ca sources already use that key for
`national` / `business_centre`.)

## 3. One rule, one function

| Rule | Definition | Callers |
| --- | --- | --- |
| Which sources a run reads | `shared/harvestScope.plan` (+ `storefrontOf`, `byWarehouse`) | `backend/lib/harvestJobs` starts them; the screen greys out the others |
| Starting a harvest by hand | `backend/lib/harvestJobs.start` | `POST /api/admin/harvest-jobs/:job/run`, and the token route `POST /api/admin/jobs/harvestSavings|harvestCatalog/run` (its old inline loop folded into it) |

## 4. Routes (admin account, like Price sweep)

- `GET /api/admin/harvest-jobs` — each source (code, name, type, enabled, storefront, byWarehouse, its open run with
  scope and progress, its last 3 runs), the stock read and "every harvest" state, the stock read's settings, the
  official warehouses.
- `POST /api/admin/harvest-jobs/:job/run` `{ warehouse? }` — `harvestSavings` | `harvestCatalog` | `stockRead` |
  `all`. 202 `{ started, running, skipped }`; 409 `already_running` or `nothing_to_run`; 400 for a warehouse that is
  not on the official list; 404 for any other job. Rate-limited per admin (`admin-harvest-jobs`, `-run`).

New, admin-only: no shipped shopper build calls them.

## 5. Cost

Nothing runs unless an admin presses Run now: no schedule changed, no new cron. A one-warehouse savings run is one
warehouse's Same-Day list (~1/80 of a full read: seconds, a few dozen requests); a one-warehouse catalogue prices pass
reads the products on file at one warehouse, in-store and delivery (~2 × products / batch requests). "Every
warehouse" costs exactly one scheduled run of each source.

## 6. Tests

`backend/tests/harvestJobs.test.js` (orchestration, the plan, the sequential chain),
`harvestScopeRuns.test.js` (scoped `runSource`, ingest prices and floors), `harvestJobsDb.test.js` (the repo filters
and the routes, dev DB), `__tests__/adminHarvestJobsScreen.test.js`.
