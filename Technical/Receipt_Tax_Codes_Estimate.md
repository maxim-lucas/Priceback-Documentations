# Receipt tax codes → a separate tax reader (plan)

**Status:** 🟡 plan, **not implemented**. Revised 2026-10-18 (was 🔵 parked the same morning, #161). Needs Maxim's
go-ahead: it is Costco code, and phase 2 touches the shared validator.
**What changed since #161:** the letters are lost *after* denoise, but the app still has them *before* denoise, in
the OCR it received. A separate reader can take them from there without touching the parser. A prototype run on the
committed corpus closes every readable, taxed Québec paper capture to the cent (§3).

## 1. The goal (Monica, 2026-10-18)

Use the tax letters to **reconcile and rebuild what a scan sometimes misses**: the tax, a total, or a price the photo
angle lost. The per-item tax estimate (the #161 idea) becomes a by-product, not the goal.

The receipt already gives three checks: Σ lines = SUBTOTAL, SUBTOTAL + TAX = TOTAL, and the items-sold count. The
tax rows add one more per tax (two in Quebec). They are the only check that knows **which tax class each amount
belongs to**, so they catch what the subtotal can't, such as a lost line hidden by an extra one, or a tax that was
made up.

## 2. What a Costco receipt prints (checked on the fixtures)

| Format | Item letters | Coupons carry the letter? | The receipt's own key |
|---|---|---|---|
| Québec paper | `FP` (TPS + TVQ), `F` (TPS), none (untaxed) | yes (`6,00-FP`) | `F=TPS P=TVQ FP=LES DEUX`; rows `P T.V.Q. 9.975% 6,72` and `F T.P.S. 5% 3,37` |
| Ontario paper | `H` (HST), `G` (GST), none | yes (`6.50- F`) | `H=HST G=GST`; row `(H) HST 13% 24.43` |
| Digital (app Orders view, website PDF) | `Y`/`N` (ON), `B`/`N` (QC) | **no**: `TPD/…` rows have no letter | `(A) HST …` or `(A) QST 21.33` + `(B) 5% GST 10.69`. In QC, `B` = GST + QST |

The **TAX is printed two or three times**: the `TAX`/`TAXE` row, the `TOTAL TAX(ES)` row, and the per-tax rows.
Costco rounds **once per tax, on the sum of the lines that carry it**. Every receipt that closes in §3 does so with
`round(rate × base)` per tax. Rates seen: TPS 5 %, TVQ 9.975 %, HST 13 %.

What goes wrong in the letters:
- **Misreads.** Vision reads `FP` as `FF` (Boisbriand c46, *ECOFRAIS), reads the `H` of a self-checkout print as `F`
  (Kanata #541: two photos of one receipt read the same lines as `H` and `F`), and reads `- F` as `A`.
- **Displaced letters.** The letter lands on the row above or below its amount (Pointe Claire `nhngb`: `FP` on
  CITROUILLE's SKU row; it belongs to FRITO TWIST), or on a row of its own (`PUREX FP` under `5,00 -`).

## 3. Prototype on the committed corpus (2026-10-18, Priceback `main` at `fe4b90a`)

A prototype reader runs on the **original** Vision words, before any denoise. It rebuilds rows with the repo's own
`reconstructRowsFromAnnotation`, reads every amount that is followed by a tax letter, and checks the result against
the receipt's printed tax rows. For digital receipts it borrows the parser's coupon links, because coupons there
carry no letter. The harness that runs the parser reproduces the golden snapshot on all 138 fixtures, so the parse
results it compares against are exactly what CI pins. Scripts: `receipt-tax-codes/prototype/` in the project's
shared files.

**A. Do the letters reproduce every printed tax to the cent?** (fixtures whose parse is right)

| Format | Captures | Close to the cent | Notes |
|---|---|---|---|
| Québec paper, taxed | 17 (16 receipts) | **17** | The faded, sideways and unreadable captures (not counted here) don't close, as they shouldn't: lines are missing. |
| Québec paper, zero tax | 5 | 5 | |
| Ontario paper | 18 (12 receipts) | 15 | Every receipt closes in at least one capture. The 3 misses are photos of one self-checkout receipt (Kanata #541) with misread letters. |
| Digital | 18 | 14 | The prototype matched letters to items by amount, not by row; 2 refunds aren't handled yet. |

**No false answer:** whenever the reader closes, its taxes equal the paper's, every time. When it can't close, it
says nothing.

**B. Receipts the parser gets wrong today.** On all 4 Québec captures marked `parser_gap` in
`receiptProdCaptures.test.js`, the reader reads the tax printed on the paper:

| Capture | Parse on `main` | Reader (= paper) | Cause |
|---|---|---|---|
| Brossard #521 `mebfs` c85 | 15.02 | **22.52** (TPS 7.52 + TVQ 15.00) | RC-5: the validator replaced the printed tax with TOTAL − lines |
| Brossard #521 `mebfs` c86 | 37.51 | **22.52** | RC-7 |
| Boisbriand `p2s1a` c87 | 4.99 (the TVQ row alone) | **7.49** (2.50 + 4.99) | wrong row read as TAX |
| `unlinked__c88` | none | **7.49** | TAX row not read |

The digital `parser_gap` receipt (Vaudreuil `r06sa`, coupons lost, RC-1/RC-2) does not close, which is the right
outcome: the parse is missing lines, and the check fails, so it gets flagged.

**C. A missed price (simulation on the 37 paper captures that close).** Each of 294 lines was removed in turn, letter
included, as if the photo angle lost it:
- **One price missed:** SUBTOTAL gives its exact amount. The printed taxes then confirm it and name its tax class
  in **290 of 294** cases. The other 4 were amounts too small to change a rounded tax. A correct rebuild was never
  rejected.
- **Two prices missed, only one row visible**, with both amounts put on that row (4,194 cases): the tax check
  rejects **exactly the 1,716 cases where the two lines are taxed differently**, and none of the rest. So the tax
  check alone is not enough. **The items-sold count must also be required**, since it catches the missing row.

## 4. What the reader may rebuild, and what it may not

| Missing or wrong | Rebuilt from | Allowed? |
|---|---|---|
| TAX not read, or misread (RC-5, O-3, `p2s1a`) | the printed per-tax rows / `TOTAL TAX(ES)`, when the letters close them | **Yes**: every number is printed on the paper |
| TOTAL or SUBTOTAL not read | the other two printed totals; the reader confirms the TAX | **Yes** (printed arithmetic) |
| One price lost to the photo | SUBTOTAL − the other lines (exact), adopted only when **all** agree: exactly one item row has no price, the items-sold count matches, the printed taxes close with exactly one tax class for it, and TOTAL RABAIS matches | **Yes, with conditions**: needs Maxim's change to design rule 5 (§7). Marked *rebuilt* and shown to the shopper to check |
| Two or more prices lost | the taxes only narrow it to a window: ±10 ¢ at 5 %, ±5 ¢ at 9.975 %, ±4 ¢ at 13 % | **No**: a window is not a price. Used only to pick between readings the parser already has (geometry vs flat, 1200 vs 2000 px, faint-print variants) |
| A coupon on the wrong item, or a price on the wrong item | the per-tax bases see it when the two items are taxed differently | **Flag only** |
| A printed total | — | **Never changed** (rule 5, RC-3) |
| A tax computed from rates with nothing printed to confirm it | — | **Never stored as printed** |

## 5. Design: a separate tax reader

- **Module:** `src/services/costcoTaxReader.js`, pure and Costco-only (the store owns its parsing; registry rule).
- **Input:** the OCR text and words **exactly as received**, plus the finished parse. Today
  `parseCostcoReceipt` overwrites `rawText` and the words with the localized versions
  (`costcoReceiptParser.js` ~line 1230, where FP → F happens), so the original must be kept in a variable before
  that. That is the only change in the parser file: no pattern and no denoise pass changes.
- **Steps:**
  1. Rows from the original words (`reconstructRowsFromAnnotation`, a pure function the parser already uses).
  2. Read the receipt's own key: the legend line, the per-tax rows with rate and amount, and every printed TAX copy.
  3. Lettered amounts: an amount followed by letters on the same row. On an `N @ unit` row, only the line total. A
     displaced letter goes to the nearest unlettered amount in the item block. Digital receipts: the letter is
     matched to the parsed item **by row/SKU**, and the item's coupons inherit it.
  4. Letters → tax classes per format. A misread (`FF`, a letter that isn't in the receipt's key) becomes a set of
     candidates that only the printed taxes can decide. **Exactly one solution, or no answer.**
  5. Verify each tax: `round(rate × base) = printed amount`, and Σ taxes = TAX.
  6. Compare with the parse: the parse's lines per tax class against the reader's bases. Findings: *tax read wrong*,
     *a taxed line or coupon is missing (amount, class)*, *a line is in the wrong class*.
- **Output** on the parse result: `taxCheck = { format, printed, bases, closes, perLine, findings }`.

## 6. Rollout: one PR per phase, each proven on the whole corpus (design rule 7)

| Phase | What it does | Changes what the shopper sees? | Proof required |
|---|---|---|---|
| P1 Shadow | module + tests; `taxCheck` is attached and nothing reads it | No | Golden snapshot **unchanged byte for byte** with `taxCheck` left out; a second snapshot pins `taxCheck` for every fixture |
| P2 Tax | when the reader closes, its printed TAX wins over a TAX the parse misread or the validator back-computed (`receiptValidator.js` lines 128–137, RC-5) | Yes: the tax | Corpus moves only toward `ok` (c85, c86, c87, c88); no `ok` capture changes. Shared validator → Maxim |
| P3 Flag | a parse whose lines don't match the reader's bases is flagged for the shopper | Flags only | No right parse gets flagged on the corpus |
| P4 Choose | tax agreement becomes a score in `chooseBetterParse`, the 1200/2000 px ladder and faint-print repair | Which candidate wins | Corpus moves only toward `ok` |
| P5 Rebuild | one lost price, under the §4 conditions | Yes: a *rebuilt* line | Design rule 5 amended by Maxim first; corpus + the §3 C simulation as a test |
| P6 Estimate | optional per-item tax (the #161 idea): nullable `receipt_items.tax_code` / `tax_estimate` | Yes, translated | Migration before the backend; old builds never send or read them |

## 7. Regression guards and rules

- **Nothing in the parser changes in P1**, except keeping the original input. The golden snapshot is the
  zero-regression proof.
- **Unique solution or nothing.** A hypothesis search (misread letters, displaced letters) is capped and adopted
  only when exactly one solution closes every printed tax.
- **Design rule 5 stays:** printed totals are never re-derived. P5 needs Maxim to add one sentence: *"a single
  missing line amount may be rebuilt when SUBTOTAL, every printed tax, the items-sold count and TOTAL RABAIS all
  agree on it; it is marked rebuilt and shown to the shopper."* Precedent: `faintPrintRepair.js` adopts a repair only
  when it lands on the printed totals.
- **Rebuilt prices never become crowd price points** until the shopper confirms them: price points feed price-drop
  alerts for everyone.
- **Old app builds:** the parser runs on the phone, so only the build that ships this gets it. No backend change
  until P6 (additive, optional, migration first). **No history:** `receipts.raw_ocr` stores QC `FP` as `F`, so old
  QC receipts can't be re-read. Recent ones can be, from `ocr_captures`, within its retention.
- **Labels:** any shopper text ("rebuilt from your receipt's totals, please check") goes through `t()` in en + fr.
  A raw code (`FP`, `H`) is never shown.
- **Not covered yet:** refunds (signs), BC/MB/SK (`GP`; no receipt in the corpus, and the parser drops `9.99 GP`
  lines today, §8), Maritimes HST rates.

## 8. Where the letters are lost today (unchanged from #161, plus `raw_ocr`)

| Step | Code | What happens to the letter |
|---|---|---|
| Localize | `shared/receiptLocale.js` · `collapseBothTaxesFlag` (#400, v3.0.5) | Quebec `FP` → `F` |
| Denoise | `costcoReceiptParser.js` · `normalizeStrayTaxFlags` (#413) | letters outside `[HPFRYNGB]` and doubled letters → `F` |
| Denoise | same file, column rebuild (`FLAG_ONLY`) | a letter on its own row is moved to a neighbouring price |
| Extract | `receiptParsingShared.js` · `tryExtractItem` | the one flag character is dropped; items are `{ name, price, sku }` |
| Store | `receipts.raw_ocr` | stored **after** the notation pass: QC `FP` is already `F` (`backend/lib/ocrCapture.js`) |

Side finding (still open): BC/MB/SK's two-letter `GP` matches neither rewrite, and the price patterns allow only one
letter, so a `9.99 GP` line is dropped. Check the first receipt from those provinces.

## 9. Corrections to the #161 version of this page

- #161's corpus count (§4) used `raw_ocr`, which had already turned `FP` into `F`. Quebec paper mostly prints `FP`
  (e.g. Boisbriand c47: 15 `FP`, 2 `F`).
- `A`/`B` are **digital-receipt tax buckets**, not a general marker: `(A) QST` / `(A) HST`, `(B) 5% GST`. In QC,
  `B` lines carry GST + QST (the 71 `B` lines #161 counted are digital receipts).
- Ontario's `F` lines are misreads of `H` on self-checkout prints.
- #161's step 1 (a sentinel in the text, or a parallel array) would have changed the denoise chain; it is replaced by
  the separate reader (§5).

## 10. Related

- `Technical/Receipt_Parser_Design_Rules.md`: step 5 already lists *tax bases* as a check; this implements it.
- `Technical/Receipt_Parser_Root_Causes.md`: RC-3, RC-5 (tax back-computed), RC-7, O-3.
- `Technical/Backend_Backward_Compatibility.md`: P6 columns.
- Roadmap: `Roadmap/FUTURE_ROADMAP.md` → *Per-item tax estimate from receipt tax codes*.
