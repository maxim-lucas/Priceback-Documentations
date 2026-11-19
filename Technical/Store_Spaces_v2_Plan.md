# Store Spaces v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Store Spaces v2 redesign (onboarding A–H, five-tab shell, store spaces, Deals, store vote,
Me, paywall hero B) without changing anything for any app build already installed.

**Architecture:** Backend first, additive only, deployable on its own with zero client change. New client behaviour
is announced by the client through a capability header (`X-App-Caps`), so the server changes nothing for a request that
does not carry it. Then the mobile shell, screens and onboarding on the new build only. Store consoles before any build.

**Tech Stack:** Expo / React Native (jest), Node + Express + Drizzle on Supabase Postgres (`node --test`), RevenueCat,
Play Console, App Store Connect.

**Spec:** `Technical/Store_Spaces_v2_Design.md` (approved 2026-11-10). Read it with this plan; section numbers below
(§n) are the spec's.

**Branches:** app `feat/store-spaces-v2` from `main` `70991cb3`, worked in a separate worktree
(`C:\Workspace\Priceback-ssv2`) so the `feat/ads-rewarded-credits` checkout is untouched; docs `docs/store-spaces-v2`.
Neither is merged until Maxim says so.

## Global Constraints

- Every screen matches the design's render exactly (spec §2 rule 1). Source files: `Store Spaces v2.html`,
  `redesign/shared.jsx`, `spaces2-parts.jsx`, `spaces2-deals.jsx`, `spaces2-app.jsx`, `spaces2-onboarding.jsx`
  (project `96786fd7-4201-49b9-a7f1-2143421c50fa`). Design tokens: bg `#eef5f1`, ink `#0d3d28`, inkDeep `#062a1a`,
  accent `#10b981`, accentSoft `#dcfce7`, accentInk `#15803d`, border `#d8e3dd`, divider `#e8efea`, sub `#5b6b7e`,
  subDim `#94a3b8`, lime `#bef264`, limeSoft `#d9f99d`, paywall green `#047857`.
- Stores only from `getEnabledStores()`; no store id in JSX. Shoppers see nothing of a store that is not live; admins
  also see `adminPreview` stores, marked "Admin preview" (§13 Q2).
- Every label in every language of `translations` (`en`, `fr`); `npm run i18n:check` green; no raw codes on screen.
- Backend: additive only; no route, request field or response field an installed build reads is removed, renamed or
  changes meaning; new request fields optional; migrations additive + idempotent, applied to dev then prod **before** the
  backend that reads them (CLAUDE.md "The backend never breaks an app build that is still installed").
- Costco parser files and `receiptParsingShared.js` / `receiptGeometry.js` untouched
  (`__tests__/costcoPathImmutability.test.js` stays green).
- Tests ship in the task that adds the code. Backend suite: only the files in the blast radius, one run at a time, dev DB
  only. No GitHub Actions dispatch. No `eas build` (spec §2 rule 7, plus Maxim's go).
- Paywall: only the hero card changes (colour B, total only). The free week appears only on screen H (§13 Q4).
- Notifications: Android requires them to create an account; iOS asks, a denial is allowed; every receipt scan with
  notifications off shows the price-drop-alerts popup (§16).

## Review Focus

1. **A new build talking to a backend that predates this work** (prod before the backend deploy, or a rollback): no
   `trial` in `/api/me`, `/api/deals` and `/api/stores/vote` answer 404. Expected: no screen H, credits come from the
   server exactly as today, Deals shows its unavailable state, the vote button is hidden. Tests in Tasks 16, 17, 21.
2. **One account on an old build and a new build at once.** The old build's sign-in auto-grants the 75 credits.
   Expected: the new build's screen H and the "Start your free trial" strip disappear (choice reads as credits), nothing
   crashes; a `business` membership set on the new phone is not overwritten by the old phone. Tests in Tasks 3, 4, 21.
3. **A store's live state changes while the app is open** (remote stores refresh turns a store off, or an admin loses
   admin). Expected: the store vanishes from rails, pills and Deals; an open store space falls back to Home; a
   `store_launch` push or deep link to a store that is not live opens Home. Tests in Tasks 8, 10, 12.
4. **Postal codes as people type them** (lowercase, no space, pasted with spaces, a valid shape whose first letter maps
   to no province, cleared after being valid). Expected: normalised `A1A 1A1`, province shown read-only, Create account
   disabled whenever postal or province is missing. Tests in Task 20.
5. **The trial purchase does not complete** (payment sheet dismissed, purchase pending, store error, already
   subscribed). Expected: no choice recorded, screen H stays the launch screen, no credits granted. Tests in Task 21.

---

## Phase 0 — Baseline

### Task 0: Live-build audit and the old-build contract

**Files:**
- Create: `backend/tests/storeSpacesCompat.test.js`, `backend/tests/storeSpacesCompatDb.test.js`
- Modify (docs): `Technical/Backend_Backward_Compatibility.md` (new section "Store Spaces v2")

**Interfaces:**
- Produces: the characterization suite every later backend task must keep green.

- [ ] **Step 1: Find the builds in the stores.** Read the live version on Play Console (Production track) and App Store
  Connect (Ready for Sale) through Chrome, read-only. Record both in the compat doc with the date.
- [ ] **Step 2: Diff against the oldest live build.** `git diff v<oldest-live>..origin/main -- backend shared` and list,
  route by route, what this work touches: `upsertFromOAuth` callers (`server.js` 10647, 10807, 11572, 11884, 12016,
  12203, 12442, 12999, 13064), `GET /api/me` (12005), `PUT /api/me/profile` (12370), the RevenueCat webhook (~11603),
  `usersRepo.updateProfile` membership whitelist (894–896), `shopperPreview.js:223`.
- [ ] **Step 3: Write characterization tests that pass on `main` today.**

```js
// storeSpacesCompatDb.test.js — each test builds requests with NO X-App-Caps header
test("verified sign-in without caps grants FREE_TRIAL_CREDITS once", ...)        // scanCredits === 75, ledger row 'signup'
test("second sign-in without caps does not grant again", ...)                    // still 75
test("GET /api/me keeps every field 3.6.1 reads", ...)                           // deepEqual(Object.keys subset, SNAPSHOT_KEYS)
test("PUT /api/me/profile without language or caps still 200", ...)
test("costcoMembershipType 'executive' round-trips; 'gold_star' round-trips", ...)
test("POST /api/stores/:code/notify-me unchanged", ...)
```
`SNAPSHOT_KEYS` is the key list `/api/me` returns on `main` today, written into the test.

- [ ] **Step 4: Run** `cd backend && node --test tests/storeSpacesCompat.test.js tests/storeSpacesCompatDb.test.js` on
  the dev DB. Expected: all pass, `skipped 0` (a skipped DB file exits green; read the count).
- [ ] **Step 5: Commit** `test(compat): pin the old-build contract for Store Spaces v2`.

## Phase 1 — Backend, additive, deployable alone

### Task 1: Migration 0050

> **Renumbered 2026-11-18:** `main` took 0050–0052 while the branch was open, so this migration ships as
> `0053_store_spaces_v2.sql` (test `migration0053Db.test.js`) in the merge branch `feat/store-spaces-v2-main`.
> The SQL is idempotent, so a database that ran it as 0050 is unaffected.

**Files:**
- Create: `backend/db/migrations/0050_store_spaces_v2.sql`
- Modify: `backend/db/schema.js`, `backend/db/deploy/schema.sql` (regenerate), `backend/db/migrations/meta/_journal.json`
- Test: `backend/tests/migration0050Db.test.js`

**Interfaces:**
- Produces: `users.trial_choice text NULL CHECK (trial_choice IN ('week','credits'))`,
  `users.trial_chosen_at timestamptz NULL`, `products.category jsonb NULL` (`{en, fr}`), table
  `store_votes(user_sub text PK → users.sub ON DELETE CASCADE, store_id integer NULL → stores.id, other_text text NULL
  CHECK (char_length(other_text) <= 60), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (store_id IS NOT NULL OR other_text IS NOT NULL))`.

- [ ] **Step 1: Failing test**: columns and table exist; running the SQL twice is a no-op (`IF NOT EXISTS` everywhere);
  `costco_membership_type` default unchanged.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write the SQL and the Drizzle definitions.** Check `main-test-features`' migration numbers first; if
  0050 is taken there, take the next free number on both lines and say so in the PR.
- [ ] **Step 4: Apply to dev only** (`gnedluuylimjwdmtvswl`), run the test, expect PASS. Prod is applied in Task 23.
- [ ] **Step 5: Commit** `feat(db): 0050 trial choice, product category, store votes`.

### Task 2: Capability header on the server

**Files:**
- Modify: `backend/lib/appVersionGate.js`
- Test: `backend/tests/appCaps.test.js`

**Interfaces:**
- Produces: `readAppCaps(req) -> Set<string>` parsing `X-App-Caps` (comma list, lower-case, unknown values ignored,
  missing header → empty set). Known caps: `trial-choice`, `membership-business`.

- [ ] **Step 1: Failing tests**: missing header → `size 0`; `"Trial-Choice, membership-business"` → both; `"x,,"` → empty.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(api): read X-App-Caps`.

### Task 3: Trial choice on the server

**Files:**
- Create: `backend/lib/trialChoice.js`
- Modify: `backend/repos/usersRepo.js` (`upsertFromOAuth`), `backend/server.js` (every `upsertFromOAuth` caller listed in
  Task 0, `GET /api/me`, new `POST /api/me/trial-choice`, RevenueCat webhook trial branch)
- Test: `backend/tests/trialChoice.test.js`, `backend/tests/trialChoiceDb.test.js`

**Interfaces:**
- Consumes: `readAppCaps` (Task 2), columns from Task 1, `emailEverGrantedTrial` (existing).
- Produces:
  - `upsertFromOAuth(profile, { reactivate, deferTrialCredits = false })`. With `deferTrialCredits` true the signup grant
    is skipped; everything else is unchanged.
  - `trialState(userRow, { emailEverGranted }) -> { eligible: boolean, choice: 'week'|'credits'|null }`;
    `eligible = choice === null && trial_credits_granted_at === null && !emailEverGranted`. A row with
    `trial_credits_granted_at` set and `trial_choice` null reads as `choice: 'credits'`.
  - `GET /api/me` adds `trial: { eligible, choice }`, **only when the request carries `trial-choice`**.
  - `POST /api/me/trial-choice { choice: 'credits' }` → 200 `{ trial, scanCredits }` (grants through the existing
    guarded update, stamps `trial_choice`, `trial_chosen_at`, ledger type `signup`); `{ choice: 'week' }` → 200, records
    nothing (the purchase records it); not eligible → 409 `{ error: 'trial_used' }`; bad body → 400. Requires the cap;
    without it → 404 (an old build never calls it).
  - Webhook: an event with `period_type` TRIAL stamps `trial_choice = 'week'`, `trial_chosen_at = now` where
    `trial_choice IS NULL` and `trial_credits_granted_at IS NULL`.

- [ ] **Step 1: Failing tests (Db):**
  - `sign-in WITH trial-choice cap grants nothing; trial = {eligible:true, choice:null}`
  - `sign-in WITHOUT cap still grants 75` (same as Task 0)
  - `choice credits grants 75 once; second call 409 trial_used`
  - `webhook TRIAL then choice credits → 409; scanCredits 0`
  - `choice credits then webhook TRIAL → trial_choice stays 'credits'`
  - `old-build sign-in after a deferred new-build sign-in grants 75 and trial reads {eligible:false, choice:'credits'}` (Review Focus 2)
  - `tombstoned email (deleted account) → eligible false`
  - `GET /api/me without cap has no 'trial' key` (old shape)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Every caller passes `deferTrialCredits: readAppCaps(req).has('trial-choice')`; the RC-webhook
  caller (11572, no app request) passes nothing.
- [ ] **Step 4: Run the two files plus Task 0's.** Expected PASS, `skipped 0`.
- [ ] **Step 5: Commit** `feat(trial): one trial per account, deferred grant for builds with screen H`.

### Task 4: Business membership

**Files:**
- Modify: `backend/repos/usersRepo.js:894-896`, `backend/server.js` (`GET /api/me`, sign-in hydrate response),
  `backend/lib/shopperPreview.js:223`
- Test: `backend/tests/membershipBusinessDb.test.js`

**Interfaces:**
- Produces: `costcoMembershipType` accepts `'business'` from a request carrying `membership-business`. Responses serve
  `'business'` only to such requests; any other request is served `'gold_star'` for a stored `'business'`. A
  `'gold_star'` write from a request without the cap is ignored while the stored value is `'business'`. Executive-only
  gating (`= 'executive'`) is unchanged, so a Business member is treated as non-Executive everywhere, as today's
  gold_star.

- [ ] **Step 1: Failing tests:** cap write business → stored business; no-cap read of business → `gold_star`; no-cap
  write gold_star over business → stays business; no-cap write `business` → ignored (old builds never send it);
  executive unchanged.
- [ ] **Step 2–4:** FAIL, implement, PASS (+ Task 0 file).
- [ ] **Step 5: Commit** `feat(profile): Costco Business membership, invisible to old builds`.

### Task 5: Deals feed

**Files:**
- Create: `backend/repos/dealsRepo.js`, `backend/lib/dealsCache.js`
- Modify: `backend/server.js` (route)
- Test: `backend/tests/dealsDb.test.js`, `backend/tests/dealsCache.test.js`

**Interfaces:**
- Produces: `GET /api/deals?store=&warehouse=&sort=&quick=&price=&type=&offset=&limit=` (requireAuth) →
  `{ items: [{ productId, name, was, now, saving, pct, validUntil, businessOnly, executiveOnly, boughtBefore }], total,
  hasExecutiveData, warehouse: { id, name } }`.
  - `store` must be live for the requester (`enabled`, or `admin_preview` and the requester is admin), else 404
    `store_not_live`.
  - Costco: current `savings` (`superseded_at IS NULL`, `valid_until >= today` Toronto date) for the requester's province,
    narrowed by `saving_warehouses` to `warehouse` (default: the requester's preferred warehouse); `was` from
    `product_regular_prices` for that place, `now = was − amount`; a row with no regular price is returned with
    `was: null` and sorts after priced rows. `businessOnly` from the product's channel. `executiveOnly` from
    `savings.flags.executiveOnly` when present, else `null`; `hasExecutiveData` = any row has a non-null value.
    `boughtBefore` = product appears in the requester's non-deleted receipt items.
  - `sort`: `saving | pct | low | high | ends` (default `saving`). `quick`: comma list of `week | mine | big | exec |
    pct20 | open`; unknown ignored. `price`: `any | u25 | 25 | 100 | 500`. `type`: `all | warehouse | business`.
  - `limit` default 50, max 100.
  - Cache: per `(province, warehouse, Toronto date)` for the store's raw rows, in memory, 30 min TTL, max 200 keys;
    per-user fields (`boughtBefore`) applied after the cache.
  - Best Buy: no feed exists, so a live Best Buy answers `{ items: [], total: 0 }` and the app hides its Deals pill
    (spec §12 Q6: a store with nothing behind a button shows no button).

- [ ] **Step 1: Failing tests** for each filter and sort against seeded rows; 404 for a disabled store as a shopper;
  200 for the same store as an admin with `admin_preview`; expired and superseded rows excluded;
  `hasExecutiveData:false` when no flags.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(deals): live savings feed with filters and sort`. In the PR: requests/day estimate, cache
  hit ratio from the test, no scheduled job.

### Task 6: Store vote

**Files:**
- Create: `backend/repos/storeVotesRepo.js`
- Modify: `backend/server.js`
- Test: `backend/tests/storeVotesDb.test.js`

**Interfaces:**
- Produces:
  - `GET /api/stores/vote` → `{ options: [{ storeId, code, name }], myVote: { code | null, otherText | null } | null,
    shares: [{ code | 'other', pct }] | null }`. Options = stores with `enabled = false` that the requester cannot use
    (an admin does not get its own preview stores), in table order. `shares` only after the requester voted, integers
    summing to 100.
  - `POST /api/stores/vote { code } | { otherText }` → 200 the same shape; second vote → 409 `already_voted`;
    `otherText` trimmed, 1–60 chars, else 400; unknown or live `code` → 400. A store vote also inserts the requester into
    `store_launch_subscriptions` for that store (idempotent).
  - `/api/stores/:code/notify-me` untouched.

- [ ] **Step 1: Failing tests** for the shape, 409, 400s, shares rounding, the launch subscription row.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(stores): one vote per account, subscribes to the launch push`.

### Task 7: Backend gate

- [ ] **Step 1:** Run every backend file touched in Tasks 0–6 plus importers found by
  `grep -rl "usersRepo\|appVersionGate\|shopperPreview" backend/tests`, one run, dev DB. Expected: 0 fail, `skipped 0`.
- [ ] **Step 2:** Replay Task 0's suite with three header sets: none (≤3.0.6), `X-App-Build: 60` only (3.6.1),
  `X-App-Build: 60` + `X-App-Caps: trial-choice,membership-business` (new). Only the third changes behaviour.
- [ ] **Step 3:** Fill the compat doc section: per changed route, which live builds call it and why they are unaffected.
- [ ] **Step 4: Commit** `docs(compat): Store Spaces v2 backend audit`.

## Phase 2 — Mobile foundations

### Task 8: Store spaces table and live-store hook

**Files:**
- Create: `src/constants/storeSpaces.js`, `src/hooks/useLiveStores.js`
- Test: `__tests__/storeSpaces.test.js`, `__tests__/useLiveStores.test.js`

**Interfaces:**
- Produces:
  - `STORE_SPACES = { costco: { badge: 'CO', bg: '#E31837', fg: '#FFFFFF', tools: ['receipt','tag','translator','barcode'], quick: ['week','mine','big','exec'], deals: true }, bestbuy: { badge: 'BB', bg: '#FFF200', fg: '#0046BE', tools: ['receipt','barcode'], quick: ['week','mine','pct20','open'], deals: false } }`
  - `getStoreSpace(id) -> { badge, bg, fg, tools, quick, deals }`; unknown id → `{ badge: <first two letters of
    shortName upper-case>, bg: store.color, fg: '#FFFFFF', tools: ['receipt'], quick: ['week','mine'], deals: false }`.
    **This fallback is a proposal for Maxim's review in the PR** (§13 Q1).
  - `useLiveStores() -> Array<store>`: `getEnabledStores()` re-read on the remote-stores refresh and the admin-flag
    change; each item carries `adminPreview: isAdminPreviewStore(s)`.
- [ ] **Step 1: Failing tests:** admin flag off → Best Buy absent; on → present with `adminPreview: true`; a refresh that
  disables Costco removes it (Review Focus 3); unknown store gets the fallback.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(stores): store spaces table and live-store hook`.

### Task 9: Client capability header and design kit

**Files:**
- Modify: `src/services/appVersionGate.js` (header builder at ~line 72)
- Create: `src/components/spaces/` — `tokens.js` (the Global Constraints colours + fonts Inter Tight / Plus Jakarta Sans
  / IBM Plex Mono mapped to the app's `FONTS`), `StoreBadge.js`, `SpChip.js`, `SpPill.js`, `SpIconBtn.js`, `SpSheet.js`,
  `SHead.js`, `Card.js`, `SpLockup.js` (reuse `BrandMark` lockup), `index.js`
- Test: `__tests__/appCapsHeader.test.js`, `__tests__/spacesKit.test.js` (snapshot per component)

**Interfaces:**
- Produces: every request carries `X-App-Caps: trial-choice,membership-business`. Components with the design's props:
  `StoreBadge({ storeId, size = 36, r })`, `SpChip({ bg, ink, children })`, `SpPill({ on, dashed, onPress, children })`,
  `SpIconBtn({ badge, onPress, children, accessibilityLabel })`, `SpSheet({ visible, onClose, children })`,
  `SHead({ title, sub, action, onAction })`, `Card({ style, children })`.
- [ ] Steps: failing tests (header present on a wrapped fetch; snapshots), implement, pass, commit
  `feat(ui): capability header and Store Spaces kit`.

### Task 10: Five-tab shell

**Files:**
- Modify: `App.js` (MainTabs ~327–344, PreviewTabs ~372–381), `src/services/notificationRouting.js:116`,
  `src/screens/ScanScreen.js:1609`, `src/screens/HomeScreen.js:631`, `src/screens/PriceTagScanScreen.js:789`,
  `src/services/i18n.js` (`tabs.deals`, `tabs.me`)
- Create: `src/components/spaces/SpTabBar.js`, `src/screens/DealsScreen.js` (placeholder until Task 16)
- Test: `__tests__/mainTabs.test.js`, `__tests__/notificationRouting.test.js` (extend)

**Interfaces:**
- Produces: tab routes `Home`, `Receipts`, `ScanTab`, `Deals`, `Profile` (route name kept, label "Me" / "Moi") so every
  existing `navigate("Profile")` and push route keeps working. `Stores` route removed; `navigate("Main", { screen:
  "Stores" })` callers go to `Home`; `store_launch` push → `Home` with `{ storeCode }` (opens that store's space if live,
  else Home). Tab bar per `SpTabBar` (centre Scan button opens the scan sheet; PAYG credits badge on Me).
- [ ] Steps: failing tests (no `Stores` route; `store_launch` for a live store → Home+storeCode, for a not-live store →
  Home), implement, pass, commit `feat(nav): Home · Receipts · Scan · Deals · Me`.

## Phase 3 — Mobile screens

Each task: render the design's component with real data, snapshot + behaviour tests, EN + FR keys in the same commit,
then **compare against the design render** (open `Store Spaces v2.html` in Chrome next to the device screenshot at
380×820 and fix every visible difference) before committing.

### Task 11: Home

**Files:** Modify `src/screens/HomeScreen.js`, `src/components/HeroPager.js` (drop the chart page content, keep the pager);
Create `src/components/spaces/StoreRows.js`, `src/components/spaces/GuaranteeStrip.js`,
`src/components/spaces/TrialStrip.js`. Test `__tests__/homeSpaces.test.js`.

**Interfaces:** Consumes `useLiveStores`, `getStoreSpace`. Produces `src/hooks/useTrialState.js`:
`useTrialState() -> { supported, eligible, choice, loading }` from `/api/me` (`supported` = the response carried `trial`;
no `trial` → `{ supported: false }`), used again by Task 21. Produces `TrialStrip({ onPress })` shown when
`supported && eligible && choice === null`, label `home.trialStrip` "Start your free trial", opens screen H.

- [ ] Tests: no search button; Admin button only for admins; guarantee strip only on PAYG; trial strip rules above; one
  live store → Home renders the store space (Task 12); two → rows with receipts · drops · amount.
- [ ] Implement, pass, design compare, commit `feat(home): Store Spaces home`.

### Task 12: Store space and All stores sheet

**Files:** Create `src/screens/StoreSpaceScreen.js`, `src/components/spaces/StoreRail.js`,
`src/components/spaces/AllStoresSheet.js`. Test `__tests__/storeSpace.test.js`.

**Interfaces:** `StoreSpaceScreen({ storeId })`; rail from `useLiveStores`; tools from `getStoreSpace(id).tools`, each
opening today's screen (`Scan`, `PriceTagScan`, `PriceTranslator`, `BarcodeScan`) with today's gating; Costco warehouse
card → `CostcoProfile`; Deals link only when `getStoreSpace(id).deals`. All stores sheet search filters by name only.
- [ ] Tests: store turned off while open → Home (Review Focus 3); admin-preview marker; search within the sheet only.
- [ ] Implement, pass, design compare, commit `feat(stores): store spaces`.

### Task 13: To claim

**Files:** Create `src/screens/ToClaimScreen.js`. Test `__tests__/toClaim.test.js`.
**Interfaces:** pills = "All stores" + live stores with counts; soonest first; locked-drop rules of 2026-11-07 unchanged
(`summarizeLockedDrops`, `LockedDropCard`).
- [ ] Tests, implement, design compare, commit `feat(drops): To claim screen`.

### Task 14: Scan sheet and the notifications popup

**Files:** Create `src/components/spaces/ScanSheet.js`, `src/components/PushOffSheet.js`; Modify the receipt-scan entry
(`ScanScreen` open path). Test `__tests__/scanSheet.test.js`, `__tests__/pushOffSheet.test.js`.

**Interfaces:** `PushOffSheet({ visible, onContinue, onCancel })`, shown on **every** receipt scan while
`getPushPermissionState()` is not granted. Copy `push.off.title` "Price-drop alerts are off", `push.off.body` "Without
notifications you won't get price-drop alerts for this receipt. You can still scan it.", button: iOS denied →
`push.off.settings` "Open Settings" (`Linking.openSettings()`); Android not permanently denied →
`push.off.turnOn` "Turn on notifications" (OS prompt); `push.off.cancel` "Not now" continues to the scan.
- [ ] Tests: sheet appears each time when off, never when granted; Cancel continues to the scanner; the iOS button text
  never matches `/allow|autoris/i` in any language (same guard as `permissionsPriming.test.js`).
- [ ] Implement, pass, design compare, commit `feat(scan): scan sheet; price-drop alerts popup`.

### Task 15: Receipts

**Files:** Modify `src/screens/ReceiptsScreen.js`. Test `__tests__/receiptsSpaces.test.js`.
**Interfaces:** By receipt / By product segmented control, store pills from `useLiveStores`, search searches receipts
only. Every row action unchanged.
- [ ] Tests, implement, design compare, commit `feat(receipts): store pills and design`.

### Task 16: Deals and filter sheet

**Files:** Create `src/services/dealsService.js`, `src/screens/DealsScreen.js` (replace placeholder),
`src/components/spaces/DealRow.js`, `src/components/spaces/DealsFilterSheet.js`. Test `__tests__/deals.test.js`.

**Interfaces:** `fetchDeals({ store, warehouse, sort, quick, price, type, offset }) -> { items, total, hasExecutiveData,
warehouse } | { unavailable: true }` (404/network → `unavailable`). Store pills = live stores with
`getStoreSpace(id).deals`. Quick filters from `getStoreSpace(id).quick`, minus `exec` when `!hasExecutiveData`.
Category section hidden; "+" button not rendered (§12 Q8, Q9). Search searches deals only.
- [ ] Tests: old backend 404 → unavailable state, no crash (Review Focus 1); exec chip hidden without data; filters map
  to query params exactly; "Show n deals" count.
- [ ] Implement, pass, design compare, commit `feat(deals): Deals tab`.

### Task 17: Me and store vote

**Files:** Modify `src/screens/StoresAndProfileScreens.js` (`ProfileScreen` → Me layout; `StoresScreen` deleted with its
route), Create `src/screens/StoreVoteScreen.js`, `src/services/storeVoteService.js`, `src/screens/CountryLanguageScreen.js`.
Test `__tests__/me.test.js`, `__tests__/storeVote.test.js`.

**Interfaces:** every existing Profile row keeps its destination. "Country & language" opens screen A's picker in
settings mode. `fetchVote() -> shape of Task 6 | null` (404 → null → the bottom vote button hidden). "Something else"
text max 60.
- [ ] Tests: vote button hidden on 404; one vote; shares shown after voting; Me rows parity with today's Profile (a list
  of row testIDs from `main`).
- [ ] Implement, pass, design compare, commit `feat(me): Me and store vote`.

### Task 18: Paywall hero B

**Files:** Modify `src/components/Paywall.js` (`heroCard`, `eyebrow`, `heroTitle`, `heroBody` styles ~736–746,
`renderHero` ~475–500), `src/services/i18n.js`. Test `__tests__/paywallHero.test.js`.

**Interfaces:** hero bg `#10b981`, glow circle 200×200 `rgba(255,255,255,0.14)` at right −70 / top −90, eyebrow
`#ecfccb`, amount and title `#ffffff`, body `#f0fdf4`. Found body: new key `paywall.v2.foundBodyTotal` EN "in price drops
on items you bought. Unlock them to see each one and claim it at the store." FR "en baisses de prix sur des articles que
vous avez achetés. Débloquez-les pour voir chacun et le réclamer en magasin." `foundBody` / `foundBodyOne` stay in the
bundle unused (no deletion needed; old keys harm nothing).
- [ ] Tests: no digit-count text in the found body; colours as above; nothing else in the paywall snapshot changes.
- [ ] Implement, pass, design compare, commit `feat(paywall): hero card in trial green`.

## Phase 4 — Onboarding

### Task 19: FSA coordinates

**Files:** Create `scripts/build-fsa-coords.mjs`, `src/constants/postalFsaCoords.js`; Modify
`src/services/storageService.js` (`coordsFromPostalCode`). Test `__tests__/postalFsaCoords.test.js`.

**Interfaces:** `coordsFromPostalCode(postal) -> { lat, lng } | null` from GeoNames `CA.zip` (CC BY 4.0, credited in the
file header like `postalFsaCities.js`): mean lat/lng per FSA. Nearest warehouses = `sortWarehousesByNearest(list, coords)`
+ `warehouseDistanceKm` (existing), top 3 in the postal code's province plus any closer across a border.
- [ ] Tests: `K2C` → within 5 km of Ottawa; unknown FSA → null; result for `K2C 3H2` puts Merivale (#542) first.
- [ ] Implement, pass, commit `feat(onboarding): postal-prefix coordinates`.

### Task 20: Screens A–G

**Files:** Modify `src/screens/OnboardingScreen.js` (split into `src/screens/onboarding/RegionStep.js`, `SlideStep.js`,
`SignInStep.js` (restyle, same logic), `AccountStep.js`); `src/screens/CostcoProfileScreen.js` (`MEMBERSHIP_OPTIONS` adds
`{ code: 'business', label: 'profile.membershipBiz', sub: 'profile.membershipBizSub' }`); `i18n.js` (every `OB_T` string,
EN + FR as in the design). Test `__tests__/onboardingSpaces.test.js`.

**Interfaces:**
- `canCreateAccount({ postal, province, language, tos, privacy, pushOk }) -> boolean` = valid postal **and** province
  **and** language **and** tos **and** privacy **and** `pushOk`; `pushOk` = granted on Android, always true on iOS.
- Province read-only from `provinceFromPostalCode`; no picker. Language from step A, saved via `syncProfileToBackend`
  `language` and `setLanguage`.
- Android notifications row on G: "Price-drop alerts · required" with `onboarding.push.turnOn` → OS prompt; permanently
  denied → `onboarding.push.settings` "Open Settings". iOS: the OS prompt fires once when G opens (compliant: OS prompt
  first, custom text only after a denial).
- Slide E lists `useLiveStores()` with each store's tools line; Costco card on G only while Costco is live.
- "Send me deal tips" → `marketing_push` consent.
- Returning-user routes (`decideSignInRoute`) unchanged.
- [ ] Tests: `canCreateAccount` truth table incl. empty postal, lowercase/no-space postal normalised, cleared postal,
  unmappable first letter (Review Focus 4); Android without permission → disabled; iOS denial → enabled; language
  switch re-renders the flow in French; business saved.
- [ ] Implement, pass, design compare (all of A–G, EN and FR), commit `feat(onboarding): country, slides, account`.

### Task 21: Screen H, sticky trial, purchase

**Files:** Create `src/screens/onboarding/TrialStep.js`, `src/services/trialService.js`;
Modify `src/services/bootService.js` (launch route), `src/services/purchaseService.js` (intro eligibility),
`App.js` (route `TrialChoice`). Test `__tests__/trialChoice.test.js`.

**Interfaces:**
- Consumes `useTrialState()` (Task 11).
- `chooseCredits() -> { ok, scanCredits } | { ok:false, error }` (POST credits); `startFreeWeek()` buys the monthly
  Unlimited package through RevenueCat with its intro offer; success → refresh `/api/me` (the webhook stamps `week`).
- `checkWeekEligibility() -> boolean` = server `eligible` **and** RevenueCat intro eligibility for the monthly product.
- Launch route: `supported && eligible && choice === null` → `TrialChoice` at **every** launch; X closes to Main (strip
  stays on Home, Task 11); not eligible after account creation → paywall (§12 Q3); `!supported` → today's behaviour.
- Prices from `useStorePrices`, never literals; the note reads "Free for 7 days, then {price}/month. Cancel anytime
  before it ends." with the price most prominent.
- [ ] Tests: dismissed/pending/error purchase → no choice, H still the launch screen (Review Focus 5); old backend → no
  H (Review Focus 1); old-build credits on the same account → H gone (Review Focus 2); credits path grants once.
- [ ] Implement, pass, design compare, commit `feat(trial): choose your trial`.

## Phase 5 — Consoles, verification, release readiness

### Task 22: Free-week offer in both stores (with Maxim, through Chrome)

**Files:** Create (docs) `Operations/Unlimited_Free_Trial_Console_Setup.md`; update `Roadmap/Unlimited_Free_Trial.md` status.

- [ ] Play Console: `priceback_unlimited_monthly` → base plan → Add offer: free trial 7 days, eligibility "New customer
  acquisition", regions = base plan's. Show Maxim the filled form; save only on his OK; reload and read back (staged
  edits).
- [ ] App Store Connect: `priceback_unlimited_monthly` → Introductory Offers: Free, 1 week, Canada + Egypt. Same show /
  save / read back.
- [ ] Annual left without a trial. RevenueCat offering shows the intro on the monthly package.
- [ ] Screenshots + values into the runbook; commit the docs.

### Task 23: Full verification and the deploy order

- [ ] `npm test` (mobile) → 0 new failures vs `main` (the known `paywallAnnualBadge` red is pre-existing; list any other).
- [ ] `npm run i18n:check` → green. `__tests__/costcoPathImmutability.test.js` → green.
- [ ] Backend blast radius (Task 7 list) → 0 fail, `skipped 0`.
- [ ] Design compare pass on a device build for every screen in `PHONES` and `OB` of `Store Spaces v2.html`.
- [ ] Write the release order into the PR (nothing here is executed without Maxim):
  1. migration 0053 on prod;
  2. backend deploy; smoke prod with the three header sets of Task 7 (old builds unchanged);
  3. consoles configured (Task 22) — **no build before this**;
  4. app build from a tag, only when Maxim asks; store listing copy mentions the free week;
  5. after the new build is 100% live, leave `MIN_SUPPORTED_BUILD_*` alone (nothing here forces an update).
- [ ] Task log entry updated with branch, commits and status; design doc status → implemented.
