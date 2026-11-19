# Free week and promo codes: console setup (done 2026-11-19)

Configured by Claude in Chrome with Maxim present, 2026-11-19. Everything below was read back after saving.
Design: `Technical/Store_Spaces_v2_Design.md` (free week) and `Technical/Promo_Codes_Design.md` (codes).
Both ship in the next app version only; installed builds cannot reach any of it.

## Who gets the free week (Maxim, 2026-11-19)

> "the free trial should never be given to any existing user even unsubscribed before the launch of the new build
> because they are already having the 75 free credit as a trial"

Enforced by the server, not the stores (the stores only know subscription history): `lib/trialChoice.trialState`
treats the automatic signup credit grant as the trial taken. Measured on prod 2026-11-19: **563 accounts, 563 with
`trial_credits_granted_at`, 0 eligible**. An old build signing up before launch gets the grant automatically, so it
is excluded too; a deleted-and-recreated email is caught by `emailEverGrantedTrial`.

## Free week

| Store | Where | Value |
|---|---|---|
| Google Play | `priceback_unlimited_monthly` → base plan `monthly` → offer **`free-week`** | **Active.** Free trial 7 days. Eligibility *New customer acquisition → Never had any subscription* (in this app). Runs indefinitely. Tag `rc-ignore-offer`. **Not** backwards compatible (Play set the flag automatically on the first offer; removed: "Stop using for deprecated billing methods"). |
| App Store Connect | new product **`priceback_unlimited_monthly_trial`** (Apple ID 6836895117), group *PriceBack Unlimited*, 1 month | CA$4.99 / E£199.99 (= the monthly). Available Canada + Egypt. EN-CA "Unlimited Monthly", FR-CA "Illimité mensuel" (same as the monthly). Introductory offer **Free for the first week**, Canada + Egypt, Nov 19 2026 → no end date. Review notes written. **Owed: the review screenshot** (screen H from the new build). `priceback_unlimited_monthly` has **no** intro offer (checked). |
| RevenueCat | App Store app → product `priceback_unlimited_monthly_trial` | Attached to entitlement **`unlimited`**. In **no offering** on purpose: the new build fetches it by id (`purchaseService` free-week lookup), and installed builds' paywalls read offerings only. |

Play "Never had any subscription" instead of the brief's "Never had this subscription": someone who had the annual
cannot also take a free week (one trial per account).

## Promo codes

Codes typed in the app: `FAMILY` 5%, `FRIENDS10` 10%, `BLACK` 20%, first payment only.

### Google Play — 6 offers, all Active

| Subscription / base plan | Offer | Phase | Canada | Egypt |
|---|---|---|---|---|
| monthly / `monthly` | `promo-5` | Single payment, 1 month, −5% | 4.99 → 4.74 | 199.99 → 189.99 |
| monthly / `monthly` | `promo-10` | Single payment, 1 month, −10% | → 4.49 | → 179.99 |
| monthly / `monthly` | `promo-20` | Single payment, 1 month, −20% | → 3.99 | → 159.99 |
| annual / `annual` | `promo-5` | Single payment, 1 year, −5% | 49.99 → 47.49 | 1,949.99 → 1,852.49 |
| annual / `annual` | `promo-10` | Single payment, 1 year, −10% | → 44.99 | → 1,754.99 |
| annual / `annual` | `promo-20` | Single payment, 1 year, −20% | → 39.99 | → 1,559.99 |

All: eligibility **Developer-determined** (the app decides; our server validates the code), runs indefinitely
(the server ends a code), tags `rc-ignore-offer` + `promo`, all 175 base-plan regions. The Egypt column is what Play
computed; **promo codes are Canada only** (Maxim, 2026-11-19), so the server must refuse a code for an account that
is not on the Canadian store, and only for an account that never had a subscription. Play needs no change for
either: nothing reaches a developer-determined offer without the server.

### App Store — Offer Codes (6 offers, 6 custom codes)

Apple's promotional offers are only for "existing and previously subscribed customers", so new shoppers go through
**Offer Codes**. A custom code is unique across the app, so the annual carries its own names; the app maps what the
shopper typed to the right Apple code and opens
`https://apps.apple.com/redeem?ctx=offercodes&id=6795860374&code=<APPLE CODE>`.

| Typed | Product | Apple custom code | Apple offer (reference name) | Offer | Canada |
|---|---|---|---|---|---|
| FAMILY | monthly | `FAMILY` | Promo 5% first month new only CA (FAMILY) | Pay up front, 1 month | 4.69 |
| FRIENDS10 | monthly | `FRIENDS10` | Promo 10% first month new only CA (FRIENDS10) | Pay up front, 1 month | 4.49 |
| BLACK | monthly | `BLACK` | Promo 20% first month new only (BLACK) | Pay up front, 1 month | 3.99 |
| FAMILY | annual | `FAMILYYEAR` | Promo 5% first year new only CA (FAMILYYEAR) | Pay up front, 1 year | 46.99 |
| FRIENDS10 | annual | `FRIENDS10YEAR` | Promo 10% first year new only CA (FRIENDS10YEAR) | Pay up front, 1 year | 44.99 |
| BLACK | annual | `BLACKYEAR` | Promo 20% first year new only CA (BLACKYEAR) | Pay up front, 1 year | 39.99 |

All: eligibility **New subscribers only**, **Canada only**, auto-renew at full price, redemption limit 25,000,
**expires Jan 1, 2027** (Apple expires at 12:00 a.m. PT on the date, so Dec 31 stays valid). Apple price points are
fixed, so each price is the nearest one that gives at least the promised discount (FAMILY monthly is 6%).

**Redone 2026-11-19 (second pass).** The first set was New + Expired subscribers, Canada + Egypt. Maxim:
*"expired or current subscribers cant use the code, only new subscribers"*, then *"exclude egypt from all the
process"*. An Apple offer cannot be edited (eligibility and countries are read-only once saved), so every offer was
deactivated and recreated; the custom code names were reused (a deactivated offer frees its code), but reference
names must stay unique, hence the "CA" / "new only" suffixes. The 9 deactivated offers stay listed under *Inactive
Offers*; ignore them.

**Ending a code early:** set `ends_at` on the admin desk (the app stops offering it) **and** deactivate the Apple
offer (Offer Codes → Deactivate; an Apple expiry date cannot be edited). Play offers can stay active: they are
developer-determined, so nothing reaches them without our server.

## Gotchas found doing this

- Play marks the first offer on a base plan **backwards compatible** by itself. A backwards-compatible offer is what
  the deprecated `querySkuDetailsAsync` returns by default. Remove it on any offer that must stay hidden.
- Play: a one-time product's per-country price cannot be edited from the purchase-option page by automation (no row
  selection; *Set prices* stays disabled). Pack prices were left as they are (Maxim, 2026-11-19).
- ASC native `<select>`s ignore synthetic clicks; set the value with the native setter + `change` event.
- ASC custom-code price search only lists common points until **See Additional Prices** is clicked.
- ASC offer codes cannot be edited after saving (the countries popover is read-only). Changing eligibility or
  countries means Deactivate (irreversible) and recreate. A custom code name is free again once its offer is
  deactivated; an offer reference name is not.
