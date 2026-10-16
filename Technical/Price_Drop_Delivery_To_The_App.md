# Price drops reach the app — and deleted receipts leave it (2026-10-15)

**Branch:** `fix/price-drops-not-shown` (off `main` at `73456fa`) · **Bugs:** #324 · **Migration:** 0026

## What a shopper reported

An iPhone shopper (sub `000488.…0338`, joined 2026-10-12) sent screenshots on 2026-10-15. The Tracking tab
listed every receipt under **Watching** and nothing under **Alerts**. Three verified price-drop pushes had
reached them on 2026-10-13/14, and all three were charged (30 + 45 + 30 credits, balance now −30). The phone
also still showed **two** copies of the same $445.23 receipt from 2026-10-09. An admin repair had soft-deleted
the duplicate re-scan (`r_1791823503830_w0dv6`) on 2026-10-13.

## Root causes (every build up to and including 3.0.6)

### RC-1 — the server never sent the phone its drops

A drop reached the phone **only as a push**. The chip that puts a receipt under Alerts
(`item.priceDrop.detected`) was written by just two things:

1. the phone's **own** `/api/check-price` loop, in the background task. On iOS a `BGAppRefresh` task runs
   when iOS decides, often never, and never after a force-quit;
2. the **Check prices** button on the receipt screen.

The bootstrap sends receipts with `priceDrop: null` (`syncService.mapServerReceiptToLocal`), and
`mergeServerIntoLocal` **wipes any chip older than 48 h** on every sync. So even a chip the phone did write
disappeared two days later unless the phone checked again. Tapping the push opened the receipt by id with
nothing on it.

Proof: prod `/api/check-price` returns all three drops for this shopper's SKUs (admin-verified, $2/$2/$3), so
the phone would have shown them had it checked. Server-side everything is consistent: 33 notified drops,
15 shoppers, every one charged exactly once, 0 claimed, 25 still claimable on 2026-10-15. This hit
**every shopper who got a drop**, not just this one.

### RC-2 — a receipt deleted on the server never left the phone

The bootstrap only sends live receipts. The phone read "missing from the server" as "not uploaded yet",
re-sent it, and the server ignored the re-send (`onConflictDoNothing` on the soft-deleted row). The phone kept
the receipt forever. That covers admin repairs, duplicate clean-ups, and a delete made on another device.

### RC-3 (found on the way) — drops keyed by stored position

`releasedForUser` (unreleased, #439) keyed a drop by `receipt_items.position`. Once a line is deleted, the
survivors keep their stored numbers while the phone's array closes the gap, so the drop lands on the next
product down. This affected 1 live prod receipt of 83.

## The fix

### Backend (additive; old builds unaffected)

| Change | Where |
|---|---|
| `releasedDrops` is **always** the released drops; `gated` now only decides whether the phone also strips its own unreleased chips | `server.js _releasedDropsPayload` |
| `position` = the line's index among the receipt's **live** lines | `priceDropQueueRepo.releasedForUser`, `DETAIL_SELECT.lineIndex` |
| **Per-drop lock:** item `locked` = free account below zero now **and** this drop's commission took the balance below zero (`drop:<item>:<cents>` ledger row with `balance_after < 0`). Account `locked` beside it | same |
| Bootstrap `deletedReceiptIds` (soft-deleted receipts of the caller, newest 500) | `receiptsRepo.deletedIdsForUser` |
| Push `data.position` (line index) on `verified_price_drop` | `priceDropNotifier` |
| App build stamped on the account at every bootstrap: `users.app_platform/app_build/app_version/app_seen_at` | migration 0026, `lib/appBuildStamp.js`, `usersRepo.setAppBuild` |
| Admin report `account.app*`; "View as shopper" uses the same index + per-drop lock | `adminConsoleRepo`, `lib/shopperPreview.js` |

**App build source:** 3.0.7+ sends `X-App-Platform/Build/Version`. Older **iPhones** are read from the system
User-Agent (`PriceBack/49 CFNetwork/… Darwin/…`, CFBundleVersion) and mapped to a version through
`KNOWN_BUILDS`. Older **Android** builds send `okhttp/x`, with no build, so the admin screen says "not reported"
rather than guessing. *The iOS User-Agent format is the NSURLSession default and was not observed on a live
request. Confirm on the first prod stamp.*

### App (next build, 3.0.7)

| Change | Where |
|---|---|
| Released drops are applied on every bootstrap / `GET /api/me/drops` / background check, gate or not. A chip the server listed and later withdrew is removed | `services/releasedDrops.js` |
| `priceDrop.revealLocked` from the item lock. `dropLock.hasLockableDrop` hides only drops not explicitly paid: a paid drop stays visible on a locked account, the unpaid one is masked until the balance is ≥ 0 or the shopper subscribes | `services/dropLock.js`, `DetailScreen` |
| A price-drop alert opens **its receipt on its line** (`focusItemIndex`) and pulls the released drops first (`refreshDrops`); if the receipt isn't on the phone yet, it restores the account | `notificationRouting.dropDetail`, `DetailScreen` |
| Receipts in `deletedReceiptIds` are removed and never pushed back; reminders re-armed / orphans cancelled | `syncService.unionMergeReceipts`, hydrate |
| Admin · Account shows **App version** (also in "Copy summary") | `adminAccountActions.appVersionText`, `AdminAccountDetailScreen`, `AdminAccountReport` |

The lock threshold stays "balance **≥ 0** unlocks" (Maxim, 2026-10-01: "back to zero or more").

## What old builds get

**Nothing new on screen.** v3.0.6 and older ignore `releasedDrops`, `deletedReceiptIds` and `data.position`
(all additive). The server cannot put a chip on an old phone: its only drop writer is its own price check,
and `/api/check-price` already answers correctly. Those shoppers need the 3.0.7 build. Once it is live, turn
on **Admin · App version → Update reminder** (`UPDATE_REMINDER_ENABLED`, #440) so every pre-3.0.7 opening
gets an "update PriceBack" push. 3.0.6 and older can't be force-updated, because they don't report their build.

## Deploy order

1. Apply **0026** to prod by hand (additive, nullable), then insert the ledger row with its LF hash.
   **Must precede the backend deploy:** `usersRepo.getBySub` selects every column.
2. Merge → Railway deploys `main`. That also ships #439/#440, which were not live in prod on 2026-10-15
   (`/api/me/drops` → 404).
3. Bump to 3.0.7, tag, build from the tag, release.
4. When 3.0.7 is at 100% in both stores: switch on the update reminder.

## Verification

- `releasedDropsDb`: 9/9 against dev, including live-index keying, per-drop lock below/at zero, gate-off still
  listing, `deletedReceiptIds` scoped per shopper, build stamp from UA and from headers, admin report fields.
- `priceDropQueueDb` (push carries `position`), `shopperPreviewRouteDb`, `shopperPreview`, `appBuildStamp`.
- Mobile: `releasedDrops`, `dropLock`, `syncService`, `notificationRouting`, `adminAccountActions`,
  `shopperPreviewSession`, new `detailScreenRefreshDrops` (a mutation turning off the alert refresh makes 2 of its 3 tests fail).
