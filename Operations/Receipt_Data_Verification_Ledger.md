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

Every repair ran as one guarded transaction (it aborted unless every touched
row still matched the pre-repair snapshot); none of the touched rows had a
price-drop notification, a claim or a commission against it. Detail and the
before-state: `Operations/Task_Log.md` entry of 2026-09-27.
