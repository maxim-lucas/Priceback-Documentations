# Store Spaces v2: follow-ups

**Status:** open list, kept current while `feat/store-spaces-v2` is built (started 2026-11-10). Design:
`Technical/Store_Spaces_v2_Design.md`; plan: `Technical/Store_Spaces_v2_Plan.md`.

## The rule every follow-up obeys (Maxim, 2026-11-11)

> "i dont want to change any main logic of the drops today or the strategy, this should be just the UI changing,
> navigation, easier and simpler way to prevent users to get lost, but our locks, price drops, ...etc should be the
> same, everything should be wired as of today and no regression will be accepted at all. same stability as of today."

Store Spaces v2 changes screens and navigation. It does not change how drops are found, verified, locked, charged,
notified or claimed. Any follow-up that would touch that logic is a separate request.

## Being built now (in this branch)

| # | Follow-up | Decision (verbatim) | Task |
| --- | --- | --- | --- |
| 1 | Home keeps the urgent "Expiring soon" banner and the first-receipt card, with today's logic | "no dont drop keep the same logic as of today" | 11b |
| 2 | While one store is live, its space shows the strips (trial, guarantee) and the same banners Home shows | "yes keep costco only strip" | 11b |
| 3 | Amounts to claim stay as big as today on receipt rows (the design shrank them to a sub-line) — **a concept to test**, changeable later | "add the idea to get the amounts to claim as big as of today, we will test just this concept and we can change it" | 11b |
| 4 | The store a shopper picks (Scan sheet or store space) chooses the parser; auto-detection only suggests switching when it reads another store | "the selection wins always, auto detection can suggest to confirm store if auto detection detect another store than the selection"; registry change: "Yes, registry only" | 14b |
| 5 | Shared tools (Price Checker, price tag, translator) use the picked store, so a lookup or a scan never lands on the wrong store | "same for any shared tools to prevent errors and mixing receipts" | 14b |

Why 4–5: "the buttons for store changing is good to prevent the auto selection of the parser, when the user choose a
store and scan the receipt, we already know what parser (of the store) to select". Costco's parser files, the shared
parsing and geometry code stay byte-identical (`__tests__/costcoPathImmutability.test.js`); only the registry's
store-selection step takes the picked store.

## Decided during the build

| Topic | Decision |
| --- | --- |
| Free week vs installed builds | Play offer tagged `rc-ignore-offer`; a separate Apple product `priceback_unlimited_monthly_trial` (Maxim: "approved, use the rc-ignore-offer and separate Apple product"). Backend maps it to Unlimited monthly (Task 3b). |
| Guarantee strip copy | "No drop this year? We add another year" (the design's "Next year's on us" trips the 3.1.2(c) guard; Maxim: "choose what is best for you to hook a user"). |
| Privacy row sub-line | "How we collect, use and protect your data" (the design's "Your data stays on your device" is untrue; Maxim: "do it if necessary"). |

## Owed before any release of this build

1. **Store consoles** (Task 22, with Maxim watching): Play offer + tag; Apple product + intro offer; RevenueCat.
   No EAS build before both stores are configured.
2. **Backend deploy order:** migration 0053 on prod → backend → prod smoke with old-build request shapes →
   consoles → build from a tag only when Maxim asks (`Technical/Backend_Backward_Compatibility.md`, Store Spaces v2).
3. **Device checks** (no device in the build sessions; everything was checked against the design source and tests):
   every redesigned screen against `Store Spaces v2.html`; iOS hand-off from the Scan sheet to the notifications popup;
   fonts (Inter Tight, Plus Jakarta Sans, IBM Plex Mono); the striped deal placeholder; the dashed vote border.
4. **App Review reviewer account:** it already received its 75 credits in prod, so a new-build reviewer lands on the
   paywall, not on screen H. Decide whether the reviewer must see screen H to review the free-week offer.
5. **French copy** for the app screens (written by Claude) — Maxim reviews in the PR.

## For Maxim to confirm (design-driven changes visible to shoppers)

- Receipts rows: the days-left badge on receipts with an open drop is gone; the total no longer says "CAD"; product rows
  lose the store short name and the price/date line. (The big to-claim amount comes back, item 3.)
- Me card: the plan line always says "Pay as you go" (today: "Free plan" when the balance is within the free grant, plus
  an ACTIVE/CANCELLED foil for subscribers).
- Single-store mode keeps the space's Home button leading to the all-stores Home.
- Tab labels no longer scale with the phone's text size (fixed 62 px bar).

## Related roadmap entries

- `Roadmap/Unlimited_Free_Trial.md` — the free week, now built here.
- `Roadmap/Deals_Watchlist.md` — the hidden "+" on Deals rows.
- `Roadmap/Push_Token_Gap.md` — accounts with no push token.
