# Costco — French (Quebec) receipts

**Parser:** `src/services/costcoReceiptParser.js` · **Locale:** `shared/receiptLocale.js`
· **Regression suite:** `__tests__/costcoReceiptParser.prodtext.test.js`

How the Costco parser reads a Quebec receipt, and the production OCR it is
pinned to. Store-neutral locale detection is described in
`../Document_Classification_And_Receipt_Locale.md` §2; this page is the Costco
part only.

---

## 1. The corpus: every Quebec receipt in production (2026-09-26)

Queried read-only from prod (`priceback.receipts.raw_ocr` + `header_ocr`) —
cleaned text, no card/member data — and committed as
`__tests__/fixtures/receipts-prod-text/*.txt`. No word geometry survives in the
database, so these exercise the **flat-text path** (the same path a PDF or
text upload takes).

| Fixture | Warehouse | Printed subtotal / total | Parse in prod (older builds) | Parse now |
|---|---|---|---|---|
| `costco-rimouski-1720-20260912.txt` | Rimouski #1720 | 182.68 / 202.74 | 7 lines, $4.80 deposit missing, $5 coupon not applied, total 202.94 | 8 lines, exact |
| `costco-anjou-1446-20260903.txt` | Anjou #1446 | 309.32 / 313.06 | dated **9 March** (all 24 items unwatched), 5 comma prices dropped, stray "21.99" item, 1 TPD skipped | 28 lines, exact, 3 Sept |
| `costco-laval-505-20260919-flat.txt` | Laval #505 | 200.89 / 220.50 | (fixed by #347) | 11 lines, exact |

"Exact" = items sum to the printed subtotal and the total is the printed one,
checked by hand against the receipt, not against the parser.

## 2. Two register layouts

**Older (Laval #505):** `SOUS-TOTAL`, `TAXE`, `TOTAL TAXES`, `NOMBRE D'ARTICLES
VENDUS`, `TOTAL RABAIS`, `T.P.S./T.V.Q.`, tax flags `F`/`P`/`FP`, dates `YYYY/MM/DD`.

**Newer (Rimouski #1720, Anjou #1446):** `Total Partiel`, `Taxes`, `TAXE TOTAL`,
`NOMBRE TOTAL D'ARTICLES VENDUS`, `ÉCONOMIES INSTANTANÉES`, `Puce lue`,
`À bientôt`, `CONSIGNE`, `*ECOFRAIS/…`, GST/QST labels in English, tax flags
`N`/`B`, and the transaction line `DD/MM/YYYY HH:MM <whse> …` — **day-first** —
with a `P7 MM/DD/YYYY` footer that is **month-first**.

The newer layout carried only one of the old French markers, so Anjou was read
as English and its decimal commas were never normalised.

## 3. What the parser does with a French receipt

In `parseCostcoReceipt`, step 0 (only when `detectReceiptLanguage` says `fr`):

1. **Notation** (`localizeReceiptOcr`): decimal commas → periods, `FP` → `F`.
2. **Layout** (`normalizeQuebecCostcoLayout`), four rewrites into shapes the
   existing handlers already read:

   | Printed | Rewritten | Guard |
   |---|---|---|
   | `CONSIGNE` / `9484` / `4.80` / `QC/4429252` | `9484 CONSIGNE QC/4429252 4.80` | needs an amount; the `N @ unit` line above is left in place so quantity applies |
   | `1839` / `*ECOFRAIS/2412712 0.64` | `1839 *ECOFRAIS/2412712 0.64` | only a bare 3–6 digit code directly above an ECOFRAIS line |
   | `2108361 TPD/1610330` / `3.00` | `… 3.00-` | amount stands alone; the next line is NOT a discount (that is a column-split block where the bare amount is an item price); the SKU is an item above priced higher |
   | `391362 PANTALON` / `5.00-` | `391362 TPD/1911337` | an item of exactly that name, under a different number, within 12 lines above, priced higher than the discount |

3. **Date** (`extractQuebecCostcoDate`, via `applyHeaderFieldsFromRawText`): the
   first slash date on a non-`P<n>` line is read day-first; a `P<n>` footer
   line is month-first and used only if nothing else is printed. A date that is
   not a valid, non-future day-first date returns `null` and the generic
   `extractDate` decides. Unambiguous forms (`19/09`, `2026/09/19`) never reach it.

Deposits and eco-fees stay on the receipt but are **ignored** (never watched,
no price points) — `isIgnoredItemName` matches `consigne` / `ecofrais`.

## 4. Zero-regression evidence

- **English receipts are byte-identical** by construction: steps 2–3 run only on
  French-detected text. Measured: the full existing corpus (56 fixtures ×
  geometry + flat = 112 parses) produces **0 changed parses** and **0 language
  flips** with the change.
- Every rule is mutation-checked: disabling any one of the nine guarded
  branches fails at least one test in `costcoReceiptParser.prodtext.test.js`.

## 5. Known limits

- Only three French receipts exist to learn from. The `ÉCONOMIES INSTANTANÉES`
  line is deliberately **not** used as a discount self-check: Anjou prints
  6.00 $ against 8.00 $ of TPDs that the printed subtotal proves were applied.
- A French receipt whose transaction line is cut off and which prints only a
  day-first date on some *other* non-footer line would still be read day-first —
  correct for every layout seen so far.
