# Eco fees: prices without them, the fee said apart (2026-11-28)

**Ask (Maxim, 2026-11-28):** *"the prices includes the eco fees which is not accurate, even costco website show the
price + the eco fees, so we should do the same."* Then: *"the eco fees should just written in the price details screen
(price history page)"*, and *"write notes in the roadmap for the parser to save the eco fees in that column because eco
fees doesnt have SKUs."*

## What was measured (2026-11-28, SKU 2336300, Samsung HW-B630F soundbar, Abbotsford #163, BC)

| Where | What it prints |
| --- | --- |
| Same-Day, in-store shop (the catalogue harvest) | `$302.49`, card: "Incl. eco fees", details: **"Includes $3.50 eco fees."** |
| Same-Day, delivery shop | `$319.49`, same fee statement |
| costco.ca product page | the price, then **"Plus {feeAmount} Eco Fees"** (its pricing config: `STANDARD` in most provinces, `INTERNALIZED` in NB, a fee table in QC, `HIDDEN` for some fee types in NL / PE) |
| The receipt | the item's price, then the fee on **its own line with no item number** (`ECO FEE`, `ENVIRO FEE`, `*ÉCOFRAIS`; `shared/feeLines.js`) |

So `product_regular_prices.regular_price` held $302.49 where Costco's price is $298.99, and every province's shelf
price differed by its own eco fee (ON $298.99, QC $297.99, BC $302.49, NL $302.74).

## What shipped (Priceback, branch `feat/eco-fee-executive-filters`)

- **Migration 0070**: `eco_fee numeric(10,2)` on `product_regular_prices` and `product_regular_price_history`. NULL = no
  fee stated. `regular_price` keeps its meaning (what the source printed). Applied to prod and dev on 2026-11-28 with the
  ledger row (`created_at 1796400000000`, hash `1211b641…4468`).
- **One definition:** `shared/ecoFee.js` (`ecoFeeOfText`, `shelfPrice`, `ecoFeeShown`), SQL twin
  `backend/lib/ecoFeeSql.shelfPriceSql`, pinned together by `backend/tests/ecoFee.test.js`.
- **Harvest:** `samedayItems.ecoFeeOfSamedayItem` reads the item details' statement (EN + FR). The catalogue harvest
  carries it with each price through `planRegularPrices` / `warehouseRowsOnly` into `writeRegularPrices`. A writer that
  states no fee never wipes the fee of an unchanged price.
- **Readers:** the price history (`priceHistoryRepo.regulars`), Deals (`dealsRepo`), the flyer import's reference
  regular (`costcoImportRepo`) and the receipt quantity check (`receiptQuantityInference`) read the price **without** the
  fee. The savings harvest's Same-Day in-store price points are stored without it, so the price-drop sweep compares like
  with like (Maxim approved, 2026-11-28).
- **Screens:** every price is without the fee. The price details screen (Warehouse price history) says
  "Plus $3.50 eco fee" / "Plus 3,50 $ d’écofrais" under the price (`warehouseHistory.ecoFee`).
- Rows stored before 0070 have no fee until the next catalogue run reads them again.

## Roadmap: the receipt parser saves the eco fee too

The receipt is the other source of the fee, and it prints the fee **with no item number**: the fee line belongs to the
item line right above it (`shared/feeLines.js` already recognises it, and the register never counts it in ITEMS SOLD).
Today the parser marks the line `ignored` and nothing keeps its amount.

Proposed (not built, needs Maxim's go and the Costco-isolation rule below):

1. **Attach** each fee line to the item line it follows: same receipt, the nearest merchandise line above it, in the
   item block (the fee is per unit; `2 @` lines print the fee once per unit or as a total, measure on the corpus first).
2. **Save** the amount on that receipt line (a new nullable `receipt_items.eco_fee`, its own migration) and, when the
   receipt's warehouse is on the official list, as evidence for that product's fee at that warehouse. A receipt never
   writes `product_regular_prices` (official sources only): the receipt's fee fills `eco_fee` only where the harvest
   stated none, through `writeRegularPrices`'s rule (never wipe, never overwrite a stated fee), or in a separate
   evidence table if that rule is judged too loose.
3. **Use** it in the drop check: the paid price stays the line's price (no fee), so nothing in the sweep changes.
4. **Prove** on the whole prod-capture corpus: dump every fixture's parse before and after, diff line by line; only the
   new `ecoFee` field may move (design rules, ground rules corpus test).

**Costco isolation:** the attach step lives in the Costco parser's own post-step (or the registry), never in
`receiptParsingShared.js`, `receiptGeometry.js` or the shared cleanup (`__tests__/costcoPathImmutability.test.js`).
A Costco parser change needs Maxim's confirmation.

## Open

- costco.ca's online price (`kind = 'website'`, JSON-LD `price`) prints without the fee already: no change.
- Quebec prints the fee in a table and New Brunswick includes it: Same-Day's statement is read the same way everywhere,
  so the stored fee is right in every province; only costco.ca's display differs.
