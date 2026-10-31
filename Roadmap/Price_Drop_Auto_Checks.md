# Price-drop auto-checks: Sameday today, costco.ca next

*Maxim, 2026-10-30: "create different buttons in this case, two for each source (costco.ca and sameday) manual check (the existing button) and the autocheck (existing for sameday only for now) and documented in the roadmap for costco.ca (so today we will have 3 buttons and in the future 4)".*

## Today (3 buttons, inside each drop's confidence box, Admin · Price-drop queue)

| Source | Manual check | Auto-check |
|---|---|---|
| **Sameday** | basket icon: the item's page at the drop's province (`POST /api/admin/saving-dates/lookup`) | **Auto-check Sameday**: `POST /api/admin/price-drop-queue/:id/verify` re-reads the saving live at the shopper's warehouse and rescores the drop in place (savings drops only) |
| **costco.ca** | storefront icon: costco.ca's search by item number | **not built** |

If an auto-check fails, the manual buttons are still there. The confidence box used to show the Sameday re-check and "Open on Same-Day" a second time, under the icons. That duplicate is gone.

## Next: costco.ca auto-check (the 4th button)

What it would add to a drop's confidence, as new checks in `services/savings/dropVerifier` → `dropConfidence`:

- **online_listed**: the item number resolves to a costco.ca product page (many warehouse-only items, Same-Day SKUs and clearance items do not, and the check must then say "not online", never fail the drop);
- **online_price**: the online price and any online instant saving, against the drop's new price. Online and warehouse prices differ, so this is **advisory**, never a hard check;
- **online_saving_dates**: the coupon-book dates printed online, against the saving's dates (they can disagree by a week with Same-Day; the earliest wins, as `savingDropRepo` already does).

Open questions before building:

1. **Access.** costco.ca sits behind Akamai bot protection. The existing harvests read Same-Day (Instacart's front end) because costco.ca blocks plain server requests. We would need a headless browser or a proxy (Bright Data is on the plugin list), and a budget.
2. **Warehouse context.** costco.ca shows the *online* price, not a warehouse's. It cannot confirm a warehouse saving, only corroborate it.
3. **Rate.** One read per (saving, item), cached like `flags.liveChecks` (6 h), never per click.

When built: a button next to "Auto-check Sameday" in `AdminPriceDropQueueScreen.checkButtons`, its own endpoint (or a `source` field on `/verify`), and the new checks in the confidence text.
