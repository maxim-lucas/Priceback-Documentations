# Branch & PR policy — every repo, no exceptions

**Scope:** every GitHub repository under this project —
`maxim-lucas/Priceback`, `maxim-lucas/Priceback-Documentations`,
`maxim-lucas/Priceback-Website`, `maxim-lucas/social-media-manager`, and any
repo added later. **Last updated:** 2026-09-07.

## The rule

**All branched work goes through a Pull Request and a merge. Nothing reaches a
default branch (`main` / `master`) by direct push, fast-forward by hand, or
`--admin` override.**

1. Work happens on a branch (`feat/…`, `fix/…`, `chore/…`, `docs/…`,
   `polish/…`), never directly on the default branch even when it is checked
   out.
2. Every branch is opened as a PR against the branch it is meant to land on
   (`development` for Priceback features; the default branch elsewhere).
3. The PR is **squash-merged** — one commit per PR on the target — and then the
   branch is **deleted**, local and remote.
4. A branch with no PR is not "done." A merged PR whose branch still exists is
   not "done" either — delete it.

Priceback keeps its extra release machinery (annotated tag + GitHub release per
store build, `development` → `main` promotion). That is layered *on top of* this
rule, documented in `Release_Tagging_And_Repo_Management.md`. This file is the
baseline that applies everywhere.

## Auditing stale branches

When reviewing a repo's branches, for every branch that is not the default
branch (and not Priceback's protected `development`):

1. Check whether its work is already merged — look for a merged PR with that
   `headRefName`, and confirm the content is on the default branch (squash
   merges rewrite the SHAs, so compare files / distinctive lines, not
   `git log A..B`).
2. **Merged** → delete the branch.
3. **Not merged** → open a PR for it now, **oldest branch first** (order by the
   date the branch's work was created), so the history lands in the order it
   was written.
4. **Archival refs** (a deliberate `backup/…` snapshot kept as a rollback point)
   are exempt — they are not pending work. Leave them.

## Audit performed 2026-09-07

| Repo | Branch | Verdict | Action |
|---|---|---|---|
| Priceback | `claude/priceback-test-hardening-yn8vzm` | merged via PR #318 + #319 | deleted |
| Priceback | `feat/bestbuy-full-store-support` | merged via PR #320 | deleted |
| Priceback | `backup/main-pr314-promotion` | archival rollback ref for the bad #314 promotion | kept |
| Priceback-Documentations | `docs/scan-date-header-multicapture-2026-08-10` | merged via PR #27 (squash `3a13e18`) | deleted |
| social-media-manager | `feat/meta-publish-api` | merged via PR #1 | deleted |
| social-media-manager | `sm-content-assets` | merged via PR #2 | deleted |
| social-media-manager | `sm-content-teaser` | merged via PR #3 | deleted |

No unmerged branch work was found in any repo — every branch had already gone
through a PR and a merge. The action in every case was branch cleanup.
