# Bugs — Common Root Causes & Fixes

A **goto reference** for recurring/production bugs in PriceBack. When a class of
bug recurs (or is likely to), record it here so the next person — or the next
session — can diagnose it in minutes instead of re-deriving it.

## How to use this document

1. **Hitting a bug?** Skim the entries below by symptom. Each entry has the
   observable symptom, the real root cause, the fix, the files involved, and how
   to *detect* it next time (health endpoint / audit log / alert).
2. **Just fixed a recurring or production-class bug?** Add an entry using the
   template below. This is a standing convention — see the memory note
   `bugs-common-fixes-doc` (`MEMORY.md`). Keep entries concrete: name the files,
   functions, env vars, and the exact signal that surfaces the problem.

### Entry template

```
## <N>. <Short symptom-first title>

- Date: YYYY-MM-DD · PR: #NN · Area: <mobile | backend | both>
- Symptom: what the user/operator actually sees.
- Root cause: the real mechanism, not the surface error.
- Fix: what changed and why it's correct.
- Files: the touched files + key functions.
- Detect next time: health field / audit query / alert that catches it.
- Prevent: guardrail (test, alert, config) added so it can't silently recur.
```

---

## 1. Expired Google ID token → 401 → receipt silently missing from DB

- **Date:** 2026-06-04 · **PR:** _(this change)_ · **Area:** both
- **Symptom:** A user scans a receipt, the app saves it locally and shows it,
  but it **never appears in the backend DB** (no `receipts` row, no price
  points). No error is shown to the user. Often starts ~1 hour after sign-in.

- **Root cause:** Google **ID tokens have a ~1-hour TTL**. The native sign-in
  (`signInWithGoogle`) intentionally requests **no `offlineAccess`**, so **no
  OAuth refresh token is ever stored**. The old `getValidIdToken()` could only
  refresh via `AuthSession.refreshAsync()`, which *requires* that nonexistent
  refresh token — so after ~1h it returned the **stale, expired token**. The
  backend `requireAuth` → `verifyIdToken` then rejected it with **401**, and the
  mobile sync classified the 401 (a 4xx) as **terminal/non-retryable**, marking
  the receipt `syncRetryable: false` and **never retrying it**. Net effect: scan
  succeeds locally, server write is dropped forever.

  > ⚠️ Misleading clue: the symptom looks like "receipt was never sent". It was
  > sent — and rejected with 401. Always **check the API audit log for
  > `statusCode:401`** (the `{"t":"api",...}` JSON lines in the Railway log
  > stream) before assuming a request never left the device.

- **Fix:**
  - **Real refresh (mobile):** `refreshIdTokenSilently()` mints a **fresh ID
    token with no UI** via `GoogleSignin.signInSilently()` / `getTokens()` from
    the cached Google session — the correct primitive when there's no OAuth
    refresh token. `getValidIdToken()` now tries: fresh-check → silent re-issue →
    OAuth grant (future Gmail flow) → stale fallback.
  - **Reactive recovery (mobile):** `authedFetch()` retries **once** on a `401`
    after forcing a silent re-issue, so a token expiring mid-flight never
    surfaces as a failure.
  - **Don't drop the receipt (mobile):** `isRetryableStatus()` now treats
    **401 as retryable**, so `retryPendingReceiptSyncs` lands it on the next
    foreground if inline recovery missed.

- **Files:**
  - `src/services/authService.js` — `refreshIdTokenSilently`, `getValidIdToken`,
    `authedFetch`, `isIdTokenFresh`/`jwtExpSeconds`.
  - `src/services/receiptSyncService.js` — `isRetryableStatus` (+401).
  - `src/services/storageService.js` — `retryPendingReceiptSyncs`,
    `recordSyncOutcome` (the queue that now retries 401s).
  - `backend/server.js` — `requireAuth` (the 401 source).

- **Detect next time:**
  - **Health:** `GET /health?token=<FLYER_ADMIN_TOKEN>` → `auth.failures`
    (`recentFailures`, `windowMin`, `alertThreshold`, `totalSinceBoot`). A
    `recentFailures` climbing toward the threshold is the early signal.
  - **Audit log:** search the API audit log (`{"t":"api",...}` JSON lines in the
    Railway log stream) for `statusCode:401` grouped by `route` over the last
    hour. This survives redeploys; the in-memory monitor does not. (As of
    2026-07-23 this is a stdout log, not the old `api_audit_log` DB table.)
  - **Alert:** the auth-failure monitor emails you when 401s spike (see below).

- **Prevent:** unit tests for silent refresh + the 401 reactive retry
  (`__tests__/authService.test.js`); backend monitor + alert + health test
  (`backend/tests/authFailureMonitor.test.js`).

---

## 2. Geometry row-rebuild scrambles paper-photo receipts → dropped discount / SKU / phantom item

- **Date:** 2026-06-04 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** A scanned **paper warehouse receipt** parses with wrong money:
  a TPD discount is silently dropped (item shows the pre-discount price), a
  product loses its SKU and/or shows quantity 1 instead of N, a **store-header
  line (address / "5R Member") appears as a phantom item**, or a line is priced
  at its *discount* amount. The receipt still "reconciles" because the parser
  falls back to its own (wrong) item sum, masking the error.

- **Root cause:** The Costco parser rebuilds rows from Vision **word geometry**
  (`reconstructRowsFromAnnotation`) — the right call for the rigid digital app
  screenshots that flat text scrambles. But on some **paper photos** the spatial
  clustering misfires: short **`N @ unit` multi-buy lines** (e.g. `4 @ 15.99`)
  are narrow and merge into a neighbouring row, scrambling that item's SKU/qty
  and the adjacent item's TPD line; and a **price printed slightly high folds
  onto the header line above the item** it belongs to (Costco staggers prices
  ~1 line up), inventing a phantom item and leaving the real item priced at its
  leftover discount. Geometry was applied unconditionally, so for these layouts
  the *worse* parse was always used — even though the **ordered flat text parses
  them cleanly** (correct multi-buy qty, TPD, and `VOID` cancellation).

- **Fix:** `parseCostcoWarehouseReceipt` now parses **both ways** (geometry rows
  *and* the flat-text column-split reshape) and keeps the better via
  `chooseBetterParse`: (1) prefer the parse whose `items + tax` lands closest to
  the **printed total** — the strongest correctness signal; (2) else higher SKU
  coverage; (3) else more items; ties default to geometry. The printed total is
  read from the **geometry rows** (`extractPrintedTotal`), not the flat text,
  because scrambled flat order can reorder the SUBTOTAL/TAX/TOTAL amounts (this
  is exactly why geometry exists). No change to the shared engine — flat text
  already handled multi-buy / TPD-stagger / VOID correctly.

- **Files:** `src/services/costcoReceiptParser.js` — `parseCostcoWarehouseReceipt`,
  `chooseBetterParse`, `extractPrintedTotal`, `skuCoverage`.

- **Detect next time:** Run the mock-OCR harness — `npm run capture:receipts`
  then `npm run parse:receipts` — and eyeball the per-receipt table. A parse
  whose `subtotal`/`total` doesn't match the receipt's printed total, a `—` SKU,
  a phantom address/member line, or a discount that vanished are the tells. The
  `reconciled=true` flag is **not** sufficient on its own (it trusts the item
  sum when no printed total is read).

- **Prevent:** committed real-OCR fixtures + pinned ground truth in
  `__tests__/costcoReceiptParser.realocr.test.js` (the matcher now also checks
  `quantity` and `absentSkus`), covering the FETA multi-buy (`173020729`), the
  PEPSI header-fold + VOID (`173028492`), and the geometry-still-wins screenshots.

---

## 3. Missing `FlatList` import → price-tag screen crashes ("property FlatList doesn't exist")

- **Date:** 2026-06-05 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Opening **Scan → price tag** immediately shows the top-level
  ErrorBoundary ("Something went wrong") with message *"Property 'FlatList'
  doesn't exist"*; the screen/warehouse picker never renders. 100% reproducible.

- **Root cause:** `PriceTagScanScreen.js`'s `WarehousePickerModal` renders a
  `<FlatList>`, but `FlatList` was **never added to the named `react-native`
  import** at the top of the file. The reference resolves to `undefined` and
  React throws at render. It slipped through because the only screen test that
  pulls in react-native (`__tests__/screens.test.js`) **mocks the whole module**
  (`FlatList: "FlatList"`), so a genuinely missing named export can't surface
  there.

- **Fix:** add `FlatList` to the `from "react-native"` import in
  `src/screens/PriceTagScanScreen.js`. One-line import fix — the component code
  was already correct.

- **Files:** `src/screens/PriceTagScanScreen.js` (the react-native import line).

- **Detect next time:** a render-time `Property '<X>' doesn't exist` is almost
  always a missing/typo'd named import from `react-native`. It surfaces in the
  `App.js` `ErrorBoundary`, not in any network/audit log.

- **Prevent:** `__tests__/priceTagScreen.smoke.test.js` mounts the screen with
  the **real** react-native (jest-expo) and opens the picker, so a missing
  `FlatList` (or any picker-path import) now fails the suite. General rule:
  smoke tests guarding against missing RN imports must **not** mock `react-native`.

---

## 4. Quebec Costco receipts drop every "B"-flagged item (missing tax-code in flag class)

- **Date:** 2026-06-05 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Costco receipts from **Quebec warehouses** (e.g. Boisbriand #546)
  parse with **most line items missing** — only the `N`-flagged items survive,
  every `B`-flagged item silently vanishes — so the receipt never reconciles and
  half the purchase isn't tracked. Ontario receipts (flags `N`/`Y`/`H`) were fine.

- **Root cause:** Costco's per-line **tax-code flag** set is province-specific:
  ON uses `N`/`Y`/`H`, **QC uses `B`** (48 of the sampled flags). The parser's
  flag character class was `[HPFRYNG*]` — **no `B`** — so `tryExtractItem`'s
  price patterns (`… price [HPFRYNG*]?$`) failed to match `"919922 BLUEBRY ACAI
  11.99 B"`, and the item was dropped entirely. The bug was invisible until real
  Quebec PDF fixtures were captured (all prior fixtures were Ontario).

- **Fix:** add `B` to the **price-line** flag classes everywhere
  (`tryExtractItem` P1–P7, `NEG_PRICE_LINE_RE`, the after/standalone-SKU
  patterns, `reshapeColumnSplitTpdBlocks`' POS/NEG/FLAG). **Deliberately NOT** in
  `cleanItemName`'s trailing-flag strip — many names legitimately end in `" B"`
  (`VITAMIN B`, `PLAN B`, the test's `ITEM B`); the price pattern already
  separates the real flag, so stripping `B` off names there only corrupts them.

- **Files:** `src/services/receiptParsingShared.js` (flag classes + `cleanItemName`),
  `src/services/costcoReceiptParser.js` (reshape + `countPurchaseLines`).

- **Detect next time:** receipt **doesn't reconcile** and the dropped items
  share one tax flag → suspect a missing flag letter. `npm run parse:receipts`
  prints each parse; a province whose items all vanish is the tell.

- **Prevent:** `__tests__/costcoReceiptParser.realocr.test.js` now pins Quebec
  PDF fixtures (G-11/G-12/G-13) that exercise the `B` flag, and the existing
  `ITEM B` unit tests guard against re-adding `B` to the name strip. Same-fix
  siblings shipped alongside: `CPN/` coupons (not just `TPD/`), a wrapped-name
  fold (`BUF CHKN`/`STR`, `CHEETOS`/`CORN`), and an "items-sold ≤ printed count"
  cap that undoes a duplicated-discount line's phantom qty bump.

---

## 5. Scan screen shows trial credits (75) for ~2 s before the real balance

- **Date:** 2026-06-10 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Opening **Scan → receipt** shows "**75** scan credits left" (the
  free-trial pool) for ~2 seconds, then jumps to the user's real balance
  (trial + purchased top-up packs − scans used). Looks like purchases vanished.

- **Root cause:** Two compounding issues in `ScanScreen`:
  1. The `scanStatus` state was **initialized to the hardcoded trial pool**
     (`{ remaining: FREE_TRIAL_CREDITS }`), so 75 rendered on first paint.
  2. The mount effect awaited `syncDeviceWithBackend()` (a network POST to
     `/api/device/sync`, 5 s timeout) **before** calling `canAddReceipt()` —
     but `canAddReceipt()` is **purely local AsyncStorage** and already returns
     the correct balance (incl. the local top-up mirror) in milliseconds. The
     wrong placeholder stayed up for the whole network round-trip.

- **Fix:** local-first load order — `canAddReceipt()` runs immediately on mount
  and sets the real balance, then `syncDeviceWithBackend()` (anti-reinstall
  scan-count merge) runs and the snapshot is refreshed. The initial state is now
  a loading sentinel (`remaining: null`) and `ScanCreditsBalance` renders an
  em-dash placeholder for it, so **no wrong number is ever shown** (neither 75
  nor a flash of 0).

- **Files:** `src/screens/ScanScreen.js` (initial `scanStatus`, mount effect,
  credits-prop mapping), `src/components/ScanTemplate.js`
  (`ScanCreditsBalance` `loading` prop).

- **Detect next time:** a balance that "corrects itself" shortly after a screen
  loads = a hardcoded/stale `useState` initial value being replaced by an async
  fetch. Grep the screen for constants in `useState(...)` defaults.

- **Prevent:** general rule — never seed display state with a constant that can
  be wrong; use a `null` loading sentinel and render a placeholder. Local cache
  reads come **before** network reconciliation, never gated behind it.

---

## 6. Price-tag scan fills Product/Brand with photo chrome ("PRICE AT REGISTER", Instagram captions)

- **Date:** 2026-06-10 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Scanning a price tag (especially a *screenshot of an Instagram
  post* of a tag, e.g. costco_west_fan_blog) returns correct prices but a junk
  **Product** — the literal label `PRICE AT REGISTER`, or the post caption
  (`costcowestfanblog VISIT COCOWEST.CA to se... more`) — and a junk **Brand**
  (`TAK` = the phone's OCR'd status bar). See
  `__tests__/Tests_Screenshots/Screenshot_20260609-102545/-103026.png`.

- **Root cause:** `parseCostcoTag` picked the product by a whole-text
  "longest/wordiest alpha line" score. On a cluttered photo the wordiest lines
  are *not* tag text: captions, packaging (`6x2.4 kg NET WT/POIDS NET`), and —
  when the real description line is small/garbled — even the `PRICE AT
  REGISTER` label itself (its words weren't in the noise list). Brand fell back
  to "first short ALL-CAPS line", which on a screenshot is status-bar junk.

- **Fix:** SKU-anchored extraction. A Costco tag always prints
  **ITEM# → BRAND → DESCRIPTION** top-down, so brand/product are now taken from
  the first plausible lines *after* the SKU line (stop at the price block).
  Plausibility excludes: label lines (`AT REGISTER`, `SELL PRICE`/`PRIX DE
  VENTE`, `PRICE PER`/`PRIX PAR`, `INSTANT SAVINGS`, `EXP…`), watermark/social
  chrome (URLs/domains, `liked by`, `visit`, snake_case handles), and
  lowercase-dominant lines (tag text is ALL CAPS; lowercase = packaging or
  captions). The old whole-text score remains only as a fallback when nothing
  usable follows the SKU. The ALL-CAPS brand fallback now needs ≥4 letters
  (3-letter caps fragments like `TAK`/`BAC`/`QUA` are OCR shrapnel).

- **Files:** `src/services/costcoTagScanner.js` (`parseCostcoTag` —
  `plausibleTagLine`, SKU-anchored walk, `LABEL_LINE_RES`, `WATERMARK_RE`,
  `isMostlyLowercase`, `detectBrand`); real-OCR fixtures
  `__tests__/fixtures/costcoTagOcr.js` (`cavendishFries`, `chipwich`); raw
  capture appended to `__tests__/fixtures/price-tags/_ocr_raw.json`.

- **Detect next time:** Product/Brand that read like UI labels or social text
  on the confirm screen = the scorer drifted off the tag. Capture the source
  photo's OCR (Vision `DOCUMENT_TEXT_DETECTION`, key in `backend/.env`; note
  corporate TLS needs `node --use-system-ca`) into `_ocr_raw.json` and replay
  through `parseCostcoTag`.

- **Prevent:** regression tests assert exact brand/product for both Instagram
  fixtures in `__tests__/costcoTagScanner.test.js`; any new mis-scan should be
  added the same way (photo → `_ocr_raw.json` → fixture → exact-field test).

---

## 7. Warehouse-keyed crowd observations silently rejected ("unresolved province 'undefined'")

- **Date:** 2026-06-11 · **PR:** _(this change)_ · **Area:** backend / DB write paths
- **Symptom:** `crowdRepo.recordObservation` returns `false` for every
  warehouse-keyed observation; the log shows
  `[crowd] observation write failed (rejected): pricesRepo.recordPricePoint: unresolved province 'undefined'`.
  Surfaced as `npm run db:seed-test` accepting **0/6** crowd observations
  (median `undefined`), but the same failure mode applies to ANY caller.

- **Root cause:** since the v2 schema, `price_points.province_id` is **NOT
  NULL**. A warehouse-keyed observation has no `scope.province`, so
  `recordObservation` falls back to the caller's `province` argument — a call
  site that omits it produces a NULL province and the write is rejected. The
  seed script's warehouse-811 loop predated the constraint and never passed
  one. The HTTP ingest routes (tag scan, `/api/watch`, receipts, flyer import)
  all forward a province, which is why production never hit it.

- **Fix:** pass the contributor's province at the call site
  (`province: "QC"` for the seed's warehouse-811 observations).

- **Files:** `backend/scripts/seed-test-data.js`.

- **Detect next time:** that exact error string in the logs — the observation
  is *rejected*, not thrown, so nothing crashes; the data is just missing.

- **Prevent:** every NEW `price_points` write path (script, job, route) must
  supply a province — warehouse-keyed rows do NOT infer it from the warehouse.
  When adding an ingest path, grep existing `recordObservation(` /
  `recordPricePoint(` call sites and mirror their province handling.

---

## 8. Deleted receipt line-item reappears after sync

- **Date:** 2026-06-11 · **PR:** _(this change)_ · **Area:** both
- **Symptom:** User removes one product from a multi-item receipt; it disappears,
  then **reappears** after reopening the receipt or the next app sync.
- **Root cause:** `deleteItemFromReceipt` only called the backend when deleting
  the **last** item (which deletes the whole receipt). A non-last deletion was
  **local-only**. On the next `hydrateFromBackend`, `mergeServerIntoLocal`
  rebuilds the local item list from the **server** copy (server is authoritative
  for items) — so the still-present server item is re-added locally.
- **Fix:** new `DELETE /api/receipts/:id/items/:index` →
  `receiptsRepo.softDeleteItemForUser` soft-deletes the single line (deleted_at;
  price_points kept). Client fires it from the non-last branch of
  `deleteItemFromReceipt` with a `lineTotal`/`quantity` fingerprint, queued in a
  persisted item-tombstone (`receipt_item_deletes_pending`) drained on
  foreground/boot — mirroring the whole-receipt delete tombstone.
- **Files:** `backend/server.js`, `backend/repos/receiptsRepo.js`,
  `src/services/storageService.js`, `src/services/receiptSyncService.js`, `App.js`.
- **Detect next time:** item count in `GET /api/receipts/:id` vs the device after
  a delete + re-hydrate; the new test in `tests/receiptSoftDeleteDb.test.js`.
- **Prevent:** any client mutation that the bootstrap merge treats as
  server-authoritative (items, header fields) MUST propagate to the backend, or
  the next hydrate silently reverts it.

## 9. Price-tag submit shows a raw "(AbortError)" and forces a manual retry

- **Date:** 2026-06-11 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Submitting several price tags intermittently fails with
  "Some tags couldn't be saved … (AbortError: The operation was aborted)".
- **Root cause:** `submitPriceTagObservation` used a **6 s** AbortController
  timeout, submitted one tag at a time, with **no retry** — a single slow request
  aborted and surfaced the raw error in the partial-failure alert.
- **Fix:** raise the per-attempt timeout to 15 s and add a bounded retry
  (3 attempts, short backoff) for transient abort/network errors; map those to a
  friendly "network was slow — tap Submit to retry" copy instead of the raw code.
- **Files:** `src/services/priceService.js`, `src/screens/PriceTagScanScreen.js`,
  `src/services/i18n.js` (`priceTag.submitNetworkBody`).
- **Detect next time:** a spike of `tag` submits with `error: "timeout"`.
- **Prevent:** every user-blocking network call on a flaky-mobile path should
  pair a generous timeout with a small retry, and never surface a raw
  `AbortError` string to the user.

---

## 10. Expiry-warning push fires when nothing is actually expiring

- **Date:** 2026-06-12 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** User gets a "⏰ Price Adjustment Window Closing Soon" / "🚨 Last
  Day" push, opens the app, and **nothing is within the 3-day window** (the
  nearest expiry is 22+ days out).
- **Root cause:** Expiry warnings are **local** scheduled notifications armed at
  scan time (`scheduleExpiryWarning` / `scheduleOneDayWarning`). `deleteReceipt`
  removed the receipt but **never cancelled its scheduled notifications**, so the
  OS scheduler fired them days/weeks later for a receipt that no longer exists.
  Same class for receipts whose items were all claimed.
- **Fix:** (1) `deleteReceipt` now calls `cancelReceiptNotifications(id)` (dynamic
  import to avoid the storage↔notification cycle). (2) `reconcileScheduledNotifications`
  sweeps **orphans** — lists `getAllScheduledNotificationsAsync()` and cancels any
  `expiry-*` whose receiptId isn't in the current receipts set (cleans installs that
  predate the fix). (3) both schedulers skip fully-claimed / nothing-watched receipts
  (fail-open for legacy receipts with no per-item data).
- **Files:** `src/services/storageService.js` (`deleteReceipt`),
  `src/services/notificationService.js` (`reconcileScheduledNotifications`,
  `scheduleExpiryWarning`, `scheduleOneDayWarning`, `receiptHasActiveWatch`),
  `__tests__/notificationService.test.js`.
- **Detect next time:** a push with `data.type` of `expiry_warning`/`expiry_final`
  for a `receiptId` that no longer exists locally.
- **Prevent:** any local notification keyed to a deletable entity must be cancelled
  on delete AND swept on reconcile — never rely on the scheduler self-cleaning.

---

## 11. Shared-DB test pollution: a crashed test leaves `stores.visible=false`, reddening unrelated runs

- **Date:** 2026-06-12 · **PR:** _(this change)_ · **Area:** backend
- **Symptom:** Backend CI goes red on `storePoliciesDb.test.js` — "GET
  /api/v1/policies.json serves store content from the DB" and "/health reports the
  DB as the policy source" fail their `stores.length >= 20` assertions (got 19) —
  on a PR that **never touched** stores/policies/seed code. `store_policies` count
  (`>= 20`) still passes, so only the *payload* count is short.
- **Root cause:** All DB tests run against **one persistent shared Neon preview
  branch** (`br-steep-breeze-aqeg0i38`). The visibility test flips a `stores` row
  to `visible=false`, then restores it in a `finally`. A process crash/timeout
  **between** the flip and the restore leaks `visible=false` into the shared DB
  forever. The policies payload hides any `store_policies` row whose `stores` row
  is `visible=false`, so the served count drops to 19 on **every later run**.
  Adding an unrelated new DB test file (referral) shifted parallel-file timing and
  surfaced the latent leak (`walmart` was the stuck row).
- **Fix:** `storePoliciesDb.test.js` `before` hook now resets the baseline —
  `UPDATE stores SET visible=true WHERE visible=false` — after `ensureSeeded()`, so
  a prior interrupted run **self-heals** on the next run instead of poisoning it.
- **Files:** `backend/tests/storePoliciesDb.test.js` (`before` hook).
- **Detect next time:** `SELECT count(*) FROM priceback.stores WHERE visible=false`
  on the preview branch is non-zero outside a running test.
- **Prevent:** any test that mutates shared global rows must **normalize the
  baseline on setup**, not only restore in `finally` — `finally` doesn't run on a
  hard crash, and shared-DB state outlives the process.

---

## 12. Cold start frozen on the static logo for seconds, then the animated splash flashes for <1 s

- **Date:** 2026-06-12 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Tapping the app icon shows the **static native splash** (logo
  only) frozen for several seconds, then the real animated splash (rise-in,
  slogan, loader dots) appears for **well under a second** before navigating
  away. Reference apps (e.g. RBC) are animated from the first frame.
- **Root cause:** `App.js` held the native splash up (`preventAutoHideAsync`)
  and rendered `null` until **every** boot task finished — migrations, Sentry,
  the `hydrateFromBackend` **network pull**, catalog syncs — so the whole boot
  played out behind the static image. The JS `SplashScreen` only mounted after
  `hideAsync()`, and its `splashDuration` for a returning user was just 800 ms.
- **Fix:** Boot pipeline extracted to `src/services/bootService.js`
  (memoized `startBootTasks()`, shared by `App.js` and the splash). `App.js`
  now renders as soon as fonts load; `SplashScreen` hides the native splash in
  its first `onLayout` (both surfaces are `#eef5f1`, so the handoff is
  invisible) and awaits the same boot promise **behind the animation**, with a
  minimum on-screen time (1.8 s returning / 2.6 s new) measured **from mount**
  and the existing 6 s failsafe capping dead-network boots.
- **Files:** `App.js`, `src/services/bootService.js`,
  `src/screens/SplashScreen.js` (`onRootLayout`, nav/boot effect).
- **Detect next time:** a cold start that shows a frozen logo for >~1 s before
  any animation means something slow is again awaited **before first render**.
- **Prevent:** `App.js` must not await anything slower than font loading
  before rendering; long boot work belongs in `startBootTasks()` so it runs
  behind the animated splash.

---

## 13. "Reset All Data" leaves credits + account rows intact server-side

- Date: 2026-06-12 · PR: (this batch) · Area: both
- Symptom: after the user taps "Reset All Data", the app still shows the old
  credit balance (e.g. 75) on the next sign-in/bootstrap, and the DB rows are all
  still `active` — the reset only wiped local AsyncStorage.
- Root cause: the reset handler called `clearAllData()` (local only) and never
  touched the backend. `users.scan_credits` stayed put, so the next
  `/api/me/bootstrap` re-hydrated the cache with the server's stale balance. The
  reset also didn't sign the user out, so they stayed in a half-wiped session.
- Fix: new `POST /api/me/reset` (`usersRepo.resetData` zeroes `scan_credits` +
  writes the compensating `credit_ledger` row; `devices.reset_at` stamped). The
  one-time free-trial 75 is never re-granted because `trial_credits_granted_at`
  stays set (the grant guards on `isNull`). Mobile `runReset` now calls the
  endpoint, then `clearAllData()` + `signOut()`. Belt-and-suspenders: the bootstrap
  cache reconciliation takes the **minimum** of the local-cached vs server balance
  (self-healing on a genuine top-up via a tracked `serverCreditBalance` snapshot).
- Files: `backend/server.js` (`POST /api/me/reset`), `backend/repos/usersRepo.js`
  (`resetData`), `backend/repos/devicesRepo.js` (`markReset`),
  `src/services/authService.js` (`resetMyData`), `src/screens/StoresAndProfileScreens.js`
  (`runReset`), `src/services/syncService.js` (min reconciliation).
- Detect next time: `devices.reset_at IS NOT NULL` with a non-zero `users.scan_credits`
  for the same owner; `credit_ledger` should carry a matching `admin_adjust` zeroing row.
- Prevent: any "wipe my data" action must hit the server for server-owned state
  (credits/account rows), not just local storage — and sign the user out.

---

## 14. Account deletion / consent: hard-delete re-grants free credits; consents not logged on re-signup

- Date: 2026-06-12 · PR: (this batch) · Area: both
- Symptom: (a) a deleted user who signs up again gets a fresh 75 free credits;
  (b) re-signing-up (sign out → back in on an onboarded device) records no new
  `consent_events` row.
- Root cause: (a) `DELETE /api/me/account` hard-deleted the `users` row, so the
  `trial_credits_granted_at` guard was gone and the next signup re-granted. (b)
  consents are only captured in onboarding's SetupStep, which a returning
  already-complete user skips entirely (`onSignInDone` → Main).
- Fix: (a) account deletion is now a **soft delete** (`usersRepo.requestDeletion`:
  `status=false`, `deletion_requested_at`, balance zeroed, push token cleared,
  receipts/items soft-deleted) — the row persists so the trial guard holds and
  re-signin reactivates (`upsertFromOAuth` flips `status` back, clears the stamp).
  (b) `onSignInDone` now re-sends the required consents on the returning-user path.
- Files: `backend/repos/usersRepo.js` (`requestDeletion`, `upsertFromOAuth`),
  `backend/server.js` (`DELETE /api/me/account`), `src/screens/OnboardingScreen.js`
  (`onSignInDone`), schema `users.status` / `users.deletion_requested_at`.
- Detect next time: a `users` row with `status=false` but `deletion_requested_at IS NULL`
  (inconsistent), or a re-signup with no `consent_events` in the last minute.
- Prevent: never hard-delete an account that carries a one-time-grant guard; soft
  delete + reactivate. Capture consent on every sign-in completion, not just first setup.

---

## 15. Keyboard hides the field being edited; free-text date entry is error-prone

- **Date:** 2026-06-13 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** (a) When editing a field low on a long form (receipt review, price-tag
  review, receipt-detail editor), the soft keyboard covers the input — the user can't
  see what they're typing. (b) Purchase/expiry dates were free-text `YYYY-MM-DD`
  `TextInput`s, so typos (`2026-13-40`, wrong format, future dates) were common and only
  caught after the fact by validation copy.
- **Root cause:** (a) The scroll containers wrapped content in a plain `ScrollView` /
  `KeyboardAvoidingView`; neither reliably scrolls the *focused* input above the keyboard
  on Android. (b) Dates relied on manual keyboard entry with no constrained input.
- **Fix:** (1) New dependency-free `src/components/KeyboardAwareScrollView.js` — measures the
  currently-focused `TextInput` on `keyboard{Will,Did}Show` and scrolls it just above the
  keyboard, plus adds a keyboard-height bottom inset so the last field can always lift into
  view. Used in `ScanScreen` and `PriceTagScanScreen`. (2) New dependency-free
  `src/components/DateField.js` — a tappable field that opens a pure-JS calendar modal and
  returns `YYYY-MM-DD`, with optional `minDate`/`maxDate` bounds (no native module → no
  rebuild). Replaces every free-text date input (scan purchase date, tag expiry, detail
  purchase date).
- **Files:** `src/components/KeyboardAwareScrollView.js`, `src/components/DateField.js`,
  `src/screens/ScanScreen.js`, `src/screens/PriceTagScanScreen.js`, `src/screens/DetailScreen.js`,
  `src/services/i18n.js` (`datePicker.*`).
- **Detect next time:** any user report of "I can't see what I'm typing" on a form, or
  date-validation rejections spiking.
- **Prevent:** edit forms should scroll the focused input into view (use
  `KeyboardAwareScrollView`); never collect a date as free text — use `DateField` so the
  value is structurally valid and bounded by design.

---

## 16. CI Jest suite flakes red on slow runners (false-positive 5 s timeouts)

- **Date:** 2026-06-13 · **PR:** _(this change)_ · **Area:** ci
- **Symptom:** The Mobile (Jest) check fails intermittently with
  "Exceeded timeout of 5000 ms for a test" on full-screen render smoke tests
  (Paywall, ManageSubscription) that pass in isolation.
- **Root cause:** Those tests render a whole screen and take ~2-3 s each in isolation;
  under CI's 2-core parallel load they intermittently exceed Jest's **5 s default**
  per-test timeout and fail as false positives — not a real product regression.
- **Fix:** set a forgiving global `testTimeout: 20000` in `jest.config.js`.
- **Files:** `jest.config.js`.
- **Detect next time:** a Jest failure that is *only* a timeout and reproduces green when
  the failing file is run on its own.
- **Prevent:** heavy render/integration tests need headroom over the 5 s default; pin a
  global `testTimeout` rather than chasing per-test bumps.

---

## 17. Backend E2E flakes red: a sibling sweep steals the drop via the shared dedupe ledger

- **Date:** 2026-06-13 (re-diagnosed 2026-06-14) · **PR:** _(this change)_ · **Area:** backend, ci
- **Symptom:** `priceDropPipelineE2E.test.js` goes red on CI with "Timed out
  waiting for the post-import background sweep's push" and a cascading
  `expected 1, actual 0` on the dedupe assertion — both **pass locally** and pass
  when the file runs alone. Reddened ~half of all `push`-to-`main` runs.
- **Root cause (the *real* one):** a cross-process race on the **one shared Neon
  Preview branch**. The whole suite runs `node --test --test-concurrency=4`, and the
  verified-drop pipeline elects **exactly one sender** per `(receipt_item, price)` via
  the shared `price_drop_notifications` ledger (`priceDropRepo.recordNotified`). The
  E2E file lives in province **SK** and waits for *its own* fire-and-forget post-import
  sweep to push. But `priceDropDb.test.js` fired **global (no-`region`) real-gate**
  sweeps; running concurrently — or in a second overlapping CI run on the same DB — one
  of those could win the election for the E2E flow's SK drop during the window its
  notification gate was open, then "send" it through *its own* injected `fakeExpo(sent)`
  array. The E2E flow's sweep then found the row already taken → nothing to push → 60 s
  timeout.
- **Why the first fix (PR #56) missed it:** it was mis-diagnosed as CPU/connection
  *starvation* and "fixed" by widening the wait `15 s → 60 s` (`711cf81`). That never
  helped because it is a **race, not a slow path** — the push is gone, not late. The
  "ruled out the steal race because the Expo mock is process-global" reasoning was the
  trap: sibling sweeps inject a **per-test** `fakeExpo`, bypassing the global
  `Expo.prototype` mock, and a second CI run is a different process entirely — so a
  stolen push never surfaces in this run's `expoSent`.
- **Fix (two layers, both needed):**
  1. **No file runs a province-global sweep.** Region-scope `priceDropDb.test.js`'s 4
     sweeps to its own province (`{ region: "ON", … }`) so sweeps never reach across
     provinces — stops *same-job* (`--test-concurrency=4`) stealing.
  2. **One backend job at a time, repo-wide.** Job-level `concurrency: { group:
     backend-db-tests, cancel-in-progress: false }` on the `backend` CI job so a PR run
     and the post-merge `push` run can't hit the shared Neon branch at once — stops
     *cross-run* stealing. Runs queue instead of cancelling.
- **Files:** `backend/tests/priceDropDb.test.js` (region-scoped sweeps),
  `.github/workflows/test.yml` (backend job `concurrency`). The 60 s `waitFor` in
  `priceDropPipelineE2E.test.js` is left as harmless headroom.
- **Detect next time:** a backend test that is *only* "Timed out waiting for …" an
  async effect, green locally and when the file runs alone, and **intermittent on CI
  correlated with overlapping runs**. Check whether another test/run mutates the same
  shared-DB arbiter row.
- **Prevent:** when tests share one DB, every test must scope its writes to a
  partition it exclusively owns (here: province), and CI jobs that touch a shared DB
  must be serialized. A "shared mock is global" argument does not rule out a steal when
  siblings inject their own mocks or run in separate processes/runs.

---

## 18. Store stays visible in the app even with `visible=false` in the DB

- **Date:** 2026-06-13 · **PR:** _(this change)_ · **Area:** backend
- **Symptom:** An operator sets `visible=false` on a store to hide it, but the
  store still shows up in the app's Stores tab / `GET /api/v1/policies.json`. Only
  a couple of stores (costco, walmart) could ever be hidden; the rest ignored the flag.
- **Root cause:** Two separate tables. The app's store list was served from
  `store_policies` (the ~20 consumer retailers), but the `visible` flag lived on the
  operational `stores` lookup, and `getPoliciesPayload` matched them only by overlapping
  `code`. `stores` was seeded with just 9 operational codes; only `costco`/`walmart`
  overlapped the 20 policy retailers — so for the other 18, no `stores` row existed to
  carry a `visible=false`, and the gate silently no-op'd. The two tables weren't truly linked.
- **Fix:** Merged `store_policies` into `stores` (migration `0003_broken_psynapse`) so
  every displayed store is **one row** carrying both its policy content and its `visible`
  flag. `getPoliciesPayload`/`count()` now read `stores` and share one `consumerFacing()`
  filter: `short_name IS NOT NULL` (policy-bearing) **AND** `visible != false`. The flag
  now gates every store it names.
- **Files:** `backend/db/schema.js` (merged `stores`), `backend/db/migrations/0003_broken_psynapse.sql`
  (data-preserving copy + drop), `backend/repos/storePoliciesRepo.js`, `backend/db/seed.js`
  (single merged store seed), `backend/tests/storePoliciesDb.test.js`.
- **Detect next time:** toggling `visible` in the DB doesn't change the
  `/api/v1/policies.json` payload; `/health` `policies.source=db` but the hidden store persists.
- **Prevent:** one table per concept — never gate a displayed entity by a flag on a
  *different* table joined only by a soft `code` match. The merge test asserts toggling
  `visible=false` on any payload store drops it.

---

## Operational alerting (reusable across bug classes)

The same change added a **reusable, throttled alert primitive** so that *any*
"this shouldn't be happening in prod" signal can page the operator the same way
— not just auth failures. Prefer wiring a new bug class into this rather than
inventing a one-off.

- **Transport:** Resend HTTPS API via `sendBudgetAlert(subject, text)` (already
  used for OCR-budget alerts). Opt-in: set `RESEND_API_KEY` + `ALERT_EMAIL`
  (and optional `ALERT_FROM`) on Railway. Unset → alerts are logged, not emailed.
- **Primitive:** `raiseAlert(key, subject, text)` in `backend/server.js`.
  Per-`key`, **throttled to once per `ALERT_COOLDOWN_MS`** (default 1h) so a
  sustained incident sends **one** email, not thousands. Returns `true` when an
  email was actually queued.
- **To add a new alert class:** detect the condition, then call
  `raiseAlert("my-unique-key", "[PriceBack] <subject>", "<body>")`. That's it.

### Auth-failure monitor (the canary for entry #1's class)

- `recordAuthFailure(reason, req)` is called from `requireAuth` on every rejected
  token. It keeps a **sliding window** of recent 401s; crossing
  `AUTH_FAIL_ALERT_THRESHOLD` (default 20) within `AUTH_FAIL_WINDOW_MS`
  (default 10 min) fires `raiseAlert("auth-401-spike", …)`.
- Counts are exposed at `/health` under `auth.failures` and via
  `authFailureSnapshot()`.
- **Tunables (env):** `AUTH_FAIL_ALERT_THRESHOLD`, `AUTH_FAIL_WINDOW_MS`,
  `ALERT_COOLDOWN_MS`.
- **Note:** in-memory (resets on redeploy, by design — cheap + synchronous).
  The API audit log (`{"t":"api",...}` JSON lines in the Railway log stream) is
  the durable forensic breadcrumb trail across deploys.

## 19. Price-tag grant/revoke could double-credit under concurrency (SELECT-then-INSERT race)

- **Date:** 2026-06-14 · **PR:** _(this change)_ · **Area:** backend
- **Symptom:** A user could be granted the price-tag scan reward **more than once**
  for a single accepted observation (real credits = real money) when two requests
  for the same observation `ref` raced. Easy to miss: the ledger still
  *reconciles* (`creditsRepo.balanceReconciles` passes) because each grant updates
  the balance **and** writes a ledger row atomically — the balance is just wrong
  (e.g. 3 credits for one tag).
- **Root cause:** `creditsRepo.grantPriceTagCredit` / `revokePriceTagCredit` did an
  idempotency **CHECK** (`SELECT` for an existing `(user_sub, type_id, ref)` ledger
  row) and then, in a **separate** transaction, the **INSERT**. Two concurrent
  calls both saw "no existing row" and both inserted → double grant. There was no
  DB-level uniqueness on `(user_sub, type_id, ref)` to stop it.
- **Fix:** Compose the check + write into **one** transaction guarded by a
  transaction-scoped Postgres advisory lock keyed on `(userSub, ref)`
  (`pg_advisory_xact_lock(hashtext('ptc:'||sub||':'||ref))`). Concurrent
  grant/revoke for the same observation now serialize: the loser sees the
  committed row and returns `alreadyAwarded` / `alreadyRevoked`. The xact-scoped
  lock releases on COMMIT/ROLLBACK and is safe through Neon's PgBouncer
  transaction pooling (a session-scoped lock would leak). No migration needed.
- **Files:** `backend/repos/creditsRepo.js` — `grantPriceTagCredit`,
  `revokePriceTagCredit`, new `_ledgerRowForTx` + `_lockPriceTag` helpers (replaced
  the non-transactional `_ledgerRowFor`).
- **Detect next time:** compare a user's count of `price_tag_scan` ledger rows
  against their count of **distinct** `ref` — more grant rows than distinct refs
  means a double-grant slipped through.
- **Prevent:** `backend/tests/creditLedgerAccuracy.test.js` fires N concurrent
  grants/revokes for the same `ref` and asserts **exactly one** is awarded/revoked
  and the balance equals the single grant. This test fails on the pre-fix code.

---

## 20. Multi-quantity receipt line stores its whole line total as the UNIT price

- **Date:** 2026-06-14 · **PR:** _(this change)_ · **Area:** backend
- **Symptom:** A receipt line bought with **quantity > 1** records a `price_points`
  row whose `current_unit_price` (and `regular_unit_price`) equals the **whole
  paid amount** for the line, not the per-item price — e.g. a 3-pack at $30 shows
  a $30 "unit" price, inflating the crowdsourced price/history (and breaking
  cross-quantity comparisons) for that product. Single-quantity lines look fine,
  so it hides until someone buys 2+ of one SKU.
- **Root cause:** `receiptsRepo.create` built the priced rows by passing the line's
  `lineTotal` straight into `price` (→ `current_unit_price`) and the pre-discount
  `originalPrice` into `regularPrice` (→ `regular_unit_price`). Both fields are
  **LINE totals** (qty × unit — the data-model contract stated in
  `src/utils/receiptMath.js`), but the columns are per-**unit**. The division by
  quantity was simply missing on the write path. The mobile/notifier savings path
  already divides correctly (it tracks a separate `unitPaid`; see the "[C] milk
  multi-pack" guard in `tests/lifecycleIntegration.test.js`) — only the backend
  price-point writer skipped it.
- **Fix:** New pure helper `lineToUnitPrices({ lineTotal, originalPrice, quantity })`
  in `receiptsRepo.js` divides the paid + regular line totals by quantity (rounded
  to cents; missing/zero/invalid qty → 1) and `create()` uses it to build the
  priced rows. `is_on_sale` / derived `instant_savings` then fall out correct
  per-unit automatically (computed downstream on the unit values). The qty-1 path
  is unchanged (÷1). Existing rows were **not** backfilled (deliberate).
- **Files:** `backend/repos/receiptsRepo.js` — `lineToUnitPrices` (new, exported),
  `create()` priced mapping.
- **Detect next time:** for a `receipt_ocr` price point, join its `source_ref`
  (`<receiptId>:<idx>`) back to the matching `receipt_items` row and check
  `current_unit_price ≈ line_total / quantity`; a hit where it ≈ `line_total`
  (with `quantity > 1`) is this bug.
- **Prevent:** `backend/tests/receiptUnitPrice.test.js` (pure, always-on) pins
  `lineToUnitPrices`; `backend/tests/receiptPricePoints.test.js` adds a DB-gated
  end-to-end case asserting a `quantity: 3, lineTotal: 30` line stores `10.0`, not
  `30.0` (and a multi-qty TPD line stores per-unit paid/regular/savings).

---

## 21. DB `visible`/`enabled` edits never reach the app (freshness gate never advances)

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** both
- **Symptom:** Operator flips `stores.visible=false` (or toggles `enabled`) in the
  DB to hide/disable a store, but the app keeps showing the old state — the hidden
  store still appears, the coming-soon/live flag doesn't change. The **first**
  remote payload a fresh install ever applies is correct; only **subsequent** edits
  are ignored. Distinct from entry #18 (which fixed the server-side filter): the
  server now omits/flags correctly, but the client refuses the new payload.
- **Root cause:** The mobile freshness gate. `applyRemoteStores`
  (`src/constants/stores.js`) only replaced its in-memory `STORES` when
  `payload.updatedAt` was **strictly greater** than the last-applied date, and
  `updatedAt` = `max(content_updated_at)` over the **visible** rows — a manually
  maintained `date` column. So: (a) hiding a store removes it from the set without
  raising that max (the remaining rows' dates are unchanged) → client sees an
  equal/older `updatedAt` → **rejects** the shorter list → store stays; (b) a
  date-only token can't represent two edits the same day; (c) `stores.updated_at`
  had **no trigger / no Drizzle `$onUpdate`**, so hand SQL edits bumped nothing.
- **Fix:** A monotonic revision token decoupled from the content date.
  - DB trigger `stores_touch_updated_at` (migration `0005_stores_touch_trigger.sql`)
    sets `updated_at = now()` on **every** UPDATE — works for hand SQL / console
    edits, not just ORM writes (`schema.js` also gets a mirrored `$onUpdate`).
  - `getPoliciesPayload` adds `rev = max(updated_at)` over **ALL** store rows
    (NOT filtered) — computing over every row means hiding the most-recently-edited
    store still *raises* `rev` (its `updated_at` just bumped), where a max over only
    visible rows could *fall*. Emitted as an ISO timestamp.
  - `applyRemoteStores` gates on `rev` (strict-greater, lexical ISO compare),
    falling back to the legacy `updatedAt` date gate when `rev` is absent (no-DB
    file fallback / pre-`rev` cached payloads). `updatedAt` is kept for the
    human "Policies updated …" indicator only.
  - Endpoint `Cache-Control` lowered `3600`→`60` so an edit lands in ~a minute.
- **Files:** `backend/db/migrations/0005_stores_touch_trigger.sql` (+ `_journal.json`),
  `backend/repos/storePoliciesRepo.js` (`getStoresRev`, `rev` in payload),
  `backend/db/schema.js` (`$onUpdate`), `backend/server.js` (cache header),
  `src/constants/stores.js` (`rev` gate, `getStoresRev`).
- **Detect next time:** hit `/api/v1/policies.json` twice around a DB edit — if the
  store set changes but `rev` is identical, the trigger/migration isn't applied on
  that branch (prod owes `0005`). If `rev` advances but the app still shows stale
  data, suspect the HTTP/edge cache (now 60 s) or a stale AsyncStorage payload.
- **Prevent:** `storePoliciesDb.test.js` asserts hiding a store and toggling
  `enabled` each **strictly advance** `rev`; `__tests__/stores.test.js` asserts the
  `rev` gate applies a change even when `updatedAt` is unchanged, and that rev-less
  payloads still honor the legacy date gate.

## 22. Credit balance shown in the app drifts from the server (660 shown vs 75 real)

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** The on-screen credit balance disagrees with the server. A user
  saw **660** credits in the app while the backend (and the credit *ledger* shown
  right next to it) said **75**. The number could be arbitrarily high; the ledger
  was correct, only the headline balance was wrong. Disturbing and hard to trust.
- **Root cause:** The displayed balance was **reconstructed locally** instead of
  read from the server. `canAddReceipt()` (`src/services/purchaseService.js`)
  computed `remaining = FREE_TRIAL_CREDITS + localTopUpCredits − localScanCount`
  from three AsyncStorage counters (`topup_credits_granted_v1`,
  `total_scan_count_v2`). Pack purchases optimistically incremented the local
  top-up counter (`addLocalTopUpCredits`), and the local scan counter could lag
  the server's `scan_consume` deductions. After any server-side reset of
  `users.scan_credits`, the local pieces still summed to the old, higher number.
  A `creditBalance` cache + a "take the min" reconciliation existed in
  `syncService.js`, but nothing in the UI actually read it — the display used the
  local reconstruction, so the reconciliation was dead code.
- **Fix:** Balance + ledger are **server-authoritative and read live, never cached
  or reconstructed**. `fetchServerCredits()` hits `GET /api/me/credits` every call
  (no persistence). `canAddReceipt()` returns `Infinity` for Unlimited subs and
  otherwise the live `scan_credits` balance; if it can't be read (offline / signed
  out) it returns `{ allowed:false, remaining:null, unavailable:true }` — scanning
  is blocked until the real balance loads rather than guessing. The local top-up
  mirror is gone; after a pack purchase the Buy-Credits screen polls
  (`pollServerCreditsForIncrease`) until the RC webhook lands. The
  `creditBalance`/`creditLedger`/`serverCreditBalance` cache + reconciliation were
  removed (only the referral/invite code is still cached).
- **Files:** `src/services/purchaseService.js` (`fetchServerCredits`,
  `pollServerCreditsForIncrease`, rewired `canAddReceipt`, removed
  `addLocalTopUpCredits`), `src/services/syncService.js` (dropped credit cache),
  `src/services/storageService.js` (removed `getCreditLedger`/`getCachedCreditBalance`),
  `src/screens/{CreditHistory,ManageSubscription,BuyCredits}Screen.js`.
- **Detect next time:** compare the app balance against `GET /api/me/credits`
  (or `users.scan_credits` directly). If they differ, something is caching or
  reconstructing the balance client-side again — grep for any AsyncStorage write
  of a credit count.
- **Prevent:** `purchaseService.test.js` asserts `canAddReceipt` ignores local
  scan/top-up counters entirely and blocks when the balance is unreadable;
  `syncServiceHydrate.test.js` asserts balance/ledger are **not** written to the
  account cache.

## 23. Offline scans: local credit buffer + idempotent ledger (no double-charge)

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile + backend
- **Context:** Entry #22 made the balance server-authoritative and **blocked
  scanning whenever it couldn't be read** (offline). That's safe but too strict —
  a user with plenty of credits couldn't scan on a plane. This adds a bounded
  offline window without reintroducing the #22 drift.
- **Design (the rules that keep it safe):**
  - **Never mirror a spendable balance locally.** We persist only (a) a *read-only
    snapshot* of the last server balance (`last_known_credit_balance_v1`,
    overwritten on every successful live read, never incremented) and (b) an
    append-only log of spend transactions (`offline_scan_log_v1`), one
    `{ ts, delta:-1, ref }` per scan. The snapshot gates; the log records.
  - **Offline gate = effective > 10.** `canAddReceipt()` allows an offline scan
    only while `lastKnownBalance − bufferedOfflineSpends > OFFLINE_SCAN_MIN_BALANCE`
    (10). The 10-credit buffer means unsynced spends can never overdraw the real
    server balance even if several scans happen before reconnect.
  - **Upload then destroy.** On reconnect (`fetchServerCredits` success, or boot)
    `flushOfflineScanLog()` POSTs the buffer to `/api/me/credits/offline-scans`
    and **deletes the local log immediately**.
  - **One idempotency key prevents double-charging.** Both the offline-scan
    upload AND the normal receipt POST consume credits via
    `creditsRepo.consumeScanCreditOnce({ ref: receiptId })` — idempotent on
    `(userSub, 'scan_consume', ref)` under an advisory xact lock. So a scan that
    was logged offline *and* later syncs its receipt is charged exactly once,
    whichever path lands first. Same pattern for pack top-ups:
    `recordTopupOnce({ ref: transactionId })` is shared by the client-confirmed
    `/api/me/credits/topup` (fed the instant payment is approved) and the slower
    RC webhook (now keyed on `event.transaction_id`), so they can't double-credit.
- **Files:** `src/services/purchaseService.js` (offline log + snapshot + gate +
  `flushOfflineScanLog` + `confirmPackPurchaseToBackend`), `src/services/bootService.js`
  (flush on boot), `src/screens/ScanScreen.js` (pass `{ ref, offline }`),
  `backend/repos/creditsRepo.js` (`consumeScanCreditOnce`, `recordTopupOnce`),
  `backend/server.js` (two endpoints + webhook/receipt-POST routed through them).
- **Detect next time:** if a credit is charged twice for one scan, check
  `credit_ledger` for two `scan_consume` rows with the **same `ref`** — the
  advisory-lock/existence guard in `consumeScanCreditOnce` should make that
  impossible; a regression means a caller stopped passing the receipt id as `ref`.
- **Prevent:** `__tests__/offlineScanCredits.test.js` (gate >10, buffer
  upload+destroy, no online buffering, immediate topup confirm) and
  `backend/tests/offlineScanCredits.test.js` (per-`ref` idempotency across the
  offline-scan + receipt-POST paths, client-confirm vs webhook no double-credit,
  insufficient balance never overdraws, claim → `watch_enabled=false`).

## 24. Claimed product didn't leave "watching" until its window lapsed

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile + backend
- **Symptom:** Claiming a price drop kept the line under the **Watching** chip
  (and the price-check task kept re-evaluating it) until the receipt's adjustment
  window expired — only then did it move to **Claimed**. Users expected it to move
  the instant they claimed.
- **Fix:** Claiming now ends the watch in the **same write** as `claimed_savings`:
  `markItemClaimed`/`markAsClaimed` (mobile) and `receiptsRepo.claimItemByIndex`
  (backend) set `watchEnabled:false`. The Products view filter now puts any
  `item.claimed` line under **Claimed immediately** (dropped the `days===0`
  condition) and excludes claimed lines from **Watching**; `productsAll` was
  widened to keep claimed lines visible even though `watchEnabled` is now false
  (`watchEnabled !== false || claimed`). Receipt-level chips intentionally
  unchanged (out of scope).
- **Files:** `src/services/storageService.js`, `backend/repos/receiptsRepo.js`,
  `src/screens/ReceiptsScreen.js`.

## 25. Cloud preferences (warehouse, auto-reload) only reached the DB on the next boot/sign-in

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Picking a warehouse (or any cloud-backed pref) wrote local-only;
  it was mirrored to the backend only on the next `hydrateFromBackend` (boot /
  sign-in) when the LWW clock happened to be newer. A pick made and then the app
  killed — or simply used on a second device before a hydrate — didn't persist
  to the database, so it wasn't "persistent in the DB always" / cross-device.
- **Fix:** `savePrefs` now fires a best-effort `pushCloudPrefs()` (dynamic import,
  no static cycle) the moment a genuine LOCAL cloud-pref edit happens — gated on
  the same `cloudChanged && updates.preferencesUpdatedAt === undefined` condition
  that bumps the LWW clock, so a hydrate-apply (which replays a SERVER value with
  an explicit timestamp) never echoes back. No-ops when signed out / unconfigured;
  the hydrate push-up remains the offline fallback. The backend already persists
  `preferred_warehouse_id` (warehouses are seeded, so it decorates fully on hydrate).
- **Files:** `src/services/storageService.js` (`savePrefs`).

## 26. "Stopped watching" a product was resurrected by the next bootstrap merge

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile + backend
- **Symptom:** `stopWatchingItem` flipped `watchEnabled:false` locally but never
  told the backend. `mergeServerIntoLocal` takes the server's `watch_enabled`
  (`...sit`), so the next hydrate restored watching — the product re-appeared
  under **Watching** on the same device and on every other device. (Claims were
  fine — the claim route already sets `watch_enabled=false` server-side.)
- **Fix:** New `POST /api/receipts/:id/items/:index/watch` +
  `receiptsRepo.setItemWatchByIndex` (mirrors the claim route's index+fingerprint
  locator). Mobile `stopWatchingItem` calls the new
  `receiptSyncService.setItemWatchOnBackend` (best-effort, never blocks the UI).
  Server becomes authoritative for `watch_enabled`, so the merge stays correct.
- **Files:** `backend/server.js`, `backend/repos/receiptsRepo.js`,
  `src/services/receiptSyncService.js`, `src/services/storageService.js`.

## 27. A new device's id was never logged against the signed-in account

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile + backend
- **Symptom:** Signing the same account into a NEW device (especially while also
  signed in elsewhere "at the same time") left the new `device_id` row with
  `owner_sub = NULL`. `/api/device/sync` + `/api/device/scan` were unauthenticated
  and never passed `ownerSub`; the device was only ever claimed as a side-effect
  of a tag-scan credit grant. So the device existed anonymously but wasn't
  associated with the user.
- **Fix:** Both routes now read `optionalAuthUser(req)` and pass `ownerSub` to the
  upsert (which already keeps an existing owner when none is supplied → an
  anonymous launch never un-claims; a provided owner overwrites → account switch
  re-attributes). Mobile `syncDeviceWithBackend` / `reportScanToBackend` switched
  from plain `fetch` to `authedFetch` so the ID token rides along when signed in.
  Distinct physical devices have distinct ids → distinct rows → no cross-device
  race when two logins happen concurrently.
- **Files:** `backend/server.js` (`/api/device/sync`, `/api/device/scan`),
  `src/services/purchaseService.js`.

## 28. Account data shown from a local counter/cache reset to a stale or fabricated value after a storage wipe

- **Date:** 2026-06-15 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** After clearing the app's storage/cache and re-signing in with the
  **same** Google account, two values were wrong even though the backend was correct:
  (1) "Total saved this year" showed **0**; (2) the credit balance showed **75** (the
  free-trial grant) instead of the real **72**, with no ledger entry to explain the
  jump. The DB was verified correct: `users.scan_credits = 72`, `trial_credits_granted_at`
  set, and the ledger reconciled exactly (`signup_grant +75 → scan_consume −1 ×3 → 72`).
  Nothing re-granted on the server — both numbers were **client display artifacts**.
- **Root cause (one class, two sites):** a value was computed from **local state**
  instead of the DB-sourced data, so a wipe (which drops local state) left it stale or
  fabricated:
  - **Savings:** `getTotalSavings()` read a standalone `total_savings_v1` AsyncStorage
    counter bumped only by `addToTotalSavings()` on claim. Hydration restores the
    receipts (each claimed item carries `claimedSavings`) but never rebuilt that
    counter, and the wipe deleted it → `0`.
  - **Credits (Manage screen):** the trial membership card computed
    `FREE_TRIAL_CREDITS − (status.used || 0)`. Neither `canAddReceipt()` nor
    `getPremiumStatus()` provides `limit`/`used`, so it was **always 75 − 0 = 75**,
    ignoring the authoritative `status.remaining` (the live server balance).
    `ProfileScreen` already used `remaining`; the Manage screen was never updated.
- **Fix:** make both surfaces DB-authoritative (local storage is only a cache).
  - `getTotalSavings(receipts?)` now **derives** the total by summing `claimedSavings`
    over claimed items; `getStats()` computes it in its existing pass. Deleted the
    `total_savings_v1` counter + `addToTotalSavings`. Because receipts hydrate from the
    DB on startup, the total self-heals after any wipe.
  - `ManageSubscriptionScreen` uses `trialBalanceFromStatus(status)` →
    `Number.isFinite(status.remaining) ? status.remaining : null` (the card renders a
    `—` placeholder for `null`); the "X of N" note is dropped when the balance is
    unknown rather than fabricating a number.
- **Rule of thumb:** anything account-derived (savings, credit balance + ledger,
  claimed products, receipts, active plan, referrals) must be read from the
  DB-hydrated data (`/api/me/bootstrap` → receipts / live `fetchServerCredits`), never
  from an independent local counter that a wipe can drop or a default that fills in a
  fake value. Sibling entries: #22 (balance cache drift), #13 ("Reset All Data").
- **Files:** `src/services/storageService.js` (`getTotalSavings`, `getStats`,
  `markItemClaimed`/`markAsClaimed`, removed `SAVINGS_KEY`),
  `src/screens/ManageSubscriptionScreen.js` (`trialBalanceFromStatus`).

## 29. Client mapped on the human error string, not the machine code (referral); "Reset" signed the user out; prices hardcoded in copy

Three sign-in/credits-polish bugs sharing two root classes — **string-as-contract** and
**copy-as-config**:

- **Referral errors never specialized.** `OnboardingScreen` mapped on
  `result.error === "self_referral"`, but the route returns the *human* string
  (`error: "cannot redeem your own code"`) — the machine code (`self_referral`) was
  never sent to the client. So every failure fell through to the generic message, and
  redemption was **non-blocking**: a bad/unverifiable code let the user finish setup
  anyway, silently dropping the friend's credit.
  - **Fix:** the redeem route now returns `{ error, code }`; `redeemReferralCode`
    surfaces `code`; `finishSetup` maps on `code` and **blocks** (returns, stays on the
    setup screen) on any non-OK result, including network/`backend_unconfigured`
    (can't-verify ⇒ block, never skip). An empty code is still allowed (referral
    optional). Deleted-user guards added: a soft-deleted (`status=false`) redeemer →
    `deleted_user`; a deleted inviter's code reads as `not_found` (don't leak existence).
- **"Reset All Data" signed the user out** (see #13 for the server side). Reset must
  keep the account live (`usersRepo.resetData` never flips `users.status`), so the
  client wipe + `signOut()` + nav-to-Splash-auth-gate was wrong.
  - **Fix:** drop `signOut()`; snapshot the identity/profile prefs first
    (`onboardingComplete`/`profileComplete`/`postalCode`/`province`/`language`) because
    `clearAllData()` also nukes `PREFS_KEY`, restore them after the wipe, then re-boot
    through Splash (re-hydrates the now-empty DB and routes back to Main).
- **Prices hardcoded in copy.** FAQ said "Unlimited ($12/month)" while the catalog/DB
  moved to $4.99 — copy can't be a price source.
  - **Fix:** FAQ answers use `{unlimitedPrice}`/`{starterPrice}`/`{starterCredits}`
    placeholders fed from `getEffectiveCatalog()` (DB-effective `/api/v1/pricing.json`,
    bundled fallback). The DB row (`subscription_plans.monthly_price`) is the single
    knob — changing it needs no app release.
- **Rule of thumb:** an API's stable contract is its **machine `code`**, never the
  human message — map on the code and always send it. Anything a wipe/keep decision
  depends on (identity prefs) must be preserved explicitly, not assumed to survive
  `clearAllData()`. Prices/quotas live in the catalog/DB, never baked into i18n strings.
- **Files:** `backend/repos/referralsRepo.js`, `backend/referral.js`, `backend/server.js`
  (`/api/me/referral/redeem` returns `code`), `src/services/authService.js`
  (`redeemReferralCode`), `src/screens/OnboardingScreen.js` (`finishSetup`),
  `src/screens/StoresAndProfileScreens.js` (`runReset`), `src/screens/FAQScreen.js`,
  `src/services/i18n.js`. Sibling entries: #13 (Reset server side), #22/#28 (DB-authoritative values).

---

## 30. Phantom price drop ($0.18) on a Costco item whose "Price Now" equals "You Paid"

- Date: 2026-06-18 · PR: (pending) · Area: both
- Symptom: a receipt item showed a tiny drop (e.g. $0.18) in the app, but tapping *Refresh
  prices* erased it, and the *You Paid* card ($4.39) equalled the *Price Now* card ($4.39) —
  so the saving had no real source. It surfaced on a second device after the first device was
  reset.
- Root cause: **two diverging detection paths + a client-fabricated price.** The background
  task (`checkAllPriceDrops`) applied a hardcoded `× 0.96` (~4%) "warehouse estimate" for
  Costco warehouse/unknown receipts and compared the *paid* price against that fabricated
  number, while still storing the *unadjusted* price as `currentPrice`. So `$4.39` →
  `4.39 − 4.39×0.96 = $0.18` phantom saving, with both cards reading $4.39. The manual refresh
  path compared **directly** (no estimate) → found nothing → "erased" the drop. Worse, a
  no-drop check never **cleared** the stale `priceDrop`, and the sync union-merge preserved it,
  carrying the phantom to a second device.
- Fix: (1) remove the `× 0.96` fabrication — compare the paid unit price **directly** to the
  verified price for every purchase type (the backend `price_points` source is already
  warehouse/province-scoped, so the client must apply no estimate); (2) gate every drop on
  **strictly-positive savings** so a $0.00 sale-label result can't surface a chip; (3) **clear**
  any stale `priceDrop` when a check finds no drop (manual refresh + background task); (4) only
  preserve a local `priceDrop` across sync while it's **< 48h fresh**.
- Files: `src/services/priceService.js` (`checkAllPriceDrops`), `src/screens/DetailScreen.js`
  (`handleCheckPricesNow`), `src/services/notificationService.js` (background task),
  `src/services/syncService.js` (`mergeServerIntoLocal`).
- Detect next time: a drop where `currentPrice === unitPaid` (or `savings ≤ 0`) is by
  definition not a drop — assert `savings > 0` wherever a drop is recorded.
- Prevent: `__tests__/priceServiceDrops.test.js` (equal price → no drop; promo with 0 savings →
  no drop) + `syncService.test.js` (stale priceDrop dropped on merge). **Rule of thumb:** the
  client never *invents* a price — compare like-for-like against the server's verified number,
  and a "no drop" result must clear prior state, not leave it. Sibling: #24 (watch lifecycle).

## 31. Async action button stayed enabled with no spinner → double submit (receipt saved twice)

- Date: 2026-06-19 · PR: (pending) · Area: mobile
- Symptom: tapping *Start tracking receipt* on the Scan screen showed no loading state and the
  button stayed enabled while the save was in flight. Confused users tapped again and the receipt
  was saved twice.
- Root cause: the `onPress` handler `await`ed a server round-trip (`saveReceipt` + scan-credit
  consume) but had **no in-flight guard** — no `submitting` state, no `disabled`, no spinner. The
  reusable `Button` (`src/components/index.js`) already supports `loading` (renders an
  `ActivityIndicator` and sets `disabled`), but the call site never passed it. The same gap
  existed on other server-backed buttons (onboarding finish, inline editor save, reset).
- Fix: standard pattern on every async action button — `const [submitting,setSubmitting]=useState(false)`,
  guard the handler with `if (submitting) return; setSubmitting(true)`, wrap the body in
  `try { … } finally { setSubmitting(false) }`, and pass `loading={submitting}` (or
  `disabled={submitting}` for raw `TouchableOpacity`). Buttons fired from inside an `Alert.alert`
  callback are naturally guarded (the modal blocks re-tap), so they don't need it.
- Files: `src/screens/ScanScreen.js` (`handleSave`/`doSave`), `src/screens/OnboardingScreen.js`
  (`finishSetup`), `src/screens/DetailScreen.js` (`saveEditor` / `EditorModal`),
  `src/screens/StoresAndProfileScreens.js` (`runReset`).
- Detect next time: any `onPress={async …}` that hits the network without a `submitting`/`loading`/
  `disabled` guard is a double-submit waiting to happen. **Rule of thumb:** a button that triggers a
  server round-trip must disable itself + show a spinner until the response lands.
- Prevent: `__tests__` assert a double-tap fires the underlying service exactly once.

## 32. Config value hardcoded in copy/labels → drifts when the knob changes

- Date: 2026-06-20 · PR: (pending) · Area: mobile + backend
- Symptom: the auto-reload/low-balance threshold was lowered 100→50 in the catalog, but the
  Notifications screen still read "When you fall below **100** credits". Same class: "+15" referral
  badges, "15 credits per $1" FAQ copy, "within 30 days" restore copy, "last 90 days" email-sync
  copy, "30-day price history" — all literals that duplicate a value owned by `shared/pricing.config.js`
  / `app_config`.
- Root cause: user-facing strings inlined a number that actually lives in config. Changing the
  config (or a DB `app_config` row) updated behavior but not the copy, so the two drifted.
- Fix: copy must read the value, never restate it. Mobile exposes `getCopyParams()`
  (`src/services/pricingCatalogService.js`) — config-derived display values (credits-per-$, referral
  bonus, thresholds, day-windows, prices) sourced from the DB-effective catalog with bundled
  fallback. Screens spread it into `t(key, params)` (i18n strings use `{placeholder}` tokens) or a
  JSX template literal. Values with no config source got real knobs (`EXPIRY_WARNING_DAYS`,
  `EMAIL_SYNC_WINDOW_DAYS`, `PRICE_HISTORY_DAYS`) added to `pricing.config.js` + seeded into
  `app_config` + shipped via `pricing.json` (`backend/config/configService.js`). Backend literal
  fallbacks (`|| 3`, `|| 14`) now reference `OPS_DEFAULTS`.
- Files: `src/services/pricingCatalogService.js` (`getCopyParams`), `src/services/i18n.js`
  (EN+FR placeholders), `FAQScreen`/`NotificationsScreen`/`InviteFriendScreen`/`BuyCreditsScreen`/
  `EmailSyncScreen`/`DetailScreen`/`SplashScreen`/`notificationService.js`, `shared/pricing.config.js`,
  `backend/{config/configService.js,db/seed.js,repos/priceDropRepo.js}`.
- Detect next time: grep new copy/JSX for a number that also appears in `pricing.config.js`,
  `config/defaults.js`, or a DB table. **Rule of thumb:** a number a user reads that the business
  can change is config — interpolate it, don't type it. (Genuine external facts — e.g. each store's
  own adjustment window in `constants/stores.js` — are reference data, and that file IS their source.)
- Prevent: `__tests__/pricingCatalogService.test.js` asserts `getCopyParams()` reflects remote-tuned
  values; screen smoke tests mock it. See memory [[ui-form-field-best-practices]] for the sibling UI rule.

## 33. Price-tag price fields won't accept a decimal point (can't type "12.99")

- Date: 2026-06-20 · PR: (pending) · Area: mobile
- Symptom: on the price-tag confirm screen, typing a price like `12.99` is impossible — the
  decimal point (and anything after it) vanishes as you type. Same class the receipt/scan screen
  hit earlier.
- Root cause: the price `TextInput`s were *controlled by a parsed Number*. On each keystroke
  `parseMoney(text)` ran and the field re-rendered `value={String(number)}`. Typing `"12."` →
  `parseFloat("12.")` → `12` → re-render `"12"`, so the trailing dot could never persist. A
  controlled numeric value and free decimal entry are mutually exclusive.
- Fix: keep the **raw typed string** in tag state and parse to a number only at submit.
  `sanitizeMoneyText` strips everything but digits + a single dot (also kills commas/`$`/spaces);
  `moneyTextToNum` converts at `doSubmitAll`. The final-price field recomputes from the
  original/savings *text* after each edit.
- Files: `src/screens/PriceTagScanScreen.js` (`sanitizeMoneyText`/`moneyTextToNum`/`normalizeParsedTag`,
  `TagCard`, `doSubmitAll`).
- Detect next time: any money `TextInput` whose `value=` is a Number (or a `String(number)`) is the
  smell. Try typing `1.` in a manual test.
- Prevent: store raw text for free-entry numeric fields; parse at the boundary. Test in
  `__tests__` asserts a typed `"12."` survives a sanitize round-trip.

## 34. Phantom second price tag from over-eager SKU segmentation (undeletable, unsubmittable)

- Date: 2026-06-20 · PR: (pending) · Area: mobile
- Symptom: one physical Costco tag is detected as **two** tags — the first has SKU/brand/product
  but no prices, the second has the prices but empty everything else. Neither is submittable, and
  there was no way to delete either, so the user was stuck and had to re-scan.
- Root cause: `parseCostcoTags` split the OCR text on **every** 5–7 digit run, treating a stray
  number below the price block (a barcode/count/phone number) as a second SKU anchor — so the
  single tag's lines were torn across two segments. The split was accepted as long as each segment
  merely had *a SKU*.
- Fix: only treat the photo as multi-tag when **each** segment yields a SKU **and** a usable price
  (`p.sku && (p.finalPrice != null || p.originalPrice != null)`); otherwise fall back to the
  single whole-text parse. Independently, every tag card now has a **delete** control (rule: the
  user must always be able to drop a detection and continue).
- Files: `src/services/costcoTagScanner.js` (`parseCostcoTags`), `src/screens/PriceTagScanScreen.js`
  (`removeTag`, `TagCard` delete button).
- Detect next time: a multi-tag review where one card is all-empty-but-price or all-fields-but-no-price.
- Prevent: `__tests__/costcoTagScanner.test.js` asserts a single tag whose text contains a stray
  number stays ONE tag.

## 35. White screen / forced app restart on a bad scan (no error boundary)

- Date: 2026-06-20 · PR: (pending) · Area: mobile
- Symptom: ~3 of 8 price-tag scans showed a blank white screen with no processing; the only way out
  was killing and relaunching the app.
- Root cause: a throw during render (a malformed parsed tag / unexpected OCR shape) unmounts the
  React subtree; in a release build that leaves a blank screen with no recovery path. The async
  `runOcr` had a try/catch, but a *render-time* throw bypasses it entirely, and there was no error
  boundary above the screen.
- Fix: wrap the screen in a reusable `ScreenErrorBoundary` (`getDerivedStateFromError` → recoverable
  "try again" card that remounts the children). Also hardened the no-text/OCR-failure path to drop
  the user into a blank, editable manual-entry card instead of dead-ending.
- Files: `src/components/ScreenErrorBoundary.js` (new), `src/screens/PriceTagScanScreen.js`
  (`PriceTagScanScreenInner` wrapped; `runOcr` fallback).
- Detect next time: a screen that can render data from OCR/parse/network with no boundary above it.
- Prevent: error boundary is the standing cure for the "white screen, must restart" class — wrap any
  screen whose inputs can be malformed.

## 36. New stateful table → green-first-run, red-rerun CI (shared Preview branch not cleaned)

- Date: 2026-06-20 · PR: #95 · Area: backend / tests
- Symptom: Backend CI went green on the first run after a migration, then RED on the very next run
  (and locally on every rerun) with `status is pending` → got `flagged_review`, and
  `settle.settled` expected `true` got `false`. No code changed between runs.
- Root cause: the migration added two *accumulating* tables — `tag_scan_attempts` (rule-6 re-scan
  counter) and `tag_credit_settlements` (rule-4 once-per-pool-per-week election). The DB-gated tests
  all share ONE persistent Neon Preview branch (never reset). Their cleanup only revoked
  `price_points`, so the attempt counter kept climbing across runs (tripping the abuse threshold →
  `flagged_review`) and last run's settlement row blocked the next payout (`already_verified`). The
  first post-migration run passed only because both tables started empty.
- Fix: clear the new tables for each test's `(device, sku, scope)` in setup/teardown
  (`clearTagState` in `crowdsourceDb.test.js`; `cleanup({subs,devices,skus})` in
  `tagCreditsEngineDb.test.js`), deleting `tag_scan_attempts` by `device_hash` and
  `tag_credit_settlements` by `product_id`.
- Detect next time: a migration that adds a counter/ledger/election table AND a test that asserts a
  "first time" outcome (pending / first-payout / not-yet-flagged). Run the suite TWICE locally
  (`node --env-file=.env --test tests/<file>.test.js` back-to-back) — green-then-red = leftover state.
- Prevent: every new mutable table on the shared Preview branch needs a scoped delete in test
  cleanup. Reruns must be idempotent; "passed once" is not "passes". See memory
  `neon-tests-preview-branch-only`.

## 37. A price drop hid the whole receipt from the "Watching" tab (aggregate state evicted still-tracked lines)

- Date: 2026-06-21 · PR: (pending) · Area: mobile
- Symptom: when one line on a receipt dropped, the entire receipt vanished from the Tracking
  tab's **Watching** chip and showed only under **Alerts** — even though its other lines were
  still being actively tracked (in-window, unclaimed, no drop).
- Root cause: the Receipts-view filter computed a single receipt-level `activeAlert` from the
  *aggregate* `r.priceDrop` (the max-savings drop across the receipt) and made watching =
  `!activeAlert`. The two states were mutually exclusive at the receipt grain, so any one drop
  evicted the whole receipt from watching. The Products view was already correct (per-item).
- Fix: derive watching/alerts INDEPENDENTLY from item state — a receipt matches **alerts** if
  ≥1 line has an active drop, and **watching** if ≥1 line is still tracked
  (`watchEnabled !== false && !claimed && !priceDrop?.detected`). The two can be true at once.
  Extracted the logic into the pure, exported `receiptMatchesChip(receipt, filter)` so it's unit-tested.
- Files: `src/screens/ReceiptsScreen.js` (`receiptMatchesChip`), `__tests__/screens.test.js`.
- Detect next time: any UI that buckets a parent (receipt/order) by an *aggregate* of child state
  when the children have independent lifecycles.
- Prevent: when children carry their own state (item-level `priceDrop`/`claimed`/`watchEnabled`),
  categorize the parent by ANY-child predicates, not a rolled-up single value. Buckets that should
  overlap must be computed independently, never as `A` vs `!A`.

## 38. Price-drop push only fired on the daily cron → "I had to refresh to get notified"

- Date: 2026-06-21 · PR: (pending) · Area: backend
- Symptom: eggs had been discounted for 1–2 days but no notification arrived; the drop only
  appeared after the user manually pulled-to-refresh (which hits the in-app verified-price lookup).
- Root cause: the verified-drop push is sent by `runVerifiedDropSweep`, which only ran (a) on the
  scheduled sweep — default `PRICE_SWEEP_INTERVAL_MINUTES` = **1440 (once a day)** — and (b) after a
  flyer import (admin-only). A *crowd/tag* observation or a freshly-scanned *receipt* that tipped a
  drop over the rule-of-N (or an instantly-verified admin price) sat unnotified until the next daily
  tick. Nothing swept on new observation ingestion.
- Fix: fire a region-scoped sweep moments after any new price observation lands — debounced +
  non-blocking via `scheduleVerifiedDropSweep(region)` in `server.js`, wired into the tag-scan route,
  the crowd warehouse-prices ingestion (`/api/watch`), and receipt create (`POST /api/receipts`).
  Also made the notifier's overlap guard **per-region** (`_sweepRunning` Set keyed by province, `*` =
  all) so a sweep running for one province no longer suppresses a fresh drop in another.
- Files: `backend/server.js` (`scheduleVerifiedDropSweep` + 3 call sites),
  `backend/priceDropNotifier.js` (per-region guard).
- Detect next time: a user-visible event that depends on a long-interval cron with no event-driven
  trigger on the write that produces it.
- Prevent: when "ASAP" matters, trigger the consumer off the producing write (debounced), and keep
  the cron only as the backstop. The sweep is idempotent (dedupe ledger) so extra triggers are safe.

## 39. Receipt showed subtotal > total (impossible) with no second pass

- Date: 2026-06-21 · PR: (pending) · Area: mobile
- Symptom: a scanned receipt displayed a subtotal (sum of item line-totals) GREATER than the total —
  mathematically impossible (tax is additive) — and the result was shown as-is.
- Root cause: `extractTotal` accepts a printed-total candidate down to `floor * 0.9` (10% under the
  items sum), so a mis-read TOTAL line (a discount/return line, a smudged figure) could land below
  the subtotal and slip through. The pipeline DID detect this (`isInconsistent` rule 2) and HAD a
  second pass (`reconcileWithLLM`), but that pass is gated behind the opt-in, currently-dormant
  `ocrLlmFallback` flag — so for most users no second pass ran and the impossible result rendered.
  The screen only offered a manual "Auto-fix" the user had to notice and tap.
- Fix: added an **always-on, no-network** sanity guard `reconcileTotalsLocally(parsed)` run
  unconditionally at the end of `scanReceipt` (after any LLM pass). When `total < itemsSum` it raises
  the total to `itemsSum + tax` — the same remedy as the manual Auto-fix button — and flags
  `totalReconciled`. Safe: fires only on a hard impossibility and only ever raises the total to the
  floor it must satisfy.
- Files: `src/services/ocrService.js` (`reconcileTotalsLocally`), `src/services/receiptParser.js`
  (called in `scanReceipt`), `__tests__/ocrServiceLogic.test.js`.
- Detect next time: any computed/parsed result with an internal invariant (subtotal ≤ total,
  parts sum to whole) shown to the user without an unconditional validation pass.
- Prevent: validate domain invariants locally before display; don't rely on an opt-in/best-effort
  remote pass to catch impossibilities. A cheap local guard should always backstop the LLM path.

## 40. Back didn't return to the exact previous screen (scan-mode switch used replace())

- Date: 2026-06-21 · PR: (pending) · Area: mobile (navigation)
- Symptom: after switching scan modes (Receipt → Barcode via the top segmented switcher),
  pressing back jumped straight to the entry tab, skipping the Receipt scan the user had just
  come from. The "back returns to the exact previous screen" guarantee was violated for the scan
  flow.
- Root cause: `ScanModeSwitcher` called `navigation.replace(route)`, which swaps the current
  screen out of the stack instead of pushing — so the previous mode was dropped from history and
  back popped past it. A prior nav audit deliberately chose `replace` (treating modes as
  "siblings"), but that contradicts an exact-history back guarantee.
- Fix: switch to `navigation.navigate(route)` (a push). Back now walks the real mode history
  (Barcode → back → Receipt → back → tab). React Navigation de-dupes by route name, so toggling
  between two modes pops back to the existing instance rather than growing the stack unbounded.
- Files: `src/components/ScanModeSwitcher.js`, `__tests__/scanModeSwitcher.test.js` (guards that an
  inactive mode tap calls `navigate`, never `replace`).
- Detect next time: any "back went somewhere unexpected" report — look for `replace`/`reset`/
  `popToTop` or `navigate("Tab", { screen })` on a path the user would expect to be reversible.
- Prevent: default to `navigate` (push) for forward moves; reserve `replace`/`reset` for genuine
  flow restarts (sign-out → Splash, onboarding → Main) where the prior screen must NOT be reachable.

## 41. App crashes opening the original receipt PDF/file (Android `FileUriExposedException`)

- Date: 2026-06-21 · PR: (pending) · Area: mobile
- Symptom: tapping **Open Original PDF / Open Original File** on the receipt Detail (claim)
  page restarts and crashes the app on Android. Sentry shows:
  `file:///data/user/0/ca.priceback.app/cache/DocumentPicker/<uuid>.pdf exposed beyond app
  through Intent.getData()`.
- Root cause: the button handed a **local `file://` URI** (`receipt.originalFileUri`, set in
  `ScanScreen.js` straight from the DocumentPicker cache path) directly to an external app via an
  Intent — first `WebBrowser.openBrowserAsync(uri)` (a Custom Tabs intent), then
  `Linking.openURL(uri)`. Since Android N, passing a raw `file://` URI across an app boundary
  throws `FileUriExposedException` and crashes the process. The URI must be a `content://` URI
  vended by a `FileProvider`.
- Fix: in `DetailScreen.js`, branch on scheme. **Remote** `http(s)` URLs keep
  `WebBrowser.openBrowserAsync`. **Local** files go through `expo-sharing`
  (`Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle })`), which routes the file through a
  FileProvider `content://` grant and presents the OS "Open with" sheet — no crash, no new
  dependency (pattern already used in `StoresAndProfileScreens.js` data-export and
  `services/exportService.js`). Every branch stays wrapped in try/catch and degrades to the
  existing `alert.cantOpenFile` alert.
- Files: `src/screens/DetailScreen.js` (the "Open Original" `TouchableOpacity` onPress).
- Detect next time: any "app crashed opening / sharing a file" report → grep Sentry for
  `exposed beyond app through Intent`. It always means a `file://` URI was handed to another app.
- Prevent: never pass a `file://` URI to `Linking.openURL` / `openBrowserAsync` / a raw Intent;
  for local files use `expo-sharing` (or `FileSystem.getContentUriAsync` + a `content://` Intent).

## 42. Migrating to a fresh Postgres provider fails: no `priceback` schema, unqualified raw SQL breaks

- Date: 2026-06-21 · PR: (pending) · Area: backend
- Symptom: pointing `DATABASE_URL` at a brand-new Supabase project and running `npm run db:migrate`
  dies with `schema "priceback" does not exist`. After hand-creating the schema, DB-gated tests
  then fail with `relation "app_config" does not exist` (and similar) even though the table exists
  in `priceback`.
- Root cause: two pieces of setup that lived **out-of-band on the old Neon DB** (not in the repo) were
  silently relied upon. (1) `0000_initial.sql` jumps straight to `CREATE TABLE "priceback".…` — it
  never created the schema; Neon's schema had been made manually long ago. (2) The old Neon role had a
  `search_path` default that included `priceback`, so the test helpers + `scripts/migrate-json-to-db.js`
  that issue **unqualified** raw SQL (`DELETE FROM app_config …`) resolved fine. A fresh Supabase
  `postgres` role has neither.
- Fix: (1) prepend an idempotent `CREATE SCHEMA IF NOT EXISTS "priceback";` to `0000_initial.sql`
  (safe for already-migrated DBs — drizzle applies by journal timestamp, and `IF NOT EXISTS` is a
  no-op). (2) Pin the `search_path` per pooled connection in `db/client.js`
  (`pool.on("connect", c => c.query("SET search_path TO priceback, public"))`) — a post-connect `SET`,
  NOT the startup `options` param the Neon pooler rejected, so it works on the Supabase session pooler.
  Requires a **session** pooler (5432), not a transaction pooler.
- Files: `backend/db/migrations/0000_initial.sql`, `backend/db/client.js` (`getPool`).
- Detect next time: a green test suite on the old provider that goes red with `does not exist` errors
  the moment `DATABASE_URL` is swapped → the new DB lacks schema/search_path setup the old one had.
- Prevent: keep ALL bootstrap (schema creation, search_path) in the migration/client code, never as
  manual DB console state. Provider swaps should be `DATABASE_URL`-only.

## 43. Post-"Reset All Data" credits stayed hidden (app-clock vs DB-clock skew)

- Date: 2026-06-21 · PR: (pending) · Area: backend
- Symptom: after a user resets their data, a credit earned **immediately afterward** never appears in
  the ledger (`creditsRepo.listForUser` returns it as empty). Surfaced as a test failure
  (`usersRepoDataRights` "post-reset movement is visible", 0 ≠ 1) only after moving the test DB to
  Supabase; was latent on Neon.
- Root cause: `usersRepo.resetData` stamped the cutoff marker `users.data_reset_at` from the **app
  server clock** (`new Date()`), while `credit_ledger.created_at` defaults to the **DB clock**
  (`now()`). `listForUser` hides rows with `created_at <= data_reset_at`. When the app server's clock
  runs ahead of the DB's (any skew — common across hosts/regions), the post-reset row's DB `created_at`
  lands *before* the app-clock marker and is hidden. Neon's clock happened to stay behind the local
  machine; Supabase's didn't.
- Fix: stamp `data_reset_at` from the **DB clock** too — `dataResetAt: sql\`now()\`` in the `resetData`
  transaction — so both sides of the comparison come from one clock and ordering is guaranteed.
- Files: `backend/repos/usersRepo.js` (`resetData`).
- Detect next time: any "X created right after a timestamped cutoff is missing/hidden" bug → check
  whether the cutoff and the compared timestamp come from the **same** clock (both DB `now()` or both
  app `new Date()`), never one of each.
- Prevent: never compare an app-generated timestamp against a DB-generated one. Generate cutoff markers
  with the same clock as the column they gate.

## 44. DB-gated CI suite fails with `EMAXCONNSESSION` after moving tests to Supabase

- Date: 2026-06-21 · PR: (pending) · Area: backend / CI
- Symptom: after pointing the CI `DATABASE_URL` secret at the Supabase dev project, the Backend
  (node:test) job goes red. Many `/api/me/*` and `POST /api/receipts` tests fail with HTTP 503 or a
  failed `before` hook; the real error in the log is
  `[db] seedLookups failed: (EMAXCONNSESSION) max clients reached in session mode - max clients are
  limited to pool_size: 15`. Passed for years on Neon.
- Root cause: the Supabase **session pooler** enforces a hard total-connection ceiling (15 on the dev
  tier). `test:coverage` runs `node --test --test-concurrency=4`, which spawns one child process per
  test file (up to 4 at once); each process opens its own singleton `pg` pool with `max: 5`, so peak
  demand is 4 × 5 = 20 > 15. Neon's pooler allowed far more connections, so the over-subscription was
  invisible until the cutover.
- Fix: make the pool cap env-driven — `max: Number(process.env.DB_POOL_MAX) || 5` in `db/client.js`
  (production stays at 5) — and set `DB_POOL_MAX=3` in the CI `.env` so 4 × 3 = 12 < 15.
- Files: `backend/db/client.js` (`getPool`), `.github/workflows/test.yml` (Provision .env step).
- Detect next time: any `EMAXCONNSESSION` / "max clients reached in session mode" → count
  `test-concurrency × pool max` and compare against the pooler's ceiling.
- Prevent: when sizing a pool against a managed pooler, keep `(parallel processes) × (pool max)` under
  the pooler's connection ceiling; never assume the new provider's limit matches the old one's.

## 45. Phantom credit balance (e.g. 300) after "Reset All Data" with no DB access

- Date: 2026-06-21 · PR: (pending) · Area: mobile · Parent class: see #28
- Symptom: after wiping local data with the backend/DB unreachable, the balance showed a stale
  fabricated number (300) instead of 0 / "unavailable".
- Root cause: `storageService.clearAllData()` removed `[RECEIPTS_KEY, PREFS_KEY, TAG_SCAN_LOG_KEY,
  ACCOUNT_CACHE_KEY]` but **not** `last_known_credit_balance_v1` (nor the offline-scan log) owned by
  `purchaseService`. The balance is server-authoritative, but the offline-scan gate keeps a read-only
  "last known balance" snapshot to permit scans while offline. With the snapshot left behind, when the
  server can't be reached `canAddReceipt()` falls into its offline branch and reports the **stale
  snapshot** as the live balance.
- Fix: added `purchaseService.clearLocalCreditCache()` (multiRemove `LAST_KNOWN_BALANCE_KEY` +
  `OFFLINE_SCAN_LOG_KEY`); `clearAllData()` now calls it via dynamic import (avoids the cycle).
- Files: `src/services/purchaseService.js`, `src/services/storageService.js`.
- Detect next time: any "reset left a stale/fabricated value" bug → grep every `*_KEY` an
  AsyncStorage-backed value writes and confirm `clearAllData()`/reset clears ALL of them, not just the
  obvious ones. Caches owned by a *different* service are the usual miss.
- Prevent: when a service adds a persisted key, it must also expose a reset that `clearAllData()` calls.

## 46. Backend/DB unreachable failed silently — no error on screen, none in Sentry

- Date: 2026-06-21 · PR: (pending) · Area: mobile
- Symptom: after the Supabase cutover a fresh signup "saved nothing" — balance blank, no data — yet
  there were zero Sentry errors and no on-screen message. (Compounded by the build pointing at a
  different backend/DB than was being inspected — see `docs/Environment_Configuration.md`.)
- Root cause: client read/write helpers swallow non-2xx + network errors and return `null`
  ("unknown"), by design (so a transient blip never shows fake data). But nothing surfaced the
  *unreachable backend* state to the user, and the only connectivity check pinged Google's
  `generate_204` — i.e. it detected **internet**, not whether **PriceBack's backend** was reachable.
- Fix: HomeScreen now also probes `${priceApiUrl}/health` when the internet is up and shows a distinct
  "Can't reach PriceBack servers" banner (`home.backendDown`) when the backend is unreachable or the
  API URL is unset/placeholder. MembershipCard shows a spinner (not a bare "—") while the first balance
  fetch is in flight.
- Files: `src/screens/HomeScreen.js`, `src/components/ProfileKit.js`, `src/services/i18n.js`.
- Note: `/health` is a cheap liveness check and returns 200 even if that service's DB is down — a
  cleared banner does not by itself prove the DB is reachable.
- Detect next time: "it failed but nothing told me" → check whether the failure path returns
  null/no-op silently AND whether any UI reflects the degraded state. Internet ≠ backend reachability.

## 47. Android 12+ native splash showed a "screenshot as an icon"

- Date: 2026-06-21 · PR: (pending) · Area: mobile / config
- Symptom: the native splash (before JS loads) showed a tiny shrunk screenshot in the icon slot instead
  of the app logo. Regression from commit 673290b ("give Android the full branded native splash").
- Root cause: that commit set `android.splash.image` to the full-screen `splash-screen.png`
  (1284×2778). On Android 12+ the OS SplashScreen API only renders a **centered, cropped icon** — a
  full-screen image gets scaled into the icon window and looks like a cropped screenshot. iOS uses a
  full-bleed launch storyboard, so the full image was fine there; the bug was Android-only.
- Fix: pointed `android.splash.image` back at the square brand glyph `./assets/splash-icon.png` (the
  same glyph the JS splash rests on), keeping `resizeMode: contain` + `#eef5f1`.
- Files: `app.json`.
- Detect next time: Android native splash looking wrong → the `android.splash.image` must be a
  centered square logo with transparent padding, NOT a full-screen/marketing image. Android 12+ ignores
  full-bleed splash images.

## 48. Price-tag scan stuck on a white screen on poor WiFi ("Reading the tag…" never showed)

- Date: 2026-06-22 · PR: (pending) · Area: mobile / OCR
- Symptom: in-store (Costco WiFi is frequently slow/captive), capturing a price tag showed a blank
  white screen instead of the "Reading the tag…" loader, and never progressed. Felt like a freeze.
- Root cause: `ocrService._visionFetch` issued the Google Vision `fetch` (backend `/api/ocr` proxy or
  direct) with **no timeout / AbortController** — unlike `reconcileWithLLM`, which already aborted at
  20s. On a stalled connection the request hung indefinitely, so `PriceTagScanScreen`'s
  `step="scanning"` state never resolved and the user sat on the loader forever.
- Fix: wrapped both fetch paths in an `AbortController` with a 25s ceiling (`OCR_FETCH_TIMEOUT_MS`);
  on abort it throws a managed "Weak connection — the scan timed out…" error so the existing `runOcr`
  catch drops the user into the editable manual-entry card. Also added a delayed "connection looks
  slow…" sub-line + a **Cancel** affordance on the scanning screen so it never *looks* frozen. The
  receipt flow gets the same protection for free (same function).
- Files: `src/services/ocrService.js`, `src/screens/PriceTagScanScreen.js`, `src/services/i18n.js`.
- Detect next time: any user-facing network call that gates a loading state MUST have a timeout/abort.
  A bare `fetch` can hang forever; always pair it with an `AbortController` (grep for `fetch(` without
  a nearby `signal`).

## 49. OCR tax larger than the subtotal (impossible) reaches the user

- Date: 2026-06-23 · PR: (pending) · Area: mobile / OCR
- Symptom: a scanned receipt showed a **tax bigger than the subtotal** (e.g. items $80,
  tax $95), or a tax far above any Canadian rate — an impossible result the user had to
  spot and hand-fix.
- Root cause: `extractTax` reads whatever amount sits on the tax line; a smudged/garbled
  OCR digit (or grabbing the wrong line) can yield a tax that exceeds the subtotal. There
  was no upper bound — `reconcileTotalsLocally` only fixed `total < subtotal`, not the tax.
- Fix: a new always-on **`receiptValidator.validateReceipt`** (run in `scanReceipt` before
  display) caps tax at the **province's combined sales-tax rate × subtotal** (QC ≈15%, ON
  13%, AB 5%, …) and recomputes the total. Province is resolved from the printed Costco
  warehouse code (`provinceFromWarehouseId`, bundled `costcoWarehouses.js`) → the user's
  profile province → else the national max (QC) so only egregiously-wrong taxes are clamped.
  Auto-fixed silently (per product decision).
- Files: `src/services/receiptValidator.js` (new — `PROVINCE_TAX_RATES`, `maxTaxFor`,
  `validateReceipt`), `src/services/receiptParser.js` (`scanReceipt` wiring). See also #39.
- Detect next time: assert `tax <= rate × subtotal` in the parser tests; a receipt whose
  tax/subtotal ratio exceeds the province rate is a parse error, not a real receipt.
- Prevent: `__tests__/receiptValidator.test.js` pins the cap per province + the unknown-
  province fallback.

## 50. Refund/return receipt logged with POSITIVE prices (or silently rejected)

- Date: 2026-06-23 · PR: (pending) · Area: both
- Symptom: scanning a **refund/return** receipt parsed the returned items as **positive**
  purchases (looked like a normal buy), or — for the cases the strict Costco gate caught —
  was rejected outright so nothing was logged.
- Root cause: the parser is built around positive amounts and **skips** trailing-minus
  lines; only a narrow Costco gate (`isRefundReceipt && countPurchaseLines === 0`) handled
  refunds, and it rejected them. Other shapes (generic stores, the `G-3-Refund` fixture
  with `APPROVED - REFUND` + negative subtotal) slipped through and were read as positive.
- Fix: `isRefundText` (definitive markers only — `APPROVED-REFUND`, `ITEMS SOLD = -N`,
  negative SUBTOTAL/TOTAL/AMOUNT, incl. Costco's split label/amount layout — **no**
  "lots of negatives" heuristic, which false-positives on TPD-heavy normal receipts) routes
  a refund to **`parseRefundReceipt`**: strip the trailing minus, drop TPD/CPN rows, parse
  with the generic engine, then **negate every amount**. The refund is **accepted** (not
  rejected), flagged `isRefund`/`trackable:false`, and **never price-watched**. Backend
  `receiptsRepo.create` skips `recordReceiptPricePointsBulk` when `isRefund` (or all-negative
  lines) so negative prices can't pollute the crowdsourced/verified pricing pool; ScanScreen's
  save filter keeps negative lines for refunds and shows a "Refund" badge.
- Gotcha (caused a 500): `receipt_items.product_id` is **NOT NULL**, so skipping the price-point
  bulk path alone leaves every refund line with a null `product_id` → insert fails. Refunds
  must still **`upsertProduct`** per line (product rows only, no price_points) to satisfy the FK.
  Caught by `receiptPricePoints.test.js` running against the Supabase **dev** DB.
- Files: `src/services/receiptParsingShared.js` (`isRefundText`, `parseRefundReceipt`),
  `ocrService.js` + `costcoReceiptParser.js` (dispatch), `src/screens/ScanScreen.js`,
  `storageService.js`, `receiptSyncService.js`, `backend/repos/receiptsRepo.js`,
  `backend/server.js`.
- Detect next time: a refund must produce `isRefund:true`, all `items[].price < 0`,
  `total < 0`, and **zero** `price_points` rows server-side.
- Prevent: refund cases in `__tests__/receiptParsingShared.test.js`,
  `costcoReceiptParser.test.js`, the real-OCR `G-*-Refund` fixtures, and the backend
  `receiptPricePoints.test.js` "refund records NO price points" test.

## 51. Flyer scan extracted ZERO offers + imported flyer dates landed NULL/wrong

- Date: 2026-06-25 · PR: (pending) · Area: backend
- Symptom: every admin flyer-scan upload returned 0 offers though a page had 6+;
  separately, every imported/committed flyer row had a wrong `valid_from`
  (the import-week Monday) and a `NULL` `valid_until`, so the flyer's printed
  validity window never reached `price_points`.
- Root cause (two independent bugs):
  1. **Extraction** went straight to multimodal **Gemini** (`flyerScanService`),
     which silently returned nothing on real pages — there was no deterministic
     fallback and no parity with the proven price-tag OCR pipeline.
  2. **Dates** were never threaded: `commitFlyerImport()` built the
     `recordPricePointsBulk` rows WITHOUT `validFrom`/`validUntil`, and
     `recordPricePoint` ALWAYS derived `valid_from = firstMondayOfWeekUTC()` and
     left `valid_until` null (rule 6/8). So even a correctly-dated offer lost its
     window on the way to the DB. `activeFlyerOffers` then matched on
     `valid_from == this week's Monday`, which only worked because of that derive.
- Fix:
  1. New deterministic parser `backend/services/flyerTextParser.js` mirrors
     `src/services/costcoTagScanner.js` (SKU-anchored tile segmentation + the same
     price/label/savings heuristics) plus a page-level **valid-from → valid-to**
     range parser. `flyerScanService.extractFlyerPage` now runs **Vision OCR +
     parse first** (shared `backend/lib/visionOcr.js`) and only falls back to
     Gemini when OCR yields zero offers.
  2. `commitFlyerImport` passes the offer's `validFrom`/`validUntil`;
     `recordPricePoint` accepts explicit dates and stores them verbatim (keeping
     the Monday-derive only when none are given). `activeFlyerOffers` is now a
     **date-range** query (`valid_from <= today <= valid_until|NULL`), scoped to
     the flyer source type so receipt/tag rows are unaffected.
- Gotcha: do NOT repurpose `valid_from` for the flyer's printed start while the
  active read still keys on Monday-of-week — change the read to a range query in
  the same commit, or active offers vanish. Also: the ON-CONFLICT update must only
  overwrite `valid_until` when the write carries one, so a crowd re-observation
  can't blank a tag's EXP date (rule 8).
- Files: `backend/services/flyerTextParser.js` (new), `backend/lib/visionOcr.js`
  (new), `backend/services/flyerScanService.js`, `backend/server.js`
  (`commitFlyerImport`, `/api/ocr` refactor, extract endpoint),
  `backend/repos/pricesRepo.js` (`recordPricePoint`, `activeFlyerOffers`).
- Detect next time: capture a real flyer fixture (`npm run capture:flyers`) and
  assert `parseFlyerText` returns ≥6 offers each with `sku`+`promoPrice`; assert a
  committed flyer `price_points` row carries the printed `valid_from`/`valid_until`
  and that `activeFlyerOffers` includes it in-window and excludes it past it.
- Prevent: `backend/tests/flyerTextParser.test.js`, `flyerScanService.test.js`,
  `flyerDatePersistenceDb.test.js` (Supabase **dev**), `visionOcr.test.js`.

## 52. main CI flakes red on `EMAXCONNSESSION` — DB tests can't grab a connection

- Date: 2026-06-25 · PR: (pending) · Area: backend (CI)
- Symptom: a batch of DB-gated backend tests fail together on a push to main
  (e.g. 8 barcode/device-sync cases at once), all with
  `(EMAXCONNSESSION) max clients reached in session mode - max clients are
  limited to pool_size: 15`. The stack bottoms out in `seedWarehouses` /
  `seedLookups` (the first DB touch), or a request returns a transient **503**.
  Different tests fail on different runs — the signature of a shared-resource
  blip, not a code regression.
- Root cause: the DB-gated suites run against ONE shared Supabase **dev** session
  pooler whose total client cap (15) is SHARED with the always-on
  `priceback-development` Railway pool AND any local dev backend. CI uses only
  `DB_POOL_MAX=3` at `--test-concurrency=1`, but when a neighbour (a local
  `npm start`, a second service) is briefly holding connections, CI can't grab
  even its first one. The seed path already retried, but the OLD budget
  (4 attempts × 750 ms ≈ 4.5 s) gave up before the multi-second saturation
  window cleared.
- Fix: widen the retry budget in `seedWithRetry` (`backend/db/client.js`)
  defaults from 4×750 ms to **6×1000 ms linear (≈15 s)** so the suite rides out
  the saturation window. NOT a pool change — `DB_POOL_MAX` must stay ≥3 (a
  redeem/credit txn calls `lookupId`, checking out a 2nd connection; <3
  deadlocks). The pool isn't reset between tries; pg re-dials on the next acquire.
- Gotcha: this is environmental — **re-run the failed job first** (it usually
  goes green). Don't "fix" it by lowering `DB_POOL_MAX` below 3 or by pointing CI
  at prod. If it keeps recurring, widen the budget further before touching the
  pool. A route-level 503 under the same contention is the request-path sibling.
- Files: `backend/db/client.js` (`seedWithRetry` defaults + comment),
  `.github/workflows/test.yml` (serial DB tests, `DB_POOL_MAX=3`).
- Detect next time: the failing tests vary run-to-run and the error text contains
  `EMAXCONNSESSION` / `max clients reached`; `isTransientDbError` already
  classifies it (tested in `transientDbError.test.js`).
- Prevent: `backend/tests/transientDbError.test.js` asserts the retry exhausts
  the budget and that `EMAXCONNSESSION` is transient; CI serializes the backend
  job repo-wide (`concurrency: backend-db-tests`, `cancel-in-progress: false`).

## 53. Credit pack grants the OLD credit amount after you change it (e.g. 250 shows/grants 300)

- Date: 2026-06-25 · PR: (none — diagnosis only) · Area: backend (config cache) + DB seed
- Symptom: a credit pack's `credits` was lowered in `shared/pricing.config.js`
  (Starter 300 → 250) and tests updated, but a real purchase still granted 300,
  and the paywall still **displayed** 300 — even after the `credit_packs` DB row
  was corrected to 250 by hand. "It still shows 300."
- Root cause (two independent stale layers, neither is the config file):
  1. **Backend in-memory warm cache.** The grant amount is server-authoritative:
     `POST /api/me/credits/topup` reads `configService.getDerivedMaps().ALL_PACKS`,
     a snapshot loaded from the DB by `configService.warm()` at boot. It does NOT
     re-read the DB per request. After you change the row, the running backend
     keeps serving the old value **until the next `startAutoRefresh()` tick**.
  2. **Mobile pricing cache.** `pricingCatalogService` applies the last cached
     `/api/v1/pricing.json` from AsyncStorage immediately on launch, then races a
     fresh fetch. So the app shows the stale catalog for the first moments / until
     a successful refresh.
- Why it self-heals: `configService.startAutoRefresh()` re-warms the snapshot
  **every 5 minutes** (`backend/server.js` `startServer()` → `.finally(startAutoRefresh)`),
  and the mobile re-fetches `pricing.json` on the next launch. So after ~5 min the
  backend grants the correct amount and the app catches up. The Starter case above
  resolved itself once the 5-min tick fired — **no code change was needed.**
- Fix / how to force it immediately (don't wait 5 min):
  - Backend: redeploy/restart the Railway service (re-runs `warm()` at boot), or
    wait one refresh interval.
  - Mobile: relaunch the app (re-fetches `pricing.json`); a cold cache will also
    fall back to the bundled `shared/pricing.config.js`, which is correct after edit.
- LATENT seed trap (separate, still unfixed as of this entry): `seedCreditPacks`
  in `backend/db/seed.js` upserts credits with
  `credits: coalesce(${creditPacks.credits}, excluded.credits)` — i.e. it KEEPS
  the existing DB value and only fills from the catalog when the row is NULL. So
  **re-seeding can never correct a stale non-null `credits`/`price`** from the
  config (the documented single source of truth). The DEV row was already 250;
  **PROD likely still holds the old 300** and a re-seed won't fix it — correct it
  by hand or switch the upsert `set` to `excluded.credits`/`excluded.price`
  (catalog-authoritative) when prod is next touched.
- Detect next time: the config file says X but a purchase grants Y, and `GET
  /api/v1/pricing.json` (or `select credits from credit_packs`) still shows Y. The
  config file is rarely the liar — check the warm cache age and the DB row.
- Files: `backend/config/configService.js` (`warm`/`startAutoRefresh`/`getDerivedMaps`),
  `backend/server.js` (`startServer` warm wiring), `backend/db/seed.js`
  (`seedCreditPacks` coalesce trap), `src/services/pricingCatalogService.js`.

## 54. Photographed (in-club) Costco refund parsed as garbage / not detected as a refund

- Date: 2026-06-25 · PR: (pending) · Area: mobile (receipt parser)
- Symptom: a **photographed** Costco return (not the website PDF) either wasn't
  recognized as a refund at all, or produced positive phantom items ("93 PHARMACY
  $13.99", "01 APPROUVEE - MERCI $218.87") with a wrong total. The PDF refunds
  (`G-*-Refund`) parsed fine; the phone photos did not.
- Root cause: the in-club register receipt differs from the website-PDF export.
  1. It prints a **"REFUND / MEMBERSHIP"** transaction header the PDF omits, and
     prints its **reversed coupons / VOID reversals as POSITIVE** ("5.00 H",
     "13.99 H"). So `countPurchaseLines()` > 0 and the refund gate
     (`countPurchaseLines === 0 && isRefundText`) fell through to the warehouse
     parser, which read the whole thing as a (broken) purchase.
  2. The payment amount is French ("MONTANT: $218.87-") — `isRefundReceipt` only
     matched English "AMOUNT".
  3. Even once routed to the refund path, the coupon reversal "706359 CPN / E /
     RETUNR 5.00-" (slashes + OCR spaces in the ref) wasn't matched by the TPD/CPN
     handler, the VOID (kept whole on one geometry line) wasn't applied, and the
     PII scrub's orphan "ITEM #" label folded into product names.
- Fix: `isRefundHeader()` (the "REFUND / MEMBERSHIP" header) routes to the refund
  path **on its own** — a purchase never carries it, so `countPurchaseLines` is
  irrelevant. `isRefundReceipt` also matches French "MONTANT …-".
  `refundToPurchaseText` mirrors a post-VOID positive reversal into a NEGATIVE
  cancellation (so the shared VOID logic removes the duplicate); the CPN/TPD
  handler tolerates slashed/spaced refs and falls to PLAN-B (most-recent item);
  `extractItems` handles a single-line VOID cancellation; `cleanItemName` strips
  the orphan "ITEM #<n>" label.
- Gotcha: the committed-fixture **PII scrub** (`scripts/captureReceiptOcr.js`,
  `scrubWords` drops ≥10-digit tokens) deletes the `ITEM # 000001872112` numbers,
  so the photographed refund's items have **no SKU** — and a VOID can cancel the
  only line carrying an inline SKU. Pin/lookup those lines **by name**, not SKU.
- Capture note: running `npm run capture:receipts` from this Windows box needs
  `node --use-system-ca scripts/captureReceiptOcr.js` — the AVG TLS-intercepting
  proxy makes plain Node reject Vision's cert ("unable to verify the first
  certificate"). This is the previously-noted "capture fails from this env" cause.
- Files: `src/services/costcoReceiptParser.js` (`isRefundHeader`, gate, CPN regex),
  `src/services/receiptParsingShared.js` (`refundToPurchaseText` VOID mirror,
  `extractItems` single-line VOID, `cleanItemName` ITEM# strip),
  `scripts/captureReceiptOcr.js` + `__tests__/costcoReceiptParser.realocr.test.js`
  (also walk `__tests__/fixtures/Refunds/`).
- Detect next time: a refund photo must give `receiptKind:"refund"`, all
  `items[].price < 0`, `total < 0`, reconcile to the printed total, and no item
  name containing "TPD"/"CPN".
- Prevent: the two committed `Refunds/*.vision.json` real-OCR fixtures + the
  header-routed VOID/CPN cases in `costcoReceiptParser.test.js`.

## 55. Barcode "Your purchase history" shows only the latest buy (older ones silently dropped) + missing i18n label

- Date: 2026-06-26 · PR: (pending) · Area: both
- Symptom: scanning a product barcode, the "Your purchase history" block shows
  only the most recent purchase even though the user bought the item several
  times; for some items it shows nothing with no obvious pattern. The section
  label also rendered from an inline English fallback (`t(key) || "…"`) with no
  French translation.
- Root cause: `priceHistoryForUserProduct` hard-capped results to the last
  **90 days** (`sinceDays = 90`), so any earlier purchase was silently excluded —
  a user whose buys are spread over a year sees "just the latest". The
  pattern-less *no-history* case is a separate data-coverage limit, not a code
  bug: history joins receipt items on `products.id`, so it only resolves when the
  scanned manufacturer **UPC is linked to the SKU product** (see the barcode
  harvester / `barcode-sku-linking`); unlinked barcodes can't match the user's
  SKU-keyed receipt items. The label `barcode.yourHistory` was never added to
  `i18n.js`, so it bypassed the EN/FR parity guardrail.
- Fix: made the window opt-in — `sinceDays` defaults to `null` (all-time) and is
  only applied when a positive number is passed, so ALL of the user's purchases
  return, newest first. Added `barcode.yourHistory` to both EN and FR tables and
  removed the inline fallback in `BarcodeScanScreen`.
- Files: `backend/repos/receiptsRepo.js` (`priceHistoryForUserProduct`),
  `src/services/i18n.js`, `src/screens/BarcodeScanScreen.js`,
  `backend/tests/priceHistoryDb.test.js` (all-time + explicit-window cases).
- Detect next time: `GET /api/me/price-history?sku=…` should return every
  non-refund purchase of that product for the user, not a 90-day slice.
- Prevent: the new all-time + `sinceDays` DB test cases; standing rule — never
  ship a `t()` key that isn't in i18n.js EN+FR (memory `no-unimplemented-labels`),
  enforced by the i18n parity test.

## 56. Flyer scan mis-pairs prices across columns + under-counts tiles ("an item over another", 6/8 found)

- Date: 2026-06-26 · PR: (pending) · Area: backend
- Symptom: scanning a flyer page, one tile's price was attributed to a different
  tile ("an item detected over another"), and only 6 of 8 tiles were extracted.
- Root cause: the deterministic parser (`flyerTextParser.parseFlyerText`) paired
  item numbers to price blocks by **document order** in the flat OCR text. On a
  multi-column page Vision streams every tile's top half (name + item#) before any
  of the price halves, so the k-th price block does NOT belong to the k-th item
  number in reading order — pairing by order leaks a price into a neighbouring
  tile and drops tiles whose block was consumed by someone else. A tile whose SKU
  prints with a range suffix (`1978560-5`) also got **no anchor** (the strict
  `^\d{6,8}$` rejected it), so its price bled into the tile above (e.g. Skoulakis
  `380848` showed the Gap tile's `$24.99` instead of its own `$18.99`).
- Fix: a NEW **geometry** path `parseFlyerWords(words)` that mirrors the price-tag
  parser — segment the page **spatially** from Vision word coordinates instead of
  trusting text order. Columns come from item-number x-positions; each tile is the
  column strip between the vertical midpoints to its neighbouring SKUs; the price
  is the first **x-aligned, vertically-tight** `was/-savings/promo` triplet
  (eco-fee lists and QC sub-prices are neither aligned nor satisfy
  `was−sav≈promo`, so they're ignored); the name is read only from the
  left-margin-aligned lines above the SKU (decorative product-photo captions sit
  to the side and are split off; SKU digits are stripped). Suffix SKUs are matched
  by their leading 6–8 digits; a tile with `regular > promo×2.5` (>60% off) is
  dropped as an OCR-mangled price column. Geometry is PRIMARY in
  `flyerScanService.extractViaVision` (`source:"vision-ocr-geometry"`), with the
  flat-text parser kept as the fallback when a response carries no word geometry
  (`lib/visionOcr.visionDataToWords` extracts/normalises the coordinates).
- Files: `backend/services/flyerTextParser.js` (`parseFlyerWords` + helpers),
  `backend/lib/visionOcr.js` (`visionDataToWords`),
  `backend/services/flyerScanService.js`, tests
  `backend/tests/{flyerTextParser,visionOcr,flyerScanService}.test.js`.
- Detect next time: on the frozen `Flyers-June-2026.vision.json`, `parseFlyerWords`
  must return ≥30 offers, every `regular−savings≈promo`, `380848`=18.99/4/14.99,
  the suffixed `1978560`=24.99/5/19.99, and 0 phantom SKUs — all asserted in the
  "real flyer GEOMETRY" regression test.
- Prevent: re-capture fixtures with `npm run capture:flyers` (freezes `words`);
  the geometry regression + the synthetic column-pairing / suffix-SKU / eco-fee /
  garbled-column unit tests guard the behaviour.

## 57. Price drop missed for a past/concurrent flyer + cheaper non-flyer source wins + refresh doesn't act

- Date: 2026-06-26 · PR: (pending) · Area: both
- Symptom: three related misses in verified price-drop detection. (a) A flyer
  sale that overlapped the buyer's 30-day adjustment window but ran/ended in the
  PAST never triggered a drop. (b) When sources disagreed, a cheaper crowd
  receipt/tag won over the authoritative flyer price (PriceBack bills off the
  flyer, so this over-stated savings). (c) Tapping "Refresh prices" showed a drop
  in-app but didn't record/charge/push it until the next daily sweep.
- Root cause: `priceDropRepo.findNotifiable` (a) filtered comparison prices by
  `observed_at` recency only and gated eligibility on `purchase_date +
  adjustment_days >= today` — the window was anchored on **today** and never
  looked at the price's own `valid_from`/`valid_until`, so a past sale window was
  invisible; (b) the `best` CTE picked the **global lowest verified price** with
  no source ranking; (c) the "Refresh prices" button only called
  `getLatestVerifiedPrice` for DISPLAY and never ran the verified-drop sweep.
- Fix: (a) eligibility is now a window OVERLAP between the price's
  `[valid_from, valid_until]` (NULL → today) and the purchase's policy window
  `[purchase_date, purchase_date + COALESCE(policy_window, adjustment_days, 30)]`,
  anchored on the **purchase date** — so present OR past windows count; freshness
  is relaxed so already-verified/admin/flyer rows survive past `windowDays`. (b) a
  `source_rank` (flyer 1/4 > tag 5 > receipt 2 > other) is computed and the
  comparison is picked per line as `DISTINCT ON (receipt_item_id) ORDER BY
  source_rank, price` — flyer-authoritative, and the actual-drop test runs AFTER
  tier selection so a non-dropping flyer suppresses the line (no fall-through).
  `getLatestVerifiedPrice` got the same ranking. (c) new `POST /api/me/check-drops`
  runs a user-scoped `runVerifiedDropSweep` immediately (same detection + billing
  as the cron, idempotent via the dedupe ledger); the mobile refresh calls it via
  `priceService.triggerDropCheck`. No DB migration (columns already existed).
- Files: `backend/repos/priceDropRepo.js` (`findNotifiable`, `getLatestVerifiedPrice`),
  `backend/priceDropNotifier.js` (`runVerifiedDropSweep` `userSub`),
  `backend/server.js` (`POST /api/me/check-drops`), `src/services/priceService.js`
  (`triggerDropCheck`), `src/screens/DetailScreen.js`.
- Detect next time: `priceDropWindowSourceDb.test.js` — flyer beats a cheaper
  verified tag, a non-dropping flyer suppresses the line, a fully-past and an
  after-purchase flyer both qualify in-window while out-of-window ones don't,
  NULL `valid_until` coalesces to today, an aged flyer still counts, and a
  user-scoped sweep pushes only that buyer.
- Prevent: the DB suite above + the route 401/503 test + the mobile
  `triggerDropCheck` unit tests; the window/priority rule is documented in the
  `findNotifiable` header. Open item: dropping the today-anchored gate means an
  expired-window receipt can notify once (per "detect in the past") — dedupe
  ledger caps it to one push per genuinely-new lower price.

## 58. No push notifications at all (drops, verified-tag credit, low balance, admin tag-review)

- Date: 2026-06-27 · PR: (pending) · Area: both
- Symptom: not a single server-sent push ever arrived on a real device, for any
  category — even on a native build with a valid EAS `projectId`.
- Root cause: the Expo push token was minted on-device and stored ONLY in
  AsyncStorage (`notificationService.registerForPushNotifications`). Nothing ever
  pushed it to the backend, so `users.push_token` stayed NULL. Every server send
  is then filtered out: `priceDropRepo.findNotifiable` requires
  `u.push_token IS NOT NULL`, and `sendUserPush` reads the token from the DB and
  bails when it's missing. `syncProfileToBackend`/`PUT /api/me/profile` already
  supported a `pushToken` field — it was simply never called with one.
- Fix: new `notificationService.syncPushTokenToBackend()` calls
  `syncProfileToBackend({ pushToken })` (lazy-imported to avoid the auth cycle).
  `registerForPushNotifications` calls it right after minting (no-ops when signed
  out at splash); `onSignInDone` + the boot/foreground `hydrateFromBackend` both
  back-fill it so an existing signed-in user's token reaches the DB. No migration
  (`users.push_token` already existed).
- Files: `src/services/notificationService.js`, `src/services/syncService.js`
  (`_hydrate` step 4), `src/screens/OnboardingScreen.js`.
- Detect next time: `notificationService.test.js` (token mint → sync called) +
  `syncServiceHydrate.test.js` (back-fill called on a signed-in hydrate, not when
  signed out). On-device: after sign-in, `users.push_token` must be non-NULL for
  that sub (check via a DEV query / `/api/me/bootstrap`).
- Prevent: any new server push goes through `sendUserPush`, which is only as good
  as `users.push_token` — confirm the token-sync paths still run on sign-in/boot.

## 59. Uninstall+reinstall: existing user treated as a NEW signup, all data "gone", referral re-prompt

- Date: 2026-06-27 · PR: (pending) · Area: mobile
- Symptom: after reinstalling and signing in with the SAME Google account, the
  user was pushed through new-user setup (postal/province/T&C) AND asked for a
  referral code, and the app showed no receipts/credits/history.
- Root cause: identity is fine — the backend keys users by the stable Google
  `sub` (`usersRepo.upsertFromOAuth`), so nothing was deleted. But `onSignInDone`
  decided routing from LOCAL prefs only (`getPrefs()`), which are wiped on
  reinstall → `profileComplete` false → routed to `SETUP_STEP`. It never asked the
  backend whether this account already existed. (Worse: the referral redeem there
  is creation-only — the backend rejects it once a profile exists, so the prompt
  was both wrong and futile.)
- Fix: `onSignInDone` now `await hydrateFromBackend({ reason: "signin" })` BEFORE
  routing; `_applyPrefs` was extended to restore `postalCode`/`province` from the
  bootstrap `profile` and set `profileComplete`/`onboardingComplete` (only ever
  set true) when the backend profile is complete. A returning user then lands
  straight on Main with receipts/credits/referral code/savings restored; a genuine
  new account (no backend profile) still gets SetupStep. Hydrate is best-effort, so
  an offline sign-in falls back to the prior behavior. No migration.
- Files: `src/screens/OnboardingScreen.js` (`onSignInDone`),
  `src/services/syncService.js` (`_applyPrefs` profile restore).
- Detect next time: `syncServiceHydrate.test.js` — a complete backend profile
  restores postal/province + marks complete; an incomplete one does not; a payload
  with no `profile` leaves local untouched.
- Prevent: never gate "is this a returning user?" on local prefs alone — they don't
  survive a reinstall. The backend (keyed by Google `sub`) is the source of truth.

## 60. Weak connection shows a misleading "Rate limit reached (30/hour, 200/day)" / 429

- Date: 2026-06-27 · PR: (pending) · Area: mobile
- Symptom: scanning on a flaky connection surfaced a raw "Rate limit reached
  (30/hour, 200/day)" (receipts) or "Couldn't read the tag" (tags) — neither
  reflecting the real cause (weak signal tripping the per-device OCR limiter via
  client retries).
- Root cause: `ocrService._visionFetch` threw the backend's raw error text for any
  non-OK status, and `PriceTagScanScreen`'s `isNetwork` regex didn't match
  429/rate-limit, so a throttle fell through to the "couldn't read" path.
- Fix: `_visionFetch` now detects `status === 429` and throws an accurately-worded
  error tagged `{ status: 429, code: "rate_limited" }` (mentions weak connection,
  no "30/hour" jargon). `PriceTagScanScreen` adds a throttle branch — keeps the
  user's photo in an editable card and shows the accurate `priceTag.throttled*`
  alert (new EN/FR i18n) instead of "couldn't read the tag". Receipt scan surfaces
  the same accurate message automatically (it shows `err.message`). Genuine
  timeouts/aborts still queue the tag for later (unchanged).
- Files: `src/services/ocrService.js`, `src/screens/PriceTagScanScreen.js`,
  `src/services/i18n.js` (`priceTag.throttledTitle`/`Body` EN+FR).
- Detect next time: `ocrServiceTimeout.test.js` asserts a 429 → tagged
  `status/code` + accurate message (not the raw "30/hour" text).
- Prevent: map transport/throttle conditions to user-facing copy by CLASS
  (timeout / throttle / unreadable), never echo the raw server string.

---

## 61. EAS Android build: "BUILD FAILED — Gradle build failed with unknown error" (all 766 tasks executed)

- **Date:** 2026-06-29 · **PR:** #124 · **Area:** mobile (Android EAS build)
- **Symptom:** `expo.dev` EAS build shows `BUILD FAILED in 5m 44s` at the bottom
  of the "Run gradlew" phase log. The tail reads:
  ```
  BUILD FAILED in 5m 44s
  Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.
  766 actionable tasks: 766 executed
  Error: Gradle build failed with unknown error. See logs for the "Run gradlew" phase for more information.
  ```
  Confusingly, all 766 tasks are listed as **executed** (no "X failed" count).

- **Root cause (primary): Sentry upload finalizer task fails.**
  `@sentry/react-native/expo` injects a Gradle task (`cliTask`) that uploads
  JS source maps to Sentry via `sentry-cli`. This task is registered as a
  **`finalizedBy`** hook on the bundle task — meaning it runs *after* bundling
  succeeds. Without `SENTRY_AUTH_TOKEN` available in the EAS environment, the
  CLI exits non-zero. Gradle counts the task as "executed" (finalizers are
  always executed) but marks the build as FAILED. Because EAS may run Gradle
  with `--continue`, all remaining tasks also complete, yielding "766 executed"
  with no per-task failure count — only the top-level BUILD FAILED.

- **Root cause (secondary): Groovy space-assignment deprecation warnings.**
  The Expo-generated `android/app/build.gradle` uses Groovy DSL space-assignment
  (`propName value`) which is deprecated in Gradle 9 and removed in Gradle 10.
  This adds the "Deprecated Gradle features … incompatible with Gradle 10" line
  to the build summary. In some EAS configurations or future Gradle upgrades this
  could become a hard error.

- **Fix:**
  1. Added `SENTRY_DISABLE_AUTO_UPLOAD: "true"` to the `preview` and `production`
     EAS profiles in `eas.json`. When this env var is `"true"`, the Sentry
     `cliTask` has `onlyIf { false }` and is **skipped** (not failed), so the
     build succeeds. Re-enable source-map uploads by adding `SENTRY_AUTH_TOKEN`
     as an EAS secret (Settings → Secrets on expo.dev) and removing the
     `SENTRY_DISABLE_AUTO_UPLOAD` env var from `eas.json`.
  2. Added `plugins/withGradle10Compat.js` — an Expo config plugin that
     post-processes the Expo-generated `android/app/build.gradle` and
     `android/build.gradle` during `expo prebuild` to replace deprecated
     space-assignment syntax with the `propName = value` form.
     Registered in `app.json` as the first plugin entry.
  3. Patched the local (gitignored) `android/app/build.gradle` and
     `android/build.gradle` directly for local build parity.

- **Files:**
  - `eas.json` — `SENTRY_DISABLE_AUTO_UPLOAD` env var in `preview`/`production`
  - `app.json` — added `"./plugins/withGradle10Compat"` as first plugin
  - `plugins/withGradle10Compat.js` — new config plugin
  - `android/app/build.gradle` *(gitignored — local only)*
  - `android/build.gradle` *(gitignored — local only)*

- **Detect next time:** EAS build log tail shows "766 actionable tasks: 766
  executed" + "BUILD FAILED" with NO per-task failure count. Always check the
  **full "Run gradlew" phase log** (not just the tail): if the actual error is a
  `sentry-cli` invocation failing with an auth error, it's this bug. Run locally
  with `./gradlew assembleRelease --warning-mode all` to surface both.

- **Prevent:** Keep `SENTRY_AUTH_TOKEN` as an EAS secret on expo.dev. If it
  ever expires or is rotated, add `SENTRY_DISABLE_AUTO_UPLOAD: "true"` as a
  temporary holdover in `eas.json` to unblock builds, then restore the secret.

## 62. Reinstall sign-in re-onboards an existing user + shows an empty app (build pointed at a backend without `/api/me/bootstrap`)

- **Date:** 2026-06-29 · **PR:** #125 · **Area:** mobile build config + sign-in
- **Symptom:** After uninstall→reinstall, signing in shows "Signed in as
  <email>" then routes to **"Finish setting up"** (re-asking postal/province/
  referral) and lands on an **empty app** — no receipts, no credits, no history.
  Persisted even after the prior reinstall-recovery fix (PR #122/#123) shipped.
- **Root cause:** The recovery (`OnboardingScreen.onSignInDone` →
  `hydrateFromBackend` → `GET /api/me/bootstrap`) only restores data when that
  call succeeds. The EAS **`preview`/`development`** build profiles set **no
  `PRICE_API_URL`**, so `config/profiles/eas.js` returns `undefined` and the
  `common.js` default (**production**) wins. Production runs a **stale v2.6.0**
  where `/api/me/bootstrap` returns **HTTP 404** (the endpoint shipped to dev
  v2.7.0 only). So hydrate returns `{ok:false, reason:"http_404"}`, restores
  nothing → wrong route + empty app. The earlier fix changed only app code; the
  backend the build actually calls never had the endpoint. Amplifiers:
  `onSignInDone` re-onboarded on ANY hydrate failure, and hydrate failures had
  **zero telemetry**, so the field failure was invisible.
- **Fix:**
  1. `eas.json` — added `PRICE_API_URL=https://priceback-development.up.railway.app`
     to the `preview` and `development` profiles (internal test builds must hit
     the backend that has the endpoint + the user's data). `production` stays on
     the prod URL via `common.js`.
  2. `src/services/syncService.js` — `_hydrate` now emits
     `analyticsService.track("hydrate_failed", { reason, status, trigger })` on
     http_/network/unconfigured failures, and carries `status` on http errors.
  3. `src/screens/OnboardingScreen.js` — new exported pure `decideSignInRoute()`:
     a FAILED hydrate (404/401/5xx/network/unconfigured) → **retry** alert
     (`signin.recovery*`, EN+FR), NEVER forced re-onboarding; "setup" reserved for
     hydrate-OK-but-no-profile (genuine new user). Also hydrates on the
     setup-completion path.
- **Files:** `eas.json`, `src/services/syncService.js`,
  `src/screens/OnboardingScreen.js`, `src/services/i18n.js`,
  `docs/RevenueCat_Paywall_Config.md` (separate paywall code-23 note).
- **Detect next time:** "treated as new user after reinstall" or "empty app on a
  known account" → check which backend the build targets: probe
  `curl -s -o /dev/null -w "%{http_code}" <backend>/api/me/bootstrap` (404 = wrong/
  stale backend; 401 = endpoint exists). Compare `<backend>/health` `version`
  between dev and prod. On-device, the `hydrate_failed` Sentry event now names the
  reason/status.
- **Prevent:** Never let a non-prod EAS profile fall through to the prod URL —
  set `PRICE_API_URL` explicitly per profile. Keep prod deployed to ≥ the app's
  expected backend version (prod owes a deploy + migrations — see memory
  `db-provider-neon-test-supabase-prod`).

---

## 63. Local Gradle build fails with "user-mapped section open" + sync-conflict files (Syncthing locking the build tree)

- **Date:** 2026-06-29 · **Area:** local Android build (`manual_build/build-and-install.ps1`)
- **Symptom:** `assembleRelease` fails partway through with:
  `...\mergeReleaseAssets\merger.xml: Error: (The requested operation cannot be
  performed on a file with a user-mapped section open)`. The script log starts
  by removing several `*.sync-conflict-*` files. The build's own line reads
  `BUILD FAILED in 2m 58s`, yet the script's wall clock reports a far larger
  elapsed (e.g. `03:03:03`) and the live progress bar's `mm:ss` counter rolls
  over at 60:00 repeatedly — it looks like a multi-hour runaway/hang.
- **Root cause:** **Syncthing is real-time-syncing the whole project tree.**
  `C:\Workspace` is a Syncthing folder (`.stfolder` marker present,
  `fsWatcherEnabled="true"`), so its watcher+hasher open/memory-map files under
  `android/app/build/` the instant Gradle writes them. On Windows a mapped
  section blocks Gradle's rename/delete of `merger.xml` → the error. The same
  cross-device editing produces the `*.sync-conflict-<ts>-<deviceid>*` copies
  (the `-O4ROC4P…` suffix = the peer device's Syncthing ID). The "3 hours"
  isn't a Gradle hang: Gradle failed at 2m58s, but Syncthing kept file handles
  open so the wrapping `Start-Job` (and its child process) never exited, leaving
  the script's stopwatch running. The script's pre-build conflict-file deletion
  is a band-aid — it cleans up *after* Syncthing, it never stops the live
  locking *during* the build.
- **Fix:** Add a `.stignore` at the Syncthing folder root (`C:\Workspace\.stignore`)
  excluding the churning build/dependency dirs so Syncthing never touches them:
  `node_modules`, `build`, `.gradle`, `.cxx`, `.expo`, `dist`, `coverage`,
  `local.properties`, `ios/Pods`, `ios/build`, plus `*.sync-conflict-*`. Patterns
  without a leading `/` match at any depth, so one file covers every repo under
  `C:\Workspace`. Then **Rescan** the folder in the Syncthing UI
  (http://127.0.0.1:8384) and delete the half-written `android/app/build` before
  rebuilding. The dedicated "Priceback - APK" Syncthing folder
  (`android\app\build\outputs\apk\release`) keeps working — the parent ignoring
  `build` just stops the two folders fighting over that subtree.
- **Files:** `C:\Workspace\.stignore` (NOT in the repo — it's a per-machine
  Syncthing control file; recreate it on any new PC that syncs `C:\Workspace`).
- **Detect next time:** any `(...user-mapped section open)` or `merger.xml` /
  `mergeReleaseAssets` failure on Windows, **or** `*.sync-conflict-*` files
  appearing in `node_modules`/`android` → a file-sync tool (Syncthing, OneDrive,
  Dropbox) is watching the build tree. Check `tasklist | findstr syncthing` and
  look for a `.stfolder` at or above the repo. The rolled-over `mm:ss` timer with
  a huge `hh:mm:ss` total is the tell that the build *process* couldn't exit.
- **Prevent:** keep build/dependency dirs out of every sync tool. On a fresh PC,
  recreate `C:\Workspace\.stignore` before the first local build.

---

### Where to look first when something is "missing" or "failing silently"

1. **API audit log** (`{"t":"api",...}` JSON lines in the Railway log stream) —
   was the request received? what `statusCode`? This is the single most useful
   first check (see `support-email`/`memory` note "Receipt missing from DB =
   401, not expiry"). As of 2026-07-23 this is a stdout log, not a DB table.
2. **`/health?token=…`** — auth failures, OCR/LLM budget, config wiring
   (`auth`, `ocr`, `ocrLlm`, `ocrBudget`, `policies`).
3. **Mobile:** is the receipt stuck with `syncPending: true`? Is it
   `syncRetryable: false` (terminal) — and should it be?

---

## 64. "Refresh prices" detects the scanned receipt's own discounts as price drops (claim $X, −0%)

- **Date:** 2026-07-01 · **Area:** price-drop detection (`backend/repos/priceDropRepo.js`), mobile drop display
- **Symptom:** Right after scanning a receipt that had instant discounts, Refresh prices /
  `POST /api/me/check-drops` "detects" those same discounts as verified price drops — a
  "claim $4.00" card showing **−0% savings**. Worse for admin accounts (`ADMIN_USER_SUBS`),
  whose own receipt rows self-verify instantly.
- **Root cause (two-part):**
  1. Every receipt line is written to `price_points` (source `receipt_ocr`) at the
     POST-discount unit price with NULL `valid_until`. `findNotifiable` (since 984c3ad)
     tested *validity-window overlap* with the purchase policy window, coalescing NULL
     bounds to *today* — so the receipt's own at-purchase discount always "overlapped" and
     fed back as the comparison price for the buyer's full-price lines of the same product.
  2. Mobile had no strictly-positive-savings guard: the DetailScreen promo path
     (`unitSavings > 0 || promoActive`) recorded drops where current price = price paid,
     rendering "−0%" chips, and HomeScreen counted them as alerts.
- **Fix:** Replaced the overlap test with an **appeared-after-purchase** rule: a verified
  price counts for a line only if SOME observation of it became available strictly AFTER
  the purchase date and within `purchase_date + policy_days` (store-configured). Availability
  = flyer printed `valid_from` for flyer-tier rows, `observed_at::date` for point sources
  (NOT their Monday-bucketed `valid_from`, which would wrongly pre-date same-week
  observations). The receipt's own discount rows (available on the purchase date) can never
  satisfy this, so receipts never self-trigger; the same user's LATER cheaper purchase of the
  same product still does. Mobile: drops require `savings > 0` to record/render/notify
  (DetailScreen, HomeScreen, notificationService already had the sweep-side guard).
- **Gotcha for test fixtures:** flyer observations must pass explicit `validFrom`/`validUntil`
  (the printed flyer dates); relying on the Monday-of-week default makes drop tests
  weekday-dependent (fails when the purchase date is mid-week after Monday).
- **Files:** `backend/repos/priceDropRepo.js` (`findNotifiable`), `src/screens/DetailScreen.js`,
  `src/screens/HomeScreen.js`, tests `backend/tests/priceDropWindowSourceDb.test.js` (self-receipt
  regression suite), `backend/tests/priceDropDb.test.js`, `__tests__/detailScreen.smoke.test.js`,
  `__tests__/screensSmoke.test.js`; docs `docs/priceDrop.md`.

---

## 65. Raw receipt OCR (card refs, invoice numbers, member ID) stored verbatim in the DB

- **Date:** 2026-07-02 · **Area:** both (mobile parse pipeline + `receipts.raw_ocr`)
- **Symptom:** Every scanned receipt's FULL OCR text — the payment/card block
  (`COMPTE:/ACCT: MASTERCARD`, `# REFERENCE`/`REFERENCE #`, `# AUTOR`/`AUTH #`,
  `NO. DE FACTURE`/`Invoice Number`, EMV AIDs, card masks), the membership
  number, and even cashier names — landed in `receipts.raw_ocr` (NOT NULL) and
  round-tripped back to every device via `GET /api/me/bootstrap`. A compliance
  problem, and payment-block lines also fed the parser garbage phantom items.
- **Root cause:** the only PII scrub lived in the FIXTURE capture script
  (`scripts/captureReceiptOcr.js`); the runtime pipeline
  (`extractVisionResult → parseReceiptText → rawText → toApiBody.rawOcr`)
  persisted the Vision output verbatim. (The capture scrub itself also missed
  the EN `REFERENCE #: <n>` label order.)
- **Fix:** new shared compliance layer `shared/ocrCleanup.js` (synced to
  `backend/shared/` by `sync-shared.js`) — data-driven EN+FR keep/noise keyword
  lists — runs in `receiptParser.parseReceiptText` BEFORE parsing, so the parse
  input, the on-screen raw panel, local storage, and `receipts.raw_ocr` only
  ever see cleaned text. The membership number is extracted into
  `receipts.member_id` (migration `0001`), stripped from the text/words, never
  rendered in the app and stripped from every API read by
  `receiptsRepo.decorateReceiptRow` (the user's own data-export excepted).
  Flyers get the same treatment for advertising/legal/on-image label text
  (`cleanFlyerWords`/`cleanFlyerText` in `flyerScanService.extractViaVision`) +
  an explicit `rejected: no_offers` flag for pages with no product savings.
- **Gotchas baked into the keep-list:** refund routing markers
  (`REFUND / MEMBERSHIP`, `APPROVED - REFUND`, `REMISE D'ACHAT`) and pure
  datetime lines (often the only printed receipt date) live INSIDE the payment
  block and must survive; bare amounts are a column-split block's price column;
  `Item #<short>` is an online invoice's real SKU line (only the ≥12-digit
  register barcode variant is noise). Member-ID extraction must be
  LINE-scoped — a free regex across joined words once grabbed a product SKU as
  the "member number" and then deleted that SKU everywhere.
- **Detect next time:** realocr suite invariant "cleanup removed every
  payment/transaction/cart artifact" runs the FORBIDDEN_AFTER_CLEANUP patterns
  over every committed fixture; `backend/tests/receiptMemberIdDb.test.js` pins
  the stored-but-never-served member_id contract.
- **Prevent:** keyword lists are data (`RECEIPT_NOISE_PATTERNS` /
  `RECEIPT_KEEP_PATTERNS` / `FLYER_NOISE_PATTERNS`) — extend them there, never
  inline in parsers; every new pattern gets a fixture-backed test.

## 66. Auto-reload reads "confusing" (toggle flickers off→on, pack self-selects) + notifications never arrive

- **Date:** 2026-07-02 · **Area:** mobile (`BuyCreditsScreen`, `NotificationsScreen`, `DetailScreen`, `notificationService`, i18n)
- **Symptom:** (a) Opening Buy Credits showed "Re-buy automatically" OFF, then
  ~2 s later it flipped ON and the selected pack changed on its own — "is it on
  or off?". (b) The home banner said "Auto-reload armed" but no credits were ever
  reloaded automatically. (c) Notifications never arrived despite several prior
  fix attempts.
- **Root causes:** (a) `BuyCreditsScreen.refresh()` awaited
  `Promise.all([canAddReceipt() /* ~2 s server balance */, getPrefs() /* fast
  local */])` before setting the toggle + pack selection, so both rendered stale
  defaults (off, middle pack) until the SLOW balance call returned, then snapped.
  (b) "Auto-reload" is an auto-PROMPT by platform rule (Apple §3.1.2 / Google
  Play forbid silent consumable charges) — it can only fire the OS purchase sheet
  when the user attempts a scan at 0 credits; the copy over-promised proactive
  silent reload. (c) The LOCAL price-drop notification
  (`sendPriceDropNotification`) was only ever called from the once-daily
  background-fetch task — never on the manual "Refresh prices" path users
  actually use — and there was no on-device way to see permission/token status or
  test delivery, so a broken link in the push chain (permission → minted token →
  token synced to `users.push_token` → signed in) was invisible.
- **Fix:** (a) split the load — `refreshPrefs()` (fast, local) settles the toggle
  + selection immediately; `refreshBalance()` (slow, server) updates only the
  balance card; the auto-reload row is hidden behind `prefsLoaded` so no stale
  "off" ever renders. (b) honest copy for `home.lowBalanceAutoOn` +
  `buyCredits.autoReload*` (EN+FR) — behaviour unchanged. (c) fire a local
  `sendPriceDropNotification` for each NEWLY-detected drop on the DetailScreen
  refresh (only items that flipped not-detected → detected, so an unchanged sale
  doesn't re-notify); add a Notifications-screen troubleshooting card
  (`getNotificationDiagnostics`) surfacing the first broken link + a "Send test
  notification" button (`sendTestNotification`, requests permission then fires an
  immediate local alert).
- **Detect next time:** `buyCreditsScreen.smoke.test.js` asserts the toggle
  settles from prefs even when `canAddReceipt` never resolves;
  `detailScreenDropNotify.test.js` asserts a new drop notifies once and an
  already-detected item does not; `notificationService.test.js` covers the
  diagnostics + test-send branches.
- **Prevent:** never gate a fast local pref read on a slow network read in the
  same `Promise.all`; auto-reload is an auto-PROMPT, not a silent charge — copy
  must say so ([[auto-reload-platform-constraint]]); any user-facing
  "notifications" feature needs an on-device self-diagnostic, since the push
  chain fails silently.

## 67. Pre-scanned banner leaks into item names; "Member" + warehouse header shown in the OCR panel

- **Date:** 2026-07-02 · **Area:** mobile parse pipeline (`shared/ocrCleanup.js`,
  `receiptGeometry`, `receiptParsingShared.extractItems`)
- **Symptom:** After the #65 compliance layer, self-checkout receipts still
  sometimes showed `*** START OF PRE - SCANNED ITEMS` (or a fragment) as an
  ITEM NAME — while the raw-OCR panel looked clean and didn't contain the
  sentence. Also the bare "Member" label and the whole warehouse header block
  (COSTCO / WHOLESALE / "Kanata #541" / address / postal / `whse:` footer)
  still appeared in the on-screen OCR text.
- **Root cause (three parts):**
  1. The banner noise pattern required the literal `PRE-SCANNED` spelling with
     asterisk runs on both sides. Vision tokenizes the banner into separate
     WORDS (`***`, `START`, `OF`, `PRE`, `-`, `SCANNED`, `ITEMS`, `*********`),
     so the reconstructed geometry row reads `PRE - SCANNED` (spaced hyphen) —
     no match → banner words survived ONLY in the word-geometry path (the flat
     text matched and was cleaned, which is why the panel looked fine), then
     `reconstructRowsFromAnnotation` welded them onto the first item's row and
     the item was renamed to the banner (fixtures `PXL_20260702_022107026`,
     `PXL_20260702_022131546`). The `TOTAL NUMBER OF PRE-SCANNED ITEMS= 6`
     trailer was additionally PROTECTED by the `\bTOTAL\b` keep pattern (keep
     overrides noise).
  2. The membership label line was deliberately kept as a bare "Member" marker
     ("line-position marker") — nothing downstream actually used it.
  3. Warehouse header lines were on the keep list (the parser reads store +
     warehouse # + province from them) and nothing removed them after parsing.
- **Fix:** banner handling is now an INLINE scrub (`stripBannerNoise`) that
  runs BEFORE the keep list and tolerates any tokenization (spaced hyphens,
  split rows, asterisk runs); a banner-only line/row is dropped whole, a row
  that merely carries a banner fragment sheds only the banner words
  (`BANNER_WORD_RE`) so a welded item survives. Membership label lines are
  removed outright (new `member-label` noise pattern; the ID is still extracted
  first; a priced "MEMBERSHIP FEE" line and the `REFUND / MEMBERSHIP` header
  survive). Warehouse info follows GET-then-strip: the parser extracts
  store/warehouseId/province as before, then `parseReceiptText` strips the
  header lines from `rawText` via `stripWarehouseInfo` (amount-bearing lines
  are never stripped) — so display + `receipts.raw_ocr` are items/totals only.
  `scrubItemNameNoise` in `stampIgnoredItems` is the last line of defense for
  names. Removing the Member line exposed a LATENT engine bug: the 2-line
  NAME→PRICE pairing matched the address line above the first TPD row against
  the discount amount (`3.50-`), fabricating a phantom item — the pairing now
  refuses discount/return amounts.
- **Gotchas:** the trailer's count digits are only eaten behind an explicit
  `=`/`:` separator so a SKU sharing the row is never truncated; banner word
  removal deliberately has NO digit patterns (SKUs/prices on a welded row must
  survive); `stripWarehouseInfo` must run POST-parse (store detection needs
  "COSTCO"), requires lowercase for street lines (items are ALL CAPS, addresses
  Title Case), and excludes `Item #NNN` online SKU lines.
- **Detect next time:** realocr FORBIDDEN_AFTER_CLEANUP now includes
  `PRE-SCANNED` (any tokenization), `START/END OF`, and membership label
  shapes; expectations pinned for both July-2 banner fixtures.
- **Prevent:** when adding noise patterns for register-printed banners, assume
  Vision splits every token — test the word-geometry path with the real
  tokenization (capture a fixture), not just the flat text.

## 68. Receipt list 2nd line reverted to "Costco Canada" instead of the warehouse name

- **Date:** 2026-07-02 · **Area:** both (backend persistence + mobile display)
- **Symptom:** A few versions ago the receipt card's 2nd line showed the warehouse
  ("Ottawa Gloucester") for Costco receipts; it regressed to the generic store name
  "Costco Canada". Same generic name showed in the detail hero and price-drop views.
- **Root cause:** the label helpers (`receiptWarehouseLabel` →
  `getReceiptLocationLabel`) resolve off `receipt.warehouseId`. Locally-scanned
  receipts carry it, but the backend NEVER persisted a warehouse link (`receipts` had
  no `warehouse_id` column — the number was only used to scope `price_points`) and so
  never echoed `warehouseId` back. After a reinstall/bootstrap the rehydrated receipts
  had no `warehouseId` → the label fell back to `store.name` ("Costco Canada").
- **Fix:** added `receipts.warehouse_id` FK (migration 0002), resolved from the printed
  number on save; `decorateReceiptRow` echoes the store-issued NUMBER back as
  `warehouseId` so every read path (list, detail, bootstrap) resolves the warehouse
  again. Label now renders "City #number" (e.g. "Kanata #541"), falling back to the
  bare "#number" when the number doesn't cross-match a known location — never the
  generic store name. Applied to the detail hero + Home price-drop chip too.
- **Files:** `db/schema.js`, `repos/receiptsRepo.js` (decorate + create), `server.js`;
  `constants/stores.js` (`receiptWarehouseLabel`), `screens/DetailScreen.js`,
  `screens/HomeScreen.js`.
- **Detect next time:** a rehydrated (post-reinstall) receipt whose card shows the bare
  store name means the server dropped a display attribute — check the `/api/receipts`
  payload carries it, not just the local model.
- **Prevent:** any per-receipt display attribute the client derives (warehouse, etc.)
  must be persisted server-side AND returned by the read decorator, or it silently
  vanishes on device rehydration. Covered by `receiptWarehouseLink.test.js`.

## 69. Store/warehouse OCR was folded into the items OCR column

- **Date:** 2026-07-02 · **Area:** both
- **Symptom:** no separate record of the OCR text that identified the store + warehouse
  — it was either inside `receipts.raw_ocr` or (after bug #67's `stripWarehouseInfo`)
  discarded entirely.
- **Fix:** new `receipts.header_ocr` column (migration 0002). The header is captured at
  parse time as the exact complement of `stripWarehouseInfo` (new
  `extractWarehouseInfo` in `shared/ocrCleanup.js`), threaded through the scan save +
  `receiptSyncService.toApiBody` (with an `extractHeaderOcr` derive-fallback for older
  clients whose `raw_ocr` still holds the header).
- **Files:** `shared/ocrCleanup.js`, `services/receiptParser.js`,
  `services/receiptParsingShared.js`, `services/receiptSyncService.js`,
  `screens/ScanScreen.js`, `db/schema.js`, `repos/receiptsRepo.js`.
- **Prevent:** OCR provenance for distinct concerns (store/warehouse vs. line items)
  belongs in distinct columns — don't concatenate them into one text blob.

## 70. `warehouse_id` still null after save despite #68's DB link existing

- **Date:** 2026-07-03 · **Area:** mobile (parsing)
- **Symptom:** `#68`'s server-side link (`receipts.warehouse_id`) and client
  extraction were both wired correctly, yet a specific receipt
  (`r_1783092798869_2xoa1`) still saved with `warehouse_id = null` and the list
  showed "Costco Canada" instead of "Kanata #541".
- **Root cause:** `extractWarehouseId`'s "city name + #number" pattern only
  matched **ALL-CAPS** city names (`GLOUCESTER BUS CTR #802`). Vision's geometry
  reconstruction (`reconstructRowsFromAnnotation`) sometimes welds the flat OCR's
  separate "Kanata" and "#541" lines into one row ("Kanata #541"). Title-Case
  "Kanata" didn't match the ALL-CAPS pattern, and the merged row also broke the
  last-resort "bare `#NNN` between two newlines" fallback since it was no longer
  alone on its line — extraction silently returned null.
- **Fix:** added a case-insensitive city+number pattern between the ALL-CAPS
  pattern and the standalone-newline fallback, guarded against matching an
  online invoice's `Item #2607455` SKU line.
- **Files:** `src/services/receiptParsingShared.js` (`extractWarehouseId`),
  `__tests__/receiptParsingShared.test.js`.
- **Detect next time:** when a receipt's warehouse fails to link, check whether
  Vision geometry was used (`geometryUsed: true`) — geometry row-merging is a
  recurring source of these regex misses, since the flat-text fallback often
  parses the same header fine.
- **Prevent:** any regex keyed on OCR line boundaries (`\n...\n`) is fragile
  against geometry-reconstructed rows that can merge adjacent flat-text lines;
  prefer patterns that don't depend on case or line isolation when parsing
  header/location info.
- **Note:** #70 improved the regex but did NOT fix the root cause — see #71.

## 71. Purchase date always "today" + warehouse still null — header fields read from the geometry item-table rows, not the full OCR

- **Date:** 2026-07-03 · **Area:** mobile (parsing)
- **Symptom:** Two regressions after the Vision-geometry parser landed: (1) every
  saved Costco receipt's purchase date defaulted to **today** (the printed date
  was ignored), and (2) `warehouse_id` still saved **null** on receipts whose
  header the flat OCR read fine — #70's regex fix didn't help because the value
  was never taken from the flat text in the first place.
- **Root cause:** For a warehouse receipt with word geometry,
  `parseCostcoWarehouseReceipt` parses the **reconstructed row text** (built for
  the SKU·NAME·PRICE item table) and `chooseBetterParse` picks the geom/flat
  winner **purely on item/total/discount score** — the header-derived fields
  (`date`, `warehouseId`, `purchaseType`, even `storeId`) ride along from
  whichever parse won. Geometry clustering routinely **drops the standalone
  printed-date line** and **welds/omits the "City #NNN" warehouse line**, so when
  the geom parse won, `date` came out null → `ScanScreen` fell back to
  `todayLocalISO()`, and `warehouseId` came out null (or occasionally wrong, e.g.
  `1405` vs the real `1362`). A diagnostic over all real-OCR fixtures showed
  `date=NULL` on ~20 receipts whose flat text yielded the correct date.
- **Fix:** `applyHeaderFieldsFromRawText(result, rawText)` re-sources the
  single-value header fields from the **original flat OCR** (the fullest, most
  reliable source — it always carries the printed date and the `whse: NNNN`
  footer) after the item parse is chosen, on BOTH the geometry and no-geometry
  return paths. It also re-stamps `store`/`storeId`/`detectedStoreName` (the geom
  rows can lack the "COSTCO" keyword) and recomputes `purchaseType`. Never
  fabricates a value — a genuinely date-less receipt stays null. Belt-and-braces:
  `receiptSyncService.toApiBody` now recovers `warehouseId` from the captured
  `headerOcr` when the parse didn't resolve one.
- **Files:** `src/services/costcoReceiptParser.js`
  (`applyHeaderFieldsFromRawText` + both `parseCostcoWarehouseReceipt` exits),
  `src/services/receiptSyncService.js` (`toApiBody` warehouse fallback);
  tests: `__tests__/costcoReceiptParser.test.js` (geometry-drops-header unit
  tests), `__tests__/costcoReceiptParser.realocr.test.js` (per-fixture invariant:
  `date`/`warehouseId` must equal the full-text extraction + pinned ground
  truth), `__tests__/receiptSyncService.mapping.test.js`.
- **Detect next time:** if a saved receipt's date is today or its warehouse is
  null, check `geometryUsed`; compare the parse's `date`/`warehouseId` against
  `extractDate(rawText)`/`extractWarehouseId(rawText)` — a mismatch means a
  header field is being taken from the reshaped rows instead of the full OCR.
- **Prevent:** header/whole-receipt scalar fields (date, warehouse, store,
  member) must be extracted from the **complete flat OCR**, never from a
  reshaped/geometry subset optimized for the item table. The realocr invariant
  test locks this in across every captured fixture.

## 72. Invented $12.94 tax on a TAX 0.00 receipt + dropped item — column-split totals block and inverted price/SKU lines, "validated" past the printed total

- **Date:** 2026-07-03 · **Area:** mobile (parsing + validator)
- **Symptom:** The same paper receipt (Kanata #541, SUBTOTAL = TOTAL = 99.51,
  printed TAX 0.00) scanned three times (dev rows `r_1783099597725_q2vet`,
  `r_1783095553662_9t24z`, `r_1783092798869_2xoa1`): the app showed tax
  **$12.94** and total **$112.45** — MORE than the register charged — and on
  other photos of the same receipt dropped the $30.55 B/S THIGHS line entirely
  (total 77.92, tax 8.96). The 10th report in the same warehouse-null/parse
  saga: every prior fix passed at the parser level while the field kept failing.
- **Root causes (three, compounding):**
  1. **Column-split totals block.** OCR printed the summary as stacked labels
     then stacked values (`SUBTOTAL / TAX / 99.51 / 0.00 / **** TOTAL / 99.51`).
     `extractTax`'s label row carried no digits, so it borrowed the NEXT line —
     `99.51`, the **subtotal's** value.
  2. **Validator "corrected" garbage into new garbage.** The province tax cap
     saw tax 99.51 > 13% × 99.51 and clamped it to **12.94**, recomputing total
     = 112.45. It never consulted the receipt's own printed total (99.51) or
     printed TAX 0.00 — the one thing OCR read perfectly.
  3. **Inverted price/SKU lines.** On two photos a bare price line printed
     ABOVE its SKU+name row (`…41.99 / 30.55 / 55506 B/S THIGHS / SUBTOTAL`);
     no pairing rule matched, the item vanished, and totals collapsed around
     the hole.
  A structural test gap hid all three: the realocr suite tests
  `parseCostcoReceipt` in isolation and `receiptParserScan` mocks everything,
  so **no test ran the real chain** parseReceiptText → validateReceipt →
  toApiBody that a live scan takes.
- **Fix:**
  1. `reshapeColumnSplitTotals(lines)` (receiptParsingShared) zips a run of ≥2
     bare summary labels with the bare amounts that follow, positionally —
     applied at the top of `parseReceiptEngine` so every extractor sees
     one-line summary rows.
  2. `printedTotal` (the receipt's own printed grand total, extracted
     independently of items) now rides every parse — `extractPrintedTotal`
     moved to receiptParsingShared, stamped by the engine and re-sourced from
     the flat OCR in `applyHeaderFieldsFromRawText`. `validateReceipt` treats
     it as authoritative: when items fit inside it, tax := printed − items
     (including an explicit ZERO) and total := printed; the province cap is
     now the last resort and even a clamped recompute can never exceed the
     printed total.
  3. `extractItems` pairs a bare price line with the price-less SKU+name row
     below it (guards: leading SKU required, row after must not be a bare
     price, never a TPD/CPN/summary/store line).
- **Files:** `src/services/receiptParsingShared.js` (reshape + printedTotal +
  inverted pairing), `src/services/receiptValidator.js` (printed-total
  authority), `src/services/costcoReceiptParser.js` (printedTotal re-source,
  extractPrintedTotal moved out). Tests: `__tests__/receiptPipeline.live.test.js`
  (NEW — the real end-to-end chain over the three field OCR variants + every
  committed fixture), `receiptParsingShared.test.js`, `receiptValidator.test.js`,
  realocr EXPECTATIONS now pin tax/date/warehouseId for the failing receipt.
- **Detect next time:** `taxDerivedFromPrinted` / `taxCapped` flags on the
  parse; any displayed total above the printed "**** TOTAL" line is a bug by
  definition — reproduce by pasting the DB row's `header_ocr + raw_ocr`
  through `receiptPipeline.live.test.js`'s `runPipeline`.
- **Prevent:** every field failure gets its OCR added to
  `receiptPipeline.live.test.js` (cheap — text only, no image needed). A
  "sanity" corrector must anchor on the receipt's own printed evidence
  (printed total / printed TAX), never on an external plausibility rate alone;
  and parser-level green means nothing unless the full pipeline
  (parse → validate → API body) is exercised too.

## 73. Auto-reload prompt silently retargeted from the 50-credit threshold to 0

- **Date:** 2026-07-05 · **Area:** mobile (credits / auto-reload)
- **Symptom:** Auto-reload was specified to offer the top-up when the credit
  balance drops to/at `AUTO_RELOAD_THRESHOLD_CREDITS` (50). At some point the
  prompt only ever fired when a scan was hard-blocked at 0 credits; the 2026-07-02
  "auto-reload confusion" fix then **reworded all EN+FR copy to "re-buy at zero"**
  to match the wrong behavior instead of restoring the threshold — an unapproved
  behavior change shipped as a copy "clarification". The 50 threshold survived
  only as the Home banner (`getAutoReloadThreshold`) and the backend low-balance
  push, so config (bundled catalog, seed, dev DB app_config) all still said 50
  while the app acted on 0.
- **Root cause:** the only call sites of `maybeAutoReload()` were the
  `canAddReceipt().allowed === false` branches in `ScanScreen` (pre-OCR gate and
  `handleSave`) — i.e. balance already 0/insufficient. No code path observed the
  threshold crossing, and no test pinned "prompts at 50", so the copy rewrite
  cemented the regression.
- **Fix:** `purchaseService.maybeAutoReloadOnLowBalance(status)` — prompts when
  a fresh balance snapshot is ≤ threshold, deduped once per crossing via the
  `auto_reload_low_prompted_v1` marker (re-armed by any balance observed above
  the threshold); delegates opt-in/premium/pack rules to `maybeAutoReload`.
  Wired into both post-spend balance refreshes in `ScanScreen` (successful save
  + rejected-scan spend). The 0-credit gate stays as the final safety net; spend
  logic untouched. EN+FR copy re-worded back to threshold-based (quotes
  `{threshold}`). Tests: `maybeAutoReloadOnLowBalance` suite in
  `purchaseService.test.js` (prompts exactly at 50, once per crossing, re-arms,
  never on Infinity/null, premium guard) + a `scanScreenCreditGate` wiring case.
- **Lesson / how to avoid recurrence:** an "auto-X" feature's TRIGGER CONDITION
  is product behavior, not copy — never "fix" a trigger by editing the copy to
  match what the code happens to do; check what was originally specified (Task
  Log / memory / config name: the key is literally `AUTO_RELOAD_THRESHOLD_CREDITS`).
  Any DB-tunable threshold must have a test that pins behavior AT the threshold,
  or the threshold will silently decay into dead config.

## 74. Android package rename orphans Google Sign-In → `DEVELOPER_ERROR`
- **Symptom:** after renaming the Android package `ca.priceback.app` →
  `com.priceback` in Play Console (and rotating GCP credentials), Google Sign-In
  fails on device with `DEVELOPER_ERROR`, and Android builds can hard-fail with
  "No matching client found for package name".
- **Root cause:** Google matches a native app by **package name + signing
  SHA-1**. The old Android OAuth client was bound to `ca.priceback.app`; nothing
  matched `com.priceback` + the Play App Signing cert, so the sign-in handshake
  is rejected. Separately, `google-services.json` still declared the old
  `package_name`, which fails the Expo Android build.
- **Fix:** (1) `google-services.json` `package_name` → `com.priceback`.
  (2) Register the Play App Signing SHA-1 (and any EAS upload-keystore SHA-1) for
  a Firebase Android app on `com.priceback` — this AUTO-PROVISIONS the Sign-In
  OAuth client. (3) Update `googleClientIdAndroid` in
  `config/profiles/common.js`. (4) RevenueCat: repoint the Play app package +
  re-upload the Play service-account JSON. Automated + made device-independent
  via `scripts/configure-google-signin.mjs` (service-account key in EAS env);
  full runbook in `docs/Signin_Config_Recovery.md`.
- **Lesson / how to avoid recurrence:** an app-identity string (package /
  bundle ID) is a **fan-out key** — it's duplicated across GCP OAuth clients,
  `google-services.json`, RevenueCat, Play, and Apple. Renaming it in one console
  silently invalidates every other copy; `webClientId` looks fine because the
  break is in the *Android* client Google matches implicitly. Never rename a
  package without walking the whole fan-out. Adding a SHA-1 to a Firebase Android
  app is the CLI-friendly way to recreate the Sign-In OAuth client (no console
  OAuth screens), which is why the recovery is now a repeatable script.

## 75. Subscribers could be charged credits (or freeload) at the money gates — inline `tier === "unlimited"` checks, replayable webhook, split top-up refs

- Date: 2026-07-06 · PR: TBD · Area: both
- Symptom: three latent money bugs found by audit, none yet user-reported:
  (a) every server charge site compared `subscriptionTier === "unlimited"`
  inline, ignoring status — a row left at tier=unlimited/status=expired rode
  free forever, and any future paid tier (e.g. the new annual cycle's sibling,
  or a second tier) would have been CHARGED credits despite paying a
  subscription; (b) a re-delivered RevenueCat webhook event (RC retries on
  network flake after our 200) could overwrite newer subscription state —
  e.g. re-applying a stale RENEWAL after a CANCELLATION — because the DB path
  never populated `subscriptionLastEventId`, so `applyEvent`'s duplicate guard
  was dead code there; (c) the mobile pack-purchase confirm fell back to
  `customerInfo.originalPurchaseDate` as a "transaction id" — a value the
  webhook's `event.transaction_id` can never match — so the client-confirm and
  the webhook credited the SAME pack under two different idempotency refs:
  double credits, real money lost.
- Root cause: charge exemption was string-matched per-site instead of derived
  from the subscription state machine; webhook dedupe relied on a
  single-slot last-event-id that the DB path didn't even feed; the top-up
  idempotency key was "whatever id we could find" instead of "a real store
  transaction id or nothing".
- Fix: (a) `subscriptionGate.isCreditExempt(profile)` — exempt iff
  `effectiveScanTier(profile) !== "free"` (any in-force paid sub: active,
  cancelled-until-expiry, billing-retry; expired pays again) — now used by
  POST /api/receipts, POST /api/me/credits/offline-scans, and the drop
  commission `chargeFor`; (b) webhook consults
  `subscriptionEventsRepo.hasEvent(event.id)` (audit table is unique on
  rc_event_id) before applying anything — total replay protection, not
  last-one-only; (c) mobile confirms a pack only with a genuine
  `transactionIdentifier`/`revenueCatId`; otherwise the webhook is the sole
  grantor and the existing balance-poll surfaces the credits.
- Files: `backend/subscriptionGate.js` (isCreditExempt), `backend/server.js`
  (webhook replay guard + 2 charge sites), `backend/priceDropNotifier.js`
  (exemptBySub), `backend/repos/subscriptionEventsRepo.js` (hasEvent),
  `src/services/purchaseService.js` (txn-id fallback removed).
- Detect next time: `creditsRepo.balanceReconciles(sub)` (ledger sum vs
  balance); `subscription_events` audit rows vs users tier/status; a
  subscriber with `scan_consume` ledger rows dated inside their sub window is
  the (a)-class regression.
- Prevent: `backend/tests/subscriptionMoneyDb.test.js` pins the lifecycle
  (credits frozen subscribe→expire, replay can't regress state,
  cancelled-exempt/expired-pays); `subscriptionGate.test.js` pins
  isCreditExempt for every status × tier; `purchaseService.test.js` pins
  "no txn id → no client confirm" and "txn id → exact-ref confirm".

## 76. Paywall: every product/sub fails with "the item you were attempting to purchase could not be found"

- Date: 2026-07-08 · PR: TBD · Area: mobile (root cause is store/test-env, not code)
- Symptom: on the paywall, tapping ANY credit pack or subscription shows the raw
  alert "Error — the item you were attempting to purchase could not be found."
  Same on every SKU. NOT the code-23 "issue with your configuration" string.
- Root cause: this string is **Google Play Billing `ITEM_UNAVAILABLE`**, surfaced
  by `subscriptionManager.purchasePackage()`. Our code only reaches that call
  after finding the package in `offerings.current.availablePackages`, so the RC
  offering + SKUs are already resolving correctly — the failure is at
  `launchBillingFlow`. On every SKU at once, the dominant cause is that the
  **installed build is not a Play-licensed copy**: a locally-built, debug/
  self-signed, sideloaded APK (`manual_build/build-and-install.ps1` + `adb
  install`). Google Play exposes product *details* to any app with a matching
  package name (`com.priceback`) — so offerings populate — but rejects the
  *purchase* unless the running app is a recognized Play distribution installed
  from a test track by a License Tester.
- Fix: **store/test-environment**, not app code — upload an EAS-signed AAB to
  Internal testing, add the account under Play Console → License testing, install
  from the Play opt-in link, ensure all 5 SKUs are Active. See
  `docs/RevenueCat_Paywall_Config.md` (Symptom #2). App-side, we stopped leaking
  the raw native string: `purchaseService.classifyPurchaseError` buckets the
  failure (`unavailable`/`already_owned`/`store_problem`/`network`/`unknown`),
  logs the underlying `rcCode`, and `purchaseProduct` returns it instead of
  throwing; `Paywall.purchaseErrorMessage` (shared with `BuyCreditsScreen`) shows
  friendly EN+FR copy. Empty-offering now also returns `errorCode:"unavailable"`.
  **Sideload dev-loop fix:** in `buildProfile==="local"` builds only (the
  sideload path — Play Billing can never work there), `purchaseProduct` falls
  back to the simulated grant (same as no-key dev-mode) on an `unavailable`
  store error / empty offering, so the paywall flow is testable without a Play
  install. Strictly gated — every `eas` (Play-distributed) build still does real
  purchases and surfaces the real error; non-`unavailable` errors never simulate.
- Files: `src/services/purchaseService.js` (classifyPurchaseError, structured
  return, empty-offering return), `src/components/Paywall.js`
  (purchaseErrorMessage + both handlers), `src/screens/BuyCreditsScreen.js`,
  `src/services/i18n.js` (paywall.err* EN+FR).
- Detect next time: the `[IAP] purchase failed … rc=… msg=…` console.warn names
  the exact RC/store code. `errorCode:"unavailable"` on every SKU while offerings
  resolve = licensed-install problem, not a config/code bug.
- Prevent: `__tests__/purchaseService.test.js` pins classifyPurchaseError buckets
  + "native rejection returned not thrown" + "empty offering → unavailable" +
  "local sideload simulates on unavailable / empty, but NOT on network, and eas
  builds never simulate".

## 77. Flyer scan missing items — geometry parser silently losing 1–6 tiles per photographed page

- Date: 2026-07-09 · PR: TBD · Area: backend (flyer OCR parsing)
- Symptom: the admin Flyer Scan finds most offers on a page but a handful of
  tiles never appear in review — different tiles on different pages, no error.
- Root causes (four, stacked — plus the harness bug that hid them all):
  1. **Harness fidelity**: `scripts/captureFlyerOcr.js` stored raw PIXEL
     vertices for photo fixtures while production `visionDataToWords` normalises
     to 0..1. Replaying fixtures made `parseFlyerWords` return 0 offers (every
     threshold is a page fraction), so tests concluded "photos defeat geometry,
     flat fallback runs" — in production geometry DID run on photos, with the
     failures below, and the flat fallback never engaged (offers.length > 0).
  2. **Phantom column**: a decorative "00000" digit run matched the SKU-word
     regex, fabricated a third column, and nearest-centre word assignment handed
     the real right column's price blocks to it → all 6 right-column tiles
     dropped on one page.
  3. **Multi-SKU tiles**: variant tiles print several item numbers on one row
     ("1829117, 1829114, 1126124-26"); slicing the column band at every anchor
     gave the extras zero-height bands → no offer.
  4. **One lost price value kills the tile**: the positional was/sav/promo
     triplet can't form when OCR loses/garbles one value ("$1,096.99" →
     "1.096.99"; stylised PRICE digits unOCR'd) — and the positional PAIR
     fallback then mis-read (was, savings) as (was, promo), caught only by the
     2.5× ratio guard dropping the tile.
- Fixes (`backend/services/flyerTextParser.js`): per-page coordinate
  auto-normalisation (`normalizePageWords`); repeated-digit SKU rejection (both
  parsers); column membership by BOUNDARY (own left edge → next column's left
  edge) instead of nearest centre; same-row SKU grouping emitting one offer per
  item number; label-aware price solving (`solvePriceBlockLabeled`: classify
  values by their row's In-warehouse/Instant savings/PRICE labels — QC/eco-fee
  rows vetoed — and solve was − sav = promo for the missing member, candidates
  disambiguated by the arithmetic constraints); plausibility guards
  (savings ≥ promo ⇒ welded-tiles junk, tile-own date window > 60 days ⇒
  OCR-mangled month, fall back to page window). `captureFlyerOcr.js` now
  normalises exactly like production.
- Result: all 76 real tiles across the six photographed fixture pages parse
  (was 63 via the accidental flat fallback; 45→45 on the PDF but with junk
  offers dropped and 5 tile dates corrected to their printed section window).
- Detect next time: extract result `source:"vision-ocr-geometry"` with fewer
  offers than visible tiles → dump SKU anchors vs offers per fixture (the gap
  names the failing tiles); a fixture whose geometry parse returns exactly 0 is
  a coordinate-space mismatch, not "no geometry".
- Prevent: `backend/tests/flyerTextParser.test.js` — per-fixture tile-count
  floors + exact price pins for every field-failure tile (Pine-Sol, Hisense TV,
  Thermacell, 32 Degrees, Huggies variants, Pekkle pair, the phantom-column
  page), pixel-input parity test, phantom/grouping/label-solve/date-span units.

## 78. Sign-in "Continue anyway" ran new-account setup on backend failure; subscriptions left ZERO database trace (webhook never delivered)

**Symptoms (2026-07-09, Play internal-test build):**
1. On sign-in, the app showed "couldn't load your saved receipts and credits… you can also continue setting up and it'll sync later" — and continuing ran the **new-user SetupStep** (welcome-credit UX, referral window, consents) for what may be an existing account.
2. A real subscription purchased on the Play build **never appeared in `subscription_events`** (prod had 0 rows EVER), and `users` never left `free`.

**Root causes:**
- The sign-in hydrate-failure alert offered "Continue anyway" → SetupStep. Account
  creation must never proceed while the backend/database is unreachable.
- `doFinishSetup` fire-and-forgot `syncProfileToBackend(...)`, so a failed persist
  still marked the profile complete locally.
- Subscriptions had **no client-confirm fallback**: only the RevenueCat webhook wrote
  `subscription_events`/tier, and the webhook was never configured/delivered for prod
  (credit packs were unaffected because `POST /api/me/credits/topup` confirms client-side).

**Not a bug (verified in prod):** the 75 welcome credits are granted exactly once per
account (`users.trial_credits_granted_at` guard; account deletion is a soft delete so
re-signup can't farm it). The "duplicate signup" impression came from the Play build
talking to the **prod** DB where the account was genuinely new (dev history lives in the
dev DB), plus the blocked-recovery alert above.

**Fixes:**
- OnboardingScreen: hydrate failure now BLOCKS sign-in with an apology that names the
  problem (network vs service unavailable) and offers only Retry — `signInBlockedBodyKey`
  is the tested contract. SetupStep persists the profile server-side FIRST and stays put
  on failure.
- New `POST /api/me/subscription/sync` (auth + DB): pulls the subscriber from the
  RevenueCat REST API with `REVENUECAT_SECRET_KEY` (client claim never trusted), applies
  tier/status/expiry idempotently, appends a deterministic `rcsync:*` audit event
  (INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE/free_trial/EXPIRATION), settles referrals.
  Mobile requests it after subscription purchase, after restore, and from
  `reconcileWithServer`'s "server has no record yet" branch — the DB converges even if
  the webhook never fires.
- `/health` now reports `checks.revenuecat.webhook` + `checks.revenuecat.syncApi` so a
  missing token is visible instead of silently swallowing purchases.

**Ops (Maxim):** set `REVENUECAT_SECRET_KEY` on Railway (RC secret API key) and configure
the RC dashboard webhook (`REVENUECAT_WEBHOOK_TOKEN`) — see `RevenueCat_Paywall_Config.md`.

**Test-suite gotcha fixed en route:** `purchaseService.test.js`'s dev-mode suites re-mock
`expo-constants` WITHOUT `priceApiUrl` and (some) without an afterEach restore, silently
pointing `API_BASE_URL` at the unconfigured fallback for every later suite. The base
`beforeEach` now re-establishes the expo-constants mock (same leak-guard the file already
applied to authService).

## 79. extractPrintedTotal misread the printed grand total as the TAX amount (French "TOTAL TAXES" + column-split PDF layouts)

- Date: 2026-07-09 · PR: (this PR) · Area: mobile
- Symptom: no user-visible corruption (a guard was absorbing it), but the parse's
  `printedTotal` — the validator's authority anchor and the score target for
  choosing between parse strategies — was the TAX value (or a stray item price)
  instead of the grand total on ~12 of 55 committed fixtures: every Costco
  website-PDF export and Quebec receipt.
- Root cause: three distinct misreads in `extractPrintedTotal`:
  1. The skip-filter used `\btax\b`, which does NOT match "TOTAL TAXES" (plural)
     or FR "TAXE" — the taxes line's amount was returned as the "total".
  2. The Costco website-PDF prints the totals block column-split (labels
     stacked, then amounts stacked); the first money line under the bare
     "TOTAL" label is the TAX amount, one line before the real total.
  3. OCR can stream an ITEM's price column right after the totals labels — the
     next-line borrow happily took "14.99 H" (an item line) as the total.
  The validator's `itemsSum <= printed` plausibility guard masked all of this
  (a "printed total" smaller than the items sum is ignored), which is why no
  fixture pin ever failed — but scoreParse/chooseBetterParse and the new parse-
  confidence metric were being fed a wrong target.
- Fix: `extractPrintedTotal` now (1) re-zips column-split totals blocks via the
  existing `reshapeColumnSplitTotals` before reading, (2) skips `\btaxe?s?\b`
  (EN singular/plural + FR), (3) only borrows a BARE amount from the next line
  (an amount with a trailing tax flag is an item price, never a total).
- Files: `src/services/receiptParsingShared.js` (extractPrintedTotal);
  regression pins in `__tests__/receiptParsingShared.test.js` + the golden
  snapshot suite.
- Detect next time: `__tests__/receiptGolden.snapshot.test.js` pins
  `printedTotal` + `confidenceSignals` for every fixture — a reintroduced
  misread shows up as a `printed_total_mismatch` signal diff in the snapshot.

## 80. Sign-in froze on the onboarding screen for minutes; user had to tap "Continue" after the account picker

- Date: 2026-07-10 · PR: (this PR) · Area: mobile
- Symptom: first launch → sign-in → pick Google account → the flow bounced back
  to the SAME sign-in screen now showing "Signed in as… / Continue"; tapping
  Continue then froze on that screen for minutes before finally reaching the
  home page. Two wasted interactions and a dead-looking UI.
- Root cause: `SignInStep.handleGoogle` called `onContinue()` (which runs
  `hydrateFromBackend` + the route decision — a slow backend pull) WITHOUT
  awaiting it, and its `finally` reset `busy` immediately. So the button
  reverted to the signed-in "Continue" state while the hydrate ran invisibly
  in the background with no loader; the user's "Continue" tap just fired a
  SECOND hydrate = the freeze. There was no loading surface anywhere between
  account selection and Main.
- Fix (`OnboardingScreen.js`): `onSignInDone` sets a new `restoring` state
  synchronously before its first `await`, so the parent swaps `SignInStep` for
  a full-screen `RestoringStep` loader on the same frame. It stays up through
  `navigation.replace("Main")` (route "main" — no flicker back to sign-in),
  drops for the blocking apology on "retry", and drops for SetupStep on "setup".
  An already-signed-in session auto-continues ONCE (`autoContinueRef`, consumed
  by the mount effect AND the Google/Apple handlers) so a failed hydrate →
  remount can't silently loop. New i18n keys `signin.restoring{Title,Body}`
  (EN+FR). The BLOCKING no-"continue-anyway" contract (entry #78) is untouched.
- Files: `src/screens/OnboardingScreen.js`, `src/services/i18n.js`;
  behavioral test `__tests__/onboardingSignInFlow.test.js`.
- Detect next time: `onboardingSignInFlow.test.js` renders the real screen,
  drives Google sign-in, and asserts the hydrate is awaited (no navigate until
  it resolves) then auto-navigates to Main with no second press — a regression
  to fire-and-forget hydrate or a reintroduced manual "Continue" fails it.
- General rule: any async handoff that gates navigation (sign-in, account
  setup, restore) must (a) be awaited and (b) show a loading surface for its
  whole duration — never drop the user back on the trigger screen mid-flight.
- Prevent: golden snapshots cover ALL fixtures (not just hand-pinned ones), so
  any change to any parse output fails CI until deliberately re-pinned.

---

## 81. Every production scan fails with "Scan failed: API error 502" (dead prod Vision key)

- **Date:** 2026-07-10 · **PR:** _(this PR)_ · **Area:** ops (prod config) + mobile + backend
- **Symptom:** On the **Play internal-test / production build** (the "testing APK"
  from Google Console, which targets the **production** backend), scanning ANY
  receipt or price tag fails with **`Scan failed: API error 502`**. 100%
  reproducible in prod; the **dev** build (dev backend) scans fine. Nothing looks
  wrong on `/health` — it reports `ocr: "configured"`, `healthy: true`.
- **Root cause:** The production Railway service's **`GOOGLE_VISION_API_KEY` is
  set but invalid/unauthorized** (revoked, wrong key, an API restriction that
  blocks the server-to-server call, or the Cloud Vision API not enabled on that
  key's GCP project). Google Vision returns **403**, `POST /api/ocr` maps that to
  **HTTP 502** `{ "error": "OCR service authentication failed. Contact support." }`
  (`server.js` ~L1409), and the mobile client rendered it verbatim as
  `Scan failed: API error 502`. This is the long-pending **"rotate Vision key"**
  ops item (memory `security-prelaunch-pending`).
  > ⚠️ The `/health` `ocr` field is only an **env-var-presence flag** — it never
  > calls Google, so a dead key still reads `"configured"`. That comforting lie
  > is why this class of outage is invisible from `/health` alone.
- **Fix — the real one is OPERATIONAL:** set a **valid, unrestricted-for-Vision**
  `GOOGLE_VISION_API_KEY` on the **`priceback-production`** Railway service
  (the dev key works — mirror its project/permissions or issue a fresh key with
  the Cloud Vision API enabled and no application/API restriction that blocks a
  keyless server call). No app deploy fixes a bad key.
- **Fix — code guardrails shipped alongside (this PR):**
  - **Detectability (backend):** new admin-gated **active probe**
    `GET /health?probe=ocr` (or `?probe=all`) → `probeVisionAuth()` makes ONE
    tiny real Vision call and reports the truth in `checks.ocr.probe`:
    `ok` | `unauthorized` (401/403 — the dead-key case) | `rate_limited` |
    `error` (`upstreamStatus`) | `unreachable` | `missing`. Admin-only + opt-in
    because it costs one real Vision unit.
  - **UX (mobile):** `ocrService._visionFetch` now maps any backend **5xx** on
    `/api/ocr` to friendly, tagged copy (`code: "ocr_unavailable"`,
    "Scanning is temporarily unavailable…") instead of the raw
    `Scan failed: API error 502`, so the scan screens drop the user into manual
    entry (mirrors the 429 handling).
- **Files:** `backend/server.js` (`probeVisionAuth`, `VISION_PROBE_B64`,
  `/health?probe=ocr` wiring), `src/services/ocrService.js` (`_visionFetch` 5xx
  branch), tests `backend/tests/visionAuthProbe.test.js` +
  `__tests__/ocrVisionPipeline.test.js`.
- **Detect next time:** the definitive one-liner —
  `curl -s -o /dev/null -w "%{http_code}" -X POST <backend>/api/ocr -H "Content-Type: application/json" -d '{"deviceId":"diagnostic-device-1234567890","base64":"<any ≥100-char base64 image>","mimeType":"image/jpeg"}'`
  → **502** on prod, **200** on dev pins it to the prod key. Or hit
  `GET <backend>/health?probe=ocr&token=<FLYER_ADMIN_TOKEN>` and read
  `checks.ocr.probe` (`unauthorized` = bad key). `/health` alone (no `probe`) will
  NOT reveal it — it only checks the env var is present.
- **Prevent:** never trust a config-presence flag as a health signal for an
  external key — validate it against the upstream (the `?probe=ocr` pattern).
  Keep prod's paid-API keys valid + monitored; a raw upstream status must never
  reach the user as scan copy.

---

## 82. Sign-in blocked with "service temporarily unavailable" — prod DB missing a migration's columns (bootstrap 503)

- **Date:** 2026-07-10 · **PR:** _(ops DB fix, no code change)_ · **Area:** ops (prod DB schema drift) + backend
- **Symptom:** On the **production** Play build, sign-in dies on the PR #147 block
  dialog: **"We're sorry — sign-in can't be completed right now… Our service is
  temporarily unavailable."** 100% reproducible, all users, started "this morning."
  `/health` looks **totally green** (`db: ok`, everything `configured`).
- **Root cause:** **Schema drift** — the prod `priceback.receipts` table was
  missing the columns from **BOTH migration `0001_receipt_member_id` (`member_id`)
  AND `0002_receipt_warehouse_header_ocr` (`warehouse_id`, `header_ocr`; it also
  drops `policy_window`)** — neither was ever applied to prod, even though *later*
  migrations were (e.g. 0004's `policy_status_id` was present). ⚠️ Fixing only one
  reveals the next: the ORM select fails on the FIRST missing column, so after
  adding `warehouse_id`/`header_ocr` the same 503 returned with
  `column "member_id" does not exist`. Diagnose by listing ALL of the receipts
  model's columns against prod in one pass, not one error at a time.
  `GET /api/me/bootstrap` runs an ORM `select` over the full `receipts` model
  (`_receiptsRepo.listForUserWithItems`), which references every column; Postgres
  threw **`column "…" does not exist`**, the handler's `catch` returned
  **HTTP 503** (`server.js` ~L4116), and `hydrateFromBackend` mapped the non-network
  failure to `signInBlockedBodyKey → "signin.blockedServiceBody"` → the block dialog.
  > ⚠️ `/health`'s `db` check is a trivial `SELECT 1`, so column-level drift is
  > **invisible** to it — same "config-presence lie" class as #81.
- **Fix — OPERATIONAL:** applied **migrations 0001 + 0002** directly to prod
  Supabase `xjfrlzwonyaorwktnkpj` (add `member_id`, `warehouse_id`, `header_ocr` +
  the `warehouses` FK, drop `policy_window`). Live immediately, no backend redeploy.
  Verified the full bootstrap select reads all 18 receipts cleanly afterward.
- **Files:** prod DB only (`priceback.receipts`). Migration source of truth:
  `backend/db/migrations/0001_receipt_member_id.sql` +
  `backend/db/migrations/0002_receipt_warehouse_header_ocr.sql`.
- **Detect next time:** when a `/api/me/*` route 503s but `/health` is green, read
  **Supabase → Postgres logs** for `column "X" does not exist` and diff prod's
  `information_schema.columns` for the table against the migration chain /
  `backend/db/deploy/schema.sql`. The API audit log (`{"t":"api",...}` lines in
  the Railway log stream: `route`, `statusCode`) pins *which* endpoint and *when*.
- **Prevent:** run `db:migrate` against prod as part of every release so the prod
  schema can't lag the deployed code; the migration journal — not `/health` — is
  the real "is prod migrated" signal. Prod is a config-only branch that has
  repeatedly lagged the migration chain (see memory `db-provider-neon-test-supabase-prod`).

## 83. Email sync connect dead-ends — Gmail "Error 400: invalid_request / OAuth 2.0 policy", Outlook "Need admin approval"

- **Symptom:** tapping **Connect** on the Email Sync screen opened a browser that
  failed. **Gmail** → Google's *"Access blocked: Authorization Error … this app
  doesn't comply with Google's OAuth 2.0 policy for keeping apps secure. Error
  400: invalid_request."* **Outlook** (with a work/school account, e.g.
  `@viacesi.fr`) → Microsoft's *"Need admin approval — Priceback (unverified)
  needs permission … that only an admin can grant."* Both are hard dead-ends the
  user can't clear.
- **Root cause — Gmail:** `emailSyncService.connectGmail` still used
  `expo-auth-session` `AuthRequest` with a **custom URI scheme** redirect
  (`priceback://`). Google deprecated custom-scheme redirects for Android/Web
  OAuth clients (2024+) and now **hard-blocks** them with `invalid_request`.
  This is the *exact* deprecation `authService.js` documents — the main sign-in
  was already migrated to the native library, but the Gmail connect path was
  missed.
- **Root cause — Outlook:** `connectOutlook` targeted the **`common`** authority,
  which accepts personal *and* work/school accounts. A locked-down tenant (CESI)
  forbids user consent to third-party apps, so any org account hits the admin-
  approval wall — consent the developer can never grant. PriceBack is a consumer
  receipt app; org accounts were never the intended audience.
- **Fix (code):**
  - **Gmail** → rewrote `connectGmail` to use native
    `@react-native-google-signin` (Play Services): `configure({ webClientId,
    scopes:[…gmail.readonly] })` → `signIn()` → `getTokens()` for a short-lived
    access token. No redirect URI, no custom scheme, so the policy block can't
    fire. `syncGmailReceipts` already handles the eventual 401 → reconnect.
  - **Outlook** → switched the authorize **and** token endpoints from
    `/common/` to **`/consumers/`** (personal `@outlook/@hotmail/@live` only), so
    the org admin-consent wall is never reached.
  - Tests: `__tests__/emailSyncConnect.test.js` pins both — Gmail must drive the
    native lib (never the `priceback://` web flow) and Outlook must hit
    `/consumers/`, never `/common/`.
- **Caveat (OPS, not code):** `gmail.readonly` is a Google **sensitive scope**.
  Until the OAuth consent screen is verified, users still see an *"unverified
  app"* warning (test users / the developer can proceed). Full public Gmail sync
  needs Google app verification + a backend code-exchange for a refresh token.
- **Files:** `src/services/emailSyncService.js` (`connectGmail`, `connectOutlook`,
  new `getGoogleSignin` + `GMAIL_SCOPES`).
- **Detect next time:** an OAuth connect that opens a **browser** on Android is
  suspect — Google's blessed path is the native Play Services library (no browser,
  no redirect URI). "invalid_request / doesn't comply with OAuth 2.0 policy" =
  custom-scheme/redirect problem, NOT a scope-verification problem. "Need admin
  approval" on `microsoftonline.com` = a work/school account on `common`; scope to
  `consumers` for a consumer app.

## 84. Subscription expiry enforced by a status FLAG, not the clock — a lapsed sub could stay credit-exempt on the server past its paid-through date

- **Symptom (latent, money-path):** the backend charge gate
  (`subscriptionGate.isCreditExempt` → `effectiveScanTier`) decided "is this user
  a paid subscriber?" purely from `subscriptionStatus === "expired"`. That flag is
  only written when RevenueCat delivers an `EXPIRATION` webhook **or** the client
  calls `/api/me/subscription/sync`. Prod's RC webhook historically delivered
  **zero** events (see #78), so if a subscription lapsed and the device never
  triggered a sync, the server kept `status: active` with a **past**
  `subscription_expires_at` → the user stayed unlimited (scans free, no per-drop
  commission) indefinitely past their paid-through date. The mobile UI reverted
  them correctly (`purchaseService.getPremiumStatus` already compares
  `expiresAt < now`), but the server's charge path did not — an asymmetry.
- **Root cause:** `effectiveScanTier` promised "a lapsed subscription counts as
  free even if subscriptionTier wasn't rewritten yet (defence in depth)" in its
  docstring but never actually compared the expiry date — it trusted the status
  flag alone. Expiry correctness depended entirely on external event delivery.
- **Fix (code):** made `effectiveScanTier(profile, now)` (and the `isCreditExempt`
  / `scanAllowanceFor` callers that thread `now`) **time-aware**: a paid tier
  drops to `free` when `subscription_expires_at` is set and **not in the future**
  (`!(expMs > now)`), independent of the status flag. Mirrors the server-to-server
  rule already used in `_rcSubscriberToTier` (`active ⇔ expires_date > now`), so
  the two agree. Safeguards: an unparseable date (NaN) is treated as lapsed (never
  grant on bad data); a **NULL** expiry (lifetime, or a paid state recorded
  without an expiry) is left untouched; explicit `expired` status still wins.
  **Auto-renewal is never falsely downgraded** — a `RENEWAL` always pushes the
  expiry into the future, and a `cancelled`-but-not-yet-expired sub keeps its
  future expiry until the period ends, so only a genuinely lapsed sub is affected.
- **Files:** `backend/subscriptionGate.js` (`effectiveScanTier`, `isCreditExempt`,
  `scanAllowanceFor`); tests `backend/tests/subscriptionGate.test.js` (+9 cases:
  future/past/at-boundary expiry, cancelled→lapse-on-time, renewal-not-downgraded,
  null/unparseable/lifetime, explicit-expired-wins, free-tier-unaffected).
- **Detect next time:** any "is the user still entitled?" check that reads a
  status/flag but ignores the expiry timestamp is suspect — always cross-check the
  paid-through date against `now` so the server self-corrects when a webhook is
  missed. Note: the app does **not** persist a subscription *start* date (only the
  current-period expiry + `subscription_updated_at`); gating never needs it — pull
  `original_purchase_date` from RevenueCat if you ever want a "member since" label.

## 85. Prod "Scan Error … FileNotFoundException / ENOENT" on the ML Kit scan cache + frozen Google Photos "Preparing your selected media" — missing source files fed straight into OCR

- **Symptom (production, 2026-07-11):** scanning a receipt showed a raw
  Java error dialog: `Could not read file: Call to function
  'ExponentFileSystem.readAsStringAsync' has been rejected. → Caused by:
  java.io.FileNotFoundException: /data/user/0/com.priceback/cache/
  mlkit_docscan_ui_client/….jpg: open failed: ENOENT` — followed by the
  misleading advice "Try again with better lighting or a flatter receipt."
  Related: picking a cloud-backed Google Photos image via the scanner's
  gallery import froze on Photos' own "Preparing your selected media —
  0 of 1 ready" dialog (the cloud original never finished downloading).
- **Root cause (two layers):**
  1. The ML Kit document scanner writes its output into its own volatile
     cache dir (`mlkit_docscan_ui_client/`), which Play services can clean
     on its own schedule — and a cloud-backed gallery import whose download
     stalls can "succeed" without the file ever materializing. Nothing in
     our pipeline copied the file out or verified it existed before OCR.
  2. In `ocrService._visionFetch`, a missing source made
     `manipulateAsync` fail **silently** (its catch falls back to the
     original URI), so the failure surfaced later as a raw
     `readAsStringAsync` ENOENT wrapped in receipt-quality advice. On the
     price-tag batch path, a gone file was even **queued for offline OCR**,
     where the background worker would retry a dead path forever.
- **Fix:** new acquisition-layer guards in `src/services/autoCrop.js`:
  - `materializeCapturedImage(uri)` — immediately after the scanner
    returns, wait out a slow write (short retry loop) and copy the file
    into our own `cacheDirectory/captures/`; `scanDocumentWithAutoCrop`
    now returns `{ status: "missing" }` when the file positively never
    materialized (new status in its contract).
  - `checkSourceExists(uri)` — positive existence probe ("ok" / "missing"
    / "unknown"; only a POSITIVE missing ever blocks) run at the top of
    `ScanScreen.processImage`, `PriceTagScanScreen.runOcr`/`runOcrBatch`,
    the barcode gallery pick, and admin flyer `extractPages`.
  - `isMissingSourceFileError(err)` — classifier that routes
    ENOENT/FileNotFound errors from anywhere in the pipeline to accurate
    new copy (`scan.sourceGoneTitle/Body/SomeBody`, EN+FR: "photo may
    still be downloading from your cloud library…"), never the
    "better lighting" advice. Missing files are SKIPPED, never queued, and
    never spend a credit (failure precedes the OCR spend).
  - Gallery "missing" falls through to the system photo picker (which
    downloads cloud media itself) so the user has a working second path.
- **Files:** `src/services/autoCrop.js`, `src/screens/{ScanScreen,
  PriceTagScanScreen,BarcodeScanScreen,AdminFlyerScanScreen}.js`,
  `src/services/i18n.js`; tests `__tests__/{autoCrop,scanSourceGone,
  priceTagSourceGone}.test.js`.
- **Detect next time:** any URI handed to OCR/FileSystem that was produced
  by a THIRD-PARTY component (ML Kit scanner, photo picker, share intent)
  is volatile — copy it into our own storage immediately on receipt and
  verify existence before any slow work (credit gate, network) runs. A
  frozen "Preparing your selected media" dialog is Google Photos
  downloading a cloud original — app-side the only defense is tolerating
  the file never arriving.

## 86. Raw technical error strings shown to users across the app (policy: friendly copy on screen, details to the team)

- **Symptom:** many catch blocks put `e.message` straight into an `Alert` —
  users saw Java exceptions, fetch internals, provider strings ("Could not
  read file: … ENOENT", "TypeError: Failed to fetch", raw store billing
  errors), while nothing was reported for the team to act on.
- **Policy (standing, enforce in review):** a raw `err.message` must NEVER
  reach a user-visible surface. Every user-facing catch goes through
  `src/services/errorSupport.js`:
  - `classifyError(err)` → `missing_file | rate_limited | timeout | network
    | server | unknown` (most-specific-first; reuses autoCrop's
    missing-file classifier).
  - `friendlyErrorBodyKey(err)` → i18n key (`err.timeoutBody`,
    `err.networkBody`, `err.rateLimitedBody`, `err.serverBody`,
    `err.unknownBody`, or `scan.sourceGoneBody`), EN+FR.
  - `reportHandledError(err, context)` → full message+stack+category to the
    team channel (analytics backend feed + Sentry via
    `analyticsService.reportCrash`, marked `handled: true`). Lazy-imports
    analyticsService so screens don't gain an eager native dependency.
  - `describeHandledError(err, context)` = report + return the body key —
    the one-liner for `Alert.alert(t(title), t(describeHandledError(e, {flow})))`.
- **Swept sites:** ScanScreen (gallery/document/scan/save×2),
  PriceTagScanScreen (camera/gallery/OCR-fail body), EmailSyncScreen
  (connect/sync), OnboardingScreen (Google/Apple sign-in + i18n'd title),
  ManageSubscriptionScreen (upgrade/cancel — store errors now via the
  shared `purchaseErrorMessage`), DetailScreen (compare/edit-save/price-check
  chip), StoresAndProfileScreens (report/export). Removed the
  `{error}`-interpolating keys `scan.scanErrorBody` / `scan.couldNotOpenDocument`.
  ADMIN-ONLY screens (AdminFlyer/AdminTagReview/AdminBarcodeFeeder)
  deliberately keep raw messages — they ARE the team.
- **Detect next time:** grep `Alert.alert` for `.message` — any hit outside
  an Admin screen is a violation of this policy.

## 87. Rule-of-N crowd verification was Sybil-forgeable — one actor rotating deviceIds could self-farm tag credits AND drain other users' credits with a fake drop

- **Date:** 2026-07-12 · **PR:** _(this change)_ · **Area:** backend (security, High)
- **Symptom:** none visible to honest users — an economic-abuse vector. The
  "verified by N independent shoppers" gate counted **distinct client-chosen
  `device_hash` values**, and `/api/observations/tag` + `/api/watch` are
  unauthenticated with a client-supplied `deviceId`. So a single actor could
  mint N fabricated devices for free and (a) self-verify their own price-tag
  savings → collect the crowd reward (`tagCreditsRepo`), and (b) forge a
  verified drop on a popular SKU → every OTHER free-tier buyer of that SKU is
  **debited a `price_drop_charge`** for a price Costco never honors.
- **Root cause:** contributor identity in the rule-of-N SQL was
  `'dev:'||device_hash` (and `HAVING COUNT(DISTINCT device_hash) >= n`).
  `device_hash` is derived from an unauthenticated, client-chosen string, so it
  is not a proof of a distinct human.
- **Fix:** count distinct **device owners**, not device ids. The rule-of-N CTEs
  now `LEFT JOIN priceback.devices d ON d.device_hash = pp.device_hash` and use
  `COALESCE('usr:'||r.user_sub, 'usr:'||d.owner_sub, 'anon', 'ref:'…)` as the
  contributor. A device is only a distinct shopper once it's **claimed** to an
  account (trust-on-first-use, `devices.owner_sub`); every unclaimed/anonymous
  device collapses into a **single shared `anon` bucket**. Reaching N now
  requires N real accounts (or an admin bypass). Signed-out observations still
  flow into the price pool (data collection unchanged) — they just can't
  manufacture consensus. Admin bypass (`ADMIN_USER_SUBS` / flyer / `adminVerified`)
  is untouched.
- **Files:** `backend/repos/priceDropRepo.js` (`findNotifiable`,
  `getLatestVerifiedPrice`, `markNewlyVerified`), `backend/repos/tagCreditsRepo.js`
  (settlement `HAVING`).
- **Detect next time:** any new consensus/credit gate that counts a
  client-supplied identifier (`device_hash`, `deviceId`, IP) as a distinct actor
  is suspect — count **claimed owners**.
- **Prevent:** `backend/tests/sybilVerificationDb.test.js` — a single actor's N
  spoofed devices never verify or bill; N distinct accounts still do (positive
  control). Existing rule-of-N suites updated to model **claimed** devices.

## 88. Credit-pack top-up minted paid currency from an unverified transactionId (free credits + referral-payout farming)

- **Date:** 2026-07-12 · **PR:** _(this change)_ · **Area:** backend (security, High)
- **Symptom:** none visible — any authenticated user could POST
  `/api/me/credits/topup` with `{ productId, transactionId: <any random string> }`
  and receive `pack.credits` for free. A fresh random id each call minted another
  pack (`recordTopupOnce` only dedupes the *same* id), and each "first purchase"
  also settled a referral payout.
- **Root cause:** the endpoint trusted the client's `transactionId` outright —
  no store/receipt validation — unlike the adjacent trustless
  `/api/me/subscription/sync`, which reads truth from RevenueCat's REST API with
  the secret key.
- **Fix:** before crediting, fetch the subscriber from RevenueCat
  (`_rcFetchSubscriber`, same secret-key path as sync) and confirm the
  `transactionId` appears as a real non-subscription purchase of that product
  (`_rcFindNonSubscription` → `subscriber.non_subscriptions[productId]`, matched
  on RC `id` or `store_transaction_id`). **Fails closed**: RC unconfigured → 503,
  unreachable → 502, not-found → 402; only a verified purchase reaches
  `recordTopupOnce`. The token-gated webhook remains the authoritative settlement.
- **Files:** `backend/server.js` (`POST /api/me/credits/topup`,
  `_rcFetchSubscriber`, `_rcFindNonSubscription`).
- **Detect next time:** any route that moves credits/money off a client-supplied
  id is suspect — the value must be verified against the payment provider.
- **Prevent:** `backend/tests/creditTopupSecurity.test.js` (forged→402/no ledger
  row, genuine→credited once, replay idempotent, unreachable→502, unconfigured→503).

## 89. No rate limiting on credit-affecting endpoints (farming / price-poisoning loops ran unthrottled)

- **Date:** 2026-07-12 · **PR:** _(this change)_ · **Area:** backend (security, Medium)
- **Symptom:** none directly — the amplifier that made #87/#88 cheap at scale.
  `/api/observations/tag`, `/credits/topup`, `/credits/offline-scans`,
  `/me/check-drops`, `/referral/redeem`, and `/api/receipts` had no throttle.
- **Fix:** `checkCreditRateLimit(key)` (in-memory sliding minute window, same
  style as `checkOcrRateLimit`) via a `creditRateLimited(req,res,prefix)` guard on
  each route, keyed by the authenticated sub (falls back to deviceId/IP). Default
  60/min per key — far above any human rate, far below a farming loop.
  `CREDIT_RATE_LIMIT_PER_MIN` env overrides.
- **Files:** `backend/server.js` (`checkCreditRateLimit`, `creditRateLimited`,
  guards on the six routes).
- **Detect next time:** a new money/verification route with no limiter in front.
- **Prevent:** `backend/tests/creditRateLimit.test.js` (pure limiter + a route 429).

## 90. Top-up verification residuals — one store transaction could credit MANY accounts, and a $0 sandbox purchase minted real credits

- **Date:** 2026-07-12 · **PR:** _(this change — audit follow-up to #88/PR #161)_ · **Area:** backend (security, High)
- **Symptom:** none yet — found auditing the #88 fix. Two holes in the "verified
  against RevenueCat" fast path:
  1. **Cross-account replay.** `recordTopupOnce` deduped per `(userSub, ref)`,
     but RevenueCat's restore/transfer re-homes a receipt under a new
     app_user_id — so the SAME paid transaction verified under each account it
     visited and credited a pack (and settled a referral) once per account.
  2. **Sandbox parity gap.** The webhook (`applyEvent`) refuses
     `environment=SANDBOX`, but the REST check (`_rcFindNonSubscription`) never
     looked at `is_sandbox` — a Play license-tester "purchase" costs $0 and
     minted real credits. Same gap in `/subscription/sync`'s tier mapper: a
     sandbox subscription granted the credit-exempt Unlimited tier.
- **Fix:** the topup dedupe is now GLOBAL on the store transaction id — a
  ref-only advisory lock + a cross-user ledger existence check; a second account
  presenting a settled ref gets `alreadyApplied` with NO balance echo. Sandbox:
  the topup route 402s (`sandbox_purchase`, non-retryable) on `is_sandbox:true`,
  and `_rcSubscriberToTier` skips entitlements whose backing record is
  positively sandbox (absent/unknown still grants — never downgrade on a
  payload-shape change). `RC_ALLOW_SANDBOX=1` opts a dev deployment back in.
- **Files:** `backend/repos/creditsRepo.js` (`recordTopupOnce`,
  `_topupRowForRefTx`), `backend/server.js` (topup route,
  `_rcEntitlementIsSandbox`, `_rcSubscriberToTier`).
- **Detect next time:** any idempotency key that identifies a GLOBAL fact (a
  payment, a store transaction) but is deduped per-user; any RC read path that
  doesn't mirror the webhook's environment policy.
- **Prevent:** `creditTopupSecurity.test.js` (transfer-replay + sandbox cases),
  `subscriptionSync.test.js` (sandbox mapper cases).

## 91. Credit rate-limit gaps — the limiter map grew unbounded, and the one unauthenticated route was keyed on a client-chosen id

- **Date:** 2026-07-12 · **PR:** _(this change — audit follow-up to #89/PR #161)_ · **Area:** backend (security, Medium)
- **Symptom:** none yet — found auditing the #89 fix.
  1. `CREDIT_RATE_LIMITS` was never enrolled in `sweepInMemoryState()` (every
     other limiter map is), so each unique key lived forever — and
     `/api/observations/tag` lets an unauthenticated caller mint keys at will
     (slow OOM).
  2. That same route keyed its budget on the client-chosen `deviceId`, so
     rotating deviceIds minted a fresh 60/min budget per fake device — the
     brake did nothing against exactly the actor it was built for.
- **Fix:** enrolled the map in the 6-hour sweep (60s windows → everything stale
  evicts), and added a secondary per-IP budget on obs-tag (5× the per-device
  max, so a warehouse NAT of legit scanners never trips it) keyed on the
  RIGHTMOST X-Forwarded-For hop — the platform-edge-appended one a client can't
  forge (the LEFTMOST hop, used elsewhere for logging, is client-suppliable and
  must never key a limiter).
- **Files:** `backend/server.js` (`clientIpForRateKey`, obs-tag guard,
  `sweepInMemoryState`, `creditRateLimited` opts).
- **Detect next time:** a rate limiter keyed on anything the client picks
  (deviceId, leftmost XFF); a new in-memory Map not enrolled in the sweep.
- **Prevent:** `creditRateLimit.test.js` (sweep eviction + rotating-deviceId
  429 via the IP budget).

## 92. "Price adjustment window closing soon — check for price drops now!" with NO price drop (trust-killer reminder)

- **Date:** 2026-07-12 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** users get "⏰ Price Adjustment Window Closing Soon … Check for
  price drops now!" (and the "🚨 Last Day" variant) when no price ever
  dropped — there is nothing to claim, the alert is pure noise and erodes
  confidence in every future alert. Separately, the once-daily background
  check re-sent the SAME "💰 Price Drop" alert every single day for an
  unchanged drop.
- **Root cause:** both expiry reminders were scheduled at **receipt-save
  time** (`ScanScreen.scheduleNotifications`) as blind OS date-triggers — no
  price was ever consulted, so they always fired at purchase+window−N days.
  The background task's notify branch had no "newly dropped" gate (unlike
  DetailScreen's manual refresh, which checks `wasDetected`), so a persisting
  drop re-notified on every run.
- **Fix:** reminders are now armed **at drop-detection time**, not scan time:
  `scheduleExpiryWarning`/`scheduleOneDayWarning` gate on
  `receiptClaimableDropSavings(receipt) > 0` (sum of detected, unclaimed,
  still-watched `item.priceDrop.savings`; deliberately NOT fail-open) and the
  copy now states the real event ("Price drop expiring — $X to claim"). New
  primitive `syncExpiryRemindersForReceipt(id)` (cancel → re-schedule off
  fresh storage) is called from the background task after every priceDrop
  write/clear, from DetailScreen's manual refresh, and from
  `markItemClaimed`/`stopWatchingItem`. The background task only notifies a
  NEW or DEEPER drop (`!prev?.detected || currentPrice < prev.currentPrice`).
  Scan-time scheduling deleted.
- **Files:** `src/services/notificationService.js`
  (`receiptClaimableDropSavings`, `syncExpiryRemindersForReceipt`, BG task),
  `src/screens/ScanScreen.js` (scheduling removed), `src/screens/DetailScreen.js`,
  `src/services/storageService.js` (`markItemClaimed`, `stopWatchingItem`).
- **Detect next time:** any local notification whose copy promises value
  ("claim $X") scheduled from a code path that never read a price.
- **Prevent:** `__tests__/notificationService.test.js` ("detected-drop gate",
  "registerBackgroundTask drop handling"), `notificationServiceReconcile.test.js`
  (drop-less receipt left cancelled), `storageServiceClaimNotifSync.test.js`.

## 93. Legacy watch sweeps: duplicate pushes every cycle, pushes after the window closed, and qty>1 false drops

- **Date:** 2026-07-12 · **PR:** _(this change)_ · **Area:** backend
- **Symptom:** repeated identical "Flyer deal / Price Drop" pushes (every
  flyer re-import and every 6-hour scrape cycle while a price stayed low);
  flyer-deal pushes for purchases whose price-adjustment window had already
  closed (nothing claimable); "drops" on quantity>1 lines whose unit price
  never moved.
- **Root cause:** the two in-memory sweeps (`runFlyerSweep`,
  `_runScheduledChecks`) predate the DB pipeline and had no
  `price_drop_notifications`-style send ledger; `runFlyerSweep` never checked
  the adjustment window; `_runScheduledChecks` compared the scraped UNIT
  price against `item.originalPrice`, which is the LINE TOTAL.
- **Fix:** shared `isWithinAdjustmentWindow(item)` (fail-closed on corrupt
  dates) now gates both sweeps; a persisted `sweepNotifyLedger`
  (`notifyLedger.json`, keyed token|receipt|sku-or-name|price so a deeper
  drop still notifies) dedupes both, pruned by TTL(45d)+size cap in
  `sweepInMemoryState`; the scraper compare is unit-aware with qty-scaled
  savings — mirroring `runFlyerSweep`'s existing math. The DB path
  (`priceDropNotifier`) was already correct and is untouched.
- **Files:** `backend/server.js` (`sweepNotifyLedger`, `sweepNotifyKey`,
  `pruneNotifyLedger`, `isWithinAdjustmentWindow`, `runFlyerSweep`,
  `_runScheduledChecks`, `__notifSweep` handle).
- **Detect next time:** any push send loop without a corresponding
  already-notified ledger read; any price comparison against
  `originalPrice` without dividing by quantity.
- **Prevent:** `backend/tests/sweepNotifyTruthfulness.test.js` (window skip,
  once-only, deeper-drop re-notify, qty false-positive, ledger persistence).

## 94. A "refund" word in a footer negated a whole purchase — detectRefund keyword ran before the positive-total guard

**Date:** 2026-07-13

- **Symptom:** A normal positive receipt whose OCR (or email/HTML text-scan
  input) contains the bare word "refund" anywhere — a return-policy footer like
  "Refunds accepted within 30 days" — is stamped `isRefund`, so the validator
  forces **every price negative** and the receipt saves as a bogus refund with
  zero price_points.
- **Root cause:** `detectRefund` (receiptParsingShared) checked the bare
  `\bREFUND\b` keyword BEFORE the `total > 0 → not a refund` short-circuit that
  the 2026-05-26 fix added, so the guard never protected against keyword
  false-positives — only against the negative-signals fallback.
- **Fix:** definitive markers (terminal `APPROVED - REFUND`, register headers
  `REFUND / MEMBERSHIP` + FR `REMISE D'ACHAT`, negative `ITEMS SOLD`/`ARTICLES
  VENDUS` counters, trailing-minus TOTAL) stay early — they may override a
  positive total, since OCR often loses a refund's minus signs. The bare
  keyword (`REFUND`, FR `REMBOURSEMENT`) now only counts when no positive
  parsed total contradicts it.
- **Files:** `src/services/receiptParsingShared.js` (`detectRefund`).
- **Detect next time:** a purchase that renders with negated prices although
  every printed amount is positive → grep its OCR for "refund"/"remboursement".
- **Prevent:** `__tests__/receiptParsingShared.test.js` — footer-refund purchase
  stays a purchase; bare keyword still catches total-less refunds.

## 95. French receipts: refunds parsed as purchases, gas receipts parsed as warehouse — FR markers existed only in the cleanup keep-list

**Date:** 2026-07-13

- **Symptom:** A Quebec in-club return (header `REMISE D'ACHAT`, counter
  `ARTICLES VENDUS = -N`) routes to the **warehouse purchase** parser: its
  reversed coupons print POSITIVE and defeat the zero-purchase-lines gate, so
  the return records positive price_points at refund/adjusted prices — fake
  crowd prices that can trigger false verified drops (credit payouts). A French
  pump receipt ("RELEVÉ DE TRANSACTION", "POMPE:", "LITRES:") bypasses the gas
  rejection the same way.
- **Root cause:** `shared/ocrCleanup.js` protected the FR markers with a
  comment claiming "the refund router depends on them", but every consumer was
  English-only: `isRefundHeader` matched only `REFUND/MEMBERSH`,
  `isRefundText`/`isRefundReceipt`/`detectRefund` only `ITEMS SOLD`, and
  `isGasReceipt` required the literal "transaction record" + EN pump tokens.
- **Fix:** FR equivalents added to all of them — `REMISE D'ACHAT` (apostrophe
  variants tolerated), `ARTICLES VENDUS = -N`, `MONTANT` label,
  `REMBOURSEMENT` keyword (guard: `AUCUN/PAS DE REMBOURSEMENT`), and gas tokens
  `relevé de transaction`, `pompe:`, `litres:`, `prix/litre`, `vente de
  carburant` (still conjunction-gated for precision).
- **Files:** `src/services/{receiptParsingShared,costcoReceiptParser}.js`.
- **Detect next time:** any bilingual register phrase used in routing/detection
  logic — check both languages are wired, not just protected from the cleanup.
  A REAL FR refund/gas fixture is still wanted (capture via
  `npm run capture:receipts`); current coverage is synthetic text.
- **Prevent:** FR cases in `__tests__/{receiptParsingShared,costcoReceiptParser}.test.js`
  incl. full routing of a REMISE D'ACHAT return with a positive-printed coupon.

## 96. Refunds were exempt from the confidence machinery — a blurry refund never got the high-res second pass

**Date:** 2026-07-13

- **Symptom:** A refund photographed badly keeps whatever the 1200px first
  OCR pass produced; purchases in the same state get a 2000px re-OCR retry.
- **Root cause:** `computeParseConfidence` returned a hardcoded `1.0` for any
  `isRefund` parse, and the scan pipeline's improve-mode explicitly excluded
  refunds from the retry AND from adoption.
- **Fix:** refunds now score through the same signal set (every money
  comparison already used absolute values, so negated amounts score
  identically); a zero-item refund (pure instant-savings reversal) stays 1.0
  by design. Improve-mode retries any sub-1.0 first pass and adopts only in
  kind: refund→refund, purchase→purchase — a retry can never flip the
  transaction type. Golden note: the 4 photo-refund fixtures now truthfully
  report `low_sku_coverage` (their ITEM # rows didn't OCR) — deliberately
  re-pinned.
- **Files:** `src/services/{receiptParsingShared,receiptParser}.js`.
- **Prevent:** `__tests__/{receiptConfidence,receiptParserScan}.test.js` —
  imperfect-refund penalties, refund→refund adoption, both flip directions
  forbidden.

## 97. Membership-renewal lines became watchable "products" with price_points

**Date:** 2026-07-13

- **Symptom:** Scanning a membership-renewal receipt ("GOLD STAR MEMBERSHIP
  65.00") records the fee as a normal product: it enters the crowdsourced
  price pool and is offered for price-drop watching.
- **Fix:** membership keywords (EN+FR: membership, gold star, goldstar,
  executive member, adhesion/adhésion, renouvellement) added to
  `IGNORED_KEYWORDS` — the existing fee-line semantics apply end-to-end
  (visible on the receipt, never price-tracked/watched, excluded from the
  items-sold self-check, user can override per line).
- **Files:** `src/services/receiptParsingShared.js`.
- **Prevent:** membership cases in the `isIgnoredItemName` suite.

## 98. A return line inside a mixed purchase receipt was dropped with no accounting — and the 3-line variant became a POSITIVE item

**Date:** 2026-07-13

- **Symptom:** (a) A receipt with purchases + an in-line return never
  reconciles (`items + tax ≠ total` forever), so every scan of it burns a
  pointless 2000px re-OCR (and an LLM reconcile for opted-in users) that can't
  succeed, and `extractTotal`'s misread-guard could override the register's
  own printed total with the items' sum. (b) Worse: a return printed as a
  standalone-SKU block ("2323048 / SOLAR LIGHT / 39.99-") had its trailing
  minus silently IGNORED and persisted as a **positive purchase item** with a
  price_point.
- **Root cause:** bare negative rows outside a VOID block were deliberately
  skipped (anti-duplicate, correct) but their amounts vanished from the
  receipt's math; the standalone-SKU 3-line handler's price regex tolerated a
  trailing minus without reading it.
- **Fix:** `extractItems` accounts every skipped return/discount row in a new
  `returnsSum` (surfaced via out-param + engine result). The engine's
  `reconciled`, `computeParseConfidence`'s printed-total gap, and
  `extractTotal`'s floor all honour `items − returns + tax = total`. The
  standalone-SKU negative block is never an item: inside VOID it cancels the
  matching prior item, otherwise it accrues to `returnsSum`. Items list
  behaviour is otherwise unchanged; candidate scoring (`scoreParse`/
  `isParseSelfConsistent`) deliberately stays anchored to the printed total.
- **Files:** `src/services/receiptParsingShared.js`.
- **Prevent:** `returnsSum` describe in `__tests__/receiptParsingShared.test.js`
  (single-line, 2-line, 3-line, VOID, summary-row exclusion, confidence); all
  55 goldens byte-identical.

## 99. Receipt purchase channel died client-side — online costco.ca prices indistinguishable in the crowd pool

**Date:** 2026-07-13

- **Symptom:** The parser discriminates warehouse vs costco.ca-online
  receipts, but `toApiBody` never sent it and the DB had no column — so
  online-channel price observations (no warehouse, shipping-inflated pricing)
  silently mix into the same crowd pool that drives rule-of-N drop
  verification, unrecoverable retroactively.
- **Fix:** `purchase_types` lookup table (`warehouse`/`online`/`unknown`,
  seeded) + `receipts.purchase_type_id` FK (migration `0003_flat_kabuki`,
  applied to DEV; **PROD owes it**). `toApiBody` sends the parser's
  `purchaseType` (allowlisted, legacy → "unknown"); the route passes it
  through; `receiptsRepo.create` allowlists again so junk degrades to NULL
  instead of failing the sync. Persist-only for now — consensus/drop queries
  unchanged (filtering by channel is a later product decision the column now
  makes possible).
- **Files:** `src/services/receiptSyncService.js`, `backend/db/{schema,seed}.js`,
  `backend/db/migrations/0003_flat_kabuki.sql`, `backend/server.js`,
  `backend/repos/receiptsRepo.js`.
- **Prevent:** `backend/tests/receiptPurchaseTypeDb.test.js` (live lookup
  resolution, junk→NULL, legacy→NULL) + purchaseType cases in
  `__tests__/receiptSyncService.mapping.test.js`.

## 100. Modal screens painted their close/back button UNDER the status bar — unreachable

**Date:** 2026-07-15

- **Symptom:** On the modal-presented screens (Scan, Paywall / "credit running
  low → buy credits", PriceTag/Barcode/Pending tag scan) the top header — and
  its X close / ‹ back button — rendered under the status bar and couldn't be
  tapped. Each screen already wrapped its header in `SafeAreaView
  edges={["top"]}`, so it looked correct, yet the top inset was 0.
- **Cause:** `<SafeAreaProvider>` was mounted WITHOUT `initialMetrics`. Without
  seeding, `react-native-safe-area-context` reports `{ top: 0 }` on the first
  frame until it measures. Freshly-mounted modal screens paint their header on
  that first frame with zero top padding → the button lands behind the status
  bar. Made worse by Expo SDK 55's default edge-to-edge on Android (app draws
  under the system bars).
- **Fix:** `<SafeAreaProvider initialMetrics={initialWindowMetrics}>` in
  `App.js`, so the real window insets are known on the very first render. One
  app-wide change fixes every safe-area screen.
- **Files:** `App.js`.
- **Prevent:** always seed `SafeAreaProvider` with `initialWindowMetrics`;
  never rely on a small hardcoded `paddingTop` for a top control — inset it.

## 101. Price-tag review images went missing "at random"

**Date:** 2026-07-15

- **Symptom:** In the admin tag-review queue, some submitted tag photos showed
  blank/broken at random. Also the offline (no-connection) review screen showed
  only a flat thumbnail with no way to zoom in, unlike the admin screen.
- **Cause:** TWO independent issues. (1) The admin list mints a presigned GET
  URL per image at fetch time with only a **10-minute** TTL; a review sitting
  open longer than that (or a long queue) outlived the URLs → images vanished
  mid-session. (2) The client tag-image upload was single-shot fire-and-forget:
  one PUT to the presigned URL then one `image-uploaded` confirm. A network
  blip on either left the R2 object uploaded but never linked to the review row
  — permanently missing.
- **Fix:** bumped `DEFAULT_GET_TTL` to **60 min** in both storage backends
  (`r2.js`, `gcs.js`) so a URL outlasts a review sitting. Hardened
  `uploadTagReviewImage` with bounded ret+ backoff retries on both the PUT and
  the (idempotent) confirm. Separately, swapped the offline `PendingTagScan`
  thumbnail to the shared `ZoomableImage` so it has the same pinch/double-tap
  viewer as the admin screen.
- **Files:** `backend/storage/{r2,gcs}.js`, `src/services/priceService.js`,
  `src/screens/PendingTagScanScreen.js`, `src/services/i18n.js`.
- **Prevent:** presigned GET TTLs must outlast the human task that views them,
  not just the fetch; any best-effort upload that a later screen depends on
  needs retries so a single blip can't orphan it.

## 102. Email OAuth tokens (incl. the Outlook REFRESH token) stored in plaintext AsyncStorage

**Date:** 2026-07-15

- **Symptom:** none user-visible — found by audit. `emailSyncService` kept its
  OAuth tokens under AsyncStorage `email_tokens_v1`: an unencrypted on-disk
  store readable on a rooted device or via backup extraction. The Gmail entry
  is a short-lived access token, but the Outlook flow persists a long-lived
  **refresh token** — a durable credential granting ongoing READ access to the
  user's mailbox.
- **Root cause:** the app's own secure pattern existed (`authService` keeps its
  tokens in `expo-secure-store`) but the email service predated/skipped it.
- **Fix:** token storage moved to SecureStore (encrypted at rest) under the
  same key; a one-time migration moves any blob a previous build wrote to
  AsyncStorage and deletes the plaintext copy (on migration failure the tokens
  are dropped — a re-connect beats a lingering plaintext credential). Sync
  history (`email_sync_v1`, not sensitive) stays in AsyncStorage.
- **Files:** `src/services/emailSyncService.js` (`_secureSet/_secureGet/
  _secureDelete`, `_migrateLegacyTokens`, saveTokens/getStoredTokens/clearTokens).
- **Detect next time:** grep any new credential/token write for `AsyncStorage`
  — tokens, API keys, and refresh tokens belong in SecureStore, full stop.
- **Prevent:** `__tests__/emailTokenSecureStore.test.js` (SecureStore reads,
  migration + plaintext deletion, no-clobber of an already-migrated blob);
  connect/disconnect suites now assert against the SecureStore map.

## 103. Rotating deviceIds drained the project-wide OCR/LLM budgets — a month-long scan outage anyone could trigger

**Date:** 2026-07-16

- **Symptom:** none observed yet — found by the high-load audit. `/api/ocr` and
  `/api/ocr-llm` are unauthenticated and rate-limited **per deviceId only** —
  but deviceId is a client-chosen string. A script rotating ids minted a fresh
  30/hour (Vision) or 20/day (Gemini) allowance per fake device; the only
  remaining backstop was the PROJECT-WIDE monthly Vision / daily Gemini budget,
  so one abuser could exhaust it and 503 receipt scanning for **every user
  until the window rolled** (the same rotation hole PR #162 had already closed
  on `/api/observations/tag`, but the OCR routes were never given the brake).
- **Root cause:** per-key limits keyed on a client-controlled identifier bound
  one *identifier*, not one *actor*.
- **Fix:** secondary per-IP budget on both routes, keyed on the RIGHTMOST
  X-Forwarded-For hop (the only one the platform edge appends and a client
  can't forge), capped at `OCR_IP_LIMIT_MULTIPLIER` (5×) the per-device
  allowance so a warehouse/mall NAT of legitimate scanners never trips it.
  Entries live in the existing swept maps (no new leak surface).
- **Files:** `backend/server.js` (`checkOcrRateLimit`/`checkLlmRateLimit`
  gained override caps; both routes check `ip:<addr>` after the device check).
- **Detect next time:** any limiter keyed on deviceId (or another
  client-supplied id) on a route that spends money/quota needs a second,
  non-forgeable key — audit new spend routes for both.
- **Prevent:** `tests/ocrRateLimit.test.js` per-IP cases (override caps,
  429 with zero upstream calls, per-IP isolation, sweep eviction).

## 104. One forged x-device-id header silently dropped up to ~100 audit-log rows per flush

**Date:** 2026-07-16

> **SUPERSEDED 2026-07-23:** this entire class of bug is gone — the API audit log
> moved off the database to structured JSON on stdout (the "Longer-term
> alternative" below, taken further). There is no more DB table, FK, buffer, or
> batch INSERT, so a forged `x-device-id` can no longer drop a batch. The files
> named here (`backend/repos/auditRepo.js`, `tests/auditRepoFkFallback.test.js`)
> were **deleted**. Kept for the historical lesson: raw client-supplied ids
> under an FK poison bulk writes. See `backend/middleware/audit.js`.

- **Symptom:** gaps in `api_audit_log` — the first-stop production diagnostic
  ("check api_audit_log first") simply missing windows of traffic, with only a
  server-side `[audit] bulkInsert failed, dropping N rows` log line as a trace.
- **Root cause:** the audit middleware stores the client-supplied `x-device-id`
  header RAW, and `api_audit_log.device_id` carries an FK to `devices`. Any
  request bearing an unregistered/forged id poisoned the whole buffered batch:
  the single bulk INSERT hit the FK violation and ALL rows (up to
  AUDIT_FLUSH_AT=100) were dropped — innocent rows included. Same wall for
  `user_sub` when an account deletion raced a flush.
- **Fix:** `auditRepo.bulkInsert` catches SQLSTATE 23503 and retries once with
  `device_id` nulled (user attribution survives), then once more with
  `user_sub` nulled as the last resort; non-FK errors still rethrow to the
  middleware's existing drop-and-log path.
- **Files:** `backend/repos/auditRepo.js`.
- **Detect next time:** watch for `[audit] bulkInsert FK violation` warnings;
  a burst means someone is probing with forged device ids.
- **Prevent:** `tests/auditRepoFkFallback.test.js` (stage-1/stage-2 retries,
  non-FK rethrow, attribution preserved). Longer-term alternative: drop the FK
  from a breadcrumbs table entirely — noted, not done (FK integrity is still
  worth keeping while the retry makes it harmless).

## 105. The verified-drop sweep's scan grew without bound — full price-history + full user-base reads every ~4s tick

**Date:** 2026-07-16

- **Symptom:** none yet in production (small data) — flagged by the 2026-07-16
  scale audit as THE remaining DB-CPU hole: under steady scan traffic the
  observation-debounced sweep fires every ~4s per region, and each tick's
  `findNotifiable` read the ENTIRE province price_points history, while a
  drop-bearing tick loaded EVERY push-token user's notification settings.
- **Root cause (two unbounded reads on a high-frequency path):**
  1. `priceDropRepo.findNotifiable`'s `fresh` CTE had no scan floor — the
     `OR pp.verified OR flyer OR adminVerified` age-exemption terms defeat any
     time bound, so verified/flyer rows accumulated forever kept the scan
     growing forever — and no product prefilter, so price history for products
     nobody watches was scanned anyway.
  2. `priceDropNotifier._buildGate` → `settingsByToken()` loaded the settings
     map for ALL users with a push token to gate a handful of pushes.
- **Fix:**
  1. `watched` CTE prefilter (products with a live watched line: watch_enabled,
     unclaimed, undeleted, push-token owner — output-identical since only those
     can produce a notification) backed by partial index
     `receipt_items_watch_live_idx` (migration `0005_smiling_kulan_gath`), plus
     a hard `PRICE_DROP_LOOKBACK_DAYS` scan floor (default 120, DB-tunable,
     clamped to ≥ PRICE_VERIFY_WINDOW_DAYS) that even the age-exempt terms
     respect. 120d ≫ window(14) + max store policy window (30), so no
     still-claimable purchase can lose a drop — only pushes for windows long
     expired (worthless) are shed.
  2. `settingsByToken(tokens)` optional scope; the sweep gate now passes just
     the tokens it is about to push.
- **Files:** `backend/repos/priceDropRepo.js`, `backend/priceDropNotifier.js`,
  `backend/repos/notificationSettingsRepo.js`, `backend/db/schema.js`,
  `backend/config/defaults.js`, migration `0005_smiling_kulan_gath.sql`.
- **Detect next time:** Supabase DB CPU climbing with scan traffic; sweep log
  lines (`[VerifiedDrop] sweep …`) slowing down.
- **Prevent (the pattern):** anything wired to `scheduleVerifiedDropSweep`'s
  debounce cadence (or any per-request/per-observation trigger) must read a
  WORKING SET, never a table that only ever grows — same class as #103's
  budget drain and the credit_ledger seq-scan: ask "what bounds this read in
  year 3?" before shipping a hot-path query. Tests:
  `tests/priceDropDb.test.js` (lookback floor + windowDays clamp),
  `tests/notificationSettingsRepoDb.test.js` (token scope).

## 106. Unauthenticated side-effecting endpoints (sweep trigger + observation wipe)

- Date: 2026-07-16 · PR: (this session) · Area: backend
- Symptom: none observed in prod — found in a security audit. Two routes took
  effect with no credential:
  - `POST /api/check-all` fired `runScheduledChecks` + `runVerifiedDropSweep`
    (province-wide DB scans, external scraper calls, and drop **push
    notifications**) with no auth and no throttle. Anyone could loop it to burn
    DB/scraper budget and force-fire pushes.
  - `DELETE /api/me/observations` wiped every crowdsourced observation for a
    `deviceId` taken from the body, with no ownership check — a signed-in
    account could erase another account's device data by passing its id (IDOR),
    the same class the 2026-06-02 pass fixed for `/api/me/account` and
    data-export.
- Root cause: both predate the auth conventions. `/api/check-all` was a
  "manual trigger (for testing)" left wired to the app; the observation-wipe
  route trusted the `deviceId` capability but never enforced it against the
  bearer identity when one was present.
- Fix: `/api/check-all` now `_adminTokenOk`-gated (same `x-admin-token` as the
  other ops routes — the mobile app never calls it; users trigger their own
  check via the authenticated `/api/me/check-drops`). `DELETE
  /api/me/observations` now resolves `optionalAuthUser` and, when a token is
  present, requires `callerOwnsDevice` before deleting (403 on mismatch);
  anonymous callers keep trust-on-first-use, matching the other deviceId-keyed
  routes.
- Files: `backend/server.js` (`/api/check-all`, `DELETE /api/me/observations`).
- Detect next time: grep `app.(post|delete|put)` for routes with side effects
  that lack `requireAuth` / `_adminTokenOk` / a rate-limit guard.
- Prevent: tests — `tests/missingRoutes.test.js` (check-all rejects unauth,
  200 only with the admin token) and `tests/securityDb.test.js` (non-owner gets
  403 on the observation wipe, owner gets 200). Standing rule: any new route
  that scans/notifies/deletes must carry an auth or admin-token gate before it
  runs, not just input validation.

## 107. "Reset All Data" re-armed the topup replay protection — one store purchase could mint credits forever

- Date: 2026-07-17 · PR: (this session) · Area: backend / money
- Symptom: none observed in prod — found in the account-lifecycle audit. The
  exploit chain: buy a credit pack (ledger row written, ref = store transaction
  id) → "Reset All Data" (or delete account + re-sign-in) → POST the SAME
  transaction id to `/api/me/credits/topup` again → credits minted again.
  Repeatable indefinitely: the transaction stays in the RevenueCat subscriber's
  non-subscription history forever, so the PR #161 trustless RC verification
  passes every time.
- Root cause: ALL of `recordTopupOnce`'s global replay protection lived in
  `credit_ledger` rows (`WHERE type_id='topup_purchase' AND ref=?`), and the
  WS3 erasure change made `resetData`/`requestDeletion` physically DELETE the
  user's ledger rows — silently deleting the dedupe state with them. Same class
  in the referral settle guard: `user_referrals.*_reward_ledger_id` are FK'd
  `ON DELETE SET NULL` to the ledger, so after both parties wiped, the
  referee's next purchase paid BOTH bonuses again. The stale comment on
  `creditsRepo.listForUser` still claimed "the rows stay in the table for
  billing/reconciliation" — the invariant died without its comment.
- Fix: idempotency state moved OUT of the deletable ledger into wipe-proof
  state (migration `0006_bitter_roxanne_simpson`, backfilled):
  - new `topup_refs` table — one row per settled store transaction, unique on
    `ref`, `user_sub` FK `ON DELETE SET NULL` so even a hard account purge
    keeps the ref burned. `recordTopupOnce` checks/writes it (same advisory
    lock); `firstTopup` (the one-time auto-reload opt-in) now counts it too,
    so a reset can't re-fire the opt-in.
  - `user_referrals.settled_at` — authoritative once-only settle stamp; the
    ledger ids remain as audit pointers. `listReferees.rewarded` reads it.
- Files: `backend/db/schema.js` + migration 0006, `backend/repos/creditsRepo.js`,
  `backend/repos/referralsRepo.js`.
- Detect next time: any dedupe/once-only guard that READS a table some flow
  DELETES from is a time bomb. Grep new `.delete(` calls against every
  "idempotent on"/"exactly once" comment that names the same table.
- Prevent: `tests/lifecycleDedupeDb.test.js` — replay after reset, replay after
  delete+reactivate, firstTopup after reset, double-settle after both-party
  wipe. Standing rule: idempotency markers live in dedicated tables that no
  user-triggered erasure touches (erasure anonymizes the link, never unburns
  the ref).

## 108. Receipt photos in R2 were never deleted — "delete my account" left the images forever

- Date: 2026-07-17 · PR: (this session) · Area: backend / privacy
- Symptom: none user-visible — found in the account-lifecycle audit. Receipt
  photos upload to R2 at `receipts/{sub}/{receiptId}.jpg`, but NOTHING ever
  deleted the objects: not `DELETE /api/receipts/:id` (soft delete), not
  `DELETE /api/me/account` (soft delete + ledger wipe), not the monthly
  `purgeDeletedAccounts` (hard-deletes rows via FK cascade — which also
  destroys the only copy of the object keys). Tag photos got a 30-day
  retention prune per the PIA; receipt photos were missed, so the "full
  erasure (PIPEDA 4.5 / Law 25 §28 / GDPR Art 17)" claim on the delete route
  was false for the most personal artifact we store.
- Root cause: image upload was bolted onto receipts after the deletion paths
  were designed; no retention job was added alongside the presign flow.
- Fix: new daily `jobs/pruneReceiptImages.js` (wired into
  `runDbRetentionJobs`, 03:30 UTC) — deletes the R2 object + clears
  `receipts.image_object_key` for receipts soft-deleted more than
  `RETENTION_DELETED_RECEIPT_IMAGES_DAYS` (default 7, DB-tunable) days ago.
  Account deletion soft-deletes every owned receipt, so its photos are gone
  ~day 7, well before the day-30 purge cascades the rows (and keys) away.
  Live receipts keep their photo — the user can still open it.
- Files: `backend/jobs/pruneReceiptImages.js`, `backend/repos/receiptsRepo.js`
  (`findDeletedImagesOlderThan`/`clearImageKey`), `backend/config/defaults.js`,
  `backend/server.js` (retention wiring).
- Detect next time: every presigned-PUT flow needs a paired deletion story the
  day it ships — grep `getPresignedPutUrl` callers and demand a matching prune
  job or delete hook.
- Prevent: `tests/pruneReceiptImages.test.js` (job semantics incl. R2-failure
  retry) + the prune-helper cases in `tests/lifecycleDedupeDb.test.js` (only
  soft-deleted receipts past the window are targets; live receipts never).
## 109. Concurrent scans could over-draw the credit balance — the floor was a stale read

- Date: 2026-07-17 · PR: (this session) · Area: backend / money
- Symptom: none reported — found in the critical-path atomicity audit. A user
  with 1 credit firing N parallel receipt POSTs (or offline-scan batch items)
  could get N scans recorded for 1 credit and a NEGATIVE `users.scan_credits`.
- Root cause: `consumeScanCreditOnce` read the balance, checked
  `bal < spend`, then applied the decrement. Its advisory lock keys on
  `(userSub, ref)` — it exists to dedupe the SAME scan across the online and
  offline paths — so two scans with DIFFERENT refs never serialize: both read
  the same last credit, both pass the check, both decrement. The ledger stays
  consistent with the balance (both go negative together), so even the daily
  reconciliation cron sees no drift — the invariant that silently broke was
  "a spend is only written when the user can cover it."
- Fix: the floor moved into the UPDATE itself —
  `SET scan_credits = scan_credits - N WHERE sub = ? AND scan_credits >= N`
  with the ledger row appended in the same transaction. Exactly one concurrent
  spend can win; losers report `insufficient` with the live balance.
- Files: `backend/repos/creditsRepo.js` (`consumeScanCreditOnce`).
- Detect next time: any balance/quota floor expressed as `SELECT` → `if` →
  `UPDATE` is a race unless the lock covers ALL writers of that balance, not
  just retries of the same logical operation. Put floors in the WHERE clause.
- Prevent: `tests/criticalPathAtomicity.test.js` — 4 genuinely parallel spends
  with distinct refs against 1 credit must yield exactly 1 win and a
  non-negative balance, plus floor/idempotency semantics pinned.

## 110. POSTing a receipt id owned by another account echoed THAT account's receipt back

- Date: 2026-07-17 · PR: (this session) · Area: backend / security
- Symptom: none reported — found in the critical-path audit. Receipt ids are
  client-generated primary keys (`r_<ms>_<rand>`). `POST /api/receipts` with an
  id that already exists returned `created:false` plus the EXISTING row — with
  no ownership check. An authenticated caller replaying/guessing another
  user's receipt id read that user's receipt (store, totals, purchase date,
  warehouse — IDOR). The honest-collision variant is worse for data: the
  second user's receipt was silently swallowed (never saved) while their
  client treated `created:false` as "already synced" and dropped it.
- Root cause: the `onConflictDoNothing` fallback was written for the
  same-user retry (idempotent sync) and assumed every conflict was one.
- Fix: the conflict path now checks the existing row's `user_sub`; a
  cross-account collision throws `RECEIPT_ID_CONFLICT`, which the route maps
  to `409 { error: "receipt_id_conflict", retryable: false }` — a terminal
  4xx, so the client keeps the receipt safely local instead of marking it
  synced. Same-user retries keep the exact `created:false` contract. No
  charge lands on a refused POST (the consume runs after create succeeds).
- Files: `backend/repos/receiptsRepo.js` (create conflict path),
  `backend/server.js` (409 mapping).
- Detect next time: every "return the existing row on conflict" fallback on a
  client-generated key needs an ownership check — conflicts are not always
  the same caller retrying.
- Prevent: `tests/criticalPathAtomicity.test.js` — cross-account create on a
  taken id rejects with `RECEIPT_ID_CONFLICT`, owner's row intact, same-user
  retry still `created:false`.

## 111. Drop commissions: a DB blip billed Unlimited subscribers; per-step rounding drifted the total

- Date: 2026-07-17 · PR: (this session) · Area: backend / money
- Symptom: none reported — found in the critical-path VALUE audit (round 2 of
  the 2026-07-17 audit loop). Two independent defects in the verified-drop
  sweep's commission math:
  (a) the exemption lookup ran as `usersRepo.getBySub(sub).catch(() => null)`
  and `isCreditExempt(null)` is false — so a TRANSIENT DB error while
  resolving an Unlimited subscriber's profile billed them a full commission.
  Permanently: the `price_drop_notifications` dedupe row blocks any later
  re-election, so there is no retry that could refund it.
  (b) each deeper drop billed `round(Δ × 15)` for its own step. Rounding every
  step independently is path-dependent: $10.00 → $9.96 → $9.92 billed 1 + 1 =
  2 credits while a straight $10.00 → $9.92 bills round(1.2) = 1; conversely
  3¢ steps each rounded to 0 forever. The code's own documented invariant —
  lifetime total = dropChargeCredits(paid − lowest) — did not hold.
- Root cause: (a) "error" and "no row" collapsed into one value at the lookup,
  and the safe default for "no row" (free tier, billable) is the WRONG default
  for "unknown"; (b) rounding applied per increment instead of per lifetime
  total.
- Fix: (a) a THROWN lookup marks the buyer exemption-unknown and every one of
  their drops sits the sweep out — not recorded, not pushed, not charged; the
  drop stays pending and re-elects next sweep. A null profile still means
  free tier (the receipt's FK guarantees the user row exists, so null is a
  real answer, not an error). (b) the charge is now the difference of
  lifetime totals: `dropChargeCredits((paid − new) × qty) −
  dropChargeCredits((paid − prior) × qty)` — telescoping, so any path of
  drops sums to exactly `dropChargeCredits(paid − lowest)`.
- Files: `backend/priceDropNotifier.js` (exemption resolution + `chargeFor`).
- Detect next time: on a billing path, `.catch(() => null)` (or any
  error→default collapse) means an infrastructure failure silently picks a
  side. Decide explicitly which side a charge site fails to — and it is
  almost never "charge". And when an incremental fee documents a lifetime
  invariant, bill differences of rounded TOTALS, never rounded differences.
- Prevent: `tests/priceDropChargeGuards.test.js` (no-DB: thrown lookup skips
  the buyer wholesale, Unlimited notified-not-billed, both rounding
  directions) + `tests/priceDropCommission.test.js` stepped micro-drop case
  against the live schema.

## 112. Receipt price points accepted $0/negative/absurd prices; purchaseDate was unvalidated

- Date: 2026-07-17 · PR: (this session) · Area: backend / data integrity
- Symptom: none reported — found in the critical-path VALUE audit. The
  tag-scan pool has a range gate (0.50–5000 + outlier check) but the
  receipt-derived pool had NONE:
  (a) a line with no readable price was minted as a **$0.00** observation
  (`it.price == null ? 0`), a mixed receipt's lone negative return line
  entered the pool negative (the all-negative refund heuristic doesn't fire
  on mixed receipts), and an absurd OCR misread passed unchallenged. If N
  accounts' parsers glitch the same way on the same product (or N actors
  collude), the rule of N would VERIFY the bogus group → "Now $0.00" pushes
  → full-price commissions debited from every watcher of that product.
  (b) `POST /api/receipts` accepted any `purchaseDate` string: a future date
  stamped the receipt's price points with a future `observed_at` — an
  observation that stays inside every freshness window indefinitely — and an
  unparseable one 500ed inside the insert transaction.
- Root cause: the pool's input guards grew up on the tag path; the receipt
  bulk-write predates them and was never retrofitted. Dates were trusted
  because the client always sends `YYYY-MM-DD` — the server contract didn't
  say so.
- Fix: (a) `pricesRepo.isPoolableUnitPrice` (finite, ≥ $0.01, < $5000) gates
  the bulk insert; the floor is a cent — not the tag scan's 50¢ — because a
  receipt's unit price is lineTotal ÷ qty and a 24-pack's unit is
  legitimately ~$0.42. Rejected lines still upsert their product row, so the
  receipt item keeps its FK; they just contribute no observation. (b) the
  route validates purchaseDate: `YYYY-MM-DD`, round-trips through
  `Date.parse` (V8 rolls "2026-02-31" over to Mar 3 instead of rejecting —
  the round-trip catches it), and is at most today+1d (timezone slack) →
  terminal 400 otherwise. Past dates stay accepted (old receipts are
  importable; their adjustment windows are simply expired).
- Files: `backend/repos/pricesRepo.js` (`isPoolableUnitPrice`,
  `recordReceiptPricePointsBulk`), `backend/server.js` (receipt POST).
- Detect next time: every path that writes into a SHARED pool (one users'
  write influences other users' money events) needs its own input sanity
  gate — "another path validates" only holds until someone calls this one.
  And `Date.parse` alone never validates a calendar date in V8; round-trip it.
- Prevent: `tests/receiptPricePoints.test.js` — out-of-range lines persist as
  items but pool nothing (while a $0.42 unit still pools), and
  bad/future purchaseDates are terminal 400s with no partial state.

## 113. Flyer DB persist bypassed normalizeOffer — rejected offers still entered price_points

- Date: 2026-07-18 · PR: (this session) · Area: backend / data integrity
- Symptom: none reported — found in the critical-path INGEST-SURFACE audit
  (round 3). `commitFlyerImport` runs two phases: Phase 1 ingests into the
  in-memory overlay through `flyerPricing.normalizeOffer` (region, 4–8-digit
  sku, REQUIRED ISO validFrom≤validUntil window, 0 < promo < 100000,
  cent-rounding); Phase 2 persists to `price_points` — but rebuilt its rows
  from the RAW `items` array with only `it.sku` truthiness +
  `Number.isFinite(price)` checks. So an item the overlay REJECTED still
  landed in the DB pool: a negative promoPrice (`Number.isFinite(-5)` is
  true), a garbage sku, a regular-only item persisted at full price as if it
  were an offer, and a window-less item written with NULL `valid_until`
  (an immortal offer row). Flyer rows are the WORST place for poison: the
  drop sweep treats source `flyer` as tier-1 authoritative — beats every
  other source, needs NO rule-of-N verification, is exempt from the age
  cutoff — and `region:"ALL"` fans one bad row out to all 13 provinces,
  where a fake "drop" pushes notifications and debits commissions from
  every watcher of the product.
- Root cause: the validation lived only on the overlay side, and the
  comment on `commitFlyerImport` even claimed "strict per-offer validation
  … runs inside _ingestFlyerBatch" — true for Phase 1, silently false for
  Phase 2, which re-derived everything from the unvalidated input. The two
  phases drifted because they mapped the same `items` independently.
- Fix: `ingestFlyerBatch` now also returns `acceptedOffers` (the normalized
  offers that entered the overlay); Phase 2 persists EXACTLY those — same
  sku/price/window the overlay serves, printed validFrom/validUntil
  guaranteed present. Defense-in-depth: `pricesRepo.recordPricePoint` gained
  a hard range backstop (finite, > 0, < 100000 — normalizeOffer's own
  ceiling, looser than the tighter upstream tag/receipt gates so it never
  rejects a legitimately validated row).
- Files: `backend/flyerPricing.js` (`ingestFlyerBatch`),
  `backend/server.js` (`commitFlyerImport` Phase 2),
  `backend/repos/pricesRepo.js` (`recordPricePoint` range guard).
- Detect next time: when one input feeds TWO representations (in-memory +
  DB, cache + store, summary + detail), the validated form must be the
  single source both write from — re-mapping the raw input on the second
  path is where "validated" quietly stops being true. Same lesson as
  Bug #112's rule: every shared-pool write path needs its own sanity gate.
- Prevent: `tests/flyerPricing.test.js` (acceptedOffers = normalized accepts
  only), `tests/flyerAdminRoutes.test.js` (HTTP import with poison items →
  only the accepted offer reaches `recordPricePointsBulk`),
  `tests/repoValidation.test.js` (range backstop rejects 0/negative/NaN/
  Infinity/"garbage"/100000/1e9).

## 114. priceSweep starved by restarts — interval-from-boot timer never fired; cron-only legs stalled

- Date: 2026-07-18 · PR: (this session) · Area: backend / scheduling
- Symptom: found in the goal-step-2 prod health sweep, via `job_runs`: with a
  1440-minute (daily) `PRICE_SWEEP_INTERVAL_MINUTES`, prod recorded only 2
  priceSweep runs in 7 days and none in the last 3 — while every wall-clock
  cron (digest, maintenance, retention) fired daily without a miss.
- Root cause: `sweepScheduler` schedules with `setInterval(ms)` — an
  interval-FROM-BOOT countdown that resets on every deploy/restart. A process
  cycled more often than the interval never reaches its first tick. The other
  jobs use `cron.schedule` (wall-clock) and are immune. The sweep tick is the
  ONLY place `settleAllVerified` (deferred price-tag credit release) and
  `recomputeOverduePolicyStatuses` (receipt watching→claimed/expired healing)
  run — so users' earned tag credits silently stopped being released. The
  verified-drop sweep has other triggers (post-flyer-import, per-user
  check-drops, debounced region sweeps) and degraded less.
- Fix: boot catch-up. `sweepScheduler.sweepCatchUpDue({lastOkAt,
  intervalMinutes, now})` (pure) + `jobRunsRepo.lastOkRun(jobName)` (newest
  SUCCESSFUL run — failures don't count, so an always-failing job still
  catches up). startServer fires ONE sweep ~3 min after boot iff the last OK
  run is at least a full interval old. Idempotent (sweep dedupe ledgers /
  settle elections) and self-limiting (after one success, restarts inside the
  interval don't re-fire); the delay keeps a crash-loop off the scrape leg.
- Files: `backend/sweepScheduler.js`, `backend/repos/jobRunsRepo.js`,
  `backend/server.js` (startServer wiring, c8-ignored entrypoint — the two
  helpers carry the tests).
- Detect next time: any `setInterval`-scheduled job whose interval is
  comparable to the deploy cadence is a job that may NEVER run — either
  schedule on wall-clock cron or pair the interval with a persisted
  last-run check at boot. `job_runs` is the detector: expected-runs-per-week
  vs actual.
- Prevent: `tests/sweepScheduler.test.js` (catch-up due/not-due matrix incl.
  the prod incident shape), `tests/jobRunsRepoDb.test.js` (lastOkRun skips
  newer failures; null for all-failed and never-run jobs).

## 115. Paid credit pack could never credit — single-shot confirm POST, no retry, dead webhook

- Date: 2026-07-18 · PR: (this session) · Area: mobile
- Symptom: user buys a credit pack, Google Play charges them, the app says
  "{credits} credits are now on your account" — but the balance never
  increases. Money gone, no credits, and nothing in the app ever fixes it.
- Root cause: after `subscriptionManager.purchasePackage()` resolves (payment
  APPROVED), the ledger grant depended on exactly two paths: (1) one
  fire-and-forget `confirmPackPurchaseToBackend` POST — if it failed (network
  blip, backend 5xx, app killed right after the store dialog) nothing retried
  it and the store transaction id was lost; (2) the RevenueCat webhook — which
  on prod has NEVER delivered an event (`REVENUECAT_SECRET_KEY`/webhook ops
  item still pending). So a transient failure in that one POST = permanently
  paid-but-uncredited. `purchaseProduct` also returned `success:true` with the
  "credits are on your account" alert regardless, so the failure was invisible.
- Fix: durable confirm queue (`pending_topup_confirms_v1`). Every REAL store
  transaction is enqueued BEFORE the first confirm attempt and removed only on
  server confirm or terminal refusal (`retryable:false`, e.g. sandbox);
  `flushPendingTopupConfirms()` retries the rest on boot, on app foreground,
  and on every live balance read (`fetchServerCredits`). The backend's
  `recordTopupOnce` is idempotent on the transaction id, so replays can't
  double-credit. `confirmPackPurchaseToBackend` now surfaces
  `{status, retryable}` (honouring the server's own `retryable` body flag);
  the firstTopup auto-reload opt-in applies even when the confirm only lands
  on a later flush. UI: `purchaseProduct` returns `creditsPending:true` when
  the confirm hasn't landed, and BuyCredits/Paywall show "will be added
  automatically within a few minutes" instead of claiming the credits arrived.
- Files: `src/services/purchaseService.js` (queue + `confirmPackPurchaseDurably`
  + `flushPendingTopupConfirms`), `src/services/bootService.js`, `App.js`
  (foreground flush), `src/screens/BuyCreditsScreen.js`,
  `src/components/Paywall.js`, `src/services/i18n.js`
  (`paywall.packPurchasedPendingBody` EN+FR).
- Detect next time: any money handoff that relies on a single POST with no
  durable local record is a loss waiting for a network blip — especially while
  the prod RC webhook stays undelivered. Compare Play Console orders vs
  `credit_ledger` topups; a paid order with no ledger row is this bug.
- Prevent: `__tests__/pendingTopupConfirms.test.js` (queue-before-attempt,
  transient-keep/terminal-drop matrix incl. 402 RC-lag vs 402 sandbox, expiry,
  signed-out no-network, flush heal, firstTopup-on-retry, purchaseProduct
  creditsPending contract).

## 116. Offline claim / watch-stop lost forever — server kept billing and pushing on a closed item

- Date: 2026-07-18 · PR: (this session) · Area: mobile
- Symptom: user claims a price adjustment at the store (typically OFFLINE at
  the service desk) or stops watching a product; later they still get "price
  drop" pushes for that item, further drop commissions are charged on it, and
  a reinstall/new device shows the item unclaimed and watched again.
- Root cause: `markItemClaimed` / `stopWatchingItem` mirrored the change
  server-side with one fire-and-forget POST. On failure (offline, 5xx, signed
  out) the change existed only locally: server `receipt_items` kept
  `watch_enabled=true, claimed_at=NULL`, so `findNotifiable` kept electing
  drops on the line — repeat pushes AND `recordNotified` commission charges on
  an item the user already closed out. The code comment claimed "offline
  claims ride a later resync", but no resync path existed: receipts get a
  `syncPending` retry, deletes get tombstone queues, while claims/watch had
  nothing — and the receipt POST body carries NO claim fields, so a claim on a
  not-yet-synced receipt had literally no road to the server.
- Fix: durable per-item edit queue (`receipt_item_edits_pending`), mirroring
  the item-delete tombstones: enqueue on transient/signed-out/404 failure with
  the {lineTotal, quantity} fingerprint, coalesced per (receipt, item, kind) —
  a claim supersedes a queued watch-off (the claim route ends the watch in the
  same write). `retryPendingReceiptItemEdits()` drains on boot, foreground,
  and after hydrate-triggered receipt pushes — ordered AFTER
  `retryPendingReceiptSyncs`, so a claim whose receipt only just synced lands
  in the same pass; a 404 (receipt not on the server yet) keeps the entry
  queued, unlike the delete queue where 404 means done. Entries expire at 90d
  or when the local receipt disappears (its delete tombstone owns the server
  copy).
- Files: `src/services/storageService.js` (queue, `claimItemOnBackendDurably`,
  `setItemWatchOnBackendDurably`, `retryPendingReceiptItemEdits`,
  `flushPendingItemEdits`), `src/services/bootService.js`, `App.js`,
  `src/services/syncService.js` (drain triggers).
- Detect next time: every local state change that the server ACTS on (billing,
  notifications, sweeps) needs a durable retry queue, not a fire-and-forget
  POST — audit any `.catch(() => {})` around an `authedFetch` mutation. In
  data: `receipt_items` rows with `claimed_at IS NULL, watch_enabled=true`
  whose user keeps receiving drops they never claim.
- Prevent: `__tests__/storageServiceItemEdits.test.js` (enqueue on
  transient/signed-out/404, none on success, claim-supersedes-watch
  coalescing, drain matrix incl. keep-on-404 + purge-gone-receipt + 90d
  expiry, endpoint/fingerprint contract).

## 117. Notification-pref toggle flipped offline was silently lost AND reverted — server kept pushing disabled categories

- Date: 2026-07-19 · PR: (this session) · Area: mobile
- Symptom: user turns a notification category off (or on) while offline / on a
  bad connection; the server keeps sending exactly those pushes, and a little
  later the toggle in the app flips itself back to the old state.
- Root cause: the Notifications screen mirrored the toggles with ONE
  fire-and-forget `syncProfileToBackend({notificationPrefs}).catch(() => {})`.
  A failed push had no retry — and unlike the cloud preferences (which carry
  an LWW `updatedAt` clock), the hydrate fold was unconditionally server-wins:
  `_applyPrefs` copied the server's 9 toggles over local prefs on every
  hydrate. So the user's change wasn't just lost server-side; the next
  boot/foreground actively reverted it locally too.
- Fix: durable profile outbox `profile_sync_pending_v1`
  (`src/services/profileSyncQueue.js`): enqueue BEFORE the first attempt,
  coalesce to current state, clear only what the server confirmed (a toggle
  made mid-flush survives), drain on boot + foreground + after every hydrate.
  While `hasPendingNotificationPrefs()` — or when a flush landed after the
  bootstrap fetch started (`lastSuccessfulFlushAt() >= fetchedAt`) — the
  hydrate fold is skipped: LOCAL wins until the push lands, then server and
  local agree.
- Files: `src/services/profileSyncQueue.js` (new),
  `src/screens/NotificationsScreen.js`, `src/services/syncService.js`
  (fold guard + drain), `src/services/bootService.js`, `App.js`.
- Detect next time: any client setting the server consults for outbound
  actions (pushes, emails, billing) that is mirrored up WITHOUT a queue and
  restored down WITHOUT a clock/pending check will ping-pong exactly like
  this. Grep for `syncProfileToBackend(...).catch(() => {})`.
- Prevent: `__tests__/profileSyncQueue.test.js` (enqueue-before-attempt,
  confirmed-clear, coalescing, mid-flush survival, single-flight),
  `__tests__/syncServiceHydrate.test.js` (fold skipped while pending /
  mid-hydrate flush, fold still applies when idle),
  `__tests__/notificationsScreenDurableSync.test.js` (screen seam),
  `__tests__/bootService.test.js` (boot drain).

## 118. Marketing-push consent withdrawal could silently never reach the CASL ledger — and the UI reverted the choice

- Date: 2026-07-19 · PR: (this session) · Area: mobile
- Symptom: user withdraws (or grants) marketing-push consent in Profile while
  offline; server-driven marketing sends keep following the OLD state, and on
  the next Profile focus the toggle snaps back to the server's value.
- Root cause: the consent event rode the same fire-and-forget
  `syncProfileToBackend({consents:[...]})` as Bug #117 — no retry — while the
  Profile screen deliberately re-reads the server consent ledger on every
  focus and overwrites the local optimistic pref. A dropped withdrawal is a
  CASL §6 problem: the authoritative ledger never records it, so future sends
  stay "consented", and the audit trail is wrong.
- Fix: consent events ride the same durable outbox (coalesced per
  consentType — a later toggle supersedes the queued one; the ledger stamps
  arrival). The focus re-read skips the server overwrite while
  `hasPendingConsent("marketing_push")` — local wins until the event lands.
  The returning-user T&C/privacy re-affirmation in OnboardingScreen now rides
  the queue too instead of being droppable.
- Files: `src/screens/StoresAndProfileScreens.js` (toggle + focus guard),
  `src/screens/OnboardingScreen.js` (durable re-affirm),
  `src/services/profileSyncQueue.js`.
- Detect next time: consent state is an APPEND-ONLY LEDGER server-side — any
  client write to it must be durable, and any UI that re-syncs FROM the
  ledger must yield while a local event is still queued.
- Prevent: `__tests__/profileSyncQueue.test.js` (consent per-type coalescing,
  withdrawal supersedes grant, malformed entries ignored).

## 119. "Reset All Data" wiped the device even when the server reset failed — old credits/receipts resurrected at next hydrate

- Date: 2026-07-19 · PR: (this session) · Area: mobile
- Symptom: user runs Reset All Data while offline / during a backend blip;
  the app looks freshly reset, then the next boot/foreground hydrate quietly
  restores the old credit balance and all receipts from the server — the
  exact state the user asked to erase.
- Root cause: `runReset` called `resetMyData(deviceId)` inside
  `try {} catch {}` and IGNORED the result, then wiped local storage
  unconditionally. The server-side zero (credits + receipt soft-delete) is
  the only thing that makes the reset stick, because hydrate is deliberately
  server-authoritative — a failed server call turned the reset into a no-op
  with a delay.
- Fix: the local wipe is now gated on `canProceedWithLocalReset(result)`
  (authService): server `ok` proceeds; `auth_required` /
  `backend_unconfigured` proceed local-only (there is genuinely no linked
  server data to reset); ANY transient failure (network, 5xx, thrown) blocks
  with a retry alert — the same contract account deletion already had. New
  i18n `profile.resetFailedTitle/-Body` (EN+FR).
- Files: `src/screens/StoresAndProfileScreens.js` (`runReset`),
  `src/services/authService.js` (`canProceedWithLocalReset`),
  `src/services/i18n.js`.
- Detect next time: any destructive local action whose server half is
  best-effort inverts into silent data resurrection wherever the server is
  authoritative on hydrate. Deletes/resets must confirm server-side first or
  block visibly.
- Prevent: `__tests__/authServiceApi.test.js` (proceed/block matrix incl.
  null/undefined results).

## 120. Home tracked-item name/label hidden under the Claim button when a % drop chip is present

- Date: 2026-07-19 · PR: (this session) · Area: mobile (HomeScreen)
- Symptom: on the Home "tracked products" list, a row with a detected drop
  (so it shows a `−N%` chip + the "Claim" button) partially hid the row's
  chips / warehouse label behind the button.
- Root cause: the middle column (`flex:1, minWidth:0`) truncates the item
  NAME fine, but its inner `chipRow` had no `flexWrap` and the warehouse
  label no truncation. React Native doesn't clip child overflow by default,
  so once the extra `−%` chip widened the row past the (shrunk) column, the
  chips/label rendered OVER the right-hand savings+Claim column.
- Fix: `chipRow` → `flexWrap:"wrap"` (chips wrap instead of overflowing); the
  warehouse label → `numberOfLines={1}` + `flexShrink:1` (truncates rather
  than pushing width); the right column → `flexShrink:0` (keeps its width so
  the flexible middle column yields).
- Detect next time: any row = fixed-width sibling + `flex:1` text column +
  a same-row chip strip. Truncating the headline text is not enough — a
  non-wrapping chip strip inside the flexible column still overflows under
  the sibling because RN doesn't clip.
- Prevent: layout-only; covered by `screensSmoke` render.

## 121. Offline "price tags ready to review" notification never arrived

- Date: 2026-07-19 · PR: (this session) · Area: mobile (tag queue + notifications)
- Symptom: a user who scanned price tags on a poor/no signal in-warehouse
  never got the "your scans are ready to review" notification once back
  online.
- Root cause (two gaps): (1) the offline queue worker
  (`processPendingTagScans`) is only triggered on cold boot, on a
  background→active transition, and by the once-a-day background-fetch. A
  user who scanned in-store and never left the app (the normal case — signal
  simply returns) never re-triggered it, so the photos were never OCR'd and
  the notification never fired. Worse, a blind trigger while still offline
  burned the per-entry OCR attempt budget (MAX 5) and could strand an entry
  in `error`, so it would never auto-process again. (2) `sendTagScansReady-
  Notification` scheduled against the Android "scan-processing" channel,
  which is only created inside `registerForPushNotifications` — a function
  that bails early (no EAS projectId / emulator / permission not yet
  granted); a missing channel silently drops the notification.
- Fix: (a) `_process` now probes `/health` reachability FIRST and skips
  cleanly when offline (no attempt burned) — safe for every trigger. (b)
  App.js runs a cheap 60s foreground poll (one AsyncStorage count read; only
  probes/OCRs when something is waiting) so a return-to-connectivity while
  the app stays open drains the queue and fires the alert. (c) channel setup
  extracted to a shared idempotent `ensureAndroidChannels()`, called before
  scheduling the "ready" alert so the channel always exists.
- Detect next time: any "do X when the network comes back" flow that has no
  connectivity listener (this app has no NetInfo) depends entirely on
  app-lifecycle transitions — which don't fire when the app is already
  foregrounded. And any local notification is only as reliable as its
  Android channel; never assume push-token registration created it.
- Prevent: `__tests__/tagScanQueue.test.js` (offline-skip, no attempt burn),
  `__tests__/notificationService.test.js`.

## 122. Active price-adjustment claims lapsed with too little warning (only 3-day / 1-day)

- Date: 2026-07-19 · PR: (this session) · Area: mobile + backend config
- Symptom: a still-redeemable claim could quietly run out its 30-day window;
  the app can also still mark an expired item claimed (DetailScreen `hasDrop`
  isn't `days`-gated), so users lost real refunds with little heads-up.
- Root cause: the only claim-window reminders fired 3 days and 1 day before
  expiry — a drop detected early left a long silent gap before any nudge.
- Fix: added `scheduleEarlyClaimReminder` — an earlier lead-time reminder
  (`EXPIRY_EARLY_WARNING_DAYS`, default 7, DB-tunable via app_config, mirrors
  `EXPIRY_WARNING_DAYS` end-to-end) with its own identifier
  (`expiry-early-<id>`) and distinct copy. Same gates as the other claim
  reminders (`notifClaimReminders` category + a real detected unclaimed
  drop), self-skips when it would collide with the 3-day warning or when the
  drop is detected late (inside the early window). Wired into
  cancel/sync/reconcile alongside the existing two.
- Detect next time: reminder cadence with only near-deadline alerts leaves an
  early-detection blind spot; lead-time matters as much as last-chance.
- Prevent: `__tests__/notificationService.test.js` (early-reminder block:
  identifier, fires-earlier-than-3-day, truthfulness + category gates).

## 123. Register markers ("SELF-CHECKOUT", "AGE VERIFIED") welded into product names

- Date: 2026-07-19 · PR: (this session) · Area: mobile (receipt parser) + shared (ocrCleanup)
- Symptom: parsed Costco items named `SELF - CHECKOUT HANNAS WW 10` or
  `AGE VERIFIED DEPOSIT VL` — receipt-structure text glued onto the real
  product name (and from there into price_points / the watch UI). Same class
  as Bugs #67 (the `START OF PRE-SCANNED ITEMS` banner weld), with vocabulary
  the cleanup didn't know: the self-checkout lane marker printed above the
  first item, and the age-check stamp printed beside restricted items. A
  cousin: `BOB Count O` (count digit OCR-misread as letter O) left a stray
  `O` that renamed the next item `POWERWASH O` once the label was scrubbed.
- Root cause: `shared/ocrCleanup.js` scrubbed only the PRE-SCANNED banner
  vocabulary inline. Other register/cart markers survived cleanup as bare
  letter lines sitting directly above an item row — exactly the shape of a
  wrapped product-name head, so `extractItems`' pendingNamePrefix carry
  prepended them to the next item's name. Geometry row-welds put the same
  words INSIDE an item row, where only an inline (substring) scrub can
  remove them without killing the item.
- Fix (three layers, one vocabulary): (a) BANNER_NOISE_RES in
  shared/ocrCleanup.js gained the marker phrases — self-checkout (EN/FR
  `LIBRE-SERVICE`, any hyphen/spacing tokenization), age-verified (EN/FR,
  `\b` is ASCII-only so the accented `ÂGE` form is its own alternative),
  `Bottom of Basket`/`BAS DU PANIER`/`BOB Count N` inline (count token —
  digits or the O/0 misread — eaten only when whitespace/asterisks/end
  follow, so a welded SKU can never be truncated); BANNER_WORD_RE gained the
  word-level vocabulary for welded geometry rows. (b) `scrubItemNameNoise`
  (the last-resort name scrub every parsed item passes through) inherits the
  same list, and now also trims a trailing space-separated orphan
  punctuation token (`SMOKED SALM .`). (c) `extractItems` scrubs the
  pendingNamePrefix carry and the append-to-previous fragment through
  `scrubItemNameNoise`, so a marker line can never become a name head even
  on uncleaned input.
- Detect next time: an item name containing register vocabulary means the
  cleanup's marker list is missing a phrase — fix the LIST in
  shared/ocrCleanup.js (one vocabulary, three consumers), never a one-off
  strip in the parser. Watch the goldens: any marker fix must show up ONLY
  as name/rawTextDigest improvements. And beware partial scrubs: removing a
  label but stranding its value (`BOB Count O` → `O`) creates NEW noise that
  defeats the "no letters left" residue check.
- Prevent: `__tests__/ocrCleanup.test.js` (marker lines EN/FR, weld scrub,
  SKU-safety, trailing-punct trim), `__tests__/receiptParsingShared.test.js`
  (engine-level carry guard on uncleaned input),
  `costcoReceiptParser.realocr.test.js` (FORBIDDEN_AFTER_CLEANUP now bans
  SELF-CHECKOUT / AGE VERIF on every fixture + exact-name pins for the three
  field receipts), re-pinned `receiptGolden` snapshots.

## 124. Receipt scan was lost with no connection (price tags queued, receipts didn't)

- Date: 2026-07-20 · PR: (this session) · Area: mobile (scan + queue + notifications)
- Symptom: scanning a receipt in a warehouse with no/poor signal made the user
  wait out the full OCR timeout and then dead-ended on a scan-error alert; the
  capture was gone and they had to re-shoot the receipt (often after leaving
  the store). The price-tag scan in the very same app handled this correctly —
  it queued the photo — so the inconsistency read as a receipt-scan bug.
- Root cause: only the tag flow was ever given an offline path (`tagScanQueue`
  + `PendingTagScan`). `ScanScreen.processImage` went straight to OCR with no
  reachability probe, and its `catch` funneled a dead connection into the
  generic "scan error" alert — a terminal branch that discarded the URI. There
  was no receipt-side queue, so nothing could recover the capture afterwards.
- Fix: `src/services/receiptScanQueue.js` mirrors the tag queue (AsyncStorage
  list + photo persisted to `documentDirectory/receipts_pending/`, worker
  gated on the SAME `probeReachable` `/health` ping, drained from cold boot /
  foreground / 60s poll / background-fetch). ScanScreen probes first and
  queues when unreachable, and its catch now routes a `classifyError` of
  `network`/`timeout` to the queue instead of the error alert. Reviewing
  happens on `PendingReceiptScanScreen` (`Review & save` re-opens ScanScreen
  preloaded via `queuedScanId`; saving drops the entry).
  **Billing parity is the subtle part** — the worker re-checks `canAddReceipt`
  before spending money on OCR (0-credit users' photos just wait), a rejected
  gas/refund read spends 1 credit exactly like online, and an unreadable read
  spends nothing. Without that, offline scanning is a free-OCR loophole.
- Detect next time: when one capture flow gets an offline queue, audit the
  SIBLING flows the same day — the user reads them as one feature and any gap
  looks like data loss. Also grep for `catch` branches that end in an alert
  while holding a still-usable file URI: that is a capture being thrown away.
  A queued worker that runs paid work must repeat the payment gate the
  interactive path does; the gate the user passed at capture time may no
  longer hold when the worker finally runs.
- Prevent: `__tests__/receiptScanQueue.test.js` (state machine + both credit
  gates + offline skip without burning the attempt budget),
  `__tests__/scanScreenOfflineQueue.test.js` (offline capture queues and never
  bills or OCRs; queued entry loads and clears on save),
  `__tests__/pendingReceiptScanScreen.smoke.test.js`, plus a per-file coverage
  floor on `receiptScanQueue.js` in `jest.config.js` (it spends credits).
  Two related holes this shook out: the notification tap handler only routed
  `tag_scans_ready`, so the new alert would have opened nothing (it now routes
  both types); and one boot drain's SYNCHRONOUS import throw could skip every
  drain declared after it — including the money paths — so each is isolated
  (`bootService.js` `drain()`, pinned by a bootService regression test).

## 125. A transaction that checks out a SECOND pooled connection deadlocks the pool

- Date: 2026-07-20 · PR: (this session) · Area: backend (db/client, credits/users/recon repos)
- Symptom: the Bug #109 guard test `N concurrent spends with DIFFERENT refs on
  1 credit` failed in CI with `timeout exceeded when trying to connect`
  (pg-pool) — never reaching a single assertion — while passing locally every
  time. It looked like a flaky concurrency test; it was neither flaky nor a
  concurrency bug in the code under test.
- Root cause: `lookupId()` resolved its cache miss on `getDb()` — the POOL —
  and four money paths called it from INSIDE an open transaction
  (`consumeScanCreditOnce`, `recordTopupOnce`, `upsertFromOAuth`'s signup
  grant, `creditReconRepo.apply`), as did the tx-scoped helpers
  `applyCreditChangeTx`, `_ledgerRowForTx` and `appendMigrationSeed`. A
  transaction already holds one connection, so the lookup asks for a SECOND.
  Once concurrency reaches the pool max, every connection is held by a
  transaction waiting for a connection that only another of those transactions
  can release: a textbook starvation deadlock that unwinds only when
  `connectionTimeoutMillis` (5s) fires on each racer. `ensureSeeded()`, also
  awaited inside `lookupId`, made it worse by pulling more pool connections.
  It only bites on a COLD lookup cache — a warm cache short-circuits before the
  query — which is why the whole class hid in local runs.
  CI vs local was the pool budget, nothing more: CI writes `DB_POOL_MAX=3`
  (Supabase's session pooler caps total connections) while local defaults to 5,
  and the test hard-coded 4 racers. So the test was ALSO wrong: it demanded
  pool_max+1 connections.
- Fix: `lookupId(table, code, exec)` takes an optional executor; every
  in-transaction caller passes `tx`, so one transaction = one connection. The
  four constant-code money-path lookups are additionally hoisted ABOVE their
  transaction (the id is append-only, so resolving it early is free and warms
  the cache). On a transaction `lookupId` now reads FIRST and only calls
  `ensureSeeded()` on a genuine miss, so a seeded DB never touches the pool
  there. The test derives its racer count from `DB_POOL_MAX` instead of
  hard-coding 4, and asserts ≥2 racers so a smaller pool can't silently degrade
  it into a no-op.
- Detect next time: **any I/O inside a transaction that does not run on `tx` is
  a second connection.** Grep for helpers taking `tx` as a parameter — a
  literal-`.transaction(` scan misses those and it is where three of these
  hid. A "connection timeout" in a concurrency test is a pool-budget bug, not a
  logic race: check `DB_POOL_MAX` against the test's concurrency before
  suspecting the code under test. And a guard test that only ever ran green
  locally has never actually guarded anything — this one failed 1/1 in CI.
- Prevent: `backend/tests/criticalPathAtomicity.test.js` — new
  "concurrency ABOVE the pool max still completes" test deliberately clears the
  lookup cache (`shutdown()`), oversubscribes the pool (`DB_POOL_MAX + 2`
  racers) and asserts every spend completes. It fails pre-fix with the exact
  connect timeout, so the guard has teeth.

## 126. Local and CI ran different test environments (the parity rule)

- Date: 2026-07-20 · PR: (this session) · Area: CI + both test runners
- Symptom: "passes locally, fails in CI" was structurally possible — and had
  already happened once for real (Bug #125, a production pool-starvation
  deadlock invisible to every local run for days). Five separate divergences
  existed at once:
  | | local | CI |
  |---|---|---|
  | backend pool | `DB_POOL_MAX` unset → **5** | **3** (written into `.env` by the workflow) |
  | backend concurrency | `--test-concurrency=4` (`npm test`) | `1` (`npm run test:coverage`) |
  | backend coverage ratchet | not run by `npm test` | enforced |
  | mobile coverage ratchet | not run by `npm test` | enforced (`test:ci`) |
  | mobile snapshots | writes a missing snapshot and PASSES | `CI=true` → **fails** |
  | Node | 24 (developer machine) | 22 (pinned in the workflow) |
- Root cause: test parameters lived in `.github/workflows/test.yml` (which only
  CI reads) and in the gitignored `backend/.env` (which only the local machine
  reads). Neither is shared, so the two environments could never be verified
  equal. The default `npm test` on both runners was also weaker than the CI
  gate, so "I ran the tests" did not mean "CI will pass".
- Fix — one rule: **the workflow may check out, install, supply credentials, and
  run `npm test`. Nothing else.** Every behavioural parameter moved into
  committed config that both sides read: `backend/test.env` (new, committed,
  no secrets — holds `DB_POOL_MAX=3`, loaded AFTER `.env` so it wins over a
  stray local value), the `package.json` scripts (`npm test` IS the gate on
  both runners: c8 + `--test-concurrency=1` for backend, `--ci --coverage` for
  mobile, with `test:ci`/`test:coverage` reduced to `npm test` aliases), and
  `.nvmrc` (both jobs use `node-version-file`, so the Node major cannot drift).
  `--ci` moved from a workflow `env:` into the mobile script itself, so missing
  snapshots now fail locally exactly as they do in CI. `test:fast` is the only
  escape hatch and differs from the gate by coverage alone.
- Detect next time: if a fix needs an env var to reproduce a CI failure, that
  var is a parity bug — put it in committed config, don't export it in your
  shell. A real shell variable still overrides everything, which is the intended
  way to run a one-off experiment (`DB_POOL_MAX=5 npm test`) without making it
  the default for one side only.
- Prevent: `__tests__/ciParity.test.js` parses the workflow and both
  package.json files and fails if CI runs anything but `npm test`, if the
  workflow writes any key other than `DATABASE_URL`, if it sets `DB_POOL_MAX` /
  `CI: true` / `--test-concurrency`, if the Node version is hardcoded instead of
  read from `.nvmrc`, or if `test:fast` drifts from the gate by more than
  coverage. Verified to fail when a CI-only knob is reintroduced.

---

## 127. Every scan fails ("Our service is having a hiccup") — GCP **billing disabled** on the Vision project (recurrence of #81, but masked as "unreachable")

- **Date:** 2026-07-23 · **PR:** _(this session)_ · **Area:** ops (Google Cloud billing) + backend guardrail
- **Symptom:** On the freshly built **Play internal-test** (production-profile)
  build, **every** purchase/refund scan fails with the friendly server error
  **"Our service is having a hiccup. Please try again in a few minutes — our team
  has been notified."** (`err.serverBody`). Receipts show only the hero card with
  **no line items**. `/health` looks fine: `healthy:true`, `ocr:"configured"`,
  `db:ok`. This is the same class as **#81** — see it first.
- **Root cause:** Google Cloud **billing is disabled on the Vision project
  (#200005505988)**, so Cloud Vision rejects every `images:annotate` call with
  **403 "This API method requires billing to be enabled."** Unlike #81 (an
  invalid/unauthorized key), here the **key is valid** (present, 39 chars,
  `AIza…`, no whitespace) — billing simply lapsed. Even the free 1000-unit/month
  tier requires an **active billing account linked**. Both dev and prod share the
  project, so **both** environments' OCR are down.
  > ⚠️ **Extra masking wrinkle vs #81:** on prod the billing-403 came back as an
  > **HTML** page, so `callVisionOcr`'s `res.json()` **threw**, and `POST /api/ocr`
  > caught it as **502 "OCR service unreachable"** (the `catch` path, not the
  > clean 403→"authentication failed" path). Dev surfaced the honest 403; prod hid
  > it behind "unreachable". The definitive proof was the Railway log line
  > `[OCR] Vision returned 403: This API method requires billing to be enabled …`
  > alongside `[OCR] Network error: Unexpected token '<', "<html><hea"… is not valid JSON`.
- **Fix — the real one is OPERATIONAL (no deploy fixes it):** re-enable billing
  on GCP project **#200005505988** →
  `https://console.developers.google.com/billing/enable?project=200005505988`
  (link a valid billing account / fix the payment method). Propagation takes a
  few minutes, then scans recover with **no** app or backend change.
- **Fix — code guardrail shipped alongside:** `backend/lib/visionOcr.js`
  `callVisionOcr` now parses the Vision body **defensively** — a non-JSON (HTML)
  error body no longer throws; it returns the true `status` with a synthesized
  `error.message`. So a billing/API-disabled/edge-block 403 is now mapped by the
  caller as a **403** (→ clean "authentication failed" 502 + a truthful server
  log), and `/health?probe=ocr` reports `unauthorized` instead of `unreachable`.
  Test: `backend/tests/visionOcr.test.js` ("…non-JSON (HTML) error body").
- **Detect next time:** the #81 one-liner still pins it —
  `curl --ssl-no-revoke -X POST <backend>/api/ocr -H "Content-Type: application/json" -d '{"deviceId":"diagnostic-probe-000001","base64":"<≥100-char b64>","mimeType":"image/jpeg"}'`
  → **502** on prod. Then read the truth in **Railway logs** (`railway logs` on
  the linked prod service → grep `[OCR]`) or `GET <backend>/health?probe=ocr&token=<FLYER_ADMIN_TOKEN>`.
  A 403 whose message says **"requires billing"** = this bug, not a bad key.
- **Prevent:** keep a valid billing account linked to the Vision project even for
  free-tier usage; treat a Vision 403 as a page-me ops alert. The `?probe=ocr`
  health probe is the durable canary — wire it into uptime monitoring so a
  billing lapse is caught before users hit it. (Longer-term UX gap noted: the
  2.8.0 scan path shows the generic `err.serverBody` "hiccup" instead of #81's
  intended "Scanning temporarily unavailable → manual entry" fallback — worth
  restoring so an OCR outage still lets users enter receipts by hand.)
- **DONE (2026-07-23):** `?probe=ocr` is now wired into monitoring two ways —
  (a) a proactive server-side cron (`runOcrAuthProbeCheck`, `OCR_AUTH_PROBE_CRON`,
  default 4×/day) that pages via the existing ops-alert email the moment the probe
  stops returning `ok`, no external setup required; (b) the endpoint itself is
  documented for an external uptime monitor to hit as a second, independent
  channel. See `docs/Environment_Configuration.md` "OCR (Vision) auth probe" and
  `backend/tests/ocrAuthProbeCron.test.js`.

## 128. Google Sign-In failed with a raw `ApiException: INTERNAL_ERROR` (a transient Play Services hiccup surfaced as a hard failure)

- **Date:** 2026-07-24 · **PR:** _(this session)_ · **Area:** mobile auth (`authService.signInWithGoogle`)
- **Symptom:** Sentry issue (release **2.8.0**, production) —
  `com.google.android.gms.common.api.ApiException: INTERNAL_ERROR`, `handled:yes`,
  `flow:signin_google`, 2 events on a single OnePlus 8 Pro / Android 11. The
  breadcrumb chain shows `SignInHubActivity destroyed` → back to `MainActivity`:
  the Google Sign-In sheet opened, then closed with the internal error. The user
  saw the generic **"Something went wrong. Please try again"** (`err.unknownBody`).
- **Root cause:** GMS `CommonStatusCodes.INTERNAL_ERROR` (**code 8**) is a
  **transient Google Play Services failure**, not an app/config bug. It is NOT the
  package-rename `DEVELOPER_ERROR` (code 10) from the sign-in-recovery note — a
  real config error fails **every** sign-in, whereas this was 2 events on one
  device. `signInWithGoogle`'s catch only recognized `SIGN_IN_CANCELLED` /
  `IN_PROGRESS` / `PLAY_SERVICES_NOT_AVAILABLE` and re-threw everything else, so a
  recoverable hiccup became a user-facing failure + a Sentry event.
- **Fix:** ① In `authService.signInWithGoogle`, wrap `hasPlayServices` + `signIn`
  in an up-to-two-attempt loop: a first-attempt **transient GMS error**
  (`isTransientGmsError` — `code === 8`/`"8"` or message matches `INTERNAL_ERROR`)
  is retried once after a 300 ms backoff before it ever reaches the user; a
  persistent one still throws (no infinite loop). This matches Google's own
  "retry on INTERNAL_ERROR" guidance. ② `errorSupport.classifyError` now routes a
  surviving Play Services error (`com.google.android.gms` / `INTERNAL_ERROR` /
  `play services`) to the **`server`** bucket → the honest "our service is having
  a hiccup, try again in a few minutes" copy instead of generic "unknown".
- **Tests:** `__tests__/authServiceSignIn.test.js` — retry-then-succeed (message &
  numeric-code forms) + persistent-error-rethrown-after-one-retry;
  `__tests__/errorSupport.test.js` — INTERNAL_ERROR → `server` / `err.serverBody`.
- **Detect next time:** a `signin_google` Sentry issue with `INTERNAL_ERROR` and a
  low event count on one device is a transient GMS glitch — do not chase config.
  A `DEVELOPER_ERROR` (code 10) affecting *many* users is the real config alarm
  (SHA-1 / OAuth client — see the android-package-rename recovery note).
- **Follow-up (2026-07-24, release hardening):** `signInWithGoogle` now classifies
  the full set of documented GMS status codes, not just INTERNAL_ERROR —
  transient `INTERNAL_ERROR(8)`/`INTERRUPTED(14)`/`TIMEOUT(15)` retry once;
  `NETWORK_ERROR(7)` surfaces a connectivity message (no pointless 300 ms retry);
  `DEVELOPER_ERROR(10)` is rethrown untouched to stay loud in Sentry; a raw
  `CANCELED(16)` is treated as a silent cancellation. Helpers `isTransientGmsError`
  / `isGmsNetworkError` / `isGmsDeveloperError` / `matchesGmsCode` centralize the
  matching (numeric code, numeric-string code, or message substring). Tests in
  `__tests__/authServiceSignIn.test.js`.

---

## #126 — Phantom sub-dollar "price drop" the app showed but the server never pushed

- **Date:** 2026-07-25 · **PR:** _(this session)_ · **Area:** price-drop detection
  (mobile `priceService` / `DetailScreen`, backend `priceDropRepo.findNotifiable`)
- **Symptom:** closed-test build. An 18% cream 1L scanned at **$4.39**. No
  price-drop notification ever arrived, but tapping **Refresh prices** showed a
  **$0.10** drop to $4.29 — a price the user couldn't account for.
- **Root cause — two independent bugs, both on the client side of the same
  comparison:**
  1. **Unverified prices leaked into drop detection.** `/api/check-price` is a
     *display* endpoint: it asks `priceDropRepo.getLatestVerifiedPrice` for
     `includeUnverified: true` so a single not-yet-corroborated crowd
     observation can still be SHOWN, tagged "Unverified · X/N shoppers". Both
     client detection paths (`checkAllPriceDrops`, DetailScreen's manual
     refresh) then compared that price straight against what was paid —
     `currentPrice < paidPrice` and nothing else. The backend sweep
     (`findNotifiable`) correctly refused it (rule of N unmet, or the price was
     never available *after* the purchase date), which is exactly why no push
     ever fired. **Client and server disagreed by construction.**
  2. **No materiality floor anywhere.** Even a verified $0.10 delta counted as a
     drop, on every path — in-app chip, push, and the credit commission that
     rides the notification.
- **Fix:**
  - New ops knob **`PRICE_DROP_MIN_SAVINGS`** (`backend/config/defaults.js`,
    default **$1.99**, category `crowd_verification`). Per **unit**, because the
    store grants the adjustment per unit. Live-tunable via `app_config`/env, no
    redeploy; `0` disables it. Auto-seeds — no migration.
  - Enforced in `priceDropRepo.findNotifiable`'s final `WHERE`
    (`unit_paid - new_price >= floor`) so a sub-floor delta produces **no row →
    no dedupe ledger entry → no commission charge**, and the line stays eligible
    for a later real drop. Also in both legacy in-memory sweeps in `server.js`
    (flyer overlay + web scrape) via `minDropSavings()`.
  - New client predicate **`qualifiesAsDrop()`** in `src/services/priceService.js`
    — the single definition of "real drop", used by BOTH client paths. Rejects
    `source: "price_points_unverified"` / `verified.verified === false`, and
    applies the same floor, shipped to the app via `pricing.json`
    (`getMinDropSavings()`, bundled fallback in `shared/pricing.config.js`).
    Sources with no verification block (non-Costco scrape, device re-scrape) are
    unaffected.
  - Compares in **whole cents** client-side: `4.39 − 2.40` is
    `1.9899999999999998` in binary float and would fail a `>= 1.99` test at the
    exact boundary, while the backend compares Postgres `numeric` (exact).
- **Tests:** `__tests__/qualifiesAsDrop.test.js` (new — floor boundaries,
  override, `0`, verification gate, malformed input); `__tests__/priceServiceDrops.test.js`
  (floor + unverified blocks, per-unit semantics); `__tests__/detailScreenDropNotify.test.js`
  (sub-floor and unverified refreshes notify nothing and write no drop state);
  `backend/tests/priceDropDb.test.js` (new *materiality floor* describe — $0.10
  not notifiable, full drop bills off the untouched paid price afterwards,
  `minSavings: 0`/`5` overrides, per-unit on a qty-4 line).
- **Detect next time:** "the app shows a drop but I got no notification" is
  almost always **client detection disagreeing with `findNotifiable`**, not a
  push-delivery problem. Check the `source` field on `/api/check-price` first:
  `price_points_unverified` means display-only. **Rule: any client-side price
  comparison that decides "this is a drop" must go through `qualifiesAsDrop`
  — a display price is not a claimable price.**

## 129. VS Code shows ~135 phantom "changes" — a stale nested `.git` inside `backend/` (recurrence)

**Symptom.** The Source Control tree in VS Code / the GitHub extension lists a
huge number of modified files (135 in the 2026-07-30 occurrence) while
`git status` at the repo root reports a perfectly clean tree.

**Cause.** `backend/` contained its own `.git` directory — a leftover from when
the backend was briefly scaffolded as a standalone repo. It was **not** a
submodule: the parent repo tracked all 193 `backend/**` files normally (index
mode `100644`, not a `160000` gitlink), and the nested repo had **no remote**,
sat on `master`, and its last commit was months stale (`2026-06-23`). VS Code
discovers nested repositories automatically and shows each one as its own
source-control provider, so it was reporting the nested repo's 133 files of
accumulated drift on top of the parent's real state.

**Diagnosis.**

```bash
find . -name .git -maxdepth 4      # more than one hit = nested repo
git ls-files -s backend | head -3  # 100644 => tracked normally, NOT a submodule
git -C backend remote -v           # empty => orphan, nothing to lose upstream
git -C backend log -1 --format=%ci # stale date => abandoned
```

**Fix.** Back the orphan history up, then delete only the nested `.git`:

```bash
git -C backend bundle create /tmp/backend-stale-repo-backup.bundle --all
rm -rf backend/.git
```

No file content is lost — the files on disk are the same ones the parent repo
has been tracking all along; only the orphan commits go, and the bundle keeps
those.

**Rules.**
- **A phantom-changes count that `git status` doesn't corroborate is an editor
  showing you a *different repository*, not a broken working tree.** Always
  `find . -name .git -maxdepth 4` first.
- Before deleting any nested `.git`, prove it's an orphan and not a submodule:
  check the parent's index mode for those paths, and check for a remote.
- Never `git init` inside a subdirectory of this repo.

**Watch out for the stale stat-cache.** In this occurrence the first
`git status` reported only 2 modified files; a later index refresh revealed a
third (`app.json`) that had been modified all along. If a diff contradicts an
earlier `git status`, re-run `git status` after `git update-index --refresh`
rather than trusting the first read.

## 130. R8 build fails with `Missing class expo.modules.core.MapHelper` (a dangling reference in a prebuilt Expo AAR)

**Symptom.** The first Android release build after enabling R8 (`enableMinifyInReleaseBuilds`, PR #218) dies in `:app:minifyReleaseWithR8` after ~22 minutes of otherwise-clean compilation:

```
ERROR: Missing classes detected while running R8. Please add the missing classes
       or apply additional keep rules that are generated in
       .../build/outputs/mapping/release/missing_rules.txt.
ERROR: R8: Missing class expo.modules.core.MapHelper
       (referenced from: boolean
        expo.modules.location.taskConsumers.LocationTaskConsumer
          .shouldReportDeferredLocations())
> Task :app:minifyReleaseWithR8 FAILED
```

Note what this is **not**: R8's feared failure mode is silent runtime breakage of reflective lookups. This one is a hard build-time stop, which is the friendly case — the toolchain tells you exactly what it can't resolve.

**Cause.** Expo SDK 54+ ships its modules as **prebuilt AARs**, not source. `expo-location`'s AAR was compiled against an older `expo-modules-core` that still exported `expo.modules.core.MapHelper`; SDK 55 dropped the class. The dangling reference is invisible without minification — nothing ever has to resolve it — but R8 must build a full class hierarchy, and it treats an unresolvable reference as fatal regardless of whether the referencing method is reachable.

**Diagnosis.** EAS build logs are **brotli-encoded** (`Content-Encoding: br`) and are not exposed by any `eas-cli` command, so pull them via the GraphQL API:

```bash
curl -s -X POST https://api.expo.dev/graphql \
  -H "Authorization: Bearer $EXPO_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query($id:ID!){builds{byId(buildId:$id){status error{errorCode message} logFiles}}}","variables":{"id":"<build-uuid>"}}'
# then: curl -sL -o raw.bin "<logFiles[0]>"
#       node -e "console.log(require('zlib').brotliDecompressSync(require('fs').readFileSync('raw.bin')).toString())"
```

Each log line is a JSON object with a `msg` field. `grep "Missing class"` gives the complete list — R8 reports **all** of them at once, so you fix them in a single pass rather than one build at a time.

Then confirm the class is genuinely gone, and decide whether the call site is live:

```bash
grep -rl MapHelper node_modules/     # only the CALLER matches => the class truly does not exist
grep -n "startLocationUpdatesAsync\|getCurrentPositionAsync" src/services/locationService.js
```

**Fix.** Additive, in `app.json` → `expo-build-properties` → `android.extraProguardRules`:

```proguard
-dontwarn expo.modules.core.MapHelper
```

`-dontwarn`, **not** `-keep`. A keep rule cannot manufacture a class that does not exist; `-dontwarn` is the mechanism that downgrades "missing class" from fatal to ignored. Reach for `-keep` only when the class exists and something looks it up reflectively.

Safe here because the reference is dead code in this app: it sits on the background `LocationTaskConsumer` deferred-updates path, and `locationService.js` only ever calls `getCurrentPositionAsync` — background location updates are never started. If we ever *do* start them, that method would `NoClassDefFoundError` at runtime with or without R8; the `-dontwarn` neither causes nor hides a new bug.

**Rules.**
- **Scope `-dontwarn` to the exact class, never the package.** `-dontwarn expo.modules.core.**` would silently swallow the next genuine removal. One line per missing class, each with a comment saying why it's dead.
- **Before suppressing, prove the call site is unreachable from this app.** If it is reachable, the fix is a dependency bump or dropping the module — not a suppression, which would only trade a build failure for a crash.
- `android/` is gitignored: EAS re-prebuilds from `app.json`, so a proguard change needs **no** native re-commit. Editing `android/app/proguard-rules.pro` locally does nothing for a cloud build.
- **A build-time R8 failure does not validate R8 at runtime.** Getting the build green only unblocks the on-device checklist (sign-in, IAP, camera, push, updates, Sentry symbolication) — it does not substitute for it.

**Occurrence.** 2026-07-30, build `f6156674` (preview, commit `e12cafd`). Fixed in PR #219.

## 131. A compliance claim that no longer matched the code — Gmail receipt data was reaching the backend

**Class:** silent drift between a documented guarantee and the call chain that implements it.
Worth reading even if you never touch Gmail: the failure mode generalises.

**Symptom.** None. Nothing was broken, no test failed, no user complained. The defect was
only visible if you traced a call chain that a document *asserted* was safe.

`Publishing-Compliance/Google_OAuth_Verification_CASA.md` §4 stated that Gmail message
content never leaves the device, and the whole Google OAuth restricted-scope submission
was to be filed on that claim. The claim was written from the shape of one function name
— `storageService.saveReceipt`, "which is local AsyncStorage".

**What was actually true.** `saveReceipt` writes AsyncStorage *and then* mirrors to the
backend:

```
EmailSyncScreen.js:124   saveReceipt(receipt)
storageService.js:196    → receiptSyncService.syncReceiptToBackend(newReceipt)
receiptSyncService.js:31 → toApiBody(...)  →  POST /api/receipts
```

For a Gmail receipt, `items[].name` and `items[].lineTotal` are strings and numbers parsed
straight out of the **message body**, and they fed `price_points` — the catalog shared with
other users. The raw body, subject and message id never crossed (they aren't in
`toApiBody`), but the extracted content did.

**Fix.** A gate at the top of `syncReceiptToBackend` returning
`{ skipped: true, gmailLocalOnly: true }` before any network call. Gmail receipts are
local-only, unconditionally. Parsers now tag `emailProvider: "gmail" | "outlook"` so
Outlook (not covered by Google's policy) keeps syncing; a legacy receipt with no provider
tag **fails closed**.

**Why it survived so long.** Three things, each of which is the reusable lesson:

1. **A doc asserted a property of the code without citing the call chain.** "saveReceipt is
   local storage" was true of the function's *name* and its first line, and false of its
   behaviour. When a document makes a safety claim, cite the chain, not the function.
2. **The dangerous step was a fire-and-forget dynamic import**, 60 lines below the
   AsyncStorage write and after the `return`-shaped happy path. Easy to miss when skimming.
3. **Nothing tested the negative.** There were tests that sync *works*; none that it
   *doesn't happen* for a class of receipt. Guarantees of the form "X never leaves the
   device" need a test asserting the transport was never called —
   `expect(mockAuthedFetch).not.toHaveBeenCalled()`.

**Guard.** `__tests__/receiptSyncGmailLimitedUse.test.js` (17 tests).

**Generalised rule.** If a compliance document, privacy policy, or store-listing answer
claims the code does or doesn't do something, that claim needs a test that fails when the
claim stops being true. Prose can't hold a guarantee — every re-verification is a fresh
chance to be wrong in the same direction.

## 132. Play Console "recommended actions" that no code change alone can clear — and the two thirds of one that framework code owns

**Symptom.** After the 2.8.1 production release, Play Console raised three recommended
actions: deprecated edge-to-edge APIs, resizability/orientation restrictions on large
screens, and "your app is not optimized" (R8).

**The reusable lesson is in how differently the three resolved.** Reading the Play
Console text carefully *before* writing code changed the fix in two of the three cases.

**(a) "Not optimized" was already fixed — and still true.** R8 had been enabled at
commit `e12cafd` (#218). But version code 21 was cut at `4c21f74`, *earlier*. Play scans
the artifact on the track, not the repo. **A fix that has not been shipped in a build with
a higher version code does not exist as far as Play is concerned.** The action here was a
version bump, not a code change. Before "fixing" a Play recommendation, check whether the
flagged version code predates the fix — `git log -S'"versionCode": N' -- app.json` against
the commit that landed the fix answers it in one command.

**(b) The edge-to-edge list was mostly not ours.** Play named seven call sites. Six were
inside React Native core (`StatusBarModule`, `WindowUtilKt`) and Material Components
(`BottomSheetDialog`, `SheetDialog`, `EdgeToEdgeUtils`, reached via react-native-screens).
Material was *already* on 1.13.0 — the newest release — so there was nothing to upgrade to.
Those classes sit in the dex whether or not anything calls them.

Exactly one was ours: `StatusBarModule$setColor$1.runGuarded`, reached from
`<StatusBar backgroundColor={COLORS.bg} />` in `App.js`. expo-status-bar has deprecated
that prop — under edge-to-edge it has **no visual effect at all** — but passing it still
routes a call into the deprecated `Window.setStatusBarColor`. Removing it is a pure win:
zero visual change, one fewer deprecated call.

The initial plan had been to strip `android:statusBarColor` / `android:navigationBarColor`
from the generated `styles.xml`. The Play Console detail listed **no theme attribute** —
the scan is dex-only. That work would have been wasted, and worse: those attributes are
what keeps the bars transparent on API < 35, so removing them would have caused an opaque
status bar on Android 10–14. **Get the actual flagged list before designing the fix.**

**(c) The orientation fix needed a runtime half.** Play named three activities:
`MainActivity` plus two closed-source Play Services scanner activities
(`GmsBarcodeScanningDelegateActivity` from expo-camera,
`GmsDocumentScanningDelegateActivity` from react-native-document-scanner-plugin). Deleting
`android:screenOrientation` from our own activity is easy; the naive version of that ships
a portrait-designed UI that now rotates on every phone.

The shape that works:
- `plugins/withAndroidLargeScreenSupport.js` deletes the attribute from MainActivity, sets
  `android:resizeableActivity="true"`, and overrides the two library activities with
  `tools:replace="android:screenOrientation"` (the only lever available against a
  closed-source AAR's manifest).
- `src/services/orientationService.js` re-applies a portrait lock **at runtime** whenever
  the smallest screen dimension is under 600dp. Phones behave exactly as before; tablets
  and unfolded foldables rotate. Re-runs on `Dimensions` change so folding works live.
- `app.json` keeps `"orientation": "portrait"` because that value also drives iOS's
  Info.plist, where there is no large-screen case (`supportsTablet: false`). Only Android's
  copy is stripped, and only by the plugin.

Play's scan reads the merged manifest, not runtime calls, so this is not a dodge — it is
the supported way to keep a portrait phone UI while genuinely lifting the restriction that
Android 16 will ignore anyway.

**Mod ordering, again.** Deleting an attribute Expo's own `withOrientation` mod wrote works
because plugins listed in `app.json` run *after* Expo's platform mods. Same property
`withAndroidPermissionCleanup` relies on.

**Verification without a device.** `npx expo prebuild --platform android --no-install`
regenerates `android/` and the assertions are greppable:
```
grep -o '<activity[^>]*>' android/app/src/main/AndroidManifest.xml
grep -c 'screenOrientation="portrait"' android/app/src/main/AndroidManifest.xml   # → 0
grep enableR8 android/gradle.properties                                          # → true
```

**Guards.** `__tests__/withAndroidLargeScreenSupport.test.js`,
`__tests__/withAndroidR8FullMode.test.js`, `__tests__/orientationService.test.js`,
`__tests__/edgeToEdgeDeprecations.test.js`. The last one is a **source-text** scan, on
purpose: the regression is "someone re-adds a deprecated prop", which no render test would
catch — the prop renders fine and simply does nothing.

**Generalised rule.** A store's "recommended actions" list is a set of *findings about a
specific uploaded artifact*, not a to-do list for the repo. Split it three ways before
touching code: what is already fixed but unshipped, what is framework-owned and can only be
documented, and what is genuinely ours. Fixing the middle category is where the wasted
effort lives.

## 133. The large-screen orientation "fix" was itself a regression — reverted, and must not be re-attempted

**This entry exists to stop the fix from being re-applied.** Google Play will keep
recommending "Remove resizability and orientation restrictions in your app to support large
screen devices" on every release. **That recommendation is knowingly declined.** Anyone —
human or agent — who reads it fresh and starts removing `android:screenOrientation` is
repeating PR #224, which was reverted in PR #225.

**Why the obvious fix regresses.** The manifest lock applies **from activity launch, before
anything is drawn**. Any runtime replacement (`ScreenOrientation.lockAsync` in a `useEffect`)
can only take effect once the JS bundle has mounted. A phone cold-started while held in
landscape therefore renders the native splash in landscape and then snaps to portrait. **No
runtime approach can close that gap, because the gap is before JS exists.**

**And the runtime lock doesn't even cover everything Play flags.**
`setRequestedOrientation` applies to our own activity only. Play also names two Play
Services scanner activities — `GmsBarcodeScanningDelegateActivity` (expo-camera) and
`GmsDocumentScanningDelegateActivity` (react-native-document-scanner-plugin). Those are
closed-source AARs; a `tools:replace` override makes them rotate on phones with **no runtime
lever to put that back.**

**The third option, also rejected.** Pointing `android:screenOrientation` at an `@integer`
resource that differs in `values-sw600dp/` would be correct from the first frame. It was not
taken because (a) it cannot be validated without the Android SDK — aapt2 may reject a
resource reference on an enum attribute — and (b) even if it compiled, it ships landscape
layouts **that have never been rendered on a large screen**.

**What declining costs us: an advisory in Play Console. Nothing else.** Android 16 ignores
orientation restrictions on displays over 600dp regardless, so large-screen users get
rotation from the platform without us shipping unverified layouts.

**If it is ever revisited**, it starts with a tablet or resizable emulator in hand and every
screen verified in landscape *first* — not with a manifest edit.

**Guard.** `__tests__/androidOrientationLock.test.js` asserts the lock is present, that no
plugin strips it, and that no runtime orientation dependency is installed.

**The same applies to the edge-to-edge recommendation, for a different reason.** All seven
call sites Play lists are framework-owned and **unreachable from this repo**:
`android/app/build.gradle` consumes React Native as a prebuilt Maven AAR
(`implementation("com.facebook.react:react-android")`), so the Kotlin under
`node_modules/react-native/ReactAndroid/src/` is reference source that the build never
compiles — `patch-package` cannot touch it. Material Components is already at 1.13.0, the
newest release. Play's scan is **static reachability over the dex, not observed calls**,
which is why developers report fixing all app-side usage and the warning persisting. Tracked
upstream at react-native#48256, expo#37459, react-native-screens#2632.

Note the correction that produced that conclusion: `<StatusBar backgroundColor>` was
initially believed to be a real call into `Window.setStatusBarColor`. It is not —
`expo-status-bar`'s `NativeStatusBarWrapper` destructures only
`{ style, hideTransitionAnimation, animated, hidden }` and **never forwards
`backgroundColor`**. Removing the prop silences a per-render `console.warn`; it removes no
deprecated call. **Read the wrapper, don't trust the deprecation note.**

**Generalised rule — the one worth carrying.** A store recommendation is a suggestion about
an artifact, not a requirement, and **clearing an advisory is never worth a regression**. Before
acting on one, ask what declining actually costs. Here it was: one line of advisory text,
against a visible orientation flip on every phone. If the fix cannot be verified on the
hardware it affects, the correct move is to decline it and record why — including a guard
test, so the next reader finds the decision instead of the recommendation.

---

## 134. Email sync worked exactly once — short-lived OAuth tokens were never refreshed, and "reconnect" was misreported as "check your internet"

**Symptom.** Connect Gmail → "Scan now" imports receipts. Every later scan fails with
**"Sync Failed — Connection problem, check your internet and try again."** Outlook behaved
identically. The internet was fine; the message was.

Two independent bugs stacked, and the second hid the first.

### Bug A — the real one: the access token is never refreshed

`syncGmailReceipts` / `syncOutlookReceipts` read the access token that was written **once**,
at connect time, and used it forever:

```js
const accessToken = tokens.gmail.accessToken;      // written at connect, never again
const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
if (res.status === 401) throw new Error("Gmail session expired. Please reconnect.");
```

OAuth **access** tokens live about an hour. So the token was valid for exactly one thing: the
sync you ran right after connecting. Everything after it 401'd. "Worked the first time, never
again" is the signature of a cached credential with a TTL — when you see it, look for the
token's age, not the network.

Both providers could have recovered silently, and neither did:

- **Gmail** stores no refresh token (that needs `offlineAccess` + a backend code exchange) —
  but it doesn't need one. `@react-native-google-signin` keeps the **grant** on the device, so
  `signInSilently()` + `getTokens()` mints a new access token with no UI. Nothing called it.
- **Outlook** stored a `refreshToken` field and never once used it — and it was `null` anyway,
  because the scope list omitted **`offline_access`**. Without that scope Microsoft issues no
  refresh token at all. The field existed; the grant behind it never did.

**Fix.** A `createAuthorizedFetch({ providerLabel, accessToken, refresh })` wrapper per sync:
on 401 it refreshes **once**, retries **once**, and only then throws. Both providers supply a
`refresh` fn (Gmail: `clearCachedAccessToken` → `signInSilently` → `getTokens`; Outlook:
`AuthSession.refreshAsync` against the `consumers` token endpoint, storing the rotated refresh
token Microsoft returns). `offline_access` added to `OUTLOOK_SCOPES`.

Two details worth keeping:
- **Clear the cached token before asking for a new one.** `getTokens()` will otherwise hand
  back the very token that just 401'd.
- **The refresh flag is per-sync, not per-request.** One dead grant must not fan out into one
  refresh attempt per message.

### Bug B — why the message was wrong: `econn` matched "rec-onn-ect"

`errorSupport.classifyError` routed the error to the `network` bucket:

```js
if (/network|internet|connection|fetch failed|econn|enetunreach|socket|offline/i.test(msg))
```

The unanchored `econn` — meant for `ECONNREFUSED` / `ECONNRESET` — matches the letters inside
**"Please rec`onn`ect."** So *"Gmail session expired. Please reconnect."* classified as a
network failure and rendered `err.networkBody`: **the one piece of advice that could never
help.** Checking your Wi-Fi does not renew an OAuth grant.

**Fix.** Anchor it (`\beconn\w*`, `\benetunreach\b`) and add a real `auth_expired` category —
keyed on `err.code === "auth_expired"` first, so the user-facing copy never depends on the
wording of an English error string — mapped to a new `err.sessionExpiredBody` (EN + FR).

**Generalised rule.** A bare substring in an error classifier is a latent mislabel. Every
alternative in a classification regex needs `\b` anchors, and every branch needs a test with a
string that *nearly* matches. The cost here wasn't cosmetic: the wrong category sent the user
to debug their router while a one-line token refresh was the actual fix, and it made a broken
feature look like a flaky one for as long as it went unreported.

**Related.** A silent-failure sibling in the same file: a non-401 error status
(403 / 500) fell through to `data.messages === undefined`, and the screen reported a cheerful
**"No receipts found"** for a hard API failure. `createAuthorizedFetch` now throws on any
status ≥ 400, carrying the provider's own body text so `access_denied` still classifies as
`oauth_blocked`. **An error path that renders as an empty-state is worse than a crash** — the
user retries forever and never reports it.

**Guards.** `__tests__/emailSyncTokenRefresh.test.js` (14 tests: refresh-and-retry succeeds,
token persisted with the email intact, cache cleared first, one refresh per sync, revoked
grant raises `auth_expired`, mid-loop expiry is not swallowed as a parse failure, 403/500
surface as errors, Outlook rotation + the no-refresh-token case).
`errorSupport.test.js` pins `"Please reconnect."` → `auth_expired`, real `ECONN*` → `network`,
and `access_denied` still winning over both.

---

## 135. The paywall sold a feature the store was never configured to deliver — "Family sharing (up to 6 users)"

**Symptom.** None, until someone pays. The Unlimited paywall listed
**"Family sharing (up to 6 users)"** as a headline benefit, in both EN and FR. A
subscriber who then tried to share Unlimited with their household would get
nothing at all, with no error and nothing to report — the feature simply does not
exist.

**Root cause — two independent halves, each invisible on its own.**

1. `shared/pricing.config.js` listed `FEATURE_KEYS.FAMILY_SHARING` in the
   Unlimited tier's `featureKeys` *and* `"Family sharing (up to 6 users)"` in its
   customer-facing `features` array, so `canUseFeature("family_sharing")`
   returned `true` for any Unlimited subscriber.
2. **Nothing in the app ever asked.** A repo-wide grep for `FAMILY_SHARING` /
   `family_sharing` found the constant, its two uses inside the catalog, and the
   tests — and no gate, screen, or service anywhere. The key granted access to a
   capability that had no implementation behind it.

Meanwhile Family Sharing was switched **off** on both auto-renewable
subscriptions in App Store Connect, which is the only place the capability could
actually have come from: StoreKit is what shares an entitlement with a family
group, and RevenueCat only passes through what Apple grants.

**Why it survived review passes.** The App Store submission audit checked the
*store description* against the code and found the description clean — it never
mentions family sharing. The false claim lived only in the **in-binary paywall**,
which no metadata audit reads. The i18n checker was equally happy: the key
existed in both EN and FR, perfectly in sync, so parity enforcement confirmed the
lie was correctly translated.

**Fix.** The claim was removed rather than the capability enabled — the app has
no family- *or* device-sharing behaviour to expose, so turning it on at Apple
would have promised a real entitlement the app still couldn't use. Deleted
`FAMILY_SHARING` from `FEATURE_KEYS`, from Unlimited's `featureKeys`, and from
its `features` array (in **both** `shared/pricing.config.js` and the
`backend/shared/` copy, which must stay byte-identical), plus
`catalog.tier.unlimited.features.5` from the EN and FR blocks of
`src/services/i18n.js`. It was the last element of the list, so no index shifted
— `catalogFeatures()` maps `features[i]` to `catalog.<kind>.<id>.features.<i>`,
and removing a middle entry would silently relabel every item after it.

**Generalised rule.** **A feature key with no consumer is a marketing claim, not
a capability.** Before adding one to a paid tier, grep for a call site that reads
it; if `canUseFeature("x")` is never asked anywhere, the paywall line above it is
unbacked. The corollary for store work: **auditing store metadata is not
auditing the paywall.** The binary's own purchase screen is a separate surface
with its own accuracy obligation under Guideline 2.3.1, and it is the one the
paying customer actually reads.

**Guards.** `__tests__/purchaseService.test.js` now pins
`canUseFeature("family_sharing") === false` for an active Unlimited subscriber —
the direction that used to assert `true` — and the "every feature unlocked" test
enumerates the five keys Unlimited genuinely grants, so re-adding an unbacked key
to the tier fails the suite rather than quietly widening it.

---

## 136. The App Store privacy label disagreed with the binary's own privacy manifest — and had no Privacy Policy URL

**Symptom.** None visible. The App Privacy section read "Published", looked
finished, and had been signed off in an earlier session. Nothing in App Store
Connect warns you about any of what follows.

**Three separate problems, found by diffing the label against
`app.json` → `expo.ios.privacyManifests` rather than reading either on its own.**

1. **The Privacy Policy URL was empty (`–`).** This alone is a hard submission
   blocker; App Review cannot accept a version without it. It is a *different*
   field from the reviewer-notes link and from the in-binary paywall links, all
   of which were correctly populated — which is exactly why it went unnoticed.
2. **Four declared data types were missing from the label.** The manifest
   declares twelve; the label listed eight. Absent: **User ID**, **Emails or
   Text Messages**, **Other User Content**, **Performance Data**.
3. **Two linkage answers contradicted the manifest.** **Device ID** and
   **Product Interaction** were filed under "Data Not Linked to You" while the
   manifest declares both `NSPrivacyCollectedDataTypeLinked: true`. Product
   Interaction was also missing its App Functionality purpose, carrying only
   Analytics where the manifest lists both.

Apple compares the two. A label that under-declares relative to the shipped
manifest is a Guideline 5.1.1 finding, and it is the kind that surfaces *after*
review rather than before.

**Fix.** The manifest was treated as the source of truth — it was written
against the actual code paths in a prior audit, and it is what ships inside the
binary. Set the Privacy Policy URL to `https://priceback.ca/privacy-policy`,
added the four missing types (each: purpose **App Functionality**, tracking
**No**; linked **Yes** except Performance Data), switched Device ID and Product
Interaction to linked, and added App Functionality to Product Interaction's
purposes. Final state: 12 types, 10 linked, Crash Data and Performance Data not
linked, nothing used for tracking — byte-for-byte the manifest.

**Generalised rule.** **The privacy label and the privacy manifest are two
declarations of the same facts, maintained in two places, and nothing keeps them
in sync.** Neither console nor build will ever tell you they disagree. Diff them
mechanically — enumerate `NSPrivacyCollectedDataTypes` and check each entry's
presence, `Linked` flag, and purposes against the label — every time either side
changes. "Published" on the App Privacy page means *answered*, not *correct*.

**Related.** The same session found the paywall advertising a feature the store
was never configured to deliver (#135). Both are the same failure mode: a claim
recorded in one surface that nothing validates against the surface that has to
honour it.

---

## 137. "Our service is having a hiccup" — one sentence hiding nine different email-sync failures

**Symptom.** A fresh build of the email-receipt sync, "Scan now", and:

> **Sync Failed**
> Our service is having a hiccup. Please try again in a few minutes — our team
> has been notified.

Retrying, waiting, and rebuilding all produced the same sentence. Nothing in it
named the provider, the status, or the reason, so the failure was
indistinguishable from an outage — and there was no way to tell one build's
failure from the next one's without shipping an instrumented APK.

**Root cause — a message-shaped classifier and a catch-all bucket.**
`createAuthorizedFetch` phrased every non-401 provider failure as

```js
new Error(`${providerLabel} API error ${res.status}${detail}`)
```

and `errorSupport.classifyError` decided the category by regex on that message:

```js
if (err?.status >= 500 || /\b5\d\d\b|server|unavailable|api error/i.test(msg)) return "server";
```

The literal words **"api error"** matched. So *every* Gmail/Graph 4xx — a token
without the `gmail.readonly` scope (403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`), the
Gmail API not enabled on the GCP project (403 `SERVICE_DISABLED`), a quota (403
`rateLimitExceeded`), a rejected query (400), a mailbox Graph won't `$search`
(400 `MailboxNotEnabledForRESTAPI`) — collapsed into the same bucket as a real
502. Four of those five are never fixed by waiting; one of them the user fixes
in ten seconds if you tell them.

**Second-order defects the same shape was hiding.**

- A **403 never triggered the silent token re-mint** — only a 401 did. But
  `GoogleSignin.configure()` is *process-global*, and `authService`
  reconfigures it with identity-only scopes on every silent session refresh.
  Whichever module configured last decides what `getTokens()` mints, so a
  perfectly valid Gmail grant can hand back a token with no mail scope. Gmail
  answers that with **403, never 401** — so the recovery path could not fire for
  the one case it was most needed for.
- **A cancelled sign-in was an error alert.** Backing out of the Google sheet
  raised `Error("Gmail login cancelled.")`, which fell through to
  `err.unknownBody` — "Something went wrong… our team has been notified".
- **Every failed local save was reported as "already tracked".** The screen
  counted `imported` and swallowed save exceptions, so if all N receipts failed
  to save the user was told they were already in their list. (Careful here:
  `saveReceipt` signals a *duplicate* by throwing `DUPLICATE_RECEIPT`, so "it
  threw" and "it failed" are genuinely different.)
- **A 200 carrying HTML** (captive portal, proxy interstitial) surfaced
  `res.json()`'s parser error verbatim: "JSON Parse error: Unexpected
  character: <".

**Fix.** Classification moved from message text to an explicit code set on the
error at the point of failure, and every branch got its own honest copy:

- `emailSyncService.providerFailureCode(status, body)` maps one provider HTTP
  failure to one of `insufficient_scope`, `api_disabled`, `rate_limited`,
  `oauth_blocked`, `mailbox_unsupported`, `auth_expired`, `provider_forbidden`,
  `not_found`, `bad_request`, `provider_down`, `provider_error`.
- `errorSupport.classifyError` consults `err.code` **before** any heuristic, and
  the vocabulary grew to 20 categories, each with EN + FR copy.
- The 403-scope case now re-mints once (like a 401) and, if the live grant is
  genuinely missing the scope, calls `GoogleSignin.addScopes` — a one-tap fix in
  place of "disconnect and reconnect".
- Gmail falls back to a narrower query on a 400; Outlook falls back from
  `$search` to a plain listing on 400/`MailboxNotEnabledForRESTAPI`, matching
  stores client-side.
- A cancelled flow shows **no alert at all**.

**Support references.** Every error alert now ends with a short, stable code —
`GMAIL-403-INSUFFICIENT-SCOPE`, `GMAIL-403-API-DISABLED`, `OUTLOOK-400-BAD-REQUEST`
— built by `errorSupport.errorReference(err)` as `[PROVIDER-][STATUS-]CATEGORY`.
It contains no provider text and no PII, and the identical string is attached to
the Sentry/analytics report, so a screenshot and a telemetry entry match by eye.
**This is the part that means the next failure needs no new build to diagnose.**

**Generalised rule.** **Never classify an error by pattern-matching a message
you also composed.** The message is for the team; the code is for the copy. If a
failure can have several causes that need different advice, the layer that knows
the cause has to say so explicitly — by the time a string reaches the classifier
the information is already gone. And a bucket named "server" must contain only
failures that are actually the server's, or it becomes a lie the user acts on.

**Tests.** 3 new suites, ~100 new tests: `emailSyncErrorPaths` (real provider
bodies → codes), `emailSyncScreenErrors` (codes → the exact Alert copy, EN + FR),
and `emailSyncEndToEnd` (HTTP response in, user-visible sentence out, with only
`fetch`/storage/native faked). A table test asserts **no** provider status
resolves to `unknown`, and another asserts every category has non-empty copy in
every language.

## 138. One rejected promise could kill the whole API — Express 4 + Node 24, and 15 routes that awaited with no try/catch

**Class:** availability. **Found:** 2026-08-03 production audit. **Fixed:** `backend/lib/processSafety.js`.

Two facts that are individually harmless and jointly fatal:

1. **Express 4 does not forward a rejected async handler** to the error
   middleware. That only arrives in Express 5. An `async` route whose body
   rejects produces an *unhandled rejection*, not a 500.
2. **Node ≥ 15 terminates the process** on an unhandled rejection.

So a single failed request killed the container and dropped every other
in-flight request with it. 15 of 60 routes were exposed, and the worst were the
hottest: `POST /api/device/scan` and `/api/device/sync` run **on every app
launch and every scan, for every user** — against a pooler that
`db/client.js:231` already documents as throwing transient `EMAXCONNSESSION`
errors. Four more routes had a `try` but awaited *before* entering it, including
`/health`, which is Railway's own healthcheck.

**Why the obvious fix was the wrong one.** Wrapping the 19 known routes by hand
fixes today and leaves the 20th — the next route someone adds — exposed with
the same outcome. The fix patches the *registration point*
(`wrapAppRoutes(app)`), so every current and future route forwards rejections
automatically. `app.use` is deliberately **not** patched: Express identifies
error middleware by `fn.length === 4`, so wrapping would silently demote the
global error handler to an ordinary middleware.

**Two layers, on purpose.** `asyncRoute()` is the correct fix (the caller gets a
real error response). `installCrashGuards()` is the net for anything that still
escapes — timers, fire-and-forget calls, stray `.then` without `.catch`:
`unhandledRejection` logs and **keeps serving** (one failed request must not
become an outage), while `uncaughtException` drains and exits non-zero, because
after one the process state is undefined.

**The subtle part:** the guards are installed from `startServer()`, **not at
require time**. `node --test` workers import `server.js` for route tests and
rely on the default `uncaughtException` behaviour to attribute a failure to the
running test file. Installing a process-level handler at require time changes
that for the test runner too.

**Testing note learned the hard way:** do not run two backend suites
concurrently against the shared Supabase dev project. It exhausts the session
pooler ("Connection terminated unexpectedly") and produces phantom failures that
alternate pass/fail on identical code — which reads exactly like a flaky test or
a regression you just introduced. Run them one at a time before concluding
anything about a failure.

Related: SIGTERM previously called `process.exit(0)` immediately, severing
in-flight credit and receipt writes on every Railway redeploy. It now closes the
listener, drains, flushes, then exits, with a hard deadline so a hung keep-alive
socket can't block a deploy.

## 139. The brute-force throttle protecting the admin token was bypassable with a header

**Class:** security (auth bypass). **Found:** 2026-08-03. **Fixed:** `app.set("trust proxy", 1)`.

`/api/flyer/import` throttles *before* comparing the admin token — deliberately,
with a comment saying "so failed-auth guesses are counted too". But it keyed on
the **leftmost** `X-Forwarded-For` hop, which is entirely client-supplied. An
attacker rotating that header per request voided the throttle completely and
restored unlimited admin-token guessing.

The same leftmost bug sat in the `/api/check-price` and `/api/analytics`
limiters, and in the audit log's IP hash — where it additionally let an abuser
make their own requests unlinkable in the breadcrumb trail.

**Rule of thumb:** in `X-Forwarded-For: a, b, c`, everything except the
**rightmost** entry was supplied by the caller; only the last hop was appended
by your own proxy. The codebase already had one function doing it right
(`clientIpForRateKey`) and three doing it wrong — two competing notions of "the
client's IP" in a single file.

**Fix:** set `trust proxy` to the number of proxies actually in front (Railway =
1) and use `req.ip` everywhere. Express then derives the client address
correctly and the hand-rolled parsing disappears. If another proxy is ever added
in front, that number must grow to match.

## 140. Every referral failure showed generic copy — the client compared a machine code against prose

**Class:** silent user-facing regression. **Found:** 2026-08-03 (shipped in production).

The backend returned `{ code: "self_referral", error: "cannot redeem your own
code" }` — machine code in `code`, human prose in `error`. The client stored
`error: data.error` and then branched on `result.error === "self_referral"`.

That comparison **can never be true**. So a user redeeming their own code, or a
code they'd already used, or a code that doesn't exist, all fell through to
"Try again in a moment." The specific, translated copy for each case existed and
was simply never reachable.

This is the concrete cost of an inconsistent error envelope: the API had **eight
distinct shapes** across ~195 sites, and `error` sometimes held a code and
sometimes prose. `priceService.js` has the same latent bug — it branches on
`error === "consent_required" | "timeout" | "network_error"`, which cannot match
any prose endpoint.

**Fix:** one envelope, `backend/lib/httpError.js` —
`{ error: <snake_case code>, code: <UPPER>, message: <English diagnostic>,
requestId }`. `error` is always the machine code; prose lives in `message` and
is never rendered. `tests/errorContract.test.js` scans `server.js` and fails the
build on prose in an `error` field, which is what stops the drift recurring —
and it immediately caught 7 interpolated backtick values a manual sweep missed.

**Lesson:** when a field is read by a shipped client, "mostly a code" is the
same as "not a code". Pin the exact strings the live build compares against in a
test before changing any of them; users in the field cannot upgrade on demand.

## 141. The most-seen screen in the app printed the raw exception, in English

**Class:** UX / privacy / i18n. **Found:** 2026-08-03.

`App.js`'s root `ErrorBoundary` rendered `this.state.error?.message` directly —
raw exception text, English-only, to every user on any render crash. Its title
and button were hardcoded English literals too.

**Why CI never caught it:** `scripts/checkI18n.js` only scanned `src/`, and
`App.js` lives outside it. The file with the app's single most visible piece of
copy was the one file the copy checker didn't look at.

Compounding it, 24 of ~28 screens had no error boundary at all, so most crashes
unmounted the whole tree to this screen; and `ScreenErrorBoundary` — where it
*was* used — only `console.warn`ed, so caught crashes were invisible in
production telemetry.

**Fixes:** localized copy resolved through a helper that cannot itself throw (if
i18n is what broke, it falls back to English rather than crashing the crash
screen); a support reference (`APP-CRASH-TYPEERROR`) shown to the user and
attached to the Sentry event so a bug report lines up by eye; every screen
wrapped via a **memoized** HOC — an inline wrapper would create a new component
identity each render and remount every screen; and `checkI18n.js` now scans
`App.js`, bans the `t("k") || "English"` pattern outright (446 instances had
accumulated), and checks `{placeholder}` parity between languages.

## 142. No one could subscribe: Play names a sub `<subscriptionId>:<basePlanId>`

**Class:** money / store integration. **Found:** 2026-08-04, in production
(2.8.3, live on Play). **Fix:** `src/services/purchaseService.js`
(`storeProductIds` / `productMatchesId`).

`purchaseProduct` picked the package to buy with strict equality:

```js
availablePackages.find((p) => p.product.identifier === productId)
```

`productId` is the catalog id (`priceback_unlimited_monthly`). But **Google Play
addresses a subscription as `<subscriptionId>:<basePlanId>`**, and RevenueCat
mirrors that verbatim — the StoreProduct arrives as
`priceback_unlimited_monthly:monthly`. Consumables have no base plan, so they
carry no suffix, and iOS never suffixes anything.

So the comparison resolved **every credit pack and no subscription**:

- Tapping Subscribe / Upgrade never reached the store at all. It fell into the
  "package not in the offering" branch → `errorCode:"unavailable"` → *"This item
  isn't available for purchase right now."*
- `getStorePriceLabels()` keyed prices by the same suffixed identifier, so
  `priceFor("priceback_unlimited_monthly")` missed and the sub cards printed the
  catalog's hardcoded `$4.99` / `$49.99` instead of the CAD the store would
  charge — the paywall *looked* like a mock, which is how it was reported.

**Why nothing caught it.** Everything upstream was correct and verified — Play
base plans Active, RC offering complete, keys injected — so every checklist
passed. The client was the only place the two spellings met. The unit tests
built their fixtures as `{ product: { identifier: pack.id } }`, i.e. they encoded
the wrong assumption as the mock; a sideloaded dev build *simulates* purchases
and never resolves a real package; and the backend already handled the suffix
(`subscriptionSync` accepts `priceback_unlimited_annual:annual`), so the two
halves of the codebase disagreed silently about the same string.

**Fix:** resolve a product to *every* id it legitimately answers to — the
identifier, the part before the first `:`, and Play's own
`defaultOption.productId` / `subscriptionOptions[].productId` — and match against
that set. Price labels are keyed under all of them, exact identifier last so a
literal id always beats an inherited alias. Not a prefix match: a different SKU
still fails to resolve, and a genuinely missing SKU still reports `unavailable`.

**Lesson:** a store id is not one string. When a platform can rename an id
(base plans, offers, storefront variants), match on the set of names the object
answers to, and build test fixtures from what the SDK *actually returns* — a mock
that echoes your own assumption proves only that the assumption is consistent.

**Sibling finding (not a bug):** the same report said the paywall was "a test
paywall". Google shows a *test* purchase sheet on every SKU — even on the live
production app — to any account in Play Console → Settings → **License testing**.
The developer account is on that list, which is intentional. It does not affect
real users, and it is not evidence of a build/track mix-up.

## 143. Restore brought back only expired receipts — the merge deleted the products it was supposed to restore

- Date: 2026-08-04 · Area: both
- Symptom: after a reinstall→sign-in, or a plain sign-out→sign-in, the restore
  screen completes and the user lands on an app showing **only expired
  receipts** — no active receipts, no products, no hero-card history. The credit
  balance is correct. Reported four separate times; each fix held for a round or
  two and then "regressed".

**Why one cause produced all four symptoms.** Every product in the app *is* a
receipt line, and every Home/Tracking surface gates on
`daysRemaining(purchaseDate, storeId) > 0`. So a receipt restored with **zero
items** is a bare header: no products, no claim history, and — once its 30-day
window lapses — an "expired" card. The credit balance is a scalar on `users`, so
it was unaffected. It read like four bugs and was one.

**Root cause 1 (client, destructive).** `mergeServerIntoLocal` rebuilt `items`
purely from the server payload. When the server returned `items: []` the local
items were **overwritten with nothing** — and it stamped `syncPending: false` /
`syncError: null`, so the push queue never sent them back. `authService.signOut()`
only clears SecureStore tokens and leaves local receipts intact, so
**sign-out→sign-in ran this merge over good local data** and destroyed the only
remaining copy.

**Root cause 2 (server, unrepairable).** `receiptsRepo.create` used
`onConflictDoNothing` on `receipts.id` and early-returned `{ items: [] }`. Once a
header existed without lines, no retry could ever add them — so root cause 1's
damage was permanent.

**Root cause 3 (data).** Production held **19 receipt headers and 7 item rows**.
The same receipt ids on dev carried 13/2/1 items with *byte-identical*
`created_at` timestamps (`2026-06-24 22:17:37.860861+00`). `created_at` is
`defaultNow()`, so identical microseconds prove a row **copy**, not two uploads:
`receipts`, `products` and `price_points` were copied between environments and
`receipt_items` was not. 365 of 372 `receipt_ocr` price points referenced receipt
ids absent from prod entirely.

**Root cause 4 (latent).** `_hydrate` ignored `receipts.nextOffset`, so only the
first 200 receipts ever restored — and the documented paging follow-up
`GET /api/receipts` returned **headers with no items**, which would have fed root
cause 1 and wiped local items for every receipt past #200.

**Why nothing caught it.** The backend bootstrap test seeded **zero** receipts and
asserted `Array.isArray(b.receipts.items)`. The mobile hydrate test hand-wrote a
server payload and asserted `added === 1` plus "the id exists". Neither side ever
asserted that a restored receipt was *usable*, and each invented its own payload
shape, so they could drift apart freely. That mobile fixture also pinned
`purchaseDate: "2026-06-01"`, which silently aged past the 30-day window — the
test passed while asserting on a receipt the app renders as expired.

**Fix:**
- `serverItemsAreIncomplete()` — server absence never deletes local presence.
  Deliberately **zero** items, not "fewer": item inserts are transactional, so a
  partial server copy means a line was DELETED and the server is rightly
  authoritative. Treating "fewer" as loss would resurrect deleted items and
  re-queue the receipt forever.
- `receiptsRepo.create` back-fills lines onto an existing header, gated on the
  receipt having **no item rows at all** (not merely no *live* ones — a
  soft-deleted row is a deliberate deletion and must never be resurrected).
- `syncReceiptToBackend` refuses to POST an item-less receipt; `globalSkip`
  separates "signed out, stop the pass" from "skip this one" (one bad receipt
  used to strand every upload queued behind it).
- `_hydrate` follows `nextOffset` via `GET /api/receipts?include=items`, bounded
  at 25 pages, requiring strict cursor progress.
- `receipt_items.original_price` added (migration 0002) so TPD discount context
  survives; `ignored`, `purchaseType` and `isRefund` restored too. Internal
  integer FKs (`store_id`, …) are now stripped from client payloads — the client
  reads `storeCode || storeId`, so a leaked numeric id resolved to no store and
  made every affected receipt render as expired.

**Two identical latent bugs, both `Number(null) === 0`:** the client's
`_num(null)` returned **0**, turning "no discount / no tax" into a real zero; the
server's `Number.isFinite(Number(it.originalPrice)) ? String(...)` stringified
null into the literal `"null"` and Postgres rejected the whole insert — which
would have 500'd **every receipt upload in production**. Both were caught by the
new corpus suite, not by review.

- Files: `src/services/syncService.js`, `src/services/receiptSyncService.js`,
  `src/services/storageService.js` (`retryPendingReceiptSyncs`),
  `backend/repos/receiptsRepo.js` (`persistReceiptItems`, `create`,
  `decorateReceiptRow`), `backend/server.js` (`POST /api/receipts`,
  `GET /api/receipts`), `backend/db/schema.js`, migration
  `0002_receipt_item_original_price`, `shared/receiptWireContract.js`.
- Detect next time: the `hydrate_server_copy_incomplete` analytics event fires
  the moment a server copy comes back with fewer items than the device holds —
  this failure used to be completely silent. Server-side, the query is
  `SELECT count(*) FROM priceback.receipts r WHERE r.deleted_at IS NULL AND NOT
  EXISTS (SELECT 1 FROM priceback.receipt_items i WHERE i.receipt_id = r.id)`;
  anything above zero is a receipt that will restore as a ghost.
- Prevent: **`shared/receiptWireContract.js` is now the single definition of the
  wire shape, and both sides are held to it.** All 55 captured real receipts run
  the full device→server→device cycle in `__tests__/restoreRoundTrip.test.js`
  (418 assertions), and `backend/tests/restoreRoundTripDb.test.js` verifies the
  shared model against **real Postgres** — so the model can't become a
  comfortable fiction and the mobile suite transitively tests reality.
  `__tests__/restoreEndToEnd.test.js` asserts outcomes, not plumbing ("is my
  receipt active?", "are my products there?"). Every date is computed from
  `Date.now()`, never hardcoded. Verified to bite: reintroducing the merge bug
  fails 52 tests, one per receipt, by name.

**Lesson:** when two components must agree on a payload, a test on each side that
builds its own fixture proves only that each side is self-consistent. Give them
one shared contract, verify that contract against the real dependency, and assert
the user-visible outcome — "a receipt was added" was true the entire time the app
was showing an empty screen.

## 144. "No price drop found" on an item that was never being watched — the server's watch rule was never mirrored on device

- Date: 2026-08-04 · Area: mobile
- Symptom: on a receipt containing items bought on sale, tapping **Refresh
  prices** put those lines through the check and reported **"No price drop
  found"**. It reads as "we looked and the price hasn't dropped". The truth is
  the opposite: an already-discounted line is *never price-watched*, so nothing
  was ever compared.

**Root cause — a rule that lived on one side of the wire only.** The backend has
always derived `receipt_items.watch_enabled` itself
(`receiptsRepo.persistReceiptItems`): a line whose `originalPrice` is strictly
above the paid line total is not watched, and there is *no client override*.
`shared/receiptWireContract.serverWatchEnabled` models it, and the restore
round-trip test pins it. But nothing on the device applied it.
`storageService.saveReceipt` normalised `watchEnabled` from refund/ignored only,
so a locally-scanned sale line was stored `watchEnabled: true`, and every client
surface that gated on `watchEnabled !== false` treated it as watched.

**Why it survived so long.** Two call sites had already noticed the symptom and
patched around it *locally*: `priceService` filtered `!item.originalPrice` in two
places (itself subtly wrong — it also excluded lines whose `originalPrice` was at
or *below* what was paid, i.e. not a discount at all). Three other surfaces
— DetailScreen, HomeScreen, ReceiptsScreen — had no such guard. Five copies of
"which lines are watched", four of them disagreeing, is the actual defect; the
misleading chip was one symptom of it.

**The class of bug.** Same shape as #136 (privacy label vs manifest) and the
`store-config-vs-binary-drift` note: *one fact declared in two places with
nothing keeping them in step*. Here the two places were a Postgres column and a
JS predicate, which is worse than a config drift because the client silently
re-derives what the server already decided.

**Fix:** one exported predicate pair in `src/utils/receiptMath.js` —
`isInstantDiscountLine()` (identical rule to the server's; accepts the local
`price` shape, the wire `lineTotal` shape, and Postgres numeric *strings*) and
`isWatchableLine()` (unclaimed + not ignored + not toggled off + not discounted).
Every surface now calls it: DetailScreen, HomeScreen, ReceiptsScreen,
priceService ×2, notificationService ×2. It is also **derived at the source** in
storageService, so new data is right rather than merely filtered later:
`saveReceipt`, `addItemToReceipt`, and `updateReceiptItem` when an edit touches
the money (reversible — correcting a mis-parsed discount away re-watches the
line). Old rows on device stay wrong in storage but the predicate covers them.

**Copy fixes that came with it:** the "Refresh prices" button is now hidden
outright when nothing is watchable; the row chip splits into "Bought on sale ·
not watched" vs a new generic "Not watched" (a bottle-deposit row used to be told
its price was "already discounted"); and `detail.checkedNoPrice` became "No
current price available" — on a genuinely watched line it fires when no price
resolved, which is a different claim from "no drop".

**The guard that stops the redrift:** a table test in `receiptMath.test.js`
asserts `serverWatchEnabled(line, false) === !isInstantDiscountLine(line)` across
the edge cases (original above / equal to / below paid, absent, null). The two
definitions now fail loudly the moment either side moves.

**Watch for:** the watch pool is now strictly *smaller* on device. A user with
sale-heavy receipts sees their "Watching" count fall after updating — expected,
since those lines could never have produced a claimable drop, but it will look
like data loss if reported.

## 145. An unauthenticated route validated the SHAPE of a key it was handed, but never its OWNERSHIP

- Date: 2026-08-04 · Area: backend / security
- Symptom: none visible in normal use — this was found by audit, not by report.
  The observable failure would have been an admin opening the price-tag review
  queue and finding a submitted tag's photo broken, so the tag could not be
  verified and its contributor silently never received their credit.

**Root cause.** `POST /api/observations/tag/image-uploaded` confirms that the
client finished uploading a tag photo, so the review row can record the object
key. It is unauthenticated on purpose (the tag POST it pairs with is too), and
its whole guard was one regex:

```js
if (!new RegExp(`^tag-reviews/[a-f0-9]+/${Number(reviewId)}\.jpg$`).test(objectKey))
```

That checks the key *looks* server-issued. It does not check it *is this
review's*. `[a-f0-9]+` matches any device hash, not the one stored on the row at
creation, and `tagReviewsRepo.setImageKey` overwrites unconditionally with no
ownership predicate. Review ids are sequential integers and the route had no
rate limit, so they were trivially enumerable.

**Why the impact is narrower than it first looks — and still real.** An attacker
cannot point a victim's review at an image they control: the presigned PUT is
issued for one exact key, and the regex pins the *filename* to the review id, so
there is no key they can both write to and pass validation with. What they can do
is repoint any pending review at a key that doesn't exist. The admin queue then
presigns a GET for a missing object and shows a broken photo. That is an
unauthenticated way to suppress crowd price verification and withhold rewards,
for any review, at will.

**Fix:** bind the key to the review's own stored `deviceHash` (the row already
carries it, and `getReview` already returns it) — 404 for an unknown review id,
403 for a mismatch — plus the per-IP credit limiter the route never had. A legacy
row with a null `deviceHash` falls back to the old shape check rather than
hard-failing, because rejecting a confirm for a row we can't attribute would
orphan its image, which is the exact harm being fixed.

**The class of bug — look for this shape elsewhere.** *A guard that validates the
format of an attacker-supplied identifier and mistakes that for authorization.*
Format validation answers "could the server have produced this?"; authorization
answers "did the server produce this, for this caller?". They look alike in
review, especially when the format is derived from a server-side secret-ish value
like a device hash. The tell is a character class where a specific known value
belongs: `[a-f0-9]+` where the row's own hash was available two lines away.

**Guard:** `backend/tests/tagReviewsDb.test.js` asserts a well-formed key
carrying a *different* device's hash is rejected, and explicitly asserts that
same key matches the old shape regex — so the test fails against the old code
rather than passing vacuously.

**Watch for:** the mismatch response changed from 400 to 403. The client's
confirm step is fire-and-forget with a retry loop and no UI surface, so nothing
user-visible changed, but anything asserting the old status will fail.

## 146. A real credential sat in a `.env.example`, and the fix was to mute the scanner that found it

- Date: 2026-08-04 · Area: repo hygiene / CI
- Symptom: CI's gitleaks step had been disabled with `if: false` since
  2026-07-23, carrying a comment that it must be re-enabled before publishing.

**Root cause — two mistakes, and the second one is the expensive one.**
`backend/.env.example` held live Cloudflare R2 credentials (account id, access
key, and a 64-hex secret access key) rather than blanks — on `main` from
`4b41643` (2026-05-28) to 2026-08-04, **about ten weeks**. That bucket holds user
receipt and price-tag photos. A file whose entire purpose is to be a copyable
template is the easiest place in a repo for a real value to get pasted "just for
now" and then never removed, because it reads as documentation rather than as
configuration.

**Dating a leak: use `-S`, not the file's log.** `git log -- <file>` shows when
the file was last *touched*, which here pointed at PR #92 (2026-06-18) and
understated the exposure by three weeks. `git log --all -S '<secret>' -- <file>`
shows when the *value* entered and left. Always date a leak the second way.

Then the secret scanner correctly found it, went red, and was muted so the PR
gate would stay green while rotation was handled separately. Rotation didn't
happen. **A muted scanner does not merely fail to report the leak it was muted
for — it stops reporting every leak added afterwards.** That is two weeks during
which any newly committed secret would have shipped silently. The mute converted
one known problem into an unknown-size one.

**Fix:** scrub the values to blanks, re-enable the gate, and rotate the token in
Cloudflare (the file change alone fixes nothing — the credential stays valid, in
history, and in every existing clone until it is revoked).

Re-enabling surfaced 6 remaining findings, all false: five i18n lookup keys
(`streak.badge.saved50.desc`) and one AsyncStorage key
(`pending_receipt_scans_v1`), which trip `generic-api-key` because they're
assigned to names containing "key". Allowlisted **by value shape, never by path**
— `.gitleaks.toml` already carried that hard rule precisely so an allowlist can't
hide a real secret that happens to share a file. Both added patterns are anchored
end-to-end and admit only lowercase words joined by dots or underscores: no
entropy, so no credential can be spelled that way.

**Detection:** the gate itself, now that it runs. When it goes red, the answer is
scrub + rotate, never `if: false`. Verify a change to the allowlist hasn't
defanged it by planting a known-secret shape in one of the allowlisted files and
confirming it still trips — path-independence is the property that matters.

**Watch for:** the same pattern in any tracked `*.example`, `*.sample`, or
`*.template` file, and in docs that paste "a working example" of a config block.

---

## 147. The Profile footer advertised v2.6.0 for four releases, in both languages

- Date: 2026-08-05 · Area: i18n / release hygiene
- Symptom: the Profile screen's footer read `PriceBack v2.6.0 · Built with 🍁 in
  Canada` while `app.json` was at **2.8.4**. Found during a publishing-docs
  audit, not by a user.

**Root cause — a fact with two homes and nothing syncing them.** The version
number was baked as a literal into the `profile.versionLine` string in *both*
the `en` and `fr` blocks of `src/services/i18n.js`. `app.json` is the real
record of the app's version (`eas.json` sets `appVersionSource: "local"`), so
every release bump moved one copy and silently left the other behind. Four
releases went by. Nothing failed, because a stale string is still a valid
string — there is no assertion a translation bundle can fail against a value it
has no reason to know about.

**Why it mattered more than a cosmetic slip.** This is a line an App Store or
Play reviewer reads on the settings screen while checking that the build in
front of them matches the version record they are reviewing. A four-release
discrepancy on the app's own version display is exactly the kind of detail that
reads as "this binary is not what was submitted."

**Fix.** Interpolate instead of duplicating. The string became
`PriceBack v{version} · …` in both languages and the screen renders
`t("profile.versionLine", { version: Constants.expoConfig?.version || "—" })`.
`expo-constants` was already imported in that file for the diagnostics block, so
the version now has exactly one source and cannot drift again.

**The general rule — the one worth carrying forward.** *Never bake a value into
a translation string that is owned somewhere else.* Translation bundles are for
wording; anything derived from config, the database, or the build is a
placeholder the caller fills. The moment a number, a price, a URL, or a version
appears literally in `i18n.js`, it has been forked from its source and will
drift — and it will drift **once per language**, so the count of stale copies
grows with every language added. This is the same failure family as the
store-config drift entries (#136, #142): one fact, two declarations, no
mechanism keeping them equal.

**Test.** `__tests__/i18n.test.js` now asserts, for every supported language,
that `profile.versionLine` contains `{version}` and matches no literal
`vN.N.N`, and that interpolation actually substitutes. Re-baking a number into
the string fails the suite in whichever language it happens.

---

## 148. A notification fired at a user who had just done the thing it was asking them to do

- Date: 2026-08-05 · Area: mobile scan flows / backend push
- Symptom: "I scanned a price tag and I got a notification after reviewing and
  submitting it." The connection was fine and the OCR came back fast — the whole
  review-notification family is only supposed to appear when a scan *couldn't*
  be read live.

**Root cause — four independent ones, which is the interesting part.** The
report named one symptom; the flow had four separate ways to produce it, and
only the first was the alert actually seen.

1. **The submitter was in the audience for their own alert.** `POST
   /api/observations/tag` pushes "Price tag awaiting review" to every sub in
   `ADMIN_USER_SUBS` so an admin doesn't have to poll the review screen. Maxim's
   sub is in that list, so submitting a tag pushed him a request to verify his
   own submission, about a second after he tapped Submit. He can't be the
   reviewer of his own tag either, so the push was never actionable.
2. **The "your scan is ready" alert fired with the app open.** Five things drain
   the offline scan queues — cold boot, the background→active transition, a
   **60-second poll in `App.js`**, the daily background fetch, and the "Process
   now" button on the review screen itself. Three run in the foreground, and
   `setNotificationHandler` asks for a banner, so a drain would banner "come
   back and review this" over the app the user was already holding.
3. **Photos entered the offline queue while the device was online.**
   `probeReachable` was a single 3.5 s `GET /health`: a cold-starting Railway
   dyno or a radio still waking answered late and was read as "offline". And
   `runOcrBatch` queued on **any** per-photo OCR error — not just connection
   ones — **silently**, so an unreadable photo in an otherwise-fine batch was
   re-read in the background minutes later and notified a user who had already
   reviewed and submitted the rest.
4. **Nothing told the user a notification was coming.** The only control on a
   dragging read was *Cancel*, which threw the capture away.

**Fix.**

- Skip the caller in the admin push loop (`optionalAuthUser(req)?.sub`, **not**
  `resolveScanOwner` — that one upserts the user row and claims the device, side
  effects that belong to the credit path).
- One foreground gate (`AppState.currentState === "active"`) inside both
  `sendTagScansReadyNotification` and `sendReceiptScansReadyNotification` — the
  single choke point all five triggers pass through. In the foreground the
  existing "N waiting for review" pill is the surface.
- `probeReachable` retries once before concluding offline; `runOcrBatch` queues
  only `classifyError → network|timeout` (the same helper the receipt screen
  uses, so the two definitions can't drift again) and **announces** anything it
  queued; everything else becomes a blank manual-entry card (rule 11).
- Both scan screens grow a "Save it — we'll notify you" button at 8 s, with a
  `scanRunId` guard so a read that resolves after the user leaves cannot spend a
  credit or drag them into a review step for a photo the queue now owns.
- `data.type === "tag_review"` taps now route to the admin review screen; they
  previously matched no branch and did nothing.
- Both scan-ready notification bodies were hardcoded English — moved to
  `notif.*ScansReady*` keys in EN and FR.

**The general rule — the one worth carrying forward.** *A notification whose job
is "come back to the app" must check whether the user ever left.* More broadly:
before sending anyone a message about an event, ask whether they are the person
who caused it. Both defects here are the same shape — a fan-out that never asked
who the recipient was relative to the trigger. The audience of an alert is part
of its correctness, not a delivery detail.

Second rule, from cause 3: *a single probe is not evidence.* Any boolean derived
from one timed network call ("are we online?") will be wrong under exactly the
conditions it exists to detect, and a wrong "offline" here didn't fail loudly —
it silently deferred work that resurfaced later as an unexplainable
notification. Retry before concluding, and never widen a fallback path
("something went wrong → queue it") past the specific failure it was written
for.

**Test.** `backend/tests/tagReviewAdminPushDb.test.js` adds a second admin and
asserts the submitting admin is skipped **while the other one still receives it**
(so the absence proves exclusion, not a broken push).
`__tests__/notificationTapRouting.test.js` pins the foreground gate in both
directions and the `tag_review` route; `__tests__/tagScanQueue.test.js` pins the
probe retry (one failed attempt then success → reachable);
`__tests__/priceTagScanDeferral.test.js` (new) and
`__tests__/scanScreenOfflineQueue.test.js` pin the batch queue-entry boundary,
the 8-second escape, and the dropped late result.

**Two test-harness traps this fix walked into, both worth knowing.**

*Never register a REAL module as a virtual mock.* The new suite declared
`jest.mock("expo-image-picker", factory, { virtual: true })`. `expo-image-picker`
is a real dependency, and marking a real module virtual makes it unresolvable
for **other** suites sharing the worker. `priceTagSourceGone.test.js` reaches the
picker through `await import("expo-image-picker")`, which then yielded nothing —
its gallery path silently did nothing and four assertions failed **on CI only**,
while passing in isolation *and* when the two files were run together. The tell
for this whole family: *a suite you never touched fails, and only under the full
run.* `virtual: true` is for modules that genuinely do not exist on disk.

*A slow-path UI test must prove it reached the slow path.* Asserting on a "this
is taking too long" affordance means the screen has to actually be parked in the
scanning step first — four awaits deep here (document scanner → source probe →
reachability probe → credit gate → OCR). Two microtask ticks raced the render,
so the escape timer could be advanced before the effect that arms it had run.
Flush generously and assert you are parked (the intro's shutter is *gone*) before
advancing timers, rather than asserting the absence of a button that was never
going to be there yet.

## 149. A rate limit written for one route protected one route, while four siblings guarded the same secret with nothing

- Date: 2026-08-07 · Area: backend auth (`backend/server.js`) · Audit 2026-08-07 **H2**
- Symptom: none. Nothing misbehaved, no alert fired, no user noticed. That is the
  point — this is a capability that was believed to exist and did not.

**Root cause.** `_adminTokenOk` is the shared `x-admin-token` gate. It did a
length-guarded `crypto.timingSafeEqual` and nothing else: no throttle. Five
money- and access-adjacent routes sat behind it — flag a user (blocks their
credits and subscription), unflag, verify a price point (**releases deferred
credits**), revoke granted credits, and kick the province-wide sweep — and every
one of them accepted unlimited token guesses.

`/api/flyer/import` had had the throttle since the day it was written, with a
comment explaining exactly why and calling `checkFlyerImportRateLimit(ip)`
**before** the compare so failed guesses were counted. The decision was already
made in this codebase; four routes just never received it.

**The sharp edge, and the reason this was ranked High.** `ADMIN_TOKEN` falls back
to `FLYER_ADMIN_TOKEN`:

```js
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || FLYER_ADMIN_TOKEN || null;
```

Unless `ADMIN_TOKEN` is set separately in Railway they are the **same secret**.
So the throttle on `/api/flyer/import` was not merely inconsistent — it was
**bypassable**. Brute-force the token unthrottled against
`/api/admin/users/:sub/flag`, then spend it on the throttled route. A control
that can be routed around protects nothing, and its presence makes the gap harder
to see: the codebase looked like it had this covered.

**Fix.**

- The throttle moved **inside** `_adminTokenOk`, before the compare. Per-route
  limiting is a step that gets forgotten; a gate that throttles itself covers the
  next route to adopt it for free.
- `/api/admin/price-tag-credits/revoke` carried its own inline copy of the
  constant-time compare — which is precisely how it missed the throttle — and now
  calls the shared helper. One admin-token path, nowhere left to forget.
- The fixed-window counter is one implementation (`consumeTokenAttempt`) shared
  by both throttles, with a **separate bucket** each.
- Successful calls are **refunded** (`refundTokenAttempt`), so only failed
  guesses accumulate.

**Two judgement calls worth recording, because the obvious version of this fix is
worse than it looks.**

*Separate buckets, not one.* Reusing the flyer bucket is tempting — same secret,
so one budget. But the two surfaces have opposite traffic shapes: one weekly
upload versus ops calls that arrive in bursts. A shared budget means an operator
working through a queue of price-point verifications silently loses the ability
to import that week's flyer. What actually defeats brute force is that neither
surface is *unbounded*; 10/hour in one bucket versus 10 in each is a rounding
error against a high-entropy token, and it is not worth an availability coupling
between two unrelated ops tasks. (It also removes a trap for future tests: a
shared bucket put `routes.test.js` within one call of failing on a limit it never
mentions.)

*Refund on success, charge on failure.* A brute-force budget that also charges
correct credentials is a self-inflicted outage dressed as a security control —
the tenth *successful* verification locks the operator out. Charging before the
compare and refunding after is what keeps both halves: an exhausted IP is still
429'd even when it finally sends the right token, so the 401/429 boundary can
never be used to confirm a guess.

**The general rule.** *A security control implemented per-call-site is a control
you have on some call sites.* If a check must accompany another check — throttle
with compare, ownership with shape validation (#145), auth with the DB gate — put
them in the same function and give callers no way to take one without the other.
The audit's phrasing is the test: not "is this route protected?" but "**can this
protection be routed around?**" An unthrottled sibling doesn't weaken the
throttled route, it *deletes* it.

Same family as **#139** (bypassing this same throttle by rotating a header) and
**#145** (an unauthenticated route that validated a key's shape but not its
ownership). #139 fixed the key the limiter counts on; this one fixes *where the
limiter is called from*. `app.set("trust proxy", 1)` is still in place, so
`req.ip` is not forgeable and the #139 fix holds.

**Deliberately left alone.** `GET /health` has its own inline token compare and
is **not** throttled. It is a read-only diagnostic elevation that returns 200
either way, and it is what Railway's probes and the ops dashboard poll — putting a
10/hour cap on it would break monitoring to protect a payload that reveals counts
and a masked hostname. Not an oversight; if a future audit flags it, this is the
answer.

**Test.** `backend/tests/adminTokenRateLimit.test.js`, in its own process — the
buckets are per-IP and module-scoped and every supertest request arrives from the
same loopback address, so a drained bucket would leak into unrelated suites. It
pins all three properties, plus the one that matters most for regressions: after
the bucket is drained by wrong guesses, a request carrying the **correct** token
still gets 429. If someone later moves the compare above the throttle, that test
is the one that fails.

## 150. The badge translated four of its five lines, and the safety net for the fifth was unreachable code

- Date: 2026-08-07 · Area: mobile i18n · Audit 2026-08-07 **M2 + M3 + M4 + L7**
- Symptom: a French user scans a price tag, gets the payoff badge, and reads
  *"Price ends in .97 — Costco corporate officially marked this down. Limited
  time. BUY NOW."* in English, underneath a correctly-translated title.

**Root cause (M2).** `DealBadge` rendered `detail` straight off the backend's
`DealSignal`. There was no `priceTag.deal.*Detail` key for any of the five signal
codes. On the *same badge*, `tier`, `label`, `asterisk_note` and `organic_note`
were all correctly routed through `t()` — which is what makes this an oversight
rather than a decision, and what let it survive review: the badge *looks*
localized.

**The interesting part (M3) — the fallback that could never fire.** The author
had written what looks like exactly the right defence:

```js
{t(`priceTag.deal.${signal.signal}`) || label}
```

That `|| label` is **unreachable**. `t()` resolves *active language → English →
**the key itself***, and a key is a non-empty string, so the left side is always
truthy. Worse, both keys are built dynamically, so `npm run i18n:check` — which
validates literal `t("…")` calls — could not see them either.

Nothing was broken *today*: the producer enum is closed and all five codes plus
all three tiers were mapped. The failure was scheduled. Add a sixth signal code
backend-side and the badge renders the literal string `priceTag.deal.<new_code>`
on screen — worse than the raw code — while the intended fallback to the server's
English `label` sits there looking like it handles this.

The primitive for it already existed and was already used for exactly this case:
`hasKey()`, per the `catalogLabels.js` pattern.

```js
const k = `priceTag.deal.${signal.signal}`;
const text = hasKey(k) ? t(k) : label;   // now reachable
```

**Root cause (M4 + L7) — three strings that were never keys.** `QTY` on the
receipt-review screen (a core path, every scan), `placeholder="Item name"`
sitting directly beside a correctly-translated `t("detail.editName")`, and
`placeholder="YYYY-MM-DD"`. The last one is the sharp one: the FR bundle already
says `AAAA-MM-JJ` in **all five** other date strings, so a French user got an
error message telling them to use a format the field beside it contradicted.

**Fix.** Five `priceTag.dealDetail.*` keys in EN + FR (FR keeps the decimal as a
period, `.97`, because that is what is physically printed on the shelf tag — the
whole point of the signal); `hasKey()` on both dynamic lookups; the two
literal-key sites drop their unreachable `|| note` arms instead of keeping the
crutch; `scan.qtyLabel` (**QTÉ**), `detail.editNamePlaceholder`, `scan.dateMask`
(**AAAA-MM-JJ**). Also guards `signal.tier` before `.charAt(0)` — a malformed
cached signal from the offline queue would have thrown inside render.

**Two rules worth carrying forward.**

*A fallback you cannot reach is worse than no fallback,* because it stops anyone
from writing a real one. `x || fallback` is only a safety net when `x` can
actually be falsy — and `t()` was documented as never returning falsy, in its own
header, the whole time. Before writing `||`, check what the left side does on the
failure path you are guarding against.

*A green checker is evidence about what it checks.* `i18n:check` structurally
cannot catch M4 or L7: it validates keys that are *referenced*, not display text
that never became a key, and it cannot see a dynamically-built key at all. Both
gaps are why these survived. So the test added here checks the **producer**
instead: it reads the signal codes out of `backend/services/priceSignalService.js`
and asserts each has EN + FR entries. It fails in CI the moment the backend grows
a sixth code — the only moment that is cheap to act on.

**Test.** `__tests__/dealBadgeI18n.test.js`. The render half deliberately uses the
REAL i18n bundle rather than a `t: (k) => k` stub, which would hide a missing key
— and asserts that an **unknown** code falls back to the server's English and
never to a `priceTag.*` string. (`priceTagScreen.smoke.test.js` stubs
`hasKey: () => false`, so it exercises the fallback branch by accident, which is
a useful accident.)

**Gotcha for the next person writing a render test here.** `renderer.create()`
alone returns an *uncommitted* tree under React's concurrent root: `toJSON()`
answers `null` and every `toContain` silently compares against `""`. All six
render cases failed on the first CI run while the static contract cases passed,
which made it look like a component bug rather than a harness one. Wrap in
`act()` — the pattern `priceTagScreen.smoke.test.js` already uses.

## 151. Two build settings nobody set, and a default that quietly answered for both

- Date: 2026-08-07 · Area: EAS build config · Audit 2026-08-07 **H1 + M1**
- Symptom: none, twice over. No build failed, no error was logged. One capability
  simply did not exist, and one number was quietly wrong.

**H1 — OTA updates could not reach a single production build.** `eas.json`
declared `"channel"` on the `dev` profile only. A build created without a channel
is not bound to an update branch, so `eas update --branch <x>` has nothing to
match it against. It fails **silently in the direction that looks like success**:
the CLI publishes the bundle and reports OK; the bundle reaches nobody.

The audit could not settle this from the repo and marked it VERIFY. Checked
against EAS, it was worse than suspected:

```
$ eas channel:list          ->  exactly ONE channel: "dev"
ANDROID  production  ch=NONE  v=2.8.3  FINISHED   <- live on Play
IOS      production  ch=NONE  v=2.8.1
IOS      preview     ch=NONE  v=2.8.1
IOS      dev         ch=dev   v=2.8.1
```

Everything in the repo says this capability exists: `updates.url`, a **committed
code-signing certificate** deliberately re-allowed past the blanket `*.pem` rule
in `.gitignore`, `codeSigningMetadata`, `runtimeVersion: appVersion`. Someone did
the hard 90%. The one-line binding was missing, and nothing anywhere reports its
absence.

**The part that does not get fixed.** Adding the channel only affects **future**
builds. The Android 2.8.3 currently live on Play was built channel-less and stays
that way — those users cannot be reached by OTA, ever. Which matters, because
2.8.3 is the build whose Play base-plan id bug means it sells no subscriptions.
The escape hatch was never available for the incident it would have been for.

**M1 — `preview` builds filed their crashes under `production`.** Only `dev` set
`APP_ENV`, and *both* consumers default the missing value the same way:

```
config/profiles/eas.js:17   const APP_ENV = process.env.APP_ENV || "production";
app.config.js:71            const appEnv = process.env.APP_ENV || "production";
```

So a preview build — pointing at the **development** Railway backend — reported
`environment: production` to Sentry. Production error rate, crash-free sessions
and release health were all polluted by internal test traffic, at launch, which
is exactly when those numbers have to be trustworthy.

**Fix.** A `channel` and an explicit `APP_ENV` on every profile, production
included. The `|| "production"` default stays as a safety net but is no longer
load-bearing, and the header comment now says which is which.

**The trap inside the fix, and why the obvious version is wrong.**
`assertStoreBuildIsPurchasable` documented itself as production-only but gated on
`APP_ENV || "production"` — so it had in fact been running for preview and
development all along. Setting `APP_ENV` makes the comment true *by making the
code stop checking them*. That is a silent deletion of coverage: preview is
precisely where a RevenueCat misconfiguration should be caught before it reaches
a store, and this project has already shipped that class of bug. So
non-production EAS builds now **warn loudly** where production **throws** —
failing an internal build over a missing IAP key is the wrong trade; losing the
signal entirely is worse.

**The general rule.** *A default that is never overridden is not a default — it
is the value, written somewhere nobody looks.* Both findings are the same shape:
a field left unset, a fallback quietly standing in for it, and no signal anywhere
that the fallback was doing the work. When you write `x || SOME_DEFAULT` for a
config value, ask what happens when *every* caller takes the default, because
that is the state you will actually be in.

Corollary, from the fix: *making a comment true by narrowing the code is not
free.* Check whether the behaviour you are about to delete was load-bearing
before you delete it, even when it was only happening by accident.

**Test.** `__tests__/easBuildProfiles.test.js` — static assertions over
`eas.json` (every profile declares both facts; **no two share a channel**, which
would cross-deliver updates; the profile that `extends` another still states both
itself, since inheritance is how a channel goes missing without anyone editing
the broken profile; **only `dev` resolves as the Vision-key-bundling
sub-profile**, so a second profile adopting that value cannot ship the embedded
Google Vision key in an APK never meant to carry it) plus the preflight severity
matrix.

## 152. Four kinds of dead thing, and only one of them was harmless

- Date: 2026-08-07 · Area: repo hygiene / backend routes · Audit 2026-08-07 **L1-L4**
- Symptom: none. Everything here worked, or rather, everything here was never
  reached.

**L1 — six comments cited a `docs/` directory this repo no longer has.** The hub
moved to `Priceback-Documentations`; the prefixes did not. Comment-only. One of
the six (`backend/.env.example` -> `Supabase_Cutover.md`) was not in the audit and
turned up on a full sweep — worth noting that an audit's *list* is a sample, and
the fix pass should re-run the search rather than work from the table.

**L2 — an orphaned screen that was a trap, not dead weight.** `PaywallScreen` and
route `"Paywall"` were registered and reachable by nobody; all three real gates
use `navigate("Scan", { showPaywall: true, paywallOnly: true })`. What made it
worth deleting rather than leaving was its own docstring: *"Usage:
`navigation.navigate("Paywall")` from any screen that needs to gate on credits."*
The next person adding a credit gate would have followed that instruction onto a
second, divergent presentation path bypassing ScanScreen's close/resume handling.

**L3 — an unauthenticated read with no ownership guard.** `GET
/api/me/contributions` took `deviceId` off the query string — no `requireAuth`,
no IDOR check — and returned that device's observation count. Its sibling `DELETE
/api/me/observations` does the same lookup behind `optionalAuthUser` +
`callerOwnsDevice`, **with a comment explaining why**. The two had drifted.
Deleted rather than guarded: no mobile code called it, and its docstring claimed
a Profile-screen consumer that does not exist, so guarding it would have
protected a capability nobody uses. Its only repo function,
`crowdRepo.countForDevice`, went with it.

**L4 — a route whose job was already done by another route.** `POST /api/unwatch`
had no callers and never had any: `/api/watch` **replaces** the whole list for a
key, and the client always posts its full active set, so omission *is* the
unwatch.

**The general rule.** *Dead code is not neutral — it is documentation, and it is
lying.* A registered endpoint reads as a live contract; an exported repo function
reads as a supported capability; a screen with a usage docstring reads as an
instruction. Each of these would have cost the next author real time, and in L3's
case the dead thing carried an actual auth hole. The question to ask is not "does
this run?" but "**what would someone conclude from finding this?**"

Second rule: *when you delete, leave a tombstone.* Both removed routes keep a
comment at the site saying what was there, why it went, and what to do instead —
and both are pinned as **404** in `routes.test.js`, so neither can creep back
unguarded without someone consciously deleting a test that explains itself.

Third, from L4's replacement test: *when a property is what makes something else
redundant, assert the property.* The `/api/unwatch` tests were replaced by one
asserting that `/api/watch` replaces the whole list — the behaviour the deletion
depends on, which nothing had been checking.

## 153. A cache rule that could not match anything it was written for

- Date: 2026-08-07 · Area: `Priceback-Website` `_headers` · Audit 2026-08-07 **L6**
- Symptom: content and SEO edits were not reliably live immediately, and the
  config that was supposed to guarantee that looked correct.

**Root cause.** `_headers` set `Cache-Control: public, max-age=0,
must-revalidate` on `/*.html`. But `_redirects` 301s every `.html` URL to its
extensionless form (and Cloudflare Pages does that automatically anyway), so **no
request is ever served at a `.html` path**. The rule matched nothing; HTML fell
back to Cloudflare's defaults.

Two correct configuration files, each right on its own, combining into a rule
that cannot fire. Nothing reports an unmatched header rule.

**Fix.** Enumerate the ten clean paths. **Not `/*`** — a catch-all would also
match `/assets/*`, and the two rules would then be fighting over `Cache-Control`
by declaration order; getting that precedence wrong silently either drops the
favicon's one-year cache or leaves CSS stale. Ten lines that can only do one
thing beat a wildcard whose behaviour depends on semantics you would be guessing
at.

**The general rule.** *A routing rule and a matching rule have to be read
together.* Any config that selects on a URL shape is invalidated by anything else
that rewrites that shape — redirects, rewrites, clean-URL defaults. And a pattern
that matches nothing is indistinguishable from a pattern that works, because both
produce no error.

## 154. "Is DATA_DIR set?" was a question only a dashboard could answer

- Date: 2026-08-07 · Area: backend `/health` · Audit 2026-08-07 **L5**
- Symptom: unknown, which is the entry.

**Root cause.** `backend/railway.json` sets no `DATA_DIR`, so `server.js` falls
back to `path.join(__dirname, "data")` — inside the container image, which
Railway recreates empty on every deploy. At stake: `watched.json` (the whole
price-watch registry), `notifyLedger.json` (the send-once dedupe ledger — a reset
**re-notifies drops already sent**), and `flyerOffers`/`flyerHistory.json` (the
active flyer overlay, the *primary* price source). Degradation rather than
permanent loss — flyer offers and the OCR budget have `kv_state` counterparts and
clients re-register watches on focus — but silent.

The code had warned about this in two comments for months. The audit marked it
**VERIFY** and correctly declined to call it a defect: whether `DATA_DIR` is set
as a Railway *service variable* is not knowable from the repository. It was not
settleable during the fix pass either — the Railway CLI is not authenticated in
that environment.

**Fix — for the shape of the problem, not the value.** `GET /health` (admin) now
carries `checks.storage`: the resolved path, whether it came from the env,
writability, the files actually on disk **with their mtimes**, and one of three
verdicts — `local` (not on Railway, nothing to warn about), `volume`, or
`ephemeral` — with a note naming the fix. Admin-only; the path and the listing
are infrastructure detail and stay out of the anonymous payload.

**This did not close the finding.** Mounting a Volume and setting `DATA_DIR` on
both the production and development services is still owed. What changed is that
verifying it is now a five-second authenticated call that stays true after the
next config change, instead of a dashboard hunt nobody repeats.

**The general rule.** *When a fact about production can only be learned by
opening a dashboard, it will be learned once and then assumed forever.* The
useful response to "I cannot verify this from here" is often not to go and verify
it, but to make the system report it — the same instinct behind the `/health`
dependency probes and the Apple-auth key whose mere presence on `/health`
confirms a deploy carries the verifier. Prefer mtimes over "is it configured":
one answers *did this survive*, the other only *should it have*.

Note the boundary bug this class of check invites, and which the test pins: "is
the path inside the app directory?" is a prefix comparison, and a naive one also
matches a **sibling** (`/app-elsewhere` for `/app`). Compare with the separator,
and handle the directory itself.

## 155. Reading one property off `react-native` loaded a push-notification module that killed the app

- Date: 2026-08-09 · Area: `src/services/authService.js` · Sentry
  `PRICEBACK-CANADA-9` (fatal) + `PRICEBACK-CANADA-A`
- Symptom: on the first-ever iPhone build (2.8.1, TestFlight), tapping "Continue
  with Apple" crashed the app. Android had shipped the same code for months
  without a single event, and the whole Jest suite was green.

**Root cause.** `signInWithApple()` opened with

```js
Platform = (await import("react-native")).Platform;
```

which wanted exactly one property. Metro compiles a dynamic import to
`importAll` (`metro-runtime/src/polyfills/require.js:130`), and `importAll`
short-circuits **only** when the target sets `__esModule`. `react-native`'s
`index.js` is plain CommonJS — `module.exports = { get X() {…} }` — so it fell
through to `for (const key in exports) importedAll[key] = exports[key]`, which
**invokes every getter on the module**.

One of them is `get PushNotificationIOS()`, a deprecated lazy re-export. Reading
it requires a module whose *body* runs
`new NativeEventEmitter(NativePushNotificationManagerIOS)`. In an Expo app that
native module is null — `RCTPushNotificationManager` isn't linked, expo-notifications
is — and `NativeEventEmitter`'s non-null invariant is guarded by
`if (Platform.OS === 'ios')`. Android passed `null` happily; iOS threw
`Invariant Violation` out of a module factory, which Metro's `guardedLoadModule`
hands to `ErrorUtils.reportFatalError`. Unhandled, fatal, app gone.

The second Sentry issue, "React Native unavailable", is the same event caught by
this function's own `catch` — a message invented for a failure mode that cannot
happen, sitting on top of one that very much can.

**Fix.** `import { Platform } from "react-native"` — static, named. A named
import compiles to a member access, so exactly one getter is read. The lazy
import of `expo-apple-authentication` stays: it is real ESM, so Metro marks it
`__esModule` and `importAll` returns before enumerating. Both call sites needed
it — `_loadAppleAuth()` had the identical line, and it backs the ten-minute Apple
token refresh, so even a sign-in that *succeeded* would have crashed later.

**Why no test caught it, and what that means for the guard.** Jest transpiles the
same syntax through Babel's `_interopRequireWildcard`, which copies getters with
`Object.defineProperty` — it *re-defines* them rather than reading them. Metro
assigns, which reads. The two module runtimes disagree precisely at the line that
crashes, so **no behavioural Jest test can reproduce this**; one written against
the broken code passes. The regression guard is therefore a source assertion
(`__tests__/noReactNativeNamespaceImport.test.js`): nothing under `src/` may
dynamic-import or `import * as` from `react-native`.

**The general rule.** *A namespace import is a request to evaluate every export,
not the one you named.* Any barrel of lazy getters — and `react-native`'s index is
the biggest one in the tree — turns that into "run every deprecated module in the
framework". Import the binding you want by name; reach for `import * as` or
`await import()` only for modules you genuinely want loaded whole.

And the corollary that made this expensive: *a green suite proves the Babel
bundle works, not the Metro one.* Anything whose failure lives in module-loading
semantics — dynamic imports, side-effecting module bodies, native-module presence
— is invisible to Jest by construction. The first build on a new platform is the
first real test of the bundler, and it deserves to be treated as one.

## 156. A search that had never once run, failing quietly for a month

- Date: 2026-08-09 · Area: `src/services/emailSyncService.js` · Sentry
  `PRICEBACK-CANADA-5` (16 events since release 2.7.0)
- Symptom: none visible. Outlook sync "worked" — it just found fewer receipts
  than it should have.

**Root cause.** The Graph query asked for both at once:

```
/me/messages?$search="(from:… ) AND (subject:…)"&$top=50&$orderby=receivedDateTime desc
```

Microsoft Graph rejects `$search` combined with `$orderby` outright —
`400 SearchWithOrderBy` — because search results come back ranked by relevance
and there is nothing to re-order. So the request failed for **every** mailbox,
every time, since it was written.

It failed into a fallback built for a different problem. The `catch` was there to
handle mailboxes that can't do `$search` at all (`MailboxNotEnabledForRESTAPI`),
and it accepts any `bad_request` — so a permanent, universal syntax error was
absorbed by a branch meant for a rare per-mailbox capability gap. The fallback
lists the 50 most recent messages from *any* sender and parses the first 20. The
store filter the whole function is built around never executed once.

**Fix.** Drop `$orderby` from the `$search` request only. The fallback keeps it —
it sends no `$search`, so it's legal there, and recency is exactly what that path
wants.

**The general rule.** *A fallback that is always taken is not a fallback, it is
the implementation — and it hides the fact that the primary path is dead.* When a
`catch` broadens from a specific provider code to a whole status class, it stops
distinguishing "this mailbox is unusual" from "this request is malformed". The
tell was in Sentry the entire time: 16 events, `handled: yes`, nobody looking,
because handled errors on a working feature read as noise.

Pin the shape of an outbound request, not just its failure handling — the test
that would have caught this is one line asserting the search URL carries no
`$orderby`.

## 157. A restore that worked reported failure, because the success path threw and the error path caught it

`Paywall.handleRestore` resolved the restored tier's display name with
`catalogText(...)`. The file never imported it. Every other consumer does —
`ManageSubscriptionScreen.js`, `StoresAndProfileScreens.js` — so this was one
missing name in one import list.

What makes it worth an entry is the *shape*, not the typo. The call sat inside
the handler's `try`, alongside the error handling, which inverted the failure
mode completely:

- restore **succeeds** → `ReferenceError` → the `catch` tells the user
  "Restore failed", and `onPurchased` never fires, so an entitlement RevenueCat
  had just handed back is silently dropped;
- restore **fails** → the `else` branch runs → works perfectly.

So the bug was invisible in exactly the situation you would test it in
(no subscription to restore), and fired only for the users who had paid.

`Paywall.js` is the app's only restore surface. Apple exercises that control
directly when reviewing an auto-renewable subscription (Guideline 3.1.1), so
this was also a live rejection on a submission that had not happened yet.

**Why it survived CI.** The existing suite mocked `restorePurchases` to resolve
`{ success: false }`. Every assertion passed; the success branch had never once
been executed. The new `__tests__/paywallRestore.test.js` mocks it succeeding.

**The general rule.** *When a handler's happy path and its error path share one
`try`, a bug in the happy path presents as the error path.* The message the user
reports then names the branch that did not run, and sends you to read the wrong
code. Two habits fall out of it: keep the `try` around the operation that can
genuinely fail rather than the whole handler, and treat "mock it succeeding" as
the mandatory test, not the optional one — failure paths are usually the ones
that get mocked, because they are easier to construct.

## 158. `allowsEditing: true` means "let them crop" on Android and "square crop" on iOS

Both of PriceBack's content-ingest paths — the receipt library upload in
`ScanScreen`, the price-tag capture in `PriceTagScanScreen` — passed
`allowsEditing: true` to `expo-image-picker`.

From the library's own type definitions:

> "This is only applicable on Android, since on iOS the crop rectangle is
> **always a square**."

A receipt is a tall portrait strip. On iPhone the user was forced through a
square crop that guillotined the receipt before OCR ever saw it, so the parse
failed or returned a wrong total — and there was no way at all to submit a full
receipt from the photo library on iOS. On Android the same flag opens a
free-form crop and the flow works, which is why it never surfaced.

The comment directly above the call asserted the opposite: "iOS … keep the
system picker with its manual editor". It named the difference and then assumed
the two editors were equivalent.

**Fix.** `allowsEditing: Platform.OS !== "ios"`. iOS passes the whole image
through to OCR, which is the same input shape the camera path
(`takePictureAsync` → `processImage`) has always shipped uncropped on both
platforms — a known-good path rather than a new one. Android is byte-identical.

**The general rule.** *A cross-platform boolean can still mean two different
things per platform, and the difference is worst when the flag governs
user-visible geometry.* `allowsEditing` reads as a capability ("can the user
crop?") but is really a policy ("which crop UI?"). Before trusting one on a
path that produces data another system has to parse, read the platform notes —
and be suspicious of any comment that names a platform difference in prose
without encoding it in the code beneath.

## 159. Every purchase date became "today" east of Greenwich — a local-time parse validated with UTC getters

- **Date:** 2026-08-10 · **Area:** mobile (parsing) · **Reported:** 2.8.5 iOS TestFlight
- **Symptom:** Receipts whose printed date was months in the past were saved with
  the scan date. The raw OCR was perfect and the date was visibly in it. Prod row
  `r_1786356914240_m7ruw` saved `purchase_date = 2026-08-10` while its `raw_ocr`
  ends with the printed `2026/03/08 17:55:13`. Reproduced on demand: a re-scan of
  the same receipt did it again.
- **Root cause:** `extractDate`'s `buildIso` (receiptParsingShared.js) built
  `new Date(iso + "T00:00:00")` — **no `Z`, so parsed in LOCAL time** — and then
  confirmed the round-trip with `getUTCMonth()` / `getUTCDate()`. East of UTC,
  local midnight falls on the **previous day in UTC**, so `getUTCDate()` returned
  d−1, the check failed, and `extractDate` returned `null` for **every date on
  every receipt**. `ScanScreen` then did `setDate(data.date || todayLocalISO())`.
  Nothing was wrong with the OCR, the compliance scrub (verified: loses the date
  on 0 of 31 fixtures), or the #71 header re-sourcing — the date was extracted
  correctly and then thrown away by its own validity check.
- **Why every test passed:** the check only misbehaves at a **non-zero UTC
  offset**. CI runs at UTC — offset 0, the single value where local midnight and
  UTC midnight coincide — so the entire suite was green, *including* the
  per-fixture `date` invariant added by #71 specifically to catch this field. The
  reporter's device is at UTC+3.
- **Fix:** the day-of-month check is now pure arithmetic (days-in-month + leap
  year); `buildIso` never constructs a `Date`. A calendar validity check has no
  business depending on where the phone is. Verified byte-identical across
  UTC−8…UTC+12 and against all 31 real-OCR fixtures.
  Same defect one function away: `scanWithVeryfi` ran the provider's wall-clock
  stamp through `new Date(x).toISOString()`, which reinterprets a local timestamp
  as UTC and rolls the day **backwards** east of Greenwich — extracted as
  `normalizeProviderDate`, which takes the printed Y-M-D literally.
- **Files:** `src/services/receiptParsingShared.js` (`buildIso`, `daysInMonth`),
  `src/services/ocrService.js` (`normalizeProviderDate`),
  `src/screens/ScanScreen.js` (no more today-fallback); tests
  `__tests__/receiptParsingShared.test.js` (nine-timezone matrix),
  `__tests__/receiptPipeline.live.test.js` (the prod OCR through the real chain,
  per timezone), `__tests__/ocrServiceExtra.test.js`.
- **Detect next time:** a saved `purchase_date` equal to `created_at::date` is the
  signal — query it directly:
  `select id, purchase_date, created_at::date, raw_ocr from priceback.receipts where purchase_date = created_at::date order by created_at desc;`
  then check whether the row's own `raw_ocr` contains a printed date. If it does,
  the parser is discarding it, not missing it.
- **Prevent:** **never mix local-time parsing with UTC getters.** `new Date("…T00:00:00")`
  is LOCAL; `new Date("…T00:00:00Z")` and `Date.UTC(…)` are UTC — pick one and use
  the matching getters throughout, or (better) do calendar arithmetic without
  `Date` at all. And: **a green CI run at UTC is not evidence for date logic.**
  Any test covering date parsing/validation must drive `process.env.TZ` across
  both sides of the meridian; Node applies a reassignment at runtime, so a
  `test.each` over zones costs nothing.

## 160. The warehouse address was sold as a product, and it ate the first item's label

- **Date:** 2026-08-10 · **Area:** mobile (parsing + geometry) · **Reported:** 2.8.5 iOS TestFlight
- **Symptom:** "the first 2 products was gathering bad informations from the header
  or missing a part of the label", with clean OCR. Intermittent — a re-scan of the
  same receipt parsed every label correctly. Reproduced:
  `Gloucester, ON K1J 1A5 @7.99` shipped as an item **and** the real `RUFFLES REG`
  vanished, because the pairing consumed its price.
- **Root cause:** `stripWarehouseInfo` deliberately runs **post-parse**
  (`receiptParser.js`) because store detection needs the "COSTCO" keyword — so
  while items are being extracted the header block is still live text, sitting
  directly above the first item. That adjacency is the whole bug, and it is why
  only the FIRST items were ever affected. Two consumers:
  1. `extractItems`' 2-line NAME→PRICE pairing refused only **negative** amounts.
     #67 closed exactly this hole for discounts ("fabricates a phantom item out of
     whatever text sits above the discount row (e.g. the warehouse address line)")
     and left the **positive**-price case open. A header line clears every other
     guard: it isn't a summary keyword, it has ≥3 alpha chars, it's >2 long.
  2. `reconstructRowsFromAnnotation` Pass 2 folds letter-less orphan rows into the
     nearest name-bearing anchor. Header rows are full of letters, so they were
     eligible anchors — and the first item's bare price is the orphan physically
     nearest to the address.
  Framing-dependent (it needs the price OCR'd as its own row), hence intermittent.
- **Fix:** one shared predicate, `isWarehouseInfoLine` in `shared/ocrCleanup.js` —
  factored out of `stripWarehouseInfo` so there is exactly ONE definition of "this
  is a header line" and it cannot drift from what gets stripped. The pairing
  refuses it as a name; geometry excludes it from `anchors` (mirroring the existing
  `isTpd` exclusion). **The safety property is the priced-line exemption**: a line
  carrying an amount is never header, so a real product can never be dropped by
  either guard.
  Deliberately NOT reordering the pipeline to strip the header before parsing —
  store/warehouse/province detection reads those lines, and moving the strip would
  put all of them at risk to fix a name-pairing bug.
- **Files:** `shared/ocrCleanup.js` (`isWarehouseInfoLine`),
  `src/services/receiptParsingShared.js` (`extractItems` guard),
  `src/services/receiptGeometry.js` (anchor exclusion, `rowText` extracted); tests
  `__tests__/ocrCleanup.test.js`, `__tests__/receiptGeometry.test.js`,
  `__tests__/receiptPipeline.live.test.js`.
- **Detect next time:** an item named after a city, street or the store itself. Diff
  the parse against the fixtures before/after any change here — all 31 committed
  captures must produce identical items, names, sums and totals.
- **Prevent:** when a cleanup step is deliberately deferred until after parsing,
  every parser stage that runs in the meantime is exposed to the text it will
  remove. Guard the consumers with the *same predicate* the stripper uses rather
  than a second regex — and when a guard is added for one sign/shape of a value,
  ask immediately whether the opposite sign has the same hole. #67 fixed the
  negative case; the positive one sat there for another six weeks.

## 161. iOS let the user scan any number of receipts and silently kept one

- **Date:** 2026-08-10 · **Area:** mobile (capture) + native patch · **Reported:** 2.8.5 iOS TestFlight
- **Symptom:** "scanning a receipt auto crop allows multiple scans … if the user
  tries to upload few receipts at the same time, there will be no accurate
  reference." Scanning three receipts in one scanner session produced one receipt,
  with nothing indicating which of the three it was or that anything was dropped.
- **Root cause:** `autoCrop.scanDocumentWithAutoCrop` passes `maxNumDocuments: 1`,
  which the plugin documents as **Android only** — and it is: Android's
  `DocumentScannerModule.kt` forwards it to MLKit `setPageLimit()`, while iOS's
  `DocumentScanner.swift` forwards **only** `responseType` and
  `croppedImageQuality` and never reads it. VisionKit therefore accepted unlimited
  pages, and the JS took `result.scannedImages[0]` and discarded the rest with no
  message. Textbook platform-parity defect: the option looked honoured because the
  code passed it.
- **Fix:** VisionKit exposes **no public API to cap page count mid-session** (there
  is no per-shutter delegate hook), so it cannot be prevented in the scanner UI
  without private API — an App Review risk. The cap is applied on the way out
  instead: the patched `DocumentScanner.swift` truncates to `maxNumDocuments` and
  returns `capturedPageCount` (the pre-truncation count); Android returns the same
  field for a uniform JS contract. `scanDocumentWithAutoCrop` derives
  `discardedCount` and every capture surface surfaces a non-zero value via
  `notifyDiscardedScans` (EN + FR). Losing a capture is tolerable; losing it
  silently is not.
- **Files:** `patches/react-native-document-scanner-plugin+2.0.4.patch` (iOS Swift,
  Android Kotlin, both `.ts` declarations — the upstream "Android only" doc comment
  is corrected in place), `src/services/autoCrop.js`,
  `src/utils/scanCaptureAlerts.js` (new), `src/screens/{ScanScreen,PriceTagScanScreen}.js`,
  `src/services/i18n.js`; tests `__tests__/autoCrop.test.js`,
  `__tests__/scanCaptureAlerts.test.js`.
- **Detect next time:** any option whose doc comment says "Android only" / "iOS
  only" but which the shared code passes unconditionally. Read the native source
  for both platforms — `node_modules/<plugin>/{ios,android}/` — rather than
  trusting the JS signature.
- **Prevent:** *passing an option is not the same as it being honoured.* When a
  cross-platform wrapper takes a constraint that only one platform enforces, the
  other platform needs an explicit boundary check, and any data the wrapper drops
  must be counted and reported — never `[0]` with the remainder thrown away.

## 162. The fix for a silent wrong date became a mandatory calendar trip

- **Date:** 2026-08-10 · **Area:** mobile (scan review) · **Reported:** 2.8.5 iOS TestFlight
- **Symptom:** after #159, a receipt whose printed date OCR couldn't read arrived
  at the review screen with an **empty** purchase-date field, an "unreadable date"
  hint and a Save button that refused. Reporter: "WHAT I ASKED is that when the
  date is in the OCR you get it from the OCR, otherwise you fill the date field
  with the actual date (today) — you can also require validation by the user."
- **Root cause:** not a defect — a deliberate behaviour change shipped alongside
  #159, and the wrong trade. Silent prefill (≤2.8.5) and empty are the two ends of
  one axis, and both are wrong: the first stamps the scan date on an old receipt
  with nothing saying so, the second costs a calendar interaction on the **10 of
  31** real captures where Costco's bottom-printed date wasn't photographed. The
  axis itself was the mistake — the field carried a value with no record of where
  the value came from, so the UI could only ever trust it completely or not at all.
- **Fix:** `resolveScannedDate` (`src/utils/purchaseDate.js`) returns the date
  **and its provenance** — `"ocr"` (read off the receipt), `"assumed"` (today,
  offered because nothing was readable), `"user"` (confirmed or picked). Today is
  prefilled again, but `"assumed"` renders an amber bar, disables Save and is
  refused by `doSave()`; one tap on **Confirm** — or picking any day, which is
  itself a statement — clears it. Cost is one tap, on the receipts that need it,
  and no assumed date can reach the database unvouched-for.
- **Files:** `src/utils/purchaseDate.js` (new), `src/screens/ScanScreen.js`,
  `src/components/index.js` (`Button` gains an optional `disabled`, distinct from
  `loading`), `src/services/i18n.js` (EN + FR); tests
  `__tests__/purchaseDate.test.js` (nine-timezone matrix — the module is pure
  string work and holds no `Date`, which is what keeps #159 from recurring).
- **Detect next time:** a field that is auto-filled from a fallible source and
  read back as if authoritative. Ask what the screen would render differently if
  it knew the value was a guess; if the answer is "nothing", the provenance is
  missing.
- **Prevent:** *when a value can be a guess, store where it came from, not just
  what it is.* "Prefill or leave blank" is a false choice; the third option is
  prefill **and** mark it, which is the only one that keeps both the convenience
  and the honesty.

## 163. One person, one email, two accounts — because the primary key belongs to the identity provider

- **Date:** 2026-08-10 · **Area:** backend (identity) + mobile (onboarding) · **Reported:** first iOS sign-up
- **Symptom:** "when I signed up for the first time on iOS, the Apple account used
  the same email. At first it started restoring all the data, then redirected to
  the sign-up form to choose country, province, postal code, terms… and then
  created a new account, also giving 75 free credits. There wasn't any data in the
  app when it launched."
- **Root cause:** `users.sub` is the primary key and a `sub` is issued **by the
  provider** — Apple's bears no relation to Google's for the same human, and
  `users.email` (indexed) was never consulted for identity. Worse, the account was
  created by the *restore*: `/api/me/bootstrap` calls `upsertFromOAuth` before it
  reads anything, so the "Restoring your account…" screen itself inserted the row
  and fired the one-time `FREE_TRIAL_CREDITS` grant. The empty payload then sent
  `decideSignInRoute` down its `"setup"` branch. Every step behaved as written;
  the app simply had no concept of one person holding two provider identities.
- **Fix — and the option deliberately NOT taken.** The obvious fix is identity
  linking (a `user_identities` table mapping provider subs to one canonical user).
  It was rejected on **RevenueCat** grounds: the client binds RC to whichever
  provider `sub` it holds, and the webhook writes subscription state and purchased
  credits to `users.sub = event.app_user_id`. Under linking, an iOS purchase lands
  on the Apple sub while the signed-in account is the Google row — entitlements and
  paid credits on the wrong user. Closing that means re-`logIn`-ing the RC
  app-user-id on devices that have already purchased, and whether the entitlement
  follows depends on a RevenueCat dashboard transfer setting and on real store
  transactions. Untestable in CI, and it touches money.
  So instead: **one ACTIVE account per verified email.** `upsertFromOAuth` refuses
  the second provider with a typed `EmailClaimedError`; `/api/me` and
  `/api/me/bootstrap` answer **403 `email_claimed`** carrying the owning provider;
  onboarding routes that to `"blocked_email"`, names the provider and signs back
  out. The block is **temporary by construction** — deleting the first account is
  a *soft* delete, so the address stops being an active claim — and the
  replacement account gets **no** welcome credits, because the tombstone still
  carries `trial_credits_granted_at`. That is the existing per-sub guard widened
  to per-email; without it, delete-and-switch-provider farms 75 credits a lap.
  **No migration:** `users.status`, `trial_credits_granted_at` and `users_email_idx`
  already existed.
- **Files:** `backend/lib/accountIdentity.js` (new), `backend/repos/usersRepo.js`,
  `backend/lib/httpError.js`, `backend/server.js`, `src/services/syncService.js`,
  `src/screens/OnboardingScreen.js`, `src/services/i18n.js` (EN + FR); tests
  `backend/tests/{accountIdentityUnit,duplicateAccountGuardDb,emailClaimedRouteDb}.test.js`,
  `__tests__/{onboardingSignInRecovery,syncServiceHydrate}.test.js`.
- **The containment that matters.** A guard like this fails by locking a
  legitimate user out. Four rails: it only fires when the provider asserted
  `email_verified` (an unverified address could otherwise be aimed at someone
  else's account); only when the incoming sub has **no active row**, so nobody is
  ever refused the account they are already signed into; never on the webhook or
  placeholder paths; and pairs of active rows that already share an address are
  untouched, so deploying it cannot lock out anyone who is currently signed in.
- **Known and accepted:** Apple's "Hide My Email" relay address cannot match a
  Google address, so those users still get a separate account — unavoidable
  without linking. The per-email trial suppression expires with the tombstone
  after 30 days (`purgeExpiredDeletions`), the same window that already exists for
  same-sub re-signup.
- **Detect next time:** any table whose primary key is a value a third party
  mints. Ask what happens when the same human returns holding a different one.
- **Prevent:** *account creation must not be a side effect of a read.* A
  "restore my account" endpoint that upserts before it reads will create the very
  account it was asked to find, and will pay out a signup grant while doing it.

## 164. The keychain would not hand back the token while the phone was locked

- **Date:** 2026-08-10 · **Area:** mobile (auth storage) · **Found by:** iOS audit #2
- **Symptom:** iOS-only, and silent. Background work — the daily price check,
  both offline scan-queue drains, push-token sync — behaved as if the user were
  signed out whenever the phone was locked. Downstream it presents as the
  already-filed "the scan worked but no row appeared in the database", because
  `authedFetch` sends the request with **no** `Authorization` header when the
  token read returns null, the backend answers 401, and the client treats 4xx as
  terminal.
- **Root cause:** `expo-secure-store` defaults to `WHEN_UNLOCKED`
  (`ios/SecureStoreOptions.swift`: `var keychainAccessible: SecureStoreAccessible
  = .whenUnlocked` maps to `kSecAttrAccessibleWhenUnlocked`), and not one of the
  app's three writers passed an option. That attribute makes the item readable
  *only* while the screen is unlocked. Android's SecureStore is Keystore-backed
  SharedPreferences with no `setUserAuthenticationRequired`, so lock state is
  irrelevant there — the platform has no knob that corresponds to the broken one,
  which is why months of Play traffic never surfaced it.
- **Fix:** one owner module, `src/services/secureStore.js`, writes everything with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — readable after the first unlock
  following a reboot, and never copied into an encrypted iCloud backup (a session
  token should not ride a device restore onto different hardware). The three
  previous writers delegate to it and keep their own error policies unchanged.
- **The trap that makes this worth reading:** an existing keychain item keeps the
  attribute it was **created** with, so a migration is mandatory — and the obvious
  migration silently does nothing. `SecItemUpdate` cannot change
  `kSecAttrAccessible`, and expo's `set()` falls back to `update()` on
  `errSecDuplicateItem` with an update dictionary of `[kSecValueData]` only.
  Re-writing the value leaves `WHEN_UNLOCKED` in place while every plausible
  assertion ("we called `setItemAsync` with the option") passes. The item must be
  **deleted first** so the write takes the `SecItemAdd` path.
  `migrateKeychainAccessibility()` reads before it deletes and **skips any key it
  cannot read** — the bug being fixed *is* an unreadable keychain, so treating
  "invisible" as "absent" would delete a live token.
- **Files:** `src/services/secureStore.js` (new), `src/services/authService.js`,
  `src/services/emailSyncService.js`, `src/services/storageService.js`,
  `src/screens/SplashScreen.js`; test
  `__tests__/secureStoreAccessibility.test.js`.
- **The second-order trap, which also bit:** `secureStore.js` is imported by
  three widely-imported services, so anything it imports at **module scope**
  lands in the import graph of most of the app. The first version imported
  `AsyncStorage` statically and broke `ocrService.test.js` — a suite with no
  reason to mock it — with `NativeModule: AsyncStorage is null`. It now imports
  nothing at module scope; the migration's flag store is required lazily.
- **…and the trap inside THAT fix.** Going lazy, the code read
  `(await import("…/async-storage")).default`. Correct under Metro, where the
  module is ESM and `default` is the store. But this repo rewrites `import()` to
  a bare `require()` **with no interop** in the test env
  (`babel-plugin-import-to-require.js`, added so jest-expo's CJS VM doesn't need
  `--experimental-vm-modules`), so `.default` was `undefined`, the flag read
  threw, and the migration **returned early having done nothing while looking
  like it ran**. Eight tests caught it. The fix is the idiom `autoCrop.js` and
  `exportService.js` already use: `const mod = await import(x); const M =
  mod?.default || mod;`. Treat `mod?.default || mod` as load-bearing on every
  dynamic import in this repo, not defensive noise.
- **Detect next time:** any cross-platform storage/crypto wrapper with a
  per-platform default that isn't in the shared signature. Read the native
  options struct, not the JS docstring.
- **Prevent:** *"is it encrypted?" is the wrong question; "when can it be read?"
  is the one that decides whether background work exists.* A storage API that
  looks identical on both platforms can still differ in availability, and
  availability is what unattended code depends on.

## 165. The app-icon badge went on with the first price drop and never came off

- **Date:** 2026-08-10 · **Area:** mobile (notifications) · **Found by:** iOS audit #2
- **Symptom:** iOS only. A red badge appeared on the PriceBack icon at the first
  price-drop alert and stayed there permanently — through reading it, claiming
  the refund, and every subsequent launch.
- **Root cause:** `setNotificationHandler` asks for `shouldSetBadge: true` and
  `sendPriceDropNotification` carries `badge: 1`, but `setBadgeCountAsync` was
  never called anywhere in the repo. On iOS the icon badge is **app-owned** state
  and persists until the app zeroes it. Android launchers tie the badge to the
  notification and clear it on dismiss, so the platform quietly did the work the
  app had forgotten — no Play user could ever have reported it.
- **Fix:** `clearBadge()` in `notificationService`, called when the app returns to
  the foreground (deliberately outside `App.js`'s 5-minute hydrate throttle — one
  native call, and the only thing there the user can see on their home screen) and
  again after a notification tap is routed. Fire-and-forget: a badge failure must
  never swallow the tap or block a boot.
- **Files:** `src/services/notificationService.js`, `App.js`; test
  `__tests__/notificationBadge.test.js`.
- **Detect next time:** any state the app *sets* on an OS surface. Search for the
  clearing call at the same time you write the setting call.
- **Prevent:** *when one platform cleans up after you, the missing cleanup is
  invisible until you ship on the other one.* Badges, channels, categories and
  shortcuts are all app-owned on at least one platform.

## 166. Twelve notification strings were English no matter the language

- **Date:** 2026-08-10 · **Area:** mobile (i18n) · **Found by:** iOS audit #2
- **Symptom:** both platforms. Every price-drop and claim-window notification —
  title, body, and the four action buttons revealed by pulling the notification
  down — rendered in English for French users. Money was formatted `$12.34`
  rather than `12,34 $`.
- **Root cause:** the strings were template literals inside
  `notificationService`. Drift, not an unmade decision: the
  `sendTagScansReadyNotification` / `sendReceiptScansReadyNotification` senders in
  the *same file* already used `t()`. A rule followed in one function and not its
  neighbour needs a test, not a reminder.
- **The iOS-specific half:** notification **categories** (iOS) and notification
  **channels** (Android) hand the OS a *copy* of their labels, which the OS caches
  and redraws from. Nothing re-reads them on a language change, so even after
  translation a user who switched to French would have kept English buttons and
  English channel names in system settings until reinstalling.
- **Fix:** all twelve moved to `i18n.js` (EN + FR), rewritten for a shopper rather
  than transliterated — so the English copy changed too, deliberately. The amount
  is interpolated so each language positions its own currency symbol. A singular
  variant covers the one-day case, because `expiryWarnDays` is DB-tunable and
  could legally be `1` ("closes in 1 days"). One guarded `onLanguageChange`
  subscription re-pushes both the iOS categories and the Android channels.
- **Files:** `src/services/notificationService.js`, `src/services/i18n.js`; test
  `__tests__/notificationI18n.test.js`.
- **The mistake made while fixing it, which CI caught:** rewriting the copy
  freely also **moved information between title and body** — the store name left
  the price-drop title, the amount left three claim-window bodies. Six
  assertions in the existing `notificationService.test.js` failed, and they were
  right to. A claim reminder whose body doesn't restate the amount is weaker
  copy, and a title is often all a user reads on a lock screen. The shipped
  version keeps every field where it was and changes only the wording, so
  exactly one assertion changed: an exact-equality pin on the price-drop title
  (`💰 Price Drop at Costco!` → `💰 Price drop at Costco`).
- **Detect next time:** grep for `title:` / `body:` / `buttonTitle:` followed by a
  quote or backtick. It is now a test.
- **Prevent:** two rules, and the second is the less obvious one.
  *(1) Labels you hand to the OS are cached by the OS* — translating the string
  is only half the job; something has to re-register it when the language
  changes, or the user sees the old language until reinstall.
  *(2) When you rewrite user-facing copy, the FIELDS it carries are the
  contract; the sentence around them is not.* A test asserting
  `toContain("$12.50")` pins the contract, and a rewrite that breaks it is
  usually removing information rather than improving prose.

## 167. The only profile that can build an iPhone binary warned instead of failing

- **Date:** 2026-08-10 · **Area:** build config · **Found by:** iOS audit #2
- **Symptom:** an EAS `device` build with no `REVENUECAT_API_KEY_IOS` produced an
  installable iPhone binary whose paywall could sell nothing, announcing it only
  as a line in the build log.
- **Root cause:** `app.config.js`'s store-build preflight is fatal only when
  `APP_ENV === "production"`. The `device` profile — added by the previous iOS
  audit as the *only* profile that can produce an installable iPhone binary,
  `preview` being simulator-only — extends `preview` and therefore inherits
  `APP_ENV: "preview"`. So the one build you take an on-device checklist through
  was the one exempted from the check, and that checklist's item 5 is "Restore
  Purchases with a sandbox subscription".
- **Fix:** severity is keyed off `EAS_BUILD_PROFILE` rather than `APP_ENV`, with
  `device` joining `production` as fatal. Every other profile still warns rather
  than skipping, and `ALLOW_MISSING_IAP_KEY=1` remains the explicit opt-out. The
  message now names the profile, so it points at the thing to change.
- **Files:** `app.config.js`; test `__tests__/easBuildProfiles.test.js`.
- **Detect next time:** whenever a build profile is added by `extends`, list what
  it inherits and ask which *checks* keyed off those inherited values just changed
  meaning for it.
- **Prevent:** *derive a check's severity from what the build is FOR, not from a
  variable that happens to correlate.* `APP_ENV` describes which backend to talk
  to; it was never a statement about how much a broken paywall would cost.

## 168. The claim share sheet's subject line was hardcoded English

- **Date:** 2026-08-10 · **Area:** mobile (i18n) · **Found by:** iOS audit #2
- **Symptom:** both platforms. Sharing a completed price-adjustment claim
  produced an English header and an English chooser/subject line regardless of
  app language — on the screen the whole product exists to reach. A receipt
  referencing an unknown store additionally rendered the literal string
  `undefined` in both.
- **Root cause:** `ClaimAssistantScreen.handleShare` built `message` and `title`
  as template literals. `title` is easy to read as decoration; it is not — it is
  the **chooser heading on Android and the Mail subject line on iOS**, so it is
  user-visible on both. `${store?.name}` had no fallback.
- **How it was found:** not by looking for i18n bugs. It surfaced during the
  platform-divergence sweep of `Share`/`expo-print` (checking whether any call
  passed a `url`, which Android silently ignores). The sweep itself came back
  clean — but it put eyes on a call nobody had localized. Worth keeping as
  method: a parity sweep is also a reading pass over code that shared-behaviour
  reviews skim.
- **Fix:** both strings moved to `i18n.js` (EN + FR); `store?.name || ""`
  matching every other interpolation on that screen.
- **Files:** `src/screens/ClaimAssistantScreen.js`, `src/services/i18n.js`; test
  `__tests__/claimAssistantScreen.test.js`.
- **The testing note that matters:** that test file mocks i18n with
  `t: (k) => k`, so a **rendered** assertion cannot distinguish a translated
  string from a hardcoded one — both appear as text in the tree. The guard has
  to be a source assertion. Key existence and cross-language parity are already
  enforced by `npm run i18n:check`, so the test only has to prove nothing is
  baked in.
- **Detect next time:** grep the arguments of `Share.share`, `Alert.alert`,
  `Linking.openURL(mailto:…)` and any other API that hands a string to another
  app. They are user-visible but live outside the JSX that i18n reviews scan.
- **Prevent:** *a string is user-visible if any app renders it, not just yours.*
  Share titles, mail subjects, chooser headings, notification action buttons and
  channel names all leave the app and come back on screen.

## 169. No iPhone could buy anything, because every sandbox purchase was refused

- **Symptom:** on iOS, a purchase completes and the store charges the (sandbox)
  account — and the server records nothing. The entitlement appears for a moment
  and then vanishes on the next `reconcileWithServer`. Credit packs are worse:
  the balance never moves and the transaction is dropped from the retry queue
  permanently, so it cannot heal after a fix ships.
- **Cause:** three independent paths refused `environment: SANDBOX` — the
  RevenueCat webhook (`subscriptionGate.applyEvent` → `reason:"sandbox"`),
  `POST /api/me/credits/topup` (`402 sandbox_purchase`, **`retryable:false`**),
  and the subscriber→tier mapper used by `/api/me/subscription/sync`. The escape
  hatch `RC_ALLOW_SANDBOX=1` was referenced only in those branches and their
  tests; it was set in no config file, `.env.example` or `railway.json`.
- **Why iOS only, structurally:** **there is no non-sandbox purchase on iOS
  before the app is live.** TestFlight is sandbox; App Review is sandbox. Android
  has a real production purchase path beside its license testers, which is the
  case the refusal was written to defend against — a correct answer to a question
  nobody had asked yet.
- **The compounding defect:** `retryable:false` is a *terminal* refusal, and
  `confirmPackPurchaseDurably` dequeues terminal failures. A **paid** transaction
  was therefore deleted from the durable confirm queue.
- **Fix:** grant and **tag**. Migration `0003` adds
  `users.subscription_is_sandbox`, `credit_ledger.is_sandbox`,
  `subscription_events.is_sandbox` (default `false`, so existing rows read as
  genuine). `RC_ALLOW_SANDBOX` deleted — it existed only to un-block.
- **The guard that makes acceptance safe:** a sandbox purchase must **never
  settle a referral**. That is the only path where a $0 transaction mints real
  spendable credits *for a third party*; without the guard, "accept sandbox"
  becomes buy-in-sandbox → pay-a-referrer → repeat. Test it **behaviourally**
  against the referrer's balance, and include a **production control** — a guard
  that passes because referrals are broken entirely is not a guard.
- **Detect next time:** for any policy branch keyed on an environment or test
  flag, ask "**can the reviewer's flow reach the allowed branch at all?**" If the
  only way to test a platform is the mode you refuse, you have shipped an
  unreviewable app.
- **Prevent:** *never refuse test-environment traffic outright; accept it and
  label it.* A tag keeps the money separable, which was the real requirement —
  refusal was an over-broad implementation of "don't count test revenue".

## 170. Android and iOS mint different Google ID tokens, and only Android's was accepted

- **Symptom (latent):** a Google-signed-in iPhone gets 401 on every
  `/api/me/*` call. Android is perfectly healthy.
- **Cause:** `GOOGLE_AUDIENCES = [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID_ANDROID]` —
  the iOS client ID was never listed, though the app ships one and passes it to
  the native SDK.
- **The divergence is in the SDKs, not our code**, which is why reading our code
  never showed it. Android (`Utils.java:66`) calls
  `requestIdToken(webClientId)` — a token explicitly addressed to the **web**
  client. iOS (`RNGoogleSignin.mm:100`) builds
  `GIDConfiguration initWithClientID:iosClientId serverClientID:webClientId` and
  returns `GIDGoogleUser.idToken`, issued for the **clientID**. `serverClientID`
  feeds `serverAuthCode`, which is non-null only with `offlineAccess:true` — and
  we deliberately do not request offline access.
- **Fix:** add `GOOGLE_CLIENT_ID_IOS` to the audience list. Correct whichever
  token iOS actually mints, and safe because the added client is ours, in our own
  GCP project.
- **Why the fix would have sat dormant, and the two things that fixed that:**
  `backend/.env.example` never documented the sign-in client IDs at all, so the
  var would never have been set on Railway; and `/health` reported a bare
  audience **count**, which reads `"configured"` from the web+android pair while
  every iPhone 401s. It now names which of web/android/ios are present.
- **Prevent:** *a cross-platform auth SDK can hand you tokens with different
  audiences per platform.* "Is the token valid?" is the question everyone asks;
  "**who is it addressed to?**" is the one that decides whether a platform can
  authenticate at all. And **a config fix nobody can tell is unapplied is not a
  fix** — ship it with a health signal.

## 171. Deleting an account left it listed in the user's Apple ID settings

- **Symptom:** a user deletes their PriceBack account, and PriceBack is still
  listed under **Settings → Apple ID → Sign in with Apple**. App Review checks
  this; Guideline 5.1.1(v) requires the app to call Apple's revocation endpoint
  on deletion. iOS-only — Google has no equivalent, which is why the
  Android-shaped deletion flow never surfaced it.
- **Fix:** the client obtains a **fresh** authorization code at deletion time
  (one Face ID confirmation), the server exchanges it and revokes, and nothing is
  persisted.
- **The design choice worth keeping:** the obvious implementation captures
  `authorizationCode` at sign-in and keeps the resulting Apple **refresh token**
  for the life of the account. That is a long-lived third-party credential held
  for every user to serve one call that may never come. Obtaining it on demand
  removes the liability entirely, and a biometric check on an irreversible action
  is behaviour you would design anyway.
- **Deletion must never be blocked by it.** Missing key material, a stale
  single-use code, a slow Apple, a malformed PEM — every path resolves rather
  than throws and the account is erased regardless. Report the outcome
  (`appleRevoked` / `appleRevokeReason`) so an unconfigured deployment is a
  *visible* compliance gap, not a silent one.
- **Two traps, both pinned by tests:** Apple's client secret must be ES256 with a
  **raw `r||s`** signature — Node emits DER by default and Apple rejects it as
  malformed without saying why (`dsaEncoding: "ieee-p1363"`). And a PEM from an
  env var almost always carries literal `\n` rather than newlines, failing deep
  inside `crypto` with an unhelpful error.
- **Found while here:** the users row is only **soft**-deleted on this path, so
  the `ON DELETE cascade` that removes first-party sessions never fires. Revoke
  sessions explicitly whenever the "delete" is a soft delete.

## 172. Rotating refresh tokens plus concurrency signs busy users out

- **Symptom (caught before shipping):** an app that wakes several queues at once
  fires five parallel authenticated requests. All five find the access token
  expired, all five present the same refresh token, and the backend's reuse
  detection — correctly — reads four of them as a replayed stolen token and
  revokes the whole family. **Being busy logs the user out.**
- **Cause:** refresh-token rotation and request concurrency are individually
  correct and jointly hostile. Rotation means a token is good exactly once;
  concurrency means it gets presented N times.
- **Fix:** one in-flight refresh shared by every caller, on **both** sides — the
  client coalesces onto a single promise, and the repo takes a per-token advisory
  lock so two requests that do arrive together serialize instead of racing.
- **Detect next time:** any credential that is *consumed* by use needs a
  single-flight guard the moment more than one caller can hold it. Look for the
  same shape in nonces, one-time codes and idempotency keys.
- **Prevent:** *reuse detection cannot tell a thief from a busy client* — so the
  client must never look like a thief. Design the single-flight guard at the same
  time as the rotation, not after.

## 173. The client's notification strings were localized; the server's were not

- **Symptom:** a French-Canadian user sets the app to French, sees French
  in-app notifications, and keeps receiving **English** pushes — including price
  drops, the app's single most important notification. Both platforms.
- **Cause:** Bugs #166 moved twelve hardcoded strings into the mobile i18n bundle
  and shipped `notificationI18n.test.js` to keep them there. **That test reads
  `src/services/notificationService.js`.** Nine more notifications are composed
  and sent by the *backend*, where every title and body was still an English
  template literal — and money was formatted with a hardcoded `$` and
  `toFixed(2)`, baking the English currency shape in (Canadian French writes
  `12,34 $`).
- **Fix:** `backend/lib/pushI18n.js` keyed on `user_preferences.language`;
  `sendUserPush` gains `build(lang)` so copy is composed once the recipient's
  language is known.
- **The two that needed a different mechanism:** the price-drop and flyer sweeps
  compose notifications **keyed by push token** and never resolve a `sub`, so the
  per-user lookup does not apply. They use `usersRepo.languageByToken()` — one
  query up front. Stopping at the seven easy ones would have left the app's
  primary notification English.
- **A smaller bug found by writing the test:** `Number(null)` is `0`, so a
  missing amount rendered as `$0.00` — a notification promising a zero saving.
  Absent must mean absent.
- **Detect next time:** when a rule is enforced by a test, **ask what the test
  can see.** A source-sweep guard is scoped to the files it reads, and the same
  defect on the other side of a network boundary is invisible to it.
- **Prevent:** *user-visible text is wherever it is composed, not wherever the UI
  lives.* Any process that can address a user needs the same i18n rule and its
  own guard.

## 174. "Unique per run" test ids that were neither unique nor random

- **Symptom:** a DB-backed backend suite failed with a `price_points` row whose
  source was `price_tag_scan` where the test asserted `receipt_ocr`. It passed on
  a rerun and passed on `main` at the same commit, so it read as a flake caused by
  two overlapping CI runs sharing the pooler.
- **That diagnosis was wrong.** Overlapping runs were a coincidence. The suites
  built "unique" ids as `String(Date.now()).slice(-6)` / `.slice(-7)`, with a
  comment asserting a prior run's row could not be picked up. Three separate
  defects sat in that one expression:
  1. **It recurs on a schedule.** The low 6 digits of the epoch clock repeat every
     10^6 ms (16.7 min), the low 7 every 10^7 ms (2.8 h). Two runs separated by a
     multiple of that produce byte-identical ids. Not bad luck — a cycle.
  2. **The derived SKU ranges contained other suites' hardcoded SKUs.** Tests
     computed `String(5000000 + base)`, `String(7000000 + base)` and friends.
     `crowdsourceDb.test.js` writes `price_tag_scan` points on the literals
     `5551234`, `5559876`, `5550011`, `5552468`, `5559001`, `5557777`, `7654321`;
     `barcodeLink.test.js` uses `9876543`. Every one of those falls inside a
     computed range, so **no concurrency was required** — one run could collide
     with itself. Band prefixes (`3000000`, `4000000`, `6100000`–`6600000`) were
     also reused across two or three suites each.
  3. **Warehouse codes were far worse than the SKUs.** `` `80${last 2 digits}` ``
     is 100 possible codes and `` `54${last 1 digit}` `` is 10, against a global
     `warehouses` table — a 1-in-100 and 1-in-10 collision that nobody had hit yet.
- **Why the collision was deterministic, not 50/50.** `pricesRepo.latestForSku`
  resolves the product **globally** by `(sku, storeCode)` and returns
  `ORDER BY observed_at DESC LIMIT 1` — it is not scoped to the test user or run.
  Receipt price points are stamped `observedAt = purchaseDate`
  (`receiptsRepo.js`, a fixed **past** date in these fixtures); tag and
  crowdsource points are stamped ~now. So once the SKUs matched, the tag row
  **always** won the ordering. The assertion never had a chance.
- **Fix:** `backend/tests/helpers/uniq.js` — `runId()`, `testSku()`,
  `testWarehouseCode()`, all drawn from `node:crypto`, never from the clock. The
  load-bearing part is not the entropy but a **namespace invariant**: generated
  SKUs are **8 digits starting with `5`**; the `` `N${RUN}` `` fixture SKUs occupy
  8 digits starting with 6/7/8/9; every other hardcoded fixture SKU is at most 7
  digits; generated warehouse codes are **5 digits starting with `9`** while every
  real Costco code is 2–4 digits (`51`…`8099`, plus one `00000`). Lengths that
  differ cannot be equal, and inside the 8-digit space the leading digit separates
  the three populations — so collisions are impossible by construction rather than
  merely improbable. `node --test` runs each file in its own process, so the draw
  is per-file, which also closes the cross-suite band reuse.
- **The first fix attempt failed 12 tests, and the reason is the more useful
  lesson.** It used a hex `runId()` and 9-digit ids, treating both as opaque. Both
  shapes were **contracts**:
  - `String(Date.now()).slice(-7)` is *seven numeric digits*, and call sites
    concatenate onto it. `` `7${RUN}` `` / `` `9${RUN}` `` build 8-digit numeric
    Costco SKUs, and `` `1137482950${RUN}` `` builds a Google-shaped sub that
    `accountIdentity.providerOfSub` matches with `/^\d+$/`. Hex turned those into
    400s and an `existingProvider: "unknown"`.
  - 9 digits overran two separate ceilings: `POST /api/observations/tag` enforces
    `/^\d{3,8}$/` on the sku (`server.js`), and the receipt header-OCR footer is
    parsed as `/\bWHSE\s*[:#]?\s*\d{2,5}\b/i` (`shared/ocrCleanup.js`) — so a
    9-digit warehouse code was **stored yet echoed back null**, surfacing as
    `0 !== 825306100`, which looks nothing like a length problem.
  A grep of `shared/` and `middleware/` missed all of it because the validation
  lives in `server.js` and the shape dependencies live in the *tests*.
- **Detect next time:** when a test invents an id, ask *what else can write that
  same id* — including hardcoded fixtures in sibling suites, not just other runs.
  And when a lookup ignores the test's own scope (no user, no run filter), a
  colliding row is not a tie the test might win; it is a loss with a tie-break
  that decides it. `git log -S` on the id expression is faster than re-running.
- **Prevent:** a comment claiming an invariant ("unique per run") is a claim to
  **verify, not to trust** — this one was false in three ways and had been read
  past for months. Prefer invariants a reader can check by looking (a reserved
  length/prefix) over ones that need arithmetic about clock periods.
- **Prevent, second rule, learned the hard way:** when you replace a generated
  value, **keep its shape and change only its source.** A value's format is an
  undocumented API the moment anything concatenates onto it, pattern-matches it,
  or casts it. `runId()` is a random 7-digit numeric string *specifically* so it is
  shape-identical to what it replaced — every call site is then satisfied by
  construction instead of by audit. Widening a format is a separate change from
  fixing its entropy, and it needs its own check against the real validators
  (`grep` for the route regex, don't reason from the column type — `sku` and
  `warehouses.code` are both plain `text`, and neither column is where the limits
  actually live).
- **Still open, deliberately:** this does **not** make concurrent backend runs
  safe. The suites share hardcoded user subs (`SUB = "test-pricepoints-user"`) and
  call `deleteAccount(SUB)` between tests, so two runs still delete each other's
  user mid-flight. Running two backend suites at once remains unsupported.

## 175. The first receipt from a new warehouse came back with no warehouse

- **Symptom:** `POST /api/receipts` returns 200 and stores everything correctly,
  but the response's `receipt.warehouseId` is `null` — for exactly the **first**
  receipt anyone ever files from a given warehouse. Every later receipt from that
  same warehouse echoes the code fine. A client that renders the warehouse label
  from the create response shows nothing until it refetches.
- **Cause:** `receiptsRepo.create()` upserts the warehouse **inside its own
  transaction** (deliberately — the FK has to be set before the receipt row is
  inserted, and a failure must roll the whole receipt back). It then shaped the
  response through `decorateReceiptRow` → `warehouseCodeById`, which resolved the
  `warehouses.id` pk back to the store-issued code with a read on **`getDb()` — a
  separate connection**. The warehouse row is still uncommitted at that moment, so
  the other connection cannot see it, the lookup returned no rows, and the helper
  answered `null`. Nothing errored; a value simply went missing.
- **Fix:** thread the transaction through — `decorateReceiptRow(row, tx)` →
  `warehouseCodeById(id, tx)`, falling back to `getDb()` when called outside a
  transaction. The function's other lookups read seeded tables committed long ago
  and were left alone.
- **A trap adding that second parameter:** one call site was
  `rows.map(decorateReceiptRow)`. `Array#map` passes `(item, index, array)`, so
  the index would have arrived as `tx`. It happens to be harmless here (`0` is
  falsy, so it degrades to `getDb()`), but only by luck. Changed to
  `rows.map((r) => decorateReceiptRow(r))`, with a note on the function saying
  why. **Adding a parameter to a function used point-free in `map` is a silent
  change to every such call site.**
- **Why no test caught it — the useful part.** `receiptWarehouseLink.test.js`
  built its warehouse code as `` `54${one digit}` `` → 540…549. All ten are **real
  seeded Costco warehouses** ("Kanata", "Nepean", …). The row therefore always
  pre-existed, the cross-connection read always succeeded, and the first-sighting
  path — the only broken one — was never executed. The test asserted the right
  thing and still could not fail. It only surfaced when the code was randomised
  into a reserved unused band (Bugs #174).
- **Detect next time:** when a helper reads a row that the current transaction
  just wrote, check **which connection it reads on**. Inside a transaction,
  `getDb()` is a different session and sees a pre-transaction snapshot; the bug
  presents as a silent `null`, never as an error. Grep for repo helpers that take
  no `tx` parameter and are called from inside one.
- **Prevent:** *a fixture that happens to match seeded data tests the wrong
  branch.* If a test's meaning depends on a row being new, it must **assert the row
  is new** — `receiptWarehouseLink` now draws until it finds an unused code and
  fails loudly if the reserved band is exhausted, rather than quietly sliding back
  onto the easy path.

## 176. Flaky: "at least one of BUYER's drops was pushed" (priceDropWindowSourceDb)

**Not fixed — recorded so the next person does not repeat the diagnosis.**

- **Symptom:** `priceDropWindowSourceDb.test.js:331` fails with
  `at least one of BUYER's drops was pushed` (`actual: false`). Notably the line
  *above* it passes — `res.candidates >= 1` — so the sweep did find candidates; no
  push simply reached `BUYER_TOKEN`. Seen once on `main` at `c16b663`
  (2026-08-10 23:48); an immediate re-run of the same commit passed.
- **What it is NOT**, all checked:
  - **Not the concurrent-run/pooler problem.** The PR run on the identical tree
    finished 23:47:37 and main's started 23:48:28 — no overlap.
  - **Not the change that was merged alongside it.** The only edit to that file was
    swapping `String(Date.now()).slice(-7)` for `runId()`, which returns the *same
    shape* (7 numeric digits).
  - **Not a monotonicity dependency.** The one plausible mechanism for that swap
    mattering — the clock value always increasing while `runId()` is random — does
    not apply: nothing orders or ranges on a run-scoped id, and every id in the
    file is a run-scoped string that is equally fresh either way.
  - **Not the dedupe ledger going stale across runs.** `notifyLedger.json` lives in
    `DATA_DIR`, which is a fresh container directory per CI job.
- **Most likely cause:** accumulated state in the shared dev database. `candidates`
  passing while `sent` carries nothing for this run's tokens fits a sweep whose
  candidate set includes leftover users from earlier runs (the dev DB holds
  hundreds of abandoned test accounts with in-window ON drops), with this run's own
  buyer either suppressed or not the one pushed.
- **If it recurs, start here** rather than at the top: does
  `runVerifiedDropSweep({ userSub })` scope its **push** as tightly as it scopes its
  **candidate count**? A count that is region-wide while the push is user-scoped
  would explain the exact asymmetry between lines 329 and 331 — and would be a real
  bug, not a flake.
- **Prevent:** the test asserts on `sent` filtered to this run's tokens, which is
  right; the weakness is `res.candidates`, which is a *global* number being used as
  a precondition for a *user-scoped* expectation. Asserting a user-scoped candidate
  count would turn this from a flake into a clear pass/fail.

## 177. A revocation that authenticates with the credential being revoked

- **Symptom:** a user turns off **Settings → Apple ID → Sign in with Apple →
  PriceBack**. Their handset signs out and looks correct. Every OTHER device they
  are signed in on keeps working for up to 60 days.
- **Cause:** `authService.js` deleted the stored provider token and then called
  `revokeFirstPartySession({ all: true })`. That call builds its `Authorization`
  header from `getValidIdToken()`, whose first statement is
  `if (!idToken) return null` — so the request went out with **no bearer**, the
  route took its `all:true` branch, `optionalAuthUser` found nothing, and the
  server answered 401 having revoked nothing. A `.catch(() => {})` swallowed it,
  and the local keychain wipe made the visible outcome look right.
- **The obvious fix hangs the app.** Swapping the two lines makes
  `getValidIdToken()` run for real: it finds the token stale, calls
  `refreshSessionToken()` → `refreshAppleIdTokenInteractive()`, which returns
  `_appleReauthInFlight` — the promise **currently executing this very block**.
  Awaiting it from inside itself never settles, and every request queued behind
  it hangs.
- **Fix:** revoke first, delete second, and read the token with a plain
  `secureGet` instead of the refresh path. Plus a second, independent proof: the
  refresh token now rides along, and the server's `all` branch accepts it via
  `sessionsRepo.userSubForToken`.
- **Why accepting a refresh token there is safe:** holding one can only ever
  **remove** access. It is deliberately matched without filtering `revoked_at` or
  `expires_at` — a dead token still identifies its owner, and the alternative is
  a user who cannot sign themselves out.
- **Prevent:** *when you write a revocation path, ask what credential it
  authenticates with — and whether that credential still exists at the moment it
  runs.* Consent withdrawal, account deletion and token expiry are exactly the
  situations where the usual credential is gone. And a `.catch(() => {})` around
  a security operation hides the only signal that it failed.

## 178. Account deletion undone by a subscription renewal

- **Symptom:** a user deletes their account. Thirty days pass. The row is still
  there, marked active, and the monthly purge job has never touched it. Nothing
  errored; every individual step succeeded.
- **Cause:** `usersRepo.upsertFromOAuth` reactivated a soft-deleted row
  unconditionally (`status: true, deletionRequestedAt: null`), and it is called
  from **eleven** places — only one of which is a person signing back in.
  Deleting a PriceBack account does not cancel the store subscription, so the
  next RevenueCat `RENEWAL` webhook upserted the tombstone back to life and
  cleared the very stamp `purgeExpiredDeletions` selects on. A price-tag scan
  from a stale device did the same via `resolveScanOwner`.
- **Second path:** any surviving credential. On **Android** it is unbounded —
  `signInSilently` re-mints Google id tokens with no server involvement, so a
  second signed-in handset resurrects the account on its next foreground hydrate
  forever. (iOS degrades more safely here: an Apple token dies in ten minutes.)
- **Fix:** `upsertFromOAuth(user, { reactivate })`, defaulting to **false**.
  Passed `true` only from the two genuine sign-in entry points (`POST
  /api/auth/session` and `GET /api/me`) and from `GET /api/me/bootstrap?reason=signin`,
  which the client stamps only on the hydrate that follows a real sign-in.
  Bootstrap additionally refuses a tombstone with `403 account_deleted`, and the
  client signs itself out on that code.
- **Prevent:** *reactivating an account is an act, not a side effect.* Any
  function called from a dozen routes should do the minimum they all need; the
  privileged extra belongs behind an explicit flag. When a retention job selects
  on a column, grep every writer of that column — the bug is never in the job.

## 179. Sign-out was not an account boundary

- **Symptom:** user B signs in on a handset user A used, and is notified about a
  receipt they never scanned. Reviewing and saving it files A's items, totals and
  warehouse under B's account, and spends B's credits doing it.
- **Cause:** `signOut()` cleared six keychain items and touched no AsyncStorage
  and no files. The offline scan queues (`pending_tag_scans_v1`,
  `pending_receipt_scans_v1`) and their photos in `documentDirectory` survived,
  and their workers drain on boot, on foreground, on a 60 s poll and on
  background fetch **without checking who is signed in**. `clearAllData()` missed
  them too — it does no filesystem work at all.
- **Fix:** `clearAllTagScans` / `clearAllReceiptScans` on each queue (empty the
  list, delete the images, never throw), called from a new
  `clearAccountScopedLocalState()` in `signOut` and from `clearAllData`. Each
  queue is isolated so one failing import cannot skip the other.
- **Related, same shape, still open (money batch):**
  `last_known_credit_balance_v1`, `offline_scan_log_v1`, `account_is_admin_v1`
  and the auto-reload opt-in leak across the same boundary.
- **Prevent:** *"what does sign-out delete?" is a list, and the list is every
  place account data is written — not every place it is written **encrypted**.*
  A useful check: for each background worker, ask what happens if it fires one
  second after a different user signs in.

## 180. The iOS document scanner filled Documents/ forever

- **Symptom:** iPhone storage grows with every scan and never shrinks. Deleting a
  receipt does not reclaim it; deleting the account does not either. The photos
  ride into iCloud backups.
- **Cause:** `react-native-document-scanner-plugin` writes captures to
  `FileManager.default.urls(for: .documentDirectory)` as
  `DOCUMENT_SCAN_<page>_<timestamp>.jpg` — permanent storage, backed up by
  default. `autoCrop.materializeCapturedImage` copies the file into the cache and
  walks away; `storageService.deletePersistedImage` refuses any URI outside
  `documentDirectory/receipts/`, so nothing in the app could delete it.
- **Android does not have this** — ML Kit writes into the Play-services cache,
  which the OS reclaims. That asymmetry is exactly why `materializeCapturedImage`
  exists in the first place.
- **It has to be a sweep, not a delete of the returned URI.** VisionKit accepts
  unlimited pages, so our `maxNumDocuments` patch truncates the result array
  **after** every page is already on disk. Pages 2..N never reach JS, so nothing
  keyed on the returned path could ever reach them.
- **Fix:** `sweepScannerCaptures(keepUri)` — read `documentDirectory`, delete
  every `DOCUMENT_SCAN_*` entry, skip the one still in use (materialize falls
  back to the source when its copy fails), never recurse, never throw.
- **Prevent:** *when a native module hands you a file path, find out which
  directory it is in and who is responsible for deleting it.* "Documents" on iOS
  means permanent and backed-up, not scratch.

## 181. A readiness check that read the environment variable, not the feature

- **Symptom:** none yet — this is the one that was caught before it bit, and the
  circumstances that would have made it bite were already scheduled.
- **Setup:** first-party sessions ship gated entirely on `SESSION_TOKEN_SECRET`.
  Audit #4 / A7 filed the real defect: the feature had **no health signal at
  all**, so the only way to learn whether a deployment could issue sessions was
  to try to mint one and read the 503. The first fix reported
  `sessionTokens.isConfigured()` — is the variable set.
- **Why that is still the wrong answer:** `sessionsUnavailable()` refuses on
  **three** conditions — no secret, `USE_DB` off, no sessions repo — and the
  repo's table arrives only with migration `0004_first_party_sessions`. On
  2026-08-11 that migration had never run on production, and setting the secret
  there is item one of the iOS release checklist. Do the two in that order and
  `/health` reports `configured` while every iPhone sign-in that tries to mint a
  session 500s on a missing relation.
- **This is a repeat shape.** Audit #3 fixed the same class one field up on the
  same endpoint: `checks.auth` reported `configured` off a bare audience
  **count**, from the web + Android client IDs, while every Google-signed-in
  iPhone got a 401 because `GOOGLE_CLIENT_ID_IOS` was unset. A check that reads
  one input of a multi-input gate is a green light in front of a broken path.
- **Fix:** the verdict is the conjunction. `sessionHealth()` combines the secret,
  its length class, and a live `to_regclass` probe of
  `priceback.user_sessions` into `configured` / `degraded` / `unconfigured`, and
  `blockers` names the fix (down to the migration filename).
- **Two rules the fix had to obey, both learned here:**
  - *Only a definite blocker degrades.* `dbRelationHealth` reports `unknown`
    when the probe could not run, and unknown is treated as **no verdict** — an
    amber light raised by a flaky probe gets ignored, and then so does a real
    one. Same principle as binding the session-identity check to a *definite*
    mismatch rather than to an absent value.
  - *Report, do not enforce.* `sessionTokens.secret()` accepts any non-empty
    string, so `SESSION_TOKEN_SECRET=x` turns the feature on with a
    one-character HMAC key. The check flags it; the minter still accepts it.
    Refusing a short secret at mint time would take a running deployment offline
    to fix a warning.
- **Exposure:** the anonymous payload gets the verdict only, with `degraded`
  collapsed into `unconfigured` — the reasons name a weak signing key and an
  un-migrated database. The verdict itself is public on purpose, so the
  pre-release check is one curl rather than a hunt for the admin token.
- **Prevent:** *a health check must answer "will this work?", never "is this
  variable set?".* When a feature is gated on N conditions, the check reports
  the conjunction of all N — and if one of them is a schema object, probe the
  schema. Config presence is the input that is easiest to read and the one
  least likely to be what is actually missing.

## 182. An iOS build failure with no compile error in it — the Swift compiler crashed

- **Symptom:** `eas build -p ios` fails at `RUN_FASTLANE` with
  `EAS_BUILD_UNKNOWN_FASTLANE_ERROR`, "(2 failures)", `Exit status: 65`. Reads
  exactly like a broken build, and costs a build credit each time.
- **What it actually is:** the Swift compiler **segfaulted**. The Xcode log
  contains **zero `error:` lines** — nothing failed to compile:
  ```
  Apple Swift version 6.2.3 (swiftlang-6.2.3.3.21)
  While running pass #53831 SILFunctionTransform "SendNonSendable"
    on SILFunction SharedObject.emit(event:arguments:)
    at node_modules/expo-modules-core/ios/Core/SharedObjects/SharedObject.swift:73
  Stack dump: ... swift::ActorIsolation::printForDiagnostics ...
  ```
  `swift-frontend` crashed **while formatting a Sendable diagnostic** in
  `expo-modules-core` — library code, in a pod we do not own.
- **The tell that it is not yours:** "0 errors" plus a `Stack dump:` plus
  `Please submit a bug report`. A real build break names a file *of yours* and a
  reason. The reported failing targets (`ExpoModulesCore`, and a knock-on
  `Script 'Copy generated compatibility header' failed └─Pods/RevenueCat`) are
  both collateral — the second only fails because the first never produced its
  module.
- **Fix: retry the same commit.** It is non-deterministic (whole-module
  optimization, shared runner). 2026-08-11: the `device` profile at `v2.8.6`
  crashed, and the *identical* tag rebuilt clean seven minutes later.
- **Before spending the retry, rule out the real causes** — this took four
  checks and all four are cheap:
  1. `git diff <lastGoodTag>..<tag> -- package-lock.json` — if it is empty, no
     dependency moved.
  2. Compare the SDK line (`iPhoneOS26.2.sdk`) against the last **successful**
     build's Xcode log. Same SDK ⇒ the builder image did not roll forward.
     (Note: `Apple Swift version` is only printed *on a crash*, so its absence
     from a good log is expected and proves nothing.)
  3. If a `patches/` file changed, check whether it touches `podspec`,
     `Podfile`, `SWIFT_VERSION` or `STRICT_CONCURRENCY` — if not, it cannot
     affect how a *different* pod compiles.
  4. Check whether the same profile succeeded recently.
- **Reading the logs at all takes an API call.** `eas build:view` does not print
  them. Query `builds.byId(buildId).logFiles` on `https://api.expo.dev/graphql`
  with `Authorization: Bearer $EXPO_TOKEN`; it returns two signed URLs (the
  worker log and the much larger Xcode log). In a sandboxed shell `curl` may
  fail on missing CA certs while node's `fetch` works — use node.
- **Prevent:** *an iOS build failure is not a code failure until you have found
  a file of yours in the log.* Grep for `error:` first; if the count is zero,
  look for `Stack dump:` before changing anything. Retry once (the standing
  limit is two) rather than pre-emptively pinning a builder image — a pin is a
  code change, so it invalidates the tag the release already points at.

## 183. A webhook the route rejected as malformed before the handler could see it

**Class: the guard that runs before the special case.** RevenueCat's `TRANSFER`
event is the one shape that carries **no `app_user_id`** — it sends
`transferred_from` / `transferred_to` instead. The webhook route opened with
`if (!event?.app_user_id) return 200 "no_app_user_id"`, so every transfer was
logged as a malformed payload and discarded. An audit had located the bug one
layer deeper, in the gate's `switch`, which the event never reached.

The consequence was money: a Restore Purchases under an Apple ID that already
owned a subscription re-homed the entitlement onto account B while **A's row
kept `tier=unlimited`** until its stale expiry lapsed. One payment, two
credit-exempt accounts, for up to a full billing period.

- **Symptom:** a webhook type that "does nothing", with a log line blaming the
  payload rather than the handler.
- **Fix:** handle the special-shaped event **before** the generic validity
  guard, and pin the ordering with a test that asserts what the guard returns
  for that event — so a later "simplification" that moves the handler back
  below it fails loudly.
- **Prevent:** when a provider documents an event as carrying different fields,
  check the route's own preconditions before assuming the handler is at fault.
  Grep the guard, not just the branch.

**A second, opposite trap in the same fix.** `SUBSCRIBER_ALIAS` sat in the same
`case` group and looks like the same thing. It is not: aliasing means two ids
for the **same person**, so applying the transfer downgrade to it would strip a
paying customer. Grouping two event types in one `case` is a claim that they
mean the same thing — verify it before writing the shared handler.

## 184. A ledger note that interpolated another user's account id

**Class: server "notes" fields are display copy the moment a client renders
them.** The referral settlement wrote the referrer's credit-ledger row as
`` `referral bonus (referrer) — ${refereeSub} made first purchase` ``. The
client's `ledgerNote` maps known notes to translated labels and **falls back to
printing an unrecognised note verbatim** — a deliberate choice (English beats a
blank row). Because the note was dynamic it never matched, so the referrer's
Credit History screen rendered a *different user's* stable Google/Apple `sub`.

Three rules broken by one line: a raw identifier rendered as display text,
another user's identifier disclosed, and untranslated English in a French UI.

- **Symptom:** none. It reads as a normal ledger row unless you know what the
  digits are.
- **Fix:** make the note **static** so it can be mapped and translated, and keep
  the identifier in the relational column that already stores it
  (`user_referrals.referee_sub`) — the audit trail loses nothing.
- **Also fix the client**, and this is the part that is easy to skip: rows
  written before the server fix **already exist in production** and would keep
  leaking. Match the legacy prefix and translate it too.
- **Prevent:** a "notes"/"description"/"reason" string that reaches a UI is
  user-facing copy. Never interpolate an id into one. When a renderer has a
  raw-text fallback, treat that fallback as a rendering surface — anything the
  server can put in the field, a user can read.

## 185. Moving a charge before the thing it pays for

**Class: reordering for atomicity strands the compensating case.** To let
`POST /api/receipts` refuse a scan the user cannot pay for, the credit consume
had to move **before** `receiptsRepo.create()` — checking the balance separately
and then creating would reintroduce the read-then-write race that the guarded
`UPDATE … WHERE scan_credits >= n` exists to prevent. Correct, and it also meant
a `create()` that FAILS leaves the charge behind.

**The rule that resolves it — classify create failures by whether the client
retries:**

- **Transient** (DB blip → 503/500): the client retries the same id, the
  idempotent consume answers `alreadyConsumed`, and the user is charged exactly
  once for a receipt they do get. **No compensation needed.**
- **Terminal** (the id already belongs to another account → 409): the client
  never retries. The credit is gone, for a row that never existed.

There is exactly one terminal case, so **pre-check it** rather than compensating
after the fact.

- **A compensating refund is worse.** Reversing the charge leaves the consume's
  ledger row in place, so the retry sees `alreadyConsumed` and creates the row
  without charging — trading a stranded charge for a free unit of work.
- **Prevent:** before moving a charge earlier in a handler, enumerate every way
  the paid-for operation can fail and ask *does the client retry this one?* Only
  the no-retry failures need a guard.

**How it was caught, and the trap next to it.** An existing test named the
invariant outright — *"POST /api/receipts maps a cross-account id collision to
409 and charges nothing"* — over the comment *"charge follows create"*. In the
same CI run ~36 OTHER tests failed, all genuine fixture drift: their mocked
`verifyAuth` returned an email but no `emailVerified`, so `upsertFromOAuth`
granted 0 trial credits and every receipt POST 402'd. It would have been easy to
sweep all 37 into that bucket and "fix the fixtures". **A test name that states
an ordering invariant is load-bearing — read it before assuming drift.**

Two smaller notes from the same run:

- **`npm test` is `jest --ci --coverage`.** A bare `npx jest` passes while CI
  fails, because the gate is the per-file coverage ratchet, not the assertions.
  Run the script, not the runner.
- **Sweep for affected fixtures on the ROUTE STRING, not the call shape.**
  Several suites reach `/api/receipts` through a local `post()` helper, so a
  grep for `request(app).post("/api/receipts")` misses them.

---

## 186. A guard test that swept a narrower surface than it claimed

**Class: the regression test passed because it was looking somewhere else.**
`pushI18n.test.js` carried a source sweep asserting *"no bare literal survives in
a user-facing push the server sends"*. It read `backend/server.js` — and only
that file. `backend/priceDropNotifier.js`, a separate module carrying the two
most important pushes the product sends (the verified price drop and the notice
that credits were spent to unlock it), was never in the sweep. It shipped English
template literals and hardcoded `$` money for months, under a green test whose
name promised otherwise.

This is the second time the same lesson has been paid for: iOS audit #5's N1
found a "verified clean" claim about permission handling that was true only of
the screens that pass happened to read. **A guard is only as wide as the surface
it reads, and its NAME is not evidence of its scope.**

- **Prevent:** when a guard sweeps source, DERIVE its file list from a property
  of the code rather than naming files. Here: every backend file that calls
  `sendPushNotificationsAsync`. Then add a meta-assertion that the derived list
  still contains what you expect, so a future refactor that empties it fails
  loudly instead of passing vacuously.
- A sweep that finds nothing and a sweep that looks nowhere are indistinguishable
  from the test output. Only the meta-assertion separates them.

**The second trap, inside the first.** Widening the file list alone would still
have missed the defect. The sweep's heuristic looks for two adjacent plain words
to distinguish prose from codes — and a body built as
"Now {interpolation} (save {interpolation}). {interpolation}." has none: every
whitespace boundary has an interpolation on one side. What actually catches it is
a second, different check — **a push-sending file that defines its own money
formatter and never calls the shared localized one**. When a heuristic filters by
shape, assume the defect can be shaped around it, and add an orthogonal check.

---

## 187. A health check whose status was a string literal

**Class: a check that cannot fail (third occurrence).** The Apple-auth block of
`/health` set `status` to the constant string `"configured"`, and its only other
field came from an env var with a hardcoded default. There is no deployment, no
environment and no input under which it reports anything but green.

Meanwhile `appleRevoke.isConfigured()` — the real capability check, for the
`APPLE_SIGNIN_KEY_ID` / `APPLE_TEAM_ID` / `APPLE_SIGNIN_PRIVATE_KEY` trio —
existed for two audits with **no caller anywhere**. Without it, account deletion
cannot revoke the Apple credential (App Store Guideline 5.1.1(v)), and the `.p8`
downloads exactly once, so the gap surfaces at submission rather than at deploy.

Previous occurrences: the Google iOS client ID (a bare audience *count* reported
"configured" while every iPhone got a 401) and the session secret (a config-only
flag would have said "configured" against an un-migrated table). Same shape three
times.

- **Prevent, mechanically:** grep every health check for a status that is a
  literal or a single `!!process.env.X`. If the value cannot vary with anything
  the feature depends on, it is decoration.
- **Prevent, by design:** write the check as the CONJUNCTION of everything the
  feature needs, then ask "what is the most likely thing to be missing, and would
  this check see it?" If a capability function already exists, it has a caller
  or it is a lie.
- **Report, never enforce.** Degrade the check's own verdict; never move the
  top-level `healthy` flag on a platform-specific readiness gap, or the deploy
  gate starts flapping and people learn to ignore it. Keep the *named blocker*
  behind the admin token and publish the verdict, so a pre-release check is one
  anonymous `curl` while the reasons (which secret is absent) stay private.

---

## 188. The only record of an external object's key was cascade-deleted

**Class: an FK made the cleanup path unreachable.** Receipt photos live in object
storage; the only record of their keys was `receipts.image_object_key`. The
monthly account purge hard-deletes the user row and cascades the receipts away —
so after the purge, the objects still existed and **nothing left in the system
knew their keys.** Unreachable, undeletable, billed for, forever.

It had not bitten yet, and the reason is the interesting part: it worked only
because `RETENTION_DELETED_RECEIPT_IMAGES_DAYS` (7) was smaller than
`DELETION_GRACE_DAYS` (30), so the sweep always ran before the cascade. Both are
independently tunable `app_config` values. Nothing enforced the inequality,
nothing warned when it broke, and the job's own docstring asked a future
maintainer to *"keep the window well under DELETION_GRACE_DAYS"*.

**A code comment doing a constraint's job is a defect with a delay on it.**

- **Prevent:** any record of a resource that lives OUTSIDE the database — an
  object key, an external job id, a third-party subscription id — needs a home
  whose lifetime is at least as long as the resource's. If deleting a user can
  cascade it away, the cleanup path is only as reliable as whoever remembers the
  ordering.
- **The fix shape:** a dedicated ledger table with **no FK to `users`**, written
  at the moment the key is MINTED (before the object can exist), and swept by the
  object's own age. A row is kept after deletion, flagged, as the erasure audit
  trail — what we held, and when it stopped existing.
- **Ordering inside the sweep:** delete the object, then the pointer that could
  presign a URL for it, then mark the ledger. A crash mid-way leaves a 404 until
  the next run; the reverse order leaves a ledger claiming an erasure that never
  happened.
- **Never mark a failed delete as done.** The retry is cheap; a false erasure
  record is not.
- **Watch the UI consequence of switching to age-based retention:** something
  still alive can now outlive its attachment. Clear the pointer that would
  presign a URL for the purged object, or the screen renders a broken image
  instead of no image.

---

## 189. Hardening applied to one of two twin routes

**Class: the same code in two places, fixed in one.** The price-tag image presign
was capped and account-gated (iOS audit #4, S4). The receipt image presign — the
same four lines, on the far busier route — kept minting unbounded upload URLs, so
any signed-in account could PUT an object of arbitrary size into the production
bucket. The audit that fixed one twin never looked at the other.

- **Prevent:** when fixing a defect, grep for the CALL you are hardening
  (`getPresignedPutUrl`), not the route you are in. Every call site is a
  candidate.
- **Then remove the duplication rather than adding a second copy of the check.**
  Two copies that agree today are two copies that can drift tomorrow. One shared
  decision function, plus a test asserting that *both* call sites go through it
  and that no route computes the rule inline. A test that exercises only the
  route you noticed will pass again on the next divergence.

**A related pair, same commit, both from "the caller didn't send it" being read as
"the caller wants it cleared":** an upsert preserved `email` on absence but
coalesced `name` and `picture` to NULL, one and two lines below it. Two of that
function's eleven call sites can never supply identity — a webhook that carries
none, and a first-party session token that asserts identity rather than profile —
so a paying user's name was erased on every renewal. **When one field in a
`.set()` is deliberately preserved and its neighbours are not, that is a bug until
proven otherwise.**

- **Also check `Number()` before treating a value as absent.** `Number(null)` and
  `Number("")` are both `0`, which is finite — so "the client declared nothing"
  silently becomes "the client declared zero". Check for absence *before*
  coercion. This exact trap appeared twice in one audit: once in a money
  formatter (already documented) and once in an upload-size cap, where it
  refused a legitimate upload on the first test run.

---

## 190. A realistic-looking secret in a test fixture

**Class: making the scanner cry wolf, then muting it.** A `/health` test needed
the Apple signing-key env var set. The fixture used a real PEM envelope, on the
reasoning that a realistic value keeps the test honest. CI's gitleaks step failed
the build in nine seconds.

The tempting fix — a path exclusion for `backend/tests/` — is the wrong one, and
the standing rule already forbids it: **allowlist by value shape, never by path.**
A scanner taught to ignore key-shaped strings in test files is a scanner that
cannot catch a genuinely leaked key checked in beside them.

- **Prevent:** ask what the code under test actually reads. Here,
  `isConfigured()` checks the *presence* of three variables and never parses the
  key — so the fixture never needed to look like one. A plain
  `"test-...-not-a-real-pem"` string tests exactly the same behaviour and trips
  nothing.
- If a test genuinely needs a parseable key, generate it at runtime rather than
  committing one.

---

## 191. A new lookup table broke every DB test at once

**Class: the seeder is a hard dependency of every repo call.** A migration added
`object_retention_types` and `db/seed.js` gained an upsert for it. CI went red
with dozens of unrelated suites failing together — barcode resolution, catalog
reads, credit reconciliation, claim IDOR guards, account-deletion revival.

One cause. `seedLookups` upserts into the new table; `ensureSeeded()` runs on
nearly every repo call through `lookupId`; the table did not exist on the shared
dev database yet. So `ensureSeeded` threw and took everything DB-touching with
it.

**CI points at the shared Supabase dev project and never runs migrations.** That
is a deliberate property (the suites gate on `DATABASE_URL`), but it means a new
migration is an out-of-band step — and *adding a row to the seeder* is precisely
what converts "the new tests fail" into "every test fails".

- **The failure spread is the diagnostic.** Thirty unrelated suites failing
  together is one cause, never thirty. Grep the log for the FIRST distinct error
  string before reading any individual assertion; here it was one line,
  `relation "priceback.object_retention_types" does not exist`, repeated.
- **Prevent:** when a migration adds a lookup table, apply it to the dev database
  in the same working session as the code, before pushing. Apply additively
  (`CREATE TABLE IF NOT EXISTS`, guarded FK, `ON CONFLICT DO NOTHING` backfill)
  and insert the drizzle bookkeeping row keyed on the migration file's real
  SHA-256 — the ledgers on both dev and prod are hand-maintained, because their
  rows predate the `0000_initial` squash, so `db:migrate` would try to re-run the
  whole schema.
- **Do not make the seeder tolerant of a missing table.** That would hide genuine
  migration drift, which is worse than a loud failure.

**The second lesson is about working while CI is red.** A separate defect in the
same push was found by re-reading the diff, not by CI, which could not have
distinguished it: a new route suite sent no `Authorization` header, and
`requireAuth` matches that header **before** it calls `verifyAuth` — so injecting
`app.locals.verifyAuth` is not sufficient on its own, and the request
short-circuits to 401 without ever reaching the injected verifier. Every sibling
suite sends a throwaway `Bearer x` for exactly this reason.

**A red run hides the next bug.** When CI fails for a known reason, re-read the
diff rather than waiting for the rerun to tell you what else is wrong.

---

## 192. A comment cited as evidence that a fix had shipped

**Class: documentation used as a test.** Audit #4 capped the price-tag image
presign server-side. No client ever sent the `imageBytes` field it reads, so the
cap took its "caller declined to declare" branch every time and was never once
enforced. Two audits later, the receipt twin was fixed — and its new comment said
*"the price-tag path has done this since audit #4's S4"*, on the strength of the
server-side constant existing. Nobody opened the tag client. The claim was false
when written and stayed false for two more passes.

This happened **inside** the fix for #189, whose own lesson is "hardening applied
to one of two twin routes". The shared `imagePresignDecision` was introduced
exactly so the twins could not drift — and they drifted anyway, on the *client*
side, where the shared function could not reach.

- **Prevent:** a claim that another call site already does X is a claim you can
  check in one grep. Do the grep before writing the sentence.
- **Extracting a shared helper only de-duplicates the half you extracted.** Ask
  what the *other* end of the wire has to send for the helper to do anything, and
  assert that too. A server-side cap that no client can trigger is dead code that
  reads as protection.
- **Corollary for audits:** when a pass cites a previous pass as having covered
  something, that citation is a lead, not a result.

---

## 193. An empty value where a missing one was expected

**Class: a degraded dependency producing "" instead of failing.** New code hashed
a random nonce via `expo-crypto` and passed the digest to Sign in with Apple.
Under the test environment's native mocks `digestStringAsync` resolves to an empty
string, so the call went out as `nonce: ""`.

An empty nonce is **strictly worse than no nonce**. The verifier's rollout policy
is "no `nonce` claim → legacy, allow; claim present → must match". `""` is not
null, so a token carrying it takes the *enforced* branch and is compared against
`sha256(raw)` — a guaranteed mismatch. Every Apple sign-in would have 401'd, on
the one auth path that has no fallback.

The pre-existing suites caught it, which is the point worth keeping: they failed
on an unexpected argument shape, not on the bug itself, and the temptation was to
update the assertion and move on.

- **Prevent:** validate the *shape* of anything a native/async dependency returns
  before acting on it, not just its truthiness. `/^[0-9a-f]{64}$/` on a SHA-256 hex
  digest costs nothing and turns a silent lockout into a clean degrade.
- **When an old test fails because of a new argument, ask what the new argument's
  value is** before rewriting the expectation. The assertion was right to fail.
- **Related to #189's `Number()` note:** absence and emptiness are different
  states, and a policy branch that keys on one must be explicit about the other.

---

## 194. AppState "active" is not a foregrounding on iOS

**Class: a platform divergence with no `Platform.OS` to grep for.** A sweep wired
to `AppState` `state === "active"` ran on every genuine return to the app on
Android — which only moves active ↔ background — and on iOS *also* ran for every
Control Centre pull, notification-shade drag, app-switcher half-swipe and **every
system permission dialog**, because each enters `inactive` and then returns to
`active`. On a scanning app that is twice per scan.

The work behind it was not free: offline queue drains, parked purchase-confirm
flushes, and a RevenueCat sync that posts to an endpoint rate-limited to 10/min
per account — so a paying user could 429 their own subscription reconciliation
just by using the app normally.

- **The obvious fix is wrong.** Comparing against the *previous* state cannot
  work: iOS reports `background → inactive → active` on a real return, so the
  state immediately before `active` is `inactive` in both cases. Latch whether
  `background` was ever reached instead — the gate needs memory, not a comparison.
- **Prevent:** treat `AppState` as platform-divergent by default. Anything
  expensive behind `"active"` needs to say whether it means "the app is on screen"
  or "the app came back".
- **Put the rule in a module, not inline.** A test that re-implements the gate
  keeps passing after the caller drifts — the same trap as #192, one layer down.

## 195. A dedupe that collapsed requests carrying different intent

**Class: a cache key that omits a load-bearing parameter.** `hydrateFromBackend`
guarded against concurrent bootstraps with a single `_inFlight` promise and
returned it to every caller. But its `reason` is not a label — `?reason=signin`
is the ONLY thing that tells the backend the call follows a real sign-in, and
therefore the only thing permitted to revive an account inside its deletion
grace window. The dedupe ignored it, so callers with *different intent* were
handed each other's answers.

The trigger was structural, not rare. Signing in backgrounds the app (the OAuth
sheet), so returning to the foreground fires a `reason:"foreground"` hydrate at
exactly the moment sign-in fires its own. The sign-in call joined it, the server
never saw `reason=signin`, answered **403 `account_deleted`**, and the 403
handler **signed the user out — mid-signup**. Every retry from that state failed
the same way until the foreground hydrate's five-minute throttle lapsed, which
is why it was reported as "I couldn't re-create my account for a few minutes".

- **Diagnostic tell:** a bug whose duration matches a throttle interval is a
  race with that throttle, not a slow server. "A few minutes" was the 5-minute
  `lastHydrate` gate in `App.js`, and it named the cause before any log did.
- **Fix in two places, because either alone leaves a hole.** Make the dedupe
  reason-aware (a signin hydrate queues behind a non-signin one rather than
  joining it), AND suppress the destructive side effect while a sign-in is
  pending. Deduping correctly still leaves a losing 403 free to sign the user
  out first.
- **Prevent:** if a parameter changes what the server *does*, it belongs in the
  dedupe key. Ask of every shared in-flight promise: "would I be happy handing
  this to a caller who passed different arguments?"
- **A late subscriber must still be notified.** Adding an `onAccountKnown`
  callback to a deduped function is a trap: the second caller — the one holding
  the callback — joins after the moment has passed. Remember the answer and fire
  immediately for late joiners, or the UI waits forever on a signal that already
  happened.

## 196. A spinner drawn in its own button's background colour

**Class: two constants that must differ, with nothing saying so.** The onboarding
CTA rendered `<ActivityIndicator color="#fff" />` inside a style whose
`backgroundColor` is `#fff`, and rendered *only* the indicator while in flight.
White on white: the button became a blank, dimmed box. Reported as "the text
disappeared and the button looked disabled" — which is exactly what it looked
like.

It surfaced on the referral-code path because entering a code adds a redemption
round-trip (and an alert) ahead of the profile sync, stretching a sub-second
flicker into seconds. The defect was always there; the referral code only made
it last long enough to notice.

- **Fix the invariant, not the literal.** The indicator now reads its colour
  from the button's own label style, so the two cannot drift apart again, and the
  label stays rendered beside the spinner — a working button should never be
  mute, for sighted users or for screen readers.
- **Test the relationship, not the value.** Assert `spinner.color !==
  button.backgroundColor`. A test pinned to `"#0d3d28"` passes forever after a
  palette change that reintroduces the bug.
- **Prevent:** grep for `ActivityIndicator color=` whenever a button's fill
  changes. Only one of this repo's nine call sites sat on a light button, and
  that is precisely the one that was wrong.

## 197. A mirrored directory with no parity check

**Class: a sync mechanism narrower than the thing it syncs.** The backend
deploys with `backend/` as its root, so its runtime `require("../shared/...")`
resolves to `backend/shared/`, a copy of the repo-root `shared/`.
`backend/scripts/sync-shared.js` does maintain it — on `prestart`/`pretest` — but
two holes make that weaker than it looks: it copies a **hardcoded list**, so a new
shared module the backend requires is never synced at all; and its own docstring
notes that on Railway there is no root `shared/` to copy from, so **the committed
copy is what production runs**. A file edited at the root and committed without a
local install/test run ships stale. `shared/ocrCleanup.js` had been
refactored (a duplicated predicate extracted into `isWarehouseInfoLine`) and the
backend copy never got it; the drift was found only when a parity test was added
for an unrelated reason and went red on its first run.

That instance was benign — behaviour was identical and nothing on the backend
called the new export. The neighbour is not: `shared/pricing.config.js` calls
itself "SINGLE SOURCE OF TRUTH for paywall content" and is one of the copies. A
price fixed in one and not the other has the app and the server quoting different
numbers, with the server's copy — the one that charges money — being the easier
of the two to forget.

- **Prevent:** `__tests__/sharedMirrorParity.test.js` asserts every file present
  in both directories is byte-identical AND that `sync-shared.js`'s `FILES` list
  covers all of them, with the list DERIVED from the intersection plus a
  meta-assertion, so it cannot silently narrow to zero.
- **General form:** any file that exists twice needs either a build step that
  generates one from the other, or a test that fails when they differ. "We'll
  remember to update both" is not a mechanism.

## 198. A deadline and the job that enforces it, running on different clocks

**Class: an interval nobody owns.** A credit-restore window of 2 hours was
enforced by a purge job running hourly, so between the window lapsing and the
next sweep a tombstone was *past its deadline and still holding the data*.
Nothing was wrong with either number — the bug lived in the gap between them.

Reviving an account in that stretch flipped `status` back to true, and the purge
only targets tombstones, so the retained rows would have survived **forever**
against a deliberately zeroed balance. Permanent drift, which the reconciliation
sweep would then have opened a case for and offered to "fix" by handing back
exactly the credits the lapsed window said were forfeit.

- **Prevent:** whenever a deadline is enforced by a scheduled job, the code that
  *reads* the deadline must also handle the interval before the job catches up.
  Do not assume the sweeper got there first.
- **Watch for state transitions that remove a row from the sweeper's scope.**
  Here, reactivation made the row permanently invisible to the only thing that
  would have cleaned it. Ask of any status flip: "does this take the row out of
  a queue that still owes work on it?"
- Found by re-reading the diff while CI was still running, not by a red run —
  the same lesson as #191.

## 199. `await` on a shared promise frees the slot for one turn

**Class: a re-check that was written as an assumption.** Guarding "this caller
must not join the in-flight request" with

    if (inFlight && mustNotJoin) await inFlight;
    if (inFlight) return inFlight;   // ← inFlight may be a NEW one by now

is subtly wrong: between the `await` resolving and the next line, the slot is
empty for one microtask turn, and anything that starts a new request in that turn
recaptures the caller you were protecting. Use `while`, not `if` — re-check the
condition after waiting instead of assuming it still holds.

- **It cannot spin** as long as each iteration awaits a promise that must settle,
  and the producers are throttled. A `while` here is not a busy-loop.
- **General form:** any "wait for X, then act on X" across an `await` boundary
  needs the condition re-read, not remembered. This is the async equivalent of a
  TOCTOU check.

## 200. `Number()` on a money route accepts "1e3"

**Class: coercion that looks harmless until you price it.** An admin credit
endpoint read its amount as `Number(req.body.amount)` and validated with
`Number.isInteger(amount) && amount > 0 && amount <= MAX`. That validation is
correct — and useless, because the coercion happens first:

    Number("1e3")  → 1000   ✅ isInteger
    Number(" 10 ") →   10   ✅ isInteger
    Number(true)   →    1   ✅ isInteger
    Number([5])    →    5   ✅ isInteger

A client sending the three-character string `"1e3"` is granted a thousand
credits. Every guard downstream passes, because by the time they run the value
really is a positive whole number.

- **Fix:** require the real type — `typeof body.amount === "number"` — and let
  everything else be the 400 it is. A client sending a string is a client bug
  worth surfacing, not one worth silently accommodating.
- **Caught by a test that was stricter than the code**, listing `"10"` among the
  values that must be refused. The route accepted it, and following that up is
  what surfaced `"1e3"`. Write the refusal list from the *type* you intend, not
  from the values you happened to think of.
- **Prevent:** on any endpoint that moves money or credits, treat `Number(x)`,
  `parseInt(x)` and `+x` on request input as a smell. Validate the type first,
  then the value.

## 201. On iOS, `inactive` means *visible*, not gone

**Class: one platform's extra state answering a question it was never asked.**
Android's `AppState` only ever moves `active ↔ background`. iOS adds `inactive`,
and enters it for a Control Centre pull, a notification-shade drag, an
app-switcher half-swipe **and every system permission dialog** — while the app is
still fully rendered on screen behind them.

So `AppState.currentState === "active"` does not mean "the app is on screen". It
means "the app is on screen *and* nothing is overlaying it", which is almost
never the question being asked. Two different questions get confused with it:

| Question | Right answer |
|---|---|
| "Did the app LEAVE and come back?" | latch on `background`, fire once on the next `active` |
| "Can the user SEE the app right now?" | `state !== "background"` |

Getting the second one wrong is the expensive direction, because the failure is
invisible in review and iPhone-only:

- a notification suppressed "while the app is open" fires **over the open app**,
  and the likeliest moment is during a permission dialog — which is part of the
  very flow whose completion triggers the notification;
- a poller torn down on "the app left" restarts on the way back and re-runs its
  immediate first tick, once per interruption.

- **They are not interchangeable.** A gate is deliberately `false` during an
  interruption — which is exactly when the app IS on screen. Reusing the gate for
  the second question re-introduces the bug pointing the other way.
- **Prevent:** name both predicates, put them in one module, and assert that the
  call sites import them rather than comparing to a literal. This bug was found
  twice: a correct fix shipped to one of three call sites and nothing pointed at
  the other two, so they carried it for a whole audit cycle.
- **Assert positively** ("this file routes through the predicate"), not with a
  blanket "no file may compare to `active`" — some comparisons are legitimately
  strict, and a guard that fires on correct code gets deleted.

## 202. A shared in-flight promise turns one missing timeout into a total stall

**Class: a correct de-duplication amplifying an unrelated omission.** Coalescing
concurrent callers onto one request is the right pattern when the underlying
operation must not be repeated — a rotating single-use refresh token is the
canonical case, since spending it N times reads as token theft and gets the whole
session family revoked.

The catch: that shared promise is now on the critical path of everything that
awaits it. If the request behind it has no timeout, one wedged connection does
not stall one caller — it stalls *every* caller, indefinitely.

And a caller's own `AbortController` does not help. It covers the caller's own
request, never the token acquisition that runs *ahead* of it:

    authedFetch → getAccessToken → refreshShared → fetch   ← the un-timed one

- **Audit the whole path, not the leaf.** "Every network call has a timeout" was
  true of every call the callers made and false of the three that gated them.
- **The token/auth path deserves the timeout most,** not least — it is the one
  every other request queues behind.
- **Make the timeout degrade into an EXISTING branch.** Here it returns the same
  `null` that "no session" already returned, so the fallback is a path that has
  always been exercised rather than a new one written for the failure case.
- **A timeout is not proof the credential died.** Keep the refresh token and
  retry; only an explicit 401 should clear it. Clearing on a network blip signs
  the user out of a perfectly good session.
- **Related:** file uploads are the usual second offender, because
  `uploadAsync`-style helpers take no signal. Use the cancellable task form
  (`createUploadTask` + `cancelAsync`) and race it. On iOS an upload in flight
  when the app backgrounds is **suspended, not failed** — so the stall lasts as
  long as the user is away, and the JS timer that would have caught it is
  suspended too.

## 203. Erasing the history without erasing the balance it backed

**Class: a cleanup written against an invariant that another path can break.**
When a balance column is derived from an append-only ledger, "erase this
account's credits" is two writes: delete the rows, and zero the column. Code that
does only the delete is relying on the column already being 0 — which is true at
the moment the deletion runs, and not true later.

The thing that breaks it is any path that credits an account *without checking
whether it is still alive*. There are usually several, and they are all
reasonable in isolation:

- a **deferred** reward that settles days later, keyed on a device or a
  contribution rather than on a live session;
- a **webhook** whose delivery is retried long after the user is gone;
- an **admin tool** that deliberately lists deactivated accounts.

- **Symmetry test:** for any pair (derived value, source of truth), ask what
  happens if the source is deleted while the derived value is non-zero — and then
  ask the same question with the two swapped. Both directions are drift; only one
  is usually noticed.
- **Drift on a deactivated row is the dangerous kind**, because reconciliation
  sweeps normally *skip* deactivated rows. Nothing reports it until the account
  comes back, at which point it is indistinguishable from a legitimate balance.
- **Count what you corrected and log it.** A cleanup that had to fix something is
  evidence a path credited a dead account; a silent `UPDATE` throws that away.
  Add `WHERE value <> 0` so the counter stays at zero for the ordinary case and
  the log line means something when it fires.

## 204. R8 full mode strips a class named only in a manifest string — background fetch died silently in production

**Symptom.** Nothing. That is the whole problem. The build is green, CI is green, Play
Console is green, and the app launches and works. Only `adb logcat` on a real device shows
it, on **every** host pause and resume:

```
E Expo    : Cannot initialize app loader.
java.lang.ClassNotFoundException: expo.modules.adapters.react.apploader.RNHeadlessAppLoader
    at java.lang.Class.forName(Class.java:496)
    at oa.a.a(SourceFile:42)                      <- obfuscated AppLoaderProvider
    at expo.modules.adapters.react.NativeModulesProxy.getConstants
I BackgroundFetchTaskConsumer: Stopping an alarm for task 'PRICEWATCHER_BG_PRICE_CHECK'
```

The exception is **caught** by Expo and printed to `System.err`. It never reaches Sentry,
never shows a UI error, and never crashes anything. Background price checks simply never
run.

**Cause.** Expo names that class in exactly one place — a *string* in `expo-modules-core`'s
own `AndroidManifest.xml`:

```xml
<meta-data android:value="expo.modules.adapters.react.apploader.RNHeadlessAppLoader" />
```

R8 cannot see a manifest string. Nothing references the class statically, so full mode
(`android.enableR8.fullMode=true`) removes it as unreachable. The class is real and present
in expo-modules-core 55 — it is the loader that starts a **headless JS context**, which is
what `expo-task-manager` and `expo-background-fetch` need in order to run at all.

Shipped broken in **2.8.5** (the first release carrying R8) and undetected until the
hardware pass on 2026-08-15.

**Fix.**

```proguard
-keep class * implements expo.modules.apploader.HeadlessAppLoader { *; }
```

`-keep`, not `-dontwarn` — the class exists and must survive. (Contrast #130, where the
class genuinely did not exist and `-dontwarn` was correct.) Scoped to implementors of the
interface rather than a package wildcard, so a future Expo loader is covered without
widening the rule.

**How to find the whole family, not just the one that bit you.** Two sweeps, both cheap:

```bash
# 1. classes named only as a manifest string — R8 is blind to these
grep -rhoE 'android:value="[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}"' \
  node_modules/*/android/src/main/AndroidManifest.xml \
  node_modules/@*/*/android/src/main/AndroidManifest.xml | sort -u

# 2. reflective lookups by string literal
grep -rhoE 'Class\.forName\("[a-zA-Z0-9_.$]+"' node_modules/*/android/src | sort -u
```

Then confirm empirically against a device log rather than pre-emptively keeping everything:

```bash
grep -oE "ClassNotFoundException: [a-zA-Z0-9_.$]+" logcat.txt | sort -u
grep -oE "(NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|UnsatisfiedLinkError)" logcat.txt | sort -u
```

In this occurrence sweep 1 returned exactly one class (this one) and sweep 2 returned ten
candidates of which all but this one resolved fine at runtime — `ExpoModulesPackageList`,
`SplashScreenManager`, ML Kit `BarcodeScanning`, gesture-handler included. Keeping all ten
would have been cargo-culting.

**Rules.**
- **A caught reflective failure is invisible to every gate you have.** Build, CI, crash
  reporting and store review all pass. Only a device log finds it. This is the reason the
  R8 hardware checklist exists.
- **`-keep` vs `-dontwarn` is decided by whether the class exists**, not by which error you
  saw. Missing at build time → `-dontwarn`. Present but resolved by name at runtime →
  `-keep`.
- Manifest `<meta-data android:value="...">` and `Class.forName("literal")` are the two
  shapes R8 structurally cannot follow. Sweep both after enabling or upgrading R8.
- Guard every keep rule with a test asserting the rule is present. Losing one reintroduces
  a silent, release-only failure. See `__tests__/withAndroidR8FullMode.test.js`.

**Occurrence.** 2026-08-15, Pixel 10 / Android 17, preview APK 2.8.8 (build `20bb08e7`).

**Where the fix actually landed.** PR #266 was **closed**, not merged — its branch was
1777 deletions behind and would have reverted #267–#272. The keep rule reached `main` via
**PR #267** (`7b22948`), so it is in `v2.8.9` and later. Check with
`git log -S HeadlessAppLoader -- app.json`.

**Re-confirmed 2026-08-18 on the Play production artifact** (2.8.8 / vc28, installed from
`com.android.vending`), not just on the preview APK: `ClassNotFoundException:
…RNHeadlessAppLoader` fires on every host pause and resume. So the defect is what shipped
to real users, and it is still unverified-as-fixed on hardware — no 2.8.9+ build has been
installed on a device yet.

## 205. A health check that ORs three variables cannot report the absence of one

**Class: the disjunction/conjunction confusion, fourth occurrence.** A dependency
whose readiness needs *several* things reports readiness from *any* of them, so
the check is structurally incapable of going red for the failure it exists to
catch. Previously: the Google iOS audience, the session secret, the Apple `.p8`.
This one cost a four-day production outage.

**Symptom.** Google sign-in succeeds — the account chip reads "Signed in as
…@gmail.com" — and then the app shows a blocking dialog: *"We're sorry — sign-in
can't be completed right now / Our service is temporarily unavailable."* Every
platform, every app version, RETRY never helps. Meanwhile `GET /health` returns
`200 {"healthy":true, checks:{ db:{status:"ok"}, auth:{status:"configured"} }}`,
every cron in `job_runs` is green, and the database is untouched and healthy.

**Mechanism.** `/health` computed the verdict as

```js
const authStatus = GOOGLE_AUDIENCES.length ? "configured" : "missing";
```

`GOOGLE_AUDIENCES` is `[web, android, ios].filter(Boolean)`. Lose exactly one of
the three and the array is still non-empty, so the check still says
`"configured"` — while `verifyIdToken({ audience: GOOGLE_AUDIENCES })` throws for
every token addressed to the missing client, `requireAuth` returns **401 "Token
verification failed"**, and every authenticated route is dead for everyone on
that platform.

The cross-wiring is what makes it hard to eyeball. The two native SDKs mint
tokens for **different** audiences:

| platform | call site | `aud` | needs |
|---|---|---|---|
| Android | `Utils.java` `requestIdToken(webClientId)` | the **web** client | `GOOGLE_CLIENT_ID` |
| iOS | `RNGoogleSignin.mm` `GIDConfiguration initWithClientID:` | the **iOS** client | `GOOGLE_CLIENT_ID_IOS` |

So the variable Android depends on is the *web* one. A reviewer skimming
`clients: { web, android, ios }` pattern-matches android→android and concludes
the check is fine. `GOOGLE_CLIENT_ID_ANDROID` is accepted defensively but no
shipped client addresses a token to it — its absence breaks nothing.

**Why nothing caught it.** Every monitor that existed was true and useless:
`healthy` tracks the DB alone (correctly); crons never call `requireAuth`, so
they stayed green through a 100% auth outage; `api_audit_log` — the table the
previous version of this same bug was diagnosed with — no longer exists after the
schema v2 redesign; and `recordAuthFailure`'s counters are in-memory and
admin-gated, so they vanish on restart and nobody sees them without a token.

**Diagnosis without logs.** The decisive query is "has *anything* authenticated
succeeded lately" — `upsertFromOAuth` stamps `users.updated_at` on every
bootstrap:

```sql
select max(updated_at) from priceback.users;   -- frozen 4 days = total outage
```

Cross-check `devices.last_seen` and `consent_events.occurred_at`. All three
freezing at the same minute means auth, not a per-account state. Then bracket the
deploy by probing routes added in known PRs — `401` means the route exists,
`404` means the deploy is stale.

**Rules.**
- **A readiness check must state whether the feature WORKS, not whether a
  variable is set.** If readiness needs N things, the verdict is a conjunction
  over N — and when the N map to different user populations, report it *per
  population* (`signIn: { android, ios }`), because an aggregate cannot say who
  is locked out.
- **Publish the breakdown.** Booleans about which of your own OAuth clients are
  accepted are not secrets, and putting them behind the admin token means the one
  fact that names the outage is unreachable during the outage.
- **One source for one dependency.** This status had three separate expressions
  (public payload, admin `checks`, legacy top-level field) and two of them
  disagreed. A test now asserts all three agree.
- **Report, never enforce.** `healthy` must not move on it, or an auth-config gap
  starts flapping Railway's deploy gate.
- Extract the verdict as a pure function when the inputs are read from
  `process.env` at module load — otherwise it cannot be unit-tested without a
  fresh process, which is why the old check had no test at all.

**Occurrence.** Production auth dead from 2026-08-12 12:16 UTC; reported
2026-08-16 against 2.8.8 from Play, and seen earlier on 2.8.5. Health fix +
`lib/googleAuthHealth.js` + `healthAuthAudiences.test.js`.

**Addendum (same day) — the two follow-ups, and what the first one disproved.**

`/health` was shipped first precisely because it is server-side: it needed no app
release, and the moment it deployed one anonymous curl answered the question.
What it answered was **not** the leading hypothesis:

```json
"auth": { "status": "degraded", "audiences": 2,
          "clients": { "web": true, "android": true, "ios": false },
          "signIn":  { "android": true, "ios": false } }
```

`GOOGLE_CLIENT_ID_IOS` is unset on the production service — **every
Google-signed-in iPhone 401s**, a real defect and a one-variable fix. But
`signIn.android: true`, so the Android report it was chasing has a *different*
cause. Ruling out the rest took a schema diff of dev vs prod
(`information_schema.columns`, identical but for `object_retention`), the EAS
production environment (defines no `GOOGLE_CLIENT_ID*` at all, so builds fall
through to `common.js` — no drift), and an OAuth-client existence probe against a
bogus-client control (all three clients exist).

**A correction worth keeping.** "Zero authenticated writes for four days" was
read as four days of *failure*. With six test users and the developer heads-down
on audit PRs, it equally supports four days of *no usage*. Frozen timestamps
prove the absence of success, never the presence of failure — the honest claim
was always the narrower one: *this* attempt, today, fails.

**What made the next one answerable** (`auth_outcomes`, migration 0006): the
durable record is kept SEPARATE from the in-memory 401 counter, because the two
need opposite membership. The counter drives an alert email, so it must stay
restricted to rejected tokens — folding in "no Authorization header at all" would
let ordinary internet scanning cross the threshold and page on bots. The table
wants exactly those rows, because *"the client sent no token"* and *"the client
sent a bad token"* are different bugs that reach the user as one sentence.
`auth_required` had been recorded nowhere at all.

Verified on production immediately after deploy — two provoked refusals, two
rows, correctly told apart:

| reason | status | detail |
|---|---|---|
| `auth_required` | 401 | *(null)* |
| `verify_threw` | 401 | `Wrong number of segments in token: …` |

`detail` is scrubbed of JWTs and `Bearer` prefixes and truncated: it is an error
message from code we do not control, and one echoing the Authorization header
would persist a live credential.

**Resolution of the iOS half (PR #270) — and the rule that generalises.**

The fix was not "set the missing variable". It was to notice that the variable
should never have been load-bearing.

The three Google client IDs were declared **twice**, in two systems nothing kept
in sync: the app choosing which client to mint a token FOR
(`config/profiles/common.js`), and the API choosing which audiences to ACCEPT
(`GOOGLE_CLIENT_ID*` on Railway). A token is valid only when both agree, and when
they diverged nothing failed — not CI, not the deploy, not `/health`.

`shared/googleOAuthClients.js` is now the single source, mirrored to
`backend/shared/` by the existing sync-shared mechanism. The app builds its Expo
`extra` from it and the backend **defaults** its audiences to it. `APPLE_BUNDLE_ID`
already worked this way, and its comment had already written the rule down: *"it's
public, not a secret, so it has a default and needs no env var to work in a fresh
deployment."*

**The general rule: a value that ships inside the binary is not a secret, and
giving it a committed default is what stops "someone forgot to set it" from being
an outage.** All three of these ids ride in the clear inside every APK and IPA,
and the iOS one is additionally published in `app.json` as the google-signin
plugin's `iosUrlScheme`. Putting them behind environment variables bought exactly
zero confidentiality and cost a platform its sign-in.

Defaulting is safe here for a reason the audience list had already stated —
accepting our own clients widens nothing, because a token from any client outside
our project fails signature and audience checks anyway. That is guarded by a test
asserting every id carries project `695135372222`: *never add a client ID that is
not ours.*

Verified live on both services immediately after deploy:

```json
"auth": { "status": "configured", "audiences": 3,
          "clients": { "web": true, "android": true, "ios": true },
          "signIn":  { "android": true, "ios": true } }
```

The neighbouring one-value-two-places bug is now tested too: `app.json`'s
`iosUrlScheme` must match the iOS client id, or Google's redirect never returns
to the app — same root cause, different symptom.

## 206. A sign-in with no token still counted as a sign-in

**Class: a partial success stored as a complete one.** When an operation produces
two artifacts and only one is required to persist, storing the optional one
unconditionally while the essential one is guarded creates a state the rest of
the system has no name for — and here that state was indistinguishable from
success everywhere except the network layer.

**Symptom.** Google sign-in visibly succeeds — the screen shows
*"Signed in as name@gmail.com"* — and then the app immediately shows
*"We're sorry — sign-in can't be completed right now / Our service is temporarily
unavailable."* RETRY never helps. Both platforms, multiple versions. Every
server-side probe comes back clean, because nothing ever reached the server.

**Mechanism.** All three sign-in paths (`signInWithGoogle`,
`finalizeGoogleSignIn`, `signInWithApple`) did this:

```js
if (idToken) await secureSet(SECURE_KEY_ID_TOKEN, idToken);   // conditional
await secureSet(SECURE_KEY_USER, JSON.stringify(user));       // unconditional
```

and then bound RevenueCat, fired the hydrate and returned success regardless. A
provider result with no token therefore left:

| what the app believed | what was true |
|---|---|
| "Signed in as `<email>`" | no credential at all |
| `isSignedIn() === true` | `getValidIdToken() === null` |
| user is authenticated | `authedFetch` sends **no** Authorization header |

Every authenticated request then 401s, and — the part that makes it permanent —
**retry cannot fix it**, because the UI believes sign-in already happened, so
nothing in the app offers the provider prompt again.

**Why every backend investigation came back clean.** No token ever reached the
server. `/health`, the accepted audiences, the schema diff against dev, the seed
rows, the connection pool and the deployed commit were all genuinely fine. Hours
went into confirming that, which is the real cost of a client failure that
produces a server-shaped symptom.

**Fix.** A sign-in with no token is a FAILED sign-in. Checked before ANY write,
so a failure leaves the device untouched instead of half-signed-in. Google
retries once first (an empty token can be a transient GMS / Credential Manager
result), then throws; Apple throws immediately, because Apple never omits an
identity token on success. New `signin_no_token` error category with copy in
every language — and the copy deliberately does not claim the user is signed in.

**Rules.**
- **If an operation has one indispensable output, guard THAT and let everything
  else follow it.** The inverted shape — optional field guarded, essential field
  written unconditionally — reliably manufactures a half-state.
- **A success that the next call cannot use is not a success.** Return it as an
  error at the boundary that produced it, not three layers downstream where the
  only available message is "something went wrong".
- **A UI that claims a session it cannot prove has no recovery path.** Any state
  reading "signed in" must be reachable only when a usable credential exists,
  or the user is stuck with no button to press.
- **A test can pin a defect as a contract.** This one had a case literally named
  *"a token-less result still persists the user"*. When fixing behaviour, read
  the tests that pass for what they are asserting, not just the ones that fail.
- Watch for fixtures that omit a field the real provider always sends: two Apple
  cases about name mapping used credentials with no `identityToken`, so they
  silently stopped testing what they were named after once the refusal landed.

**Occurrence.** Reported 2026-08-16 against 2.8.8 from Play (and earlier on
2.8.5). Fixed in PR #271. Related: Bugs #205, whose health-check and
`auth_outcomes` work is what narrowed this to the client.

## 207. `eas update` bundles with the LOCAL profile — the first prod OTA would have repointed every user at the dev backend

**Class: a delivery mechanism that re-resolves configuration at publish time,
under different conditions than the build did.** Not yet an incident — found
while evaluating whether an OTA could ship a hotfix, and recorded because the
first production `eas update` is now genuinely deliverable and both landmines
fire silently.

**Setup.** The 2.8.8 Android production build carries `channel=production`,
`runtimeVersion` is `{policy:"appVersion"}` = 2.8.8, the pending fix is JS-only,
and the OTA signing key is available. Every precondition for a hotfix-by-OTA is
met, so the temptation to run `eas update --branch production` is real.

**Landmine 1 — the profile.** `eas update` performs the export **locally**, and
`config/profiles/index.js` picks its profile from `process.env.EAS_BUILD`, which
the update CLI does not set. The export therefore resolves the **local** profile.
Measured, not assumed:

```
[app.config] build profile: local (EAS_BUILD=unset, APP_ENV=unset)
priceApiUrl = https://priceback-development.up.railway.app
```

Publishing that repoints **every production install** at the development
backend — a total data-plane switch, delivered silently, to users who did
nothing.

**Landmine 2 — the secrets.** Forcing `EAS_BUILD=true APP_ENV=production` fixes
the URL and is *not* sufficient:

```
priceApiUrl = https://priceback-production.up.railway.app   ✓
revenueCat  = "YOUR_REVENUECAT_API_KEY"                     ✗
```

The RevenueCat keys live only in the EAS **environment**, which a local export
never sees, so `resolveRevenueCatKeys` falls through to the placeholder. That
bundle ships a paywall where nothing is purchasable — the exact failure the
store-build preflight exists to catch on `eas build`, reintroduced through a path
the preflight does not guard.

**Why neither is visible.** `eas update` reports success either way. The bundle
is valid, signed, and accepted by the app; it is simply configured wrong. There
is no build log to read, no CI step, and no store review between the command and
every installed device.

**Rules.**
- **Any command that re-runs `app.config.js` outside `eas build` resolves a
  different profile.** Treat the resolved `extra` as an output to be inspected,
  not an invariant. Before any `eas update` to a channel a real build listens on:
  ```
  EAS_BUILD=true APP_ENV=production node -e "…print extra…"
  ```
  and verify `priceApiUrl`, `revenueCatApiKey`, `sentryDsn`, and that
  `googleVisionApiKey` is `undefined`.
- A correct publish needs the profile vars **and** `--environment production`, so
  EAS injects the secrets into the local export. That combination has never been
  exercised here.
- **This is why the first update to a channel must be a no-op bundle verified on
  a device.** The rule was written as caution about an untested delivery path; it
  is really about the configuration the path re-derives.
- A preflight that guards one entry point (`eas build`) does not guard the other
  (`eas update`). Enumerate every path that can reach production.

**Occurrence.** Found 2026-08-16, not shipped. Recorded before any production
`eas update` is attempted.

## 208. An expired token with no way to refresh it — the fallback Google never got

**Symptom.** Android showed "We're sorry — sign-in can't be completed right now /
Our service is temporarily unavailable" after a *successful* Google sign-in, for
four days. Every backend probe came back clean. Two successive diagnoses (#205
wrong audience, #206 token-less sign-in) were both wrong.

**What actually happened.** `priceback.auth_outcomes` settled it in one query:

```
reason  verify_threw
detail  "Token used too late, 1786956387.995 > 1786924107"   ← expired ~9 hours
aud     …jgr8klsosbt39o0g9vb7s33md08jql72                    ← web client, CORRECT
```

Audience correct ⇒ not #205. Token present ⇒ not #206. The token was simply
**expired**, and the app sent it anyway.

**Why it could never recover.**

1. `refreshIdTokenSilently()` swallowed both failure paths in bare `catch {}`.
   On `@react-native-google-signin` **v16, Android routes `signInSilently`
   through Credential Manager, where "no authorized credential" is a ROUTINE
   outcome**, not an exceptional one.
2. **Apple got an interactive re-auth path in #253. Google never did.** So a
   failed silent re-issue had no fallback at all: `getValidIdToken()` handed back
   the expired token, the server 401'd, and `authedFetch`'s retry called the same
   failing refresh a second time.

**The lesson that generalises.** *A client-side failure can look exactly like a
server outage.* Four days of backend probing found nothing because **the failure
never left the handset** — nothing was logged, nothing reached Sentry, no
telemetry recorded it. When every server probe is clean and the symptom persists,
suspect the client's own error handling, and check whether the failing path is
`catch {}`.

**Second lesson: asymmetric fixes rot.** Apple and Google are two implementations
of one concept. Apple's got the interactive fallback because Apple's tokens
visibly expire in ten minutes; Google's was left alone because its silent path
"always works" — until an SDK major version changed what silent means. **When you
fix one branch of a two-provider abstraction, write down why the other did not
need it, or it will not be true forever.**

**Fixed in Priceback#274** — failures reported with their Credential-Manager
code; `refreshGoogleIdTokenInteractive()` mirrors Apple's rails (one shared
in-flight attempt, 60 s cooldown, `AppState` foreground gate so no background
task can raise a sheet).

**Two traps worth stealing.**

- **A dismissed sheet must arm the cooldown too.** `signInWithGoogle` returns
  `null` for `SIGN_IN_CANCELLED` rather than throwing, so a catch-only cooldown
  misses it and the next of a hundred queued requests re-raises the picker the
  instant the user closes it.
- **A successful sign-in must arm it as well.** `signInWithGoogle` fires three
  follow-ups *without awaiting them*, and each reaches `getValidIdToken()`.
  `isIdTokenFresh` is false for anything it cannot **parse** as a JWT — not just
  for expired tokens — so a follow-up could open a SECOND account picker over the
  first. Caught by the existing suite, not by review.

## 209. Every sign-in failure reported the same support code, and two of them told the user to "try again" when retrying could never work

- Date: 2026-08-17 · PR: TBD · Area: mobile
- Symptom: Sentry showed four unresolved issues in 7 days (project
  `priceback-canada`, releases 2.8.5→2.8.8). Three were sign-in failures and
  **all three carried `reference: UNKNOWN` and `category: unknown`**, so the
  shopper saw "Something went wrong. Please try again — our team has been
  notified" every time, and a support ticket quoting the code identified nothing.
- Root cause: `classifyError` in `src/services/errorSupport.js` had no branch for
  any provider sign-in error shape. Walking the ladder, each message matched
  nothing and fell through to `"unknown"`:
  - `The authorization attempt failed for an unknown reason` — expo
    `ERR_REQUEST_UNKNOWN` (ASAuthorizationError). Nearly always **no Apple ID
    signed in on the device**. 12 events.
  - `Error Domain=com.google.GIDSignIn Code=-1 "Unable to open Safari."` — the
    browser sheet could not be presented. 11 events, and **every one shared a
    trace ID with the Apple failure ~18 s earlier in the same session**, i.e. the
    previous authorization presentation never tore down.
  - `DEVELOPER_ERROR: …` — the build's signing certificate / OAuth client is not
    registered with Google. Pure configuration.
  Retrying is futile for the first and third; it genuinely works for the second —
  yet all three shipped identical copy.
- Fix: three new categories — `signin_unavailable`,
  `signin_presentation_failed`, `signin_misconfigured` — mapped from both
  `err.code` and the message text (the native layers surface the same failure
  with a code on one platform and a bare message on the other), each with EN+FR
  copy that names the actual recovery. `ERR_REQUEST_CANCELED`/`ERR_CANCELED` are
  now mapped to `cancelled` too, so a cancel can never regress into a scary
  alert from a second caller. The new branches sit **above** the coarse buckets,
  with a test asserting they do not steal traffic from network/server/401 copy.
- Also fixed here: `RemoteServiceException$CrashedByAdbException: shell-induced
  crash` (`adb shell am crash`) arrived as a **FATAL, unhandled** native crash
  with a real user attached, outranking genuine bugs in triage. No JS handler can
  run and it cannot occur on a store build, so `beforeSend` now drops it.
  Deliberately matched on the exception type, **not** on environment — one of the
  four issues in the same batch was a genuine defect found on `preview`, and
  filtering by environment would have hidden it.
- Files: `src/services/errorSupport.js`, `src/services/i18n.js`,
  `src/services/analyticsService.js`; tests `__tests__/errorSupport.test.js`,
  `__tests__/analyticsScrubber.test.js`.
- Detect it next time: the signal is **`reference: UNKNOWN` on a user-visible
  failure** — it means the classifier has no branch for that shape, not that the
  error is genuinely unknowable. Search Sentry for `reference:UNKNOWN`; any
  recurring hit is a missing category. Ask a reporting user for the code first
  (see the memory note `email-sync-error-references`); if they say "UNKNOWN",
  that is itself the bug.

## 210. An admin "Suspend" would have scheduled an irreversible hard delete 30 days later

- Date: 2026-08-17 · PR: TBD · Area: backend
- Symptom: none in production — caught while building the admin account desk,
  before the route shipped. Recorded because the trap is invisible at the call
  site and the next person adding an account-state write will meet it again.
- Root cause: `users.status = false` is overloaded. It means *both* "soft-deleted,
  pending erasure" (written by `requestDeletion`, which also stamps
  `deletion_requested_at`) and, now, "suspended by an admin". The monthly sweep
  `purgeExpiredDeletions` erases on
  `status = false AND deletion_requested_at IS NOT NULL AND … < cutoff`.
  The obvious implementation of Suspend — mirror `requestDeletion` — would have
  set both columns, so an operator suspending an abusive account for a week would
  have silently enrolled it in permanent deletion, with the data gone by the time
  anyone noticed.
- Fix: `usersRepo.setAccountActive` writes **`status` alone** on suspend — the
  `deletionRequestedAt` key is absent from the update object entirely, with a
  comment saying why, so nobody "completes" it later. Restore *does* clear the
  stamp, because rescuing an account inside its grace window is the point of an
  admin restore. The route also refuses self-targeted suspend/flag: both remove
  the only surface that could undo them.
- Files: `backend/repos/usersRepo.js`, `backend/server.js`;
  test `backend/tests/adminAccountsRoutesDb.test.js`.
- Detect it next time: the test does not read the column — it runs the **real
  sweep** with `graceDays: 0` and asserts the suspended account survives. Any
  future write that reintroduces the stamp fails there. Generally: before writing
  `users.status = false` anywhere, ask which of the two meanings you intend, and
  whether the purge predicate would then claim the row.

## 211. The crash-test button that could not crash — a runtime change silently retired a diagnostic

**Class: the diagnostic that reports success while doing nothing.** Sibling of #204
(a caught reflective failure no gate can see) but arrived from the opposite
direction: nothing here is *caught by us*, and no exception is even lost. The
platform simply stopped delivering an exception to the place the tool depended on,
and the tool had no way to notice.

**Symptom.** Profile → Admin → "Sentry diagnostics" → "Crash now". The app does not
crash. The screen goes **blank white**, the process stays alive, and no event ever
reaches Sentry. Reopening the app works normally, so nothing looks broken. The
helper returned `true` for "fired" the whole time.

**Mechanism.** `Sentry.nativeCrash()` bottoms out in

```java
public void crash() { throw new RuntimeException("TEST - Sentry Client Crash (only works in release mode)"); }
```

thrown from a **TurboModule method**. It works by letting that exception reach the
JVM's default uncaught handler, which is where Sentry's
`UncaughtExceptionHandlerIntegration` installs itself. React Native 0.83's
**bridgeless** runtime breaks that assumption: `ReactHostImpl` catches every
exception on the native-module call path, converts it to a
`ReactNoCrashSoftException`, and tears down the React instance. Hence the white
screen — the React instance is gone but the process is not.

```
W BridgelessReact: ReactHost{0}.handleHostException(message = "TEST - Sentry Client Crash …")
E ReactHost: com.facebook.react.bridge.ReactNoCrashSoftException: raiseSoftException(…)
E ReactHost: Caused by: java.lang.RuntimeException: TEST - Sentry Client Crash …
E ReactHost:    at io.sentry.react.RNSentryModuleImpl.crash(SourceFile:5)
```

The method comment — *"only works in release mode"* — is a fossil from the old
bridge, where release builds rethrew. Nobody re-read it after the New Architecture
landed.

**What it cost.** Step 10 of the R8 hardware checklist is the only step that proves
the ProGuard mapping upload works, and it is the reason the diagnostic was added at
all (PR #221). It has therefore **never been executed on any build** — 2.8.5 through
2.8.10 — while the checklist recorded a trigger that existed and a helper that
reported success.

**Fix.** Raise the crash from the Android **main looper**, which is outside
ReactHost's try/catch: the exception escapes `Looper.loop()`, reaches the default
uncaught handler, and the process really dies. That needs native code, and
`android/` is gitignored, so it ships as `plugins/withAndroidCrashDiagnostic.js`
adding one `onNewIntent` override to MainActivity, armed by a private deep link and
gated on `referrer` being this app (MainActivity is exported, so a web page must not
be able to kill it).

**The contract change is the durable half.** A crash that worked **never returns**.
So `triggerNativeCrashForDiagnostics()` no longer returns a boolean — any resolved
value now means the crash did *not* happen and names why (`"unavailable"` /
`"not_fired"`), and the admin row says so. The old signature could not express
failure, which is why three releases of failure looked like success.

**Rules.**
- **A diagnostic needs a way to report its own failure.** If the success path is
  "this function never returns", then returning at all is the bug signal — encode
  that, don't assume the happy path.
- **A tool that depends on an exception escaping to a platform handler is coupled to
  the runtime's error plumbing.** Re-test crash reporters, ANR detectors and
  uncaught-handler hooks after any architecture change (bridge → bridgeless, a major
  RN or SDK bump). They fail open and silently.
- **"Only works in release mode" and similar comments are claims with an expiry
  date.** Treat a comment describing runtime behaviour as evidence of what was true
  when written, not of what is true now.
- Distinguish this from #204 when triaging a silent Android failure: #204 is a class
  R8 removed (fix with `-keep`), this is an exception the runtime re-routed (no
  proguard rule can help).

**Occurrence.** 2026-08-18, Pixel 10 / Android 17, on Play production 2.8.8/vc28 and
again on 2.8.10/vc30. Fixed in PR #281. **Not yet verified on hardware** — the fix is
native, so it needs a build.
