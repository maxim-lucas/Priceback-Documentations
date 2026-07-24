# PriceBack Canada — Deployment Guide

## Prerequisites

- Node.js 18+
- npm 10+
- Git
- EAS CLI: `npm install -g eas-cli`
- Expo account: https://expo.dev (owner: maximlucas)

---

## First-Time Setup (New Machine)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd PriceBack

# Clean install
rm -rf node_modules package-lock.json
npm install

# REQUIRED: Reanimated 4.x needs worklets
npm install react-native-worklets@0.7.1

# Fix any Expo SDK version mismatches
npx expo install --fix
```

### 2. Initialize EAS Project

```bash
# Login to Expo
npx eas login

# Initialize project — creates new project ID matching slug
npx eas init
```

> **Important:** If you get `slug mismatch` error, run `npx eas init` to generate
> a new project ID. The old `priceback-canada` ID won't work with the
> `priceback-canada` slug.

### 3. Initialize Git (EAS requires it)

```bash
git init
git add .
git commit -m "initial commit"
```

---

## Build Commands

> **No EAS?** See [`BUILD_LOCAL_ANDROID.md`](BUILD_LOCAL_ANDROID.md) for
> building the Android APK directly with Gradle on your own machine —
> useful for offline iteration, debugging native errors, or just avoiding
> EAS build quota.

### Android APK (testing on device)

```bash
npx eas build --platform android --profile preview
```

### Android App Bundle (Play Store)

```bash
npx eas build --platform android --profile production
```

### iOS (App Store)

```bash
npx eas build --platform ios --profile production
```

---

## Common Build Errors & Fixes

### Error: `slug mismatch`
```
Project config: Slug for project identified by "extra.eas.projectId" 
(priceback-canada) does not match the "slug" field (priceback-canada)
```
**Fix:** Run `npx eas init` to create a new project ID matching the current slug.

### Error: `Cannot find module 'react-native-worklets/plugin'`
```
SyntaxError: [BABEL]: Cannot find module 'react-native-worklets/plugin'
```
**Fix:** Reanimated 4.x requires worklets as a separate package:
```bash
npm install react-native-worklets@0.7.1
```
> Use 0.7.x specifically — version 0.8.x is incompatible with Reanimated 4.2.1.

### Error: `Worklets version not compatible with Reanimated`
```
Your installed version of Worklets (0.8.1) is not compatible with Reanimated (4.2.1)
```
**Fix:** Downgrade worklets:
```bash
npm install react-native-worklets@0.7.1
```

### Error: `CMake Error hermes-engine::libhermes not found`
```
Target "reanimated" links to target "hermes-engine::libhermes" but the target was not found
```
**Fix:** This happens with Reanimated 3.x on React Native 0.83+. Use Reanimated 4.x:
```bash
npm install react-native-reanimated@4.2.1 react-native-worklets@0.7.1
```

### Error: `ERESOLVE unable to resolve dependency tree`
**Fix:** The project includes `.npmrc` with `legacy-peer-deps=true`. If you still get errors:
```bash
npm install --legacy-peer-deps
```

### Error: `not a git repository`
```
EAS requires you to use a git repository for your project
```
**Fix:**
```bash
git init
git add .
git commit -m "initial commit"
```

### Error: `expo is not recognized as a command`
**Fix:** Always use `npx` prefix:
```bash
npx expo install --fix
npx eas build --platform android --profile preview
```
If `npx expo` still fails, run `npm install` first.

### Error: `legacy expo-cli does not support Node +17`
**Fix:** Uninstall the old global expo-cli:
```bash
npm uninstall -g expo-cli
```
Then use `npx expo` which uses the local version.

### Warning: `packages should be updated for best compatibility`
**Fix:** Run `npx expo install --fix` to auto-update to compatible versions.

---

## Version-Locked Dependencies

These versions are tested and working together:

| Package | Version | Notes |
|---|---|---|
| expo | ~55.0.0 | SDK 55 |
| react | 19.2.0 | |
| react-native | 0.83.4 | |
| react-native-reanimated | 4.2.1 | Requires worklets |
| react-native-worklets | 0.7.1 | Must be 0.7.x, NOT 0.8.x |
| react-native-screens | ~4.23.0 | |
| react-native-safe-area-context | ~5.6.2 | |
| react-native-gesture-handler | ~2.30.0 | |
| @react-native-async-storage | 2.2.0 | |
| babel-preset-expo | ~55.0.8 | |
| @types/react | ^19.1.1 | |

---

## API Keys Configuration

| Service | File | Line | How to Get |
|---|---|---|---|
| Google Cloud Vision | `src/services/ocrService.js` | 24 | console.cloud.google.com → APIs → Vision API → Create API Key |
| Gmail OAuth | `src/services/emailSyncService.js` | 17 | console.cloud.google.com → APIs → Gmail API → OAuth 2.0 Client ID |
| Microsoft OAuth | `src/services/emailSyncService.js` | 18 | portal.azure.com → App registrations → New → Mail.Read permission |
| Veryfi OCR | `src/services/ocrService.js` | 30-32 | app.veryfi.com (optional, secondary OCR) |
| RevenueCat IAP | `src/services/purchaseService.js` | 30 | revenuecat.com (required for real payments) |

---

## Backend Deployment

```bash
cd backend
npm install
npm start  # Local: http://localhost:3001
```

### Deploy to Railway (recommended)
1. Push `/backend` folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Select the backend folder
4. Railway auto-detects Node.js and runs `npm start`
5. Copy deployed URL (e.g., `https://priceback-backend.up.railway.app`)
6. Update in app:
   - `src/services/priceService.js` line 21
   - `src/services/purchaseService.js` line 25

### Backend Endpoints

Every route lives in `backend/server.js`. They fall into four **access tiers** — the
tier decides *how you authenticate*, which is the part that bit us (the `/health`
quota block is admin-only and the gate fails **silently**, see
[Admin diagnostics & the `/health` quota block](#admin-diagnostics--the-health-quota-block)).

**How to authenticate, per tier:**

| Tier | How a caller proves it | Token source |
|---|---|---|
| **Public** | nothing | — |
| **User** (`requireAuth`) | `Authorization: Bearer <Google ID token>` | the app's Google sign-in; verified against `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID_ANDROID` |
| **Admin** | `x-admin-token: <token>` header (or `?token=` on `/health` only) | `FLYER_ADMIN_TOKEN` (or `ADMIN_TOKEN` fallback) — see [Railway environment variables](#railway-environment-variables) |
| **Webhook** | `Authorization: Bearer <token>` | `REVENUECAT_WEBHOOK_TOKEN` (set the same value in RevenueCat → Webhooks) |

> DB-backed routes (`requireDb`) return **503** when `USE_DB!=true` — there is no JSON
> fallback. Production must run `USE_DB=true`.

#### Public

| Method & path | Purpose | Key params |
|---|---|---|
| `GET /health` | Liveness + dependency diagnostics. Always HTTP 200 while up — read the body's `healthy`/`checks`. **Pass the admin token for the full detail (masked DB host, `quotas`).** | `?token=<FLYER_ADMIN_TOKEN>` or `x-admin-token` header → admin view |
| `POST /api/check-price` | Check current price at a store | body: `{ store, url \| query }` |
| `POST /api/check-all` | Trigger a manual price sweep | — |
| `POST /api/ocr` | Google Vision OCR proxy | body: `{ image }` (base64) |
| `POST /api/ocr-llm` | LLM line-item reconciliation proxy (needs `GEMINI_API_KEY`) | body: OCR text/items |
| `POST /api/watch` | Register items for background monitoring | body: `{ deviceId, items }` |
| `POST /api/unwatch` | Unregister a watch | body: `{ token }` |
| `POST /api/analytics` | Event ingest | body: `{ events }` |
| `POST /api/observations/tag` | Crowdsourced Costco price-tag scan (device-attested) | body: device + tag fields |
| `POST /api/device/sync` | Anti-reinstall device sync | body: `{ deviceId, … }` |
| `POST /api/device/scan` | Increment server-side scan count | body: `{ deviceId }` |
| `GET /api/me/contributions` | A device's crowdsourced contributions | `?deviceId=` |
| `DELETE /api/me/observations` | Withdraw a device's observations | `?deviceId=` |
| `GET /api/barcode/resolve` | Resolve a UPC → product + price (`requireDb`) | `?barcode=&province=` |
| `GET /api/flyer/active` | Current active flyer offers | — |
| `GET /api/v1/policies.json` | Store price-match policies catalog | — |
| `GET /api/v1/pricing.json` | Plan/pricing catalog | — |
| `GET /api/v1/warehouses.json` | Costco warehouse catalog | — |

#### User — `Authorization: Bearer <Google ID token>`

| Method & path | Purpose |
|---|---|
| `GET /api/me` | Account + subscription view |
| `GET /api/me/bootstrap` | First-load aggregate (`requireDb`) |
| `PUT /api/me/profile` | Update profile (province, postal, prefs) |
| `GET /api/me/consents` | Consent state |
| `GET /api/me/credits` · `POST /api/me/credits/offline-scans` · `POST /api/me/credits/topup` | Scan-credit ledger read / offline reconcile / top-up (`requireDb`) |
| `GET /api/me/data-export` | GDPR/PIPEDA data export |
| `DELETE /api/me/account` | Soft-delete account |
| `POST /api/me/reset` | Wipe account data (`requireDb`) |
| `GET /api/me/referral` · `POST /api/me/referral/redeem` | Referral code / redeem |
| `POST /api/receipts` | Archive a parsed receipt + items (`requireDb`) |
| `POST /api/receipts/:id/image-uploaded` | Confirm receipt image upload (`requireDb`) |
| `GET /api/receipts` · `GET /api/receipts/:id` | List / fetch receipts (`requireDb`) |
| `DELETE /api/receipts/:id` · `DELETE /api/receipts/:id/items/:index` | Soft-delete receipt / item (`requireDb`) |
| `POST /api/receipts/:id/items/:index/claim` | Mark a price-drop claim (`requireDb`) |
| `POST /api/receipts/:id/items/:index/watch` | Watch a receipt item for drops (`requireDb`) |
| `POST /api/admin/barcode-link` | Link a barcode (user-auth + `requireDb`) |

#### Admin — `x-admin-token: <FLYER_ADMIN_TOKEN>`

| Method & path | Purpose |
|---|---|
| `POST /api/flyer/import` | Bulk-import the weekly Costco flyer |
| `POST /api/admin/price-tag-credits/revoke` | Revoke fraudulent tag-scan credits |
| `POST /api/admin/users/:sub/flag` · `DELETE …/flag` | Flag / unflag a user |
| `POST /api/admin/price-points/:id/verify` | Manually verify a price point |
| `POST /api/admin/barcode-links` | Bulk barcode→SKU links |

#### Webhook

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /api/revenuecat/webhook` | RevenueCat subscription events | `Authorization: Bearer <REVENUECAT_WEBHOOK_TOKEN>` |

#### Admin diagnostics & the `/health` quota block

The richest `/health` view — `quotas` (consumed-vs-remaining for every external plan
ceiling), the **masked DB host**, `checks.auth.recentFailures` — only renders when you
supply the admin token. **If the token is wrong, or `FLYER_ADMIN_TOKEN` isn't set on the
service, `/health` silently returns the public payload (no error, no `quotas`).** So a
plain `/health` will *always* look like it has no quotas.

```bash
# Admin view (quotas, masked DB target, auth-failure canary):
curl "https://priceback-development.up.railway.app/health?token=<FLYER_ADMIN_TOKEN>"
```

Full field-by-field reference (public vs admin payloads, the `quotas` `source` tags,
the declared-cap `app_config` rows, and the optional provider usage-API tokens) lives in
[`Environment_Configuration.md` → “/health as a self-service diagnostic”](./Environment_Configuration.md#health-as-a-self-service-diagnostic).

### Database (Postgres) — environment ↔ provider mapping

The backend runs on Postgres when `USE_DB=true` (required in production —
crowdsourced prices, devices, barcode and receipts have **no JSON fallback**).
The PROVIDER is chosen entirely by `DATABASE_URL` per environment — the code is
provider-neutral (vanilla `pg`, schema-qualified to `priceback`). On Supabase the
app database is `postgres` (the Supabase default); app tables live in the
`priceback` schema. **Both environments now run on Supabase — Neon is fully retired.**

| Environment | Provider | Where / id | Use |
|---|---|---|---|
| **Production** (app release backend) | **Supabase** | project `xjfrlzwonyaorwktnkpj`, Railway env `DATABASE_URL` (5432 session-pooler/direct, NOT the 6543 transaction pooler) | Real user/billing data. See `docs/Supabase_Cutover.md`. |
| **Dev / tests / dev deploys** | **Supabase** | project `gnedluuylimjwdmtvswl`, session-pooler URL in `backend/.env` | `npm test` DB suites + `npm run db:seed-test`. Safe to mutate. |

> Neon (both the old `Preview` and `production` branches) is retired — no longer
> serves traffic and is not a test/migrate target. Historical Neon references in
> `docs/Bugs_Common_Fixes.md` are kept as past-incident records, not current config.

Rules:
- **Never** run tests or seeds against production. The DB integration
  suites (`tests/*Db.test.js`) and `db:seed-test` target the **dev Supabase** project.
- New schema: hand-write an idempotent migration (`IF NOT EXISTS` / `DO $$` guards)
  + a `meta/_journal.json` entry — do **not** use `drizzle-kit generate` (its
  snapshots intentionally lag; see `docs/Supabase_Cutover.md`). Then run
  `npm run db:migrate` against **each** target: **dev** Supabase first, then
  `DATABASE_URL=<prod supabase> npm run db:migrate` for production at release.
- Connection strings carry credentials — keep them in the Railway/host env
  (or a gitignored `.env`), never committed.

---

## Railway environment variables

Set these on **each** Railway service — `priceback-development` and
`priceback-production` — under **Service → Variables**. The values can (and for
secrets *should*) differ per environment; only the **names** are shared.

`backend/.env.example` is the local-dev template, but it is **not exhaustive** — the
full operational list is below. The canonical "which build → which backend → which DB"
chain is in [`Environment_Configuration.md`](./Environment_Configuration.md); the DB
provider/cutover detail is in [`Supabase_Cutover.md`](./Supabase_Cutover.md).

> **After changing any variable, redeploy the service** (Railway → Deployments →
> Redeploy) — variables are read at process start. Confirm with
> `GET /health` (version) and, for admin/quota vars, `GET /health?token=…`.

### Required (production won't work without these)

| Variable | What it is | How to obtain / set |
|---|---|---|
| `USE_DB` | Gates all DB-backed routes (receipts, credits, crowd, devices, barcode). | `true` on both services. |
| `DATABASE_URL` | Postgres connection string. **Session pooler, port 5432** (NOT 6543). | Supabase → Project → Connect. Dev → `gnedluuylimjwdmtvswl`, prod → `xjfrlzwonyaorwktnkpj`. See [`Supabase_Cutover.md`](./Supabase_Cutover.md). |
| `GOOGLE_CLIENT_ID` | Web OAuth client ID — audience for verifying Google ID tokens on `/api/me/*`. | console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 (Web). |
| `GOOGLE_CLIENT_ID_ANDROID` | Android OAuth client ID — second accepted audience. | Same project → OAuth 2.0 (Android). |
| `GOOGLE_VISION_API_KEY` | Vision OCR proxy (`/api/ocr`). | Same project → enable Cloud Vision API → create API key. |
| `FLYER_ADMIN_TOKEN` | **Admin token** for the `/api/flyer/import` + `/api/admin/*` routes and the `/health` admin/quota view. **Currently unset on both services — this is why the `/health` quotas don't appear.** | Self-generated secret — no provider. Generate one and paste the same value into Railway: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`). Then call `/health?token=<that value>`. |
| `PORT` | Listen port. | **Injected by Railway automatically** — do not set manually. |

### Admin & integration secrets (set as needed)

| Variable | What it is | How to obtain |
|---|---|---|
| `ADMIN_TOKEN` | Optional separate secret for the credit-revocation tooling; **falls back to `FLYER_ADMIN_TOKEN`** if unset. | Self-generated; leave unset to reuse `FLYER_ADMIN_TOKEN`. |
| `ADMIN_USER_SUBS` | Comma-separated Google `sub` IDs granted in-app admin (verified-drop push bypass, admin flags). **Currently empty — Maxim must add his own `sub`.** | Your Google account's `sub` (read it from `/api/me` or a decoded ID token). |
| `REVENUECAT_WEBHOOK_TOKEN` | Bearer secret verifying `POST /api/revenuecat/webhook`. | Self-generate, then set the **same** value in RevenueCat → Integrations → Webhooks → Authorization header. |
| `GEMINI_API_KEY` | Enables the LLM reconciliation route (`/api/ocr-llm`) + `gemini_llm` budget. Unset = feature disabled (degraded, not down). | aistudio.google.com → API keys. |

### Email alerts (optional — auth-failure canary & ops alerts)

| Variable | What it is |
|---|---|
| `RESEND_API_KEY` | Resend API key (resend.com) — enables outbound alert email + the `email_*` quota counters. |
| `ALERT_EMAIL` | Recipient for ops alerts (e.g. the auth-failure spike alert). |
| `ALERT_FROM` | From-address for alert email (must be a Resend-verified sender). |

### Object storage (receipt images)

| Variable | What it is |
|---|---|
| `OBJECT_STORE` | Backend selector: `r2` (current) or `gcs`. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 — dash.cloudflare.com → R2 → bucket + "Object Read & Write" API token. |
| `GCS_BUCKET` (+ `GOOGLE_APPLICATION_CREDENTIALS`) | Google Cloud Storage — dormant until `OBJECT_STORE=gcs`. |

### Optional live-usage tokens for `/health` quotas

Unset = the quota shows its **declared cap** (`source: "declared-cap"`); set = it upgrades
to a live `api` reading. See [the `/health` quota reference](./Environment_Configuration.md#provider-quota-ceilings-admin-only).

| Variable | Upgrades quota |
|---|---|
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (+ `R2_BUCKET`) | `r2_storage` → live R2 bytes |
| `RAILWAY_API_TOKEN` | `railway` → live USD spend |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` | `sentry_events` → live 30-day event count |
| `SUPABASE_PROJECT_REF` | Supabase project reference (used by quota probing). |

### Tuning knobs (optional — sensible defaults in `config/defaults.js`)

Most are overridable at runtime via the `app_config` table (no redeploy); set an env var
only to **pin** a value. Defaults shown in parentheses.

| Variable | Effect |
|---|---|
| `DB_POOL_MAX` (`5`) | Per-process `pg` pool cap. CI uses `3` (pooler ceiling). |
| `DATA_DIR` | Path for legacy JSON pools / volume mount (e.g. `/data`). |
| `PRICE_SWEEP_INTERVAL_MINUTES` (`1440`) | Minutes between scheduled price sweeps (floor 15). |
| `DEFAULT_PROVINCE` (`ON`) | Fallback province for price lookups. |
| `REFERRAL_REFERRER_CREDITS` / `REFERRAL_REFEREE_CREDITS` | Credits granted on referral. |
| `ALERT_COOLDOWN_MS` (`3600000`) | Min gap between repeat ops alerts. |
| `AUTH_FAIL_WINDOW_MS` (`600000`) / `AUTH_FAIL_ALERT_THRESHOLD` (`20`) | Auth-failure canary window + alert threshold (`checks.auth` in `/health`). |
| `AUDIT_FLUSH_AT` (`100`) / `AUDIT_FLUSH_EVERY_MS` (`5000`) | Audit-log buffer flush size / interval. |

> Quota **declared caps** (`SUPABASE_DB_LIMIT_MB`, `SUPABASE_MAX_CONNECTIONS`,
> `RESEND_MONTHLY_LIMIT`, `RESEND_DAILY_LIMIT`, `R2_STORAGE_LIMIT_GB`,
> `RAILWAY_USAGE_LIMIT`, `SENTRY_EVENTS_LIMIT`, `OCR_MONTHLY_LIMIT`,
> `LLM_GLOBAL_DAILY_LIMIT`) are normally tuned as `app_config` rows when you upgrade a
> plan — bump the row, no redeploy. They can also be pinned via env. See `config/defaults.js`.

### ⚠️ Security note

`backend/.env.example` currently contains **real-looking R2 credentials** committed to the
repo (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). If those are live, rotate them in
Cloudflare and replace the file's values with empty placeholders. Tracked alongside the
other pre-launch ops items in [`PUBLISH_CHECKLIST.md`](./PUBLISH_CHECKLIST.md) §8A.

---

## Build Checklist

Before every build:

- [ ] `npm install` completed without errors
- [ ] `npm install react-native-worklets@0.7.1` (if fresh install)
- [ ] `npx expo install --fix` (resolves version mismatches)
- [ ] `git add . && git commit` (EAS requires clean git state)
- [ ] API keys set (at minimum: Google Vision)
- [ ] Version bumped in `package.json`, `app.json` (version + versionCode + buildNumber)
- [ ] Backend URL set if deployed

---

## Version Bumping

Update in 5 places:
```
package.json         → "version": "X.Y.Z"
app.json             → "version": "X.Y.Z"
app.json             → android.versionCode: N (increment by 1)
app.json             → ios.buildNumber: "N" (increment by 1)
src/screens/SplashScreen.js → version display text
```

---

## Project Structure

```
PriceBack/
├── App.js                          # Root: ThemeProvider, navigation, tab bar
├── app.json                        # Expo config, bundle IDs, permissions
├── eas.json                        # EAS Build profiles
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript (incremental migration)
├── jest.config.js                  # Test config
├── babel.config.js                 # Babel + Reanimated plugin
├── metro.config.js                 # Node module stubs
├── .npmrc                          # legacy-peer-deps=true
├── TECHNICAL_DEBT.md               # Bug tracker
├── assets/                         # Icon, splash, favicon
├── backend/                        # Express price-check server
│   ├── server.js
│   └── package.json
├── __tests__/                      # Jest test suites
│   ├── ocrService.test.js
│   ├── priceService.test.js
│   └── storageService.test.js
└── src/
    ├── types.ts                    # TypeScript interfaces
    ├── stubs/empty.js              # Node module stubs
    ├── components/
    │   ├── index.js                # Button, Card, StatTile, etc.
    │   └── Icons.js                # Icon, TabIcon, StoreIcon
    ├── constants/
    │   ├── theme.js                # Colors, fonts, spacing (dark/light)
    │   ├── ThemeContext.js          # Dark mode provider
    │   └── stores.js               # 20 Canadian stores
    ├── screens/
    │   ├── SplashScreen.js
    │   ├── OnboardingScreen.js
    │   ├── HomeScreen.js
    │   ├── ReceiptsScreen.js
    │   ├── ScanScreen.js           # OCR scan + paywall
    │   ├── DetailScreen.js
    │   ├── BarcodeScanScreen.js
    │   ├── ClaimAssistantScreen.js
    │   ├── SavingsStreakScreen.js
    │   ├── EmailSyncScreen.js
    │   └── StoresAndProfileScreens.js
    └── services/
        ├── ocrService.js           # Google Vision + Veryfi OCR
        ├── priceService.js         # Price checking + watch registration
        ├── storageService.js       # AsyncStorage CRUD
        ├── notificationService.js  # Push notifications
        ├── emailSyncService.js     # Gmail/Outlook OAuth
        ├── purchaseService.js      # IAP tiers + anti-reinstall
        ├── analyticsService.js     # Event tracking
        └── i18n.js                 # English/French translations
```
