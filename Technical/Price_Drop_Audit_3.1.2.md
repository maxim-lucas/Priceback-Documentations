# Price-drop audit before 3.1.2 (2026-10-17)

**Asked (Maxim, /goal):** *"run a full audit to make sure that all the price drops, notification, locked
price drops, ...etc all this logic has everything covered to avoid problems in the production, this is a
live feature and we cant have all these problems. i want to ship the 3.1.2 today stable version."*

**Branch:** app `fix/drops-audit-3.1.2` off `main` (2ae11f3 = v3.1.1 + #450) · docs `docs/drops-audit-3.1.2`
· **Migration:** 0027 · **Bugs:** #328–#334 · Scope: audit + fixes merged to `main` (no bump, tag or build today).

## Maxim's decisions (this audit)

| Question | Decision |
|---|---|
| An approved drop whose push can't be delivered (alerts muted, no push token) | *"any drop should be always approved by the admin or based on the admin console settings, any drop always should be charged (not depending on user preference). a drop = charge user."* Reverses the 2026-06-15 rule "a muted shopper's drop stays pending". |
| A drop whose claim window closed unclaimed | *"a claimed price drop and expired price drop should be flagged claimed so the hero card in the app show that this drops has been saved."* Locked ones included (option 2: a locked drop is paid → unlocked, or never paid → still counts). Auto claims are marked apart (`claim_source = 'expired'`). |
| Duplicate receipts | *"a duplicate receipt should be notified in the admin console and for the user to deletion, if total, date, tax, subtotal and items number and warehouse are the same in both receipt."* In-app banner, no push. **No detection change**: both copies can still drop until one is deleted. |

## Production baseline (read-only SQL, 2026-10-17)

- Money invariants **hold**: 33 notified drops / 15 shoppers / 33 `drop:` charges; 0 duplicate charge refs;
  0 charge without a notification, 0 notification without a charge; every commission = the telescoped
  `dropChargeCredits(paid − lowest)`; every live drop's stored position = its live index.
- Queue: 32 sent, 1 pending (#130, created 2026-10-17 12:10 — awaits review), 1 rejected, 1 superseded.
- Switches: `PRICE_DROP_PUSH_ENABLED` on, `PRICE_DROP_REVIEW_REQUIRED` on, `RELEASED_DROPS_GATE` on,
  **`PENDING_CLAIMS_REMINDER_ENABLED` off since 2026-10-15** (still off), `UPDATE_REMINDER_ENABLED` off.
- Locked pushes since 2026-10-08 carry no product (checked in `notification_history`).
- Live builds (last 14 days): Android 3.1.1 / 3.1.0; iOS 3.1.0 / **3.0.6 (13 shoppers)** / 3.0.5; 150
  accounts never stamped (older Android or inactive). 3.0.7 never shipped: **build 50 (3.1.0) is the first
  build that shows server-released drops**.
- Reach: 175 accounts, 27 with no push token (2 of them on build ≥ 50), 0 with drop alerts muted.
- Duplicates: 3 live pairs for one shopper (no drop on them).
- Three charged drops (75 + 105 + 105 credits) sit on a receipt deleted on 2026-10-11 (`w7a4m`); the debt
  stands, as for any deleted receipt.

## Sound, and kept

The charged-once guarantee (`priceDropRepo.recordNotified`: per-line advisory lock before the prior-minimum
read, `ON CONFLICT (receipt_item_id, price)`, telescoping charges); `shared/claimDeadline.js` (calendar days,
fails closed, backend mirror byte-identical); no item name in any push field in any language; English
fallback never blank; live-index `position` everywhere on the server.

## Findings and fixes

### Backend (deploys with the merge; additive for every live build)

| # | Finding | Fix |
|---|---|---|
| B1 | A drop was charged only when a push could be delivered: findNotifiable required `push_token IS NOT NULL`; the drain elected only `Expo.isExpoPushToken && notifUrgentClaims`; a muted shopper's drop claimed in the app closed unbilled. A shopper who never allowed notifications got no drop at all — not even in the app. | "A drop = a charge": record + charge whenever the exemption is known; push only when deliverable (`priceDropNotifier._deliver`). Detection reaches `push_token IS NOT NULL OR app_build ≥ 50`. **Old-build guard:** a shopper on build < 50 or unreported keeps the push-only rule — they could not see an in-app drop. |
| B2 | `releasedForUser` listed approved-but-uncharged queue rows: shown free and **unlocked on an account below zero** (`locked` only reflected a charge). | Released = charged (`price_drop_notifications`). Shown ⇔ charged; a paused drain shows nothing new. |
| B3 | The locked push carried `position`: the app opened the receipt on the hidden line. | No `position` on a locked push (every build already handles a missing one). |
| B4 | Charged drops stayed "open" forever past the window: a Claim button on an expired receipt; on a locked account an "Unlock" row for a drop no till would honour. | Migration 0027 (`claim_sources` lookup + `receipt_items.claim_source_id`). The price sweep flags a charged, unclaimed drop whose store window passed as claimed (`claim_source='expired'`, `claimed_savings` = what the shopper was told), then files the receipt under claimed. Shopper claims are stamped `'shopper'`. Switch `AUTO_CLAIM_EXPIRED_DROPS` (default on). |
| B5 | Duplicate receipts undetected. | `lib/duplicateReceipt` (one SQL predicate): `duplicateOf` on every receipt of the bootstrap / receipt list and on Admin · Receipt, and a `duplicate_receipt_review` admin alert (Admin alerts switch). |
| B6 | Two lines sharing a stored position could swap between the receipt list (`ORDER BY position`) and every line index the app receives (`position, id`). | Every receipt-line read orders by `(position, id)`. |
| B7 | Stale comments in the notifier (legacy sweeps; "no token is retried"). | Corrected. |

### App (ships in 3.1.2)

| # | Finding | Fix |
|---|---|---|
| A1 | The lock read only the phone's cached balance; the sync never refreshed it (> 7 days old = unlocked). A shopper whose last balance read predated the charge saw the item. | `_hydrate` stores the bootstrap's `credits.balance` as the lock's snapshot (`purchaseService.noteServerBalance`). |
| A2 | Tapping a locked alert opened the hidden line, and rendered before any balance read. | `dropDetail` ignores `position` on `locked` alerts and sets `lockedAlert`; the screen holds the lock until the server speaks again: a live `/api/me/credits` read (retried on every focus), any fresh balance or subscription written meanwhile (a purchase, the bootstrap), or an active subscription. Offline with none of those: stays locked. |
| A3 | `useDropLock` mounted unlocked: the first frame could show the item. | Mounts with the last computed state; overlapping reads — the last one started wins. |
| A4 | #450 was still identifiable: a tapped locked line became the hidden row alone, the hidden row sat in the line's own place, the focus ring skipped a locked line. | Hidden rows grouped above the named lines; a tapped line always shows by name, unmarked; the focus ring ignores the lock. Elimination on tiny receipts stays inherent (as in 3.1.0). |
| A5 | The merge wiped any chip > 48 h; a bootstrap without `releasedDrops` (server fail-soft) emptied every charged drop until the next good sync. | The merge keeps `released` drops; only the released list withdraws them. |
| A6 | The mask marked unclaimable drops too → "Unlock" for a drop that can't be claimed. | Only open drops are marked; the rest are stripped, aggregate without a price. |
| A7 | A second alert while a receipt was open kept the first receipt's state. | One Detail screen per receipt (`getId` = the receipt id, `src/navigation/screenIds.js`): another receipt mounts a fresh screen. |
| A8 | The receipt hero counted only detected drops. | Claimed lines (shopper or expired) count as saved. |
| A9 | — | Duplicate banner + "Delete this copy" (en + fr), shown only while the original is still on the phone (deleted first, the copy is the last one); Admin · Receipt "Second copy of an older receipt" and "Closed automatically when the window ended". |

### Code review (2026-10-17, `/code-review high`, 10 findings)

Fixed: a locked alert's hold could outlive a purchase or a failed live read; the hold did not follow a
param change; the duplicate banner could ask to delete the LAST copy once the original was deleted on the
phone; the manual per-receipt reset → `getId`; a kept released drop could stick to a shifted line (now only
on the same product); the duplicate lookup scoped to the requested receipts; an admin's own duplicates left
out of their alert; the banner copy says "number of items". Not changed: both copies of a duplicate are
flagged claimed at expiry and counted in lifetime savings until one is deleted (Maxim: "both, until
deleted"); the coverage pins ride a commit of their own.

## What each installed build gets (backend rule 3)

| Build | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|
| ≤ 3.0.6 (unreported or < 50) | unchanged (push-only rule kept) | ignores `releasedDrops` | opens the receipt by id (as before #443) | sees "✓ Claimed +$x" on the line from the merge; lifetime savings grow | ignores `duplicateOf` |
| 3.1.0 / 3.1.1 | a token-less or muted shopper is charged and sees the drop in the app | an uncharged approved drop no longer shows (none in prod today) | opens the receipt by id; the drops view (3.1.1) still names the locked line (#327, fixed in 3.1.2 only) | the claimed line drops out of the released list; shows "✓ Claimed" | ignores `duplicateOf` |
| 3.1.2 | same | same | no focus on a locked line | hero counts it as saved | banner + delete |

## Deploy order

1. **Prod DDL first:** apply `0027_receipt_item_claim_source.sql`, insert the ledger row (LF sha256
   `28b291e052483e17f7fee9f5643cd75fab0b42afa8f027c1db5fd2da550806ca`, `when` 1791900000000), read back.
   `receipt_items` is read with every column (`select()`), so 0027 MUST precede the backend.
2. Merge → Railway deploys `main`. The boot seeder adds the two `claim_sources` codes.
3. The next price sweep (daily) flags the expired drops: **6 lines, 4 receipts, 4 shoppers, $17.00**
   (read-only count, 2026-10-17); their 4 receipts move from expired to claimed.
4. 3.1.2: bump, tag, build from the tag (separate step).
5. When 3.1.2 is at 100 %: consider **Admin · App version → Update reminder** for builds before 3.0.7.

## Documented, not changed

- Cross-province saving end takes the latest end among overlapping runs (#448 design, switchable): can
  overstate a deadline when two runs overlap a purchase window.
- The claim route falls back to the first line with the same total when the index doesn't match.
- The phone merges server lines by index and never sends line edits: a server-side line insert/delete or a
  local edit can shift a claim or a drop (needs a line-id contract).
- One push per drop on a bulk approve; a region sweep skipped mid-sweep waits for the next trigger (up to a
  day); the review flag can be up to 5 min stale on another instance; the pause is checked between passes.
- `app_config.CLAIM_CREDITS_PER_DOLLAR` changes what the app shows, not what is billed (15 in code).
- A push token is not cleared from other accounts on the same phone.
- Builds ≤ 3.0.6 still read unreviewed prices from `/api/check-price` and show their own chips, uncharged
  (13 iOS shoppers on 3.0.6) — the update reminder is the lever.
- Ops: `PENDING_CLAIMS_REMINDER_ENABLED` is still off; queue row #130 is waiting for review.

## Verification

PR #451 (app). Backend: every drop suite one file at a time against dev, new
`autoClaimExpiredDropsDb`, `priceDropReachableDb`, `recordNotifiedConcurrencyDb`, the duplicate SQL in
`adminAlertsRepoDb`; the E2E flake (1 run in 3 on untouched `main`: the server's own debounced SK sweep
parked the drop) fixed in the test harness. App: full Jest + coverage, i18n check.
