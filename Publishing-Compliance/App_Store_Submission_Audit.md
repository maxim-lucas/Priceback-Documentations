# App Store submission audit — PriceBack Canada

**Audited:** 2026-07-26 · against app version 2.8.1 / iOS build 20 (`com.priceback`)
**Scope:** everything that could get the first iOS submission refused — App
Review guideline violations, upload-blocking Info.plist / privacy-manifest
problems, iOS-only code paths that are broken or silently wrong, and store
metadata that contradicts the binary.

Android / Google Play behaviour was treated as a hard constraint throughout:
every fix below is either iOS-only or platform-neutral. The Play build's
RevenueCat key, permissions, and sign-in flow are unchanged.

Read this alongside `PUBLISH_CHECKLIST.md` (the full launch runbook) and
`REVIEWER_NOTES.md` (the text to paste into App Review Information).

---

## 1. Blockers found and fixed in the codebase

### 1.1 A store build could hand out paid features for free — Guideline 3.1.1

**The single most serious finding.** `purchaseService.purchaseProduct` began
with:

```js
if (!isRevenueCatConfigured()) {
  return _simulatePurchase(productId, tier, pack, "Dev mode");
}
```

There was no build check on that branch. `_simulatePurchase` flips the local
premium flag and confirms credit packs to the backend ledger — a completed
purchase with no payment sheet and no store transaction. So an iOS release built
without a valid RevenueCat `appl_…` SDK key would have granted **Unlimited and
every credit pack for free**, reproducible by a reviewer tapping *Subscribe*
once. That is exactly what Guideline 3.1.1 prohibits (and Google Play's Payments
policy equally).

The odds of hitting it were high, not theoretical — see 1.2.

**Fixed:** simulation is now gated on `_simulationAllowed()`, which is true only
for `buildProfile === "local"` (`expo start`, `expo run:*`, sideloaded Gradle
APKs). Every EAS-produced binary — App Store, TestFlight, Play, internal
distribution — reports the purchase as unavailable instead. The two pre-existing
sideload fallbacks were moved onto the same gate, so there is now one policy in
one place. Regression tests pin both directions.

Note this tightens EAS `dev`/`preview` profiles too: they no longer simulate
purchases when no key is configured. That is intended — those builds resolve a
real key from their EAS environment, and a build that fakes purchases is not a
build worth testing purchases on.

### 1.2 RevenueCat had one key for two stores — Guideline 3.1.1 / 2.1

RevenueCat issues a **different public SDK key per store** (`appl_…` App Store,
`goog_…` Play), and the two are not interchangeable. The build config resolved a
single `REVENUECAT_API_KEY` env var and handed the same value to both platforms.
Since the existing value is the Play key, the first iOS build would have
configured the SDK with a Google key. That does not fail loudly: it configures
fine and then resolves **zero purchasable products**, so the paywall renders with
prices and buys nothing — and, before fix 1.1, granted everything for free
instead.

**Fixed, three layers:**

- `config/profiles/revenuecat.js` resolves `{ ios, android }` from
  `REVENUECAT_API_KEY_IOS` / `REVENUECAT_API_KEY_ANDROID`. A legacy single
  `REVENUECAT_API_KEY` is routed to the platform its prefix names — so **the
  existing Play build keeps exactly the key it had** — and an unprefixed legacy
  key is still offered to both.
- `purchaseService` rejects a wrong-store key at runtime (an `appl_` key on
  Android, a `goog_` key on iOS) and treats it as unconfigured with a warning,
  rather than configuring the SDK with something that cannot work.
- `app.config.js` **fails the build** when a `--profile production` EAS build for
  either platform has no usable key for that platform. Escape hatch:
  `ALLOW_MISSING_IAP_KEY=1`.

➜ **Action required before building:** set `REVENUECAT_API_KEY_IOS` in the EAS
production environment (§2.1).

### 1.3 Apple sessions died after ten minutes — Guideline 2.1

`signInWithApple` stores Apple's `identityToken` and every backend call sends it
as the Bearer. **Apple identity tokens expire after ten minutes.** The only
refresh primitive in `authService` was Google's `signInSilently`, which has
nothing to re-issue for an Apple user, so `getValidIdToken` fell through and
returned the stale token forever. Meanwhile `isSignedIn()` only checks that a
token is *stored*, so the app kept looking signed in.

Net effect: ten minutes after signing in with Apple, every `/api/me/*` call
401s — receipts don't save, the profile won't load, credits won't read — with no
recovery short of sign-out and back in. App Review sessions are far longer than
ten minutes, and Sign in with Apple is the flow we now steer reviewers to.

**Fixed:** refresh is provider-aware. Apple sessions re-authorize through
`expo-apple-authentication` (on an already-authorized device, one Face ID
confirmation), with three rails: a single shared in-flight attempt so parallel
requests can't stack sheets, a 60-second cooldown after a failure so background
tasks that can't present UI don't loop, and no prompt at all once Apple reports
the credential `REVOKED`/`NOT_FOUND` — in that case the stored token is cleared
so the app stops claiming a session it can't use. Google sessions are untouched.

*Longer-term:* the clean fix is exchanging Apple's `authorizationCode` for a
backend-issued session token (needs an Apple `.p8` key, Team ID, Key ID). Worth
doing, but it is a new auth token type across the whole app and not something to
introduce days before a submission.

### 1.4 iOS Google Sign-In had no client ID — Guideline 2.1

`googleClientIdIos` was the placeholder `"YOUR_GOOGLE_CLIENT_ID_IOS"` in the
committed defaults, resolved only from an EAS env var that the checklist still
listed as pending. Without it `@react-native-google-signin` gets no
`iosClientId` and "Continue with Google" dead-ends — on the first screen App
Review sees.

**Fixed:** the real iOS client ID now sits in `config/profiles/common.js`
alongside the web and Android ones. It is not a secret — the identical client is
already public in `app.json` as the plugin's `iosUrlScheme`, which prebuild
writes into `Info.plist`. Gmail sync's own `GoogleSignin.configure` call was
missing `iosClientId` as well (it would have failed on iOS even after sign-in
worked); fixed the same way.

### 1.5 Empty privacy manifest vs. an app that collects plenty — Guideline 5.1.1

`ios.privacyManifests.NSPrivacyCollectedDataTypes` was `[]` while the app
collects email, name, provider `sub`, a device fingerprint, purchase history,
receipt photos, synced email content, coarse location, and product-interaction
analytics. The required-reason API entries were present (so the upload wouldn't
bounce with ITMS-91053), but an empty collected-data array contradicts the App
Store Connect privacy answers, and Apple compares them.

**Fixed:** twelve accurate entries, each with `Linked`, `Tracking: false`, and
purposes. `NSPrivacyTracking` stays `false` — nothing here tracks across apps or
sites, and no IDFA is read. §2.4 lists the matching App Store Connect answers;
they must agree with this file.

### 1.6 An unused microphone purpose string — Guideline 5.1.1

`expo-camera`'s config plugin declares both camera and microphone so
video-with-audio works out of the box, so `NSMicrophoneUsageDescription` landed
in `Info.plist`. PriceBack only captures still photos. A microphone string on a
receipt scanner reliably draws a "we couldn't find the feature that uses the
microphone" rejection, and a static `ios.infoPlist` entry can override a value
but cannot delete a key.

**Fixed:** `plugins/withIosPrivacyStringCleanup.js` — the exact iOS counterpart
to the existing `withAndroidPermissionCleanup` (which already strips
`RECORD_AUDIO`), so both platforms now tell their store the same story. It also
drops any stray `NSLocationAlways*` string (we request when-in-use only) and the
`microphone` device-capability entry.

### 1.7 Sign-in screen described the wrong provider — Guideline 5.1.1

On iOS the sign-in body read *"Sign in with Google so price-drop alerts reach
you… we also use this to sync receipts from your Gmail"* — hardcoded English,
Google-only, rendered directly above the Apple button. A wrong disclosure at the
point of collection, on the first screen. (A previous pass fixed the small print
below the buttons but not this.)

**Fixed:** platform-accurate translated copy naming the providers actually
offered, and **Sign in with Apple is now the first button on iOS**. Guideline
4.8 requires SIWA to be an equivalent option wherever a third-party login is
offered; "equivalent" is safest read as at-least-as-prominent. Android is
unchanged — Google stays first and the Apple button never renders.

### 1.8 Paywall prices were hardcoded, not the store's — Guideline 2.3.1 / 3.1.2

Both purchase surfaces printed the catalog's literal `"$4.99"` / `"$3"` strings.
App Review reads the price on the paywall against the price in App Store
Connect, and any storefront that charges something else makes the app's own
paywall inaccurate.

**Fixed:** `getStorePriceLabels()` reads the localized `priceString` from the
RevenueCat offering, and the Paywall and Buy-Credits screens both prefer it,
falling back per-product to the catalog label when offline or unconfigured. Both
surfaces use the same helper so they can never quote different prices for one
pack.

### 1.9 Store metadata contradicted the code — Guideline 2.3.1 / 5.1.1

Two problems in `marketing/app-store-description.md`:

- *"Receipt photos are processed for text extraction and not retained."* They
  **are** retained: `receiptSyncService` uploads the receipt image to a
  presigned URL and the backend archives it in R2 whenever the user is signed
  in. An inaccurate privacy claim in the description that contradicts the
  privacy manifest is a rejection, and the wrong one to argue about.
- **`costco` was the first App Store keyword.** Keywords are the field Apple
  checks for trademarks the developer doesn't own — pure search positioning
  with none of the descriptive justification a description has. It is a very
  common first-submission rejection.

**Fixed:** the retention sentence now describes what actually happens (device +
account backup, including the photo, with in-app export and deletion), retailer
names are out of the keyword field, and a non-affiliation disclaimer was added
to the description and the reviewer notes.

### 1.10 The reviewer notes were themselves a rejection — Guideline 2.1

`REVIEWER_NOTES.md` shipped `**Email:** TODO` / `**Password:** TODO` for the
demo account, in the file whose own header calls a missing demo account "the
most common rejection cause".

Worse, the plan was wrong even filled in: a shared **Google** account on a
review device routinely trips Google's device-verification challenge (a code to
the account owner's phone) that the reviewer cannot clear, which reads as a
broken sign-in.

**Fixed:** the notes now tell Apple that **no demo account is needed** — tap
*Continue with Apple*, which creates a real account with the reviewer's own
Apple ID (Hide My Email supported, 75 free credits granted immediately). They
also supply the Canadian postal code and province the setup step requires
(`M5V 3L9`, Ontario) — without which a Cupertino reviewer is stuck at a
validated Canada-only form — plus a note that any receipt photo exercises the
scan flow, an independence statement, and an explanation of the account-gated
maintainer screens.

### 1.11 Backend Apple-auth readiness is now visible on `/health`

An iOS build whose backend can't verify Apple tokens is a dead sign-in and an
automatic 2.1, and there was no way to confirm a deploy carried the verifier.
`/health` now reports `appleAuth: { status, audience }`; the key's very presence
in the response proves the running deploy postdates the Apple verifier.

**Verified against production during this audit:** an Apple-issuer token returns
`{"error":"Invalid token"}` (the Apple verifier path) where a malformed token
returns `{"error":"Token verification failed"}` (the Google verifier throwing).
Both `priceback-production` and `priceback-development` are already on the Apple
code, and production `/health` is `healthy: true` with db, auth, ocr, and both
RevenueCat write paths configured.

---

## 2. Actions required outside the repo

Nothing below can be done from the codebase. Each item has caused real
first-submission rejections.

### 2.1 EAS — set the iOS RevenueCat key (build fails without it)

```
eas env:create --environment production --name REVENUECAT_API_KEY_IOS \
  --value appl_XXXXXXXXXXXX --visibility sensitive
```

Optionally rename the existing Play key to `REVENUECAT_API_KEY_ANDROID` for
symmetry — not required, since a bare `goog_…` `REVENUECAT_API_KEY` still routes
to Android only.

### 2.2 App Store Connect — in-app purchases

- Create all five products with **exactly** these IDs (RevenueCat matches on
  them, and a mismatch resolves as unavailable):
  `priceback_pack_starter`, `priceback_pack_pro`, `priceback_pack_max`
  (consumables) and `priceback_unlimited_monthly`, `priceback_unlimited_annual`
  (auto-renewable, one subscription group).
- Attach every product to RevenueCat's `default` offering, the same way the Play
  products already are. An unattached SKU is invisible to the app.
- **Submit the IAPs together with the app version.** On a first submission,
  products left in "Ready to Submit" are not reviewed, and the reviewer then
  finds a paywall that sells nothing.
- Give the subscription group and each product a localized display name and
  duration — Apple rejects missing subscription metadata.
- Set prices so they match the catalog: CAD 4.99/mo, 49.99/yr, and 3 / 5 / 10
  for the packs. With fix 1.8 the app now shows the store's own price, so a
  mismatch is cosmetic rather than a violation — but keep them aligned anyway.
- Upload a subscription review screenshot for the group.

### 2.3 App Store Connect — availability: Canada only

The app hard-codes Canada, requires a Canadian postal code, and tracks Canadian
retailer policies. Shipping it worldwide invites a 2.1 rejection ("we were
unable to use the app in our region") from a reviewer whose storefront isn't
Canada. **Set Availability to Canada only.** It also keeps single-currency price
labels honest.

### 2.4 App Store Connect — App Privacy answers

They must match `ios.privacyManifests` in `app.json` (§1.5). Declare collected,
linked to identity, **not** used for tracking:

| Category | Types | Purpose |
|---|---|---|
| Contact Info | Email Address, Name | App Functionality |
| Identifiers | User ID, Device ID | App Functionality |
| Purchases | Purchase History | App Functionality |
| User Content | Photos or Videos, Emails or Text Messages, Other User Content | App Functionality |
| Location | Coarse Location | App Functionality |
| Usage Data | Product Interaction | App Functionality, Analytics |
| Diagnostics | Crash Data, Performance Data | App Functionality (**not** linked) |

Answer **No** to tracking and to third-party advertising. Privacy Policy URL:
`https://priceback.ca/privacy-policy`.

### 2.5 App Store Connect — App Information

- **Terms of Use (EULA)** field: `https://priceback.ca/terms-of-service`.
  Required for auto-renewable subscriptions; the paywall already carries both
  links in-binary, and Apple checks the metadata field too.
- Support URL `https://priceback.ca/support`, marketing URL `https://priceback.ca`.
- Age rating 12+ (matches the Play IARC answer).
- App Review Information: paste `REVIEWER_NOTES.md`, and give a phone number and
  an email Apple can actually reach.

### 2.6 Apple Developer — Sign in with Apple capability

Enable **Sign In with Apple** on the `com.priceback` identifier before the first
build, or the entitlement is missing and the button crashes at runtime. EAS
managed credentials pick it up on the next provisioning-profile refresh. Apple
sends a verification email after the first SIWA build — click through it.

### 2.7 Screenshots

6.7" iPhone required; adding 6.5" is safer. **No iPad screenshots** —
`supportsTablet` is `false`, so an iPad screenshot contradicts the binary. No
retailer logos or wordmarks in any screenshot or the app icon.

### 2.8 Verify before submitting

```
curl -s https://priceback-production.up.railway.app/health | jq '.healthy, .checks'
```

Expect `healthy: true`, `appleAuth.audience == "com.priceback"`, and
`revenuecat.webhook == "configured"`. If `appleAuth` is absent, the deploy
predates the Apple verifier — redeploy before submitting.

---

## 3. Reviewed and judged acceptable

- **Account deletion** — in-app under Profile with a two-step confirm, plus data
  export. Guideline 5.1.1(v) satisfied.
- **Paywall legal links** — Terms of Use and Privacy Policy are in the binary on
  the paywall itself, language-aware, and both URLs serve real documents
  (verified live during this audit). Auto-renew disclosure, price, cadence, and
  Restore Purchases are all present.
- **Required-reason API declarations** — UserDefaults (CA92.1), file timestamps
  (C617.1), disk space (E174.1), boot time (35F9.1). Covers `expo-file-system`,
  `expo-device`, and Sentry.
- **App icon** — 1024×1024, no alpha channel (checked: colour type 2). Won't
  bounce with ITMS-90717.
- **Encryption** — `ITSAppUsesNonExemptEncryption: false` is correct: HTTPS and
  platform crypto only.
- **Permission purpose strings** — camera, photo library, and location are
  specific about the feature that needs them, and location is when-in-use only.
- **Maintainer screens** — server-gated on an account allow-list with every
  endpoint enforcing it independently. Documented in the reviewer notes so 2.3.1
  ("hidden features") can't be inferred.
- **No external purchase path** — every `Linking.openURL` goes to legal pages,
  retailer policy pages, `mailto:`, or the platform's own subscription-management
  URL, correctly branched per platform. Nothing steers a user to web checkout
  (Guideline 3.1.1).

## 4. Flagged, left as a product decision

- **The 19 "Coming soon" retailers** in the Stores tab. Each row has a working
  per-store "notify me when it launches" opt-in and real policy data, which is
  functioning behaviour rather than a placeholder — but a reviewer can read a
  list of nineteen unavailable stores as an incomplete app (2.1). The reviewer
  notes explain the design. If a rejection does cite it, the cheap answer is to
  collapse them into a single "more retailers coming" row rather than list them
  individually.
- **Retailer price scraping and flyer ingestion.** Nominative use plus public
  policy links is the standard footing for a price-comparison app, and 5.2.1
  rejections here are uncommon — but they do happen, and the mitigation is the
  independence disclaimer now present in the description and reviewer notes.
- **Onboarding's remaining hardcoded English** ("Finish setting up", "Country",
  "Postal code", "Agreements", …). Not a review criterion — Apple doesn't
  require localization — but the French App Store listing will send fr-CA users
  to a partly-English setup screen. Worth a follow-up pass.

## 5. Not verifiable from this machine

Node isn't installed here, so `npm test` and `npm run typecheck` could not be
run locally. The changed and added suites are:

- `__tests__/purchaseService.test.js` — dev-mode blocks now declare
  `buildProfile: "local"` (they were asserting the unsafe behaviour); new
  describes for store-build refusal, wrong-store keys, and `getStorePriceLabels`.
- `__tests__/authServiceAppleSession.test.js` — new; the Apple refresh path,
  cooldown, shared in-flight prompt, revoked credential, and Google
  non-regression. `authService.js` carries a per-file coverage floor, so this
  suite is what keeps CI green.
- `__tests__/configRevenueCatKeys.test.js` — new; key routing including the
  legacy-var back-compat that protects the Play build.
- `__tests__/offlineScanCredits.test.js` — one mock gains `buildProfile: "local"`.

Run `npm test` before building.
