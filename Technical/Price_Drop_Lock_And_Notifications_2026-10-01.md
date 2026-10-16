# Price-drop lock, notification clean-up and the admin review desk (2026-10-01)

App branch `fix/notifications-paywall-admin-review` (off `main`). Docs branch
`docs/notifications-paywall-admin-review`.

## What Maxim asked

> disable the price drop credits used · disable the flyer deal on product ·
> price drop on recent purchase: hide the now price, show only the save part,
> severity depends on how many days are left to claim · add (if it doesn't exist)
> "your account balance is low, buy credits or subscribe to … save more" ·
> the user doesn't know what product or price dropped before he subscribes or has
> sufficient credit; without the balance to unlock it he hits a paywall ·
> admin: a notification when there are price drops to review; select, accept or
> reject several at once; a button to open the full receipt; the account balance
> before deduction. Mid-task: the locked subscription buttons must be tappable and
> open the subscription paywall, and the user must understand what happens (icon,
> tip, …).

### Decisions Maxim made (asked, not assumed)

| Question | Answer |
|---|---|
| Branch | new branch off `main` |
| "Disable" the two pushes | **stop sending entirely** (code gated off, not deleted) |
| When does the low-balance nudge fire | **when a drop is found that the balance cannot cover** |
| How does an unaffordable drop work | **charge into debt as today, but hide the details** — *"he can't see the full details to claim at Costco, but he should see the price drop and the amount and eventually the remaining days left to claim"* |
| Hide in the app too? | **yes, free accounts only** — *"subscribers don't have any locks because they aren't credit based"* |

⚠️ This **changes** a recorded decision only in what is *shown*: the 2026-07 audit
recorded "drop-charge driving a balance negative is INTENTIONAL (commission debt)".
The debt itself is unchanged — commission is still charged at detection, exactly
once (see `commission-charged-once`). What is new is that a free account in debt
no longer sees which item dropped.

## The lock rule

```
locked = NOT a subscriber (credit-exempt)  AND  balance < 0
```

One rule, two implementations kept in step:

| Side | Where | Balance read |
|---|---|---|
| Server push | `backend/priceDropNotifier.js` `isRevealLocked` / `_lockedBuyers` | `users.scan_credits` **after** the drain's charge commits |
| App screens | `src/services/dropLock.js` `isDropRevealLocked` / `useDropLock` | cached premium flag + `getLastKnownBalance()` (no network on focus) |
| Local notification | `notificationService.isDropRevealLockedNow` | same cached values |

Unknown balance = **unlocked** everywhere. The charge has already happened; hiding a
paying shopper's drop because a read failed is the worse error, and the unlocked
copy no longer carries a price anyway.

Exactly zero is **not** locked.

## Notifications

| Notification | Before | Now |
|---|---|---|
| "💳 Price-drop credits used" (`price_drop_charge`) | sent after every billed drain | **not sent**. The debit is unchanged and visible in the credit history. The type left the registry and the router; the `notifDropCharge` switch stays (same precedent as `notifOtherCredit`). |
| "Flyer deal on {item}" (`flyer_drop`, `runFlyerSweep`) | named the item and its new price, unbilled | **off** (`FLYER_DEAL_PUSH_ENABLED = false`). The verified-drop sweep still runs after every flyer import and covers the same drops, billed. The sweep body is kept; tests drive it with `{ force: true }`. |
| "Price drop on a recent purchase" (`verified_price_drop`) | `Now $13.99 (save $6.00). Verified by …` | `You can save $6.00 · 12 days left to claim. Verified by …` — **no new price**, in text or (when locked) in the payload |
| …locked variant | — | `You can save $6.00 · 12 days left to claim. Your balance is too low to see which item — buy credits or subscribe to PriceBack Unlimited to unlock it.` `data.locked = true`, no `currentPrice` |
| App's own local drop notification (`price_drop`) | named the item | locked accounts get `🔒 Price drop on a recent purchase` + saving + how to unlock; no item |
| Low balance (`low_balance`, server) | "Top up to keep scanning…" | "Buy credits or subscribe to PriceBack Unlimited to keep scanning and save more on price drops." (same trigger, still default-off) |
| Home low-balance banner | only when the user set a warn level | **also always when the balance is below zero**: "Your balance is below zero — buy credits or subscribe to see your price drops and save more" |

### Severity = days left to claim

Same tiers as the app's chips (`trackingWindow.urgencyTier`, > ⅔ green, > ⅓ yellow,
else red), counted on the buyer's province day:

| Tier | Title | Expo `priority` |
|---|---|---|
| 🟢 green | `🟢 Price drop on a recent purchase` | `default` |
| 🟡 yellow | `🟡 Price drop on a recent purchase` | `high` |
| 🔴 red | `🔴 Last days to claim a price drop` | `high` |

The body always carries the days left (`1 day left to claim`, `N days left…`,
`last day to claim`; FR `il reste N jours pour réclamer`), and `data.daysLeft`.
`channelId: "price-drops"` (the MAX-importance Android channel the app creates).

## In the app (free account below zero)

`maskReceiptForLock` is **display-only**: the stored receipt keeps its drop, so
buying credits shows it immediately and no claim is ever lost.

- **Detail**: the hero still counts the drops and their total; a **Locked card**
  (lock icon, "A price drop was found", "You can save $X", days-left chip in the
  urgency colour, a one-line tip explaining why the item is hidden, **Unlock**
  button). The "Now $x" card, per-line drop chip, claim buttons, claim-email CTA and
  "Check prices now" (whose results would point at the line) are hidden. The
  dropped line is not highlighted.
- **Home**: the same card above Tracked products; the dropped item is listed as a
  plain watched product (no chip, no saving, not sorted first).
- **Tracking → Products**: card above the list; the item shows as watching. The
  Receipts view keeps its per-receipt saving (it does not name an item).
- **Unlock** → the paywall with reason `drop_locked`.

## Paywall reasons (the "tappable lock" ask)

`src/services/paywallNav.js` `openPaywall(navigation, reason)` pushes a fresh Scan
screen hosting the paywall (close pops straight back). `Paywall` takes `reason`:

| Reason | Opened from | Hero |
|---|---|---|
| `drop_locked` | the Locked card | 🔒 "Unlock your price drop" + why it's hidden |
| `price_check` | the locked **Price Checker** scan-mode segment | barcode icon, "Price Checker is part of PriceBack Unlimited" |
| `email_sync` | the locked **Email Sync** profile row | mail icon, "Email Sync is part of PriceBack Unlimited" |

Both locked controls keep their lock icon and are now tappable (the segment also
has an accessibility hint). Before, PR #374 made them dead controls.

## Admin console

- **Alert**: when a sweep stages NEW drops while review is required, every admin
  gets `price_drop_review` ("N price drops are waiting for review"), coalesced over
  60 s so a 13-province flyer fan-out is one push. Category `notifAdminAlerts`; tap
  opens Admin · Price-drop queue. Hook: `priceDropNotifier.setStagedListener`,
  sender `server.js sendPriceDropReviewAlert`.
- **Multi-select**: checkbox on every decidable card, Select all / Clear, "Approve
  selected" / "Reject selected" behind a confirmation. One call:
  `POST /api/admin/price-drop-queue/bulk { ids, decision }` (1–200 ids) →
  `priceDropQueueRepo.reviewMany` (one UPDATE, same from-status rule as the single
  route), one drain after an approval. Rows past deciding come back as `skipped`.
- **Open full receipt** on every card → `AdminReceiptDetail`.
- **Balance**: `GET /api/admin/price-drop-queue` items now carry `balanceBefore`
  (now, before this drop's charge), `balanceAfter`, `creditExempt`. The card says
  "Balance now X credits → after this drop Y", in red with "the shopper will see
  this drop locked" when Y < 0; subscribers read "not charged".

## Not changed

- Commission arithmetic, once-only guarantees, the review queue's lifecycle and
  FIFO, the legacy scrape sweep (`price_drop`, signed-out devices — it still names
  the item; it is unbilled and has no account to lock).
- No migration.

## Known gaps

- The app's lock reads the **last known** balance. After a top-up it unlocks as
  soon as the app re-reads the balance (the paywall's purchase path does), but a
  balance changed on another device is seen on the next balance read.
- A brand-new free account (75 welcome credits) is locked by its first drop of
  more than $5 (75 ÷ 15). That is the intended paywall, but worth watching.
- iOS `interruptionLevel: time-sensitive` was not used (needs an entitlement).
