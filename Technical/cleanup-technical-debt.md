# Codebase Cleanup — Residual Technical Debt

**Created:** 2026-07-30 · **Branch:** `chore/codebase-cleanup`

Companion to the source-tree cleanup sweep. That sweep removed what was provably dead.
This document records everything that **looked** removable but was deliberately **kept**,
plus the follow-ups that need a human decision or a cloud console.

Read this before any future "remove unused code" pass — most items here were investigated
once already, and several are traps that would break production if deleted.

---

## 1. Uncalled HTTP routes — KEPT ON PURPOSE

Four backend routes in `backend/server.js` have **zero callers** in `src/**`, in any job,
and in any script:

| Route | Evidence |
|---|---|
| `POST /api/check-all` | No `src/` hit. `POST /api/check-price` is the live path. |
| `POST /api/unwatch` | No `src/` hit, while `POST /api/watch` has 2. |
| `DELETE /api/me/observations` | No `src/` hit. Client erasure goes through `DELETE /api/me/account`. |
| `GET /api/me/contributions` | No `src/` hit. |

**Why they stay:** older app versions remain installed on user devices long after a store
release. Deleting a route the current bundle no longer calls is a *silent breaking change*
for everyone who hasn't updated. `Operations/TECHNICAL_DEBT.md` confirms `/api/unwatch`
was validated end-to-end in v2.5.0, so it demonstrably shipped in real builds.

**How to decide later:** gate on telemetry, not on grep. Add request logging (the
`api_audit_log` table already exists), watch for ~2 release cycles, and delete only routes
with zero real traffic from any client version. Removing them purely because the current
`src/` doesn't call them is not sufficient evidence.

---

## 2. Firebase / Google Sign-In — retired `ca.priceback.app` bundle id

Both platforms are now `com.priceback` (`app.json` → `ios.bundleIdentifier`,
`android.package`). The retired id survives in **cloud state**, which code cleanup cannot
reach:

- **Orphaned Firebase Android app.** `google-services.json` (gitignored, local) still
  carries a second client block for `package_name: "ca.priceback.app"`
  (`mobilesdk_app_id: 1:695135372222:android:df12d8bffc75090960afef`) alongside the live
  `com.priceback` one. Delete that app in Firebase console → project `priceback-905d4`,
  then regenerate with `node scripts/configure-google-signin.mjs`.
- **iOS OAuth client may still be bound to the retired bundle id.** The deleted
  `GoogleService-Info.plist` carried `BUNDLE_ID = ca.priceback.app` with client
  `695135372222-fgs51595ntobg6t83hnkhqi7jg74qrss`. That same client id is what
  `config/profiles/common.js` (`googleClientIdIos`) and `app.json`'s `iosUrlScheme` ship
  today. `.env.example` explicitly warns the iOS client "is a placeholder you must
  provision in GCP for bundle id com.priceback before iOS builds work."

  **Risk: iOS "Continue with Google" fails with `DEVELOPER_ERROR`** if the OAuth client is
  still registered against `ca.priceback.app`. Google matches native apps on bundle id +
  signing cert. **Verify in GCP console before App Review** — this is a first-screen
  failure and a Guideline 2.1 rejection risk.

`GoogleService-Info.plist` itself was deleted: nothing referenced it (there is no
`ios.googleServicesFile` key anywhere) and the google-signin config plugin writes the
`iosUrlScheme` into `Info.plist` at build time.

---

## 3. Traps — things that look dead but MUST NOT be deleted

Each of these was flagged as "unused" by static analysis and verified load-bearing.

| Item | Why deleting it breaks something |
|---|---|
| `backend/shared/*.js` (byte-identical to root `shared/`) | **Not duplication.** Railway's build context is `backend/`, so it cannot see `../shared`. `backend/scripts/sync-shared.js` mirrors the files on `postinstall`/`prestart`/`pretest`; the committed copies are what actually run in production. "Deduplicating" breaks deploys. |
| `babel-plugin-transform-remove-console` | Referenced by Babel's **bare-name convention** (`"transform-remove-console"` in `babel.config.js`), so a package-name grep returns zero. It strips `console.*` from production builds. |
| `usersRepo.deleteAccount` | Reported as dead; actually the hard-delete cleanup helper used by **35** backend test files. |
| `costcoReceiptParser.parseCostcoWarehouseReceipt` | Reported as a "superseded twin"; actually called internally at lines 367 and 388. |
| `catalogLabels.catalogFeatures` | Reported as dead; called internally at line 119. |
| `src/stubs/empty.js` | Resolved dynamically by `metro.config.js` for 16 Node built-ins. |
| `src/stubs/expo-modules-core.d.ts` | Referenced by `tsconfig.json` `paths`; deleting breaks `npm run typecheck`. |
| `config/profiles/index.js` | Directory import (`require("./config/profiles")` in `app.config.js`). |
| `__mocks__/react-native-purchases.js` | Wired by jest `moduleNameMapper` (string key, never imported). |
| `expo-updates`, `expo-dev-client`, `patch-package`, `react-native-purchases-ui` | Autolinked native modules / postinstall tooling with zero JS imports by design. |
| `backend/repos/watchedRepo.js` | Intentionally dormant for v1; documented in `.c8rc.json`'s exclude rationale. |
| `backend/drizzle.config.js` | Loaded by the `drizzle-kit` CLI by filename convention. |
| `@maximlucas__priceback-canada.jks` | Play **upload keystore**. Referenced by no build path (EAS holds the canonical copy), but losing it can permanently block Play updates. Back up off-repo; never auto-delete. |
| `sa.json` | Live GCP service-account key referenced by `eas.json` → `serviceAccountKeyPath`; required for `eas submit`. |

**General lesson:** in this repo, "zero grep hits" is *not* evidence of death. Dynamic
`await import()`, Babel/Jest string keys, Expo plugin autolinking, directory imports, and
filename-convention CLI loading all hide real usage.

---

## 4. Over-exported internal symbols — leave the `export` keyword alone

Many symbols in `src/services/*` and `backend/repos/*` are exported but have no *external*
production importer. They are **unit-test seams**, not dead code:

- Mobile examples: `syncService.mergeServerIntoLocal`, `notificationService.receiptClaimableDropSavings`, `storageService.CLOUD_PREF_KEYS`, and most of `receiptParsingShared.js` (18 symbols).
- Backend examples: `creditsRepo.balanceReconciles`, `pricesRepo.latestForSku`, `lib/appleAuth.__resetJwksCacheForTests`, `configService.isWarm`.

Removing the `export` keyword makes those lines unreachable from tests, **drops coverage
below the ratchet in `jest.config.js` / `backend/.c8rc.json`, and fails CI.** The floors
only ever go up, so this is a one-way trap. Leave them exported.

---

## 5. Pre-existing issues found but out of scope

Neither was introduced by the cleanup; both reproduce on a clean `main`.

1. **`backend` test suite cannot fully run locally.** `backend/.env` has no
   `DATABASE_URL`, so 255 DB-gated tests skip, `tests/creditReconGuards.test.js` fails
   with `DATABASE_URL is not set`, and c8 reports ~63% against 90% floors. CI supplies the
   secret and is the real gate. Add a local `DATABASE_URL` (Supabase **dev** project — not
   prod, and never Neon) to validate backend changes locally.
2. **`npx expo-doctor` reports 2 failures:**
   - `expo-modules-core` "should not be installed directly." It is kept because
     `tsconfig.json` `paths` points at `src/stubs/expo-modules-core.d.ts` for typecheck.
     Removing the direct dependency needs that path story resolved first.
   - `expo-apple-authentication` major mismatch — expected `~55.0.15`, found `8.0.8`. Worth
     resolving before submission; `npx expo install --check` is the fix path.

---

## 6. Kept: unreferenced-by-automation operator scripts

Not wired to any npm script or CI job, but intentionally retained — documented one-shot
operator tools:

- `scripts/configure-google-signin.mjs` — repairs Google Sign-In / regenerates
  `google-services.json` from any machine using a service-account key.
- `scripts/gen_brand_assets.py` — brand asset generator.
- `backend/scripts/{backfill-warehouse-coords,gen-warehouses-json,build-consolidated-schema,upsert-personal-care-barcodes}.js`
  — `build-consolidated-schema.js` in particular regenerates `backend/db/deploy/schema.sql`,
  the official fresh-deploy reference.
- `backend/data/flyer-imports/costco-on-2026-05-11.json` — sample payload for the
  `POST /api/flyer/import` operator route.
- `backend/db/deploy/store-content-sync.sql` — hand-run data-sync SQL.

---

## 7. Undocumented backend env vars

~22 variables are read via `process.env` in `backend/**` but appear in no doc. Several are
present in `backend/.env.example`; the rest are set in the Railway dashboard. They are all
string-keyed config — **never delete a `process.env` name based on a grep.**

`ALERT_COOLDOWN_MS`, `ALERT_EMAIL`, `ALERT_FROM`, `APPLE_BUNDLE_ID`,
`AUTH_FAIL_ALERT_THRESHOLD`, `AUTH_FAIL_WINDOW_MS`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `CREDIT_RATE_LIMIT_PER_MIN`, `DEFAULT_PROVINCE`,
`GEOCODER_USER_AGENT`, `OCR_AUTH_PROBE_CRON`, `PRICE_DROP_MIN_SAVINGS`,
`RAILWAY_API_TOKEN`, `RAILWAY_ENVIRONMENT_NAME`, `RC_ALLOW_SANDBOX`,
`REFERRAL_REFEREE_CREDITS`, `REFERRAL_REFERRER_CREDITS`, `RESEND_API_KEY`,
`REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_TOKEN`, `SUPABASE_PROJECT_REF`.

**Action:** audit `backend/.env.example` against this list and add the missing ones as
documented placeholders.

---

## 8. Open security/ops item (unchanged by this sweep)

The gitleaks step in `.github/workflows/test.yml` is still disabled (`if: false`) pending
credential rotation. It **must be re-enabled before the app is published**. See
`Publishing-Compliance/` for the checklist.
