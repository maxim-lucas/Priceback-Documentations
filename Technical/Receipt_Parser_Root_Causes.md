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
| `r_1791169321759_5clwk` | Vaudreuil #1213 | 2026-10-05 | before 3.0.5 (no MULTIPLE rule yet) | `391313/MULTIPLE 2.50-` (FLEECY FRESH) | Repaired 2026-10-08 by spec (Bugs #311); *covered by #476* |
| `r_1791169282395_qvs25` | Vaudreuil #1213 | 2026-10-05 | before 3.0.5 | 2 × `392541/MULTIPLE 2.00-` (muffins) | Repaired 2026-10-08 by spec (Bugs #311); *covered by #476* |
| `r_1791693864226_r06sa` | Vaudreuil #1213 | 2026-10-11 | 3.0.5 / 3.0.6 | 5 coupons, 25.00: LOLE JOGGER 5.00, PEPSI 32 PK 3.50, PORK LOIN 6.00, CRUSH 32 PK 3.50, LOLE FZIP 7.00 | Repaired 2026-10-11 (in-place SQL, spec committed); *covered by #476* (c67–c70 close to the cent) |

**Proposed parser change (not applied — Maxim, 2026-10-11: document only).** In `unweldSkuSlashName`, never rewrite
a line whose word after the slash is a coupon keyword: add a negative lookahead `(?!MULTIPLES?\b|TPD\b|CPN\b)`. A
SKU/name weld whose item is literally named "MULTIPLE…" does not exist on any Costco receipt seen so far. Pin with
the three cases above plus Gatineau's `8721334/TAPIS NORDIC` (must still un-weld) and both 10-digit and number-less
MULTIPLE forms (must stay coupons).

**Fix (applied, 2026-10-21 — Maxim asked for the parser optimisation).** Exactly the proposal, in the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`):
`unweldSkuSlashName` has the negative lookahead `(?!MULTIPLES?\b|TPD\b|CPN\b)`. `8721334/TAPIS NORDIC` still un-welds;
both other MULTIPLE forms stay coupons. With RC-2's fix as well, the four `r06sa` captures (c67–c70) close to the cent,
480.15, confidence 1, and moved from `parser_gap` to `ok` in `receiptProdCaptures.test.js`. All three cases *covered by
#476* (builds from the next release; 3.1.2 and older keep the defect — client code).

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
| `r_1791693864226_r06sa` | Vaudreuil #1213 | 2026-10-11 | 3.0.5 / 3.0.6 | 2 coupons, 4.00: STRAWBERRIES (`39519127003 2.00-`), CANTALOUPE (`39482167237 2.00-`) | Repaired 2026-10-11; *covered by #476* |
| `r_1791853258418_xzw9x` | Nepean #540 | 2026-10-13 | Android 3.0.6 | DUBLINER's `0000391925 / 33991 2.50-` read `0000391925 33991` (a pen stroke crosses the slash); the geometry pass then merged it into DUBLINER's row (`0000391925 33991 DUBLINER 33991 10.99 2.50-`). Variant: number and SKU **space**-separated, not fused. Proof: with RC-15 neutralised, writing the slash back restores exactly −2.50 | Repaired 2026-10-13 (spec); *covered by #476* (the spaced shape, unit-tested; capture not committed) |
| `r_1791777296528_mebfs` | Brossard #521 | 2026-10-12 | iOS 3.0.6 | SWEETSIXTEEN's 2.50-: the reference read `P 1448438 2.50 - FP D`, slash lost and the bare coupon number deleted by the cleanup (spaced variant), with two margin marks on the row (RC-14). Proof: see RC-14, both shapes must be neutralised | Repaired 2026-10-12 (spec); *covered by #476* |

**Proposed parser change (not applied).** A line that is *only* a digit run of 9–14 digits followed by a negative
amount (same row or next line) is a coupon when its **tail** is the SKU of an item parsed above it **and** its head is
6 digits starting `39`; apply it to that item only if the item is priced above the amount. Both guards are needed:
without the SKU-tail check a UPC-only line would be read as a coupon; without the `39…` head check a 4-digit SKU
could match the tail of an unrelated number.

**Fix (applied, 2026-10-21).** In the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`), a normalisation step before extraction (`resolveSlashlessCouponRefs`, Costco
preprocess) puts the slash back when the coupon number has a coupon's shape (6 digits starting `39`, or `0000` + 6), the
rest is an item number printed on an item row of the same receipt, and the amount (on the row or the next) has a minus.
Two more shapes, from the same root:

- **The geometry never saw it.** `shared/ocrCleanup` deleted `39519127003` from the word list (every 10+-digit word is
  dropped as possibly sensitive), so the phone's rows read a bare `2.00-`. A fused `39…` reference is now kept on a
  coupon row (a minus on the row or the next row); the fixture scrub keeps the same shape, and the four `r06sa` fixtures
  were un-masked from their envelopes (only those words changed).
- **Number and slash both gone** (`mebfs` c85): `1448438 2.50 - FP` under `1448438 SWEETSIXTEEN` reads as that item's
  coupon (`BARE_SKU_COUPON_ROW`), only when the item is printed above.

`r06sa` ×4 and `mebfs` c85 close to the cent; `xzw9x`'s spaced shape is pinned by a unit test (its capture isn't
committed). Cases *covered by #476*.

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
| `r_1791931739349_fpnqe` | Sainte-Foy #516 | 2026-10-13 | iOS ≤ 3.0.6 | 78.95 / 85.94 (= 4 stored lines + tax; PAIN HAMB. lost, RC-23) | Repaired 2026-10-14 (SQL). |
| `r_1791933620723_g7ntk` | Nepean #540 | 2026-10-13 | iOS ≤ 3.0.6 | 310.82 / 306.82 (= 16 stored lines + tax; CAD MILK's coupon lost, RC-22) | Repaired 2026-10-14 (SQL). |

**Server-side gap (not applied).** The server could flag (not change) a receipt whose stored total differs from the
TOTAL in its `raw_ocr`; the admin desk's *Fix automatically* button already performs that comparison on demand.

---

## RC-4 … RC-14 · index

The session that shipped PR #427 (`207393a`, first tag v3.1.0) named these on 2026-10-12. The sections below were
written on 2026-10-19 from replays of the committed prod captures (`__tests__/fixtures/receipts/prod-captures/`: c72,
c81–c88) and, for `t09q9`, its committed flat text. The captures were replayed on three builds (`t09q9` on v3.0.6
and `main`):

- **v3.0.6** (`7dfd024`), the build that scanned every case here. `c2b1990`, which is `main` just before #427, parses
  every one of these captures identically.
- **#427** (`207393a`).
- **`main`** (`6709fbe`).

Every neutralisation changes Vision's answer (words or text) and never the parser. "Scanned" is `receipts.created_at`
(UTC). Captures c89 onwards are not committed, so `w0dv6`, `7yckq` and `ejx4g` are not replayed here.

**What "proven" means here.** A case is marked proven only when both hold:

1. The replay with the shopper's code reproduces the stored lines.
2. Neutralising only the blamed shape closes the parse to the printed total.

Some passes were not adopted (c81, c84, c86, c88), so nothing of them was stored. For those, the replay *is* the phone's
parse of that pass.

| RC | Shape | Cases | Status |
|---|---|---|---|
| RC-4 | The cleanup leaves a lone `-` under `**** TOTAL 445.23`, and `detectRefund` reads it as a refund total | `3mq8x` | Fixed #427 (v3.1.0) · proven |
| RC-5 | The validator replaces the TAXE it read with printed TOTAL − Σ lines, so lost lines look closed | `mebfs`, `w0dv6`, `ejx4g`, `t09q9`, `afuor` | Fixed #476 (client) · proven (`mebfs`, `t09q9`) |
| RC-6 | A coupon reference with one SKU digit dropped matches no item | `mebfs` | Fixed #476 · proven |
| RC-7 | A mid-receipt `SOUS-TOTAL / TAXE / TOTAL / Comptant 0,00` block ends item extraction | `mebfs`, `p2s1a` | Fixed #427 · effect proven; `p2s1a` closure owed |
| RC-8 | A coupon row with no two-letter word is folded into an item row on a page that wasn't straightened | `3mq8x` c83, c84 | Open on `main` (c84); c83 *covered by #427* · proven |
| RC-9 | The fixture PII scrub deleted words, so fixtures did not parse like the phone | corpus: `3mq8x` c83, `8y5tt` c47 | Fixed #427 · proven |
| RC-10 | The warehouse is read from the header before the register footer; the cleanup drops `Entr:` | `p2s1a`, `zm6h2`, `8y5tt` | Fixed #427 · proven |
| RC-11 | The cleanup deletes a coupon number that Vision returned as its own word, which defeats the minus-less coupon rule | `3hhhj` c81 | Fixed #476 · proven |
| RC-12 | The tilt gate reads the page median, so a curled band is not straightened | `3mq8x`, `p2s1a`, `w0dv6`, `7yckq` | Gate fixed #427 · proof owed for every case |
| RC-13 | The `account` noise rule drops a tilted row carrying the word `Compte` of the bottom-of-basket banner | `p2s1a`, `4qp2s` | Open · proven (`4qp2s`); `p2s1a` owed |
| RC-14 | Margin marks read as 1–2-character words join item and coupon rows | `3mq8x` c84, `mebfs` c85 | Fixed #476 · proven |

## RC-4 · The cleanup leaves a lone `-` under the TOTAL, and the purchase is saved as a refund

**Printed shape.** A French card slip ends with the footer `IMPORTANT - conserver cette copie` / `pour vos dossiers` /
`COPIE DU CLIENT`, under the payment block that follows `**** TOTAL`. On `3mq8x` c83 (1200px, median glyph height
14 px), Vision placed the footer's `-` 8.5 px below the word that anchors its row (y 1477 → 1485.5).

**What goes wrong.** The failure runs in three steps:

1. **The cleanup leaves the dash behind.** `cleanReceiptOcr` (`shared/ocrCleanup.js`, #127 `02e9ec6`, 2026-07-02)
   rebuilds the text from Vision's words in rows. Each row is anchored on its topmost word, with a tolerance of 0.6 ×
   the median glyph height (8.4 px here). The dash is 8.5 px away, so it becomes a row of its own. The footer row is
   dropped (`important`, `retain-copy`). The lone `-` survives, because the separator rule needs four characters
   (`/^\s*[*\-=_]{4,}\s*$/`). Every payment-block row in between is dropped too, so the cleaned text reads
   `**** TOTAL 445.23` / `-` / the card's tender line (`<card> 445.23`).
2. **`detectRefund` reads it as a refund.** `detectRefund` (`src/services/receiptParsingShared.js`) treats
   `/TOTAL\s+\d+\.\d{2}\s*-/i` as a definitive refund marker. Its `\s*` crosses the newline, and the marker is tested
   before the "positive total ⇒ purchase" guard.
3. **The refund is stored.** `validateReceipt` negates every price and the tax. The review screen then stores
   Σ lines + tax (RC-3): −404.28 − 13.39 = −417.67. The 2000px retry (c84) parsed as a purchase, but a retry is never
   adopted across a refund/purchase flip.

The marker dates from the first app commit (`09ab61f`, 2026-05-08), moved into the shared parser by #11 (`7c19367`).
The cleanup that leaves the dash is #127. First tag: v2.8.2. The defect is in every build up to v3.0.6.

**Proof (c83, v3.0.6).**

1. **Reproduced.** The replay gives exactly the stored receipt: a refund of 27 lines, Σ −404.28, tax −13.39 (stored
   total −417.67 via RC-3).
2. **Dash removed.** Removing only the dash, from both the word list and the text, gives a purchase: 27 lines, 404.28,
   tax 40.95 (derived, RC-5). The 27.56 still missing is RC-8.
3. **RC-8 neutralised too.** 29 lines, 431.84 + 13.39 = 445.23, confidence 1. #427 and `main` parse the untouched
   capture to the same 29 lines.

**Blast radius (prod, 2026-10-19).** Today, 0 Costco receipts have a negative total and 0 have a negative line
(`3mq8x` is repaired). `raw_ocr` holds the cleaned text, so the footer itself cannot be counted: no live receipt's
`raw_ocr` contains `conserver` or `IMPORTANT`, `3mq8x` included. 3 live receipts carry a lone `-` line (`eyrre`,
`c108b`, `r06sa`). None of them sits under a TOTAL, and none matches the v3.0.6 marker.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791776785814_3mq8x` | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | The whole receipt: a 445.23 purchase saved as a −417.67 refund, 27 lines negated and unwatched | Repaired 2026-10-12 (spec); *covered by #427* |

**Fix (applied).** #427 (`207393a`, first tag v3.1.0) changes three things:

- **`detectRefund`.** It accepts the trailing minus only on the amount's own line, and only on the grand total
  (`hasGrandTotalTrailingMinus`).
- **`isRefundText`.** It tests the label line and the next line separately.
- **`syncService.mergeServerIntoLocal`.** A purchase repaired on the server stops being a refund on the phone.

Builds up to 3.0.6 keep the old marker. In the 14 days to 2026-10-17, 13 iOS shoppers were still on 3.0.6
(`Technical/Price_Drop_Audit_3.1.2.md`).

**Proposed parser change (not applied).** Denoise completely: a punctuation-only row that lies within one glyph height
of a row dropped as noise, and inside that row's x-span, is part of that row and is dropped with it.

**Server-side gap (not applied).** Flag a receipt saved with a negative total whose `raw_ocr` carries no refund marker
(`APPROVED - REFUND`, `REMISE D'ACHAT`, a negative article count). Flag it only; don't change it.

## RC-5 · The validator books lost lines as tax: printed TOTAL − Σ lines replaces the TAXE it read

**Printed shape.** Any receipt whose lines were misread (lines lost, a coupon unapplied) while its TOTAL and TAXE were
read right.

**What goes wrong.** Step 2 of `validateReceipt` ("printed-total authority", `src/services/receiptValidator.js`) takes
over when all of these hold:

- a printed total was read;
- Σ lines ≤ printed + 0.02;
- the gap printed − Σ lines is within the province's tax cap;
- the parse does not add up.

It then sets `tax = gap` and `total = printed` (`taxDerivedFromPrinted`). The TAXE the parser read is discarded, the
line error is booked as tax, and the receipt closes on screen with no flag. The design rules forbid exactly this
(step 4: "never balanced by re-deriving a tax or a total"). The step came in with #133 (`c1fe69a`, 2026-07-04), first
tag v2.8.2, and is identical on v3.0.6 and `main`.

**Proof.** Each replay reproduces the stored tax exactly. The parser's own reading of the printed tax is in the same
result, before the validator replaces it:

| Capture | Build | Tax read | Tax after the validator | Σ lines vs paper |
|---|---|---|---|---|
| `mebfs` c85 (adopted) | v3.0.6, `main` | 22.52 | **15.02** (stored) | 305.48 for 297.98 |
| `t09q9` (flat text) | v3.0.6 | 19.23 | **4.23** (stored) | 203.79 for 188.79 |
| `3mq8x` c84 (not adopted) | v3.0.6, `main` | 13.39 | 34.45 | 410.78 for 431.84 |
| `3hhhj` c81 (not adopted) | v3.0.6, `main` | 68.92 | 58.92 | 637.58 for 627.58 |
| `mebfs` c86 (not adopted) | v3.0.6 / `main` | 22.52 | 9.73 / 37.51 | 64.97 / 282.99 for 297.98 |

Neutralising only the line losses gives the read tax back:

- **`mebfs` c85, RC-6 alone:** tax 20.02.
- **`mebfs` c85, RC-2 + RC-14 alone:** tax 17.52.
- **`mebfs` c85, all three:** 297.98 + 22.52 = 320.50, confidence 1 (v3.0.6 and `main`).
- **`t09q9`, `/1177620` → `/1177820` (RC-20):** 188.79 + 19.23 = 208.02 on v3.0.6. `main` has read it right since
  #432.

**Blast radius (prod, 2026-10-19): not measured.** Only 13 of the 102 live Costco receipts have their printed tax on
the label's own line in `raw_ocr`. None of those 13 differs from the stored tax, and on all 13 the lines equal the
printed subtotal. Quebec registers print the totals labels-first (`TAXE` and its amount rows apart), so a same-line
regular expression does not read the others. The measure would replay every live `raw_ocr` through `parseReceiptText`
and compare the tax it reads with `receipts.tax`. Rows where the two differ, and where the stored lines plus the stored
tax equal the stored total, are this root cause.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791777296528_mebfs` | Brossard #521 | 2026-10-12 | iOS 3.0.6 | Tax saved as 15.02 for the printed 22.52; two coupons lost (RC-6; RC-2 + RC-14) | Repaired 2026-10-12 (spec); *covered by #476* |
| `r_1791823503830_w0dv6` | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | Tax 34.87 for 13.39 (= 445.23 − the 410.36 of stored lines) | Duplicate soft-deleted 2026-10-13 |
| `r_1791853201148_ejx4g` | Barrhaven #1263 | 2026-10-13 | Android 3.0.6 | Tax 13.98 for 0.00 | Repaired 2026-10-13 (spec); `main` still reads tax 7 (O-3) |
| `r_1791933708024_t09q9` | Gloucester #1362 | 2026-10-13 | iOS ≤ 3.0.6 | Tax 4.23 for 19.23 (FLATWRE's 15.00 coupon lost, RC-20) | Repaired 2026-10-14 (SQL); the RC-20 trigger *covered by #432* |
| `r_1792607830954_afuor` | Nepean #540 | 2026-10-21 | not recorded | Tax 1.81 for the printed 5.81 (= 160.67 − the 158.86 of stored lines): CRMYDILLPCKL's `0000396742 / 1647794` 4.00- coupon lost (O-4) | Not repaired yet |
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | Tax 19.86 for the printed 45.35 (= 796.14 − the 776.28 of stored lines; RC-26 to RC-29) | Repaired 2026-10-23 (spec); *covered by #476* (next binary) |

**Proposed parser change (not applied).** In step 2:

**Fix (applied, 2026-10-21, client).** In the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`), `validateReceipt` step 2 keeps a tax that was read
(positive, within the province cap) and flags the receipt `printedTotalMismatch` instead of booking the gap as tax; the
total stays the printed one, so the review screen's existing *"the lines add up to … but the receipt's total is …"*
warning shows. The tax is still derived when none was read or it read 0.00 (the pinned "missing tax" shape), when it is
over the cap (a mispaired column), when the printed SUBTOTAL proves the lines right, or when the printed SUBTOTAL and
the read tax do not make the printed TOTAL. Corpus: one golden moves, `3mq8x` c84 (tax 11.39 → the paper's 13.39). The
confidence score is computed before the validator, so no flag changes. New case: `afuor` (2026-10-21, tax 1.81 for 5.81).
Builds up to 3.1.2 keep the old behaviour.

- Keep a tax that was read and is within the province cap.
- When Σ lines + the tax read is not the printed total, flag the parse (`printed_total_mismatch`) and leave the tax as
  read.
- Derive the tax from the printed total only when no tax was read, or when the amount read is above the cap. A
  mispaired column is the case the step was written for.

This is client code, so builds up to 3.0.6 keep the old behaviour.

## RC-6 · A coupon reference with one SKU digit dropped matches no item

**Printed shape.** Brossard #521 printed `9911230 TH CHAUS.8PQ` twice, each line with its own 5,00- coupon. Vision read
the second coupon's reference as `0000393334/991230`: SKU 9911230 with one digit missing.

**What goes wrong.** No item number on the receipt is 991230, so the coupon matches nothing and its 5.00- is dropped.
`resolveDigitMisreadCouponRefs` (`src/services/costcoReceiptParser.js`, #416 `8324e9f`, first tag v3.0.6) repairs a
reference only when it has the same length as an item number and is one digit away from it
(`s.length === ref.length && oneDigitApart`). That covers a substitution, never a deletion, and is unchanged on `main`.
No rule has ever handled a dropped digit, so the defect is in every build.

**Proof (`mebfs` c85, v3.0.6 and `main`).**

1. **Reproduced.** The replay gives exactly the stored 19 lines, Σ 305.48.
2. **Digit written back.** Changing only `/991230` to `/9911230` takes exactly 5.00 off: 300.48.
3. **With RC-2 + RC-14 neutralised too.** 297.98 + 22.52 = 320.50, confidence 1.

**Blast radius (prod, 2026-10-19).** A read-only query found every live coupon reference whose SKU is on no item line
of its own receipt and that becomes an item number by inserting one digit. It found 2 receipts:

- **`mebfs`:** 1 of its 1 references.
- **`vf7c7`:** 2 of its 7 references (Gloucester #1362, scanned 2026-10-18).
  `/38342` stands for 438342 ORG GUAC and `/670109` for 1670109 SCLPD POTATO. Its stored lines carry both coupons
  (11.99 with original 15.99; 8.49 with original 10.99), so nothing is lost there. How they got there is not
  established: an admin reviewed the receipt 11 minutes after the scan.

The same query lists one-digit substitutions, the RC-16/RC-20 shape: `t09q9` (RC-20), `xzw9x` (RC-16), and `o5f38` (2)
and `0l4w3` (1), which were not checked.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791777296528_mebfs` | Brossard #521 | 2026-10-12 | iOS 3.0.6 | The second TH CHAUS.8PQ coupon, 5.00- | Repaired 2026-10-12 (spec); *covered by #476* |

**Proposed parser change (not applied).** Teach the same normalisation step (denoise, before extraction) the deletion
case. Rewrite a reference that is one digit shorter than an item number on the receipt, and equals it with one digit
deleted, to that item number, only when all of these hold:

**Fix (applied, 2026-10-21).** In the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`), `resolveDigitMisreadCouponRefs` learned the deletion: exactly one item number
equals the reference with one digit put back, the item is printed above the coupon, and — when both amounts are on the
rows — priced above it (a labels-first Quebec page prints neither on the item row, so the price guard applies only when
it can be read). A substitution candidate still wins. Pinned: `mebfs` c85 (−5.00, then closes with RC-2 + RC-14),
`vf7c7`'s `/38342` → 438342 and `/670109` → 1670109, and the RC-16 / RC-20 substitutions unchanged. *Covered by
#476*.

- that item number is the only candidate;
- the item is printed above the coupon;
- the item is priced above the coupon amount.

Pin it with:

- `mebfs` c85, which must take off 5.00;
- `vf7c7`, whose two references must rewrite to 438342 and 1670109;
- the RC-16 and RC-20 substitution cases, which must not move.

## RC-7 · A mid-receipt totals block ends item extraction

**Printed shape.** A Quebec register can print a whole block in the middle of one transaction and keep ringing items:

```
SOUS-TOTAL      147,36
TAXE              0,00
**** TOTAL      147,36
Comptant          0,00
```

The final SOUS-TOTAL, NOMBRE D'ARTICLES VENDUS and TOTAL RABAIS prove it is one transaction (Boisbriand #546:
147.36 + the `Bas du panier` block = 325.27, 22 articles; Brossard #521: 64,97 after three items, 297,98 in all).

**What goes wrong.** `parseReceiptEngine` stops item extraction at `findTotalLineIndex`
(`src/services/receiptParsingShared.js`). That function returns the first grand-total line. It was added by commit
`99d524f` (2026-05-26) and moved by #11 (`7c19367`); first tag v2.8.2. Everything printed below the block is lost, and
the printed total is read from the block, so the judge scores every candidate against the wrong total.

**Proof.**

- **`p2s1a` c87 (adopted, v3.0.6).** The replay reproduces the stored 8 lines (86.12, tax 4.99; total 91.11 via
  RC-3). Removing only the block's 8 words (`SOUS-TOTAL 147.36`, `TAXE 0.00`, `**** TOTAL 147.36`, `Comptant 0.00`)
  gives 12 lines, 311.75, line for line #427's and `main`'s parse of the untouched capture.
- **`mebfs` c86 (not adopted).** v3.0.6 stops after 2 lines (64.97). With the block removed it reads 18 lines,
  277.99. On `main` the untouched capture reads 19 lines, 282.99.
- **`mebfs` c85 (adopted).** It escaped: Vision read the block's `74,70` as `74770`, so the block was not recognised.

**Closure owed (`p2s1a`).** The 12 lines do not close to 325.27, and the remaining shapes can't be neutralised from
this capture:

- tender lines are read as items (`Remise Exécutif 146.69`, `-MONNAIE 9.97`);
- `4,19` is read as `1.19`;
- four rows on the faded fold have no amount in the OCR;
- AMIRA's 20.00- is dropped (RC-13);
- BATON CELERI's 6.99 sits on CONCOMBRES (RC-12, proof owed).

On `main` the untouched capture also reads no printed total (`no_printed_total`). None of these is isolated.

**Blast radius (prod, 2026-10-19).** 2 live receipts print two grand-total labels (`\*{3,}\s*-?\s*TOTAL` twice):
`mebfs` and `p2s1a`. Both are repaired.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791777296528_mebfs` | Brossard #521 | 2026-10-12 | iOS 3.0.6 | Nothing stored (the adopted 1200px pass read past the block); the 2000px pass stopped after 2 lines (3 of the 20 articles) | Repaired 2026-10-12 (spec); *covered by #427* |
| `r_1791814977185_p2s1a` | Boisbriand #546 | 2026-10-12 | Android 3.0.6 | The 8 articles printed below the block | Repaired 2026-10-12 (spec); *covered by #427* for the block; still does not close on `main` (see above) |

**Fix (applied).** #427 adds `dropIntermediateTotalsBlocks` (Costco preprocess, on both the geometry rows and the flat
text); first tag v3.1.0. It removes a block only when both of these hold:

- a grand-total row is followed by a zero tender within two rows;
- item rows resume before a later grand total.

A final block, a block paid in cash, and a labels-first block are left unchanged.

## RC-8 · A coupon row with no two-letter word is folded into an item row on a page that wasn't straightened

**Printed shape.** A Quebec coupon row prints only its reference and amount, under the item it reduces:

```
31759 CREVETTES             23,57
0000395030 / 31759           4,00-
1170833 ALLEGRO 9 %          9,99
<number>/1170833             2,00-
```

The coupon row has no word of two letters or more, and often not even a tax flag.

**What goes wrong.** Pass 2 of `reconstructRowsFromAnnotation` (`src/services/receiptGeometry.js`, #27 `0e25784`,
2026-06-03, first tag v2.8.2) treats a row with no word of two letters or more as a stray cell. It folds such a row
into the nearest name row within 1.6 median glyph heights. #413 (`da56eae`, v3.0.6) exempts coupon rows from the fold
only on a straightened page.

On c83 (median 14 px, so pass 1 tolerance 8.4 px and fold gap 22.4 px), the two coupon rows sit 17 px and 16.6 px under
their items. Each becomes a row of its own in pass 1 and is folded back in pass 2. The welded words are emitted left
to right, so the coupon's slash and SKU interleave with the item's name:

```
31759 / CREVETTES 31759 23,57 4,00-
<number>/1170833 1170833 ALLEGRO 9 % 9.99 2,00-
```

No item or coupon pattern reads either row (`splitWeldedCouponRows`, #400 `de640ec`, v3.0.5, expects the item's SKU
and name first). Both items and both coupons are lost: 23.57 − 4.00 + 9.99 − 2.00 = 27.56. On c83 the cleanup had
also deleted CREVETTES's coupon number (RC-11's shape).

**Proof (v3.0.6).** For the neutralisation, each coupon row gets a two-letter tax-flag word right of its amount: `FP`,
as Quebec registers print it (`20.00 - FP` on `p2s1a`). Pass 2 then leaves the row as a row of its own. No other word
and no part of the parser changes.

- **c83, adopted.** With RC-4 neutralised: 29 lines, 431.84 + 13.39 = 445.23, confidence 1. This is line for line
  #427's parse and the hand-read spec (SKU and line total, 29 of 29), with no straightening at all. Control: a
  one-letter flag (`F`) keeps the rows foldable, and the parse stays at 404.28.
- **c84, not adopted.** It folds the same two rows: `31759 CREVETTES / 31759 23.57 4.00- 9` and
  `1170833 / ALLEGRO 1170833 9 % 2.00- 9.99`. With RC-14's marks removed (including a stray `9`) and the same two
  flags: 29 lines, 431.84 + 13.39 = 445.23, confidence 1. `main` gives the same result. The steepest band of c84 is
  0.018, below #427's 0.02 gate, so `main` does not straighten it and the fold stays on.

**Blast radius (prod, 2026-10-19): not measured.** The fold works on Vision's word geometry, which only the captures
carry (R2), not `raw_ocr`.

- **Exposure.** 43 live receipts carry a coupon reference (134 references). Each such row is folded whenever the page
  isn't straightened and the row has no two-letter word.
- **Measure.** Count the coupon rows that pass 2 folds, across the R2 captures.
- **`w0dv6`.** The same paper, scanned again, lost the same CREVETTES / ALLEGRO pair. Its capture is not committed, so
  it is not a proven case.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791776785814_3mq8x` (c83, 1200px, adopted) | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | CREVETTES 23.57 with its 4.00-, ALLEGRO 9.99 with its 2.00-: 27.56 | Repaired 2026-10-12 (spec); *covered by #427* (c83 is straightened, so its coupon rows are exempt) |
| `r_1791776785814_3mq8x` (c84, 2000px, not adopted) | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | CREVETTES 23.57 and ALLEGRO's 2.00- | Nothing stored; still lost on `main` |

**Proposed parser change (not applied).** Never fold a coupon-reference row (`COUPON_REF_ROW`), whether or not the
page was straightened. It is a printed row of the item block, not a stray cell. The code comment keeps level pages
folding because the welded-coupon splitters are tuned to that shape, and three committed receipts (one of them
`5pg85`) move without it. The regression set is those three receipts plus c83 and c84 (c84 also needs RC-14).

## RC-9 · The fixture PII scrub deleted words, so fixtures did not parse like the phone

**Shape.** This is not a printed shape. The tooling that turns a live capture into a committed fixture deleted every
bare word of 10 or more digits and every card mask:

- `scrubWords` in `scripts/captureReceiptOcr.js` (#27 `0e25784`, 2026-06-03);
- then `dropSensitiveWords` in `scripts/lib/receiptPiiScrub.js` (#300 `2debdcd`, 2026-08-26).

A deleted word changes how the geometry rows cluster, and a Quebec coupon number (`0000395030`) is a word the parser
reads. Every replay of a production bug therefore ran on input no phone had seen. This is tooling only; it never
shipped in a binary.

**Proof (`3mq8x` c83, v3.0.6).** The faithful fixture reproduces the phone's refund (27 lines, Σ −404.28).
Re-applying the old drop to it (232 words → 225, 7 dropped) gives a purchase: 404.28, tax 40.95. With those words
gone, two payment-block fragments become rows between the TOTAL and the dash, and RC-4 disappears from the corpus.

**Blast radius.** Corpus only. #427 rebuilt 22 prod-capture fixtures. The faithful rebuild changed what two of them
parse to, and the 112 existing goldens did not move.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791776785814_3mq8x` c83 fixture | Sherbrooke #1367 | 2026-10-12 | fixture tooling | It parsed as a purchase while the phone saved a refund, so RC-4 was invisible in the corpus | Rebuilt by #427 |
| `r_1791573195154_8y5tt` c47 fixture | Boisbriand #546 | 2026-10-09 | fixture tooling | It hid a banner weld on the first item | Rebuilt by #427; the weld scrubbed in `costcoReceiptNoise.fr.js` |

**Fix (applied).** #427 (first tag v3.1.0) changes the fixture tooling:

- **Mask, don't drop.** `maskSensitiveWords` turns digits into 9 and card tails into X.
- **Coupon numbers kept.** Costco coupon numbers (`COUPON_NUMBER_RE = /^0{3,4}3\d{5}$/`) stay verbatim.
- **Fixtures rebuilt.** `scripts/rebuildOcrCaptureFixtures.js` rebuilds them from the local envelopes.
- **Fidelity test.** `receiptFixtureFidelity.test.js` requires a fixture to parse exactly like its envelope (53/53).

## RC-10 · The warehouse is read from the header before the register footer

**Printed shape.** The Quebec header prints the city and the number on two lines (`Boisbriand` / `#546`). At the
bottom, the register prints its line `Entr:546 Trm:… Trans:… OP:…` and the transaction footer
`2026/10/10 12:05:26 546 …`. On `p2s1a` c87, Vision read the header as `Boinbr Land` / `#516`.

**What goes wrong.** `extractWarehouseId` (`src/services/receiptParsingShared.js`) reads the cleaned text, and two
things go wrong:

- **The `Entr:` line never reaches it.** The cleanup's `trans-seq` rule
  (`/\b(?:SEQUENCE|SEQ|BATCH|TRANS(?:ACTION)?)\s*[:#]/i`, #127, v2.8.2) drops the row because it carries `Trans :`.
  The `Entr` pattern (#367 `6755437`, first tag v3.0.1) is dead on these receipts. On c87, the cleanup's rows even put
  the word `Entr` on a row of its own.
- **The header pattern wins before the footer.** The Title-Case header pattern `[A-Za-zÀ-ÿ]{3,20}\s+#\s*(\d{3,5})`
  (#131 `e8b0db0`, 2026-07-03, v2.8.2) matches `Land` + newline + `#516`, because `\s+` spans the newline. The footer
  pattern (#398 `ca2be0d`, v3.0.5) is tried last.

So the receipt, its price points and its watches were filed under Sainte-Foy #516.

**Proof (c87, v3.0.6).** The replay reads 516, as the scan stored it. Writing the header as `#546` gives 546; removing
the header number gives 546, read from the footer. The 8 lines do not move. #427 reads 546 from the untouched capture.

**Blast radius (prod, 2026-10-19).** 48 of the 102 live receipts carry a register number in `raw_ocr` (`Whse:`,
`Entr:` or the transaction footer), and 0 of them disagree with the stored warehouse (`p2s1a` was repaired before the
query). #427's corpus diff found two more wrong readings. Prod stored the right number for both, so they are corpus
cases only:

- `zm6h2`: 3542 → 542 (a pen stroke over the header);
- `8y5tt` c45: 544 → 546.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791814977185_p2s1a` | Boisbriand #546 | 2026-10-12 | Android 3.0.6 | Filed under Sainte-Foy #516 with its 27 price points and its watches | Repaired 2026-10-12 (guarded SQL: receipt and 27 price points moved to #546); *covered by #427*. **The shopper's phone still showed Sainte-Foy on 3.1.2 (reported 2026-10-21):** not this parser cause but a sync one: the hydrate merge never took the server's warehouse, so the phone's own 3.0.6 reading stayed. Fixed on the client (Bugs #340, `hotfix/sync-server-authoritative-header`) |
| `r_1791125306407_zm6h2` (corpus) | Gatineau #542 | 2026-10-04 | not recorded | The replay read 3542; prod stored 542 | *Covered by #427* |
| `r_1791573195154_8y5tt` c45 (corpus) | Boisbriand #546 | 2026-10-09 | Android 3.0.5 | The replay of the 2000px capture read 544; prod stored 546 | *Covered by #427* |

**Fix (applied).** #427 (first tag v3.1.0) reads the footer right after the `whse` / `Entr` lines.

**Proposed parser change (not applied).** Identify before denoising (design rules, step 1). Read the warehouse from the
register line and the footer on the raw text, before the cleanup drops the `Trans :` row, and use the header only as a
fallback.

## RC-11 · The cleanup deletes a coupon number that Vision returned as its own word, which defeats the minus-less coupon rule

**Printed shape.** `0000394188 / 469627  5.00- H` under `469627 FERRERO 48CT  21.99 H`, the last item before
SUBTOTAL. On `3hhhj` c81 (1200px), Vision lost the minus (`5.00`) and returned the coupon number as its own word.

**What goes wrong.** Three steps lose the coupon:

1. **The cleanup deletes the number.** `SENSITIVE_WORD_PATTERNS` (`shared/ocrCleanup.js`, #127 `02e9ec6`, v2.8.2)
   deletes every bare word of 10 or more digits from the geometry. The coupon number goes, and the row becomes
   `/ 469627 5.00 H`.
2. **Pass 2 folds the row into SUBTOTAL.** Median glyph height is 43 px, so the fold gap is 68.8 px. The row is 64.9 px
   from SUBTOTAL's row and 65.5 px from FERRERO's, so it is folded into `SUBTOTAL / 469627 627.58 5.00 H`.
3. **No rule can read it.** The minus-less coupon rule (`unsignedCouponRow`, #413 `da56eae`, v3.0.6) needs the number
   (`^\s*\d{6,}\s*\/{1,2}\s*(\d{3,8})…`).

FERRERO keeps 21.99, and the 5.00 is read as a positive "Unknown item": +10.00.

**Proof (v3.0.6 and `main`).** c81 reads 23 lines, 637.58, tax 58.92 (read 68.92; RC-5). Either of two
neutralisations closes it: restoring the minus, or writing the reference as one word (`0000394188/469627`), which the
cleanup keeps. Each gives 22 lines, 627.58 + 68.92 = 696.50, confidence 0.95 (missing date). That is exactly c82, the
2000px pass the phone adopted and stored.

**Blast radius (prod, 2026-10-19).** In `raw_ocr`, 89 of the 134 live coupon references have a space before the slash,
on 34 of the 43 receipts that carry one. In the flat text that means the number is a word of its own, which is the
shape the cleanup deletes. None of the 134 lost its slash. Damage also needs a lost minus or a fold, which only the
captures show: not measured.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791753175518_3hhhj` (c81, 1200px, not adopted) | Gloucester #1362 | 2026-10-11 | Android 3.0.6 | FERRERO's 5.00- unapplied, and a positive 5.00 "Unknown item" | Nothing stored (c82 adopted, right against the paper); *covered by #476* |

**Proposed parser change (not applied).** Two changes:

**Fix (applied, 2026-10-21).** In the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`), both halves, narrowed by the corpus:

- **Keep Costco's coupon number** only when its row reads as the coupon: the number first, then `/ <sku>` or
  `/ MULTIPLE` (`COUPON_REFERENCE_ROW_RE`). Kept on any row, it landed in front of item names on `3mq8x` c84's tilted
  band and was read as ALLEGRO's SKU; the Costco preprocess also drops a coupon number that an item number and more text
  follow (`dropCouponNumberBeforeSku`), never one followed by its slash (`0000389137 / PUREX` stays a coupon). #413's rule
  (a minus-less coupon needs its barcode) is unchanged — it is the barcode that now survives.
- **Respect the totals block** for a SUBTOTAL / TAX / TOTAL row that already carries its amount. A totals label with no
  amount still takes the fold: the unreadable `5pg85` is flagged through it.

`3hhhj` c81 now reads 22 lines, 627.58 + 68.92 = 696.50, confidence 0.95 (no date — as c82): `parser_gap` → `ok`.

- **Keep Costco's coupon number.** Exempt `^0{3,4}3\d{5}$`, the shape #427's fixture scrub already keeps verbatim,
  from the cleanup's sensitive-word deletion. It is a public promotion code, not PII.
- **Respect the totals block.** Pass 2 never folds a row into a totals-label row (`SUBTOTAL`, `TAX`, `TOTAL`): that is
  a block boundary.

## RC-12 · The tilt gate reads the page median, so a curled band is not straightened

**Printed shape.** A curled or tilted photo whose slope changes down the page. `p2s1a` c87 is about 0.21 at the top
left and about 0.07 lower down (#427's measure). `3mq8x` c83 is level except for one band.

**What goes wrong.** `deskewWords` (`src/services/receiptGeometry.js`, #413 `da56eae`, 2026-10-09, first tag v3.0.6)
gates on the page-wide weighted median of neighbour-pair samples (a word and its nearest right-hand neighbour on the
same line). The first pass needs 0.075; a score-gated second pass needs 0.02. At a steep tilt the same-line test
rejects real pairs, and a page median hides a steep band:

| Capture | v3.0.6 page median (samples) | #427 steepest band |
|---|---|---|
| `3mq8x` c83 | 0 (83): never straightened | 0.024: straightened in the second pass |
| `3mq8x` c84 | 0 (84) | 0.018: not straightened on `main` either |
| `p2s1a` c87 | 0.0205 (124): second pass only | 0.212: first pass |
| `p2s1a` c88 | 0.042 (131): second pass only | 0.209 |
| `mebfs` c85 / c86 | 0 (127) / 0 (131) | 0.046 / 0.043 |

**Proof owed, for every case.**

- **`3mq8x`: no price was a row off.** With RC-4 and RC-8 neutralised, the unstraightened rows give all 29 lines, line
  for line the spec (RC-8). Straightening the page also closes c83: on v3.0.6 when the page is rotated by 0.08 so that
  v3.0.6's own gate fires, and on #427. It closes because straightening turns on #413's coupon-row exemption, not
  because rows were mispaired.
- **`p2s1a`: the stored mispairing is in the flat candidate.** BATON CELERI is lost and its 6.99 sits on CONCOMBRES.
  The parse adopted on v3.0.6, #427 and `main` alike is the flat candidate (`geometryUsed: false`). #427 straightens
  the geometry rows, and BATON CELERI takes its 6.99 there, but the rows below stay a row off and that candidate still
  loses. Feeding v3.0.6 the words already levelled by #427 changes nothing.
- **`w0dv6` and `7yckq`.** Their captures are not committed.

**Blast radius: not measured.** The gate works on word geometry, which only the captures carry.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791776785814_3mq8x` (c83) | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | Not an RC-12 loss: the 27.56 is RC-8 | *Covered by #427* (its straightening turns RC-8's exemption on) |
| `r_1791814977185_p2s1a` (c87) | Boisbriand #546 | 2026-10-12 | Android 3.0.6 | Not established: BATON CELERI lost, its 6.99 on CONCOMBRES (flat candidate) | Repaired 2026-10-12 (spec); the same pairing on #427 and `main`; proof owed |
| `r_1791823503830_w0dv6` | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | 410.36 for 431.84 (CREVETTES, ALLEGRO and their coupons, AILES DE POU, BOUNTY's TPD) | Duplicate soft-deleted 2026-10-13; closes on `main`, *covered by #427* as a whole; cause not isolated |
| `r_1791853110451_7yckq` | Barrhaven #1263 | 2026-10-13 | Android 3.0.6 | Every price a row off (2000px adopted), `/MULTIPLE 7.00-` lost | Spec 2026-10-13; on `main` the sum closes but the first two rows stay mispaired (O-1) |
| `r_1792728211191_tv798` (c265, c266) | Windsor #534 | 2026-10-23 | iOS 3.1.2 | A curled photo: every coupon row welded onto the next item row (`0000394669 1931258 AVEENO / 97700 BW 40.00- 19.99 H`); 727.35 / 741.35 for 750.79 with #480 | Deleted by the shopper, who rescanned (`vi24j`, c268); both captures pinned `parser_gap` (flagged); proof owed |

**Fix (applied).** #427 (first tag v3.1.0) makes three changes:

- **Each word's own baseline.** The geometry reads the slope of each word from Vision's polygon (`wordSlopeSamples`;
  needs at least 12 words carrying one).
- **The steepest band.** The gate reads the steepest band of the page (a window of 6 glyph heights, at least 5 samples)
  instead of the page median.
- **Traced rows.** Each word is traced to the centre line through its nearest words' baselines (`traceWords`).

A page whose steepest band is under 0.02 (c84) is still not straightened, and RC-8 applies to it.

## RC-13 · The `account` noise rule drops a tilted row carrying the word `Compte` of the bottom-of-basket banner

**Printed shape.** French registers print the bottom-of-basket count (`BOB Count` in English) as a banner between
items, `***** Compte bas du panier N *****`, and a trailer at the end, `Compte total bas du panier - N`.

**What goes wrong.** The `account` noise rule (`shared/ocrCleanup.js`, `/\b(?:ACCT|ACCOUNT|COMPTE)\b\s*[:#]?/i`, #127
`02e9ec6`, first tag v2.8.2) was written for the payment block's `COMPTE : <card type>`. Its colon is optional, so the
word `Compte` anywhere drops the whole row. On a level page the banner is a row of its own and dropping it is harmless
(c52, c77). On a tilted band, the cleanup's row anchoring splits the banner across the rows of an item or a coupon:

- **`4qp2s` c72.** The banner splits into `bas du panier 8.99` (phrase scrubbed, `8.99` kept) and
  `***** Compte FLAKES`. The `account` rule drops the second row, so the item row reads `427383 CORN 8.99`.
- **`p2s1a` c87.** `***** - Compte bas du 20.00 - FP` is dropped (c88: `**** - Compte bas 20.00 - FP`). That row
  carries AMIRA's 20.00- coupon.

The English banner words (`BOB`, `COUNT`, `BOTTOM`, `BASKET`) are banner vocabulary (`BANNER_WORD_RE`). `COMPTE` is not
banner vocabulary, only a noise-row trigger, so this happens on French receipts only.

**Proof.**

- **`4qp2s` c72 (v3.0.6 and `main`).** The totals already closed: 16 lines, 556.34 + 65.74 = 622.08, confidence 1.
  Dropping only the word `Compte` restores `CORN FLAKES`, with the totals unchanged.
- **`p2s1a`: proof owed.** Dropping `Compte` changes nothing measurable. On v3.0.6, RC-7 ends extraction above the
  row; on `main`, AMIRA itself is not among the 12 lines.

**Blast radius (prod, 2026-10-19).** `raw_ocr` is the cleaned text, where the banner phrase is already scrubbed (0 live
receipts contain `panier`). Counted instead by its `Compte total` trailer, 8 live receipts carry the banner: `lav05`,
`0l4w3`, `p6cxu`, `4qp2s`, `8wims`, `p2s1a`, `u8xbn`, `o5f38`. Of those:

- **`p6cxu` (c52) and `8wims` (c77):** the banner is on its own row, so nothing is lost.
- **`u8xbn`:** parses right (RC-3's table).
- **`lav05`, `0l4w3` and `o5f38`:** not checked.

One live receipt prints the English `Bottom of Basket` / `BOB`.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791723518253_4qp2s` | Sherbrooke #1367 | 2026-10-11 | iOS 3.0.6 | Product 427383's catalogue name saved as `CORN` | Repaired 2026-10-13 (spec renamed it); *covered by `hotfix/receipt-total-fence-footer`* (c72 reads `CORN FLAKES`) |
| `r_1791814977185_p2s1a` | Boisbriand #546 | 2026-10-12 | Android 3.0.6 | AMIRA's 20.00- coupon | Repaired 2026-10-12 (spec); *covered by `hotfix/receipt-total-fence-footer`* (c87 applies the coupon, 69.99 → 49.99); the capture stays a parser gap for its other rows (RC-12) |
| `r_1792722373237_t7iig` | Rimouski #1720 | 2026-10-23 | not recorded | Stored right (the pass that was kept); 3 of its 4 passes lost a line — the banner, split over three rows, took `ESSUIE 25.99` (c261) or LEMON's row with it | Not repaired; *covered by `hotfix/receipt-total-fence-footer`*: c261 and c262 close to the cent; c259/c260 are RC-12 (the curl shifts the totals block a row down) |

**Fix (applied, `hotfix/receipt-total-fence-footer`, 2026-10-28; Maxim: *"Add to the noise cancelation … and the
equivalent values in french"*).** The French count banner is denoised as a banner (design rules, step 2):

- **Scrubbed inline.** `FR_BOB_COUNT_RE` (`COMPTE (TOTAL )?BAS DU PANIER` and its count — eaten only behind
  whitespace, `=` or the closing asterisks) joins `BANNER_NOISE_RES`, so a welded item or coupon keeps its words; the
  footer's `Compte total bas du panier=1` goes with it. A framed banner may end with its count
  (`***** Compte bas du panjer 1 ******`), whatever its misread words.
- **By reading order.** A curled photo spreads the banner over several rows (`t7iig` c262: `***** ESSUIE 25.99 FP` /
  `Compte bas du` / `2014600 panier 1 ******`), so no row holds the phrase. Vision still reads its words one after
  another, so they are matched on that sequence and leave the geometry before the rows are built. This banner only:
  taking every banner out that way changed how a tilted page is straightened and cost `x850x` a right line.
- **The `account` rule narrowed** to the payment line it was written for: the label and its separator (`COMPTE:`,
  `ACCT:`, `ACCOUNT #`), or alone / with a card brand when OCR lost the colon (`COMPTE MASTERCORD`, the app's
  `Account` tab).
- **A row left with nothing but decoration** once the member number is gone (the `Bas du panier` banner's opening
  `*********`) is dropped: it welded onto the first item and pushed its SKU off the row start.
- **Proof.** Golden snapshot: `4qp2s` c72 `CORN` → `CORN FLAKES`; `p2s1a` c87 applies AMIRA's 20.00- coupon; `t7iig`
  c261 goes from one line (0.4) to both lines closing to the cent (1.0), c262 gets its SKU back (0.9 → 1.0). No `ok`
  capture changed. The keep-the-minus concern did not arise: the coupon's minus survives on every capture.

## RC-14 · Margin marks read as 1–2-character words join item and coupon rows

**Printed shape.** Marks outside the printed column: pen ticks, a fold, the paper's edge. Vision returns each one as a
word of one or two characters:

- **`3mq8x` c84** (median glyph height 23 px; the text spans x 731–1266):
  - `1` and `'` at x 203–247, height 44 (1.91 × median), slope 0.31, on NESTLE's row;
  - `=` at x 1929–1976, height 48 (2.09 ×), on KS BEUR.NOIX's row;
  - a stray `9` at x 1456–1476, height 16 (0.70 ×), with no baseline from Vision, on CREVETTES's coupon row.
- **`mebfs` c85** (median 12 px; the text spans x 520–755):
  - `P` at x 397–413, height 18 (1.5 ×);
  - `D` at x 781–942, height 150 (12.5 ×).

  Both sit on SWEETSIXTEEN's coupon row.

**What goes wrong.** `reconstructRowsFromAnnotation` (`src/services/receiptGeometry.js`, #27 `0e25784`, first tag
v2.8.2) clusters every word by its height on the page alone, wherever it sits across. A mark therefore joins the row
at its height, and the row stops matching its pattern:

- `1 ' 2942699 NESTLE 130CT 26.49 FP`: the item number is no longer at the row start, so NESTLE's 6.50- coupon is not
  applied.
- `1290439 KS BEUR.NOIX 9.99 =`: the item is lost.
- `/ 31759 4.00- 9`: CREVETTES's coupon is unreadable.
- `P 1448438 2.50 - FP D`: SWEETSIXTEEN's coupon is lost. Here the slash was also lost and the cleanup deleted the
  bare coupon number (RC-2's spaced variant).

**Proof (v3.0.6 and `main`).**

- **`mebfs` c85, adopted.** Removing the two marks alone changes nothing. Writing the reference back as one word with
  its slash (`<number>/1448438`) alone changes nothing. Both together take off 2.50 (302.98). With RC-6 as well:
  297.98 + 22.52 = 320.50, confidence 1.
- **`3mq8x` c84, not adopted.** Removing `1 '` applies NESTLE's coupon: 404.28. Removing `=` as well brings back
  KS BEUR.NOIX 9.99: 414.27. With the stray `9` gone too and RC-8 neutralised: 431.84 + 13.39 = 445.23, confidence 1.

**Blast radius: not measured.** The marks are word geometry. The measure is a sweep of the R2 captures for 1–2
character words outside the item columns' x-span, which a cloud session cannot reach.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791776785814_3mq8x` (c84, 2000px, not adopted) | Sherbrooke #1367 | 2026-10-12 | iOS 3.0.6 | NESTLE's 6.50- (`1 '`), KS BEUR.NOIX 9.99 (`=`), CREVETTES's 4.00- (`9`) | Nothing stored; *covered by #476* (all three; ALLEGRO's coupon remains, RC-8) |
| `r_1791777296528_mebfs` (c85, 1200px, adopted) | Brossard #521 | 2026-10-12 | iOS 3.0.6 | SWEETSIXTEEN's 2.50- (with RC-2) | Repaired 2026-10-12 (spec); *covered by #476* |

**Proposed parser change (not applied).** Treat this as an image problem, handled in geometry (design rules): before
rows are built, drop any word of one or two characters whose box lies wholly outside the item block's x-span by more
than one median glyph height. Height is not a criterion, since c84's `9` is smaller than the print.

**Fix (applied, 2026-10-21).** In the Costco parser PR of 2026-10-21 (Priceback #476, `fix/costco-parser-open-root-causes`), `dropMarginMarks` (`receiptGeometry.js`, before rows are built):
a 1–2 character word wholly outside the 2nd–98th percentile x-span of the 3+-character words is dropped when it is more
than **3** median glyph heights away (the documented marks sit 9.7–31 away) or over 3× the print's height (`mebfs`'s
`D`). The corpus forced both thresholds: at one glyph height it dropped a tax flag on `4qp2s` c72 (`ER`, 1.2 away) and the
`2 @` quantities of the `i7aiw` PDF. PDF coordinates (normalised) are skipped. `mebfs` c86 closes to the cent; `3mq8x`
c84 goes from 21.06 short to 2.00 over (NESTLE's coupon, KS BEUR.NOIX, CREVETTES's coupon recovered; ALLEGRO's 2,00- is
still lost to the tilted band — RC-8) and stays flagged.

- **Measuring the span.** The span comes from the rows that carry an item number and an amount, by percentiles. The
  marks themselves sit on item rows, so a plain minimum and maximum would include them.
- **Regression set.** Pin with c84 and c85, plus a receipt whose tax flags (`FP`, `H`) sit at the right edge of the
  span; those flags must stay.

---

## 2026-10-13 · October receipts review — cases

Maxim's triage: `admin_reviewed_at IS NULL` and **purchase date** in October. 13 live receipts; 7 right against their
paper (`21xro`, `bjkt6`, `t67po`, `xc09c`, `p6cxu`, `8wims`, `3hhhj`) and stamped reviewed; 6 handled below. Every
case was replayed through the parser **of the build that scanned it** (worktrees at `v3.0.5` / `v3.0.6`) and
reproduced the stored lines exactly before a cause was named, then replayed through `main` (`207393a`).

| Receipt | Store | Scanned | Build | What was wrong | Cause | On `main` | Repair |
|---|---|---|---|---|---|---|---|
| `r_1791823503830_w0dv6` | Sherbrooke #1367 | 10-12 | iOS 3.0.6 | Same paper as `3mq8x` re-scanned 13 h later: 410.36 lines, tax 34.87 (paper 431.84 / 13.39 / 445.23); CREVETTES + ALLEGRO + coupons, AILES DE POU, BOUNTY's TPD lost | RC-12 unproven: the same paper's `3mq8x` c83 turned out to be RC-8, not RC-12 (see RC-8 and RC-12, 2026-10-19), and this capture is not committed, so its own cause is owed; #427 as a whole closes it + RC-5 (tax) | Closes to the cent (431.84, 29 lines) — *covered by #427* | **Duplicate soft-deleted** (Maxim): 25 price points removed, 22 watch entries removed, reviewed + skip-optimisation |
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

## 2026-10-21 · `afuor` (Nepean #540) — cases

Reported by Maxim minutes after the scan: *"PAY STATION"* in a product name, and the admin desk's *Fix automatically*
proposed merging the two `39602 PICKEREL` lines.

| Printed (paper) | Stored | Cause |
|---|---|---|
| `*** PAY STATION ***` banner, then `39602 PICKEREL 23.30` | line 1 named `PAY STATION PICKEREL` | RC-18 (the banner is in no vocabulary) |
| `1647794 CRMYDILLPCKL` `2 @ 8.99` `17.98`, `2 @ 2.00`, `0000396742 / 1647794` `4.00-` | 17.98, no coupon | **O-4**, open |
| SUBTOTAL 154.86, TAX 5.81, TOTAL 160.67 | lines 158.86, tax **1.81**, total 160.67 | RC-5 (the 4.00 booked as tax) |
| two packs of `39602 PICKEREL`: 23.30 and 20.85 | two lines (right) | — the parser folds a repeated SKU only at the same unit price |

**Not the parser — the admin button (Bugs #338, Priceback #475).** Gemini's proposal folded the two PICKEREL packs into one
"quantity 2" line: `receiptAutoFix.groupQuantities` folded every repeat of an item number, whatever its price, and its
prompt said *"ALWAYS group a quantity on ONE line"*. The same proposal kept the stored `PAY STATION PICKEREL` (a known
SKU keeps its stored name), and `readPrintedFigures` read this receipt's labels-first totals block as TOTAL **154.86**,
so even a right proposal would have been refused (`total_on_paper`).

**O-4 · open — reproduced: no.** The flat replay of `raw_ocr` through `main` **applies** the 4.00 coupon (13.98), so the
loss is on the geometry path the phone ran; the capture (R2) could not be pulled from this session (`railway run` was
refused by the permission classifier). Next step: `railway run -e production node scripts/exportOcrCaptures.js
--receipt r_1792607830954_afuor`, replay `<receipt>__c<id>`, and neutralise. Suspects, unproven: the `2 @ 2.00` multi-unit
coupon line printed between the item and its reference; the coupon number (10 digits) deleted by the cleanup, leaving
`/ 1647794` + `4.00-`.

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
| `r_1791723518253_4qp2s` | Sherbrooke #1367 | 2026-10-11 | iOS 3.0.6 | Catalogue name of 1119338 | Repaired 2026-10-13 (spec renamed it); *covered by Priceback #475* (c72 now reads `BATTERIE KS`) |
| `r_1792607830954_afuor` | Nepean #540 | 2026-10-21 | not recorded | `*** PAY STATION ***` (an English lane marker in no vocabulary) welded into the first item: line stored `PAY STATION PICKEREL`. The same banner is on `t09q9` (Gloucester #1362), whose first name was not hit | **Not repaired yet** (Maxim's call); *covered by Priceback #475* (2026-10-21 hotfix) |

**Proposed parser change (not applied).** Denoise first (design rules, step 2): a row whose text is bounded by
`*{3,}` runs is a banner, whatever words it holds, and is removed as a row before item extraction — in both languages.

**Fix (applied, 2026-10-21, shared cleanup, Priceback #475 — Maxim asked for it).** `shared/ocrCleanup.js`: a `***…***` span with letters
and no digit is banner noise in any language (line, inline, and as a word span on a geometry row:
`framedBannerWordIndexes`), and `PAY STATION` joins the English vocabulary for when Vision loses the asterisks. A
priced item never matches (no digit inside the frame) and the two-asterisk `**KS TOWEL**` item stays an item. Golden
corpus: 6 captures lose only their banner line from the persisted text; c72's name becomes `BATTERIE KS`; nothing else
moves. The server's Gemini paths use the same list (`backend/lib/receiptLlmRules.js`).

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

## 2026-10-14 · three receipts scanned on the evening of 2026-10-13 — cases

Selection (Monica): scanned 2026-10-13 (local), `admin_reviewed_at IS NULL`, not expired (`policy_status` ≠ expired),
not deleted. Exactly three. The OCR captures (R2) are not reachable from a cloud session, so each was replayed from
`receipts.raw_ocr` (flat text, header from `header_ocr` put back) through `parseCostcoReceipt` on **v3.0.6** and on
`main` (`fe53090`) — both give the same result — and each blamed shape was neutralised alone in the input.

| Receipt | Store | Purchase · scanned | Paper (subtotal + tax = total) | Stored | What was wrong | Cause |
|---|---|---|---|---|---|---|
| `r_1791931739349_fpnqe` | Sainte-Foy #516 (QC) | 10-13 · 10-13 | 78.45 + 7.49 = 85.94 | 4 lines, 71.46 + 7.49 = 78.95 | `77264 PAIN HAMB. 6.99` lost — a KOHLER installation leaflet lay on the receipt and its text streamed between the item row and its price | RC-23 + RC-3 |
| `r_1791933620723_g7ntk` | Nepean #540 (ON) | 10-09 · 10-13 | 288.82 + 18.00 = 306.82 | 16 lines, 292.82 + 18.00 = 310.82 | BEYOND BURGE ×3 stored as QT 2 + a separate "Unknown item" QT 1 (catalogue product 5338620 renamed "Unknown item"); CAD MILK MIN's 4.00 coupon lost; KS VIT D flagged couponed (it is not) | RC-21 + RC-22 + RC-3; RC-24 found on the replay |
| `r_1791933708024_t09q9` | Gloucester #1362 (ON) | 09-16 · 10-13 | 188.79 + 19.23 = 208.02 | 8 lines, 203.79 + **4.23** = 208.02 | 60PC FLATWRE's 15.00 coupon lost; the validator then back-computed the tax so the receipt looked closed | RC-20 + RC-5 |

**Replay fidelity.** `t09q9` reproduces the stored lines exactly. `g7ntk` reproduces both blamed symptoms exactly (the
SKU-less "Unknown item" 18.99 beside BEYOND BURGE QT 2; CAD MILK at 19.99) but the flat replay also loses GAP JOGGER
(RC-24), which the shopper's geometry parse kept. `fpnqe`'s flat replay keeps the 6.99 but under the leaflet line
`• Patents: kohl`; the geometry parse lost it altogether. Both differences are the geometry path, which only the
capture can replay.

**Repairs** (2026-10-14 ~01:50 UTC, in-place SQL through the Supabase connector, guarded `DO` blocks, on Monica's
go-ahead "if it match to the cent"): lines, price points (paid / regular / on sale), total or tax,
`admin_reviewed_at`, the watch-registry entries, product 5338620 renamed back to `BEYOND BURGE`, product 77264
`PAIN HAMB.` created. `g7ntk`'s extra burger line was **soft-deleted** the way the app removes a line
(`receiptsRepo.softDeleteItemForUser`; its 18.99 price point kept) — a hard `DELETE` through the connector waits on a
confirmation prompt that does not reach a project thread. Verified after: 85.94 / 306.82 / 208.02, each Σ lines + tax
to the cent. The R2 photos were not re-read (the connector has no object read); the proof is each paper's own
printed SUBTOTAL / TAX / TOTAL. `skip_parser_optimization`
left false (readable photos, parser faults). SQL committed for the record:
`backend/data/bad-scan-repairs/2026-10-14-three-receipts.sql` (Priceback).

**Parser fix:** Priceback PR #432 "receipts: five parser root causes from the 2026-10-13 scans (RC-20 … RC-24)" — every
rule below is a denoise / normalisation step before extraction (design rules §2 step 2), none is a branch in the
extractor. All three receipts then close to the cent on the flat replay; the receipt test corpus is unchanged
(3392 tests).

## RC-20 · A coupon for an item whose name opens with digits is never resolved

**Printed shape.** `1177820 60PC FLATWRE` / `69.99 H` / `0000389077 /1177620` / `15.00- H` — the coupon's reference
read with one digit wrong (8 → 6).

**What goes wrong.** `resolveDigitMisreadCouponRefs` (`costcoReceiptParser.js`, #416 `8324e9f`, first in v3.0.6)
rewrites a one-digit-off reference to the only item number on the receipt it can be. Its candidate list is built with
`PRINTED_ITEM_SKU = /^\s*(\d{3,8})\s+(?!TPD|CPN)[A-Z]/` — a name must start with a **letter**, so `60PC FLATWRE`'s
1177820 was never a candidate, the reference stayed `/1177620`, the coupon matched nothing and was dropped.

**Proof.** Replay of `t09q9` (v3.0.6 and `main`) reproduces the 8 stored lines exactly (Σ 203.79). Changing only
`/1177620` → `/1177820` in the input: FLATWRE 54.99 (op 69.99), Σ 188.79 = SOUS-TOTAL, + 19.23 = 208.02.

**Blast radius (prod, 2026-10-14):** receipts with a digit-led item name: `qvs25`, `5clwk`, `t09q9`, `x850x`. Only a
coupon whose reference is *also* misread is affected; `t09q9` is the only one found.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791933708024_t09q9` | Gloucester #1362 | 2026-10-13 | iOS ≤ 3.0.6 | FLATWRE's 15.00- (and the tax, via RC-5) | Repaired 2026-10-14 (SQL); *covered by the PR above* |

**Fix (applied).** The candidate test accepts digits then a letter in the first word (`\d*[A-Z]`).

## RC-21 · A stray bracket glued to the item number: the row loses its SKU

**Printed shape.** Three identical rows `5338620 BEYOND BURGE 18.99`, the third read `5338620) BEYOND BURGE`.

**What goes wrong.** No item pattern reads `5338620)` as a SKU, so the row became a SKU-less `Unknown item` 18.99 and
`pushOrMergeItem` (which folds identical SKUs into one line, QT n) could not merge it: QT 2 + QT 1 instead of one
line QT 3. In prod the SKU was later attached to the "Unknown item" line, so catalogue product 5338620 was renamed
`Unknown item` (last writer wins).

**Proof.** Removing only the `)`: one line `BEYOND BURGE` QT 3, 56.97.

**Blast radius (prod):** `g7ntk` only.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791933620723_g7ntk` | Nepean #540 | 2026-10-13 | iOS ≤ 3.0.6 | The QT 3 grouping; the product's name | Repaired 2026-10-14 (SQL); *covered by the PR above* |

**Fix (applied).** `dropSkuStrayBracket`: a `)`, `]`, `}` or `|` directly after a 3–8 digit number at the start of a
row, before a name, is dropped.

## RC-22 · A coupon amount read with a second minus (`4.00- -`)

**Printed shape.** `0000390137 /2743223` / `4.00- -`.

**What goes wrong.** Every coupon pattern wants the amount, one minus and at most a tax flag; the extra `-` made the
amount line unreadable, so CAD MILK MIN kept its full 19.99.

**Proof.** Replacing `4.00- -` by `4.00-` alone: CAD MILK 15.99 (op 19.99), 4.00 closer to the subtotal.

**Blast radius (prod):** `g7ntk` only.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791933620723_g7ntk` | Nepean #540 | 2026-10-13 | iOS ≤ 3.0.6 | CAD MILK MIN's 4.00- | Repaired 2026-10-14 (SQL); *covered by the PR above* |

**Fix (applied).** `collapseDoubledAmountMinus`: a run of minus signs after an amount at the end of a row is one.

## RC-23 · Text from another document in the photo reaches the item block

**Printed shape.** A product leaflet (KOHLER faucet installation sheet) lying on the receipt. Vision streams its
fragments (`VE THESE I`, `ovided Tools`, `a. Thread Seal`, `USA/Canada`, `• Patents: kohl`, …) between
`77264 PAIN HAMB.` and its price `6.99`.

**What goes wrong.** Nothing removed the leaflet: the leaflet line right above the price took it (flat path), or the
item was lost (the shopper's geometry parse). A Costco register prints in capitals only, so lower-case prose inside
the item block is never the receipt's.

**Proof.** Removing only the leaflet lines between the item row and its price: 5 lines, 78.45 = SOUS-TOTAL, + 7.49 =
85.94.

**Blast radius:** not measured — the shape (prose lines inside the item block) has no cheap SQL signature; `fpnqe` is
the case found.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791931739349_fpnqe` | Sainte-Foy #516 | 2026-10-13 | iOS ≤ 3.0.6 | PAIN HAMB. 6.99 (and the total, via RC-3) | Repaired 2026-10-14 (SQL); *covered by the PR above* on the flat path; the geometry path is unproved without the capture |

**Fix (applied).** `dropForeignDocumentLines` (Costco denoise): inside the item block — first all-capitals item row to
the first totals label — a row with a lower-case word, no amount, no leading item number and no coupon reference is
dropped, and so is any amount-less, SKU-less row touching a dropped one (`VE THESE I`). Header and footer are left to
their own cleanup.

## RC-24 · An item named like another store (`GAP JOGGER`) never takes its price

**Printed shape.** `1896543 GAP JOGGER` / `24.99` (flat text, name and price on two rows).

**What goes wrong.** The engine pairs a name row with the price under it only if the row is not a store's name
(`isStoreName`, `receiptParsingShared.js`). Old Navy's detection pattern `/\bgap\b/` matched, so the row was skipped,
the 24.99 went unread and the `/MULTIPLE 5.00-` under it landed on KS VIT D. Any item word in a store pattern
(`RONA`, `IKEA`, `STAPLES`, `ROLLBACK`, …) does the same.

**Proof.** The `g7ntk` flat replay with RC-21/RC-22 neutralised is 24.99 short with GAP JOGGER missing; with the fix,
288.82 to the cent. The shopper's geometry parse (name and price on one row) was not hit, so this receipt's stored
GAP JOGGER line was right.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791933620723_g7ntk` (flat replay only) | Nepean #540 | 2026-10-13 | — | GAP JOGGER 24.99 on the flat path | *Covered by the PR above* |

**Fix (applied, shared code).** `isStoreName` returns false for a row led by an item number.

## RC-25 · A one- or two-letter name tail on the SKU row loses the SKU

**Printed shape.** A Quebec digital receipt (PDF) prints `1607671 PISTACHES SP 13.99 N`. Vision set the name's first
word a row higher, so the geometry rows read `PISTACHES` / `1607671 SP 13.99 N`. The same receipt's
`PAPRIKA` / `1300891 FUMÉ 6.99 N` has the same shape with a longer tail.

**What goes wrong.** Every item pattern in `tryExtractItem` (`receiptParsingShared.js`) wants a name longer than two
characters, so `1607671 SP 13.99 N` is not an item. Its price goes to the orphan `PISTACHES` row above, and the SKU
and the `SP` are lost. The server then filed the line under a line-only product (`ln:<receipt>:3`) instead of the
catalogue's 1607671 (product 7556, Pistì Spreadable Pistachio Cream 600 g). A tail of three letters or more
(`FUMÉ`) reads correctly, so the receipt still closed and nothing flagged it. The length rule has been in place since
the engine's first item patterns, so this is not a regression.

**Proof.** The Vision capture sits in R2 and isn't reachable from a cloud session, so the rows were rebuilt from
`raw_ocr` in print order. Of seven candidate row shapes, only `PISTACHES` / `1607671 SP 13.99 N` reproduces the stored
lines exactly: `PISTACHES` with no SKU *and* `PAPRIKA FUMÉ` with 1300891. With only `SP` lengthened to `SPX`, the line
reads `1607671 PISTACHES SPX`. With the fix, 9 lines close to Total Partiel 102.88, Taxes 0.00, TOTAL 102.88.

**Blast radius (prod):** `9zj1r` only. Every non-fee line-only (`ln:`) product on receipts bought since 2026-09-14
was checked: the other two are `tl5wo` (`854342 MDIET COKEM*`, a different shape) and `szw1y` (QUAIL EGGS, ink over
the digits, O-2).

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1791974178660_9zj1r` | Montreal #515 (PDF) | 2026-10-14 | not recorded | The SKU 1607671 of PISTACHES SP 13.99 | Repaired 2026-10-14 (SQL); *covered by Priceback #436* |

**Fix (applied, Costco only).** `joinNameAboveShortTailSkuRow` (Costco preprocess, `costcoReceiptParser.js`): a row
made of an item number, one or two letters and an amount takes the name on the row above. The row above must be
capitals only, with no digit and no register word. The shared engine's length rule is unchanged. The fix is in the
Priceback PR #436 (first merged as #435 into #432's branch after #432 had landed).

---

## 2026-10-23 · `vi24j` (Windsor #534) — two totals blocks — cases

`r_1792728413893_vi24j`, Costco Windsor #534 (ON, English), bought 2026-10-03 16:46, scanned 2026-10-23 04:06 UTC on
**iOS 3.1.2** (build 52), capture **c268** (1200px, the only pass). Stored **776.28 + 19.86 = 796.14** for the printed
**750.79 + 45.35 = 796.14**. One purchase that prints **two** SUBTOTAL / TAX / TOTAL blocks:

```
2458554 TIDE ORIGNL       29.99 H     ← 8th line
SUBTOTAL                 111.29
TAX                        9.81
**** TOTAL               121.10      ← white on black; Vision read "20"
CASH                       0.00
2040480 LOLE JOGGER       24.99 H     ← 20 more lines
…
SUBTOTAL                 750.79      ← covers all 28 items
TAX                       45.35
**** TOTAL               796.14
```

Proved on the paper: 20 lines = 750.79; H lines 348.83 × 13 % = HST 45.35; `TOTAL NUMBER OF ITEMS SOLD = 28`;
`TOTAL DISCOUNT(S) $ 101.50` (the voided 4.00 netted out).

**Reproduced.** The replay of c268 on `v3.1.2` (worktree at `fe4b90a`) gives exactly the stored 21 lines, Σ 776.28; the
tax is RC-5's back-derivation (796.14 − 776.28). `main` before the fix (`8345bb0`) reads 768.28.

**Neutralised one at a time** (input only): the VOID marker read right → −14.49 (the voided 3M scan) but its voided
coupon becomes a 4.00 item (RC-27); `/MULTIPLE` with its slash → −7.00 (RC-28); `4 @` instead of `48` → the SKU comes
back (RC-29). All of RC-26 to RC-30 fixed: 20 lines, **750.79 + 45.35 = 796.14**, 28 units, to the cent.

The shopper's first attempt `r_1792728211191_tv798` (deleted by them 2 minutes later, c265 1200px + c266 2000px) was a
curled photo: every coupon row welded onto the next item row (`0000394669 1931258 AVEENO / 97700 BW 40.00- 19.99 H`).
That is RC-12's shape, not these; pinned as `parser_gap` (flagged) in `receiptProdCaptures.test.js`.

**Blast radius (prod, 2026-10-23):** 4 receipts print two SUBTOTAL labels (`raw_ocr`): `mebfs`, `p2s1a` (RC-7, both
repaired), `v3u8j` (#1720, parsed right) and `vi24j`. One prints a VOID block (`vi24j`); `tv798` too (deleted).

## RC-26 · The VOID marker read `' OID`

**Printed shape.** The English register prints `VOID` in double-size type against the left margin. Vision read it
`'` + `OID` (`' OID` on the rows, `'OID` in the flat text) on both void lines of `vi24j`, and in `tv798`.

**What goes wrong.** Nothing knows `' OID`, so the void block is read as purchases. Its rows then follow RC-27.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | The void block (with RC-27): 3M SPONGEX24 billed twice (+14.49) and the voided coupon stored as `' OID Unknown item` 4.00 | Repaired 2026-10-23 (spec); *covered by #480* |

**Fix (applied, Priceback #480).** `normalizeMangledVoidMarker` (Costco preprocess): a line that is only an optional
quote/punctuation mark and `OID` becomes `VOID`. An item row starts with its number, so none can match.

## RC-27 · An English VOID block cancels the item but bills its coupon reversal

**Printed shape.**

```
1967168 3M SPONGEX24      18.49 H     ← scan 1
0000392704/1967168         4.00- H    ← its coupon
298801 POM JUICE          12.99
VOID
1967168 3M SPONGEX24      18.49- H    ← scan 1 voided
VOID
0000392704 / 1967168       4.00 H     ← its coupon voided (POSITIVE)
1967168 3M SPONGEX24      18.49 H     ← scan 2
0000392704 / 1967168       4.00- H
```

**What goes wrong.** The engine's English VOID handler (`receiptParsingShared.js`) removes the matching earlier item,
but nothing reads a positive coupon reversal: it became an item (`Item #0000392704` 4.00 on `main`). The Quebec
`ANNUL` block of exactly this shape has been handled since Sept 2026 by `cancelAnnulledLines`, which was gated to the
French word (*"no English receipt reaches this pass changed"*). Its item pattern also wanted a name starting with a
letter, so `3M SPONGEX24` could not match.

**Proof.** With RC-26 neutralised (`VOID` read right): 3M is cancelled once (−14.49) and the coupon reversal is billed
(+4.00), 754.79 for 750.79. With this fix too: 750.79.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | The 4.00 coupon reversal (with RC-26: the whole void) | Repaired 2026-10-23 (spec); *covered by #480* |

**Fix (applied, Priceback #480).** `cancelAnnulledLines` takes `VOID` as a marker too: each void removes the most
recent line with the same SKU and amount (an item, or a coupon reversal of the same coupon) and its own block. An
unmatched VOID is left as printed, so the engine's handler still sees it. A name may open with digits when its first
word carries a letter (`3M`, `60PC`).

## RC-28 · A MULTIPLE coupon read with no slash, its number dropped

**Printed shape.** `0000390266 /MULTIPLE 7.00- H` under `2040560 LOLE FZIP 29.99 H`. Vision lost the slash: the flat
text read `0000390266 MULTIPLE` over `7.00- H`, and on the rows the cleanup dropped the 10-digit number (no slash, so
not a coupon reference by `COUPON_REFERENCE_ROW_RE`): `MULTIPLE 7.00- H`.

**What goes wrong.** The MULTIPLE rule in `handleCostcoTpdLine` (#402) requires the slash. Same consequence as RC-1:
the item keeps its full price (a fake-drop risk) and the lines run over the subtotal by 7.00.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | LOLE FZIP's 7.00 coupon | Repaired 2026-10-23 (spec); *covered by #480* |

**Fix (applied, Priceback #480).** `restoreSlashlessMultipleCoupon`: a line that is nothing but [a coupon-shaped
number: `0000`+6 or 6 digits starting `3`] `MULTIPLE` [amount] gets its slash back when the amount, on the row or the
next one, carries a minus. `2040560 MULTIPLE…` (an item number) and an item named `MULTIPLE VITAMIN` stay untouched.

## RC-29 · `4 @ 4.79` read `48 4.79` and welded onto its item row

**Printed shape.** The multi-buy marker `4 @ 4.79`, printed above `500666 KS WATR500** 19.16`. Vision read the `@` as
`8`, and on the tilted page the geometry joined it to the item row: `48 4.79 500666 KS WATR500MM 19.16`.

**What goes wrong.** No item pattern starts with `48 4.79`, so the line was stored SKU-less (`ln:<receipt>:1`, named
`48 4.79 500666 KS WATR500MM`) with quantity 1 — its 19.16 would have been watched as one unit's price.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | SKU 500666 and quantity 4 of the 19.16 line | Repaired 2026-10-23 (spec); *covered by #480* |

**Fix (applied, Priceback #480).** `splitMultiBuyMarker`: a row `N[@|8] unit <sku> <name> amount` is split into
`N @ unit` + the item row, and a lone `N8 unit` row over an item row becomes `N @ unit`, only when N ≥ 2 and
N × unit is exactly the line amount.

## RC-30 · The final TOTAL lost its stars, so the interim totals block was kept

**Printed shape.** See the case header above. The final `**** TOTAL 796.14`: the photo is tilted (slope ≈ −0.05), so
`796.14` sits 43 px above `****`.

**What goes wrong.** Two steps:

1. `cleanReceiptOcr` (`shared/ocrCleanup.js`) clusters words into rows anchored on the topmost word: `796.14` anchors
   a row that takes `TOTAL` (34.5 px) but not `****` (43 px > 0.6 × the median glyph height, 35.4 px). The lone
   `****` row matches the `separator` rule and is dropped. The geometry rows read `TOTAL 796.14`.
2. `dropIntermediateTotalsBlocks` (RC-7's fix, #427) removes an interim block only when a later `**** TOTAL` row follows
   the items; with the stars gone there is none, and the interim block stays. Its English `TAX 9.81` row was also not
   in the block vocabulary (`TAXE` only), so even a removed block would have left `SUBTOTAL 111.29 / TAX 9.81` behind.

On `vi24j` the kept block cost no line: the engine read past it and took the printed total from the final block. It
is the shape every reader of the receipt has to get right (the admin auto-fix did not: RC-32).

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | Nothing on the lines; the interim block stayed in the items text | Repaired 2026-10-23 (spec); *covered by #480* |

**Fix (applied, Priceback #480).** A later SUBTOTAL row, or a bare `TOTAL <amount>` row, opens the final block as well
as `**** TOTAL`; `TAX` is a block label. Summary lines that only start with TOTAL (`TOTAL TAX`, `TOTAL NUMBER OF
ITEMS SOLD`, `TOTAL DISCOUNT(S)`) are not.

**Proposed cleanup change (not applied).** RC-4's proposal covers this too: a punctuation-only row within one glyph
height of a kept row, inside its x-span, belongs to that row. Not done here: the cleanup runs for every store.

## RC-31 · A VOID removes the whole folded line, not the one unit it cancels

*(RC-26 to RC-30 are the two-totals, English VOID block, slashless MULTIPLE and `4 @` causes of Priceback #480.)*

**Printed shape.** The same item scanned twice, then one scan voided:

```
1234567 KS WATER 40PK     4.99 H
1234567 KS WATER 40PK     4.99 H
VOID
1234567 KS WATER 40PK     4.99- H
```

**What goes wrong.** `pushOrMergeItem` folds the second identical single unit into the first (since #482, only
identical single units fold: design rule 9), giving one line, quantity 2, 9.98. The VOID handler in `extractItems`
(`receiptParsingShared.js`, both the single-line and the two-line VOID branches, `main` `6774c19`) finds the line by
SKU and calls `removeItemAt`, which removes the **whole line**, both units, instead of one. The receipt is then one
unit short of its printed subtotal (a 4.99 gap here). Before #482 the same happened to any folded line, with any
values.

**Proof.** Code reading during the sync audit (2026-10-23). No production receipt has been repaired for it yet, so
there is no replay and no blast radius. A receipt that reproduces it is the next step, and its case goes in the table
below.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| — | — | — | — | — | No case yet |

**Fix (proposed, not applied: shared parser, needs Maxim's go).** In the VOID branches, when the target line's
quantity is above 1 and the voided amount equals one unit (`lineTotal / quantity` to the cent), decrement the
quantity and the line total by one unit. Otherwise (the voided amount equals the whole line) remove it, as today.
Prove it on the corpus (rule 7).

## RC-32 · The admin auto-fix checked a proposal against the FIRST totals block

**Printed shape.** Any receipt with an interim block (above).

**What goes wrong.** `readPrintedFigures` (`backend/lib/receiptAutoFix.js`, #452 / #475) returned the first SUBTOTAL,
TAX and TOTAL it read. On `v3u8j` (#1720, parsed right: 135.94) it read 87.98 / 0.00 / 87.98, so the stored lines
failed `subtotal_on_paper` and `total_on_paper`: *"0 change(s), applicable=false"*, twice. On `vi24j` it read TAX 9.81,
so even the right proposal failed `tax_on_paper`: *"5 change(s), applicable=false"*, twice. Maxim: *"when i try to fix
it using Gemini LLM still the receipt is not balancing"*. Gemini was not told about interim blocks, VOID, a slashless
MULTIPLE or a misread `N @` either.

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1792706357636_v3u8j` | #1720 (QC) | 2026-10-22 | not recorded | Nothing (right receipt); auto-fix refused it | Reviewed 2026-10-22; *covered by #490* |
| `r_1792728413893_vi24j` | Windsor #534 | 2026-10-23 | iOS 3.1.2 | Auto-fix refused the right answer (tax 45.35 vs the interim 9.81) | Repaired by spec; *covered by #490* |

**Fix (applied, Priceback #490, server).** With two blocks or more, the printed figures are the readings that close
(subtotal + tax = total) with the largest total; when none close, the last SUBTOTAL and TOTAL read and the tax is left
unchecked (it is forced by `reconciles`), never the footer's `TOTAL TAX`. One block reads exactly as before. The
shared prompt (`receiptLlmRules`, both Gemini paths) states the interim-block, VOID, slashless MULTIPLE and `N @`
rules. Live check on prod keys with `vi24j`'s pre-repair lines and photo: applicable, 750.79 + 45.35 = 796.14.

## RC-34 · The item block runs past a TOTAL with no amount beside it: tenders, balances and the amount paid become items

**Printed shape.** After `**** TOTAL` a Costco register prints the payment block — a Shop Card tender and the card's
balance (`Shop Card` / `REMAINING BALANCE: $1,220.51` / `Shop Card 243.73`; French `carte Achat` / `VALEUR
RESIDUELLE: 99,81 $` / `carte Achat 48,28`), a card tender (`VISA 79.85`), an Executive reward spent as a tender
(`Remise Exécutif 146,69`), the change (`MONNAIE 9,97`), the approval (`01 APPROUVE - MERCI 027`) — then the footer's
check lines (tax breakdown, `TOTAL DISCOUNT(S)`, items sold, the date stamp).

**What goes wrong.** The item block ended at the FIRST line with a TOTAL keyword that has an amount on it or on the
next line (`findTotalLineIndex`, `src/services/receiptParsingShared.js`, `99d524f` 2026-05-26, first in v2.8.2).
When the geometry rows leave `**** TOTAL` without its amount (column split, a tilted totals block) or OCR misreads
the label (`**** "OTAL`), that line does not count, and the fence moves down to the next TOTAL line that has one —
`TOTAL DISCOUNT(S) $ 25.00`, after the payment block. Every payment line in between reaches extraction, and a line
carrying an amount becomes an item. The payment vocabulary had no Shop Card, balance or reward wording, in either
language, and the change/approval rules missed `MONNAIE 9,97` and an unaccented `APPROUVE`. The phantom items
inflate the floor `extractTotal` compares the printed TOTAL with, so the computed total wins and doubles (RC-3's
mechanism on builds ≤ 3.0.6).

| Receipt | Store | Scanned | Build | Lost | Status |
|---|---|---|---|---|---|
| `r_1793110284881_3eips` | Nepean #540 | 2026-10-27 | not recorded | `Shop Card REMAINING BALANCE: 1220.51` and `Shop Card 243.73` stored as items; total 1,584.88 for 243.73; 6 lines of 13 sold (the first block's items lost too) | Flagged `skip_parser_optimization` (not exportable); not repaired — replay owed if it is |
| `r_1791651763156_be1p8` | Saint-Jérôme #529 | 2026-10-10 | — | The subtotal 166.89 (`"OTAL`, `Unknown item`) and the amount paid 184.23 (`00 APPRCLV@ - MERCI 001`, `IMPOR AN - conserver cette cople`) as items: 535.06 for 184.23 | Parser gap; *covered by `hotfix/receipt-total-fence-footer`* for the phantoms (c65: 350.83, c66: 183.94); still a gap for its lines (P1–P9) |
| `r_1791814977185_p2s1a` | Boisbriand #546 | 2026-10-12 | Android 3.0.6 | `Remise Exécutif 146.69` and `-MONNAIE 9.97` as items in the flat candidate | Repaired 2026-10-12; *covered by `hotfix/receipt-total-fence-footer`* (both gone; the printed TOTAL 332.76 and TAXE 7.49 are now read) |

**Proof.** The shape reproduces on `main` before the fix: `costcoReceiptProdShapes.test.js` *"tenders and a card
balance after a TOTAL with no amount beside it are never items"* reads `REMAINING BALANCE … 1220.51` as an item on
the old sources and closes to the printed 79.85 on the new. `3eips`'s own capture can't be replayed: the receipt is
flagged `skip_parser_optimization`, which the exporter honours.

**Fix (applied, `hotfix/receipt-total-fence-footer`, 2026-10-28; Maxim: *"the receipt total [**** Total and the
value] should be the last line detected on a receipt body"*).** Design rules step 3 — a block boundary, not an
extraction branch:

- **`costcoItemBlockEnd`** (Costco only, through the engine's new `itemBlockEnd` hook): the item block also ends at
  the LAST grand-total row, its amount read or not, and at the first footer check line (items sold, total tax,
  total discount / rabais, instant savings); the engine takes the earlier of that and its own fence. The last
  grand total, because an interim block's total is followed by more items (RC-7, two totals).
- **Payment vocabulary, EN + FR** (`shared/ocrCleanup.js`, step 2): `Shop Card` / `COSTCO SHOP CARD`, `REMAINING
  BALANCE` / `BALANCE REMAINING`, `carte Achat` / `carte d'achat`, `VALEUR RÉSIDUELLE`, `SOLDE RESTANT` /
  `DISPONIBLE`, `Remise Exécutif` / `CC Reward`, the change with its amount, an unaccented `APPROUVE`. Zero-tender
  rows (`Comptant 0,00`, `CASH 0.00`) are untouched: the interim-block detector needs them.
- **Two totals, the first part paid by another tender** (Maxim, 2026-10-28: *"a case when the client ask to pay by 2
  different payment methods or separately"*): the interim-block detector also accepts a card or Shop Card tender
  under the first total, or no tender row at all once the cleanup removed its payment lines — when the total carries
  its amount and items resume after it. All five two-totals receipts in production (`vi24j`, `tv798`, `v3u8j`,
  `mebfs`, `p2s1a`) print the zero tender; the split payment prints once, at the end (`v3u8j`: carte Achat 48,28 +
  MasterCard 87,66).

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
