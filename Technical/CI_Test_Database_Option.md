# Option: give the test run its own database

Status: **proposal, not built. The decision is Maxim's** (2026-11-22). Written after the backend job's limit was raised
from 60 to 90 minutes (Priceback #639). Read this before choosing whether to make the backend suite faster.

## In one paragraph

Today every backend test run, on GitHub or on your PC, talks to **one shared Supabase dev database in Montréal**
(`Priceback-dev`, `gnedluuylimjwdmtvswl`, Postgres 17, ca-central-1). Each test makes many small queries, and each
query crosses the internet, so the suite takes **46–56 minutes**. The option is to have **GitHub create a throwaway
Postgres 17 on the same machine that runs the tests**, build it from our migrations, run the suite against it, and
throw it away when the run ends. Queries then travel inside one machine instead of to Montréal.

**You don't need a server, Railway, or a Supabase change for this.** The database is a Docker container that GitHub
starts inside the test job's own temporary machine (`ubuntu-latest`). It exists for the length of one run and costs
nothing beyond the run's minutes, and the run gets shorter.

## Where everything lives, today and with the option

| | Today | With the option |
|---|---|---|
| Production database | Supabase prod (`xjfrlzwonyaorwktnkpj`) | **unchanged** |
| Production + dev backend | Railway | **unchanged** |
| Supabase dev database | used by the dev backend **and** by every test run | used by the dev backend only (and by an occasional check, below) |
| Test database on GitHub | the Supabase dev database, over the internet | a new empty Postgres 17 on the GitHub machine, deleted after the run |
| Test database on your PC | the Supabase dev database, over the internet | see "the parity question" below |

## Why it would be faster

- The measured cost is round trips, not computation. In run 44976566135, 3,513 top-level tests added up to 2,560 s,
  and the process sits near 0% CPU the whole run. Each query pays the trip from the GitHub machine to Montréal (seen at
  ~65 ms on one runner) and goes through the Supabase pooler. Inside one machine, a query's trip is under 1 ms.
- **Estimate, not measured: 5–15 minutes instead of 46–56.** The first trial run would give the real number.
- **Fewer false reds.** Most "red for no reason" runs so far were connection drops or pooler contention (the
  `ECONNRESET` cases in `CLAUDE.md`, the 15-connection ceiling). A database on the same machine has neither.
- **Runs could go in parallel later.** Each run gets its own database, so two runs can't wipe each other's data. The
  repo-wide `backend-db-tests` queue, the cross-machine run lock (`scripts/runLock.js`) and serial-only execution
  stop being needed for CI. The suite could then be split into parallel jobs. That would be a second, separate step.

## What it costs

- **Money: nothing extra.** GitHub doesn't charge for containers inside a job. The repo is private, so the cost is
  Actions minutes, and a shorter run uses fewer of them. GitHub Free includes 2,000 minutes a month for private repos;
  check the account's plan under *Settings → Billing*.
  - At ~50 minutes per run, the backend job alone fits about **40 runs** a month.
  - At ~10 minutes per run, it would fit about **200**.
- **Docker image pull: ~30 s per run.** `postgres:17` is ~150 MB, pulled from Docker Hub on each run.
- **Building the database: under a minute per run.** `npm run db:migrate` applies all 58 migrations to an empty
  database. Checked 2026-11-22 on `main`: the 58 `.sql` files match the 58 entries in `meta/_journal.json`, and no
  migration needs a Supabase-only extension or role.
- **Work: about half a day, one PR,** plus one trial run on a branch, which Maxim dispatches.

## The parity question (this is the real decision)

The standing rule (memory: local/CI parity) says `npm test` must test the same thing on your PC and on GitHub, and CI
may hold no test parameters of its own. There are three ways to do this option:

| | How | Parity | What it needs |
|---|---|---|---|
| **A. GitHub only** | GitHub uses the container; your PC keeps using Supabase dev | **broken**: GitHub and your PC test different databases | nothing on your PC |
| **B. Both** (recommended if you do this) | GitHub and your PC each start the same `postgres:17` container through one committed script | **kept**: same database, same script, same `npm test` | **Docker Desktop on your PC** (free for personal and small-business use, needs WSL 2, ~2–4 GB on disk; **put its data on E:**, C: is full). Docker is not installed today |
| **C. Keep today's setup** | nothing changes | kept | nothing; the suite stays at 46–56 min, with the 90-minute ceiling |

A side effect of B: a full backend suite run from your PC is no longer slow or unreliable when you're far from Montréal.
The "from Egypt, a full run took 14 h and failed on connection drops" problem goes away, because nothing leaves the PC.

## What a local database does NOT test, and how to cover it

A plain Postgres is not the Supabase stack. These things would no longer be tested on every run:

1. **The Supabase pooler** (session pooler, 15-connection ceiling). The pool settings and the "one run at a time"
   protections exist because of it. A local database never runs out of connections, so a change that opens too many
   would pass.
2. **The TLS trust anchor.** `db/client.js` always connects with TLS and checks the server's certificate against
   `backend/certs/supabase-prod-ca-2021.crt`. The container would use its own test certificate, passed through the
   existing `DB_SSL_CA` setting. That means **no change to the TLS code** (no "TLS off" switch, which is how the
   insecure-connection defect would come back), but the Supabase certificate itself wouldn't be exercised.
3. **Supabase's own settings**: its roles (`anon`, `authenticated`), its default grants, and its exact minor version
   (dev runs 17.6). Our migrations use plain Postgres (`drizzle.config.js` pins the vanilla `postgresql` dialect), and
   the 62 `ENABLE ROW LEVEL SECURITY` statements are standard SQL. So this is a small gap, but a real one.
4. **The network.** Slow queries and timeouts that only show up over a real link would be hidden.

**The cover:** keep one run against the real Supabase dev database **before every store release**, the way the suite
runs today. It would be dispatched by Maxim, like now. The fast container run becomes the everyday check, and the
Supabase run stays the release check. Releases are already a deliberate step (`<build app>`), so this adds one
dispatch per release, not one per change.

## What the change would touch (for when it is approved)

1. **One committed script**, e.g. `backend/scripts/test-db.js`, used by both GitHub and your PC:
   - starts `postgres:17` (pinned) with TLS on and a throwaway certificate made at start;
   - waits until it is ready;
   - writes the local `DATABASE_URL` and `DB_SSL_CA`;
   - runs `npm run db:migrate`.

   Not GitHub's `services:` block: a service container can't be given the TLS start options, and the parity rule wants
   the same script on both sides anyway.
2. **`.github/workflows/test.yml`**: one step calls that script instead of writing the Supabase dev `DATABASE_URL`
   secret into `.env`. `__tests__/ciParity.test.js` is extended to pin that both sides use the script.
3. **`run-suite.js`**: unchanged. It already seeds once, purges before and after, refuses the production project ref,
   and caps each file at 5 minutes. The cross-machine lock is skipped when the database is the run's own (local host),
   and stays for Supabase runs.
4. **Not touched:** production, Railway, the Supabase projects, the app, and every test file.
5. **Later and optional:** split the backend suite into 2–4 parallel jobs, each with its own container. That's another
   PR, decided after measuring step 1.

## How to try it with no risk

1. A branch with the script and the workflow change, with the Supabase path kept as it is.
2. Maxim dispatches the suite on that branch once. That gives the real duration, and shows whether any test depends on
   Supabase-only behaviour. A test that passes on Supabase and fails on the container is a finding to read, not to
   patch around.
3. If it's green and much shorter, merge. If not, close the branch; nothing else changed.

## Decision needed from Maxim

- **A, B or C?** Recommendation: **B** if a faster suite matters to you, which needs Docker Desktop on your PC.
  Otherwise **C**: the 90-minute ceiling already stops the false reds, so nothing is broken today.
- With A or B: keep the Supabase run before each release? Recommendation: yes.
