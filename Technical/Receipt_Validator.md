# The receipt validator (parent of the quality check)

*Maxim, 2026-10-30. Code: `src/services/receiptEligibility.js`, called last by `receiptParser.scanReceipt`; the Save-time check in `ScanScreen.handleSave`; switch `RECEIPT_REFUSE_EXPIRED` (`backend/lib/receiptQualityCheck.js`).*

> *"expired receipt should be refused on scan … create a new validator as a parent of the quality check and integrate other consideration as date of purchase, not a costco receipt … only to be refused if the date has been detected at high confidence or if the user confirmed the date in the expiry window. if not confident accept it and the admin will refuse the receipt if this is the case."* — then: *"expired receipt even refused has to be charged 1 credit still"*.

The quality check asks *"is this reading good enough to trust?"* The validator asks the question before it: *"is this a receipt PriceBack can do anything with?"* The first refusal wins:

1. **Not a receipt we track.** These are the parser's own refusals, passed through unchanged: a store PriceBack does not support (`unsupported_store`), a receipt from outside Canada, gas, refund-only, unreadable.
2. **Expired** (`receiptKind: "expired"`). The purchase date is past **the store's own price-adjustment window** (`store.adjustmentDays`: Costco 30, Best Buy 15).
3. **The receipt quality check** (`applyQualityCheck`, `Receipt_Photo_Quality_Gate.md`).

## When a date is trusted

| Where | Date | Refused? |
|---|---|---|
| At scan | read off the paper, a real date, not after today, **at most 366 days old** | yes, when expired |
| At scan | none read (the review step offers today and asks to confirm), in the future, over a year old, malformed | **no**: accepted; the admin refuses it on the desk |
| At Save | the date the shopper is saving with: one they picked or confirmed, or the one read off the paper | yes, when expired |

The window is counted the way the server counts a receipt's expiry (`receiptsRepo.recomputePolicyStatus`: expired iff `purchase + window < today`). That is **one day kinder** than the app's own countdown (`adjustmentWindow.daysRemainingISO`), so a receipt the server still calls claimable is never refused. Day 30 of a Costco receipt saves; day 31 is refused.

## The credit

An expired receipt was read fine, so it **costs the scan's credit**, like a gas or refund receipt (`receiptRejection.rejectionSpendsCredit("expired") === true`). At scan time it goes down the existing gas/refund path: `incrementReceiptCount({ rejected: true })`, the "not eligible" card with *"1 scan credit was used."* The offline queue (`receiptScanQueue`) does the same. At Save the refusal comes **after** the credit gate (an out-of-credit shopper gets the paywall, not a free refusal), spends the credit the same way, and saves nothing.

Copy: `scan.rejectedExpiredTitle` / `scan.rejectedExpiredBody` (EN/FR).

## The switch

Admin · Receipt reading › Quality check › **Refuse expired receipts** (`RECEIPT_REFUSE_EXPIRED`, **on by default**). The app receives it as `receiptQuality.refuseExpired` on `GET /api/v1/app-status`. It works whether the quality check's own master switch is on or off. The app treats it as on until the server says a literal `false`, including before the server has said anything. Off: nothing is refused for its date.

## Old builds

Builds before this release have no validator and never refuse for a date. The server change is additive (one more field in app-status, one more admin flag). An expired receipt from an older build is saved as before. The server already marks it `expired`, and the admin refuses it on the desk.
