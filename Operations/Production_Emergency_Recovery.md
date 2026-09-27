# Production Emergency Recovery

Standing runbook for "production is broken and I need it back" — a bad
deploy, a bad migration, or data that got deleted by mistake. This is
**operational disaster recovery**, distinct from `incident-response.md`
(that one is for a *security/privacy* breach with regulatory notification
duties). Use this doc when the question is "how do I get PriceBack working
again / get the data back", not "who do we have to tell".

Two production services, two different failure shapes:

| Component | Host | What "broken" looks like |
|---|---|---|
| Backend | Railway, service `priceback-production` | Crash loop, 5xx on every request, `/health` red |
| Database | Supabase project `xjfrlzwonyaorwktnkpj` (`priceback` schema) | Bad migration, wrong data, rows deleted by mistake |

Jump to: [A — backend broke](#a-a-deploy-broke-the-backend) ·
[B — a migration broke the database](#b-a-deploy-broke-the-database-schema) ·
[C — data was deleted or corrupted by mistake](#c-data-was-deleted-or-corrupted-by-mistake) ·
[How backups actually work](#how-the-backups-work) ·
[The gap this doesn't cover](#the-gap-this-doesnt-cover-supabase-is-on-the-free-plan)

---

## A. A deploy broke the backend

Symptoms: `/health` is red or unreachable, requests 5xx, Railway shows the
service crash-looping or failing its healthcheck.

1. **Confirm it's the backend, not the database.** Hit
   `https://priceback-production.up.railway.app/health` (and
   `?token=<FLYER_ADMIN_TOKEN>` for the fuller view). If `db.status` is `ok`
   there but everything else is red, it's the app process — proceed below.
   If `db.status` is `error`, go to [B](#b-a-deploy-broke-the-database-schema)
   or [C](#c-data-was-deleted-or-corrupted-by-mistake) first.
2. **Roll back the deploy — Railway dashboard:**
   - railway.app → the PriceBack project → `priceback-production` service →
     **Deployments** tab.
   - Find the last deployment that was healthy (green, pre-dates the bad
     merge). Open it → **⋮ → Redeploy**. Railway redeploys that exact build,
     from that exact commit — no rebuild-from-source ambiguity.
   - Watch the new deployment go green and `/health` come back.
3. **Roll back — CLI equivalent**, if the dashboard is unreachable:
   ```
   npm i -g @railway/cli   # one-time
   railway login
   railway link            # select the PriceBack project, priceback-production service
   railway status          # confirm which service/environment is linked
   ```
   Railway's CLI redeploy targets a deployment ID from `railway status`/the
   dashboard list — there is no "rollback N steps" one-liner, so having the
   dashboard's Deployments list open alongside the CLI is the practical path.
4. **Never fix forward under pressure.** Roll back first to stop the bleeding,
   *then* branch a fix off `main` at leisure per the normal PR flow. A hotfix
   pushed straight at a live incident is how a second bug gets shipped on top
   of the first.
5. **After rollback:** re-check `/health`, confirm the specific feature that
   broke now works, then investigate the bad commit separately (Sentry,
   Railway logs — see `incident-response.md`'s "How to check Railway logs"
   section for the log-search commands).

---

## B. A deploy broke the database schema

Symptoms: a migration that shipped with the deploy left the schema in a bad
state — a column missing, a constraint that rejects normal writes, a
migration that half-applied.

1. **Roll back the backend first** ([A](#a-a-deploy-broke-the-backend)) if the
   new code depends on the broken schema — this stops it from making things
   worse while you fix the database, and buys time.
2. **Read `Technical/` migration conventions before touching anything.**
   Migrations here are hand-written idempotent SQL (`IF NOT EXISTS` / `DO $$`
   guards) applied via `npm run db:migrate` — see `Operations/DEPLOYMENT.md`
   → "Database (Postgres) — environment ↔ provider mapping". **Prod's
   drizzle migration ledger is hand-maintained, not generated** — never run
   `drizzle-kit generate` against it and never assume the ledger reflects
   reality; confirm the actual state of the schema with `\d priceback.<table>`
   or the consolidated reference (`backend/db/deploy/schema.sql`) first.
3. **Prefer fixing forward with a corrective migration** over restoring from
   backup — a schema fix (drop the bad constraint, add the missing column) is
   precise and doesn't touch data. Write it idempotent, run it against **dev**
   Supabase (`gnedluuylimjwdmtvswl`) first, confirm, then against prod
   (`xjfrlzwonyaorwktnkpj`).
4. **If the migration corrupted or destroyed data** (not just the schema —
   e.g. a bad `ALTER ... USING` clobbered a column's values), restore just
   the affected table(s) from the most recent backup taken *before* the bad
   deploy ran — see [C](#c-data-was-deleted-or-corrupted-by-mistake) below,
   same procedure. Check the backup's manifest timestamp against the deploy
   time first (`npm run db:restore -- --list`) so you don't restore a backup
   that already has the damage baked in.
5. **Full loss of the database** (extremely unlikely — Supabase's own
   infrastructure would have to fail, not just our migration) is the same
   procedure as C, run against every table (`--timestamp=<ts> --yes`, no
   `--tables` filter) followed by re-running any migrations applied *after*
   that backup's timestamp.

---

## C. Data was deleted or corrupted by mistake

Symptoms: no deploy involved — someone ran the wrong `DELETE`, a script hit
prod by accident, an admin action removed the wrong accounts. Use
`backend/scripts/restore-db.js` (wraps `backend/lib/dbBackup.js`, the same
code the nightly backup cron uses).

**Read this warning before restoring a whole table:** a table-scoped restore
**deletes every row currently in that table and replaces it with the
backup's snapshot** — it reverts *any* legitimate change made to that table
since the backup ran, not just the rows that were wrongly deleted. For "a
handful of specific rows disappeared", the surgical path (step 2 below) is
almost always the right one. Reach for the blunt full-table restore (step 3)
only when the table is broadly corrupted and losing the last few hours of
otherwise-legitimate changes to it is an acceptable trade for getting it back
to a known-good state.

1. **Find the right backup.**
   ```
   cd backend
   node --env-file=.env scripts/restore-db.js --list
   ```
   Prints every available timestamp for whichever env `DATABASE_URL`/`R2_ENV`
   resolves to, oldest first — the last line is the most recent nightly
   backup. Point `DATABASE_URL` at production before running any restore
   command below; the script prints the resolved target and refuses to write
   without `--yes`, but there is **no production guard** here — restoring
   production during a real incident is the whole point, so read the printed
   target line carefully before confirming.

2. **Surgical recovery (recommended default): dump the table, hand-write the
   fix.**
   ```
   node --env-file=.env scripts/restore-db.js --timestamp=<ts> --dump-table=users > /tmp/users-backup.json
   ```
   This is **read-only against R2** — it never touches `DATABASE_URL`. Find
   the specific row(s) that vanished (by id/email/whatever identifies them),
   and hand-write a targeted `INSERT INTO priceback.users (...) VALUES (...)`
   for just those rows against production. Slower than a blanket restore, but
   nothing else in that table is touched.

3. **Blunt recovery: restore the whole table (or the whole database).**
   ```
   # Preview first — no writes:
   node --env-file=.env scripts/restore-db.js --timestamp=<ts> --tables=users --dry-run

   # Then, once you're sure:
   node --env-file=.env scripts/restore-db.js --timestamp=<ts> --tables=users --yes

   # Or the single most recent backup, one or more tables:
   node --env-file=.env scripts/restore-db.js --latest --tables=users,receipts --yes

   # Or genuinely everything (disaster recovery, see B.5):
   node --env-file=.env scripts/restore-db.js --timestamp=<ts> --yes
   ```
   Runs inside one transaction — every named table restores, or (on any
   error) none of them do. `id` sequences are reset to the restored max so
   the next insert doesn't collide. Foreign-key checks are disabled for the
   duration (`session_replication_role = replica`) so a scoped restore of one
   table doesn't need every table it references also restored in the same
   call — it just needs to end up in a state where the FKs are valid again.

4. **After any restore:** hit `/health`, spot-check the restored rows in the
   admin console, and note the incident + what was lost (rows written to that
   table between the backup and the restore) in `Task_Log.md`.

---

## How the backups work

- **What:** every table in the `priceback` schema, dumped in one
  `REPEATABLE READ` read-only transaction (so every table reflects the same
  instant — no table dumped a few seconds after another already missed a
  write), gzip-compressed, one `.json.gz` file per table plus a
  `manifest.json` listing table names and row counts.
- **Where:** the same Cloudflare R2 bucket that already holds receipt/price-
  tag photos (`R2_BUCKET`), under `<env>/db-backups/<ISO timestamp>/` — `env`
  is `prod`/`dev`/`preview`/`local` per `backend/storage/storageEnv.js`, so
  environments never collide in the same bucket.
- **When:** a cron job in `backend/server.js` runs it daily at **04:10 UTC**
  (`trackJob("dbBackup", ...)` — a row lands in `job_runs` every night,
  success or failure; check there first if a backup is suspected missing).
  Gated on `USE_DB` and `R2_BUCKET` being set, so it's a no-op on an
  environment without a real database or object store configured.
- **Retention:** the newest 14 backups are kept (`DB_BACKUP_RETENTION` env
  var to change it); older ones are deleted automatically after each run.
  Fourteen daily backups ≈ two weeks of recovery points.
- **Run one manually** — e.g. right before a risky migration or a deploy
  you're nervous about, so there's a restore point newer than last night's:
  ```
  cd backend
  node --env-file=.env scripts/backup-db.js
  ```
- **Why hand-rolled instead of `pg_dump`:** Railway's build for this service
  is plain Node (Nixpacks auto-detect) with no Postgres client tools
  installed, and adding them is a build-image change nobody wanted to carry
  just for this. The dump goes through the same `pg` driver the app already
  depends on, and the table list is discovered from the catalog
  (`pg_tables`), so a new table added to `backend/db/schema.js` is backed up
  automatically — nothing here needs updating when the schema grows.
- **Code:** `backend/lib/dbBackup.js` (shared logic), `backend/scripts/
  backup-db.js` and `backend/scripts/restore-db.js` (CLI wrappers), tested in
  `backend/tests/dbBackup.test.js` against an in-memory fake DB + fake R2 (no
  live connection needed to run that suite).

---

## The gap this doesn't cover: Supabase is on the Free plan

Supabase's own managed backups (nightly, dashboard-restorable) and
point-in-time recovery are **Pro-plan-and-above features**. The org this
project bills under (`Prosoft Inc.`, org `vrpoqvuksexuputrkrow`) is currently
on the **Free** plan — confirmed via the Supabase API on 2026-09-26 — so
there is **no Supabase-native backup** sitting behind the project today. The
R2-based backup above is a real, working, tested substitute (this doc's
procedures above all work against it right now), but it has two honest
limitations Supabase's own PITR would remove:

- **RPO of up to 24 hours** — one backup per day, not continuous. A mistake
  made 23 hours after the last nightly backup loses up to 23 hours of writes
  to any table that gets restored.
- **No point-in-time restore** — you can go back to any *daily snapshot*, not
  to "5 minutes before the bad query ran".

**Recommendation:** upgrading the Supabase org to the Pro plan (~US$25/mo)
adds automatic nightly backups (7-day retention) managed by Supabase directly
and unlocks the Point-in-Time-Recovery add-on for near-arbitrary restore
points — a second, independent line of defense on top of the R2 backups
above, at low ongoing cost relative to what a real data-loss incident would
cost. This is a billing decision only Maxim can make (Supabase org settings →
Billing); nothing in this repo blocks it.

---

## Quick reference

| Need | Command / location |
|---|---|
| Roll back a bad backend deploy | Railway → `priceback-production` → Deployments → previous deploy → Redeploy |
| List available DB backups | `node --env-file=.env scripts/restore-db.js --list` (from `backend/`) |
| Run a backup right now | `node --env-file=.env scripts/backup-db.js` |
| View a table's backed-up rows (read-only) | `scripts/restore-db.js --timestamp=<ts> --dump-table=<table>` |
| Restore one/some tables | `scripts/restore-db.js --timestamp=<ts> --tables=<a,b> --yes` |
| Restore everything | `scripts/restore-db.js --timestamp=<ts> --yes` |
| Check nightly backup job history | `job_runs` table, `jobName = 'dbBackup'` |
| Migration conventions / dev vs prod Supabase ids | `Operations/DEPLOYMENT.md` → "Database (Postgres)" |
| Security/privacy breach (different runbook) | `Operations/incident-response.md` |
