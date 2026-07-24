# Reviewer Notes — PriceBack Canada

Copy-paste this into:
- **App Store Connect → App version → App Review Information → Notes**
- **Google Play Console → App content → Testing instructions** (under App access)

Both stores have a free-text field for reviewer notes. Apple's is 4000 chars;
Play's is shorter. The "Short version" at the bottom of this file fits both.

Before pasting: fill in the placeholders marked `TODO`. The demo account is
the most common rejection cause — without one, the reviewer can't get past
the Continue-with-Google gate, and they reject within minutes.

---

## Demo account

Use this Google account to sign in. Postal code and province are pre-filled
in the onboarding to skip the manual step.

- **Email:** TODO — create a dedicated Google account for App Review
- **Password:** TODO

We use Google Sign-In (and Apple Sign-In on iOS), which means we cannot
hand out a username/password unique to the app. Apple reviewers should
have no trouble accepting a Google demo account; if they push back, we
also accept Apple Sign-In on iOS and either works.

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

After signing in with the demo Google account above:

1. **Receipt scan** — tap the camera FAB (center of the tab bar). Either
   take a photo of any receipt, or use **Choose Photo** → pick anything
   from the gallery. OCR runs; you land on the parsed-items review screen.
   Tap **Save Receipt**.

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

- **Camera (NSCameraUsageDescription / android.permission.CAMERA)** —
  receipt scanning is the core action; required.
- **Photo library (NSPhotoLibraryUsageDescription /
  READ_MEDIA_IMAGES + photo picker)** — alternate path: importing a
  pre-existing receipt photo without re-taking it.
- **Notifications (NSUserNotificationsUsageDescription /
  POST_NOTIFICATIONS)** — alerting users when a watched item drops in
  price (the whole product premise).
- **Approximate location (NSLocationWhenInUse / ACCESS_COARSE_LOCATION)** —
  used only to pick the nearest Costco for in-warehouse price-tag scans.
  **Coarse only; we do not request precise/fine location.**
- **Background fetch (RECEIVE_BOOT_COMPLETED + WAKE_LOCK)** —
  expo-task-manager re-registers price-check tasks after device reboot.

We deliberately strip the advertising ID (`AD_ID`), microphone
(`RECORD_AUDIO`), and precise location (`ACCESS_FINE_LOCATION`) permissions
that our SDKs pull in transitively but the app never uses — so the shipped
manifest requests only the permissions listed above. No contacts, no
microphone, no precise location, no health data, no advertising ID, no
cross-app tracking.

---

## Sign in with Apple (iOS only)

Enabled per App Store guideline 4.8. Tap "Continue with Apple" on the
sign-in step instead of Google if you prefer to test with an Apple ID.

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

Tested via App Store / Play Store sandbox accounts. RevenueCat is wired
end-to-end; subscription entitlements flip the in-app premium flag (unlocks
PDF export, email sync, family sharing), and consumable credit-pack
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
  (annual = 12 months for the price of 10, i.e. 2 free months). Both
  cycles unlock: unlimited scans, no per-drop charge, email sync
  (Gmail + Outlook), PDF export, family sharing, advanced analytics,
  priority price checking (every 2 h).

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
> **Demo account:** TODO@example.com / TODO_PASSWORD
>
> Sign in with Google or Apple → scan a receipt with the camera FAB → see
> it appear on Home → tap to view Detail → try Profile → Download my
> data and Delete my account.
>
> Privacy: https://priceback.ca/privacy-policy · Support: https://priceback.ca/support
>
> Permissions: camera (scan), photo library (import), notifications
> (price-drop alerts), coarse location (nearest Costco only). No precise
> location, contacts, microphone, advertising ID, or tracking.
>
> Contact: TODO@priceback.ca
