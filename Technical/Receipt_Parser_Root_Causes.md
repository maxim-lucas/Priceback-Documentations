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

**Server-side gap (not applied).** The server could flag (not change) a receipt whose stored total differs from the
TOTAL in its `raw_ocr`; the admin desk's *Fix automatically* button already performs that comparison on demand.

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
