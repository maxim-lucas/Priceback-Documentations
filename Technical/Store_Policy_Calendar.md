# Store policy calendar — seasonal extensions and "not price-matched" periods

**Standing rule (Maxim, 2026-11-18)** — *"the policy of best buy … sometimes it extend in holiday or savings seasons
like black friday and boxing day. the app should always have a calendar of the irregular seasons to update the policy
based on the stores. make sure the app has this logic too."*

A store's price-adjustment window is `stores.adjustment_days` (Best Buy: 30, confirmed against bestbuy.ca on
2026-11-18). Its **calendar** adds dated periods on top, edited on **Admin · Stores → Seasonal policy**, read by the
server, the sweep and every phone.

## The two kinds of period

| Type | Meaning | Example |
| --- | --- | --- |
| `extends` | Bought between `starts_on` and `ends_on` (inclusive) → claimable through `claim_until` (inclusive). | Best Buy's holiday price guarantee |
| `excludes` | A price **first seen** between `starts_on` and `ends_on` is not price-matched by the store: never a drop. | Best Buy: "Black Friday, Cyber Monday and Boxing Day prices" |

`season` (black_friday, cyber_monday, boxing_day, holiday, other) only picks the translated label a shopper reads.

An extension is applied as **one number**: the window of a purchase on day *P* is
`max(adjustment_days, claim_until − P + 1)`. Every reader that took `adjustment_days` takes that number instead, so the
window rule itself (closed **on** purchase + N, `trackingWindow` / `adjustmentWindow`) is unchanged. An extension never
shortens a window. A store with no period behaves exactly as before. Costco has none.

## One definition

| What | Where |
| --- | --- |
| The rule (JS, phone + server) | `shared/storePolicyPeriods.js`: `windowDaysFor`, `extensionFor`, `isExcludedSighting`, `currentPeriods` |
| The SQL twin | `backend/lib/trackingWindow.js`: `windowDaysSql`, `storeWindowDaysSql`, `excludedSightingSql` |
| The rows | `priceback.store_policy_periods` (migration 0052), `backend/repos/storePolicyPeriodsRepo.js` |
| Served to phones | `/api/v1/policies.json`, each store record's `policyPeriods` (additive; a write touches the store row so `rev` moves) |
| Admin routes | `GET /api/admin/stores/policy-periods`, `POST /api/admin/stores/:code/policy-periods`, `PUT`/`DELETE /api/admin/stores/policy-periods/:id` |
| What a shopper reads | `src/utils/storePolicyCopy.js` (store card lines, the receipt's "Seasonal extension" row), keys `policyPeriods.*` en + fr |

Readers moved onto it: the receipt lifecycle (`recomputePolicyStatus`, `lifecycleCodeSql`, the overdue heal, auto-claim),
the drop sweep (`findNotifiable`), Potential price drops, the savings drop path, the queue, reminders and their emails,
saving dates, saving verify, the Best Buy feed's target list, bad-scan repair, the admin's shopper preview; on the phone
`priceService` (days left, open, expiry, urgency, the watch registration), the item claim deadline, the expired-scan and
email-import refusals (`receiptEligibility.purchaseWindowDays`: a store with no stated window still refuses nothing),
the claim email, Detail and Scan screens.

`excludes` is read by the drop sweep's sighting tests only (`findNotifiable`, Potential price drops, the savings drop path
on a saving's start). It never changes a window.

Pinned by `backend/tests/storePolicyPeriods.test.js` (the rule, the SQL twin's text, and a scan that fails when a SQL
window reader bypasses the calendar), `backend/tests/storePolicyPeriodsDb.test.js` (the SQL twin equals the JS rule on
real rows; lifecycle; sweep) and `__tests__/storePolicyPeriods.test.js` (every phone reader, the copy in en + fr, and a
scan that fails when a phone reader of a purchase's window reads `store.adjustmentDays` directly).

## Old app builds

Builds before this one ignore `policyPeriods` and count the base window. For a purchase an extension covers, such a
phone says Expired after the base window while the server keeps the receipt Watching and can still find a drop. The
drop is still pushed and released; the phone's countdown is the only thing that is short. The next app build closes it.

## Known limits

- **A price first seen in an excluded period stays excluded** while it holds: the Best Buy feed writes a price only when
  it changes, so a Black Friday price that simply stays after the sale keeps its first-seen date. Conservative (no drop
  Best Buy would refuse); it becomes a drop again only when the price moves.
- **Dates are entered by hand.** Best Buy's site refuses automated reads (403 to every fetch tried on 2026-11-18), so a
  season's dates come from the admin reading bestbuy.ca. What was published on 2026-11-18, as quoted by search results:
  Black Friday Sale from Nov 19, 2026 (VIP from Nov 18) through Dec 3; "Black Friday, Cyber Monday and Boxing Day prices"
  excluded from the Low Price Guarantee. No 2026 Canadian holiday-extension dates were found (only US ones). None of
  these were entered: the calendar starts empty, and it is Maxim's to fill.
