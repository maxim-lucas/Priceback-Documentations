# iOS audit #3 — the money and identity paths

**Date:** 2026-08-10
**Scope:** authentication, credit management, RevenueCat, account management,
receipt scans and price-tag scans — each read for **two** things: a security
defect, and an iOS/Android divergence.
**Branch:** `audit/ios-security-money-identity` (PR #253)
**Status:** five findings fixed and unit-tested; the rest documented below.
**Nothing has run on an iPhone** — that debt is inherited from both predecessors
and is not discharged here.
**Predecessors:** `iOS_Audit_2026-08-09.md` (F1–F6, PR #249),
`iOS_Audit_2026-08-10.md` (A1–A6, PR #252)
**Bugs_Common_Fixes:** #169–#173

---

## Why a third audit

The first pass covered what App Review taps. The second covered what runs
unattended. Both stopped short of the paths this one targets, and said so.

That left the app's **money and identity** surfaces unexamined on the platform
with a fraction of Android's real-device exposure. It is the worst place for
that gap: PriceBack has **never completed a single real transaction on an
iPhone**, so nothing has ever exercised the purchase path there end to end.

Two of the five findings are App Store submission blockers. Both would have been
discovered by a reviewer within minutes, and neither is visible from Android.

**The method, unchanged from the previous two passes:** every finding confirmed
against primary evidence — installed native SDK sources under `node_modules`,
EAS and store configuration, the server code itself — never inferred from
reading app code. Severity is "what does this cost us", ordered highest first.

---

## The findings

| # | Finding | Platforms | Cost | Status |
|---|---|---|---|---|
| S1 | Every sandbox purchase refused server-side | iOS in effect | **submission blocker**; a reviewer pays and gets nothing | **Fixed** |
| S2 | The iOS Google client ID is not an accepted audience | iOS only | 401 on every call for Google-signed-in iPhone users | **Fixed** |
| S5 | No Apple credential revocation on account deletion | iOS only | **submission blocker** (Guideline 5.1.1(v)) | **Fixed** |
| A2 | Apple sessions cannot authenticate in the background | iOS only | core feature dead for a mandatory sign-in method | **Fixed** (was deferred from audit #2) |
| S4 | Server-sent push notifications are English-only | both | standing-rule breach on the app's primary notification | **Fixed** |
| S3 | The only installable iPhone build targets a different backend than App Review's | iOS only | a green on-device IAP test does not predict review | **Documented** |

---

### S1 — every sandbox purchase was refused, so no iPhone could buy anything

**Submission blocker.** Three independent server paths refused a store SANDBOX
transaction:

| Path | Behaviour before |
|---|---|
| RevenueCat webhook | `{ applied: false, reason: "sandbox" }` (`subscriptionGate.js:79`) |
| `POST /api/me/credits/topup` | `402 sandbox_purchase`, **`retryable: false`** |
| `POST /api/me/subscription/sync` | skipped sandbox-backed entitlements |

The escape hatch (`RC_ALLOW_SANDBOX=1`) appeared only in those three branches
and their tests. It was set in **no** config file, `.env.example`, or
`railway.json` — so in every real deployment, all three refused.

**On iOS there is no such thing as a non-sandbox purchase before the app is
live.** TestFlight is sandbox. App Review is sandbox. So the reviewer's flow was:
tap Subscribe → pay → the server records nothing → the client's next
`reconcileWithServer` sees `free` → the entitlement they just bought disappears.
That is a Guideline 3.1.1 rejection reproduced by tapping one button.

The credit-pack path was worse than "nothing happens". `402 … retryable:false`
is a *terminal* refusal, and `confirmPackPurchaseDurably` dequeues terminal
failures — so a **paid** transaction was deleted from the retry queue and could
never heal, even after a fix shipped.

**Android never hit this** because it has a real production purchase path
alongside its license testers, and the license-tester case is exactly what the
refusal was written to defend against.

> **The reasoning that had to be redone, not reversed.** The original comment is
> right about the danger: a Play license-tester purchase costs $0, and Unlimited
> is credit-exempt, so granting on sandbox *is* free unlimited service. Refusing
> was a correct answer to that question. It was the wrong answer to a question
> nobody had asked yet — "how does a reviewer buy anything?" — and on iOS that
> question has no other answer.

**Fix (decision taken with the user before implementing).** Grant the
entitlement, **tag** the row. Migration `0003` adds
`users.subscription_is_sandbox`, `credit_ledger.is_sandbox` and
`subscription_events.is_sandbox`, all defaulting `false` so every pre-existing
row reads as genuine — which it is. Revenue queries filter on the flag; a sweep
of test data is a delete on it. `RC_ALLOW_SANDBOX` existed only to un-block;
blocking is gone, so the flag is gone.

> **The guard that makes acceptance safe, and the reason it is not just a flag
> flip.** A sandbox purchase must never **settle a referral**. That is the one
> path where a $0 transaction mints real, spendable credits *for someone else* —
> without the guard, "accept sandbox" becomes: buy in the sandbox, pay out a
> referrer, repeat. All three settlement call sites are guarded, and the test is
> behavioural (it watches the referrer's balance) with a **production control**,
> so the guard cannot pass by having quietly disabled referrals altogether.

> **Retired, not renamed.** `sandbox_purchase` was pinned in
> `errorContract.test.js` as a code the shipped v2.8.3 client string-compares.
> Retiring a pinned code is normally forbidden — but the only thing that client
> ever did with it was *give up on the transaction*. It now receives a 200 and
> credits instead, which is the outcome the code was denying. A rename would
> have been unsafe; removal is strictly an improvement for users in the field.

---

### S2 — the backend never accepted the iOS Google client ID

`GOOGLE_AUDIENCES = [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID_ANDROID]`. The iOS
client ID was absent, while the client ships one and passes it to the native
SDK.

**The divergence is in the two native SDKs, not in our code — which is exactly
why reading our code never showed it:**

```java
// android/.../Utils.java:66
googleSignInOptionsBuilder.requestIdToken(webClientId);
```
An ID token **explicitly addressed to the web client**. That is why `[web,
android]` always worked on Android.

```objc
// ios/RNGoogleSignin.mm:100
GIDConfiguration* config = [[GIDConfiguration alloc]
    initWithClientID:clientId          // ← iosClientId
       serverClientID:options[@"webClientId"] …];
// …and line 220 returns user.idToken.tokenString
```
The token handed back is `GIDGoogleUser.idToken`, issued for the **clientID** —
the iOS client. `serverClientID` feeds `serverAuthCode`, which the library's own
types document as non-null *only* with `offlineAccess: true` — and
`signInWithGoogle` deliberately does not request offline access.

So an iPhone can present a token this backend rejected: **401 on every
authenticated call, for every Google-signed-in iPhone user**, while Android is
perfectly healthy. It has never been reported only because iOS is TestFlight-only
and the one build that got there crashed on Apple sign-in before anyone reached
the Google button.

**Honest limit on the claim.** The Android half is unambiguous. The iOS half
rests on `GIDGoogleUser.idToken`'s audience semantics, which could not be settled
offline without an iPhone-issued token to decode. **It does not matter**: the fix
is identical under either answer, costs one line, and closes the risk. Adding the
audience is safe because it is our own OAuth client in our own GCP project — a
token from any client outside it still fails. *Never add a client ID that is not
ours.*

> **Why the fix would have sat dormant.** `backend/.env.example` never documented
> the sign-in client IDs **at all**, so `GOOGLE_CLIENT_ID_IOS` would never have
> been set on Railway. And `/health` reported a bare audience **count** — the
> web+android pair alone reads as `"configured"` while every iPhone 401s. It now
> names which of web/android/ios are present (presence only, never the values).
> A fix nobody can tell is unapplied is not a fix.

---

### S5 — deleting an account never revoked the Apple credential

**Submission blocker.** Guideline 5.1.1(v): an app offering account deletion and
Sign in with Apple must also call Apple's revocation endpoint. Deleting our rows
is not enough — until that call lands, Apple keeps listing PriceBack under
**Settings → Apple ID → Sign in with Apple** for an account the user already
deleted. Reviewers check it. Google has no equivalent, which is why the
Android-shaped deletion flow never surfaced it.

**The design deliberately stores nothing.** The obvious implementation captures
`authorizationCode` at sign-in, exchanges it for an Apple **refresh token**, and
holds that token for the life of the account so it can be revoked years later —
a long-lived third-party credential kept for every Apple user to serve one call
that may never come. Instead the client obtains a **fresh** authorization code at
the moment of deletion (one Face ID confirmation on an already-authorized
device), the server exchanges and revokes it, and nothing is persisted. The extra
confirmation is not a cost: a biometric check on an irreversible action is what
you would design anyway.

**Deletion is never blocked by any of it.** Missing key material, a stale
single-use code, a slow Apple, a malformed PEM — every path resolves rather than
throws, and the account is erased regardless. A user asking to be deleted must
not be held hostage by a third party. The outcome returns as
`appleRevoked` / `appleRevokeReason` and is logged, so an unconfigured deployment
is a *visible* compliance gap rather than a silent one.

> Two implementation traps, both pinned by tests. Apple's client secret must be
> **ES256 with a raw `r||s` signature** — Node emits DER by default, and Apple
> rejects that as malformed without saying why (`dsaEncoding: "ieee-p1363"` is
> load-bearing). And a PEM arriving from an env var almost always carries literal
> `\n` rather than newlines, which fails deep inside `crypto` with an unhelpful
> error.

> **Found while here:** the users row on this path is only **soft**-deleted, so
> the `ON DELETE cascade` that removes first-party sessions never fires. An
> issued session would have kept authenticating a deleted account until its
> refresh token aged out. Sessions are now revoked explicitly.

---

### A2 — Apple sessions could never authenticate in the background

Filed by audit #2 and deferred there as an auth-core rewrite. **Fixed here**,
under a constraint the user set: *keep Android's behaviour exactly, optimize
only iOS.*

| | Google (Android + iOS) | Apple (iOS only) |
|---|---|---|
| Token lifetime | ~1 hour | **~10 minutes** |
| Silent refresh | `signInSilently` | **none — requires UI** |
| Background price check | works | **could not authenticate** |
| Offline queue drains | work | **could not authenticate** |

Guideline 4.8 makes Apple sign-in mandatory once Google is offered, so this was
the default for a large share of iPhone users — a materially different product
from the one on Play.

**The fix.** The provider token is exchanged **once**, at sign-in, for a
PriceBack session: a 15-minute signed access token plus a rotating opaque
refresh token. Refresh is a plain HTTP call with no UI.

**Scope, and why it is this narrow.** Android takes **none** of it. Its requests
are byte-identical, asserted by test rather than assumed, because `signInSilently`
already gives it unattended auth — changing it would be risk without benefit. The
backend change is purely **additive**: `requireAuth` gains a third branch beside
Google and Apple, resolving to the **same `req.user.sub`** every route and repo
already keys on, so no query changes shape.

**Degrade, never regress.** No `SESSION_TOKEN_SECRET`, offline, revoked, refresh
rejected — every failure falls back to the provider id token, which the backend
still accepts. Worst case is exactly today's behaviour. Same containment
philosophy as A1's keychain migration.

Security properties, each pinned by a test: the algorithm is **verified against a
pin** rather than read from the header (`alg:none` and RS256→HS256 confusion); a
refresh-shaped token cannot authenticate a request (type confusion); signatures
compare timing-safely; refresh tokens are opaque, stored **only as a SHA-256
hash**, and rotate on every use; re-presenting a spent token revokes the whole
family; every refresh failure returns one indistinguishable 401 (a
distinguishable one is an oracle for probing which stolen tokens still work).

> **The trap that would have shipped.** Rotation plus concurrency is a trap.
> Five parallel requests — an app waking several queues at once — would each
> spend the refresh token, and the backend's own reuse detection would correctly
> read that as theft and revoke the family. **Being busy would have signed the
> user out.** One in-flight refresh is shared by all callers, on both sides: the
> client coalesces, and the repo takes a per-token advisory lock.

> **A deliberate cost, recorded.** Access tokens are verified by signature alone,
> with no database round trip, so the authenticated hot path stays exactly as
> cheap as it is today. The price is that revocation takes effect within one
> access-token lifetime (15 min) rather than instantly. That is still far better
> than the status quo it replaces, where a leaked Google id token is good for an
> hour and cannot be revoked at all.

---

### S4 — every push the *server* sends was English-only

Audit #2's A4 moved twelve hardcoded English strings out of the mobile
notification service and shipped `notificationI18n.test.js` so none could come
back. **That test reads the mobile service. It cannot see the backend.**

Nine server-sent pushes were still English template literals: referral payouts
(both sides), price-tag verification, low balance, the daily drop summary, store
launches, flyer deals — and **price drops themselves**, the app's single most
important notification. Money was `$${n.toFixed(2)}`, baking the English currency
shape into every language; Canadian French writes `12,34 $`.

So a French-Canadian user — the home market — had their in-app copy fixed and
kept receiving English pushes, on both platforms.

**Fix.** `backend/lib/pushI18n.js`, keyed on `user_preferences.language` (which
the app already syncs). `sendUserPush` gains an optional `build(lang)` so copy is
composed once the recipient's language is known.

> **The two that could not use it, and why.** The price-drop and flyer sweeps
> compose notifications into an array **keyed by push token** and never resolve a
> `sub`, so `sendUserPush`'s per-user lookup does not apply. They get
> `usersRepo.languageByToken()` — one query up front, mirroring the existing
> `notificationPrefsByToken`. Stopping at the seven easy ones would have left the
> app's *primary* notification English.

Deliberately a **separate bundle** from `src/services/i18n.js`: that is 1430 keys
of app UI shipped inside the binary, and the backend needs nine notifications
without taking a dependency on the mobile tree. Both are enforced by tests that
derive the language list from the bundle, so a third language comes under
enforcement in both places automatically.

One exemption, marked in place: the admin-only tag-review push. The standing rule
exempts admin surfaces from translation but still requires plain English.

---

### S3 — the only installable iPhone build talks to a different backend than App Review's

**Documented, not fixed** — it is a deliberate configuration, but its consequence
is not obvious and needs to be on the record.

`eas.json`: the `device` profile (added by audit #1 as the only profile that
produces an installable iPhone binary) sets
`PRICE_API_URL=priceback-development.up.railway.app`. The `production` profile
carries no override and resolves to prod.

So the on-device IAP test and App Review's build exercise **different backends**.
Before this audit they also had different sandbox policies, which meant a green
device test could not predict review at all. S1 makes the two agree, which mostly
closes it — but the general hazard remains: **anything configured per-environment
is untested by the device build.** Verify the production backend's configuration
directly (`GET /health` with `x-admin-token`), not by inference from a device
that never talked to it.

---

## Verified clean — recorded so pass #4 does not re-investigate

- **`APPLE_BUNDLE_ID`** defaults to `com.priceback` and matches `app.json:21`.
  Apple token verification is correctly addressed.
- **The RevenueCat webhook secret** is compared with `crypto.timingSafeEqual`
  after a length check — not `===`.
- **`/api/me/credits/topup` is genuinely trustless.** It verifies the transaction
  against RevenueCat's REST API with the secret key and **fails closed** (5xx)
  when RC is unconfigured or unreachable, rather than crediting blind.
- **Top-up idempotency is global, not per-user** — one store transaction is one
  payment, and a second account presenting the same ref no-ops rather than
  double-crediting. The ref is burned in `topup_refs`, which survives a data
  reset, so a wipe cannot re-mint credits.
- **`_simulationAllowed()` cannot fire in any store build** — it is keyed to
  `buildProfile === "local"`, so every EAS-produced binary (App Store,
  TestFlight, Play, internal) answers false. The Guideline 3.1.1 hole audit #1
  closed is still closed.
- **Device-scoped erasure is IDOR-safe** — `callerOwnsDevice` uses
  trust-on-first-use ownership and fails **closed** on a DB error.
- **The offline-scan credit buffer cannot overdraw.** It logs absolute
  timestamped `−1` entries rather than mirroring a balance (the design that
  caused the 660-vs-75 drift), gates on last-known-balance *minus* buffered
  spends against a safety floor, and uploads keyed on the receipt id so the
  online and offline paths cannot double-charge.
- **HEIC:** every iOS ingest path funnels through
  `ImageManipulator.manipulateAsync(… SaveFormat.JPEG)` before upload, so the
  backend never receives a HEIC it cannot decode.

Also still true from audit #2's divergence table (re-checked, unchanged): the
Android-only in-scanner gallery import, iOS-only camera-roll suggestions,
notification channels, `stopOnTerminate`/`startOnBoot`, and iOS-only swipe-
dismiss on modals — including the two `Pending*` screens that inconsistently
allow it.

---

## Regression risk, stated proactively

- **S1 changes production money handling.** Sandbox purchases that previously
  granted nothing now grant credits and entitlements. That is the intent; the tag
  keeps it auditable and the referral guard bounds the abuse. The residual
  exposure — someone able to mint sandbox purchases gets free credits — was
  accepted by decision. On iOS that needs a Sandbox Apple ID from our own App
  Store Connect account or a TestFlight seat.
- **A2 is the largest blast radius here.** It adds a new accepted credential type
  to every authenticated route. Contained by: the same `sub` shape, an additive
  backend branch, an iOS-only client change, a provider-token fallback, and an
  explicit test that Android's request shape did not move.
- **S4 changes live Android copy** — every price-drop, flyer, referral,
  low-balance, store-launch and daily-summary push. Deliberate, and the only
  change in this branch a current Play user can see.
- **S2 widens an audience list.** Safe only because the added client is ours.
- **Prod owes migrations `0003` and `0004`** before the next production deploy.
- iOS installs are **TestFlight only** today, so the exposed population is about
  one person. As with A1, there will never be a cheaper time.

---

## Still owed

1. **Nothing has run on an iPhone.** Inherited, and now larger.
2. **Provision the Apple Sign-In key** (`APPLE_SIGNIN_KEY_ID`, `APPLE_TEAM_ID`,
   `APPLE_SIGNIN_PRIVATE_KEY`) **before the first App Store submission.** The
   `.p8` downloads exactly once. Without it, deletion still erases everything on
   our side but cannot revoke, and `appleRevoked:false` will say so.
3. **Set `GOOGLE_CLIENT_ID_IOS` and `SESSION_TOKEN_SECRET`** on both Railway
   services. Confirm with `GET /health` + `x-admin-token` → `auth.clients.ios`
   must read `true`.
4. **Run migrations 0003 + 0004 on production.**
5. **Apple server-to-server notifications are not wired.** Apple can tell us
   about consent withdrawal and account deletion out-of-band; today revocation is
   only detected on-device via `getCredentialStateAsync`. Its own task — it needs
   the same `.p8` key as item 2.

**On-device checklist — additions to the previous audits' nine:**

10. Buy a credit pack with a **sandbox** Apple ID. Confirm the balance rises and
    the ledger row carries `is_sandbox = true` (S1).
11. Subscribe with a sandbox Apple ID, background the app, reopen. Confirm the
    entitlement **survives** the reconcile rather than dropping to free (S1).
12. Sign in with **Google** on the iPhone and open any authenticated screen —
    confirm no 401 (S2). This is the empirical answer to the audience question.
13. Sign in with Apple, lock the phone, leave it. Confirm a price-drop alert
    still arrives — the A2 case that previously could not work at all.
14. Delete the account. Confirm the Face ID prompt, then check **Settings → Apple
    ID → Sign in with Apple**: PriceBack must be **gone** (S5).
15. Device language French: confirm a price-drop push arrives in French with
    `12,34 $` formatting (S4).

**Android regression pass, same build:** sign-in and every authenticated call
unchanged (no session endpoints called at all), push copy correct in both
languages, purchases unaffected.
