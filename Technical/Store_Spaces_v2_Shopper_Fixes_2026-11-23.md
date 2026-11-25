# Store Spaces v2 — shopper fixes of 2026-11-23

Maxim's list for main-test-features (the 3.6.6 beta), and where each rule now lives. One definition per rule;
the tests named below pin them.

## 1. Deals and Warehouse prices loaded nothing

**Cause:** `GET /api/deals` and `GET /api/me/warehouse-prices` existed only in main-test-features' backend. Production
runs `main`, the development service runs an older build: measured 2026-11-23, both routes answered **404 on
production and on development** (an unknown path answers 404 too; `/api/me` answers 401). The phone reads any non-OK
answer as "not available", so both screens stayed empty.

**Fix:** Priceback #667 ports both routes to `main` unchanged (no migration: every table is already on prod), plus:
- `imageUrl` on every deal (the admin lookup's own catalogue pick, https only, most trusted source first);
- `GET /api/me/warehouse-prices/history` (section 4).

The Warehouse prices row also had no picture because the phone's `warehousePricesService` dropped the `imageUrl` the
server already sent.

## 2. Unlimited tools: one gate, every way in

The Unlimited-only tools are a list, `services/priceCheckerGate.UNLIMITED_TOOLS`:

| Tool | Screen | Paywall hero |
| --- | --- | --- |
| Price Checker | `BarcodeScan` | `price_check` |
| Scan a price tag (new, 2026-11-23) | `PriceTagScan` | `price_tag` |
| Email Sync | `EmailSync` | `email_sync` |

Unlocked = a subscriber in force or an admin (`readPlanAccess`). A locked tap opens the paywall directly. Before any
paywall the server is asked once (`readPlanAccess({ heal: true })` → `canAddReceipt`), so a subscriber whose phone
lost the plan is never paywalled (CLAUDE.md "Subscribers come first").

Every way in is gated twice: the buttons (scan-mode switcher, scan sheet, store space, Me) and the screen itself,
`navigation/unlimitedOnly` wrapping the three screens in `App.js`. A push, a link or a stale stack entry therefore
lands on the paywall, which **replaces** the tool, so its close returns to the screen before. Pinned by
`__tests__/unlimitedTools.test.js`.

## 3. The price-tag credit reward is held

`src/constants/tagReward.TAG_SCAN_EARNS_CREDITS = false` hides every "earn credits" mention for the price tag: the
"Earn credits" chip, the Me tile, the Plan & credits row, the earned-credit line and the why-no-credit note on the
done screen, the "earn credit" wording on the intro notice and the tool description.

**The server still grants** per `PRICE_TAG_CREDIT_REWARD` (ops config, DB-tunable). Setting that row to 0 stops
the grant itself and is Maxim's call. Installed builds keep their own badges.

## 4. The shopper's price history (Warehouse prices → one product)

`priceHistoryService.harvestHistoryFor` (route `GET /api/me/warehouse-prices/history?productId=&warehouse=`): the
catalogue harvest's regular price at the place, less the official savings harvest's saving. Built with
`officialInputs({ points: [] })`, so **no price point of any kind** (flyer, tag, receipt, social post) and no
community fallback can reach it. No line → `line: null, current: null` (the screen says "No price yet"). The answer
carries no source, kind, tier or count. Pinned by `backend/tests/harvestHistory.test.js` (stubbed readers that throw
if a point reader is called) and `warehousePricesRoute.test.js`.

Note: the Warehouse prices **list** still uses `searchFor`'s official current price (which may include an official
price point such as the flyer); the history is catalogue + savings only, as asked. If the two should agree exactly,
the list must move to the same inputs.

Screen: `WarehousePriceHistoryScreen` (picture or placeholder, today's price, regular less saving, the admin desk's
`PriceHistoryChart` with translated formatters, recent official savings). EN + FR.

## 5. Back navigation

One rule, `src/navigation/backTarget.js`, run by the root stack on `beforeRemove` for a user's back only (GO_BACK, a
POP of one screen):
1. An admin tool (`Admin*` except `AdminHome`) goes back to the admin screen under it; when what is under it is outside
   the desk (a push or link opened it), it is replaced by `AdminHome` (or its own admin parent). Only AdminHome's back
   leaves the desk.
2. A screen with a declared parent (`PARENTS`) opened straight from the tabs goes to its parent.
3. Otherwise the previous screen.

Also, the **swipe-back works the same on iOS and Android** (Maxim, same day: "the swipe-back should also work on
android"). A swipe right that starts within 60 dp of the left edge goes back:
- every stacked screen: the root stack slides cards in from the right on both platforms with the swipe on
  (`navigation/swipeBackCard`, React Navigation's own gesture, which Android has off by default). Until then the
  stack had no animation at all, and Android had no in-app swipe;
- views that are not routes (Home's store space ↔ all-stores Home, the Receipts claimed/expired history):
  `components/EdgeSwipeBack`, the same edge and distance (`navigation/swipeBack`: 80 dp or 0.5 dp/ms to the right,
  more sideways than vertical). Android's system back does the same there (`BackHandler`), and the Home tab keeps
  its view history (`navigation/homeViewHistory`).

Android's system back gesture keeps working: with gesture navigation it owns the first few dp of the edge and sends a
hardware back, handled the same way. Swipeable: the scan modals; not: the boot screens and Main. The tab bar goes back
through the tab history (`backBehavior="history"`). Pinned by `__tests__/backTarget.test.js` and
`__tests__/swipeBack.test.js`.

## 6. Home and Receipts

- Every accordion (`CollapsibleSection`) is a full accordion: one card, the whole header row toggles, content inside,
  **always open on arrival** (no "start folded" option any more; the store space's tools used to start folded).
- "Your active receipts" lists the **receipts** in their window (the Receipts tab's own rule,
  `receiptMatchesChip(r, "active")`, refused and deleted ones left out, the ones to claim first), not product lines.
  "See all" opens the Receipts tab's active receipts.
- The hero shows the all-time savings page alone when no drop is open (it already did); the pager now restarts on its
  first page whenever the "To claim" page comes or goes.
- Receipts: the search box opens right under the search button, above the view switch and the store pills.

## 7. Costco tools and the Me page

- Costco's "More useful tools" order: Warehouse prices, Price Checker, Scan a price tag, Price translator
  (`constants/storeSpaces`).
- Me (`constants/meLayout`): the Costco warehouse & membership row and the Price-Drop Guarantee card are hidden (both
  stay wired; the warehouse is still edited from the store space's card). In Earn free credits the price-tag tile is
  replaced by the "watch an ad" tile, shown only while the rewarded-ad offer is on for that shopper.

## 8. Home is always the all-stores Home; slide E names Best Buy (2026-11-25, Priceback #727)

- **Bug (3.6.7, iPhone):** a completed sign-in opened straight on the Costco space. With one live store, the Home
  tab's `auto` view was that store's space (spec §12 Q2). **Replaced (Maxim):** every sign-in, sign-up and Home tab
  press lands on the all-stores Home. A space opens only from its row, the rail or a store_launch push; a space that
  stops being live returns to Home. With one live store, its space still carries Home's blocks (`isOnlyLiveStore`).
- **Slide E ("Get started"):** lists the live stores plus the stores the build holds for admins, shown live:
  Costco and Best Buy, then "More stores coming soon". This build ships only once Best Buy is enabled; before
  sign-in the admin flag and the server list are unknown, so the slide does not depend on them.
