# Production test-data purge — 2026-08-30

**Status: DONE. Irreversible — executed as direct SQL, by explicit instruction.**
A full pre-delete snapshot of every affected row was captured (see *Snapshot*
below). This document plus that snapshot are the only record.

Target: Supabase project `xjfrlzwonyaorwktnkpj` (production), schema `priceback`.

Follows on from `Production_Test_Data_Purge_2026-08-18.md` — same class of debris,
new instances created since.

---

## Why

Every release since 2026-08-17 is smoke-tested by signing into the **real app**
with throwaway Google accounts. Each one writes a `priceback.users` row on
production with a real OAuth `sub` and a real gmail address. They carry **no test
marker**, so `scripts/purge-test-data.js` (which matches only the reserved `qa-`
/ `@priceback.test.ca` markers) cannot see them. Seven had accumulated.

`postal_code IS NULL` was the only thing they visibly had in common — and that is
**not** a safe filter on its own: a real shopper who signs up and closes the app
before setting a location looks identical. The classification below is
behavioural, not field-based.

---

## What was deleted

7 `users` rows + 7 cascaded `credit_ledger` rows (each account's untouched
75-credit trial grant) + 2 cascaded `consent_events`. Nothing else — verified
before (blast-radius query) and after (0 orphans).

| Table | Before | After |
|---|---|---|
| `users` | 15 | **8** |
| `credit_ledger` (these subs) | 7 | **0** |
| `consent_events` (these subs) | 2 | **0** |
| everything else | — | untouched |

### The accounts

```
114546765639804049434  heidistephens.89937@gmail.com
111978918163305695747  tylergutierrez.61864@gmail.com
118364612889517792438  sharobimmonica@gmail.com          ← see note
110538922022002153278  chestermorton.50376@gmail.com
109987063493594187655  mirandarivera.40208@gmail.com
110786955190728286745  jeffflowers.93067@gmail.com
105710193495301658182  emilyray.84575@gmail.com
```

Six use the `firstnamelastname.#####@gmail.com` generated-account pattern — the
same closed-testing-tester signature the 2026-08-18 purge documented. All seven:
0 devices, 0 sessions, 0 receipts, 0 subscription events, 0 topup refs, no
province, no postal code; only the automatic 75-credit trial grant.

**The timeline is the confirming evidence.** Every burst lands 1–2 h after a
release tag was cut (times UTC):

| Release | Tag cut | Accounts created |
|---|---|---|
| v2.8.9 | 08-17 13:52 | 1 @ 15:47 |
| v2.8.11 | 08-19 18:49 | 3 @ 19:51–20:00 (within 9 min) |
| v2.8.12 | 08-21 21:19 | 3 @ 22:45–22:49 (within 5 min) |

### Note on `sharobimmonica@gmail.com` (`118364612889517792438`)

The 2026-08-18 purge **deliberately kept** this account (its "Kept" list names
"*both `monicasharobim`/`sharobimmonica` accounts*"). It was deleted on this pass
anyway, and Maxim confirmed leaving it deleted:

- It is a **second** Google account for the same person. The real one,
  `monicasharobim@gmail.com` (`100405705438…`), is untouched — it has a postal
  code (`J0N 1P0`) and a device.
- 13 days after creation `sharobimmonica@` still had zero postal code, zero
  devices, zero sessions, zero receipts — it never became real usage.

If that person reopens the app on `sharobimmonica@` they get a fresh account and
a fresh 75-credit grant; the deletion does not block them.

---

## Snapshot / restore

`scratchpad/smoke-test-purge-backup-2026-08-30.json` (session scratchpad) holds
every deleted row in full — `users`, `credit_ledger`, `consent_events`. Restore
order: `users` first, then the children. The push tokens and referral codes are
in there too.

---

## The recurrence guard

New this session — `chore/purge-stale-abandoned-signups` (PR pending):

- **`backend/lib/staleSignups.js`** — the fingerprint as a shared SQL predicate
  (`fingerprint()`), `findStaleSignups(db)`, `purgeStaleSignups(db, {dryRun,
  minAgeHours, maxDelete})`. Refuses when the match count exceeds `maxDelete`
  (default 50). The DELETE re-applies the whole predicate, not just the id list.
- **`backend/scripts/purge-stale-signups.js`** — CLI, **dry-run by default**
  (opposite of `purge-test-data.js`), `--write` to act, `--min-age-hours` /
  `--max` overrides. `npm run db:purge-stale-signups`.
- **`backend/tests/purgeStaleSignups.test.js`** — guard rails (age floor,
  maxDelete ceiling issues no DELETE, dry-run default) always run; DB-gated half
  seeds one matching account + five controls that each break one clause.
- **Runbook** — `Release_Tagging_And_Repo_Management.md` §4b: run it against
  production as the last step of every release.

**Deliberately not a cron.** An autonomous process that hard-deletes from the
`users` table on a heuristic is exactly what removed a real (kept) account on
this pass. It stays operator-run.

---

## If this needs doing again

The durable rules from 2026-08-18 still hold (classify by reference *shape* not
count/date; children before parents; read `information_schema` FK rules first).
Additions from this pass:

1. **Cross-check every candidate against the previous purge doc's "Kept" list.**
   `sharobimmonica@` was on it; that should have been caught before the DELETE,
   not after.
2. **`postal_code IS NULL` is a starting point, never the filter.** The
   discriminator is *no engagement footprint at all* — the `staleSignups.js`
   fingerprint. A single NULL field is not evidence.
3. **Take a snapshot first.** One `json_build_object` over the target rows +
   children, saved to a file, costs nothing and makes the delete reversible.
