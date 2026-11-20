# Receipt handwriting and item numbers left in names

> **Status:** shipped as a hotfix on `main` (2026-11-20). Costco only. Root causes **RC-59** and **RC-60** in
> `Technical/Receipt_Parser_Root_Causes.md`. Code: `shared/costcoNameRepair.js` (one definition), called by the
> phone's Costco parser and by the server for builds already installed.
>
> **Maxim, 2026-11-20:** *"sometimes the parser misdetect the SKU and cut it in the label (Example : SKU = NULL,
> Label = '313740 KS MOUCHOIRS') usualy a product label is always starting with text not numeric value … this case
> should always cross reference the numeric value as an sku or the nearest match and validate with the label … i need
> the parser to think as a human on these edge cases … also sometimes receipt have handwriting (text, shapes as arrows
> or lines, ...) this should be considered as noise and cleaned up … do your best to cover any possible cases and
> document all that to avoid any regression on these types of treatment in the future."* Then: *"i dont want any
> chances for any possible regression on the actual costco and best buy parsers, take extra precautions when fixing
> this bug."*

## 1. What a person sees, and what the parser now does

A person reading a Costco receipt knows two things the parser did not apply after a bad row reading:

1. **A Costco product name never starts with a number of three digits or more.** Measured on 2026-11-20 over the
   whole production catalogue (receipt names EN and FR) and every printed line ever stored: no name opens with 3+
   digits. The only hit was this bug (`854342 MDIET COKEM*`). Names that open with *one or two* digits do exist and
   are printed (`12 " APPLE PIE`, `80 LITRE BAG`, `30 MTH PARM`, `10 KG FLOUR`, `50 HANGERS`), and so do 2-digit
   item numbers (`84 COKE`, RC-40), so two digits stay RC-40's rule.
2. **Arrows, a lone `<` or `>`, a `|` stroke, a dash in front of an item number are a pen, not the register.** The
   register prints none of them inside an item name.

So, after every reading decision is made, each line goes through one step (`repairCostcoLineNames`):

| Line arrives as | Becomes | Why |
|---|---|---|
| sku null, `313740 KS MOUCHOIRS` | sku `313740`, `KS MOUCHOIRS` | the number is printed at the head of that row |
| sku null, `********* 313740 KS MOUCHOIRS` | sku `313740`, `KS MOUCHOIRS` | the "Bas du panier" banner's stars glued on by a row reading |
| sku null, `→→→→ 4546783 MERRELL C` | sku `4546783`, `MERRELL C` | a pen's arrow |
| sku null, `-4546783 MERRELL C` | sku `4546783`, `MERRELL C` | the arrow's shaft read as a dash |
| sku null, `***** - 17253 PARM 30 MOIS` | sku `17253`, `PARM 30 MOIS` | stars and a dash, in any order |
| sku null, `E 854342 MDIET COKEM*` | sku `854342`, `MDIET COKEM*` | a tax-flag letter `E` glued in front |
| sku null, `2 @ 5558566 10.99 ORG JUICE` | sku `5558566`, `ORG JUICE` | a multi-buy row woven into the item row |
| sku `1907229`, `TUFF LEGGING <` | `TUFF LEGGING` | a pen's tick |
| sku `2015637`, `BARRE \| DEL` | `BARRE DEL` | a pen stroke across the name |
| sku `313740`, `313740 KS MOUCHOIRS` | `KS MOUCHOIRS` | the name repeats its own number |

## 2. The guards: what it never does

Every guard below has a test in `__tests__/costcoNameRepair.test.js` (mobile) and `backend/tests/legacyItemNumbers.test.js`.

- **Never touches a price, a quantity, a coupon, a fee flag or the order of the lines.** It runs after the reading is
  chosen (`parseCostcoWarehouseReceipt`'s names-only post-step, next to `recoverTwoDigitItemNumbers` and
  `tidyCostcoItemNames`), so it cannot move which reading wins, a total, a check or a score.
- **Never gives a number to a line that has one.** It only removes a repeat of that same number from the name.
- **Never takes digits the paper does not print at the head of a row.** The digits must open a row of the receipt's
  own text, followed by the name's first word (on that row, or alone on the row above it), after pen marks, banner
  stars, a multi-buy header or a tax-flag `E` (`printedAtRowHead`). A row whose previous row is a bare item number
  is the name's own digits (`217190` / `80 LITRE BAG`, the RC-40 rule).
- **Never a size:** `1000 PC PUZZLE`, `500 ML …`, `1000 CT …`, `120 FEUILLES` (the word after the digits is a unit).
- **Never two digits** (RC-40's rule), never eight or more (Costco's paper numbers are 3–7 digits: 58 / 153 / 736 /
  1,462 / 12,944 products by length 3 / 4 / 5 / 6 / 7 on 2026-11-20).
- **Never a coupon** (`TPD`, `CPN`, `MULTIPLE`, `/`), a refund line or a fee line (`ignored`).
- **Never a price right after the number** without a multi-buy header (`5558566 10.99 ORG JUICE` is refused).
- **Never strips a letter or a backslash.** `BRIE 2 CR\ME` is a misread `È`. A shopper's `C` tick before a price
  (azj5y: `MERRELL C`) cannot be told from a printed `VITAMIN C`, so it stays; the item number decides the product
  (sweep rule 4), so a name with a stray letter never moves a drop.
- **Never a period or a comma** in front of digits (`.5L` is printed). A single `*` (`*ECOFRAIS`) stays.
- **Never blanks a name:** a name made of nothing but marks stays as it was.
- **Idempotent:** applied to an already repaired reading it changes nothing (the server re-applies it to every
  upload, including a new build's).

## 3. "Cross reference the number, or the nearest match, and validate with the label"

The repair reads what the paper printed. The catalogue then validates it, on the server, in this order, on every
Costco scan upload (`receiptsRepo.persistReceiptItems`):

1. `lib/legacyItemNumbers` — RC-40's two digits, then this repair (`repairNamesWithItemNumbers`), so a build already
   in the stores is stored as the new parser would read it.
2. `lib/receiptCatalogMatch.correctLines` — a number no product carries becomes the product one edit away whose name
   fits (a misread digit).
3. `lib/receiptDatabaseFill.fillLines` — a line still without a number is matched on the digits printed for it, kept
   in their positions, and the name must agree (`skuMatch.choosePositionalMatch`, RC-53); a line whose paper printed
   no digits is matched on its name alone.

Before this fix, step 3 already found most of these lines, but as a **database guess** (`skuFromDatabase`), which is
never priced or watched until an admin reviews the receipt: the receipt waited for a person. Now the number is the
paper's own reading and the receipt goes through like any other.

## 4. Proof of zero regression (2026-11-20)

- **Every committed fixture (225, all stores), parsed before and after, diffed line by line:** 6 lines moved, name and
  sku only, on 4 captures — azj5y c856 (3), os1f1 c880 (1), and p2s1a c87 / unlinked c88 (`- 17253 PARM 30 MOIS` →
  17253, which is the catalogue's Colla 30 Month Parmesan, printed `PARM 30 MOIS`, and what the admin had repaired by
  hand in production). No price, quantity, fee flag, line count or total moved on any fixture. Best Buy and Sport
  Chek fixtures: unchanged.
- **Golden snapshots:** 174 unchanged, 2 updated (p2s1a c87, c88: name + sku only), 2 written (the new captures).
- **Ground truth:** both new captures close to the cent against the paper (`receiptProdCaptures.test.js`) and pass
  the photo quality check.
- **Best Buy parser:** not touched. No existing shared parsing file touched (`receiptParsingShared.js`,
  `receiptGeometry.js`, `ocrCleanup.js` keep their pinned hashes); the rule is a new Costco-only module.
- `costcoPathImmutability.test.js`: the Costco parser hash re-pinned with this reason.

## 5. Handwriting the step does not remove, and what covers it

Handwriting comes in shapes the step leaves to other layers, on purpose:

| Shape | What happens | Covered by |
|---|---|---|
| A pen stroke crossing a word (`FUDGE B\|IO`) | Vision usually reads through it; a standalone `\|` is removed | this step |
| A tick letter before a price (`C 27.99`) | the letter stays on the name | sweep rule 4 (the number decides) |
| A circled or crossed price (glyphs misread) | a price a cent off | the totals check and balancing (design rules §2 step 4); the Gemini re-read |
| A note written on the paper (`OK`, a word) on its own row | not handled by this step (no corpus case yet) | if it ever takes a price, the receipt stops closing and is flagged by the totals check; add the capture and a rule here when one appears |
| A pen line across the warehouse number | the warehouse misread | `receiptProdCaptures` `ocrWarehouseId` (stated per capture) |

A new handwriting shape goes into `stripHandMarks` (marks) or `NOISE_BEFORE_NUMBER` (what is glued in front of a
number), with its capture as a fixture — never into extraction, never into a shared file (design rules §2).

## 6. How to extend it safely

1. Export the capture (`scripts/exportOcrCaptures.js --receipt <id>`) and replay it; name the root cause first.
2. Before any change, dump every fixture's parse (all stores) to a file; after it, dump again and diff line by line.
   Only the lines you mean to fix may move, and only their name / sku.
3. Add the shape to `__tests__/costcoNameRepair.test.js` (a "→" row and, as important, the "keeps …" row for the
   printed text that looks like it).
4. Run the Costco guard suites: `costcoNameRepair`, `receiptProdCaptures`, `receiptGolden.snapshot`,
   `costcoReceiptParser`, `costcoReceiptParser.realocr`, `receiptGroundRules.corpus`, `costcoPathImmutability`,
   `sharedMirrorParity`; backend `legacyItemNumbers`.
5. Re-sync `backend/shared/` (`node backend/scripts/sync-shared.js`): the server runs the committed copy.

## 7. Old app builds

Every build in the stores keeps its parser. The server applies the same rule on a Costco scan upload
(`lib/legacyItemNumbers.repairNamesWithItemNumbers`, inside the existing `catalogCheck && costco && rawOcr` gate), so
installed builds are covered at the next backend deploy. A new build's lines arrive already repaired and pass
unchanged. No route, field or response changed.
