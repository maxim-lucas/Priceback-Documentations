# Forcing an app update — every installed build, iOS and Android

**Status:** procedure + code (app PR #440 `feat/force-update-every-build`, 2026-10-15).
**Owner:** Maxim. **Related:** `Technical/Backend_Backward_Compatibility.md` (why
the backend may never break an installed build), `Operations/Release_Tagging_And_Repo_Management.md`.

## The constraint, stated plainly

Neither store lets an app update itself silently, and **iOS has no forced-update
mechanism at all**: Apple offers no API for it. EAS OTA is unavailable on our
plan. So "forcing" an update means **making the old build tell the shopper to
update**, using only what that build already knows how to do. What it already
knows depends on the build:

| Installed build | What the server can make it show | Lever (Admin · App version) |
|---|---|---|
| **3.0.7+** | Full-screen, blocking **"Update required"** (EN/FR, store button, back button disabled), at launch and on every return to the app. Stays up offline. | *Minimum build* per platform |
| **2.8.10 – 3.0.6** | A **notification over the open app** each time it opens: *"This version of PriceBack is out of date and won't work properly until you update it. Update it from the App Store."* (EN/FR, right store). With *Refuse builds before 3.0.7* on: **"This version of PriceBack is out of date"** when an action fails, e.g. a receipt scan. | *Update reminder*, then *Refuse builds before 3.0.7* |
| **2.8.3 – 2.8.9** | The same reminder notification. With *Refuse* on, failed actions show a **generic** error: these builds have no "out of date" copy. | Same |

Why a notification for the old builds: no build before 3.0.7 has a screen,
alert or banner whose **text** the server controls. Every build back to 2.8.3
does two things we can use:

- it calls `GET /api/me/bootstrap` as it opens and on every return to the
  foreground;
- it shows a push as a banner **even while the app is open**
  (`setNotificationHandler → shouldShowBanner: true`).

The server answers that launch call with a push, which the phone's OS draws
on top of the app. Checked against the tagged source of 2.8.3, 2.8.10, 3.0.3
and 3.0.6.

### What it cannot reach (the honest gap)

- **Notifications not allowed** (iOS permission refused, Android notifications
  blocked) or **all notifications off inside PriceBack** → no reminder. That
  shopper only sees the refusal errors on actions once *Refuse* is on.
- **Several phones on one account**: the server holds one push token per account
  (the last phone that registered), so an old phone's launch may remind the newer
  phone. The copy works for both, and the newer phone ignores it once it's updated.
- **Signed-out phones**: no account means no push token.
- **Email** would reach shoppers with notifications off. It is **not built and
  not to be sent without Maxim's explicit approval** (2026-10-15). It would also
  need a verified sending domain in Resend and our domain registered with Apple's
  private-relay service, or Sign in with Apple addresses bounce.

## The procedure

### 1. Ship the build that has the update screen (3.0.7+), set up for fast uptake

- **iOS, App Store Connect → the version → *Phased Release for Automatic
  Updates*: OFF** (or tap *Release to All Users* right after release). With phased
  release, iPhones with automatic updates get the build over **7 days**. Without
  it, every iPhone with automatic updates (the iOS default) gets it on its own
  schedule, and everyone can update manually at once.
- **Android, Play Console → the release → roll out to 100%.** Play's automatic
  updates are the default on Android too.
- Tag and release as usual (CLAUDE.md, *Every store release gets a tag*).

### 2. Turn on the update reminder: as soon as the build is live in a store

Admin · App version → **Update reminder (builds before 3.0.7)** → on.
(`UPDATE_REMINDER_ENABLED`, off by default.)

- Every opening of a build before 3.0.7 by a signed-in shopper → one localized
  notification, at most once per `UPDATE_REMINDER_COOLDOWN_MINUTES` (default 30,
  1–1440), so one opening gives one banner, not a burst.
- The store named in the copy comes from the phone's User-Agent (iOS → App Store,
  Android → Google Play, unknown → both).
- It blocks nothing, so it's safe to turn on early. But wait until the new build is
  **downloadable** in a store, or the shopper is told to update to something
  that isn't there yet. If only one store has it, the other platform's shoppers
  are still reminded; turn it on when both are live, or accept that.
- Not sent during **Maintenance mode**.
- Server log line per send: `[update-reminder] sent to xxxxxxxx… (ios)`; the
  admin console's per-account notification history shows `app_update`.

### 3. Refuse builds before 3.0.7: once they have had time to update

Admin · App version → **Refuse builds before 3.0.7** → on.
(`REFUSE_UNREPORTED_BUILDS`.)

- Every shopper-app call from a build that doesn't report itself gets `426`;
  the reminder keeps firing as well.
- **The server checks the App Store itself** (Apple's public lookup, Canadian
  storefront) and refuses to turn this on while the App Store serves anything
  below 3.0.7, or when it can't confirm the version. An iPhone refused with
  nothing to update to would have no way back until Apple approves a build.
  Google Play has no public lookup: **confirm the Android rollout is at 100%
  yourself.**
- Your own phone must run 3.0.7+ (it reports its build), or the switch refuses.

### 4. Later breaking changes: raise the minimum build

Admin · App version → minimum build per platform (3.0.7+ only), as described in
`Technical/Backend_Backward_Compatibility.md` → *When a break is unavoidable*.

## Android: a real in-app update (proposal, next build)

Google Play's **In-App Updates API** (*immediate* flow) shows Play's own
full-screen update and installs it without leaving the app. It needs a native
module in the binary (e.g. `sp-react-native-in-app-updates`), so it only helps
builds that ship it, i.e. **3.0.8+**. It has no iOS equivalent. Not added yet: a
new native dependency is exactly the kind of change that broke Android
production builds before (AdMob, #293/#295), so it needs its own PR, a `device`
profile build and a test on a real phone. The existing "Update required" screen
already covers 3.0.7+ on both platforms.

## Reading the build mix

Whether old builds are draining: Play Console → *Statistics → App version*; App
Store Connect → *App Analytics → Metrics → by App Version*; our API logs
(`appBuild` is null for builds before 3.0.7). Refuse old builds only when those
numbers say the remaining shoppers have had the chance to update.

## Code

- `backend/lib/updateReminder.js`: reminder (cooldown, store from User-Agent),
  unit-tested.
- `backend/lib/appVersionGate.js`: `isUnreportedLaunch`, the `onUnreportedLaunch`
  hook (fire-and-forget, never delays or fails a request), and `UPDATE_MESSAGE`,
  worded so the old builds' text classifier recognises it.
- `backend/lib/appStoreListing.js`: the App Store version check.
- `backend/lib/pushI18n.js`: `updateReminder.*` copy (EN/FR).
- `shared/notificationCategories.js`: `app_update` is the second *exempt* type
  (master switch only). A category switch would let a shopper on an old build
  silence the one message that tells them it's broken, and old builds have no
  switch for a new category anyway.
