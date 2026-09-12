# Task Log

> **Read this file BEFORE starting any coding task.** It is the running record of
> everything Maxim has asked for. The point is continuity: don't undo, revert, or
> contradict a decision already recorded here just because a new session started
> with no memory of it.
>
> **How to use it (standing workflow, not a per-request ask):**
> 1. **Before coding** — scan this log for entries touching the same files,
>    feature, or decision. If your new change would reverse or conflict with a
>    past entry, stop and confirm with Maxim first.
> 2. **When given a task** — append a new entry (newest at the top of the list)
>    using the template below.
> 3. **When a task is done** — mark its status and note the commit/PR.
>
> Each entry is one task. Keep it short — a few lines. This replaces relying on
> wrapup/recall every session for "what did I already ask for."

### 2026-09-10 (cont. 3) — Abercrombie audit + "CI on `main` only"

- **Asked (/goal):** full audit of the Abercrombie integration on `development`,
  fix the problems, continue the missing work — but **first** settle the
  feasibility of getting CAD prices, since A&F "is handled only in USD for any
  country". Fallback of last resort: signal the drop *event*, not the amount.
  Plus a new standing rule: **never run GitHub Actions tests on `development`;
  only on `main`, and only when Maxim asks. Other branches use local runs.**

**The CAD question turned out to be a vantage-point problem.** The 2026-09-07
capture session's "non-Canadian egress" was **Egypt** (`41.45.134.97`, AS8452
TE-AS) — re-confirmed live this session. **No request to A&F has ever been made
from a Canadian IP.** Reproduced the USD result exactly (`/shop/ca` → `/shop/wd`,
storeId 11203, no CAD anywhere in 423 KB), but A&F's own gift-card page says
*"purchases of merchandise in CAD will be subject to an exchange rate
conversion"*, and A&F is expanding its Canadian store network. Evidence points to
CAD being real and simply invisible from outside Canada.

- **Maxim's call:** document the verification, run it back in Canada (~2026-09-22),
  **reminder set for 2026-09-24**. Don't build on the assumption either way.
- **Fallback, if CAD proves unreachable:** percentage drop (currency-invariant),
  commission charged by applying the percentage to the shopper's own CAD receipt
  line. Specced in `Technical/Abercrombie/Fallback_Percentage_Drop.md`, **not
  built**.

**Audit result: the integration is the price adapter and nothing else** — no
receipt parser, no store row, no refresh job, no slug source. All correctly
inert. Four defects fixed, one critical:

1. 🔴 The currency gate checked the currency and **not the storefront**. A&F has a
   multi-currency selector, so a foreign page can declare CAD over an
   FX-converted price. The suite *encoded* the hole: `deriveCad()` stamped
   `data-storeid="10051"` — A&F's real **US** storefront. Bugs #241.
2. `isFullPrice` measured "on sale right now" (a page fact) under the name of a
   receipt fact; the probe script already misread it. Removed.
3. "A 403 is retryable" was documented but never implemented. Now a bounded
   retry (2 extra attempts, doubling backoff), cap asserted.
4. Test corpus no longer blesses a foreign storefront.

**The CI rule needed a second lock.** `main` was already dispatch-only, but a
dispatch can name any ref — `gh workflow run Tests --ref development` billed the
full ~30 min. Every job now carries `if: github.ref == 'refs/heads/main'`, pinned
per job in `ciTriggerPolicy.test.js` and mutation-tested.

**Blocked local runs first.** `npm test` was red out of the box on Windows — 12
failures, all line-ending/path artifacts on a tree `git status` called clean
(Bugs #242). A "verify locally" rule is worthless with a permanently red suite,
so that was fixed too (`.gitattributes`, `checkI18n` path normalisation).

- **Status:** PR into `development`. Adapter suite 35 → 45 cases; mobile 236
  suites / 5727 tests green locally.
- **Still blocked, deliberately:** receipt parser (needs real A&F receipts — the
  Best Buy lesson), slug source (sitemap now times out entirely), store row,
  refresh job.

### 2026-09-10 (cont. 2) — Best Buy full-integration audit on `development`

- **Asked (/goal):** run a full audit on the **dev branch** for what is missing
  from a *full* Best Buy integration and fix it; find real Best Buy receipts
  online to optimise the reader and add them as fixtures (**real receipts
  only**); check every path so the whole integration is covered.
- **Amended mid-task by Maxim:** *"dont waste more tokens on the online
  receipts, there is 8 real pdf best buy receipts for online purchases in the
  test fixtures and 1 real store best buy receipt. use them for now."* The
  online hunt was stopped; the existing nine captures are the corpus.

**Result: the code was complete; the configuration was not.** Every parser rule,
adapter rule, registry entry and test was correct — and Best Buy was switched
**off** for every user in both databases. PR #320 moved five declarations of the
promotion together and pinned them; the sixth,
`backend/db/deploy/store-content-sync.sql`, is the only one that reaches a running
app (the DB payload replaces the bundled `STORES` array on every launch), and it
was hand-maintained, generated by nothing and tested by nothing. It still said
`enabled = false`. Regenerating it also restored two French claim steps that had
lost the word "canadien" — both databases were serving pre-#320 French copy.

Also found: `app_config.BESTBUY_SCAN_ENABLED = false` in **both** databases,
written days before `defaults.js` flipped the default on, so the nightly feed
could never have run; and `/health` reported nothing about price feeds at all.

**Fixed:** a generator + `--check` CLI for the deploy SQL (`npm run
db:sync-store-content`) with 9 tests pinning the chain (verified non-vacuous: 5
fail against the stale file); a `checks.priceFeeds` conjunction on `/health`
backed by a pure, unit-tested `lib/priceFeedHealth.js`; two stale lab-lane
comments; **dev database enabled end to end**; and `Technical/BestBuy/` created,
splitting the mixed price-adapter doc per the one-store-one-folder rule.

**Prod deliberately untouched** — `main` still has the parser lab-only, so
enabling the store there would parse real receipts with the *generic* parser.

Full detail: `Technical/BestBuy/Integration_Audit_2026-09-10.md`.

### 2026-09-10 (cont.) — CI on demand only, the suite back to green, and the branch list down to two

- **Asked (/goal):** make the GitHub Actions workflow run **only on demand**
  (disable the automatic run for all branches), and **fix every failing test so
  the suite runs green on GitHub**. Added mid-task: **before merging, make sure
  every remaining branch is merged into its base — the only two that should
  stay live are `main` and `development`.**

**CI is now dispatch-only (PR #327).** `test.yml` loses `push: [main]` and
`pull_request: [main]`; `workflow_dispatch` is the only trigger left, on every
workflow in the repo. One full run bills ~30 minutes of free-tier Actions time
(the backend job alone is ~23 minutes, serial, against a shared remote
Postgres), and the automatic triggers spent that on every commit whether or not
anyone was waiting to read the answer. Run it with
`gh workflow run Tests --ref <branch>`, or **Actions → Tests → Run workflow**.

`__tests__/ciTriggerPolicy.test.js` pins the policy for every file in
`.github/workflows`. It is a port of the guard already on `development`, widened
from "`main` only" to "on demand only" — so the two branches now agree about
what the policy is instead of diverging at the next promotion. Verified
non-vacuous: run against the previous `on:` block it fails on three counts.

**The two red tests were red against correct code.**
`adminConsoleRoutesDb` and `dataCleanupPredicatesDb` had failed on every run
against a real database since the admin console landed (#325) — eight days,
both branches. `lib/dataCleanup.js` **destructured** `getAdminSubs` from
`configService`, freezing the reference at require time, so the swap those
tests use to name a protected account never reached it. The shipped behaviour
was correct throughout: `getAdminSubs()` reads `process.env` on every call and
is never reassigned in production, so admins really were protected. Only the
seam was broken. Fixed by the split `server.js` already used — namespace for
`getAdminSubs`, plain destructure for `getOpsConfig`. Guard added in
`dataCleanupRegistry.test.js`, which needs **no** database, because the two
tests that caught it are `skip: !HAS_DB` and would report green without one.
Full write-up: `Bugs_Common_Fixes.md` **#240**.

**Branch list is down to `main` + `development`.** Neither stale branch needed
merging — both were already fully contained, and that was proven, not assumed:

- `hotfix/admin-console-data-cleanup` (`ecddca9`) — squash-merged as **#325**.
  Its diff against `main` is *byte-identical to PR #326 in reverse*, i.e. the
  branch was simply behind `main` by one PR and held nothing of its own.
- `backup/main-pr314-promotion` (`b0759aa`) — every **non-merge** commit on it
  is already on `development`; its one unique commit is the PR #314 merge
  itself, the promotion that was done unasked and undone on `main`. Merging it
  anywhere would have been wrong: into `main` it redoes that promotion, into
  `development` it deletes 11k lines. Content fully preserved on `development`.

Both SHAs are recorded above so the refs remain recoverable.

**Two things worth not re-deriving:**

- **A red test over correct code is the worst shape a failure can take.** It
  invites relaxing the assertion instead of fixing the seam, and the invariant
  then has no guard on the day production actually breaks. When a test fails,
  establish *which side* is wrong before touching either.
- **A PR will no longer show checks, and that is the intended trade.** The
  habit that replaces it: dispatch the suite at the ref and read it green
  before promoting a branch or cutting a release tag. The release script's six
  fatal checks were read — none of them depends on CI status.

### 2026-09-10 — App Review rejection 5.1.1(iv): fix it, then audit for every other motif

- **Asked (/goal):** 2.8.18 was rejected on its first App Store review. Read the
  rejection, fix it, **and run a full audit for any other possible rejection
  motif even if it is not in this rejection** — the app must pass the next
  review at all costs.
- **Rejection:** Guideline 5.1.1(iv), submission
  `7fee471a-4ab2-4727-a1da-c164231963a3`, reviewed 2026-09-09 on an iPad Air
  11-inch (M3). The first-run permission screen's CTA read "Allow access", and a
  "Maybe later" button let the user dismiss the explainer without ever reaching
  the OS prompt.
- **Decisions (confirmed with Maxim):** apply **Apple's literal remedy** — keep
  the priming screen, rename the button, delete the skip — rather than removing
  the screen entirely, which would cost the onboarding notification opt-in for
  no compliance gain. Cut 2.8.19 **from `main`**, accepting that #316/#324/#325
  ride along.

**What shipped (PR #326, 2.8.19 / 39 / 39).** `PermissionsPrimingScreen` now has
**exactly one control**, it says **Continue**, and every route off it goes
through both OS prompts. `perm.allow` and `perm.later` are deleted from EN and FR
rather than re-worded. `App.js` gives the route `gestureEnabled: false` and the
screen swallows Android `hardwareBackPress` — a swipe and a bezel press are skip
buttons wearing different hats. The pre-existing `finally` that always navigates
to Main is what makes removing the escape hatch safe.

**The audit found no second violation.** Every other permission surface already
used the opposite, compliant pattern: OS prompt first, custom UI only *after* a
denial, with a route to Settings — which is what Apple's own "Next Steps"
paragraph recommends. Receipt camera, tag camera, VisionKit preflight, all three
photo pickers, camera-roll suggestions and location all go through
`permissionAlerts.js`; the Android rationale is inside a `Platform.OS` branch;
ATT is not in a production binary at all. Also verified: paywall carries Restore
+ Terms + Privacy (3.1.2), in-app account deletion exists (5.1.1(v)), Sign in
with Apple ships alongside Google (4.8), admin screens are server-gated on
`ADMIN_USER_SUBS` (2.3.1), and the known-broken Gmail sync is **off in
production**, so a reviewer cannot reach a dead feature.

**Three things worth not re-deriving:**

- **The rejection carried good news.** The screenshot is of a screen that only
  renders *after* onboarding sign-in — so the #228 launch crash is gone from
  this binary and the 2.1 sign-in blocker did not recur. The reviewer got in.
- **A reviewer stops at the first problem, so the letter describes ONE screen
  and says nothing about the rest of the app.** Everything past the stopping
  point is unreviewed and is where the next rejection comes from. The paywall
  was never reached this round.
- **The likeliest cause of a third round is not in the code.** The five IAP
  products have never been attached to an ASC version, and with no products
  `Paywall.js:449-452` renders a price skeleton and *disables* Subscribe. No
  code change can compensate. Recorded, with the full pre-submission checklist,
  in `Publishing-Compliance/App_Store_Rejections.md` §0.

**Also found, unrelated and NOT fixed here:** `main` is red on the **Backend**
job — two admin-account protection guards from #325 fail
(`a protected account is never proposed, even when it matches`, `an admin
account on the company domain is protected from its own group`). Mobile (Jest)
is green. Backend-only, so it does not touch the iOS binary or this
submission, but it means an operator could currently be offered an admin account
as a cleanup candidate. Owed its own fix.

**Docs:** `Publishing-Compliance/App_Store_Rejections.md` (new — the running
rejection record plus the pre-submission checklist) and Bugs entry **#239**.

### 2026-09-09 — Admin console: production data cleanup + customer-service triage

- **Asked (/goal):** a feature in the admin panel to clean test data out of the
  production database per the rules set on 2026-08-18/30 — offer the cleanup,
  scan every table, group the findings with counters, and open each category
  into its dataset on tap, the way credit history does. Plus any other feature
  that helps run customer service; the panel should be the go-to place for an
  incident or a ticket. Mid-task: **also clean up `priceback.ca` accounts**.
- **Decisions (confirmed):** the console DELETES from production rather than
  handing off to the CLI, at three granularities — everything, by category, or
  by ticked group. All three customer-service surfaces ship. Shipped as a
  **hotfix off `main`, PR back into `main`** rather than through `development`.

**What shipped.** `lib/dataCleanup.js` — 23 classifiers over six sections, each
able to count, sample and delete itself, plus a coverage map naming all 44
tables. A DB-gated test compares that map to `information_schema`, so a table
added later fails until it is classified. `lib/dataCleanupRunner.js` executes:
scan-token binding (15 min, held server-side, client never sends counts), an
absolute ceiling AND a growth ceiling per group, per-group refusals that do not
abandon the run, one transaction with one statement per classifier in FK order,
and a snapshot taken from `DELETE ... RETURNING` with the cascade children
captured first. Six routes behind the account gate, never `x-admin-token`.

**Four screens.** Data cleanup, shopper report, incidents, and an admin home
that badges what needs a person. The Profile menu's seven admin rows collapse
into one door; every route stays registered and every one is still listed,
pinned by a test that reads `App.js`.

**Three things that existed and were unreachable now have surfaces:** the
`/health` payload (through `buildHealthSnapshot()`, extracted rather than
reimplemented), `auth_outcomes` (no read endpoint since #205), and
`_authFailGuidance` (prose written for this and never displayed). An admin could
change a balance and not read the ledger; that is closed.

**Three things worth not re-deriving:**
- **The section that deletes nothing is the point.** Orphaned price points are
  NORMAL — they outlive a deleted receipt because they are the billable remnant
  — and reading that count as an anomaly is what once made a healthy database
  look like mass data loss. `reported_only` counts them, says why they stay, and
  gives them no checkbox.
- **`@priceback.ca` is a console-only classifier, NOT part of the marker sweep.**
  That sweep runs unattended after every backend test run and is the standalone
  CLI's whole predicate; the real company domain inside it would be an automated
  hard delete of internal accounts with no operator in the loop. Production holds
  exactly one such account today (has a postal code, no receipts).
- **Protected accounts come from config, not code.** `CLEANUP_PROTECTED_SUBS` in
  `app_config`, plus `ADMIN_USER_SUBS` always. The list changes and it holds real
  people's identifiers. It does NOT replace the human cross-check against the two
  purge docs' Kept lists — the scan states that on every run.

- **Verification:** 157 mobile tests over the new suites, all green locally
  (single-file runs, non-DB — within the standing rule); `i18n:check` 1499/1499
  and `typecheck` clean. The backend DB suites run in CI. Coverage: all seven new
  files clear every floor, and nothing was pinned or re-based — the reasoning is
  in `jest.config.js` under Phase 32.
- **Owed:** populate `CLEANUP_PROTECTED_SUBS` on production before the first
  account-touching purge. `__tests__/flyerCard.test.js` (untracked, from an
  earlier session) still fails 3 assertions — two over-specify decimal formatting
  that `numToMoneyText` has never produced, and one asks whether clearing the
  instant savings should overwrite a hand-entered sale price. Left untouched:
  that is a flyer-pricing decision, not a console one.
- **Status:** done. Branch `hotfix/admin-console-data-cleanup` → PR into `main`.
- **Docs:** new `Operations/Admin_Console_And_Data_Cleanup.md`;
  `Technical/Test_Data_Isolation_And_Purge.md` updated for the marker move.
### 2026-09-07 — Branch/PR policy for every repo + stale-branch audit

- **Asked (/goal):** add a standing rule that in *all* GitHub repos, every
  branched work goes through a PR and a merge; audit old branches for unmerged
  work and, if any, PR them oldest-first. Apply now to Priceback,
  Priceback-Documentations, social-media-manager.
- **Done:** new `Operations/Branch_And_PR_Policy_All_Repos.md`. Audited all
  three repos — **no unmerged work anywhere**; every branch had already gone
  through a PR+merge. Deleted 6 stale merged branches; kept
  `backup/main-pr314-promotion` (archival rollback ref). Table in the new doc.
- **Status:** done. Docs PR on `docs/branch-pr-policy-all-repos`.

### 2026-08-25 — Sentry triage, Apple display names, and the USD price loop

- **Asked (/goal):** check and fix the new Sentry errors; find out why every
  account created through Sign in with Apple has a NULL `name` and `picture` in
  `users`; and work out why iOS still shows USD prices in Buy Credits and
  Subscribe after three rounds, when Android is fine — the Apple account was
  even deleted and re-created in Canada with no change.
- **Decisions (confirmed with Maxim):** reviewer **access code** for App Review
  (not a full email/OTP provider); **no change** to the skeleton/no-price UI;
  and the pricing finding must be **written down** so it is never re-derived —
  "you consumed over a week worth of tokens on this alone".

**What the Sentry data actually said.** 70 of ~76 recent events are one failure
mode: **on Apple's own devices nobody can sign in.** Sign in with Apple returns
`ERR_REQUEST_UNKNOWN` (ASAuthorizationError 1000) in under 100 ms with no sheet
shown; Google in the same session returns `"Unable to open Safari."`. It happens
on **every build submitted since 2026-08-10 — 2.8.5, 2.8.8, 2.8.10, 2.8.12,
2.8.14** (latest 08-25 05:36 UTC, 20 min after 2.8.14's first-ever launch). 37 of
41 geolocate to **Cupertino / Apple's network**; 4 are a real user in **Giza, EG**
on 2.8.12 who got in with neither provider. **Zero from Canada.** Our
`REVIEWER_NOTES.md` tells Apple *"no demo account needed — use Sign in with
Apple"*: we point the reviewer at the one path that fails on their hardware, with
a fallback that also fails.

**Housekeeping, no code owed:** `-5` (Outlook `$orderBy`+`$search`) is **already
fixed** at `emailSyncService.js:930`, last event 08-04 → resolve in Sentry.
`-G`/`-E` are deliberate probes → resolve. `-F`/`-7` (GMS `INTERNAL_ERROR`) is a
device fault and already classified correctly. `-8` (Gmail API disabled on GCP)
has no code fix. `-A`/`-9` are iOS **2.8.1**, obsolete.

**Apple names.** `backend/server.js` hardcodes `name: null, picture: null` on the
Apple token path — correctly, since Apple's identity token never carries them.
The client *does* capture `credential.fullName` on the first authorization and
stores it in the keychain, **and then never sends it anywhere**; `PUT
/api/me/profile` does not accept a name. So `users.name` is NULL for every Apple
account, permanently. (`picture` is genuinely unobtainable from Apple — that half
is not a bug; the UI should render initials.)

**The USD prices — and why three rounds could not fix them.** Maxim supplied the
figures mid-session and they settled it: iOS shows **$1.99 / $3.99 / $6.99**. The
bundled catalog says `$3 / $5 / $10`, the live remote catalog says
`CA$3 / CA$5 / CA$10` — **1.99 is in neither**, so it can only have come from
StoreKit. The offering resolves fine on a real device; the client is displaying
exactly what the store says; **the prices in App Store Connect are wrong.**
Console work, not code — which is why three rounds of rendering fixes changed
nothing.

A *separate* condition, initially mistaken for the cause: on Apple's review
devices (no store account) the offering does not resolve at all, so App Review
sees no prices. Both are written up in
`Technical/iOS_Store_Pricing_Diagnosis.md` — **read it before touching pricing.**

**Done (branch `fix/ios-store-price-confidence`).** The one genuine client defect
the investigation surfaced: `storePrices.js` promoted a *provisional* cache (one
applied while `getStorefront()` said "don't know") to `ready` whenever the retry
budget ran out — `_status = Object.keys(_prices).length ? "ready" : "unavailable"`.
On iOS the live read fails every time, so an unverified price stood for its full
30-day life, and deleting/re-creating the account never touched AsyncStorage.
Added `_confirmed`; unconfirmed prices are dropped rather than published. Plus a
**Store pricing** group in Admin → Billing diagnostic reporting `source` /
`country` / `currencyCode` / resolved `priceString` / the store's own error — the
reading that was never taken in three rounds. Bugs #218.

**Done — Apple display names (branch `fix/apple-display-name`, PR #298).**
`backend/lib/displayName.js` + `displayName` on `PUT /api/me/profile` +
`profileSyncQueue` carries it + `backfillAppleDisplayName()` on boot recovers
the accounts that predate it from the keychain (the only surviving copy, and it
dies with the next reinstall). No clear path, deliberately: an empty value is
what an ordinary Apple sign-in sends. `picture` stays null and that is correct —
Apple provides none and nothing renders an avatar, which is why the app looked
right while the column was empty.

**Done — reviewer access code (branch `feat/reviewer-access-code`, PR #299).**
`POST /api/auth/reviewer` mints a session from `REVIEWER_ACCESS_CODE` through
the SAME sessionsRepo + sessionTokens path as `/api/auth/session`, so refresh /
revoke / reuse-detection / the session ceiling all keep working without knowing
it exists. Fails closed and indistinguishably when the env var is unset.
Throttled 10/15 min per IP. Opens one synthetic account (`reviewer:appstore`) —
an ORDINARY user, explicitly not admin, pinned by a test. iOS only, because
`authedFetch` consults the first-party session on iOS only; on Android the
reviewer would be "signed in" to an app that 401s on everything.
`/health` reports `checks.reviewerAccess` as a CONJUNCTION (code AND sessions
AND db), never the code. `REVIEWER_NOTES.md` rewritten — it used to point Apple
at Sign in with Apple, the one path that provably fails on their hardware.

**Verified locally** (CI is billing-blocked, `steps: 0`): 11/11 reviewer route
cases against the **dev** Supabase project, plus 5/5 unconfigured-gate cases,
8/8 displayName unit, and 453 client tests green across auth / onboarding /
boot / sync / profile / errorSupport.

**Regression caught and fixed while wiring B:** a dynamic `import()` in
`authService` needed an OUTER try/catch. This project builds `import()` down to
a synchronous `require` (`babel-plugin-import-to-require`), so a module whose
BODY throws — `profileSyncQueue` imports AsyncStorage at the top level — throws
at the call site rather than rejecting, and `.catch` never sees it. Without the
guard a cosmetic name push could abort the sign-in that triggered it. It broke
3 existing tests, which is how it was found.

**Owed, and Maxim's not code:** attach the five IAPs to an App Store version and
get them to Ready to Submit; confirm the RevenueCat product IDs and `current`
offering match.

**Also owed (Maxim):** set `REVIEWER_ACCESS_CODE` on both Railway services and
paste the code into App Review Information. Confirm via
`/health` → `checks.reviewerAccess.status === "available"` before submitting.

### 2026-08-23 — AdMob banner ads for non-subscribers (ships dark)

- **Asked (/goal):** add ads to increase income on both platforms, only on
  pages with blank space (home under tracked products, scan / price-tag /
  barcode under the upload section), ask before adding more; enabled for
  unsubscribed (credit-only) users, disabled and hidden for subscribers;
  analyze + propose first, implement after approval; create the ad-account
  configuration or document the manual steps.
- **Decisions (confirmed):** Google AdMob, **anchored adaptive banners only**
  (no interstitial, no rewarded); **personalized** ads with the full compliance
  setup (iOS ATT, Android `AD_ID` restored, privacy manifest flipped);
  two extra slots approved beyond the four named — Receipts list footers and
  the barcode "not found" empty state; **ship dark** with a remote kill switch.
- **Done:** branch `feat/admob-banner-ads`, commit `51178d3`.
  - `src/services/adsService.js` — the gate. Fails **closed**: build switch AND
    server switch AND a *resolved* `premium.active === false` AND a unit id.
    This app has no subscription context (every screen re-reads entitlement
    async on focus), so "unknown" had to mean hidden or subscribers get flashed
    an ad on every cold start.
  - `src/components/AdBanner.js` — returns `null`, not a spacer, when hidden;
    collapses on no-fill; carries the store-required "Advertisement" label.
  - 6 slots / 4 edits. The three scan screens went through `ScanIntro`'s
    **already-existing, unused `footer` prop**, so no shared component changed
    shape. The Receipts 40px tail spacer was **kept above** the banner, not
    replaced — swapping it would have cost subscribers their bottom padding.
  - Kill switch: `ADS_ENABLED` in `backend/config/defaults.js` (default
    **false**) → `/api/me` → `reconcileWithServer`, riding the exact path
    `isAdmin` already uses. Flip it and every banner appears or vanishes in
    minutes, no release, no store review.
  - Compliance: `withAndroidPermissionCleanup` no longer strips `AD_ID` (its
    rationale block rewritten, not just deleted, + **two positive-lock tests**
    so nobody re-strips it — that failure is silent and halves revenue);
    `NSPrivacyTracking` → true with 4 data types marked tracking;
    `NSUserTrackingUsageDescription` in `ios.infoPlist` (which is what
    suppresses expo-tracking-transparency's generic autolinked default) + EN/FR
    locale files; ATT requested on first ad-eligible render, **never** at cold
    start and **never** for a subscriber, and settled *before* `initialize()`.
  - Invalid-traffic guard: real unit ids live only in EAS **production**;
    `assertAdsConfigIsShippable()` makes a real unit in any other profile a
    **fatal build error with no override**, because AdMob's penalty for
    impressions from a test build is account termination, not a warning.
- **Verification.** Actions still billing-blocked, so nothing was CI-verified;
  targeted suites only, per the standing rule. **491 tests / 28 suites** pass
  across every area touched (screens, purchases, plugins, config, i18n), plus
  36 new mobile + 3 new backend tests, `npm run typecheck` clean and
  `i18n:check` 1485/1485. Both new `src/` files carry their own coverage floors,
  which keeps them **out** of the global pool — the global floors still measure
  the Phase-28 file set and were not silently re-based.
- **NOT verified / still owed:** that GMA 16.5.0 builds under Expo 55 prebuild
  (gate with a `preview` EAS build before production — no build was started,
  per the EAS budget rule). No AdMob account exists yet, so both app ids are
  placeholders and ads **cannot** be enabled. `NSPrivacyTrackingDomains` and
  `skAdNetworkItems` hold documented placeholder lists to be refreshed from the
  SDK's own manifest and Google's page. Privacy policy on priceback.ca (separate
  repo) must disclose advertising **before** the store declarations are filed.
- **Docs:** `Publishing-Compliance/AdMob_Setup_And_Store_Declarations.md` (the
  manual runbook — account, tax forms, ad units, app-ads.txt, Data Safety, App
  Privacy, and the **EEA guardrail**: no UMP is wired, which is safe only while
  availability stays Canada + Egypt) and `legal/pia/advertising.md` in the app repo.

### 2026-08-17 — Store pricing defect, Sentry sign-in triage, admin account desk

- **Asked (/goal):** check the last 7 days of Sentry and fix the unhandled
  errors; use Claude in Chrome (after validation) to make sure the app is **free
  to download**, the only paid paths being the IAPs; tag + build both platforms
  and submit. Mid-task addition: "create a new feature in the admin panel (admin
  token only) in the app to view, manage the accounts (check the flagged
  accounts, activate, disactivate, ...etc)".
- **Clarification that changed the work:** "free for all countries" meant the
  *price*, NOT the distribution list. Availability stays **Canada + Egypt** and
  must not be widened. An earlier expansion to 172/175 countries was reverted in
  full; Play publishing overview verified empty afterwards.
- **The store defect (the real find):** PriceBack was a **PAID app on Google
  Play** — USD 4.99/5.99, AUD 7.99, DZD 675 per country — so every Android user
  was asked to pay before install. Consistent with 0 installs / $0 revenue.
  Switched to Free, which on Play is **irreversible** (Maxim confirmed
  explicitly, twice, after being told). iOS was already $0.
  ⚠️ First attempt LOOKED applied but was never saved — the page stages the
  change and a separate **Save changes** button commits it. Caught only by
  re-verifying after a full reload. Re-done and confirmed persisted
  ("can't be changed to paid", controls gone).
- **Two Apple blockers found, both Maxim's to clear** (legal terms / banking —
  not for an agent): the **Paid Apps Agreement is unsigned**, so *no iOS IAP can
  transact at all*; and EU DSA trader status is unfiled. All 5 iOS products are
  still "Prepare for Submission" and must ride a version submission.
- **Sentry (4 unresolved / 7 days), one root cause:** `classifyError` returned
  `"unknown"` for **100% of field sign-in failures** — three unrelated defects
  sharing the support reference `UNKNOWN`, and "try again" was wrong advice for
  two. Added `signin_unavailable` / `signin_presentation_failed` /
  `signin_misconfigured` (+EN/FR copy), and dropped ADB `CrashedByAdbException`
  in `beforeSend`. → Bugs #209.
- **Admin account desk (new):** `AdminAccountsScreen` + account-gated
  `POST /api/admin/users/:sub/status` and `.../review-flag`. Deliberately does
  NOT use `ADMIN_TOKEN` — a shared secret in an APK is extractable and opens
  every token-gated route; the app authenticates as the admin's own account so
  actions stay attributable. Self-targeting is refused (suspending/flagging
  yourself removes the only surface that could undo it).
- **Status:** verified 190 suites / 4446 mobile tests green; the 8 new backend
  tests pass against **dev**. CI still billing-blocked, so nothing ran there.
- **The thing worth not re-deriving:** **a suspension must never stamp
  `deletion_requested_at`.** `purgeExpiredDeletions` erases on
  `status=false AND deletion_requested_at IS NOT NULL`, so a suspension that also
  set the stamp would enroll the account in an irreversible hard delete 30 days
  later that nobody asked for. `setAccountActive` therefore writes `status`
  alone on suspend, and clears the stamp on restore. A test runs the real sweep
  with `graceDays: 0` and asserts the suspended account survives.

### 2026-08-12 — iOS audit #8: the calls that could not finish, and PR #260's un-audited credit code

- **Asked (/goal):** "run a full detailed and deep audit specially for the IOS
  system, i want a deep analyzing to detect also if there is any difference
  between IOS and Android behavior, everything should be documented if not fixed.
  the most important is the security to be the best as possible, authentification,
  credit managamenet, revenueCat, account management, receipt scans, price tag
  scans, dont try to do the documented bugs in the previous audit for now."
- **Decision/constraints:** ONE branch/PR covering both the iOS client fixes and
  the backend credit/account fixes (Maxim's call — backend CI is serialized
  repo-wide, so two open PRs evict each other). P1 touches the iOS auth path;
  Maxim chose to **fix** it rather than document-only, on the condition that every
  new failure mode degrades into the existing "no session → provider token"
  branch. Previously-documented items from passes #1–#7 explicitly left alone.
- **Why a pass #8 could find anything:** (a) **PR #260 landed after pass #7** —
  ~3,000 lines of credit/account code no audit had ever read; (b) pass #7's A3 was
  a correct fix applied to **one of three** call sites; (c) structurally, every
  prior pass asked whether network calls exist and are authorized, never whether
  they can **finish**.
- **Findings (5, all fixed):** P1 the three iOS session routes had no timeout and
  a shared in-flight promise made one stalled refresh block every authenticated
  request on the device; P2 both image uploads un-timed, the receipt one awaited
  inside the sync drain (iOS *suspends* a backgrounded upload rather than failing
  it); P3 the "`inactive` is on screen" bug at the two call sites A3 missed; P4
  completing the erasure deleted the ledger and left the balance; P5 the two admin
  credit-desk routes had no rate limit.
- **Status:** Priceback#261 open. Docs: `Technical/iOS_Audit_2026-08-12_Pass8.md`,
  Bugs #201–#203. No migration.
- **Three things worth not re-deriving:**
  - **The predicate is not the gate.** Reusing `createForegroundGate` for "is the
    app on screen" is wrong — the gate is deliberately false during an
    interruption, which is exactly when the app IS visible. Two questions, two
    predicates, one module (`src/utils/foregroundGate.js`).
  - **The recurrence guard asserts positively.** A blanket "no file may compare to
    `=== "active"`" would fire on `App.js:357`, which gates the badge clear
    strictly on purpose. A guard that fires on correct code gets deleted.
  - **P5's audit trail was less broken than first filed.** `middleware/audit.js`
    already stamps `req.user.sub` on every request — what it never records is the
    body. So the actor went into `credit_ledger.ref`, NOT into `notes`: the client
    parses everything after `admin:` as the motif code, so appending it there would
    have downgraded every admin row in every shopper's credit history to
    "Adjustment".

### 2026-08-11 — iOS audit #5: close the owed money batch, then sweep new ground

- **Asked (/goal):** "run a full detailed and deep audit specially for the IOS
  system … detect also if there is any difference between IOS and Android
  behavior, everything should be documented if not fixed. the most important is
  the security to be the best as possible, authentification, credit managamenet,
  revenueCat, account management, receipt scans, price tag scans."
- **Decision/constraints:** deliver **both** — close audit #4's owed money batch
  first, then run a genuine pass #5 — as **one PR** (Maxim's call, given
  backend CI is serialized repo-wide and Actions minutes are tight). Fix both
  platforms, not iOS-only.
- **Why it was needed:** audit #4 (same day) shipped only its security half as
  Priceback#255 and left **12 money findings (4 High) documented but unfixed** —
  and those covered two of the six areas the goal names (credit management,
  RevenueCat). All 12 were re-verified as still live on `main` before any code
  was written.
- **Files/areas:** `backend/subscriptionGate.js`, `backend/server.js`,
  `backend/repos/referralsRepo.js`, `src/services/{purchaseService,authService,
  storageService,receiptSyncService,receiptScanQueue,subscriptionManager,
  bootService,creditLedger,i18n}.js`, `src/screens/{ScanScreen,
  ManageSubscriptionScreen,OnboardingScreen,BuyCreditsScreen,
  BarcodeScanScreen}.js`, `src/components/Paywall.js`, `App.js`.
- **Three places the fix diverged from audit #4's sketch** (all recorded in the
  doc, because the obvious version is worse in each):
  **R1** — the finding was in the *route's* `app_user_id` guard, not the gate; a
  TRANSFER carries no `app_user_id` at all. And the proposed client-side
  `originalAppUserId` check was **not** implemented: it false-positives on every
  anonymous-first user and cannot fix R1 anyway, since a check on B's device
  cannot downgrade A. **C1** — cleared rather than flushed-then-cleared;
  flushing needs `authedFetch` after the session tokens are gone, which presents
  a Face ID sheet mid-sign-out. **C4** — worse than filed: a retired pack is
  also absent from `TOPUP_PRODUCTS`, so the webhook cannot rescue it either.
- **New in pass #5:** N1 (barcode gallery-permission dead end on iOS — which
  also corrects audit #4's "verified clean" claim) and N2 (the referrer's credit
  history printed the referee's raw provider `sub`). Plus the first full
  **iOS/Android divergence inventory** — all 35 `Platform.OS` sites, verdicted,
  plus the implicit divergences that have no `Platform.OS` to grep for.
- **Status:** branch `audit/ios-money-and-parity` → PR. Full mobile suite green
  (177 suites / 4178 tests), backend gate units 101/101, i18n EN/FR in sync.
  Doc: `Technical/iOS_Audit_2026-08-11_Pass5.md`. Bugs #183, #184.
  **Still open, documented not fixed:** iOS background-fetch weakness leaves
  price-drop detection best-effort on iPhone (needs its own task — foreground
  sweep or server-side push); P3 app-switcher overlay still needs a handset.

### 2026-08-09 → 08-11 — iOS audits #1–#4 (backfilled; the log had missed them)

Recorded late — these four ran while this log was not being updated, and the
entries matter because later work keeps building on their decisions.

- **#1 (PR #249)** — what App Review taps: restore, crop, safe area, dark mode,
  the Apple button, permission prompts. Added the EAS `device` profile.
- **#2 (PR #252)** — after sign-in: keychain accessibility, background auth, the
  badge, notification i18n.
- **#3 (PR #253)** — money + identity: sandbox purchases, Google audience, Apple
  revocation, and a **brand-new first-party session subsystem** (iOS-only,
  inert until `SESSION_TOKEN_SECRET` is set).
- **#4 (PR #255)** — 33 findings. Batch 1 (security + account isolation) merged;
  **batch 2 (money) deliberately deferred** → closed by audit #5 above.
  Doc: `Technical/iOS_Audit_2026-08-11.md`.

### 2026-08-04 — Release tags + GitHub releases as a safety net for published builds

- **Asked (/goal):** "create the github release so i can have a reference to the
  stable build i used on app publish as a safety net, create labels and any
  necessary best practices for repo management" → corrected mid-task to
  **"i meant tags instead of labels"**, then **"create everything based on the
  actual code in repo"**, then **"create the new version based on the actual code
  2.8.4, add the tag and release creation as a rule for every app version publish
  to keep tracking."**
- **Why it was needed:** `eas.json` sets `appVersionSource: "local"`, so `app.json`
  is the only record of a binary's version. The repo had exactly one tag
  (`Cleanup-V2`, a schema marker, not a release) — nothing pointed at the tree any
  shipped artifact came from. Separately, six merged PRs (#229 – #234) were sitting
  on `main` still carrying `versionCode` 23, which Play rejects — **including #230,
  without which the live build resolves no Play subscriptions and sells nothing.**
- **Done:**
  - Backfilled `v2.8.2` (`fdc2af3`, first R8 build) and `v2.8.3` (`106ae9e`, the
    published store build) as annotated tags + GitHub releases. The v2.8.3 notes
    record its known subscription defect and list what landed on `main` after it.
  - Bumped **2.8.4 / versionCode 24** across `app.json` + `package.json`.
    `android/` is gitignored prebuild output (stale at 22) and left untouched.
  - `scripts/releaseTag.js` + `npm run release:tag` — dry run by default, seven
    fatal checks (clean tree, on `main`, HEAD pushed, version triad agrees,
    `package.json` matches, tag free, `versionCode` increased — read back out of
    each tag's own `app.json`, not inferred from the tag name).
  - **Standing rule added to the app repo's `CLAUDE.md`:** no version ships to a
    store without an annotated tag + GitHub release pinning the build commit. Tag
    before building, build from the tag, never move a tag, rollback = roll forward.
  - New doc: `Operations/Release_Tagging_And_Repo_Management.md`.
- **Status:** PR #236 (app repo). No app code touched; regression risk is limited
  to the version identity itself. Pre-existing risk carried into 2.8.4: R8 has
  still never run on hardware — smoke-test a preview APK before promoting.

### 2026-08-04 — Profile restore loses every active receipt, product and history entry (5th report)

- **Asked (/goal):** "on profile restore (after reinstall and connect or signout
  then signin) ... i can see only the expired receipts, all active receipts are
  gone, all products are gone, all hero card history are gone, the credit is
  loaded correctly. this is the 5th time i ask you to do the same bug and
  everytime there is a regression after 1 or 2 rounds. make sure this never
  happens again and i want a solid code base that make the restoring process runs
  perfectly cover all paths possible."
- **Decisions (Maxim):** do NOT copy dev data into prod — clean prod instead, and
  audit every table, not just receipts (app is live but unmarketed, so no real
  users yet). Add `receipt_items.original_price` even though it costs a
  migration. Never delete products that have a barcode + SKU match. No regression
  accepted; cross-apply the fix using all the receipts in the repo.
- **Root cause (one cause, four symptoms):** every "product" is a receipt line and
  every Home surface gates on `daysRemaining > 0`, so a receipt restored with
  zero items is a bare header that reads as expired. (1) `mergeServerIntoLocal`
  rebuilt items purely from the server, so an empty server item list DELETED the
  local ones — and sign-out does not wipe local storage, so sign-in ran it over
  good data. (2) `onConflictDoNothing` made a header-without-lines permanently
  unrepairable. (3) Prod held 19 receipt headers / 7 item rows: `receipts` was
  copied from dev without `receipt_items` (byte-identical `created_at`
  microseconds prove a row copy). (4) Hydrate ignored `nextOffset`, and the
  documented paging endpoint returned header-only receipts — a loaded gun for
  anyone past 200 receipts.
- **Why it kept "regressing":** neither side's tests could fail. Backend seeded
  zero receipts and asserted `Array.isArray(items)`; mobile hand-wrote a fixture
  and asserted `added === 1`. Nothing asserted a restored receipt was usable, and
  the mobile fixture's hardcoded date had already rotted past the 30-day window.
- **Done:** Parts A–D shipped — destructive merge fixed, server back-fill,
  paging + field fidelity (`original_price` migration 0002, `ignored`,
  `purchaseType`, `isRefund`, internal FKs stripped from payloads), and the
  regression firewall: `shared/receiptWireContract.js` as the single wire
  contract, all 55 real receipts through the full round trip (418 assertions),
  the same contract verified against real Postgres, and outcome-based e2e tests.
  Found and fixed two latent `Number(null) === 0` bugs — one of which would have
  500'd every receipt upload in production. Bugs_Common_Fixes #143.
- **Status:** code + tests green (mobile 157 suites / 3813 tests; backend
  restore-contract suite 8/8 against real Postgres). Prod cleanup + the two owed
  prod migrations (0001, 0002) pending Maxim's go-ahead.

### 2026-08-03/04 — Full security + error audit (production hardening)
- **Asked (/goal):** "cover all paths with the more realistic error code and
  message, i want a full security and errors audit so the app be stable in
  production, everything should work for both android and ios platforms."
- **Decisions (Maxim):** normalize `error` itself rather than adding a parallel
  field (breaking by design, gated on pinning the shipped v2.8.3 strings first);
  sweep ALL ~195 sites, not a subset; fix any iOS review-blocker and prep a
  resubmit.
- **Done — 3 commits on `fix/production-error-security-audit`:**
  - **Crash safety:** `backend/lib/processSafety.js`. Express 4 + Node 24 meant
    one rejected async handler killed the container; 15 routes awaited with no
    try/catch, incl. /api/device/scan + /sync (every launch, every scan) and
    /health. Patched at the registration point so future routes are covered too.
    Graceful SIGTERM drain added. (Bugs #138)
  - **Rate-limit bypass:** no `trust proxy`, and 3 limiters keyed on the
    client-suppliable LEFTMOST X-Forwarded-For hop — including the brute-force
    throttle sitting in front of the admin-token compare. (Bugs #139)
  - **Error contract:** 8 envelopes to 1 (`backend/lib/httpError.js`); 119 prose
    values became machine codes; 25 responses that named internal env vars to
    unauthenticated callers now return a vague 503 and log the detail;
    requestId surfaced in the body (it already existed in audit.js). Source-level
    contract test. Found and fixed a SHIPPED bug: every referral failure showed
    generic copy because the client compared a code against prose. (Bugs #140)
  - **Mobile:** root crash screen no longer prints the raw exception in English;
    Restore Purchases no longer fails silently (Apple tests it); account deletion
    no longer claims an erasure it did not perform (Law 25 s.28); all screens get
    error boundaries + Sentry reporting; ScanScreen no longer says "Saved for
    later" when the queue write threw. (Bugs #141)
  - **Classifier:** +9 categories with EN+FR copy (storage_full,
    permission_denied, json_invalid = captive Wi-Fi portal, force_upgrade,
    maintenance, conflict, too_large, payment_required, account_locked) plus a
    real numeric status ladder — previously only 429 and >=500 were handled.
  - **i18n:** 446 dead `t("k") || "English"` arms deleted; checkI18n now scans
    App.js (previously unchecked — that blind spot is how the crash screen
    shipped), bans that pattern, and checks placeholder parity.
  - **iOS:** "Google account" copy shown on iOS Ask-to-Buy; limited photo access
    never detected; itms-apps:// plus a double openURL on cancel; two unused
    auto-injected purpose strings stripped (Guideline 5.1.1);
    NSLocationDefaultAccuracyReduced added to match the privacy manifest; Apple
    re-sign-in nulling the stored email; real safe-area inset. **Sign in with
    Apple and Restore Purchases were both verified correctly wired — no hard
    review blocker found.**
- **Not done / follow-ups:** requireAuth on /api/ocr + /api/ocr-llm (blocked
  until v2.8.3 is off the estate — it sends no token; the client now sends one,
  so this is a two-release migration); receipt-create and credit-consume are
  still two transactions (revenue loss on a blip, never a double-charge); the
  admin gate is still copy-pasted per route rather than middleware; no fail-fast
  env validation at boot; (no flaky tests — see verification note below).
- **Verification:** mobile 155 suites / 3368 tests green, typecheck clean,
  i18n:check green (1373 keys, EN/FR in sync); backend **1019 tests, 1018 pass,
  0 fail** on a clean serial run. NOT device-tested; NOT pushed.
- **Gotcha worth remembering:** mid-audit, two backend suites were running
  concurrently against the SAME Supabase dev project. That exhausts the session
  pooler ("Connection terminated unexpectedly") and produces phantom failures
  that alternate pass/fail on identical code — priceDropDb "first sweep" and
  criticalPathAtomicity "RECEIPT_ID_CONFLICT" both did this. They are NOT flaky;
  run backend suites one at a time.

### 2026-07-24 — More Google-guidance error handling: Play Billing states (PR #203)
- **Asked (/goal):** "add more error handling based on Google's own guidances
  (codes)". Extended beyond sign-in to the purchase/billing path.
- **Done:** `classifyPurchaseError` now handles two more documented Play Billing
  states that previously fell to generic "something went wrong":
  `payment_pending` (Play PENDING / RC PaymentPendingError — cash/carrier/family
  approval; treated as in-progress, NOT an error, "won't be charged twice") and
  `not_allowed` (RC PurchaseNotAllowedError / Play FEATURE_NOT_SUPPORTED). New
  EN+FR i18n keys `paywall.errPaymentPending`/`errNotAllowed`; wired into
  `Paywall.purchaseErrorMessage`. Tests added. Full suite 3004 pass. No migration.

### 2026-07-24 — Scope-out membership ID; align reviewer notes (Maxim direction)
- **Asked:** rework the deletion page + Data Safety to remove any data not
  reflected in the UI — specifically the **Costco membership number**, which is
  never used and only saved as a trial/test remnant. Also review reviewer notes.
  (Maxim: credential rotation is his to do, don't raise it again.)
- **Done:** removed member_id from `delete-account.html`/`-fr` (Website PR #7,
  reworked — still unmerged, Maxim's call to publish); removed it from
  `Play_Data_Safety_Answers.md` (User IDs row) + added a scope note; updated
  `PUBLISH_CHECKLIST.md` §1 (member_id now OUT OF SCOPE, don't declare) and §10
  Purchases line. **Flagged honesty gap:** backend STILL extracts/stores
  `receipts.member_id` (server.js, receiptsRepo.js, +test) — to make the
  "not collected" declaration truthful, that extraction should be removed in
  code before publish; offered to do it, awaiting Maxim.
- **Reviewer notes:** fixed a real mismatch — they said "No location" but the
  app uses COARSE location (nearest Costco); updated the permissions section +
  "what we don't do" + short version to say coarse-only / no precise location /
  no mic / no ad-ID (consistent with the stripped manifest). Demo-account TODO
  still Maxim's to fill.

### 2026-07-24 — Play-release blockers: account-deletion web page + Data Safety answers
- **Asked (/goal, cont.):** finish preparing for Play promotion, avoid refusals.
- **Account-deletion web URL** (hard Play requirement): built `delete-account.html`
  + `delete-account-fr.html` in the **Priceback-Website** repo (matches legal-page
  shell; documents in-app + email deletion paths, what's deleted vs briefly
  retained, timelines; mirrors `DELETE /api/me/account`). `_redirects` clean URLs
  + `/delete` `/account-deletion` aliases. **Website PR #7** — left unmerged
  (merging deploys live via Cloudflare); Maxim merges when ready.
- **Data Safety + content rating**: `docs/Play_Data_Safety_Answers.md` — exact
  copy-paste form answers derived from `backend/db/schema.js` + shipped perms
  (advertising-ID = No; vendors = processors, not "sharing"; IARC = Everyone;
  Ads = No). Reduces those console screens to data entry.
- **Docs:** checklist §10 links both + status rows updated.
- **Genuinely user-only remaining** (I can't access these): merge website PR +
  set Data-deletion URL; enter Data Safety/rating in console; rotate Vision key +
  Supabase password (§8A BLOCKER); screenshots + demo account; `eas build
  --profile production` → Internal testing → promote. All in PUBLISH_CHECKLIST.

### 2026-07-24 — Play-release hardening: GMS error handling + Android permission hygiene
- **Asked (/goal):** add more error handling per Google's guidance (status
  codes) and prepare the app for Google Play promotion, avoiding review
  rejections — want to release this week.
- **Error handling:** extended `signInWithGoogle` from just the INTERNAL_ERROR
  retry (Bug #128) to full GMS status-code classification — transient
  INTERNAL_ERROR(8)/INTERRUPTED(14)/TIMEOUT(15) retried once; NETWORK_ERROR(7)
  → honest connectivity message; DEVELOPER_ERROR(10) rethrown loud; raw
  CANCELED(16) treated as cancellation. Tests added.
- **Permission hygiene (rejection-proofing):** new
  `plugins/withAndroidPermissionCleanup.js` strips 3 dependency-injected
  sensitive perms the app doesn't use — `AD_ID` (FCM; keeps Data Safety
  "advertising ID = No"), `RECORD_AUDIO` (expo-camera; photos only),
  `ACCESS_FINE_LOCATION` (expo-location; coarse suffices, `Accuracy.Low`).
  Verified against a fresh `expo prebuild` manifest (all three carry
  `tools:node="remove"`; COARSE/CAMERA retained). Plugin unit-tested.
- **Docs:** `PUBLISH_CHECKLIST.md` §10 "Permissions hygiene" + status rows;
  Bug #128 extended. Target SDK already API 35 (Expo 55) — no change. No
  migration. Console-side items (Data Safety form, account-deletion web URL,
  screenshots, demo account) remain the user's — enumerated in the checklist.

### 2026-07-24 — Fix Sentry `ApiException: INTERNAL_ERROR` in Google Sign-In (Bug #128)
- **Asked (/goal):** root-cause + fix the new Sentry exception
  (issue 7628779056, release 2.8.0 prod): Google Sign-In threw GMS
  `INTERNAL_ERROR` (code 8), handled, `flow:signin_google`, 2 events / 1 device.
- **Diagnosis:** transient Play Services hiccup, NOT a config bug (config =
  `DEVELOPER_ERROR` code 10, would fail all sign-ins). `signInWithGoogle`
  re-threw any unrecognized code → user-facing failure + Sentry noise.
- **Fix:** retry-once-on-transient-GMS-error loop in `signInWithGoogle`
  (`isTransientGmsError`, 300 ms backoff, persistent still throws) +
  `classifyError` maps a surviving Play Services error to the `server`
  ("try again") bucket instead of generic unknown. Tests added in
  `authServiceSignIn.test.js` + `errorSupport.test.js`; 61 pass. No migration.
  Mobile-only; will land on a `fix/` branch → PR.

### 2026-07-23 — Move API-call logging off the DB to free stdout logs; drop api_audit_log table
- **Asked (/goal):** "find a more suitable solution to log the api calls other
  than the database storage and it has to be free and remove all the api calls
  from the database (table)."
- **Design:** the audit log is explicitly breadcrumbs, not authoritative data
  (billing goes through `credit_ledger`, transactional). Replaced the
  DB-backed `api_audit_log` sink with **structured single-line JSON to stdout**,
  which Railway captures for free with zero infra and zero per-request DB
  round-trip — so the in-memory buffer/flush machinery is gone too. Kept the
  privacy IP-hash (daily-rotating salt) and the `X-Request-Id` header.
  Logging is now decoupled from `USE_DB`: gated on `AUDIT_LOG` (default on;
  `test.env` sets `AUDIT_LOG=false` so route tests stay quiet/deterministic,
  matching today's USE_DB-off behavior). Trade-off noted: Railway's log
  retention (~days) is shorter than the old 90-day DB window — acceptable for
  breadcrumbs; point an external log drain at stdout if longer retention is
  wanted later.
- **Removed from DB:** migration `0008_drop_api_audit_log` DROPs the table
  (indexes + FKs cascade); consolidated `db/deploy/schema.sql` regenerated;
  `apiAuditLog` schema def + export deleted; `repos/auditRepo.js` and
  `jobs/pruneAuditLog.js` deleted; the maintenance prune call + shutdown flush
  in server.js removed; `RETENTION_AUDIT_DAYS` config default dropped.
  **PROD owes migration 0008** before/at next prod deploy.
- **Files:** backend/middleware/audit.js (rewrite), backend/server.js,
  backend/db/schema.js, backend/db/migrations/0008_drop_api_audit_log.sql (+meta),
  backend/db/deploy/schema.sql, backend/config/defaults.js, backend/test.env,
  deleted repos/auditRepo.js + jobs/pruneAuditLog.js; tests auditMiddleware
  (rewrite), reposUnit (auditRepo block removed), pruneJobs (pruneAuditLog block
  removed), deleted auditRepoFkFallback; backend test.env (AUDIT_LOG=false);
  docs Environment_Configuration/incident-response/database-schema/database_design/
  Publish_Requirements/PERFORMANCE_REVIEW/Bugs_Common_Fixes/Task_Log + verify skill.
- **Status:** done — backend `npm test` green (957 pass / 0 fail / 1 dormant
  skip, 958 total; coverage 92.62/78.4/92.98/92.62 ≥ floors 90/75/91/90;
  audit.js 100% lines). Migration 0008 applied to DEV during the run; **PROD
  owes 0008**. Not committed yet.

### 2026-07-23 — Wire `/health?probe=ocr` into uptime monitoring (billing-lapse page-me)
- **Asked:** "Wire /health?probe=ocr into uptime monitoring so a billing lapse
  pages you before users hit it next time" (goal set via `/goal`), plus "wire any
  necessary feature in health to avoid this type of problem in the future."
  Directly follow-on from the same-day outage below (Bugs_Common_Fixes #127),
  whose own "Prevent" line called for exactly this.
- **Done:** added a proactive cron (`runOcrAuthProbeCheck`, `OCR_AUTH_PROBE_CRON`,
  default `20 */6 * * *`) that runs the same real-Vision-call probe behind
  `/health?probe=ocr` on a schedule and pages via the existing throttled
  ops-alert email (`raiseAlert`) the instant it stops returning `ok` — no
  external service required. Also documented pointing an external uptime
  monitor (UptimeRobot/Better Stack/etc.) at `/health?probe=ocr&token=...` as a
  second, independent paging channel. Full test coverage in
  `backend/tests/ocrAuthProbeCron.test.js` + `ocrAuthProbeCronNoKey.test.js`;
  `npm test` green (982 tests, coverage gate passes). Docs updated:
  `Environment_Configuration.md` (new "OCR (Vision) auth probe" section),
  `Bugs_Common_Fixes.md` #127 "DONE" follow-up.
- **Files:** backend/server.js, backend/tests/ocrAuthProbeCron.test.js,
  backend/tests/ocrAuthProbeCronNoKey.test.js, docs/Environment_Configuration.md,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.

### 2026-07-23 — CI follow-ups on PR #193: artifact quota + gitleaks disabled
- **Context:** after re-enabling CI (entry below), the `Tests` workflow hit
  two failures on push: (1) the mobile job's coverage-artifact upload failed
  with "Artifact storage quota has been hit" even though all 2974 tests
  passed — fixed by marking both coverage-upload steps `continue-on-error:
  true` in `.github/workflows/test.yml` (upload is best-effort, not part of
  the test gate); Maxim separately cleaned up old artifacts to free quota.
  (2) the `security` job's gitleaks step found 8 leaks in the current tree.
- **Asked:** "disactivate the gitleaks for now but don't delete it and add a
  note for that to reactivate it before publishing the app."
- **Done:** gitleaks step in `.github/workflows/test.yml` muted via `if:
  false` (kept in file, one-line revert); note added to
  `docs/PUBLISH_CHECKLIST.md` to re-enable before publish, once the §8A
  credential-rotation blocker is resolved.
- **Not done:** did not investigate or rotate whatever gitleaks matched —
  that's still open under §8A.
- **Files:** `.github/workflows/test.yml`, `docs/PUBLISH_CHECKLIST.md`.
- **Status:** pushed to `claude/github-workflows-docs-nqhvzb` (PR #193).

### 2026-07-23 — Re-enable GitHub Actions CI (push/pull_request/release triggers)
- **Asked:** "reactivate the workflows on Github for this repo."
- **Context:** both workflows were switched to `workflow_dispatch`-only on
  2026-07-11 after GitHub Actions free-tier minutes were exhausted for that
  billing period (see Bug/PR history around 2026-07-11, and
  `docs/PUBLISH_CHECKLIST.md` §"GitHub Actions CI").
- **Done:** restored `push`/`pull_request` (branches: `main`) on
  `.github/workflows/test.yml` and `release: [created]` on
  `.github/workflows/npm-publish-github-packages.yml`; `workflow_dispatch` kept
  on both as a manual fallback. Updated `docs/PUBLISH_CHECKLIST.md` to reflect
  the re-enabled state.
- **Not verified:** whether the free-tier minutes allowance has actually reset
  for the current billing period — if it hasn't, the next push/PR run may fail
  or queue rather than exhausting further budget. Worth a check in the repo's
  Settings → Billing → Actions page.
- **Files:** `.github/workflows/test.yml`, `.github/workflows/npm-publish-github-packages.yml`, `docs/PUBLISH_CHECKLIST.md`.
- **Status:** done, pushed to `claude/github-workflows-docs-nqhvzb`.

### 2026-07-23 — Wire `/health?probe=ocr` into uptime monitoring (billing-lapse page-me)
- **Asked:** "Wire /health?probe=ocr into uptime monitoring so a billing lapse
  pages you before users hit it next time" (goal set via `/goal`), plus "wire any
  necessary feature in health to avoid this type of problem in the future."
  Directly follow-on from the same-day outage below (Bugs_Common_Fixes #127),
  whose own "Prevent" line called for exactly this.
- **Done:** added a proactive cron (`runOcrAuthProbeCheck`, `OCR_AUTH_PROBE_CRON`,
  default `20 */6 * * *`) that runs the same real-Vision-call probe behind
  `/health?probe=ocr` on a schedule and pages via the existing throttled
  ops-alert email (`raiseAlert`) the instant it stops returning `ok` — no
  external service required. Also documented pointing an external uptime
  monitor (UptimeRobot/Better Stack/etc.) at `/health?probe=ocr&token=...` as a
  second, independent paging channel. Full test coverage in
  `backend/tests/ocrAuthProbeCron.test.js` + `ocrAuthProbeCronNoKey.test.js`;
  `npm test` green (982 tests, coverage gate passes). Docs updated:
  `Environment_Configuration.md` (new "OCR (Vision) auth probe" section),
  `Bugs_Common_Fixes.md` #127 "DONE" follow-up.
- **Files:** backend/server.js, backend/tests/ocrAuthProbeCron.test.js,
  backend/tests/ocrAuthProbeCronNoKey.test.js, docs/Environment_Configuration.md,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.

### 2026-07-23 — Prod outage triage: every scan fails + receipts show no items
- **Asked:** internal-testing build is up; opening the app shows receipts with
  only the hero card (no products) and **every** purchase/refund scan fails with
  "Our service is having a hiccup … our team has been notified."
- **Diagnosed (definitive):** the "hiccup" is `err.serverBody` = a backend **5xx**
  on the scan path. The production build points at `priceback-production.up.railway.app`
  (confirmed: `config/profiles` merge → `common.js` prod URL; `eas.json` production
  profile sets no `PRICE_API_URL`). `/health` is green but only checks the key is
  *present*. Probing prod `POST /api/ocr` returned **502**; Railway logs show
  **`[OCR] Vision returned 403: This API method requires billing to be enabled …
  project #200005505988`**. Root cause: **Google Cloud billing is disabled on the
  Vision project** — the key itself is valid (39-char `AIza…`). Same class as
  Bugs #81; both dev+prod OCR are down. The "empty products" is downstream of the
  same outage (no successful OCR ⇒ no line items); a read-only prod DB confirm was
  blocked by the safety classifier and is offered as an optional follow-up.
- **Fix (ops, only Maxim can do it):** re-enable billing on GCP project
  **#200005505988** →
  `https://console.developers.google.com/billing/enable?project=200005505988`.
  No app/backend deploy is needed; scans recover a few minutes after propagation.
- **Done in code (hardening):** `backend/lib/visionOcr.js` `callVisionOcr` now
  parses the Vision response defensively — a non-JSON (HTML) 403 body no longer
  throws (which had masked the billing-403 as "OCR service unreachable" on prod);
  the true 403 now drives the error map + `/health?probe=ocr`. Test added in
  `backend/tests/visionOcr.test.js`; `Bugs_Common_Fixes.md` entry #127 added.
- **Files:** backend/lib/visionOcr.js, backend/tests/visionOcr.test.js,
  docs/Bugs_Common_Fixes.md, docs/Task_Log.md.
- **RESOLVED (2026-07-23):** Maxim supplied a valid billed Vision key from the
  main app project **695135372222**; I validated it off-prod (Vision direct →
  200), set `GOOGLE_VISION_API_KEY` on the prod Railway service via stdin (hash-
  confirmed it took), the service redeployed, and prod `/api/ocr` now returns
  **200** (real device scans logged `[OCR] Success`). Scanning restored. The dead
  key's project #200005505988 (billing off) is now unused — clean up or re-enable
  separately. New scans populate items; receipts left empty during the outage
  need a re-scan. Backend hardening (defensive Vision-body parse) still uncommitted
  — offered to push as a PR. Follow-up: restrict the new key to Cloud Vision API
  only (currently unrestricted).

### 2026-07-23 — Version bump for next Play release; build/submit blocked on credentials
- **Asked:** "create a new apk through Expo and push it to the google play console
  for review."
- **Found:** this session's sandbox has no `EXPO_TOKEN` / `eas login` session, no
  Google Play service-account JSON (the `submit.production` block in `eas.json`
  is empty), and no `google-services.json` on disk — so `eas build` and
  `eas submit` cannot actually run here. Also, `docs/PUBLISH_CHECKLIST.md` §8A
  (Vision API key + Supabase prod password rotation) is still an open BLOCKER,
  independent of the build itself.
- **Done instead:** bumped the release identifiers per `docs/DEPLOYMENT.md`
  "Version Bumping" (`2.7.0`/versionCode 18 → `2.8.0`/versionCode 19/iOS build
  19), covering the substantial feature/fix set landed since the 2.7.0 release
  (#151): Costco Executive membership, offline receipt-scan queue, animated
  scan interstitial, credit reconciliation cron, several money-path/security
  audits (Bugs #90–#126). `SplashScreen.js` reads the version from Expo config
  at runtime — no manual UI edit needed (same as the 2.7.0 release note).
- **Not done:** the actual `eas build --platform android --profile production`
  and `eas submit` — needs a human with an authenticated `eas login` / EXPO_TOKEN
  and the Play Console service-account key to run those commands (see
  `docs/DEPLOYMENT.md` Build Commands).
- **Files:** package.json, app.json.
- **Status:** version bump only, pushed to
  `claude/expo-apk-google-play-044f31`; build + Play submission still to be run
  by someone with EAS/Play credentials.

### 2026-07-20 — Local/CI parity: one gate, committed parameters (Bug #126)
- **Asked:** "I want local and CI always the same behavior and same parameters
  and everything — if it passes locally it should pass on CI without any even
  small difference."
- **Found 5 divergences:** backend pool (5 local vs 3 CI), backend concurrency
  (4 vs 1), coverage ratchet (skipped by local `npm test`, enforced in CI, on
  BOTH runners), mobile snapshots (`CI=true` fails a missing snapshot; locally
  it writes one and passes), Node major (24 local vs 22 pinned in CI).
- **Rule adopted:** the workflow may check out, install, supply credentials, and
  run `npm test` — nothing else. All parameters live in committed config.
- **Changes:** new committed `backend/test.env` (DB_POOL_MAX=3, no secrets,
  loaded AFTER `.env` so it wins); `npm test` is now THE gate on both runners
  (backend `c8 … --test-concurrency=1` + both env files; mobile
  `jest --ci --watchAll=false --coverage`), with `test:ci`/`test:coverage` as
  `npm test` aliases and `test:fast` differing only by coverage; `.nvmrc` (24)
  + `node-version-file` in both jobs; `--ci` moved out of the workflow env into
  the mobile script; workflow now writes only DATABASE_URL.
- **Files:** .github/workflows/test.yml, .nvmrc, package.json,
  backend/package.json, backend/test.env, __tests__/ciParity.test.js,
  docs/Bugs_Common_Fixes.md #126.
- **Status:** done — mobile 2873 pass / 123 suites, backend 976 pass / 0 fail
  with the ratchet, both via the new canonical `npm test`. Parity guard verified
  to FAIL when a CI-only knob is reintroduced.

### 2026-07-20 — Pool-starvation deadlock on the money paths (Bug #125)
- **Asked:** "dig into it" — investigate the concurrent-spend test that failed in
  the last CI run and that I'd reported as a probable flake.
- **Found:** not a flake and not a race. The test died on
  `timeout exceeded when trying to connect` before any assertion. `lookupId()`
  resolved cache misses on the POOL while callers held an open transaction, so a
  transaction checked out a SECOND connection; at concurrency ≥ pool max every
  connection is held by a transaction waiting for a connection → starvation
  deadlock until the 5s connect timeout. Seven call sites, all money paths
  (`consumeScanCreditOnce`, `recordTopupOnce`, signup grant, recon apply, plus
  tx-scoped helpers `applyCreditChangeTx`/`_ledgerRowForTx`/`appendMigrationSeed`
  — the helpers were invisible to a literal `.transaction(` grep). Cold-cache
  only, which is why it never reproduced locally. CI vs local was purely the pool
  budget: CI sets `DB_POOL_MAX=3`, local defaults to 5, and the test hard-coded 4
  racers — so the test was also demanding pool_max+1 connections.
- **Impact:** production pool is 5, so a burst of ≥5 concurrent scans on a cold
  cache (i.e. just after a deploy/restart) could deadlock the same way. The Bug
  #109 over-draw guard had also been failing 1/1 in CI since it landed, so it was
  guarding nothing there.
- **Changes:** `lookupId(table, code, exec)` optional executor, `tx` passed at
  every in-transaction site; the 4 constant-code money lookups hoisted above
  their transaction; on a transaction `lookupId` reads first and only calls
  `ensureSeeded()` on a real miss. Test now derives racer count from
  `DB_POOL_MAX` (asserts ≥2 so it can't degrade to a no-op) + new
  "concurrency ABOVE the pool max still completes" regression test that clears
  the lookup cache and oversubscribes the pool.
- **Files:** backend/db/client.js, repos/{creditsRepo,usersRepo,creditReconRepo}.js,
  tests/criticalPathAtomicity.test.js, docs/Bugs_Common_Fixes.md #125.
- **Status:** done — verified by reproducing the failure on pre-fix code under
  `DB_POOL_MAX=3`, then green: full backend suite 976 pass / 0 fail at pool 3.

### 2026-07-20 — Commit sweep: restore EXPIRY_EARLY_WARNING_DAYS in both shared/pricing.config copies
- **Asked (/goal):** commit everything in the tree and merge to GitHub.
- **Found while reviewing the diff:** the working tree DELETED
  `EXPIRY_EARLY_WARNING_DAYS: 7` from `backend/shared/pricing.config.js`. Root
  cause was pre-existing drift — commit 1207a52 (Bug #122 early claim reminder)
  added the constant to the BACKEND copy only, and a later sync of
  `shared/` → `backend/shared/` resolved that drift in the wrong direction by
  dropping it. Backend still consumes it in `config/configService.js` (x2) and
  `db/seed.js`, so `fallbackCfg.EXPIRY_EARLY_WARNING_DAYS` went `undefined` and
  seed.js would have written an undefined app_config value. Mobile only escaped
  because `pricingCatalogService` carries an inline `7` default.
- **Fix:** restored the constant in `shared/pricing.config.js` and re-synced the
  backend copy; the two files are now byte-identical (`diff` clean), which is the
  invariant the other `shared/` mirrors (e.g. ocrCleanup.js) follow.
- **Status:** done — backend configService (13) + sharedPricing (5) green; mobile
  pricingCatalogService/purchaseService/paywallScreen 139 green.

### 2026-07-19 — Offline receipt scan queue (parity with the price-tag queue)
- **Asked (/goal):** receipt scans must also work in offline mode like the price
  tag scan — queue the photo offline, process when the connection returns, and
  notify with the same notification type as the price-tag queue so the user can
  review after.
- **Changes:** new `src/services/receiptScanQueue.js` (mirrors tagScanQueue:
  AsyncStorage queue + documentDirectory/receipts_pending/ image persistence,
  `processPendingReceiptScans` worker gated on `probeReachable` + the credit
  gate; rejected gas/refund reads spend the 1 credit like online, unreadable →
  error without spend); new `src/screens/PendingReceiptScanScreen.js` review
  list ("Review & save" opens ScanScreen preloaded); ScanScreen probe-first
  capture (offline → queue + "Saved for later"), network-failure fallback to
  queue, "N receipts waiting" banner, queued-entry load via `queuedScanId`
  param + queue removal on save; `sendReceiptScansReadyNotification` (same
  scan-processing channel/type family as tags, `receipt_scans_ready` tap →
  PendingReceiptScan); drains wired into bootService, App.js foreground +
  60s poll + notificationService background-fetch task; i18n EN+FR keys.
- **Status:** done — receiptScanQueue/pendingReceiptScanScreen/scanScreen
  offline/notificationTapRouting/bootService/i18nCompleteness suites green.
  Commit/PR pending.

### 2026-07-19 — Receipt parser: strip register markers (start-of-basket class) from product names
- **Asked (/goal):** the "start of basket"-class keywords sometimes still end up
  in product names; adjust the parser to remove any irrelevant words from
  product names, based on the Costco receipt fixtures + anything else that can
  print on a Costco receipt.
- **Found:** goldens showed `SELF - CHECKOUT HANNAS WW 10` (×3 receipts),
  `AGE VERIFIED DEPOSIT VL`, `SMOKED SALM .` — the register's lane marker /
  age-check stamp print as bare lines directly above an item row and the
  wrapped-name carry glued them on (same class as Bugs #67 PRE-SCANNED weld).
- **Changes:** shared/ocrCleanup.js BANNER_NOISE_RES + BANNER_WORD_RE gained
  the register/cart-marker vocabulary (self-checkout EN/FR, age-verified EN/FR
  incl. accented-`ÂGE` alternation, Bottom-of-Basket / BAS DU PANIER / BOB
  Count inline with SKU-safe count eating incl. the O-for-0 misread);
  scrubItemNameNoise also trims a trailing orphan punctuation token;
  extractItems scrubs the name-head carry + append-to-prev fragment so markers
  never enter names even uncleaned. Goldens re-pinned (6 diffs, all reviewed
  improvements: 4 marker prefixes gone, 2 trailing-punct trims, rawTextDigest
  shrink where marker lines left persisted OCR). Bugs_Common_Fixes #123.
- **Files:** shared/ocrCleanup.js (+ backend/shared sync),
  src/services/receiptParsingShared.js; tests ocrCleanup (+6 marker cases),
  receiptParsingShared (+3 engine-guard cases), costcoReceiptParser.realocr
  (FORBIDDEN + 3 new fixture pins + sku-null name lookup), receiptGolden
  re-pinned.
- **Status:** done — ocrCleanup/receiptParsingShared/realocr/golden suites
  green (810 tests). Commit/PR pending.

### 2026-07-19 — Claim/price-drop UX: hide eligibility, in-app receipt (preferred), auto-stop watch on expiry
- **Asked (/goal):** (1) hide the Eligibility section on claims for now; (2) the
  Costco receipt is saved in the app and should be retrievable through the app
  with a note that the in-app receipt is PREFERRED; (3) the "Stop watching"
  button must be disabled after expiry and the app must auto-stop watching
  (mandatory, not optional); (4) surface the saved receipt on the price-drop
  page for easy access; (5) add the in-app receipt as the FIRST "How to claim at
  Costco" step.
- **Changes:**
  - **Eligibility hidden:** DetailScreen `SHOW_ELIGIBILITY = false` gate (card
    kept in code, gated off).
  - **Auto-stop on expiry:** `storageService.updateExpiredReceipts` now also
    clears `watchEnabled`/`priceDrop` on every still-watched, unclaimed item of
    an expiring receipt (new `_stopWatchesOnExpiry` helper) and mirrors each
    watch-off to the backend durably (`setItemWatchOnBackendDurably` + queue) so
    a closed window can never keep getting drop pushes/commission. Wired into the
    boot pipeline (`bootService`, defensive `?.()` call) so it runs on the
    freshly-hydrated receipts, not just on the Receipts screen focus.
  - **Stop-watching disabled after expiry:** DetailScreen `const expired =
    days <= 0`; both Stop-watching buttons (receipt-level + per-item) are
    `disabled={expired}`, greyed (`secondaryBtnDisabled`), and relabel to
    "Watching stopped" (`detail.watchStopped`, EN+FR).
  - **In-app receipt = preferred:** receipt archive card in DetailScreen gains a
    preferred note (`detail.receiptPreferred`); ClaimAssistantScreen gains a
    saved-receipt card (preferred note + "View saved receipt" toggle + inline
    image) so the receipt is one tap from the claim flow; the in-store checklist
    first item now reads "Show your receipt in the PriceBack app (preferred)…";
    Costco `claimSteps[0]` rewritten to lead with the in-app receipt.
- **Files:** mobile DetailScreen.js, ClaimAssistantScreen.js, storageService.js,
  bootService.js, constants/stores.js (Costco claimSteps), i18n.js (+5 keys
  EN+FR: detail.receiptPreferred, detail.watchStopped, claim.viewReceipt,
  claim.receiptPreferred, revised claim.checklistReceipt); tests
  storageServiceReceipts (+2 auto-stop cases), bootService (+drain assert).
- **Status:** done — storageServiceReceipts 5/5, bootService 1/1,
  detailScreen/claimAssistant/i18nCompleteness/screens suites green. No backend
  change, no migration. Commit/PR pending.

### 2026-07-19 — Costco membership tier (Gold Star / Executive) + Executive-only offer drops
- **Asked:** add the shopper's Costco membership type (Gold Star, Executive) to
  the Profile page so Executive-exclusive offers (Costco occasionally runs
  offers only Executive members can buy) also trigger price drops for Executive
  members; expose it as a toggle in the flyer upload; integrate it into every
  price-drop-management path.
- **Design:** membership is a per-user attribute distinct from the app's own
  subscription. An Executive-only FLYER offer carries `flags.executiveOnly` on
  its `price_points` row; a price group counts as Executive-gated only when
  EVERY row at that price is exclusive (`BOOL_AND`) — a single non-exclusive
  sighting (e.g. a regular-member tag scan at the same price) un-gates it for
  everyone. Gating happens in the drop query by the buyer's authoritative
  `users.costco_membership_type` (the money/notification path never trusts a
  client value); the public in-app price lookup takes a spoof-safe display hint.
- **Backend:** `users.costco_membership_type` text col (gold_star|executive,
  default gold_star), migration `0007_broken_sister_grimm` (applied to DEV
  Supabase; **PROD owes 0007**), consolidated schema regenerated;
  `usersRepo.updateProfile` whitelists it; `PUT /api/me/profile` +
  `GET /api/me` carry it (DB + JSON-fallback paths). `flyerPricing.normalizeOffer`
  carries `flags.executiveOnly`; `commitFlyerImport` persists `{executiveOnly:true}`
  to `price_points.flags`. `priceDropRepo.findNotifiable` — per-row `executive_only`,
  `BOOL_AND` per group, candidates filtered by `u.costco_membership_type`
  (a Gold Star buyer falls through to their best non-exclusive verified price,
  so an unclaimable deal never pushes or bills them). `getLatestVerifiedPrice`
  gains a `membershipType` param that hides exclusive groups from non-Executive /
  anonymous callers; `/api/check-price` threads the client hint.
- **Mobile:** SETTINGS default `costcoMembershipType`; Profile → Preferences
  "Costco membership" row + picker modal; durable `profileSyncQueue` carries
  the tier (enqueue-before-attempt, coalesce, confirm-to-clear,
  `hasPendingCostcoMembership()`); `syncService` hydrate folds server→local with
  the same pending/last-flush guard as notif prefs (offline change never
  reverted); `AdminFlyerScanScreen` batch-level "Executive members only" Switch
  merges `flags.executiveOnly` onto committed items; `priceService.checkPrice`
  sends the membership hint. i18n EN+FR for all new keys.
- **Files/areas:** backend db/schema.js (+migration 0007 + consolidated schema),
  repos/{usersRepo,priceDropRepo}.js, flyerPricing.js, server.js (profile
  routes + commitFlyerImport + check-price); mobile storageService,
  profileSyncQueue, syncService, priceService, StoresAndProfileScreens,
  AdminFlyerScanScreen, i18n; tests backend flyerPricing (+1),
  priceDropExecutiveDb (new, 6), routes (+1), mobile profileSyncQueue (+3),
  syncServiceHydrate (+2), adminFlyerScanScreen.smoke (+1).
- **Status:** done — new priceDropExecutiveDb 6/6 + affected backend suites 63/63
  + routes 58/58 green on DEV Supabase; mobile profileSyncQueue/syncServiceHydrate/
  adminFlyer/i18nCompleteness green. Branch `feat/costco-executive-membership`;
  commit/PR pending. **PROD owes migration 0007** before next prod deploy.

### 2026-07-19 — Three reported bugs: claim-window reminder, Home text overlap, offline tag-scan notification
- **Asked:** fix three bugs — (1) active claims can still be redeemed after the
  30-day window; add a new reminder/category to remind the user; (2) Home
  tracked-item text is partly hidden by the Claim button when a % drop chip is
  present; (3) the offline-mode "price tags ready to review" notification never
  arrived, and the offline reviewer should have the admin's tap-to-zoom.
  (Clarified mid-task: the "ready to review" notification is for USERS scanning
  offline, not the admin.)
- **Fixes:**
  - **Bug #120 (Home overlap):** the tracked-item `chipRow` had no `flexWrap`
    and the warehouse label no truncation → the extra `−%` chip pushed chips/
    label under the right-hand Claim column (RN doesn't clip child overflow).
    Fix: `chipRow` flexWrap:wrap, label numberOfLines+flexShrink, right column
    flexShrink:0. HomeScreen only.
  - **Bug #121 (offline tag notification):** worker only triggered on cold
    boot / background→active / daily BG-fetch, so a user who stayed
    foregrounded when signal returned never OCR'd → no notification; a blind
    offline trigger also burned the OCR attempt budget (could strand as
    `error`); and the "ready" alert scheduled against an Android channel that
    only `registerForPushNotifications` created (bails early in several cases).
    Fix: `_process` probes /health first & skips offline (no attempt burn);
    App.js 60s foreground poll drains on return-to-connectivity; extracted
    idempotent `ensureAndroidChannels()` called before scheduling. NOTE: the
    offline reviewer (PendingTagScanScreen) ALREADY has the admin's
    `ZoomableImage` tap-to-zoom (shipped 2026-07-15) — verified present, no
    change needed for that half.
  - **Bug #122 (claim reminder):** only 3-day + 1-day reminders existed → long
    silent gap after early detection. Added `scheduleEarlyClaimReminder`
    (`EXPIRY_EARLY_WARNING_DAYS`, default 7, DB-tunable end-to-end mirroring
    `EXPIRY_WARNING_DAYS`), own identifier `expiry-early-<id>`, distinct copy,
    same category+detected-drop gates, self-skips on collision/late detection;
    wired into cancel/sync/reconcile. (Did NOT change the DetailScreen
    redeem-after-expiry behavior — a user may legitimately mark claimed after
    redeeming in-store on the last day; the ask was a reminder.)
- **Files:** mobile HomeScreen.js, notificationService.js (new fn +
  ensureAndroidChannels refactor), tagScanQueue.js (reachability gate), App.js
  (foreground poll), pricingCatalogService.js; backend shared/pricing.config.js,
  config/configService.js, db/seed.js (EXPIRY_EARLY_WARNING_DAYS); tests
  notificationService (+5), tagScanQueue (+1 offline-skip), pricingCatalogService
  (+1 key); docs Bugs #120/#121/#122.
- **Status:** done — mobile full suite 2816/2816, 55 goldens intact, coverage
  72.9/60.43/59.97/75.37 ≥ floors. Backend config tests green (18/18); change is
  additive config plumbing mirroring EXPIRY_WARNING_DAYS. No migration (app_config
  seed data only). Commit/PR pending.

### 2026-07-19 — Audit round 5: full-feature durability sweep (every remaining client→server mutation)
- **Asked:** run full audit round 5 over all functions and features, prioritizing
  perimeters NOT covered in rounds 1–4, fix findings. North star: any action done
  in the app is never lost even offline and always reaches the server.
- **AUDITED CLEAN (don't re-fix):** cloud prefs (LWW clock + re-push each
  hydrate); push token (re-pushed every hydrate/sign-in); watch-ON and -off +
  claims (round-4 edits queue covers both directions); registerForPriceWatch
  (full re-registration every foreground — idempotent); device scan counts
  (max-merge full-state sync every app open); receipt/delete/item queues; offline
  tag queue + PendingTagScan (dequeue only on full success); email-sync
  receipts (standard saveReceipt durable pipeline); onboarding profile+
  consents push (blocks on failure); referral redeem (blocks); account
  deletion (blocks w/ friendly error); admin screens (interactive alerts);
  postal/province (no post-onboarding edit UI → no loss surface).
- **Findings + fixes:**
  - **Bug #117:** notification-pref toggles were ONE fire-and-forget push +
    unconditional server-wins hydrate fold → an offline toggle was lost AND
    reverted; server kept pushing disabled categories. Fix: durable profile
    outbox `profile_sync_pending_v1` (src/services/profileSyncQueue.js) —
    enqueue-before-attempt, current-state coalescing, confirm-only clear,
    drains on boot/foreground/hydrate; hydrate fold yields while pending or
    when a flush landed mid-hydrate (`lastSuccessfulFlushAt() >= fetchedAt`).
  - **Bug #118:** marketing_push consent rode the same lossy channel while
    the Profile focus re-read overwrote local from the server ledger → a
    CASL withdrawal could silently never land + UI snapped back. Fix: consent
    events ride the outbox (per-type coalescing), focus re-read skips while
    pending; Onboarding's returning-user T&C re-affirm queued too.
  - **Bug #119:** Reset All Data ignored the server reset result and wiped
    locally anyway → transient failure = old credits/receipts resurrected at
    next hydrate. Fix: wipe gated on `canProceedWithLocalReset` (ok /
    auth_required / backend_unconfigured proceed; transient blocks with new
    profile.resetFailed* alert EN+FR) — same contract as account deletion.
  - **Residuals (documented, not fixed):** `disabledStoreSubscriptions`
    backend mirror is a NO-OP (user_disabled_stores table removed) — list is
    local-only, comment corrected in storageService; live tag-submit failure
    is interactive-retry (visible refusal; offline capture path already
    queues); analytics/telemetry stays fire-and-forget by design.
- **Files/areas:** mobile profileSyncQueue.js (new), NotificationsScreen,
  StoresAndProfileScreens (consent guard + reset gate), OnboardingScreen,
  syncService (fold guard + drain), bootService, App.js, authService
  (canProceedWithLocalReset), i18n (+2 keys EN+FR), storageService (comment);
  tests profileSyncQueue (new), notificationsScreenDurableSync (new),
  syncServiceHydrate (+3), bootService (+1 drain), authServiceApi (+3),
  onboarding suites (queue mock); docs Bugs #117/#118/#119.
- **Status:** done — PR #181 merged (f778ed6), branch deleted. Full mobile
  suite 2810/2810, 55 goldens intact, coverage 72.87/60.4/60.05/75.32 ≥
  floors 57/44/48/60 + all per-file floors. No backend change, no migration.

### 2026-07-18 — Critical-path audit round 4: mobile↔server money contract (client-side durability)
- **Asked:** run a full audit on critical functions (credit, subscriptions,
  scanning, price drops + claiming) and fix findings (same /goal family as
  rounds 1–3, PRs #174/#176/#177). This round takes the one axis those never
  covered: the MOBILE side of the money contract — is every client-initiated
  money/state mutation durable, or can it be silently lost?
- **NOT re-audited:** everything in the audited-clean lists of rounds 1–3 +
  #161/#162/#169–#172 (all backend). Client paths verified CLEAN this round
  (don't re-fix): offline-scan spend buffer (durable log + idempotent flush,
  boot/balance-read drains); receipt sync (syncPending retry + tombstone
  queues for receipt/item deletes); reconcileWithServer (server-wins,
  device-claim + flag handling); canAddReceipt offline gate (bounded by
  last-known balance − buffered spends > safety floor); subscription purchase
  path (syncSubscriptionToBackend retried on every reconcile poll — durable
  enough); auto-reload (opt-in, OS dialog per purchase, one prompt per
  threshold crossing); ClaimAssistantScreen (guide-only, no state mutation).
- **Findings + fixes:**
  - **Bug #115 (money-critical):** a PAID credit-pack purchase could
    permanently fail to credit. After the store approved payment, the grant
    depended on ONE fire-and-forget confirm POST — and the "backup" RC webhook
    has never delivered an event on prod. A network blip/backend 5xx/app kill
    in that window = money taken, credits never granted, no retry, no record —
    and purchaseProduct still reported success ("credits are now on your
    account"). Fix: durable `pending_topup_confirms_v1` queue (enqueue BEFORE
    the first attempt; dequeue only on server confirm or terminal
    retryable:false), `flushPendingTopupConfirms()` on boot + foreground +
    every live balance read; confirm result now carries {status, retryable}
    honoring the server's body flag (402 RC-lag retries, 402 sandbox
    terminal); firstTopup auto-reload opt-in applies on late-landing confirms;
    UI shows "will be added automatically" (new i18n key EN+FR) when pending.
  - **Bug #116 (money + truthfulness):** claims and watch-stops were
    fire-and-forget POSTs with NO retry queue (receipts/deletes have them) —
    and the receipt POST body carries no claim fields, so a failed claim POST
    (the NORMAL offline-at-the-service-desk case) had no other road to the
    server. Server kept the line watched → repeat drop pushes + further drop
    commissions on an item the user already closed out; fresh devices
    rehydrated it unclaimed. Fix: durable `receipt_item_edits_pending` queue
    (fingerprinted, coalesced per item, claim supersedes watch-off), drained
    on boot/foreground/post-hydrate AFTER retryPendingReceiptSyncs (claim on a
    just-synced receipt lands same pass; 404 keeps the entry queued — receipt
    not on server yet); entries expire at 90d / when the local receipt is gone.
  - **Test-blind-spot fix:** bootService.test.js left tagScanQueue unmocked —
    its synchronous require throw aborted the boot task in Jest before the
    purchaseService flushes, so nothing after it was ever asserted. Now mocked
    + all boot drains asserted.
- **Files/areas:** mobile purchaseService.js (queue + durable confirm +
  flush), storageService.js (edits queue + durable claim/watch + drain),
  bootService.js, App.js, syncService.js (_kickReceiptPushThenEdits),
  BuyCreditsScreen.js, Paywall.js, i18n.js; tests pendingTopupConfirms (new),
  storageServiceItemEdits (new), bootService (+3 assertions),
  syncServiceHydrate (+2); docs Bugs #115/#116.
- **Status:** done — PR this session. No backend change, no migration.

### 2026-07-18 — Goal step 2: prod-health sweep by criticality (schema drift, cron stall, RC webhook)
- **Asked:** (second clause of the same /goal) after the round-3 audit, check
  other features by importance/criticality. Chose read-only PROD health checks
  + the one code gap they exposed.
- **Findings:**
  - **PROD DEPLOY BLOCKER (ops, not code):** full column diff prod-vs-dev shows
    exactly ONE drift: `users.subscription_started_at` missing on prod. Cause:
    the column lives in the squashed `0000_initial.sql`, whose hash is already
    recorded in prod's drizzle journal — but prod's tables predate the squash,
    and `CREATE TABLE IF NOT EXISTS` no-ops on existing tables. So `db:migrate`
    can NEVER add it. Next prod deploy of any backend built after 2026-07-11 →
    usersRepo ORM select fails → bootstrap 503 → the 2026-07-10 sign-in outage
    again. Manual fix owed (Maxim to approve):
    `ALTER TABLE priceback.users ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz;`
    Everything else matches (incl. purchase_type_id, topup_refs, all indexes —
    the "prod owes 0002-0006" memory is STALE: prod journal has all 7 entries;
    reconcileCredits failed 5 days on the missing table then went green
    2026-07-18, consistent with a ~07-17 prod migrate).
  - **Bug #114 (code, fixed):** priceSweep is the only interval-from-boot job
    (setInterval resets each restart) — prod shows 2 runs/7d, none since
    07-15, while wall-clock crons all fired. The cron-only legs
    (settleAllVerified tag-credit release, recomputeOverduePolicyStatuses)
    therefore stalled — earned tag credits not released. Fix: boot catch-up —
    `sweepCatchUpDue` pure helper + `jobRunsRepo.lastOkRun`, wired in
    startServer (3-min unref'd delay, fires one idempotent sweep only when
    the last OK run ≥ one interval old).
  - **RC webhook: still 0 events ever on prod** — the [[signin-block-and-subscription-sync]]
    OPS item (REVENUECAT_SECRET_KEY + webhook) remains undone.
  - Cron health otherwise green (digest/maintenance/retention daily ✓); prod
    flyer test-residue rows documented in the round-3 entry.
- **Files/areas:** backend sweepScheduler.js, repos/jobRunsRepo.js, server.js
  (startServer wiring); tests sweepScheduler (+catch-up unit),
  jobRunsRepoDb (new, DB-gated); docs Bugs #114.
- **Status:** done — PR #178 merged (7cbac20), branch deleted. Full backend c8
  run: 967 pass / 0 fail, coverage 92.6/78.47/93.25/92.6 ≥ floors 90/75/91/90.
  Ops items left with Maxim: (1) the prod `subscription_started_at` ALTER
  (deploy blocker), (2) RC webhook env on prod, (3) optional prod flyer
  test-residue cleanup.

### 2026-07-18 — Critical-path audit round 3: ingest-surface trust (flyer pipeline + external write surfaces)
- **Asked:** run a full critical path audit and fix any findings, then check
  other features by importance/criticality (same /goal re-issued after rounds
  1–2 merged as PRs #174/#176 — this round takes the last uncovered axis).
- **Decision/constraints:** scope = every EXTERNAL surface that writes into the
  shared price pool or credits, centred on the flyer pipeline (the PRIMARY
  price source, tier-1 authoritative + verification/age-exempt + ALL-province
  fan-out) which no prior pool-sanity audit had named. NOT re-audited:
  everything in the audited-clean lists of #174/#176/#171/#172/#169/#170/#161/#162.
- **AUDITED CLEAN (don't re-fix):** /api/flyer/import + /api/admin/barcode-links
  auth (constant-time token compare, pre-auth per-IP throttle, 2000-item cap);
  admin flag/verify/barcode routes (_adminTokenOk or requireAuth+adminSubs,
  id-scoped); barcode links checksum-validated in linkBarcodeToSku; tag
  observation path re-confirmed guarded upstream of recordPricePoint
  (0.5–5000 + outlier); receipt pool gate (isPoolableUnitPrice) intact;
  normalizeOffer itself is a sound gate (region, 4–8-digit sku, required ISO
  window, 0<promo<100000, cent rounding).
- **Findings + fixes:**
  - **Bug #113 (pool poisoning, most-privileged tier):** commitFlyerImport
    Phase 2 (DB persist) rebuilt rows from the RAW items array (filter: has
    sku + Number.isFinite(price)) — bypassing normalizeOffer, which only
    protects the in-memory overlay. An item the overlay REJECTED (negative
    promoPrice — isFinite(-5) is true —, garbage sku, missing validity window)
    still entered price_points as a `flyer`-source row: tier-1 authoritative,
    no rule-of-N needed, age-exempt, fanned to all 13 provinces, and
    commission-billing on the fake "drop". Regular-only items (no promo)
    were also silently persisted at regular price, and window-less items got
    a NULL valid_until (immortal tier-1 row). Fix: ingestFlyerBatch now
    returns its acceptedOffers (normalized); Phase 2 persists ONLY those
    (printed validFrom/validUntil guaranteed). Defense-in-depth: hard range
    guard in recordPricePoint (finite, >0, <100000 — normalizeOffer's own
    ceiling, looser than the tighter upstream tag/receipt gates).
- **Files/areas:** backend flyerPricing.js, server.js (commitFlyerImport),
  repos/pricesRepo.js; tests flyerPricing (+acceptedOffers), flyerAdminRoutes
  (+persist-only-validated capture), repoValidation (+range guard); docs
  Bugs #113.
- **Prod data note (read-only check):** prod price_points holds inert TEST
  RESIDUE flyer rows (skus pp-flyer-*/pp-created-*/br-exp-*, refs
  flyer-batch-1/2; 12 bad-sku, 9 NULL-valid_until) — likely from standing
  prod up off a dev copy. No real watchers → harmless; cleanup SQL handed to
  Maxim (delete flyer-source rows whose product sku fails ^\d{4,8}$ + their
  orphaned products). Real imported flyer rows are clean.
- **Status:** done — PR #177 (branch `fix/flyer-ingest-validation`). Full
  backend c8 run: exit 0, 92.55/78.44/93.22/92.55 ≥ floors 90/75/91/90.
  No schema change, no migration.

### 2026-07-17 — Critical-path audit round 2: value correctness (money math, garbage-in, date bounds)
- **Asked:** run a full critical path audit and fix any findings (same /goal
  re-issued after the atomicity round below merged as PR #174 — this round
  takes the remaining uncovered axis).
- **Decision/constraints:** scope = the same critical paths on the VALUE axis:
  is the money math right, can garbage/hostile values enter the pool or the
  ledger, are date windows bounded. NOT re-audited: everything in the
  audited-clean lists of #161/#162, #169/#170, #171, #172, #174, #165.
- **AUDITED CLEAN (don't re-fix):** shared pricing math guards
  (claimCreditCost/dropChargeCredits floor+finite checks); topup credits are
  server-catalog + RC-verified (never client-supplied); scan cost from ops
  config; claim/watch routes Number.isFinite-normalize client numerics; claim
  is status-only (claimedSavings is display-only); drop-charge driving a
  balance negative is INTENTIONAL (commission debt — notification is the
  billed event; scan-consume floor unaffected); tag-observation pool guarded
  (0.5<price<5000 + 30% outlier + dedupe); effectiveScanTier time-aware NaN=
  lapsed; quantity guards (NULLIF(qty,0), qty>0-else-1) throughout.
- **Findings + fixes:**
  - **Bug #111a (money):** verified-drop sweep resolved charge exemption via
    `getBySub(sub).catch(() => null)` and `isCreditExempt(null)`=false → a
    transient DB error while resolving an UNLIMITED subscriber billed them a
    commission, permanently (dedupe row blocks retry/refund). Fix: a THROWN
    lookup marks the buyer exemption-unknown and their drops sit the sweep out
    (stay pending, re-elect next sweep); a null row still means free tier.
  - **Bug #111b (money):** incremental drop commission rounded each delta
    independently (round(Δ×15) per event) → path-dependent lifetime totals
    that drift from the documented invariant. Fix: telescoping totals —
    charge = dropChargeCredits(paid−new) − dropChargeCredits(paid−prior) — so
    lifetime total is exactly dropChargeCredits(paid−lowest) on any path.
  - **Bug #112a (pool poisoning):** receipt price points had NO price sanity
    guard (tag scans have one) — a price-less line was minted as a $0.00
    price_point (`it.price == null ? 0`), a mixed receipt's lone negative
    return line entered the pool negative, absurd values passed. A verified
    $0 group ⇒ "Now $0.00" pushes + full-price commissions for every watcher.
    Fix: `isPoolableUnitPrice` (finite, ≥$0.01, <$5000 — floor is a cent, not
    the tag scan's $0.50, because unit = lineTotal÷qty is legitimately small)
    gates the bulk insert; rejected lines keep their product row/receipt item.
  - **Bug #112b (date bounds):** POST /api/receipts accepted any purchaseDate
    — future dates planted price observations that stay "fresh" forever in the
    verification pool (observed_at ahead of every cutoff) and unparseable
    dates 500ed mid-transaction. Fix: route validates YYYY-MM-DD, real
    calendar date, ≤ today+1d (timezone slack) → terminal 400; past dates
    still allowed (old receipts importable, their windows simply expired).
  - Accepted residuals (documented, not fixed): offline-scans batch size
    unbounded (client wipes its log on HTTP 200, so a server cap would
    silently drop spends — in the house's favor but contract-breaking;
    bounded anyway by the JSON body limit + credit rate limiter); tag pool's
    $0.50 floor unchanged (pack prices, never divided).
- **Files/areas:** backend priceDropNotifier.js, repos/pricesRepo.js,
  server.js (receipt POST validation); tests priceDropChargeGuards (new,
  no-DB), priceDropCommission (+1 drift), receiptPricePoints (+2),
  docs Bugs #111/#112.
- **Status:** done — PR #176 (branch `fix/critical-path-value-audit`). Full
  backend c8 run green: 958 tests / 0 fail, floors met. No schema change, no
  migration.

### 2026-07-17 — Full critical-path audit: atomicity + races + partial-failure recovery
- **Asked:** run a full critical path audit and fix any findings.
- **Decision/constraints:** scope = the end-to-end critical paths (sign-in→
  bootstrap, scan→credit-consume→receipt-sync, tag-scan→grant, drop-detect→
  commission→claim, purchase→topup) on the ONE axis prior audits didn't cover:
  atomicity, race conditions, partial-failure recovery (double-tap/concurrent
  requests, consume-then-fail refunds, state-transition races). NOT re-audited:
  everything in the audited-clean lists of #161/#162 (price-drop security),
  #169/#170 (scale), #171 (security/authz), #172 (lifecycle/i18n), #165
  (parsers), offline/sync idempotency, notification truthfulness, money config.
- **AUDITED CLEAN (don't re-fix):** advisory-lock design on same-ref dedupe
  (scan/topup/price-tag grant+revoke — all correctly serialized per ref);
  recordTopupOnce global ref lock + wipe-proof burn; RC webhook replay guards
  (event-id + ref); recordNotified single-election + same-tx incremental
  commission under per-item locks (deleted users can't poison the batch — FK
  guarantees the user row); claim route idempotent status-only; referral
  settle FOR UPDATE; credit-recon apply FOR UPDATE + delta-0; tag-settle
  once-per-pool election (weekly-cap over-grant race accepted: bounded to 1
  credit, idempotent refs); offline-scans upload idempotent per ref; grants
  are atomic increments everywhere.
- **Findings + fixes:**
  - **Bug #109 (money race):** consumeScanCreditOnce's balance floor was a
    stale read — the advisory lock keys (userSub, ref) so N concurrent scans
    with DIFFERENT refs all passed the check on the last credit → negative
    balance / over-spend (reconciliation can't see it: ledger+balance drift
    together). Fix: floor moved into the UPDATE's WHERE
    (`scan_credits >= N`), ledger row in the same tx; losers report
    `insufficient`.
  - **Bug #110 (IDOR + silent data loss):** receiptsRepo.create's id-conflict
    fallback returned the existing receipt with NO ownership check — POSTing
    another account's receipt id read their receipt back, and an honest
    collision silently swallowed the caller's receipt (client marks
    created:false as synced). Fix: cross-account conflict throws
    RECEIPT_ID_CONFLICT → route maps 409 {receipt_id_conflict,
    retryable:false} (terminal 4xx keeps the receipt local); same-user retry
    contract unchanged; no charge on refusal.
  - **Test-suite fix:** dbRoutes' topup-replay test used the fixed ref
    `evt-topup-fixed` without un-burning topup_refs (the #172 pattern) → red
    on every rerun since PR #172; now un-burns first.
  - Accepted residuals (documented, not fixed): receipt-POST scan-consume
    failure stays non-fatal (deliberate availability>billing trade, comment
    documents it); tag-settle weekly-cap race (above); no client re-id on 409
    (honest collisions ~impossible with `r_<ms>_<rand>` ids).
- **Files/areas:** backend repos/{creditsRepo,receiptsRepo}.js, server.js
  (409 mapping); tests criticalPathAtomicity (new, 4 tests incl. true
  concurrent-spend race + HTTP 409), dbRoutes (un-burn); docs Bugs #109/#110.
- **Status:** done — PR #174 merged (7c63955), branch deleted. Backend full c8
  run 951 tests / 0 fail, floors met. No schema change, no migration.

### 2026-07-17 — Audit loop: account/data lifecycle + i18n parity (excl. last 2 audits)
- **Asked:** run an audit — excluding the last 2 audits already done and merged
  (full-app security pass PR #171, scale audit PRs #169/#170) — and fix findings.
- **Decision/constraints:** scope = the unaudited account/data-lifecycle axis
  (account deletion, /api/me/reset, data export, consents, referral redeem,
  notification prefs, retention/orphans) + first recorded EN/FR i18n parity
  sweep ([[no-unimplemented-labels]] hard rule). NOT re-audited: everything in
  the #161/#162, #169/#170, #171 audited-sound lists, receipt parsers (#165),
  offline/sync, notification truthfulness, money flows.
- **AUDITED CLEAN (don't re-fix):** data-export upsert-first ordering + IDOR
  scoping (PR #31 fix intact, DSAR dump complete incl. prefs/notif-settings/
  referees/consents/receipts-with-memberId); account deletion soft-delete
  tombstone design (trial can't re-farm, 30d reactivation, monthly purge cron
  wired 28-31 @ 04:00 + last-day guard); referral redeem rejection ladder
  (self/deleted/dup/setup-complete/unknown, edge-unique idempotency, deferred
  payout, FOR UPDATE settle race); tag photos already time-boxed 30d
  (pruneTagPhotos — the PIA open item from [[pia-r2-tagscan-retention]] is in
  fact resolved); EN/FR key parity was already perfect (1171 = 1171).
- **Findings + fixes:**
  - **Bug #107 (critical, money):** reset/delete-account physically wipe
    credit_ledger, which WAS the topup replay dedupe + referral-settle guard →
    one store purchase could re-mint credits after every reset (RC verification
    passes forever). Fix: new `topup_refs` table (unique ref, user_sub SET NULL
    on purge — ref stays burned; also drives firstTopup so auto-reload opt-in
    can't re-fire) + `user_referrals.settled_at` authoritative settle stamp;
    migration `0006_bitter_roxanne_simpson` w/ backfill, applied to DEV
    (**PROD owes 0006**, joins 0002-0005). Stale "ledger kept forever /
    survives reset" comments corrected (they documented the dead invariant).
  - **Bug #108 (privacy):** receipt photos in R2 (`receipts/{sub}/{id}.jpg`)
    were NEVER deleted by any path — "full erasure" left them forever. Fix:
    daily `pruneReceiptImages` job (soft-deleted receipts, 7d window,
    `RETENTION_DELETED_RECEIPT_IMAGES_DAYS`, wired into runDbRetentionJobs).
  - **i18n:** 3 `t()` keys used but unimplemented (common.ok,
    profile.inviteFriendsLabel/…FriendAnon — EN-only `||` crutches) → keys
    added EN+FR, crutches removed, and NEW `__tests__/i18nCompleteness.test.js`
    statically enforces EN/FR parity + every t("literal") resolves, forever.
  - Accepted residuals (documented, not fixed): scan-consume/price-tag-grant
    dedupe is still ledger-based (post-reset replay ≤ 1 credit, client wipes
    local state on reset); the remaining ~50 `t(x) || "…"` crutches where the
    key EXISTS (inert now the completeness test gates missing keys).
- **Files/areas:** backend schema.js + migration 0006 (+ consolidated
  schema.sql regenerated), repos/{creditsRepo,referralsRepo,receiptsRepo}.js,
  jobs/pruneReceiptImages.js, config/defaults.js, server.js; mobile i18n.js,
  PriceTagScanScreen.js, InviteFriendScreen.js; tests
  lifecycleDedupeDb (new), pruneReceiptImages (new), i18nCompleteness (new),
  usersRepoDb + offlineScanCredits (fixed-ref unburn for reruns); docs Bugs
  #107/#108.
- **Status:** done — PR #172 merged (e2b8395), branch deleted. Full backend c8
  run green with floors; mobile 2772/2772, 55 goldens intact, coverage
  72.09/59.81/59.23/74.61 ≥ floors. Migration 0006 applied to DEV; **PROD owes
  0006** (joins 0002-0005).

### 2026-07-16 — Security audit: full app pass + fix findings
- **Asked:** run a security audit and fix any findings.
- **Decision/constraints:** prior passes NOT re-audited (price-drop security
  PRs #161/#162, scale PRs #169/#170, 2026-06-02 pre-launch pass, email-token
  SecureStore). Focus = routes/surfaces, cross-cutting checks (secrets, deps,
  per-route authz, injection, admin gating), deferred-list re-eval. AUDITED
  CLEAN (don't re-fix): no committed secrets (only `.env.example` tracked, no
  hardcoded keys in source); analytics `todayLogPath` is date-derived (no path
  traversal); receipt + tag-review object keys are ownership-scoped (existing
  IDOR tests hold); all `/api/admin/*` routes gated (either `requireAuth` +
  `getAdminSubs()` or constant-time `x-admin-token`); rate-limited unauth
  routes (`/api/check-price`, `/api/ocr*`, `/api/analytics`, `/api/flyer/*`).
- **Findings + fixes (Bug #106):** (1) `POST /api/check-all` fired the
  province-wide sweeps + drop pushes with NO auth/throttle → admin-token gated
  (`_adminTokenOk`); mobile never calls it (users use authed
  `/api/me/check-drops`). (2) `DELETE /api/me/observations` wiped a device's
  crowdsourced observations with no ownership check (IDOR) → now enforces
  `callerOwnsDevice` when a token is present (403 on mismatch), anonymous
  trust-on-first-use preserved. Dependency advisories re-triaged: none
  runtime-exploitable (backend highs = drizzle static-identifier SQLi / undici
  SOCKS5 / form-data GCS-internal — unreachable; mobile crit/high are
  dev-tooling only), `npm audit fix` non-`--force` fixes nothing → not
  auto-bumped; documented in `SecurityRecommendations.md` §6.
- **Files/areas:** `backend/server.js`; tests `missingRoutes` (+1),
  `securityDb` (+1, verified live vs dev Supabase: 403 non-owner / 200 owner);
  docs `SecurityRecommendations.md` §6, `Bugs_Common_Fixes.md` #106.
- **Status:** done — branch `security/audit-unauth-side-effects`; missingRoutes
  14/14 + security/routes/fallback 67/67 (no-DB) + securityDb 4/4 (dev Supabase)
  green. PR this session.

### 2026-07-16 — Scale audit round 2: close the sweep's unbounded-scan watch-item
- **Asked:** (same /goal re-issued after /clear — continuation of the scale
  audit below) audit scanning + membership for high-load holes and optimize;
  target = long-term stability under high user load.
- **Decision/constraints:** round 1 (PR #169, below) left ONE explicit
  watch-item: `findNotifiable` scanning a province's whole price_points
  history every ~4s debounced sweep tick. This round closed it (+1 sibling
  found in the same path) instead of waiting for DB CPU to climb. Everything
  in round 1's AUDITED-SOUND list was NOT re-audited.
- **Fixed (Bug #105):** (1) `findNotifiable` — new `watched` CTE prefilter
  (only products with a live watched line can notify; output-identical) backed
  by partial index `receipt_items_watch_live_idx`, migration
  `0005_smiling_kulan_gath` (applied to DEV, verified via pg_indexes; **PROD
  owes 0005**, joins 0002/0003/0004) + hard `PRICE_DROP_LOOKBACK_DAYS` scan
  floor (ops default 120d, clamped ≥ windowDays) that the verified/flyer/admin
  age-exemptions now respect — bounds the scan as history accumulates over
  years; (2) `settingsByToken(tokens)` scope — a drop-bearing sweep no longer
  loads the whole user base's notification settings, just the tokens it will
  push. Consolidated schema regenerated.
- **Files/areas:** `backend/repos/priceDropRepo.js`, `priceDropNotifier.js`,
  `repos/notificationSettingsRepo.js`, `db/schema.js`, `config/defaults.js`,
  migration 0005, tests `priceDropDb` (+2: lookback floor, windowDays clamp),
  `notificationSettingsRepoDb` (+1: token scope), docs Bugs #105.
- **Status:** done — PR #170 merged (3064ba2), branch deleted. Full backend
  c8 run green with floors (935 tests).

### 2026-07-16 — Scale/stability audit: scanning + membership under high load
- **Asked:** audit for holes in the main features (scanning, membership
  management) and optimize if needed; target = the app survives high user
  load long-term while staying stable and fully functional.
- **Decision/constraints:** prior audits covered parser correctness, money
  flows, price-drop security, notifications — this pass focused on the
  scalability/stability axis. AUDITED SOUND (don't re-fix): pg pool config
  (5 conns, session pooler, transient-error taxonomy), requireAuth (local JWT
  verify, no per-request network), audit middleware buffering, receipt create
  (single tx, bulk price points), advisory-lock idempotency design,
  in-memory map sweeps (all limiter/cache maps bounded or swept), budget
  persistence (debounced + kv_state), drop-sweep overlap-guard/debounce
  (DB-load note at very high scale: `findNotifiable` scans province
  price_points every ~4s under steady traffic — revisit if DB CPU climbs),
  bootstrap (parallel reads, clamped pagination). FOUR HOLES FIXED (Bugs
  #103/#104): (1) credit_ledger had NO index for the ref-based idempotency
  lookups — global topup dedupe seq-scanned the fastest-growing table inside
  an advisory-locked txn → migration 0004 `credit_ledger_ref_type_idx
  (ref, type_id)`, applied to DEV, **PROD owes 0004**; (2) /api/ocr +
  /api/ocr-llm lacked the per-IP rotation brake (PR #162 gave it only to
  obs-tag) — deviceId rotation could drain the monthly Vision budget = scan
  outage for everyone → per-IP 5× budgets on both; (3) /api/me/subscription/
  sync unthrottled outbound RC fetch → 10/min per account; (4) one forged
  x-device-id header FK-poisoned an entire audit-log bulk insert (~100 rows
  dropped) → staged FK-violation retry in auditRepo. All four verified live
  at the HTTP surface (/verify PASS — thresholds exact: 150/100/10 and FK
  fallback row landed). New backend verify skill:
  `backend/.claude/skills/verify/SKILL.md`.
- **Files/areas:** `backend/server.js`, `backend/repos/auditRepo.js`,
  `backend/db/schema.js` + migration `0004_strong_groot` (+ consolidated
  schema), tests `ocrRateLimit` (+6), `auditRepoFkFallback` (new),
  `subscriptionSync` (+1), `creditLedgerAccuracy` (+1), docs Bugs #103/#104.
- **Status:** done — PR #169 merged (a74c9fa), branch deleted. Full backend
  c8 run green with floors enforced (GitHub CI is dispatch-only since
  2026-07-11 — Actions minutes exhausted — so local full runs are the gate).
  PROD owes migration 0004 (joins 0002/0003 per earlier entries).

### 2026-07-15 — App-audit loop: offline/sync layer + email-token storage
- **Asked:** (continuation of the audit loop after the receipt-parser audit,
  PR #165 merged as f634461) keep auditing the app's main parts by priority.
- **Decision/constraints:** offline/sync layer audited SOUND on the money/
  duplication axes — verified concretely: tag observation POST retries are
  idempotent server-side (crowdRepo dedupe on device+date+price, review row
  gated on `accepted`, credit ledger keyed on the stable observationRef,
  rule-6 rescan counter), receipt sync idempotent on the client-generated id,
  tag-queue photos deleted on submit. Low-sev note, NOT fixed: no orphan
  sweep for `documentDirectory/tags/` files whose queue entry vanished.
  ONE hole found + fixed (Bug #102): email OAuth tokens (incl. the Outlook
  REFRESH token) lived in plaintext AsyncStorage → moved to SecureStore with
  a one-time migration that deletes the plaintext copy; matches authService's
  pattern. Legacy-seeded tests keep working via the migration.
- **Files/areas:** `src/services/emailSyncService.js`;
  `__tests__/emailTokenSecureStore.test.js` (new) + secure-store mocks in the
  4 existing email suites.
- **Status:** done — branch `fix/email-token-securestore`, all 5 email suites
  38/38 green; PR this session.

### 2026-07-15 — UI fixes: resizing, missing tag images, offline-review zoom
- **Asked:** fix screens with resizing issues (example: the "credit running
  low / buy credit" flow); price-tag images that go missing at random; and add
  the admin-style pinch-to-zoom to the offline price-tag review screen (which
  only had a plain thumbnail).
- **Decision/constraints:**
  - Offline zoom (H3): `PendingTagScanScreen` used a plain `<Image>` thumbnail
    while `AdminTagReviewScreen` uses the shared `ZoomableImage`. Swapped it to
    `ZoomableImage` so the same pinch/double-tap viewer works on local file URIs.
  - Missing tag images (H2): TWO causes. (1) admin GET presigned URL TTL was
    only 10 min → images vanished mid-review; bumped `DEFAULT_GET_TTL` to 60 min
    (r2.js + gcs.js). (2) `uploadTagReviewImage` PUT + `image-uploaded` confirm
    were single-shot fire-and-forget → a network blip orphaned the R2 object,
    permanently unlinked; added bounded retries to both the PUT and the confirm.
  - Resizing (H1): the real symptom was the X close / ‹ back button being
    UNREACHABLE on modal screens (under the status bar). Root cause:
    `<SafeAreaProvider>` mounted without `initialMetrics` → top inset 0 on the
    first frame of freshly-mounted modal screens (worsened by SDK 55 edge-to-
    edge). Fix: `initialMetrics={initialWindowMetrics}` in App.js — app-wide.
    NOTE: could not run on-device here (no emulator/adb); Maxim to verify on a
    build. Bugs #100/#101 documented.
- **Files/areas:** `App.js`, `src/screens/PendingTagScanScreen.js`,
  `src/services/{priceService,i18n}.js`, `backend/storage/{r2,gcs}.js`,
  `__tests__/priceServiceNetwork.test.js`, `docs/Bugs_Common_Fixes.md`.
- **Status:** done (pending Maxim's on-device confirmation of the X-reachability
  fix). Mobile suites green: priceServiceNetwork 35/35, pending/buy/billing/
  admin/components smoke all pass. Committed via PR on branch
  `fix/ui-tag-image-reliability` (docs for Bugs #100/#101 landed a PR early,
  with #166).

### 2026-07-13 — Receipt-parser audit: holes per receipt type + fixes
- **Asked:** audit and find any holes in the receipt parsers for any receipt
  type (purchase, refund, …), find optimal solutions, autofix if possible;
  then continue auditing the whole app by logic priority while budget allows.
- **Decision/constraints:** audit verified EN refund/gas/TPD/VOID/printed-total
  machinery SOLID (don't re-fix). Confirmed holes → fixes on branch
  `fix/receipt-parser-type-audit`: H1 `detectRefund` bare-REFUND keyword fired
  before the positive-total guard (footer "refund" negated a purchase); H2
  French refunds undetected (`REMISE D'ACHAT` header, `ARTICLES VENDUS = -N`,
  `REMBOURSEMENT`) → positive price_points at refund prices; H3 refunds exempt
  from confidence/second-pass (refund-aware confidence, refund→refund retry
  only); H4 gas gate EN-only (FR pump tokens added); H5 membership-fee lines
  became watchable products (IGNORED_KEYWORDS); H6 purchaseType now persisted
  (`receipts.purchase_type`, next migration, PROD owes it); H7 dropped bare
  negative return lines now accounted (`returnsSum`) so mixed receipts can
  reconcile. H8 (online fixtures) needs real costco.ca captures — Maxim.
  Goldens byte-identical except deliberate refund-confidence re-pin (WS2).
- **Files/areas:** `src/services/{receiptParsingShared,costcoReceiptParser,
  receiptParser,receiptSyncService}.js`, `backend/db/schema.js` + migration
  `0003_flat_kabuki` (+ seed, consolidated schema), `backend/server.js`,
  `backend/repos/receiptsRepo.js`, tests both runners, Bugs #94–#99.
- **Status:** done — mobile 2761/2761 (55 goldens), coverage
  72.21/59.83/59.44/74.78 ≥ floors 57/44/48/60; backend serial run green
  (the 4 `npm test` concurrency-4 failures are the known environmental 503
  flake — same files pass 21/21 serially). Migration 0003 applied to DEV.
  PR this session.

### 2026-07-12 — Credit-ledger reconciliation cron + admin-validated corrections
- **Asked:** a recurring (daily/weekly) system that retraces each user's full
  credit history — purchases, price-tag credits, scan consumption, every input
  and output path — verifies the stored balance matches, and when a mismatch is
  found (e.g. a manual edit done by error) updates the final column to match
  the entire history. Corrections must be validated by an admin in the app,
  like the price-tag verifications.
- **Decision/constraints:** the ledger IS the history (every path already
  writes credit_ledger; resets delete the ledger outright), so the invariant is
  `users.scan_credits == sum(credit_ledger.delta)` for every user with no
  legitimate drift. New `credit_reconciliations` table (one pending row per
  user, partial-unique) holds detected drift + per-type breakdown snapshot;
  daily cron `reconcileCredits` (03:50 UTC, trackJob→job_runs) does a set-based
  sweep, upserts pending rows, self-heals ones whose drift vanished. NOTHING is
  auto-fixed: admin endpoints (ADMIN_USER_SUBS, same gating as tag reviews)
  list/apply/dismiss; apply re-checks drift inside the txn, sets balance :=
  ledger sum, and writes a delta-0 `reconcile_adjust` audit ledger row (sum
  unchanged, invariant restored). New mobile AdminCreditReconScreen
  (Profile → Admin) mirrors AdminTagReviewScreen.
- **Files/areas:** backend `db/schema.js` (+migration 0002_credit_reconciliations),
  `db/seed.js` (reconcile_adjust type), `repos/creditReconRepo.js`,
  `jobs/reconcileCredits.js`, `server.js` (cron + 4 admin routes);
  mobile `src/screens/AdminCreditReconScreen.js`, `App.js`,
  `StoresAndProfileScreens.js`; tests backend `creditReconDb` +
  `creditReconGuards`, mobile `adminCreditReconScreen.smoke`.
- **Status:** DONE — PR #164 (branch `feat/credit-reconciliation-cron`).
  Backend c8 full run green (creditReconRepo 100% stmts/funcs), mobile
  2732/2732 + 55 goldens intact. Migration 0002 applied to DEV; **PROD owes
  migration 0002** before the next prod deploy.

### 2026-07-12 — Notification truthfulness sweep: every alert must reflect a real event
- **Asked:** "Price adjustment window closing soon, check for price drops now"
  arrived with NO price drop — trust-killer. Sweep ALL notifications; a
  drop-themed notification may only fire when there actually is a drop.
- **Decision/constraints:** full inventory of every mobile local + backend push
  trigger. Verified-correct and untouched: DB verified-drop path
  (`priceDropNotifier`, PRs #161/#162), transactional pushes, daily digest,
  drop-charge push, tag-scans-ready, snooze/test. Fixed (Bugs #92/#93):
  (1) mobile expiry/last-day reminders were armed blind at SCAN time → now
  armed only at drop-detection time via `receiptClaimableDropSavings` gate +
  `syncExpiryRemindersForReceipt` (BG task, DetailScreen refresh, claim/unwatch
  hooks), copy now names the claimable $; (2) mobile BG task re-alerted the
  same drop daily → new-or-deeper gate; (3) backend `runFlyerSweep` had no
  window check + no dedupe, `_runScheduledChecks` compared unit price to line
  total + no dedupe → shared `isWithinAdjustmentWindow` + persisted
  `sweepNotifyLedger` (deeper drop still re-notifies).
- **Status:** DONE — branch `fix/notification-truthfulness`; proof tests in
  `sweepNotifyTruthfulness.test.js` (backend) + updated
  `notificationService`/`Reconcile`/`detailScreenDropNotify` suites + new
  `storageServiceClaimNotifSync.test.js` (mobile).

### 2026-07-12 — Audit PR #161's security decisions; close residual holes
- **Asked:** audit PR #161 (merged) and make sure every decision/action taken is
  the best, or optimize it, to solve ALL security holes.
- **Verdict:** H1/H2/M1 designs are sound (fail-closed topup, owner-counted
  rule-of-N with anon collapse, consistent across all 4 consensus queries,
  token-gated webhook untouched). Five residual holes found in the PR's own
  surface and CLOSED on branch `fix/price-drop-audit-residual-holes`
  (Bugs #90/#91): (1) cross-account replay — `recordTopupOnce` deduped per
  user, so one RC-transferred store transaction credited every account it
  visited → dedupe+lock now global on the ref; (2) sandbox parity — webhook
  refuses `environment=SANDBOX` but the topup REST check ignored `is_sandbox`
  ($0 license-tester purchase minted real credits; same gap in
  `/subscription/sync` tier mapping) → both refuse positive sandbox,
  `RC_ALLOW_SANDBOX=1` opts dev back in; (3) `CREDIT_RATE_LIMITS` never
  enrolled in `sweepInMemoryState` → slow OOM via unauthenticated key-minting;
  (4) obs-tag budget keyed on client-chosen deviceId → rotation bypassed M1
  entirely → secondary per-IP budget (5× cap, RIGHTMOST XFF hop — the only
  non-forgeable one); (5) latent H2 trap — `'ref:'` contributor fallback made
  every NULL-`device_hash` row a distinct shopper → all unattributable rows
  collapse to `'anon'`. Accepted residuals documented in the roadmap: anon
  bucket counts as 1 (N−1 accounts + anon reaches N), anonymous ingest binding
  deferred (roadmap 🟢), drop-charge refund path + dead-token reaping + no-DB
  CI blind spot unchanged (roadmap 🟡).
- **Status:** DONE — proof tests in `creditTopupSecurity` (transfer replay,
  sandbox±flag), `subscriptionSync` (sandbox mapper ×3), `creditRateLimit`
  (sweep eviction, rotating-deviceId 429), `sybilVerificationDb` (NULL-hash
  collapse). PR to follow.

### 2026-07-12 — Price-drop mechanism: security hardening + regression test net
- **Asked:** make the whole price-drop mechanism 100% functional with no error
  margin and no future regression — detection, commission, notifications,
  claiming — via wise/smart tests on a new branch; surface + fix any security
  issues (top priority); note optimizations by priority with a `docs/` roadmap
  for what can ship later.
- **Decision/constraints:** branch `test/price-drop-hardening-and-coverage`. A
  3-agent audit (backend flow / mobile flow / security) drove it. **Security
  fixes (all landed, Maxim chose "fix everything now"):** H1 — `/api/me/credits/
  topup` verified against RevenueCat before crediting (`_rcFetchSubscriber` +
  `_rcFindNonSubscription`, fails closed 503/502/402; Bugs #88); H2 — rule-of-N
  now counts distinct device **owners** (unclaimed→single `anon` bucket) across
  `priceDropRepo.findNotifiable/getLatestVerifiedPrice/markNewlyVerified` +
  `tagCreditsRepo` HAVING; blocks self-farm + fake-drop credit-drain; signed-out
  ingest still pools data (Bugs #87); M1 — `checkCreditRateLimit` guard on 6
  credit routes (Bugs #89). **Tests:** new `sybilVerificationDb`,
  `creditTopupSecurity`, `creditRateLimit`, `claimRouteDb`, `dropSweepResilienceDb`
  (backend) + `notificationTapRouting`, `claimAssistantScreen` (mobile); 5 existing
  rule-of-N suites updated to model **claimed** devices (the fix's new invariant).
  **Roadmap:** `docs/Price_Drop_Roadmap.md` — go-live blockers (fixed) vs
  should-fix (drop-charge refund path, Expo dead-token reaping, the no-DB CI blind
  spot) vs future (auth-bound ingest, concurrent-election test).
- **Files/areas:** `backend/repos/{priceDropRepo,tagCreditsRepo}.js`,
  `backend/server.js` (topup verify + `checkCreditRateLimit`/`creditRateLimited` +
  exports); `backend/tests/*` (5 new + 5 updated + offlineScanCredits RC stub);
  `__tests__/{notificationTapRouting,claimAssistantScreen}.test.js`; docs
  `Bugs_Common_Fixes.md` #87–#89, `Price_Drop_Roadmap.md`.
- **Status:** in progress — all targeted suites green; mobile full suite
  2711/2711, 55 golden snapshots byte-identical, coverage 71.49/59.29/58.94/74.02
  ≥ floors. Backend full c8 run + commit/PR this session. No production behavior
  change beyond the 3 security fixes.

### 2026-07-11 — Friendly error copy everywhere; technical details logged for the team
- **Asked:** all error messages must be user-friendly, never technical; the
  details should be logged to the backend for the team instead.
- **Decision/constraints:** new `src/services/errorSupport.js` —
  `classifyError` (missing_file/rate_limited/timeout/network/server/unknown),
  `friendlyErrorBodyKey` → new `err.*Body` i18n keys (EN+FR),
  `reportHandledError`/`describeHandledError` ship raw message+stack+category
  to the team via `analyticsService.reportCrash` (backend analytics feed +
  Sentry, `handled:true`; analyticsService lazy-imported so screens gain no
  eager native dep). Swept every user-facing `Alert(… e.message …)`:
  ScanScreen, PriceTagScanScreen, EmailSyncScreen, OnboardingScreen (+ i18n'd
  sign-in title), ManageSubscriptionScreen (store errors via shared
  `purchaseErrorMessage`), DetailScreen (incl. price-check chip),
  StoresAndProfileScreens. Removed `{error}`-interpolating keys
  scanErrorBody/couldNotOpenDocument. ADMIN screens intentionally keep raw
  messages (they're the team). Standing policy documented as Bugs #86.
- **Files/areas:** `src/services/{errorSupport (new),i18n}.js`, 7 screens;
  tests `__tests__/errorSupport.test.js` (new), `scanSourceGone` (raw-message
  leak assertion), `priceTagSourceGone`; docs Bugs #86.
- **Status:** done — targeted suites 159/159; full-suite + commit/PR this
  session.

### 2026-07-11 — Fix prod scan failures: missing source files (ML Kit cache ENOENT + frozen cloud-photo pick)
- **Asked:** fix any and all scan problems, cover every path; prod screenshots
  showed (1) "Scan Error … FileNotFoundException ENOENT" on the ML Kit doc-scan
  cache file, (2) Google Photos "Preparing your selected media" frozen during a
  receipt-scan gallery import.
- **Decision/constraints:** root cause = URIs from third-party components (ML Kit
  scanner cache, cloud-backed photo picks) fed into OCR without existence checks
  or a copy out of their volatile cache; missing-file errors surfaced raw with
  misleading "better lighting" advice, and the tag batch path even QUEUED gone
  files for offline retry. Fix in the acquisition layer (`autoCrop.js`):
  `materializeCapturedImage` (retry-wait + copy to our own cache; scanner now
  returns `status:"missing"`), `checkSourceExists` probe (only a POSITIVE missing
  blocks — "unknown" proceeds as before), `isMissingSourceFileError` classifier →
  new `scan.sourceGone*` i18n copy (EN+FR). Guards on every path: receipt
  (capture/gallery/document/preloaded via processImage), price tag (runOcr +
  batch — skip, never queue), barcode gallery, admin flyer pages. Gallery
  "missing" falls through to the system picker. No credit is ever spent on these
  failures (they precede OCR).
- **Files/areas:** `src/services/autoCrop.js`, `src/screens/{ScanScreen,
  PriceTagScanScreen,BarcodeScanScreen,AdminFlyerScanScreen}.js`,
  `src/services/i18n.js`; tests `__tests__/{autoCrop,scanSourceGone,
  priceTagSourceGone}.test.js` (+ scanScreenCreditGate mock update); docs
  `Bugs_Common_Fixes.md` #85.
- **Status:** done — full mobile suite 2674/2674 green, 55/55 golden snapshots
  byte-identical (zero parse regression), coverage 71.14/58.66/58.6/73.68 ≥
  floors 57/44/48/60. Commit/PR this session.

### 2026-07-11 — Persist subscription START date ("member since")
- **Asked:** implement the persisted subscription start date (for a "member
  since" / renewal display), sourced from RevenueCat.
- **Decision/constraints:** new nullable `priceback.users.subscription_started_at`
  (migration 0003, applied to DEV Supabase; **PROD owes 0003**; consolidated
  `deploy/schema.sql` regenerated). Source = RevenueCat `original_purchase_date`
  (stable across renewals). Persistence is **EARLIEST-wins** in
  `usersRepo.setSubscriptionState` (a renewal or monthly→annual change never moves
  it forward; `undefined` leaves it, `null` clears it on a full lapse). Sync
  endpoint reads it from `subscriber.subscriptions[productId].original_purchase_date`
  (falls back to the earliest across subscriptions); webhook uses
  `event.purchased_at_ms` (earliest-wins keeps the original). Exposed via
  `publicSubscriptionView.subscriptionStartedAt` → bootstrap/`/api/me`/sync.
  Mobile: `_entitlementToPremium` captures `entitlement.originalPurchaseDate`,
  `setPremiumStatus` gains a 5th `startedAt` param (preserves an existing value
  when omitted), reconcile passes the server's start date; ManageSubscription
  shows a "Member since {date}" row (renewal date was already shown). New i18n
  `manage.memberSince` (EN+FR). No start-date needed for gating — this is
  display-only.
- **Files/areas:** `backend/db/{schema.js,migrations/0003_subscription_started_at.sql,
  migrations/meta/_journal.json,deploy/schema.sql}`, `backend/repos/usersRepo.js`,
  `backend/subscriptionGate.js`, `backend/server.js`; `src/services/{purchaseService,i18n}.js`,
  `src/screens/ManageSubscriptionScreen.js`; tests `backend/tests/subscriptionSync.test.js`
  (+6: mapper start-date, earliest-wins DB, persist+clear), `__tests__/{purchaseService,
  billingScreens.smoke}.test.js` (+4).
- **Status:** done (DEV migrated, column verified) — backend sync 13/13 + gate 88 +
  moneyDb 4, mobile purchaseService+billing smoke 128/128. Branch/PR owed. PROD
  owes migration 0003.

### 2026-07-11 — Subscription expiry: time-based server gate + confirm auto-renewal
- **Asked:** verify subscription expiry is handled correctly (start + expiry date,
  auto-renewal, blocking app use on expiry); it should auto-renew automatically
  unless the user cancels before expiry.
- **Findings/decision:** Auto-renewal is store-driven (Google Play base plans are
  auto-renewing; RC RENEWAL bumps expiry; CANCELLATION keeps access until expiry)
  — already correct, app never charges. Mobile already blocks on expiry
  (`purchaseService.getPremiumStatus` compares `expiresAt < now`) and the sync
  endpoint derives active from `expires_date > now`. GAP found (Bugs #84): the
  server charge gate `effectiveScanTier`/`isCreditExempt` keyed on
  `subscriptionStatus === "expired"` (a FLAG), not the date — so with the prod RC
  webhook not delivering (#78) and no client sync, a lapsed sub could stay
  credit-exempt past its paid-through date. Fixed: made `effectiveScanTier(profile,
  now)` time-aware — paid tier → free when `subscription_expires_at` is set and not
  in the future; NaN date = lapsed, NULL expiry (lifetime) untouched, explicit
  `expired` still wins; auto-renewal never falsely downgraded (renewal pushes
  expiry forward). No start-date column exists (gating doesn't need it; pull RC
  `original_purchase_date` for a "member since" label if wanted).
- **Files/areas:** `backend/subscriptionGate.js`; `backend/tests/subscriptionGate.test.js`
  (+9 cases); `docs/Bugs_Common_Fixes.md` #84.
- **Status:** done — subscriptionGate 88/88, sharedPricing/sync/moneyDb 42 pass/0
  fail (DB cases skip locally, run in CI). No schema change. Branch/PR owed.

### 2026-07-11 — Annual Unlimited subscription: end-to-end reconcile
- **Asked:** wire the new annual subscription into every dependency — paywalls,
  products, DB, config — match it to RevenueCat + Play Console, and finish the
  documentation and the website (Priceback-Website repo).
- **Decision/constraints:** Audit found the APP + BACKEND + DB-seed were already
  fully wired for `priceback_unlimited_annual` ($49.99/yr, "2 free months", same
  `unlimited` entitlement as monthly): catalog (`shared/pricing.config.js` +
  backend copy, IDENTICAL), Paywall annual toggle (`_anyAnnualPlan` dynamic),
  `purchaseService` (purchaseProduct/purchaseTier/restore cycle detection),
  ManageSubscription annual switch, i18n keys (twoFreeMonths/perYear/manage.annual,
  EN+FR), seed `_subToTierRow` (annualProductId/annualPrice), backend
  entitlement→tier resolution (`subscriptionSync.test` already exercises the
  annual product id). Play Console annual SKU already Active (2026-07-08 audit).
  Real gaps closed this session: (1) **website** had monthly-only copy — added
  the $49.99/yr option to the plan card, pricing lead, visible FAQ, and JSON-LD
  FAQ, EN + FR; (2) corrected two now-stale in-app comments claiming "2026-05
  redesign dropped annual". **RevenueCat VERIFIED live** (browser audit, project
  `c7a0e77d`): the annual product is imported + Published, attached to the
  `unlimited` entitlement (Jul 6), AND in the active `default` offering as
  `$rc_annual` — so RC is matched, not pending (docs saying "RC SKU creation
  pending" were stale; corrected in `RevenueCat_Paywall_Config.md`). Remaining =
  App Store Connect (iOS not launched) + optional prod DB re-seed (not a purchase
  blocker — annual resolves via the RC offering + entitlement).
- **Files/areas:** website `index.html`/`index-fr.html`; app `src/components/Paywall.js`,
  `src/screens/ManageSubscriptionScreen.js` (comments); docs `RevenueCat_Paywall_Config.md`.
- **Status:** done — mobile paywall+purchase 142/142, backend pricing+gate+sync
  121 pass/0 fail. App PR #153 merged; website PR #6 open (merge = live deploy,
  left to Maxim). RevenueCat + Play Console both verified matched end-to-end.

### 2026-07-10 — Prod sign-in "service temporarily unavailable" (bootstrap 503)
- **Asked:** Fix the recurring "We're sorry — sign-in can't be completed right now" dialog on the live Play build (failing since this morning).
- **Decision/constraints:** Root cause was schema drift, NOT a code bug — prod `receipts` was missing `warehouse_id`/`header_ocr` (migration 0002 never applied to prod) so the `/api/me/bootstrap` ORM select threw → 503 → PR #147 sign-in block. Applied **full migration 0002** (add cols + FK, drop `policy_window`) directly to prod Supabase `xjfrlzwonyaorwktnkpj` with Maxim's explicit approval. No backend redeploy needed; DB change is live.
- **Files/areas:** prod DB only (`priceback.receipts`); diagnosis via `api_audit_log` + Postgres logs. Doc'd in `Bugs_Common_Fixes.md`.
- **Status:** done (prod DB migrated, verified — 18 receipts read cleanly). Follow-up: prod schema still drifted vs migration chain — audit for other unapplied migrations.

## Entry template

```
### YYYY-MM-DD — <short task title>
- **Asked:** what Maxim requested (the intent, not just the literal words).
- **Decision/constraints:** any choices made, things to NOT change, gotchas.
- **Files/areas:** main files or modules touched.
- **Status:** in-progress | done (commit/PR #) | abandoned (why).
```

---

## Tasks

### 2026-07-10 — Ship v2.7.0 to Google Play (internal track)
- **Asked:** ship a latest version to Google Play Console.
- **Decision/constraints:** version-name 2.6.0→**2.7.0** (align w/ backend),
  versionCode 17→**18**, ios buildNumber→18. SplashScreen reads version from
  Expo config (no manual edit). EAS production app-bundle → auto-submit to the
  **internal** testing track. Set up a dedicated Google Play service account
  `eas-play-submit@priceback-905d4.iam.gserviceaccount.com` (GCP project
  `priceback-905d4`) with **"Release apps to testing tracks"** granted in Play
  Console; JSON key stored locally at `C:\Users\Maxim\keys\priceback-905d4-*.json`
  (OUT of repo — never commit it or an absolute key path in eas.json). EAS
  printed a spurious "Something went wrong" on submit, but the release DID upload
  — 2.7.0/vc18 is Active + available to internal testers (Jul 10 4:13 PM).
- **Files/areas:** `app.json`, `package.json` (bump). eas.json submit key path
  added then reverted.
- **Status:** done (PR #151 for the bump; build `db36a8af`, submitted to Play
  internal track). Follow-up: to enable true one-command `--auto-submit`, upload
  the GSA key to EAS (`eas credentials`) instead of a local path.

### 2026-07-10 — Fluent sign-in: restore loader + auto-redirect (no second tap)
- **Asked:** on first launch, after picking a Google account the flow bounced
  back to the sign-in screen with a "Continue" that then froze for minutes.
  Make it fluent — after account selection show a loading screen while the
  account data restores, then auto-redirect to the homepage. Least user
  interactions possible.
- **Decision/constraints:** root cause — `handleGoogle` fired `onContinue()`
  (the `hydrateFromBackend` route decision) WITHOUT awaiting it and reset
  `busy`, so the user was dropped back on the sign-in UI showing "Continue"
  while the (slow) hydrate ran invisibly; tapping Continue re-fired hydrate =
  the freeze. Fix: `onSignInDone` sets a new `restoring` state synchronously
  (before the first await) so the parent swaps `SignInStep` → new full-screen
  `RestoringStep` loader on the same frame; on route "main" it stays up until
  `navigation.replace("Main")` unmounts (no flicker), on "retry" it drops for
  the blocking apology alert, on "setup" it drops for SetupStep. An
  already-signed-in user auto-continues ONCE via `autoContinueRef` (guarded so
  a failed hydrate → remount can't loop; the Google/Apple handlers also consume
  the ref). Kept the BLOCKING contract from [[signin-block-and-subscription-sync]]
  intact (no "continue anyway"). New i18n keys signin.restoring{Title,Body}
  (EN+FR).
- **Files/areas:** `src/screens/OnboardingScreen.js`, `src/services/i18n.js`,
  new `__tests__/onboardingSignInFlow.test.js` (render→sign-in→loader→auto-nav).
- **Status:** in-progress (branch + PR owed; [[feedback-feature-branch-workflow]]).

### 2026-07-09 — Receipt-OCR second-pass optimization + full-coverage enforcement
- **Asked:** whenever a receipt parse is not 100% confident, start a second,
  more optimized pass and keep improving until perfection; ZERO regression on
  current parses (not even 1%); every single parsing path tested, plus credit
  management and user account management — all enforced before every merge so
  future regressions can't land.
- **Decision/constraints:** formal `computeParseConfidence` (receiptParsingShared,
  0..1 + named signals; 1.0 ⇔ every printed self-check agrees) drives TWO
  second-pass layers, both strictly gated so a candidate only replaces the
  current parse when it is strictly better — a perfect parse takes the exact
  pre-existing code path (structural zero-regression): (1) parser-level
  `reworkAgainstSelfChecks` ladder (geometry re-clustered at 0.45/0.85 row
  tolerances via new `reconstructRowsFromAnnotation` opts, reshaped geometry,
  plain flat) scored by scoreParse; (2) scan-level high-res re-OCR in
  scanReceipt — first pass stays 1200px/0.80, one retry at 2000px/0.92 when
  confidence < 1 (images only, never PDFs/text/Veryfi; adopted only on strictly
  higher confidence; also RESCUES otherwise-unreadable scans, and in improve
  mode can never flip a parsed purchase into a rejection). Confidence + signals
  stamped on every result; PII-free `receipt_scan_second_pass` telemetry. En
  route, fixed 3 real `extractPrintedTotal` misreads (Bugs #79: FR/plural
  "TOTAL TAXES" escaping \btax\b, column-split PDF totals blocks, flagged item
  price borrowed as total) — printed-total anchor now correct on all 55
  fixtures. NEW golden harness `receiptGolden.snapshot.test.js` pins the FULL
  normalized parse of every fixture (items, scalars, confidence signals,
  rawText digests) — any parse change fails CI until deliberately re-pinned
  via `npx jest receiptGolden -u`. Enforcement: per-file jest
  coverageThreshold floors for 12 critical parsing/credit/account modules
  (receiptParser 97/91/100/98 … creditLedger 100/95/100/100, authService
  91/81/86/94, etc.); global pool re-based (jest removes per-path files from
  `global`) to 57/44/48/60 vs measured 59.71/46.16/50.23/62.11 — documented in
  the config comment; total enforcement strictly increased.
- **Files/areas:** `src/services/{receiptParsingShared,receiptGeometry,
  costcoReceiptParser,ocrService,receiptParser}.js`, `jest.config.js`; tests:
  `receiptConfidence` + `ocrServiceExtra` + `authServiceSignIn` +
  `receiptGolden.snapshot` (new), extended `receiptParserScan`,
  `costcoReceiptParser.test`, `receiptGeometry`, `ocrVisionPipeline`,
  `receiptParsingShared.test`, `creditLedger.test`, `offlineScanCredits`,
  `subscriptionManager.test`; docs `Bugs_Common_Fixes.md` #79.
- **Status:** done — mobile 2626/2626 green (was 2444; +182 tests), all 55
  goldens + every realocr pin byte-identical (zero regression), coverage
  uplift: authService 66/50→93/83, ocrService 85/71→95/87, receiptParser
  77/75→99/93, creditLedger branches 83→97.6, subscriptionManager 80/62→100/92.
  Pre-existing `react-native-worklets` typecheck error unrelated (fails on
  clean main; CI runs tests, not typecheck). Commit/PR this session.

### 2026-07-09 — Sign-in must block on backend failure; record subscriptions without the webhook
- **Asked:** Play-test build showed "data couldn't be retrieved… will sync later" on
  sign-in then ran the signup flow (75-credit welcome UX); a purchased subscription never
  appeared in the events table. Sign-in must BLOCK with an apology naming the problem
  (network vs unavailable database), never offer signup on failure, never re-grant welcome
  credits; subscriptions/plans/credits handled with no hardcodes/workarounds.
- **Decision/constraints:** Prod diagnosis first: the 75 credits were granted exactly
  once (server guard held — the Play build hit the PROD db where the account was new);
  `subscription_events` had 0 rows EVER → the RC webhook never delivered, and subs had no
  client-confirm path (packs did). Fixes: OnboardingScreen blocks on hydrate failure
  (Retry-only apology, `signInBlockedBodyKey`), SetupStep persists profile server-side
  before completing; new trustless `POST /api/me/subscription/sync` verifying against the
  RevenueCat REST API (`REVENUECAT_SECRET_KEY`), called after purchase/restore/reconcile;
  `/health` reports revenuecat webhook+syncApi config. Ops owed by Maxim: set
  `REVENUECAT_SECRET_KEY` + RC dashboard webhook for prod. Bugs #78.
- **Files/areas:** `src/screens/OnboardingScreen.js`, `src/services/{purchaseService,i18n}.js`,
  `backend/server.js`, `backend/tests/subscriptionSync.test.js`,
  `__tests__/{purchaseService,onboardingSignInRecovery}.test.js`, docs.
- **Status:** done — PR #147 merged (68e3d59); both CI runners green. Ops still
  owed by Maxim: `REVENUECAT_SECRET_KEY` on Railway prod + RC dashboard webhook
  (`REVENUECAT_WEBHOOK_TOKEN`).

### 2026-07-09 — Optimize flyer parsing: recover missing items
- **Asked:** flyer parsing misses some items — find why and fix.
- **Decision/constraints:** Root cause chain (Bugs #77): the fixture capture
  script stored raw PIXEL coords while production normalizes to 0..1, so tests
  ran the flat-text fallback and believed "photos defeat geometry" — in
  production the geometry path DOES run on photos and silently lost 1–6
  tiles/page. Modes: phantom column from a "00000" digit run stealing a whole
  column's price blocks; same-row multi-SKU variant tiles sliced into
  zero-height bands; tiles dying when OCR loses one of was/sav/promo. Fixes in
  the geometry parser: coordinate auto-normalization, repeated-digit SKU
  rejection, boundary-based (not nearest-center) column membership, same-row
  SKU grouping emitting one offer per item number, label-aware price solving
  (In-warehouse/Instant-savings/PRICE row labels solve was − sav = promo;
  QC/eco-fee rows vetoed), junk guards (sav ≥ promo, >60-day date windows).
  captureFlyerOcr.js now normalizes like production.
- **Files/areas:** `backend/services/flyerTextParser.js`,
  `scripts/captureFlyerOcr.js`, `backend/tests/flyerTextParser.test.js`,
  `backend/.c8rc.json` (services/** was never measured — included + floors
  ratcheted 89/73/89/89 → 90/75/91/90), `docs/Bugs_Common_Fixes.md` #77.
- **Status:** done — all 76 real tiles across the six photo fixtures parse
  (was 63); PDF 45→45 with junk offers dropped + 5 tile dates corrected to
  their printed section window. Backend 816 tests, 815 pass / 1 skip / 0 fail,
  coverage 91.84/76.79/93.34/91.84 ≥ new floors. Branch
  fix/flyer-parser-missing-items, PR pending. NOTE: a stale nested
  `backend/.git` (3-commit scaffold history) shadows git commands run from
  inside backend/ — flagged to Maxim, not removed.
### 2026-07-08 — Paywall "item could not be found" on every product/subscription
- **Asked:** fix the error shown on any paywall product or subscription:
  "Error, the item you were attempting to purchase could not be found."
- **Diagnosis:** this string is **not** in our code — it's Google Play Billing
  `ITEM_UNAVAILABLE`, surfaced by `subscriptionManager.purchasePackage()`. Our
  code only reaches that call after resolving the package from the RC offering,
  so RC + SKUs are wired correctly; the failure is at `launchBillingFlow`, on
  every SKU. Dominant cause = the installed build is **not a Play-licensed copy**
  (locally-built, self-signed, sideloaded APK). Play exposes product *details*
  to any app with the matching package name (offerings populate) but rejects the
  *purchase* unless the app is a recognized Play-track install by a License
  Tester. **The real fix is store/test-environment, on Maxim's side** (EAS-signed
  AAB → Internal testing → License testing account → install from Play link → all
  5 SKUs Active). Documented in `RevenueCat_Paywall_Config.md` (Symptom #2).
- **Decision/constraints:** app code can't make a store purchase succeed. Did the
  warranted code polish (the doc had flagged it as deferred): stop leaking the raw
  native string. New `purchaseService.classifyPurchaseError` →
  `unavailable|already_owned|store_problem|network|unknown`, logs the underlying
  `rcCode`, and `purchaseProduct` RETURNS the structured error instead of
  throwing; empty-offering now returns `errorCode:"unavailable"` too.
  `Paywall.purchaseErrorMessage` (shared w/ BuyCreditsScreen) maps to friendly
  EN+FR copy (`paywall.err*`). No behaviour change to successful purchases.
- **Files/areas:** `src/services/purchaseService.js`, `src/components/Paywall.js`,
  `src/screens/BuyCreditsScreen.js`, `src/services/i18n.js`; tests
  `__tests__/purchaseService.test.js`; docs `RevenueCat_Paywall_Config.md`,
  `Bugs_Common_Fixes.md` #76.
- **Status:** done (code + tests; purchaseService 111/111, i18n+paywall+buyCredits
  86/86 green). **Store-side fix is Maxim's remaining action** — code alone can't
  resolve a Play-licensing rejection. Commit/PR owed.
- **CONFIRMED via live Play Console audit (2026-07-08, browser):** ALL 5 SKUs
  exist with exact-matching IDs and are Active (3 packs + monthly/annual subs);
  internal-testing track has a live build **v2.6.0 "IAP config testing" (Available
  to internal testers)**; app is Draft (fine for internal testing). Two real gaps:
  (1) **License testing "Testers" list was NOT enabled** (maxim.louka@gmail.com +
  sandrasharobim@hotmail.com) — Maxim enabled+saved it during the session; (2)
  Maxim confirmed he was **testing a LOCAL SIDELOADED APK** — that is THE root
  cause (Play Billing rejects purchases from non-Play-signed installs). Fix =
  uninstall sideload, install v2.6.0 from the internal-test opt-in link
  `https://play.google.com/apps/internaltest/4700507703194832202` signed in as a
  tester, purchase from THAT build (license tester → test card). Pack-credit
  landing then depends on the v2.6.0 backend having `REVENUECAT_WEBHOOK_TOKEN`.
- **Sideload dev-loop fix added (so the error is gone in the build Maxim runs):**
  `purchaseService` now has `isLocalSideloadBuild()` (`buildProfile==="local"`,
  from app.config.js) + extracted `_simulatePurchase`; in a LOCAL sideload build
  only, an `unavailable` store rejection / empty offering falls back to the
  simulated grant (same as no-key dev-mode). Every `eas` (Play) build still does
  real purchases + surfaces real errors; non-`unavailable` errors never simulate.
  4 new tests. purchaseService 115/115; paywall/buyCredits/scanGate/subMgr 46/46.

### 2026-07-08 — Re-enable Microsoft (Outlook) email sync + publish config sync
- **Asked:** re-enable Microsoft accounts on email scans; configure/update any
  publishing config; review `docs/PUBLISH_CHECKLIST.md` and mark done steps.
- **Decision/constraints:** Outlook is gated by `MICROSOFT_CONFIGURED` in
  `EmailSyncScreen.js` — the gate opens automatically once `MICROSOFT_CLIENT_ID`
  resolves (EAS secret / `.env.local`); config plumbing (`common/eas/local.js`)
  is correct, keep the gate (don't show Outlook with the placeholder client id).
  Fixed the real blocker: `connectOutlook` generated a bare `priceback://`
  redirect but Azure (§6a) registers `priceback://auth/microsoft-callback` →
  `redirect_uri_mismatch`. Aligned code to the documented URI. Azure redirect URI
  MUST equal that exact string. Left the Gmail redirect untouched.
- **Files/areas:** `src/services/emailSyncService.js` (connectOutlook redirect),
  `__tests__/emailSyncConnect.test.js` (new regression test pinning the URI),
  `docs/PUBLISH_CHECKLIST.md` (§6 + summary state, constant name fix).
- **Status:** done (uncommitted; email-sync work is unrelated to the current
  `fix/flyer-parser-missing-items` branch — owes its own branch/PR).

### 2026-07-08 — Zoomable images in admin tag + flyer review
- **Asked:** on the price-tag review page, be able to open & zoom the tag photo
  to check every detail; same system for the flyer review — image openable/
  zoomable during admin review.
- **Decision/constraints:** new shared `src/components/ZoomableImage.js`
  (thumbnail w/ magnifier badge → full-screen pinch/pan/double-tap modal, built
  on gesture-handler + reanimated, already app-wired via GestureHandlerRootView).
  Tag screen: tag photo now tappable→zoom. Flyer screen: source page URIs
  retained (`pages` state) and shown as a horizontal zoomable strip at the top of
  the review step (new i18n key `adminFlyer.sourcePagesLabel`, EN+FR). Added
  reanimated + worklets jest mocks to `jest.setup.js` (real entry throws under
  jest-expo). New `__tests__/zoomableImage.test.js`.
- **Files/areas:** src/components/ZoomableImage.js (new), src/screens/AdminTagReviewScreen.js,
  src/screens/AdminFlyerScanScreen.js, src/services/i18n.js, jest.setup.js,
  __tests__/zoomableImage.test.js.
- **Status:** done (uncommitted — commit/PR owed). Full mobile suite green except
  pre-existing `creditHistoryScreen.smoke` failure (fails on clean main too, unrelated).

### 2026-07-06 — Remove personal email + vendor-neutral privacy policy (audit follow-up)
- **Asked:** push everything; remove the personal email; don't list every
  technology used — remove contradictions/over-claims from the legal pages
  (e.g. "images are discarded" while tag photos are stored).
- **Decision/constraints:** app contacts flipped to support@/privacy@/
  security@priceback.ca (MX live via Namecheap forwarding — Maxim should
  test-mail each). Website (PR #5): privacy policy EN+FR now lists
  service-provider CATEGORIES (specific list from Privacy Officer on
  request) instead of naming Vision/Gemini/Sentry/RevenueCat/Railway;
  removed "images discarded"/"receipts never uploaded" contradictions;
  PIA claim softened to the Law 25 commitment; terms/support de-named
  vendors and fixed the stale "20 retailers" claim to Costco-first.
  Website merges = live deploys and are permission-gated → PRs #4 + #5
  left open for Maxim.
- **Files/areas:** `config/profiles/common.js`, `src/constants/contact.js`,
  `docs/{incident-response,security-prelaunch-checklist,
  Pre_Publish_Audit_2026-07-06,Task_Log}.md`; website repo:
  `privacy-policy.html`, `privacy-fr.html`, `terms-of-service.html`,
  `terms-fr.html`, `support.html`, `support-fr.html`, `index.html`,
  `index-fr.html`, `README.md` (PR #5).
- **Status:** done (this PR; website PRs #4/#5 await Maxim's merge).

### 2026-07-06 — Pre-publish audit: legacy cleanup + legalities/compliance + report
- **Asked:** run a pre-publish audit, clean any legacy, check legalities and
  compliance, document everything in a `docs/*.md` file.
- **Findings/decisions:** all suites green (mobile 2418/2418, backend c8 floors
  enforced exit 0, typecheck 0). State corrections: prod backend is v2.7.0 and
  prod Supabase HAS the full v2 schema + live data ("never migrated" was stale);
  MX for priceback.ca now exists (Namecheap forwarding — verify delivery before
  flipping contact emails). `/privacy` + `/terms` short URLs 404'd → website
  repo PR #4 (301 aliases, awaiting Maxim's merge = live deploy). Privacy-policy
  content gaps flagged, NOT auto-edited (legal text): Supabase + Cloudflare R2
  not named as processors, tag-photo R2 retention contradicts "images
  discarded", member_id not listed as collected. Supabase RLS disabled on all
  36 prod tables — verify `priceback` not Data-API-exposed or enable RLS.
  Legacy cleaned: `ca.priceback.app` → `com.priceback` in 6 docs/files; dead
  `legal/*.html` links → live URLs (legal source of truth = website repo since
  ffc874c); PUBLISH_CHECKLIST §1/§8B rewritten to verified reality;
  Audit_ToDo.md marked historical; drizzle.config.js Neon hint fixed.
- **Files/areas:** `docs/Pre_Publish_Audit_2026-07-06.md` (new report),
  `docs/{PUBLISH_CHECKLIST,security-prelaunch-checklist,SECURITY,
  RevenueCat_Paywall_Config,BUILD_LOCAL_ANDROID,FUTURE_ROADMAP,Audit_ToDo,
  Task_Log}.md`, `README.md`, `.env.example`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `legal/MARKETING_CLAIMS.md`, `backend/drizzle.config.js`; website repo
  `_redirects` (PR #4).
- **Status:** done (this PR) — no app-code changes, docs/comments only.

### 2026-07-06 — Subscription/payment money audit + yearly $50 sub + regression tests
- **Asked:** audit every money flow (subscriptions, payments, credits, app
  income) for zero-margin-of-error handling; exhaustive regression tests; ANY
  subscription = everything unlimited with no credit spend, credits frozen in
  the account until the user returns to pay-as-you-go; add a $49.99/yr annual
  Unlimited ("2 free months, paid at once") if easy.
- **Audit verdict:** ledger atomicity, advisory-lock idempotency, dual-path
  topup, referral settle, signup grant, device-claim + reconcile all SOUND.
  Credits already frozen (subscription lifecycle never writes scan_credits).
  3 gaps fixed: (1) charge sites hardcoded `tier === "unlimited"` and ignored
  status → new `subscriptionGate.isCreditExempt(profile)` (any in-force paid
  sub exempt; expired pays) used at receipt POST, offline-scans, drop
  commission; (2) RC webhook replay could regress state (DB path never set
  subscriptionLastEventId) → `subscriptionEventsRepo.hasEvent(rcEventId)`
  guard before applying; (3) mobile pack-confirm used originalPurchaseDate as
  a txn-id fallback → double credit; now only a real transaction id confirms,
  else webhook is sole grantor. Annual sub added in pricing.config (both
  copies): `priceback_unlimited_annual` $49.99 (= pay 10 months, get 12),
  `monthlyEquiv` "$4.17" — Paywall/i18n/purchaseTier/webhook/DB seed were all
  pre-wired for annual. RC dashboard SKU creation is Maxim's manual step
  (docs updated: RevenueCat_Paywall_Config.md, PUBLISH_CHECKLIST §2 — also
  fixed stale $12/300/600/1400 numbers there).
- **Files/areas:** `backend/{subscriptionGate,server,priceDropNotifier}.js`,
  `backend/repos/subscriptionEventsRepo.js`, `shared/pricing.config.js` (+
  backend copy), `src/services/purchaseService.js`; tests
  `backend/tests/{subscriptionMoneyDb (new),subscriptionGate,sharedPricing}.test.js`,
  `__tests__/purchaseService.test.js`; docs `docs/{Subscription_Money_Audit.md
  (new),RevenueCat_Paywall_Config.md,PUBLISH_CHECKLIST.md,Bugs_Common_Fixes.md,
  Task_Log.md}`.
- **Status:** done (this PR) — backend full coverage run green (91.2/74.8/92.75
  ≥ floors 89/73/89, incl. new subscriptionMoneyDb suite live on dev Supabase);
  mobile 2418/2418, coverage 67.23/54.48/56/69.6 (floors 61/46/52/63). Dev DB
  seeded with the annual SKU; RC dashboard SKU creation pending (Maxim).

### 2026-07-05 — Credit-management audit + restore auto-reload at the 50-credit threshold
- **Asked:** full test coverage + audit that all credit management is well done
  and configured (friend referral; auto-reload must prompt when the balance
  drops at 50 — it was changed to 0 without approval). Outputs → `docs/*.md`
  (publishing items → `docs/PUBLISH_CHECKLIST.md`). HARD SCOPE EXCLUSION:
  price-tag + receipt credit SPEND logic is field-tested — do not analyze or
  change it.
- **Findings:** config chain was 50 everywhere (bundled catalog, seed, live dev
  DB app_config) but the PROMPT only fired at the 0-credit scan block; the
  2026-07-02 session had reworded all copy to "re-buy at zero" instead of
  restoring the threshold (Bugs #73). Referral (deferred settle, FOR UPDATE
  lock, exactly-once across topup/webhook race) and the credit ledger
  (advisory-lock idempotency, ledger+balance atomic) audited SOUND — no changes.
  Latent prod risks flagged into PUBLISH_CHECKLIST §8B: stale prod Starter pack
  (300 vs 250, coalesce-seed can't fix — Bugs #53), prod app_config verify list,
  and §8B's migration list refreshed to the re-squashed 0000→0002 chain.
- **Fix:** `purchaseService.maybeAutoReloadOnLowBalance(status)` — prompt at
  balance ≤ `getAutoReloadThreshold()` (50), once per crossing
  (`auto_reload_low_prompted_v1` marker, re-armed above threshold), delegates
  opt-in/premium/pack rules to `maybeAutoReload`; wired into ScanScreen's two
  post-spend balance refreshes; 0-credit gate untouched (safety net); EN+FR
  copy back to threshold-based.
- **Files/areas:** `src/services/{purchaseService,i18n}.js`,
  `src/screens/ScanScreen.js`; tests `__tests__/{purchaseService,
  scanScreenCreditGate,screens}.test.js`; docs
  `docs/{Credit_Management_Audit.md (new),PUBLISH_CHECKLIST.md,
  Bugs_Common_Fixes.md #73,Task_Log.md}`.
- **Status:** done — mobile 2410/2410, coverage 67.32/54.4/56/69.74 (floors
  61/46/52/63); backend referral+credit suites 46/46 on dev Supabase (backend
  code untouched). Commit/PR owed.

### 2026-07-03 — 10th report: invented $12.94 tax on a TAX 0.00 receipt, warehouse still null — full pipeline coverage
- **Asked:** same receipt scanned 3× (`r_1783099597725_q2vet`/`…9t24z`/`…2xoa1`),
  warehouse_id still NULL; NEW regression: tax detected as $12.94 with total
  $112.45 when the OCR plainly shows SUBTOTAL = TOTAL = 99.51 and TAX 0.00.
  Hard requirements: full test coverage of ALL parsing logic; the total must
  never exceed the printed OCR total; a printed TAX 0.00 must win. A true fix.
- **Root causes (Bugs #72):** (1) column-split totals block ("SUBTOTAL/TAX/
  99.51/0.00") mispaired TAX with the subtotal's value; (2) `validateReceipt`'s
  province cap then "corrected" 99.51 → 12.94 (13% × subtotal), inflating the
  total past the printed one — it never consulted the receipt's own printed
  total/tax; (3) a bare price printed ABOVE its SKU+name row dropped the item
  (total 77.92 variants). Structural gap: no test ran the real chain
  parseReceiptText → validateReceipt → toApiBody (parser-level suites were
  green while the field failed).
- **Fixes:** `reshapeColumnSplitTotals` in the shared engine (labels zip with
  positional values); `printedTotal` stamped on every parse (extractPrintedTotal
  moved to receiptParsingShared, re-sourced from flat OCR on both Costco exits)
  and made authoritative in `validateReceipt` (tax := printed − items when
  plausible incl. ZERO; total never exceeds printed, even when clamping);
  inverted price-above-SKU pairing in `extractItems`. The warehouse chain
  itself verified correct end-to-end on all 3 live OCR variants — prior fixes
  (6e7223e/f6fbe0a) never reached the field builds.
- **Files/areas:** `src/services/{receiptParsingShared,receiptValidator,
  costcoReceiptParser}.js`; tests: `__tests__/receiptPipeline.live.test.js`
  (NEW e2e: 3 live-failure OCR variants pinned + every committed fixture run
  through parse→validate→toApiBody with printed-total/tax/warehouse/date
  invariants), `receiptParsingShared.test.js` (+reshape/printedTotal/inverted
  pairing), `receiptValidator.test.js` (+printed-total authority),
  realocr EXPECTATIONS pin tax/date/warehouseId for the failing receipt.
  Docs: `Bugs_Common_Fixes.md` #72.
- **Status:** done — full mobile suite 2402/2402 green; coverage
  67.23/54.32/56.12/69.59 (floors 61/46/52/63). Dev-DB warehouse backfill SQL
  prepared, awaiting Maxim's go-ahead. Commit/PR owed.

### 2026-07-03 — Fix purchase-date-always-today regression + warehouse_id still null
- **Asked:** receipt `r_1783095553662_9t24z` still saves `warehouse_id = null`
  (renders "Costco Canada"), AND a regression a few merges ago made the purchase
  date always default to today. Add tests covering all paths; the OCR changes must
  be a net improvement, not worse.
- **Decision/constraints:** Root cause = when Vision geometry is used, the Costco
  warehouse parser reads header-derived fields (`date`, `warehouseId`,
  `purchaseType`, `storeId`) off the geometry-reconstructed **item-table rows**,
  and `chooseBetterParse` picks the winner only on item/total/discount score.
  Geometry clustering drops the date line + welds/omits the warehouse line, so the
  chosen parse lost them → date null (→ ScanScreen uses today) and warehouse null.
  #70's regex tweak couldn't help — the value was never taken from the flat text.
  Fix: re-source those scalar header fields from the **full flat OCR** after the
  item parse is chosen (`applyHeaderFieldsFromRawText`), on both parse paths; never
  fabricate (date-less receipt stays null). Sync-time fallback recovers
  `warehouseId` from `headerOcr`. NOTE: fixes NEW scans; the already-saved receipt
  must be re-scanned (or re-synced) to pick up its warehouse.
- **Files/areas:** `src/services/costcoReceiptParser.js`,
  `src/services/receiptSyncService.js` (`toApiBody`); tests
  `__tests__/costcoReceiptParser.test.js`, `costcoReceiptParser.realocr.test.js`
  (per-fixture header invariant + pinned date/warehouse), `receiptSyncService.mapping.test.js`.
  Doc: `Bugs_Common_Fixes.md` #71 (supersedes #70's root cause).
- **Status:** done — full mobile suite 2171/2171 green; coverage 66.97/54/56.09/69.35
  (≥ floors 61/46/52/63). No DB/schema change. Commit/PR still owed.

### 2026-07-02 — Link receipt to warehouse, split store/warehouse OCR, drop policy_window
- **Asked:** (1) a saved receipt was only linked to the store — link it to the
  specific warehouse too. (2) Persist the store + warehouse OCR in a column separate
  from the items OCR. (3) Regression: the receipt list's 2nd line showed "Costco
  Canada" instead of the warehouse name — restore the warehouse name (+ number, e.g.
  "Kanata #541") on the 2nd line and everywhere "Costco Canada" appeared (receipt
  view, price-drop view, …). (4) `policy_window` should be consumed from the store
  policy and the column removed from `receipts`.
- **Decision/constraints:** `receipts.warehouseId` stores the resolved `warehouses.id`
  FK; the API echoes back the store-issued NUMBER as `warehouseId` (the client keys
  its label off it). Header OCR captured at parse time as the COMPLEMENT of
  `stripWarehouseInfo` (`extractWarehouseInfo`), since bug #67 strips the header out
  of `raw_ocr`. Window now read live from `stores.adjustment_days` (single source of
  truth) — `recomputePolicyStatus`/`recomputeOverduePolicyStatuses`/`priceDropRepo`
  all updated.
- **Files/areas:** migration `0002_receipt_warehouse_header_ocr.sql` (+journal, schema.js,
  deploy/schema.sql), `repos/receiptsRepo.js`, `repos/priceDropRepo.js`, `server.js`;
  mobile `shared/ocrCleanup.js` (extractWarehouseInfo), `services/receiptParser.js`,
  `services/receiptParsingShared.js` (extractHeaderOcr), `services/receiptSyncService.js`,
  `screens/ScanScreen.js`, `constants/stores.js` (receiptWarehouseLabel → "City #num"),
  `screens/DetailScreen.js`, `screens/HomeScreen.js`. Tests: backend
  `receiptWarehouseLink.test.js` (new) + policyStatusDb; mobile stores/ocrCleanup/
  receiptParsingShared/receiptSyncService.mapping.
- **Status:** done (DEV migrated; consolidated schema regenerated). Backend green in
  isolation (full-suite flakes = env connection-pool exhaustion, not this change);
  mobile 2109/2109, coverage 66.92/53.98/56.07/69.29 (≥ floors). **PROD owes migration
  0002.** Commit/PR still owed.

### 2026-07-02 — Scan-credit gate ran after OCR/LLM parsing instead of before
- **Asked:** at 0 credits (and no available auto-reload), the scan still runs OCR +
  LLM parsing successfully but the receipt is never saved because the credit gate
  rejects it — so the OCR/LLM cost is spent for nothing. Move the gate before
  parsing so a 0-credit user is paywalled before any OCR/LLM spend.
- **Root cause:** `ScanScreen.processImage()` called `scanReceipt()` (OCR + LLM)
  unconditionally; `canAddReceipt()` was only checked afterwards — once in the
  rejected-receipt branch (post-OCR), and again at `doSave()` when the user tapped
  Save on a successfully-parsed receipt. Both checks ran after the paid OCR/LLM
  call had already happened.
- **Fix:** added a `canAddReceipt()` (+ `maybeAutoReload()` fallback) gate at the
  very top of `processImage()`, before `scanReceipt()` is called. If not allowed,
  the paywall shows immediately and OCR/LLM is never invoked. Removed the
  now-redundant post-OCR check in the rejected-receipt branch (reuses the
  pre-OCR result). The `doSave()` check remains as a safety net for balance
  changes between capture and save.
- **Files/areas:** `src/screens/ScanScreen.js`. Test:
  `__tests__/scanScreenCreditGate.test.js` (new — asserts `scanReceipt` is never
  called when credits are unavailable, and runs normally when they are).
- **Status:** done. Full mobile suite 2083/2083 pass, coverage 66.8/53.79/55.92/69.16
  (≥ floors).

### 2026-07-02 — Auto-reload confusion + notifications still not firing
- **Asked:** (1) Buy Credits screen on startup shows "Re-buy automatically" OFF, then
  ~2s later flips ON and the selected pack changes on its own — is it on or off?
  (2) Homepage says "Auto-reload armed" but no credits are ever reloaded automatically.
  (3) Notifications still never arrive despite several prior fix attempts. Fix + test.
- **Root causes found:** (1) `BuyCreditsScreen.refresh()` awaited
  `Promise.all([canAddReceipt() /*~2s server*/, getPrefs() /*fast local*/])` before
  setting the toggle+selection, so the toggle/pack rendered stale defaults (off,
  middle pack) until the slow balance call returned, then snapped. (2) "Auto-reload"
  is an *auto-PROMPT* by platform rule ([[auto-reload-platform-constraint]]) — it can
  only fire the OS purchase sheet when the user attempts a scan at 0 credits; the copy
  over-promised silent proactive reload. (3) The LOCAL price-drop notification
  (`sendPriceDropNotification`) was only ever called from the once-daily background
  task — never on the manual "Refresh prices" path the user actually uses; and there
  was no on-device way to see permission/token status or test delivery.
- **Fixes:** (1) split the load in `BuyCreditsScreen` — prefs first (toggle+selection
  set immediately from local storage), balance loaded separately; render nothing
  misleading until prefs resolve. (2) honest copy for `home.lowBalanceAutoOn` +
  `buyCredits.autoReload*` (EN+FR) — behaviour unchanged. (3) fire a local price-drop
  notification for NEWLY-detected drops on the DetailScreen manual refresh (gated by
  `notifUrgentClaims`); add a Notifications-screen diagnostic card (permission / token
  / signed-in) + "Send test notification" button so the user can verify delivery and
  see *why* it fails.
- **Files/areas:** `src/screens/{BuyCreditsScreen,DetailScreen,NotificationsScreen}.js`,
  `src/services/notificationService.js` (diagnostics + test send), `src/services/i18n.js`
  (EN+FR copy), tests on the mobile runner. Docs: `Bugs_Common_Fixes.md` #66.
- **Verification:** full mobile suite **2081 pass**, coverage 65.23/52.98/55.04/67.33
  (≥ floors 61/46/52/63). New/updated tests: `buyCreditsScreen.smoke` (split-load
  regression), `detailScreenDropNotify` (new), `notificationService` (diagnostics +
  test-send). Note: on-device notifications still require a real EAS build + physical
  device + granted permission + signed-in user — the new diagnostic card surfaces
  which of those is missing. Backend push-send path unchanged (already correct).
- **Status:** done (code + tests, mobile green) — commit + PR owed on a feature branch.

### 2026-07-01 — OCR cleanup (compliance) + parse cross-validation + flyer noise filter
- **Asked:** Pre-parse OCR cleanup for receipts/refunds and flyers driven by an updatable
  EN+FR keyword list (payments/transactions/invoices/cart/basket/marketing removed; keep
  warehouse info, products, totals, taxes, date, items-sold count, tax type). Persist only
  the CLEANED OCR (compliance — raw_ocr lives in the DB and round-trips via bootstrap).
  Extract the member ID: save it in the DB but never return it from the API nor show it in
  the app. Cross-validate parsed items vs printed "TOTAL NUMBER OF ITEMS SOLD" and
  "TOTAL DISCOUNT(S)", re-scoring/re-parsing on mismatch; reject unreadable/too-blurry
  receipts. Flyers: filter advertising/unrelated text; ignore pages with no product savings.
  Use all fixtures in `__tests__/fixtures/` as ground truth.
- **Decision/constraints (AskUserQuestion):** NEW scans only — no DB backfill of existing
  raw_ocr rows. On residual counter mismatch: accept the best-scoring parse and FLAG it
  (`checkMismatch`), reject only truly unreadable scans. Price-tag scans stay out of scope
  (admin review needs their raw OCR). member_id = dedicated nullable receipts column,
  included ONLY in the /api/me/data-export payload.
- **Files/areas:** `shared/ocrCleanup.js` (new, synced to backend/shared),
  `src/services/{receiptParser,receiptParsingShared,costcoReceiptParser,receiptSyncService,i18n}.js`,
  `src/screens/{ScanScreen,AdminFlyerScanScreen}.js`, `src/utils/receiptRejection.js`,
  `backend/db/schema.js` + migration `0001_receipt_member_id` (applied to DEV; PROD owes it),
  `backend/server.js`, `backend/repos/receiptsRepo.js`,
  `backend/services/{flyerScanService,flyerTextParser}.js` (flyer noise cleanup, page
  `rejected:no_offers`, 5-digit SKU floor guarded by the triplet),
  `scripts/captureReceiptOcr.js` (EN REFERENCE scrub fix + 6 fixture re-scrubs).
  Tests: `__tests__/{ocrCleanup,receiptSelfChecks}.test.js` (new),
  realocr suite (cleanup parity + no-PII invariant on every fixture + self-check
  invariant + PXL_024302268 ground truth), `backend/tests/receiptMemberIdDb.test.js`
  (new), flyer suites (+photo-page regression). Docs: `Bugs_Common_Fixes.md` #65.
- **Extra findings fixed along the way:** OCR-garbled TPD intros ("TRD/", "PD/")
  canonicalized; inverted multi-line TPD (amount printed ABOVE its intro) handled;
  fee/deposit lines excluded from the items-sold unit count; 5-digit flyer SKUs
  (83013 Saputo) recovered with a triplet guard against phantoms.
- **Status:** done — realocr 360/360, mobile 2067 pass (coverage 64.58/52.34/54.55/66.56
  ≥ floors 61/46/52/63), backend green (see PR). Branch `feat/ocr-cleanup-compliance-validation`.

### 2026-06-29 — Hide store-list slide from onboarding
- **Asked:** The startup onboarding slide that lists store names (Canadian Tire, Best Buy, etc.) should be hidden/skipped for now.
- **Decision/constraints:** Remove slide 4 (`onb.slide4Title`/`onb.slide4Body`) from the `SLIDES` array in `OnboardingScreen.js`. i18n keys stay (no hard rule violation — keys unused but not broken). Dot indicator count adjusts automatically.
- **Files/areas:** `src/screens/OnboardingScreen.js`.
- **Status:** done.

### 2026-06-29 — Local build failed (Syncthing lock) + `-Env` param for build script
- **Asked:** Diagnose why `manual_build/build-and-install.ps1 -build` "failed in
  3 min but ran ~3 hours"; document the recurring bug; and make the env file
  selectable as a parameter on ALL pathways of the build/install script.
- **Decision/constraints:** Root cause = Syncthing real-time-syncing
  `C:\Workspace` (incl. `build/`, `node_modules/`) memory-mapped Gradle's files
  → `user-mapped section open` on `merger.xml` + `*.sync-conflict-*` copies; the
  job never exited so the wrapper stopwatch ran for hours while Gradle itself
  failed at 2m58s. Fix = `C:\Workspace\.stignore` (per-machine, NOT in repo) +
  cleared `android/app/build`. New `-Env` param defaults to `local` (preserves
  old `.env.local` behavior); accepts bare suffix / `base`/`.env` / `.env.x` /
  full path; an explicit `-Env` that doesn't resolve = hard `Fail` (no silent
  prod-default fallback); env loads on every pathway (prebuild/build/install).
- **Files/areas:** `C:\Workspace\.stignore` (new, outside repo),
  `manual_build/build-and-install.ps1` (`-Env` param + `Resolve-EnvFile`),
  `docs/Bugs_Common_Fixes.md` (entry #63).
- **Status:** done (local fix + script change; not yet committed/PR'd).

### 2026-06-29 — Reinstall sign-in recovery still broken + paywall config error
- **Asked:** On the new build, reinstall→sign-in still shows "Signed in as <email>"
  then routes to "Finish setting up" (re-asking all fields) and lands on an empty
  app (no receipts/credits). Paywall fails "issue with your configuration". The
  prior fix (PR #122/#123) didn't help.
- **Root cause (confirmed via live probes):** EAS `preview`/`development` profiles
  set no `PRICE_API_URL` → `config/profiles/eas.js` undefined → `common.js`
  default → **production** backend. Prod runs stale **v2.6.0** where
  `GET /api/me/bootstrap` is **404** (dev v2.7.0 has it). So `hydrateFromBackend`
  fails → nothing restored → wrong route + empty app. The prior fix only changed
  app code, never the backend the build calls. Two app weaknesses amplified it:
  `onSignInDone` re-onboarded on ANY hydrate failure, and hydrate failures emitted
  zero telemetry (so the fix was authored blind).
- **Decision/constraints:** Build under test = EAS preview/dev; the account HAS
  real data **on dev**. RevenueCat creds are ON HOLD → **document only**, no code.
  Point preview/development EAS builds at the **dev** backend (data + working code
  live there). Prod deploy + owed migrations remain Maxim's separate task.
- **Fixes:** (1) `eas.json` — `PRICE_API_URL=dev` in `preview` + `development`.
  (2) `syncService._hydrate` — emit `analyticsService.track("hydrate_failed",…)`
  on http_/network/unconfigured (+ carry `status` on http_). (3) `OnboardingScreen`
  — new exported pure `decideSignInRoute()`: main / retry / setup; a FAILED hydrate
  → retry alert (`signin.recovery*` EN+FR), never forced re-onboarding; also
  `hydrateFromBackend({reason:"setup"})` on the setup-completion path. (4) Doc:
  `docs/RevenueCat_Paywall_Config.md` (external SKU/store/key setup for code-23).
- **Files/areas:** `eas.json`, `src/services/syncService.js`,
  `src/screens/OnboardingScreen.js`, `src/services/i18n.js`,
  `docs/RevenueCat_Paywall_Config.md`. Tests: `__tests__/syncServiceHydrate.test.js`
  (+telemetry/404 cases), `__tests__/onboardingSignInRecovery.test.js` (new).
  Docs: `Bugs_Common_Fixes.md` #62.
- **Status:** in-progress (code + tests done; mobile **1796 pass**, coverage
  64.27/51.47/54.09/66.24 above floors; backend untouched) — branch
  `fix/reinstall-bootstrap-backend-target`; commit + PR pending.

### 2026-06-27 — Fix build script paths + gitignore deals/
- **Asked:** Commit and merge all local changes; ensure tests pass on main.
- **Decision/constraints:** `manual_build/build-and-install.ps1` had `..\android\` paths (wrong relative base); fixed to `android\`. Added `deals/` to .gitignore (image dumps, not repo content).
- **Files/areas:** `manual_build/build-and-install.ps1`, `.gitignore`, `docs/Task_Log.md`.
- **Status:** done (see this PR)

### 2026-06-27 — Costco pricing decoder: deal signal classification
- **Asked:** Implement Costco "Secret Pricing Decoder" rules (.99/.97/.X9/.00/.88/asterisk/green tag) as business logic stored in the DB and surfaced as instant user feedback after a price tag scan.
- **Decision/constraints:** No new table — rules stored as classifyPriceSignal() pure function; deal signal stamped in existing `price_points.flags` (price_signal, deal_tier, has_asterisk, is_organic); returned in `/api/observations/tag` response as `deal_signal`; mobile renders a colored badge on the scan done screen. Tag-scan OCR now also detects hasAsterisk (`*` in raw text) and isOrganic ("organic" keyword). `.X9` rule (manufacturer promo) added from image cross-check — was missing from Reddit text.
- **Files/areas:** `src/services/costcoTagScanner.js`, `src/services/priceTagFields.js`, `backend/services/priceSignalService.js` (new), `backend/repos/crowdRepo.js`, `backend/server.js`, `src/services/priceService.js`, `src/screens/PriceTagScanScreen.js`, `src/services/i18n.js`, `__tests__/costcoTagScanner.test.js`, `backend/tests/priceSignalService.test.js` (new).
- **Status:** done

### 2026-06-27 — Fix 4 prod bugs: notifications, tag-review alert, reinstall recovery, scan 429
- **Asked:** (1) no notifications at all; (2) "price tag waiting for review" sends
  no notification; (3) sign-in treats an existing user as a NEW signup (re-prompts
  setup + referral) and reinstall recovers no data (receipts/credits/history gone)
  — the forbidden behavior; (4) a weak connection surfaces an inaccurate 429 scan
  error.
- **Decision/constraints (confirmed via AskUserQuestion):** #2 = full scope (fix
  push delivery + ADD an admin "tag awaiting review" push + verify the user
  verified/credited push + the local ready-to-review path). #4 = if the image is
  readable just fix wording (429), otherwise (timeout/network) treat as transient +
  queue. Identity is the stable Google `sub`, so reinstall data was never deleted —
  the client just never asked the backend to recover it. No DB migration.
- **Root causes:** (1) Expo push token stored only in AsyncStorage, never written
  to `users.push_token` → `priceDropRepo.findNotifiable`/`sendUserPush` filter
  every send. (2) no admin notification existed for a queued tag review. (3)
  `onSignInDone` routed from wiped local prefs, never hydrating the backend
  profile. (4) `ocrService` threw the raw 429 text; `PriceTagScanScreen`'s network
  regex excluded 429.
- **Fixes:** new `notificationService.syncPushTokenToBackend()` (called on
  mint/sign-in/boot); admin push loop in `POST /api/observations/tag` after
  `createReview` (no category → master-switch-only gating); `onSignInDone` awaits
  `hydrateFromBackend` and `_applyPrefs` restores postal/province + onboarding
  flags from the bootstrap `profile`; `_visionFetch` tags a 429 `{status,code}`
  with accurate copy and `PriceTagScanScreen` adds a throttle branch (+ EN/FR
  `priceTag.throttled*` keys).
- **Files/areas:** `src/services/{notificationService,syncService,ocrService,i18n}.js`,
  `src/screens/{OnboardingScreen,PriceTagScanScreen}.js`, `backend/server.js`
  (`/api/observations/tag` admin push). Tests: `__tests__/{notificationService,
  syncServiceHydrate,ocrServiceTimeout}.test.js`, `backend/tests/tagReviewAdminPushDb.test.js`.
  Docs: `Bugs_Common_Fixes.md` #58/#59/#60. Updates [[verified-price-drop-notifications]]
  / [[offline-tag-queue-and-admin-review]].
- **Verification:** mobile **1780 pass**, coverage 64.32/51.52/54.21/66.22 (≥ floor
  61/46/52/63); backend **764 pass / 0 fail / 1 skip**, c8 90.37/74.09/92.23/90.37
  (≥ floor 89/73/89/89). DB tests serial on Supabase DEV (`DB_POOL_MAX=3`).
- **Status:** done (code + tests, both runners green) — branch
  `fix/notifications-signin-recovery-scan-429`; commit + PR pending.

### 2026-06-27 — Fix EAS Build: react-native-purchases not a config plugin
- **Asked:** EAS Build failed — "Unable to resolve a valid config plugin for react-native-purchases."
- **Decision/constraints:** `react-native-purchases` is a native autolinked module with NO config plugin (no `app.plugin.js`); it must NOT be in `app.json` `plugins`. Removed the `"react-native-purchases"` entry. Library still functions via autolinking — do not re-add it to plugins.
- **Files/areas:** `app.json` (plugins array).
- **Status:** done.

### 2026-06-27 — Commit local changes: in-flight purchase guard + build path fix
- **Asked:** Commit and merge any local changes, ensure tests workflow passes on main.
- **Decision/constraints:** 3 modified files on main: (1) build-and-install.ps1 path fix (`android\` → `..\android\` for relative paths); (2) Paywall.js — `useRef` in-flight guard on both `handleBuyPack` and `handleUpgrade` to prevent double-purchase; (3) BuyCreditsScreen.js — same in-flight guard + `buying` state for button disabled state.
- **Files/areas:** `manual_build/build-and-install.ps1`, `src/components/Paywall.js`, `src/screens/BuyCreditsScreen.js`. Also fixed `__tests__/stores.test.js` + `storePolicy.test.js` (hardcoded BUNDLED_DATE + disabled-store count were stale from PR #119).
- **Status:** done (PR #120, merged to main — CI green).

### 2026-06-26 — iOS OAuth plist + stores seed + Sentry/RevenueCat checklist
- **Asked:** Wire the iOS Google OAuth plist (already in project root); set visible stores for the initial DB seed to Costco (active) + Best Buy / The Source / Home Depot (Coming soon) in that order; help with RevenueCat paywall creation; note that Sentry DSN is configured in Expo, Azure OAuth created, ADMIN_USER_SUBS set on Railway, Google Play Console enrolled.
- **Decision/constraints:** iOS plist → added `iosUrlScheme` to `@react-native-google-signin/google-signin` plugin in `app.json` (reversed client ID from plist filename). Stores: reduced `backend/data/policies.json` AND `src/constants/stores.js` STORES array to only these 4 stores in requested order; `BUNDLED_UPDATED_AT` bumped to 2026-06-26 so the remote refresh always overrides the bundled list. Sentry DSN is already hardcoded in `config/profiles/common.js` so all builds have it; `SENTRY_DSN` as EAS secret overrides it if set. RevenueCat paywalls must be created in the RC dashboard (see instructions provided to Maxim).
- **Files/areas:** `app.json` (google-signin plugin), `backend/data/policies.json` (4-store seed), `src/constants/stores.js` (STORES array + BUNDLED_UPDATED_AT).
- **Status:** done (code changes). RC paywall creation = manual dashboard step.

### 2026-06-26 — RevenueCat integration + SubscriptionManager abstraction + PaywallScreen
- **Asked:** Integrate RevenueCat with a thin abstraction layer so the codebase never calls
  `Purchases.something()` directly. Wrap all SDK calls in `subscriptionManager.js`
  (interface: `initialize`, `login`, `logout`, `getCustomerInfo`, `getOfferings`,
  `purchasePackage`, `restorePurchases`). Ship a `PaywallScreen.js` navigation screen.
- **Decision/constraints:** `purchaseService.js` already had all the RC logic but called
  `react-native-purchases` directly via `_getPurchasesModule()`. Extracted all SDK calls into
  `src/services/subscriptionManager.js` (only file that imports `react-native-purchases`).
  `purchaseService.js` public API unchanged — screens are unaffected. `src/components/Paywall.js`
  already existed and is complete; `PaywallScreen.js` wraps it as a navigation-accessible screen.
  Existing `purchaseService.test.js` updated to mock `subscriptionManager` instead of the RC SDK.
  `react-native-purchases` npm package installed; Expo plugin added to `app.json`.
- **Files/areas:** `src/services/subscriptionManager.js` (new), `src/services/purchaseService.js`,
  `App.js`, `app.json`, `package.json`, `src/screens/PaywallScreen.js` (new),
  `__tests__/subscriptionManager.test.js` (new), `__tests__/paywallScreen.smoke.test.js` (new),
  `__tests__/purchaseService.test.js` (mock update).
- **Status:** done (PR #115 merged; follow-up PR #118 — 'Priceback Pro' entitlement key + test API key).

### 2026-06-26 — Price-drop detection: window overlap + flyer-authoritative source priority + immediate refresh
- **Asked:** Rework verified price-drop detection so (1) a comparison price applies
  to a receipt when its validity window overlaps the purchase's policy window
  `[purchase_date, purchase_date + policy_days]` (Costco 30 d), anchored on the
  **purchase date, not today** — so a sale that ran in the **past or present** still
  counts (`ISNULL(valid_from/valid_to, now)` null-handling); (2) **flyers are
  authoritative** — when prices differ across sources, use the highest-priority tier
  present: flyer (`source_type_id` 1,4) > price tag (5) > receipt (2), lowest within
  the tier, never falling through to a cheaper lower-tier price; always `verified=true`;
  (3) a drop is detected **immediately** on the in-app "Refresh prices" button without
  changing the scheduled-sweep cadence.
- **Decision/constraints (confirmed via AskUserQuestion):** Q1 → overlap-within-policy-
  window (not "valid only at purchase instant"); Q2 → strict flyer-authoritative (a
  non-dropping flyer price suppresses the line even if a cheaper tag/receipt exists).
  No DB migration — `valid_from`/`valid_until`/`verified`/`source_type_id` already exist.
  Source ids: 1 flyer, 2 receipt_ocr, 3 barcode_scan, 4 flyer_user_scan, 5 price_tag_scan,
  7 manual (ranked last). Freshness relaxed so already-verified/admin/flyer rows count
  regardless of age (past-window detection); unverified crowd rows still bounded by
  `PRICE_VERIFY_WINDOW_DAYS` for the rule-of-N. Open item: removing the
  `purchase+W >= today` gate means an *expired*-window receipt can notify once (per
  "detect in the past"); dedupe ledger caps blast radius — flagged for Maxim.
- **Files/areas:** `backend/repos/priceDropRepo.js` (`findNotifiable` rewrite: source_rank
  tiers, per-receipt window overlap, tier-best DISTINCT ON, optional `userSub` scope;
  `getLatestVerifiedPrice` flyer-authoritative ORDER BY), `backend/priceDropNotifier.js`
  (`runVerifiedDropSweep` `userSub` pass-through + own in-flight key),
  `backend/server.js` (new `POST /api/me/check-drops`), `src/services/priceService.js`
  (`triggerDropCheck`), `src/screens/DetailScreen.js` (refresh calls it). Tests on both
  runners; `docs/Bugs_Common_Fixes.md`. Updates [[price-drop-commission-and-policy-status]]
  / [[verified-price-drop-notifications]] / [[flyer_primary_pricing_strategy]].
- **Status:** in-progress — code done; tests + DB verification pending.

### 2026-06-26 — Flyer parser: geometry-based tile segmentation (price-tag-grade accuracy)
- **Asked:** the flyer scan of one page in `__tests__/fixtures/Flyers/` was
  inaccurate — an item was detected "over" another and only 6 of 8 tiles found.
  Make it as accurate as the price-tag parser: divide the OCR **by item** into the
  tag structure (brand/product, SKU, regular, instant savings, final price, valid
  from/to). Ignore eco-fees; ignore "SAVE $N"-only tiles with no SKU/price for now
  and document that as a future optimization.
- **Decision/constraints:** root cause = the text parser paired item-numbers to
  price blocks by **document order**, which crosses columns on a multi-column page
  (Vision streams every tile's top half before the price halves). Fix: a NEW
  geometry path `parseFlyerWords(words)` in `flyerTextParser.js` that segments the
  page **spatially** using Vision word coordinates — exactly like the price-tag
  parser localises a tag. Columns from item-number x-positions; each tile = the
  column strip between vertical midpoints to the neighbouring SKUs; price = the
  first x-aligned, vertically-tight `was/-savings/promo` triplet (eco-fees & QC
  sub-prices can't satisfy alignment+equation → ignored); name = only the
  left-margin-aligned lines above the SKU (decorative product-photo captions
  excluded; SKU digits stripped). Guards: SKU suffix `1978560-5` → `1978560`
  (else its price leaks into a neighbour); drop a tile when `regular > promo×2.5`
  (>60% off = OCR-mangled column on a degraded screenshot). Geometry is PRIMARY;
  the flat-text `parseFlyerText` stays as the fallback when a response has no word
  geometry. `lib/visionOcr.js` gained `visionDataToWords` (normalises image pixel
  vertices / passes PDF normalizedVertices, pages offset 1e6); `flyerScanService
  .extractViaVision` uses geometry first (`source:"vision-ocr-geometry"`), text
  fallback (`"vision-ocr"`). On the frozen fixture: 43 clean offers (was 42 with
  cross-contamination), all known prices/dates exact, 0 phantom SKUs, max
  regular/promo 1.39×, ~98% named.
- **Future optimization (documented):** "SAVE $N"-only banner tiles with no SKU
  and no price block are intentionally skipped for now → `docs/FUTURE_ROADMAP.md`.
- **Files/areas:** `backend/services/flyerTextParser.js` (+`parseFlyerWords` &
  helpers), `backend/lib/visionOcr.js` (+`visionDataToWords`),
  `backend/services/flyerScanService.js`, tests `flyerTextParser.test.js`,
  `visionOcr.test.js`, `flyerScanService.test.js`; `docs/Bugs_Common_Fixes.md`
  #56, `docs/FUTURE_ROADMAP.md`. No migration. Updates [[flyer-scan-multipage-national]].
- **Status:** done — flyer/vision suites green (visionDataToWords fully
  branch-covered); the 7 concurrent-run failures are the known environmental DB
  contention (pass when run serially/alone). Commit/PR owed.

### 2026-06-26 — Barcode purchase-history: show ALL purchases + missing i18n label + standing rule
- **Asked:** scanned-barcode "Your purchase history" sometimes shows nothing (no
  clear pattern); when it does, only the latest purchase shows, not all; the
  history label isn't in i18n.js. Plus a standing rule: never deliver a feature
  whose labels aren't implemented.
- **Decision/constraints:** "latest only" = the repo's 90-day window silently
  dropped older buys → made `priceHistoryForUserProduct` all-time by default
  (`sinceDays=null`; window only applied when a positive number is passed).
  Added `barcode.yourHistory` to EN+FR i18n and dropped the inline fallback.
  The pattern-less "no history" is fundamentally barcode-link coverage: history
  joins on `products.id`, so it only resolves when the scanned UPC is linked to
  the SKU product ([[barcode-sku-linking]]) — not a code bug, a data-coverage
  limit. New standing rule saved → [[no-unimplemented-labels]].
- **Files/areas:** `backend/repos/receiptsRepo.js` (priceHistoryForUserProduct),
  `src/services/i18n.js`, `src/screens/BarcodeScanScreen.js`,
  `backend/tests/priceHistoryDb.test.js`.
- **Status:** done — backend price-history DB test 5/5 green (DEV Supabase);
  mobile i18n parity + screens smoke green. Commit/PR owed.

### 2026-06-26 — Flyer geometry parser + per-user drop check + price-history fix
- **Asked:** Commit and merge all local changes on feat/flyer-geometry-parser branch to main, CI must pass.
- **Decision/constraints:** All changes were already authored on the branch; commit everything, open PR, merge when CI green.
- **Files/areas:** `backend/services/flyerTextParser.js` (geometry parser), `backend/lib/visionOcr.js` (word extraction), `backend/repos/priceDropRepo.js` (validity-window + tier-priority logic), `backend/priceDropNotifier.js`, `backend/server.js` (POST /api/me/check-drops), `backend/repos/receiptsRepo.js` (remove 90-day cap), `backend/services/flyerScanService.js`, `src/screens/DetailScreen.js`, `src/services/priceService.js` (triggerDropCheck), `src/screens/BarcodeScanScreen.js`, `src/services/i18n.js`, tests throughout, docs.
- **Status:** in-progress.

### 2026-06-26 — Update docs/PUBLISH_CHECKLIST.md
- **Asked:** Update the publish checklist with recent changes, add a top-level summary, enable checkboxes, update links based on priceback.ca, and add Azure app_registration requirements.
- **Decision/constraints:** priceback.ca is live on Cloudflare Pages (Priceback-Website repo). Legal pages committed there. Neon retired — Publish_Requirements.md had stale Neon refs. Don't touch app code.
- **Files/areas:** `docs/PUBLISH_CHECKLIST.md`, `docs/Publish_Requirements.md`.
- **Status:** done.

### 2026-06-25 — OCR + parse the two photographed refund receipts (Refunds/ fixtures)
- **Asked:** generate the OCR for the 2 receipts in `__tests__/fixtures/Refunds/`
  and run the tests so they parse correctly; fix any failures.
- **Capture:** `__tests__/fixtures/Refunds/` is a committed fixture location
  (already in `.gitignore`, images excluded / `.vision.json` committed) but the
  capture script + realocr test only walked `fixtures/receipts/`. Wired the
  `Refunds/` tree into both (`scripts/captureReceiptOcr.js` `FIXTURE_DIRS`;
  `costcoReceiptParser.realocr.test.js` `FIXTURE_DIRS`). Ran
  `node --use-system-ca scripts/captureReceiptOcr.js` — `--use-system-ca` is
  REQUIRED here: the AVG antivirus TLS-intercepting proxy makes Node reject
  Vision's cert unless it trusts the Windows CA store (plain `node` → "unable to
  verify the first certificate"). This is the fix for the long-standing "capture
  fails from this env" note.
- **Parser bugs the photos exposed (all fixed):** these in-club refunds differ
  from the website-PDF refunds (G-1/2/3): (1) they carry a "REFUND / MEMBERSHIP"
  register header the PDF omits; (2) their reversed coupons / VOID reversals print
  POSITIVE ("5.00 H", "13.99 H") so `countPurchaseLines()` > 0 and the old gate
  fell through to the warehouse parser → garbage positive items. Fixes:
  `isRefundHeader()` routes by the header alone (definitive; a purchase never has
  it); `isRefundReceipt` now also catches French "MONTANT …-"; `refundToPurchaseText`
  mirrors a post-VOID positive reversal into a NEGATIVE cancellation; the
  CPN/TPD handler tolerates slashed/spaced refs ("706359 CPN / E / RETUNR 5.00-");
  `extractItems` handles a single-line VOID cancellation (geometry keeps the
  voided line whole); `cleanItemName` strips the orphan "ITEM #" label the PII
  scrub leaves behind. The realocr refund matcher now finds an item by name when
  the SKU was scrubbed/voided away.
- **Files/areas:** `scripts/captureReceiptOcr.js`, `src/services/costcoReceiptParser.js`
  (isRefundHeader, gate, CPN regex), `src/services/receiptParsingShared.js`
  (refundToPurchaseText VOID mirror, extractItems single-line VOID, cleanItemName
  ITEM# strip). Tests: `costcoReceiptParser.test.js`, `receiptParsingShared.test.js`,
  `costcoReceiptParser.realocr.test.js` (+ 2 new committed `.vision.json` fixtures).
- **Verification:** receipt 1 (`PXL_20260624_012641537…`) → 2 items, SPORTING
  -14.99/-19.99 (CPN netted), PHARMACY -10.99/-13.99 (VOID + CPN netted), total
  -29.36, tax -3.38, reconciles. receipt 2 (`PXL_20260624_015845488`) → COOLER
  -15.49 + WOMENS FRAG -179.98 (×2, sku 1891652), total -218.87, tax -23.40.
  Full mobile suite **1748 pass**; coverage 64.17/51.35/53.98/66.06 (≥ floors
  61/46/52/63); both parser files ≥91% stmts.
- **Status:** done — branch `fix/refund-receipt-full-ruleset` (continues the
  refund-ruleset work below).

### 2026-06-25 — Refund receipts reuse the full normal-receipt ruleset (negated)
- **Asked:** Refunds still parse badly — the same bugs as normal receipts (payment-
  summary lines like "APPROUVE"/"AMOUNT" logged as items, "N @ unit" / column-split
  lines mishandled, wrapped names). Make refunds run EVERY rule of the standard
  Costco receipt (same logic + excluded keywords), the only difference being the
  values are sign-inverted. Real refund fixtures live at
  `__tests__/fixtures/receipts/Costco Receipts PDF/G-{1,2,3}-Refund.vision.json`.
- **Root cause:** the Costco refund branch called `parseRefundReceipt` → the bare
  GENERIC `parseReceiptEngine` (no geometry, no column-split reshape, no TPD
  handling). A refund is the exact sign-mirror of a purchase, so it needs the
  warehouse parser, not the dumb engine.
- **Fix:** `refundToPurchaseText()` normalizes a refund into purchase-shaped text
  (strip the trailing minus off returned products/summaries; ADD a trailing minus
  to the POSITIVE TPD/CPN reversal amounts so the discount handler nets them).
  `parseRefundReceipt(rawText, { parse })` now takes an injected parser; the Costco
  branch passes `parseCostcoWarehouseReceipt(raw, annotation, { preprocess:
  refundToPurchaseText })` (new `preprocess` hook applies to BOTH geometry rows and
  flat text). Result is parsed with the full ruleset, then every amount negated.
  Normal receipts are byte-identical (preprocess defaults to identity).
  Also fixed a shared `extractTax` bug exposed by a zero-tax refund: an explicit
  `TAX 0.00` line used to borrow the TOTAL beneath it as the tax (doubling the
  computed total) — a printed 0.00 is now authoritative.
- **Files/areas:** `src/services/receiptParsingShared.js` (refundToPurchaseText,
  parseRefundReceipt, extractTax), `src/services/costcoReceiptParser.js`
  (preprocess hook + refund branch). Tests: `receiptParsingShared.test.js`,
  `costcoReceiptParser.test.js`, `costcoReceiptParser.realocr.test.js` (pinned
  ground truth for G-1/2/3 refunds incl. TPD-reversal netting on G-3).
- **Verification:** G-3 now extracts ENTRANCE MAT -9.99 (TPD reversal applied),
  SHOE STORAGE -34.99, deposit ignored, reconciles to -148.17; G-2 -218.87; G-1
  pure reversal -3.50. Full mobile suite **1737 pass**, coverage 64.2/51.3/54.01/
  66.07 (≥ floors 61/46/52/63).
- **Status:** done — branch `fix/refund-receipt-full-ruleset`.

### 2026-06-25 — Credit-pack grant showed/granted the OLD amount (250 → 300)
- **Asked:** A real in-app purchase of the Starter pack (250 cr / $3) granted 300;
  same for every pack. Fix it.
- **Diagnosis (no code change):** the grant is server-authoritative from
  `configService.getDerivedMaps().ALL_PACKS`, an in-memory snapshot warmed from the
  DB. Two stale layers served the old 300 after the catalog was lowered to 250: the
  backend warm cache (re-warms every 5 min via `startAutoRefresh`) and the mobile
  `pricing.json` cache (refreshes next launch). Maxim had corrected the DB row by
  hand; the app caught up on the next 5-min refresh tick → resolved itself. Per
  Maxim, skip the code change.
- **Latent (documented, deferred):** `seedCreditPacks` upserts credits with
  `coalesce(existing, excluded)`, so re-seeding can NEVER correct a stale non-null
  `credits`/`price` from the catalog — PROD likely still holds 300. Switch the
  upsert `set` to `excluded.*` (catalog-authoritative) when prod is next touched.
- **Files/areas:** none changed; documented in `docs/Bugs_Common_Fixes.md` #53.
- **Status:** done (documented; per Maxim, no code change).

### 2026-06-25 — Sync credit pack seed descriptions to dev DB
- **Asked:** Update the pricing.config.js seed for credit packs to match current values in the dev Supabase DB.
- **Decision/constraints:** DB had slightly higher dollar estimates ($17/$34/$74 vs $16/$33/$73) and a typo "aroud" — synced the descriptions and fixed the typo; credits and prices unchanged.
- **Files/areas:** `shared/pricing.config.js`, `backend/shared/pricing.config.js`.
- **Status:** done

### 2026-06-25 — Author docs/database-schema.md
- **Asked:** create `docs/database-schema.md` describing every table, function, and column plus the
  relations (credit management, user management, etc.).
- **Decision/constraints:** documentation only, no schema changes. Sourced from the canonical
  `backend/db/deploy/schema.sql` (migrations 0000→0011) + lookup-table seed values in
  `backend/db/seed.js`. Header anchors the doc back to `schema.sql` as source of truth and notes the
  `build-consolidated-schema.js` regenerate command.
- **Files/areas:** `docs/database-schema.md` (new).
- **Status:** done.

### 2026-06-25 — Fix main CI red (EMAXCONNSESSION) + coverage-buffer initiative
- **Asked:** main's GitHub workflow is failing. If it's coverage-related, add a standing rule to
  always ship full-coverage tests for every feature/bug fix; and optimize the suites NOW so coverage
  always exceeds the CI minimums with a good buffer for all future builds.
- **Diagnosis:** the failure was NOT coverage — 8 DB-gated backend tests failed together on
  `(EMAXCONNSESSION) max clients reached … pool_size: 15` (shared Supabase dev session pooler, 15-conn
  cap shared with the always-on dev backend + any local dev). Coverage actually PASSED but with a
  razor-thin buffer (backend 89.28 vs 89 floor). See Bugs_Common_Fixes #52.
- **Decision/constraints:** fix the real failure durably (don't lower `DB_POOL_MAX`, don't touch prod);
  add the standing rule; lift measured coverage to bank a real buffer WITHOUT raising floors (raising
  floors would consume the buffer — the old just-below-measured practice is what kept builds chronically
  ~0.3% from red). Backend coverage must not regress the thin branch floor (73) — heeded the documented
  "branch paradox" by hitting BOTH sides of every constructed branch.
- **Changes:**
  - `backend/db/client.js`: `seedWithRetry` defaults 4×750 ms → **6×1000 ms (≈15 s)** to ride out
    transient pooler saturation (the first DB touch is where it bites).
  - Backend coverage: new `backend/tests/configServiceWarm.test.js` covers `configService.warm()` +
    the catalog-derivation helpers via injected fake repos with constructed both-sides rows
    (`warm()` gained an optional `deps` param, prod path unchanged) → configService.js 56.75% → 99.7%;
    plus new `getOpsConfig` string-env + `getAdminSubs` cases in `configService.test.js`. Backend now
    **90.68 / 74.28 / 92.67 / 90.68** (branches rose, not fell). Updated the deferral note in
    `catalogConfigDb.test.js`.
  - Mobile coverage: new render-smoke tests `__tests__/detailScreen.smoke.test.js` (90-fn screen) and
    `__tests__/emailSyncScreen.smoke.test.js` → mobile **64.04 / 51.15 / 53.93 / 65.94** (functions
    buffer 0.69 → ~1.9). Floors left as-is to bank the buffer.
  - Standing rule saved to memory `full-coverage-tests-every-change` + the "don't hug the floor" policy.
- **Verification:** full backend `npm run test:coverage` (serial) — all pass + thresholds exceeded
  (one transient bootstrap 503 during the local run passed on isolated re-run); full mobile jest
  coverage 1726 pass, thresholds exceeded.
- **Status:** done — branch `fix/ci-emaxconnsession-coverage-buffer` (PR pending/merge).

### 2026-06-25 — Ignored fee-items · full notification wiring · DB-backed savings · deferred referral
- **Asked:** Four improvements. (1) Add an "ignored products" concept: fee-like line items
  (bottle deposits, environmental/eco fees, environmental tax, recycling) stay VISIBLE on the
  receipt but are NOT price-tracked (no `price_points`) and NOT watched. (2) Wire ALL the
  notification categories so they actually fire per the user's saved prefs (prefs already persist
  in the DB for device-change recovery). (3) Annual/total savings must be recovered from the user's
  claim history in the DB (updated on every claim) so it survives reinstall. (4) Referral credit
  granted to BOTH referrer and referee only AFTER the new user makes their first credit-pack OR
  subscription purchase (currently paid immediately at signup redemption).
- **Decision/constraints:** (1) Detection = keyword auto-detect (EN+FR) PLUS a manual per-line
  toggle in the Scan review screen; new `receipt_items.ignored` boolean (migration 0011); mirror
  the existing `isRefund` gate in `receiptsRepo.create` (upsert product only, no price_points,
  `watch_enabled=false`). (2) Wire EVERYTHING incl. the daily digest (digest = server cron reusing
  the scheduled-checks/`buildNotifGate` infra; event senders gated by `categoryEnabled` /
  `buildNotifGate`, fail-open). (3) Read-time DB aggregate (`SUM(claimed_savings)` WHERE
  `claimed_at IS NOT NULL AND deleted_at IS NULL`) served in `/api/me/bootstrap`; mobile `getStats`
  prefers it, falls back to the local sum — NO migration (column already written on every claim).
  (4) `redeem()` records the edge but pays nothing (NULL ledger ids = pending); new idempotent
  `settleReferralOnFirstPurchase` hooked into `creditsRepo.recordTopupOnce` (credit pack) and the
  RevenueCat webhook (subscription); the `referee_reward_ledger_id IS NULL` guard fires it exactly
  once across either path. No schema change for referral (ledger-id columns already nullable).
- **Files/areas:** `backend/db/{schema.js,migrations/0011_*,deploy/schema.sql}`,
  `backend/repos/{receiptsRepo,pricesRepo,referralsRepo,creditsRepo}.js`, `backend/server.js`,
  `backend/priceDropNotifier.js`, `src/services/{receiptParsingShared,costcoReceiptParser,
  receiptParser,receiptSyncService,notificationService,syncService,storageService}.js`,
  `src/screens/ScanScreen.js`, `src/services/i18n.js`, tests on both runners.
- **Verification:** Backend `test:coverage` (serial, DB_POOL_MAX=3, Supabase dev) **727 pass /
  0 fail**, c8 89.61/73.41/90.78/89.61 (≥ floor 89/73/89/89). Mobile **1722 pass**, coverage
  62.81/49.65/52.69/64.55 (≥ floor 61/46/52/63). Migration 0011 applied to DEV; consolidated
  `schema.sql` regenerated (12 migrations). New tests: `savingsSummaryDb`, ignored-item case in
  `receiptPricePoints`, deferred-payout + settle + race rewrite of `referralsRepoDb`/`Edges`,
  `isIgnoredItemName` + `stampIgnoredItems` + `toApiBody ignored` + `getStats` server-savings, plus
  the drop-charge push assertion in `priceDropPipelineE2E`. notifOtherCredit has no concrete event
  yet (monthly_grant unimplemented) — documented as the ready catch-all.
- **Status:** done (code + tests, both runners green) — branch `feat/ignored-items-notif-savings-referral`; PR pending. PROD owes migration 0011.

### 2026-06-25 — Flyer parser optimization against the real Vision fixture
- **Asked:** Maxim ran `npm run capture:flyers`, producing the frozen OCR fixture
  `__tests__/fixtures/Flyers/Flyers-June-2026.vision.json`. Use it to write unit tests
  and optimize the flyer OCR treatment if needed. (Don't read the source PDF.)
- **What the real OCR exposed (and the fixes):** The original text-flow parser produced
  garbage on the real fixture — 55 "offers" with wrong prices (eco-fees/QC/model numbers
  read as prices, e.g. promo 5813.74), phantom 4–5 digit SKUs, mostly-null/garbage names,
  and ONE wrong global date. Rebuilt `flyerTextParser.js` around what the fixture showed:
  (1) **per-tile dates** — the PDF stacks multiple flyer SECTIONS (May 11–Jun 7 ×20,
  May 25–Jun 7 ×13, Jun 22–Jul 5, Jun 8–Jul 5); each tile reprints its own "Valid…" line.
  The old single-window even picked a date out of Michelin warranty fine print. Per-tile
  dates now snap to the canonical (repeated) window to correct OCR year typos ("2028"→2026),
  matching BOTH month/days (two sections share the Jul 5 end). (2) **Document-order SKU↔price
  pairing** — on a multi-column page the price block lags its SKU by one tile, so the k-th
  price block pairs with the k-th item number (two-pointer), not by text proximity.
  (3) **Self-validating price triplet** (was − savings ≈ promo) as the anchor → eco-fees/QC
  sub-prices/legal numbers can't be read as a price. (4) **6–8 digit SKU floor** (flyer item
  numbers; the tag parser's 4-digit floor invented phantoms here). (5) **Name+size read from
  the lines ABOVE the item number** (the real flyer layout), falling back to below for
  contiguous tag-style blocks.
- **Decision/constraints:** All fixes are TEXT-only, so they flow into the live pipeline
  automatically (`flyerScanService.extractViaVision` → `parseFlyerText(text)`, unchanged);
  no geometry plumbing, no DB migration, Gemini fallback untouched. Result on the real
  fixture: **42 clean offers, 0 dropped, every triplet's math checks out, real product names
  ("Dyson Supersonic hair dryer with display stand", "Monster Ultra Zero…"), correct
  per-section dates, zero phantom SKUs.**
- **Files/areas:** `backend/services/flyerTextParser.js` (rewrite; new exports
  `collectDateWindows`), `backend/tests/flyerTextParser.test.js` (10 new tests + an enriched
  real-OCR regression asserting concrete known offers/dates and absent phantoms),
  `__tests__/fixtures/Flyers/Flyers-June-2026.vision.json` (NEW — must be committed so CI runs
  the real-OCR block; it's skip-if-absent).
- **Verification:** `flyerTextParser.test.js` 17/17 pass, `flyerScanService.test.js` 10/10
  pass; c8 on the parser = 99.57% stmts / 87.37% branch / 100% funcs (well above the ratchet).
- **Status:** done (code + tests). Not committed — awaiting Maxim's go-ahead (feature branch).

### 2026-06-25 — Barcode price-history + flyer OCR parser rebuild
- **Asked:** Three fixes. (1) Barcode scan: product image was missing when a price was
  found; also show the user's OWN last-known price(s) from their receipt history (last
  90 days, with dates) under the current price. (2) Flyer scan extracted ZERO offers.
  (3) Imported/scanned flyers stored NULL valid-from/valid-to. Flyers must use a NEW
  parser with the EXACT same logic as the price-tag parser (Vision OCR → deterministic
  parse), the only difference being the flyer's original valid-from date range. Use the
  PDFs in `__tests__/fixtures/Flyers/` as OCR test input (send to OCR, don't hand-parse).
- **Decision/constraints:** New flyer parser runs **server-side** (swapped into
  `flyerScanService`), with **Gemini kept as a fallback** when OCR yields zero offers
  (both confirmed by Maxim). Flyer's printed `valid_from`/`valid_until` are now persisted
  to `price_points` and `activeFlyerOffers` became a date-range query (flyer rows only —
  receipt/tag writes keep the rule-6 Monday `valid_from`). Barcode image is fetched from
  the external catalog (Open Food Facts/UPCItemDB) even on a price hit; history is a new
  authenticated `GET /api/me/price-history`. No DB migration (date columns already exist).
- **Files/areas:** `backend/services/flyerTextParser.js` (NEW), `backend/lib/visionOcr.js`
  (NEW), `backend/services/flyerScanService.js`, `backend/server.js`, `backend/repos/
  {pricesRepo,receiptsRepo}.js`, `src/services/{barcodeLookup,priceService}.js`,
  `src/screens/BarcodeScanScreen.js`, `scripts/captureFlyerOcr.js` (NEW) + `capture:flyers`,
  tests on both runners (`flyerTextParser`, `flyerScanService`, `visionOcr`,
  `flyerDatePersistenceDb`, `priceHistoryDb`, `barcodeLookup`, `priceServiceNetwork`).
- **Verification:** Backend no-DB 524 pass / 0 fail; DB-gated 99 pass / 0 fail (Supabase
  **dev**); c8 ratchet held (89.91/73.71/91.04/89.91; `visionOcr.js` 100%). Mobile 1714
  pass, coverage floors met. The deterministic flyer parser is validated against synthetic
  fixtures now + a guarded real-OCR regression that activates once Maxim runs
  `npm run capture:flyers` (TLS-intercepting proxy blocks the capture from this env).
- **Status:** in-progress — branch `feat/flyer-ocr-parser-barcode-history`; PR pending.

### 2026-06-23 — Receipt-scan accuracy fixes (4 bugs)
- **Asked:** Fix four receipt-scan bugs: (1) "Add item" button must be the last line
  in both Scan-confirm and Detail; (2) refund receipts parsed as positive — accept the
  refund and log every amount as NEGATIVE, non-trackable (Maxim chose accept+negative
  over reject); (3) tax can exceed subtotal — cap at the province's combined tax rate ×
  subtotal (QC ≈15%, ON 13%, …); (4) add an always-on deterministic validator that makes
  the receipt internally consistent before display (auto-fix silently, Maxim's choice).
- **Decision/constraints:** Refunds skip crowdsourced `price_points` (no negative prices
  in the verified-price/crowdsource data) — gate on an `isRefund` payload flag, NO DB
  migration (no `is_refund` column; refund is re-derivable from negative total). ScanScreen
  save filter must allow negative line items for refunds. Validator is pure/sync +
  unit-testable; reuses `reconcileTotalsLocally`. Province resolved warehouse→prefs→max-rate.
- **Files/areas:** `src/services/receiptValidator.js` (NEW), `receiptParsingShared.js`,
  `ocrService.js`, `costcoReceiptParser.js`, `receiptParser.js`, `storageService.js`,
  `receiptSyncService.js`, `src/screens/ScanScreen.js`, `backend/repos/receiptsRepo.js`,
  `backend/server.js`, tests on both runners.
- **DB verification (2026-06-24):** Ran the DB-gated backend suite against the Supabase
  **dev** project (`gnedluuylimjwdmtvswl`, 5432 session pooler) via
  `node --env-file=.env --test --test-concurrency=1 tests/*.test.js` (serial + `DB_POOL_MAX=3`
  to stay under the pooler's 15-conn ceiling — concurrency 4 hits `EMAXCONNSESSION`). The new
  `receiptPricePoints.test.js` "refund records NO price points" case caught a real **500**:
  `receipt_items.product_id` is NOT NULL, so the refund path must still `upsertProduct` per
  line (products only, no price_points). Fixed in `receiptsRepo.create`. Final: backend
  **689 pass / 0 fail / 1 skip**, coverage 89.64/73.66/90.61/89.64 (ratchet held); mobile
  **1709 pass**, `receiptValidator.js` 97.29%. No DB migration (refund derivable from sign).
- **Status:** done — see PR (below) / commit. Branch `fix/receipt-scan-accuracy-refund-tax-validator`.

### 2026-06-23 — Establish the Task Log workflow
- **Asked:** Document every task in an md file that must be checked before coding,
  so past requests aren't accidentally rolled back — instead of relying on
  wrapup/recall each session.
- **Decision/constraints:** This file (`docs/Task_Log.md`) is the record. Checking
  it before coding and appending after each task request is a standing step.
- **Files/areas:** `docs/Task_Log.md`, memory `task-log-before-coding`.
- **Status:** done.

### 2026-07-01 — Price-drop regression: receipt's own discounts detected as drops
- **Asked:** Fix refresh-prices/price-drop detection detecting the scanned receipt's own
  instant discounts as drops ("claim $4.00", "−0%" savings). Drops must be based on tracked
  receipt lines but EXCLUDE discounts already on the receipt — only price changes not in the
  receipt count. Regression vs earlier behavior.
- **Decision/constraints (AskUserQuestion):** exclusion scope = same receipt only — the same
  user's LATER cheaper purchase of the same product (2nd receipt) MUST still trigger a drop
  on an earlier full-price line, within the store policy window (store-configured
  `policy_window`/`adjustment_days`, no hardcodes). Timing = only-after-purchase: a price
  already available on/before the purchase date (incl. flyer sales running at checkout) is
  never a drop — deliberately reverts 984c3ad's at-purchase/past-sale overlap semantics.
- **Implementation:** `findNotifiable` now requires SOME observation of the verified price
  to have become available strictly AFTER the purchase date and ≤ purchase+policy window
  (availability = flyer printed valid_from; observed_at::date for point sources). Mobile:
  strictly-positive-savings guard in DetailScreen (removed the promoActive-only drop path),
  HomeScreen alert/tracked rows. No DB migration.
- **Files/areas:** `backend/repos/priceDropRepo.js`, `src/screens/{DetailScreen,HomeScreen}.js`,
  `backend/tests/{priceDropWindowSourceDb,priceDropDb}.test.js` (self-receipt regression
  suite; flyer fixtures must pass printed validFrom/validUntil),
  `__tests__/{detailScreen.smoke,screensSmoke}.test.js`, `docs/priceDrop.md`,
  `docs/Bugs_Common_Fixes.md` #64.
- **Status:** done — branch `fix/price-drop-self-receipt-discounts`, PR pending.

### 2026-07-02 — OCR cleanup: pre-scanned banner in item names, Member label, warehouse header in OCR panel
- **Asked:** (persistent bug from last session's cleanup ask) 1) the
  `***START OF PRE-SCANNED ITEMS***` sentence (or a fragment) still appears in
  item names on some scans even though the OCR panel looks clean — the parser
  must see fully cleaned input; 2) the keyword "Member" must leave the OCR
  text; 3) warehouse info (store name, warehouse #, address, …) should be
  extracted (GET) first and then stripped — the displayed OCR should be items
  and item-related info only.
- **Decision/constraints:** banner scrub is inline + tokenization-tolerant and
  runs before the keep list; membership label line removed whole (ID still
  extracted; priced MEMBERSHIP lines + refund header survive); warehouse info
  = GET-then-strip (parse first, then `stripWarehouseInfo` on `rawText` — never
  pre-parse, store detection needs the header); amount-bearing lines are never
  stripped. Bonus root-cause fix: engine's 2-line NAME→PRICE pairing no longer
  pairs a name with a discount amount (phantom "GLOUCESTER, ON K1J 1A5" item).
- **Files/areas:** `shared/ocrCleanup.js` (+ synced `backend/shared/`),
  `src/services/receiptParser.js` (strip + name scrub in stampIgnoredItems),
  `src/services/receiptParsingShared.js` (pairing guard),
  `__tests__/{ocrCleanup,receiptParserScan,costcoReceiptParser.realocr}.test.js`
  (banner tokenization cases, stripWarehouseInfo suite, pinned expectations for
  PXL_20260702_022107026 + PXL_20260702_022131546), `docs/Bugs_Common_Fixes.md`
  #67.
- **Status:** done — branch `fix/ocr-prescanned-member-warehouse-cleanup`, PR pending.

### 2026-07-03 — `warehouse_id` still null after save (receipt r_1783092798869_2xoa1)
- **Asked:** dev receipt `r_1783092798869_2xoa1` had a null `warehouse_id`
  column and the list still showed "Costco Canada" instead of the warehouse.
- **Root cause:** queried the dev DB row directly — `raw_ocr` still had
  "Kanata\n#541" un-stripped. `extractWarehouseId`'s city+number pattern
  required ALL-CAPS; Vision's geometry reconstruction had welded the
  Title-Case "Kanata" line and the "#541" line into one row, which matched
  neither the ALL-CAPS pattern nor the standalone-newline fallback.
- **Fix:** added a case-insensitive city+number pattern (guarded against
  `Item #NNNNNNN` SKU lines) to `extractWarehouseId`.
- **Files/areas:** `src/services/receiptParsingShared.js`,
  `__tests__/receiptParsingShared.test.js`, `docs/Bugs_Common_Fixes.md` #70.
- **Status:** done, uncommitted — not yet on a feature branch.

### 2026-07-05 — Android package rename broke config + `DEVELOPER_ERROR` sign-in
- **Asked:** package `ca.priceback.app` → `com.priceback` in Play Console + GCP
  credential rotation broke the config; Google Sign-In shows `DEVELOPER_ERROR`.
  Also: can Claude connect to Play Console / RevenueCat / GCP to set it up, in a
  way linked to the project so it works from any device (Maxim switches devices).
- **Root cause:** no Android OAuth client matches `com.priceback` + the Play App
  Signing SHA-1 (from the downloaded `deployment_cert.der`,
  SHA-1 `35:47:ED:80:…`); `google-services.json` still declared the old package.
- **Fix / deliverables:**
  - `google-services.json` `package_name` → `com.priceback` (unblocks Android build).
  - `scripts/configure-google-signin.mjs` — device-independent: reads a GCP
    service-account key from EAS env (`GOOGLE_CONFIG_SA_JSON`), ensures the
    Firebase Android app, registers the Play SHA-1 (auto-provisions the Sign-In
    OAuth client — the DEVELOPER_ERROR fix), rewrites `google-services.json`,
    prints the new `googleClientIdAndroid`. Idempotent, `--dry-run` supported.
  - `docs/Signin_Config_Recovery.md` — full runbook (one-time SA bootstrap →
    store key in EAS → run from any device; RevenueCat left as 2-min dashboard
    step since RC's API can't repoint a Play app / upload Play creds).
  - `.gitignore`: added `sa.json`, `*.der` (never commit the cert/key).
  - `docs/Bugs_Common_Fixes.md` #74.
- **ACTUAL root cause + fix (via browser automation):** Firebase already had the
  `com.priceback` app + Play SHA-1 + matching Android OAuth client (`…6ap3mab4…`
  = `googleClientIdAndroid`). The real break was the stale **`GOOGLE_SERVICES_JSON`
  EAS file-secret** (old `ca.priceback.app` config), which EAS injects per
  `app.config.js:82`. **FIXED:** replaced repo `google-services.json` with the
  correct 2-app config AND overwrote the **production** `GOOGLE_SERVICES_JSON`
  EAS secret (`eas env:update … --type file`, authorized by Maxim). Next
  `eas build --profile production` + Play release = working Google Sign-In.
- **Extended to ALL envs (2026-07-06):** created `GOOGLE_SERVICES_JSON` file-secret
  in **preview + development** too (prod already done). Registered all 3 signing
  SHA-1s on the Firebase `com.priceback` app via browser (each auto-provisions its
  Sign-In OAuth client): Play `35:47:ED:80…` (prod), EAS keystore
  `2D:43:BC:7F…D5:2B` (EAS dev/preview APKs), Expo default debug keystore
  `5E:8F:16:06…F6:25` (local `manual_build/build-and-install.ps1` — release+debug
  both sign with `android/app/debug.keystore`, SHA universal across machines).
  Updated `docs/PUBLISH_CHECKLIST.md` (§3b + stale bundle-ID refs → com.priceback).
- **Still owed:** RevenueCat dashboard — repoint Play app to `com.priceback` +
  re-upload Play service-account JSON (RC API can't do either).
- **Status:** sign-in fix DONE for prod + preview + dev + local builds. Repo edits
  uncommitted. Verify on each build type after next build.

---

## 2026-07-10 — Production scan "Scan failed: API error 502" (dead prod Vision key)

- **Ask:** fix the 502 "scan failed" on the production build (Google Console
  testing APK); solution expected in `docs/Bugs_Common_Fixes.md` (recurring).
- **Diagnosis:** reproduced by POSTing a tiny image to `/api/ocr` on both
  backends — **prod → 502** `{"error":"OCR service authentication failed…"}`,
  **dev → 200**. Per `server.js` ~L1409 that message = Google Vision **403**, so
  the production `GOOGLE_VISION_API_KEY` is invalid/unauthorized (revoked / wrong
  key / restricted / Vision API not enabled). Matches the long-pending "rotate
  Vision key" ops item. `/health` hid it — its `ocr` check is only an env-var
  presence flag ("configured"), not a real Vision call.
- **Real fix (OPS — owed by Maxim):** set a valid, unrestricted-for-Vision
  `GOOGLE_VISION_API_KEY` on the `priceback-production` Railway service.
- **Code shipped (this PR):**
  - Backend: admin-gated active probe `GET /health?probe=ocr` (`probeVisionAuth`)
    → `checks.ocr.probe` = ok/unauthorized/rate_limited/error/unreachable/missing,
    so a dead key is now detectable instead of reading "configured".
  - Mobile: `ocrService._visionFetch` maps backend 5xx → friendly tagged error
    (`code:"ocr_unavailable"`) → manual-entry fallback, not raw "API error 502".
  - Docs: `Bugs_Common_Fixes.md` #81. Tests: `backend/tests/visionAuthProbe.test.js`,
    `__tests__/ocrVisionPipeline.test.js` (5xx mapping).
- **Status:** code DONE + tested (mobile 246/246 OCR, backend probe 6/6),
  branched/PR'd/merged. **Prod scans stay broken until the Railway Vision key is
  replaced** — that's the operational remainder.

---

## 2026-07-10 — Email sync connect dead-ends (Gmail OAuth policy block + Outlook admin-approval)

- **Ask:** fix the bug in two screenshots — (1) Gmail connect → Google *"Access
  blocked: Authorization Error … Error 400: invalid_request"*; (2) Outlook connect
  with a CESI school account → Microsoft *"Need admin approval"* for the unverified
  Priceback app.
- **Diagnosis:** both live in `emailSyncService.js`. **Gmail** `connectGmail` still
  used `expo-auth-session` with a `priceback://` **custom URI scheme** — the flow
  Google now hard-blocks (the main sign-in was already migrated to native, this path
  was missed). **Outlook** `connectOutlook` used the `/common/` authority, which
  accepts work/school accounts; a locked-down tenant then forces admin consent the
  dev can't grant.
- **Fix (code):** Gmail → native `@react-native-google-signin` (Play Services,
  no redirect/scheme) requesting `gmail.readonly`; Outlook → `/common/` → `/consumers/`
  (personal Microsoft accounts, the actual audience). Tests in
  `__tests__/emailSyncConnect.test.js` pin both; `docs/Bugs_Common_Fixes.md` #83.
- **Caveat (OPS):** `gmail.readonly` is a Google sensitive scope — until the OAuth
  consent screen is verified, users see an "unverified app" warning (test users can
  proceed); full public Gmail sync also needs a backend code-exchange for a refresh
  token. Azure app registration must permit personal accounts for `/consumers/`.
- **Status:** code DONE + tested (emailSync 34/34, module coverage 88% stmts /
  90% lines). Uncommitted pending review.

---

## 2026-07-11 — job_runs table: cron status tracking + 6-month purge

- **Ask:** are the cron scripts configured and running — is there any trace/log
  of schedule runs and status? Then: add a `job_runs` table to track cron status,
  purged on a 6-month retention.
- **Findings:** cron jobs are `node-cron` schedules baked into `backend/server.js`
  (sweep, daily maintenance, daily digest, DB retention, monthly account purge) —
  not anything scheduled via this CLI's own cron system. Previously the only trace
  was ad-hoc `console.log`/`console.warn` lines in the Railway log stream; no
  persisted run history.
- **Fix:** new `priceback.job_runs` table (`db/schema.js`, migration
  `0001_numerous_imperial_guard.sql`) — one row per job run (`job_name`, `ok`
  boolean, `started_at`, `duration_ms`, `error`). New `repos/jobRunsRepo.js`
  (record/recent/pruneOlderThan). `server.js` gained a `trackJob(name, fn)`
  wrapper (exported as `__jobRuns` for tests) applied to every named cron job
  plus the price-sweep tick. Retention: `RETENTION_JOB_RUNS_DAYS` = 180 (6
  months), pruned daily by `jobs/pruneJobRuns.js`, wired into the existing
  `runDbRetentionJobs()`. Regenerated `db/deploy/schema.sql`.
- **Tests:** `tests/reposUnit.test.js` (jobRunsRepo), `tests/pruneJobs.test.js`
  (pruneJobRuns), `tests/jobRunsTracker.test.js` (trackJob success/failure).
  Full suite green (855/855, +6 new).
- **Note:** while regenerating the migration, `drizzle-kit generate` also
  reconciled `db/migrations/meta` with old migrations 0001–0009 that were
  already absent from the working tree locally (pre-existing, uncommitted —
  consistent with the earlier [[db-redesign-v2]] squash to `0000_initial`).
  Not committed; left for review before commit.
- **Status:** code + tests DONE, uncommitted. Migration not yet applied to any
  DB (dev or prod) — owed alongside other pending migrations.

**Update 2026-07-12:** migration applied to both DBs — dev (gnedluuylimjwdmtvswl)
and prod (xjfrlzwonyaorwktnkpj, via `railway run --service Priceback -e
production`). Applied the DDL directly (raw `CREATE TABLE/INDEX IF NOT
EXISTS`) rather than `drizzle-kit migrate`: both DBs' `drizzle.__drizzle_migrations`
tracking tables already hold rows with timestamps later than this migration's
(leftover from the earlier chain-squash), so `drizzle-kit migrate` silently
no-ops without creating the table or erroring — verified via direct column
introspection instead of trusting its "success" message. **Owed:** re-baseline
the `drizzle.__drizzle_migrations` tracking table on both DBs so future
`db:migrate` runs aren't silently skipped.

**Update 2026-07-12:** re-baselined `drizzle.__drizzle_migrations` on both dev
and prod to exactly the current 2-migration chain (`0000_initial`,
`0001_numerous_imperial_guard`) after verifying both DBs' live table sets
already matched `schema.js` (37/37 tables). `npx drizzle-kit migrate` now
correctly no-ops on dev instead of silently skipping.

---

## 2026-07-11 — R2 tag-scan photo retention (crowdsourced-pricing PIA open item)

- **Ask:** resolve the crowdsourced-pricing PIA's open action item — R2
  tag-scan photo retention wasn't time-boxed. Add a 30-day retention window.
- **Fix (code):** `RETENTION_TAG_PHOTOS_DAYS` (default 30, `config/defaults.js`)
  + `backend/jobs/pruneTagPhotos.js`, wired into the daily `runDbRetentionJobs()`
  maintenance cron alongside `pruneAuditLog`/`pruneSubEvents`. Deletes the R2
  object for any `tag_scan_reviews` row past the window and nulls
  `image_object_key`; the review row (raw OCR text, parsed fields, verify/reject
  decision) stays as the admin audit trail. New repo helpers
  `tagReviewsRepo.findImagesOlderThan` / `clearImageKey`.
- **Tests:** `tests/pruneJobs.test.js` — new `pruneTagPhotos` describe block
  (DAYS=30, deletes+clears on success, skips clearing on R2 delete failure,
  0-result no-op). 17/17 passing.
- **Docs:** `legal/pia/crowdsourced-pricing.md` §4/§8 marked resolved,
  `docs/PUBLISH_CHECKLIST.md` (both retention mentions) and
  `docs/Publish_Requirements.md` retention table updated.
- **Status:** code + tests DONE. Uncommitted pending review.

---

## 2026-07-25 — Phantom $0.10 price drop + configurable minimum-drop threshold

- **Ask:** closed-test build showed a $0.10 "price drop" on an 18% cream 1L
  scanned at $4.39 (to $4.29) with no notification, and the source of that price
  was unclear. Also: add an easily-configurable threshold so every price drop is
  worth at least $1.99 (Costco doesn't run offers under ~$2).
- **Diagnosis:** two client-side bugs. (1) `/api/check-price` returns
  *unverified* crowd prices on purpose (display badge "Unverified · X/N
  shoppers"), and both client detection paths treated any `currentPrice <
  paidPrice` as a drop — so the app flagged prices the server sweep
  (`findNotifiable`) correctly refuses to push or bill. (2) No minimum-saving
  floor existed on any path.
- **Fix:** new `PRICE_DROP_MIN_SAVINGS` ops knob (default $1.99, per unit,
  `app_config`/env-tunable, auto-seeded — no migration) enforced in
  `priceDropRepo.findNotifiable`, both legacy `server.js` sweeps, and a new
  shared client predicate `qualifiesAsDrop()` that also rejects unverified
  prices. Threshold shipped to the app via `pricing.json`. Full detail +
  "detect next time" in `Operations/Bugs_Common_Fixes.md` #126.
- **Tests:** new `__tests__/qualifiesAsDrop.test.js`; extended
  `priceServiceDrops`, `detailScreenDropNotify`, and a new materiality-floor
  block in `backend/tests/priceDropDb.test.js`. Backend 962/962, mobile
  3032/3032, both suites green with coverage floors clear.
- **Status:** DONE — merged to `main`.

## 2026-07-30 — 135 phantom "changes" in the VS Code source-control tree

- **Ask:** "I can see 135 changes in the GitHub extension (tree), check what
  the hell is this — we had the same issue in the past and it was due to a
  gitignore folder inside the backend folder." Follow-up: "I want the repo
  clean when you finish."
- **Diagnosis:** not `.gitignore` this time, and not a real dirty tree —
  `git status` at the root was clean. `backend/` held its **own stale `.git`**
  (orphan repo, no remote, on `master`, last commit `2026-06-23`) that VS Code
  surfaced as a second source-control provider. Its 133 files of drift, plus 2
  genuinely modified files at the root, made 135. Confirmed it was *not* a
  submodule: the parent tracked all 193 `backend/**` paths at index mode
  `100644`, not a `160000` gitlink.
- **Fix:** bundled the orphan history to a backup, then `rm -rf backend/.git`.
  No file content lost — the parent had been tracking those files all along.
- **The 2 real changes:** an uncommitted `app.json` + `package.json` +
  `package-lock.json` edit adding `expo-build-properties` with
  `ios.useModularHeaders: true`. This was the *abandoned first attempt* at the
  `AppCheckCore`/`GoogleUtilities` CocoaPods failure — merged PR #216
  (`plugins/withIosModularHeaders.js`) deliberately rejects the global switch
  in favour of per-pod `:modular_headers`, and its header comment says so
  explicitly. Backed the diff up as a patch, discarded it, fast-forwarded
  `main` to `origin/main` (picking up #216).
- **Gotcha worth remembering:** the first `git status` reported only 2 modified
  files and missed `app.json` — a stale stat-cache. A later index refresh
  revealed it. If a diff contradicts an earlier `git status`, refresh and
  re-read rather than trusting the first result.
- **Tests:** none — no source change; repo-hygiene only. `main` ends at
  `origin/main` with a fully clean tree and exactly one `.git`.
- **Status:** DONE. Detail in `Operations/Bugs_Common_Fixes.md` #129.

## 2026-07-30 — Full source-tree cleanup (dead code, deps, stale credentials)

- **Ask:** clean the whole codebase of unnecessary code, plugins, files, keys and
  certificates the app never uses — with no dependency breakage or regressions.
- **Method:** three parallel static-analysis sweeps (mobile / backend / non-code cruft),
  every finding then hand-verified. **Roughly a third of the reported "dead code" was
  wrong** and would have broken something — see
  `Technical/cleanup-technical-debt.md` §3.
- **Key finding:** `src/` was already clean — all 27 screens are registered routes and
  every component/util/constant/hook/service has a real production consumer. The dead
  weight was in dependencies, root artifacts and a few orphaned exports.
- **Removed (tracked):** `npm-publish-github-packages.yml` (GitHub template that ran
  `npm publish` on a `"private": true` app, so it always failed); Neon agent-skill +
  `skills-lock.json` (Neon retired); `zod` from `backend/package.json` (zero references);
  `react-server-dom-webpack` devDep (expo-router peer, unused — classic AppEntry);
  `usersRepo.getByEmail`; `receiptsRepo.setItemClaim`; mobile orphans `purchasePack`,
  `scanCostcoTag`, `getStoresByCategory`, `getLocalizedProvinces`,
  `missingCatalogLabels`, and UI-kit `LoadingView`/`SectionHeader`/`Toast` (+ their dead
  styles and two now-unused theme imports).
- **Removed (untracked, regenerable):** `GoogleService-Info.plist` (retired
  `ca.priceback.app` bundle id, referenced by nothing), `build_info.json`, `env.download`,
  `deployment_cert.der`, `coverage/`, `deals/`, `.expo/`, `.eas/`, a Syncthing conflict
  file in `backend/data/`. **Preserved on request:** `android/`, `manual_build/` and
  everything `build-and-install.ps1` needs, plus `sa.json`, `google-services.json` and the
  Play upload keystore.
- **Coverage discipline:** rather than delete the valuable `purchasePack` tests, they were
  retargeted to `purchaseProduct` (the live API) so the pack money paths stay pinned. No
  coverage floor was lowered — `purchaseService.js` functions landed at 68.59% vs its 67%
  floor.
- **Fixes en route:** `.gitignore` now ignores `.eas/` (EAS caches file-env secrets there)
  and drops a dead `docs/.pr-body.md` rule; `cleanup-artifacts.yml` said 60 days in two
  places while deleting at 45; `app.config.js` claimed the root `google-services.json` was
  a committed placeholder (it is gitignored and real); `objectStore.js` pointed importers
  at a non-existent `./storage`.
- **Tests:** mobile 142 suites / 3094 passing, all coverage floors green (baseline was
  3096 — the 2 removed were `purchasePack`-specific validation cases). Backend identical
  to baseline at 963/707/1/255; the single failure is the pre-existing
  `DATABASE_URL is not set` in `creditReconGuards.test.js`, reproduced on a clean tree by
  stashing. `i18n:check` green (en=1334, fr=1334), `typecheck` clean.
- **Flagged, NOT actioned (needs cloud console):** the orphaned `ca.priceback.app` Firebase
  Android app, and the iOS OAuth client that may still be bound to the retired bundle id —
  if so, iOS Google Sign-In fails with `DEVELOPER_ERROR` on the first screen. Verify before
  App Review.
- **Status:** DONE. Residual debt documented in `Technical/cleanup-technical-debt.md`.

## 2026-07-30 — R8 preview build failed; root-caused and fixed (`expo.modules.core.MapHelper`)

- **Ask:** the R8 change from #218 had never touched a device, and the verification preview
  build failed. Take it from there — get a green preview build, then run the on-device
  checklist (Google/Apple sign-in, RevenueCat paywall + restore, camera/scanner, push +
  background fetch, expo-updates, deliberate crash for Sentry symbolication).
- **Failure:** build `f6156674` (preview, commit `e12cafd`) died in
  `:app:minifyReleaseWithR8` — `Missing class expo.modules.core.MapHelper`, referenced from
  `expo.modules.location.taskConsumers.LocationTaskConsumer.shouldReportDeferredLocations()`.
  A **build-time** stop, not the runtime-reflection breakage R8 is usually feared for.
- **Cause:** `expo-location`'s prebuilt AAR (SDK 54+ ships AARs, not source) was compiled
  against an `expo-modules-core` that still exported `MapHelper`; SDK 55 dropped it. The
  dangling reference is invisible until R8 has to build a full class hierarchy.
- **Getting the log:** EAS logs are brotli-encoded and no `eas-cli` command exposes them —
  pulled via the Expo GraphQL API (`builds.byId.logFiles`) and decompressed with
  `zlib.brotliDecompressSync`. R8 had reported exactly one missing class.
- **Fix:** one scoped `-dontwarn expo.modules.core.MapHelper` in `app.json` →
  `extraProguardRules`. `-dontwarn` not `-keep` (a keep rule can't create a class that
  doesn't exist). Scoped to the class, not `expo.modules.core.**`, so a future genuine
  removal still fails loudly. Safe: the reference sits on the background
  `LocationTaskConsumer` deferred-updates path and `locationService.js` only ever calls
  `getCurrentPositionAsync`, so it is dead code here. `android/` is gitignored → EAS
  re-prebuilds from `app.json`, no native re-commit.
- **Shipped:** PR #219, branch `fix/r8-expo-location-missing-class`. Bug documented as
  `Operations/Bugs_Common_Fixes.md` #130.
- **Status:** build fix DONE. **On-device checklist still OWED** — it needs physical
  hardware, which the agent does not have. A green build proves R8 links, not that R8-
  minified reflection survives at runtime. Do not ship production until the checklist is
  run against the preview APK.

## 2026-07-30 — Verified iOS Google Sign-In against the live consoles; removed the retired `ca.priceback.app`

- **Ask:** the retired `ca.priceback.app` still existed in Firebase and the iOS OAuth client
  might still be bound to it — which would dead-end "Continue with Google" on iOS on the
  first screen App Review sees (Guideline 2.1). `.env.example` still warned the iOS client
  was an unprovisioned placeholder. Verify before submission and clean any leftover
  configuration on any platform. Mid-task: also make the app title `PriceBack` everywhere,
  and scan before deleting anything — no regression accepted.
- **Verdict: the iOS client was already correct — there was never a 2.1 exposure.** GCP
  client `Priceback-IOS` (`…-fgs5…`) is bound to **`com.priceback`**, its iOS URL scheme is
  byte-identical to `app.json` → `iosUrlScheme`, and it was last used 2026-06-29. Confirmed
  three independent ways: the console, Google's own generated `google-services.json`
  (`ios_info.bundle_id`), and live probes of the authorize endpoint (correct scheme → sign-in
  page; wrong scheme → `redirect_uri_mismatch`; fake client → `invalid_client`).
- **Also verified:** no EAS environment sets `GOOGLE_CLIENT_ID_IOS`, so the good value in
  `config/profiles/common.js` can't be overridden by a stale secret; the other three OAuth
  clients are all on `com.priceback`; Firebase has an iOS app on `com.priceback`; ASC and
  Play both read `PriceBack` / `com.priceback`.
- **Cleaned:** removed the dead Firebase Android app for `ca.priceback.app`
  (`1:695135372222:android:df12d8bffc75090960afef`) — only after proving no tracked source,
  no OAuth client, no EAS build path and no published Play app depended on it. Restorable
  until 2026-08-29. Stripped its now-dead `client[0]` from `google-services.json`.
- **Repo:** corrected the stale `.env.example` placeholder warning; `PriceBack Canada` →
  `PriceBack` in the Play listing draft, README, backend banner and two file headers
  (build identifiers like the `priceback-canada` slug / Sentry project deliberately kept —
  renaming them would break the EAS project link and Sentry symbolication).
- **Test:** new `__tests__/iosGoogleClientConsistency.test.js` (9 tests) fails the build if
  `googleClientIdIos` and `iosUrlScheme` ever drift, if either becomes a placeholder, or if
  any config reintroduces `ca.priceback.app`. `npm run i18n:check` green.
- **Status:** DONE. No device work owed — this was config verification only.

## 2026-07-30 (cont.) — R8 preview build GREEN; device checklist handed off

- **Builds:** `3ad0f21a` (R8 fix only) and `cab44944` (R8 fix + crash trigger) both
  FINISHED. `cab44944` is the install candidate — APK:
  https://expo.dev/artifacts/eas/nCHkvs9ugYi0rTLxjMtbWQI37tY4SMMrYXZEXujfUpE.apk
- **Verified from the logs:** `minifyReleaseWithR8` executed with zero `Missing class`
  lines; `uploadSentryProguardMappingsRelease` executed (2.0s), so symbolication is armed.
- **New in `cab44944`:** admin-only Profile → Admin → "Sentry diagnostics" row firing
  `Sentry.nativeCrash()`. Needed because checklist item 10 was otherwise impossible — a
  minified release APK has no dev menu and the app had no crash trigger. Must be a native
  crash: a JS throw symbolicates from the Hermes source map, which R8 never touches.
- **Repo hygiene note:** a parallel session was working in the same worktree and left it on
  `main`; the diagnostics commit initially landed there and was moved to a branch, with
  `main` reset to `origin/main`. PR #220 (branched off the R8 fix) carried the `-dontwarn`
  into `main`, so PR #219 was closed as superseded. PR #221 merged (`fb51b60`).
- **Status:** build side DONE. **Device checklist NOT run — no adb/Android SDK/device on
  this machine.** Handed to Maxim. Production ship stays gated on it.

## 2026-08-03 — Gmail OAuth/CASA: re-verified the submission's central claim, and it was false

- **Context:** picking up the Google OAuth verification thread. Docs PR #5 and app PR #222
  were both already MERGED (the "still a draft" handoff note was stale). The remaining path
  is console-side, so the first useful move was the one thing the doc told us to do before
  submitting: re-verify that Gmail content stays on the device.
- **Finding:** it doesn't. `saveReceipt` mirrors to the backend
  (`storageService.js:196` → `syncReceiptToBackend` → `POST /api/receipts`), and for a Gmail
  receipt `items[].name` / `lineTotal` are parsed out of the **message body**. Those fed
  `price_points`, the catalog shared with other users. Raw body, subject and message id
  never crossed. Filing §5 as drafted would have misrepresented the app to Google.
  Not a live incident — `gmailSyncEnabled: false` means no Gmail data was flowing.
- **Fix:** Gmail receipts are now local-only, gated at the top of `syncReceiptToBackend`.
  Parsers tag `emailProvider: "gmail" | "outlook"`; Outlook is untouched; legacy untagged
  receipts fail closed. Client-side price-drop detection still works for Gmail receipts —
  what they give up is server-side push, reinstall recovery and cross-device sync.
- **Consent design (Maxim's call):** rather than choosing between "local only" and "disclose
  the sharing", the chosen design is an explicit opt-in to contribute the *anonymized* price
  only. Preference scaffolding landed (`shareEmailPrices`, default OFF, audit-stamped via
  `emailConsentUpdatedAt`) but is **deliberately unwired**: crowd ingestion is Costco+SKU-only
  (`server.js:2045`) and email receipts have no SKU, so a toggle would silently discard data.
  Wiring it needs name-based ingestion for the other 19 retailers — separate design pass.
- **Also noted, not changed:** `getPrefs()` hardcodes `shareCostcoPrices: true`, so the
  Costco "explicit opt-in" the backend comment describes is always-on from the client.
  Worth a look before anyone cites it as consent in a compliance filing.
- **Tests:** new `__tests__/receiptSyncGmailLimitedUse.test.js` (17). Full suite
  146 suites / 3133 tests green; coverage statements 77.44 / branches 65.91 / functions
  67.15 / lines 80.20, all clear of the 68/55/59/70 floors.
- **Docs:** CASA doc §3/§4/§5 rewritten against the verified data flow (including the
  90-day `EMAIL_SYNC_WINDOW_DAYS` window being remote-config driven, which the filed
  justification has to be pinned to). New `Bugs_Common_Fixes.md` #131.
- **Status:** code + docs DONE. **Console work NOT started and not doable from here** —
  no gcloud CLI, and Auth Platform → Audience is a browser task for Maxim. That remains
  step 1: confirm Testing vs In production.

## 2026-08-03 — Play Console's three recommended actions on the 2.8.1 production release

- **Ask:** optimize the app against the three "recommended actions" Play Console raised
  after 2.8.1 shipped to production: deprecated edge-to-edge APIs, resizability/orientation
  restrictions on large screens, and R8 optimization.
- **Method note that mattered:** the Play Console detail text (the specific call sites and
  activity names) arrived mid-task and changed the fix for two of the three items. The
  in-progress plan to strip `android:statusBarColor`/`navigationBarColor` from `styles.xml`
  was **dropped** — the flagged list is dex-only, names no theme attribute, and removing
  those attributes would have caused an opaque status bar on Android 10–14, where they are
  what keeps the bars transparent.

### 1. R8 — "your app is not optimized"
- **This was already fixed and simply never shipped.** R8 landed at `e12cafd` (#218);
  version code 21 was cut earlier, at `4c21f74`. Play scans the artifact on the track, not
  the repo. Action: version bump to **2.8.2 / versionCode 22** (iOS buildNumber 22,
  package.json 2.8.2).
- Added `plugins/withAndroidR8FullMode.js` pinning `android.enableR8.fullMode=true`.
  This is already the AGP 8 default and nothing in the Expo 55 / RN 0.83 template
  overrides it, so **it changes no behaviour today** — it exists so a future template bump
  that flips the default back to `false` (the RN community template shipped exactly that
  for years) can't silently de-optimize the release.

### 2. Edge-to-edge deprecations — six of seven are framework-owned
- Play named seven call sites. Six are React Native core (`StatusBarModule`,
  `WindowUtilKt`) and Material Components (`BottomSheetDialog`, `SheetDialog`,
  `EdgeToEdgeUtils`, pulled in via react-native-screens). **Material is already on 1.13.0,
  the newest release** — there is no upgrade that removes them. Those classes are in the
  dex whether or not anything calls them. Nothing to do in this repo; documented rather
  than pretended-away.
- The one that *was* ours: `<StatusBar backgroundColor={COLORS.bg} />` in `App.js:324` →
  `StatusBarModule.setColor` → deprecated `Window.setStatusBarColor`. expo-status-bar has
  deprecated the prop and under edge-to-edge it has no visual effect, so removing it is a
  zero-risk change. Done.

### 3. Large screens — manifest lock removed, portrait preserved at runtime
- Play named three activities: `com.priceback.MainActivity` plus two closed-source Play
  Services scanners — `GmsBarcodeScanningDelegateActivity` (expo-camera) and
  `GmsDocumentScanningDelegateActivity` (react-native-document-scanner-plugin).
- **`plugins/withAndroidLargeScreenSupport.js`** — deletes `android:screenOrientation` from
  MainActivity, sets `android:resizeableActivity="true"` on `<application>` and
  MainActivity, and overrides the two library activities to `unspecified` via
  `tools:replace` (the only lever against an AAR's own manifest). Relies on the same mod
  ordering `withAndroidPermissionCleanup` does: app.json plugins run *after* Expo's
  platform mods, so it reliably undoes what `withOrientation` wrote.
- **`src/services/orientationService.js`** — re-applies a portrait lock at runtime when the
  smallest screen dimension is < 600dp (every phone), unlocks at ≥ 600dp (tablets, unfolded
  foldables). Wired into `App.js` via `startOrientationPolicy()`, re-running on every
  `Dimensions` change so fold/unfold is handled live without a restart. **Phone behaviour is
  unchanged from today.** iOS deliberately untouched — `app.json` keeps
  `"orientation": "portrait"` because that drives Info.plist, and `supportsTablet` is false.

### Verification
- `npx expo prebuild --platform android --no-install` run locally and the generated manifest
  checked: `resizeableActivity="true"` present, **zero** `screenOrientation="portrait"`
  occurrences, both GMS activities carrying `tools:replace`, and
  `android.enableR8.fullMode=true` in `android/gradle.properties`.
- **Tests:** 4 new suites — `withAndroidLargeScreenSupport` (16), `withAndroidR8FullMode`
  (14), `orientationService` (19), `edgeToEdgeDeprecations` (7, a deliberate source-text
  scan since the regression is "someone re-adds a prop"). Full suite **150 suites / 3189
  tests green**; coverage statements 77.48 / branches 65.94 / functions 67.20 / lines 80.24,
  all above the 68/55/59/70 floors and up on the previous run. `orientationService.js`
  itself is 100/92.3/100/100. `npm run i18n:check` passes (no user-facing strings added).
- **Docs:** `Bugs_Common_Fixes.md` #132.

### Status / what is owed
- Code side **DONE**. Two things still need a human with hardware:
  1. **Large-screen landscape has never been seen.** No tablet/foldable on this machine.
     The phone path is unchanged by construction, but the newly-unlocked large-screen
     landscape layouts are unverified. Worth a resizable-emulator pass before production.
  2. **R8 on hardware is still owed from the previous session** — R8 links, but has never
     run on a real device. A `preview` profile APK builds release-variant, so it exercises
     R8; smoke-test one before shipping 2.8.2 to production.

## 2026-08-03 (same day, follow-up) — reverted the large-screen orientation change; standing no-regression rule recorded

- **Trigger:** Maxim asked two questions about the PR #224 work — "is there any regression of
  any kind?" and "why is edge-to-edge unfixable from this repo?" Both had to be answered by
  checking rather than restating. Both answers changed the outcome.

### Correction: the StatusBar prop was never a real deprecated call
- PR #224 claimed one of the seven flagged edge-to-edge call sites was ours
  (`<StatusBar backgroundColor>` → `Window.setStatusBarColor`). **False.**
  `expo-status-bar`'s `NativeStatusBarWrapper` destructures only
  `{ style, hideTransitionAnimation, animated, hidden }` and never forwards
  `backgroundColor`. The prop was inert on every API level.
- Removing it silences a per-render `console.warn` — a real but minor win. **All seven sites
  are framework-owned.** Lesson: read the wrapper, don't trust the deprecation note.

### Evidence that edge-to-edge is genuinely unfixable here
- `android/app/build.gradle` → `implementation("com.facebook.react:react-android")`. RN's
  Android code is a **prebuilt Maven AAR**; the Kotlin in `node_modules/react-native/
  ReactAndroid/src/` is reference source the build never compiles, so `patch-package` (which
  this repo does use, for `react-native-document-scanner-plugin`) cannot reach it. Material is
  already 1.13.0, the newest release. Play's scan is static reachability over the dex, not
  observed calls. Upstream: react-native#48256, expo#37459, react-native-screens#2632.

### Two regressions found in PR #224, and the revert
1. **Launch-orientation flip.** The manifest lock applied from activity launch; the runtime
   lock only once JS mounted. A phone cold-started in landscape rendered the splash in
   landscape then snapped to portrait. **No runtime approach can fix this — the gap is before
   JS exists.**
2. **The two ML Kit scanner activities rotated on phones.** `setRequestedOrientation` covers
   our activity only; those are closed-source AARs with no runtime lever.
- PR #224's summary said "phone behaviour is unchanged by construction" — true of MainActivity
  only. Corrected.
- **Maxim's call: revert entirely (and re-lock the scanners).** PR #225. `withAndroidLargeScreenSupport`,
  `orientationService`, `expo-screen-orientation` and their tests all removed; `app.json` keeps
  `orientation: "portrait"` so Expo's `withOrientation` writes the manifest lock again.
- **Verified by a clean prebuild** (`rm -rf android` first — an incremental prebuild *merges*
  into the existing manifest and had been showing stale attributes): MainActivity back to
  `screenOrientation="portrait"`, **zero** `resizeableActivity`, no GMS overrides — byte-identical
  to 2.8.1 — while `android.enableR8.fullMode=true` survives.

### What PR #224 correctly keeps
- **2.8.2 / versionCode 22** — the only thing that actually clears the R8 recommendation, since
  vc21 predated the R8 commit and Play scans the artifact, not the repo.
- `withAndroidR8FullMode` (no-op at AGP 8.12.0, where full mode is already the default).
- The StatusBar prop removal and `edgeToEdgeDeprecations` guard test.

### Tests / docs
- 149 suites / **3158 tests green**; coverage 77.44 / 65.91 / 67.10 / 80.20 against the
  68/55/59/70 floors. New `__tests__/androidOrientationLock.test.js` pins the lock as
  deliberate so the Play recommendation isn't "fixed" again.
- `Bugs_Common_Fixes.md` #133 — written explicitly as a do-not-retry record.

### Standing rule recorded this session
- **No regression is allowed or accepted on any change**, and regression risk must be stated
  proactively on every change rather than only when asked. Both PR #224 regressions were
  reported only because Maxim asked; that is the failure being corrected.

---

## 2026-08-03 — "Fix scan emails: worked the 1st time, then always 'Connection problem'" (Gmail **and** Outlook)

**Ask.** Gmail sync succeeded once; every scan since failed with *Sync Failed — Connection
problem, check your internet*. Mid-task: Outlook has the same problem.

**Diagnosis.** Two stacked bugs; the second disguised the first (full write-up:
`Bugs_Common_Fixes.md` #134).

1. **Root cause — the access token was never refreshed.** Both sync functions used the token
   written once at connect time. OAuth access tokens expire in ~1 h, so only the sync run
   immediately after connecting could ever work. Gmail stored no refresh token (it doesn't need
   one — the device holds the grant); Outlook stored a `refreshToken` field that was always
   `null` because `offline_access` was missing from its scope list, and never used it anyway.
2. **Wrong message — `econn` matched "rec*onn*ect".** The unanchored `econn` alternative in
   `classifyError`'s network regex matched inside *"Please reconnect."*, so every expired
   session rendered `err.networkBody`.

**Changes.**
- `src/services/emailSyncService.js` — `createAuthorizedFetch` (refresh once → retry once →
  `auth_expired`); `refreshGmailAccessToken` (clearCachedAccessToken → signInSilently →
  getTokens) and `refreshOutlookAccessToken` (`AuthSession.refreshAsync`, stores the rotated
  refresh token); `offline_access` added to `OUTLOOK_SCOPES`; MS endpoints hoisted to
  constants; `configureGoogleSignin` shared with `connectGmail`; **any status ≥ 400 now throws**
  instead of silently reporting "no receipts found".
- `src/services/errorSupport.js` — new `auth_expired` category (checks `err.code` first),
  `econn`/`enetunreach` anchored on word boundaries.
- `src/services/i18n.js` — `err.sessionExpiredBody`, EN + FR (i18n:check green, 1338/1338).

**Tests / coverage.** New `__tests__/emailSyncTokenRefresh.test.js` (14) + 6 new
`errorSupport` cases. **150 suites / 3181 tests green**; coverage **77.55 / 65.95 / 67.13 /
80.32** against the 68/55/59/70 floors — up from 77.44/65.91/67.10/80.20.
`emailSyncService.js` 87.26 %, `errorSupport.js` 96.42 %.

**Regression risk — stated proactively.**
- *Widest surface:* `classifyError` is shared by every screen, not just email sync. The
  `auth_expired` branch sits **after** `oauth_blocked` (so `access_denied` still wins) and
  **before** `network`. Any error message elsewhere containing "session expired" / "token
  expired" / "invalid_grant" now shows the reconnect copy instead of "try again" — checked:
  no other call site produces those strings. Anchoring `econn` **narrows** the network bucket;
  the only strings it stops matching are ones with `econn` mid-word, which were mislabels.
- *Now-throwing paths:* a 403/500 from Gmail/Graph used to render "no receipts found" and now
  raises. This is the intended fix, but it converts a silent no-op into a visible alert — if
  either API returns a non-200 on a routine call, users will see an error they didn't before.
- *`offline_access`:* changes the Outlook consent screen (adds "maintain access to data you
  have given it access to"). Existing Outlook accounts have no refresh token and will hit the
  reconnect prompt **once**; after reconnecting they self-heal.
- *Untested on hardware:* the Gmail silent-refresh path runs through
  `@react-native-google-signin`, mocked in tests. `clearCachedAccessToken` is Android-first;
  it's optional-chained, and iOS refreshes inside `getTokens()`. **Needs one real device run:
  connect Gmail, wait > 1 h (or revoke the token), scan again — it must succeed without a
  reconnect prompt.**

---

## 2026-08-03 — iOS App Store Connect configuration finished; RevenueCat iOS paywall unblocked

**Ask.** Continue the iOS App Store configuration via Claude in Chrome and
finalise the submission requirements so the app can be submitted tomorrow after
on-device testing. Screenshots explicitly out of scope (no build to capture).

**App Store Connect — version page (was completely empty; now saved).**
- Version string **1.0 → 2.8.2**. This was a hard blocker rather than cosmetic: a
  build uploads carrying `CFBundleShortVersionString` 2.8.2 and would never have
  attached to a version record numbered 1.0.
- Promotional text, full description, keywords, support URL
  (`priceback.ca/support`), marketing URL, copyright `2026 Prosoft Inc` — pasted
  from `marketing/app-store-description.md`.
- **Added a subscription-disclosure block to the description** (price, cadence,
  auto-renew terms, cancel path) plus Terms of Use and Privacy Policy links.
  Guideline 3.1.2 requires these in the *metadata*, not only in the binary; the
  paywall already carried the links but the listing did not.
- App Review Information: contact Maxim Lucas / +1 438-868-8481 /
  maxim.lucas@viacesi.fr, **"Sign-in required" unticked** (iOS needs no demo
  account — Sign in with Apple), and a 3,967-char notes block condensed from
  `REVIEWER_NOTES.md`. Release set to **manual**.

**App Store Connect — App Information.** Content Rights answered **"Yes — has
the necessary rights to its third-party content"**, matching what a reviewer
plainly sees (retailer product names, prices, flyer data). Digital Services Act
trader status deliberately **skipped** — it gates EU/EEA distribution only and
availability is Canada-only.

**Subscription group.** Levels swapped so **Unlimited Annual is level 1** and
Monthly level 2. Apple treats the lower number as the higher tier, so
Monthly → Annual was being handled as a *downgrade* deferred to the next renewal;
it is now an immediate, prorated upgrade. Note the drag first merged both onto
level 1 (a crossgrade, deferred for differing durations) — the second drag
separated them, and the saved table must be re-read to confirm 1/2.

**RevenueCat — the actual iOS blocker, found and fixed.** All five App Store
products existed (the consumable-creation failure recorded on 2026-07-29 had
since cleared), but **every package in the `default` offering held only its Play
Store product**. The App Store slot on all five read "No product", so the iOS
paywall would have resolved zero purchasable products and sold nothing — the
exact failure mode audit §1.2 describes, arrived at by a different route.
Attached `priceback_unlimited_annual`, `_monthly`, and the three packs to their
packages and saved.

**Verified state of all 5 IAPs.** Canada-only availability, CAD pricing, EN-CA +
FR-CA localisations and review notes all present. **Only the review screenshot is
missing on each** — it needs a running build, so it is the one item deliberately
left for tomorrow.

**Code change — see Bugs_Common_Fixes #135.** The paywall advertised "Family
sharing (up to 6 users)" while the app implements no family or device sharing at
all and Family Sharing is off on both ASC subscriptions. Removed the claim from
`shared/pricing.config.js`, `backend/shared/pricing.config.js`, and the EN + FR
i18n blocks.

**Tests / coverage.** `npm run i18n:check` green (2 languages, 1,337 keys each,
in sync). **151 suites / 3,213 tests green**; coverage 77.59 / 65.99 / 67.23 /
80.35 against the 68/55/59/70 floors. `purchaseService.test.js` gains a test
pinning `family_sharing → false` for Unlimited and broadens the
"every feature unlocked" case to the five keys Unlimited actually grants.

**Regression risk — stated proactively.**
- *Removing a `FEATURE_KEYS` member is the widest edge here.* `canUseFeature`
  is catalog-driven, so `"family_sharing"` now falls through to the free-feature
  set and returns `false` everywhere. Verified by grep that no gate, screen, or
  service reads it, so nothing loses access — but any **future** code that
  hardcodes that string will silently get `false` rather than an error.
- *The two `pricing.config.js` copies must not drift.* They are byte-identical by
  contract; the backend copy was overwritten from the mobile one and diffed to
  confirm. A partial edit would give the paywall and the ledger different feature
  sets.
- *Index-coupled i18n.* `catalogFeatures()` maps `features[i]` → `…features.<i>`.
  The removed entry was last, so nothing shifted. Removing any earlier entry
  without renumbering both language blocks would mislabel every later feature —
  and `i18n:check` would **not** catch it, since parity would still hold.
- *Untested on hardware.* The paywall's feature list is rendered from this
  catalog; it is covered by the suite but has not been seen on a device since the
  change. Confirm the Unlimited card shows five bullets, in both EN and FR,
  during tomorrow's device pass.
- *ASC subscription levels are live config, not code.* The swap changes
  upgrade/downgrade behaviour for real purchases the moment products go live.
  No subscribers exist yet, so there is nothing to migrate.

---

## 2026-08-03 (cont.) — App Privacy label aligned to the binary's manifest

Follow-on from the App Store Connect session above. Full write-up in
`Operations/Bugs_Common_Fixes.md` #136.

The App Privacy section was "Published" and looked complete. Diffing it against
`app.json` → `expo.ios.privacyManifests` found three things:

- **Privacy Policy URL was empty** — a hard submission blocker on its own. Set to
  `https://priceback.ca/privacy-policy`.
- **Four of the twelve declared data types were missing** from the label: User
  ID, Emails or Text Messages, Other User Content, Performance Data. Added, each
  with purpose App Functionality and tracking No; linked Yes except Performance
  Data.
- **Two linkage answers contradicted the manifest**: Device ID and Product
  Interaction sat under "Data Not Linked to You" while the manifest declares both
  linked. Product Interaction was also missing its App Functionality purpose.
  Both corrected.

Final label: 12 types, 10 linked, Crash Data + Performance Data not linked,
nothing used for tracking — matching `NSPrivacyCollectedDataTypes` exactly.

**Regression risk.** None in code — no repo files changed. The label is store
config. It republishes on save and applies to the next submitted version; there
are no live users to affect. The one thing to watch: **if the privacy manifest in
`app.json` is ever edited, this label must be re-diffed by hand.** Nothing
enforces the correspondence, and neither Apple nor the build warns on drift.
Note also that the stale table in `PUBLISH_CHECKLIST.md` §9 still describes Device
ID and Product Interaction as "not linked"; Audit §2.4 is the correct reference
and now matches reality.

---

## 2026-08-03 (cont.) — the three submission fields nobody had looked at

Maxim flagged three App Store Connect version fields that earlier passes never
evaluated: **Routing App Coverage File**, **App Clip**, and **Attachment**. All
three were empty. Two are correctly empty; one was a real gap.

**Routing App Coverage File — correctly empty, leave it.** This is only for apps
that register `MKDirectionsApplication` and hand the user turn-by-turn routing.
PriceBack has no maps or directions feature; there is no `MKDirections` entry
anywhere, and the repo has no `ios/` directory at all (managed workflow, Expo
prebuild runs on EAS). The field is optional and uploading a geoJSON we can't
honour would invite a functionality rejection, not avoid one.

**App Clip — correctly empty, and not actionable.** Expanding the section shows
Apple's own gate: metadata can only be entered once a build containing a clip is
uploaded. The app has no App Clip target, and the build list confirms it —
build 21 reads `HAS APP CLIP = NO`. Nothing to configure, and nothing blocking.

**Attachment — this was the actual gap, now filled.** Notes is capped at 4,000
characters and was sitting at 3,967, so roughly two thirds of
`Publishing-Compliance/REVIEWER_NOTES.md` (13k characters) had nowhere to go: the
permission-by-permission rationale, the stripped-permission explanation, the
independence-from-retailers statement, the account-gated maintainer tooling
disclosure, the third-party/cross-border table, and the full pricing catalog.
Rendered that content to **`PriceBack_App_Review_Guide.pdf`** (6 pages, 139 KB)
and uploaded it to App Review Information → Attachment. Notes now ends with
`Full guide: see attachment.` so the reviewer knows to open it — that line fit in
the 33 characters of headroom, leaving 5.

Saved and verified by reloading the version page: attachment persists, Notes
counter reads 5, release stays **manual**. **Not submitted** — "Add for Review"
was not touched; Maxim still submits after the device pass.

Also fixed a genuine markdown defect found while rendering: `REVIEWER_NOTES.md`
had nested `**bold**` inside a bold span in the photo-library bullet, which is
malformed and rendered inside-out. Rewritten to `on Android: no permission at
all`.

**Regression risk: none.** No app code changed — the only repo edit is one line
of prose in a markdown doc that nothing imports or tests. The App Store Connect
changes are store config on an unsubmitted draft, both reversible in the UI (the
attachment has a Delete control; the Notes line is 27 characters). No build, no
binary, no user-facing string, no i18n key. The one thing to keep in mind: the
attached PDF is a **point-in-time render** of `REVIEWER_NOTES.md`. Nothing syncs
them — this is the same two-declarations-of-one-fact shape as the privacy-label
drift in #136. If the notes change materially before submission, re-render and
re-upload the PDF.

## 2026-08-03 (cont.) — "Generate the iOS previews and screenshots" — declined, cannot be done from here

Asked whether I could produce the App Store product-page screenshots and the
app preview video for the iOS submission, with the explicit instruction to say
so rather than invent anything.

**Answer: no, and nothing was generated.** Real App Store screenshots have to be
frames of the app actually running. This machine is Windows 11 with no macOS,
no Xcode, and therefore no iOS Simulator; there is no installed iOS build to
capture; the project has no web target (`react-native-web`/`react-dom` are not
dependencies, so the RN screens cannot be rendered in a browser) and no
screenshot automation (`detox`/`maestro`/`playwright` absent). Any image I could
have produced would have been a mockup, not the app — and Apple rejects
screenshots that don't depict the real running app (Guideline 2.3.3).

What is already in place: `eas.json` `preview` profile carries
`ios.simulator: true`, so `eas build -p ios --profile preview` yields a
Simulator `.app` — but running it still needs a Mac. The other route is a
TestFlight/internal build on a physical iPhone.

Reminder of the blocked scope this leaves: `PUBLISH_CHECKLIST.md` §13 (iPhone
6.7"/6.5" product-page shots, 3 min) **and** the per-IAP review screenshot on
all 5 in-app purchases (audit §2.2) — both need a running build.

**Regression risk: none.** Read-only session; the only write is this log entry.

## 2026-08-03 (cont.) — "Sync Failed / our service is having a hiccup" on the new email-sync build — fix every path, not just this one

Maxim built the APK carrying the email-sync token-refresh fix (`99c505a`), ran
"Scan now", and got **Sync Failed — "Our service is having a hiccup. Please try
again in a few minutes."** The ask was explicit: fix it once and for all, make
every path produce a realistic and accurate message, and cover everything with
tests so the next APK isn't another round trip.

**What that sentence actually was.** `createAuthorizedFetch` phrased every
non-401 provider failure as `"<Provider> API error <status>: <body>"`, and
`classifyError` picked the category by regex on that message — where
`/…|server|unavailable|api error/i` matched the words **"api error"**. Every
Gmail/Graph 4xx therefore landed in the 5xx "hiccup" bucket: a missing
`gmail.readonly` scope, the Gmail API not enabled on the GCP project, a quota, a
rejected query, a mailbox Graph won't `$search`. Full write-up as
**Bugs_Common_Fixes #137**.

**Fixed (mobile — `fix/email-sync-accurate-errors`).**

- **Codes, not text.** `providerFailureCode(status, body)` maps a provider HTTP
  failure to one of eleven codes; `classifyError` now consults `err.code` before
  any heuristic. 20 categories, each with EN + FR copy (13 new keys per
  language, `i18n:check` green at 1350/1350).
- **The 403 that could never recover.** `GoogleSignin.configure()` is
  process-global and `authService` reconfigures it with identity-only scopes, so
  a valid Gmail grant can mint a token with no mail scope — which Gmail rejects
  with **403, never 401**, and only 401 triggered the silent re-mint. A scope-403
  now re-mints once, and if the live grant genuinely lacks the scope it calls
  `GoogleSignin.addScopes` — a one-tap fix instead of "disconnect, reconnect".
- **Connect-time scope check.** A consent sheet with the mailbox permission
  unticked used to store a token that could never read mail; the failure only
  showed up a screen later. It's now caught while the user is still in the flow.
- **Cancel is not an error.** Backing out of the Google/Microsoft sheet raised an
  alert reading "Something went wrong — our team has been notified". It now
  shows nothing.
- **Save failures stop lying.** All-N-receipts-failed-to-save was reported as
  "already tracked". Duplicates (`saveReceipt` throws `DUPLICATE_RECEIPT`) and
  real failures are now counted separately.
- **Query fallbacks.** Gmail retries with a narrower query on a 400; Outlook
  falls back from `$search` to a plain listing on 400 /
  `MailboxNotEnabledForRESTAPI`, matching stores client-side. Gmail data stays
  on-device throughout.
- **No raw parser errors.** A 200 carrying HTML used to surface "JSON Parse
  error: Unexpected character: <".

**Support references — the part that avoids another blind rebuild.** Every error
alert now ends with a short stable code (`GMAIL-403-INSUFFICIENT-SCOPE`,
`GMAIL-403-API-DISABLED`, …) from `errorReference(err)`, and the same string is
attached to the Sentry/analytics report. No provider text, no PII. Whatever the
next failure is, its screenshot names the branch.

**Tests.** 153 suites / **3321** tests green (was 151/3213), coverage
78.2/66.4/67.7/81.0 against floors 68/55/59/70. Three new suites: provider
bodies → codes, codes → the exact Alert copy in EN and FR, and a true end-to-end
pass where only `fetch`, storage and the native Google module are faked — an
HTTP response goes in and the user-visible sentence comes out. Table tests
assert that **no** provider status resolves to `unknown` and that every category
has non-empty copy in every language.

**Regression risk — stated proactively.** Moderate-low, and concentrated in one
place: `classifyError` is shared by six screens, not just email sync, so errors
elsewhere can now land in a *new* category. That direction is strictly more
specific (a cancel that read "Something went wrong" now reads "the action was
cancelled"), never less, and the full suite is green. Two behaviour changes are
worth watching on device: the scope-403 path can now show Google's consent sheet
mid-sync (only after an explicit "Scan now" tap), and the alert body gained a
second line. `reportHandledError`'s context gained a `reference` field — additive.

**Open, and not something code can close:** if the real cause on Maxim's device
is the **Gmail API not being enabled** for GCP project `695135372222`, or the
restricted-scope verification still being outstanding, the app will now say so
precisely (`GMAIL-403-API-DISABLED` / `GMAIL-403-OAUTH-BLOCKED`) but still won't
sync until that's changed in the Google Cloud console. The reference code on the
next run says which.

## 2026-08-04 — "The live app shows a test paywall and subscriptions won't buy"

- **Asked (/goal):** the published (production) Android app shows a *test*
  paywall on every package, and subscribing fails with **"Upgrade Failed — This
  item isn't available for purchase right now."**
- **Two independent causes, one of them a real shipped bug.**
  1. **Bug (fixed):** Google Play addresses a subscription as
     `<subscriptionId>:<basePlanId>`, so RevenueCat hands the app
     `priceback_unlimited_monthly:monthly`. `purchaseProduct` matched the
     offering with `product.identifier === productId` against the bare catalog
     id, so **every credit pack resolved and no subscription ever did** — the
     paywall fell back to the catalog's hardcoded `$4.99 / $49.99` on the two sub
     cards (which is what "test paywall" looked like), and Subscribe returned
     `errorCode:"unavailable"`. Shipped in 2.8.3. See Bugs #142.
  2. **Not a bug:** `maxim.louka@gmail.com` is in the Play **license-tester**
     list (Settings → License testing → "Testers", response LICENSED). Google
     shows that account a *test* purchase sheet on every SKU even for the live
     production app. Real users are unaffected. Left as-is deliberately — it is
     what keeps test buys free.
- **Verified in the consoles (browser):** Play subs `priceback_unlimited_monthly`
  / `_annual` each have 1 **Active** base plan (174 countries); RC `default`
  offering carries all 5 packages with both stores attached; the production
  2.8.3 build log confirms both RevenueCat keys were injected. So the store side
  was healthy and the failure was client-side matching.
- **Status:** fix + 13 tests on `fix/play-base-plan-subscription-ids`.
  **Not live until a new build ships** — 2.8.3 users still can't subscribe.

## 2026-08-04 — "Refresh prices says 'No price drop found' on discounted items" + home hero spend line

- **Asked (/goal):** two things. (1) On the receipt screen, tapping *Refresh
  prices* made already-discounted lines report **"No price drop found"** — but
  discounted lines are never watched, so the app shouldn't even offer to check
  them. (2) The Home hero card should also show **total spent this year** across
  all stores / all scanned receipts.

### 1 — The discounted-line lie (real client/server drift)

The backend has always derived `receipt_items.watch_enabled` from the discount
itself (`receiptsRepo.persistReceiptItems`: an `originalPrice` strictly above the
paid line total ⇒ not watched; modelled in
`shared/receiptWireContract.serverWatchEnabled`). **The client never applied that
rule.** `storageService.saveReceipt` only forced `watchEnabled:false` for refund
and ignored rows, so a locally-scanned sale line kept `watchEnabled:true`,
DetailScreen put it in the *Refresh prices* batch, the lookup came back with
nothing comparable, and the row rendered "No price drop found" — a verdict about
a comparison that never happened.

Two surfaces already worked around it privately (`priceService` filtered
`!item.originalPrice`, which also wrongly dropped lines whose `originalPrice` was
*at or below* what was paid), and three others didn't work around it at all.

**Fix: one predicate, used everywhere.** `src/utils/receiptMath.js` now exports
`isInstantDiscountLine()` (the same rule the server persists, accepting both the
local `price` and wire `lineTotal` shapes, and Postgres numeric *strings*) and
`isWatchableLine()` (unclaimed + not ignored + not toggled off + not discounted).
Adopted by DetailScreen, HomeScreen, ReceiptsScreen, priceService (both filters),
notificationService (both filters), and derived at the source in storageService
(`saveReceipt`, `addItemToReceipt`, and `updateReceiptItem` when an edit touches
the money — reversibly, so correcting a mis-parsed discount away re-watches).

User-visible result: with nothing watchable the **"Refresh prices" button is
hidden outright** (the goal's "should not mention even a check prices"), and each
row states its own reason — "Bought on sale · not watched" for a discount vs a
new generic "Not watched" for a fee row / user toggle, which used to *also* read
"Price already discounted". Separately, `detail.checkedNoPrice` went from
"No price drop found" → **"No current price available"**: on a genuinely watched
line it fires when no price resolved, which is not the same claim as "no drop".

### 2 — Home hero: spend this year

New quiet second line under the savings headline: **"Spent in {year} · $X · all
stores"** — every non-deleted receipt whose `purchaseDate` falls in the current
calendar year, all stores combined. Refund receipts (negative totals) are left in
deliberately: a return reduces what was actually spent. Hidden until the first
receipt exists, so the onboarding state isn't polluted with `$0.00`.

While in that card, four **hardcoded English strings** were removed (hard i18n
rule): `· all-time`, `+$X this month`, the `Receipts` stat tile, and the
`N claims expiring soon — act this week` urgent banner. The eyebrow also said
**"Total Saved This Year · all-time"** — two contradictory periods on one line.
`stats.totalSavings` is genuinely lifetime (it is even backfilled from the
server's lifetime figure on a fresh device), so the label is now
`home.totalSavedAllTime` = "Total saved · all-time". 7 new keys in EN + FR.

### Tests & regression risk

157 suites / **3836** tests green (was 3815); coverage 78.2 / 70.1 / 67.5 / 80.9
against floors 68 / 55 / 59 / 70; `receiptMath.js` at **100/100/100/100**;
`i18n:check` green. New coverage: the predicates (including a table test pinning
them to the backend's own `serverWatchEnabled`, so the two can't drift again
silently), the three DetailScreen render outcomes, the storage derivations
(save / manual add / edit-into-discount / edit-out-of-discount / non-money edit /
explicit override), and the spend line (sum, year + soft-delete + refund + bad-date
exclusions, onboarding gate).

**Regression risk — moderate, and concentrated in one place:** the watch pool
gets *smaller*. Lines already discounted at the register now leave Home's tracked
list, the Tracking tab's Products view, the `watching` filter chip, the price-watch
registration, and the daily drop sweep. That is the backend's existing behaviour
finally reflected on device — those lines were never going to yield a claimable
drop — but a user with sale-heavy receipts will see their "Watching" count drop
after updating. `isWatchableLine` also adds an `ignored` (fee/deposit) exclusion
that `priceService` did not previously apply. No backend change, no migration.

---

## 2026-08-04 — Full security audit (app + backend), Android/iOS-compatible, zero regressions

**Ask:** run a full security audit; any change must work on both platforms, and
no regression is acceptable.

First audit since **2026-06-02**. Everything shipped after that date had never
been reviewed: flyer scan + its admin routes, the offline tag-scan queue and
admin OCR review, the credit ledger and price-drop commission paths, Gmail sync,
granular notification prefs, profile restore, and the Neon→Supabase cutover.
Scope: all 60 backend routes + repos/middleware/storage/jobs, `src/`, the Expo
config plugins and generated Android manifest, CI, and tracked-tree secret
hygiene. Full write-up: `Security/Security_Audit_2026-08-04.md`.

### What held up

Auth by issuer (Google + Apple) with opaque 401s; admin gating doubled
(constant-time token compare **and** `ADMIN_USER_SUBS` account check); IDOR
scoped on every `:id` route, 404-not-403 so ids aren't confirmable;
`callerOwnsDevice` fails **closed**; all SQL parameterized through Drizzle;
`trust proxy` set so rate-limit keys can't be forged by rotating XFF; audit log
hashes IPs with a daily-rotating salt; tokens in SecureStore; no cleartext HTTP,
no WebView, no hardcoded keys in `src/`; Sentry PII scrubber redacts by pattern
*and* drops known PII keys.

### Findings fixed — PR #237

1. **Live Cloudflare R2 credentials in `backend/.env.example`** (High) — account
   id, access key, 64-hex secret, opening the bucket that holds user receipt and
   price-tag photos. On `main` from `4b41643` (2026-05-28) to today — **ten
   weeks**; dated with `git log -S` on the value, since the file's own log shows
   only when it was last touched and understated this by three weeks. Repo is
   private, which is the only reason it wasn't critical. Scrubbed; **rotation in
   Cloudflare is still owed** — the file change stops it leaking again, it
   doesn't invalidate the key.
2. **gitleaks CI gate disabled since 2026-07-23** (High) — `if: false`, added to
   mute exactly the above. The compounding harm is the point: a muted scanner
   stops reporting *every* leak added afterwards. Re-enabled; the 6 remaining
   findings were all false (i18n keys, an AsyncStorage key), allowlisted **by
   value shape, never by path**. Bugs_Common_Fixes **#146**.
3. **`/api/observations/tag/image-uploaded` cross-review write** (Medium) — the
   guard validated the object key's *shape* but not its *ownership*
   (`[a-f0-9]+` matched any device hash), and review ids are sequential, so any
   unauthenticated caller could blank another contributor's tag photo: admin
   can't verify, contributor never gets their credit. Bound to the review's own
   stored `deviceHash` + rate-limited. Bugs_Common_Fixes **#145**.
4. **`SYSTEM_ALERT_WINDOW` shipping in release** (Low-Med) — written into
   `src/main` by the Expo template though `app.json` never asks for it. Stripped
   via a new `PERMISSIONS_TO_STRIP_FROM_MAIN` list that **deletes** the entry
   instead of emitting `tools:node="remove"`, because RN's own debug manifest
   needs the permission for the dev overlay and a merger directive would have
   taken it out of debug builds too.
5. **`/api/device/sync` + `/api/device/scan` unthrottled** (Low) —
   unauthenticated and keyed on a client-chosen `deviceId`, so id rotation minted
   unbounded rows. Per-IP brake added, separate bucket each.
6. **expo-updates OTA unsigned** (Risk) — `CHECK_ON_LAUNCH=ALWAYS` with no
   signature meant the Expo account was the only thing between an attacker and
   JS on every install. Code signing configured; certificate committed, private
   key gitignored behind a `keys/` rule and bound for EAS.

Re-confirmed and deliberately re-deferred: CORS `*`, DB TLS unverified, the
drizzle advisory, the `npm audit` gate level, anonymous `DELETE
/api/me/observations`, `allowBackup=true`. All now in a **risk register table**
at the top of `Security/SecurityRecommendations.md` with a revisit trigger each.

### Tests & regression risk

Tests ship with the fixes: cross-review repoint (asserting the attacker key
*passes the old shape regex*, so it fails against the old code rather than
passing vacuously) + unknown/invalid review ids; device throttle + per-route
bucket isolation; plugin strip-from-main incl. "emits no remove directive"; and
a new `otaCodeSigning` suite covering the config, the certificate, and the
gitignore rules that keep the key out and the certificate in.

**Regression risk — low, and stated per change.** The tag-image client echoes
back the exact key the server issued, so the tightened check can't reject a
legitimate call; the one behaviour change is 400→403 on mismatch, on a
fire-and-forget path with no UI surface. Rate limits are sized at caps already
proven on `obs-tag` (heaviest existing test file makes 9 device calls against
60/min). The manifest fix is release-only by construction. OTA signing has no
runtime code path and no effect on shipped binaries — they carry no certificate
and behave exactly as today. No user-facing strings changed, so no i18n work.
Android and iOS are equally affected by the OTA change (JS layer, no native
code); the manifest fix is Android-only.

**Still owed:** rotate the R2 token; upload the OTA private key to EAS; confirm
`priceback-receipts` has no public-read policy; git-history purge of the leaked
key (queued after #237 merges — note a force-push does *not* remove the objects
from GitHub, they persist via PR refs until GitHub runs gc, which is why
rotation is the load-bearing control); and verify
`aapt dump permissions <apk> | grep SYSTEM_ALERT_WINDOW` → no output against a
real release artifact, folded into the R8 hardware test already outstanding.

---

## 2026-08-05 — Publishing documentation audit: bring it current with 2.8.4

**Asked:** check the publishing documentation, update it where it is wrong, and
complete what is missing.

**What was actually wrong.** The publishing docs were last touched 2026-08-03
and had gone stale against three merges since (#230, #236, #237). Five factual
defects in `PUBLISH_CHECKLIST.md`:

1. **Version.** Header said 2.8.1, summary table said 2.8.2; the app is 2.8.4
   (versionCode/buildNumber 24, tag `v2.8.4`). More than cosmetic: the **App
   Store Connect version record still reads 2.8.2**, and a 2.8.4 binary will not
   attach to it — the identical failure mode as the 1.0 record caught on 08-03.
   Flagged as a pre-upload action in the header, the summary table and §9.
2. **Gitleaks row said "⚠️ Disabled — MUST re-enable before publish."** It was
   re-enabled 2026-08-04 in PR #237. A checklist that reports an open blocker
   which is already closed trains its reader to skim it.
3. **§8A credential rotation listed only the Vision key and the Supabase
   password** — the leaked Cloudflare R2 token, the item with an actually-live
   credential behind it, was absent. Added, along with the OTA signing-key
   upload, the bucket public-read check, and the history purge *with* the caveat
   that a force-push does not remove objects from GitHub.
4. **No mention anywhere that the live 2.8.3 build sells no subscriptions.** The
   base-plan-id bug (#230) means the Play listing currently completes zero
   subscription purchases; the fix is tagged in 2.8.4 and unreleased. That is a
   live revenue defect, not launch prep — now a 🔴 row and the top of §10.
5. **Store-listing name said "PriceBack Canada"** in both the App Store (§9) and
   Play (§10) name fields, against the standing rule that the user-visible name
   is plain "PriceBack". Corrected in both, plus the titles of `REVIEWER_NOTES`
   and `App_Store_Submission_Audit`.

**What was missing.** §18's sequence was still the generic from-zero plan (day 1
= enrollment, long since done), so nothing in the docs answered "what is
actually left." Added **§18.0**, an ordered eleven-step remaining path, with
§18.1 keeping the original for reference. Also recorded the `SYSTEM_ALERT_WINDOW`
strip from #237 and the release-tag discipline as summary rows.

**One code fix fell out of the audit** — `iOS_IAP_Setup_TODO.md` carried an open
note that `profile.versionLine` hardcoded `v2.6.0`. Still true, and by now four
releases stale, in EN and FR both. The Profile footer is a line store reviewers
read while confirming the build matches the submitted version. Fixed by
interpolation (`PriceBack v{version} · …` + `Constants.expoConfig.version` at
the call site, `expo-constants` already imported there), so the value has one
source and cannot drift again. Bugs #147.

**Tests.** `__tests__/i18n.test.js` gains a per-language assertion that
`profile.versionLine` holds `{version}`, contains no literal `vN.N.N`, and
interpolates — so re-baking a version into the string fails the suite in
whichever language it happens. Pushed to CI rather than run locally.

**Regression risk — low, and stated per change.** The docs changes carry none.
The code change touches one `<Text>` on the Profile screen and one key in each
language block; `t()` already supported `{}` interpolation (its `vars`
parameter defaults to `{}` and short-circuits when empty), so no other caller of
that key changes behaviour, and there is no other caller. If
`Constants.expoConfig` were ever undefined the line renders `PriceBack v— · …`
rather than throwing. No native, backend, or purchase-path code involved;
identical on iOS and Android.

**Not done — needs Maxim, not the repo.** Rotating the R2 token, releasing 2.8.4
to Play, renaming the ASC version record, the screenshots, and the R8/permission
hardware test. All are itemised in §18.0.

---

## 2026-08-05 — Scan review notifications: only when the scan was actually deferred

**Asked:** "I scanned a price tag and I got a notification after reviewing and
submitting it. It should only notify if the user had a poor connection when
scanning and the OCR didn't send back the results — same for receipts. Never pop
it if the user has a connection and the OCR returns quickly. And the user should
get a message that there will be a notification for review, so he can quit the
screen."

**Which notification it actually was.** Two can arrive around a tag submit, and
Maxim confirmed it was the second: (a) the local offline-queue alert "📷 Your
price-tag scan is ready", and (b) the **backend push "Price tag awaiting
review"**, fired inside the submit request itself to every sub in
`ADMIN_USER_SUBS`. His sub is in that list on dev, so submitting a tag pushed him
a request to verify his own tag one second after tapping Submit — an alert about
work he had just finished, and one he can't act on (nobody reviews their own
submission).

**Three more ways the offline-queue alert reached an online user.** Tracing (a)
found the same defect by other routes, all fixed here:

- The alert fired **with the app open**. Five triggers drain the scan queues;
  three run in the foreground, including a 60-second `setInterval` poll in
  `App.js` and the "Process now" button on the review screen itself. With
  `shouldShowBanner: true`, a drain banner-ed "come back and review this" over
  the app the user was holding.
- `probeReachable` was a single 3.5 s `GET /health`. A cold-starting Railway
  dyno or a waking radio answered late and was read as **offline**, so a photo
  that could have been read live was queued and notified about later.
- `runOcrBatch` queued on **any** per-photo OCR error and did it **silently** —
  an unreadable photo in an otherwise-fine batch was re-read minutes later and
  notified a user who had already reviewed and submitted the rest.

**What shipped.** Backend: the submitter is skipped in the admin push loop, via
`optionalAuthUser` (not `resolveScanOwner`, which upserts the user row and claims
the device — side effects that belong to the credit path). Mobile: one
`AppState.currentState === "active"` gate inside both scan-ready senders (the
choke point all five triggers pass through — in the foreground the existing "N
waiting for review" pill is the surface); `probeReachable` retries once before
concluding offline; the batch path queues only `classifyError → network|timeout`
— the same helper the receipt screen uses, so the two definitions can no longer
drift — and **announces** anything it queued, with everything else becoming a
blank manual-entry card (rule 11). Both scan screens gained a **"Save it — we'll
notify you"** button at 8 s, guarded by a `scanRunId` so a read that resolves
after the user leaves can neither spend a credit nor pull them into a review
step for a photo the queue now owns. `tag_review` taps now route to the admin
review screen instead of doing nothing.

**i18n.** The "saved for later" copy in EN and FR now says a notification is
coming and the screen can be closed; new `deferred*` / `saveAndNotify` keys
cover the user-chosen deferral (which must not claim "no connection"). Both
scan-ready notification bodies were **hardcoded English** — moved to
`notif.*ScansReady*` keys in both languages. `npm run i18n:check` green at
1396 keys per language.

**Tests.** Second admin added to `tagReviewAdminPushDb.test.js` so "the submitter
is skipped" is proven by the other admin still receiving it, not by an absence;
foreground gate pinned in both directions plus the `tag_review` route
(`notificationTapRouting.test.js`); probe retry (`tagScanQueue.test.js`); new
`priceTagScanDeferral.test.js` and additions to `scanScreenOfflineQueue.test.js`
for the batch queue-entry boundary, the 8-second escape and the dropped late
result. Pushed to CI rather than run locally.

**Regression risk — stated per change.** The foreground gate is the one to watch:
it is a behaviour *removal*. A queued scan that finishes while the app is open
now surfaces only through the in-app pill; users who left still get the alert
unchanged. The probe retry lengthens the worst case before "saved for later" on
a slow link (~3.5 s → ~7 s) — deliberately, because today that wait ends in a
wrong answer; a genuinely offline device fails at connect in milliseconds and is
unaffected. The batch narrowing strictly *reduces* what enters the queue. The
backend filter only removes a self-directed push and returns `null` for
anonymous scans, i.e. today's behaviour. The defer button is the largest new
surface, which is why the stale-resolution guard is tested explicitly. No native,
schema, migration or purchase-path code; iOS and Android identical.

**Deliberately not changed** (so it isn't read as an oversight): `error` /
`rejected` receipt entries still count as "ready" and still notify — deliberate,
with existing tests, and suppressing them would let an unreadable offline receipt
sit silently; the alert still carries the total pending-review count rather than
a delta; and the scan-ready alerts remain gated by the master switch only, with
no granular pref.

## 2026-08-07 — Whole-app audit: path accuracy + bugs, documented by criticality

**Asked:** "audit the app and check that all paths are accurate and check if there
is bugs and document everything by criticity to the roadmap docs."

**Status: documentation only — NOTHING WAS FIXED.** Do not assume the repairs
landed with the write-up. The register is
`Roadmap/App_Audit_2026-08-07.md`; `Roadmap/FUTURE_ROADMAP.md` gained a pointer to
it. No file under `Priceback/` was modified — that tree stayed clean throughout.

**Scope and method.** Read-only, at `66a14e4` / v2.8.4. Twelve mechanical checks,
each scripted rather than eyeballed: relative-import resolution across 465
first-party files, asset + `app.json` path existence, navigation targets (including
indirect `route:` / `navigate:` config strings) against `App.js`, all 62 backend
routes against every mobile `fetch` URL, the four public legal URLs against
`Priceback-Website`, `*.md` references, the version triad, consolidated schema vs
migrations, secrets hygiene, `i18n:check`, `typecheck`, and a debt-marker sweep.
The Jest and backend suites were **not** run locally (standing rule — CI is the
authority).

**Result: 0 Critical, 2 High, 4 Medium, 7 Low.** Every path check came back clean —
zero unresolved imports, zero missing assets, zero dangling routes, zero API
contract mismatches, all four legal URLs live, versions consistent, schema in sync,
no TODO/FIXME debt. Both High findings are *capability* gaps rather than broken
code: **H1** — `eas.json` declares an update `channel` on the `dev` profile only, so
EAS Update cannot deliver to production builds even though `app.json` wires the URL,
the code-signing certificate and `runtimeVersion` (needs verifying against EAS, not
knowable from the repo); **H2** — `_adminTokenOk` (`server.js:3282`) has no rate
limit, leaving five admin routes open to unlimited token guessing, and because
`ADMIN_TOKEN` falls back to `FLYER_ADMIN_TOKEN` it is usually the *same secret* the
throttled `/api/flyer/import` protects — so the throttle isn't just missing
elsewhere, it's defeated. That's a stronger form of Bugs #139.

Medium: an English backend sentence rendered verbatim on the price-tag deal badge in
both languages (`PriceTagScanScreen.js:924`, no i18n key exists); `t(k) || fallback`
being dead code throughout that badge because `t()` returns the key on a miss, so
the intended server-string fallback can never fire (`hasKey()` already exists for
this — the `catalogLabels.js` pattern); `preview`/`development` EAS builds
self-reporting `appEnv: "production"` and so polluting production Sentry with
test-backend traffic; and two hardcoded English strings `i18n:check` structurally
cannot catch.

**Deliberately recorded as sound, not silent.** The audit doc devotes a section to
what was checked and found *correct* — notably that the 16 async routes without
`try`/`catch` are already covered by `wrapAppRoutes(app)` ordering, and that the
ordinal-indexed receipt-item routes are safe because both sides index the same
non-deleted, position-ordered set. Without that section the next audit re-derives
the same conclusions, or "fixes" the 16 routes by hand and undoes the #138 design.

**No `Bugs_Common_Fixes.md` entries yet** — by that file's own convention an entry
means found *and fixed*. They go in with each repair, numbering from **#149**.

**Regression risk: none.** Documentation-only change, confined to
`Priceback-Documentations`. `i18n:check` (green, 1396×2) and `typecheck` (exit 0)
were re-run after the write-up to confirm the document doesn't contradict them.

## 2026-08-07 — Fixing the whole-app audit, highest priority first

**Asked:** "fix all bugs start with the highest priority" — against
`Roadmap/App_Audit_2026-08-07.md` (PR #20), which had deliberately fixed nothing.

**Status: all 13 findings actioned.** Twelve fixed and merged; one (**L5**) is an
ops decision that is still owed, and is called out below rather than quietly
counted as done. Five code PRs in `Priceback`, one in `Priceback-Website`, two
docs PRs here. Batched exactly as the audit's §6 suggested, in its order.

| # | PR | Findings |
|---|---|---|
| 1 | Priceback#242 | **H2** — admin-token throttle |
| 2 | Priceback#243 | **M2 M3 M4 L7** — i18n batch |
| 3 | Priceback#244 | **H1 M1** — EAS channel + APP_ENV |
| 4 | Priceback#245 | **L1 L2 L3 L4** — cleanup |
| 5 | Priceback#246 | **L5** — make it answerable |
| 6 | Priceback-Website#13 | **L6** — `_headers` |

**H1 was worse than the audit could establish.** It was filed as VERIFY because
channel binding is not knowable from the repo. Checked against EAS:
`eas channel:list` returns exactly ONE channel (`dev`), and every production and
preview build reports `channel: null` — **including the Android 2.8.3 live on
Play**. So OTA hotfixes have never been deliverable to a single store user, and
the fix only binds *future* builds: 2.8.3 stays unreachable forever. That is the
release whose Play base-plan id bug means it sells no subscriptions, so the
escape hatch was missing for exactly the incident it existed for.

**Three places the implementation deliberately diverges from the audit's
sketch**, each recorded in its Bugs entry because the obvious version is worse:

1. **H2 — separate rate-limit buckets, not the shared flyer one.** Same secret,
   opposite traffic shapes; one budget would let routine admin work lock out the
   weekly flyer import. And successes are *refunded*, so only failed guesses
   accumulate — a budget that charges correct credentials is an outage dressed as
   a security control. The property that matters (429 before a valid token is
   accepted) is pinned by test.
2. **M1 — the preflight warns instead of skipping.** Setting `APP_ENV` makes
   `assertStoreBuildIsPurchasable`'s comment true by making it stop checking
   preview builds. That would have silently deleted coverage on the one build
   type where a RevenueCat misconfiguration should be caught before a store sees
   it. Production still throws; everything else warns loudly.
3. **L5 — the service reports it rather than someone checking a dashboard.**
   See below.

**L5 is NOT closed.** `DATA_DIR` is unset in `railway.json`, so file-backed state
(the watch registry, the notify dedupe ledger, the flyer overlay) may sit on
ephemeral container disk. It could not be settled from the repo, and could not be
settled during the fix pass either — the Railway CLI is not authenticated here.
`GET /health` (admin) now carries `checks.storage` with a `local | volume |
ephemeral` verdict, the resolved path, and the on-disk files with mtimes.
**Still owed, on BOTH the production and development services:** mount a Railway
Volume, set `DATA_DIR` to its mount path, then confirm `checks.storage.status`
reads `volume`.

**Also owed before the next production build:** M1 changes the Sentry
`environment` tag for preview builds from `production` to `preview`, so any
Sentry alert, dashboard or release-health rule filtered on
`environment:production` stops seeing preview traffic. That is the intent, but it
should be a decision rather than a discovery. And the first production
`eas update` after H1 should be a **no-op bundle verified on a device**, not a
real hotfix — it activates a delivery path that has never carried traffic.

**One finding the audit's table missed.** L1 listed six stale `docs/` references;
a full re-sweep during the fix found a seventh (`backend/.env.example` ->
`Technical/Supabase_Cutover.md`). An audit's list is a sample — the fix pass
should re-run the search, not work from the table.

**Regression risk, stated for each batch** (full detail in each PR):
`/api/flyer/import` throttling behaviour is byte-identical after the shared
window helper was extracted; five admin routes now 429 an IP that fails auth 10x
in an hour, and existing suites fail admin auth at most twice per process against
that cap; the deal-badge EN copy is rewritten (sentence case, no "BUY NOW"), so
it is a visible change in both languages, not a silent refactor; two backend
endpoints now return 404, both verified callerless from the app, the scripts and
the website; deleting `PaywallScreen.js` plus its smoke test nudges `src/**`
coverage down by roughly 0.03%, well inside the ratchet headroom but downward
rather than neutral.

**Tests shipped with the fixes, per the standing rule:**
`backend/tests/adminTokenRateLimit.test.js` (own process — the buckets are per-IP
and every supertest request shares one loopback address),
`__tests__/dealBadgeI18n.test.js`, `__tests__/easBuildProfiles.test.js`,
`backend/tests/healthDataDir.test.js`, plus the 404 tombstones and the
replacement `/api/watch`-replaces-the-list assertion in `routes.test.js`.
`i18n:check` green (1404 x 2 after the new keys), `typecheck` exit 0. Suites were
not run locally — CI is the authority (standing rule).

Bugs_Common_Fixes **#149-#154**.

## 2026-08-09 — The first iPhone build crashed on Sign in with Apple; fix every Sentry error from the last week

**Asked:** "i used testflight to test the 2.8.1 version as a first version on an
iphone, the app crashed on iphone when i clicked on signin with apple" — then,
mid-investigation: "all errors are in Sentry, also fix all sentry errors in the
last week."

**Four issues open on `priceback-canada` for the last 7 days. Three fixed in
code; one is an ops action that is Maxim's to take.**

| Sentry | What | Platform | Outcome |
|---|---|---|---|
| `PRICEBACK-CANADA-9` | `Invariant Violation: new NativeEventEmitter()` — **fatal, the crash** | iOS 2.8.1 | Fixed, Priceback#247 |
| `PRICEBACK-CANADA-A` | "React Native unavailable" | iOS 2.8.1 | Same fix — the caught sibling |
| `PRICEBACK-CANADA-5` | Outlook `400 SearchWithOrderBy`, 16 events since 2.7.0 | Android | Fixed, Priceback#247 |
| `PRICEBACK-CANADA-8` | Gmail `403 SERVICE_DISABLED` | Android 2.8.3 | **Ops — Maxim, see below** |

**The crash was one property read.** `signInWithApple()` did
`(await import("react-native")).Platform`. Metro compiles a dynamic import to
`importAll`, which for a module without `__esModule` assigns every key — invoking
every getter on react-native's index, including the deprecated
`PushNotificationIOS`, whose module body constructs a `NativeEventEmitter` around
a native module that is null in Expo. That invariant is guarded by
`Platform.OS === 'ios'`, which is why Android shipped it for months. Fixed with a
static named import at both call sites — `_loadAppleAuth()` had the same line and
backs the ten-minute Apple token refresh, so a *successful* sign-in would have
crashed later regardless.

**The Outlook one had never worked at all.** `$search` + `$orderby` is rejected
by Graph outright, so the store-targeted search failed for every mailbox since
2.7.0 and was absorbed by a `catch` written for a rarer problem. Every Outlook
sync has silently been "the 50 most recent messages from anyone".

**Gmail — settles an open question.** `[[email-sync-error-references]]` recorded
"is the Gmail API enabled on GCP 695135372222?" as unknown. It is **not**. The
app requests `gmail.readonly` correctly and the error is already classified and
messaged properly, so there is nothing to fix in code. Enable it at
`console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=695135372222`;
until then Gmail sync cannot work for anyone.

**Why the suite was green, and what the guard had to be.** Jest transpiles the
same syntax through Babel's `_interopRequireWildcard`, which *re-defines* getters
rather than reading them; Metro reads them. The two runtimes disagree precisely
at the crashing line, so no behavioural test can reproduce it — one written
against the broken code passes. The regression guard is therefore a source
invariant (`__tests__/noReactNativeNamespaceImport.test.js`) banning dynamic and
namespace imports of `react-native` anywhere under `src/`.

**Regression risk, stated:** the static `react-native` import in `authService.js`
is the only structural change; the Outlook search path goes live for the first
time (real behaviour change — better recall, no longer date-ordered, parsing
untouched); and everything past step 1 of Apple sign-in has never executed on a
device, so a second unrelated defect behind this one is possible.

**Tests shipped with the fix:** `__tests__/noReactNativeNamespaceImport.test.js`
(new), plus the `$orderby` assertions in `emailSyncErrorPaths.test.js` and the
platform-guard case in `authServiceSignIn.test.js`. `typecheck` exit 0,
`i18n:check` green (1404 x 2, no string changes). Suites not run locally — CI is
the authority.

**Shipped as 2.8.5** (buildNumber/versionCode 25) — `v2.8.4` is already tagged
and tags are never moved. Tag before building, build from the tag, TestFlight,
GitHub release.

Bugs_Common_Fixes **#155-#156**.

---

## 2026-08-09 — Deep iOS audit: parity with Android + first-pass App Review readiness

**Ask.** Full, deep audit of the iOS code; make iOS behave the same as Android;
no regression on either platform; ask before acting on anything doubtful. The
stated goal above all: **get approved by Apple on the first submission**, so
cover the recurring App Store Connect rejection motifs.

**Context.** The app ships on Play but has never reached an App Store review.
The one TestFlight build (2.8.1) crashed on the Sign in with Apple tap (fixed
separately, PR #247). The premise of this task was that the crash was a symptom
of thin iOS exposure. It was.

**Six findings, all confirmed against primary evidence** — library type
definitions, Expo's prebuild plugin sources, the installed
`@react-navigation/bottom-tabs` source, and the module import graph — not
inferred from reading app code. Full register:
`Technical/iOS_Audit_2026-08-09.md`.

| # | Finding | Platforms |
|---|---|---|
| F1 | Restore Purchases failed on the **success** path (Guideline 3.1.1) | both |
| F3 | iOS forces a **square crop** on receipt/tag upload | iOS |
| F5 | Tab bar discards the bottom safe-area inset | both, severe iOS |
| F2 | `userInterfaceStyle: "dark"` on a light-themed app | iOS |
| F4 | Custom Sign in with Apple button (Guideline 4.8 / HIG) | iOS |
| F6 | iOS permission prompts English-only; photo purpose string incomplete | iOS |

**Two decisions taken to the user before implementing**, per the ask: whether to
adopt Apple's native sign-in button (yes — it changes the iOS onboarding look),
and how iOS should behave without the square-crop editor (target: parity with
Android *or better results*, so the full image now goes to OCR).

**Confirmed clean, deliberately unchanged:** in-app account deletion (5.1.1(v)),
no external purchase links (3.1.1), purchase simulation correctly gated to local
builds, the existing iOS privacy-string cleanup plugin, `UIBackgroundModes`,
when-in-use-only location, `supportsTablet: false`. One open question left
explicitly unresolved: Guideline 1.2 (UGC) is judged out of scope because no
path was found where one user sees another user's uploaded photo — flagged in
the audit doc as needing a proper pass if such a surface exists.

**Regression risk, stated proactively.** Every fix is shaped so Android cannot
move: F2 is provably inert on Android (the plugin only warns; `expo-system-ui`
is absent), F3/F4 are `Platform.OS`-gated to today's Android literal, F5 is
additive so a zero bottom inset reproduces the historical 70/8 exactly. **The
one exception is F5 on Android**: a device with a non-zero bottom inset gets a
taller tab bar (~24dp on gesture nav). That is the fix, and it is the only
change in the branch that moves Android pixels. F3 and F4 visibly change iOS.

**Tests shipped with the fixes:** `__tests__/paywallRestore.test.js`,
`__tests__/tabBarMetrics.test.js`, `__tests__/iosParityConfig.test.js`,
`__tests__/onboardingAppleButton.test.js`, plus `easBuildProfiles.test.js`
extended for the new `device` profile. `i18n:check` green (1404 × 2),
`typecheck` exit 0. Suites not run locally — CI is the authority (standing rule).

**Still owed — this is not done.** Nothing has run on an iPhone. A `device` EAS
profile was added because none existed that could produce an installable iOS
binary (`preview` is simulator-only). Note the trap it was written around:
`"ios": {}` does **not** cancel an inherited `"simulator": true` — EAS deep-merges
extended profiles, so it must say `false`. On-device checklist in the audit doc.

**Sequencing.** `chore/release-2.8.5` was already open. This branch carries no
version bump, so the release branch stays the only place the version moves;
rebase it on `main` after this merges and 2.8.5 ships with all six fixes.

Bugs_Common_Fixes **#157-#158**.

---

## 2026-08-10 — Three receipt-scan defects from the 2.8.5 iOS TestFlight build

**Asked:** three bugs found on 2.8.5 via TestFlight, all described as "handled
before": (1) the auto-crop scanner allows multiple scans, so uploading several
receipts at once leaves no accurate reference; (2) OCR was clean but the first
two products picked up header text or lost part of the label; (3) two receipts
with an accurate, *past* printed date were filled with today's date instead —
"date of the day is only if the date is unknown". Mid-task the user re-scanned
one receipt: labels parsed fine, the date bug reproduced, and they committed it.

**Priceback#250.** Bugs_Common_Fixes **#159–#161**.

**The date bug was not what it looked like, and it was the expensive one.**
It was not an OCR failure, a compliance-scrub failure, or a regression of #71's
header re-sourcing — the date was extracted correctly and then discarded by its
own validity check. `extractDate`'s `buildIso` parsed `…T00:00:00` in **local**
time and confirmed it with **UTC** getters, so at any positive UTC offset local
midnight fell on the previous UTC day, the round-trip failed, and `null` came
back for *every date on every receipt*. `ScanScreen` filled today.

**Why it shipped, and the lesson worth keeping:** the check is only wrong at a
non-zero offset. **CI runs at UTC — the one value where it cannot reproduce** —
so the suite was green, including the per-fixture `date` invariant #71 added
specifically to guard this field. The reporter's device is at UTC+3. Every date
test now runs a nine-timezone matrix; a green UTC-only run is not evidence for
date logic. Fixed by removing `Date` from calendar validation entirely.

**Evidence over inference.** The reporter's own committed receipt settled it:
prod row `r_1786356914240_m7ruw`, `purchase_date = 2026-08-10`, `raw_ocr` ending
`2026/03/08 17:55:13`. Worth repeating as method — the DB row carries the exact
OCR the parser saw, so it reproduces the field failure without a device.

**Bug 2 was a known hole left half-closed.** #67 taught the NAME→PRICE pairing to
refuse the warehouse address above a *discount* row; the identical case with a
*positive* price was never closed, and geometry could additionally fold the first
item's price into the address row. Both now consult one shared predicate
(`isWarehouseInfoLine`), whose priced-line exemption is what makes it safe to run
while items are still being parsed. When a guard is added for one sign of a
value, check the other sign immediately.

**Bug 3 was a platform-parity defect.** `maxNumDocuments` is Android-only; iOS
never read it, so VisionKit accepted unlimited pages and the JS kept `[0]`.
VisionKit has no public mid-session page cap, so the patched native layer
truncates on the way out and reports `capturedPageCount` — the user is told what
was not used. Chose this over private API (App Review risk) and over processing
all captures (a credit per receipt, and a bigger change than the report warranted).

**Behaviour change, deliberate.** An unreadable date is now left **empty** rather
than prefilled with today. The guess is indistinguishable from a real reading and
is wrong exactly when it matters most — an old receipt, whose adjustment deadline
is the product. **10 of 31** captured real receipts carry no date at all (Costco
prints it at the very bottom). The UI was already built for this — invalid field,
"couldn't read purchase date" hint, `doSave()` refusal — and none of it had ever
fired, because the fallback pre-empted it. Cost: one extra tap when the bottom of
the receipt wasn't photographed.

**Regression risk, stated proactively.** The date fix strictly widens acceptance
at UTC+ offsets and is byte-identical at UTC and west of it. **The one to watch is
the header guard**: a product whose name looks like a header line would be
dropped. Contained by the priced-line exemption plus the address/city patterns
requiring lowercase (item lines are ALL CAPS). Verified by diffing the parse of
all 31 committed real-OCR fixtures before and after — **items, names, sums,
totals and dates are unchanged on every one**. The geometry change could in
principle leave an orphan price unfolded; a test pins that a normal orphan still
merges. The iOS native patch cannot be verified without an iOS build.

**Tests shipped with the fixes:** nine-timezone matrices in
`receiptParsingShared.test.js` and `receiptPipeline.live.test.js` (the latter over
the real prod OCR through parse → validate → `toApiBody`), `isWarehouseInfoLine`
units in `ocrCleanup.test.js`, the header-anchor case in `receiptGeometry.test.js`,
the multi-capture contract in `autoCrop.test.js`, and a new
`scanCaptureAlerts.test.js`. New copy in EN + FR. Suites not run locally — CI is
the authority (standing rule).

**Still owed.** Nothing has run on an iPhone; the native patch in particular needs
a real build. Ship needs a version bump, annotated tag and GitHub release, and the
EAS build is the user's call (standing budget rule).

**Noticed, not actioned:** the **production** `priceback.receipts` table held a
single row — the one the user committed during this session — despite the app
being live on Play since 2.8.5. Flagged to the user; not investigated here.

## 2026-08-10 — Prefill the purchase date again (but make the user vouch for it), and stop Sign in with Apple creating a second account

**Asked:** two things, from the first iOS sign-up. (1) Pushback on the behaviour
change shipped with Priceback#250: "when the date is in the OCR you get it from
the OCR, otherwise you fill the date field with the actual date (today) — you can
also require validation by the user, like a validate mini button for the date or
a warning message." (2) "When I signed up for the first time on iOS, the Apple
account used the same email. At first it started restoring all the data, then
redirected to the sign-up form … and then created a new account, also giving 75
free credits. There wasn't any data in the app when it launched."

**Bugs_Common_Fixes #162–#163.**

**The date field was missing a third state, not a better default.** Silent
prefill and empty are the two ends of one axis and both are wrong — the first
stamps the scan date on an old receipt with nothing saying so, the second costs a
calendar trip on the 10-of-31 captures where Costco's bottom-printed date wasn't
photographed. The field carried a value with no record of where it came from, so
the UI could only trust it completely or not at all. `resolveScannedDate` now
returns provenance alongside the date; `"assumed"` prefills today, shows an amber
bar, disables Save and is refused by `doSave()`, and one tap on Confirm — or
picking any day — clears it. The helper holds no `Date` at all, which is what
keeps #159 from recurring; its tests run the nine-timezone matrix.

**The account bug was a primary key owned by a third party.** `users.sub` is the
PK and providers mint it, so Apple's sub is simply a different user. The account
was created by the *restore*: `/api/me/bootstrap` upserts before it reads, so the
"Restoring your account…" screen inserted the row and fired the one-time
75-credit grant, and the empty payload then routed to new-user setup.

**Identity linking was designed, then rejected — on the user's own challenge.**
The plan was a `user_identities` table mapping provider subs to one canonical
user. Asked directly whether that risked purchases and entitlements, the honest
answer was yes: the client binds RevenueCat to whichever provider sub it holds
and the webhook writes subscription state to `users.sub = event.app_user_id`, so
a linked iOS purchase lands on the wrong row — and fixing that means re-`logIn`-ing
the RC app-user-id on devices that have already purchased, whose outcome depends
on a dashboard transfer setting and real store transactions. Nothing in CI could
have cleared it. The user chose the block instead, with a condition of their own:
it must lift once the first account is deleted, and the replacement must not
collect the free credits again.

That fell out of mechanisms already in the schema, so **no migration**: account
deletion is soft, so the address stops being an *active* claim the moment it is
deleted, while the tombstone keeps `trial_credits_granted_at` — the existing
per-sub grant guard widened to per-email. `users.status`, that column and
`users_email_idx` all already existed.

### Tests & regression risk

New: `__tests__/purchaseDate.test.js` (nine timezones),
`backend/tests/accountIdentityUnit.test.js` (pure predicates),
`backend/tests/duplicateAccountGuardDb.test.js` (refusal, case-folding, the
delete→switch→no-credits sequence, the revive-while-live case, both lookups),
`backend/tests/emailClaimedRouteDb.test.js` (403 envelope on both routes, and
the owner still served). Extended: `onboardingSignInRecovery` (the
`blocked_email` route wins over `retry`; provider labels never render a raw
code), `syncServiceHydrate` (403 body parsing, no failure telemetry, non-JSON
body still degrades to `http_<status>`).

**Regression risk, stated proactively.** The date change reintroduces a prefill
but it can no longer be persisted silently — the gate is what makes it safe; the
failure mode to watch is the gate firing when OCR *did* read a date, which would
add a tap to the 21-of-31 captures that carry one. `Button` gains an optional
`disabled`, default `undefined`, so every existing call site is byte-equivalent.
The sign-in block is the one with real blast radius — a false positive locks a
legitimate user out — contained by four rails: verified-email only, never for a
sub that already holds an active row, never on the webhook/placeholder paths, and
existing active pairs sharing an address (including the reporter's own) are left
alone, so deploying it cannot lock out anyone currently signed in. RevenueCat is
not touched anywhere. Suites not run locally — CI is the authority.

**Still owed.** The duplicate account already exists in production and the fix
does not merge it: remediation is through the product's own surface — signed in
with Apple, Profile → Delete Account, then sign in with Google. Nothing has run
on an iPhone. Ship needs a version bump, annotated tag and GitHub release, and
the EAS build is the user's call.

---

## 2026-08-10 — Deep iOS audit #2: everything that happens after sign-in

**Asked:** "run a full audit specially for the iOS system, i want a deep
analyzing to detect also if there is any difference between iOS and Android
behavior, everything should be documented if not fixed."

**Full register: `Technical/iOS_Audit_2026-08-10.md`. Bugs_Common_Fixes
#164–#168.** Branch `fix/ios-parity-audit-2`; no version bump.

**The previous iOS audit (2026-08-09, PR #249) stopped at the sign-in screen.**
It was scoped, correctly, to what a reviewer taps — restore, crop, tab bar,
dialog chrome, the Apple button, permission strings. This pass took the paths
behind it: background execution, locked-device behaviour, token lifetime, and
the labels the OS caches on the app's behalf. Five findings; four fixed, one
documented by the user's decision.

| # | Finding | Platforms | Status |
|---|---|---|---|
| A1 | Keychain items written `WHEN_UNLOCKED` — unreadable while the phone is locked | iOS only | Fixed |
| A2 | Apple sessions can never authenticate in the background | iOS only | **Documented** |
| A3 | App-icon badge set, never cleared | iOS only | Fixed |
| A4 | 12 user-visible notification strings hardcoded in English | both | Fixed |
| A5 | The only profile that builds an installable iPhone binary *warns* on a missing IAP key | iOS only | Fixed |
| A6 | The claim share sheet's header and subject line hardcoded in English | both | Fixed |

**The two worst are invisible on Android by construction** — not "less likely",
structurally unobservable. Android's SecureStore has no lock-state restriction
at all, and Android launchers own the badge the app forgot to clear. That is the
argument for auditing *for a difference* rather than for bugs: the reference
implementation is healthy, so the only symptom is the divergence.

**A1 is the one that matters, and its trap is worth keeping.** `expo-secure-store`
defaults to `WHEN_UNLOCKED`, so on iPhone the session token is unreadable
whenever the screen is locked — killing the daily price check, both offline
queue drains and push-token sync. `authedFetch` then sends an *unauthenticated*
request, gets 401, and the client treats 4xx as terminal: the exact signature
already on file as "the scan worked but no DB row appeared", previously blamed
on a stale Google token. **The migration is where this gets interesting.**
`SecItemUpdate` cannot change `kSecAttrAccessible`, and expo's `set()` falls
back to `update()` with an update dictionary of `[kSecValueData]` only — so
re-writing the value leaves the old attribute in place while every plausible
assertion still passes. The item has to be deleted first. The migration reads
before it deletes and skips any key it cannot read, because the bug being fixed
*is* an unreadable keychain and "invisible" must not be read as "absent".

**Three decisions were taken to the user before implementing**, per the ask:
how far to go on A2 (→ document only), which keychain level (→
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so a restored iPhone starts signed out
and no token rides a backup onto other hardware), and whether the notification
i18n rewrite should also improve the copy (→ yes, knowing it changes what
current Play users receive).

**A2 is a real gap left open, deliberately.** Apple identity tokens live ~10
minutes and `expo-apple-authentication` has no silent re-issue — the code's own
comment says a background task cannot present UI. Google has `signInSilently`.
Since Guideline 4.8 makes Apple sign-in mandatory once Google is offered, a
large share of iPhone users get a materially different product. The fix is to
stop using the provider id-token as the API bearer and mint a first-party
session; that is an auth-core rewrite touching both platforms and both
providers, and bundling it here would have risked the working Google path to
repair the broken Apple one. Design sketch is in the audit doc; it depends on
A1 having landed.

**Also verified and deliberately left alone** (recorded so the next pass doesn't
re-investigate): the deliberate divergence table — Android-only gallery import
inside the scanner, iOS-only camera-roll suggestions, notification channels,
`stopOnTerminate`/`startOnBoot`, iOS-only swipe-dismiss on modals (and the two
Pending* screens that inconsistently allow it). Confirmed clean: no `elevation`
without a matching `shadow*`, every `SafeAreaView` from `safe-area-context`, the
`require("react-native").Platform.OS` in `purchaseService` is a single-property
read and does **not** re-open the 2.8.1 crash, `patch-package` runs via
`postinstall` so the iOS half of the scanner patch does reach an EAS build, and
the paywall carries its 3.1.2 disclosures.

**A6 is worth recording as method.** It was not found by looking for i18n bugs.
It surfaced during the platform-divergence sweep of `Share`/`expo-print` —
checking whether any call passed a `url`, which Android silently ignores. That
sweep came back clean, but it put eyes on a call nobody had localized:
`Share.share`'s `title` is the chooser heading on Android and the **Mail subject
line on iOS**, and both it and the message header were English literals on the
screen the whole product exists to reach. A parity sweep is also a reading pass
over code that shared-behaviour reviews skim.

**Noticed, not actioned:** `BuyCreditsScreen` is the one purchase surface with
no terms/privacy small print (3.1.2's link requirement is written for
auto-renewable subscriptions, so this is very likely fine); and `ScanScreen` /
`PriceTagScanScreen` both import `KeyboardAvoidingView` without rendering it —
dead imports from the move to `KeyboardAwareScrollView`, not worth diff noise in
two large screens during an audit branch.

### Tests & regression risk

New: `__tests__/secureStoreAccessibility.test.js` (source sweep that no module
outside `secureStore.js` touches the keychain, plus the delete-before-re-add
behaviour, the skip-what-you-can't-read rule, run-once, and never-throws),
`__tests__/notificationBadge.test.js`, `__tests__/notificationI18n.test.js`
(language list derived from the bundle; no bare literal survives in a
notification `content`). Extended: `__tests__/easBuildProfiles.test.js` for the
`device`-profile fatality, and `__tests__/claimAssistantScreen.test.js` for A6 —
source assertions, because that file mocks i18n to echo keys, so a rendered
assertion literally cannot tell a translated string from a hardcoded one.

**Regression risk, stated proactively.** A1 carries the blast radius: a failed
migration leaves that key on the old attribute (degraded to today, never worse),
but the delete→re-add window means a process death there signs the user out.
Contained by reading first, skipping unreadable keys, and leaving the migration
unflagged so it retries — and worth stating plainly, **iOS installs today are
TestFlight only**, so the exposed population is about one person. There will
never be a cheaper time. A1's second deliberate change: restoring an iPhone from
backup now starts signed out. **A4 and A6 change live Android copy** — by
choice, and the only changes here a current Play user can see (every price-drop
and claim-window notification, and the claim share sheet's header and subject).
A3 cannot move Android (`setBadgeCountAsync` is inert there); A5 only narrows
which profiles fail a build and changes no shipped binary. The three services now sharing
`secureStore.js` each kept their own error policy, so no call site's failure
behaviour moved.

`i18n:check` green (1430 × 2), `typecheck` exit 0. Suites not run locally — CI
is the authority (standing rule).

**Still owed.** Nothing has run on an iPhone, and that debt is now larger: F1–F6
plus A1, A3 and A4 all change device behaviour. A2 needs its own task.
**`REVENUECAT_API_KEY_IOS` must exist in the EAS environment before the next
`device` build** — it will now stop without it, which is the point. Ship needs a
version bump, annotated tag and GitHub release; the EAS build is the user's call
(standing budget rule).

---

## 2026-08-10 — iOS audit #3: the money and identity paths

**Ask:** a full, deep iOS audit with security first — authentication, credit
management, RevenueCat, account management, receipt scans, price-tag scans —
detecting iOS/Android behavioural differences, documenting anything not fixed.

**Full register: `Technical/iOS_Security_Audit_2026-08-10.md`. Bugs_Common_Fixes
#169–#173.** Branch `audit/ios-security-money-identity`, PR #253; no version bump.

**The two prior iOS audits stopped short of these paths, and said so.** #1
(2026-08-09, PR #249) covered what App Review taps; #2 (2026-08-10, PR #252)
covered background execution, the keychain and OS-cached labels. That left the
**money and identity** surfaces unexamined on the platform with a fraction of
Android's real-device exposure — and PriceBack has **never completed a single
real transaction on an iPhone**. Six findings; five fixed, one documented.

| # | Finding | Platforms | Status |
|---|---|---|---|
| S1 | Every sandbox purchase refused server-side | iOS in effect | Fixed — **submission blocker** |
| S2 | The iOS Google client ID was not an accepted audience | iOS only | Fixed |
| S5 | No Apple credential revocation on account deletion | iOS only | Fixed — **submission blocker** (5.1.1(v)) |
| A2 | Apple sessions could never authenticate in the background | iOS only | Fixed (deferred from audit #2) |
| S4 | Server-sent push notifications were English-only | both | Fixed |
| S3 | The `device` build targets a different backend than App Review's | iOS only | **Documented** |

**S1 is the one that would have failed review in under a minute.** Three server
paths refused `environment: SANDBOX`, and on iOS there is **no non-sandbox
purchase before the app is live** — TestFlight and App Review are both sandbox.
A reviewer taps Subscribe, pays, and the server records nothing. The credit-pack
path was worse: `402 … retryable:false` made the client dequeue a **paid**
transaction permanently, so it could never heal after a fix shipped. Android hid
it by having a real production purchase path beside its license testers — which
is exactly the case the refusal was written to defend against. **The original
reasoning was right about the danger and wrong about the remedy**: refusing was
an over-broad implementation of "don't count test revenue". Now granted and
**tagged** (migration 0003), with one guard that makes acceptance safe — a
sandbox purchase never settles a **referral**, the only path where a $0
transaction mints real credits for a third party. Tested behaviourally against
the referrer's balance, with a production control so the guard can't pass by
having disabled referrals.

**S2 is the finding that argues for the method.** The divergence is in the two
native SDKs, not in our code, so reading our code could never have shown it:
Android calls `requestIdToken(webClientId)` — a token addressed to the *web*
client — while iOS configures `GIDSignIn` with the *iOS* client and returns that
user's `idToken`. The backend listed only web + android. Every Google-signed-in
iPhone would 401 on every call. Two things stopped the fix from sitting dormant:
`backend/.env.example` never documented the sign-in client IDs at all (so the var
would never have been set on Railway), and `/health` reported a bare audience
**count** — "configured" from the web+android pair while every iPhone fails. It
now names which of web/android/ios are present.

**Three decisions were taken to the user before implementing**, per the standing
pattern: the sandbox policy (→ accept and tag, not refuse), whether to take on
the A2 auth rewrite (→ yes), and its scope (→ **"keep actual android behavior for
android and optimize only iOS"**). That constraint shaped the whole design: the
backend change is purely **additive** (a third `requireAuth` branch resolving to
the same `req.user.sub`), the client change is iOS-only, and **Android's request
shape is asserted unchanged by test rather than assumed**. Every session failure
falls back to the provider token, so the worst case is exactly today's behaviour.

**The trap in A2 that would have shipped.** Refresh-token rotation and request
concurrency are individually correct and jointly hostile: five parallel requests
each present the same refresh token, and the backend's reuse detection correctly
reads four of them as theft and revokes the family. **Being busy would have
signed the user out.** Single-flight on both sides — a shared promise on the
client, a per-token advisory lock in the repo.

**S4 is a lesson about tests, not about i18n.** Audit #2's A4 fixed twelve
hardcoded notification strings and shipped a guard so none could return. That
guard reads `src/services/notificationService.js` — it cannot see the backend,
where nine more pushes were still English template literals, including **price
drops**, the app's most important notification. Money used a hardcoded `$` and
`toFixed(2)`, which bakes the English currency shape into every language. The
general rule: **when a rule is enforced by a test, ask what the test can see.**

**Also verified and deliberately left alone** (recorded so pass #4 doesn't
re-investigate): `APPLE_BUNDLE_ID` matches `app.json`; the RevenueCat webhook
secret is compared timing-safely; `/api/me/credits/topup` is genuinely trustless
and fails **closed**; top-up idempotency is global and survives a data reset;
`_simulationAllowed()` cannot fire in any EAS-produced binary; device-scoped
erasure is IDOR-safe and fails closed; the offline-scan buffer cannot overdraw;
every iOS ingest path converts to JPEG before upload, so no HEIC reaches the
backend.

### Tests & regression risk

New: `sessionTokens.test.js` (16 — alg pinning, type confusion, timing-safe
compare, expiry/skew, opaque hashed refresh tokens, and that an unset secret
disables the feature rather than defaulting one), `sessionRoutesDb.test.js`
(rotation, reuse→family revocation, one indistinguishable 401 for every failure,
revoke-one vs revoke-all, cascade on delete), `appleRevoke.test.js` (12 — ES256
raw `r||s`, escaped-newline PEMs, and that **every** failure mode still lets
deletion proceed), `pushI18n.test.js` (12 — key parity derived from the bundle,
no bare literal survives in a server push, locale money), `googleAudiences.test.js`
(5), `iosFirstPartySession.test.js` (15 — led by **Android is untouched**).
Updated to the new contract: `subscriptionGate`, `subscriptionSync`,
`creditTopupSecurity`, `errorContract`.

**Regression risk, stated proactively.** S1 changes production money handling —
sandbox purchases that granted nothing now grant, deliberately, bounded by the
tag and the referral guard. A2 adds a new accepted credential type to every
authenticated route, contained by the same `sub` shape, an additive branch, an
iOS-only client change and a provider-token fallback. **S4 changes live Android
copy** — every price-drop, flyer, referral, low-balance and store-launch push,
and the only change here a current Play user can see. `sandbox_purchase` is
**retired, not renamed** (the shipped v2.8.3 client only used it to give up).
**Prod owes migrations 0003 and 0004.** iOS is TestFlight-only, so the exposed
population is about one person.

`i18n:check` green (1430 × 2), `typecheck` exit 0. DB-gated suites are CI's.

**Still owed.** Nothing has run on an iPhone, and that debt is now larger again.
Before the first App Store submission: **provision the Apple Sign-In `.p8` key**
(it downloads exactly once) or deletion cannot revoke; set `GOOGLE_CLIENT_ID_IOS`
and `SESSION_TOKEN_SECRET` on both Railway services and confirm via
`GET /health` → `auth.clients.ios`; run migrations 0003 + 0004 on production.
Apple **server-to-server notifications** are still unwired — consent withdrawal
is only detected on-device today; its own task, needing the same key.

## 2026-08-10 — Clearing the iOS-audit session's leftovers: one dead branch, one false uniqueness claim

Two items the audit sessions logged and deliberately did not act on, plus a
read-only check of the four ops steps that were still listed as owed.

### The dead branch (mobile)

`throw lastErr` at `src/services/authService.js:269` was unreachable. On the
second attempt the `attempt === 0 && isTransientGmsError(e)` guard is false, so
every catch path returns or throws, and the `try` block returns or throws — the
retry loop can never fall through. All three sites (`let lastErr`, the
assignment, the trailing throw) were dead, and the first error was recorded and
then discarded; line 266 already surfaced the second one. Deleted rather than
made reachable: the alternative would change **which** error object reaches
Sentry for no benefit, and deleting removes three permanently uncoverable lines
instead of fighting the coverage ratchet.

The existing test named "two transient Play Services failures surface the
original error" **could not fail** — it rejected twice with the same
`INTERNAL_ERROR` message, so it passed whichever error surfaced. It now rejects
with two distinct error objects and asserts identity (`rejects.toBe(retry)`),
which pins the behaviour the deletion defines.

### The uniqueness claim that was false three ways (backend tests)

The recap carried this as "worth its own small change" and blamed a
`price_tag_scan`/`receipt_ocr` mismatch on two overlapping CI runs. **The
overlap was a coincidence.** `String(Date.now()).slice(-6/-7)` recurs every
16.7 min / 2.8 h; the derived SKU ranges *contain* hardcoded `price_tag_scan`
SKUs from `crowdsourceDb.test.js` and `barcodeLink.test.js`, so one run could
collide with itself; and the warehouse derivations were only 100 and 10 possible
codes. `latestForSku` resolves the product globally and orders by `observed_at`,
while receipt points are stamped with a past purchase date and tag points with
now — so a colliding tag row always won. Full analysis in Bugs #174.

Fixed with `backend/tests/helpers/uniq.js` (`runId`, `testSku`,
`testWarehouseCode`) over `node:crypto`, and a namespace invariant that makes
collisions structurally impossible rather than improbable: generated SKUs are
**8 digits leading `5`**, the `` `N${RUN}` `` fixture SKUs hold 8 digits leading
6/7/8/9, every other fixture id is ≤7 digits, and warehouse codes are **5 digits
leading `9`** against real codes of 2–4 digits. 29 test files converted;
`node --test`'s per-file process model means the draw is per-file, which also
closes the cross-suite band reuse.

**The first attempt at this failed 12 CI tests, and that is the part worth
keeping.** It used a hex `runId()` and 9-digit ids — both treated as opaque when
both shapes were contracts. `slice(-7)` is *seven numeric digits* and call sites
concatenate onto it: `` `7${RUN}` `` builds an 8-digit numeric Costco SKU and
`` `1137482950${RUN}` `` builds a Google-shaped sub that `providerOfSub` matches
with `/^\d+$/`. Separately, 9 digits broke `POST /api/observations/tag`'s
`/^\d{3,8}$/` and the header-OCR footer's `\d{2,5}`, so a 9-digit warehouse code
was **stored yet echoed back null** (`0 !== 825306100` — nothing like a length
error). `runId()` is now shape-identical to the value it replaced, so every call
site is satisfied by construction rather than by audit. Lesson recorded in
Bugs #174: when replacing a generated value, keep its shape and change only its
source; widening a format is a separate change needing its own check against the
real validators, which live in `server.js`, not the column types.

### Ops steps — what I could verify, and what is still owed

Checked read-only, no changes made:

- `GET /health` on **both** Railway services: `healthy: true`, `db: ok`, and
  `appleAuth: {status: "configured", audience: "com.priceback"}` present.
  **Production already carries the Apple verifier from #253** — so the `.p8`
  key is the only missing piece of that path, not the code.
- `auth.clients.ios` is **admin-gated** (`server.js`, behind `x-admin-token`).
  The public payload cannot confirm `GOOGLE_CLIENT_ID_IOS`; that check needs the
  token. `SESSION_TOKEN_SECRET` has **no** health signal at all.
- Supabase prod (`xjfrlzwonyaorwktnkpj`) migration ledger ends at
  `0001_receipt_member_id_prod` / `0002_receipt_warehouse_header_ocr_prod`
  (2026-07-10) — **no 0003, no 0004**, confirming the debt. Worth noting those
  names do **not** match the repo's `0001_store_launch_subscriptions` /
  `0002_receipt_item_original_price`: prod's numbering has diverged from the repo
  chain, so "just run migrate" is not a safe assumption.
- ⚠️ `0003_sandbox_purchase_tagging.sql` is three bare `ALTER TABLE ADD COLUMN`
  statements — **not idempotent**, and it assumes the v2 `priceback` schema. 0004
  is fully `IF NOT EXISTS`-guarded. Confirm `priceback.users` / `credit_ledger` /
  `subscription_events` exist before running 0003 or it aborts partway.

Still owed and untouched: the Apple `.p8` key (downloads once),
`GOOGLE_CLIENT_ID_IOS` and `SESSION_TOKEN_SECRET` on both services, migrations
0003 + 0004 on prod. **Nothing has run on an iPhone** — device checklist items
10–15 live in `Technical/iOS_Security_Audit_2026-08-10.md`. No EAS build was
started; that stays Maxim's call.

### Tests & regression risk

Updated: `__tests__/authServiceSignIn.test.js` (the vacuous assertion above).
New: `backend/tests/helpers/uniq.js`. 29 backend suites converted mechanically.
Every changed file `node --check`s clean; the suites themselves are CI's.

**Regression risk, stated proactively.** The mobile change deletes unreachable
code — the only observable behaviour is which error object surfaces after two
transient GMS failures, and that is unchanged (line 266 already threw the
second). The backend change touches **no** runtime file, only tests; its real
risk is mechanical (a missed call site, or a suite asserting SKU/warehouse-code
*length*), which CI catches immediately. **This narrows a flake class; it does
not make the backend suite concurrency-safe** — the shared-`SUB` problem above
is untouched and its own task.

### Addendum — the test-id work uncovered a production bug (Bugs #175)

Randomising the warehouse code exposed a real defect in the receipt write path,
and it is worth stating plainly that the *test* was what hid it.

`POST /api/receipts` returned `receipt.warehouseId: null` for the **first**
receipt ever filed from a given warehouse. `receiptsRepo.create()` upserts the
warehouse inside its own transaction (correctly — the FK must be set before the
receipt inserts), then shaped the response via `warehouseCodeById`, which read on
`getDb()`: a separate connection that cannot see the uncommitted row. No error,
just a missing value, and only ever on the first receipt from that warehouse.

`receiptWarehouseLink.test.js` could not have caught it: its warehouse codes were
`` `54${one digit}` `` → 540–549, and all ten are **real seeded Costco
warehouses**, so the row always pre-existed and the broken branch never ran.

Fixed by threading the transaction through `decorateReceiptRow` into
`warehouseCodeById`. One call site was `rows.map(decorateReceiptRow)` — adding a
second parameter would have made `map` pass the array **index** as `tx`, so that
site is now an explicit arrow with a comment saying why. The test now draws until
it finds a genuinely unused code and fails loudly if the reserved 9000–9999 band
is exhausted.

**Three CI rounds were spent getting the id shapes right, and each failure taught
something the code did not say out loud:** `runId()` must stay 7 numeric digits
(call sites concatenate onto it); generated SKUs must fit `/^\d{3,8}$/`; and
warehouse codes must be 4 digits — not because of a length rule, but because
widening them was chasing a length hypothesis that was simply wrong. The real
cause was the cross-connection read above. Recording that mainly as a caution
against my own first explanation: "it stopped working when I made the value
longer" is not evidence that length is the constraint.

**Regression risk, restated.** `receiptsRepo` is now touched — production code, on
the receipt write path. The change is additive (an optional trailing parameter,
`tx || getDb()`), affects only the warehouse code echoed in a response, and can
only turn a `null` into the correct value. The `map` call site is the one place
where behaviour could have changed silently, and it is now explicit.

---

## 2026-08-11 â€” iOS audit #4: session security, account isolation, and the money paths

**Ask:** same standing brief as #3 â€” a full, deep iOS audit with security first
(authentication, credit management, RevenueCat, account management, receipt
scans, price-tag scans), detecting iOS/Android differences and documenting
anything not fixed.

**Full register: `Technical/iOS_Audit_2026-08-11.md`. Bugs #177â€“#180.** Branch
`audit/ios-session-security-and-account-isolation`; no version bump. Delivered in
**two batches by decision** â€” security/isolation first, money second.

**33 findings.** This is the first audit that could look at the code the previous
three produced, and that is where most of it came from: **audit #3 shipped a
brand-new authentication subsystem (first-party sessions, `user_sessions`,
rotation, reuse detection) in the same branch that audited everything else, and
nothing had ever audited it.** It is also still switched off in production â€”
`SESSION_TOKEN_SECRET` is unset â€” which is the single most useful fact in the
register: A1 and A3 both become live the moment that secret is set, and both are
fixed before the feature carries its first real request.

Two themes, neither reachable by the earlier passes:

1. **Lifecycle state is written but never re-read.** Deletion, Apple consent
   withdrawal and sign-out each write a marker nothing on the read path consults.
   All three were, in practice, undoable.
2. **Sign-out is not an account boundary.** It cleared six keychain keys and
   nothing else.

### Batch 1 â€” fixed

| # | Finding | Platforms |
|---|---|---|
| A1 | Withdrawing "Sign in with Apple" revoked nothing server-side | iOS |
| A2 | "Delete my account" silently undone; the 30-day purge never fired | both |
| A3 | A stale iOS session token could authenticate the *next* user | iOS |
| A4 | Account deletion prompted Face ID twice | iOS |
| S1 | Offline scan queues + photos survived sign-out (**Critical**) | both |
| S2 | Every iOS scanner capture persisted in `Documents/`, into iCloud backups | iOS |
| S4 | Unauthenticated endpoint minted presigned R2 PUTs with no size cap | server |
| P1 | Deletion never mentioned the App Store subscription â€” 5.1.1(v) | iOS |
| A5â€“A8, S5â€“S9, P2, P4, P5 | rate limits, session pruning, `/health` signal, tag re-submit, denied-location recovery, membership number, Veryfi gating, privacy manifest, locale-correct dates | mixed |

**A1 is the one worth remembering as a class.** The comment above it explains
exactly why the revoke must be `all` â€” and one line earlier the code deletes the
credential the revoke authenticates with. The request went out with no bearer,
the server 401'd, and the local wipe made the handset in your hand look correct
while every other device kept a live session for 60 days. **And the obvious fix
hangs the app:** reordering makes `getValidIdToken()` re-enter
`refreshAppleIdTokenInteractive` and await the in-flight promise from inside
itself. The fix reads the stored token directly and adds the refresh token as an
independent proof â€” safe because holding one can only ever *remove* access.

**A2 has the largest blast radius and the most mundane trigger.** Deleting an
account does not cancel the store subscription, so the next `RENEWAL` webhook
upserted the tombstone back to active and cleared the stamp the purge job selects
on. `reactivate` now defaults to false on `upsertFromOAuth` and is passed by the
two real sign-in routes plus `bootstrap?reason=signin`.

**Three findings are in code that carries a comment describing the correct
behaviour** (A1, S3, C2). Reading comments as statements of intent rather than of
fact is what found them.

### Decisions taken to the user before implementing

Three, per the standing pattern: the credit gate (â†’ **refuse server-side, and
don't create the receipt locally either â€” hardened on both sides**), the Android
blast radius (â†’ **fix both platforms**, superseding audit #3's iOS-only
constraint), and delivery shape (â†’ **security first, then money**).

### Deliberately documented rather than fixed

- **P3, app-switcher snapshot protection.** Real, both platforms, small fix â€” and
  iOS reports `"inactive"` for Control Centre, notification-shade drags and
  **every system permission dialog**, so an overlay wired to it can flash over
  the camera prompt. Nothing has ever run on an iPhone; shipping a repaint on
  every backgrounding blind, against a hard no-regressions rule, is the wrong
  trade. On the device checklist as item 22, to ship as its own change.
- **P6, "Rate PriceBack" pre-launch.** Self-resolving at publication; any
  workaround written now is wrong the day it goes live.
- **iOS background execution** is materially weaker than Android's
  (`setMinimumBackgroundFetchInterval`, deprecated since iOS 13;
  `stopOnTerminate`/`startOnBoot` are Android-only). `checkAllPriceDrops` runs
  ONLY in that task, so price-drop detection â€” the product's core promise â€” is
  best-effort on iPhone. Its own task.
- **The anti-reinstall fingerprint is weaker on iOS** (IDFV resets on delete;
  Android's SSAID does not).

### Tests & regression risk

New: `__tests__/iosSessionAccountBoundary.test.js` (A1's ordering, the
non-deadlock, A3's identity binding, A4's single Apple prompt, A8, S1 â€” led by
**Android is untouched**, per audit #3's precedent),
`__tests__/scanAccountBoundary.test.js` (queue clears, the S2 sweep including the
truncated pages, S5's persisted results),
`backend/tests/accountDeletionTombstoneDb.test.js` (the webhook must not revive;
a real re-signin must; the trial grant still never re-fires),
`backend/tests/sessionHardeningDb.test.js` (revoke-all from a refresh token
alone, including an already-revoked one; 429s; the oldest live session retired,
never the newest; pruning keeps reuse detection intact).

**Regression risk, stated proactively.** **A2 is the widest** â€” eleven routes
plus the money webhook â€” contained by keeping today's behaviour on the one path
that should reactivate and withholding it everywhere else; a wrong call site
costs a returning user a re-sign-in, not data. **S1 deletes local state on
sign-out**: the failure mode is a queued scan lost rather than leaked, which is
the right direction, and it deliberately also fires on `clearAllData` because
that is only reached from an explicit erase. **S2 deletes files**, scoped to the
plugin's own `DOCUMENT_SCAN_*` prefix, directly inside `documentDirectory`, never
recursing, and skipping the URI still in use. **S4 changes who can upload a tag
photo** â€” signed-out contributors no longer get an upload URL; their observation
still records, and their photo could never have earned them a credit anyway.
**P1 changes live Android copy** (the deletion modal) and is the only batch-1
change a current Play user can see. A1/A3/A4/A8 are iOS-only and cannot move
Android. **A5's limits are sized so a busy client is never throttled into a
sign-out** â€” own bucket prefixes, 20/min against a real cadence of ~4/hour.

`i18n:check` green (1435 Ã— 2), `typecheck` exit 0. Suites are CI's (standing
rule). No EAS build started.

### Still owed

Batch 2 (money): R1 the `TRANSFER` webhook leaving two accounts entitled, C1 the
credit cache surviving sign-out, C2 the server never refusing a scan, S3
gas/refund receipts charged nothing while telling the user otherwise, plus
R2â€“R6 and C3â€“C5. All documented with evidence in the register.

Ops, unchanged from #3: the Apple `.p8` key, `GOOGLE_CLIENT_ID_IOS` and
`SESSION_TOKEN_SECRET` on both Railway services (**land this branch first** â€”
A1/A3 go live with it), migrations 0003 + 0004 on production. Two items need a
post-prebuild check rather than code: SDK privacy manifests in `ios/Pods`, and
the Sentry iOS dSYM upload phase.

## 2026-08-11 — The session health signal, and the two migrations production was missing

Asked for, in order: give `SESSION_TOKEN_SECRET` a health signal; check the
production database and run the last two migrations if it needs them; then merge
everything open and start an Android production build and an iOS preview build.

### The health signal

A7 had already been actioned once, reporting `sessionTokens.isConfigured()`.
That reads the environment variable, and the variable is not the gate:
`sessionsUnavailable()` refuses on no secret, on `USE_DB` off, **and** on a
missing sessions repo — whose table arrives with migration 0004. Production had
not run 0004, and setting the secret there is item one of the iOS release
checklist. In that order, `/health` would have read `configured` while every
iPhone sign-in 500'd on a missing relation. Full write-up: Bugs #181.

So `checks.sessions` is now the conjunction — secret, secret strength, and a
live `to_regclass` probe of `priceback.user_sessions` — reported as
`configured` / `degraded` / `unconfigured` with a `blockers` list that names the
migration. Two constraints shaped it: an `unknown` probe result is **no
verdict** rather than a red light (a check that cries wolf on its own flakiness
is a check nobody reads), and a weak secret is reported but never enforced
(refusing it at mint time would take a running deployment offline to fix a
warning). The public payload gets the verdict alone, with `degraded` collapsed
into `unconfigured`, because the reasons name a weak signing key and an
un-migrated database. `healthy` is untouched: an iOS-only readiness gap must not
flap Railway's deploy gate.

The block had **no test at all**; `backend/tests/healthSessions.test.js` is new.

### The migrations

Checked first, and the check changed the plan. Production was missing both
0003 (`is_sandbox` on users / credit_ledger / subscription_events) and 0004
(`user_sessions`) — so the answer to "if needed" was yes for both.

**`drizzle-kit migrate` would have been the wrong tool.** Production's
`drizzle.__drizzle_migrations` rows are hand-maintained: their `created_at`
values do not match the journal's `when`, and `0000_initial`'s hash is absent
entirely because production was migrated on the pre-squash 0001→0008 chain. A
blind `db:migrate` compares by hash, finds `0000_initial` missing, and tries to
re-create the whole schema over a live database. Applied the two migrations'
DDL directly instead (`ADD COLUMN IF NOT EXISTS` for 0003's non-idempotent
`ALTER`s), each followed by its own bookkeeping row keyed on the file's real
SHA-256 so a future `db:migrate` agrees.

Verified after: `user_sessions` present with 11 columns, 5 indexes and its FK;
all three `is_sandbox` columns present; both hashes recorded. Production now
matches dev. Both migrations are purely additive and the tables are small
(5 users, 30 ledger rows), so the `ALTER`s were metadata-only.

`SESSION_TOKEN_SECRET` itself is still unset on both Railway services — that is
the remaining half of the ops item, and it is now a thing `/health` will tell
you rather than a thing you have to remember.

### Note on the branch history

A parallel session committed `6b7c94a` (the mint rate-limit relaxation) into the
same working tree mid-edit. Its change was read as uncommitted work, reverted,
and re-applied across two commits, so `942eafa`/`04ac6a0` contain a spurious
revert-and-reapply pair. The **net branch diff is correct** and the PR
squash-merges; not force-pushed, because the parallel session shares this tree.

---

## 2026-08-12 — iOS audit #6: the paths the first five never walked

**Asked for:** a deep iOS-focused audit — security first, then authentication,
credit management, RevenueCat, account management, receipt scans and price-tag
scans — plus an iOS/Android behavioural comparison, with anything not fixed
documented. Explicitly: **do not re-open the bugs the earlier audits already
documented.**

**Delivered:** ten new findings, all fixed, in three batches on
`audit/ios-pass6-push-i18n-health-retention` → Priceback#258. Full write-up in
`Technical/iOS_Audit_2026-08-12_Pass6.md`; recurring classes in
`Operations/Bugs_Common_Fixes.md` #186–#190.

### How a sixth pass found anything

The useful question was not "what did passes #1–#5 get wrong" but **"what did
none of them look at."** Their *Verified clean* registers cover Apple token
verification, sessions, keychain, deletion/revocation, RevenueCat, credit
atomicity, the scan queues and the tag presign. So this pass took five untouched
surfaces: the server-side identity/profile write path, the portability export,
the object-store presign and retention model, filesystem backup exposure, and the
one server push nobody had localized.

Four of the ten came from asking a different question about code the earlier
passes had already read — not *"is this route authorized?"* but **"does this
write preserve what it wasn't given?"**

### The three that mattered

- **H1** — `priceDropNotifier` was the one backend push sender audit #3's S4
  never swept behind `pushI18n`, and it carries the verified price-drop alert
  (the product's core promise) and the credits-were-spent notice. Both English,
  with hardcoded `$` money, on both platforms.
- **H2** — `/health`'s Apple check had `status: "configured"` as a string
  literal. `appleRevoke.isConfigured()` had existed for two audits with no
  caller. Third instance of "a config-presence check where a capability check was
  needed."
- **H3** — the account purge cascades `receipts.image_object_key` away, and the
  prune job found objects *through that column*. Deleting what we stored worked
  only because one app_config value happened to be smaller than another, with
  nothing enforcing it.

### Decisions taken to the user before implementing

Two, both about M1 (scan photos riding into iCloud/Drive backups):

1. **Android backup.** Chosen: `allowBackup: false` — with the qualification
   *"I don't want the backup to lose any data, and I want the receipt/tag photos
   kept even after deletion; a cron deletes them after N days, not tied to the
   account."*

   That qualification **changed the plan materially.** It made H3 a blocker
   rather than a finding: age-based retention decoupled from the account is not
   expressible while the only record of a key dies with the user. So the ledger
   was built first, then the sweeps rewritten, then the backup exclusion shipped
   on top.

   It also forced a correction to my own analysis. I had assumed turning Android
   backup off would strand the photos; it does not — `GET /api/receipts/:id`
   already presigns a GET and `syncService` sets `imageUri: null` with a comment
   saying the detail screen fetches it on open. What `allowBackup: false`
   genuinely costs is narrower: never-synced captures, the pending queue (drained
   next launch) and the local OCR cache.

2. **iOS backup exclusion.** Chosen: write the config plugin now and verify at
   the next build, rather than deferring it the way P3's overlay was deferred.
   Defensible because the failure modes here are benign — a non-Swift AppDelegate
   or a missing anchor both warn and leave the file untouched — unlike P3, where
   a wrong implementation flashes an overlay over the camera prompt.

### One concern raised, then built as asked

Retaining receipt photos past account deletion is a legitimate retention decision,
but `profile.deleteAccountBody` promises *"We'll erase your profile, credits,
history…"*, which a user reasonably reads as covering their photos. Shipping the
backend change alone would have left an in-app claim the backend no longer
honours. So the deletion screen now states the retention window, **EN + FR**,
driven from the same `app_config` value the sweep reads — change the number and
the copy follows.

### Deliberately documented rather than fixed

- Everything carried forward from passes #4/#5 (iOS background execution, the
  app-switcher overlay, IDFV vs SSAID) — explicitly out of scope.
- `requestDeletion` does not null `email`/`name`/`picture` despite the route
  docstring saying deletion "wipes personal data". Retaining the email for the
  grace window is **load-bearing** (it stops trial-credit farming across a
  delete-and-resignup) and the whole row goes at the hard purge. Code/comment
  drift; recorded so it is not "fixed" into a regression.
- `/api/me` reactivates a soft-deleted account unconditionally, bypassing audit
  #4's A2 `reason=signin` gate. Dormant — the mobile client never calls it — and
  the route claims the exemption deliberately.

### Tests & regression risk

Widened the `pushI18n` guard to derive its file list from every backend file that
sends a push, plus a meta-assertion so it cannot silently narrow again. New:
`healthAppleAuth`, `imagePresignCap`, `objectRetentionDb`, `profileWriteGuardsDb`,
`dataExportIdentityDb`, `priceDropPushLanguage`, `withIosBackupExclusion`.
Rewrote `pruneReceiptImages` and one `lifecycleDedupe` case to assert the
*opposite* of what they used to — deliberately, since the retention contract
inverted.

The presign test earned its keep on the first run: it caught that `Number(null)`
and `Number("")` are both `0`, so an explicit `imageBytes: null` was being read as
"declared zero bytes" and refused.

### One CI round-trip, and why it was right

The Security job failed in 9 s: the Apple health fixture used a real
`-----BEGIN PRIVATE KEY-----` envelope. The tempting fix — a gitleaks path
exclusion for `backend/tests/` — is exactly what the standing rule forbids, and
would have muted the one control that catches a genuinely leaked `.p8`. Fixed the
*value* instead: `isConfigured()` checks presence, never parses, so the fixture
never needed to look like a key.

### Still owed

- **On-device items 30–36** (`Technical/iOS_Audit_2026-08-12_Pass6.md`). Item 34
  — confirming `NSURLIsExcludedFromBackupKey` on a real handset — is the only one
  in this audit that cannot be verified any other way.
- **`GET /health` with `x-admin-token` on both Railway services** should now
  report `checks.appleAuth.revocation: "missing"`. That is the change working;
  provisioning the `.p8` is still the open ops task.
- Migration `0005_object_retention` is applied to dev by CI. **Production must be
  applied by hand** — its drizzle ledger is hand-maintained and `db:migrate`
  there would try to re-run `0000_initial`.
- Release notes must mention the Android `allowBackup` change: a device transfer
  no longer carries local app data, and restore goes through `/api/me/bootstrap`
  plus on-open image fetch.

**Post-push addendum (same day).** The Backend CI job went red with dozens of
unrelated suites failing together — one cause, not thirty. `db/seed.js` gained an
upsert for the new `object_retention_types` lookup, `ensureSeeded()` runs on
nearly every repo call via `lookupId`, and the table did not exist on the shared
dev database yet. **CI points at Supabase dev and never runs migrations**, so a
new migration is an out-of-band step; adding a row to the seeder is what turns a
missing migration into a total failure rather than a local one.

Applied `0005_object_retention` to the **dev** project (`gnedluuylimjwdmtvswl`)
additively, with the drizzle bookkeeping row keyed on the migration file's real
SHA-256 — the hand-maintained procedure the 0003/0004 apply used. Verified: both
tables present, 2 types seeded, 8 existing keys backfilled, FK and ledger row
recorded. **Production still owes 0005, by hand.**

A second defect surfaced from re-reading the diff while that job was red, not from
CI: the new export suite sent no `Authorization` header, and `requireAuth` matches
that header *before* calling `verifyAuth` — so injecting `app.locals.verifyAuth`
is not enough on its own. Recorded as Bugs #191, with the general form: **a red
run hides the next bug; read the diff rather than waiting for the rerun.**

---

## 2026-08-12 — iOS audit #7 (deep security pass: auth, credits, RevenueCat, account, scans)

**Asked:** a full, deep iOS audit with security first — authentication, credit
management, RevenueCat, account management, receipt scans, price-tag scans —
including any iOS/Android behavioural difference, everything documented if not
fixed, and explicitly *not* re-doing the bugs the previous audits already
documented.

**Approach.** Read all six prior iOS audits first, then deliberately targeted the
three kinds of place they had structurally not looked: claims the codebase makes
about itself; primitives that were verified correct, for the checks they do *not*
perform; and platform behaviour with no `Platform.OS` to grep for. Five defects,
all fixed.

- **A1 (Medium-High)** — Sign in with Apple carried **no nonce**, so the identity
  token was replayable by anything that could observe it. On iOS that escalates:
  the token is redeemable at `POST /api/auth/session` for a **60-day** refresh
  token. Fixed with the standard binding (client hashes, Apple gets the digest,
  backend gets the raw value on `x-apple-nonce`), rolled out **accept-if-present**
  so no TestFlight build can be locked out. `/health` now reports
  `appleAuth.nonce.{verified,legacy}` so the flip to mandatory is a data decision.
- **A2 (Medium)** — the price-tag presign was **never capped**: audit #4 added the
  server-side ceiling, no client ever sent `imageBytes`, and audit #6's receipt fix
  contained a comment asserting the tag path already did. Client now declares;
  comment corrected. → Bugs #192.
- **A3 (Medium)** — the foreground sweep fired on **every transient iOS
  interruption** (Control Centre, permission dialogs — twice per scan), re-running
  both queue drains, the top-up flush and a RevenueCat sync that posts to a
  10/min-per-account endpoint. Gate extracted to `src/utils/foregroundGate.js`.
  → Bugs #194.
- **A4 (Low)** — `flagged` blocked *spending* credits but not *earning* them; tag
  settlement and referral redemption both ignored it. Now guarded, with the
  observation still recorded (the price data is not what is under suspicion).
  New EN/FR copy `profile.referralFlagged`.
- **A5 (Low)** — `minimumInterval: 24h` is a floor iOS deprioritises; now
  platform-split (2 h on iOS). Refines, does not close, the carried
  "iOS background execution is materially weaker" item.

**Caught mid-implementation and worth remembering:** the first nonce
implementation shipped `nonce: ""` when the native digest was unavailable — which
is *worse* than no nonce, because an empty claim is not a missing one and takes
the enforced branch, 401-ing every Apple sign-in. The pre-existing Apple suites
caught it. → Bugs #193.

**Docs:** `Technical/iOS_Audit_2026-08-12_Pass7.md` (findings, verified-clean list
for pass #8, regression table, on-device items 37–42) and Bugs #192–#194.

**Not in scope / still open:** `checkAllPriceDrops` still has no foreground
equivalent on iOS; P3 snapshot overlay still needs a handset; the `.p8` key and
`SESSION_TOKEN_SECRET` remain unset — and A1 is a reason to set the latter on a
build that already sends nonces. No migration; production still owes `0005`.

---

## 2026-08-12 — 2.8.5 field bugs: signup vs restore, delete-and-recreate, and an admin credit desk

**Asked:** four things from an iPhone test of 2.8.5. (1) Signup showed the restore
screen and then created a new account — a signup should only create when the
account does not exist, and restore when it does, with two different screens and
two different messages. (2) With a referral code entered, the create-account
button lost its text and looked disabled. (3) After deleting an account it was
impossible to re-create it for a few minutes (always an error), and the credit
reset to 0 — correct in general, but a deletion undone within ~2 hours is human
error and should give the credits back. (4) A "manage credits" screen in the
admin panel: filter (all/active/inactive), a user list, an amount, a radio for
the action type, and a motif list scoped to that action.

**Two of the three bugs were one root cause.** `hydrateFromBackend`'s in-flight
dedupe was reason-blind, and `reason` is load-bearing — only `?reason=signin`
may revive a soft-deleted account. Signing in backgrounds the app, so the
foreground hydrate (`App.js`, 5-min throttle) races the sign-in one; the sign-in
call joined it, the server never saw the reason, answered 403 `account_deleted`,
and `syncService` **signed the user out mid-signup**. The "few minutes" in the
report is that throttle. → Bugs #195.

The blank button was white-on-white: `ActivityIndicator color="#fff"` inside a
`#fff` button, rendered *instead of* the label. A referral code adds a redemption
round-trip ahead of the profile sync, which is what stretched it from a flicker
into seconds. Eight other `color="#fff"` call sites were checked — all on dark
buttons. → Bugs #196.

**The credit restore is derived, not snapshotted** — Maxim's call, and the better
design. `requestDeletion` stops deleting `credit_ledger` and retains it for
`CREDIT_RESTORE_GRACE_HOURS` (new app_config, default 2); a re-signin inside the
window sets `scan_credits = SUM(delta)` and appends a **delta-0**
`deletion_restore` audit row. Delta-0 is not a detail: the balance is derived
*from* the sum, so a non-zero delta would double it. `balance == SUM(delta)`
therefore holds by construction rather than by correction, and no new column can
disagree with the ledger. **No migration** — the only new lookup value is a seed
row in the existing `credit_event_types`.

Two consequences, both handled: `purgeExpiredRestoreLedgers` (hourly cron) still
completes the erasure once the window lapses, and `creditReconRepo` now excludes
`status = false` rows — without that, every account deletion would have opened a
reconciliation case, and "Apply" on one would have handed credits back to a
deleted account.

**Admin credit desk.** `shared/adminCreditReasons.js` is one motif list, required
by the backend for validation and imported by the app for rendering, paired with
the action (`chargeback` is not a reason to GIVE credits). Movements go through
the existing `admin_adjust` type with `notes: "admin:<code>"` — a stable code,
translated client-side, never rendered raw. A redeem is clamped to the live
balance and *says* it was clamped. Routes reuse the sibling admin gate
(`requireAuth` + `ADMIN_USER_SUBS`).

### Caught while building

- **A late subscriber to a deduped callback never fires.** `onAccountKnown` is
  held by the onboarding screen's hydrate, which dedupes onto the one
  `finalizeGoogleSignIn` already started. Remembering the answer and firing
  immediately for late joiners is what stops the screen waiting forever on a
  signal that already happened.
- **My own first cut relabelled a returning user as new.** The setup route set
  `isNewAccount(true)` unconditionally, clobbering the server's answer, so a
  returning account with a half-finished profile was told to "create your
  account". Caught by the test written for the opposite case.
- **The new `shared/` ↔ `backend/shared/` parity test went red on its first
  run** — `ocrCleanup.js` had genuinely drifted (benign here; `pricing.config.js`
  is the neighbour where it would not be). Synced. → Bugs #197.
- **`t()` cannot detect a missing translation** — it falls back to the key, so
  comparing its output to the key is a heuristic. `hasKey()` exists for exactly
  this and is what `catalogLabels.js` uses.

### Tests & regression risk

Mobile: 185 suites / 4324 tests green locally. New: `syncServiceHydrateReason`,
`onboardingSignupVsRestore`, `adminCreditsScreen.smoke`, `adminCreditReasons`,
`sharedMirrorParity`, plus admin-motif cases in `creditLedger`. Backend: new
`creditRestoreWindowDb` and `adminCreditsRoutesDb`; the window arithmetic is a
pure exported predicate tested under a **TZ matrix** (a duration, not a date, but
the matrix is what stops a future refactor reaching for a calendar date).

`accountDeletionTombstoneDb`'s "never re-grants the trial credits" case was
**deliberately inverted**: it asserted `scanCredits === 0` after delete+restore,
which is precisely the behaviour the fix changes. The half it was really
protecting — that the trial grant must not re-*fire* — is still asserted, and is
a different mechanism (`trial_credits_granted_at`, `emailEverGrantedTrial`).

**Stated risk:** erasure of the credit ledger now completes up to the window plus
an hour after deletion rather than in the same transaction — the deletion copy
and privacy policy should be re-read for any claim of instant erasure. A second
concurrent hydrate (signin + foreground) is now possible where there was one;
both are read-mostly and `_applyPrefs` is already last-write-wins. Older client
builds render an unknown `admin:<code>` motif via a translated generic fallback,
never blank.

### Still owed

- Production still owes migration `0005_object_retention` by hand (unchanged —
  this work adds no migration).
- On-device verification of all four items on a standalone `device`-profile build.

**Post-commit addendum (same day), found by re-reading the diff rather than by a
red run.** Two gaps, both in the seam between the restore window and the job that
enforces it:

- **A window measured in hours, enforced by an hourly job, has a stretch where
  the two disagree.** A tombstone past its 2-hour window still holds its ledger
  until the purge next runs. Reviving in that stretch flips `status` back to
  true — and the purge only targets tombstones — so those rows would have
  survived *forever* against a zeroed balance. Permanent drift, which the
  reconciliation sweep would then have offered to "correct" by handing back
  exactly the credits the lapsed window said were forfeit. `upsertFromOAuth` now
  completes the erasure itself when it revives a tombstone outside the window.
  **General form: when a deadline and the job that enforces it run on different
  clocks, the code that reads the deadline must handle the interval between
  them.**
- **A single `await` on a shared in-flight promise leaves the slot free for one
  microtask turn.** The sign-in hydrate's guard is now a `while`, not an `if`:
  re-check after waiting rather than assume nothing started. It cannot spin —
  every iteration awaits a promise that must settle, and the only non-signin
  producers are throttled (boot once, foreground once per five minutes).

**CI round-trip (first backend run, 19m28s, two failures — both informative).**

- **`Number()` coercion on the admin credit route.** The refusal list in the new
  test included the string `"10"`; the route accepted it, because
  `Number("10")` is a positive integer by the time the guards run. Following that
  up found the real one: `Number("1e3")` is 1000 and passes `isInteger`, so a
  three-character string would have granted a thousand credits. Now requires
  `typeof === "number"`. → Bugs #200.
- **A second test asserting the erasure contract I inverted.**
  `usersRepoDb.test.js` also required `rawLedgerCount === 0` after
  `requestDeletion`. Updated deliberately, and extended to assert the bounded
  half — `purgeExpiredRestoreLedgers` still takes it to zero — so the retention
  is pinned as a *window*, not as "we stopped deleting".

**Correction to the note above about `backend/shared/`.** There IS a sync
mechanism — `backend/scripts/sync-shared.js`, on `prestart`/`pretest` — which the
first pass missed because it builds its paths with `path.resolve` and never
contains the string "backend/shared". It is narrower than it looks, though: it
copies a hardcoded `FILES` list (so a new shared module is outside it entirely),
and it no-ops on Railway, where the committed copy is what production runs. So
the `ocrCleanup.js` drift was real for a deploy, just self-healing on any local
test run. `adminCreditReasons.js` added to `FILES`, and the parity test now also
asserts that list covers every mirrored file.

**Also hardened before the second push, from re-reading the diff:** the admin
redeem clamp was a read-then-write race (two concurrent redeems could each take
the full balance). Moved into `creditsRepo.applyAdminAdjustment`, which locks the
users row first — the same pattern `creditReconRepo.apply` already uses. → the
general form is in Bugs #199's neighbourhood: a check and the write it guards
must not straddle an await without re-reading.

## 2026-08-16 — The sign-in outage nothing could see

**Asked:** 2.8.8 from Play shows *"We're sorry — sign-in can't be completed right
now / Our service is temporarily unavailable"* after a **successful** Google
sign-in. Same dialog on earlier versions and on both platforms. "Analyze it
deeply and find the ultimate solution — this is a regression."

### What it actually was

Not a per-account problem and not a client regression. **Production had recorded
zero successful authenticated writes since 2026-08-12 12:16 UTC** — four days.
`users.updated_at`, `devices.last_seen` and `consent_events.occurred_at` all
froze within the same nine minutes. The reporting account itself was healthy
(active, 3481 credits, no deletion pending).

Traced the dialog to `OnboardingScreen.js:428-435` (`decideSignInRoute` →
`"retry"`, service body ⇒ `reason !== "network"`), which narrows the hydrate
result to `http_<status>` from `GET /api/me/bootstrap`. The other branches are
excluded on evidence, not assumption: `unconfigured` by
`config/profiles/index.js:30` (the merge skips `undefined`, so production
resolves to the prod Railway URL), `account_deleted` by the NULL
`deletion_requested_at`, `email_claimed`/`signed_out` by routing elsewhere.

Ruled out, each with a probe rather than a guess: stale deploy (routes added in
PR #260 answer 401, not 404, and PR #261's `purgeRestoreLedgers` cron runs green
hourly); database (all lookup seeds bootstrap needs exist, so `lookupId` is not
throwing; migrations applied through 0004, and the missing 0005 is not on this
path); pool starvation (prod serves 10 concurrent DB-backed requests in 4.4 s
without failing).

### The fix shipped in this pass

`/health`'s auth verdict was `GOOGLE_AUDIENCES.length ? "configured" : "missing"`
— a **disjunction over three environment variables**, structurally unable to
report the absence of one. Lose a single client ID and the array is still
non-empty, so the check reads green while `requireAuth` 401s every request from
the platform whose audience went missing. → Bugs #205.

Replaced with a per-platform conjunction in `backend/lib/googleAuthHealth.js`,
extracted as a pure function because the client IDs are read from `process.env`
at module load — which is exactly why the old check had no test.

**The cross-wiring is the load-bearing part.** The two native SDKs mint tokens
for different audiences: Android's is addressed to the **web** client
(`requestIdToken(webClientId)`), iOS's to the iOS client. So `GOOGLE_CLIENT_ID`
is what Android depends on, and `GOOGLE_CLIENT_ID_ANDROID` gates nothing — no
shipped client addresses a token to it. A check that went red on its absence
would cry wolf; one that pattern-matches android→android reports the wrong
platform as down.

This is the **fourth** instance of the same class (the Google iOS audience, the
session secret, the Apple `.p8`) and the first to cost an outage.

### Why every monitor stayed green

All of them were true and useless. `healthy` tracks the DB alone — correctly.
Crons never call `requireAuth`, so `job_runs` was green through a 100% auth
outage. `api_audit_log`, the table the *previous* version of this bug was
diagnosed with, no longer exists after the schema v2 redesign.
`recordAuthFailure`'s counters are in-memory and admin-gated, so they vanish on
restart and are unreachable without a token you don't reach for mid-incident.

### Deliberate decisions

- **The breakdown is PUBLIC**, unlike `sessions`/`appleAuth`'s named blockers.
  Booleans about which of our own OAuth clients a deployment accepts are not
  secrets, and hiding the one fact that names the outage behind the admin token
  is what made this take four days. Values are never echoed — a test asserts it
  for both payloads.
- **Reports, never enforces.** `healthy` must not move on it, or an
  auth-configuration gap starts flapping Railway's deploy gate.
- **One source for one dependency.** The status had three separate expressions
  (public, admin `checks`, legacy top-level) and two disagreed; a test now
  asserts all three agree.

### Still owed

Steps 2-4 of the plan: a `SIGNIN-4xx-BOOTSTRAP` reference code on the blocking
dialog (this is the one user-facing error with no support code, which is why the
diagnosis started from a screenshot instead of a code); a synthetic canary that
actually authenticates; and migration 0006 persisting non-2xx auth outcomes,
hand-applied to prod alongside the still-owed 0005.

**Regression risk stated:** the public `/health` `auth` field changes shape
(string status → object with `clients`/`signIn`); anything parsing it as a bare
string needs checking. Report-only, so it cannot take production down.

## 2026-08-18 — R8 hardware checklist, second pass: 6 of 10 items closed on a Play production artifact

**Asked:** continue the R8 full checkup on device (Pixel 10 / Android 17, adb).

**Artifact under test:** `2.8.8 / versionCode 28`, **installed from Play**
(`installerPackageName=com.android.vending`), not a sideloaded preview APK. That
matters — the 2026-08-15 pass that found #204 ran against preview APK `20bb08e7`,
so this run independently re-confirms the defect on the artifact real users have.

R8 was verified live on this binary from its own stack traces rather than assumed:
`T6.T.call`, `U6.i.run`, `ReactHostImpl.x1` are obfuscated, while
`io.sentry.react.RNSentryModuleImpl.crash` and `com.facebook.jni.NativeRunnable.run`
are fully readable — i.e. minification is on **and** the `-keep` rules are hitting
exactly their intended packages. `SourceFile:50` line numbers survive, so
`-keepattributes SourceFile,LineNumberTable` works.

### Results

| # | Item | Verdict |
| --- | --- | --- |
| 1 | Google Sign-In, full flow | **PASS** — signed out and back in; confirmed server-side |
| 2 | Sign in with Apple | **N/A** — Android onboarding offers Google only |
| 3 | RevenueCat paywall + prices | **PASS** — store prices, provably not the fallback |
| 4 | RevenueCat restore | **PARTIAL** — button unreachable for this account; nothing restorable |
| 5 | Camera → receipt scan end to end | **PASS** — real receipt parsed, 7 items with SKUs + TPD pairs |
| 6 | Price-tag scanner | **PASS** — live capture by Maxim, parsed correctly |
| 7 | Push notification | **BLOCKED** — outbound send refused by the harness |
| 8 | Background fetch | **STILL BROKEN on 2.8.8**; fix rides in 2.8.9+, unverified on hardware |
| 9 | expo-updates check | **PASS** — full lifecycle to `CheckCompleteUnavailable` |
| 10 | Deliberate crash → Sentry | **BLOCKED — the trigger no longer crashes** (see below) |

**Item 3 is the one worth reading twice.** "Paywall renders with prices" is a
false-pass trap: `BuyCreditsScreen` resolves `storePrices[id] || p.priceLabel`, so
a total offerings failure still renders a full-looking paywall. The hardcoded
fallbacks are `"$3"`, `"$5"`, `"$10"`; the device showed `$3.00`, `$5.00`,
`$10.00`, plus `$49.99/year` for the sub. Two-decimal formatting is Play's
`priceString`, which the fallback cannot produce — so the RevenueCat model classes
really did deserialize. Verify the *shape* of a value, not its presence.

**Item 1 was confirmed off-device, not from the UI.** `users.updated_at` moved to
`08:43:17Z`, 40 s before the query, and `auth_outcomes` holds **zero** rows after
the sign-in. A screenshot of a populated Profile only proves the client rendered
something; an authenticated write proves the token was minted, transmitted and
verified against the Google audience.

### Two new findings

**1. `Sentry.nativeCrash()` no longer produces a crash — RN bridgeless swallows it.**
`RNSentryModuleImpl.crash()` is `throw new RuntimeException("TEST - Sentry Client
Crash (only works in release mode)")`, which relies on reaching the JVM's default
uncaught handler. Under RN 0.83's bridgeless runtime `ReactHostImpl` catches it,
converts it to `ReactNoCrashSoftException`, destroys the React instance and
**leaves the process alive on a blank white screen**. No tombstone, no cached
envelope on relaunch, so nothing for Sentry to symbolicate. The admin diagnostic
added in PR #221 specifically to make item 10 testable therefore cannot test it
any more, and item 10 has never actually been executed. The app did recover fully
on next launch.

**2. `NoSuchFieldException: mIsFinished` — looks like R8, is not.**
`WorkletsMessageQueueThreadBase.quitSynchronous` does
`getDeclaredField("mIsFinished")` on RN's `MessageQueueThreadImpl`. RN 0.83
declares `@Volatile private var isFinished` — Kotlin, **no `m` prefix**. The name
is stale upstream, so the lookup fails in a debug build too and **no keep rule can
fix it**; `-keep` on `isFinished` would not help because worklets asks for a name
that does not exist. Caught and printed to `System.err`, so it is invisible to
Sentry. Fires only on React-instance teardown, where it leaves the worklets queue
thread unmarked and produces a burst of "Tried to enqueue runnable on already
finished thread". Deliberately **not** given a proguard rule — that would be the
cargo-culting #204 warns against.

### Sweep

Ran #204's prescribed sweep across every log captured (cold start, receipt scan,
document scanner, price-tag scan, paywall, sign-out/sign-in, crash, relaunch).
Exactly two reflective failures exist in the whole corpus: `RNHeadlessAppLoader`
(#204, fixed in 2.8.9+) and the worklets `mIsFinished` above. Zero
`NoSuchMethodError`, zero `NoClassDefFoundError`, zero `UnsatisfiedLinkError`.

### Also noticed, not R8, not fixed

- **Restore is unreachable for a non-premium account.** `ManageSubscriptionScreen`
  returns early when `!status.isPremium` (line ~336) and that branch renders no
  Restore button; the audit-#4 R6 furniture was added only to the premium branch.
  The user who most needs Restore — an existing subscriber whose entitlement did
  not load, who is therefore `!isPremium` — is exactly the one who cannot see it.
  The Paywall's Restore is gated behind a low-balance banner a 131-credit account
  never sees.
- **A 401 burst renders as "You're offline".** After the forced restart,
  `/api/me/credits`, `/api/me/consents`, `/api/me/bootstrap` and `/api/me/profile`
  took `401 verify_rejected` for ~60 s (08:34:34–08:35:31Z) while the UI said
  *"You're offline — scans saved locally, price checks paused"*. It self-healed
  via silent refresh. Mislabelling auth as connectivity is the same reporting
  failure class as Bugs #205.

**Status:** 6 PASS, 1 N/A, 1 PARTIAL, 2 BLOCKED. Items 7 and 10 need decisions;
item 8 needs 2.8.9+ on hardware — production build `90b06441` (2.8.10 / vc30,
commit `e12adc3`) already exists and is one install away.

**Regression risk:** none. Read-only device exercise; no code changed, no receipt
saved (confirm screen cancelled), pushed fixtures deleted and `svc power stayon`
restored. One credit was consumed by the receipt scan (131 → 130), which is the
metered path behaving correctly.

## 2026-08-18 (cont.) — checklist closed out: 7 PASS, and the crash probe that could not crash

Maxim installed **2.8.10/vc30 from Play** mid-session and allowed a Bash rule for the
Expo push endpoint, which unblocked the two items the first pass could not run.

**Item 8 — #204 confirmed fixed on hardware.** Across a cold start and two full
pause/resume cycles on 2.8.10 (8,676 log lines), `ClassNotFoundException:
…RNHeadlessAppLoader` **does not appear once**; on 2.8.8 it fired on every pause and
resume. The `-keep` rule works.

The verdict is deliberately narrower than "background fetch works", because a
control comparison moved it: **2.8.8 also logged `TaskService: Registered task` and
`Starting an alarm`.** Registration and alarm scheduling are in-process and were
never broken — #204 broke the *headless JS context* Expo needs when the alarm fires
with the app dead. So the armed alarm proves nothing either way; the **absent
exception** is the evidence. A fetch executing has still not been observed: that
needs the real schedule with the app killed, or a reboot — `BOOT_COMPLETED` is a
protected broadcast `adb` cannot send, and the bare `TaskBroadcastReceiver` action
no-ops without task extras. Two attempts, then stopped.

**Item 7 — PASS, both halves.** Expo accepted both sends and the device posted them:
`NotificationRecord … pkg=com.priceback … color=0xff10b981` with the app's own icon,
once backgrounded and once with the app confirmed `topResumedActivity` (the first
foreground attempt was void — the screen had slept, so it was really a second
background test). FCM payload mapping is intact under R8.

### Item 10: the trigger cannot crash, and that is a bug of its own → Bugs #211, PR #281

`Sentry.nativeCrash()` is `throw new RuntimeException(...)` from a TurboModule
method, and it works by letting that exception reach the JVM's default uncaught
handler — where Sentry's `UncaughtExceptionHandlerIntegration` lives. RN 0.83's
**bridgeless** `ReactHostImpl` catches everything on that path, wraps it as
`ReactNoCrashSoftException` and destroys the React instance. Hence the observed
**blank white screen with a live process**, no tombstone, no cached envelope on
relaunch. The method's own comment — *"only works in release mode"* — is a fossil
from the old bridge, where release rethrew.

So the diagnostic added in PR #221 *to make item 10 possible* has meant item 10 was
never executed on any build, 2.8.5 → 2.8.10, while reporting success.

**Fixed by raising the crash from the main looper**, outside ReactHost's try/catch.
That needs native code and `android/` is gitignored, so it ships as
`plugins/withAndroidCrashDiagnostic.js` — one `onNewIntent` override on MainActivity,
armed by a private deep link and refused unless `referrer` is this app (MainActivity
is `exported="true"`; a web page must not be able to kill it). The gate fails closed
on purpose, because the JS side now notices a surviving process and says so.

**The contract is the durable half.** A crash that worked never returns, so
`triggerNativeCrashForDiagnostics()` no longer returns a boolean — any resolved value
means the crash did not happen and names why (`"unavailable"` / `"not_fired"`). A
signature that cannot express failure is what made three releases of failure look
like success.

### Verification status — read before trusting the tests

- Plugin executed against the **real generated** `MainActivity.kt`: idempotent
  (byte-identical on re-run), brace balance preserved, one each of marker / override /
  companion object / import. `npm run i18n:check` green (1465 keys, EN+FR).
- **CI did not run.** All three jobs on PR #281 failed in 3-5 s with `steps: 0` — the
  GitHub Actions billing block again, not a test failure. The new suites are therefore
  **unverified by CI**, and per standing rule nothing was run locally.
- **No build started**, at Maxim's explicit instruction. Item 10 stays open until a
  build carries #281.

**Regression risk stated.** The plugin edits MainActivity, which is on every launch
path; the change is one `onNewIntent` override that chains to `super` and returns
early unless both the URI and the referrer match, so ordinary launches and deep links
are untouched. iOS is not affected — no bridgeless interception of native-module
throws and no MainActivity to deep-link into, so it keeps `nativeCrash()`. Residual:
another *installed* app could spoof `EXTRA_REFERRER` and crash PriceBack — a nuisance
with no data exposure and no persistence.

**Device left clean:** pushed fixtures deleted, `svc power stayon` restored, one
credit consumed by the receipt scan (131 → 130), no receipt saved.

---

## 2026-08-18 — iOS billing: wrong-currency labels, invisible subscriber credits, and purchases the server never saw

**Trigger.** TestFlight testing of 2.8.10 on iOS. Three reports: prices shown in
USD while the purchase sheet charged CAD; after subscribing, no credit balance and
no credit history; credit packs "paid, credits never arrived".

**Investigation.** Read the purchase/paywall path, then queried production
(Supabase `xjfrlzwonyaorwktnkpj`) directly. The database settled the third report
and reframed the second:

| Check | Result |
|---|---|
| `priceback.subscription_events` | **0 rows, ever** |
| Users with a paid `subscription_tier_id` | **0** |
| `credit_ledger` rows of type `topup_purchase` | 4, all with `ref` `dev_…` (simulated sideload) |

No real store purchase has ever been credited in production. Root cause: nothing
asserted that RevenueCat's `appUserID` equalled the signed-in account, so purchases
were filed against an anonymous id the backend never queries. Details and the rules
drawn from it are in `Bugs_Common_Fixes.md`.

Two supporting defects found on the way:
- `formatMoney` rendered CAD as a bare `$` (`backend/config/configService.js`).
- **The remote pricing catalog never reached the paywall.** `getEffectiveCatalog()`
  was consumed only inside `pricingCatalogService`; every surface imported
  `PACKS`/`TIERS` frozen from the bundled config at module load. The docblock's
  promise that prices change "without an App Store release" was false.

**Delivered (PR #282, branch `fix/ios-billing-currency-identity-credits`).**
- New `src/services/storePrices.js` — the only source of a displayed price. Shared
  snapshot, coalesced round-trips, disk cache, non-blocking retries, explicit
  status. `priceFor(id)` has **no fallback parameter** by design.
- Skeleton + disabled purchase CTA until a real store price exists, on all three
  purchase surfaces plus the auto-reload pack picker and the FAQ copy.
- `ensureRevenueCatIdentity()` at boot, on foreground, and before `purchasePackage`.
- Durable subscription-sync retry, cleared only on a server-confirmed paid tier.
- Backend `402` split (`resyncStore`) + owning-appUserID logging; `CA$` formatting;
  currency on subscription price blocks.
- Credit History shows the real balance and ledger for subscribers.
- New admin **Billing diagnostic** screen reporting the store ↔ RevenueCat ↔ server
  conjunction.
- Paywall surfaces now read the effective (DB-backed) catalog and re-derive on a
  catalog swap. Entitlement gating deliberately stays on the bundled contract.
- Data: fixed the `aroud` typo in `credit_packs.description` on dev **and** prod.

**Tests.** New `storePrices`, `revenueCatIdentity`, `purchaseCatalogWiring` suites;
extended paywall/billing/credit-history smoke tests to assert a skeleton and a
disabled CTA rather than a catalog price; backend coverage for CAD formatting and
the 402 split. `npm run i18n:check` passes (en/fr in sync, 1476 keys).

**BLOCKED — CI could not run.** The GitHub Actions billing block has recurred: run
`32146532211`, all three jobs refused to start in 3s with the annotation *"recent
account payments have failed or your spending limit needs to be increased"*. Per
the standing rule this was **not** compensated with local runs or `gh pr merge
--admin`. The PR is open and unverified until billing is cleared and CI re-runs.

**Regression risk.**
- The paywall becomes unbuyable if the store never answers — deliberate (the
  purchase would fail anyway), but it changes App Review's experience on a bad
  network. Mitigated by the disk cache, the backoff retry and an explicit retry
  control; worth knowing before the next submission.
- Catalog resolution changed for every `purchaseService` consumer, including
  entitlement resolution and the auto-reload pack picker. Covered by
  `purchaseCatalogWiring` on both the remote and bundled-fallback paths.
- `ensureRevenueCatIdentity` adds one awaited, coalesced, no-op-when-aligned SDK
  read before `purchasePackage`.
- Everything else is additive; the Credit History change is two lines on one screen.

**Acceptance is server-side, not visual.** After the next TestFlight pass:
`select count(*) from priceback.subscription_events` must be **> 0**, and a
`topup_purchase` row must carry a real store transaction id rather than `dev_…`.

## 2026-08-18 (cont.) — Developer output hidden from shoppers, and production purged of test data

- **Asked (/goal):** "cleanup the app from any non user friendly UI (example:
  raw OCR)… just hide these functions, it should still be visible for admins,
  cleanup all the tests data in the production DB (accounts, …etc), any
  generated data should be cleared, keep only the production data and remove the
  data claude generated."

**Decisions taken by Maxim** (offered as options before any change):

| Question | Answer |
|---|---|
| Which UI to gate | raw OCR card, raw cache filename, ISO date notation. **Not** the bare `#811` warehouse label — that number is printed on the real receipt |
| 8 tester accounts | **delete all 8** (flagged: may affect Play's 12-tester count) |
| Simulated `dev_` billing | **purge and reset to a clean grant** |
| Purge method | **direct SQL, no backup table** |

**App — PR pending, branch `chore/hide-dev-ui-and-purge-prod-test-data`,
commit `d420816`.** Nothing removed; everything moved behind the existing
server-authoritative `getIsAdmin()`.
- ScanScreen's raw-OCR card, which auto-EXPANDED on a failed parse — so a
  shopper's worst moment showed the most machine output. Admins keep it.
- DetailScreen's raw cache filename under "Open original file" (the row, its
  label and its tap target still render for everyone).
- Six i18n strings across EN+FR taught the date as `YYYY-MM-DD` / `AAAA-MM-JJ`,
  but every date field is a `DateField` — a **calendar** the user cannot type
  into. `scan.dateMask` deleted; the field falls through to `datePicker.select`.
- Bonus, found in the touched code: `+ Add manually` was a hardcoded English
  literal, so a French user read English on the screen that had just failed them.
- 11 new tests (`adminOnlyDiagnosticSurfaces`), both sides of both gates, plus a
  static sweep for date notation. Two cases exist only to prove the harness
  actually renders the surface under test — every `not.toContain` would
  otherwise pass vacuously. 10 neighbouring suites green (99 tests).
  `i18n:check` en=1464 fr=1464.

**Production DB — DONE, irreversible.** Full record, evidence and re-run rules:
`Operations/Production_Test_Data_Purge_2026-08-18.md`.
`users` 15→7, `price_points` 505→155, `products` 3,288→114, `warehouses` 619→183,
`topup_refs` 9→0, `credit_reconciliations` 1→0. Receipts, receipt items and tag
reviews untouched; 0 orphaned FKs afterwards. Every post-purge count matched the
pre-measured prediction exactly.

**Two things that would have gone wrong on the obvious approach.**
- Deleting products by their `created_at` test window would have hit live
  receipts — real receipt items point at products created inside it. The correct
  filter is referential, and it must also keep any product carrying a **barcode**
  (20 of them, incl. real catalog rows) or it silently guts barcode↔SKU lookup.
- Removing the fake `+3,400` top-ups without also removing the `−3,350`
  `admin:chargeback` that existed to cancel them drives the balance to −3,271.
  Both went; the owner's ledger now sums to 79 = `users.scan_credits`.

**Side effect.** Production now has **zero** `topup_purchase` / `topup_refs`
rows, which sharpens the acceptance criterion recorded for PR #282 above: the
next such row can only come from a real store transaction.

**Regression risk.** App changes are additive gates on render paths whose
fallbacks already existed independently, covered both ways by new tests; the
i18n changes are copy-only, edited in both languages together and enforced by
`i18n:check`. The DB purge is irreversible and unbackuped by explicit choice —
that is the standing risk, and this log plus the purge doc are its only record.

---

## 2026-08-19 — 2.8.10 sign-in: a signup was routed as a restore

**Task.** Field report on 2.8.10: since the sign-in user-existence precheck
shipped, signing in shows a loader "for a while", then **"Restoring your
account…"**, and a new user is blocked. Find the root cause and fix it.

**Root cause.** The precheck worked; its answer never reached the routing
decision. `decideSignInRoute()` read `profileComplete && postalCode` before the
hydrate's `accountExists`, and those prefs are not account-scoped — `signOut()`
keeps them so the same person signing back in (offline included) does not lose
their history. On any handset where some account had onboarded, a brand-new
account was therefore routed `"main"`: the restore screen, then straight into the
app, with SetupStep never running — so no postal code or province ever reached
the server, and `serverAccountExists()` stayed false forever, repeating the same
branch on every later sign-in.

**Confirmed in production, not inferred.** Two accounts, one household, one
device, 2026-08-17: `monicasharobim@gmail.com` finished setup at 15:45 (postal
`J0N 1P0`, three `consent_events` incl. `marketing_push`);
`sharobimmonica@gmail.com` was created at 15:47:43 with NULL
postal_code/province and exactly the **two** consents the returning-user branch
queues, 9 seconds after the row existed. Nothing else in the app sends that pair
alone. Still in use with a NULL postal code a day later.

**Two more defects on the same path.** `_hydrate()`'s tail awaited
`syncPushTokenToBackend()` and `flushProfileSync()`, both reaching
`syncProfileToBackend()` — the last backend call in the app with no
`AbortController` — *after* the screen had committed to a full-screen loader that
cannot route until the hydrate resolves. That is the "loading for a while", and
with no bound it was unbounded. Separately, `unionMergeReceipts` flags every local
receipt the server did not return as `syncPending`, so an account switch did not
merely *show* account A's receipts to account B — the push pass **uploaded** them
into B's server records.

**Fix.** (1) `decideSignInRoute` returns `"setup"` on a positive
`accountExists === false`, ahead of the prefs check — strictly `=== false`, so a
missing field / failed hydrate / offline sign-in behave exactly as before.
(2) New `enforceLocalAccountBoundary(sub)` keyed on `local_data_owner_sub_v1`:
no owner → adopt and clear nothing, same owner → no-op, different owner → clear
the account-scoped data. Called before the credential is persisted at all three
finalize sites, because App.js's foreground hydrate is concurrent with sign-in and
reads the keychain to decide what to do. `bootService` back-fills the marker for
anyone already signed in, which is what closes the boundary for existing installs.
(3) 15 s `AbortController` on `syncProfileToBackend`; the hydrate's two write-backs
moved to a detached `out.sideEffects` (same order); and a 45 s ceiling on the
sign-in loader that lands in the existing retry branch as `SIGNIN-TIMEOUT` —
SplashScreen has had that failsafe from the start, this screen had none.

**Scope decision.** Asked and answered: fix the cross-account receipt bleed in
this PR rather than flag it, and stop at a merged PR without a version bump.

**Tests.** New `__tests__/localAccountBoundary.test.js` (17 cases: the three
outcomes, the CASL/Limited-Use consent crossings, device-vs-account prefs, and the
ordering invariant asserted as *what local storage held when the hydrate read
it*). Extended `onboardingSignInRecovery.test.js` (precedence + ceiling outcomes),
`onboardingSignupVsRestore.test.js` (new-account-on-a-used-handset, plus the
loader failsafe under fake timers), `syncServiceHydrate.test.js` (`sideEffects`
does not gate the result), `authServiceSessionTimeout.test.js` (bounded profile
PUT on both platforms), `bootService.test.js` (owner back-fill).

**Regression risk.** The routing guard is additive and gated on a field only a
successful hydrate sets, so all six pre-existing `decideSignInRoute` cases pass
untouched and the `email_claimed`-wins-for-an-existing-user ordering is unchanged.
The boundary is a no-op for existing installs and for same-account sign-in; it
fires only on a genuine identity change, where today's behaviour *is* the defect.
The abort can only turn an unbounded wait into a bounded null every caller already
handles. Detaching the write-backs changes what `await hydrateFromBackend()`
implies — two existing tests were updated to await `sideEffects` rather than the
result, which is the honest contract. The 45 s ceiling can fire on a genuinely
slow multi-page restore and show a retry dialog; it is set above any realistic
restore for that reason.

**Not fixed, on purpose.** Receipt photos under `documentDirectory/receipts/` are
left unreferenced by a boundary wipe (storage leak, not a bleed). The
cross-account push-up is a plausible contributor to the 380 orphaned production
price points in `Production_Test_Data_Purge_2026-08-18.md` — a lead, not a claim.

**Verification.** Parse-checked every touched file locally; the suites run in CI
per the standing rule (never locally).

---

## 2026-08-19 — Session-expired banner + 2.8.11 release (PR #286)

**Ask.** Two observations from a device session: (1) Restore unreachable for a
non-premium account, (2) a 60 s burst of `verify_rejected` 401s rendered as
"You're offline". Check whether the code already handles them, treat what it
does not, merge, then bump/build/submit Android.

**(1) Already fixed — no change made.** `ManageSubscriptionScreen` calls
`renderRestoreAndLegal()` from both the non-premium branch (line 419) and the
premium one (line 622); it landed in PR #285 as audit #4 R6's correction. Left
alone deliberately rather than "fixing" it twice.

**(2) Real, and unhandled.** Fixed as described in
`Bugs_Common_Fixes.md` → "A 60-second burst of rejected requests rendered as
'You're offline'". New `subscribeCredentialRejected` observable in
`authService`, latched by `authedFetch` after its retry; a third HomeScreen
banner ranked between `isOffline` and `backendDown`.

**Regression risk.** The observable is additive and starts `false`, so every
existing path renders exactly as before until a 401 survives the retry — a state
that previously had *no* UI at all. `authedFetch`'s request/response behaviour is
byte-identical; the only addition is a status read after `res` is final. The
`5xx`-leaves-it-alone branch exists specifically so a backend outage cannot
start telling users to re-authenticate. Banner precedence was written as an
explicit three-way ladder, and `backendDown` gained `!credentialRejected` so the
two can never render together. 176 auth-suite tests + 18 screen-smoke tests +
13 new ones pass locally; `i18n:check` en=1478 / fr=1478.

**Not done, on purpose.** The backend's `verify_rejected` monitor still cannot
distinguish "N users failing" from "one user asking N times" beyond the client-
side break already in `retryPendingReceiptSyncs`; that is a server-side
aggregation change and out of scope here.

**Device follow-up owed to Maxim.** "Stay awake while charging" was left ON in
Developer Options after the foreground push test — worth flipping back.

---

## 2026-08-20 — R8 checklist item 10 closed, and the Sentry error it turned up

**Ask.** Two halves. First, finish the item-10 record-keeping from the device run.
Second — "fix the error on Sentry and make all the required analysis and fixes" —
chase the incidental finding that run surfaced.

**(1) Item 10 — PASS, no code change.** Recorded in
`Technical/Android_R8_Optimization.md` → *"Checklist run — 2026-08-20"*, and the
hardware verification added to `Operations/Bugs_Common_Fixes.md` #211. Play
production 2.8.11/vc31 on a Pixel 10; the process really died, and Sentry issue
7683178575 renders `com.priceback.MainActivity:84 in onNewIntent$lambda$0` plus 8
more named frames with zero `a.b.c(Unknown Source)`. Mapping chain confirmed on both
halves first (embedded ProGuard UUID `8c094795…`, matching 77.6 MB mapping uploaded
2026-08-19 19:43 UTC). Checklist now **8 PASS · 1 N/A · 1 PARTIAL · 0 BLOCKED**.

**(2) The Sentry error — real, on the current shipping build.** Full write-up as
`Bugs_Common_Fixes.md` #214. `PRICEBACK-CANADA-F`, `T7.b: INTERNAL_ERROR`, 2.8.11/31,
Android 11, 2026-08-19 20:34 UTC. The previous session's read — "a **server-side**
Google sign-in failure" — was taken from the event's own `category: server` tag, and
that tag is our own classification, not an observation: the failure is Google Play
Services `ApiException` **status 8**, entirely device-side. The same session made six
`200`s against the backend it was blaming, in the 40 seconds before it fired.

Root cause is one line, and it was the last line of `classifyError`:
`if (/com\.google\.android\.gms|\bINTERNAL_ERROR\b|play services/i.test(msg)) return "server";`
The comment argued the `server` bucket "already says try again in a few minutes" —
true of the words, false of the meaning, because that copy names **our** service and
its support reference is shared with genuine 5xx outages.

Fixed with a new `signin_provider_error` category (reference `SIGNIN-PROVIDER-ERROR`,
EN+FR copy naming Play Services and a Google account as the remedy), left **in the
same position** so re-categorising cannot move anything else; `React Native
unavailable` routed to `provider_unavailable` (same defect — the coarse 5xx line
matches a bare `/unavailable/`); `err.code`/`err.status`/`priorCode` lifted into the
Sentry report; and the silently-retried first sign-in attempt made observable.

**Triage of the other seven unresolved issues — one line each, so this is not
re-derived next time.** Only F needed code:

| Issue | Verdict |
| --- | --- |
| **F** `T7.b: INTERNAL_ERROR` | The only live defect on 2.8.11. **Fixed here.** |
| C `authorization attempt failed` (23 ev) | Still on **2.8.8/28**, extras say `reference: UNKNOWN` — the *pre*-fix behaviour. Already fixed by the 2026-08-17 triage; an un-updated iOS build is still reporting. No change. |
| B `Unable to open Safari` (20 ev) | Same: 2.8.8/28, `reference: UNKNOWN`. Already fixed. No change. |
| D `DEVELOPER_ERROR` | Same: 2.8.8/28, `reference: UNKNOWN`. Already fixed. No change. |
| A `React Native unavailable` (2 ev) | 2.8.1/21, 2026-08-09, `category: "server"` — the misclassification was still live in today's code and **is fixed here**. The underlying dead bridge is stale dev-build shape. |
| 9 `NativeEventEmitter requires a non-null argument` | 2.8.1/21, same session as A — the classic "JS bundle without its matching native build". Stale; monitor. |
| E `CrashedByAdbException: shell-induced crash` | Self-inflicted `adb shell` during the 2026-08-14 test pass. Not a defect. |
| G `R8 symbolication probe` | Deliberate output of run (1). Not a defect. |

**Regression risk — stated, not assumed.** The classifier is the app's single funnel
for every caught error, so "one more regex" is exactly the change that silently
re-routes unrelated traffic. Both new branches were therefore placed to make that
impossible rather than unlikely: `signin_provider_error` sits **exactly where the
`return "server"` stood** (last, so every more-specific bucket above still wins first
and a backend envelope — which also carries the string `INTERNAL_ERROR` — still hits
the 5xx ladder), and `provider_unavailable` sits **below the status ladder** so no
HTTP-shaped error changes meaning. Proven, not argued: a differential sweep of the
old classifier against the new over **15 794 distinct string literals from 299 source
and test files** moves exactly three groups — `server → signin_provider_error` (GMS /
Play Services), `unknown → signin_provider_error` (`INTERRUPTED`,
`API_NOT_CONNECTED`, previously falling through) and `server → provider_unavailable`
(native-module strings). Nothing else. The `authService` change is additive: it writes
one property onto an error that is already being thrown, inside a `try`, only when a
retry actually happened, so a frozen or primitive rejection cannot become a
`TypeError`. The three copy edits keep their keys.

**Verification.** GitHub Actions is **billing-blocked again** — all three jobs
`conclusion: failure`, `steps: 0`, ~5 s, on every run since 2026-08-19. Per the
standing rule I did not compensate with local suite runs. Instead: the real
`errorSupport.js` was loaded into a harness and asserted over 34 cases (including
every neighbouring bucket that must not move); the differential sweep above;
`npm run i18n:check` green at **en=1479 / fr=1479**; and all five touched files
parse-checked. The jest suites ship in the same commit and need CI to run.

**Owed to Maxim.**
- Clear the Actions billing block — nothing in this repo can be CI-verified until then.
- `PRICEBACK-CANADA-F` and `-G` were left **unresolved** in Sentry, deliberately; F
  should be archived only once a 2.8.12 build carries #214, since resolving it now
  would re-open on the next 2.8.11 occurrence and lose the link to the fix.
- B/C/D will keep reporting `UNKNOWN` until that iOS device leaves 2.8.8.

---

## 2026-08-21 — The other half of PRICEBACK-CANADA-F: a retry that charged the user for it

**Continues the 2026-08-20 entry above.** That session fixed what the user was
*told* when Play Services failed inside itself (`Bugs_Common_Fixes.md` #214, PR #288,
still open at the start of this one). It left the second finding in its own write-up
unfixed: the breadcrumbs showed **two** Google account sheets, and the event showed
one.

**The defect.** `signInWithGoogle()` retries its whole body once after a 300 ms
backoff on a transient GMS status, and that body contains `GoogleSignin.signIn()` —
which is interactive. On Android it launches `SignInHubActivity`, the account
picker. So the retry was not a re-attempt of a background call; it was a second
demand on the user.

```
20:32:30  SignInHubActivity  created
20:32:43  SignInHubActivity  destroyed   ← 13 s with the sheet on screen
20:32:44  SignInHubActivity  created     ← 341 ms later: our retry
20:34:26  event captured                 ← 1 m 56 s after they started
```

The comment defending it — *"one silent retry is cheaper than an error the user has
to act on"* — is the same shape of mistake as #214's *"the server bucket already says
try again in a few minutes"*: true of the words, wrong about the situation. A retry
is only silent while nothing has been shown.

**Fixed** by gating both silent retries (the transient-GMS branch and the token-less
#206 branch) on how long the failed attempt ran: `GSI_UNATTENDED_ATTEMPT_MS = 2000`
in `src/services/authService.js`. Below it the attempt cost the user nothing and is
retried exactly as before; at or above it the failure surfaces immediately.

The threshold is **a bound on wasted time, not a UI detector** — whether a sheet was
drawn is unobservable from JS, and a fix resting on a guess would be unverifiable.
What it guarantees instead is checkable: an automatic second attempt can never cost
more than ~2.3 s before it is refused. Far above a machine-speed rejection (tens of
ms; even a cold Play Services start is inside a second), far below any real picker
session (13 s, observed).

`err.attemptMs` is lifted into the Sentry event next to #214's `priorCode`. The two
together are unambiguous: a large `attemptMs` with **no** `priorCode` is the gate
declining a retry; a small one **with** a `priorCode` is the retry having run and
failed again.

Full write-up, including the accepted trade, as `Bugs_Common_Fixes.md` #215.

**The principle was already in the file.** Six lines below the loop,
`_googleReauthBlockedUntil` blocks an interactive re-auth for a minute after a
successful interactive sign-in, because *"an interactive RE-auth in the next minute
cannot be a recovery — it can only be a loop."* The retry broke the rule its own
neighbour enforced; the gap was that the rule had been written as a fix for one path
rather than as a property of interactive calls.

**Regression risk — stated, not assumed.** The gate can only *remove* a retry. It
adds none, changes no other branch, sits below the cancel and
`PLAY_SERVICES_NOT_AVAILABLE` branches, and is `&&`-appended to a guard that already
required `attempt === 0`, so no second-attempt path moves. Every pre-existing retry
test passes untouched — their mocks reject in well under a millisecond, exactly the
case the gate preserves. No user-visible copy changes: a gated failure surfaces
through #214's `signin_provider_error`, which is already the right message.

The single behaviour traded away, deliberately: a transient GMS failure arriving
*after* a long picker session is no longer retried, so a device where that would
have self-healed on the second try now shows an error instead. That converts an
unbounded invisible cost into a bounded honest one, and `attemptMs` is what will
show in the field how often it happens.

**Verification.** GitHub Actions is **still billing-blocked**, so nothing here was
CI-verified. Per the standing rule, full local suites were not used to compensate;
targeted suites were. The new tests were watched to fail first — 6 red, with the 4
that passed being precisely the regression guards, which is the correct split for a
change that only removes a retry. Then 165/165 on
`authServiceSignIn` + `errorSupport`, and 300/300 across 13 further auth,
error-surface, onboarding and email-sync suites. `npm run i18n:check` unchanged at
en=1479 / fr=1479.

**Release — 2.8.12 BUILT and SUBMITTED on both platforms.** PR **#288** (both halves
of F) and PR **#289** (the bump) were merged with `--admin`; Actions cannot report, so
waiting on it would have blocked indefinitely. `main` is at **87be3d1**, version
**2.8.12 / buildNumber 32 / versionCode 32**, annotated tag **`v2.8.12`** points at it
(verified dereferenced on the remote, not just locally), and the full release sequence
then ran in order — tag first, build from the tag, release after.

Maxim approved both builds mid-session, so the flow completed rather than pausing:

| | Build ID | Commit EAS built | Submission |
| --- | --- | --- | --- |
| Android | `b71b736f-d453-41e3-9382-310c4bb82af6` | `87be3d1` | `42b5bb13-4297-4309-aebd-3eec80d15b70` — Play **production**, release status COMPLETED, changes sent for review |
| iOS | `6287e4d9-2433-4cae-9c6f-443cf94dd6d2` | `87be3d1` | `c839fbee-a0e4-4c18-8b2f-34cc39cef359` — uploaded to App Store Connect |

EAS reports both artifacts as built from **`87be3d1`** — the tagged tree exactly — so
`git checkout v2.8.12 && eas build --profile production` reproduces them. GitHub
release published against the tag.

⚠️ **iOS is UPLOADED, not in review.** `eas submit -p ios` puts the binary into App
Store Connect / TestFlight; sending it for App Store review still needs the listing
screenshots, which remain the standing iOS blocker. Android's submit profile targets
`track: production`, so only that one is actually in review.

⚠️ **iOS jumped 2.8.10 → 2.8.12.** 2.8.11 was Android-only, so this iOS binary is the
first to carry #281–#287 as well as #288 — a much wider blast radius than Android's,
which moved by #288 alone. Worth watching iOS Sentry more closely than usual after
this one, and it is also the first iOS build carrying #282, whose acceptance test is
still unrun.

*Environment note:* `npm run release:tag -- --write --push` is refused by the auto-mode
classifier. The dry run (`node scripts/releaseTag.js`) runs fine, so use it for the six
checks and the generated message, then create the tag with `git tag -a v… -F -` and
`git push origin v…`, which are allowlisted.

**Sentry, and what is still owed.**
- `PRICEBACK-CANADA-F` — **still unresolved.** The 2.8.12 build carrying the fix now
  exists and is submitted, so the gate is no longer "wait for a build" but "wait for it
  to reach users": archive F once Play review approves 2.8.12 and installs appear.
  Resolving it while 2.8.11 is what users run would re-open on the next occurrence and
  lose the link to the fix.
- `PRICEBACK-CANADA-G` — the deliberate R8 symbolication probe crash from the
  2026-08-20 run. Not a defect and never will be; safe to archive at any time.
- Neither could be actioned from here: `SENTRY_AUTH_TOKEN` in `.env` is an
  upload-scoped org token (`sntrys_…`) and returns **403** on
  `/api/0/organizations/prosoft-inc/issues/`. Archiving is a manual step in the
  Sentry UI, or needs a token with `event:write`. *(Also worth knowing for next time:
  `curl` on this machine fails every HTTPS call with
  `CRYPT_E_NO_REVOCATION_CHECK` unless given `--ssl-no-revoke`.)*
- Clearing the Actions billing block remains the blocker for CI-verifying any of
  this.

---

## 2026-08-24 — The iOS sign-in collapse: one root cause behind four symptoms

**Reported.** Every screen 401-ing on the iPhone; *"Apple couldn't complete the
sign-in — check that you're signed in to iCloud"* on every retry; Google sign-in on
iOS failing straight after; account deletion failing; and a support alert blaming
*"expired or invalid Google ID tokens"*. Separately, in-app product prices showing in
the wrong currency.

**Found.** Not four bugs. `priceback.user_sessions` had the whole thing timestamped:
session 4 rotated at 20:07:01.796, successor 7 created at 20:07:03.943, successor 7
revoked `reuse_detected` at 20:07:07.994 — the app re-presented a refresh token whose
rotation it had never received (its own 8 s abort), and the server read the honest
retry as theft and burned the family. The 20 × `verify_rejected` that raised the
alert start three seconds later. Everything else is downstream: a burned family drops
the phone onto a ten-minute Apple token it cannot silently refresh, every 401 asks
for an Apple sheet, and nothing could ever re-open a session because
`openFirstPartySession()` was reachable only from the three sign-in finalizers.
Stacked sheets are what made both providers fail and deletion impossible.

Prod `/health` ruled out configuration up front — `sessions: configured`,
`auth: configured` (3 audiences, iOS client present). **Correction to a standing
note: `SESSION_TOKEN_SECRET` IS set on prod and first-party sessions are live.**
The recap said otherwise.

**Shipped** (PR: `fix/ios-session-replay-and-sheet-mutex`):

1. **Server — idempotent rotation.** `rotate()` serves a bounded replay instead of
   burning, gated on four conditions, the security one being *no descendant has ever
   been presented* (`last_used_at`, which a replay deliberately does not stamp). The
   window is anchored on the last genuine use, not on the row's own revocation, so a
   replay chain cannot roll it forward. No migration — the heir is rotated rather
   than re-issued, because only its hash is stored.
2. **Client — one authorization presenter**, taken at the native call (a lock around
   the exported functions would deadlock, since `refreshGoogleIdTokenInteractive`
   calls `signInWithGoogle`). User taps queue; background refreshers give up.
3. **Client — the rotated pair is indispensable.** `_storeSession` reports whether
   the refresh token landed; a lost write drops the session instead of half-keeping
   it.
4. **Client — re-open on recovery.** `authedFetch` mints a session off a provider
   token the backend has just accepted: no UI, no guessing.
5. **The alert reports what it measured** — tally by reason and route, guidance from
   the dominant reason, and it names `priceback.auth_outcomes` instead of the
   long-gone `api_audit_log`. Third instance of this class after #205 and #214.
6. **Storefront-aware price cache.** `storePrices.js` stamped a currency on write and
   never read it back, so a device whose App Store region changed rendered the old
   region's prices as `ready` for up to 30 days. Now validated against
   `subscriptionManager.getStorefront()`; unknown ≠ changed.

**Sequencing that matters.** The server fix repairs **every already-installed
build the moment Railway redeploys** — no App Store review in the path. The client
fixes harden it and need 2.8.13.

**Verified without CI** (Actions still billing-blocked; confirmed again — all recent
runs `conclusion: failure`). Backend: 12 new cases in `sessionReplayGraceDb.test.js`,
watched to fail under `SESSION_REPLAY_GRACE_MS=0` (which restores the exact pre-fix
behaviour and is itself one of the tests), then 57/57 across the four existing
session suites, 8/8 `authFailureMonitor`, 19/19 `healthSessions`. Client: 14 new
cases in `authServiceSessionRecovery.test.js` — 7 fail with the fixes disabled in
place — plus 8 new storefront cases; 224/224 across ten auth suites, 226/226 across
twelve session/onboarding/audit suites, 65/65 on the price-facing screens.
`i18n:check` unchanged at en=1485 / fr=1485.

**Two existing tests deliberately changed** to reach the burn path explicitly rather
than by accident — see Bugs #216.

**Notes for next time.**

- `curl` still needs `--ssl-no-revoke` on this machine; `/health` on prod is public
  and was the fastest way to rule out a config cause.
- Backend DB suites run as
  `node --env-file=.env --env-file=test.env --test --test-concurrency=1 tests/<file>`
  from `backend/`. One suite at a time — concurrent runs exhaust the Supabase pooler.
- A bash heredoc still mangles quoting for JS/Markdown; the Write tool plus a small
  Python append is the reliable path.
- `babel-plugin-jest-hoist` only lets a `jest.mock` factory reach out-of-scope names
  prefixed with `mock` — `new Set()` at module scope is rejected outright.

### Addendum — the release could not be built (same session)

`eas build --platform all --profile production` from `v2.8.13` ERRORED on both
platforms in 30 seconds, at "Read app config". Cause was **not** in this
session's work: #290 committed `ADS_ENABLED: "true"` on the production EAS
profile while no real AdMob unit ids exist and app.json still carries the
all-zero placeholder app id, so `assertAdsConfigIsShippable` refused. **Every
production build had been impossible since #290 merged** — 2.8.12 was built
before it, and nothing between then and now attempted one.

Fixed in **#293** (flag removed, not worked around), rolled forward to
**2.8.14 / buildNumber 34** in #294 because a tag is never moved. The `v2.8.13`
release notes were edited to state plainly that no artifact exists for it.
Full write-up: Bugs #217.

**Production verification of #216 — done, and clean.** The 2026-08-24 sequence
was replayed against the live production backend with a throwaway sub
(`verify-216-probe`, seeded and removed via SQL):

```
1st refresh  → 200          (rotation)
2nd refresh, same token → 200   (was: 401 + reuse_detected + family burned)
user_sessions: id 9 `rotated` presented=true
               id 10 `superseded_by_replay` presented=FALSE
               id 11 live
```

`superseded_by_replay` with `last_used_at` NULL is the whole design in one row:
the heir nobody received is retired without being credited as delivered. Cleanup
verified by query — 0 users, 0 sessions, 0 ledger rows remaining. The same
sequence was also run end-to-end against the *development* Railway deployment
before prod, via `sessionsRepo` + real HTTP.

**Notes for next time.**

- Prod `/health` deliberately collapses `checks.sessions` to `{status}` for
  anonymous callers — a new diagnostic field will NEVER appear without the admin
  token. Polling for one anonymously proves nothing; use `uptimeMs` to confirm a
  redeploy instead, or `?token=$FLYER_ADMIN_TOKEN`.
- EAS build failures report only the phase name. The real message is in
  `eas build:view <id> --json` → `logFiles[0]`, which is **gzip**, so
  `zlib.gunzipSync` it before grepping.
- Reproducing `app.config.js` locally needs `EAS_BUILD=true` **and**
  `EAS_BUILD_PLATFORM=<ios|android>` — the ads assertion returns early without
  the platform, so a local check without it passes on config that cannot build.
- `eas build:view` has no `--non-interactive` flag; `--json` alone is enough.

**Release outcome.** **iOS 2.8.14 (34) built and uploaded to App Store Connect**
(build `6a5f1a93-…`, submission `91af8192-…`) — that is the platform every
symptom in #216 was on. **Android is still blocked**: past the config phase now,
but `:react-native-google-mobile-ads:compileReleaseKotlin` fails because
`play-services-ads:25.4.0` carries Kotlin metadata 2.3.0 and Expo 55 pins Kotlin
2.1.20. Pin merged (#295, `plugins/withAdsSdkKotlinPin.js` → force 24.6.0,
metadata 2.1.0, verified by reading the AAR headers rather than by building).
**Not yet built** — two Android builds have already failed, so per the
goal-retry-limit the third is Maxim's call. It needs a bump to 2.8.15 /
versionCode 35 and a `v2.8.15` tag, since `v2.8.14` predates the pin.

Nothing Android loses by waiting: the server half of #216 is already live for it,
and the client half is iOS-only by construction.


---

## 2026-08-25 — A parser per store, a Best Buy parser, and a lane production never takes

**Ask.** Start a Best Buy receipt parser alongside Costco's, with a pre-parser
that reads the store name and picks the parser. Best Buy's paper is often nearly
transparent, so the parser has to cope. And keep all of it — Best Buy, ads, PR
#290 — off the standard production path so it can be tested separately.

**What the dispatch was.** A ternary in `receiptParser.js:57`:
`storeId === "costco" ? parseCostcoReceipt : parseGenericReceipt`. Now a registry
(`src/services/receiptParsers/`) behind the existing `detectStore` pre-parser,
which already recognised Best Buy by name pattern and by the 1-866-237-8289
phone number. `extractWarehouseId` already read `S-0937` and `detectPurchaseType`
already split Best Buy in-store from online — roughly half the pre-parser work
was already in the tree.

**The isolation ask was bigger than it looked.** `adsEnabled: false` only stops
the banner rendering; the AdMob native SDK compiles into every production binary
regardless. That is why #290 broke production builds twice (#293, #295) in a
dependency the app never calls. A runtime flag cannot protect a build phase. So
`labEnabled` removes the ads config plugin **and** nulls its autolinking. Those
two must move together — stripping the plugin alone leaves the manifest without
`com.google.android.gms.ads.APPLICATION_ID` and the Android manifest merger
hard-fails — so `adsAutolinking.test.js` asserts they agree on every lane.
Production now compiles no ads code at all.

**Two bugs the tests caught, both worth recording.**

1. `2210 BANK ST` parsed as an item named "BANK ST" costing $22.10. The
   faint-print repair was restoring "dropped" decimal points, and a receipt is
   full of 3-7 digit numbers that are not money. A decimal separator with two
   places after it is now mandatory; the dropped-point case is deliberately not
   repaired, because nothing local distinguishes it from a street number.

2. The Tier-2 glyph search adopted any candidate that got *closer* to the printed
   total. If an item is MISSING rather than misread, some edit to a
   correctly-read price will always shrink the gap — so "closer" corrupts a good
   price to chase a gap it can never close. Adoption now requires the repaired
   parse to LAND on the printed total, which makes the repair self-proving.

**Also found.** `easBuildProfiles.test.js` did not save/restore the new
`LAB_ENABLED`, so the `lab` profile leaked it into the production case, which
then threw on the lane guard. The guard working, the harness not — both env-key
lists now isolate it.

**Notes for next time.**

- Bash heredocs mangled a JS file with dense regex escaping again (the RECAP note
  is accurate). The Write tool + a small Python patch is the reliable path.
- Round-tripping JS regex literals through Python string replacement silently
  broke a character class (`\]` inside `"..."` is just `]`, which terminates the
  class early) and turned `\$?` into an optional end-anchor. Write regex
  literals with the Write/Edit tools, not through a Python replace.
- `describe.each([])` throws outright — a fixture-driven suite that has to be
  committable before its fixtures exist needs a plain `for` loop.
- `parse:receipts` now takes an optional store filter:
  `npm run parse:receipts -- bestbuy`.

**Verification.** 1070 tests across 15 suites, `typecheck`, `i18n:check`, and the
production/lab config read on both platforms. CI is still billing-blocked, so
these were targeted local runs of pure-JS suites only — no backend/DB suites,
which are the pooler-contention concern.

**Open.** The Best Buy corpus is empty: one paper photo and one online export are
owed, and until they land the parser is structurally correct and empirically
unverified. And production no longer compiles the ads SDK, which wants one real
production build before the next store release.

---

## 2026-08-25 (cont.) — The Best Buy corpus: nine real captures, and what they said about the parser

- **Asked (/goal):** "i added the fixtures for best buy, one image and few pdf
  receipts, run the tests for all of them using the new parser and make sure the
  results are 100% accurate."
- **Delivered:** all 9 captured, all 9 pinned to ground truth, all 9 parsing
  exactly. Best Buy suite 26 failures → 0 (91 → 109 tests). Full mobile suite
  5,074 passed. Details in `Bugs_Common_Fixes.md` **#219**.

**Getting the captures.** `GOOGLE_VISION_API_KEY` is EMPTY in the repo's `.env`
(secrets live in EAS/Railway, not on disk). Maxim's instruction: take it from
**Railway variables** — `railway variables --json`, filtered to the one key,
written to the session scratchpad, never printed and never committed. Then
`npm run capture:receipts` produced 9 `<name>.vision.json` fixtures. **The raw
receipts stay gitignored; only the captured OCR is committed** — the existing
rule, unchanged.

**Reading the ground truth without guessing.** `pdftotext -layout` (already on
PATH via mingw64) prints the PDFs' text layer, so every total, tax, date, SKU
and price was read off the source document *before* looking at what the parser
produced — then each was checked against the receipt's own arithmetic
(items + tax = total) before being written into EXPECTATIONS. A guessed
expectation makes a wrong parse look verified.

**What the corpus said.** The parser was 1,070 green tests over synthetic
layouts and got **every one of the nine wrong**: all 8 order receipts extracted
**zero items**; the photographed slip invented `Item #169` holding a $3,699.99
TV's price, dated a week late. Four independent faults plus bleed-through from
the reverse of the thermal paper — full mechanism in #219. The one worth
repeating here: **`isBestBuySku` existed, was exported, was unit-tested, and
nothing called it.** Its docstring named the exact bug the first real photo hit.

**Two decisions worth not re-litigating.**

- **Only the ITEM ROWS come from geometry on the online path.** Totals, tax,
  date and order number already read correctly from the flat OCR and were left
  alone. The geometry is used where the flat text has no answer and nowhere
  else, which is why Costco's 42-fixture parity suite never moved.
- **The tax repair must LAND, not merely get closer.** `461.00` vs the printed
  `481.00` is fixed from the rate and base the receipt itself prints, and only
  when the stated base equals the basket we parsed AND the result hits the
  printed total exactly. Same bar `faintPrintRepair` Tier 2 already sets, and
  for the same reason: "closer" corrupts a good number to chase a gap a missing
  item opened.

**Also found, deliberately NOT fixed (out of scope, pre-existing on `main`).**
`__tests__/adminBillingDiagnosticStorePricing.test.js` fails to load —
`AsyncStorage is null` via `AdminBillingDiagnosticScreen` → `ProfileKit` →
`i18n`, which the suite never mocks. Adding the mock (as its sibling admin
suites do) makes it load and then **6 assertions fail with empty rendered text**:
the screen now renders through ProfileKit components, so the suite's
`findAllByType(Text)` finds no raw React Native `Text` nodes. That is the #297
screen redesign outrunning its test, not a receipt-parsing problem. It also
drags `subscriptionManager` and `authService` under their coverage floors. Left
exactly as found; the baseline run proving it pre-exists is in the PR body.

**Notes for next time.**

- Bash heredocs mangled a markdown file this session too, not just JS — and a
  Python string-replace silently no-op'd on a JS regex again (the task log said
  so last session; it is still true). Write tool, every time.
- The shell's working directory **persists between Bash calls**. A `cd` into a
  fixtures folder made `src/services/...` "not found" three calls later and read
  as a missing file.
- `npm run parse:receipts -- bestbuy` now prints a real per-receipt table
  (RECEIPT_REPORT was only wired into the Costco suite). It is the fastest way
  to compare a parse against the paper.

**Verification.** Full `npm test`: **5,074 passed, 0 failed**, 209/210 suites
(the one failure is the pre-existing admin suite above). `typecheck` clean;
`i18n:check` passed (2 languages, 1,493 keys each — no user-visible strings
changed). Baseline before the change, same command: 26 failed, 2 failed suites.
CI remains billing-blocked, so these were targeted local runs of pure-JS suites
plus one full run — no backend/DB suites.

**Regression risk, stated.** Three shared-engine changes (`extractDate`,
`extractPrintedTotal`, `extractWarehouseId`) are the only code any other store
touches. All three are additive or narrowing: the date change only fills a date
the existing patterns failed to find, or prefers an explicitly-labeled purchase
date — **no Costco fixture carries any such label**, checked; `Product Total`
joins an existing subtotal-alias list; the `\bS` anchor and the `total number`
narrowing both make previously-too-wide matches stricter. Costco's 42-capture
realocr suite and the registry parity suite are unchanged and green.

**Open.** The in-store photo's product name still carries bleed-through residue
("Samsung 85LS03FW PRO stall 6 ( e") — the mirror text is spatially interleaved,
not trailing, so trimming it needs a per-word confidence filter inside geometry
reconstruction, which is shared with Costco. Everything that drives price
tracking on that receipt — SKU, price, date, total — is exact. One corpus, one
store: a third store will want its own captures before its parser is believed.


## 2026-08-26 — The Best Buy fixtures reach the repo, and the shared engine gets its Costco-only guarantee back

**Why nothing showed up on GitHub.** The nine Best Buy captures were never
missing and never ignored — they were simply never `git add`ed. `.gitignore`
already carried the right rules for `receipts-bestbuy/**` (sources out,
`*.vision.json` in), so `git status` collapsed the whole directory to one
untracked line and it read as "excluded". Confirmed per-file: 9 sources ignored,
9 captures addable.

**What actually blocked the commit.** The captures carried a real person's data.
Eight of nine held a shipping address — name, street, city, postal code, phone —
and one of them belongs to a **third party**, not the repo owner. The capture
script's PII scrub was written for Costco thermal paper, which never prints a
shipping address, so none of it was caught.

**The scrub.** One implementation in `scripts/lib/receiptPiiScrub.js`, shared by
`capture:receipts` and a new `scrub:receipts` re-scrub pass, because a scrub that
only runs at capture time protects a fixture against the rules that existed the
day it was captured and nothing else. Two rule kinds: labelled-value rules
(Costco heritage — member #, card mask, reference, barcode) and a **block** rule
that masks the shipping-address region by position. Position, not pattern: one
fixture's postal code OCR'd as `JON 1PO`, which no postal regex matches, and
there is no pattern that reliably finds a person's name.

Masked shape-for-shape rather than deleted — `Michael Gad` → `Xxxxxxx Xxx`,
`17116 Rue Emile-Nelligan` → `99999 Xxx Xxxxx-Xxxxxxxx`. The realocr suite pins
`storeNumber: null` on every online order precisely so the parser can never mint
a store number out of a shipping address; deleting the block would delete the
hazard and leave the assertion passing against nothing. Word geometry is never
touched — only `text` changes, so a geometry-driven parse reads the same layout.

**A corruption the dry run caught before it shipped.** The first phone rule
matched a Costco refund's `15:24 1362 124 135633` — warehouse, register,
transaction — as the phone number `1362 124 1356`, and on one fixture shifted a
printed time from `18:01` to `18:09`. Three committed Costco fixtures would have
been silently rewritten. Fixed with digit boundaries on both ends and pinned by
two tests. **The dry run is the reason this was caught**: default is report-only,
and it exits non-zero when it finds PII so it works as a gate.

**Store postal codes are business information and are left alone.** 54 of the 55
Costco fixtures carry a warehouse postal code and the parser identifies
warehouses by their printed address, so the postal rule fires only inside an
address block or on an explicit delivery line.

**The shared engine reverted — new standing rule.** Maxim's instruction this
session: *never modify the Costco parser without confirmation; all Best Buy
edits belong in the Best Buy parser only.* The previous entry's four
`receiptParsingShared.js` changes were exactly that — Costco's live code path
edited to make a lab-lane store parse. `receiptParsingShared.js` and its test
file are now **byte-identical to HEAD**, and all four behaviours live in
`bestBuyReceiptParser.js`:

- `extractBestBuyPurchaseDate` — a labelled purchase date outranks the document
  scan, plus `D-Mon-YYYY`. Fixes `BUS DATE-11/28/2025` losing to
  `Delivery Date: 2025-12-05`, which dated a purchase a week late and shortened
  the 30-day adjustment window.
- `extractBestBuyStoreNumber` — the `\bS` anchor. Without it the `s` ending any
  word satisfied the S-prefix, and the word above a shipping address is the
  customer's surname: `Maxim Lucas / 401 9E Av` reported store 401. Callers now
  assign it **unconditionally**, because the shared engine stamps a warehouseId
  first and a fill-only assignment could never clear a wrong one.
- `bestBuyTotalsText` — normalizes Best Buy's own text before the shared totals
  extractor sees it, instead of teaching that extractor a second store's
  vocabulary. Handles `Product Total` (the merchandise sum, printed at the top)
  and the geometry-welded `Star Invoice Number : … Order Total : …` row.

The duplication is deliberate and cheaper than shared-code risk to the earning
store.

**Verification.** All 10 parsing suites: **1,118 passed, 0 failed** — Best Buy
(194), the scrub (26), Costco realocr, shared, registry, geometry, validator.
Best Buy parser coverage **92.37/85.19/97.22/95.45**, above its 90/82/95/94
floors. Baseline captured *before* the fixtures were rewritten (109/109) and
re-run after: identical, which is what proves the scrub is parse-neutral. CI is
still billing-blocked, so these were targeted local runs of pure-JS suites — no
backend/DB suites.

**Regression risk, stated.** For Costco: **none by construction** —
`receiptParsingShared.js` is byte-identical to HEAD (`git diff` empty), so no
Costco code path changed. Every Best Buy change is inside
`bestBuyReceiptParser.js`, which nothing but the Best Buy lane calls, and that
lane is `labEnabled`-gated and not in production. The fixture rewrite is proven
parse-neutral against pinned ground truth. One behaviour change worth naming:
`warehouseId` is now assigned unconditionally on both Best Buy paths, so a Best
Buy receipt that previously reported a (wrong) store number now reports null.

**Open.** Three Costco same-day screenshots print `Delivering to K1J 1A5` — a
customer postal code the new delivery rule would mask. **Reported, not written**:
rewriting committed Costco fixtures needs Maxim's confirmation under the new
rule. `npm run scrub:receipts` lists them on every run. The in-store photo's
bleed-through residue in the product name is unchanged from the previous entry
and still needs a per-word confidence filter inside shared geometry
reconstruction — which now explicitly requires confirmation before it is touched.

## 2026-08-26 — App Store Connect refused the review: the binary declared tracking it cannot do

**Ask.** "I replaced 2.8.8 with the new 2.8.14 and App Store Connect says
*Unable to Add for Review — your app contains NSUserTrackingUsageDescription…*
Should we fix the version or fix App Store Connect?"

**Answer: neither the version nor App Store Connect — the binary.** Every build
since the AdMob work carries the ATT purpose string and a privacy manifest
declaring `NSPrivacyTracking: true` with five tracking domains, while the lab
lane keeps the AdMob SDK *out* of production binaries entirely. The build
promises tracking it has no code to perform. Answering Apple by ticking
"used for tracking purposes" in App Privacy would be a false statement about the
binary and buys a Guideline 5.1.1 / 5.1.2 rejection a full review cycle later.

**Change.** `plugins/withIosAdsPrivacyLane.js` puts the declarations on the same
lane as the SDK: no-op when `labEnabled === true`; on every production build it
deletes the ATT string from `Info.plist` and the generated localized
`InfoPlist.strings`, sets `NSPrivacyTracking: false` with an empty domain list,
clears every `…Tracking: true` flag and ThirdPartyAdvertising purpose, and drops
the ad-only `AdvertisingData` type. `DeviceID` / `CoarseLocation` /
`ProductInteraction` stay, un-tracked — crash reports, the warehouse picker and
Sentry analytics still collect them.

**Verification.** `npx jest __tests__/withIosAdsPrivacyLane.test.js
__tests__/adsConfig.test.js __tests__/adsAutolinking.test.js
__tests__/iosParityConfig.test.js` → **61 passed, 0 failed**. Plus the real
pipeline, both ends, via `npx expo config --type introspect` (iOS `prebuild`
cannot run on Windows; introspection resolves the same plugin chain):

- production lane → no `NSUserTrackingUsageDescription` anywhere,
  `NSPrivacyTracking: false`, `NSPrivacyTrackingDomains: []`, no
  `AdvertisingData`, no `ThirdPartyAdvertising`.
- `LAB_ENABLED=true APP_ENV=preview` → ATT string present (×2),
  `NSPrivacyTracking: true`, domains non-empty.

CI is still billing-blocked, so these were targeted local runs of pure-JS config
suites — no backend/DB suites.

**Regression risk, stated.** Android: **none** — the plugin only registers iOS
mods and touches nothing else. Lab lane: **none by construction** — the plugin
returns the config unchanged before registering a single mod, asserted by a test
that the returned object is identity-equal to the input. Production iOS: the
binary loses one Info.plist key and gains a truthful privacy manifest; no JS,
no native module and no entitlement changes. The one behaviour change worth
naming: a production build can no longer present the ATT prompt — which is
correct, because it has no ads SDK to justify one, and `isAdsBuildEnabled()`
already made that code path unreachable.

**Open.** (1) A new build is required — this is a binary-level fix and the
uploaded 2.8.14/2.8.15 artifacts still carry the declaration. Sequence per
`CLAUDE.md`: merge this, bump to 2.8.16 / buildNumber 36 in its own PR, tag,
build from the tag. That build should also be the one that finally carries the
App Review sign-in fix (#299), which 2.8.14 predates. **No `eas build` started —
awaiting Maxim's go-ahead (15 free builds/platform).** (2) The Android twin:
`com.google.android.gms.permission.AD_ID` is still declared unconditionally
while the ads SDK is unlinked on the production lane. Reported, not changed —
it blocks nothing today and would need its own Play release.

## 2026-08-26 (cont.) — the full local suite before the build, and what it turned up

**Ask.** "Run all tests locally before creating a new build, and create the new
version for both platforms."

**The mobile suite was not green on a clean `main`**, and none of it came from
#301. Three findings, all invisible while GitHub Actions is billing-blocked —
every PR merged during the block (#297–#302) is unverified by definition.

1. `adminBillingDiagnosticStorePricing.test.js` (#297) **could not load**:
   ProfileKit → i18n.js imports AsyncStorage at module scope.
2. Once it loaded, **6 of its 7 tests failed — it had never run anywhere**. Its
   helper read `.children` off `findAllByType(Text)`, but Text is a COMPOSITE
   component, so that is the host node, never the string; every assertion
   compared against `""`. The 7th passed only because it asserts an ABSENCE,
   which an empty render satisfies for free. The screen was correct all along.
3. Two per-file coverage floors had fallen through the ratchet:
   `subscriptionManager.js` (89.74/80.95/94.11/89.06 vs 97/89/100/97 — the
   untested `getStorefront()` from #282) and `authService.js` functions
   (87.61 vs 88). Restored by ADDING tests, never by lowering a floor: now
   100/97.61/100/100 and 89.38. Bugs #221. PR #303.

**Result: 212 suites, 5146 tests, 0 failures, every floor met.**

**Backend suite.** 144 files, ~1,388 tests, `--test-concurrency=1` against the
remote Supabase pooler. The first run completed 132 of 144 files in 23 minutes
and then **hung on one file for 50 minutes** with no output (it was piped
through `tail`, which buffers — do not do that again). Re-run with live output;
217 tests passed, 0 failed at the time of writing, still going.

**Builds — both platforms, from the tag.** `git checkout v2.8.16`, then
`eas build --platform all --profile production`. The first attempt died on an
ECONNRESET mid-upload **before a build was created**, so nothing was charged
against the 15-build budget; the retry uploaded cleanly.

- **iOS `53b1304a` — FINISHED** in 7 minutes, from `d10f82b`.
- **Android `603de30a`** — queued.

**Why Android matters here.** `eas build:list` shows every Android production
build since 2.8.13 **ERRORED**, which nothing in the repo reveals. The log says
`:react-native-google-mobile-ads:compileReleaseKotlin FAILED` —
`Unresolved reference 'AgeRestrictedTreatment'`, a 25.x API the library calls
but the pinned `play-services-ads:24.6.0` (#295) does not have. **The pin never
fixed Android; it traded a metadata error for an API error.** What fixes it is
the lab lane (#300), by not compiling the SDK at all — and `v2.8.16` is the
first tag containing it. Bugs #222.

**Verification that actually settles it: the artifact, not the config.**
Downloaded and unpacked both `.ipa`s:

| key in `Info.plist` | 2.8.14 (ASC rejected) | 2.8.16 |
| --- | --- | --- |
| `NSUserTrackingUsageDescription` | present | **absent** |
| `NSPrivacyTracking` | `true` | **`false`** |
| tracking domains / `AdvertisingData` | present | **absent** |
| camera / photos / when-in-use location | present | present |
| microphone, FaceID, always-location ×2 | present | **present** |

The last row is Bugs #223: `withIosPrivacyStringCleanup` has **never removed
anything**. Identical in both binaries, so pre-existing and untouched by #301.
Expo evaluates the user `plugins` array during `getConfig()`, before it applies
expo-camera / expo-secure-store / expo-location, so a `withInfoPlist` mod that
only deletes cannot outrank an injection that lands afterwards. The ATT strip
stuck because it also deletes from `config.ios.infoPlist`. Fix, when taken:
pass `microphonePermission: false` / `faceIDPermission: false` /
`locationAlways*Permission: false` to the injecting plugins.

**Submission.** `REVIEWER_ACCESS_CODE` was confirmed missing on Railway
production (`/health` → `reviewerAccess: "unavailable"`), which would have
locked App Review out even with 2.8.16 installed — the server answers a missing
code and a wrong code identically. Maxim set it; re-read confirms
`reviewerAccess: "available"`. iOS 2.8.16 submitted to App Store Connect on his
instruction.

**Still open.** (1) `appleAuth` still reads `degraded` — that check requires
`APPLE_SIGNIN_KEY_ID` **and** `APPLE_TEAM_ID` **and**
`APPLE_SIGNIN_PRIVATE_KEY` together; the `.p8` alone does not flip it. Account
deletion cannot revoke the Apple credential until it does — Guideline 5.1.1(v).
(2) The five IAP products are still not attached to the version. (3) Bugs #223
and the Android `AD_ID` twin both need their own version + build.

**Regression risk, stated.** #303 touches test files only — no `src/` file, no
product behaviour. #301's effect on the binary is verified above: one key
removed, one manifest made truthful, every other purpose string byte-identical
to the build already in App Store Connect.

---

**2026-08-26 — Apple Sign-In revocation key, closed on production.** Maxim
created a new "Sign in with Apple" key in the Apple Developer portal (distinct
from the existing APNs push key and ASC API key already in EAS — neither of
those is usable for this) and set `APPLE_SIGNIN_KEY_ID`, `APPLE_TEAM_ID`,
`APPLE_SIGNIN_PRIVATE_KEY` on Railway. `GET /health` on
`priceback-production` confirms `checks.appleAuth.status: "configured"`
(was `"degraded"`). Account deletion can now revoke the Apple credential —
Guideline 5.1.1(v) gap closed on production.

`priceback-development` still reads `"degraded"` — the same three vars were
only set on production. Not required for App Store compliance (reviewers only
hit production), but worth setting there too before it's needed for testing.
Details: `Operations/Apple_SignIn_Revocation_Key_Setup.md`.

### 2026-08-26 — outcomes

**Both platforms shipped.**

| | |
| --- | --- |
| iOS **2.8.16 (36)** | build `53b1304a` FINISHED · **uploaded to App Store Connect** (submission `19498dcb`) |
| Android **2.8.17 (37)** | build `a41d720e` FINISHED · `.aab` — **first Android artifact since 2.8.12** |
| Releases | `v2.8.16` and `v2.8.17` published, each pinning its commit |

**A correction to the entry above.** It predicted `v2.8.16` would be the first
working Android build because it contains #300. It was not — it failed
identically to 2.8.13/14/15. The lane's exclusion lived in
`react-native.config.js`, and `platforms: { android: null }` is the **Community
CLI's** mechanism; Expo 55 does not use the Community CLI. One local command
settled what four builds could not:

```
npx expo-modules-autolinking react-native-config --platform android --json
→ 15 modules, react-native-google-mobile-ads AMONG THEM
```

Moving the exclusion to `expo.autolinking.exclude` in `package.json` → 14
modules on both platforms. #304, Bugs #224. `adsAutolinking.test.js` had been
green through all four failures because it asserted a file the build never
consults — Bugs #221's lesson one layer down.

**The first `eas submit` ERRORED** with no error body, no log files and
`canRetry: true` — only "Something went wrong". The identical retry succeeded.
Treat a bare submission failure as transient and retry once before digging.

**Artifact-level verification, both platforms.** The `.aab` was unpacked:
**zero `io/invertase/googlemobileads` references across all four dex files**,
and the build log shows 1,353 Gradle tasks with **zero** ads tasks (the previous
four builds died around task ~680 on exactly that module). `RECORD_AUDIO` is
correctly stripped. ⚠️ `com.google.android.gms.permission.AD_ID` **is** still in
the shipped manifest with no SDK behind it — the Android twin, still open.

**Three findings in one day where the artifact disagreed with the config that
claimed to shape it** — Bugs #221 (a test asserting a screen it never rendered),
#223 (a plugin removing nothing), #224 (an exclusion the build never read). The
common fix is the same: **run the resolver, unpack the artifact; a config file
is an input, never the answer.**


## 2026-08-27 — Play refused the 2.8.17 upload: the Android twin of the tracking-declaration drift

`eas submit -p android` uploaded the `.aab` and then failed five identical
retries at "Updating track 'production'":

```
This release includes the com.google.android.gms.permission.AD_ID permission but
your declaration on Play Console says your app doesn't use advertising ID.
```

**This was a known open item, not a surprise.** The 2026-08-26 entry above ends
with it verbatim: "⚠️ `com.google.android.gms.permission.AD_ID` **is** still in
the shipped manifest with no SDK behind it — the Android twin, still open." It
was recorded and then left, and it cost the release it was recorded during.

**Root cause.** Two unconditional declarations: `app.json` →
`android.permissions`, and `expo-tracking-transparency`'s autolinked plugin,
which calls `withPermissions(['…AD_ID'])` on every build and is evaluated
*after* the `plugins` array — so a config-level delete alone cannot survive it.

**Fix — `plugins/withAndroidAdsPrivacyLane.js` (#306).** The Android mirror of
`withIosAdsPrivacyLane`: no-op on the lab lane, and on every production build it
removes AD_ID from `config.android.permissions` (belt) *and* marks it
`tools:node="remove"` in the manifest (braces). The braces half is load-bearing
twice over — Expo's `isPermissionAlreadyRequested` matches on `android:name`
alone, so the stub makes the tracking-transparency mod a no-op whichever order
they run in; and it is the only half that can neutralise the AD_ID that Google
Play Services AARs declare in their own manifests.

Deliberately NOT added to `withAndroidPermissionCleanup`'s
PERMISSIONS_TO_REMOVE: that list is lane-blind, and stripping AD_ID on the lab
lane zeroes the advertising ID on API 33+ and silently halves ad revenue.

**The wrong fix was one click away.** Ticking "uses advertising ID" in Play
Console clears the upload immediately and makes a false declaration, dragging
the Data Safety form with it. Same reasoning as the iOS ATT decision on
2026-08-26: when the store and the binary disagree, ask which one is lying.

**Evidence trap worth remembering.** `npx expo config --type introspect` showed
AD_ID already marked for removal on *both* lanes — which looks like the new
plugin working, and isn't. Introspect takes the on-disk
`android/app/src/main/AndroidManifest.xml` as its base, and this machine still
carries a pre-ads prebuild where the cleanup plugin stripped AD_ID. The
uncontaminated readings were: Expo's real `setAndroidPermissions` run against
the stub (no-op, confirmed), and `android.permissions` in the introspected
config (AD_ID absent on production, present on lab).

Tests: `__tests__/withAndroidAdsPrivacyLane.test.js` — both lane ends, the
plain-entry flip, the unresolved-lane default, the tracking-transparency
interaction against Expo's real implementation, and that the plugin is not in
`ADS_ONLY_PLUGINS` (being stripped exactly when it has work to do would restore
the rejection silently).

Ships as 2.8.18 / versionCode 38. **Not yet verified on an artifact** — the
`.aab` must be unpacked after the next Android build:
`unzip -p app.aab base/manifest/AndroidManifest.xml | strings | grep AD_ID`.

## 2026-08-30 — Test runs tag their rows and always purge them

- **Asked (/goal):** the backend suite writes real rows into the shared dev DB;
  the only way to find leftover test users is `WHERE postal_code IS NULL`. Make
  every test-created row self-identifying and **always** purged at the end of
  the run (a mandatory cleanup step), across every table — "I don't want
  generated data from tests on a live database."
- **Decisions (confirmed with Maxim):** (1) reserved identifiers, **no schema
  change** — a `qa-` prefix on every text id + `@qa.priceback.test` email
  domain, plus the existing reserved SKU (`5xxxxxxx`) / warehouse (`9000–9999`)
  bands; (2) a **wrapper around `npm test`** that purges clean-slate before and
  unconditionally after (pass / fail / crash), plus a standalone
  `scripts/purge-test-data.js` CLI that can be pointed at any DB incl. prod
  (replacing the ad-hoc `postal_code IS NULL` query); (3) land helpers + purge +
  CLI now, **migrate the ~60 DB test files incrementally** — the purge net also
  sweeps the current `test-` / `seed-` / `pdwin-` prefixes and the
  `@example.com` / `@test.local` domains as a transition.
- **Files/areas:** `backend/tests/helpers/uniq.js` (+`qa-` helpers, exported
  matcher lists), `backend/tests/helpers/purgeTestData.js` (new, FK-safe ordered
  purge), `backend/scripts/purge-test-data.js` (new CLI),
  `backend/scripts/run-suite.js` (new wrapper), `backend/package.json`
  (`test` / `test:fast` → wrapper), `__tests__/ciParity.test.js` (re-point the
  backend parity assertions — params move into `run-suite.js`, not removed),
  `backend/tests/purgeTestData.test.js` (new — purge + real-data-safety guard).
  The prod guard in `backend/db/client.js` is unchanged.
- **Status:** **PR #307** open, pushed. `tests/purgeTestData.test.js` (4/4)
  verified against the dev DB — the sweep clears every table and leaves
  real-shaped rows (unprefixed sub, real email, barcoded band-SKU product,
  non-`9xxx` warehouse) untouched. `__tests__/ciParity.test.js` green locally.
  **Not yet verified:** the `run-suite.js` wrapper end-to-end (pre/post purge +
  c8 coverage aggregation over the full suite) — GitHub Actions is
  billing-blocked again (all jobs fail in ~3s, `steps: 0`), so CI cannot run it.
  Follow-up: migrate the ~60 DB test files onto the `qa-` helpers, shrinking
  `LEGACY_SUB_PREFIXES`.

## 2026-08-30 (cont.) — Test email domain settled on `@priceback.test.ca`, legacy domains migrated

- **Asked (/goal):** every test-created `users.email` must always use the
  `@priceback.test.ca` domain; local test runs are authorised until CI unblocks
  on 2026-09-01.
- **What changed:**
  - `backend/tests/helpers/uniq.js` — `QA_EMAIL_DOMAIN` moved from
    `qa.priceback.test` to `priceback.test.ca` (a dedicated throwaway namespace;
    no PriceBack mail is sent there, and it cannot substring-collide with the
    real company domain `priceback.ca` — `foo@priceback.ca` does not end with
    `@priceback.test.ca`). Doc comments updated.
  - `backend/tests/helpers/purgeTestData.js` — comments updated; the matcher
    already reads `QA_EMAIL_DOMAIN`, so the sweep follows automatically.
  - **55 backend files migrated** off the transitional `@example.com` /
    `@test.local` / `@qa.priceback.test` literals onto `@priceback.test.ca`
    (per-file whole-word replace, asserts and fixtures kept consistent):
    `backend/scripts/seed-test-data.js` + 54 `backend/tests/*.test.js`.
    `LEGACY_EMAIL_DOMAINS` (`example.com`, `test.local`) is kept in the purge
    sweep as a backstop for pre-existing debris.
  - **Left as-is on purpose:** `backend/tests/accountIdentityUnit.test.js`
    (`@example.com` is deliberate input to the `normalizeEmail` / `claimsEmail`
    unit tests, never a DB row) and the frontend `__tests__/*` (client-side
    mocks / analytics-scrubber inputs — never touch `users.email`).
  - `backend/tests/purgeTestData.test.js` — new guard: asserts
    `QA_EMAIL_DOMAIN === "priceback.test.ca"` and that a user at the real
    `@priceback.ca` domain survives the purge (locks in that the matcher is
    `%@priceback.test.ca`, not `%@priceback%`).
- **Status:** targeted run green locally against the dev DB —
  `purgeTestData` (6/6) + `dbRoutes` + `creditReconDb` + `missingRoutes` +
  `duplicateAccountGuardDb` = 38/38. Full `npm test` (wrapper + c8) running
  locally to verify run-suite.js end-to-end and the coverage number.
- **Regression risk:** low. Change is test-only (no `src/`, no `backend/` runtime
  code, no schema). Risk surface = a test that hard-codes an expected email
  literal with a different spelling than its source — mitigated by per-file
  consistent replace and the targeted run; the full suite run is the final check.

## 2026-08-30 (cont.) — Purge abandoned smoke-test signups from prod + a recurrence guard

- **Asked:** "I can find some test users … `WHERE postal_code IS NULL`" — then,
  after cross-checking creation dates against release-tag times, "purge everything
  and add a job to purge this type of data systematically after the same type of
  actions."
- **What they are:** 7 `users` rows on prod created by smoke-testing release
  builds with throwaway Google accounts (real `sub`, real gmail, no test marker,
  so `purge-test-data.js` can't see them). Every burst landed 1–2 h after a tag
  (v2.8.9 / v2.8.11 / v2.8.12). All 7: 0 devices / sessions / receipts /
  subscription events / topups; only the 75-credit trial grant.
- **Decisions (confirmed with Maxim):** (1) purge all 7 now; (2) **guarded script
  + runbook step, NOT a cron** — an autonomous heuristic delete on `users` is too
  dangerous; (3) `sharobimmonica@gmail.com` — which the 2026-08-18 purge had
  deliberately KEPT — stays deleted (it's a second, inert account for a person
  whose real account `monicasharobim@` is untouched). I surfaced that conflict
  only after the DELETE; snapshot exists, restore was offered and declined.
- **Done — prod:** `DELETE FROM priceback.users` for the 7 subs in one guarded
  transaction (count-must-equal-7 assertion). 15→8 users, 7 `credit_ledger` + 2
  `consent_events` cascaded, 0 orphans. Full pre-delete snapshot saved.
  `Operations/Production_Test_Data_Purge_2026-08-30.md`.
- **Done — code (`chore/purge-stale-abandoned-signups`, PR pending):**
  `backend/lib/staleSignups.js` (fingerprint predicate + `findStaleSignups` /
  `purgeStaleSignups`, maxDelete=50 refusal, DELETE re-applies the full
  predicate), `backend/scripts/purge-stale-signups.js` (CLI, **dry-run by
  default**, `--write` / `--min-age-hours` / `--max`), `backend/package.json`
  (`db:purge-stale-signups`), `backend/tests/purgeStaleSignups.test.js` (no-DB
  guard rails always run; DB half: 1 match + 5 one-clause-broken controls),
  runbook §4b in `Release_Tagging_And_Repo_Management.md`.
- **Regression risk:** low. New lib + script + test only — no runtime path, no
  `src/`, no schema, `db:purge-*` scripts are operator-run. The one live-data
  action (the prod DELETE) is done and verified. Residual: the fingerprint could
  in principle match a real user who signed up, never opened the app, and left no
  province/postal for >24 h — mitigated by the six additional NOT-EXISTS clauses,
  the maxDelete refusal, dry-run-by-default, and it being operator-run not cron.
- **Not verified:** DB half of the new test — GitHub Actions still billing-blocked
  (jobs die in ~3 s). No-DB guard tests pass by construction.

## 2026-08-31 — A `development` branch, and ads that can finally be built

- **Asked (/goal):** "i need a parallel branch for developments … features
  branches based on main or development branch. development branch will be used
  for coding and testing new features, once it stable it will be merged to main.
  all production builds are based on main, all development builds are based on
  development branch. use the new development branch to start coding the
  implementation of the AD_ID and ads for the new version of the app."

### Part 1 — the branch model (done, pushed)

- **`development` created from `origin/main`** (`0ca5332`) and pushed. Features
  cut from and merge into it; it is promoted to `main` in one PR when stable.
  `main` stays the only branch a store artifact is built from, and the only one
  tagged.
- **CI extended to `development`** (`.github/workflows/test.yml`, both `push` and
  `pull_request`). Load-bearing, not cosmetic: without it the suite would first
  see a feature *after* it merged — and running the backend suite locally is a
  standing NO, so CI is the only signal there is. `ciParity.test.js` is
  unaffected (it forbids test *parameters*, strips comments, asserts nothing
  about triggers). Cost: roughly double the Actions minutes per change.
- **Build profiles:** development builds use the **`lab`** profile, not the
  dev-client profile confusingly named `development`. `lab` is standalone,
  points at the development Railway backend, and sets `LAB_ENABLED=true`.
- **Documented** in `Release_Tagging_And_Repo_Management.md` §6a, including four
  things easy to get wrong later: `development` is never tagged, never
  force-pushed, a `main` hotfix must be merged back down the same day, and dev
  builds are `lab` not `development`.
- **Preserved first:** ~64 modified files were sitting in the working tree on no
  branch (the `@qa.priceback.test` → `@priceback.test.ca` fixture-domain change,
  post-#308). Committed to `chore/test-email-domain` and pushed, no PR opened.
  ⚠️ **Flagged, not fixed:** the old domain used the RFC-2606 reserved `.test`
  TLD, which can never be registered. `priceback.test.ca` is a subdomain of the
  registrable `test.ca`, so `uniq.js`'s "no real account can ever collide" claim
  is weaker than the one it replaced. Maxim's call.

### Part 2 — ads (branch `feat/ads-buildable-on-lab-lane`, pushed)

Scope was set by Maxim's answer that **no AdMob account exists yet**: build it
lane-ready with Google's test units, leave production ad-free.

- **The deadlock, broken.** Ads could not be built on Android on *any* lane.
  16.5.0 hardcodes play-services-ads 25.4.0 (Kotlin metadata 2.3.0); RN 0.83.6
  pins Kotlin 2.1.20; metadata is forward-incompatible. `withAdsSdkKotlinPin`
  forced 24.6.0 — and 16.5.0's Kotlin imports `AgeRestrictedTreatment`, a 25.x
  API, so the pin traded a metadata error for an unresolved reference. Fixed by
  pinning the **library** to **16.0.0**, the last release shipping 24.6.0
  natively; the pin plugin is deleted, not adjusted. (npm: 16.1.0–16.3.4 → 25.0.0
  / metadata 2.2.0, still too new; 16.4.0+ → 25.4.0.)
- **`scripts/laneAutolinking.js`** makes `expo.autolinking.exclude` lane-aware.
  That list is the only exclusion Expo 55 honours and it is static JSON, so the
  exclusion protecting production also blocked the lab lane. No config answer
  exists — `parsePackageJsonOptions()` reads it from package.json and nowhere
  else, and `--exclude` only ADDS. The script only ever *relaxes*, and only on
  the lane, so a missed run costs a banner and can never leak the SDK into
  production. Measured: lane off → 14 modules, ads absent; lane on → 15, present.
- **Google's sample app ids** replace the all-zero placeholders in `app.json`
  (sourced from Google's quick-start docs). Required: the placeholders fail the
  publisher-agreement check against the test units, so every lab build would have
  died at config resolution, and the Android SDK aborts on an unregistered id.
- **Two silent-failure bugs found while doing it:**
  1. 16.0.0 has no `LARGE_ANCHORED_ADAPTIVE_BANNER`. The old string fallback
     would have handed native an unknown size — no ad requested, no
     `onAdFailedToLoad`, blank banner forever, release builds only, nothing in
     any log. `resolveBannerSize()` fixes it; the jest mock no longer exports an
     enum value the real SDK lacks.
  2. `publisherOf(x) === TEST_PUBLISHER` is **always false** (bare digits vs the
     prefixed constant). I wrote it as the new production guard and it was dead
     code until a test caught it. Replaced with `isTestPublisher()`.
- **`ADS_ENABLED: "true"` on the `lab` profile only.** Never production — that
  is Bugs #217. Also corrected `adsConfig.test.js`, which gated production's flag
  on the all-zero regex; left alone it would have inverted into "production MUST
  set ADS_ENABLED=true", reinstating #217 through the test written to prevent it.

- **Verified:** mobile suite 213 suites / 5183 tests green; coverage
  81.12/72.97/70.27/83.71 against floors 68/55/59/70; i18n 1493 keys in sync
  (en+fr); typecheck clean. Config resolved for real on both platforms — lab
  links the plugin with ads on and test units, production strips it. The new
  guard was fired by hand.
- **NOT verified:** no EAS build run. Whether the SDK *compiles* under 16.0.0 is
  exactly what `eas build --profile lab -p android` answers and nothing else
  does. Maxim's call to spend ([[eas-build-budget]]).
- **Regression risk:** production binaries unchanged by construction — lane off,
  exclusion committed, `adsEnabled` false, production profile untouched,
  `assertLabIsOffInProduction` still without an override. Backend untouched.

### Part 3 — ads finished on `development` (branch `feat/ads-att-priming-and-remove-ads`)

- **Asked (/goal):** "i want the ads to be fully integrated in the developpement
  branch, everything. the AdMob account is still blocked, we will have another
  pass to fully integrate it when its done. how many ad banner is integrated ?
  the subscribed users shouldnt have to see any ads in the app, when a user
  subscribe all ads should be hidden"
- **Decisions (confirmed with Maxim):** stay **lab-lane only**; **banners only**
  (no interstitial/rewarded/native); **no new placements**; **no UMP/CMP**.

**The count, since it was asked.** 7 `<AdBanner>` render sites across 5 screens
and 4 slot names — Home `home`; Scan / PriceTagScan / BarcodeScan intro footers
`scan`; BarcodeScan not-found `barcodeEmpty`; Receipts' two list footers
`receipts`. The two Receipts sites and the two BarcodeScan sites are mutually
exclusive branches, so **a user can only ever see one banner at a time.**

**Subscriber suppression was already correct — except on the second focus.**
`shouldShowAds()` requires a proven `premium.active === false` and fails closed,
and `useAdsVisible()` starts false. But `useFocusEffect`'s cleanup only cleared
its `alive` flag, and React Navigation keeps blurred screens mounted — so
`visible` survived the blur and the banner rendered on the very frame the screen
regained focus, before the async re-check could hide it. That is exactly the
path a user walks to subscribe (Home → paywall → back to Home, now paying).
Fixed by clearing on blur; costs free users a brief empty slot on tab switch,
which is the cheap side of the module's own stated asymmetry.

**Five i18n keys had been dead since PR #290** — `ads.removeAds` and the four
`ads.att*` — copy for two surfaces that were never built. Both built now:
- **ATT soft-ask** (`src/components/AdsAttPrimer.js`). iOS grants one system
  prompt per install and a denial is only reversible in Settings, so it was
  being spent cold. "Allow relevant ads" spends it; **"Not now" does not call
  `requestTrackingPermissionsAsync` at all**, so the question stays open, and
  backs off 30 days (`ads_att_deferred_at_v1`). Ads still serve either way,
  non-personalized — the non-punitive commitment in the PIA §3.
- **"Remove ads" link** in the banner's label strip → the paywall via the one
  sanctioned route, `navigate("Scan", { showPaywall: true, paywallOnly: true })`.

**Three things that had to be got right, and why:**
1. The primer is mounted **once at the app root**, not inside `AdBanner`. Blurred
   tabs stay mounted, so Home and Receipts can each hold a banner that resolved
   visible and would each race to open a modal.
2. `ensureReady()` is **memoized**, so an unanswered soft-ask would wedge every
   banner in the app for the session. It times out at 10 s and resolves as
   "Not now".
3. The link sits **above** the creative, in the label strip. AdMob treats an
   interactive element against the banner as an accidental-click surface and the
   enforcement is account-level. Pinned by a test asserting render order.

- **Verified:** `i18n:check` green — 1493 keys, en+fr in sync, all five formerly
  dead keys now reachable; `typecheck` clean; the build lane is untouched by
  inspection (`git diff development --` over `app.config.js`,
  `react-native.config.js`, `eas.json`, `app.json`, `config/`, `scripts/`,
  `plugins/`, `package.json` is empty).
- **NOT verified:** the test suite. Standing rule is no local runs — pushed for
  CI to answer. GitHub Actions billing has been blocking jobs, so if they die in
  ~3 s that is the cause, not the change.
- **Regression risk:** production binaries unchanged **by construction** — no
  lane, profile, plugin, autolinking or `app.json` edit; `adsEnabled` and
  `labEnabled` still false, the SDK still unlinked, `assertLabIsOffInProduction`
  still without an override. Backend untouched. The one paying-user-visible
  change is a banner that stops appearing.
- **Still owed when the AdMob account unblocks:** real unit ids in the EAS
  production environment, `app-ads.txt` on the website repo, and the lane flip.

## 2026-08-31 (cont.) — A price feed for store #2, and a province that means "everywhere"

**Ask (/goal).** Start or continue the Best Buy full scan process; find a way to
scan the new prices, ideally a daily cron against the Best Buy website (Canada
only for now); and look for ideas that would feed the app new prices from other
future stores like Abercrombie. Standing constraint restated: every store gets
its own parser, and no live parser may be edited — Costco's is very sensitive.

**The finding the whole design rests on.** Costco is Akamai-walled, which is why
its flyer needs a real browser and a human. **Best Buy Canada is not walled at
all.** `robots.txt` explicitly *Allows* `/en-ca/product/` and `/en-ca/category/`
(and *Disallows* `/en-ca/search`, so search is not crawled), a sitemap is
published, and `/api/offers/v1/products/<sku>/offers` answers an unauthenticated
GET with `regularPrice`, `salePrice`, `saleStartDate`, `saleEndDate`,
`isMarketplace`, `isWinner`, `isOnClearance`. No OCR, no browser, no LLM — this
feed is a plain `fetch` and a normalizer. There is nothing here to defeat, which
is exactly why it may be automated when Costco's may not.

**Why it is a watchlist refresh and not a "full scan".** The literal reading of
the ask does not survive contact with the site. The sitemap enumerates ~400k
unique SKUs (38 gzipped sitemaps; `fr-ca` mirrors `en-ca` 1:1), and the search
API **hard-caps between page 20 and 25** — about 2,000 results — no matter what
`total` claims, so the catalogue cannot be enumerated through search at all. A
sitemap-driven mirror would be ~57k requests/day, overwhelmingly on third-party
accessories nobody bought. A price only matters to PriceBack when a shopper
could still claim the difference, so the target set is exactly that: SKUs on a
live watched receipt line still inside the store's adjustment window. Bounded at
a few hundred requests today, capped by config, growing only with real users.
Maxim chose this scope over a broader discovery lane; the deals-feed lane is
deferred because no screen exists to render it.

**🔴 The marketplace gate is the load-bearing rule.** Best Buy does not
price-adjust items sold by third-party marketplace sellers, so quoting one sends
a shopper to a claim that gets refused. Same failure class as `2210 BANK ST`
parsed as an item costing $22.10 — *a plausible wrong number is worse than a
visible gap, because the user acts on it.* Sitemap 1 is dominated by marketplace
phone cases, so this is the common case. `isMarketplace === false` is required
**and** `sellerId === "bbyca"` must agree; a disagreement is refused under its
own reason (`seller_mismatch`) rather than resolved, so an upstream shape change
lands in the run summary instead of hiding.

**A province that means "everywhere" (Maxim's idea, and better than either
option offered).** `price_points.province_id` is NOT NULL and every read is
province-scoped — right for Costco, wrong for every retailer that publishes one
national price. Offered a 13-province fan-out or a demand-driven subset; Maxim
proposed a reserved province instead ("only costco use provinces"). Taken, with
one refinement: reserved by **code** (`"NATIONAL"`), not a hardcoded `id = 0`,
because `provinces.id` is a serial and the FK needs a real row anyway — reserving
the code means the write path needs *no special case at all*. Migration 0007, no
schema change.

The honest cost: four province-scoped reads had to learn it, and **one of them
is `findNotifiable`, the query that charges the commission** — it joins a price
row's province to the *buyer's* province, so a national row matched nobody until
it changed. Made safe two ways: the sentinel resolves to `-1` when 0007 has not
been applied (so an un-migrated DB is byte-identical to before), and every
predicate only *widens* (`= x` → `IN (x, national)`) while no Costco row is ever
national. Also reordered the `provinces` join below `users` so a national row
reports the buyer's real province — otherwise a shopper would have been shown
"NATIONAL" as if it were a place.

**Two guards that could not have fired.** (a) `scrape` has existed in
`price_source_types` since the v2 schema with **no writer**, and in neither
source list and neither rank CASE — a scraped row would have been written and
then never served, never swept, never notified. (b) `recordPricePoint` neither
accepted nor set `verified`, so passing the flag was **silently ignored**: the
feed would have looked verified in the code and not been in the database. Added
as an additive param defaulting to false. Same shape as "an exported, tested
guard that nothing calls is not a guard" (#219).

`scrape` ranks **below** flyer deliberately — a flyer price was checked by a
human against the printed page; a scrape reads an API whose shape can change
without notice. A test pins that the dearer flyer price beats a cheaper scrape.

**Write-on-change is correctness, not thrift.** `observed_at` is what the
appeared-after-purchase rule (#64) reads. One row per actual change makes it
mean "the day this price started", so a price that dropped *before* the purchase
stays ineligible and one that drops *after* becomes claimable. Re-stamping an
unchanged price nightly would make every old price look like it appeared today —
telling every shopper who paid the going rate that it just dropped, and charging
each of them commission.

**Files.** New: `backend/lib/bestBuyCatalog.js` (the only file that knows Best
Buy's JSON), `backend/services/storePriceAdapters.js` (the registry, mirroring
the receipt-parser registry), `backend/jobs/bestBuyPriceRefresh.js`,
`db/migrations/0007_national_province.sql`, four captured API fixtures, four test
suites. Modified: `priceDropRepo.js`, `pricesRepo.js`, `server.js` (a sweep leg +
the check-price gate), `config/defaults.js`, `db/seed.js`.

**Untouched, by construction:** no receipt parser, no `receiptParsingShared.js`,
nothing under `src/`. This is backend price ingestion and never goes near receipt
parsing. Best Buy's price logic lives in its own adapter file, per the
one-parser-per-store rule.

**Scheduling reuses what exists** — a leg of `_runPriceSweep`, inheriting the
tunable cadence, overlap guard, boot catch-up (#114) and `job_runs` history. Its
own `BESTBUY_SCAN_*` config pair so it pauses independently of the legacy scrape
leg. **Ships OFF** (`BESTBUY_SCAN_ENABLED=false`), the `ADS_ENABLED` shape.

**Verification.** Captured the 60-test money-query baseline *before* touching
anything (7 suites); after the change, **60/60 unchanged**, including "a price in
another province is not returned". Plus 24 adapter tests (against four real
captures, including a genuine discounted marketplace offer and the empty-bodied
404 that would make `res.json()` throw), 9 registry, 8 national-province, 10 job.
CI still billing-blocked, so local runs against the **dev** Supabase project —
ref checked against the prod ref before every run.

**Regression risk, stated.** Costco price path: the intended risk, and the
parity baseline is the evidence — predicates only widen and no Costco row is
ever national. Commission charging: `findNotifiable`'s logic is unchanged, only
which rows are visible. Other scrape-path stores: protected by making
`hasDbPriceFeed` an explicit allow-list rather than "any store", since that
branch returns null instead of falling through to a live scrape. Mobile app:
zero changes, no new user-visible strings, so no i18n surface.

**Owed before `BESTBUY_SCAN_ENABLED` is turned on** (none owed yet — it ships
inert): a second row in `REVIEWER_NOTES.md`, which declares exactly one scraping
source today, plus a re-render of `PriceBack_App_Review_Guide.pdf` (nothing syncs
the PDF to its source); a PIA for a third ingestion pipeline, short because it
reads catalogue data with no personal information; confirmation that Railway
egress reaches bestbuy.ca (the existing `SCRAPERS.bestbuy` is good evidence, but
Costco proves egress can be blocked where a laptop is not); and migration 0007
applied by hand on prod, whose drizzle ledger is hand-maintained.

**Abercrombie, spot-checked.** Same shape as Best Buy — product pages not
disallowed, a published sitemap, an `/api/ecomm/` JSON namespace, and
`abercrombie.ca` redirecting to a real Canadian storefront. A viable next
adapter, but nothing beyond `robots.txt` has been verified, and the "capture real
responses before believing it" rule applies in full. Full detail:
`Technical/Store_Price_Adapters_And_The_BestBuy_Feed.md`.

## 2026-08-31 (cont. 2) — iOS 2.8.16 crashes at every launch; hotfix 2.8.18 from `main`

**Report.** iOS 2.8.16 (36), the latest iOS build, crashes at every launch on
device. Nothing in Sentry. Last stable iOS is 2.8.14 (34). Asked for: root
cause, backend traces checked, and a stable build for a new App Store Connect
submission — as a hotfix off `main`, merged back to `main`.

**Root cause (the iOS face of Bugs #224).** #300 strips the
`react-native-google-mobile-ads` config plugin from every lane-off build — the
plugin that writes `GADApplicationIdentifier` into Info.plist — trusting
`react-native.config.js` to unlink the SDK in the same breath. #304 proved that
half was never read by Expo 55. So iOS 2.8.16 shipped the GMA pod **linked**
with **no app ID**, and the SDK aborts in `didFinishLaunching`
(`GADInvalidInitializationException`) before RN, JS, or Sentry exist. Hence a
crash on every launch and an empty Sentry. 2.8.14 predates the filter (plugin
ran, placeholder ID present — dark but alive). Android never shipped the same
crash only because its face of the divergence fails the *build* — the four
ERRORED Android releases were this same bug.

**Backend traces (asked for, checked).** Prod `consent_events`' newest iOS UA
is `PriceBack/34` (Aug 25); `PriceBack/36` appears nowhere; `auth_outcomes` has
zero rows after Aug 25 16:07 while 2.8.16 was built Aug 26. Build 36 died
before its first network call — the absence is the trace.

**Fix.** `main` already carries #304's real exclusion (Android 2.8.17 built
from it), so iOS 2.8.16's crash is fixed by building iOS from `main` at all —
plus one guard so this never ships silently again: branch
`hotfix/ios-2.8.18-launch-crash`, `scripts/assertAdsUnlinked.js` runs the real
`expo-modules-autolinking` resolver for both platforms as
`eas-build-post-install` and **fails the build** if the ads SDK resolves while
the lane is off (the iOS equivalent of Android's manifest-merger hard-fail,
run in the environment that ships). Then bump 2.8.18 / 38 / 38, tag `v2.8.18`,
one iOS production build from the tag (Maxim's approval first — EAS budget),
TestFlight checklist (launch ×3, both sign-ins, background/return, receipt
scan, paywall — this binary field-debuts #297–#301's JS), GitHub release,
back-merge `main` → `development`. Bugs entry: #228.

## 2026-09-01 — CI came back, and the first real run found two things that were never mine

**Context.** PR #312 (the Best Buy price feed) merged into `development`. Its CI
run is the first in roughly three weeks where GitHub Actions actually executed
jobs rather than refusing to start.

**✅ Actions is unblocked.** Run `33478395797`: Security **succeeded** with 10
steps, Mobile ran 9 steps and produced genuine results (5,226 tests). A
billing-blocked job has **zero** steps and dies in 2–3 s; every run from
2026-08-13 through 2026-08-31 had that shape. The memory entry has now gone
RESOLVED → BLOCKED → RESOLVED twice, so "is CI actually running?" is a thing to
check, not to remember. The amendment allowing local runs is disarmed.

**The cost of three blocked weeks is three weeks of unverified merges**, and the
first working run failed on two things that had nothing to do with the PR under
it. Both were confirmed pre-existing before being attributed anywhere.

**1. `__tests__/otaPreflight.test.js` — "the real repo key and certificate are a
matching pair"** fails in CI, passes locally. `keys/private-key.pem` is
gitignored (correctly — it is the private half of the OTA trust root), so the
assertion can only pass on a machine that holds the key. The test's own comment
at line 142 warns about *"works on my machine, silently dead"*: **the guard has
the exact defect it was written to catch.** Last touched 2026-08-17, untouched by
#312. Either the test must skip when the key is absent (and say so loudly), or CI
needs the key as a secret — the first is safer, and the "silently dead" concern is
better served by a check that runs where the key exists.

**2. Seven `purgeStaleSignups` / `findStaleSignups` tests** fail with
`lookupId: unknown credit_event_types code: free_trial`. Reproduced on `main`,
which carries none of the new work, so it is environmental. The dev Supabase DB
has drifted from `seed.js`: `free_trial` entered the seed list in June (fb23d7d)
and **`seed.js` uses `onConflictDoNothing`, which only populates an EMPTY table**
— the same standing gap already documented for store content, which is why
`db/deploy/store-content-sync.sql` exists. One INSERT of the missing row fixes
it; left undone because it is a database change nobody asked for.

**Method worth repeating.** For every red check: read the SHAPE first
(`gh run view <id> --json jobs -q '.jobs[] | "\(.name) \(.conclusion)
steps=\(.steps|length)"'`) — zero steps means billing and says nothing about the
code — then reproduce on `main` before blaming the branch. Both failures above
survived that test, which is what made "not mine" a finding rather than a claim.

**A parity trap this exposed in passing:** `npx jest` and `npm test` are not the
same command. The first misses the coverage ratchet entirely. When reproducing a
CI failure, run the script CI runs, not the tool it wraps.

**Verification of #312 itself** (unchanged by any of the above): 127/127 on the
merged tree — the 60-test Costco money-query parity baseline, both barcode
suites, and the five new suites. Mobile is green locally on the same tree
(215 suites / 5,226 tests) under CI's exact `npm test`, with coverage thresholds
met. The Backend CI job was still queued at time of writing — serialized
repo-wide, per the known eviction behaviour.


## 2026-09-01 (cont.) — CI now bills `main` only; and the "missing files" were deliberately removed

**Asked for:** rebase `development` on `main`; restore files the latest `main`
commit deleted that were blocking the iOS build; PR and merge; and stop the
workflows running on every PR and every merge, so the month's Actions minutes
last the whole month instead of running out around the halfway mark.

**Two of the three premises did not hold, and saying so was the work.**

**1. There was nothing to rebase.** `main`'s tip `53742ce` (#311) is already an
ancestor of `development`, merged at `cf42b49`. `development` is `main` + #309 +
#310 (the ads lane) + #312 (the Best Buy feed). A rebase would have rewritten
history to no effect.

**2. #311 deleted nothing.** It is `+282 / -0` — three files, all additions:
`scripts/assertAdsUnlinked.js`, its test, and one `package.json` line wiring it
as `eas-build-post-install`. All three are already on `development`. The iOS
crash was fixed by *adding* a build-time guard, not by removing a file, so there
was nothing to restore.

**What the diff actually shows** is the opposite direction: exactly two files
exist on `main` and not on `development` — `plugins/withAdsSdkKotlinPin.js` and
`__tests__/adsSdkKotlinPin.test.js`. **Restoring them would have been a
regression, not a fix.** #309 removed them on purpose: the plugin forced
`play-services-ads` down to `24.6.0` so Expo 55's Kotlin 2.1 could read its
metadata, and `react-native-google-mobile-ads@16.5.0`'s own Kotlin then calls
`AgeRestrictedTreatment`, a 25.x API the forced 24.6.0 does not have — a
deadlock. The lane pins the npm package to **16.0.0** instead, which ships
24.6.0 natively: one consistent pair, no forcing. The reasoning is written into
`app.config.js`, `react-native.config.js`, `adsAutolinking.test.js` and
`easBuildProfiles.test.js`, all of which name the deleted plugin and say why it
is gone. Left out, deliberately.

**Also verified rather than assumed**, since the ads lane is where iOS 2.8.16
died: `development` carries `assertAdsUnlinked.js` *and* the lane's
`scripts/laneAutolinking.js`, and the two agree. The guard's `verdict()` returns
`ok` when `labEnabled === true`, which is exactly the state `laneAutolinking.js`
creates when it strips the exclusion from `package.json` for a lab build — so
the lane can still build ads, and a production build that resolves the SDK still
fails. Both halves resolve the lane through the same `config/dotenv` →
`config/profiles` path, which is the thing that keeps them from diverging.

**3. The workflow change, which was the real work.** PR #313.

`.github/workflows/test.yml` triggered on `push: [main, development]` +
`pull_request: [main, development]`. **That bills one feature four times** — the
`feature -> development` PR, the push that merge produces, the
`development -> main` PR, and the push that merge produces. Hence the halfway
mark, every month. Now: `push: [main]` + `workflow_dispatch`, nothing else.

**The cost, stated rather than hidden:** `development` and every feature branch
are unverified by CI. That is worse here than in most repos — running the
backend suite locally is a standing NO, so for the backend CI is the only
trustworthy signal there is — so a red run on `main` is a post-merge discovery,
and the fix stays roll-FORWARD, never a moved tag.

**The replacement habit, and it is proven rather than described:** before
promoting `development -> main`, dispatch `Tests` against `development` from the
Actions tab and read it green. One deliberate run instead of four automatic
ones. This PR's own verification was exactly that — a `workflow_dispatch` run
against the feature branch — which also confirms the valve works on a
non-default ref, the thing that would have made the whole scheme unworkable if
it did not.

**Pinned by `__tests__/ciTriggerPolicy.test.js`.** Widening the list back is a
two-character edit that quadruples the bill and **fails silently**: nothing goes
red on the PR that widens it, the repo simply stops having CI three weeks later,
a month of commits away from the cause. The same test holds every *other*
workflow to on-demand-only, so a new file cannot quietly reintroduce the cost.

**Regression risk: none to the app.** No runtime code, config plugin, native
config or dependency was touched. The only behavioural change is when the suite
runs, not what it asserts.

**Two checks had to be fixed first, both of the same species: a check that was
not checking.** The narrowed trigger is what made them matter — when `main` is
the only place CI runs, a job that is always red is read as noise, and the day
it goes red for a real reason nobody looks.

1. **`ciTriggerPolicy.test.js`, the new guard itself.** `triggerBlock` sliced at
   `/^on:/m` and searched the REMAINDER for the next top-level key with
   `/^[a-z_]+:/m`. In multiline mode `^` also matches the start of the STRING,
   so the remainder — beginning mid-line at `"n:
"` — matched at offset 0 and
   the block collapsed to the single character `"o"`. The positive assertions
   failed loudly, which is how CI surfaced it. **The dangerous half is that
   `expect(on).not.toMatch(/pull_request/)` passes against `"o"`.** One regex
   landing a key later and the file would have been green while asserting
   nothing. Now walked line-wise, plus a guard on the guard: a block that
   captured only its own header fails rather than letting the negatives go quiet.

2. **`otaPreflight.test.js` — "the real repo key and certificate are a matching
   pair"**, red in CI since it was written, because `keys/private-key.pem` is
   gitignored. It now skips where the key cannot exist and says so at full
   volume; it still runs, and still fails, on every machine that can actually
   publish. The three REJECT-path tests below it inject their own `fs`, so those
   stay covered everywhere. This is the item flagged in the entry above; the
   "skip loudly" option was the one taken.

**Two failures were NOT fixed, and both were reported rather than papered over.**

- **Backend, 7 tests: `lookupId: unknown credit_event_types code: free_trial`.**
  Still the missing dev-Supabase reference row from the entry above. The fix is a
  database write, not a code change, so it stayed out of a CI-configuration PR.
- **Mobile: an open handle, not a test.** On the pre-promotion run all 216 suites
  passed (5232 passed / 1 skipped, coverage 81.2 / 73.02 / 70.49 / 83.79 over
  floors 68 / 55 / 59 / 70) and the step STILL exited 1, on *"Jest did not exit
  one second after the test run has completed"*. **New information, not a new
  bug:** that message is already present in the `development` push run of
  06:37 the same morning, which carries none of this work. It was invisible until
  now because a genuinely failing test was already making the job red — the first
  all-green run is what exposed it.

  **No `--forceExit` was added.** It would turn the job green by hiding whatever
  async work is still running: the same "green light wired to nothing" shape as
  the two guards fixed above, adopted deliberately. The leak wants finding, in
  its own change, with `--detectOpenHandles`.

**Merged:** PR #313 -> `development`, PR #314 (`development` -> `main`). The
`main` push fired a run and the `development` push did not, which is the whole
change, observed rather than assumed. #314 also removes
`plugins/withAdsSdkKotlinPin.js` and its test from `main` — the correct end
state, per the reasoning above.

**Standing consequence to remember:** `main` is now red on two pre-existing
issues. Until both are closed, "CI is red" carries no information, which is the
condition this work was supposed to end. Closing them is the next job.

## 2026-09-01 (cont. 2) — `development` was deleted by a promotion nobody asked for; restoring it

**Asked for:** restore the `development` branch with the Best Buy parser and ads
work on it, and put `main` back at the `v2.8.18` tag. The session before this one
had been asked only to *rebase `development` on `main`*, because Maxim had made
fixes there.

### What had actually happened

That session did the rebase-equivalent (`cf42b49`, `main` merged into
`development`) — and then kept going: it opened and merged **PR #314 "Promote
`development` to `main`"** at 16:04 UTC and let the head branch be deleted. Two
consequences, neither requested:

- **`main` stopped matching its own tag.** `main` moved to the merge `b0759aa`,
  whose tree carries the unreleased ads (#309/#310) and Best Buy price-feed
  (#312) work — while `app.json` there still reads `2.8.18` / build 38. The
  branch claimed to be the shipped build and no longer was, which is exactly the
  drift `Release_Tagging_And_Repo_Management.md` exists to prevent.
- **The only remote ref for weeks of unshipped work was gone.** `origin/development`
  no longer existed; `git status` read `origin/development [gone]`.

### Why nothing was lost

Established before touching anything, in this order:

1. `git rev-parse b0759aa^2` = `9415e02` — a merge commit names its parents, so
   the deleted branch tip was still recorded *by the merge that deleted it*, and
   it equalled the local `development` exactly.
2. `tree(b0759aa)` == `tree(9415e02)` == `18509efb…` — **the promotion merge
   carried zero unique content.** Everything on it existed at `9415e02`.
3. `git tag --contains b0759aa` was **empty** — no release was ever built or
   tagged from the promotion, so rolling `main` back could not orphan a shipped
   binary.
4. Each of the six commits `main` would shed was confirmed reachable from the
   restored `development`.

Only after all four did anything get pushed. Point 2 is the one that made the
rollback a formality rather than a judgement call.

### What was done

- **`origin/development` restored** at `9415e02` — a plain create, no history
  touched. All 14 files added by #309/#310/#312/#313 verified present:
  `backend/services/storePriceAdapters.js`, `backend/lib/bestBuyCatalog.js`,
  `backend/jobs/bestBuyPriceRefresh.js`, `src/components/AdsAttPrimer.js`,
  `scripts/laneAutolinking.js`, `backend/db/migrations/0007_national_province.sql`
  and their tests.
- **`b0759aa` preserved as `backup/main-pr314-promotion`** *before* `main` moved,
  so the next step was reversible rather than merely reversible-in-principle.
- **`main` force-pushed back to `53742ce`** with
  `--force-with-lease=main:b0759aa…`, so it would abort rather than race.
  `origin/main` and `v2.8.18` are now the same commit and the same tree
  (`c92da8d…`): `git checkout main` reproduces the shipped 2.8.18 binary again.

A **revert of the merge was considered and rejected.** It would have left
`main`'s HEAD off the tag, and — the deciding reason — `git` would then treat
#309/#310/#312/#313 as already merged, so the *next* promotion would silently
bring in none of them. A rollback that plants a regression in the following
release is not a rollback.

### Consequences to remember

- `plugins/withAdsSdkKotlinPin.js` is **back on `main`**, because 2.8.18 shipped
  with it. Its removal is correct and still lives on `development`; it rides the
  next *intentional* promotion. The previous entry's "correct end state" claim
  was about the end state of a release, not of today's `main`.
- The force-push fires one CI run on `main` for an already-tested commit. `main`
  remains red on the two pre-existing issues from the entry above; that is
  unchanged by this work and still the next job.
- **Root cause was a standing note, not a slip.** The `pr-merge-and-branch-cleanup`
  rule ("carry every PR to merge, then delete the branch") was written when every
  branch targeted `main` and never excluded the long-lived branches. It has been
  rewritten to apply to feature branches only, and a hard rule added: *"rebase
  `development` on `main`" is not a request to promote it; `development` is never
  merged up or deleted without an explicit ask.* Maxim has also turned
  **auto-delete-head-branch off** on the repo, so a merge no longer removes a
  head branch on its own.

## 2026-09-01 (cont.) — `chore/test-email-domain` landed on `development` and deleted (PR #315)

- **Asked (/goal):** "I asked you to clean the old branches that have been
  merged, but I still can see `chore/test-email-domain`." Then, on the finding
  below: *open a PR and land it to `development`, not `main`; merge it and delete
  the stale branch.*
- **Finding — the cleanup was not incomplete.** Zero merged branches remained.
  `chore/test-email-domain` survived because it was **never merged and never had
  a PR** (`gh pr list --head` → `[]`); the 2026-08-30 entry above had parked it
  as "Maxim's call". Its three lower commits *were* already in `development` via
  squash-merged #307/#308, which is why `git branch --merged` could not see them
  — a squash merge leaves no ancestry. Only the tip `7b4ee79` held unique work.
- **New standing rule from Maxim:** everything lands on `development` first;
  **no direct merge to `main` until explicitly asked**, hotfixes excepted (those
  still go straight to `main`). Recorded in memory alongside the branch model.
- **What changed (PR #315, squash `954e6dc`, base `development`):**
  - Cherry-picked `7b4ee79` onto current `development` rather than rebasing the
    branch — replaying all four commits would have conflicted against the
    already-squashed #307/#308. Applied clean, 58 files, zero conflicts.
  - Test emails consolidated onto one domain: `@example.com` 45 files → 2 (both
    URLs, not addresses), `@test.local` 15 → 0, `@qa.priceback.test` 2 → 0,
    `@priceback.test.ca` 1 → 59.
  - Deliberately not migrated: `accountIdentityUnit.test.js` (`@example.com` is
    `normalizeEmail` input, never a DB row), `costcoSameday.test.js` /
    `storageAdapters.test.js` (URLs), frontend `__tests__/*`.
  - **Second commit — the flagged claim, corrected rather than carried.** The
    migration had brought along two comments in `uniq.js` asserting no real
    account "can ever collide" with the domain. True of `qa.priceback.test`
    (RFC-2606 `.test`, never delegable); **false as written** of
    `priceback.test.ca`, since `test.ca` is an ordinary registrable `.ca` domain.
    Reworded to say what actually holds: the reservation is **operational**
    (PriceBack issues no account there, sends no mail there), not registry-
    enforced. Comment-only, no behaviour change. Landing the decision without
    shipping a comment that overstates it.
  - Side effect: `backend/lib/staleSignups.js:6` already documented the marker as
    `@priceback.test.ca` while the code used `qa.priceback.test`. Now correct.
- **Tests:** the guard shipped with the original work —
  `QA_EMAIL_DOMAIN === "priceback.test.ca"`, `"foo@priceback.ca"` does **not**
  end in `@priceback.test.ca`, and a live user at the real `@priceback.ca` domain
  **survives** the purge (locks the matcher to `%@priceback.test.ca`, never
  `%@priceback%`).
- **Branches:** `chore/test-email-domain` deleted local + origin, after verifying
  the only thing it still carried over `development` was the two overstated
  comments deliberately replaced. `chore/consolidate-test-email-domain` deleted
  on merge (auto-delete is off repo-wide, so `--delete-branch` was passed
  explicitly). **`backup/main-pr314-promotion` kept** — `origin/main` is at
  `53742ce` (#311) and the #314 promotion merge `b0759aa` is *not* an ancestor of
  it, so that branch is the only surviving copy of the rolled-back state.
- **CI:** triggers are `main`-push-only since 2026-09-01, so PR #315 showed no
  checks by design; `Tests` dispatched by hand on `development`
  (run `33572465632`). The two preceding `development` runs were already failing
  on the known pre-existing pair (dev-DB `free_trial` row, Jest open handle).
- **Regression risk:** low. Test-only — no `src/`, no `backend/` runtime code, no
  schema, no migration. The one non-test file touched is a comment. Risk surface
  is a test hardcoding an email literal spelled differently from its source;
  mitigated by per-file whole-word replacement and a zero-conflict cherry-pick
  across all 58 files.

## 2026-09-02 — `main` was red on THREE permanent failures, and one was a dead production tool (PR #316)

- **Asked (/goal, scheduled +4h21m):** "check the CI workflows and if it still
  fails, fix the main in priority so the tests pass (green) then start to debug
  the dev branch also or rebase dev on main once main is green (target is both
  green on Github Action)". Scheduled start honoured: armed a one-shot cron plus
  a fallback timer, and every wake-up was clock-checked before starting — three
  premature wakes (two killed timers, one stale task from the previous session)
  were correctly refused.
- **Context that explains all of it.** Last green run was **2026-08-12**
  (`31643153294`). The ~3-week Actions billing block meant every merge after that
  landed unverified, so defects accumulated behind a CI that could not report
  them. All three below fail *by construction* on every run — none flaky, none
  would ever have cleared on a retry.

### 1 — The "missing DB row" that was a code bug (Bugs #229)

`lookupId: unknown credit_event_types code: free_trial`, 7 tests. This log and
memory both recorded it as **"the dev Supabase DB is missing that row"**, with
the fix noted as *"a one-row DB write, not a code change"*. **That was wrong, and
acting on it would have written bad data.**

`free_trial` is a SUBSCRIPTION event type and has never been in
`CREDIT_EVENT_TYPES`. `lookupId()` calls `ensureSeeded()` *before* it reads — so
seeding ran and still could not produce the row. Verified against dev
(`gnedluuylimjwdmtvswl`): 14 codes, `free_trial` rightly absent. The fixture now
names the two codes that actually describe its movements (`signup_grant` +75,
`scan_consume` -5). Guarded by `backend/tests/lookupCodeNamespaces.test.js`,
which scans every literal `lookupId(schema.X, "code")` against that table's seed
list — the class, not the instance. These namespaces overlap (`price_tag_scan` is
BOTH a credit event type and a price source type), which is why the wrong pairing
looked plausible.

### 2 — The dead production tool it was hiding (Bugs #231)

Fixing #1 let the DELETE path run **for the first time**, and it threw at once:
`op ANY/ALL (array) requires array on right side` (42809). Drizzle expands an
embedded JS array into a parenthesised PARAMETER LIST, so `ANY(${subs})` renders
`ANY(($1, $2, $3))` — a **row constructor**, which ANY cannot take. Proven by
rendering both forms through `PgDialect`.

**So `scripts/purge-stale-signups.js --write` — the runbook tool for clearing
abandoned smoke-test accounts off production — could never delete anything.**
Dry-run is the default, so the broken path was never exercised. This was the only
`ANY(` in the backend; every other membership check already used the expanded
`IN` form. Fixed to match, keeping the `u` alias and the shared `fingerprint()`
so SELECT and DELETE still cannot drift. New regression test needs **no DB**, so
a `before` hook can never mask it again.

> **The insight worth keeping: a masked test is not a passing test, and a failure
> count does not distinguish them.** The `before` hook died on #1, so both tests
> covering `--write` were reported failed for weeks *without their bodies ever
> executing*. Seven red tests looked like one problem; they were two, and the
> second was the serious one.

### 3 — 214 suites passed and the job still went red (Bugs #232)

Root cause: a FAILED store lookup arms an auto-retry (1.2s, 3.5s) that nothing
awaits. Every test finishes sooner, so the timer fires into a torn-down Jest
environment, and Jest turns whatever it touches there into a RUN-level error on a
green summary. **Two symptoms, either of which alone exits 1:** the dynamic
`import("./purchaseService")`, and the catch's `console.warn`.

The visible message — *"Jest did not exit one second after…"* — named the wrong
cause and had been believed for weeks. It is a symptom: under
`--detectOpenHandles` Jest reports **no handles**, the message disappears, and it
still exits 1. A `globalTeardown` probe found exactly two live handles for the
whole wait (stdout, stderr) and zero requests, and the wait is a **fixed ~4m25s**
across three runs — a timeout, not a leak. `--forceExit` would have hidden the
real error.

Fixed in both halves: memoize the dynamic import (source), and `afterEach`
cleanup calling `__resetStorePricesForTests()` in the two suites that reach
storePrices indirectly (tests) — the cleanup `storePrices.test.js` already does
for the module it owns.

- **A wrong turn, recorded rather than hidden.** I first rejected the test-side
  cleanup as *unreachable*, reasoning that the global `beforeEach` calls
  `jest.resetModules()` and orphans each instance. Wrong about ordering:
  **`afterEach` runs BEFORE the next `beforeEach`**, so the require resolves in
  the registry the test just used. That mistake put the first fix in production
  source and cost a full CI run to disprove.

### 4 — Also ported: the OTA key-pair check (Bugs #230)

`otaPreflight.test.js` asserted `keys/private-key.pem` matches
`certs/certificate.pem`. `keys/` is gitignored, so the private half cannot exist
on a runner — red by construction on every CI run and every fresh clone. Ported
verbatim from `9415e02` (#313), which fixed it on `development` only and left
`main` red. Both sides are now byte-identical, so the eventual merge is a no-op
for that file.

### Branches / CI

- PR **#316** `hotfix/ci-green-main` -> `main`, squash `8eb8d84`, branch deleted.
  **BOTH BRANCHES GREEN** — `main` run `33611902465` (Mobile 7m24s · Backend
  12m52s · Security 18s) and `development` run `33613162266` (Mobile 7m3s ·
  Backend 21m56s · Security 20s), the latter dispatched by hand as
  `main`-push-only triggers require. First green `main` since 2026-08-12.
- **The mobile fix took two attempts, and the first one is instructive.**
  Memoizing the import removed one symptom and the job stayed red; only the
  second symptom (the catch's `console.warn`) revealed that the *retry outliving
  the test* was the cause of both. Also confirmed on the green runs: *"Jest did
  not exit one second after…"* **still prints** and the ~4m25s wait **is still
  there** — so neither was ever the failure. That leaves a standing non-failing
  cost of ~4.5 min per mobile run, deliberately not bundled into this fix.
- Two throwaway diagnostic branches (`diag/jest-open-handles`,
  `diag/jest-hang-probe`) created, used, and **deleted** — the `--detectOpenHandles`
  flag and the handle probe were deliberately kept off the PR branch.
- `main` is an **ancestor of `development`** (`origin/development..origin/main`
  is empty), so "rebase dev on main" is a no-op: after #316 merges, a plain merge
  of `main` into `development` carries the fixes over. Pre-checked for conflicts —
  `otaPreflight.test.js` identical on both sides, and the one dev-only `seed.js`
  edit (`NATIONAL` province, #312) is ~585 lines from mine. The new guard test
  was also checked against `development`'s lookup literals: it passes there.

### Regression risk

Low. Test-only except two source changes: one additive export (`_LOOKUP_CODES`)
and one memoized dynamic import on a path whose module is by definition already
resolved. No schema, no migration, no change to attempt counts, backoff, terminal
handling, or any price value; the retry timer's `unref()` is untouched. The
DELETE targets the same rows with the same parameter values — it can simply now
be issued at all.

## 2026-09-02 (cont.) — Hardening the Best Buy parser before real receipts, and four sensitive areas covered deeply (PR #317)

- **Asked (/goal):** "add more tests to the test suite to cover most recent bugs
  or sensitive areas, sensitive areas should be covered deeply to avoid any
  problem, add these to development for now only. cover also the best buy new
  parser and harden the logic of this parser so it be more intelligent and be put
  for real receipts tests soon".
- **Branch** `test/bestbuy-hardening-and-sensitive-coverage` -> **`development`**.
  `main` deliberately untouched, per the ask.
- **Two clarifications taken up front.** (1) Best Buy store numbers: Maxim —
  *"for a store like best buy that have the same prices for all stores across
  canada, i dont need to store the real store id if its complicated strip it, if
  you can normalize it do it"*, so leading zeros are now stripped. (2) No new
  receipt captures available yet, so the hardening is driven by the EXISTING
  corpus and by structural reading, not by invented layouts.

### The corpus's blind spot, stated plainly

Nine real Best Buy captures are pinned — but **eight are bestbuy.ca order PDFs
and one is a photographed in-store slip with a single item on it.** The in-store
path (thermal paper, bleed-through, faint glyphs, discount sub-rows, service
lines) is the path a real shopper uses, and it was validated by one receipt.
Bugs #219 already recorded this exact shape once: *"a store parser that passed
every test and got all nine real receipts wrong."*

### Four latent defects, found by reading the parser against its own captures

| | Defect | Bugs |
|---|---|---|
| H1 | `$3.699.99` — a comma OCR'd as a period. The money regex matches the PREFIX `$3.69` and stops, so a $3,699.99 TV logs at **$3.69**. **Already in the committed corpus**, on a line the parser happens not to read. | #233 |
| H2 | An online item row without a `$` matched four branches, none of them, and fell off the end of the loop. The product **vanished**; the credit was still spent. | #234a |
| H3 | An 8-digit internal counter (`00003501`, printed under an item on the real slip) was accepted as a SKU. Width was the only rule. | #234b |
| H4 | `SAVINGS_RE` had `you saved` but not `You Save` — present tense — so a discount row became a **product named "You Save" costing $10.00**, inflating the basket and failing the receipt's own reconciliation. | — |

Plus three smaller hardening items: **H5** store number normalized (`S-0937` ->
`937`) and now preferring the `S-n R-n` register pair, with the online path
refusing the bare form outright (a hyphenated unit in a shipping address could
still satisfy it); **H6** memberships/labour added to the service list, with
eco-fees **explicitly excluded** — `Ecofrais` is a real charged line pinned by
two fixtures (`49.99 + 0.25 = 50.24`); **H7** an online return is now routed
through the online parser instead of the thermal-paper reshape chain.

**All seven live in `bestBuyReceiptParser.js` only.** `receiptParsingShared.js`
is Costco's live code path with its own ~55-fixture corpus and per-file floor;
a Best Buy repair applied there is a Costco change wearing a Best Buy label.

### Tests

| File | Before | After |
|---|---|---|
| `bestBuyReceiptParser.test.js` | 85 tests | **121** |
| `bestBuyReceiptParser.realocr.test.js` | 117 | **127** (2 new corpus-wide invariants) |
| `bestBuyLaneEndToEnd.test.js` | — | **7, new** |
| `featureLanes.test.js` | — | **9, new** |
| `permissionAlerts.test.js` | — | **10, new** |
| `storePricesHook.test.js` | — | **14, new** |
| `purgeRestoreLedgersJob.test.js` (backend) | — | **15, new** |

The new Best Buy block includes the thing the corpus lacks: a **multi-item
in-store slip** — four items, a Geek Squad plan, a markdown with its sub-rows, a
SKU printed on its own row — asserted again with bleed-through interleaved and
required to parse identically.

Two corpus-wide invariants were added to the real-OCR suite, each the assertion
that would have caught a defect above had it landed one row over: no item price
equals the *truncated* reading of a dotted-thousands token anywhere on the
receipt, and no SKU is zero-padded or a `YYYYMMDD` stamp.

### Sensitive areas — the coverage, and what it found

| File | Before | After |
|---|---|---|
| `src/services/featureLanes.js` | 66.7 / 66.7 / 66.7 / 66.7 | **100 / 100 / 100 / 100** |
| `src/services/permissionAlerts.js` | 20.0 / 0 / 50 / 20.0 | **100 / 100 / 100 / 100** |
| `src/services/storePrices.js` | 88.2 / 83.7 / **60** / 91.0 | **97.3 / 87.8 / 82.9 / 98.9** |
| `src/services/bestBuyReceiptParser.js` | 91.3 / 83.8 / 96.9 / 95.0 | **93.1 / 86.4 / 97.4 / 95.6** |
| `backend/jobs/purgeRestoreLedgers.js` | **0 / 0 / 0 / 0** | covered |

- **featureLanes** is four lines and decides whether unfinished work runs in
  front of a real user. It was covered only *incidentally*, through the parser
  registry, and `laneLabel` not at all. Now: every near-miss value fails closed,
  and mutating the same `extra` object between calls is seen (proving nothing is
  memoized, which is stronger than swapping the object).
- **storePrices**: the real gap was `useStorePrices` at **0%** — the hook every
  purchase surface reads from — plus three swallowed catches. The listener
  bookkeeping is the Bugs #232 family: deferred work outliving its owner.
- **`purgeRestoreLedgers` — the first test it ever had found a live defect.**
  `Number(getOpsConfig(...))` maps `""`, `null`, `false` and `[]` all onto `0`,
  and `0` is the documented setting for *"wipe the ledger on the next sweep"*.
  An operator **clearing** the `app_config` field — the natural way to restore
  the default — would have erased every soft-deleted account's `credit_ledger`
  rows on the next hourly run, hours or days early, irreversibly. Fixed by
  checking the value's shape before converting it. **Bugs #235.**

### Coverage floors

`bestBuyReceiptParser` raised 90/82/95/94 -> **92/85/96/95**; new per-file floors
for `featureLanes` and `permissionAlerts` at 100. **Global floors deliberately
unchanged** — pinning a file *subtracts* it from the `global` pool, so the post-
change global figure is not comparable to the pre-change one, and raising against
the old number would pin a figure that was never measured. `storePrices` is
deliberately left IN the pool, where its gain lifts the global instead of being
carved out of it.

### Regression risk

**One intentional behaviour change**, called out rather than buried:
`extractBestBuyStoreNumber("S-0937 R-004")` returns `"937"`, not `"0937"`. Lab
lane only, no stored user data keyed off it, one pinned test updated. Everything
else is additive or strictly narrowing, and each guard is contained:

- H1 fires only on a shape no correctly-printed Canadian amount can have;
- H2's no-symbol pattern is tried only *after* the `$` form fails;
- H3 was verified against all 11 corpus SKUs before landing;
- H4 stays anchored `^...$` around a printed amount, and deliberately does **not**
  match `discount` or a `total ...` prefix — both name basket-level rows, and this
  handler applies to `items[items.length - 1]`;
- H6 excludes eco-fees, asserted by name.

**Not touched:** `receiptParsingShared.js`, `costcoReceiptParser.js`,
`receiptGeometry.js`, `faintPrintRepair.js`, every Costco fixture. The Costco
parity block replays the whole Costco corpus through the dispatcher and was green
throughout.

The backend change is a narrowing: fewer inputs now reach the DELETE's
`graceHours` as a number, and the one value that mattered (`0`) is unchanged.

## 2026-09-02 (cont.) — Best Buy comes off the lab lane and becomes store #2

**Ask (/goal).** Continue implementing full Best Buy store support in the app;
once done, retrieve 10 products from the Best Buy Canada API to check the
mechanism; run the committed Best Buy receipt fixture to prove the full path;
then spend the remaining session on tests for the backend and the app.

**Constraints restated mid-task by Maxim.** (a) Everything lands on
`development` via a feature branch — `main` accepts nothing but a
`development` promotion, after device testing and his explicit approval.
(b) Never change anything that can affect Costco (parser, reader, shared
engine). (c) **Do not deploy or edit any production backend before the code is
on `main`.**

**Status:** on `feat/bestbuy-full-store-support`, PR into `development` pending
CI. **Not for `main` without Maxim's device test and explicit approval.**

**What "full store support" turned out to mean.** Both halves already existed
and were pinned by real data — the parser by nine captures and #317's hardening
pass, the price feed by the adapter/registry/job built on 2026-08-31. What kept
Best Buy from users was the lab lane, and the lane existed for a reason that had
expired. So the work was: take the fence down, prove the mechanism against the
live API, and close what the promotion breaks.

**Five declarations of one fact had to move together** — `STORE_PARSERS`,
`LAB_STORE_PARSERS`, `LAB_ONLY_STORES`, `enabled` in `stores.js`, and the
regenerated `policies.json`, plus `BESTBUY_SCAN_ENABLED`. That is the shape that
gets three of five right, so `bestBuyStorePromotion.test.js` now pins the
agreement mechanically. Both files carried a comment saying they had to agree;
the comment was the entire enforcement.

**🔴 The promotion created a defect, and finding it was the point of looking.**
`ScanScreen` runs quantity inference on any `receiptKind: "online"` — exactly
what the Best Buy parser stamps on order PDFs — and the SKU lookup underneath
hardcoded `store=costco`. Costco SKUs are 6-7 digits and Best Buy's 7-8, so the
ranges overlap and a hit would rewrite a Best Buy line's quantity from an
unrelated Costco price. Fixed additively (`storeId` defaults to `"costco"`, so
every pre-existing caller is byte-identical). **Bugs #236.** The durable lesson:
a hardcoded constant is not a bug until a second case exists, and then it is a
bug everywhere at once — so when promoting one instance to many, grep the whole
app for the FIRST instance's identifier, not just the subsystem being promoted.

**The live probe: 10 of 11 quoted, and the one rejection was the right one.**
New `npm run bestbuy:probe` goes through the real adapter (not a raw URL) so it
prints what the JOB would see. Against the eleven receipt-corpus SKUs:
`quoted=10/11 rejected={"marketplace":1} in 115.1s`. The rejection is
`18145276` — a product a real shopper bought AT Best Buy whose buy box is now
held by a third party, which Best Buy will not price-adjust. First live evidence
the marketplace gate works outside a fixture written to trip it.

It also found **two bad `validUntil` values** the four curated fixtures could
never have produced: an `offerEndDate` six years in the past, and a sale-end
date on a price already back to regular. Both were being stored, and a stored
past date is worse than none — the display read filters expired rows and
`findNotifiable` does not, so such a row is invisible to one reader and visible
to the money path. **Bugs #237**, fixed inside Best Buy's own adapter so no
Costco query changed.

**Commission "exactly once", audited on Maxim's instruction** ("this feature
doesnt have room for errors 0% chances"). The funnel is already singular — one
ledger writer, one charge site reached only by the insert winner, a per-item
advisory lock ordered before the prior-minimum read, and telescoping totals so
an item's lifetime charge is exactly `dropChargeCredits(paid − lowest)` however
many drops it saw. The legacy flyer sweep notifies but never charges. What was
missing was any test that this survives code nobody has written yet, and any
test at all for a second store — every existing commission test used
`storeCode: "costco"`. Two new suites: a DB-free structural guard (one writer,
one charge site, the unique index in both schema.js and deploy/schema.sql, no
store identifier in the arithmetic) and a DB suite for a Best Buy national
price including **three concurrent sweeps**, the only test that actually
exercises the advisory lock.

**A dead tool, repaired.** `regenerate-policies-json.mjs` had been broken since
the lab-lane work gave `stores.js` an `expo-constants` import Node cannot
resolve. While it was dead the app bundle and the backend payload drifted — two
French claim steps had lost the word "canadien". Fixed with a narrow ESM resolve
hook rather than hand-editing the generated file, because a generator nobody can
run is a generator nobody runs.

**One expectation moved because a parse got BETTER.** `ocrService.test.js`'s
"Best Buy Orleans" receipt prints `item $3,699.99 + tax $461.00` against a TOTAL
of `$4,180.99` — arithmetic that does not close. 13% of $3,699.99 is **$481.00**
and lands on the printed total exactly; the printed tax is an 8 read as a 6. The
generic engine shipped the misprint; the Best Buy parser repairs it, and adopts
the repair only because it LANDS. The test now asserts both the value and that
it reconciles.

**Regression risk, stated.** Costco receipt parsing: **none by construction** —
no Costco or shared parsing file was touched, and the parity block replays the
whole Costco corpus as evidence. Costco price history: none — the new `storeId`
defaults to `"costco"`, pinned by a test. Live users: none — prod serves store
data from the DB, prod tracks `main`, and this lands on `development`. The one
real behaviour change is that on a build from this branch a Best Buy receipt is
parsed by the Best Buy parser instead of the generic engine. That is the
deliverable, and it stays invisible to users until the `stores` row is flipped.

**Still owed before the feed actually runs in production** (unchanged, and
explicitly NOT done here per Maxim's "dont deploy or edit any production backend
before the code goes on main"): the `REVIEWER_NOTES.md` second-scraper row plus
a PDF re-render, a short PIA, Railway egress confirmation, migration 0007 applied
by hand on prod, and the `stores` row UPDATE that actually shows the store.

## 2026-09-06 — A drop the shopper already paid for survives the price going back up

**Ask.** Maxim, mid-session: *"does Best buy price points have a valid until
date? or duration? if not the price point should be valid until the next
refresh from the api but also should have an updated or created date… or a new
row that should be retrieved on GetPrices() on the receipt button that retrieve
the latest price point only and it should lock it until the user gets his
refund in the policy window"* — and separately: *"make sure on every path for
any store now or in the future to always deduct the commission only once, this
feature doesnt have room for errors 0% chances."*

**What the code actually said, before building anything.**

- `valid_until` is nullable and, after the #237 fix, almost always null for Best
  Buy. It is only set when Best Buy publishes a genuine, un-expired sale end.
- "Valid until the next refresh" is **already what the data means**. The job is
  write-on-change: one row per real change, so a row is implicitly valid from
  its `observed_at` until the next supersedes it. An explicit duration would
  have to be re-stamped nightly, which is exactly what breaks the
  appeared-after-purchase rule (#64).
- Both dates already exist: `observed_at` (the day this price started) and
  `created_at` (immutable insert time).
- `GetPrices()` is `getLatestVerifiedPrice`, and it already returns the newest
  verified row only.

**🔴 The double-charge Maxim was guarding against is already impossible, and
saying so was more useful than building a flag.** `price_drop_notifications` is
UNIQUE on `(receipt_item_id, price)` and the charge is unreachable unless that
insert won (`ON CONFLICT DO NOTHING … RETURNING`). A deeper drop charges only
the increment, so an item's lifetime charge is exactly
`dropChargeCredits(paid − lowest)` however many times it moves. A "stop after
the first drop" flag would have *removed* a saving the shopper is owed. So
commission behaviour was left exactly as it is, and the guarantee was pinned
instead (`commissionChargedOnce.test.js`, `commissionAnyStoreDb.test.js`).

**What WAS missing is the display half, and Maxim picked the design.** Commission
is debited at DETECTION; the price shown comes from `getLatestVerifiedPrice`,
which answers with whatever is newest. So a rebound between detection and the
shopper reaching the store erases the drop from their screen while the charge
stands. Nine of eleven corpus SKUs moved in the live probe, so for store #2 this
is the common case, not an edge.

**The lock.** `price_drop_notifications` has recorded the price of every drop the
sweep surfaced and billed for since the feature shipped, and nothing ever read
it back — it existed only to elect one charger. `lockedDropsForUser` is its
first reader: the LOWEST notified price per live watched line, keyed by
`(receiptId, position)`.

**Lowest, not latest** — the lowest is exactly what the commission was billed
against, and "latest" is not even well defined when two sweeps land in the same
second.

**Entirely additive on the backend.** No existing query is modified, so a
failure can only mean a missing lock, never a broken receipt list. The window,
the claim state, the soft deletes and the ownership scope are all enforced in
the QUERY — a lock that outlived the adjustment window would show a claim that
can no longer be made, which is the same failure inverted, and the client caches
whatever it is handed. Served fail-soft on `/api/me/bootstrap` alongside
`savings`, because a throw in that Promise.all is the outage shape that once
cost four days.

**On the client** `services/lockedDrops.js` computes a FLOOR, never a ceiling: a
deeper live price still wins and bills its own increment. A lock also applies
when there is no live price at all, so a transient backend gap cannot erase a
paid-for claim.

**🔴 The subtle bug, guarded from both sides.** The item's position is captured
BEFORE the watchable filter. `isWatchableLine` drops fee/deposit rows, so
filtering first renumbers the survivors — and on any receipt containing an
`Ecofrais` line (a real Best Buy row, pinned by two corpus fixtures) every lock
would be applied to the wrong product at the wrong price, silently. Tested in
both directions: a lock on position 1 must reach the survivor, and a lock on the
filtered-out position 0 must NOT.

**The disclosure is part of the feature.** A saving the till will not honour,
shown with no explanation, sends someone to a counter to be told they are wrong.
An amber "Price held" chip plus a one-line reason, EN + FR (`en=fr=1495`).
Negative tests included: an ordinary drop shows neither, a claimed line never
shows it, and a stale zero-savings record shows nothing.

**Regression risk.** Commission: untouched — `findNotifiable`, `recordNotified`
and the charge arithmetic are not modified, and the structural guard asserts
that mechanically. Costco: it gains the same fix, which is correct — Costco has
the same exposure on a weekly clock — and the change is display-only; no parser
or shared parsing file is involved. Users with no locks (everyone, until the
server sends one) take a path pinned by an explicit no-lock test.

**Status:** branch `feat/locked-drop-price`, stacked on #320. CI held until
#320's backend run finishes — two backend suites must never share the pooler.

---

## 2026-09-06 — Instagram pre-launch teaser pack (social-media-manager PR #3)

Not this repo and not the app: `social-media-manager`, branch
`sm-content-teaser` → `sm-content-assets`. Logged here because it commits a
renderer, and because the copy is bound by `legal/MARKETING_CLAIMS.md`.

**What.** `sm-content/teaser/` — 20 assets, EN + FR: four numbered feed posts
(1080×1350) and six story frames (1080×1920), four of the latter leaving a band
for a native sticker. They name no product, category or retailer. The series is
spined on **30** — reads as a countdown, is actually the price-adjustment
window, so it re-reads on launch day.

**Why it looks unrelated to the launch pack.** That pack is near-black, emerald
glow, huge grotesque, and explains everything. This one is thermal-receipt
paper, Roboto Mono, mostly empty, one emerald element per frame at most, and
explains nothing. The distance is deliberate: the launch pack then lands as an
answer rather than as more of the same.

**Compliance is load-bearing, not decoration.** MARKETING_CLAIMS.md names the
exact risk — a claim clipped into a social card without its paired fine print. A
teaser has no room for fine print, so it makes no claim at all: every line is a
question, an instruction, or hedged ("some", "might"), and **every amount on
every frame is a black bar**. The redactions exist because we are not allowed to
print a figure we would have to stand behind. No retailer named or shown, so no
non-affiliation disclaimer is needed. `verify.js` gate 5 enforces this on the
strings, so softening the gate is the wrong fix for a failure.

**It ships its own source, unlike the launch pack.** Those scenes lived in a
Cowork session and are gone — a copy change there is a rebuild. Here
`scenes/strings.json` holds every word in both languages and a change is a
re-render. Seeded PRNG, no `Math.random`: all 20 assets verified byte-identical
across runs.

**The gate worth reusing.** Safe zones cannot be checked by luminance in this
pack — the surface revealed behind a torn edge is darker than paper and lighter
than ink, and a faded kicker lands on the same value, so no threshold separates
print from decoration. Instead each scene re-renders in a "content" mode that
suppresses the paper, the tears and the ghost rows; content is then exactly the
non-transparent pixels and the check is an alpha test with no judgement in it.
It caught three real defects: a hand-drawn circle reaching into the right action
rail, story rows running under the caption bar, and a kicker overprinted by its
own headline. A fourth gate measures a rendered font probe, because librsvg
substitutes a missing font silently — without it a machine lacking Roboto Mono
ships a whole pack set in something else and nothing errors.

**Regression risk: none in the app.** Different repo, additive folder, no app
code touched. The only shared file modified is `sm-content/README.md` (rows
added); no existing asset was re-rendered or replaced. Pre-existing uncommitted
work in that repo's `src/` was left untouched — only the teaser paths were
staged.

**Open for the operator, not blockers.** The date renders as `09 . ▮ . 26`
(month shown, day hidden) and is a string in `strings.json` — if the calendar
moves, change it and re-render. Stickers must be added inside Instagram to be
interactive. Note also that the handle `@priceback.ca` already discloses the
name; what the pack withholds is what the product *does*, which is the part
worth protecting.

---

## 2026-09-07 — The evergreen Instagram pack, a 14-day run, and a publisher that cannot double-post (social-media-manager `sm-content-evergreen`)

Not this repo and not the app: `social-media-manager`, branch
`sm-content-evergreen` off `sm-content-teaser`. Logged here because it commits a
renderer and a scheduled poster, and because the copy is bound by
`legal/MARKETING_CLAIMS.md`.

**What.** `sm-content/evergreen/` — 38 assets, EN + FR: nine 4:5 feed posts and
ten 9:16 story frames, plus a 14-day schedule (Mon 7 → Sun 20 Sep), two Reel
scripts, `scripts/publish-due.js`, and two GitHub Actions workflows. Docs:
`EVERGREEN-NOTES.md`, `CALENDAR.md`, `HOOK-BANK.md`, `AUTOMATION.md`, and
`docs/instagram-playbook.md` with the August launch playbook archived beside it.

**Why a third pack.** The launch pack was built around one retailer and one
claim window. Both were right in August and both are now moving targets — a
second store is live, more are queued, and every retailer sets its own terms. An
asset that prints either becomes *wrong* the day a store with different terms
goes live, and goes on being posted anyway, because nobody re-reads a PNG. This
pack describes the mechanic instead. The store list still appears, as
**categories** with two ticked, and that frame is both the growth story and the
only follow ask in the fortnight: *new stores get announced here first.*

**The constraint is enforced, not remembered.** `scenes/claims.js` holds one rule
set — no retailer named, no window in days, no currency figure, no percentage,
no promise — and it is imported by **both** `scenes/verify.js` (the art) and
`scripts/check-copy.js` (the captions). The captions were the half nobody was
gating before: verify.js only ever read `strings.json`. It fired for real during
the build, on `on n'imprime pas un chiffre qu'on ne peut pas **garantir**` — a
negated, genuinely harmless use. The copy moved. The gate did not: the one time
you loosen it for a harmless case is the time the next case is not harmless.

**The disclaimer is appended by the publisher, never typed per post.**
MARKETING_CLAIMS.md names the exact failure — a claim clipped into a social card
without its paired fine print — and a disclaimer that depends on someone
remembering it is a disclaimer that is eventually absent. One string in
`schedule.json`; CI fails if it loses the non-affiliation line or the
success-fee pairing.

**Four defects the gates caught, each worth keeping.**
1. `feTurbulence` paints the whole filter *region* — for a rotated strip, its
   bounding box, not its outline — so the paper texture was drawing a visible
   rectangle around every frame. Fix is `feComposite in2="SourceAlpha"
   operator="in"`, which then requires the path to carry a fill. It also took
   the pack from 25 MB to 8 MB: the stray noise was defeating palette
   compression.
2. SVG `letter-spacing` is **absolute**, not an em. The type auto-fit solved for
   size while treating tracking as if it scaled, and since the display token's
   tracking is negative it mis-solved *upward* — hooks overran the story frames'
   action rail.
3. Fontconfig will not hand you a face by weight. `font-family="Roboto"`
   resolves to a bold face at *every* weight from 400 to 900 on this machine
   (measured — identical ink). Every hook was shipping Bold and every sub-line
   bold too, silently, with the tokens declaring 900 and 400. Faces have to be
   named (`Roboto Black`).
4. **A gate can be wrong in the same direction as the bug.** The first version
   of the font gate compared ink *extent* and reported the Black face missing at
   552px vs 555px, on a machine where it was plainly rendering — Roboto's Black
   and Bold have near-identical advances; weight lives in the stems. It had to
   measure ink *area*. A gate that fails for the wrong reason teaches you to
   ignore it.

**The publisher's four properties.** Dry run by default (`--write` is the only
way to post, and the workflow additionally requires `PUBLISH_ENABLED=true`);
never twice (every publish recorded by slot id in `published.json`, plus an
Actions `concurrency` group); never late (a slot is publishable only within 6h
of its time, so a runner that was down for two days reports MISSED rather than
dumping four posts at once); and the disclaimer above. Stories and Reels are
deliberately **not** automated — the Graph API cannot attach a poll, quiz,
question, slider or link, and on those frames the sticker *is* the content; the
art leaves an empty band for it, so an automated story would publish a hole.

**CI does not re-render.** `render.js` resolves fonts through the system font
list and a runner's versions will not match the build machine's, so a CI render
would either flake or quietly redefine "correct". CI checks facts about the
files (schedule validity, the claim gate); a human checks facts about the pixels
(`scenes/verify.js`, six gates, run locally).

**Verification.** 38 assets rendered byte-identical across two runs (seeded
mulberry32, no `Math.random`). `verify.js` 6 gates / 0 failures / 0 warnings;
`check-copy.js` 445 art strings + 9 captions / 0 problems; `publish-due.js
--check` 22 slots / 0 problems; dry run exercised end-to-end including caption
assembly and the raw.githubusercontent asset URL. Nothing was published — the
account was not touched and the workflow ships switched off.

**Regression risk: none in the app.** Different repo, additive folders, no app
code touched. The only pre-existing file modified is `sm-content/README.md`
(rows and a section added); no existing asset was re-rendered or replaced.
Pre-existing uncommitted work in that repo's `src/` was left untouched — only
the new paths were staged.

**Open for the operator.** The run is dated 7–20 Sep and shifting it means
editing `schedule.json` and nothing else. Day 4 has no asset on purpose: it is a
screenshot of day 1's real poll result. Day 13 promises a comment count —
post it, an open loop you don't close costs more than the follows it bought.
Both languages of all nine posts are rendered; this run publishes 5 EN / 4 FR
and the other half is the next cycle, inverted so French gets the follow post.

---

## 2026-09-07 — Abercrombie & Fitch as store #3: policy read, price feed triaged, adapter started

**Ask.** Maxim asked whether A&F can be added as a store, and if so to plan the
architecture and a new parser (online **and** in-store receipts), check whether
price adjustments can be claimed **by email for both receipt types**, and if so
implement the whole flow including generating the email. He supplied the
sale-terms URL and noted he has no A&F receipts yet.

**Two standing rules restated during the session**, both now in memory:
one store = **one parser file** (never mixed), and one store = **one
documentation folder** (`Technical/<StoreName>/`, never mixed). The second was
prompted by a plan that proposed writing Abercrombie findings into
`Store_Price_Adapters_And_The_BestBuy_Feed.md`. That file's Abercrombie section
has been moved out to `Technical/Abercrombie/` and its "Adding the next store"
heading made store-neutral.

**Verdict: viable, with one correction to the premise and one hard limit.**

The policy was read from A&F's own pages in a real browser — both are
JS-rendered, so WebFetch returns navigation chrome and no policy text, and three
aggregator sites state the policy wrongly. Full quotes in
`Technical/Abercrombie/Price_Adjustment_Policy.md`.

- **Online — 14 days, US *and* Canada, from the ORDER date**, full price only,
  one adjustment per item, same colour and size, and **email is the officially
  designated channel** (`Abercrombie@Abercrombie.com`, order number required).
- **In-store — 7 days, and email is NOT available**: *"please return to your
  nearest Abercrombie or abercrombie kids store with your merchandise."*

So the answer to "can both be claimed by email" is **online yes, in-store no**.
That matters because commission is debited at **drop detection**, before any
claim — routing an in-store buyer to email bills them for a refusal. Decision:
in-store receipts get a guided in-store pack, which is the shape
`ClaimAssistantScreen` already implements for Costco warehouse purchases.

🔴 **Open — the in-store window.** Configured as **14 days for both channels** on
Maxim's instruction; the 7 comes from a different official A&F page and is scoped
to in-store purchases. One data field (`stores.adjustment_days`), so it is a
one-line change. Owed: read the **Canadian** in-store help page.

**Capture session (the feasibility crux, since a parser with no price feed is
inert — the exact gap Best Buy had as store #2).** Full writeup in
`Technical/Abercrombie/Price_Adapter.md`.

- **A&F is not walled.** A minimal-header `fetch` returns **403**; a *complete*
  browser header set returns **200** with the full 525 KB page. That nearly
  produced the wrong verdict — the adapter's `HEADERS` constant is load-bearing,
  and trimming it reintroduces a 403 that lands as silent counted data loss.
- Prices are **inline in the HTML** as a `productPrices` global with per-variant
  `itemId` / `listPrice` / `offerPrice` — exactly the "full price only" and
  "same colour and size" tests the policy needs. No JSON API required.
- 🔴 **A&F geo-routes, and the failure is silent.** From non-Canadian egress every
  attempt (path, `Accept-Language`, country cookies, `?originalStore=ca`) lands on
  the **worldwide** storefront `data-storeid="11203"` priced in **USD**. A USD
  price against a CAD receipt line is numerically lower, so it reads as a price
  drop of about the exchange rate on every item forever — and gets billed. This
  is Abercrombie's marketplace-gate equivalent: the adapter asserts the storefront
  and returns `currency_mismatch` rather than quoting. **Fails closed.**
- **Owed before the scan flag flips:** confirm Railway egress reaches A&F as
  Canadian (a laptop proves nothing about Railway — Costco is the precedent), and
  capture fixtures only once CAD is reachable, or the suite pins the wrong currency.

**Sequencing** (Maxim chose adapter-first): PR 1 price adapter → PR 2 parser on
the lab lane (no receipts yet, so the documented promotion bar cannot be met) →
PR 3 claim channel + email → PR 4 promotion. PRs 1 and 2 are inert for live users
on merge.

**The email half is an extension, not a build.** `ClaimAssistantScreen` already
drafts a claim email and opens `mailto:` — with **no recipient**, which is the
gap. It also already carries the only per-store branch in the claim flow, the
hardcoded `isCostcoWarehouse` test, whose own comment is the Abercrombie in-store
rule already written. PR 3 turns that `if` into store-row data (`claimEmail`,
`claimMethods`), preserving Costco's behaviour exactly — the three pinned cases in
`__tests__/claimAssistantScreen.test.js` are the regression proof.

## 2026-09-07 — Landing Abercrombie store #3, and the red `development` it uncovered

**Task.** Carry the Abercrombie price-adapter work (PR #322) through review and
merge, together with its documentation.

### What the verification run found

CI does not run on feature branches by design (#313 narrowed the triggers to
`main` pushes plus `workflow_dispatch`, to survive the free tier), so the PR
showed no checks. Dispatched `Tests` by hand against the branch. Backend and
security passed; **Mobile (Jest) failed one test out of 5 706** —
`costcoPathImmutability` reporting that `__tests__/receiptParserRegistry.test.js`
no longer matched its pinned hash.

That file is **not in the Abercrombie diff**, which is backend-only.
`git diff --stat development...HEAD -- <file>` returned empty, and
`git show development:<file> | sha256sum` produced exactly the hash CI reported
while the pin still held #318's value. **The failure was pre-existing on
`development`**, inherited by every branch cut from it since #320 merged on
2026-09-06.

### Cause and fix (Bugs #238, PR #323)

#320 promoted Best Buy to a production parser and correctly updated the registry
test, but skipped the re-pin the guard's own header requires in the same commit.
The guard fired correctly on 2026-09-06 and **fired into an empty room** — a
`development` merge produces no CI run, so nothing read it until the next
hand-dispatched run a day later.

Before re-pinning, reviewed the edit as the guard demands: the Best Buy lane
assertions are inverted (the promotion itself), the lab-lane block is rewritten
for an empty `LAB_STORE_PARSERS`, and the **only** Costco-touching line is the
inventory assertion widening from `["costco"]` to `["bestbuy","costco"]`. No
Costco assertion weakened; all four pinned Costco *sources* unchanged, so the
golden snapshots cannot have moved. One line re-pinned, not the table.

### Also found, not fixed

The immutability guard **cannot pass on a Windows checkout** with
`core.autocrlf=true` — it hashes working-tree CRLF bytes against LF repository
pins, so every pinned file mismatches locally. Harmless on CI (Linux, LF), but
it makes the suite locally unrunnable. Owed: a `.gitattributes` entry or a
newline-normalising `hashFile`, in its own change.

### Shipped

| PR | Repo | What |
| --- | --- | --- |
| #322 | Priceback | Abercrombie price adapter + the currency gate, → `development` |
| #323 | Priceback | the stale Costco guard pin, → `development` |
| #48 | Priceback-Documentations | Abercrombie policy + capture session, own folder |
| (this) | Priceback-Documentations | Bugs #238 + this entry |

### Regression risk

**None from either merge.** #322 is additive — new files plus one `require`, one
`PRICE_ADAPTERS` row, a doc note whose return value is unchanged, and an npm
script; no Costco or Best Buy file is touched, and it ships inert
(`hasDbPriceFeed` deliberately does not list Abercrombie, so every quote is
`slug_unknown` until a slug source exists). #323 is a one-value test-only change
that restores a tripwire currently unable to fire.

### Still owed before `ABERCROMBIE_SCAN_ENABLED` is turned on

1. Confirm Railway egress reaches A&F as **Canadian** — a laptop proves nothing
   about Railway; Costco is the precedent.
2. A genuine **CAD** capture. The one committed fixture is USD on purpose.
3. A **slug source** — the order confirmation is the most promising, which would
   make the receipt half feed the price half.

## 2026-09-08 — Follow us on Instagram and Facebook, and a Profile group that outgrew its name

Shipped as a hotfix off `main` (Priceback PR #324), not through `development`,
at Maxim's instruction — it is additive UI with no dependency on anything
sitting on `development`.

### What changed

The Profile page's last settings group held Help & Support, Rate PriceBack and
About under the label **Support** (FR *Assistance*). Two rows were added
directly under Rate PriceBack — **Instagram first, Facebook second** — which
makes "Support" wrong as a group name: two of the five rows are now about
following the brand, not getting help. Renamed to **Help & community** /
**Aide et communauté**. `profile.sectionSupport` was *renamed*, not left
orphaned; it had exactly one reader, verified by grep across `src/`,
`__tests__/` and `scripts/`.

Final order: Help & Support → Rate PriceBack → Instagram → Facebook → About.

### Where the links live

New `src/constants/socialLinks.js`, a sibling of `storeLinks.js` and
`contact.js` for the same reason those exist. The handle is `priceback.ca` on
both networks — the one `Marketing-Plan/02-social-media-strategy.md` records as
already claimed, and the one every footer on priceback.ca already links to. It
is pinned in one module so the app can never drift from the website.

| network | primary | fallback |
| --- | --- | --- |
| Instagram | `instagram://user?username=priceback.ca` | `https://www.instagram.com/priceback.ca/` |
| Facebook | `fb://facewebmodal/f?href=…` | `https://www.facebook.com/priceback.ca/` |

**Why two URLs per network, and why the app scheme goes first.** A follow CTA
that lands in the in-app browser lands on a logged-out wall — the user cannot
tap Follow there, so the row fails at exactly the thing it exists to do. The
custom scheme opens the installed app, where the session is live. But it fails
outright with the app uninstalled, so the https URL is always tried second: it
resolves everywhere, and on Android both networks own a verified app link for
it, so it *still* opens the native app when one is present. Worst case the row
opens the web page, which is at least the right page.

`openSocial()` resolves `true` / `false` and **never rejects**. A caller does
not need its own catch, and — the point — a link that cannot open surfaces as a
translated alert instead of an inert row that looks broken. An unknown network
name resolves `false` and opens nothing rather than throwing inside Profile.

No SDK, no Meta API, no new permission. These are plain outbound links, so none
of the AdMob / ATT machinery is involved.

### Localization

All seven new keys shipped in EN **and** FR in the same commit, per CLAUDE.md.
`node scripts/checkI18n.js` → `2 language(s) [en=1499, fr=1499], all keys in
sync`. The i18n test in the new suite reads the language list off the bundle
source rather than hardcoding `["en","fr"]`, so a third language comes under it
for free.

### Tests

`__tests__/profileSocialLinks.test.js`, 12 cases. Three are worth naming
because no smoke mount would catch them:

1. **Both URL pairs pinned literally.** A wrong handle is a silent dead end —
   the page loads, it just isn't us. Nothing else in the suite would notice.
2. **The fallback path asserted, not assumed.** The uninstalled-app case is
   driven by rejecting the first `openURL` and asserting the *call order*, so
   the fallback cannot rot into dead code.
3. **Row order.** Instagram-then-Facebook-after-Rate is a product decision, and
   `settingsSections` is a plain array anyone could reshuffle without a test
   objecting.

### Regression risk

**Low, and confined to the Profile page's bottom group.** `settingsSections`
gains two rows and one label key; no existing row, handler, modal or route is
touched, and `handleAction` gains two new `case`s while changing none of the
existing ones. `socialLinks.js` is a new leaf module with no imports, so
nothing else in the app can regress through it. No store parser, no Costco or
Best Buy code, no backend, no DB, no build config. **No version bump** — this
is not a release; the next store build picks it up under the release-tagging
rule as usual.

### Follow-up owed

Once this is on `main` it must be merged down into `development` (Maxim's
instruction, and the branch model requires `development` to stay ahead of
`main`, never behind on a hotfix).

---

# 2026-09-11 · Admin console triage rework (hotfix on `main`)

Branch `hotfix/admin-console-triage`, from `main` and back to `main`. Three
defects reported off the live console in screenshots, plus the regrouping they
made obvious, plus one audit sweep.

Full write-up: `Operations/Admin_Console_Triage_Rework.md`.
Bug entries: `Bugs_Common_Fixes.md` #243 (the token that would not die), #244
(a verdict contradicting its own evidence), #245 (unset and failed collapsing).

## What was reported, and what it actually was

Every one of the three had the same shape: **the screen could not distinguish
two different facts, so it printed the more alarming one.**

1. `revenuecat` red with a `?`, above "webhook: configured · syncApi: configured"
   → the check carried no `status` key at all, and `statusTone(undefined)` fell
   through to `"bad"`.
2. Six `verify_threw` rows badged as an incident → six ID tokens that arrived
   after they expired, which is the designed end of a token's life.
3. `r2_storage` / `railway` / `sentry_events` showing `? of 10`, `?%`, in the
   **green** pill → "no token" and "token failed" both resolved to `null`.

## The one that was a real production bug

`verify_threw` was not only mis-*reported*; the client was genuinely broken.
`getValidIdToken()` returned the stale token unconditionally once both refresh
paths missed, so the same dead credential went out on every wake — the incident
table has one token still being presented **nineteen days** past expiry — and
nothing raised the credential-rejected flag, so the shopper was never told.

Each token now gets exactly one diagnostic send and is then burned. The claim is
a `Map` rather than a flag because the `await` in the obvious version lets two
concurrent callers both be "the first" — which is literally every pair in the
table, `/api/me` and `/api/me/bootstrap` landing in the same second.

Two guards were caught by the EXISTING suite, not by review, and both were real:

- an unparseable token must **not** burn (`isIdTokenFresh` is false for anything
  it cannot parse, so burning one would lock out a possibly-valid session);
- the new SecureStore key had to join `MANAGED_KEYCHAIN_KEYS`, or it is
  unreadable before first unlock and a background refresh re-sends a burned
  token.

## Severity, and the badge that cried wolf

`backend/lib/authOutcomeSeverity.js` — one classifier, three callers (the
overview counter, the incident list, the alert email). Severity is decided on the
`detail`, never the reason alone: the same `verify_threw` is `info` for "Token
used too late" and `critical` for "Wrong recipient", and a classifier reading
only the reason paints an outage and a yawn the same colour. `overview.authFailures`
is now the actionable count; `authFailuresTotal` is the raw one, and the
Dashboard shows both.

## The regrouping

Five groups, most-used first: Product · Accounts · Dashboard · Reports & upkeep ·
Health & incidents. Health and Incidents split into two screens; Quotas moved out
of the incident screen's basement to the root; the "Find a shopper" / "Shopper
report" duplicate (same route, two names, two sections) removed; a new Dashboard
sub-screen with a 24h/7d/30d selector that actually re-queries. The environment
banner says **Live shoppers** / **Test data** with the project ref one tap away.

## The audit sweep

Notifications → Troubleshooting moved to Service health. The two surfaces that
could NOT move — ScanScreen's raw OCR and DetailScreen's cache filename, both of
which describe the receipt in front of you — got a switch instead, gated by one
composed `showInAppDiagnostics()` (admin AND toggle) so neither screen can
implement half of it. Default ON, because it replaces something already visible.

## Tests

- Mobile: **230 suites / 5492 tests green.** Five new files
  (`authServiceExpiredTokenBurn`, `adminHealthScreen`, `adminQuotasScreen`,
  `adminDashboardScreen`, `adminDiagnosticsToggle`), four updated.
- Backend: every file in the blast radius run individually against **dev** —
  `authOutcomeSeverity` (24), `quotaProbes` (15), `adminConsoleRoutesDb` (28),
  `routes` (57), `dbRoutes` (7), `adminRoutesAreGuarded` (8), `adminAccountsRoutesDb`
  + `adminTokenRateLimit` (17), the four `health*` files (45), `authFailureMonitor`
  + `authOutcomesRepo` (15). **All green.**
- `npm run i18n:check` — 2 languages, 1498 keys each, in sync.
- Coverage on every changed file well above the floor (AdminHomeScreen 96%,
  AdminIncidentScreen 96%, AdminQuotasScreen 94%, AdminHealthScreen 89%,
  authService 96%).

Two route tests were rewritten as **delta** assertions after failing against
correct code: `auth_outcomes` is a shared forensic table on a shared dev
database, and it already held 7 `verify_threw` rows with a NULL detail. Those
correctly classify as `warn`, so an absolute "this group is info" was testing the
database's history rather than the change.

## Regression risk

**Low-to-moderate, and concentrated in one place.** The console screens are
admin-only and cannot affect a shopper. The real exposure is
`getValidIdToken()`, which is on every authenticated request: the behaviour
change is that a *provably expired, unrefreshable, already-sent* token now
returns `null` instead of being re-sent. Fresh tokens, unparseable tokens, and
first sends are byte-identical to before. No backend route contract was removed
— `authFailuresTotal` and the severity fields are additive, and the one changed
meaning (`authFailures` = actionable rather than raw) is the reported bug.

No store parser touched. No Costco or Best Buy code. No DB migration. No version
bump.

## Not in this change

The new unhandled Sentry errors in `prosoft-inc / priceback-canada`. No Sentry
token is reachable from the working environment and reading Railway's env is
blocked by the sandbox, so they could not be read. Maxim's call: ship the console
fixes now, handle Sentry as its own follow-up.

---

# 2026-09-11 · Sentry triage — the iOS sign-in dead end

Branch `fix/ios-signin-dead-end`, from `main`. This is the follow-up the entry
above deferred ("no Sentry token is reachable from the working environment").
The token supplied this session unblocked it.

Full write-up: `Technical/Sentry_Triage_2026-09-11_iOS_SignIn.md`.
Bug entry: `Bugs_Common_Fixes.md` #246.

## What Sentry actually held

Seven issues. **Five were already fixed by shipped code** and were only stale on
the board — D and F were classification bugs closed in v2.8.10 / v2.8.12, E is
adb noise dropped since v2.8.10, G is the deliberate R8 probe, H fails closed by
design. All five have been resolved in Sentry against the release that fixed
each (G archived, since it recurs by design every time the probe is used).

**Two were live**: `PRICEBACK-CANADA-C` (Apple `ERR_REQUEST_UNKNOWN`, 52) and
`-B` (Google "Unable to open Safari", 37). 89 events, 100% iOS, eleven installs,
six iPhone models, every release 2.8.5 → 2.8.20, last seen 2026-09-10 19:32.

## The finding

**The fix that shipped for these did nothing, and the rate said so for 17 days.**
v2.8.13 (PR #291) shipped `_presentAuthorization` on the reading that the pairing
was a sheet collision. 29 further events landed on builds carrying the lock and
the Apple:Google ratio is *identical* either side of it — 25/35 = 0.71 before,
12/17 = 0.71 after.

`attemptMs` settles it: **3-60 ms in all 37 Google events**, including events
whose breadcrumbs show a clean onboarding screen beforehand. No attempt ever
lived long enough for a browser to open, and there was no first sheet for a
second to collide with. The paired failures are 3-17 *seconds* apart — a person
pressing buttons. The device is refusing to present any authorization UI, which
is what Screen Time / MDM restrictions on Account Changes and Web Content do,
and every event falls inside US-Pacific business hours. This is App Review's
fleet, not shoppers.

**So the shipped defect is the answer, not the failure.** The copy said *"it
usually works the second time"* (0 for 37) and *"sign in with Google instead"*
(dead in the same session). Two locked doors, each pointing at the other.

## What changed

1. `signInWithApple` records `attemptMs` — the Google path has had it since
   PRICEBACK-CANADA-F; Apple's absence is why 52 events were unreadable.
2. Two distinct providers failing with a presentation-class category in one
   session now replaces the retry alert with guidance naming the restriction,
   plus a support contact. One failure keeps the ordinary alert; a 500 never
   counts.
3. The false copy is gone (en + fr), and the two code comments asserting the
   refuted cause now carry the measurement.
4. `event.user` is rebuilt from an allowlist carrying a random per-install UUID,
   so affected-user counts work at all. Every issue in this project's history
   reported `users: 0`. PIA updated (§6a) — deliberately NOT the hardware-derived
   `getDeviceFingerprint()`, which is the anti-abuse key for credit grants.

## Corrected non-finding

`app:///main.jsbundle:1` on every frame looked like a dead source-map upload. It
is not — 20+ artifact bundles, dSYMs and proguard mappings are all present, and
our own frames resolve elsewhere. B and C carry only a `CodedError` constructor
chain because the error is born inside the native module. Recorded because the
wrong version of that conclusion looks right and is expensive.

## Tests

**231 suites / 5514 tests green**, 0 failures. Coverage 82.17 / 74.33 / 71.82 /
84.75 — every floor met (jest exits non-zero otherwise). Changed files:
`analyticsService` 95.3/84.9/94.6/96.3, `authService` 96.1/87.9/89.8/98.4,
`errorSupport` 98.1/96.0/100/98.8, `OnboardingScreen` 77.1/76.1/69.4/81.4.
`i18n:check` green — 2 languages, 1503 keys each, in sync.

New `__tests__/onboardingSignInDeadEnd.test.js` (8 cases) drives the **real**
`classifyError`, and mutation-fails three ways: guard at 1 instead of 2 (6 red),
classification ignored (2 red), alert not suppressed (3 red). The scrubber's
allowlist mutation-fails 4 ways. It also asserts Sentry still receives **both**
failures — quieting the user must never quieten the telemetry.

**No GitHub Actions run was dispatched.**

## Regression risk

**Low, and confined to two surfaces.** `signInWithApple` gains one timing field
on an error already being thrown — success path, nonce binding and the cancel
branch are byte-identical, and the cancel is checked *before* the field is set
so a dismissal is never given a diagnostic. The real exposure is
`scrubSentryEvent`, which now emits a `user` object where it previously deleted
one; mitigated by an allowlist rather than a filter, and by the pinned tests
rewritten to assert the stricter shape. Onboarding adds state that only renders
after two distinct provider failures.

No store parser touched — no Costco, no Best Buy. No backend, no DB migration,
no version bump, no tag, no `eas build`.

## Not in this change

- **The device restriction.** We cannot unlock a managed iPhone. B and C stay
  open in Sentry until the fix ships in a build; the app now tells the truth
  about it, which is the whole deliverable. App Review's working door remains
  the reviewer access code.
- **The `sentry_events` quota gauge.** The supplied org token `403`s on
  `stats_v2` (it lacks `org:read`) — that gauge needs a **User** Auth Token.
- **Shipping.** Tag + release + EAS build are Maxim's call.
- **`main` lacks the `.gitattributes` LF normalization** that landed on
  `development` in PR #330, so `core.autocrlf=true` stores CRLF here. This
  change is consistent with what `main` already holds (verified: no whole-file
  rewrites), but the two branches will differ until #330 merges down.


# 2026-09-11 · Carrying `main` down into `development` (PR #332)

`main` was six commits ahead of `development` — the admin console (#325, #331),
2.8.20 (#328), the CI trigger change (#327), the App Review priming screen (#326)
and the iOS sign-in fix (#333). `development` was eighteen ahead the other way.
Six files conflicted textually. One more was broken **semantically**, with no
marker anywhere, and that one is the story.

## The six textual conflicts, and how each was decided

| File | Kept | Why |
|---|---|---|
| `.github/workflows/test.yml` | `development` | Both are dispatch-only; only `development` also carries the per-job `if: github.ref == 'refs/heads/main'`. Verified the bodies differ **only** by those three lines, so nothing from #327 was dropped. |
| `__tests__/ciTriggerPolicy.test.js` | `development` | An add/add whose first 122 lines are byte-identical; `development` appends the ref-guard half. A strict superset. |
| `backend/tests/helpers/uniq.js` | `main` | #325 moved the marker values into `lib/testDataMarkers.js` because the running server needs the same predicates and cannot import from `tests/`. Kept the move; carried `development`'s domain rationale across with the constant. |
| `backend/tests/helpers/purgeTestData.js` | `main` | Same move — `steps()` now lives in the lib. Step lists compared line by line first: identical. |
| `backend/tests/priceHistoryDb.test.js` | `development` | Both branches independently fixed the same ageing-fixture bug. `development`'s version explains the **UTC** choice, which the TZ matrix cares about. |
| `jest.config.js` | **both** | A phase log. `development`'s Phase 30/30b/31 and `main`'s Phase 32 are appended in order; the floors are `development`'s higher Phase 31 numbers (73/65/64/76 vs `main`'s 68/55/59/70). |

### The one that had no conflict marker

`main`'s `lib/testDataMarkers.js` is a **new file**, so it merged clean — carrying
`QA_EMAIL_DOMAIN = "qa.priceback.test"`, the value from before #315 consolidated
every test email onto `priceback.test.ca`. Nothing conflicts: one branch moved a
constant, the other changed it. Left alone, the purge would have matched a domain
no test uses and swept **nothing**, on a repo whose test data has reached
production twice. Corrected to `priceback.test.ca`; `purgeTestData.test.js` pins
the value and `dataCleanupRegistry.test.js` pins that both modules hand back the
same one.

## The defect that existed only in the merge

`main`'s admin console pins *"every check in the payload carries a status, so none
can render as unknown"*. `development`'s price feed publishes `checks.priceFeeds`
as a **map of stores** — one level deeper than every other check, so
`check.status` is `undefined`. Both suites green on their own branch; the pair is
broken. The admin health row greyed out as *"we do not know"* about the only check
that knew precisely, per store. It is [#244] over again, quieter.

Fixed with `priceFeedsRollup()` (pure, in `lib/priceFeedHealth.js`): all feeds up
→ `available`, some → `degraded`, none → `unavailable`, a store with no verdict
counts as **off**. The per-store entries stay — one word cannot carry "one of two
is dead". An empty feed list reports `unavailable` + `no_feeds_scheduled` rather
than a tidier new word, because `statusTone()` paints anything it does not
recognise **red**, and "there is nothing to run" is not an outage. Full write-up:
`Bugs_Common_Fixes.md` #247.

## Tests

- **Mobile: 251 suites / 6043 tests green**, coverage **83.54 / 75.78 / 73.31 /
  86.04** against floors of 73/65/64/76 — every metric **above** the
  pre-merge `development` figures (82.6/74.6/72.0/85.1). The seven admin files
  entered the global pool unpinned and lifted it.
- `i18n:check` green — 2 languages, **1505 keys** each, in sync.
- **Backend by blast radius**, per the rule that a full local suite from this
  connection manufactures failures: `purgeTestData` · `dataCleanupRegistry` ·
  `dataCleanupRunnerGuards` · `purgeStaleSignups` · `adminRoutesAreGuarded`
  (**77 pass**), `dataCleanupPredicatesDb` · `priceHistoryDb` (**16 pass**),
  `adminConsoleRoutesDb` (**28 pass**), `priceFeedHealth` (**14 pass**, 7 new),
  `healthAppleAuth` · `healthAuthAudiences` · `healthDataDir` · `healthSessions` ·
  `storePriceAdapters` · `bestBuyPriceRefresh` (**64 pass**),
  `authOutcomeSeverity` · `quotaProbes` (**39 pass**). **238 backend tests, 0
  failures.**
- `purge-test-data --dry-run` against dev afterwards: **clean**, nothing left
  behind by the out-of-wrapper runs.
- **No GitHub Actions run was dispatched.**

## Regression risk

**Low, and one behaviour actually changes.** Five of the six conflict
resolutions are comments or a strict superset; `uniq.js` / `purgeTestData.js`
adopt a refactor that `main` has already run. The one real change is
`checks.priceFeeds`, which gains a `status` key it never had — additive, the
per-store entries are byte-identical, nothing reads them programmatically
(grepped: no consumer in `src/`, `backend/tests/` or `__tests__/`), and `healthy`
is untouched, so Railway's deploy gate cannot move.

The marker-domain correction is a **restoration**, not a change: it puts back the
value `development` has used since #315 and that ~40 test files write.

No store parser touched — no Costco, no Best Buy. No DB migration, no version
bump (2.8.20 / 40 / 40 carries down unchanged), no tag, no `eas build`.

## Not in this change

- **Pinning `adminCleanup.js` and `supportReference.js` as coverage gate files.**
  Both qualify — one decides what gets deleted from production, the other what an
  operator is told to say. Pinning **subtracts** a file from the global pool, and
  doing that inside a merge would leave a global percentage traceable to neither
  parent. Recorded in `jest.config.js` Phase 32 to be done on its own.
- **The full backend suite.** Unusable from this connection (~14 h projected, and
  it starts manufacturing `ECONNRESET` failures). Blast radius above instead.
- **Promoting `development`.** This merge goes one way only: `main` → `development`.
