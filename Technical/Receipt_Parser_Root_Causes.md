# Receipt parser — root causes and their cases

> **What this is:** the register of every root cause behind a production receipt the parser stored wrong, and
> **every case** (receipt) each one produced. It is the input for optimising the parser: a fix is designed against
> the whole case list of its root cause, never against the one receipt that surfaced it.
>
> **Standing rule (Maxim, 2026-10-11):** every production receipt that is repaired by hand (spec, SQL, admin desk
> line editor or the admin *Fix automatically* button) gets its root cause named here and the receipt added to that
> root cause's case table, in the same session as the repair. A new root cause gets a new `RC-n` section. A case
> that a fix later covers is not deleted: it is marked *covered by #PR*. The parser is **not** changed as part of
> the repair unless Maxim asks for it; the section's *Proposed parser change* records what the fix would be.
>
> Started 2026-10-11 with `r_1791693864226_r06sa` (Costco Vaudreuil #1213). Repairs:
> `Operations/Bad_Scan_Receipt_Repair_Runbook.md`. Admin button: `Operations/Receipt_Auto_Fix_Admin_Button.md`.
>
> **This register is the parser's input, not its design.** Every fix designed from it must respect
> `Technical/Receipt_Parser_Design_Rules.md` (Maxim, 2026-10-13): *denoise first, then extract* — the noise (EN and
> FR) is removed before extraction, only the item block and the totals block are parsed, and a new case is handled
> by the noise vocabulary or the block boundaries, never by a one-receipt branch in the extractor.

## How to add a case

1. **Reproduce with the code the shopper ran.** The phone parses; the server stores what that binary made of Vision's
   answer. Replay the live capture (`scripts/exportOcrCaptures.js`, runbook §0b), or — when the capture cannot be
   pulled — rebuild the printed rows from `receipts.raw_ocr` in print order and run them through
   `parseReceiptText`. The replay must reproduce the stored lines **exactly** (same count, same Σ) before a root cause
   is named.
2. **Prove the root cause by neutralising it.** Change only the input shape you blame (never the parser) and show the
   parse then lands on the printed subtotal / total. If it doesn't, there is a second root cause — keep going until
   the arithmetic closes to the cent.
3. **Name the code.** File, function, the commit that introduced it, the first tag that shipped it.
4. **Measure the blast radius in prod** with a read-only query over `receipts.raw_ocr` for the printed shape.
5. Add the row to the case table (and a new section if it is a new root cause).

Case table columns: receipt · store · scanned · build · what was lost · status (repaired how / still wrong).

---

## RC-1 · `unweldSkuSlashName` eats the slash of a short-code `/MULTIPLE` coupon

**Printed shape.** A multi-item coupon prints right under the item it reduces, as its coupon number, a slash and the
word MULTIPLE, with the amount on the same row or the next:

```
2040482 LOLE JOGGER      24.99 B
390384 /MULTIPLE          5.00-
```

Costco prints the coupon number either as **6 digits** (`390384`, `394156` — Vaudreuil #1213, English) or
zero-padded to **10** (`0000392598` — Gatineau #542).

**What goes wrong.** `src/services/costcoReceiptParser.js` runs every line through `preprocess`, which includes
`unweldSkuSlashName` (#398, `ca2be0d`, 2026-10-04): it rewrites `^\d{3,8}\s*/\s*(?=[A-Z][A-Z])` to `"$1 "` to repair a
SKU welded to its name (`8721334/TAPIS NORDIC`). A 6-digit coupon number is inside `\d{3,8}`, so
`390384 /MULTIPLE` becomes `390384 MULTIPLE`. The MULTIPLE rule in `handleCostcoTpdLine` (#402, `be158c9`, same day)
requires the slash (`^\s*(?:\d{6,})?\s*\/\s*MULTIPLES?`), so it never matches, and the coupon amount is dropped. The
item keeps its full price, is **watched at a price the shopper never paid** (a fake-drop risk), and the receipt's
lines add up to more than the printed subtotal.

The 10-digit form (`0000392598 / MULTIPLE`) is out of `\d{3,8}`'s reach, and Kanata's `/ MULTIPLE 5.50 A` has no
number at all — which is why the unit tests of both rules passed: each was tested with a shape the other cannot touch.

**Proof (r06sa).** The receipt's print-order rows run through `main` reproduce the stored parse exactly (37 lines,
Σ 487.76). Prefixing the five coupon numbers with `0000` (nothing else changed) restores all five coupons: −25.00.

**Shipped in:** v3.0.5 and v3.0.6 (both rules first tagged in v3.0.5). Still on `main` as of `7b684c2`.

**Blast radius (prod, 2026-10-11):** 3 receipts carry a short-code `/MULTIPLE` line — all Vaudreuil #1213; every
`/MULTIPLE` coupon on them was lost. Receipts with the 10-digit form (Gatineau #542, Kanata #541) are unaffected.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791169321759_5clwk` | Vaudreuil #1213 | 2026-10-05 | before 3.0.5 (no MULTIPLE rule yet) | `391313/MULTIPLE 2.50-` (FLEECY FRESH) | Repaired 2026-10-08 by spec (Bugs #311). Re-scanned today it would still lose it (RC-1). |
| `r_1791169282395_qvs25` | Vaudreuil #1213 | 2026-10-05 | before 3.0.5 | 2 × `392541/MULTIPLE 2.00-` (muffins) | Repaired 2026-10-08 by spec (Bugs #311). Same. |
| `r_1791693864226_r06sa` | Vaudreuil #1213 | 2026-10-11 | 3.0.5 / 3.0.6 | 5 coupons, 25.00: LOLE JOGGER 5.00, PEPSI 32 PK 3.50, PORK LOIN 6.00, CRUSH 32 PK 3.50, LOLE FZIP 7.00 | Repaired 2026-10-11 (in-place SQL, spec committed). |

**Proposed parser change (not applied — Maxim, 2026-10-11: document only).** In `unweldSkuSlashName`, never rewrite
a line whose word after the slash is a coupon keyword: add a negative lookahead `(?!MULTIPLES?\b|TPD\b|CPN\b)`. A
SKU/name weld whose item is literally named "MULTIPLE…" does not exist on any Costco receipt seen so far. Pin with
the three cases above plus Gatineau's `8721334/TAPIS NORDIC` (must still un-weld) and both 10-digit and number-less
MULTIPLE forms (must stay coupons).

---

## RC-2 · A coupon reference read with no slash at all (`39519127003`)

**Printed shape.** A coupon under a produce item (short SKU), printed `395191 /27003` or `395191/27003`:

```
27003 STRAWBERRIES        9.99 N
395191/27003              2.00-
```

**What goes wrong.** Vision read the reference as **one digit run**: `39519127003` (coupon number + SKU, slash
lost). Every coupon pattern needs a `/` between the coupon number and the SKU (`resolveSlashMisreadCouponRefs` only
repairs a slash read as a digit, `resolveDigitMisreadCouponRefs` only a digit read as another digit), so the row is
neither a coupon nor an item; its `2.00-` is dropped. Same consequences as RC-1.

**Proof (r06sa).** With RC-1 neutralised the parse is 462.76 for a 458.76 subtotal. Re-inserting the slash in the
two references (`395191/27003`, `394821/67237`) closes it to the cent: 458.76 + 21.39 = 480.15.

**Shipped in:** every build — no rule has ever handled it.

**Blast radius (prod, 2026-10-11):** 1 receipt.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791693864226_r06sa` | Vaudreuil #1213 | 2026-10-11 | 3.0.5 / 3.0.6 | 2 coupons, 4.00: STRAWBERRIES (`39519127003 2.00-`), CANTALOUPE (`39482167237 2.00-`) | Repaired 2026-10-11. |
| `r_1791853258418_xzw9x` | Nepean #540 | 2026-10-13 | Android 3.0.6 | DUBLINER's `0000391925 / 33991 2.50-` read `0000391925 33991` (a pen stroke crosses the slash); the geometry pass then merged it into DUBLINER's row (`0000391925 33991 DUBLINER 33991 10.99 2.50-`). Variant: number and SKU **space**-separated, not fused. Proof: with RC-15 neutralised, writing the slash back restores exactly −2.50 | Repaired 2026-10-13 (spec). |

**Proposed parser change (not applied).** A line that is *only* a digit run of 9–14 digits followed by a negative
amount (same row or next line) is a coupon when its **tail** is the SKU of an item parsed above it **and** its head is
6 digits starting `39`; apply it to that item only if the item is priced above the amount. Both guards are needed:
without the SKU-tail check a UPC-only line would be read as a coupon; without the `39…` head check a 4-digit SKU
could match the tail of an unrelated number.

---

## RC-3 · The stored total is re-derived from the lines instead of the printed TOTAL (≤ 3.0.6)

**What goes wrong.** Builds up to 3.0.6 save `total = Σ lines + tax` when the review screen recomputes, instead of the
TOTAL printed on the paper. So every line-level loss (RC-1, RC-2, a deleted fee row) also corrupts the receipt's total,
and the shopper sees a total that is not on their receipt. **Fixed on `main` by #420 (Bugs #316): the printed total is
locked** — ships with the next binary; old builds keep the behaviour (it is client code, see
`Technical/Backend_Backward_Compatibility.md`).

| Receipt | Store | Scanned | Build | Stored total / paper | Status |
|---|---|---|---|---|---|
| `r_1791646028977_4jfke` | Québec #503 | 2026-10-10 | 3.0.5 | 75.80 / 76.08 (fee rows deleted on the review screen) | Repaired 2026-10-10 (Bugs #316). |
| `r_1791693864226_r06sa` | Vaudreuil #1213 | 2026-10-11 | 3.0.5 / 3.0.6 | 509.15 / 480.15 (RC-1 + RC-2) | Repaired 2026-10-11. |
| `r_1791896364317_u8xbn` | Sherbrooke #1367 | 2026-10-13 | iOS 3.0.6 | 1261.29 / 1315.27 — the parse was right (4 lines, 1143.96); the shopper removed 2 lines on the review screen and the screen re-derived the total | Restored to the paper 2026-10-13 (Maxim). |

**Server-side gap (not applied).** The server could flag (not change) a receipt whose stored total differs from the
TOTAL in its `raw_ocr`; the admin desk's *Fix automatically* button already performs that comparison on demand.

---

## RC-4 … RC-14 · index (sections owed)

Named on 2026-10-12 by the session that shipped PR #427 (`207393a`); the per-RC sections were never written here.
This index is reconstructed from #427's commit message, `__tests__/receiptProdCaptures.test.js` and the repair
specs in `backend/data/bad-scan-repairs/`. **A full section (shape, code, proof, blast radius) is still owed for
each.**

| RC | Shape | Cases | Status |
|---|---|---|---|
| RC-4 | Footer `IMPORTANT - conserver cette copie` cleaned to a lone `-` under `**** TOTAL 445.23`; `detectRefund` read it as a trailing-minus refund total, every price negated | `3mq8x` | Fixed #427 (not in any binary yet) |
| RC-5 | The validator back-computes **tax = printed TOTAL − Σ lines**, discarding the TAXE it read, whenever lines are lost | `mebfs`; **`ejx4g`, `w0dv6` (2026-10-13)** | Open |
| RC-6 | Coupon reference with a SKU digit dropped (`0000393334/991230` for 9911230) matches no item | `mebfs` | Open |
| RC-7 | Mid-receipt `SOUS-TOTAL / TAXE / TOTAL / Comptant 0,00` block ends item extraction | `mebfs`, `p2s1a` | Fixed #427 |
| RC-8 | One tilted band of the page loses rows with their coupons (CREVETTES, ALLEGRO, 27.56) | `3mq8x` c83 | Fixed by RC-12 (#427) |
| RC-9 | Fixture PII scrub *deleted* 10-digit words, so fixtures did not parse like the phone | corpus | Fixed #427 (mask, don't drop) |
| RC-10 | Warehouse read from the big header before the register footer (`Boinbr Land #516`) | `p2s1a`, `zm6h2`, `8y5tt` | Fixed #427 |
| RC-11 | 1200px pass leaves FERRERO's 5.00- unapplied and reads it as a positive "Unknown item" | `3hhhj` c81 | Open (prod adopted the right 2000px pass) |
| RC-12 | Tilt measured from the page median; a curled band is never straightened → every price a row off | `p2s1a`, `3mq8x`; **`w0dv6`, `7yckq` (2026-10-13)** | Fixed #427 (per-word baseline) |
| RC-13 | Cleanup drops a coupon welded to the `Compte bas du panier` row | `p2s1a`; **`4qp2s` (2026-10-13)**: the tilted `***** Compte bas du panier 2 *****` banner merged with the `427383 CORN FLAKES` row and `FLAKES` went with it → product named `CORN`. Proof (c72, v3.0.6 and `main`): dropping only the banner's words restores `CORN FLAKES` | Open |
| RC-14 | 2000px retry: NESTLE's SKU read behind a stray `1 '`, its coupon lost | `3mq8x` c84 | Open |

---

## 2026-10-13 · October receipts review — cases

Maxim's triage: `admin_reviewed_at IS NULL` and **purchase date** in October. 13 live receipts; 7 right against their
paper (`21xro`, `bjkt6`, `t67po`, `xc09c`, `p6cxu`, `8wims`, `3hhhj`) and stamped reviewed; 6 handled below. Every
case was replayed through the parser **of the build that scanned it** (worktrees at `v3.0.5` / `v3.0.6`) and
reproduced the stored lines exactly before a cause was named, then replayed through `main` (`207393a`).

| Receipt | Store | Scanned | Build | What was wrong | Cause | On `main` | Repair |
|---|---|---|---|---|---|---|---|
| `r_1791823503830_w0dv6` | Sherbrooke #1367 | 10-12 | iOS 3.0.6 | Same paper as `3mq8x` re-scanned 13 h later: 410.36 lines, tax 34.87 (paper 431.84 / 13.39 / 445.23); CREVETTES + ALLEGRO + coupons, AILES DE POU, BOUNTY's TPD lost | RC-12 likely (the same paper's `3mq8x` c83 was closed by RC-12; #427 as a whole closes this one, not isolated per fix) + RC-5 (tax) | Closes to the cent (431.84, 29 lines) — *covered by #427* | **Duplicate soft-deleted** (Maxim): 25 price points removed, 22 watch entries removed, reviewed + skip-optimisation |
| `r_1791853110451_7yckq` | Barrhaven #1263 | 10-13 | Android 3.0.6 | 253.89 for 246.89: every price a row off its item (2000px pass adopted), `0000390266 /MULTIPLE 7.00-` lost, catalogue names corrupted (`.111854336482 SHEEP YOGURT`, `SAFE OIKOS 3X 24C`, `DUBLINER CATCH`, `STAR`) | RC-12 likely (#427 realigns the rows; not isolated per fix) | Sum closes (240.30) and the coupon applies, **but** the first two rows are still mis-paired: SHEEP YOGURT's 9.99 on OIKOS's SKU, OIKOS SKU-less — see *Open cases* O-1 | Spec, `--write` |
| `r_1791853201148_ejx4g` | Barrhaven #1263 | 10-13 | Android 3.0.6 | Tax 13.98 invented (paper 0.00), BARTLETT and both coupons lost, three SKUs truncated (10893, 197372, 171600). A **pen stroke** runs down the SKU column | OCR damage (pen) + RC-5 | Still wrong: total 226.34, tax 7 — O-3 | Spec, `--write`; 3 junk products deleted |
| `r_1791853644536_szw1y` | Barrhaven #1263 | 10-13 | Android 3.0.6 | 313.36 for 354.32: two coupons glued to the next item rows, MARBLE CHEDD + CROISSANT lost, VOID block mis-read, `**KS TOWEL**` read as banner → "Unknown item", 4 coupons lost | Several — O-2 | 340.29 / 350.28 for 348.28 — O-2 | Spec, `--write`; 3 synthetic products deleted |
| `r_1791896364317_u8xbn` | Sherbrooke #1367 | 10-13 | iOS 3.0.6 | 1261.29 for 1315.27, 2 of 4 lines | **Not the parser**: 3.0.6 parses all 4 lines to the cent (confidence 1); the shopper removed RUFFLES REG and RECHARGE 10P on the review screen and the screen re-derived the total — RC-3 | — | Restored to the paper (Maxim, same call as `4jfke`) |
| `r_1791841333433_eql4t` | Pointe-Claire #528 | 10-12 | iOS 3.0.5 | Lines and totals right; product 2974611 named `DEBUT PRÉ - LECTURE ARTICLES SOULIER ADID` | Pre-scan banner welded into the first item name (3.0.5) — the noise rule's textbook case | *Covered by 3.0.6* (banner scrubbed) | Spec, `--write` (label restored) |

All repairs: `markSkipParser: false` (readable photos — fixture candidates), no stock notice; custom notices #3–#5
drafted for approval (`backend/data/shopper-notices/2026-10-13-october-receipts-reviewed.json`).

### Open cases — reproduced, cause not yet isolated

The standing rule asks for proof by neutralisation before a root cause is named. These were reproduced exactly on
the shopper's build, but the first neutralisation **did not close**, so no RC number is assigned yet. They are the
first test cases for the denoise-first rework (`Receipt_Parser_Design_Rules.md`).

- **O-1 · `7yckq` c94 — first rows mis-paired.** The member line and the first item row overlap on the crumpled
  paper; Vision reads `176.111854336482` (SKU 1763195 fused with the member number). On `main` SHEEP YOGURT's 9.99
  lands on SKU 2743612 and OIKOS is SKU-less. Removing the fused token, or replacing it by `1763195`, does **not**
  restore the pairing → a second cause in the row pairing of the first two rows.
- **O-2 · `szw1y` c103/c104.** Three shapes: (a) `VOID` + `359241 CHOCOLA MILK 11.99-` after two identical lines —
  c103 loses the item entirely; (b) a coupon row read *above* its item (`0000393972/195047` before `195047 VEGGIE
  STRAW`) — c103 leaves it unapplied; (c) TRAD HUMMUS's coupon `0000394544/358 34` (pen circle splits the SKU) —
  joining it to `358234` does **not** restore the coupon on `main`. c104 also reads the TOTAL as 356.32.
- **O-3 · `ejx4g` c95/c97 — pen stroke down the SKU column.** Names lose their first letter, coupon references split
  at the stroke, and on `main` the parse reads tax 7 (the `TOTAL DISCOUNT(S) $ 7.00` value is the only 7.00 printed)
  and total 226.34. Partly an image problem (rule 6 of the design page); the tax read is a parser problem.

Captures exported locally (`__tests__/fixtures/receipts/prod-captures/…__c89`–`c107`), **not committed**: each needs
a ground-truth entry in `receiptProdCaptures.test.js` before it can join the corpus (the paper truths are in the
specs above).

---

## 2026-10-13 (afternoon) · remaining receipts — cases

Maxim's selection for "the remaining receipts to fix": `admin_reviewed_at IS NULL AND (purchase_date + 30) >= CURRENT_DATE
AND deleted_at IS NULL` (the price-adjustment window). 5 receipts. Each was read off its photo (R2 original, or the live
capture's image) and proved with the receipt's own arithmetic; the two wrong ones were replayed through **v3.0.6** (the
build that scanned both, per the capture envelope) and reproduced exactly before a cause was named, then through `main`
(`68d6017`, same result).

| Receipt | Store | Purchase · scanned | Build | Paper vs stored | Cause | Repair |
|---|---|---|---|---|---|---|
| `r_1791168728568_er1cc` | Vaudreuil #1213 (digital receipt) | 09-24 · 10-05 | — | Right: 513.33 + 72.83 = 586.16 (B lines 486.36 → GST 24.32, QST 48.51). Only `2787084 LAUNDRY 0.00 B` is not stored — a free line, not in "ITEMS SOLD = 9", nothing to watch | — | Stamped reviewed |
| `r_1791237035698_6czgq` | Vaudreuil #1213 (FR, photo cropped at both ends) | 09-22 · 10-05 | — | Right: 11 lines 160.27; FP 49.45 + F 23.99 → TPS 3.67 + TVQ 4.93 = 8.60; 168.87. Header, date and warehouse are not on the photo (the shopper's choice is kept). Detected as Costco only through its `TPD/` line (RC-15 blast radius) | — | Stamped reviewed |
| `r_1791723359114_xuxbv` | Sherbrooke #1367 | 09-19 · 10-11 | iOS 3.0.6 | Right: 34.78 + 69.99 − 15.00 = 89.77; TVQ 5.49 + TPS 2.75 = 8.24; 98.01 | — | Stamped reviewed |
| `r_1791723518253_4qp2s` | Sherbrooke #1367 | 09-19 · 10-11 | iOS 3.0.6 | Lines and totals right (556.34 / 65.74 / 622.08); 3 catalogue names garbled: `Bas du pobler BATTERIE KS`, `CORN`, `- FAL IRON` | RC-18, RC-13, RC-19 | Spec `--write` (`language: fr`, 3 products renamed, BISCOFF kept: it had a drop notification) |
| `r_1791853258418_xzw9x` | Nepean #540 (self-checkout) | 09-27 · 10-13 | Android 3.0.6 (2000px c100 adopted) | 323.97 for 129.74: BAGELS stored at the TOTAL 129.74, a `for your records` line at 129.74, 4 items and 3 coupons (11.50) lost | RC-15 + RC-16 + RC-2 + RC-17 | Spec `--write`: 11 lines, 1 synthetic product and 1 crowd copy of the bad parse removed |

**Proof for xzw9x, by neutralisation** (only the input changed, never the parser; v3.0.6 and `main` agree):
adding the missing `COSTCO` line alone → all 11 items with the right prices (Σ 134.09), still no coupon; then each
coupon reference repaired alone restores exactly its own coupon (`/2158319`→`/2158349` −3.00, `33991`→`/33991` −2.50,
`/FULL ZIP`→`/203764` −6.00); all four together close to the cent: 122.59 + 7.15 = 129.74.

## RC-15 · Store not detected when the COSTCO logo is cut off the photo

**Printed shape.** A receipt photographed from just under the logo: Vision's first line is `WHOLESALE` (or `S` +
`WHOLESALE`), and nothing else on the paper says "Costco" — Ontario self-checkout receipts print no `TPD/`, no
`Warehouse #`, no phone.

**What goes wrong.** `detectStore` (`src/services/receiptParsingShared.js`) matches `/costco/`, `kirkland signature`,
`warehouse #N`, `TPD/`, `BCTR`, `BUS CTR` or Costco's 1-800 number. None is on this paper, so the scan runs the
**generic** parser: the Costco parser, its word-geometry rows and its coupon rules never run. On xzw9x the flat text
carries the lower half as an amounts-first block (9 amounts incl. SUBTOTAL/TAX/TOTAL, then 9 labels); the generic
pairing gave BAGELS the TOTAL 129.74, made a line of the footer's `for your records` at 129.74, and lost MADE GOOD BA
(its labels-first pair) and every coupon. Detection list since #11 (`7c19367`, 2026-06-01) — every build.

**Proof.** Replay of c100 on v3.0.6 reproduces the stored 8 lines / 316.82 / 323.97 exactly; inserting `COSTCO` above
`WHOLESALE` (nothing else) gives all 11 items right.

**Blast radius (prod, 2026-10-13):** 15 Costco receipts carry no `costco` anywhere in their OCR (`hc05z`, `eyrre`,
`um44q`, `0rf1m`, `fzwp2`, `c108b`, `oxb04`, `jeji6`, `pspjb`, `f3ivl`, `6wd4e`, `sgftf`, `xzw9x`, `6czgq`, `xc09c`);
they depend on the other patterns (6czgq was caught by `TPD/`). Which of them fell to the generic parser was not
measured.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791853258418_xzw9x` | Nepean #540 | 2026-10-13 | Android 3.0.6 | The Costco parse: 4 items, 3 coupons, BAGELS priced at the TOTAL | Repaired 2026-10-13 (spec) |

**Proposed parser change (not applied).** Identify, don't guess: detect Costco from what every Costco receipt prints
in its header and footer — `WHOLESALE` on the logo line, the register footer `Whse:N Trm:N Trn:N OP:N`, and Costco's
GST/HST number `121476329RT` (printed on every Canadian receipt seen). This is step 1 of the design rules (identify
from wherever the store prints it). Pin with xzw9x c99/c100 and a non-Costco receipt that prints "wholesale".

## RC-16 · Coupon reference with a SKU digit misread survives on the full pipeline

**Printed shape.** `0000391656 /2158349` read `0000391656 /2158319` (4 → 1), over `3.00- H`.

**What goes wrong.** `resolveDigitMisreadCouponRefs` (`costcoReceiptParser.js`, #416 `8324e9f`, first in v3.0.6) is meant
to rewrite exactly this: one item number on the receipt (2158349) is one digit away. Run **alone** on the geometry rows
of c100 it does rewrite the row correctly — but in the full `parseReceiptText` run (with RC-15 neutralised) the coupon
stays unapplied, and repairing the digit in the input restores it (−3.00). Where the pipeline bypasses or undoes the
resolver was **not isolated** this session.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791853258418_xzw9x` | Nepean #540 | 2026-10-13 | Android 3.0.6 | MADE GOOD BA's 3.00- | Repaired 2026-10-13 (spec) |

**Next step (not a parser change yet).** Trace c100 + `COSTCO` through `parseCostcoWarehouseReceipt` to find which pass
(geometry vs flat choice, labels-first re-zip) sees the unrewritten line.

## RC-17 · A name-referenced coupon whose description is not the item's printed abbreviation

**Printed shape.** `0000389150 / FULL ZIP  6.00- H` under `2037641 NAUTICA FZIP  28.99 H`.

**What goes wrong.** The keyword-less "coupon names the ITEM" rule in `handleCostcoTpdLine`
(`costcoReceiptParser.js`, #400 `de640ec`, first in v3.0.5 — built for `0000389137 / PUREX` over `PUREX COLD`) applies
the coupon only to the latest item whose name contains the coupon's text **as a whole word run**. `FULL ZIP` is not in
`NAUTICA FZIP`, so the 6.00 is dropped and the item is watched at a price the shopper did not pay.

**Proof.** With RC-15 neutralised, replacing `FULL ZIP` by the item number restores exactly −6.00.

**Blast radius (prod, 2026-10-13):** 5 live receipts carry a `<number> / <WORDS>` coupon line (`a1ngm`, `f3ivl`,
`tl5wo`, `sgftf`, `xzw9x`); not checked one by one.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791853258418_xzw9x` | Nepean #540 | 2026-10-13 | Android 3.0.6 | NAUTICA FZIP's 6.00- | Repaired 2026-10-13 (spec) |

**Proposed parser change (not applied).** When no item contains the whole description, match the item directly
above the coupon if its name shares the description's last word or its initial-letter contraction (`FULL ZIP` →
`FZIP`), and it is priced above the amount. Never "whatever came last" without that link.

## RC-18 · A misread section banner is not denoised and is welded into the next item's name

**Printed shape.** Quebec self-checkout: `********* Bas du panier ***********` above the first item; Vision read
`Bas du pobler`, and the banner sits on a tilted band.

**What goes wrong.** The geometry pass merges the banner's words into the `1119338 BATTERIE KS` row; the name keeps
`Bas du pobler`. Even with `pobler` corrected to `panier` the name becomes `Bas du BATTERIE KS` — the banner is matched
word by word, not removed as a row. The garbled name becomes the product's catalogue label for every shopper
(`products.display_name` + `display_name_fr`). The flat text names it right; it is the geometry rows only.

**Proof (c72, v3.0.6 and `main`).** Dropping only the banner's five words gives `BATTERIE KS`.

**Blast radius (prod, 2026-10-13):** 1 product named with a banner (`1119338`), now corrected. Related: the
pre-scan banner welded into `2974611` on `eql4t` (3.0.5, covered by 3.0.6's scrub of the exact spelling).

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791723518253_4qp2s` | Sherbrooke #1367 | 2026-10-11 | iOS 3.0.6 | Catalogue name of 1119338 | Repaired 2026-10-13 (spec renamed it) |

**Proposed parser change (not applied).** Denoise first (design rules, step 2): a row whose text is bounded by
`*{3,}` runs is a banner, whatever words it holds, and is removed as a row before item extraction — in both languages.

## RC-19 · `cleanItemName` strips the `T` of a geometry-spaced `T-FAL`

**Printed shape.** `1980969 T-FAL IRON  44.99 FP`. Vision returns `T`, `-`, `FAL` as three words; the geometry row
reads `1980969 T - FAL IRON`.

**What goes wrong.** `cleanItemName` (`src/services/receiptParsingShared.js`, "Strip lone letter prefix",
`/^[A-Z]\s+(?!\/)/`, since #11 `7c19367`) drops the `T ` as a stray letter, leaving `- FAL IRON` as the catalogue
label. The flat text keeps `T-FAL` as one token and is right.

**Proof (c72, v3.0.6 and `main`).** Merging the three words into one `T-FAL` word gives `T-FAL IRON`.

**Blast radius (prod, 2026-10-13):** 1 product name starting with `- ` (`1980969`), now corrected.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791723518253_4qp2s` | Sherbrooke #1367 | 2026-10-11 | iOS 3.0.6 | Catalogue name of 1980969 | Repaired 2026-10-13 (spec renamed it) |

**Proposed parser change (not applied).** Re-join `X - Y` to `X-Y` when the three words touch (no gap wider than a
character) before cleaning the name, and never strip a lone letter followed by a hyphen.

---

## Earlier root causes (before this register)

Recorded in their own docs; listed here so the register is complete. Add new cases of these under a new `RC-n`
section when they recur.

| Root cause | Cases | Fixed in | Doc |
|---|---|---|---|
| Tilted/curled photo: every price a row off its item; 5 coupons lost | `r_1791561933778_ec7p8` (Kanata #541) | #413 (Bugs #314) | `Bad_Scan_Receipt_Repair_Runbook.md` log |
| Quebec totals block ended by a tender line (`Comptant`) and the stamp; eco fee read `NECOFRATS` / `0,96 FF` | `r_1791573195154_8y5tt` (Boisbriand #546) | #416 (Bugs #315) | `Technical/Costco/French_Quebec_Receipts.md` |
| `/api/ocr` read 2 of 3 PDF pages | `r_1791590373883_i7aiw` (Lévis #1186) | #416 (backend) | same |
| Fee lines lost by the 3.0.5 binary | `r_1791587435861_g01kg` (Drummondville #1127) | parser on `main` | same |
| Older parser (< 3.0.5): quantity misread, coupons and fees lost, fee read as item, back-computed tax | 9 receipts of Bugs #311 (`94g20`, `5mwuj`, `nhngb`, `f3ivl`, `qvs25`, `5clwk`, `n12jm`, `amlyo`, `i0bha`) | 3.0.5 parser (except the RC-1 coupons of `qvs25`, `5clwk`) | `Bad_Scan_Receipt_Repair_Runbook.md` log |
| Not a Costco receipt saved as "Costco online" | 7 receipts of `000195.…0626` | #420 (Bugs #316) | same |
