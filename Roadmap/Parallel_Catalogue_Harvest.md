# Parallel catalogue harvest — every product, every province, every week

**Asked by Maxim, 2026-11-28:** *"i want a full catalogue to get the prices … a permanent solution to harvest the catalogue at
least once every week at first, we can include more workers to be on the background or different service so the harvest
doesnt impact the app speed and at the same time it is more scalable so every harvest get the catalogue for a province or a
warehouse and they all work in parallel to reduce harvesting time, once it is working we will do the same with the savings
harvest, we need to be more real time than today."*

Status: **planned, not built** (window, workers and cost answered by Maxim 2026-11-28, §5). Phase 0 is the go/no-go measurement; nothing is switched on without Maxim (ground rule 6).

## 1. Where we are (measured on prod, 2026-11-28)

| Fact | Number | Source |
|---|---|---|
| Where harvests run | inside the API process (`node server.js`, 1 replica, Railway us-east4) | `railway.json`, `server.js` 7547–7819 |
| Weekly full Same-Day run (`sameday_costco_catalog`) | avg 46 min, max 300 min; reads **2 warehouses per province** | `catalog_runs`, last 30 days |
| Business Centre full run | avg 69 min, max 278 min | idem |
| Per-province "fill" runs (every warehouse of a province) | ON 264 avg / **644 max**, QC 134 / 298, BC 116, AB 63 / 154, SK 26, NB 27, MB 24, NS 17, NL 9 | idem; all **disabled** since 2026-11-24 |
| All provinces filled one after another | **≈ 11 h**, longer than a deploy-free window | sum of the above |
| Gap this leaves | 990 of 5,659 (product, province) pairs with a live saving had no regular price; 28 products had no catalogue item | bug 6, `Operations/Bugs_Common_Fixes.md` #397 |

Bug 6 (#775) closes the gap for **products on saving** from the savings harvest's own readings. Every other product still has
only the 2-warehouses-per-province price of the weekly run, and nothing at all where the sitemap misses it.

What goes wrong today:
1. **App speed.** A harvest shares the API's CPU, memory and database pool with shoppers (bug 394: the queue slowed the app).
2. **Deploys kill runs.** A deploy restarts the one process, and a 5 h run dies with it (bug 396: the run that lost its departments).
3. **Serial.** One Same-Day session at a time (`harvestJobs`: "never three readers against the site at once"), so a full
   national fill takes about 11 h, and the fills were switched off.

## 2. Target

- **Every product in the catalogue, priced at every warehouse of every province, at least once a week.** Later, daily for
  what moves.
- **Never in the API process.** A separate Railway service, **`priceback-harvester`**: same repo, start command
  `node workers/harvester.js`, no HTTP port, its own small database pool. The API only enqueues and reads results.
- **Sharded and parallel.** One unit of work = **one storefront × one province** (later, one warehouse). Several workers take
  shards at once.
- **Resumable.** A shard is small enough (≤ ~60 min) that a deploy or a crash loses one shard, never the week. A stopped shard
  continues from its checkpoint (infrastructure rule 3).
- **Same rules, same writers.** Workers call the existing pure readers (`samedayCatalogSource`, `planRegularPrices`) and the one
  writer (`productCatalogRepo.writeRegularPrices`). No second copy of any rule (standing rule "one rule, one function").

## 3. Design

### 3.1 The queue (Postgres, no new infrastructure)
A new table `harvest_shards` (migration, additive):
`id, job ('catalog' | 'savings'), source_code, storefront, province_code, warehouse_code NULL, week, status
('queued'|'running'|'done'|'failed'), attempt, worker_id, heartbeat_at, checkpoint jsonb, started_at, finished_at, counts jsonb, error`.

- **Planner (in the API's scheduler, cheap):** once a week (Sunday night Toronto, before the flyer week), inserts one row per
  (storefront, province), ~13 + ~4 for the Business Centres. Idempotent on `(job, source_code, province_code, week)`.
- **Workers take a shard** with `SELECT … FOR UPDATE SKIP LOCKED` (no double run, no coordinator), beat a heartbeat every
  30 s, and write a checkpoint after each batch of 50 items.
- **A shard whose heartbeat is older than 3 min is re-queued** (`attempt + 1`, at most 3). The checkpoint means it resumes
  where it stopped.
- **The admin desk** (Admin · Harvest jobs) shows the week's shards: done / running / failed, minutes, items, prices written.
  "Run now" for one province enqueues a shard; it never runs in the API.

### 3.2 What a shard does
1. Reads the known products of its storefront (`knownSamedayProducts` + products with a live saving + products on receipts
   (`wantedSkus`)). That is the "full catalogue", **not only the sitemap**: the sitemap misses products (bug 6).
2. Reads them at **every** warehouse of its province (the `prices` mode that exists today), 50 per call.
3. Plans the province's price (`planRegularPrices`, the most common price, warehouse rows only where they differ) and writes it
   with `writeRegularPrices`, the one writer. A province is written whole, so this shard's rows are the province's answer.
4. The weekly **discovery** run (sitemap, French names, departments, categories) stays one shard of its own, run first. Price
   shards start once it has saved its product list.

### 3.3 How parallel, safely
Same-Day is a third party's site. Parallelism is capped by what it tolerates, not by how many workers we can afford:
- **Concurrency cap per storefront** (`HARVEST_MAX_PARALLEL`, start at **2**, raise only on measurement) and a **request budget
  per minute** shared by every worker through the database (a token bucket row), so N workers never send N× the requests.
- **One guest session per worker**, never shared (`SamedayClient`). A `blocked` (403/429) on any shard pauses every shard of
  that storefront for 30 min and alarms. It never retries into the wall (the Abercrombie and Sport Chek lessons:
  `Technical/Adding_A_New_Store.md`).
- **Egress:** every worker leaves from Railway's region, like the API today. If Same-Day starts rate-limiting by IP, the answer
  is a lower cap, never rotating IPs to get around it.

Expected time at cap 2: the ~11 h serial fill becomes **≈ 5–6 h** (ON alone stays the long pole, so it splits per warehouse,
§5). At cap 4, if Phase 0 shows it is tolerated: ≈ 3 h.

### 3.4 Cost (infrastructure rule 5: state it, measure it)
- One extra Railway service, **only while there is a shard to take.** The worker exits when the queue is empty, and the
  planner wakes it (Railway cron service or `railway up` trigger), so the idle cost is ~0.
- Memory: one worker ≈ today's harvest footprint inside the API (measure with `railway metrics` in Phase 0). Running it outside
  the API **lowers** the API's peak.
- Requests to Same-Day: about the same per week as running the 13 fills serially. Parallelism changes the wall-clock, not the
  total.
- Database: one more pool (max 3 connections per worker). The session pooler cap (15) is shared, so the worker's pool is
  sized against it.

## 4. Phases

| Phase | What | Exit bar |
|---|---|---|
| **0. Measure** (no code shipped to prod) | From Railway, 2 then 3 province fills at once, 23:00–07:00 Toronto, one night; record requests/min, blocks, minutes, memory, and the bill delta | 0 blocks at 3; memory → Option A or B (§5.4) |
| **1. Night queue** | `harvest_shards` + nightly planner + the `catalogue_harvest` lock that competing jobs defer to; catalogue **prices** shards (Option A in the API, or B as `workers/harvester.js`); ships **OFF** | every province priced within 2 nights on **dev**; desk shows the shards |
| **2. Catalogue on** | Maxim switches it on in prod; the old in-API fills and the weekly full run's price pass retire | one full week: every (product, province) with a known product has a regular price ≤ 7 days old; 0 runs lost to a deploy |
| **3. Discovery moves too** | the sitemap / names / departments run becomes a shard | the API runs no harvest at all |
| **4. Savings harvest the same way** | savings shards per storefront × province, run on the existing hourly probe (`Technical/Savings_Harvest_Schedule.md`): a probe that sees something new enqueues its province's shards | a new saving read within **≤ 1 h** of publication in every province (today one run reads every warehouse in series) |
| **5. More real time** | per-warehouse shards for the big provinces (ON, QC, BC); daily price shards for products that moved last week | ON's shard ≤ 60 min; daily freshness for movers |

## 5. Maxim's answers (2026-11-28) and what they change

> *"the catalogue harvest should run mainly all days when there is less traffic … (i think by night on Toronto timezone after
> 10 pm untill 8 am), when a catalogue harvest is running you can hold any other workflows that can have a competition like a
> sweep job … you can start at 2 or 3 parallel workers … No extra monthly cost for a second railway service … the catalogue
> can run every day on dead time … not only once a week."*

### 5.1 The window: every night, 23:00 → 07:00 Toronto (measured)
Shopper activity per Toronto hour, prod, last 30 days (sign-ins in `auth_outcomes` + receipts scanned):

| Hour | 22 | 23 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | peak (10–19) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| events | 47 | 32 | 41 | 19 | 10 | 7 | 2 | 0 | 4 | 16 | 39 | 66 | 56–109 / h |

- **22:00 is still busy** (47, about the level of 13:00), and **08:00 already is** (39). The dead time is **23:00 → 07:00**; 01:00–06:00
  is almost empty (≤ 19 / h).
- So: shards start at **23:00 Toronto**, a shard never STARTS after **06:30**, and every shard stops at **07:00** (checkpoint
  kept, resumed the next night). Maxim's 22:00–08:00 is the outer bound; the window is a config row, so it can widen later.
- **Daily, not weekly:** every night takes the next shards, oldest-read province first. With 2–3 workers and ~8 h a night, every
  province is re-read every **1–2 nights** (the serial total is ~11 h). Then Ontario per warehouse (§4 Phase 5).

### 5.2 Hold what competes while a shard runs
One Postgres advisory lock, `catalogue_harvest` (the pattern of `scripts/runLock.js`), held by the night run. A job that competes
**checks it and defers** to its next tick after the window, never runs alongside:
- reads Same-Day: the savings harvest (its watch is 06–20 Toronto, so it already sleeps then; its 20:00 fallback stays outside the
  window), the stock read, an admin "Run now";
- writes prices or reads them at scale: the price sweep and the drop sweep (`PRICE_SWEEP_INTERVAL_MINUTES`), the priority
  price check;
- heavy database work: the backup (04:10) and retention jobs (03:15–04:00) run on the **server clock**. node-cron has no
  timezone here, so that is UTC unless `TZ` is set: **to verify**. If they are 22:15–23:10 Toronto, they finish before the window
  opens; if they are Toronto 03:xx, they move to 07:00.
- Light jobs (admin alerts, push receipts, reminders) are not held.

### 5.3 Workers: 2, then 3
Start at **2** parallel shards per storefront, raise to **3** after one clean night (0 blocks). A shared request budget per minute
(§3.3) keeps 3 workers from sending 3× the requests.

### 5.4 No extra monthly cost
Measured: Railway this period (Nov 8 → Dec 8): **$2.36 used, $3.59 estimated**. Memory is $2.04 of it, CPU $0.04, egress $0.28.
The plan's $5 leaves **~$1.40 / month** of headroom. Hard limit $10.
- **Several services in one project are allowed.** Railway bills each service by what it uses (memory × time, CPU, egress), not
  per service. A **second environment** is NOT cheaper: it copies every service (API included), so it costs more. Not used.
- **Option A, $0 extra (recommended first):** the shards run **inside the API process, at night only**, from the same queue
  (`harvest_shards`). At 23:00–07:00 the app is nearly idle, so the harvest cannot slow shoppers. The short, checkpointed shards
  fix "a deploy kills a 5 h run". The memory is the API's own (no second copy of Node).
- **Option B, the worker service:** one extra service running 2–3 shards in ONE Node process (the work is I/O-bound), started at
  23:00 and exiting at 07:00 or when the queue is empty, so it is billed ~8 h a day. It costs a second Node's memory for those
  hours. It is taken only if Phase 0 measures it inside the ~$1.40 headroom with a margin, and it alarms before the bill passes $5.
- Either way the design is the same (queue, shards, checkpoint, lock); B is A with `node workers/harvester.js` as the entry point.

### 5.5 Separate workers for every harvest (Maxim, 2026-11-28)

> *"if we can implement another worker with no cost i prefer to keep as from now all the harvest on a separate worker and the main
> service is kept entirely for production users … or even few workers, one for savings, one for catalogue harvest and even one for
> price drop sweep and on the long run the harvest gets more workers"*

**Option A is shipped first** (Priceback #785, OFF): the night run inside the API. The worker split below is the next step, taken only
once its cost is measured inside the plan.

**How a worker costs nothing while idle:** a Railway service with a **cron schedule** starts, runs one job and exits. It is billed only
for the minutes it runs (memory × time, CPU). Several services in one project are allowed; a second *environment* would copy every
service and cost more.

**Estimate from this month's bill** (Nov 8 → Dec 8: $2.36 used by day 20, $3.59 estimated; memory $2.04, so the always-on API costs about
$3.1 / month, or **≈ $0.004 per process-hour** at the API's memory):

| Worker | When it runs | Hours / month | Estimate |
|---|---|---|---|
| catalogue (`node workers/catalog.js`) | every night 23:00 → 07:00 | ~240 | ~$1.00 |
| savings (`workers/savings.js`) | hourly probe 06–20 (~2 min) + the full run when something is new | ~40 | ~$0.20 |
| price sweep (`workers/sweep.js`) | the daily sweep + the priority checks every 2 h (minutes each) | ~30 | ~$0.15 |
| **total** | | | **~$1.35** |

$3.59 + $1.35 ≈ **$4.95**: right at the $5 included, so it is not "no cost" with certainty. What lowers it: the API stops carrying the
harvests' memory peaks (measure the API's memory after the move), and a worker's memory is smaller than the API's (no HTTP server, no
caches). **Rule:** one worker at a time, the catalogue first; after one week read `railway usage` and keep the next worker only if the
projected bill stays under $5 with a margin. A worker alarms (`sendBudgetAlert`) when the projected bill passes $4.50.

**What each worker needs (same code, new entry points):** `jobs/nightCatalog.run`, `jobs/harvestSavings.tick`, the sweep's `run`. Each
entry point takes the `catalogue_harvest` / Same-Day lock in Postgres (no in-process flags across services), runs, and exits. The API's
crons for that job turn off with one flag per job (`HARVEST_IN_API`), so the two never run together. More workers for the harvest later =
more shards at once, under the same request budget (§3.3).

## 6. Rules this must keep
- Official prices only, written by `writeRegularPrices` (price-history rule 5: every replaced price is kept).
- A province is priced in the province it was read in (sweep rule 10). A shard never borrows another province's price.
- Non-production runs no scheduled job (`lib/schedulerGate`), and the worker obeys the same gate.
- A source whose format drifts alarms on the first shard that reads 0 items (infrastructure rule 4).
- Ship OFF; Maxim switches it on (ground rule 6).
