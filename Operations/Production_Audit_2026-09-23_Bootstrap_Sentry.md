# Production audit — bootstrap failures & Sentry errors (2026-09-23)

**Asked (/goal):** *"run an audit on the priceback main branch, few problem appeared on bootstrap in
the last few days and also some errors on sentry. this is live production state. i need it to be
analyzed and fixed with solid solutions."*

**Scope: `main` at `56cf44b`** — the exact commit Railway production runs (deployment `9fa279c2`,
created 2026-09-23 01:23:43Z). Fixes are cut from that commit and land on `main`.

> **Written before any fix, and pushed on its own** — the standing rule from the 2026-09-14 security
> audit, where two findings were lost because the list lived only in commit messages.

**Evidence examined (all read-only):** every Sentry issue seen in the last 10 days, with full events;
production `auth_outcomes`, `user_sessions`, `users`; Railway HTTP and application logs for all eight
deployments since 09-17; Supabase `postgres_logs` and `supavisor_logs`; the Railway service manifest.
No production data was written during the investigation.

---

## The headline

The "bootstrap problems" are three separate production faults that share one amplifier:

1. **A brand-new user's first sign-in can fail with a 503** because two requests create the same
   account at the same instant (F1).
2. **A real iPhone user lost their whole session** because the answer to a token refresh never
   reached the phone, and the retry arrived 52 s after the replay grace closed (F3).
3. **Every diagnostic path around them leaked personal data and dropped the actual cause** (F4) —
   which is why the 503 needed log archaeology instead of one query.

The amplifier: **the backend runs in Singapore and its database in Montréal** (F2). Every query
crosses the Pacific; a bootstrap takes 3–7 s; a token refresh 3.6 s. That turns rare races and
dropped responses into routine ones, keeps the splash screen up until its 6 s failsafe fires, and
makes the app abandon its own server calls.

**Sentry** (F6) holds no app fault: all four active issues are Apple's review fleet (Cupertino,
`zh_CN`, iOS 27.0) or single old events.

---

## Findings

| # | Finding | Severity | Kind |
|---|---|---|---|
| F1 | First sign-in of a new user can 503 on `/api/me/bootstrap` — concurrent first upserts trip `users_referral_code_unique` | **High** | Code — backend |
| F2 | Backend (Railway `asia-southeast1`) and database (Supabase `ca-central-1`) on opposite sides of the Pacific | **High** | Infra |
| F3 | A dropped refresh response burned a real user's session family; the 30 s replay grace was too short | **High** | Code — backend |
| F4 | PII in production logs and `auth_outcomes`; the Postgres cause is recorded nowhere | **Medium** | Code — backend |
| F5 | iOS mints 2–3 first-party sessions per sign-in | Low–Medium | Code — mobile |
| F6 | Sentry B/C/J/H are Apple's review fleet; B/C reopened because #333 changed copy, not outcome | Info | Triage + mobile reporting |
| F7 | Android `Token used too late` rows are one admin device recovering on retry | Info | — |

### F1 — a new user's first sign-in can 503

**Timeline (2026-09-22, UTC)** — an iPhone on 2.9.0 (build 41), Canadian IP, Google sign-in, brand-new
account `10503971…`:

| Time | Event |
|---|---|
| 00:42:01.87 | `GET /api/me/bootstrap` **and** `POST /api/auth/session` start in the same instant |
| 00:42:03.978 | Postgres: `duplicate key value violates unique constraint "users_referral_code_unique"` |
| 00:42:04.334 | bootstrap → **503** `bootstrap_unavailable` (`auth_outcomes` #107, `bootstrap_threw`) |
| 00:42:04.569 | session → 200 — the account now exists |
| 00:42:12.575 | the user retries: bootstrap → 200 |

**Root cause.** Both routes call `usersRepo.upsertFromOAuth`, whose insert is
`INSERT … ON CONFLICT (sub) DO NOTHING`. `ON CONFLICT` protects only its **arbiter** index
(`users_pkey`). The referral code is derived deterministically from `sub`, so two simultaneous first
inserts for one account carry the same code, and the loser trips the **non-arbiter** unique index
`users_referral_code_unique` — a documented PostgreSQL behaviour, not a driver quirk. The route then
collapses the error into its generic 503, and the new user's first screen says the service is
unavailable.

**Why it happens on iOS in particular:** see F5 — a sign-in fires up to three session mints plus the
bootstrap, all of them upserting the account that does not exist yet.

### F2 — the backend is in Singapore, the database in Montréal

| Fact | Value |
|---|---|
| Railway `multiRegionConfig`, production **and** development, every deployment since ≥ 09-08 | `asia-southeast1-eqsg3a` (Singapore) |
| Supabase `Priceback-app` and `Priceback-dev` | `ca-central-1` (Montréal) |
| One DB round trip from the backend | ≈ 230 ms (`/api/me/consents`, one query: 236–253 ms; static `pricing.json`: 8 ms) |
| A new pooled connection (TCP + TLS + SCRAM across the Pacific) | ≈ 2 s — the second mode of `/health` and `policies.json` (2.1–2.2 s) |
| New pooled connections authenticated per hour (30 s idle timeout) | 48–94, around the clock |

**What users get from it (HTTP logs, 09-17 → 09-23):**

| Route | p50 | max |
|---|---|---|
| `GET /api/me/bootstrap` — Android | 5.2–5.5 s | 7.0 s |
| `GET /api/me/bootstrap` — iOS | 2.8–3.9 s | 6.75 s |
| `POST /api/auth/session/refresh` — iOS | 3.6 s | — |
| `POST /api/auth/session` — iOS | 4.0 s | 5.3 s |
| `GET /api/me` (successful) | 2.7–5.8 s | — |

- The app's `reconcileWithServer` (`purchaseService.js`) gives `GET /api/me` **5 s including token
  acquisition**, so after a 3.6 s refresh it has about a second left: a steady stream of **499s**
  (client hung up) on `/api/me` from both platforms. That call carries the premium tier, the
  single-device subscription claim, the admin flag and the ads kill switch.
- `SplashScreen` awaits `startBootTasks()`, which awaits the boot hydrate (a bootstrap), so for a
  signed-in user the splash waits for token refresh + bootstrap — routinely past its **6 s failsafe**.
- Once, the pool gave up mid-handshake at its 5 s `connectionTimeoutMillis`
  (09-22 15:08:15, supavisor: `ECLIENTSOCKETCLOSED … auth_scram_final_wait`) → a failed query.
- `Technical/Abercrombie/Canadian_Egress_Verification.md` assumed the backend's egress was the US.
  It was Singapore.

### F3 — a dropped refresh response burned a real user's session

`user_sessions` for Apple user `001179.1f9…`, 2026-09-22 (UTC):

| Time | Event |
|---|---|
| 19:06:54 | refresh token **#50** presented → rotated, successor **#56** created |
| 19:06:55.24 | every in-flight request from the phone drops at once (`session/refresh` 499 after 1157 ms, `policies.json` 499) — the answer carrying #56 never arrived |
| 19:08:16 | relaunch **82 s later** re-presents **#50** → `reuse_detected`, whole family revoked |
| 19:08:31 | the app re-mints a session (#57); the response is dropped again (499 after 60 ms) |
| 09-23 11:33 | a third mint (#60), also dropped — no first-party session has reached the phone since 19:06:54; it runs on ten-minute Apple tokens |

**Root cause.** `sessionsRepo._replaySpentRotation` already serves a replay when the client provably
never received its rotation — the security condition is *no descendant has ever been presented*,
which held here (#56's `last_used_at` is null). It additionally requires the retry within
`SESSION_REPLAY_GRACE_MS` = **30 s** of the last genuine use. An app suspended mid-refresh does not
come back in 30 s; this one came back in 82.

F2 is the amplifier: a 3.6 s refresh is a 3.6 s window for the OS to suspend the app mid-answer.

### F4 — personal data in logs and `auth_outcomes`, and no cause

- drizzle-orm ≥ 0.45 builds every query error as `Failed query: <sql>\nparams: <values>` and puts the
  Postgres error on `cause`. So F1's `console.error("[bootstrap] failed:", err.message)` wrote the new
  user's sub, email address, **full name** and photo URL to Railway logs — while the one useful fact,
  `23505 users_referral_code_unique`, was logged nowhere and `auth_outcomes.detail` (300 chars) held
  only SQL.
- google-auth-library refuses an expired token with `Token used too late, <now> > <exp>: {decoded
  payload}`. `authOutcomesRepo._scrub` removes `Bearer …` and `eyJ…` material, but a *decoded*
  payload is plain JSON: **42 rows** of `auth_outcomes` store a Google `sub` and the start of an email
  address, and the same text is in the logs.
- The pattern is systemic: 111 `console.*(… err.message)` sites in `server.js`, 13 other backend files.

### F5 — iOS mints 2–3 sessions per sign-in

`openFirstPartySession` has two callers that do not know about each other: the sign-in finalizer
(`authService.js:585`) and `_reopenSessionAfterFallback` (`:1972`), which `authedFetch` fires whenever
a provider token succeeds on iOS — and every request made before the first session is stored
qualifies. The re-open path is single-flighted only against itself. **9 of 11 Apple sign-ups** in
`user_sessions` have 2–3 families created within the same minute; only one is ever used. Each mint
also upserts the user (feeding F1), and orphans count toward `MAX_LIVE_SESSIONS_PER_USER = 10`.

### F6 — Sentry: nothing is an app fault

| Issue | Events (10 d) | Who | Verdict |
|---|---|---|---|
| **C** — Apple `ERR_REQUEST_UNKNOWN` → `signin_unavailable` | 18 | 2.9.0/2.8.20/2.8.5, geo US (Cupertino), locale `zh_CN`, iOS 27.0, `attemptMs` 16–91 | Review devices that cannot present any authorization UI. #333 names the restriction on screen — it was never going to stop the event. |
| **B** — Google "Unable to open Safari" → `signin_presentation_failed` | 13 | same devices, same minutes, `attemptMs` 3–55 | same |
| **J** — `WatchdogTermination` | 2 | same fleet, 2.8.5 + 2.8.20, killed 0.7 s after launch | fleet harness; no real-user event |
| **H** — "Google Sign-In returned no ID token" | 1 (09-14) | iPad, 2.8.20 | single old event |

B/C were set `resolvedInNextRelease` against 2.8.20 on 09-11 and **reopened** because 2.9.0 still
reports the outcome. The on-screen handling is correct; the *reporting level* is what is wrong — an
expected device restriction arrives as an error.

**Watch item:** every real iOS request this week is Darwin/25 (iOS 26). No real iOS 27 device has
signed in yet, so "Sign in with Apple fails on iOS 27" cannot be ruled out from field data — only
from the fact that this exact pattern predates iOS 27 on the same fleet. A B/C event from a
non-Cupertino, non-`zh_CN` iOS 27 device is the signal.

> **Corrected 2026-09-24 — the premise was a Darwin mapping error, and the watch is closed.**
> iOS 27 is **`Darwin/27`**, not `Darwin/26`: the Sentry events for iOS 27.0 (build `24A437`) carry
> `Darwin Kernel Version 27.0.0`, while iOS 26.x is `Darwin/25.x`. Read with the right mapping,
> production's `consent_events.user_agent` shows two **real** accounts — not the reviewer account —
> completing Sign in with Apple and onboarding on `CFNetwork/3896 Darwin/27.0.0`: 2026-09-14
> (build 40) and 2026-09-17 (build 41), both Canadian. Sign in with Apple works on iOS 27.0 in the
> field. Google sign-in on iOS 27 has no field data yet either way (no real attempt, and no Canadian
> iOS 27 device anywhere in Sentry). See Bugs #279.

### F7 — Android `Token used too late`

40 of the 42 rows are one admin device (Android): the silent refresh misses once at cold start, the
expired token is sent once, and the 401 retry succeeds ~0.5 s later with a fresh token. The other 2 are
the 19-day-stale token already documented on 09-07. Benign; left as a follow-up.

---

## Observed, not fixed in this pass

| Observation | Why it matters |
|---|---|
| **Production has no Railway volume.** `DATA_DIR` falls back to the container's `backend/data`, so `watched.json`, `notifyLedger.json`, `ocrBudget.json` and the analytics logs reset on every deploy (`[DB] Loaded 0 watched tokens from disk`) — eight deploys in the last week. | Code comments and the run-3 audit both assume a volume. Needs its own decision (attach one, or retire the file-backed state). |
| Supabase advisor "RLS disabled on 44 tables" | **False positive here:** `anon`, `authenticated`, `service_role` and `authenticator` have no `USAGE` on schema `priceback`; nothing is reachable through the Data API. Enabling RLS would be defence in depth only (the backend connects as the table owner). Left to Maxim. |
| RevenueCat on the review device: *"None of the products registered … could be fetched"* | Consistent with the known "IAPs never attached to a version" blocker. |
| `DeprecationWarning: Calling client.query() when the client is already executing a query` | Traced (`--trace-deprecation`): `db/client.js`'s pool `connect` handler fires `SET search_path` fire-and-forget while pg-pool hands the same client straight to the caller's first query. Harmless on pg 8 (queued); **throws on pg@9**. Fix belongs with the next `pg` upgrade. |
| Referral codes are 6 base-30 characters derived from `sub` | A collision between two *different* users locks the newcomer out; ≈ 7 % chance of at least one by 10 000 users. |

---

## Decisions (Maxim, 2026-09-23)

- **Region:** move production to Railway `us-east4` (Virginia, ≈ 15 ms from Montréal), pinned in
  `backend/railway.json`.
- **Replay grace:** 30 s → **24 h**. The clock-free condition — no newer token of the family was ever
  presented — stays the theft detector.
- **App fixes:** single-flight session mint; device-restriction sign-in outcomes reported at `info`
  level. Merged to `main` for the next store build; no build now.
- **After deploy:** scrub the token payloads out of `auth_outcomes`; archive Sentry B/C/J/H until
  escalating, with a note.

## Fix status

| Item | PR | Status |
|---|---|---|
| F1, F3, F4 — backend | [#350](https://github.com/maxim-lucas/Priceback/pull/350) | Verified locally; **awaiting Maxim's merge** (merging deploys to production — the auto-merge was refused by the session's safety classifier as "merge without review") |
| F2 — region | [#351](https://github.com/maxim-lucas/Priceback/pull/351) | Schema-validated; **awaiting merge** (redeploys production in `us-east4`) |
| F5, F6 — app | [#352](https://github.com/maxim-lucas/Priceback/pull/352) | Verified locally; awaiting merge; ships with the next store build (no build started) |
| `auth_outcomes` payload scrub | — | Authorized; runs **after #350 is live** (otherwise new rows keep arriving unscrubbed) |
| Sentry B/C/J/H archive | — | Authorized; runs after deploy, with a note linking this doc |

### Verification done

| Check | Result |
|---|---|
| Backend full suite (`npm test`, c8 gate) on #350 | 1746 tests · 1745 pass · 0 fail · 1 skip (long-standing `watched_items` dormant) · coverage 94.1 / 79.55 / 93.89 / 94.1 vs floors 90 / 75 / 91 / 90 |
| Mobile full suite (`npm test`) on #352 | 257 suites · 6234 pass · 0 fail · 1 skip (key-dependent OTA test) · coverage 82.83 / 75.32 / 72.84 / 85.34 vs floors 68 / 55 / 59 / 70 |
| New assertions fail on the original code | yes — every source file swapped back to `origin/main` and re-run; swap confirmed by marker count |
| F1 race, reproduced locally | original code: 2 of 80 rounds lost to production's exact 23505; fixed: 0 of 40 |
| `i18n:check` / typecheck / gitleaks 8.18.4 (checksum-verified) | 1509 = 1509 / clean / no leaks on either diff |

### After #350 and #351 are merged — the checklist

1. `railway status --json` → manifest `us-east4-eqdc4a` × 1 and nothing in `asia-southeast1`.
2. `/health` → `healthy: true`; `db.latencyMs` well below the 1907 ms measured on 2026-09-24 before the move.
3. Re-measure bootstrap / refresh / `/api/me` percentiles from Railway HTTP logs (targets: bootstrap p50 < 1 s, refresh < 0.5 s); 499s on `/api/me` should disappear.
4. Supavisor: no `ECLIENTSOCKETCLOSED … auth_scram_final_wait`; `job_runs`: every scheduled job succeeds after the egress change.
5. New `auth_outcomes` rows: a `Token used too late` row reads `…: [token payload redacted]`; a `bootstrap_threw` row carries `db <SQLSTATE> <constraint> on <statement>`.
6. Scrub: `update priceback.auth_outcomes set detail = regexp_replace(detail, '^(Token used too (late|early), [0-9.]+ > [0-9.]+):.*$', '\1: [token payload redacted]') where detail ~ '^Token used too (late|early), [0-9.]+ > [0-9.]+: \{'` — count first (42), then zero rows matching `\{"` must remain.
7. Sentry: B, C, J, H → archived until escalating, each with a comment linking this doc.

---

## Follow-up 2026-09-24 — the five "Observed, not fixed" items, resolved

Maxim (/goal): *"fix these on main branch"*; mid-task: Canada is the only market that matters, and
2.9.0 carries the right Canadian prices. Cut from `main` @ `56cf44b`, built to merge cleanly beside
#350 / #351 / #352.

| Observation | Root cause, confirmed | Resolution |
|---|---|---|
| No Railway volume — watch list, send-once ledger, OCR budget reset every deploy | `DATA_DIR` inside the image; the registry and ledger lived only there. The OCR budget already had a `kv_state` mirror, but a scan before the boot restore overwrote the month (reproduced: `Vision 1/1000` over a stored 500) | Postgres, not a volume (a volume costs downtime on every deploy): migration `0010` + `lib/durableWatchState.js`; budget write gate. Account deletion + data export now cover `push:` registrations too. **PR #354** · Bugs #275, #276 |
| Supabase "RLS disabled" (44 tables) | Not reachable (no client USAGE on the schema; no Data API user) — one `GRANT` from an open door | Migration `0009`: RLS on every table, no policies, never FORCEd; a live-catalog test fails any future table without it. **PR #354** · Bugs #278 · Roadmap L-11 |
| RevenueCat on the review device: no products | Canada-only IAPs on a non-Canadian storefront (Apple's US / `zh_CN` / iOS 27 fleet, every run since 2.9.0 went live) — correct. Canadian devices load all five at the right CAD prices | No store change. Screens say "Purchases are only available in Canada" outside Canada; a **Canadian** storefront with no products is now reported; reviewer notes say to use a Canadian sandbox account. **PR #353** · Bugs #280 |
| `SET search_path` breaks on pg@9 | Issued from the pool `connect` event; `pool.query()` queued its first statement behind it | pg-pool's awaited `onConnect` hook. **PR #354** · Bugs #277 |
| "Nobody on iOS 27 has signed in" | A mapping error: iOS 27 is `Darwin/27`, not `Darwin/26` | Two real Canadian accounts signed in with Apple on iOS 27.0 (09-14, 09-17). Watch closed. Bugs #279 |

**Two notes for whoever runs the post-merge checklist above.** Step 3 (Railway HTTP logs) could not be
done from this machine on 2026-09-24: `railway logs --http` (CLI 5.41.2) returns nothing, and the
GraphQL `httpLogs` query returned `[]` for the live deployment — re-measure from the Railway dashboard
instead. And `/health`'s `checks.storage` will keep saying `ephemeral` in production: that is expected
now; its note says what is still file-only (the flyer overlay, the analytics logs).
