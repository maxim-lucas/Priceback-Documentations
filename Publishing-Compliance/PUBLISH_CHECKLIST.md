# PriceBack — Publish Checklist

Last updated: 2026-07-24 · App version 2.8.0 · Backend 2.7.0

Everything in this doc is a **manual** step that lives outside the codebase.
The code is ready; these are the credentials, consoles, accounts, and
artifacts you need to set up yourself before either store accepts a build.

This is the single source of truth for launch. It absorbs the former
`security-prelaunch-checklist.md` (now folded into §8A/§9/§10/§12) and the
still-open findings of the 2026-07-06 pre-publish audit (its state-corrections
are reflected throughout; the full audit narrative lives in git history).
Companion references: `docs/Publish_Requirements.md` (backend env vars),
`docs/REVIEWER_NOTES.md` (store review copy), `docs/SecurityRecommendations.md`
(deferred/optional security items), `docs/incident-response.md` (breach runbook).

Order matters. Suggested sequencing at the bottom (Section 18).

---

## Pre-launch Status Summary

Quick-scan table — update as items are completed.

| Area | Status | Notes |
|---|---|---|
| priceback.ca website | ✅ Live | Cloudflare Pages; legal pages + FR variants hosted |
| Legal pages (privacy / terms / support) | ✅ Hosted | `priceback.ca/privacy`, `/terms`, `/support`, `-fr` variants |
| Apple Developer enrollment | ⏳ Pending | §0 — $99/yr, 24–48h approval |
| Google Play Console enrollment | ✅ Done | §0 — enrolled |
| RevenueCat — real API key + SKU config | ✅ Done (Play) | §2 — all 5 SKUs live in Play + RC, `default` offering resolves annual+monthly. iOS still pending (App Store Connect not launched) |
| RevenueCat prod purchase recording | ✅ Done | §2 — both `REVENUECAT_WEBHOOK_TOKEN` and `REVENUECAT_SECRET_KEY` set on Railway prod (also mirrored to dev); `/health` confirms `revenuecat.webhook: "configured"` and `revenuecat.syncApi: "configured"` (verified 2026-07-11) — see `docs/RevenueCat_Paywall_Config.md` |
| iOS Google OAuth client + plist | ✅ Done | §3 — client created; `GoogleService-Info.plist` at repo root (gitignored); `iosUrlScheme` wired in `app.json` |
| Apple Sign In With Apple capability | ⏳ Pending | §4 |
| Sentry DSN | ✅ Done | §5 — DSN in `config/profiles/common.js`; `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` set as EAS secrets for both dev and prod |
| Azure / Microsoft OAuth (Outlook sync) | ✅ Configured | §6 — verified in Azure portal 2026-07-08: redirect URI matches code, `Mail.Read`+`User.Read` granted, **public client flows enabled (was off — fixed)**, EAS secret set. Only an on-device sign-in smoke test remains |
| Railway production env vars | ⏳ Pending | §8 — see `docs/Publish_Requirements.md` |
| **Production DB migrations** | ✅ Done | §8B — migration chain re-squashed into a single `0000_initial.sql` and applied to prod 2026-07-11, verified directly against the prod DB. Barcode upsert script also run against prod. Credit-management data fixes (§8B) still owed separately. |
| Credit management (referral / auto-reload / packs / ledger) | ✅ Audited | 2026-07-05 full audit + tests green — `docs/Credit_Management_Audit.md`; auto-reload prompt restored to the 50-credit threshold; prod data fixes folded into §8B |
| Security credential rotation | ⚠️ BLOCKER | §8A — Vision key + Supabase password |
| ADMIN_USER_SUBS set on Railway | ✅ Done | §8 — set on Railway prod |
| Store listing assets (screenshots, icons) | ⏳ Pending | §13 |
| App Store Connect metadata | ⏳ Pending | §9 |
| Google Play Console metadata | ⏳ Pending | §10 |
| Android permissions hygiene (AD_ID / RECORD_AUDIO / FINE_LOCATION stripped) | ✅ Done | §10 — `plugins/withAndroidPermissionCleanup.js`; verified against a fresh prebuild manifest 2026-07-24. Data Safety "advertising ID" = No |
| Google Sign-In status-code error handling | ✅ Done | Bug #128 — full GMS-code classification + transient retry in `authService.signInWithGoogle` |
| Account-deletion web URL (Play requirement) | ✅ Built | `priceback.ca/delete-account` (+ `-fr`) — `Priceback-Website` PR #7; merge to deploy, then set in Play Console → Data deletion |
| Data Safety + content-rating answers | ✅ Prepared | `docs/Play_Data_Safety_Answers.md` — copy-paste; still needs entering in the console |
| French store listing localizations | ⏳ Pending | §15 |
| Demo account + Review Notes | ⏳ Pending | §14 — notes content done 2026-07-11, only the demo Google account itself remains |
| Privacy Impact Assessments (PIAs) | ✅ Done | §1/§12 — `legal/pia/*.md` written 2026-07-11 |
| Store description drafts | ✅ Done | §9/§10/§13 — `marketing/*.md` written 2026-07-11, review before pasting |
| Pre-submission smoke test | ⏳ Pending | §11 |
| GitHub Actions CI | ✅ Re-enabled | Was disabled 2026-07-11 (free-tier minutes exhausted); `push`/`pull_request`/`release` triggers restored 2026-07-23 in both workflows under `.github/workflows/`. Watch Actions usage so it doesn't re-exhaust before publish. |
| Gitleaks secret scan (in CI) | ⚠️ Disabled | 2026-07-23 — the gitleaks step in `.github/workflows/test.yml` (`security` job) is muted via `if: false` because it's currently flagging 8 leaks in the tree, tangled up with the §8A credential-rotation blocker below. Step is kept in the file (not deleted) for a one-line revert. **MUST re-enable (remove the `if: false`) before publish**, once the §8A rotation/investigation is resolved. |

---

## 0. Developer-account enrollment (HARD BLOCKER — start first)

You cannot submit anything without these. Both take real money + identity
verification + some days.

- [ ] **Apple Developer Program** — $99 USD/year. Enroll at
  https://developer.apple.com/programs/. Requires a D-U-N-S number if
  you're enrolling as an organization (free, takes 1–14 days). Individual
  enrollment is faster but the App Store listing shows your personal
  name. Approval after payment: 24–48 hours.
- [x] **Google Play Console** — ✅ enrolled.
- [ ] **Apple ID for Sign In with Apple** — already covered by your dev
  account.
- [ ] (Optional) **Apple Tax & Banking setup** in App Store Connect →
  Agreements, Tax, and Banking. Required before paid subscriptions can
  go live, even for free apps in some jurisdictions.
- [ ] (Optional) **Google Payments merchant account** — required for IAP.
  Set up in Play Console → Setup → Merchant account.

---

## 1. Legal — privacy policy + terms + support (BLOCKER for both stores)

Source of truth for the legal HTML lives in the separate `Priceback-Website`
repo (the old in-app-repo `legal/*.html` copies were removed in `ffc874c`).
They cover everything PriceBack actually collects and respect every Canadian
privacy regime currently in force (PIPEDA federal, Quebec Law 25, Alberta
PIPA, BC PIPA) plus CCPA and GDPR. Canonical live URLs (the ones the app's
`src/constants/legal.js` links):

| URL | File (in `Priceback-Website` repo) |
|---|---|
| `https://priceback.ca/privacy-policy` | `privacy-policy.html` |
| `https://priceback.ca/privacy-fr` | `privacy-fr.html` |
| `https://priceback.ca/terms-of-service` | `terms-of-service.html` |
| `https://priceback.ca/terms-fr` | `terms-fr.html` |
| `https://priceback.ca/support` (+ `/support-fr`) | `support.html` / `support-fr.html` |

**You must:**
- [x] Stand up `priceback.ca` — **DONE.** Hosted on Cloudflare Pages (`Priceback-Website` repo, `main` branch → live). `wrangler.jsonc` config; `_redirects` handles URL aliases.
- [x] Upload all legal HTML files at the paths above — **DONE.** `privacy-policy.html`, `terms-of-service.html`, `support.html`, and their `-fr` variants are committed to the website repo and served.
- [x] Verify the canonical URLs return 200 — **re-verified 2026-07-08**: all six canonical paths (`privacy-policy`, `privacy-fr`, `terms-of-service`, `terms-fr`, `support`, `support-fr`) return 200. The bare `/privacy` and `/terms` short aliases now return **301 redirects** to the canonical long paths (previously 404 — the `_redirects` aliases have since been added), so either form is safe in store metadata.
- [ ] Update the email addresses `privacy@priceback.ca`, `security@priceback.ca`, and `support@priceback.ca` to mailboxes you actually monitor. Apple will email these during review. (MX records for priceback.ca now exist — Namecheap `eforward*` forwarding, verified 2026-07-06. **In-app contacts are already flipped off the personal fallback** — verified 2026-07-08: `config/profiles/common.js`, `src/constants/contact.js`, and `app.json` all default to the `@priceback.ca` role addresses; `grep "viacesi|maxim.lucas@"` over `src/ config/ app.json` = 0 hits (commit `ca97121`/#137). **Only remaining:** send a test mail to each of the three role addresses to confirm the `eforward` forwards actually deliver.)
- [ ] **Quebec Law 25 (since 22 Sept 2023):** confirm `privacy@priceback.ca` is monitored by the named Privacy Officer (currently Maxim Lucas in the template — update if different). Law 25 §3.1 requires the privacy officer to be publicly identifiable and reachable.
- [x] **Quebec Law 25 §3.3 — Privacy Impact Assessments (PIAs):** ✅ **2026-07-11** — one-page PIAs written for all three projects the privacy policy references: `legal/pia/flyer-pipeline.md`, `legal/pia/crowdsourced-pricing.md`, `legal/pia/sentry-crash-reporting.md`. The crowdsourced-pricing PIA's open action item (time-box R2 photo retention) is **resolved** ✅ **2026-07-11** — `RETENTION_TAG_PHOTOS_DAYS` (default 30) + `backend/jobs/pruneTagPhotos.js`, wired into the daily `runDbRetentionJobs()` maintenance cron; deletes the R2 object and clears `tag_scan_reviews.image_object_key` once a review is 30+ days old, keeping the review row (raw OCR text, parsed fields, verify/reject decision) as the audit trail.
- [ ] **Quebec Law 25 §17 — cross-border transfer assessment:** the policy lists Railway, Google Cloud, Sentry, and RevenueCat (all US). Have your written assessment of equivalent protection ready in case the CAI asks (they rarely do at this stage but it's a Law 25 requirement on paper).
- [ ] If your business address differs from "Ottawa, ON" in the template footer, update it.

**Privacy-policy content gaps (legal-text edits in the `Priceback-Website` repo —
both the EN and `-fr` mirrors — NOT auto-applied):**

> **⚠️ Superseded by the live policy's approach (verified 2026-07-08).** The
> gaps below assume the policy *enumerates* vendors (and were written when it
> did). The **currently-live** `priceback.ca/privacy-policy` has been simplified
> to name generic processor **categories** ("cloud hosting, text extraction
> (OCR/AI), crash reporting, subscription management") plus *"a current list of
> the specific providers is available from the Privacy Officer on request"* — it
> names **no** individual vendor. Under that design the four items below are
> **resolved-by-design**: there is no per-vendor list to add Supabase / Cloudflare
> R2 / Microsoft Graph to, and Email Sync is already covered generically ("any
> data from third-party email accounts … if you explicitly connect them"). Keep
> the "list on request" register current (add Supabase, Cloudflare R2, Microsoft
> Graph/`Mail.Read` there) and you satisfy PIPEDA/Law 25 without touching the
> HTML. **Only** re-open the items below if you decide to switch back to naming
> vendors inline in the policy text.

- [ ] **Name Supabase as a processor/subprocessor.** The policy lists Railway,
  Google Cloud Vision, Google AI Studio (Gemini), Sentry, and RevenueCat, but the
  database (all account data, receipts, credit ledger) is hosted on **Supabase**
  (AWS). Add it to the processors list AND the Quebec Law 25 §17 cross-border list.
- [ ] **Disclose price-tag photos stored in Cloudflare R2.** The policy says receipt
  images are processed by Vision "and discarded" — true for receipts, but
  **price-tag scan photos are uploaded and retained in Cloudflare R2** for admin OCR
  review (`/api/observations/tag` presigned upload), now for **30 days** (`RETENTION_TAG_PHOTOS_DAYS`,
  `backend/jobs/pruneTagPhotos.js`). Disclose that retention window + purpose and
  add Cloudflare to processors + cross-border list.
- [ ] **List the Costco membership number as collected data.** The OCR pipeline
  extracts `member_id` and stores it on `receipts.member_id` (never echoed to the
  app; included only in the `/api/me/data-export` payload). It's personal info —
  list it under data collected with the "export-only, never displayed" note.
- [x] *(Soft — resolved-by-design)* **Microsoft Graph / Email Sync** — the live
  policy already covers this generically ("any data from third-party email accounts
  … if you explicitly connect them in the Email Sync feature") and names no vendors,
  so no HTML edit is needed now that Outlook ships enabled. If you keep a "providers
  on request" register, add Microsoft Graph + the `Mail.Read` scope there.

**Verify before submission:** `curl -I https://priceback.ca/privacy-policy` → 200 OK and the same for `/privacy-fr`, `/terms-of-service`, `/terms-fr`, `/support`.

---

## 2. RevenueCat (BLOCKER for production IAP / subscriptions)

The app reads `extra.revenueCatApiKey` from `app.json`. It's currently
`YOUR_REVENUECAT_API_KEY` — a placeholder string. Subscriptions will
silently no-op in production until this is filled.

**You must:**
- [ ] Go to https://app.revenuecat.com → your project → Project Settings → API Keys.
- [ ] Copy the **public** SDK key (`appl_xxxxxxxx` for iOS / `goog_xxxxxxxx` for Android — RevenueCat exposes a single SDK key per platform).
- [ ] Paste it into `app.json` at `expo.extra.revenueCatApiKey`, OR set the EAS secret `REVENUECAT_API_KEY` and add the read in `app.config.js` (mirror the pattern used for `GOOGLE_CLIENT_ID_IOS`).
- [ ] In RevenueCat: configure every SKU from `shared/pricing.config.js`:
      - **Consumable packs** (non-renewing, no entitlement): `priceback_pack_starter` ($3 / 250 credits), `priceback_pack_pro` ($5 / 500 credits), `priceback_pack_max` ($10 / 1,100 credits). Mark each as a non-consumable in RC ("non-subscription" product type) and wire the RC webhook → backend ledger so credits land on purchase.
      - **Subscriptions** (auto-renewing, `unlimited` entitlement for BOTH): `priceback_unlimited_monthly` ($4.99/mo) and `priceback_unlimited_annual` ($49.99/yr — 12 months for the price of 10, marketed as "2 free months").
      - **Legacy SKUs removed:** the old grandfathered Starter/Pro subs and the `priceback_topup_50` pack were deleted in migration 0005 (no pre-launch purchases existed), so there are no grandfathered SKUs to keep live in RC.
- [ ] Link every SKU to its App Store Connect + Google Play product. Consumable packs need different SKUs per platform if either store rejects shared IDs.
- [ ] Test the full pay flows in a TestFlight / Internal Testing build before submitting to production:
      - pack purchase → credits granted via webhook,
      - subscription purchase → entitlement flips,
      - auto-reload at zero balance → OS confirmation dialog appears for the configured pack,
      - subscription cancel → renewal-status row reads "OFF · access until <date>".

---

## 3. Google OAuth — iOS client ✅ DONE

The code is wired (`signInWithGoogle` passes `iosClientId` when present).

**Status:**
- [x] iOS OAuth client created in Google Cloud Console (bundle ID `com.priceback`).
- [x] `GoogleService-Info.plist` downloaded and placed at repo root (gitignored — stays local + uploaded to EAS as a file secret if needed).
- [x] `iosUrlScheme` (`com.googleusercontent.apps.695135372222-fgs51595ntobg6t83hnkhqi7jg74qrss`) wired into the `@react-native-google-signin/google-signin` plugin in `app.json`.
- [ ] Set EAS secret `GOOGLE_CLIENT_ID_IOS` so EAS builds resolve it: `eas secret:create --scope project --name GOOGLE_CLIENT_ID_IOS --value <client-id> --type string`.
- [ ] Verify on the OAuth consent screen that the app is published (not Testing) — Testing limits sign-in to your test-user list.

---

## 3b. Android package rename → Google Sign-In (all envs) ✅ DONE 2026-07-06

Package was renamed `ca.priceback.app` → `com.priceback` in Play Console (GCP
creds also rotated), which broke Google Sign-In with `DEVELOPER_ERROR`. Root
cause was NOT a missing OAuth client — it was the stale `GOOGLE_SERVICES_JSON`
EAS file-secret still carrying the old `ca.priceback.app` config. Full runbook +
recovery tooling: `docs/Signin_Config_Recovery.md`, Bug #74.

Google matches a native app by **package + signing SHA-1**, so every signing
context needs its cert registered on the Firebase `com.priceback` app. All three
are now registered (each auto-provisions its Android Sign-In OAuth client):

- [x] **Play App Signing** SHA-1 `35:47:ED:80:…:69:65` — production Play builds (from `deployment_cert.der`).
- [x] **EAS upload keystore** SHA-1 `2D:43:BC:7F:…:D5:2B` — EAS dev/preview internal APKs (`npx eas credentials -p android`).
- [x] **Expo default debug keystore** SHA-1 `5E:8F:16:06:…:F6:25` — local `manual_build/build-and-install.ps1` builds (release+debug both sign with `android/app/debug.keystore`; this SHA is identical on every machine).
- [x] `GOOGLE_SERVICES_JSON` EAS file-secret updated to the correct `com.priceback` config in **production, preview, AND development** environments.
- [x] Local repo `google-services.json` replaced with the correct 2-app config.
- [x] `googleClientIdAndroid` in `config/profiles/common.js` (`…6ap3mab4…`) matches the auto-provisioned Play-cert client — no change needed.
- [ ] **RevenueCat** (dashboard-only): repoint the Google Play app to `com.priceback` + re-upload the Play service-account JSON (the GCP rotation invalidated the old one). RC's API can't do either.
- [ ] After next build per env, verify sign-in works (Play internal, EAS preview APK, local APK).

> If you add a NEW machine whose local debug keystore differs from the Expo
> default, register its SHA-1 too (`keytool -list -v -keystore
> android/app/debug.keystore -storepass android`).

---

## 4. Apple Sign In With Apple (BLOCKER for App Store)

Apple requires SIWA when you offer any third-party sign-in (Google).
The code plumbing is already in `bc37371` — you toggle the capability
in the consoles.

**You must:**
- [ ] In Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `com.priceback` → Capabilities → **Sign In with Apple** → enable + Save.
- [ ] In App Store Connect, the capability will propagate automatically on the next provisioning profile refresh. If you're using EAS managed credentials, EAS handles the profile.
- [ ] After the first iOS build that uses SIWA, Apple will send a verification email; click through.

---

## 5. Sentry — crash reporting ✅ DONE

The app wires `@sentry/react-native` into the ErrorBoundary +
`analyticsService.reportCrash`. The `@sentry/react-native/expo` plugin
is in `app.json` (org `prosoft-inc`, project `priceback-canada`).

**Status:**
- [x] Sentry project `priceback-canada` created (org `prosoft-inc`).
- [x] DSN hardcoded in `config/profiles/common.js` (all builds get it automatically).
- [x] `SENTRY_DSN` set as EAS secret for both dev and prod environments.
- [x] `SENTRY_AUTH_TOKEN` set as EAS secret for both dev and prod (enables sourcemap upload at build time so stack traces are readable).
- [x] `@sentry/react-native/expo` plugin wired in `app.json` — sourcemaps upload automatically on every EAS build.

**Verify after first EAS build:** open the Sentry dashboard → Issues; throw a test error from the app and confirm the stack trace is symbolicated (readable function names, not `index.android.bundle:1:284271`).

---

## 6. Microsoft OAuth / Azure App Registration ✅ CONFIGURED & VERIFIED (device sign-in test pending)

When `extra.microsoftClientId` is left as the `YOUR_MICROSOFT_CLIENT_ID`
placeholder, the EmailSync screen detects it via the `MICROSOFT_CONFIGURED`
constant (`src/screens/EmailSyncScreen.js`) and hides the Outlook button.
Setting `MICROSOFT_CLIENT_ID` (EAS secret / `.env.local`) resolves a real
client id through `config/profiles/{eas,local}.js`, which opens the gate — no
code change needed to re-enable Outlook.

**Status: fully configured and verified in the Azure portal on 2026-07-08** (app
registration **"Priceback"**, client id `0b696c22-…9448bc05`). Every server-side
prerequisite for Outlook sign-in is confirmed present — the only thing left is an
on-device sign-in smoke test from a real build (§6e), which needs an installed
app, not portal access. Verified:
- **Code + gate:** `connectOutlook` emits `priceback://auth/microsoft-callback`
  (#141); `MICROSOFT_CLIENT_ID` is set as a secret EAS env var in **both
  `production` and `preview`** (confirmed via `eas env:list`), so builds show the
  Outlook button and resolve a real client id.
- **Redirect URI:** the registered "Mobile and desktop applications" redirect is
  exactly `priceback://auth/microsoft-callback` — **matches the code
  character-for-character** (confirmed by zoom), so no `AADSTS50011`.
- **Public client flows:** was **Disabled** → **enabled + saved 2026-07-08**
  (this was a real latent blocker; without it the PKCE token exchange fails with
  `AADSTS7000218`).
- **API permissions:** Microsoft Graph **`Mail.Read`** + **`User.Read`**
  (Delegated) present; admin consent not required (personal accounts consent
  per-user).
- **Supported account types:** "All Microsoft account users" (personal Outlook.com
  can sign in).

> **Soft item (not a blocker):** the app is an unverified-publisher multitenant
> registration, so the consent screen shows an "unverified" notice. Adding an
> **MPN / Partner (MPN ID)** under Branding & properties → publisher verification
> removes it. It does **not** block personal-account sign-in; publisher
> verification is a business-enrollment decision, left to Maxim.

**If you want Outlook sync — Azure App Registration steps:**

### 6a. Create the app registration — ✅ verified 2026-07-08
- [x] Sign in at https://portal.azure.com with your Microsoft account.
- [x] App registration exists — display name **"Priceback"** (client id `0b696c22-…9448bc05`), State = Activated.
- [x] **Supported account types:** "All Microsoft account users" — consumer Outlook.com can sign in. ✓
- [x] **Redirect URI:** `priceback://auth/microsoft-callback` registered under **Mobile and desktop applications** — matches the code exactly. ✓
- [x] **Application (client) ID** captured and wired as `MICROSOFT_CLIENT_ID` (§6d).

### 6b. Configure API permissions — ✅ verified 2026-07-08
- [x] Microsoft Graph **`Mail.Read`** (Delegated, "Read user mail") present. ✓
- [x] Microsoft Graph **`User.Read`** (Delegated) present. ✓
- [x] Admin consent not required (both show "No") — personal accounts consent per-user, which is correct.

### 6c. Enable public-client flows (required for mobile) — ✅ fixed 2026-07-08
- [x] **Authentication → Settings → Allow public client flows** — was **Disabled**, now **Enabled + saved**. (Latent blocker: without it the native PKCE token exchange fails with `AADSTS7000218`.)
- [x] Confirmed the redirect URI `priceback://auth/microsoft-callback` appears under **Mobile and desktop applications**.

### 6d. Configure the app
- [x] Copy the Application (client) ID. Set it as EAS secret `MICROSOFT_CLIENT_ID` — **done: confirmed set in prod+preview via `eas env:list` (2026-07-08).**
  ```
  eas secret:create --scope project --name MICROSOFT_CLIENT_ID --value <client-id> --type string
  ```
  Or paste directly into `app.json` at `expo.extra.microsoftClientId` (less preferred — keep secrets out of version control).
- [ ] No client secret is needed for a public-client mobile app (PKCE flow).

### 6e. Verify on device — ⏳ only remaining Outlook item (needs an installed build)
- [ ] In the app: confirm the Outlook button on the EmailSync screen appears (not hidden). *(Config guarantees it in prod/preview builds; confirm visually.)*
- [ ] Complete a test sign-in with a personal Microsoft / Outlook.com account.
- [ ] Confirm the consent screen shows the app name **"Priceback"** and the `Mail.Read` scope (an "unverified publisher" notice is expected until an MPN ID is added — see the soft item above).

> **Note:** Azure app registrations don't require a paid Azure subscription — a free Microsoft account is sufficient. The app registration itself is free. You only pay for Azure resources (VMs, storage), which we don't use.

---

## 7. Veryfi (OPTIONAL — secondary OCR fallback)

Currently disabled; Google Vision (via backend proxy) does all OCR. Skip
unless you specifically want a redundant OCR provider.

If you do want it:
- [ ] Sign up at https://veryfi.com.
- [ ] Copy `client_id`, `api_key`, `username` into `app.json` extra fields. They're already wired in `ocrService.js` with placeholder detection.

---

## 8. Railway (backend) — production env vars

Backend version 2.7.0 is on `main`. Confirm Railway has the env vars below.
Anything missing means the corresponding feature returns 503 with a clear
error message, but the rest of the app keeps working.

> **Verified via `/health` on prod (2026-07-08):** `db: ok`, and `auth`, `ocr`,
> `ocrLlm`, `email` all read **configured** — i.e. `GOOGLE_CLIENT_ID`(+`_ANDROID`),
> `GOOGLE_VISION_API_KEY`, and `GEMINI_API_KEY` are already set on prod Railway.
> The boxes below are checked to reflect *presence*; the Vision-key **rotation**
> in §8A is a separate BLOCKER that "configured" does not satisfy.

**Required for v1 launch:**
- [x] `GOOGLE_VISION_API_KEY` — OCR proxy. **Set on prod** (`/health ocr: configured`). ⚠️ Still owes rotation — see §8A.
- [x] `GOOGLE_CLIENT_ID` — Web OAuth client ID. **Set on prod** (`/health auth: configured`).
- [x] `GOOGLE_CLIENT_ID_ANDROID` — Android OAuth client ID. **Set on prod** (folded into the `auth: configured` probe).
- [ ] `DATA_DIR=/data` — Railway Volume mount point. Without this, every redeploy wipes watched.json / warehousePrices.json / flyerOffers.json. (Not surfaced by `/health` — verify manually.)

**Required for paid features:**
- [x] `GEMINI_API_KEY` — Plan A (LLM OCR reconciliation). **Set on prod** (`/health ocrLlm: configured`).

**Required for flyer ingestion + admin features:**
- [ ] `FLYER_ADMIN_TOKEN` — generate a random secret (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and set it. The `backend/scripts/import-flyer.mjs` script and the in-app admin Flyer Scan screen need the same value.
- [ ] `ADMIN_TOKEN` — falls back to `FLYER_ADMIN_TOKEN` if unset. Covers credit-revocation tooling (`POST /api/admin/price-tag-credits/revoke`).
- [x] `ADMIN_USER_SUBS` — ✅ set on Railway prod.

**Required for receipt-image storage (tag scan reviews):**
- [ ] `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 credentials. Tag-scan observations save without images if missing, but the admin review screen cannot display photos. See `docs/Publish_Requirements.md §5`.
- [x] `REVENUECAT_WEBHOOK_TOKEN` — shared secret for RevenueCat webhook POSTs. Set on Railway prod and mirrored in RevenueCat → Integrations → Webhooks → Authorization header — confirmed `configured` via `/health` 2026-07-11.
- [x] `REVENUECAT_SECRET_KEY` — RevenueCat secret REST API key, backs `POST /api/me/subscription/sync`. Set on Railway prod (and dev) — confirmed `configured` via `/health` 2026-07-11.

**Recommended (degrade gracefully):**
- [ ] `RESEND_API_KEY` + `ALERT_EMAIL` — budget and auth-failure alert emails. Without them, threshold crossings are logged but no email is sent.
- [ ] `DATA_DIR=/data` — requires a mounted Railway Volume. Without it, `watched.json` and the flyer cache are wiped on every redeploy.

**Verify after setting:** `curl https://priceback-production.up.railway.app/health` — `auth`, `ocr`, `ocrLlm`, and `email` should all read `configured` (confirmed 2026-07-08). R2 / webhook / admin-token presence is not exposed on the public `/health`; verify those from the Railway dashboard.

---

## 8A. Security hardening — rotate credentials & verify (BLOCKER)

The 2026-06-02 security pass landed the code-level hardening (helmet headers,
global error handler, two IDOR fixes, flyer-import rate limit, OCR input
validation, tests in `backend/tests/security*.test.js`). These are the **manual**
follow-ups that must happen before launch. Deferred/optional items:
`SecurityRecommendations.md`; breach runbook: `docs/incident-response.md`.

> During the 2026-06-02 audit, live credentials in the local working
> `backend/.env` were read into audit output, and a (previously revoked) Vision
> key was found in tracked docs. Rotate everything that has ever been printed or
> committed — rotation is cheap; assuming a key is safe is not.

**Rotate credentials (do this even if they "seem fine"):**
- [ ] **Google Vision API key** — rotate in GCP, then restrict the new key:
      Application restrictions → IP addresses → the backend's outbound IP(s);
      API restrictions → Cloud Vision API only. Update `GOOGLE_VISION_API_KEY`
      in Railway. (The old hardcoded key in `TECHNICAL_DEBT.md` was already
      revoked and is now redacted; the *current* key was exposed in audit output
      on 2026-06-02 — rotate it.)
- [ ] **Supabase database password** (inside the production `DATABASE_URL`) —
      reset in the Supabase dashboard, update `DATABASE_URL` in Railway. Confirm
      it is **not** in any tracked file (`.env*` is gitignored — keep it so).
- [ ] Confirm no secrets are committed:
      `git grep -nE "AIza|npg_|postgres://|sk_"` returns only placeholders/docs.
- [ ] Confirm the production `DATABASE_URL` points at the **prod Supabase** project
      (`xjfrlzwonyaorwktnkpj`, session-pooler/direct, not the 6543 transaction
      pooler). Both prod and dev/test now run on Supabase — **Neon is fully
      retired** (dev project `gnedluuylimjwdmtvswl`). Double-check you are not
      targeting the dev project when deploying prod. See `docs/Supabase_Cutover.md`.
- [ ] Confirm the in-app **Delete my account** flow (Apple Guideline 5.1.1(v))
      works end-to-end on a real build: Profile → Delete my account →
      `DELETE /api/me/account`.

**Verify runtime hardening on the live host:**
- [ ] `NODE_ENV=production` set on Railway (suppresses verbose error output).
- [ ] Security headers present:
      `curl -I https://priceback-production.up.railway.app/health` →
      expect `x-content-type-options: nosniff`, `x-frame-options`,
      `strict-transport-security`, and **no** `x-powered-by`.
- [ ] HTTPS enforced (Railway default — confirm no plain-HTTP route is exposed).

**Note — CORS is intentionally open (`origin:"*"`).** The only client is the
native mobile app (Bearer-token auth, no cookies), so this is low-risk. The
allowlist fix is documented in `SecurityRecommendations.md` §1 for when a
browser-based client is added — don't "fix" it blindly.

---

## 8B. Production DB migrations (BLOCKER — run before first prod deploy)

**Status update (2026-07-06 audit):** the production Supabase project
(`xjfrlzwonyaorwktnkpj`) **does have** the full v2 `priceback` schema with live
data (users/receipts/products, incl. the newest `tag_scan_reviews` table), and
the prod Railway backend reports v2.7.0 with `db: ok` — the old "never
migrated" note below is obsolete. What still needs verification on prod:
`npm run db:migrate` against the prod URL should report *No pending migrations*
(confirms `0001_receipt_member_id` + `0002_receipt_warehouse_header_ocr`), and
the data fixes below. Also review Supabase's RLS advisory: all `priceback`
tables have RLS disabled — fine while only the backend connects over Postgres,
but confirm the `priceback` schema is NOT in the Data API exposed-schemas list
(Dashboard → Settings → API), or enable RLS as defense-in-depth.

See `docs/Supabase_Cutover.md` for the Supabase connection format. The prod project
uses the session pooler at port 5432 (never the 6543 transaction pooler).

**Migrations — ✅ DONE on prod, 2026-07-11:**
- [x] `0000_initial.sql` — **re-squashed**: the entire migration chain (previously `0000_initial`
  + `0001_receipt_member_id` + `0002_receipt_warehouse_header_ocr` + `0003_subscription_started_at`)
  is now generated directly from `db/schema.js` as a single `0000_initial.sql`. The old 0001–0003
  files and their journal entries/snapshots no longer exist — do not look for them. Regenerated
  `backend/db/deploy/schema.sql` to match. **Applied to prod** (`xjfrlzwonyaorwktnkpj`) via
  `npm run db:migrate` — verified directly: 36 tables in the `priceback` schema, `receipts` has
  `member_id`/`warehouse_id`/`header_ocr` and no `policy_window`; a second `db:migrate` run against
  prod reported nothing further to apply (idempotent).
- [x] `backend/scripts/upsert-personal-care-barcodes.js` — **run against prod** — both SKUs
  (`1652990`, `3975107`) upserted with their barcodes (prod product ids 19986/19987).

**Credit-management data fixes to apply in the same prod pass (Credit_Management_Audit.md §5):**
- [ ] Verify/fix `priceback.credit_packs` on prod: Starter must be **250 cr / $3** (prod likely still holds the old 300 — the seed's `coalesce(existing, excluded)` upsert can never correct it; fix the row by hand or flip the upsert to `excluded.*` first — Bugs #53)
- [ ] Verify `priceback.app_config`: `AUTO_RELOAD_THRESHOLD_CREDITS = 50`, `REFERRAL_REFERRER_CREDITS = 15`, `REFERRAL_REFEREE_CREDITS = 15`, `FREE_TRIAL_CREDITS = 75` (dev verified 2026-07-05; seed is insert-only so a drifted prod value survives re-seeds)

**How to run:**
```
# Set DATABASE_URL to the prod Supabase session-pooler URL first
DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres \
  npm run db:migrate
```

- [ ] Confirm each migration applied: `npm run db:migrate` should report `No pending migrations` on the second run.
- [ ] Regenerate `backend/db/deploy/schema.sql` if you add more migrations: `node backend/db/build-consolidated-schema.js`.

> **Do not run migrations against dev Supabase** when targeting prod — double-check `DATABASE_URL` first. Dev project ref: `gnedluuylimjwdmtvswl`; prod project ref: `xjfrlzwonyaorwktnkpj`.

> **2026-07-11:** both `npm run db:migrate` and the barcode-upsert script were run against the
> prod Supabase URL (`xjfrlzwonyaorwktnkpj`, session pooler) and independently verified by
> querying prod directly afterward. Still outstanding: the credit-management data fixes below
> (not part of this pass). `REVENUECAT_SECRET_KEY` is now set on Railway prod — see §2 /
> `RevenueCat_Paywall_Config.md`.

---

## 9. App Store Connect — iOS metadata

You need a Mac with Xcode (or use the App Store Connect web UI for most fields).

**App information:**
- [ ] Name: **PriceBack Canada**
- [ ] Subtitle: (max 30 chars) e.g. "Track price drops, get refunds"
- [ ] Bundle ID: `com.priceback` (already set)
- [ ] Primary category: **Finance**
- [ ] Secondary category: **Shopping**
- [ ] Age rating: **12+** (Infrequent/Mild Mature/Suggestive Themes). Rationale: PriceBack displays OCR'd receipt content as free text — product names from any retailer can contain alcohol, tobacco, medications, or other 12+ themes. 4+ implies all content is screened, which we can't guarantee.

**Pricing and availability:**
- [ ] Price: Free (with in-app purchases)
- [ ] Available in: **Canada** only at v1 (matches store coverage). Optionally add USA later.

**App privacy (the "nutrition label"):**
- [ ] Click "Get Started" on App Privacy.
- [ ] Data linked to user: **Email Address** (sign-in), **Name** (sign-in), **Photos** (receipt scans, on-device only — opt out if not synced).
- [ ] Data not linked to user: **Device ID** (hashed for anti-abuse), **Product Interaction** (analytics events), **Crash Data** (Sentry).
- [ ] Data used to track you: **None**.

**Screenshots:** 6.7" iPhone (1290×2796) — bare minimum 3, recommended 5–8. Use Onboarding → Home (price drop) → Detail (claim) → Profile → Receipts.

**App preview video:** Optional but boosts conversion. 15–30s.

**Description:** Drafted 2026-07-11 in `marketing/app-store-description.md` (subtitle, promo text, full description, keywords, what's-new). Apple allows up to 4000 chars. Review/edit the draft, then paste into App Store Connect.

> **v2.3.0 launch posture:** the app ships with Costco as the only
> active store; the other 19 Canadian retailers are visible in the
> Stores tab with a "Coming soon" pill so reviewers can see the
> roadmap. Lead the description with Costco and use a closing line
> like "More Canadian retailers rolling out — opt in per-store from
> the Stores tab to be notified at launch" so screenshots showing
> greyed rows don't look like a bug to App Review.

**Keywords:** (100 char limit, comma-separated, no spaces)
`costco,receipt,refund,price drop,price adjustment,canada,scan,grocery,deals,savings`

**Support URL:** Required. `https://priceback.ca/support` — even a simple page with your contact email works.

**Marketing URL:** Optional. `https://priceback.ca`.

**Sign In with Apple:** Confirm the capability is on (Section 4).

---

## 10. Google Play Console — Android metadata

**Store listing:**
- [ ] App name: **PriceBack Canada**
- [ ] Short description (80 chars): "Scan receipts, track price drops, get refunds from Canadian stores"
- [ ] Full description (4000 chars): drafted 2026-07-11 in `marketing/play-store-description.md` — review/edit before pasting into Play Console.
- [ ] App icon: `assets/icon.png` (Expo provides; verify 512×512 PNG variant).
- [ ] Feature graphic: 1024×500 PNG.
- [ ] Screenshots: 1080×1920 minimum, 4–8 recommended.

**Categorization:**
- [ ] Category: **Finance**
- [ ] Tags: budget, deals, refunds, shopping (max 5).

**Content rating:** Submit the IARC questionnaire — Finance / no violence / no user-generated content → expect "Everyone" rating.

**Data safety form (BLOCKER):**

> **✅ Copy-paste answers ready — `docs/Play_Data_Safety_Answers.md`.** That sheet
> has the exact per-data-type Data Safety rows (Collected/Shared/purpose/required),
> the advertising-ID = No answer, the IARC content-rating answers, and the other
> App-content declarations, all derived from `backend/db/schema.js` + the shipped
> permission set. Enter them verbatim. The list below is the summary.

Declare data collection/sharing accurately — both stores cross-check it against
observed behavior. The authoritative list is derived from `backend/db/schema.js`:

Data collected and linked to the user (account-bound):
- [ ] **Identity:** email, name, OAuth `sub`, profile picture URL (Google/Apple sign-in).
- [ ] **Location (coarse):** postal code / province (user-entered).
- [ ] **Purchases:** receipt metadata (store, date, totals, item names, SKUs, Costco `member_id`), subscription/credit state (via RevenueCat).
- [ ] **Identifiers:** Expo push token; hashed device fingerprint.
- [ ] **Diagnostics:** crash data via Sentry (PII-scrubbed before send).

Third-party processors to disclose (all US except where noted):
- [ ] Google Cloud **Vision** (receipt OCR — images sent, not retained by us),
      Google **Gemini** (opt-in OCR text reconciliation), Google/Apple **OAuth**,
      **Expo/APNs/FCM** push, **RevenueCat** (subscriptions), **Sentry** (crash),
      **Supabase** (production DB, AWS), **Cloudflare R2** (price-tag photos),
      **Railway** (hosting), **Resend** (admin alert email only).
- [ ] Note cross-border transfer to the US. Already covered in the privacy policy;
      reflect it in the store forms.
- [ ] Each entry needs: collected y/n, shared y/n, optional y/n, purpose.
- [ ] Encryption in transit: **Yes** (HTTPS everywhere).
- [ ] User can request data deletion: **Yes** — in-app (Profile → Delete my account → `DELETE /api/me/account`) **and** the web URL `https://priceback.ca/delete-account`. The web page (EN+FR) is **built** — `Priceback-Website` PR #7; merge it (Cloudflare deploys `main`), then paste the URL into Play Console → App content → **Data deletion**.
- [ ] **Advertising ID: No.** The `com.google.android.gms.permission.AD_ID`
      permission is **stripped from the manifest** (see "Permissions hygiene"
      below), so answer "No" to *"Does your app use an advertising ID?"* — this
      matches the shipped APK and avoids the auto-flag Play raises when AD_ID is
      present but undeclared.

**Permissions hygiene (rejection-proofing) — ✅ done in-repo 2026-07-24:**

`plugins/withAndroidPermissionCleanup.js` (wired in `app.json`) removes three
sensitive permissions that dependencies pull in transitively but the app does
**not** use, via manifest-merger `tools:node="remove"`. Requesting sensitive
permissions with no matching feature is a top Play-review rejection cause.

| Permission stripped | Pulled in by | Why it's safe to remove |
|---|---|---|
| `com.google.android.gms.permission.AD_ID` | FCM / Play Services (measurement) | No ads, never reads the advertising ID → Data Safety answers "No" |
| `android.permission.RECORD_AUDIO` | expo-camera (video+audio capability) | Only still photos of receipts/tags are captured — no mic use |
| `android.permission.ACCESS_FINE_LOCATION` | expo-location (adds fine alongside coarse) | "Nearest Costco" needs only coarse; `locationService` requests `Accuracy.Low` |

- [ ] Verify on the built AAB/APK before submitting:
      `aapt dump permissions <apk> | grep -E "AD_ID|RECORD_AUDIO|FINE_LOCATION"`
      → **no output** (confirmed against a fresh `expo prebuild` manifest 2026-07-24).
- [ ] The final declared permission set is then: `CAMERA`,
      `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`,
      `WAKE_LOCK`, `VIBRATE`, `INTERNET`, and the photo-picker media reads —
      each maps to a visible feature, so no Play "Permissions declaration" form
      (foreground-service / SMS / mic / all-files) is triggered.

> **Sign-in robustness:** `authService.signInWithGoogle` now classifies every
> documented Google Play Services status code per Google's guidance — transient
> INTERNAL_ERROR/INTERRUPTED/TIMEOUT are retried once, NETWORK_ERROR surfaces a
> connectivity message, DEVELOPER_ERROR stays loud for us, cancellation is a
> silent no-op — so a Play reviewer on a flaky network is far less likely to hit
> a hard sign-in failure (a common "app doesn't work" rejection). See Bug #128.

**Target SDK:** Google requires API 35 by August 2026. Expo SDK 55 / RN 0.83 → defaults to API 35. Verify with `eas build:inspect`.

**Internal testing → Closed testing → Open testing → Production.** Don't shortcut straight to production for v1 — Internal Testing catches signing / configuration errors that Production rejects.

---

## 11. Pre-submission smoke checklist

Run through this on a real device built from EAS production profile
(NOT Expo Go, NOT a dev client):

- [ ] Onboarding flow completes (Google sign-in works; on iOS, Apple sign-in too)
- [ ] Postal code + province captured
- [ ] Scan a receipt (camera path) → OCR returns items → Save
- [ ] Scan a receipt (gallery path) → same as above
- [ ] HomeScreen shows the receipt with the urgency-tier chip
- [ ] DetailScreen → "+ Add item" works
- [ ] DetailScreen → edit item quantity → save → backend re-registers
- [ ] Profile → Export Data → Month / Quarter / Year / All-time PDF generates and opens the share sheet
- [ ] Profile → trigger a soft crash (uninstall expo-print and try export?) → ErrorBoundary "Try again" recovers without force-quit
- [ ] Push notification arrives (set up a watched item, then `curl -X POST /api/check-all` from a terminal to fire the cron immediately)
- [ ] Subscribe → confirm RevenueCat fires + entitlement flips
- [ ] Unsubscribe → entitlement reverts on the next launch

---

## 12. Canadian compliance — running operational duties

The legal pages cover the user-facing disclosures. These are the
operational duties you must actually perform (or be ready to perform)
after the app is in users' hands.

**PIPEDA + provincial privacy laws — ongoing:**
- [ ] **Designate a Privacy Officer.** Currently named in the template as Maxim Lucas. The role is required by PIPEDA Principle 1 and Quebec Law 25 §3.1. The mailbox at `privacy@priceback.ca` must be monitored — replies expected within 30 days.
- [x] **Maintain PIAs.** ✅ `legal/pia/` created 2026-07-11 with the flyer-pipeline, crowdsourced-pricing, and Sentry PIAs (see §1 above). Write a new one for each future material feature that processes personal info.
- [ ] **Breach response runbook.** When a confirmed privacy breach happens, the policy commits us to notify within 72 hours. Make sure you actually have a runbook — at minimum: (1) contain the breach, (2) identify affected individuals, (3) draft notification text, (4) notify the relevant commissioner via their online form, (5) email affected users.
- [ ] **DSAR / rights-request workflow.** Users can email `privacy@priceback.ca` to request access, correction, deletion, or portability. Have a process: respond within 30 days (Quebec Law 25 §32, PIPEDA Principle 9). The in-app *Download my data* and *Delete my account* tools handle the common cases automatically.
- [ ] **Consent log.** When users toggle opt-in features on/off (crowdsourced sharing, AI OCR, notifications, camera-roll), the toggles are stored locally. If a regulator asks, you should be able to point to that audit trail. The mobile `prefs` object in AsyncStorage is the source of truth.

**Quebec Law 25 specifics:**
- [ ] **Service available in French.** ✅ Both `privacy-policy-fr.html` and the app's French translations are in place. Quebec Law 25 §43 implies any service offered to Quebecers must be available in French.
- [ ] **Granular consent.** ✅ Each opt-in feature has its own Profile toggle.
- [ ] **Privacy-by-default.** ✅ Crowdsourced sharing, AI OCR, camera-roll suggestions all default to OFF.
- [ ] **Right to deletion + portability.** ✅ In-app via Profile.
- [ ] If you start using automated decision-making (e.g. ML-driven price predictions that affect user pricing), Quebec Law 25 §12.1 requires disclosure + the right to challenge. **We don't do this today** — keep it that way unless you're ready to add the disclosure.

**Alberta PIPA / BC PIPA:**
- Largely covered by the same controls. Major difference: Alberta has its own breach-notification regime (PIPA §34.1) with a separate notification to the OIPC. The 72-hour internal target covers it.

**Anti-spam (CASL):**
- [ ] If you ever send marketing emails or in-app messages to users, you need express consent + unsubscribe + sender identification (Canada's Anti-Spam Legislation §6). Push notifications about *the user's own* watched items don't count as commercial electronic messages, but any "Hey, check out our new feature!" blast does. Keep transactional notifications (price drops, expiry warnings) and marketing blasts strictly separate.

**Children's privacy:**
- The policy declares no children under 13. Google/Apple accounts are 13+ by Google/Apple ToS, so the sign-in itself is the de-facto age gate. The 12+ rating in §9 / §10 matches this — IARC's "12+" tier in Play Console aligns with App Store's "12+" — both questionnaires will surface this when you declare "Infrequent/Mild Mature/Suggestive Themes" due to free-text product names.

---

## 13. Store-listing assets (must produce before submission)

Both stores need marketing artwork that doesn't exist anywhere in the
repo. Producing these is typically the longest tail of the release.

**App Store:**
- [ ] **App icon** — 1024×1024 PNG, no transparency, no rounded corners (Apple rounds them). Verify `./assets/icon.png` exports correctly at this size.
- [ ] **iPhone 6.7" screenshots** (1290×2796) — required, 3 minimum, 10 max. Capture Onboarding, Home (price drop), Detail (claim), Profile, Tracking.
- [ ] **iPhone 6.5" screenshots** (1242×2688) — Apple may auto-derive from 6.7" but uploading both is safer.
- [ ] **App preview video** (optional but boosts conversion) — 15–30s, recorded in-app.
- [ ] **Promotional text** (170 char) — changes without resubmission, good for "Just launched! Free for early users".
- [ ] **Description** (4000 char). First 3 lines matter most — Apple truncates above the fold.

**Google Play:**
- [ ] **App icon** — 512×512 PNG, 32-bit.
- [ ] **Feature graphic** — 1024×500 PNG, no text overlay (Play renders the app name on top).
- [ ] **Phone screenshots** (1080×1920 minimum) — 2 minimum, 8 max.
- [ ] **Short description** (80 char).
- [ ] **Full description** (4000 char).

Tip: Apple and Play accept the same screenshots if you crop the iPhone
versions to the Play aspect ratio. Saves a day of work.

---

## 14. App Store review prep (most common rejection cause)

App Store reviewers can't sign in via Google or Apple without a
test account or a special path. Without this, they reject within minutes.

- [ ] **Demo account** — create a dedicated Google account (e.g.
  `priceback.review@gmail.com`) and pre-populate it: complete onboarding,
  scan a few sample receipts, set a postal code (Ottawa K1A 0A6 is fine).
- [ ] **Review Notes** — `REVIEWER_NOTES.md` content is complete (updated
  2026-07-11: engineering contact filled in) except the demo-account
  email/password, which need the account created first (§14 above). Paste
  into App Store Connect → App version → App Review Information → Notes
  once that's done. Apple's field is 4000 chars; the "Short version" at the
  bottom fits.
- [ ] **Contact info** — your real phone in App Review Information (email
  is filled: maxim.lucas@viacesi.fr). Apple may call if they have urgent
  questions.
- [ ] **Sign In with Apple capability** — confirm enabled on the bundle
  ID (already covered in §4) and confirm the iOS build offers it on the
  sign-in step.
- [ ] **EU compliance** — Apple sometimes asks for EU compliance even for
  Canadian apps. GDPR section in the policy covers this; point them to
  Privacy Policy §11 if pressed.

For Play: testing instructions go in **Play Console → App content → App
access**. Same demo account.

---

## 15. French localization for store listings (Quebec users)

You have French translations in-app and a French privacy policy. The
store listings themselves are separate localizations.

**App Store Connect:**
- [ ] Add **French (Canada)** in App Information → Localizable Information.
- [ ] Translate: app subtitle (30 char), description (4000 char),
  keywords (100 char), promotional text (170 char), what's new.
- [ ] French screenshots (same dimensions as English; can be the same
  images with French UI captures).

**Google Play:**
- [ ] Main store listing → **Manage translations** → add French (Canada).
- [ ] Translate: short description, full description, screenshots.

**Why this matters:** Quebec Law 25 §43 expects services offered to Quebec
residents to be available in French. The in-app translations cover the
service itself; the marketing surface (store listing) is a grey area but
Quebec users notice. Skipping French localization risks bad word-of-mouth
in Quebec rather than a legal block.

---

## 16. Operational readiness (week-1 needs, not pre-publish blockers)

- [ ] **Uptime monitor** on `https://priceback-production.up.railway.app/health` — UptimeRobot (free), BetterStack (free), or Cronitor (free). 5-min checks, SMS / email on failure.
- [ ] **Support inbox routing** — confirm `support@priceback.ca`,
  `privacy@priceback.ca`, `security@priceback.ca` all reach inboxes you
  actually read. Apple emails `privacy@` during review and during DSAR
  audits.
- [ ] **Incident response runbook** — see `docs/incident-response.md`
  (PIPEDA / Law 25 72-hour breach procedure: detect → contain → scope →
  notify). Also know the basics: how to roll back via EAS Update, how to flip
  the `FLYER_ADMIN_TOKEN` if it leaks, how to revoke a Vision API key.
- [ ] **Status page** — overkill for v1, but if uptime starts mattering,
  StatusPage / Better Uptime have free tiers.
- [ ] **Marketing email provider** — only if you ever want to use the
  CASL marketing-consent toggle. Mailgun / Resend / Postmark have free
  tiers. Not blocking v1.

---

## 17. Business + legal (orthogonal to the code)

- [ ] **Legal entity** — the Privacy Policy and Terms list "PriceBack
  Canada" as the operator. If this isn't a registered corporate entity,
  you're personally on the hook for everything. Sole proprietorship is
  fine for v1 but the policy implies a registered operator. Talk to an
  accountant once revenue starts.
- [ ] **Domain ownership** — `priceback.ca` registered to you (or your
  corporate entity). DNS pointing at your static host (GitHub Pages /
  Netlify / Cloudflare Pages / Vercel). HTTPS via Let's Encrypt /
  Cloudflare (automatic on all of those).
- [ ] **Trademark on "PriceBack"** — not strictly required, but useful
  in Canada before someone else files. CIPO trademark application is
  $336 + lawyer fees.
- [ ] **Insurance** — once paid users exist, even basic E&O insurance is
  worth a quote. Wave or Apollo can do small-biz tech E&O cheaply.

---

## 18. Suggested order of operations

1. **Today:** Apple Developer + Play Console enrollment (§0) — takes days for approval, start first.
2. **Day 1:** Verify `curl -I https://priceback.ca/privacy` returns 200. Check `_redirects` in `Priceback-Website/` if any path is 404 (§1).
3. **Day 1:** Rotate credentials — Vision API key + Supabase prod password (§8A). Do this before any prod traffic.
4. **Day 1–2:** Real RevenueCat key (§2), Sentry DSN (§5), iOS Google OAuth client + plist (§3).
5. **Day 2:** Full Railway prod env vars (§8): `DATABASE_URL` → prod Supabase, `ADMIN_USER_SUBS`, `R2_*`, `REVENUECAT_WEBHOOK_TOKEN`, `FLYER_ADMIN_TOKEN`. Confirm `/health` shows everything configured.
6. **Day 2 — BEFORE routing any traffic:** Run prod DB migrations (§8B). `DATABASE_URL=<prod> npm run db:migrate`. Verify `No pending migrations` on second run.
7. **Day 3–5:** Produce store-listing assets (§13) — screenshots, icons, feature graphic, description copy. Typically the longest tail.
8. **Day 5:** Demo account + Review Notes (§14). Pre-populate the demo account with sample data.
9. **Day 6:** French localization of store listings (§15).
10. **Day 6:** Azure app registration (§6) if shipping Outlook email sync.
11. **Day 7:** First EAS production build (`eas build --platform all --profile production`). Submit to TestFlight + Play Internal Testing.
12. **Day 7:** Walk the §11 smoke checklist on a real device from the production build. Fix anything broken.
13. **Day 8+:** Submit to App Store + Play production tracks. Apple review typically 24–48 hours; Play review 12–48 hours.

---

## 19. After-submit monitoring

First 48 hours after publishing:

- [ ] Watch the Sentry dashboard — crash-free sessions should stay above 99%.
- [ ] Watch Railway logs for any spike in 429s or 502s (`/health` heartbeat + manual `railway logs --tail` checks).
- [ ] Monitor App Store Connect → App Analytics for installs + retention.
- [ ] Monitor Google Play Console → Statistics for installs and crashes (Play has its own crash reporting separate from Sentry).
- [ ] Be ready to push an OTA update via EAS Update for any JS-only fix — `eas update --branch production --message "<fix>"`.

---

## Quick reference — credentials by location

| Where | What lives there |
|---|---|
| `app.json` extra (committed) | Web `googleClientId`, Android `googleClientIdAndroid`, EAS project ID. Anything else is a placeholder. |
| EAS secrets (per-environment) | `GOOGLE_CLIENT_ID_IOS`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `REVENUECAT_API_KEY`, `MICROSOFT_CLIENT_ID` |
| Railway env vars (backend) | `DATABASE_URL`, `USE_DB`, `GOOGLE_VISION_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID_ANDROID`, `GEMINI_API_KEY`, `FLYER_ADMIN_TOKEN`, `ADMIN_TOKEN`, `ADMIN_USER_SUBS`, `REVENUECAT_WEBHOOK_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RESEND_API_KEY`, `ALERT_EMAIL`, `DATA_DIR` |
| Repo root (untracked / sensitive) | `GoogleService-Info.plist`, `google-services.json`, `backend/.env` |
| Website repo (`Priceback-Website/`) | `privacy-policy.html`, `terms-of-service.html`, `support.html` (+ `-fr` variants) — live at `priceback.ca` via Cloudflare Pages |
| App repo `legal/` (committed) | Only `MARKETING_CLAIMS.md` remains — the legal HTML source of truth moved to the website repo (`ffc874c`) |

**Full backend env var reference:** `docs/Publish_Requirements.md`
