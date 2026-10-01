# Notification deep-link routing

Where a tapped notification takes you, and the two lifecycle states that used to
swallow the tap entirely. Added 2026-09-21.

---

## The problem, precisely

Tapping the admin *"Price tag awaiting review"* push opened the app to wherever
it happened to be — **even though the branch for it existed** (`App.js:341` sent
`tag_review` to `AdminTagReview`) and a test asserted it.

Three separate causes, stacked:

1. **The branch only runs for a warm app.** A tap on a *killed* app never
   reaches `addNotificationResponseReceivedListener`: the process starts, the
   listener registers after the fact, and the only record of the tap is the one
   the OS holds via `getLastNotificationResponseAsync` — which was never called
   anywhere in the repo.
2. **Calling it would not have been enough.** `SplashScreen` `replace`s the
   whole stack 1.8–2.6 s after mount (6 s on the failsafe path), so any
   `navigate` issued before that lands is silently discarded by it. This is a
   no-op, not a race: it fails the same way every time.
3. **The callback signature capped the feature.** `(receiptId, type)` discarded
   every other field, so `reviewId`, `storeCode`, `balance` and `count` could
   not reach the navigator *even where a branch existed*. Only **4 of 16** push
   types routed anywhere at all.

---

## The routing table

`src/services/notificationRouting.js` — one pure function, no React Navigation
import, testable without mounting a navigator.

```js
routeForNotification(data) -> { route, params } | null
```

| `data.type` | Opens | Carries |
|---|---|---|
| `verified_price_drop`, `price_drop`, `flyer_drop` | `Detail` | `receiptId` |
| `expiry_warning`, `expiry_early`, `expiry_final` | `Detail` | `receiptId` |
| ~~`price_drop_charge`~~ | *retired 2026-10-01 — no longer sent, no route; an old one in a tray takes the generic fallback* | — |
| `tag_verified` | `CreditHistory` | — |
| `low_balance` | `BuyCredits` | — |
| `referral_settled` | `InviteFriend` | — |
| `store_launch` | `Main` → `Stores` | `storeCode` |
| `daily_digest` | `Main` → `Receipts` | — |
| `tag_scans_ready` | `PendingTagScan` | — |
| `receipt_scans_ready` | `PendingReceiptScan` | — |
| `scan_review_reminder` *(2026-09-25)* | `PendingTagScan` / `PendingReceiptScan` | `kind` (`tag` \| `receipt`) |
| `first_receipt`, `scan_reminder` *(2026-09-25)* | `Scan` (the root-stack scanner modal, not the `ScanTab` placeholder) | — |
| `monthly_recap` *(2026-09-25)* | `Main` → `Receipts` | — |
| `referral_nudge` *(2026-09-25)* | `InviteFriend` | — |
| `profile_location` *(2026-09-30)* | `CompleteProfile` (postal code + province) | — |
| `profile_costco` *(2026-09-30)* | `CostcoProfile` (warehouse + membership tier) | — |
| `tag_review` (admin) | `AdminTagReview` | `reviewId` |
| `price_drop_review` (admin) *(2026-10-01)* | `AdminPriceDropQueue` | `pending` |
| `test` | *nowhere, deliberately* | — |

21 types since 2026-09-25. Every one of them — except `test` — also belongs to a
switch in `shared/notificationCategories.js`; see
`Technical/Notification_Categories.md`.

`null` means "just open the app" — which is exactly what every unrouted type did
before, so an unrecognised push can never be worse than it is today. An unknown
type that nonetheless carries a `receiptId` still opens that receipt, preserving
the old catch-all for any push type added server-side before the table learns
about it.

**A tab lives inside the `Main` stack route**, so those entries use React
Navigation v6's nested form — `navigate("Main", { screen: "Stores", params })`.
Navigating to `"Stores"` from the root would throw.

### `price_drop_charge` deliberately carries no receipt id *(historical — retired 2026-10-01, see `Technical/Price_Drop_Lock_And_Notifications_2026-10-01.md`)*

It is one consolidated message per user covering several receipts, so naming one
would point at an arbitrary member of the set. The credit ledger is the honest
answer. **No backend payload was changed** for this work — every type routes on
what it already carried.

---

## Cold start: park, then replay

```
SplashScreen.initNotifications()   ← awaited
  └─ getColdStartNotificationData()      (OS's launch response)
       └─ routeForNotification(data)
            └─ parkDeepLink(target)      ← pendingDeepLink.js, one slot
...
SplashScreen.navigate("Main")
  └─ navigation.replace("Main")
  └─ takeDeepLink() → navigation.navigate(route, params)
```

The capture is **awaited inside the same init block** the splash awaits before
it navigates. That ordering is the whole reason the parked route survives — a
capture racing the `replace` would land on either side of it depending on how
fast the device is.

Two guards keep the OS's remembered response from misfiring, because it is
returned whether or not this launch came from it:

- ids already handled by the live listener in this runtime are skipped, so a
  warm tap is never replayed by a later re-mount;
- a response older than **5 minutes** is ignored, so opening the app from the
  launcher next week does not resurrect a dead price-drop alert.

When the boot decides the user is **not** entering the app (Onboarding
incomplete), the parked target is **cleared**, not carried: a notification must
never jump an unfinished sign-up, and must not linger to ambush the next boot.

`navigationRef` is now a `createNavigationContainerRef` in
`src/navigation/navigationRef.js`. The previous bare `useRef` was
component-local — unreachable from a service — and had no `isReady()`, so a
caller could not tell a navigation that landed from one silently dropped. That
distinction is precisely what the cold-start path needs.

---

## The drift guard

The table is only as good as somebody remembering to extend it. The last block
of `__tests__/notificationRouting.test.js` walks the **actual senders**
(`backend/server.js`, `backend/priceDropNotifier.js`,
`src/services/notificationService.js`, and — derived, since 2026-09-25 — every
file in `backend/jobs/`), extracts every `data.type` they emit, and fails if any
is unroutable — so a new push type is caught at CI time rather than in
production, which is how twelve of them got there in the first place. A sender
must spell `data: { type: "…" }` literally for the guard to see it
(`jobs/reengagement.js` does, on purpose).

It checks **both directions**: a type the table declares but nothing sends is
dead weight, and dead weight is how a table stops being trusted. It also asserts
the scan is not vacuous (≥10 types found), because a regex that silently stops
matching would otherwise pass on an empty set.

Mutation-checked when written: renaming one table entry (verified 1 → 0
occurrences in the source) failed the guard.

---

## Adding a new push type

1. Add the type to a category in `shared/notificationCategories.js` (a new
   category needs its seed row, `DEFAULT_PREFS` entry, a row on the
   Notifications screen and labels in every language — the tests list what is
   missing). Copy it into `backend/shared/` (or run `node backend/scripts/sync-shared.js`).
2. Add the sender, with a literal `data: { type: "…" }`.
3. Add its `data.type` to `ROUTES` in `notificationRouting.js`.

If you skip step 1, the server's `sendUserPush` refuses the push and
`notificationCategories.test.js` fails; if you skip step 3,
`notificationRouting.test.js` fails. That is the point.
