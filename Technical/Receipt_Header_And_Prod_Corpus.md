# Receipt header block & the production-corpus method

**Since:** 2026-10-03 (`hotfix/header-ocr-no-item-fallback`, stacked on #398). Bug log: Operations #307.

## The header (`receipts.header_ocr`)

`src/services/receiptHeader.js → extractReceiptHeader(rawText)` returns `{ header, pattern }`. The header is the
printed block at the top of the receipt; it is found by its **lower boundary**, first match wins:

| # | Pattern | Boundary | Example |
|---|---|---|---|
| 1 | `member` | the membership line — the LAST header line on a Costco receipt; never included | `C8 Membre 112007644776`, `GL Hember 1119…` (misread) |
| 2 | `marker` | an item-table opener when there is no member line | `*** Bas du panier ***`, `Bottom of Basket`, `***DEBUT PRÉ-LECTURE***`, `START OF PRE-SCANNED`, `SELF-CHECKOUT` |
| 3 | `first_item` | the first item line — a price on it or directly under it (an address never has one) | `6 @ 10.99`, `1046334 CROISSANT / 6.99`, `TPD/…` |
| 4 | `identity` | none: the store-identifying lines above the totals block | rotated / merged photos |
| 5 | `null` | nothing identifies the store | faded/blank header, photo cropped below it |

The block is then filtered (no priced, item, noise, URL or delivery line; stops at a Shipping/Billing/Ship-to
block) and **trimmed to the span between the first and last store-identifying line** (store name incl. a clipped
`OLESALE`, `#NNN`, `whse`, `CITY 1446`, a street — a Title-Case number + words, or an ALL-CAPS street word —,
postal code, phone). A block with no identifying line is debris → `null`.

It reads the **pre-cleanup** OCR (cleanup deletes the member line). The header lines also leave `raw_ocr`.

Measured on 99 fixtures (Costco EN/FR paper, PDF exports, app screenshots, refunds, gas, Best Buy): `member` on
most paper receipts, `marker` on the Kanata self-checkout ones, `first_item` on PDFs and screenshots, `null` only
on the faded Pointe Claire receipt (and the refused US ones, which never reach it).

## The footer (`receipts.footer_ocr`)

**Since:** 2026-10-28 (`hotfix/receipt-total-fence-footer`, migration 0039). Maxim: *"the receipt total [**** Total
and the value] should be the last line detected on a receipt body (and save separately the items sold number as a
footer OCR so we can refer to and the purchase date)"*.

`src/services/receiptFooter.js → extractReceiptFooter(cleanedText, { itemsSold })` keeps, below the last
totals-block row, the register lines that state the receipt's check figures:

| Kind | Printed (EN / FR) |
|---|---|
| Items sold | `TOTAL NUMBER OF ITEMS SOLD = 13`, `Items Sold: 13` / `NOMBRE D'ARTICLES VENDUS= 2`, `Nombre d'art. 2` |
| Date stamp | `2026/10/26 17:08:06 540 205 284 705` (date, time, warehouse, terminal, transaction, operator), `K6 2026/10/26 17:08:05` |

- **The flat OCR, not the geometry rows.** The flat text's lines are the printed lines; a tilted footer's rows weld
  neighbours (`2026/10/02 TOTAL RABAIS 20:28:07 … 4,00 17`). A date stamp counts only when nothing but times and
  register numbers follow the date.
- **A count streamed away from its label** (`NOMBRE D'ARTICLES VENDUS-` … `2`, a column-split photo) gets back the
  count the parse read for it (`= 2`); a bare label is dropped when another line states the count.
- **Cleaned input**: no member number, card or cashier line reaches it. Capped at 500 characters.
- Sent as the optional `footerOcr` on `POST /api/receipts` (server cap 1000), echoed on restore like `headerOcr`,
  shown on Admin · Receipt detail (*Footer OCR*). NULL for every receipt before 3.2.1 and every older build.

Measured on the corpus: 104 of 143 captures have one; the 39 without are screenshots, PDFs, refunds and frames cut
above the footer. Pinned verbatim on 9 captures (`footer` in `GROUND_TRUTH`) and per fixture by digest in the golden
snapshot.

## The production-corpus method (standing rule)

Every receipt-parser problem starts by turning the production receipts not yet in fixtures into fixtures:

1. **Pull.** Today: list `receipts.image_object_key` (read-only SQL), download from R2 under `railway run`, then
   `npm run capture:receipts` into `__tests__/fixtures/receipts/prod-<date>/` (images are gitignored). Once
   PR #399 is live: `railway run -e production node scripts/exportOcrCaptures.js` — the **exact** Vision response,
   preferred (a re-OCR of the stored photo is a derivative and reads differently).
2. **Scrub.** `npm run scrub:receipts -- --write prod-<date>`; confirm no member number, cashier name or card digits.
3. **Ground truth from the paper.** Add every capture to `GROUND_TRUTH` in `__tests__/receiptProdCaptures.test.js`
   (subtotal, tax, total, articles, date, warehouse, exact header). The suite fails on a capture without an entry.
   Statuses: `ok` · `faded` · `unreadable` · `ocr_damage` · `app_partial` · `unsupported`. A receipt no parser can
   balance must be **flagged** (confidence < 0.8), never presented as balanced.
4. **Tune against the whole corpus**, comparing every fixture before/after (items, totals, printed total, tax,
   date, warehouse, header). A change that moves any other fixture is a regression until proven otherwise.
5. **Pin each fix in isolation** (`costcoReceiptProdShapes.test.js`: the shape, its rewrite, its look-alikes) and
   mutation-check: the new suites must go red against the old sources.

Pitfalls met on 2026-10-03: hand-corrected text fixtures hide geometry-path failures; a prod receipt's stored image
can be a PriceBack-generated document ("Generated by PriceBack") — not a fixture; flat text and geometry disagree,
so always test with the word geometry the app uses.
