# Rewarded actions — what we may pay credits for

**Decided 2026-10-01.** Maxim asked to reward *Rate PriceBack*, *Follow us on
Instagram* and *Follow us on Facebook* with 5 credits each, on the condition
that credits are only given when the action really happened. Neither condition
holds, so **none of the three is rewarded**. They ship as unrewarded
"Help us grow the community" asks instead (app PR on `feat/community-actions`).

## The rule

A credit reward is allowed only for an action that is **both**:

1. **Verifiable server-side** — the backend can prove the action happened for
   *this* account (a verified price drop, a referred friend's first scan).
2. **Not a store/platform-prohibited incentive** — see the table.

An honor-system "tap and get 5 credits" fails rule 1 by definition: it is free
credit with a button in front of it.

## The three asks, checked

| Action | Verifiable? | Allowed to reward? |
|---|---|---|
| Rate the app | **No.** `SKStoreReviewController` / Play In-App Review return nothing — not whether the sheet showed (both OSes rate-limit it silently), not whether a rating was left, not the score. | **No.** Apple App Review Guideline **3.2.2** bans requiring users to rate/review "or take other similar actions … to receive monetary or other compensation". Google Play's *Ratings, Reviews, and Installs* policy bans incentivised ratings. |
| Follow on Instagram | **No.** The Instagram Graph API exposes a business account's follower *count*, never the follower list; a specific user's follow cannot be checked. | Treat as **no** — "other similar actions" in 3.2.2 covers task-for-reward. |
| Follow / like on Facebook | **No.** The Pages API does not expose who likes or follows a Page. | **No.** Meta Platform Terms have prohibited incentivising Page likes ("like-gating") since Nov 2014. |

Given the review history in `App_Store_Rejections.md` (5.1.1(iv) on 2.8.18,
3.1.2(c) on 2.8.20), a rewarded rating is a near-certain next rejection.

## What is rewarded today

- **Flag a price drop** — +1 per *verified* drop.
- **Invite a friend** — `referralCredits`, paid when the friend scans a first receipt.

Both are proven server-side. Any new earn path must meet the same bar.

## Where the unrewarded asks live

- Profile → under the two "Grow your balance" tiles: a *Help us grow the
  community* strip (Rate us · Instagram · Facebook). No badge.
- Profile → *Help & community* group: the original Rate / Instagram / Facebook
  rows, unchanged.
- Buy credits → *Help the community grow* group, after *Or earn them free*.

All reuse `openRateApp()` (`src/constants/storeLinks.js`) and `openSocial()`
(`src/constants/socialLinks.js`). `__tests__/communityActions.test.js` asserts
these rows carry **no** credit badge and their copy promises no credits in any
language.

## Future: a "support us" / donation link — NOT built, open question

Maxim raised a donation link as a maybe. Notes for when it comes up — **verify
with current guidelines and an accountant before building**:

- PriceBack is published by a for-profit company (Prosoft Inc). Money given to it
  is **not a charitable donation** — no tax receipts, and it is taxable revenue.
  Call it a "tip" / "support", never a "donation".
- **Apple:** a tip that unlocks nothing is a digital purchase → must use In-App
  Purchase (consumable "tip jar" products are a common, accepted pattern). An
  external payment link for it would breach 3.1.1. Fundraising outside IAP is
  reserved for approved nonprofits (3.2.1(vi) / 3.2.2(iv)).
- **Google Play:** same in practice — tips to a non-charity go through Play
  Billing; only qualifying charitable donations may use an external flow.
- A tip must grant nothing (or be clearly described if it does); it must not be
  confused with credit packs, and 3.1.2 copy rules still apply.
