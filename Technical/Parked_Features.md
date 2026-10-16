# Parked features — in the code, sold by nobody

A **parked** feature exists in the codebase but is deliberately not offered:
its entry point is hidden, no plan sells it, and no store listing or paywall
mentions it. It stays parked **until Maxim unlocks it**. Don't re-propose it,
re-sell it, or "finish" it as a side task. If a review or audit flags it, the
answer is "parked, see this file".

The code-side list is `PARKED_FEATURE_KEYS` in `shared/pricing.config.js`
(mirrored in `backend/shared/pricing.config.js`). `backend/tests/sharedPricing.test.js`
fails if a parked key is free or listed in any tier's `featureKeys`.

## PDF export of claims (`pdf_export`)

- **Parked:** 2026-10-07, at Maxim's request, when it was removed from the
  Unlimited plan.
- **Why:** not fully tested. Maxim: *"the feature is not fully tested and is
  hidden now, i wont bring it to the table … until i unlock it"*.
- **State in code:**
  - Profile row is commented out in `src/screens/StoresAndProfileScreens.js`
    (the `exportData` entry). `openExportModal` / `runExport` and
    `src/services/exportService.js` stay wired but can't be reached.
  - `runExport` gates on `canUseFeature("pdf_export")`, which is now **false for
    every user**, Unlimited included (`__tests__/purchaseService.test.js` pins it).
    Uncommenting the row alone would show every user the "see plans" alert.
  - `profile.exportPaywallBody` still reads "available on Pro and Unlimited
    plans". That text is unreachable and also out of date. Rewrite it when unparking.
- **To unlock:** decide which plan (if any) sells it → remove it from
  `PARKED_FEATURE_KEYS` → add it to that tier's `featureKeys` + a paywall bullet
  (`features`, and the position-keyed `catalog.tier.<id>.features.<i>` in **every**
  language) → write a DB migration for the tier row (the seed COALESCEs
  `features`/`feature_keys`, see migration 0020) → uncomment the Profile row →
  test the export on both platforms.

## Not a feature at all: family sharing

"Family sharing (up to 6 users)" was advertised on Unlimited, but the app has
no family or device sharing, and Family Sharing is switched off on both App
Store subscriptions. It was dropped from the bundled catalog earlier. On
2026-10-07 it was also dropped from the **database** row (migration 0020), which
is what the live paywall actually reads. This is **not** parked: there is no
code to unlock. Selling it would mean building it first.

## The Unlimited plan as of 2026-10-07

Bullets, in order (the French overlay is keyed by position):

1. Unlimited receipt scans
2. Unlimited price drop claims
3. No per-drop charge
4. Access to Price Checker (barcode lookup)
5. Email sync (Gmail & Outlook)
6. Priority price checking (every 2 h)

`featureKeys`: `barcode_scan`, `email_sync`, `priority_price_check`,
`claim_assistant`, `advanced_analytics`, `early_access`.

Applied by hand to dev (`gnedluuylimjwdmtvswl`) and prod (`xjfrlzwonyaorwktnkpj`)
on 2026-10-07, with ledger row hash `2c320b3e…eb3f` (LF), `created_at` 1791200000000.

Before, both databases carried the pre-launch row: the bullets included PDF
export and family sharing, there was no Price Checker bullet, and the keys
included `pdf_export` and `family_sharing` but **not** `barcode_scan`. Rollback
values are in the task-log entry for that day.
