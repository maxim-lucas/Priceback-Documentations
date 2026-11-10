# Store Spaces v2 — design

**Status:** draft for Maxim's approval · 2026-11-10
**App branch:** `feat/store-spaces-v2`, cut from `main` at `70991cb3` (3.6.1, build 60). **Not merged** until Maxim says so.
**Source design:** Claude Design project `96786fd7-4201-49b9-a7f1-2143421c50fa`, file `Store Spaces v2.html` and the files it loads:
`redesign/shared.jsx`, `redesign/spaces2-parts.jsx`, `redesign/spaces2-deals.jsx`, `redesign/spaces2-app.jsx`, `redesign/spaces2-onboarding.jsx`.
**Hero-colour comparison page:** https://claude.ai/artifact/5DkphWucy4YZC2ttuuYD2e

---

## 1. Intent

One home for all stores, one space per store. Today the app is shaped around one store (Costco) with a Stores tab
listing everything else. The redesign makes every live store a first-class space, moves the Profile into "Me", adds a
Deals tab, rebuilds onboarding around a country/language choice and a one-time trial choice, and recolours the paywall's
top card.

## 2. Rules for this work (Maxim, 2026-11-10)

These came with the request and override any default:

1. **The rendered app matches the design exactly**, screen for screen: spacing, sizes, colours, copy, order. *"the design
   for any and every screen in the app should 100% exact to the rendered one in the app."* The comparison artifact was
   only for choosing the hero-card colour; it is not a layout reference.
2. **Don't take decisions alone. Don't change existing app behaviour without asking.** Anything the design implies but does
   not settle is listed in §12 and asked, not assumed.
3. **Stores come from the database only.** The design's stores (Walmart, Canadian Tire, Home Depot, Sport Chek, and its
   "6 stores (preview)" switch) are placeholders. Every store list, rail, pill and slide is built from
   `getEnabledStores()` (the `stores` table via `applyRemoteStores`), so a store appears the day `stores.enabled` is
   turned on, with no build.
4. **Best Buy stays hidden from shoppers.** It is visible only to admin accounts, through the existing `adminPreview` rule
   (CLAUDE.md: a finished store ships admin-only). Answer: *"Admins still see it."*
5. **The postal code is never empty.** An empty or invalid postal code can never enable "Create account".
6. **Account creation requires language, province and postal code.** Language comes from the new first screen (A) and is
   saved to the account. The province is **calculated** from the postal code and shown read-only, with no manual picker.
7. **The 1-week Unlimited trial is configured in Google Play and App Store Connect before any build of this version.**
   *"never build this version without it."* Claude configures both consoles through Chrome, reads every value back and shows
   Maxim before saving.
8. **One trial per account, ever.** *"if a user already used the free trial he should not get any of the trial perks. so if
   he already did 1 week unlimited, he cant have another week and he cant have free credit he should be stuck to charge the
   credit or subscribe."* The week and the 75 credits are mutually exclusive, and neither comes back.
9. **Paywall hero card = option B** (screen H's card: emerald `#10b981`, soft white circle top-right, `#ecfccb` eyebrow,
   white amount, `#f0fdf4` body). **The body shows the total only, never the drop count.**
   Note recorded: B's body text is 2.4:1 on the emerald, below WCAG AA; Maxim chose it with that shown.
10. **Deals and the store vote are built fully**: backend and screens.
11. **The Stores tab is removed as designed**, including its Coming-soon list. Tabs become Home · Receipts · Scan · Deals · Me.
12. **Store-vote options are the database stores that are not live**, plus "Something else" with a text field.

Standing rules that also apply: every label in `en` + `fr` (`npm run i18n:check`), no raw codes on screen, the backend
never breaks an installed build (§10), Costco parser code untouched, tests in the same commits, docs in this repo.

## 3. What exists today (measured on `main` 70991cb3)

| Design element | Today | Gap |
| --- | --- | --- |
| Tabs Home · Receipts · Scan · Deals · Me | Home · Receipts · Scan · Stores · Profile (`App.js` MainTabs + PreviewTabs) | Stores → Deals, Profile → Me |
| Home hero ("To claim" / "Total saved") | `HeroPager.js` with a chart | smaller, no chart |
| Store rows / store space / All stores sheet | none | new |
| Scan selector sheet | `ScanModeSwitcher` / Scan modal | new sheet, store pills |
| Receipts by receipt / by product | `ReceiptsScreen` | store pills, restyle |
| Deals tab, filters, sort | none for shoppers; `/api/flyer/active` only | new route + screens |
| Me | `ProfileScreen` (ProfileKit) | restyle, same rows |
| Plans & credits | `Paywall.js` V2 (already mirrors `SpPlans`) | hero colour + copy only |
| Store vote | `POST /api/stores/:code/notify-me` (launch push) | new vote route + table |
| Onboarding | slides → sign-in → `SetupStep` (postal, province picker, consents) | screen A, new slides, account screen, trial screen |
| 75 free credits | granted automatically at verified signup (`usersRepo` ensure-user, `users.trial_credits_granted_at`, email tombstone `emailEverGrantedTrial`) | becomes a choice on screen H |
| 1-week free trial | does not exist anywhere | store offers + eligibility + server record |
| Language on account | `user_preferences.language` | required at creation |
| Costco membership | `gold_star`, `executive` (`CostcoProfileScreen`) | design adds **Business** (§12) |
| Nearest warehouses with km | warehouses carry lat/lng; a postal code maps only to a city (`postalFsaCities.js`) | no postal → coordinates (§12) |
| Savings data for Deals | `savings` + `saving_warehouses` + `product_regular_prices` + `channels` | no product category column (§12) |

## 4. Store list rule (applies to every screen)

- One source: `getEnabledStores()` from `src/constants/stores.js`. It already returns DB-enabled stores plus, for an admin,
  stores held with `adminPreview`. No screen names a store id in JSX.
- Order: the `stores` table order (Costco first today).
- A store's **tools** (receipt, price tag, price translator, Price Checker) and its **Deals quick filters** differ per store
  in the design. Where that difference lives is an open question (§12, Q1); until answered nothing is hard-coded per id.
- An admin sees an "Admin preview" marker on a held store (as the Stores tab does today), so a held store is never mistaken
  for a launched one.
- Shopper with one live store (Costco only, today's prod): the rail, the pills and the All-stores grid show one store. Their
  look at n = 1 is in §12, Q2.

## 5. Onboarding (design A–H)

| Step | Screen | Notes |
| --- | --- | --- |
| A | Country & language | Canada only, flag, "Coming soon to the United States and Europe" in small type. Languages come from `getSupportedLanguages()` (en, fr). Choosing a language switches the whole flow live. The choice is held and saved with the account at step G. |
| B–E | Four slides: Scan, Get alerted, Claim, Your stores | Progress bars, Skip jumps to the last slide. Slide E lists live stores from the DB (rule §4), not the design's Costco + Best Buy. Its per-store subtitle ("Price adjustments · warehouse deals · price tags") comes from the store's tools (§12, Q1). |
| F | Sign in | Apple first on iOS, then Google. Same providers and code paths as today (`SignInStep`). |
| G | Create account | See §6. |
| H | Choose your trial | See §7. |

The returning-user paths (restore, `decideSignInRoute`, profile already complete) keep today's behaviour: a returning
shopper never sees A–H again.

## 6. Create account (step G)

Fields, top to bottom as designed:

1. **Postal code** (required). Live formatting `A1A 1A1` (existing `formatPostalCodeInput`), validated by
   `normalizePostalCode`. Empty or invalid ⇒ button stays disabled.
2. **Province** (required, read-only), calculated with `provinceFromPostalCode`, shown under the field as
   "Ontario · from your postal code". A code that maps to no province shows a translated error and keeps the button
   disabled. The manual province picker is removed from this screen.
3. **Costco card (optional)**: membership segmented control (Gold Star default) and nearest warehouses (radio list plus
   "I don't shop at Costco"). Shown only while Costco is a live store, since stores come from the DB.
4. **Promo code (optional)**: the existing redeem-code path, same order as today (redeem before the profile save).
5. **Consents**: Terms (required), Privacy (required), "Send me deal tips" (optional ⇒ existing `marketing_push` consent).
6. **Create account** is enabled only when postal is valid **and** a province was calculated **and** a language is set **and**
   both required consents are ticked.

Saved through the existing `syncProfileToBackend` (postal code, province, city from FSA, consents) plus `language`.

## 7. Trial choice (step H) and the one-trial rule

### 7.1 What the shopper sees

- **Eligible** (never had either perk): two boxes as designed. "1 week of Unlimited" pre-selected with three perks and
  "Free / then $4.99/month", or "75 free credits". The CTA and its fine print follow the choice. Prices come from the live
  store product, never a literal (`$4.99` in the design is a placeholder; store-copy rule from the 2.8.20 rejection).
- **Sticky**: an eligible account with no recorded choice opens on H at every launch until it chooses (§13 Q4).
- **Not eligible** (already had the week, or the credits, on this account or on a tombstoned account with the same email, or
  the store reports the account as not eligible for the introductory offer): no trial perks. What screen they land on is
  the Plans & credits paywall (§12 Q3).

### 7.2 Store configuration (before any build)

| Store | Where | Setting |
| --- | --- | --- |
| Google Play | Monetize → Subscriptions → Unlimited → monthly base plan → **Add offer** | Free-trial phase **7 days**, eligibility **New customer acquisition**, regions = the base plan's (Canada + Egypt), offer tag for RevenueCat |
| App Store Connect | Subscriptions → Unlimited monthly → **Introductory Offers** | **Free**, **1 week**, all territories the subscription sells in (Canada + Egypt) |
| RevenueCat | Offerings | confirm the monthly package surfaces the intro offer and `checkTrialOrIntroDiscountEligibility` returns per-product status |

Done through Chrome with Maxim watching; every value read back after saving (Play Console stages edits).
Documented in `Operations/` with screenshots.

### 7.3 Server side

- New nullable columns on `users` (additive migration): `trial_choice` (`'week' | 'credits'`) and `trial_chosen_at`.
- `POST /api/me/trial-choice { choice }`:
  - `credits`: grants `FREE_TRIAL_CREDITS` through the existing guarded update (`isNull(trial_credits_granted_at)` plus
    the email tombstone), records the choice. Refused when a week was already taken.
  - `week`: records the intent. The grant itself is the store purchase. The RevenueCat webhook's `period_type: TRIAL`
    event stamps `trial_choice = 'week'` even if the app never called the route, so a week bought outside onboarding
    still burns the credits.
- **Eligibility** for the screen = server says neither perk used **and** the store says intro-eligible.
- **Existing accounts** already got their 75 credits at signup, so under rule 8 they are not eligible for the free week.

### 7.4 Old builds (backend rule)

Old builds have no step H and expect the 75 credits at signup. The automatic grant in ensure-user **stays** for every
request that does not prove it comes from a build with step H. A new build sends a new optional request field
(`deferTrialCredits: true`) on the ensure-user call, and only then is the grant deferred to the choice route. A request
without the field behaves exactly as today. That keeps 2.8.3 … 3.6.1 unchanged.

## 8. App screens

Every screen is built to the design's render (rule 1). Data replaces every placeholder.

- **Home**: lockup, Admin button (admins only, opens Admin home), bell (no search, §12 Q11), with the open-drop count (opens To claim).
  Hero pager: "To claim" (amount, drop count, receipt count, soonest deadline) then "Total saved · all-time" (this month,
  spent this year). No chart. Guarantee strip for Pay-as-you-go only. "Your stores" rows (receipts · price drops · amount to
  claim), as rows (§12 Q13). With a single live store the Home tab opens that store's space instead (§12 Q2).
- **To claim**: every open drop, store pills ("All stores" + each live store with its count), soonest first, the hint
  card. Locked-drop rules from 2026-11-07 still apply (amount shown, identity hidden, "few days left").
- **Store space**: home button, sideways store rail (dark = current, drop count), grid button opens **All stores** sheet
  (search, 3-column grid, back to Home). Costco: warehouse card ("Change ›" opens Costco profile). Big "Scan a <store>
  receipt" button, other tools grid with their tags (Unlimited / Offline / Earn credits), "To claim at <store>", links to the
  Receipts and Deals tabs pre-filtered.
- **Scan sheet** (centre tab button): store pills, Scan a receipt, "More useful tools". Each row opens today's screen
  (Scan, PriceTagScan, PriceTranslator, BarcodeScan) with today's gating (Price Checker locked behind Unlimited).
- **Receipts**: By receipt / By product, store pills. Same data and row actions as today's `ReceiptsScreen`.
- **Deals**: store pills, Filters (count), per-store quick filters, list header with count and sort, deal rows (§9).
- **Me**: dark card (name, plan, credits or Unlimited, Buy credits, Manage, Credit history), Earn free credits, Guarantee
  card (Pay-as-you-go), community + socials, Activity, Preferences (adds "Country & language"), Help & community, Account,
  "Vote for our next store ›" at the bottom. Every row keeps today's destination and behaviour. Rewarded-ads offer from
  `feat/ads-rewarded-credits` is not on `main`, so it is not here.
- **Plans & credits**: today's `Paywall.js` V2 unchanged except the hero card (rule 9). Copy:
  - EN: eyebrow "Found on your receipts", amount, body "in price drops on items you bought. Unlock them to see each one and
    claim it at the store."
  - FR: "en baisses de prix sur des articles que vous avez achetés. Débloquez-les pour voir chacun et le réclamer en
    magasin."
  - `paywall.v2.foundBodyOne` / `{count}` are no longer rendered there.
- **Store vote**: §9.2.

## 9. New backend

### 9.1 Deals feed

`GET /api/deals?store=<id>&warehouse=<id>&sort=<k>&q=<quick,...>&price=<band>&type=<all|warehouse|business>`

- Costco: current rows of `savings` (not superseded, `valid_until >= today`) for the shopper's province, narrowed to the
  chosen warehouse through `saving_warehouses`; regular price from `product_regular_prices`, so "was / now / −$" is real.
  Business Centre from `channels`. "Bought before" = the product appears in the shopper's receipt items. "Executive only"
  from the saving's `flags` (§12, Q5).
- Sorts: biggest saving $, biggest saving %, lowest price, highest price, ending soonest.
- Paged, cached per (province, warehouse, day), read-only, no scheduled job, so no new infrastructure cost.
- Best Buy (admins only today): source is §12, Q6.

### 9.2 Store vote

- Table `store_votes` (`user_sub` PK, `store_id` nullable FK to `stores`, `other_text` nullable, `created_at`). One vote per
  account; re-voting is refused.
- `GET /api/stores/vote` → options = stores with `enabled = false` (Coming soon) plus "Something else", the shopper's vote,
  and the share per option once they voted.
- `POST /api/stores/vote { storeId | otherText }`.
- The design's "Thanks! We'll tell you when it's live." implies a vote also subscribes the shopper to that store's launch
  push through the existing `store_launch_subscriptions` (§12, Q7).
- The existing notify-me routes stay for old builds.

## 10. Old app builds

- Stores tab, Profile → Me, new onboarding: client-only, no server effect.
- `/api/deals`, `/api/stores/vote`, `/api/me/trial-choice`: new routes; no shipped build calls them.
- `users.trial_choice`, `trial_chosen_at`, `store_votes`: additive migration applied to dev, then prod before the backend
  that reads them.
- 75-credit grant: unchanged for every request without `deferTrialCredits` (§7.4).
- Notify-me routes untouched.

## 11. Delivery

- Branch `feat/store-spaces-v2` from `main`, worked in its own worktree so the `feat/ads-rewarded-credits` checkout is
  untouched. Not merged.
- Tests in the same commits (mobile jest, `i18n:check`, backend files in the blast radius on the dev DB). No Actions run
  unless Maxim dispatches one.
- **No EAS build** until rule 7 (both consoles configured) holds, and then only when Maxim asks.
- Task log entry, and this doc kept current as answers arrive.

## 12. Maxim's answers (2026-11-10, second round)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Per-store tools and quick filters: DB field or app code? | *"yes"* (read as: a field on the `stores` row, set in Admin · Stores; **to confirm**, §13) |
| 2 | One live store | *"if you can do that it open straight into costco space and when a store is active it adapts, fine if not keep the row."* With one live store the Home tab opens that store's space; with two or more it shows the all-stores Home with rows. |
| 3 | Not eligible for a trial | Lands on the **Plans & credits paywall** after account creation. |
| 4 | Costco Business membership | **Add `business`** beside `gold_star` and `executive`. |
| 5 | Executive-only deals | Read it from the saving's data **if it exists**; when there is no Executive-only data the chip and the quick filter are **hidden**. |
| 6 | Best Buy in Deals | *"all best buy buttons, filters, navigation, ...etc (or any disabled store) shouldnt show until the store is live."* Applies to every disabled store. How this meets the earlier "admins still see it" is **to confirm**, §13. |
| 7 | A vote = launch notification | **Yes**: a vote also subscribes the shopper to that store's launch push (`store_launch_subscriptions`). |
| 8 | Deal category | **Add a category column** to products; the Category section of the filter sheet stays **hidden** until it can filter. How it gets filled is later work. |
| 9 | Deal row "+" | Future **watchlist**: documented in `Roadmap/Deals_Watchlist.md`, **not built now, button hidden**. |
| 10 | Nearest warehouses | **Coordinates based**: add postal-prefix (FSA) coordinates so warehouses sort by real distance and show km. |
| 11 | Home search | **Remove search from Home.** Every search button searches only within its own screen (Receipts searches receipts, Deals searches deals, All stores searches stores). |
| 12 | French for app screens | Claude writes it; **Maxim reviews in the PR**. |
| 13 | Home store layout | **Rows.** |

## 13. Third-round answers (2026-11-10)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Per-store tools and quick filters | **App code**: a per-store table in the app (`src/constants/storeSpaces.js`). A new store's tools ship with a build. Proposed default for a live store with no entry: receipt scan only, no quick filters (confirm in review). |
| 2 | Admin view of a held store | **Admins still see it** (marked "Admin preview"). Shoppers see no button, filter, pill, slide or navigation for a disabled store. |
| 3 | 75 credits vs the week | **Today's rule wins**: the week **or** 75 credits, never both. A shopper who cancels the trial has 0 credits. `Roadmap/Unlimited_Free_Trial.md` §4 updated. |
| 4 | Free week on the paywall | **Only screen H.** The paywall always shows normal prices. *"if the user closes the app before choosing, the app should open always on the same screen to let him choose."* Screen H is sticky: an eligible account with no recorded choice reopens on H at every launch, on any phone, until it chooses (the server's `trial_choice IS NULL` is the source, so a reinstall also lands on H). |

## 14. Fourth-round answers (2026-11-10)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Screen H's X | *"x = close and open the app but keeps a button to reopen the screen if needed to choose his trial type (button should be start your free trial)"*. X opens the app with no perk granted; a **"Start your free trial"** button stays available and reopens H until a choice is made. |
| 2 | Console set-up timing | **After the implementation plan**, and before any build. |

## 15. Still open

1. Where the "Start your free trial" button lives (the design has no such button).
2. After X, does H still open by itself at the next launch, or only from that button?
