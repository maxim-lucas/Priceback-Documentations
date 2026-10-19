# Receipt tax codes → a separate tax reader (helper, product tax class and price check merged)

**Status:** ✅ merged. The helper is Priceback PR #455, merged 2026-10-18. Scope narrowed the same day by Monica
(§0): the reader only fills a tax the scan missed. The two database features she added (§11) merged on 2026-10-19:
"Check price in database" is PR #456 (`c8adff6`, migration `0028`) and the per-line tax class is PR #467
(`5065cde`, migration `0029`), each migration applied by hand to dev and prod before its merge (Monica's go-ahead,
2026-10-19). The server side is live; the app side of all three reaches phones with the next build.
**What changed since #161:** the letters are lost *after* denoise, but the app still has them *before* denoise, in
the OCR it received. A separate reader can take them from there without touching the parser. A prototype run on the
committed corpus closes every readable, taxed Québec paper capture to the cent (§3).

## 0. Decision 2026-10-18 (Monica): a helper for a missing tax, built

> "the parser should be only a helper to recalculate the tax if the tax is missing or detected as 0"

What Priceback #455 does:
- `src/services/costcoTaxReader.js` reads the codes and checks them against the printed taxes (§5, steps 1 to 5;
  no findings step). It runs **only when the parse has no tax** (missing, or 0). A tax the parse read is never
  replaced, and a 0 tax stays 0 when no line carries a tax code.
- The tax it fills is the printed tax the codes confirm. When no printed tax was read at all, it fills the tax the
  codes give on their own (`round(rate × base)` per tax, only when no code is in doubt), marked
  `taxCheck.filled = "computed"`. That one is calculated, not printed: it goes past §4's last row, at Monica's request.
- Input: the OCR **as received, before the compliance cleanup**, not just before localization as §5 said. On
  `p2s1a` the cleanup drops rows that carry items (RC-13), and with the cleaned text the reader can't close c87/c88.
  The scan pipeline passes the received OCR to the store parser as an optional third argument. Only numbers come
  out of it; nothing is shown or stored.
- Two refinements over the prototype: two readings that land on the same printed taxes count as one answer (Kanata
  c38 now closes on the paper's 24.43), and a receipt whose TAX row wasn't read closes when every tax matches its own
  printed row.

On the 138 fixtures, the reader closes on 56, gives no answer on 15 and finds no codes on 67. Whenever it closes on a
capture whose paper tax is known, it gives the paper's tax; that is now a test in `receiptProdCaptures.test.js`. The
golden snapshot changes on **one** fixture: `unlinked__c88`, tax none → 7.49 (the paper's).

Left as they are by the narrowing, because the parse read a tax: c85 and c86 (the validator back-computes 15.02 and
37.51 over the paper's 22.52, RC-5) and c87 (the TVQ row read as the tax, 4.99 instead of 7.49). The reader reads the
paper's tax on all three; using it there is P2 as first planned, if wanted later.

With §11 A on top, the reader also runs when the parse read a tax, but only to give each line its tax class: the
fill rule above is unchanged, and the class (one of four fixed codes) is the one thing besides a filled tax that
leaves the received OCR.

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

**After §0:** P1 is built (the reader, a corpus snapshot of what it reads; it runs only when the parse has no tax).
P2 is built in its narrowed form: it fills a missing or zero tax only. P3, P4 and P5 are parked by the decision. P6
is replaced by §11 A.

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
- Roadmap: `Roadmap/FUTURE_ROADMAP.md` → *Tax reader: fill a missing tax from receipt tax codes, product tax class, price check*.

## 11. Product tax class and "Check price in database" (Monica, 2026-10-18): merged 2026-10-19

### A. Save each line's tax class, so the database learns each product's tax per province

> "save the tax for every product … check the taxes in the database if its provincial, federal or both"

Priceback PR #467, merged 2026-10-19 (`5065cde`). Built on #455's reader and on top of B (#456), so its migration
`0029` follows B's `0028`.

- **Classes:** `both` (QC `FP`, ON `H`, digital `B`/`Y`: federal and provincial, or HST), `federal` (QC `F`,
  ON `G`), `provincial` (QC `P`), `none` (a bare amount, digital `N`).
- **Source:** the reader's reading, only when it closes with a single set of lines (§0), every code read without
  doubt (one reading each), and never on a refund. Kanata #541 shows why misread codes are out: with nine `H` read
  as `F` and two coupons read without their minus, the reading that closes on the printed HST leaves GAIN LIQUID
  untaxed. Right for the tax, wrong for a line.
- **Every Costco scan, at little cost:** the reader now runs on every warehouse receipt. When the parse read a tax,
  only the classes are at stake, so it reads the rows as they lie, without the skew correction that cost up to half
  a second on a tilted photo (Node). On the corpus, 32 of the 36 receipts that get classes keep them, never a
  different class, in a tenth of the time (0.4 s against 4.6 s for the 36). A missing tax is read exactly as in #455.
- **Line → item, changed from the plan:** an item takes a class only from a row that prints **its own item number**
  (the only one on the row), its full price (before coupons) and the code, or the price bare (untaxed). Never by
  price alone: Boisbriand #546's first pass (c87) pairs item numbers with their neighbours' prices (HUITRE FUMES at
  OLIVE HUMMUS's 12.49) and still adds up to its total, and Laval #505's photo prints each price beside the next
  item's number. Matching by price would have filed those classes under the wrong products. Also no class for an
  amount under 20¢ (at 5% it can hide in the rounding), a line without a SKU (eco fee, deposit), a row that names
  another item, two rows that disagree, or a parse that doesn't close to its printed total.
- **Corpus:** 37 receipts, 303 lines get a class (196 `none`, 104 `both`, 3 `federal`), pinned per fixture in
  `costcoTaxReader.corpus.test.js`. Against the price-only rule first planned: 275 the same, **0 different**, 46
  dropped (no SKU, shifted or merged rows, c87), 28 gained (two products at one price, which price-only refused).
  A product can differ by province, which is the point of keying by province: ORG PMPKN is HST in Gloucester (ON),
  CITROUILLE is TPS only in Pointe-Claire (QC). The parse is otherwise unchanged (golden snapshot: 138 pass).
- **App:** each item carries `taxClass` (`stampItemTaxClasses`), and `toApiBody` sends it when it is one of the four
  classes. A SKU the shopper types in the review drops the class: another SKU is another product.
- **Backend:** `POST /api/receipts` files an optional `items[].taxClass` in `receipt_items.tax_class_id` when the
  `tax_classes` table holds it. Anything else, and every older build, files NULL; a class never refuses a receipt.
- **Database:** migration `0029_receipt_item_tax_class`: lookup `tax_classes` (codes seeded by `db/seed.js`, RLS on)
  and a nullable `receipt_items.tax_class_id`. Additive, applied by hand to dev and prod (with its ledger row) on
  2026-10-19 before the merge, like `0027`. The server's boot seed fills the four codes.
  B's migration is `0028` (#456), so B merges first: drizzle applies migrations by timestamp.
- **Readers from day one (design rule 5):** Admin · Receipt detail shows each line's class ("Federal + provincial
  tax", "Federal tax only", "Provincial tax only", "Not taxed") and what the database has seen for that product in
  the receipt's province (its warehouse's), across every live receipt: "Seen in QC: Federal + provincial tax on 12
  lines · Not taxed on 1 line".
- **Not carried:** the admin line editor and *Fix automatically* rewrite lines without their class (it becomes
  NULL). The restore payload doesn't echo it: no screen on the phone reads it.
- **Old builds** send no `taxClass`; their lines stay NULL.
- **Later:** a product's known class in a province can estimate the tax of a receipt whose codes can't be read.

### B. "Check price in database" in the scan review

> "when a product is detected on a receipt (by sku) we can fill product name and price from the database based on
> the province … reviewed and flagged so the admin can check it"

Priceback PR #456, merged 2026-10-19 (`c8adff6`); migration `0028` applied to dev and prod before the merge.

- **Where:** a link-style button on each line that has a SKU, in the review step (`ScanScreen`), next to
  "+ Add discount". English "Check price in database", French "Vérifier le prix dans la base de données".
- **What it fills:** the price the database shows today for that SKU in the receipt's province (warehouse first,
  then the profile), through the existing `POST /api/check-price`, times the line's quantity. The regular price
  instead when only it closes the receipt's printed total (bought before the sale), and a line showing an instant
  saving keeps it. The name is filled only when the scan couldn't read it (empty, or "Item #SKU"); a printed name is
  never overwritten.
- **What the shopper sees:** a hint under the line, "Price from the database: check it against your receipt"
  (French "Prix tiré de la base de données : vérifiez-le sur votre reçu"). Typing a price clears it, like the
  guessed-quantity hint. When nothing is found: "No price in the database for this item" (French "Aucun prix dans la
  base de données pour cet article").
- **Flag for the admin:** the line is saved with `priceFromDatabase: true` (a new optional item field, stored in
  `receipt_items.price_from_database`, migration `0028`). The receipt desk gets a "Database prices" filter (a
  flagged line, receipt not reviewed yet), a home counter and a line chip, and "Mark reviewed" takes the receipt off
  the queue. Restore keeps the flag.
- **Price pool:** a flagged line never becomes a `receipt_ocr` price point or a `/api/watch` crowd observation. It
  came from the database, so it would only confirm itself (the same rule as §7 for rebuilt prices). The line is
  still watched for a drop.
- **Old builds:** no button and no field, so nothing changes for them.

Defaults picked until someone says otherwise: the price filled is today's price in the province, sale price
included, and a filled price stays out of the crowd price pool after "Mark reviewed". An admin who corrects the
lines in the line editor rewrites them as the desk's own: the flag drops and the price is filed like any repaired
line.
