# The admin console, and cleaning production safely

**Since 2026-09-09.** One admin console in the app: a guarded full-database
cleanup, a per-shopper report, an incident view, and a landing screen that says
whether anything needs a person. Reached from Profile → **Admin console**, which
replaces the seven flat admin rows that used to sit there.

Related: `Production_Test_Data_Purge_2026-08-18.md` and `_2026-08-30.md` (the two
manual purges this systematises), `Technical/Test_Data_Isolation_And_Purge.md`
(the marker scheme it reuses), `Release_Tagging_And_Repo_Management.md` §4b (the
CLI step, which stays).

---

## Why it exists

Production had been cleaned by hand twice. Both passes were ad-hoc SQL with no
undo, and the second one **deleted an account the first had deliberately kept**,
because nobody re-read the earlier Kept list before the DELETE.

The guards those sessions produced are real but partial. `lib/staleSignups.js`
sees abandoned accounts. `helpers/purgeTestData.js` sees marker-tagged rows. Each
needs a laptop with a production `DATABASE_URL` pasted in by hand, and neither
answers the question that actually matters: *what is in this database that should
not be?*

Separately, three things already existed and none was reachable from anywhere:
`/health` computes a full dependency and quota payload on every ping that nothing
rendered; `auth_outcomes` has had `recent()` and `summary()` since Bugs #205 with
no read endpoint; and an admin could **change** a shopper's balance but could not
**read** their ledger.

---

## The cleanup registry

`backend/lib/dataCleanup.js` declares; `backend/lib/dataCleanupRunner.js`
executes. 26 classifiers across seven sections. Each knows how to count itself,
sample itself and delete itself.

| Section | Safety | What it is |
|---|---|---|
| `test_markers` | marker | The 8 steps of the shared marker sweep, generated from `lib/testDataMarkers.js` rather than restated |
| `fixture_residue` | marker | Pre-marker fixtures the sweep structurally misses: `source_ref` prefixes, `wh-` warehouse codes, `dev_` top-ups, orphan products |
| `internal_accounts` | heuristic | Accounts on a `@priceback.ca` address |
| `abandoned_signups` | heuristic | `staleSignups.fingerprint()`, reused verbatim |
| `store_review_accounts` | heuristic | Play Console (`<name>.<5 digits>@gmail.com`) and App Store Connect Cloud Test Lab (`@cloudtestlabaccounts.com`) review-fleet accounts, plus a human App Store reviewer's manual Sign in with Apple, matched on the name Apple discloses (`John Apple` / `John Appleseed`) rather than the email, since that account is a real, working `@privaterelay.appleid.com` address indistinguishable from a genuine shopper's |
| `retention` | retention | History past the window its own cron enforces, read from the same config the cron reads |
| `reported_only` | none | Counted, explained, **no checkbox** |

### The section that deletes nothing

`reported_only` is the point of the design. Orphaned price points are **normal** —
they outlive a deleted receipt on purpose, because they are the billable remnant —
and reading their count as an anomaly is what once made a healthy database look
like mass data loss. So they are counted, given a sentence saying why they stay,
and given no way to remove them. Same for barcode links with no price, anonymous
sign-in refusals, burned top-up references whose owner is gone, and soft-deleted
receipts.

### Coverage: how "we scanned everything" becomes checkable

`coverage()` maps **all 44 tables** to either their classifiers or an explicit
reason there are none — reference data, config, cleared by the `users` cascade, or
deliberately kept. `tests/dataCleanupRegistry.test.js` compares that map against
`information_schema`, so **a table added later fails the suite** until somebody
decides which bucket it belongs to.

### Delete order is the FK graph, and it is asserted

- `topup_refs` **before** `users` — that FK is SET NULL, not cascade, so the rows
  would otherwise survive with a null owner and no way back to who paid.
- `users` mid-list — its cascade clears receipts, receipt_items, credit_ledger,
  consent_events, user_sessions and the rest in one statement.
- `products` **after** `users` — `receipt_items.product_id` is ON DELETE RESTRICT.
- `warehouses` last — SET NULL everywhere, so it can block nothing.

A test asserts each of those, rather than a comment claiming them.

---

## The ten things that make it safe

1. **Scan before delete, always.** A purge may only name groups from a scan *this
   admin* ran, on this process, in the last 15 minutes. The scan result is held
   server-side and the client never supplies the numbers, so an expectation
   cannot be forged by editing a request.
2. **Two ceilings, not one.** The absolute ceiling catches a predicate that is
   simply wrong. The **growth** ceiling catches the subtler case: you reviewed 3
   rows and 3,000 match now. Growth up to double plus a flat allowance is fine —
   `job_runs` gains rows every minute — beyond that it refuses.
3. **Refusals are per classifier.** One group over its ceiling does not abandon
   the run; it is reported and skipped.
4. **One transaction, one statement per classifier, in FK order.** Sequential
   statements inside a transaction see each other's effects; a data-modifying CTE
   cannot express a dependent order because every branch sees one snapshot. Any
   throw rolls the whole purge back.
5. **The snapshot is the deleted rows themselves** — `DELETE ... RETURNING` — so
   it cannot drift from what actually went. For account groups the cascade
   children are captured **first**, because `RETURNING` never sees them and they
   are most of what putting an account back would need. It is returned, never
   stored; the screen copies it **before** the delete fires.
6. **A typed word, not a tap**, for anything that removes an account. The screen
   uses a modal rather than `Alert.prompt`, which is iOS-only.
7. **Protected accounts.** The admin allow-list is always excluded, plus anything
   in `CLEANUP_PROTECTED_SUBS` (see below). An operator holding the one surface
   that could undo a mistake must not be able to delete themselves with it.
8. **Referential predicates, never date ranges.** 3,280 of 3,288 products were
   created inside the 2026-06 test window and real receipts point into it.
9. **`barcode IS NULL` stays load-bearing.** Without it the orphan-product sweep
   also takes 20 real catalog rows.
10. **Not a cron.** Operator-run only. An autonomous process that hard-deletes
    from `users` on a heuristic is exactly what removed a real account once.

### The check no predicate can make

Every scan returns `crossCheck` prose, and the screen shows it: **re-read the Kept
lists in both purge documents before deleting any account.** An account that was
deliberately kept once looks identical to one nobody ever considered. That is a
human judgement, and stating it on every scan beats writing it in a runbook
nobody opens mid-purge.

---

## Configuration

| Key | Default | What it does |
|---|---|---|
| `ADMIN_USER_SUBS` | `[]` | Who can open any of this. Also always protected from deletion. Managed from Admin · Accounts → ⋯ → Grant/Revoke admin access (or the same button on `AdminAccountDetail`) since 2026-09-25 — no more hand-editing the `app_config` row. An admin cannot change their own admin access (locks out the one surface that could undo it), and the route refuses with `409 ADMIN_SUBS_ENV_OVERRIDE` if `ADMIN_USER_SUBS` is also set as an environment variable, since that always wins over this row — see `Operations/DEPLOYMENT.md`. |
| `CLEANUP_PROTECTED_SUBS` | `[]` | Extra accounts no classifier may propose. Set it in `app_config` rather than in code — the list changes, and it holds real people's identifiers. |

To pin an account, add its `sub` to the `CLEANUP_PROTECTED_SUBS` row in
`app_config`. It takes effect on the next scan; no deploy.

---

## The API

All six routes are behind `requireAuth` + the `ADMIN_USER_SUBS` allow-list, never
the shared `x-admin-token` — a token embedded in an APK is extractable by anyone
who downloads the app, and these routes delete production rows and read another
person's receipts.

| Route | What it does |
|---|---|
| `GET /api/admin/data-cleanup/scan` | Counts + coverage + the target database + a token |
| `GET /api/admin/data-cleanup/sample?key=&limit=` | The rows behind one group, fetched on open |
| `POST /api/admin/data-cleanup/purge` | `{ keys, token, confirm }` — see below |
| `GET /api/admin/users/:sub/report` | Everything about one shopper |
| `GET /api/admin/incidents` | Health + quotas + sign-in failures + cron health |
| `GET /api/admin/overview` | The landing-screen counters |

`keys` takes three shapes: `"*"` for everything deletable, `["section:<key>"]` for
a whole category, or `["group:<key>", …]` for individual groups.

Refusal codes: `409 SCAN_REQUIRED` / `SCAN_STALE` / `SCAN_EXPIRED`,
`400 CONFIRMATION_REQUIRED`, `400 NOTHING_SELECTED`. A ceiling or growth refusal
is a **200** with the group named in `refused` — the rest of the selection still
runs.

> **Five more routes (Priceback #468, merged into `main-test-features` on
> 2026-10-20; production gets them when that branch is promoted to `main`):**
> Admin · Price checks and Admin · Price lookup, behind the same gate (the account
> plus the `ADMIN_USER_SUBS` allow-list, never `x-admin-token`). See **Price checks
> and price lookup** below.

---

## Adding a classifier when a table is added

1. `tests/dataCleanupRegistry.test.js` will already be failing — that is the
   prompt.
2. Decide what the table is. If it holds no independent debris, add it to
   `REFERENCE_TABLES`, `CONFIG_TABLES`, `CASCADE_TABLES` or `KEEP_TABLES` in
   `lib/dataCleanup.js` with a reason. That is a complete answer.
3. If it does, add a classifier: `key`, `section`, `table`, `title`, a `why` that
   explains itself to somebody about to delete rows, an `order` from the real FK
   graph, a `maxDelete` ceiling, and `deletable` / `touchesUsers`.
4. Add sample columns to `SAMPLE_COLUMNS` — never `SELECT *`, which puts raw OCR
   text and payload blobs on a phone screen.
5. Cover both halves in `tests/dataCleanupScanDb.test.js`: the marked rows are
   found, and a real-shaped row that breaks one clause survives.

---

## What this does NOT replace

The two CLIs stay. `scripts/purge-stale-signups.js` remains the release-runbook
step (§4b), and `scripts/purge-test-data.js` remains what runs after every test
suite. The console is the reviewed, on-the-phone path; the CLIs are the
unattended and scripted ones.

---

## Admin alerts: every desk pushes the admin (2026-10-07)

Maxim, 2026-10-07: every review on the console must reach the admin as a
notification. All of them sit under ONE switch, **Admin alerts**
(`notifAdminAlerts`, shown to admins only), and go through `sendUserPush`, so
the admin's master switch and that switch both apply. Copy is plain English
(admin-only, exempt from translation).

| Desk | Push `data.type` | Sent by | When |
|---|---|---|---|
| Tag reviews | `tag_review` | tag submit route (`server.js`) | at once, one per tag; the submitting admin is left out |
| Price-drop queue | `price_drop_review` | sweep's staged listener (`server.js`) | 60 s coalesced, only while review is required |
| Receipt review | `receipt_review` | `backend/jobs/adminAlerts.js` | ≤ 5 min; an admin's own receipts are left out of their count |
| Accounts | `new_user` | `backend/jobs/adminAlerts.js` | ≤ 5 min; purchase-first placeholders are called out |
| Notifications to approve | `notification_approval_review` | `backend/jobs/adminAlerts.js` | ≤ 5 min; only notices still pending |
| Potential price drops | `potential_drop_review` | `backend/jobs/adminAlerts.js` | ≤ 5 min; only groups not announced before |

**Why the last four are a poll** (cron `*/5`, `trackJob("adminAlerts")`), not a
hook at each write: notices are drafted by an operator script in another
process (`scripts/repairBadScanReceipt.js`) that cannot reach `sendUserPush`;
a potential drop has no write at all — it is derived from price points; and the
account insert is inside the sign-in transaction, the riskiest place to add a
side effect.

**How it never repeats or skips:** each desk stores in `kv_state` how far it
has read (`adminAlerts:receipts|users|notices` = the last window end;
`adminAlerts:potentialDrops` = the group keys already announced). A run reads
`(stored point, slot − 60 s]` on the rows' own `created_at` and moves the point
with `kvStateRepo.claim` — an election, so during a deploy (old and new process
both fire the cron) only one sends. A read that fails leaves the point, so the
next run retries the window; a restart resumes from the point (catch-up capped
at 24 h). The **first run ever only records the point** — nobody is pushed for
history. Several items in a window are one push per admin per desk.

**Operator notes**
- No created_at index on `users` / `receipts`: each run is a small seq scan.
  Fine at today's size; add an index if those tables reach the hundreds of
  thousands.
- To re-baseline a desk (e.g. after a bulk import you do not want announced),
  delete its `kv_state` key; the next run records the point and sends nothing.
- A failed desk fails the run in `job_runs` (Incidents), after the other desks
  have run.

## The other three screens

**Shopper report** (`GET /api/admin/users/:sub/report`) answers the four shapes a
ticket takes: *charged twice* → the ledger with its drift against a replay, plus
top-ups; *credits vanished* → `data_reset_at`, which hides ledger rows from the
shopper without deleting them and is more often the answer than a deletion is;
*receipts gone* → receipts with their own `deleted_at`; *cannot sign in* →
sessions **with their revoke reasons**, plus that account's own `auth_outcomes`.
Reading a shopper's data is a privacy event and the route logs the actor.

> **Since 2026-09-21 this body is shared, not exclusive to that screen.** It
> lives in `src/components/AdminAccountReport.js` and also renders inside the
> account desk's detail screen, reached by tapping an account row (the row USED
> to carry a separate 📄 icon that opened the exact same screen — removed
> 2026-09-25 as redundant; the row itself is the one way in now). The
> standalone Shopper report keeps the entry the desk does not offer — free-text
> search across every account. See `Admin_Account_Desk_Merge.md`.

**Receipt review** (`GET /api/admin/receipts`, added 2026-09-25) is the newest
receipts across EVERY account — photo + raw/header OCR — searchable by owner
email. Read-only: a receipt is already accepted and credited on upload, so this
answers "does this one look right" the way an operator used to answer it by
opening a shopper's own account and hunting for the receipt by hand.

**Incidents** shows sign-in refusals grouped by reason — each with a **severity**
and the prose explaining it — plus cron health and a **decoder**: paste the
reference a user quoted (`GMAIL-403-INSUFFICIENT-SCOPE`, `SIGNIN-MISCONFIGURED`)
and get what it means, what to tell them, and what to check. A test asserts every
category in `errorSupport.ERROR_CATEGORIES` has prose, so one added later cannot
ship undecodable.

**Service health** renders `/health` through `buildHealthSnapshot()` — extracted
from the route rather than reimplemented, because this codebase has shipped a
check answering "is one env var set?" instead of "does the feature work?" three
times. It also holds the billing diagnostic, push delivery, and the Sentry crash
probe.

**Admin home** badges what needs a person and links onward. Every previously
reachable admin route is still registered and still reachable — pinned by a test
that reads `App.js` — so nothing became unreachable and the `tag_review` push
deep-link still lands.

> **Superseded in part, 2026-09-11.** Health and incidents are now two screens,
> not one; quotas moved to the console root; the menu is grouped into five
> categories; and sign-in refusals carry a severity so routine expiries stop
> being counted as work. See **`Admin_Console_Triage_Rework.md`** for what the
> console now says and why. The cleanup registry, its ten safety properties and
> every route above are unchanged.

---

## Price checks and price lookup (2026-10-20)

**Status:** merged into `main-test-features` on 2026-10-20 (Priceback #468). It runs
on the dev backend and the dev database once the `priceback-development` Railway
service deploys that branch, and reaches production only when `main-test-features`
is promoted to `main`.

Two screens in the **Product** group of the console, for two asks of 2026-10-19:

- *"force a price refresh or price drop checks to run on demand"* → **Price checks**
  (after Saving dates)
- *"a screen to check a price for a given product by name or sku, province,
  warehouse, ...etc search fields filters to track the last price and the price
  history"* → **Price lookup** (after Price-tag settings), which opens **Price
  history** for one product

Both are admin-only and English-only, like every `Admin*` screen.

### Price checks: Run now

There are two jobs, one card each:

| Job (`:job`) | On the card | What it runs |
|---|---|---|
| `priceSweep` | **Price refresh** | The scheduled sweep itself: every province's verified-drop check, the price-tag credit settlement (`tagCreditsRepo.settleAllVerified`) and the receipt status heal (expired drops flagged claimed, then overdue statuses recomputed). |
| `priceDropCheck` | **Price-drop check** | The verified-drop check alone (`runVerifiedDropSweep`), for every province or for one. |

Each card shows whether the job is running, since when, and who started it (the
schedule, the boot catch-up or the console). It also shows the job's last finished
run from `job_runs` (when it ran, how long it took, whether it failed) and what the
last run did, in plain English: how many price drops it found, how many went to the
review queue and how many were sent, the price-tag credits it paid, and the receipts
it updated. Above the cards the screen says **where found drops go** before anything
runs, read from the review-queue switches: held for review, sending paused, or
*"charged and sent to shoppers right away"*. That line links to Admin · Price-drop
queue. The confirmation dialog repeats it. While a job runs, the screen re-reads the
status every 3 seconds. It stops when the job finishes or the screen loses focus.

**One guard for every trigger.** The sweep scheduler is now built at module scope in
`server.js`. **Run now** fires the *same* scheduler as the timer and the boot catch-up
(trigger `admin`), so the three share one overlap guard. `startServer()` still starts
the timer. Building the scheduler starts nothing, so `require("./server")` in a test
schedules no sweep. A scheduled tick that lands while a Run now sweep is running is
skipped as an overlap, just as it would be behind a slow scheduled sweep. The admin's
run has just done the same work.

**Refused, never skipped silently.** A sweep takes minutes (prod `job_runs`: 80 s on
average, 451 s at worst), so the POST starts the job in the background and answers
`202`. A second press while the job runs gets `409 already_running` with a sentence
the screen shows ("A price refresh is already running. Try again when it has
finished."). The drop check is also refused while the notifier's own in-flight guard
would block it (`priceDropNotifier.sweepInFlight`): the all-provinces check inside a
running price refresh, a flyer import's province sweep, or the sweep a fresh receipt
schedules. The refresh is refused while an all-provinces drop check runs outside it,
because its main leg would skip and it would report a run that checked no price. Only
one on-demand drop check runs at a time. Like the scheduler's guard, these guards are
per server process.

Since Priceback #466 (also on `main-test-features`), the notifier no longer drops a
province or all-provinces trigger that its guard blocks: the running check makes
another pass when it finishes, up to three, then a follow-up run (Bugs #336). Run now
does not take that path. It is refused before it reaches the notifier and queues
nothing, so press it again when the running check has finished.

**What is durable.** Every run, from any trigger, writes a `job_runs` row:
`priceSweep` for the refresh, plus a new job name, `priceDropCheck`, for an
on-demand drop check. The card's "last run" line reads `job_runs`. The detail of what
a run did ("3 found, 2 sent") is held in memory, so a restart or a redeploy forgets
it, and the card then shows only the `job_runs` line.

**The operator's curl is unchanged.** `POST /api/check-all` (with `x-admin-token`) still
fires an untracked all-provinces drop check. Run now is the tracked way, and it is
reachable from the phone.

### Price lookup and price history

**Price lookup** searches by name (English or French, *contains*), SKU (exact or by
prefix, real SKUs only) or barcode (exact). The filters are province, warehouse
(picked through its province, then applied on its own: a receipt price carries the
shopper's province, so a Gatineau shopper at an Ottawa warehouse still shows under
that warehouse), store (shown only when more than one store has products), source,
period (all, 7, 30 or 90 days, counted from the start of that UTC day) and *verified
only*. Exact SKU and barcode matches come first, then the products with the most
recent matching price. With no search text, the screen lists the products with the
most recent prices under the filters. Each row shows the product's **last price under
those filters**, where and when it was seen, the source, and how many prices match.

Tapping a row opens **Price history** with the same filters. It has a chart (drawn
when there are two usable prices or more), the last, lowest and highest price, the
date first seen (the earliest `LEAST(observed_at, created_at)`: a re-observation moves
`observed_at` forward, `created_at` keeps the first write), the provinces, and every
price newest first. A receipt price has **Open the receipt** (→ Admin · Receipt
detail). **Show every price** drops the filters and shows the product's whole history.

The rules, enforced in `repos/adminPriceLookupRepo.js`:

- **Excluded prices never count.** A price point an admin excluded
  (`flags.excluded`: a rejected potential drop, a revoked tag credit, a rejected tag
  review) is never counted as the last price, the lowest or highest, or a match. The
  history still lists it, marked with the reason, so the admin can see why a price is
  missing.
- **Only a real SKU is a SKU** (3–12 digits). The synthetic keys (`ln:…`, `bc:…`) come
  back as "No SKU".
- **Verified means what the drop sweep trusts on its own** (`priceDropRepo`'s admin
  bypass): the `verified` flag, the weekly flyer, a point flagged `adminVerified` (an
  admin's tag scan or receipt-derived price), or a line of an admin account's own
  receipt. The *verified only* filter and the price's "Verified" tag are one SQL
  expression (`_verifiedExpr`), so the flyer price the sweep acts on never hides
  behind the filter: flyer rows are written with `verified = false`. A crowd price
  verified by the rule of N is a property of the price group, not of one point, so it
  is not tagged here.
- **Never returned:** `device_hash`, `source_ref` (a crowd ref embeds the device
  hash), or the sub of the admin who excluded a price. A receipt's id is parsed from
  its `source_ref` server-side, and only when that receipt row exists.
- **An unknown filter code is a `400`** with a plain message, never an empty result
  that would look like "no price". Every store, province, warehouse and source code is
  checked against the database first.
- **Source names an admin can read.** `flyer_user_scan` rows are crowd prices from a
  shopper's receipt (`crowdRepo`, `flags.obsSource = "receipt"`), so the screen calls
  them *"Shared from a shopper's receipt"*. Old tag scans written before
  `price_tag_scan` existed carry `obsSource = "tag"` and read as *"Shared price tag"*.
  Note: some older admin screens still call `flyer_user_scan` a flyer photo. They were
  not changed here.

There is no migration and no new index. The per-product reads use
`price_points_product_date_idx`. The name search scans `products`, which an
admin-only search can afford.

### Routes

All five are `requireAuth` + `requireDb` + the allow-list. The rate limit is charged
**after** the admin check, so a non-admin cannot drain an admin's budget. Each route
group has its own bucket at 120 requests per window (`ADMIN_DESK_RL`).

| Route | Bucket | What it does |
|---|---|---|
| `GET /api/admin/price-jobs` | `admin-price-jobs` | For each job: `running`, `startedAt`, `trigger` / `province`, `blocked` (Run now would be refused), `lastRun` (from `job_runs`), `lastResult` (in memory). The refresh also gets `intervalMinutes`. Plus `settings` (the review-queue switches), `provinces` (`{code, name}`) and `target`. |
| `POST /api/admin/price-jobs/:job/run` | `admin-price-jobs-run` | `:job` is `priceSweep` or `priceDropCheck`. Body for the drop check only: `{ province? }`, a 2-letter code, or omitted for every province. Answers `202 { started: true, startedAt, province }`, `409 already_running` (with `message`, `running`, `startedAt`, `trigger`, `province`), `404 not_found` for any other job, or `400 validation_failed` for a province on the refresh or an unknown province. |
| `GET /api/admin/prices/filters` | `admin-prices` | Provinces (with names), stores that have products, sources (`code` + `label`) and warehouses (number, name, city, province, store). |
| `GET /api/admin/prices/search` | `admin-prices` | `?q=&store=&province=&warehouse=&source=&verified=&since=&limit=`. Products, each with its `last` price under the filters, `matchCount`, `excludedCount` and `exact`. `limit` defaults to 50 (max 200). `q` is at most 100 characters. `since` takes `YYYY-MM-DD` (UTC midnight) or an ISO time with a zone. |
| `GET /api/admin/prices/history` | `admin-prices` | `?productId=&province=&warehouse=&source=&verified=&since=&limit=` (no store and no `q`: a product belongs to one store). Returns `product`, `points` (newest first, excluded ones marked), `hasMore`, and `summary` (`count`, `excludedCount`, `last`, `lowest`, `highest`, `firstSeen`, `provinces`). `limit` defaults to 200 (max 500). Answers `404 not_found` for an unknown product and `400` for a bad id. |
