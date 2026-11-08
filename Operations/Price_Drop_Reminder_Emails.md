# Price-drop reminder emails (automatic) and running jobs by hand

**Asked (Maxim, 2026-11-07):** *"send an email for all users having awaiting price drops that they didn't receive push notifications or that they didn't open the app since or for a while (more than 3 days), add this process as automated process. this reminder should be sent once only for a price drop before the end date … if new price drops arrived for the same users, they should be notified … a recap not a detailed email with the number of price drops, the total savings, the earliest end date … invite the users to open the app … to claim … ask them to update the app … and to allow the notifications (at the end of the email as a request or PS) … professional format … the same language as the preferred language of the user, if no language selected … English … don't send this before my approval … all the emails will be sent using zoho."* Then: *"every 3 days as a start with a possible and easy reconfiguration. also add a way to force start this process and the harvest jobs too"*, and *"also add in the email the total of missed price drops (window ended)"*.

It is the automatic counterpart of the one-off campaign in `Unreachable_Shopper_Drop_Emails.md` (detailed email, no-token shoppers only, run by hand). That script still exists and is unchanged.

Code (Priceback, branch `hotfix/drop-reminder-emails`):

| Piece | File |
|---|---|
| Who, what, which language (pure) | `backend/lib/dropReminderEmails.js` |
| When, hold, send, ledger | `backend/jobs/dropReminderEmails.js` |
| The query and the once-only ledger | `backend/repos/dropReminderEmailRepo.js` |
| Ledger table | migration `0047_price_drop_reminder_emails.sql` (`priceback.price_drop_reminder_emails`) |
| Schedule, admin endpoints | `backend/server.js` (search `runDropReminderEmails`, `/api/admin/jobs/:name/run`) |
| Run from a terminal | `backend/scripts/runJobNow.js` |
| Settings | `backend/config/defaults.js`, `DROP_REMINDER_EMAILS_*` |
| Tests | `backend/tests/dropReminderEmails.test.js` (no DB), `backend/tests/dropReminderEmailRepoDb.test.js` (dev DB, needs 0047) |

## Who gets an email

A live account (`status = true`, no deletion requested) with an email address and **at least one fresh drop**, that also has **at least one reason**:

| Reason | Meaning |
|---|---|
| `no_token` | `users.push_token IS NULL`: no drop push ever left. Expo's delivery receipts clear the token of a phone Apple/Google report gone, so a failed push lands here too. |
| `push_denied` | `users.push_permission = 'denied'`: the phone reported notifications as turned off. |
| `inactive` | the app has not been opened for **more than** `DROP_REMINDER_EMAILS_INACTIVE_DAYS` (3). "Opened" = the later of `users.app_seen_at` (every bootstrap) and the newest `devices.last_seen` the shopper owns. Never seen = inactive. |

A **drop** is a `price_drop_notifications` row on a receipt line that is unclaimed, still watched and not deleted (the same filters as the push reminder). It is **fresh** when it can still be claimed today on the shopper's provincial day (`shared/claimDeadline`: the earlier of the store window and the saving's last day) **and** the line has no row in `price_drop_reminder_emails`.

**Once per drop.** After an email, each line it covered is written to `price_drop_reminder_emails` (UNIQUE on `receipt_item_id`) before the next email goes. That line is never fresh again. A new drop for the same shopper has no row, so it is emailed in the next run, and the recap covers only the new drops.

A drop whose window has closed is never a reason to email. It only counts in the missed total.

## What the email says

One language: the saved app language (`user_preferences.language`) when it is `en` or `fr`, **English otherwise** (no Quebec guess, no bilingual email).

| Part | Content |
|---|---|
| Subject | *"You have 3 price drops waiting: $18.00 to claim"* / *"3 baisses de prix vous attendent : 18,00 $ à réclamer"* |
| Recap | Price drops waiting · Total savings to claim · Earliest claim deadline (date and days left). Only the fresh drops. |
| Missed | When any unclaimed drop's window has ended (emailed before or not): *"Already missed: $X from N price drops that were not claimed in time. Don't let the next one slip away."* |
| Call to action | Open PriceBack for the details of each item and to claim. Button to the App Store / Google Play page (opens the app when installed; an email client strips a `priceback://` link). Both stores when the platform is unknown. |
| Signature | *Kind regards, The PriceBack Team*, support@priceback.ca, priceback.ca |
| P.S. | Update PriceBack to the latest version and allow notifications, with the store link(s). |
| Footer | Service message, not marketing. |

Sent from support@priceback.ca through Zoho (`lib/supportMailer`), Reply-To support, **normal importance**. "High" stays for the hand-run support campaign.

## When it runs

`server.js` calls the job every day at **19:00 UTC** (3 PM ET), plus once 8 minutes after boot. A scheduled run goes ahead only when:

1. `DROP_REMINDER_EMAILS_ENABLED` is not off;
2. it is 13:00 UTC or later (a boot at night sends nothing);
3. `DROP_REMINDER_EMAILS_INTERVAL_DAYS` (3) have passed since the last run (`kv_state` `job:dropReminderEmails:lastRun`, 2 h slack for cron jitter);
4. this process won the day's slot (`kv_state` `job:dropReminderEmails:slot`), so two processes during a deploy never both run.

At most `DROP_REMINDER_EMAILS_MAX_PER_RUN` (100) emails per run, largest savings first, 3 s apart. The rest wait for the next run.

## Settings (Admin › Config, category *notifications*; no deploy)

| Key | Default | Meaning |
|---|---|---|
| `DROP_REMINDER_EMAILS_ENABLED` | `true` | Kill switch for the schedule. A manual run still works. |
| `DROP_REMINDER_EMAILS_SEND` | **`false`** | **HOLD.** While false, every run (scheduled or manual) only prepares the list and the recap and sends nothing. Turn it on only after approving the list. |
| `DROP_REMINDER_EMAILS_INTERVAL_DAYS` | `3` | Days between runs. |
| `DROP_REMINDER_EMAILS_INACTIVE_DAYS` | `3` | "Not opened for more than N days". |
| `DROP_REMINDER_EMAILS_MAX_PER_RUN` | `100` | Cap per run (Zoho's sending limit). |

Remember `app_config` outranks `defaults.js`: once a row exists, changing the code default does nothing. Change the row.

## Approve, then send (the first run)

1. **Preview the list** (nothing is sent):
   - `GET /api/admin/drop-reminder-emails/preview` (admin token): every shopper with their address, language, reasons, count, total, earliest end, missed total, and the shoppers *not* emailed with why (`reachable_and_active`, `already_emailed`, `nothing_open`, `no_email`).
   - One shopper's email as it will look: `GET /api/admin/drop-reminder-emails/preview?sub=<sub>&format=html`.
   - Or from a terminal: `railway run -e production node scripts/runJobNow.js dropReminderEmails` prints the list and writes every email as `.html` / `.txt` + `manifest.json` into `backend/data/support-emails/drop-reminders-<date>/` (gitignored).
2. **Test**: `POST /api/admin/jobs/dropReminderEmails/run {"testTo":"you@…"}` or `runJobNow.js dropReminderEmails --test-to you@…`. Every email goes to that address, subject `[TEST → shopper]`. Nothing is recorded.
3. **Approve**: set `DROP_REMINDER_EMAILS_SEND = true` in Admin › Config. From then on every run sends: the next scheduled one, or now with `POST /api/admin/jobs/dropReminderEmails/run {}` (202, runs in the background; the outcome is in `GET /api/admin/drop-reminder-emails/last`).

The terminal `--send` is refused while the switch is off, unless `--i-approved` is passed too.

## Running jobs by hand

| What | Admin API (admin token) | Terminal (`railway run -e <env>` from `backend/`) |
|---|---|---|
| Reminder email, preview | `POST /api/admin/jobs/dropReminderEmails/run {"dryRun":true}` | `node scripts/runJobNow.js dropReminderEmails` |
| Reminder email, test | `… {"testTo":"you@…"}` | `… dropReminderEmails --test-to you@…` |
| Reminder email, send now | `… {}` (honours the hold) | `… dropReminderEmails --send` |
| One shopper | `… {"only":["<sub>"]}` | `… --only <sub>` |
| Savings harvest, all enabled sources | `POST /api/admin/jobs/harvestSavings/run` | `node scripts/runJobNow.js harvestSavings` |
| Catalogue harvest, all enabled sources | `POST /api/admin/jobs/harvestCatalog/run` | `node scripts/runJobNow.js harvestCatalog` |
| One harvest source | `POST /api/admin/savings/sources/<code>/run`, `POST /api/admin/catalog/sources/<code>/run` (existing) | `… harvestSavings --source <code>` |

A forced reminder run skips the switch, the hours, the cadence and the slot, but **never the hold**. A forced *send* restarts the 3-day cadence; a preview or a test does not. The harvest endpoints answer 202 at once with `started` and `running` (skipped because a run is in progress); the run rows are in the usual run history. The terminal harvest runs in that process and waits.

## SMTP on the server (one-time)

The server now sends mail, so `nodemailer` moved to `dependencies` and the Railway service needs the Zoho settings. They used to live only in `backend/.env`:

| Variable | Value |
|---|---|
| `SUPPORT_SMTP_PASS` | **Required.** The Zoho app-specific password for support@priceback.ca. |
| `SUPPORT_SMTP_HOST` | `smtp.zohocloud.ca` if the account is in Zoho's Canadian data centre (whatever Zoho Mail › Settings › Mail Accounts › SMTP shows). Default `smtp.zoho.com`. |
| `SUPPORT_SMTP_PORT`, `SUPPORT_SMTP_USER`, `SUPPORT_FROM_NAME` | Optional; defaults 465, support@priceback.ca, "PriceBack Support". |

Without the password a sending run fails with `SMTP_NOT_CONFIGURED`, sends nothing and records nothing. A preview needs no SMTP.

**Apple private relay** (`…@privaterelay.appleid.com`): delivered because support@priceback.ca is registered for *Sign in with Apple for Email Communication* on the Prosoft Inc team. The preview marks these `appleRelay`.

## Deploying it (backend hotfix)

1. Apply `0047_price_drop_reminder_emails.sql` to **prod by hand**, then insert its drizzle ledger row (prod's ledger is hand-maintained). New table only, additive, idempotent. No live build reads it.
2. Set `SUPPORT_SMTP_PASS` (and the host) on the production Railway service.
3. Deploy. `DROP_REMINDER_EMAILS_SEND` is false, so the first runs only preview.
4. Preview → test → approve → send, as above.

**Old app builds:** unaffected. No existing route, request or response changes. The new routes are admin-only, and the email is sent by the server.
