# Receipt parsing problems — Costco Saint-Jérôme #529, 2026-10-10

**Receipt:** `r_1791651763156_be1p8` (prod `xjfrlzwonyaorwktnkpj`), Costco Saint-Jérôme #529 (Quebec, French
register), purchased 2026-10-10 12:18, scanned 17:02 UTC. Live captures `ocr_captures` 65 and 66.
**Status:** data repaired in production on 2026-10-10 (datafix only, **no code change**). This file lists every
parsing problem the receipt exposed, so a permanent fix can be designed. Each problem has the OCR evidence, what the
parser did, the code that did it, and a proposed fix.

---

## 0. TL;DR

| | Stored by the scan | Printed on the paper |
|---|---|---|
| Total | **529.06** | **184.23** |
| Tax | 0.00 | 17.34 (TPS 5.79 + TVQ 11.55) |
| Lines | 8 (2 of them junk) | 8 (6 products + 2 fees) and 1 coupon |

The reported symptom was *"it caught the warehouse number as the receipt total"*. **It did not.** 529.06 equals
warehouse #529 only by coincidence:

```
11.99 + 29.99 + 83.99 + 24.99 + 19.99 + 6.99      (the 6 lines the scan kept)
      + 166.89                                     (the SOUS-TOTAL amount, stored as an "Unknown item")
      + 184.23                                     (the amount paid, stored as an item "00 APPRCLV@ - MERCI 001")
      = 529.06
```

The parser never found the printed TOTAL (P1), so it used **the sum of its own lines** as the total. That sum
included the two totals amounts it had wrongly turned into items (P2, P3). It came to 535.06 with the 6.00
CONSIGNE QC line. That line was then removed on the review screen, and the total followed it down to 529.06 (P10).
The fact that the cents are `.06` is what proves the total came from the line sum: `#529` has no cents.

Nine distinct problems stacked on one 8-line receipt. Fixing **four OCR misreads** (P1, P4, P5, P6) in the text
makes today's parser produce exactly the paper (§3), so each is independently necessary.

---

## 1. The evidence

### Stored OCR (`receipts.header_ocr` + `raw_ocr`, verbatim)

```
COSTCO
S+
EWHOLESALE
Jerome #529
1001 Jean-Baptiste-Roland
Saint-Jerome, QC J7Y 4Y7
M
Membre 1'1907151598
***DEBUT PRE-LECTURE ARTICLES*********
2222019 GRANOLA KS
11.99
4160015 GRENADE SC
29.99 F
36 81 COORS LIGHT              <- SKU 361811 with two "1"s dropped (P4)
äGE VÉRIFIE                    <- age-check stamp, Â read as ä (P7)
000039-28 / 361811             <- coupon 00003928 for SKU 361811, hyphen inside the number (P5)
*ECOFRAIS
83.99 F                        <- COORS LIGHT
18.85-                         <- its coupon
1.80 F                         <- *ECOFRAIS
CONSIGNE QC
6.00
1748763 OEUF & BACON
24.99
105 964 ST-HUBERT              <- SKU 105964 split by a space (P6)
19.99
175324 WHITE CLUB
6.99
***FIN FREECTURE ARTICLES***********
NOMBRE TOTA. ARTICLES PRÉ-LECTURE= 6
SOUS-TOTAL
"AXE                           <- TAXE, T read as a double quote (P1)
**** "OTAL                     <- **** TOTAL, T read as a double quote (P1)
166.89
17.34
184.23
2026/10/10 12:18:25
00 APPRCLV@ - MERCI 001        <- payment approval footer (P3)
184.23                         <- amount paid
0.00                           <- change due
```

### The paper, reconstructed and proved

| # | SKU | Name | Paid | Pre-coupon | Note |
|---|---|---|---|---|---|
| 0 | 2222019 | GRANOLA KS | 11.99 | | |
| 1 | 4160015 | GRENADE SC | 29.99 | | F |
| 2 | 361811 | COORS LIGHT | 65.14 | 83.99 | F, coupon 00003928/361811 18.85- |
| 3 | — | *ECOFRAIS | 1.80 | | F, fee (ignored) |
| 4 | — | CONSIGNE QC | 6.00 | | deposit (ignored) |
| 5 | 1748763 | OEUF & BACON | 24.99 | | |
| 6 | 105964 | ST-HUBERT | 19.99 | | |
| 7 | 175324 | WHITE CLUB | 6.99 | | |

Every printed self-check closes to the cent:

- Lines = 11.99 + 29.99 + 65.14 + 1.80 + 6.00 + 24.99 + 19.99 + 6.99 = **166.89** = SOUS-TOTAL.
- Taxable (`F`) base, before the coupon = 29.99 + 83.99 + 1.80 = 115.78. TPS 5% = 5.79, TVQ 9.975% = 11.55,
  so tax = **17.34** = TAXE. The tax is computed on the *pre-coupon* price (a manufacturer coupon). That is also what
  pins the 18.85 coupon to the taxable COORS LIGHT line.
- 166.89 + 17.34 = **184.23** = TOTAL = the amount paid.

**Confidence notes.** The receipt photo (R2) is not reachable from the session that did the repair, so two values are
inferred from the OCR and the checks rather than read by eye:

- COORS LIGHT's SKU `361811` comes from the coupon's own reference (`/ 361811`), which matches the mangled `36 81`.
- ST-HUBERT's SKU `105964` comes from joining the split `105 964`.

Both should be confirmed against the photo (`prod/receipts/109810737895279964438/r_1791651763156_be1p8.jpg`) next
time someone has R2 access.

---

## 2. The problems

Severity: **High** = wrong money (total, tax, a price in the pool, a fake watch). **Medium** = wrong catalog/data.
**Low** = cosmetic.

### P1 — Mangled totals labels: the printed TOTAL and TAXE were never read · High

- **OCR:** `"AXE` and `**** "OTAL`. Vision read the leading `T` as `"`. `SOUS-TOTAL` was read correctly.
- **Parser:** `extractPrintedTotal` (`src/services/receiptParsingShared.js`) and `extractTotal` look for
  `\btotal\b`. `"OTAL` does not match, so `printedTotal = null`. `extractTax` finds no `TAXE`, so `tax = null`, which
  is stored as 0.00.
- **Effect:** with no printed total, the total falls back to **the sum of the parsed lines**. Whatever garbage the
  line pass produced becomes the receipt's total. This is the root of the 529.06.
- **Permanent fix ideas:**
  1. **Positional totals reading.** On a Costco receipt the totals block is always `SOUS-TOTAL / TAXE / TOTAL`
     (`SUBTOTAL / TAX / TOTAL`), followed by **three stacked amounts**. Once `SOUS-TOTAL` is found, map the next
     labels by *position*, not by spelling. Accept a fuzzy label (edit distance ≤ 1 on `TAXE` / `TOTAL`, or a
     leading punctuation char that stands in for `T`).
  2. **Arithmetic identification.** Among the three stacked amounts after `SOUS-TOTAL`, find `a + b = c`
     (166.89 + 17.34 = 184.23). That is subtotal, tax and total, whatever the labels say. Cross-check with the amount
     paid (`184.23` after the approval line) and the change line `0.00`.
  3. Normalise `"` → `T` at the start of a word inside the totals block only (cheap, but narrow).

### P2 — The SOUS-TOTAL amount became an item ("Unknown item" 166.89) · High

- **OCR:** labels-first totals block: `SOUS-TOTAL`, `"AXE`, `**** "OTAL`, then `166.89`, `17.34`, `184.23`.
- **Parser:** the totals block was not recognised because of P1, so the first stray amount was attached to the
  preceding label-less run and emitted with the fallback name `Unknown item` (`receiptParsingShared.js`, the
  `Item #${sku}` / `"Unknown item"` fallback).
- **Effect:** a fake 166.89 line was stored, given a price point (on a synthetic `ln:` product), and **registered
  for price-drop watching**.
- **Permanent fix ideas:**
  - **Everything after the subtotal label is not an item.** `SOUS-TOTAL` / `SUBTOTAL` / `Total Partiel` is a hard fence:
    no amount below it may become a line.
  - **Sum-equality guard.** An "item" whose price equals the sum of all lines above it (the subtotal), or that sum
    plus a plausible tax (the total), is a totals amount. Drop it and use it as the printed subtotal/total.
  - **Never emit a nameless line on a Costco warehouse receipt.** Every Costco line prints a SKU. An amount with no
    SKU and no fee label is an error to surface on review, not a product.

### P3 — The payment footer became an item ("00 APPRCLV@ - MERCI 001" 184.23) · High

- **OCR:** `2026/10/10 12:18:25`, `00 APPRCLV@ - MERCI 001`, `184.23`, `0.00`. That is the date/time, the approval
  line (`00 APPROUVÉ - MERCI 001`), the amount charged and the change due.
- **Parser:** the approval line has no known keyword in its mangled form (`APPRCLV@`). Its leading `00` looks like a
  short code, so the line was taken as an item name and the next amount as its price.
- **Effect:** a fake 184.23 line was stored, priced and watched.
- **Permanent fix ideas:**
  - Fence the item region at **both** ends: nothing after `***FIN …ARTICLES***` / `SOUS-TOTAL` / the date-time stamp
    is an item. This receipt's end marker was itself mangled (`***FIN FREECTURE ARTICLES***`), so match it
    fuzzily (`^\*{3}\s*FIN\b.*ARTICLES`).
  - Payment-footer vocabulary, fuzzy: `APPR…`, `MERCI`, `APPROUV`, `APPROVED`, `THANK YOU`, `CHANGE`, `MONNAIE`, card
    brands, `INTERAC`.
  - The amount-paid line equals the printed total. Treat a bare amount equal to the total, after the totals block,
    as payment, never as an item.

### P4 — COORS LIGHT's SKU lost to dropped "1"s (`36 81` for `361811`) · High

- **OCR:** `36 81 COORS LIGHT`. The thin `1` glyphs were dropped and a space left behind.
- **Parser:** `QC_SKU_NAME` (`src/services/costcoReceiptParser.js`) wants `\d{3,8}` and then a name. `36` is too
  short, so the line is not an item header. COORS LIGHT disappears as an item.
- **Effect:** the beer line vanished. Its price 83.99 slid onto the next label (`*ECOFRAIS`, see P8).
- **Permanent fix ideas:**
  - **Recover a SKU from its coupon.** A coupon line `<coupon#> / <SKU>` names the SKU it discounts. If an item
    header above the coupon has a broken SKU whose digits are a subsequence of the coupon's SKU (`3681` ⊂ `361811`),
    adopt the coupon's SKU.
  - Accept a "digits-with-gaps" SKU (`\d{1,4}(\s\d{1,4})+`) as a candidate item header *when an uppercase name
    follows*. Confirm it by reconciliation (§P1, idea 2), never on its own.

### P5 — Coupon number with a hyphen (`000039-28 / 361811`) not recognised as a coupon · High

- **OCR:** `000039-28 / 361811`. The coupon number is `00003928`; Vision inserted a hyphen.
- **Parser:** every coupon-reference pattern requires an all-digit coupon number before the slash:
  `QC_COUPON_LABEL = /^\s*\d{5,12}\s*(?:(?:TPD|CPN)\s*)?\/\s*\d{3,8}\s*$/i`, `COUPON_REF` (line ~616),
  `VOID_COUPON_ROW`, `costcoColumnSolver.COUPON_LABEL`, `receiptGeometry.COUPON_REF_ROW`. A hyphen breaks all of
  them.
- **Effect:** the coupon line was not a coupon. The labels-first block (`COORS LIGHT / ÂGE VÉRIFIÉ / coupon /
  *ECOFRAIS` over `83.99 F / 18.85- / 1.80 F`) could not be re-zipped. The 18.85- coupon was lost and 1.80 was
  lost.
- **Experiment:** with only this hyphen removed (and P1 and P4 fixed), the parser produces the correct COORS LIGHT
  65.14/83.99 line and the 1.80 fee.
- **Permanent fix ideas:** one shared `COUPON_REF` definition used by all five call sites, tolerant of `-`, `.` and
  space inside the coupon number: `^\s*\d[\d\s.\-]{4,14}\d\s*(?:(?:TPD|CPN)\s*)?\/{1,2}\s*\d{3,8}\s*$`. The duplication
  is itself a risk: five regexes that must agree, and do not.

### P6 — ST-HUBERT's SKU split by a space (`105 964`) → product "105" named "964 ST-HUBERT" · Medium

- **OCR:** `105 964 ST-HUBERT`.
- **Parser:** a generic SKU+name path took the first digit group as the SKU (`105`, accepted because 3 digits is
  allowed) and the rest as the name (`964 ST-HUBERT`).
- **Effect:** a **new catalog product with SKU `105`** was created. Its price point and watch were filed under a SKU
  that does not exist at Costco, so a real price drop on 105964 would never match. The name was also wrong.
- **Permanent fix ideas:**
  - When an item header is `\d{2,4}\s\d{2,4}\s[A-Z]`, join the digit groups. A name never starts with a bare number
    group on a Costco receipt; size tokens like `30X355` carry letters.
  - **Distrust 3-digit Costco SKUs from OCR.** Warehouse item numbers are 4–7 digits (fee codes like `9491` are 4).
    Require a 3-digit SKU to already exist in the catalog before it is accepted from a scan.

### P7 — Age-check stamp with a wrong accent (`äGE VÉRIFIE`) not recognised · Low

- **OCR:** `äGE VÉRIFIE`. The stamp is `ÂGE VÉRIFIÉ`, but Vision read `Â` as `ä`.
- **Parser:** the stamp pattern in `shared/ocrCleanup.js` is `(?:\bAGE|ÂGE)\s+V[ÉE]RIF…`, which has no `ä`/`Ä`/`À`
  variants. The stamp survived as text.
- **Effect:** when the rest of the block parsed (P5 fixed), the stamp was welded onto the fee name:
  `äGE VÉRIFIE *ECOFRAIS`. Before that, it was one more label that broke the label/amount zip.
- **Permanent fix:** match any A-like first letter: `(?:\b[AÂÀÄ]|[ÂÀÄ])GE\s+V[ÉEÈ]RIF[A-ZÀ-ÿ]*`, case-insensitive.
  More generally, fold diacritics before the noise matchers run (`normalize("NFD")` and strip combining marks) so
  every accent misread is covered at once.

### P8 — A fee label took the item's price (`*ECOFRAIS` 83.99) · High

- **Cause:** a consequence of P4 + P5 + P7. With COORS LIGHT, the stamp and the coupon all unrecognised, the
  re-zip paired the first label it knew (`*ECOFRAIS`) with the first amount (`83.99 F`). `18.85-` and `1.80 F`
  were dropped.
- **Effect:** an 83.99 eco fee was stored (as `ignored`, so not priced or watched), the beer was missing, and the
  subtotal could not close.
- **Permanent fix:** a **plausibility bound on fee lines**. An `*ECOFRAIS` / `ECO FEE` is cents to a few dollars, and a
  `CONSIGNE` / `DEPOSIT` is 0.10 × containers. A fee line above ~$10 is a mis-zip. When it happens, refuse the zip and
  surface the block for review rather than storing it.

### P9 — The self-check passes on a total it invented itself · High

- **Parser:** `reconciled = |total − (itemsSum + tax)| < ε` (`receiptParsingShared.js` ~line 478). When no printed
  total is found, `total` **is** `itemsSum + tax`, so the check is always true. The replay of this receipt reports
  `reconciled: true` with `printedTotal: null`.
- **Second form of the same bug:** with P1 fixed but P4/P5 not, the replay finds `printedTotal 184.23` yet returns
  `total 201.28` (lines + tax), still with `reconciled: true`. A found printed total that the lines do not reach
  should never be overridden by the line sum.
- **Effect:** nothing downstream (review-screen warning, `not_reconciled` quality flag, admin queue) knew this parse
  was bad.
- **Permanent fix:**
  - `reconciled` must be `false` whenever `printedTotal` is `null` on a paper warehouse receipt. A Costco paper receipt
    always prints a TOTAL, so failing to read it is a parse failure, not a pass.
  - Add a separate `totalSource: "printed" | "computed"` and make `computed` raise the review-screen warning and an
    admin flag.
  - When `printedTotal` is found, `total = printedTotal` always. A lines-vs-printed gap is a **flagged mismatch**,
    never silently resolved toward the lines.

### P10 — The review screen moved the total when a fee line was deleted · Medium (known: Bugs #316)

- **Evidence:** the flat replay of the stored OCR yields 9 lines and total **535.06** (it includes `CONSIGNE QC 6.00`).
  The stored receipt has no CONSIGNE row at all (positions 0–7 contiguous, no soft-deleted 6.00 row) and total
  **529.06** = 535.06 − 6.00. The shopper most likely removed the "not tracked" CONSIGNE row on the review screen,
  and `ScanScreen` re-derived `total = Σ lines + tax`.
- **Status:** this is Bugs #316 root cause 3, fixed in app PR #420 ("the printed total is the receipt's total")
  **for the next binary**. **#420 would not have saved this receipt**, because its rule only applies *"without a
  printed total … the old behaviour stays"*, and P1 left `printedTotal` null. P1 and P9 must be fixed for #420's
  guard to engage on receipts like this one.
- **Caveat:** the device may have adopted a Vision-geometry parse (captures 65/66 in R2) rather than the flat-text
  parse replayed here. The stored lines match the flat replay exactly, minus CONSIGNE.

### P11 — Data hygiene after the shopper fixed the receipt themselves · Medium

These are not parser bugs, but they made the bad parse outlive the shopper's own corrections:

- **Deleting a line does not withdraw its price point.** The shopper soft-deleted both junk lines (17:03:21 and
  17:03:23 UTC). Their `receipt_ocr` price points (166.89, 184.23) stayed in `price_points`.
- **Deleting a line does not re-register watches.** The device's `watch_registrations` row (touched 17:02:43) still
  listed both junk lines as watched items until the repair rewrote it.
- **Fix ideas:** soft-deleting a `receipt_items` row should, in the same transaction, delete its
  `source_ref = <receiptId>:<position>` price point. The app should re-post `/api/watch` after any line edit. A
  server-side alternative is to have the watch sweep ignore entries whose `receipt_items` row is deleted.

### Noise that was handled correctly (for completeness)

`S+`, `EWHOLESALE`, `M`, `Membre 1'1907151598` (member line), `***DEBUT PRE-LECTURE ARTICLES***` and
`NOMBRE TOTA. ARTICLES PRÉ-LECTURE= 6` did not produce items. Note: `PRÉ-LECTURE = 6` is the **pre-scan** count (the
line-buster scanned 6 of the 7 products). It is not the `ARTICLES VENDUS` count and must not be used as an item-count
check.

---

## 3. Proof that these are the problems: what-if replays

Today's parser (`main` @ `358fdfb`, `parseCostcoReceipt`, flat text, no geometry) was replayed on the stored OCR
with misreads corrected one at a time **in the text only**:

| Replay | Total | Tax | Printed total | Lines |
|---|---|---|---|---|
| A. OCR as stored | 535.06 | null | null | 9, including Unknown item 166.89 and the approval line 184.23; `*ECOFRAIS` 83.99; ST-HUBERT as SKU 105 |
| B. + P1 (`TAXE`, `**** TOTAL`) | 201.28 | 17.34 | 184.23 | 7: junk lines gone, but COORS still missing and `*ECOFRAIS` still 83.99; total = lines + tax, not printed (P9) |
| C. + P4 (`361811 COORS LIGHT`) | 201.28 | 17.34 | 184.23 | unchanged: the coupon still blocks the re-zip |
| D. + P6 (`105964 ST-HUBERT`) | 201.28 | 17.34 | 184.23 | ST-HUBERT correct |
| E. + P5 (coupon `00003928`) and P7 (`ÂGE VÉRIFIÉ`) | **184.23** | **17.34** | 184.23 | **8 lines exactly as the paper** (COORS LIGHT 65.14/83.99, *ECOFRAIS 1.80, CONSIGNE 6.00) |

Isolation: in E, P5 alone is enough for the COORS block, but the stamp then welds into the fee name (P7). In B + P5
+ P7 with P4 *not* fixed, COORS is still lost, so P4 is independently necessary. With P1 not fixed, nothing else
matters (P2/P3 junk lines plus the computed total).

**These four corrected texts make good regression fixtures.** Export captures 65/66 with
`scripts/exportOcrCaptures.js` (the receipt is **not** flagged `skip_parser_optimization`) and pin the expected
result from the table in §1.

---

## 4. Suggested order of work

1. **P9** (the self-check that can't fail). This is the cheapest fix with the widest effect: it turns every one of
   these silent failures into a visible "please check" on the review screen and in the admin queue.
2. **P1 + P2 + P3**: the totals block read by position and arithmetic, plus hard fences at the subtotal and the
   payment footer. This removes the class of bug where totals become items and items become the total.
3. **P5**: one shared, tolerant coupon-reference regex.
4. **P4 + P6**: SKU recovery (from the coupon reference; joining split digit groups; distrust of 3-digit SKUs).
5. **P8**: fee plausibility bound.
6. **P7**: diacritic folding before the noise matchers.
7. **P11**: price point and watch cleanup on line delete.

---

## 5. What was done in production (2026-10-10)

Applied through the Supabase MCP as **one `DO` block with guards**: the receipt still at 529.06/0.00, 8 rows, no
claim, no price-drop push or review-queue row, target SKUs not already in the catalog, and the registration listing
only this receipt. It ends with a to-the-cent reconciliation assertion. It is the same end state
`backend/lib/badScanRepair.js` produces, written with `UPDATE`/`INSERT` only, because the MCP holds `DELETE` for an
interactive confirmation this session could not answer.

- **Receipt:** total 529.06 → **184.23**, tax 0.00 → **17.34**, `admin_reviewed_at` stamped,
  `skip_parser_optimization` left **false** (readable OCR, parser fault, so it should become a fixture). No shopper
  notice drafted.
- **Lines** (positions 0–7 as in §1): item 1380 `*ECOFRAIS 83.99` → `361811 COORS LIGHT 65.14` (original 83.99, not
  watched, because it was bought on a coupon). New rows 1386 `*ECOFRAIS 1.80` and 1387 `CONSIGNE QC 6.00` (both
  ignored). OEUF & BACON, ST-HUBERT and WHITE CLUB moved to positions 5, 6 and 7.
- **Products:** 30970 `105 / 964 ST-HUBERT` → **`105964 / ST-HUBERT`** (it was created by this scan and used only here,
  so it was fixed in place). New product `361811 COORS LIGHT`. 30974 re-keyed `ln:…:2` → `ln:…:3` (ECOFRAIS). New
  `ln:…:4` CONSIGNE QC.
- **Price points:** `receipt_ocr` refs follow their lines (`:5`, `:6`, `:7`). New point 10957 COORS LIGHT
  65.14 / regular 83.99 (on sale). The ST-HUBERT crowd copy 10955 (19.99) is now correctly filed under 105964.
- **Watch registration** `push:ExponentPushToken[yy15…]`: 7 entries (including the two junk ones) → the **5**
  watchable lines (GRANOLA, GRENADE, OEUF & BACON, ST-HUBERT, WHITE CLUB), in the stored `productId` shape.
- **Left as the shopper left them:** the two soft-deleted junk lines (items 1384/1385, moved to positions 8/9, with
  synthetic products `ln:…:8` / `ln:…:9`).
- **Pending, needs the destructive-statement confirmation:** their two junk price points.

  ```sql
  DELETE FROM priceback.price_points
   WHERE id IN (10950, 10951)
     AND source_ref IN ('r_1791651763156_be1p8:8', 'r_1791651763156_be1p8:9')
     AND device_hash = '036ad2aff815a476';
  -- expect: DELETE 2
  ```

- **Not reachable from the server:** the phone's local copy and the running server's in-memory watch registry. Both
  refresh on the phone's next sync/registration or a server restart (same caveat as Bugs #311).

Read back after the transaction: lines (live) = 166.89, + 17.34 = 184.23 = total. Ledger entry:
`Operations/Receipt_Data_Verification_Ledger.md`, 2026-10-10 Saint-Jérôme #529.
