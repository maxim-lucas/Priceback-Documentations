# RevenueCat / Paywall configuration — "There is an issue with your configuration"

> **🔴 2026-08-04 — a THIRD failure, and this one WAS app code.** On the live
> production build (2.8.3) every subscription tap returned *"This item isn't
> available for purchase right now"* while credit packs bought fine. Cause:
> **Google Play names a subscription `<subscriptionId>:<basePlanId>`**, so
> RevenueCat returns `priceback_unlimited_monthly:monthly` — and
> `purchaseProduct` matched the offering against the bare catalog id with `===`.
> Packs (no base plan → no suffix) matched; subscriptions never did, and the
> paywall showed catalog prices on the sub cards because `getStorePriceLabels()`
> keyed on the same suffixed id. Fixed by matching every id a product answers to
> (`storeProductIds` in `src/services/purchaseService.js`). Full write-up:
> Operations/Bugs_Common_Fixes **#142**. **The store side was healthy the whole
> time** — don't re-audit Play/RC when this symptom appears; check the id
> spelling first.
>
> **Also worth knowing before you debug a "test paywall":** any account in Play
> Console → Settings → **License testing** sees a *test* purchase sheet on every
> SKU, including on the live production app. `maxim.louka@gmail.com` is on that
> list on purpose. That is not a track/build mix-up.

> **Status:** RevenueCat dashboard is **live and configured** (Priceback project
> `c7a0e77d`). **No app-code change is required** — the setup below is external
> (dashboard + store) configuration.
>
> **✅ 2026-07-11 verified in the live RC dashboard (browser audit):**
> - All Play SKUs imported + **Published**: `priceback_unlimited_monthly:monthly`,
>   **`priceback_unlimited_annual:annual`** (Unlimited Annual Subscription), and the
>   3 packs (`priceback_pack_starter/pro/max`).
> - Entitlement **`unlimited`** has the annual + monthly products attached
>   (annual attached Jul 6, 2026).
> - The active **`default` offering** contains both cycles as packages
>   (`$rc_annual` → `priceback_unlimited_annual:annual`, `$rc_monthly` →
>   `priceback_unlimited_monthly:monthly`) + the 3 packs — so `getOfferings()`
>   resolves the annual plan.
>
> Net: the **annual subscription is matched end-to-end across code, DB seed, Play
> Console (SKU Active), and RevenueCat**. The remaining store-side item is
> **App Store Connect** (no iOS RC app / App Store products yet, iOS key still
> missing — a separate iOS-launch workstream, not an annual-sub gap). Minor RC
> hygiene: a stale `priceback_unlimited_monthly:unlimited` base-plan mapping shows
> "Not found" (the correct base plan is `:monthly`); harmless, left as-is.
>
> **✅ 2026-07-11 — prod purchase recording fully closed out.** Both Railway env vars
> are set on prod: `REVENUECAT_WEBHOOK_TOKEN` (webhook) and `REVENUECAT_SECRET_KEY`
> (sync endpoint). Verified directly against prod `/health`:
> `checks.revenuecat.webhook: "configured"` and `checks.revenuecat.syncApi: "configured"`.
> `POST /api/me/subscription/sync` is live; `subscription_events` now has two live writers
> (webhook + sync). This was the last blocker on RevenueCat's side for Play — see the
> Verification checklist below for the full history.

## Symptom

There are **two distinct failures**, at two different stages — don't conflate them:

1. **"There is an issue with your configuration. Check the underlying error for more details."**
   Native RevenueCat `PurchasesErrorCode.configurationError` (code 23). Fires when the SDK
   is configured with a real key but can't resolve a valid offering/product set at all.

2. **"The item you were attempting to purchase could not be found."** ← *the current one, on
   every product and subscription.* This is a **Google Play Billing `ITEM_UNAVAILABLE`**
   response, surfaced from the native SDK by `subscriptionManager.purchasePackage()`.

**Why #2 is different — and what it tells us.** Our code only reaches `purchasePackage()`
*after* it finds the package in `offerings.current.availablePackages` (otherwise it returns
early with `errorCode:"unavailable"`, message "Product not found in store"). So when you see
#2, **RevenueCat already resolved the products from the store** — the offering and SKUs are
wired correctly. The failure is at the actual `launchBillingFlow` step, and it happens on
*every* SKU. That pattern has one dominant cause:

> **The installed build is not a Google-Play-licensed copy of the app.** Google Play lets any
> app with the matching package name (`com.priceback`) *read* product details (so offerings
> populate), but it rejects the *purchase* with "item could not be found" unless the running
> app is a recognized, licensed Play distribution.

### Fix for #2 (store/test-environment — this is the real fix, not app code)

Work through, in order:

1. **Upload the build to a Play track.** Push an AAB (correct `com.priceback`, incremented
   `versionCode`) to **Internal testing** (or Internal App Sharing) in Play Console. IAP does
   not work from an arbitrary artifact.
2. **Sign it with the key Google expects.** Use an **EAS build with the project's Android
   credentials** (Play App Signing / registered upload key) — **not** a local debug-signed,
   sideloaded APK from `manual_build/build-and-install.ps1` + `adb install`. A self-signed
   sideloaded APK is the #1 trigger of "item could not be found" on every SKU.
3. **Register the tester as a License Tester.** Play Console → *Setup* → *License testing* →
   add the Google account you're testing with; also add it to the Internal-testing track's
   tester list.
4. **Install *from* Play.** Open the internal-testing opt-in link on the device and install the
   app from the Play Store — don't sideload the same APK.
5. **Confirm the SKUs are Active.** All 5 product IDs (3 packs + monthly & annual subs) must be
   **Active** in Play Console with the exact IDs below.

Only once the app is a licensed Play install with active SKUs will the OS purchase sheet
complete instead of returning "item could not be found."

## Where it comes from (code is correct — for reference only)

| Step | File | Notes |
|------|------|-------|
| Paywall taps → `purchaseProduct()` | `src/components/Paywall.js` (`handleUpgrade` ~L101, `handleBuyPack` ~L71) | Catches the error and `Alert.alert`s `err.message` verbatim (~L82 / L114). |
| Resolve + buy | `src/services/purchaseService.js:911` (`purchaseProduct`) | Calls `initRevenueCat()` → `subscriptionManager.getOfferings()` → finds the package by `product.identifier` → `purchasePackage()`. Throws "Product not found in store" if offerings are empty. |
| Configure | `src/services/subscriptionManager.js:52` | `Purchases.configure({ apiKey })`. |
| Key resolution | `src/services/purchaseService.js:75-94` | `Constants.expoConfig.extra.revenueCatApiKey` → per-platform `{ ios, android }` supported; `"YOUR_REVENUECAT_API_KEY"` placeholder ⇒ treated as unconfigured (dev-mode fake purchase). |
| Key plumbing | `config/profiles/{common,local,eas}.js` | `common` = placeholder; `local` reads `process.env.REVENUECAT_API_KEY` (from `.env.local`); `eas` reads the EAS secret. |

**Dev-mode note:** when no key is configured, `purchaseProduct` *fakes* a successful purchase (`purchaseService.js`). So the configuration error only appears once a **real key is present but the offerings/products behind it aren't set up** — i.e. exactly the half-configured state.

## Product / entitlement identifiers (source of truth: `shared/pricing.config.js`)

- **Subscriptions:** `priceback_unlimited_monthly` — $4.99/mo, and `priceback_unlimited_annual` — $49.99/yr (2 free months vs monthly). Both attach to the SAME entitlement id `unlimited` (legacy fallbacks accepted in code: `Priceback Pro`, `premium`).
- **Credit packs (non-renewing / consumable):**
  - `priceback_pack_starter` — $3 / 250 credits
  - `priceback_pack_pro` — $5 / 500 credits
  - `priceback_pack_max` — $10 / 1100 credits

## Root cause — the external blockers (the actual fix)

> **Historical (now resolved for Play + RC).** As of 2026-07-11 all 5 Play product
> IDs are imported + Published in RevenueCat and attached to the `default` offering
> (see the verified status banner at the top). The steps below remain the reference
> for App Store Connect and for re-creating the setup from scratch.

RevenueCat returns `configurationError` when the SDK is configured with a real key but can't resolve a valid offering/product set. Work through, in order:

1. **Create the products in the RevenueCat dashboard** — all 5 SKUs, exact IDs above.
2. **Link + approve each SKU in the stores:**
   - **Google Play Console** — create the 2 subscriptions (monthly + annual) + 3 in-app (consumable) products with matching IDs; activate them.
   - **App Store Connect** — create the 2 auto-renewable subscriptions + 3 consumables; submit for review (a sandbox-testable state is enough to clear code 23).
3. **Attach products to an Offering** in RevenueCat (the `current` offering is what `getOfferings()` reads). Empty offering ⇒ "Product not found in store".
4. **API keys (per platform):**
   - Android key (`goog_…`) exists in `.env.local` for local builds.
   - **iOS key (`appl_…`) is MISSING.** Add it before any iOS paywall test. Code already supports the `{ ios, android }` shape (`purchaseService.js:85-89`); supply both.
   - For EAS builds, set `REVENUECAT_API_KEY` as an **EAS secret** (read by `config/profiles/eas.js`).
5. **Backend webhook for credit packs** — set `REVENUECAT_WEBHOOK_TOKEN` on Railway so `/api/revenuecat/webhook` credits non-renewing purchases. Without it, a pack purchase "succeeds" but credits never land.

Cross-reference: **`PUBLISH_CHECKLIST.md` §2 (RevenueCat — BLOCKER for production IAP)**.

---

## RevenueCat Webhook — exact values to enter in the dashboard

> **RevenueCat dashboard path:** Project → Integrations → Webhooks → Add new webhook

| Field | Value |
|-------|-------|
| **Webhook name** | `PriceBack Backend` (or any label you choose — for your reference only) |
| **Webhook URL** | `https://<your-railway-domain>/api/revenuecat/webhook` (e.g. `https://priceback-production.up.railway.app/api/revenuecat/webhook`) |
| **Authorization header** | `Bearer <REVENUECAT_WEBHOOK_TOKEN>` — the exact value you set in Railway → Variables → `REVENUECAT_WEBHOOK_TOKEN`. Example: `Bearer s3cr3t-tok3n-abc123` |
| **Event types to send** | `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `PRODUCT_CHANGE` (see full list below) |

### How the backend verifies the header

`server.js:3616-3621` strips the `Bearer ` prefix and does a constant-time (`crypto.timingSafeEqual`) comparison against `process.env.REVENUECAT_WEBHOOK_TOKEN`. The token may be any non-empty string; generate one with `openssl rand -hex 32` and paste the **same value** into both Railway and the RevenueCat Authorization field.

### Event types — which to enable

| RC event type | Effect on backend |
|---|---|
| `INITIAL_PURCHASE` | Sets `subscriptionTier` = resolved tier, `subscriptionStatus` = `active` |
| `RENEWAL` | Same as INITIAL_PURCHASE — resets status to active on auto-renew |
| `UNCANCELLATION` | Reactivates a cancelled-but-not-expired sub |
| `PRODUCT_CHANGE` | Updates tier when a user upgrades/downgrades |
| `CANCELLATION` | Sets `subscriptionStatus` = `cancelled` (access until expiry) |
| `NON_RENEWING_PURCHASE` | Grants credits for consumable packs (`priceback_pack_starter/pro/max`) |
| `EXPIRATION` | Sets `subscriptionStatus` = `expired` (optional — backend also derives it from `expiration_at_ms`) |
| `BILLING_ISSUE` | Sets `subscriptionStatus` = `billing_issue` — optional but useful |

Sandbox events (environment = `SANDBOX`) are received and logged but not applied to production data.

---

## Google Play Console — linking products

### App bundle identifier
`com.priceback` (set in `app.json` → `android.package`).

### Products to create

**In-app products (consumables):**

> **Reference currency is CAD** (Priceback is a Canadian company) — Play Console's "default price" is set in CAD and all other currencies are auto-converted from it. Do not set the default price in USD; it will not equal the intended $X figure once converted back.

| Product ID | Type | Price | Description |
|---|---|---|---|
| `priceback_pack_starter` | Consumable (Managed product) | $3.00 CAD | Starter — 250 scan credits |
| `priceback_pack_pro` | Consumable (Managed product) | $5.00 CAD | Pro — 500 scan credits |
| `priceback_pack_max` | Consumable (Managed product) | $10.00 CAD | Max — 1100 scan credits |

**Subscriptions:**

| Product ID | Base plan ID | Price | Billing period |
|---|---|---|---|
| `priceback_unlimited_monthly` | `monthly` | $4.99 CAD | Monthly |
| `priceback_unlimited_annual` | `annual` | $49.99 CAD | Yearly |

> For subscriptions, Google Play requires you to create a **Subscription** product and then add a **Base plan** under it. The `priceback_unlimited_monthly` / `priceback_unlimited_annual` strings go in the **Subscription ID** field; `monthly` / `annual` are the suggested base plan IDs (RevenueCat reads the subscription-level ID, not the base plan).

### Steps in Google Play Console

1. **Open** Play Console → your app → *Monetize* → *Products*.
2. **In-app products** tab → *Create product* × 3 for the three packs above.
   - Set **Product ID** exactly (case-sensitive).
   - Set type to **Consumable**.
   - Add prices, then click **Save** and **Activate**.
3. **Subscriptions** tab → *Create subscription* × 2:
   - `priceback_unlimited_monthly`: base plan `monthly`, billing period = 1 month, price = $4.99.
   - `priceback_unlimited_annual`: base plan `annual`, billing period = 1 year, price = $49.99.
   - **Activate** each base plan.
4. **Link to RevenueCat:**
   - In the RevenueCat dashboard → Project → *Google Play* app → *Products* → *Import* (RC auto-imports once you paste your service-account JSON) or add manually with the exact product IDs.
   - Add `priceback_pack_starter/pro/max` as **Non-subscription** products.
   - Add `priceback_unlimited_monthly` AND `priceback_unlimited_annual` as **Subscription** products, entitlement = `unlimited` for both.

### Android Manifest (Billing permission)

Expo/EAS injects the billing permission automatically when `expo-in-app-purchases` or `react-native-purchases` is in the dependency tree. Verify the generated `android/app/src/main/AndroidManifest.xml` contains:

```xml
<uses-permission android:name="com.android.vending.BILLING" />
```

If it's missing (bare workflow or manual prebuild), add it inside `<manifest>` before the `<application>` tag. For the **managed Expo** workflow used by this project, this is added by `@revenuecat/react-native-purchases` via its `expo-module.config.json`; no manual edit is required — but verify after each `expo prebuild` run.

---

## App Store Connect — linking products

### Bundle identifier
`com.priceback` (set in `app.json` → `ios.bundleIdentifier`).

### Products to create

**Consumables (In-App Purchases):**

| Reference name | Product ID | Type | Price tier |
|---|---|---|---|
| Starter Pack | `priceback_pack_starter` | Consumable | $3.00 (nearest available tier) |
| Pro Pack | `priceback_pack_pro` | Consumable | $5.00 (nearest available tier) |
| Max Pack | `priceback_pack_max` | Consumable | $10.00 (nearest available tier) |

**Auto-Renewable Subscriptions:**

| Reference name | Product ID | Subscription group | Duration | Price tier |
|---|---|---|---|---|
| Unlimited Monthly | `priceback_unlimited_monthly` | `PriceBack Pro` | 1 month | Tier 5 (~$4.99) |
| Unlimited Annual | `priceback_unlimited_annual` | `PriceBack Pro` | 1 year | ~$49.99 |

### Steps in App Store Connect

1. **My Apps** → select your app → *Monetization* → *In-App Purchases*.
2. Create each consumable:
   - Click **+** → *Consumable*.
   - Set **Product ID** exactly. Add a localised display name and screenshot.
   - Submit for review (status must reach at least *Ready to Submit*).
3. **Subscriptions** tab → create subscription group `PriceBack Pro` → add `priceback_unlimited_monthly` AND `priceback_unlimited_annual`.
   - Monthly: duration = 1 month, price = $4.99. Annual: duration = 1 year, price = $49.99.
   - Add App Store Review info (screenshot, notes).
   - Submit for review.
4. **Link to RevenueCat:**
   - RC dashboard → *App Store Connect* app → *Products* → import or add manually.
   - Attach `priceback_unlimited_monthly` and `priceback_unlimited_annual` to entitlement `unlimited`.
   - Add the three pack IDs as Non-subscription (consumable) products.

### iOS — no Info.plist change required

`react-native-purchases` does not require any `Info.plist` key for standard IAP. The `StoreKit` framework is linked automatically. The only iOS-specific setup is:

- **Shared Secret** — needed if you also want to validate receipts server-side (RevenueCat handles this for you; you paste the shared secret into the RC dashboard, not your app).
- **Sandbox test account** — create an Apple sandbox tester in App Store Connect → *Users and Access* → *Sandbox Testers* to test without real charges.

---

## Railway environment variables (backend)

| Variable | Value |
|---|---|
| `REVENUECAT_WEBHOOK_TOKEN` | A secret string you choose (e.g. `openssl rand -hex 32`). This MUST match the `Bearer <token>` value you enter in the RC Authorization header. |
| `REVENUECAT_SECRET_KEY` | The RevenueCat **secret** REST API key (RC dashboard → API keys → Secret, starts with `sk_`). Backs `POST /api/me/subscription/sync`: the backend pulls the subscriber's entitlements server-to-server so a subscription is recorded in the DB (users tier + `subscription_events`) even when the webhook never fires. Without it the endpoint returns 503 and the webhook is the ONLY writer. |

Set these under **Railway → your backend service → Variables** before enabling the webhook in RevenueCat.

> **2026-07-09 field finding:** prod had **zero rows in `subscription_events` ever** while
> real test subscriptions were sold — the webhook had never delivered (token and/or
> dashboard webhook missing). `GET /health` now reports both flags under
> `checks.revenuecat` (`webhook`, `syncApi`); keep them `configured` in prod.
>
> **2026-07-11 status — RESOLVED:** both `webhook` and `syncApi` now read `configured` on
> prod `/health`. `REVENUECAT_SECRET_KEY` is set on Railway prod (and dev). Prod fully
> records purchases now, from either the webhook or the sync endpoint.

---

## EAS secrets (mobile build)

| Secret | Value |
|---|---|
| `REVENUECAT_API_KEY` | The RevenueCat **public** SDK key for the platform. Android keys start with `goog_`, iOS keys with `appl_`. If you use one key per platform, supply a JSON object: `{"ios":"appl_…","android":"goog_…"}` — `purchaseService.js:85-89` handles both shapes. |

Set via `eas secret:create --scope project --name REVENUECAT_API_KEY --value "..."`.

---

## Verification checklist (once configured)

> **✅ Re-verified against prod `/health` on 2026-07-11 (final check):**
> `checks.revenuecat.webhook: "configured"` AND `checks.revenuecat.syncApi: "configured"` —
> **both revenuecat checks are now configured on prod.** Maxim generated a RevenueCat secret
> key (RC dashboard → API keys → Secret) and set `REVENUECAT_SECRET_KEY` on Railway prod (also
> mirrored to dev). `POST /api/me/subscription/sync` is live; the next real/test subscription
> should land in `subscription_events` within seconds of purchase, from either the webhook or
> the sync endpoint.

- [x] Railway `REVENUECAT_WEBHOOK_TOKEN` set — confirmed via `/health` 2026-07-11.
- [x] Railway `REVENUECAT_SECRET_KEY` set — confirmed via `/health` 2026-07-11 (`syncApi: "configured"`, on both prod and dev).
- [x] RC webhook URL points at the live Railway domain — confirmed via `/health` 2026-07-11.
- [x] RC webhook Authorization header is `Bearer <same token>` — confirmed via `/health` 2026-07-11.
- [x] All 5 product IDs created + activated in **Play Console** (3 packs + monthly & annual subs). *(App Store Connect still pending — iOS not launched.)*
- [x] All 5 products imported in RevenueCat and attached to the `default` (current) offering — verified 2026-07-11.
- [x] Entitlement `unlimited` linked to `priceback_unlimited_monthly` AND `priceback_unlimited_annual` — verified 2026-07-11.
- [ ] `REVENUECAT_API_KEY` EAS secret set (Android `goog_…` + iOS `appl_…`).
- [ ] Build with real key → paywall renders with store prices, no code-23 error.
- [ ] Sandbox-purchase subscription → `unlimited` entitlement active.
- [ ] Sandbox-purchase a pack → webhook fires → credit balance increases.

## Error-message polish — IMPLEMENTED

The app no longer surfaces the raw native store sentence. `purchaseService.purchaseProduct`
now classifies every failure via `classifyPurchaseError(err)` into a stable code —
`"unavailable" | "already_owned" | "store_problem" | "network" | "unknown"` — logs the
underlying RC/store code (`console.warn [IAP] …`) for diagnosis, and **returns** the result
(`{ success:false, errorCode, rcCode }`) instead of throwing. `Paywall.purchaseErrorMessage()`
(shared with `BuyCreditsScreen`) maps the code to friendly i18n copy
(`paywall.errUnavailable` / `errStoreProblem` / `errAlreadyOwned` / `errNetwork`, EN+FR). The
"item could not be found" family maps to `unavailable`.

**Sideload simulate-fallback (dev loop).** A locally-built, sideloaded APK
(`buildProfile === "local"`, from `manual_build/build-and-install.ps1`) can NEVER complete a
real Google Play purchase — Play Billing returns "item could not be found" for every SKU. So in
that build only, `purchaseProduct` falls back to the **simulated grant** (identical to the no-key
dev-mode: flips the tier / confirms the pack to the backend) whenever the store errors with
`unavailable` or the offering is empty — making the paywall flow testable on a sideload without a
Play install. Gated strictly on `buildProfile === "local"` (surfaced by app.config.js from
config/profiles): **every Play-distributed build is `buildProfile === "eas"`, so internal-test
and production still do real purchases and still surface the real error.** Non-`unavailable`
failures (network, etc.) are never simulated. For a REAL purchase test, install the app from the
Play internal-test track (Symptom #2), not the sideload.

Still deferred: add the iOS `appl_…` key (code already supports the `{ ios, android }` shape).

## Verification (once configured)

1. Build with the real key; open the paywall — no code-23 error; plans + packs render with store prices.
2. Sandbox-purchase the subscription → `unlimited` entitlement active; app unlocks.
3. Sandbox-purchase a pack → webhook fires → credit balance increases.
