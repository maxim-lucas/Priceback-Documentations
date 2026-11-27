# Home promo banner: running an event

Design: `Technical/Home_Promo_Banner_Design.md`. Rules table: `Technical/Promo_Codes_Design.md` ("Home banner + approved push").

## Run the next event

1. **The row.** `app_config` key `HOME_PROMO`. For a new event, edit the value (new `id`, `code`, `startsAt`, `endsAt`,
   EN + FR `title` / `body` / `cta`); a new `id` is a new campaign (a push can go once per `id`).
   First event: `cd backend && node scripts/seed-home-promo.js` is a dry run that prints the JSON (it reads the row, so it
   needs a database); `--write` stores it with `enabled: false`. It never overwrites an existing row.
   The end is exclusive: end at 00:00 Toronto of the day after the last day (Cyber Monday 2026 = `2026-12-01T05:00:00.000Z`).
2. **Enable.** Admin → Promo codes → Home banner → switch on. The admin card reads the row fresh from the database, so a
   hand edit shows at once; shoppers' phones read the cached snapshot, so a change can lag up to about 5 minutes on a
   server instance that did not take the write.
3. **Preview the push.** Admin → Promo codes → **Promo push** → **Preview push**: counts (accounts, consent, eligible, will
   send, skipped by reason, build split, minimum app version), the exact EN and FR copy, and a preview token (valid
   30 minutes, tied to the count, the exact shoppers and the copy). Nothing is sent. With nobody to send to no token is
   issued and **Approve** stays disabled.
4. **Approve.** **Approve and send to N shoppers** is disabled until a preview exists and is sent with THAT preview's
   token; a confirmation repeats the count. The ledger row is written before the first push; a second send of the same
   campaign is refused (`already_sent`). A changed count, copy, shoppers or campaign, or a preview older than 30 minutes,
   makes the token stale: the screen says so in plain English; preview again. A send with zero recipients is refused
   (`nobody_to_send_to`) and does not use up the campaign.
5. **After the end** nothing needs doing: `isLive` turns the banner off on `endsAt`. Switch it off earlier in Admin.

## What each skip reason means (push preview, "skipped by reason")

| Reason | Meaning |
| --- | --- |
| `deleted_account` | the account is erased or may not be contacted |
| `no_push_token` | no valid Expo push token |
| `no_consent` | no marketing-push consent: only shoppers who granted it receive the push |
| `subscriber` | a subscription is in force (`isCreditExempt`): never marketed to |
| `store_country` | no Canadian province on the account (see below) |
| `had_subscription` | ever subscribed (BLACK is for first subscriptions, same rule as `accountEligibility`) |
| `old_or_unknown_build` | last stamped build is below 3.6.5 or unknown: it cannot enter a code |
| `notifications_off` | the device has notifications off |
| `unreadable` | the ever-subscribed read failed: skipped, never guessed |

## Why the filters

- **Canadian province:** the server stores no store country (the phone sends it per request only; `users.country_id`
  defaults to CA and proves nothing). The account's province (set from a postal code) is the strongest signal held, so no
  province or a non-Canadian one is skipped (conservative). Follow-up: store the phone's `storeCountry` on the account
  and use it in the push audience.
- **3.6.5+ build:** the code entry and the `home-promo` / `promo-code` caps first ship in 3.6.5; an older build would
  show a push it cannot act on.
- **Consent:** only the marketing-push ledger grants; no other path may send this push.

## Migration 0068 (`home_promo_pushes`)

Apply to dev, then to prod by hand BEFORE the code deploys to `main`. Then move `0068_home_promo_pushes` into
`PROD_LEDGER` in `backend/tests/migrationJournalLedger.test.js` (`[1796200000000, first 12 hex of its LF sha256]`) and
empty the "owed" list there.

## Not done / follow-ups

- Store the phone's `storeCountry` on the account for the push audience.
- The BLACK `promo_codes` row is not touched by any of this.
