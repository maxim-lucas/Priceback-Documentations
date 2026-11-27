# Deeper discount on an already-discounted item — roadmap

Added 2026-11-27 (Maxim). Status: **to do, not designed yet.**

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

## Open questions (Maxim to answer when this is picked up)
1. When two official savings overlap, does the **deeper one replace** the shallower one from its start day, or do they **stack**?
2. Is a deeper discount a **new drop** for a shopper who already claimed a drop on the same line, for the difference only?
3. Which evidence do we trust for a deeper discount at the Business Centre (Same-Day listing, flyer/coupon book, shopper receipt)?

## Cases to replay once designed
- Vanilla bean paste, Business Centre, bought a few days before 2026-11-27 (Maxim's own receipt).
- AirPods Pro 3 (SKU 7472260), all provinces: $70 (Nov 19–25) then $55 (Nov 23–Dec 20).
