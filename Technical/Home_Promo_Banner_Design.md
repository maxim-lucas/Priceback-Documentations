# Home promo banner (server-driven) — design

Approved by Maxim, 2026-11-27. First use: Black Friday → Cyber Monday 2026 with the `BLACK` code.

## Intent
Let the server put a promo banner under the Home hero card, for any future event, with no new build once the
build that carries the slot is out. First event: `BLACK` (20% off subscriptions, 20% bonus credits on every pack).

## Goals
- A server-driven **home promo** config: code, copy (EN + FR), start, end, audience. Switched on and off as data.
- Banner under the hero. Tap → applies the code to the account → opens the paywall.
- **Invisible while off: renders nothing and takes no space** (no placeholder, no margin, no layout shift).
- Shown only to shoppers who can use the code: Canadian store account, never subscribed (`accountEligibility`).
- A push to all users the same day (separate step, Maxim's go required before any send).

## Non-goals
- No change to the `BLACK` row (`ends_at` stays 2027-01-01). The banner/push end at Cyber Monday
  (2026-11-30 23:59 Toronto); the code stays valid after, by Maxim's choice.
- No popup for old builds (an installed build only shows UI it contains). Old builds are reached by the push only.
- Hero slide-1 missed drops and uninstall tracking are separate tasks.

## Anti-goals
- A banner visible to a subscriber or non-Canadian shopper. A blank gap when off. A raw code or untranslated string.

## Constraints
- Backend is additive only (old builds never read the new field/route). Old app builds section in the PR.
- Every label in `en` + `fr` in `src/services/i18n.js`; server copy is data keyed by language with English fallback.
- One rule, one function: eligibility is `promoCodes.accountEligibility`; window check is one function, server and phone.
- Push honours the marketing-consent gate (`backend/marketingGate.js`); send is never automatic.

## Approaches
1. **Server-driven slot (chosen):** config row + endpoint; phone renders when the answer is non-empty. Reusable.
2. Hardcoded banner with dates in the app: simplest, but every event needs a build. Rejected: that is the block to avoid.
3. Reuse the push only: reaches old builds but leaves no in-app surface. Kept as the companion, not a replacement.

## Left to the builder
Config storage (app_config row vs a small table), endpoint path, banner visual (match the existing Home cards),
admin switch on the existing promo desk, the push copy (EN + FR, annual first as "unlimited", packs "buy as many
as you want"), tests incl. a subscriber-never-sees-it test and the parity of the window function.

## Addendum 2026-11-27 (Maxim, after the first build)
- **Audience of the BANNER = anyone without a valid subscription** (`isCreditExempt` false: never subscribed, lapsed, free,
  trial, pay-as-you-go). Not limited to Canada or never-subscribed. (The push audience is unchanged: it promises a code,
  so it stays Canadian province + build 3.6.5+ + never subscribed + marketing consent.)
- **The banner can be action-less**: config field `action: "paywall" | "none"` (default `"paywall"`). `"none"` = an
  announcement: no tap, no code applied, no paywall, `cta` optional. The banner is a reusable slot for events AND announcements.
- The server answers `action` in the view; a phone ignores an unknown action by treating it as `"none"` (never opens the paywall by guess).
