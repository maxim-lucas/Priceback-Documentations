# Ads revenue concept — Pay-as-you-go only, Deals first

**Asked by Maxim, 2026-11-24:** *"plan also a full ads style concept to maximize the revenue of the app specially in
the deals section (pay as you go only) all subscribers cant see any ads anywhere. implement the mechanism also … if
AdMob fail the design doesnt show any gabs … before ad activation it should remain as of today."*

Status: **mechanism shipped OFF** (app, branch into `main-test-features`). Nothing changes on screen until the build
switch, the server switch and the AdMob units are turned on — that is Maxim's call (CLAUDE.md, ground rules §6: a
behaviour is switched on only once measured).

---

## 1. The rules that do not move

| Rule | Where it is enforced |
|---|---|
| A subscriber never sees an ad, anywhere, not for one frame. | `src/services/adsService.js` (`shouldShowAds`) fails closed: build switch `extra.adsEnabled` + lab lane, server `ADS_ENABLED`, a **resolved** free plan (`premium.active === false`), the server's Pay-as-you-go verdict `ads.payg` from `/api/me`, a configured unit id. The hook starts `false` and resets on blur. |
| Pay-as-you-go only. A trial or a plan in force is not Pay-as-you-go. | `ads.payg` is the server's word (subscriberAccess / `isCreditExempt`), never the phone's cache. |
| Before activation the app is exactly as today. | Screens mount **no ad component** while the gate is closed (`adsOn ? <AdBanner/> : null`), and the Deals list is **not interleaved** (`interleaveAds` only runs once the gate opened). Pinned by `__tests__/dealsAds.test.js`. |
| A failed / no-fill / slow ad leaves no gap. | `components/AdBanner.js` invariant 3: until `onAdLoaded`, the slot is a bare unstyled view around the SDK view (zero height): no card, no padding, no label, none of the caller's margins. A failure renders `null`. Pinned by `__tests__/AdBanner.test.js` ("no gap before the ad loads"). |
| Ads are labelled and never confusable with content. | The "Ad" label + "Remove ads" link above the creative, drawn only with a loaded creative. |
| No accidental-click surfaces. | "Remove ads" above the creative, never beside or below it; ads never as the first or last row of a list, never two in a row. |

## 2. Placements (one table: `src/constants/adPlacements.js`)

| Slot | Screen | Format | Rule | Why |
|---|---|---|---|---|
| `dealsFeed` | Deals list | **Medium rectangle 300×250** (`mrec`), inside the white list card | first after 4 deals, then every 8, at most 4 per list; never first/last | Deals is the most-viewed browse surface of a free shopper and the one with commercial intent; MREC in-feed has the best eCPM of the banner formats |
| `dealsFooter` | Deals list end | Anchored adaptive banner | only when the list has deals | end-of-content, zero intrusion |
| `warehousePricesFooter` | Warehouse prices end | Anchored adaptive banner | — | second browse surface |
| existing | Home, Purchases, scan intros, barcode not found, credit history, help | Anchored adaptive banner | unchanged (`AdBanner slot=…`) | end-of-content spaces (#558) |
| rewarded | Me · Earn free credits | Rewarded video | daily cap from `/api/me` `ads.reward` | the shopper chooses it; pays in credits (#558, `Technical/Rewarded_Ads_Earn_Credits.md`) |

Changing a rate (`firstAfter`, `every`, `max`) is one line in the table; every screen reads it.

## 3. Revenue levers, in order (next phases, not built)

1. **Turn on what is built** (Deals feed + footers + existing banners + rewarded), measure fill and eCPM per slot for
   two weeks (`AdMob → Reports by ad unit`; one ad unit per slot so the report separates them).
2. **Native ads in the Deals feed** (`NativeAd` / `NativeAdView`, react-native-google-mobile-ads ≥ 14): a "Sponsored"
   card drawn like a deal row. Typically 1.5–3× a banner's CTR. Same slot, same rule, same gap-free contract.
3. **Interstitial at a natural break** — never on open, never during a scan: e.g. after the 4th deal opened in one
   session, at most one per 10 minutes and two per day. Off by default, behind its own server switch.
4. **Mediation** (AppLovin / Meta Audience Network through AdMob mediation) once volume justifies it: raises fill in
   Canada at low volume.
5. **Remote tuning**: move the placement table to `/api/me` (`ads.placements`) so rates change without a release;
   the phone table stays the fallback.

## 4. Turning it on (checklist)

0. **Prerequisite — the SDK is not in store builds today (release audit 2026-11-24).** `react-native-google-mobile-ads`
   links only in the lab lane (`labEnabled`), and `app.config.js` `assertLabIsOffInProduction` refuses a production
   build with it, with no override (#293 / #295: play-services-ads Kotlin metadata vs Expo 55's Kotlin). Until the ads
   SDK is moved out of the lab lane onto its own switch (its config plugins + autolinking, a Kotlin-compatible
   play-services-ads), **no banner and no watch-an-ad tile can appear in a Play / App Store build**, whatever the
   switches below say. That move is its own PR, proven by a production EAS build.

1. AdMob: one banner unit per slot (`dealsFeed` MREC, `dealsFooter`, `warehousePricesFooter`), app-ads.txt crawled.
2. Build: `extra.adsEnabled = true`, lab lane on, unit ids in `extra.admobBannerUnitId` (today one id serves every
   slot; per-slot ids are a follow-up in `getBannerUnitId(slot)`).
3. Server: `ADS_ENABLED` on; confirm `/api/me` sends `ads.payg` for a Pay-as-you-go test account and not for a
   subscriber, a trial or an admin.
4. Device check as a subscriber (fresh install and an existing one): no ad anywhere — `/health` → `subscriberAccess`
   stays clean.
5. Store declarations: `Publishing-Compliance/AdMob_Setup_And_Store_Declarations.md` (data safety, ATT copy).

## 5. Tests that pin it

- `__tests__/dealsAds.test.js` — the feed rule (never first/last/consecutive, max), gate closed = list unchanged and no
  ad mounted, gate open = MREC rows + footer, a failed ad leaves the deals intact, no deals = no footer.
- `__tests__/AdBanner.test.js` — no card/label/margins before load, card + label after load without remounting, MREC
  size, failure after load collapses.
- `__tests__/adsService.test.js` — the gate itself (subscriber, unknown plan, server switch, Pay-as-you-go word).
