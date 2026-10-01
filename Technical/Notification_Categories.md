# Notification categories — every notification has a switch

Added 2026-09-25 (branch `feat/reengagement-notifications`, PR to `main`).

> **The rule** (Maxim, 2026-09-25): *"all notifications must fall in a category
> that can be disabled in the notifications configurations (should be the same
> for all notifications in th app)"*. No notification reaches a user unless it
> belongs to a switch on **Profile → Notifications**, and the mechanism is the
> same for every one of them.

Also in this change: the **re-engagement notifications**. "Scan your first
receipt", the weekly "Shopped at Costco this week?", the monthly recap, the
referral nudge, and the offline-scan review follow-up.

---

## Why a registry

Before this change:

- **Categories were string literals at each call site.** The four lists that
  must agree were kept in step by comment only:
  - mobile `DEFAULT_PREFS` / `NOTIFICATION_PREF_KEYS`;
  - the server's `_NOTIFICATION_PREF_KEYS`, which silently drops unknown keys;
  - the seeded `notification_types`;
  - the switch rows on the screen.
- **Five notifications had no switch of their own:**

| Notification | Before | Now |
|---|---|---|
| "Your price-tag scan is ready" (local) | master switch only | **Scans ready to review** |
| "Your receipt scan is ready" (local) | master switch only | **Scans ready to review** |
| "Remind me tomorrow" claim snooze (local) | **no gate at all**, and no id, so nothing could cancel it | **Claim-window reminders** + id `expiry-snooze-<receiptId>` |
| Store launch (server) | category existed, **no row on the screen** | **New store launches** row |
| Admin "Price tag awaiting review" (server) | master switch only | **Admin alerts** (shown to admins only) |

---

## `shared/notificationCategories.js`

It is mirrored byte-for-byte into `backend/shared/` by
`backend/scripts/sync-shared.js`; `sharedMirrorParity.test.js` pins the copy.

| Category (`code` = pref key) | Default | Flags | `data.type`s | Screen group |
|---|---|---|---|---|
| `notifUrgentClaims` | on | | verified_price_drop, price_drop, flyer_drop *(flyer_drop not sent since 2026-10-01)* | Price drops |
| `notifClaimReminders` | on | | expiry_early, expiry_warning, expiry_final (+ the snooze) | Price drops |
| `notifDailyDigest` | off | | daily_digest | Price drops |
| `notifDropCharge` | on | | *(none since 2026-10-01 — "credits used" push retired; switch kept, like `notifOtherCredit`)* | Credits & rewards |
| `notifFriendJoins` | on | | referral_settled | Credits & rewards |
| `notifFlaggedVerified` | on | | tag_verified | Credits & rewards |
| `notifOtherCredit` | off | | *(no sender — pre-existing switch, kept)* | Credits & rewards |
| `notifLowBalance` | off | | low_balance | Credits & rewards |
| **`notifScanReminders`** | on | explicitOnly | **first_receipt, scan_reminder** | Scans & updates |
| **`notifMonthlyRecap`** | on | explicitOnly | **monthly_recap** | Scans & updates |
| **`notifScanResults`** | on | | tag_scans_ready, receipt_scans_ready, **scan_review_reminder** | Scans & updates |
| `notifStoreLaunch` | on | | store_launch | Scans & updates |
| **`notifProfileSetup`** *(2026-09-30)* | on | | **profile_location, profile_costco** (local) | Scans & updates — see `Technical/Profile_Completion_Reminders_And_Notification_History.md` |
| **`notifGuarantee`** | on | explicitOnly | **guarantee_earned, guarantee_renewal_reminder, guarantee_ending** | Your plan |
| `marketingPushConsent` | **off** | consent | **referral_nudge** | From PriceBack ("Tips & offers") |

`notifGuarantee` (2026-09-25) carries the three Price-Drop Guarantee pushes sent by
`backend/jobs/priceDropGuarantee.js` — service messages about the customer's own
plan (not marketing, so not behind the consent switch), `explicitOnly` because they
shipped after binaries without the switch were installed. All three route to the
app's `Guarantee` screen. See `Technical/Price_Drop_Guarantee.md`.
| **`notifAdminAlerts`** | on | adminOnly | tag_review, **price_drop_review** *(2026-10-01)* | Admin (admins only) |

The master switch is `notificationsEnabled`. **The one exempt type is `test`**,
the admin console's "Send test" diagnostic. It is sent only on an explicit tap,
and gating it would make the diagnostic lie.

`settingCodes()` returns the master plus every non-consent category. It is the
list three things are derived from, not hand-copied:

- `PUT /api/me/profile`'s whitelist;
- the app's `NOTIFICATION_PREF_KEYS`;
- the seed, which is pinned to it by a test.

### The gate — the same everywhere

- **Server:** `sendUserPush` (backend/server.js) derives the category from
  `data.type` through `categoryOf`. It **refuses** a type with no category.
  - A `category` argument from the caller is still accepted, but a
    disagreement is logged and **the registry wins**.
  - A consent category additionally goes through `filterMarketingByConsent`,
    which fails closed and was never wired before. It is sent with
    `kind: "marketing"`; everything else is `kind: "transactional"`.
  - The bulk price-drop senders were already category-gated and are unchanged.
- **App:** every local sender calls `isAllowed(prefs, type)`. For transactional
  categories, unreadable prefs fail **open**: a suppressed price drop is a
  missed refund. For the consent category, they fail **closed**: only an
  explicit `true` sends. A type with no category never fires.

---

## Old binaries never receive a notification they cannot switch off

The backend deploys the moment `main` merges, while the app binary with the new
switches ships at the next store release. So the two server-sent re-engagement
categories are **`explicitOnly`**. The job selects a user only when their
`user_notification_settings` has an **explicit, enabled row** for the category.

An older app never writes that row, so it is never selected. This is
fail-closed on purpose, the opposite of the transactional alerts: a missed
reminder costs nothing, while an unswitchable nag costs trust.

The row is written by **`syncNotificationSettingsOnce`** (src/services/syncService.js):

- After a hydrate that carried the server's settings, the new app queues its
  **full** switch set through the durable profile outbox. That is the same
  payload a toggle sends, using the values the hydrate just folded.
- It runs once per account (the marker lives in the account cache, which
  sign-out and reset wipe), and again only when the binary learns a new
  category.

The referral nudge is gated by the **marketing consent** instead. On
2026-09-25 prod had 22 `marketing_push` events, **all `granted=false`**, and
only the new "Tips & offers" switch can grant it.

---

## Consent classification (decided by Maxim, 2026-09-25)

- **Service reminders, ON by default:**
  - the scan reminders and the monthly recap;
  - they are factual and about the user's own receipts;
  - no offer, no price, and no "free" wording (the 3.1.2(c) lesson).
- **Marketing:** the referral nudge. It needs a recorded `marketing_push` grant,
  given through "Tips & offers" (the CASL express-consent copy is on that row).
  - That switch is always usable, even with the master switch off.
  - Toggling it records a consent event (source `settings_screen`), never a
    setting.

The reasoning is also recorded next to the CASL note at
`src/services/storageService.js` (`marketingPushConsent`).

---

## The re-engagement job — `backend/jobs/reengagement.js`

- **When:** a daily cron at 17:00 UTC (≈ 1 PM ET / 10 AM PT). There is also a
  boot catch-up 3 min after start, because a deploy across 17:00 would
  otherwise skip the day. After 22:00 UTC the slot is let go (`too_late`), so
  nobody gets a push at night.
- **Once per slot:** `kvStateRepo.claim("job:reengagement:slot", "<UTC date>")`
  is a single-statement election, so deploy overlap (old and new process both
  running the cron) or a catch-up can never run a slot twice. All day maths use
  the **slot instant**, never the wall clock.
- **Stateless:** no ledger table and no migration. Each audience is a fixed
  function of the slot.

| Pass | Audience (all: active, token, master not off) | Sends |
|---|---|---|
| Referral nudge | first-ever price-drop notification sent in `[slot−48 h, slot−24 h)`; latest `marketing_push` = granted; never referred anyone; `REFERRAL_REFERRER_CREDITS > 0` | once per user, ever |
| Monthly recap | slot on the 1st; explicit `notifMonthlyRecap` row; ≥ 1 live receipt uploaded last month (America/Toronto) | once a month |
| Scan reminders | explicit `notifScanReminders` row; `days = floor((slot − anchor)/1 day)` is a positive multiple of `SCAN_REMINDER_DAYS` (7) | every 7 days of silence |

- **The scan-reminder anchor** is the newest receipt `created_at`,
  **soft-deleted receipts included** because an upload happened. With no
  receipt it is the account's `created_at`. Zero receipts ever gives
  `first_receipt`; otherwise `scan_reminder`.
- **At most one per user per slot.** The one-shot messages win (referral nudge,
  then recap), and a scan reminder that loses the day waits for its next grid
  point.
- **Failures:** a failed query fails the run in `job_runs` (job name
  `reengagement`), but only after the other passes have had their turn.

### Copy (backend/lib/pushI18n.js, EN + FR)

- **Stores:** copy names the **live stores** (enabled AND visible), **Costco
  first**. Names go through a code-keyed overlay; the DB name is only the
  fallback.
- **`first_receipt`:** "🧾 Scan your first receipt" / "Snap your next {stores}
  receipt — PriceBack watches every item for a price drop you can claim."
- **`scan_reminder`:** the title always leads with Costco: "🛒 Shopped at Costco
  this week?". Other live stores join the body: "…your Costco receipt — or
  your Best Buy one —…". If Costco is not live, the title is neutral.
- **`monthly_recap`:** "📊 Your {month} with PriceBack". Receipts come **first**,
  then items. The price-drop part appears **only** when there was a drop:
  "4 receipts and 42 items scanned — 3 price drops found (worth $18.40)."
  - "items" are non-deleted, non-ignored lines of last month's live receipts.
  - drops are distinct lines notified last month, priced at the deepest drop:
    (unit paid − lowest notified price) × quantity.
- **`referral_nudge`:** "🎉 You found your first price drop" / "Invite a friend
  with your code: after their first purchase, you and your friend each get 15
  bonus credits." The wording follows the configured amounts and the real
  settlement rule: the code is entered at sign-up, and both are paid on the
  friend's first purchase.
- **Android channels:** the server names `scan-reminders` (scan reminders) and
  `updates` (recap, referral). The app creates both in `ensureAndroidChannels`.

### Settings (app_config)

- `REENGAGEMENT_PUSHES_ENABLED` (default `true`) is the kill switch; only an
  explicit off turns it off.
- `SCAN_REMINDER_DAYS` (default `7`) must be a whole number ≥ 1. Anything else
  (including `""` and `0`) falls back to 7.

---

## The review follow-up (local, "Scans ready to review")

It is one reminder 24 h after a batch of offline scans became reviewable, if
they are still waiting: "⏳ 2 receipts you scanned offline are ready for your
review."

- **Queue sync:** both offline queues call
  `notificationService.syncScanReviewFollowUp` after every mutation (processed,
  submitted, discarded, retried, cleared at sign-out).
- **Rescheduling:** a count change keeps the **original fire time**. Nothing
  left to review, or the switch turned off, cancels it.
- **Once per batch:** it fires once, and is re-armed only when more scans join
  the queue.
- **Reconcile:** it is re-derived from the queues at boot and on reconcile, in
  case a process died between a queue write and its sync.

---

## Operations

- **Inert until the app ships.** Until users run an app version with the new
  switches, the job finds no explicit rows and sends nothing (`sent` all zeros
  in the log line `[Reengagement] slot …`). That is the expected state after
  the backend deploys.
- **To stop everything**, set `REENGAGEMENT_PUSHES_ENABLED=false` in `app_config`
  (picked up within 5 min).
- **Job health:** Admin → Incidents (the `job_runs` table), job `reengagement`.

## Known limits (documented, not fixed here)

- **Gmail-imported receipts** are local-only by design (Limited Use), so they
  never count as an upload.
- **Send time** is one UTC slot, not per-user time zones. It is daytime in every
  Canadian zone.
- **A day the backend is down for the whole 17:00–22:00 UTC window is skipped**
  (at-most-once), as with every other push this server sends.
- **The snooze of an item claimed after snoozing still fires the next morning.**
  This is pre-existing; the snooze now has an id, so fixing it is a small
  follow-up.
- **`notifOtherCredit` has no sender.** Removing the visible switch is its own
  decision.

## Adding a notification

1. **Register the type.** Add it to a category in
   `shared/notificationCategories.js` (mirror into `backend/shared/`). A new
   category needs four more things, and the tests list any that are missing:
   - its seed row (`backend/db/seed.js`, same default);
   - a `DEFAULT_PREFS` entry;
   - a row in `NOTIFICATION_GROUPS` (`src/screens/NotificationsScreen.js`);
   - labels in every language.
2. **Add the sender** with a literal `data: { type: "…" }`, and add the type to
   `ROUTES` (`src/services/notificationRouting.js`).
3. **Server-sent to existing users?** Make the category `explicitOnly` and select
   on the explicit row, as `repos/reengagementRepo.js` does.

Tests that fail if a step is skipped:

- `__tests__/notificationCategories.test.js`
- `__tests__/notificationRouting.test.js`
- `__tests__/notificationsScreenDurableSync.test.js`
- `backend/tests/notificationCategoriesRegistry.test.js`
- `backend/tests/pushI18n.test.js`
