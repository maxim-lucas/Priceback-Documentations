# Display time zone: shoppers on their own clock, the admin on Toronto

**Rule (Maxim, 2026-11-21, refined 2026-11-22):**

> "for me as an admin i always saw the UTC time so it wasnt correct. i agree with you all users should get the time
> (if they have any screen based on time which i doubt) based on their timezone. you just have to be accurate for all
> users if this is the case. admin should also see based on their timezone even the other users events because he has
> to make sure everything is matching, also the activity dashboard and the other scans date, ...etc should be based on
> the admin timezone but i am the only admin so it should always be toronto"

## The three clocks

| Who reads it | Clock | Where it is defined |
|---|---|---|
| **A shopper's screen** | The shopper's **device** zone | `i18n.formatDate` (no `timeZone`: the phone's own zone). A bare `YYYY-MM-DD` is formatted as that day. |
| **A push or an email to a shopper** (written by the server, which has no device clock) | The **owner's province** zone | `pushI18n.formatDate` / `formatDay`, `shared/trackingTime.timeZoneForProvince` |
| **Every admin screen, admin email and admin text** (the admin's own events and every shopper's) | **Toronto**, fixed (`ADMIN_TIME_ZONE`) | `shared/displayTime.js` |

Toronto is fixed, not the admin's device zone. That way an admin travelling abroad (Egypt) still reads the times on the
clock the shoppers' days and the crons run on. If a second admin ever lives elsewhere, `ADMIN_TIME_ZONE` becomes a
per-admin setting. It is one constant today.

**Stored data is never converted.** Every timestamp column is `timestamp with time zone`, which stores an instant (in
UTC). A zone exists only when the instant is turned into text. Rewriting stored values would move every instant by 4–5
hours and break the windows, the crons and every comparison.

**Business days are not display.** The day a shopper's tracking window falls on stays the owner's province day
(`shared/trackingTime.dateForProvince`, CLAUDE.md "One rule, one function"). The SQL `::date` on `observed_at` /
`purchase_date` in the price-drop rules is calendar logic, not display, and is not touched by this rule.

## `shared/displayTime.js` (synced to `backend/shared/`)

- `ADMIN_TIME_ZONE` (= `DISPLAY_TIME_ZONE`): `"America/Toronto"`
- `isCalendarLike(v)`: **the one rule** for "is this a day, not an instant?" It is true for a bare `YYYY-MM-DD`, an ISO
  string with no offset, or exactly UTC midnight (how a `DATE` column such as a purchase date comes back serialised).
  A calendar value is printed as its own day, never converted to another zone.
- `adminDay(v)`: `YYYY-MM-DD`, the Toronto day of an instant (or a calendar value as printed)
- `adminDateTime(v, { seconds })`: `YYYY-MM-DD HH:mm` on the Toronto clock
- `displayDay`, `displayDateTime`, `displayTimeOfDay`, `formatInstant`: the lower-level Toronto formatters

### Admin consumers (2026-11-22)

The raw-row viewer (`AccordionSection.formatValue`, used by the account report, activity lists and notification
history), the receipt view (`instantDay`: scanned, deleted, corrected, reviewed at), quality labels, the refused-scan
list, account Joined / last opened, the shopper preview (plan end, last seen), credit reconciliation (detected),
notification approvals (drafted, reviewed), partners (comped until, code end, payouts), Potential drops (evidence
days), the queue (`shortTime`, daily stock read, promo end), the receipt reader list, unlinked stock (last run, stock
read), the drop evidence text (`dropConfidence`: saving checked, stock checked), the drop-reminder recap email ("Last
seen (Toronto)") and the web console's last sweep.

### Admin days and counters (2026-11-22, second pass)

Maxim: *"when i see a scanned receipt sometimes the scanned date is in the next day already by the end of the day in
canada, same for activity dashboard counters, and all the counters in the app, also a created account"*. A day on the
admin desk is a **Toronto calendar day**, cut at 00:00 Toronto, for the date printed and for the counters alike:

- `adminDayStart(daysBack, now)`: the instant 00:00 Toronto starts, `daysBack` days before today (exact across both
  daylight-saving changes, which happen at 02:00). `adminPeriodHours(days, now)`: the hours from the start of a
  `days`-day period (today + the `days - 1` before it) to now.
- **Activity dashboard**: the periods are **Today, 7 days, 30 days** in Toronto calendar days (was rolling 24 h /
  168 h / 720 h, so "24 hours" at 21:00 still held yesterday evening, and UTC days rolled at 19:00/20:00). The app sends
  `sinceDays=<n>` beside `sinceHours`. `backend/lib/adminWindow.windowHours` is the one parser, used by
  `GET /api/admin/overview` and by the accounts drill-down behind each counter (`GET /api/admin/users?activity=`), so
  the number and the list it opens read the same rows. An older build sends only `sinceHours` and reads exactly what it
  did. `adminConsoleRepo._since` takes a fractional window (`make_interval(secs =>)`).
- **Paid subscription charges** on the dashboard are de-duplicated per Toronto day (was UTC).
- **Scanned on**: `adminReceiptView.scanDay` is `created_at`'s Toronto day on every admin screen (the list, the facts,
  the shopper-view detail card). It used to print the server's `scannedOn` (the owner's province day), so a scan in
  Vancouver at 22:30 and a scan in Toronto at 01:30 showed different days on the same desk. `scannedOn` is only the
  fallback when a row has no `createdAt`. The **shopper** still sees their own day.
- **Account joined**: printed through `formatValue` → `adminDateTime`, Toronto.

**Not changed, on purpose:** the home screen's incident counters (failed jobs, sign-in failures needing action) and
Incidents' "last 24h" stay rolling 24-hour windows; they say "last 24h" and an alert should not shrink at midnight.

**Found, not changed (a money rule, Maxim's call):** the tag-scan credit caps in `backend/repos/tagCreditsRepo.js` count
the month and the week from UTC (`startOfMonthUTC`, `startOfWeekUTC`), so a cap resets at 19:00/20:00 Toronto on the last
day. `priceTagScansRepo` already counts its day and week in Toronto.

**Kept in UTC on purpose:** the receipt reader's "Today (UTC)" Gemini budget. That quota is counted per UTC day, and the
label says exactly that.

## Never

- `String(ts).slice(0, 10)` or `.slice(0, 16).replace("T", " ")` to show an instant on an admin screen (that shows UTC).
  Use `adminDay` / `adminDateTime`.
- `toLocaleString()` without `timeZone` on an admin screen (that uses the admin's device zone).
- `timeZone: "America/Toronto"` on a **shopper** screen: a shopper in Vancouver or Halifax must see their own time.
- `UPDATE … SET ts = ts AT TIME ZONE …`, or any rewrite of stored instants.

Tests: `__tests__/displayTime.test.js` (admin helpers, the calendar rule, the shopper's device clock),
`__tests__/formatDateCalendar.test.js` (run in every zone by `adjustmentWindowTimezone.matrix.test.js`).
