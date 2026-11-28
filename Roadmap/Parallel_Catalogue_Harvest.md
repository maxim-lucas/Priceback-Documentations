# Parallel catalogue harvest — every product, every province, every week

**Asked by Maxim, 2026-11-28:** *"i want a full catalogue to get the prices … a permanent solution to harvest the catalogue at
least once every week at first, we can include more workers to be on the background or different service so the harvest
doesnt impact the app speed and at the same time it is more scalable so every harvest get the catalogue for a province or a
warehouse and they all work in parallel to reduce harvesting time, once it is working we will do the same with the savings
harvest, we need to be more real time than today."*

Status: **planned, not built.** Phase 0 is the go/no-go measurement; nothing is switched on without Maxim (ground rule 6).

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
| **0. Measure** (no code shipped to prod) | From Railway, run 2 province fills at once against Same-Day for one week-night; record requests/min, blocks, minutes, memory | 0 blocks at cap 2, and a memory figure. Maxim decides the cap |
| **1. Worker service** | `workers/harvester.js` + `harvest_shards` + planner; catalogue **prices** shards only (discovery stays in the API for now); ships **OFF** | every province priced in one week on **dev**; desk shows the shards |
| **2. Catalogue on** | Maxim switches it on in prod; the old in-API fills and the weekly full run's price pass retire | one full week: every (product, province) with a known product has a regular price ≤ 7 days old; 0 runs lost to a deploy |
| **3. Discovery moves too** | the sitemap / names / departments run becomes a shard | the API runs no harvest at all |
| **4. Savings harvest the same way** | savings shards per storefront × province, run on the existing hourly probe (`Technical/Savings_Harvest_Schedule.md`): a probe that sees something new enqueues its province's shards | a new saving read within **≤ 1 h** of publication in every province (today one run reads every warehouse in series) |
| **5. More real time** | per-warehouse shards for the big provinces (ON, QC, BC); daily price shards for products that moved last week | ON's shard ≤ 60 min; daily freshness for movers |

## 5. Open questions for Maxim
1. **Parallel cap:** start at 2 workers per storefront and raise on Phase 0's measurement? (Recommended.)
2. **Weekly window:** Sunday night Toronto (before Monday's flyer), or spread over the week (one or two provinces a night)?
3. **Railway plan:** a second service is billed separately. Is a monthly ceiling to stay under OK, to be measured in Phase 0?

## 6. Rules this must keep
- Official prices only, written by `writeRegularPrices` (price-history rule 5: every replaced price is kept).
- A province is priced in the province it was read in (sweep rule 10). A shard never borrows another province's price.
- Non-production runs no scheduled job (`lib/schedulerGate`), and the worker obeys the same gate.
- A source whose format drifts alarms on the first shard that reads 0 items (infrastructure rule 4).
- Ship OFF; Maxim switches it on (ground rule 6).
