# Home Promo Banner + Approved Promo Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-driven promo banner under the Home hero (reusable for any future event, zero space when off), plus a promo push that can only be sent after Maxim previews and approves it.

**Architecture:** One config (`app_config` key `HOME_PROMO`, JSON) read by one pure module `backend/lib/homePromo.js`. A cap-gated route `GET /api/me/home-promo` answers `{ promo }` or `{ promo: null }`; the phone renders the banner only for a non-null answer. The push is two admin routes (preview → approve-and-send) over `sendUserPush`, with a send ledger table.

**Tech Stack:** Node/Express + Drizzle (backend, `node --test`), React Native (jest), existing `promoCodes` rules, `notificationCategories`, `marketingGate`.

**Spec:** `Technical/Home_Promo_Banner_Design.md` (Priceback-Documentations)

## Global Constraints
- Branch `main-test-features`. Backend change is **additive only**; new route exists only for builds sending cap `home-promo` (steps aside before auth, like `promo-code`).
- First event: code `BLACK`; banner/push end **2026-11-30 23:59 America/Toronto** (Cyber Monday). **Do not touch the `BLACK` row** (`ends_at` stays `2027-01-01`).
- Audience = `promoCodes.accountEligibility` (never subscribed + Canadian store). Subscribers never see the banner (`isCreditExempt` rule, CLAUDE.md "Subscribers come first").
- One window rule, ends **exclusive** (`now >= endsAt` → off); one function used by the route and the push.
- Every label in `en` + `fr` (`src/services/i18n.js`); server copy is per-language data with English fallback, never blank.
- Dates on a shopper screen print on the device zone (`i18n.formatDate`); admin screens print Toronto (`adminDateTime`).
- **A push is never sent without Maxim's explicit approval of the exact copy and counts.** No cron, no deploy hook, no auto-send. Marketing push honours CASL consent (`marketing_push`) — fails closed.
- Docs go to `Priceback-Documentations`; append `Operations/Task_Log.md`; run `npm run i18n:check`, mobile `npm test`, and the touched backend files individually.

## Review Focus
- Subscriber with an empty/wrong phone cache → no banner, no push (pin with a test).
- Non-Canadian or `storeCountry` unknown account → no banner.
- Config missing, malformed JSON, or `enabled:false` → `{promo:null}`, phone renders `null` with no wrapper View/margin.
- Exactly at `endsAt` → off; one ms before → on.
- Route error / 503 / offline → banner hidden, Home never crashes.
- FR copy missing → English shown, never empty.
- Preview then copy edited then approve with the old token → refused (stale).
- Second approve of the same campaign → refused (already sent). User without marketing consent → not sent.

---

### Task 1: Pure rules `backend/lib/homePromo.js`

**Files:** Create `backend/lib/homePromo.js`; Test `backend/tests/homePromo.test.js`

**Interfaces:**
- Produces: `parseConfig(raw: string|object|null) -> Config|null` (`{ id, enabled, code, startsAt, endsAt, copy: { en:{title,body,cta}, fr?:{…} } }`; null if malformed)
  `isLive(config, now: Date|number) -> boolean` (enabled, `startsAt <= now < endsAt`)
  `viewFor(config, lang: string) -> { id, code, title, body, cta, endsAt } | null` (language → `en` fallback per field)
  `audienceFor({ everSubscribed, storeCountry }) -> boolean` (delegates to `promoCodes.accountEligibility`)

- [ ] **Step 1: Write failing tests** `homePromo.test.js`: `isLive` true 1 ms before `endsAt`, false exactly at it; false when `enabled:false`; `parseConfig('{bad')` → `null`; `viewFor(cfg,"fr")` returns French title but English `cta` when `fr.cta` missing; `viewFor` never returns an empty string field; `audienceFor({everSubscribed:true,storeCountry:"CA"})` false, `({everSubscribed:false,storeCountry:"US"})` false, `({everSubscribed:false,storeCountry:"CA"})` true.
- [ ] **Step 2: Run** `cd backend && node --test tests/homePromo.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** the four functions in `lib/homePromo.js` (pure, no I/O; reuse `promoCodes.accountEligibility`).
- [ ] **Step 4: Run** same command → PASS.
- [ ] **Step 5: Commit** `feat(promo): pure home-promo rules`.

### Task 2: Route `GET /api/me/home-promo` + cap

**Files:** Modify `backend/lib/appVersionGate.js` (`APP_CAPS.HOME_PROMO = "home-promo"`), `src/services/appVersionGate.js` (`APP_CAPS` array), `backend/server.js` (next to the promo-code routes ~11749); Test `backend/tests/homePromoRoute.test.js`; update `__tests__/appCapsHeader.test.js` / `backend/tests/appCaps.test.js` expectations.

**Interfaces:**
- Consumes: Task 1; `getOpsConfig`-style read of `app_config` key `HOME_PROMO` (read at every call, no cache); `_promoCodesRepo.everSubscribed(sub)`; `isCreditExempt` verdict; store country from query `?storeCountry=CA` via `parseStoreCountry`.
- Produces: `{ promo: null | { id, code, title, body, cta, endsAt } }`. Language from `userPushLang(sub)`.

- [ ] **Step 1: Write failing tests** (route level, DB-free stubs where the suite allows): request without `X-App-Caps: home-promo` → 404 (same as unknown path); eligible Canadian never-subscribed + live config → promo; **subscriber (`isCreditExempt` true) → `{promo:null}`**; `storeCountry=US` → null; config absent → null; DB error → `{promo:null}` (never 5xx for a missing config).
- [ ] **Step 2: Run** `node --test tests/homePromoRoute.test.js` → FAIL.
- [ ] **Step 3: Implement** route using the cap gate pattern of `_hasPromoCap`, `requireAuth`, `requireDb`; add the cap to both cap lists.
- [ ] **Step 4: Run** the new test plus `appCaps.test.js`, `promoCodes.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(promo): home-promo route behind its own cap`.

### Task 3: Phone service + banner component

**Files:** Create `src/services/homePromoService.js`, `src/components/HomePromoBanner.js`; Modify `src/services/i18n.js` (en + fr: `homePromo.validUntil`, `homePromo.a11y`); Test `__tests__/homePromo.test.js`

**Interfaces:**
- Produces: `loadHomePromo() -> Promise<Promo|null>` (never throws; any failure → `null`); `normaliseHomePromo(p)`; `<HomePromoBanner promo onPress />` returns `null` when `promo` is null.
- Consumes: `applyPromoCode(code)` from `promoCodeService`.

- [ ] **Step 1: Write failing tests:** `loadHomePromo` returns `null` on network error, 404, malformed body; `normaliseHomePromo` drops a promo with empty `code` or `title`; `HomePromoBanner promo={null}` renders `null` (assert `toJSON() === null`); with a promo shows title, code, and "valid until" via `i18n.formatDate`; press calls `onPress`.
- [ ] **Step 2: Run** `npx jest __tests__/homePromo.test.js` → FAIL.
- [ ] **Step 3: Implement** service (same `authedFetch`/timeout pattern as `promoCodeService._call`, sends `storeCountry`) and component (style like the existing Home cards; `accessibilityRole="button"`; testID `home-promo-banner`).
- [ ] **Step 4: Run** test + `npm run i18n:check` → PASS.
- [ ] **Step 5: Commit** `feat(promo): home promo banner component + service`.

### Task 4: Wire into Home, tap → code applied → paywall

**Files:** Modify `src/screens/HomeScreen.js` (render directly after the hero `LinearGradient`, ~line 725); Test `__tests__/homePromoHome.test.js`

**Interfaces:** Consumes Task 3. Opens the paywall the same way `lowBalanceBanner` does (builder: copy its navigation call).

- [ ] **Step 1: Write failing tests:** Home with `loadHomePromo` → `null` has **no** `home-promo-banner` node and no extra spacer (snapshot of hero's sibling list unchanged vs today); with a promo the banner is directly below `home-hero`; tapping calls `applyPromoCode("BLACK")` then navigates to the paywall; **if `applyPromoCode` fails the paywall still opens** (the paywall's own promo box lets the shopper type it); a subscriber whose server answer is `null` never shows it (`subscriberNeverPaywalled.test.js` pattern).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** a focus-time `loadHomePromo()` into state; render `<HomePromoBanner>` only when non-null.
- [ ] **Step 4: Run** new test + `__tests__/homeScreen*.test.js` (existing Home suites) → PASS.
- [ ] **Step 5: Commit** `feat(promo): show the home promo under the hero`.

### Task 5: Admin on/off + config (data, not a build)

**Files:** Modify `backend/server.js` (admin routes `GET/POST /api/admin/home-promo`, `ADMIN_USER_SUBS` gate like other admin routes), `src/screens/AdminPromoCodesScreen.js` (a "Home banner" section: switch, end time shown with `adminDateTime`); Test `backend/tests/homePromoAdmin.test.js`

**Interfaces:** Produces admin GET → `{ config, live: boolean, previewView: {en, fr} }`; POST `{ enabled }` only flips `enabled` (copy/dates stay data edited by seed script, see Task 7). Consumes `parseConfig`, `isLive`.

- [ ] **Step 1: Write failing tests:** non-admin → 403; POST `{enabled:false}` makes Task 2's route return `{promo:null}`; POST on a malformed/absent config → 409, not a crash.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement** routes + screen section (plain English admin copy).  **Step 4: Run** + `__tests__/adminPromoCodes.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(promo): admin switch for the home banner`.

### Task 6: Approved push — preview, then approve-and-send

**Files:** Create `backend/db/migrations/0068_home_promo_pushes.sql` (+ journal entry + `db/schema.js` table `home_promo_pushes(campaign_id text, sent_at, sent_by, token_hash, sent_count, skipped_count)`, PK `campaign_id`), `backend/lib/homePromoPush.js`; Modify `shared/notificationCategories.js` (add type `home_promo` to the `marketingPushConsent` category `types`; then `backend/scripts/sync-shared.js`), `backend/server.js` (admin routes); Test `backend/tests/homePromoPush.test.js`, `backend/tests/homePromoPushDb.test.js`

**Interfaces:**
- Produces: `POST /api/admin/home-promo/push/preview → { campaignId, recipients: { total, withConsent, eligible, willSend }, copy: {en:{title,body}, fr:{title,body}}, previewToken }` where `previewToken = HMAC(campaignId + copy + willSend)`, valid 30 min.
  `POST /api/admin/home-promo/push/send { previewToken } → { sent, skipped }`.
  `homePromoPush.audience(users) -> subs[]` = consent granted ∧ push token ∧ `audienceFor` ∧ not subscriber ∧ `accountReach.mayContact`.
- Consumes: `sendUserPush(sub, { build })` (language per user, `data.type = "home_promo"`, `data.url` opens the paywall on builds that know it; older builds just open the app), `filterMarketingByConsent`.
- Push copy (EN + FR, fixed in `homePromoPush.js`, reviewed by Maxim at preview): leads with the **annual plan as "unlimited"** and says credit packs can be **bought as many times as you want**, both under `BLACK`, valid until Cyber Monday.

- [ ] **Step 1: Write failing tests:** send without a token → 400; token from an older copy/count → 409 `stale_preview`; second send of the same `campaignId` → 409 `already_sent`; user without marketing consent / without token / subscriber / US store account is in `skipped`, never pushed; copy has both languages and mentions "unlimited" and the pack wording; **no code path calls send from a scheduler or at boot** (assert the module exports no auto-run and `schedulerGate` isn't imported).
- [ ] **Step 2: Run** the two test files → FAIL.
- [ ] **Step 3: Implement** migration (additive, idempotent; **apply to dev, then prod by hand before deploying code**, plus drizzle ledger row), lib and routes; ledger row written before sending (so a crash can't double-send), `sent_count` updated after.
- [ ] **Step 4: Run** both test files + `marketingGate.test.js`, `notificationCategories` tests, `migrationJournalLedger.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(promo): approval-gated promo push`.

### Task 7: First event config, docs, wrap-up

**Files:** Create `backend/scripts/seed-home-promo.js` (writes `app_config` `HOME_PROMO` for `BLACK`, Cyber Monday end, `enabled:false`, EN+FR copy); Modify `Priceback-Documentations/Technical/Promo_Codes_Design.md` (add "Home banner + approved push"), `Operations/Task_Log.md`; PR body "Old app builds" section.

- [ ] **Step 1:** Seed script is idempotent (`ON CONFLICT … DO NOTHING`); test that running it twice keeps one row and `enabled:false`.
- [ ] **Step 2:** Run full touched suites: mobile `npm test`, `npm run i18n:check`, each new backend file alone. Report results, not assumptions.
- [ ] **Step 3:** Document how to run the next event (edit the row, preview, approve) and the consent limit (only shoppers who granted marketing push consent receive it).
- [ ] **Step 4:** Commit docs; open PR to `main-test-features`. Merging to `main` follows the standing release rule (prod migration 0068 first, compatibility audit) — not done without the go.

---

## Self-review
- Spec coverage: server-driven slot (T1–2), banner under hero, zero space off (T3–4), eligibility/subscriber (T1–2,4), tap→code→paywall (T4), reusable/off as data (T5, T7), push with Maxim's approval (T6), code row untouched (T7, constraints).
- Types consistent: `parseConfig/isLive/viewFor/audienceFor` used identically in T2, T5, T6; `previewToken`/`campaignId` only in T6.
- Proportion: signatures + assertions only.
