# Backend performance: where the time goes, and how to measure it

**Started 2026-11-23** (Priceback #675 → main, #678 → main-test-features) after Maxim reported the app, and the Price-drop queue most of all, as very slow, and suspected the harvest jobs. This page holds the baseline, how to re-measure it, what was changed, and the levers still open. **Measure before changing anything**: twice now a slow screen looked like the database or a job, and it was neither.

## 1. Baseline (production, 2026-11-23, read-only)

| Measured | Value | Source |
|---|---|---|
| Postgres buffer cache hit | 99.9997 % | `pg_stat_database` |
| Largest table | `product_regular_prices` 93 MB (228 K rows); `price_points` 33 MB | `pg_stat_user_tables` |
| `max_connections` | 60 (Supabase Micro) | `pg_settings` |
| Connections the backend opens | **5** (`DB_POOL_MAX` default) | `pg_stat_activity` (Supavisor, 5 idle) |
| Railway CPU | < 0.03 vCPU at the hourly peak (limit 8) | `railway metrics --cpu --raw` |
| Railway memory | 0.2 GB median, 0.9 GB peak (limit 8 GB) | same |
| HTTP, all routes | p50 107 ms, p95 1.5 s, p99 1.75 s | `railway metrics --http` |
| `GET /api/admin/price-drop-queue` | p50 **1,461 ms** at a quiet moment | `railway logs --http --json` |
| `GET /api/admin/potential-drops` | p50 **1,741 ms** | same |
| Shopper routes | bootstrap 136 ms, credits 57 ms, app-status 38 ms, drops 64 ms | same |
| Sweep query `findNotifiable` (`WITH watched AS …`) | 0.8–4 s mean depending on the shape, **18.6 s max** | `pg_stat_statements` |
| `closeIneligible` (the queue's structural checks) | 0.4 ms mean, 4 ms max | same |
| Savings harvest, Same-Day Costco | 33 min/run, 74 warehouses, ~28 K items, 4–5 runs/day | `savings_source_runs` |
| Savings harvest, all sources | ~6.7 h of run time in 3 days (84 runs) | `job_runs` |
| Railway bill | $1.77 so far, **$3.05 estimated** for Nov 8 – Dec 8 | `railway usage` |

**Reading it:** the database answers from memory and the server's CPU is idle, so the server spends its time **waiting**: on round trips to ca-central-1 (~15 ms each from us-east4), and on a free connection out of 5. The harvests are long, but their writes are batched (`savingsRepo.writeHarvest`, chunked inserts in one transaction). Most of their 33 minutes is HTTP to Costco, which holds no connection.

Cumulative `pg_stat_statements` counters (reset 2026-06-19) include loops already retired. For example, 5.9 M `tag_credit_settlements` inserts came from the settlement leg, which left the sweep on 2026-11-19. Compare call **rates** over a known window, never the totals alone.

## 2. Root cause of the slow desk, and the fix (hotfix 2026-11-23)

Every opening of the Price-drop queue ran, awaited and before listing:

1. `priceDropQueueRepo.closeIneligible()`: structural checks, one cheap query;
2. `priceDropNotifier.closeStaleQueue()` → `_revalidate` → `findNotifiable` for every waiting row: **the heaviest query in production**;
3. then 5 queries at once (`Promise.all`), which could take every one of the 5 connections.

When the sweep or a harvest held connections at that moment, everything else waited in line, shoppers included.

**Changed:**

- **Structural checks stay before the listing** (0.4 ms). The desk still never offers a drop whose evidence was deleted, whose line was re-linked, or whose window closed (Maxim 2026-11-10, "keep only the good ones").
- **The findNotifiable re-check runs behind the listing** (Maxim chose it 2026-11-23): `priceDropNotifier.cleanQueue({ reason })` is the one way it runs.
  - It starts once the desk's answer is sent.
  - One run at a time (a call during a run shares it).
  - At most once per `PRICE_DROP_QUEUE_CLEANUP_MIN_SECONDS` (ops default 120; 0 = every opening).
  - The global sweep (`reason: "sweep"`) and every savings-harvest run that wrote (`harvest:<source>`, through `jobs/harvestSavings.setAfterWriteListener`) run it with `force`.
  - The desk's answer carries `cleanup: { lastRunAt, lastReason, running, checkedLastRun, closedLastRun, lastError }`.
  - A row it closes leaves the desk on the next refresh.
- **Money is unaffected.** `_deliver` re-checks every row against findNotifiable before it charges or pushes, as before.
- **Potential desk:** `listPotential` and the waiting-queue scoring run in parallel; they used to run one after the other.
- **Pool pressure is measured:** `/health?token=…` → `dbPool` gives `max`, `total`, `idle` and `waiting` now, and `lastHour.maxWaiting` / `lastHour.secondsWithWaiters`, sampled every second (`db/client.js` `poolStats`). Railway's log prints `[db-pool] waiting=N total=… idle=… max=…` at most every 10 s while queries wait.

## 3. Connection pool sizing

- The code default stays **5**. The dev pooler is 15 connections shared with CI and the always-on dev backend, and CI runs with `DB_POOL_MAX=3`.
- **Production:** read Supabase → Database → Connection pooling → *Pool size* for `xjfrlzwonyaorwktnkpj`, then set Railway prod `DB_POOL_MAX` to that minus 3 (headroom for scripts and the admin SQL tools). This is an env var only: no code, no redeploy of a new build. It costs nothing on the same Micro plan.
- **Afterwards:** `dbPool.lastHour.secondsWithWaiters` should stay at 0 through a harvest and a sweep. If it doesn't, see §5.

## 4. Railway scaling: not a lever today (Maxim asked 2026-11-23, under the $5 cap)

- **Vertical:** the limits are already 8 vCPU / 8 GB, with usage < 0.03 vCPU and < 1 GB, and Node runs on one core. Limits are caps, not what is billed.
- **Replicas:** every replica runs every `node-cron` job, which means duplicate sweeps, pushes and charges. That needs the worker split (§5) first. It also roughly doubles the memory part of the bill, past $5.
- **Region:** us-east4 is the closest Railway region to Supabase ca-central-1. There is no Canadian region.

## 5. Open levers, in order (each measured before it is done)

1. **The heavy queries themselves** (Phase 2). Capture the SQL of `findNotifiable` (price group + `savingDropRepo.findSavingDrops`), `potentialDropRepo.listPotential` and `dropVerifier.assess`, and run `EXPLAIN (ANALYZE, BUFFERS)` on dev (on prod only with Maxim's OK). A lead: `receipt_items` shows 461 M index scans for 5.7 K rows, the mark of a nested loop re-probing it. Fix only what the plans show: an additive index migration, or a CTE rewrite with a parity test. findNotifiable is the drop rule, so its output must not change.
2. **The worker split:** `PROCESS_ROLE=web|worker`, the same code on two Railway services, with crons and harvests only on the worker. Do it only if `dbPool` still shows waits while jobs run once the pool is sized. State the cost (one more ~250 MB service).
3. **Round trips per request:** the `readOpsFlagFresh` reads on hot routes (app-status reads 3 knobs per launch) are one round trip each. Cheap today; batch them if a route's count grows.

## 6. How to re-measure (copy-paste)

```bash
# HTTP latency per route, last N lines (the CLI caps a fetch at a few hundred)
railway logs --http --since 1d -n 5000 --json > http.jsonl
# then group by path: p50/p95/max of totalDuration

railway metrics --since 12h                 # CPU, memory, HTTP summary
railway metrics --cpu --memory --since 2d --raw --json
railway usage                                # the bill
```

```sql
-- Heaviest statements (cumulative since stats_reset — compare rates, not totals)
select round(total_exec_time::numeric/1000,1) total_s, calls, round(mean_exec_time::numeric,1) mean_ms,
       round(max_exec_time::numeric,0) max_ms, left(regexp_replace(query,'\s+',' ','g'),200) q
from extensions.pg_stat_statements order by total_exec_time desc limit 30;

-- Jobs in the last 3 days
select job_name, count(*) runs, round(avg(duration_ms)/1000.0,1) avg_s, round(sum(duration_ms)/60000.0,1) total_min
from priceback.job_runs where started_at > now() - interval '3 days' group by 1 order by 4 desc;
```

`/health?token=<FLYER_ADMIN_TOKEN>` → `dbPool`.
