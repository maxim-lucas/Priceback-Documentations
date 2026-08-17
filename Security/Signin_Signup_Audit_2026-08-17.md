# Sign-in / sign-up audit — 2026-08-17

**Scope:** every path that authenticates, creates, or erases an account.
**Trigger:** a four-day Android sign-in outage, plus an explicit request to
re-verify the previous session's work rather than inherit its conclusions.

**Status: PARTIAL.** Sections 1–4 are complete. Section 5 (erasure) is partly
open and Section 6 lists what was not reached. Nothing below is asserted from a
prior session's notes — every claim was re-derived from the code, the live
`/health` endpoints, or the production database.

---

## 0. Two prior conclusions were wrong

**Corrected: the Android root cause.** The recap attributed the outage to
PR #271 (a sign-in returning no ID token stored as success). The production
record disagrees. `priceback.auth_outcomes` id=3, a genuine request:

```
reason  verify_threw
detail  "Token used too late, 1786956387.995 > 1786924107"   ← expired ~9h
aud     …jgr8klsosbt39o0g9vb7s33md08jql72                    ← web client, CORRECT
```

Audience correct ⇒ not Bugs #205. Token present ⇒ not Bugs #206/#271. The real
defect: `refreshIdTokenSilently()` swallowed both failure paths in bare
`catch {}`, and **Google had no interactive re-auth fallback** where Apple has
had one since #253. Fixed in **PR #274**. #271 remains a correct fix for a real
latent bug — it just was not this one.

**Corrected: "all my data are gone."** See §5.

---

## 1. Token verification — PASS

The bearer dispatch (`backend/server.js`, `verifyAuth`) routes on the
**unverified** `iss` claim: session → Apple → Google. That is safe *here*,
because it selects a verifier rather than a trust level, and every branch then
verifies fully. An attacker who sets `iss: https://appleid.apple.com` is routed
to the Apple verifier and rejected there, having gained nothing.

`lib/sessionTokens.js` `verifyAccessToken` was checked specifically for the
classic JWT failures, and holds on all of them:

| check | status |
|---|---|
| `alg` pinned, header `alg` never trusted (`alg:none`, RS256→HS256 confusion) | ✅ |
| signature compared with `crypto.timingSafeEqual`, length-checked first | ✅ |
| `typ` enforced — a refresh token cannot be presented as an access token | ✅ |
| `iss` enforced | ✅ |
| `exp` / `iat` enforced with bounded clock skew | ✅ |

The 503-precedence branch in `requireAuth` consults attacker-controllable
`appleBearer` / `sessionBearer` flags, but only to decide **503 vs. proceed to
verification**. Proceeding is the safe direction, so this is not a bypass.

## 2. Credential lifecycle — FIXED (PR #274)

The shape that produced Bugs #206 — an optional artifact stored
unconditionally beside an `if`-guarded essential one — was searched for across
the auth paths. The remaining instance was the refresh path, now fixed. The new
interactive path carries the same three rails as Apple's, and each is asserted
by test:

- one shared in-flight attempt (five parallel requests ≠ five account pickers);
- a 60 s cooldown, armed on **both** a thrown failure and a **dismissed** sheet
  (`signInWithGoogle` returns `null` for `SIGN_IN_CANCELLED` rather than
  throwing, so a catch-only cooldown misses it entirely);
- an `AppState` foreground gate — `getValidIdToken()` is reached from the daily
  price check and both offline queue drains, where a sheet is a bug.

**Found by the suite, not by review:** `signInWithGoogle` fires three follow-ups
without awaiting them, each reaching `getValidIdToken()`. `isIdTokenFresh` is
false for anything it cannot *parse* as a JWT — not merely for expired tokens —
so a follow-up could open a second account picker over the first. A successful
sign-in now arms the same latch.

## 3. Audience / issuer configuration — PASS

Both services report, live:

```
auth: { status: "configured", audiences: 3,
        clients: { web: true, android: true, ios: true },
        signIn:  { android: true, ios: true } }
```

The health check reports the per-platform **conjunction** (#267), not an OR of
three variables, so a total outage is visible. Audiences default from the shared
`shared/googleOAuthClients.js` module (#270), so the app and the API cannot
drift — which was the actual mechanism of Bugs #205.

`sessions` is now **`configured`** on both services (`SESSION_TOKEN_SECRET` set
this session, ≥32 chars, **distinct per environment**). The precondition the
health check warns about was verified first: `priceback.user_sessions` exists on
production, so it went straight to `configured` rather than `degraded`.

## 4. One account per verified email — PASS

`claimsEmail()` requires **strict** `emailVerified === true` (no truthy
coercion), and `emailVerified` is read from the cryptographically verified token
payload — Google's boolean and Apple's `"true"` string both handled. A session
token deliberately reports `emailVerified: false`, so a long-lived session
cannot re-claim the one-time trial grant. Linking was rejected for a documented
money reason (RevenueCat binds entitlements to the provider sub); refusal plus a
self-lifting block is the correct trade.

## 5. Erasure — one finding FIXED, one question OPEN

### FINDING (fixed, PR #278): the test suite could delete production accounts

`usersRepo.deleteAccount()` is a raw `DELETE FROM users`. **46 test files** call
it as a fixture reset, most as `await deleteAccount(SUB).catch(() => {})` —
which swallows the one error that would say where it landed. With FK cascade it
removes the user and every receipt below it. The only thing separating that from
real accounts was which gitignored `.env` was on the machine.

**This already happened.** Grouping production `price_points` by the *shape* of
`source_ref` (`source_type_id = 2`):

| shape | price points | distinct receipts | window |
|---|---|---|---|
| **`rcpt-*` — test fixtures** | **329** | **192** | 2026-01-01 → 2026-06-20 |
| `other` | 36 | 36 | 2026-06-01 |
| `r_<ts>_` — real app receipts | 15 | **2** | 2026-07-23 → 2026-08-10 |

`rcpt-sanity-*` / `rcpt-baddate-*` are the ids literally constructed in
`backend/tests/receiptPricePoints.test.js`. **The backend suite ran against
production.**

Guarded in `getPool()` — one choke point rather than 46 call sites — matching
both connection shapes (`postgres.<ref>` pooler and `db.<ref>.supabase.co`
direct). Test-run detection is deliberately broad: a false positive costs one
env var, a false negative costs the production database.

### Correction to the alarm that started this

Production's 372 orphaned receipt-derived price points were initially read as
mass data loss. **They are not.** Dev has **15,424** of them against 270 with
live receipts — price points deliberately outlive receipts, so orphans are
normal debris. **The count was never the signal; the `source_ref` shape is.**

And the user only ever had **2 real receipts on production** (2026-07-23,
2026-08-10). The 33 real receipts are on **dev** — real usage happened on
dev-pointed builds.

### OPEN

What removed those 2 receipt rows without touching the user row. Neither
`requestDeletion()` nor `resetData()` can do it — both only soft-delete — and
`deleteAccount()` would have taken the user row with them (it survives, with
`created_at` 2026-06-29). Not yet established; **not** to be attributed to the
schema rebuild without evidence.

## 6. Not reached

- **R8** has never been device-tested in a release build (`adb` unavailable on
  this machine). Any Android-only field failure: R8 is suspect #1.
- **Sentry symbolication** unverified — the `SENTRY_AUTH_TOKEN` in `.env` is
  upload-scoped and returns **403** on the issues API.
- **`appleAuth: degraded`** on both services — the Apple `.p8` is unprovisioned.
  Blocks Sign-in-with-Apple *revocation* on account deletion (Guideline
  5.1.1(v)), not sign-in itself.
- **PR #274 is unconfirmed on a device.** `auth_outcomes` will name the branch on
  the next sign-in attempt: no new refusal row = fixed.

## 7. Verification conditions — read this before trusting the results

**GitHub Actions is billing-blocked** — every job dies in ~3 s with `steps=0`
and no logs. All results here are from **local runs**: the full mobile Jest suite
(4404 tests, 189 suites, green), `i18n:check` (1462/1462 EN+FR), and the two
affected backend files. **The full backend suite was not run.**

---

## Bonus finding: OTA delivery is foreclosed by the EAS plan

Not a sign-in issue, found while trying to deliver the fix. `eas update` code
signing requires the **EAS Enterprise plan**; the CLI hides this behind
`GraphQL request failed`. Since `app.json` sets
`updates.codeSigningCertificate`, every build from 2.8.5 embeds a certificate
and refuses unsigned updates ⇒ **those builds can never receive an OTA on this
plan.**

⚠️ An **unsigned** publish still creates an update group that appears in
`eas update:list` and is silently rejected on device. Verify any publish with
`eas update:view <group> --json` → `codeSigningInfo` must not be `undefined`.

Decision taken: keep code signing, deliver via store builds. **v2.8.9** is
tagged and released for that purpose.
