# Warehouse clearance (.97) drops

*Maxim, 2026-10-30. Code: `POST /api/admin/potential-drops/clearance` (`backend/server.js`), `potentialDropRepo.markClearance`, `priceDropRepo.NOT_CLEARANCE`, `priceDropNotifier.sendClearanceDrops`; app `AdminPotentialDropsScreen`, `DetailScreen`, `services/releasedDrops`.*

## The rule

A Costco shelf price ending in **.97** is a clearance (`Costco-Price-Rules.md`). It holds **at the warehouse it was seen at**. It does not apply to the whole province, unless the same clearance runs in several warehouses at the same time. A clearance price can also vanish at any moment: the stock runs out, the item is "unrecognized" online, and a customer-service agent may refuse the adjustment.

> *"this price code *.97 is a warehouse and should always be considered in the same warehouse only not even on provinces except if there is the same clearance at the same time in different warehouses"* — Maxim

## What the code did before

The Same-Day / yepsavings harvest already kept a .97 price at its warehouse (`savingsIngest`, `costcoPriceRules.isWarehouseOnly`). The crowd path did not: `potentialDropRepo.listPotential` and `priceDropRepo.findNotifiable` group by **(product, province, price)**. One shopper's .97 receipt or tag therefore showed up as a potential drop for every buyer in the province. "Verify price" would then have stamped it, sent it, and charged commission province-wide.

## The admin's two buttons (Admin · Potential price drops)

These buttons appear only on a card whose price ends in .97. The card also carries a `.97 · WAREHOUSE CLEARANCE` tag.

| Button | What happens |
|---|---|
| **Clearance · send without charge** | Lines bought at a warehouse where the clearance was seen after the purchase (`sameWarehouse`) get a drop now, **never charged**. Every other line is skipped (a rejected review-queue row at this price, as with "Verify price and skip"). The button is disabled when no line is from such a warehouse. |
| **Clearance · skip** | No line gets a drop at this price. |

Either way the group's crowd rows are stamped `flags.warehouseClearance` (`markClearance`). From then on they are left out of **every province-wide crowd read** (`NOT_CLEARANCE`): the verified sweep (`findNotifiable`), the app's per-product price check, the rule-of-N `verified` stamp (`markNewlyVerified`), and the potential list and its evidence. So a clearance never becomes a verified (charged) province price, however many shoppers see it. The card leaves the list.

The server builds the line list itself (it never trusts the request). "Send" is refused with `409 DELIVERY_PAUSED` while delivery is paused in the price-drop queue.

## Why it is never charged, now or later

`sendClearanceDrops` writes through the **one ledger writer**, `priceDropRepo.recordNotified`, with `chargeFor: () => 0`. That keeps the per-line advisory lock, the "already told at this price or lower" guard and the unique index, and debits nothing.

A later, deeper *verified* drop on the same line is billed with the usual telescoping charge from the lowest notified price, which is the clearance price. So the shopper is billed only for what lies beyond the clearance. The clearance part is never billed. See `commission-charged-once` (the four mechanisms are unchanged).

## What the shopper sees

- **Push** (EN/FR, `verifiedDrop.clearanceTitle` / `clearanceBody`): *"Clearance price at your warehouse — You could save $X · N days left to claim. It's a warehouse clearance: check in store first — it may be sold out, and Costco may refuse the claim. No credit or fee is charged for this drop."* No item name (L-6). Payload `type: verified_price_drop` (every build opens it) plus `warehouseClearance: true`.
- **Receipt screen** (this release on): the released-drops list carries `warehouseClearance: true` when the line's **lowest** notified price is a clearance (`releasedForUser` reads it from the notification's `price_point_id`). The app shows `detail.clearanceNote` above Claim.
- **Older builds** show the drop as a plain drop; the push still carries the warning. Never charged, so never locked (`chargedIntoNegative` stays false).

## Not done (known limits)

- **No automatic rule.** A new .97 sighting that arrives *after* the button was used is a new, unstamped row. If it reaches the rule of N on its own, it can still verify province-wide. Maxim chose the button over a rule. An automatic "a .97 price only counts at its warehouse" would need `findNotifiable` to match the evidence to the buyer's warehouse.
- **The Price-Drop Guarantee** does not count a clearance drop (no `_stampGuarantee`): it is uncertain by nature.
