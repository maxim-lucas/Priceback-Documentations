# Infrastructure cost — rules and where the money goes

*Standing rule (Maxim, 2026-11-09): "I want to reduce my service consumption at Railway because I am paying
extras with no added value. Expenses for infrastructure should always be optimized to reduce costs."*

## 1. The rules (apply to every change, without being asked)

1. **A scheduled job runs when its input changes, not on a blind clock.** If the source publishes on a known
   cadence or can be probed cheaply, probe it and run only when there is something new
   (`Technical/Savings_Harvest_Schedule.md` is the pattern). Never "twice a day in case".
2. **Measure before and after.** A change that adds a job, a poll, a background loop, a bigger payload or a
   new always-on process states its cost in the PR (requests/day, minutes of work, memory, egress) and how
   it was measured. A cost claim without a number is not a claim.
3. **Non-production runs nothing on its own.** The dev Railway service runs no scheduled job
   (`lib/schedulerGate`, Bugs #365), and an idle non-production service should not hold memory around the
   clock (see § 3).
4. **No re-reading what has not changed.** Pass a fetch along instead of fetching twice; read a set once,
   not once per item (Bugs #365, the egress incident).
5. **Retries are bounded and justified.** A retry exists for a failure that can heal (a restart: ≤ 3 a day);
   never a retry loop on something no retry can fix.
6. **Cost work never trades away correctness.** Cheaper is wrong if it misses data shoppers rely on — the
   savings harvest still runs every day a saving appears, at the hour it appears.

## 2. Railway, measured 2026-11-09 (`railway usage`, `railway metrics`)

Billing period Oct 8 – Nov 8, 2026: **$4.68**, one service (`Priceback`, both environments).

| item | cost | share | what drives it |
| --- | --- | --- | --- |
| memory | $3.16 | 68 % | two always-on Node processes: production avg **227 MB** (max 897 MB during a Same-Day run), development avg **128 MB** |
| egress | $1.35 | 29 % | 26.4 GB, almost all Oct 21 – Nov 2 (2–4 GB/day: the catalogue harvest's first fills and backfills). Since Nov 3: ~0.2 GB/day ≈ $0.30/month |
| CPU | $0.16 | 3 % | negligible — the harvests are I/O wait |

Current period (from Nov 8): estimated **$1.75**.

So the harvest's schedule was never the bill — it was wasted reads and late data. The bill is memory, and a
third of the memory is a development service that serves almost no traffic and runs no job.

### 2a. Supabase, checked 2026-11-09 — the larger bill

Both databases live in **one Pro organization** (`Prosoft Inc.`, `vrpoqvuksexuputrkrow`): `Priceback-app`
(prod, 122 MB) and `Priceback-dev` (dev, 115 MB), both on Micro compute (`max_connections` 60). Pro is $25/month
and includes $10 of compute credit, which covers **one** Micro project. The second project is billed on top:
**~$10/month for the dev database**, around the clock, which is twice the whole Railway bill. A project on a paid plan
cannot be paused (Supabase docs, *Project Pausing*), so the only ways to stop paying for it are to transfer
it to a Free organization or delete it.

### 2b. Region mismatch (performance, not cost)

The Railway service runs in **Singapore** (`asia-southeast1-eqsg3a`, both environments, `railway environment
config`), while both databases and every shopper are in Canada (`ca-central-1`). Every API request and every
harvest query crosses the Pacific twice. Moving production to Railway's US-East region (`us-east4-eqdc4a`) puts it
next to the database. Egress is billed the same in every region, so this barely changes the bill, but the jobs
run faster (less time at peak memory) and the app responds faster.

## 3. Levers

| lever | saving | status / risk |
| --- | --- | --- |
| **Supabase: transfer `Priceback-dev` to a Free organization** (dashboard → project settings → General → *Transfer project*; create a Free org first) | **~$10/month** | Maxim's dashboard action (no API tool for it). Free plan: 500 MB DB (dev is 115 MB), Nano compute, auto-pause after 7 days without activity (resume in one click from the dashboard, 90-day window). The local backend suite and dev Railway keep the same connection string |
| **Railway Development service stopped** (`railway down -e Development`) and its source branch moved from `main` to `main-test-features`, the branch the branch model assigns to dev | ~$1.1/month (≈ 25 % of the Railway bill) | Maxim approved 2026-11-09 (*"disable it completely for now and I can do it manually"*). Dev comes back on the next push to `main-test-features`, or by redeploying from the dashboard. Before this, every hotfix to `main` also rebuilt and restarted dev |
| ~~Railway App Sleeping on Development~~ | — | Not enough on its own: Railway sleeps a service only after 10 min **without outbound traffic**, and the backend re-reads its config from the database every 5 min (`configService.startAutoRefresh`, `server.js`), so it would never go to sleep. Use it only together with a dev-only switch that turns that refresh off |
| Railway production → US-East region | ~0 (performance) | production move; one redeploy, brief restart. Maxim decides |
| Production stays always-on | — | it runs every cron; sleeping it would stop the harvest, the sweeps and the alerts |

## 4. How to re-measure

```bash
railway usage --period previous            # the last bill
railway usage projects --project Priceback-App --period previous --json   # memory / egress / cpu split
railway metrics -s Priceback -e production --since 7d --memory --cpu --network
railway metrics -s Priceback -e Development --since 7d --memory --cpu --network
railway metrics -s Priceback -e production --since 30d --network --raw --json   # egress per 4 h, find the spike
```
