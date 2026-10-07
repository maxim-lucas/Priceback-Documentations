# Receipt repair playbook — a customer's scan parsed wrong

**Use this when** a real customer's receipt was stored with wrong lines or
totals, typically noticed because they scanned the same receipt again. Written
2026-09-30 from the Pointe Claire #528 case (two receipts × two scans); the
2026-09-27 repairs followed the same shape. Every finished repair is recorded in
[`Receipt_Data_Verification_Ledger.md`](Receipt_Data_Verification_Ledger.md).

The order matters: **fix the customer's data first, then the parser, then tell
them.** The customer shouldn't wait on a code review.

## 1. Find the account and the receipts (read-only)

Prod Supabase `xjfrlzwonyaorwktnkpj`, schema `priceback`. Recent receipts with
item count and line sum:

```sql
select u.sub, r.id, r.created_at, r.purchase_date, r.total, r.tax, r.deleted_at,
       (select count(*) from receipt_items i where i.receipt_id=r.id and i.deleted_at is null) n,
       (select sum(line_total) from receipt_items i where i.receipt_id=r.id and i.deleted_at is null) s
from receipts r join users u on u.sub=r.user_sub
where r.created_at > now() - interval '3 days' order by r.created_at desc;
```

A re-scan of the same paper has the same `purchase_date`, and usually
byte-identical `raw_ocr` (compare `md5(raw_ocr)`). The user often soft-deletes
one copy, and **not necessarily the wrong one**: at Pointe Claire the deleted
copy of 09-23 was closer to the truth than the one kept.

Skip any id already in the verification ledger unless its row has changed since.

## 1b. Is it a receipt we track at all?

Read the header first. A receipt printed **outside Canada** (a US `City, ST 12345`
address line, no Canadian postal code — `shared/receiptCountry.js`) is not repaired:
it is flagged and its prices taken out of the pool. Since 2026-10-02 the app refuses
such a scan and the server stores an older build's upload as `unsupported_country`
with no price points; a receipt from before that needs the manual version — see the
Bayonne, NJ entry in the verification ledger for what to change (status, watch off,
printed totals, delete its `source_ref <id>:%` points, its device's
`<deviceHash>:<date>:%` crowd copies and the auto-registered warehouse stub). Tell the
customer the store isn't supported **yet**, not that the scan failed.

## 2. Establish the truth from the PHOTO

- Get the R2 original (`receipts.image_object_key`). Maxim downloads it when the
  session can't (`cd backend && railway run …` with `storage/r2.js#getPresignedGetUrl`).
- Read every line off the photo. **Never repair from OCR alone.** The OCR is
  what the parser already misread.
- Prove the reading with the receipt's own arithmetic, to the cent: lines =
  SOUS-TOTAL/SUBTOTAL; + TAXE = TOTAL; TPS 5% and TVQ 9.975% (or HST) on the
  flagged lines; units = NOMBRE D'ARTICLES VENDUS; discounts = TOTAL RABAIS. If
  any check doesn't close, you've misread something. Stop.
- Watch for: discounts with a tax flag after the minus (`6.00-FP`), `RABAIS`
  lines, label runs printed before their amounts, `ANNUL`/`VOID` blocks.
- **Stored OCR right, stored lines wrong ⇒ the GEOMETRY path broke** (a photo's
  path). `raw_ocr` is flat text and cannot replay it. Until OCR capture (PR #399)
  is live, re-OCR the R2 photo with production's exact request —
  `backend/lib/visionOcr.js#callVisionOcr` under `railway run -e production`,
  straight to Vision (through `/api/ocr`, OCR capture would file a copy of the
  customer's photo in that environment) — and replay `{ text, words }` through
  `parseReceiptText` + the scan's own steps. The stored photo is a derivative:
  pen strokes and re-compression can read differently than the live scan did.

## 3. Check what the repair could disturb

```sql
-- must all be empty / zero before touching lines
select * from price_drop_notifications n join receipt_items i on i.id=n.receipt_item_id where i.receipt_id in (…);
select * from price_drop_review_queue q join receipt_items i on i.id=q.receipt_item_id where i.receipt_id in (…);
select * from receipt_items where receipt_id in (…) and claimed_at is not null;
```

FKs onto `receipt_items` cascade (notifications, review queue), so deleting a
line that has one silently deletes a charge record. Check first.

The same parse also reached two shared places:

- **Crowd copies.** The app's `/api/watch` registration files every non-discounted
  line as a crowd observation: `price_points` with `source_type_id = 4`,
  `source_ref = <deviceHash16>:<purchaseDate>:<priceCents>` (the device hash is the
  prefix of the receipt points' `device_hash`). A wrong price there feeds every
  shopper's drop detection. The credit ledger uses the same string as `ref`.
- **Product names.** Every receipt upsert sets `products.display_name` to that
  receipt's parsed name (`recordReceiptPricePointsBulk`), so a garbled parse
  renames the product for every shopper.

## 4. Repair — one guarded transaction per step, then read back

A single `DO $$ … $$` block that **raises unless every row still matches the
audit** (total, item count, no claims, no notifications). Match what
`receiptsRepo.persistReceiptItems` writes:

- `receipt_items`: `line_total` = paid line total, `original_price` = pre-discount
  line total (TPD/coupon lines only), `quantity`, and `watch_enabled = (original_price is null)`.
  Fee lines (`ECOFRAIS`, `CONSIGNE`) are `ignored = true` with no price point.
- `price_points` (`source_type_id = 2`, `source_ref = <receiptId>:<position>`):
  UNIT prices. `current_unit_price` = paid / qty, `regular_unit_price` = original
  / qty (or = current), `is_on_sale = original > paid`. Copy `province_id`,
  `warehouse_id`, `device_hash`, `observed_at`, `valid_from` from the receipt's
  existing points.
- New SKUs need a `products` row (`store_id`, `sku`, `display_name`), inserted
  with `ON CONFLICT (store_id, sku) DO NOTHING`.
- Positions change when lines are added: delete the receipt's items and points
  and re-insert all lines, rather than patching them.
- Update `receipts.total` / `tax` to the printed values.
- Assert inside the block that the lines sum to the printed subtotal.
- Crowd copies: delete the ones carrying a WRONG price (check the ledger `ref`
  first); keep true shelf prices — a couponed line's pre-coupon price is one. Don't
  hand-insert the missing ones: the phone re-registers its corrected lines after
  its next hydrate and production code records them.
- Restore a garbled product name to the printed one (guard on the garbled value).

**The phone picks it up by itself.** Hydrate runs on every app launch
(`bootService`), and `mergeServerIntoLocal` makes the server authoritative for
header and item fields. No app action is needed.

## 5. Clean up the duplicates

For each duplicate scan (soft-deleted or not):

1. Delete its `price_points` (`source_ref LIKE '<id>:%'`). Soft-delete KEEPS
   them, so a misparsed duplicate leaves wrong prices in the crowd pool.
2. Delete the `receipts` row; items cascade.
3. Delete its synthetic `ln:<id>:<n>` products once nothing references them.
4. The R2 photo stays unless someone with R2 access deletes it
   (`prod/receipts/<sub>/<id>.jpg`).

Keep `credit_ledger` rows. `balance_after` is a running chain, and deleting rows
breaks it.

## 6. Refund the duplicate scans

**Every scan the customer repeated because our parse was wrong is refunded: one
credit per duplicate.** Maxim does this himself from the admin console
(`POST /api/admin/users/:sub/credits`), so the grant carries an admin reason
and shows in the customer's credit history. Record the refund in the ledger entry.

## 7. Fix the parser

Branch off `main`. Changing `costcoReceiptParser.js` or shared parsing code needs
Maxim's explicit confirmation.

1. Pin the receipt as a fixture: the stored `raw_ocr` with `header_ocr` on top,
   in `__tests__/fixtures/receipts-prod-text/`. Mask cashier names and member
   digits shape-for-shape. Add a README row.
2. Replay it to confirm you reproduce production's wrong parse **before**
   changing anything.
3. Fix it in the narrowest place (French-only shapes go in
   `normalizeQuebecCostcoLayout` / the locale pass). Pin **every line** from the
   photo, not only the total.
4. Mutation-check each fix and each guard. Count occurrences before mutating;
   a mutation that didn't apply reads as green.
5. Run all receipt/parser suites (the golden snapshots catch byte-level drift on
   other receipts), then the full `npm test` with coverage.

## 8. Tell the customer

One short push, **drafted and shown to Maxim before it is sent**. Language:
English when `user_preferences.language` is `en` or missing; French **only** when
the saved preference is `fr`. Never bilingual (Maxim, 2026-10-04). Professional
and calm: the receipt was checked and corrected, even though the image wasn't
perfect, and every item is now tracked. No apology for a "bug"; never say how
long it took.

The 2026-10-04 copy (current standard):

> **Your receipt is ready ✅** — Image quality can sometimes cause scanning
> errors. Our validator double-checked your Costco receipt and fixed it, so
> every item is now tracked.
>
> **Votre reçu est prêt ✅** — La qualité de l'image peut parfois causer des
> erreurs de lecture. Notre validateur a vérifié votre reçu Costco et l'a
> corrigé : tous vos articles sont maintenant suivis.

The older 2026-09-30 copy (superseded):

> **Your receipts are ready ✅ · Vos reçus sont prêts ✅**
> We double-checked your 2 Costco receipts and corrected the lines that were hard
> to read. Every item is now tracked for price drops. · Nous avons vérifié vos 2
> reçus Costco et corrigé les lignes difficiles à lire. Tous vos articles sont
> maintenant suivis.

Until a server-side sender exists, send it through the Expo push API with the
user's `users.push_token`, only if `notificationsEnabled` and `notifScanResults`
are on. Then insert a matching `notification_history` row
(`notification_type_id` = `notifScanResults`) so it shows in the admin console.
**Follow-up owed:** an admin "receipts reviewed" sender
(`data.type: "receipts_reviewed"`, `notifScanResults`, tap → Receipts, copy in
`pushI18n`) so this step stops being a manual send.

## 9. Record it

- A row per receipt in `Receipt_Data_Verification_Ledger.md` (before → after).
- A `Bugs_Common_Fixes.md` entry for the parser bug, in the same commit.
- A Task Log entry.
