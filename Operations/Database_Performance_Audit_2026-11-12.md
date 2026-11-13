# Database performance audit — 2026-11-12

*Asked (Maxim): optimize the queries for the best response time for shoppers first and admins second, use the
database only when needed, keep server consumption down, and avoid concurrency timeouts and deadlocks. No
regression. Hotfix on `main` (`hotfix/db-query-performance`), following the 2026-11-11 plan-flip fix (#566).*

Everything below was measured, on production read-only unless it says otherwise.

## 1. Where things stood

| What | Figure | Source |
| --- | --- | --- |
| Database size | 122 MB; the largest table (`product_regular_prices`) is 37 MB | `pg_stat_user_tables` |
| One query round trip, server → database | ~16 ms | `/health` `checks.db.latencyMs`, and `GET /api/me/consents` (one query) answering in 19 ms |
| Connections in use | 8 of 60 (`max_connections`); the app's pool is 5 | `pg_stat_activity` |
| Deadlocks | 3 since 2026-06-19 (36.7 M transactions) | `pg_stat_database` |
| Lock waits, cancelled statements, timeouts in the last 24 h | none logged | Postgres log |
| `adminAlerts` after #566 | 0.42–0.74 s an hour, from 15–16 s during the incident | `job_runs` |

The database is small and almost every statement in it executes in a few milliseconds; the exceptions are
listed in § 5. **What a request waits on is the number of round trips, not query time.** At ~16 ms each, a route that runs 50 statements one after another takes 0.8 s however fast each one is.

## 2. Response time by route (production, 2026-11-12 16:18–17:51 UTC, 507 requests)

From Railway's HTTP log (`railway logs --http --json`); Railway keeps it for the current deployment only.

| Route | Calls | p50 | p95 | Note |
| --- | ---: | ---: | ---: | --- |
| `POST /api/admin/receipts/:id/auto-fix` | 11 | 29.6 s | 76.4 s | Gemini, not the database |
| `POST /api/ocr` | 11 | 1.7 s | 13.8 s | Vision, not the database |
| `POST /api/watch` | 12 | 1.2 s | 3.1 s | background registration after a scan; § 5 |
| `GET /api/admin/receipts` | 18 | 796 ms | 1,391 ms | **fixed here** |
| `POST /api/receipts` | 7 | 658 ms | 1,011 ms | 35 statements for a 20-line receipt; already batched |
| `GET /api/me/bootstrap` | 30 | 164 ms | 326 ms | worst 879 ms; **fixed here** |
| `PUT /api/me/profile` | 54 | 90 ms | 218 ms | the most frequent write; **one read removed** |
| `GET /api/me/credits` | 66 | 53 ms | 57 ms | 3 statements |
| `GET /api/admin/data-cleanup/scan` | 5 | 390 ms | 472 ms | runs on each Admin home opening; § 5 |
| `POST /api/me/check-drops` | 2 | 251 ms | — | the shopper's own price check |
| `GET /api/admin/overview` | 7 | 133 ms | 140 ms | |
| every other route | | under 150 ms | | |

## 3. What this change fixed

Root cause and detail: `Operations/Bugs_Common_Fixes.md` #375 (the per-receipt warehouse read) and #374 (the
plan flip and its alarm).

Measured on the dev database from the same machine, the fix against `main`'s code, 200 receipts over 4
warehouses, median of 5 runs:

| Read | Before | After |
| --- | --- | --- |
| Admin receipt desk, a page of 200 (`listForAdmin`) | 203 statements, **651 ms** | 4 statements, **74 ms** |
| A shopper's receipt list, 200 receipts (`listForUser`, behind the bootstrap) | 201 statements, **587 ms** | 2 statements, **23 ms** |

The 651 ms matches what production showed for the desk (796 ms), which is how we know it was the same cause.

Route profiler (`node scripts/profile-routes.js`, dev database, a shopper with 3 receipts of 20 lines):

| Route | Statements before → after | Time before → after |
| --- | --- | --- |
| `GET /api/me/bootstrap` | 15 → 14 | 104 ms → 78 ms |
| `PUT /api/me/profile` (nothing changed) | 5 → 4 | 65 ms → 55 ms |
| `POST /api/watch`, 20 new lines | 219 → 199 | 2.19 s → 1.85 s |

The bootstrap gain grows with the number of receipts: one statement less per receipt, plus three fewer round
trips in a row.

Not changed: any request, response, status, table or schedule.

**To confirm after deploy:** `GET /api/admin/receipts` p50 in the HTTP log (expected: ~0.8 s → under 0.2 s).

## 4. The admin desk "load only what is new since my last check" idea

Maxim, 2026-11-12: *load only the data since the last admin check, if this would help the load.*

Measured answer: **it would not help now.** The desks were slow because of the per-receipt round trips, not
because of how much they list. With that fixed, a full page of 200 receipts takes 74 ms to read and the list
query itself 2–9 ms. The other desks were already under 200 ms (`/api/admin/users` 75 ms, the drop queue 188 ms,
the overview 133 ms).

It would also need an app release (the desk has to send the cut-off), and it changes what the desk shows: a
receipt you had not opened before your last visit would drop off the default list. The **Unreviewed** chip
already gives "what I have not dealt with yet" without that risk. Left out; easy to add as an optional `since=`
filter if it is wanted for convenience rather than speed.

## 5. Ranked backlog (measured, not done here)

Each of these is safe to leave. They are listed so the next pass starts from numbers.

| # | Item | Measured | Why not in this hotfix |
| --- | --- | --- | --- |
| 1 | `POST /api/watch` records each new line on its own: ~10 statements a line, one transaction each, and one `warehouses` upsert (a write to the same row) per line | 199 statements, 1.85 s for 20 new lines; p50 1.2 s in production after every scan | The app does not wait for it. It is the crowd-price ingest (duplicate and outlier rules, the tag expiry rule); a batch rewrite needs its own change and corpus. The repeated warehouse write is the only place two shoppers at one warehouse queue behind each other's row lock |
| 2 | `adminAlerts` every 5 minutes | 288 runs a day, ~0.5 s each, ~2.4 minutes of database time a day | Already proposed at 15 minutes (`Technical/Product_Catalog_Rebuild_Design.md` § 6.2a). Maxim's decision: an admin alert up to 10 minutes later |
| 3 | `GET /api/admin/data-cleanup/scan` on every Admin home opening | 390–470 ms; regex scans over six tables | Admin only. Load it when the Data cleanup tile is opened, or cache it for a few minutes (needs an app change for the first) |
| 4 | `priceDropRepo.findNotifiable` reads far more than it returns | ~150,000 buffer hits a call, 130–200 ms | It runs ~20 times a day (1.1 s a sweep), so the cost is small today. It is the commission query: changed only with its own proof. Same join family as #374, so it is the next candidate for a plan flip — the new alarm watches the two sweeps that run it |
| 5 | `PUT /api/me/profile` writes the account row on every call, even when nothing changed | 54 calls in 93 minutes | It stamps `push_permission_at`, which the reachability check reads as "last reported". Skipping the write changes that meaning |
| 6 | `POST /api/receipts`: 35 statements for 20 lines | p50 658 ms | Already batched once (`PERFORMANCE_REVIEW.md` § 1). About 10 are one-off lookups on a cold process |

## 6. Timeouts, locks and deadlocks

Found: no lock wait, cancelled statement or deadlock in the last 24 hours of the Postgres log; 3 deadlocks in
five months. There is no concurrency problem to fix today, so nothing was changed.

Three settings are worth knowing, because they decide how a future incident behaves:

| Setting (production) | Value | What it means |
| --- | --- | --- |
| `statement_timeout` | 120 s | a runaway statement holds a connection for up to 2 minutes |
| `lock_timeout` | 0 (off) | a statement waits for a lock for as long as `statement_timeout` allows |
| `idle_in_transaction_session_timeout` | 0 (off) | a transaction left open keeps its locks until the connection ends |
| `log_min_duration_statement` | -1 (off) | no slow statement is ever logged |

Recommended, for Maxim to decide (database settings, reversible with one statement each):

1. `ALTER ROLE postgres SET log_min_duration_statement = '1s';` — slow statements appear in the Postgres log
   with their text. Free, and it would have named the 2026-11-11 query in the first minute.
2. `ALTER ROLE postgres SET idle_in_transaction_session_timeout = '5min';` — a transaction stuck open (a hung
   outbound call inside it) is ended instead of holding its locks and one of the 5 pool connections.

Not recommended: a short `lock_timeout` or `statement_timeout` for the whole role. The Same-Day harvest and the
daily backup legitimately run long statements, and a blanket limit would turn a slow moment into failed
requests.

Shoppers and background jobs share the app's 5 connections. How many a harvest holds at once was not measured
in this audit. What is new since this change: a steady job that slows down is reported (`lib/jobBudget`, #374),
so a slow query behind one no longer runs unnoticed for hours.

## 7. A correction to the cost rules

`Operations/Infrastructure_Cost_Rules.md` § 2b says the production service runs in Singapore. The Railway
config still names `asia-southeast1-eqsg3a`, but requests do not behave that way: the database round trip is
~16 ms and a one-query route answers in 19 ms, which is not possible across the Pacific (200 ms or more). Check
the region in the Railway dashboard before acting on § 2b; the note there now says so.

## 8. How to re-measure

```bash
# Round trips per route (dev database; never production — db/client refuses it)
cd backend && node scripts/profile-routes.js          # table
cd backend && node scripts/profile-routes.js --sql    # + every statement

# Response time per route (current production deployment)
railway logs -s Priceback -e production --http --json --since 3d -n 5000 > http.jsonl
```

```sql
-- A job that slowed down
select date_trunc('hour', started_at) h, count(*), round(avg(duration_ms)) avg_ms, max(duration_ms)
  from priceback.job_runs where job_name = 'adminAlerts' and started_at > now() - interval '30 hours'
 group by 1 order by 1 desc;

-- The statements that cost the most (cumulative since the last reset: compare two snapshots, not totals)
select calls, round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time) max_ms,
       shared_blks_hit / greatest(calls, 1) blocks_per_call, left(query, 120)
  from pg_stat_statements order by total_exec_time desc limit 30;
```

A route whose total time is many times the sum of its statements' times is paying round trips. Count them
before reading a single query plan.

## 9. Follow-up, 2026-11-13 (Maxim's answers)

| Item | Answer | State |
| --- | --- | --- |
| § 6: log statements slower than 1 s; end transactions idle for 5 minutes | "do it" | **Applied to production and dev**, 2026-11-13 ~04:20 UTC: `ALTER ROLE postgres SET log_min_duration_statement = '1s';` and `ALTER ROLE postgres SET idle_in_transaction_session_timeout = '5min';`. `pg_roles.rolconfig` shows both, and a new session reads `1s` / `5min`. A role setting applies to **new sessions**: the 6 production sessions older than the change keep the old values until they reconnect. The next backend deploy restarts the pool. To undo: `ALTER ROLE postgres RESET log_min_duration_statement;` and `ALTER ROLE postgres RESET idle_in_transaction_session_timeout;` |
| § 5 #2: `adminAlerts` every 15 minutes | "keep it as is" | Stays at 5 minutes. Closed |
| Why `priceDropCommission` fails on the dev database | "dont do it for now, document" | Found while testing the price-drop queue change: a leftover test product named "Costco product" on the dev database. It broke 24 price-drop tests as well as these three. `Operations/Bugs_Common_Fixes.md` #379. The dev database was purged (1,090 test rows) with Maxim's permission and all of them pass. The suites that stay exposed to the next leftover are listed there; that clean-up is not done |
| § 5 #1: `POST /api/watch` per-line ingest | "do it" | **Done**, Priceback #574 (`hotfix/watch-ingest-round-trips`). A registration's lines are recorded together (`crowdRepo.recordReceiptObservations`): the recent rows are read once for the request, each warehouse is written once, and the accept / refuse rules are one function shared with the one-at-a-time path. `scripts/profile-routes.js` on dev: 20 new lines **198 → 74 statements** (1,868 → 722 ms); 19 lines already on file **63 → 9** (622 → 95 ms). Same request and response. Proof: `crowdBatchParityDb.test.js` runs one list of observations through both paths and compares the answers and the rows line for line; 8 of 8 mutations caught |

Reading slow statements once the setting is live: Supabase dashboard → Logs → Postgres, search `duration:`. Each
line carries the statement text and its time.
