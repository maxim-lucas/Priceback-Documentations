# The admin console's triage rework: severity, honest quotas, and five categories

**2026-09-11, hotfix on `main`.** Three defects reported off the live console,
plus the regrouping they made obvious. Supersedes nothing in
`Admin_Console_And_Data_Cleanup.md` — that document describes the cleanup
registry and the routes, which are unchanged; this one describes what the
console now *says*.

Related: `Bugs_Common_Fixes.md` #243–#245, `Technical/Auth_Outcomes_And_Severity.md`.

---

## The three defects, as reported

All three were visible in one screenshot each, and all three had the same shape:
**the screen could not distinguish two different facts, so it printed the more
alarming one.**

| Reported as | Actually |
| --- | --- |
| `revenuecat` red with a `?`, over a line reading "webhook: configured · syncApi: configured" | The check had no `status` key at all. The screen had no way to say "I do not know" and spelled it the same way it spells "on fire". |
| Six `verify_threw` refusals badged as an incident | Six ID tokens that arrived after they expired. The designed end of a token's life. |
| `r2_storage`, `railway`, `sentry_events` showing `? of 10` and `?%` in a **green** pill | Two different states — no provider token, and a provider token that failed — collapsing into one shrug. |

---

## 1 · `verify_threw`, and the token that would not die

### What the table actually recorded

```
2026-09-11 09:58:30  /api/me            now 1789120708 > exp 1789116944   (~1h stale)
2026-09-11 09:58:30  /api/me/bootstrap  now 1789120707 > exp 1789116944   (~1h stale)
2026-09-11 07:50:46  /api/me            now 1789113044 > exp 1789081311   (~9h stale)
2026-09-10 14:49:19  /api/me/bootstrap  now 1789051757 > exp 1788878422   (~48h stale)
2026-09-08 11:25:06  /api/me            now 1788866705 > exp 1788637857   (~2.6d stale)
2026-09-07 10:25:38  /api/me/credits    now 1788776738 > exp 1787156223   (~19d stale)
```

Two facts are in that list and **both are bugs**.

**The same dead token was re-presented on every wake, forever.**
`getValidIdToken()` returned the stale token unconditionally once both refresh
paths missed. The comment defending that was correct — the server's refusal
names the exact branch in `auth_outcomes`, where withholding the token logs the
far less useful `auth_required` — but it justifies **one** send, and was being
read as a licence to send it always. By 09-07 a token nineteen days past expiry
was still going out.

**The shopper was never told.** Nothing on the device treated the loop as a
failure. The home screen has had a "session expired" banner the whole time and
nothing raised it, so the app simply, quietly, did not work.

The pairs matter too: `/api/me` and `/api/me/bootstrap` land in the *same
second*, because both fire in one tick on wake.

### The fix

Each distinct token gets exactly **one** diagnostic send, and is then burned.

```
expired + unrefreshable
  ├─ can we PROVE it is expired?  ─ no ──▶ send it, unchanged behaviour
  │                                        (isIdTokenFresh is false for anything
  │                                         it cannot PARSE, not just for expired
  │                                         tokens — withholding one of those
  │                                         would lock out a working session)
  └─ yes
       ├─ first claim on this fingerprint ──▶ send once, persist the fingerprint
       └─ already claimed ─────────────────▶ withhold, and raise credential-rejected
```

Three details are load-bearing:

- **The claim is a `Map`, not a flag.** `if (await alreadySpent) … else await
  markSpent` has an open window: the `await` yields, the second caller enters,
  the set is still empty, and *both* are "the first". That is not theoretical —
  it is literally every row in the table, which comes in pairs. `Map.set` is
  synchronous, so whoever creates the entry wins and everyone else in that tick
  awaits the same decision and is told no.
- **It persists.** An in-memory guard alone caps the loop at one pair *per
  launch*, which is exactly the observed pattern: one pair on the 7th, one on
  the 8th, one on the 10th, two on the 11th.
- **Only a provable expiry burns.** See the diagram — this one is the difference
  between fixing a loop and inventing a lockout.

Burning means *do not send this again*. It does not delete the session: the next
successful refresh mints a token with its own, unburned, fingerprint.

The marker is a **fingerprint** (FNV-1a over the token), not the token, and it is
registered in `MANAGED_KEYCHAIN_KEYS` — a key written outside that list gets the
default keychain accessibility and is unreadable before first unlock, which on a
background refresh would mean re-sending a token already burned.

### Severity — why six refusals stopped being six problems

`backend/lib/authOutcomeSeverity.js` is **one** classifier read by three
callers: the overview counter, the incident list, and the alert email. Three
levels:

| | meaning | counted? |
| --- | --- | --- |
| `info` | expected; the system handled it | **no** |
| `warn` | worth reading if it repeats or spikes | yes |
| `critical` | broken now; every sign-in of that shape is failing | yes |

**Severity is decided on the `detail`, never on the reason alone.** Same
`verify_threw`:

- `"Token used too late"` → **info**. The app refreshes and retries; the shopper
  sees nothing.
- `"Wrong recipient"` → **critical**. An audience mismatch never heals on its
  own and nobody on that platform can sign in while it lasts. It cost a four-day
  outage once.

A classifier reading only the reason paints those the same colour — which is
precisely what the console was doing. A group rolls up to its **worst** row, so
one mismatch among two hundred expiries is an outage; and `needsAction` counts
only the rows that qualify, so that group reports `1`, not `201`.

`overview.authFailures` is now the **actionable** count; the raw row count is
`authFailuresTotal`, and the Dashboard shows both. Classification happens in JS
over a grouped `(reason, detail)` read rather than in SQL, deliberately: a second
copy of the rule written in Postgres regex is a copy that drifts.

---

## 2 · RevenueCat: a verdict that contradicted its own evidence

`rcChecks` was `{ webhook, syncApi }` — no `status`. Every other entry in
`checks` is `{ status, …detail }`, so `statusTone(undefined)` fell through every
branch to `"bad"` and the pill printed `check.status || "?"`.

**Fixed on both sides**, because either alone leaves the trap set:

- **Server** — `revenuecat` carries a roll-up `status`, and it is a
  *conjunction*: both write paths must work or purchases leave no DB trace, so
  one configured path is `degraded`, never `configured`. A route test asserts
  every check in the payload carries a non-empty status.
- **Client** — `statusTone()` has an explicit `unknown` bucket. A check with no
  status renders greyed out, spelled `unknown`, and is **left out of the failing
  count**: a gap in our reporting is not an outage to page somebody about. An
  unrecognised status *word* is still `bad` — that is a different thing from no
  answer at all.

---

## 3 · Quotas: three states, not two

The probes in `backend/lib/quotaProbes.js` returned `null` for both "no token"
and "the call failed". The work those imply is opposite — *add* a variable, or
*fix* one — and the screen could not tell them apart.

| probe result | `source` | the row says |
| --- | --- | --- |
| `null` | `declared-cap` | `Ceiling 10 GB · no live reading` + **the variable to set** |
| `{ used, limit }` | `api` / `measured` | `16 of 500 MB` + the percentage |
| `{ error }` | `probe-failed` | `the live reading failed` + **the provider's own complaint** |

A cap-only row is **not** an error and is not painted like one — it is a real
ceiling we know the number of and cannot currently measure against. A `fail` row
is the one worth fixing. Neither prints a `?`, in any pill, ever.

Failures are cached for 60 s rather than the 5 min a success gets, so a token
fixed at the provider shows up on the next refresh instead of five minutes later.

### The variables, for the three that are blank

| row | needs |
| --- | --- |
| `r2_storage` | `CLOUDFLARE_API_TOKEN` **and** `CLOUDFLARE_ACCOUNT_ID` (optional `R2_BUCKET` scopes it to one bucket) |
| `railway` | `RAILWAY_API_TOKEN` |
| `sentry_events` | `SENTRY_AUTH_TOKEN` **and** `SENTRY_ORG` (org is `prosoft-inc`) |

Each is echoed into the payload as `requires`, so the screen names it rather than
making anyone grep the server. **If a variable is already set and the row is
still blank, it now reads `fail` and carries the reason** — that is the whole
point of the third state.

---

## 4 · The console, regrouped

It had grown into a flat pile of "Triage" and "Tools" with no principle, so
finding the tag queue meant reading eleven rows. Now: grouped by what a row **is**,
most-used group first.

| | group | rows |
| --- | --- | --- |
| 1 | **Product** | Tag reviews · Flyer scan · Barcode feeder |
| 2 | **Accounts** | Accounts · Manage credits · Credit drift |
| 3 | **Dashboard** | Activity dashboard (24h / 7d / 30d) |
| 4 | **Reports & upkeep** | Shopper report · Data cleanup · Quotas |
| 5 | **Health & incidents** | Service health · Incidents |

Above them, unchanged, the verdict card and the **Needs action** block — the
reason the console exists.

**Health and incidents are two screens now.** "Is a dependency down" is a state
you check; "what refused whom at 09:58" is a trail you read. Sharing one screen
meant scrolling past nine dependency rows to reach the evidence, every time.

- **Service health** — the dependency verdict, the billing diagnostic, push
  delivery, the Sentry crash probe, and the in-app diagnostics switch.
- **Incidents** — the code decoder, sign-in refusals with severity, cron health.

**One duplicate was removed.** "Find a shopper" and "Shopper report" were the
same destination (`AdminUserReport`) under two names in two sections. A test now
asserts no route is listed twice.

**Quotas moved to the root.** They were the last section of the incident screen,
below everything, on a screen nobody scrolls to the bottom of. A ceiling you only
see while already investigating an outage is a ceiling you find out about by
hitting it.

**Reachability is transitive now.** The billing diagnostic moved one level down,
into Service health. The test that guards "nothing became unreachable" follows
one hop rather than demanding every route sit on the front door — otherwise it
would fail on a correct change, or push rows back to the root to satisfy itself.

### The environment banner

`PRODUCTION · xjfrlzwonyaorwktnkpj` was the most precise identifier available and
almost the least useful one: twenty characters of base32 differing from the
development ref in ways nobody can spot, on the line whose entire job is being
unmistakable.

It now says what you are touching — **Live shoppers** / **Test data** — with the
ref, host, database and port one tap away in a bubble, alongside the sentence
that matters (*"Real accounts, real receipts, real money. Changes here reach
people."*). The ref is what you need when *checking* something, which is the
right distance for a value you look up rather than read.

---

## 5 · Troubleshooting surfaces: what moved, what could not

**Moved.** The Notifications page carried a "Troubleshooting" card — permission
state, server registration, send-a-test. It was already admin-gated, so no
shopper lost anything; what changed is that admin plumbing is no longer hiding
inside a page built for people who want to turn alerts off. It is now on Service
health, in plain English (admin screens are exempt from translation; its i18n
keys stay in the bundle rather than being deleted).

**Could not move, and why.** Two surfaces describe *the receipt in front of you*:
ScanScreen's raw-OCR dump and DetailScreen's cache filename. The console has
nothing to attach them to, and the raw OCR text is how every Costco parser bug so
far has been found — on a real device, against a real receipt.

They got a **switch** instead: *Service health → Show diagnostics inside the
app*. Two properties are guarded by tests:

- **The gate is a conjunction resolved in one place** —
  `showInAppDiagnostics()` is admin **and** the toggle. Neither screen composes
  it itself; the expensive half to forget is the first one, and forgetting it
  renders a raw OCR dump on a shopper's screen.
- **It defaults ON.** It replaces something already visible to admins.
  Off-by-default would be a silent regression: you would open a bad parse, see
  nothing, and have no reason to suspect a new switch exists.

---

## What is NOT in this change

- **The Sentry crashes.** New unhandled errors were reported in
  `prosoft-inc / priceback-canada` and are **not** addressed here — no Sentry
  token is reachable from the working environment, so they could not be read.
  Tracked as a follow-up.
- **`authedFetch` still fires when the token is withheld**, sending no
  Authorization header and recording `auth_required`. Short-circuiting it would
  touch every call site in the app, which is not a hotfix-shaped change — and
  `auth_required` is classified `info`, so those rows cannot create a false
  alarm.
- **No version bump.** This is not a release; the next store build picks it up
  under the release-tagging rule as usual.
