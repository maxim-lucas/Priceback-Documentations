# Display time zone: every timestamp is shown in Toronto time

**Rule (Maxim, 2026-11-21):** *"convert all the timestamp in the app in all tables specialy users, price drops, ...etc
with the actual toronto timezone, you can use a function for the UI"*.

## What it means

| | |
|---|---|
| **Stored** | Unchanged. Every timestamp column is `timestamp with time zone`, which stores an instant (in UTC). No data is rewritten. A stored instant has no zone of its own: "Toronto time" is a way of *reading* it. Rewriting the values would shift every instant by 4–5 hours and break every window, cron and comparison built on them. |
| **Shown** | On the Toronto clock (`America/Toronto`, EST/EDT handled by the zone database), on the phone, the admin desk, the web console and the admin's evidence text. |
| **Calendar dates** | A bare `YYYY-MM-DD` (a printed purchase date, a `date` column) is a day, not an instant. It is shown as that day and never converted to another zone. |
| **Business clock** | Unchanged. Which day a shopper's tracking window falls on stays the owner's province day (`shared/trackingTime.js` `dateForProvince`, CLAUDE.md "One rule, one function"). Toronto is only the clock used to *display* times. |

## The one definition

`shared/displayTime.js` (synced to `backend/shared/`):

- `DISPLAY_TIME_ZONE`: `"America/Toronto"`
- `displayDay(instant)`: the instant's Toronto day, `YYYY-MM-DD` (a bare date comes back unchanged)
- `formatInstant(instant, locale, intlOptions)`: localised text on the Toronto clock
- `displayDateTime(instant, { seconds })`: `2026-11-20 21:30`, the compact form for admin tables
- `displayTimeOfDay(instant, locale)`: the time of day

Consumers wired in Priceback (2026-11-21): `i18n.formatDate` (server timestamps passed as strings or epochs; a `Date`
object stays on the device's own calendar, because a DateField value is local midnight), the admin raw-row viewer
(`AccordionSection.formatValue`), the admin receipt view (`instantDay`: created, deleted, edited), quality labels,
account Joined / last opened, the stock-check time, the queue's daily stock read, promo-code end times, the drop
evidence text (`dropConfidence`, previously in UTC) and the web console's last sweep.

## Never

- `toISOString().slice(0, 10)` to show the day of an instant (it gives the UTC day, which is the next day from 19:00 or
  20:00 in Toronto).
- `toLocaleString()` without `timeZone` for a timestamp (it uses the device's own zone, so an admin abroad sees
  foreign times).
- `UPDATE … SET created_at = created_at AT TIME ZONE 'America/Toronto'` or any rewrite of stored instants.

SQL that groups by day for display uses `(ts AT TIME ZONE 'America/Toronto')::date`
(`priceDropQueueRepo` already does this).

Tests: `__tests__/displayTime.test.js`.
