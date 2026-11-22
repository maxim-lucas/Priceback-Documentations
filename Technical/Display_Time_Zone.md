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

The activity dashboard's periods (24 h, 7 days, 30 days, all) are rolling windows counted in hours. They do not depend
on any zone.

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
