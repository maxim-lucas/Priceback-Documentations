# Credit Management Audit — 2026-07-05

Pre-publish audit of every credit-management surface **except** the price-tag and
receipt credit *spend* logic (explicitly out of scope per Maxim — already
field-tested; nothing in that area was analyzed or changed).

**Verdict: the system is sound.** One regression was found and fixed (auto-reload
trigger point), one latent prod-data risk is flagged for the publish checklist,
and everything else verified clean end-to-end (code → config → live dev DB → tests).

---

## 1. The regression: auto-reload fired at 0 instead of 50 — FIXED

**What Maxim approved:** the auto-reload prompt appears when the credit balance
*drops to or at 50* (`AUTO_RELOAD_THRESHOLD_CREDITS`).

**What the code did:** the 2026-07-02 "auto-reload confusion" session (Task Log)
resolved a UI complaint by **rewording all copy to "re-buy at zero"** and leaving
the prompt wired only to the hard block — `ScanScreen` called `maybeAutoReload()`
exclusively when `canAddReceipt()` returned `allowed: false`, i.e. at 0 credits.
The 50-credit threshold survived only as the Home-screen banner + copy parameter.
That behavior change was never approved.

**Important nuance (platform constraint, unchanged):** "auto-reload" is an
**auto-prompt**, not a silent charge. Apple App Store §3.1.2 and Google Play
Billing require a user confirmation per consumable purchase, so the OS purchase
dialog is always shown. What the threshold controls is *when that dialog is
offered*.

**The fix (this session):**
- `src/services/purchaseService.js` — new `maybeAutoReloadOnLowBalance(status)`:
  fires the auto-reload prompt when a fresh balance snapshot is **≤
  `getAutoReloadThreshold()`** (DB-tunable, bundled default 50). Deduped **once
  per threshold crossing** via an AsyncStorage marker
  (`auto_reload_low_prompted_v1`): prompting arms it; any balance observed back
  above the threshold re-arms it. Unlimited (`Infinity`) and unknown (`null`)
  balances never prompt. Delegates to `maybeAutoReload()` so the opt-in,
  premium-guard, and pack-resolution rules stay in one place.
- `src/screens/ScanScreen.js` — after each post-spend balance refresh (successful
  save AND rejected-scan spend), the fresh snapshot is handed to
  `maybeAutoReloadOnLowBalance`. The **0-credit hard gate is untouched** and
  remains the final safety net. **No credit spend/gate logic was modified.**
- `src/services/i18n.js` — EN+FR copy updated from "at 0" to threshold-based
  wording (`buyCredits.autoReloadSub` now quotes `{threshold}`; Home banner,
  profile keys, and picker body reworded). Honest "you confirm each top-up"
  phrasing retained.

Also logged as `docs/Bugs_Common_Fixes.md` #73.

---

## 2. Threshold configuration chain — VERIFIED CORRECT (50 everywhere)

| Layer | Value | Source |
|---|---|---|
| Bundled mobile catalog | 50 | `shared/pricing.config.js` → `AUTO_RELOAD_THRESHOLD_CREDITS: 50` |
| Backend bundled fallback | 50 | `backend/shared/pricing.config.js` (synced copy) |
| Seed | 50 | `backend/db/seed.js` → app_config (insert-only, `onConflictDoNothing`) |
| **Dev DB (live)** | **50** | `priceback.app_config` on Supabase dev (queried 2026-07-05) |
| Mobile fallback | 50 | `pricingCatalogService.getAutoReloadThreshold()` hard default |

The mobile app reads the threshold from `/api/v1/pricing.json` (DB-authoritative)
with cached → bundled → hard-50 fallbacks. The backend low-balance **push**
(`maybeNotifyLowBalance` in `server.js`) already used the same key with correct
crossing semantics (fires once when a spend crosses the threshold downward) — it
was always aligned with 50; only the mobile prompt wasn't.

## 3. Friend referral — VERIFIED SOUND (no changes needed)

`backend/repos/referralsRepo.js` + `server.js` wiring:

- **Redemption** (`redeem`) is one transaction: edge insert + `referred_by` +
  `referrals_count`. The `user_referrals.referee_sub` UNIQUE is the idempotency
  guard — repeat/racing redemptions insert nothing and pay nobody. Rejection
  rules verified: self-referral (both derived + custom code), already-redeemed,
  deleted redeemer, deleted inviter (reads as `not_found` — no account-existence
  leak), post-onboarding redemption blocked (`postalCode` set ⇒ reject).
- **Payout is deferred by design**: nobody is paid at redemption. The bonus
  settles on the referee's **first purchase** (credit pack OR subscription) via
  `settleReferralOnFirstPurchase` — `SELECT … FOR UPDATE` on the edge +
  NULL-ledger-id guard makes it exactly-once even when the client top-up confirm
  and the RevenueCat webhook race. Both purchase paths call it
  (`/api/me/credits/topup` and the RC webhook, `INITIAL_PURCHASE` +
  `NON_RENEWING_PURCHASE`).
- **Amounts**: `REFERRAL_REFERRER_CREDITS` / `REFERRAL_REFEREE_CREDITS` = 15/15,
  DB-tunable, verified 15/15 in the live dev DB; quoted to the UI from the same
  config (no hardcoded copy numbers).
- **Tests**: 46/46 backend referral + credit tests pass against dev Supabase
  (`referral`, `referralsRepoDb`, `referralsRepoEdges`, `creditLedgerAccuracy`,
  `signupCredits`, `offlineScanCredits`), including the concurrent-settle race
  and the concurrent-redeem cases.

## 4. Credit ledger + purchase paths — VERIFIED SOUND (no changes needed)

- `creditsRepo.applyCreditChangeTx` mutates `users.scan_credits` and appends the
  `credit_ledger` row in the same transaction — balance and ledger cannot drift.
  `balanceReconciles` cross-checks; exercised by `creditLedgerAccuracy.test.js`.
- `recordTopupOnce` (pack purchase) is idempotent per store-transaction id under
  a pg advisory xact lock — client confirm + RC webhook double-delivery cannot
  double-credit. `firstTopup` is computed inside the same lock (no race), and
  the client uses it to opt the user into auto-reload exactly once, on their
  first pack purchase.
- `consumeScanCreditOnce` / `grantPriceTagCredit` / `revokePriceTagCredit`:
  audited for *structure only* (idempotency + lock pattern all correct); spend
  semantics intentionally not reviewed per scope.
- Signup grant: `FREE_TRIAL_CREDITS` (75) is a one-time grant, gated on verified
  accounts; placeholder accounts collect exactly once on later verification.
- Dev DB pack catalog verified live: Starter 250/$3, Pro 500/$5, Max 1100/$10 —
  matches `shared/pricing.config.js`.

## 5. Flagged risks (no code change here — see Publish Checklist)

1. **Prod credit packs likely stale (Bugs #53, latent).** `seedCreditPacks` /
   `seedTierConfig` upsert `credits`/`price` with `coalesce(existing, excluded)`,
   so a re-seed can never correct a stale non-null value — prod likely still
   holds the old **300-credit Starter**. Fix the row by hand (or flip the upsert
   to catalog-authoritative `excluded.*`) during the prod-migration pass.
   Added to Publish Checklist §8B.
2. **Prod DB owes the whole migration chain** before any prod deploy (already a
   checklist blocker, §8B) — the referral edge table, credit ledger types, and
   app_config seeds all live there.
3. **RC SKU price change** ($4.99 Unlimited) still pending in the RevenueCat
   dashboard (checklist §2).

## 6. Test coverage delivered this session

- `__tests__/purchaseService.test.js` — new `maybeAutoReloadOnLowBalance` suite
  (7 cases): unknown/unlimited balances never prompt; above-threshold re-arms;
  opt-out never prompts; prompts exactly AT 50; one prompt per crossing;
  re-arms after recovery; premium guard delegation.
- `__tests__/scanScreenCreditGate.test.js` — wiring test: a spend landing at the
  threshold hands the fresh balance to the low-balance prompt (and the 0-credit
  gate isn't involved); existing gate-before-OCR tests untouched and green.
- Full mobile suite + coverage run (see Task Log for the numbers); backend
  referral/credit suites 46/46 green on dev Supabase.
