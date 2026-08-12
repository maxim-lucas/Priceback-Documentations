# iOS audit #7 — a replayable Apple token, a cap that never capped, and a sweep that fired on every glance

_2026-08-12. Branch `audit/ios-pass7-apple-nonce-presign-foreground`. Scope as
asked: security first — authentication, credit management, RevenueCat, account
management, receipt scans, price-tag scans — plus iOS/Android divergence, and
explicitly **not** re-opening what passes #1–#6 already documented._

---

## Why this pass could find anything

Six passes are on record, and the fifth already assembled a full divergence
inventory. So this one deliberately did not re-walk the surfaces those passes
closed. It read the six prior audits first, then went after three kinds of place
they had structurally not looked:

1. **Claims the codebase makes about itself.** Pass #6 closed the receipt presign
   (M2) on the strength of a comment asserting the price-tag twin already did the
   same thing. Nobody checked the tag client. That comment was false, and had been
   for two audits. **A2 below is the cost of trusting a comment as evidence.**
2. **The primitives that were verified as correct, for the checks they do not
   perform.** Pass #6 verified `lib/appleAuth.js` thoroughly and correctly — RS256
   pinned, `kid` required, live JWKS with one rotation refetch, `iss`/`aud`/`exp`/
   `iat` with skew. Every one of those findings stands. What no pass asked was
   whether the token was bound to the *client that requested it*. It was not.
   **A1.**
3. **Platform behaviour with no `Platform.OS` to grep for.** Pass #5's implicit
   divergence table is the right idea; `AppState` is a divergence it did not
   contain, because nothing in the code marks it as one. **A3.**

Five defects. All five are fixed here.

---

## Findings at a glance

| # | Severity | Area | Defect |
|---|---|---|---|
| A1 | **Medium-High** | Auth (iOS-only) | Apple identity token carried no `nonce` → replayable, and on iOS replay escalates to a 60-day session |
| A2 | **Medium** | Price-tag scans | The tag presign was never capped, and a comment in the twin said it was |
| A3 | **Medium** | iOS/Android parity, cost | Foreground sync sweep fired on every transient iOS interruption |
| A4 | Low | Credits | `flagged` blocked spending credits but not earning them |
| A5 | Low | iOS background | 24 h `minimumInterval` left the daily price check near-inert on iPhone |

---

## A1 — Sign in with Apple was not bound to the device that asked for it

`signInAsync({ requestedScopes })` was called with no `nonce`, and the verifier
never looked for one. `grep -n nonce` across the client, `lib/appleAuth.js` and
`server.js` returned **nothing**.

**What was still protecting us.** The audience is pinned to `com.priceback` and
`exp`/`iat` are enforced with 60 s skew, so a token minted for a *different* Apple
app could never authenticate here. That is real and it rules out the cross-app
attack entirely.

**What was not.** Anything able to *observe* one of our own tokens — a hostile
proxy with a trusted root on a shared network, a compromised handset — could
replay it as that user. The app pins no certificates.

**Why ten minutes was not the real exposure.** The token is accepted at
`POST /api/auth/session`, which mints a **60-day** rotating refresh token. So the
window to replay was ten minutes; the prize was two months of account access,
against an account that holds receipts, purchase history and a credit balance.
That escalation is what moved this from "worth hardening eventually" to the
headline finding of the pass.

### The fix, and the one detail that decides whether it works

The standard OpenID binding: the client generates a random raw nonce, hands Apple
`SHA-256(raw)`, and sends the **raw** value to the backend out-of-band on
`x-apple-nonce`. The token is then useless to anyone who does not know the
plaintext.

The direction of the hash is the part that has to be right, and it depends on a
behaviour worth verifying rather than assuming. Apple embeds the string it is
given **verbatim** — confirmed against the module source,
`expo-apple-authentication/ios/AppleAuthenticationRequest.swift:31` is
`request.nonce = options.nonce`, with no hashing of its own. Had the library
hashed, hashing again client-side would have produced a permanent mismatch. A test
pins the direction, because handing Apple the raw value would publish the secret
inside the very token it is meant to protect.

### The rollout is staged, and the staging is not a soft option

**Accept-if-present.** The token itself says which client generation minted it,
and an attacker cannot strip a claim from a signed token. That single fact is what
makes a staged rollout safe rather than decorative:

- **no `nonce` claim** → a pre-A1 build → allow, and count it. This is the escape
  hatch that stops an enforcement bug locking out every TestFlight tester;
- **`nonce` claim present** → the minting client is nonce-aware → the raw value
  **must** be supplied and **must** match. A missing header here is a **rejection**.

That last line is the whole thing. Treating a missing header as "legacy" would let
an attacker opt out of the check by simply not sending it — which is the attack.
`appleAuthNonce.test.js` pins it as its own case.

`/health` (admin payload) now reports `appleAuth.nonce: { verified, legacy,
enforcement }`, so the flip to mandatory is made on data rather than on a guess.
Same report-never-enforce shape as pass #6's H2; `healthy` does not read it.

### What the existing suites caught, and why it mattered

The first implementation passed the digest through unvalidated. Under jest-expo's
native mocks `digestStringAsync` resolves to an empty string, so two pre-existing
Apple suites went red with `nonce: ""`.

That was not a test-environment artifact to work around. An empty nonce is
**strictly worse than no nonce**: Apple returns a token carrying an empty `nonce`
claim, which is not null, so the backend takes its *enforced* branch and compares
`sha256(raw)` against `""` — a guaranteed mismatch on every request. Every Apple
sign-in would have 401'd. `_newAppleNonce` now validates both halves and throws on
anything that is not 64 hex characters, which routes to the caller's catch and
signs in unbound. **The old tests found a shipping-severity bug in the new code;
the fix was in the source, not in the assertions.**

### Every path that mints a token now mints a nonce

Three call sites, and missing one would have been a silent 401 loop rather than a
visible failure:

- `signInWithApple` — first authorization;
- `refreshAppleIdTokenInteractive` — re-authorization after the ~10-minute expiry;
- `_freshAppleAuthorizationCode` — the **account-deletion** flow, which mints a
  token the very next call uses. This is the path App Review walks for Guideline
  5.1.1(v), and it was the easiest of the three to overlook.

The nonce is written and cleared in lockstep with `auth_id_token`, including on
sign-out. A stale raw nonce paired with a token that never carried its digest is
refused by the server, so **absent must overwrite, not be skipped** — its own test.

---

## A2 — the price-tag presign was never capped, and the codebase said otherwise

`submitPriceTagObservation` built its payload without `imageBytes`. The server
reads exactly that field (`server.js:3352`), and `imagePresignDecision` maps an
absent declaration to an **unbounded** presigned PUT. So audit #4's S4 cap
(`MAX_TAG_IMAGE_BYTES`, 12 MB) had never once been enforced by any build that has
ever shipped.

The interesting part is the paper trail. `receiptSyncService.js` carried:

> "Declare the image size … — **the price-tag path has done this since audit #4's
> S4**, and the receipt twin was minting unbounded upload URLs."

That belief is why pass #6 closed the receipt half and never looked at the tag
half. And it happened *inside* the fix for Bugs #189, whose own lesson is "the
same hardening applied to one of two twin routes" — the shared
`imagePresignDecision` was introduced precisely so the twins could not drift, and
the twins drifted anyway, on the client side where the shared function could not
reach.

Fixed: the tag path now stats the file and declares `imageBytes`, mirroring
`receiptSyncService` exactly, including its best-effort shape (any failure omits
the field rather than guessing). The false comment is corrected in place.

Authenticated-only since S4, so this was authenticated abuse rather than an open
door — a signed-in account could write an object of arbitrary size into the
production bucket.

---

## A3 — the foreground sweep fired on every transient iOS interruption

`App.js` ran its sweep on `state === "active"` with no memory of where the app had
been.

Android only ever moves active ↔ background, so it always saw a genuine
foregrounding. iOS also has `inactive`, and enters it for a Control Centre pull, a
notification-shade drag, an app-switcher half-swipe **and every system permission
dialog** — the same iOS behaviour pass #4's P3 documented when it declined to ship
the snapshot overlay. Each of those ends with another `→ active`.

So on iPhone the whole block re-ran twice per scan (camera prompt, location
prompt) and once per glance at Control Centre. Only the hydrate was throttled
(5 min). The other seven actions were not: both offline queue drains, the pending
receipt/tombstone retries, `flushPendingTopupConfirms`, `flushProfileSync` and
`syncStorePurchasesOnForeground`.

**The concrete cost.** `syncStorePurchasesOnForeground` calls RevenueCat
`syncPurchases()` and then posts to `/api/me/subscription/sync`, which is
rate-limited to **10/min per account** (`server.js:5445`). A paying iPhone user
could 429 their own subscription reconciliation just by walking through a scan.

### Why checking the previous state does not work

This is the trap worth recording. iOS reports `background → inactive → active` on
a **genuine** return — so the state immediately before `active` is `inactive` in
both the real and the transient case. A previous-state comparison cannot tell them
apart, and the first draft of this fix got it wrong for exactly that reason.

What separates them is whether `background` was ever reached. The gate therefore
needs *memory*, not a comparison, and it lives in `src/utils/foregroundGate.js` as
a real module rather than inline in `App.js` — so the test exercises the shipped
logic instead of a copy of it that would keep passing after `App.js` drifted. That
is the same failure mode as A2, applied to a test instead of a comment.

Two deliberate exclusions:

- **`clearBadge` stays ungated.** It is one cheap native call with no network
  cost and the only thing here the user can see on their home screen, so it keeps
  its original every-foreground behaviour.
- **The 60 s poller now stops only on `background`**, not on `inactive`. Tearing
  the interval down on every interruption restarted its countdown from zero, so a
  user interrupted more often than once a minute — ordinary during an in-store
  scan — never reached a single tick.

---

## A4 — `flagged` stopped the spending and ignored the earning

`users.flagged` is the manual/admin fraud brake. It guarded `POST /api/receipts`
and `POST /api/me/credits/offline-scans` — both **spends**. Every path that
*mints* credits ignored it: the price-tag settlement and `/api/me/referral/redeem`.

An account under investigation for credit farming was therefore free to keep
farming. The balance simply accumulated out of reach, and every credit was waiting
the moment an admin cleared the flag. Referral redemption is the worse of the two,
because its payout is real credits to a **third party** — so a flagged account
could direct value outward while being investigated.

**The deliberate non-symmetry.** A flagged user's tag observation is still
accepted and still corroborates other shoppers' scans. The price data is not what
is under suspicion — the payout is. Discarding it would punish the crowd for one
account's flag and silently lose real price data a later unflag could not recover.
So the settlement runs with `callerSub: null`, which pays every *other* eligible
contributor normally and omits this one — the same split `resolveScanOwner`
already makes when there is no account to credit at all.

The status reuses the existing rule-6 `flagged_review` rather than inventing one:
both mean "accepted, under review, no credit", the client already renders it in EN
and FR, and a flagged user learning *which* signal caught them is a hint worth
withholding. Referral redemption answers `403 ACCOUNT_FLAGGED_FOR_REVIEW`, mapped
to new EN/FR copy (`profile.referralFlagged`) at both call sites — a raw code must
never reach a shopper.

`_isFlaggedSub` fails **open**, deliberately, and that is the opposite of
`callerOwnsDevice` next to it. There, failing open would hand one user another
user's data. Here, failing closed would withhold credits someone earned because
Postgres hiccuped.

---

## A5 — the daily price check asked iOS for a 24-hour floor

`minimumInterval: 24 * 60 * 60` is a real period on Android (WorkManager honours
it). On iOS it is a **floor**, and iOS decides when a BGAppRefresh task actually
runs from its own usage budget — so the earliest permitted run was a day away, on
a platform that also stops the task entirely after a force-quit, suspends it in
Low Power Mode, and ignores `stopOnTerminate`/`startOnBoot` completely.

Now platform-split: 24 h on Android, 2 h on iOS, which lets iOS schedule
opportunistically and can never make the task run *more* often than iOS allows.

This refines the "iOS background execution is materially weaker" item carried
since pass #4 with a cheap lever, but **does not close it**: `checkAllPriceDrops`
still runs only inside that task and still has no foreground equivalent. That
remains a feature decision, not a defect fix. **Unverifiable without a handset.**

---

## Verified clean in this pass

Recorded so pass #8 does not re-investigate.

- **HEIC is a non-issue**, checked because the tag path uploads the *original*
  capture rather than a resized copy. `expo-image-picker` transcodes to JPEG on
  iOS, and the OCR path additionally forces `SaveFormat.JPEG`. No HEIC reaches
  Google Vision or the object store.
- **Credit top-up is genuinely trustless.** `/api/me/credits/topup` re-fetches the
  subscriber from RevenueCat with the secret key and matches on `id` **or**
  `store_transaction_id`, which covers both stores' id shapes. Fails closed —
  unconfigured or unreachable RC is a 5xx, never a blind credit.
- **RevenueCat webhook auth.** Bearer compared with `timingSafeEqual` behind an
  explicit length check; TRANSFER handled *before* the `app_user_id` guard;
  replay-guarded on `rc_event_id`.
- **Session tokens.** `alg` pinned, `typ` checked so a refresh token can never
  authenticate, timing-safe signature compare, opaque refresh tokens stored only
  as SHA-256, rotation with reuse detection.
- **Account deletion revokes every first-party session** before soft-deleting the
  row, so an issued session cannot outlive the account.
- **No secrets in production bundles.** Vision and Veryfi keys resolve to
  `undefined` off the `dev` EAS profile, and no token or bearer is logged anywhere
  in `src/` or `server.js`.
- **iOS purpose strings.** `withIosPrivacyStringCleanup` strips Microphone,
  LocationAlways, FaceID and PhotoLibraryAdd, and no code path contradicts a
  removal — no `saveToLibraryAsync`/`createAssetAsync`, and no
  `requireAuthentication` on SecureStore.
- **Apple sign-in failures are localized.** The raw English `Error` strings inside
  `signInWithApple` never reach a user; they route through `describeHandledError`
  → `t()`, whose unknown bucket is itself a translated string.
- **`/api/ocr`.** Per-identity limit (preferring the authenticated `sub` over the
  client-chosen `deviceId`), a per-IP rotation brake, and a hard monthly Vision
  budget.

---

## Documented, not fixed

- **iOS background execution remains materially weaker.** A5 improves the floor;
  it does not give `checkAllPriceDrops` a foreground equivalent. Carried from
  pass #4.
- **P3 app-switcher snapshot protection** — still recommended, still needs a
  handset to validate against the `inactive`-during-permission-dialog behaviour
  that A3 has now documented from a second angle.
- **The IDFV-vs-SSAID device-identity asymmetry** stands (pass #4).
- **`flagged` is still not checked at `requireAuth`.** It is enforced per-route
  by design; the four money-relevant routes now all carry it. A soft-deleted
  account is likewise only refused at `/api/me/bootstrap`. Both are containment
  choices worth knowing before adding a route that spends or grants.
- **The `.p8` key and `SESSION_TOKEN_SECRET` remain unset.** Until the latter is
  set, the first-party session path — and therefore the escalation that makes A1
  urgent — is inert in production. **A1 is the reason to treat setting it as a
  gated step rather than a routine one: it should be set on a build that sends
  nonces.**

---

## Regression risk, stated proactively

| Change | What could regress | How it is controlled |
|---|---|---|
| **A1** | An enforcement bug locks every iPhone out of sign-in. | Accept-if-present: a token with no `nonce` claim always passes, and no shipped build sends one. Mismatch is the only new rejection. Apple sign-in has never shipped to the App Store. |
| **A1** | An unusable digest sends `nonce: ""` and 401s every request. | **This actually happened**, caught by the pre-existing suites. Both halves are shape-validated; anything not 64 hex chars throws and signs in unbound. Five bad-digest shapes asserted. |
| **A1** | A path mints a token without a matching nonce → silent 401 loop. | All three minting sites updated; write/clear is in lockstep with the token, and "absent must overwrite a stale value" is its own test. |
| **A1** | The two-arg `verifyAuth` breaks the suites that inject one-arg fakes. | The argument is optional and additive; `appleNonceWiring.test.js` asserts a one-arg fake still authenticates. |
| **A2** | A cap below real capture size refuses legitimate tag uploads. | 12 MB clears a full-resolution iPhone JPEG; the tag path uploads the original. Declaration is best-effort — any stat failure omits the field and keeps today's unbounded path. Zero/missing/unreadable all assert omission. |
| **A3** | Under-firing: a real foregrounding no longer drains the queues. | The gate opens on any `background → active` round trip, which is every genuine return on both platforms. Six cases including the Android cycle and a listener mounted while backgrounded. The 60 s poller and the background task remain independent drains. |
| **A3** | Losing the badge clear. | Deliberately left outside the gate; unchanged behaviour. |
| **A4** | A false-positive flag silently stops a legitimate user earning. | Flagging is manual/admin plus the existing `device_conflict` rule — no new automatic flagging. The observation is still recorded, so nothing is lost on unflag, and the unflagged path is asserted first so a guard that refuses everyone fails loudly. |
| **A5** | A shorter interval drains battery on iPhone. | iOS treats it only as a floor and schedules on its own budget; it cannot run more often than iOS allows. **Unverifiable without a handset.** |

---

## Tests shipped with the fixes

| Suite | Covers |
|---|---|
| `backend/tests/appleAuthNonce.test.js` (10) | Both rollout branches, the missing-header rejection, hash direction, and that the nonce never resurrects an expired or wrong-audience token |
| `backend/tests/appleNonceWiring.test.js` (6) | Header → verifier plumbing, the optional second argument, the length cap, session tokens unaffected |
| `backend/tests/flaggedEarningGuardsDb.test.js` (6, DB) | Referral 403 + no edge written; tag observation still accepted while the credit is withheld |
| `__tests__/authServiceAppleNonce.test.js` (13) | Digest to Apple / raw to us, lockstep storage, header attachment, unusable-digest degradation, Android untouched |
| `__tests__/auditPass7Findings.test.js` (11) | `imageBytes` declared / omitted; the foreground gate against the real module |

No migration in this pass — nothing here touches the schema. Production still owes
`0005` from pass #6, unchanged by this work.

---

## On-device checklist

Continuing from pass #6's item 36.

37. **Sign in with Apple** on a handset. It must succeed, and
    `GET /health` with `x-admin-token` must show `appleAuth.nonce.verified`
    incrementing rather than `legacy`.
38. Sign in on a build **without** the nonce (a prior TestFlight build, if one is
    installed) — it must still authenticate, and register as `legacy`. This is the
    rollout escape hatch working.
39. **Delete the account** from an Apple session: one Face ID prompt, not two, and
    the revocation still reported (A1 touched this path).
40. Mid-scan, pull Control Centre and dismiss the camera/location prompts. The
    sweep must **not** re-run, and a Pro account must not see
    `/api/me/subscription/sync` 429 (A3).
41. Upload a price-tag photo and confirm the PUT carried an exact
    `Content-Length` (A2).
42. **Android regression pass, same build:** Google sign-in, tag upload with its
    new size declaration, the foreground drains after a real backgrounding, and
    the background price check still on its 24 h period.
