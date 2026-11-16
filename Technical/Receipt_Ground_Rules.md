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

### The total shown: never blank (Maxim, 2026-11-16)

> *"the total should never be blank on scan or on tracking, should be the parsed total (if it makes sense), if
> misparsed or unfound on parsing, the total of parsed items should be the fallback, 3rd fallback on scrambled results
> is blank."*

One function, `receiptTotalToShow({ items, total, tax, isRefund })` in `shared/receiptGroundRules.js`:

| Step | Source | When |
|---|---|---|
| 1 | `read`: the total read | it is a number, not zero, and breaks no figure rule (G3, G4, G5) against the lines and the tax |
| 2 | `lines`: the sum of the lines, plus the tax when the tax makes sense (its sign agrees, not above the lines) | step 1 failed and the lines are readable |
| 3 | blank (`null`) | scrambled: no line, a line without a usable amount or quantity (G1/G2), or lines that sum to nothing |

Callers: the scan review (`settlePrintedTotal` and `ScanScreen.applyScannedData`), both receipt screens
(`receiptReviewTotals.receiptShownTotal` / `formatShownTotal`, "—" when blank) and the yearly spending sum
(`receiptSpending.spentInYear`). At scan only, a printed total below the lines that the paper establishes (§4) is kept
before the chain is asked: the lines are then the wrong side.

### What each consumer does with them

| Consumer | Policy when a ground rule is broken |
|---|---|
| **Scan review (phone)** · `receiptPrintedTotalTrust.settlePrintedTotal`, called by `receiptParser.scanReceipt` after the validator | A printed total that breaks a figure rule is kept only when it breaks G4 alone and the paper establishes it (§4). Otherwise the chain above: the lines' sum with `scan.totalNotRead`, or blank with `scan.totalScrambled`; the shopper checks or types the paper's total. |
| **Receipt screens** (shopper `DetailScreen`, admin `AdminReceiptDetailScreen`) · `receiptReviewTotals.receiptShownTotal` + `receiptFiguresNotice` | G3, G4, G5 on a stored receipt: the total shown is the chain's, and both screens show the same sentence under it (`detail.figuresDontAddUp`: the total read didn't match its items, so the total shown is their sum). One function for both. |
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

### The Costco printed total: both readers, measured (RC-57, 2026-11-16)

Maxim: *"if the older total is more accurate we go with it, if we can optimize the actual version and get better
results than the actual and the older ones, please optimize."* Scored on the 93 Costco production captures with a
hand-read total (`receiptProdCaptures.test.js` ground truth):

| Reader | Right | Wrong | Unread |
|---|---|---|---|
| The parser's own (`extractPrintedTotal` on the flat text and the geometry rows, arithmetic tie-break) | 91 | 0 | 2 |
| The sections reader alone (`establishPrintedFigures`, source `paper`) | 90 | 0 | 3 |
| **Combined (shipped)**: the sections reader fills an unread total; on a disagreement the one the parse's arithmetic confirms wins, else the paper's | **92** | **0** | **1** |

They miss different captures, so neither replaces the other. `costcoReceiptParser.applyHeaderFieldsFromRawText`
combines them; the frozen-file hash was re-pinned with this evidence. Outside the scored set the golden snapshot moved
on three captures, all to the paper's total (`8y5tt` c44 173.04 → 573.04; c45 and `be1p8` c66 unread → read). The one
still unread (`be1p8` c65) prints no readable total in either reader. A borrowed amount like k06zo's 7.45 is still
possible when neither reader establishes a total; the scan review then refuses it (§2). `receiptProdCaptures.test.js`
pins: never a wrong printed total, at most one unread.

## 6. What each screen shows

| Situation | Scan review | Receipt screen (shopper and admin) | Desk |
|---|---|---|---|
| Figures close | subtotal, tax, total | subtotal, tax, total | green when every check passes |
| Total read off the paper, lines do not add up | printed total locked; "The lines add up to X, but the receipt's total is Y" | the notice when G4 is broken | red (`reconciles`, and `ground_rules` when the total is below the lines) |
| Total not read (borrowed amount below the lines, or none) | the lines' sum + tax; "We couldn't read the total on this receipt, so this is the sum of the lines…" | the lines' sum + tax | red or amber (`total_on_paper`) |
| Scrambled (no line, or a line without an amount) | blank; "We couldn't read the amounts on this receipt…" (`scan.totalScrambled`) | "—" | red |
| Stored with impossible figures | n/a | the lines' sum + tax, and "The total read on this receipt didn't match its items, so the total shown is the sum of the items…" | red (`ground_rules`) |

Labels: `scan.totalNotRead`, `detail.figuresDontAddUp` (EN + FR). The desk's sentence for the check:
`adminAutoFix.CHECK_LABELS.ground_rules`.

## 7. Development rules (every change that reads, judges or shows a receipt)

1. **A new rule goes into its layer, once.** Any-store logic → `shared/receiptGroundRules.js`. Against the paper →
   `shared/receiptChecks.js`. Store layout → the store's own files. Never a comparison written in a screen, a route or
   a parser.
2. **A screen shows figures through the shared functions.** The subtotal is the sum of the lines; the total is
   `receiptTotalToShow` (never re-derived in a screen). A notice about the
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

1. ~~Replace the phone's `extractPrintedTotal` with the sections reader~~ — done differently, 2026-11-16: both readers
   combined (§5), because each is right where the other is unread.
2. **The refusal stays off until the behaviour is at its maximum (Maxim, 2026-11-16, a standing rule for every
   automation):** *"i will turn the refusal (on the admin desk) when i can be sure that the actual behavior is at his
   maximum possible optimization."* The quality check's `totals` and `balance` families
   (`RECEIPT_QUALITY_REFUSE_TOTALS`, `RECEIPT_QUALITY_REFUSE_BALANCE`) stay off; report the corpus scorecard (§5) and
   the production G4 count (§10) with each optimization. The switch is Maxim's.
3. ~~The three stored receipts that break G4~~ — two repaired, one to reject (§10).
4. **Server-side ground rules at upload** as a stored flag (not a refusal), so the desk can filter "impossible
   figures" without opening each receipt.
5. **Per-line rules** not yet in the catalogue: a coupon never larger than its item; unit price × quantity = line
   total when both are read.
6. **The 2026-11-07 mailbox-import junk** (Bugs #368): ten more receipts of the same import (store Costco, Sport Chek,
   Best Buy; total 0.00, one line each) are still live. Under the never-blank rule they show their one line's sum as
   the total. Reject them on the desk with the fitting reason.

## 10. Production on 2026-11-15 (SELECT only)

352 live receipts. G3 broken: 0. G5 broken: 0. G4 broken: 3.

| Receipt | Store | Lines | Tax | Total | Note |
|---|---|---|---|---|---|
| `r_1794697475248_k06zo` | Costco, Candiac #556 | 192.89 | 0.00 | 7.45 | RC-57. **Repaired 2026-11-16** from the photo: 21 lines, 265.94 + 0.00 = 265.94. |
| `r_1794019452286_cj1k9` | Home Depot (mailbox import, 2026-11-07) | 119.96 | 7.80 | 67.78 | not a receipt: two "EACH" lines from an email body. **To reject** on the desk (*Store not supported yet*); the scripted reject was stopped by the session's safety check. |
| `r_1793483582333_nomr1` | Costco, Rimouski #1720 | 117.43 | 6.44 | 77.88 | a line added by hand on 2026-11-12, not on the paper. **Repaired 2026-11-16**: 6 lines, 71.44 + 6.44 = 77.88. |

Corpus (120 committed captures): no capture is shown with impossible figures. One capture has a borrowed total
cleared: `r_1787042691897_vdxrw`, whose re-OCR reads the TOTAL as `× 13.62` for 313.62.
