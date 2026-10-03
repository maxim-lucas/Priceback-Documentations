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
| `referee_credits` + `referee_trigger_id` | Welcome credits for the new user, at `signup` / `first_scan` / `first_purchase` |
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
  - any code the friend normalizer would accept (`ambiguous_with_friend_code`; e.g. `SARAHB` reads as `PB-SARAHB`);
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

- `onFirstScan(sub)` is called (fire-and-forget) after `POST /api/receipts` **creates** a receipt that is neither a refund nor a refused US receipt.
- `onPurchase(sub)` is called from `settleReferralAfterFirstPurchase`. That function is already invoked by all four non-sandbox purchase paths (RC webhook top-up, RC webhook subscription incl. renewals, `/subscription/sync`, `/credits/topup`), so no new call sites were added.
- Both lock the attribution `FOR UPDATE`, capture conversions, and pay every reward whose trigger has fired and whose stamp (`referee_credited_at` / `partner_credited_at`) is empty. The stamp is set in the same transaction as the ledger row and never clears. A partner reward with no linked or live partner account is left **unpaid and unstamped**.
- Ledger types: `partner_referee_bonus` (note `partner code welcome bonus`) and `partner_referral_bonus` (note `partner referral reward`). The ledger `ref` is `partner-att:<id>`. Notes never name the referred user.
- Pushes reuse data type `referral_settled` (roles `referee` / `referrer`), category `notifFriendJoins`, with copy keys `partner.referee.*` / `partner.partner.*` in `backend/lib/pushI18n.js` (EN + FR).

## Conversions (`captureConversions`)

These are copied out of `subscription_events` (types `INITIAL_PURCHASE`, `RENEWAL`; `is_sandbox = false`) and `topup_refs` (no sandbox ledger row with the same ref) **since `attributed_at`**. They are priced from the CAD catalog (`subscription_plans` / `credit_packs`), the same source as the dashboard's "Total gain". A product with no CAD catalog row is skipped, not guessed.

The idempotency key is `source_ref`:
- `sub:<user>:<product>:<UTC day>` (one plan charge per day; a webhook and a client sync of the same charge count once);
- `topup:<store ref>`.

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
- The comped plan is recorded only (`comped_until`); grant it in RevenueCat.
- There is no deep link / landing page (`priceback.ca/c/CODE`). The code is typed in onboarding.
- Credits and revenue are CAD-only (Canada launch). An Egyptian-pound purchase has no CAD catalog row and is not counted.

## Deploying to production

Migration 0017 is applied **by hand before the code merges** (prod's drizzle ledger is hand-maintained):

1. Run `backend/db/migrations/0017_partner_program.sql` against prod.
2. Insert the ledger row with the file's LF sha256 and `created_at = 1790900000000`.
3. Boot seeds `partner_types`, `partner_triggers` and the two credit event types.

Until it is applied: partner codes answer `not_found`, the desk answers 503, and friend referrals and every purchase path are unaffected.
