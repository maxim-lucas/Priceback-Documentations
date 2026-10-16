# `development` merged into `main` — 2026-09-28

**App branch:** `merge/main-and-development` (cut from `origin/main` `63c9dc2`) ·
**Docs branch:** `docs/merge-main-development-national` ·
**PR:** Priceback **#373** → `main` (open — see the note below).

> **Merging the app PR deploys the backend to production** (Railway builds
> `main`). It is Maxim's release decision; this record is what he needs to make it.

## The ask

> *"all the code is in development branch and my need is for main. there was a
> lot of changes since, i want you to merge main and dev in a new branch, main
> always wins if there is conflict, any modification done in main should never be
> lost, also add this rule all national offers should be stored as national not
> duplicated even for costco, add this filter also in the price drop detection
> (province || national) for costco stores, all stores in prod should remain
> coming soon except costco"* — Maxim, 2026-09-28 (/goal)

## What the branch holds

| Commit | What |
| --- | --- |
| `f20c7a9` | The merge itself — conflict resolution only, plus the migration renumber. |
| `d9caf61` | Six places the branches disagreed **without** a git conflict; `main`'s rule carried into `development`'s code. |
| `1c6df28` | Every store except Costco stays "Coming soon" in production (Best Buy back on the lab lane). |
| `48db6a3` | National offers stored once, as `NATIONAL` — Costco included — and the `(province OR NATIONAL)` detection proven, with one real bug fixed. |
| later | Measured coverage recorded in `jest.config.js`. |

Merge base `bc38260` (#333, 2026-09-11). `main` had 37 commits `development`
lacked (2.9.0 → 3.0.1, both security audits, every hotfix); `development` had 22
`main` lacked (ads on the lab lane, the store price-adapter registry and the
NATIONAL province, Best Buy / Sport Chek / Abercrombie, locked drop prices,
coverage phases).

## 1. The merge — `main` wins

**Policy, per conflict hunk:** where the two sides **contradict**, `main`'s
version alone; where both only **added** different things at the same spot,
`main`'s lines verbatim *and* `development`'s beside them (dropping the latter
would break `development` code that references it).

| Conflict | Resolution |
| --- | --- |
| `.gitattributes` (add/add) | `development`'s blanket `* text=auto eol=lf` first, `main`'s `*.sh` / `.githooks/*` rules **last** so they keep precedence (verified with `git check-attr`). |
| `backend/package.json` | Both added scripts — all kept. |
| migration journal | Both took slot `0007`. `main`'s 0007–0012 untouched; `development`'s national province renumbered **`0013`** with a `when` after 0012 — drizzle skips a migration older than the newest applied. Idempotent SQL. |
| `receiptsRepo.js` | Both added functions — all kept, `main`'s verbatim. |
| `priceService.js` | `main`'s `isWindowOpen` filter wins; `development`'s lock loading kept ahead of it. |
| `storePoliciesDb.test.js` | `main`'s environment-agnostic assertions win. |
| `jest.config.js` | Comment only. |
| `package-lock.json` | `main`'s lockfile except the ads-SDK entry: the auto-merged `package.json` (a line `main` never touched) pins `react-native-google-mobile-ads@16.0.0`, and the lock must agree. Production binaries exclude the native SDK on both branches, so no store binary changes. |

**Proof that nothing from `main` was lost:** of the 346 files `main` changed since
the merge base, **307** are byte-identical to `main`, **27** still carry `main`'s
full patch (it reverse-applies cleanly), and the other **12** pass a line-level
check (every line `main` added is present, no line it removed is back). The only
two flags were a trailing comma and the ads-SDK lock line above.

## 2. Conflicts git never flagged — `main`'s rule carried over

1. **The Costco freeze** (`development`) pinned pre-#365 bytes; `main`'s #365/#367
   are reviewed Costco changes. Re-pinned with evidence (merged == `origin/main`,
   old pin == `origin/development`). Its fixture red was CRLF in a worktree
   checked out before the merge brought `eol=lf`.
2. **`jestMockHygiene`** (`main`, Bugs #290) vs a `{ virtual: true }` mock in
   `development`'s `detailScreenEditor` test — the flag dropped.
3. **A vacuous privacy check** — Bugs #298.
4. **A paid-for lock expiring on the UTC day** — Bugs #299.
5. **`db/deploy/schema.sql` stale on both branches** — Bugs #297.
6. **Migrations numbered twice** — the renumber above, now pinned by
   `consolidatedSchemaFresh.test.js`.

## 3. Stores — every store except Costco stays "Coming soon" in production

**Production, read-only query 2026-09-28:** `costco` is the only enabled store; 12
others are `enabled=false, visible=true` — bestbuy, homedepot, iga, loblaws,
maxi, metro, provigo, rona, sameday, sportchek, superc, thesource.
`BESTBUY_SCAN_ENABLED` = explicit `false` (2026-09-01).

`development` had promoted Best Buy (#320). That promotion's five declarations
moved **back** together — `LAB_STORE_PARSERS`, `LAB_ONLY_STORES`, `enabled:false`
in the bundle and `policies.json`, the regenerated sync SQL, the scan-flag
default — which is exactly `main`'s posture. Lab builds keep Best Buy.
`Technical/BestBuy/README.md` has the detail.

> 🛑 **Do not apply `backend/db/deploy/store-content-sync.sql` to production
> unreviewed.** It now enables Costco alone — but its hide-others UPDATE would set
> `visible=false` on the 7 grocery stores production shows as "Coming soon"
> (iga, loblaws, maxi, metro, provigo, sameday, superc), making them vanish
> instead. Nothing in this branch applies it.

## 4. National offers — stored once, `(province OR NATIONAL)` for Costco

Mechanics: `Technical/Flyer-ingestion.md` §4. Money-path evidence and the region
bug it found: `Technical/Store_Price_Adapters.md` › *Costco national offers*,
Bugs #296. Hardening: Bugs #300.

## 5. Deploying it

1. **Database — nothing to run on production.** The NATIONAL province already
   exists there (id `49640`, read 2026-09-28 — it predates this merge; how it got
   there was not traced), and `0013` is idempotent. If the hand-maintained drizzle ledger is kept in step, insert the
   `0013_national_province` row with the file's LF hash
   (`Technical/Migration_Consolidation_2026-07.md`). Dev already has it too.
2. **Merge the app PR** → Railway deploys the backend. From then on a national
   import is stored once, and region sweeps reach only their region's buyers.
3. **Optional, Maxim's call:** re-import `ALL-2026-09-14` to collapse its 1,547
   provincial rows to 119 `NATIONAL` ones. Not required — both shapes are read
   correctly.
4. **Mobile:** everything on `development`'s side (locked drops, the lab-lane
   Best Buy stack, the ads lane) reaches shoppers only with the next store build
   — version bump, tag and release per CLAUDE.md. Not part of this PR.
5. Leave `store-content-sync.sql` alone (§3).

## 6. Verification (local; no Actions dispatched)

| Suite | On the pure merge (`f20c7a9`) | On the branch head |
| --- | --- | --- |
| Backend `npm test` (c8 gate, dev DB) | 2,381 tests — **2 fail** (`policies.json` launched Best Buy; the tag-review email assertion) | **2,414 tests — 2,413 pass, 0 fail, 1 skipped**; coverage **95.24/81.52/95.67/95.24** (was 95.23/81.41/95.65/95.23) |
| Mobile `npm test` | 303 suites — **2 fail** (the Costco freeze; mock hygiene) | **303/303 suites, 7,251 pass, 1 skipped**; global pool 81.34/74.08/71.73/83.83 vs floors 73/65/64/76 |
| `npm run i18n:check` | en = fr = 1,612 | en = fr = 1,612 (no user-visible string added) |
| New `costcoNationalOfferDb` (11) | — | red → green; mutations each applied exactly once and caught: rows filed under ON, collapse removed, collapse product-match removed; plus `CURRENT_DATE` back in the lock query |

The skipped test is the same one skipped before the merge. A multi-file DB run
started in parallel produced a burst of false failures once — the shared-pooler
effect in `backend-suite-no-concurrent-runs`; every file passed run serially.

## 7. Regression risk

- **Best Buy "Coming soon" in production** — unchanged from what production
  shows today; a *lab* build is the only place it is live.
- **National storage** — a province's own offer still wins where it is cheaper;
  a batch re-imported nationally drops only the provincial copies that have a
  `NATIONAL` replacement.
- **Region sweeps** now reach only their region's buyers for a national row. Those
  buyers are still reached by the unscoped sweeps (the scheduled one, and the one
  every national import fires), and by "Refresh prices".
- **A price-tag expiry** scanned in one province no longer rewrites a national
  coupon's printed end date (it used to rewrite that province's copy). Nothing in
  drop detection reads `valid_until`.
- **The ads SDK** is `16.0.0` from `development`; production builds exclude the
  native SDK on both branches. Not yet proven by a production build
  (`lab-lane-for-unfinished-work`).
