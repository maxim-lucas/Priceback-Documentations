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

One definition: `priceDropTier.canApproveWithoutCharge` shows the button and guards the route. The desk also requires
the card's own OUT OF STOCK flag (`confidence.stock.status`) before it shows the button (Maxim, 2026-11-21: *"out of
stock button should only be available if the product is flagged out of stock"*; `canApproveFree` in
`AdminPriceDropQueueScreen.js`). On 2026-11-21 no waiting drop in production had it.

### 6b. Any drop can be sent as a bonus, without a charge (Maxim, 2026-11-20)

> *"i want to have the option to send the price drop for users without any charges (sometimes some cases arent definied
> and i am not sure if costco will refund so i want to notify the users as a bonus but the remark that it can be refused
> based on the desk agent, mainly for fruits or due to price fluctuation not real savings) should be available in
> potential also same behavior as clearance but it can be in any warehouse"*

- **Price-drop queue, and the held drops on Potential price drops:** **Send as a bonus · no charge · may be refused** on
  every drop an admin can still decide (waiting, approved but not sent, rejected) whose line is live, whatever its stock
  or score. Route `POST /api/admin/price-drop-queue/:id/send-bonus`; the same delivery as *Approve without charge*
  (`sendWithoutCharge(…, { bonus: true })`): the re-check, the ledger row with a charge of 0, sent at once.
- **Potential price drops, every card:** **Bonus · send without charge · any warehouse**. Route
  `POST /api/admin/potential-drops/bonus`: every line on the card, at any warehouse (a clearance reaches only the
  warehouses it was seen at), gets an uncharged drop (`priceDropNotifier.sendBonusDrops`, the clearance's delivery).
  The price is **not** stamped or verified: a bonus vouches for nothing, and it never counts as a trusted price. The
  sent lines leave the card ("already told at this price"). Waits while delivery is paused (409), like a clearance.
- **What the shopper is told** (push, EN + FR, `verifiedDrop.bonusTitle` / `bonusBody`): *"Possible price drop (not
  guaranteed)"* — you could save $X · N days left; we are sending it as a bonus; it is not confirmed at your warehouse
  (it may be out of stock, not sold there, or at a different price), so the Costco desk agent may refuse it; no credit
  or fee is charged. Generic for every category (Maxim, 2026-11-21: *"the notification should not be related to fresh
  products but for potential depending on the agent desk (some cases are for out of stock, not sure if it is available
  in this warehouse, possible different price, ..etc) so it should be generic message"*); the desk's confirmation
  says the same. Never a locked alert (nothing was
  charged, so the app shows it unlocked), never "verified by PriceBack". The push carries `data.bonus: true` (additive;
  no build reads it yet). The shopper's notification history keeps it.
- **Charging:** never charged, then or later. A later, deeper verified drop on the line bills only what lies beyond the
  bonus price (the telescoping charge of the one ledger writer). A subscriber is never charged anyway.

One definition: `priceDropTier.canSendAsBonus` shows the queue button (`bonusSend` on each item) and guards the route.

**Not done (needs a migration and an app build, not asked):** an in-app "bonus · may be refused" badge on the drop. The
remark is in the push and the notification history only.

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

### 8b. Every savings drop is at least the full saving (2026-11-23)

> *"in the price drop queue, there is again a prorato of the saving on an item, the saving is 5$ so the drop should be
> 5$ (a complete 5$) never less"* … *"i want you to fix the root cause, not only the item"* (Maxim, 2026-11-23)

> *"it should be the total savings for the user paid amount not the difference always. the saving is the rule"* …
> *"the paid price can change per warehouse"* (Maxim, 2026-11-23, the final wording, PR #682)

Rule 8 made the full saving the drop for a product sold by the pack. It now holds for **every** savings drop, and the
drop **is** the saving, exactly: **new price = what this shopper paid per unit − the official saving.** Never a
difference with a shelf price, in either direction: not less than the saving (the #13313 case below), and not more
either (a shopper who paid above the regular price still gets the saving, not the gap to the shelf).

The shelf price keeps one job: deciding **whether** there is a drop. A line already paid at the sale price has none.

"Paid the regular price" (`paid_regular` in the confidence) is now a **note**, never a penalty and never a hold: paid
prices vary by warehouse, so a paid price a few cents off the regular one says nothing against the drop.

> **History.** The first fix the same day made the new price the *lower* of the shelf sale price and paid − saving
> (`LEAST(shelf, paid − saving)`). Maxim's answer replaced it: the saving is the rule, always.

**The case.** #13313, DRONE MINI 2707238, Boisbriand, 2 units. The paper prints $24.93 a unit (its subtotal closes to
the cent). The Same-Day sale price is $19.99 (regular $24.99, $5 off). The sweep priced the drop off the shelf price:
$24.93 − $19.99 = $4.94 a unit. With this rule it is $24.93 − $5 = $19.93, a full $5.

**The root cause.** `savingDropRepo.findSavingDrops` took the shelf price whenever the harvest had one
(`COALESCE(shelf, paid − saving)`), so any shopper who paid a few cents under the regular price got a prorated drop.

One definition: `savingRules.savingNewPrice` (JS, read by the confidence's `new_price_matches`) and its SQL twin, the
`newPrice` of `savingDropRepo.findSavingDrops` (`unitPaid − s.amount`). The confidence check says "New price is the
paid price less the saving" and, when the shelf shows another price, "the saving is the rule".

**The row already waiting.** #13313 waits at $19.99. The next sweep stages the $19.93 row, and the hygiene closes the
$19.99 one (rule 8's mechanism).

### 8c. A drop on several units is approved a number of units at a time (2026-11-23)

> *"Price drops are grouped by quantity, when i want to approve i want to have the possibility to approve by n quantity
> not always the total (for the waiting list in the app, approve one by one until we deliver the next build)"* …
> *"approve both of them 1 at a time, so the first one is unlocked if the user doesnt have enough balance and the 2nd
> one is locked"* (Maxim, 2026-11-23)

- **Approve without a count approves one unit** (every desk build before the quantity picker): the line is split, see below. Approve the next line for the next one.
  The next build sends `{ units: n }` from a stepper on the card; the bulk route takes the same `units`.
- Each approval **charges only its units**, on the same telescoping charge as a deeper price: the 2nd of 2 units at
  one price bills `dropChargeCredits(saving × 2) − dropChargeCredits(saving × 1)`.
- The **push says the saving of those units**. When the charge takes a free balance below zero, that push is the
  locked alert, as for any drop.
- A row with units left goes **back to pending** (`units_told` raised, approval cleared), not to sent. The ledger row
  (`price_drop_notifications`) records the units told at that price (`units`, NULL = all, every row before 0060). A
  line told part of its units is still owed the rest: `findNotifiable`'s "already told" counts a row only when it
  told every unit, so the sweep and the queue hygiene keep the waiting row.
- **The receipt line is split (Maxim, 2026-11-23):** *"no dont lock the whole line, in this case split the quantity in
  2 separate lines in the receipt, the first one is unlocked and the 2nd one is locked, this is the whole concept to
  have the user get one of them first"*. An approval of n units of an N-unit line that told nothing yet splits it
  (`priceDropQueueRepo.splitForUnits`, amounts `shared/dropUnits.splitLine`, to the cent): the approved line keeps
  n units and is told, charged and pushed **whole**; a new line right after it (same position, later id — every
  reader orders by position, id) carries the rest with **its own waiting drop** (same price, saving, evidence). An
  installed app shows and locks per line, so the paid unit stays shown and an unpaid one is locked on its own line.
  The phone takes the server's lines on its next sync. The `units_*` columns stay for a line told part of its units
  before the split existed.
- **What happened first (prod, 2026-11-23):** the first version told units on one line. The 2-unit claims #14163
  (DRONE MINI) and #13661 (BUFFALO FZIP) showed whole and unlocked. Both lines were split by hand: unit 1 keeps the
  charge paid from the balance (shown), unit 2 got its own line, notification and the charge into the negative (locked).
- The desk's `savings` and `chargeCredits` are what the **next** approval tells and bills (one unit on the installed
  desk). `lineSavings`, `unitsTold` and `unitsNext` are new fields.

One definition: `shared/dropUnits.js` (mirrored to `backend/shared`, re-exported by `backend/lib/dropUnits.js`), read
by the queue (`priceDropQueueRepo.review` / `reviewMany` / `autoApprove` / `returnWithUnitsLeft`), the drain
(`priceDropNotifier._deliver`), the ledger (`priceDropRepo.recordNotified`, `findNotifiable`), the desk
(`priceDropTier.chargeCreditsFor`, `server._priceDropQueueItem`) and the phone's stepper
(`AdminPriceDropQueueScreen.unitsLeft`). Migration 0060 (`units_approved`, `units_told`, `units`), applied to prod by
hand before the deploy.

### 8d. The automatic approval does what Maxim does by hand (2026-11-23)

> *"I check the user (if under the 75 free credit for trial and has 5$ to 7$ as first drop, i adjust his credit to
> match the lowest price drop in the queue for this user so he can at least see a first price drop for 3$+ and i
> approve the drop …) it should always try to cover the maximum amount of drops more than 3$ at least before giving
> extra free credit … i always give extra 1 credit so he can do another scan in the future always except if he has more
> drops locked."* Answers the same day: no extra credit when the balance already covers it; **45 free credits per
> lifetime at most**; **no free credit for a shopper who already had a drop**; one unit at a time; **under the existing
> switch** (`SAVING_DROP_AUTO_APPROVE`).

It runs on the drops the confidence lets the automation approve (100%, `autoApprovable`), shopper by shopper, each unit
of a line a drop of its own (8c):

0. A subscriber, or a balance already below zero: every drop now.
1. The $3+ drops whose credits fit the balance, the set covering the **most dollars** (exact, bounded knapsack); then
   the smaller drops that still fit. No credit given.
2. None fits, and the shopper is on the **free trial** (never bought credits, never told a drop): the balance is
   topped up to the **cheapest $3+ drop**, plus **1 credit** when no other drop of theirs is left to lock. Within
   **45 free credits per lifetime** (re-checked under the user's row lock). That drop is approved.
3. Otherwise the drops that fit (any size, the most dollars), or, when none fits, every drop now (locked whatever the
   order).

Everything else waits for the **next run**: a shopper with a drop approved or on its way is left alone, so only the
later drops are locked. Maxim's examples are the tests (`tests/dropApprovalPlan.test.js`): 72 cr and a $6 first drop →
+19, approved; 72 cr and two $2 → both, no credit; 72 cr and $3/$4/$5 → the $4, then the rest; $5 and $2 → +3 for the
$5 (no +1, the $2 will be locked), then the $2.

The top-up is an `admin_adjust` row with the `admin:goodwill` note (every installed build shows "A thank-you from our
team") and the ref `first-drop-topup` (`creditsRepo.grantFirstDropTopUp` / `firstDropTopUps`).

One definition: `services/savings/dropApprovalPlan.planForShopper` (pure), applied by
`dropVerifier.approveByShopper`. Reads: `priceDropQueueRepo.detailsFor`, `approvalStates`.

**Off today.** `SAVING_DROP_AUTO_APPROVE` is false on prod; with it off nothing is approved (the drops are only
flagged, as before). The switch is Maxim's.

### 8e. Fresh fruits and vegetables: a lower price alone is never a drop (2026-11-23)

Maxim, 2026-11-23: fresh fruits and vegetables are excluded from the Price-drop queue **and** from Potential price
drops when the only evidence is a lower price. **An official saving on them still counts.**

**Why.** Costco's support told Maxim it does not adjust the price of fresh produce when the price moves. A fresh price
follows the harvest and the season, and the desk agent refuses it. A saving (an instant saving, a flyer coupon) is a
promise Costco keeps, so it stays a drop.

**The case.** Clementines (SKU 21366, Same-Day "Clementine Oranges", 412), queue #12962 to #12967: six lines queued
at $6.99 from one price point (325971) because the price went down after the purchase. No saving stood behind it
(`saving_id` empty on all six). Five were sent, one rejected. None was a drop Costco would honour.

**What is fresh produce.** One of these holds:

- an admin said so: the **Fresh produce** button on a Potential card (`products.fresh_produce = true`, migration 0061;
  Undo clears it);
- no admin said otherwise (`fresh_produce IS NULL`) and Same-Day files the product under a fresh fruit or vegetable
  category. The list is Same-Day's own category ids (`product_categories.source_category_id`), read from prod on
  2026-11-23: apples, pears, grapes, berries, citrus, melons, mangoes, kiwis, stone fruit, bananas, avocados,
  pineapples, pomegranates, persimmons; potatoes, onions, garlic, ginger, lettuces and greens, fresh herbs, mushrooms,
  peppers, tomatoes, cucumbers, carrots, celery, squash, cabbages, broccoli, cauliflower, asparagus, corn and the rest
  of the fresh vegetable aisle.

`fresh_produce = false` is an admin's "not fresh produce" and overrides the category. Left out of the list on
purpose: frozen, canned and dried fruit and vegetables, juices, prepared salads and vegetables, salad kits, party
trays, gift baskets, dips, and San Marzano tomatoes (sold canned). A category id rather than a name, because a name
matches "Apple Juice", "Canned Peaches" or "Potato Chips". A product the list misses is one tap on the desk; a new
Same-Day category joins the list in the code.

**Where it applies.** Every price-group path: the verified sweep (`priceDropRepo.findNotifiable`), Potential
(`potentialDropRepo.listPotential`), and the queue's structural check (`priceDropQueueRepo.closeIneligible` closes a
waiting price-group row as "fresh produce: a lower price without a saving is no drop"). The savings path
(`savingDropRepo`) never reads it. A queue row a saving stands behind (`saving_id` set) stays.

One definition: `backend/lib/freshProduce.js` (`freshProduceSql`, JS twin `isFreshProduce`, the list
`FRESH_PRODUCE_CATEGORIES`). Admin route `POST /api/admin/products/:id/fresh-produce` with `{ fresh: true | false |
null }`. Admin · Price lookup and Price history show "fresh produce" beside "sold by the pack".
`backend/tests/freshProduce.test.js` pins the definition and its callers (and that the savings path is not one);
`backend/tests/potentialDropDb.test.js` pins the behaviour against the dev database.

**Production.** Migration 0061 (one nullable column) must be applied to prod by hand **before** this code deploys: the
sweep reads the column. Read on 2026-11-23: no waiting (pending or approved) price-group row on prod is fresh
produce by its category, so the deploy closes nothing; it stops new ones.

### 8f. A deeper saving (Maxim, 2026-11-28)

> *"for deeper savings that hasnt been claimed before it come back as a full drop updated from the previous one but mention also that
> it is a deeper drop, always only the difference is charged if the first one was charged before"*; *"paid with $3 off, $5 off now → a
> $2 drop"* (yes).

- **Replace, never stack:** on a day, the largest running official saving counts (`ORDER BY` the largest drop; the price history's
  `officialLine`). The data is never ended or deleted to make an overlap go away (Maxim, 2026-11-27).
- **A. A line bought already discounted** (its receipt prints the instant discount: `original_price > line_total`): offered only for a
  strictly deeper official saving, for the **difference**: new price = paid − (saving − discount received per unit)
  (`savingRules.savingNewPrice({ received })`, SQL twin `savingDropRepo.findSavingDrops`). The receipt's own discount is proof it was sold
  at the sale price, so `savingRunningAtPurchase` (a full-price line during a printed saving is a misread) does not apply to it. Such a
  line is created unwatched by the receipt's rule ("full-price lines only"), never by the shopper: it counts as watched for a strictly
  deeper saving, and staging the drop sets `watch_enabled` (`priceDropQueueRepo.stage`) so the drain, the desk and the reminders see it;
  the desk's "barred" check lets a savings row deeper than the receipt's discount through. Known edge: a shopper who switched such a
  line on and then off again is treated as never having chosen. **Behind `SAVING_DEEPER_ON_DISCOUNTED_LINES` (off).**
- **B. A line told, not claimed:** a deeper saving makes it a drop again (told at a higher price), the **full** new drop is said, with
  "It is a deeper saving than before" (`verifiedDrop.deeperNote`, EN + FR); the commission bills the extra only (the telescoping total
  of *commission charged once*). On by default: this already happened, only the words are new.
- **C. A claimed line** (rule 5 exception approved 2026-11-28): **not built yet**. It also needs the phone's claim flow (a second claim of
  the same line) and the drain's "claimed while queued: no push" rule changed. `Roadmap/Deeper_Discount_On_Discounted_Items.md`.

### 9. The harvest is never a price tag; an ended saving is a missed drop (2026-11-19)

Maxim, 2026-11-19: *"Harvesting should never be a price tag labeled because this will give false numbers for the
price tag dashboard … official source should have the type 1, social are not official and yepsavings same, they should
have another own type."* *"sweep job is for price drop detection only."* *"expired savings should never be considered
as an actual price drop … it should be considered as a missed price drop even for new scans … it should never mention
which item same path as locked, because if it dropped again in the window we will notify the user and charge him."*

**Source types (migration 0055, `backend/lib/priceSourceCodes.js`).** Until 0053 the savings harvest and the
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

**Missed drops (migration 0056, `backend/repos/missedDropsRepo.js`).** An official saving (savings table, trusted
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

**Deploy order.** 0055 + 0056 on prod first (additive); deploy; then `scripts/datafix-harvest-source-types.js --write`
(moves the legacy rows; a row whose twin the new code already wrote is kept as excluded history,
`:pre0055:<id>`); then `scripts/withdraw-sent-drop.js --item 10227 --ended 2026-11-19 --write`.

### 10. A line is priced in the province it was bought in (2026-11-20)

Maxim, 2026-11-20, asked which fix to take for a cross-province purchase: *"Both, one rule"*. A receipt line is
matched with the prices of **the purchase's province: the receipt warehouse's, else the shopper's own** when the
receipt names no warehouse. One definition, `priceDropRepo.purchaseProvinceSql({ warehouseId, userProvince })`, used
by every price-matching path:

| Path | Where |
| --- | --- |
| The verified sweep (which buyers a verified price reaches; a region-scoped sweep means the purchases made there) | `priceDropRepo.findNotifiable` |
| Admin · Potential price drops (the card's province) | `potentialDropRepo.listPotential` |
| The savings path | `savingDropRepo.findSavingDrops` (it already read the purchase's province; now through the one definition) |
| The saving-end lookups for a told or queued line | `priceDropRepo.pendingClaimRows` / `unreachableDropRows`, `priceDropQueueRepo`, `savingDatesRepo`, `dropReminderEmailRepo` |

**The clock is not this.** A line's day is still the owner's province day (`shared/trackingTime`, the tracking-time
rule), so `provinceCode` on a drop, its push and its claim window stay the **owner's** province. Potential groups a
line under the purchase's province and checks its claim window on the owner's day (`ownerProvinceCode`).

**Why.** Prod 2026-11-19: a Quebec shopper's PS5, bought at Ontario warehouse 1362, sat on Potential under Quebec.
Verifying an Ontario price could not have reached them: the verified sweep matched lines by the shopper's home
province, so the line was compared with Quebec prices. The phone's own price check already used the receipt's
warehouse (`/api/prices/check`, `scope: "warehouse"`), and the savings path the purchase's province. Only the
crowd-price paths disagreed.

**Tests.** `potentialDropDb.test.js`, *the purchase's province*: a Manitoba buyer's line bought at Saskatoon (#152) is
listed under SK, a Manitoba price is no drop for it, and verifying the SK price reaches the buyer with `provinceCode`
MB. Both tests fail on the code before the change.

### 12. Potential never questions an official source; what qualifies for Potential (Maxim, 2026-11-24)

*"if we have a product with an official status (price, saving, stock, ...etc) from sameday or official costco website,
we should never get these type of potential drops. this override any possible drop to any potential drop. the idea of
potential is that we have a problem with a harvest, we have not seen or updated a product in a while and we suspect
that we have a price drop … potential price drop never ever requestion the source of truth of an official source."*

**Why Potential exists.** It predates the savings harvest. It is the safety net for what the harvest does not cover:
a product no official source has read lately, or a harvest that failed. It is never a second opinion on an official
reading.

**12.1 The official source decides.** An official source is Same-Day (warehouse and Business Centre), costco.ca and
costcobusinesscentre.ca. "Official status" is any reading from one: a regular price, a saving, a price, a stock
reading. When one covers a line, that reading is the answer for the line:
- it shows a drop for this shopper → the drop goes to the **Price-drop queue** by the trusted path (rule 1, savings
  path rule 8b: paid − saving);
- it shows no drop for this shopper → **no drop anywhere**, not on the queue and not on Potential.

**12.2 Coverage.** An official reading covers a line when it is for the line's product, at the line's warehouse (a
province-wide reading covers every warehouse of the province unless it names its warehouses: then only those, as in
2026-11-12), read **after the purchase** and inside the claim window. A reading that names other warehouses of the
province does **not** cover the line, but if another official reading covers the line's own warehouse, that one
decides (12.1). Mussels case below.

**12.3 What qualifies for Potential: all four.**
1. **No official coverage** for the line (12.2): the product is unharvested at that warehouse, or the official reading
   is older than the staleness bound (**open: 7 days proposed**, one harvest week), or that harvest's last run for the
   province failed or read 0 items (the drift alarm, cost rule 4).
2. **Untrusted evidence below N** (rule 2): a shopper's receipt, an unverified tag, a website or social post; or a
   receipt deleted before review (rule 3).
3. The line passes every line rule the sweep applies (window, materiality, sold by the pack, fresh produce, Executive,
   province of purchase, already told at that price or lower).
4. **The evidence is not an official row.** An official row (Same-Day, costco.ca) is never Potential evidence and never
   carries "UNVERIFIED" on the desk. It decides (12.1) or it does not cover (12.2).

**12.3b Stock is official status too (Maxim, 2026-11-24).** *"i think none is a real potential price drop it is just
speculations or maybe an out of stock item, but since we also added the stock flag we should mainly be based on that
too."* An official stock reading for the line's product at its warehouse (Same-Day's availability, the harvest's
`flags.stock` / `liveChecks`, `warehouse_stock_reads`, judged by the one stock rule `stockStatusOf`) covers the line
like a price does:
- **out of stock** at the warehouse → no Potential drop (a lower price seen elsewhere is not one this shopper can
  claim; an official drop that is out of stock keeps "Approve without charge", rule 6);
- **in stock** with an official price → that price decides (12.1).
A stock reading counts while it is fresh, under the same staleness bound as 12.3.1.

Maxim's review of the whole Potential list on 2026-11-24: none was a real potential drop. Each was a speculation
beside an official reading, or an out-of-stock item. That is the case for building 12.5.

**12.4 Never on Potential.** A line whose product has official coverage (a price, a saving or a stock reading). A line an official saving already told (the
shopper got the saving; another warehouse's regular minus the same saving is not a further drop). A group whose only
evidence is official rows.

**12.5 One definition** (to build, on Maxim's go-ahead): `priceDropRepo.officialCoverageSql({ product, warehouse,
province, purchase, windowDays })`, read by `listPotential` (exclude covered lines, exclude official rows from the
evidence) and by the sweep (a covered line takes the official answer). Parity test: no line is both covered and
listed on Potential.

**12.6 Built (Priceback #696, 2026-11-24).** `priceDropRepo.officialCoverageSql` (Same-Day warehouse and Business
Centre rows, the catalogue regular prices, official savings, the stock reads), `POTENTIAL_OFFICIAL_FRESH_HOURS` = 48.
Daily harvests, but 98% of regular prices are read within 48 h and only 50% within 24 h (each product's daily run lands
at a different hour), so 24 h would push half the products in and out of Potential every day.

**12.7 Next (Maxim, 2026-11-24), not built.** *"if there is any potential price drop, i check it manually in sameday
website and if i dont find it i dont approve … only the clearance can differ … i want the app to be sure or check this
online … automate the real warehouse clearance based on rule of N … in the same warehouse. The target is if ever costco
or sameday are blocked … we can still rely on the users receipts as source of truth but this will be more accurate when
we have more volume."*
1. **The app checks Same-Day for each Potential card**, the check Maxim does by hand: one live read of the product at
   the line's warehouse (the stock read's own call, `warehouse_stock_reads`). An official answer settles it (12.1). Only
   a card Same-Day cannot answer stays for the admin. Cost: one read per Potential line per day, bounded by the list.
2. **A same-warehouse clearance by rule of N:** a .97 seen on N different shoppers' receipts **at the same warehouse**
   is a clearance for that warehouse's lines, sent without a charge, automatically. It ships OFF and is measured first
   (ground rule 6); the switch is Maxim's.
3. **Receipts as the source of truth when a harvest is blocked:** already the case. Past 48 h with no official reading,
   receipts are the evidence. With more shoppers, N can rise.

**The case that set the rule: Farmed Blue Mussels #18747 (prod, 2026-11-24).** Line 4752 (QC, Sherbrooke #1367) and
line 7876 (ON) were told on 2026-11-23 at $11.99 = $15.99 paid − Costco's $4 saving (queue 11302, 12341, sent). The
same harvest read $11.49 in QC (regular $15.49, "manufacturer_promo", the same $4) at five other QC warehouses, not at
#1367. Same-Day had #1367 at $11.99. Potential grouped (Mussels, QC, $11.49), found $11.49 < $11.99 ("a lower price
than told") and listed line 4752 again. The card labelled the official harvest rows "UNVERIFIED PRICE". Under 12.1–12.4
it is never listed: #1367 is covered by an official reading ($11.99, already told), and the $11.49 rows are official
and name other warehouses.

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
