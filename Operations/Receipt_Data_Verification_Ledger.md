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

### 2026-10-02 — a US receipt (Costco Bayonne, NJ #1334) — UNSUPPORTED, do not re-analyse

Account `002010.0696…0013` (Apple, created 2026-10-03 00:13 UTC, Quebec profile)
scanned one receipt twice. It is from **Costco Bayonne, NJ #1334**, priced in USD
(subtotal 516.16 · tax 6.98 · total 523.14 · 34 items · 2026-09-19 14:35). PriceBack
tracks Canadian stores only, so the receipt is **flagged, not repaired** — Maxim's
call: *"flag the receipt as a US store that is not supported so we wont redo the
analyze later"*. **Skip both ids in any future verification pass.**

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1790986971714_tl5wo` | Costco Bayonne, NJ #1334 (US) · 2026-09-19 | OCR only (photo not read) | 2026-10-02 | **Flagged unsupported (US store).** Status `rejected` (pre-dates the `unsupported_country` code), total 1377.68 → **523.14**, tax 6.98, warehouse → none. Payment lines saved as items (`MOUNT: $523.14`, `PerCard 523.14`) deleted with their synthetic products. 22 lines kept, **none watched**. Its 24 receipt price points (USD, filed as QC) deleted. |
| `r_1790986803639_sgftf` | same receipt, first scan | OCR only | 2026-10-02 | **Flagged unsupported (US store).** Status `rejected`, total 87.44 → **523.14**, 2 lines kept, none watched, its 1 price point deleted. |

Also removed: the **20 crowd copies** the app's `/api/watch` registration wrote
(source `flyer_user_scan`, `source_ref 45ec3bdbe781d4d5:2026-09-19:*`, all filed as
Quebec, USD), and the fake Quebec warehouse **`1334`** (id 531943, auto-registered by
the scan). 45 price points in all. Rows kept rather than deleted: the app re-uploads
a receipt missing on the server. Maxim ran the guarded block himself and the read-back
matched. The duplicate scan's refund (1 credit, playbook §6) is Maxim's.
Customer told by push (EN, `notification_history` #29, Expo receipt `ok`):
*"About your US receipt — Price-drop tracking isn't available yet for US Costco
stores. It's coming soon, and we'll notify you as soon as it's live."*
⚠️ **Owed:** notify this account when US receipts go live.

### 2026-10-03 — two Quebec warehouse receipts with SKU-less lines (Gatineau #542, Pointe Claire #528)

Two customers, one receipt each, scanned 2026-10-03. Every line read off the R2 photo (zoomed crops),
OCR used only to cross-check. Before-state of every touched row saved before the repair. Both
repairs ran as guarded transactions (abort unless total, item count, no claim and no drop
notification matched the audit) and were read back. Parser bug: `Bugs_Common_Fixes.md` #306.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791049142108_a1ngm` | Costco Gatineau #542 · 2026-09-20 | photo ✅ + OCR | 2026-10-03 | **Repaired.** The ANNUL'd COUSSIN FETE 14.99 removed (line + price point; positions 35–38 shifted down); `/TAPIS NORDIC` re-pointed from synthetic `ln:…:33` to product **8721334** (orphan deleted); tax 30.06 → **45.05** (TVQ 30.01 + TPS 15.04). 38 lines = **668.44**, **39 articles = printed 39** (BEURRE is 2 @ 5.79), 17.00 rabais = printed. Total 713.49 unchanged. |
| `r_1791050619590_6wd4e` | Costco Pointe Claire #528 · 2026-09-26 | photo ✅ (top band faded) + OCR | 2026-10-03 | **Repaired, with a known gap.** Rebuilt 20 → 23 lines, all with SKUs: quantities restored (KS DE SOYA 6, KS AMANDE 3, POIS CHICHE 7, RAISIN BRAN 6, KS AMANDES 2); WRAP TORT 18 3.99 (orig 5.99); CREST 3D 14.49 (orig 18.99) and PLMLIVE 9.99 added; POULET BUFFA back to 24.99; 5 new products; WRAP's product name `WRAP/1322067 TORT 18 2.00-` → `WRAP TORT 18`; 5 synthetic products deleted. Warehouse → **528**, channel → warehouse, total 502.51 → **639.41**, tax 22.15. ⚠️ **8 of the printed 50 articles (~$109.92 net, $96.92 of it FP-taxed, 9.00 of the 15.50 rabais) are not legible** — the paper above "Bas du panier" is faded blank in the photo. Lines sum to 507.34 of the printed 617.26. A clearer photo of the top would complete it. |

Also fixed: admin review-queue row #5 (RAISIN BRAN, coupon price 7.99) **kept** — it is a REAL
drop (9.99 → 7.99 × 6 = $12.00), shown as ~87% only because the line was one $59.94 unit; row 383
now carries quantity 6 and the queue joins quantity live. Crowd copies (`source_type 4`) from the
same scan: RAISIN BRAN 59.94 → 9.99 (6824), the 36.98 KS AMANDES copy deleted (6832, the 18.49 copy
exists), warehouse 528 stamped on 13 rows. Gatineau's crowd copies were all true shelf prices — kept.
No duplicate scans → no credit refund owed.

### 2026-10-04 — Vaudreuil #1213, double-scanned (datafix only, no code change)

Account `103854215126202403292` (Google) scanned the same receipt twice, 3 minutes
apart, and soft-deleted the first copy. Both parses were wrong in different ways.
The photo was read by eye and every printed check closes to the cent: lines 381.74 =
SOUS-TOTAL; TPS 13.37 + TVQ 26.67 = TAXE 40.04 on taxable 267.39; TOTAL RABAIS 62.00;
29 units = NOMBRE D'ARTICLES VENDUS 29.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791167425155_vu6b9` | Costco Vaudreuil #1213 · 2026-10-03 | photo ✅ + OCR | 2026-10-04 | **Repaired.** Rebuilt from the photo: 20 → 26 lines. Total 287.49 → **421.78** (381.74 + 40.04). Added the missing LISTERINE UC 628368 ×4 (47.96, orig 63.96), KS 40X500ML 500566 ×2 (10.98), LAIT CHOCO, LAIT 2% 4L, CAD LAIT MIN (15.99, orig 19.99), CONSIGNE 2.40. Fixed HEATED SOCK SKU (`:21` garbage → 1985321), DOWNY 1833038 → **1833033** (its coupon reads `/1833033`), JAMBON `364`/`87 …` → **364687** (new product), PISTOLET COL 39.00/49.00 → 39.99/49.99, FRAISES qty 2 = 15.98 (was 7.99), CEINTURE 9.97 → 29.91 (×3), BAGUETTE 5.99 → 11.98 (×2), POULET ROTI 5.99 → 15.98 (×2). 19 receipt price points rewritten; fee lines ignored; TPD lines unwatched. |
| `r_1791167228403_zv3yj` | duplicate of `vu6b9` (soft-deleted by the user) | — | 2026-10-04 | **Deleted**: row, 21 items, 15 price points. Its R2 photo remains. |

Crowd observations (`source_type_id = 4`, device `547dace02cc36455`, 2026-10-03) that
the two misparses had posted were brought in line with what a correct parse posts (one
per watched line, paid unit price): 9 deleted (junk SKUs `628`/`1706`/`364`, misread
`500666`, BAGUETTE 3.00, and the discounted lines posted at full price), 2 corrected
(CEINTURE 3.32 → 9.97, POULET ROTI 5.99 → 7.99), 8 kept. Junk products deleted once
unreferenced: `628`, `1706`, `364`, `1833038` and the stale `ln:` fee rows. Product
`500666 KS 40X500ML` (id 27875) was left alone because it predates this receipt and belongs to `r_1791125306407_zm6h2`.

One guarded transaction (abort unless total, item count, no claim, no drop
notification, no review-queue row, no OCR capture matched the audit), read back.
Both `scan_consume` rows (74 → 73) kept; the duplicate scan is Maxim's to refund.

### 2026-10-04 — Vaudreuil #1213, two more receipts (datafix only, no code change, no notification)

Same account `103854215126202403292` (Google) scanned two older digital receipts. Photos
read by eye; every printed check closes to the cent. No claim, drop notification or
review-queue row existed on either receipt.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791168728568_er1cc` | Costco Vaudreuil #1213 · 2026-09-24 | photo ✅ + OCR | 2026-10-04 | **Repaired.** 7 → 8 lines. The 89.99 line was stored as synthetic `ln:…:3` "BAT/2702338" (the eco-fee label) → **EXT CORD 1734187** (new product); added **ECO FEE 6377 0.50** (ignored fee). LAUNDRY 2787084 printed at **0.00** left out (zero-value lines are rejected by the repair path; "ITEMS SOLD = 9" closes without it). Tax 73.33 → **72.83** (QST 48.51 + GST 24.32 on 486.36); lines 513.33 = SUBTOTAL; total 586.16 unchanged; INSTANT SAVINGS 7.00. Synthetic product 28144 deleted. |
| `r_1791168705517_41ub6` | Costco Vaudreuil #1213 · 2026-09-10 | photo ✅ + OCR | 2026-10-04 | **Repaired.** 60 → 61 lines. Six `NNNNNN/SKU` coupons the parser dropped applied: ORIGL TORTIL 5.99 → 3.99, CHICKN STICK 19.99 → 15.99, HAM/SWISS CK 13.99 → 10.99, OKA ARTISAN 26.98 → 19.98, GEN TAO CHKN 17.99 → 13.99, SRDGH BAGUET 11.98 → 8.98 (all unwatched now). Added missing **VEL BAR 21CT 3306245** 9.99 (orig 12.99, new product). Lines 938.87 = SUBTOTAL; tax 58.53 → **71.54** (QST 47.32 on B + enviro fees; GST 24.22 also on VEL BAR); 63 units = ITEMS SOLD; total 1010.41 unchanged. 3-digit SKU `462 6% MILK` is genuine. **Inference:** each Dole bag prints two `TPD/DOLE 3.00-` lines, but SUBTOTAL only closes with one per bag (9.29 each, as stored); the printed INSTANT SAVINGS 83.15 counts the duplicate. |

Crowd observations (`source_type_id = 4`, device `547dace02cc36455`, observed 2026-09-10):
6 deleted — the coupon lines above posted at full price (ids 8137, 8139, 8143, 8144, 8156,
8165); a correct parse posts nothing for a discounted line. The rest kept. No crowd post
was added for EXT CORD.

One guarded transaction (abort unless totals, tax, item counts, line sums and price-point
counts matched the audit and no claim/notification/review row existed), committed and read
back. **No customer notification sent** (Maxim's instruction). Parser bugs noted, not
fixed: eco-fee description lines can swallow the next item's amount; English-layout
`NNNNNN/SKU` coupons without a `TPD` prefix are dropped.
### 2026-10-04 — three Quebec receipts (Drummondville #1127, Gatineau #542, Quebec #503)

Three customers, one receipt each — two scanned the morning of 2026-10-04 (EDT), one at 23:37 on
2026-10-03. Every line read off the R2 photo (zoomed crops); the stored OCR — right on all three —
only cross-checked it. Each repair ran as one guarded `DO` block (abort unless total, tax, item count,
no claim, no drop notification, no review-queue row and no referenced price point matched the audit;
the receipt's own arithmetic asserted before commit) and was read back. Parser: Bugs #309.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791118577679_bq42g` | Costco Drummondville #1127 · 2026-09-24 (self-checkout) | photo ✅ + OCR | 2026-10-04 | **Repaired.** `4160015 GRENADE SC` 29.99 FP added at position 3 (new product, with its price point); MADEGOOD and MAYO moved to 4–5. Total 61.44 → **91.43**. 6 lines = **86.24**, tax 5.19 (TPS 2.20 + TVQ 2.99), **6 articles = printed 6**. |
| `r_1791125306407_zm6h2` | Costco Gatineau #542 · 2026-09-21 (self-checkout) | photo ✅ + OCR | 2026-10-04 | **Repaired.** Rebuilt 12 → 13 lines: BULDAK **11.49** (orig 14.99, `/1875629 3.50-`), VECTOR GEANT **8.49** (orig 10.99, `/ 128888 2.50-`), LP SANDALE **9.99** (orig 14.99, `/ MULTIPLE 5.00-FP`), ACTIVIA 10.99 added (new product 144480), BATON MOZZA 10.99 → **16.99**, FILET SAUMON 16.99 → **35.56**. Product names restored (a receipt upsert overwrites them for every shopper): `LIBRE - SÉRVICE BULDAK` → `BULDAK`, `KS/1875629 40X500ML 3.50-` → `KS 40X500ML`, `FILET SAUMON 35.56` → `FILET SAUMON`, `LP SANDALE/MULTIPLE` → `LP SANDALE`. 11 price points rewritten; the four discounted lines unwatched. Total 136.92 → **161.48** (155.14 + 6.34); **13 articles = printed 13**; discounts 15.00 = TOTAL RABAIS. |
| `r_1791085073654_z6hct` | Costco Quebec #503 · 2026-10-03 | photo ✅ + OCR | 2026-10-04 | **Repaired.** Lines were right; tax 0.01 → **16.32** (TPS 5.45 + TVQ 10.87 on 108.96 of FP lines), total 250.45 → **266.75**; `*ECOFRAIS` 0.09 → **0.08** — a pen stroke crosses the digit, and 0.08 is the only value that closes on SOUS-TOTAL 250.43. 15 articles (the photo stops above the printed count). |

Crowd copies (`source_type 4`, written by the app's `/api/watch` from the same parse): Gatineau's
BATON MOZZA **10.99** (7929) and FILET SAUMON **16.99** (7930) deleted — wrong prices that told drop
detection those items sell for $6.00 and $18.57 less than they do. Its other 7 are true shelf prices
(BULDAK, VECTOR and LP SANDALE at their pre-coupon price) — kept; Drummondville's and Quebec #503's
are all true — kept. Each phone re-registers its corrected lines after its next hydrate, which records
the missing observations (ACTIVIA, GRENADE SC, BATON 16.99, SAUMON 35.56) through production code. No
credit-ledger row referenced the deleted copies. No duplicate scans → no refund owed. No customer push
sent.

### 2026-10-08 — two Pointe Claire #528 receipts: French pre-scan banner in the first name (names only)

Lines, totals, dates and warehouse were right on both. The receipts were checked against the photo and the exact live
Vision capture (`ocr_captures` 1 + 2). Only the first item's name was wrong: the tilted paper welded the banner
`DÉBUT PRÉ-LECTURE ARTICLES` onto it. Parser: Bugs #310, app PR #408. Repaired in one transaction: three
`products.display_name` rows (shared by every receipt with that SKU) and five watch-registration item names in
four rows, then read back. 0 products and 0 watch rows still carry banner text. No price, price point, ledger
or notification was touched.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791428280569_21xro` | Costco Pointe Claire #528 · 2026-10-03 | photo ✅ + live capture | 2026-10-08 | **Name repaired.** Product 29956 (sku 2002489) `DEBUT PRé - LECTURE ARTICLES HAVARTI VARI` → `HAVARTI VARI`. 3 lines = **33.14**, tax 0, 3 units. |
| `r_1791429053760_bjkt6` | Costco Pointe Claire #528 · 2026-10-04 | photo ✅ + live capture | 2026-10-08 | **Name repaired.** Product 29072 (sku 647249) `DEBUT PRE PAIN DE LE` → `PAIN DE BLÉ`, the name printed on the paper (a pen stroke hides the "B", so OCR reads "PAIN DE LE"). Also the name on `r_1791237035698_6czgq`. 2 lines = **34.48**, tax 0. |

Same defect, older: product 24635 (sku 129572) `DEBUT PRE - LECTURE ARTICLES OEUFS 2.5 DZ` → `OEUFS 2.5 DZ`. It is
shared by `r_1790696630914_pspjb`, `r_1790697283746_x850x` and `r_1790717788154_qeobd` (names only; those receipts were
not re-audited line by line here). Phones keep their saved names until the receipt is rescanned, and a watch
re-sync can write the old name back into `watch_registrations`. The detection query is in Bugs #310.

### 2026-10-08 — every prod receipt re-read with 3.0.5's parser after the fake price drops (Bugs #311)

Trigger: 9 fake "Price drop at costco" pushes (Bugs #311). Maxim: *"some of them have wrong quantities … all the
receipts has been scanned before the new fixes we shipped in the 3.0.5"*. Method, every live prod receipt:

1. **Photo fixture exists** (`__tests__/fixtures/receipts/prod-*`, re-OCR'd stored photos, ground truth pinned to the
   paper): `main`'s parser (byte-identical to 3.0.5) replayed with word geometry.
2. **No fixture**: the stored OCR (`header_ocr` + `raw_ocr`) replayed through the same parser, then read line by
   line. The photo download + Vision re-OCR was refused by the session's permission layer, so these were proved by
   the paper's OWN printed figures instead: Σ lines = SUBTOTAL, + TAX = TOTAL, units = ITEMS SOLD, Σ coupons =
   INSTANT SAVINGS (and the GST/QST bases where they disambiguate) — each to the cent. A line was changed only when
   those figures force it.
3. Compared with `receipt_items` by position (scratch tool, read-only). A receipt that matched is left alone.

**Found wrong — repair specified, ⏳ NOT YET APPLIED** (the production write was refused for this session; the
specs are `backend/data/bad-scan-repairs/<id>.json` on app branch `hotfix/sku-only-price-drops`, applied with
`scripts/repairBadScanReceipt.js` — dry run first; see the Task Log entry of 2026-10-08). None has a claim; only
`f3ivl` has a charged drop, kept untouched with `keepItemIds`.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1790812128897_94g20` | Costco Pointe Claire #528 · 2026-09-30 | photo fixture + OCR | 2026-10-08 | ⏳ **LOVE CORN 30 quantity 1 → 15** (`15 @ 18.99 = 284.85`; the paper counts 23 articles, stored 9). The cause of the 10-01 push "dropped by $209.85". Crowd copy 4851 (284.85 "per unit") to delete. 406.27 / 42.65 / 448.92 unchanged. |
| `r_1790811675479_5mwuj` | Costco Pointe Claire #528 · 2026-09-26 | photo fixture + OCR | 2026-10-08 | ⏳ PEPSI 32 PK 16.99 had been stored as an ignored `CONSIGNE QC` fee; `*ECOFRAIS 0.64` and `CONSIGNE QC 3.20` lost; tax 7.83 → **3.99**. 123.44 + 3.99 = 127.43, 10 articles. |
| `r_1790811624673_nhngb` | Costco Pointe Claire #528 · 2026-09-06 | photo fixture + OCR | 2026-10-08 | ⏳ The 4.00 coupon was on MANGUES (15.99/19.99) instead of POULET BURGE: now POULET BURGE **15.99** (orig 19.99), MANGUES **13.99** (watched). Crowd copy 4811 (POULET BURGE at 13.99) to delete. 102.22 / 5.46 / 107.68. |
| `r_1790808757051_f3ivl` | Costco Pointe Claire #528 · 2026-09-27 | photo fixture + OCR | 2026-10-08 | ⏳ EAU ESKA **2 × 5.49** (was 1 + a junk `*ECOFRAIS 5.49`); PUREX COLD 17.99 (orig 22.99) and FRITO TWIST 6.49 (orig 8.49) coupons restored; TYL ENFANTS 17.99 and DOWNY SPA 14.99 (orig 18.99) restored; LAITBIO 3.8% **5.39** (was 17.99); tax 28.52 → **14.44**. 346.77 + 14.44 = 361.21, 25 articles. **Line 10 (SOFTSOAP SL, item 204) kept as is** — its 10-01 drop (11.49, 53 credits) was real. Extras to delete: crowd copy 4797 (LAITBIO 17.99) + the deleted duplicate `r_1790807272442_5pg85`'s 8 junk points (4757–4764, incl. the 361.21 total read as an item) and its 3 junk crowd copies (4756, 4765, 4767). |
| `r_1791169282395_qvs25` | Costco Vaudreuil #1213 · 2026-09-22 | OCR + printed figures | 2026-10-08 | ⏳ A fake item `BAT/2702338` 89.99 (the eco-fee text of `ECO FEE 6377 0.50 BAT/2702338`) → **1734187 EXT CORD 89.99** + `ECO FEE 0.50` (ignored); 4OZ BLU MUFF and 4OZ CHOC MUF **5.99** each (their `392541/MULTIPLE 2.00-` coupons); tax 25.16 → **28.66**. 348.48 + 28.66 = 377.14, 23 articles, coupons 28.00 = printed. The cause of the 10-05 push "BAT/2702338 dropped by $14.99". |
| `r_1791169321759_5clwk` | Costco Vaudreuil #1213 · 2026-09-15 | OCR + printed figures | 2026-10-08 | ⏳ SCOTTIES **21.99** (orig 27.99, a 6.00 coupon) and FLEECY FRESH **9.49** (orig 11.99, `391313/MULTIPLE 2.50-`) — both were WATCHED at a price never paid; 4 fee lines added (0.04, 0.20, 2.40, 0.48); tax 13.98 → **19.36**. 216.87 + 19.36 = 236.23, 17 articles, coupons 37.50 = printed. |
| `r_1791169298590_n12jm` | Costco Vaudreuil #1213 · 2026-09-17 | OCR + printed figures | 2026-10-08 | ⏳ `ENVIRO FEE 0.12` added (ignored); tax 2.36 → **2.24**. 29.00 + 2.24 = 31.24, 4 articles. |
| `r_1791169266388_amlyo` | Costco Vaudreuil #1213 · 2026-10-03 | OCR + printed figures | 2026-10-08 | ⏳ GLUE GUN (`1938002`) **39.99** (orig 49.99, `393828/1938002 10.00-`) — was watched at 49.99; five fee lines added (0.70, 0.96, 2.40, 2 × 4.00, 2 × 1.60); tax 45.30 → **40.04**. 381.74 + 40.04 = 421.78, 29 articles, coupons 62.00 = printed. Extras to delete: crowd copy 8028 (filed under the wrong SKU 500566) + the deleted duplicate `r_1791167425155_vu6b9`'s 19 points (8055–8073). |
| `r_1791227158826_i0bha` | Costco Montreal #515 · 2026-09-20 | OCR + printed figures | 2026-10-08 | ⏳ `ENVIRO FEE 0.80` and `DEPOSIT 4.00` added (ignored); tax 11.24 → **6.44**. 164.56 + 6.44 = 171.00, 14 articles. |

**Checked and correct (3.0.5's parse = the stored lines, or the difference is presentation only):**
`r_1790772555478_67p5h` (WAGON — the receipt was right; its 10-01 push was the $75 name search), `r_1791168728568_er1cc`
(DESK WHITE 299.99 / EXT CORD 89.99 / WATERPIK 59.97 / ECO FEE all right — those two 10-05 pushes were the $75 name
search), `r_1791168705517_41ub6`, `r_1790469584273_xstgw`, `r_1790993308570_0l4w3`, `r_1790035456737_lav05`,
`r_1788374243485_xwmjh`, `r_1788208622722_s4wle`, `r_1791237035698_6czgq`, `r_1791237953100_xc09c`,
`r_1790697283746_x850x` (order only), `r_1791050619590_6wd4e` (the faded one; merged duplicate lines only),
`r_1789673663269_7hyy7` (the stored SKU 367154 is right — its coupon names it; 3.0.5's parse of the fixture picks a
stray 7217504, a parser gap to fix), `r_1791085073654_z6hct`, `r_1791118577679_bq42g`, `r_1791125306407_zm6h2`,
`r_1790814834185_cx5ml`, `r_1790815006777_2ab87`, `r_1791049142108_a1ngm`, `r_1790717788154_qeobd`, and Maxim's
Gloucester receipts.

⚠️ `r_1791168705517_41ub6` (Vaudreuil, 09-10, 63 articles) matches its printed subtotal, tax, total and count, but
the paper's INSTANT SAVINGS (83.15) is 6.00 more than the stored coupons (77.15): the OCR prints four `TPD/DOLE 3.00-`
lines, two are stored, and adding the other two would break the printed subtotal — so a 6.00 misread sits among the
zero-rated lines. Both DOLE lines are discounted (not watched), so it cannot raise a fake drop. **Left as stored; check
the photo.**

**Phones' watch lists (`watch_registrations`) still carrying junk** — harmless now that the by-name scrape leg is gone,
and each phone replaces its row on its next registration: `002010.0696…` (the US receipt's `MOUNT:`, `PerCard`,
`MDIET COKEM*`), `103854215126…` (`BAT/2702338`), `115743994329…` (FROMAGE COTT as 2 + 1 units at the wrong prices —
the server copy is right), `109414101810…` (PANTALON at 24.99 — the server copy is right).

### 2026-10-08 — Nepean #540: a coupon inside a labels-first block (parser bug, Bugs #312)

Scanned 2026-10-08 (two-pass scan, `ocr_captures` 3 + 4). Production stored 21 wrong lines summing to $378.29
against a printed $373.29, tax back-computed to 29.82. **The photo was not read** (no object-store access in that
session): the lines come from the stored OCR, which is in print order except one labels-first block, and every
one closes on the paper's own checks — SUBTOTAL 373.29 = the 21 lines, HST 34.82 = 13% of the H-flagged lines
(267.87; without the 3.00 coupon it would be 35.21), TOTAL 408.11 = the INTERAC payment. The block's amounts were
zipped onto its labels in print order, and production's own geometry rows agree (12.99 on THINADDICTIV's row,
17.99 on K9 NUT BAR's). Spec: `backend/data/bad-scan-repairs/r_1791478905313_w7a4m.json` (app PR #410).

Applied as one guarded transaction equivalent to `repairBadScanReceipt.js --write` with that spec (no Railway in
the session; checked identical to the real `repair()` on a local copy of the rows), then read back:
`keepItemIds` 835-837 (SIERRA FZ, KNIT 1/4 ZIP, KNIT PANT — already right, carrying pending verified-drop review
rows 9, 7, 8, which survive); review row 6 (a bogus 14.99 → 7.99 "drop" on the misread line) cascaded away with
its line. Crowd copy **9999** (`77053` at 14.99) deleted; the other 13 copies are true shelf prices (TRAD HUMMUS
7.99 is its pre-coupon price) — kept. No credit-ledger row referenced it (the scan's own −1 charge stays). No
duplicate scan → no refund owed. No shopper notice drafted (a readable receipt: `markSkipParser: false`,
`notifyShopper: false`, as the earlier parser-bug repairs). The watch registration was rewritten separately
(20:14 UTC, Bugs #313): 21 bad entries → the 19 corrected watchable lines.

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791478905313_w7a4m` | Costco Nepean #540 · 2026-09-23 | OCR + printed checks (photo not read) | 2026-10-08 | **Repaired.** 21 lines rebuilt to the paper: DAD'S COOKIE 1174257, DEMP 12GRAIN 1274091, GRAPE TOMATO 77053 6.99 (was "GRAPE" 14.99), **MADE GOOD BA 2158349 11.99 (orig 14.99, coupon read `/2/58349`) — was missing**, K9 NUT BAR 1181556 17.99 (was `/2/58349 BAR`), BENCH PANT 4335821, TH PANTS 2PK 3966011, TRAD HUMMUS 5.99 (orig 7.99, its 2.00 coupon), BEAR ROLLS 1841872 — 7 new products, 7 synthetic `ln:` products deleted, product 77053 renamed back `GRAPE` → `GRAPE TOMATO`. Lines = **373.29**, tax 29.82 → **34.82**, total 408.11 unchanged; `admin_reviewed_at` stamped, `skip_parser_optimization` false (it is a parser fixture). Watch registration 21 → 19 corrected entries. |

### 2026-10-09 — Kanata #541: a readable receipt photographed at ~12° (parser bug, Bugs #314)

Two receipts from one Kanata #541 self-checkout visit (2026-10-03), scanned 2026-10-09 16:05 UTC by the same
shopper, each read by Vision twice (1200px + 2000px retry; `ocr_captures` 35/36/38/39 and 37/40/41, exported with
`scripts/exportOcrCaptures.js`). **The photo was read** (the exact JPEG Vision received, cropped at full
resolution) and every figure closes on the paper's own checks: SUBTOTAL 196.12 = the 8 lines; TOTAL DISCOUNT(S)
46.50 = 6.50 + 5.50 + 4.50 + 20.00 + 10.00; ITEMS SOLD 8; HST 13% 24.43 = 13% of 196.12 − 3.39 (bananas) − 4.79
(water) = 187.94; TOTAL 220.55 = the INTERAC amount. The `0000390143 /MULTIPLE 5.50-` coupon prints directly under
CASHMERE TP and is applied to it. Spec: `backend/data/bad-scan-repairs/r_1791561933778_ec7p8.json`.

Checked first: no claim, no price-drop push, no review-queue row, no watch registration, no drafted notice, no
crowd copy for the device (`ac586ce769f574f4`). Applied with `repairBadScanReceipt.js --write` **from a worktree at
`22e35ec`** (the code prod runs; `main`'s tool writes `products.display_name_fr` from migration 0022, which prod
does not have yet), dry run first, then read back. No duplicate scan → no refund owed. No notice drafted (readable
receipt: `markSkipParser: false`, `notifyShopper: false`).

| Receipt id | Store / date | Evidence | Verified | Result |
|---|---|---|---|---|
| `r_1791561933778_ec7p8` | Costco Kanata #541 · 2026-10-03 | Photo + printed checks | 2026-10-09 | **Repaired.** 8 lines rebuilt to the paper: BOUNTY 12X91 25.99 (orig 32.49), CASHMERE TP 21.49 (orig 26.99, the MULTIPLE coupon), ORG FT BANAN 3.39, GAIN LIQUID 17.49 (orig 21.99), SAGE FULLZIP 22.99, NICORETTE2MG 69.99 (orig 89.99), LIQUID I.V. 29.99 (orig 39.99), KS WATR500 4.79. Was: every price a row off, 0 coupons, 4 synthetic `ln:` products (deleted), products 1424970/1716006/3226088/2014250 renamed (restored to the printed names). Lines = **196.12**, tax 27.90 → **24.43**, total 242.53 → **220.55**; 8 unit price points, coupon lines unwatched; `admin_reviewed_at` stamped, `skip_parser_optimization` false. |
| `r_1791561955338_t67po` | Costco Kanata #541 · 2026-10-03 | Stored lines vs printed checks | 2026-10-09 | **Correct, untouched.** OIKOS PRO 0% 12.49, DOG DELIGHTS 12.99 (orig 16.99), TURKEY BACON 13.99, P/BUTTER 2KG 7.99 (orig 9.99) = 47.46; HST 1.69; total 49.15. |

After the repair, `select id, total from priceback.receipts where … position(to_char(total,'FM9990.00') in <raw_ocr,
separators normalised>) = 0` → **0 rows**: no production receipt carries a total its paper does not print.
