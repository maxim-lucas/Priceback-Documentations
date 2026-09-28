# The adjustment window: how PriceBack models time

**Written:** 2026-09-17, alongside the fix for Bugs #256.
**Revised:** 2026-09-27 — a receipt's two dates are kept apart, and "today" is
the shopper's **province** day on the phone *and* on the server (Bugs #288,
#289; #370).
**Revised:** 2026-09-28 — §5: the dates outside receipt tracking. A tag scan is
dated on the scanner's province day, the savings report and Guarantee pushes on
the shopper's clock (Bugs #292, #293; branch `hotfix/clock-skew-dates-main-ci`).
**Audience:** anyone about to touch a receipt date, `daysRemaining`,
`policy_status`, the price-drop sweep, the urgency tier, or a date on a screen.

---

## 1. A receipt has two dates, and they are different kinds of thing

| | What it is | Where it lives | How it is shown |
|---|---|---|---|
| **Purchase date** | The DATE printed on the receipt — read by OCR, or what the shopper confirmed | `receipts.purchase_date` (`DATE`), the app's `purchaseDate` (`"YYYY-MM-DD"`) | As that calendar day: `formatDate("2026-06-30")` → June 30 |
| **Scan date** | The INSTANT the receipt was created in PriceBack | `receipts.created_at` (`timestamptz`), the app's `createdAt` | The calendar day that instant falls on **in the shopper's province** ("Scanned on", "Imported on" for an email receipt) |

Rules that follow:

- **The purchase date is never converted.** It is a day, not an instant. Take
  the printed Y-M-D literally, ignore any time part, and never pass it through
  `new Date("YYYY-MM-DD")` — that is UTC midnight, the evening *before*
  everywhere in Canada, and it is exactly how every purchase date on the
  receipt screen, in the claim email to the store, and in a product's purchase
  history printed one day early (Bugs #288).
- **The adjustment window counts from the purchase date**, never from the scan
  date. #159 and the 2026-07-03 "purchase date always today" regression were
  both the scan date leaking into the purchase date.
- **`created_at` stays server-stamped.** It feeds the Price-Drop Guarantee's
  receipt count and the monthly recap, so a client-supplied value would let a
  device backdate it. Offline-queued scans do not carry their capture time into
  the saved receipt, so the device's `createdAt` and the server's `created_at`
  both mean "saved and synced" — the same moment, give or take the upload.
  No separate `scanned_at` column is needed; none was added.

## 2. The model, in one sentence

**A price-adjustment deadline is a calendar DATE, and "today" is the shopper's
province day — the same day on the phone and on the server.**

- The window closes on **purchase + N calendar days** — not
  `purchase + N × 86,400,000 ms`. A window spanning a DST change is 24 h ± 1 h
  out, and once `Math.ceil` gets hold of it that is a whole day.
- **"Today" is read on the shopper's province clock** (`shared/trackingTime.js`):
  - **App** — `utils/trackingClock.trackingTodayISO()`, fed from
    `prefs.province` by `storageService.getPrefs/savePrefs`. No province on file
    (or a runtime whose Intl cannot resolve a zone) → the **device's** own day,
    i.e. exactly the pre-2026-09-27 behaviour.
  - **Server** — `backend/lib/trackingWindow.trackingTodayISO(province)`, from
    the account's `users.province_id` (set from the postal code at signup). No
    province → **Eastern** (`America/Toronto`), the app's home market — the
    same fallback `pushI18n.formatDate` uses. Never the UTC day.

### The zone table

One IANA zone per province/territory — the zone most of its people live in.
IANA names rather than offsets, so each province's own DST rules come with it
(Saskatchewan and Yukon observe none) and so does whatever they change to next.

| Code | Zone | Code | Zone |
|---|---|---|---|
| BC | `America/Vancouver` | AB | `America/Edmonton` |
| NT | `America/Edmonton` (Yellowknife's canonical zone) | YT | `America/Whitehorse` (UTC−7 all year) |
| SK | `America/Regina` (no DST) | MB | `America/Winnipeg` |
| ON | `America/Toronto` | QC | `America/Toronto` |
| NU | `America/Iqaluit` | NB | `America/Moncton` |
| NS | `America/Halifax` | PE | `America/Halifax` |
| NL | `America/St_Johns` (half-hour offset) | | |

Several provinces span more than one zone (north-western Ontario,
Lloydminster, Labrador, BC's Peace region and Creston, Nunavut's three). The
province is the granularity an account carries, so those shoppers get their
province's majority zone.

### Where the code lives

| File | Job | Rule it keeps |
|---|---|---|
| `shared/trackingTime.js` | the province → zone table, `dateInTimeZone` | ONE table for both sides; mirrored to `backend/shared/` by `sync-shared.js`, parity-tested |
| `src/utils/trackingClock.js` | the app's tracking day; the day a scan instant falls on | device-local fallback; grep-guarded like `localClock.js`; per-minute memo (exact — every zone's midnight is on a whole minute) |
| `src/utils/adjustmentWindow.js` | all calendar arithmetic (app) | **no `Date` token at all**, grep-enforced |
| `src/utils/localClock.js` | the device wall clock ⇄ calendar | notification fire times ("9 AM where the phone is"), date pickers |
| `src/services/priceService.js` | `daysRemaining`, `isWindowOpen`, `priceDropUrgency`, `adjustmentExpiry{,ISO}` | injectable `todayISO`, **defaulting to the tracking day** |
| `src/services/i18n.js` `formatDate` | rendering | a bare `"YYYY-MM-DD"` renders as that calendar day |
| `backend/lib/trackingWindow.js` | the server's window arithmetic | the app's formulas exactly — pinned by `__tests__/trackingParity.test.js` |
| `backend/repos/receiptsRepo.js` | `recomputePolicyStatus`, `recomputeOverduePolicyStatuses` | the OWNER's province day (the batch binds one date per province into a `CASE`) |
| `backend/priceDropNotifier.js`, `backend/server.js` | push urgency, the legacy sweep's window check | the BUYER's / the watch item's province day |

### Why the province (and why this reverses the 2026-09-17 note)

The 2026-09-17 version of this document said a country + province lookup "was
considered and is not needed": the device already holds both inputs and can
count on its own local day. That is true **for the app** — and it is exactly
what left the **server** counting on UTC, because the server has no device
clock. Every evening the server's day ran ahead of every Canadian shopper's:
from 17:00 in Vancouver, 20:00 in Toronto. Receipts flipped `watching →
expired` while the app still showed a day left, the legacy sweep stopped
pushing the same, and push emoji were picked on a different day than the chip
they opened (Bugs #289).

Maxim, 2026-09-27: *"the tracking should respect every user in the country
(canada has few timezones so every tracking should never calculate the date
but the date is scanned and the tracking should be based on the timezone of the
user based on the province)"*. The server does know every account's province,
so both sides now read the same table and agree.

The cost, stated: a shopper travelling out of province is tracked on their
**home** province's day, not the phone's. That is also the day the server uses,
so the two still agree — which the device-local model could never promise.

## 3. Open disagreement #1 — the client and the DB differ on the last day

**Status: known, deliberate, unchanged. Do not "fix" one side alone.**

| | Rule | Day `purchase + N` |
|---|---|---|
| Client (`daysRemainingISO`), legacy sweep (`isWithinWindow`) | EXCLUSIVE | window CLOSED, counter reads 0 |
| DB (`receiptsRepo` via `trackingWindow.isPastWindow`) | INCLUSIVE — expired iff `purchase_date + window < today` | still `watching` |

For a shopper with a province, both sides now count on the **same** day, so
the disagreement is exactly that one day per receipt — no longer "one day plus
the gap between UTC and local midnight". It predates both timezone fixes and
exists at every offset.

**Why it is still not resolved:**

1. **Exclusive is the conservative side.** Adopting the inclusive rule would,
   for one day per receipt, tell a shopper they can still claim when the
   client cannot verify the store agrees. A timezone fix is not the vehicle for
   loosening a refund deadline.
2. **`updateExpiredReceipts` writes, it does not render.** It persists
   `status:"expired"`, sets `watchEnabled:false` on every item, and mirrors each
   stop to the backend **durably**. Moving the boundary by a day is a data
   change with a backend side effect, and not idempotently reversible — once
   `watchEnabled:false` is mirrored, the next bootstrap merge keeps it off.
3. **It would make a timezone fix unverifiable.** Every assertion would move by
   a day at once.

Pinned on both sides by tests named for what they are
(`__tests__/adjustmentWindow.test.js` → *"EXCLUSIVE: the window is already
closed on day purchase+N"*, `backend/tests/trackingWindow.test.js` →
*"isPastWindow is INCLUSIVE of the last day"*).

**If you do take it on:** decide the rule once, move `daysRemainingISO`,
`trackingWindow.isPastWindow` / `isWithinWindow`, and `priceDropRepo`'s SQL
window (`f.available_from <= rc.purchase_date + adjustment_days`) together,
and say what happens to receipts already sitting at `watchEnabled:false`.

## 4. Disagreement #2 — the push emoji and the in-app chip: CLOSED for shoppers with a province

Until 2026-09-27, `priceDropNotifier.urgencyTier` divided elapsed milliseconds
and flipped at UTC midnight, while the app's `priceDropUrgency` counted whole
calendar days and flipped at local midnight — so for about |offset| hours
around each crossing a push led with a different emoji than the chip it opened.

Now `urgencyTier` is `trackingWindow.urgencyTier`: the app's formula (whole
days left ÷ window: > 2/3 green, > 1/3 yellow, else red), counted on the
buyer's province day. `__tests__/trackingParity.test.js` loads the backend
module next to the app's functions and requires identical answers — the day for
every province at every seventh hour of 2026, days remaining for five window
lengths, and the tier for every day of Costco's window.

**What remains:** an account with no province is counted on Eastern by the
server and on the device's own zone by the app. They agree in Ontario and
Quebec; elsewhere they can differ by the zone gap around midnight. Rare: a
postal code is required at signup, and the province comes from it.

## 5. The dates outside receipt tracking, and the clock each one reads

Until 2026-09-28 this section listed three dates still read on a clock that was
not the shopper's. Maxim asked whether they "should be on the same user timezone
also — i think they are relative to the receipt purchase date". Only the first
is compared with the purchase date, but all three are the shopper's day now:

| Date | What it is | Clock | Notes |
|---|---|---|---|
| A tag scan's observation day (`price_points.observed_at`, `price_tag_scan`) | the day a price was SEEN. `findNotifiable` compares it with the buyer's **printed purchase date** ("available strictly after it, within the window"); the tag route compares it with the tag's printed "valid until" | the **scanner's province day** — `trackingWindow.trackingTodayISO(province)` in `POST /api/observations/tag`; Eastern without one | Bugs #292. Was the server's UTC day: from 17:00 in Vancouver an evening sighting counted as "after" a same-day purchase, a last-evening sighting fell outside the window, and a tag valid until today was ruled **expired** (no credit). |
| `findNotifiable`'s `observed_at::date` | the SQL that reads that day back | none — it DECODES | **Correct, keep it.** Every point source stores a DAY at UTC midnight (receipt rows the printed purchase date, `/api/watch` rows the purchase date the phone sends, tag rows the province day) and the session TimeZone is UTC, so `::date` returns it exactly. `AT TIME ZONE 'America/Toronto'` would move every such midnight to the day before — Bugs #288 again. |
| A claim date in the savings report (`exportService`) | the INSTANT the shopper marked a refund claimed | the **tracking clock** — `trackingClock.trackingDateOfInstant` (province; device without one) | Bugs #293. Not relative to the purchase date. An old claim with no `claimedAt` is filed under its printed purchase date, literally (`parseISODateParts`). "Generated on" is `trackingTodayISO()`. |
| Dates in Guarantee pushes (`pushI18n.formatDate`) | store renewal, "turn off auto-renew by", end of the free year — INSTANTS | the **recipient's province** — `sendUserPush` hands every `build(lang, { province, country })`; Eastern without one | Bugs #293. Not relative to the purchase date. Read on Eastern, a BC shopper was given an auto-renew deadline one day late. |

Still UTC, known and harmless today: `crowdRepo.recordObservation`'s fallback
when a caller passes no date (`dateStr(now)`) — no production caller relies on
it (#292).

**By design, device-local:** the purchase-date picker's upper bound and the
"can't be in the future" check (a receipt printed in local time must never be
refused because the home province is still on yesterday), and notification fire
times ("9 AM where the phone is").

## 6. The testing rules this produced

🔴 **Assigning `process.env.TZ` inside a Jest test does nothing.**

Node re-reads the zone only when the assignment goes through the real
`process.env` setter, and Jest hands each test file a cloned env object, so the
setter never fires. Measured on this repo: `UTC`, `Asia/Tokyo`,
`America/Vancouver` and `Pacific/Auckland` in turn all produced the **same local
hour**.

**What works instead:** TZ in the **process environment** before Node starts.
`__tests__/adjustmentWindowTimezone.matrix.test.js` spawns a child `jest` per
zone with `TZ` in the child's env — 7 zones from UTC−8 to UTC+13 including the
half-hour `America/St_Johns`. It lives in a test rather than in the workflow
because `__tests__/ciParity.test.js` forbids test parameters in
`.github/workflows/test.yml` — so a plain `npm test` runs a real matrix,
locally and in CI alike. Since 2026-09-27 it also runs `trackingTime`,
`trackingClock`, `formatDateCalendar` and `receiptSpending`, and since
2026-09-28 `exportServiceDates` (#293): with a province set, **the tracking day
must be identical in all seven device zones** — that is the property a province
clock exists for.

Rules that fall out of it:

1. **Pin the hour as well as the zone.** The #256 defect hid for 19 of 24 hours
   in Toronto. A zone-only matrix would have been green all morning, red in the
   evening, and dismissed as a flake.
2. **Never build a fixture with the arithmetic under test.** Use
   `Date.UTC(localY, localM, localD) ± n*86400000`, or a fixed instant written
   in UTC with its local time beside it (`2026-09-28T05:30Z` = 22:30 in
   Vancouver, 01:30 in Toronto).
3. **A green CI run is not evidence for date logic.** CI runs at UTC, the single
   offset where a local/UTC mix cannot reproduce.
4. **Server date tests use fixed instants in the PAST** when they run a batch
   over the shared database (`recomputeOverduePolicyStatuses`): a receipt
   overdue at a past instant is overdue now, so the test can only do what the
   next real sweep would.
5. **Mutation-check the boundary.** Making the server's day UTC again fails all
   three `policyStatusProvinceDb` tests; putting `CURRENT_DATE` back into the
   batch SQL fails exactly the two batch tests; reverting `formatDate` to
   `new Date(value)` fails the matrix in all seven zones and the claim-email
   test in Toronto.
