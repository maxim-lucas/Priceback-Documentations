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
   and the check lines is noise — payment, approval, "retain this copy", tender, change, footer.
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

The photo only has to cover the receipt **from the top down to the TOTAL line**: the parser needs nothing below it
except the tax breakdown and the item count, which print right under it. In-app guidance and repair notices say so
(Maxim, 2026-10-13).

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

## 7. Gemini reads first (Maxim, 2026-10-21; Priceback #484, switches OFF at deploy)

Admin · **Receipt reading** (app, and the web console *Receipt reading* section) decides who reads a receipt first:

| Switch | What it does |
|---|---|
| **Gemini reads first** (`RECEIPT_GEMINI_FIRST`) | The app (build after 3.1.3) sends each Costco in-warehouse Vision scan to `POST /api/receipts/gemini-read`. Gemini reads the **OCR text** (never the photo) under these rules, with the parser's reading as its draft. Its lines are kept **only when the receipt proves them**: Σ lines = printed subtotal, subtotal + tax = printed total (`receiptAutoFix.checkProposal`). Otherwise the parser's lines stay. |
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
