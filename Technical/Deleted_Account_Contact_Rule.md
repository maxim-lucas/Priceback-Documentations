# Deleted accounts: never contacted

**Rule (Maxim, 2026-11-09):** *"a deleted user (requested by user) having all his data wiped, should never receive
notifications, emails (reminders, price drops, ...etc). … the only emails that can be sent for these users (why did you
leave the app for feedback with a possible free trial week once implemented)."*

A deleted account is the tombstone `usersRepo.requestDeletion` leaves: `status = false` and a
`deletion_requested_at` stamp. It lives 30 days before `purgeExpiredDeletions` removes it, and signing back in during
that time revives it (`upsertFromOAuth` with `reactivate`).

## How it is enforced

One rule, `backend/lib/accountReach.js`:

```js
mayContact(row, purpose)   // false for a deleted account, unless purpose is in DELETED_ACCOUNT_PURPOSES
DELETED_ACCOUNT_PURPOSES   // ["exit_feedback"] and nothing else
```

It is asked **at the moment of sending**, not only when recipients are picked. A notice can be drafted, queued or
approved before a deletion and leave after it.

| Path | Where | What a deleted account gets |
| --- | --- | --- |
| Every user push (approvals desk, tag credit, referrals, reminders, nudges, update reminder) | `server.js` `sendUserPush` | nothing |
| Price-drop alerts (queue drain) | `priceDropNotifier._deliver` | the drop is closed as superseded: no charge, no record, no push, no retry |
| Price-drop recap email | `jobs/dropReminderEmails.js` (+ `dropReminderEmailRepo.accountOf`) | not emailed; a failed re-check holds the email |
| Push token saved by a phone still signed in | `usersRepo.updateProfile` | the token is not stored (`CASE WHEN deletion_requested_at IS NULL`) and nobody else's is released |

These sit on top of the recipient filters that already existed: deletion clears `push_token`, soft-deletes the
receipts that drop detection reads, and every email query has `deletion_requested_at IS NULL`.

**Adding a new message kind:** route it through `sendUserPush` or call `accountReach.mayContact` yourself right before
sending. The exit-feedback email, when it is built, passes `purpose: "exit_feedback"`. It is the only purpose a
deleted account accepts. Add another only with Maxim's approval.

## Open: collecting missed drops during the 30 days

Maxim also asked that a deleted shopper *"can cumulate the price drops as missed price drops in his account while his
data are in the 30 days window"*. **This is not built yet.** It needs his decisions, because today:

1. **Revival brings back credits only, not receipts.** `requestDeletion` soft-deletes every receipt
   (`deleted_by_type = account_deletion`). Signing back in restores the balance (within
   `CREDIT_RESTORE_GRACE_HOURS`) but leaves the receipts deleted, so a returning shopper has no lines to show drops
   on.
2. **Drop detection skips soft-deleted receipts** (`rc.deleted_at IS NULL` throughout `priceDropRepo`), and a drop
   is also a commission charge at detection.

Building it means: (a) revival restores the `account_deletion` receipts and their items; (b) detection keeps
watching those lines during the window, recording each drop silently as "missed" (no push, no email, **no charge**:
the balance is zeroed); (c) the app shows them on return. Points (a) and (b) touch the deletion promise in the
privacy policy and the money path, so they wait for Maxim.
