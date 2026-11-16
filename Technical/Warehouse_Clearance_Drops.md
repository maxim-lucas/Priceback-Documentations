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

## Clearance at other warehouses: its own list (Maxim, 2026-11-16)

> *"potential price drops show unverified price for a clearance price drop (ending *.97$) but there is no way to verify it and when i click send without charge, i have an error message because clearance are warehouse handled only (which is good for the block) but all these price drops if not in the same warehouse doesnt need to be in potential price drop, it should be separated in a list or filter (inactive by default)"*
>
> *"the rule of split applies on any source but only on different warehouse but same province and clearance only"*

**The rule** (one definition: `backend/lib/potentialDropLists.isClearanceElsewhere`):

| Condition | Meaning |
|---|---|
| Clearance only | The price ends in .97 (`costcoPriceRules.classifyPrice`). No other price ending is ever split off. |
| Any source | The evidence's source is not read: another shopper's receipt, a tag, a website post or the flyer all count the same. |
| Same province, other warehouse | A card is one (product, province, price), so every line on it is in the province. The card is split off when **no** line was bought at a warehouse the clearance was seen at (`sameWarehouse` false on every line). A line whose warehouse was not recorded does not match a warehouse either. |

A .97 card with at least one same-warehouse line stays on the main list: it can be sent without charge, and that send skips its other lines.

**Where it is read:**

- `GET /api/admin/potential-drops` puts `clearanceElsewhere` on each card and adds `clearanceElsewhereCount`. Both are additive; `count` and `lineCount` keep their old meaning (every card).
- The admin push alert (`jobs/adminAlerts`, `listPotentialKeys` in `server.js`) never announces such a card.
- The app splits the cards into **Potential price drops** (default) and **Clearance at other warehouses** (a chip, off by default). The app falls back to "a .97 with no same-warehouse line" only for a server that sends no `clearanceElsewhere`.

**Select all (both lists, and the held drops):** the price-drop queue's bulk bar.

- Main list: *Not a real price* / *Verify selected* / *Verify and skip selected*.
- Clearance list: *Clearance · skip selected*. There is no bulk send: a clearance is sent one card at a time, after a look.
- Held low-confidence drops: *Reject selected* / *Approve selected*, through the queue's own `POST /api/admin/price-drop-queue/bulk`.
- Changing lists clears the ticks, so a hidden card is never decided blind.

`POST /api/admin/potential-drops/bulk` takes `{ decision: verify | reject | skip | clearance_skip, groups: [{ productId, provinceCode, price }] }` (1 to 100 cards). It uses the same repo functions as the single routes. For `skip` and `clearance_skip`, the lines come from the server's own list (one `listPotential` read per call), never from the request. `verify` runs **one sweep per province** instead of one per card. A card that is no longer waiting, or a non-.97 card sent to `clearance_skip`, is reported in `skipped` with its reason, and the other cards still go through. **Cost:** one bulk call replaces N single calls, and N province sweeps become one per province.

**Card design:** the cards now follow the price-drop queue's structure: a tick, the position and the name in the head row; bordered badges; a *paid → unverified price* row; link chips. They keep the Potential desk's amber colours. The button reads **Sold by the pack** (the server route and column keep their old `weighted` names).

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
