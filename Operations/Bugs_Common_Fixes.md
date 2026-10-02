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
again on 2.8.10/vc30. Fixed in PR #281.

**VERIFIED ON HARDWARE — 2026-08-20.** Pixel 10, Play-installed production
2.8.11/vc31 (`installerPackageName=com.android.vending`, `isSideLoaded=false`), i.e.
the artifact real users have. Profile → Admin → Sentry diagnostics → CRASH NOW killed
the process for the first time ever (`pidof` empty; pid 27286 gone), and logcat shows
the exception taking the intended route:

```
FATAL EXCEPTION: main … at com.priceback.MainActivity.o0(SourceFile:5), at R9.a.run(SourceFile:1)
```

— obfuscated frames, so R8 is live, and the throw escaped `Looper.loop()` to the
default uncaught handler exactly as the fix intended. Sentry issue
[7683178575](https://prosoft-inc.sentry.io/issues/7683178575/) renders it fully
symbolicated: `com.priceback.MainActivity:84 in onNewIntent$lambda$0` plus 8 more
frames with real names and line numbers, zero `a.b.c(Unknown Source)`. Mapping chain
confirmed on both halves beforehand — the shipped AAB embeds
`io.sentry.ProguardUuids=8c094795-7b67-36d7-89a7-3fe716b058d4`, and the Sentry API
lists a matching 77.6 MB proguard-mapping uploaded 2026-08-19 19:43 UTC. That closes
item 10 of the R8 hardware checklist, the only step that proves the mapping upload
works; see `Technical/Android_R8_Optimization.md`.

---

## Every purchase was filed against an id the server never queries

**Symptom.** A TestFlight tester subscribed successfully. The app unlocked
Unlimited. RevenueCat showed the entitlement. The backend had **zero**
`subscription_events` rows — ever — and not one real credit-pack purchase had been
credited in the history of the production database; every `topup_purchase` row was
a simulated `dev_…` sideload. The user's report was "I subscribed and it worked,
but I can't see my balance and the credit packs didn't arrive."

**Root cause.** RevenueCat files each purchase against whatever `appUserID` the SDK
holds when payment completes. Both server paths look a purchase up by the account's
`sub` (`GET /v1/subscribers/<sub>`). **Nothing ever asserted the two matched.**
`bindRevenueCatToUser` ran only in the three sign-in *finalize* paths; boot called
`initRevenueCat()`, which is `Purchases.configure({apiKey})` and nothing else. Any
drift — a fresh install whose session was restored rather than re-signed-in, a
cleared RC cache, an interrupted bind, a raced `logOut` — left the SDK on an
anonymous id **silently and permanently**.

**Why it survived so long.** The device could not see it. The app reads its
entitlement out of the *local* `customerInfo`, so it unlocked correctly and every
indicator read "fine": RC configured ✓, entitlement active ✓, purchase succeeded ✓,
network up ✓. Only the conjunction was false. `POST /credits/topup` answered
`402 purchase_not_verified, retryable: true` forever, so the durable queue
faithfully retried a call that **could not ever succeed**, and the 60-day safety
valve was on course to delete the last local record of a real payment.

**Fix (PR #282).** `ensureRevenueCatIdentity()` — at boot, on foreground, and
immediately **before** `purchasePackage`. Ordering is the whole fix: asserting
afterwards is too late, because the receipt already belongs to an id the server
cannot query. Plus a durable retry for subscription sync (packs had one;
subscriptions did not), a `resyncStore` flag on the 402 so the client realigns and
re-files its store transactions instead of retrying blindly, and an admin Billing
diagnostic that reports the conjunction.

**Rules.**
- **A cross-system identifier needs an invariant, not an initialisation.** Binding
  once at sign-in is a hope. Asserting before every use is a guarantee. Ask "what
  re-establishes this after a restart, a reinstall, or a partial failure?"
- **A 200 is not a recording.** `syncSubscriptionToBackend()` returning
  `{synced: true}` with a `free` tier meant RevenueCat had nothing to give the
  server — the drift signature exactly. Clear a retry marker on the *outcome you
  wanted*, never on "the request completed".
- **Retryable ≠ eventually succeeds.** If a retry is keyed on a value that can
  never match, the queue is a slow-motion data-loss machine. Give the server a way
  to say "retrying this specific thing is pointless until you change something".
- **When every indicator is green and the outcome is wrong, the check is on the
  wrong subject.** Same class as [health-check-conjunction-rule] and
  [partial-success-stored-as-complete]: report whether the FEATURE works, not
  whether each part is configured.
- **A client-side bug can look exactly server-shaped.** Missing rows in the
  database were the only visible evidence, and the cause was entirely on device.

**Occurrence.** 2026-08-18, iOS TestFlight 2.8.10. Fixed in PR #282. **Not yet
verified end to end** — acceptance is `select count(*) from
priceback.subscription_events > 0` after the next TestFlight pass.

---

## The paywall advertised a USD price while the store charged CAD

**Symptom.** Prices on Buy Credits and Manage Subscription read `$4.99` / `$3`;
the Apple payment sheet charged the (higher) Canadian price. The in-app label
"took a while to load" and sometimes never corrected.

**Root cause.** Three screens each ran a one-shot `getStorePriceLabels()` on mount
with `priceFor(id, fallback)` falling back to the **catalog** label — plain
USD-derived amounts rendered with a bare `$`, in a Canada-only app. No retry, no
cache, no loading state: a single cold-start miss (RevenueCat not warm yet) pinned
the wrong number for the whole session. The backend compounded it —
`formatMoney` mapped CAD, USD and MXN all to `$`, so a Canadian catalog row of
`4.99` rendered indistinguishably from the USD list price.

**Rules.**
- **A fallback that is indistinguishable from the real thing is not a fallback,
  it is a silent substitution.** `$4.99` looked exactly like a price. A skeleton
  does not. Prefer showing nothing to showing a plausible wrong thing — especially
  for money.
- **Delete the parameter, not just the argument.** `priceFor(id)` now takes no
  `fallback`, so no call site can reintroduce one. Removing the *capability* is
  what makes a fix stick; removing the *usage* invites it back.
- **Money needs a currency, not a symbol.** `$` is ambiguous across CAD/USD/MXN.
  Render `CA$` — it is what StoreKit itself writes on a Canadian storefront.
- **Every price on a purchase surface must come from the store.** App Review
  compares the paywall against App Store Connect (Guideline 2.3.1 / 3.1.2), and a
  purchase control with no price is its own finding — disable it instead.
- Watch for prices that never route through the price lookup at all: the annual
  card's `monthlyEquiv` was a hardcoded USD string rendered directly beneath a CAD
  price, and nobody noticed because it *had* a price-shaped value.

**Occurrence.** 2026-08-18, iOS TestFlight 2.8.10. Fixed in PR #282.

---

## 212. A signup was routed as a restore — the precheck answered, and nothing read the answer

- **Date:** 2026-08-19 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Reported from the field on 2.8.10: *"on signin we had a prechecker
  to check if the user exist or no; since that, i have a loading page for a while
  and then a redirect on Restoring account, for new user is blocks."* A brand-new
  account signs in, sits on a loader, is then shown **"Restoring your account…"**,
  and ends up inside the app with no postal code and no province on the server.

- **Root cause:** THREE defects on one path, all downstream of the same
  assumption — that local prefs describe the account that is signing in.

  1. **The routing.** `decideSignInRoute()` read `profileComplete && postalCode`
     *before* the hydrate's `accountExists`. Those prefs are not account-scoped:
     `signOut()` keeps them on purpose (a sign-out is not an erase, and the same
     person signing back in — offline included — must not lose their history). So
     on any handset where *some* account had onboarded, a new account was routed
     `"main"`: `setSignInPhase("restoring")` → the restore screen it must never
     see, then `navigation.replace("Main")`. SetupStep never ran, so no postal
     code / province reached the server, the referral window was skipped, and
     marketing consent was never asked. And because `serverAccountExists()` then
     stays false forever, **every later sign-in repeated the same branch.**
  2. **The unbounded loader.** `_hydrate()` emits the precheck answer and then
     awaits two write-backs — `syncPushTokenToBackend()` and
     `flushProfileSync()` — both of which funnel into `syncProfileToBackend()`,
     the last backend call in the app with **no AbortController**. They run after
     the screen has committed to a full-screen loader, and the screen cannot
     route until the hydrate resolves. One stalled PUT held the user there for as
     long as the socket lived. `_timedGet`'s 12 s ceiling covers only the
     bootstrap GET and the receipt pages.
  3. **The cross-account write.** Local receipts survive sign-out too. That is
     not just a display bleed: `unionMergeReceipts` flags every local receipt the
     server did not return as `syncPending`, and the push pass then **uploads
     account A's receipt history into account B's server records** — receipt
     rows, items, and the `price_points` derived from them.

- **Production evidence:** two accounts, one household, one device, 2026-08-17.
  `monicasharobim@gmail.com` (created 15:31:29) finished setup at 15:45:26 —
  postal `J0N 1P0`, and **three** `consent_events` at 15:33:23
  (`terms_of_service`, `privacy_policy`, `marketing_push`, source `signup`).
  `sharobimmonica@gmail.com` (created 15:47:43, ~2 min later) has
  `postal_code`/`province_id` **NULL**, 75 credits, a push token, and exactly
  **two** `consent_events` at 15:47:52 — `terms_of_service` + `privacy_policy`,
  9 seconds after the row was created. That pair with no postal code is
  byte-for-byte the payload the `route === "main"` branch queues
  (`OnboardingScreen.js`, the returning-user consent re-affirmation); nothing else
  in the app sends it alone. `updated_at` 2026-08-18 19:08 — still in use, still
  with a NULL postal code, so regional pricing and price-drop matching were dead
  for that account.

- **Fix:**
  - `decideSignInRoute` now returns `"setup"` when the hydrate positively
    answered `accountExists === false`, ahead of the local-prefs check. Strictly
    `=== false`: a missing field, a failed hydrate or an offline sign-in take the
    path they always did, which is what keeps offline re-sign-in working.
  - New `enforceLocalAccountBoundary(sub)` (authService) + `getLocalDataOwner` /
    `setLocalDataOwner` / `clearAccountScopedStorage` (storageService), keyed on
    `local_data_owner_sub_v1`. No owner on record → adopt, clear nothing (every
    install predating this). Same owner → no-op. Different owner → clear the
    account-scoped data, then adopt. Called **before the credential is
    persisted** at all three finalize sites, because App.js's foreground hydrate
    is concurrent with the rest of sign-in and decides what to do by reading the
    keychain. `bootService` back-fills the marker for anyone already signed in.
  - `syncProfileToBackend` gets a 15 s `AbortController`; `_hydrate`'s two
    write-backs move to a detached `out.sideEffects` promise so routing no longer
    waits on them (same order preserved); and `onSignInDone` races the hydrate
    against a 45 s ceiling that lands in the existing "retry" branch as
    `SIGNIN-TIMEOUT`.

- **Files:** `src/screens/OnboardingScreen.js` (`decideSignInRoute`,
  `onSignInDone`, `SIGNIN_HYDRATE_CEILING_MS`), `src/services/authService.js`
  (`enforceLocalAccountBoundary`, `syncProfileToBackend`, the three finalize
  paths), `src/services/storageService.js` (owner marker,
  `clearAccountScopedStorage`, `DEVICE_SCOPED_PREF_KEYS`),
  `src/services/syncService.js` (`_hydrate` tail → `out.sideEffects`),
  `src/services/bootService.js` (owner back-fill).

- **Detect next time:** one query. A new account that never saw SetupStep has a
  NULL postal code *and* only two consents:

  ```sql
  select u.sub, u.email, u.created_at, count(ce.id) as consents
  from priceback.users u
  left join priceback.consent_events ce on ce.user_sub = u.sub
  where u.postal_code is null and u.deletion_requested_at is null
  group by u.sub, u.email, u.created_at
  order by u.created_at desc;
  ```

  A row with `consents = 2` is this bug. `consents = 0` is someone who abandoned
  the form, which is normal.

- **Prevent:** `__tests__/localAccountBoundary.test.js` (the three outcomes, the
  consent-crossing cases, and the ordering invariant asserted as an observable
  fact — *what local storage held at the moment the hydrate read it*),
  new precedence + ceiling blocks in `__tests__/onboardingSignInRecovery.test.js`,
  the new-account-on-a-used-handset render case and the loader-failsafe case in
  `__tests__/onboardingSignupVsRestore.test.js`, `sideEffects` non-gating cases in
  `__tests__/syncServiceHydrate.test.js`, the bounded profile PUT in
  `__tests__/authServiceSessionTimeout.test.js`, and the back-fill cases in
  `__tests__/bootService.test.js`.

- **Residual, flagged not fixed:** persisted receipt photos under
  `documentDirectory/receipts/` are left behind by a boundary wipe — unreferenced,
  so a storage leak rather than a bleed. And the cross-account push-up in (3) is a
  plausible contributor to the 380 orphaned production price points recorded in
  `Production_Test_Data_Purge_2026-08-18.md`; that is a lead, not a conclusion.

---

## 213. The fix for "don't say the wrong thing" said nothing at all — and the router still waited on the receipt history

- **Symptom (reported):** "I have a loading page for a while and then a redirect
  on Restoring account." #212 fixed the wrong *destination*. It did not fix the
  wait, and its own fix made the silence worse: the loader that covers the
  existence check was left deliberately **wordless**, so the user's next report
  was a spinner "without any output".

- **Root cause 1 — a rule applied past its purpose.** The rule behind #212's
  silent loader was *never* "be silent", it was "don't claim what you don't know
  yet". `signin.restoringTitle` broke that rule; a neutral "Signing you in…"
  does not. The tell that the honest wording existed all along: the screen was
  already handing exactly that phrase to a screen reader
  (`signin.checkingA11y`) while showing sighted users nothing.

- **Root cause 2 — the blocking path included work the decision doesn't need.**
  `_hydrate` merged the entire receipt history *before* applying preferences,
  and `onSignInDone` could not route until the whole promise resolved. The
  receipt step pages up to 25 times at 12 s each; the only local fields
  `decideSignInRoute` reads are `profileComplete` and `postalCode`, which come
  out of the *prefs* step. So the router waited on a user's purchase history to
  decide which screen to show. #212's 45 s ceiling **bounded** that wait without
  shortening it — a genuinely long restore spent the full 45 s on the loader and
  then landed on the `SIGNIN-TIMEOUT` apology while the restore was working.

- **Root cause 3 — one dead token, re-discovered once per queued receipt.**
  `retryPendingReceiptSyncs` looped the whole queue on a 401. A rejected
  credential is a property of the *session*, so every later receipt in the pass
  got the same answer — and `authedFetch` spends a forced re-issue + retry on
  each one, so N pending receipts cost 2N rejected requests back-to-back. That
  is the burst of `verify_rejected` the auth monitor saw: not N users failing,
  one user asking N times.

- **Root cause 4 — the app named the cause it guessed, not the status it got.**
  `fetchReferralStatus` returned bare `null` for signed-out, unconfigured,
  401/403, 5xx and transport failure alike, so both callers rendered "Couldn't
  reach the server. Try again when you're online." to a user whose session had
  expired — advice they can never act on, since they already are online. Same
  reporting class as #205 and #209.

- **Fix:**
  1. `CheckingStep` renders `signin.checkingTitle` ("Signing you in…" / "Connexion
     en cours…"), true for both answers, EN+FR.
  2. Prefs apply first; the receipt step moves off the blocking path as
     `out.receiptsSettled`. **The paging and the merge are deferred as one
     unit** — `unionMergeReceipts` flags every local receipt the server did not
     return as `syncPending`, so merging page 1 early would flag a
     >200-receipt user's whole remaining history as missing server-side and
     re-upload it (#212(3)'s cross-account write, aimed at the user's own
     account). `sideEffects` awaits `receiptsSettled` first, so the write-back
     order is unchanged.
  3. Ceiling 45 s → 20 s. It now covers one hard-bounded 12 s bootstrap GET
     plus local writes, so the worst case a user can be made to stare at drops
     by 25 s without any risk of cutting a working restore short.
  4. `retryPendingReceiptSyncs` breaks on a 401 — *after* recording the outcome,
     leaving everything else `syncPending`/`syncRetryable` for the next
     foreground, which is where a fresh token actually comes from.
  5. New `fetchReferralStatusResult` returns a typed reason
     (`signed_out` / `unconfigured` / `auth_expired` / `server` / `network`);
     `fetchReferralStatus` is kept as the null-shaped wrapper. Both referral
     surfaces gained `profile.referralSessionExpired` (EN+FR).
  6. `ManageSubscriptionScreen`'s Restore + Terms/Privacy furniture moved into a
     renderer used by **both** exit paths. Audit #4 R6 had added it below the
     `!status.isPremium` early return — showing Restore to people who are
     already subscribed and hiding it from the one person who needs it (a user
     whose entitlement did not carry over reads as non-premium), while the trial
     branch rendered a plan selector with no Restore and no legal links at all.

- **Files:** `src/screens/OnboardingScreen.js`, `src/services/syncService.js`,
  `src/services/storageService.js`, `src/services/authService.js`,
  `src/screens/InviteFriendScreen.js`, `src/screens/StoresAndProfileScreens.js`,
  `src/screens/ManageSubscriptionScreen.js`, `src/services/i18n.js`.

- **Lesson:** a fix that removes a false statement has to leave a true one
  behind. "Say nothing" is only correct when nothing is knowable — and here the
  accessibility label proved otherwise. And bounding a wait is not the same as
  ending it: ask what the blocking work is actually *for*, or the ceiling just
  becomes the new duration.

- **Prevent:** `__tests__/syncServiceHydrate.test.js` (routing resolves while the
  receipt paging is still open; `receiptsSettled` ordering ahead of the
  write-backs), `__tests__/restoreEndToEnd.test.js` (awaits `receiptsSettled`
  before reading counts), `__tests__/storageService.syncRetry.test.js` (the pass
  stops on the first 401 and leaves the rest queued),
  `__tests__/authServiceApi.test.js` (all five referral reasons),
  `__tests__/onboardingSignupVsRestore.test.js` (the loader carries neutral copy),
  `__tests__/billingScreens.smoke.test.js` (Restore + legal on both
  ManageSubscription branches).

---

## A 60-second burst of rejected requests rendered as "You're offline" (2026-08-19, PR #286)

- **Symptom:** on a device whose session had died, roughly a minute of
  authenticated requests came back `401` (the backend's auth-failure monitor
  logged the burst as `verify_rejected`). The only thing the app put on screen
  was HomeScreen's connectivity strip: *"You're offline — scans saved locally,
  price checks paused."* The internet was fine. The user was told to fix the one
  thing that was not broken, and never told the one thing that would have fixed
  it — sign in again.

- **Class:** this is Bugs #205 again — **the app names the cause it guessed
  instead of the status it received.** `authedFetch` *had* the 401 in hand and
  threw the information away; every consumer swallows its own errors, so nothing
  outside the call site ever learned the credential was dead. HomeScreen owned
  the only "something is wrong" surface and it had exactly two states, neither
  of which was "the server answered, and said no".

- **Fix:**
  1. `authService` gained a small in-memory observable —
     `isCredentialRejected()` / `subscribeCredentialRejected(fn)`. `authedFetch`
     latches it **after** its existing forced re-issue + retry, so only a 401
     that survives recovery counts.
  2. Deliberate status ladder: `401` → rejected; `<500` → cleared (the server
     answered and our token was fine); **`5xx` → left untouched**, because a
     server fault says nothing about the token and latching there would tell
     every user to sign in again during an unrelated outage.
  3. Cleared on a completed sign-in (`_hydrateAfterSignIn`) and on `signOut` —
     a signed-out user has no session to expire.
  4. HomeScreen renders a third, tappable banner (`home.sessionExpired`, EN+FR)
     that routes to Profile. Precedence is `isOffline` → `credentialRejected` →
     `backendDown`: a radio-less device still can't re-sign-in, but a server
     that returns 401 is emphatically *not* a server that is down.

- **Not persisted, on purpose.** The flag describes the credential held in
  memory right now; a fresh launch re-derives it from the first authed call.
  Persisting it would let a stale "sign in again" survive a fix.

- **Files:** `src/services/authService.js`, `src/screens/HomeScreen.js`,
  `src/services/i18n.js`.

- **Lesson:** a fallback banner is a *claim*. If the only banner you own says
  "offline", every failure you cannot classify becomes a lie about the network.
  The cheapest fix for the whole reporting class is to make the status you
  already received reachable by the surface that has to explain it.

- **Prevent:** `__tests__/authCredentialRejected.test.js` (the full status
  ladder, including the load-bearing "a 5xx must not raise it", plus sign-out
  clearing and late-subscriber delivery) and `__tests__/screensSmoke.test.js`
  ("HomeScreen — the session-expired banner": it renders, it never shows the
  offline copy, and it outranks `backendDown`).

- **Also checked, already fixed:** Restore being unreachable for a non-premium
  account. `ManageSubscriptionScreen.renderRestoreAndLegal()` is called from
  **both** exit paths as of PR #285 (lines 419 and 622) — see the audit #4 R6
  entry above. No further change needed.

---

## 214. A fault on the user's phone was reported to them — and to support — as our backend being down (2026-08-20)

**Class: the classifier that answers with the bucket it fell into rather than the
cause it observed.** Third sibling of #205 and of the "You're offline" entry above:
in all three, the app *had* the information that named the real cause and discarded
it in favour of a default that reads like an explanation.

**Symptom.** Sentry `PRICEBACK-CANADA-F`, one event, release **2.8.11 / dist 31**
(the current Play build), Android 11, 2026-08-19 20:34:26 UTC. Title:
`T7.b: INTERNAL_ERROR` — `T7.b` is the minified error constructor, `INTERNAL_ERROR`
is the entire message, and the event carries **no stack frames at all**. Extras read
`flow: signin_google`, `category: "server"`, `reference: "SERVER"`.

So the user was shown *"Our service is having a hiccup. Please try again in a few
minutes — our team has been notified"*, and any support ticket would have carried
`SERVER` — the same code a genuine 5xx produces.

**Our service was fine.** The same session's breadcrumbs show six `200`s against
`priceback-production.up.railway.app` (`pricing.json`, `warehouses.json`,
`policies.json`) in the 40 seconds before the failure, plus a `200` from
`exp.host`. Nothing was wrong with the backend, and "wait a few minutes" could
never have helped.

**Mechanism.** The failure is Google Play Services' `ApiException` **status 8,
`INTERNAL_ERROR`** — a device-side fault. `@react-native-google-signin`'s
`ErrorDto.kt` strips the `"<code>: "` prefix off the ApiException message and falls
back to `GoogleSignInStatusCodes.getStatusCodeString(code)`, so what reaches JS is
`{ code: "8", message: "INTERNAL_ERROR" }` — a bare status word, no HTTP status,
nothing naming our servers.

`classifyError` had an explicit branch for it, and it was the **last** line of the
function:

```js
// Transient Google Play Services failure (e.g. INTERNAL_ERROR / code 8 …)
if (/com\.google\.android\.gms|\bINTERNAL_ERROR\b|play services/i.test(msg)) return "server";
```

The comment reasoned that the `server` bucket "already says *having a hiccup, try
again in a few minutes*". That is true of the words and false of the meaning: the
copy names **our** service, and the support reference is shared with real outages,
so the one code that should have said *look at the device* said *look at the API*.

**The device-side timeline, from the event's own lifecycle breadcrumbs** — and the
reason it is worth reading them:

```
20:32:30.588  SignInHubActivity created     ← tap
20:32:43.909  SignInHubActivity destroyed   ← attempt 1 fails
20:32:44.250  SignInHubActivity created     ← 341 ms later: OUR retry
20:34:26.287  SignInHubActivity destroyed   ← attempt 2 fails, 102 s later
20:34:26.365  T7.b: INTERNAL_ERROR reported
```

`signInWithGoogle` retries a transient GMS failure once after `GSI_RETRY_DELAY_MS`
(300 ms) and throws only the **second** error. The 341 ms gap is that retry. So the
one event Sentry received described the second attempt and said nothing whatever
about the first — we could not tell a one-off blip, where the retry earns its keep,
from a device where sign-in can never succeed and the retry only doubles the wait
before the user is told so. Here it took the time-to-failure from 13 s to 1 m 56 s.

**Fix (client-side only — the GMS fault itself is not ours to fix).**

1. **New category `signin_provider_error`**, reference `SIGNIN-PROVIDER-ERROR`,
   matching `INTERNAL_ERROR` / `INTERRUPTED` / `API_NOT_CONNECTED` /
   `com.google.android.gms` / `play services`. Copy (EN+FR) names the actual
   remedy: update Play Services, check a Google account is added on the device.
   It explicitly says nothing is wrong with the user's PriceBack account.
2. **The branch stays exactly where the `return "server"` stood — last.** Position
   is load-bearing: every bucket above it is more specific (a Google auth message
   that also says `invalid_grant` must still read as an expired grant), and the 5xx
   ladder above must keep claiming a backend envelope, which carries the string
   `INTERNAL_ERROR` too — `backend/lib/httpError.js` puts the upper-case code in
   every error body. Re-categorising in place cannot move anything else.
3. **`React Native unavailable` → `provider_unavailable`.** Same defect, found
   while tracing: the coarse 5xx line matches a bare `/unavailable/`, so a dead RN
   bridge was also reported as our backend (`PRICEBACK-CANADA-A` carries
   `category: "server"` for exactly that message), as was authService's own
   *"Google Sign-In native module unavailable"*, which sets no code to win on.
   This branch sits **below** the status ladder so no HTTP-shaped error changes
   meaning.
4. **`reportHandledError` now lifts `err.code` / `err.status` into the report**
   (`errCode`, `errStatus`). Recovering "Play Services status 8" from
   `T7.b: INTERNAL_ERROR` meant reading a minified constructor and then the
   library's Kotlin source; the code was on the error object the whole time and
   simply never left the device. Codes and statuses only — never a message, which
   is where user data would be, and both are length-capped.
5. **The swallowed retry is now visible.** `signInWithGoogle` records the first
   attempt's code on whatever error surfaces (`priorCode`), which
   `reportHandledError` forwards. Absence is the signal: no `priorCode` means the
   failure happened first try. The value is a bounded vocabulary — the GMS code, or
   the status word — never raw provider prose.
6. **Two copy strings that were wrong outside the flow they were written for.**
   `err.playServicesBody` said *"before PriceBack can reach **Gmail**"* but also
   fires during sign-in, where Gmail is not involved; `err.providerUnavailableBody`
   said *"**Mailbox scanning** isn't available"* and now also covers a dead bridge.
   Both are flow-neutral and accurate for every caller.

**Files:** `src/services/errorSupport.js`, `src/services/authService.js`,
`src/services/i18n.js` (EN+FR, `err.signInProviderErrorBody`).

**Lessons.**
- **A coarse bucket's copy is a claim about the world.** `server` does not mean
  "5xx-ish"; it means *"our service is unwell"*, and it is wrong to say that about a
  fault on the user's phone. When a branch routes to a bucket, read the sentence the
  user will see, not the name of the constant.
- **`/unavailable/` in a 5xx pattern is a magnet.** Any message containing the word
  — a missing native module, a dead bridge, a Play Services hiccup — gets blamed on
  the backend. Device-side failures must be claimed *before* a coarse text bucket
  gets a chance at them.
- **A silent retry must leave a trace.** If it swallows the first failure, telemetry
  can never tell you whether the retry helps; it only shows you the attempt that
  failed anyway.
- **Put the provider's own code in the event.** Sentry titles a JS error by its
  minified constructor, so the failure code is exactly the field that survives
  minification and exactly the field we were not sending.

**Prevent.** `__tests__/errorSupport.test.js` → *"PRICEBACK-CANADA-F — a Play
Services fault told the user our backend was down"* (the three GMS codes, the
verbatim production message with no code attached, distinct-reference-from-a-real-
outage, the copy key, the backend-500-stays-server guard, and a
does-not-steal-its-neighbours case covering `signin_misconfigured`,
`play_services`, `cancelled`, `timeout` and ordinary 5xx prose); *"a dead native
side is the app's fault, not the backend's"* including the status-ladder placement
guard; and *"reportHandledError carries the provider's own failure code"* (lifting,
capping, omission when absent, caller-context precedence).
`__tests__/authServiceSignIn.test.js` → *"the silently-retried first attempt leaves
a trace"* (code and status-word forms, the token-less retry, absence on a first-try
failure, and that annotating a frozen or primitive rejection can never replace the
real failure with a `TypeError`).

**Verification note.** GitHub Actions is billing-blocked again (all three jobs
`conclusion: failure`, `steps: 0`, ~5 s), so CI could not run this. Verified instead
by loading the **real** `errorSupport.js` into a harness and asserting 34 cases, and
by a differential sweep of the previous classifier against the new one over 15 794
distinct string literals from 299 source and test files: the only changes are
`server → signin_provider_error` (GMS/Play Services strings),
`unknown → signin_provider_error` (`INTERRUPTED`, `API_NOT_CONNECTED` — previously
falling through) and `server → provider_unavailable` (the native-module strings).
Nothing else moved. `npm run i18n:check` passes at en=1479 / fr=1479.

---

## 215. A retry that re-opened the account picker, priced as if it were free (2026-08-21)

**Class: an interactive step repeated automatically.** The second half of #214 — the
same Sentry event, a different defect. #214 fixed what the user was *told*; this is
what the app made them *do* before telling them it.

**Symptom.** Nothing in the Sentry event at all, which is the point.
`PRICEBACK-CANADA-F` reported a single `INTERNAL_ERROR`. Only the device's own
Android lifecycle breadcrumbs showed there had been two attempts:

```
20:32:30  SignInHubActivity  created
20:32:43  SignInHubActivity  destroyed   ← 13 s with the Google account sheet on screen
20:32:44  SignInHubActivity  created     ← 341 ms later: our own retry
20:34:26  event captured                 ← the error the user was finally shown
```

A 13-second failure became a **1 minute 56 second** one, and the user picked a
Google account twice to reach it. The error they eventually got was #214's wrong
one, so the extra 1 m 43 s bought nothing.

**Mechanism.** `signInWithGoogle()` wraps its whole body in a two-iteration loop and
retries after a 300 ms backoff when the first attempt fails with a transient GMS
status (`INTERNAL_ERROR` 8, `INTERRUPTED` 14, `TIMEOUT` 15), or resolves with no ID
token (#206). The retry re-runs `GoogleSignin.signIn()`.

`GoogleSignin.signIn()` is **interactive**. On Android it launches
`SignInHubActivity` — the account picker. So the loop's second iteration is not a
re-attempt of a background call; it is a second demand on the user's attention.

The comment defending it said:

> one silent retry is cheaper than an error the user has to act on

That is true, and it is the same shape of error as #214's comment: true of the
words, wrong about the situation. It is only *silent* while nothing has been shown.
Once the first call has put a sheet on screen and the user has worked through it,
the retry is not silent, not free, and not cheaper than an honest error — it costs
another full trip through the picker before the user learns anything.

Both halves of #214 come from the same habit: reasoning about a mechanism by the
name it was given (`server`, `retry`) instead of what it does to the person in front
of it.

**Fix.** The retry is now gated on how long the failed attempt ran
(`GSI_UNATTENDED_ATTEMPT_MS = 2000`, `src/services/authService.js`). Below the
threshold the attempt cost the user nothing and is retried exactly as before; at or
above it the failure is surfaced immediately instead.

The threshold is deliberately **a bound on wasted time, not a UI detector**. We
cannot observe from JS whether a sheet was drawn, and a fix that depended on
guessing would be unverifiable. What the number guarantees is checkable and
sufficient: an automatic second attempt can never cost the user more than ~2.3 s
(threshold + backoff) before it is refused. It sits far above a machine-speed
rejection — those return in tens of milliseconds, and even a cold Play Services
start is well inside a second — and far below any real trip through a picker, the
observed one being 13 s.

Applied to **both** silent retries, since both re-run the same interactive call: the
transient-GMS branch and the token-less (#206) branch.

The same reasoning already existed in this file, six lines below the loop:
`_googleReauthBlockedUntil` blocks an interactive re-auth for a minute after a
successful interactive sign-in, because *"an interactive RE-auth in the next minute
cannot be a recovery — it can only be a loop."* The retry violated the principle its
own neighbour enforced.

**Telemetry.** `err.attemptMs` now records how long the attempt that produced the
surfaced error ran, lifted into the Sentry event by `reportHandledError` alongside
#214's `priorCode`. Read together they are unambiguous:

| `attemptMs` | `priorCode` | What happened |
| --- | --- | --- |
| ≥ 2000 | absent | The gate fired — a retry was declined rather than charged to the user |
| < 2000 | present | The retry ran and the second attempt failed too |
| < 2000 | absent | A single fast failure, nothing swallowed |

Clamped at zero, because `Date.now()` is wall-clock and an NTP correction mid-attempt
must not report a negative duration.

**Regression risk — stated, not assumed.** The gate can only ever *remove* a retry;
it adds none and changes no other branch. It sits below the cancel and
`PLAY_SERVICES_NOT_AVAILABLE` branches, so backing out of a long sheet is still a
cancel, and it is `&&`-appended to a guard that already required `attempt === 0`, so
no second-attempt path moves. Every existing retry test still passes untouched:
their mocks reject in well under a millisecond, which is precisely the case the gate
preserves. The user-facing copy does not change — a gated failure surfaces through
#214's `signin_provider_error`, which is the correct message either way.

The one behaviour genuinely traded away: a transient GMS failure that arrives
*after* a long picker session is no longer retried, so a device where that
combination would have self-healed on the second try now shows an error. That is the
intended exchange — it converts an unbounded, invisible cost into a bounded, honest
one — and `attemptMs` is what will show in the field how often it happens.

**Lessons.**
- **"Retry" is a claim about cost.** Before repeating a call automatically, ask what
  it does besides return a value. A call that draws UI is never free to repeat, and
  the loop that repeats it cannot tell.
- **Read the principle you already wrote down.** `_googleReauthBlockedUntil` had the
  right rule, in the same function, before this bug shipped. The gap was that it was
  written as a fix for one path rather than as a property of interactive calls.
- **A silent retry hides its own cost, not just its error.** #214 added `priorCode`
  so a swallowed failure leaves a trace; that showed the retry existed but not what
  it charged. Duration was the missing half.
- **Prefer a bound you can verify to a signal you can only infer.** "Was a sheet
  shown?" is unanswerable from JS. "Can this cost the user more than N seconds?" is
  answerable, testable, and enough.

**Prevent.** `__tests__/authServiceSignIn.test.js` → *"a retry that would re-open the
account sheet is refused"*: the 13 s transient failure surfaces after one call; a
120 ms one is still retried (both branches, GMS and token-less); the threshold
itself does not retry, pinning `<` over `<=` and pinning the constant; `attemptMs`
is recorded and is the attempt's own duration rather than the pair's; a backwards
clock step cannot report a negative duration; a cancel after a long sheet is still a
cancel; and a long `DEVELOPER_ERROR` — a branch that never retried — is unchanged.
`__tests__/errorSupport.test.js` → *"reports how long the failed attempt held the
user"* and *"keeps a zero-length attempt"*, the latter pinning the null check rather
than a truthiness one, since `0` is a real and different signal.

**Verification note.** GitHub Actions is still billing-blocked, so CI could not run
this. Verified locally on targeted suites only, per the standing rule against full
local runs: the new tests were watched to fail first (6 red, and the 4 that passed
were the regression guards — the correct split), then 165/165 across
`authServiceSignIn` + `errorSupport`, then 300/300 across 13 further auth,
error-surface, onboarding and email-sync suites. `npm run i18n:check` passes
unchanged at en=1479 / fr=1479 — the fix adds no user-visible copy because #214's
already says the right thing.

---

## 216. A dropped response read as theft — the four-second retry that signed an iPhone out for the evening (2026-08-24)

**Class: a protocol that assumes the client learns the outcome of every request.**
Four symptoms were reported as four bugs. They are one, and production recorded it
minute by minute.

**Symptoms, as reported.**

- Every screen 401-ing on a phone that had been signed in for six days.
- *"Sign-in failed — Apple couldn't complete the sign-in. Check that you're signed
  in to iCloud on this device."* on every attempt to sign back in.
- Google sign-in on the same iPhone failing immediately afterwards.
- Account deletion failing, so the user could not even start over.
- A support alert reading *"This usually means mobile clients are sending expired or
  invalid Google ID tokens."* — which was false, and cost most of a day.

**What actually happened.** `priceback.user_sessions`, family `fb12OXsb`:

```
20:07:01.796  session 4 revoked `rotated`           <- the app presented its refresh token
20:07:03.943  successor 7 created                   <- the reply still had to reach the phone
20:07:07.994  successor 7 revoked `reuse_detected`  <- the app presented the SAME token again
20:07:10 ->   20 x verify_rejected across /api/me/bootstrap, /api/me, /profile,
              /credits, /credits/topup, /consents, /subscription/sync
```

Nobody stole anything. `_refreshFirstPartySession` aborts at 8 s and — correctly —
**keeps** its refresh token, because a timeout says nothing about whether the session
died. There is even a test asserting that. But the *server* may already have spent
it, and four seconds later the retry presented a revoked row. `rotate()` read an
honest retry as theft and burned the whole family.

`pg_advisory_xact_lock` was already there, with a comment claiming it prevented
exactly this. It does not and cannot: it **serialises** the duplicate, it does not
change the second caller's answer. The second transaction still lands on
`row.revokedAt` and still burns. A lock is not an idempotency mechanism.

**Why one burn cost an evening.** Once the family died the phone fell back to the
Apple identity token, which lives ~10 minutes and was six days old. Every request
401'd; every 401 called `refreshAppleIdTokenInteractive()`; every one of those raised
an Apple sheet. And `openFirstPartySession()` was reachable **only from the three
sign-in finalizers** — never on boot, never after a session died — so the device
could not climb back out. It was pinned to a ten-minute credential until the user
signed in by hand.

The sheets are what produced the other two symptoms. iOS lets one authorization
stand at a time; four places in `authService` raise one and nothing coordinated
them. On OnboardingScreen the stale stored user fires `onContinue()` -> hydrate ->
401 -> a **background** Apple sheet, at the same moment the user taps Continue with
Apple. Two stacked `ASAuthorizationController`s both fail — Apple as
`ERR_REQUEST_UNKNOWN`, which we map to `signin_unavailable` ("check that you're
signed in to iCloud"), and the next Google attempt cannot get a presentation anchor
at all. `errorSupport.js` had recorded the pairing a month earlier without knowing
the cause: *"Observed 11x in one week, every time in the SAME session as a failed
Apple sign-in moments earlier."* Deletion failed for the same reason —
`deleteMyAccount` raises a sheet and then calls `authedFetch` with a dead session
and a dead provider token.

Every one of those four guards was **individually correct**. That is what made the
collision invisible.

**Fix — server (`backend/repos/sessionsRepo.js`).** `rotate()` serves a bounded
replay instead of burning, and only when all of:

- the row was retired by *us* (`rotated` / `superseded_by_replay`), never by a
  sign-out, an account deletion, the session cap or a previous burn;
- **no descendant has ever been presented.** `last_used_at` is stamped only when a
  token's holder actually showed it to us, so if the newest genuinely-used row in
  the family is younger than the one in hand, the successor reached somebody — and
  an ancestor turning up afterwards is the theft the mechanism exists to catch. This
  condition does not depend on the clock at all;
- the last genuine use is within `SESSION_REPLAY_GRACE_MS` (30 s, tunable). The
  window is anchored *there*, not on this row's own revocation — which is what stops
  two parties ping-ponging replays and rolling it forward forever, since a replay
  never stamps `last_used_at`;
- the family holds exactly one live heir, younger than the row in hand, unexpired.

The heir is **rotated, not re-issued**: only its hash is stored, so the plaintext in
the response that never arrived is unrecoverable. It is retired with `last_used_at`
still null, because nobody ever received it. No migration. Both rotation paths now
take a family-scoped advisory lock as well as the token one, in a fixed order, since
an ordinary refresh and a replay can target the same heir row.

**Fix — client (`src/services/authService.js`).**

- **One authorization presenter**, taken at the *native call* rather than around the
  exported functions — `refreshGoogleIdTokenInteractive` calls `signInWithGoogle`, so
  a lock one layer up would wait on itself. User taps queue; the two background
  refreshers give up instead, because queueing would put a second sheet in front of
  the user the instant they finished the first.
- **The rotated pair is indispensable.** `_storeSession` reports whether the refresh
  token landed, and both callers drop the session rather than carry on with a
  15-minute access token and a spent refresh token behind it. The same
  partial-success-stored-as-complete shape as #206.
- **Re-open on recovery.** `authedFetch` mints a session at the only moment it can be
  done with no UI and no guessing — a provider token the backend has *just* accepted.

**Fix — the alert (`backend/server.js`).** The body hardcoded the Google sentence.
All 20 rejections were `verify_rejected` (an Apple or session token refused);
expired Google tokens arrive as `verify_threw` with *"Token used too late"*. The
email named the one class that had **not** fired and pointed at `api_audit_log`,
which no longer exists. It now reports the measured tally by reason and by route,
picks its guidance from the **dominant** reason rather than the latest one, and names
`priceback.auth_outcomes`. Third instance of this class after #205 and #214.

**Durable lessons.**

1. **At-least-once delivery + rotate-on-use + burn-on-reuse = a guaranteed lockout on
   any dropped response.** If a credential is spent on presentation, the protocol
   needs an idempotent replay of the *same* exchange. This is not a nicety; without
   it, every network blip is a sign-out.
2. **A lock serialises; it does not make an operation idempotent.** The comment
   claiming otherwise sat directly above the code that disproved it for six days.
3. **Guards that are individually correct can still collide.** Four in-flight guards,
   four correct, one shared resource nobody owned. When a resource is global
   (the screen, the presenter, a rotating token), the guard has to be global too.
4. **A capability reachable only from the happy path is not a recovery.**
   `openFirstPartySession` existed, worked, and could never run when it was needed.

**Verification note.** GitHub Actions is still billing-blocked, so CI could not run
this. Verified locally on targeted suites. Backend: 12 new cases in
`sessionReplayGraceDb.test.js`, watched to fail with `SESSION_REPLAY_GRACE_MS=0` —
which restores the exact pre-fix behaviour and is itself one of the tests — then
57/57 across the four existing session suites, 8/8 on `authFailureMonitor` (4 new),
19/19 on `healthSessions` (2 new). Client: 14 new cases in
`authServiceSessionRecovery.test.js`, 7 of which fail when the three fixes are
disabled in place; 8 new storefront cases in `storePrices.test.js`; 224/224 across
ten auth suites, 226/226 across twelve session/onboarding/audit suites, 65/65 across
the price-facing screens. `npm run i18n:check` unchanged at en=1485 / fr=1485 — the
fix adds no user-visible copy.

**Two existing tests changed on purpose.** `sessionRoutesDb`'s *"re-presenting a
ROTATED token revokes the entire family"* and `sessionHardeningDb`'s pruning case
both re-presented a token immediately, which is now the *replay* case. They reach the
burn path explicitly — the first by having the honest client use its successor, the
second by presenting past the window — rather than by accident.

---

## The paywall showed a currency the store had stopped charging in (2026-08-24)

Filed with #216 because it was reported in the same breath, but it is an independent
defect with an independent cause.

**Symptom.** In-app product prices shown in the wrong currency on a device whose App
Store region had been changed (France -> Canada).

**Mechanism.** `storePrices.js` opens with the claim that its cache

> is stamped with the storefront currency and ages out, so a stale entry can neither
> outlive a storefront change nor be trusted indefinitely.

Half of that was implemented. `_writeCache` stamped a `currencyCode`;
`primeStorePricesFromCache` **never read it back**. So the old region's prices were
applied as `status: "ready"`, and if the live read then kept failing — an offering
that will not resolve, which is exactly what an unattached iOS IAP product looks
like — nothing ever corrected them for the full 30-day cache life.

**Fix.** The cache is stamped with the storefront **country**
(`subscriptionManager.getStorefront()`, RevenueCat's `Storefront.countryCode`) and
refused when it disagrees. `null` means *"we don't know"* and must never read as
*"it changed"*: an unknown storefront applies the cache **provisionally**
(`status` stays `loading`) so the warm-device benefit survives while the live read
confirms it. The check runs off `initRevenueCat`, **before** the offerings lookup, so
it fires even when that lookup cannot answer — which is the state that made this last
thirty days instead of one second. Cache key bumped to `v2`; a `v1` entry recorded no
region and cannot be validated, so it is deleted rather than trusted.

**Durable lesson.** A docblock that states an invariant is a claim, not a mechanism.
This one was written when the field was *added* to the write path, and nothing ever
read it. If an invariant is worth writing down, it is worth a test — the test is what
makes the sentence true.

---

## 217. A guardrail doing its job, on config that could never have passed it — four days of impossible production builds (2026-08-25)

**Class: a test that pins a value instead of the property the value is for.**

**Symptom.** `eas build --platform all --profile production` from `v2.8.13`.
Both platforms ERRORED after 30 seconds with:

> Unknown error. See logs of the Read app config build phase for more information.

That message names no cause. The build log did:

```
[app.config] production android has ads enabled but is still on Google's test
ad unit "ca-app-pub-3940256099942544/9214589741" — it would serve "Test Ad"
creatives to real users and earn nothing. Set ADMOB_BANNER_UNIT_ANDROID in the
EAS production environment, or ALLOW_TEST_ADS_IN_PRODUCTION=1 to ship it that
way on purpose.
  at assertAdsConfigIsShippable (app.config.js:219:13)
```

**Mechanism.** #290 committed two things that cannot coexist:

- `eas.json` → `build.production.env.ADS_ENABLED = "true"`, and
- `app.config.js` → `assertAdsConfigIsShippable()`, which throws when a
  production build has ads enabled while still on Google's demo publisher.

The real ad unit ids that would satisfy it live in exactly one place — the EAS
*production* environment — and were never set. `eas env:list --environment
production` shows seven variables; no `ADMOB_*` among them. Nor could they be:
app.json still carries `ca-app-pub-0000000000000000~0000000000` as the AdMob app
id on both platforms, so **no real ad could serve under any flag**. The flag was
pure cost.

The guard is correct and stays. Serving test creatives to real users earns
nothing and looks broken; the assertion is the only thing standing between that
and a store release.

**Why four days.** #290 merged *after* 2.8.12 was built. No store build was
attempted between that merge and this one, so the first build to touch the new
config was the one that failed. Nothing else exercises "Read app config" — not
`npm test`, not the local `expo start` path, and CI is billing-blocked anyway.

**Why the tests were green the whole time.** `adsConfig.test.js` had this:

```js
if (name === "production") expect(v).toBe("true");
```

It pinned the FLAG. It said nothing about whether a build carrying that flag
could start. Both statements sound like "ads are configured for production";
only one of them is about anything a user or a build ever encounters.

**Fix.**

- `ADS_ENABLED` removed from the production profile. **Not** worked around:
  `ALLOW_TEST_ADS_IN_PRODUCTION=1` exists and would have made the build pass,
  by shipping test creatives to real users. Shipping dark is what #290's own
  title says it intended.
- The flag assertion is replaced with the invariant that actually holds — ads
  are enabled on production **only once there is a real AdMob app id** — so the
  day a real account is wired, the test flips on its own and starts *requiring*
  the flag again. A test that must be remembered is a test that will not be.
- `easBuildProfiles.test.js` now asks the question nothing was asking: *given
  exactly what this repo commits, does "Read app config" succeed?* Every
  committed profile is read on both platforms through the real `app.config.js`,
  with EAS-environment values supplied as shape-correct stand-ins so the scope
  is what the REPO commits (an operator's missing secret is a different problem
  with its own assertions). Watched to fail: restoring the flag reddens 4 of 61.

**Cost.** `v2.8.13` was tagged and its GitHub release published before the build
was attempted, so the tag now points at a tree that can never produce an
artifact. Tags are never moved, so it was rolled forward to **2.8.14 /
buildNumber 34**, and the 2.8.13 release notes were edited to say plainly that
no artifact exists for it. One version number, spent.

**Durable lessons.**

1. **Assert the property, not the value.** `expect(flag).toBe("true")` cannot
   fail when the flag is wrong for the situation — it can only fail when
   somebody changes it. The invariant here was never "the flag is true"; it was
   "ads are on only when they can serve".
2. **A build guard is not a test.** `assertAdsConfigIsShippable` was written,
   correct, and unreachable from the suite. A guard that only fires in a build
   container fires for the first time at the worst possible moment.
3. **Config merged is not config exercised.** Between a merge and the next store
   build there can be days in which committed configuration is unbuildable and
   completely silent. If a file is only read by a build, something in CI has to
   read it too.
4. **"Unknown error" from EAS means read the log file, not the summary.** The
   phase name in the summary ("Read app config") is the only clue the API gives;
   the actual message is in `logFiles[0]`, gzip-encoded.

### 217b — and behind it, a second one: the ads SDK the toolchain cannot read

Removing the flag got the build past "Read app config". It then died in Gradle:

```
e: …/play-services-ads-25.4.0-api.jar!/META-INF/…kotlin_module
   Module was compiled with an incompatible version of Kotlin. The binary
   version of its metadata is 2.3.0, expected version is 2.1.0.      (× 19)
> Task :react-native-google-mobile-ads:compileReleaseKotlin FAILED
```

`react-native-google-mobile-ads@16.5.0` hardcodes `play-services-ads:25.4.0` in
its **own** `package.json` (`sdkVersions.android.googleMobileAds`) and reads it
from there in its `build.gradle` — there is no Gradle property to override it.
Google built that artifact with a Kotlin 2.3 compiler; Expo 55 pins Kotlin
2.1.20; Kotlin metadata is **forward-incompatible** (a 2.3 compiler reads 2.1
fine, never the reverse).

The ads memory had already carried this as an open risk — *"Unverified: that
`react-native-google-mobile-ads@16.5.0` builds under Expo 55 prebuild"* — with a
fallback ladder of 16.4.0 → 16.3.4. **The ladder would not have worked**, and
that is worth knowing before the next time someone reaches for it.

**How the version was actually chosen.** Not by trying builds. The Kotlin
metadata version sits in the first four big-endian int32s of any
`META-INF/*.kotlin_module` inside the AAR's `classes.jar` — `[count, major,
minor, patch]`. Downloading four AARs from `dl.google.com/dl/android/maven2` and
reading that header answered it in two minutes and zero build minutes:

| `play-services-ads` | Kotlin metadata | |
| --- | --- | --- |
| 25.4.0 | 2.3.0 | what 16.5.0 wants — too new |
| 25.0.0 | **2.2.0** | still too new — so 16.3.4 (which pins 25.0.0) would have failed identically |
| 24.6.0 | 2.1.0 | ← pinned; also exactly what the library shipped with at 16.0.0 |
| 24.5.0 | 2.1.0 | |

**Fix.** `plugins/withAdsSdkKotlinPin.js` — a `resolutionStrategy.force` on
`com.google.android.gms:play-services-ads:24.6.0`, applied to
`android/build.gradle`.

Pinned rather than raising `kotlinVersion` through `expo-build-properties`
(which does support it): that recompiles **every** Expo and React Native module
under a compiler two minors ahead of the one Expo 55 ships and tests against — a
large blast radius to accept for a dependency this app never calls. Ads are
dark, and `AdBanner` returns `null`.

`user-messaging-platform` is deliberately untouched: 4.0.0 carries no Kotlin
metadata at all (pure Java) and compiled cleanly in the failing build. Pinning
it too would be change without cause.

**iOS was never affected** — no Kotlin — and 2.8.14 (34) reached App Store
Connect from the unmodified tree before this landed.

**Durable lessons.**

5. **"Unverified" in a note is a liability with a due date.** The ads memory said
   in plain words that this library had never been built under Expo 55. It was
   merged anyway, and the bill arrived at the worst moment — mid-release, on a
   critical auth fix.
6. **You can read a dependency's compatibility without building it.** Four
   `curl`s and a 16-byte header beat four EAS builds, and the answer is exact
   rather than inferred from a pass/fail.
7. **A library that hardcodes its own transitive versions has no override.**
   `react-native-google-mobile-ads` reads the SDK version from its own
   package.json, so the only levers are the npm version or a Gradle
   `resolutionStrategy`. Check which levers exist *before* planning a fix around
   one that does not.

---

## 218. Three rounds spent fixing a display that was already right — nobody ever asked the store what it said (2026-08-25)

- Date: 2026-08-25 · PR: TBD · Area: mobile
- Symptom: "the prices still show in USD on iOS." Reported three separate times
  across three fixes. Android correct throughout.

**Read [`Technical/iOS_Store_Pricing_Diagnosis.md`](../Technical/iOS_Store_Pricing_Diagnosis.md)
before touching any pricing code.** It carries the evidence, the per-build table
and the console steps. This entry records the *process* failure, which is the
part that generalises.

**Root cause of the report.** The prices displayed are the STORE's own, and the
store is quoting the wrong ones. iOS shows **$1.99 / $3.99 / $6.99** for the
three packs. The bundled catalog says `$3 / $5 / $10`; the live remote catalog
(`GET /api/v1/pricing.json`, checked 2026-08-25) says `CA$3 / CA$5 / CA$10`.
**1.99 exists in neither.** A fallback can only render a value it has, so the
number came from StoreKit via RevenueCat's `priceString` — which means the
offering resolves fine on a real device and the client is doing exactly its job.
**The prices configured in App Store Connect are not the intended ones.** That
is console work, and it is why three rounds of client fixes changed nothing.

A SEPARATE condition, easily confused with it: on Apple's own review devices
(geo Cupertino, RC user `$RCAnonymousID:…`, nobody signed in) the offering does
not resolve at all —

> `🍎‼️ Error fetching offerings … None of the products registered in the
> RevenueCat dashboard could be fetched from App Store Connect`

— which is the expected shape for a device with no App Store account, and means
**App Review sees no prices at all**. It is not evidence the products are
unservable in general; the paragraph above proves they are served.

⚠️ **The first version of this entry led with the review-device error as THE
cause.** That was an over-generalisation from one breadcrumb, corrected the same
day when the actual figures came back as 1.99/3.99/6.99. Same mistake as the one
this entry is about, one level up: a single piece of evidence was read as the
whole picture instead of as one device's situation.

**The one real client defect it did surface — which is NOT the reported symptom.** `storePrices.js` applies a cached
price *provisionally* when `getStorefront()` cannot name a country — right, since
"we don't know" must not read as "it changed". But when the retry budget ran out:

```js
_status = Object.keys(_prices).length ? "ready" : "unavailable";
```

Any non-empty map became the final answer, **including the provisional one**. On
iOS the live read fails every time, so the unverified cache was promoted to
`ready` and stood for its full 30-day life. Deleting the account and re-creating
it in another country does not clear AsyncStorage — so the one remedy a user
would try never touched it. That is why "the account has been dropped and
recreated on canada and still the same issue".

**Fix.** A `_confirmed` flag: a price is publishable only if it came off the store
this session, or came from a cache the live storefront agreed with. Anything else
is dropped when the budget is spent and the surface falls back to its skeleton —
what the module header already said it preferred. Plus a **Store pricing** group
in Admin → Billing diagnostic reporting `source` / `country` / `currencyCode` /
resolved `priceString` / the store's own error, in plain sentences.

- Files: `src/services/storePrices.js` (`_confirmed`, `_lastError`, the
  budget-spent branch in `_attemptOnce`), `src/screens/AdminBillingDiagnosticScreen.js`.
- Detect next time: **Admin → Billing diagnostic → Store pricing.** "Read live
  from the store just now" vs "Remembered from a previous launch, and NOT yet
  re-checked" vs "Nothing loaded" separates the three situations that are
  indistinguishable from a screenshot of a paywall.
- Prevent: `__tests__/storePrices.test.js` → `describe("price confidence")` pins
  that an unconfirmed cache is dropped rather than published, and that a
  confirmed one survives a failing live read.
  `__tests__/adminBillingDiagnosticStorePricing.test.js` pins that each of the
  three situations reads back as a different plain-English sentence.

**Durable lessons.**

1. **A bug report names a symptom, not a layer.** "Shows USD" was read as "the
   display is wrong" three times running. The display had been right since
   2.8.11. Before fixing a rendering, read back what the thing being rendered
   actually contained.
2. **If the app cannot report what an external service answered, every diagnosis
   is a guess.** The whole loop was possible because no surface anywhere showed
   `currencyCode`, `source` or the offerings error — all three were already in
   memory, none were reachable. The diagnostic cost less than any one of the
   three fix rounds. Same family as
   [`health-check-conjunction-rule`](#): report what you measured.
3. **"Provisional" is not a state a system can be left in.** Something must
   eventually settle it, and if the settling code does not know the difference
   between *verified* and *merely present*, it will settle on the wrong one. The
   `?:` that promoted any non-empty map is that mistake in one line.
4. **A remedy that does not clear local storage has not reset anything.**
   Deleting and re-creating an account is the user's idea of a factory reset; it
   does not touch AsyncStorage. Any cache with a multi-week life needs an
   invalidation path that does not depend on the user guessing right.

---

## 219. A store parser that passed every test and got all nine real receipts wrong (2026-08-25)

- **Date:** 2026-08-25 · **PR:** _(this change)_ · **Area:** mobile
- **Symptom:** Scanning any bestbuy.ca order receipt produced **a receipt with
  zero items** — the scan succeeds, a credit is spent, the user is shown an
  empty basket and nothing can ever be price-watched. A photographed in-store
  slip produced **one item called "Item #169"** holding a $3,699.99 television's
  price, dated **a week after the purchase**, and never reconciled.

  The parser's own unit suite was green throughout: 1,070 tests across the
  synthetic layouts, all passing, on a parser that could not read a single real
  receipt.

**Root cause — four independent faults, one shared origin.**

The parser was built against *layouts written from a real receipt*, which are
what a receipt **looks like**, not what **Vision returns for a photograph of
one**. Every fault below is a place where those two differ:

1. **The online item table does not exist in the flat OCR.** Vision streams a
   two-column invoice in a reading order belonging to neither column — `Qty.` /
   `1` / `SKU` / `Product Description` / `10158121` / the product name, with the
   price column forty lines further down under its own `Total` header. No line
   carries a name AND a price, so the line-based engine extracted nothing. The
   word geometry rebuilds the row perfectly; the online path was the one path
   that never received the annotation, on the reasoning that an order summary is
   "generated text, not a photograph of fading paper". True of the PDF, not of
   the OCR of it.
2. **`Product Total` read as the grand total.** Best Buy prints the merchandise
   sum at the TOP of an order receipt, so it is the first `total` the scan meets;
   `Order Total` is eight rows below it. `printedTotal` — the anchor every
   validation is checked against — came back as the pre-tax subtotal, failing a
   correct parse. In the flat OCR it is worse: the item table's `Total` COLUMN
   HEADER sits immediately above the first item price, so the receipt's stated
   value of the purchase was **one product's price**.
3. **`29-Dec-2023` matched no date pattern**, and the whole-text scan takes the
   first date it finds anywhere. On the in-store slip that is `Delivery Date:
   2025-12-05`, not `BUS DATE-11/28/2025` — a purchase dated **a week late**,
   silently shortening the 30-day price-adjustment window the user scanned the
   receipt to protect.
4. **The Best Buy store-number pattern matched the "s" ending any word.** The
   word reliably preceding a number on an order receipt is the customer's
   surname above their shipping address: `Maxim Lucas / 401 9E Av` reported
   **store 401**. Every online receipt was attributed to a Best Buy location
   whose number is the house number it shipped to.

**Plus the paper itself.** Best Buy's thermal stock is thin enough that Vision
transcribes the returns policy printed on the BACK, interleaved with the front at
the same y:

```
169 ) sparis.nu uo quater nu é asldizzimbs      <- the reverse of the slip
Samsung 85LS03FW PRO stall 6 ( e $3,699.99 lamexe
19204882upitilog to innoo alistab Hel auoj te   <- SKU fused to a mirror word
```

The price is no longer last on its line, so no item pattern matches it; the SKU
is fused to a word, so `extractSku` cannot see it. What the parser took instead
was the bleed line above, whose leading `169` passed as a SKU and whose garbage
name became `Item #169`. `isBestBuySku` — the 7-8 digit width check written
specifically to prevent this — **existed, was exported, was unit-tested, and was
never called by anything**.

**And a confidently-wrong glyph.** The tax line reads `TAX HST 13.00% of
$3,699.99  $461.00`. 13% of 3,699.99 is **481.00**, and 3,699.99 + 481.00 is
4,180.99 — the TOTAL printed on the next line. Vision reported **0.986
confidence** on `461.00`, so the faint-print signal cannot see it: this is the
confident-misread case, and only the receipt's own arithmetic exposes it.

**Fix.**

- The online path takes the annotation and rebuilds the item table from
  geometry (`extractBestBuyOnlineItemRows`), re-emitting each row SKU-first,
  folding wrapped descriptions into the item they belong to, and stopping at the
  end of the first table so the **Gift Receipt page — which reprints every item
  WITHOUT prices** — can never duplicate the basket. Only the item rows are
  replaced; totals, tax and date still come from `rawText`, where they already
  read correctly.
- `trimBleedThrough` cuts each item row at its last printed amount (nothing
  prints right of the price column but a tax flag); `attachTrailingSkuRows`
  attaches a 7-8 digit SKU printed on its own row under the item, which is what
  finally wires `isBestBuySku` into the parse.
- `repairTaxFromPrintedRate` recomputes the tax from the rate and base the
  receipt printed, adopting it **only when the stated base is the basket we
  parsed AND the result lands on the printed total** — the same "LAND, never
  merely closer" bar `faintPrintRepair`'s Tier 2 holds itself to.
- Shared: an explicit purchase-date label (`BUS DATE`, `Order Date`, ...) now
  outranks any other date on the page; `D-Mon-YYYY` is parsed; `Product Total`
  joins `merchandise` as a subtotal alias; the bare `number` reject was narrowed
  to `total number|count` so a row carrying an invoice number in its other column
  is not discarded; the store-number pattern is anchored to a word boundary.

- **Files:** `src/services/bestBuyReceiptParser.js`
  (`parseBestBuyOnlineReceipt`, `extractBestBuyOnlineItemRows`,
  `joinCurrencySpacing`, `trimBleedThrough`, `attachTrailingSkuRows`,
  `repairTaxFromPrintedRate`), `src/services/receiptParsingShared.js`
  (`extractDate`, `extractPrintedTotal`, `extractWarehouseId`).
- **Detect next time:** `npm run parse:receipts -- bestbuy` prints one table per
  captured receipt — items, SKUs, `items/tax/total/printed`, `reconciled`, date,
  store, order number. Every line of it is comparable against the paper in
  seconds. `computeParseConfidence` reporting anything below 1.0 is the same
  signal from inside the app.
- **Prevent:** `__tests__/bestBuyReceiptParser.realocr.test.js` pins all nine
  captures field by field — including `storeNumber: null` and `orderNumber:
  null` where the receipt genuinely has none — and fails outright if a fixture
  is added without its ground truth. Coverage floors for
  `bestBuyReceiptParser.js` and `faintPrintRepair.js` added to `jest.config.js`;
  the pipeline's per-file guarantee had a hole in exactly its newest code.

**Durable lessons.**

1. **A layout written from a receipt is not the receipt.** Every synthetic case
   in this parser's suite is a faithful transcription of what a Best Buy slip
   says, and all of them were green while the parser could not read one real
   capture. The transcription silently supplies what OCR destroys: reading
   order, column association, and the absence of the other side of the paper.
   Synthetic layouts pin RULES; only captures show whether the rules apply.
2. **An exported, tested guard that nothing calls is not a guard.** `isBestBuySku`
   had a docstring naming the exact bug it prevents, a unit test proving it
   returns false for a 3-digit fragment, and no call site. The phantom row it
   describes was in the first photograph put through the parser. Grep for the
   call, not the definition.
3. **A wrong anchor is worse than no anchor.** `printedTotal` is what every
   downstream check measures the parse against. Reading a subtotal into it fails
   correct parses and would pass a basket that stopped after the first item —
   the exact failure it exists to catch.
4. **Confidence is a signal, not a verdict.** `461.00` came back at 0.986. The
   receipt's own arithmetic said otherwise. When a document states a
   self-check — a rate, a base, a subtotal — that check outranks the OCR's
   opinion of its own reading, and it is the only thing that catches a confident
   misread.
5. **A field that is null on purpose has to be pinned as null.** Nothing failed
   when `warehouseId` was a shipping address's street number, because no test
   asserted what it should be when there is no store. Pin the absences.

## 220. A binary that promised tracking it could not do — App Store Connect refused to open the review (2026-08-26)

- **Date:** 2026-08-26 · **PR:** _(this change)_ · **Area:** mobile (iOS build config)
- **Symptom:** Replacing the 2.8.8 submission with the newer build in App Store
  Connect, "Add for Review" refuses to start:

  > **Unable to Add for Review** — Your app contains
  > `NSUserTrackingUsageDescription`, indicating that it may request permission
  > to track users. To submit for review, update your App Privacy response to
  > indicate that data collected from this app will be used for tracking
  > purposes, or update your app binary and upload a new build.

  Nothing in the app had changed in that area; the block is a property of every
  binary built since the AdMob work landed.

- **Root cause:** the lab lane (PR #293/#295, `labEnabled`) keeps the **AdMob
  SDK** out of production binaries — `app.config.js` strips `ADS_ONLY_PLUGINS`
  and `react-native.config.js` nulls autolinking. But the *tracking
  declarations* were never put on that lane. They were static `app.json`
  config, so they shipped on **every** lane:

  - `ios.infoPlist.NSUserTrackingUsageDescription` — the ATT purpose string.
  - `ios.privacyManifests` — `NSPrivacyTracking: true`, five tracking domains,
    and four collected data types marked `…Tracking: true` with a
    `ThirdPartyAdvertising` purpose.

  So the shipped binary declared "I may track you" while containing nothing that
  could: no ads SDK, no IDFA read, no reachable ATT prompt (`adsService.
  ensureReady()` is only called from a banner mount, and `isAdsBuildEnabled()`
  requires `adsEnabled && labEnabled`). Apple's automated check reads the
  Info.plist key, sees the App Privacy answers say "no tracking", and stops the
  submission on the contradiction.

- **The fix that would have been wrong:** answering App Store Connect instead —
  ticking "used for tracking purposes" in App Privacy. That is a *false
  statement about the binary*: it promises a reviewer an ATT prompt and an ad
  experience that do not exist in the build, which is a Guideline 5.1.1 / 5.1.2
  rejection one cycle later, after another 10-day queue wait. **When the store
  and the binary disagree, fix whichever one is lying.** Here it was the binary.

- **Fix:** `plugins/withIosAdsPrivacyLane.js` — a config plugin that puts the
  declarations on the same lane as the SDK.
  - Lane ON (`eas build --profile lab`): complete no-op. Every declaration
    survives, because an ads build legally *must* carry the ATT prompt.
  - Lane OFF (every production build): deletes the ATT purpose string from
    `Info.plist` **and** from the generated localized `InfoPlist.strings`, and
    rewrites the privacy manifest — `NSPrivacyTracking: false`, empty
    `NSPrivacyTrackingDomains`, no type left with `Tracking: true` or a
    ThirdPartyAdvertising purpose, and the ad-only `AdvertisingData` type
    removed entirely rather than downgraded (keeping it with `Tracking: false`
    would declare a collection that never happens — the same false statement
    pointed the other way). `DeviceID`, `CoarseLocation` and
    `ProductInteraction` stay, un-tracked: crash reports, the nearest-warehouse
    picker and Sentry analytics still collect them.

- **Two mechanics worth keeping:**
  1. The privacy manifest is mutated **in place**.
     `IOSConfig.PrivacyInfo.withPrivacyInfo` captures
     `config.ios.privacyManifests` by reference and reads it later, when its mod
     runs. Replacing the object would leave the generator writing the old,
     tracking-claiming one — and the binary would still be rejected with the
     unit tests still green.
  2. The ATT string is removed **both** from `config.ios.infoPlist` (so the base
     mod never merges it) **and** in a `withInfoPlist` mod (because a config
     delete cannot undo a key another plugin adds).

- **Files:** `plugins/withIosAdsPrivacyLane.js` (new), `app.json` (plugin
  registration), `__tests__/withIosAdsPrivacyLane.test.js` (new).

- **Detect next time:** `npx expo config --type introspect | grep -iE
  "NSUserTracking|NSPrivacyTracking|ThirdPartyAdvertising"`. On a production
  lane that must print `NSPrivacyTracking: false`, `NSPrivacyTrackingDomains:
  []` and nothing else. With `LAB_ENABLED=true APP_ENV=preview` it must print
  the opposite. (iOS `expo prebuild` cannot run on Windows; introspection can,
  and it resolves the real plugin pipeline.)

- **Prevent:** `__tests__/withIosAdsPrivacyLane.test.js` asserts both ends of
  the lane against the real `app.json` manifest, and that the plugin is **not**
  in `ADS_ONLY_PLUGINS` — adding it there would strip it from exactly the builds
  it exists to clean, and the rejection would return silently.

- **Still open (Android twin, not fixed here):**
  `com.google.android.gms.permission.AD_ID` is declared unconditionally in
  `app.json`, and `plugins/withAndroidPermissionCleanup.js` deliberately stopped
  removing it when ads landed. On the production lane the ads SDK is not linked,
  so that permission has no user — the same drift, on Play's data-safety form
  instead of Apple's. It is not blocking anything today; put it on the lane the
  next time the Android manifest is touched.

## 221. A test suite that had never run once, and the assertion shape that hid it (2026-08-26)

- **Date:** 2026-08-26 · **PR:** #303 · **Area:** mobile (tests)
- **Symptom:** `npm test` on a clean `main` reported `Test Suites: 1 failed`
  with `[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null` — a suite that
  had been merged eight days earlier and looked healthy in review.
- **Root cause, in two layers:**
  1. `adminBillingDiagnosticStorePricing.test.js` imports
     `AdminBillingDiagnosticScreen` → `ProfileKit` → `i18n.js`, and `i18n.js`
     imports AsyncStorage at **module scope**. Under jest-expo that native
     module is null, so the suite died at import. Every other screen suite
     mocks it; this one never did.
  2. With the import fixed, **6 of its 7 tests failed** — it had never passed
     anywhere. Its helper collected rendered strings with
     `tree.root.findAllByType(Text)` and then read `node.children`. But
     react-native's `Text` is a **composite** component: `findAllByType`
     returns the wrapper instance, whose only child is the *host* node — never
     the string. Every assertion was comparing against `""`.
- **What hid it:** the 7th test — the only one that passed — asserts an
  **absence** (`expect(lines).not.toContain(code)`). An empty render satisfies
  that trivially. **A test that only asserts what must NOT be there passes
  hardest when nothing is there at all.** Pair every `not.toContain` with a
  positive assertion in the same test, or it is a green light wired to nothing.
- **Fix:** mock AsyncStorage the way the other screen suites do, and walk
  `tree.toJSON()` instead — the JSON tree has no composite/host distinction, so
  it cannot be read wrong the same way. The screen itself was correct all along;
  no product code changed.
- **Verified NOT systemic:** ten other suites use `findAllByType(Text)`, and all
  ten read `n.props.children` — which *is* the string on a composite instance.
  Only this file read `.children`. Grep for `findAllByType(Text)` followed by
  `.children` (not `.props.children`) if it recurs.
- **Detect next time:** `npm test` locally when CI cannot run. GitHub Actions
  has been billing-blocked (jobs die in 3 s with zero steps), so **every PR
  merged during the block is unverified by definition** — #297 through #302
  went in that way.
- **Prevent:** the suite now passes 7/7 and is part of the 212-suite run.

## 222. Three Android production builds failed on an SDK the app does not use — and the pin meant to fix it made it worse (2026-08-26)

- **Date:** 2026-08-26 · **PR:** _(diagnosis only — the fix was already on `main`)_ · **Area:** mobile (Android build)
- **Symptom:** every Android production build since 2.8.13 **errored**:
  `EAS_BUILD_UNKNOWN_GRADLE_ERROR`, ~3–4 minutes in. 2.8.13 (vc 33), 2.8.14
  (vc 34) and 2.8.15 (vc 35) all failed; no Android artifact has been produced
  since 2.8.12. This was invisible from the repo — only `eas build:list` shows
  it.
- **Root cause:** `> Task :react-native-google-mobile-ads:compileReleaseKotlin
  FAILED`

  ```
  e: ReactNativeGoogleMobileAdsModule.kt:28:35 Unresolved reference 'AgeRestrictedTreatment'.
  e: ReactNativeGoogleMobileAdsModule.kt:70:28 Unresolved reference 'setAgeRestrictedTreatment'.
  ```

  `plugins/withAdsSdkKotlinPin.js` (#295) forces `play-services-ads:24.6.0`
  because 25.4.0 carries Kotlin metadata 2.3.0 that Expo 55's Kotlin 2.1.20
  cannot read. But `AgeRestrictedTreatment` is a **25.x API** the library's own
  Kotlin source calls. So the pin swapped a metadata error for an API error:
  **the build still fails, one layer further in.** The pin was merged and tagged
  without a build ever confirming it — the memory note claiming #295 fixed
  Android is wrong, and has been corrected.
- **What actually fixes it:** the lab lane, which landed later in **#300** —
  `react-native.config.js` nulls the SDK's autolinking and `app.config.js`
  strips its config plugin, so a production build never compiles it at all and
  the failing Gradle task does not exist. `v2.8.15` predates #300; **`v2.8.16`
  is the first tag that contains it**, and therefore the first Android
  production build expected to succeed since 2.8.12.
- **Still broken, knowingly:** `eas build --profile lab -p android` will hit
  this exact error, because the lab lane keeps both the pinned 24.6.0 *and* the
  library source that needs 25.x. Working on ads on Android means resolving that
  first — either a library version whose source matches 24.6.0, or an Expo/
  Kotlin combination that can read metadata 2.3.0. iOS is unaffected (no Kotlin).
- **Detect next time:** `eas build:list --json` before assuming a version
  shipped — a tag and a GitHub release prove a commit was *cut*, never that a
  binary was *produced*. Build logs are downloadable without the web UI:

  ```
  curl -s -X POST https://api.expo.dev/graphql -H "Authorization: Bearer $EXPO_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query":"query($id:ID!){builds{byId(buildId:$id){logFiles}}}","variables":{"id":"<build-id>"}}'
  ```

  The returned file is **brotli**-compressed NDJSON — `zlib.brotliDecompressSync`,
  then parse each line and read `.msg`.
- **Prevent:** `adsAutolinking.test.js` already pins that the plugin filter and
  the autolinking exclusion agree on every lane. What no test can cover is
  whether the SDK *compiles* when the lane is on; that needs a real `lab` build.

## 223. The purpose-string cleanup plugin has never actually removed anything (2026-08-26)

- **Date:** 2026-08-26 · **PR:** _(reported, not fixed — needs its own version)_ · **Area:** mobile (iOS build config)
- **Symptom:** none visible. `plugins/withIosPrivacyStringCleanup.js` exists to
  strip four iOS purpose strings PriceBack does not use, and its header even
  documents a PlistBuddy check that "prints no output". **It does not work.**
  Unpacking the shipped `.ipa` shows all four keys present:

  ```
  <key>NSMicrophoneUsageDescription</key>
  <string>Allow PriceBack to access your microphone</string>
  <key>NSFaceIDUsageDescription</key>
  <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
  <key>NSLocationAlwaysUsageDescription</key>
  ```

- **Confirmed pre-existing, not a regression:** the 2.8.14 artifact
  (`6a5f1a93`, the build already in App Store Connect) and the 2.8.16 artifact
  (`53b1304a`) carry the identical four keys. #301 changed neither.
- **Root cause (mechanism):** those keys are injected by *other* Expo plugins —
  `expo-camera` (microphone), `expo-secure-store` (FaceID), `expo-location`
  (always-location) — through `IOSConfig.Permissions.createPermissionsPlugin`.
  Expo evaluates the user's `plugins` array during `getConfig()`, **before**
  `withLegacyExpoPlugins` applies those module plugins, so the cleanup's
  `withInfoPlist` delete cannot outrank an injection that happens after it. A
  `withInfoPlist` mod that only *deletes* is not, by itself, authoritative.
- **Why the ATT strip in #301 DID work on the same mechanism:**
  `withIosAdsPrivacyLane` deletes the key from **`config.ios.infoPlist`** as
  well as in a mod, and nothing re-adds it once the ads plugin is stripped from
  the lane. Verified in the artifact: absent from `Info.plist` and from both
  `.lproj/InfoPlist.strings`, with `NSPrivacyTracking` `<false/>`.
- **The fix (when it is taken):** stop the injection instead of deleting after
  it. Expo's plugins accept an explicit opt-out:
  `["expo-camera", { microphonePermission: false }]`,
  `["expo-secure-store", { faceIDPermission: false }]`,
  `["expo-location", { locationAlwaysAndWhenInUsePermission: false,
  locationAlwaysPermission: false }]`. Then keep the cleanup plugin as a
  backstop, and assert the built plist, not the config.
- **Risk while unfixed:** a Guideline 5.1.1 question — "we could not find the
  feature that uses the microphone". It has survived two submissions to Apple's
  automated checks already, so it is a reviewer risk, not a submission blocker.
- **Detect next time — the only check that counts.** Config introspection
  (`npx expo config --type introspect`) reads the *inputs*; it said the cleanup
  was fine. Read the **artifact**:

  ```
  curl -sL -o app.ipa "<applicationArchiveUrl from the build's artifacts>"
  unzip -qo app.ipa -d ipa
  grep -o "<key>NS[A-Za-z]*UsageDescription</key>" ipa/Payload/*.app/Info.plist | sort -u
  grep -A1 "NSPrivacyTracking</key>" ipa/Payload/*.app/PrivacyInfo.xcprivacy
  ```

  The `.ipa` is a plain zip and `Info.plist` inside it is XML on EAS builds, so
  no macOS tooling is needed — this runs on Windows.

## 224. The autolinking exclusion the build never read — four Android releases lost to it (2026-08-26)

- **Date:** 2026-08-26 · **PR:** #304 · **Area:** mobile (Android build)
- **Symptom:** the same failure as Bugs #222, one layer deeper. After #300 added
  the lane's autolinking half, 2.8.16 was expected to be the first Android build
  to succeed since 2.8.12. **It failed identically**, on
  `:react-native-google-mobile-ads:compileReleaseKotlin`. Four consecutive
  versions — 2.8.13, 2.8.14, 2.8.15, 2.8.16 — and **no Android artifact for any
  of them**.
- **Root cause:** `react-native.config.js` declares
  `dependencies["react-native-google-mobile-ads"] = { platforms: { android: null,
  ios: null } }`. That is the **Community CLI's** exclusion mechanism, and
  **Expo 55 does not use the Community CLI**. `expo-modules-autolinking` loads
  the file, but the override does not survive `resolveReactNativeModule()`.
  Measured in one command, locally, in seconds:

  ```
  npx expo-modules-autolinking react-native-config --platform android --json
  → 15 modules, react-native-google-mobile-ads AMONG THEM
  ```

- **Fix:** `expo.autolinking.exclude` in **package.json**.
  `resolveReactNativeModule()` checks that set FIRST
  (`if (excludeNames.has(resolution.name)) return null;`) — unconditional, before
  any config merging. Same command afterwards: **14 modules, ads gone**, on both
  platforms.
- **Why nobody caught it:** `adsAutolinking.test.js` was green through all four
  failures, because it asserted the *contents of a file the build never
  consults*. Its own header called the last assertion "load-bearing". It wasn't
  bearing anything. **This is Bugs #221's lesson one layer down: a test can be
  green, thorough, well-commented and still wired to nothing.** The test now
  asserts the package.json exclusion, that both files name the same set, and
  that the package remains a *dependency* (excluded from LINKING, not removed —
  the JS half is a guarded dynamic import and jest maps it to a stub).
- **Known consequence:** package.json cannot be lane-conditional, so the SDK is
  excluded on the **lab lane** too. That costs nothing today — a lab Android
  build cannot compile it either (Bugs #222: the library calls
  `AgeRestrictedTreatment`, a play-services-ads 25.x API the 24.6.0 pin lacks).
  Restoring lab ads means resolving that version conflict and removing the
  package.json entry in the same change.
- **Detect next time — run the resolver, don't read the config:**

  ```
  npx expo-modules-autolinking react-native-config --platform android --json
  ```

  It takes seconds locally and answers exactly what the Gradle settings plugin
  will see. **A config file is an input; only the resolver's output is the
  answer.** Same family as Bugs #223 (`withIosPrivacyStringCleanup` removing
  nothing) and #221 — three findings in one day where the artifact disagreed
  with the configuration that claimed to shape it.


## 225. The Play upload refused: an advertising-ID permission with no advertising SDK behind it (2026-08-27)

**Symptom.** `eas submit -p android` uploaded the 2.8.17 `.aab`, then failed five
identical retries at the track-update step:

```
Google Api Error: Invalid request - This release includes the
com.google.android.gms.permission.AD_ID permission but your declaration on Play
Console says your app doesn't use advertising ID. You must update your
advertising ID declaration.
```

**Root cause.** Exactly the Android twin of #220, and it was written down as an
open item at the end of #224 rather than fixed. The lab lane keeps the AdMob SDK
out of every production binary (#300, #304), but the permission that SDK
justifies was declared unconditionally, from two directions at once:

- `app.json` → `android.permissions` lists it statically, on every lane.
- `expo-tracking-transparency`'s autolinked plugin calls
  `AndroidConfig.Permissions.withPermissions(['…AD_ID'])` on every build, and it
  is evaluated AFTER the `plugins` array — so deleting our own declaration
  cannot survive it.

The shipped app has no ads SDK, never reads the advertising ID, and the Play
Console declaration saying so is **correct**. The binary was the thing lying.

**The tempting fix is the wrong side.** Ticking "uses advertising ID" in Play
Console clears the upload in one click and makes a false declaration — and drags
the Data Safety form ("Device or other IDs", collected AND shared for
Advertising) along with it. Same call as #220 made on iOS: when the store and the
binary disagree, ask which one is lying, then fix that one.

**Fix.** `plugins/withAndroidAdsPrivacyLane.js` — the Android mirror of
`withIosAdsPrivacyLane`. Lane ON (`labEnabled === true`): no-op. Lane OFF (every
production build): removes AD_ID from `config.android.permissions` (belt) and
marks it `tools:node="remove"` in the manifest (braces).

The braces half is the one that holds, for two reasons:

- Expo's `isPermissionAlreadyRequested` matches on `android:name` alone, so a
  stub already carrying `tools:node="remove"` counts as present and
  expo-tracking-transparency's later mod becomes a no-op. In the opposite mod
  order the stub simply flips the plain entry it finds. Either ordering ends with
  one entry, marked for removal.
- It also covers the origin the belt can never reach: Google Play Services AARs
  declare AD_ID in their own manifests.

**AD_ID must NOT go into `withAndroidPermissionCleanup`'s PERMISSIONS_TO_REMOVE.**
That list is lane-blind, and stripping the permission on the LAB lane is a silent
revenue bug — on API 33+ Play Services returns a zeroed advertising ID when it is
absent, every request degrades to non-personalized, and nothing crashes or fails
to build.

**Detect next time — and the trap that nearly hid it.**
`npx expo config --type introspect` is not evidence here on two counts: it reads
inputs rather than merged output, and it takes a pre-existing
`android/app/src/main/AndroidManifest.xml` as its base. A stale prebuild from the
pre-ads era (when the cleanup plugin still stripped AD_ID) showed the permission
already removed on **both** lanes — which reads as the new plugin working when it
is only an old file on disk. Read the artifact:

```
unzip -p app.aab base/manifest/AndroidManifest.xml | strings | grep AD_ID
→ production: (no output)
→ lab:        com.google.android.gms.permission.AD_ID
```

**Fourth finding in the same family in two days** (#221, #223, #224, and now this
one): a configuration file is an input; only the resolver output or the unpacked
artifact is the answer. And the generalisable half: **a lane that strips a
capability must strip every declaration that capability justified** — iOS lost
its ATT string and privacy manifest in #220, Android its permission here.

## 226. Test runs left rows on a live database, findable only by a heuristic (2026-08-30)

**Symptom.** The only way to find leftover test users on the shared Supabase dev
project was `SELECT * FROM priceback.users WHERE postal_code IS NULL`. Cleanup
was ~60 per-file `after()` hooks, each `.catch(() => {})`-swallowing its own
deletes; a crashed test, a new table, or a missing hook left residue with
nothing that reliably identified it as test data. This is the same class of
problem as the 2026-06 incident where the suite ran against **production**
(purged 2026-08-18, `Operations/Production_Test_Data_Purge_2026-08-18.md`) — the
prod path is now hard-guarded (`db/client.js assertNotProductionUnderTest`), but
the dev DB had no equivalent hygiene and manual verification scripts still touch
prod.

**Root cause.** No enforced convention for tagging test data. Identifiers were
ad-hoc (`test-`, `seed-`, `google-sub-…`, `admincr-`, raw names), and rows in
`products` / `price_points` / `warehouses` / `devices` / `topup_refs` /
`tag_scan_reviews` / `auth_outcomes` carry no user FK, so the `deleteAccount`
cascade never reached them.

**Fix.**
- **One reserved marker per identifier**, in `tests/helpers/uniq.js`: text ids
  start `qa-` (`testSub`/`testDeviceId`/`testReceiptId`/`testSourceRef`/
  `testTopupRef`), user emails use `@qa.priceback.test`, and the pre-existing
  reserved SKU (`^[5-9]\d{7}$`) and warehouse (`^9\d{3}$`) bands are folded into
  the same contract. `uniq.js` is the single source of the matcher constants.
- **`tests/helpers/purgeTestData.js`** — one FK-safe ordered sweep of every
  marked row. `products` is only deleted when `barcode IS NULL` (the
  load-bearing guard from the 2026-08-18 purge — an unqualified band delete
  takes real catalog rows).
- **`scripts/run-suite.js`** — `npm test` / `test:fast` now wrap `node:test` and
  run the purge clean-slate before and unconditionally after every run (pass,
  fail, or crash). `node:test` has no global teardown and CI must run bare
  `npm test`, so the wrapper is the only place this can live.
- **`scripts/purge-test-data.js`** — standalone CLI (`--dry-run` supported), no
  prod guard by design: the deliberate tool for cleaning any DB, replacing the
  `postal_code IS NULL` query.
- Transitional: the sweep also matches the current `test-` / `seed-` / `pdwin-`
  prefixes and the `@example.com` / `@test.local` domains, so it is effective
  before the ~60 files are migrated onto the `qa-` helpers (incremental).

**Guard.** `tests/purgeTestData.test.js` — one half proves every table is swept,
the other seeds a real-shaped row of each kind (unprefixed sub, real email
domain, barcoded product in the SKU band, non-`9xxx` warehouse) and proves the
sweep leaves them untouched. `__tests__/ciParity.test.js` updated: the runner
params (`--env-file` order, `--test-concurrency`) moved into `run-suite.js`, not
removed — the "no workflow-side params" invariant is unchanged.

**Detect next time.** After a CI backend-db run:
`SELECT count(*) FROM priceback.users WHERE sub LIKE 'qa-%' OR sub LIKE 'test-%'`
→ expect `0`. Same for the band SKUs / `9xxx` warehouses / `qa-` devices.

## 227. Two guards that could not fire, found by turning ads on for the first time (2026-08-31)

- **Date:** 2026-08-31 · **Branch:** `feat/ads-buildable-on-lab-lane` · **Area:**
  mobile (ads config + banner rendering)
- **Context:** closing #224's open item — the SDK was excluded from the lab lane
  as well as production, so ads could not be built or tested anywhere. Fixing
  that meant enabling ads for the first time, and two things that had never been
  exercised turned out not to work.

### (a) A banner size the SDK does not define

- **Symptom (would have been):** a permanently blank ad slot. No crash, no
  warning, no `onAdFailedToLoad`, nothing in Sentry, nothing in a build log —
  and release-only, because nothing renders a real ad view in debug or in jest.
- **Root cause:** `AdBanner.js` asked for
  `BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER`, falling back to the **literal
  string** `"LARGE_ANCHORED_ADAPTIVE_BANNER"`. Breaking the Kotlin deadlock
  meant pinning the library back to **16.0.0**, and 16.0.0 does not export that
  name — it arrives later, as the replacement for the now-`@deprecated`
  `ANCHORED_ADAPTIVE_BANNER`. So the fallback fired and handed the native side a
  size string it does not recognise. `BannerAd` requests nothing for an unknown
  size; it does not error.
- **Why the test suite was no help:** `__mocks__/react-native-google-mobile-ads.js`
  exported `LARGE_ANCHORED_ADAPTIVE_BANNER`. The mock was **richer than the real
  module**, so the component picked the modern name under jest and the deprecated
  path was never taken. The assertion `expect(props.size).toBe(
  "LARGE_ANCHORED_ADAPTIVE_BANNER")` passed while describing a device behaviour
  that could not happen.
- **Fix:** `resolveBannerSize()` — an exported, directly-tested chain (modern →
  deprecated → a string that is still a real enum member). The mock now mirrors
  the pinned SDK's enum exactly, with a comment saying to re-read
  `lib/module/BannerAdSize.js` on any upgrade. The clinching assertion is
  `expect(Object.values(gma.BannerAdSize)).toContain(resolveBannerSize(...))` —
  whatever is chosen must **exist**, which no amount of pinning one name does.
- **Durable lesson:** **a mock that exports more than the real module is a false
  pass, not a convenience.** #224 was a test asserting a file the build never
  reads; this is a test asserting an API the SDK does not have. Same family.

### (b) A comparison that is always false

- **Symptom (would have been):** a production build shipping Google's *sample*
  AdMob app id with ads enabled — initializing cleanly, filling 100%, and
  crediting every impression to Google's demo account instead of ours. The guard
  written to refuse exactly that would have permitted it.
- **Root cause:** `publisherOf(appId) === TEST_PUBLISHER`. `publisherOf()`
  returns the **bare digits** (`3940256099942544`); `TEST_PUBLISHER` is the
  **prefixed** string (`ca-app-pub-3940256099942544`). The expression compiles,
  type-checks, reads correctly to a reviewer, and can never be true. `isTestUnit`
  next door avoids this only by string-prefix matching, and it hardcodes the `/`
  separator, so it cannot answer for an **app** id (`~`) at all.
- **How it surfaced:** not by review. The new assertion
  `expect(isTestPublisher(androidAppId)).toBe(true)` failed with
  `Expected: "ca-app-pub-3940256099942544" / Received: "3940256099942544"` — and
  the *second* failure in the same run was the giveaway: a test asserting
  production must NOT set `ADS_ENABLED` flipped to demanding it, because its
  `notOurs` condition used the same broken comparison. That is **Bugs #217
  reinstated through the test written to prevent it.**
- **Fix:** `isTestPublisher(id)` in `config/profiles/admob.js`, handling app ids
  and unit ids alike, with its own tests — including that it agrees with
  `isTestUnit` where both apply and covers the `~` case `isTestUnit`
  structurally cannot.
- **Durable lesson:** when two values are *supposed* to be the same thing in
  different shapes (prefixed vs bare, id vs slug), **an `===` between them is a
  bug waiting for a test**. Give the comparison a named function and test the
  function, or the check silently never fires. A guard that cannot fail is
  indistinguishable from a guard that passes.

### Detect next time

A guard added but never exercised is the common thread. Before trusting a new
build-time assertion, **fire it by hand** and read the message:

```
EAS_BUILD=true EAS_BUILD_PLATFORM=android APP_ENV=production ADS_ENABLED=true \
  ADMOB_BANNER_UNIT_ANDROID=ca-app-pub-1234567890123456/2222222222 \
  node -e "try{require('./app.config.js')({config:{extra:{},plugins:require('./app.json').expo.plugins}})}catch(e){console.error(e.message)}"
```

Expect a refusal naming `app.json` and `androidAppId/iosAppId`. A guard that
prints nothing is not passing — it is absent.

## 228. iOS 2.8.16 crashed at every launch — the iOS face of #224 (2026-08-31)

**Symptom.** iOS 2.8.16 (36), built 2026-08-26 from `d10f82b`, crashes at
**every launch** on device. **Sentry shows nothing.** The backend shows
nothing either — and the nothing is the trace: prod `consent_events`' newest
iOS user-agent is `PriceBack/34` (2.8.14), `PriceBack/36` appears nowhere, and
`auth_outcomes` has zero rows after Aug 25 16:07. Build 36 never survived long
enough to make one network call.

**Root cause.** The same divergence #224 documents, on the platform where it
does not fail the build. At `v2.8.16`: app.config.js (lane off) strips the
`react-native-google-mobile-ads` config plugin — the writer of
`GADApplicationIdentifier` into Info.plist — while the SDK stayed **linked**,
because the exclusion lived only in `react-native.config.js`, which Expo 55
never reads (#224). The two platforms then part ways:

- **Android:** linked SDK + missing `APPLICATION_ID` ⇒ the manifest merger /
  `compileReleaseKotlin` kills the **build**. Four releases ERRORED; no user
  ever ran one. Loud.
- **iOS:** there is no merger. The build **succeeds**, and the Google Mobile
  Ads SDK validates `GADApplicationIdentifier` in `didFinishLaunching` and
  **aborts** (`GADInvalidInitializationException`) — before React Native, the
  JS bundle, or Sentry's JS init exist. Every launch. Silent everywhere we
  look, because everywhere we look is downstream of the abort.

Why 2.8.14 was stable with the SDK equally linked: it predates #300's plugin
filter, so the GMA plugin ran on every lane and wrote a well-formed
(placeholder) app ID. Pod + ID = dark but alive. 2.8.16 = pod − ID = dead on
arrival. iOS 2.8.16 was the **only** artifact of the #224 era that reached a
human, so the bug's runtime face was discovered five days after its build-time
face was fixed.

**Fix.** Nothing new to fix in the exclusion — `main` already carries #304's
`expo.autolinking.exclude` (Android 2.8.17 built from it; the resolver probe on
the `v2.8.18` tree reads 14 modules, ads absent, both platforms). iOS simply
never had a build after the fix. Hotfix `hotfix/ios-2.8.18-launch-crash` adds
the missing **enforcement**: `scripts/assertAdsUnlinked.js` runs the real
`expo-modules-autolinking` resolver for both platforms as
`eas-build-post-install` and **fails any build** where the lane is off but the
ads SDK still resolves — the manifest-merger hard-fail Android gets for free,
manufactured for iOS, in the environment that ships. No override, by design
(#293's lesson). `__tests__/assertAdsUnlinked.test.js` pins the decision
branches, the wiring, and runs the script against the tree.

**Durable lesson.** A single misconfiguration wears a different failure per
platform: the platform that fails the *build* protects its users by accident;
the platform that builds "successfully" ships the crash. So a guard that
exists to keep something out of a binary must run **where the binary is made**
— and "Sentry is empty" is not "no crash"; a launch-time native abort precedes
every telemetry hook the app has. When Sentry and the backend are both silent
about a build users can't open, the silence dates the death to before first
paint: go read the native launch path, not the JS.

**Detect next time.** The crashing device names the exception in seconds:
Settings → Privacy & Security → Analytics & Improvements → Analytics Data →
`PriceBack-*.ips` — expect `GADInvalidInitializationException` ("The Google
Mobile Ads SDK was initialized without a valid Application ID"). And before
any iOS submission, the resolver probe from #224 with `--platform ios` answers
what the Podfile will see.

## 229. "The dev DB is missing a row" — when no row was missing, or could be (2026-09-02)

**Symptom.** Seven backend tests fail on **every** run, on **both** branches,
with an error that reads like an environment problem:
`Error: lookupId: unknown credit_event_types code: free_trial`. All seven are in
`purgeStaleSignups.test.js`; the rest of the backend suite is green. Recorded in
the task log and in session memory as "a missing dev-DB `free_trial` row" —
i.e. as something a re-seed would repair.

**Root cause.** Nothing was missing. `free_trial` lives in
`SUBSCRIPTION_EVENT_TYPES` — it describes a RevenueCat trial purchase — and has
**never** been in `CREDIT_EVENT_TYPES`. The fixture asked `credit_event_types`
for it anyway, to fill `credit_ledger.type_id`.

The error message is what made it read as an environment gap: `lookupId` says
"unknown <table> code: <code>", which sounds like a row that ought to be there
and is not. But `lookupId()` calls `ensureSeeded()` **before** it reads, and the
seed is the only writer of that table. So the sequence was: seed the table
fully, then ask it for a code the seed does not contain, then report the absence.
Re-seeding would have changed nothing; the dev database was correct the whole
time (14 codes, verified directly — `free_trial` not among them, and it should
not be).

Why it was easy to mis-file: these code namespaces genuinely **overlap**.
`price_tag_scan` is BOTH a `credit_event_types` code and a `price_source_types`
code. So recognising a code as real is not the same as knowing which table owns
it, and a wrong pairing looks completely plausible on the page.

**Fix.** The fixture makes two *different* ledger movements, so it now names the
two codes that actually describe them: `signup_grant` for the +75 grant,
`scan_consume` for the -5 spend — instead of one misnamed `trialTypeId` for both.

**Prevent.** `backend/tests/lookupCodeNamespaces.test.js` scans the backend tree
for every literal `lookupId(schema.X, "code")` and fails when the code is absent
from that table's seed list — the class, not the instance. It pins `free_trial`
in both directions (is a subscription event type, is **not** a credit one),
asserts the overlap that makes the confusion possible, and asserts the scan
matched something, so a regex that silently covers nothing fails instead of
passing green. Requires `_LOOKUP_CODES` exported from `backend/db/seed.js`.

**Durable lesson.** An error naming a *table* and a *row* invites an
infrastructure diagnosis, and infrastructure diagnoses are expensive: you go
looking at the database. Before touching one, check whether the value could ever
have been there — read the seed, which is the authority. A lookup that seeds
before it reads cannot be failing because the seed did not run. Here the fastest
possible check (grep the code in `seed.js`, see which array it sits in) was
never done, and the wrong conclusion was then written into the task log and
memory, where it kept the real cause hidden for weeks.

**Detect next time.** `grep -n '"<code>"' backend/db/seed.js` and read which
`const` array encloses the hit. If it is not the array matching the table named
in the error, it is this bug and no database work is warranted.

## 230. The OTA key-pair check that was red on every CI run, and so said nothing (2026-09-02)

**Symptom.** `__tests__/otaPreflight.test.js` fails on `main` on every run:
"the real repo key and certificate are a matching pair" — `Expected: true,
Received: false`. One failed suite out of 214; 5172 other tests pass.

**Root cause.** The test asserts that `keys/private-key.pem` and
`certs/certificate.pem` are a matching RSA pair. `keys/` is gitignored — which is
correct, it is the private half of the OTA trust root — so the private half
cannot exist on a CI runner or in a fresh clone. The assertion could therefore
only ever pass on a machine that already holds the key, and failed **by
construction** everywhere else. The file's own comment warned about "works on my
machine, silently dead from CI or a fresh clone"; it had acquired the exact
defect it was written to catch.

**Fix.** Ported from `9415e02` (#313), which fixed it on `development` only and
left `main` red. The assertion now skips where the key cannot exist —
`(hasPrivateKey ? test : test.skip)` — and prints a loud warning naming the
absent path and what is consequently unverified. The three REJECT-path tests
below it inject their own `fs`, so they still run everywhere and keep the
"missing/mismatched key is rejected" behaviour covered on every machine.

**Durable lesson.** A check that always fails is worse than no check: it is read
as background noise, and on the day it goes red for a real reason — a rotation
that replaced one half of the pair — nobody looks. When an assertion depends on
a secret that CI deliberately cannot hold, the honest form is to **skip and say
so at volume**, not to assert and stay red. Note the asymmetry that keeps the
coverage honest: only the assertion needing the real private key skips; every
path that can be exercised with an injected `fs` still runs everywhere.

**Detect next time.** A suite that is red on CI and green locally, on a test
whose subject is a credential or a gitignored artefact, is this shape. Also: a
fix that lands on `development` for a defect that also exists on `main` leaves
`main` red until it is ported — check both branches when the defect predates the
branch point.

## 231. The production purge tool whose DELETE could never run (2026-09-02)

- Date: 2026-09-02 · PR: #316 · Area: backend

**Symptom.** After fixing #229, two of the seven `purgeStaleSignups` failures
remained — but with a completely different error:
`op ANY/ALL (array) requires array on right side`, SQLSTATE **42809**, thrown
from `backend/lib/staleSignups.js` on the DELETE.

**Root cause.** Drizzle expands an embedded JS array into a parenthesised
PARAMETER LIST, not an array literal. Rendered through `PgDialect`:

```
ANY(${subs})  ->  "u.sub = ANY(($1, $2, $3))"    <- row constructor
IN  (…)       ->  "u.sub IN ($1, $2, $3)"        <- correct
```

`($1, $2, $3)` is a **row constructor**, and `ANY` requires an array — hence
42809. This was the only `ANY(` in the entire backend; every other membership
check already used the expanded `IN` form (`usersRepo.js`,
`u.push_token IN (...)`). A lone deviation from a pattern that works.

**This was not a test bug.** `scripts/purge-stale-signups.js --write` is the
operator tool in the release runbook for clearing abandoned smoke-test signups
off **production**. Its delete path was dead. Dry-run (the default) worked, which
is why nobody noticed: the tool appeared to function right up to the point where
it would have done the one thing it exists to do.

**Why it hid for weeks.** The `before` hook of the only suite covering `--write`
died on #229's unrelated lookup error, so both tests were REPORTED AS FAILURES
WITHOUT THEIR BODIES EVER RUNNING. Seven red tests looked like one problem. They
were two, and the second was the serious one.

**Fix.** `sql.join(subs.map((s) => sql`${s}`), sql`, `)` inside `IN (...)`,
matching the rest of the backend. The `u` alias and the shared `fingerprint()`
fragment are untouched, so the SELECT and the DELETE still cannot drift.

**Prevent.** The new regression test needs **no database**: it captures the
DELETE, renders it through `PgDialect`, and asserts an expanded `IN ($1, $2)`
with one bound parameter per sub, no `ANY(`, and that the full fingerprint is
still re-applied. Being DB-free, a `before` hook can never mask it again.

**Durable lesson.** **A masked test is not a passing test, and a failure count
does not distinguish them.** When a `before`/`beforeAll` hook throws, every test
under it is reported failed without executing — so a single environment-shaped
error can hide an arbitrary number of real defects behind it. After fixing any
hook-level failure, re-read the run: the tests that "were already failing" have
only just started running for the first time. Corollary: a tool whose safe mode
(dry-run) is the default gets exercised constantly while its dangerous path
rots untested.

## 232. 214 suites passed and the job still went red (2026-09-02)

- Date: 2026-09-02 · PR: #316 · Area: mobile

**Symptom.** `Test Suites: 214 passed, 214 total` · `5172 passed` · every
coverage floor clear — and `Process completed with exit code 1`. On both
branches, every run, since 2026-08-12.

**Root cause.** `storePrices._fetchFromStore()` re-ran
`await import("./purchaseService")` on **every** attempt, including the attempts
the auto-retry fires from a `setTimeout` (`AUTO_RETRY_DELAYS_MS = [1200, 3500]`).
A test that triggered a refresh and finished in under 1.2s left that timer armed;
when it landed, the Jest environment for that file was gone:

```
ReferenceError: You are trying to `import` a file after the Jest
environment has been torn down.
  From __tests__/purchaseService.test.js
  From __tests__/auditMoneyBatch.test.js
```

Jest reports that as a **bare error, not a test failure** — it fails the RUN
while the summary still reads all-green.

**The obvious reading was wrong, twice.** The visible message was *"Jest did not
exit one second after the test run has completed"*, which reads as a leaked
handle, and that is how it was recorded in memory. It is not:

- under `--detectOpenHandles`, Jest reports **no open handles at all**, the
  "did not exit" line disappears, and the run **still exits 1**;
- a `globalTeardown` probe (unref'd, so it cannot hold the loop itself) found
  exactly **two** live handles for the entire wait — stdout and stderr — with
  **zero** active requests;
- the wait is a **fixed ~4m25s** (4m25.6s / 4m26.0s / 4m23.9s across three
  runs), which is a timeout, not a leak.

So the "open handle" was a *symptom of the same deferred work*, and
`--forceExit` would have hidden the real error rather than fixing anything.

**The cause was one thing; it had TWO symptoms, and fixing the first did not
make the job green.** A failed lookup ARMS AN AUTO-RETRY (1.2s, then 3.5s) that
nothing awaits — `refreshStorePrices()` resolves after one attempt by design and
the retry lands later, on a timer. Every test finishes sooner, so the timer fires
into a torn-down environment, and Jest turns whatever it touches there into a
run-level error. What it touches:

1. the dynamic `import("./purchaseService")` -> the ReferenceError above;
2. the catch's `console.warn` at `storePrices.js:467` ->
   `Cannot log after tests are done. Attempted to log "[storePrices] lookup
   failed: offline"`.

`"offline"` is `purchaseService.test.js`'s own fixture
(`getOfferings.mockRejectedValue(new Error("offline"))`), which is what finally
identified the owner. **Either symptom alone exits 1.** Memoizing the import
removed (1) and the job stayed red — a full CI run spent proving the first fix
was only half.

**Fix.** Both halves:

- **Source** — memoize the dynamic import. It exists to break a module cycle at
  module-EVALUATION time, which the first call settles permanently; re-asking on
  later attempts bought nothing and cost this. Only the MODULE is cached, never
  `initRevenueCat()`'s answer — a cold-start miss followed by a configured retry
  is the entire reason the retry budget exists. Both halves pinned by tests.
- **Tests** — `afterEach` in the two suites that reach storePrices indirectly,
  calling `__resetStorePricesForTests()` to drop the armed timer. This is the
  cleanup `storePrices.test.js` already does for the module it owns.

**A wrong turn worth recording.** The test-side cleanup was first rejected as
*unreachable*, reasoning that the global `beforeEach` calls `jest.resetModules()`
and so orphans each instance beyond any hook's reach. That was wrong about
ordering: **`afterEach` runs BEFORE the next `beforeEach`**, so the require
resolves in the registry the test just used — exactly the instance holding the
timer. The mistaken ordering model sent the fix into production source when a
four-line test hook was the right answer.

**Durable lesson.** When a runner exits non-zero with every test green, the
failure is **outside** the test results — look for bare errors in the log, not
for a failing assertion. And deferred work is owned by whoever armed it: a
`setTimeout` that re-enters the module system will eventually land in a world
where that module system no longer exists. Memoize what you resolved once;
schedule nothing that must re-resolve later. Finally, note the shape shared with
#229: the loudest message in the output ("did not exit", "unknown table code")
named the wrong cause both times, and both were believed for weeks.

**Detect next time.** Compare the timestamp of `Ran all test suites.` with the
step's exit line. A long, silent, *constant* gap is a timeout, not a leak. If
`--detectOpenHandles` reports nothing while the process still lingers, stop
looking for handles and read the log for bare `ReferenceError` /
`Cannot log after tests are done` lines instead.

**Confirmed after the fix — and worth being precise about.** The green run
(`33609679765`) still prints *"Jest did not exit one second after the test run
has completed"*, and still waits **4m28.8s** between `Ran all test suites.` and
the end of the step. It **passes anyway**. So the message and the wait were never
the failure: they are a separate, benign slow-exit, and the exit code was decided
entirely by the two post-teardown errors, both now absent from the log.

That leaves a standing, non-failing cost: **every mobile CI run burns ~4.5
minutes doing nothing** after the suite finishes. Not fixed here — it is a
different problem from the one that made the job red, and bundling it would have
blurred which change bought the green. Worth its own investigation when Actions
minutes matter; the probe technique in this entry (`globalTeardown` +
`process._getActiveHandles()`, unref'd) is the tool for it, and it already
narrowed the field to stdout/stderr with zero active requests.

## 233. A comma read as a period divided a television's price by a thousand (2026-09-02)

- Date: 2026-09-02 · PR: #317 · Area: mobile (Best Buy parser, lab lane)

**Symptom.** None yet — and that is the entry. The defect is sitting in the
repo's own committed real-OCR corpus, on a line the parser happens not to read.

`__tests__/fixtures/receipts-bestbuy/PXL_20260415_185052976.MP.vision.json`, the
one photographed in-store slip, contains:

```
SUBTOTAL        $3.699.99          <- that is $3,699.99
```

Thermal print puts the comma and the period one dot apart and Vision picked the
wrong one.

**Root cause.** Every money pattern in the pipeline is
`\d{1,5}(?:,\d{3})*\.\d{2}`. Run it over `$3.699.99` and it does **not fail**:

```
\d{1,5}       matches "3"        (one digit — the next char is a period)
(?:,\d{3})*   matches nothing
\.\d{2}       matches ".69"
              -> "$3.69"
```

It matches a **prefix** and stops. The amount is not mangled, not rejected, not
flagged — it is silently divided by a thousand and the result is a perfectly
well-formed price. Nothing downstream can tell.

**Why it has not bitten.** Pure luck of position. On this capture the dotted
token is on `SUBTOTAL`, which the Best Buy parser never reads (it anchors on the
printed grand total instead), and the item row's own amount happened to OCR with
a correct comma. The same glyph confusion one row higher logs the user's
$3,699.99 television at **$3.69** — and the 30-day price-adjustment claim that
receipt was scanned for is then filed on $3.69, a number no store will ever
match, against a real purchase.

**Fix.** `repairThousandsSeparator` in `bestBuyReceiptParser.js`, first in the
`reshapeBestBuyLines` chain and also applied inside `bestBuyTotalsText` so the
printed-total anchor gets it too:

```
(?<!\d)(\d{1,3})\.(\d{3})\.(\d{2})(?!\d)   ->   $1,$2.$3
```

It fires only on the unambiguous shape — 1-3 digits, a period, **exactly** three
digits, a period, exactly two digits, no digit either side. `3.699`, `12.34`,
`$3,699.99` and `6.5 po` are all left untouched, asserted as such.

Kept in the **Best Buy** parser, not the shared engine: `receiptParsingShared.js`
is Costco's live code path with a ~55-fixture corpus and a per-file floor pinned
to its current behaviour, and a Best Buy repair applied there is a Costco change
wearing a Best Buy label.

**Prevent.** A corpus-wide invariant in the real-OCR suite: for every dotted
token on any fixture, the **truncated** reading must appear nowhere in the parse
(no item price, no total, no printed total). It is the assertion that would have
caught this had the token landed one row higher, and it now runs against all
nine captures on every commit.

**Durable lesson.** **A regex that matches a PREFIX does not fail on bad input —
it succeeds on the wrong input.** Anchoring is not a style preference: an
unanchored money pattern turns a corrupted amount into a plausible one, which is
strictly worse than rejecting it, because a rejected number gets a second pass
and a plausible one gets acted on. And: a defect can already be present in a
committed fixture and still be invisible, because a corpus only tests the lines
the parser reads.

## 234. Two ways the Best Buy parser lost data in silence (2026-09-02)

- Date: 2026-09-02 · PR: #317 · Area: mobile (Best Buy parser, lab lane)

Both found by reading the parser against its own real captures rather than by a
failure. Both are silent by construction, which is what makes them one entry:
neither throws, neither logs, and neither shows up as anything but a receipt
that is quietly a bit wrong.

### (a) An item row that lost its dollar sign fell off the end of a loop

`extractBestBuyOnlineItemRows` required a literal `$` on a priced row. Trace
`1 12917124 Oreillette Bluetooth 49.99` through the loop:

- `ONLINE_ROW_PRICED_RE` — no match, no `$`.
- `ONLINE_ROW_UNPRICED_RE` — right shape, but its `!/\d\.\d{2}/` guard rejects a
  row that carries an amount.
- the bare-price branch — not a bare price, it has a name on it.
- the name-continuation branch — same `\d\.\d{2}` guard rejects it.

Four branches, none taken, `continue`. **The product simply vanished.** The
receipt scans, a credit is spent, and the user is shown a basket with an item
missing — with nothing logged, because dropping off the end of a loop is not an
error condition.

**Fix.** `ONLINE_ROW_PRICED_NO_SYMBOL_RE`, tried only **after** the `$` form so
every receipt that prints the symbol takes exactly the path it took before. Then
the hole itself was closed: any in-table row that matches no rule and carries a
money token is now attached to the item in progress rather than discarded. A row
attached to the wrong item is visible on screen and correctable; a dropped one
is invisible forever.

### (b) An internal counter was promoted to a product SKU

`attachTrailingSkuRows` reads the row **under** an item and promotes a 7-8 digit
run to that item's SKU — the layout a big-ticket in-store line uses. The real
capture prints, in exactly that position:

```
TV Delivery et traveling $0.00
00003501                          <- an internal counter, 8 digits
```

`isBestBuySku("00003501")` was `true`: the rule was width only. It survives today
only because the $0.00 line above it is dropped for unrelated reasons. Under a
row that *does* survive, the item is watched under a SKU no product has — and
that failure is invisible until a price drops and the alert never fires.

**Fix.** Two guards, at different levels on purpose:
- `isBestBuySku` now requires a non-zero first digit. Verified against all eleven
  SKUs in the pinned corpus — none is zero-padded, and Best Buy catalogue numbers
  are not.
- a compact-`YYYYMMDD` check, applied **only** where a trailing row is being
  promoted. `20251128` is eight digits and starts with a 2, so the leading-zero
  rule does not cover it. Scoped to the attach site so a real SKU that happens to
  look like a date still parses normally when printed on its own row.

**Durable lesson.** **Ask what happens to input that matches NO branch.** Both
of these are the same shape: a chain of `if`s, each individually correct, with an
implicit final `else` that throws the data away. A loop whose last statement is
an unconditional `continue` has a silent drop in it; the fix is not another
branch but an explicit account of the leftovers. Corollary for width checks: a
receipt prints many numbers, and "is it the right number of digits" is a weak
identity test — anchor on something the impostors cannot satisfy.

## 235. A cleared config field would have erased every deleted account's credit ledger (2026-09-02)

- Date: 2026-09-02 · PR: #317 · Area: backend (money, irreversible)

**Symptom.** None observed — found by writing the first test this job ever had.
`backend/jobs/purgeRestoreLedgers.js` was at **0% coverage**.

**What the job does.** Account deletion no longer erases a user's
`credit_ledger` rows: a re-signin inside `CREDIT_RESTORE_GRACE_HOURS` gets the
balance back, and that balance is recomputed by **replaying those very rows**,
never read from a snapshot. This hourly job is the only thing that makes the
retention a *window* rather than a change of policy. Its DELETE is irreversible.

**Root cause.** One coercion:

```js
const graceHours = Number(getOpsConfig("CREDIT_RESTORE_GRACE_HOURS"));
purgeExpiredRestoreLedgers({
  graceHours: Number.isFinite(graceHours) ? graceHours : undefined,
  now,
});
```

`0` is a **real, documented setting** — OPS_DEFAULTS says *"Set to 0 to restore
nothing and wipe the ledger on the next sweep."* It is also what `Number()`
returns for `""`, `null`, `false` and `[]`. So the coercion cannot distinguish
an operator's deliberate *wipe now* from an absent value.

And the absent value is reachable. `getOpsConfig` returns the `app_config` row
whenever it is neither `undefined` nor `null`:

```js
if (_ops && _ops[key] !== undefined && _ops[key] !== null) return _ops[key];
```

`_ops` is `appConfigRepo.getAllMap()` — `out[r.key] = r.value`, passed through
untouched. So an operator who **clears the field** (the natural way to fall back
to the default) writes `""`, which becomes `0`, which means *destroy every
soft-deleted account's ledger on the next hourly run* — hours or days before the
window each of those users was owed, with no way back.

**Fix.** A value is usable only if it is a number, or a string with something in
it; anything else is "not configured" and passes `undefined` so the repo applies
its own default. An explicit `0` still passes through untouched:

```js
const configured = getOpsConfig("CREDIT_RESTORE_GRACE_HOURS");
const usable = typeof configured === "number"
  || (typeof configured === "string" && configured.trim() !== "");
const graceHours = usable ? Number(configured) : NaN;
```

**Prevent.** `backend/tests/purgeRestoreLedgersJob.test.js`, **DB-free** — both
dependencies injected through `require.cache`. That is not only speed: Bugs #231
was a dead DELETE hidden for weeks because the only suite covering it died in a
`before` hook, so seven tests were reported as failures without their bodies ever
running. A test with no hook to fail cannot be masked that way. It pins both
directions explicitly — `0` is honoured and never replaced; `""`, `null`,
`undefined`, `NaN`, `{}`, `[]` and `"abc"` all become `undefined` and **never
`0`** — plus the read-per-run contract, the threaded clock, and the `zeroed`
warn (audit #8, P4).

**Durable lesson.** **When a sentinel value is also a valid setting, coercion
cannot be the parser.** `Number()` maps at least five distinct "no value" inputs
onto `0`, and `0` here means *delete everything now* — so the coercion silently
promoted "unset" to the most destructive instruction the knob can express. Check
the SHAPE of the value before converting it, and make "absent" a state of its
own rather than a number. Detect next time: any `Number(config)` where `0` is
meaningful, and any `if (Number.isFinite(x))` guard downstream of one — the
guard reads like it is catching this, and it is not.

## 236. A Best Buy SKU was looked up in the shopper's Costco history (2026-09-02, PR pending)

**Symptom (latent — caught before it shipped).** None yet. This defect was
created by promoting Best Buy off the lab lane and would have gone live with it.

**What happens.** `ScanScreen` runs `inferOnlineReceiptQuantities` on any receipt
whose `receiptKind` is `"online"`, to recover a quantity that online invoices
never print. Underneath, `fetchMyPriceHistory` hardcoded
`qs.set("store", "costco")`.

That was harmless while Costco was the only store with a parser. `receiptKind:
"online"` is exactly what the **Best Buy** parser stamps on an order PDF — eight
of its nine real captures — so the moment Best Buy was promoted, every Best Buy
online receipt looked its SKUs up in the user's **Costco** purchase history.

**Why it is not simply a lookup that finds nothing.** A SKU identifies a product
only *within one retailer's namespace*. Costco's are 6–7 digits and Best Buy's
7–8, so the ranges overlap and the same string names two unrelated products. On
a hit the app infers a quantity from an unrelated price — and since `price` is
deliberately left as the printed line total, the per-unit figure the shopper
then claims on is `line_total ÷ a fabricated quantity`.

Same failure class as the parser reading `2210 BANK ST` as an item costing
$22.10: **a plausible wrong number is worse than a visible gap, because the user
acts on it.**

**Fix.** Thread the store through, defaulting to `"costco"` so every
pre-existing call site is byte-identical:

- `fetchMyPriceHistory({ barcode, sku, storeId = "costco" })`
- `inferOnlineReceiptQuantities(items, storeId = "costco")`
- `ScanScreen` passes `data.store?.id`. With no store detected the picker is
  open and the namespace is genuinely unknown, so that path keeps the historical
  Costco fallback — unchanged behaviour, and the one case still worth revisiting.

The backend route already read `req.query.store`; no server change was needed.

**Prevent.** Store scoping is now pinned on both sides, because they fail
differently: `inferOnlineReceiptQuantities.test.js` proves the service queries
the store it is given (and still defaults to Costco when given none), and
`scanScreenOnlineQuantityInference.test.js` proves the *screen* passes it — a
service that scopes correctly wired to a screen that never passes the store is
the whole bug, and either test alone is green while it is present.

**Durable lesson.** **A hardcoded constant is not a bug until a second case
exists — and then it is a bug everywhere at once.** `store=costco` was correct
for as long as there was one store, and nothing about it looked wrong when Best
Buy's parser was written, tested, and hardened; it only became wrong at the
moment of promotion, in a file nobody editing the parser would open. Detect next
time: when promoting anything from one instance to many, grep for the FIRST
instance's identifier as a literal (`"costco"`, `"bestbuy"`) across the whole
app, not just the subsystem being promoted. Four of the sites found that way
were fine; this one was not.

## 237. The price feed stored an offer-end date six years in the past (2026-09-02, PR pending)

**Symptom (latent).** Found by running the new `npm run bestbuy:probe` against
the live Best Buy API with the eleven SKUs pinned by the receipt corpus.

**What the API actually returned.** Two of eleven live SKUs carry an end date
that must not be stored, from opposite directions:

| SKU | On sale? | Date field | Value |
| --- | --- | --- | --- |
| `10255247` | no | `offerEndDate` | **2020-08-10** — six years stale, next to a `saleStartDate` of 2026-02-24 |
| `15990615` | no (`salePrice === regularPrice`) | `saleEndDate` | 2026-09-11 — a sale that already ended, leaving its date behind |

`normalizeOffersPayload` took `offer.saleEndDate ?? offer.offerEndDate`
unconditionally. Its own comment said *"Only a sale has a real end date"* — the
code had never done that.

**Why a bad `valid_until` is worse than none.** The two readers disagree:

- `pricesRepo`'s active-offer read filters `valid_until IS NULL OR valid_until
  >= today`;
- `priceDropRepo.findNotifiable` — **the query that charges commission** — does
  not filter on it at all.

So a past-dated row is **invisible to the display path and still visible to the
money path**. Nothing reports the disagreement, and the shape of the resulting
bug ("the app shows no price but the user was billed for a drop") points at
neither file.

**Fix.** An `offerEndDate(offer, isOnSale, now)` helper in
`backend/lib/bestBuyCatalog.js` — Best Buy's own adapter, so no Costco code path
is touched. It stores a date only when the offer *is* on sale and the date has
not already passed. The past-date rule is the mirror of the year-9999 no-expiry
sentinel the file already refused.

**Prevent.** Six assertions in `bestBuyCatalog.test.js`, all against the live
captures now committed under `tests/fixtures/bestbuy-api/live-2026-09-02/`,
including the `>= today` boundary stated explicitly (a one-character slip there
silently discards every last-day sale) and a check that a *genuine* future sale
date is still stored — a guard that threw away the case the field exists for
would pass every other test in the file.

The pre-existing on-sale assertion also had to be pinned to a fixed clock: its
fixture's `saleEndDate` is 2026-09-08, so the new past-date rule would have
turned it into a time bomb that failed on 2026-09-09 with a diff saying nothing
about the cause. Same class as the UTC date-test bug that cost every receipt's
purchase date in 2.8.5.

**Durable lesson.** **Curated fixtures prove the rules; only an unfiltered
sweep proves the rules apply.** The four hand-picked API fixtures were each
chosen to demonstrate a rule the adapter already had, so none of them could
possibly have found a rule that was missing. Eleven SKUs chosen by *which
products happen to be on nine real receipts* found two defects in one pass — and
the same eleven produced the only live evidence that the marketplace gate works
(`18145276`, bought at Best Buy, now sold by a third party, correctly rejected).
Detect next time: when an adapter's comment states a rule, check that the code
below it implements the rule rather than a superset.

## 238. A guard that fired correctly went unheard for a day, and every branch inherited its red (2026-09-07, PR #323)

**Symptom.** `development` failed exactly one test, on every branch cut from it,
from 2026-09-06 onward:

```
● the Costco path is frozen › the suites that protect it
  › __tests__/receiptParserRegistry.test.js is byte-identical to its pinned state

Test Suites: 1 failed, 234 passed, 235 total
Tests:       1 failed, 1 skipped, 5704 passed, 5706 total
```

It surfaced on the Abercrombie PR (#322), which is **backend-only** and does not
contain the named file. The first reading a branch author gets is therefore
"my PR broke the Costco guard", pointing at a store the change never touched.

**Cause.** #320 promoted Best Buy from the lab lane to a production parser and
updated `__tests__/receiptParserRegistry.test.js` to match — correctly. That
file is listed in `COSTCO_GUARD_SUITES` in
`__tests__/costcoPathImmutability.test.js`, whose header states the required
second step in the same breath as the first:

> the edit is a deliberate, reviewed Costco change — then re-pin the one hash
> **in the same commit as the change**

The edit landed; the re-pin did not. **The guard was not wrong — it was right,
and nobody was listening**, because CI no longer runs on `development` (#313
narrowed the triggers to `main` pushes plus manual dispatch, deliberately). A
`development` merge produces no run, so the failure sat undiscovered until the
next feature branch paid for a hand-dispatched one.

**Fix.** One line re-pinned to the current hash, with the review the guard asks
for recorded inline and in the commit message: diffing the pinned state (#318)
against `development` shows the Best Buy lane assertions inverted and the
lab-lane block rewritten for an empty `LAB_STORE_PARSERS`, and exactly **one**
Costco-touching line —

```diff
-    expect(withLane(false, () => listStoreParserIds())).toEqual(["costco"]);
+    expect(withLane(false, () => listStoreParserIds()).sort()).toEqual(["bestbuy", "costco"]);
```

— the direct consequence of there being two production parsers. No Costco
assertion removed or weakened, and no Costco *source* file in the diff: all four
pinned sources still hash to their pinned values, so the golden snapshots cannot
have moved.

**Prevent.** The store-promotion checklist gains an explicit line: *promoting a
store edits `receiptParserRegistry.test.js`, which is a pinned guard suite — the
re-pin ships in the promotion commit.* The guard cannot enforce its own
follow-up step; it can only fail, and it did.

**Durable lesson.** **A guard is only as good as the run that reads it.**
Trigger-narrowing and tripwires interact: #313 made feature branches and
`development` deliberately unverified to survive the free tier, which is a sound
trade, but it also means a tripwire on those branches fires into an empty room
and the *next* author inherits the alarm as if they had set it off. When a
suite fails on a file your diff does not contain, check whether it already
failed on the base branch **before** reading it as your own regression:
`git diff --stat <base>...HEAD -- <file>` answers it in one command.

**Also found, not fixed here.** This guard **cannot pass on a Windows checkout**
with `core.autocrlf=true`. It hashes working-tree bytes (CRLF) against pins that
are the repository's LF bytes, so *every* pinned file mismatches locally. No
effect on CI (Linux, LF), but the suite is locally unrunnable on Maxim's
machine — a `.gitattributes` entry or a newline-normalising `hashFile` would fix
it, in its own change.

## 239. A permission screen that argued for "yes" and offered a door marked "not now" (2026-09-09, PR #326)

**Symptom.** iOS 2.8.18 (38) was **rejected** by App Review under Guideline
5.1.1(iv) — submission `7fee471a-4ab2-4727-a1da-c164231963a3`, reviewed on an
iPad Air 11-inch (M3). Nothing crashed, nothing misbehaved, and the reviewer got
all the way through sign-in. They stopped at the first-run permission screen:

> - A custom message appears before the permission request, and to proceed users
>   press a "Allow access" button. Use words like "Continue" or "Next" on the
>   button instead.
> - A custom message appears before the permission request, and the user can
>   close the message and delay the permission request with the "Maybe later"
>   button. The user should always proceed to the permission request after the
>   message.

**Cause.** `src/screens/PermissionsPrimingScreen.js` shipped two buttons —
**"Allow access"** and **"Maybe later"** — and both are disallowed, for two
different reasons that are easy to collapse into one and get wrong:

1. A priming button may not use language that **pushes the user toward
   granting**. The OS prompt is where the user decides; the app's button may
   only advance them to it. "Allow", "Enable", "Grant", "Autoriser" are all out.
2. The screen may not offer a route that **skips the OS prompt**. Once the
   explainer has been shown, the prompt must follow it.

The screen itself was never the problem, which matters: the instinct on reading
the letter is to delete the priming screen entirely, and that trades a real
feature (the onboarding notification opt-in, which is the whole price-drop
re-engagement loop) for no compliance gain whatsoever. Apple wrote the remedy in
the letter. It is two edits, not a redesign.

**Fix.** The screen keeps its explanatory job and loses everything else. One
control, reading **Continue**, and every route off it goes through both OS
prompts:

- "Maybe later" and its handler deleted. `perm.allow` and `perm.later` removed
  from **both** language blocks rather than re-worded — a key named `later` is a
  label waiting to be re-rendered by whoever edits the screen next.
- `App.js` gives the route `gestureEnabled: false`; the screen swallows Android
  `hardwareBackPress` for its lifetime. A swipe-back and a bezel press are skip
  buttons wearing different hats, and neither shows up in a render test.
- The `finally` block that already navigated to Main unconditionally is what
  makes removing the escape hatch safe. A thrown permission request cannot
  strand a user on a screen that now has no exit of its own — which is the
  reason the screen is allowed to have none.

**The audit found nothing else.** Every other permission surface in the app was
already compliant, and by the *opposite* pattern: fire the OS prompt first, show
custom UI only **after** a denial, with a route to Settings. That is not a
loophole — it is what Apple's own "Next Steps" paragraph recommends. Receipt
camera, tag camera, the VisionKit preflight, all three photo-library pickers,
camera-roll suggestions and location all do this via
`services/permissionAlerts.js`. The Android rationale dialog is inside a
`Platform.OS === "android"` branch and never runs on iOS. ATT is not in a
production binary at all.

**Detect.** `__tests__/permissionsPriming.test.js` pins the rule rather than the
markup: exactly one *outermost* pressable (de-duplicated, so a touchable built
on another primitive cannot make it pass for the wrong reason); camera →
notifications → `replace("Main")` asserted by `invocationCallOrder`, so
navigating first cannot pass; a thrown camera request still reaching
notifications; hardware back returning `true`; `App.js`'s own line read for
`gestureEnabled: false`; and the CTA checked against a forbidden-wording regex
in **every language `getSupportedLanguages()` reports**, so a third locale is
covered the day it is added. The forbidden regex is matched against the
*control's label only* — body copy legitimately contains "autorisations", the
French for "permissions", and banning that would be wrong.

**Durable rule.**

> A pre-permission explainer may **persuade**, but it may never use "Allow"
> wording on its button, and it may never offer a way out that skips the OS
> prompt — including a back gesture or a hardware back press.

**Second-order lesson, and the more expensive one.** A reviewer stops at the
first problem, so a rejection letter is a statement about **one** screen and
says nothing about the rest of the app. Everything past the stopping point is
unreviewed and is where the *next* rejection comes from. Here the reviewer never
reached the paywall — and the five IAP products have never been attached to an
App Store Connect version, which makes `Paywall.js` render a price skeleton and
**disable** the Subscribe button. Fixing only what the letter names is how a
two-round rejection becomes a three-round one. The pre-submission checklist in
`Publishing-Compliance/App_Store_Rejections.md` §0 exists for exactly this.

## 240. A destructured import made the admin-protection tests fail against correct code (2026-09-10, PR #327)

**Symptom.** Every run of the backend suite against a real database ended
`fail 2`, and had since the admin console landed (#325). The same two tests,
every time, on `main` and on the branch:

```
test at tests/adminConsoleRoutesDb.test.js:328
✖ a protected account is never proposed, even when it matches
  AssertionError: an admin account must never appear as a cleanup candidate

test at tests/dataCleanupPredicatesDb.test.js:319
✖ an admin account on the company domain is protected from its own group
  AssertionError: an operator must not be able to delete the account holding
                  the only surface that could undo it
```

Both assert the same invariant from opposite ends: an account on the admin
allow-list can never be proposed for deletion by the cleanup console. Both set
that account up the same way — by swapping `configService.getAdminSubs` for a
stub that names it.

**Cause.** `backend/lib/dataCleanup.js` imported the function by destructuring:

```js
const { getOpsConfig, getAdminSubs } = require("../config/configService");
```

A destructured binding is captured **once, at require time**. Reassigning
`configService.getAdminSubs` afterwards rebinds the property on the module
object and leaves the captured reference untouched, so `protectedSubs()` went on
calling the original function. The stub naming the test's account was never
consulted; the real allow-list (`ADMIN_USER_SUBS`, unset in CI) came back empty;
nothing was protected; the account showed up as a candidate exactly as the
assertions said it must not.

The rest of the backend does not have this problem, and not by luck.
`server.js` splits its import deliberately — `const { getOpsConfig } =
configService;` for the plain reads, and `configService.getAdminSubs()` written
out at each of its call sites — and `priceDropNotifier.js` does the same. The
new file broke a convention that was load-bearing and looked cosmetic.

**Why this shape is the dangerous one.** *The shipped behaviour was correct the
entire time.* `getAdminSubs()` reads `process.env` on every call and is never
reassigned in production, so the stale binding returned the right answer in the
app: admins really were protected, and no operator could ever have deleted one.
Only the test seam was broken.

That is the worst configuration a red test can be in. A failure over genuinely
broken code gets fixed. A failure over correct code invites someone to conclude
the *test* is wrong — to relax the assertion, mark it flaky, or gate it behind a
skip — and the invariant then has no guard at all on the day the production path
does break. Two of these sat red for eight days across two branches.

**Fix.** Late-bind the one function the tests drive, matching what `server.js`
already did:

```js
const configService = require("../config/configService");
const { getOpsConfig } = configService;          // plain read, never swapped
...
const all = [...configService.getAdminSubs(), ...fromConfig, ...extra.map(String)];
```

`getOpsConfig` stays destructured on purpose: no test swaps it, and pretending
otherwise would suggest the namespace form is a style rule rather than a
statement about which seams are real.

**Detect.** The two tests that caught it are DB-gated (`skip: !HAS_DB`), so
without `DATABASE_URL` they skip and report green — the regression could return
unseen. The guard therefore lives in `backend/tests/dataCleanupRegistry.test.js`,
which needs no database: it swaps `configService.getAdminSubs`, asserts
`protectedSubs()` reflects the swap, asserts an emptied allow-list drops the
account it had been protecting (so the swap is honoured in *both* directions,
which is what lets a test set up its own "not protected yet" precondition), and
finally asserts the real function was restored — so a broken restore cannot
leave every later test in the file passing against a stub.

The two tests that already existed beside it set `process.env.ADMIN_USER_SUBS`
instead, which flows through the *real* `getAdminSubs()`. They pass either way.
That is the gap: they prove the allow-list is honoured, and say nothing about
*how it is read* — and the how was the bug.

**Durable rule.**

> If a test suite swaps a function on a module object, every consumer of that
> function must call it through the module object. A destructured import freezes
> the reference at require time and silently discards the swap — and because the
> swap is a test-only construct, the resulting failure appears over production
> code that is behaving perfectly.


---

## 241

**A currency gate that checked only the currency.** `backend/lib/abercrombieCatalog.js`
would have accepted an FX-converted foreign price as a Canadian one — and billed
the shopper for the drop it invented. Found by audit 2026-09-10, before the
adapter was wired to anything.

**Symptom (never reached production).** Abercrombie's price adapter refused a page
unless its JSON-LD said `priceCurrency: "CAD"`, and read `data-storeid` only to
decorate the rejection message. A USD price against a CAD receipt line is
numerically *lower*, so it does not read as an error — it reads as a price drop of
roughly the exchange rate, on every item, forever. `findNotifiable` charges
commission at detection, before a human sees it.

**Why the currency check is not enough.** A&F ships a **multi-currency selector**
— the worldwide storefront's own page carries AUD, COP and USD. So a foreign
storefront can render an FX-converted price and *honestly* declare that currency.
`priceCurrency: "CAD"` is not evidence of a Canadian price; it is evidence of a
dropdown setting.

**The test suite encoded the hole rather than catching it.** Its `deriveCad()`
helper built the "Canadian" page by stamping `data-storeid="10051"` — which is
A&F's real **US** storefront. Every "CAD is accepted" case therefore asserted
*that a US page carrying a CAD string is accepted*: the exact scenario the gate
exists to refuse, pinned as correct behaviour by 35 green tests.

**Fix.** Two assertions, storefront first, both before any price is read:

```js
// STOREFRONT before currency: a worldwide page with the selector set to CAD
// declares CAD and is still the wrong price.
if (!allowed.includes(String(storeId))) return { sku, rejected: "storefront_mismatch", detail };
if (currency !== REQUIRED_CURRENCY)    return { sku, rejected: "currency_mismatch", detail };
```

`CANADIAN_STORE_IDS` is **empty**, deliberately: the real id can only be read off a
page served to Canadian egress, and none has ever been captured. Empty refuses
everything, which is correct and matches reality anyway. The suite injects a
deliberately *fake* id so the pricing path stays covered without blessing a real
foreign storefront.

**Detect.** Ten cases, mutation-verified — neutering the storefront half turns 8
of them red. The load-bearing ones assert that a page declaring **CAD on storefront
11203** and **CAD on storefront 10051** are both refused.

**Durable rule.**

> A gate that reads two signals and decides on one is not a gate; it is a
> comment. When a retailer lets the *client* choose how a value is presented —
> currency, locale, units, tax-inclusive pricing — that value describes the
> request, not the merchandise. Assert the thing the client cannot choose.

A second, related rule, from the same file:

> Do not publish a field whose name answers a question the code cannot see. The
> adapter exported `isFullPrice` (meaning `regularPrice === price`, i.e. "on sale
> right now") while the policy's "purchased at the full price" is a fact about the
> *receipt*. The probe script had already misread it, labelling the store's
> central case — bought at full price, marked down later — as "not claimable".

---

## 242

**A byte-hash freeze test that fails on Windows and passes in CI.** `npm test`
was red out of the box on a Windows checkout — 12 failures, 2 suites, none real.

**Symptom.** `__tests__/costcoPathImmutability.test.js` reported every frozen
Costco file as *"not byte-identical to its pinned state"* — the parser, the tag
scanner, the warehouse constants, all ten guard suites — on a tree where
`git status` was clean and `git diff` empty.

**Cause.** The test hashes raw bytes (`fs.readFileSync`, no normalisation). Git
had `core.autocrlf=true` and the repo had **no `.gitattributes`**, so Windows
checked those files out with CRLF while CI (ubuntu) sees LF. The LF-normalised
worktree hash matched the git blob exactly:

```bash
git show HEAD:<file> | sha256sum     # 7c33c4b1…
# worktree, CRLF                     # 3adcccda…
# worktree, CRLF→LF                  # 7c33c4b1…  ← identical
```

**Fix.** `.gitattributes` with `* text=auto eol=lf`, plus rewriting the affected
worktree files from their git blobs (`git show HEAD:<f> > <f>`) — provably
content-neutral, and it touches no Costco file's *content*. Separately,
`scripts/checkI18n.js` was emitting `path.relative` output with OS-native
separators (`src\screens\Thing.js:3` vs `src/screens/Thing.js:3`); now normalised
through a `rel()` helper.

**Do NOT** fix this by re-pinning the hashes — that bakes CRLF into the pin and
breaks CI instead — and do not edit the freeze test's logic; it is the guard for
the Costco path.

**Durable rule.**

> Any test that compares bytes, filesystem paths, or OS-formatted strings makes
> its answer depend on where it ran. That is invisible while CI is the only venue
> that matters — and becomes load-bearing the moment local runs are the way a
> branch gets verified. The cost of a permanently-red local suite is not the red:
> it is that people stop reading the result.

## 243. A dead token re-presented for nineteen days, and nobody was told (2026-09-11)

**An expired Google ID token was sent on every wake, forever.** `getValidIdToken()`
returned the stale token unconditionally once both refresh paths missed, so the
same dead credential went out again and again — and the app never told the
shopper, so it simply, quietly, did not work.

**Symptom.** Six `verify_threw` refusals in the admin incident console, detail
`"Token used too late"`, across four separate days — and **in pairs landing in
the same second**, because `/api/me` and `/api/me/bootstrap` both fire on wake:

```
09-11 09:58:30  /api/me + /api/me/bootstrap   ~1h stale
09-11 07:50:46  /api/me                       ~9h stale
09-10 14:49:19  /api/me/bootstrap             ~48h stale
09-08 11:25:06  /api/me                       ~2.6d stale
09-07 10:25:38  /api/me/credits               ~19d stale   ← nineteen days
```

**Cause.** The comment defending the unconditional return was *correct* — the
server's refusal names the exact branch in `auth_outcomes`, where withholding the
token downgrades the record to a bare `auth_required`. But that argument justifies
**one** send, and was being read as a licence to send it always. Nothing bounded
it, and nothing raised the credential-rejected flag, so the home screen's
"session expired" banner — which has existed the whole time — never appeared.

**Fix.** Each distinct token gets one diagnostic send, then is burned: the
fingerprint is persisted, and every later call withholds the token and raises
credential-rejected instead.

Three details are load-bearing, and two of them are the kind that look like
paranoia until you read the table:

1. **The claim is a `Map`, not a flag.** `if (await alreadySpent) … else await
   markSpent` has an open window — the `await` yields, the second caller enters,
   the set is still empty, and *both* are "the first". That is every pair in the
   incident above. `Map.set` is synchronous: whoever creates the entry wins, and
   everyone else in that tick awaits the same decision and is told no.
2. **It persists.** An in-memory guard alone caps the loop at one pair *per
   launch* — which is exactly the observed cadence, one pair per day.
3. **Only a PROVABLE expiry burns.** `isIdTokenFresh()` is false for anything it
   cannot *parse*, not just for expired tokens. Burning an unparseable token
   would lock out a session that may be perfectly valid. Caught by an existing
   test (`an unparseable token stored by sign-in does not escalate to a re-auth`),
   not by review.

A fourth was caught by `secureStoreAccessibility.test.js`: the new SecureStore
key had to join `MANAGED_KEYCHAIN_KEYS`, or it gets the default keychain
accessibility and is **unreadable before first unlock** — so a background refresh
would re-send a token it had already burned.

**Durable rule.**

> "Send it once so the server can tell us what is wrong" is a complete argument
> for the first send and no argument at all for the second. Any deliberate
> best-effort fallback that exists to produce a DIAGNOSTIC needs a bound, because
> the diagnostic stops being new after one. And when the fallback also means the
> feature is broken, the user has to be told — a failure mode that is silent on
> the device is one that lasts as long as nobody happens to read a table.

---

## 244. A health check whose verdict contradicted its own evidence (2026-09-11)

**`revenuecat` rendered bright red with a `?` badge, directly above a line reading
"webhook: configured · syncApi: configured".**

**Cause.** Two lines, entirely mechanical. `rcChecks` was `{ webhook, syncApi }`
with **no `status` key** — every other entry in `checks` is `{ status, …detail }`.
So `statusTone(undefined)` fell through every branch to `"bad"`, and the pill
printed `check.status || "?"`. Nothing was broken. The screen just had no way to
say *"I do not know"* and spelled it exactly the way it spells *"on fire"*.

**Fix, on both sides** — either alone leaves the trap set for the next check:

- **Server**: `revenuecat` carries a roll-up `status`, and it is a *conjunction*
  (both write paths or it is `degraded`, never `configured`). A route test asserts
  **every** check in the payload has a non-empty status.
- **Client**: `statusTone()` gained an explicit `unknown` bucket. A statusless
  check renders greyed out, spelled `unknown`, and is left **out of the failing
  count** — a gap in our reporting is not an outage to page somebody about. An
  unrecognised status *word* is still `bad`; that is a different thing from no
  answer at all.

**Durable rule.**

> A renderer that maps "unknown" onto the same output as "broken" will eventually
> be handed an unknown. Give every status enum an explicit absent case, and make
> its colour and its word differ from the failure case — otherwise the first
> payload that forgets a key becomes a false outage, printed on top of the
> evidence that disproves it.

---

## 245. Two blank quotas, one shrug: "unset" and "failed" were the same value (2026-09-11)

**Three quota rows rendered `? of 10` with a `?%` badge — in the GREEN pill**,
which reads as a measurement near zero rather than as no measurement at all.

**Cause.** `backend/lib/quotaProbes.js` returned `null` for *both* "the token is
not configured" and "the token is configured and the provider call failed". The
work those two imply is opposite — **add** a variable, or **fix** one — and the
console had no way to tell an operator which.

**Fix.** Three outcomes instead of two: `null` (unset), `{ used, limit }` (a
reading), `{ error }` (configured and failed, carrying the provider's own
message). The rows now read `no live reading · set CLOUDFLARE_API_TOKEN + …`, or
`the live reading failed · Provider said: HTTP 401`, and the cap-only row is
muted rather than green — it is a real ceiling, not an error. Failures cache for
60 s instead of 5 min so a token fixed at the provider appears on the next
refresh.

Note the second-order bug the old contract hid: a `null` from a *200 response we
could not parse* meant a provider schema change looked exactly like an absent
credential. That case is now an `{ error }` naming the field that was missing.

**Durable rule.**

> When a probe can fail for reasons that need different fixes, "returns null on
> any failure" is not defensive — it is lossy. Best-effort means *never throws*,
> not *never explains*. And a value the UI cannot render should never be printed
> into the success-coloured control: `?%` in a green pill is a worse answer than
> a blank one, because it looks like data.

## 246. Both sign-in buttons were dead, and the app said "try again" 89 times (2026-09-11)

- Date: 2026-09-11 · PR: pending · Area: mobile

**Symptom.** `PRICEBACK-CANADA-C` (Apple `ERR_REQUEST_UNKNOWN`, 52 events) and
`PRICEBACK-CANADA-B` (Google *"Unable to open Safari"*, 37 events). 100% iOS,
eleven distinct installs, six iPhone models, `environment: production`, every
release from 2.8.5 to 2.8.20, every event inside US-Pacific business hours. In
each session the person taps Apple, is told to try again, taps Google, is told
to try again, taps Apple again. **Nobody ever got in.**

**Cause — and the wrong cause that was fixed first.** The pairing was originally
read as a presenter collision: iOS allows one authorization session at a time,
so a second request while the first stands kills both. v2.8.13 (PR #291) shipped
`_presentAuthorization` to serialize them. **It changed nothing.** 29 further
events landed on builds carrying the lock, and the Apple:Google ratio is
identical either side of it — 25/35 = 0.71 before, 12/17 = 0.71 after.

The measurement that settles it is `attemptMs`, which the Google path has
recorded since PRICEBACK-CANADA-F: **3-60 ms in all 37 events**. Not once did an
attempt live long enough for a browser to open, and that holds for events whose
breadcrumbs show a clean onboarding screen beforehand — there was no first sheet
for a second to collide with. The failures are also 3-17 **seconds** apart, not
milliseconds. The device is refusing to present any authorization UI at all,
which is what Screen Time / MDM restrictions on Account Changes and Web Content
do, and what a managed or review-fleet iPhone looks like.

**So the shipped defect is not the failure — it is the answer.**
`err.signInPresentationBody` said *"it usually works the second time"* (0 for 37;
one install failed at 22:13:34 and again at 22:15:00), and
`err.signInUnavailableBody` sent the user to Google, which was dead in the same
session. Two locked doors, each pointing at the other.

**Fix.** Three things, none of which pretend to unlock the phone:
1. `signInWithApple` now records `attemptMs`, mirroring the Google path — a
   187 ms rejection and a 30 s one are different bugs and shared one issue.
2. After **two distinct providers** fail with a presentation-class category in
   one session, OnboardingScreen stops offering a retry and names the
   restriction (Screen Time → Content & Privacy → Account Changes / Web Content)
   with a support contact. One failure keeps the ordinary alert; a 500 never
   counts toward the tally.
3. The copy no longer promises a retry will work, and the two code comments that
   asserted the refuted cause now carry the measurement instead.

**Files.** `src/services/authService.js` (`signInWithApple`, the presenter
note), `src/services/errorSupport.js` (the `unable to open safari` branch note),
`src/screens/OnboardingScreen.js` (`reportAndExplain`, the device-blocked
sheet), `src/services/i18n.js` (en + fr).

**Detect next time.** `attemptMs` in the Sentry event. Under ~100 ms on a sheet
that should have waited for a human means it never appeared — read it before
reading the error text, which for both providers is uninformative by design.

**Prevent.** `__tests__/onboardingSignInDeadEnd.test.js` pins the real
`classifyError` path and mutation-fails three ways (guard at 1 instead of 2,
classification ignored, alert not suppressed). It also asserts Sentry still
receives **both** failures — quieting the user must never quieten the telemetry.

**Durable rules.**

> A fix has to be checked against the field, not against the reasoning that
> produced it. The presenter lock was correct code for a real hazard and was
> shipped as the answer to an issue it had no effect on; the rate said so for
> seventeen days and nobody looked.

> When the cause is on the device and cannot be fixed, the deliverable is the
> sentence. "Try again" to someone for whom retrying provably cannot work is a
> product defect, even though every line of the failing code is behaving exactly
> as designed.


---

## 247. The check that was fine on both branches and broken in the merge (2026-09-11, PR #332)

**`checks.priceFeeds` arrived with no `status`, so the admin health row greyed
out as "unknown" while the server knew the answer precisely, per store.**

This is **#244 again, six days later**, and nothing was wrong with either half.
`main` carried the admin console, which pins *"every check in the payload carries
a status, so none can render as unknown"*. `development` carried the nightly
price feed, whose check is a **map** — `{ bestbuy: { status, reasons } }` — one
nesting level deeper than every other entry, because it answers per store. Each
branch's own suite was green. The defect existed only in the **merge**, and the
only thing that found it was running the other branch's test file against the
merged tree.

**Cause.** `checks.priceFeeds` was the store map verbatim. Every other entry in
the payload is `{ status, …detail }`, so `check.status` was `undefined`. The
console has learned (#244) to grey an absent status out rather than guess
`"broken"`, so this rendered grey, not red — a quieter failure than #244 and a
worse one to notice: the screen said *"we do not know"* about the one check that
knew, item by item, exactly what was wrong.

**Fix.** `priceFeedsRollup()` in `backend/lib/priceFeedHealth.js` — pure, so the
conjunction is unit-tested without booting a server, matching the module it joins:

- every feed available → `available`; **some** off → `degraded`; all off →
  `unavailable`. A store whose verdict never arrived counts as **off**, never as
  fine.
- The per-store entries survive alongside the roll-up. One word cannot carry
  "one of two feeds is dead", and that is the half somebody has to act on.
- **No feeds scheduled at all** reports `unavailable` + `no_feeds_scheduled`.
  The tidy-looking `"none_scheduled"` was rejected on purpose: `statusTone()`
  maps any word it does not recognise to `bad` and paints it **red**, so a new
  constant would have rendered *"there is nothing to run"* as an outage. A test
  pins that every status the roll-up can emit is one the console colours.
- The roll-up is spread **last** into the flat object, so the payload always
  answers `.status`; a test refuses a store code of `status` or `reasons` so the
  collision fails the suite instead of silently dropping a store's verdict.

**Files.** `backend/lib/priceFeedHealth.js` (`priceFeedsRollup`),
`backend/server.js` (`priceFeedStores` → `priceFeedChecks`),
`backend/tests/priceFeedHealth.test.js` (7 new cases),
`backend/tests/adminConsoleRoutesDb.test.js` (the pinned public check set gains
`priceFeeds`).

**Detect next time.** `curl /health | jq '.checks | map_values(.status)'` — any
`null` is this bug. The generic route test
(*"every check in the payload carries a status"*) is the mechanical version and
is what caught it here.

**Prevent.** The route test already existed on `main`; what was missing was
**running it against the merge**. See the durable rule.

**Durable rules.**

> A merge of two green branches is not verified by either branch's green. The
> defect lives in the pair, so the check that finds it is the *other* side's test
> file run against the merged tree — not the suite either branch signed off on.

> A contract test written as "every X has a Y" earns its keep exactly once: the
> day an X arrives from somewhere its author never saw. Prefer it to N tests that
> each name one X.

---

## 248. A Best Buy receipt that lost every SKU reported a perfect parse (2026-09-13)

**`computeParseConfidence` only penalised low SKU coverage when
`storeId === "costco"`. So a Best Buy parse with ZERO usable SKUs scored
`{ confidence: 1, signals: [] }` — and a score of exactly 1.0 is the pipeline's
instruction that there is nothing left to improve.**

Measured, on the same object with one field changed:

```
zero skus, scored as bestbuy → { confidence: 1,   signals: [] }
zero skus, scored as costco  → { confidence: 0.9, signals: ["low_sku_coverage"] }
```

**Why it costs money.** The SKU is what makes a line price-watchable.
`jobs/bestBuyPriceRefresh.js` selects its nightly targets with
`p.sku ~ '^[0-9]{7,8}$'`, and a line whose SKU the OCR lost carries a synthetic
`ln:<receiptId>:<idx>` instead — so it is excluded at the query, never quoted,
never drops and never earns the shopper a claim. Nothing on screen says so: the
receipt looks parsed, the total reconciles, and the item sits there apparently
watched.

And the one mechanism that could have recovered it was switched off by the same
bug. Confidence below 1.0 is what triggers the scan's second pass — more parse
strategies, then a high-resolution re-OCR, each adopted only on a strict
improvement. Reporting 1.0 told that pass to stand down.

**How it survived.** Best Buy was promoted off the lab lane on nine real
captures and hardened by a pass that found four more defects, then audited eight
days later. The audit **found** this one and correctly declined to fix it
(finding 9) because the fix lands in `receiptParsingShared.js`, which is shared
parsing code and therefore treated as Costco under the standing rule. It stayed
open because the obvious fix — widening the `costco` gate to a set of store ids
— was the wrong shape, not because the defect was unclear.

The realocr suite asserted `confidence === 1` for all nine captures and passed
throughout. It was true, and on this dimension it was **vacuous**: the signal
could not fire for this store regardless of the input.

**Fix — and why it is not a shared rule.** Every store prints a different
receipt, so "is this parse trackable?" has a different answer per retailer and
the same rule cannot serve two of them:

| | identifier | denominator | store-number signal |
| --- | --- | --- | --- |
| Costco | item number, every item | every item | warehouse number |
| Best Buy | 7–8 digit SKU, non-zero-padded | **trackable lines only** | none — a number invented from a shipping address is worse than null |
| Sport Chek | 12–13 digit UPC, which does not address the catalogue at all | — | `STR n REG n` |

So the scorer learns a **mechanism**, never a store's rule. A parser stamps
`parserSignals: [{name, cost}]` on its result; `computeParseConfidence` applies
whatever it finds there. Costco's block is **byte-identical and stamps nothing**,
so no Costco score can reach the new code at all — the change is purely additive
(`git diff` shows zero removed lines in that file).

Best Buy's rule lives in `bestBuyReceiptParser.js` as
`bestBuyTrackabilitySignals`, applied at the single exit point every format
already passes through.

**The denominator is the interesting half.** Best Buy service lines — Geek Squad,
protection plans, memberships — **carry SKUs**; the file's own comment says they
are "indistinguishable from a product by shape alone". They are also never
price-watched. Counting them inflates coverage, and the inflation hides exactly
the case that matters: four protection plans plus one television whose SKU was
lost scores 80% and stays silent, while the only claimable line on the receipt is
unwatchable. Measuring trackable lines only, it scores 0% and fires.

**Evidence the fix is safe.** All nine real captures are at **100%** SKU
coverage, so not one moves off `confidence: 1`. What changes is that the
assertion now means something.

**Guards.** Both halves are mutation-tested — stopping the parser stamping, and
making the scorer ignore what it stamped, each turn the same test red. Costco
invariance is pinned explicitly (its signals, their order, its penalties, and
that it keeps measuring coverage over *every* item including ignored ones), and
the freeze hashes, the golden snapshot and the Costco realocr suite all pass in
the same run.

> A store-gated rule is a rule that is silently absent for every store it does
> not name. When the gate is a literal store id, ask what the OTHER stores score —
> the answer is usually "full marks", and full marks is an instruction.

> A test can be green, honest, and vacuous at the same time. `expect(confidence)
> .toBe(1)` passed for nine receipts on a signal that could not fire for that
> store at all.

---

## 249. The annual plan advertised "2 FREE MONTHS" on a subscription that has no free trial (2026-09-14, PR #336)

- Date: 2026-09-14 · PR: #336 · Area: mobile
- Symptom: App Review rejects the build under **Guideline 3.1.2(c)** — *"the app
  includes references to a free trial for the subscription, but the submitted
  subscriptions do not include a free trial period."* The letter names no
  control, so the first reading in-house was that Apple had confused the **75
  welcome credits** with a subscription trial. It had not.
- Root cause: the **Annual** half of the billing toggle rendered a caption
  reading **"2 FREE MONTHS"** (`paywall.twoFreeMonths`). To App Review, "free
  months" printed on an auto-renewable subscription **is** a free-trial claim,
  and `priceback_unlimited_annual` carries no introductory offer to back one.
  The copy was never wrong about the money — annual really is cheaper — it was
  wrong about the **kind of thing on offer**. A discount is not a trial.
- Second defect, same line of code: the claim was a **fixed string beside a
  dynamic price**. `pricing.config.js` hardcodes annual at `$49.99`; the
  reviewer's screenshot shows `$39.99/year`. At 4.99/49.99 a year costs ~10
  months of monthly spending; at 4.99/39.99 it costs ~8. The written-down "2
  months" is true on neither and verifiable on nothing.
- Fix: `storePrices.annualSavings(monthlyInfo, annualInfo)` derives the saving
  from the two **live** StoreKit prices and returns `null` — render nothing —
  unless both prices are present, the currency codes match, and a real saving
  exists. The percentage is **floored**, never rounded up. "12 months for the
  price of N" prints only when N lands within 0.15 of a whole month. The caption
  became `SAVE {percent}%`; the tier card carries the price comparison. Every
  free-period word left subscription copy in both languages.
- Files: `src/services/storePrices.js` (`annualSavings`),
  `src/components/Paywall.js` (`savingsForTier`, the toggle caption, the value
  line), `src/screens/ManageSubscriptionScreen.js` (`unlimitedSavings`),
  `src/services/i18n.js` (both language blocks),
  `shared/pricing.config.js` + `backend/shared/pricing.config.js`.
- Detect next time: `npm test` — `__tests__/noFreeTrialClaims.test.js` fails the
  build on any free-period word in a `paywall.*` / `manage.*` /
  `catalog.tier.*` key, in **every** language the bundle defines.
- Prevent: the guard above, plus `__tests__/paywallAnnualBadge.test.js`, which
  renders both purchase surfaces with a **real annual SKU**. That is the gap
  that let this ship: every pre-existing render test gives the Unlimited tier
  `annual: null`, so `_anyAnnualPlan` was false, the toggle never mounted, and
  no suite had ever seen the control.

> A price written into the bundle cannot track what a storefront charges. If a
> number is going to sit next to a live store price, derive it from that price —
> `monthlyEquiv: "$4.17"` (Bugs #211-era) and "2 FREE MONTHS" are the same bug
> twice, four months apart.

> Read the rejection for the *control*, not the vocabulary. "Free trial" in
> Apple's sentence meant our badge, not our free credits — and the word "trial"
> appears nowhere in the app's UI. Asking "which pixel is it looking at?" beats
> matching their words against our feature names.

> A UI element behind a feature flag that no fixture enables is untested no
> matter how green the suite is. `annual: null` in every mock meant 5,541
> passing tests and zero coverage of the control that got the app rejected.

## 250. A second egress path posted Gmail receipt content to the backend (2026-09-14 audit H1, PR #338)

- Date: 2026-09-16 · PR: #338 · Area: mobile
- Symptom: none observed — found in the 2026-09-14 security audit, and latent
  today only because `gmailSyncEnabled: false` at build time. It fires the day
  CASA verification clears and that flag flips.
- Root cause: `isGmailSourcedReceipt` had exactly **one** caller,
  `syncReceiptToBackend`. A second egress path, `registerForPriceWatch` →
  `POST /api/watch`, filtered on claimed + expiry + `isWatchableLine` and never on
  source — so mailbox-derived item names, SKUs and prices were posted to the
  backend, which stores the array verbatim in `watched.json`. That is the
  "transfer" the `gmail.readonly` restricted-scope **Limited Use** claim filed
  with Google rules out.
- **The comment is the interesting part.** The gate's own comment stated Gmail
  receipts are local-only *"unconditionally"*, and justified it by reasoning that
  the crowd path "is Costco+SKU-shaped and rejects everything else". True of
  `crowdRepo.recordObservation`; **not** true of the `watchedItems.set` half
  sitting beside it, which the comment never considered. A comment asserting a
  guarantee the code does not make is worse than no comment — it is why nobody
  re-checked.
- Fix: the predicate moved to `src/utils/receiptSource.js` — dependency-free and
  **statically** importable, so every egress path can consult it without dodging
  an import cycle. A dynamic `await import()` was the alternative and is the wrong
  one: its failure mode is **fail-open**, which for a compliance gate means leaking
  the data it exists to hold back. The gate runs **first** in the filter chain for
  the same reason — a compliance refusal must not depend on another predicate
  having run.
- Detect next time: for any predicate that enforces a compliance promise, grep its
  call sites and count them against the paths that leave the device. One caller
  against two egress paths was visible from a single grep.
- Prevent: 4 cases in `priceServiceNetwork.test.js` pin it in its **strongest**
  form — no mailbox-derived string of any kind on the wire, not merely "the array
  is the right length" — plus the legacy-row fail-closed path and Outlook still
  registering. Standing rule: a gate with one caller and more than one egress path
  is a bug, not a design.

## 251. A column called `ip_hash` held a raw, client-supplied IP address (2026-09-14 audit M1, PR #338)

- Date: 2026-09-16 · PR: #338 · Area: backend
- Symptom: none observed. Plaintext PII in `consent_events` — the one record that
  deliberately **outlives account soft-deletion**, so the consent trail survives a
  PIPEDA / Law 25 question.
- Root cause, one line with two defects:
  `ipHash: (req.headers["x-forwarded-for"] || req.ip || "").toString().slice(0, 80)`
  (1) it was never hashed, and (2) it read the raw `x-forwarded-for` **header**
  ahead of `req.ip` — exactly the attacker-controlled value
  `app.set("trust proxy", 1)` exists to neutralise. A client could write any string
  it liked into its own legal audit row: a forged address, or the whole
  comma-separated proxy chain.
- **The column's own name concealed both.** Nobody re-reads a line called `ipHash`
  to check whether it hashes.
- Fix: use `middleware/audit.js`'s existing `hashIp` — one directory away, already
  in use by the request audit log, salted with a per-process-day random so rows
  cannot trivially link a user across days. The row builder moved to
  `lib/consentEvents.js` and is now **pure**: it cannot see headers at all, so
  defect 2 is *unrepresentable* rather than merely fixed.
- Why pure, not just corrected: a DB-backed test for this would be one of the
  suites that silently **skips** when `.env` is absent and still exits green —
  the worst possible property for a test whose subject is a legal record.
- Detect next time: `grep -rn "x-forwarded-for" backend/` and check the ORDER. The
  other two readers (`audit.js`, `clientIpForRateKey`) both correctly prefer
  `req.ip` and fall back to the **rightmost** hop; the consent line was the only
  leftmost read in the codebase.
- Prevent: `consentEvents.test.js` (13). Mutation-tested — returning the raw ip
  goes red. Standing rule: a field named `*_hash` gets a test asserting the stored
  value does not equal the input.

## 252. A malformed size declaration bought an unbounded presigned upload URL (2026-09-14 audit M3, PR #338)

- Date: 2026-09-16 · PR: #338 · Area: backend
- Symptom: `{"imageBytes": "x"}` returned a presigned PUT with no `ContentLength`
  into the production R2 bucket — the upload cap was opt-out-able by sending
  garbage instead of a number.
- Root cause: `imagePresignDecision` treated a **malformed** declaration exactly
  like an **absent** one. The unbounded absent branch is a real, documented
  compromise for builds already in the field; malformed was never that case. The
  client proves it — `imageBytesForPresign` returns a finite positive number or
  `undefined`, never a string, never `NaN`.
- **The existing suite had pinned "not-a-number" and `NaN` into the absent set,
  encoding the hole.** A test can hold a bug in place, and this one did: anyone
  who tightened the branch would have gone red and assumed they were wrong.
- Fix: malformed is now **capped**, not refused. A garbled declaration is not a
  declared intent to upload something huge — that is the over-cap branch, which
  still refuses — and every real capture fits far under the ceiling. The JS
  coercion quirks (`[]` to 0 to refused, `true` to 1 to a one-byte cap) are
  asserted separately so that list cannot be quietly widened back.
- Detect next time: for any "absent means unbounded" compromise, ask what
  *malformed* does. The two are the same branch far more often than intended.
- Prevent: 2 new cases in `imagePresignCap.test.js`; reverting the malformed
  branch to unbounded goes red.

## 253. Twelve routes had no rate limit, and two caps bounded the count but not the size (2026-09-14 audit M11/M12, PR #338)

- Date: 2026-09-16 · PR: #338 · Area: backend
- Symptom: none observed. `GET /api/barcode/resolve` was **public and
  unauthenticated** with three DB round trips per call, against a session pooler
  capped at 15 connections shared with the always-on development service.
  `PUT /api/me/profile` appended up to 10 rows per call to `consent_events`, which
  is append-only by design and deliberately outlives account deletion, so nothing
  prunes what one account can add.
- **The audit named three routes. Writing the catch-all invariant found nine
  more** — the three price-tag-review routes (one **grants credits**), the three
  credit-reconciliation routes (one **applies** them), `flyer-scan/commit` (a
  2000-item bulk write), `unlinked-products` and `barcode-link`. The three a human
  could name by reading were a quarter of the real answer, because a human reading
  a 9,000-line file finds the routes they happen to look at.
- Second defect (M12): `POST /api/analytics` bounded every field except
  `properties`, which was written whole — 200 events per batch, 60 batches an hour
  per IP, against a 10 MB body limit, into files **nothing pruned**, on the same
  volume as `watched.json` and the send-once notify ledger. Filling that disk does
  not merely lose analytics: it **breaks the price-watch registry and starts
  sending duplicate pushes**. `POST /api/watch` capped `items.length` at 500 and
  item contents not at all, and the map key is a client-chosen `deviceId`, so an
  abuser mints unlimited keys.
- Fix: all twelve on the shared brake, grouped by desk, charged **after** the admin
  check so a non-admin cannot drain an admin's bucket by hammering a route they
  cannot use. Analytics properties bounded by **serialized size** rather than a
  field whitelist (properties are free-form by design; a whitelist would silently
  drop new events instead of refusing oversized ones), plus a 30-day prune reading
  the day **from the filename** rather than the mtime — a redeploy that copies the
  volume rewrites mtimes and would spare every file forever.
- **Two mutations survived the first draft of the tests**: reverting the analytics
  route to write `e.properties` whole, and deleting the prune's call site from
  `runDailyMaintenance`. Both left the suite green, because the tests asserted the
  helpers in **isolation** and never that anything called them. *A correct helper
  nothing calls is not a fix.*
- Detect next time: write the catch-all, not the list. `routesAreRateLimited.test.js`
  asserts that **no** `/api/admin` route with `requireAuth` lacks a brake — the
  failure here is precisely the route nobody thought about.
- Prevent: `routesAreRateLimited.test.js` (9) + 11 cases in `security.test.js`,
  including the off-by-one at exactly the cap. Standing rule: when you fix a helper,
  mutate its **call site** too — a test that only exercises the helper cannot tell
  you the helper is wired.

## 254. The drizzle 0.45 upgrade turned every transient DB failure into a permanent one (2026-09-16, PR #340)

- Date: 2026-09-16 · PR: #340 · Area: backend
- Symptom: none observed yet — found while reading the log of a PASSING test run.
  Would have surfaced as 500s instead of 503s during a Supabase restart, and as
  retry loops that stop retrying at the exact moment retrying is correct.
- Root cause: drizzle-orm >= 0.45 wraps every query failure in
  `DrizzleQueryError`, whose constructor sets `this.cause = cause` and **does not
  copy `code`**, and whose `message` is `Failed query: <sql>\nparams: …`.
  `db/client.js:isTransientDbError` read exactly two things — `err.code` and
  `err.message` against a word list — so after the bump the code was `undefined`
  and the driver's own text ("terminating connection due to administrator
  command") appeared nowhere in the message. Measured:
  `isTransientDbError(pgError('…','57P01'))` → `true`;
  `isTransientDbError(DrizzleQueryError(sql, [], <that same error>))` → `false`.
- **The full 1592-test suite passed with this in place.** No test throws a
  transient error through a real drizzle query; the failures the suite does
  provoke are deterministic (a numeric overflow proving transaction rollback),
  and those are correctly non-transient either way. A dependency bump can change
  the SHAPE of an error without changing any behaviour a test asserts.
- Blast radius: `/health` (`transient: false`, `code: null` for a live outage),
  any route mapping transient → 503, and `seedWithRetry`, whose entire 15-second
  budget exists to ride out a pooler-saturation window.
- Fix: `isTransientDbError` and a new `dbErrorCode` walk the `cause` chain rather
  than reading the top error. A loop, not a single `.cause`: the wrapper is one
  layer today and a future version nesting another must not silently reopen it.
- Detect next time: after any ORM/driver major, grep for `err.code` and
  `err.message` in error-classification paths and ask what the new wrapper does
  to each. The tell here was a `DrizzleQueryError` in a **passing** run's log.
- Prevent: `drizzleErrorUnwrap.test.js` (19) pins BOTH directions — seven
  transient shapes stay transient once wrapped, and five permanent ones (`23505`,
  `23503`, `42P01`, `22003`, a plain bug) are NOT dragged into transience by the
  unwrap. Deliberately needs no database: a file that silently skips is how this
  survived. Standing rule: classify on the whole cause chain, never on the top
  error alone.

## 255. A resold phone let the new owner erase the previous owner's contributions (2026-09-16, PR #341)

- Date: 2026-09-16 · PR: #341 · Area: backend
- Symptom: none observed. `DELETE /api/me/observations` (and the account-erasure
  path) deleted EVERY crowdsourced observation carrying a device hash, and
  `owner_sub` transfers on assertion — so the second account on a shared, resold
  or hand-me-down phone erased the first account's contributions, as could anyone
  who learned the deviceId.
- **The obvious fix was already tried and reverted, and that is the lesson.**
  Refusing the transfer (`COALESCE(existing, new)`) went red against
  `barcodeDeviceDb.test.js`, which asserts the transfer outright. That is a
  stated invariant, not fixture drift (Bugs #185): without it the second account
  is permanently unable to delete its own data or export it —
  `callerOwnsDevice` answers false for them forever. A hardening item traded for
  a data-rights regression.
- Fix: leave the claim rule alone and scope the DELETION. New
  `devices.owner_claimed_at` (migration `0007`), and
  `crowdRepo.revokeForDevice(deviceId, { since })` bounds the delete to rows
  created at or after the current owner claimed the device.
- **Keyed on `created_at`, never `observed_at`.** `observed_at` is mutable, an
  ON CONFLICT re-observation moves it, and a receipt's purchase date can backdate
  it — keying on it would let a caller drag another owner's rows inside their own
  window and delete them. `created_at` is the immutable insert time.
- Why a column and not a join: `price_points` carries `device_hash` and no owner
  by design, and `credit_ledger.ref = price_points.source_ref` only covers
  observations that EARNED a credit — the observation route is deliberately
  anonymous ("nobody to credit later"). A partial answer on a deletion path
  silently keeps rows the user asked to erase.
- Both fail-open cases are deliberate: no boundary (an anonymous caller) and an
  unparseable boundary both delete unscoped. Leaving data behind after a user
  asked for it to go is the PIPEDA / Law 25 failure, and it is worse than
  deleting a little extra from a device the caller already proved they own.
- **Mutation testing changed the PR twice.** (1) Every assertion was against the
  repo helper — the same shape that let two M12 mutations survive in the
  2026-09-14 audit; two route-level tests were added, and removing
  `{ since: claimedAt }` from the call site now goes red. *A correct helper
  nothing calls is not a fix.* (2) `IS DISTINCT FROM` had to replace `<>`:
  `NULL <> 'sub'` is NULL, so with `<>` a FIRST claim over an existing UNOWNED row
  never stamps — the common real sequence, since an anonymous `/api/device/sync`
  creates the row and the user signs in afterwards. Every test created its row
  fresh via INSERT and missed it.
- Detect next time: when a permission check and a destructive helper disagree
  about SCOPE, fix the helper. "Who may call this" and "what this may touch" are
  separate questions, and only the second bounds the damage.
- Prevent: `deviceObservationScopingDb.test.js` (10), including the ON CONFLICT
  claim path and two tests that DELETE through the real route. Migration applied
  by hand to both databases before the merge; historical transfers are not
  retroactively protected, because the timestamp was never recorded.

## 256. The claim countdown closed a day early in Canada — and the guard written to catch this had never once run (2026-09-17, PR #342)

- Date: 2026-09-17 · PR: #342 · Area: mobile (price-adjustment window)
- **Symptom:** none reported by a user, which is part of the problem. Found while
  closing out the 2026-09-16 session's one deferred finding. A shopper in
  Vancouver opening the app after 16:00 local, or in Toronto after 19:00, was
  shown **one day fewer** of adjustment window than they had — and at the
  boundary the receipt flipped to "Expired", the watch stopped, and the receipt
  was de-registered from backend price watching. East of Greenwich the error runs
  the other way: Cairo was shown one day MORE between 00:00 and 02:00.
- **Root cause.** `priceService.daysRemaining` mixed three clocks in one
  expression:

  ```js
  const purchase = new Date(purchaseDate);                  // date-only ISO -> UTC midnight
  const expiry = new Date(purchase);
  expiry.setDate(expiry.getDate() + store.adjustmentDays);  // LOCAL calendar arithmetic
  const diff = Math.ceil((expiry - new Date()) / 86400000); // instant difference, 24h buckets
  ```

  `purchaseDate` is a **local** calendar date (`todayLocalISO`, or the printed
  date off the receipt). Parsing it as UTC midnight, then doing local `setDate`,
  then differencing instants, makes the result depend on both the device's offset
  and the time of day.

  Measured against a pure-calendar reference for every hour of 2026: **the number
  of broken hours per local day equals the UTC offset, and the sign follows the
  offset's sign.**

  | Zone | Wrong during these local hours | Direction |
  |---|---|---|
  | UTC, Europe/London | none | — |
  | America/Vancouver | 16:00–23:59 (8 h/day) | **undercounts by 1 day** |
  | America/Toronto | 19:00–23:59 (5 h/day) | **undercounts by 1 day** |
  | America/St_Johns | 21:00–23:59 (3 h/day) | **undercounts by 1 day** |
  | Africa/Cairo | 00:00–01:59 (2 h/day) | overcounts by 1 day |
  | Asia/Tokyo | 00:00–08:59 (9 h/day) | overcounts by 1 day |
  | Pacific/Auckland | 00:00–12:59 (13 h/day) | overcounts by 1 day |

  A second, independent defect sat on the same line: `setDate` on an *instant*
  walks wall-clock days, so a window spanning a DST transition is 24 h ± 1 h out
  and `Math.ceil` rounds it the wrong way. That is what the
  `expect([a, b]).toContain(result)` hedges in `priceService.test.js` were
  quietly accommodating.
- **It was not a display bug.** The same comparison gated three writers:
  `storageService.updateExpiredReceipts` (writes `status:"expired"`, clears
  `watchEnabled` on every item, **mirrors each stop to the backend durably**, so
  it survives a reinstall), `priceService.checkAllPriceDrops` (which receipts get
  checked at all) and `priceService.registerForPriceWatch` (what is POSTed to
  `/api/watch` — the surface that sends the push). So the Canadian shopper lost
  the last day of the window *and* the notification that would have told them
  there was something to claim.
- 🔴 **Why every test stayed green — read this part.** Three independent reasons,
  and the first is the one with teeth beyond this bug:

  1. **Assigning `process.env.TZ` inside a Jest test does nothing.** Node re-reads
     the zone only when the assignment goes through the real `process.env`
     setter; Jest hands each test file a cloned env object, so the setter never
     fires. Measured: setting TZ to `UTC`, `Asia/Tokyo`, `America/Vancouver` and
     `Pacific/Auckland` in turn produced the **same local hour every time**.
     **Four suites in this repo were written that way** —
     `purchaseDate.test.js`, `receiptParsingShared.test.js`,
     `ocrServiceExtra.test.js`, `receiptPipeline.live.test.js` — each running at
     one ambient zone while naming nine. One of them is the matrix added by
     **#159** specifically to stop a local/UTC mix from recurring. It has never
     measured anything.
  2. **The fixtures cancelled the bug out.** `daysAgo`/`inDays` in
     `coreScenarios.test.js`, `priceService.test.js` and
     `priceService.extended.test.js` did local `setDate` then `toISOString()` —
     the *same* clock-mixing the production code committed — so both sides
     drifted together and the assertions held.
  3. **CI runs at UTC**, the single offset where none of it reproduces.
- **Fix.** Calendar arithmetic, in two small modules:
  - `src/utils/adjustmentWindow.js` — pure, and contains **no `Date` token at
    all**, greppable by a test. Same discipline as `utils/purchaseDate.js` after
    #159, but enforced rather than requested, because the #159 version was a
    comment and the next editor walked past it. Day-number primitive is Hinnant
    `days_from_civil`/`civil_from_days`, verified against the platform for all
    **109,938 days from 1900-01-01 to 2200-12-31**.
  - `src/utils/localClock.js` — the only file allowed to cross between the wall
    clock and a calendar date (`todayLocalISO`, `localInstantAt`). Its own grep
    guard: no `new Date("<string>")`, no `setDate`, no `toISOString`.

  Converted with it: `adjustmentExpiry` (now **local** midnight, so
  `i18n.formatDate` stops printing the previous day west of Greenwich — do NOT
  hand `formatDate` the ISO string, it re-parses as UTC midnight), the two window
  filters, `updateExpiredReceipts`, all three notification schedulers, and
  `ScanScreen`'s "watch until" preview. That preview was the **only correct copy
  in the app**, so the same receipt showed two different expiry dates on two
  screens.
- **Detect next time.** Ask what the counter says at 22:00 local and at 10:00 the
  next morning for the same receipt: if it changes by more than one, or if
  "Expires: <date>" disagrees with the ScanScreen preview, it is this. In the DB,
  a receipt whose client says expired while `policy_status` still says `watching`
  is the *expected* one-day difference (see below), not this bug.
- **Prevent.**
  1. **A `process.env.TZ` loop inside a Jest test proves nothing.** The only
     mechanism that works is TZ in the **process environment**, so
     `__tests__/adjustmentWindowTimezone.matrix.test.js` re-runs the
     date-sensitive suites in a **child process per zone**. It lives in a test
     rather than in the workflow because `ciParity.test.js` forbids test
     parameters there — which means a plain `npm test` runs a real matrix,
     locally and in CI alike.
  2. **A zone matrix alone is not enough — pin the HOUR too.** The defect hides
     for 19 hours out of 24 in Toronto, so a zone-only matrix would have been
     green all morning and red in the evening, and been dismissed as a flake.
  3. **Never build a fixture with the arithmetic under test.** Use
     `Date.UTC(localY, localM, localD) ± n*86400000`: that builds a *label*, not
     an instant, and stays in UTC afterwards, so it is exact at every offset.
  4. Do calendar work with no `Date` at all, and grep for it.
- **Deliberately NOT changed, and tracked separately:** the client treats day
  `purchase + N` as **closed**; `backend/repos/receiptsRepo.js`
  `recomputePolicyStatus` treats it as **open** (`expired iff purchase_date +
  window < today`). The two have differed by one day since long before this, the
  difference exists at UTC, and this fix *narrows* it (to 24 h − |offset|). Moving
  it is a data change with a durable backend side effect, so it gets its own PR.
  Pinned by a named test so nobody "fixes" it by accident.
- **Also recorded, not fixed:** `backend/priceDropNotifier.js` `urgencyTier` calls
  itself a deliberate mirror of the mobile `priceDropUrgency`. It is not one any
  more — mobile flips at local midnight, the server at UTC midnight, so the emoji
  in a push title can be one tier from the chip in the app for ~|offset| hours
  around each of the two crossings. **No backend-only change closes it**: the
  server does not know the device's offset. The fix is to send the device's local
  date with the watch registration. The stale comment was corrected in the same
  PR even though the code was not, because a false "kept in sync" note is how the
  next person recouples them.
- **Files:** `src/utils/adjustmentWindow.js`, `src/utils/localClock.js` (new);
  `src/services/priceService.js` (`daysRemaining`, `priceDropUrgency`,
  `adjustmentExpiry`, new `adjustmentExpiryISO` + `isWindowOpen`),
  `src/services/storageService.js` (`updateExpiredReceipts`),
  `src/services/notificationService.js` (all three schedulers),
  `src/screens/ScanScreen.js`, `backend/priceDropNotifier.js` (comment only).
  Tests: `__tests__/adjustmentWindow.test.js`, `localClock.test.js`,
  `adjustmentWindowTimezone.test.js`, `adjustmentWindowTimezone.matrix.test.js`,
  `storageServiceExpiryWindow.test.js`, plus the de-poisoned helpers in
  `coreScenarios`, `priceService`, `priceService.extended` and the real
  `todayLocalISO` in `screens.test.js`.
- **Proof the new matrix bites:** reverting `todayLocalISO` to `toISOString()`
  leaves **UTC green** and fails all six other zones, with the failure count
  scaling by offset (Auckland 53, Tokyo 37, Vancouver 28, Toronto 16). 24 guards
  mutation-tested, all killed — and mutation testing changed the work twice: it
  exposed a month-boundary probe the suite lacked (every probe sat mid-month, so
  `getMonth` → `getUTCMonth` survived) and a window-length contract that only
  a numeric string could distinguish.

## 257. The database connection encrypted the wire and verified nobody (2026-09-17, PR #344)

- Date: 2026-09-17 · PR: #344 · Area: backend (db/client.js)
- **Symptom:** none observable. Nothing fails, nothing logs, and every test
  passes — which is the entire difficulty with this class.
- **Root cause.** `getPool()` opened every pool with

  ```js
  ssl: { rejectUnauthorized: false },
  ```

  unconditional, no environment branch, production included. Four lines above
  it a comment claimed the setup "pins our TLS behavior so it can't drift". It
  did pin it — to the weakest setting available.

  TLS then provides confidentiality against a *passive* observer and nothing at
  all against an active one. Anyone able to get in path between Railway and
  Supabase presents any self-signed certificate and the pool accepts it, reading
  **and rewriting** every statement: user emails, `credit_ledger`, receipts, and
  `user_sessions.refresh_token_hash` — which is a sufficient credential for
  `rotate()`, so the at-rest hashing in `sessionsRepo` is undone in transit.
- **Fix.** Bundle Supabase's published root and verify against it:
  `ssl: { ca: databaseCa(), rejectUnauthorized: true }`.
- **What made it non-obvious.** The instinct is "just set it to true". Measured
  first: the pooler chains to `Supabase Root 2021 CA`, a self-signed root in no
  public trust store, so strict mode against Node's default CA set fails
  `SELF_SIGNED_CERT_IN_CHAIN`. The choice was never "strict or lax" — it was
  "bundle their root, or verify nothing". Setting `rejectUnauthorized: true`
  without the CA takes production's database away.
- **Generalisable rules.**
  1. **A CA certificate is not a secret and belongs in the repo**; a private key
     never does. `backend/certs/*.crt` is the public half, the same way
     `certs/certificate.pem` is committed while `keys/` is banned outright.
  2. **Pin the anchor's fingerprint in a test.** A CA file is trust, in a file.
     Swapping it silently re-points every connection at whoever issued the
     replacement, and no behavioural test notices because the connection still
     works.
  3. **Give operators a way to change WHO you trust, never WHETHER you verify.**
     `DB_SSL_CA` replaces the anchor for a rotation or a provider move. A
     `DB_SSL_INSECURE=1` flag is how this defect returns: it gets set in the
     middle of an outage and never unset. The test asserts no such var exists.
  4. **A comment asserting a guarantee the code does not make is worse than no
     comment** — it is why nobody re-read the line for months. Same shape as H1
     of the 2026-09-14 audit.

## 258. #341 stopped the new owner ERASING the old owner's data, not READING it (2026-09-17, PR #344)

- Date: 2026-09-17 · PR: #344 · Area: backend (crowdRepo, data-export)
- **Symptom:** none reported. `GET /api/me/data-export` returned every
  crowdsourced observation ever made from a device — SKU, price, warehouse,
  province, date — to whoever currently owned the device row, including
  contributions made by a previous owner. A purchase-behaviour profile of
  another person.
- **Root cause.** `devices.owner_sub` transfers on assertion, deliberately;
  refusing the transfer was tried once and reverted because it strands the
  second account on a resold phone (entry 255). PR #341 closed the dangerous
  half by bounding `crowdRepo.revokeForDevice` to `owner_claimed_at` — and
  bounded **only the delete**. `contributionsForDevice` took no boundary at all,
  so the same assertion that no longer let you erase someone else's rows still
  let you export them.

  Reachable without owning anything first: `/api/device/sync` performs the
  transfer with no ownership check, so asserting a stranger's deviceId there and
  then calling the export was the whole attack.
- **Fix.** The same predicate on the read — same column (`created_at`,
  immutable), same null-means-unscoped semantics for devices claimed before
  migration 0007.
- **Generalisable rules.**
  1. **When a finding has a read path and a write path, fix both in the same
     change.** This repo has now paid for the twin-path defect three times
     (`imagePresignDecision`, the price-tag vs receipt objectKey check, and
     this). A fix applied to one of two symmetric paths reads as complete in
     review, because the half you changed is correct.
  2. **Export and erase must describe the same set.** Unbounded, the export
     listed rows the delete refused to remove — a user could see data they could
     not erase. That inconsistency shipped and nobody noticed, because nothing
     compared the two answers. A test now does.
  3. **Read the file's own history before applying the obvious fix.** The plan
     for this work said "add `callerOwnsDevice` to `/api/device/sync`".
     `devicesRepo.js`'s header says that exact fix was written, shipped to CI and
     reverted. Applying it would have traded this finding for a data-rights
     regression against a real user.

## 259. The "secret capability token" was a hash of four public attributes (2026-09-17, PR #344)

- Date: 2026-09-17 · PR: #344 · Area: mobile (purchaseService.getDeviceFingerprint)
- **Symptom:** two, and the second needed no attacker. Device ids were
  **enumerable** from a device-model list; and users with the same phone model,
  OS version and RAM **shared one device row**, so one person's
  `DELETE /api/me/observations` erased another's contributions and they shared
  the anti-reinstall scan count that gates free scans.
- **Root cause.** The hardware id was appended only `if (hardwareId)`, and all
  three ways it can come back empty — the API missing, an empty string, a throw
  — were silently swallowed. On that path the id collapsed to
  `SHA256("Samsung|SM-G991B|13|8")`: brand, model, OS version, RAM. The further
  fallbacks were worse — `btoa(parts.join("|"))` is **reversible**, and the last
  resort was `Math.random()` seeded from `Date.now()`.

  `backend/server.js` documents `callerOwnsDevice` as safe *because* this value
  "behaves like a secret capability token", and six routes rest on that sentence.
- **THE SUITE HAD ENCODED THE DEFECT.** Three tests asserted it as intended
  behaviour: that a thrown lookup still produced "a fingerprint (no id in it)";
  that missing descriptors "still produce a stable fingerprint" over
  `nb|nm|nov|0`; and that a digest failure fell back to "a bounded btoa hash".
  The suite was green on an id six routes treat as a capability.
- **Fix.** The hardware id is now mandatory for the derived scheme; without it a
  256-bit CSPRNG id is minted. Ids are scheme-tagged (`h1_`/`r1_`/`r0_`) so the
  populations stay countable.
- **Generalisable rules.**
  1. **An identifier is only a capability token if it is unguessable.** If code
     elsewhere is authorised *because* a value is secret, the generator is a
     security control and must be audited as one.
  2. **"Optional entropy" is no entropy.** `if (x) parts.push(x)` on the only
     unguessable input means the guessable branch is what ships to whoever hits
     the error path — and error paths are exactly where nobody looks.
  3. **A collision is a security bug, not a quality bug.** Two users sharing an
     identifier means one user's delete acts on another user's data.
  4. **Migrate by leaving the cache alone.** The cached-id read comes first, so
     no existing install loses its identity, its scan count or its history; only
     new generations change. A fix that reset every device id would have been a
     worse outage than the defect.
  5. **Returning nothing is not automatically the safe answer.** Refusing to
     produce an id was written first and reverted: every deviceId route rejects a
     missing id, so it would have stopped scanning and OCR outright.

---

## 260. A one-line privacy fix to a push title failed five tests in three files (2026-09-19, PR #346)

- **Date:** 2026-09-19 · **Area:** backend (tests)
- **Symptom.** CI on `main` went red with five price-drop failures that looked
  like three different bugs: two assertion failures ("crowd-verified drop
  pushed", "the flyer-authoritative P1 drop is pushed"), one string mismatch,
  and one test that sat for **60 seconds** and then reported `Timed out waiting
  for the post-import background sweep's push`. Nothing was wrong with the
  sweep, and every push fired exactly as designed.
- **Root cause.** Security roadmap **L-6** took the product name out of the
  verified-drop push title (`{emoji} Price drop on {item}` →
  `{emoji} Price drop on a recent purchase`) because a push renders on a locked
  screen and crosses Expo, then Apple or Google, in the clear. Five tests
  identified *which* push was which by that text —
  `sent.find(m => m.title.includes("Test product A"))` — so with the name gone
  every lookup returned `undefined`. The timeout was the same bug wearing a
  worse costume: a `waitFor` whose predicate can never be true does not fail,
  it waits out its whole ceiling first.
- **Fix.** Address a notification by its machine payload, never by its copy.
  The drop tests now key on `data.currentPrice` (every fixture verifies at a
  distinct price) plus `data.type`. Both halves of L-6 are now pinned
  explicitly — the title and body must NOT contain the product name — so the
  privacy property is asserted instead of merely assumed.
- **Files:** `backend/tests/priceDropDb.test.js`,
  `priceDropPipelineE2E.test.js`, `priceDropWindowSourceDb.test.js`;
  the change under test was `backend/lib/pushI18n.js` +
  `backend/priceDropNotifier.js`.
- **Generalisable rules.**
  1. **User-visible copy is not an identifier.** Anything a translator, a
     designer or a privacy review may rewrite must not be the key a test
     matches on. `data.*` exists for machines; titles and bodies exist for
     people.
  2. **A polling helper converts a wrong predicate into a timeout.** When a
     `waitFor` reports a timeout, ask whether the predicate *could* have
     matched before looking for what is slow. The 60 s ceiling here was
     correct; the predicate was not.
  3. **When you remove a field from a payload, grep the tests for its value,
     not just for its name.** `displayName` appeared nowhere in the five
     failing assertions — `"Test product A"` did.
  4. **A privacy property deserves a negative assertion.** Removing the name is
     a one-word edit away from being undone; `assert.doesNotMatch(title, ...)`
     is what makes putting it back a test failure rather than a silent leak.

## 261. Two test runs against one database delete each other's rows — and it reads as a bug in the code under test (2026-09-19, PR #346)

- **Date:** 2026-09-19 · **Area:** backend (test harness)
- **Symptom.** Two tests in two different files failed seven seconds apart with
  `TypeError: Cannot read properties of null (reading 'scanCredits')` —
  `sybilVerificationDb` and `tagCreditsEngineDb`. Each one creates a user, calls
  one function, reads the user back, and gets `null`. Neither reproduced in
  isolation, repeatedly. The shape ("a row I just wrote is gone") points
  straight at the repo layer, and that is where the investigation goes.
- **Root cause.** Nothing deleted those users from inside the run. Every backend
  suite — CI's and every developer's — points at the **same** shared development
  database, and `tests/helpers/purgeTestData.js` deletes by **marker**, not by
  run id: any sub starting `qa-`/`test-`/`seed-`..., **and any address at
  `@example.com` or `@test.local`**. `engine-ruleN-sub-0@example.com` and
  `sybil-attacker-<run>@test.local` both match. So a second run's post-purge —
  which `scripts/run-suite.js` performs unconditionally, on pass or fail —
  deletes the rows a run still in flight is using, from another machine. The
  existing lock lived in `os.tmpdir()` and could only see the local machine,
  which is not where the contention is.
- **Fix.** `backend/scripts/runLock.js` — a Postgres **session-level advisory
  lock** (`pg_try_advisory_lock`) taken before the clean-slate pre-purge and
  released after the post-purge. A run that cannot take it refuses to start and
  says why. Session-scoped means a killed run cannot wedge the lock: the
  database releases it when the connection drops. Every failure to *attempt* the
  lock (no `DATABASE_URL`, unreachable host) fails **open** — a suite that
  cannot run because its mutual-exclusion plumbing broke is worse than the race.
- **Files:** `backend/scripts/runLock.js` (new),
  `backend/scripts/run-suite.js`, `backend/tests/runLockDb.test.js` (new),
  `__tests__/ciParity.test.js`.
- **Detect next time.** Failures that (a) cluster in time rather than by
  subject, (b) are all "a row I just created is missing", and (c) never
  reproduce alone. Check whether the missing rows match a purge marker before
  reading any application code.
- **Generalisable rules.**
  1. **Cleanup that matches by marker matches other people's rows too.** The
     only safe blast radius for a destructive sweep is one run's own data;
     anything broader needs mutual exclusion, not care.
  2. **Put the lock where the contention is.** A lock in `os.tmpdir()` cannot
     see CI, and CI is the other party. Shared database, shared lock.
  3. **A harness that can corrupt a run must be the one to say so.** Left
     silent, it spends the next engineer's afternoon in the repo layer.
  4. **Fail open on the guard, not on the work.** Refusing to run because the
     lock could not be attempted turns a rare race into a permanent outage.

## 262. A launch policy asserted against a database that is supposed to change (2026-09-19, PR #346)

- **Date:** 2026-09-19 · **Area:** backend (tests)
- **Symptom.** `storePoliciesDb` failed on `exactly one store should be enabled
  at launch`. Nothing about store go-live had changed in the commit under test.
- **Root cause.** The assertion read `GET /api/v1/policies.json`, which serves
  the **shared development database** — and Best Buy was enabled there, because
  Best Buy and Sport Chek ride the lab lane and get switched on in dev while
  they are still dark in production. The test made a product invariant depend on
  an environment whose entire job is to drift, so it went red the moment someone
  did exactly what the lab lane is for. Both ways out were bad: turn off a store
  another thread of work needs, or delete the assertion.
- **Fix.** Split by oracle. The DB-backed test keeps what is true in *every*
  environment — every store carries an explicit `enabled` boolean, and Costco is
  enabled. The launch invariant moved to `backend/data/policies.json`, the file
  `db/deploy/store-content-sync.sql` is generated from, which is what actually
  puts the launch set on a database. It needs no DB, so it runs everywhere.
- **Files:** `backend/tests/storePoliciesDb.test.js`,
  `backend/data/policies.json`, `backend/db/deploy/store-content-sync.sql`.
- **Generalisable rules.**
  1. **Assert a policy against the artefact that declares it**, not against a
     running copy that something else is allowed to edit.
  2. **A test that a legitimate action turns red is a wrong test**, however
     correct the property it names.
  3. **Shared mutable state is not an oracle.** If two people may both be right
     about a value, no assertion on it can be.

## 263. Tightening the secret-scanner allowlist exposed two test fixtures — and the two obvious fixes are both forbidden (2026-09-19, PR #346)

- **Date:** 2026-09-19 · **Area:** repo/CI
- **Symptom.** The Security job failed with `leaks found: 2` on a tree where
  nothing secret had been added: a JWT in `__tests__/gitleaksAllowlist.test.js`
  and a synthetic one in `backend/tests/authOutcomesRepo.test.js` (its signature
  is literally `base64("signature")`).
- **Root cause.** Both had been in the tree for weeks, **hidden by the very
  allowlist entry the 2026-09-14 audit (M6) tightened**. The old i18n pattern
  was unbounded in segment length, so it silently muted every dot-separated
  alphanumeric token in the repo — including real JWTs. M6 bounded it, and the
  two fixtures it had been covering became visible. The scanner was not newly
  wrong; it had newly started working.
- **Fix.** Neither of the reflexes `.gitleaks.toml` forbids. **Not** a path
  exemption (that hides every future secret in the same file), and **not** a
  wider regex (an allowlist that can spell a credential is not an allowlist —
  and `gitleaksAllowlist.test.js` asserts exactly that, so adding the JWT to the
  allowlist would have failed the test that exists to prevent it). Instead both
  fixtures are **joined from their segments at runtime**, the idiom that file
  already used for its other vectors: split, the tree carries no JWT; joined,
  the value under test is byte-for-byte what it always was.
- **Files:** `__tests__/gitleaksAllowlist.test.js`,
  `backend/tests/authOutcomesRepo.test.js`, `.gitleaks.toml` (unchanged — on
  purpose).
- **Generalisable rules.**
  1. **New findings after tightening an allowlist are a backlog, not a
     regression.** Expect the first honest scan to be the noisy one.
  2. **A scanner reads shape, not secrecy.** "It is only a fixture" is an
     argument for changing the fixture, not for muting the rule.
  3. **Never widen an allowlist to cover a credential shape.** The next real
     credential of that shape ships silently, and nothing reports it.

## 264. A receipt in the price-tag scanner did not fail to parse — it succeeded (2026-09-21, PR pending)

- **Date:** 2026-09-21 · **Area:** mobile/scan, backend/observations
- **Symptom.** A user photographed a Costco receipt inside the **price tag**
  scanner. Two invented products reached the live production catalog:
  `CREV 16/20` at $27.69 (a real receipt line, filed as a shelf price) and
  `APPROVED - THANK YOU … AMOUNT 220,50` — the payment footer — keyed by the
  receipt's **invoice number** (006967) as its SKU. Two `price_points`, two
  pending admin reviews, two admin pushes.
- **Root cause.** `parseCostcoTags` segments text on SKU-shaped numbers, and a
  receipt is a table of `<sku> <NAME> <price>` rows, so the item table became N
  candidate "tags". The filter (`costcoTagScanner.js:466`) accepts any segment
  carrying a price **and** a word, which every receipt line does; `tagSubmittable`
  then passed them all. `confidence` is computed and never consulted. **Nothing
  anywhere classified the document** — verified across `src/`, `backend/`,
  `shared/`, `scripts/`.
- **Fix.** `shared/documentKind.js`: a conjunction of ≥2 distinct receipt marker
  FAMILIES and zero Costco register labels. Both halves are load-bearing —
  `hotDogAndMandu` is a genuine multi-tag photo that trips two structural
  families and is saved only by its "PRICE AT REGISTER" label, while the
  PII-scrubbed Gloucester captures carry no membership number or transaction
  footer and are caught only by SHAPE (multi-row item table, per-line tax flags,
  trailing-negative discounts).
  Enforced on **both** sides: the client offers the receipt scanner carrying the
  photo already taken, and `POST /api/observations/tag` refuses with
  `RECEIPT_NOT_A_TAG` before any write.
- **Files:** `shared/documentKind.js`, `src/services/costcoTagScanner.js`
  (one added early return), `src/services/tagScanQueue.js`,
  `src/screens/PriceTagScanScreen.js`, `src/screens/PendingTagScanScreen.js`,
  `backend/server.js`.
- **Generalisable rules.**
  1. **The server half is the fix; the client half is the UX.** OTA is
     unavailable on the current EAS plan, so a client-only gate reaches nobody
     until every user installs a new build. The API gate covers every binary
     already in the field the moment it redeploys.
  2. **A computed-but-unread signal is not a guard.** `confidence` existed for
     months and stopped nothing. Make the verdict binary and load-bearing.
  3. **A wrong document needs a third terminal state.** The offline queue had
     `ready_review` (a lie — no tag in the photo) and `error` ("couldn't read
     it, enter by hand" — an invitation to hand-type a receipt into a tag form).
     Read the SENTENCE a status renders, not its constant name.

## 265. A Quebec receipt parsed 3 of its 11 items, and every invariant agreed (2026-09-21, PR pending)

- **Date:** 2026-09-21 · **Area:** mobile/receipt parsing
- **Symptom.** Found while turning the receipt from #264 into a fixture — the
  first French receipt ever captured. The parse returned **3 items, a $48.67
  subtotal and `reconciled=true`** for a $220.50 receipt, and the whole realocr
  suite passed on it.
- **Root cause — five, each independently fatal.**
  1. **Decimal commas.** Quebec prints `29,99`; every price pattern required a
     period and read a comma as a *thousands* separator. 3 of 10 price lines
     recognised — exactly the three Vision happened to read with a period.
  2. **The `FP` tax flag.** Quebec marks a line F (TPS), P (TVQ) or FP (both).
     Every price pattern allows ONE flag character, so `12.99 FP` matched none
     of the eighteen of them — hiding the column-split "bas du panier" block and
     losing its first two items. `countPurchaseLines` missed it too, because
     `[HPFRYNGB]\b` cannot match the `F` in `FP`.
  3. **`TAXE`.** `tax(?:es)?` cannot match the French singular: the boundary
     after `TAX` fails on the following `E`. The tax row became a $19.61 **line
     item** and the tax fell through to a fallback that picked up the coupon.
  4. **`SOUS - TOTAL`.** Geometry joins words with single spaces, so a hyphen
     Vision read as its own word yields a spelling `includes("sous-total")`
     misses. `extractPrintedTotal` then returned the SUBTOTAL (200.89) as the
     grand total, which made a 10-item parse **outscore** the correct 11-item
     one. The English half of that alternation was already spacing-tolerant.
  5. **The Quebec coupon**, printed as a bare `<barcode> / <sku>` with no
     TPD/CPN keyword.
- **And the guard built to catch exactly this could not fire.** The items-sold
  cross-check scans ±3 lines from its label for a bare integer; here the `11`
  sits 4 lines below, behind an interleaved `TOTAL RABAIS` and its two amounts.
  Same for the discount total. Nothing ever compared 3 against 11.
- **Fix.** `shared/receiptLocale.js` detects the language first and normalises
  the **notation** — decimal commas, the FP flag — rather than forking a second
  French parser. Plus the four label fixes above, and both self-check windows
  widened to ±6 (safe because a count is a BARE integer among decimals and the
  discount is the only amount with a leading `$`).
- **Files:** `shared/receiptLocale.js`, `src/services/costcoReceiptParser.js`,
  `src/services/receiptParsingShared.js`, `scripts/captureReceiptOcr.js`.
- **Generalisable rules.**
  1. **One parser, two notations — not two parsers.** The receipt's STRUCTURE is
     identical in both languages; only the separator and a few labels differ. A
     second parser duplicates every hard part and then drifts, which is the
     failure `ocrCleanup.js` and `receiptPiiScrub.js` already warn about.
  2. **A self-check that returns null is not a passing self-check.** Both
     counters read `null` here, so `scoreParse` had nothing to disagree with and
     scored a 3-of-11 parse as fine. Assert that a check FIRED, not just that it
     did not object.
  3. **Bilingual patterns rot asymmetrically.** Four of the five defects were an
     English spelling that had been made tolerant and a French one beside it
     that had not. When you loosen one alternative, loosen its siblings.
  4. **The corpus is the oracle.** "Zero false positives" and "44 receipts
     round-trip byte-for-byte" are measurable over committed fixtures. Measure
     them; do not assert them in prose.

## 266. Every French receipt carried a real membership number into the repo (2026-09-21, PR pending)

- **Date:** 2026-09-21 · **Area:** tooling/fixtures, privacy
- **Symptom.** Scrubbing the Laval receipt for commit left `46 Membre
  111978813257` and the cashier's full name in the text.
- **Root cause.** `receiptPiiScrub`'s rule was `/(Members?h?i?p?\s*#?\s*)\d{6,}/`
  — which matches "Member", "Members", "Membership" and **not** "Membre". No
  French receipt had ever been captured, so nothing had exercised it.
- **Fix.** `Memb(?:ers?h?i?p?|res?)`, plus a cashier rule (FR receipts print
  `Caissier(ère): <name>` — a named employee who never chose to be in this
  repo). A dry run over all 44 existing captures confirmed **no existing fixture
  changes**, so the rules only bite on the language that needed them.
- **Files:** `scripts/lib/receiptPiiScrub.js`, `__tests__/receiptPiiScrub.test.js`.
- **Generalisable rules.**
  1. **A PII rule is only as good as the corpus it has met.** An untested
     language is an untested rule, and it fails open.
  2. **Prove the blast radius before changing a scrub rule.** Re-run it over the
     whole corpus and diff: a rule that changes nothing existing is safe to add.

## 267. The notification branch existed, and the tap still went nowhere (2026-09-21, PR pending)

- **Date:** 2026-09-21 · **Area:** mobile/notifications
- **Symptom.** Tapping the admin "price tag awaiting review" push opened the app
  to wherever it happened to be, even though `App.js:341` had an explicit
  `tag_review → AdminTagReview` branch and a test asserting it.
- **Root cause — two, stacked.**
  1. The branch only runs for a **warm** app. A tap on a killed app never
     reaches `addNotificationResponseReceivedListener` at all: the process
     starts, the listener registers after the fact, and the only record of the
     tap is the one the OS holds via `getLastNotificationResponseAsync` — which
     was never called anywhere in the repo.
  2. Even calling it would not have been enough. `SplashScreen` `replace`s the
     whole stack 1.8–2.6 s after mount (6 s on the failsafe), so any `navigate`
     issued before that lands is silently discarded by it.
- **And a third, wider one.** The tap callback's signature was
  `(receiptId, type)`, which discarded every other field — so `reviewId`,
  `storeCode`, `balance` and `count` could not reach the navigator **even where
  a branch existed**. Only 4 of 16 push types routed anywhere.
- **Fix.** The callback forwards the payload verbatim;
  `src/services/notificationRouting.js` maps all 16 types in one pure table. The
  cold-start route is **parked** (`pendingDeepLink.js`) during the awaited
  notification init and taken by SplashScreen immediately after it decides the
  user may enter — and dropped entirely when the answer is Onboarding.
  `navigationRef` becomes a `createNavigationContainerRef` so `isReady()` exists.
- **Files:** `src/services/notificationRouting.js`, `src/services/pendingDeepLink.js`,
  `src/navigation/navigationRef.js`, `src/services/notificationService.js`,
  `src/screens/SplashScreen.js`, `App.js`.
- **Generalisable rules.**
  1. **"The branch exists" is not "the path runs."** Ask which lifecycle states
     reach it. Warm, backgrounded and cold-started are three different programs.
  2. **A navigate before the splash resolves is a no-op, not a race.** Park the
     intent and replay it after the stack it targets exists.
  3. **A callback signature is a contract about what can ever be used.**
     `(receiptId, type)` capped the feature at two fields for the life of the
     code — no amount of branch-adding downstream could recover the rest.
  4. **Enumerate the senders, not the branches.** The guard that keeps this
     fixed walks every backend push site, extracts each `data.type`, and fails
     if any is unroutable — in both directions, so a type the table declares but
     nothing sends is caught too. Mutation-checked: renaming one entry
     (verified 1 → 0 occurrences) fails it.

## 268. An iPhone photo is HEIC, whatever the object key says (2026-09-21, logged not fixed)

- **Date:** 2026-09-21 · **Area:** mobile/upload, admin review
- **Symptom.** The tag photo at `prod/price-tags/3bd8cf9d6aafe539/4.jpg` is not
  a JPEG. Its magic bytes are `ftypheic` — an iPhone HEIC — stored under a
  `.jpg` key, presigned as `image/jpeg`. Google Vision refuses it outright
  ("Bad image data"), and it had to be transcoded before it could be read.
- **Why it matters.** The OCR that produced this scan's `raw_ocr` clearly read
  *something*, so the client appears to send a converted copy to `/api/ocr`
  while uploading the ORIGINAL to R2. The admin review screen then presigns a
  GET for a file many renderers cannot display, so the reviewer may see a broken
  photo for iOS uploads while the scan itself looked fine.
- **Status.** **Logged, not fixed** — out of scope for the 2026-09-21 hotfix by
  explicit decision. Worth its own change: confirm where the conversion happens,
  whether the upload can reuse the converted copy, and whether the presigned
  content-type should follow the actual bytes.
- **Generalisable rule.** An extension and a presigned content-type are
  assertions, not facts. If a pipeline can receive a file it did not create,
  check the magic bytes before trusting either.

## 269. A new user's first sign-in could 503 — two requests created one account (2026-09-23, PR #350)

- **Date:** 2026-09-23 · **Area:** backend/users, auth
- **Symptom.** 2026-09-22 00:42 UTC: a brand-new iPhone user's first
  `GET /api/me/bootstrap` answered `503 bootstrap_unavailable` — "service
  unavailable" on the very first screen. The retry 8 s later worked, and the
  account had been created in the same second the 503 was served.
- **Root cause.** The bootstrap and `POST /api/auth/session` started in the same
  millisecond and both ran `usersRepo.upsertFromOAuth` for an account that did
  not exist yet. `INSERT … ON CONFLICT (sub) DO NOTHING` arbitrates **only**
  `users_pkey`. The referral code is derived from the sub, so both inserts carried
  the same code and the loser tripped the **non-arbiter** unique index
  `users_referral_code_unique` — raised by Postgres as a plain 23505, which the
  clause does not absorb (Postgres log 00:42:03.978). Two-to-four concurrent
  first upserts are the iOS norm: see #273.
- **Fix.** `upsertFromOAuth` re-runs its transaction **once** when a unique
  violation leaves this sub's row in place (it then takes the existing-user
  branch; the trial grant stays once-only via `trial_credits_granted_at`). A
  violation with no row for the sub is a genuine collision of the derived code
  and is thrown as a named `ReferralCodeCollisionError`.
- **Evidence the test catches it:** stress on the dev DB, 4 parallel first
  sign-ins per round — original code lost **2 of 80** rounds to production's
  exact 23505, fixed code **0 of 40**. The regression test does not wait for the
  race: it injects a REAL driver error (a real insert tripping the real index)
  into the losing attempt.
- **Files:** `backend/repos/usersRepo.js`, `backend/db/client.js`
  (`dbErrorCause`), `backend/tests/usersRepoUpsertRaceDb.test.js`.
- **Generalisable rules.**
  1. **`ON CONFLICT` protects exactly one index.** Every other unique index on
     the table is a plain error under concurrency. Enumerate them when writing an
     upsert.
  2. **A value derived from the conflict key is not safe in a second unique
     column** — it makes two concurrent inserts of one key collide on BOTH.
  3. **Test a race by injecting the real error into the losing attempt.** A test
     that waits for the interleaving passes by luck (here: 2 rounds in 80).

## 270. A dropped refresh response burned a real session — the 30 s window measured the wrong retry (2026-09-23, PR #350)

- **Date:** 2026-09-23 · **Area:** backend/sessions, iOS
- **Symptom.** An Apple user on iOS lost their whole first-party session:
  `user_sessions` shows `#50` rotated to `#56` at 2026-09-22 19:06:54, the
  phone's connections all dropping at 19:06:55.24 (app suspended mid-refresh —
  `session/refresh` 499 after 1157 ms), and the relaunch **82 s** later
  re-presenting `#50` → `reuse_detected`, family revoked. Two later re-mints
  were dropped the same way; the phone has run on ten-minute Apple tokens since.
- **Root cause.** Bugs #216's replay rule serves a rotation the client never
  received — the security condition is *no descendant has ever been presented*,
  and it held (`#56.last_used_at` was null). But it also required the retry
  within `SESSION_REPLAY_GRACE_MS` = 30 s, sized for the retry of an 8 s client
  abort. The retry that actually comes after a suspension is the **next launch**.
  The 3.6 s refreshes of #272 widened the window in which the OS suspends the app
  mid-answer.
- **Fix.** Default 30 s → **24 h** (chosen over a week). The clock-free condition
  is unchanged; the env override and `/health` reporting are kept.
- **Files:** `backend/repos/sessionsRepo.js`,
  `backend/tests/sessionReplayGraceDb.test.js` (82 s and next-day relaunches
  served; a presented heir burns its parent hours later),
  `backend/tests/healthSessions.test.js`.
- **Generalisable rule.** Size a grace window by the retry that actually comes,
  not the one you designed for — and keep the security decision clock-free, with
  the clock only as a bound.

## 271. The error log carried the user, and not the cause (2026-09-23, PR #350)

- **Date:** 2026-09-23 · **Area:** backend/logging, auth_outcomes
- **Symptom.** #269's 503 wrote the new user's Google sub, email address, **full
  name** and photo URL to Railway's log, while its `auth_outcomes.detail` held
  300 characters of SQL and no cause — the 23505 had to be dug out of the
  Postgres log. Separately, 42 `auth_outcomes` rows stored a Google sub and the
  start of an email address.
- **Root cause.** Two libraries put personal data in their error MESSAGES:
  drizzle ≥ 0.45 (`Failed query: <sql>\nparams: <bound values>`, the driver error
  on `cause`), and google-auth-library (`Token used too late, X > Y: {decoded
  payload}`). The backend logs `err.message` at 111 sites in `server.js` alone;
  `authOutcomesRepo._scrub` only knew `Bearer` and `eyJ…` shapes.
- **Fix.** `backend/lib/errorRedaction.js` — `redactSensitive` (params tails,
  token-payload tails, JWTs, Bearer values, email addresses), `describeError`
  (`db 23505 users_referral_code_unique on insert into priceback.users: …`), and
  `installConsoleRedaction`, installed first thing in `server.js` so every
  console site is covered. `_scrub` uses it; the auth / bootstrap / session /
  `/api/me` / referral catch sites record `describeError`.
- **Generalisable rules.**
  1. **A library's error message is data you do not control.** Redact at the
     sink (the console), not at each call site — the next site is written
     tomorrow.
  2. **Record the driver's error, not the wrapper's message.** The code and the
     constraint are the diagnosis; the SQL is not.
  3. **A redaction test needs a fixture produced by the real library** — a
     genuinely signed expired JWT refused by google-auth-library, drizzle's real
     `DrizzleQueryError` — or a format change slips past it.

## 272. The backend ran in Singapore, its database in Montréal, and nobody knew (2026-09-23, PR #351)

- **Date:** 2026-09-23 · **Area:** infra/Railway
- **Symptom.** Bootstrap p50 5.3 s on Android and 3.3 s on iOS (max 7 s); session
  refresh 3.6 s; `GET /api/me` 2.7–5.8 s, so the app's 5 s reconcile budget
  expired (a steady stream of 499s); the splash's 6 s failsafe fired on signed-in
  cold starts; once, the pool gave up mid-SCRAM at its 5 s connect timeout
  (`ECLIENTSOCKETCLOSED … auth_scram_final_wait`).
- **Root cause.** Railway `asia-southeast1` (every deployment since ≥ 09-08, dev
  too) against Supabase `ca-central-1` (prod and dev): ≈ 230 ms per query and
  ≈ 2 s per new pooled connection, with a 30 s idle timeout forcing 48–94
  reconnects an hour. A doc even stated the egress was US.
- **Fix.** `backend/railway.json` → `deploy.multiRegionConfig`:
  `us-east4-eqdc4a` × 1 and `asia-southeast1-eqsg3a: null`.
- **Generalisable rules.**
  1. **Check where a service runs relative to its database.** 230 ms × a dozen
     sequential queries is a slow app no code review will find.
  2. **Pin the region in config-as-code**, so it is visible and reviewable.
  3. **When moving regions through config-as-code, null the old one** — the
     config merges into the manifest, and a leftover replica runs every
     in-process cron twice.

## 273. iOS opened two or three sessions per sign-in (2026-09-23, PR #352)

- **Date:** 2026-09-23 · **Area:** mobile/auth (iOS)
- **Symptom.** 9 of 11 Apple sign-ups in `user_sessions` have 2–3 session
  families created within the same minute; only one is ever used. Each mint
  also upserts the user — the concurrent first insert behind #269.
- **Root cause.** `openFirstPartySession` had two callers that did not know about
  each other: the sign-in finalizer, and `_reopenSessionAfterFallback`, which
  `authedFetch` fires whenever a provider token succeeds on iOS — and every
  request made before the first session is stored qualifies. The re-open path
  was single-flighted only against itself.
- **Fix.** One in-flight mint shared by every caller; a session "generation"
  bumped whenever a pair lands in the keychain, read by `authedFetch` when the
  request leaves and again when it returns — a changed value means the session
  arrived mid-flight, so no re-open. A genuinely lost session (cleared by a 401)
  is not a landing and still re-opens.
- **Generalisable rule.** Two single-flight guards on two entry points to ONE
  side effect are not a single-flight guard. Put the latch on the side effect.

## 274. Every handled error was captured twice — Dedupe hid it (2026-09-23, PR #352)

- **Date:** 2026-09-23 · **Area:** mobile/analytics, Sentry
- **Symptom.** None visible — which was the problem. Found while making Sentry
  file App Review's device-refused sign-ins (PRICEBACK-CANADA-B/C) at `info`.
- **Root cause.** `_Sentry.withScope?.((scope) => { …; captureException(e) })
  ?? _Sentry.captureException(e)`. `withScope` returns its callback's value —
  `undefined` — so the `??` fallback ran on every call and captured the error a
  second time outside the scope. Sentry's Dedupe integration dropped the twin
  only because it was identical; a scoped level or fingerprint would have made
  them differ, and the unscoped copy would have reached Sentry as a plain error.
- **Fix.** An explicit `typeof withScope === "function"` branch. Device-refused
  sign-in categories (`signin_unavailable`, `signin_presentation_failed`) are
  filed at `info` under `["signin-device-refused", flow]`; the on-screen copy is
  unchanged.
- **Generalisable rule.** `a?.() ?? b()` asks whether the CALL returned nullish,
  not whether `a` exists.

## 275. Every deploy forgot every watch list — and then re-sent pushes already sent (2026-09-24, PR #354)

- **Date:** 2026-09-24 · **Area:** backend/notifications, infra
- **Symptom.** Silent. After each deploy the boot log read `[DB] Loaded 0 watched
  tokens from disk` (eight deploys in the week of the 2026-09-23 audit). A user
  who did not open the app got no flyer/web-price alert until they did; once the
  phones re-registered, the next sweep pushed drops that had already been pushed.
- **Root cause.** Production has **no Railway volume**, so `DATA_DIR` resolves
  inside the image and is recreated empty by every deploy. The watch registry
  (`watched.json`) and the sweeps' send-once ledger (`notifyLedger.json`) lived
  only there. The admin `/health` `checks.storage` had reported `ephemeral` for
  weeks; the remedy it recommended — mount a volume — would have made every deploy
  take the API offline (a service with a volume cannot overlap deployments).
- **Fix.** Migration `0010_durable_watch_state` (`watch_registrations`,
  `sweep_notify_ledger`) + `lib/durableWatchState.js`: the Maps stay the hot
  path, the tables are their durable mirror, rebuilt at boot — ledger FIRST. Sends
  are persisted before the batch goes to Expo; a failed write is retried, not
  dropped; `/api/watch` writes are monotonic on `touched_at`. The ledger stores a
  SHA-256 digest of the send key, never the push token (old raw-key files are
  re-digested on load).
- **The trap that came with durability.** Account deletion and the data export
  only knew `dev:<deviceId>` keys; every user who allows notifications is under
  `push:<token>`. The wipe-per-deploy had been hiding it. Both routes now resolve
  the `push:` key from the caller's own `users` row.
- **Files:** `backend/db/migrations/0010_durable_watch_state.sql`,
  `backend/lib/durableWatchState.js`, `backend/repos/watchRegistryRepo.js`,
  `backend/repos/sweepNotifyLedgerRepo.js`, `backend/server.js`.
- **Detect next time.** Boot log `[WatchState] restored N watch registrations and
  M sends from the database`; `select count(*) from priceback.watch_registrations`.
  A `[WatchState] … not restored: 42P01` line means the migration never reached
  that database.
- **Guardrail.** `tests/watchStateServerDb.test.js` "deploys" the process (empties
  the Maps, runs the boot restore) and asserts the watch and the send both survive;
  mutation-checked (disable the ledger restore → red).
- **Generalisable rule.** **Ephemeral state is a data-loss bug even when nothing
  errors.** A health check that says "ephemeral" is a finding — and its remedy has
  to be weighed for regressions: the obvious one here (a volume) cost downtime on
  every deploy.

## 276. An OCR scan in the first seconds after a deploy reset the month's Vision count (2026-09-24, PR #354)

- **Date:** 2026-09-24 · **Area:** backend/budgets
- **Symptom.** Reproduced on dev, not seen in prod data: with 500 Vision units
  stored for the month, one scan served before the boot restore produced
  `[Budget] restored from kv_state · Vision 1/1000`.
- **Root cause.** The budget's durable copy is `kv_state` (the file is empty after
  every deploy — #275). `restoreBudgetsFromKv()` runs AFTER `listen()`, and every
  OCR request calls `saveBudgets()`, which wrote the in-memory counters straight to
  `kv_state`. A scan in the gap wrote "1" over "500"; the restore read the 1 back.
  The cap that keeps Vision inside Google's free tier reset with it.
- **Fix.** `kv_state` writes wait until the restore has read the stored count; the
  restore merges `max(stored, file-at-boot) + usage-since-boot`; a failed restore
  keeps writes OFF and retries (30 × 60 s), because undercounting one process's
  usage is a lesser loss than overwriting the month.
- **Files:** `backend/server.js` (`persistBudgetsToKv`, `restoreBudgetsFromKv`,
  `_mergeRestoredCount`), `backend/tests/ocrBudgetRestoreRaceDb.test.js`.
- **Guardrail.** The test reproduces the race against the real `kv_state` row and
  asserts 501; mutation-checked (remove the gate → red).
- **Generalisable rule.** **A restore that runs after the server starts must gate
  every write it could lose to.** "Snapshot on every save" plus "restore on boot"
  is a race unless the first save waits for the restore.

## 277. The first query on every new database connection would throw on pg@9 (2026-09-24, PR #354)

- **Date:** 2026-09-24 · **Area:** backend/db
- **Symptom.** `DeprecationWarning: Calling client.query() when the client is
  already executing a query is deprecated and will be removed in pg@9.0` in the
  Railway logs (traced with `--trace-deprecation` in the 2026-09-23 audit).
  Harmless on pg 8; on pg 9 the first statement on each new connection throws.
- **Root cause.** `db/client.js` issued `SET search_path` from the pool's
  `connect` EVENT, fire-and-forget. pg-pool emits it from inside the driver's
  connection callback, before the client is marked ready, so the `SET` was still
  queued when `pool.query()` pushed the caller's statement behind it.
- **Fix.** pg-pool's `onConnect` hook (3.14+, shipped with pg 8.21), which the
  pool awaits before releasing the client. A failed `SET` now fails the checkout
  instead of handing out a connection that resolves against `public`.
- **Files:** `backend/db/client.js` (`pinSearchPath`),
  `backend/tests/dbSearchPathOnConnectDb.test.js`, `backend/tests/dbClientPool.test.js`.
- **Guardrail.** The test listens for the driver's own warning on a fresh
  `pool.query()` (in its own file: node emits a deprecation once per process),
  and checks three concurrent new connections all land on `priceback`.
- **Generalisable rule.** **Per-connection setup belongs in a hook the pool
  awaits, never in an event it emits.**

## 278. "RLS disabled on 44 tables" — not an open door, but one grant from one (2026-09-24, PR #354)

- **Date:** 2026-09-24 · **Area:** backend/db, security
- **Symptom.** Supabase's security advisor on PRODUCTION lists every `priceback`
  table under "RLS disabled". Dev's advisor did not flag the same tables — most
  likely because dev does not expose the schema to its Data API (not verified).
- **Root cause.** Not an exposure on the day it was examined — `anon`,
  `authenticated`, `service_role` hold no USAGE on the schema, and nothing uses the
  Data API — but that rested on a single grant.
- **Fix.** Migration `0009_enable_row_level_security`: RLS on every table, no
  policies, never FORCEd. The backend is `postgres` — owner of every table, and
  BYPASSRLS — so no query changes. Afterwards the advisor lists the tables under
  the INFO-level "RLS enabled, no policy" lint: the intended posture.
- **Guardrail.** `tests/rowLevelSecurityDb.test.js` reads the live catalog, so a
  future table without RLS fails the suite; and proves it behaviourally — a
  rolled-back grant to `anon` reads 0 rows (27 before).
- **Generalisable rule.** **Defence in depth means a second layer that holds when
  the first is changed by hand.** A grant is one dashboard click away.

## 279. "Nobody on iOS 27 has signed in" — two people had; the Darwin mapping was off by one (2026-09-24, docs only)

- **Date:** 2026-09-24 · **Area:** diagnostics
- **Symptom.** The 2026-09-23 audit kept "an iOS 27 sign-in problem cannot be ruled
  out" as a watch item, reading every real iOS request as `Darwin/25` (iOS 26).
- **Root cause.** The old offset (iOS 18 = Darwin 24, iOS 26 = Darwin 25) does not
  continue: **iOS 27.0 is `Darwin/27.0.0`** (Sentry: build `24A437`, `Darwin Kernel
  Version 27.0.0`; `CFNetwork/3896`). Looking for `Darwin/26` finds nothing.
- **What the data said.** `consent_events.user_agent`: two real accounts (not the
  reviewer account) completed Sign in with Apple + onboarding on `Darwin/27.0.0` —
  2026-09-14 (build 40) and 2026-09-17 (build 41), both Canadian.
- **Generalisable rules.** (1) **Take the OS→kernel mapping from a source that
  reports both** (a Sentry event's `os` context) — never from an offset. (2) The UA
  is in `consent_events.user_agent` for every sign-up; that answers "has anyone on
  iOS N signed in?" in one query.

## 280. Apple's review device "could not load any products" — and a Canadian one would have failed silently (2026-09-24, PR #353)

- **Date:** 2026-09-24 · **Area:** mobile/purchases
- **Symptom.** RevenueCat `None of the products registered in the RevenueCat
  dashboard could be fetched` on every run of Apple's own test fleet (Cupertino,
  Chinese UI, iOS 27; 2.8.5 / 2.8.20 / 2.9.0), 2026-09-17 → 09-24.
- **Root cause.** Not a product problem: PriceBack sells in Canada only, its IAPs
  exist on the Canadian storefront only, and 2.9.0 serves all five at the correct
  CAD prices to Canadian devices. The failures began when the IAPs went live with
  2.9.0 — the 2.8.20 reviewer had seen USD prices while they were unapproved.
  What WAS wrong: the screens told a non-Canadian storefront "tap to retry"; and a
  Canadian storefront returning zero products was reported nowhere.
- **Fix.** `storePrices` exposes `outsideCanada`; Paywall / Buy Credits / Plan &
  credits say "Purchases are only available in Canada" (EN + FR) there. A Canadian
  storefront with no products is reported once per session via
  `reportHandledError` (`flow: "store_prices"`). `REVIEWER_NOTES.md` tells App
  Review to use a Canadian Sandbox Apple Account.
- **Detect next time.** A Sentry issue titled "The Canadian storefront returned no
  purchasable products" is a real outage for paying customers. The same RevenueCat
  line from a non-Canadian device is expected.
- **Generalisable rule.** **Before fixing "no products", ask which storefront
  asked.** A Canada-only catalogue is correctly empty everywhere else.

## 281. A merged PR's migration had not reached prod — every account read failed (2026-09-25, PR #356)

- **Date:** 2026-09-25 · **Area:** backend/db, release process
- **Symptom.** `GET /api/me/bootstrap` → **503** `bootstrap_threw` with
  `db 42703 on insert into priceback.users: column "city" of relation "users" does not
  exist`, then `column users.city does not exist` on every retry (31 failed statements
  10:17:12–10:18:05Z; `auth_outcomes` shows one account). `/health` stayed green the
  whole time — its `db` check is a ping, not a query against `users`.
- **Root cause.** PR #356 added `users.city` + `devices.os/brand/model` to
  `backend/db/schema.js` with migration `0011_admin_account_profile_fields`, which the
  Task_Log correctly marked "owed on prod — hand-apply". The PR was merged to `main`
  at 09:45:26Z and **Railway auto-deploys `main`** (prod `/health` uptime put the new
  process at ~09:46Z). Drizzle's `select().from(users)` names every column declared in
  `schema.js`, so from that deploy on, any request that read or wrote a user row
  failed on production's older table. Nobody opened the app for ~30 min, which is the
  only reason the window was one minute long.
- **Fix.** `0011` hand-applied to prod (`xjfrlzwonyaorwktnkpj`) at 10:22:42Z in one
  transaction with `lock_timeout = 5s`: the four idempotent `ADD COLUMN IF NOT
  EXISTS` + the drizzle ledger row (id 22, hash `c91b5992…1c4b` — the file's LF
  SHA-256, identical to dev's row 35, `created_at` = journal `when` 1790300000000).
  Afterwards the prod schema fingerprint equals dev's: `f3d6721f34b2b63d4eaa67c69ffd7a5c`,
  367 columns / 46 tables. No errors since.
- **Detect next time.** Postgres logs: `select event_message, count(*) from logs where
  source='postgres_logs' and event_message like '%does not exist%' group by 1` over the
  window after a deploy. `auth_outcomes` rows with `reason = 'bootstrap_threw'` and a
  `db 42703` detail. And before merging: the fingerprint query in
  `Technical/Migration_Consolidation_2026-07.md` on both projects must match.
- **Prevent.** Standing rule: **a PR that adds a column to a table the code reads
  with `select()` is merged only after its DDL is on prod** — the order is DDL first,
  merge second, because the merge IS the deploy. (0010's header already said "applied
  by hand, BEFORE the code deploys"; 0011's did not repeat it.)
- **Generalisable rule.** **When the merge is the deploy, "owed on prod" is an
  outage waiting for the first user.** A green `/health` proves the pool connects, not
  that the schema matches the code.

## 282. Five notifications the user could not switch off — and a new switch the server could forget (2026-09-25, PR: feat/reengagement-notifications)

- **Date:** 2026-09-25 · **Area:** both (notifications)
- **Symptom.** Found while auditing every notification for Maxim's rule *"all
  notifications must fall in a category that can be disabled"*:
  - the two offline "your scan is ready to review" alerts obeyed only the master switch;
  - the claim reminder's **"Remind me tomorrow"** snooze was scheduled with **no gate at
    all** — it fired even with every notification turned off — and with no identifier, so
    neither reconcile nor a receipt delete could ever cancel it;
  - `store_launch` had a category but **no row** on the Notifications screen;
  - the admin "Price tag awaiting review" push had no category (master only).
- **Root cause.** Each notification's category was a string literal at its call site, and
  the four lists that must agree were kept in step by comment. They are the app's
  `DEFAULT_PREFS` / `NOTIFICATION_PREF_KEYS`, the server's `_NOTIFICATION_PREF_KEYS`
  (which **silently drops** unknown keys), the seeded `notification_types`, and the
  screen's rows. `sendUserPush`'s `category` was optional — omit it and only the master
  switch applied.
- **Second, latent defect.** `notificationSettingsRepo` caches `notification_types` for the
  life of the process, but the boot seed that inserts a NEW category runs in the background
  on the first `getDb()`. A request in the first seconds after a deploy cached the OLD type
  set; from then until the next restart, `upsertMany` dropped the new code as unknown and
  every settings map lacked it. For an `explicitOnly` category that means the one row the
  server needs before it may send at all could never be written.
- **Fix.**
  - **One registry.** `shared/notificationCategories.js`, mirrored to `backend/shared`,
    maps every `data.type` to exactly one category.
  - **The server derives the gate.** `sendUserPush` derives the category from `data.type`
    and REFUSES a type with none; a caller's wrong `category` cannot route around the
    registry.
  - **The app uses the same gate.** Every local sender gates through `isAllowed(prefs,
    type)`. `settingCodes()` is the source of the server whitelist and of
    `NOTIFICATION_PREF_KEYS`.
  - **New categories.** `notifScanResults` covers the scans-ready alerts and the new
    follow-up. `notifAdminAlerts` covers the admin push, shown to admins only.
    `notifStoreLaunch` gets its row.
  - **The snooze** is now gated by its claim-reminder category and carries the id
    `expiry-snooze-<receiptId>`. Reconcile cancels it when that switch is off, and it is
    cancelled on receipt delete and by the orphan sweep.
  - **The cache race.** `_allTypes()` awaits `ensureSeeded()` before its first read, and a
    failed seed falls through to the read as before.
- **Files.**
  - Shared registry: `shared/notificationCategories.js` (+ `backend/shared/`),
    `backend/scripts/sync-shared.js`.
  - Backend: `backend/server.js` (sendUserPush, pref keys, admin push),
    `backend/repos/notificationSettingsRepo.js`, `backend/db/seed.js`.
  - App services: `src/services/{notificationService,storageService,syncService}.js`.
  - App screen: `src/screens/NotificationsScreen.js`.
- **Detect next time.** `[push] refused: data.type … belongs to no notification category`
  in the backend log is a new sender that skipped the registry. `[push] …: caller passed X,
  the registry says Y` is a call site that disagrees.
- **Prevent.**
  - `__tests__/notificationCategories.test.js`: every routable type has a category;
    defaults and keys follow the registry; labels exist in every language.
  - `__tests__/notificationsScreenDurableSync.test.js`: every category has exactly one row;
    admin-only and consent rows behave.
  - `backend/tests/notificationCategoriesRegistry.test.js`: the seed, the whitelist
    derivation, every emitted type, and every `sendUserPush` call site.
  - `backend/tests/userPushCategoryDb.test.js`: refusal, the category and master switches,
    the registry winning, marketing consent.
  - `backend/tests/notificationSettingsSeedWait.test.js`: the cache race, mutation-checked
    (it fails with the wait removed).
- **Generalisable rule.** **A rule about "every X" needs one list of X that everything else
  derives from — and a test that fails on the X nobody has written yet.** A comment saying
  "keep in lock-step" is a list that is already drifting.

## 283. Four accounts named "John Apple" — not a truncation bug, App Review's own identity (2026-09-25, branch fix/john-apple-review-account-cleanup)

- **Date:** 2026-09-25 · **Area:** backend (data cleanup registry)
- **Symptom.** Maxim spotted four `users` rows all named exactly `John Apple`,
  created 2026-09-09, 09-14, and twice on 09-17 within a minute of each other —
  timestamps that line up with iOS review-submission windows, not real signups.
  Suspected `users.name` was truncating Apple's placeholder `"John Appleseed"`.
- **What the data said.** `priceback.users` on prod (`xjfrlzwonyaorwktnkpj`): all
  four on distinct `@privaterelay.appleid.com` addresses (real, working Sign in
  with Apple accounts), `name = 'John Apple'` exactly (10 chars), **0 receipts**
  each, 0–1 devices, 2–3 sessions, `scan_credits = 75` (the untouched signup
  default), 1 ledger row (the signup grant, never spent).
- **Root cause — there wasn't one.** `users.name` is unbounded `text`, and
  `lib/displayName.js`'s `normalizeDisplayName()` caps at `MAX_DISPLAY_NAME =
  120` — nowhere near 10 chars. `authService.js` joins
  `credential.fullName.{givenName,familyName}` with no slicing either. Apple's
  identity token discloses the name **once**, on the first authorization
  ([[apple-name-disclosed-once]], PR #298); what it disclosed here was
  literally `familyName: "Apple"`, not `"Appleseed"` — a human App Store
  reviewer's own Sign in with Apple identity, distinct from the automated Cloud
  Test Lab fleet (`@cloudtestlabaccounts.com`, already covered by
  `appstore_review_accounts`) which never triggers this path at all.
- **Fix.** New classifier `apple_reviewer_named_accounts` in
  `backend/lib/dataCleanup.js`, section `store_review_accounts`: matches
  `lower(u.name) IN ('john apple', 'john appleseed')` (both known forms of
  Apple's disclosed reviewer identity, in case the longer one ever appears).
  Matched on the **name**, not the email domain — every genuine Apple sign-in
  also lands on `@privaterelay.appleid.com`, so the domain alone cannot
  discriminate a reviewer from a real shopper. Stays a `heuristic` (reviewable
  in the admin console, never auto-deleted): a real shopper coincidentally
  named this could exist, so the operator reads the receipts/devices/sessions
  sample first, same as every other classifier in this registry. The admin
  allow-list (`notProtected`) still applies.
- **Files.** `backend/lib/dataCleanup.js`, `backend/tests/dataCleanupPredicatesDb.test.js`,
  `Operations/Admin_Console_And_Data_Cleanup.md`.
- **Detect next time.** A `users` row with a normal-looking display name but
  zero receipts and a barely-touched signup grant is a reviewer or smoke-test
  account regardless of which field matched — check the footprint columns the
  `users` sample already carries before trusting a name or email shape alone.
- **Generalisable rule.** **When Apple/Google's own review pipeline is the
  suspect, verify the disclosed value by querying prod, don't assume a
  client-side truncation bug.** The name Apple sends on first authorization is
  authoritative and un-editable by us; treat it as a real (if synthetic)
  identity, not as evidence of a bug in `displayName.js` or the client's join
  logic, until the numbers actually show a byte cut off somewhere in our own
  code.

## 284. Closing the Google sheet said "Sign-in failed" — and a quick close re-opened it (2026-09-25, PRICEBACK-CANADA-H, PR #362)

- **Date:** 2026-09-25 · **PR:** #362 (`45367e0`) · **Area:** mobile (`authService.signInWithGoogle`) · both platforms
- **Symptom.** Sentry `PRICEBACK-CANADA-H`, *"Google Sign-In returned no ID token"*,
  `signin_no_token`. The 2.9.0 events (iPhone13,3, iOS 27.0) show the Google
  `SFSafariViewController` up for 8 s, dismissed, then an `RCTAlertController`
  titled **"Sign-in failed"** — twice, 25 s apart. `attemptMs` 10579 / 14292: a
  person, not a restricted device.
- **Root cause.** Since `@react-native-google-signin` v13 (we run 16.1.2) a
  dismissed sheet does **not** reject: `translateCancellationError` turns the
  native `SIGN_IN_CANCELLED` rejection into a *resolved*
  `{ type: "cancelled", data: null }`. `signInWithGoogle` only recognised the
  rejected form, so a cancel fell through to the token check (Bugs #206) and
  was thrown as a failed sign-in. Worse, under `GSI_UNATTENDED_ATTEMPT_MS`
  (2 s) that check retries silently — **a quick dismissal re-opened the sheet
  the user had just closed**, and a tap on the second one signed them in. The
  re-auth path (`refreshGoogleSession`) was written assuming a dismissal
  returns `null`; it was reporting `google_reauth_failed` instead of
  `_declined`. `emailSyncService` already handled `type === "cancelled"`.
- **Why tests missed it.** The "cancelled sheet" test mocked a *rejection* —
  the pre-v13 contract — so it pinned a shape the library no longer produces.
- **Fix.** `if (result?.type === "cancelled") return null;` right after
  `signIn()` resolves, before the token check and the retry.
- **Files.** `src/services/authService.js`, `__tests__/authServiceSignIn.test.js`
  (resolved sentinel → null, nothing stored; fast dismissal → exactly one
  `signIn` call), `__tests__/authServiceGoogleReauth.test.js` (sentinel →
  `google_reauth_declined`, cooldown armed). All three fail without the fix.
- **Detect next time.** `signin_no_token` with a **large** `attemptMs` and no
  `priorCode` = the user sat through the sheet; check the breadcrumbs for an
  `SFSafariViewController` / `SignInHubActivity` that closed just before.
- **Generalisable rule.** **Mock a native library with what its CURRENT JS layer
  returns, not what its native module throws.** A library that post-processes
  native results in JS (here, rejection → resolved sentinel) makes a mock at
  the native-rejection level test a contract that no longer exists.
- **Same triage, not bugs:** `PRICEBACK-CANADA-K`/`-M` (2.9.1) are the `info`-level
  `signin-device-refused` fingerprint added by #352 — App Review's restricted
  iPhones (3–61 ms, US-Pacific hours), working as designed. The 2.9.0 events on
  `-B`/`-C` predate #352. `-J` (watchdog) has no event on any 2.9.x build.

## 285. A PDF receipt was replaced by a picture the app drew of its own summary (2026-09-26, branch feat/receipt-original-document)

- **Date:** 2026-09-26 · **Branch:** `feat/receipt-original-document` · **Area:** mobile (`ScanScreen.doSave`, Receipt card, sync) + backend (receipt presign routes)
- **Symptom.** Maxim, looking at a receipt uploaded to production that day
  (`r_1790469584273_xstgw`, Rimouski): the app had *"created a new receipt"*
  instead of storing the real document. Every PDF / text / HTML upload showed
  a rendering of PriceBack's own parsed summary in the Receipt section, and
  that rendering — not the customer's file — was what sat in R2.
- **Root cause.** `doSave` captured an off-screen `ReceiptSnapshotView` with
  `react-native-view-shot` for any non-image file (and any receipt with no file)
  and stored THAT as `imageUri`. The real document survived only as
  `originalFileUri`, a cache path never persisted. Sync uploaded `imageUri` as
  `<id>.jpg` / `image/jpeg` (it was a PNG). Two older gaps compounded it: the
  app never fetched a receipt's R2 copy back (`syncService` restored
  `imageUri: null` with a comment claiming the Detail screen would — it never
  did), and an upload that failed after the receipt POST was never retried.
- **Why tests missed it.** The behaviour was the design, not a regression: the
  snapshot was intentional ("so the Detail screen can display it"). No test
  asked what the stored object actually WAS.
- **Fix.** The original file is persisted under its real extension and becomes
  the receipt's `imageUri` + `imageMimeType`; nothing is generated (a manual
  entry gets no file). The client declares `imageContentType`; the server
  (`backend/lib/receiptDocument.js`) keys, types and caps the presign by it —
  undeclared = the legacy `.jpg` contract, unknown = refused, text-like stored
  inert as `text/plain`. New `POST /api/receipts/:id/image-upload-url` re-mints
  a URL; `documentPending` → `documentUploadPending` → a retry drain on every
  `retryPendingReceiptSyncs`. A one-time migration swaps legacy snapshots for
  the original wherever the phone still has it, and the confirm route deletes
  the superseded R2 object. Receipt card + Claim Assistant render by kind and
  fall back to the R2 copy through a presigned GET.
- **Files.** see `Technical/Receipt_Original_Documents.md` §7.
- **Detect next time.** `receipts.image_object_key` ending `.jpg` on a receipt
  whose `raw_ocr` came from a PDF, or an R2 object whose bytes start `\x89PNG`
  under a `.jpg` key.
- **Generalisable rule.** **Never store a derived artifact in the slot that
  promises the original.** If a preview is useful, keep it BESIDE the source,
  never instead of it — and name the field for what it holds.
- **Not fixed by this (needs a person):** the Play Data Safety "Photos" row
  says receipt images are "not retained by us" — already untrue for photos
  (90-day R2 retention), and now documents are retained too.
  `Publishing-Compliance/Play_Data_Safety_Answers.md`; see
  `Technical/Receipt_Original_Documents.md` §6.

## 286. Three French Costco receipts in production, three silently wrong parses (2026-09-26, branch feat/receipt-original-document)

- **Date:** 2026-09-26 · **Area:** mobile parser (`shared/receiptLocale.js`, `costcoReceiptParser.js`) · Costco only, French only
- **Symptom.** Replaying every Quebec receipt production held through the
  current parser: Anjou #1446 dated **9 March** instead of 3 September (every
  item unwatched — the adjustment window "expired" months before the scan),
  five comma-decimal lines dropped, a TPD skipped; Rimouski #1720 missing its
  $4.80 bottle deposit and a $5 coupon. Every parse reported itself reconciled.
- **Root cause.** A newer Quebec register layout (`Total Partiel`, `TAXE TOTAL`,
  `NOMBRE TOTAL D'ARTICLES VENDUS`) carried one of the known French markers, so
  Anjou was read as English and never normalised; its `DD/MM/YYYY` transaction
  date fell to the generic month-first default; and four line shapes had never
  been seen — a split `CONSIGNE` block, an eco-fee code printed above its line
  (which then stole the next item's SKU), a TPD amount without its minus, and a
  coupon naming the item instead of a SKU.
- **Fix.** New French markers; `normalizeQuebecCostcoLayout` rewrites the four
  shapes into forms the existing handlers read; `extractQuebecCostcoDate` reads
  the transaction line day-first and the `P7` footer month-first. All of it runs
  only on French-detected text.
- **Evidence.** The three prod texts are fixtures
  (`__tests__/fixtures/receipts-prod-text/`) pinned to the printed subtotal and
  total. The existing corpus: 112 parses, **0 changed**. 9/9 guarded branches
  mutation-killed. Detail: `Technical/Costco/French_Quebec_Receipts.md`.
- **Generalisable rule.** **A self-check that a layout never prints cannot fail.**
  "Reconciled" meant nothing on a receipt whose subtotal label the parser could
  not read — replay REAL production OCR against the printed totals, not the
  parser's own opinion.

## 287. Four production receipts stored wrong — and the "stray per-kg price" was really a quantity (2026-09-27, branch fix/prod-receipt-repair-quebec-parser)

- **Date:** 2026-09-27 · **Area:** prod data (`receipts`, `receipt_items`, `price_points`, `products`, `warehouses`) + mobile parser + restore merge · Costco
- **Symptom.** Checked all 7 production receipts against their R2 photos and stored OCR.
  Anjou #1446 filed under a warehouse "60651" that does not exist, dated 9 March, 4 lines
  missing, a phantom 21.99 line; Rimouski #1720 total 202.94 (printed 202.74), coupon
  unapplied (PANTALON watched at 24.99 though 19.99 was paid → a false drop + commission
  on any flyer under 24.99); Gloucester 2025-12-17 items 311.38 vs printed 284.38, tax 2.24
  vs 29.24; product 1986269 named "Item #1986269" instead of "PJ'S".
- **Root causes.**
  1. `extractWarehouseId`'s ALL-CAPS `CITY #NNN` pattern had no right boundary: with
     Anjou's header OCR'd as "ANJOU 1446" (no `#`), the tax footer "NL SSST #606515"
     yielded "60651". The Quebec register prints its warehouse as `Entr[:] 1446`, which
     nothing read.
  2. The "21.99" under FILET SAUMON was not a per-kg price (the 2026-09-26 fix assumed so):
     the photo prints **"2 @ 1,99"** over "BANANES 3,98" — Vision dropped the `@`.
  3. `looksLikeName` required three consecutive letters; "PJ'S" has none, so on the
     flat-text path (PDF/text uploads) the line never paired with its price.
  4. The mobile restore merge keeps the LOCAL `status`, so a receipt the phone had expired
     on a wrong date stayed "expired" after the server corrected the date.
- **Fix.** Data: guarded single-transaction repairs, each re-read against the printed
  figures (ledger: `Operations/Receipt_Data_Verification_Ledger.md`). Code: `Entr` line +
  `(?!\d)` guard in `extractWarehouseId`; `normalizeQuebecCostcoLayout` rewrites a bare
  `Q`+`U.UU` line to `Q @ U.UU` only when Q×U is exactly the next item's price (French
  only); apostrophe-tolerant `looksLikeName`; `mergeServerIntoLocal` hands an expired
  receipt back to `watching` when the server's purchase date differs.
- **Evidence.** 115-parse corpus (geometry + flat + prod text) before/after: exactly the 3
  intended diffs, 112 identical; golden snapshots unchanged. 11/11 mutations killed.
- **Generalisable rules.** (1) **An explanation for a leftover number is a hypothesis until
  the photo confirms it** — "stray per-kg price" was wrong, and the printed article count
  (27 vs 26 lines) said so. (2) **A digit run must END where the pattern thinks it does**
  — `(\d{3,5})` without `(?!\d)` silently truncates. (3) **A local field DERIVED from a
  synced field is not local-only** — re-derive it when its source changes.

## 288. Every purchase date printed one day early in Canada — including in the claim email to the store (2026-09-27, branch hotfix/receipt-dates-province-tracking)

- **Date:** 2026-09-27 · **Area:** mobile (receipt screen, claim assistant, barcode history, Home) + i18n
- **Symptom.** A receipt dated June 30 showed "June 29" in the receipt screen's header,
  its "paid" card and its chart axis; the claim assistant's email and phone script told
  the store the purchase was made the day before the receipt says; a product's purchase
  history showed the same shift; and on Home, every January 1st receipt counted in the
  PREVIOUS year's "spent this year". Found while building the admin receipt desk (#369),
  whose own header already used `parseISODate`.
- **Root cause.** One conversion, in four places: `new Date("YYYY-MM-DD")` is **UTC
  midnight**, the evening before anywhere west of Greenwich. `DetailScreen` called
  `formatDate(new Date(receipt.purchaseDate))`; `ClaimAssistantScreen` and
  `BarcodeScanScreen` passed the string to `i18n.formatDate`, which did the same
  `new Date(value)` inside; `HomeScreen` read `new Date(purchaseDate).getFullYear()`.
  The adjustment-window module had warned "do NOT hand formatDate the ISO string" — a
  comment, and three call sites walked past it.
- **Fix.** At the root: `i18n.formatDate` now reads a bare `"YYYY-MM-DD"` as that
  calendar day (local midnight via `localInstantAt`); every other input is unchanged.
  `DetailScreen` passes the string; "spent this year" moved into a pure
  `utils/receiptSpending.spentInYear` that reads the printed year's own digits. The
  receipt screen now shows the receipt's TWO dates apart — **Purchase date** (printed)
  and **Scanned on** / **Imported on** (the `createdAt` instant on the shopper's province
  day, #289) — with `detail.scannedOn` / `detail.importedOn` in `en` + `fr`.
- **Evidence.** `formatDateCalendar` and `receiptSpending` run in the seven-zone matrix;
  a claim-assistant test with the REAL i18n asserts the draft says "June 1, 2026".
  Reverting `formatDate` fails the matrix in all 7 zones and the claim test in Toronto.
- **Rules.** (1) **A date-only value is a DAY, never an instant — no `new Date("YYYY-MM-DD")`
  on its way to a screen, a sum or a message.** (2) **Fix the formatter, not the callers**:
  a warning comment next to a trap protects exactly the callers who read it.

## 289. The server counted every adjustment window on the UTC day — a day ahead of Canada every evening (2026-09-27, branch hotfix/receipt-dates-province-tracking)

- **Date:** 2026-09-27 · **Area:** backend (`receiptsRepo` policy status, verified-drop +
  legacy sweeps) + mobile tracking clock
- **Symptom.** None reported — which is the pattern (#256 was the same shape on the
  client). From 17:00 in Vancouver / 20:00 in Toronto, the server's "today" was already
  tomorrow: `recomputePolicyStatus` / the batch heal flipped receipts `watching → expired`
  while the app still showed a day left, the legacy flyer/scrape sweeps stopped pushing on
  the window's last evening, and push emoji were picked on a different day than the in-app
  chip (the open "disagreement #2" of `Technical/Adjustment_Window_Time_Model.md`).
- **Root cause.** Four clocks on the server, all UTC: `new Date().toISOString()`
  (`recomputePolicyStatus`), Postgres `CURRENT_DATE` (`recomputeOverduePolicyStatuses`),
  milliseconds since UTC midnight (`priceDropNotifier.urgencyTier`), and a UTC parse plus
  `setDate` (`server.isWithinAdjustmentWindow`). The 2026-09-17 fix (#256) moved the APP to
  the device's local day and recorded "no province lookup needed" — true on a phone,
  impossible on a server with no phone clock.
- **Fix.** Maxim, 2026-09-27: *"the tracking should be based on the timezone of the user
  based on the province"*. `shared/trackingTime.js` (mirrored to `backend/shared/`) maps
  the 13 provinces/territories to IANA zones. The server counts on the OWNER's /
  BUYER's / watch item's province day (`backend/lib/trackingWindow.js`, the app's own
  formulas; no province → Eastern, never UTC); the batch heal binds one date per province
  into a `CASE`. The app counts on the same province day (`utils/trackingClock.js`, fed
  from `prefs.province`; device-local when there is none). The admin desk shows the scan
  day and the countdown on the OWNER's clock (`scannedOn`, `ownerProvince`).
  **No migration:** `purchase_date` was already the printed date and `created_at` already
  the scan instant.
- **Evidence.** `__tests__/trackingParity.test.js` requires the backend module and the
  app to give the same day for every province at every seventh hour of 2026, the same
  days-remaining and the same tier. `policyStatusProvinceDb.test.js`: at 2026-06-15T05:30Z
  a BC receipt stays `watching` while an ON one expires. Making the server day UTC again
  fails all three DB tests; `CURRENT_DATE` back in the batch fails exactly the two batch
  tests.
- **Rules.** (1) **"Today" belongs to the shopper, not to the machine asking** — a server
  has no local day worth using. (2) **When two sides must agree on a date, give them one
  table and a parity test**, not two implementations that "mirror" each other in a comment.

## 290. `main` CI red on two tests that were right on their own and wrong together (2026-09-27, branch hotfix/receipt-dates-province-tracking)

- **Date:** 2026-09-27 · **Area:** CI (mobile Jest isolation, backend session-replay test)
- **Symptom.** Run 36178009831 on `main` (`c060bcf`): Mobile red on
  `purchaseServiceDeviceCredit.test.js` (2 device-fingerprint tests, `digestStringAsync`
  never called) plus the `purchaseService.js` branch floor missed as a consequence; Backend
  red on `sessionReplayGraceDb.test.js` *"every token handed out inside the window still
  works"*. Both passed alone, both passed on a developer laptop.
- **Root causes.**
  1. **Jest's resolver is per WORKER, not per file.** `purchaseService.test.js` mocked
     `expo-device` with `{ virtual: true }`, which caches "purchaseService.js requires
     expo-device" as the bare-name id. `purchaseServiceDeviceCredit.test.js`, drawn later
     by the same worker, registered its `doMock` under the real path — so the cached id
     missed, the mock was bypassed, and the real native module loaded. Reproduced with
     `jest --runInBand purchaseService.test.js purchaseServiceDeviceCredit.test.js`. A scan
     found the same virtual/non-virtual mix latent for `react-native`,
     `expo-file-system/legacy`, `expo-image-manipulator`, `expo-web-browser` and
     `react-native-purchases` — two earlier sessions had met it and worked around it
     locally (one by making more suites virtual).
  2. **The replay test asserted on lock order.** Two concurrent replays of token A return
     C (issued first, then superseded) and D (live); the test then presented both in
     `Promise.all` order. When D went first — an ordinary refresh that stamps
     `last_used_at` — presenting C afterwards is "a descendant was presented", which the
     theft rule correctly burns. Green or red on which transaction took the lock first.
- **Fix.** All 29 `{ virtual: true }` mocks of modules that exist removed;
  `__tests__/jestMockHygiene.test.js` fails on any new one and replays the exact pair in
  one worker in pinned order (`__tests__/fixtures/orderedTestSequencer.js`). The replay test
  presents tokens in issuance order (`sessionId`), and a sibling test pins the reverse
  order as `reuse`. No shipped code changed for either.
- **Evidence.** Restoring the one virtual mock fails both guard tests (the replay shows
  "2 failed, 163 passed" — the CI failure exactly); sorting newest-first fails the replay
  test deterministically.
- **Also found while verifying (not on CI):** `writePathEdgesDb` *"updated_at bumped on the
  admin edit"* failed 3/3 on the dev machine. `appConfigRepo.set` stamped the INSERT with the
  database's `now()` (column default) and the conflict UPDATE with the app's `new Date()` —
  one column, two clocks — and that machine ran ~76 ms behind the database, so an edit right
  after the insert was stamped earlier. Both writes now take `now()` (commit `5064897`).
  Full entry, audit of the same shape in other tables, and the deterministic guard: **#291**.
- **Rules.** (1) **`virtual: true` is for modules that do not exist.** For anything that
  resolves it is not a harmless flag — it poisons other suites in the same worker.
  (2) **A test must not assert on which of two concurrent transactions won a lock** unless
  that order is the thing under test. (3) **"Passes alone" is a symptom, not an alibi** —
  replay the pair in one worker before calling it a flake.

## 291. `app_config.updated_at` went BACKWARDS on an admin edit — one column, two clocks (2026-09-27, #370; guard 2026-09-28, branch hotfix/clock-skew-dates-main-ci)

- **Date:** 2026-09-27 (fix, commit `5064897` in #370) · 2026-09-28 (guard test) ·
  **Area:** backend (`repos/appConfigRepo.js`)
- **Symptom.** `writePathEdgesDb` *"updated_at bumped on the admin edit"* failed **3 of
  3** when run alone on the dev machine and never on CI. No user-visible symptom.
- **Root cause.** `appConfigRepo.set` is an upsert. The INSERT left `updated_at` to the
  column default `now()` — the **database's** clock. The conflict UPDATE stamped
  `new Date()` — the **app server's** clock. One column, two clocks. The dev machine's
  clock runs behind Supabase's (~76 ms measured by the session that found it; a
  `SELECT now()` probe on 2026-09-28 read the app ~60 ms behind), so an edit made right
  after the insert was stamped *earlier* than the insert. CI's NTP-synced runners were
  close enough never to show it.
- **Fix.** Both writes take the database clock: `set: { value, updatedAt: sql\`now()\` }`.
- **Checked before calling it done.** Nothing in production compares
  `app_config.updated_at` with the app's clock: `configService` reads values only
  (`getAllMap`), `appConfigRepo.getAll()` has no production caller, and the test above is
  the column's only reader.
- **The same shape elsewhere — audited, deliberately left.** `users.updated_at` (5
  writers, incl. `creditsRepo`) and `price_drop_guarantees.updated_at` (6 writers) also
  insert on the DB default and update with `new Date()`. **Nothing reads their order**
  (bookkeeping only), and converting them means touching the credit path in a hotfix for
  no behaviour change. The rule if that ever changes: *anything that compares an
  `updated_at` must first make every writer of that column stamp `now()`.* Already on one
  clock: `kv_state`, `warehouses`, `user_notification_settings`, `user_preferences` (app
  clock on both writes — `preferencesRepo`'s last-write-wins compares a DEVICE timestamp
  with it, which is inherent to client LWW), and `stores.updated_at`, which a DB trigger
  stamps and which IS read, as a monotonic revision token — correctly, on one clock.
- **Detect / prevent.** `writePathEdgesDb` *"an edit is stamped on the database clock, even
  when the app server's clock is an hour behind"* holds the app's `Date` an hour back
  (`t.mock.timers`) across the edit. **Mutation-tested:** restoring `new Date()` fails it on
  any machine — *"the edit was stamped 02:25Z, BEFORE the insert it follows (03:25Z)"* —
  where the original test could only fail on a machine that happened to run behind.
- **Rule.** **A column gets one clock.** A test that can only fail on a skewed machine is
  not a guard: skew the clock inside the test.

## 292. An evening price-tag scan was dated tomorrow — a tag still valid that day was ruled expired (2026-09-28, branch hotfix/clock-skew-dates-main-ci)

- **Date:** 2026-09-28 · **Area:** backend (`POST /api/observations/tag`, which feeds
  `priceDropRepo.findNotifiable`)
- **Symptom.** None reported. From 17:00 in Vancouver / 20:00 in Toronto, a shopper
  scanning a tag printed "valid until" today got `status: "expired"` and no credit
  (rule 2), and the observation was filed under tomorrow's date.
- **Root cause.** The route pinned the observation day as
  `new Date().toISOString().slice(0, 10)`, the server's UTC day. Everything that day is
  compared with is printed on the store's own calendar: the tag's "valid until", and every
  buyer's purchase date when `findNotifiable` asks whether the price became available
  *strictly after* the purchase and *within* the window. So an evening sighting counted as
  "after" a purchase made that same day, and a sighting on the window's last evening fell
  outside it.
- **Asked, answered.** Maxim asked whether `findNotifiable`'s dates should be on the user's
  timezone, since they are "relative to the receipt purchase date". Yes, and the fix is at
  the WRITE, not in the SQL. `observed_at::date` is correct: every point source stores a
  DAY at UTC midnight (receipt rows the printed purchase date, `/api/watch` rows the
  purchase date the phone sends, tag rows now the province day), and the session TimeZone
  is UTC (probed), so `::date` returns that day exactly. Re-zoning the read
  (`AT TIME ZONE 'America/Toronto'`) would move every such midnight to the day before —
  Bugs #288 again. A comment in the SQL now says so.
- **Fix.** `observedAt = trackingWindow.trackingTodayISO(provinceCode || null)` — the
  scanner's province day, Eastern when none is sent, never UTC. The same pinned value still
  feeds the `source_ref` and the credit-ledger `ref`, so they match byte for byte. Existing
  rows are not rewritten: they are history, and the sweep's 120-day lookback ages them out.
- **Evidence.** `crowdsourceDb` *"an evening tag scan is dated on the shopper's province
  day…"*: at 01:30 UTC (the previous day in every province, Newfoundland included) a BC tag
  valid until that day is `pending`, not `expired`, and its row reads that day. Red on the
  old code (`status: 'expired'`). Three suites had baked the UTC day into their
  expectations and became time-of-day bombs once the route was right: two `crowdsourceDb`
  and two `tagCreditsEngineDb` tests rebuilt the `source_ref` with the UTC day, and
  `priceDropPipelineE2E` built purchase dates on UTC against Saskatchewan-dated tags. All
  now read the province day; all green at 03:33 UTC, an hour when the two calendars differ.
- **Still UTC, known:** `crowdRepo.recordObservation`'s fallback when a caller passes no
  date (`dateStr(now)`). No production caller relies on it — the tag route passes the
  province day and `/api/watch` the item's purchase date.
- **Rule.** **A date compared with a printed date must be on the calendar it was printed
  on** — the shopper's local day, never the server's.

## 293. Dates shown to the shopper on someone else's clock — the savings report on UTC, Guarantee pushes on Toronto (2026-09-28, branch hotfix/clock-skew-dates-main-ci)

- **Date:** 2026-09-28 · **Area:** mobile (`services/exportService.js`) + backend
  (`lib/pushI18n.formatDate`, `lib/priceDropGuarantee`, `jobs/priceDropGuarantee`,
  `server.sendUserPush`)
- **Symptom.** (1) The savings PDF printed every claim made after 20:00 Toronto / 17:00
  Vancouver under the NEXT day, and "Generated on" likewise; an old claim with no
  `claimedAt` on a January 1 purchase landed in the previous year's report and year picker.
  (2) A Guarantee push told a BC shopper to *"turn off auto-renew by September 30"* for a
  store renewal at 22:30 on September 30 their time — a deadline one day late, and missing
  it costs another year's charge.
- **Neither is relative to the purchase date** (Maxim's question). A claim date is the
  instant the shopper marked a claim; a renewal is a store instant. Both are INSTANTS,
  shown as the day they fall on **for that shopper** — the rule the receipt screen's
  "Scanned on" already follows (#289).
- **Root cause.** (1) `exportService`'s `formatDate` was
  `new Date(iso).toISOString().slice(0, 10)` — the UTC day — and its range/year buckets read
  `new Date(purchaseDate)` with local getters, the #288 trap. (2) `pushI18n.formatDate`
  hard-coded `America/Toronto`, and `sendUserPush`, with the user row already loaded, handed
  `build` only the language.
- **Fix.** (1) Claim instants go through `trackingClock.trackingDateOfInstant` (province;
  the device's zone without one); the purchase-date fallback through `parseISODateParts`
  (the printed Y-M-D, literally); "Generated on" is `trackingTodayISO()`.
  (2) `sendUserPush` calls `build(lang, { province, country })`, the Guarantee job forwards
  it into the copy, and `pushI18n.formatDate(instant, lang, { province, country })` reads
  that province's zone from `shared/trackingTime.js` — Eastern without one, so every other
  caller is unchanged.
- **Evidence.** `__tests__/exportServiceDates.test.js` (11 tests) joins the seven-zone
  matrix (`adjustmentWindowTimezone.matrix.test.js`); 10 were red on the old code. Backend:
  a renewal at 05:30Z on October 1 reads September 30 for BC/AB and October 1 for
  ON/NL/no province; the earned, reminder and ending copy, the job's forwarding and
  `sendUserPush`'s `where` (on the dev DB) are each pinned — all four new tests red on the
  old code.
- **Rule.** **An instant has no date until a zone is chosen — choose the shopper's.** A
  hard-coded "home market" zone is a UTC bug with a smaller blast radius.

## 294. `main` CI red with every test green — work that outlived its test file (2026-09-28, run 36364315206, branch hotfix/clock-skew-dates-main-ci)

- **Date:** 2026-09-28 · **Area:** CI / mobile Jest (`guarantee.test.js`,
  `screensSmoke.test.js` → `SplashScreen`)
- **Symptom.** Run 36364315206 on `main` (`85dfbe7`, the #370 merge): Security and Backend
  green; Mobile red — `Test Suites: 278 passed`, `Tests: 6620 passed`, coverage above
  every floor, then "Jest did not exit one second after the test run has completed", about
  four minutes of silence, and `Process completed with exit code 1`.
- **Misdiagnosis to avoid.** GitHub's **"Explain error"** (Copilot) blamed the open-handle
  message ("Jest's lingering process eventually timed out") and proposed
  `detectOpenHandles: true` in `jest.config.js`, with `forceExit` as a last resort. The
  evidence says otherwise: the GREEN run 35436001721 (2026-09-19) printed the identical
  message and idled the identical four minutes (09:58:50 → 10:02:52), then exited 0 — and
  Bugs #232 had already recorded that message as benign. `detectOpenHandles` only forces a
  serial run; `forceExit` would `exit(0)` and hide the real error.
  **Read the mechanism, not the loudest line.**
- **Root cause.** jest-runtime 29.7 answers any `require` made after a file's environment
  has been torn down with *"You are trying to `import` a file after the Jest environment
  has been torn down. From <file>"* **and `process.exitCode = 1`**
  (`jest-runtime/build/index.js:563-565`). The log had five:
  1. `guarantee.test.js` (four) — none of its rendered trees was ever unmounted, so the
     file's `afterEach` `setLanguage("en")`, and the last test's `saveGuaranteeStatus`,
     re-rendered them outside `act()` on React's scheduler; the render's lazy
     `require("react-native").ScrollView` ran after teardown. The suite came with #361 and
     had never run on CI before.
  2. `screensSmoke.test.js` (one) — `SplashScreen`'s boot chain kept going after the smoke
     test unmounted it and, ~2.6 s later, called `navigation.replace()` and
     `import("../services/pendingDeepLink")`. Present since the 2026-09-25 run, where two
     real failures hid it.
- **Why nobody saw it locally — the real gap.** CI's 2-core runner gives Jest one worker,
  so the suite runs **in band**, in the main process, and that `exitCode` becomes the run's.
  On a 12-core laptop the same line runs inside a worker, whose exit code Jest discards.
  Measured: without a guard, `guarantee.test.js` run in a worker **exits 0** with all four
  ReferenceErrors on screen. #370's "verified locally" was that green.
- **Fix.** (1) `guarantee.test.js` renders through a `mount()` helper and unmounts every
  tree inside `act()` BEFORE the `afterEach` changes shared state; the status save that
  re-renders a live tree now runs inside `act()` (its "not wrapped in act" warnings are
  gone too). (2) `SplashScreen`'s `navigate()` refuses to START a navigation once the screen
  has unmounted. Boot still runs, and a navigation it already started still delivers its
  parked deep link after the replace — both pinned by `splashScreenNavigation.test.js`
  (the unmounted case red on the old code).
- **Prevent — a guard with local/CI parity.** `jest.environment.js` (jest-expo's own
  environment plus ~20 lines, wired as `testEnvironment`): before the real teardown it lets
  whatever the file already queued run for a few event-loop turns, and if that work set the
  exit code it **fails the file by name** — in a worker and in band alike. Measured on the
  unfixed suite: `FAIL __tests__/guarantee.test.js — Code from … was still running after
  its last test finished` in both modes (control, a worker without the guard: exit 0). It
  cannot catch a TIMER that fires seconds later, like the splash's 2.6 s — in band that
  still exits 1 — which is why:
- **Detect next time — the verification standard.** Before calling a mobile change green,
  run it the way CI runs it and read the **exit code**, not the summary:
  `npx jest --ci --watchAll=false --coverage --runInBand; echo $?`. A "passed" summary with
  exit 1 means something ran after a file had finished: grep the log for `torn down` and
  `Cannot log after tests are done` — the `From …` names the file.
- **Rules.** (1) **Unmount every tree you render, before an `afterEach` touches shared
  state.** (2) **A screen that is gone must not start a navigation.** (3) **Local green is
  not CI green until it ran the way CI runs** — in band, read by its exit code.

## 295. The splash spoke English to French users — literals, and a screen drawn before the saved language was read (2026-09-28, branch fix/splash-i18n)

- **Date:** 2026-09-28 · **Area:** mobile · `src/screens/SplashScreen.js`, `src/services/i18n.js`
- **Symptom.** A shopper who picked French in the app still got an English brand line
  ("Get money back when prices drop.") and an English random slogan on every cold start.
  Everything after the splash was French.
- **Root cause — two layers.** (1) The brand line and the 15-slogan pool were string
  literals in `SplashScreen.js` (`BRAND_TAGLINE`, `TAGLINES`), never routed through `t()`,
  so `npm run i18n:check` had nothing to see — it only checks keys, and there were no keys.
  (2) Translating them alone would NOT have fixed it: the saved language is restored by
  `loadLanguage()` inside `startBootTasks()`, and the splash **awaits** boot — so the splash
  is the one screen that renders while `t()` is still on English. The old unused
  `splash.tagline` / `splash.taglineSub` keys had French copy all along; nobody rendered them.
- **Fix.** Copy moved to `splash.brandTagline` + `splash.slogan.*` in every language block
  (`SLOGAN_KEYS` in the screen; the referral count is interpolated as `{credits}`). The
  splash calls `loadLanguage()` itself on mount and keeps its two text lines at
  `opacity: 0` until it resolves — no English flash — with a 500 ms cap and a sync-throw
  guard so a storage layer that never answers still shows English, never blank.
  `loadLanguage()` fires no listeners, so live language switching is unchanged.
- **Tests.** `__tests__/splashScreenI18n.test.js` (10): saved `fr` → French on the first
  visible frame; nothing saved → English; hidden-until-known; never-answering storage →
  English after the cap; rejecting storage; sync throw; no listener fired; every slogan a
  real, interpolated, non-English-copy label in every shipped language. Mutation: replacing
  the splash's `loadLanguage()` read with an immediate "ready" turns 4 of them red.
  `splashScreenNavigation.test.js` and the `screensSmoke` i18n mock gained the AsyncStorage /
  `loadLanguage` they now need.
- **Rules.** (1) **A screen that renders before boot finishes cannot rely on boot's state** —
  read what it needs itself. (2) **`i18n:check` cannot see a literal** — grep a screen for
  quoted prose, not just for missing keys.

## 296. Eight Ontario receipts scanned in production: two lines lost, a SKU-less "TACO", and "CKN / VEG DUMP $" (2026-09-29, branch hotfix/receipt-parse-2026-09-29)

- **Date:** 2026-09-29 · **Area:** mobile parser (`src/services/costcoReceiptParser.js` only) +
  prod data · Costco warehouse receipts
- **Symptom.** Maxim scanned 8 receipts in production. Stored vs printed:
  Gloucester #1362 2026-01-28 missing `DEMPS.STAYSF` and `MILK 2%`, CHICK BREAST at full price
  (TPD unapplied) — items 293.06 vs printed 298.94, and the stored tax absorbed the gap
  (29.01 vs 23.13); 2026-06-28 shipped a product `TACO` with no SKU (`ln:` placeholder);
  2026-02-07 product `CKN / VEG DUMP $`. On the flat path an app screenshot's cropped tab
  label `xplore` became a product that took the shrimp's $18.99.
- **Root causes.**
  1. The column-split reshape only opened a block on a **non-TPD** SKU+name line. Here the
     first priced item's own TPD intro was the first row of the name column
     (`TPD/3661730, DEMPS, TPD/774939, MILK` then `5.00-, 6.99, 2.00-, 5.89`), so nothing
     zipped: the DEMPS row found a discount below it, MILK found nothing.
  2. Flat OCR split one printed row, `24930 CHICK TACO 18.17`, into `24930 CHICK` / `TACO` /
     `18.17`. The head had no price and the next line wasn't one, so it was dropped; the tail
     paired with the price.
  3. Vision returns `/` as its own word and the geometry row join puts spaces around every
     word — the same artefact was already pinned in the golden snapshot as `B / S THIGHS`,
     `TIDE W / DOWNY`, `COLLAGEN / CER`. `$14.99` split into `$` + `14.99`, and the item
     pattern's `\$?` only strips an ADJACENT `$`.
  4. No rule knew the Costco app's tab bar (`Explore · Shop · Warehouse · Cart`).
- **Fix (Costco parser only — the shared engine, geometry, and Best Buy are byte-identical).**
  (1) A block may start on a TPD intro when the next line is another name-column row; the
  exact count + kind alignment gate is unchanged. (2) SKU+name with no price → 1–3 word
  letters-only tail (≤ 16 chars, not register vocabulary) → price: rejoin. (3)
  `tidyCostcoItemName` after parsing: ` / ` → `/`, drop a trailing lone `$`. (4)
  `stripCostcoAppNavBar` in the warehouse preprocess — only when ≥ 2 distinct tab labels
  appear as bare lines, and only lines made of nothing but tab labels.
  **Data:** guarded single transaction on prod (ledger:
  `Operations/Receipt_Data_Verification_Ledger.md`); all three receipts re-read to a 0.00 gap.
- **Evidence.** Golden corpus (56 receipts): exactly 6 intended diffs (5 slash names + `TACO` →
  `CHICK TACO` / SKU 24930), 51 byte-identical. Prod replay of all 8: every item = printed
  subtotal. Full mobile suite 281 suites / 6689 tests green. 5/5 mutations (one per rule) turn
  the new tests red.
- **Not fixed (flagged).** (a) Screenshots/photos without a printed date are stored with the
  scan date — `r_…_1gall` is an April receipt dated today. (b) The flat path reads no tax/total
  on `yb0uh` (values printed above their labels); production used geometry and stored them
  correctly — a shared `extractTotal` change, deliberately not made in a hotfix.
- **Rules.** (1) **A golden snapshot can pin a bug** — `B / S THIGHS` was "expected" for months;
  read a snapshot diff as a claim about the receipt, not about the parser. (2) **When the
  reshape refuses a block, ask what the block's FIRST row is** — the gate was right, the start
  condition was too narrow.

---

## 297. Six regular-price tags reached the review queue; a photo that "couldn't load" (2026-09-29, branch hotfix/price-tag-savings-only)

**Symptom.** A new shopper's first six tag scans all landed in the admin review queue as pending, none a
savings tag. Separately, opening a review photo sometimes showed "Couldn't load the image."

**Root cause.** (1) The credit gate was `regular > price OR instantSavings > 0`, both taken from the
client's parse. On a cluttered French tag OCR hands back a second number (eco-fee lines, a neighbouring
tag's price) and `regular > price` is true with **no end date** — three of the six were in that state. A
real promo always prints `EXP <date>`. (2) The parser had no notion of the French "ÉCOFRAIS … TOTAL"
layout: the fee-inclusive TOTAL is what's paid, but the label sits away from its amount in OCR order.
`EXP` misread as `FXP` lost the date on the one genuine savings tag. (3) The full-screen viewer treated the
first failed download as terminal — a dropped connection, or a signed URL that expired while the list sat
open, both read as a broken image.

**Fix.** `shared/tagSavings.js` — savings = discount **and** an ISO end date — is the one predicate for the
review-screen badge, the server's `hasSavings`, and (as `valid_until >= today`, no `IS NULL` escape) both
settlement queries. Parser: eco-fee `base + fee = total` pair picks the TOTAL; `[EF]X[PR]` date variants;
French "rabais instantané / économisez"; a label-free read with 3+ amounts is no longer "high" confidence.
Viewer: two silent retries (re-signing the URL each time), then a "Try again" button.

**Lessons.** (1) **A credit gate must not trust a client-derived comparison on its own** — require the
independent printed fact (the end date) that a real savings tag always carries. (2) **In OCR text, order is not
layout**: when a label and its value can be separated, use an arithmetic relationship (`base + fee = total`)
to pair them, not adjacency. (3) **Never make a network failure terminal on the first try** for a signed URL.

---

## 298. A drop held for review could be billed twice, billed stale, billed silently — or not billed at all (2026-09-30, branch fix/review-376-377-findings)

**Symptom.** Found by the code review of #376 before any shopper reported it; each path is reachable in
production with `PRICE_DROP_REVIEW_REQUIRED` on (the launch default):
- a line with two queued rows (a $40 drop staged by one sweep, a deeper $35 by the next, both approved) was
  **charged for the overlap twice** and pushed twice;
- a $40 row approved after the $35 one went out pushed a **stale "dropped to $40"**;
- a drop that stopped holding while it waited (price point marked misleading, higher flyer price, floor
  raised) was **still charged** on approval;
- a drop the shopper **claimed in-app while it was held** was closed as superseded — **never charged**;
- a queue write failing after the charge committed released the batch → **charged, never told**.

**Root cause.** The queue turned "detect → charge" (one sweep, one `findNotifiable` row per line, seconds
apart) into "stage → wait → drain", and the drain inherited assumptions only the old shape made true:
`findNotifiable`'s `DISTINCT ON (ri.id)` and its `pdn.price <= new_price` guard were what kept ONE row per line
and never re-notified a shallower price — the queue can hand `recordNotified` several rows for a line, and
its unique index only stops the EXACT same price. The only drain-time re-check was `unitPaid > newPrice`.
`live = false` covered "the shopper claimed it" as well as "the line is gone". And the queue bookkeeping sat
between the committed charge and the Expo send.

**Fix.** Drain: re-ask `findNotifiable` scoped to the claimed lines (`receiptItemIds`, `includeClaimed`),
keep one row per line (the deepest), bill a line claimed after its row was staged (`claimedWhileQueued`) with
no drop alert, make post-charge bookkeeping non-fatal. `recordNotified`: one drop per line per call, and
(charge path) nothing at or above the lowest price already notified. Also: the pause switch is re-read from
`app_config` before every pass, a superseded row is revived when the sweep finds the drop again, the back-off
doubles (cap 24 h), a shopper's refresh drains only their own rows, and the Guarantee stamp waits for an
admin's approval when review is on.

**Files.** `backend/priceDropNotifier.js` (`_revalidate`, `_deliver`, `drainQueue`, `_stampGuarantee`),
`backend/repos/priceDropQueueRepo.js` (`stage`, `claimBatch`, `release`, `rejectedKeys`),
`backend/repos/priceDropRepo.js` (`findNotifiable`, `recordNotified`), `backend/config/configService.js`
(`readOpsFlagFresh`, warm race), `src/screens/AdminPriceDropQueueScreen.js`. Full table:
`Technical/Code_Review_2026-09-30_PR376_PR377.md`.

**Detect next time.** Two ledger debits for one line:
`select split_part(ref, ':', 2) as item, array_agg(ref order by created_at) as refs from priceback.credit_ledger where ref like 'drop:%' group by 1 having count(*) > 1`
— legitimate only when each later ref is a DEEPER price (its cents part lower). A `sent` queue row with no `price_drop_notifications` row
for its (line, price) means the push went out unbilled.

**Lessons.** (1) **When you put a queue between a check and an action, re-run the check at the action.**
Everything the check guaranteed by being *adjacent* to the action (one row per line, no stale price,
the world unchanged) is now false. (2) **A uniqueness guard on (key, value) is not "once per key"** — it
stops a repeat, not a second value. (3) **After money moves, bookkeeping must never be able to stop the
notification that explains it.**

---

## 299. A returning shopper's profile sync wedged on "postal code required" — CASL withdrawals never landed (2026-09-30, branch fix/review-376-377-findings)

**Symptom.** Any account with no valid postal code on file (the accounts #376 set out to fix) got
`400 postal_code_required` on every `PUT /api/me/profile` the app's durable sync queue sent after sign-in.
The queue retries the WHOLE merged payload, so notification toggles and marketing-push withdrawals stayed
local forever while the app showed them as saved.

**Root cause.** #376 treated any write that grants the Terms of Service as "completes signup". The app
re-affirms the Terms on EVERY returning sign-in (OnboardingScreen, `route === "main"`), through
`profileSyncQueue`, with no postal code in the payload.

**Fix.** "Completes signup" = the account's FIRST Terms grant (`consentRepo.hasGranted`, read only when a Terms
grant arrives and no valid code is on file). New accounts are still refused without a code.

**Files.** `backend/lib/postalCode.js` (`checkProfilePostalCode`, `grantsTermsOfService`),
`backend/repos/consentRepo.js` (`hasGranted`), `backend/server.js` (`PUT /api/me/profile`).

**Detect next time.** Server logs: repeated 400 `postal_code_required` for the SAME sub. Any 4xx the durable
queue can receive is a wedge unless the request is fixable by the user.

**Lesson.** **A durable client queue turns a validation rule into a permanent outage for every field merged
with it.** Before refusing a write, ask which clients retry it automatically and with what payload.

---

## 300. Tag credits: a dateless tag paid through another shopper's date; a last-day tag never paid in the evening (2026-09-30, branch fix/review-376-377-findings)

**Symptom.** (a) A shopper told "no credit" for a tag with no end date was paid anyway the moment anyone else
scanned the same SKU with a dated tag. (b) A savings tag scanned on its last valid day after ~20:00 Toronto
(17:00 Vancouver) was told "pending" and never settled.

**Root cause.** (a) Rule 8 (`pricesRepo.applyTagExpiry`) stamps one shopper's EXP on EVERY price point for
the product, and settlement read `valid_until` — which cannot tell whether a row's OWN tag carried a date.
(b) Settlement compared `valid_until` with the UTC day (`toISOString`), the route with the province day — the
Bugs #292 class; #377 made every creditable row pass through that comparison.

**Fix.** Tag price points carry `flags.printedExpiry`; both settlement queries require it (older rows without
the key keep the old rule and age out). `settleVerifiedTagCredits` reads expiry on
`trackingTodayISO(province)`; `settleAllVerified` enumerates on UTC − 1 day and lets each pool decide.

**Files.** `backend/repos/crowdRepo.js`, `backend/repos/tagCreditsRepo.js`.

**Lessons.** (1) **A column that another process copies onto your row cannot carry a per-row fact.** Record
the fact where it is observed. (2) **Every date comparison names its clock** — "today" on a server is a UTC
day unless someone chose otherwise.

---

---

## 301. Play rejected 3.0.2: "Login credentials are missing" — on sign-in code nobody touched (2026-09-30, branch fix/play-reviewer-access-android)

**Symptom.** Play Policy status: *Play Console Requirements — login credentials are missing*. Evidence
screenshots end on "Create your account" after the Google picker. The sign-in code had not changed since
launch, so the rejection looked arbitrary.

**Root cause.** (1) The Sign in details declaration said "N/A – Google Sign-In only" since launch. Play's
form states reviewers may not create accounts or use their own — earlier reviews passed only because
reviewers used their own Google accounts anyway. (2) #374 (2026-09-29 04:30 UTC) gated Price Check and
Email Sync behind Unlimited; Play's fleet signed in 38 minutes later and could not reach them without a
purchase it may not make. (3) The reviewer access code (PR #299) that answers exactly this was iOS-only.
Found alongside: `reviewer:appstore` (`app-review@priceback.ca`) matched the data-cleanup
"company accounts" classifier (`%@priceback.ca`) and was absent from production.

**Fix.** Android reviewer access: `_sessionsActive()` uses the first-party session on Android only while
the stored user is exactly `reviewer:appstore`/`reviewer`; the link renders on both platforms; copy is
store-neutral (EN/FR). Server: `lib/reviewerAccount.js` overlays a complimentary, non-expiring Unlimited
tier (read-side, never stored) and exempts the account from the single-device claim so parallel reviewers
cannot auto-flag it. `dataCleanup.protectedSubs()` and the `staleSignups` fingerprint always exclude it.

**Lessons.** (1) **A store's reviewer must reach every feature with credentials WE supply, on THAT
platform, without paying.** "They can use their own account" passed by luck, not by policy. (2) **A new
paywall gate is a review-access change** — check it against the reviewer account before shipping.
(3) **A cleanup that matches by domain will eventually match your own service accounts** — protect them in
code, not in config.


## 302. A new customer scanned two Quebec receipts twice — 4 lines, 2 TPDs, 2 rebates and a void lost (2026-09-30, branch fix/receipt-parse-pointe-claire-528)

**Symptom.** A customer's first two Pointe Claire #528 receipts came out visibly wrong, so they scanned each
again. The 2026-09-23 receipt read 11 of 15 lines (TIDE PA 89, ENSEMBLE 2PC and a PLAQUE missing; SUCRE BIO
19.99 instead of 13.99; DAWN at full price): 209.22 stored against a printed **272.18**. On 2026-09-26 both
$6.00 discounts were missing and the printed 171.11 was overwritten with **183.11**. The re-scans changed
nothing: the OCR was byte-identical.

**Root cause.** Four Quebec register shapes the flat-text parser could not read:
(1) `6.00-FP`: the FP→F flag collapse required the flag directly after the amount, and on a discount it
follows the minus. The two-letter flag then matched no discount pattern.
(2) `2106265 RABAIS` / `6.00-FP`: a generic rebate that names neither a SKU nor the item.
(3) A label run printed before its amounts and led by a keyword-less coupon ref (`0000391998/2652709`). The
column re-zip only knew discount labels spelled `TPD/`, so the run broke and its items fell out.
(4) `ANNUL` voids: an item reprinted negative and its coupon reprinted POSITIVE. The English VOID handler
would drop the whole merged qty-2 line.

**Fix (app PR #382).** `shared/receiptLocale.js` collapses `-FP` too; `normalizeQuebecCostcoLayout` rewrites
RABAIS and column-leading coupon refs into numeric `TPD/<sku>` (each guarded); the new `cancelAnnulledLines`
(after the re-zip) removes exactly the most recent line with the same SKU and amount. All French-only; Laval
#505 and every English receipt are byte-identical (golden snapshots unchanged). Both receipts pinned line by
line from the photo; 8 mutations killed. Customer data repaired and the duplicates deleted — see
`Receipt_Data_Verification_Ledger.md` and `Receipt_Repair_Playbook.md`.

**Lessons.** (1) **A customer re-scanning the same receipt is a parser bug report.** The OCR was identical
both times, so only the parser could have been wrong. (2) **The user deletes a copy, not necessarily the wrong
one.** Here the deleted copy of 09-23 was closer to the truth than the kept one. Repair from the photo, never
by picking between copies. (3) **Pin every line, not the total.** A printed total can be right on a parse
missing four items.

---

## 303. A deleted-then-restored account showed up as a credit drift (2026-10-02, branch fix/account-deletion-credit-forfeit)

- **Area:** backend · **Symptom:** prod account restored after deletion, back at **0 credits** (correct), yet
  the reconciliation sweep opened a pending case: `balance 0 / ledger 75 / drift −75`, breakdown
  `signup_grant +75`. "Apply" would have handed the forfeited 75 credits back.
- **Root cause:** `requestDeletion` zeroed `users.scan_credits` **without a ledger row**. The tombstone
  therefore broke `balance == SUM(delta)` by design (PR #260 kept the ledger for the 2 h restore window and
  hid tombstones from the sweep instead). Two revival paths clean that up — `upsertFromOAuth` replays the
  ledger in-window or erases it after — but the **admin restore** (`setAccountActive(sub, true)`) does
  neither. An account restored from the admin desk before the hourly purge reached it came back live with
  the full history against a zero balance → permanent drift.
- **Fix:** the deletion is now a ledger movement: `requestDeletion` writes an **`account_deletion`** row of
  `−balance` (written even at 0) in the same transaction, after locking the row. Every state of the
  lifecycle now reconciles, whatever path revives it. The in-window restore reverses the **latest**
  forfeit (`deletion_restore` = `+forfeit`, no longer delta-0); legacy tombstones with no forfeit row keep
  the old replay. The always-write-at-0 rule is load-bearing: without it, delete → restore → spend to 0 →
  delete → restore paid the first forfeit twice (mutation-tested).
- **Files:** `backend/repos/usersRepo.js` (`requestDeletion`, `upsertFromOAuth`), `backend/db/seed.js`
  (new `account_deletion` event type), `src/services/creditLedger.js` + `i18n.js` (en/fr label + note),
  `backend/tests/creditRestoreWindowDb.test.js` (+5, incl. the prod repro through `setAccountActive`).
- **Detect next time:** a pending `credit_reconciliations` row whose breakdown has **no** `account_deletion`
  entry for a user with a past deletion. Query the user's ledger before applying any reconciliation.
- **Lesson:** a balance write that bypasses the ledger is drift by construction, even when it is the
  intended value. Hiding the resulting state from the sweep (`status = true` filter) only moves the
  failure to whichever path un-hides it.
