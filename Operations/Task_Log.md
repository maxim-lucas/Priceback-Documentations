# Task Log

> **Read this file BEFORE starting any coding task.** It is the running record of
> everything Maxim has asked for. The point is continuity: don't undo, revert, or
> contradict a decision already recorded here just because a new session started
> with no memory of it.
>
> **How to use it (standing workflow, not a per-request ask):**
> 1. **Before coding** — scan this log for entries touching the same files,
>    feature, or decision. If your new change would reverse or conflict with a
>    past entry, stop and confirm with Maxim first.
> 2. **When given a task** — append a new entry (newest at the top of the list)
>    using the template below.
> 3. **When a task is done** — mark its status and note the commit/PR.
>
> Each entry is one task. Keep it short — a few lines. This replaces relying on
> wrapup/recall every session for "what did I already ask for."

### 2026-07-24 — Play-release blockers: account-deletion web page + Data Safety answers
- **Asked (/goal, cont.):** finish preparing for Play promotion, avoid refusals.
- **Account-deletion web URL** (hard Play requirement): built `delete-account.html`
  + `delete-account-fr.html` in the **Priceback-Website** repo (matches legal-page
  shell; documents in-app + email deletion paths, what's deleted vs briefly
  retained, timelines; mirrors `DELETE /api/me/account`). `_redirects` clean URLs
  + `/delete` `/account-deletion` aliases. **Website PR #7** — left unmerged
  (merging deploys live via Cloudflare); Maxim merges when ready.
- **Data Safety + content rating**: `docs/Play_Data_Safety_Answers.md` — exact
  copy-paste form answers derived from `backend/db/schema.js` + shipped perms
  (advertising-ID = No; vendors = processors, not "sharing"; IARC = Everyone;
  Ads = No). Reduces those console screens to data entry.
- **Docs:** checklist §10 links both + status rows updated.
- **Genuinely user-only remaining** (I can't access these): merge website PR +
  set Data-deletion URL; enter Data Safety/rating in console; rotate Vision key +
  Supabase password (§8A BLOCKER); screenshots + demo account; `eas build
  --profile production` → Internal testing → promote. All in PUBLISH_CHECKLIST.

### 2026-07-24 — Play-release hardening: GMS error handling + Android permission hygiene
- **Asked (/goal):** add more error handling per Google's guidance (status
  codes) and prepare the app for Google Play promotion, avoiding review
  rejections — want to release this week.
- **Error handling:** extended `signInWithGoogle` from just the INTERNAL_ERROR
  retry (Bug #128) to full GMS status-code classification — transient
  INTERNAL_ERROR(8)/INTERRUPTED(14)/TIMEOUT(15) retried once; NETWORK_ERROR(7)
  → honest connectivity message; DEVELOPER_ERROR(10) rethrown loud; raw
  CANCELED(16) treated as cancellation. Tests added.
- **Permission hygiene (rejection-proofing):** new
  `plugins/withAndroidPermissionCleanup.js` strips 3 dependency-injected
  sensitive perms the app doesn't use — `AD_ID` (FCM; keeps Data Safety
  "advertising ID = No"), `RECORD_AUDIO` (expo-camera; photos only),
  `ACCESS_FINE_LOCATION` (expo-location; coarse suffices, `Accuracy.Low`).
  Verified against a fresh `expo prebuild` manifest (all three carry
  `tools:node="remove"`; COARSE/CAMERA retained). Plugin unit-tested.
- **Docs:** `PUBLISH_CHECKLIST.md` §10 "Permissions hygiene" + status rows;
  Bug #128 extended. Target SDK already API 35 (Expo 55) — no change. No
  migration. Console-side items (Data Safety form, account-deletion web URL,
  screenshots, demo account) remain the user's — enumerated in the checklist.

### 2026-07-24 — Fix Sentry `ApiException: INTERNAL_ERROR` in Google Sign-In (Bug #128)
- **Asked (/goal):** root-cause + fix the new Sentry exception
  (issue 7628779056, release 2.8.0 prod): Google Sign-In threw GMS
  `INTERNAL_ERROR` (code 8), handled, `flow:signin_google`, 2 events / 1 device.
- **Diagnosis:** transient Play Services hiccup, NOT a config bug (config =
  `DEVELOPER_ERROR` code 10, would fail all sign-ins). `signInWithGoogle`
  re-threw any unrecognized code → user-facing failure + Sentry noise.
- **Fix:** retry-once-on-transient-GMS-error loop in `signInWithGoogle`
  (`isTransientGmsError`, 300 ms backoff, persistent still throws) +
  `classifyError` maps a surviving Play Services error to the `server`
  ("try again") bucket instead of generic unknown. Tests added in
  `authServiceSignIn.test.js` + `errorSupport.test.js`; 61 pass. No migration.
  Mobile-only; will land on a `fix/` branch → PR.

### 2026-07-23 — Move API-call logging off the DB to free stdout logs; drop api_audit_log table
- **Asked (/goal):** "find a more suitable solution to log the api calls other
  than the database storage and it has to be free and remove all the api calls
  from the database (table)."
- **Design:** the audit log is explicitly breadcrumbs, not authoritative data
  (billing goes through `credit_ledger`, transactional). Replaced the
  DB-backed `api_audit_log` sink with **structured single-line JSON to stdout**,
  which Railway captures for free with zero infra and zero per-request DB
  round-trip — so the in-memory buffer/flush machinery is gone too. Kept the
  privacy IP-hash (daily-rotating salt) and the `X-Request-Id` header.
  Logging is now decoupled from `USE_DB`: gated on `AUDIT_LOG` (default on;
  `test.env` sets `AUDIT_LOG=false` so route tests stay quiet/deterministic,
  matching today's USE_DB-off behavior). Trade-off noted: Railway's log
  retention (~days) is shorter than the old 90-day DB window — acceptable for
  breadcrumbs; point an external log drain at stdout if longer retention is
  wanted later.
- **Removed from DB:** migration `0008_drop_api_audit_log` DROPs the table
  (indexes + FKs cascade); consolidated `db/deploy/schema.sql` regenerated;
  `apiAuditLog` schema def + export deleted; `repos/auditRepo.js` and
  `jobs/pruneAuditLog.js` deleted; the maintenance prune call + shutdown flush
  in server.js removed; `RETENTION_AUDIT_DAYS` config default dropped.
  **PROD owes migration 0008** before/at next prod deploy.
- **Files:** backend/middleware/audit.js (rewrite), backend/server.js,
  backend/db/schema.js, backend/db/migrations/0008_drop_api_audit_log.sql (+meta),
  backend/db/deploy/schema.sql, backend/config/defaults.js, backend/test.env,
  deleted repos/auditRepo.js + jobs/pruneAuditLog.js; tests auditMiddleware
  (rewrite), reposUnit (auditRepo block removed), pruneJobs (pruneAuditLog block
  removed), deleted auditRepoFkFallback; backend test.env (AUDIT_LOG=false);
  docs Environment_Configuration/incident-response/database-schema/database_design/
  Publish_Requirements/PERFORMANCE_REVIEW/Bugs_Common_Fixes/Task_Log + verify skill.
- **Status:** done — backend `npm test` green (957 pass / 0 fail / 1 dormant
  skip, 958 total; coverage 92.62/78.4/92.98/92.62 ≥ floors 90/75/91/90;
  audit.js 100% lines). Migration 0008 applied to DEV during the run; **PROD
  owes 0008**. Not committed yet.

### 2026-07-23 — Wire `/health?probe=ocr` into uptime monitoring (billing-lapse page-me)
- **Asked:** "Wire /health?probe=ocr into uptime monitoring so a billing lapse
  pages you before users hit it next time" (goal set via `/goal`), plus "wire any
  necessary feature in health to avoid this type of problem in the future."
  Directly follow-on from the same-day outage below (Bugs_Common_Fixes #127),
  whose own "Prevent" line called for exactly this.
- **Done:** added a proactive cron (`runOcrAuthProbeCheck`, `OCR_AUTH_PROBE_CRON`,
  default `20 */6 * * *`) that runs the same real-Vision-call probe behind
  `/health?probe=ocr` on a schedule and pages via the existing throttled
  ops-alert email (`raiseAlert`) the instant it stops returning `ok` — no
  external service required. Also documented pointing an external uptime
  monitor (UptimeRobot/Better Stack/etc.) at `/health?probe=ocr&token=...` as a
  second, independent paging channel. Full test coverage in
  `backend/tests/ocrAuthProbeCron.test.js` + `ocrAuthProbeCronNoKey.test.js`;
  `npm test` green (982 tests, coverage gate passes). Docs updated:
  `Environment_Configuration.md` (new "OCR (Vision) auth probe" section),
  `Bugs_Common_Fixes.md` #127 "DONE" follow-up.
- **Files:** backend/server.js, backend/tests/ocrAuthProbeCron.test.js,
  backend/tests/ocrAuthProbeCronNoKey.test.js, docs/Environment_Configuration.md,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.

### 2026-07-23 — CI follow-ups on PR #193: artifact quota + gitleaks disabled
- **Context:** after re-enabling CI (entry below), the `Tests` workflow hit
  two failures on push: (1) the mobile job's coverage-artifact upload failed
  with "Artifact storage quota has been hit" even though all 2974 tests
  passed — fixed by marking both coverage-upload steps `continue-on-error:
  true` in `.github/workflows/test.yml` (upload is best-effort, not part of
  the test gate); Maxim separately cleaned up old artifacts to free quota.
  (2) the `security` job's gitleaks step found 8 leaks in the current tree.
- **Asked:** "disactivate the gitleaks for now but don't delete it and add a
  note for that to reactivate it before publishing the app."
- **Done:** gitleaks step in `.github/workflows/test.yml` muted via `if:
  false` (kept in file, one-line revert); note added to
  `docs/PUBLISH_CHECKLIST.md` to re-enable before publish, once the §8A
  credential-rotation blocker is resolved.
- **Not done:** did not investigate or rotate whatever gitleaks matched —
  that's still open under §8A.
- **Files:** `.github/workflows/test.yml`, `docs/PUBLISH_CHECKLIST.md`.
- **Status:** pushed to `claude/github-workflows-docs-nqhvzb` (PR #193).

### 2026-07-23 — Re-enable GitHub Actions CI (push/pull_request/release triggers)
- **Asked:** "reactivate the workflows on Github for this repo."
- **Context:** both workflows were switched to `workflow_dispatch`-only on
  2026-07-11 after GitHub Actions free-tier minutes were exhausted for that
  billing period (see Bug/PR history around 2026-07-11, and
  `docs/PUBLISH_CHECKLIST.md` §"GitHub Actions CI").
- **Done:** restored `push`/`pull_request` (branches: `main`) on
  `.github/workflows/test.yml` and `release: [created]` on
  `.github/workflows/npm-publish-github-packages.yml`; `workflow_dispatch` kept
  on both as a manual fallback. Updated `docs/PUBLISH_CHECKLIST.md` to reflect
  the re-enabled state.
- **Not verified:** whether the free-tier minutes allowance has actually reset
  for the current billing period — if it hasn't, the next push/PR run may fail
  or queue rather than exhausting further budget. Worth a check in the repo's
  Settings → Billing → Actions page.
- **Files:** `.github/workflows/test.yml`, `.github/workflows/npm-publish-github-packages.yml`, `docs/PUBLISH_CHECKLIST.md`.
- **Status:** done, pushed to `claude/github-workflows-docs-nqhvzb`.

### 2026-07-23 — Wire `/health?probe=ocr` into uptime monitoring (billing-lapse page-me)
- **Asked:** "Wire /health?probe=ocr into uptime monitoring so a billing lapse
  pages you before users hit it next time" (goal set via `/goal`), plus "wire any
  necessary feature in health to avoid this type of problem in the future."
  Directly follow-on from the same-day outage below (Bugs_Common_Fixes #127),
  whose own "Prevent" line called for exactly this.
- **Done:** added a proactive cron (`runOcrAuthProbeCheck`, `OCR_AUTH_PROBE_CRON`,
  default `20 */6 * * *`) that runs the same real-Vision-call probe behind
  `/health?probe=ocr` on a schedule and pages via the existing throttled
  ops-alert email (`raiseAlert`) the instant it stops returning `ok` — no
  external service required. Also documented pointing an external uptime
  monitor (UptimeRobot/Better Stack/etc.) at `/health?probe=ocr&token=...` as a
  second, independent paging channel. Full test coverage in
  `backend/tests/ocrAuthProbeCron.test.js` + `ocrAuthProbeCronNoKey.test.js`;
  `npm test` green (982 tests, coverage gate passes). Docs updated:
  `Environment_Configuration.md` (new "OCR (Vision) auth probe" section),
  `Bugs_Common_Fixes.md` #127 "DONE" follow-up.
- **Files:** backend/server.js, backend/tests/ocrAuthProbeCron.test.js,
  backend/tests/ocrAuthProbeCronNoKey.test.js, docs/Environment_Configuration.md,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.

### 2026-07-23 — Prod outage triage: every scan fails + receipts show no items
- **Asked:** internal-testing build is up; opening the app shows receipts with
  only the hero card (no products) and **every** purchase/refund scan fails with
  "Our service is having a hiccup … our team has been notified."
- **Diagnosed (definitive):** the "hiccup" is `err.serverBody` = a backend **5xx**
  on the scan path. The production build points at `priceback-production.up.railway.app`
  (confirmed: `config/profiles` merge → `common.js` prod URL; `eas.json` production
  profile sets no `PRICE_API_URL`). `/health` is green but only checks the key is
  *present*. Probing prod `POST /api/ocr` returned **502**; Railway logs show
  **`[OCR] Vision returned 403: This API method requires billing to be enabled …
  project #200005505988`**. Root cause: **Google Cloud billing is disabled on the
  Vision project** — the key itself is valid (39-char `AIza…`). Same class as
  Bugs #81; both dev+prod OCR are down. The "empty products" is downstream of the
  same outage (no successful OCR ⇒ no line items); a read-only prod DB confirm was
  blocked by the safety classifier and is offered as an optional follow-up.
- **Fix (ops, only Maxim can do it):** re-enable billing on GCP project
  **#200005505988** →
  `https://console.developers.google.com/billing/enable?project=200005505988`.
  No app/backend deploy is needed; scans recover a few minutes after propagation.
- **Done in code (hardening):** `backend/lib/visionOcr.js` `callVisionOcr` now
  parses the Vision response defensively — a non-JSON (HTML) 403 body no longer
  throws (which had masked the billing-403 as "OCR service unreachable" on prod);
  the true 403 now drives the error map + `/health?probe=ocr`. Test added in
  `backend/tests/visionOcr.test.js`; `Bugs_Common_Fixes.md` entry #127 added.
- **Files:** backend/lib/visionOcr.js, backend/tests/visionOcr.test.js,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.
- **RESOLVED (2026-07-23):** Maxim supplied a valid billed Vision key from the
  main app project **695135372222**; I validated it off-prod (Vision direct →
  200), set `GOOGLE_VISION_API_KEY` on the prod Railway service via stdin (hash-
  confirmed it took), the service redeployed, and prod `/api/ocr` now returns
  **200** (real device scans logged `[OCR] Success`). Scanning restored. The dead
  key's project #200005505988 (billing off) is now unused — clean up or re-enable
  separately. New scans populate items; receipts left empty during the outage
  need a re-scan. Backend hardening (defensive Vision-body parse) still uncommitted
  — offered to push as a PR. Follow-up: restrict the new key to Cloud Vision API
  only (currently unrestricted).

### 2026-07-23 — Version bump for next Play release; build/submit blocked on credentials
- **Asked:** "create a new apk through Expo and push it to the google play console
  for review."
- **Found:** this session's sandbox has no `EXPO_TOKEN` / `eas login` session, no
  Google Play service-account JSON (the `submit.production` block in `eas.json`
  is empty), and no `google-services.json` on disk — so `eas build` and
  `eas submit` cannot actually run here. Also, `docs/PUBLISH_CHECKLIST.md` §8A
  (Vision API key + Supabase prod password rotation) is still an open BLOCKER,
  independent of the build itself.
- **Done instead:** bumped the release identifiers per `docs/DEPLOYMENT.md`
  "Version Bumping" (`2.7.0`/versionCode 18 → `2.8.0`/versionCode 19/iOS build
  19), covering the substantial feature/fix set landed since the 2.7.0 release
  (#151): Costco Executive membership, offline receipt-scan queue, animated
  scan interstitial, credit reconciliation cron, several money-path/security
  audits (Bugs #90–#126). `SplashScreen.js` reads the version from Expo config
  at runtime — no manual UI edit needed (same as the 2.7.0 release note).
- **Not done:** the actual `eas build --platform android --profile production`
  and `eas submit` — needs a human with an authenticated `eas login` / EXPO_TOKEN
  and the Play Console service-account key to run those commands (see
  `docs/DEPLOYMENT.md` Build Commands).
- **Files:** package.json, app.json.
- **Status:** version bump only, pushed to
  `claude/expo-apk-google-play-044f31`; build + Play submission still to be run
  by someone with EAS/Play credentials.

### 2026-07-20 — Local/CI parity: one gate, committed parameters (Bug #126)
- **Asked:** "I want local and CI always the same behavior and same parameters
  and everything — if it passes locally it should pass on CI without any even
  small difference."
- **Found 5 divergences:** backend pool (5 local vs 3 CI), backend concurrency
  (4 vs 1), coverage ratchet (skipped by local `npm test`, enforced in CI, on
  BOTH runners), mobile snapshots (`CI=true` fails a missing snapshot; locally
  it writes one and passes), Node major (24 local vs 22 pinned in CI).
- **Rule adopted:** the workflow may check out, install, supply credentials, and
  run `npm test` — nothing else. All parameters live in committed config.
- **Changes:** new committed `backend/test.env` (DB_POOL_MAX=3, no secrets,
  loaded AFTER `.env` so it wins); `npm test` is now THE gate on both runners
  (backend `c8 … --test-concurrency=1` + both env files; mobile
  `jest --ci --watchAll=false --coverage`), with `test:ci`/`test:coverage` as
  `npm test` aliases and `test:fast` differing only by coverage; `.nvmrc` (24)
  + `node-version-file` in both jobs; `--ci` moved out of the workflow env into
  the mobile script; workflow now writes only DATABASE_URL.
- **Files:** .github/workflows/test.yml, .nvmrc, package.json,
  backend/package.json, backend/test.env, __tests__/ciParity.test.js,
  docs/Bugs_Common_Fixes.md #126.
- **Status:** done — mobile 2873 pass / 123 suites, backend 976 pass / 0 fail
  with the ratchet, both via the new canonical `npm test`. Parity guard verified
  to FAIL when a CI-only knob is reintroduced.

### 2026-07-20 — Pool-starvation deadlock on the money paths (Bug #125)
- **Asked:** "dig into it" — investigate the concurrent-spend test that failed in
  the last CI run and that I'd reported as a probable flake.
- **Found:** not a flake and not a race. The test died on
  `timeout exceeded when trying to connect` before any assertion. `lookupId()`
  resolved cache misses on the POOL while callers held an open transaction, so a
  transaction checked out a SECOND connection; at concurrency ≥ pool max every
  connection is held by a transaction waiting for a connection → starvation
  deadlock until the 5s connect timeout. Seven call sites, all money paths
  (`consumeScanCreditOnce`, `recordTopupOnce`, signup grant, recon apply, plus
  tx-scoped helpers `applyCreditChangeTx`/`_ledgerRowForTx`/`appendMigrationSeed`
  — the helpers were invisible to a literal `.transaction(` grep). Cold-cache
  only, which is why it never reproduced locally. CI vs local was purely the pool
  budget: CI sets `DB_POOL_MAX=3`, local defaults to 5, and the test hard-coded 4
  racers — so the test was also demanding pool_max+1 connections.
- **Impact:** production pool is 5, so a burst of ≥5 concurrent scans on a cold
  cache (i.e. just after a deploy/restart) could deadlock the same way. The Bug
  #109 over-draw guard had also been failing 1/1 in CI since it landed, so it was
  guarding nothing there.
- **Changes:** `lookupId(table, code, exec)` optional executor, `tx` passed at
  every in-transaction site; the 4 constant-code money lookups hoisted above
  their transaction; on a transaction `lookupId` reads first and only calls
  `ensureSeeded()` on a real miss. Test now derives racer count from
  `DB_POOL_MAX` (asserts ≥2 so it can't degrade to a no-op) + new
  "concurrency ABOVE the pool max still completes" regression test that clears
  the lookup cache and oversubscribes the pool.
- **Files:** backend/db/client.js, repos/{creditsRepo,usersRepo,creditReconRepo}.js,
  tests/criticalPathAtomicity.test.js, docs/Bugs_Common_Fixes.md #125.
- **Status:** done — verified by reproducing the failure on pre-fix code under
  `DB_POOL_MAX=3`, then green: full backend suite 976 pass / 0 fail at pool 3.

### 2026-07-20 — Commit sweep: restore EXPIRY_EARLY_WARNING_DAYS in both shared/pricing.config copies
- **Asked (/goal):** commit everything in the tree and merge to GitHub.
- **Found while reviewing the diff:** the working tree DELETED
  `EXPIRY_EARLY_WARNING_DAYS: 7` from `backend/shared/pricing.config.js`. Root
  cause was pre-existing drift — commit 1207a52 (Bug #122 early claim reminder)
  added the constant to the BACKEND copy only, and a later sync of
  `shared/` → `backend/shared/` resolved that drift in the wrong direction by
  dropping it. Backend still consumes it in `config/configService.js` (x2) and
  `db/seed.js`, so `fallbackCfg.EXPIRY_EARLY_WARNING_DAYS` went `undefined` and
  seed.js would have written an undefined app_config value. Mobile only escaped
  because `pricingCatalogService` carries an inline `7` default.
- **Fix:** restored the constant in `shared/pricing.config.js` and re-synced the
  backend copy; the two files are now byte-identical (`diff` clean), which is the
  invariant the other `shared/` mirrors (e.g. ocrCleanup.js) follow.
- **Status:** done — backend configService (13) + sharedPricing (5) green; mobile
  pricingCatalogService/purchaseService/paywallScreen 139 green.

### 2026-07-19 — Offline receipt scan queue (parity with the price-tag queue)
- **Asked (/goal):** receipt scans must also work in offline mode like the price
  tag scan — queue the photo offline, process when the connection returns, and
  notify with the same notification type as the price-tag queue so the user can
  review after.
- **Changes:** new `src/services/receiptScanQueue.js` (mirrors tagScanQueue:
  AsyncStorage queue + documentDirectory/receipts_pending/ image persistence,
  `processPendingReceiptScans` worker gated on `probeReachable` + the credit
  gate; rejected gas/refund reads spend the 1 credit like online, unreadable →
  error without spend); new `src/screens/PendingReceiptScanScreen.js` review
  list ("Review & save" opens ScanScreen preloaded); ScanScreen probe-first
  capture (offline → queue + "Saved for later"), network-failure fallback to
  queue, "N receipts waiting" banner, queued-entry load via `queuedScanId`
  param + queue removal on save; `sendReceiptScansReadyNotification` (same
  scan-processing channel/type family as tags, `receipt_scans_ready` tap →
  PendingReceiptScan); drains wired into bootService, App.js foreground +
  60s poll + notificationService background-fetch task; i18n EN+FR keys.
- **Status:** done — receiptScanQueue/pendingReceiptScanScreen/scanScreen
  offline/notificationTapRouting/bootService/i18nCompleteness suites green.
  Commit/PR pending.

### 2026-07-19 — Receipt parser: strip register markers (start-of-basket class) from product names
- **Asked (/goal):** the "start of basket"-class keywords sometimes still end up
  in product names; adjust the parser to remove any irrelevant words from
  product names, based on the Costco receipt fixtures + anything else that can
  print on a Costco receipt.
- **Found:** goldens showed `SELF - CHECKOUT HANNAS WW 10` (×3 receipts),
  `AGE VERIFIED DEPOSIT VL`, `SMOKED SALM .` — the register's lane marker /
  age-check stamp print as bare lines directly above an item row and the
  wrapped-name carry glued them on (same class as Bugs #67 PRE-SCANNED weld).
- **Changes:** shared/ocrCleanup.js BANNER_NOISE_RES + BANNER_WORD_RE gained
  the register/cart-marker vocabulary (self-checkout EN/FR, age-verified EN/FR
  incl. accented-`ÂGE` alternation, Bottom-of-Basket / BAS DU PANIER / BOB
  Count inline with SKU-safe count eating incl. the O-for-0 misread);
  scrubItemNameNoise also trims a trailing orphan punctuation token;
  extractItems scrubs the name-head carry + append-to-prev fragment so markers
  never enter names even uncleaned. Goldens re-pinned (6 diffs, all reviewed
  improvements: 4 marker prefixes gone, 2 trailing-punct trims, rawTextDigest
  shrink where marker lines left persisted OCR). Bugs_Common_Fixes #123.
- **Files:** shared/ocrCleanup.js (+ backend/shared sync),
  src/services/receiptParsingShared.js; tests ocrCleanup (+6 marker cases),
  receiptParsingShared (+3 engine-guard cases), costcoReceiptParser.realocr
  (FORBIDDEN + 3 new fixture pins + sku-null name lookup), receiptGolden
  re-pinned.
- **Status:** done — ocrCleanup/receiptParsingShared/realocr/golden suites
  green (810 tests). Commit/PR pending.

### 2026-07-19 — Claim/price-drop UX: hide eligibility, in-app receipt (preferred), auto-stop watch on expiry
- **Asked (/goal):** (1) hide the Eligibility section on claims for now; (2) the
  Costco receipt is saved in the app and should be retrievable through the app
  with a note that the in-app receipt is PREFERRED; (3) the "Stop watching"
  button must be disabled after expiry and the app must auto-stop watching
  (mandatory, not optional); (4) surface the saved receipt on the price-drop
  page for easy access; (5) add the in-app receipt as the FIRST "How to claim at
  Costco" step.
- **Changes:**
  - **Eligibility hidden:** DetailScreen `SHOW_ELIGIBILITY = false` gate (card
    kept in code, gated off).
  - **Auto-stop on expiry:** `storageService.updateExpiredReceipts` now also
    clears `watchEnabled`/`priceDrop` on every still-watched, unclaimed item of
    an expiring receipt (new `_stopWatchesOnExpiry` helper) and mirrors each
    watch-off to the backend durably (`setItemWatchOnBackendDurably` + queue) so
    a closed window can never keep getting drop pushes/commission. Wired into the
    boot pipeline (`bootService`, defensive `?.()` call) so it runs on the
    freshly-hydrated receipts, not just on the Receipts screen focus.
  - **Stop-watching disabled after expiry:** DetailScreen `const expired =
    days <= 0`; both Stop-watching buttons (receipt-level + per-item) are
    `disabled={expired}`, greyed (`secondaryBtnDisabled`), and relabel to
    "Watching stopped" (`detail.watchStopped`, EN+FR).
  - **In-app receipt = preferred:** receipt archive card in DetailScreen gains a
    preferred note (`detail.receiptPreferred`); ClaimAssistantScreen gains a
    saved-receipt card (preferred note + "View saved receipt" toggle + inline
    image) so the receipt is one tap from the claim flow; the in-store checklist
    first item now reads "Show your receipt in the PriceBack app (preferred)…";
    Costco `claimSteps[0]` rewritten to lead with the in-app receipt.
- **Files:** mobile DetailScreen.js, ClaimAssistantScreen.js, storageService.js,
  bootService.js, constants/stores.js (Costco claimSteps), i18n.js (+5 keys
  EN+FR: detail.receiptPreferred, detail.watchStopped, claim.viewReceipt,
  claim.receiptPreferred, revised claim.checklistReceipt); tests
  storageServiceReceipts (+2 auto-stop cases), bootService (+drain assert).
- **Status:** done — storageServiceReceipts 5/5, bootService 1/1,
  detailScreen/claimAssistant/i18nCompleteness/screens suites green. No backend
  change, no migration. Commit/PR pending.

### 2026-07-19 — Costco membership tier (Gold Star / Executive) + Executive-only offer drops
- **Asked:** add the shopper's Costco membership type (Gold Star, Executive) to
  the Profile page so Executive-exclusive offers (Costco occasionally runs
  offers only Executive members can buy) also trigger price drops for Executive
  members; expose it as a toggle in the flyer upload; integrate it into every
  price-drop-management path.
- **Design:** membership is a per-user attribute distinct from the app's own
  subscription. An Executive-only FLYER offer carries `flags.executiveOnly` on
  its `price_points` row; a price group counts as Executive-gated only when
  EVERY row at that price is exclusive (`BOOL_AND`) — a single non-exclusive
  sighting (e.g. a regular-member tag scan at the same price) un-gates it for
  everyone. Gating happens in the drop query by the buyer's authoritative
  `users.costco_membership_type` (the money/notification path never trusts a
  client value); the public in-app price lookup takes a spoof-safe display hint.
- **Backend:** `users.costco_membership_type` text col (gold_star|executive,
  default gold_star), migration `0007_broken_sister_grimm` (applied to DEV
  Supabase; **PROD owes 0007**), consolidated schema regenerated;
  `usersRepo.updateProfile` whitelists it; `PUT /api/me/profile` +
  `GET /api/me` carry it (DB + JSON-fallback paths). `flyerPricing.normalizeOffer`
  carries `flags.executiveOnly`; `commitFlyerImport` persists `{executiveOnly:true}`
  to `price_points.flags`. `priceDropRepo.findNotifiable` — per-row `executive_only`,
  `BOOL_AND` per group, candidates filtered by `u.costco_membership_type`
  (a Gold Star buyer falls through to their best non-exclusive verified price,
  so an unclaimable deal never pushes or bills them). `getLatestVerifiedPrice`
  gains a `membershipType` param that hides exclusive groups from non-Executive /
  anonymous callers; `/api/check-price` threads the client hint.
- **Mobile:** SETTINGS default `costcoMembershipType`; Profile → Preferences
  "Costco membership" row + picker modal; durable `profileSyncQueue` carries
  the tier (enqueue-before-attempt, coalesce, confirm-to-clear,
  `hasPendingCostcoMembership()`); `syncService` hydrate folds server→local with
  the same pending/last-flush guard as notif prefs (offline change never
  reverted); `AdminFlyerScanScreen` batch-level "Executive members only" Switch
  merges `flags.executiveOnly` onto committed items; `priceService.checkPrice`
  sends the membership hint. i18n EN+FR for all new keys.
- **Files/areas:** backend db/schema.js (+migration 0007 + consolidated schema),
  repos/{usersRepo,priceDropRepo}.js, flyerPricing.js, server.js (profile
  routes + commitFlyerImport + check-price); mobile storageService,
  profileSyncQueue, syncService, priceService, StoresAndProfileScreens,
  AdminFlyerScanScreen, i18n; tests backend flyerPricing (+1),
  priceDropExecutiveDb (new, 6), routes (+1), mobile profileSyncQueue (+3),
  syncServiceHydrate (+2), adminFlyerScanScreen.smoke (+1).
- **Status:** done — new priceDropExecutiveDb 6/6 + affected backend suites 63/63
  + routes 58/58 green on DEV Supabase; mobile profileSyncQueue/syncServiceHydrate/
  adminFlyer/i18nCompleteness green. Branch `feat/costco-executive-membership`;
  commit/PR pending. **PROD owes migration 0007** before next prod deploy.

### 2026-07-19 — Three reported bugs: claim-window reminder, Home text overlap, offline tag-scan notification
- **Asked:** fix three bugs — (1) active claims can still be redeemed after the
  30-day window; add a new reminder/category to remind the user; (2) Home
  tracked-item text is partly hidden by the Claim button when a % drop chip is
  present; (3) the offline-mode "price tags ready to review" notification never
  arrived, and the offline reviewer should have the admin's tap-to-zoom.
  (Clarified mid-task: the "ready to review" notification is for USERS scanning
  offline, not the admin.)
- **Fixes:**
  - **Bug #120 (Home overlap):** the tracked-item `chipRow` had no `flexWrap`
    and the warehouse label no truncation → the extra `−%` chip pushed chips/
    label under the right-hand Claim column (RN doesn't clip child overflow).
    Fix: `chipRow` flexWrap:wrap, label numberOfLines+flexShrink, right column
    flexShrink:0. HomeScreen only.
  - **Bug #121 (offline tag notification):** worker only triggered on cold
    boot / background→active / daily BG-fetch, so a user who stayed
    foregrounded when signal returned never OCR'd → no notification; a blind
    offline trigger also burned the OCR attempt budget (could strand as
    `error`); and the "ready" alert scheduled against an Android channel that
    only `registerForPushNotifications` created (bails early in several cases).
    Fix: `_process` probes /health first & skips offline (no attempt burn);
    App.js 60s foreground poll drains on return-to-connectivity; extracted
    idempotent `ensureAndroidChannels()` called before scheduling. NOTE: the
    offline reviewer (PendingTagScanScreen) ALREADY has the admin's
    `ZoomableImage` tap-to-zoom (shipped 2026-07-15) — verified present, no
    change needed for that half.
  - **Bug #122 (claim reminder):** only 3-day + 1-day reminders existed → long
    silent gap after early detection. Added `scheduleEarlyClaimReminder`
    (`EXPIRY_EARLY_WARNING_DAYS`, default 7, DB-tunable end-to-end mirroring
    `EXPIRY_WARNING_DAYS`), own identifier `expiry-early-<id>`, distinct copy,
    same category+detected-drop gates, self-skips on collision/late detection;
    wired into cancel/sync/reconcile. (Did NOT change the DetailScreen
    redeem-after-expiry behavior — a user may legitimately mark claimed after
    redeeming in-store on the last day; the ask was a reminder.)
- **Files:** mobile HomeScreen.js, notificationService.js (new fn +
  ensureAndroidChannels refactor), tagScanQueue.js (reachability gate), App.js
  (foreground poll), pricingCatalogService.js; backend shared/pricing.config.js,
  config/configService.js, db/seed.js (EXPIRY_EARLY_WARNING_DAYS); tests
  notificationService (+5), tagScanQueue (+1 offline-skip), pricingCatalogService
  (+1 key); docs Bugs #120/#121/#122.
- **Status:** done — mobile full suite 2816/2816, 55 goldens intact, coverage
  72.9/60.43/59.97/75.37 ≥ floors. Backend config tests green (18/18); change is
  additive config plumbing mirroring EXPIRY_WARNING_DAYS. No migration (app_config
  seed data only). Commit/PR pending.

### 2026-07-19 — Audit round 5: full-feature durability sweep (every remaining client→server mutation)
- **Asked:** run full audit round 5 over all functions and features, prioritizing
  perimeters NOT covered in rounds 1–4, fix findings. North star: any action done
  in the app is never lost even offline and always reaches the server.
- **AUDITED CLEAN (don't re-fix):** cloud prefs (LWW clock + re-push each
  hydrate); push token (re-pushed every hydrate/sign-in); watch-ON and -off +
  claims (round-4 edits queue covers both directions); registerForPriceWatch
  (full re-registration every foreground — idempotent); device scan counts
  (max-merge full-state sync every app open); receipt/delete/item queues; offline
  tag queue + PendingTagScan (dequeue only on full success); email-sync
  receipts (standard saveReceipt durable pipeline); onboarding profile+
  consents push (blocks on failure); referral redeem (blocks); account
  deletion (blocks w/ friendly error); admin screens (interactive alerts);
  postal/province (no post-onboarding edit UI → no loss surface).
- **Findings + fixes:**
  - **Bug #117:** notification-pref toggles were ONE fire-and-forget push +
    unconditional server-wins hydrate fold → an offline toggle was lost AND
    reverted; server kept pushing disabled categories. Fix: durable profile
    outbox `profile_sync_pending_v1` (src/services/profileSyncQueue.js) —
    enqueue-before-attempt, current-state coalescing, confirm-only clear,
    drains on boot/foreground/hydrate; hydrate fold yields while pending or
    when a flush landed mid-hydrate (`lastSuccessfulFlushAt() >= fetchedAt`).
  - **Bug #118:** marketing_push consent rode the same lossy channel while
    the Profile focus re-read overwrote local from the server ledger → a
    CASL withdrawal could silently never land + UI snapped back. Fix: consent
    events ride the outbox (per-type coalescing), focus re-read skips while
    pending; Onboarding's returning-user T&C re-affirm queued too.
  - **Bug #119:** Reset All Data ignored the server reset result and wiped
    locally anyway → transient failure = old credits/receipts resurrected at
    next hydrate. Fix: wipe gated on `canProceedWithLocalReset` (ok /
    auth_required / backend_unconfigured proceed; transient blocks with new
    profile.resetFailed* alert EN+FR) — same contract as account deletion.
  - **Residuals (documented, not fixed):** `disabledStoreSubscriptions`
    backend mirror is a NO-OP (user_disabled_stores table removed) — list is
    local-only, comment corrected in storageService; live tag-submit failure
    is interactive-retry (visible refusal; offline capture path already
    queues); analytics/telemetry stays fire-and-forget by design.
- **Files/areas:** mobile profileSyncQueue.js (new), NotificationsScreen,
  StoresAndProfileScreens (consent guard + reset gate), OnboardingScreen,
  syncService (fold guard + drain), bootService, App.js, authService
  (canProceedWithLocalReset), i18n (+2 keys EN+FR), storageService (comment);
  tests profileSyncQueue (new), notificationsScreenDurableSync (new),
  syncServiceHydrate (+3), bootService (+1 drain), authServiceApi (+3),
  onboarding suites (queue mock); docs Bugs #117/#118/#119.
- **Status:** done — PR #181 merged (f778ed6), branch deleted. Full mobile
  suite 2810/2810, 55 goldens intact, coverage 72.87/60.4/60.05/75.32 ≥
  floors 57/44/48/60 + all per-file floors. No backend change, no migration.

### 2026-07-18 — Critical-path audit round 4: mobile↔server money contract (client-side durability)
- **Asked:** run a full audit on critical functions (credit, subscriptions,
  scanning, price drops + claiming) and fix findings (same /goal family as
  rounds 1–3, PRs #174/#176/#177). This round takes the one axis those never
  covered: the MOBILE side of the money contract — is every client-initiated
  money/state mutation durable, or can it be silently lost?
- **NOT re-audited:** everything in the audited-clean lists of rounds 1–3 +
  #161/#162/#169–#172 (all backend). Client paths verified CLEAN this round
  (don't re-fix): offline-scan spend buffer (durable log + idempotent flush,
  boot/balance-read drains); receipt sync (syncPending retry + tombstone
  queues for receipt/item deletes); reconcileWithServer (server-wins,
  device-claim + flag handling); canAddReceipt offline gate (bounded by
  last-known balance − buffered spends > safety floor); subscription purchase
  path (syncSubscriptionToBackend retried on every reconcile poll — durable
  enough); auto-reload (opt-in, OS dialog per purchase, one prompt per
  threshold crossing); ClaimAssistantScreen (guide-only, no state mutation).
- **Findings + fixes:**
  - **Bug #115 (money-critical):** a PAID credit-pack purchase could
    permanently fail to credit. After the store approved payment, the grant
    depended on ONE fire-and-forget confirm POST — and the "backup" RC webhook
    has never delivered an event on prod. A network blip/backend 5xx/app kill
    in that window = money taken, credits never granted, no retry, no record —
    and purchaseProduct still reported success ("credits are now on your
    account"). Fix: durable `pending_topup_confirms_v1` queue (enqueue BEFORE
    the first attempt; dequeue only on server confirm or terminal
    retryable:false), `flushPendingTopupConfirms()` on boot + foreground +
    every live balance read; confirm result now carries {status, retryable}
    honoring the server's body flag (402 RC-lag retries, 402 sandbox
    terminal); firstTopup auto-reload opt-in applies on late-landing confirms;
    UI shows "will be added automatically" (new i18n key EN+FR) when pending.
  - **Bug #116 (money + truthfulness):** claims and watch-stops were
    fire-and-forget POSTs with NO retry queue (receipts/deletes have them) —
    and the receipt POST body carries no claim fields, so a failed claim POST
    (the NORMAL offline-at-the-service-desk case) had no other road to the
    server. Server kept the line watched → repeat drop pushes + further drop
    commissions on an item the user already closed out; fresh devices
    rehydrated it unclaimed. Fix: durable `receipt_item_edits_pending` queue
    (fingerprinted, coalesced per item, claim supersedes watch-off), drained
    on boot/foreground/post-hydrate AFTER retryPendingReceiptSyncs (claim on a
    just-synced receipt lands same pass; 404 keeps the entry queued — receipt
    not on server yet); entries expire at 90d / when the local receipt is gone.
  - **Test-blind-spot fix:** bootService.test.js left tagScanQueue unmocked —
    its synchronous require throw aborted the boot task in Jest before the
    purchaseService flushes, so nothing after it was ever asserted. Now mocked
    + all boot drains asserted.
- **Files/areas:** mobile purchaseService.js (queue + durable confirm +
  flush), storageService.js (edits queue + durable claim/watch + drain),
  bootService.js, App.js, syncService.js (_kickReceiptPushThenEdits),
  BuyCreditsScreen.js, Paywall.js, i18n.js; tests pendingTopupConfirms (new),
  storageServiceItemEdits (new), bootService (+3 assertions),
  syncServiceHydrate (+2); docs Bugs #115/#116.
- **Status:** done — PR this session. No backend change, no migration.

### 2026-07-18 — Goal step 2: prod-health sweep by criticality (schema drift, cron stall, RC webhook)
- **Asked:** (second clause of the same /goal) after the round-3 audit, check
  other features by importance/criticality. Chose read-only PROD health checks
  + the one code gap they exposed.
- **Findings:**
  - **PROD DEPLOY BLOCKER (ops, not code):** full column diff prod-vs-dev shows
    exactly ONE drift: `users.subscription_started_at` missing on prod. Cause:
    the column lives in the squashed `0000_initial.sql`, whose hash is already
    recorded in prod's drizzle journal — but prod's tables predate the squash,
    and `CREATE TABLE IF NOT EXISTS` no-ops on existing tables. So `db:migrate`
    can NEVER add it. Next prod deploy of any backend built after 2026-07-11 →
    usersRepo ORM select fails → bootstrap 503 → the 2026-07-10 sign-in outage
    again. Manual fix owed (Maxim to approve):
    `ALTER TABLE priceback.users ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz;`
    Everything else matches (incl. purchase_type_id, topup_refs, all indexes —
    the "prod owes 0002-0006" memory is STALE: prod journal has all 7 entries;
    reconcileCredits failed 5 days on the missing table then went green
    2026-07-18, consistent with a ~07-17 prod migrate).
  - **Bug #114 (code, fixed):** priceSweep is the only interval-from-boot job
    (setInterval resets each restart) — prod shows 2 runs/7d, none since
    07-15, while wall-clock crons all fired. The cron-only legs
    (settleAllVerified tag-credit release, recomputeOverduePolicyStatuses)
    therefore stalled — earned tag credits not released. Fix: boot catch-up —
    `sweepCatchUpDue` pure helper + `jobRunsRepo.lastOkRun`, wired in
    startServer (3-min unref'd delay, fires one idempotent sweep only when
    the last OK run ≥ one interval old).
  - **RC webhook: still 0 events ever on prod** — the [[signin-block-and-subscription-sync]]
    OPS item (REVENUECAT_SECRET_KEY + webhook) remains undone.
  - Cron health otherwise green (digest/maintenance/retention daily ✓); prod
    flyer test-residue rows documented in the round-3 entry.
- **Files/areas:** backend sweepScheduler.js, repos/jobRunsRepo.js, server.js
  (startServer wiring); tests sweepScheduler (+catch-up unit),
  jobRunsRepoDb (new, DB-gated); docs Bugs #114.
- **Status:** done — PR #178 merged (7cbac20), branch deleted. Full backend c8
  run: 967 pass / 0 fail, coverage 92.6/78.47/93.25/92.6 ≥ floors 90/75/91/90.
  Ops items left with Maxim: (1) the prod `subscription_started_at` ALTER
  (deploy blocker), (2) RC webhook env on prod, (3) optional prod flyer
  test-residue cleanup.

### 2026-07-18 — Critical-path audit round 3: ingest-surface trust (flyer pipeline + external write surfaces)
- **Asked:** run a full critical path audit and fix any findings, then check
  other features by importance/criticality (same /goal re-issued after rounds
  1–2 merged as PRs #174/#176 — this round takes the last uncovered axis).
- **Decision/constraints:** scope = every EXTERNAL surface that writes into the
  shared price pool or credits, centred on the flyer pipeline (the PRIMARY
  price source, tier-1 authoritative + verification/age-exempt + ALL-province
  fan-out) which no prior pool-sanity audit had named. NOT re-audited:
  everything in the audited-clean lists of #174/#176/#171/#172/#169/#170/#161/#162.
- **AUDITED CLEAN (don't re-fix):** /api/flyer/import + /api/admin/barcode-links
  auth (constant-time token compare, pre-auth per-IP throttle, 2000-item cap);
  admin flag/verify/barcode routes (_adminTokenOk or requireAuth+adminSubs,
  id-scoped); barcode links checksum-validated in linkBarcodeToSku; tag
  observation path re-confirmed guarded upstream of recordPricePoint
  (0.5–5000 + outlier); receipt pool gate (isPoolableUnitPrice) intact;
  normalizeOffer itself is a sound gate (region, 4–8-digit sku, required ISO
  window, 0<promo<100000, cent rounding).
- **Findings + fixes:**
  - **Bug #113 (pool poisoning, most-privileged tier):** commitFlyerImport
    Phase 2 (DB persist) rebuilt rows from the RAW items array (filter: has
    sku + Number.isFinite(price)) — bypassing normalizeOffer, which only
    protects the in-memory overlay. An item the overlay REJECTED (negative
    promoPrice — isFinite(-5) is true —, garbage sku, missing validity window)
    still entered price_points as a `flyer`-source row: tier-1 authoritative,
    no rule-of-N needed, age-exempt, fanned to all 13 provinces, and
    commission-billing on the fake "drop". Regular-only items (no promo)
    were also silently persisted at regular price, and window-less items got
    a NULL valid_until (immortal tier-1 row). Fix: ingestFlyerBatch now
    returns its acceptedOffers (normalized); Phase 2 persists ONLY those
    (printed validFrom/validUntil guaranteed). Defense-in-depth: hard range
    guard in recordPricePoint (finite, >0, <100000 — normalizeOffer's own
    ceiling, looser than the tighter upstream tag/receipt gates).
- **Files/areas:** backend flyerPricing.js, server.js (commitFlyerImport),
  repos/pricesRepo.js; tests flyerPricing (+acceptedOffers), flyerAdminRoutes
  (+persist-only-validated capture), repoValidation (+range guard); docs
  Bugs #113.
- **Prod data note (read-only check):** prod price_points holds inert TEST
  RESIDUE flyer rows (skus pp-flyer-*/pp-created-*/br-exp-*, refs
  flyer-batch-1/2; 12 bad-sku, 9 NULL-valid_until) — likely from standing
  prod up off a dev copy. No real watchers → harmless; cleanup SQL handed to
  Maxim (delete flyer-source rows whose product sku fails ^\d{4,8}$ + their
  orphaned products). Real imported flyer rows are clean.
- **Status:** done — PR #177 (branch `fix/flyer-ingest-validation`). Full
  backend c8 run: exit 0, 92.55/78.44/93.22/92.55 ≥ floors 90/75/91/90.
  No schema change, no migration.

### 2026-07-17 — Critical-path audit round 2: value correctness (money math, garbage-in, date bounds)
- **Asked:** run a full critical path audit and fix any findings (same /goal
  re-issued after the atomicity round below merged as PR #174 — this round
  takes the remaining uncovered axis).
- **Decision/constraints:** scope = the same critical paths on the VALUE axis:
  is the money math right, can garbage/hostile values enter the pool or the
  ledger, are date windows bounded. NOT re-audited: everything in the
  audited-clean lists of #161/#162, #169/#170, #171, #172, #174, #165.
- **AUDITED CLEAN (don't re-fix):** shared pricing math guards
  (claimCreditCost/dropChargeCredits floor+finite checks); topup credits are
  server-catalog + RC-verified (never client-supplied); scan cost from ops
  config; claim/watch routes Number.isFinite-normalize client numerics; claim
  is status-only (claimedSavings is display-only); drop-charge driving a
  balance negative is INTENTIONAL (commission debt — notification is the
  billed event; scan-consume floor unaffected); tag-observation pool guarded
  (0.5<price<5000 + 30% outlier + dedupe); effectiveScanTier time-aware NaN=
  lapsed; quantity guards (NULLIF(qty,0), qty>0-else-1) throughout.
- **Findings + fixes:**
  - **Bug #111a (money):** verified-drop sweep resolved charge exemption via
    `getBySub(sub).catch(() => null)` and `isCreditExempt(null)`=false → a
    transient DB error while resolving an UNLIMITED subscriber billed them a
    commission, permanently (dedupe row blocks retry/refund). Fix: a THROWN
    lookup marks the buyer exemption-unknown and their drops sit the sweep out
    (stay pending, re-elect next sweep); a null row still means free tier.
  - **Bug #111b (money):** incremental drop commission rounded each delta
    independently (round(Δ×15) per event) → path-dependent lifetime totals
    that drift from the documented invariant. Fix: telescoping totals —
    charge = dropChargeCredits(paid−new) − dropChargeCredits(paid−prior) — so
    lifetime total is exactly dropChargeCredits(paid−lowest) on any path.
  - **Bug #112a (pool poisoning):** receipt price points had NO price sanity
    guard (tag scans have one) — a price-less line was minted as a $0.00
    price_point (`it.price == null ? 0`), a mixed receipt's lone negative
    return line entered the pool negative, absurd values passed. A verified
    $0 group ⇒ "Now $0.00" pushes + full-price commissions for every watcher.
    Fix: `isPoolableUnitPrice` (finite, ≥$0.01, <$5000 — floor is a cent, not
    the tag scan's $0.50, because unit = lineTotal÷qty is legitimately small)
    gates the bulk insert; rejected lines keep their product row/receipt item.
  - **Bug #112b (date bounds):** POST /api/receipts accepted any purchaseDate
    — future dates planted price observations that stay "fresh" forever in the
    verification pool (observed_at ahead of every cutoff) and unparseable
    dates 500ed mid-transaction. Fix: route validates YYYY-MM-DD, real
    calendar date, ≤ today+1d (timezone slack) → terminal 400; past dates
    still allowed (old receipts importable, their windows simply expired).
  - Accepted residuals (documented, not fixed): offline-scans batch size
    unbounded (client wipes its log on HTTP 200, so a server cap would
    silently drop spends — in the house's favor but contract-breaking;
    bounded anyway by the JSON body limit + credit rate limiter); tag pool's
    $0.50 floor unchanged (pack prices, never divided).
- **Files/areas:** backend priceDropNotifier.js, repos/pricesRepo.js,
  server.js (receipt POST validation); tests priceDropChargeGuards (new,
  no-DB), priceDropCommission (+1 drift), receiptPricePoints (+2),
  docs Bugs #111/#112.
- **Status:** done — PR #176 (branch `fix/critical-path-value-audit`). Full
  backend c8 run green: 958 tests / 0 fail, floors met. No schema change, no
  migration.

### 2026-07-17 — Full critical-path audit: atomicity + races + partial-failure recovery
- **Asked:** run a full critical path audit and fix any findings.
- **Decision/constraints:** scope = the end-to-end critical paths (sign-in→
  bootstrap, scan→credit-consume→receipt-sync, tag-scan→grant, drop-detect→
  commission→claim, purchase→topup) on the ONE axis prior audits didn't cover:
  atomicity, race conditions, partial-failure recovery (double-tap/concurrent
  requests, consume-then-fail refunds, state-transition races). NOT re-audited:
  everything in the audited-clean lists of #161/#162 (price-drop security),
  #169/#170 (scale), #171 (security/authz), #172 (lifecycle/i18n), #165
  (parsers), offline/sync idempotency, notification truthfulness, money config.
- **AUDITED CLEAN (don't re-fix):** advisory-lock design on same-ref dedupe
  (scan/topup/price-tag grant+revoke — all correctly serialized per ref);
  recordTopupOnce global ref lock + wipe-proof burn; RC webhook replay guards
  (event-id + ref); recordNotified single-election + same-tx incremental
  commission under per-item locks (deleted users can't poison the batch — FK
  guarantees the user row); claim route idempotent status-only; referral
  settle FOR UPDATE; credit-recon apply FOR UPDATE + delta-0; tag-settle
  once-per-pool election (weekly-cap over-grant race accepted: bounded to 1
  credit, idempotent refs); offline-scans upload idempotent per ref; grants
  are atomic increments everywhere.
- **Findings + fixes:**
  - **Bug #109 (money race):** consumeScanCreditOnce's balance floor was a
    stale read — the advisory lock keys (userSub, ref) so N concurrent scans
    with DIFFERENT refs all passed the check on the last credit → negative
    balance / over-spend (reconciliation can't see it: ledger+balance drift
    together). Fix: floor moved into the UPDATE's WHERE
    (`scan_credits >= N`), ledger row in the same tx; losers report
    `insufficient`.
  - **Bug #110 (IDOR + silent data loss):** receiptsRepo.create's id-conflict
    fallback returned the existing receipt with NO ownership check — POSTing
    another account's receipt id read their receipt back, and an honest
    collision silently swallowed the caller's receipt (client marks
    created:false as synced). Fix: cross-account conflict throws
    RECEIPT_ID_CONFLICT → route maps 409 {receipt_id_conflict,
    retryable:false} (terminal 4xx keeps the receipt local); same-user retry
    contract unchanged; no charge on refusal.
  - **Test-suite fix:** dbRoutes' topup-replay test used the fixed ref
    `evt-topup-fixed` without un-burning topup_refs (the #172 pattern) → red
    on every rerun since PR #172; now un-burns first.
  - Accepted residuals (documented, not fixed): receipt-POST scan-consume
    failure stays non-fatal (deliberate availability>billing trade, comment
    documents it); tag-settle weekly-cap race (above); no client re-id on 409
    (honest collisions ~impossible with `r_<ms>_<rand>` ids).
- **Files/areas:** backend repos/{creditsRepo,receiptsRepo}.js, server.js
  (409 mapping); tests criticalPathAtomicity (new, 4 tests incl. true
  concurrent-spend race + HTTP 409), dbRoutes (un-burn); docs Bugs #109/#110.
- **Status:** done — PR #174 merged (7c63955), branch deleted. Backend full c8
  run 951 tests / 0 fail, floors met. No schema change, no migration.

### 2026-07-17 — Audit loop: account/data lifecycle + i18n parity (excl. last 2 audits)
- **Asked:** run an audit — excluding the last 2 audits already done and merged
  (full-app security pass PR #171, scale audit PRs #169/#170) — and fix findings.
- **Decision/constraints:** scope = the unaudited account/data-lifecycle axis
  (account deletion, /api/me/reset, data export, consents, referral redeem,
  notification prefs, retention/orphans) + first recorded EN/FR i18n parity
  sweep ([[no-unimplemented-labels]] hard rule). NOT re-audited: everything in
  the #161/#162, #169/#170, #171 audited-sound lists, receipt parsers (#165),
  offline/sync, notification truthfulness, money flows.
- **AUDITED CLEAN (don't re-fix):** data-export upsert-first ordering + IDOR
  scoping (PR #31 fix intact, DSAR dump complete incl. prefs/notif-settings/
  referees/consents/receipts-with-memberId); account deletion soft-delete
  tombstone design (trial can't re-farm, 30d reactivation, monthly purge cron
  wired 28-31 @ 04:00 + last-day guard); referral redeem rejection ladder
  (self/deleted/dup/setup-complete/unknown, edge-unique idempotency, deferred
  payout, FOR UPDATE settle race); tag photos already time-boxed 30d
  (pruneTagPhotos — the PIA open item from [[pia-r2-tagscan-retention]] is in
  fact resolved); EN/FR key parity was already perfect (1171 = 1171).
- **Findings + fixes:**
  - **Bug #107 (critical, money):** reset/delete-account physically wipe
    credit_ledger, which WAS the topup replay dedupe + referral-settle guard →
    one store purchase could re-mint credits after every reset (RC verification
    passes forever). Fix: new `topup_refs` table (unique ref, user_sub SET NULL
    on purge — ref stays burned; also drives firstTopup so auto-reload opt-in
    can't re-fire) + `user_referrals.settled_at` authoritative settle stamp;
    migration `0006_bitter_roxanne_simpson` w/ backfill, applied to DEV
    (**PROD owes 0006**, joins 0002-0005). Stale "ledger kept forever /
    survives reset" comments corrected (they documented the dead invariant).
  - **Bug #108 (privacy):** receipt photos in R2 (`receipts/{sub}/{id}.jpg`)
    were NEVER deleted by any path — "full erasure" left them forever. Fix:
    daily `pruneReceiptImages` job (soft-deleted receipts, 7d window,
    `RETENTION_DELETED_RECEIPT_IMAGES_DAYS`, wired into runDbRetentionJobs).
  - **i18n:** 3 `t()` keys used but unimplemented (common.ok,
    profile.inviteFriendsLabel/…FriendAnon — EN-only `||` crutches) → keys
    added EN+FR, crutches removed, and NEW `__tests__/i18nCompleteness.test.js`
    statically enforces EN/FR parity + every t("literal") resolves, forever.
  - Accepted residuals (documented, not fixed): scan-consume/price-tag-grant
    dedupe is still ledger-based (post-reset replay ≤ 1 credit, client wipes
    local state on reset); the remaining ~50 `t(x) || "…"` crutches where the
    key EXISTS (inert now the completeness test gates missing keys).
- **Files/areas:** backend schema.js + migration 0006 (+ consolidated
  schema.sql regenerated), repos/{creditsRepo,referralsRepo,receiptsRepo}.js,
  jobs/pruneReceiptImages.js, config/defaults.js, server.js; mobile i18n.js,
  PriceTagScanScreen.js, InviteFriendScreen.js; tests
  lifecycleDedupeDb (new), pruneReceiptImages (new), i18nCompleteness (new),
  usersRepoDb + offlineScanCredits (fixed-ref unburn for reruns); docs Bugs
  #107/#108.
- **Status:** done — PR #172 merged (e2b8395), branch deleted. Full backend c8
  run green with floors; mobile 2772/2772, 55 goldens intact, coverage
  72.09/59.81/59.23/74.61 ≥ floors. Migration 0006 applied to DEV; **PROD owes
  0006** (joins 0002-0005).

### 2026-07-16 — Security audit: full app pass + fix findings
- **Asked:** run a security audit and fix any findings.
- **Decision/constraints:** prior passes NOT re-audited (price-drop security
  PRs #161/#162, scale PRs #169/#170, 2026-06-02 pre-launch pass, email-token
  SecureStore). Focus = routes/surfaces, cross-cutting checks (secrets, deps,
  per-route authz, injection, admin gating), deferred-list re-eval. AUDITED
  CLEAN (don't re-fix): no committed secrets (only `.env.example` tracked, no
  hardcoded keys in source); analytics `todayLogPath` is date-derived (no path
  traversal); receipt + tag-review object keys are ownership-scoped (existing
  IDOR tests hold); all `/api/admin/*` routes gated (either `requireAuth` +
  `getAdminSubs()` or constant-time `x-admin-token`); rate-limited unauth
  routes (`/api/check-price`, `/api/ocr*`, `/api/analytics`, `/api/flyer/*`).
- **Findings + fixes (Bug #106):** (1) `POST /api/check-all` fired the
  province-wide sweeps + drop pushes with NO auth/throttle → admin-token gated
  (`_adminTokenOk`); mobile never calls it (users use authed
  `/api/me/check-drops`). (2) `DELETE /api/me/observations` wiped a device's
  crowdsourced observations with no ownership check (IDOR) → now enforces
  `callerOwnsDevice` when a token is present (403 on mismatch), anonymous
  trust-on-first-use preserved. Dependency advisories re-triaged: none
  runtime-exploitable (backend highs = drizzle static-identifier SQLi / undici
  SOCKS5 / form-data GCS-internal — unreachable; mobile crit/high are
  dev-tooling only), `npm audit fix` non-`--force` fixes nothing → not
  auto-bumped; documented in `SecurityRecommendations.md` §6.
- **Files/areas:** `backend/server.js`; tests `missingRoutes` (+1),
  `securityDb` (+1, verified live vs dev Supabase: 403 non-owner / 200 owner);
  docs `SecurityRecommendations.md` §6, `Bugs_Common_Fixes.md` #106.
- **Status:** done — branch `security/audit-unauth-side-effects`; missingRoutes
  14/14 + security/routes/fallback 67/67 (no-DB) + securityDb 4/4 (dev Supabase)
  green. PR this session.

### 2026-07-16 — Scale audit round 2: close the sweep's unbounded-scan watch-item
- **Asked:** (same /goal re-issued after /clear — continuation of the scale
  audit below) audit scanning + membership for high-load holes and optimize;
  target = long-term stability under high user load.
- **Decision/constraints:** round 1 (PR #169, below) left ONE explicit
  watch-item: `findNotifiable` scanning a province's whole price_points
  history every ~4s debounced sweep tick. This round closed it (+1 sibling
  found in the same path) instead of waiting for DB CPU to climb. Everything
  in round 1's AUDITED-SOUND list was NOT re-audited.
- **Fixed (Bug #105):** (1) `findNotifiable` — new `watched` CTE prefilter
  (only products with a live watched line can notify; output-identical) backed
  by partial index `receipt_items_watch_live_idx`, migration
  `0005_smiling_kulan_gath` (applied to DEV, verified via pg_indexes; **PROD
  owes 0005**, joins 0002/0003/0004) + hard `PRICE_DROP_LOOKBACK_DAYS` scan
  floor (ops default 120d, clamped ≥ windowDays) that the verified/flyer/admin
  age-exemptions now respect — bounds the scan as history accumulates over
  years; (2) `settingsByToken(tokens)` scope — a drop-bearing sweep no longer
  loads the whole user base's notification settings, just the tokens it will
  push. Consolidated schema regenerated.
- **Files/areas:** `backend/repos/priceDropRepo.js`, `priceDropNotifier.js`,
  `repos/notificationSettingsRepo.js`, `db/schema.js`, `config/defaults.js`,
  migration 0005, tests `priceDropDb` (+2: lookback floor, windowDays clamp),
  `notificationSettingsRepoDb` (+1: token scope), docs Bugs #105.
- **Status:** done — PR #170 merged (3064ba2), branch deleted. Full backend
  c8 run green with floors (935 tests).

### 2026-07-16 — Scale/stability audit: scanning + membership under high load
- **Asked:** audit for holes in the main features (scanning, membership
  management) and optimize if needed; target = the app survives high user
  load long-term while staying stable and fully functional.
- **Decision/constraints:** prior audits covered parser correctness, money
  flows, price-drop security, notifications — this pass focused on the
  scalability/stability axis. AUDITED SOUND (don't re-fix): pg pool config
  (5 conns, session pooler, transient-error taxonomy), requireAuth (local JWT
  verify, no per-request network), audit middleware buffering, receipt create
  (single tx, bulk price points), advisory-lock idempotency design,
  in-memory map sweeps (all limiter/cache maps bounded or swept), budget
  persistence (debounced + kv_state), drop-sweep overlap-guard/debounce
  (DB-load note at very high scale: `findNotifiable` scans province
  price_points every ~4s under steady traffic — revisit if DB CPU climbs),
  bootstrap (parallel reads, clamped pagination). FOUR HOLES FIXED (Bugs
  #103/#104): (1) credit_ledger had NO index for the ref-based idempotency
  lookups — global topup dedupe seq-scanned the fastest-growing table inside
  an advisory-locked txn → migration 0004 `credit_ledger_ref_type_idx
  (ref, type_id)`, applied to DEV, **PROD owes 0004**; (2) /api/ocr +
  /api/ocr-llm lacked the per-IP rotation brake (PR #162 gave it only to
  obs-tag) — deviceId rotation could drain the monthly Vision budget = scan
  outage for everyone → per-IP 5× budgets on both; (3) /api/me/subscription/
  sync unthrottled outbound RC fetch → 10/min per account; (4) one forged
  x-device-id header FK-poisoned an entire audit-log bulk insert (~100 rows
  dropped) → staged FK-violation retry in auditRepo. All four verified live
  at the HTTP surface (/verify PASS — thresholds exact: 150/100/10 and FK
  fallback row landed). New backend verify skill:
  `backend/.claude/skills/verify/SKILL.md`.
- **Files/areas:** `backend/server.js`, `backend/repos/auditRepo.js`,
  `backend/db/schema.js` + migration `0004_strong_groot` (+ consolidated
  schema), tests `ocrRateLimit` (+6), `auditRepoFkFallback` (new),
  `subscriptionSync` (+1), `creditLedgerAccuracy` (+1), docs Bugs #103/#104.
- **Status:** done — PR #169 merged (a74c9fa), branch deleted. Full backend
  c8 run green with floors enforced (GitHub CI is dispatch-only since
  2026-07-11 — Actions minutes exhausted — so local full runs are the gate).
  PROD owes migration 0004 (joins 0002/0003 per earlier entries).

### 2026-07-15 — App-audit loop: offline/sync layer + email-token storage
- **Asked:** (continuation of the audit loop after the receipt-parser audit,
  PR #165 merged as f634461) keep auditing the app's main parts by priority.
- **Decision/constraints:** offline/sync layer audited SOUND on the money/
  duplication axes — verified concretely: tag observation POST retries are
  idempotent server-side (crowdRepo dedupe on device+date+price, review row
  gated on `accepted`, credit ledger keyed on the stable observationRef,
  rule-6 rescan counter), receipt sync idempotent on the client-generated id,
  tag-queue photos deleted on submit. Low-sev note, NOT fixed: no orphan
  sweep for `documentDirectory/tags/` files whose queue entry vanished.
  ONE hole found + fixed (Bug #102): email OAuth tokens (incl. the Outlook
  REFRESH token) lived in plaintext AsyncStorage → moved to SecureStore with
  a one-time migration that deletes the plaintext copy; matches authService's
  pattern. Legacy-seeded tests keep working via the migration.
- **Files/areas:** `src/services/emailSyncService.js`;
  `__tests__/emailTokenSecureStore.test.js` (new) + secure-store mocks in the
  4 existing email suites.
- **Status:** done — branch `fix/email-token-securestore`, all 5 email suites
  38/38 green; PR this session.

### 2026-07-15 — UI fixes: resizing, missing tag images, offline-review zoom
- **Asked:** fix screens with resizing issues (example: the "credit running
  low / buy credit" flow); price-tag images that go missing at random; and add
  the admin-style pinch-to-zoom to the offline price-tag review screen (which
  only had a plain thumbnail).
- **Decision/constraints:**
  - Offline zoom (H3): `PendingTagScanScreen` used a plain `<Image>` thumbnail
    while `AdminTagReviewScreen` uses the shared `ZoomableImage`. Swapped it to
    `ZoomableImage` so the same pinch/double-tap viewer works on local file URIs.
  - Missing tag images (H2): TWO causes. (1) admin GET presigned URL TTL was
    only 10 min → images vanished mid-review; bumped `DEFAULT_GET_TTL` to 60 min
    (r2.js + gcs.js). (2) `uploadTagReviewImage` PUT + `image-uploaded` confirm
    were single-shot fire-and-forget → a network blip orphaned the R2 object,
    permanently unlinked; added bounded retries to both the PUT and the confirm.
  - Resizing (H1): the real symptom was the X close / ‹ back button being
    UNREACHABLE on modal screens (under the status bar). Root cause:
    `<SafeAreaProvider>` mounted without `initialMetrics` → top inset 0 on the
    first frame of freshly-mounted modal screens (worsened by SDK 55 edge-to-
    edge). Fix: `initialMetrics={initialWindowMetrics}` in App.js — app-wide.
    NOTE: could not run on-device here (no emulator/adb); Maxim to verify on a
    build. Bugs #100/#101 documented.
- **Files/areas:** `App.js`, `src/screens/PendingTagScanScreen.js`,
  `src/services/{priceService,i18n}.js`, `backend/storage/{r2,gcs}.js`,
  `__tests__/priceServiceNetwork.test.js`, `docs/Bugs_Common_Fixes.md`.
- **Status:** done (pending Maxim's on-device confirmation of the X-reachability
  fix). Mobile suites green: priceServiceNetwork 35/35, pending/buy/billing/
  admin/components smoke all pass. Committed via PR on branch
  `fix/ui-tag-image-reliability` (docs for Bugs #100/#101 landed a PR early,
  with #166).

### 2026-07-13 — Receipt-parser audit: holes per receipt type + fixes
- **Asked:** audit and find any holes in the receipt parsers for any receipt
  type (purchase, refund, …), find optimal solutions, autofix if possible;
  then continue auditing the whole app by logic priority while budget allows.
- **Decision/constraints:** audit verified EN refund/gas/TPD/VOID/printed-total
  machinery SOLID (don't re-fix). Confirmed holes → fixes on branch
  `fix/receipt-parser-type-audit`: H1 `detectRefund` bare-REFUND keyword fired
  before the positive-total guard (footer "refund" negated a purchase); H2
  French refunds undetected (`REMISE D'ACHAT` header, `ARTICLES VENDUS = -N`,
  `REMBOURSEMENT`) → positive price_points at refund prices; H3 refunds exempt
  from confidence/second-pass (refund-aware confidence, refund→refund retry
  only); H4 gas gate EN-only (FR pump tokens added); H5 membership-fee lines
  became watchable products (IGNORED_KEYWORDS); H6 purchaseType now persisted
  (`receipts.purchase_type`, next migration, PROD owes it); H7 dropped bare
  negative return lines now accounted (`returnsSum`) so mixed receipts can
  reconcile. H8 (online fixtures) needs real costco.ca captures — Maxim.
  Goldens byte-identical except deliberate refund-confidence re-pin (WS2).
- **Files/areas:** `src/services/{receiptParsingShared,costcoReceiptParser,
  receiptParser,receiptSyncService}.js`, `backend/db/schema.js` + migration
  `0003_flat_kabuki` (+ seed, consolidated schema), `backend/server.js`,
  `backend/repos/receiptsRepo.js`, tests both runners, Bugs #94–#99.
- **Status:** done — mobile 2761/2761 (55 goldens), coverage
  72.21/59.83/59.44/74.78 ≥ floors 57/44/48/60; backend serial run green
  (the 4 `npm test` concurrency-4 failures are the known environmental 503
  flake — same files pass 21/21 serially). Migration 0003 applied to DEV.
  PR this session.

### 2026-07-12 — Credit-ledger reconciliation cron + admin-validated corrections
- **Asked:** a recurring (daily/weekly) system that retraces each user's full
  credit history — purchases, price-tag credits, scan consumption, every input
  and output path — verifies the stored balance matches, and when a mismatch is
  found (e.g. a manual edit done by error) updates the final column to match
  the entire history. Corrections must be validated by an admin in the app,
  like the price-tag verifications.
- **Decision/constraints:** the ledger IS the history (every path already
  writes credit_ledger; resets delete the ledger outright), so the invariant is
  `users.scan_credits == sum(credit_ledger.delta)` for every user with no
  legitimate drift. New `credit_reconciliations` table (one pending row per
  user, partial-unique) holds detected drift + per-type breakdown snapshot;
  daily cron `reconcileCredits` (03:50 UTC, trackJob→job_runs) does a set-based
  sweep, upserts pending rows, self-heals ones whose drift vanished. NOTHING is
  auto-fixed: admin endpoints (ADMIN_USER_SUBS, same gating as tag reviews)
  list/apply/dismiss; apply re-checks drift inside the txn, sets balance :=
  ledger sum, and writes a delta-0 `reconcile_adjust` audit ledger row (sum
  unchanged, invariant restored). New mobile AdminCreditReconScreen
  (Profile → Admin) mirrors AdminTagReviewScreen.
- **Files/areas:** backend `db/schema.js` (+migration 0002_credit_reconciliations),
  `db/seed.js` (reconcile_adjust type), `repos/creditReconRepo.js`,
  `jobs/reconcileCredits.js`, `server.js` (cron + 4 admin routes);
  mobile `src/screens/AdminCreditReconScreen.js`, `App.js`,
  `StoresAndProfileScreens.js`; tests backend `creditReconDb` +
  `creditReconGuards`, mobile `adminCreditReconScreen.smoke`.
- **Status:** DONE — PR #164 (branch `feat/credit-reconciliation-cron`).
  Backend c8 full run green (creditReconRepo 100% stmts/funcs), mobile
  2732/2732 + 55 goldens intact. Migration 0002 applied to DEV; **PROD owes
  migration 0002** before the next prod deploy.

### 2026-07-12 — Notification truthfulness sweep: every alert must reflect a real event
- **Asked:** "Price adjustment window closing soon, check for price drops now"
  arrived with NO price drop — trust-killer. Sweep ALL notifications; a
  drop-themed notification may only fire when there actually is a drop.
- **Decision/constraints:** full inventory of every mobile local + backend push
  trigger. Verified-correct and untouched: DB verified-drop path
  (`priceDropNotifier`, PRs #161/#162), transactional pushes, daily digest,
  drop-charge push, tag-scans-ready, snooze/test. Fixed (Bugs #92/#93):
  (1) mobile expiry/last-day reminders were armed blind at SCAN time → now
  armed only at drop-detection time via `receiptClaimableDropSavings` gate +
  `syncExpiryRemindersForReceipt` (BG task, DetailScreen refresh, claim/unwatch
  hooks), copy now names the claimable $; (2) mobile BG task re-alerted the
  same drop daily → new-or-deeper gate; (3) backend `runFlyerSweep` had no
  window check + no dedupe, `_runScheduledChecks` compared unit price to line
  total + no dedupe → shared `isWithinAdjustmentWindow` + persisted
  `sweepNotifyLedger` (deeper drop still re-notifies).
- **Status:** DONE — branch `fix/notification-truthfulness`; proof tests in
  `sweepNotifyTruthfulness.test.js` (backend) + updated
  `notificationService`/`Reconcile`/`detailScreenDropNotify` suites + new
  `storageServiceClaimNotifSync.test.js` (mobile).

### 2026-07-12 — Audit PR #161's security decisions; close residual holes
- **Asked:** audit PR #161 (merged) and make sure every decision/action taken is
  the best, or optimize it, to solve ALL security holes.
- **Verdict:** H1/H2/M1 designs are sound (fail-closed topup, owner-counted
  rule-of-N with anon collapse, consistent across all 4 consensus queries,
  token-gated webhook untouched). Five residual holes found in the PR's own
  surface and CLOSED on branch `fix/price-drop-audit-residual-holes`
  (Bugs #90/#91): (1) cross-account replay — `recordTopupOnce` deduped per
  user, so one RC-transferred store transaction credited every account it
  visited → dedupe+lock now global on the ref; (2) sandbox parity — webhook
  refuses `environment=SANDBOX` but the topup REST check ignored `is_sandbox`
  ($0 license-tester purchase minted real credits; same gap in
  `/subscription/sync` tier mapping) → both refuse positive sandbox,
  `RC_ALLOW_SANDBOX=1` opts dev back in; (3) `CREDIT_RATE_LIMITS` never
  enrolled in `sweepInMemoryState` → slow OOM via unauthenticated key-minting;
  (4) obs-tag budget keyed on client-chosen deviceId → rotation bypassed M1
  entirely → secondary per-IP budget (5× cap, RIGHTMOST XFF hop — the only
  non-forgeable one); (5) latent H2 trap — `'ref:'` contributor fallback made
  every NULL-`device_hash` row a distinct shopper → all unattributable rows
  collapse to `'anon'`. Accepted residuals documented in the roadmap: anon
  bucket counts as 1 (N−1 accounts + anon reaches N), anonymous ingest binding
  deferred (roadmap 🟢), drop-charge refund path + dead-token reaping + no-DB
  CI blind spot unchanged (roadmap 🟡).
- **Status:** DONE — proof tests in `creditTopupSecurity` (transfer replay,
  sandbox±flag), `subscriptionSync` (sandbox mapper ×3), `creditRateLimit`
  (sweep eviction, rotating-deviceId 429), `sybilVerificationDb` (NULL-hash
  collapse). PR to follow.

### 2026-07-12 — Price-drop mechanism: security hardening + regression test net
- **Asked:** make the whole price-drop mechanism 100% functional with no error
  margin and no future regression — detection, commission, notifications,
  claiming — via wise/smart tests on a new branch; surface + fix any security
  issues (top priority); note optimizations by priority with a `docs/` roadmap
  for what can ship later.
- **Decision/constraints:** branch `test/price-drop-hardening-and-coverage`. A
  3-agent audit (backend flow / mobile flow / security) drove it. **Security
  fixes (all landed, Maxim chose "fix everything now"):** H1 — `/api/me/credits/
  topup` verified against RevenueCat before crediting (`_rcFetchSubscriber` +
  `_rcFindNonSubscription`, fails closed 503/502/402; Bugs #88); H2 — rule-of-N
  now counts distinct device **owners** (unclaimed→single `anon` bucket) across
  `priceDropRepo.findNotifiable/getLatestVerifiedPrice/markNewlyVerified` +
  `tagCreditsRepo` HAVING; blocks self-farm + fake-drop credit-drain; signed-out
  ingest still pools data (Bugs #87); M1 — `checkCreditRateLimit` guard on 6
  credit routes (Bugs #89). **Tests:** new `sybilVerificationDb`,
  `creditTopupSecurity`, `creditRateLimit`, `claimRouteDb`, `dropSweepResilienceDb`
  (backend) + `notificationTapRouting`, `claimAssistantScreen` (mobile); 5 existing
  rule-of-N suites updated to model **claimed** devices (the fix's new invariant).
  **Roadmap:** `docs/Price_Drop_Roadmap.md` — go-live blockers (fixed) vs
  should-fix (drop-charge refund path, Expo dead-token reaping, the no-DB CI blind
  spot) vs future (auth-bound ingest, concurrent-election test).
- **Files/areas:** `backend/repos/{priceDropRepo,tagCreditsRepo}.js`,
  `backend/server.js` (topup verify + `checkCreditRateLimit`/`creditRateLimited` +
  exports); `backend/tests/*` (5 new + 5 updated + offlineScanCredits RC stub);
  `__tests__/{notificationTapRouting,claimAssistantScreen}.test.js`; docs
  `Bugs_Common_Fixes.md` #87–#89, `Price_Drop_Roadmap.md`.
- **Status:** in progress — all targeted suites green; mobile full suite
  2711/2711, 55 golden snapshots byte-identical, coverage 71.49/59.29/58.94/74.02
  ≥ floors. Backend full c8 run + commit/PR this session. No production behavior
  change beyond the 3 security fixes.

### 2026-07-11 — Friendly error copy everywhere; technical details logged for the team
- **Asked:** all error messages must be user-friendly, never technical; the
  details should be logged to the backend for the team instead.
- **Decision/constraints:** new `src/services/errorSupport.js` —
  `classifyError` (missing_file/rate_limited/timeout/network/server/unknown),
  `friendlyErrorBodyKey` → new `err.*Body` i18n keys (EN+FR),
  `reportHandledError`/`describeHandledError` ship raw message+stack+category
  to the team via `analyticsService.reportCrash` (backend analytics feed +
  Sentry, `handled:true`; analyticsService lazy-imported so screens gain no
  eager native dep). Swept every user-facing `Alert(… e.message …)`:
  ScanScreen, PriceTagScanScreen, EmailSyncScreen, OnboardingScreen (+ i18n'd
  sign-in title), ManageSubscriptionScreen (store errors via shared
  `purchaseErrorMessage`), DetailScreen (incl. price-check chip),
  StoresAndProfileScreens. Removed `{error}`-interpolating keys
  scanErrorBody/couldNotOpenDocument. ADMIN screens intentionally keep raw
  messages (they're the team). Standing policy documented as Bugs #86.
- **Files/areas:** `src/services/{errorSupport (new),i18n}.js`, 7 screens;
  tests `__tests__/errorSupport.test.js` (new), `scanSourceGone` (raw-message
  leak assertion), `priceTagSourceGone`; docs Bugs #86.
- **Status:** done — targeted suites 159/159; full-suite + commit/PR this
  session.

### 2026-07-11 — Fix prod scan failures: missing source files (ML Kit cache ENOENT + frozen cloud-photo pick)
- **Asked:** fix any and all scan problems, cover every path; prod screenshots
  showed (1) "Scan Error … FileNotFoundException ENOENT" on the ML Kit doc-scan
  cache file, (2) Google Photos "Preparing your selected media" frozen during a
  receipt-scan gallery import.
- **Decision/constraints:** root cause = URIs from third-party components (ML Kit
  scanner cache, cloud-backed photo picks) fed into OCR without existence checks
  or a copy out of their volatile cache; missing-file errors surfaced raw with
  misleading "better lighting" advice, and the tag batch path even QUEUED gone
  files for offline retry. Fix in the acquisition layer (`autoCrop.js`):
  `materializeCapturedImage` (retry-wait + copy to our own cache; scanner now
  returns `status:"missing"`), `checkSourceExists` probe (only a POSITIVE missing
  blocks — "unknown" proceeds as before), `isMissingSourceFileError` classifier →
  new `scan.sourceGone*` i18n copy (EN+FR). Guards on every path: receipt
  (capture/gallery/document/preloaded via processImage), price tag (runOcr +
  batch — skip, never queue), barcode gallery, admin flyer pages. Gallery
  "missing" falls through to the system picker. No credit is ever spent on these
  failures (they precede OCR).
- **Files/areas:** `src/services/autoCrop.js`, `src/screens/{ScanScreen,
  PriceTagScanScreen,BarcodeScanScreen,AdminFlyerScanScreen}.js`,
  `src/services/i18n.js`; tests `__tests__/{autoCrop,scanSourceGone,
  priceTagSourceGone}.test.js` (+ scanScreenCreditGate mock update); docs
  `Bugs_Common_Fixes.md` #85.
- **Status:** done — full mobile suite 2674/2674 green, 55/55 golden snapshots
  byte-identical (zero parse regression), coverage 71.14/58.66/58.6/73.68 ≥
  floors 57/44/48/60. Commit/PR this session.

### 2026-07-11 — Persist subscription START date ("member since")
- **Asked:** implement the persisted subscription start date (for a "member
  since" / renewal display), sourced from RevenueCat.
- **Decision/constraints:** new nullable `priceback.users.subscription_started_at`
  (migration 0003, applied to DEV Supabase; **PROD owes 0003**; consolidated
  `deploy/schema.sql` regenerated). Source = RevenueCat `original_purchase_date`
  (stable across renewals). Persistence is **EARLIEST-wins** in
  `usersRepo.setSubscriptionState` (a renewal or monthly→annual change never moves
  it forward; `undefined` leaves it, `null` clears it on a full lapse). Sync
  endpoint reads it from `subscriber.subscriptions[productId].original_purchase_date`
  (falls back to the earliest across subscriptions); webhook uses
  `event.purchased_at_ms` (earliest-wins keeps the original). Exposed via
  `publicSubscriptionView.subscriptionStartedAt` → bootstrap/`/api/me`/sync.
  Mobile: `_entitlementToPremium` captures `entitlement.originalPurchaseDate`,
  `setPremiumStatus` gains a 5th `startedAt` param (preserves an existing value
  when omitted), reconcile passes the server's start date; ManageSubscription
  shows a "Member since {date}" row (renewal date was already shown). New i18n
  `manage.memberSince` (EN+FR). No start-date needed for gating — this is
  display-only.
- **Files/areas:** `backend/db/{schema.js,migrations/0003_subscription_started_at.sql,
  migrations/meta/_journal.json,deploy/schema.sql}`, `backend/repos/usersRepo.js`,
  `backend/subscriptionGate.js`, `backend/server.js`; `src/services/{purchaseService,i18n}.js`,
  `src/screens/ManageSubscriptionScreen.js`; tests `backend/tests/subscriptionSync.test.js`
  (+6: mapper start-date, earliest-wins DB, persist+clear), `__tests__/{purchaseService,
  billingScreens.smoke}.test.js` (+4).
- **Status:** done (DEV migrated, column verified) — backend sync 13/13 + gate 88 +
  moneyDb 4, mobile purchaseService+billing smoke 128/128. Branch/PR owed. PROD
  owes migration 0003.

### 2026-07-11 — Subscription expiry: time-based server gate + confirm auto-renewal
- **Asked:** verify subscription expiry is handled correctly (start + expiry date,
  auto-renewal, blocking app use on expiry); it should auto-renew automatically
  unless the user cancels before expiry.
- **Findings/decision:** Auto-renewal is store-driven (Google Play base plans are
  auto-renewing; RC RENEWAL bumps expiry; CANCELLATION keeps access until expiry)
  — already correct, app never charges. Mobile already blocks on expiry
  (`purchaseService.getPremiumStatus` compares `expiresAt < now`) and the sync
  endpoint derives active from `expires_date > now`. GAP found (Bugs #84): the
  server charge gate `effectiveScanTier`/`isCreditExempt` keyed on
  `subscriptionStatus === "expired"` (a FLAG), not the date — so with the prod RC
  webhook not delivering (#78) and no client sync, a lapsed sub could stay
  credit-exempt past its paid-through date. Fixed: made `effectiveScanTier(profile,
  now)` time-aware — paid tier → free when `subscription_expires_at` is set and not
  in the future; NaN date = lapsed, NULL expiry (lifetime) untouched, explicit
  `expired` still wins; auto-renewal never falsely downgraded (renewal pushes
  expiry forward). No start-date column exists (gating doesn't need it; pull RC
  `original_purchase_date` for a "member since" label if wanted).
- **Files/areas:** `backend/subscriptionGate.js`; `backend/tests/subscriptionGate.test.js`
  (+9 cases); `docs/Bugs_Common_Fixes.md` #84.
- **Status:** done — subscriptionGate 88/88, sharedPricing/sync/moneyDb 42 pass/0
  fail (DB cases skip locally, run in CI). No schema change. Branch/PR owed.

### 2026-07-11 — Annual Unlimited subscription: end-to-end reconcile
- **Asked:** wire the new annual subscription into every dependency — paywalls,
  products, DB, config — match it to RevenueCat + Play Console, and finish the
  documentation and the website (Priceback-Website repo).
- **Decision/constraints:** Audit found the APP + BACKEND + DB-seed were already
  fully wired for `priceback_unlimited_annual` ($49.99/yr, "2 free months", same
  `unlimited` entitlement as monthly): catalog (`shared/pricing.config.js` +
  backend copy, IDENTICAL), Paywall annual toggle (`_anyAnnualPlan` dynamic),
  `purchaseService` (purchaseProduct/purchaseTier/restore cycle detection),
  ManageSubscription annual switch, i18n keys (twoFreeMonths/perYear/manage.annual,
  EN+FR), seed `_subToTierRow` (annualProductId/annualPrice), backend
  entitlement→tier resolution (`subscriptionSync.test` already exercises the
  annual product id). Play Console annual SKU already Active (2026-07-08 audit).
  Real gaps closed this session: (1) **website** had monthly-only copy — added
  the $49.99/yr option to the plan card, pricing lead, visible FAQ, and JSON-LD
  FAQ, EN + FR; (2) corrected two now-stale in-app comments claiming "2026-05
  redesign dropped annual". **RevenueCat VERIFIED live** (browser audit, project
  `c7a0e77d`): the annual product is imported + Published, attached to the
  `unlimited` entitlement (Jul 6), AND in the active `default` offering as
  `$rc_annual` — so RC is matched, not pending (docs saying "RC SKU creation
  pending" were stale; corrected in `RevenueCat_Paywall_Config.md`). Remaining =
  App Store Connect (iOS not launched) + optional prod DB re-seed (not a purchase
  blocker — annual resolves via the RC offering + entitlement).
- **Files/areas:** website `index.html`/`index-fr.html`; app `src/components/Paywall.js`,
  `src/screens/ManageSubscriptionScreen.js` (comments); docs `RevenueCat_Paywall_Config.md`.
- **Status:** done — mobile paywall+purchase 142/142, backend pricing+gate+sync
  121 pass/0 fail. App PR #153 merged; website PR #6 open (merge = live deploy,
  left to Maxim). RevenueCat + Play Console both verified matched end-to-end.

### 2026-07-10 — Prod sign-in "service temporarily unavailable" (bootstrap 503)
- **Asked:** Fix the recurring "We're sorry — sign-in can't be completed right now" dialog on the live Play build (failing since this morning).
- **Decision/constraints:** Root cause was schema drift, NOT a code bug — prod `receipts` was missing `warehouse_id`/`header_ocr` (migration 0002 never applied to prod) so the `/api/me/bootstrap` ORM select threw → 503 → PR #147 sign-in block. Applied **full migration 0002** (add cols + FK, drop `policy_window`) directly to prod Supabase `xjfrlzwonyaorwktnkpj` with Maxim's explicit approval. No backend redeploy needed; DB change is live.
- **Files/areas:** prod DB only (`priceback.receipts`); diagnosis via `api_audit_log` + Postgres logs. Doc'd in `Bugs_Common_Fixes.md`.
- **Status:** done (prod DB migrated, verified — 18 receipts read cleanly). Follow-up: prod schema still drifted vs migration chain — audit for other unapplied migrations.

## Entry template

```
### YYYY-MM-DD — <short task title>
- **Asked:** what Maxim requested (the intent, not just the literal words).
- **Decision/constraints:** any choices made, things to NOT change, gotchas.
- **Files/areas:** main files or modules touched.
- **Status:** in-progress | done (commit/PR #) | abandoned (why).
```

---

## Tasks

### 2026-07-10 — Ship v2.7.0 to Google Play (internal track)
- **Asked:** ship a latest version to Google Play Console.
- **Decision/constraints:** version-name 2.6.0→**2.7.0** (align w/ backend),
  versionCode 17→**18**, ios buildNumber→18. SplashScreen reads version from
  Expo config (no manual edit). EAS production app-bundle → auto-submit to the
  **internal** testing track. Set up a dedicated Google Play service account
  `eas-play-submit@priceback-905d4.iam.gserviceaccount.com` (GCP project
  `priceback-905d4`) with **"Release apps to testing tracks"** granted in Play
  Console; JSON key stored locally at `C:\Users\Maxim\keys\priceback-905d4-*.json`
  (OUT of repo — never commit it or an absolute key path in eas.json). EAS
  printed a spurious "Something went wrong" on submit, but the release DID upload
  — 2.7.0/vc18 is Active + available to internal testers (Jul 10 4:13 PM).
- **Files/areas:** `app.json`, `package.json` (bump). eas.json submit key path
  added then reverted.
- **Status:** done (PR #151 for the bump; build `db36a8af`, submitted to Play
  internal track). Follow-up: to enable true one-command `--auto-submit`, upload
  the GSA key to EAS (`eas credentials`) instead of a local path.

### 2026-07-10 — Fluent sign-in: restore loader + auto-redirect (no second tap)
- **Asked:** on first launch, after picking a Google account the flow bounced
  back to the sign-in screen with a "Continue" that then froze for minutes.
  Make it fluent — after account selection show a loading screen while the
  account data restores, then auto-redirect to the homepage. Least user
  interactions possible.
- **Decision/constraints:** root cause — `handleGoogle` fired `onContinue()`
  (the `hydrateFromBackend` route decision) WITHOUT awaiting it and reset
  `busy`, so the user was dropped back on the sign-in UI showing "Continue"
  while the (slow) hydrate ran invisibly; tapping Continue re-fired hydrate =
  the freeze. Fix: `onSignInDone` sets a new `restoring` state synchronously
  (before the first await) so the parent swaps `SignInStep` → new full-screen
  `RestoringStep` loader on the same frame; on route "main" it stays up until
  `navigation.replace("Main")` unmounts (no flicker), on "retry" it drops for
  the blocking apology alert, on "setup" it drops for SetupStep. An
  already-signed-in user auto-continues ONCE via `autoContinueRef` (guarded so
  a failed hydrate → remount can't loop; the Google/Apple handlers also consume
  the ref). Kept the BLOCKING contract from [[signin-block-and-subscription-sync]]
  intact (no "continue anyway"). New i18n keys signin.restoring{Title,Body}
  (EN+FR).
- **Files/areas:** `src/screens/OnboardingScreen.js`, `src/services/i18n.js`,
  new `__tests__/onboardingSignInFlow.test.js` (render→sign-in→loader→auto-nav).
- **Status:** in-progress (branch + PR owed; [[feedback-feature-branch-workflow]]).

### 2026-07-09 — Receipt-OCR second-pass optimization + full-coverage enforcement
- **Asked:** whenever a receipt parse is not 100% confident, start a second,
  more optimized pass and keep improving until perfection; ZERO regression on
  current parses (not even 1%); every single parsing path tested, plus credit
  management and user account management — all enforced before every merge so
  future regressions can't land.
- **Decision/constraints:** formal `computeParseConfidence` (receiptParsingShared,
  0..1 + named signals; 1.0 ⇔ every printed self-check agrees) drives TWO
  second-pass layers, both strictly gated so a candidate only replaces the
  current parse when it is strictly better — a perfect parse takes the exact
  pre-existing code path (structural zero-regression): (1) parser-level
  `reworkAgainstSelfChecks` ladder (geometry re-clustered at 0.45/0.85 row
  tolerances via new `reconstructRowsFromAnnotation` opts, reshaped geometry,
  plain flat) scored by scoreParse; (2) scan-level high-res re-OCR in
  scanReceipt — first pass stays 1200px/0.80, one retry at 2000px/0.92 when
  confidence < 1 (images only, never PDFs/text/Veryfi; adopted only on strictly
  higher confidence; also RESCUES otherwise-unreadable scans, and in improve
  mode can never flip a parsed purchase into a rejection). Confidence + signals
  stamped on every result; PII-free `receipt_scan_second_pass` telemetry. En
  route, fixed 3 real `extractPrintedTotal` misreads (Bugs #79: FR/plural
  "TOTAL TAXES" escaping \btax\b, column-split PDF totals blocks, flagged item
  price borrowed as total) — printed-total anchor now correct on all 55
  fixtures. NEW golden harness `receiptGolden.snapshot.test.js` pins the FULL
  normalized parse of every fixture (items, scalars, confidence signals,
  rawText digests) — any parse change fails CI until deliberately re-pinned
  via `npx jest receiptGolden -u`. Enforcement: per-file jest
  coverageThreshold floors for 12 critical parsing/credit/account modules
  (receiptParser 97/91/100/98 … creditLedger 100/95/100/100, authService
  91/81/86/94, etc.); global pool re-based (jest removes per-path files from
  `global`) to 57/44/48/60 vs measured 59.71/46.16/50.23/62.11 — documented in
  the config comment; total enforcement strictly increased.
- **Files/areas:** `src/services/{receiptParsingShared,receiptGeometry,
  costcoReceiptParser,ocrService,receiptParser}.js`, `jest.config.js`; tests:
  `receiptConfidence` + `ocrServiceExtra` + `authServiceSignIn` +
  `receiptGolden.snapshot` (new), extended `receiptParserScan`,
  `costcoReceiptParser.test`, `receiptGeometry`, `ocrVisionPipeline`,
  `receiptParsingShared.test`, `creditLedger.test`, `offlineScanCredits`,
  `subscriptionManager.test`; docs `Bugs_Common_Fixes.md` #79.
- **Status:** done — mobile 2626/2626 green (was 2444; +182 tests), all 55
  goldens + every realocr pin byte-identical (zero regression), coverage
  uplift: authService 66/50→93/83, ocrService 85/71→95/87, receiptParser
  77/75→99/93, creditLedger branches 83→97.6, subscriptionManager 80/62→100/92.
  Pre-existing `react-native-worklets` typecheck error unrelated (fails on
  clean main; CI runs tests, not typecheck). Commit/PR this session.

### 2026-07-09 — Sign-in must block on backend failure; record subscriptions without the webhook
- **Asked:** Play-test build showed "data couldn't be retrieved… will sync later" on
  sign-in then ran the signup flow (75-credit welcome UX); a purchased subscription never
  appeared in the events table. Sign-in must BLOCK with an apology naming the problem
  (network vs unavailable database), never offer signup on failure, never re-grant welcome
  credits; subscriptions/plans/credits handled with no hardcodes/workarounds.
- **Decision/constraints:** Prod diagnosis first: the 75 credits were granted exactly
  once (server guard held — the Play build hit the PROD db where the account was new);
  `subscription_events` had 0 rows EVER → the RC webhook never delivered, and subs had no
  client-confirm path (packs did). Fixes: OnboardingScreen blocks on hydrate failure
  (Retry-only apology, `signInBlockedBodyKey`), SetupStep persists profile server-side
  before completing; new trustless `POST /api/me/subscription/sync` verifying against the
  RevenueCat REST API (`REVENUECAT_SECRET_KEY`), called after purchase/restore/reconcile;
  `/health` reports revenuecat webhook+syncApi config. Ops owed by Maxim: set
  `REVENUECAT_SECRET_KEY` + RC dashboard webhook for prod. Bugs #78.
- **Files/areas:** `src/screens/OnboardingScreen.js`, `src/services/{purchaseService,i18n}.js`,
  `backend/server.js`, `backend/tests/subscriptionSync.test.js`,
  `__tests__/{purchaseService,onboardingSignInRecovery}.test.js`, docs.
- **Status:** done — PR #147 merged (68e3d59); both CI runners green. Ops still
  owed by Maxim: `REVENUECAT_SECRET_KEY` on Railway prod + RC dashboard webhook
  (`REVENUECAT_WEBHOOK_TOKEN`).

### 2026-07-09 — Optimize flyer parsing: recover missing items
- **Asked:** flyer parsing misses some items — find why and fix.
- **Decision/constraints:** Root cause chain (Bugs #77): the fixture capture
  script stored raw PIXEL coords while production normalizes to 0..1, so tests
  ran the flat-text fallback and believed "photos defeat geometry" — in
  production the geometry path DOES run on photos and silently lost 1–6
  tiles/page. Modes: phantom column from a "00000" digit run stealing a whole
  column's price blocks; same-row multi-SKU variant tiles sliced into
  zero-height bands; tiles dying when OCR loses one of was/sav/promo. Fixes in
  the geometry parser: coordinate auto-normalization, repeated-digit SKU
  rejection, boundary-based (not nearest-center) column membership, same-row
  SKU grouping emitting one offer per item number, label-aware price solving
  (In-warehouse/Instant-savings/PRICE row labels solve was − sav = promo;
  QC/eco-fee rows vetoed), junk guards (sav ≥ promo, >60-day date windows).
  captureFlyerOcr.js now normalizes like production.
- **Files/areas:** `backend/services/flyerTextParser.js`,
  `scripts/captureFlyerOcr.js`, `backend/tests/flyerTextParser.test.js`,
  `backend/.c8rc.json` (services/** was never measured — included + floors
  ratcheted 89/73/89/89 → 90/75/91/90), `docs/Bugs_Common_Fixes.md` #77.
- **Status:** done — all 76 real tiles across the six photo fixtures parse
  (was 63); PDF 45→45 with junk offers dropped + 5 tile dates corrected to
  their printed section window. Backend 816 tests, 815 pass / 1 skip / 0 fail,
  coverage 91.84/76.79/93.34/91.84 ≥ new floors. Branch
  fix/flyer-parser-missing-items, PR pending. NOTE: a stale nested
  `backend/.git` (3-commit scaffold history) shadows git commands run from
  inside backend/ — flagged to Maxim, not removed.
### 2026-07-08 — Paywall "item could not be found" on every product/subscription
- **Asked:** fix the error shown on any paywall product or subscription:
  "Error, the item you were attempting to purchase could not be found."
- **Diagnosis:** this string is **not** in our code — it's Google Play Billing
  `ITEM_UNAVAILABLE`, surfaced by `subscriptionManager.purchasePackage()`. Our
  code only reaches that call after resolving the package from the RC offering,
  so RC + SKUs are wired correctly; the failure is at `launchBillingFlow`, on
  every SKU. Dominant cause = the installed build is **not a Play-licensed copy**
  (locally-built, self-signed, sideloaded APK). Play exposes product *details*
  to any app with the matching package name (offerings populate) but rejects the
  *purchase* unless the app is a recognized Play-track install by a License
  Tester. **The real fix is store/test-environment, on Maxim's side** (EAS-signed
  AAB → Internal testing → License testing account → install from Play link → all
  5 SKUs Active). Documented in `RevenueCat_Paywall_Config.md` (Symptom #2).
- **Decision/constraints:** app code can't make a store purchase succeed. Did the
  warranted code polish (the doc had flagged it as deferred): stop leaking the raw
  native string. New `purchaseService.classifyPurchaseError` →
  `unavailable|already_owned|store_problem|network|unknown`, logs the underlying
  `rcCode`, and `purchaseProduct` RETURNS the structured error instead of
  throwing; empty-offering now returns `errorCode:"unavailable"` too.
  `Paywall.purchaseErrorMessage` (shared w/ BuyCreditsScreen) maps to friendly
  EN+FR copy (`paywall.err*`). No behaviour change to successful purchases.
- **Files/areas:** `src/services/purchaseService.js`, `src/components/Paywall.js`,
  `src/screens/BuyCreditsScreen.js`, `src/services/i18n.js`; tests
  `__tests__/purchaseService.test.js`; docs `RevenueCat_Paywall_Config.md`,
  `Bugs_Common_Fixes.md` #76.
- **Status:** done (code + tests; purchaseService 111/111, i18n+paywall+buyCredits
  86/86 green). **Store-side fix is Maxim's remaining action** — code alone can't
  resolve a Play-licensing rejection. Commit/PR owed.
- **CONFIRMED via live Play Console audit (2026-07-08, browser):** ALL 5 SKUs
  exist with exact-matching IDs and are Active (3 packs + monthly/annual subs);
  internal-testing track has a live build **v2.6.0 "IAP config testing" (Available
  to internal testers)**; app is Draft (fine for internal testing). Two real gaps:
  (1) **License testing "Testers" list was NOT enabled** (maxim.louka@gmail.com +
  sandrasharobim@hotmail.com) — Maxim enabled+saved it during the session; (2)
  Maxim confirmed he was **testing a LOCAL SIDELOADED APK** — that is THE root
  cause (Play Billing rejects purchases from non-Play-signed installs). Fix =
  uninstall sideload, install v2.6.0 from the internal-test opt-in link
  `https://play.google.com/apps/internaltest/4700507703194832202` signed in as a
  tester, purchase from THAT build (license tester → test card). Pack-credit
  landing then depends on the v2.6.0 backend having `REVENUECAT_WEBHOOK_TOKEN`.
- **Sideload dev-loop fix added (so the error is gone in the build Maxim runs):**
  `purchaseService` now has `isLocalSideloadBuild()` (`buildProfile==="local"`,
  from app.config.js) + extracted `_simulatePurchase`; in a LOCAL sideload build
  only, an `unavailable` store rejection / empty offering falls back to the
  simulated grant (same as no-key dev-mode). Every `eas` (Play) build still does
  real purchases + surfaces real errors; non-`unavailable` errors never simulate.
  4 new tests. purchaseService 115/115; paywall/buyCredits/scanGate/subMgr 46/46.

### 2026-07-08 — Re-enable Microsoft (Outlook) email sync + publish config sync
- **Asked:** re-enable Microsoft accounts on email scans; configure/update any
  publishing config; review `docs/PUBLISH_CHECKLIST.md` and mark done steps.
- **Decision/constraints:** Outlook is gated by `MICROSOFT_CONFIGURED` in
  `EmailSyncScreen.js` — the gate opens automatically once `MICROSOFT_CLIENT_ID`
  resolves (EAS secret / `.env.local`); config plumbing (`common/eas/local.js`)
  is correct, keep the gate (don't show Outlook with the placeholder client id).
  Fixed the real blocker: `connectOutlook` generated a bare `priceback://`
  redirect but Azure (§6a) registers `priceback://auth/microsoft-callback` →
  `redirect_uri_mismatch`. Aligned code to the documented URI. Azure redirect URI
  MUST equal that exact string. Left the Gmail redirect untouched.
- **Files/areas:** `src/services/emailSyncService.js` (connectOutlook redirect),
  `__tests__/emailSyncConnect.test.js` (new regression test pinning the URI),
  `docs/PUBLISH_CHECKLIST.md` (§6 + summary state, constant name fix).
- **Status:** done (uncommitted; email-sync work is unrelated to the current
  `fix/flyer-parser-missing-items` branch — owes its own branch/PR).

### 2026-07-08 — Zoomable images in admin tag + flyer review
- **Asked:** on the price-tag review page, be able to open & zoom the tag photo
  to check every detail; same system for the flyer review — image openable/
  zoomable during admin review.
- **Decision/constraints:** new shared `src/components/ZoomableImage.js`
  (thumbnail w/ magnifier badge → full-screen pinch/pan/double-tap modal, built
  on gesture-handler + reanimated, already app-wired via GestureHandlerRootView).
  Tag screen: tag photo now tappable→zoom. Flyer screen: source page URIs
  retained (`pages` state) and shown as a horizontal zoomable strip at the top of
  the review step (new i18n key `adminFlyer.sourcePagesLabel`, EN+FR). Added
  reanimated + worklets jest mocks to `jest.setup.js` (real entry throws under
  jest-expo). New `__tests__/zoomableImage.test.js`.
- **Files/areas:** src/components/ZoomableImage.js (new), src/screens/AdminTagReviewScreen.js,
  src/screens/AdminFlyerScanScreen.js, src/services/i18n.js, jest.setup.js,
  __tests__/zoomableImage.test.js.
- **Status:** done (uncommitted — commit/PR owed). Full mobile suite green except
  pre-existing `creditHistoryScreen.smoke` failure (fails on clean main too, unrelated).

### 2026-07-06 — Remove personal email + vendor-neutral privacy policy (audit follow-up)
- **Asked:** push everything; remove the personal email; don't list every
  technology used — remove contradictions/over-claims from the legal pages
  (e.g. "images are discarded" while tag photos are stored).
- **Decision/constraints:** app contacts flipped to support@/privacy@/
  security@priceback.ca (MX live via Namecheap forwarding — Maxim should
  test-mail each). Website (PR #5): privacy policy EN+FR now lists
  service-provider CATEGORIES (specific list from Privacy Officer on
  request) instead of naming Vision/Gemini/Sentry/RevenueCat/Railway;
  removed "images discarded"/"receipts never uploaded" contradictions;
  PIA claim softened to the Law 25 commitment; terms/support de-named
  vendors and fixed the stale "20 retailers" claim to Costco-first.
  Website merges = live deploys and are permission-gated → PRs #4 + #5
  left open for Maxim.
- **Files/areas:** `config/profiles/common.js`, `src/constants/contact.js`,
  `docs/{incident-response,security-prelaunch-checklist,
  Pre_Publish_Audit_2026-07-06,Task_Log}.md`; website repo:
  `privacy-policy.html`, `privacy-fr.html`, `terms-of-service.html`,
  `terms-fr.html`, `support.html`, `support-fr.html`, `index.html`,
  `index-fr.html`, `README.md` (PR #5).
- **Status:** done (this PR; website PRs #4/#5 await Maxim's merge).

### 2026-07-06 — Pre-publish audit: legacy cleanup + legalities/compliance + report
- **Asked:** run a pre-publish audit, clean any legacy, check legalities and
  compliance, document everything in a `docs/*.md` file.
- **Findings/decisions:** all suites green (mobile 2418/2418, backend c8 floors
  enforced exit 0, typecheck 0). State corrections: prod backend is v2.7.0 and
  prod Supabase HAS the full v2 schema + live data ("never migrated" was stale);
  MX for priceback.ca now exists (Namecheap forwarding — verify delivery before
  flipping contact emails). `/privacy` + `/terms` short URLs 404'd → website
  repo PR #4 (301 aliases, awaiting Maxim's merge = live deploy). Privacy-policy
  content gaps flagged, NOT auto-edited (legal text): Supabase + Cloudflare R2
  not named as processors, tag-photo R2 retention contradicts "images
  discarded", member_id not listed as collected. Supabase RLS disabled on all
  36 prod tables — verify `priceback` not Data-API-exposed or enable RLS.
  Legacy cleaned: `ca.priceback.app` → `com.priceback` in 6 docs/files; dead
  `legal/*.html` links → live URLs (legal source of truth = website repo since
  ffc874c); PUBLISH_CHECKLIST §1/§8B rewritten to verified reality;
  Audit_ToDo.md marked historical; drizzle.config.js Neon hint fixed.
- **Files/areas:** `docs/Pre_Publish_Audit_2026-07-06.md` (new report),
  `docs/{PUBLISH_CHECKLIST,security-prelaunch-checklist,SECURITY,
  RevenueCat_Paywall_Config,BUILD_LOCAL_ANDROID,FUTURE_ROADMAP,Audit_ToDo,
  Task_Log}.md`, `README.md`, `.env.example`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `legal/MARKETING_CLAIMS.md`, `backend/drizzle.config.js`; website repo
  `_redirects` (PR #4).
- **Status:** done (this PR) — no app-code changes, docs/comments only.

### 2026-07-06 — Subscription/payment money audit + yearly $50 sub + regression tests
- **Asked:** audit every money flow (subscriptions, payments, credits, app
  income) for zero-margin-of-error handling; exhaustive regression tests; ANY
  subscription = everything unlimited with no credit spend, credits frozen in
  the account until the user returns to pay-as-you-go; add a $49.99/yr annual
  Unlimited ("2 free months, paid at once") if easy.
- **Audit verdict:** ledger atomicity, advisory-lock idempotency, dual-path
  topup, referral settle, signup grant, device-claim + reconcile all SOUND.
  Credits already frozen (subscription lifecycle never writes scan_credits).
  3 gaps fixed: (1) charge sites hardcoded `tier === "unlimited"` and ignored
  status → new `subscriptionGate.isCreditExempt(profile)` (any in-force paid
  sub exempt; expired pays) used at receipt POST, offline-scans, drop
  commission; (2) RC webhook replay could regress state (DB path never set
  subscriptionLastEventId) → `subscriptionEventsRepo.hasEvent(rcEventId)`
  guard before applying; (3) mobile pack-confirm used originalPurchaseDate as
  a txn-id fallback → double credit; now only a real transaction id confirms,
  else webhook is sole grantor. Annual sub added in pricing.config (both
  copies): `priceback_unlimited_annual` $49.99 (= pay 10 months, get 12),
  `monthlyEquiv` "$4.17" — Paywall/i18n/purchaseTier/webhook/DB seed were all
  pre-wired for annual. RC dashboard SKU creation is Maxim's manual step
  (docs updated: RevenueCat_Paywall_Config.md, PUBLISH_CHECKLIST §2 — also
  fixed stale $12/300/600/1400 numbers there).
- **Files/areas:** `backend/{subscriptionGate,server,priceDropNotifier}.js`,
  `backend/repos/subscriptionEventsRepo.js`, `shared/pricing.config.js` (+
  backend copy), `src/services/purchaseService.js`; tests
  `backend/tests/{subscriptionMoneyDb (new),subscriptionGate,sharedPricing}.test.js`,
  `__tests__/purchaseService.test.js`; docs `docs/{Subscription_Money_Audit.md
  (new),RevenueCat_Paywall_Config.md,PUBLISH_CHECKLIST.md,Bugs_Common_Fixes.md,
  Task_Log.md}`.
- **Status:** done (this PR) — backend full coverage run green (91.2/74.8/92.75
  ≥ floors 89/73/89, incl. new subscriptionMoneyDb suite live on dev Supabase);
  mobile 2418/2418, coverage 67.23/54.48/56/69.6 (floors 61/46/52/63). Dev DB
  seeded with the annual SKU; RC dashboard SKU creation pending (Maxim).

### 2026-07-05 — Credit-management audit + restore auto-reload at the 50-credit threshold
- **Asked:** full test coverage + audit that all credit management is well done
  and configured (friend referral; auto-reload must prompt when the balance
  drops at 50 — it was changed to 0 without approval). Outputs → `docs/*.md`
  (publishing items → `docs/PUBLISH_CHECKLIST.md`). HARD SCOPE EXCLUSION:
  price-tag + receipt credit SPEND logic is field-tested — do not analyze or
  change it.
- **Findings:** config chain was 50 everywhere (bundled catalog, seed, live dev
  DB app_config) but the PROMPT only fired at the 0-credit scan block; the
  2026-07-02 session had reworded all copy to "re-buy at zero" instead of
  restoring the threshold (Bugs #73). Referral (deferred settle, FOR UPDATE
  lock, exactly-once across topup/webhook race) and the credit ledger
  (advisory-lock idempotency, ledger+balance atomic) audited SOUND — no changes.
  Latent prod risks flagged into PUBLISH_CHECKLIST §8B: stale prod Starter pack
  (300 vs 250, coalesce-seed can't fix — Bugs #53), prod app_config verify list,
  and §8B's migration list refreshed to the re-squashed 0000→0002 chain.
- **Fix:** `purchaseService.maybeAutoReloadOnLowBalance(status)` — prompt at
  balance ≤ `getAutoReloadThreshold()` (50), once per crossing
  (`auto_reload_low_prompted_v1` marker, re-armed above threshold), delegates
  opt-in/premium/pack rules to `maybeAutoReload`; wired into ScanScreen's two
  post-spend balance refreshes; 0-credit gate untouched (safety net); EN+FR
  copy back to threshold-based.
- **Files/areas:** `src/services/{purchaseService,i18n}.js`,
  `src/screens/ScanScreen.js`; tests `__tests__/{purchaseService,
  scanScreenCreditGate,screens}.test.js`; docs
  `docs/{Credit_Management_Audit.md (new),PUBLISH_CHECKLIST.md,
  Bugs_Common_Fixes.md #73,Task_Log.md}`.
- **Status:** done — mobile 2410/2410, coverage 67.32/54.4/56/69.74 (floors
  61/46/52/63); backend referral+credit suites 46/46 on dev Supabase (backend
  code untouched). Commit/PR owed.

### 2026-07-03 — 10th report: invented $12.94 tax on a TAX 0.00 receipt, warehouse still null — full pipeline coverage
- **Asked:** same receipt scanned 3× (`r_1783099597725_q2vet`/`…9t24z`/`…2xoa1`),
  warehouse_id still NULL; NEW regression: tax detected as $12.94 with total
  $112.45 when the OCR plainly shows SUBTOTAL = TOTAL = 99.51 and TAX 0.00.
  Hard requirements: full test coverage of ALL parsing logic; the total must
  never exceed the printed OCR total; a printed TAX 0.00 must win. A true fix.
- **Root causes (Bugs #72):** (1) column-split totals block ("SUBTOTAL/TAX/
  99.51/0.00") mispaired TAX with the subtotal's value; (2) `validateReceipt`'s
  province cap then "corrected" 99.51 → 12.94 (13% × subtotal), inflating the
  total past the printed one — it never consulted the receipt's own printed
  total/tax; (3) a bare price printed ABOVE its SKU+name row dropped the item
  (total 77.92 variants). Structural gap: no test ran the real chain
  parseReceiptText → validateReceipt → toApiBody (parser-level suites were
  green while the field failed).
- **Fixes:** `reshapeColumnSplitTotals` in the shared engine (labels zip with
  positional values); `printedTotal` stamped on every parse (extractPrintedTotal
  moved to receiptParsingShared, re-sourced from flat OCR on both Costco exits)
  and made authoritative in `validateReceipt` (tax := printed − items when
  plausible incl. ZERO; total never exceeds printed, even when clamping);
  inverted price-above-SKU pairing in `extractItems`. The warehouse chain
  itself verified correct end-to-end on all 3 live OCR variants — prior fixes
  (6e7223e/f6fbe0a) never reached the field builds.
- **Files/areas:** `src/services/{receiptParsingShared,receiptValidator,
  costcoReceiptParser}.js`; tests: `__tests__/receiptPipeline.live.test.js`
  (NEW e2e: 3 live-failure OCR variants pinned + every committed fixture run
  through parse→validate→toApiBody with printed-total/tax/warehouse/date
  invariants), `receiptParsingShared.test.js` (+reshape/printedTotal/inverted
  pairing), `receiptValidator.test.js` (+printed-total authority),
  realocr EXPECTATIONS pin tax/date/warehouseId for the failing receipt.
  Docs: `Bugs_Common_Fixes.md` #72.
- **Status:** done — full mobile suite 2402/2402 green; coverage
  67.23/54.32/56.12/69.59 (floors 61/46/52/63). Dev-DB warehouse backfill SQL
  prepared, awaiting Maxim's go-ahead. Commit/PR owed.

### 2026-07-03 — Fix purchase-date-always-today regression + warehouse_id still null
- **Asked:** receipt `r_1783095553662_9t24z` still saves `warehouse_id = null`
  (renders "Costco Canada"), AND a regression a few merges ago made the purchase
  date always default to today. Add tests covering all paths; the OCR changes must
  be a net improvement, not worse.
- **Decision/constraints:** Root cause = when Vision geometry is used, the Costco
  warehouse parser reads header-derived fields (`date`, `warehouseId`,
  `purchaseType`, `storeId`) off the geometry-reconstructed **item-table rows**,
  and `chooseBetterParse` picks the winner only on item/total/discount score.
  Geometry clustering drops the date line + welds/omits the warehouse line, so the
  chosen parse lost them → date null (→ ScanScreen uses today) and warehouse null.
  #70's regex tweak couldn't help — the value was never taken from the flat text.
  Fix: re-source those scalar header fields from the **full flat OCR** after the
  item parse is chosen (`applyHeaderFieldsFromRawText`), on both parse paths; never
  fabricate (date-less receipt stays null). Sync-time fallback recovers
  `warehouseId` from `headerOcr`. NOTE: fixes NEW scans; the already-saved receipt
  must be re-scanned (or re-synced) to pick up its warehouse.
- **Files/areas:** `src/services/costcoReceiptParser.js`,
  `src/services/receiptSyncService.js` (`toApiBody`); tests
  `__tests__/costcoReceiptParser.test.js`, `costcoReceiptParser.realocr.test.js`
  (per-fixture header invariant + pinned date/warehouse), `receiptSyncService.mapping.test.js`.
  Doc: `Bugs_Common_Fixes.md` #71 (supersedes #70's root cause).
- **Status:** done — full mobile suite 2171/2171 green; coverage 66.97/54/56.09/69.35
  (≥ floors 61/46/52/63). No DB/schema change. Commit/PR still owed.

### 2026-07-02 — Link receipt to warehouse, split store/warehouse OCR, drop policy_window
- **Asked:** (1) a saved receipt was only linked to the store — link it to the
  specific warehouse too. (2) Persist the store + warehouse OCR in a column separate
  from the items OCR. (3) Regression: the receipt list's 2nd line showed "Costco
  Canada" instead of the warehouse name — restore the warehouse name (+ number, e.g.
  "Kanata #541") on the 2nd line and everywhere "Costco Canada" appeared (receipt
  view, price-drop view, …). (4) `policy_window` should be consumed from the store
  policy and the column removed from `receipts`.
- **Decision/constraints:** `receipts.warehouseId` stores the resolved `warehouses.id`
  FK; the API echoes back the store-issued NUMBER as `warehouseId` (the client keys
  its label off it). Header OCR captured at parse time as the COMPLEMENT of
  `stripWarehouseInfo` (`extractWarehouseInfo`), since bug #67 strips the header out
  of `raw_ocr`. Window now read live from `stores.adjustment_days` (single source of
  truth) — `recomputePolicyStatus`/`recomputeOverduePolicyStatuses`/`priceDropRepo`
  all updated.
- **Files/areas:** migration `0002_receipt_warehouse_header_ocr.sql` (+journal, schema.js,
  deploy/schema.sql), `repos/receiptsRepo.js`, `repos/priceDropRepo.js`, `server.js`;
  mobile `shared/ocrCleanup.js` (extractWarehouseInfo), `services/receiptParser.js`,
  `services/receiptParsingShared.js` (extractHeaderOcr), `services/receiptSyncService.js`,
  `screens/ScanScreen.js`, `constants/stores.js` (receiptWarehouseLabel → "City #num"),
  `screens/DetailScreen.js`, `screens/HomeScreen.js`. Tests: backend
  `receiptWarehouseLink.test.js` (new) + policyStatusDb; mobile stores/ocrCleanup/
  receiptParsingShared/receiptSyncService.mapping.
- **Status:** done (DEV migrated; consolidated schema regenerated). Backend green in
  isolation (full-suite flakes = env connection-pool exhaustion, not this change);
  mobile 2109/2109, coverage 66.92/53.98/56.07/69.29 (≥ floors). **PROD owes migration
  0002.** Commit/PR still owed.

### 2026-07-02 — Scan-credit gate ran after OCR/LLM parsing instead of before
- **Asked:** at 0 credits (and no available auto-reload), the scan still runs OCR +
  LLM parsing successfully but the receipt is never saved because the credit gate
  rejects it — so the OCR/LLM cost is spent for nothing. Move the gate before
  parsing so a 0-credit user is paywalled before any OCR/LLM spend.
- **Root cause:** `ScanScreen.processImage()` called `scanReceipt()` (OCR + LLM)
  unconditionally; `canAddReceipt()` was only checked afterwards — once in the
  rejected-receipt branch (post-OCR), and again at `doSave()` when the user tapped
  Save on a successfully-parsed receipt. Both checks ran after the paid OCR/LLM
  call had already happened.
- **Fix:** added a `canAddReceipt()` (+ `maybeAutoReload()` fallback) gate at the
  very top of `processImage()`, before `scanReceipt()` is called. If not allowed,
  the paywall shows immediately and OCR/LLM is never invoked. Removed the
  now-redundant post-OCR check in the rejected-receipt branch (reuses the
  pre-OCR result). The `doSave()` check remains as a safety net for balance
  changes between capture and save.
- **Files/areas:** `src/screens/ScanScreen.js`. Test:
  `__tests__/scanScreenCreditGate.test.js` (new — asserts `scanReceipt` is never
  called when credits are unavailable, and runs normally when they are).
- **Status:** done. Full mobile suite 2083/2083 pass, coverage 66.8/53.79/55.92/69.16
  (≥ floors).

### 2026-07-02 — Auto-reload confusion + notifications still not firing
- **Asked:** (1) Buy Credits screen on startup shows "Re-buy automatically" OFF, then
  ~2s later flips ON and the selected pack changes on its own — is it on or off?
  (2) Homepage says "Auto-reload armed" but no credits are ever reloaded automatically.
  (3) Notifications still never arrive despite several prior fix attempts. Fix + test.
- **Root causes found:** (1) `BuyCreditsScreen.refresh()` awaited
  `Promise.all([canAddReceipt() /*~2s server*/, getPrefs() /*fast local*/])` before
  setting the toggle+selection, so the toggle/pack rendered stale defaults (off,
  middle pack) until the slow balance call returned, then snapped. (2) "Auto-reload"
  is an *auto-PROMPT* by platform rule ([[auto-reload-platform-constraint]]) — it can
  only fire the OS purchase sheet when the user attempts a scan at 0 credits; the copy
  over-promised silent proactive reload. (3) The LOCAL price-drop notification
  (`sendPriceDropNotification`) was only ever called from the once-daily background
  task — never on the manual "Refresh prices" path the user actually uses; and there
  was no on-device way to see permission/token status or test delivery.
- **Fixes:** (1) split the load in `BuyCreditsScreen` — prefs first (toggle+selection
  set immediately from local storage), balance loaded separately; render nothing
  misleading until prefs resolve. (2) honest copy for `home.lowBalanceAutoOn` +
  `buyCredits.autoReload*` (EN+FR) — behaviour unchanged. (3) fire a local price-drop
  notification for NEWLY-detected drops on the DetailScreen manual refresh (gated by
  `notifUrgentClaims`); add a Notifications-screen diagnostic card (permission / token
  / signed-in) + "Send test notification" button so the user can verify delivery and
  see *why* it fails.
- **Files/areas:** `src/screens/{BuyCreditsScreen,DetailScreen,NotificationsScreen}.js`,
  `src/services/notificationService.js` (diagnostics + test send), `src/services/i18n.js`
  (EN+FR copy), tests on the mobile runner. Docs: `Bugs_Common_Fixes.md` #66.
- **Verification:** full mobile suite **2081 pass**, coverage 65.23/52.98/55.04/67.33
  (≥ floors 61/46/52/63). New/updated tests: `buyCreditsScreen.smoke` (split-load
  regression), `detailScreenDropNotify` (new), `notificationService` (diagnostics +
  test-send). Note: on-device notifications still require a real EAS build + physical
  device + granted permission + signed-in user — the new diagnostic card surfaces
  which of those is missing. Backend push-send path unchanged (already correct).
- **Status:** done (code + tests, mobile green) — commit + PR owed on a feature branch.

### 2026-07-01 — OCR cleanup (compliance) + parse cross-validation + flyer noise filter
- **Asked:** Pre-parse OCR cleanup for receipts/refunds and flyers driven by an updatable
  EN+FR keyword list (payments/transactions/invoices/cart/basket/marketing removed; keep
  warehouse info, products, totals, taxes, date, items-sold count, tax type). Persist only
  the CLEANED OCR (compliance — raw_ocr lives in the DB and round-trips via bootstrap).
  Extract the member ID: save it in the DB but never return it from the API nor show it in
  the app. Cross-validate parsed items vs printed "TOTAL NUMBER OF ITEMS SOLD" and
  "TOTAL DISCOUNT(S)", re-scoring/re-parsing on mismatch; reject unreadable/too-blurry
  receipts. Flyers: filter advertising/unrelated text; ignore pages with no product savings.
  Use all fixtures in `__tests__/fixtures/` as ground truth.
- **Decision/constraints (AskUserQuestion):** NEW scans only — no DB backfill of existing
  raw_ocr rows. On residual counter mismatch: accept the best-scoring parse and FLAG it
  (`checkMismatch`), reject only truly unreadable scans. Price-tag scans stay out of scope
  (admin review needs their raw OCR). member_id = dedicated nullable receipts column,
  included ONLY in the /api/me/data-export payload.
- **Files/areas:** `shared/ocrCleanup.js` (new, synced to backend/shared),
  `src/services/{receiptParser,receiptParsingShared,costcoReceiptParser,receiptSyncService,i18n}.js`,
  `src/screens/{ScanScreen,AdminFlyerScanScreen}.js`, `src/utils/receiptRejection.js`,
  `backend/db/schema.js` + migration `0001_receipt_member_id` (applied to DEV; PROD owes it),
  `backend/server.js`, `backend/repos/receiptsRepo.js`,
  `backend/services/{flyerScanService,flyerTextParser}.js` (flyer noise cleanup, page
  `rejected:no_offers`, 5-digit SKU floor guarded by the triplet),
  `scripts/captureReceiptOcr.js` (EN REFERENCE scrub fix + 6 fixture re-scrubs).
  Tests: `__tests__/{ocrCleanup,receiptSelfChecks}.test.js` (new),
  realocr suite (cleanup parity + no-PII invariant on every fixture + self-check
  invariant + PXL_024302268 ground truth), `backend/tests/receiptMemberIdDb.test.js`
  (new), flyer suites (+photo-page regression). Docs: `Bugs_Common_Fixes.md` #65.
- **Extra findings fixed along the way:** OCR-garbled TPD intros ("TRD/", "PD/")
  canonicalized; inverted multi-line TPD (amount printed ABOVE its intro) handled;
  fee/deposit lines excluded from the items-sold unit count; 5-digit flyer SKUs
  (83013 Saputo) recovered with a triplet guard against phantoms.
- **Status:** done — realocr 360/360, mobile 2067 pass (coverage 64.58/52.34/54.55/66.56
  ≥ floors 61/46/52/63), backend green (see PR). Branch `feat/ocr-cleanup-compliance-validation`.

### 2026-06-29 — Hide store-list slide from onboarding
- **Asked:** The startup onboarding slide that lists store names (Canadian Tire, Best Buy, etc.) should be hidden/skipped for now.
- **Decision/constraints:** Remove slide 4 (`onb.slide4Title`/`onb.slide4Body`) from the `SLIDES` array in `OnboardingScreen.js`. i18n keys stay (no hard rule violation — keys unused but not broken). Dot indicator count adjusts automatically.
- **Files/areas:** `src/screens/OnboardingScreen.js`.
- **Status:** done.

### 2026-06-29 — Local build failed (Syncthing lock) + `-Env` param for build script
- **Asked:** Diagnose why `manual_build/build-and-install.ps1 -build` "failed in
  3 min but ran ~3 hours"; document the recurring bug; and make the env file
  selectable as a parameter on ALL pathways of the build/install script.
- **Decision/constraints:** Root cause = Syncthing real-time-syncing
  `C:\Workspace` (incl. `build/`, `node_modules/`) memory-mapped Gradle's files
  → `user-mapped section open` on `merger.xml` + `*.sync-conflict-*` copies; the
  job never exited so the wrapper stopwatch ran for hours while Gradle itself
  failed at 2m58s. Fix = `C:\Workspace\.stignore` (per-machine, NOT in repo) +
  cleared `android/app/build`. New `-Env` param defaults to `local` (preserves
  old `.env.local` behavior); accepts bare suffix / `base`/`.env` / `.env.x` /
  full path; an explicit `-Env` that doesn't resolve = hard `Fail` (no silent
  prod-default fallback); env loads on every pathway (prebuild/build/install).
- **Files/areas:** `C:\Workspace\.stignore` (new, outside repo),
  `manual_build/build-and-install.ps1` (`-Env` param + `Resolve-EnvFile`),
  `docs/Bugs_Common_Fixes.md` (entry #63).
- **Status:** done (local fix + script change; not yet committed/PR'd).

### 2026-06-29 — Reinstall sign-in recovery still broken + paywall config error
- **Asked:** On the new build, reinstall→sign-in still shows "Signed in as <email>"
  then routes to "Finish setting up" (re-asking all fields) and lands on an empty
  app (no receipts/credits). Paywall fails "issue with your configuration". The
  prior fix (PR #122/#123) didn't help.
- **Root cause (confirmed via live probes):** EAS `preview`/`development` profiles
  set no `PRICE_API_URL` → `config/profiles/eas.js` undefined → `common.js`
  default → **production** backend. Prod runs stale **v2.6.0** where
  `GET /api/me/bootstrap` is **404** (dev v2.7.0 has it). So `hydrateFromBackend`
  fails → nothing restored → wrong route + empty app. The prior fix only changed
  app code, never the backend the build calls. Two app weaknesses amplified it:
  `onSignInDone` re-onboarded on ANY hydrate failure, and hydrate failures emitted
  zero telemetry (so the fix was authored blind).
- **Decision/constraints:** Build under test = EAS preview/dev; the account HAS
  real data **on dev**. RevenueCat creds are ON HOLD → **document only**, no code.
  Point preview/development EAS builds at the **dev** backend (data + working code
  live there). Prod deploy + owed migrations remain Maxim's separate task.
- **Fixes:** (1) `eas.json` — `PRICE_API_URL=dev` in `preview` + `development`.
  (2) `syncService._hydrate` — emit `analyticsService.track("hydrate_failed",…)`
  on http_/network/unconfigured (+ carry `status` on http_). (3) `OnboardingScreen`
  — new exported pure `decideSignInRoute()`: main / retry / setup; a FAILED hydrate
  → retry alert (`signin.recovery*` EN+FR), never forced re-onboarding; also
  `hydrateFromBackend({reason:"setup"})` on the setup-completion path. (4) Doc:
  `docs/RevenueCat_Paywall_Config.md` (external SKU/store/key setup for code-23).
- **Files/areas:** `eas.json`, `src/services/syncService.js`,
  `src/screens/OnboardingScreen.js`, `src/services/i18n.js`,
  `docs/RevenueCat_Paywall_Config.md`. Tests: `__tests__/syncServiceHydrate.test.js`
  (+telemetry/404 cases), `__tests__/onboardingSignInRecovery.test.js` (new).
  Docs: `Bugs_Common_Fixes.md` #62.
- **Status:** in-progress (code + tests done; mobile **1796 pass**, coverage
  64.27/51.47/54.09/66.24 above floors; backend untouched) — branch
  `fix/reinstall-bootstrap-backend-target`; commit + PR pending.

### 2026-06-27 — Fix build script paths + gitignore deals/
- **Asked:** Commit and merge all local changes; ensure tests pass on main.
- **Decision/constraints:** `manual_build/build-and-install.ps1` had `..\android\` paths (wrong relative base); fixed to `android\`. Added `deals/` to .gitignore (image dumps, not repo content).
- **Files/areas:** `manual_build/build-and-install.ps1`, `.gitignore`, `docs/Task_Log.md`.
- **Status:** done (see this PR)

### 2026-06-27 — Costco pricing decoder: deal signal classification
- **Asked:** Implement Costco "Secret Pricing Decoder" rules (.99/.97/.X9/.00/.88/asterisk/green tag) as business logic stored in the DB and surfaced as instant user feedback after a price tag scan.
- **Decision/constraints:** No new table — rules stored as classifyPriceSignal() pure function; deal signal stamped in existing `price_points.flags` (price_signal, deal_tier, has_asterisk, is_organic); returned in `/api/observations/tag` response as `deal_signal`; mobile renders a colored badge on the scan done screen. Tag-scan OCR now also detects hasAsterisk (`*` in raw text) and isOrganic ("organic" keyword). `.X9` rule (manufacturer promo) added from image cross-check — was missing from Reddit text.
- **Files/areas:** `src/services/costcoTagScanner.js`, `src/services/priceTagFields.js`, `backend/services/priceSignalService.js` (new), `backend/repos/crowdRepo.js`, `backend/server.js`, `src/services/priceService.js`, `src/screens/PriceTagScanScreen.js`, `src/services/i18n.js`, `__tests__/costcoTagScanner.test.js`, `backend/tests/priceSignalService.test.js` (new).
- **Status:** done

### 2026-06-27 — Fix 4 prod bugs: notifications, tag-review alert, reinstall recovery, scan 429
- **Asked:** (1) no notifications at all; (2) "price tag waiting for review" sends
  no notification; (3) sign-in treats an existing user as a NEW signup (re-prompts
  setup + referral) and reinstall recovers no data (receipts/credits/history gone)
  — the forbidden behavior; (4) a weak connection surfaces an inaccurate 429 scan
  error.
- **Decision/constraints (confirmed via AskUserQuestion):** #2 = full scope (fix
  push delivery + ADD an admin "tag awaiting review" push + verify the user
  verified/credited push + the local ready-to-review path). #4 = if the image is
  readable just fix wording (429), otherwise (timeout/network) treat as transient +
  queue. Identity is the stable Google `sub`, so reinstall data was never deleted —
  the client just never asked the backend to recover it. No DB migration.
- **Root causes:** (1) Expo push token stored only in AsyncStorage, never written
  to `users.push_token` → `priceDropRepo.findNotifiable`/`sendUserPush` filter
  every send. (2) no admin notification existed for a queued tag review. (3)
  `onSignInDone` routed from wiped local prefs, never hydrating the backend
  profile. (4) `ocrService` threw the raw 429 text; `PriceTagScanScreen`'s network
  regex excluded 429.
- **Fixes:** new `notificationService.syncPushTokenToBackend()` (called on
  mint/sign-in/boot); admin push loop in `POST /api/observations/tag` after
  `createReview` (no category → master-switch-only gating); `onSignInDone` awaits
  `hydrateFromBackend` and `_applyPrefs` restores postal/province + onboarding
  flags from the bootstrap `profile`; `_visionFetch` tags a 429 `{status,code}`
  with accurate copy and `PriceTagScanScreen` adds a throttle branch (+ EN/FR
  `priceTag.throttled*` keys).
- **Files/areas:** `src/services/{notificationService,syncService,ocrService,i18n}.js`,
  `src/screens/{OnboardingScreen,PriceTagScanScreen}.js`, `backend/server.js`
  (`/api/observations/tag` admin push). Tests: `__tests__/{notificationService,
  syncServiceHydrate,ocrServiceTimeout}.test.js`, `backend/tests/tagReviewAdminPushDb.test.js`.
  Docs: `Bugs_Common_Fixes.md` #58/#59/#60. Updates [[verified-price-drop-notifications]]
  / [[offline-tag-queue-and-admin-review]].
- **Verification:** mobile **1780 pass**, coverage 64.32/51.52/54.21/66.22 (≥ floor
  61/46/52/63); backend **764 pass / 0 fail / 1 skip**, c8 90.37/74.09/92.23/90.37
  (≥ floor 89/73/89/89). DB tests serial on Supabase DEV (`DB_POOL_MAX=3`).
- **Status:** done (code + tests, both runners green) — branch
  `fix/notifications-signin-recovery-scan-429`; commit + PR pending.

### 2026-06-27 — Fix EAS Build: react-native-purchases not a config plugin
- **Asked:** EAS Build failed — "Unable to resolve a valid config plugin for react-native-purchases."
- **Decision/constraints:** `react-native-purchases` is a native autolinked module with NO config plugin (no `app.plugin.js`); it must NOT be in `app.json` `plugins`. Removed the `"react-native-purchases"` entry. Library still functions via autolinking — do not re-add it to plugins.
- **Files/areas:** `app.json` (plugins array).
- **Status:** done.

### 2026-06-27 — Commit local changes: in-flight purchase guard + build path fix
- **Asked:** Commit and merge any local changes, ensure tests workflow passes on main.
- **Decision/constraints:** 3 modified files on main: (1) build-and-install.ps1 path fix (`android\` → `..\android\` for relative paths); (2) Paywall.js — `useRef` in-flight guard on both `handleBuyPack` and `handleUpgrade` to prevent double-purchase; (3) BuyCreditsScreen.js — same in-flight guard + `buying` state for button disabled state.
- **Files/areas:** `manual_build/build-and-install.ps1`, `src/components/Paywall.js`, `src/screens/BuyCreditsScreen.js`. Also fixed `__tests__/stores.test.js` + `storePolicy.test.js` (hardcoded BUNDLED_DATE + disabled-store count were stale from PR #119).
- **Status:** done (PR #120, merged to main — CI green).

### 2026-06-26 — iOS OAuth plist + stores seed + Sentry/RevenueCat checklist
- **Asked:** Wire the iOS Google OAuth plist (already in project root); set visible stores for the initial DB seed to Costco (active) + Best Buy / The Source / Home Depot (Coming soon) in that order; help with RevenueCat paywall creation; note that Sentry DSN is configured in Expo, Azure OAuth created, ADMIN_USER_SUBS set on Railway, Google Play Console enrolled.
- **Decision/constraints:** iOS plist → added `iosUrlScheme` to `@react-native-google-signin/google-signin` plugin in `app.json` (reversed client ID from plist filename). Stores: reduced `backend/data/policies.json` AND `src/constants/stores.js` STORES array to only these 4 stores in requested order; `BUNDLED_UPDATED_AT` bumped to 2026-06-26 so the remote refresh always overrides the bundled list. Sentry DSN is already hardcoded in `config/profiles/common.js` so all builds have it; `SENTRY_DSN` as EAS secret overrides it if set. RevenueCat paywalls must be created in the RC dashboard (see instructions provided to Maxim).
- **Files/areas:** `app.json` (google-signin plugin), `backend/data/policies.json` (4-store seed), `src/constants/stores.js` (STORES array + BUNDLED_UPDATED_AT).
- **Status:** done (code changes). RC paywall creation = manual dashboard step.

### 2026-06-26 — RevenueCat integration + SubscriptionManager abstraction + PaywallScreen
- **Asked:** Integrate RevenueCat with a thin abstraction layer so the codebase never calls
  `Purchases.something()` directly. Wrap all SDK calls in `subscriptionManager.js`
  (interface: `initialize`, `login`, `logout`, `getCustomerInfo`, `getOfferings`,
  `purchasePackage`, `restorePurchases`). Ship a `PaywallScreen.js` navigation screen.
- **Decision/constraints:** `purchaseService.js` already had all the RC logic but called
  `react-native-purchases` directly via `_getPurchasesModule()`. Extracted all SDK calls into
  `src/services/subscriptionManager.js` (only file that imports `react-native-purchases`).
  `purchaseService.js` public API unchanged — screens are unaffected. `src/components/Paywall.js`
  already existed and is complete; `PaywallScreen.js` wraps it as a navigation-accessible screen.
  Existing `purchaseService.test.js` updated to mock `subscriptionManager` instead of the RC SDK.
  `react-native-purchases` npm package installed; Expo plugin added to `app.json`.
- **Files/areas:** `src/services/subscriptionManager.js` (new), `src/services/purchaseService.js`,
  `App.js`, `app.json`, `package.json`, `src/screens/PaywallScreen.js` (new),
  `__tests__/subscriptionManager.test.js` (new), `__tests__/paywallScreen.smoke.test.js` (new),
  `__tests__/purchaseService.test.js` (mock update).
- **Status:** done (PR #115 merged; follow-up PR #118 — 'Priceback Pro' entitlement key + test API key).

### 2026-06-26 — Price-drop detection: window overlap + flyer-authoritative source priority + immediate refresh
- **Asked:** Rework verified price-drop detection so (1) a comparison price applies
  to a receipt when its validity window overlaps the purchase's policy window
  `[purchase_date, purchase_date + policy_days]` (Costco 30 d), anchored on the
  **purchase date, not today** — so a sale that ran in the **past or present** still
  counts (`ISNULL(valid_from/valid_to, now)` null-handling); (2) **flyers are
  authoritative** — when prices differ across sources, use the highest-priority tier
  present: flyer (`source_type_id` 1,4) > price tag (5) > receipt (2), lowest within
  the tier, never falling through to a cheaper lower-tier price; always `verified=true`;
  (3) a drop is detected **immediately** on the in-app "Refresh prices" button without
  changing the scheduled-sweep cadence.
- **Decision/constraints (confirmed via AskUserQuestion):** Q1 → overlap-within-policy-
  window (not "valid only at purchase instant"); Q2 → strict flyer-authoritative (a
  non-dropping flyer price suppresses the line even if a cheaper tag/receipt exists).
  No DB migration — `valid_from`/`valid_until`/`verified`/`source_type_id` already exist.
  Source ids: 1 flyer, 2 receipt_ocr, 3 barcode_scan, 4 flyer_user_scan, 5 price_tag_scan,
  7 manual (ranked last). Freshness relaxed so already-verified/admin/flyer rows count
  regardless of age (past-window detection); unverified crowd rows still bounded by
  `PRICE_VERIFY_WINDOW_DAYS` for the rule-of-N. Open item: removing the
  `purchase+W >= today` gate means an *expired*-window receipt can notify once (per
  "detect in the past"); dedupe ledger caps blast radius — flagged for Maxim.
- **Files/areas:** `backend/repos/priceDropRepo.js` (`findNotifiable` rewrite: source_rank
  tiers, per-receipt window overlap, tier-best DISTINCT ON, optional `userSub` scope;
  `getLatestVerifiedPrice` flyer-authoritative ORDER BY), `backend/priceDropNotifier.js`
  (`runVerifiedDropSweep` `userSub` pass-through + own in-flight key),
  `backend/server.js` (new `POST /api/me/check-drops`), `src/services/priceService.js`
  (`triggerDropCheck`), `src/screens/DetailScreen.js` (refresh calls it). Tests on both
  runners; `docs/Bugs_Common_Fixes.md`. Updates [[price-drop-commission-and-policy-status]]
  / [[verified-price-drop-notifications]] / [[flyer_primary_pricing_strategy]].
- **Status:** in-progress — code done; tests + DB verification pending.

### 2026-06-26 — Flyer parser: geometry-based tile segmentation (price-tag-grade accuracy)
- **Asked:** the flyer scan of one page in `__tests__/fixtures/Flyers/` was
  inaccurate — an item was detected "over" another and only 6 of 8 tiles found.
  Make it as accurate as the price-tag parser: divide the OCR **by item** into the
  tag structure (brand/product, SKU, regular, instant savings, final price, valid
  from/to). Ignore eco-fees; ignore "SAVE $N"-only tiles with no SKU/price for now
  and document that as a future optimization.
- **Decision/constraints:** root cause = the text parser paired item-numbers to
  price blocks by **document order**, which crosses columns on a multi-column page
  (Vision streams every tile's top half before the price halves). Fix: a NEW
  geometry path `parseFlyerWords(words)` in `flyerTextParser.js` that segments the
  page **spatially** using Vision word coordinates — exactly like the price-tag
  parser localises a tag. Columns from item-number x-positions; each tile = the
  column strip between vertical midpoints to the neighbouring SKUs; price = the
  first x-aligned, vertically-tight `was/-savings/promo` triplet (eco-fees & QC
  sub-prices can't satisfy alignment+equation → ignored); name = only the
  left-margin-aligned lines above the SKU (decorative product-photo captions
  excluded; SKU digits stripped). Guards: SKU suffix `1978560-5` → `1978560`
  (else its price leaks into a neighbour); drop a tile when `regular > promo×2.5`
  (>60% off = OCR-mangled column on a degraded screenshot). Geometry is PRIMARY;
  the flat-text `parseFlyerText` stays as the fallback when a response has no word
  geometry. `lib/visionOcr.js` gained `visionDataToWords` (normalises image pixel
  vertices / passes PDF normalizedVertices, pages offset 1e6); `flyerScanService
  .extractViaVision` uses geometry first (`source:"vision-ocr-geometry"`), text
  fallback (`"vision-ocr"`). On the frozen fixture: 43 clean offers (was 42 with
  cross-contamination), all known prices/dates exact, 0 phantom SKUs, max
  regular/promo 1.39×, ~98% named.
- **Future optimization (documented):** "SAVE $N"-only banner tiles with no SKU
  and no price block are intentionally skipped for now → `docs/FUTURE_ROADMAP.md`.
- **Files/areas:** `backend/services/flyerTextParser.js` (+`parseFlyerWords` &
  helpers), `backend/lib/visionOcr.js` (+`visionDataToWords`),
  `backend/services/flyerScanService.js`, tests `flyerTextParser.test.js`,
  `visionOcr.test.js`, `flyerScanService.test.js`; `docs/Bugs_Common_Fixes.md`
  #56, `docs/FUTURE_ROADMAP.md`. No migration. Updates [[flyer-scan-multipage-national]].
- **Status:** done — flyer/vision suites green (visionDataToWords fully
  branch-covered); the 7 concurrent-run failures are the known environmental DB
  contention (pass when run serially/alone). Commit/PR owed.

### 2026-06-26 — Barcode purchase-history: show ALL purchases + missing i18n label + standing rule
- **Asked:** scanned-barcode "Your purchase history" sometimes shows nothing (no
  clear pattern); when it does, only the latest purchase shows, not all; the
  history label isn't in i18n.js. Plus a standing rule: never deliver a feature
  whose labels aren't implemented.
- **Decision/constraints:** "latest only" = the repo's 90-day window silently
  dropped older buys → made `priceHistoryForUserProduct` all-time by default
  (`sinceDays=null`; window only applied when a positive number is passed).
  Added `barcode.yourHistory` to EN+FR i18n and dropped the inline fallback.
  The pattern-less "no history" is fundamentally barcode-link coverage: history
  joins on `products.id`, so it only resolves when the scanned UPC is linked to
  the SKU product ([[barcode-sku-linking]]) — not a code bug, a data-coverage
  limit. New standing rule saved → [[no-unimplemented-labels]].
- **Files/areas:** `backend/repos/receiptsRepo.js` (priceHistoryForUserProduct),
  `src/services/i18n.js`, `src/screens/BarcodeScanScreen.js`,
  `backend/tests/priceHistoryDb.test.js`.
- **Status:** done — backend price-history DB test 5/5 green (DEV Supabase);
  mobile i18n parity + screens smoke green. Commit/PR owed.

### 2026-06-26 — Flyer geometry parser + per-user drop check + price-history fix
- **Asked:** Commit and merge all local changes on feat/flyer-geometry-parser branch to main, CI must pass.
- **Decision/constraints:** All changes were already authored on the branch; commit everything, open PR, merge when CI green.
- **Files/areas:** `backend/services/flyerTextParser.js` (geometry parser), `backend/lib/visionOcr.js` (word extraction), `backend/repos/priceDropRepo.js` (validity-window + tier-priority logic), `backend/priceDropNotifier.js`, `backend/server.js` (POST /api/me/check-drops), `backend/repos/receiptsRepo.js` (remove 90-day cap), `backend/services/flyerScanService.js`, `src/screens/DetailScreen.js`, `src/services/priceService.js` (triggerDropCheck), `src/screens/BarcodeScanScreen.js`, `src/services/i18n.js`, tests throughout, docs.
- **Status:** in-progress.

### 2026-06-26 — Update docs/PUBLISH_CHECKLIST.md
- **Asked:** Update the publish checklist with recent changes, add a top-level summary, enable checkboxes, update links based on priceback.ca, and add Azure app_registration requirements.
- **Decision/constraints:** priceback.ca is live on Cloudflare Pages (Priceback-Website repo). Legal pages committed there. Neon retired — Publish_Requirements.md had stale Neon refs. Don't touch app code.
- **Files/areas:** `docs/PUBLISH_CHECKLIST.md`, `docs/Publish_Requirements.md`.
- **Status:** done.

### 2026-06-25 — OCR + parse the two photographed refund receipts (Refunds/ fixtures)
- **Asked:** generate the OCR for the 2 receipts in `__tests__/fixtures/Refunds/`
  and run the tests so they parse correctly; fix any failures.
- **Capture:** `__tests__/fixtures/Refunds/` is a committed fixture location
  (already in `.gitignore`, images excluded / `.vision.json` committed) but the
  capture script + realocr test only walked `fixtures/receipts/`. Wired the
  `Refunds/` tree into both (`scripts/captureReceiptOcr.js` `FIXTURE_DIRS`;
  `costcoReceiptParser.realocr.test.js` `FIXTURE_DIRS`). Ran
  `node --use-system-ca scripts/captureReceiptOcr.js` — `--use-system-ca` is
  REQUIRED here: the AVG antivirus TLS-intercepting proxy makes Node reject
  Vision's cert unless it trusts the Windows CA store (plain `node` → "unable to
  verify the first certificate"). This is the fix for the long-standing "capture
  fails from this env" note.
- **Parser bugs the photos exposed (all fixed):** these in-club refunds differ
  from the website-PDF refunds (G-1/2/3): (1) they carry a "REFUND / MEMBERSHIP"
  register header the PDF omits; (2) their reversed coupons / VOID reversals print
  POSITIVE ("5.00 H", "13.99 H") so `countPurchaseLines()` > 0 and the old gate
  fell through to the warehouse parser → garbage positive items. Fixes:
  `isRefundHeader()` routes by the header alone (definitive; a purchase never has
  it); `isRefundReceipt` now also catches French "MONTANT …-"; `refundToPurchaseText`
  mirrors a post-VOID positive reversal into a NEGATIVE cancellation; the
  CPN/TPD handler tolerates slashed/spaced refs ("706359 CPN / E / RETUNR 5.00-");
  `extractItems` handles a single-line VOID cancellation (geometry keeps the
  voided line whole); `cleanItemName` strips the orphan "ITEM #" label the PII
  scrub leaves behind. The realocr refund matcher now finds an item by name when
  the SKU was scrubbed/voided away.
- **Files/areas:** `scripts/captureReceiptOcr.js`, `src/services/costcoReceiptParser.js`
  (isRefundHeader, gate, CPN regex), `src/services/receiptParsingShared.js`
  (refundToPurchaseText VOID mirror, extractItems single-line VOID, cleanItemName
  ITEM# strip). Tests: `costcoReceiptParser.test.js`, `receiptParsingShared.test.js`,
  `costcoReceiptParser.realocr.test.js` (+ 2 new committed `.vision.json` fixtures).
- **Verification:** receipt 1 (`PXL_20260624_012641537…`) → 2 items, SPORTING
  -14.99/-19.99 (CPN netted), PHARMACY -10.99/-13.99 (VOID + CPN netted), total
  -29.36, tax -3.38, reconciles. receipt 2 (`PXL_20260624_015845488`) → COOLER
  -15.49 + WOMENS FRAG -179.98 (×2, sku 1891652), total -218.87, tax -23.40.
  Full mobile suite **1748 pass**; coverage 64.17/51.35/53.98/66.06 (≥ floors
  61/46/52/63); both parser files ≥91% stmts.
- **Status:** done — branch `fix/refund-receipt-full-ruleset` (continues the
  refund-ruleset work below).

### 2026-06-25 — Refund receipts reuse the full normal-receipt ruleset (negated)
- **Asked:** Refunds still parse badly — the same bugs as normal receipts (payment-
  summary lines like "APPROUVE"/"AMOUNT" logged as items, "N @ unit" / column-split
  lines mishandled, wrapped names). Make refunds run EVERY rule of the standard
  Costco receipt (same logic + excluded keywords), the only difference being the
  values are sign-inverted. Real refund fixtures live at
  `__tests__/fixtures/receipts/Costco Receipts PDF/G-{1,2,3}-Refund.vision.json`.
- **Root cause:** the Costco refund branch called `parseRefundReceipt` → the bare
  GENERIC `parseReceiptEngine` (no geometry, no column-split reshape, no TPD
  handling). A refund is the exact sign-mirror of a purchase, so it needs the
  warehouse parser, not the dumb engine.
- **Fix:** `refundToPurchaseText()` normalizes a refund into purchase-shaped text
  (strip the trailing minus off returned products/summaries; ADD a trailing minus
  to the POSITIVE TPD/CPN reversal amounts so the discount handler nets them).
  `parseRefundReceipt(rawText, { parse })` now takes an injected parser; the Costco
  branch passes `parseCostcoWarehouseReceipt(raw, annotation, { preprocess:
  refundToPurchaseText })` (new `preprocess` hook applies to BOTH geometry rows and
  flat text). Result is parsed with the full ruleset, then every amount negated.
  Normal receipts are byte-identical (preprocess defaults to identity).
  Also fixed a shared `extractTax` bug exposed by a zero-tax refund: an explicit
  `TAX 0.00` line used to borrow the TOTAL beneath it as the tax (doubling the
  computed total) — a printed 0.00 is now authoritative.
- **Files/areas:** `src/services/receiptParsingShared.js` (refundToPurchaseText,
  parseRefundReceipt, extractTax), `src/services/costcoReceiptParser.js`
  (preprocess hook + refund branch). Tests: `receiptParsingShared.test.js`,
  `costcoReceiptParser.test.js`, `costcoReceiptParser.realocr.test.js` (pinned
  ground truth for G-1/2/3 refunds incl. TPD-reversal netting on G-3).
- **Verification:** G-3 now extracts ENTRANCE MAT -9.99 (TPD reversal applied),
  SHOE STORAGE -34.99, deposit ignored, reconciles to -148.17; G-2 -218.87; G-1
  pure reversal -3.50. Full mobile suite **1737 pass**, coverage 64.2/51.3/54.01/
  66.07 (≥ floors 61/46/52/63).
- **Status:** done — branch `fix/refund-receipt-full-ruleset`.

### 2026-06-25 — Credit-pack grant showed/granted the OLD amount (250 → 300)
- **Asked:** A real in-app purchase of the Starter pack (250 cr / $3) granted 300;
  same for every pack. Fix it.
- **Diagnosis (no code change):** the grant is server-authoritative from
  `configService.getDerivedMaps().ALL_PACKS`, an in-memory snapshot warmed from the
  DB. Two stale layers served the old 300 after the catalog was lowered to 250: the
  backend warm cache (re-warms every 5 min via `startAutoRefresh`) and the mobile
  `pricing.json` cache (refreshes next launch). Maxim had corrected the DB row by
  hand; the app caught up on the next 5-min refresh tick → resolved itself. Per
  Maxim, skip the code change.
- **Latent (documented, deferred):** `seedCreditPacks` upserts credits with
  `coalesce(existing, excluded)`, so re-seeding can NEVER correct a stale non-null
  `credits`/`price` from the catalog — PROD likely still holds 300. Switch the
  upsert `set` to `excluded.*` (catalog-authoritative) when prod is next touched.
- **Files/areas:** none changed; documented in `docs/Bugs_Common_Fixes.md` #53.
- **Status:** done (documented; per Maxim, no code change).

### 2026-06-25 — Sync credit pack seed descriptions to dev DB
- **Asked:** Update the pricing.config.js seed for credit packs to match current values in the dev Supabase DB.
- **Decision/constraints:** DB had slightly higher dollar estimates ($17/$34/$74 vs $16/$33/$73) and a typo "aroud" — synced the descriptions and fixed the typo; credits and prices unchanged.
- **Files/areas:** `shared/pricing.config.js`, `backend/shared/pricing.config.js`.
- **Status:** done

### 2026-06-25 — Author docs/database-schema.md
- **Asked:** create `docs/database-schema.md` describing every table, function, and column plus the
  relations (credit management, user management, etc.).
- **Decision/constraints:** documentation only, no schema changes. Sourced from the canonical
  `backend/db/deploy/schema.sql` (migrations 0000→0011) + lookup-table seed values in
  `backend/db/seed.js`. Header anchors the doc back to `schema.sql` as source of truth and notes the
  `build-consolidated-schema.js` regenerate command.
- **Files/areas:** `docs/database-schema.md` (new).
- **Status:** done.

### 2026-06-25 — Fix main CI red (EMAXCONNSESSION) + coverage-buffer initiative
- **Asked:** main's GitHub workflow is failing. If it's coverage-related, add a standing rule to
  always ship full-coverage tests for every feature/bug fix; and optimize the suites NOW so coverage
  always exceeds the CI minimums with a good buffer for all future builds.
- **Diagnosis:** the failure was NOT coverage — 8 DB-gated backend tests failed together on
  `(EMAXCONNSESSION) max clients reached … pool_size: 15` (shared Supabase dev session pooler, 15-conn
  cap shared with the always-on dev backend + any local dev). Coverage actually PASSED but with a
  razor-thin buffer (backend 89.28 vs 89 floor). See Bugs_Common_Fixes #52.
- **Decision/constraints:** fix the real failure durably (don't lower `DB_POOL_MAX`, don't touch prod);
  add the standing rule; lift measured coverage to bank a real buffer WITHOUT raising floors (raising
  floors would consume the buffer — the old just-below-measured practice is what kept builds chronically
  ~0.3% from red). Backend coverage must not regress the thin branch floor (73) — heeded the documented
  "branch paradox" by hitting BOTH sides of every constructed branch.
- **Changes:**
  - `backend/db/client.js`: `seedWithRetry` defaults 4×750 ms → **6×1000 ms (≈15 s)** to ride out
    transient pooler saturation (the first DB touch is where it bites).
  - Backend coverage: new `backend/tests/configServiceWarm.test.js` covers `configService.warm()` +
    the catalog-derivation helpers via injected fake repos with constructed both-sides rows
    (`warm()` gained an optional `deps` param, prod path unchanged) → configService.js 56.75% → 99.7%;
    plus new `getOpsConfig` string-env + `getAdminSubs` cases in `configService.test.js`. Backend now
    **90.68 / 74.28 / 92.67 / 90.68** (branches rose, not fell). Updated the deferral note in
    `catalogConfigDb.test.js`.
  - Mobile coverage: new render-smoke tests `__tests__/detailScreen.smoke.test.js` (90-fn screen) and
    `__tests__/emailSyncScreen.smoke.test.js` → mobile **64.04 / 51.15 / 53.93 / 65.94** (functions
    buffer 0.69 → ~1.9). Floors left as-is to bank the buffer.
  - Standing rule saved to memory `full-coverage-tests-every-change` + the "don't hug the floor" policy.
- **Verification:** full backend `npm run test:coverage` (serial) — all pass + thresholds exceeded
  (one transient bootstrap 503 during the local run passed on isolated re-run); full mobile jest
  coverage 1726 pass, thresholds exceeded.
- **Status:** done — branch `fix/ci-emaxconnsession-coverage-buffer` (PR pending/merge).

### 2026-06-25 — Ignored fee-items · full notification wiring · DB-backed savings · deferred referral
- **Asked:** Four improvements. (1) Add an "ignored products" concept: fee-like line items
  (bottle deposits, environmental/eco fees, environmental tax, recycling) stay VISIBLE on the
  receipt but are NOT price-tracked (no `price_points`) and NOT watched. (2) Wire ALL the
  notification categories so they actually fire per the user's saved prefs (prefs already persist
  in the DB for device-change recovery). (3) Annual/total savings must be recovered from the user's
  claim history in the DB (updated on every claim) so it survives reinstall. (4) Referral credit
  granted to BOTH referrer and referee only AFTER the new user makes their first credit-pack OR
  subscription purchase (currently paid immediately at signup redemption).
- **Decision/constraints:** (1) Detection = keyword auto-detect (EN+FR) PLUS a manual per-line
  toggle in the Scan review screen; new `receipt_items.ignored` boolean (migration 0011); mirror
  the existing `isRefund` gate in `receiptsRepo.create` (upsert product only, no price_points,
  `watch_enabled=false`). (2) Wire EVERYTHING incl. the daily digest (digest = server cron reusing
  the scheduled-checks/`buildNotifGate` infra; event senders gated by `categoryEnabled` /
  `buildNotifGate`, fail-open). (3) Read-time DB aggregate (`SUM(claimed_savings)` WHERE
  `claimed_at IS NOT NULL AND deleted_at IS NULL`) served in `/api/me/bootstrap`; mobile `getStats`
  prefers it, falls back to the local sum — NO migration (column already written on every claim).
  (4) `redeem()` records the edge but pays nothing (NULL ledger ids = pending); new idempotent
  `settleReferralOnFirstPurchase` hooked into `creditsRepo.recordTopupOnce` (credit pack) and the
  RevenueCat webhook (subscription); the `referee_reward_ledger_id IS NULL` guard fires it exactly
  once across either path. No schema change for referral (ledger-id columns already nullable).
- **Files/areas:** `backend/db/{schema.js,migrations/0011_*,deploy/schema.sql}`,
  `backend/repos/{receiptsRepo,pricesRepo,referralsRepo,creditsRepo}.js`, `backend/server.js`,
  `backend/priceDropNotifier.js`, `src/services/{receiptParsingShared,costcoReceiptParser,
  receiptParser,receiptSyncService,notificationService,syncService,storageService}.js`,
  `src/screens/ScanScreen.js`, `src/services/i18n.js`, tests on both runners.
- **Verification:** Backend `test:coverage` (serial, DB_POOL_MAX=3, Supabase dev) **727 pass /
  0 fail**, c8 89.61/73.41/90.78/89.61 (≥ floor 89/73/89/89). Mobile **1722 pass**, coverage
  62.81/49.65/52.69/64.55 (≥ floor 61/46/52/63). Migration 0011 applied to DEV; consolidated
  `schema.sql` regenerated (12 migrations). New tests: `savingsSummaryDb`, ignored-item case in
  `receiptPricePoints`, deferred-payout + settle + race rewrite of `referralsRepoDb`/`Edges`,
  `isIgnoredItemName` + `stampIgnoredItems` + `toApiBody ignored` + `getStats` server-savings, plus
  the drop-charge push assertion in `priceDropPipelineE2E`. notifOtherCredit has no concrete event
  yet (monthly_grant unimplemented) — documented as the ready catch-all.
- **Status:** done (code + tests, both runners green) — branch `feat/ignored-items-notif-savings-referral`; PR pending. PROD owes migration 0011.

### 2026-06-25 — Flyer parser optimization against the real Vision fixture
- **Asked:** Maxim ran `npm run capture:flyers`, producing the frozen OCR fixture
  `__tests__/fixtures/Flyers/Flyers-June-2026.vision.json`. Use it to write unit tests
  and optimize the flyer OCR treatment if needed. (Don't read the source PDF.)
- **What the real OCR exposed (and the fixes):** The original text-flow parser produced
  garbage on the real fixture — 55 "offers" with wrong prices (eco-fees/QC/model numbers
  read as prices, e.g. promo 5813.74), phantom 4–5 digit SKUs, mostly-null/garbage names,
  and ONE wrong global date. Rebuilt `flyerTextParser.js` around what the fixture showed:
  (1) **per-tile dates** — the PDF stacks multiple flyer SECTIONS (May 11–Jun 7 ×20,
  May 25–Jun 7 ×13, Jun 22–Jul 5, Jun 8–Jul 5); each tile reprints its own "Valid…" line.
  The old single-window even picked a date out of Michelin warranty fine print. Per-tile
  dates now snap to the canonical (repeated) window to correct OCR year typos ("2028"→2026),
  matching BOTH month/days (two sections share the Jul 5 end). (2) **Document-order SKU↔price
  pairing** — on a multi-column page the price block lags its SKU by one tile, so the k-th
  price block pairs with the k-th item number (two-pointer), not by text proximity.
  (3) **Self-validating price triplet** (was − savings ≈ promo) as the anchor → eco-fees/QC
  sub-prices/legal numbers can't be read as a price. (4) **6–8 digit SKU floor** (flyer item
  numbers; the tag parser's 4-digit floor invented phantoms here). (5) **Name+size read from
  the lines ABOVE the item number** (the real flyer layout), falling back to below for
  contiguous tag-style blocks.
- **Decision/constraints:** All fixes are TEXT-only, so they flow into the live pipeline
  automatically (`flyerScanService.extractViaVision` → `parseFlyerText(text)`, unchanged);
  no geometry plumbing, no DB migration, Gemini fallback untouched. Result on the real
  fixture: **42 clean offers, 0 dropped, every triplet's math checks out, real product names
  ("Dyson Supersonic hair dryer with display stand", "Monster Ultra Zero…"), correct
  per-section dates, zero phantom SKUs.**
- **Files/areas:** `backend/services/flyerTextParser.js` (rewrite; new exports
  `collectDateWindows`), `backend/tests/flyerTextParser.test.js` (10 new tests + an enriched
  real-OCR regression asserting concrete known offers/dates and absent phantoms),
  `__tests__/fixtures/Flyers/Flyers-June-2026.vision.json` (NEW — must be committed so CI runs
  the real-OCR block; it's skip-if-absent).
- **Verification:** `flyerTextParser.test.js` 17/17 pass, `flyerScanService.test.js` 10/10
  pass; c8 on the parser = 99.57% stmts / 87.37% branch / 100% funcs (well above the ratchet).
- **Status:** done (code + tests). Not committed — awaiting Maxim's go-ahead (feature branch).

### 2026-06-25 — Barcode price-history + flyer OCR parser rebuild
- **Asked:** Three fixes. (1) Barcode scan: product image was missing when a price was
  found; also show the user's OWN last-known price(s) from their receipt history (last
  90 days, with dates) under the current price. (2) Flyer scan extracted ZERO offers.
  (3) Imported/scanned flyers stored NULL valid-from/valid-to. Flyers must use a NEW
  parser with the EXACT same logic as the price-tag parser (Vision OCR → deterministic
  parse), the only difference being the flyer's original valid-from date range. Use the
  PDFs in `__tests__/fixtures/Flyers/` as OCR test input (send to OCR, don't hand-parse).
- **Decision/constraints:** New flyer parser runs **server-side** (swapped into
  `flyerScanService`), with **Gemini kept as a fallback** when OCR yields zero offers
  (both confirmed by Maxim). Flyer's printed `valid_from`/`valid_until` are now persisted
  to `price_points` and `activeFlyerOffers` became a date-range query (flyer rows only —
  receipt/tag writes keep the rule-6 Monday `valid_from`). Barcode image is fetched from
  the external catalog (Open Food Facts/UPCItemDB) even on a price hit; history is a new
  authenticated `GET /api/me/price-history`. No DB migration (date columns already exist).
- **Files/areas:** `backend/services/flyerTextParser.js` (NEW), `backend/lib/visionOcr.js`
  (NEW), `backend/services/flyerScanService.js`, `backend/server.js`, `backend/repos/
  {pricesRepo,receiptsRepo}.js`, `src/services/{barcodeLookup,priceService}.js`,
  `src/screens/BarcodeScanScreen.js`, `scripts/captureFlyerOcr.js` (NEW) + `capture:flyers`,
  tests on both runners (`flyerTextParser`, `flyerScanService`, `visionOcr`,
  `flyerDatePersistenceDb`, `priceHistoryDb`, `barcodeLookup`, `priceServiceNetwork`).
- **Verification:** Backend no-DB 524 pass / 0 fail; DB-gated 99 pass / 0 fail (Supabase
  **dev**); c8 ratchet held (89.91/73.71/91.04/89.91; `visionOcr.js` 100%). Mobile 1714
  pass, coverage floors met. The deterministic flyer parser is validated against synthetic
  fixtures now + a guarded real-OCR regression that activates once Maxim runs
  `npm run capture:flyers` (TLS-intercepting proxy blocks the capture from this env).
- **Status:** in-progress — branch `feat/flyer-ocr-parser-barcode-history`; PR pending.

### 2026-06-23 — Receipt-scan accuracy fixes (4 bugs)
- **Asked:** Fix four receipt-scan bugs: (1) "Add item" button must be the last line
  in both Scan-confirm and Detail; (2) refund receipts parsed as positive — accept the
  refund and log every amount as NEGATIVE, non-trackable (Maxim chose accept+negative
  over reject); (3) tax can exceed subtotal — cap at the province's combined tax rate ×
  subtotal (QC ≈15%, ON 13%, …); (4) add an always-on deterministic validator that makes
  the receipt internally consistent before display (auto-fix silently, Maxim's choice).
- **Decision/constraints:** Refunds skip crowdsourced `price_points` (no negative prices
  in the verified-price/crowdsource data) — gate on an `isRefund` payload flag, NO DB
  migration (no `is_refund` column; refund is re-derivable from negative total). ScanScreen
  save filter must allow negative line items for refunds. Validator is pure/sync +
  unit-testable; reuses `reconcileTotalsLocally`. Province resolved warehouse→prefs→max-rate.
- **Files/areas:** `src/services/receiptValidator.js` (NEW), `receiptParsingShared.js`,
  `ocrService.js`, `costcoReceiptParser.js`, `receiptParser.js`, `storageService.js`,
  `receiptSyncService.js`, `src/screens/ScanScreen.js`, `backend/repos/receiptsRepo.js`,
  `backend/server.js`, tests on both runners.
- **DB verification (2026-06-24):** Ran the DB-gated backend suite against the Supabase
  **dev** project (`gnedluuylimjwdmtvswl`, 5432 session pooler) via
  `node --env-file=.env --test --test-concurrency=1 tests/*.test.js` (serial + `DB_POOL_MAX=3`
  to stay under the pooler's 15-conn ceiling — concurrency 4 hits `EMAXCONNSESSION`). The new
  `receiptPricePoints.test.js` "refund records NO price points" case caught a real **500**:
  `receipt_items.product_id` is NOT NULL, so the refund path must still `upsertProduct` per
  line (products only, no price_points). Fixed in `receiptsRepo.create`. Final: backend
  **689 pass / 0 fail / 1 skip**, coverage 89.64/73.66/90.61/89.64 (ratchet held); mobile
  **1709 pass**, `receiptValidator.js` 97.29%. No DB migration (refund derivable from sign).
- **Status:** done — see PR (below) / commit. Branch `fix/receipt-scan-accuracy-refund-tax-validator`.

### 2026-06-23 — Establish the Task Log workflow
- **Asked:** Document every task in an md file that must be checked before coding,
  so past requests aren't accidentally rolled back — instead of relying on
  wrapup/recall each session.
- **Decision/constraints:** This file (`docs/Task_Log.md`) is the record. Checking
  it before coding and appending after each task request is a standing step.
- **Files/areas:** `docs/Task_Log.md`, memory `task-log-before-coding`.
- **Status:** done.

### 2026-07-01 — Price-drop regression: receipt's own discounts detected as drops
- **Asked:** Fix refresh-prices/price-drop detection detecting the scanned receipt's own
  instant discounts as drops ("claim $4.00", "−0%" savings). Drops must be based on tracked
  receipt lines but EXCLUDE discounts already on the receipt — only price changes not in the
  receipt count. Regression vs earlier behavior.
- **Decision/constraints (AskUserQuestion):** exclusion scope = same receipt only — the same
  user's LATER cheaper purchase of the same product (2nd receipt) MUST still trigger a drop
  on an earlier full-price line, within the store policy window (store-configured
  `policy_window`/`adjustment_days`, no hardcodes). Timing = only-after-purchase: a price
  already available on/before the purchase date (incl. flyer sales running at checkout) is
  never a drop — deliberately reverts 984c3ad's at-purchase/past-sale overlap semantics.
- **Implementation:** `findNotifiable` now requires SOME observation of the verified price
  to have become available strictly AFTER the purchase date and ≤ purchase+policy window
  (availability = flyer printed valid_from; observed_at::date for point sources). Mobile:
  strictly-positive-savings guard in DetailScreen (removed the promoActive-only drop path),
  HomeScreen alert/tracked rows. No DB migration.
- **Files/areas:** `backend/repos/priceDropRepo.js`, `src/screens/{DetailScreen,HomeScreen}.js`,
  `backend/tests/{priceDropWindowSourceDb,priceDropDb}.test.js` (self-receipt regression
  suite; flyer fixtures must pass printed validFrom/validUntil),
  `__tests__/{detailScreen.smoke,screensSmoke}.test.js`, `docs/priceDrop.md`,
  `docs/Bugs_Common_Fixes.md` #64.
- **Status:** done — branch `fix/price-drop-self-receipt-discounts`, PR pending.

### 2026-07-02 — OCR cleanup: pre-scanned banner in item names, Member label, warehouse header in OCR panel
- **Asked:** (persistent bug from last session's cleanup ask) 1) the
  `***START OF PRE-SCANNED ITEMS***` sentence (or a fragment) still appears in
  item names on some scans even though the OCR panel looks clean — the parser
  must see fully cleaned input; 2) the keyword "Member" must leave the OCR
  text; 3) warehouse info (store name, warehouse #, address, …) should be
  extracted (GET) first and then stripped — the displayed OCR should be items
  and item-related info only.
- **Decision/constraints:** banner scrub is inline + tokenization-tolerant and
  runs before the keep list; membership label line removed whole (ID still
  extracted; priced MEMBERSHIP lines + refund header survive); warehouse info
  = GET-then-strip (parse first, then `stripWarehouseInfo` on `rawText` — never
  pre-parse, store detection needs the header); amount-bearing lines are never
  stripped. Bonus root-cause fix: engine's 2-line NAME→PRICE pairing no longer
  pairs a name with a discount amount (phantom "GLOUCESTER, ON K1J 1A5" item).
- **Files/areas:** `shared/ocrCleanup.js` (+ synced `backend/shared/`),
  `src/services/receiptParser.js` (strip + name scrub in stampIgnoredItems),
  `src/services/receiptParsingShared.js` (pairing guard),
  `__tests__/{ocrCleanup,receiptParserScan,costcoReceiptParser.realocr}.test.js`
  (banner tokenization cases, stripWarehouseInfo suite, pinned expectations for
  PXL_20260702_022107026 + PXL_20260702_022131546), `docs/Bugs_Common_Fixes.md`
  #67.
- **Status:** done — branch `fix/ocr-prescanned-member-warehouse-cleanup`, PR pending.

### 2026-07-03 — `warehouse_id` still null after save (receipt r_1783092798869_2xoa1)
- **Asked:** dev receipt `r_1783092798869_2xoa1` had a null `warehouse_id`
  column and the list still showed "Costco Canada" instead of the warehouse.
- **Root cause:** queried the dev DB row directly — `raw_ocr` still had
  "Kanata\n#541" un-stripped. `extractWarehouseId`'s city+number pattern
  required ALL-CAPS; Vision's geometry reconstruction had welded the
  Title-Case "Kanata" line and the "#541" line into one row, which matched
  neither the ALL-CAPS pattern nor the standalone-newline fallback.
- **Fix:** added a case-insensitive city+number pattern (guarded against
  `Item #NNNNNNN` SKU lines) to `extractWarehouseId`.
- **Files/areas:** `src/services/receiptParsingShared.js`,
  `__tests__/receiptParsingShared.test.js`, `docs/Bugs_Common_Fixes.md` #70.
- **Status:** done, uncommitted — not yet on a feature branch.

### 2026-07-05 — Android package rename broke config + `DEVELOPER_ERROR` sign-in
- **Asked:** package `ca.priceback.app` → `com.priceback` in Play Console + GCP
  credential rotation broke the config; Google Sign-In shows `DEVELOPER_ERROR`.
  Also: can Claude connect to Play Console / RevenueCat / GCP to set it up, in a
  way linked to the project so it works from any device (Maxim switches devices).
- **Root cause:** no Android OAuth client matches `com.priceback` + the Play App
  Signing SHA-1 (from the downloaded `deployment_cert.der`,
  SHA-1 `35:47:ED:80:…`); `google-services.json` still declared the old package.
- **Fix / deliverables:**
  - `google-services.json` `package_name` → `com.priceback` (unblocks Android build).
  - `scripts/configure-google-signin.mjs` — device-independent: reads a GCP
    service-account key from EAS env (`GOOGLE_CONFIG_SA_JSON`), ensures the
    Firebase Android app, registers the Play SHA-1 (auto-provisions the Sign-In
    OAuth client — the DEVELOPER_ERROR fix), rewrites `google-services.json`,
    prints the new `googleClientIdAndroid`. Idempotent, `--dry-run` supported.
  - `docs/Signin_Config_Recovery.md` — full runbook (one-time SA bootstrap →
    store key in EAS → run from any device; RevenueCat left as 2-min dashboard
    step since RC's API can't repoint a Play app / upload Play creds).
  - `.gitignore`: added `sa.json`, `*.der` (never commit the cert/key).
  - `docs/Bugs_Common_Fixes.md` #74.
- **ACTUAL root cause + fix (via browser automation):** Firebase already had the
  `com.priceback` app + Play SHA-1 + matching Android OAuth client (`…6ap3mab4…`
  = `googleClientIdAndroid`). The real break was the stale **`GOOGLE_SERVICES_JSON`
  EAS file-secret** (old `ca.priceback.app` config), which EAS injects per
  `app.config.js:82`. **FIXED:** replaced repo `google-services.json` with the
  correct 2-app config AND overwrote the **production** `GOOGLE_SERVICES_JSON`
  EAS secret (`eas env:update … --type file`, authorized by Maxim). Next
  `eas build --profile production` + Play release = working Google Sign-In.
- **Extended to ALL envs (2026-07-06):** created `GOOGLE_SERVICES_JSON` file-secret
  in **preview + development** too (prod already done). Registered all 3 signing
  SHA-1s on the Firebase `com.priceback` app via browser (each auto-provisions its
  Sign-In OAuth client): Play `35:47:ED:80…` (prod), EAS keystore
  `2D:43:BC:7F…D5:2B` (EAS dev/preview APKs), Expo default debug keystore
  `5E:8F:16:06…F6:25` (local `manual_build/build-and-install.ps1` — release+debug
  both sign with `android/app/debug.keystore`, SHA universal across machines).
  Updated `docs/PUBLISH_CHECKLIST.md` (§3b + stale bundle-ID refs → com.priceback).
- **Still owed:** RevenueCat dashboard — repoint Play app to `com.priceback` +
  re-upload Play service-account JSON (RC API can't do either).
- **Status:** sign-in fix DONE for prod + preview + dev + local builds. Repo edits
  uncommitted. Verify on each build type after next build.

---

## 2026-07-10 — Production scan "Scan failed: API error 502" (dead prod Vision key)

- **Ask:** fix the 502 "scan failed" on the production build (Google Console
  testing APK); solution expected in `docs/Bugs_Common_Fixes.md` (recurring).
- **Diagnosis:** reproduced by POSTing a tiny image to `/api/ocr` on both
  backends — **prod → 502** `{"error":"OCR service authentication failed…"}`,
  **dev → 200**. Per `server.js` ~L1409 that message = Google Vision **403**, so
  the production `GOOGLE_VISION_API_KEY` is invalid/unauthorized (revoked / wrong
  key / restricted / Vision API not enabled). Matches the long-pending "rotate
  Vision key" ops item. `/health` hid it — its `ocr` check is only an env-var
  presence flag ("configured"), not a real Vision call.
- **Real fix (OPS — owed by Maxim):** set a valid, unrestricted-for-Vision
  `GOOGLE_VISION_API_KEY` on the `priceback-production` Railway service.
- **Code shipped (this PR):**
  - Backend: admin-gated active probe `GET /health?probe=ocr` (`probeVisionAuth`)
    → `checks.ocr.probe` = ok/unauthorized/rate_limited/error/unreachable/missing,
    so a dead key is now detectable instead of reading "configured".
  - Mobile: `ocrService._visionFetch` maps backend 5xx → friendly tagged error
    (`code:"ocr_unavailable"`) → manual-entry fallback, not raw "API error 502".
  - Docs: `Bugs_Common_Fixes.md` #81. Tests: `backend/tests/visionAuthProbe.test.js`,
    `__tests__/ocrVisionPipeline.test.js` (5xx mapping).
- **Status:** code DONE + tested (mobile 246/246 OCR, backend probe 6/6),
  branched/PR'd/merged. **Prod scans stay broken until the Railway Vision key is
  replaced** — that's the operational remainder.

---

## 2026-07-10 — Email sync connect dead-ends (Gmail OAuth policy block + Outlook admin-approval)

- **Ask:** fix the bug in two screenshots — (1) Gmail connect → Google *"Access
  blocked: Authorization Error … Error 400: invalid_request"*; (2) Outlook connect
  with a CESI school account → Microsoft *"Need admin approval"* for the unverified
  Priceback app.
- **Diagnosis:** both live in `emailSyncService.js`. **Gmail** `connectGmail` still
  used `expo-auth-session` with a `priceback://` **custom URI scheme** — the flow
  Google now hard-blocks (the main sign-in was already migrated to native, this path
  was missed). **Outlook** `connectOutlook` used the `/common/` authority, which
  accepts work/school accounts; a locked-down tenant then forces admin consent the
  dev can't grant.
- **Fix (code):** Gmail → native `@react-native-google-signin` (Play Services,
  no redirect/scheme) requesting `gmail.readonly`; Outlook → `/common/` → `/consumers/`
  (personal Microsoft accounts, the actual audience). Tests in
  `__tests__/emailSyncConnect.test.js` pin both; `docs/Bugs_Common_Fixes.md` #83.
- **Caveat (OPS):** `gmail.readonly` is a Google sensitive scope — until the OAuth
  consent screen is verified, users see an "unverified app" warning (test users can
  proceed); full public Gmail sync also needs a backend code-exchange for a refresh
  token. Azure app registration must permit personal accounts for `/consumers/`.
- **Status:** code DONE + tested (emailSync 34/34, module coverage 88% stmts /
  90% lines). Uncommitted pending review.

---

## 2026-07-11 — job_runs table: cron status tracking + 6-month purge

- **Ask:** are the cron scripts configured and running — is there any trace/log
  of schedule runs and status? Then: add a `job_runs` table to track cron status,
  purged on a 6-month retention.
- **Findings:** cron jobs are `node-cron` schedules baked into `backend/server.js`
  (sweep, daily maintenance, daily digest, DB retention, monthly account purge) —
  not anything scheduled via this CLI's own cron system. Previously the only trace
  was ad-hoc `console.log`/`console.warn` lines in the Railway log stream; no
  persisted run history.
- **Fix:** new `priceback.job_runs` table (`db/schema.js`, migration
  `0001_numerous_imperial_guard.sql`) — one row per job run (`job_name`, `ok`
  boolean, `started_at`, `duration_ms`, `error`). New `repos/jobRunsRepo.js`
  (record/recent/pruneOlderThan). `server.js` gained a `trackJob(name, fn)`
  wrapper (exported as `__jobRuns` for tests) applied to every named cron job
  plus the price-sweep tick. Retention: `RETENTION_JOB_RUNS_DAYS` = 180 (6
  months), pruned daily by `jobs/pruneJobRuns.js`, wired into the existing
  `runDbRetentionJobs()`. Regenerated `db/deploy/schema.sql`.
- **Tests:** `tests/reposUnit.test.js` (jobRunsRepo), `tests/pruneJobs.test.js`
  (pruneJobRuns), `tests/jobRunsTracker.test.js` (trackJob success/failure).
  Full suite green (855/855, +6 new).
- **Note:** while regenerating the migration, `drizzle-kit generate` also
  reconciled `db/migrations/meta` with old migrations 0001–0009 that were
  already absent from the working tree locally (pre-existing, uncommitted —
  consistent with the earlier [[db-redesign-v2]] squash to `0000_initial`).
  Not committed; left for review before commit.
- **Status:** code + tests DONE, uncommitted. Migration not yet applied to any
  DB (dev or prod) — owed alongside other pending migrations.

**Update 2026-07-12:** migration applied to both DBs — dev (gnedluuylimjwdmtvswl)
and prod (xjfrlzwonyaorwktnkpj, via `railway run --service Priceback -e
production`). Applied the DDL directly (raw `CREATE TABLE/INDEX IF NOT
EXISTS`) rather than `drizzle-kit migrate`: both DBs' `drizzle.__drizzle_migrations`
tracking tables already hold rows with timestamps later than this migration's
(leftover from the earlier chain-squash), so `drizzle-kit migrate` silently
no-ops without creating the table or erroring — verified via direct column
introspection instead of trusting its "success" message. **Owed:** re-baseline
the `drizzle.__drizzle_migrations` tracking table on both DBs so future
`db:migrate` runs aren't silently skipped.

**Update 2026-07-12:** re-baselined `drizzle.__drizzle_migrations` on both dev
and prod to exactly the current 2-migration chain (`0000_initial`,
`0001_numerous_imperial_guard`) after verifying both DBs' live table sets
already matched `schema.js` (37/37 tables). `npx drizzle-kit migrate` now
correctly no-ops on dev instead of silently skipping.

---

## 2026-07-11 — R2 tag-scan photo retention (crowdsourced-pricing PIA open item)

- **Ask:** resolve the crowdsourced-pricing PIA's open action item — R2
  tag-scan photo retention wasn't time-boxed. Add a 30-day retention window.
- **Fix (code):** `RETENTION_TAG_PHOTOS_DAYS` (default 30, `config/defaults.js`)
  + `backend/jobs/pruneTagPhotos.js`, wired into the daily `runDbRetentionJobs()`
  maintenance cron alongside `pruneAuditLog`/`pruneSubEvents`. Deletes the R2
  object for any `tag_scan_reviews` row past the window and nulls
  `image_object_key`; the review row (raw OCR text, parsed fields, verify/reject
  decision) stays as the admin audit trail. New repo helpers
  `tagReviewsRepo.findImagesOlderThan` / `clearImageKey`.
- **Tests:** `tests/pruneJobs.test.js` — new `pruneTagPhotos` describe block
  (DAYS=30, deletes+clears on success, skips clearing on R2 delete failure,
  0-result no-op). 17/17 passing.
- **Docs:** `legal/pia/crowdsourced-pricing.md` §4/§8 marked resolved,
  `docs/PUBLISH_CHECKLIST.md` (both retention mentions) and
  `docs/Publish_Requirements.md` retention table updated.
- **Status:** code + tests DONE. Uncommitted pending review.
