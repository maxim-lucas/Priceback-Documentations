# Savings harvest — when each source runs

*2026-11-09 · Maxim: "plan the harvest … based on the Same-Day and Costco website new drops", "if there is any
saving even 1 per day we should catch it always for all platforms and websites", "the service should always
continue the harvest if stopped", "Costco Business should be able to read few formats". Code:
`backend/jobs/harvestSavings.js`, `backend/services/savings/sources/`. Bug that started it: Bugs_Common_Fixes #368.*

## 1. The rule

A source runs **when the site has something new**, not on a clock. Every hour of the source's window the harvest
**probes** it (seconds) and runs the full source (minutes) only when the probe lists a saving the last full run
did not have. One run per publication, any day of the week; a quiet day costs probes, not runs.

## 2. Configuration (data, `priceback.savings_sources.config.watch`)

| key | meaning | default |
| --- | --- | --- |
| `fromHour`, `toHour` | Toronto hours (inclusive) the hourly probe runs | 6, 20 |
| `fallbackHour` | if no run finished today by this hour, run anyway (catches a saving only at warehouses the probe does not read) | `toHour` |
| `probeWarehouses` | Same-Day only: warehouse codes the probe reads (≤ 10). Empty = the first warehouse of the site's list | `[]` |
| `enabled: false` | back to the fixed `start_hour` / `runs_per_day` / `days_per_week` schedule | — |

With `watch` set, `start_hour` / `runs_per_day` are ignored. A source with no probe for its type (blogs —
yepsavings) stays on fixed hours even if `watch` is set.

**Production, 2026-11-09:**

| source | schedule | probe |
| --- | --- | --- |
| `sameday_costco` | watched 06–20 | warehouses **1261** (ON) and **163** (BC) — the two ends of the country, so a drop that reaches the west later triggers its own run; ~35 s |
| `sameday_business_centre` | watched 06–20 | **1668** (Newmarket) and **1723** (Vancouver) — Business Centre storefront codes, not the Costco ones |
| `costco_coupons` | watched 06–20 | the page (0.1 s); the probe's fetch is handed to the run, never fetched twice |
| `costco_business_centre_web` | watched 06–20 | the page |
| `yepsavings` | fixed: daily 21:00 | third party: waits until every official source has finished a run today |

Why two warehouses and not one per province: six took 100 s per probe; 15 probes a day would put nearly a full
run's worth of requests on Same-Day — the cost the change exists to avoid.

## 3. What "new" means

A probe and a run produce the same **keys**, one per saving (`services/savings/sources/index.js` `resultKeys`):

- Same-Day: `warehouse|sku|endsOn|saving`, at the probe warehouses, savings already ended left out;
- costco.ca: `skus|validFrom|validUntil|saving|channel`.

After a good run the keys are kept in kv_state `savings_watch:<code>`. A probe key not in that set = new → run.
Removals never trigger (the 00:05 list still holding last week's ended savings is *not* new). No keys on file
(first check after a deploy) → run at once.

## 4. The publish log — when each site actually publishes

`savings_watch:<code>.days[YYYY-MM-DD]`: `firstCheckAt`, `checks`, **`publishedAt`** (the first check of the
day that saw a new saving; a first-ever check is not counted), `runs`. 30 days kept. Shown on
`GET /api/admin/savings/sources` → `sources[].watch`.

**Tune the window from this log, not from memory.** After two or three weeks, if every `publishedAt` falls in
e.g. 10:00–13:00, narrow `fromHour`/`toHour` to that band (fewer probes) and keep `fallbackHour` after it.

Measured so far: Mon 2026-11-09 the Same-Day list was still last week's at 00:05 (8,732 of 27,362 ended) and
the new list was live at 13:13; Maxim saw it go up around 11:00. The costco.ca coupon book runs Oct 26 – Nov 22
(a new book every ~4 weeks); the Business Centre page changed on Nov 9 (two-week offers).

## 5. Restarts

- A run beats a heartbeat into `details.progress` (`{ done, total, heartbeatAt }`) at most once a minute.
- An open run with no beat for **15 min** (or past its timeout) was killed: it is closed `failed` with
  `details.interrupted = true` and the source **runs again at once**, at any hour, at most **3 times a day**.
- The next hourly tick does it, and so does a resume-only tick **17 min after boot** (past the 15-min window, so
  a run the old process is still finishing during the deploy overlap is not taken for dead).
- An interrupted run is never the day's run (rows closed the old way, error `abandoned …`, count as interrupted).
- The run starts over (it does not continue from the warehouse it reached): a 25-minute Same-Day read is I/O
  wait, cheap; resuming mid-way would need a staging table and a migration for no real saving.

## 6. Page format drift (costco.ca)

The reader accepts every window and amount shape listed in `costcoWebSource.js` (`parseValid`, `readSaving`).
An unreadable tile keeps a text sample (`details.unreadableSamples`, ≤ 5). When ≥ 20 % of ≥ 5 tiles are
unreadable the run is marked `details.formatDrift` and the admin is emailed (Resend) with the samples — once per
day for a watched source, so a broken page does not email every hour. To fix: add the new shape to `parseValid` /
`readSaving` with a test on a saved copy of the page (`tests/fixtures/savings/`).

## 7. Checking it in production

```sql
-- the last runs, with what started them
select s.code, st.code status, r.started_at at time zone 'America/Toronto' started, r.details->>'trigger' trigger,
       r.items_found, r.savings_new, r.error
  from priceback.savings_source_runs r join priceback.savings_sources s on s.id = r.source_id
  join priceback.savings_run_statuses st on st.id = r.status_id
 order by r.started_at desc limit 30;
-- the publish log
select key, value->'days', value->'lastCheck' from priceback.kv_state where key like 'savings_watch:%';
```

`trigger`: `new_savings_listed`, `first_check`, `fallback`, `format_drift`, `resume_after_interruption`
(none = a fixed-hours source or a manual run).
