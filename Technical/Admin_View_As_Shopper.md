# Admin · View as shopper

**Added:** 2026-10-15 · app PR #439 (`feat/admin-user-preview`) · docs branch `docs/admin-view-as-shopper`

## Why

Support mail mostly reads *"I can't see my product / my price drop / my credits"*. The account report
(`GET /api/admin/users/:sub/report`) says what **happened** to an account; this screen says what the
shopper **sees**: their receipts and lines as their device rehydrates them, each drop as it appears on
their screen (including drops hidden by the below-zero lock), their balance and credit history, and a
plain-English diagnosis of why something is missing.

## How to open it

Admin · Accounts →
- the **eye icon** on any row, or
- the row's **⋯** sheet → *View as shopper*, or
- the account screen → *View as shopper*.

## What it shows

| Section | Content |
|---|---|
| Header | masked email (`s•••@gmail.com`), 8-char account ref, plan, province, language, OS + last seen |
| What's going on | diagnosis cards: hidden drops (and the credits needed to unlock them), no push token, alerts muted, no receipts, empty receipts, unsupported store, all windows closed, suspended account |
| Their home screen | credits, open drops, $ to claim, lifetime claimed; the **exact `LockedDropCard`** the shopper sees when drops are hidden; alert status |
| Receipts | each receipt (store, warehouse, date, window days left); each line with its printed label, product name, SKU and, per drop: **"Shopper sees: …"** + the new price, saving and credits charged |
| Credit history | the last 50 ledger rows, labelled the way the shopper's Credit History labels them |

Drops are the ones **PriceBack's server found and notified** (`price_drop_notifications`, lowest price
per line — the price the commission was billed against). A drop the app found by itself through
`/api/check-price` but the server never notified is not listed (see *Limits*).

## Privacy — allowlist, not denylist

`backend/lib/shopperPreview.js` picks every outgoing field by name; nothing is spread from a DB row, so a
column added later cannot leak through this route by default. **Never sent:** name, full email, postal
code, push token, device / session ids, full account sub, member id, raw OCR (carries card digits and
approval codes), receipt image key, store transaction ids, ledger refs/notes, referral code/friends,
consents. Pinned by `backend/tests/shopperPreview.test.js` (feeds rows carrying every secret and searches
the output) and `backend/tests/shopperPreviewRouteDb.test.js` (real Postgres, card digits in raw OCR).

Read-only: nothing on the screen changes the account. Admin-gated (`ADMIN_USER_SUBS`), throttled on the
admin desk budget, every read logged with the actor (`[admin] shopper preview read sub=… by=…`).

## API

`GET /api/admin/users/:sub/preview` → `{ account, plan, credits{balance, dropsHidden, neededToUnlock,
history}, alerts, summary, receipts[], diagnosis[] }`. 403 non-admin, 404 unknown account. Additive — no
shipped build calls it.

## Limits

- Shows the **server's** copy. Receipts that never synced from the phone are absent (the diagnosis says so
  when there are none).
- Drops found only by the app's own price check (never notified — e.g. no push token, alerts muted) are
  not listed. The diagnosis flags those accounts.
- The saving's own end date is not applied per line (the store window is); the shopper's app may show a
  shorter deadline for a short saving.

## Hidden drops unlock automatically (same change)

`src/services/dropLock.js` hides an unclaimed drop's item and price for a **free account whose balance is
below zero**. Unlock rule: balance **≥ 0** after buying credits, or **any subscription**.

Before 2026-10-15 the lock was re-read only when a screen regained focus, so a purchase that settled while
the shopper stayed on the same screen (webhook-confirmed pack, a retried confirm, a restored
subscription) kept the drop hidden until they navigated away and back. `purchaseService` now emits an
entitlement-change signal on every write of the cached balance or premium status, and `useDropLock`
re-reads on it. Tests: `__tests__/dropLock.test.js` ("unlocks by itself after a purchase…"),
`__tests__/offlineScanCredits.test.js` ("entitlement change signal"). A mutation removing the
subscription turns three tests red.

## Why nobody has bought credits yet — prod read 2026-10-15

Read-only queries on prod (`xjfrlzwonyaorwktnkpj`):

- **161 active shoppers: 149 have a positive balance, 6 are at 0, 6 are below 0.** **0 credit packs ever
  bought** (`topup_refs` empty); 1 paid subscription.
- **14 shoppers** received server-found drops: **41 drops, ≈ $125** of savings (the rest of the ~$150
  is drops the app found itself). **0 of 41 claimed.**
- Commission (15 credits/$) is paid out of the **75 welcome credits** first. 8 of the 14 are still at
  ≥ 0, so **they see every drop in full and never meet a paywall** — there is nothing to buy.
- The 5 shoppers who went negative (−269, −180, −49, −30, −16) did so on **2026-10-13/14**: the lock has
  reached them only in the last 1–2 days. Too early to call conversion.
- Several drop recipients had not opened the app since **before** their first drop (last seen
  2026-09-17 … 2026-10-04): the push is the only touchpoint they had.
- **Trap:** the $3 starter pack is 250 credits. The shopper at −269 who buys it lands at −19 — **still
  locked**, having paid. The lock card says only "Unlock"; it never says how many credits unlock it.

Suggested (not built — needs a product decision):
1. Say on the lock card how many credits unlock the drops, and pre-select the smallest pack that covers it.
2. Decide whether a free account at ≥ 0 should keep seeing drops in full (today the welcome credits pay
   for up to ~$5 of drops before any paywall).
3. Look at the zero claims: none of the 41 drops was marked claimed, including fully visible ones.

## Open their app — the real screens (added later the same day)

The summary screen has **Open their app — exact screens, read-only**. It opens the shopper's real Home,
Receipts, Stores and Profile tabs (same tab bar), and the screens they lead to (Detail, claim assistant,
paywall, credit history, invites, notification settings, Costco profile, subscription, FAQ, tutorials,
guarantee, savings streak), fed with that shopper's redacted data and shown in **their language**.
Camera, scanning and Gmail screens are not hosted. Tapping one leaves the preview.

How it stays safe (`src/services/shopperPreviewSession.js`, `src/screens/ShopperPreviewHost.js`):

| Guard | While a preview runs |
|---|---|
| AsyncStorage (wrapped once at startup) | snapshot keys read the shopper's data; a key the snapshot lacks reads **empty**; **every write is dropped** |
| fetch (the version wrapper) | **every** call to our API returns a local `423` — reads too (a `GET /api/me/*` would answer with the admin's account) |
| purchases | `purchaseProduct` / `restorePurchases` refused (the admin's own store account) |
| local notifications | no schedule, no cancel (the shopper's reminders on the admin's phone / the admin's own cancelled) |
| identity | `getStoredUser` returns the **masked** email, no name, no photo |

The session is entered only while the host has focus, and the real screens mount **after** it is entered
(React runs child effects first). It ends on blur or unmount, and the admin's language is restored.

Settings shown (summary + Profile): language, default warehouse, membership type, auto-reload, low-balance
warning, notification switches, friend invites. Each friend is **an initial and a date**, never a name or
a photo.

## A drop shows in the app only once released

Before: the phone's own price check put a drop chip on screen as soon as a verified lower price existed,
before admin review and without any charge. Now `priceDropQueueRepo.releasedForUser` lists, per live
unclaimed line, the lowest released price: notified, approved/sending/sent, or pending when review is
off. It is served on `/api/me/bootstrap` (`releasedDrops`) and `GET /api/me/drops`. The app
(`src/services/releasedDrops.js`) shows only released drops, at the released price. A lower price found
on an unreleased line reads "Lower price found — we're verifying it". Old builds (≤ 3.0.6) keep their own
chip.

## "Unlock" preselects the pack that unlocks

From a locked drop, the paywall puts first, and marks, the smallest pack that brings the balance back to
≥ 0 in one purchase. The hero says how many credits it takes. When no single pack covers the deficit, it
points to the subscription. Hidden drops unlock the moment the balance is written back to ≥ 0 or a
subscription lands (entitlement-change signal).

## Maintenance mode and old builds (Admin · App version)

- **Maintenance mode** (`MAINTENANCE_MODE`, off by default): shopper-app routes answer `503` "PriceBack is
  down for maintenance". 3.0.7+ shows a blocking **Under maintenance** screen (EN/FR) that re-checks every
  30 s and lifts by itself. 2.9–3.0.6 show their own maintenance copy. Admins, the admin console, webhooks,
  importers and the public JSON keep working.
- **Minimum build** (existing): 3.0.7+ below it gets the blocking **Update required** screen with a store
  button, at launch and on every return to the foreground.
- **Refuse builds before 3.0.7** (`REFUSE_UNREPORTED_BUILDS`, off by default): those builds send no build
  number, so the minimum can't reach them. On: their shopper-app calls get `426`; 3.0.4–3.0.6 show "This
  version of PriceBack is out of date". **Turn on only once 3.0.7+ is live to 100 % in BOTH stores.** It
  can't be turned on from a phone that doesn't report its own build.
- **Silent auto-install is not possible** for a store app. Android can run Play's in-app *immediate
  update* flow, but it needs a native module (`expo-in-app-updates` or similar), i.e. a new build. Not
  done: needs a decision.
