# Publish Requirements — Backend Environment Variables

This document lists **every environment variable the PriceBack backend reads**, what it
does, whether it's required, its default, and where to get the value. The backend is what
runs on **Railway** (service `priceback-development` for dev). The mobile app's build-time
vars (Sentry DSN, RevenueCat key, etc.) are set in EAS, **not** Railway — see
[Mobile / EAS build vars](#mobile--eas-build-vars-not-railway) at the bottom.

> **Secrets policy:** This file is committed to the repo, so it does **not** contain live
> secret values. Real values live in `backend/.env` (gitignored) for local dev and in the
> Railway dashboard for deployed environments. Non-secret R2 setup values are already in the
> committed `backend/.env.example`. Rotate Vision key + Supabase prod DB password + R2 keys
> before production launch (see `PUBLISH_CHECKLIST.md` §8A).

## Quick status — dev (Railway)

You have already configured:

| Var | Section |
|-----|---------|
| `DATABASE_URL` | [Database](#1-database-postgresneon) |
| `GEMINI_API_KEY` | [LLM](#3-llm-gemini) |
| `GOOGLE_CLIENT_ID` | [Auth / Tokens](#4-auth--tokens) |
| `GOOGLE_CLIENT_ID_ANDROID` | [Auth / Tokens](#4-auth--tokens) |
| `GOOGLE_VISION_API_KEY` | [Google Vision (OCR)](#2-google-vision-ocr) |
| `USE_DB` | [Database](#1-database-postgresneon) |

**Still required for a fully-working dev backend (set these next):**

- **Object storage (R2)** — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`. Without them, receipt-image upload/view throws at request time. Values are in
  `backend/.env.example`.
- **Admin token** — `FLYER_ADMIN_TOKEN` (also covers `ADMIN_TOKEN`). Without it, flyer
  ingestion and credit-revocation admin endpoints refuse all writes.
- **RevenueCat webhook** — `REVENUECAT_WEBHOOK_TOKEN`. Without it, subscription/credit
  purchases won't reconcile server-side.

**Recommended but optional (degrade gracefully):**

- **Alerting (Resend)** — `RESEND_API_KEY`, `ALERT_EMAIL`. Without them, budget/auth-failure
  alerts are logged but no email is sent.
- **Persistent volume** — `DATA_DIR`. Without it, the JSON pool (`watched.json`, flyer cache)
  is wiped on every redeploy. Crowdsourced prices/devices/receipts are in Postgres and are
  unaffected.

---

## 1. Database (Postgres)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `DATABASE_URL` | **Yes** | — | Postgres connection string. Vanilla `pg` driver — provider chosen by this URL. Both prod and dev/test run on **Supabase** (Neon is retired). |
| `USE_DB` | **Yes** | unset (off) | Set to `true`. Gates audit middleware, retention jobs, `/api/receipts`, crowdsourced prices, device tracking, barcode resolve, and DB-backed user/billing. With it off, those routes return **503** (no JSON fallback). |

**Where to get `DATABASE_URL`:**

- **Production → Supabase** project `xjfrlzwonyaorwktnkpj`. Supabase dashboard → Project → Connect → use the **session pooler** or **direct** connection (NOT the 6543 transaction pooler). See `docs/Supabase_Cutover.md`.
  Format: `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`
- **Dev → Supabase** project `gnedluuylimjwdmtvswl`. Same format, different ref + password. Use this for local dev and dev Railway deploys. Neon is retired — do not use it.

> **Migrations:** the re-squashed chain is `0000_initial` → `0001_receipt_member_id` → `0002_receipt_warehouse_header_ocr`. Prod Supabase **already has the full v2 `priceback` schema with live data** (verified 2026-07-06); what remains is to confirm `db:migrate` reports *No pending migrations* on prod — `DATABASE_URL=<prod-supabase> npm run db:migrate` (see `PUBLISH_CHECKLIST.md §8B`).

---

## 2. Google Vision (OCR)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `GOOGLE_VISION_API_KEY` | **Yes** (for OCR) | `""` | API key for the Cloud Vision proxy endpoints (receipt/tag OCR). If empty, OCR endpoints fail. |

**Setup:**
1. [GCP Console](https://console.cloud.google.com) → APIs & Services → Credentials → create
   API key.
2. Enable **Cloud Vision API** on the same project, and enable **billing** (free past
   1000 req/month).
3. Lock the key: Application restrictions → IP addresses → Railway outbound IP; API
   restrictions → Cloud Vision API only.

Endpoints used: `vision.googleapis.com/v1/images:annotate` and `/v1/files:annotate`.

> Per-device OCR rate limits (`OCR_HOURLY_LIMIT`, `OCR_DAILY_LIMIT`, `OCR_MONTHLY_LIMIT`) are
> tunable ops knobs — see [Operational knobs](#8-operational-knobs-optional-overrides).

---

## 3. LLM (Gemini)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `GEMINI_API_KEY` | Optional (recommended) | `""` | Enables LLM-assisted receipt reconciliation. If empty, `LLM_PROVIDER` is `null` and the client falls back to heuristic parse only. |

Model: `gemini-2.0-flash` (hardcoded). Endpoint:
`generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`.

Cost controls (all tunable ops knobs): only fires on heuristic misparses; `sha256(rawText)`
response cache (`LLM_CACHE_TTL_MS`, 30 days); per-device daily cap (`LLM_DAILY_LIMIT`, 20);
global daily budget (`LLM_GLOBAL_DAILY_LIMIT`, 1400).

---

## 4. Auth / Tokens

### OAuth (Google sign-in)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `GOOGLE_CLIENT_ID` | **Yes** | `null` | Web OAuth client ID. Used as a `verifyIdToken` audience. When unset, auth-aware routes return **503** ("Auth not configured"). |
| `GOOGLE_CLIENT_ID_ANDROID` | **Yes** | `null` | Android OAuth client ID — second accepted audience for mobile-issued tokens. |

Mobile clients send the Google ID token as `Authorization: Bearer <jwt>`; the backend
verifies it against Google's keys and uses the `sub` claim as the stable user ID. These must
match the OAuth clients the mobile app uses (`extra.googleClientId` in app config).

### Admin / service tokens

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `FLYER_ADMIN_TOKEN` | **Yes** (for admin) | `null` | Secret for the flyer-import endpoint. If unset, the endpoint refuses **all** writes. |
| `ADMIN_TOKEN` | Optional | falls back to `FLYER_ADMIN_TOKEN` | Secret for credit-revocation tooling (`POST /api/admin/price-tag-credits/revoke`). One ops secret can cover both surfaces. |
| `REVENUECAT_WEBHOOK_TOKEN` | **Yes** (for billing) | `null` | Shared secret verifying RevenueCat webhook POSTs (constant-time compare). Set the same value under RevenueCat → Integrations → Webhooks → Authorization header. |

Generate admin/webhook tokens as long random strings, e.g.
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 5. Object storage (receipt images)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `OBJECT_STORE` | Optional | `r2` | Backend selector: `r2` (current) or `gcs` (dormant). |
| `R2_ACCOUNT_ID` | **Yes** (if R2) | — | Cloudflare R2 account ID. |
| `R2_ACCESS_KEY_ID` | **Yes** (if R2) | — | R2 API token access key. |
| `R2_SECRET_ACCESS_KEY` | **Yes** (if R2) | — | R2 API token secret. |
| `R2_BUCKET` | **Yes** (if R2) | — | Bucket name (e.g. `priceback-receipts`). |
| `GCS_BUCKET` | Only if `OBJECT_STORE=gcs` | — | Google Cloud Storage bucket. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Only if `OBJECT_STORE=gcs` | — | Path to service-account JSON, or use Workload Identity in GCP. |

R2 is initialized lazily and **throws at request time** if any of the four R2 vars is missing
(receipt-image presigned upload/download/delete). Setup: dash.cloudflare.com → R2 → Create
bucket → R2 API Tokens → "Object Read & Write".

> Dev R2 values are already in `backend/.env.example`. Rotate before production.

---

## 6. Alerting / email (Resend)

Transactional email for budget + auth-failure alerts. **Opt-in:** with `RESEND_API_KEY` or
`ALERT_EMAIL` unset, threshold crossings are logged but no email is sent.

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `RESEND_API_KEY` | Optional | `""` | [Resend](https://resend.com) API key. |
| `ALERT_EMAIL` | Optional | `""` | Recipient address for alerts. |
| `ALERT_FROM` | Optional | `PriceBack Alerts <onboarding@resend.dev>` | From header. Use a verified domain in production. |
| `ALERT_COOLDOWN_MS` | Optional | `3600000` (1h) | Per-alert-key throttle so a sustained incident sends one email, not thousands. |
| `AUTH_FAIL_WINDOW_MS` | Optional | `600000` (10m) | Sliding window for the auth-failure (401-burst) monitor. |
| `AUTH_FAIL_ALERT_THRESHOLD` | Optional | `20` | 401s within the window that trigger an alert. Surfaced on `/health`. |

---

## 7. Runtime / infrastructure

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `PORT` | No | `3001` | HTTP listen port. **Railway injects this automatically** — don't set it manually. |
| `DATA_DIR` | Recommended | `<backend>/data` | Persistent path for JSON pools (`watched.json`, `watchedTouched.json`, flyer cache). On Railway, create a Volume, mount it (e.g. `/data`), and set `DATA_DIR=/data` so they survive redeploys. Crowdsourced prices/devices/receipts are Postgres-backed and unaffected. |
| `AUDIT_LOG` | Optional | `true` | API-call audit log: emits one structured JSON line per request to stdout (captured by the Railway log stream). Set `false` to silence. |

---

## 8. Operational knobs (optional overrides)

These are **all optional** — every one has a value in the `app_config` DB table (seeded from
`backend/config/defaults.js`) and a hardcoded code fallback. Read precedence:
**`process.env` → `app_config` DB row → code default**. Set an env var only to override the DB
value for this environment. Numeric env values are coerced.

| Var | Default | Category | Purpose |
|-----|---------|----------|---------|
| `OCR_HOURLY_LIMIT` | `30` | rate_limits | Max Vision OCR calls per device per hour. |
| `OCR_DAILY_LIMIT` | `200` | rate_limits | Max Vision OCR calls per device per day. |
| `OCR_MONTHLY_LIMIT` | `1000` | rate_limits | Global Vision monthly budget before billing kicks in. |
| `LLM_DAILY_LIMIT` | `20` | rate_limits | Max Gemini calls per device per day. |
| `LLM_GLOBAL_DAILY_LIMIT` | `1400` | rate_limits | Global Gemini daily budget. |
| `ALERT_THRESHOLD_PCT` | `80` | rate_limits | Budget % that triggers the one-shot alert email (1–100). |
| `CHECK_PRICE_PER_MIN` | `60` | rate_limits | Max `/api/check-price` calls per IP per minute. |
| `CHECK_PRICE_PER_HOUR` | `600` | rate_limits | Max `/api/check-price` calls per IP per hour. |
| `ANALYTICS_PER_HOUR` | `60` | rate_limits | Max analytics batch POSTs per IP per hour. |
| `LLM_CACHE_TTL_MS` | `2592000000` (30d) | cache_ttl | LLM response cache TTL. |
| `SAMEDAY_URL_TTL` | `86400000` (1d) | cache_ttl | Sameday product-URL cache TTL. |
| `DEVICE_TTL_MS` | `62208000000` (~24mo) | cache_ttl | Stale-device cleanup window. |
| `RETENTION_SUB_EVENTS_DAYS` | `365` | retention | `subscription_events` retention. |
| `RETENTION_WATCHED_DAYS` | `730` | retention | `watched_items` inactivity TTL. |
| `RETENTION_EXPIRED_OFFERS_DAYS` | `30` | retention | Expired flyer offers kept this long. |
| `RETENTION_TAG_PHOTOS_DAYS` | `30` | retention | Price-tag scan photos (R2) deleted this long after upload; `tag_scan_reviews` row + OCR text kept as the audit trail. |

---

## 9. Sentry

**Sentry is mobile-only** — it is integrated in the React Native app via `analyticsService`
(PII-scrubbed, `sendDefaultPii:false`), and is **never used in the backend**. There is no
backend `SENTRY_DSN`. The DSN is an **EAS build-time** var, not a Railway var — see below.

---

## Mobile / EAS build vars (NOT Railway)

For completeness. These are read by the Expo app config / mobile services
(`config/profiles/eas.js`, `config/profiles/local.js`, `src/services/*`) and are set in **EAS**
(`eas.json` / EAS secrets) at build time — **do not set these on Railway**.

| Var | Purpose |
|-----|---------|
| `APP_ENV` | Selects the mobile build profile (dev/preview/prod). |
| `PRICE_API_URL` | Base URL the app calls — points at the Railway backend for this env. |
| `SENTRY_DSN` | Sentry crash/error reporting (mobile only). |
| `REVENUECAT_API_KEY` | RevenueCat SDK key (mobile purchases). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID_ANDROID` / `GOOGLE_CLIENT_ID_IOS` | Google sign-in client IDs per platform. |
| `MICROSOFT_CLIENT_ID` | Microsoft sign-in (email sync). |
| `GOOGLE_VISION_API_KEY` | Vision key when the app calls Vision directly (vs via backend). |
| `VERYFI_CLIENT_ID` / `VERYFI_API_KEY` / `VERYFI_USERNAME` | Veryfi OCR fallback. |
| `GOOGLE_SERVICES_JSON` | Path to `google-services.json` for Android builds. |
| `SUPPORT_EMAIL` / `PRIVACY_EMAIL` / `SECURITY_EMAIL` | Contact addresses surfaced in-app. |

---

## Appendix — minimal dev Railway checklist

```
# Already set
DATABASE_URL=<Supabase dev pooled URL>   # dev: project gnedluuylimjwdmtvswl — PRODUCTION uses the prod Supabase URL (see §1)
USE_DB=true
GOOGLE_CLIENT_ID=<web OAuth client id>
GOOGLE_CLIENT_ID_ANDROID=<android OAuth client id>
GOOGLE_VISION_API_KEY=<vision api key>
GEMINI_API_KEY=<gemini api key>

# Add next (required for full functionality)
OBJECT_STORE=r2
R2_ACCOUNT_ID=<from backend/.env.example>
R2_ACCESS_KEY_ID=<from backend/.env.example>
R2_SECRET_ACCESS_KEY=<from backend/.env.example>
R2_BUCKET=priceback-receipts
FLYER_ADMIN_TOKEN=<random 32-byte hex>
REVENUECAT_WEBHOOK_TOKEN=<random 32-byte hex, also set in RevenueCat>

# Recommended
DATA_DIR=/data                 # requires a mounted Railway Volume
RESEND_API_KEY=<resend key>
ALERT_EMAIL=<your alert inbox>

# PORT is injected by Railway — do not set.
```
