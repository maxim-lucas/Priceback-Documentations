# Receipt tax codes → per-item tax estimate (parked)

**Status:** 🔵 documented, **not implemented** — 2026-10-18.
**Why parked:** Maxim's condition was *"if these codes are cleaned up and we don't have access to them after
removing the noise, don't implement it, just document it."* They are: the parser rewrites them during denoise
(step 2 of `Receipt_Parser_Design_Rules.md`) and drops them during extraction (step 4). Nothing after the parse
can read them.

## 1. The goal

Costco Canada prints a tax letter after each line's price. Mapped against the province of the warehouse, the
letter says which taxes the line carries. With it, every line gets an **estimated tax amount**, so the app can
show what an item really cost and what tax goes with a price-adjustment refund. The printed `TAX` row stays the
truth: the per-line estimates must add up to it (rule 5, *the printed totals are the truth*). A receipt where
they don't add up keeps its printed tax and shows no estimate. It is never "corrected".

## 2. The codes (Maxim's table, 2026-10-18 — not yet checked against the corpus, see §4)

| Province | Code | Meaning | Rate |
|---|---|---|---|
| ON | `H` | HST | 13 % |
| ON | `G` | GST only (e.g. some books) | 5 % |
| ON | none | not taxed (basic groceries) | 0 % |
| NS | `H` | HST | 14 % |
| NB, PE, NL | `H` | HST | 15 % |
| QC | `FP` | GST + QST | 14.975 % (5 + 9.975) |
| QC | `F` | GST only | 5 % |
| QC | none | not taxed (most unprocessed food) | 0 % |
| BC | `GP` / `G` | GST + PST / GST only | 12 % (5 + 7) / 5 % |
| MB | `GP` / `G` | GST + PST / GST only | 12 % (5 + 7) / 5 % |
| SK | `GP` / `G` | GST + PST / GST only | 11 % (5 + 6) / 5 % |
| AB, NT, NU, YT | `G` / none | GST / not taxed | 5 % / 0 % |
| any | `A` | often printed as a general "taxable" marker | — |

Rates change, so they belong in a dated table (a `province_tax_rates` row or `app_config`), not in parser code.

## 3. Why the codes are not available after the noise is removed

Checked on `main` at `2aac992` (2026-10-18):

| Step | Code | What happens to the letter |
|---|---|---|
| 2. Denoise (localize) | `shared/receiptLocale.js` · `collapseBothTaxesFlag` (#400, first shipped in **v3.0.5**) | Quebec `FP` → `F`. **QC "GST + QST" and "GST only" become identical.** The comment says why: *"the flag is only ever evidence that a line carries a price … Tax comes from the printed TAXE row, never from these letters."* |
| 2. Denoise | `src/services/costcoReceiptParser.js` · `normalizeStrayTaxFlags` (#413) | Any letter outside `[HPFRYNGB]`, and doubled letters (`P F`, `H H`, `FF`), → `F`. `A` becomes `F`. |
| 2. Denoise | same file, column rebuild (`FLAG_ONLY`) | A letter Vision put on its own row gets attached to the price above it, or carried to the next one. That's good for parsing, but it means the letter's position isn't reliable. |
| 4. Extract | `src/services/receiptParsingShared.js` · `tryExtractItem`, `cleanItemName` | Every price pattern takes **one** flag character and throws it away. Items come out as `{ name, price, sku }`. |
| Store | `receipt_items` | No tax column. The flag is never saved. |

Side finding, recorded and not fixed: BC/MB/SK's two-letter `GP` matches neither `collapseBothTaxesFlag` (QC `FP`
only) nor `normalizeStrayTaxFlags` (`[FPH]{2}`). A line ending `9.99 GP` reaches extraction with a two-letter flag,
and the patterns allow only one. No warehouse in the prod corpus is in BC/MB/SK yet (§4). The first receipt from
those provinces should be checked for dropped lines before anything else.

## 4. What the prod corpus actually prints

`receipts.raw_ocr` (Vision's text before any cleanup) **does** keep the letters. A read-only count on prod
(`xjfrlzwonyaorwktnkpj`, 2026-10-18, live receipts) of every line ending in a price plus 1–2 capital letters:

| Warehouse province | Receipts | Letters seen (lines) |
|---|---|---|
| QC | 57 | `F` 203, `N` 165, `B` 71, `FP` 11, `FF` 3, `O` 2, `D` 1, `MC` 1 |
| ON | 28 | `H` 109, `F` 13, `N` 10, `Y` 2, `A` 2, `G` 1, `C` 1, `WE` 1 |
| unknown (online / no warehouse) | 11 | `E` 16, `N` 15, `Y` 4, `F` 4, `C` 2, `S` 2, `GS` 1, `B` 1 |

What this tells us, before anyone builds on the table in §2:

- **`N` / `Y` are the app's Orders view and the website PDF** (`costcoReceiptParser.js`: *"screenshotted from the
  app's Orders view (flags "N"/"Y")"*), not the paper codes. They need their own mapping (probably `Y` = taxed,
  `N` = not taxed, with no federal/provincial split).
- **Quebec prints `B` a lot (71 lines)**, and `B` isn't in the table. `FP` is rare (11), but Quebec receipts often
  print the letter on its own row (geometry), so this count misses those lines. Before trusting the QC mapping,
  compare a few real QC receipts' letters with their printed `TPS` / `TVQ` breakdown.
- Ontario `F` (13 lines) isn't in the table either. It may be a Vision misread of `H`, or a real code.
- One- or two-off letters (`O`, `D`, `MC`, `WE`, `C`, `S`) are OCR noise or name endings, not codes.

## 5. How to build it later (proposal, needs Maxim's go-ahead: Costco + shared parser)

1. **Keep the letter instead of collapsing it.** In step 2, carry the original flag on the line (e.g. a
   `\u0001FP` sentinel, or a parallel array keyed by row) before `collapseBothTaxesFlag` / `normalizeStrayTaxFlags`
   rewrite it. Extraction keeps returning `{ name, price, sku }` and adds `taxCode` (raw, nullable). The price
   patterns don't change, so parsing can't regress. Prove it on `receiptProdCaptures.test.js` /
   `receiptFixtureFidelity.test.js`: every item and total byte-identical, `taxCode` added.
2. **Map in one pure module**, `(province, receiptKind, taxCode) → { gst, pst, hst }` rates, with the dated rate
   table from §2. An unknown code → `null` (no estimate), never a guess.
3. **Verify against the printed totals.** Σ (line × rate) must match the printed `TAX` within rounding (Costco
   rounds per tax, not per line: allow ±1 ¢ per tax). Where Costco prints the per-tax breakdown (`TPS`/`TVQ`,
   `HST`), check each tax separately. Match → store the per-line estimate. No match → store nothing, keep the
   printed tax, and log the receipt for the corpus.
4. **Store additively:** a nullable `receipt_items.tax_code` (raw letter) and `tax_estimate` (numeric), plus a
   migration applied before the backend that writes them (expand → migrate → contract). Old builds never send
   them and never read them (rules 1–2 of `Backend_Backward_Compatibility.md`).
5. **Show it translated:** any label ("incl. ~$1.95 tax", "tax-free") goes through `t()` in every language, and the
   raw code (`FP`, `H`) is never shown (CLAUDE.md label rule 4).

**A cheaper first step** that needs no letters at all: the totals block already prints the tax breakdown
(`TPS 5 %` / `TVQ 9,975 %`, `HST 13 %`) with its base amounts. That gives the receipt-level split
(federal vs. provincial) without touching item extraction.

## 6. Related

- `Technical/Receipt_Parser_Design_Rules.md` — denoise → keep → extract → verify; this feature belongs in step 4/5.
- `Technical/Document_Classification_And_Receipt_Locale.md` — where `collapseBothTaxesFlag` lives (locale step).
- `Technical/Backend_Backward_Compatibility.md` — for the column + API additions.
- Roadmap entry: `Roadmap/FUTURE_ROADMAP.md` → *Other parked ideas* → *Per-item tax estimate from receipt tax codes*.
