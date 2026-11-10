# Rewarded ads — earn free credits (Pay-as-you-go only)

**Status:** built on `feat/ads-rewarded-credits` (app repo), 2026-11-09. Rides the
**lab lane** like every ads feature: production binaries still compile no ads SDK.
Server side ships dark (`AD_REWARD_ENABLED = false`, `ADMOB_REWARDED_AD_UNITS = ""`).
**Asked (Maxim, 2026-11-09):** *"start integrating the ads in the app as a earn free
credit option based on ads cost and choose the places where we can add some ads in
small blanks spaces for Pay as you go only plan, subscribers should never get ads."*

Account setup, ad units, SSV callback URL, store declarations:
`Publishing-Compliance/AdMob_Setup_And_Store_Declarations.md` → Phase B2.

---

## 1. The rule: subscribers never get ads

Two independent proofs, both required, both fail closed
(`src/services/adsService.js → isAdEligibleViewer`):

| Proof | Source | Why it alone is not enough |
| --- | --- | --- |
| `premium.active === false` | local entitlement cache | Reads "free" on a fresh install before the first restore — a subscriber who reinstalls would see ads |
| `ads.payg === true` | **server**, `/api/me` (new, additive) | Lags a purchase by one reconcile — a shopper who just subscribed is still "payg" server-side for a moment |

Plus the build lane (`adsEnabled && labEnabled`) and the remote kill switch
(`ADS_ENABLED`). Server-side, Pay-as-you-go = `subscriptionTier` is empty or
`free` (a store plan, a partner grant and a guarantee year all set a tier); the
App Review reviewer account is never Pay-as-you-go.

The hooks (`useAdsVisible`, `useRewardedOffer`) start hidden and **clear on blur**,
so a mounted-but-blurred screen never shows a stale "yes" on refocus (the
Home → paywall → back path).

## 2. How much a view pays — derived from the ad's revenue

```
credits per view = ⌊ AD_REWARD_ECPM_USD ÷ 1000 × AD_REWARD_REVENUE_SHARE ÷ CREDIT_DOLLAR_VALUE ⌋
```

- `AD_REWARD_ECPM_USD` (default **15**) — what AdMob pays per 1,000 rewarded
  impressions. Update it from the AdMob report once real numbers exist.
- `AD_REWARD_REVENUE_SHARE` (default **0.7**, clamped to ≤ 1) — the part of the
  revenue handed back as credits at face value.
- `CREDIT_DOLLAR_VALUE` = $0.01 (`shared/pricing.config.js`).

Defaults: $15 × 0.7 / 1000 = $0.0105 → **1 credit = 1 receipt scan per ad**.
Rounding down means a view never pays more than it earned; if the eCPM drops so
the result is 0, the offer **disappears** rather than running at a loss. Credits
sell at $0.009–$0.012 each in packs, so at face value we keep ~30% of the ad
revenue plus whatever the shopper later spends.

`AD_REWARD_DAILY_CAP` (default **5**) — most grants per shopper per rolling 24 h.
Bounds the credits given away and the invalid-traffic exposure.

## 3. Flow — the phone never grants

```
App                         Backend                          Google AdMob
 │ GET /api/ads/reward ───▶ │ payg? cap left? → token          │
 │ ◀── {credits, remaining, token}                             │
 │ RewardedAd(customData = token) ───────────────────────────▶ │ shows the ad
 │                          │ ◀── GET /api/ads/ssv?…&signature=…&key_id=…  (signed)
 │                          │ verify ECDSA sig (Google keys)    │
 │                          │ ad_unit ∈ ADMOB_REWARDED_AD_UNITS │
 │                          │ token → account; once per transaction_id; cap
 │                          │ +credits (ledger type ad_reward)  │
 │ poll /api/me/credits until the balance rises                │
```

- **Signature** (`backend/lib/admobSsv.js`): content = raw query up to
  `&signature=`; DER ECDSA/SHA-256, web-safe base64; keys from
  `gstatic.com/admob/reward/verifier-keys.json`, cached 24 h, one forced refresh
  on an unknown `key_id`, last good keys kept on a fetch failure.
- **Ad unit check** — 🔴 load-bearing: Google signs every publisher's callbacks
  with the same keys.
- **Token** (`backend/lib/adRewards.js`): AES-256-GCM of `{sub, exp}` under a key
  derived from `AD_REWARD_TOKEN_SECRET` (fallback `SESSION_TOKEN_SECRET`), 2 h TTL.
  The account id never reaches Google in the clear; a callback can only credit an
  account that asked for a token. No secret → feature off.
- **Grant** (`creditsRepo.grantAdRewardOnce`): per-user advisory lock; idempotent
  on ledger ref `admob:<transaction_id>`; cap counted on the same transaction, so
  racing callbacks cannot overrun it (tested with 5 concurrent).
- **Responses:** 200 to every verified call, granted or not (duplicate, capped,
  foreign unit, bad token — none improve on retry, and AdMob's *Verify URL* must
  pass); 400 unverifiable; 503 keys unavailable / DB error (Google retries; the
  transaction id stops a double pay).

## 4. Where it shows

**Reward offer** (`src/components/WatchAdForCredits.js`, renders `null` unless offered):
- Profile → "Grow your balance": full-width tile under the scan-a-tag / invite tiles.
- Plan & credits → "Earn free credits" group (`CreditsExtras`).
- Not on the paywall, on purpose: it would compete with the packs at the moment of
  purchase intent.

**Banners** — anchored adaptive, Pay-as-you-go only, in end-of-content blank space,
always spaced from tappable controls (AdMob accidental-click policy):

| Slot | Screen | Since |
| --- | --- | --- |
| `home` | Home, below the content | #290 |
| `scan` | Scan / Price-tag / Barcode intro footers, Price translator | #290 |
| `barcodeEmpty` | Barcode not-found state | #290 |
| `receipts` | Receipts list footers | #290 |
| `creditHistory` | Credit history, after the ledger | 2026-11-09 |
| `help` | FAQ (32 pt below the email button), Tutorials (below the list) | 2026-11-09 |

Deliberately **no** ads on: the paywall, claim assistant, receipt detail / drop
cards (money decisions), onboarding, permission priming, notification settings,
Plan & credits, admin screens. One banner per screen at most.

The banner's "Remove ads" link now opens the paywall through
`paywallNav.openPaywall` (pushed), so closing returns to the screen it came from.

## 5. Old app builds (backend compat)

- `/api/me` `ads` gains `payg` and `reward`; `enabled` is unchanged in type and
  meaning. Builds before this release read only `enabled`.
- `GET /api/ads/reward` and `GET /api/ads/ssv` are new routes; no shipped build
  calls them.
- New ledger type `ad_reward`: older builds' credit history maps an unknown type
  to the generic label (`creditLedger.js` fallback), never a raw code.
- No migration: the lookup row is seeded by `db/seed.js` (`onConflictDoNothing`).

## 6. Switches (prod `app_config`, category `ads`)

| Key | Default | Meaning |
| --- | --- | --- |
| `ADS_ENABLED` | false | master switch (banners + rewarded) |
| `AD_REWARD_ENABLED` | false | rewarded offer + callback grants |
| `AD_REWARD_ECPM_USD` | 15 | eCPM used for the payout |
| `AD_REWARD_REVENUE_SHARE` | 0.7 | share handed back |
| `AD_REWARD_DAILY_CAP` | 5 | grants per rolling 24 h |
| `ADMOB_REWARDED_AD_UNITS` | "" | our rewarded units — empty = off |

Env: `AD_REWARD_TOKEN_SECRET` (optional; falls back to `SESSION_TOKEN_SECRET`).
EAS production: `ADMOB_REWARDED_UNIT_IOS` / `_ANDROID`.

## 7. Cost

No scheduled job. Per rewarded view: 1 `GET /api/ads/reward`, 1 signed callback
(1 transaction, 3 small queries), ~5–10 `GET /api/me/credits` polls over ≤ 20 s.
Google's key file: ~1 fetch/day/instance. Negligible egress.

## 8. Not done yet / owed

- AdMob account, units, SSV URL, `app-ads.txt`, store forms (runbook Phase A–D).
- The SDK has still never been compiled by EAS on 16.0.0 — `eas build --profile lab`
  answers it (budgeted build; Maxim's call).
- No UMP consent: safe only while availability is Canada + Egypt.
