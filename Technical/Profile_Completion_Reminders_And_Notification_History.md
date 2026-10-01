# Profile-completion reminders, postal → province, and the admin notification history

*2026-09-30 — hotfix on `main`, branch `hotfix/profile-completion-notifications`.*

Maxim's ask (/goal):

1. A notification asking users — **mainly legacy accounts created without a province** — to complete
   their profile, opening a **full screen to pick the province and postal code**.
2. A notification to complete the **Costco profile**: preferred warehouse + membership type.
3. At **signup, typing the postal code selects the province automatically**.
4. *(added mid-task)* In the admin console, on an account, the **notification history that reached their
   phone** — title and text.

---

## 1–2. The two reminders

| | "Finish your profile" | "Finish your Costco profile" |
|---|---|---|
| `data.type` | `profile_location` | `profile_costco` |
| Fires while | no valid postal code **or** no valid province | no preferred warehouse (code or city) **or** a membership tier nobody chose |
| First one | next day, 11:00 local | two days later, 11:00 local (never the same day as the other) |
| Then | every 7 days while the gap remains, **3 in all** | same |
| Tap opens | `CompleteProfile` | `CostcoProfile` |
| Switch | **Profile setup** (`notifProfileSetup`, default on) — Notifications page, "Scans & updates" group | same |

- **Local notifications**, scheduled by the app (`notificationService.syncProfileNudges`). The server
  sends nothing, so `explicitOnly` does not apply and older binaries are unaffected.
- **Policy is pure** — `src/services/profileNudges.js` (`profileGaps`, `planNudge`); the OS half is
  `syncProfileNudges`. State in AsyncStorage `profile_nudges_v1` (`{ fireAt, sent }` per kind).
- **Runs** at boot (`bootService` drain), at every reconcile (so the switch and a hydrate that restores the
  profile apply at once), and after every save of a watched field (the two new screens, the Profile
  page's warehouse and membership editors). Filling the gap **cancels the pending reminder immediately**
  and resets the count. Signed out, or onboarding not finished → nothing is scheduled; sign-out cancels
  both (`cancelProfileNudges` in `clearAccountScopedLocalState`).
- **"Chose a tier"**: `gold_star` is the default every account starts with, so on its own it proves nothing.
  New pref `costcoMembershipConfirmed` is set by the Profile picker and the Costco screen;
  `executive` counts on its own. It is local-only — a reinstall can cost a Gold Star member one extra
  reminder. Accepted.

### The screens

- `src/screens/CompleteProfileScreen.js` — postal input (live-formatted), 13 province chips, the province
  follows the postal code as it is typed, a manual pick wins until the postal code changes. Save →
  `savePrefs({ postalCode, province, profileComplete: true })`, `syncProfileToBackend({ postalCode,
  province, city })`, re-sync the reminders, back (or `Main` when opened cold from the notification).
- `src/screens/CostcoProfileScreen.js` — the scan screens' own `useWarehouseSelection` +
  `WarehousePickerModal` (so a pick here IS the global preferred warehouse), and the two tier radios.
  Neither tier is pre-selected unless the shopper chose one before. Save → prefs +
  `queueProfileSync({ costcoMembershipType })` (durable outbox, same as Profile).

### Legacy accounts whose PHONE already knows the province

Some phones hold a postal code + province the server never received (the admin console's "Unknown"
province bucket). `syncService` now pushes them on hydrate when the server profile lacks either field
and the phone has both, valid — quietly, fire-and-forget, never clearing anything server-side. The same
path retries a complete-your-profile save that failed offline.

## 3. Postal code → province

`src/utils/postalProvince.js` — dependency-free (so tests that half-mock `storageService` cannot lose it):
`provinceFromPostalCode` works on a partial code (`"K"` → `ON`). First letter decides every province except
**X**, shared by Nunavut (`X0A`, `X0B`, `X0C`) and the Northwest Territories (`X0E`, `X0G`, `X1A`), which
waits for the full FSA. Unknown → `null`, never a guess. Used by SetupStep (signup) and
`CompleteProfileScreen`; both show "Selected from your postal code" when the province came from it.

## 4. The admin notification history

**Table `notification_history`** (migration `0014_notification_history.sql`): `user_sub` (FK, cascade),
`notification_type_id` (FK → `notification_types`, the switch; null only for the exempt `test` push),
`title`, `body`, `from_device`, `client_ref`, `sent_at`. RLS on, no policies. Pruned daily at 03:25 UTC to
**90 days**.

| Writer | What | Where |
|---|---|---|
| Server, per user | every push `sendUserPush` actually hands to Expo (refused ones are not logged) | `server.js` |
| Server, batch | the flyer sweep, the cron price-drop check, the verified-drop drain and the drop-charge push — addressed by token, resolved to the account holding it now | `server.js`, `priceDropNotifier.js` |
| The phone | its **local** notifications (claim reminders, "scans ready", the review follow-up, the local price drop, the profile reminders), reported after they fire | `POST /api/me/notification-history` |

**How the phone knows a local notification fired.** The OS does not say. Every local schedule/cancel in
`notificationService.js` now goes through `scheduleLocal` / `cancelLocal`, which keep a ledger
(`src/services/notificationHistory.js`, AsyncStorage `notification_history_pending_v1`, ≤ 100 entries). A
cancel **before** `fireAt` removes the entry; at flush (boot), an entry past `fireAt` that the OS no
longer holds as scheduled was delivered and is reported, in batches of 50, idempotent on
`ref = <id>@<fireAt>`.

> 🔒 **Limited Use.** A reminder about a Gmail-sourced receipt carries its store/amount/items. The flush
> reports an entry tied to a receipt ONLY when that receipt is found locally and is not Gmail-sourced
> (`utils/receiptSource.isGmailSourcedReceipt`); a missing receipt, or an unreadable receipt store, fails
> closed. Pinned by `__tests__/notificationHistory.test.js`.

**Endpoint validation** (`backend/lib/notificationHistoryReport.js`): ≤ 50 entries, `ref` ≤ 160 chars, a
type the shared registry knows, title/body trimmed to 500, `firedAt` not in the future (10 min slack) and
not older than 31 days. A bad entry is dropped; only a malformed body is a 400. No account row → `stored:
0`, and never an upsert (that would run signup side effects from a logging call).

**Admin read**: `adminConsoleRepo.userReport` → `notifications` (latest 100, newest first, with the switch's
label). The account page shows a **Notifications → Notification history** accordion: time (UTC), "Sent by
the server" / "Scheduled on the phone", the switch, the title, the text. The copied support summary
counts them.

**What it cannot show**: anything sent before this release; a local notification on a phone that never
opens the app again (it is reported on the next boot); whether the OS actually displayed a server push
(Expo accepted it — delivery receipts are not read).

---

## Deploy

1. **Production DB: apply `0014` by hand** before (or right after) the backend deploys — prod's drizzle
   ledger is hand-maintained, never `db:migrate`. Run the file, then insert the ledger row with the file's
   **LF** hash:
   `b58aa39fbb597d7745861ab84a05ac5411a0a0e0ac0a7e2ea68e3f84207cdb4c`, `created_at 1790600000000`.
   The code is safe in either order: writers swallow their errors, the admin read returns `[]`.
   Dev (`gnedluuylimjwdmtvswl`) was applied 2026-09-30.
2. `notification_types` gains `notifProfileSetup` on the next backend boot (the seed upserts).
3. The mobile half ships in the next store build (no OTA on this plan).

## Tests

Mobile: `postalProvince`, `profileNudges`, `notificationServiceProfileNudges`, `notificationHistory`,
`completeProfileScreens`, `adminNotificationHistory`, new cases in `syncServiceHydrate`; routing count
24 → 26 and the drift guard now reads `profileNudges.js`; the signup test asserts the auto-selected
province. Backend: `notificationHistoryReport`, `notificationHistoryDb` (end to end on the dev DB).
