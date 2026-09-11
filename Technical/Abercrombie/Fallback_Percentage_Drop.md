# Abercrombie — the percentage-drop fallback

**Decided 2026-09-10 (Maxim). NOT built.** This is the degraded mode A&F falls
back to **only if** `Canadian_Egress_Verification.md` comes back as outcome B —
A&F genuinely serves Canada in USD from the worldwide storefront.

If that verification comes back CAD-positive, **this document is shelved, not
implemented.** Read it before building anything here.

---

## The problem it solves

If we can only ever see A&F's **USD** price, we cannot state a CAD price drop, and
`price_points` stores a bare `numeric(10,2)` whose currency is assumed CAD by
every reader. Writing a USD number into it manufactures a price drop of roughly
the exchange rate, on every item, forever — and `findNotifiable` charges
commission at detection, before a human sees it.

## The insight it rests on

**A percentage is currency-invariant.** If A&F marks a style down 30%, it is 30%
in every storefront, whatever the numbers are denominated in. So the drop can be
measured in USD — honestly, against itself — and expressed in a form that carries
across.

Concretely: two observations, **one currency, never crossed**.

```
dropPct = (usdReference − usdNow) / usdReference
```

where `usdReference` is the USD observation nearest the purchase date. Both terms
come from the same storefront in the same currency, so no conversion happens at
any point.

## What the shopper is told, and billed

Maxim's decision, 2026-09-10:

> apply the percentage to the receipt price.

```
estimatedDropCad = receiptLineCad × dropPct
```

`receiptLineCad` is what the shopper **actually paid**, in CAD, off their own
receipt. So the CAD figure is a real CAD number scaled by a ratio — not a
converted USD number. Commission is then the standard **15 credits per dollar** on
`estimatedDropCad`.

Matching is by **identity, not price**: `productId:itemId` from the receipt to the
same variant on the page. The policy adjusts merchandise *"of the same color and
size"*, so a style-level match prices a different garment.

## The risk, stated rather than buried

**This assumes A&F runs the same markdown in both storefronts.** If A&F's Canadian
price moves differently from its worldwide one — a regional promotion, a different
markdown schedule, a price held while the US one drops — the shopper is billed on
an estimate that is simply wrong.

That risk was raised and accepted. It is not a reason not to build it; it is a
reason to build it with these three things attached:

1. **Label the amount approximate everywhere.** Every surface that shows the
   figure — notification, drop card, claim screen, PDF — says so, in **EN and FR**
   (per the localization rule: no feature ships base-language-only).
2. **A distinct `source_type`** on the price point and the ledger entry, so every
   estimated drop can be found in one query and refunded **as a set** if the
   assumption turns out false. Without this, a systematic error becomes an
   unbounded manual reconciliation.
3. **Never claim it is A&F's Canadian price.** It is an estimate of what the drop
   is worth. The wording has to survive a shopper who walks into a store and finds
   a different number.

## The storage prerequisite

**`price_points` has no currency column, and neither does `stores`.** Verified
against `backend/db/deploy/schema.sql`. Every reader assumes CAD.

So a USD series cannot be written there as-is. Before any of the above:

- either add a `currency` column and teach every reader to respect it,
- or keep the USD series in a store-scoped table of its own and leave
  `price_points` meaning what it has always meant.

The second is smaller and cannot regress Costco or Best Buy. Decide at build
time, with the real requirements in hand — not now, when the fallback may never be
needed.

## What this does NOT change

- The **storefront gate stays**. The fallback reads a USD page *on purpose* and
  knows it; it does not weaken the rule that a CAD-denominated quote must come
  from a Canadian storefront.
- The **in-store rule stays**. An in-store A&F receipt gets no email claim
  regardless (`Price_Adjustment_Policy.md`) — A&F requires an in-person visit, so
  billing an in-store buyer for a drop they cannot claim by email is the same
  defect whatever currency it is measured in.
- The **variant gate stays**. Same colour and size, or no quote.

## Related

- `Canadian_Egress_Verification.md` — the measurement that decides whether this is
  needed at all
- `Price_Adapter.md` — the adapter and its gates
- `Price_Adjustment_Policy.md` — what a price entitles a shopper to
- `Technical/priceDrop.md` — how drops and commission work today
