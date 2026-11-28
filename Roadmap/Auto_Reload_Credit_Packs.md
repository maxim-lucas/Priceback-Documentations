# Auto-reload of credit packs — platform limit and decision

**Status:** decision recorded 2026-11-26 (Maxim). **Pre-choice: option 3** (one-tap reload prompt). Not built yet.

## The ask

Maxim, 2026-11-26: *"i want it to be on auto mode, actually it should notify the user before reloading the credit pack so it is almost useless"*.
He wants the reload to be automatic when the balance runs low.

## Why a silent reload is not possible

Credit packs (`priceback_pack_starter`, `_pro`, `_max`) are **consumable in-app purchases**. On both stores a consumable
purchase always opens the store's own confirmation sheet (Face ID / Play purchase dialog); an app cannot charge one in the
background. Today's "auto-reload" is therefore a prompt (`purchaseService.maybeAutoReloadOnLowBalance`, threshold 50
credits, DB-tunable, `getAutoReloadThreshold()`), and the OS dialog is the consent surface
(`Operations/Credit_Management_Audit.md` §1, "platform constraint").

Charging the card ourselves (e.g. Stripe) for digital credits would break both stores' payment rules. **Not an option.**

## Options considered

| # | Option | Verdict |
|---|---|---|
| 1 | **Unlimited plan** is the real "auto" mode: it renews on its own and never runs out or paywalls. | Already exists. The reload prompt can point heavy users at it. |
| 2 | **Auto-renewing credit subscription** (e.g. "500 credits a month"): renews silently, but on a fixed schedule, not when the balance is low. Needs new products in App Store Connect and Play, entitlement logic, review screenshots and App Review sign-off. | **Rejected (Maxim, 2026-11-26):** *"2 is not an option"*. Unlimited already covers the need. |
| 3 | **Near-invisible reload prompt**: shown early (at the threshold), the pack and price already chosen, so the shopper makes one tap and confirms with Face ID. The closest to automatic the platforms allow. | **Pre-choice.** Cheapest; no store setup. |

## Pre-choice: option 3 — what it means

- Keep the opt-in and the threshold (50 by default, DB-tunable).
- Make the prompt a single step: the configured pack and its store price shown up front, one tap to the OS sheet. No
  extra screens before the sheet.
- Offer Unlimited (option 1) beside it for shoppers who reload often. A subscriber is never prompted (their balance is
  hidden and unused while the plan is in force; see CLAUDE.md "Subscribers come first").
- Labels in every supported language (`en` + `fr`), the price from the store's own string.
- Never a silent charge: the OS dialog stays the consent surface.

## Not decided / to do when picked up

- Exact copy and where the prompt appears (scan screen, Home banner, both today).
- Whether to show it once per low-balance episode (today: deduped once per episode).
- Review screenshots for the three pack products are separate and still tracked in
  `Publishing-Compliance/iOS_IAP_Setup_TODO.md` (one capture of Buy Credits can be reused).

## Related

- `Operations/Credit_Management_Audit.md` — the 50-credit threshold fix and the platform constraint.
- `Roadmap/Unlimited_Free_Trial.md` — the free week and Unlimited.
