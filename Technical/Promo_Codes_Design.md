# Promo codes — FAMILY, FRIENDS10, BLACK (design)

**Status:** built 2026-11-19 on `feat/store-spaces-v2-main` (PR #602, held for the Store Spaces v2 build). Old
builds never see a promo code. Production needs migration **0057** applied by hand before the backend deploys
(Maxim's go). See *Built* below.

## What Maxim asked (2026-11-19)

> "i also need to create codes to give users 5% or 10% on any product for the coming season (black friday), codes
> are Family 5%, Black (20%) and create a 3rd code for the 10%. all these features go on the new version only"

Answers the same day:

- Subscriptions: the discount applies to the **first payment only** (monthly: first month; annual: first year).
- Credit packs: **bonus credits**, same price (+5% / +10% / +20%).
- Codes valid **to 2026-12-31**, "with the possibility to make it earlier if needed".
- *"i will add a code to give more credits too … the code will give extra credit or discount"* → a code carries a
  subscription discount, extra credits, or both; a new code is a row, never a store change.

| Code | Subscription first payment | Credit packs | Ends |
|---|---|---|---|
| `FAMILY` | −5% | +5% credits | 2026-12-31 (editable) |
| `FRIENDS10` | −10% | +10% credits | 2026-12-31 (editable) |
| `BLACK` | −20% | +20% credits | 2026-12-31 (editable) |

The free week is never offered to an account that existed before the new build (Maxim, 2026-11-19: they already
had the 75 free credits as their trial). Codes are separate from that rule.

## Why it is built in the app, not as store codes

Neither store sells "a % code on any product":

- **Google Play promo codes** can only make a product free. A discount exists only as a subscription **offer** the app
  chooses to show.
- **Apple offer codes** are per subscription product, at a fixed price per territory, and are redeemed in Apple's
  sheet, not ours. Credit packs (consumables) cannot be discounted by code.

So one mechanism on both phones:

1. The shopper types the code in the app (paywall / Me). `POST /api/me/promo-code` normalises and validates it on the
   server (exists, active, inside its window, account eligible) and attaches it to the account.
   **Account eligible** (Maxim, 2026-11-19): the account **never had a subscription** (not current, not lapsed) and
   shops on the **Canadian** store. Promo codes are not offered in Egypt. One rule, beside `isUsable`.
   The country is the **store account's** (App Store / Play storefront, read by the phone and sent as
   `storeCountry`), never `users.country_id`: every account is stamped `CA` at creation, Egyptian ones included.
   An unknown country is refused, since the store offers exist in Canada only.
2. **Subscriptions:** the app buys the plan through a hidden discounted store offer for that code's percentage
   (below). The base plan price never changes; installed builds never see the offers.
3. **Credit packs:** the purchase is the normal pack at the normal price. When the top-up settles (route
   `/api/me/credits/topup` and the RevenueCat webhook, idempotent through `recordTopupOnce`), the server adds
   `floor(pack.credits × bonus%)` as a separate ledger line `promo_bonus`, once per transaction.

## Store configuration (done 2026-11-19)

Exact values: `Operations/Free_Week_And_Promo_Codes_Console_Setup.md`.

- **Google Play:** offers `promo-5`, `promo-10`, `promo-20` on the monthly and on the annual base plan; *Single
  payment* for the first period at −5/−10/−20%, eligibility **Developer-determined**, tags `rc-ignore-offer` +
  `promo`. The app buys the subscription option whose offer id matches the server's answer.
- **App Store:** Apple's promotional offers only reach existing or former subscribers, so new shoppers use **Offer
  Codes**: `FAMILY` / `FRIENDS10` / `BLACK` (monthly) and `FAMILYYEAR` / `FRIENDS10YEAR` / `BLACKYEAR` (annual),
  pay up front for the first period, **new subscribers only, Canada only**, expiring Jan 1 2027. The server answers which Apple
  code fits the plan the shopper picked; the app opens
  `https://apps.apple.com/redeem?ctx=offercodes&id=6795860374&code=<code>`. The redemption is reported back by
  RevenueCat like any purchase.

The free week (`free-week`, Play; `priceback_unlimited_monthly_trial`, Apple) is a separate offer. A shopper takes
one or the other, never both stacked.

## Data

`promo_codes` (new table, additive migration): `code` (unique, upper case), `sub_discount_pct` (0–100, 0 = none),
`credit_bonus_pct` (0–100), `starts_at`, `ends_at`, `active`, `max_redemptions` (NULL = no cap), `created_at`.
`promo_redemptions`: `user_sub` + `promo_code_id`, `redeemed_at`, `sub_discount_used_at` (first payment taken),
one row per account per code.

**One namespace.** A promo code is validated with the partner-code rules (`partnerCode.validateNewPartnerCode`:
shape, not a friend code, no `PB` prefix) and must not exist in `partner_codes` — and vice versa. That check is one
function used by both admin create routes.

**One rule for "is this code usable now".** `lib/promoCodes.isUsable(code, now)` (active, `starts_at ≤ now <
ends_at`, under cap) on the server; the app never decides it, it shows what the server answered. Ending a code early
= editing `ends_at` on the admin desk.

## Old builds

New routes only; no existing route, field or meaning changes. The top-up bonus is an extra ledger line on a request
that already succeeds. The Play offers carry `rc-ignore-offer`, so RevenueCat never picks them for an installed
build.

## Built (2026-11-19)

| Piece | Where |
|---|---|
| Tables | migration `0057_promo_codes`: `promo_codes` (seeded FAMILY / FRIENDS10 / BLACK, ends 2027-01-01 05:00 UTC = end of 2026-12-31 Toronto), `promo_redemptions` (cascade with the account), `promo_credit_grants` (one row per store transaction a bonus was paid on, kept: the replay protection) |
| Rules (one definition each) | `backend/lib/promoCodes.js`: `isUsable` (closes ON `ends_at`), `accountEligibility`, `storeOffersFor`, `creditBonusFor` (floored), `promoView` |
| Data | `backend/repos/promoCodesRepo.js`: `attach` (code row locked, so a cap is never overshot), `activeFor`, `everSubscribed` (start date, any subscription event, or the free week), `grantPackBonusOnce`, `isCodeTaken` (one namespace; `partnersRepo.createCode` calls it too), admin `list` / `create` / `update` (terms freeze after the first account takes the code) |
| Routes | `GET` / `POST /api/me/promo-code` behind `X-App-Caps: promo-code` (without it: 404, as for an unknown path). Refusals: 400 `invalid_code`, 404 `not_found`, 409 `had_subscription` / `store_country`, 410 `inactive` / `not_started` / `expired` / `exhausted`. Admin: `GET` / `POST /api/admin/promo-codes`, `PATCH /api/admin/promo-codes/:id` |
| Pack bonus | after a verified pack purchase on BOTH paths (`/api/me/credits/topup`, RevenueCat webhook): ledger type `promo_bonus`, note `promo code bonus`; the top-up answer gains an optional `promoBonus` |
| Phone | `src/services/promoCodeService.js` (asks, never decides); `purchaseService.purchaseWithPromo` (Android: the `promo-N` option; iOS: Apple's redeem sheet); paywall "Have a promo code?" (hidden outside Canada); Admin · Promo codes |
| Labels | `promo.*`, `credits.type.promoBonus`, `credits.note.promoBonus`, EN + FR |

The free week is Canada only in both consoles since 2026-11-19 too (setup doc). Its server rule is unchanged: the
store not offering the week in Egypt is what keeps it off screen H there.

## Open

- ~~Apple path~~ decided: Offer Codes (promotional offers exclude new customers).
- ~~Pack prices~~ left as they are in both stores (Maxim, 2026-11-19).
- Data per code: `apple_code_monthly`, `apple_code_annual`, `play_offer_id` columns on `promo_codes`, so a new code
  stays a row (plus its store offers).
