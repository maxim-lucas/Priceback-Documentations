# iOS audit #8 — an auth path with no timeout, a fix that reached one of three call sites, and an erasure that left the credits behind

_2026-08-12. Branch `audit/ios-pass8-session-timeouts-foreground-tombstone`.
Scope as asked: security first — authentication, credit management, RevenueCat,
account management, receipt scans, price-tag scans — plus iOS/Android divergence,
and explicitly **not** re-opening what passes #1–#7 already documented._

---

## Why this pass could find anything

Seven passes are on record and the fifth built a full divergence inventory, so
this one did not re-walk closed ground. Two openings made it worth running:

1. **PR #260 landed *after* pass #7.** Roughly 3,000 lines of credit and account
   code — the credit-restore window, tombstone revival, the admin credit desk,
   the reason-aware hydrate, signup-vs-restore — that **no audit had ever read**.
   The largest un-audited surface in the repository. **P4 and P5** come from it.
2. **Pass #7's A3 was a correct fix applied to one of three call sites.** It
   documented iOS's `inactive` behaviour precisely, extracted a tested primitive
   for it, and used that primitive in `App.js` only. Nothing pointed at the other
   two, so they carried the bug for a whole audit cycle. **P3.**

A third opening was structural rather than historical: every pass has checked
that network calls *exist* and are *authorized*, and none had asked whether they
can **finish**. That question found **P1** and **P2** — and P1 turned out to sit
on the critical path of every authenticated request on iPhone.

Five defects. All five are fixed here.

---

## Findings at a glance

| # | Severity | Area | Defect |
|---|---|---|---|
| P1 | **Medium-High** | Auth (iOS-only) | The three session routes had no timeout, and a shared in-flight promise made one stalled refresh block every authenticated request on the device |
| P2 | **Medium** | Receipt + tag scans | Both image uploads were un-timed; the receipt one is awaited inside the sync drain, and iOS *suspends* rather than fails a backgrounded upload |
| P3 | **Medium** | iOS/Android parity | Audit #7's `inactive` fix reached one of three call sites — a banner fires over the live app, and a poller re-runs per interruption |
| P4 | Low | Credits, accounts | Completing the erasure deleted the ledger and left the balance, so a revived account carried credits nothing backs |
| P5 | Low | Admin, money | The two credit-desk routes were the only account-gated admin surface with no rate limit |

---

## P1 — the only backend call in the app with no timeout was the one that gates all the others

`openFirstPartySession`, `_refreshFirstPartySession` and
`revokeFirstPartySession` called bare `fetch`. Every other backend request in the
app carries an explicit `AbortController` — 3 s, 5 s, 8 s, 15 s, 20 s depending
on the route — **including the two Google endpoints in the same file**, forty
lines away. Three calls out of the whole app had none, and they were the three
that make up the iOS session layer.

**Why that is not just a missing timeout.** `_refreshFirstPartySession` shares
**one in-flight promise** across concurrent callers, and that is correct: the
refresh token rotates on every use, so a screen firing five requests must rotate
once. Spending it five times is what the backend's reuse detection reads as
theft, and it responds by revoking the whole session family — signing the user
out for being busy. That design is right and this pass did not touch it.

The consequence is that the refresh sits on the critical path of everything:

```
authedFetch → _getSessionAccessToken → _refreshFirstPartySession → fetch  ← un-timed
```

So a wedged connection did not stall one request. It stalled **every
authenticated request on the device**, for as long as the connection stayed open
— receipt sync, credit balance reads, the queue drains, all of it. And each
caller's own `AbortController` was no defence, because it covers the caller's own
fetch and never the token acquisition that runs ahead of it.

Android cannot reach any of this: first-party sessions are iOS-only. This was an
iPhone-only, app-wide auth stall.

### The fix, and the part that makes it safe

One `_sessionFetch` helper on an 8 s budget — the app's existing backend budget —
used by all three routes. The helper deliberately **does not swallow the abort**:
it throws like any other transport failure, so each call site's existing handling
decides what a timeout means. No new branch is introduced anywhere:

- `openFirstPartySession` → `{ opened: false }` → stay on the provider token;
- `_refreshFirstPartySession` → `null`, **keeping the refresh token** → the
  caller falls back to the provider token, which is what Android does full-time;
- `revokeFirstPartySession` → best-effort, and local state was already cleared
  *before* the network call precisely so a failed revoke leaves nothing behind
  believing it holds a session.

The keeping-the-refresh-token half is the one worth stating explicitly. **A
timeout is not evidence the session died.** Only an explicit 401 clears it —
that branch is untouched and has its own test. Clearing on a network blip would
sign a user out of a good 60-day session, which is a worse bug than the one being
fixed.

The fix is also inert in production today: `SESSION_TOKEN_SECRET` is still unset,
so the session path does not run. That bounds the risk of touching auth code on a
platform that has never run on a handset.

---

## P2 — the image uploads, and the twins that have now drifted three times

`FileSystem.uploadAsync` accepts no abort signal, and the two calls to it — the
receipt photo and the price-tag photo — were the only other network operations in
the app without a budget. Neither `/image-uploaded` confirm had one either.

The receipt half is the worse one, because of where it sits: it is `await`ed
inside `syncReceiptToBackend`, which runs under the pending-sync drain. A wedged
PUT therefore held **every other queued receipt** behind it. And on iOS,
backgrounding **suspends** the underlying `NSURLSession` task rather than failing
it — so the stall lasts as long as the user stays out of the app, and the JS
timer that would have caught it is suspended too.

The tag half is fire-and-forget, which is the safer of the two shapes. **The
twins disagreed**, which is the recurring theme:

- **audit #4 (S4)** capped the tag upload *server*-side; no client ever sent the
  size, so the cap never fired;
- **audit #6 (M2)** fixed the receipt client on the strength of a comment
  claiming the tag twin already did it. It did not, and had not for two audits;
- **audit #7 (A2)** fixed the tag client and noted that the shared
  `imagePresignDecision` existed precisely so the twins could not drift — and
  they drifted anyway, **on the client side, where a shared server function
  cannot reach**.

So the fix is a shared *client* function. `src/utils/imageUpload.js` now owns both
`putImageWithTimeout` and `imageBytesForPresign`, and both twins call it.
Anything true of one upload is true of both by construction rather than by two
people remembering.

`createUploadTask` + `cancelAsync` on a 60 s budget — deliberately far more
generous than the app's 8 s JSON budget, because this is a multi-megabyte body on
a warehouse's congested LTE and a cap that refuses a legitimate 11 MB capture
would be a worse bug than the hang it replaces. It bounds a *wedged* connection,
not a slow one. Where `createUploadTask` is absent (an older SDK, a test double
that stubs only `uploadAsync`) it falls back to plain `uploadAsync` — degrading to
exactly today's behaviour rather than to a new one.

A timeout throws, landing in each caller's existing catch. Neither treats a failed
image upload as a failed sync — the image is best-effort and the receipt or
observation is already saved server-side — and that had to stay true.

---

## P3 — audit #7 fixed one of three call sites

Pass #7's A3 documented the iOS behaviour exactly right: `AppState` reports
`inactive` for a Control Centre pull, a notification-shade drag, an app-switcher
half-swipe **and every system permission dialog**, all while the app is still
fully rendered on screen. Android has no `inactive` state at all.

It then extracted `createForegroundGate` so the rule would be tested against
shipped logic rather than a copy — and wired it into `App.js`. Two other call
sites were reading the same `AppState` with a bare `=== "active"` and were not
touched, because nothing pointed at them.

**`notificationService.appIsForeground()`** (used at two sites) exists for one
job: the scan-queue "ready to review" banner must not pop over an app the user is
already holding. Reading `inactive` as "gone" meant it fired during a permission
dialog — and the camera/photo permission prompt is *part of scanning*, which
makes it the single likeliest moment for a queue drain to complete. On iPhone the
banner told the user to come back to the app they were staring at. Android never
saw it.

**`HomeScreen`'s connectivity poller** tore its 30 s interval down on `inactive`
and restarted it on the way back — and `startPolling()` runs an immediate
`checkConnection()`, which is two network round trips, one of them
`GET /health`. Since pass #6's H2 that endpoint actively probes dependencies
(it is cached, so this is cost rather than load). An iPhone scan is two permission
dialogs, so it paid for four requests it did not need; Android paid for none.

### The predicate is not the gate, and that distinction is the finding

The obvious fix — reuse `createForegroundGate` — is wrong, and the reason is
worth recording. The gate answers *"did the app leave and come back?"* and is
deliberately **false** during a transient interruption. But a transient
interruption is exactly when the app **is** on screen. Reusing it would have
re-introduced the bug pointing the other way: the banner would be suppressed
forever after the first drain.

They are two questions:

| Question | Answer |
|---|---|
| Did the app LEAVE and come back? | `createForegroundGate` — latch on `background`, fire once |
| Can the user SEE the app right now? | `appIsOnScreen` — `state !== "background"` |

`appIsOnScreen` joins the gate in `src/utils/foregroundGate.js`, so one module
owns everything the codebase knows about what iOS's states mean. Unknown states
count as on screen: the predicate gates *suppression* and *teardown*, so the safe
direction when we cannot tell is to keep today's behaviour rather than to go
silent or stop polling.

`App.js`'s 60 s poller was already correct and was rewritten through the same
predicate anyway — behaviour-identical, but it removes the last hand-written
comparison from a fixed site so the test below can hold a line.

**The test asserts positively.** A blanket "no file may compare to `active`"
would be wrong: `App.js:357` gates the badge clear on a real `active` on purpose,
and a guard that fires on correct code is a guard people delete. So the suite
asserts that the two fixed files no longer compare to a literal, that all three
route through `appIsOnScreen`, and that the literals live in `foregroundGate.js`.

---

## P4 — completing the erasure deleted the history and left the balance

`requestDeletion` zeroes `scan_credits` and **retains** the credit ledger, so a
re-signin inside `CREDIT_RESTORE_GRACE_HOURS` can replay the balance back. Two
paths finish that erasure once the window lapses: the revival branch in
`upsertFromOAuth`, and the hourly `purgeExpiredRestoreLedgers`. Both deleted the
ledger rows and left `users.scan_credits` alone.

That is sound only while a tombstone's balance is still the 0 the deletion wrote.
It is not, because three paths credit an account without checking `users.status`
— and each is reasonable on its own:

- **`settleVerifiedTagCredits`** pays `devices.owner_sub`, and settlement is
  *deferred* until other shoppers corroborate the price. Days later is normal, so
  a tag scanned before the deletion routinely pays after it.
- **The RevenueCat webhook's `recordTopupOnce`** — a pack whose client-side
  confirm never landed (offline at the till) is credited when the webhook
  arrives, which can be after the account is gone. Note the webhook correctly
  does *not* revive the account (audit #4's A2), so it credits a tombstone that
  stays a tombstone.
- **The admin credit desk**, which lists `status=inactive` accounts by design.

So the account came back holding credits with nothing behind them — **the same
permanent drift the revival branch was written to prevent, mirrored**. And
invisible while it mattered: `creditReconRepo` skips soft-deleted rows (correctly
— otherwise every deletion would open a reconciliation case), so nothing reported
it until the account was revived, at which point it is indistinguishable from a
legitimate balance.

Both halves now, in the same transaction. The purge additionally **counts and
warns** on what it zeroed, with a `scan_credits <> 0` predicate so the counter
stays silent for every ordinary deletion — a credit reaching a dead account is
worth seeing, and a silent `UPDATE` throws that evidence away.

The zeroing is confined to the lapsed-window branch. A credit that settles
*inside* the window is genuinely the user's and the replay hands it back with
everything else; that direction has its own test.

---

## P5 — the credit desk had no rate limit

`GET /api/admin/users` and `POST /api/admin/users/:sub/credits` were the only
account-gated admin routes with no throttle, and they are the pair worth capping:
one pages the entire user directory (every email, every name), the other is the
only route in the service that **creates credits out of nothing** rather than in
exchange for a verified payment or an accepted contribution.

This is blast radius, not access control. The gate (`ADMIN_USER_SUBS`) fails
closed and is sound; what the budget bounds is a **compromised admin session**.
120/min is far above any human working a support queue and orders of magnitude
below "export the whole user table".

**Charged after the admin check, deliberately** — the opposite ordering to
`_adminTokenOk`. There the budget caps password guessing, so it must precede the
constant-time compare or the 401/429 boundary becomes an oracle. Here the caller
is already a verified account and the 403 leaks nothing, while charging failures
*would* let any signed-in user burn an admin's budget on a route they cannot use.
Its own test walks a non-admin into five 403s and then confirms the admin is
unaffected.

**On the audit trail, a correction to my own first read.** The actor was never
lost: `middleware/audit.js` stamps `req.user.sub` on every request. What it does
not record is the body — deliberately — so tying an operator to a *specific*
movement meant correlating two sources on a timestamp, which stops being an
answer the moment two admins act in the same second. `credit_ledger.ref` now
carries `admin:<actorSub>`, making it a one-row answer. `ref` is free here: plain
text, no constraint, never rendered, and the only idempotency lookups that read it
are scoped to `price_tag_scan`, `price_tag_revoke` and `scan_consume`.

**`notes` keeps its exact shape**, and that is load-bearing rather than
incidental. The client parses everything after `admin:` as the motif code and
falls back to a translated generic when it does not resolve — so appending the
actor there would have silently downgraded **every admin row in every shopper's
credit history** to "Adjustment". Its own test.

---

## iOS / Android divergence — third inventory

**Explicit branches: 36 sites, up one from pass #5's 35.** The addition is pass
#7's A5 background-fetch interval split. Every branch was re-read; **no defects
among them**, and pass #5's verdict table stands unchanged.

**Implicit divergences** — the ones with no `Platform.OS` to grep for, which is
what makes them the risk. New this pass:

| Divergence | Effect | Verdict |
|---|---|---|
| **`AppState.inactive` is on-screen** | iOS reports `inactive` behind Control Centre and every permission dialog while the app is visible. Android has no such state. | **Defect — fixed (P3).** Pass #7 found it at one site; two more existed |
| **iOS suspends an in-flight upload on backgrounding** | `NSURLSession` pauses rather than fails, so a receipt PUT stalls for as long as the user is away — and the JS timer that would catch it is suspended too | **Defect — fixed (P2)** |
| **First-party sessions are iOS-only** *(carried, pass #5)* | Everything in the session path is untested on the platform carrying most users — and P1 shows the cost: a stall that Android structurally cannot have | **Intended, but P1 is the second defect found inside it** |
| **`mailto:` failure is Android-only** | `Linking.openURL("mailto:")` rejects on Android with no mail app, so the app's fallback alert fires. On iOS it *resolves* and iOS presents its own "No mail accounts" dialog, so `alert.emailNotAvailable` is unreachable there | **Documented, not fixed** — see below |
| **No size guard before `manipulateAsync`** | A very large capture is decoded whole before the resize bounds the output. iOS jetsam is stricter than Android's low-memory killer | **Unverifiable without a handset** — see below |

Re-verified and unchanged: the IDFV-vs-SSAID device-identity asymmetry, the
Android-only build plugins (R8), `blockedPermissions`, and the account-deletion
resilience asymmetry (the one place Android is the weaker platform).

---

## Verified clean in this pass

Recorded so pass #9 does not re-investigate.

- **Keychain coverage is complete.** Nothing imports `expo-secure-store` outside
  `secureStore.js`; all seven `SECURE_KEY_*` values plus `email_tokens_v1` are in
  `MANAGED_KEYCHAIN_KEYS`; `storageService.secureSave/secureGet` still have no
  caller anywhere in `src/`. `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` keeps tokens
  out of encrypted iCloud backups.
- **The iOS privacy manifest covers every required-reason API the app calls** —
  `UserDefaults` (CA92.1), `FileTimestamp` (C617.1, which pass #7's added
  `getInfoAsync` calls need and which this pass's shared helper keeps needing),
  `DiskSpace` (E174.1), `SystemBootTime` (35F9.1).
- **`requireAuth` / `optionalAuthUser` compose correctly.** The misconfigured-
  server 503 precedes the missing-bearer 401; Apple and session bearers are
  exempt from the Google-only config gate (a Google misconfiguration must not
  take iOS sign-in down); the optional variant returns `null` on any verifier
  rejection rather than falling through.
- **All 65 routes enumerated** (63 at pass #6 plus the two credit-desk routes).
  The new pair carries `requireAuth` + `requireDb` + `ADMIN_USER_SUBS`.
  `_adminTokenOk` still charges its throttle before the constant-time compare and
  refunds on success. All three session routes are rate-limited, and
  `/session/refresh` keys on IP so the bucket map cannot become a token oracle.
- **`usersRepo.listForAdmin`** is fully parameterized, escapes `%` and `_` with an
  explicit `ESCAPE`, clamps `limit` to 200, and pages on a stable `(created_at,
  sub)` tiebreak so no row can be skipped between pages.
- **`applyAdminAdjustment`** locks the users row before clamping, so two
  concurrent redeems cannot each take the full balance; the route requires a real
  JSON number, closing the `Number("1e3")` coercion (Bugs #200).
- **`topup_refs` is the replay guard**, independent of `credit_ledger` — so
  wiping a ledger (reset, deletion, or this pass's erasure) cannot re-mint a paid
  pack.
- **The RevenueCat webhook is sound end to end.** TRANSFER handled before the
  `app_user_id` guard with per-source-account audit rows; `rc_event_id` replay
  guard ahead of any state write; the upsert deliberately does **not** reactivate;
  sandbox purchases never settle a referral; top-ups route through the same ref
  the client confirm uses, so the slower path no-ops instead of double-crediting.
- **`_refreshFirstPartySession` is correctly serialized** — one shared in-flight
  promise, so concurrent 401s cannot spend the rotating refresh token twice. P1
  preserved this; a test pins it.
- **`_accountKnown` is reset** on hydrate start *and* in `finally`, so a second
  sign-in in one app session cannot inherit the first's answer. Not firing on a
  failed hydrate is safe — `OnboardingScreen.js:349` awaits the result too.
- **`setNotificationHandler`** already uses `shouldShowBanner`/`shouldShowList`
  rather than the deprecated `shouldShowAlert`, and `channelId` is on the trigger
  (the SDK 53+ contract). A stale handler here would silently drop every iOS
  foreground notification.
- **S7 is genuinely closed** — the tag `image-uploaded` shape-only regex fallback
  is gone; the key must equal the review's device-bound key.
- **The tag submit retry cannot double-credit.** A retry after a lost response
  dedupes on the `deviceHash:date:priceCents` source ref.
- **`subscriptionManager.js`** remains the only importer of
  `react-native-purchases`, every method degrades to `null` when the native module
  is absent, and the customer-info listener returns a synchronous unsubscribe that
  is safe against a late module resolve.

---

## Documented, not fixed

- **The `mailto:` fallback is unreachable on iOS.** `handleShareEmail` in
  `ClaimAssistantScreen` catches an `openURL` rejection and offers a helpful
  alert. Android rejects when no mail app exists; **iOS resolves** and presents
  its own "No mail accounts" dialog, so the alert never fires there. Not fixable
  in code — `canOpenURL("mailto:")` returns true on iOS whenever Mail is
  installed, regardless of whether an account is configured, so there is no
  reliable probe. The mitigation already exists on the same screen: **Copy** and
  **Share** both produce the drafted claim text. Recorded so it is not
  re-investigated.
- **No size guard before `manipulateAsync`.** The resize bounds the *output*; the
  source is decoded whole first. iOS jetsam is stricter than Android's low-memory
  killer, so a very large capture is a plausible iPhone-only crash. In practice
  `expo-image-picker` transcodes and the document scanner emits bounded output, so
  this is speculative — and **unverifiable without a handset**. On the checklist.
- **`analyticsService.track()` applies no scrubbing** while the Sentry path does
  (pass #4). `reportCrash` puts `error.message` and 500 chars of stack into the
  buffer that flushes to `POST /api/analytics`, so an error string carrying PII
  reaches the backend unscrubbed where the same error to Sentry would not. Six
  call sites total, none of which pass PII today. **Carried from pass #4 and
  deliberately not fixed here** — it is a pass-#4 item and this pass was asked not
  to re-open those.
- **Carried forward unchanged:** iOS background execution remains materially
  weaker (`checkAllPriceDrops` still has no foreground equivalent); P3's
  app-switcher snapshot overlay still needs a handset; the IDFV-vs-SSAID
  asymmetry stands; `flagged` is still enforced per-route rather than at
  `requireAuth`; `/api/me` still reactivates unconditionally (dormant — the
  mobile client never calls it).
- **`.p8` and `SESSION_TOKEN_SECRET` remain unset.** This is what makes P1 safe to
  ship: the session path is inert in production, so the fix cannot regress
  anything until the secret is set — and it should be set on a build that carries
  both this and pass #7's nonce work.

---

## Regression risk, stated proactively

| Change | What could regress | How it is controlled |
|---|---|---|
| **P1** | A timeout signs a user out of a good 60-day session. | The catch **keeps** the refresh token; only an explicit 401 clears it, and that branch is untouched with its own test. Asserted directly. |
| **P1** | The abort degrades into a new, untested failure path. | It returns the same `null` that "no session" already returned, so the fallback is the provider-token path Android uses full-time. Asserted end to end: the request still goes out, carrying the provider Bearer. |
| **P1** | The shared in-flight promise breaks, rotating the refresh token N times and tripping reuse detection. | Unchanged, and pinned: five parallel `authedFetch` calls must produce exactly one refresh. |
| **P1** | Android acquires a session call or a new timeout. | Asserted: on Android, with session credentials sitting in the keychain, exactly one request goes out and no session URL is touched. |
| **P2** | A timed-out *upload* becomes a failed *sync*, losing a receipt. | The image is best-effort; a timeout throws into each caller's existing catch, which already treated a failed upload as non-fatal. The receipt is saved server-side before the PUT is attempted. |
| **P2** | The 60 s cap refuses a legitimate large capture. | It bounds a wedged connection, not a slow one, and is 7.5× the app's JSON budget. Asserted `>= 30 s`. |
| **P2** | An SDK without `createUploadTask` breaks uploads entirely. | Explicit fallback to plain `uploadAsync` — today's exact behaviour. Asserted, and it is the path every existing upload suite takes. |
| **P3** | Under-suppression: the banner never fires again. | This is what reusing the gate would have caused, and why the predicate is separate. Asserted on both: the gate is false during an interruption, the predicate true. |
| **P3** | The poller never starts, or never stops. | `appIsOnScreen` is `!== "background"`, so the teardown branch is reached on exactly the state that reached it before. `App.js`'s poller is behaviour-identical by construction. |
| **P4** | A live account's balance is zeroed. | The write sits inside the branch that has already established a genuine soft-deleted tombstone past its window, and the purge's `UPDATE` carries the same `status = false` predicate as its `DELETE`. Asserted with `graceHours: 0` — the most aggressive setting there is — that a live account's balance and history are both untouched. |
| **P4** | Credits earned during the window are erased instead of restored. | The zeroing is confined to the lapsed branch; the in-window replay includes post-deletion settlements. Its own test asserts `balance == SUM(delta)` still holds. |
| **P5** | A support agent working a queue is throttled. | 120/min per admin, against a human clicking. Charged after the admin check, so a non-admin cannot spend an admin's budget — asserted. |
| **P5** | Every admin row in every shopper's credit history renders as "Adjustment". | The actor went into `ref`, not `notes`; the note's exact shape is asserted. |

**The general risk this pass carries:** three of the five findings are on paths
that cannot be exercised without an iPhone. P1 is inert in production until
`SESSION_TOKEN_SECRET` is set, and P2/P3 are on the on-device checklist below.

---

## Tests shipped with the fixes

| Suite | Covers |
|---|---|
| `__tests__/authServiceSessionTimeout.test.js` (10) | All three routes carry a signal; a wedged refresh degrades to the provider token and **keeps** the refresh token; a 401 still clears it; wedged mint and revoke; the shared in-flight promise; Android untouched |
| `__tests__/auditPass8Findings.test.js` (17) | `appIsOnScreen` including the gate-vs-predicate distinction; the two fixed call sites stay fixed; `putImageWithTimeout` timeout, cancel, fallback and a throwing cancel; `imageBytesForPresign` returning `undefined` for every unusable shape |
| `backend/tests/creditRestoreWindowDb.test.js` (+4, DB) | Revival past the window zeroes a tombstone balance; the purge zeroes and reports it; an already-zero row is not rewritten; an in-window settlement is restored, not erased |
| `backend/tests/adminCreditsRoutesDb.test.js` (+5, DB) | The actor lands in `ref`; `notes` keeps its exact shape; a null actor writes `null` not `"admin:null"`; both routes throttled per admin; the throttle is charged after the gate |

**No migration.** Production still owes `0005_object_retention` from pass #6,
unchanged by this work.

---

## On-device checklist

Continuing from pass #7's item 42.

43. **Mid-scan, dismiss the camera and photo permission prompts with items
    waiting in the offline queue.** The "N scans ready to review" banner must
    **not** appear over the app; the in-app pill is the surface (P3).
44. **Background the app, then return.** The banner *should* fire for a drain
    that completed while away — the suppression must not have become permanent.
45. **Sit on Home and pull Control Centre twice.** No extra `/health` or
    connectivity requests per pull; the 30 s cadence is unchanged (P3).
46. **Start a receipt sync on a deliberately poor connection, then background the
    app for two minutes.** The sync must not be wedged on return, and other
    queued receipts must still drain (P2).
47. **Upload a full-resolution price-tag photo** and confirm it still succeeds
    end to end — the 60 s cap must clear a real capture (P2).
48. **Once `SESSION_TOKEN_SECRET` is set**, sign in on iOS and confirm the session
    mints; then put the device on a captive-portal Wi-Fi and confirm the app
    still functions on the provider token rather than hanging (P1). `GET /health`
    with `x-admin-token` should show `sessions: configured`.
49. **Scan a very large image** (a long receipt at maximum resolution) and watch
    for a memory-pressure termination during `manipulateAsync` — the one
    divergence this pass could only document.
50. **Android regression pass, same build:** Google sign-in, a receipt sync with
    an image, the foreground drains after a real backgrounding, the Home
    connectivity indicator, and the scan-ready banner still firing when the app
    was genuinely closed.
