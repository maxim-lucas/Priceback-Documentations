# PriceBack Canada — Technical Debt Checklist
## Audit v2.5.0 — RESOLVED

All 20 bugs from the full audit have been fixed.

### Verified 2026-05-09
- Backend live at `https://priceback-production.up.railway.app`; `/health` returns `ocr: configured` and lists 7 supported stores.
- Mobile `app.json` `extra.priceApiUrl` points at the live backend; build 16 (`versionCode: 16`, `buildNumber: "16"`) installed on physical device.
- All API endpoints validated end-to-end: `/api/ocr`, `/api/check-price`, `/api/watch`, `/api/unwatch`, `/api/device/sync`, `/api/device/scan`.
- Test suite: 90/90 passing (was 91 — HBC test removed alongside scraper).
- Reproducible installs: root `.npmrc` (`legacy-peer-deps=true`), `package-lock.json` and `backend/package-lock.json` committed.
- Backend reads `backend/.env` via `dotenv`; example file at `backend/.env.example`. Real `.env` gitignored.
- Railway deploy pinned via `backend/railway.json` (Root Directory `backend`, healthcheck `/health`, `node server.js`).

### ✅ CRITICAL BUGS — FIXED
- BUG-01: useState inside conditional → moved to top level
- BUG-02: BarcodeScan bypasses paywall → canAddReceipt + incrementReceiptCount added
- BUG-03: Deprecated Clipboard → replaced with expo-clipboard

### ✅ FUNCTIONAL BUGS — FIXED
- BUG-04: EmailSync hardcoded 8 stores → dynamic STORES.map() (25 stores)
- BUG-05: Profile dead buttons → all 5 now have working handlers
- BUG-06: EmailSync provider emojis → Ionicons (mail, mail-open)
- BUG-07: EmailSync how-it-works emojis → Ionicons

### ✅ CONSISTENCY ISSUES — FIXED
- BUG-08: OnboardingScreen slide emojis → Ionicons
- BUG-09: Paywall tier emojis → Ionicons (leaf, flash, ribbon)
- BUG-10: ClaimAssistant method emojis → Ionicons (mail, call, storefront)
- BUG-11: ClaimAssistant checklist emojis → Ionicons (checkmark-circle, ellipse)
- BUG-12: SavingsStreak badge emojis → Ionicons (14 badges)
- BUG-13: SavingsStreak stat emojis → Ionicons
- BUG-14: Button icon prop emojis → Ionicon names (images-outline, keypad-outline)
- BUG-15: FONTS.serif → FONTS.heading/FONTS.body (41 references across 6 files)

### ✅ CONFIG — FIXED
- BUG-16: Backend API URL → backend deployed to Railway; `priceApiUrl` set in `app.json` (verified 2026-05-09)
- BUG-20: Backend version mismatch → synced to 2.5.0
- BACKEND-HBC: Backend still scraped Hudson's Bay after v2.1.0 frontend removal → scraper removed (commit b7e9ec9, 2026-05-09)

### 🔵 CONFIG PLACEHOLDERS (requires user action)
- BUG-17: OAuth client IDs → create in Google Cloud + Azure Portal (in progress as part of AUTH-01)
- BUG-18: Veryfi API keys → optional secondary OCR
- BUG-19: RevenueCat API key → required for real IAP payments

### 🟡 IN-FLIGHT — User accounts + regional pricing (started 2026-05-09)

**AUTH-01 — Google + Apple sign-in, mandatory postal code**

Drives accurate sameday.costco.ca regional pricing (Costco warehouse
prices vary by region; sameday personalises the page by detected client
IP). Without an explicit postal code we have to guess from IP, and
Railway's egress (us-east) gets US-flavoured Canadian-storefront pages.

Phasing:
- ✅ Backend sameday URL auto-discovery via DDG site search
- ✅ scrapeSamedayProduct extracts price + save_amount label
- ✅ Backend sends CA-locale headers + postal cookie (best-effort)
- ✅ Device-side sameday rescrape on "Refresh prices" (uses user's CA IP)
- ⏳ Profile data model + postal code state (this work)
- ⏳ Postal code threaded through /api/check-price (this work)
- 🔵 Onboarding gate: mandatory postal code + province (next turn)
- 🔵 Combined Google OAuth (sign-in + gmail.readonly scope)
- 🔵 Backend Firebase ID token verification + user profile storage
- 🔵 Apple Sign-In on iOS (deferred — user is on Android)

**EMAIL-01 — Gmail sync wiring (BUG-17 follow-up)**

emailSyncService.js infrastructure already exists (full OAuth + 20-store
domain map). Initially planned to land alongside AUTH-01 as a combined
OAuth event, but:

- `gmail.readonly` is a **sensitive** scope in Google's classification.
- Using it triggers "Priceback has not completed the Google verification
  process" / 403 access_type=offline on the consent screen.
- Production use requires Google's app-verification (security review +
  CASA assessment, takes weeks).

Two paths when EMAIL-01 is picked up:

1. **Testing-mode workaround** — keep OAuth consent screen in Testing
   status, add the app owner + family/test users to the test-user list,
   re-enable gmail.readonly + offlineAccess in authService. Works for
   the owner without verification but not distributable.

2. **Real verification** — submit Google verification (privacy policy
   URL, app demo video, terms of service URL, scope justification).
   Approved apps can use gmail.readonly in production. Only worth doing
   when there are real users to justify the effort.

Code state to restore when picking this up:
- authService.GOOGLE_SCOPES: add `"https://www.googleapis.com/auth/gmail.readonly"`.
- authService.signInWithGoogle: re-enable `offlineAccess: true` and the
  serverAuthCode → backend code-exchange flow for refresh tokens.
- Backend: new endpoint that exchanges serverAuthCode with the Web
  client secret to obtain a refresh token, stores it server-side keyed
  by `userId`. (Don't put the client secret in the APK.)

### 🟡 DEFERRED — to be picked up after AUTH-01 ships

- **DEF-01: Apple Sign-In (iOS)** — user is currently Android-only.
  Pulls in expo-apple-authentication and adds the Apple identity
  provider to backend's token verifier. Apple-specific config in
  app.json + capability in Apple Developer Portal.
- **DEF-02: Receipt migration to user-scoped data** — receipts are
  currently local-only. After auth lands, backfill `userId` onto
  existing AsyncStorage receipts for the signed-in user, then
  enable cross-device sync via Firestore.
- **DEF-03: Costco regional pricing — proxy fallback** — if the
  postal-code cookie/header trick doesn't make sameday return CA
  pricing from Railway, evaluate paid residential proxies (Bright
  Data / Oxylabs, ~$30/mo) so the daily cron job sees Canadian
  prices without depending on user devices being awake.

### ✅ FUTURE IMPROVEMENTS — full sweep 2026-05-12 / 13
- IMPROVE-01: Dark mode — phantom item; no real dark-mode feature ever existed in code. Orphan `UserPrefs.darkMode` field removed. Skipped, not built.
- IMPROVE-02: Email connect loading state — already wired in `EmailSyncScreen.js:205-206` (ActivityIndicator replaces the connect button). Stale doc entry.
- IMPROVE-03: Receipt photo persistence — fixed. New `persistReceiptImage()` in storageService copies cache→documentDirectory/receipts/ on save; `deleteReceipt` cleans up.
- IMPROVE-04: Receipt editing after save — added `EditorModal` in DetailScreen. Tap item to edit name/price/SKU; pencil icon next to "Items" edits date/total/tax.
- IMPROVE-05: Android notification scheduling — root cause was SDK 55: old `{date: ts}` trigger throws `hasValidTriggerObject` silently. Fixed: all triggers use `{type: SchedulableTriggerInputTypes.DATE, date, channelId}`, `shouldShowBanner+shouldShowList` replace `shouldShowAlert`.
- IMPROVE-06: Pull-to-refresh on onboarding card — the "card" is HomeScreen's zero-receipts welcome, inside a ScrollView that already has RefreshControl. Stale doc entry.

### ✅ AUDIT ROUNDS 1-5 (2026-05-12 → 2026-05-14)
Beyond the IMPROVE list, a 5-round audit found 21 additional bugs:
- **OCR (round 1)**: tax/subtotal/total amounts misread as items; total=subtotal when tax detected; Quebec TPS+TVQ undercount. All fixed in `0743d46`.
- **Backend cron + lock leak (round 2)**: push notifications silently failed because `watchedItems` keys are prefixed `push:`/`dev:` but used as raw push tokens; `withLock` memory leak (cleanup `===` always false); cumulative `totalImported` overwritten; emailSync regexes missed Quebec tax/subtotal. Fixed in `19ffca4`.
- **ScanScreen total = items only (round 3)**: dropped tax silently; ManageSubscription import of nonexistent `purchaseTier` crashed upgrade; ClaimAssistant gradient swapped (invisible text); SavingsStreak `tree-outline` not a real Ionicon; `all_stores` required 25 stores but catalog has 20. Fixed in `a5e4306`.
- **i18n missing keys (round 4)**: 13 keys referenced by code but undefined; users saw `detail.editItem` literal. Added to en+fr (552 each). Fixed in `1f16529`.
- **Notif scheduling on invalid date (round 5)**: NaN trigger silently rejected by native scheduler. Fixed in `30980ed`.

### 🟡 IN-FLIGHT — Plans A + B (committed, awaiting rollout)
Two features merged on `main` but gated by user opt-in toggles + backend env var. **Detailed rollout steps in `PLAN_AB_ROLLOUT.md` at the repo root.**

- **Plan A — LLM OCR reconciliation** (`d979511`): backend `/api/ocr-llm` proxies to Claude Sonnet 4.6 when `isInconsistent()` fires (5 trigger criteria). Needs `ANTHROPIC_API_KEY` env var on Railway + new EAS Android build.
- **Plan B — Crowdsourced Costco warehouse pricing** (`ce1e1bb`): every opted-in Costco scan contributes `(warehouseId, sku, unitPaid)` observations; aggregate median serves as primary price source ahead of the sameday scrape. Needs new EAS Android build (no backend config). Privacy: device-hashed, opt-in, one-tap revoke via `DELETE /api/me/observations`.

---

## Security

### ✅ SEC-01 — Vision API key leaked in source (RESOLVED 2026-05-09)

A Google Cloud Vision API key (value redacted — `AIzaSy…REDACTED`, revoked 2026-05-09) was hardcoded in `src/services/ocrService.js`. Anyone who decompiled the APK/IPA could extract and reuse it.

**Resolution complete:**
1. ✅ Hardcoded key removed from source (2026-04-27).
2. ✅ Tier-4 architecture implemented: mobile client uploads receipt to `POST /api/ocr` on the backend, which forwards to Google Vision with the server-side key. The key never ships in any APK/IPA.
3. ✅ Leaked key revoked in GCP Console (2026-05-09).
4. ✅ New replacement key configured server-side via `GOOGLE_VISION_API_KEY` env var on Railway (loaded by `dotenv` from `backend/.env` locally; injected by Railway in production). `/health` confirms `ocr: configured`.

---

## Store Policy System — Audit & Remote Refresh

### ✅ STORE-01 — Policy verification status (RESOLVED 2026-04-27)

**Final state:** All 20 stores in the app have verified, current policies as of 2026-04-27. The earlier "unverified — needs audit" list has been worked through, with 5 stores removed for not fitting the post-purchase price-adjustment concept.

**Audit timeline:**
- **2026-04-25 first batch (8 stores verified):** bestbuy, thesource, costco, walmart, canadiantire, homedepot, ikea, sleepcountry
- **2026-04-27 second batch (12 stores verified):** visions, thebrick, leons, lowes, rona, marks, oldnavy, staples, sportchek, basspro, toysrus, londondrugs

**Stores REMOVED in v2.1.0 (5 total):**
1. **Structube** — No formal price adjustment policy (only 7-day return with $69 fee)
2. **Hudson's Bay (HBC)** — Ceased Canadian retail operations June 1, 2025
3. **Indigo / Chapters** — No published post-purchase price adjustment policy
4. **PetSmart** — Price match is at-time-of-purchase only (no post-purchase adjustment)
5. **No Frills** — At-register match only against current competitor flyers; doesn't fit post-purchase adjustment concept

**Adjustment day count corrections in v2.1.0:**
- **Bass Pro Shops:** 0 → 30 days (Canadian site has 30-day post-purchase refund per Best Price Promise)
- **Toys R Us:** 14 → 30 days (own price drop window is 30 days; competitor match remains 14 days)
- **Sport Chek:** 0 → 15 days (own policy still active despite Canadian Tire parent ending price match)

**URLs corrected in v2.1.0:**
- Visions: `/PriceGuarantee` → `/lowest-price-guarantee`
- Sport Chek: `/help-centre/policies/return-policy` → `/customer-service/policies`
- Mark's: `/customer-service` → `/customer-service/price-match-guarantee`
- Toys R Us: `/customer-service` → `/faq-policy`
- Bass Pro: `.basspro.com/shop/en/ca/low-price-guarantee` → `.basspro.ca/b/pricematch`

### ✅ STORE-02 — Remote policy refresh on startup (done; now DB-backed)
Hardcoded policies in `src/constants/stores.js` go stale (cf. Canadian Tire's Aug 2022 policy change, Hudson's Bay's 2025 closure). Shipped: the backend serves `/api/v1/policies.json`, the app fetches it on startup, caches under `priceback:policies-cache:v1`, and `applyRemoteStores()` applies it when newer than the bundled `BUNDLED_UPDATED_AT`. The bundled `STORES` array remains the offline fallback.

**Source of truth is now the DB** (`store_policies` table), not a JSON file:
- With `USE_DB=true` the endpoint serves the table and *only* the table. An empty table or a DB read error returns 503 — it does not silently serve a stale bundled file.
- Break-glass: the bundled `backend/data/policies.json` is served only when the `kv_state` flag `policies_file_fallback_enabled` is set to `true` (flip it via SQL — no redeploy / no app release). It also remains the one-time DB seed source.
- With `USE_DB` off (local/offline dev) the bundled file is served directly.

**Operational workflow:** edit the `store_policies` row, bump its `content_updated_at`; users get it on next app launch. Periodically (quarterly?) re-audit the 20 retailers and update `last_verified_at` per row.

### 🟡 STORE-03 — Verify French URLs (deferred)
The French URLs for several stores were constructed using common URL patterns. For the 12 stores verified 2026-04-27, English URLs were confirmed against the live policy pages, but French URLs were inferred. Before targeting Quebec users heavily, click each French URL and confirm it loads the actual French policy page (not just the home page or a redirect to English). Stores to verify: visions, thebrick, leons, lowes, rona, marks, oldnavy, staples, sportchek, basspro, toysrus, londondrugs.

### 🟡 STORE-04 — Quebec legal French review (deferred)
The French translations of `policyNote`, `claimSteps`, `claim.emailBodyTpl`, and `claim.phoneScriptTpl` were drafted by Claude. Before serious Quebec marketing, have a human reviewer (ideally familiar with Quebec consumer law / Loi sur la protection du consommateur) verify the legal phrasing — especially around "ajustement", "égalisation", and "remboursement", which carry slightly different connotations in Quebec.

### 🟡 STORE-05 — Reconsider Canadian Tire entry
Canadian Tire discontinued its price match in August 2022. The current entry uses `adjustmentDays: 0` and a `⚠`-prefixed `policyNote`. This straddles the "stores must match the post-purchase concept" rule — kept for now because (a) Canadian Tire is one of the most-scanned retailers in Canada, and (b) the workaround (return + rebuy) does still work. Reconsider in a future product decision: either remove for strict concept fit, or keep as an explicitly-flagged edge case.

### 🟡 SCAN-01 — Gallery auto-crop on still images (deferred, 2026-04-26)

**User report:** "The auto crop should work when the app scans a photo receipt, not in manual mode. A few versions ago we had it working in the code. When I told you it wasn't working for file receipts, you rolled it back for all receipt types."

**Current state:**
- **Camera capture** (`handleCameraCapture` in `ScanScreen.js`) uses `react-native-document-scanner-plugin@^2.0.4` (VisionKit on iOS, MLKit DocumentScanner on Android) — this DOES auto-detect edges + perspective-correct + crop. Works correctly in EAS Build (not Expo Go).
- **Gallery pick** (`handleGalleryPick`) uses `expo-image-picker` with `allowsEditing: true` — this opens the OS-native MANUAL crop UI. There is NO auto-crop on gallery-picked images.

**Audit performed (2026-04-26):** Searched all 7 transcripts (Apr 9 → Apr 25). Findings:
- v1.0.0 (Apr 9): Gallery already used `allowsEditing: true` (manual crop, not auto).
- v1.5.0 (Apr 14): Cropping disabled on gallery because "cropping cuts off receipt items."
- v1.x (Apr 19): Claude told user "true smart cropping needs ML vision... resizing alone still saves space."
- v2.5.0 (Apr 25): Native doc scanner plugin added for **camera capture only**. VisionKit/MLKit DocumentScanner are camera-bound APIs — neither accepts a still-image URI as input.
- **No transcript shows a prior working version of auto-crop on gallery-picked still images.**

**Why it's hard:**
- `react-native-document-scanner-plugin` opens its own camera UI; no still-image API.
- `expo-image-manipulator` can only do axis-aligned crops, not perspective correction.
- Pure-JS edge detection (Sobel/Hough) in Hermes blocks the UI thread for 1-3 seconds, requires a JPEG decoder, and gets perspective wrong on tilted receipts.
- Free, well-maintained RN+Expo libraries that do real auto-crop on still images: **none found** as of 2026-04 audit. Maintained options are commercial (Scanbot SDK, Dynamsoft).

**Realistic paths (priority order for future work):**
1. **Pay for Scanbot SDK** — only known reliable solution. License cost likely $thousands/year. Justifiable if PriceBack monetizes.
2. **Custom JS edge detection** — achievable but with caveats: ~500-700 lines new code, no perspective correction (axis-aligned crop only), 1-3s UI freeze, unreliable on cluttered backgrounds/glare/folded receipts. Likely worse UX than current manual flow.
3. **UX clarification** — keep manual crop on gallery; add a hint when tapping "Gallery" button: *"Tip: For automatic cropping, use Take Photo instead — gallery photos use manual crop."* This sets correct expectations at zero cost. **Recommended interim solution.**
4. **Different library** — if a maintained free alternative emerges, re-evaluate. Periodically check `vision-camera-document-scanner`, `react-native-rectangle-scanner`, and any new entries in the React Native Directory.

**Open question for user:** May be recalling camera-capture auto-crop (which has always worked) and conflating it with gallery flow. If user can identify a specific build where gallery auto-crop demonstrably worked, that would help locate any missed session.

**Status:** Deferred pending decision. Camera capture continues to work as expected.


---

## Repo cleanup audit — 2026-06-22 (alongside /health quota diagnostics)

A "remove deprecated/dead code + stale docs" pass, scoped to NOT touch features
intentionally hidden/dormant for this app version. Findings:

### Done in this PR
- **Stale merged remote branch** `fix/backend-coverage-ratchet-dbhealth` (PR #101) — deleted
  + local remote-tracking ref pruned.
- **DEPLOYMENT.md DB-targets table** — corrected from retired-Neon to the live Supabase
  dev (`gnedluuylimjwdmtvswl`) + prod (`xjfrlzwonyaorwktnkpj`) projects.

### Verified KEEP — do NOT "clean up" (intentional, load-bearing, or historical)
- **Dormant-for-this-version features:** Plan A+B (LLM reconciliation + Costco crowdsourcing,
  `PLAN_AB_ROLLOUT.md`), usage-pricing UI rows, dual-capture (`docs/Dual-capture.md`),
  `watched_items` server-push registry (`repos/watchedRepo.js`, excluded from coverage),
  GCS storage adapter (`backend/storage/gcs.js`), Veryfi secondary OCR, hidden Profile rows.
- **`LEGACY_SUBS` / `LEGACY_PACKS`** (`shared/pricing.config.js` + `config/configService.js`)
  are **load-bearing**, not dead: configService derives them from the DB (inactive/hidden
  tiers) so grandfathered subscribers still resolve; `ALL_SUBS`/`ALL_PACKS` consume them.
- The `Starter`/`Pro`/`Max` names in `PACKS` are **current credit-pack display names**
  (ids `priceback_pack_*`), NOT the legacy `starter`/`pro` *subscription* tiers that
  migration 0005 deleted. No contradiction.

### Legacy plan remnant — conclusion
- There is **no `free_tier_plan` (or legacy `starter`/`pro` tier) anywhere in tracked
  code/config.** Dev DB `priceback.subscription_plans` holds only `free` + `unlimited`.
- Any surviving `free_tier_plan` row is **prod-DB data only** (prod is unmigrated; the seed
  uses `onConflictDoUpdate`/`onConflictDoNothing` and never deletes, so a pre-0005 row lingers).
  Do **not** add an auto-prune to `seed.js` — it would fight the grandfathering design above.
  Clean it as a one-time, guarded migration when prod is migrated (mirrors what 0005 did for dev).

### Surfaced for a follow-up docs pass (not edited here — many are legit history)
- Stale "current state" Neon references still presenting Neon as the live test/migrate
  target: `docs/Audit_ToDo.md`, `docs/PERFORMANCE_REVIEW.md` (header), `docs/PUBLISH_CHECKLIST.md`.
- `docs/Bugs_Common_Fixes.md` Neon mentions are **past-incident records** — keep as-is.
