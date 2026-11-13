# Unlimited: 7-day free trial for new shoppers (later, not started)

**Status:** documented for later (Maxim, 2026-11-09). Nothing is built or configured. The paywall
redesign (V2 "Your money first", `feat/paywall-v2`) ships first, without a trial.

## The idea

At signup a new shopper chooses between:

- **Try Unlimited free for 7 days.** After the 7 days the store charges the monthly Unlimited price
  automatically, unless the shopper cancelled before.
- **Start with 75 free credits** (today's `FREE_TRIAL_CREDITS`, `shared/pricing.config.js`).

Goal: more paying subscribers. A shopper who starts the trial and doesn't cancel becomes a monthly
subscriber with no second decision.

## Decisions taken (Maxim, 2026-11-09)

| Decision | Answer |
|---|---|
| Trial length | **7 days** |
| Reminder before the trial ends | **None.** No push, no email. Do not add one. |
| Paywall design | V2 everywhere (the trial reuses V2's look) |
| Signup screen offering both options | An artboard on the paywall canvas, for Maxim's approval first. **Where it is shown is chosen after the artboard is approved.** |

## Prod data behind the length (measured 2026-11-09, prod `xjfrlzwonyaorwktnkpj`)

Users whose account is at least 14 days old (so every one of them had a full 14 days to get a drop):

| Measure | Value |
|---|---|
| Accounts | 283 |
| Scanned at least one receipt | 92 (33%) |
| Got at least one price drop | 41 (45% of scanners) |
| First drop within **7 days** of signup | 22 (**54%** of shoppers who got a drop; 24% of scanners) |
| First drop within 14 days of signup | 33 (80% of shoppers who got a drop) |
| First drop within 30 days of signup | 40 (98%) |
| Days from signup to first drop | p25 **1.0** · median **5.2** · p75 **11.4** |
| Days from first scan to first drop | median **2.1** |

Source: first `price_drop_notifications.sent_at` per user (receipts not deleted) against `users.created_at`
and the first `receipts.created_at`. Notifications include admin-verified drops and receipts scanned
after the fact, so this is the first drop *a shopper was told about*, which is what a trial needs.

**What it means:** over a 7-day trial, about half of the shoppers who will ever see a drop see one before
the first charge. The other half pay $4.99 before PriceBack has shown them any money. Those are the
refund and 1-star-review risk. Re-run the query before launch; the numbers will move with more users.

```sql
with first_drop as (
  select r.user_sub, min(n.sent_at) first_drop_at
  from priceback.price_drop_notifications n
  join priceback.receipt_items ri on ri.id = n.receipt_item_id
  join priceback.receipts r on r.id = ri.receipt_id
  where r.deleted_at is null group by r.user_sub),
first_receipt as (select user_sub, min(created_at) first_scan_at from priceback.receipts group by user_sub),
u as (select u.sub, u.created_at signup_at, fr.first_scan_at, fd.first_drop_at
  from priceback.users u
  left join first_receipt fr on fr.user_sub = u.sub
  left join first_drop fd on fd.user_sub = u.sub
  where u.created_at < now() - interval '14 days')
select count(*), count(first_scan_at), count(first_drop_at),
  count(*) filter (where first_drop_at <= signup_at + interval '7 days') within_7d,
  count(*) filter (where first_drop_at <= signup_at + interval '14 days') within_14d,
  percentile_cont(0.5) within group (order by extract(epoch from first_drop_at - signup_at)/86400)
    filter (where first_drop_at is not null) median_days
from u;
```

## "No refunds" cannot be promised

- **App Store:** Apple decides refunds, not the developer. A shopper asks at reportaproblem.apple.com and
  Apple answers. PriceBack can't block it.
- **Google Play:** a shopper can refund themselves within 48 hours of a charge from their Play account.
  After that, refunds are PriceBack's call (Play Console › Order management).
- **Consumer law** (Quebec's Consumer Protection Act in particular) applies whatever the terms say.

So the copy never says "no refunds". The sentence both stores accept is: *"Cancel anytime before the trial
ends and you won't be charged."* The Terms of Use can say a charge isn't refunded by PriceBack, but the
store's policy and the law still apply.

## What has to be done (in this order)

### 1. Stores (Maxim, consoles, no code)
- **App Store Connect** › Subscriptions › `priceback_unlimited_monthly` › Introductory offer: *Free*,
  *1 week*, Canada. Apple gives it once per Apple ID per subscription group, automatically.
- **Play Console** › `priceback_unlimited_monthly` › base plan › Add offer: *Free trial, 7 days*,
  eligibility *New customer acquisition* (never had this subscription).
- Leave `priceback_unlimited_annual` without a trial.
- RevenueCat reads the offer from the store product; no RC change beyond checking the offering shows it.

### 2. App (store build)
- The signup choice screen (artboard first, see Decisions).
- When the store says the shopper is eligible, the V2 paywall's Unlimited monthly row and CTA say
  *"7 days free, then $X/month"* with the **charged price the most prominent number** (App Review 3.1.2).
  The price comes from the store (`useStorePrices`), never written in the bundle. Not eligible (already
  used it): the normal price, no trial wording.
- Eligibility check: RevenueCat `checkTrialOrIntroductoryPriceEligibility` (iOS) / the offer on the
  product (Android).
- EN + FR labels for every new string.

### 3. Backend (check, probably no change)
- A trial arrives through the RevenueCat webhook as `INITIAL_PURCHASE` with `period_type: TRIAL`. Check
  that the subscription sync treats it as active Unlimited, and that a cancel during the trial ends it at
  the trial's end (`EXPIRATION`).
- `backend/lib/priceDropGuarantee.js` already reads `period_type`: confirm a trial never opens a
  Price-Drop Guarantee year.
- Price-drop commission is skipped for Unlimited (`isCreditExempt`), so a trial shopper claims for free
  during the 7 days. That's intended.

### 4. The 75 credits
Keep granting them to **every** new account, trial or not, on the server as today. A shopper who cancels
after the trial falls back to credits instead of nothing, and older builds (which never show a trial) are
unaffected (backend backward-compatibility rule).

### 5. Release
Store listing copy for the build that adds it must mention the free week. Reviewer notes: say where the
trial is shown and how to reach it with the review account.
