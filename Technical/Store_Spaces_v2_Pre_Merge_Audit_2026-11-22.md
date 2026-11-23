# Store Spaces v2 on `main-test-features`: pre-merge audit (2026-11-22)

**Asked (Maxim, 2026-11-22):** *"run a full audit on the main-test-features branch and to make sure that all the new
design behave like the main branch or better no regression at all, check every small detail (navigation, buttons,
actions, scans, drops, ...etc) the backend shouldnt be touched all was just on the design but i want to make sure the
existing users wont be lost and they wont have any potential regresion 0% regression risk accepted, everything should
be fixed or documented to be done. if you find something on the design that can be optimized (act as UI expert on this
one) ... specialy on the multistore navigation and the receipt filters structure UI, and filters"*

**Compared:** `main` `bf46d32e` (3.6.4, build 63) against `main-test-features` `9e98d2f0` (3.6.5, build 64): 263 files,
+30,118 / −3,721. **Fixes:** app PR from `audit/mtf-design-regressions` into `main-test-features` (§4). Design and
plan: `Technical/Store_Spaces_v2_Design.md`, `Technical/Store_Spaces_v2_Plan.md`; open list:
`Roadmap/Store_Spaces_v2_Follow_Ups.md`.

## 1. Verdict

`main-test-features` is **not safe to merge into `main` until migration 0058 is on production** (§2, B2). With 0058
applied and the audit PR merged, no regression was found for an existing shopper: their data, sign-in, receipts,
drops, locks, charges, notifications and subscriptions behave as on `main`. What remains are design behaviours that
differ from `main` by decision; §5 lists them, with what to decide.

## 2. Blockers before `main-test-features` → `main`

| # | Blocker | State |
| --- | --- | --- |
| B1 | **The backend is not design-only.** 53 backend files: migrations 0053 + 0058; routes `/api/deals`, `/api/stores/vote` (GET/POST), `/api/me/trial-choice`, `/api/me/warehouse-prices`, `/api/ads/reward`, `/api/ads/ssv`, `/api/admin/address-price`; `upsertFromOAuth` (trial deferral), `/api/me` (`trial`, `ads.payg`, `ads.reward`), `/api/me/profile` (Business tier), the RevenueCat webhook and the subscription sync (free-week stamp). | **Verified safe for installed builds**: every change is gated on `X-App-Caps` or is an added field (§3). |
| B2 | **0058 is not on production, but `db/schema.js` already declares its columns** (`warehouses.street_address`, `postal_code`). Drizzle names every schema column in an insert and in a bare `select()`. On a database without 0058: `seedWarehouses` throws at boot. Its call is not guarded, so `ensureSeeded()` fails, and every off-transaction `lookupId` fails with it. Receipt saves fail too (`receiptsRepo` → `warehousesRepo.findKnown`, a bare `select()`), as do warehouse preferences and price tags. **That is an outage for every installed build** the moment `main` deploys. | **Maxim's action**: apply 0058 to production before the merge (§7, step 1). The PR adds a guard so a missed migration can no longer take the boot seed down, but the receipt path still needs the columns. |
| B3 | **Journal drift.** 0053 was never in `_journal.json` (applied on prod 2026-11-18 as ledger row 63), and `migration0053Db.test.js` failed on it. `0057_warehouse_stock_reads` and `0057_promo_codes` carried each other's `when` (prod rows 68 / 69). 0058 sat at a `when` older than prod's newest row (0059), so `drizzle-kit migrate` would have skipped it silently. | **Fixed in the PR**; pinned by `migrationJournalLedger.test.js`. |
| B4 | **`npm test` exited red.** 14,500 tests passed and 0 failed, but `mainTabs.test.js` left real-navigator trees mounted. The Deals feed re-rendered after Jest tore the environment down, and the leak guard (Bugs #294) failed the run. It reproduced alone. | **Fixed in the PR** (the trees are unmounted). |

## 3. Verified safe for existing shoppers

| Area | What was checked | Result |
| --- | --- | --- |
| Data on the phone | `storageService`, `stores`, `storePolicyService`, account cache | No key renamed, no shape changed. Only additions (account cache `trial`, FSA coordinates). Receipts, prefs and sign-in survive the upgrade. |
| Launch and sign-in | `SplashScreen` gate, `decideSignInRoute`, returning-user skip, `afterAccountCreated` | Gate unchanged (`signed && returning && profile`). Returning users never see onboarding A–H. |
| Screen H (trial) for existing accounts | prod, read-only: `users.trial_credits_granted_at` | **593 / 593** accounts already had their 75 credits, so none is eligible and none is sent to screen H. |
| Old builds against the new backend | `storeSpacesCompat`, `storeSpacesCompatDb`, `storeSpacesHeaderMatrixDb` (no header / 3.6.1 / new caps), `trialChoice(Db)`, `trialProductDb`, `membershipBusinessDb`, `appCaps`, `storeVotesDb`, `dealsDb`, `dealsCache`, on the **dev** database, one file at a time | **104 / 104 pass, 0 skipped.** Without `X-App-Caps`, a request gets exactly today's answers (the 75-credit grant, the `/api/me` keys, gold_star for a Business member). |
| Live estate | prod `users.app_version`, active accounts | 3.6.4 (125), 3.6.1 (115), 3.6.2 (63), 3.5.0 (49), 3.1.2 (50), 3.2.0 (30), 3.6.0, 3.1.3/3.1.4, 3.3.0, 3.4.0, 3.0.6; 69 report nothing (≤ 3.0.6). The backend must keep serving all of them; it does (row above). |
| Removed Stores tab | every `navigate("Stores")`, `screen: "Stores"`, push route, deep link | None left. `store_launch` opens Home with `storeCode`. Push routing is a table with a receipt-detail fallback; no push can name the old tab. |
| Drops, locks, charges | `ReceiptsScreen`, `ToClaimScreen`, `HomeScreen`, `storeSpaceData`, `dropLock` | Same rules: locked drops show the amount only, missed drops in the expired view, `isClaimableDrop` everywhere. |
| Subscribers | Me card, Earn tiles, guarantee, trial, ads | A subscriber sees Unlimited, no credits, no earn tiles, no trial (`isCreditExempt` on the server, #663 / #664). |
| Purchases | `purchaseService` diff | Pack and plan purchase paths untouched. The free week is a separate path (Apple product `priceback_unlimited_monthly_trial`, Play offer tagged `rc-ignore-offer`). |
| Ads | `app.json`, `app.config.js`, `package.json` exclusion, `eas.json` | Real AdMob app ids are committed, but production binaries still compile no ad SDK: only `preview` sets `ADS_ENABLED`. Server switches default off. |
| Receipt parsing | `receiptParser.js`, `receiptParsers/index.js` | With no pick, or a pick that agrees with detection, the parse is today's, byte for byte (`costcoPathImmutability` green). |
| Labels | `npm run i18n:check` | 2,288 / 2,288 keys, `en` and `fr` (2,296 with the PR). |

## 4. Regressions found and fixed (audit PR into `main-test-features`)

| # | Found | Fix | Tests |
| --- | --- | --- | --- |
| F1 | Receipts' simple view: an empty **active** list said *"No receipts yet — Scan your first receipt"* to a shopper whose receipts had all expired (history hidden behind two links). For an existing user it reads as lost data. | `emptyListCopy`: nothing on file → today's copy; history exists → *"Nothing active right now · Your past receipts and claims are in the history below"*; empty history view → *"Nothing here yet"*; a search with no match → *"Nothing matches your search"*. EN + FR. | `receiptsSimpleView`, `receiptsScreen.smoke` |
| F2 | A **refused receipt older than its window was listed nowhere** (it belonged to "All" only, and the simple view has no "All"). | It sits in the Expired history once its window has closed. | same |
| F3 | The By-receipt count line said *"12 items"* for 12 receipts (pre-existing on `main`). | `receipts.receiptsCountOne` / `receiptsCountMany`. | `receiptsScreen.smoke` |
| F4 | Deals search was a substring of the shown name. It bypassed the one product-search rule (CLAUDE.md, price history rule 6): "oeufs" missed "Œufs", "olive oil" in another word order missed, French names were not searched in English. | `searchDeals` uses `shared/productSearch` (`parseSearch`, `foldText`) over both names. | `deals` |
| F5 | Journal drift (B3). | Journal = `main`'s entries + 0053 (`when` 1794500000000, prod row 63) + 0058 after prod's newest (`when` 1795300000000). | `migrationJournalLedger` (mutation-checked: 3 of 4 fail on the old journal) |
| F6 | An unguarded `seedWarehouses` turns a missing migration into a boot-wide outage (B2). | Best-effort, like the 0015 / 0017 lookups beside it. | `seedWarehousesGuard` (mutation-checked) |
| F7 | `mainTabs.test.js` leak (B4). | Trees unmounted after each test. | `mainTabs` |

## 5. Behaviour that differs from `main`, for Maxim to decide

Each is the design as built and approved, but it changes what an existing shopper sees or does. A recommendation
comes with each.

| # | What a shopper sees on `main-test-features` | On `main` | Recommendation |
| --- | --- | --- | --- |
| D1 | **Two different "Home" screens.** With one live store (today's prod), the app opens on the Costco space. Tapping the Home tab shows the all-stores Home instead: hero, bell, Admin, "Your active receipts", the "alerts are off" card, camera-roll suggestions. At launch those are **hidden**. On a slow connection the tab first draws the all-stores Home, then **switches to the Costco space** when the store list arrives (up to 5–8 s; in-store reception is often poor), possibly under the shopper's finger. | One Home, always the same. | **One Home**: the tab is always the all-stores Home; the Costco space opens from its row (one tap). Launch and tab press then show the same screen, the hero and the alerts card are always there, and nothing jumps. A second store going live changes nothing in the layout. |
| D2 | **Store pills with one store**: Receipts shows "All stores · Costco", To claim "All stores · Costco", Deals "Costco", the Scan sheet "Costco". Two pills that filter the same list. | No store filter. | Draw store pills only when **2 or more** stores are live for the shopper. They appear by themselves the day a second store launches. |
| D3 | **Scanning a receipt takes two taps** (centre button → sheet → Scan a receipt). | One tap. | With one live store, the centre button opens the receipt scan directly. The other tools stay one tap away in the store space's Tools and the scan screen's mode switcher. Keep the sheet for 2+ stores, where the store choice selects the parser. |
| D4 | **The sheet pre-selects a store, and that pick skips the "unrecognized store" question.** Every centre-button scan carries `storeId` (the first live store by default). A paper receipt nobody recognized is filed as Costco with **no confirmation** (pinned by `scanScreenPickedStore.test.js`, "no picker, no question"). | The store picker opens and asks *"This receipt wasn't recognized as Costco — file it there?"* (the 2026-10-10 guard). | Keep the question when detection read **no** store and the shopper did not tap a store themselves (the default pick). The picked store's parser still runs. |
| D5 | **Every receipt scan with notifications off opens a popup** (§16 Q2). | A card on Home. | Decided as is. Noted only because it adds a stop to every scan for a shopper who said no; if reviews complain, once a day is the usual pattern. |
| D6 | Me lists **Rate, Instagram and Facebook twice** (community card + the Help & community rows). | Once. | Keep the community card; drop the three duplicate rows. |
| D7 | **Tab labels never scale** with the phone's text size (fixed 62 px bar). | Labels scale. | `maxFontSizeMultiplier={1.3}` instead of `allowFontScaling={false}`: large-text users can read them, the bar still fits. |
| D8 | **The store policy overview is gone with the Stores tab**: days, policy note, "last verified", disclaimer, the link to the official page. Each receipt's Detail still shows its store's note and link. | On the Stores tab. | A folded "Price-adjustment policy" section on the store space (days, note, last verified, official link). |
| D9 | **Deals search only searches the 50 loaded deals**: a deal further down cannot be found. | (no Deals) | Send the words to `/api/deals` (`q`), matched with `foldSql` (the SQL twin of the same rule). Backend change, additive. Also add pull-to-refresh, as on every other tab. |

## 6. UI direction: the simplest model to continue with

The problems of the current version (multi-store navigation, the receipts filters) come from one cause: **the store is
chosen in too many places, and a screen changes meaning depending on how it was reached.** The design fixes most of
the filters; these four rules finish the job.

1. **One home, one way in.** The Home tab is always the same screen: the hero (to claim · saved), then *Your stores*
   rows, then *Your active receipts*. A store space is a screen opened from its row, with a back button. It is not a
   second view inside the Home tab with its own Home button, rail and tab-press reset (D1). `scanEntry`'s global "open
   space" then becomes the screen's own route param.
2. **The store is a filter only when there is a choice.** With one live store there is no store picker anywhere: no
   pills (D2), no sheet before a scan (D3), no rail. With two or more, the store is chosen once in a screen and carried
   by route params (already the case for Receipts, Deals and the tools).
3. **Receipts: one list, then history.** Keep the simple view: *By receipt / By product*, to claim first, then the
   most recent, history at the foot. Show the history counts in the two links ("Expired receipts · 23") so nothing
   looks lost (F1). The claimed history should open on the view the shopper is in, not always By product.
4. **Every search box reads the same way.** Receipts, Deals, Warehouse prices and the admin lookup all use
   `shared/productSearch` (F4, D9). Receipts' search is still a plain substring today: same follow-up.

## 7. Release order (replaces the plan's Task 23 order)

1. **Apply 0058 to production** (two nullable columns, `IF NOT EXISTS`; invisible to `main`'s code, so safe today),
   with its ledger row: `created_at` 1795300000000, hash = sha256 of the LF file (`86e943f6d55c…`). Verify:
   `select column_name from information_schema.columns where table_schema='priceback' and table_name='warehouses' and column_name in ('street_address','postal_code')` → 2 rows.
2. Merge the audit PR into `main-test-features`; full mobile suite and `i18n:check` green.
3. Decide D1–D9 (§5); any change ships as its own PR into `main-test-features`.
4. Device checks (§8).
5. `main-test-features` → `main` (Maxim). Railway deploys; smoke prod with the three header sets
   (`storeSpacesHeaderMatrixDb`'s cases) and `/health`.
6. App build from a tag, only on Maxim's `<build app>`.

## 8. Device checks still owed

From `Roadmap/Store_Spaces_v2_Follow_Ups.md` §3, plus what this audit adds:

- iOS: Scan sheet closing (RN Modal) while the scan screen opens its "alerts are off" sheet (another RN Modal). The
  popup waits for `InteractionManager`; confirm it always appears and never leaves an invisible modal.
- Slow network (throttled), cold start: the Home → Costco-space switch (only while D1 stands).
- Large text (Settings → font size max): tab labels, Me card, deal rows.
- A Costco receipt photographed below its banner, scanned from the centre button (D4 behaviour).
- Every redesigned screen against `Store Spaces v2.html`; fonts; French copy (Maxim's review).
