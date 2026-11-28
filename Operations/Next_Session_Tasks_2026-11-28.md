# Next session — task list (written 2026-11-27, end of session)

Branch to work from: `main-test-features` (clean, synced with `main`). Read `Operations/Task_Log.md` (last entry, 2026-11-27) first.

## Where things stand (2026-11-27)
- **Live in production now:** the server-driven Home promo banner backend (`GET /api/me/home-promo`, cap `home-promo`), the admin switch and
  push routes, migration 0068 (`home_promo_pushes`, applied by hand with its ledger row), and the `HOME_PROMO` config row
  (`black-friday-2026`, **enabled**, code `BLACK`, ends Cyber Monday = 2026-12-01 00:00 Toronto).
- **Nobody sees the banner yet:** it needs an installed build that contains it (it is NOT in 3.6.9 / what Apple is reviewing). No build was started.
- **The promo push was NOT sent.** Maxim approved it in chat, but (a) the send needs the admin Preview → Approve screen, which is also only in
  a new build, and (b) the audience is almost empty (see below). Copy is in `backend/lib/homePromoPush.js` (EN + FR).
- **Audience reality (prod, read-only count, 2026-11-27):** 464 accounts with a push token; **4** granted marketing-push consent; all 4 in a
  Canadian province; **1** on build ≥ 3.6.5 (before removing subscribers / ever-subscribed). Marketing email: **0 of 627** ever granted.
- Everything is merged: #757 (feature) → `main-test-features`, #758 → `main`, #759 sync back. Railway deploy SUCCESS; route answers 404 without the
  cap, 401 with it and no sign-in.

## Decisions made this session (do not re-litigate)
1. **Consent is never fabricated or pre-ticked (Maxim was told, accepted a lawful route).** No bulk "grant consent as of signup", no pre-ticked
   marketing box, no marketing push to non-consenting users, no marketing email to all shoppers (0 email consents, no unsubscribe mechanism in
   the backend). Lawful routes: unticked opt-in at signup, a one-time ask for existing users, the banner (needs no consent).
   An email to **purchasers** under CASL "existing business relationship" (paid in the last 24 months) is possible but needs an unsubscribe link
   built and Maxim's confirmation of the legal basis first.
2. **Opt-in design APPROVED (Maxim, 2026-11-27 "yes approved"): ONE combined "Tips & offers" choice** that records two consent rows
   (`marketing_push` and `marketing_email`), wording says both channels. Two EQUAL buttons ("Yes, send me offers" / "No thanks"), no pressure
   copy (Apple 5.1.1(iv) rejected an earlier explainer), "No" is remembered so nobody is asked twice. Signup box stays UNTICKED.
3. **Banner audience = anyone without a valid subscription** (`isCreditExempt` false). `action: "none"` = announcement (code and cta optional).
   The PUSH audience is stricter (Canadian province + build ≥ 3.6.5 + never subscribed + marketing consent) because it promises a code.
4. **Do NOT change the AirPods overlapping savings** (Maxim, 2026-11-27): ending the older saving could hide a real deeper discount.
   Evidence: two live Same-Day rows per province for AirPods Pro 3 (SKU 7472260), $70 (Nov 19–25, run 213→280) and $55 (Nov 23–Dec 20, run 253→301,
   also in the coupon book). The harvest did not create the overlap and retired the $70 on its own end date.

## Update, end of 2026-11-28
DONE and in `main` + `main-test-features`: 3, 5 (specified parts), 7, 8, 9, 12 (partly). Migration 0069 and the `home_prompt` consent source are on prod. STILL OPEN: 1 and 2 (Maxim), 4 (brainstorm), 5 (the nearby / both-warehouse-types toggle: needs answers), 6 (screenshot + decision), 10, 11. See Task_Log 2026-11-28 (cont.).

## Progress 2026-11-28
Done and merged into `main-test-features` (#760–#762): task 7, task 8, task 12 (partly). Task 6 investigated, waiting on Maxim's screenshot (see Task_Log 2026-11-28). Still open: 1 (Maxim), 2, 3, 4, 5, 9, 10, 11. None of this is in `main` yet.

## Tasks, in order
1. **Maxim: build a beta APK from `main-test-features`** (version bump his call) so the banner and the admin push screen exist on a device.
   Until then: banner shows to nobody; push can't be approved from the app. Cyber Monday is 2026-11-30 — the banner and push both end 2026-12-01 00:00 Toronto.
2. **Push approval (when the build is installed):** Admin → Promo codes → Promo push → Preview, read the counts (expect ~0–1), Approve only if Maxim agrees.
3. **Opt-in asks (approved design above):** (a) signup: keep unticked, make it the combined "Tips & offers" (push + email rows, `version`, `source`);
   (b) one-time ask for existing users on Home (new build), two equal buttons, remember "No"; (c) Settings → Notifications "Tips & offers" switch
   records both rows; (d) EN + FR; (e) tests; backend: `marketing_email` consent already exists as a type, nothing collects it today.
4. **Onboarding third option** (Maxim's idea): next to "1 free week trial" / "75 free credits", a third choice for "just the free tools" (Deals and
   warehouse prices), no credit card; everything else in the app is pay-as-you-go with no credit. NEEDS A BRAINSTORM FIRST (what exactly is free,
   what a scan shows with 0 credit, is it a plan or no plan).
5. **Price history / Warehouse prices:** everything from the search result of any price list visible in the price-history screen; the warehouse shown
   bigger or in its own section under the product ("Last seen at XXXXXX #1234" under the price, regular price under it); the price evaluation is written
   twice (remove one); stock availability as the true last seen even if old, with the disclaimer that stock is updated for savings only; **search
   toggle to include both warehouse types and nearby warehouses** (for different price/availability; users and admin); **warehouse more visible on
   the Deals page / Prices-screen search results.**
6. **Bug: Apple iPad search** — both products have savings but no image and no regular price, so no price after savings. Not wanted at all; "not the first time".
7. **Bug: admin Sweep run button** is amber saying "last run just now · 1 price drop found" when there is no price drop; message and colour must be accurate.
8. **Hero card:** swap back to 7 s (or 6 s) with a slightly slower animation (check best practice); **slide 1 shows the missed drops below** (real money missed = conversion).
9. **Uninstall tracking:** only approximate — first `DeviceNotRegistered` from Expo/APNs per user, record that date (iOS days late; no exact Android event without Firebase Analytics).
10. **AirPods "overlap":** ask Maxim for the screenshot (is it a text collision on the Warehouse prices screen, or the date overlap?). Display-only if anything; never end a saving.
11. **Roadmap, not designed:** `Roadmap/Deeper_Discount_On_Discounted_Items.md` (vanilla bean paste at the Business Centre; three open questions inside).
12. **Promo follow-ups (small):** save the phone's real `storeCountry` on promo requests (province stands in today); a `failed_count` column on `home_promo_pushes`;
    FR "Cyberlundi"; a non-admin HTTP 403 test for the admin push routes; double-tap Approve can open two alerts (server ledger still prevents a double send);
    a successful push result is styled red; dead `audience()` export; i18n keys `homePromo.*` sit inside the `promo.err.*` group.

## Known red / not ours
- `dataCleanupRegistry` DB test fails on dev (`consumed_trials` unmapped); `dealsDb` "the row shape" fails without these changes too.
- Mobile full suite: `receiptSelfChecks` trips the leak guard under full-suite load, passes alone (18/18).
- `node --test` skips DB suites silently without `--env-file=.env`; `.env` points at DEV (`gnedluuylimjwdmtvswl`) only.

## Housekeeping
- Docs repo had unrelated untracked `Roadmap/Auto_Reload_Credit_Packs.md` (not mine); left alone.
- App repo: only `feat/store-spaces-v2*` worktrees and `development` remain besides `main` / `main-test-features`.
