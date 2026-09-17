# Migration consolidation + store-set sync (2026-07-26)

Squashed the drizzle migration chain `0000..0009` into a single baseline
migration, and brought both deployed databases in line with the repo's intended
store set: **Costco live, five "coming soon"** (Best Buy, The Source / Best Buy
Express, Home Depot, Rona, Sport Chek).

Related: [database-schema.md](database-schema.md), [Supabase_Cutover.md](Supabase_Cutover.md).

## Why

Two separate problems, fixed together:

1. **The chain had accumulated churn.** `api_audit_log` was created in `0000` and
   dropped in `0008`; three later migrations only added columns; two were
   one-shot data backfills. A fresh provision replayed all of it.
2. **Both databases were behind the repo, and users saw it.** Migration `0009`
   had never been applied to either environment. Both still carried the legacy
   20-retailer set with "Canada" wording (`Costco Canada`, `Best Buy Canada`, …).
   Because the mobile client's freshness gate is the monotonic `rev` token and
   `_runtimeRev` starts empty, the remote payload *always* wins on first launch —
   so the stale 20-store list is what users actually saw, not the 6-store
   bundled fallback in `src/constants/stores.js`.

## What changed in the repo

| Path | Change |
| --- | --- |
| `backend/db/migrations/0000_initial.sql` | Consolidated baseline (39 tables) |
| `backend/db/migrations/0001..0009*.sql` | Deleted (folded into the baseline) |
| `backend/db/migrations/meta/0000_snapshot.json` | Final-state snapshot, `prevId` re-rooted to zeros |
| `backend/db/migrations/meta/0001..0009_snapshot.json` | Deleted |
| `backend/db/migrations/meta/_journal.json` | Single entry, original `when` retained |
| `backend/db/deploy/schema.sql` | Regenerated from the single migration |
| `backend/db/deploy/store-content-sync.sql` | New — re-sync stores from `policies.json` |
| `backend/db/schema.js` | Two stale comments corrected |

### How the baseline was built

* Objects created and later dropped never appear: `api_audit_log` and its two
  FKs and three indexes are simply absent.
* Columns added by later migrations are declared inline on their tables:
  `receipts.purchase_type_id` (0003), `user_referrals.settled_at` (0006),
  `users.costco_membership_type` (0007).
* Tables introduced later are declared normally: `job_runs` (0001),
  `credit_reconciliations` (0002), `purchase_types` (0003), `topup_refs` (0006).
* Data-only steps were **deliberately not carried over** — the 0006 backfills and
  the whole of 0009 only ever mattered for databases that already held rows. A
  fresh database gets correct content from `seed.js` / `data/policies.json`.

### Schema drift that got fixed

`priceback.touch_updated_at()` and the `stores_touch_updated_at` trigger existed
in both deployed databases but in **no migration file**. Any database provisioned
from the repo would have silently lacked them — and since the payload's `rev` is
`max(updated_at)` across store rows, a hand edit via SQL would never have
reached the app. Both are now created by `0000_initial.sql`.

## Why this is safe for existing databases

The journal keeps the baseline's original `when` of `1783812680139`.
`drizzle-kit migrate` applies a migration only when its `folderMillis` is
**greater** than the newest applied `created_at`. Both environments sit at
`1785110400000` (0009), so they skip the baseline entirely. Only a brand-new
database runs it.

> **Consequence to be aware of:** a database still at `0008` or earlier would now
> skip straight past the content fixes that used to live in `0009`. Both
> environments were brought to `0009` *before* the squash precisely so this
> cannot happen. Any other database must be re-synced with
> `db/deploy/store-content-sync.sql`.

## What was applied to the databases

Both `Priceback-dev` and `Priceback-app` (prod), in this order:

1. `CREATE TABLE priceback.stores_backup_pre_consolidation AS SELECT * FROM priceback.stores` (27 rows each).
2. Migration `0009` SQL, plus its ledger row
   (`hash 7fa61c20…`, `created_at 1785110400000`) so both sit at the pre-squash head.
3. `db/deploy/store-content-sync.sql`.

Result in both environments, identical:

| Metric | Value |
| --- | --- |
| Consumer-facing stores | 6 |
| Active (`enabled`) | 1 — Costco |
| Coming soon | 5 — Best Buy, The Source, Home Depot, Rona, Sport Chek |
| Legacy stores hidden (`visible=false`) | 14 |
| Stale "Canada" names in payload | 0 |
| Payload `updatedAt` | 2026-07-25 |

The 14 legacy retailers were **hidden, not deleted** — they remain FK anchors for
`products` / `warehouses` / `receipts`, and hiding is reversible. Operational-only
rows (`short_name IS NULL`, e.g. metro/loblaws) were untouched; the
`storePoliciesRepo` filter already excludes them.

### Cleanup

`priceback.stores_backup_pre_consolidation` (27 rows) was kept in both databases
as a rollback net and **dropped from both on 2026-07-27** once the result was
confirmed. The pre-change state it held is recorded in the appendix below, so
the `enabled` / `visible` / naming values remain recoverable without it.

## How the baseline was verified

The consolidation itself was done on a machine with no `node`, so the first
round of verification compared the baseline against the live production schema
directly:

| Check | Baseline | Production | Result |
| --- | --- | --- | --- |
| Tables | 39 | 39 | match |
| Columns (SHA256 of sorted `table.column`) | `c34c519d…` | `c34c519d…` | match |
| FK constraint names (SHA256) | `f9ba5fa6…` | `f9ba5fa6…` | match¹ |
| Index names (SHA256) | `f6291b3b…` | `f6291b3b…` | match |

¹ after applying Postgres's 63-char identifier truncation to
`user_notification_settings_notification_type_id_notification_types_id_fk` (72
chars) — pre-existing behaviour, not introduced here.

The one hand-written block (the function + trigger) was executed for real against
dev inside a transaction: it created cleanly and did bump `updated_at` on UPDATE.
The transaction was rolled back.

### Follow-up verification (2026-07-28, node 24.18.0 installed)

* `npx drizzle-kit check` → *Everything's fine*. The collapsed journal and the
  re-rooted `0000_snapshot.json` are internally consistent; `check` reads only
  local files, so it was run with a dummy `DATABASE_URL`.
* Root jest suite: **141 suites / 3072 tests green**, coverage ratchets met.

**Still not verified:** an end-to-end run of the full baseline against a
genuinely empty database. `drizzle-kit check` validates the chain's metadata,
not that the SQL executes — the schema-level equivalence above is the evidence
for that, and a real fresh provision remains the only complete proof.

`backend/`'s own 103-file `node:test` suite was **not** run: it needs
`backend/.env` (gitignored) and executes against the live dev database.

## Standing gap this surfaced

`seed.js` inserts stores with `onConflictDoNothing`, so it only ever populates an
**empty** table. Any future edit to `data/policies.json` will *not* reach an
already-seeded database. Use `db/deploy/store-content-sync.sql` (regenerate it
from `policies.json` rather than hand-editing) whenever store content changes.

## Appendix — store state before the sync

Contents of `stores_backup_pre_consolidation` (identical in both environments),
captured before the backup table was dropped. Every one of these rows still
exists in `priceback.stores`; only `name`, `enabled` and `visible` changed. To
undo the sync, restore these values by `code`.

| code | name | short_name | enabled | visible |
| --- | --- | --- | --- | --- |
| basspro | Bass Pro Shops | Bass Pro | f | t |
| bestbuy | Best Buy Canada | Best Buy | f | t |
| canadiantire | Canadian Tire | CT | f | t |
| costco | Costco Canada | Costco | **t** | t |
| homedepot | Home Depot Canada | Home Depot | f | t |
| iga | IGA | — | f | t |
| ikea | IKEA Canada | IKEA | f | t |
| leons | Leon's | Leon's | f | t |
| loblaws | Loblaws | — | f | t |
| londondrugs | London Drugs | London Drugs | f | t |
| lowes | Lowe's Canada | Lowe's | f | t |
| marks | Mark's | Mark's | f | t |
| maxi | Maxi | — | f | t |
| metro | Metro | — | f | t |
| oldnavy | Old Navy / Gap | Old Navy | f | t |
| provigo | Provigo | — | f | t |
| rona | RONA | RONA | f | t |
| sameday | Sameday | — | f | t |
| sleepcountry | Sleep Country | Sleep Country | f | t |
| sportchek | Sport Chek | Sport Chek | f | t |
| staples | Staples Canada | Staples | f | t |
| superc | Super C | — | f | t |
| thebrick | The Brick | The Brick | f | t |
| thesource | The Source / Best Buy Express | The Source | f | t |
| toysrus | Toys R Us Canada | Toys R Us | f | t |
| visions | Visions Electronics | Visions | f | t |
| walmart | Walmart Canada | Walmart | f | t |

Rows with `short_name` = — are operational-only and never reach the payload.
The 20 consumer-facing rows other than the six kept are now `visible=false`.

---

## How to tell whether a database is actually up to date (2026-09-16)

**Do not answer this from `drizzle.__drizzle_migrations`.** On prod that ledger is
hand-maintained, and it has drifted from the journal in a way that makes a
ledger-to-journal comparison actively misleading. Measured on 2026-09-16:

| | prod `xjfrlzwonyaorwktnkpj` | dev `gnedluuylimjwdmtvswl` |
|---|---|---|
| ledger rows | 16 (ids 2–17) | 15 (ids 16–30) |
| `created_at` values matching the journal's `when` | **not a match** | mostly |
| rows prod has that dev does not | `1785835800000`, `1785835801000`, `1786950000000` | — |
| rows dev has that prod does not | — | `1785832689803`, `1785839698865` |

Two of prod's rows are round numbers one second apart (`…35800000`,
`…35801000`), which is what a hand-inserted pair looks like. Read naively, that
table says the two databases are several migrations apart. **They are not.**

### The check that is actually true

Compare the **schema itself**, with one fingerprint per database:

```sql
select md5(string_agg(table_name||'.'||column_name||':'||data_type,
                      ',' order by table_name, column_name)) as schema_fingerprint,
       count(*) as columns,
       count(distinct table_name) as tables
from information_schema.columns
where table_schema = 'priceback';
```

Run it on both. Equal fingerprints mean equal schemas, whatever the ledgers say.

**Result on 2026-09-16 — identical on both:**

```
schema_fingerprint = d2c25ddad5811a5a1bab12868333f6cb
columns = 357     tables = 44
```

So **prod had zero pending migrations**: it is current through `0006_auth_outcomes`,
and the whole `0000..0006` chain is present on both. Any future claim that "prod is
behind" should be tested this way before anything is applied.

When the fingerprints differ, localise it by dropping the `md5(...)` and diffing
the two `table.column:type` lists, then probe the specific objects each migration
creates — e.g. `to_regclass('priceback.auth_outcomes')` for `0006`.

### One trap worth keeping

Probe the object a migration **actually** creates, not the one its filename
suggests. `0003_sandbox_purchase_tagging` reads as though `subscription_events`
gets `subscription_is_sandbox`; it does not. The real DDL is:

```sql
ALTER TABLE priceback.users              ADD COLUMN subscription_is_sandbox boolean ...
ALTER TABLE priceback.credit_ledger      ADD COLUMN is_sandbox              boolean ...
ALTER TABLE priceback.subscription_events ADD COLUMN is_sandbox             boolean ...
```

A first pass probed `subscription_events.subscription_is_sandbox`, got `false` on
**both** databases, and briefly looked like a real gap on prod. Read the migration's
DDL before trusting the probe — a false "prod is missing a column" is how someone
talks themselves into running DDL against production that it does not need.

### 0007 applied by hand, 2026-09-16 — and the hash trap

`0007_device_owner_claimed_at` was applied to **both** databases before its code
merged, because prod's ledger is hand-maintained and `db:migrate` is never run
there. Additive and idempotent (`ADD COLUMN IF NOT EXISTS` + a guarded backfill).

Result — prod `xjfrlzwonyaorwktnkpj`: 7 devices, all 7 owned, all 7 stamped, 0
unstamped; 189 crowd rows untouched; ledger 16 rows -> 17. Fingerprints identical
on both afterwards: `3cc4b48958b2522fb2da62362f3f0743`, **358 columns**, 44 tables
(357 before).

**The ledger hash is the LF-normalised digest, and getting that wrong is easy on
Windows.** drizzle hashes the migration file's RAW BYTES
(`createHash("sha256").update(readFileSync(path).toString())`), so a CRLF working
copy produces a different hash than the LF one a Linux checkout sees — and `main`
has no `.gitattributes`, so a Windows checkout is CRLF.

Verify against ground truth rather than guessing: prod's existing `0006` row is
`1e7d6a08…`, which is exactly that file's **LF** hash; its CRLF hash
(`8261f419…`) matches nothing. So:

```js
const lf = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
crypto.createHash("sha256").update(lf).digest("hex");
```

`0007` = `ff29ad70e029d924ca29a9c875370fc5b165da137f0f00f556ac812bf8fd2b55`.
Insert guarded by `where not exists (... where hash = ...)` so re-running is safe.
