# Admin receipt badges and price-drop push copy

**Maxim, 2026-11-17** (hotfix PRs #597 and the follow-up, shipped in 3.6.4).

## 1. Admin receipt badges (list row and receipt screen)

One definition each, in `src/services/adminReceiptView.js`; both screens call them.

| Badge | Rule | Function |
| --- | --- | --- |
| Good receipt | Reviewed by a person OR approved by the app (`admin_reviewed_at` is stamped by both), OR labelled Good, OR a **PDF** (always Good). Never when deleted. An admin's **Bad** label always wins. | `isGoodReceipt(r, quality)` |
| Bad receipt | The admin labelled it Bad (`receipt_quality_checks.labelled_good = false`). Not when deleted. | `isBadReceipt(r, quality)` |
| IMG / PDF | The kind of file scanned. The server sends `sourceType` (`pdf` / `image` / null) from the stored key's extension (`receiptsRepo.receiptSourceType`); the receipt screen also reads `imageContentType`. A receipt whose photo was pruned has no source badge. | `sourceBadge()` |
| Status | Deleted, processing state or price-match lifecycle. Unchanged (`receiptStatus`). | `receiptStatus()` |

- **Stored vs shown.** "Mark reviewed" also stores the Good label (`receiptQualityRepo.label(..., onlyIfUnlabelled)`), so a
  person's judgement reaches the quality trial. An app approval and a PDF are only **shown** as Good, never written as a
  label: the trial scores the check against human labels, and an automatic label would make it score itself.
- Changing the Good rule changes `isGoodReceipt` and `__tests__/adminReceiptView.test.js` in the same PR.

## 2. Price-drop push copy (en + fr)

Every price-drop notification says the drop as of today and, when more than one drop waits, the **sum** waiting to claim.

- Verified drop: `New price drop of {savings} on one of your tracked receipts · {daysLeft}.` then `{total} waiting to claim in total.`
  (this drop plus the others, summed in cents) when others wait.
- **Locked = unlocked minus the identification.** A locked account (balance below zero, not a subscriber) gets the same title
  and text without the days left or dates (`verifiedDrop.bodyNoDays`, `claimsReminder.bodyNoDays`,
  `inactiveClaims.titleNoDays` / `bodyWaiting`). No lock emoji, no "buy credits", no "subscribe", no "locked".
- The payload is unchanged (locked still sends `locked: true` and no receiptId), so every installed build routes taps as before.
- Tests: `backend/tests/pushI18n.test.js` pins "locked copy = unlocked copy minus the days" for every language, so a new
  language or a rewording cannot reintroduce the lock wording.
- Code: `backend/priceDropNotifier.js`, `backend/jobs/pendingClaimsReminder.js`, `backend/lib/inactiveClaimsNudge.js`,
  `backend/lib/pushI18n.js`.
