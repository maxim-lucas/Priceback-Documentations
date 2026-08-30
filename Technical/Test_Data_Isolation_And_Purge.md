# Test-data isolation and purge

**Since 2026-08-30.** Every row the backend `node:test` suites write is tagged by
a reserved marker, and every run purges all of it — pass, fail, or crash. This
replaces the old "find leftover test users with `WHERE postal_code IS NULL`"
heuristic and the ~60 per-file `after()` hooks that each swallowed their own
deletes.

Related: `Operations/Production_Test_Data_Purge_2026-08-18.md` (the one-off prod
purge this systematises), `Operations/Bugs_Common_Fixes.md` #226.

## The reserved markers

Defined once in `backend/tests/helpers/uniq.js` — nothing else hardcodes them.

| kind | marker | builder |
|---|---|---|
| `users.sub`, `devices.device_id`, `receipts.id`, `price_points.source_ref`, `topup_refs.ref`, `*.device_hash` | prefix `qa-` | `testSub` / `testDeviceId` / `testReceiptId` / `testSourceRef` / `testTopupRef` / `testDeviceHash` |
| `users.email` | domain `@qa.priceback.test` | `testEmail(sub)` |
| `products.sku` | 8 digits, leading 5–9 (`^[5-9][0-9]{7}$`) | `testSku()` |
| `warehouses.code` | 4 digits, `9000–9999` (`^9[0-9]{3}$`) | `testWarehouseCode()` |

`.test` is an RFC-2606 reserved TLD and `9000–9999` is above every real Costco
warehouse code (they stop at 8099), so no real row can collide.

**Transitional matchers** — `LEGACY_SUB_PREFIXES` / `LEGACY_EMAIL_DOMAINS` in the
same file list the pre-`qa-` prefixes (`test-`, `seed-`, `pdwin-`, …) and
`@example.com` / `@test.local`. The purge sweeps them too, so it is effective
before any test file is migrated. A prefix comes off the list once no file uses
it.

## The purge

`backend/tests/helpers/purgeTestData.js` — `purgeTestData(db, { dryRun })`.
Deletes in FK-safe order (children first; `users` mid-list so its cascade clears
the user-scoped tables; `products` after `users` so no `receipt_items` row
blocks it via `ON DELETE RESTRICT`):

`tag_scan_reviews → auth_outcomes → topup_refs → users (cascade) → devices →
price_points → products → warehouses`

**`products` is only deleted when `barcode IS NULL`** — a barcode↔SKU link is
worth keeping with no price attached, and the 2026-08-18 purge showed an
unqualified band delete takes real catalog rows. This is the one predicate with
a safety clause; `tests/purgeTestData.test.js` guards it and every other.

**Known gap:** `auth_outcomes` rows from a rejected token have `user_sub IS NULL`
and no marker — left in place (anonymous, negligible).

## How it runs

`node:test` has no global teardown and CI must run a bare `npm test`
(`__tests__/ciParity.test.js`), so the wrapper `backend/scripts/run-suite.js` is
where the always-purge step lives:

```
npm test          → c8 node scripts/run-suite.js     (coverage gate)
npm run test:fast  → node scripts/run-suite.js
```

`run-suite.js`: clean-slate purge → spawn `node --env-file=.env --env-file=test.env
--test --test-concurrency=1 tests/*.test.js` (inherits `NODE_V8_COVERAGE` from the
outer `c8`) → **`finally`** purge → exit with the suite's code. It refuses a prod
`DATABASE_URL` explicitly (its own argv has no `--test`, so `db/client`'s guard
would not fire).

## The standalone CLI

```
node --env-file=.env backend/scripts/purge-test-data.js            # purge, using .env
node --env-file=.env backend/scripts/purge-test-data.js --dry-run  # count only
DATABASE_URL=<prod-url> node backend/scripts/purge-test-data.js --dry-run
```

**No production guard, by design** — this is the deliberate, outside-the-test-
runner tool for cleaning any database. It replaces the ad-hoc `WHERE postal_code
IS NULL` query. `npm run db:purge-test-data` is the shortcut.

## Adding a new table to the purge

1. If test code writes rows there, make sure every id it writes comes from a
   `uniq.js` `test*` helper (or the SKU/warehouse bands).
2. If the table has no `users` FK (or the FK is `SET NULL`), add a step to
   `steps()` in `purgeTestData.js` — `prefixMatch(sql\`the_marker_column\`)`,
   ordered before whatever it references.
3. Add both halves (swept / real row survives) to `tests/purgeTestData.test.js`.
