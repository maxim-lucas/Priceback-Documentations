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
      neutral wording and a single forward route. See rejection #1 below.
- [ ] Every permission is requested from the action that needs it; custom UI
      only ever appears *after* a denial, with a route to Settings.
- [ ] The paywall renders real store prices, and Subscribe is enabled.
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
- [ ] The App Privacy answers match what the binary actually does. They are
      maintained by hand and nothing syncs them to the build — if the ads lane
      is off, the binary declares no tracking, and ASC must agree.
- [ ] Screenshots match the current build.
- [ ] Support URL and Privacy Policy URL both resolve.

---

## 1. Guideline 5.1.1(iv) — a permission explainer that talked the user into it, and let them out of it

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
