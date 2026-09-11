# Sentry triage, 2026-09-11 — the iOS sign-in dead end

**Project:** `prosoft-inc / priceback-canada` (`4511451672412160`), mobile-only.
**Scope:** every issue in the project, 90 days.
**Outcome:** 5 of 7 issues were already fixed by shipped code; 2 were live and
had been misdiagnosed for 17 days.

This is the follow-up the 2026-09-10 task-log entry deferred ("no Sentry token
is reachable from the working environment").

---

## 0. Reading Sentry from here

The `sntrys_…` org auth token supplied for this session carries **`org:ci` +
`project:releases` only**. It works for releases, artifact bundles and
source-map upload — and `403`s on every issue and event endpoint, and on
`stats_v2`.

Two consequences worth writing down:

- **Issues were read through the authenticated browser session**, calling the
  same `/api/0/…` endpoints from the `sentry.io` origin with cookies. That is
  the reliable path when only an org token is available.
- **This token cannot revive the admin console's `sentry_events` quota gauge.**
  `backend/lib/quotaProbes.js → sentryEvents()` hits
  `/organizations/{org}/stats_v2/`, which needs `org:read`. Verified `403`.
  That gauge needs a **User Auth Token**, not an org one.

Writes (resolving issues) additionally need the CSRF header: the cookie is
`sentry-sc`, sent as `X-CSRFToken`. Without it the API answers
`403 CSRF Failed: CSRF token missing.`

---

## 1. The board

| Issue | Title | n | First → last | Verdict |
|---|---|---|---|---|
| **C** `7663571421` | Apple `ERR_REQUEST_UNKNOWN` | **52** | 2026-08-13 → 09-10 | 🔴 live |
| **B** `7663569800` | Google *"Unable to open Safari"* | **37** | 2026-08-13 → 09-10 | 🔴 live |
| D `7672717788` | `DEVELOPER_ERROR` → classified `unknown`, rel 2.8.8 | 1 | 08-14 | ✅ `signin_misconfigured` shipped v2.8.10 |
| F `7681462975` | `T7.b: INTERNAL_ERROR` → classified `server`, rel 2.8.11 | 1 | 08-19 | ✅ `signin_provider_error` shipped v2.8.12 |
| E `7672791520` | `CrashedByAdbException` | 1 | 08-14 | ✅ `isToolInducedCrash` drops it since v2.8.10 |
| G `7683178575` | R8 symbolication probe | 1 | 08-20 | ✅ deliberate admin action |
| H `7690163559` | Google returned no ID token, `attemptMs=7594` | 1 | 08-24 | ✅ fails closed by design (Bugs #206) |

Every real issue in this project's history is in the sign-in path.

**D and F are the interesting "already fixed" pair**: both were *classification*
bugs — a device fault reported as our outage (`server`) and a config error
reported as unclassified (`unknown`) — and both were fixed by a later release
than the one that produced the event. Check the event's `release` against the
fix's first tag before treating a single old event as a live defect.

---

## 2. What B and C actually are

### The shape

- 100% iOS. 11+ distinct `app.device` hashes; six iPhone models (17,2 / 17,1 /
  16,1 / 14,5 / 12,8 / 12,3). `environment: production`. `handled: yes`.
- Releases 2.8.5 → 2.8.20, i.e. every build shipped in the window.
- Every event falls inside **US-Pacific business hours**; on 2026-08-31 two
  different devices failed within a minute of each other. This is App Review and
  TestFlight, not shoppers.
- `userCount: 0` on all of them — the scrubber deleted `event.user`. Fixed in
  this change; see §5.

### The measurement that settles it

`extra.attemptMs` on the Google path, across 37 events:

```
3, 4, 6, 6, 11, 15, 15, 18, 19, 36, 60   (milliseconds)
```

**Not one attempt lived long enough for a browser to open.** For comparison,
issue H — a Google sign-in that genuinely reached the provider and came back
without an ID token — reports `attemptMs: 7594`.

### One session, reconstructed

`app.device 0299ed2a`, iPhone17,2, iOS 26.6.2, `PriceBack@2.8.20` / dist 40:

```
19:30:06.000  app start
19:30:12.141  RNSScreen                       (onboarding on screen, nothing else)
19:30:58.111  TOUCH
19:30:58.298  Apple fails  — 187 ms, ERR_REQUEST_UNKNOWN
19:30:58.711  RCTAlertController "Sign-in failed"          ← our alert
19:31:02.268  Google fails — 15 ms, "Unable to open Safari"
19:31:50.082  RCTAlertController "Sign-in failed"          ← our alert again
19:31:54.333  RCTFabricModalHostViewController             ← reviewer-code modal
19:31:57.9    keyboard (UIInputWindowController, UIPredictionViewController…)
19:32:03.829  Apple fails again
```

### Why the v2.8.13 presenter lock is not the answer

PR #291 shipped `_presentAuthorization` to serialize native sheets, on the
reading that a standing Apple authorization was killing Google's. The field data
refutes it as the cause of B/C:

| | pre-v2.8.13 | v2.8.13+ |
|---|---|---|
| C (Apple) | 35 | **17** |
| B (Google) | 25 | **12** |
| B/C ratio | 0.71 | **0.71** |

A fix that removed the cause would have moved that ratio. Three more
observations point the same way:

1. The paired failures are **3-17 seconds** apart — a person pressing buttons,
   not two sheets racing.
2. The 2026-08-31 22:13:34 Google failure (`attemptMs=60`) has a session whose
   breadcrumbs show *only* `RNSScreen` beforehand. No first sheet existed.
3. Every `attemptMs` is a machine-speed rejection, in every release.

**Conclusion.** The OS is declining to present any authorization UI —
`ASAuthorizationController` and `ASWebAuthenticationSession` alike. That is what
Screen Time / MDM restrictions on **Account Changes** and **Web Content** do,
and it is consistent with a managed or review-fleet iPhone. Keep the lock
(concurrent sheets remain a genuine hazard and it costs nothing); do not read it
as an explanation of B/C.

---

## 3. The defect that IS ours

We cannot unlock the phone. We could stop giving advice that provably fails:

- `err.signInPresentationBody` — *"it usually works the second time."* **0 for
  37.** One install failed at 22:13:34 and again at 22:15:00.
- `err.signInUnavailableBody` — *"or sign in with Google instead."* Google was
  dead in the same session, every time.
- `errorSupport.js` carried the same claim in a comment: *"Unlike the other two,
  retrying genuinely does work here."*

Shipped fix: after **two distinct providers** fail with a presentation-class
category (`signin_unavailable` / `signin_presentation_failed`) in one session,
the screen stops offering a retry and names the restriction, with a support
contact. A single failure keeps the ordinary alert — one flaky provider is real,
and the other button may genuinely work. A 500 never counts toward the tally.

---

## 4. `attemptMs` on the Apple path

Verified absent across six Apple events (`extra` keys were only `category`,
`errCode`, `flow`, `handled`, `reference`). `signInWithApple` now records it,
mirroring the Google path. A 187 ms rejection (nothing was presented) and a 30 s
one (a person answered a sheet that then failed) are different bugs, and without
this field they were one Sentry issue.

---

## 5. Affected-user counts

`beforeSend` did `delete event.user` unconditionally, so **every issue this
project has ever had reported zero affected users**. That makes the question
triage needs unanswerable: 52 events is either one reviewer retrying or 52
people locked out, and those call for opposite responses.

Now: a **random UUID per install** (`pb_sentry_install_id`), sent as `user.id`
with `ip_address: null`. Rebuilt from an **allowlist** — the whole `user` object
is replaced, so an unanticipated field cannot ride along by being unlisted.

Deliberately **not** `purchaseService.getDeviceFingerprint()`, which hashes
`androidId` / `identifierForVendor` and is the anti-abuse key for free-credit
grants: it survives reinstalls and ties to entitlements, and handing it to a
third-party processor would turn a crash report into a durable cross-system
identifier. PIA updated (`legal/pia/sentry-crash-reporting.md`, §6a).

---

## 6. Corrected non-finding

An early read of `app:///main.jsbundle:1` on every frame looked like a dead
source-map upload. **It is not.** The project holds 20+ artifact bundles, dSYMs
and proguard mappings, and our own frames resolve elsewhere (issue H's culprit
is `?anon_0__loop`, the retry loop in `signInWithGoogle`). B and C carry only a
`CodedError` constructor chain because the error is *born inside the native
module* — there are no application frames to map. No source-map work is needed.

Recorded because the wrong version of this conclusion is expensive and looks
right.

---

## 7. Still open

- **B and C stay unresolved** in Sentry until the fix ships in a build. They are
  not fixed by this change — the device restriction is untouched — but the app
  now tells the truth about it. The working door for App Review remains the
  reviewer access code.
- **`sentry_events` quota gauge** needs a User Auth Token with `org:read`.

---

## 8. Closed out — 2026-09-11 (later the same day)

A **User Auth Token** (`sntryu_…`) now exists and is stored as
`SENTRY_API_TOKEN` in the app repo's `.env`. It carries `event:admin`,
`project:write`, `org:read` and `project:releases`, so the whole of §7's tooling
problem is gone: issues are read *and* written over a plain
`Authorization: Bearer` call, with **no browser session and no `sentry-sc` CSRF
cookie**. The `sntrys_` org token stays, and stays for source-map upload only.

Two gotchas worth keeping:

- `statsPeriod` on `/projects/{org}/{proj}/issues/` accepts **only** `''`, `24h`
  and `14d`. `90d` is a hard `400 Invalid stats_period`, not an empty result.
- `/organizations/prosoft-inc/stats_v2/` answers **200** with this token (the
  org token 403'd), so the admin console's `sentry_events` gauge is unblocked —
  it needs `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` set **in the Railway backend
  environment** to the user token. That deploy-side change is not done yet.

**B and C were set `resolvedInNextRelease`, marked against `PriceBack@2.8.20`.**

The marker matters. Both issues' newest events are release `2.8.20` / dist `40`,
which reads at a glance as *"the fix is live and failed"* — it is not.
`v2.8.20` points at `2efa185`; PR #333 is `bc38260`, which landed **after** the
tag. No shipped binary has ever carried the fix, so every event to date is
backlog, not evidence against it.

Resolving *in the next release* rather than outright is the honest state: the
issues are closed for triage, and Sentry reopens them as a **regression** the
moment an event arrives from a build newer than 2.8.20 — i.e. one that actually
contains #333. That regression, if it comes, is the real result of the fix and
should be read as new information. Do not hand-resolve it away.
