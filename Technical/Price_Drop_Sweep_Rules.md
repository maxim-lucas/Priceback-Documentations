# Price-drop sweep rules

**Standing rules, set by Maxim on 2026-11-16.** They apply to every change to the price sweep, the price-drop queue,
Potential price drops and the confidence score. They replace the parts of
[`Price_Drop_Queue_Rules_2026-11-12.md`](Price_Drop_Queue_Rules_2026-11-12.md) listed under "What changed".

Hotfix: Priceback `hotfix/price-drop-trusted-sources-rule-of-n`.

## What Maxim asked

> *"the actual behavior for price drops detection (price sweep) has been wrongly managed by fable few days ago. the
> actual rules to always be followed and saved in the documentations:*
> *any trusted source (sameday [warehouse or business], official costco website [warehouse or business], verified
> price tags) should always skip the rule of N and go straight to the price drop queue (high confidence) [this has
> been changed by fable without my consent and it is wrong]*
> *any untrusted source (other than these or unverified price tags) should follow the rule of N, if not go to
> potential price drop.*
> *any deleted receipts (unverified or scrambled or bad quality [low confidence]) before review should be in
> potential price drops (if price points still available)*
> *SKU is the only winner for the price sweep and the drop make sense it go to the real queue (sometimes it goes to
> the potential price drop because the name is not the exact name on receipt)*
> *a claimed price drop never come back to any the price drop queue"*
>
> *"adjust the confidence based on that, few examples are already in the queues, also add this rule (price drop with
> no stock should be with the button of approve without credit charge in all screens."*

## The rules

### 1. A trusted source skips the rule of N and goes straight to the Price-drop queue

Trusted sources:

| Source | How the sweep reads it |
| --- | --- |
| Same-Day, Costco warehouses and Business Centre | a row in `savings`, with the warehouses that list it |
| costco.ca and costcobusinesscentre.ca (the coupon book, the savings page) | a row in `savings`, valid for the whole province |
| A verified price tag | a `price_points` row an admin verified |
| The weekly flyer import, a retailer's own price feed, a price an admin verified | `price_points` |
| A third-party saving an admin confirmed | `savings`, `flags.toConfirm = false` |

A drop from one of these is staged as soon as the sweep finds it and is listed on **Price-drop queue → To review**.
What could not be confirmed (no live Same-Day read yet, an unknown regular price, a receipt that does not add up)
lowers the **score** on the card and blocks the automatic approval. It does not move the drop to another screen.

One definition: `backend/lib/priceDropTier.js` → `dropTier`.

### 2. An untrusted source follows the rule of N

Untrusted sources: a shopper's receipt, a shopper's price-tag scan nobody verified, a website or social post
(yepsavings, the admin's social import).

- Each is **one vote** of the N (`PRICE_VERIFY_MIN_USERS`, never below 2). A post votes once per post.
- N reached: the price is verified, and its drops go to the Price-drop queue, badge `RULE OF N REACHED · SEEN BY n`.
- Fewer than N: the price is a card on **Potential price drops**. Nothing is staged, charged or pushed.
- A `.97` price is never verified by votes (warehouse clearance, unchanged).

One definition: `priceDropRepo.CASTS_VOTE`, read by the sweep, the potential list and the sticky stamp
(`markNewlyVerified`).

### 3. A receipt deleted before review is potential-only evidence

A receipt with `deleted_at` set and `admin_reviewed_at` empty was never checked against its paper, by an admin or by
the app's own approval (both stamp `admin_reviewed_at`). Its price points stay in the database.

In the sweep such a row:

- casts no vote,
- is no bypass (not as an admin's own receipt, not through a sticky rule-of-N stamp),
- is not the "seen after the purchase" sighting.

On Potential price drops it is still evidence: the card says "also on n receipts deleted before review (not
counted)", and the evidence row carries `deletedUnreviewed`. An admin's **Verify price** on that card makes the
row count like any other.

One definition: `priceDropRepo.UNREVIEWED_DELETED_ROW`.

### 4. The item number alone decides the product

A line matches a price or a saving by its product (the SKU). The printed name is shown on the card
(`name_matches`, advisory). It never lowers the score, never blocks the automatic approval and never moves a drop to
Potential.

A trusted drop is held on Potential only when something says it is **not a drop for this shopper**
(`dropConfidence` → `holdReasons`):

| Check | Held when |
| --- | --- |
| `official_source` | the saving is a third party's and no admin confirmed it |
| `listed_at_warehouse` | a Same-Day saving is not listed at the receipt's warehouse, or the receipt names none (a flyer saving covers the province) |
| `dates_valid` | no end date, dates in the wrong order, ended, or months long |
| `bought_in_window` | bought after the saving ended, or the store window is closed |
| `not_weighted` | sold by weight |
| `plausible_discount` | the saving is more than half the price |
| `within_limit` | the quantity is over the saving's limit |
| `no_tpd_on_paper` | the paper prints a TPD for the item (no text to check does not hold it) |

### 5. A claimed line never comes back

- The sweep finds open lines only (`claimed_at IS NULL`), on both paths.
- Potential price drops lists open lines only.
- A re-drop (missed claim) is never owed on a claimed line (`redropClause`).
- `priceDropQueueRepo.stage` drops any claimed line it is handed, whatever the caller.

Checked on production on 2026-11-16: no queue row was created, and no notification or re-drop sent, after its line
was claimed.

Unchanged: a drop already waiting when the shopper claims it stays in the queue and is billed when it leaves, with no
alert. It did not come back; it was never sent.

### 6. An out-of-stock drop can be approved without a charge

Costco adjusts a price only while the item is in stock. When the item is out of stock at the shopper's warehouse
(`confidence.stock.status = "out_of_stock"`), the card shows **Approve without charge · out of stock**, on the
Price-drop queue and on the held drops of Potential price drops.

- Route: `POST /api/admin/price-drop-queue/:id/approve-free`. It refuses any other drop (`409 not_out_of_stock`).
- The drop leaves through the ordinary delivery with a charge of 0: the same re-check, ledger row and push. A later,
  deeper drop bills only what lies beyond this price.
- It is sent at once, also while delivery is paused.
- If the delivery fails the row goes back as pending, never approved (an approved row would be charged by the drain).

One definition: `priceDropTier.canApproveWithoutCharge` shows the button and guards the route.

### 7. The confidence score follows these rules

- 13 counted checks (14 before: the name left).
- `plausible_discount` compares the saving with the price when one is known. The harvest's `deepDiscount` flag
  decides only when no price is known.
- 100% still means every counted check passed, and only 100% is flagged for automatic approval.

## What stays from 2026-11-12

- **The savings table answers first.** A price group answers only for a line no saving covers.
- **A Same-Day listing counts at the warehouses it names.** A Same-Day price row verifies nothing for the rest of the
  province and is not a sighting there (the mussels case, queue #12341). Such a line is a card on Potential.
- **A saving in Costco's own flyer is valid for the whole province.**
- Missed claims: re-notified, not charged. Deeper price: charged the difference.
- The automatic approval switch is off in production.

## What changed against 2026-11-12

| 2026-11-12 (#573, #575) | Now |
| --- | --- |
| A savings drop with any failed check was listed on Potential | Listed on the queue. Held only by the eight failures of rule 4 |
| A price only the rule of N verified was listed on Potential | Listed on the queue |
| A drop whose checks could not run was listed on Potential | Listed on the queue, unscored, never flagged |
| A post cast no vote | A post is one vote of the N (the 2026-11-07 rule) |
| A printed name that differed failed the score | Shown only |
| A deleted, unreviewed receipt voted and could verify a price | Potential only |
| No way to send a drop without a charge from the queue | Approve without charge, for an out-of-stock drop |

## The production queue on 2026-11-16, before and after

Read with the desk's own code against production (no write, no Same-Day request).

| Queue row | Item | Before | After |
| --- | --- | --- | --- |
| #9632 | Pinty's buffalo chicken, QC, wh 528 | 100%, queue | 100%, queue |
| #12351, #12352 | Fanta Variety Pack, ON, wh 540 | 100%, queue, **out of stock** | 100%, queue, with **Approve without charge** |
| #12654 | Dove conditioner, ON, wh 802 | 100%, queue | 100%, queue |
| #12639 | Pork back ribs, QC, wh 556 | 85%, **Potential**: paid $26.57 against regular $30.42, and "$6.00 off $30.42" failed on a stale `deepDiscount` flag | 92%, **queue**: only "paid $26.57, regular $30.42" is left, shown on the card |

#12639 is worth a look before approving: the saving is $6.00 and the drop is $2.15, because the shelf price is
$24.42 and the shopper paid $26.57. Ribs are priced by the pack. The pack rule (`soldByThePack`) did not fire for
this product; that is a separate question and was not changed here.

## Old app builds

- **Shoppers, every build:** no route, request field or response field changed. Who gets a drop changes on the
  server only.
- **Installed admin build:** it filters To review on `tier`, so it follows the new rule at once. New fields are
  additive: `noChargeApprove` on a queue row, `unreviewedDeletedReceipts` on a potential card, `deletedUnreviewed` on
  an evidence row, `holdReasons` and `holds` inside `confidence`. The **Approve without charge** button needs the
  next app build. Until then the installed build shows `SEEN BY n SHOPPERS · NO OFFICIAL SOURCE` on a rule-of-N drop
  and "posts do not count" on a potential card; both are wrong wording, fixed by the next build.
- `approve-free` is a new route. No installed build calls it.

## Cost

- No new job, table or migration.
- `stage` makes one more read per sweep that found drops (which of these lines are claimed).
- `approve-free` makes one confidence read for one row.
- The sweep and potential queries gained two boolean columns and no join.

## Tests

- `backend/tests/priceDropQueueRules.test.js`: the desk rule, the mussels case, approve without charge.
- `backend/tests/savingsQuality.test.js`: the name is advisory, the eight holds, the stale flag.
- `__tests__/adminPriceDropQueueScreen.test.js`, `__tests__/adminPotentialDropsScreen.test.js`: the button on both
  screens, the badge, the evidence wording.
- `backend/tests/priceDropQueueRulesDb.test.js` (dev database, 25): a claimed line is refused at staging; a receipt
  deleted before review makes no drop, shows on Potential, counts again once reviewed or verified by an admin; the
  free approval is refused unless out of stock, bills nothing, records the drop and pushes it.
- `backend/tests/priceDropWindowSourceDb.test.js`: three posts verify a price again; one shopper and two posts too.
- `backend/tests/priceDropSingleSender.test.js`: the free send is the only caller of the delivery beside the drain,
  and always passes `noCharge`.

Run on 2026-11-16, locally: 32 backend files in the blast radius, one at a time against the dev database, 499 of 499.
Mobile suite 13,328 passed, `i18n:check` in sync. The full backend suite and GitHub Actions were not run.

`backend/tests/priceDropPushLanguage.test.js` fails 2 of 2 on `main` without this change (checked on an untouched
copy of `main`): the test buyer's balance goes below zero, so the push is the locked one. Not fixed here.

## Not done

- The push for a drop approved without charge is the ordinary drop push. It does not say the item may be out of
  stock. A new push text needs `en` and `fr` copy.
- #12639 (pork back ribs): priced as a fixed-price item; the pack rule did not fire. Not changed.
- No mutation run was made on the new tests.
