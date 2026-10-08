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
