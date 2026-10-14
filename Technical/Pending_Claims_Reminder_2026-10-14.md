# Pending-claims reminder and the shorter price-drop push (2026-10-14)

Maxim's asks, 2026-10-14: (1) "Price-drop credits used" inactive for everyone; (2) no source in the price-drop
push; (3) a reminder that totals the unclaimed drops; (4) "short and straight to the target".

## What was already true on `main`
- **"Price-drop credits used"** (`price_drop_charge`) has had no sender since 2026-10-01. Its switch
  (`notifDropCharge`) has `types: []` in `shared/notificationCategories.js`, so nothing can route to it. The debit
  shows in Credit History. The switch is still visible on the Notifications screen (removing a visible switch is
  its own decision).
- **"Flyer deal on <item>"** was deleted with the by-name scraper in Bugs #311 (2026-10-08).
  `priceDropSingleSender.test.js` fails the build if a `flyer_drop`/`price_drop` sender comes back.
  The one price-drop push is the verified one, released by the admin review queue.

## The price-drop push now
`You can save $10.00 · 29 days left to claim.` — nothing else, plus two optional sentences:
- `Verified by PriceBack.` **only** when PriceBack itself verified the drop (admin-verified, fewer shoppers than the
  rule of N). Never "verified by N shoppers", never receipts, never the source (flyer, tag, receipt).
  Not on the locked copy.
- `N more claims are waiting.` when the shopper has other unclaimed drops (the line being pushed excluded).
  `data.waiting` carries the number.

## The reminder (`backend/jobs/pendingClaimsReminder.js`)
`💰 3 price drops to claim` / `$18.00 in total · 2 days left to claim. Already claimed? Mark them as claimed in your
receipts to stop reminders.` (EN + FR.) One push per shopper, type `pending_claims_reminder`, category
`notifClaimReminders` (the Claim reminders switch; the master switch applies), Android channel `expiry-warnings`.

| Rule | Value |
|---|---|
| Runs | daily slot, 18:00 UTC (cron + 5-min boot catch-up; slot elected in `kv_state`; skipped if >4 h late) |
| What counts as waiting | a row in `price_drop_notifications`, line unclaimed + watched + undeleted, receipt undeleted, store window still open on the **shopper's** province day |
| Total | sum of (unit paid − lowest announced price) × quantity — the same figure as the drop pushes |
| Sent when | the oldest waiting drop has waited **2+ days**, OR one expires within **3 days** |
| Cadence | never daily: **3 days** between reminders (`PENDING_CLAIMS_REMINDER_GAP_DAYS`), **2** when something is about to expire |
| One a day | skipped if a drop push went to that shopper in the last 24 h (it already carried "N more waiting") |
| State | one `kv_state` key, `{sub: last reminder ms}`, pruned to 30 days each run |
| History | sent through `sendUserPush` → written to `notification_history` → visible per account in the admin console |
| Kill switch | `PENDING_CLAIMS_REMINDER_ENABLED` (Admin · config, no redeploy) |

They stop by **claiming**: mark the line claimed in the receipt (or switch its watch off) and it leaves the count.

## Server now, phone later
Decision (Maxim): server first; the phone variant could replace it in ~2 months once users have updated. Not built:
the existing local per-receipt reminders (`expiry_early/warning/final`) are scheduled per receipt and a second,
aggregated local scheduler would double-notify until the server one is switched off. The server version also knows
claims and windows authoritatively and reaches **every** installed build, which a local one cannot. If the phone
variant is built later, switch `PENDING_CLAIMS_REMINDER_ENABLED` off when it reaches enough users.

## Old app builds
Additive only. No route, request field or response field changed. Old builds receive `pending_claims_reminder` as
an ordinary push; the type is unknown to them, so a tap opens the app (`routeForNotification` → null), which is
their behaviour for every unrouted type. `verifiedDrop.body` lost the "Verified by N shoppers in XX" tail: text only,
no build parses it. `data.verifiedBy` (the contributor count) is still in the payload; `data.waiting` is new.

## Known issues found on the way (not changed)
- `priceDropDb.test.js` (2 tests) and `priceDropPipelineE2E.test.js` (3 tests) fail identically on clean `main`
  against the dev database: no drop push is produced. Pre-existing, unrelated to this change; the new behaviour is
  covered by `priceDropLockedPush.test.js` (stubbed) and `pendingClaimsReminderDb.test.js` (real SQL).

## Tests
`pendingClaimsReminder.test.js` (pure + job, no DB), `pendingClaimsReminderDb.test.js` (SQL + real `sendUserPush` +
history), `priceDropLockedPush.test.js` (the appended lines and the PriceBack-only verification), `pushI18n.test.js`.
