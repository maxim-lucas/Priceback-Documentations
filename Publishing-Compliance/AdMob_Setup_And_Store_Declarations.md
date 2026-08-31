# AdMob Setup and Store Declarations

**Status:** code merged and **ABSENT from production builds** (not merely inert —
the lab lane keeps the SDK out of the binary entirely). Buildable and testable
on `eas build --profile lab` as of 2026-08-31.
**Owner:** Maxim Lucas · **Date:** 2026-08-23, last revised 2026-08-31
**App version:** targeting 2.9.0

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

> ⚠️ **Rewritten 2026-08-31.** Step 19 used to read *"the build-time switch is
> `true` on the production EAS profile"*. That was true when this runbook was
> written and became actively dangerous: a committed `ADS_ENABLED: "true"` on
> the production profile is **Bugs #217**, which made every production build
> impossible for two days (`assertAdsConfigIsShippable` refused at EAS's "Read
> app config" phase, both platforms, 30 s in, reported only as "Unknown
> error"). It was removed in PR #293. **Do not put it back** until a real AdMob
> app id is in `app.json`; `adsConfig.test.js` flips on its own the moment one
> is, and starts requiring the flag instead.

### Where the switches actually live now

Ads are gated in **four** places, and all four must be true before a banner
mounts. Phase E is about the last two.

| gate | where | today |
| --- | --- | --- |
| the lab lane — is the SDK in the binary at all? | `config/profiles/common.js` → `labEnabled`, plus `expo.autolinking.exclude` in `package.json` | **off** in production; on for `eas build --profile lab` |
| build-time ads switch | `config/profiles/common.js` → `adsEnabled` | **false**; set to `"true"` only on the `lab` EAS profile |
| remote kill switch | backend `app_config` → `ADS_ENABLED`, read via `/api/me` | **false** on both environments |
| subscriber check | `src/services/adsService.js` | fails closed — "unknown" means hidden |

A production build today compiles **no ads code at all**, so "ship dark" is no
longer the accurate description of it: the code is *absent*, not inert. That
distinction cost four Android builds (Bugs #222/#224) and is the reason the lane
exists.

19. **Release with ads off.** Nothing to do: `adsEnabled` is `false` in the
    committed defaults and the production profile sets no `ADS_ENABLED`. Ship
    and let the release reach users first.

    Moving ads OFF the lab lane — so the SDK ships in production binaries — is a
    separate, deliberate change: delete the `expo.autolinking.exclude` entry and
    `ADS_ONLY_PLUGINS` in `app.config.js` together, in one PR, and only once
    step 8's real app ids are in place. Splitting those two is what hard-fails
    the Android manifest merger.

20. **Verify on real hardware** from a **`lab`-profile** release build — that is
    the only profile that links the SDK, so it is the only build ads can be
    tested on. Never a dev-client build:
    - free user + flag on → banner in all six slots, showing a **Test Ad**;
    - subscriber → **no banner and no gap**;
    - ATT prompt appears once, at the right moment, free users only;
    - R8 stripped nothing (this failure is release-only and silent — the banner
      simply never fills).
21. **Flip the remote flag**: set `ADS_ENABLED = true` in the backend
    `app_config` table. Clients pick it up on their next `/api/me` reconcile —
    minutes, no release. **This is also the kill switch**; setting it back to
    `false` removes every banner just as fast.

    To test a `lab` build before any of that, flip the row on the
    **development** project (`gnedluuylimjwdmtvswl`) only — that is the backend
    the `lab` profile points at. Prod's row stays `false`.
22. Watch AdMob fill rate and Sentry for a few days. Only then set the real unit
    ids (step 9) and cut the release that carries them.

---

## Where the repo stands (2026-08-31)

Everything that can be done without an AdMob account is done, on the
`development` branch (`feat/ads-buildable-on-lab-lane`). Phases A–D are yours.

**Done:**

- The Android build deadlock is broken. `react-native-google-mobile-ads` is
  pinned to **16.0.0**, the last release shipping play-services-ads 24.6.0
  natively — Kotlin metadata 2.1.0, which is what React Native 0.83.6's pinned
  Kotlin 2.1.20 can read. `plugins/withAdsSdkKotlinPin.js` is deleted: it forced
  24.6.0 under 16.5.0, whose own Kotlin calls `AgeRestrictedTreatment`, a 25.x
  API — trading a metadata error for an unresolved-reference one (Bugs #222).
- `scripts/laneAutolinking.js` makes `expo.autolinking.exclude` lane-aware. It
  only ever relaxes, and only on the lane, so a missed run costs a developer a
  banner and can never leak the SDK into production. Measured both ways:
  lane off → 14 modules, ads absent; lane on → 15, ads present.
- `app.json` carries Google's **sample app ids** rather than the all-zero
  placeholders, so the publisher-agreement check passes on the lab lane and the
  SDK will initialize. A new guard makes an ads-enabled *production* build
  carrying a sample app id fatal — the sample ids are valid, so the crash that
  used to backstop this is gone.
- `ADS_ENABLED: "true"` on the **`lab` profile only**.

**Not verified — no EAS build has been run.** Whether the SDK compiles on
Android under 16.0.0 is exactly what `eas build --profile lab -p android`
answers, and nothing short of it does. A tag and a green test run prove a commit
was cut, never that a binary was produced.

**Still blocked on you:** Phases A–C (account, tax forms, app ids, unit ids,
`app-ads.txt`) and Phase D (the two stores' declarations). Do **not** flip
Play's Advertising ID declaration or Data Safety, or ASC's App Privacy, until
ads actually ship to production — a declaration ahead of the binary is the same
class of mistake as #301, pointing the other way.

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
