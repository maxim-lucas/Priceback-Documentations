# Warehouse clearance (.97) drops

*Maxim, 2026-10-30. Code: `POST /api/admin/potential-drops/clearance` (`backend/server.js`), `potentialDropRepo.markClearance`, `priceDropRepo.NOT_CLEARANCE` / `RULE_OF_N_PRICE` / `ROW_VERIFIED`, `priceDropNotifier.sendClearanceDrops`; app `AdminPotentialDropsScreen`, `DetailScreen`, `services/releasedDrops`.*

## The rule

A Costco shelf price ending in **.97** is a clearance (`Costco-Price-Rules.md`). It holds **at the warehouse it was seen at**. It does not apply to the whole province, unless the same clearance runs in several warehouses at the same time. A clearance price can also vanish at any moment: the stock runs out, the item is "unrecognized" online, and a customer-service agent may refuse the adjustment.

> *"this price code *.97 is a warehouse and should always be considered in the same warehouse only not even on provinces except if there is the same clearance at the same time in different warehouses"* — Maxim

> *"Warehouse Specific: These markdowns are often set at the local store or regional level, meaning a .97 price at one Costco in Canada might not be available at another"* — Maxim, 2026-10-30

So two shoppers seeing the same .97 at two clubs prove the price **at those two clubs**, not across the province. That is why the count never verifies a .97 (§ "The rule of N never verifies a .97"). The regional case (the same markdown at several clubs) is handled by **Clearance · send without charge**. It reaches every line bought at a club where the price was seen, and no other line.

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

## The rule of N never verifies a .97 (2026-10-30, review of #520)

**The gap #520 left.** The buttons only act on a card that reaches the list, and a card reaches the list only while the price is *not yet verified*. With `PRICE_VERIFY_MIN_USERS` at 2–3, two or three shoppers seeing the same .97 at different clubs made the group verified **by count** (`findNotifiable`'s `HAVING COUNT(DISTINCT contributor) >= N`, `markNewlyVerified`'s stamp). It never showed on Admin · Potential price drops, and the sweep charged it to every buyer in the province. The same was true for a new .97 sighting after the button was used (a new, unstamped row). Prod on 2026-10-30: 284 crowd rows at .97 already carried `verified = true` without an admin's ruling: 275 `social_price_tag` rows, plus 9 tag scans the rule of N had stamped. No drop had been charged from them yet. The one charged .97 drop in prod (line 2084, $14.97, 75 credits, 2026-10-14) was an admin's own "Verify price", before this rule existed.

**Now** (`priceDropRepo.RULE_OF_N_PRICE`, `ROW_VERIFIED`):

- No number of shoppers verifies a crowd price ending in .97. This holds in all four rule-of-N spots: `findNotifiable`, `getLatestVerifiedPrice` (the app's price check), `markNewlyVerified`, and `potentialDropRepo.listPotential`. The card waits on Admin · Potential price drops, however many shoppers see the price.
- A .97 crowd row's bare `verified = true` counts only when the admin's own **Verify price** stamped it (`flags.potentialDropVerifiedBy`) or `flags.adminVerified` is set. The 284 stamped rows above therefore stop counting province-wide and come back on the list.
- "Verify price", "Reject" and the two clearance buttons stamp every row nobody ruled on (`NOT ROW_VERIFIED`), not just `verified = false`. Without this, "Verify price" on a returning card would stamp nothing and the card would never leave.
- **Verify price** stays the admin's way to say *"the same clearance at the same time in different warehouses"*. That makes it a province drop, charged as usual.
- Untouched: a flyer row (Costco's own publication; its own source test), and every other price ending.
- Known side effect: a tag scan an admin verifies row by row on the OCR review (`pricesRepo.verifyPricePoint`) sets only `verified`. At .97 that row no longer counts province-wide either. That fits the rule (the tag proves the price at that club, not the province).

Tests: `backend/tests/potentialDropDb.test.js` › *no number of shoppers makes a .97 province-wide* and *a .97 the rule of N stamped earlier is no verified price; the admin's Verify still rules*. Each was mutation-checked (reverting either guard turns it red).

**Old app builds:** no route, field or shape changed. The app's price check (`getLatestVerifiedPrice`) can return *no verified price* for a .97 it called verified before, a path every build already handles.

## Not done (known limits)

- **No warehouse matching.** A .97 still never becomes a drop *automatically*, even for the buyer's own club. The admin sends it with **Clearance · send without charge**. An automatic "a .97 counts at its warehouse" would need `findNotifiable` to match the evidence to the buyer's warehouse. Maxim chose the button.
- **.00 / .88 manager markdowns** are warehouse-only too (`costcoPriceRules`), but the rule of N still verifies them province-wide. Not in Maxim's ask; open.
- **The Price-Drop Guarantee** does not count a clearance drop (no `_stampGuarantee`): it is uncertain by nature.
