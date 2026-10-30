# Shopper reachability check

**Can a push (and, on iPhone, a background sign-in) reach each shopper? When one cannot, is that the shopper's choice or our failure?**

Added 2026-10-30 (Bugs #357). That day 20% of active shoppers had no push token, and 9 of the 41 who had a price drop in the last 30 days were never told about it. Nothing in the system said so for a month. This check exists so the next cause is seen within a day.

## Where it shows

| Surface | What you see |
|---|---|
| **Admin → home → Needs action** | *Price drops that reached nobody* (count of drops, last 30 days) and *Shoppers we should reach and can't* (count of shoppers with a critical flag). Both open Incidents. |
| **Admin → Incidents → Can we reach shoppers** | A one-line verdict, then every flagged shopper, worst first: device, version, the worst problem in plain words. Tap a shopper to open their account. |
| **`GET /health?token=…`** | `checks.reachability`: counts, `status` (`ok` / `degraded`) and the first 20 flagged shoppers (sub cut to 8 characters). Admin view only. It never changes `healthy`, so one shopper cannot fail Railway's deploy gate. |

All three read one rule, `backend/lib/shopperReachability.js`, so they cannot disagree.

## The rule

**Push** (needs `users.push_token`; the permission comes from 3.4.1+ builds in `users.push_permission`):

| Verdict | Meaning | Severity |
|---|---|---|
| ok | Token on file, permission not "denied" | none |
| declined | The shopper turned notifications off | info (their choice) |
| token_missing | Permission **granted**, no token | **critical** (always ours) |
| never_asked | The OS prompt was never answered | warn |
| unreported | No token, no permission on file (build before 3.4.1) | warn |

**A price drop** recorded (`price_drop_notifications`, last 30 days) for a shopper whose push is not `ok` reached nobody: **critical**, unless the shopper declined (info).

**Sessions:** first-party sessions are **iOS only by design** (`authService._sessionsSupported`); Android uses Google's silent re-sign-in. Android without a session is normal. **An iPhone without a live session is critical**: background price checks and the token back-fill cannot sign in. No platform on file and not an Apple account (Android before 3.0.7) is not judged.

**First hour:** a new account's push and session flags are info for 60 minutes (the token and the session land seconds to minutes after sign-up, and a shopper who stops in onboarding has not been asked). A drop that reached nobody is never excused.

## What to do with a flag

- **token_missing:** our bug. Look at Sentry `flow: push_token_mint` and `push_token_sync` for that build. Check the Expo project id and APNs/FCM credentials (`eas credentials`).
- **untold_drops on an old build (unreported):** the shopper needs 3.4.1+. The Home card will then offer the prompt or Settings.
- **session_missing on iPhone:** read the shopper's sign-in refusals on the same Incidents screen, then the account's sessions in the Shopper report.
- **A sudden rise in any count after a release** is a regression in that release.

## Deploy order (migration 0042)

`push_permission` / `push_permission_at` come from migration **0042_push_permission** (numbered 0042 because `main-test-features` already has 0041). The backend that reads them selects them on every users read, so **apply 0042 to prod before deploying it** (prod's drizzle ledger is hand-maintained; insert the ledger row with the file's LF hash). Until then the check answers "did not answer", never all-clear.
