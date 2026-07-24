# Subscription & Money-Flow Audit — 2026-07-06

Scope: every path where the user spends money or credits, or the app earns —
subscriptions (RevenueCat), credit packs, the scan-credit ledger, drop
commissions, referral bonuses, the signup grant — audited end-to-end for
zero-margin-of-error handling. Companion to `Credit_Management_Audit.md`
(2026-07-05, credit-side deep dive). Bug write-up: `Bugs_Common_Fixes.md` #75.

## The subscription promise (now enforced centrally)

> **Any in-force paid subscription = everything unlimited, zero credit
> charges. The credit balance is FROZEN — untouched by subscribe, renew,
> cancel, billing-retry, and expiry — and is intact when the user returns to
> pay-as-you-go.**

Enforced by `subscriptionGate.isCreditExempt(profile)`:
`effectiveScanTier(profile) !== "free"` — exempt for status active /
cancelled-until-expiry / in_billing_retry on ANY paid tier or billing cycle;
an `expired` status (or free tier) pays credits again. All three server-side
charge sites route through it:

| Charge site | File | Before | Now |
|---|---|---|---|
| Receipt scan spend (POST /api/receipts) | `backend/server.js` | `tier === "unlimited"` inline | `isCreditExempt(me)` |
| Offline-scan batch upload | `backend/server.js` | `tier === "unlimited"` inline | `isCreditExempt(me)` |
| Verified price-drop commission | `backend/priceDropNotifier.js` | `tier === "unlimited"` inline | `isCreditExempt(u)` |

Mobile side (already correct, verified): `canAddReceipt()` returns
`remaining: Infinity` for any premium tier with an Infinity quota and never
touches the balance endpoint; `maybeAutoReload` refuses to fire for premium.

## Verdict by flow

### Sound as found (no change)
- **Credit ledger** — balance mutation + ledger row are one transaction
  (`applyCreditChangeTx`); every spend/grant idempotent per (user, type, ref)
  under a pg advisory xact lock (`consumeScanCreditOnce`, `recordTopupOnce`,
  `grantPriceTagCredit`/revoke). `balanceReconciles()` is the audit query.
- **Top-up dual path** — client-confirm (`POST /api/me/credits/topup`) and the
  RC webhook share the store transaction id as the idempotency ref; whichever
  lands first credits, the other no-ops. (One mobile-side hole fixed, below.)
- **Referral settle-on-first-purchase** — deferred, FOR-UPDATE-locked,
  exactly-once across the topup/webhook race (re-audited 2026-07-05).
- **Signup grant** — verified-email accounts only, idempotent via
  `trial_credits_granted_at`, ledger row written in the same transaction.
- **Credits frozen** — `setSubscriptionState` writes tier/status/expiry only;
  no subscription lifecycle event can move `users.scan_credits`.
- **Webhook auth** — timing-safe token compare; SANDBOX skipped; unknown event
  types skipped (no accidental downgrades); 500 → RC retries safely.
- **Tier trust** — server-authoritative reconcile (jailbreak downgrade),
  single-device subscription claim, `VALID_TIERS` rejects forged tier strings.

### Fixed in this audit (Bugs #75)
1. **Charge exemption was per-site string matching** → `isCreditExempt`
   (status-aware, tier-agnostic, future-proof for annual + any new tier).
2. **Webhook replay could regress state** — the DB path never fed
   `subscriptionLastEventId`, so a re-delivered older event re-applied stale
   tier/status. Now `subscriptionEventsRepo.hasEvent(rcEventId)` (audit table
   unique on rc_event_id) is checked before applying — total dedupe.
3. **Mobile pack-confirm double credit** — `originalPurchaseDate` was used as
   a txn-id fallback, splitting the idempotency ref vs the webhook. Now only a
   real `transactionIdentifier`/`revenueCatId` confirms; otherwise the webhook
   is the sole grantor.

### Documented, intentionally unchanged
- The server records a receipt-scan spend only when the balance covers it and
  does not reject the receipt at 0 credits — enforcement is the client's
  pre-OCR gate (2026-07-02). Field-tested spend logic; scope-excluded.
- `claimCreditCost` floors, `dropChargeCredits` rounds — intended asymmetry
  (claims quoted conservatively; commissions to the nearest credit).
- Auto-reload is an auto-PROMPT (platform rule), never a silent charge.

## Annual subscription — `priceback_unlimited_annual`

- **$49.99/year = pay for 10 months, get 12 → "2 free months, paid at once".**
  Catalog: `shared/pricing.config.js` (`annual` block on the `unlimited` sub,
  `monthlyEquiv: "$4.17"`). Everything downstream was already annual-aware:
  Paywall cycle toggle + "2 FREE MONTHS" badge (`paywall.twoFreeMonths`,
  EN+FR), `purchaseTier(tierId, isAnnual)`, restore/entitlement cycle
  heuristic, DB `subscription_plans.annual_*` columns (seed coalesce fills the
  NULLs on next boot), webhook (cycle-agnostic: entitlement is `unlimited`
  either way — identical tier, features, exemption).
- **Maxim's manual steps** (see `RevenueCat_Paywall_Config.md`, updated):
  create the `priceback_unlimited_annual` subscription in Play Console
  (base plan `annual`, 1 year, $49.99) and App Store Connect (group
  `PriceBack Pro`), attach it to the `unlimited` entitlement + `current`
  offering in RevenueCat.

## Regression-test map (all green 2026-07-06)

| Suite | Pins |
|---|---|
| `backend/tests/subscriptionMoneyDb.test.js` (new) | annual SKU → unlimited/active/1-yr expiry; replay can't regress state; credits byte-identical across subscribe→renew→cancel→expire with zero ledger rows; cancelled subscriber scans at cost 0, expired pays again — live DB |
| `backend/tests/subscriptionGate.test.js` | `isCreditExempt` × every status (active/cancelled/in_billing_retry/expired) × tiers incl. synthetic; all RC event types; idempotency; sandbox skip; unlimited never burns credits |
| `backend/tests/sharedPricing.test.js` | annual SKU id/price ($49.99 ≈ 10× monthly, < 12×), monthlyEquiv = annual/12, annual never a TOPUP product, same feature set + Infinity quota both cycles |
| `backend/tests/{dbRoutes,offlineScanCredits,priceDropCommission,signupCredits,referralsRepoEdges}.test.js` | pre-existing: webhook grants/dedupe, topup idempotency, drop-commission exemption, signup grant, referral settle |
| `__tests__/purchaseService.test.js` | annual purchase → billingCycle=annual; purchaseTier annual SKU resolution; no-txn-id → NO client confirm (double-credit guard); txn-id → exact-ref confirm; annual subscriber: Infinity scans, no balance fetch, all features, auto-reload refuses |
