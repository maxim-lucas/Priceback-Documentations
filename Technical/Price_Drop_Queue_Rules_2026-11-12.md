# Price-drop queue rules (2026-11-12)

**Status:** built on `hotfix/price-drop-queue-rules`. The server part is live with the backend deploy. The two
admin screens change with the next app build; until then the installed admin build keeps working and shows the
new confidence and source data in its existing fields (see "Old app builds").

## What Maxim asked

> *"a price drop that is waiting to claim or claimed should never be in the queue again, only missed claims can be
> renotified and should create a new filter in the screen to preview them and also a badge on the drop"*
>
> *"price drop should be verified if it is in the flyer in the province (confidence should be high in this case,
> and the source should be as a badge, no need to have the confidence lower if the sameday or costco.ca cant be
> run) … if not and we arent confident go for potential price drop queue instead"*
>
> *"the verification should always be based on the savings table as first source for the trusted sources (not
> social, social go for potential price drops)"*
>
> *"THE TARGET IS TO SET THE PRICE DROP QUEUE WITH ALL THE DROPS WITH HIGH CONFIDENCE … flag auto approve for now
> but i will change the settings in the screen later … with a summary in top of the screen of the latest auto
> approve daily count"*
>
> *"the mussels in the price drop queue are in savings but sameday mention no savings so where did it come from and
> what happened? i cant trust the workflow today"*

## The three examples, read on production (2026-11-12, SELECT only)

| Queue row | Line | What the data says | Under the new rules |
| --- | --- | --- | --- |
| #12341 Farmed Blue Mussels, ON, $11.99 | 7876, bought 2026-10-30 at warehouse **1362**, paid $15.99 | Same-Day lists the $4 saving (Nov 9–15) at 38 Ontario warehouses. **1362 is not one of them.** The sweep used the Same-Day price row as a price verified for all of Ontario and never looked at the warehouse list | No drop. The line moves to **Potential price drops**, marked "listed on Same-Day at other warehouses". An admin can verify it there |
| #12351, #12352 Fanta Variety Pack, ON, $10.39 | 5488 and 5535, bought at warehouse **540** | The $3.50 saving (Nov 12–22) is on Same-Day at 23 Ontario warehouses, 540 included. It is **not in the coupon book and not province-wide**. The desk said "Verified by PriceBack (admin or flyer)" because a Same-Day price row was treated like an admin's verification | Found from the saving, at warehouse 540. Badge **SAME-DAY · WAREHOUSE 540**, with a confidence score |
| #726 Downy 2 in 1, QC, $14.99 | 2764, bought 2026-10-14 at warehouse 528 | Told $14.99 on Oct 27. That saving ended Nov 8, unclaimed. The same saving came back Nov 12–15 | A **missed claim**: stays in the queue, with a badge and a filter. Re-notified, not charged again |

**Where the mussels came from.** The savings harvest writes two things for a Same-Day saving: a row in `savings`
with its warehouses, and a price row in `price_points` (`sourceKind = 'sameday_instore'`) stamped `verified = true`.
The sweep had two paths. The price-group path ran first and read that price row as "verified for the province".
The savings path, which checks the receipt's warehouse, only answered for lines the first path left. So the
warehouse check never ran for these drops.

How often: of 60 open lines under a running Same-Day price on 2026-11-12, 56 were bought at a listed warehouse
and **4 were not**. Three of those four had already been sent.

## The rules now

### 1. The savings table is the first source

- `priceDropRepo.findNotifiable` asks the savings path first (`savingDropRepo.findSavingDrops`). A price group
  answers only for lines no saving covers.
- A Same-Day in-store price row verifies **nothing** by itself in the sweep or on the Potential list
  (`DROP_ROW_VERIFIED`). It counts only after an admin pressed **Verify price** on its Potential card.
- The in-app price check (`getLatestVerifiedPrice`) is unchanged. It shows a price and charges nobody.
- A waiting, unreviewed queue row takes the evidence the sweep now finds (`stage` →
  `_refreshPendingEvidence`). Its place in line is kept. A row an admin reviewed is never touched.

### 2. A saving in Costco's own flyer is valid for the whole province

"Flyer" is a saving read on a costco.ca page: the coupon book or the Business Centre savings page (savings source
type `costco_web`), as the saving's own source or one merged into it (`flags.sources`).

- The savings path gives it to every shopper in the province, whatever warehouses Same-Day lists it at
  (`savingDropRepo.inFlyerSql`).
- Its confidence (`dropConfidence`, `saving.inFlyer`):
  - *Listed at the shopper's warehouse* passes.
  - *Re-checked live on Same-Day* is a note, not a failure, when Same-Day **could not be read** (not checked,
    site down, stale read, warehouse or item not on Same-Day).
  - A Same-Day read that **found the item and disagrees** (no saving now, another amount, ended) still fails.
  - *Paid the regular price* is a note when no regular price is on file.
  - Without a shelf price, the new price must equal the paid price less the flyer's saving.

On 2026-11-12: 1,251 running savings have the coupon book among their sources; 97 are linked to no warehouse.

### 3. Social never verifies a price

Only shoppers vote toward the rule of N (`CASTS_VOTE`). A website or social post, and a Same-Day row, cast no
vote. A price only posts vouch for waits on **Potential price drops** until an admin verifies it.

This **replaces the 2026-11-07 rule** ("three posts verify a price"). The sticky stamp (`markNewlyVerified`)
follows the same count. In the last 21 days, 10 sent drops stood on a post's price.

### 4. A told line never comes back, except a missed claim

The sweep already found a told line only in two cases; this is now pinned by tests and named on the desk
(`priceDropQueueRepo.reentryOf`):

| `reentry` | When | Notified | Charged |
| --- | --- | --- | --- |
| `missed_claim` | told this price or lower, that saving ended unclaimed, a later run is on | yes, once per run | **0** |
| `deeper_price` | the price fell below what the shopper was told | yes | the extra difference only |
| `null` | told nothing before | yes | the whole drop |

A line waiting to be claimed (told, saving still running) and a claimed line are never found again.

Production history confirms it: every queue row staged after a notification for its line was a missed claim (2)
or a deeper price (3).

The desk's "costs the shopper N credits" now shows what the drain will charge (`priceDropTier.chargeCreditsFor`).
It used to show the full charge on a missed claim.

### 5. The queue lists high-confidence drops only

`lib/priceDropTier.dropTier` puts every waiting drop on one desk:

| `tier` | `basis` (the source badge) | Rule |
| --- | --- | --- |
| `high` | `flyer`, `sameday`, `saving` | a savings drop whose every check passed |
| `high` | `weekly_flyer` | a price from the weekly flyer import, in the province |
| `high` | `retailer` | the retailer's own price feed |
| `high` | `admin` | a price an admin verified himself |
| `potential` | any of the first three | a savings drop with a failed check; its reasons are the failed checks |
| `potential` | `shoppers` | a price only the rule of N verified |

- **Price-drop queue → To review** lists `high` only.
- **Potential price drops** gains a section on top, *Low-confidence drops*, with each drop's reasons and
  **Reject / Approve anyway**. These use the queue's own approve and reject routes.
- Nothing moved in the database: a low-confidence drop is still a `pending` queue row. The split is a field on the
  list answer, so no migration was needed and the installed admin build still sees every row.

### 6. Automatic approval: flagged now, switched on later

- `autoApprovable` is true for a savings drop at 100%. The desk shows **FLAGGED · AUTO-APPROVE**.
- The switch is the existing one (`SAVING_DROP_AUTO_APPROVE`, off in production). Nothing is approved while it is
  off.
- With the switch off the sweep still keeps the live Same-Day reads fresh, because the flag needs them. Before,
  no live read was made unless the switch was on, so no drop could reach 100% on the desk without a manual
  "Auto-check Sameday".
- The top of the desk shows the summary (`autoApproval`): on or off, drops flagged now, approved automatically
  today, yesterday and over 7 days (`priceDropQueueRepo.autoApprovedDaily`, Eastern days).

## The admin screens (next app build)

**Price-drop queue**
- Top card: *Automatic approval is OFF/ON*, the daily counts, and how many waiting drops are flagged.
- Each card: a source badge (`COSTCO FLYER · WHOLE PROVINCE`, `SAME-DAY · WAREHOUSE 540`, `PRICE VERIFIED BY AN
  ADMIN`, …), a re-entry badge (`MISSED CLAIM · RE-NOTIFY · NO CHARGE`, `DEEPER PRICE · CHARGES THE DIFFERENCE
  ONLY`), `FLAGGED · AUTO-APPROVE`, and "Read on: …" naming every source.
- New filter: **Missed claims · re-notify · N** (`?missed=1`).
- The link to Potential price drops counts the low-confidence drops waiting there.

**Potential price drops**
- New section *Low-confidence drops · held out of the price-drop queue*.
- A card for a Same-Day listing says so. "Not a real price" does nothing on it (Costco's own listing is never
  excluded: other warehouses' drops are priced from it); use "Verify price and skip".
- The evidence line counts shoppers only toward the N and says posts do not count.

## Old app builds

- **Shoppers (every build):** no route, request field or response field changed. Who gets a drop changed on the
  server only: fewer wrong drops, none added. The push and the released-drops list are unchanged in shape.
- **Installed admin build:** every new field is additive (`tier`, `basis`, `sources`, `tierReasons`,
  `autoApprovable`, `reentry`, `toldPrice`, `toldEnds`, `adminConfirmed`, `receiptWarehouseCode`, `missed`,
  `missedCount`, `autoApproval`, `lowConfidence`, `samedayListed`). It keeps listing every pending drop under To
  review, with the confidence box it already has. Most drops are savings drops now, so they show a score where
  they said "not scored — price-group drop".
- On the installed admin build a Potential card with posts can read "Seen by 0 shoppers and 3 website posts"
  without the "needed" part. The new build words it correctly.

## Cost

- No new job, table or migration.
- The queue list makes 3 more reads per opening (missed count, daily auto-approval count, one confidence pass over
  the pending savings rows). Admin only.
- The sweep, with the auto-approval switch off: one read of the pending savings rows per global sweep, and a live
  Same-Day request only for a drop whose last read is missing or older than 6 hours. That is at most one request
  per pending (saving, warehouse) per 6 hours; 5 drops were pending on 2026-11-12.
- `listPotential` and `findNotifiable` were timed on the dev database before and after: 29 → 33 ms and 50 → 55 ms.
  Dev holds little data. **Production was not measured.** `adminAlerts` runs `listPotential` every 5 minutes and
  the slow-job alert (5 s, three runs) from #374 watches it.

## What to check after the deploy

1. Queue #12341 (mussels) closes on the next sweep and appears on Potential price drops.
2. #12351 and #12352 (Fanta) stay pending and show a saving as their evidence.
3. `adminAlerts` duration in `job_runs` stays under 1 s.

## Tests

- `backend/tests/priceDropQueueRules.test.js` (pure, 15): the flyer rule in the confidence, the tier and badge,
  re-entry and the charge.
- `backend/tests/priceDropQueueRulesDb.test.js` (dev database, 12): the mussels case end to end, the flyer across
  warehouses, no re-entry, the missed claim's filter and count, the evidence refresh, the daily count, and the two
  routes.
- Updated for the rule change: `priceDropWindowSourceDb` (posts no longer vote), `savingsHarvestDb` (savings
  first), `savingsQuality` (auto-approval off still flags).
- `__tests__/adminPriceDropQueueScreen.test.js` (+10) and `__tests__/adminPotentialDropsScreen.test.js` (+5).
- 10 mutations, 10 caught (each rule broken on purpose, one at a time).

## Decisions taken without asking (say if any is wrong)

1. A **deeper price** on a told line still enters the queue. It is a new drop and bills only the difference.
   Read strictly, "never in the queue again" would block it and the shopper would lose the extra saving.
2. A price verified by **shoppers only** (rule of N) is `potential`, not `high`: no official source stands behind it.
3. For a flyer saving, a Same-Day read that **found the item with no saving** still lowers the confidence.
4. A drop an admin **verified on Potential** is `high` but never flagged for automatic approval.
