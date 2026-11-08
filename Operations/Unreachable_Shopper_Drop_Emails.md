# Emailing shoppers whose price drops reached nobody

**Asked (Maxim, 2026-11-02):** *"for shoppers not having push tokens and have price drops (active or locked) i need to send a custom email message for everyone in this list with the full details … mention that they need to update the app version and allow notifications … the full details for the active price drops with amount, date, product … (also purchase date and end date). for any expired price drops … (you missed a total of xxx $ on date) … professional email format as a support customer service … sent via the priceback support mailbox: support@priceback.ca with high importance … do it programmatically just in case this happens again … include a signature"*

> **Automatic follow-up (2026-11-07):** `Price_Drop_Reminder_Emails.md` sends a short recap email by itself every 3 days, once per drop, to shoppers with no token, notifications off, or 3+ days away. This page is the detailed one-off campaign, still run by hand.

`Shopper_Reachability_Check.md` flags these shoppers on the admin desk. This script is what you do about them: one email per shopper, from `support@priceback.ca`.

## Who gets an email

Every live account (`status = true`, no deletion requested) with **no push token** (`users.push_token IS NULL`) and at least one drop it was never told about: a `price_drop_notifications` row on a line that is unclaimed, still watched and not deleted. These are the same filters as the pending-claims reminder (`priceDropRepo.pendingClaimRows`), with the token condition reversed: `priceDropRepo.unreachableDropRows`.

A shopper who turned notifications off (`push_permission = 'denied'`) is included. The drop was theirs to claim, and the email asks them to turn notifications on.

## What the email says (`backend/lib/unreachableDropEmails.js`)

| Section | Content |
|---|---|
| Subject | Open drops: *"Action required: $X in price adjustments waiting for you"*. Only missed: *"Your PriceBack price drop alerts could not reach you"*. Sent with high importance (`X-Priority: 1`, `Importance: High`), Reply-To support. |
| Still claimable | Per item: product, Item #, quantity, purchase date, warehouse, price paid, new price, refund, **claim-by date** and days left. If the saving's end date is not confirmed, a note says to claim soon. Then three claim steps, the last one naming the app's own **Mark as Claimed** button. |
| Missed | *"You missed a total of $X in price adjustments; the last claim period closed on <date>."* Then per item: product, purchase date, paid, new price, refund, and the date its claim period ended. |
| Next time | Update the app (store link for the shopper's platform, or both if unknown), allow notifications (path in iOS / Android settings), open the app once. |
| Signature | *Kind regards, The PriceBack Support Team*, support@priceback.ca, priceback.ca, tagline. A service-message footer (not marketing). |

**Open vs missed** is `shared/claimDeadline`, the rule the app's chip and the reminder use, on the shopper's provincial day: the earlier of the store window (purchase + 30 days at Costco) and the saving's last day. **The refund amount** is (unit paid − lowest price announced) × quantity, as in the push, the reminder and the commission.

**Language:** the saved app language (`user_preferences.language`) if it is `en` or `fr`. Otherwise the email is in both languages, with French first for a Quebec shopper.

## Running it

From `backend/`, against production (`railway run` provides `DATABASE_URL`):

```bash
# 1. Dry run (default). Writes NN-<sub>.html / .txt + manifest.json to
#    backend/data/support-emails/<campaign>/  (gitignored: it holds addresses). Sends nothing.
railway run -e production node scripts/emailUnreachableDropShoppers.js

# 2. Test: every email goes to YOUR address, subject "[TEST → shopper@…]". Nothing is logged as sent.
railway run -e production node scripts/emailUnreachableDropShoppers.js --test-to you@example.com

# 3. Send for real.
railway run -e production node scripts/emailUnreachableDropShoppers.js --send
```

Options: `--only <sub,sub>`, `--limit <n>`, `--campaign <name>` (default `unreachable-drops-<YYYY-MM-DD>`), `--out <dir>`, `--delay-ms <n>` (default 3000), `--skip-missed-only`.

**Never twice.** `--send` appends each delivered message to `<out>/sent.jsonl` (sub, address, Message-ID, totals) before it moves to the next, and skips any shopper already in that file. A re-run of the same campaign after a failure sends only to the ones that are missing. A new incident needs a new campaign name (the default changes every day).

## SMTP: the Zoho mailbox

Put these in `backend/.env` (never committed). `railway run` does not override a variable that is already set.

| Variable | Value |
|---|---|
| `SUPPORT_SMTP_PASS` | **Required.** A Zoho *app-specific password* for support@priceback.ca: Zoho Mail › Settings › Security › App Passwords. |
| `SUPPORT_SMTP_HOST` | Default `smtp.zoho.com`. A Zoho account in another data centre uses that centre's host, e.g. `smtp.zohocloud.ca` for Canada (Zoho Mail › Settings › Mail Accounts › SMTP shows the right one). |
| `SUPPORT_SMTP_PORT` | Default `465` (SSL). `587` uses STARTTLS. |
| `SUPPORT_SMTP_USER` | Default `support@priceback.ca`. |
| `SUPPORT_FROM_NAME` | Default `PriceBack Support`. |

The script verifies the SMTP login before it sends anything. `nodemailer` is a **devDependency** of the backend: the server never sends mail.

## Apple private-relay addresses

Shoppers who chose "Hide My Email" have an `…@privaterelay.appleid.com` address. Apple forwards mail to it **only from a sender registered for the team** (Prosoft Inc, 5D2TR5UWGM): Apple Developer › Certificates, Identifiers & Profiles › Services › *Sign in with Apple for Email Communication* › register `support@priceback.ca` (or the `priceback.ca` domain, which needs SPF to pass). Until that is done, those emails bounce. The dry run marks them `(Apple relay)`.

## First run, 2026-11-02 (prod, dry run)

8 shoppers, all on iPhone; 4 behind Apple relay.

| # | Language | Open | Missed |
|---|---|---|---|
| 01 | en+fr | 2 · $18.00 | — |
| 02 | fr | 2 · $6.00 | — |
| 03 | en+fr | 1 · $6.00 | — |
| 04 (relay) | en+fr | 2 · $5.00 | 3 · $12.50 |
| 05 (relay) | fr+en | — | 1 · $4.00 |
| 06 (relay) | fr+en | — | 1 · $4.00 |
| 07 | en+fr | — | 1 · $4.00 |
| 08 (relay) | fr | — | 1 · $2.00 |

Code: Priceback PR *ops/email-unreachable-drop-shoppers*. Tests: `backend/tests/unreachableDropEmails.test.js` (no DB), `backend/tests/unreachableDropRowsDb.test.js` (dev DB).
