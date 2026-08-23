# AdMob Setup and Store Declarations

**Status:** code merged and shipping **dark** (ads render nothing until enabled).
**Owner:** Maxim Lucas · **Date:** 2026-08-23 · **App version:** targeting 2.9.0

This is the runbook for the parts of the ads rollout that **cannot be done from
the repo**: creating the AdMob account, registering the apps, minting the ad
units, publishing `app-ads.txt`, and answering the two stores' privacy forms.
Work through it top to bottom — several steps block later ones, and two have
multi-day latency.

---

## 0. Read this first — expectations and the one irreversible risk

**Revenue at current scale will be small.** Store availability is Canada +
Egypt only and the install base is tiny (the Play listing was a paid app until
2026-08-17). Banner ads at this volume realistically earn **cents to low dollars
a month**. Everything below is a fixed compliance cost paid regardless of
volume. It is worth doing as groundwork; it is not a near-term income change.

**The one thing that cannot be undone:** serving a **real ad unit from a
non-production build**. Every developer device, internal tester and CI emulator
then generates impressions an advertiser paid for that no human saw. AdMob
calls this *invalid traffic*, and enforcement is not a warning email — it is ad
serving disabled or the **publisher account terminated, for the whole app,
retroactively, with earnings clawed back**.

The repo is built so this cannot happen by accident:

- `config/profiles/common.js` commits **Google's test unit ids**, never real ones.
- Real ids exist only as EAS env vars in the **production** environment.
- `app.config.js` → `assertAdsConfigIsShippable()` makes a real unit id in any
  non-production build a **fatal build error with no override**.

Do not work around those guards. If a build fails with that error, the
configuration is wrong, not the check.

---

## Phase A — AdMob account (start now; step A3 has multi-day latency)

1. **Create / confirm the AdMob account** at <https://apps.admob.com> using the
   **same Google identity that owns the Play Console listing** for
   `com.priceback`. If an AdSense account already exists on that identity,
   AdMob attaches to it — you cannot hold two.
2. **Payments profile** — AdMob → Payments → set up. Choose individual vs
   business to match the entity that owns the app and holds the bank account
   (Prosoft Inc, if that is the intended payee).
3. **Tax info (Canada)** — AdMob → Payments → Settings → Manage tax info. As a
   Canadian publisher paid by Google you complete the **US tax form**
   (`W-8BEN` individual / `W-8BEN-E` entity) claiming the Canada–US treaty
   rate. ⏳ **Google's review of tax forms takes days.** Start it before you
   need to be paid, not after. Confirm GST/HST handling if registered.
4. Record the **publisher ID** (`pub-XXXXXXXXXXXXXXXX`) — everything downstream
   keys off it.

## Phase B — Register apps and mint ad units (blocks the build)

5. **Android app** — AdMob → Apps → Add app → Android → *"Yes, it's listed on a
   supported app store"* → search `com.priceback` → link the Play listing.
   Record the **Android app ID** (`ca-app-pub-…~…`).
6. **iOS app** — same flow, App Store, bundle `com.priceback`, ASC app id
   `6795860374`. Record the **iOS app ID**.
   > Link to the live store listings rather than "not listed yet". That is what
   > unlocks store-verified reporting and app-ads.txt matching later.
7. **Create one Banner ad unit per platform.** Format **Banner** (adaptive
   sizing is a client-side request parameter, not a separate format). Name them
   explicitly, e.g. `PriceBack Android — Anchored Adaptive Banner`.
   ⚠️ **Ad format cannot be changed after creation.** Record both **unit IDs**
   (`ca-app-pub-…/…`).

8. **Put the two APP ids into the repo** — `app.json`, the
   `react-native-google-mobile-ads` plugin entry, replacing the
   `ca-app-pub-0000000000000000~0000000000` placeholders:

   ```jsonc
   ["react-native-google-mobile-ads", {
     "androidAppId": "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY",
     "iosAppId":     "ca-app-pub-XXXXXXXXXXXXXXXX~ZZZZZZZZZZ",
     ...
   }]
   ```
   App ids are **not secrets** — they ship in every binary's manifest. They
   belong in `app.json` because the config plugin writes them into the native
   manifest/plist at prebuild, where `extra` cannot reach.

9. **Put the two UNIT ids into EAS production only** — never into the repo:

   ```bash
   eas env:create --environment production --name ADMOB_BANNER_UNIT_IOS \
     --value ca-app-pub-XXXXXXXXXXXXXXXX/IIIIIIIIII --visibility plaintext
   eas env:create --environment production --name ADMOB_BANNER_UNIT_ANDROID \
     --value ca-app-pub-XXXXXXXXXXXXXXXX/AAAAAAAAAA --visibility plaintext
   ```
   `plaintext` is correct — unit ids are extractable from any binary, and
   marking them sensitive only makes debugging harder.

   > **Do not set these in `development`, `preview`, `dev` or `device`.** The
   > build will fail on purpose if you do — see §0.

## Phase C — app-ads.txt (blocks full demand; ~24h+ crawl latency)

10. AdMob → Apps → **app-ads.txt** shows the exact line to publish. Add it to
    the **website repo** (`priceback.ca` is a separate repo) so it is served at
    **`https://priceback.ca/app-ads.txt`** as `text/plain`, HTTP 200, **no
    redirect**:

    ```text
    google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
    ```
11. **Both store listings' "Developer website" field must point at
    `priceback.ca`** — that is the only way crawlers find the file. Fix it in
    Play Console and App Store Connect if it points elsewhere.
12. Wait for AdMob to report the file as **"Found"** (24h to a few days).
    Until then expect materially reduced fill — this is the usual reason a
    correctly wired banner shows nothing on day one.

## Phase D — Store declarations (before submitting the ads build)

These are **mandatory** and Play will block the release without D2/D3.

### Google Play Console

13. **App content → Ads** → "Does your app contain ads?" → **Yes**. This adds
    the *Contains ads* badge to the listing.
14. **App content → Data safety** — the change the restored `AD_ID` permission
    forces:
    - **Device or other IDs** → Collected **Yes**, Shared **Yes**, purpose
      **Advertising or marketing**, not ephemeral.
    - **App activity → App interactions** → add **Advertising or marketing** as
      a purpose.
    - Re-confirm the *encrypted in transit* and deletion-request answers.
    > Cross-check against `Publishing-Compliance/Play_Data_Safety_Answers.md`
    > and update that file in the same pass so the two do not drift.
15. **App content → Advertising ID declaration** → declare the permission and
    select **Advertising or marketing**. ⚠️ Play **blocks the release** if
    `com.google.android.gms.permission.AD_ID` is in the manifest without this.
    This is the specific gate that the config-plugin change opens.

### App Store Connect

16. **App Privacy** → add:
    - **Identifiers → Device ID** — Used for Tracking ✔, linked to identity,
      purpose *Third-Party Advertising*.
    - **Usage Data → Advertising Data** — Used for Tracking ✔, same purpose.
    - Answer **Yes** to *"Does this app use data for tracking?"*
    > These must match `app.json`'s `ios.privacyManifests` exactly — Apple
    > cross-checks the declaration against the shipped manifest.
17. **Version → App Review notes** — state plainly:
    > The free tier shows AdMob banner ads. App Tracking Transparency is
    > requested on the first ad-eligible screen (Home, below the tracked
    > products list, or any scan screen) before any IDFA access. Subscribers
    > see no ads and are never shown the ATT prompt.

    Reviewers reject ATT implementations they cannot reproduce — give them the
    exact path.
18. Re-check the **age rating** answers on both stores now that ads are present.
    The app requests `MaxAdContentRating.PG`.

## Phase E — Ship dark, then light

19. **Release with ads off.** The build-time switch is `true` on the production
    EAS profile, but the **backend `ADS_ENABLED` row defaults to `false`**, so
    no banner renders. Ship and let it reach users first.
20. **Verify on real hardware** from a `device`-profile **release** build (never
    a dev-client build):
    - free user + flag on → banner in all six slots, showing a **Test Ad**;
    - subscriber → **no banner and no gap**;
    - ATT prompt appears once, at the right moment, free users only;
    - R8 stripped nothing (this failure is release-only and silent — the banner
      simply never fills).
21. **Flip the remote flag**: set `ADS_ENABLED = true` in the backend
    `app_config` table. Clients pick it up on their next `/api/me` reconcile —
    minutes, no release. **This is also the kill switch**; setting it back to
    `false` removes every banner just as fast.
22. Watch AdMob fill rate and Sentry for a few days. Only then set the real unit
    ids (step 9) and cut the release that carries them.

---

## Guardrails to preserve

| Guardrail | Where | Why it exists |
| --- | --- | --- |
| Real unit id outside production → fatal build | `app.config.js` | Invalid traffic → account termination. **No override by design.** |
| Test unit in ads-enabled production → fatal | `app.config.js` | Fills 100%, earns $0, invisible until a payout that isn't. Override: `ALLOW_TEST_ADS_IN_PRODUCTION=1`. |
| Publisher-id mismatch → fatal | `app.config.js` | A unit from another account never fills; the only symptom is a blank space. |
| `AD_ID` must stay unstripped | `__tests__/withAndroidPermissionCleanup.test.js` | Re-stripping zeroes the advertising ID on API 33+ and halves revenue silently. |
| Committed defaults are test ids + ads off | `__tests__/adsConfig.test.js` | Keeps the dark ship and the invalid-traffic guard honest. |

### ⚠️ EEA / UK guardrail — do not widen availability without reading this

There is **no UMP consent form** in the app. That is safe *only* because store
availability is **Canada + Egypt**, so no EEA/UK users exist. Google enforces
its EU user-consent policy **by user geography, not by your intent**.

**Adding any EEA/UK country to store availability without first wiring
`AdsConsent` (requestInfoUpdate → loadAndShowConsentFormIfRequired, before
`mobileAds().initialize()`) would serve ads non-compliantly.** The SDK for this
is already bundled with `react-native-google-mobile-ads`; only the code and a
translated privacy-options entry in Profile are missing.

## Still owed (not blocking the dark ship)

- [ ] **Privacy policy** on `priceback.ca` (separate repo), EN + FR: disclose
      advertising, the advertising identifier, and Google as a recipient.
      **This must land before the store declarations in Phase D.**
- [ ] `NSPrivacyTrackingDomains` in `app.json` currently holds a **documented
      placeholder list**. Replace it from the SDK's own manifest after an iOS
      prebuild: `find ios/Pods -name PrivacyInfo.xcprivacy`, then take the
      union declared by `GoogleMobileAds` and `UserMessagingPlatform`.
      ⚠️ When ATT is denied, iOS *fails* requests to listed domains — never
      list a domain the app itself needs.
- [ ] `skAdNetworkItems` in `app.json` holds **13** of Google's 50+ ids.
      Refresh from
      <https://developers.google.com/admob/ios/privacy/strategies> before the
      store build. Missing ids cost attribution coverage only, never runtime
      behaviour.
- [ ] **Unverified:** that `react-native-google-mobile-ads@16.5.0` builds
      cleanly under Expo SDK 55 prebuild. Gate this with `npx expo prebuild
      --clean` plus a `preview` EAS build on both platforms **before** the
      production build. Fallback ladder: 16.4.0 → 16.3.4; do not go below
      16.3.x, where the New-Architecture/bridgeless fixes landed.
