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
| Price-drop candidates (`priceDropRepo.findNotifiable`) | `coalesce(ri.printed_name, p.display_name)`: the shopper's own line | — |

Admin desks that group by product (review queue, potential drops, saving dates) still show the product name.

## Old app builds

| Build | What it does with the change |
|---|---|
| ≤ 3.0.5 | Shows the bootstrap `name` per line, so it shows the printed text (or the old product name for an un-backfilled line). Ignores the upload answer's `items`/`products`. |
| 3.0.6 | Keeps labels **by product id** (`product_labels_v1`) and shows `nameFr \|\| name` (fr) / `name` over the line's own text. The server now answers the line's printed text in both fields, so it shows the paper in either language. Its stored map is overwritten at the next boot/foreground hydrate. **Residual:** a product bought on two receipts with *different* printed text shows the most recently synced text on both. Only the new build is exact per line. |
| next build (3.0.7+) | `lineLabel` returns the line's own text first. The product label is only the fallback for a line with none (or with the restore's `(unnamed)` stand-in). |

No field is removed or retyped. `nameFr` stays on the wire (3.0.6 reads it).

## Deploy order (no empty receipt or label at any step)

1. **Migration 0025 on prod, by hand**, plus the ledger row (LF hash). It adds a nullable column, and the running
   backend never touches it. ✅ dev (2026-10-15, `db:migrate`) · ⏳ prod.
2. **Deploy the backend.** New lines get `printed_name`. Old lines fall back to today's label. Every build keeps
   working.
3. **Backfill `printed_name` for existing lines** (data step, **needs Maxim's go**). Replay the parser on each
   receipt's `raw_ocr` (all 90 live receipts have it; 94 OCR captures are linked), match lines by position + SKU +
   amount, and write only exact matches. Mismatches are listed for review, never guessed. Until this runs, those
   lines keep today's label.
4. **Product name clean-up** (data step, **needs Maxim's go**; the backup copy is on hold). Products whose base slot
   holds French text get their English name back where an English receipt or the 2026-10-09 04:10 UTC backup
   (`restore-db.js --dump-table=products`, read-only) shows one. The rest keep their French text (rule 2). The
   pre-change backups roll off the 14-day retention: the 2026-10-09 one is gone around **2026-10-23**.
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
