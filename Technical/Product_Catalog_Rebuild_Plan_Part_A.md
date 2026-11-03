# Part A — Egress, job schedules, fee-line guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Supabase egress at its measured sources, stop every non-production environment from running scheduled jobs, start the Same-Day savings run after Same-Day publishes, and never fill a fee line from the database.

**Architecture:** Server-internal changes only (no route, field or migration): a pure scheduler gate wrapping the cron block of `startServer()`; the tag-credit sweep stops re-checking pools already settled this week; the database fill keeps its candidate list in memory and refreshes it incrementally instead of downloading the products table per receipt; a shared fee-name pattern guards the fill. A read-only probe measures Same-Day's publication hour; the schedule change itself is a prod config row on Maxim's go.

**Tech Stack:** Node.js (CommonJS), drizzle-orm + raw `sql`, PostgreSQL (Supabase), `node:test` + `node:assert/strict`, c8; Railway CLI for env vars.

**Spec:** `Technical/Product_Catalog_Rebuild_Design.md` (§2 egress table, §6.1, §6.2, §6.8, §7 part A–C).

**Branch:** `hotfix/egress-and-job-schedules` off `main` (created at `425f0b3`) → PR into `main`; docs on `docs/products-catalog-rebuild`.

## Global Constraints

- Old app builds: no route, response field or status changes (`Technical/Backend_Backward_Compatibility.md`); `/health` gets one **additive** admin-only field.
- Production Railway environment name is **`production`** (read 2026-11-03 with `railway status --json`; dev is `Development`).
- Kill switches keep their fresh reads (`PRICE_DROP_PUSH_ENABLED`, `PRICE_TAG_ALREADY_VERIFIED_NO_CREDIT` when a shopper is scanning, tag-scan limits, Gemini switches, app-status minimum build / maintenance).
- Fee pattern (verbatim, `lib/receiptAutoFix.js:51`): `/\b(?:DEPOSIT|CONSIGNE|ECO\s*FEE|ECOFRAIS|ENVIRO\s*FEE|ECO\s*FRAIS)\b/i`.
- Tests ship in the same commit; full backend suite (`npm test` in `backend/`, the c8 gate) green before the PR; DB suites run against **dev** (`backend/.env`), never two suites at once.
- No scheduled job is re-enabled on dev to test anything; scripts run once from the CLI.
- No prod write without Maxim's explicit go (env vars, `savings_sources` rows, deploy).

## Review Focus

1. **A prod deploy where `RAILWAY_ENVIRONMENT_NAME` is not exactly `production`** (renamed env, typo, casing) → every job silently stops. Expect: the gate is case-insensitive on the name, `SCHEDULED_JOBS_ENABLED=true` overrides, `/health` (admin) shows `scheduler.enabled` and its reason, and the boot log says it. Test pins `Production` and ` production ` (trim) as on.
2. **A pool settled this week that a shopper scans again** (callerSub set) → behaviour unchanged: the scan path still reads `PRICE_TAG_ALREADY_VERIFIED_NO_CREDIT` fresh and may pay the caller. Only the sweep (no caller) skips settled pools. Test pins both.
3. **A pool settled LAST week that verifies again this week** → it is a candidate again (week boundary is Monday 00:00 UTC, `startOfWeekUTC`). Test pins it.
4. **A product created in the same transaction as the receipt being filled** (an earlier line of the same receipt) → still a match candidate (the incremental read runs inside `tx`). Test pins it.
5. **A fee line sent without `ignored: true`** (old build, OCR variant `ENVIRO FEE C`, `DEPOSIT CL`, `ECOFRAIS`) → no item number, no name, no price filled. Test pins each spelling.

---

### Task 1: Scheduler gate — no scheduled job outside production

**Files:**
- Create: `backend/lib/schedulerGate.js`
- Modify: `backend/server.js` — `startServer()` (~13916–14238): the boot runs `runDailyMaintenance()` / `runDbRetentionJobs()` (~13945–13946), `createSweepScheduler(...)`+`sweepScheduler.start()`+catch-up timer (~13955–14027), and every `cron.schedule(...)` (~14029–14230); the admin branch of `app.get("/health")` (~4162–4330)
- Test: `backend/tests/schedulerGate.test.js`

**Interfaces:**
- Produces: `decideScheduler(env: object) → { enabled: boolean, reason: "forced_on" | "forced_off" | "production" | "not_production" }`; `module.exports = { decideScheduler }`.

- [ ] **Step 1: Write the failing test** — `tests/schedulerGate.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { decideScheduler } = require("../lib/schedulerGate");

test("production runs the scheduler", () => {
  assert.deepEqual(decideScheduler({ RAILWAY_ENVIRONMENT_NAME: "production" }), { enabled: true, reason: "production" });
  assert.equal(decideScheduler({ RAILWAY_ENVIRONMENT_NAME: " Production " }).enabled, true);
});
test("every other environment is off by default", () => {
  assert.deepEqual(decideScheduler({ RAILWAY_ENVIRONMENT_NAME: "Development" }), { enabled: false, reason: "not_production" });
  assert.deepEqual(decideScheduler({}), { enabled: false, reason: "not_production" });
});
test("SCHEDULED_JOBS_ENABLED overrides both ways", () => {
  assert.deepEqual(decideScheduler({ RAILWAY_ENVIRONMENT_NAME: "production", SCHEDULED_JOBS_ENABLED: "false" }), { enabled: false, reason: "forced_off" });
  assert.deepEqual(decideScheduler({ SCHEDULED_JOBS_ENABLED: "true" }), { enabled: true, reason: "forced_on" });
  assert.equal(decideScheduler({ RAILWAY_ENVIRONMENT_NAME: "production", SCHEDULED_JOBS_ENABLED: "" }).enabled, true);
  assert.equal(decideScheduler({ SCHEDULED_JOBS_ENABLED: "TRUE" }).enabled, true);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../lib/schedulerGate'`)

Run (from `backend/`): `node --test tests/schedulerGate.test.js`

- [ ] **Step 3: Implement `decideScheduler(env)`** in `lib/schedulerGate.js`. `SCHEDULED_JOBS_ENABLED` compared trimmed + lower-case: `"true"` → forced_on, `"false"` → forced_off, anything else ignored; then `RAILWAY_ENVIRONMENT_NAME` trimmed + lower-case `=== "production"`. Header comment: why (dev and prod share one Supabase plan; Maxim 2026-11-02 "disable dev railway runs never do that again").

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Wire it in `startServer()`.** Compute `const scheduler = decideScheduler(process.env)` once at the top of `startServer()`, log `[scheduler] on|off (<reason>)`, and wrap in `if (scheduler.enabled) { … }`: the two boot runs, the sweep scheduler with its catch-up timer, and every `cron.schedule`. Leave `configService.warm()/startAutoRefresh()`, `restoreBudgetsFromKv()`, `watchState.start()` and the HTTP server untouched (serving needs them). Keep `sweepScheduler` referenced safely where later code uses it (e.g. shutdown) — `null` when off. Store the decision in a module-level `let _schedulerDecision = { enabled: false, reason: "not_started" }`.

- [ ] **Step 6: Report it on `/health` (admin payload only)** — add `scheduler: _schedulerDecision` to the admin `res.json({...})`. Not in `publicPayload`. Not read by `healthy`.

- [ ] **Step 7: Run** `node --test tests/schedulerGate.test.js tests/healthDataDir.test.js tests/sweepScheduler.test.js` — expect PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/lib/schedulerGate.js backend/tests/schedulerGate.test.js backend/server.js
git commit -m "fix(ops): scheduled jobs run only in production (dev shares the Supabase egress quota)"
```

- [ ] **Step 9 (ops, before merge): set `SCHEDULED_JOBS_ENABLED=false` on the dev service** — `railway variables --environment Development --service Priceback --set SCHEDULED_JOBS_ENABLED=false` (harmless under today's code). Do **not** touch production variables.

---

### Task 2: Tag-credit sweep stops re-checking pools already settled this week

**Files:**
- Modify: `backend/repos/tagCreditsRepo.js` — `settleAllVerified` (~352–398), `settleVerifiedTagCredits` (~178–300)
- Test: `backend/tests/tagCreditsEngineDb.test.js` (DB, dev)

**Interfaces:**
- Consumes: `scopeKeyFor`, `startOfWeekUTC`, `ymd`, table `tag_credit_settlements (product_id, scope_key, week_start)`.
- Produces: `settleVerifiedTagCredits({ sku, storeCode, province, warehouseId, callerSub, productId? }, now)` — new optional `productId` (number) skips the `pricesRepo.getProduct` lookup when given; return shape unchanged. `settleAllVerified(now)` return shape unchanged (`{ candidates, settled, paidSubs }`; `candidates` now counts only unsettled pools).

Why (design §2): each price sweep enumerated ~1,414 pools and, per pool, ran `getProduct` + the `WITH fresh AS` query + an `INSERT … ON CONFLICT DO NOTHING` + a fresh `app_config` read — prod's top four query volumes (7.5 M product reads, 7.5 M price queries, 5.9 M config reads, 7.5 M enumeration rows). A pool already settled this week, swept with no caller, can pay nobody (`callerRow` needs `callerSub`), so skipping it changes no outcome.

- [ ] **Step 1: Write the failing tests** (append to `tests/tagCreditsEngineDb.test.js`, same fixtures/helpers the file already uses for "settleAllVerified sweeps an admin-verified savings into a payout"):
  - `"settleAllVerified skips a pool already settled this week"` — seed an admin-verified savings tag pool; `await settleAllVerified(now)` → `settled === 1`; second `await settleAllVerified(now)` → its result's `candidates` does not include that pool (assert `candidates` decreased by 1) and `settled === 0`, ledger credit count for the contributor unchanged.
  - `"a pool settled last week is a candidate again this week"` — same pool, second call with `now` + 7 days (still before the tag's `valid_until` and inside the verify window: choose dates accordingly) → it is enumerated again (`candidates` includes it).
  - `"a shopper's scan of an already-settled pool still reads the admin switch"` — keep the existing test `already-verified savings: no credit while the admin switch is on, paid once it is off` passing unchanged (it is the callerSub path).
  - `"productId given skips the SKU lookup"` — `settleVerifiedTagCredits({ sku: "<nonexistent>", productId: <seeded id>, warehouseId, }, now)` returns the same verdict as with the real sku.

- [ ] **Step 2: Run — expect the new ones FAIL**

Run (from `backend/`): `node --env-file=.env --test tests/tagCreditsEngineDb.test.js`
Read the summary: `skipped 0` (a skipped DB suite exits green — see memory "node --test SKIPS DB suites").

- [ ] **Step 3: Implement.**
  - Enumeration: select `p.id AS product_id` too, and add `AND NOT EXISTS (SELECT 1 FROM priceback.tag_credit_settlements s WHERE s.product_id = p.id AND s.week_start = ${weekStart} AND s.scope_key = CASE WHEN w.code IS NOT NULL THEN 'wh:' || w.code ELSE 'pr:' || upper(pv.code) END)` with `weekStart = ymd(startOfWeekUTC(now))` — the same key `scopeKeyFor` builds (`wh:<warehouse code>` first, else `pr:<PROVINCE>`).
  - Pass `productId: r.product_id` into `settleVerifiedTagCredits`; there, `const product = productId ? { id: Number(productId) } : await pricesRepo.getProduct(...)`.
  - In the already-settled branch, read `PRICE_TAG_ALREADY_VERIFIED_NO_CREDIT` fresh **only when `callerSub` is set** (no caller → no row can be paid → skip the read).

- [ ] **Step 4: Run — expect PASS**, plus `node --test tests/tagCreditsRepo.test.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/repos/tagCreditsRepo.js backend/tests/tagCreditsEngineDb.test.js
git commit -m "fix(egress): the tag-credit sweep skips pools already settled this week"
```

---

### Task 3: Database fill — candidates kept in memory, fee lines never filled

**Files:**
- Create: `backend/shared/feeLines.js` (shared with `lib/receiptAutoFix.js`)
- Modify: `backend/lib/receiptAutoFix.js:51` (import the pattern instead of defining it), `backend/lib/receiptDatabaseFill.js` (`fillLines`, `needsFill`), `backend/repos/pricesRepo.js` (`namedProductsForStore`, ~372–385)
- Test: `backend/tests/feeLines.test.js`, `backend/tests/receiptDatabaseFill.test.js`, `backend/tests/namedProductsCacheDb.test.js` (DB, dev)

**Interfaces:**
- Produces: `shared/feeLines.js` → `FEE_NAME` (the verbatim regex in Global Constraints) and `isFeeLine(line: {name?: string, ignored?: boolean}) → boolean` (true when `ignored === true` or `FEE_NAME.test(name)`).
- Produces: `pricesRepo.namedProductsForStore(storeCode, tx?) → Promise<Array<{sku, name}>>` — same contract, now served from a per-store in-process cache: first call reads all rows (today's query) and remembers `maxId`; later calls read only `id > maxId` rows (same filter) and append; a full re-read when the cache is older than `NAMED_PRODUCTS_FULL_REFRESH_MS = 60 * 60 * 1000`. `pricesRepo.__resetNamedProductsCache()` and `pricesRepo.__namedProductsCacheStats() → { fullReads: number, incrementalReads: number }` for tests.

- [ ] **Step 1: Write the failing tests.**
  - `tests/feeLines.test.js`: `isFeeLine` true for `ENVIRO FEE C`, `DEPOSIT CL`, `DEPOSIT QC`, `CONSIGNE QC/310062`, `ECOFRAIS`, `ECO FEE`, `ECO FRAIS`, and for `{ name: "MILK", ignored: true }`; false for `KS WATER` and `DEPOSITORY BOX` (no word boundary after `DEPOSIT`).
  - `tests/receiptDatabaseFill.test.js`: `"a fee line without the ignored flag is never filled"` — `fillLines([{ name: "ENVIRO FEE C", lineTotal: 0.07 }, { name: "DEPOSIT CL", lineTotal: 0.25 }, { sku: "9484", name: "DEPOSIT", lineTotal: 0 }], { lookups })` with lookups that would match/price anything → `filled === 0`, lines returned unchanged, `productsForMatch` and `priceFor` never called; `needsFill` of the same lines → `false`.
  - `tests/namedProductsCacheDb.test.js`: `"a product created after the first read is a candidate on the next"` (insert a uniquely named product via `pricesRepo.upsertProduct`, call again → present); `"a product created inside the caller's transaction is a candidate"` (inside `getDb().transaction(tx => …)`, upsert then `namedProductsForStore("costco", tx)` → present); `"the second call reads only new rows"` (after `__resetNamedProductsCache()`: two calls → `__namedProductsCacheStats()` is `{ fullReads: 1, incrementalReads: 1 }` and both calls return the same length when nothing was added).

- [ ] **Step 2: Run — expect FAIL**

Run (from `backend/`): `node --test tests/feeLines.test.js tests/receiptDatabaseFill.test.js` and `node --env-file=.env --test tests/namedProductsCacheDb.test.js` (check `skipped 0`).

- [ ] **Step 3: Implement.** `fillLines`: `const fee = isFeeLine(it)` (replaces `it.ignored === true`) and skip the name fill too when `fee`; `needsFill`: same predicate. `receiptAutoFix.js`: `const { FEE_NAME } = require("../shared/feeLines")`, behaviour unchanged. `namedProductsForStore`: the cache above, keyed by `storeCode`; the incremental and full reads run on `tx || getDb()`; rows created inside an uncommitted `tx` are **returned but not cached** (cache only reads made on `getDb()`), so a rolled-back product never lingers.

- [ ] **Step 4: Run — expect PASS**; then the corpus proof that decisions are unchanged: `node --env-file=.env scripts/harvest-catalog.mjs --corpus` (read-only) — same corrections as before the change.

- [ ] **Step 5: Commit**

```bash
git add backend/shared/feeLines.js backend/lib/receiptAutoFix.js backend/lib/receiptDatabaseFill.js backend/repos/pricesRepo.js backend/tests/feeLines.test.js backend/tests/receiptDatabaseFill.test.js backend/tests/namedProductsCacheDb.test.js
git commit -m "fix(egress): the database fill keeps its candidates in memory; a fee line is never filled"
```

---

### Task 4: Measure the Same-Day publication hour (read-only probe)

**Files:**
- Create: `backend/scripts/probe-sameday-publish.mjs`
- Test: `backend/tests/probeSamedayPublish.test.js` (the pure summariser)

**Interfaces:**
- Consumes: `harvestSameday({ storefront, only, online: false, todayISO, client })` (`services/savings/sources/samedaySource.js`).
- Produces: `summarizeEnds(observations: Array<{endsOn: string}>, todayISO: string) → { total: number, endsToday: number, byEnd: Record<string, number> }` exported from the script's sibling `backend/lib/samedayPublishProbe.js`.

- [ ] **Step 1: Write the failing test** — `summarizeEnds([{endsOn:"2026-11-02"},{endsOn:"2026-11-08"},{endsOn:"2026-11-08"}], "2026-11-02")` → `{ total: 3, endsToday: 1, byEnd: { "2026-11-02": 1, "2026-11-08": 2 } }`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `lib/samedayPublishProbe.js` and the script: one warehouse (`--warehouse 1261` default, Vaughan), no DB, prints one JSON line `{ at: <ISO>, torontoHour, warehouse, ...summarizeEnds }`. Appends to the file given by `--out`.
- [ ] **Step 4: Run — expect PASS**; then one live run: `node scripts/probe-sameday-publish.mjs --out <scratchpad>/sameday-publish.jsonl`.
- [ ] **Step 5: Commit**

```bash
git add backend/lib/samedayPublishProbe.js backend/scripts/probe-sameday-publish.mjs backend/tests/probeSamedayPublish.test.js
git commit -m "chore(savings): read-only probe of Same-Day's publication hour"
```

- [ ] **Step 6 (measurement, no code):** run the probe hourly from the local machine across at least the next two day rollovers (a background loop, read-only, ~2 requests/hour). The publication hour = the first run where yesterday's ending savings are gone and the new end dates appear. Record it in design §6.2.
- [ ] **Step 7 (prod config, on Maxim's go):** `UPDATE priceback.savings_sources SET start_hour = <hour+1> WHERE code IN ('sameday_costco','sameday_business_centre')` (Business Centre one hour after Costco if both publish together, so the two runs never overlap) — via `PATCH /api/admin/savings/sources/:code { "startHour": <h> }` (`Technical/Savings-Harvest.md`); read back with `GET /api/admin/savings/sources`.

---

### Task 5: Job-schedule audit (document, then Maxim decides)

**Files:**
- Modify: `Technical/Product_Catalog_Rebuild_Design.md` — new §6.2a table
- No code unless Maxim approves a cadence change (then one commit per change, with its test where the cadence is a constant).

- [ ] **Step 1:** For each job in `startServer()` (list in design §2/§6.2: `sweepInMemoryState`, `ocrAuthProbe`, `runDailyMaintenance`, `runDailyDigest`, `runStoreLaunchNotifications` */15, `adminAlerts` */5, `reengagement`, `pastReceiptsTip`, `pastReceiptsTipBackfill` */15, `pendingClaimsReminder`, `inactiveClaimsNudge`, `priceDropGuarantee`, `runDbRetentionJobs`, `reconcileCredits`, `harvestSavings` hourly tick, `harvestCatalog` hourly tick, `purgeRestoreLedgers` hourly, `pruneAuthOutcomes`, `pruneNotificationHistory`, `purgeDeletedAccounts`, `dbBackup`, `priceSweep`): what it reads (from its code), what changes its input, rows/calls per run (from a `pg_stat_statements` snapshot diff over 24 h on prod, read-only), today's cadence, proposed cadence + reason.
- [ ] **Step 2:** Bring the table to Maxim; apply only what he approves. `dbBackup` (~2 GB/month) is listed with options, not changed.

---

### Task 6: Egress baseline, docs, PR

**Files:**
- Create: `backend/scripts/egress-snapshot.mjs` (read-only: top 25 `pg_stat_statements` rows by rows and by calls, as JSON, for the DB in `DATABASE_URL`)
- Modify (docs hub): `Technical/Bugs_Common_Fixes.md` (new entry: the tag-credit sweep N+1 and the whole-table fill), `Technical/Product_Catalog_Rebuild_Design.md` (§2/§6.1 corrected: the four top prod volumes are one loop; config-read caching dropped), `Operations/Task_Log.md` (status), `Technical/Backend_Backward_Compatibility.md` if a note is due (no route changes → "unaffected" line)

- [ ] **Step 1:** Take the **before** snapshot on prod and dev (read-only; Supabase MCP `execute_sql` or the script) and save it under the docs hub `Operations/Egress/2026-11-03-before.json`.
- [ ] **Step 2:** Full backend suite from `backend/`: `npm test` — expect 0 fail, coverage gate passed (re-run a red DB file alone before believing it).
- [ ] **Step 3:** Docs above; commit docs on `docs/products-catalog-rebuild`.
- [ ] **Step 4:** Push the branch and open the PR into `main` with the template's **Old app builds** section ("server-internal; no route/field change; `/health` admin field additive").
- [ ] **Step 5 (on Maxim's go):** merge, deploy; confirm on prod `/health?token=…` → `scheduler.enabled: true, reason: "production"`; on dev → `false`. Merge `main` into `main-test-features` via `sync/main-into-main-test-features-2026-11-0X`.
- [ ] **Step 6:** 7 days later, the **after** snapshot; report the deltas and the Supabase usage page egress for both projects.
