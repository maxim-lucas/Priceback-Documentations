# App Store rejections — the running record

Every App Review rejection PriceBack has taken, what actually caused it, and
what shipped to answer it. One entry per rejection, newest first.

**Why this file exists.** A rejection letter lives in App Store Connect, which
nobody re-reads, and the remedy lands in a commit message nobody greps. The
expensive part of a rejection is not the fix — it is the round trip. So each
entry ends with the durable rule, and §0 below is the checklist that must be
walked *before* every submission, because the second round is usually lost to
something the first round never reached.

---

## 0. Pre-submission checklist — walk this every time

A reviewer stops at the first problem. That means everything *after* the thing
they stopped at is unreviewed, and it is where the next rejection comes from.
Check the whole path, not just the last fix.

**Binary / code**

- [ ] No custom screen appears before an OS permission prompt with anything but
      neutral wording and a single forward route. See rejection #2 below.
- [ ] Every permission is requested from the action that needs it; custom UI
      only ever appears *after* a denial, with a route to Settings.
- [ ] The paywall renders real store prices, and Subscribe is enabled.
- [ ] No subscription copy states or implies a free period ("free", "gratuit",
      "essai", "on us", "N mois offerts") unless a matching introductory offer
      is live in ASC for that product. A discount is stated as a price, derived
      from the live store price. See rejection #1 below.
- [ ] Restore Purchases works and reports honestly when there is nothing to
      restore.
- [ ] Terms of Use (EULA) and Privacy Policy links are on the paywall itself and
      both open.
- [ ] Account deletion is reachable in-app and completes (5.1.1(v)).
- [ ] No feature that is known-broken is reachable in a production build. Gmail
      sync is the standing example — it is off in production on purpose.
- [ ] The app launches from cold three times on a real device.

**App Store Connect**

- [ ] **The IAP products are attached to THIS version.** They are attached
      per-version and do not carry forward. Nothing in the binary can compensate:
      with no products, `Paywall.js` shows a price skeleton and *disables*
      Subscribe, which reads as a broken app.
- [ ] The reviewer access code is in App Review Information → Notes, with the
      instructions from `REVIEWER_NOTES.md`. Both providers fail on review
      devices; the code is the only path that works.
- [ ] The notes also carry the **Canadian-storefront instruction** ("In-app
      purchases are sold on the Canadian App Store only … use a Sandbox Apple
      Account whose Country or Region is Canada"). The five IAPs exist on the
      Canadian storefront only — correct, Canada is the only market — so a
      reviewer on any other storefront gets no products. Since 2.9.0 went live
      (2026-09-17) that is what every run of Apple's own test fleet shows
      (Bugs #280); a reviewer who is not told will find an empty paywall.
- [ ] The App Privacy answers match what the binary actually does. They are
      maintained by hand and nothing syncs them to the build — if the ads lane
      is off, the binary declares no tracking, and ASC must agree.
- [ ] Screenshots match the current build.
- [ ] Support URL and Privacy Policy URL both resolve.

**Google Play Console**

- [ ] **Sign in details carries the reviewer access code** (App content → Sign
      in details), with the Play block from `REVIEWER_NOTES.md`. Never
      "N/A – Google Sign-In only" and never "contact us for an account": Play
      reviewers may not use their own Google account, create one, or contact
      you. See rejection #3 below.
- [ ] Every paid feature is reachable by the reviewer account without buying
      anything — Play reviewers cannot purchase or start a trial. Any new
      subscription gate must be checked against `reviewer:appstore`.

---

## 3. Google Play — "Login credentials are missing" (3.0.2, 2026-09-30)

### What Google said

Policy status → "Play Console Requirements: Violation of Play Console
Requirements". *Login credentials are missing — you have not provided any login
information for the review team.* Evidence: four screenshots ending on our
"Create your account" screen after the Google account picker.

### What was actually wrong

Nothing new in the sign-in code — which is why it looked inexplicable. The Sign
in details declaration had said "N/A – Google Sign-In only" since launch, and
Play's own form says reviewers *"are unable to create accounts, use their own
existing accounts"*. Earlier reviews got through because the reviewers signed in
with their own Google accounts anyway (production holds them:
`<firstname><lastname>.<5 digits>@gmail.com`, four created on 09-27/09-29).

What changed was #374, merged 2026-09-29 04:30 UTC: Price Check and Email Sync
moved behind the Unlimited subscription. Play's fleet signed in at 05:08–05:13
UTC, found premium features locked behind a purchase they may not make, and
filed it as missing credentials.

Two things we suspected and ruled out, with evidence:

- **The data cleanup deleting reviewer accounts** did not cause this. The Play
  fleet uses a fresh account per review, so deleting old ones loses nothing.
  It DID endanger our own reviewer account — `reviewer:appstore` is on
  `@priceback.ca`, matched the company-accounts classifier, and was absent from
  production on 2026-09-30. Now protected in code.
- **The reviewer access code** existed (PR #299) but was iOS-only by design.

### What shipped (3.0.3)

- The access-code link and session on Android, scoped to the reviewer account
  only (`_sessionsActive` in `authService.js`) — every Google user's request
  path is byte-identical.
- `reviewer:appstore` reports a complimentary, non-expiring Unlimited tier
  (read-side only) and is exempt from the single-device claim, so parallel
  reviewers never auto-flag it.
- The account is protected from `dataCleanup` and `staleSignups`.
- Sign in details rewritten from `REVIEWER_NOTES.md`.

### Durable rule

A store's reviewer must be able to reach **every** feature with credentials
**we** supply, on **that** platform, without buying anything. "They can use
their own account" is not a plan on Play, and a new paywall gate is a
review-access change, not just a pricing change.

---

## 1. Guideline 3.1.2(c) — a discount advertised in the language of a free trial

- **Version:** 2.8.20 (40) · **Reviewed:** 2026-09-14
- **Answered by:** 2.9.0 (41), PR #336 · Bugs entry #249
- **Predicted by the entry below.** §2 closes with *"everything past this screen —
  the paywall above all — went unreviewed and will be exercised next round."* It
  was, and this is what they found there.

### What Apple said

> One or more auto-renewable subscriptions are marketed in the purchase flow in a
> way that may mislead or confuse users about the subscription terms or pricing.
> Specifically: the app includes references to a free trial for the subscription,
> but the submitted subscriptions do not include a free trial period.

Their suggested remedy was to create the offer in App Store Connect and wire up
`Transaction.Offer.PaymentMode`. We did the opposite, deliberately — see
*What shipped*.

### What was actually wrong

The letter never names the control, and the first reading in-house was that Apple
had confused the **75 welcome credits** with a subscription trial. It had not.

The screenshot is the **Plan & credits** screen (`ManageSubscriptionScreen`), and
the object of the complaint is a single caption: the **Annual** half of the
billing toggle rendered **"2 FREE MONTHS"** — `paywall.twoFreeMonths`, drawn at
`Paywall.js:358` and `ManageSubscriptionScreen.js:314`.

To App Review, "free months" printed on an auto-renewable subscription **is** a
free-trial claim. `priceback_unlimited_annual` carries no introductory offer, so
there was nothing behind it.

Cleared at the same time, and worth recording because it was the first suspicion:
there is **no** user-visible "free trial" string anywhere in the app.
`FREE_TRIAL_CREDITS` and the `manage.trial*` / `profile.subscriptionSubTrial` keys
are internal names that all render *"Pay-as-you-go (Basic)"*.

**The copy was never wrong about the money — it was wrong about the kind of thing
on offer.** `shared/pricing.config.js` said so in its own comment: *"10 x the
monthly price — 12 months for the price of 10."* That is a discount. Apple has no
objection to accurate comparative pricing; it objects to a free period that does
not exist.

### The second defect, found while checking the arithmetic

`shared/pricing.config.js` hardcodes the annual price at **$49.99**. The
reviewer's screenshot shows **$39.99/year**. The bundled catalog and the screen
the reviewer saw disagreed — so the fixed "2 months" was not merely mis-*framed*,
it was **unverifiable**: at $4.99/$49.99 a year costs ~10 months of monthly
spending, at $4.99/$39.99 it costs ~8.

This is the same bug class `storePrices.js` already carries a scar from — a
hardcoded `monthlyEquiv: "$4.17"` that once rendered a USD figure beneath a CAD
price. **A price claim written into the bundle cannot track what a storefront
charges.** That is why the remedy derives rather than rewrites.

#### Resolved: the two numbers were never in conflict

Maxim confirmed the real prices on 2026-09-14: **$4.99 CAD/month and $49.99
CAD/year.** The reviewer's `$39.99` is the **USD storefront translation** of the
CAD 49.99 tier, not a different price — the same confusion recorded in
`ios-prices-wrong-in-app-store-connect`, where App Store Connect was correct all
along and the tester's region supplied the other number.

Checked in all four places the number is written down; every one already carried
`4.99` / `49.99`:

| Where | Monthly | Annual |
|---|---|---|
| `shared/pricing.config.js` (mobile) | 4.99 | 49.99 |
| `backend/shared/pricing.config.js` (byte-identical) | 4.99 | 49.99 |
| `priceback.subscription_plans`, **dev** `gnedluuylimjwdmtvswl` | 4.99 | 49.99 |
| `priceback.subscription_plans`, **prod** `xjfrlzwonyaorwktnkpj` | 4.99 | 49.99 |

**The seed does not lie, and the DB check was not optional.** `seedTierConfig`
reconciles prices with `coalesce(<existing>, excluded)` — a price already present
in a row is **never** overwritten by a reseed. Had prod held a stale number, the
catalog fix would not have reached it and no amount of re-running the seed would
have. It held the right one; this is recorded so the next person knows the check
is required rather than reassuring.

**And the derivation survives the region split by construction.** `annualSavings`
divides one storefront's annual by *that same storefront's* monthly and refuses
to compare across currency codes, so the US pair (39.99 / 3.99) and the Canadian
pair (49.99 / 4.99) both land on the same claim — 12 months for the price of 10,
`SAVE 16%`. A written-down "2 months" would have been wrong on at least one of
them. That is the whole argument for deriving, demonstrated on the very storefront
mismatch that exposed it.

### What shipped

- **`storePrices.annualSavings(monthlyInfo, annualInfo)`** — derives the saving
  from the two **live** StoreKit prices. Returns null (meaning *render nothing*)
  unless both prices are present, the currency codes match, and a real saving
  exists. The percentage is **floored**, never rounded up. "12 months for the
  price of N" prints only when N lands within 0.15 of a whole month; otherwise the
  percentage stands alone.
- The caption now reads `SAVE {percent}%`. The selected tier's card carries
  *"12 months for the price of {months} — {monthlyEquiv} a month instead of
  {monthlyPrice}."* Both languages, in the same edit.
- Every free-period word left subscription copy: `paywall.subscribeAnnualSub`,
  `manage.switchToUnlimitedAnnual`, `catalog.tier.unlimited.description`, and the
  `description` fallback in **both** `pricing.config.js` copies.
- **Deliberately kept:** `manage.planPaygPrice: "Free"`. Pay-as-you-go is not a
  subscription and genuinely costs $0 — a free *tier* is not a free *trial*. If a
  reviewer ever asks, that is the answer.

### Why it shipped unpinned

Every render test in the repo gives the Unlimited tier `annual: null`, so
`_anyAnnualPlan` was false, the billing toggle never mounted, and **no suite had
ever rendered this control.** A caption can only survive that long if nothing is
looking at it. `__tests__/paywallAnnualBadge.test.js` now gives the tier a real
annual SKU and renders both surfaces, asserting the derived number reaches the
label and that the rejected wording cannot.

### Durable rule

> No subscription copy may state or imply a free period — "free", "gratuit",
> "essai", "on us", "N mois offerts" — unless a matching introductory offer is
> live in App Store Connect for that product. A discount is stated as a **price**,
> and that price is **derived from the live store price**, never written down.

Guarded by `__tests__/noFreeTrialClaims.test.js`, which scans every
`paywall.*` / `manage.*` / `catalog.tier.*` key in **every** language block the
bundle defines, plus the customer-facing strings of both `pricing.config.js`
copies. It carries one justified allowlist entry (`manage.planPaygPrice`) and
mutation assertions proving the pattern actually catches the strings that were
rejected — including the French synonyms a reword would reach for first.

---

## 2. Guideline 5.1.1(iv) — a permission explainer that talked the user into it, and let them out of it

- **Version:** 2.8.18 (38) · **Submission:** `7fee471a-4ab2-4727-a1da-c164231963a3`
- **Reviewed:** 2026-09-09, on an iPad Air 11-inch (M3) — the app is iPhone-only
  (`supportsTablet: false`), so it ran in compatibility mode and rendered fine.
- **Answered by:** 2.8.19 (39), PR #326 · Bugs entry #239

### What Apple said

> The app encourages or directs users to allow the app to access the camera.
>
> - A custom message appears before the permission request, and to proceed users
>   press a "Allow access" button. Use words like "Continue" or "Next" on the
>   button instead.
> - A custom message appears before the permission request, and the user can
>   close the message and delay the permission request with the "Maybe later"
>   button. The user should always proceed to the permission request after the
>   message.

### What was actually wrong

`src/screens/PermissionsPrimingScreen.js` — the first-run priming screen, shown
once after onboarding — had two buttons: **"Allow access"** and **"Maybe later"**.

A pre-permission explainer is *allowed*. Apple's objection is narrower and worth
stating precisely, because getting it wrong in the other direction (deleting the
screen) costs a feature for no compliance gain:

1. The button may not use language that **pushes the user toward granting**.
   "Allow", "Enable", "Grant", "Autoriser" — all out. "Continue" / "Next" — fine.
2. The screen may not offer a route that **skips the OS prompt**. Once the user
   has read the explainer, the prompt must follow.

### What shipped

The screen keeps its explanatory job and loses everything else. It now has
**exactly one control**, it says **Continue**, and every route off it goes
through both OS prompts:

- "Maybe later" and its handler are gone. `perm.allow` and `perm.later` were
  **deleted** from EN and FR rather than re-worded — a key named `later` is a
  label waiting to be re-rendered by whoever edits the screen next.
- `App.js` gives the route `gestureEnabled: false`, and the screen swallows
  Android `hardwareBackPress`. A swipe and a bezel press are skip buttons
  wearing different hats.
- The pre-existing `finally` block that always navigates to Main is what makes
  removing the escape hatch safe: a thrown permission request can never strand a
  user on a screen that now has no exit of its own.

### The audit that came with it

Swept every permission surface in the app. **This screen was the only violation.**
Everything else already did the compliant thing — fire the OS prompt first, show
custom UI only *after* a denial, with a route to Settings, which is precisely
what Apple's own "Next Steps" paragraph recommends:

| Surface | Status |
|---|---|
| Receipt camera, tag camera, VisionKit preflight | compliant |
| All three photo-library pickers | compliant |
| Camera-roll suggestions (the Profile toggle *is* the user action) | compliant |
| Location (warehouse picker) | compliant |
| Android permission rationale | `PermissionsAndroid` only — never runs on iOS |
| ATT | not present in a production binary at all |

### One good signal in the rejection

The screenshot is of a screen that only renders **after** onboarding sign-in. So
the 2.8.16 launch crash (Bugs #228) is genuinely gone from this binary, and the
2.1 "App Review cannot sign in" blocker did not recur — the reviewer got in.

Apple listed no other issue, which means they **stopped here**. Everything past
this screen — the paywall above all — went unreviewed and will be exercised next
round. That is what §0 exists for.

### Durable rule

> A pre-permission explainer may **persuade**, but it may never use "Allow"
> wording on its button, and it may never offer a way out that skips the OS
> prompt — including a back gesture or a hardware back press.

Guarded by `__tests__/permissionsPriming.test.js`, which asserts exactly one
outermost pressable, the camera → notifications → navigate order, and a
forbidden-wording check run against **every language `getSupportedLanguages()`
reports**, so a third locale comes under it the day it is added.
