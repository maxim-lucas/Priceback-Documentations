# Abercrombie & Fitch — the price-adjustment policy

The load-bearing facts for treating A&F as a PriceBack store. Read from
abercrombie.com's own pages on **2026-09-07**, in a real browser (both pages are
JS-rendered, so `curl`/WebFetch return navigation chrome and no policy text).

> ⚠️ Three separate aggregator sites state this policy incorrectly. Every number
> below is quoted from A&F's own pages. Do not "correct" them from a blog.

---

## The two channels are different policies, not one policy with two windows

### Online orders — 14 days, US **and** Canada, claimable by EMAIL

Source: sale terms (`?pageName=sale-terms&textKey=LEGAL_SALES_TERMS`), under
**"Price Adjustments → Orders That Will Be Shipped to the US and/or Canada"**:

> "If you have ordered merchandise via the A&F Website and A&F has reduced the
> price of any item of merchandise **(of the same color and size)** in your
> order, then A&F is happy to process a price adjustment for you. Please note
> that you may only do so **within fourteen (14) days of the date on which you
> placed your order**. A&F offers price adjustments **only for merchandise
> purchased at the full price**. Each item that you purchase from A&F is eligible
> for **only one (1) price adjustment**. In order to request a price adjustment,
> please contact the A&F Customer Service Department **by email at
> Abercrombie@Abercrombie.com** or by telephone at **+1-925-359-2579**. Please
> remember to **include your order number** and other details regarding the
> merchandise that you believe to be eligible for a price adjustment."

Four consequences for the app:

1. **The window runs from the ORDER date**, not ship or delivery. The parser must
   set `purchaseDate` to the order date or the window is silently overstated.
2. **Email is the officially designated channel**, with a named address. This is
   what makes A&F a natural fit for the existing claim-email flow.
3. **The order number is mandatory.** An online receipt parsed without one can
   never be claimed — the same class of defect as a Best Buy order missing its
   `Web ID`, which logged fine and could never be price-watched.
4. **Same colour and size** ⇒ the comparison must be at the **variant** level,
   not the product level. See `Price_Adapter.md`.

### In-store purchases — 7 days, and **NOT** claimable by email

Source: `/shop/us/help/instore-return-exchange-policy`, accordion *"What is the
price adjustment policy for in-store purchases?"*:

> "We will refund the difference between the price you paid and the reduced
> price, if the merchandise meets all of the following criteria:
> - The price of the merchandise is subsequently reduced **within 7 days** of the
>   date of your in-store purchase.
> - The merchandise is in its original condition.
> - You have the original sales receipt, invoice, or order confirmation.
>
> **To receive a price adjustment, please return to your nearest Abercrombie or
> abercrombie kids store** with your merchandise and original sales receipt.
> Please note that only one price adjustment per item is permitted."

The sale-terms page's own in-store paragraph is a *price match at point of sale*,
not a retroactive adjustment, and carries no day count:

> "**In Store Price Adjustment** — Find a better price on the A&F website? If the
> product is a match, we'll match the lower price in stores."

**An in-store A&F receipt therefore gets no claim email.** A&F requires an
in-person visit with the merchandise. This is the same rule the app already
enforces for Costco warehouse purchases in `ClaimAssistantScreen.js` — *"those
price adjustments must be handled in-store, not by email"* — so it is an existing
shape, not a new concept.

Why this matters more here than it looks: PriceBack debits commission at **drop
detection**, before any claim. Routing an in-store buyer to email would bill them
for a claim the retailer refuses.

---

## 🔴 Open: the in-store window is configured as 14, the FAQ says 7

The app currently configures **`adjustmentDays: 14` for both channels**, on
Maxim's instruction (2026-09-07): the sale-terms page he referenced states 14 in
its price-adjustment section.

The tension, recorded so nobody re-derives it:

- The 14 days on the sale-terms page sits under the heading *"Orders That Will Be
  Shipped to the US and/or Canada"* and opens *"If you have **ordered merchandise
  via the A&F Website**…"* — it is scoped to online orders.
- The 7 days is on a different official A&F page and is scoped to *"the date of
  your **in-store** purchase."*

They do not contradict each other; they cover different channels. Both are
official abercrombie.com text.

**Risk if 7 is the true in-store number:** a drop detected on days 8–14 of an
in-store purchase is billed to the shopper and then refused at the store.

**Cost to change:** one field. `stores.adjustment_days` is a single integer read
live by `daysRemaining`, `priceDropUrgency`, `recomputePolicyStatus` and the
`findNotifiable` window clause. If a per-channel split is ever needed, it becomes
a second column, not a redesign.

**Owed:** confirm the window on the **Canadian** in-store help page
(`/shop/ca/help/...`), which was not read on 2026-09-07.

---

## What PriceBack must never do

| Rule | Why |
| --- | --- |
| Never offer an email claim on an in-store receipt | A&F requires an in-person visit; the claim gets refused after the shopper was already billed |
| Never quote a price for a different size/colour | The policy says "of the same color and size" — a different variant is a different price and an invalid claim |
| Never claim on a line bought at a discount | "only for merchandise purchased at the full price" |
| Never offer a second claim on the same item | "only one (1) price adjustment" per item |
| Never present a USD price to a Canadian shopper | See the currency gate in `Price_Adapter.md` — it fabricates a drop and charges commission for it |
