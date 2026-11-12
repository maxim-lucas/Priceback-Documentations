# The same receipt uploaded twice, and rejecting a receipt that already had a price drop

**Added 2026-11-11** · hotfix `hotfix/receipt-duplicates-and-reject-reversal` (off `main`, v3.6.1) · server + admin desk.
No migration. Nothing a shopper's screen shows changes, except one new line in Credit History when a drop is reversed.

Two rules, built together because one incident needed both:

1. **One paper, one receipt.** Two of a shopper's receipts that carry the same lines in the same order are the same
   paper, however differently they were read. The desk says so, the app approves neither on its own, and a drop
   that is already on one read waits for an admin on the other.
2. **A rejected receipt takes its price drops with it.** An admin can reject a receipt whose drop was already sent:
   the credits it cost are refunded and the drop goes with the receipt.

## 1. The incident (prod, 2026-11-11)

One shopper uploaded the same Costco receipt twice, five hours apart:

| | `r_1794399021648_kxuag` | `r_1794416482467_dgxv6` |
|---|---|---|
| What it was | a cropped screenshot | the whole receipt, as a PDF |
| Lines read | 9 | 12 |
| Purchase date | 2026-11-11 (wrong: the totals block was cut off) | 2026-11-05 (right) |
| Total | $171.79 | $232.23 |
| Drop sent | queue 12303, 14:30 UTC, 38 credits (`drop:7286:949`) | queue 12310, 18:30 UTC, 38 credits (`drop:7351:949`) |

The same drop on the same product was sent and charged on each. Three things let it through:

- **The exact duplicate rule missed it.** `duplicateOf` (`isEarlierCopySql`) needs the same date, total, tax and
  line count. All four differed.
- **Nothing downstream asked "is this paper already here?"** Not the reading confidence, not the app's own
  approval, not the price-drop queue.
- **The copy could not be rejected.** Reject refused with `HAS_HISTORY` because a drop had been sent. The only
  way out was by hand: Maxim gave 38 credits back from the credit desk, then approved the drop again on the good
  receipt.

## 2. The copy rule

**One definition:** `comparePapers(a, b)` in `backend/lib/duplicateReceipt.js`. Every reader calls it through
`copiesForReceipts(ids)`. Nothing re-derives it.

Two live receipts **of the same shopper, at the same store,** are the same paper when their product lines are the
same lines **in the same order**. A register prints one sequence; two different trips that share a few staples
almost never scan them in one order.

| The shorter receipt has | It is a copy when |
|---|---|
| 3 lines or more | at least 80 % of its lines, and never fewer than 3, appear in order on the other one |
| 1 or 2 lines | every line appears, **and** the purchase date is the same |

Details that matter:

- **A line** is its product and what was paid for it, to the cent (`productId:lineTotal`).
- **Fee lines** (deposits, eco fees — `ignored = true`) are left out: they repeat on every receipt.
- **Order** is measured as the longest run of lines both receipts print in the same sequence (`sharedInOrder`), so
  a cropped photo, a line the parser lost, or a line read wrong on one side still match.
- **The purchase date is not compared** for 3 lines or more. A wrong date is exactly what a bad copy has.
- **Warehouses** must not differ when both are known. One unknown warehouse hides nothing.
- **Candidates** are the shopper's live receipts created within 120 days of each other (`CANDIDATE_DAYS`).
- Deleted and rejected receipts are never candidates.

The incident's pair: 9 of the 9 cropped lines appear in order among the PDF's 12 → a copy.

### What reads the rule

| Reader | What it does with a copy |
|---|---|
| `receiptsRepo.getForAdmin` → `possibleCopies` | The opened receipt shows one banner per other read, with its date, total, line count and "n of n lines match". Tap opens the other receipt. |
| `receiptsRepo.listForAdmin` → `possibleCopyOf` | A **Possible copy** badge on the review list row. |
| `receiptAutoFix.readingConfidence` → check `not_a_copy` | Fails on **both** reads, so neither is "n of n" and the badge is red. It never blocks a Gemini proposal (a proposal is the same receipt). |
| `receiptAutoApproval.evaluate` | Approves neither read. If the app had already approved the first read before the second arrived, that approval is taken back. A **person's** review is never touched. |
| `priceDropQueueRepo.copyDrops` → `heldReason: "copy_receipt"` | A pending drop whose product was already told a price, or is also waiting, on the other read is marked on the desk with the price that was sent and a button to the other receipt. |
| `priceDropNotifier._drainOnce` | Holds that drop for an admin even with review off. A drop an admin approved leaves: that is their decision. |

### What the rule does not do

- It does not change `duplicateOf`. That stays the exact rule, the only one the shopper's app acts on.
- It does not block an upload, delete a receipt or hide anything from the shopper. A person decides which read
  stays.
- A failed lookup flags nothing and holds nothing (every caller is fail-soft and logs a warning).

## 3. Reject and reverse

`POST /api/admin/receipts/:id/reject`, body `{ reason, reverseDrops? }`.

| Request | Receipt has a sent drop or a claimed line | Answer |
|---|---|---|
| no `reverseDrops` (every desk build up to 3.6.1) | no | rejected, as before |
| no `reverseDrops` | yes | `409 HAS_HISTORY`, now with `history: { dropsSent, creditsCharged, claimed }` |
| `reverseDrops: true` | yes | rejected, drops reversed |
| any | a drop is being sent for a line this minute | `409 SENDING` — try again in a minute |

Only the literal `true` reverses. The desk asks first: it shows what the history is and what reversing undoes, and
sends `reverseDrops` only after **Reverse and reject**.

What a reversal does, in one transaction (`backend/lib/receiptRejection.js`):

1. **Refunds the drop charges.** For each line that was told a drop: the credits its `price_drop_charge` rows took
   (ledger ref `drop:<line>:<cents>`), less anything already refunded for that line. One `refund` row per line,
   ref `drop-reversal:<line>`. The charge rows stay: the ledger is never rewritten.
2. **Removes the lines**, and with them (foreign-key cascade) the sent drops, re-drops, queue rows, reminder-email
   rows and claims. The shopper's app stops showing the drop.
3. **Clears the annual guarantee's "a drop was found" stamp** when no other drop was sent to the shopper in that
   guarantee year. A drop PriceBack took back must not cost them the payout.
4. Everything a plain reject already did: the receipt's price points and crowd copies go, the shopper gets the
   rejection push for the chosen reason.

Rules that hold:

- **A subscriber was charged nothing, so nothing is refunded.** No empty refund row is written.
- **Never refunded twice.** The amount owed is read from the ledger inside the transaction; a line already
  refunded under its `drop-reversal:` ref owes nothing.
- **The scan credit is not refunded**, as with any rejection.
- **The same product on the receipt that stays can then be told as its own drop** and charged once.

The summary the route returns gained `dropsReversed`, `creditsRefunded` and `claimsRemoved` (0 for a receipt with
no history). The Railway log line says `REVERSED n sent drop(s), n credit(s) refunded, n claim(s) removed`.

**What the shopper sees:** the rejection push, and in Credit History a refund row labelled *"Credits returned for
a price drop on a receipt we could not accept"* (EN + FR, key `credits.note.dropChargeReversed`). Builds up to
3.6.1 show the server's English sentence for that row.

## 4. How to handle a copy pair on the desk

1. Open either receipt. The banner names the other read.
2. Decide which read is right (usually the one with the totals block and the right date).
3. Reject the other one. If it already had a drop sent, confirm **Reverse and reject**.
4. On the receipt that stays, approve the drop from the price-drop queue if it is waiting there.

## 5. The two prod receipts are still as they were

Nothing in prod was changed by this work (SELECTs only). Both receipts are live and reviewed, each with one sent
drop. The shopper's ledger today: two charges of 38, one manual `admin_adjust` of +38, balance 35.

After this ships, rejecting `r_1794399021648_kxuag` with reversal refunds **38 more** — on top of the manual +38.
The shopper would then have paid nothing for the drop that stands on the PDF. Either take the manual 38 back from
the credit desk afterwards, or leave it as goodwill. That is Maxim's call.

## 6. Cost

No scheduled job, no new table, no third-party call.

| Where | Extra database work |
|---|---|
| Admin opens a receipt | 1 statement |
| Admin loads a page of the review list (50 rows) | 1 statement for the whole page |
| Admin loads the price-drop queue | 1 statement, plus 1 when a listed receipt has a copy |
| A drain that claimed unreviewed rows | the same 1 (+1) |
| The app judges a saved receipt | already reads `getForAdmin`; the twin, when there is one, is judged once more |

Measured on dev by the DB tests, not on prod. At today's 10 to 25 receipts a day this is a few hundred small
reads a day.

## 7. Tests

- `backend/tests/receiptCopies.test.js` (9): the rule itself, the confidence check, the app's approval.
- `backend/tests/receiptCopiesDb.test.js` (4): the incident's pair end to end on the database; the queue hold.
- `backend/tests/receiptRejectionDb.test.js` (3 new, 9 total): refusal with history, exact refund, subscriber,
  no second refund, the guarantee stamp.
- App: `adminReceiptView`, `adminReceiptDetailScreen`, `adminPriceDropQueueScreen`, `adminAutoFix`, `creditLedger`.

## 8. Not in this change

Asked on 2026-11-11 and still open, each needs a decision first:

- Running both readers (the parser and Gemini) and keeping the better read under one rule set.
- A smarter app approval beyond the copy check.
- The Gemini quota. Prod today: the paid key answers 402, only the free key works, `flash` answers 429 / 503 or
  times out, only `flash-lite` answers; both `RECEIPT_GEMINI_*` flags are off.
