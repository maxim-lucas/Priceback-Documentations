# iOS In-App Purchase & Subscription Setup — TODO

Status as of 2026-07-29 (second session): **Apple ↔ EAS wiring is done; IAP
products partly created.** This doc is the resume point — everything needed to
finish without re-deriving it.

Context: App Store Connect app "PriceBack" (Apple ID `6795860374`, bundle ID
`com.priceback`) is created, with category/age-rating/pricing/availability/privacy
label already done (see `PUBLISH_CHECKLIST.md` §2/§9).

> **Naming:** the app is **PriceBack**, never "PriceBack Canada". `app.json`
> `expo.name` was corrected 2026-07-29. Internal identifiers (EAS slug
> `priceback-canada`, Sentry project) deliberately keep the old string.

---

## 0. Apple ↔ EAS — DONE 2026-07-29

- Org-level **App Store Connect API access** enabled (it was not on before).
- ASC API key `EAS Build`, role Admin — Key ID `P7823WKT9W`, Issuer ID
  `41c53d16-a91b-4b8f-bcce-5b9816cb242b`. The `.p8` is uploaded to the Expo
  account credential store and **cannot be re-downloaded from Apple**.
- Apple Developer App ID `com.priceback` registered by EAS (App ID `Z446L34LP3`).
  Capabilities: Sign in with Apple ✅, Push Notifications ✅, In-App Purchase
  (always-on, not toggleable).
- `eas.json`: `build.production.ios.resourceClass = m-medium`;
  `submit.production.ios` = `{ ascAppId: 6795860374, appleTeamId: 5D2TR5UWGM }`.
  No `appleId` — submission authenticates via the API key, so no 2FA in CI.

**To run a build**, export these first (EAS otherwise stops at an interactive
"Select your Apple Team Type" prompt, because no Apple Team is stored on the Expo
account until a build has run):

```
EXPO_ASC_API_KEY_PATH=<path to AuthKey_P7823WKT9W.p8>
EXPO_ASC_KEY_ID=P7823WKT9W
EXPO_ASC_ISSUER_ID=41c53d16-a91b-4b8f-bcce-5b9816cb242b
EXPO_APPLE_TEAM_ID=5D2TR5UWGM
EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION
```

The distribution certificate and App Store provisioning profile do **not** exist
yet — `eas build -p ios --profile production` generates both automatically on
first run (`credentials:configure-build` can't, because it prompts on stdin).

Gotcha: EAS auto capability sync fails on this App ID with `Apple API error:
Unexpected or invalid value at 'data.relationships.bundleIdCapabilities'` when
enabling PUSH_NOTIFICATIONS. Both capabilities are now set by hand, so the sync
reports "No updates" and proceeds. `EXPO_NO_CAPABILITY_SYNC=1` skips it.

---

## 1. Consumable credit packs

**Consumable**, availability **Canada only**, base country Canada (CAD).

| Reference Name | Product ID | Price (CAD) | Status |
|---|---|---|---|
| Starter Pack (250 credits) | `priceback_pack_starter` | $2.99 (closest tier to $3) | ✅ Created, priced, Canada-only. ⏳ Localizations + review notes still needed. |
| Pro Pack (500 credits) | `priceback_pack_pro` | $4.99 | ✅ Created, priced, Canada-only, en-CA + fr-CA, review notes. Only the screenshot is missing. |
| Max Pack (1,100 credits) | `priceback_pack_max` | $9.99 | ⚠️ Created, priced ($9.99 CAD), Canada-only. Localizations + review notes NOT yet saved. |

### App Store Localization — English (Canada)

| Product | Display Name | Description |
|---|---|---|
| Starter Pack | `Starter Pack` | `250 credits for scanning receipts and price tags` |
| Pro Pack | `Pro Pack` | `500 credits for scanning receipts and price tags` |
| Max Pack | `Max Pack` | `1,100 credits for scanning receipts and price tags` |

### App Store Localization — French (Canada)

⚠️ Description is capped at **55 characters**. The original copy below ran to 56,
so `vos` was dropped.

| Product | Display Name | Description |
|---|---|---|
| Starter Pack | `Forfait Débutant` | `250 crédits pour scanner reçus et étiquettes de prix` |
| Pro Pack | `Forfait Pro` | `500 crédits pour scanner reçus et étiquettes de prix` |
| Max Pack | `Forfait Max` | `1 100 crédits pour scanner reçus et étiquettes de prix` |

---

## 2. Auto-renewable subscriptions — NOT STARTED

Create a **Subscription Group** first (name it "PriceBack Unlimited"), then add
both subscriptions inside it so users can upgrade/downgrade between them. Both map
to the same RevenueCat entitlement: `unlimited`.

| Reference Name | Product ID | Duration | Price (CAD) |
|---|---|---|---|
| Unlimited Monthly | `priceback_unlimited_monthly` | 1 month | $4.99 |
| Unlimited Annual | `priceback_unlimited_annual` | 1 year | $49.99 ("2 months free" vs monthly) |

### App Store Localization — English (Canada)

| Product | Display Name | Description |
|---|---|---|
| Unlimited Monthly | `Unlimited Monthly` | `Unlimited receipt & price-tag scans, billed monthly` |
| Unlimited Annual | `Unlimited Annual` | `Unlimited receipt & price-tag scans — 2 months free` |

### App Store Localization — French (Canada)

Check each against the 55-char cap before saving.

| Product | Display Name | Description |
|---|---|---|
| Unlimited Monthly | `Illimité mensuel` | `Scans illimités de reçus et d'étiquettes, mensuel` |
| Unlimited Annual | `Illimité annuel` | `Scans illimités de reçus et d'étiquettes — 2 mois gratuits` |

---

## 3. Review Information (per product, required before "Add for Review")

**Screenshot** — a real screenshot of the purchase in context. **Still blocked**:
no build exists yet to screenshot. Grab it once a TestFlight build is running; the
same screenshot can be reused across all 5 products and both locales if the
purchase screen shows all options together.

**Review Notes** — for the 3 packs (already entered on Pro Pack):
```
This is a consumable credit pack purchased from the in-app Credits screen
(Profile > Buy Credits). Credits are used to scan receipts and price tags via
OCR. No demo account is needed - Sign in with Apple creates a real account
instantly.
```

For the 2 subscriptions:
```
This is an auto-renewing subscription purchased from the in-app
Upgrade/Unlimited screen. It unlocks unlimited receipt and price-tag scans.
No demo account needed - Sign in with Apple creates a real account instantly.
```

---

## 4. RevenueCat — MOSTLY DONE

RevenueCat project `Priceback` (project id `c7a0e77d`).

Done 2026-07-29:

1. ✅ Apple **In-App Purchase key** generated — Key ID `76A227N695`, Issuer ID
   `41c53d16-a91b-4b8f-bcce-5b9816cb242b`. Downloaded as
   `SubscriptionKey_76A227N695.p8`; **cannot be re-downloaded from Apple**.
2. ✅ RevenueCat App Store app created — name `PriceBack (App Store)`, app id
   `app984c0b5724`, bundle `com.priceback`, custom URL scheme `rc-984c0b5724`,
   with the In-App Purchase key + Issuer ID attached.
3. ✅ Public iOS SDK key `appl_tqHfzJwNHDYhLLTrzSeumIxFKUz` set in the EAS
   **production** environment as `REVENUECAT_API_KEY_IOS` (visibility
   `sensitive`). It previously held the literal string `to be updated`, which
   passes the `app.config.js` preflight (that only rejects empty,
   `YOUR_REVENUECAT_API_KEY`, or a wrong-store `goog_` prefix) but would have
   shipped a dead paywall.
4. ✅ Product `priceback_unlimited_monthly` (Subscription) created, attached to the
   existing `unlimited` entitlement.
5. ✅ Product `priceback_unlimited_annual` (Subscription) created, attached to the
   `unlimited` entitlement.

### Still to do in RevenueCat

- [ ] Create the 3 pack products under the **PriceBack (App Store)** app, all
      **Consumable**, **no entitlement**: `priceback_pack_starter` (Starter Pack),
      `priceback_pack_pro` (Pro Pack), `priceback_pack_max` (Max Pack).

      ⚠️ **These would not save on 2026-07-29.** The New Product form was filled
      correctly (identifier, display name, Consumable selected) but "Create
      Product" silently reset the form and no product appeared — repeatedly, via
      both coordinate and DOM-ref clicks. The two *Subscription*-type products
      created fine through the identical flow, so it is specific to the
      Consumable type on this newly-created app. Suspect the ongoing RevenueCat
      incident (see below); retry once that clears, or create them via the
      RevenueCat REST API instead.

- [ ] Add the 2 subscriptions (and, if the paywall sells them, the 3 packs) to the
      offering the app reads as `current`.

Notes:
- RevenueCat's **Import** button reports "No new products available to import"
  because the ASC products are still drafts; Apple's API only exposes them once
  approved. Create them by hand until then.
- New App Store products show **Store Status: "Could not check"** for the same
  reason. That is expected pre-approval, not a misconfiguration.
- There is an ongoing RevenueCat incident banner: *"Newly created apps error with
  'The key is not valid or is not compatible with the Bundle ID of your app'."*
  If the SDK rejects the key at runtime, suspect this before re-doing config.
- The existing `unlimited` entitlement already carries the 3 Android products, and
  a legacy `Priceback Pro` entitlement also exists (handled as a fallback in
  `purchaseService.js`).

---

## Quick resume checklist

- [x] Apple ↔ EAS: ASC API key created, uploaded to Expo, App ID + capabilities set
- [x] `eas.json` iOS build + submit config
- [x] Starter Pack: created, priced ($2.99 CAD), **availability fixed to Canada —
      it was empty**, both localizations corrected, review notes
- [x] Pro Pack: created, priced, Canada-only, both localizations, review notes
- [x] Max Pack: created, priced ($9.99 CAD), Canada-only, both localizations,
      review notes
- [x] Subscription group "PriceBack Unlimited" (id `22273191`) + en-CA/fr-CA
      group display names
- [x] Unlimited Monthly: created, $4.99 CAD, Canada, both localizations, notes
- [x] Unlimited Annual: created, $49.99 CAD 1-year-upfront, Canada, both
      localizations, notes
- [x] Apple In-App Purchase key (.p8) generated for RevenueCat
- [x] RevenueCat: iOS app created with the IAP key attached
- [x] RevenueCat: real iOS public SDK key set in EAS production env
- [ ] RevenueCat: annual entitlement attach + 3 pack products + offering  ← **resume here**
- [ ] EAS iOS production build (generates dist cert + provisioning profile)
- [ ] Screenshots for all 5 products, from the TestFlight build
- [ ] TestFlight purchase-flow smoke test

### Two open decisions

1. **Subscription level order.** In the group, Unlimited Monthly is level 1 and
   Unlimited Annual is level 2. Apple treats a lower level number as the higher
   tier, so switching Monthly → Annual currently counts as a *downgrade* and is
   deferred to the next renewal. If you'd rather that switch take effect
   immediately, swap them (group page → Subscriptions → Edit).
2. **`profile.versionLine`** in `src/services/i18n.js` still hardcodes `v2.6.0`
   while `app.json` is at `2.8.1`. Unrelated to iOS setup, but it's user-visible.

---

# UPDATE 2026-08-03 — everything here is DONE except the screenshots

Supersedes the status lines above. Re-verified against the live consoles, not
from memory.

## App Store Connect — all 5 products verified complete

| Product | ID | Price (CAD) | Availability | EN-CA | FR-CA | Review notes | Screenshot |
|---|---|---|---|---|---|---|---|
| Starter Pack | `priceback_pack_starter` | $2.99 | Canada only | ✅ | ✅ | ✅ | ❌ |
| Pro Pack | `priceback_pack_pro` | $4.99 | Canada only | ✅ | ✅ | ✅ | ❌ |
| Max Pack | `priceback_pack_max` | $9.99 | Canada only | ✅ | ✅ | ✅ | ❌ |
| Unlimited Monthly | `priceback_unlimited_monthly` | $4.99 | Canada only | ✅ | ✅ | ✅ | ❌ |
| Unlimited Annual | `priceback_unlimited_annual` | $49.99 (1-yr upfront) | Canada only | ✅ | ✅ | ✅ | ❌ |

The "Max Pack localizations not yet saved" warning in the table near the top of
this file was **stale** — it was already complete. Trust this section.

**Subscription level order — decided and applied.** Unlimited **Annual is now
level 1**, Monthly level 2, so Monthly → Annual is an immediate prorated upgrade
instead of a downgrade deferred to the next renewal. Open decision #1 above is
closed.

⚠️ **Reordering gotcha.** The Edit Subscription Level dialog is drag-and-drop and
will happily drop both subscriptions onto *the same* level, which reads as
"1, 1" and means a crossgrade — for differing durations that defers the switch,
i.e. the exact behaviour the swap was meant to remove. After dragging, confirm
the saved table shows **1** and **2**, not 1 and 1.

**Family Sharing stays OFF** on both subscriptions. The paywall used to advertise
"Family sharing (up to 6 users)" while the app implements none; the claim was
removed from the catalog rather than the capability enabled. See
`Operations/Bugs_Common_Fixes.md` #135.

## RevenueCat — the real iOS blocker, found and fixed

The 3 consumable pack products **do now exist** (`prod…` records created
2026-07-30) — the silent-form-reset failure recorded for 2026-07-29 cleared on
its own, so no REST-API workaround was needed. All five carry the correct type,
and the two subscriptions are attached to the `unlimited` entitlement. The packs
correctly have **no** entitlement.

**But every package in the `default` offering held only its Play Store product.**
The "PriceBack (App Store)" slot on all five read *No product*. Nothing in either
console flags this — the products look healthy on the Products page and the
offering shows "5 packages". The consequence is total: `getOfferings()` on iOS
would have returned packages with no `StoreProduct`, so the paywall renders with
fallback catalog prices and **buys nothing**.

Fixed 2026-08-03 — offering `ofrng41b525316c`, all five packages now carry both
stores:

| Package | Play product | App Store product |
|---|---|---|
| `$rc_annual` | `priceback_unlimited_annual:annual` | `priceback_unlimited_annual` |
| `$rc_monthly` | `priceback_unlimited_monthly:monthly` | `priceback_unlimited_monthly` |
| Starter Credit Pack | `priceback_pack_starter` | `priceback_pack_starter` |
| Pro Credit Pack | `priceback_pack_pro` | `priceback_pack_pro` |
| Max Credit Pack | `priceback_pack_max` | `priceback_pack_max` |

**Check this first** whenever a second platform is added to an existing
RevenueCat project: creating the products is only half the job, and the half that
is silently missing is the one the SDK actually reads.

Products still show **Store Status "Missing Metadata"**. Expected — Apple's API
only exposes them once they are approved, so it resolves itself at review.

## What is genuinely left

1. **Review screenshots for all 5 products** — needs a running build. One capture
   of the Buy Credits screen and one of the Unlimited paywall can be reused
   across every product.
2. **Upload a build** (`eas build -p ios --profile production`, then submit). The
   version page shows an empty Build section until one lands.
3. **Submit the IAPs together with the app version.** On a first submission,
   products left in "Ready to Submit" are not reviewed and the reviewer finds a
   paywall that sells nothing.
4. **TestFlight purchase smoke test** against a sandbox account.
