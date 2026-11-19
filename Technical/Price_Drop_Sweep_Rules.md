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

**Claimed is the shopper's own action, and a claimed line is never a missed claim (Maxim, 2026-11-17).** *"it should
never be considered claimed if the user didnt mark the item claimed … if claimed the missed drop in the price drop
queue should never be considered missed and in this screen."*

- Claimed means `receipt_items.claimed_at` is set, and only the shopper's "Mark claimed" sets it. A drop that was
  notified and ended unclaimed is **missed**, never claimed, and is re-notified when its saving comes back.
- A missed claim is defined once: `priceDropQueueRepo.reentryOf` (`"missed_claim"`) and its SQL twin
  `MISSED_CLAIM_ROW`, both requiring an unclaimed line. A re-drop on a line the shopper claimed since is
  `"claimed_redrop"`: badge *CLAIMED BY THE SHOPPER · NO CHARGE*, never on the *Missed claims* filter or its count,
  never charged (`priceDropTier.chargeCreditsFor`).
- A waiting missed claim whose line the shopper then claims is closed (`closeIneligible`, reason *claimed by the
  shopper*). A re-drop is never charged, so closing it bills nothing.
- Production, 2026-11-17: the desk counted two claimed lines as missed claims (queue #716 SKU 1073000, #726 SKU
  1774182, both history rows). Queue #9632 (SKU 379252) is a real missed claim: line 4332 on the shopper's 2026-10-22
  receipt is unclaimed; the "claimed" seen on the account was the same product on their 2026-10-15 receipt (line
  4336, claimed 2026-11-14).
- The Home hero's all-time total became **Savings found** = claimed + still to claim + missed (Maxim, 2026-11-17,
  replacing the claimed-only total of 2026-11-09). It changes no line's status. One function:
  `src/services/productStatus.heroFoundTotals`; the line under it says what is included.

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

- 12 counted checks (14 before: the name left, and "not sold by weight" left with rule 8).
- `plausible_discount` compares the saving with the price when one is known. The harvest's `deepDiscount` flag
  decides only when no price is known.
- 100% still means every counted check passed, and only 100% is flagged for automatic approval.

### 8. Sold by the pack: always the full saving

> *"weighted items or sold by the pack should never have a less saving, if the official saving is 6$ for the pork and
> there is a saving of 6$ the user should get a drop for the full 6$, this is always on by the pack (meat, chicken,
> fish, shrimp, ...etc) or any weighted items, weighted items is the same as by the pack i prefer to consolidate the 2
> concept if they differ today and always have by the pack mention instead"* (Maxim, 2026-11-16)

**One concept: sold by the pack.** "Weighted" is the same thing and is no longer a separate rule. A product is sold by
the pack when any of these holds, and then it is sold by the pack in every province:

- an admin flagged it (`products.is_weighted`, the button now reads **Sold by the pack**);
- one Same-Day harvest run prints 3 or more different regular prices for it in any one province;
- its saving was read with a per-weight size (`savings.flags.weighted`).

For such a product:

- **The drop is the full saving:** new price = what the shopper paid less the saving. Never another pack's shelf
  price.
- It is offered from an official saving only. It has no price-group drop and no Potential card (one pack's price is
  no other pack's new price).
- The card says "sold by the pack (each pack its own price)".

One definition: `priceDropRepo.soldByThePackIn` (SQL), read by the savings sweep, the price-group sweep, the
Potential list and the confidence.

**What was wrong.** Two things. A product flagged as weighted, and a saving read per weight, were never offered a
drop at all. And the harvest test was per province: on 2026-11-16 the pork back ribs (SKU 31111) printed 9 pack
prices in Ontario and 7 in Alberta in one run, but 1 and 2 in Quebec. So a Quebec shopper who paid $26.57 was
queued a $2.15 drop (#12639, priced off a $24.42 pack) for a $6.00 saving.

Regional pricing is not packs: the count stays per province, so one price in each of three provinces is still a
fixed-price item.

**Production on 2026-11-16, read only, with this rule:** the savings sweep finds 10 drops, 6 of them sold by the
pack, all 6 for exactly their saving. The ribs line is $26.57 → $20.57. Five are Kirkland chicken breasts ($6 and $2
savings) that were not offered before. The query took 0.5 s.

**The row already waiting.** #12639 waits at $24.42. The sweep stages the $20.57 drop as a new row; the queue's
hygiene then closes the $24.42 row (a waiting, undecided row is closed when the same line waits at a deeper price).

### 9. The harvest is never a price tag; an ended saving is a missed drop (2026-11-19)

Maxim, 2026-11-19: *"Harvesting should never be a price tag labeled because this will give false numbers for the
price tag dashboard … official source should have the type 1, social are not official and yepsavings same, they should
have another own type."* *"sweep job is for price drop detection only."* *"expired savings should never be considered
as an actual price drop … it should be considered as a missed price drop even for new scans … it should never mention
which item same path as locked, because if it dropped again in the window we will notify the user and charge him."*

**Source types (migration 0053, `backend/lib/priceSourceCodes.js`).** Until 0053 the savings harvest and the
social-post imports wrote every price as `price_tag_scan` under the import's synthetic device. Prod on 2026-11-19:
12,114 Same-Day rows and 6,484 social/yepsavings rows (plus 249 written as `scrape`), against **45** shoppers' tag
photos.

| Type | What it is | Tier |
| --- | --- | --- |
| `price_tag_scan` | a shopper's photo of a shelf tag. Nothing else. | flag, or verified tag |
| `savings_harvest` | Costco's own publication read by the harvest (Same-Day in-store, warehouse and Business Centre) | 1, official |
| `social_post` | a price off a website or social post (yepsavings, the admin's social-post import) | 2, one vote of N |

The drop rules still judge a row by `flags.sourceKind` (`HARVESTED_ROW`, `thirdPartyRow`, `POINT_RULES`), so no tier,
vote or confidence changed. What the type fixes: the tag dashboard (`adminConsoleRepo`, `pst.code = 'price_tag_scan'`),
the tag-credit settlement (it enumerated thousands of harvest pools with no shopper to pay), Admin · Saving dates
("Price tag photo" on a Same-Day row) and the crowd pool (`crowdRepo`: shoppers' receipts and tags only now).

**The sweep finds price drops only.** The price-tag credit settlement and the receipt status upkeep were legs of the
price sweep; they are their own crons since 2026-11-19 (`tagCreditSettlement` 08:10 UTC, `receiptStatusUpkeep`
08:20 UTC, each in `job_runs`). The admin console's "Price refresh" result no longer mentions tag credits.

**An ended saving keeps its end.** `_vouchedEnd` trusted a tag's printed end only when it was on or after the row's
`observed_at`. The harvest re-reads a Same-Day listing after its last day and moves `observed_at` past it, so the end
was dropped and an ENDED saving read as running with no end. Same-Day's printed `valid_until` is now trusted whenever it
was read (and its start is `valid_from`, the first read). Cases: Swany glove 2025447 and BFree wraps 1751411 (both ended
11-15), on Admin · Potential price drops on 11-19; queue #12925 was sent and charged 60 credits.

**Missed drops (migration 0054, `backend/repos/missedDropsRepo.js`).** An official saving (savings table, trusted
source) that reached the purchase but had ended on the buyer's day when it was found:
`savingDropRepo.findSavingDrops({ ended: true })`, the same definition as a real drop with the running test reversed,
within 60 days of the end, on an unclaimed line never told any drop. It is:

- recorded once per line, never charged, never queued;
- told to the shopper as a count and a total only (push `missed_price_drops`, switch `notifUrgentClaims`; Home card
  and the Tracking list's All / Expired filters), never the item, the receipt or the price, the same path as a locked
  drop;
- no obstacle to a later real drop on the line: a new saving inside the window is told and charged as usual.

The sweep runs it (it is drop detection). `GET /api/me/drops` and the bootstrap carry `missed: { count, savings,
lastEnded }` (additive).

**Same-Day at a warehouse it does not list** stays on Potential for now (Maxim: *"an unlisted goes to potential for
now, because we already working on a harvesting all warehouses daily so this should disapear soon"*). At a listed
warehouse the savings path sends it to the queue (PS5 9575788, #12902, sent 11-19).

**Withdrawing a drop sent after its saving ended:** `scripts/withdraw-sent-drop.js` (`missedDropsRepo.withdrawSentDrop`)
refunds the charge (`refund:<charge ref>`), removes the line's `price_drop_notifications` row (the phone takes the drop
off the line, `src/services/releasedDrops.js`), marks the sent queue row superseded and records a missed drop
(`reason 'withdrawn'`). #12925: ended date recorded as 2026-11-19, as Maxim asked.

**Deploy order.** 0053 + 0054 on prod first (additive); deploy; then `scripts/datafix-harvest-source-types.js --write`
(moves the legacy rows; a row whose twin the new code already wrote is kept as excluded history,
`:pre0053:<id>`); then `scripts/withdraw-sent-drop.js --item 10227 --ended 2026-11-19 --write`.

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

#12639 was a $2.15 drop for a $6.00 saving: ribs are sold by the pack and the pack rule had not fired. Fixed the
same day, see rule 8.

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
- No mutation run was made on the new tests.
