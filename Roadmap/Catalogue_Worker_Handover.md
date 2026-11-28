# Catalogue harvest on its own worker — handover for the next session

Written 2026-11-28 (Maxim: *"document the move the catalogue to a worker in the roadmap so a next session can do it"*). Background, measurements
and the cost estimate: `Roadmap/Parallel_Catalogue_Harvest.md` §5 (window, holds, workers, §5.5 cost). Read that first.

## Where things stand
- **Option A is shipped, OFF** (Priceback #785 → `main` #786): `jobs/nightCatalog.run` inside the API process, started by a `*/10` cron in
  `server.js`, switch `CATALOG_NIGHT_ENABLED` (admin flag), `CATALOG_NIGHT_WORKERS` (2, max 3). While it runs the API holds what competes
  with in-process flags (`_nightCatalogRunning`, `_sameDayBusy`, the sweep schedulers' `hold`).
- **Turn Option A on first, for at least one week**, and read `catalog_runs` every morning (did every province finish? any `blocked`?) and
  `railway usage` (the bill delta). The worker move is worth it only after A proves the shards.

## Goal
The API process serves shoppers only. The catalogue night run moves to a separate Railway service that starts at 23:00 Toronto, runs, and
exits, so it is billed only while it runs (estimate ~$1/month, §5.5). Then the savings harvest, then the sweep, one at a time.

## Steps (one PR, then the Railway setup)
1. **A cross-process lock.** In-process flags cannot see another service. Add `lib/harvestLock.js` on a Postgres advisory lock (the pattern
   of `backend/scripts/runLock.js`): `acquire("catalogue_harvest")` / `release`, plus `isHeld("catalogue_harvest")` (a
   `pg_try_advisory_lock` + immediate unlock, or a `harvest_locks` row with a heartbeat if session locks do not survive the pooler; **test this
   against the 5432 session pooler first**). `nightCatalog.run` takes it at start and drops it at the end.
2. **The API reads the lock, not its flag.** `_nightHold` and `_sameDayBusy` in `server.js` ask `harvestLock.isHeld` (cached ~30 s), so a
   run in the worker holds the sweeps and the hourly ticks exactly as a run in the API does today.
3. **The entry point.** `backend/workers/catalog.js`: load config (`configService.load`), check `CATALOG_NIGHT_ENABLED` and
   `nightWindow().canStart`, run `nightCatalog.run`, close the pool, `process.exit(0)`. It never starts the HTTP server or `server.js`'s crons.
   A thrown error exits 1 (Railway shows the run failed; the next night retries).
4. **One switch decides where it runs.** `CATALOG_NIGHT_IN_WORKER` (ops flag, default false): when true, the API's `*/10` night cron does
   nothing, so the two never both run. Flip it only after the worker's first good night.
5. **Tests:** the lock (acquire/held/release; a second acquire fails), the API hold reading the lock, the worker entry exiting 0 outside the
   window and when off, `ciParity` / `ciTriggerPolicy` untouched.
6. **Railway (Maxim's account, confirm before creating anything billed):** in the same project and environment, a new service from the
   same repo, root `backend`, start command `node workers/catalog.js`, **Cron Schedule `0 4 * * *` (04:00 UTC = 23:00 Toronto in winter;
   03:00 UTC in summer: one schedule cannot follow DST, so use `0 3 * * *` and let `nightWindow` refuse the hour before 23:00 by exiting,
   or schedule both `0 3,4 * * *`; the lock prevents a double run)**, the same variables as the API (`DATABASE_URL`, config keys) and no
   public domain. Memory limit low (512 MB).
7. **Measure** one week: `railway usage --json` before / after, the worker's minutes per night, the API's memory before / after. Keep it only
   if the projected bill stays under $5 with a margin; alarm at $4.50 (`sendBudgetAlert`).
8. **Rollback:** set `CATALOG_NIGHT_IN_WORKER=false` (the API runs the night again) and pause the worker's cron in Railway. Nothing else
   changes: same code, same tables.

## After it
- Savings harvest worker (`workers/savings.js`, the hourly probe 06–20 as a cron `5 11-1 * * *` UTC, the full run when the probe sees
  something new), same lock pattern under `samedaySession`.
- Price-sweep worker (`workers/sweep.js`), the daily sweep + the priority checks.
- More catalogue shards at once (per warehouse for ON / QC / BC), under the shared request budget (`Parallel_Catalogue_Harvest.md` §3.3).
