# Partner program (creator & agency codes) — technical reference

**Shipped in:** Priceback `feat/partner-codes` (migration `0017_partner_program.sql`).
**Business playbook:** [`Marketing-Plan/10-creator-and-agency-partner-program.md`](../Marketing-Plan/10-creator-and-agency-partner-program.md).

## Model

```
partners ──< partner_codes ──< partner_attributions ──< partner_conversions
   │              (one code = one deal)   (one per user)      (paid charges, CAD)
   └──< partner_payouts (cash actually sent)
partner_types / partner_triggers = lookups (seeded, db/seed.js)
```

| Table | Writer | Reader |
|---|---|---|
| `partners` | `POST/PATCH /api/admin/partners` | partner desk, self-redeem guard, credit payee |
| `partner_codes` | `POST /api/admin/partners/:id/codes`, `PATCH /api/admin/partner-codes/:id` | redeem, statement |
| `partner_attributions` | `partnersRepo.redeem`; stamps by `onFirstScan`/`onPurchase` | statement, friend-redeem mutual exclusion, data export |
| `partner_conversions` | `partnersRepo.captureConversions` | statement |
| `partner_payouts` | `POST /api/admin/partners/:id/payouts` | statement (owed) |

Money is `numeric(10,2)` CAD. **Earned amounts are never stored.** They are computed on read by `backend/partnerEarnings.js` from the code's deal + the user's conversions. The only money written by hand is a payout.

## A deal (columns on `partner_codes`)

| Column | Meaning |
|---|---|
| `referee_credits` + `referee_trigger_id` | Welcome credits for the new user (0..25,000), at `signup` / `first_scan` / `first_purchase` |
| `referee_plan_months` | Months of **Unlimited** for the new user (1..120, NULL = none), granted at redemption as a RevenueCat promotional entitlement. Migration 0043 — see *Plan codes* below |
| `partner_credits` + `partner_credit_trigger_id` | Credits to the partner's own account (`partners.user_sub`) per user, at `first_scan` / `first_purchase` (never `signup`) |
| `cpa_amount`, `min_spend` | $ once the user's window spend reaches `min_spend` (0 = the first paid charge) |
| `commission_pct` | % of every paid charge inside the window |
| `window_months` | Attribution window after redemption; bounds CPA **and** commission. NULL = no end |
| `hold_days` | An amount is *pending* this long after its charge, then *payable* (refund window) |
| `starts_at`, `expires_at`, `max_redemptions`, `active` | The code's life. Always editable |

**The deal is frozen once the code has a redemption.** `updateCode` returns `deal_locked`, so a past user is never re-priced. Only dates, cap and `active` stay editable.

## Codes

- Format: `^[A-Z0-9]{4,20}$`, case-insensitive (`backend/partnerCode.js`).
- Creation rejects:
  - any code the friend normalizer would accept (`ambiguous_with_friend_code`; e.g. `KSYEAR` reads as `PB-KSYEAR`);
  - any code starting with `PB` (`reserved_prefix`; the app formats `PB…` input as a friend code).
- The redeem route routes by shape. A friend-shaped code goes to the unchanged friend path; anything else goes to `partnersRepo.redeem`. Both share `POST /api/me/referral/redeem` and the same onboarding field.

## Redemption (`partnersRepo.redeem`)

Inside one transaction, with the user row and the code row locked `FOR UPDATE`, the checks run in this order:

1. User deleted → `deleted_user`.
2. User already friend-referred (`referred_by`) → `already_redeemed`.
3. User past onboarding (`postal_code` set) → `account_setup_complete`.
4. Code unknown, inactive, partner retired, or not started → `not_found` (404).
5. Code expired → `code_expired` (410).
6. Partner redeeming their own code → `self_referral`.
7. Code at its cap → `code_exhausted` (410).
8. Attribution insert, `ON CONFLICT (user_sub)` → `already_redeemed`.

`attributed_at` is the **DB** clock (column default), never the app server's. Conversions are compared against it, and `topup_refs.created_at` is DB time. A server clock running 0.25 s ahead once made a top-up bought right after redemption read as "before the code".

Friend redemption (`referralsRepo.redeem`) now also refuses a user who has a partner attribution. That probe runs in a savepoint and **fails open on `42P01`**, so friend referrals never depend on migration 0017 being applied.

## Triggers and once-only payment

- `onFirstScan(sub, {deviceId})` is called (fire-and-forget) after `POST /api/receipts` **creates** a real purchase receipt. A refund, a refused US receipt, or an empty / zero-total shell doesn't count; the route accepts `items: []`, which would otherwise let a throwaway account farm a reward with no receipt at all.
- **first_scan rewards pay once per device per partner.** The first scan stores `first_scan_device_hash` (`warehousePricing.hashDeviceId`, the same hash `price_points` uses). A first_scan reward pays only if no other attribution of the **same partner** already scanned from that device. The check is serialised by an advisory lock per (partner, device), with **no timestamp clause**: both transactions stamp `first_scan_at` *before* taking the lock, so an "is the other one earlier?" test let an earlier-stamped, later-locking scan pay too (security review #2, fixed). Whoever takes the lock first is the only one that can pay. Two throwaway accounts on one phone, even scanning at the same instant, earn one reward. This also stops a **replay after an account purge**: the purge nulls `user_sub`, so the identity can redeem again, but its phone has already been used. No device on record → no first_scan reward. first_purchase rewards need real money and aren't device-gated.
- ⚠️ **This is friction, not proof.** The device id and the receipt contents are both reported by the client, so a modified client can send a fresh device id per account. A first_scan reward is therefore farmable by a determined partner. The admin form says so under the partner-credit trigger, and the playbook pays partners who aren't trusted yet on **first_purchase**.
- `onPurchase(sub)` is called from `settleReferralAfterFirstPurchase`. That function is already invoked by all four non-sandbox purchase paths (RC webhook top-up, RC webhook subscription incl. renewals, `/subscription/sync`, `/credits/topup`), so no new call sites were added.
- Both lock the attribution `FOR UPDATE`, capture conversions, and pay every reward whose trigger has fired and whose stamp (`referee_credited_at` / `partner_credited_at`) is empty. The stamp is set in the same transaction as the ledger row and never clears. A partner reward with no linked or live partner account is left **unpaid and unstamped**.
- Ledger types: `partner_referee_bonus` (note `partner code welcome bonus`) and `partner_referral_bonus` (note `partner referral reward`). The ledger `ref` is `partner-att:<id>`. Notes never name the referred user.
- Pushes reuse data type `referral_settled` (roles `referee` / `referrer`), category `notifFriendJoins`, with copy keys `partner.referee.*` / `partner.partner.*` in `backend/lib/pushI18n.js` (EN + FR).

## Plan codes — a code that gives Unlimited (migration 0043, 2026-11-02)

Built for the Kickstarter rewards (Maxim: "a code to give a subscription — yearly, monthly or multi-year"). Backend-only: **every app build already in the stores honours a plan code**, because the plan lives in RevenueCat, which every build reads.

- **Grant.** After `partnersRepo.redeem` commits, the redeem route calls `lib/partnerPlanGrant.grantOwedPlan`. It POSTs `https://api.revenuecat.com/v1/subscribers/<sub>/entitlements/unlimited/promotional` with `end_time_ms = attributed_at + referee_plan_months` (calendar months, UTC). A promotional entitlement never bills and never renews: when it ends, the account is back on credits.
- **Once, durably.** `partner_attributions.plan_granted_at` is stamped only after RevenueCat answers 2xx. Until then the plan is *owed*, and every `POST /api/me/subscription/sync` retries the grant **before** it reads the subscriber, so the same sync already sees the plan. The end date is fixed by the attribution, so a retry or two racing calls ask for the same end. A plan whose end passed before it could be granted is stamped and skipped. No `REVENUECAT_SECRET_KEY` means the plan is left owed (logged as `[PartnerPlan] … left owed`).
- **Not revenue.** The promotional product (`rc_promo_*`, store `promotional`) matches no catalog product, so partner conversions and the business counters never price it. `_rcSubscriberToTier` marks it `isPromotional`, the sync records its event with `raw_payload.promotional = true`, and neither the sync nor the webhook (`event.store = PROMOTIONAL`) lets it settle a referral or fire a first_purchase reward. The Price-Drop Guarantee already excluded promotional grants.
- **Response.** The redeem route adds `refereePlanMonths` and `planGranted` (both additive). Builds before 3.5.1 ignore them and show their usual "Code applied" copy. From 3.5.1, onboarding names the plan (`onb.partnerRedeemedPlan` / `…PlanPending`, EN + FR) and refreshes the entitlement right away.
- **Admin.** The partner desk's code form has an "Unlimited months" field. The deal summary reads "User gets N months of Unlimited at sign-up (never renews)". The deal, plan months included, freezes at the first redemption.
- **Bulk issue — `backend/scripts/generate-partner-codes.js`.** This issues **unique codes with a hard use cap** (Maxim 2026-11-02): PREFIX + 8 random characters from an unambiguous alphabet (no 0/O/1/I/L), re-drawn on any collision. A personal reward is single use. A group reward is ONE code with `--uses N` (`max_redemptions = N`); redemption N+1 answers `code_exhausted` ("1 code even for 10 uses … we block at 10"). Nothing is bound to an email, so there is no manual step. Example: `railway run -e production node scripts/generate-partner-codes.js --partner-id <id> --prefix KSY --count 300 --plan-months 12 --out ks-1year.csv`. Run `--dry-run` first.

### Parked option: binding a code to the backer's email (not built — Maxim, 2026-11-02)

Not built because it creates support work: a backer's PriceBack account email often differs from their Kickstarter email (another Google account), and Apple "Hide My Email" gives a random `@privaterelay.appleid.com` address. Every mismatch becomes a support email. Maxim's rule is that nothing in the Kickstarter flow may need a manual step. If leaked codes become a real problem, here is the design, all automatic:

1. **Collect the email.** The pledge manager's survey asks "Which email will you sign in to PriceBack with? (Not an Apple Hide-My-Email address — sign in with Google or show your email.)"
2. **Bind at issue time.** Migration: `partner_codes.bound_email text` (lowercased, nullable). Generator: `--emails <survey.csv>` creates one single-use code per survey row with `bound_email` set. Group codes (`--uses N`) stay unbound, since they're gifts.
3. **Check at redemption.** In `partnersRepo.redeem`, after the cap check: if `bound_email` is set and `lower(users.email)` differs, refuse with `code_email_mismatch`. **Backward compatibility (rule 3):** builds that don't send `X-App-Build` get `404 not_found` ("Code not found"), a path they already handle. Newer builds get `code_email_mismatch` and the copy "This code is linked to the email you gave in the Kickstarter survey. Sign in with that account to use it." (EN + FR).
4. **Self-service fix, no support:** a signed link in the delivery email (`/api/codes/rebind?code=…&sig=…`, HMAC with a server secret, valid 30 days) lets the backer re-bind the code to the account they're signed in to, once. That replaces the manual "email us" step.
5. **Tests:** match, mismatch on old and new builds, unbound group code, single rebind, a forged signature.

Cost estimate: about half a day including tests. Revisit only if redemption logs show codes used by accounts unrelated to the backer survey.

## Conversions (`captureConversions`)

These are copied out of `subscription_events` (types `INITIAL_PURCHASE`, `RENEWAL`; `is_sandbox = false`) and `topup_refs` (no sandbox ledger row with the same ref) **since `attributed_at`**. They are priced from the CAD catalog (`subscription_plans` / `credit_packs`), the same source as the dashboard's "Total gain". A product with no CAD catalog row is skipped, not guessed.

**One subscription charge per product per billing period.** The webhook and the client's `/subscription/sync` both record a renewal, under different event ids and often on different days (the sync lands when the app is next opened). A paid event is accepted only if no accepted charge of the same product lies within 25 days (monthly) or 330 days (annual) of it. Otherwise one renewal would pay the commission twice. The capture runs under an advisory lock per attribution.

The idempotency key is `source_ref`:
- `sub:<rc_event_id>` for subscriptions;
- `topup:<store ref>` for packs (one row per store transaction).

Rows are kept forever and cascade only with their attribution. `subscription_events` is pruned at 1 year and cascades with the account; partner earnings must outlive both.

`statement()` and `listWithStats()` re-run the capture for every attribution before computing, so a purchase whose hook was missed (crash, deploy) still lands.

## Earnings math (`partnerEarnings.computeEarnings`)

All in integer cents.

- Window = `[attributed_at, attributed_at + window_months)`, with calendar months clamped (Jan 31 + 1 → Feb 28).
- Commission = round(charge × pct / 100), per in-window charge.
- CPA accrues at the first in-window charge that brings cumulative window spend to ≥ max(`min_spend`, $0.01).
- Each amount is *pending* until `charge time + hold_days`, then *payable*.
- `summarize` gives: owed = max(0, payable − Σ payouts).

## Admin routes

All routes use the inline `getAdminSubs()` gate (checked by `adminRoutesAreGuarded.test.js`) and the `ADMIN_DESK_RL` rate limit, and return 503 `migration_pending` without 0017.

```
GET   /api/admin/partners                     list + per-partner summary
POST  /api/admin/partners                     {name, type, contactEmail?, instagramHandle?, userSub?, compedUntil?, notes?}
PATCH /api/admin/partners/:id                 contact fields, userSub, compedUntil, notes, active
POST  /api/admin/partners/:id/codes           {code, …deal, startsAt?, expiresAt?, maxRedemptions?}
PATCH /api/admin/partner-codes/:id            active, startsAt, expiresAt, maxRedemptions (+ deal until first use)
GET   /api/admin/partners/:id/statement       JSON; ?format=csv = partner-facing file (no user identities)
POST  /api/admin/partners/:id/payouts         {amount, reference?, notes?, paidAt?}
```

App: `AdminPartnersScreen` / `AdminPartnerDetailScreen` (admin console → Dashboard → Partners). The pure logic is in `src/services/adminPartners.js`.

## Data lifecycle

- `partners`, `partner_codes`, `partner_conversions` and `partner_payouts` are **keep** in `lib/dataCleanup.js` (money records). `partner_attributions` is covered by the test-account classifier instead.
- `partner_attributions.user_sub` is SET NULL on account deletion, so the partner's earnings survive.
- The test-data purge (`lib/testDataMarkers.js`) deletes `test-*` attributions before `users`.
- The user's data export carries `partnerCode {code, redeemedAt, firstScanAt, welcomeBonusCreditedAt}`, and nothing about the partner's deal.

## Known limits

- **Refunds and chargebacks are not clawed back.** The hold covers the store refund window. A refund after the hold must be corrected by hand (record a negative adjustment as a note and pay less).
- The partner's OWN comped plan is recorded only (`comped_until`); grant it in RevenueCat. (A plan for the *referred user* is automatic — see *Plan codes*.)
- A plan code can only be redeemed at sign-up, like every partner code. An existing user who backs the campaign gets their plan by hand: RevenueCat dashboard → customer → *Grant promotional entitlement* `unlimited`.
- There is no deep link / landing page (`priceback.ca/c/CODE`). The code is typed in onboarding.
- Credits and revenue are CAD-only (Canada launch). An Egyptian-pound purchase has no CAD catalog row and is not counted.

## Deploying to production

Migration 0017 is applied **by hand before the code merges** (prod's drizzle ledger is hand-maintained):

1. Run `backend/db/migrations/0017_partner_program.sql` against prod.
2. Insert the ledger row with the file's LF sha256 (`2ff0987f4b5b1fbc4f6ef15b2e624e25a6e2ee01831dc681a152930968fc9aac`) and `created_at = 1790900000000`.
3. Boot seeds `partner_types`, `partner_triggers` and the two credit event types.

Until it is applied: partner codes answer `not_found`, the desk answers 503, and friend referrals and every purchase path are unaffected.

Migration **0043** (plan codes) follows the same procedure, **before the backend that reads it deploys** (drizzle selects the new columns on every partner-code read):

1. Run `backend/db/migrations/0043_partner_code_plan.sql` against prod. It is additive and idempotent.
2. Insert the ledger row with the file's LF sha256 (`c727cb8d8eadf7ab3c29f4ad196afc8c7dee0bfb4005ff5bf73a2818776d1973`) and `created_at = 1793500000000`.
3. Check that `REVENUECAT_SECRET_KEY` is set on prod (`/health` → RevenueCat probe). Without it, plan codes are redeemed but their plans stay owed.

Applied to the dev database on 2026-11-02.
