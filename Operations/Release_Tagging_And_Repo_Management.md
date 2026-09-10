# Release tagging & repo management

**Repo:** `maxim-lucas/Priceback` · **Last updated:** 2026-08-04

The single question this document answers: *"users are on a broken build — which
commit is it, and how do I get back to a good one?"*

The short version is a standing rule in the app repo's `CLAUDE.md`: **no version
is published to a store without an annotated tag and a GitHub release pinning the
commit it was built from.** This document is the long form.

---

## 1. Why tags, and why they were missing

`eas.json` sets `appVersionSource: "local"`, so **`app.json` is the only record
of what version a binary carries**. EAS does not hold a server-side counter to
fall back on. Once an artifact is uploaded to Play or App Store Connect, `main`
keeps moving and nothing on disk points at the tree that artifact came from.

Before 2026-08-04 the repo had exactly one tag — `Cleanup-V2`, a schema-rebuild
marker from 2026-06-12, not a release. Finding "what shipped as 2.8.3" meant
archaeology: `git log` for the commit where `versionCode` last changed, then
hoping nothing after it was also in the build.

A release tag removes the guesswork. `git checkout v2.8.3 && eas build --profile
production` reproduces the shipped binary exactly, version numbers included.

## 2. The scheme

`android/` is **gitignored build output** — a local `expo prebuild` leaves a
stale `build.gradle` behind (it still read `versionCode 22` while `app.json` was
on 23). It is not a version source and must never be hand-edited; a fresh
prebuild regenerates it from `app.json`.

| Rule | Value |
|---|---|
| Tag name | `v<expo.version>` — e.g. `v2.8.3`. Marketing version only; no build number in the name. |
| Tag type | **Annotated** (`git tag -a`). Lightweight tags carry no message, no tagger, no date. |
| Placement | The commit the store artifact was **built from** — not "wherever `main` was when you remembered". |
| Cardinality | One tag per shipped build. A version never built or never uploaded gets no tag. |
| Immutability | **Never move or delete a release tag.** Anyone who fetched it keeps the old commit and the tag silently means two things. Superseded? Bump `app.json` and cut a new one. |
| Version triad | `expo.version` + `ios.buildNumber` + `android.versionCode` must describe one build; keep `buildNumber === versionCode`. `package.json`'s `version` is bumped in the same commit. |
| `versionCode` | Strictly increasing across tags. Play rejects a re-use; a flat one means `app.json` was never bumped. |

The tag message carries the version triad, the source commit, and the commits
since the previous tag. The GitHub release repeats that plus **known defects in
the shipped build** and **what landed on `main` after the cut** — the two things
you need when triaging a user report against a stale binary.

## 3. Tags that exist

| Tag | Commit | Version / code | Status |
|---|---|---|---|
| [`v2.8.4`](https://github.com/maxim-lucas/Priceback/releases/tag/v2.8.4) | `1093975` | 2.8.4 / 24 | **Current release candidate.** Carries the subscription-resolution fix (#230) that unbreaks selling, the restore data-loss fix (#233), and the production error/security audit (#231). Build from this tag. |
| [`v2.8.3`](https://github.com/maxim-lucas/Priceback/releases/tag/v2.8.3) | `106ae9e` | 2.8.3 / 23 | **Published store build.** Known defect: Play subscriptions named `<subscriptionId>:<basePlanId>` don't resolve → the live build sells no subscriptions (fixed in #230, *after* the tag). |
| [`v2.8.2`](https://github.com/maxim-lucas/Priceback/releases/tag/v2.8.2) | `fdc2af3` | 2.8.2 / 22 | Superseded. First build with Android R8 minification enabled (#224) — the tree to diff against if an R8-shaped crash appears. |
| `Cleanup-V2` | — | — | Legacy schema-rebuild marker, not a release. Left alone; do not extend the pattern. |

`v2.8.4` closes that gap: #229 – #234 sat on `main` still carrying `versionCode`
23, which Play would have rejected. They are now bumped to 2.8.4 / 24 and tagged,
so the fix for the live "sells no subscriptions" defect has a buildable pin.

## 4. Cutting a release

`npm run release:tag` (→ `scripts/releaseTag.js`) enforces the mechanical half.
It runs six fatal checks — clean tree, on `main`, HEAD pushed, version triad
agrees, tag name free, `versionCode` increased — then builds the tag message
from the commits since the previous tag. It is a **dry run by default**.

```bash
# 1. Bump app.json: expo.version, ios.buildNumber, android.versionCode.
#    Land it through a normal PR (see §6) — never commit straight to main.

git checkout main && git pull

# 2. Preview the tag and let the checks run.
npm run release:tag

# 3. Cut and publish it.
npm run release:tag -- --write --push

# 4. Build from the tag, not from main — main may already have moved.
git checkout v2.8.4
eas build --platform android --profile production
eas build --platform ios --profile production

# 5. Publish the GitHub release.
gh release create v2.8.4 --title "v2.8.4 — versionCode 24" --notes-file notes.md --latest

# 6. After smoke-testing the build on a device (see §4b), clear the throwaway
#    signups it created from production. Point DATABASE_URL at the prod project
#    (session pooler, 5432) — it is not on disk by default.
cd backend
DATABASE_URL="$PROD_DATABASE_URL" node scripts/purge-stale-signups.js          # list
DATABASE_URL="$PROD_DATABASE_URL" node scripts/purge-stale-signups.js --write  # delete
```

**Tag before you build, not after.** Tagging after upload means reconstructing
which commit EAS actually saw, which is the exact problem the tag exists to
prevent.

### 4b. Purge the smoke-test signups

Smoke-testing a release build means signing into the real app with throwaway
Google accounts. Each one writes a `priceback.users` row on **production** with a
real OAuth `sub` and a real gmail address — no test marker — that
`scripts/purge-test-data.js` cannot see. Left alone they accumulate (7 of them by
2026-08-30; see `Production_Test_Data_Purge_2026-08-30.md`).

`scripts/purge-stale-signups.js` removes them by behavioural fingerprint — no
postal code, no province, no device, no session, no receipt, no subscription, no
spent credit, older than 24 h, not flagged, not already in the deletion flow
(the precise predicate is `backend/lib/staleSignups.js`). It is **dry-run by
default**: run it once to see the list, then `--write`. It refuses outright if it
matches more than 50 rows — that means the fingerprint is wrong, not that there
are 50 testers to delete.

Run it as the last step of every release, against production, once the build has
been installed and exercised. It is deliberately **not** a cron job: an
autonomous process that hard-deletes from the `users` table on a heuristic is the
kind of thing that removed a real account once already.

Release notes should state, in this order: the version triad and commit; changes
since the previous tag; **known defects shipping in this build**; anything on
`main` that is *not* in it.

## 5. Rolling back

A tag is a rollback *reference*, not a rollback *mechanism* — neither store lets
you un-ship a binary.

1. **Identify** what users are running: match the store's version string to the
   tag, then `git checkout v<version>` for the exact tree.
2. **Reproduce** against that tree — not against `main`, whose fixes the user
   does not have.
3. **Roll forward, always.** Branch the fix off `main`, bump `versionCode`, cut a
   new tag. Re-uploading an old artifact is impossible (`versionCode` re-use) and
   would drop every fix since.
4. **Halt the rollout** meanwhile: Play → staged-rollout halt; App Store →
   "Remove from sale" / pause phased release. That is a console action, not a
   repo action.

## 6. Branch & PR conventions in force

### 6a. The two long-lived branches

Added 2026-08-30. Before this, every branch targeted `main`, which made
"is this merged?" and "is this shippable?" the same question — so anything real
but not store-ready had to be kept out of production by the **lab lane**
instead, a build-time switch that strips the code from the binary. The lane
still exists and still earns its keep, but it is no longer the only place to
put unfinished work.

| branch | cut from | merges into | built with | tagged |
| --- | --- | --- | --- | --- |
| `feat/…` `fix/…` `chore/…` | `development` (or `main` for a hotfix) | `development` | — | no |
| **`development`** | `main` | `main`, when stable | `eas build --profile lab` | **no** |
| **`main`** | — | — | `eas build --profile production` | **yes** — annotated `vX.Y.Z` + GitHub release |

- **`development` is the integration branch.** Feature branches cut from it and
  merge back into it. It is promoted to `main` in one PR once the work on it is
  stable, and that PR is what §4's release sequence then acts on.
- **`development` is never tagged and never built for a store.** Tags exist to
  pin the commit a store artifact was built from (§1); a branch no store binary
  comes from has nothing to pin. Every store release still cuts from `main`.
- **`development` is never force-pushed and never reset.** It is shared, and a
  rewritten history there silently detaches every feature branch cut from it.
  Superseded work is reverted forward, exactly as tags are (§5).
- **Hotfixes may branch from `main` directly** when production is broken and
  `development` carries work that is not ready to ride along. Merge the hotfix
  to `main`, then merge `main` back down into `development` in the same sitting
  — a hotfix that lives only on `main` is a regression waiting for the next
  promotion to undo it.
- **Development builds use the `lab` EAS profile**, not the profile named
  `development` in `eas.json`. That one is a dev-client build, and dev-client
  builds are not used for device testing here (they need Metro and do not
  exercise the release configuration where R8 stripping shows up). `lab` is
  standalone, points at the development Railway backend, and sets
  `LAB_ENABLED=true` so lane-gated work is actually present in the binary.
- **CI runs ON DEMAND ONLY** (since 2026-09-10, PR #327).
  `.github/workflows/test.yml` has **no automatic trigger on any branch** — no
  `push`, no `pull_request`, no `schedule`. Run it yourself, at whatever ref you
  care about:

  ```
  gh workflow run Tests --ref <branch>      # or Actions -> Tests -> Run workflow
  gh run watch <run-id> --exit-status
  ```

  One full run bills ~30 minutes of free-tier Actions time (the backend job
  alone is ~23 minutes, serial, against a shared remote Postgres). Paying that
  automatically on every commit twice ran the month's minutes out around the
  halfway mark and left the repo with **no CI for ~3 weeks**. Nothing about the
  verification is weaker — dispatch runs the identical jobs; only its timing
  moved.

  Two consequences to plan around:

  1. **A PR shows no checks.** That is by design, not a misconfiguration, so
     there is nothing to wait for and nothing to investigate. Dispatch at the
     head branch and read the run.
  2. **Read it green before you promote or tag.** Dispatch on `development`
     before promoting it, and on `main` before cutting a release tag — the
     dispatch *is* the gate now, and nobody else will trigger it for you.

  `[skip ci]` no longer does anything, because nothing starts a run but you.
  `__tests__/ciTriggerPolicy.test.js` pins this policy for every workflow file,
  so widening it back has to be a deliberate edit to that test with a reason
  written down.

### 6b. Conventions

- **Never push to `main`**, even when it is the checked-out branch. Work goes on
  a `feat/…`, `fix/…`, `chore/…` or `polish/…` branch and lands through a PR.
- **Carry every PR to merge**, then delete the merged local and remote branch.
  Long-lived open PRs go stale against a moving `main`.
- **Squash-merge**, one commit per PR on `main`. Release notes are generated from
  `main`'s subjects, so the commit subject is the changelog line — write it as
  the user-visible fact ("stop advertising family sharing the app doesn't
  implement"), not as the mechanic ("edit pricing.config.js").
- **Never merge with `--admin`.** Since CI is dispatch-only there are usually no
  checks on a PR to bypass — which makes the *manual* read the thing you must
  not skip. Dispatch the suite at the head branch and see it green before you
  merge; "no checks shown" is not the same fact as "the suite passed".
- CI (`.github/workflows/test.yml`, "Tests") runs three jobs — `security`,
  `mobile`, `backend` — with a coverage floor that only ratchets up. Backend sits
  near its 30-minute budget because of Supabase pooler contention
  (`EMAXCONNSESSION`); **re-run before investigating a timeout**. All three jobs
  run on a `workflow_dispatch`; see §6a for why that is the only trigger.
- Never run two backend suites at once — they exhaust the shared pooler and fake
  failures that look like a regression.
- Every feature or fix ships full-coverage tests in the same commit, and every
  recurring/production-class bug gets an entry in `Bugs_Common_Fixes.md`.
- Documentation lives in `Priceback-Documentations`, not in the app repo (see the
  app repo's `CLAUDE.md`).

## 7. Deliberately not adopted

- **Automated release-on-tag CI.** Builds are `eas build` runs against store
  credentials; triggering them from a tag push adds a way to spend build minutes
  by accident with no reviewer in the loop.
- **`v`-prefixed pre-release tags (`v2.8.4-rc1`).** Store review is the release
  candidate stage; a second numbering scheme on top would drift from `app.json`.
- **Changelog file in the repo.** GitHub releases already hold the notes and are
  reachable from the tag; a `CHANGELOG.md` is a second copy that goes stale.
