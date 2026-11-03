# Products catalogue rebuild, regular prices per place, and database egress — design

Status: **draft for Maxim's approval** · 2026-11-02 · branch for the code: a hotfix branch off
`main` (Maxim's choice) · environments: **dev first, prod only on Maxim's explicit go**.

## 1. Why

The `products` table is the reference every receipt is checked against: the database fill of
a line the scan could not read, the correction of a misread item number, the price-drop sweep,
and the application of a harvested saving. Bad rows there cost shoppers real money, and they
don't fix themselves:

- a misread item number becomes its own product, so its price never meets the real item's
  price and **a price drop is missed**;
- a misparsed name becomes the product's name, so the **next database fill writes garbage**
  onto a new receipt;
- the catalogue harvest still misses products, and a saving whose product or regular price is
  unknown is **missing for shoppers** (Maxim's shrimp example, below).

Maxim wants, in his words: a full product table for the whole Costco Canada catalogue
(nationwide), with the right item numbers, official labels in English and French **and** the
receipt's short label in both languages; every receipt line linked to the right product; a
separate table of **regular prices** (warehouse, Same-Day, costco.ca) so savings apply to the
original price; and a backup of every affected table before anything is changed. Later
(roadmap, **not in this work**): price drops driven by these prices, and a warehouse price
catalogue inside the app.

Two constraints surfaced on the way and are part of this work: the Supabase plan's **egress
quota is being exceeded this month** (dev and prod share one plan), and every scheduled job
must run **only when its source actually changes**.

## 2. What exists today (measured 2026-11-02)

**Catalogue harvest** (`Technical/Product-Catalog-Harvest.md`, migration 0037): four sources —
Same-Day (`sameday_costco_catalog`), Business Centre Same-Day
(`sameday_business_centre_catalog`), costco.ca (`costco_ca_catalog`), costcobusinesscentre.ca
(`costco_business_centre_catalog`). First prod run 2026-11-01. It names products in EN/FR,
folds misread item numbers into the real product (`product_merges`, alias kept) and corrects a
misread number on every receipt save (`lib/receiptCatalogMatch.js`).

**Prod** (`xjfrlzwonyaorwktnkpj`):

| | |
|---|---|
| products | 11,063 (10,917 numeric SKUs, 139 `ln:` placeholders, 1 `bc:`) |
| confirmed by at least one catalogue source | 10,138 |
| products on live receipt lines | 1,340 — 1,027 catalogue-listed, **243 numeric SKUs no source lists**, **70 `ln:` placeholders** |
| receipts / receipt lines | 236 / 2,744 |
| merges ever made | 3 |
| warehouses | **186** — Same-Day lists 104 Costco + 11 Business Centres; ~80 rows are junk (`80xx` codes created 2026-06-21…27, no name, no receipt, no price) |
| products with `price_sameday` | 734 (one number for the whole country) |
| DB size | 65 MB |

**Why products are missing:**
- costco.ca: ~15,500 product pages, read **400 a week** (`config.maxPages`) → 199 verified items.
  costcobusinesscentre.ca: 5,329 pages, 200 a week → 99.
- Same-Day catalogue: read at **25 warehouses** (`config.maxLocations`); Business Centre at 11.
- Some items are on **no website** (meat by weight, produce, regional items such as
  `663 GRAY 5DZN` in Ontario): only receipts and tags can name them.
- The catalogue harvest reads Same-Day items through the **in-store shop**
  (`samedayCatalogSource.js:108`, `"INSTORE"`), which carries the warehouse shelf price — and
  throws the price away.

**The eggs example (Maxim):**

| SKU | Product today | What receipts print | Truth |
|---|---|---|---|
| 669 | "Large Eggs" / "Grands œufs, 5 douzaines" (Same-Day's EN name drops the size) | `5 DOZ EGGS` (EN), `OEUF 5 DOZ` (FR) | the real 5-dozen item |
| 667 | "DOZ EGGS", made 2026-11-03 01:44 UTC on `r_1793552939526_mkxkq` (Calgary, 2 × 19.49) | `DOZ EGGS` | no source lists it — a misread of 669 or a western item: a suspect |
| 1705959 | "KS OEUFS" | `KS OEUFS` | misread of **1706959** (Kirkland free-run eggs) — not folded |
| 313953 | "KS BIO OEUFS" | `KS BIO OEUFS` | misread of **313963** (Kirkland organic eggs) — not folded |

**The missing saving (Maxim): 362866 "31/40 Raw Shrimp", $6 off $27.99, ends 2026-11-08.**
Same-Day lists it live at Vaughan (#1261) — one of 270 savings ending Nov 8 at that warehouse.
Prod has the product but no saving. Cause: `sameday_costco` savings run once a day at **00:05
Toronto**; on 2026-11-02 it ran before Same-Day published the new savings (it still listed
5,805 savings that ended Nov 1), so the new ones wait a full day for the next run.

**Egress** (`pg_stat_statements`, cumulative since 2026-06-19/20, both projects):

| Where | What | Volume |
|---|---|---|
| dev | `pricesRepo.namedProductsForStore` — the whole products table per database-fill receipt (written for ~1.8k rows; the catalogue made it 17.7k) | **97 M rows** in 5,479 calls |
| prod | same query | 67 calls × 6,300 rows, growing with every fill |
| prod | `app_config` single-key `SELECT value … WHERE key = $1` (uncached) | 5.9 M calls |
| prod | product by `(store_id, sku)`, one at a time (two column lists) | 7.5 M calls |
| prod | verified-drop `WITH fresh AS (… price_points … devices …)` per product | 7.5 M calls |
| prod | warehouse id by code, one at a time | 1.4 M calls |
| prod | `SELECT DISTINCT p.sku, w.code, pv.code FROM price_points …` | 5,336 calls × 1,414 rows |
| both | `dbBackup` (`lib/dbBackup.js`, 04:10 UTC daily) reads **every table** to R2 | ~65 MB × 30 ≈ **2 GB / month** on prod alone (dev ran it too) |
| dev | **the whole scheduler ran on dev Railway** against the dev DB: `adminAlerts` every 5 min, store-launch and tips backfill every 15 min, both harvests hourly, price sweeps, re-engagement pushes | — |

Already done 2026-11-02: dev `app_config` `SAVINGS_HARVEST_ENABLED` and
`CATALOG_HARVEST_ENABLED` set to `false` (only `server.js` reads them; no test does).

## 3. Goals, non-goals, anti-goals

**Goals**
1. Cut database egress at its sources and stop the dev Railway scheduler for good.
2. Every scheduled job runs only as often as its source changes; the Same-Day savings run
   starts after Same-Day publishes the day's savings.
3. Each product carries its official name (EN, FR), its **receipt short name (EN, FR)**, and a
   **channel flag** with exactly two values: `costco` or `business_centre`.
4. A **regular-prices table**: every source's regular price per product and place; it replaces
   `products.price_sameday`; savings are applied against it.
5. A **complete nationwide catalogue**: every product page of every source, every province.
6. **Clean data**: misread products folded into the real ones, wrong labels corrected, junk
   warehouses removed — after a full backup.
7. **Proof** over every production receipt that no price changed.

**Non-goals (this work)**
- Price drops computed from the regular-prices table; the in-app catalogue (roadmap).
- Any change to the receipt parsers (`shared/` Costco parsing is untouched).
- Costco's internal APIs (public pages, sitemaps and the Same-Day storefront's own queries only,
  as today).

**Anti-goals — failure even if it "works"**
- Deleting and re-creating products with new ids. Deleting a product **cascades** to its price
  points, savings, pending savings, tag reviews, settlements and catalogue listings, and
  installed phones hold product ids. Products are rebuilt **in place**; a bad duplicate is
  folded into the real product with an alias.
- Any receipt whose paid prices, quantities or totals change without Maxim approving it.
- A cleanup that sends pushes or charges commission on its own.
- More egress than before (no table read wholesale on a request path; no per-item query loops in
  jobs).
- A real regional item folded away as a "misread".
- Dev running scheduled jobs again.

## 4. Constraints

- **Old app builds** (`Technical/Backend_Backward_Compatibility.md`): additive only. Every
  product id an old build holds keeps resolving (a folded id is answered with the real product,
  as `product_merges` already does for `/api/watch`). No response field removed or changed.
  `products.price_sameday` is dropped only in a later migration, after no deployed backend
  reads it (the builder confirms no client reads it — only backend writers were found).
- **Migrations**: expand → migrate → contract; idempotent; applied to prod **by hand** (prod's
  drizzle ledger is hand-maintained) **before** the code that needs them deploys; consolidated
  schema regenerated.
- **DB design rules** (`database_design.md`): small value sets are lookup tables (`id`, `code`,
  `label`), never free-text enums; every column has a writer and a reader on day one; money is
  `numeric(10,2)`. The regular-prices table is a **documented exception to rule 10** ("every
  observed price is a `price_points` row"), made at Maxim's explicit request — see §6.4.
- **Labels**: admin screens may stay English but never show raw codes; anything a shopper sees is
  EN + FR (`npm run i18n:check`).
- **Price drops** stay behind the admin review: prod has `PRICE_DROP_REVIEW_REQUIRED = true` and
  `SAVING_DROP_REVIEW_REQUIRED = true`.
- **Receipt repair docs**: every receipt whose lines the cleanup re-links gets its root cause and
  case recorded in `Technical/Receipt_Parser_Root_Causes.md`, and the run is logged in
  `Operations/Bad_Scan_Receipt_Repair_Runbook.md`.
- **Egress is a budget**: dev and prod share one Supabase plan. The dev Railway service runs no
  scheduled job, ever.
- Tests ship with each change, full coverage; task log entry; `Bugs_Common_Fixes.md` entry for
  the egress leak.

## 5. What Maxim decided

1. Branch: a new hotfix branch off `main`. Database: dev first; prod only on his go.
2. Back up products and every table that refers to a product before the fix.
3. Rebuild in place, not from scratch (§3 anti-goals).
4. Store the receipt short label per product in both languages.
5. A regular-prices table; the Same-Day price moves into it; savings apply against it. Prices as
   **rows keyed by place** rather than one column per source ("I like your idea"), stored per
   province with a warehouse row only where a warehouse differs.
6. A channel flag with **only two values**: `costco` when the item is sold anywhere in regular
   Costco (warehouse, costco.ca, Same-Day) — even if Business Centre sells it too; and
   `business_centre` when it is sold nowhere but Business Centre.
7. No-regression proof: a receipt may come out with a better item number or label; **if any
   price changes, the receipt is shown to Maxim for approval**.
8. Savings: **move the run after Same-Day publishes**, don't add runs.
9. Every job is scheduled only when necessary (specific days vs daily, etc.).
10. Dev Railway never runs scheduled jobs again. Dev and prod share the same plan.
11. Warehouse prices from Same-Day's in-store view are wanted ("if possible include it" — it is
    possible, §2).
12. Official names stay **as the sources give them** (no size appended). In addition, store a
    **full-length name** with the size, as Same-Day shows it, in both languages (§6.3).
13. Re-linked receipts are documented **one root-cause section per class** with a case table
    listing every receipt, plus the §6.7 before/after price proof — no per-receipt replay.
14. **Fee lines** (eco / enviro fee, deposit / consigne — and, like them, membership fees and
    similar non-merchandise lines) are separate receipt lines that belong to the **product on the
    line before them**. For now: **never fill their item number** from the database (it does not
    exist as a product), and they are **never price-tracked, watched or offered as a drop**.
    Linking a fee to its product is a roadmap parser improvement (`Roadmap/FUTURE_ROADMAP.md`,
    "Receipt fee lines belong to the line above"), not this work. See §6.8.

## 6. Design

### 6.1 Egress (ships first)

1. **Scheduler gate.** The cron block in `startServer()` (`server.js` ~13916–14230) runs only
   when `RAILWAY_ENVIRONMENT_NAME` is the production environment **or** `SCHEDULED_JOBS_ENABLED
   =true`; `SCHEDULED_JOBS_ENABLED=false` forces it off. Absent both → off, so a new or
   renamed non-prod environment is off by default. `/health` reports whether the scheduler is
   on. Before merge, read prod's real `RAILWAY_ENVIRONMENT_NAME` with the Railway CLI (logged in
   locally) — a wrong name would stop prod's jobs. Set `SCHEDULED_JOBS_ENABLED=false` on the
   dev service as belt and braces.
2. **`namedProductsForStore`** (`repos/pricesRepo.js:378`, used by
   `lib/receiptDatabaseFill.js:179`): never download the table per receipt. *As built (Part A,
   Task 3):* the candidate list is kept in memory per store — one full read, then incremental
   reads of the newest ids looking back 500 ids (receipt-save transactions commit out of id
   order), de-duplicated by SKU, and a full re-read hourly for renames; rows only the caller's
   transaction can see are returned but never cached. The fill's decision function and filter
   are unchanged.
0. **The one loop behind prod's top volumes** (found while planning Part A): the price sweep's
   tag-credit settlement (`tagCreditsRepo.settleAllVerified`) enumerated ~1,414 pools per
   sweep and, per pool, read the product by SKU (the 7.5 M product reads), ran `WITH fresh AS`
   (7.5 M), tried the settlement insert (5.9 M) and read `PRICE_TAG_ALREADY_VERIFIED_NO_CREDIT`
   fresh (the 5.9 M config reads) — ~460k queries a day at the 2-minute sweep cadence of
   2026-11-02. *As built (Part A, Task 2):* pools already settled this week are not enumerated
   (no caller → nobody to pay → no outcome change), the product id comes with the pool, and the
   switch is read only when a shopper scans. Items 3 and 5 below are therefore **not done**.
3. ~~Config reads~~ (*superseded by item 0 — the fresh readers stay as they are*): the 5.9 M single-key reads come from the deliberately *fresh* readers
   (`configService.readOpsFlagFresh` / `readOpsNumberFresh`) — most likely `/api/v1/app-status`
   on every app launch (`server.js` ~3481). *Claude's call:* per-request readers (app-status:
   minimum build, maintenance) get a short in-process cache of **≤ 60 s** — "the next launch"
   becomes "a launch a minute later", and prod runs one instance; **money-moving kill switches
   stay fresh** (price-drop push pause `priceDropNotifier.js:401`, tag-scan limits, Gemini
   switches). Confirm the caller from the query's call pattern before changing it.
7. **Daily backup** (`dbBackup`, ~2 GB/month): part of the job audit (§6.2) — e.g. back up only
   the tables that changed, or weekly full + daily incremental, or let Supabase's own backups
   cover it. Not dropped without Maxim's go: it is the only off-Supabase copy.
4. **Jobs**: no per-item lookup loops. A harvest loads the store's `sku → id` map (and
   `warehouse code → id`) once per run, then writes set-based (`jsonb_array_elements`, as
   `costcoImportRepo` already does).
5. ~~Verified-drop check~~ (*superseded by item 0*): the `WITH fresh AS` and
   `SELECT DISTINCT sku, warehouse, province` volumes were both the tag-credit loop.
6. **Measure**: record each top query's calls/rows before the change (a snapshot of
   `pg_stat_statements`, not a reset) and again 7 days after deploy; report egress from the
   Supabase usage page for both projects.

### 6.2 Scheduling

- **Same-Day savings** (`sameday_costco`, `sameday_business_centre`): first **measure when
  Same-Day publishes** a day's new savings — a small read-only local probe of one warehouse's
  savings collection, hourly, across at least one rollover (no DB writes; or, if the raw
  `Items` JSON carries a start timestamp, read it there). Then set `start_hour` (and the Business
  Centre's) just after that time, `runs_per_day = 1`. The runs keep their catch-up.
- **Every other job**: one table in the doc listing each job (the cron list in `server.js` plus
  the two harvest ticks and the price sweep), what it reads, what changes its input, its cadence
  today and the proposed one. Known starting points: catalogue weekly; yepsavings Mon + Thu;
  coupon book only matters when the book changes (skip all writes when the page is unchanged);
  `adminAlerts` every 5 min, `runStoreLaunchNotifications` and `pastReceiptsTipBackfill` every
  15 min, `purgeRestoreLedgers` hourly — each justified or slowed. A job's tick that finds
  nothing due must cost one cheap query at most.

### 6.2a Job audit (measured 2026-11-03 — Maxim decides each change)

Prod `job_runs`, last 7 days (test jobs excluded). "Reads" from the job's code. Nothing here
is changed without Maxim's go; the proposals cost a little latency, never correctness.

| Job | Cadence today | Runs/day | Avg | Reads / what changes its input | Proposal |
|---|---|---|---|---|---|
| `priceSweep` | admin knob `PRICE_SWEEP_INTERVAL_MINUTES` — prod **60**; it ran **every 2 min** on 2026-11-02 17:00–01:00 UTC (30/h) | 324 (7-day avg) | 60–97 s | the verified-drop sweep (`findNotifiable`, ~150k blocks/call), the tag-credit settlement (Task 2 fix), policy healing. New observations already trigger a debounced regional sweep 4 s after they land (`scheduleVerifiedDropSweep`), so the scheduled one is the safety net | **keep 60**; never below 30 from the admin page (a floor in `sweepScheduler.resolveIntervalMinutes`) |
| `adminAlerts` | every 5 min | 288 | 0.9 s | new receipts, accounts, shopper notices, duplicates, and the **live** potential-drop list (`potentialDropRepo.listPotential`) | **every 15 min** (an admin alert 10 min later) |
| `runStoreLaunchNotifications` | every 15 min | 96 | 0.15 s | stores just enabled — changes only when an admin enables a store | **hourly** (or fire it from the store-enable route) |
| `pastReceiptsTipBackfill` | every 15 min | 75 | 0 ms (no work) | the past-receipts tip backlog | **hourly** |
| `purgeRestoreLedgers` | hourly | 24 | 0.2 s | deletions older than the 2 h credit-restore window | keep |
| `harvestSavings` tick | hourly :05 | 24 | — | which savings source is due (2 small reads); real runs: Same-Day daily, Business Centre daily, coupons daily, BC web daily, yepsavings Mon + Thu | keep the tick; **Same-Day start hour after publication** (Task 4 measurement, Mon 2026-11-09); coupon book: skip all writes when the page is unchanged |
| `harvestCatalog` tick | hourly :35 | 23 | — | which catalogue source is due; runs weekly (Sunday) | keep (cheap; it carries the catch-up) |
| `ocrAuthProbe` | 6-hourly | 4 | 0.07 s | one Vision probe | keep |
| `sweepInMemoryState` | 6-hourly | 4 | 1 ms | memory only | keep |
| `reengagement`, `pastReceiptsTip`, `pendingClaimsReminder`, `inactiveClaimsNudge`, `priceDropGuarantee` | daily (+ a boot catch-up, hence ~3.4/day around deploys) | 3–3.4 | ≤ 7 s | shopper state, daily by design | keep |
| `runDailyDigest`, `runDailyMaintenance`, `runDbRetentionJobs`, `reconcileCredits`, `pruneAuthOutcomes`, `pruneNotificationHistory` | daily | 1 | ≤ 1.4 s | — | keep |
| `purgeDeletedAccounts` | monthly (28–31) | — | 0.2 s | — | keep |
| **`dbBackup`** | daily 04:10 UTC | 1 | **79 s** | **every table** to R2 — ~65 MB/day, **~2 GB/month** of egress | Maxim: (a) weekly full backup + Supabase's own daily backups, (b) daily but only tables changed since the last backup, (c) keep daily. Not changed without his go — it is the only off-Supabase copy |

### 6.3 Product model

New on `products` (migration, additive):
- `receipt_name` (EN) and `receipt_name_fr` — the register's short label, e.g. `5 DOZ EGGS` /
  `OEUF 5 DOZ`. Filled from live receipt lines' `printed_name`: the text printed most often in
  that language, ignoring lines the shopper edited or the database filled; a later run updates it
  only when another text clearly wins. Language of a line = the receipt's language (the parser's
  own language detection where the receipt keeps it, else the warehouse's province: Québec →
  French). An admin save on Admin · Product names locks it like the official name.
- `full_name` (EN) and `full_name_fr` — the long label **with the size**, as Same-Day shows it
  (its item name + its size: `Large Eggs` + `60 ct` → "Large Eggs, 60 ct"; French likewise).
  Taken from the most trusted fresh listing that has a size (Same-Day first, then the Business
  Centre Same-Day, then a website page whose JSON-LD carries a size); NULL when no source gives a
  size. The official `display_name` / `display_name_fr` are **not** changed (Maxim). Same lock
  and trust rules as the official name. Readers: Admin · Product names, and the misread fixer's
  name evidence (a size tells "KS WATER 24PK" from "KS WATER 40PK").
- `channel_id` → new lookup `channels` (`costco`, `business_centre`), `NOT NULL`, default
  `costco`. **`business_centre` only when every piece of evidence is Business Centre**: a verified
  Business Centre listing (either BC source), a BC saving, a line on a receipt from a BC
  warehouse, a BC price row — and nothing from regular Costco (a Costco source listing, a Costco
  saving, a regular-warehouse receipt line, a Costco price row, a flyer). No evidence →
  `costco`. Recomputed set-based after each harvest run, never per request.
- `warehouses.channel_id` → the same lookup (the 11 Business Centres = `business_centre`).

**Readers on day one:** the database fill writes the receipt name in the receipt's language
(falling back to the official name) — this is what makes Maxim's eggs line read `5 DOZ EGGS`;
the catalogue fixer's printed-text evidence can use it; Admin · Product names shows and edits
both; the channel flag is shown and filterable on the admin product pages and is written into
the catalogue reports. (Which regular a saving uses is decided by the **warehouse's** channel,
not the product's — §6.4.)

### 6.4 Regular-prices table

`product_regular_prices` — the **current** regular (non-sale) price of a product at a place, per
kind of price. One row per **(product, channel, kind, province, warehouse)**, unique with
`NULLS NOT DISTINCT`:

| column | |
|---|---|
| `product_id` | FK products, cascade |
| `channel_id` | FK channels — Costco or Business Centre price list |
| `kind_id` | FK new lookup `regular_price_kinds`: `warehouse` (shelf price in a warehouse: Same-Day in-store view, receipts, tags), `sameday` (Same-Day delivery price), `website` (costco.ca / costcobusinesscentre.ca) |
| `province_id` | FK provinces; NULL = national (a website price) |
| `warehouse_id` | FK warehouses; NULL = the province's price |
| `regular_price` | numeric(10,2) NOT NULL |
| `source` (lookup or the harvest source id) | where the price came from, for trust order |
| `first_seen_at`, `last_seen_at`, `last_run_id` | freshness |

**Resolution, most specific first:** the warehouse row → the province row → the national row.
**Writes store only what differs from the level above** (Maxim's idea, optimised): the province
row is the price most of the province's warehouses show; a warehouse row exists only where that
warehouse differs. That keeps the table in the tens of thousands of rows instead of ~2 million.
Weighted items (per-kg) get no regular price, as today.

**Trust order** for the `warehouse` kind: Same-Day in-store regular (official, current) over a
regular read off a receipt or a tag; a receipt/tag never overwrites a fresher official price.
A price that stops being seen is kept with its `last_seen_at` (readers decide freshness); it is
not deleted by a run that missed a page.

**Writers:** the Same-Day catalogue harvest (in-store → `warehouse`, delivery → `sameday`, per
warehouse read); the daily Same-Day savings run (its in-store `shelfRegular` for every warehouse
it reads → warehouse rows where they differ); the costco.ca / Business Centre site harvest
(`website`, from the page's JSON-LD offer); the admin Costco price upload (today's
`price_sameday` writer); receipts and tags as the fallback warehouse regular.
**Readers (this work):**
- **The admin Costco price upload** ("Solution A": `lib/costcoPriceImport.js`,
  `repos/costcoImportRepo.regularsForSavings`) — it turns a saving into a `verified` price point
  worth *regular − saving* in any province, and parks a saving with no known regular in
  `pending_price_savings`. Today its regular is the latest `price_points.regular_unit_price` per
  SKU + province. It reads **this table first** (that lookup stays as the fallback), and a pending
  saving resolves when a regular appears here.
- **The rule a saving follows** (*Claude's call*): only the **`warehouse` kind** — never the
  costco.ca or Same-Day delivery price, which run above the shelf
  (`Operations/Costco_Price_Upload_Console.md`) and would inflate refunds; the **warehouse's
  channel** (a Business Centre saving uses the Business Centre list even for a product flagged
  `costco`); the warehouse row, else the province row; **no older than 35 days**
  (`last_seen_at`; a new `app_config` key, default 35) — older means pending, as with no price.
- The admin product page.

**Not readers in this work (roadmap):** the daily savings harvest's drops ("Solution B",
`repos/savingDropRepo.js`: new price = Same-Day's in-store sale price, else paid − saving) and the
price-group sweep keep their arithmetic. Linking drops to this table is Maxim's roadmap item, and
changing it here would change which drops fire and for how much.

`products.price_sameday` has **no reader** anywhere (client or server); its two writers
(`costcoImportRepo.js:125`, `savingsRepo.js:497`) move to this table, and the column is dropped
in a later migration.

**Why a table outside `price_points`**: Maxim asked for it; `price_points` stays the log of what
was *observed or paid*; this table is the *reference regular per place* that savings are applied
to. Document the exception in `database_design.md`.

**Same-Day coverage (builder's call, with this default):** the weekly catalogue run reads every
product at **two warehouses per province** (plus every Business Centre) for province rows and
regional availability; the daily savings run, which already reads all 104 warehouses, supplies
warehouse-level regulars for the items it sees. Reading every product at all 104 warehouses
(~17,500 requests, ~6 h, a higher risk of being walled) is not the default.

### 6.5 Full harvest

- costco.ca and costcobusinesscentre.ca: a **one-off full read** of every product page (both
  languages), run as a CLI job (not the hourly tick), resumable, politely spaced — it captures the
  item number, names and the online price. After it, the weekly run reads what changed in the
  sitemaps plus a rotating slice, so every page is re-read at least every ~4 weeks (builder sets
  the slice size from measured page cost).
- Same-Day: per §6.4 coverage, every warehouse location list refreshed from
  `WarehouseLocations` (it also repairs the warehouses table, §6.6).
- Each run fills receipt names and the channel flag (§6.3) at its end, set-based.
- Sanity floors stay (a run far below its last good run writes nothing).

### 6.6 Cleanup

Order, each step dev first, then prod on Maxim's go:

1. **Backup**, server-side (`CREATE TABLE … AS SELECT`, no egress), into a dated schema
   `backup_YYYYMMDD` not exposed to the API: `products`, `receipt_items`, `price_points`,
   `catalog_items`, `product_merges`, `pending_price_savings`, `savings`, `saving_warehouses`,
   `tag_scan_reviews`, `tag_credit_settlements`, `warehouses`, `receipts` (warehouse link), the
   watch registrations table, `price_drop_review_queue`, `price_drop_notifications`,
   `price_drop_guarantees`. A restore script, tested on dev, puts any table back.
2. **Warehouses**: reconcile with Same-Day's 104 + 11 locations (code, name, city, province,
   channel). A row with no reference at all and no real location is deleted (the `80xx` junk); a
   referenced row that matches no real location is listed for Maxim, never deleted.
3. **Misread products**: run the existing fixer (`services/catalog/catalogFixer.js`, `skuMatch.js`)
   against the complete catalogue in dry-run; extend its evidence with the receipt names
   (§6.3). Automatic folds follow its current rules; everything weaker — e.g. `667 DOZ EGGS` vs
   `669` — is listed for Maxim. `ln:` placeholders on live lines are matched by printed text +
   price to a real product the same way, never by name alone.
4. **Labels**: official names re-taken from the most trusted fresh source (the harvest's rules,
   name locks respected); full-length names and receipt names filled.
5. **Docs**: in `Technical/Receipt_Parser_Root_Causes.md`, **one section per class** of
   re-link (Maxim) — e.g. "OCR digit misread, folded by the catalogue", "no item number printed
   (`ln:` placeholder)" — each naming the printed shape, the code path that created the bad
   product, and a case table of every receipt it re-linked (receipt, line, SKU read → real SKU,
   evidence), no per-receipt replay; the run logged in the repair runbook; harvest and savings
   docs updated.

### 6.7 No-regression proof

A script, read-only except inside a rolled-back transaction:

1. **Before snapshot** of every prod receipt (live and soft-deleted): per line — id, position,
   product id, SKU, product name, printed name, quantity, unit price, line total, original price,
   claimed/claim source, watch, ignored, `sku_read`; per receipt — totals, tax, warehouse; plus
   the drop review queue, notifications ledger and guarantees.
2. **Simulate**: apply the planned cleanup inside a transaction, take the **after snapshot**,
   **roll back**.
3. **Diff and classify** each receipt: *unchanged* · *better item number / label only*
   (auto-accepted under Maxim's rule, listed) · ***price, quantity or total changed***
   (**blocked**; shown to Maxim with before/after) · *a drop becomes newly eligible* (listed;
   it would enter the admin review queue, no push, no charge).
4. Maxim approves the blocked list (or not); the apply step then runs the **same plan** after the
   backup, and the after-state is re-verified against the simulated one.
5. Also re-run the receipt golden corpus and `scripts/harvest-catalog.mjs --corpus`: unchanged
   except the listed corrections.

### 6.8 Fee lines (Maxim, 2026-11-03)

**What a receipt prints:** an eco / enviro fee (`ENVIRO FEE`, `ECO FEE`, `ECOFRAIS`) or a
container deposit (`DEPOSIT`, `DEPOSIT QC`, `CONSIGNE`) is printed as **its own line, right after
the item it is charged on** — `DEPOSIT CL` after a case of water, `ENVIRO FEE C` after a
battery-powered item. It is part of that item's cost, not a product. Membership fees and similar
lines behave the same way for tracking.

**Prod today (2026-11-03):** 91 live fee lines — **all `ignored = true`**, none watched, none
filled from the database, no price point on any fee product. 61 sit on `ln:` placeholders; **30
carry a number the receipt printed** next to the fee (`9484 DEPOSIT`, `9491 CONSIGNE QC/310062`,
`6377 ECO FEE`, `4391 ENVIRO FEE`…), so those fee rows exist as numbered products. The database
fill already skips an `ignored` line (`lib/receiptDatabaseFill.js:131`, `:203`).

**Rules for this work:**
- The database fill never fills an item number or a name on a fee line. Guard by **the printed
  text too**, not only the `ignored` flag (a fee line an old build sends without the flag must
  still be skipped) — `FEE_NAME` in `lib/receiptAutoFix.js:51` is the existing pattern; share it,
  don't copy it.
- A fee line is never watched, never filed as a price point, never a drop (unchanged; the save
  path's guard keeps it whatever the client sends).
- The catalogue fixer, the cleanup and the regular-prices table **exclude fee products**: a fee
  product (by its names, or because every line it ever had is a fee line) is never a misread
  suspect, never folded, never renamed, never given a price row, never counted for the channel
  flag. Numbered fee products (`9484 DEPOSIT`…) stay as they are.
- §6.7's proof lists any fee line whose state would change — expected: none.

## 7. Order of work

| Part | Ships as | Notes |
|---|---|---|
| A. Egress + scheduler gate (§6.1) | PR 1 → `main` | first: the budget is burning; prod deploy on Maxim's go |
| B. Savings start hour (§6.2) | config change after the probe | a prod `savings_sources` row update, on Maxim's go |
| C. Job schedule audit (§6.2) | PR 1 or 2 | config rows + any code cadence |
| D. Schema expand (§6.3, §6.4) | PR 2 | migration on dev, then prod by hand before the code |
| E. Harvest writes names, flag, prices; full read (§6.4, §6.5) | PR 3 | full read run on dev, then prod |
| F. Cleanup + proof (§6.6, §6.7) | PR 4 (scripts) + runs | backup → simulate → Maxim approves → apply |

Each PR targets `main` as a hotfix (Maxim's choice), and `main` is merged into
`main-test-features` the same day (through a `sync/…` branch, never a long-lived branch as PR
head). Branch names (*Claude's call*): `hotfix/egress-and-job-schedules` (A–C),
`hotfix/products-catalog-model` (D–E), `hotfix/products-catalog-cleanup` (F); docs on
`docs/products-catalog-rebuild`.

## 8. Old app builds

No route, field or meaning changes. New product columns are not added to existing responses
unless a new optional field is needed. A folded product id keeps answering with the real product
(existing alias path). The scheduler gate and egress changes are server-internal. A database-fill
name in the receipt's language changes only what is written on **new** receipts; the phone
receives a printed name either way.

## 9. Left to the builder

- Exact SQL of the candidate query that replaces `namedProductsForStore`, provided the fill's
  decisions on the corpus are unchanged.
- How the receipt language is determined when the receipt keeps no raw text (§6.3 rule is the
  floor).
- Lookup-table naming, indexes, the restore script's shape.
- The rotating-slice size for the websites; the Same-Day request spacing.
- The job table's proposed cadences, each with its reason.
- Whether the regular-prices `source` is a lookup or a reference to the harvest source rows.
