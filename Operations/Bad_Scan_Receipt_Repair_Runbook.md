# Bad-scan receipt repair — runbook

> **When:** a shopper's receipt photo was too distorted for the parser — taken at a steep
> angle, crumpled, folded, cut off — and the stored receipt is wrong (junk item names,
> the subtotal/tax/total stored as items, a total that does not match the paper).
>
> **Rule (Maxim, 2026-10-04):** fix the receipt's **data** for this one time; **do not touch
> the parser**. A parser bent to pass one unreadable photo gets worse on the readable ones.
> The receipt is flagged so it never becomes a parser fixture, and the shopper gets a
> friendly notice — **only after an admin approves it** on the console.

> **First try the admin button (since 2026-10-11).** For a READABLE receipt whose lines are wrong, Admin → Receipt
> review → the receipt → **Fix automatically** proposes the corrected lines (Gemini), proves them against the paper
> and applies them through the same engine — no session needed: `Receipt_Auto_Fix_Admin_Button.md`. This runbook stays
> the path for bad photos, lines with history (`keepItemIds`), and anything the button cannot prove. Either way, name
> the root cause in `Technical/Receipt_Parser_Root_Causes.md` (standing rule).

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

### 0a. Too poor to repair? Reject it (added 2026-10-27)

When the photo can't be read even by eye (cut off, blurred, folded over the items)
or repairing it costs more than it's worth, don't repair it: on the admin desk's
receipt screen tap **Reject receipt (photo too poor) and ask to rescan**
(`POST /api/admin/receipts/:id/reject`, `backend/lib/receiptRejection.js`, migration
0038). In one transaction it:

- soft-deletes the receipt as `admin_rejected`, stamped with you, and flags it
  `skip_parser_optimization`. The row stays as the record: the shopper's phone drops
  the receipt on its next sync;
- deletes its own `receipt_ocr` price points and this device's crowd copies of them
  that no other receipt of the day carries. A plain **Delete** keeps the prices; a
  reject does not, because the prices are the misread;
- deletes its lines outright, and with them their price-drop review rows still
  waiting. The desk then shows the rejected receipt with no lines; the photo stays
  until the usual 7-day prune;
- deletes every product and the warehouse **the receipt created** (made within 10
  minutes of its upload, or later by the line editor) that nothing else uses now: no
  other receipt line (deleted receipts included), price, catalogue entry, saving, tag
  scan or merge. A product with a barcode or an admin-saved name is always kept. A
  name the receipt *filled* on a product that already existed can't be told apart
  from a real one and is left as is;
- removes it from every watch registration. `/api/watch` then ignores its lines if
  the phone re-sends them before it syncs.

Then it sends the shopper the push straight away (type `receipt_rejected`, *Scan
results* switch, EN/FR). It doesn't go through the approval queue, because your
confirmed tap is the approval:

> **Receipt rejected: please rescan** — Your receipt photo was too poor to read, so we
> couldn't process it. Please scan it again with only the header, the items and the
> total, laid flat in good light.

**No scan-credit refund** (Maxim, 2026-10-27). A receipt with a claimed line or a
price drop already sent can't be rejected (409 `HAS_HISTORY`); delete or repair
it by hand. Planned next (roadmap): the app refuses poor scans live, so the shopper
retakes the photo before it reaches the desk.

### 0b. Reproduce with the exact live capture before deciding (added 2026-10-09)

The phone parses; the stored lines are what **that phone's binary** made of Vision's answer. Replay the same answer
through the current parser before calling anything a parser bug or a bad photo:

```powershell
cd C:\Workspace\Priceback\backend
$env:NODE_PATH = "C:/Workspace/Priceback/backend/node_modules"
railway run -e production node ../scripts/exportOcrCaptures.js --since <ISO time of the last check>   # read-only
```

Each capture lands in `__tests__/fixtures/receipts/prod-captures/` (`<receiptId>__c<id>.vision.json`, plus the
gitignored photo/PDF and envelope). Parse every one with the word geometry, then read the photo/PDF itself.

- **Several captures per receipt** are normal: the 1200px pass, the 2000px retry, and frames the shopper abandoned
  (`unlinked__c<id>`: sideways, cropped, blurred). Every capture needs a ground-truth entry in
  `receiptProdCaptures.test.js` (`ok`, `partial`, `pdf_truncated`, `faded`, `unreadable`, …) — the suite fails on
  any capture without one.
- **A PDF:** check how many pages Vision was asked for (`request.pages` in the `.envelope.json.gz`). Until PR #416
  (Bugs #315) the route asked `[1, 2]` only, so a 3-page receipt lost its last lines and its totals. To read the
  whole PDF again, re-OCR the local file through Vision with `pages: [1..5]` using the **Development** key
  (`railway run -e Development`) — never production's.
- The auto-mode classifier treats `railway run -e production` as a production read: it needs Maxim's explicit
  permission each session (or he runs the export himself with `! <command>`).
- To compare with the shopper's binary, run the tagged version's parser from a worktree (`git worktree add --detach
  ..\pb-v<ver> v<ver>`, then junction its `node_modules` to the main checkout's).

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
- A **fee line** (`ECO FEE`, `ENVIRO FEE`, `DEPOSIT`, `*ECOFRAIS`, `CONSIGNE`) is part of the subtotal but not a
  product: add it with `"ignored": true` (its fee code as `sku`, or none). It gets no price point and is never watched
  — exactly what a live scan does. It cannot carry a coupon. (Added 2026-10-08.)
- **A READABLE receipt an older parser misread** (not a bad photo) takes `"markSkipParser": false`, so it stays a
  parser-fixture candidate, and usually `"notifyShopper": false` (draft a notice that fits the error instead —
  §5b). (2026-10-08.)
- **A line that already carries history** (a claim, a charged price-drop push, its review-queue row) makes the tool
  refuse the whole receipt — deleting that row would cascade its charge record away. If that line is already right,
  name its `receipt_items.id` in `"keepItemIds": [204]`: the spec line at the same position must be identical
  (product, quantity, price, coupon, fee flag), and the row, its charge record, its queue row and its price point are
  left exactly as they are while every other line is rewritten. (2026-10-08, first used on `r_1790808757051_f3ivl`.)
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

> ⚠️ **Run the code production runs, not `main`.** `main` can be ahead of prod's schema: on 2026-10-09 it carried
> #412's `products.display_name_fr` (migration 0022) before 0022 was applied to prod, and the tool refused on its
> first `products` insert. Compare `railway deployment list -e production` (the deploy time) with
> `git log origin/main`, then run the deployed commit from a worktree:
>
> ```powershell
> git -C C:\Workspace\Priceback worktree add --detach ..\pb-prod-<sha> <sha>
> cd C:\Workspace\Priceback\backend          # still the Railway-linked checkout
> $env:NODE_PATH = "C:/Workspace/Priceback/backend/node_modules"
> railway run -e production node C:/Workspace/pb-prod-<sha>/backend/scripts/repairBadScanReceipt.js --spec <spec>   # then --write
> ```

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

**The admin desk's line editor (since 2026-10-28, Maxim):**
- It keeps every line with history that the edit leaves **unchanged** without naming it
  (`keepUnchangedHistory`). Fixing *another* line of a receipt that has a price drop
  (the 84 COKE case) is no longer refused. The *Fix automatically* dry run uses the same rule.
- If a line you **changed** has history, the save is refused (`HAS_HISTORY`). A red
  **Force save** button then appears. Force (`force: true`, admin only) rewrites that line
  too and **moves** its history onto the corrected line at the same place: the claim
  (`claimed_at`, `claim_source_id`), the `price_drop_notifications` rows (the charge record,
  so the drop is never charged or pushed twice) and the `price_drop_review_queue` rows. A
  history line with no place left in the edit (the edit has fewer lines) is still refused.
  The moved rows still describe the old drop (its product and price). That is why force
  stays a deliberate, red action.
- An admin may type a **2-digit** item number (Costco prints a few, e.g. `84 COKE`). The
  desk shows it back. Shopper reads still show only 3–12 digits. The catalogue and savings
  harvests only know 3–12-digit numbers, so such a product will in practice never get a
  drop. A Gemini re-read keeps the 3-digit floor.
- The runbook CLI is unchanged: it still needs `keepItemIds` and has no force.

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

## 5b. A notice that fits the error (custom wording)

When the stock "photo was hard to read" copy does not describe what happened — a false price-drop alert, a
quantity read wrong, a total read as an item, our own price check — draft the notice with its own wording:

```powershell
cd C:\Workspace\Priceback\backend
railway run -e production node <repo>\backend\scripts\draftShopperNotices.js --file <repo>\backend\data\shopper-notices\<file>.json          # dry run
railway run -e production node <repo>\backend\scripts\draftShopperNotices.js --file <repo>\backend\data\shopper-notices\<file>.json --write  # draft
```

The file names only **receipts**; the recipient is each receipt's owner. Every supported language needs its own
title and body (no stock fallback); no item names (a push shows on a locked screen). A pending notice is reworded, a
sent or rejected one is never touched. Needs migration **0021** (`notification_approvals.custom_copy`). Nothing is
sent: each card then waits on Admin · Notifications to approve.

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
| 2026-10-08 | 9 receipts (Bugs #311) | Pointe Claire #528, Vaudreuil #1213, Montreal #515 | NOT bad photos: receipts scanned before 3.0.5 that the older parser misread (a quantity, lost coupons and fee lines, a fee read as an item, back-computed taxes) | Specs `r_1790812128897_94g20`, `…5mwuj`, `…nhngb`, `…f3ivl` (keep item 204), `…qvs25`, `…5clwk`, `…n12jm`, `…amlyo`, `…i0bha` — all `markSkipParser:false`, `notifyShopper:false`; notices via §5b (`2026-10-08-false-price-drops.json`). ⏳ Owed: the `--write` runs (see the Task Log entry). |
| 2026-10-09 | `r_1791561933778_ec7p8` | Kanata #541 (ON) | NOT a bad photo: a readable receipt photographed at ~12° and curled — every price a row off its item, 5 coupons lost, total back-computed 242.53 (paper 220.55) | Parser bug (Bugs #314). `markSkipParser:false`, `notifyShopper:false`. Run from a worktree at `22e35ec` (the code prod runs). |
| 2026-10-10 | `r_1791573195154_8y5tt` | Boisbriand #546 (QC) | NOT a bad photo: 548.38 / 71.42 for 573.04 / 31.09 — a cash line (`Comptant`) and the stamp ended the totals block, the eco fee read `NECOFRATS` / `0,96 FF`, 15 of 34 products lost, the 173.04 payment stored as an item | Parser bug (Bugs #315). `markSkipParser:false`, `notifyShopper:false`. Run from a worktree at `22e35ec`. 3 crowd copies of the bad parse removed by the tool. |
| 2026-10-10 | `r_1791587435861_g01kg` | Drummondville #1127 (QC) | NOT a bad photo: both fee lines lost (139.88 for 144.78) by the 3.0.5 binary; the current parser reads it right | Bugs #315. Same flags, same worktree. |
| 2026-10-10 | `r_1791590373883_i7aiw` | Lévis #1186 (QC) | The Quebec **digital PDF** (3 pages): `/api/ocr` read pages 1–2 only; totals right, the last 3 lines stored SKU-less, BOEUF RAGOUT ×1 for `2 @ 24,99` | Bugs #315 (the backend now reads up to 5 pages). Spec read off the PDF; fee lines keep their printed codes. |
| 2026-10-10 | `r_1791646028977_4jfke` | Costco Quebec #503 (QC) | NOT a bad photo: both fee lines (*ECOFRAIS 0,08, CONSIGNE QC 0,20) missing, 75.80 for 76.08 — both live captures parse right; the review screen re-derived the total after the fee rows were deleted | Bugs #316. `markSkipParser:false`, `notifyShopper:false`. Run from the `22e35ec` worktree. |
| 2026-10-10 | 7 receipts of `000195.…0626` | NOT Costco (Fashion Nova, Hoodrich order confirmations) | Saved as "Costco online"; a billing address `#306` registered as warehouse 537074 | Not a spec: one asserted `DO` block — 10 price points deleted, receipts + lines soft-deleted (reviewed, skip-optimisation), warehouse 537074 deleted, watch registration emptied. Bugs #316. |
| 2026-10-11 | `r_1791693864226_r06sa` | Vaudreuil #1213 (QC, English) | NOT a bad photo: 7 of 21 coupons lost, 509.15 stored for 480.15 (subtotal 458.76 + tax 21.39) — five `<6-digit> /MULTIPLE` coupons (RC-1: `unweldSkuSlashName` removed their slash) and two produce coupons whose ref was read slash-less, `39519127003` (RC-2) | `markSkipParser:false`, `notifyShopper:false`. **Applied as an in-place SQL transaction through the Supabase connector** (no Railway `DATABASE_URL` in the cloud session): the 7 lines + their price points (paid / regular / on sale), total, `admin_reviewed_at`, 4 watch entries removed (now-couponed lines); no crowd copy disproved, no product renamed. Spec committed for the record (do not `--write` it: it would rename catalogue products). Parser not changed (Maxim). |
| 2026-10-12 | `r_1791776785814_3mq8x` | Sherbrooke #1367 (QC) | NOT a bad photo: a 445.23 purchase saved as a −417.67 refund, 27 lines negated and unwatched; CREVETTES's and ALLEGRO's coupons folded into item rows | Spec, with #427 (`207393a`). Root causes RC-4 (a lone `-` under the TOTAL read as a refund) and RC-8 (coupon-row fold); RC-9 hid the refund from the fixture corpus. Row added 2026-10-19. |
| 2026-10-12 | `r_1791777296528_mebfs` | Brossard #521 (QC) | NOT a bad photo: tax saved as 15.02 for the printed 22.52 (lost lines booked as tax); the 2000px pass stopped at a mid-receipt totals block; two coupons lost (TH CHAUS.8PQ's second 5.00-, SWEETSIXTEEN's 2.50-) | Spec, with #427. Root causes RC-5, RC-7, RC-6, and RC-2 with RC-14. Row added 2026-10-19. |
| 2026-10-12 | `r_1791814977185_p2s1a` | Boisbriand #546 (QC) | NOT a bad photo: filed under Sainte-Foy #516 with its 27 price points and watches; the 8 articles below a mid-receipt totals block lost; AMIRA's 20.00- coupon and BATON CELERI lost | Spec, plus guarded SQL moving the receipt and its 27 price points to #546, with #427. Root causes RC-10 and RC-7; AMIRA's coupon (RC-13) and BATON CELERI: proof owed. Row added 2026-10-19. |
| 2026-10-13 | `r_1791853110451_7yckq` | Barrhaven #1263 (ON) | NOT a bad photo: tilted, every price a row off, `/MULTIPLE 7.00-` lost; 253.89 for 246.89; catalogue names corrupted | Spec, `--write` on the deployed `main` (`207393a`, prod backend deployed 10:28 the same day). 9 labels restored, 13 crowd copies of the bad parse removed. Root causes: RC-12 + open case O-1. |
| 2026-10-13 | `r_1791853201148_ejx4g` | Barrhaven #1263 (ON) | Pen stroke down the SKU column: tax 13.98 invented (paper 0.00), BARTLETT + 2 coupons lost, 3 SKUs truncated. **No receipt image** (Bugs #319) | Spec, `--write`. Two SKU digits under the ink kept as read (22117, 149442), never guessed. 3 junk products (10893, 171600, 197372) deleted after (guarded, unreferenced). RC-5 + O-3. |
| 2026-10-13 | `r_1791853644536_szw1y` | Barrhaven #1263 (ON) | 313.36 for 354.32: coupons glued to the next rows, 2 items + VOID line lost, 4 coupons lost | Spec, `--write` (43 lines; QUAIL EGGS SKU-less — a digit is under the ink in every capture). O-2. |
| 2026-10-13 | `r_1791896364317_u8xbn` | Sherbrooke #1367 (QC) | Parser right; the shopper removed 2 lines on the review screen and the total was re-derived (1261.29 for 1315.27) | Restored to the paper (Maxim). RC-3. |
| 2026-10-13 | `r_1791841333433_eql4t` | Pointe-Claire #528 (QC) | Lines right; product 2974611 named with the pre-scan banner (3.0.5) | Spec without `language` so the BASE label (where the noise sat) is corrected. |
| 2026-10-13 | `r_1791823503830_w0dv6` | Sherbrooke #1367 (QC) | Duplicate re-scan of `3mq8x` (same account, device, paper) | Not a spec: one guarded `DO` block (Supabase connector) — 25 price points deleted, receipt + 27 lines soft-deleted, 22 watch entries removed, reviewed + skip-optimisation. Notices #3–#5 drafted via §5b (`2026-10-13-october-receipts-reviewed.json`), pending Maxim's approval. |
| 2026-10-13 | `r_1791853258418_xzw9x` | Nepean #540 (ON, self-checkout) | NOT a bad photo: logo cut off, so not detected as Costco (RC-15) — BAGELS stored at the TOTAL 129.74, a `for your records` line, 4 items + 3 coupons lost; 323.97 for 129.74 | Spec, `--write` on `main` `68d6017` (backend identical to deployed `207393a`). NAUTICA SKU 2037641 read off the photo (pen stroke). RC-15 + RC-16 + RC-2 + RC-17. Remaining-receipts pass (Maxim: unreviewed, purchase_date + 30 ≥ today, not deleted). |
| 2026-10-13 | `r_1791723518253_4qp2s` | Sherbrooke #1367 (QC) | Lines right; 3 catalogue names garbled by the geometry rows (`Bas du pobler BATTERIE KS`, `CORN`, `- FAL IRON`) | Spec with `language: fr`, `keepItemIds: [1436]` (BISCOFF had a drop notification). RC-18, RC-13, RC-19. |
| 2026-10-13 | `er1cc`, `6czgq`, `xuxbv` | Vaudreuil #1213, Sherbrooke #1367 | Nothing — right against the paper | Stamped reviewed (guarded `UPDATE`, totals re-checked). |
| 2026-10-14 | `r_1791931739349_fpnqe` | Sainte-Foy #516 (QC) | A KOHLER leaflet in the photo: `77264 PAIN HAMB. 6.99` lost, total re-derived 78.95 (paper 85.94) | Guarded `DO` block (Supabase connector): product 77264 created, line inserted at position 0 (others shifted, source_refs too), price point, total, reviewed. RC-23 + RC-3. Monica's go-ahead. |
| 2026-10-14 | `r_1791933620723_g7ntk` | Nepean #540 (ON) | BEYOND BURGE ×3 stored QT 2 + "Unknown item" QT 1 (product renamed "Unknown item"), CAD MILK's 4.00 coupon lost, KS VIT D marked couponed; 310.82 for 306.82 | One line QT 3 (extra line **soft-deleted** like the app does, price point kept), product renamed BEYOND BURGE, CAD MILK 15.99/19.99, total, reviewed, 2 watch entries removed + burger entry QT 3. RC-21 + RC-22 + RC-3. |
| 2026-10-14 | `r_1791933708024_t09q9` | Gloucester #1362 (ON) | FLATWRE's 15.00 coupon lost, tax back-computed 4.23 (paper 19.23) | Line 54.99/69.99, price point, tax, reviewed, 1 watch entry removed; PANDEX (notified) untouched. RC-20 + RC-5. SQL: `backend/data/bad-scan-repairs/2026-10-14-three-receipts.sql`. |
| 2026-10-14 | `r_1791974178660_9zj1r` | Montreal #515 (QC, PDF) | Closed to the cent, but `1607671 PISTACHES SP 13.99` was stored with no SKU, under a line-only product | Guarded `DO` block (Supabase connector): the line, its price point and its watch entry moved to catalogue product 7556 (sku 1607671); line-only product 33643 left unused; reviewed. RC-25. SQL: `backend/data/bad-scan-repairs/2026-10-14-five-receipts.sql`. |
| 2026-10-14 | `n5hi9`, `jt6a4`, `xadqq`, `5bvzh` | Montreal #515 ×3, Laval #505 | Nothing. Each line and total is right against the printed subtotal, tax and total | Stamped reviewed (guarded `UPDATE`). |
| 2026-10-23 | `r_1792728413893_vi24j` | Windsor #534 (ON) | NOT a bad photo: one purchase printing two SUBTOTAL/TAX/TOTAL blocks (interim 111.29 / 9.81 / 121.10 after 8 lines); a VOID block read `' OID` (3M SPONGEX24 billed twice, its voided coupon stored as a 4.00 item), LOLE FZIP's slashless `MULTIPLE 7.00-` lost, `4 @ 4.79` read `48 4.79` (SKU-less line); tax back-derived 19.86. 776.28 + 19.86 for 750.79 + 45.35 = 796.14 | Spec, `--write` on `main` `8345bb0` (= deployed). `keepItemIds: [3370]` (HEADNSHLDERS's review-queue row); shifted lines carry their catalogue label so nothing is renamed; `productName` restores 2 labels a bad scan had corrupted (ADIDAS PANT, W+A RUG). 20 lines, 28 units, discounts 101.50. RC-26..RC-30 (+ RC-5). The admin *Fix automatically* had refused the right answer (RC-32). |
| 2026-10-16 | `r_1791776785814_3mq8x` | Sherbrooke #1367 (QC) | NOT a parse error: the phone still showed the duplicate `w0dv6` (deleted server-side 10-13; builds before 3.0.7 never drop a server-deleted receipt), so they deleted the one left, `3mq8x`, at 21:43 UTC. Both were then gone (the build is not stamped: `users.app_build` null) | Restored (Maxim): `deleted_at` cleared on the receipt + 29 lines, guarded on the 21:43:08.037 delete stamp. Price points untouched. No root-cause entry: no receipt line was wrong. |
| 2026-10-28 | `r_1793110284881_3eips` | Nepean #540 (ON, self-checkout) | Logo cut → generic parser (RC-15); the Shop Card tender lines stored as items (RC-33: `REMAINING BALANCE` 1220.51, `Shop Card` 243.73); first line's price hidden at the top edge and a steep tilt cost 3 more lines. 6 lines / 1584.88 for 13 lines / 243.73 | Spec (photo, proved: Σ 228.03, HST 15.20 on 116.92, GST 0.50, discounts 25.00, 13 items), `--write` from a worktree at deployed `1b8a595`. Its two review-queue rows (DAWNRISE 1963, JERKY 2091) were admin-REJECTED and never sent, and no kept line could match its new place, so a scratch wrapper deleted those two rows and ran `badScanRepair.repair` in the SAME transaction (dry run first). Catalogue names used for 6 lines so nothing is renamed (`productsRenamed: 0`). 2 synthetic products removed, watch registration 4 → 7 entries, reviewed + skip-optimisation. No notice drafted (the same shopper gets the `mez7p` rejection push). |
| 2026-10-28 | `r_1793110195684_mez7p` | Nepean #540 (ON) | Folded receipt: ~4 of 14 items and the SUBTOTAL/TOTAL figures under the fold, item numbers cut at the left edge (paid 159.01, HST 2.53, discounts 24.00). Stored 4 lines / 18.29. Cannot be rebuilt from the photo | ⏳ **To reject** (#497, `admin_rejected` + `receipt_rejected` push) once prod runs `main` (prod is on `1b8a595`, before #497). Migration 0038 applied to prod by hand 2026-10-28 (ledger row 49). |
| 2026-10-28 | `r_1793156647777_0fs8x` | Gloucester #1362 (ON) | Only the payment/tax section was photographed (MasterCard 355.30, HST 10.52, 20 items, no item lines). Stored 2 junk lines (`for your records` 355.30, `(HHST 13%` 10.52) under warehouse #159 (seeded, kept) | ⏳ **To reject** (#497) once prod runs `main`. |
