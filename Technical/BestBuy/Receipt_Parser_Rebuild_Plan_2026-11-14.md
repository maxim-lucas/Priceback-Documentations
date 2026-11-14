# Best Buy — the admin's production scan of 2026-11, its root causes, and the parser rebuild plan

> **Status: PLAN, waiting for Maxim's approval (2026-11-14). No parser code has been changed.**
> Built against `Technical/Receipt_Parser_Specification.md` (the store-neutral specification, also a draft).
> Base branch chosen by Maxim: **`main`**.

## 1. What was reported

Maxim, 2026-11-14: *"when i scanned a best buy receipt (admin activated only now) in production the result is
really bad, no sku was catched, no product was detected, only the price and all items labels was scambled. the
receipt as for a samsung tv only and the parser didnt catch it."*

## 2. What was found in production (read-only)

The receipt was scanned **six times** by the admin account, on two days. None of the scans became a receipt
(`ocr_captures.receipt_id` is null on all six; why the scan was not saved was not established).

| Capture | When (UTC) | App | OCR pass | Words | Mean Vision confidence | Words under 0.8 |
|---|---|---|---|---|---|---|
| `c678` | 2026-11-07 00:10 | 3.5.0 | standard (1200 px) | 114 | 0.947 | 7 % |
| `c679` | 2026-11-07 00:10 | 3.5.0 | high-res (2000 px) | 114 | 0.958 | 3 % |
| `c773` | 2026-11-11 05:35 | 3.6.1 | standard | 134 | 0.765 | 49 % |
| `c774` | 2026-11-11 05:35 | 3.6.1 | high-res | 136 | 0.767 | 49 % |
| `c775` | 2026-11-11 05:35 | 3.6.1 | standard | 108 | 0.842 | 26 % |
| `c776` | 2026-11-11 05:35 | 3.6.1 | high-res | 106 | 0.856 | 26 % |

The two photos of 2026-11-07 are sharp. The two of 2026-11-11 came out of the document scanner heavily
black-and-white filtered: the small print is broken up (`Samsung` → `amsung`, `S-627` → `5.627`, `SUBTOTAL` →
`S6#FOTAL`).

**The paper** (Best Buy Orleans; it is the same receipt as the corpus's only in-store fixture,
`PXL_20260415_185052976.MP`):

| Field | Printed |
|---|---|
| Store, register, transaction | `S-627` `R-48` `T-306` |
| Purchase date | `BUS DATE-11/28/2025` (and `Delivery Date: 2025-12-05`, twice, which is not it) |
| Line 1 | `Samsung 85LS03FW PRO`, SKU `19204882`, `$3,699.99` |
| Line 2 | `TV Delivery`, `00003501`, `$0.00` (a service line: kept, never watched) |
| Item count | `1 Sale item(s)` |
| Subtotal / tax / total | `$3,699.99` / HST `13.00% of $3,699.99` = `$481.00` / `$4,180.99` |

## 3. What the parser does with each capture

Replayed on `main` at `c40b06ed` (v3.6.2) through `parseReceiptText`, with each capture's own text and word boxes.
(The Best Buy parser files are identical between v3.6.1 and `main`; 3.5.0 predates the in-store denoise step, so
for `c678`/`c679` this is what today's build does, not a replay of the build that ran.)

| Capture | Sent to | Items it returns | Date | Total / tax | Says it reconciles |
|---|---|---|---|---|---|
| `c678` | in-store | Samsung 85LS03FW PRO, `19204882`, 3,699.99 ✔ | **2025-12-05** ✘ | 4,180.99 / 481 ✔ | yes |
| `c679` | **online** ✘ | none | 2025-12-05 ✘ | 3,699.99 / — ✘ | no |
| `c773` | **online** ✘ | `Orleans` 5.62 · `S6#FOTAL` 3.69 ✘ | 2025-11-28 ✔ | 13 / — ✘ | no |
| `c774` | **online** ✘ | none | 2025-11-28 ✔ | 461 / 9.99 ✘ | no |
| `c775` | **online** ✘ | none | 2025-11-28 ✔ | 0.49 / — ✘ | no |
| `c776` | **online** ✘ | `TV Delivery` `00003501` 9.00 ✘ | 2025-11-28 ✔ | 13 / — ✘ | no |

**One capture of six reads the product, and none of the six is right on every field.** The `c773` row is what was
on the screen: a town name and a damaged label as the "products", no SKU, no television.

## 4. Root causes

Each was isolated by replay. "Forced in-store" below means calling `parseBestBuyInStoreReceipt` on the same cleaned
text and words, which removes only the routing decision.

### BB-RC-1 — The format is decided by one exactly-read letter (5 of 6 captures)

- **Printed:** the register header `S-627   R-48`, and `Delivery Date:` twice (a TV bought in store, delivered
  later).
- **Code:** `detectPurchaseType` (`src/services/receiptParsingShared.js`, the `storeId === "bestbuy"` branch).
  In-store needs `/s-\d+\s*r-\d+/` to match; otherwise `delivery\s*date` alone means *online*, with the comment
  "none of them can appear on a paper register receipt".
- **What Vision read:** `8-627 / R-48`, `5.627 / R 48`, `5 627 / R 48`, `5-627 / 8-48`, `5-627 / 8-48`. One wrong
  glyph and the slip is an online order.
- **Then:** the online parser, which reads a table that is not there, makes products out of whatever ends in
  digits: `5.627` → *Orleans, $5.62*; `$3.699.99` → *$3.69* (a period-for-comma amount cut at its prefix);
  `$9.00` under `TV Delivery`.
- **Proof:** restoring `S-627 R-48` in the text of each capture changes the routing to in-store on all five.
- **Not used, though printed on every capture:** `BUS DATE`, the `SALE` line, `T-306`, `1 Sale item(s)`,
  `SEND #`, the tender block. The slip has six markers; the decision reads one.
- This function is in a file frozen for Costco, so it cannot be the place of the fix.
- **Specification:** stage 4 and §4 rules 1, 2.

### BB-RC-2 — `BUS.DATE` with a period is not a purchase-date label (`c678`, `c679`)

- **Code:** `BB_PURCHASE_DATE_LABEL_RE` (`bestBuyReceiptParser.js`) accepts `bus date`, `business date`. Vision
  read `BUS.DATE-11/28/2025` and `BUS. DATE-11/28/2025`. No label matched, so the whole-document scan took the
  first date it could parse: the **delivery date**, a week later.
- **Effect:** the price-adjustment window is dated 7 days late.
- **Specification:** stage 6 (labelled date, glyph-tolerant; delivery dates named as not it).

### BB-RC-3 — A damaged totals label makes the denoise step fail open (forced in-store: `c773`, `c775`)

- **Code:** `segmentBestBuyInStoreLines` (`bestBuyReceiptSections.js`) finds the totals block by `SUBTOTAL` /
  `TOTAL` read exactly, and is documented as "fail-open when no totals block is found".
- **What Vision read:** `S6#FOTAL`, `SueraTAL`, `TAX MST`.
- **Forced in-store result:** `c773` returns two products, `amsung 851 503F # PRO` 3,699.39 and **`S6 # FOTAL`
  3,699.99**, total 7,860.38; `c775` returns `PRO` 3,699.99, `TV Delivery` 9.00 and **`Unknown item` 13.00** (the
  tax rate).
- **Specification:** stage 5 rules 1 to 3, §4 rule 3.

### BB-RC-4 — "Reconciled" with nothing to reconcile against (forced in-store: `c773` to `c776`)

- All four filtered captures report `reconciled: true` on a wrong reading: the printed total was not read, or was
  read as `461` (`c774`) or `4.18` (`c776`), and the lines were then compared with their own sum.
- **Effect:** a wrong reading scores as a good one, and the second pass that could have corrected it stands down.
- **Specification:** stage 9 (`unverified` is never `pass`), §4 rule 4.

### BB-RC-5 — The store number needs the same exactly-read `S` (5 of 6)

- `extractBestBuyStoreNumber` requires `S-n R-n` or `S-n`. `8-627` and `5-627` give no store.
- Not load-bearing for prices (Best Buy prices are national), but the same single-glyph dependency.

### BB-RC-6 — An identifier of the right shape that is not the product's (`c773` to `c775`)

- `19204882` was read as `(9704582` and `9204882`. The second is seven digits with a non-zero first digit: a
  **valid Best Buy SKU shape**, for another product or none. `00003501` (the delivery line's counter, which the
  shape rule exists to refuse) came out as the SKU of *TV Delivery* on `c776`, on both paths.
- Nothing checks that a SKU read off the paper is the product named on the same line.
- **Specification:** stage 12 (catalogue check), §4 rule 5.

### BB-RC-7 — An unreadable photo was parsed instead of refused (`c773` to `c776`)

- Half the words of `c773`/`c774` are under 0.8 confidence. `assessPrintQuality` stamps `printQuality.faint`, but
  for Best Buy nothing acts on it: the parse goes ahead and its output is shown.
- **Specification:** stage 3's honest failure, stage 11's `unreadable` state.

### Not a cause

- Store detection: all six captures were detected as Best Buy.
- The printed tax `$461.00`/`$481.00` (the 8 prints faint): the existing landing repair
  (`repairTaxFromPrintedRate`) handles it and is kept.

## 5. Why patching the current parser is not the plan

`bestBuyReceiptParser.js` is 1,308 lines of reshaping around the shared engine (`parseReceiptEngine`), which reads
*any row ending in an amount* as a product and is frozen for Costco. Every fix so far taught the reshaping to
hide one more row from the engine (`You Save`, the `00003501` counter, the `Deliver01` stub). BB-RC-1 to BB-RC-4
are the same shape again. The in-store path is validated by **one receipt** (one capture in the corpus, six more
now). Maxim's instruction is a parser of its own, built the way Costco's was.

## 6. The rebuild

Scope of this plan: **the in-store slip**, because that is the format that failed and the one with production
captures. The online-order path (eight real PDFs, all pinned and green) keeps its current code and is moved onto
the specification as a second step, when it has a reason to change.

| Step | What | Files |
|---|---|---|
| 1 | **Corpus first.** The six production captures become fixtures for the Orleans receipt (truth in §2, per receipt), next to the existing capture. The scorecard and the capture-variance suite are written and **fail** as §3 shows. | `__tests__/fixtures/receipts-bestbuy/` (own tree; PII scrub run), `bestBuyReceiptParser.realocr.test.js`, `bestBuyCaptureVariance.test.js` |
| 2 | **The kit**, mechanisms only, each with its tests: rows, glyph-tolerant labels, segment, denoise, figures, checks, balance. | `src/services/storeReceiptKit/`, `storeReceiptKitIsolation.test.js` |
| 3 | **Format** by scored evidence (register header, business-date label, transaction word, item-count line, `SEND #`, tender block against order number, table header, web id, shipping block). `unknown` is a result. | `src/services/bestBuyReceipt/format.js`, `bestBuyReceiptFormat.test.js` |
| 4 | **Sections of the slip**, two anchors per boundary; the totals block also found by its arithmetic shape. Replaces `bestBuyReceiptSections.js`. | `bestBuyReceipt/sections.inStore.js`, `vocabulary.en.js`, `vocabulary.fr.js` |
| 5 | **Identity** from the header: store, register, transaction, the labelled business date. | `bestBuyReceipt/identity.js` |
| 6 | **Row grammar of the slip**: name row + price column, SKU row beneath (`[1-9]\d{6,7}`, not a date), sub-rows (regular price, savings), service lines, fulfilment rows as noise. Every priced row accounted for. | `bestBuyReceipt/grammar.inStore.js` |
| 7 | **Checks, balance, state.** Item count against `n Sale item(s)`; tax against the printed rate × base; the existing tax landing repair moved in; `proven` / `unproven` / `unreadable`. | `bestBuyReceipt/balance.js` |
| 8 | **Entry point** rewired: `parseBestBuyReceipt` = format → the format's stages. Online keeps `parseBestBuyOnlineReceipt`. The old in-store chain is deleted once the corpus is green on the new one. | `bestBuyReceiptParser.js` |
| 9 | **The scan screen** shows `unproven` and `unreadable` honestly (specification §9, decision 3), EN + FR. | `ScanScreen`, `i18n.js` |
| 10 | Docs: this folder (`Receipt_Parser.md` rewritten to the new shape, vocabulary, corpus status), the guide's §4 and appendix, the task log, `Bugs_Common_Fixes.md`. | `Priceback-Documentations` |

Later, each its own piece of work: the SKU catalogue check on save (stage 12, against the Best Buy feed); the
online format moved onto the kit; Best Buy's sections on the server (specification §8); a Best Buy `email` format.

### What "done" means for this plan

- All seven captures of the Orleans receipt: **0 wrong fields**. The three sharp ones (`PXL…`, `c678`, `c679`)
  fully right, including the date `2025-11-28` and store `627`. The four filtered ones right where the print
  survived and honest (`unproven` or `unreadable`) elsewhere; never a town or a label as a product.
- The eight online fixtures unchanged, field for field.
- Costco: the freeze, the registry parity replay and the Costco real-OCR suite green, with no frozen file touched.

### What this plan cannot prove, and what is needed from Maxim

The in-store corpus is **one receipt with one product**. It says nothing about a multi-item basket, a discounted
line (`Regular Price` / `Instant Savings`), a Geek Squad plan, a Quebec slip (FR, GST + QST) or a return. The
specification's bar for admin preview is three real receipts per format, and ten for shoppers. **More real Best
Buy paper receipts are needed**, photographed with the app in production (the refused or abandoned scans are kept
with their photos and are exported from there). Until then the in-store parser stays admin-only, which is where it
is today.

## 7. Risk and compatibility

- **Costco:** no shared or frozen file is edited. The kit is a new tree Costco does not import.
- **Other stores:** Sport Chek (lab lane) is untouched; it moves to the kit when it is next worked on.
- **Old app builds:** the parser runs on the phone, so the change reaches only new builds. No backend route, field
  or migration changes in this plan.
- **Shoppers:** none can scan Best Buy (`stores.enabled = false`, admin preview). The scan-screen states of step 9
  are reachable by Costco receipts only if the Costco parser stamps them, which it does not.
- **Cost:** no new OCR or AI call; the second pass and its budget are unchanged.
