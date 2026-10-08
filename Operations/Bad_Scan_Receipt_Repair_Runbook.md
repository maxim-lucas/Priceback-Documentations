# Bad-scan receipt repair — runbook

> **When:** a shopper's receipt photo was too distorted for the parser — taken at a steep
> angle, crumpled, folded, cut off — and the stored receipt is wrong (junk item names,
> the subtotal/tax/total stored as items, a total that does not match the paper).
>
> **Rule (Maxim, 2026-10-04):** fix the receipt's **data** for this one time; **do not touch
> the parser**. A parser bent to pass one unreadable photo gets worse on the readable ones.
> The receipt is flagged so it never becomes a parser fixture, and the shopper gets a
> friendly notice — **only after an admin approves it** on the console.

Code: `backend/lib/badScanRepair.js` (logic) · `backend/scripts/repairBadScanReceipt.js` (CLI) ·
specs in `backend/data/bad-scan-repairs/<receiptId>.json` · migration
`0019_receipt_review_flags_and_notification_approvals.sql`.

---

## 0. Is it a bad scan, or a parser bug?

| Signal | Bad scan → this runbook | Parser bug → fix the parser (with fixtures) |
|---|---|---|
| The photo | Steep angle, strong perspective, crease across the items, text drifting off the column | Flat, sharp, readable by eye |
| Raw OCR | Names and prices in scrambled order; header/footer words glued to items | Text in order, the parser mis-assigns it |
| Would a normal shopper's photo of the same print shape fail too? | No | Yes |

If in doubt, it is a parser bug: those go through the normal fixture workflow
(`scripts/exportOcrCaptures.js` → `receiptProdCaptures.test.js`).

## 1. Pull the evidence (read-only)

```sql
-- prod (Supabase xjfrlzwonyaorwktnkpj)
select id, user_sub, total, tax, raw_ocr, header_ocr, image_object_key
  from priceback.receipts where id = '<receiptId>';
select i.position, i.line_total, i.original_price, p.sku, p.display_name
  from priceback.receipt_items i join priceback.products p on p.id = i.product_id
 where i.receipt_id = '<receiptId>' order by i.position;
-- other price points the same submission wrote (same device, same minute), e.g. flyer_user_scan:
select pp.id, pp.product_id, pp.current_unit_price, st.code, pp.source_ref, pp.device_hash, pp.created_at
  from priceback.price_points pp join priceback.price_source_types st on st.id = pp.source_type_id
 where pp.device_hash = (select device_hash from priceback.price_points where source_ref like '<receiptId>:%' limit 1)
   and pp.created_at between <receipt created_at> - interval '1 minute' and <receipt created_at> + interval '1 minute'
   and pp.source_ref not like '<receiptId>:%';
```

Download the photo (one object, nothing printed, nothing written):

```powershell
cd C:\Workspace\Priceback\backend   # the checkout linked to Railway
railway run -e production node <scratch>\getimg.js "$((Resolve-Path storage/index.js).Path)" "<image_object_key>" "<scratch>\receipt.jpg"
```

(`getimg.js` = `require(storage).getObject(key)` → `fs.writeFileSync`.) Crop and zoom the item
block at full resolution — a phone-sized view hides digits.

## 2. Read the paper — and make it reconcile

Write the spec `backend/data/bad-scan-repairs/<receiptId>.json`:

```json
{
  "_note": "store, date, what was wrong, and how every uncertain line was decided",
  "receiptId": "r_…",
  "total": 224.55,
  "tax": 6.14,
  "items": [
    { "sku": "2051308", "name": "BAGUETTE LEV", "lineTotal": 5.99 },
    { "sku": "1787474", "name": "ELARA OLIVES", "lineTotal": 8.99, "originalPrice": 11.49 }
  ],
  "extraPricePointIds": [7964, 7965],
  "notifyShopper": true
}
```

- One entry per **item** line, in print order. Names exactly as printed (abbreviations and
  typos included — they are the product's identity across receipts). SKU = the printed item number.
- A coupon line (`00393628 /1787474  2,50-`) is **not** an item: fold it into the item it
  names — `lineTotal` = paid after the coupon, `originalPrice` = the pre-coupon price.
- `lineTotal` is the LINE total; set `quantity` for an `N @ unit` line.
- **It must reconcile.** The script refuses unless Σ lineTotal + tax = total to the cent. Use
  every check the paper prints:
  - `SOUS-TOTAL` / `SUBTOTAL` = Σ lineTotal
  - `NOMBRE D'ARTICLES VENDUS` / items sold = Σ quantity
  - `TOTAL RABAIS` / instant savings = Σ (originalPrice − lineTotal)
  - Tax bases: Quebec Costco prints `F` = TPS (GST) only, `FP` = TPS + TVQ, `P` = TVQ only.
    TPS ÷ 5 % and TVQ ÷ 9.975 % give the taxable bases; the flagged prices must add up to them.
    This is how a smudged flag or a hidden price is pinned down.
- A price you genuinely cannot read: if the totals force its value (one unknown), use it; if two
  lines swap ambiguously, decide by print order and **write it in `_note`**. Never guess a value
  the arithmetic does not force — a misread here becomes every shopper's price.

Validate offline: `cd backend && node --test tests/badScanRepair.test.js` (every committed
spec must reconcile).

## 3. Dry run, then write

```powershell
cd C:\Workspace\Priceback\backend
railway run -e production node <repo>\backend\scripts\repairBadScanReceipt.js --spec <repo>\backend\data\bad-scan-repairs\<receiptId>.json          # dry run (rolled back)
railway run -e production node <repo>\backend\scripts\repairBadScanReceipt.js --spec <repo>\backend\data\bad-scan-repairs\<receiptId>.json --write  # apply
```

Read the dry-run summary before `--write`: `before` / `after` lines and totals,
`pricePointsRemoved` (= old line count + extras), `pricePointsWritten` (= new line count),
`orphanProductsDeleted`, `crowdCopiesRemoved` (ids), `watchRegistrations`
(`rows`, `entriesRemoved`, `entriesWritten`), `notice.created`.

What `--write` does, in **one transaction**:

1. Removes the receipt's `receipt_ocr` price points and the listed `extraPricePointIds` —
   only rows carrying **this receipt's device hash** (anything else → refused).
2. Replaces `receipt_items` through `receiptsRepo.persistReceiptItems` — the live-scan path, so
   unit prices, coupon `original_price`, watch rules (coupon lines not watched) and price points
   come out exactly as a correct scan makes them. A real product the bad scan **renamed** gets its
   printed name back (last writer wins).
3. Sets `total`, `tax`; `admin_reviewed_at = now()`, `skip_parser_optimization = true`;
   recomputes the price-match status.
4. Removes this device's **crowd copies** of the bad parse (`flyer_user_scan`,
   `<deviceHash>:<purchaseDate>:<cents>`, filed by `/api/watch`) that the corrected receipt
   disproves: a price an OLD line carried for its product that no receipt line of this device
   that day carries now, paid or regular. True shelf prices stay (a couponed line's pre-coupon
   price, another receipt's price, another day's copy). Missing copies are not invented — the
   phone files them when it re-registers. (Since PR #411; `extraPricePointIds` still covers
   anything else.)
5. Deletes the bad scan's synthetic `ln:<receiptId>:<n>` products nothing references.
6. Rewrites every **watch registration** (`watch_registrations`) that lists the receipt: its
   entries are replaced, in place, by the corrected lines in the app's own shape (watchable lines
   only — not claimed, not a fee, watched, not discounted; none once the window has closed), the
   shopper's province kept, `touched_at = now()`. Other receipts' entries are untouched. The
   admin desk also refreshes the server's in-memory copy; after the CLI, the running server keeps
   the old list in memory until its next restart or the phone's next registration (nothing sends
   from it — Bugs #311). (Since PR #411.)
7. Drafts the shopper notice (`notification_approvals`, status `pending`) — **not sent**.

It **refuses** (nothing written) when: the receipt is missing or deleted; a line was already
claimed or a price-drop push went out for it — unless the spec lists it in `keepItemIds` and it
already IS the spec's line at its position (it is then left byte-for-byte); the spec does not
reconcile; an extra price point is another device's.

> ⚠️ It does **not** refuse a line carrying a pending verified-drop review
> (`price_drop_review_queue`): deleting the line cascades that row away. Check first
> (`select q.id, i.id, i.position from priceback.price_drop_review_queue q join
> priceback.receipt_items i on i.id = q.receipt_item_id where i.receipt_id = '<receiptId>'`) and
> list every such line that is already right in `keepItemIds`.

The shopper's app picks the corrected receipt up on its next sync (the server copy wins).

## 4. Verify

```sql
select total, tax, admin_reviewed_at, skip_parser_optimization from priceback.receipts where id = '<receiptId>';
select sum(line_total) from priceback.receipt_items where receipt_id = '<receiptId>';           -- = subtotal
select count(*) from priceback.price_points where source_ref like '<receiptId>:%';             -- = line count
select count(*) from priceback.products where sku like 'ln:<receiptId>:%';                    -- 0
select jsonb_array_length(items), touched_at from priceback.watch_registrations
 where items @> '[{"receiptId":"<receiptId>"}]';   -- the receipt's entries = its watchable lines
```

## 5. Approve the notice (admin console)

Admin → **Notifications to approve**. The card shows the shopper, the receipt and the exact
title + text in **every language** (the server sends it in the shopper's own language).
**Approve & send** → push, typed `receipt_quality_notice`, under the shopper's *Scan results*
switch; tapping it opens the corrected receipt. **Reject** → never sent.

Copy (from `backend/lib/pushI18n.js`, `notificationApproval.receipt_quality_notice.*`):

- **EN** — 📸 We fixed your receipt for you · *Your last receipt photo was hard to read, so we
  checked it by hand and corrected it this time. For better results next time: lay the receipt
  flat, hold your phone straight above it, use good light and keep the whole receipt in the frame.*
- **FR** — 📸 Nous avons corrigé votre reçu · *La photo de votre dernier reçu était difficile à
  lire : nous l'avons vérifiée et corrigée à la main cette fois-ci. Pour de meilleurs résultats la
  prochaine fois : posez le reçu à plat, tenez votre téléphone bien droit au-dessus, dans un bon
  éclairage, avec tout le reçu dans le cadre.*

Statuses: `pending` → `sent` | `undelivered` (approved, but no push token or the shopper turned
*Scan results* off) | `rejected`. One notice per receipt per kind, ever — re-running the script
never re-queues it.

> ⚠️ The desk and the push need the backend + app from the PR that added migration 0019. Until
> that is deployed, the drafted notice simply waits as `pending`.

## The two receipt flags

| Column | Meaning | Set by | Read by |
|---|---|---|---|
| `receipts.admin_reviewed_at` | An admin checked this receipt against its paper (null = never) | this runbook; Admin → receipt → *Mark reviewed* | admin receipt list + detail |
| `receipts.skip_parser_optimization` | Keep it out of parser tuning | this runbook; Admin → receipt → *Skip this receipt* | `scripts/exportOcrCaptures.js` (never exported, not even with `--receipt`); admin detail |

Neither is ever sent to the shopper's app.

## Log

| Date | Receipt | Store | What was wrong | Notes |
|---|---|---|---|---|
| 2026-10-04 | `r_1791145910170_14lyb` | Costco Vaudreuil #1213 (QC) | Steep-angle photo: 12 junk lines (header/footer fragments; subtotal 218,41, tax 6,14 and total 224,55 stored as items), total 534,01 / tax 0,00, 7 extra `flyer_user_scan` points, 3 real products renamed | Rebuilt to 18 lines, 218,41 + 6,14 = 224,55, 3 coupons = 7,50. LIME 6,99 / ALL POV ROUG 9,99 sit under the crease — assigned by print order (the 9,99 is directly above its 2,00 coupon). All 33 prod receipts stamped reviewed the same day; this one also skip-optimisation. Notice #2 pending approval. |
