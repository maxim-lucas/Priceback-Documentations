# Security Audit — 2026-09-17 (run 2)

**Scope as requested:** a full, deep security audit of **`main`**, with the critical
findings fixed, and an explicit answer to the question *"is there a potential security
data leak?"*

**Scope as performed: `main`.** The branch was extracted with `git archive main` into a
scratchpad tree and audited there, so the `development` working tree could not be
mistaken for it. This is deliberate: **that mistake is what run 1 was about.**

> **This file was written before a single fix was committed, and pushed on its own.**
> Run 1's findings lived only in commit messages on a branch that was never pushed, and
> two of them — M7 and M10 — are permanently unrecoverable as a result. The table below
> does not depend on any commit surviving.

**Previous audit:** [`Security_Audit_2026-09-14.md`](./Security_Audit_2026-09-14.md)
(run 1) — CI hardening, secret-scanner integrity, payload caps, rate-limit coverage,
dependency triage. Reached `main` retroactively via PR #338.

---

## The headline: one real cross-user data path, and it is not where run 1 looked

Run 1 covered rate limiting and payload caps on the device-keyed routes. It did not ask
the ownership question. **Two routes answer it wrong**, and combined with a third defect
in how the client mints its device id, they let one user read another user's purchase
history.

Everything else in the "can data leak" category came back clean, including the two
places most likely to hold a real breach: there is **no hardcoded secret anywhere in
either repository**, and the production database is **unreachable** from Supabase's
public API surface.

---

## Findings

Severity is this audit's own. Run 2 found **0 Critical, 3 High, 8 Medium, 10 Low.**

| # | Finding | Severity | Status |
|---|---|---|---|
| H-1 | Device-row takeover exposes another user's purchase history | **High** | FIXED |
| H-2 | `deviceId` is not the capability token the backend assumes | **High** | FIXED |
| H-3 | Postgres TLS certificate validation disabled in production | **High** | FIXED |
| D-1 | Mobile dependency criticals carried an unverified acceptance | High (process) | TRIAGED |
| M-1 | `DELETE /api/me/observations` unauthenticated + unthrottled | Medium | OPEN |
| M-2 | `isAdminContributor` trusts a client-supplied `deviceId` | Medium | OPEN |
| M-3 | No pre-handler throttle; 10 MB parsed before any limiter | Medium | OPEN |
| M-4 | `cors({origin:"*"})` defeats per-IP brakes by construction | Medium | OPEN |
| M-5 | Apple ID tokens with no `nonce` are accepted | Medium | OPEN |
| M-6 | Receipt `objectKey` validated by prefix, not equality | Medium | OPEN |
| M-7 | Membership number + postal code in plaintext AsyncStorage | Medium | OPEN |
| M-8 | AsyncStorage rides iCloud backups, outside the retention window | Medium | OPEN |
| L-1…L-10 | See *Low findings* below | Low | OPEN |

---

### H-1 — Device-row takeover exposes another user's purchase history

`backend/server.js:5547` (`POST /api/device/sync`), `:5575` (`POST /api/device/scan`),
`backend/repos/devicesRepo.js:52-75`.

Six routes accept a client-supplied `deviceId`. Four of them call `callerOwnsDevice`
before acting. **These two do not** — and the repo function they call rewrites the owner
column unconditionally:

```js
function _ownerClaim(ownerSub) {
  return ownerSub ? sql`${ownerSub}` : sql`${devices.ownerSub}`;
}
```

Last writer wins, with `owner_claimed_at` re-stamped to `now()`.

**The attack, end to end:**

1. Attacker signs in with their own account and calls
   `POST /api/device/sync {deviceId: <victim's>, localScanCount: 0}`.
   `devices.owner_sub` is now the attacker.
2. `GET /api/me/data-export?deviceId=<victim's>` — `callerOwnsDevice` now returns true,
   so the response carries the victim's device row **and**
   `crowdRepo.contributionsForDevice`: every price observation that device ever
   contributed, with SKUs, prices, warehouse, province and dates. That is a
   purchase-behaviour profile of another person.
3. `DELETE /api/me/account {deviceId}` hard-deletes the victim's device row.
4. Permanently: `callerOwnsDevice` now returns **false for the real owner**, so the
   victim can no longer export or erase their own device data — a data-rights denial on
   a PIPEDA / Law 25 surface.

The `revokeForDevice({since: claimedAt})` bound added in PR #341 limits step 3's
*observation* deletion to post-claim rows. It does not touch the read in step 2, the
device-row deletion, or the lock-out.

**Why it was missed:** `devicesRepo.js:36-37` justifies the transfer on the grounds that
an attacker "must first obtain a hashed device id that is never published, logged or
returned by any endpoint." That premise is H-2.

---

### H-2 — `deviceId` is not the capability token the backend assumes

`src/services/purchaseService.js:496-555`.

```js
let hardwareId = "";
try {
  if (Device.osName === "Android" || ...) hardwareId = Application.getAndroidId?.() || "";
  else hardwareId = await Application.getIosIdForVendorAsync?.() || "";
} catch {}

if (hardwareId) { parts.push(hardwareId); }
```

`hardwareId` is appended **only when truthy**, and all three ways it can come back empty
— API absent, empty string, throw — are silently swallowed. On that path the id is

```
SHA256("Samsung|SM-G991B|13|8")
```

four low-entropy hardware attributes. Two consequences:

- **Enumerable.** Precompute the hash for the top few thousand brand/model/OS/RAM tuples
  and you have a working deviceId list to run H-1 against.
- **Colliding — and this one needs no attacker at all.** Every user with the same phone
  model, OS version and RAM shares one device row. One user's
  `DELETE /api/me/observations` erases another's contributions.

The further fallbacks are worse: `btoa(parts.join("|")).slice(0,32)` (line 541) is
trivially reversible, and `fallback_${Date.now()}_${Math.random()...}` (line 546) is
`Math.random()`-seeded.

This is recorded as a backend finding as much as a client one. `backend/server.js:7554-7559`
documents `callerOwnsDevice` as safe *because* the deviceId "behaves like a secret
capability token". **The generator does not honour that sentence, and the sentence is
load-bearing for six routes.**

---

### H-3 — Postgres TLS certificate validation disabled in production

`backend/db/client.js:106-108`:

```js
_pool = new Pool({
  connectionString: normalizeConnectionString(rawConnectionString),
  ssl: { rejectUnauthorized: false },
```

Unconditional. No environment branch, no comment anywhere justifying it. The surrounding
comment (lines 35-42) claims this "pins our TLS behavior so it can't drift" — it pins it
to the weakest available setting.

The connection is encrypted and the server is **never authenticated**, so TLS provides
confidentiality against a passive observer and nothing at all against an active one. An
attacker positioned on the Railway→Supabase path — BGP hijack, compromised transit, DNS
poisoning of the pooler hostname, a compromised host in either provider's network —
presents any self-signed certificate and the pool accepts it.

**Blast radius is the whole database, in both directions.** Every statement flows through
the attacker: user emails, `user_sessions.refresh_token_hash` (which is a *sufficient*
credential for `rotate()`, so the at-rest hashing in `sessionsRepo` is undone in transit),
`credit_ledger`, receipts. And it is a write channel — subscription tiers can be forged
and rows injected.

Supabase publishes a CA bundle, so the fix costs nothing but the pinning.

---

### D-1 — the mobile dependency acceptance was never verified

`npm audit --package-lock-only --omit=dev` on `main`:

| Tree | critical | high | moderate |
|---|---|---|---|
| Backend (production) | 0 | 0 | 7 |
| **Mobile (production)** | **1** | **12** | 16 |

The critical is `shell-quote`; the highs are `metro`, `@expo/metro`, `metro-config`,
`metro-transform-worker`, `@xmldom/xmldom`, `brace-expansion`, `browserslist`,
`image-size`, `js-yaml`, `nanoid`, `postcss`, `ws`. **Every one reports
`fixAvailable: true`.**

`.github/workflows/test.yml` treats the mobile audit as informational, reasoning that
Expo lists its build toolchain under `dependencies` so these "never execute in the
shipped app". That reasoning is probably correct — but it is exactly the shape of
sentence run 1 caught being **false** for `nanoid` and `decode-uri-component`, which do
ship inside react-navigation. An accepted risk is only accepted while its reasoning
holds, and this one had never been checked.

See *Verification* for the measured result.

---

## Medium findings (open — follow-up PR proposed)

**M-1 — `DELETE /api/me/observations` is unauthenticated and unthrottled.**
`backend/server.js:5503-5532`. The ownership check is gated on `authUser?.sub` being
present, so **sending no `Authorization` header skips it entirely** — and `claimedAt` is
then `null`, so `revokeForDevice` runs unbounded and deletes everything the device ever
contributed. Presenting a token is strictly worse for the attacker, which is an inverted
incentive. It is also the only destructive route in the file with no rate limiter.

**M-2 — `isAdminContributor` trusts a client-supplied `deviceId`.**
`backend/server.js:3620-3635`, reached from two unauthenticated routes (`/api/watch:2611`,
`/api/observations/tag:3722`). With no bearer token, the caller's *claimed* deviceId
alone decides whether an observation is stamped `adminVerified: true`, which bypasses
rule-of-N corroboration. Forged prices then fire real price-drop pushes and **charge
users credits** for drops that never happened. Note the asymmetry: the push block 200
lines later deliberately refuses the device fallback; the privilege decision — the more
sensitive of the two — kept it.

**M-3 — no pre-handler throttle.** `express.json({limit:"10mb"})` at `server.js:50`
buffers and parses before any limiter runs, and every limiter in the codebase is a line
inside a handler. Unauthenticated 10 MB bodies to any path — including nonexistent paths
that fall through to the 404 handler, which has no limiter at all — cost a full
allocation and parse each. Secondary: all limiters are per-process in-memory `Map`s, so
budgets reset on redeploy.

**M-4 — `cors({origin:"*"})` defeats the per-IP brakes.** `server.js:51-55`. The stated
reasoning is sound as far as it goes (Bearer-only auth, no cookies, `credentials` false —
all verified). What it misses: any web page can drive `/api/ocr`, `/api/analytics` and
`/api/check-price` from its visitors' browsers, and because each request comes from a
*different visitor IP*, `clientIpForRateKey` — the primary defence on those routes — is
defeated by construction. A native app sends no `Origin`, so deny-by-default costs
nothing.

**M-5 — Apple ID tokens with no `nonce` are accepted.** `backend/lib/appleAuth.js:228-231`.
A documented rollout decision, and the reasoning is correct (a claim cannot be stripped
from a signed token). Residual: a legacy token is a pure bearer credential for ~10
minutes, and replaying one to `POST /api/auth/session` mints a **60-day** rotating
refresh token. `appleNonceStats` exists to drive the decision to make the nonce
mandatory; the gate is still open.

**M-6 — receipt `objectKey` validated by prefix, not equality.** `server.js:8556` uses
`startsWith`; the price-tag twin at `:4005` uses exact equality. `body.id` is never
shape-validated (`:8497`), so a `..`-bearing id composes a key that satisfies the prefix
check. Exploitability is genuinely uncertain — object stores treat keys literally and
most clients normalize `..` before signing — but "the same fix applied to one of two
identical routes" is a defect class this repo has already paid for twice, by its own
comments at `:1528-1532` and `:8484-8488`.

**M-7 — PII in plaintext AsyncStorage.** `receipts_v2` holds full receipts including the
**Costco membership number**, `rawOcr` and `headerOcr` (store street address, postal code,
phone); `user_prefs_v1` holds postal code and province. Readable on a rooted/jailbroken
device and by forensic tooling. The membership number is otherwise handled well — stripped
from OCR text and word geometry, and no longer transmitted — the gap is that "local-only"
means "local and unencrypted".

**M-8 — AsyncStorage is not in the iOS backup exclusion.**
`plugins/withIosBackupExclusion.js` excludes `Documents/receipts/`,
`receipts_pending/` and `tags/`, with a header explaining that a photo in an iCloud
backup "makes the published retention window untrue". The identical argument applies to
`Documents/RCTAsyncLocalStorage_V1`, which is **not** excluded — so the M-7 PII does ride
encrypted iCloud backups, outside the retention schedule. Android is covered
(`allowBackup: false`).

---

## Low findings (open)

| # | Finding | Location |
|---|---|---|
| L-1 | `/health?token=` is an unthrottled admin-token compare, and puts the secret in a query string (edge logs, `Referer`) | `server.js:3402-3423` |
| L-2 | Reviewer access code mints a full-capability session with no scope, no expiry and an IP-only throttle | `server.js:5845-5921` |
| L-3 | `/api/analytics` egress has **no PII scrubber** — the Sentry sink is scrubbed, our own sink is not. Dormant: `reportCrash` has zero call sites | `analyticsService.js:320-401` |
| L-4 | `e?.message` echoed to the client on two admin routes — a `DrizzleQueryError` would put raw SQL in the response | `server.js:5000`, `:5020` |
| L-5 | Sentry scrubber does not walk `tags`, `transaction` or `request`; no pattern for a bare membership number or a non-`Bearer` JWT | `analyticsService.js:118-145` |
| L-6 | Push payloads carry product name + receipt id through Expo/APNs/FCM and onto a lock screen | `priceDropNotifier.js:271-290` |
| L-7 | Receipt ids are `Date.now()` + ~60 M suffix; `hashDeviceId` is **unsalted** sha256 (contrast the salted IP hash in `audit.js`) | `storageService.js:186`, `warehousePricing.js:30-32` |
| L-8 | `LIKE` metacharacters unescaped in admin product search (leading-wildcard scan); `usersRepo.js:191-194` does it correctly | `pricesRepo.js:248` |
| L-9 | `priceback.touch_updated_at` has a mutable `search_path`. `SECURITY INVOKER`, so low | Supabase advisor, both projects |
| L-10 | GitHub Actions pinned to mutable tags (`@v5`) while the one third-party binary is SHA-pinned | `.github/workflows/*.yml` |

---

## Verified clean — the negative results

These were checked and found correct. They are recorded so the next audit does not spend
its budget re-deriving them.

### The database is not reachable from the internet

Direct privilege query against the **production** project (`xjfrlzwonyaorwktnkpj`):

| role | USAGE on `priceback` | SELECT `users` | SELECT `receipts` |
|---|---|---|---|
| `anon` | false | false | false |
| `authenticated` | false | false | false |
| `service_role` | false | false | false |
| `authenticator` | false | false | false |
| `postgres` | true | true | true |

App tables live in the `priceback` schema, which PostgREST does not expose, and no
Supabase API role holds so much as schema USAGE. **A leaked Supabase anon key exposes
nothing.** The mobile app never talks to Supabase directly — only the backend does, over
a Postgres connection string. Supabase's own security advisors report one WARN on both
projects (L-9) and nothing else.

*Noted, not fixed:* the backend connects as `postgres`, the superuser role. A dedicated
application role with DML-only rights on `priceback` would bound the damage from any
future SQLi or RCE. Filed as a hardening item, not a finding — nothing today exploits it.

### No secret is committed, in either repository

Full-tree sweep of both repos for `sk-`, `sk_live`, `pk.eyJ`, `AIza`, `AKIA`, `ghp_`,
`xox[baprs]-`, `SG.`, `-----BEGIN * PRIVATE KEY`, `postgres(ql)://`, `mongodb://`,
`https://user:pass@`, plus bulk extraction of every quoted opaque literal ≥28 chars.

Every credential-shaped hit is one of: **public by design** (Google OAuth *client ids* —
not secrets, and no `client_secret` exists in the tree; the Sentry DSN, which is
write-only ingest; RevenueCat public SDK keys; the OTA *public* verification cert), a
`YOUR_*` placeholder, or an obvious test fixture.

**The documentation repo is clean too.** Every `postgresql://` in it is a
`<ref>`/`<password>` placeholder; both `BEGIN PRIVATE KEY` hits are a documentation
example and a narrative sentence about a test fixture.

### No injection of any class

- **SQL:** all five `sql.raw` sites are in `dataCleanupRunner.js` and take module
  constants or keys validated against `/^[a-z][a-z0-9_]*$/`. Every client-supplied value
  into that subsystem was traced: `key` is a lookup, never interpolated; `minAgeHours`
  reaches `make_interval` as a **bound parameter**; `limit` is clamped. All 36 `orderBy`
  sites are static column references. No dynamic column names anywhere.
- **Command:** `child_process` appears only in developer/CI scripts, always
  `execFileSync`/`spawnSync` with array argv. **Zero occurrences reachable from a request
  handler.**
- **Path traversal:** every `path.join` under `DATA_DIR` uses a constant filename; the
  analytics pruner filters `readdirSync` through a strict regex before unlinking. No
  request value reaches any filesystem path. No `express.static`, no `res.sendFile`.
- **Prototype pollution:** no recursive merge exists in the tree; no `...req.body` spread
  into shared state.
- **ReDoS:** server-side parsers are flat alternations with no nested quantifiers. Two
  client-side regexes are mildly quadratic on locally-captured OCR text — self-DoS at
  worst.

### Session and identity handling is exemplary

256-bit `crypto.randomBytes` refresh tokens, stored **hashed**; `alg` and `typ` pinned on
verify (blocking `alg:none` and RS256→HS256 confusion, and stopping a refresh token
authenticating a request); constant-time compare; rotate-on-use inside one transaction
under a `pg_advisory_xact_lock`; reuse of a revoked token burns the whole family; and a
lost-response grace window whose security condition is clock-*independent*. Uniform
opaque 401s throughout, so no token-liveness oracle.

Apple and Google ID tokens are fully verified — signature against live JWKS, `alg`
pinned, `aud` **required** (`verifyAppleIdToken` throws without it), `iss`, `exp`, `iat`
with skew. A token carrying a nonce with no header supplied is a **rejection, not a
fallback** — the one detail that would otherwise let an attacker opt out of the check.

### Authorization, everywhere else

All 28 `/api/admin/*` routes (plus `/api/flyer/import` and `/api/check-all`) are gated,
pinned by `adminRoutesAreGuarded.test.js`, which parses `server.js` and asserts the gate
is **the first non-comment statement** in each handler. The admin allowlist fails closed
and no HTTP route can write it.

The entire receipts family and the entire `/api/me/*` family are correctly owner-scoped —
traced to the WHERE clause in each repo function, not inferred from the route. `:index`
is an ordinal *within* an already-owner-scoped item set, never a global row id.
`GET /api/receipts/:id` correctly returns 404 rather than 403, so it is not an existence
oracle.

### Platform and supply chain

Helmet mounted first; `trust proxy` correct for Railway's single hop, with the audit
middleware reading the **rightmost** XFF hop so entries cannot be made unlinkable;
`/health` two-tier with every failure path returning the *same* public payload (no
oracle); RevenueCat webhook constant-time and **fail-closed** when unset; the global
error handler returns a constant string with no stack, SQL or path.

Android `allowBackup: false`, no cleartext traffic, no debuggable override, no exported
components; permissions are actively *stripped* below what dependencies request. iOS has
no ATS exceptions at all and no overclaiming privacy strings. CI is `workflow_dispatch`
only with **no `pull_request_target`**, top-level `contents: read`, `npm ci`, no
`github.event.*` interpolated into any `run:`, and the one third-party binary SHA-256
pinned. `.npmrc` holds a single benign line.

### The Gmail Limited Use gate holds

`src/utils/receiptSource.js` is dependency-free specifically so every egress path can
import it **statically** — its header explains that an `await import()` whose failure
fails *open* would defeat the gate. `isGmailSourcedReceipt` fails **closed** for legacy
rows. Both egress paths are now gated (run 1 found the second one). Gmail-derived content
reaches neither the backend, nor `price_points`, nor the LLM, nor the ads SDK.

---

## Operational actions — outside the repository

1. **Confirm the R2 key rotation.** The Cloudflare R2 secret access key committed at
   `4b41643` (and visible again in the removal diff at `b6c9b11`) is still readable in
   git history. Maxim recalls rotating it several weeks ago; **four documents still say
   it is owed** — `SecurityRecommendations.md:306`, `Security_Audit_2026-08-04.md:183`,
   `PUBLISH_CHECKLIST.md:883`, `Task_Log.md:4514`. One look at Cloudflare → R2 → API
   Tokens settles it, and those four documents should then be corrected.
   Mitigating: **both repositories are private.** CI's gitleaks runs `--no-git` (working
   tree only) by deliberate design, so history is not gated and a purge would not be
   caught by it either way. Rotation is what kills the exposure; a history rewrite
   without it changes nothing.
2. **Move the Firebase admin service-account key.** A `priceback-905d4-firebase-adminsdk-*.json`
   sits unencrypted in `C:\Workspace\`. Outside the repo, so it cannot be committed, but
   it is a live private key on a developer machine.
3. **Consider a least-privilege database role** (see *Verified clean*).

---

## Method

Three parallel read-only passes over the extracted `main` tree, by surface:
authorization/IDOR, sensitive-data exposure, and injection/crypto/platform. Plus a
direct infrastructure pass — Supabase role privileges and security advisors on both
projects, `npm audit` on both trees, git-history secret search, and a sweep of the
documentation repository.

Every finding acted on was re-verified first-hand against the source before any code was
written; the two High findings in client code were read line by line rather than taken
from a summary.

**Negative results are recorded deliberately.** An audit that reports only what it found
gives the next one no way to tell "checked and clean" from "never looked", which is how
the same ground gets re-audited while new ground goes untouched.
