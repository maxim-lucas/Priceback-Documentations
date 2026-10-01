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
| `costco-anjou-1446-20260903.txt` | Anjou #1446 | 309.32 / 313.06 | dated **9 March** (all 24 items unwatched), 5 comma prices dropped, stray "21.99" item, 1 TPD skipped, warehouse "60651" | 28 lines, exact, 3 Sept, whse 1446, bananas 2 @ 1.99 (27 units = printed 27) |
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

## 4b. Checked against the photos (2026-09-27)

The R2 originals settled two things the OCR alone could not:

- **The "21.99" under FILET SAUMON is `2 @ 1,99`** — the bananas' quantity line,
  its `@` dropped by Vision. It is NOT a per-kg price (the 2026-09-26 reading); the
  printed article count (27) only adds up with bananas × 2.
  `normalizeQuebecCostcoLayout` now rewrites a bare `Q`+`U.UU` line (Q = 2–9) to
  `Q @ U.UU` — **only** when Q × U is exactly the price of the next item, read from
  its own SKU+name line or from an amount line after its code/name line.
- **The warehouse is printed `ANJOU #1446`**, but OCR lost the `#`, and the tax
  footer `NL SSST #606515` then produced warehouse **60651**. `extractWarehouseId`
  now reads the register's `Entr[:] NNNN` line (Quebec's "whse:") and no longer
  accepts a `#NNNNN` that is the prefix of a longer number.
- Rimouski's R2 object is **not** a photo: it is a picture an older build drew of
  its own (wrong) parse (Bugs #285). Its fix rests on the OCR alone.

Production data was repaired to match — `Operations/Receipt_Data_Verification_Ledger.md`.

## 4c. Pointe Claire #528 — four more shapes (2026-09-30, app PR #382)

A new customer scanned two receipts twice each because the first parse was
visibly wrong. Both photos were read line by line; the OCR replayed through the
parser reproduced production's parse exactly. Fixtures:
`__tests__/fixtures/receipts-prod-text/costco-pointe-claire-528-2026092{3,6}.txt`.

| Printed | Problem | Fix |
|---|---|---|
| `0000392415/1323118` / `6.00-FP` | The `FP → F` collapse required the flag right after the amount; on a discount it follows the **minus**. The two-letter flag matched no discount pattern — both $6.00 savings vanished. | `QC_BOTH_TAXES_FLAG` accepts an optional `-` (`shared/receiptLocale.js`). |
| `1806358 DURACELL AA` / `25.99 F` / `2106265 RABAIS` / `6.00-FP` | A generic rebate names neither a SKU nor the item, so the handler skipped it. | Rewritten `2106265 TPD/<nearest item above>`; guard: the item costs more than the rebate. |
| `0000391998/2652709` (DAWN's coupon) / `2507482 TIDE` / `1335500 ENSEMBLE` / `3.00-FP` / `24.99 F` / `19.99 F` | A run of labels prints before its amounts. `reshapeColumnSplitTpdBlocks` re-zips that, but only recognized a discount label spelled `TPD/`, so the run broke. TIDE, ENSEMBLE and the PLAQUE vanished, and SUCRE BIO took a PLAQUE price. | Coupon ref → `<barcode> TPD/<sku>` when the SKU is an item above **and** the amount is NOT on the next line. The next-line shape already worked (Laval #505), and it stays byte-identical. |
| `ANNUL` / `1925368 PLAQUE` / `19.99-FP`, then `ANNUL` / `0000389094/1925368` / `5.00 F` | A void reprints the line sign-flipped (the coupon comes back **positive**). The English VOID handler would remove the whole merged qty-2 PLAQUE line, and nothing read the coupon reversal. | `cancelAnnulledLines` (after the re-zip) removes exactly the most recent line with the same SKU **and** amount, item or coupon. A void with no matching original is left as printed. |

Result: 09-23 → 15 lines = 257.94 / 272.18 (was 11 lines, 206.97); 09-26 → 7
lines = 161.02 / 171.11 (was both discounts lost, total overwritten to
183.11). Both close on the printed TOTAL RABAIS ($12.00) and article count.
Eight mutations (each fix and each guard), all killed.

## 5. Known limits

- **The word geometry of the Pointe Claire photos was never captured** (copying a
  customer photo into the fixture folder needs Maxim's hands). The fixes live on
  the flat-text candidate, which `chooseBetterParse` already scores against the
  printed self-checks. On device that candidate wins whenever it closes on the
  printed total. A geometry capture would confirm it rather than change it.
- Only a handful of French receipts exist to learn from. The `ÉCONOMIES INSTANTANÉES`
  line is deliberately **not** used as a discount self-check: Anjou prints
  6.00 $ against 8.00 $ of TPDs that the printed subtotal proves were applied.
- A French receipt whose transaction line is cut off and which prints only a
  day-first date on some *other* non-footer line would still be read day-first —
  correct for every layout seen so far.
