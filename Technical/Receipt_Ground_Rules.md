# Receipt ground rules — what must be true of every reading, at every store

*Maxim, 2026-11-15. Code: `shared/receiptGroundRules.js` (the rules), `shared/receiptChecks.js` (the checks that run
them), `src/services/receiptPrintedTotalTrust.js` (the scan review), `src/utils/receiptReviewTotals.js` (the receipt
screens). Tests: `__tests__/receiptGroundRules.test.js`, `__tests__/receiptGroundRules.corpus.test.js`,
`backend/tests/receiptAutoFix.test.js`.*

> *"some receipts (one example from yesterday showing subtotal 192.89$ and 7.45$ in total) doesnt make any sense …
> the total is less than the sum of products … the subtotal is bigger than the total (not logic) … make sure that
> everything should seem logic and meaningful when a receipt is scanned on both UI (user and admin) and create ground
> rules as checks that should never fail on parsing, developing (coding), roadmap … available for all store parser
> and you can create some for costco in depth … documented and cross checked on future development too."*

A register never prints a total below the sum of its lines. When PriceBack shows one, a reading is wrong, and the
screen must say so instead of showing the figures as fact. This document is the list of what must always hold, where
each rule is defined (once), what each screen does when a rule is broken, and how a change is checked against them.

The receipt that started it: `r_1794697475248_k06zo` (Candiac #556), root cause **RC-57** in
`Receipt_Parser_Root_Causes.md`.

## 1. The three layers

| Layer | Question | Needs | Defined in |
|---|---|---|---|
| **G · Ground rules** | Can these figures be a receipt at all? | the reading only | `shared/receiptGroundRules.js` |
| **P · Paper rules** | Are these the figures the paper prints? | the reading and the OCR text | `shared/receiptChecks.js` (`evaluateReading`) |
| **C · Store rules** | Is the paper read the way this store prints it? | the store's sections | the store's own files (Costco: `shared/costcoReceiptSections.js`) |

A rule lives in one layer and one function. A consumer (the phone's review, the quality check, the desk's reading
confidence, an AI reader's proof, the app approval) applies a **policy** to the result. It never re-writes the rule.

## 2. G · The ground rules (every store, every reader)

| Id | Code | Rule |
|---|---|---|
| **G1** | `amounts_are_numbers` | Every line amount, the tax and the total are real amounts. Never NaN, never text. |
| **G2** | `quantity_at_least_one` | Every line has a quantity of at least 1. |
| **G3** | `signs_agree` | On a purchase the total and the tax are never negative. On a refund they are never positive. |
| **G4** | `total_covers_lines` | On a purchase the total is never below the sum of the lines (the subtotal). Tax only adds. |
| **G5** | `tax_within_total` | The tax is never larger than the total. |

- One cent of slack per comparison, for the register's rounding.
- The subtotal is always the sum of the lines. It is derived, never stored, so it cannot disagree with them.
- A reading with no total read breaks nothing: there is nothing to judge it by. "Unread" is a valid state. A guess is
  not.
- A refund is told by `isRefund`, or by lines that sum below zero when the caller does not say.

`groundRuleViolations({ items, total, tax, isRefund })` returns the broken rules (`id`, `code`, `detail`). The ids are
stable: tests, the desk and this document name a rule by its id.

### What each consumer does with them

| Consumer | Policy when a ground rule is broken |
|---|---|
| **Scan review (phone)** · `receiptPrintedTotalTrust.settlePrintedTotal`, called by `receiptParser.scanReceipt` after the validator | G4 on the parser's *printed total*: kept only when the paper establishes it (§4). Otherwise the total was never read: it is not locked, the review shows lines + tax and the notice `scan.totalNotRead`, and the shopper types the paper's total. |
| **Receipt screens** (shopper `DetailScreen`, admin `AdminReceiptDetailScreen`) · `receiptReviewTotals.receiptFiguresNotice` | G3, G4, G5 on a stored receipt: both screens show the same sentence under the figures (`detail.figuresDontAddUp`). One function for both. |
| **Reading confidence (desk)** · `receiptAutoFix.readingConfidence` | the `ground_rules` check fails → the badge is red. |
| **AI reader's proof** · `receiptAutoFix.checkProposal` | `ground_rules` blocks: an answer whose figures are impossible is never applied, whichever reader gave it. |
| **App approval** · `receiptAutoApproval` | every check must pass, so a receipt that breaks a ground rule is never approved by the app. |
| **Quality check** · `shared/receiptQualityGate` | unchanged. Its own reasons (`totals_unread`, `lines_off_total`) already cover the case; whether the app refuses for them is the admin's switch per family. |

## 3. P · The paper rules (already in `shared/receiptChecks`)

Listed here so the whole catalogue is in one place. The definitions did not change on 2026-11-15.

| Check key | Rule | Blocks an AI answer |
|---|---|---|
| `reconciles` | lines + tax = total, to the cent | yes |
| `ground_rules` | G1 … G5 | yes |
| `total_on_paper` | the total is the one printed in the totals block | yes |
| `subtotal_on_paper` | the lines add up to the printed SUBTOTAL | yes |
| `tax_on_paper` | the tax is the one printed | yes |
| `tax_missing` | no taxed line on the paper with a printed TAX of 0.00 | yes |
| `total_read_as_item` | no subtotal or total read as a line | yes |
| `payment_read_as_item` | no tender, card balance or change read as a line | yes |
| `items_sold` | the units equal the printed items-sold count | informs |
| `skus_present` | every product line has its item number (fees excepted) | informs |
| `date_on_paper` | the purchase date is the register's stamp, and not in the future | informs |
| `tax_possible` | the tax is within the province's rate on these lines | informs |
| `photo_quality` | the photo is straight, sharp and close enough | informs |

**The rule behind all of them: a figure is shown as printed only when the paper establishes it.** A figure that cannot
be placed is unread, never guessed, and never "the next line" (design rule 2, `Receipt_Parser_Design_Rules.md`).

## 4. "The paper establishes the total"

When the parser's printed total is below the lines, one of the two is wrong. Which one is decided by the paper:

- **Costco:** `establishPrintedFigures` (`shared/receiptPrintedFigures`) reads the final totals block: an amount beside
  its own label, the one assignment that closes (subtotal + tax = total), or as many amounts as labels. Established →
  the total stands, the **lines** are wrong, and the review's "lines don't add up" warning says so.
- **A store without a figures reader:** the amount is printed on a TOTAL row of the paper (`printedOnTotalRow`: not a
  subtotal, a tax or a count row).
- **Not established:** the total was never read (`totalUnread`). The review says so in words.

A new store that has its own totals reader adds one entry to `ESTABLISHERS` in `receiptPrintedTotalTrust.js`. It never
joins another store's entry.

## 5. C · Costco in depth

Costco's paper is the most complicated, so its rules are the most detailed. Each is defined once.

| Id | Rule | Defined in |
|---|---|---|
| **C1** | The receipt is seven sections: Header, Body, Void, Total, Payment, Summary, Footer. A boundary change goes into the sections module, never a regex in one consumer. | `segmentCostcoLines` |
| **C2** | The grand total is the `**** TOTAL` row (a bare `TOTAL` right after the block's own labels when the stars are lost). The TAX is the row before it. | `grandTotalRows`, `readTotalsSection` |
| **C3** | SUBTOTAL, TAX and TOTAL come from the **final** totals block only. A mid-receipt block (the cashier totalled twice) is never read. | `readTotalsSection` |
| **C4** | A short label run is zipped only when the counts match or the assignment closes. Otherwise the figure is null. `SOUS-TOTAL / TAKE / **** TOTAL / 7.45` (two labels read, one amount) reads **no** total. | `readTotalsSection` |
| **C5** | The one exception: a TOTAL row one digit off is the amount paid printed below the block, only when that amount is exactly the block's SUBTOTAL + TAX. | `readTotalsSection` (`bound.total = "payment"`) |
| **C6** | The items-sold count is read from both counters (summary and footer). Two that disagree are no count. The pre-scan count is never the items sold. | `readItemsSold` |
| **C7** | A fee line (deposit, eco fee) is never an item sold and needs no item number. | `shared/feeLines.js` |
| **C8** | A product line carries its item number (2 to 12 digits). | `shared/itemNumber.js` |
| **C9** | The purchase date is a register stamp (a date with its time of day), never a coupon's validity date. | `registerDates` |
| **C10** | The tax is at most the province's rate on the lines. | `shared/salesTax.js` |
| **C11** | A grouped line (several units at one price) is never split, except a weighed item printed at different prices. | `receiptAutoFix.splitGroupedSkus` |
| **C12** | Balancing corrects the lines to the printed figures. It never re-derives a printed tax or total from the lines. | `Receipt_Parser_Design_Rules.md` step 4 |

### The open Costco gap (RC-57)

The phone's parser still stamps `printedTotal` with the older reader (`receiptParsingShared.extractPrintedTotal`), which
borrows the next bare amount under a label-only `**** TOTAL`. That is a second reading of the paper, against C4. The
scan review no longer trusts it when it breaks G4 (§2), which closes the case that reached a shopper. Replacing the
older reader with `establishPrintedFigures` inside the parser is a change to the frozen Costco files and needs Maxim's
confirmation. It is recorded as the proposed parser change of RC-57.

## 6. What each screen shows

| Situation | Scan review | Receipt screen (shopper and admin) | Desk |
|---|---|---|---|
| Figures close | subtotal, tax, total | subtotal, tax, total | green when every check passes |
| Total read off the paper, lines do not add up | printed total locked; "The lines add up to X, but the receipt's total is Y" | the notice when G4 is broken | red (`reconciles`, and `ground_rules` when the total is below the lines) |
| Total not read (borrowed amount below the lines) | lines + tax; "We couldn't read the total on this receipt…" until the shopper types it | n/a (not stored as such) | red or amber (`total_on_paper`) |
| Stored before this rule with impossible figures | n/a | "The total and the items of this receipt don't match…" | red (`ground_rules`) |

Labels: `scan.totalNotRead`, `detail.figuresDontAddUp` (EN + FR). The desk's sentence for the check:
`adminAutoFix.CHECK_LABELS.ground_rules`.

## 7. Development rules (every change that reads, judges or shows a receipt)

1. **A new rule goes into its layer, once.** Any-store logic → `shared/receiptGroundRules.js`. Against the paper →
   `shared/receiptChecks.js`. Store layout → the store's own files. Never a comparison written in a screen, a route or
   a parser.
2. **A screen shows figures through the shared functions.** The subtotal is the sum of the lines. A notice about the
   figures comes from `receiptFiguresNotice`. The admin and the shopper see the same sentence.
3. **A parser or reader change is run on the corpus.** `__tests__/receiptGroundRules.corpus.test.js` puts every
   committed production capture, of every store, through parse → validate → settle and fails when the review would
   show impossible figures the paper does not establish. A new capture is judged with no entry to add.
4. **A new store** declares how its paper establishes a total (§4) when it has a totals reader, and its captures enter
   the corpus. `Adding_A_New_Store.md` checklist, "GROUND RULES".
5. **A new AI reader** needs nothing: its answer goes through `checkProposal`, which runs `ground_rules`.
6. **A rule is never loosened to pass one receipt.** A receipt that breaks a rule is a case for
   `Receipt_Parser_Root_Causes.md`.
7. **Changing a ground rule** changes `GROUND_RULES`, this table, and `receiptGroundRules.test.js` (which pins ids and
   codes) in the same PR. `backend/shared/` is the synced mirror (`sync-shared.js`).

The PR template carries one line for this: *Receipt ground rules*.

## 8. Old app builds

- The server change is additive: one more row (`ground_rules`) in the checks the admin desk receives. A desk build
  that does not know the key shows "Another safety check".
- The phone changes (the review notice, the receipt-screen notice, the total no longer locked) reach shoppers with the
  next build. Builds in the stores keep the old review: they can still save a borrowed total. The server then marks
  the receipt red for the desk; it does not refuse the upload (a new refusal on an old build is rule 3 of
  `Backend_Backward_Compatibility.md`).

## 9. Roadmap (open, in order)

1. **Replace the phone's `extractPrintedTotal` with the sections reader** (RC-57's proposed change). Needs Maxim's
   confirmation: frozen Costco files.
2. **Decide the refusal:** the quality check's `totals` and `balance` families are off in production
   (`RECEIPT_QUALITY_REFUSE_TOTALS`, `RECEIPT_QUALITY_REFUSE_BALANCE`). On, a receipt like k06zo is stopped at "Start
   tracking" with Edit, Rescan or Cancel. Maxim's switch.
3. **The three stored receipts that break G4** (§10): repair or reject, per the runbook.
4. **Server-side ground rules at upload** as a stored flag (not a refusal), so the desk can filter "impossible
   figures" without opening each receipt.
5. **Per-line rules** not yet in the catalogue: a coupon never larger than its item; unit price × quantity = line
   total when both are read.

## 10. Production on 2026-11-15 (SELECT only)

352 live receipts. G3 broken: 0. G5 broken: 0. G4 broken: 3.

| Receipt | Store | Lines | Tax | Total | Note |
|---|---|---|---|---|---|
| `r_1794697475248_k06zo` | Costco, Candiac #556 | 192.89 | 0.00 | 7.45 | RC-57. Not reviewed, not repaired. |
| `r_1794019452286_cj1k9` | Home Depot (mailbox import, 2026-11-07) | 119.96 | 7.80 | 67.78 | one of the locked-store imports of 2026-11-07 |
| `r_1793483582333_nomr1` | Costco | 117.43 | 6.44 | 77.88 | reviewed 2026-10-31, edited by the shopper 2026-11-12 |

Corpus (120 committed captures): no capture is shown with impossible figures. One capture has a borrowed total
cleared: `r_1787042691897_vdxrw`, whose re-OCR reads the TOTAL as `× 13.62` for 313.62.
