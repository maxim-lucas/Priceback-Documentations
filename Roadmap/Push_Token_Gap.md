# Accounts with no push token (later, not started)

**Status:** documented for later (Maxim, 2026-11-10): *"we still have users without push tokens today even after the
fix"*. Not part of Store Spaces v2.

## What is known

- Prod still has shoppers with no registered push token after the earlier fixes. Eight of them with price drops were
  emailed by hand on 2026-11-02 (`Operations/Unreachable_Shopper_Drop_Emails.md`).
- A missing token has more than one cause: the shopper denied the OS prompt, registration failed after a grant
  (network, FCM/APNs, an expired project credential), or the build predates registration on that path.

## To do

1. Measure per account and per reported build (`X-App-Build`): permission status vs token present, so "denied" and
   "registration failed" are counted separately.
2. Fix registration where it fails after a grant (retry, re-register on launch when the token is missing).
3. Re-ask shoppers who denied, through the compliant pattern (custom UI only after a denial, with a route to Settings).
4. Store Spaces v2 already adds: Android requires notifications at account creation; every receipt scan with
   notifications off shows the price-drop-alerts popup (`Technical/Store_Spaces_v2_Design.md` §16).
