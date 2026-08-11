# iOS audit #5 — closing the money batch, and the first full iOS/Android divergence inventory

**Date:** 2026-08-11
**Repo:** `maxim-lucas/Priceback` @ `8c3ec43` → branch `audit/ios-money-and-parity`
**Scope asked for:** a deep iOS-first audit — security above all, then
authentication, credit management, RevenueCat, account management, receipt scans
and price-tag scans — detecting iOS/Android behavioural differences and
documenting anything not fixed.

**This pass did two things:**

1. **Closed audit #4's owed money batch in full** — 12 findings (4 High), which
   had been documented with `file:line` evidence and deliberately left unfixed.
   All 12 were re-verified as still live on `main` before any code was written.
2. **Ran a genuine pass #5** over ground the first four audits never touched,
   and produced the **iOS/Android divergence inventory** that no prior pass had
   assembled.

---

## Why the money batch was the highest-value work available

Audit #4 (earlier the same day) shipped its security/account-isolation half as
Priceback#255 and left the money half written down but unimplemented. Two of the
six areas this goal names explicitly — **credit management** and **RevenueCat** —
lived entirely inside that unshipped half. Re-discovering them would have
produced the same document twice.

Every one was confirmed still present before being touched:

| # | Evidence on `main` @ `8c3ec43` |
|---|---|
| R1 | `subscriptionGate.js:164-170` returns `applied:false` for `TRANSFER` |
| C1 | `clearLocalCreditCache`'s only caller is still `storageService.js:1580` (the *reset* path) |
| C2 | `server.js:6754-6762` reads `consume.consumed` only for the notification |
| S3 | `ScanScreen.js:769` passes no `ref`; `purchaseService.js:880-883` buffers only when `offline===true` |

---

## Where the fix diverged from audit #4's sketch

Recorded because in each case the sketched version is worse, and someone will
otherwise "restore" it.

### R1 — the finding was sharper than filed, and half the proposed fix was wrong

Audit #4 located R1 at `subscriptionGate.js:165-170`. **It never got that far.**
A RevenueCat `TRANSFER` event carries **no `app_user_id` at all** — RC sends
`transferred_from` / `transferred_to` instead — so the webhook route's own guard
(`server.js:4946`, `if (!event?.app_user_id)`) rejected it as malformed and
returned 200 before `applyEvent` was ever called. The transfer is now handled
**before** that guard. A regression test pins this: if someone later moves
transfer handling below the guard, `applyEvent: a REAL transfer never gets past
the app_user_id guard` fails.

**Two things the obvious fix gets wrong:**

- **`SUBSCRIBER_ALIAS` must not be treated as a transfer.** Audit #4 grouped the
  two events together, and the switch statement did too. But aliasing means two
  app_user_ids denoting the **same person** (an anonymous id merged into an
  identified one). Nobody loses an entitlement, so downgrading either side
  **strips a paying customer**. Only `TRANSFER` downgrades; the alias branch
  keeps its own distinct `reason` so the route cannot conflate them.
- **An id present in BOTH lists is filtered out** of the losing set — RC replays
  the whole membership of both sides, and an id on both is the same person
  keeping what they paid for.

**The client-side half of R1 was deliberately NOT implemented.** Audit #4
proposed comparing `customerInfo.originalAppUserId` to the signed-in sub in
`restorePurchases()`. On analysis that is both ineffective and harmful:

- `originalAppUserId` is the *first* app_user_id ever seen for that customer,
  which for any user who was anonymous before signing in is an
  `$RCAnonymousID:…`. An equality check would therefore **refuse legitimate
  restores** for a large, ordinary class of users.
- More fundamentally, a check on **B's** device cannot downgrade **A**. R1 is
  that A keeps the entitlement; nothing B's client does fixes that. The
  server-side `TRANSFER` handler is the whole fix.

Under the standing no-regressions rule, shipping a check that refuses paying
customers to "defend in depth" against something it cannot defend against is the
wrong trade. Recorded here rather than silently dropped.

### C1 — cleared, not flushed-then-cleared

The natural instinct is to settle what is owed before wiping it: upload the
buffered offline spends and confirm the paid-but-unconfirmed packs, *then*
clear. That is wrong here, for three reasons:

- Flushing needs `authedFetch`, and by the time sign-out reaches this point
  `revokeFirstPartySession()` has already wiped the session tokens — it goes
  first on purpose (audit #4, A3). On iOS the call falls back to the provider
  token, and an Apple token older than ten minutes **presents a Face ID sheet in
  the middle of signing out**.
- Flushing *before* the revocation instead re-opens exactly the A3 window that
  ordering closed: an app killed mid-flush leaves the 60-day session refresh
  token alive after the provider token is gone.
- **Nothing the user paid for is lost by clearing.** The RevenueCat webhook is
  the authoritative grantor for credit packs; `confirmPackPurchaseDurably` only
  accelerates it. The buffered offline spends are a debt owed *to us*, so
  dropping them costs a little revenue and cannot harm the user.

Leaving either queue in place is the genuinely bad option: the next account on
the handset would upload the previous one's spends and confirm the previous
one's paid packs under its own token.

`SCAN_COUNT_KEY` and `DEVICE_ID_KEY` are deliberately **not** cleared — they are
the device-scoped anti-reinstall counters, and wiping them would turn sign-out
into a free-scan reset.

### C2 — the charge moved *before* the receipt exists

Refusing required reordering, not just reading the result. `consumeScanCreditOnce`
ran after `receiptsRepo.create()`, so by the time an `insufficient` verdict was
available the receipt already existed. Checking the balance separately and then
creating would have reintroduced precisely the read-then-write race that
`creditsRepo`'s guarded `UPDATE … WHERE scan_credits >= n` exists to prevent.

Only `reason === "insufficient"` refuses. `no_cost` (unlimited/exempt, cost 0)
and `alreadyConsumed` (a retried POST for the same receipt id) both return
`consumed:false` and must keep returning 200 — that is an explicit test, not an
assumption. A thrown error still **fails open**, exactly as before: a ledger
outage must not stop a paying user saving their receipt.

### S3 — unified on charging, not on changing the message

Two options existed: stop claiming a credit was spent, or actually spend one.
Charging is correct — the OCR and LLM calls really did run and really did cost
money, the offline path already charged, and rescanning a gas receipt was
otherwise unlimited free Vision OCR. The spend rides the existing
`appendOfflineScan` → `flushOfflineScanLog` → `/api/me/credits/offline-scans`
path, deduped server-side on `(sub, scan_consume, ref)`, so no new mechanism was
introduced. `receiptScanQueue.js` now behaves the way its own comment already
claimed.

### C4 — worse than filed

Audit #4 recorded that a retired pack makes the topup route answer a bare 400,
which the client read as terminal and dequeued permanently. **The webhook cannot
rescue it either**: a pack retired from the catalog is equally absent from
`TOPUP_PRODUCTS`, so `applyEvent` treats the purchase as a non-top-up and grants
nothing. The user pays and gets nothing from *both* paths. The server now names
the case (`UNKNOWN_PACK`) and the client **parks** the transaction — kept as
evidence for support and the admin reconciliation screen, not retried — instead
of deleting the last local record of a real payment.

---

## Pass #5 — new findings

### N1 — the barcode scanner's photo-permission dead end

**Medium · iOS-primary · fixed**

`BarcodeScanScreen.js:133-135` answered a denied media-library permission with a
bare `Alert.alert(... )` carrying a single OK button. iOS shows the photo
permission prompt **exactly once**: after a refusal
`requestMediaLibraryPermissionsAsync()` resolves `"denied"` immediately without
displaying anything, so the user was told to grant access the app would never
ask for again, with no route to Settings. Android re-prompts until "don't ask
again", so it is merely unhelpful there rather than terminal.

Every other camera and library path already routes through
`alertPermissionDenied` with these exact keys — `ScanScreen.js:534`,
`PriceTagScanScreen.js:295`, and location via `useWarehouseSelection.js:140`.
This screen was simply missed.

**It also corrects audit #4.** That pass listed under *Verified clean*:
"`alertPermissionDenied` is wired on every camera and library path." That claim
was drawn from the screens it looked at; `BarcodeScanScreen` was not one of
them. A "verified clean" line is only as wide as the sweep behind it.

### N2 — the referrer's credit history printed another user's account id

**Medium · both platforms · privacy + hard-rule breach · fixed**

`referralsRepo._settleTx` wrote the referrer's ledger note as:

```js
notes: `referral bonus (referrer) — ${refereeSub} made first purchase`
```

`ledgerNote` (`src/services/creditLedger.js`) maps known notes to translated
labels and **falls back to printing an unrecognised note verbatim** — a
deliberate choice, since English beats a blank row. This note is dynamic, so it
never matched, and the referrer's own Credit History screen rendered:

> Referral bonus (referrer) — 118273645019283746500 made first purchase

Three problems in one line:

1. **Another user's stable provider `sub`** (their Google/Apple account id)
   disclosed to a different user, in the UI.
2. **A raw identifier rendered as display text**, which the repo's own standing
   rule forbids outright.
3. **Untranslated English inside a French UI**, for the same reason.

Fixed on both sides: the note is now static and mapped in EN + FR, *and* the
client matches the legacy prefix so the rows **already written in production**
stop leaking as well. The edge table still records `referee_sub`, so the audit
trail loses nothing.

---

## iOS / Android divergence inventory

The explicit ask, and something no prior pass assembled. Every `Platform.OS`
branch in the app, plus the *implicit* divergences — which carry more risk
precisely because nothing marks them as platform-specific.

### Explicit branches — all 35 sites

| Area | Divergence | Verdict |
|---|---|---|
| `KeyboardAwareScrollView.js:37-38` | iOS `keyboardWillShow/Hide`, Android `keyboardDidShow/Hide` | **Intended** — iOS fires "will" ahead of the animation; Android has no equivalent |
| `Paywall.js:89` | `not_allowed` copy differs — iOS names Screen Time / Ask to Buy, Android names Play account settings | **Intended**, and correct: telling an iPhone user to check "your Google account" is unactionable advice on a path App Review walks |
| `storeLinks.js:22,52` | `itms-apps://` vs Play URL | **Intended** |
| `theme.js:74` | `Menlo` vs `monospace` | **Intended** |
| `DetailScreen.js:1228` | `KeyboardAvoidingView behavior` padding on iOS, undefined on Android | **Intended** — Android's `adjustResize` handles it |
| `ManageSubscriptionScreen.js:484,597` | "Manage/cancel in App Store" vs "Play Store" | **Intended** |
| `OnboardingScreen.js:54` | Apple Sign-In button rendered only on iOS, via lazy import | **Intended** — renders nothing rather than a dead control |
| `OnboardingScreen.js:549,608` | Sign-in body + privacy note differ | **Intended** — iOS copy covers Apple's private-relay email |
| `PriceTagScanScreen.js:258`, `ScanScreen.js:552` | `allowsEditing: Platform.OS !== "ios"` | **Intended** — iOS's crop editor is locked to a square; Android's is free-form |
| `PriceTagScanScreen.js:278`, `ScanScreen.js:506` | Gallery pick uses the MLKit auto-crop scanner on Android; iOS keeps the system picker | **Intended** — VisionKit has no gallery mode |
| `StoresAndProfileScreens.js:1505` | Store-specific deletion copy | **Intended** |
| `authService.js:357,675,853,1215` | Apple Sign-In, Apple token refresh and first-party sessions are iOS-only | **Intended**, and the largest divergence in the app — see below |
| `autoCrop.js:252-278` | Android requests CAMERA via `PermissionsAndroid`; iOS preflights via expo-camera | **Intended** |
| `autoCrop.js:284` | `galleryImportAllowed` only on Android | **Intended** — VisionKit limitation; the app has its own gallery path on both |
| `cameraRollService.js:115,151,168` | Limited Photo access is iOS-only | **Intended** — Android has no equivalent concept |
| `notificationService.js:31,122,315,563,606,645` | Android needs a typed DATE trigger; iOS passes `null` | **Intended** — a bare `{channelId}` throws `hasValidTriggerObject` in SDK 55 |
| `purchaseService.js:98` | Store key selection | **Intended** |

**No defects among the explicit branches.** Every one is deliberate and, in most
cases, carries a comment explaining the platform constraint behind it.

### Implicit divergences — the ones with no `Platform.OS` to grep for

These are the risk. Nothing in the code marks them as platform-specific.

| Divergence | Effect | Verdict |
|---|---|---|
| **First-party sessions are iOS-only** | `user_sessions`, rotation and reuse detection exist only on iPhone. Android authenticates on Google id tokens throughout. Two auth systems, one platform each. | **Intended** (audit #3) — but it means every session-path fix is untested on the platform carrying most users, and `SESSION_TOKEN_SECRET` is still unset, so it is inert in production |
| **Device identity: IDFV vs SSAID** | `getIosIdForVendorAsync()` resets on delete-and-reinstall; `getAndroidId()` does not. The signed-out free-scan allowance is re-mintable on iPhone only. | **Tolerable, documented** — carried from audit #4; no iOS API gives a durable install id |
| **Background execution** | `expo-background-fetch` on iOS uses the iOS-13-deprecated `setMinimumBackgroundFetchInterval`; `stopOnTerminate:false` / `startOnBoot:true` are Android-only, a force-quit stops fetch until relaunch, and Low Power Mode suspends it. `checkAllPriceDrops` runs **only** in that task. | **Defect, not fixed** — the app's core promise is best-effort on iPhone. See below |
| **Android-only build plugins** | `withGradle10Compat`, `withAndroidPermissionCleanup`, `withAndroidR8FullMode` + R8 minification. iOS has `withIosPrivacyStringCleanup`, `withIosModularHeaders` and no minifier. | **Intended** — but it means Android ships a shrunk/renamed binary iOS never does, so an Android-only field crash implicates R8 first |
| **Scanner capture storage** | iOS `react-native-document-scanner-plugin` writes to `Documents/` permanently; Android MLKit writes to the reclaimable Play-services cache. | **Fixed in audit #4 (S2)** |
| **Account deletion resilience** | Android's `signInSilently` re-mints id tokens with no server involvement, so a second signed-in device resurrects a soft-deleted account. An Apple token dies in 10 minutes and needs Face ID. | **Android is the weaker platform here** — the one place in five audits where that is true. Fixed in audit #4 (A2) |
| **`blockedPermissions`** | `READ_MEDIA_*` blocked on Android; no iOS analogue exists or is needed. | **Intended** |

---

## Verified clean in this pass

Recorded so pass #6 does not re-investigate.

**Referral system.** Genuinely well-built, and it grants real credits so it was
read closely. `redeem` guards self-referral by code *and* by sub, rejects an
already-redeemed referee, rejects a completed account (`postalCode`), treats a
soft-deleted inviter as not-found (without leaking that the account existed),
and leans on the `user_referrals.referee_sub` UNIQUE as its idempotency guard.
Payout is **deferred** to the referee's first purchase.
`settleReferralOnFirstPurchase` locks the edge `FOR UPDATE` and guards on
`settled_at` — deliberately *not* on the reward ledger ids alone, because those
are `ON DELETE SET NULL` and "Reset All Data" would otherwise let a referral pay
twice. Sandbox purchases never settle a referral, because the payout is real
credits for a $0 transaction. The only defect found was the note text (N2).

**Microsoft OAuth redirect.** `emailSyncService.js:786-796` uses a custom
`priceback://auth/microsoft-callback` scheme, and a custom scheme is claimable
by any app on iOS — but `usePKCE: true` is set and `code_verifier` is passed to
`exchangeCodeAsync`, so an interceptor without the verifier cannot exchange the
code. Correct. Note the dependency: **removing PKCE would silently make this
exploitable.** The feature is inert in production anyway (`gmailSyncEnabled:
false`, Microsoft placeholder-gated).

**`scheme: "priceback"` with no deep-link handler.** `app.json:5` declares the
scheme and the app registers no handler at all — no `getInitialURL`, no
`Linking.addEventListener`. That is not a vulnerability: with no handler, an
inbound link does nothing beyond launching the app. Worth knowing before anyone
adds deep links, since the scheme is already claimable.

**Credit atomicity.** Re-confirmed: `creditsRepo` has no read-then-write
anywhere, the balance floor lives in the `UPDATE`'s `WHERE`, and the per-ref
advisory lock serializes same-ref spends. The C2 fix builds on this rather than
around it.

---

## Documented, not fixed

### iOS background execution remains materially weaker (carried forward)

Unchanged from audit #4 and still the largest functional gap between platforms:
`checkAllPriceDrops` runs only inside the background-fetch task, which on iOS is
best-effort, stops entirely after a force-quit, and is suspended in Low Power
Mode. The scan queues and the credit buffer are mitigated by foreground drains
(`App.js:345-430`, `bootService.js:119`, and now the R3 foreground
`syncPurchases`); **price-drop detection still has no foreground equivalent.**

This needs its own task, and there are only two real shapes: a throttled
foreground sweep, or server-side detection pushed down as a notification. It was
not bundled into an audit branch because it is a feature decision about the
app's core promise, not a defect fix.

### The parked-transaction queue can still be trimmed

`enqueuePendingTopupConfirm` keeps only the newest 30 entries
(`slice(-PENDING_TOPUP_MAX_ENTRIES)`). A parked `UNKNOWN_PACK` transaction is
skipped by the flush and never expires, but it can still be trimmed out if 30
newer confirms arrive. Reaching that requires 30 pack purchases after a retired
one, which is not a realistic state; recorded rather than engineered around.

### The client cannot tell the user their receipt was refused

When the server answers `402 INSUFFICIENT_CREDITS`, the client discards the
local receipt (correctly) but shows nothing — the sync is fire-and-forget and
the UI has already navigated away. This path is only reachable in a race: the
client gate (`canAddReceipt`) runs *before* OCR, so a refusal requires the
balance to reach zero between the gate and the POST — a concurrent scan, or a
spend on another device. The next balance read surfaces the real state and the
paywall appears on the next scan. Surfacing it properly needs a UI channel the
sync layer does not currently have.

### P3 — app-switcher snapshot protection: still recommended, still not shipped

Unchanged and still correct. iOS reports `"inactive"` for a Control Centre pull,
a notification-shade drag, an app-switcher half-swipe **and every system
permission dialog**, so an overlay wired to it flashes during camera and
location prompts — a visible regression on the app's most important flow. The
only way to know whether an implementation gets that right is to watch it on a
handset, and **nothing in this project has ever run on an iPhone.** It stays on
the on-device checklist.

---

## Regression risk

Stated proactively, per the standing rule.

| Change | What could regress | How it was checked |
|---|---|---|
| **C2** (sharpest) | Turning a silent 200 into a 402 touches every scan. A wrong `isCreditExempt` or cost lookup would refuse paying users. | Only `reason === "insufficient"` refuses; `no_cost` and `alreadyConsumed` are separately asserted. A thrown error still fails open. |
| **C1** | Clearing too much would reset the free-scan allowance. | `SCAN_COUNT_KEY` / `DEVICE_ID_KEY` explicitly asserted untouched. |
| **C1 staleness bound** | An offline user with a valid balance could be blocked. | 7-day window; expiry fails *closed* to the existing `unavailable` branch. Three existing fixtures relied on an un-timestamped snapshot and were updated deliberately, not worked around. |
| **R1** | Downgrading the *receiving* account would strip a paying customer. | Only `transferred_from` is touched; ids on both sides filtered; `SUBSCRIBER_ALIAS` explicitly excluded, with tests for both. |
| **S3** | Double-charging a rejected scan, online then offline. | Online successes still buffer nothing (asserted); rejects use a fresh synthetic ref; server dedupes on `(sub, scan_consume, ref)`. |
| **C3** | Removing acknowledged-only refs could strand entries forever. | Falls back to the full sent set when the server returns no `applied[]`, preserving old-backend behaviour. |
| **R5/R6** | Purchase surfaces now show store prices. | Falls back to the catalog label on any failure, so a price never blanks. |
| **N2 legacy match** | Over-matching would swallow unrelated notes. | Prefix-anchored on `referral bonus (referrer/referee)`; the generic English fallback is separately asserted still to work. |

**Verification:** full mobile Jest suite **177 suites / 4178 tests, all green**;
backend gate units **101/101**; `npm run i18n:check` passes (EN/FR, 1438 keys
each). The DB-backed backend suite is left to CI by standing rule.

**No iOS-only UI change ships in this branch that cannot be verified without an
iPhone.**

---

## On-device checklist

Continuing from audit #4's items 16–22.

23. Buy a credit pack, then **force-quit before the confirm lands**. Reopen and
    confirm the balance arrives (durable confirm queue + R3 foreground sync).
24. With **Ask to Buy** enabled on a child account, buy a subscription and have
    it approved later from the parent device. The app must unlock without a
    restart — this is R3's listener, and it had no coverage at all before.
25. Open **Plan & Credits** as an ANNUAL subscriber: the price must read the
    annual store price, the Annual card must show as current and not be
    tappable, and Restore + Terms + Privacy must be present (R5, R6).
26. Sign out with credits on the account, sign in as a second account, go
    offline and scan. It must refuse — not spend the first account's balance
    (C1). Confirm **no Face ID sheet appears during sign-out**.
27. Scan a **gas receipt** and confirm the balance actually drops by 1, both
    online and offline, and that scanning it three times costs three (S3).
28. Deny photo permission, then tap **gallery import on the barcode scanner**:
    it must offer Open Settings, not a dead OK (N1).
29. As a referrer whose invitee has just made their first purchase, open
    **Credit History**: the row must read a translated sentence with **no long
    digit string** in it (N2).

**Android regression pass, same build:** sign-out clears the credit cache and
queues; a gas receipt costs exactly one credit; purchases, restore and the
paywall unchanged; the blocked-email alert signs out even when dismissed with
the hardware back button (R2).
