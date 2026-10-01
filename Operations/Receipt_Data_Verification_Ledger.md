# Receipt data verification ledger

**Purpose.** A permanent record of every production receipt whose stored data
has been checked against its evidence. **Before auditing production receipts,
read this list and skip every id already here** unless the receipt row has
changed since (compare `created_at` / item count / totals with the "after"
column). Append new receipts at the bottom of the table; never delete a row.

**What "verified" means.** The receipt header (`purchase_date`, `total`, `tax`,
`warehouse_id`) and every `receipt_items` line (SKU, line total, quantity,
discount, `ignored`, `watch_enabled`) plus the receipt's own `price_points`
(`source_ref = <receiptId>:<position>`) were compared with:

1. **the printed receipt** — the R2 original (`receipts.image_object_key`), read
   by eye; and
2. **the stored OCR** (`receipts.raw_ocr` + `header_ocr`) replayed through the
   current parser;

and every printed self-check reconciled to the cent: items = printed subtotal,
subtotal + tax = printed total, and (where printed) units = article count.

How the photos were fetched (no secret leaves Railway):
`cd backend && railway run node <script>` calling `storage/r2.js#getObject`.

## Verified receipts (prod `xjfrlzwonyaorwktnkpj`)

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1787042594371_qzwez` | Costco Gloucester #1362 · 2026-03-08 | photo ✅ + OCR | 2026-09-27 | Correct. Product 1986269 renamed `Item #1986269` → `PJ'S` (shared product row). |
| `r_1787042691897_vdxrw` | Costco Gloucester #1362 · 2025-12-17 | photo ✅ + OCR | 2026-09-27 | **Repaired.** BOUNTY 32.99 → 25.99 (32.49 − TPD 6.50); BRONDELL ×2 159.98 → 139.98 (two 20.00 TPDs); tax 2.24 → 29.24. Now 284.38 / 29.24 / 313.62 as printed. Names: `GL Hember TRAD HUMMUS` → `TRAD HUMMUS`, `BRONDEL BID` → `BRONDELL BID`. Window long closed — nothing watched. |
| `r_1788208622722_s4wle` | Costco Gloucester #1362 · 2026-03-08 | OCR only (no image stored) — same receipt as `qzwez` (same till time 17:55:13), scanned by a second account | 2026-09-27 | Correct (identical lines to `qzwez`, whose photo was checked). |
| `r_1788374243485_xwmjh` | Costco Gloucester BCTR #802 · 2026-08-27 | OCR only (no image stored; OCR is a phone screenshot) | 2026-09-27 | Lines + totals correct (155.24 / 9.68 / 164.92). **Date unverifiable** — no date in the OCR; left as stored. |
| `r_1789673663269_7hyy7` | Costco Anjou #1446 · 2026-09-03 | photo ✅ + OCR | 2026-09-27 | **Repaired.** Date 2026-03-09 → 2026-09-03 (back in window → `watching`, 23 lines re-watched); total 309.32 → 313.06; tax 15.40 → 3.74; warehouse phantom `60651` → 1446 (phantom row deleted); BOURSIN 13.49 → 10.49 (TPD); 4 missing lines added (FRITES, BUBLY, ORANGE CARA, ECOFRAIS); fake `BANANES 3,98` @ 21.99 → BANANES 30669, **2 @ 1.99** (photo); CONSIGNE on SKU 9491. 27 units = printed 27. |
| `r_1790035456737_lav05` | Costco Laval #505 · 2026-09-19 | OCR only (no image stored) | 2026-09-27 | Correct (200.89 / 19.61 / 220.50; parser replay identical). |
| `r_1790469584273_xstgw` | Costco Rimouski #1720 · 2026-09-12 | OCR (the R2 object is **not** the customer's photo — an old-build snapshot the app drew of its own wrong parse; see Bugs #285) | 2026-09-27 | **Repaired.** Total 202.94 → 202.74; PANTALON 24.99 → 19.99 (the `391362 PANTALON 5.00-` coupon), no longer watched; CONSIGNE 9484 2 @ 2.40 = 4.80 added. 8 units = printed 8. The stale snapshot in R2 still shows the old numbers — kept (no original exists to replace it). |
| `r_1790696586124_jeji6` | Costco Gloucester BCTR #802 (app screenshot) · stored 2026-09-29 | OCR + parser replay; photo downloaded, not re-OCR'd | 2026-09-29 | Lines correct (13 items = 194.16; BABY SPINACH 0.00 correctly not an item). **Date unverifiable** (no date in the shot → scan date); left as stored. |
| `r_1790696630914_pspjb` | Costco Gloucester BCTR #802 (app screenshot) · stored 2026-09-29 | OCR + replay | 2026-09-29 | Lines + totals correct (120.93 / 1.43 / 122.36). **Date unverifiable**; left as stored. |
| `r_1790696717328_1gall` | Costco Gloucester BCTR #802 · stored 2026-09-29 | OCR + replay | 2026-09-29 | Lines + totals correct (155.24 / 9.68 / 164.92). ⚠️ **Date is the scan date** — the photo's OCR has no date line; the same receipt in the fixture corpus is from April 2026. Left as stored; Maxim to set the real date. |
| `r_1790696866883_wtm8l` | Costco Gloucester #1362 · 2026-06-28 | OCR only (no image stored) | 2026-09-29 | **Repaired.** Line 10 `TACO` (no SKU, product `ln:…:10`) → `24930 CHICK TACO` 18.17 (new product; price point re-pointed; orphan product deleted). 264.40 / 13.51 / 277.91 as printed. |
| `r_1790696975738_u590w` | Costco Gloucester #1362 · 2026-02-07 | OCR + replay | 2026-09-29 | **Repaired.** Product 5502859 `CKN / VEG DUMP $` → `CKN/VEG DUMP`. 236.91 / 20.80 / 257.71 as printed. |
| `r_1790697029536_n6hvb` | Costco Gloucester #1362 · 2025-11-29 | OCR + replay | 2026-09-29 | Correct (23.99 / 3.12 / 27.11). |
| `r_1790697167297_yb0uh` | Costco Gloucester BCTR #802 · 2026-06-27 | OCR + replay | 2026-09-29 | Correct (28.78 / 3.74 / 32.52). |
| `r_1790697283746_x850x` | Costco Gloucester #1362 · 2026-01-28 | OCR + replay | 2026-09-29 | **Repaired.** CHICK BREAST 23.99 → 18.99 (TPD 5.00); added `774939 DEMPS.STAYSF` 4.99 (orig 6.99, new product) at position 12 and `458 MILK 2%` 5.89 at position 13, each with a price point; tax 29.01 → 23.13. 298.94 / 23.13 / 322.07 as printed. Window long closed — nothing watched. |

Every repair ran as one guarded transaction (it aborted unless every touched
row still matched the pre-repair snapshot); none of the touched rows had a
price-drop notification, a claim or a commission against it. Detail and the
before-state: `Operations/Task_Log.md` entry of 2026-09-27.

### 2026-09-30 — a new customer's double-scanned receipts (Pointe Claire #528)

Account `000769.156a…0021` (Apple, created 2026-10-01 00:21 UTC) scanned two
receipts twice each because the first parse was visibly wrong. Photos read by eye,
OCR replayed through the parser; both receipts now close on every printed check.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1790814834185_cx5ml` | Costco Pointe Claire #528 · 2026-09-23 | photo ✅ + OCR | 2026-09-30 | **Repaired.** Rebuilt from the photo: 11 → 15 lines. Added TIDE PA 89 24.99 and ENSEMBLE 2PC 19.99 (new products), KIWIDORE3LB 11.99 (orig 15.99), PLAQUE 14.99 (orig 19.99; second scan and its coupon ANNULled). DAWN 14.99 → 11.99 (orig 14.99), SUCRE BIO 19.99 → 13.99. 15 price points rewritten. Total 209.22 → **272.18** (257.94 + 14.24); TOTAL RABAIS 12.00. TPD lines unwatched; the rest watched. |
| `r_1790815006777_2ab87` | Costco Pointe Claire #528 · 2026-09-26 | photo ✅ + OCR | 2026-09-30 | **Repaired.** KS PARCHEMIN 19.99 → 13.99 (orig 19.99, TPD) and DURACELL AA 25.99 → 19.99 (orig 25.99, `2106265 RABAIS`); both price points marked on sale; both lines unwatched. Total 183.11 → **171.11** (161.02 + 10.09); TOTAL RABAIS 12.00. |
| `r_1790815048675_vlakw` | duplicate of `cx5ml` (same OCR) | — | 2026-09-30 | **Deleted** (was soft-deleted by the user): row, 12 items and 12 price points. Its R2 photo remains. |
| `r_1790814438798_tbelg` | duplicate of `2ab87` (byte-identical OCR) | — | 2026-09-30 | **Deleted** (was soft-deleted by the user): row, 7 items, 6 price points and the orphan synthetic product 24851 (`*ÉCOFRAIS`). Its R2 photo remains. |

Two guarded transactions (abort unless total, item count, no claim, no
drop-notification and no review-queue row matched the audit), each read back. The
four `scan_consume` ledger rows (75 → 71 credits) are kept as history. Maxim
refunds the two duplicate scans himself.
