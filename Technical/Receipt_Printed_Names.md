# Receipt lines show the printed text; the product name is the English label

**Date:** 2026-10-15 · **App branch:** `fix/receipt-printed-names` · **Migration:** `0025_receipt_item_printed_name`
**Supersedes (display side of):** PR #412 / migration 0022 "one common label per language".

## What went wrong

PR #412 (2026-10-09, shipped in v3.0.6) gave each product one label per language:
`products.display_name` (base, "English when known") and `products.display_name_fr`. The app then showed
**the product's label instead of the line's own text**, in every screen (`src/services/productLabels.js`
`lineLabel`). Shoppers reported receipts that no longer read like the paper:

| What the shopper saw | Why |
|---|---|
| A tag's catalogue text, e.g. "ORAL-B IO BROSSES À DENTS", where the paper printed "ORAL - BIO" | a French price tag filled `display_name_fr`, and a French-language app shows `nameFr` |
| French text on an English receipt | the first French receipt of a SKU fills the base slot too (it "borrows" it until an English name arrives) |
| Both slots holding the same French text (184 of 242 French-labelled products in prod on 2026-10-15) | same borrowing. Plus builds before 3.0.6 send no `language`, so their French receipts were filed as *unknown*: the French text took the base slot and no English receipt could ever replace it |

The deeper cause: **a receipt line never stored its own name.** Since the v2 redesign `receipt_items` holds only
`product_id`, and every read joined `products.display_name`. Before #412 that name was "last scan wins", and the
printed text survived only in the phone's local copy. A restore (`GET /api/me/bootstrap`, run on every boot and
foreground) overwrote it with the product's name.

## The rule now

1. **A receipt line shows what its receipt printed.** `receipt_items.printed_name` is written by every line write
   (`receiptsRepo.persistReceiptItems`: upload, back-fill, bad-scan repair, the admin desk's line editor, *Fix
   automatically*). That is the parser's reading of the paper, or the shopper's or admin's correction of it.
2. **The product name is the English label.** `products.display_name` keeps the existing fill-only rules
   (`pricesRepo.labelFillSet`). A French-only product keeps its French text in the name *until an English receipt
   names it* (Maxim, 2026-10-15: "keep the actual behavior until the product name is available"). Then the English
   name takes the slot.
3. **The server reads the receipt's language itself when a build doesn't send it** (`shared/receiptLocale.js`
   `receiptLabelLanguage`, the app's own two-marker rule, run on `headerOcr + rawOcr`). This means a French receipt
   from a build before 3.0.6 can no longer hold the English slot for good.
4. **A repair renames a product only for a name the admin changed** (`lib/badScanRepair.js`). The desk's line
   editor starts from what each line shows, which is now its printed text. A name left as it was (same position,
   same SKU, same text) renames nothing. Otherwise re-saving a receipt would rename every product to that receipt's
   printed (possibly French) text. A repair with no `language` reads it from the receipt's OCR.
5. **Never empty.** Every read is `coalesce(printed_name, product label)`. A line written before 0025 (NULL
   `printed_name`) shows exactly what it showed before. `products.display_name` is NOT NULL.

| Read | `name` | `nameFr` |
|---|---|---|
| Bootstrap / receipt reads (`receiptsRepo._itemSelect`) | `coalesce(printed_name, display_name)` | `coalesce(printed_name, display_name_fr)` |
| Upload answer `products[]` (`receiptsRepo.lineProducts`) | same, from the first line of this receipt naming the product | same |
| Price-drop candidates (`priceDropRepo.findNotifiable`) | `p.display_name`: the PRODUCT's name, never the line's printed text | — |
| Admin receipt desk (`receiptsRepo.getForAdmin`) | `name` as above, plus `productName` (`products.display_name`) and `printedName` | — |

**Where a name stands for the product, it comes from the products table** (Maxim, 2026-10-15: *"the table product
have the right product name for the admin and price drop notifications even if the items have some parsing
problems"*). Price-drop pushes and every admin desk name the product. The receipt desk shows each line's product
name, with "On the receipt: …" beside it when the print differs. Its line editor has a **Product name** field per
line: changed, it sets the product's English name (`renameProduct`, base slot) whatever the receipt's language; left
alone, nothing is sent. The repair spec takes the same optional `items[].productName`. A misread line therefore never
renames what a push or a desk says, and an admin can correct the product without touching the shopper's line.

## Old app builds

| Build | What it does with the change |
|---|---|
| ≤ 3.0.5 | Shows the bootstrap `name` per line, so it shows the printed text (or the old product name for an un-backfilled line). Ignores the upload answer's `items`/`products`. |
| 3.0.6 | Keeps labels **by product id** (`product_labels_v1`) and shows `nameFr \|\| name` (fr) / `name` over the line's own text. The server now answers the line's printed text in both fields, so it shows the paper in either language. Its stored map is overwritten at the next boot/foreground hydrate. **Residual:** a product bought on two receipts with *different* printed text shows the most recently synced text on both. Only the new build is exact per line. |
| next build (3.0.7+) | `lineLabel` returns the line's own text first. The product label is only the fallback for a line with none (or with the restore's `(unnamed)` stand-in). |

No field is removed or retyped. `nameFr` stays on the wire (3.0.6 reads it).

## Deploy order (no empty receipt or label at any step)

1. **Migration 0025 on prod, by hand**, plus the ledger row (LF hash). It adds a nullable column, and the running
   backend never touches it. ✅ dev (2026-10-15, `db:migrate`) · ✅ prod (2026-10-15, ledger row 36).
2. **Deploy the backend** (merge #438; Railway auto-deploys `main`). ⏳ the merge waits on Maxim. New lines get `printed_name`. Old lines fall back to today's label. Every build keeps
   working.
3. **Backfill `printed_name` for existing lines**: `railway run -e production -s Priceback node
   scripts/backfill-printed-names.js [--write]` (`lib/printedNameBackfill.js`). Safe before or after step 2. Costco
   prints `SKU NAME` on one OCR line, so each line takes the text after its SKU (amount and tax flag stripped). One
   reading only; a SKU on several lines (deposits, eco fees) is paired in print order when the counts match; an
   `ln:` line takes its own product's name. An OCR misread within two edits of a name the product carries (or equal
   but for punctuation) takes the product's checked reading ("SROGH BAGUET" → SRDGH BAGUET). Prod dry run
   2026-10-15: **1,070 / 1,116** resolved (992 printed, 44 settled to the product's reading, 30 own product, 4 in
   print order); 46 unresolved (42 SKU not on its own OCR line, 3 ambiguous, 1 barcode) keep the product name. A
   handful of OCR misreads no label is close to stay as read (`K.S. ESSUTE`, `PRSONT DIE`), which is what the
   shopper's phone showed at scan time. ⏳ `--write` waits on Maxim.
4. **Product name clean-up**, AFTER step 2: `railway run -e production -s Priceback node
   scripts/cleanup-product-names.js [--write]` (`lib/productNameCleanup.js`). A product is renamed only when its
   name is French print (its French label, or exactly what a French receipt printed) AND an English receipt printed
   it; the English text read most often wins. Catalogue/admin names, names printed the same in both languages and
   French-only products are left alone (rule 2); the French label is never touched. Prod dry run 2026-10-15:
   **11 renames** (LONGE PORC → PORK LOIN, ROCHER T48 → FERRERO 48CT, OEUFS 2.5 DZ → EGGS 2.5 DZ, POITRINE DÉS →
   B/S BREASTS, CREVETTES → SHRIMP CTL, …); 302 products bought on French receipts only keep their name. Run before
   the deploy, a French receipt's un-backfilled lines would show the new English name on the old backend, hence the
   order. The receipts are the evidence, so the 2026-10-09 backup is not needed (the copy stays on hold; it ages out
   around 2026-10-23). ⏳ waits on Maxim.
5. **Ship the next app build** (tag + release per CLAUDE.md).

## Tests

- `backend/tests/receiptProductLabelsDb.test.js`: product slot rules, OCR language for builds that send none,
  per-line printed text on reads and on the upload answer, a pre-0025 line falling back (never empty), trimmed
  storage, `(unnamed)` not stored. Mutations checked: reading the product name instead of the printed text → 2 red;
  dropping the OCR language fallback → 1 red.
- `backend/tests/badScanRepairDb.test.js`: a re-save of unchanged names renames nothing (an unreadable-language
  receipt, where a rename would put French in the English name); a repair with no language reads it from the OCR and
  corrects only the French slot. Mutations checked: both guards removed → red.
- Full suites (2026-10-15): backend 2582/2584, 95.18 % statements. The 1 failure is
  `receiptUnsupportedCountryDb` "registration BEFORE the upload", which **fails identically on clean `main`**
  (pre-existing, not this change); 1 skipped. Mobile: everything passes except 4 suites driven by 19 *untracked*
  prod-capture fixtures in the working tree that have no golden yet (they pass with those files moved aside).
- `__tests__/productLabels.test.js`, `detailScreenProductLabels`, `homeScreenProductLabels`,
  `receiptsScreenProductLabels`, `exportServiceProductLabels`: printed text first, product label only for a nameless
  line.
- `__tests__/receiptLocale.test.js`: `receiptLabelLanguage` (no English default).
- `shared/receiptWireContract.js` models the new `name`/`nameFr`. `restoreRoundTripDb` holds it to the real DB.
