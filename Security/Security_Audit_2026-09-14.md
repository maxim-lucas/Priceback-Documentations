# Security Audit — 2026-09-14

> **Written up retroactively on 2026-09-16.** The audit itself ran on
> 2026-09-14 and produced four commits; no report was ever written, so for two
> days the entire findings list existed only in commit messages on a branch that
> had never been pushed, on one machine. That is recorded here as part of the
> finding set, because it is how the next one gets lost.

**Scope as requested:** a deep, full security audit of **`main`**, respecting
Google Play and App Store guidelines, fixing findings per best practices.

**Scope as performed: `development`.** The audit reasoned that
`git log --oneline development..main` was empty, so `development` strictly
contained `main`, and that auditing the working tree therefore covered `main` in
full.

That reasoning was true about the *code being read* and false about the *fixes
being written*. "The audit covers `main`" is not the same claim as "the fixes are
on `main`", and the fixes went to a branch stacked on `development`. `main` — the
only branch that is tagged, built and shipped to either store — then took the
v2.9.0 tag on 2026-09-14 carrying every one of these findings unfixed.

**Corrected 2026-09-16 (PR #338).** Thirteen of the fourteen recorded findings are
now on `main` by cherry-pick. See *Status on `main`* below for the one that is not.

The previous full audit was **2026-08-04**. Everything since — first-party
sessions (#253), the admin console and data-cleanup runner (#331), the reviewer
access code (#299), locked drops (#321), the store price-adapter registry and
three store feeds, the AdMob lane — had never been security-reviewed.

---

## The headline is a compliance hole, not a crash

**H1.** `isGmailSourcedReceipt` gated exactly **one** egress path,
`syncReceiptToBackend`. A second one, `registerForPriceWatch` -> `POST /api/watch`,
filtered on claimed + expiry + `isWatchableLine` and **never on source** — so
mailbox-derived item names, SKUs and prices were posted to the backend, which
stores the array verbatim in `watched.json`.

That is exactly the "transfer" the `gmail.readonly` restricted-scope **Limited
Use** claim filed with Google rules out.

The gate's own comment asserted Gmail receipts are local-only *"unconditionally"*,
and justified it by reasoning that the crowd path "is Costco+SKU-shaped and
rejects everything else". That is true of `crowdRepo.recordObservation` and **not**
of the `watchedItems.set` half sitting beside it, which the comment never
considered. **A comment that states a guarantee the code does not make is worse
than no comment** — it is why nobody re-checked.

Latent today only because `gmailSyncEnabled: false` at build time. It fires the
day CASA verification clears and that flag flips.

---

## Findings

Severity is the audit's own. "Status" is the state on **`main`** after PR #338.

| # | Finding | Severity | Status on `main` |
|---|---|---|---|
| H1 | Gmail-sourced receipt content reached the backend via `/api/watch` | High | **FIXED** |
| H2 | Every CI job ran with the repo-default `GITHUB_TOKEN` | High | **FIXED** |
| H3 | The secret scanner was itself an unverified downloaded binary | High | **FIXED** |
| M1 | The consent record stored a **raw, client-controlled** IP in a column named `ip_hash` | Medium | **FIXED** |
| M2 | Secret strength was reported for the one secret that needed it least | Medium | **FIXED** |
| M3 | The upload size cap was opt-out-able by sending a malformed declaration | Medium | **FIXED** |
| M4 | `npm install`, not `npm ci` — the committed lockfile was advisory | Medium | **FIXED** |
| M5 | Production could boot an EOL Node (`engines: ">=18"` vs `.nvmrc` 24) | Medium | **FIXED** |
| M6 | The gitleaks allowlist could spell a real credential | Medium | **FIXED** |
| M7 | *unrecorded — see "What was lost"* | — | **UNKNOWN** |
| M8 | The Veryfi partner key was ungated in the `local` build profile | Medium | **FIXED** |
| M9 | Smaller than reported: a comment that would answer a Data Safety question wrongly | Medium | **FIXED** |
| M10 | *unrecorded — see "What was lost"* | — | **UNKNOWN** |
| M11 | The audit named three unprotected routes. There were **twelve**. | Medium | **FIXED** |
| M12 | Two caps that bounded the count and not the size | Medium | **FIXED** |
| L-C | The membership number was retained on device for no feature | Low | **OPEN — deliberately** |

### H2 — every CI job ran with the repo-default `GITHUB_TOKEN`

`test.yml` declared no `permissions:` block at all, so all three jobs inherited
whatever the repo grants, commonly `contents: write`. Anything reaching code
execution on a runner — a hijacked dependency `postinstall`, or the unverified
scanner binary H3 describes — could push to `main`, retag a release, or rewrite
the lockfile.

Set to `contents: read` at the **top level**, not per job: a top-level grant is
inherited by jobs added later, so a new job cannot arrive carrying the default.

### H3 — the secret scanner was itself an unverified downloaded binary

gitleaks was `curl`'d, untarred, `chmod`'d and executed with no integrity check.
**A version-pinned URL is not pinning.** The failure mode is the dangerous one: a
tampered scanner's cheapest move is `exit 0`, which *silently disables* the leak
gate rather than failing it — the same shape as Bugs #146, the two weeks it sat
muted behind `if: false`.

Now verified against a SHA-256 digest committed **in this repo**. Checking it
against the release's own `checksums.txt` would be circular: whoever can swap the
asset can swap the checksum file beside it.

### M1 — the consent record stored a raw, client-controlled IP

```js
ipHash: (req.headers["x-forwarded-for"] || req.ip || "").toString().slice(0, 80)
```

Two defects, and **the column's own name concealed both**:

1. It was never hashed. Plaintext PII sat in `consent_events` — the one record
   that deliberately **outlives account soft-deletion**, so the consent trail
   survives a PIPEDA / Law 25 question.
2. It read the raw `x-forwarded-for` **header** ahead of `req.ip` — precisely the
   attacker-controlled value `app.set("trust proxy", 1)` exists to neutralise. A
   client could write any string it liked into its own legal audit row: a forged
   address, or the whole comma-separated proxy chain.

`middleware/audit.js` already had the right helper, `hashIp`, salted with a
per-process-day random so rows cannot trivially link a user across days. It was
one directory away and already in use by the request audit log.

The row builder moved to `lib/consentEvents.js` and is now **pure** — it cannot
see headers at all any more, so defect 2 is *unrepresentable* rather than merely
fixed. That is not tidying: a DB-backed test for this would be one of the suites
that silently **skips** when `.env` is absent and still exits green, which is the
worst possible property for a test whose subject is a legal record.

Checked the other two `x-forwarded-for` readers (`audit.js`,
`clientIpForRateKey`): both correctly prefer `req.ip` and fall back to the
**rightmost** hop. The consent line was the only leftmost read in the codebase.

### M2 — strength was reported for the secret that needed it least

Correcting the audit's own first draft: `SESSION_TOKEN_SECRET` already had a
documented 32-character floor, a missing/weak/ok class and an actionable blocker
in `/health`. That standard had simply not been applied anywhere else.

`ADMIN_TOKEN` — one shared value gating the production data-cleanup purge, flyer
import, credit revocation, barcode links and the `/health` diagnostics themselves
— was reported as `flyerImport: "configured"`. **Presence, not strength**, which is
the same "is the env var set" half-truth the file's own note argues against.
`REVIEWER_ACCESS_CODE`, which opens a real session from a string pasted into App
Store Connect review notes, had no strength signal either.

Both already compare in constant time. That stops an attacker *measuring* a secret
and does nothing about one short enough to guess.

**Reported, never enforced.** Refusing a short admin token at compare time would
lock an operator out of production — including out of the diagnostics that would
explain why. A lockout is worse than a weak token behind a throttle. The block is
**admin-only**: "the admin token is weak", published anonymously, is an invitation.

### M3 — the upload size cap was opt-out-able

`imagePresignDecision` treated a **malformed** declaration exactly like an absent
one and returned an unbounded presigned PUT, so `{"imageBytes": "x"}` bought a URL
with no `ContentLength` into the production R2 bucket.

The unbounded *absent* branch is a real, documented compromise for builds already
in the field. This was not that case, and the client is the proof:
`imageBytesForPresign` returns a finite positive number or `undefined` — never a
string, never `NaN`.

**The existing suite had pinned "not-a-number" and `NaN` into the absent set,
encoding the hole.** A test can hold a bug in place; this one did.

### M6 — the gitleaks allowlist could spell a real credential

The i18n entry was `^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$`, under a comment
claiming it admitted "only lowercase words … essentially no entropy". It admitted
**mixed case and unbounded segment length**, so a Mapbox `pk.eyJ1Ijoi…` token, an
`sk.<base64>` key, or a JWT whose segments land URL-safe-free all matched and were
globally muted. **An allowlist entry that can spell a real credential is not an
allowlist.**

Bounded to 31 characters per segment and 5 dots — **derived from the data, not
guessed**. On `main`: 1479 dotted keys, longest segment 27, deepest path 4 dots.
Mixed case is kept because real keys need it; the length bound does the work.

### M11 — the audit named three routes. There were twelve.

Named by reading: `GET /api/barcode/resolve` (public, unauthenticated, three DB
round trips per call against a session pooler capped at 15 connections),
`PUT /api/me/profile` (appends up to 10 rows per call to append-only
`consent_events`, which nothing prunes), and
`POST /api/admin/credit-reconciliations/sweep` (runs the full `reconcileCredits`
job).

**Writing the catch-all invariant found nine more**, which is the entire argument
for writing it: the three a human could name by reading were a quarter of the real
answer, because a human reading a 9,000-line file finds the routes they happen to
look at. The nine were the three price-tag-review routes (one **grants credits**),
the three credit-reconciliation routes (one **applies** them), `flyer-scan/commit`
(a 2000-item bulk write), `unlinked-products` and `barcode-link`.

All twelve are charged **after** the admin check, so a non-admin cannot drain an
admin's bucket by hammering a route they cannot use.

### M12 — two caps that bounded the count and not the size

`POST /api/analytics`: the route's own comment reads *"Coerce + bound each event so
a hostile client can't blow up the file"*, and `properties` was the one field that
escaped it — written whole. 200 events/batch x 60 batches/hour/IP against a 10 MB
body limit, into files **nothing pruned**. They accumulated forever in `DATA_DIR`,
the same volume as `watched.json` and the send-once notify ledger — so filling it
does not merely lose analytics, it **breaks the price-watch registry and starts
sending duplicate pushes**.

`POST /api/watch`: `items.length` was capped at 500 and item *contents* were not,
so 500 items x 20 KB was a legal request. The array is stored verbatim and every
write re-serializes the **entire map** synchronously to disk, so one oversized key
is paid for again by every other caller on every subsequent write — and the map key
is a client-chosen `deviceId`, so an abuser mints unlimited keys.

**The mutation testing earned its keep here.** Four mutations, and two survived the
first draft: reverting the analytics route to write `e.properties` whole, and
deleting the prune's call site from `runDailyMaintenance`, both left the suite
green. The tests asserted the helpers in isolation and never that anything
**called** them. *A correct helper nothing calls is not a fix.*

---

## Three of the last audit's conclusions had expired

This matters more than the new surface, because **an accepted risk is only accepted
while its reasoning holds.**

- **`form-data` and `undici`** were deferred on 2026-08-04 as "needs a breaking
  major". Both now have non-breaking fixes — re-verified live on 2026-09-16
  (`fixAvailable: true` for each). Fixed on `main`: backend production highs went
  3 -> 1.
- **The mobile triage's "no runtime exposure in the installed app" is false.**
  `nanoid` and `decode-uri-component` ship inside react-navigation. Neither is
  exploitable, but the sentence justifying inaction is wrong.
- **Three ops actions from 2026-08-04 are still open**, including a live R2
  credential still reachable in git history at `4b41643`.

---

## Status on `main`

**PR #338 (2026-09-16)** cherry-picked the audit onto `main`: 20 files,
+1843/-60, carrying none of the Best Buy / Sport Chek / Abercrombie / AdMob /
locked-drops code that `development` had accumulated around it.

That portability was verified rather than assumed: 16 of the 20 files are
byte-identical to the originals, and the other four differ by **exactly the inverse
of the feature delta** — `backend/server.js` is `+7 -101` against the original,
mirroring development's `101+/7-` of Best Buy feed and locked-drops code. The route
tables are identical on both branches (74 routes, 26 admin), which is what makes
M11's catch-all invariant safe to port.

**L-C is deliberately not on `main`.** Dropping the unread `parsed.memberId`
requires editing `src/services/receiptParser.js`, the shared store dispatcher, and
this repo's standing rule is that shared parsing code counts as Costco and is not
touched without confirmation. Maxim's call on 2026-09-16 was to exclude it.

Residual risk, stated plainly: the membership number is still written into the
local `receipts_v2` record and nothing reads it back. **Extraction is unaffected**,
so its digits still leave the OCR text — it does not reach `receipts.raw_ocr`, the
backend, or the LLM payload. Extraction was always the scrub; retention was the bug,
and the retention half is still there.

---

## What was lost, and why it is recorded

**Findings M7 and M10 are referenced by no commit and no document.** The audit's
finding list was never written down, and the session that held it is gone. They may
have been folded into neighbours, withdrawn on inspection, or never written at all.
They cannot be recovered from this repo.

**The Low-findings follow-up PR was never started.** The call on scope was two PRs
— High+Medium now, Low as a follow-up. Only the first half exists, and the contents
of the second are unrecorded apart from L-C.

Both gaps have the same cause as the branch mistake: **the audit's findings lived
only in commit messages on an unpushed branch.** A finding that exists in exactly
one place, and that place is a local branch, is one `git gc` away from never having
happened.

**Prevent next time:** write the findings table into this folder *first*, before the
fixes, and push it. The fix commits reference the table; the table does not depend
on the commits surviving.

---

## Verification performed

On `main` (2026-09-16), baselined before and after so an inherited failure could not
be mistaken for a regression:

| | baseline | after |
|---|---|---|
| Mobile | 234 suites / 5549 tests / 55 snapshots | **237 / 5591 / 55, green** |
| Coverage S/B/F/L | 82.21 / 74.66 / 71.96 / 84.77 | **82.24 / 74.68 / 72.03 / 84.81** |
| Backend non-DB | 53 pass / 0 fail / 0 skipped | **104 / 0 / 0** |
| Backend DB (dev project) | 92 pass / 0 fail / 0 skipped | **92 / 0 / 0** |
| `i18n:check` | en=1504, fr=1504 | in sync |

Skipped counts were read explicitly, never inferred from an exit code — `node
--test` does not load `.env` and will skip a whole DB file while exiting green.

**All twelve new guards are mutation-tested and each goes red:** deleting the
`permissions:` block, deleting the gitleaks checksum, reverting `npm ci`, restoring
the loose allowlist regex, reverting `engines` to `>=18`, removing the Veryfi gate,
removing the Gmail gate, storing the raw IP, making a malformed `imageBytes`
unbounded again, writing `e.properties` whole, unwiring the analytics prune, and
dropping the public barcode brake.

**No GitHub Actions run was dispatched.**
