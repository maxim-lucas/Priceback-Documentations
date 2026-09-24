# Reviewer Notes — PriceBack

Copy-paste this into:
- **App Store Connect → App version → App Review Information → Notes**
- **Google Play Console → App content → Testing instructions** (under App access)

Both stores have a free-text field for reviewer notes. Apple's is 4000 chars;
Play's is shorter. The "Short version" at the bottom of this file fits both.

---

## Sign-in — how the reviewer gets in

### iOS: use the access code in App Review Information

**On the sign-in screen, tap "Have an access code?" (the small underlined link
below the sign-in buttons), enter the code from the App Review Information
field above, and tap Sign in.** That opens a normal, fully-featured account with
credits already on it. No Apple ID, no Google account, no browser, no email.

This is now the FIRST instruction rather than a fallback, because of what our
crash reporting shows about review devices. On every build submitted since
2026-08-10, sign-in attempts from Apple's network have failed 100% of the time:

- **Sign in with Apple** returns `ASAuthorizationError 1000` in under 100 ms with
  no sheet ever shown — the signature of a device with no Apple ID signed into
  iCloud.
- **Google Sign-In**, attempted seconds later in the same session, returns
  `"Unable to open Safari."`

Both providers need something a review device does not have. The previous
version of this document told the reviewer to use Sign in with Apple and offered
Google as the fallback — i.e. it pointed at the one path that provably fails,
with a backup that fails too. The access code needs neither.

Sign in with Apple and Google both still work normally and remain on the screen
for real users; they are simply not the instruction we give a reviewer.

#### Operator setup (not part of the review)

The code is the `REVIEWER_ACCESS_CODE` environment variable on **both** Railway
services (production and development). Until it is set the route fails closed —
it answers the same 401 as a wrong code, deliberately, so an unset variable
cannot be probed for.

Confirm it landed before submitting: `GET /health` reports
`checks.reviewerAccess.status`, which is `"available"` only when the code AND
first-party sessions AND the database are all present. It never publishes the
code itself.

Rotating the variable revokes the code immediately and completely. It reaches
exactly one synthetic account (`reviewer:appstore`) that holds no real user data
and has no admin access, so the worst case if the code leaks is that a stranger
looks at a demo account.

**iOS only.** `authedFetch` consults the first-party session on iOS only, so on
Android the code is not offered and the link is not rendered — see the Play
section below.
### Onboarding after sign-in asks for a region — use these values

The app serves Canadian retailer price-adjustment policies only, so the setup
step requires a Canadian postal code and province. Any valid pair works; these
are convenient:

- **Postal code:** `M5V 3L9`
- **Province:** Ontario
- Country is fixed to Canada and cannot be changed.

Then tick the two required agreement checkboxes (Terms of Service, Privacy
Policy — both open the live public documents) and tap Finish. The optional
referral-code field can be left empty.

### Android / Play: same flow, Google Sign-In

Android offers Google Sign-In only (Sign in with Apple is iOS-only). If the
Play reviewer prefers not to use their own Google account, contact
maxim.lucas@viacesi.fr and a dedicated test account will be provisioned within
one business day.

---

## What the app does

PriceBack helps Canadians reclaim money from retailer price-adjustment
policies. Workflow:

1. User scans a paper receipt with the camera (or imports one from photos).
2. We OCR it and extract the items, prices, store, and purchase date.
3. We periodically check current retailer prices for each item until the
   store's published price-adjustment window closes (typically 14–100 days).
4. When the price drops, the user gets a notification with the savings
   amount and a one-tap "Claim" flow that opens an email / phone / in-store
   talking-points sheet to request the price match.

We do not handle any retailer transactions ourselves. We surface the
opportunity; the user files the claim with the retailer directly.

---

## How to test the core flows in ~3 minutes

After signing in:

1. **Receipt scan** — tap the camera FAB (center of the tab bar). Either
   take a photo of any receipt, or use **Choose Photo** → pick anything
   from the gallery. OCR runs; you land on the parsed-items review screen.
   Tap **Save Receipt**.

   No Costco receipt to hand? Any receipt photo exercises the full path —
   the camera, the OCR round-trip, the parsed-item review screen, and the
   save. Items the parser can't recognise can be corrected or added by hand
   on that screen ("+ Add item"), so a saved receipt and the tracking flow
   behind it are reachable from any photo at all.

2. **Home screen** — the saved receipt now appears under "Products you're
   tracking" with a coloured chip (green / yellow / red urgency tier based
   on adjustment-window remaining).

3. **Detail screen** — tap the receipt. You can see the items list, edit
   any line (name, price, qty, SKU), add a new item via "+ Add item",
   edit the receipt header (date, total, tax, warehouse #), and trigger
   a price refresh via "Refresh prices".

4. **Profile** — tap the profile tab. Try:
   - **Download my data** → produces a JSON export of everything stored.
   - **Delete my account** → permanently wipes the account (you'll be
     signed out — sign back in to continue testing).
   - **Export Data** → generates a PDF report of claimed price-adjustments
     for a month / quarter / year.

5. **Stores tab** — launches with Costco as the only active retailer
   (full claim flow + weekly flyer overlay + crowdsourced warehouse
   pricing). The 19 other Canadian retailers are visible in the list
   with a "Coming soon" pill and full policy data so reviewers can see
   the roadmap — they are not silently hidden. Each disabled row offers
   a per-store "Notify me when it launches" opt-in (stored locally,
   mirrored to the backend when signed in). Scanning a non-Costco
   receipt is intentionally a no-op: OCR runs so the user sees we
   detected the store correctly, but Save is replaced with the same
   launch-notification CTA and no scan credit is consumed. Stores are
   flipped to active by toggling `enabled: true` in
   `backend/data/policies.json` (STORE-02 remote-refresh — no app
   release required) or in `src/constants/stores.js` for the bundled
   fallback.

---

## Permissions — why we ask

### When we ask, and what you will see

Right after sign-in there is a single explanatory screen listing the two
permissions the app uses immediately, with one button: **Continue**. It has no
skip, no dismiss and no back — pressing Continue always takes you into the iOS
camera prompt and then the notifications prompt. Declining either is fine and
does not block the app.

Every other permission is requested **only from the action that needs it**:

| Permission | Asked when |
|---|---|
| Photo library | you tap Upload / choose a photo |
| Location | you open the Costco warehouse picker |
| Photo library (scan suggestions) | you switch that option on in Profile |

If you decline a permission, the app does not re-ask — iOS only prompts once.
Instead the relevant screen explains what is unavailable and offers an **Open
Settings** button, so there is always a route back.

*(2.8.18 was rejected under 5.1.1(iv) because this screen's button read "Allow
access" and offered a "Maybe later" that skipped the prompt. Both are gone as of
2.8.19 — see `App_Store_Rejections.md`.)*

### What each permission is for

- **Camera (NSCameraUsageDescription / android.permission.CAMERA)** —
  receipt scanning is the core action; required.
- **Photo library (NSPhotoLibraryUsageDescription on iOS; on Android: no
  permission at all)** — alternate path: importing a pre-existing receipt
  photo without re-taking it. On Android this goes through the **system photo
  picker** (expo-image-picker on SDK 55 uses `PickVisualMedia`), which grants
  per-item access without any media permission — see the stripped list below.
- **Notifications (NSUserNotificationsUsageDescription /
  POST_NOTIFICATIONS)** — alerting users when a watched item drops in
  price (the whole product premise).
- **Approximate location (NSLocationWhenInUse / ACCESS_COARSE_LOCATION)** —
  used only to pick the nearest Costco for in-warehouse price-tag scans.
  **Coarse only; we do not request precise/fine location.**
- **Background fetch (RECEIVE_BOOT_COMPLETED + WAKE_LOCK)** —
  expo-task-manager re-registers price-check tasks after device reboot.

We deliberately strip the advertising ID (`AD_ID`), microphone
(`RECORD_AUDIO`), precise location (`ACCESS_FINE_LOCATION`) and broad media-read
(`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`) permissions that
our SDKs pull in transitively but the app never uses — so the shipped
manifest requests only the permissions listed above. No contacts, no
microphone, no precise location, no health data, no advertising ID, no
cross-app tracking.

The media-read trio came from `expo-media-library`, whose config plugin Expo
autolinks (it is never listed in `app.json`) with a default of
`granularPermissions: ['photo','video','audio']`. Version code 20 was flagged
under Play's photo-and-video permissions policy for exactly this; version code
21 removes all three at two independent layers — `android.blockedPermissions` in
`app.json` (keeps them out of the requested permission set entirely) and
`plugins/withAndroidPermissionCleanup.js` (neutralises any dependency manifest
that declares them at merge time). Nothing in the app used them: all image
picking goes through the system photo picker, and
`READ_MEDIA_VISUAL_USER_SELECTED` (the partial-access permission Play sanctions)
is kept.

---

## Sign in with Apple (iOS only)

Enabled per App Store guideline 4.8 and offered as the **first** button on the
sign-in screen. Hide My Email relay addresses are accepted end to end: the
backend verifies Apple's RS256 identity token against Apple's JWKS and keys the
account on the `sub` claim, so an account created with a relay address works
identically to one with a real address. Nothing in the app requires the real
address.

---

## Independence from the retailers we support

PriceBack is an independent app with no relationship to any retailer. Retailer
names appear only to identify whose published price-adjustment policy applies
to a given receipt, and the in-app store list links to each retailer's own
public policy page. We use no retailer logos, wordmarks, or trade dress, the
app name and icon reference no retailer, and no retailer's name is used in our
App Store keywords. We take no part in any retailer transaction — the user
files their claim with the retailer directly.

---

## Account-gated internal tools (nothing hidden)

Four maintainer screens exist in the binary — price-tag review, weekly-flyer
ingestion, credit reconciliation, and a barcode↔SKU feeder. They are not hidden
features: their Profile entries render only when the **server** reports the
signed-in account is on the maintainer allow-list, and every backing endpoint
independently rejects non-allow-listed accounts. A reviewer account will not see
them and cannot reach them. They are internal data-curation tooling, contain no
user-facing functionality, and gate nothing the user has paid for.

---

## Privacy + data rights

- Privacy policy: https://priceback.ca/privacy-policy (English)
- Politique de confidentialité : https://priceback.ca/privacy-fr (Français — for Quebec residents per Law 25 §43)
- Terms of Service: https://priceback.ca/terms-of-service
- Support: https://priceback.ca/support

We comply with PIPEDA (federal), Quebec Law 25, Alberta PIPA, British
Columbia PIPA, CCPA, and GDPR. Privacy officer is named in the policy
and reachable at privacy@priceback.ca.

The app provides in-app **Download my data** (GDPR Art 20 portability)
and **Delete my account** (GDPR Art 17 erasure / Law 25 §28) under
Profile.

---

## Third-party services we use

| Service | Purpose | Country |
|---|---|---|
| Google Cloud Vision | Receipt OCR | US |
| Google AI Studio (Gemini) | OCR reconciliation when the heuristic parser is inconsistent (opt-in) | US |
| Sentry | Crash reporting (no PII; payloads scrubbed before send) | US |
| RevenueCat | Subscription management | US |
| Railway | Our backend hosting (US-East) | US |
| Costco Same-Day Delivery | Read-only price scrapes | CA |

Cross-border transfer disclosed in Privacy Policy §10.

---

## What we DON'T do

Putting these here so a reviewer doesn't have to ask:

- We don't sell or share data with advertisers or data brokers.
- We don't use cross-context behavioural advertising.
- We don't track users across apps or websites (no IDFA / GAID usage).
- We don't have automated decision-making that affects users (no AI-driven
  pricing decisions, no algorithmic profiling).
- We don't process payments directly — Apple / Google / RevenueCat handle
  all subscription billing.
- We don't access contacts, calendar, microphone, precise location, or health data. Location is coarse-only, used solely to pick the nearest Costco.

---

## Subscription tiers + credit packs

**Purchases are sold on the Canadian App Store only.** PriceBack is distributed
in Canada, and its in-app purchases exist on the Canadian storefront only. To
test a purchase, please use a Sandbox Apple Account whose Country or Region is
**Canada** (on the device: Settings → Developer → Sandbox Apple Account). On any
other storefront the store returns no products, and the purchase screens say
"Purchases are only available in Canada" instead of showing prices.

> Why this is here (2026-09-24): every "no products" event in our crash
> reporting since 2.9.0 went live comes from Apple's own test devices —
> US network, Chinese-language UI, iOS 27 — where the Canadian products
> correctly do not exist. Canadian devices load all five products at the right
> CAD prices. Nothing about the products needs changing; the reviewer needs the
> Canadian storefront.

Tested via App Store / Play Store sandbox accounts. RevenueCat is wired
end-to-end; subscription entitlements flip the in-app premium flag (unlocks
PDF export and email sync), and consumable credit-pack
purchases land via the RC `NON_RENEWING_PURCHASE` webhook → backend ledger.

- **Free trial** — 75 credits granted once at install (lifetime
  allowance, not a monthly reset). Anti-reinstall enforced via device
  fingerprint on the backend. 1 credit = 1 scan; 75 credits cover up
  to 75 scans **or** ~$5 of refund claims at the 15 credits / $ rate
  (or any mix).
- **One-time credit packs** (no expiry) — Starter $3 (250 credits) ·
  Pro $5 (500 credits) · Max $10 (1,100 credits). Same 1 credit = 1
  scan math, and claims cost `floor(savings_in_$ × 15)` credits.
  Larger packs give more credits per dollar (Max is the best value).
- **Unlimited** — auto-renewing subscription, $4.99/mo or $49.99/yr
  (the annual plan is a discount on twelve monthly payments — no free period
  is offered; see App_Store_Rejections.md, Guideline 3.1.2(c)). Both
  cycles unlock: unlimited scans, no per-drop charge, email sync
  (Gmail + Outlook), PDF export, advanced analytics, priority price
  checking (every 2 h). **Family Sharing is deliberately off** on both
  subscriptions in App Store Connect — the app has no family- or
  device-sharing behaviour, and the paywall no longer claims any (see
  Bugs_Common_Fixes #135).

There are no grandfathered/legacy subscription tiers: the old monthly
Starter/Pro subs and the `priceback_topup_50` pack were removed in
migration 0005 (no pre-launch purchases existed), so the paywall shows
only the packs and Unlimited above.

The catalog above is the only place we publish it — the canonical
definitions live in `shared/pricing.config.js` and every screen, gate,
and legal disclosure reads from there.

---

## Known testing notes

- The first OCR call after install can take 5–10 seconds (cold backend).
- Price refresh can return "no current price" for obscure SKUs that aren't
  on the Costco Same-Day Delivery catalog. This is expected.
- Push notifications arrive on a once-a-day cron after the receipt is saved.
  To test push delivery on-demand, the maintainer can hit
  `POST /api/check-all` on the backend.

---

## Contact for review questions

- Engineering / product: Maxim Lucas — maxim.lucas@viacesi.fr
- Privacy / legal: privacy@priceback.ca
- Security: security@priceback.ca

We respond within 1 business day to reviewer questions.

---

## Short version (fits in any review-notes field)

> PriceBack helps Canadians reclaim money from retailer price-adjustment
> policies. Scan a receipt, we track current prices, alert you when an
> item drops, hand you a one-tap claim flow.
>
> **Signing in (iOS):** on the sign-in screen tap **"Have an access code?"**
> (small underlined link below the buttons), enter the code from the App Review
> Information field above, and tap Sign in. That opens a normal account with
> credits already on it — no Apple ID, no Google account, no browser needed.
> Sign in with Apple and Google also work and are there for real users, but
> both need something a review device typically lacks (an Apple ID signed into
> iCloud; permission to open Safari), so the code is the reliable route.
>
> Setup asks for a Canadian region (the app covers Canadian retailer policies
> only): postal code **M5V 3L9**, province **Ontario**. Accept the two
> agreement checkboxes and continue.
>
> Then: scan a receipt with the camera FAB (any receipt photo works) → see it
> appear on Home → tap to view Detail → try Profile → Download my data and
> Delete my account.
>
> **In-app purchases are sold on the Canadian App Store only.** To test one,
> use a Sandbox Apple Account whose Country or Region is Canada (Settings →
> Developer → Sandbox Apple Account). On any other storefront the store has no
> products and the purchase screens say "Purchases are only available in Canada".
>
> Privacy: https://priceback.ca/privacy-policy · Support: https://priceback.ca/support
>
> Permissions: camera (scan), photo library (import), notifications
> (price-drop alerts), coarse location (nearest Costco only). No precise
> location, contacts, microphone, advertising ID, or tracking.
>
> PriceBack is independent and not affiliated with or endorsed by Costco
> Wholesale or any other retailer named in the app.
>
> Contact: maxim.lucas@viacesi.fr (engineering) · privacy@priceback.ca
