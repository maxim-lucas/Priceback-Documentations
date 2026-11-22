# Fresh Kirkland products: shelf price per kg in the harvest and the price lookups (BUILT 2026-11-22)

Written 2026-11-22 for the implementer (Opus). **Built the same day: see §10 for what was built, where it differs
from this spec, and what is left.** Ask from Maxim, in his
words (2026-11-22): *"all the sold by the pack items (meat, chicken, …) kirkland label only should be priced by kg not
by pack because it fluctuates a lot and is not accurate since the fill started"*; *"fruits can sometimes be sold by
the pack but should still be by the pack because it is not Kirkland labelled"*; *"only fresh products (meat, chicken,
chicken breast, …)"*; *"prepared meals are Kirkland also and I think are sold by kg"*; *"it should only be for the
harvest and the price lookup but not for receipts, receipts are by the pack price always (so a saving of $6 drop on
the paid amount by the shopper, not based on kg) … saving is by the pack, raw price is per kg; these products should
be flagged as sold by the pack in the database for future treatment"*; *"I want every single product in every
warehouse in the database"*; *"it should work in the admin price lookup and in the user warehouse price lookup under
testing in main-test-features"*.

## 1. Why (measured 2026-11-22, production)

Same-Day prints a fresh pack at **that pack's price**, and the pack's weight is in `size`. Read live at Drummondville
(1127): Kirkland Atlantic Salmon `size "1.08 kg"` `price $39.99`; Seasoned Nagano Pork Chops `1.542 kg` `$21.99`;
Chicken Penne Alfredo, *average* `1.5 kg` `$23.53`; Organic Split Chicken Wings `size "per lb"` `$37.38` (a rate).
The same product at another warehouse is another pack: another weight, another price. `planRegularPrices` takes the
most common price in a province as the province price, so the stored price is one random pack's, and the province
gets many one-off warehouse rows. The per-kg price (`price ÷ weight`) is the same at every warehouse.
`regularOfSamedayItem` returns `null` for a `per lb` / `per kg` item, so those have **no stored price at all** today.

## 2. The rule: one definition (`backend/lib/freshKgPricing.js`, new, pure)

A Same-Day reading is stored **per kg** when ALL hold:

1. **Kirkland Signature** (brand, or the name starts with "Kirkland Signature"). Not Kirkland → by the pack,
   always (fruit, eggs, every other brand).
2. **Fresh by category** (`product_categories.name_en`, Instacart's own; `products.category_id`): meat, poultry, fish,
   seafood and **prepared meals**. Written as an allow-list of words (beef, steak, ribs, roast, tenderloin, ground,
   chicken, pork, lamb, turkey, salmon, fish, shrimp, seafood, sausage, bacon, prepared, …) **minus** an exclusion
   list: `frozen`, `deli`, `broth`, `jerky`, `pet`/`dog`/`cat`/`formula`, spice. Examples from production:
   in — "Chicken Breast", "Whole Chicken", "Ground Beef", "Salmon Fillets", "Strip Steak", "Short Ribs", "Pork
   Tenderloins", "Italian Sausage", "Prepared Beef", "Prepared Grilled Chicken"; out — "Frozen Chicken Breasts",
   "Frozen Salmon", "Deli Turkey", "Meat Jerky", "Chicken Broth". Maxim confirmed: sliced bacon / sausage in the
   list is his call, default **in**; **Deli stays by the pack** until he says otherwise. The list is data in the module
   with a test that pins every category name currently in production (`select name_en … from product_categories`).
3. **Same-Day gives a weight or a rate**: `size` is `N kg` / `N g` / `per lb` / `per kg` / `per 100 g`. A `size` of
   `1 each`, `N ct`, a volume or empty → **not convertible → stays by the pack** (never guess a weight).

> ⚠️ **Superseded (2026-11-22, §10): the conversion below misreads Same-Day.** Built: `perKgOfReading`, Same-Day's own rate first.

Conversion as first specified (one function, `perKg({ price, size })` → number or `null`): kg = N; g = N/1000; `per lb` →
price × 2.20462; `per kg` → price; `per 100 g` → price × 10. Round to cents. Use the item's own strings with
`moneyAnyLocale` (a French session prints `27,99 $`).

## 3. Storage (additive, nothing existing changes)

- **Migration 0059** (next free; `0058_warehouse_address` is the last): add two rows to `priceback.regular_price_kinds`:
  `warehouse_kg` (in-store shelf price per kg) and `sameday_kg` (Same-Day delivery price per kg). Idempotent
  (`ON CONFLICT (code) DO NOTHING`). Expand → migrate → contract: apply to production by hand **before** the code
  deploys (`Technical/Backend_Backward_Compatibility.md` rule 4); regenerate `backend/db/deploy/schema.sql`.
- **Why new kinds and not overwriting `warehouse` / `sameday`:** the savings path reads kind `warehouse` /
  `sameday` as a **pack** price and must not move: `repos/costcoImportRepo.js` (applies an admin's upload saving to the
  province's warehouse regular), `repos/dealsRepo.js` ("was" price), `repos/savingsRepo.js` (online regulars).
  A $6 saving applied to a per-kg regular would be wrong. The harvest keeps writing the pack rows exactly as today
  (no regression); the per-kg rows are written **in addition** for qualifying products, and **the lookups read the
  per-kg rows for those products**. (Maxim's "replace" is satisfied where it is seen: the lookups. Dropping the noisy
  pack rows for these products is a later, separate step once nothing reads them.)
- **Flag them sold by the pack**: set `products.is_weighted = true` (the existing "sold by the pack" flag,
  `priceDropRepo.soldByThePackIn`) for every product the rule qualifies, in the same write. Effect, already decided by
  Maxim's rule 8: such a product's drop is always the full official saving, priced paid − saving, never another pack's
  shelf price. **Receipts, price drops and savings are not changed by this work**: no file in `services/savings/`,
  `receiptParsers/`, `priceDropRepo`, `savingDropRepo` is edited. A test pins that a saving of $6 on a $24 pack is a
  $6 drop with the product flagged and per-kg rows present.

## 4. The harvest (where it plugs in)

`backend/services/catalog/sources/samedayCatalogSource.js`, `readAt` in the price pass (~line 290): after the existing
`prices.push({ … kind, price })`, if the item's sku is in a **fresh-Kirkland sku set** (passed in like `known`:
`jobs/harvestCatalog.js` → `repo.freshKirklandSkus()` → `adapters/index.js` → `checkpointPrices`-style option) and
`perKg(...)` is a number, also push `{ …, kind: kind === "warehouse" ? "warehouse_kg" : "sameday_kg", price: perKg }`.
For a `per lb` item `regularOfSamedayItem` returns null, so the pack row is skipped as today; the per-kg row still
comes from the raw `price`. `catalogIngest.ingest` already groups readings by `kind` and `planRegularPrices` plans
each kind on its own, so the new kinds need **no** change there; the checkpoints (1,000 readings) already carry the
`kind`. Province price = the most common per-kg price in the province (stable now, because per kg does not depend on
the pack). `writeRegularPrices` takes `kind` as a parameter and joins `regular_price_kinds` by code, so it works once
the migration is in.

**Backfill / re-read:** a fill mode that reads only the fresh-Kirkland skus at every warehouse (`--only-skus` already
exists on the CLI as `--only`; add `config.freshKirklandOnly`), run per province with the existing per-province fill
sources (QC and ON first, then the Business Centre fill, then AB, NB, BC, SK, MB, NS, NL, PE — Maxim's order).

## 5. The lookups (three readers, one rule)

Every reader must call the same helper (`freshKgPricing.pricedPerKg(product)` / the SQL twin, defined beside it) —
never a screen-local copy (CLAUDE.md "One rule, one function").

| Reader | File | What to change |
|---|---|---|
| Admin price lookup | `backend/repos/adminPriceLookupRepo.js` (place filter ~l.408, select ~l.451) | for a flagged product read kind `warehouse_kg` / `sameday_kg` instead of `warehouse` / `sameday`; return an additive `unit: "kg" \| "pack"` per price |
| Price history | `backend/repos/priceHistoryRepo.js` (`SHELF_KIND = "warehouse"`, `regulars()`) + `services/priceHistory/priceHistoryService.js` | same swap per product; `officialLine` stays "regular less the official saving", so for a per-kg product the saving is **not** subtracted from a per-kg price (a pack saving is not a per-kg amount) — render the per-kg regular only |
| User "Warehouse prices" (main-test-features, #610) | `backend/server.js` `GET /api/me/warehouse-prices` (~l.14123), `src/services/warehousePricesService.js`, `src/screens/WarehousePricesScreen.js` | same; show "$/kg" next to the price |

Display: per-kg price label "$/kg" everywhere it is shown, **translated** (`src/services/i18n.js`, `en` + `fr`, then
`npm run i18n:check`); the admin screens stay English. A product whose per-kg price is unknown (size not
convertible) keeps showing its pack price, labelled by the pack. Old app builds: the new `unit` field is additive and
ignored by builds that do not know it, but **they would show a per-kg number as a pack price** — only the new
lookup (main-test-features, not in any store build) and the admin screen read it, so state in the PR which builds call
the changed routes (CLAUDE.md "backend never breaks an installed build", rule 7).

## 6. Open bug to trace first: Drummondville eggs show no price in the admin lookup

Reproduced as data, not yet as screen: production has Kirkland Free Run Large Eggs (sku 1706959) `warehouse` QC province
price **$8.99** and Same-Day $10.20, and warehouse 1127 (Drummondville) has only 12 warehouse rows **by design** (a
warehouse gets its own row only where its price differs from the province's). `adminPriceLookupRepo` l.408–413 already
falls back from a warehouse to its province row (`warehouse_id IS NULL AND province_id IN (warehouseProvinceIds)`), so
the cause is somewhere else on that path — candidates: the channel filter (a province row exists in both `costco` and
`business_centre`), the `warehouseProvinceIds` being empty when the picked place is a warehouse with a null
`province_id`, or the per-kind filter. Reproduce with the screen's exact request against production (read-only) and
fix at the cause. Same for "chicken sometimes in some warehouses, meat": check whether those products simply have only
pack prices that disagree between warehouses (this spec's case) or a real hole.

## 7. Tests (all in the same PR, per the full-coverage rule)

- `freshKgPricing.test.js`: the rule on a table of real names/categories/sizes above (in/out), `perKg` on `1.08 kg`,
  `680 g`, `per lb`, `1 each` (null), `24 ct` (null), French `27,99 $`; the category list pinned to production's names.
- Harvest: a fake client returning two warehouses with different pack weights → the pack rows differ, the per-kg
  rows are identical and the province per-kg row is that value; a non-Kirkland fruit pack gets **no** per-kg row.
- Flag: qualifying product → `is_weighted` true; the $6-saving drop is unchanged (use the `savingDropRepo` path).
- Lookups: the three readers return per-kg for a flagged product and pack for a fruit pack; `unit` field present.
- `catalogNationwideFill.test.js` still passes; `costcoPathImmutability` untouched (no shared parser file edited).

## 8. Roadmap (added to `Roadmap/FUTURE_ROADMAP.md`)

*All product categories saved in the database (`product_categories`, English + French) should appear in the price
lookup screens: a category filter / grouping in the admin lookup and in the user's warehouse-price lookup (Maxim,
2026-11-22).* The data exists already (`products.category_id`, categories for ~all harvested products).

## 9. State of the data fill this spec depends on (2026-11-22)

Quebec and Ontario are fully filled (every warehouse, in store and delivery); Business Centre catalogue (5,999 items)
and its fill (`sameday_business_centre_fill`, created disabled, run by hand) are running; Alberta and the other
provinces follow. Failed warehouses are now retried by the Same-Day client (PR #642 / #643) and can be re-read alone
(`--warehouses 518,528`).

## 10. As built (2026-11-22)

**Code** (PR to `main`, then `main` merged into `main-test-features`; the shopper's warehouse prices on
`main-test-features` only):

| Piece | Where |
|---|---|
| The rule, one definition | `backend/lib/freshKgPricing.js`: `isKirkland`, `isFreshCategory`, `qualifies`, `perKg`, `KG_KIND` / `PACK_KIND`, `preferKgRows`, `oneUnit`, `unitOf` |
| The Same-Day reading per kg | `services/catalog/regularPrices.perKgOfSamedayItem` reads the strings (beside `regularOfSamedayItem`, unchanged) → `freshKgPricing.perKgOfReading` decides |
| The sku set + the flag | `productCatalogRepo.freshKirklandSkus({ flag })`: qualifies every product by its category and a Kirkland brand / name on any catalogue listing, sets `products.is_weighted = true` (never clears it) |
| The harvest | `jobs/harvestCatalog.runSource` → `adapters` (`freshKgSkus`) → `samedayCatalogSource.readAt` pushes a `warehouse_kg` / `sameday_kg` reading beside the pack reading; checkpoints are one call per kind |
| Backfill | `config.freshKirklandOnly` (prices mode), CLI `--fresh-kirkland-only` |
| Storage | migration `0059_fresh_kg_price_kinds` (ids 4 and 5) |
| Price history / admin lookup | `priceHistoryRepo.regulars` reads `warehouse` + `warehouse_kg`, keeps the per-kg rows per product **and province** (`preferKgRows`); `priceHistoryService.officialInputs` keeps one unit per line (`oneUnit`), applies no saving and no price point to a per-kg line, returns `unit`; `historyFor` / `searchFor` return `unit` (additive) |
| Admin screens | `AdminPriceLookupScreen` / `AdminPriceHistoryScreen`: "$x / kg" and a one-line note (English, admin-exempt) |
| Shopper warehouse prices (`main-test-features`) | `GET /api/me/warehouse-prices` returns `unit`; the screen shows the translated "/kg" |

**Where it differs from the spec:**

- 🔴 **§2's conversion was wrong for the products that matter, and is replaced.** Raw Same-Day items read at
  Drummondville (1127) on 2026-11-22, English and French sessions (fixture
  `backend/tests/fixtures/catalog/sameday-fresh-kg-items.json`) show that **Same-Day states the per-kg price itself**,
  and that the item's `price` is often **not** a pack's price:

  | Item | `size` | `price` | What the card says | Spec's §2 | Built |
  |---|---|---|---|---|---|
  | Organic Split Chicken Wings 47969 | per lb | $37.38 | `$37.38 /pkg (est.)`, `pricingUnitString` **$16.99 / kg** | $82.41 | **$16.99** |
  | Seasoned Nagano Pork Chops 15048 | 1.542 kg | $21.99 | `priceSuffixString` **/kg** ("$21.99 per kilogram") | $14.26 | **$21.99** |
  | Boneless Skinless Chicken Breasts 55503 | 1 each | $34.77 | `/pkg (est.)`, **$15.69 / kg**, "About 2.22 kg / package" | none | **$15.69** |
  | Spiral ham 13689 | per kg | $38.39 | `/pkg (est.)`, **$8.99 / kg** | $38.39 | **$8.99** |
  | Chicken Penne Alfredo 15206 | 1.5 kg | $23.53 | `each (est.)`, **$14.99 / kg** | $15.69 | **$14.99** |
  | Atlantic Salmon 46340 | 1.08 kg | $39.99 | no rate: a fixed pack | $37.03 | $37.03 |
  | Sliced Bacon 104847 | 500 g | $19.99 | card quantity **4 x 500 g** | $39.98 | **$9.99** |

  The order of trust (`freshKgPricing.perKgOfReading`): (1) the card's own rate (`itemCard.pricingUnitString`,
  "$16.99 / kg"; on sale, none: the shown rate may be the sale rate); (2) a price printed per weight
  (`itemCard.priceSuffixString` "/kg"): the regular price is the per-kg price; (3) a pack with a stated weight and no
  rate: regular ÷ weight, the card's quantity line first ("4 x 500 g"), never for an estimated price ("/pkg (est.)",
  "/pqt (est.)", "env. par unité"). The pack reader `regularOfSamedayItem` is unchanged.
  **Cost of not checking:** every rate item (most fresh meat) would have been stored 2–5× off.

- **`backend/db/deploy/schema.sql` is not regenerated.** `scripts/build-consolidated-schema.js` is retired: the
  file is frozen at the first production version (Maxim, 2026-11-09). Ship the migration file + journal entry only.
  §3 of this spec was wrong on that point.
- **The admin lookup has no change in `adminPriceLookupRepo`.** That repo reads price points; the shelf regular
  prices reach the lookup through `priceHistoryService.searchFor` → `priceHistoryRepo.regulars`, so the swap is there,
  once, for the admin lookup, the history screen and the shopper's tool together.
- **Per province, not per product.** A product shows per kg in a province that has a per-kg row and by the pack in one
  the backfill has not reached yet. A line (nationally, several provinces) never mixes the two (`oneUnit`).
- **`N lb` and `N x W` sizes** are read as a weight too (`2 lb` → 0.907 kg, `4 x 500 g` → 2 kg).
- **The French "par lb", "le kg" / "au kg"** are read as rates.
- **A dry run never flags**: the CLI's `--dry-run` calls `freshKirklandSkus({ flag: false })`.

**What production says about the rule (read 2026-11-22):**

- Instacart files **Kirkland Signature Atlantic Salmon (46340, the 1.08 kg / $39.99 example of §1)** and the other
  salmon packs under **"Frozen Salmon"**, so the rule as written keeps them **by the pack**. If they are fresh in the
  warehouse, the fix is a per-sku override list in `freshKgPricing` (Maxim's call), not a looser word list.
- Items with the size **`1 each`** (Boneless Skinless Chicken Breasts, Thighs, Salmon Portions) DO get a per-kg price:
  the card states the rate.
- A pre-existing gap noticed on the way, not changed: in a French session `regularOfSamedayItem` reads "par lb" as a
  pack (it gives $37.38 for the wings). The harvest switches to English before the price pass, so it is not hit today.
**§6, the Drummondville eggs:** not reproduced. Production (read-only, 2026-11-22): Kirkland Free Run Large Eggs
(product 27996, sku 1706959) has a `costco` / `warehouse` QC province row at $8.99 since 2026-11-04, no running saving;
warehouse 1127 is `costco`, province QC (id 11). Replaying `officialInputs` + `officialLine` on exactly those rows at
1127 gives **$8.99**. So the price layer answers; the cause, if it still happens, is in the request (the place the
screen sent, the search not returning product 27996) — the next step is the screen's exact query string.

**Deploy order:** ✅ `0059` applied to production by hand on 2026-11-22 (ledger row 70, LF hash `c5928943…`), and to dev.
On `main-test-features` the journal entry is `idx 60` (idx 59 there is `0057_warehouse_stock_reads`). Separately, that
branch's journal has no entry for `0053_store_spaces_v2.sql`, which predates this work. Originally: A deploy before
the migration is harmless (a per-kg reading is simply not written: `writeRegularPrices` joins the kind by code), but
nothing shows per kg until the migration and a backfill have run.

**Backfill, Maxim's order:** QC and ON first, then the Business Centre fill, then AB, NB, BC, SK, MB, NS, NL, PE:
`node --env-file=.env scripts/harvest-catalog.mjs --source <fill> --mode prices --provinces QC --fresh-kirkland-only`.
Not started: the per-province fills are running on the same PC.

**Tests:** `tests/freshKgPricing.test.js` (rule, every production Kirkland category pinned, the reader on the real
fixture in both languages, the harvest with
two pack weights, the job, the lookups' rule), `tests/freshKgPricingDb.test.js` (the flag, the per-kg rows, the price
history reader), `tests/savingsHarvestDb.test.js` (a flagged product with per-kg rows keeps its full pack saving as
the drop), the two admin screen suites.
