# The adjustment window: how PriceBack models time, and the two disagreements left open

**Written:** 2026-09-17, alongside the fix for Bugs #256.
**Audience:** anyone about to touch `daysRemaining`, `policy_status`, the price-drop
sweep, or the urgency tier.

---

## 1. The model, in one sentence

**A price-adjustment deadline is a calendar DATE, and the device that shows it is
the one that decides what day it is.**

Everything follows from that:

- The receipt carries a **printed calendar date**. It is taken literally — the
  clock part of a timestamp is discarded, never resolved against a zone. That is
  the #159 lesson: re-interpreting a wall-clock stamp is what rolled every receipt
  date backwards.
- The window closes on **purchase + N calendar days**. Not `purchase + N×86,400,000
  milliseconds` — a window spanning a DST transition is 24 h ± 1 h out, and the
  difference is a whole day once `Math.ceil` gets hold of it.
- "How many days are left" is answered **on the device, from the device's own local
  calendar date**. No server call, no country table, no province table. The device
  already holds both inputs, so it can always answer, offline, correctly, at every
  offset on earth.

### Where the code lives

| File | Job | Rule it keeps |
|---|---|---|
| `src/utils/adjustmentWindow.js` | all calendar arithmetic | **contains no `Date` token at all**, enforced by a grep test |
| `src/utils/localClock.js` | the only wall-clock ⇄ calendar crossing | no `new Date("<string>")`, no `setDate`, no `toISOString` — also grep-enforced |
| `src/services/priceService.js` | `daysRemaining`, `isWindowOpen`, `adjustmentExpiry{,ISO}`, `priceDropUrgency` | every one takes an injectable `todayISO` |

The two grep guards exist because the previous version of this discipline was a
comment (`utils/purchaseDate.js`, added after #159) and the next editor walked
past it.

### Why no country + province lookup

It was considered and is not needed. A lookup table would have to be maintained,
would be wrong for a traveller, and would still not answer the question any better
than `now.getFullYear()/getMonth()/getDate()` already does. Device-local calendar
arithmetic is correct at every offset including half-hour ones, across DST, with
no data to keep current. The fix is permanent rather than covered case-by-case.

---

## 2. Open disagreement #1 — the client and the DB differ on the last day

**Status: known, deliberate, unchanged. Do not "fix" one side alone.**

| | Rule | Day `purchase + N` |
|---|---|---|
| Client (`daysRemainingISO`) | EXCLUSIVE | window CLOSED, counter reads 0 |
| DB (`receiptsRepo.recomputePolicyStatus`) | INCLUSIVE — `expired iff purchase_date + window < today` | still `watching` |

So for one day per receipt the app says expired while the database says watching,
and the backend sweep can still push a drop for a receipt the app has greyed out.

**This predates the #256 fix**, exists at UTC, and the fix *narrowed* it — from a
full 24 h to 24 h − |offset| (about 19 h in Toronto), because the client edge moved
from UTC midnight to local midnight.

**Why it was not resolved in the same change:**

1. **Exclusive is the conservative side.** Adopting the inclusive rule would, for
   one day per receipt, tell a shopper they can still claim when the client cannot
   verify the store agrees. A timezone fix is not the vehicle for loosening a
   refund deadline.
2. **`updateExpiredReceipts` writes, it does not render.** It persists
   `status:"expired"`, sets `watchEnabled:false` on every item, and mirrors each
   stop to the backend **durably**. Moving the boundary by a day is a data change
   with a backend side effect, and it is not idempotently reversible — once
   `watchEnabled:false` is mirrored, the next bootstrap merge keeps it off. Any
   change here needs its own reasoning about re-enabling already-stopped watches.
3. **It would make the timezone fix unverifiable.** Every assertion would move by
   a day at once, so a failure could not be attributed.

Pinned by a test named for what it is
(`__tests__/adjustmentWindow.test.js` → *"EXCLUSIVE: the window is already closed
on day purchase+N"*), so a future change has to argue with it rather than slip past.

**If you do take it on:** decide the rule once, move `daysRemainingISO`,
`recomputePolicyStatus`, `priceDropRepo`'s SQL window
(`f.available_from <= rc.purchase_date + adjustment_days`) and
`server.isWithinAdjustmentWindow` together, and say what happens to receipts
already sitting at `watchEnabled:false`.

---

## 3. Open disagreement #2 — the push emoji and the in-app chip

**Status: known, recorded, not fixable on the backend alone.**

`backend/priceDropNotifier.js` `urgencyTier` and `priceService.priceDropUrgency`
both cut the window at 1/3 and 2/3. They used to agree exactly, because both
flipped at **UTC** midnight. After #256 the mobile side counts whole calendar days
against the device's own local date, so it flips at **local** midnight.

They therefore disagree for roughly **|utcOffset| hours around each of the two
crossings** (red↔yellow, yellow↔green) — about 5 h in Toronto, 8 h in Vancouver,
2 h in Cairo. During that window the emoji leading a push title can be one tier
away from the chip in the app.

- **West of UTC (Canada, the main market):** the push is one tier *more* urgent
  than the chip. Fails safe.
- **East of UTC (Egypt):** slightly *less* urgent, for a smaller window.

**No backend-only change closes this.** Making `urgencyTier` integer-calendar puts
its flip at UTC midnight — where it already is. The gap *is* the offset, and the
server does not know it.

**The fix, when it is worth doing:** send the device's local date (or its UTC
offset) with the watch registration. `priceService.js` already POSTs
`adjustmentDays` alongside each item, so the payload and the call site both exist;
the backend would store it per device and count from it. Deliberately deferred —
it couples a mobile release to a backend deploy over which emoji leads a push
title, twice per receipt lifetime.

The `urgencyTier` comment claiming a deliberate mirror **was corrected** in the
#256 PR even though the code was not, because a stale "kept in sync" note is how
the next person recouples them.

---

## 4. The testing rule this produced

🔴 **Assigning `process.env.TZ` inside a Jest test does nothing.**

Node re-reads the zone only when the assignment goes through the real
`process.env` setter, and Jest hands each test file a cloned env object, so the
setter never fires. Measured on this repo: `UTC`, `Asia/Tokyo`,
`America/Vancouver` and `Pacific/Auckland` in turn all produced the **same local
hour**.

Four suites were written that way and each ran at one ambient zone while naming
nine — `purchaseDate.test.js`, `receiptParsingShared.test.js`,
`ocrServiceExtra.test.js`, `receiptPipeline.live.test.js`. One of them is the
matrix added after bug #159 *specifically* to stop a local/UTC mix recurring. It
had never measured anything, which is most of why #256 survived a year of green
suites. They now carry a banner saying so.

**What works instead:** TZ in the **process environment** before Node starts.
`__tests__/adjustmentWindowTimezone.matrix.test.js` spawns a child `jest` per
zone with `TZ` in the child's env — 7 zones from UTC−8 to UTC+13 including the
half-hour `America/St_Johns`, ~23 s.

It lives in a test rather than in the workflow because `__tests__/ciParity.test.js`
forbids test parameters in `.github/workflows/test.yml` — so a plain `npm test`
runs a real matrix, locally and in CI alike, with no workflow change.

**Three rules that fall out of it:**

1. **Pin the hour as well as the zone.** The #256 defect hid for 19 of 24 hours in
   Toronto. A zone-only matrix would have been green all morning, red in the
   evening, and dismissed as a flake.
2. **Never build a fixture with the arithmetic under test.** The old
   `daysAgo`/`inDays` helpers did local `setDate` then `toISOString()` — the same
   mistake production made — so both sides drifted together and the bug cancelled
   out. Use `Date.UTC(localY, localM, localD) ± n*86400000`: a *label*, not an
   instant, exact at every offset.
3. **A green CI run is not evidence for date logic.** CI runs at UTC, the single
   offset where a local/UTC mix cannot reproduce.

The half-hour zone earned its place immediately: `America/St_Johns` (−2:30 in
summer) was the only zone to fail on the matrix's first real run, catching a test
expectation that assumed whole-hour offsets.
