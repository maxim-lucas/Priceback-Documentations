# Environment configuration — which build talks to which backend & database

This is the **client-side** companion to [`Supabase_Cutover.md`](./Supabase_Cutover.md)
(which covers the DB side). It exists because of a real post-cutover confusion: an
account created from a **preview** APK "disappeared" — it was written to a *different*
database than the one being inspected. Nothing errored; the data just went somewhere else.

## The full chain: build profile → backend URL → database

The app never hard-codes a backend. The URL is resolved at build time by
`config/profiles/` (see `app.config.js`) and read at runtime from
`Constants.expoConfig.extra.priceApiUrl`.

| Build / run path | EAS profile (`eas.json`) | `priceApiUrl` resolves to | Railway service | Database that service uses |
|---|---|---|---|---|
| `eas build --profile dev` | `dev` → `PRICE_API_URL` override | `https://priceback-development.up.railway.app` | priceback-**development** | **dev** Supabase `gnedluuylimjwdmtvswl` |
| `eas build --profile preview` | `preview` (no override) | `https://priceback-production.up.railway.app` *(common default)* | priceback-**production** | whatever **prod** Railway's `DATABASE_URL` points at |
| `eas build --profile production` | `production` (no override) | `https://priceback-production.up.railway.app` *(common default)* | priceback-**production** | whatever **prod** Railway's `DATABASE_URL` points at |
| Local Gradle / `expo run:android` (`build-and-install.ps1`) | n/a (`local` profile) | `https://priceback-development.up.railway.app` unless `.env.local` sets `PRICE_API_URL` | priceback-**development** | whatever **dev** Railway's `DATABASE_URL` points at (should be dev Supabase `gnedluuylimjwdmtvswl`) |

Key rule: **local builds AND the `dev` EAS profile point at the development backend.**
`config/profiles/local.js` defaults `priceApiUrl` to `priceback-development` (override per
test with `PRICE_API_URL` in `.env.local`). Only the EAS `preview` and `production` profiles
fall through to the common-profile default (`config/profiles/common.js → priceApiUrl`), which
is **production**. A "preview" build is *not* a "development" build — preview is
staging-against-prod-backend by design.

⚠️ A separate failure mode (hit 2026-06-22): the dev backend is reachable but its
`DATABASE_URL` still points at the **retired Neon** project, which is now **over its
compute-time quota (HTTP 402)** — so a local-build signup succeeds on the phone but never
persists, and dev Supabase shows 0 users. Fix: set the **priceback-development** Railway
service `USE_DB=true` + `DATABASE_URL=<dev Supabase session-pooler URL>` (the same URL in
`backend/.env`) and redeploy. See memory `db-provider-neon-test-supabase-prod`.

## Why a fresh account can "vanish" from the database you're looking at

Symptom (the one we hit): built a **preview** APK, signed up, but the new dev **Supabase**
project showed no user/receipts — and there were **no Sentry errors**.

Cause: the preview APK talks to **priceback-production** Railway, whose `DATABASE_URL`
is a *separate* database from the **dev** Supabase project (`gnedluuylimjwdmtvswl`) that was
being inspected. The signup succeeded — it just landed in prod's DB. No Sentry error because
nothing failed; the write went where the build was pointed, not where we were looking.

How to confirm quickly:

- `GET https://<service>.up.railway.app/health` returns `{ status, healthy, version, checks }`.
  The **version** tells you whether that service is running current code (repo is `2.7.0`); the
  **`checks`** block reports each dependency's live status (see below).
- Query the database that *that service's* `DATABASE_URL` actually points at — not the one
  you assume. The dev Supabase project only ever contains **test fixtures** (device ids like
  `engine-*` / `credit-*`) from the DB-gated test suite; real phone traffic never lands there
  unless the app is a `dev`-profile build.

## Current state of the prod cutover  ⚠️ (as of 2026-06-21)

The prod Supabase project (`xjfrlzwonyaorwktnkpj`) is **not yet migrated** — the `priceback`
schema/tables do not exist there, so there is effectively **no live prod DB on Supabase**.
Separately, the deployed **priceback-production** Railway service is still running **old code
(`2.6.0`)**; the repo and the dev service are on `2.7.0`.

Until the prod cutover is finished, **do not** rely on preview/production builds for end-to-end
verification. Two ways forward:

1. **To test now:** build/run the **`dev`** EAS profile. It hits priceback-development →
   dev Supabase, which is migrated and green. Data shows up in the project you've been
   working in.
2. **To finish prod (pre-launch, owed):**
   - Run the one-time migration against the prod Supabase URL (see `Supabase_Cutover.md`
     "One-time migration") so the `priceback` schema + tables exist.
   - Set prod Railway `USE_DB=true` + `DATABASE_URL=<prod Supabase session-pooler URL>`.
   - Redeploy priceback-production from latest `main` so it runs current code (`2.7.0`).
   - Re-verify `/health` reports `2.7.0` and a DB-backed route returns seeded rows.

## On-screen surfacing of an unreachable backend

So a dead/misconfigured backend is never silent again, the Home screen now polls
`${priceApiUrl}/health` (alongside the existing internet check) and shows a
**"Can't reach PriceBack servers"** banner when the internet is up but the backend is
unreachable or the API URL is unset/placeholder (`home.backendDown`). This catches the
"wrong URL / server down" class on-screen; note `/health` always returns `200` while the
process is up (so Railway's healthcheck + uptime monitors don't flap) — read the body's
`healthy` flag and `checks` block for dependency state, not the HTTP status.

## `/health` as a self-service diagnostic

`GET /health` now actively probes dependencies so you can debug a service from a browser
without shelling into Railway.

**Public (no token)** — safe to expose, no secrets/hosts/counts:

```json
{ "status": "ok", "healthy": true, "version": "2.7.0", "uptimeMs": 7304,
  "checks": {
    "db":     { "status": "ok", "latencyMs": 9 },   // active SELECT 1 (cached ~5s)
    "auth":   { "status": "configured" },            // Google ID-token audiences set?
    "ocr":    { "status": "configured" },            // GOOGLE_VISION_API_KEY set?
    "ocrLlm": { "status": "disabled" },              // GEMINI_API_KEY set?
    "email":  { "status": "disabled" } } }
```

`healthy` is `true` only when every **critical** dependency is up (currently just the DB —
`status: "ok"` or `"disabled"`). A missing OCR/LLM/email key degrades a feature, not the service.

**Admin (`?token=<FLYER_ADMIN_TOKEN>` or `x-admin-token` header)** — adds full detail under
`checks`, most usefully the **masked DB target** so you can confirm *which* database a service
is pointed at (Supabase vs Neon) without leaking credentials:

```json
"checks": { "db": { "status": "ok", "latencyMs": 9, "database": "postgres",
                     "schema": "priceback",
                     "target": { "host": "aws-1-ca-central-1.pooler.supabase.com",
                                 "port": "5432", "database": "postgres" } },
            "auth": { "status": "configured", "audiences": 2,
                      "recentFailures": 0, "windowMin": 10, "alertThreshold": 20 },
            "ocr":  { "status": "configured", "budget": { … } } }
```

Debugging the "signed up but no DB row" class: check **`checks.db.target.host`** (right DB?),
**`checks.db.status`** (reachable?), and **`checks.auth.recentFailures`** — a climbing
`recentFailures` means clients are sending expired/invalid Google ID tokens, which silently
drops writes (the 401-token regression).

### OCR (Vision) auth probe — proactive + on-demand (Bugs_Common_Fixes #127)

The plain `ocr` check above is only a `GOOGLE_VISION_API_KEY`-presence flag — it silently
lied "configured" for hours during the 2026-07-23 outage where GCP billing was disabled on
the Vision project and every scan 502'd. There are now **two** ways the real key/billing
state gets checked with one live annotate call:

1. **Proactive (automatic, no setup needed):** a cron (`OCR_AUTH_PROBE_CRON`, default
   `20 */6 * * *` — 4×/day) calls the same probe server-side and, on anything but `ok`,
   pages via the existing ops-alert email (`raiseAlert("ocr-auth-probe", …)` — reuses
   `RESEND_API_KEY` + `ALERT_EMAIL`, throttled by `ALERT_COOLDOWN_MS`, default 1h). This is
   what actually catches a billing lapse **before** a user reports a broken scan — see
   `backend/tests/ocrAuthProbeCron.test.js`.
2. **On-demand / external uptime monitor:** `GET /health?probe=ocr&token=<FLYER_ADMIN_TOKEN>`
   (or `?probe=all`) runs the probe inline and returns the result under `checks.ocr.probe`.
   Point an external uptime monitor (UptimeRobot, Better Stack, Pingdom, …) at this URL on a
   cadence of an hour or more (it burns one real Vision unit per hit) as a belt-and-suspenders
   check that pages through a *different* channel than #1 — useful if Railway/Resend are both
   down at once. Configure the monitor to alert on `checks.ocr.probe !== "ok"` in the response
   body (the HTTP status is always 200 by design, see above).

`checks.ocr.probe` values: `ok` (healthy) · `unauthorized` (bad/revoked/restricted key, or —
the 2026-07-23 case — **billing disabled** on the GCP project) · `rate_limited` (429) ·
`error` (other non-2xx) · `unreachable` (network/timeout) · `missing` (no key configured).

### Provider quota ceilings (admin only)

The admin payload also carries a **`quotas`** block: consumed-vs-remaining for every external
subscription/plan ceiling that can take the app down when its tier is exhausted. It's admin-only
because it exposes infra ceilings. Each entry is tagged with a **`source`**:

- `measured` — read live server-side, no external token needed: **`db_size`** / **`db_connections`**
  (live `pg_database_size` + `pg_stat_activity`), **`vision_ocr`** / **`gemini_llm`** (the internal
  monthly/daily budgets), **`email_monthly`** / **`email_daily`** (an internal Resend send counter),
  and **`scan_credits`** (`issued`/`consumed`/`outstanding` from the credit ledger).
- `declared-cap` — the configured ceiling only, `used: null`. The default for **`r2_storage`**,
  **`railway`**, **`sentry_events`** (no live measurement without a provider token).
- `api` — a live reading pulled from the provider's usage API. R2/Railway/Sentry upgrade to this
  automatically **when their optional token is set** (best-effort, cached ~5 min; any failure
  silently degrades back to `declared-cap`).
- `disabled` — DB-backed entries when `USE_DB!=true`.

```json
"quotas": {
  "db_size":       { "used": 312, "limit": 500, "remaining": 188, "pctUsed": 62, "source": "measured", "note": "MB" },
  "db_connections":{ "used": 3, "limit": 15, "remaining": 12, "source": "measured" },
  "vision_ocr":    { "window": "2026-06", "used": 240, "limit": 1000, "remaining": 760, "source": "measured" },
  "gemini_llm":    { "window": "2026-06-22", "used": 90, "limit": 1400, "remaining": 1310, "source": "measured" },
  "email_monthly": { "used": 12, "limit": 3000, "remaining": 2988, "source": "measured" },
  "scan_credits":  { "issued": 5200, "consumed": 4100, "outstanding": 1100, "source": "measured" },
  "r2_storage":    { "used": null, "limit": 10, "source": "declared-cap", "note": "GB · set CLOUDFLARE_API_TOKEN for live usage" },
  "sentry_events": { "used": null, "limit": 5000, "source": "declared-cap" } }
```

**Declared caps** are DB-tunable `app_config` rows (bump them when you upgrade a plan, no redeploy):
`SUPABASE_DB_LIMIT_MB`, `SUPABASE_MAX_CONNECTIONS`, `RESEND_MONTHLY_LIMIT`, `RESEND_DAILY_LIMIT`,
`R2_STORAGE_LIMIT_GB`, `RAILWAY_USAGE_LIMIT`, `SENTRY_EVENTS_LIMIT` (see `config/defaults.js`).

**Optional usage-API tokens** (env-only secrets; unset = declared-cap fallback): set
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (+ `R2_BUCKET`) for live R2 bytes, `RAILWAY_API_TOKEN`
for live Railway spend, and `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` for live Sentry event counts. To add a
new provider, extend `buildQuotas()` in `server.js` and add a probe to `lib/quotaProbes.js`.

> The complete list of every backend environment variable (required vs optional, how to
> obtain each, and which to set on the Railway dev/prod services) — including
> `FLYER_ADMIN_TOKEN`, without which the admin/quota view above never renders — lives in
> [`DEPLOYMENT.md` → “Railway environment variables”](./DEPLOYMENT.md#railway-environment-variables).
> The full endpoint catalog with access tiers is in
> [`DEPLOYMENT.md` → “Backend Endpoints”](./DEPLOYMENT.md#backend-endpoints).
