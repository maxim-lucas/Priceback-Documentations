# Deeper discount on an already-discounted item — roadmap

Added 2026-11-27 (Maxim). Status: **designed 2026-11-28, waiting on two confirmations (§ Design, open points) before code.**

## What Maxim learned
Costco customer service told him that an item that is **already discounted can get a deeper discount** later. It happened to him a few days
before 2026-11-27 on the **vanilla bean paste** he bought at the **Business Centre**: he paid a discounted price, and the item then went
lower still. That is why he asked about price drops on already-discounted items, and why this must be implemented.

## Why it matters for PriceBack
- A shopper who bought an item on sale can still be owed a price match when the item is discounted **further**. The drop is measured from
  what the shopper paid, not from the regular price (rule 8b: new price = what the shopper paid − the official saving).
- Anything that assumes "one saving at a time" per product and place can hide the second, deeper one.

## Where to look when this is designed
- **Savings that overlap in time for the same product and province.** Example found 2026-11-27 on production: AirPods Pro 3 (SKU 7472260)
  has a **$70 off** saving (Nov 19–25) and a **$55 off** saving (Nov 23–Dec 20) live together in every province, both from Same-Day, the
  second also confirmed by the coupon book. The harvest kept each listing as its own row and retired the first when its own end date passed;
  it did not create the overlap. Whether Costco honoured both at the tills is unknown. **Do not "fix" the overlap by ending the older
  saving** (Maxim, 2026-11-27): that could hide a real, deeper discount. It needs the rule below first.
- The price-history line takes the **largest running saving** on a day (`PriceHistorySeries.officialLine`); the "Recent savings" list shows
  every live row. Decide what "deeper discount" means for both before touching either.
- A drop on a line the shopper already bought discounted: the savings path (`savingDropRepo.findSavingDrops`, `savingRules.savingNewPrice`)
  must still read a second, deeper saving as a drop for that shopper, and must never charge twice for the same saving
  (commission is charged exactly once per line).
- The Business Centre storefront has its own prices and savings (`storefront: business_centre`); check the vanilla bean paste case there.

## Open questions (answered 2026-11-28, see Design)
1. When two official savings overlap, does the **deeper one replace** the shallower one from its start day, or do they **stack**?
2. Is a deeper discount a **new drop** for a shopper who already claimed a drop on the same line, for the difference only?
3. Which evidence do we trust for a deeper discount at the Business Centre (Same-Day listing, flyer/coupon book, shopper receipt)?

## Cases to replay once designed
- Vanilla bean paste, Business Centre, bought a few days before 2026-11-27 (Maxim's own receipt).
- AirPods Pro 3 (SKU 7472260), all provinces: $70 (Nov 19–25) then $55 (Nov 23–Dec 20).

## Design (2026-11-28)

**Maxim's answers:** the deeper saving **replaces** the shallower one from its start day (no stacking), and a shopper who already got
the shallower one is owed **the difference only**. Evidence at the Business Centre follows the usual sweep rules (rule 1: Same-Day BC and
costcobusinesscentre.ca are trusted; anything else follows the rule of N). No special case.

What the code does today, and the three situations:

| Situation | Today | Needed |
|---|---|---|
| **A. Line bought already discounted** (the receipt carries the instant discount, TPD), then a deeper saving runs | **Never offered**: `OFFERABLE_LINE` drops every line whose receipt carries an instant discount (*"a line whose TPD already applied the saving is never a drop"*). **This is the vanilla bean paste case.** | A drop of **deeper saving − discount already on the receipt**. New price = paid − (deeper − received). Only when the deeper saving is larger. |
| **B. Line told about a saving, not claimed**, then a deeper one runs | **Already works.** "Told at the same or a lower price" no longer holds, so the line is found again, and the commission telescopes from the lowest told price (charged once, for the extra only). | Nothing; pin it with a test (the AirPods case). |
| **C. Line already CLAIMED** (the shopper got the shallower adjustment at the desk), then a deeper one runs | **Never**: standing sweep rule 5, *"a claimed line never comes back to any queue"*, and `redropClause` / `extensionClause` require an unclaimed line. | Maxim's answer says the difference is a new drop. **This changes rule 5** (it needs his explicit OK), and a second desk visit for the same item. |

**Replace, not stack:** for one line on one day, the saving that counts is the **largest** official one running (the price history already
draws it that way, `PriceHistorySeries.officialLine`). The AirPods overlap (`$70` Nov 19–25, `$55` Nov 23–Dec 20): `$70` counts Nov 23–25,
`$55` from Nov 26. Nothing is ended or deleted in the data (Maxim, 2026-11-27).

**Money:** the commission stays charged exactly once per line by the four existing mechanisms (`price_drop_notifications` unique on
(line, price), the per-item lock, the telescoping total). A deeper drop charges `dropChargeCredits(paid − new) − dropChargeCredits(paid − told)`,
the extra only. For A, the "told" price is the price actually paid (nothing was told; the receipt's own discount was never ours).

**Where the code goes (one definition each):**
- A: `savingRules` gets `deeperSavingNewPrice({ paid, received, saving })` (the difference rule), with its SQL twin next to
  `savingDropRepo.findSavingDrops`'s `newPrice`. `OFFERABLE_LINE` keeps excluding a TPD line **except** for a strictly deeper official saving.
  The receipt's own discount per line is read from the receipt's TPD line (already linked to its item by the parser).
- C, if approved: one exception in `redropClause` for a claimed line and a strictly deeper saving that started after the claim; push copy
  "A deeper saving: $X more back" (EN + FR); rule 5 rewritten in `CLAUDE.md` and `Technical/Price_Drop_Sweep_Rules.md` in the same PR.

**Cases to replay:** the vanilla bean paste receipt (A, Business Centre); AirPods Pro 3 for B (and C if approved).

**Open points for Maxim before code:**
1. A's formula: deeper saving − the discount already printed on the receipt (e.g. paid with $3 off, $5 off now → a $2 drop)?
2. C: may a **claimed** line come back for a deeper saving (the rule 5 exception), knowing the shopper goes to the desk a second time for the same item?
