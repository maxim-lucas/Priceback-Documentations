# Receipt parser — design rules (denoise first, then extract)

> **Standing rule (Maxim, 2026-10-13). Every parser change, for every store, respects this page.**
>
> *"Clean all the noise (French or English) from the receipt first, then keep only the information related to the
> parser: warehouse, items, taxes, subtotal and total. Any remaining data should be cleaned (payment info, validation
> section, …). This gets the parser to focus only on valid text after the noise has been removed. I don't want to
> treat case by case: same structure, same logic. Some special cases are treated, like the image tilt, quality, …
> but if we have these rules in place we should get a good parser."*
>
> Related: `Technical/Receipt_Parser_Root_Causes.md` (what went wrong, case by case — the *input* to this design,
> never the design itself), `Technical/Receipt_Parser_Registry_And_Store_Parsers.md` (one parser per store),
> `Technical/Adding_A_New_Store.md`, `Technical/Receipt_Photo_Quality_Gate.md`.

---

## 1. Why

The root-cause register (RC-1 … RC-14 in four days, October 2026) is mostly one failure seen from different sides:
**text that is not an item, a tax or a total reached the item extractor**, and the extractor was then patched to
survive that one shape:

| Noise that reached extraction | What it did | Case |
|---|---|---|
| Pre-scan banner `***DEBUT PRÉ-LECTURE ARTICLES***` | welded onto the first item's name, then into the product catalogue | `eql4t` (3.0.5) |
| The member-number line | fused with the first item's SKU (`176.111854336482`) | `7yckq` |
| `IMPORTANT - conserver cette copie` footer | its lone `-` read as a refund minus on the TOTAL | `3mq8x` (RC-4) |
| A tender line (`Comptant`) and the stamp | ended the totals block early | `8y5tt` |
| A mid-receipt `SOUS-TOTAL / TAXE / TOTAL / Comptant 0,00` block | stopped item extraction at the first total | `mebfs`, `p2s1a` (RC-7) |
| `**KS TOWEL**` asterisks | the item read as banner noise → "Unknown item" | `szw1y` (3.0.6) |
| `Compte bas du panier` / `Bottom of Basket` / `BOB Count` | coupon dropped with the row it was welded to | `4qp2s` (RC-13: the French `Compte` only, which trips the `account` noise rule; `p2s1a` proof owed) |
| Payment block amounts (`MONTANT`, `AMOUNT`, card lines) | the payment stored as an item | `8y5tt`, `be1p8` |

Every one of these was fixed as its own special case. The rule replaces that with **one pipeline**: the noise never
reaches extraction, so extraction never has to know about it.

## 2. The pipeline — in this order, for every store

```
 OCR (text + word geometry)
   │
   ├─ 0. GEOMETRY      deskew / rows (tilt, curl, fold) ............ image problem, not a text problem
   │
   ├─ 1. IDENTIFY      store → language → read the IDENTITY fields: warehouse #, purchase date
   │                   (from wherever the store prints them: header, register footer)
   │
   ├─ 2. DENOISE       remove EVERYTHING that is not  item block + totals block,  EN and FR alike:
   │                   header/address/phone, member line, banners (pre-scan, self-checkout, bottom of
   │                   basket, BOB count, VOID marker handled as data — see §4), payment & card block,
   │                   approval/validation section, "retain this copy", tender/change, rounding,
   │                   courtesy & membership footers, barcodes, operator/terminal lines
   │
   ├─ 3. KEEP          what is left is ONLY:
   │                     • item block   — item lines, coupon/TPD lines, fee lines (eco fee, deposit)
   │                     • totals block — SUBTOTAL, TAX line(s) (incl. the per-tax breakdown), TOTAL
   │                     • check lines  — items-sold count, total savings (read for VERIFICATION only)
   │
   ├─ 4. EXTRACT       items + coupons + fees from the item block; subtotal / tax / total from the
   │                   totals block. Nothing else is ever an item.
   │
   └─ 5. VERIFY        Σ lines = SUBTOTAL, SUBTOTAL + TAX = TOTAL, items sold, savings, tax bases.
                       A receipt that does not close is FLAGGED for the shopper — never balanced by
                       inventing a tax or a total (RC-3, RC-5).
```

Identity (step 1) is read **before** denoising because the warehouse number and the date sit in the header and the
register footer, which step 2 removes. The register footer is the authority for the warehouse (RC-10).

**After the parser, on save — the catalogue check (2026-10-27, `Technical/Product-Catalog-Harvest.md`).** The parser
is not changed by it: an item number the parser extracted that no catalogue lists is checked on the server against the
weekly Costco catalogue (`lib/receiptCatalogMatch`). Only a number one edit away whose printed text — or catalogue name
at an agreeing price — names it is taken, never across a size; the line keeps the number read (`sku_read`) and its
printed name. Prices and totals are never touched, so step 5's verification is unaffected. A change to the matcher is
proven on the whole corpus like a parser change: `scripts/harvest-catalog.mjs --corpus`.

## 2a. The receipt's seven sections (Maxim, 2026-10-29)

> *"It would be better if the parser can divide the receipt into section directly then treat each one alone but it
> should consider the tilt and any other bad influence on the receipt. Sections should be (Header, Body, Void, Total,
> Payment, Summary and footer)."*

`shared/costcoReceiptSections.js` (`segmentCostcoLines`) divides a Costco receipt — the phone's geometry rows (tilt and
curl already straightened, RC-12) or the flat text stored as `receipts.raw_ocr` — into:

| Section | What it holds | Where it ends | Read by |
|---|---|---|---|
| **Header** | store, address, member line | the first item row (an item number + an all-caps name) or a pre-scan banner | identity (`receiptHeader`) |
| **Body** | item rows, coupons (TPD, `/MULTIPLE`), fees, `N @ unit`, interim totals blocks (RC-7) | the FINAL totals block | item extraction |
| **Void** | `VOID` / `ANNUL` (incl. `'OID`) + the line it cancels — data, inside the body | — | item extraction |
| **Total** | the final `SUBTOTAL` / `TAX` / `**** TOTAL` and their amounts | past the amounts a column split streams below the TOTAL label | the printed figures (RC-35) |
| **Payment** | card, approval, `AMOUNT` / `MONTANT`, tender, change, Shop Card | the summary's first line | nothing (noise) |
| **Summary** | tax breakdown, `TOTAL TAX` / `TAXE TOTAL`, `TOTAL NUMBER OF ITEMS SOLD`, savings | the footer | the summary items-sold counter (RC-36) |
| **Footer** | the date stamp, `Items Sold: N` / `Nombre d'art. N`, the register line, thanks | the end | the footer counter (RC-36), the purchase date, `receipts.footer_ocr` |

**Anchors (EN + FR).** The grand total is the `**** TOTAL` row — or a bare `TOTAL` right after the block's own labels
when the stars are lost (RC-30; Quebec `Total Partiel / Taxes / TOTAL`) — and the **TAX is the row before it** (Maxim:
*"The grand total has always a suffix '**** TOTAL', Tax is always the line before"*). The LAST grand-total row is the
final block (an interim block is followed by more items). A `TOTAL` after a grand-total row is never a new block.

**What uses the sections today (2026-10-29).** Every reading of the printed figures and of the items-sold count —
the parser's self-checks and unit cap, the receipt quality check, the desk's reading confidence and every Gemini proof
(rule 11) — and the parser's item fence (`costcoItemBlockEnd`: the body ends at the sections' grand-total row; the
fence stays at that row, not at the `SUBTOTAL` label, because a column split streams the last coupon's amount between
the labels). **Not yet, and why** (each step was measured on the corpus and not taken):

- the footer OCR from the sections: a date stamp streamed between `**** TOTAL` and its amount belongs to the Total
  section, and 10 captures lost their footer — the footer keeps "everything after the last totals row";
- the parser's own printed total from the sections: on a parser-gap receipt the right total lets the validator book
  the lost lines as tax (RC-5: `be1p8` c66 would store tax 0.29 for 17.34) — it waits for RC-5's fix;
- feeding extraction only Body + Void + Total: the item fence and the header strip already bound it.

**Tilt before OCR.** The high-res second OCR pass (run only when the first parse is not fully confident) turns a photo
measured at ≥ 2° of tilt straight before reading it again (`straightenFor`, `measurePhoto().tiltSignedDeg`); the
better parse is adopted as before. Curl and fold stay in the geometry (RC-12).

## 3. Rules

1. **Same structure, same logic.** A new receipt shape is handled by adding its noise to the noise vocabulary
   (step 2) or its layout to the store's block boundaries (step 3) — **not** by a new branch inside extraction.
   A fix that teaches the extractor to step around one kind of junk is the wrong fix.
2. **Noise is vocabulary, per store and per language.** English and French register wording lives in the store's
   own noise list (`costcoReceiptNoise.fr.js` for Costco Québec, `shared/ocrCleanup.js` for the generic English
   list). A new language adds its list; extraction does not change.
3. **Remove noise at line/row level, before extraction — not out of names afterwards.** Scrubbing banner words out of
   item *names* after the parse (`stampIgnoredItems`, `tidyCostcoItemName`) is a backstop; every time it fires, the
   noise reached extraction and step 2 has a gap to close.
4. **Only the item block and the totals block are parsed.** Everything after the TOTAL line except the tax breakdown
   and the check lines is noise — payment, approval, "retain this copy", tender, change, footer. **The receipt body
   ends at `**** TOTAL` and its value** (Maxim, 2026-10-27): the Costco item block ends at the last grand-total row,
   its amount read or not, or at the first footer check line (`costcoItemBlockEnd`, RC-34). The register footer's
   items-sold count and date stamp are kept apart as `receipts.footer_ocr` (`src/services/receiptFooter.js`).
5. **The printed totals are the truth.** The printed SUBTOTAL / TAX / TOTAL are never re-derived from the lines. A
   mismatch is a flag, not a correction.
6. **Special cases are image problems only.** Tilt, curl, fold, zoom, faint print, OCR digit damage — handled in
   step 0 (geometry) or by the photo-quality gate, never by text rules aimed at one receipt.
7. **Prove it on the corpus.** A parser change is measured on every committed production capture
   (`receiptProdCaptures.test.js`, `receiptFixtureFidelity.test.js`), not on the receipt that prompted it. Moving a
   `parser_gap` to `ok` is the goal; turning an `ok` into anything else is a regression.
8. **Per-store isolation still holds.** Steps 1–5 are the same *shape* for every store; each store owns its own noise
   list and block boundaries (`Technical/Receipt_Parser_Registry_And_Store_Parsers.md`). Shared code changes need
   Maxim's confirmation (Costco is on the shared path).
9. **Two lines of one SKU with different values are never one line (Maxim, 2026-10-21; Priceback #482).** Only a
   *single unit* folds into a line of the same SKU, and only at the same unit paid, the same pre-coupon price and the
   same fee flag. A unit with a coupon and one without, two packs at different prices, or a multi-unit line stay
   separate lines. A line already folded from units that did not all get the coupon is split back
   (`splitMixedValueLines`). The rule is the same in the parser (`receiptParsingShared.pushOrMergeItem`), in what
   Gemini's answers are grouped by (`receiptLlmRules.groupSameUnitPrice`), in both prompts, in *Fix automatically*'s
   line matching (`diffLines`, `history_kept`: SKU **and amount**), and in where a drop chip lands
   (`checkAllPriceDrops` → `lineIndex`).
10. **Every printed figure is read from its own section (Maxim, 2026-10-29; RC-35, RC-36).** The SUBTOTAL / TAX /
    TOTAL from the final Total section only (§2a): the `**** TOTAL` row is the total, the row before it the TAX. An
    amount is a label's when it prints on the label's row; bare amounts are assigned only when there are as many as
    labels (in order) or when exactly one order-kept assignment closes. **A failed zip is never re-tried one label
    later, and a figure that cannot be placed is unread — never guessed.** Damaged shapes are read only when the block
    then closes (Priceback #515, from the prod comparison of 2026-10-30): a starred price line (`* 24.79 F`) does not
    end the block; an amount whose decimal point OCR lost (`5725`) or read as a space (`153 71`) counts only in a
    closing assignment, never zipped; the three totals printed just ABOVE the labels (past at most one item or coupon
    line) count only when they close with a tax at most 20 % of the subtotal. The items-sold count comes from BOTH
    counters (summary and footer); a count printed beside its label beats a scanned one; two printed counts that
    disagree are no count; the pre-scan count is never the items sold. A count streamed away from its label is found
    by a scan that crosses only amounts, the summary's own labels and the register's date stamp, up to 10 lines (a
    Quebec summary prints it 7 lines down — #515); any other line ends it. Nothing reads a figure off "the whole text" or
    "the next line" again.
11. **One reading of the paper, one set of checks, three policies (Maxim, 2026-10-29; RC-37).** *"Reading confidence
    and quality check should use the same logic."* Every consumer reads the paper through
    `shared/receiptPrintedFigures` (`establishPrintedFigures`, `readItemsSold`) and runs the checks of
    `shared/receiptChecks` (`evaluateReading`). A consumer may change only its POLICY:

    | Check | Quality check (refuses in the app, per family switch) | Reading confidence (admin triage) | Gemini proof (Apply, Gemini-first, re-read, ocr-llm) |
    |---|---|---|---|
    | `items_sold` | mismatch refuses (`items_sold_mismatch`); **unread is accepted** (rules v2) | mismatch → red; unread or the counters disagree → amber | **informs only** (Maxim: *"Inform only"*) |
    | `reconciles`, `total_on_paper`, `subtotal_on_paper`, `tax_on_paper` | `totals_unread`, `lines_off_total` (10 %) | fail → red; unread → amber | a fail blocks |
    | `tax_missing`, `total_read_as_item`, `payment_read_as_item` | refuse (their family) | fail → red | a fail blocks |
    | `photo_quality` (when a capture was measured) | photo family | out of limits → amber | — |
    | `skus_on_paper`, `prices_on_paper`, `history_kept`, `grouping_kept` | — | fail → red | a fail blocks |

    **The difference between the two** (Maxim): the quality check will, on the long run, *refuse* a receipt in the
    shopper's app on criteria that are fixed; the reading confidence only says the receipt *needs an admin review or a
    Gemini fix* — it never refuses. Reading confidence levels: any fail → low (red); anything unverified → medium
    (amber); else high (green); "n of n" counts every check, the count included. A low or amber receipt is, for now,
    a badge only; once Maxim has validated the confidence, the server re-read will target non-green receipts and a
    *Needs review* desk queue will hold what Gemini cannot prove (Maxim, 2026-10-29: *"3 for now, when i validate the
    strength of the function will be one"*). A new check is added to `receiptChecks`, never to one consumer.
12. **A Gemini failure is said as what it is (2026-10-29).** Google's 429 / 500 / 503 are a busy Google, not a bad
    receipt: `lib/gemini` waits them out (RetryInfo / Retry-After, else 1.5 s then 4 s, up to 3 rounds, inside the
    caller's deadline) and the desk names each class (`OVERLOADED`, `QUOTA_EXCEEDED`, `TIMEOUT`, `EMPTY_ANSWER`,
    `NO_CREDIT`, `BAD_REQUEST`); a paid key paused for no credit is named on every refusal. "Gemini could not read
    this receipt" is reserved for the truly unknown. An empty or cut-off answer (MAX_TOKENS, blocked) moves to the
    next model. Every call logs one line (caller, refusals, tokens) — never a key or receipt text.
13. **Never retry Gemini on a check no answer can pass.** When Gemini and the stored reading agree and only the
    paper's own figure check fails, our reading of the paper is the odd one out: the desk stops after one try
    (`worthRetrying`). A chain must end inside the caller's own wait (`/api/ocr-llm`: 18 s for the phone's 20 s).

## 4. Edge cases that are data, not noise

| Printed | Treatment |
|---|---|
| `VOID` + the voided line (`359241 CHOCOLA MILK 11.99-`) | Data: cancels one earlier identical line. Kept for extraction, never dropped as a banner. |
| Coupon / TPD / `/MULTIPLE` lines | Item block: folded into the item they name. |
| Fee lines (`ECO FEE`, `*ECOFRAIS`, `DEPOSIT`, `CONSIGNE`) | Item block: part of the subtotal, never watched. |
| `N @ unit` quantity lines | Item block. |
| Mid-receipt totals block followed by more items (RC-7) | A block boundary decision (step 3), not an extraction stop. |
| Asterisk-wrapped names (`**KS TOWEL**`) | Item: a banner is a *phrase*, not "any line with asterisks". |

| Two scans of one SKU at different values (one couponed, one not; two packs at different weights) | Two lines (rule 9). Folding them made one product's price the average of two. |

## 5. What the shopper is told

The photo covers the receipt **from the very top down to the payment date and the number of items sold** (Maxim,
2026-10-27; it replaces 2026-10-13's "down to the TOTAL line"). Both print after the payment block, which therefore
stays in the photo: the items-sold count is what the receipt quality check compares the lines with
(`Technical/Receipt_Photo_Quality_Gate.md`), and the date stamp is the purchase date. The scan screen's *How to scan
a receipt* section and the admin *Reject receipt* push say so.

## 6. Status (2026-10-13)

The current Costco pipeline already has the pieces — `shared/ocrCleanup.cleanReceiptOcr` (step 2, partly),
`receiptHeader` (identity, get-then-strip), `dropIntermediateTotalsBlocks` (RC-7), the deskew (RC-12) — but noise
still reaches extraction (§1 table) and is scrubbed from names afterwards (rule 3). The rework planned for the next
days consolidates them into the order above. The open cases it must close are listed in
`Technical/Receipt_Parser_Root_Causes.md`, *Open cases*.

**Gemini follows the same rules (2026-10-21).** The server's two Gemini paths — the admin *Fix automatically* button and
`/api/ocr-llm` — read the OCR denoised with the parser's own vocabulary and their answers are cleaned and grouped by
the parser's rules (`backend/lib/receiptLlmRules.js`, Bugs #338). An LLM reads a receipt better than OCR + regex; it
must not read it differently.

**One reading of the paper (2026-10-29, rules 10–13, §2a).** The receipt's sections now exist
(`shared/costcoReceiptSections`) and every reading of its printed figures and items-sold count goes through them;
the quality check, the reading confidence and the Gemini proofs share one set of checks (`shared/receiptChecks`).
Measured on the corpus: no printed figure read wrong (16 / 14 before), the count read on 42 of 45 receipts on the
server (18 before).

## 7. Gemini reads first (Maxim, 2026-10-21; Priceback #484, switches OFF at deploy)

Admin · **Receipt reading** (app, and the web console *Receipt reading* section) decides who reads a receipt first:

| Switch | What it does |
|---|---|
| **Gemini reads first** (`RECEIPT_GEMINI_FIRST`) | The app (build after 3.1.3) sends each Costco in-warehouse Vision scan to `POST /api/receipts/gemini-read`. Gemini reads the **OCR text** (never the photo) under these rules, with the parser's reading as its draft. Its lines are kept **only when the receipt proves them**: Σ lines = printed subtotal, subtotal + tax = printed total (`receiptAutoFix.checkProposal`, the checks of rule 11 under the Gemini-proof policy). Otherwise the parser's lines stay. Builds after 3.3.0 also send the footer OCR (the second items-sold counter). |
| **Gemini re-reads** (`RECEIPT_GEMINI_REREAD`) | For every build: the server re-reads a receipt the phone did not let Gemini read, within 30 min of its upload, and applies a proven correction through the repair path (`badScanRepair` mode `reread`). Never on a receipt with a claim, a drop sent or in review, a shopper correction, a refund, a US receipt or an online order. The phone takes the corrected lines on its next sync. |

**The parser is the fallback, always.** It reads when a switch is off, when the day's Gemini budget is spent
(`LLM_GLOBAL_DAILY_LIMIT`, read live; `LLM_DAILY_LIMIT` per shopper; `LLM_REREAD_DAILY_LIMIT` for the re-read,
inside the global one), when Gemini is unavailable or fails, and whenever the paper does not prove Gemini's reading.
A limit of `0` turns Gemini off.

**Every receipt records its reader** (`receipts.reader_id`, migration 0032; admin receipt detail → *Read by*):
`parser`, `parser_checked` (Gemini read it, the paper did not prove it), `gemini`, `gemini_reread`. A wrong receipt is
replayed with the reader that produced it (`Technical/Receipt_Parser_Root_Causes.md`).

Rule 7 still applies: a Gemini-read receipt that does not close is a *parser* case for the corpus, and the weekly
review of Gemini-corrected receipts (admin desk, *Read by*: Gemini) is where a new noise shape or block boundary is
found and added to the parser.
