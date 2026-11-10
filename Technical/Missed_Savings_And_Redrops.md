# Missed savings and re-drops

**Status:** built 2026-11-09. Migration `0049_price_drop_redrops` applied to dev and **prod** on 2026-11-09 (prod
ledger id 58). The server code ships with the next backend deploy. The products-view changes ship with the next app
build.

## What Maxim asked (2026-11-09)

1. *"expired savings (not claimed at the saving window) should be in expired in the products view"* — they showed
   under **Watching**, mixed with lines that never dropped.
2. The products-view filters become **Watching · To claim · Claimed · Missed or expired**, with no "All" chip. The
   receipts view keeps "All".
3. *"if claimed, dont move it at all and dont watch again"*.
4. *"the total of savings in the year should include the missed ones (or split the view as total claimed XXX
   including YY expired)"*.
5. *"if a missed product and its price drop again and the 30 day window for costco is still valid, the user should
   get notified again and no credit consumption (if already charged) if the price drop wasnt charged before it should
   use credits. (credit never applies to subscribers)"*.
6. *"undo all rejected or expired prod cases, so they appear again the price drop waiting to approve"*.
7. *"All these modifications should not have any impact on users before updating the new version (old builds should
   work fine too)"*.

The case behind it: product **379252** (Pinty's buffalo chicken). It was $11.99 instead of $14.99 from Oct 19 to
Oct 25, and the same saving came back Nov 9–15. One Ontario shopper (line 3140, bought Oct 14, window to Nov 13) had
her first drop rejected on Oct 26 because it was the last day. She was **never queued again** for the second run.

## The app (next build)

`src/services/productStatus.js` is the one place that decides where a product sits:

| Chip (code) | Label EN / FR | A line is here when |
| --- | --- | --- |
| `claimed` | claimed / réclamé | it was claimed. Final: never moves, never watched again |
| `alerts` | to claim / à réclamer | a drop it can still claim (`isActiveDropLine`, same as the cold-start landing) |
| `expired` | missed or expired / manqués ou expirés | the receipt's window is over, **or** it had a drop whose saving ended before a claim |
| `watching` | watching / en veille | everything else inside its window |

- The codes did not change (`alerts`, `expired`), so deep links, notification routing and old builds are untouched.
  Only the labels and the products-view logic changed.
- In the products view, "All" from the receipts view (or a deep link) opens on **Watching**.
- A missed line is still watched while its receipt is in window. When the saving comes back, the server releases the
  drop again and the line moves back to **To claim** by itself.
- **Home:** under the all-time "Total saved", a quieter line reads *"Missed in 2026 · $YY · drops not claimed in time"*
  (`home.missedThisYear`). It counts unclaimed drops that can no longer be claimed, on receipts purchased that year
  (`missedSavingsInYear`). It sits next to the claimed total and is never added into it, because that money was not
  saved.

## The server: re-drops

### Before

A line was told about a price **once, for life**:

- `findNotifiable` / `savingDropRepo` skipped a line already told at the same price or lower.
- `price_drop_notifications` has a unique index on `(receipt_item_id, price)`.
- The review queue's unique `(receipt_item_id, price)` meant one rejected row blocked every later run at that price.
  `stage()` revived only superseded rows.

### Rule now

A **re-drop** is a line that:

- was told about a saving that has **ended** (its told end is before the buyer's day);
- has a saving with a **later known end** running now;
- is unclaimed, inside its store window, below the price paid and over the materiality floor (the usual rules).

An unknown end on either side is never a re-drop: re-sending needs proof that the saving went away and came back.

| Case | Notified | Charged |
| --- | --- | --- |
| Never told | yes | the normal charge (unchanged) |
| Told, same or higher price, new run | **yes, once per run** | **0** |
| Told, deeper price | yes | only the extra difference (unchanged telescoping) |
| Subscriber | yes | never (unchanged `isCreditExempt`) |
| Claimed line | **never** | — |

### How

- **Migration 0049** (additive, idempotent):
  - adds `price_drop_notifications.saving_ends` and `price_drop_review_queue.saving_ends`, the end of the saving the
    shopper was told about or that was queued;
  - creates a new table `price_drop_redrops(receipt_item_id, price, saving_ends, sent_at)` with a unique
    `(receipt_item_id, saving_ends)`, which elects one sender per run.
  - **Backfill:** each existing row's end comes from its price point's printed or flyer end (the `_vouchedEnd` rule)
    or an admin's saving dates, else its saving's `valid_until`. On prod this dated 133/142 ledger rows and 175/188
    queue rows. Undated rows keep the old behaviour: never re-notified.
- **`priceDropRepo`**:
  - `toldSavingEnds(item)` is the latest end on the line's ledger rows plus its re-drops.
  - `redropClause(...)` is the rule above, shared by the price-group and savings detection.
  - `findNotifiable` rows carry `redrop: true|false`.
  - `recordNotified` now stores `saving_ends`.
  - `recordRedrops` elects re-drops. It writes no ledger row and no credit row, so `price_drop_notifications` keeps
    its single writer (pinned by `commissionChargedOnce.test.js`).
- **`priceDropQueueRepo.stage`**: a **rejected or sent** row is revived to pending when its own saving ended before
  today and the drop found now ends later. A rejection covers the run it judged; an unknown end revives nothing.
- **`priceDropNotifier._deliver`**: the re-check carries `redrop`. Re-drops go to `recordRedrops` (no charge) and the
  rest to `recordNotified` (charge, as before). Both are pushed the same way. A line claimed while its re-drop
  waited is closed, not pushed.
- **The app already shows a re-drop** on every build from 3.1.0 on. `releasedForUser` reports each notified line with
  the end of the latest run that fits its window, so the phone marks it claimable again. Nothing on the phone had to
  change for that.

### Old app builds

No route, request field or response field changed.

- The push for a re-drop is the same message the drop push always was.
- Builds older than 3.1.0, which learn of a drop only from its push, get that push again for the new run. That is
  the intended change.
- The released-drops list is unchanged in shape and meaning.

### Cost

No new job and no new request. Each sweep's candidate query adds two indexed sub-selects per candidate line, on
`price_drop_notifications` and `price_drop_redrops`, both keyed by `receipt_item_id`. That is negligible at today's
142 + 0 rows.

## Prod datafix, 2026-11-09 (Maxim: "do the datafix yourself")

Every **rejected** or **superseded** queue row whose line is unclaimed, watched, not deleted and still inside its
store window was set back to **pending** (`reviewed_at`/`reviewed_by` cleared, `attempts` 0). The drain re-checks
each one against today's prices before anything is charged or sent, so a row that no longer applies closes as
superseded again.

| Queue id | Line | Product | Price | Was | Window closes |
| --- | --- | --- | --- | --- | --- |
| 449 | 3140 | 379252 Pinty's buffalo chicken | 11.99 | rejected | 2026-11-13 |
| 3831 | 3333 | 647465 Avocados | 7.99 | rejected | 2026-11-12 |
| 6032 | 5879 | 1274091 Dempster's 12-Grain | 5.99 | rejected | 2026-11-10 |
| 6035 | 5924 | 1274091 Dempster's 12-Grain | 5.99 | rejected | 2026-11-16 |
| 6048 | 6013 | 84 Coke 32×355 | 6.99 | rejected | 2026-11-25 |
| 4837 | 2663 | 55502 KS chicken drumsticks | 14.52 | superseded | 2026-11-11 |
| 4838 | 2723 | 55502 KS chicken drumsticks | 14.91 | superseded | 2026-11-16 |
| 4839 | 3491 | 55502 KS chicken drumsticks | 14.52 | superseded | 2026-11-20 |
| 8824 | 4303 | 55502 KS chicken drumsticks | 12.68 | superseded | 2026-11-23 |
| 8825 | 2663 | 55502 KS chicken drumsticks | 12.68 | superseded | 2026-11-11 |
| 8826 | 3491 | 55502 KS chicken drumsticks | 12.68 | superseded | 2026-11-20 |

Also queued, by the sweep and not the datafix: 9631 and 9632, the QC lines 4336 and 4332 of 379252.

## Tests

- `__tests__/productStatus.test.js`: the chip of each shape; missed savings per year.
- `__tests__/receiptsScreenProductOrder.test.js`: no "All" chip in the products view; a missed saving lists under
  Missed, not Watching.
- `backend/tests/priceDropRedropDb.test.js` (dev DB, 14 tests):
  - detection: never told, told about the ended run, told about the running run, already re-notified, unknown end,
    claimed line;
  - the racing election, with no charge and no ledger row;
  - queue revival: rejected or sent of the ended run is revived; rejected of the running run, or with no end, is not;
  - end to end: re-pushed, 0 credits, once per run.
