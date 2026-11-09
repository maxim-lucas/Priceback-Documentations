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

## 3. Open levers (Maxim decides)

| lever | saving | risk |
| --- | --- | --- |
| Railway **App Sleeping** (serverless) on the **Development** service: it sleeps after ~10 min without traffic and wakes on the next request | ~$1.1/month (≈ 25 % of the bill) | first request after idle waits a few seconds (device/test builds pointing at dev); nothing scheduled runs there anyway |
| Production stays always-on | — | it runs every cron; sleeping it would stop the harvest, the sweeps and the alerts |

How to switch it: Railway dashboard → Development → Priceback → Settings → *Serverless* (or `railway`
service settings). Reversible at any time.

## 4. How to re-measure

```bash
railway usage --period previous            # the last bill
railway usage projects --project Priceback-App --period previous --json   # memory / egress / cpu split
railway metrics -s Priceback -e production --since 7d --memory --cpu --network
railway metrics -s Priceback -e Development --since 7d --memory --cpu --network
railway metrics -s Priceback -e production --since 30d --network --raw --json   # egress per 4 h, find the spike
```
