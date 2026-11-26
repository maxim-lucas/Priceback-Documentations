# Account deletion: the 30-day window, the erasure, and what survives

**Rule (Maxim, 2026-11-26).** A deleted account can be restored for 30 days (`DELETION_GRACE_DAYS`). After that
nothing of it is reachable: not restorable, its data gone, and a new signup on the same address is a brand-new
account, except for ONE flag: that this address already consumed a free package (`credits` or `week`).

## One function, two callers
`usersRepo.eraseAccount(sub, { cutoff })` (backend/repos/usersRepo.js), in ONE transaction:
1. selects the tombstone (status false, `deletion_requested_at` before the cutoff), locked;
2. writes `consumed_trials` (sha256 of the normalised address + `trial_type`: `credits` when the free credits were
   collected, else the recorded choice `week`/`credits`), only for a real address that took a trial;
3. deletes the `users` row (FK cascade removes receipts, ledger, sessions, device claims).

Callers: the **daily** purge (`jobs/purgeDeletedAccounts`, cron `0 4 * * *`; it was monthly, so a deleted account
was restorable up to two months) and `upsertFromOAuth` (a sign-in after day 30 erases first, then signs up fresh).
The window is `usersRepo.deletionGraceMs()`; `isPastDeletionWindow` is the one test of it.

## The flag
`priceback.consumed_trials` (migration 0066): `email_hash` PK, `trial_type`, `consumed_at`. Read only by
`usersRepo.emailEverGrantedTrial` (beside the live rows), which the signup grant, the trial-choice route and
GET /api/me already call, so a re-signup after erasure gets no free credits and no second free week offer.
No route returns it. Never the address itself.

## Old builds
Additive: new table, same routes. A sign-in after day 30 used to restore the account; it now creates a new one
(the intended change, same response shape).

## Tests
`backend/tests/accountErasureDb.test.js`, `purgeDeletedAccounts.test.js`, `migrationJournalLedger.test.js` (0066 pinned).

## Prod, 2026-11-26
0066 applied by hand (+ ledger row). thomas.belji@gmail.com and sandra.lucas.designs@gmail.com erased by SQL
(users cascade + auth_outcomes, promo_credit_grants): no flag left, so both can test the free week.
Apple/Google free-trial eligibility is per store account, not ours: a store account that already used the
introductory offer stays ineligible there (use a fresh sandbox/tester account for that half).
