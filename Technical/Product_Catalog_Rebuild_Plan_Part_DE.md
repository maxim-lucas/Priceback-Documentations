# Parts D–E — Product model, regular prices per place, full harvest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Costco Canada product on file with its official EN/FR name, its full-length name with size, its receipt short names (EN/FR), a `costco` / `business_centre` channel, and its regular prices per place (warehouse shelf, Same-Day delivery, website) — filled by the catalogue harvest.

**Architecture:** One additive migration (0043) adds two lookup tables, the new `products` / `warehouses` columns and `product_regular_prices`. The existing catalogue harvest already reads every Same-Day item through the in-store shop; it now keeps the price, reads each product at a fixed number of warehouses per province (plus a delivery read), and the costco.ca reader keeps the JSON-LD offer price. Pure planners (`services/catalog/regularPrices.js`, `services/catalog/receiptNames.js`) decide; `productCatalogRepo` writes set-based. Channel and receipt names are refreshed set-based at the end of each harvest tick.

**Tech Stack:** Node.js (CommonJS), drizzle-orm + raw `sql`, PostgreSQL (Supabase), `node:test`, c8.

**Spec:** `Technical/Product_Catalog_Rebuild_Design.md` §5 (decisions 4–6, 11, 12, 14), §6.3, §6.4, §6.5, §6.8.

**Branch:** `hotfix/products-catalog-model`, cut from `hotfix/egress-and-job-schedules` (it uses `lib/feeLines`) → PR into `main` after Part A merges (rebase onto `main` then).

## Global Constraints

- Migration **0043** (`main` ends at 0042; `main-test-features` has 0041): additive, idempotent, applied to **dev** by this plan, to **prod by hand on Maxim's go before the code deploys**, then the ledger row; consolidated schema regenerated (`node scripts/build-consolidated-schema.js`).
- Lookup tables (`id`, `code`, `label`), never free-text enums. `channels`: `1 costco "Costco"`, `2 business_centre "Business Centre"`. `regular_price_kinds`: `1 warehouse "Warehouse shelf price"`, `2 sameday "Same-Day delivery price"`, `3 website "Website price"`. The migration inserts them with these **fixed ids** (the NOT NULL defaults need them) and bumps the sequences; `db/seed.js` upserts the same codes/labels.
- `products.channel_id` and `warehouses.channel_id`: `NOT NULL DEFAULT 1` — every existing insert path keeps working unchanged.
- Money `numeric(10,2)`. A weighted item (per-kg / per-lb price) gets **no** regular price.
- Official names (`display_name`, `display_name_fr`) are **not** changed by this work beyond today's harvest rules (Maxim, decision 12).
- Fee products (`lib/feeLines.isFeeLine` on the product's name, or every line it ever had is a fee line) get no price row, no receipt name, and never count for the channel.
- No old-build-visible change: no route, field or meaning; new columns are not added to existing responses.
- Egress: no per-item query loops; set-based `jsonb_array_elements` writes in chunks of 500 (the repo's `_chunks`).
- Same-Day politeness: requests through `SamedayClient` (its spacing); a `blocked` / `layout_changed` error ends the read; sanity floors stay.

## Review Focus

1. **A province where Same-Day has one warehouse** (NL, NS): its province row is that warehouse's price, no warehouse rows. Test in Task 2.
2. **Two warehouses of a province disagree and there is no majority** (2 read, 2 prices): the province row takes the **lower** price, the other warehouse gets its own row. Test in Task 2.
3. **An item on sale at read time**: the regular is the strikethrough price, never the sale price. Test in Task 2.
4. **A product whose every receipt line is a fee, or edited by the shopper, or filled from the database**: no receipt name. Test in Task 5.
5. **A Business Centre-only item later found at a regular warehouse**: the channel flips to `costco` on the next refresh. Test in Task 6.

---

### Task 1: Migration 0043 + schema

**Files:** Create `backend/db/migrations/0043_product_catalog_model.sql` (+ drizzle meta via `npm run db:generate -- --name product_catalog_model`, then hand-edit the SQL to be idempotent and to insert the fixed-id lookups); Modify `backend/db/schema.js`, `backend/db/seed.js`, `backend/db/deploy/schema.sql` (regenerated); Test `backend/tests/productCatalogModelDb.test.js`.

**Interfaces — Produces (schema.js exports):** `channels`, `regularPriceKinds`, `productRegularPrices`; on `products`: `receiptName` (`receipt_name`), `receiptNameFr`, `fullName`, `fullNameFr`, `channelId`; on `warehouses`: `channelId`.

`product_regular_prices`: `id bigserial pk`, `product_id int NOT NULL → products ON DELETE CASCADE`, `channel_id int NOT NULL → channels`, `kind_id int NOT NULL → regular_price_kinds`, `province_id int NULL → provinces` (NULL = national), `warehouse_id int NULL → warehouses ON DELETE CASCADE` (NULL = the province's price), `regular_price numeric(10,2) NOT NULL`, `source_code text NOT NULL` (the catalogue/savings source code or `receipt` / `admin_upload`), `first_seen_at`, `last_seen_at timestamptz NOT NULL DEFAULT now()`, `last_run_id bigint NULL`; unique `NULLS NOT DISTINCT (product_id, channel_id, kind_id, province_id, warehouse_id)`; index `(product_id)`.

- [ ] Step 1: failing DB test — after migration: lookups have the fixed ids/codes; a product inserted without `channel_id` reads `channel_id = 1`; a `product_regular_prices` duplicate `(p, 1, 1, NULL, NULL)` violates the unique index; deleting the product cascades its price rows.
- [ ] Step 2: run → FAIL (relation does not exist). `node --env-file=.env --test tests/productCatalogModelDb.test.js`
- [ ] Step 3: schema.js + migration + seed; apply 0043 to **dev** (`npm run db:migrate` against dev — confirm `postgres.gnedluuylimjwdmtvswl` in the URL first); regenerate the consolidated schema.
- [ ] Step 4: run → PASS; `node --test tests/schemaParity*.test.js` (whatever pins schema vs consolidated) green.
- [ ] Step 5: commit `feat(db): 0043 product catalogue model — channels, regular price kinds, receipt/full names, product_regular_prices`.

### Task 2: Regular-price planner (pure)

**Files:** Create `backend/services/catalog/regularPrices.js`; Test `backend/tests/regularPrices.test.js`.

**Interfaces — Produces:**
- `regularOfSamedayItem(raw) → number|null` — `parseItem(raw)` (services/savings/samedayItems): `regular ?? price`; null when the price or size reads per weight (`/\/\s*(kg|lb|100\s*g)|per\s*(kg|lb)|le\s*kg/i` on the price strings or size).
- `planRegularPrices(readings, { channel, kind }) → Array<{ sku, provinceCode, warehouseCode|null, price }>` — `readings` = `[{ sku, provinceCode, warehouseCode, price }]`; per (sku, province): province price = the most frequent price, ties → the lowest; a warehouse row only where its price ≠ the province price; one reading → province row only.

- [ ] Step 1: failing tests: on-sale item → strikethrough; not on sale → price; per-kg → null; Review Focus 1–3; three warehouses 9.99/9.99/10.49 → province 9.99 + one warehouse row 10.49.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(catalog): plan regular prices per province, warehouse rows only where different`.

### Task 3: Same-Day catalogue source reads prices per province

**Files:** Modify `backend/services/catalog/sources/samedayCatalogSource.js`; Test `backend/tests/samedayCatalogSource.test.js` (existing fake-client tests; extend).

**Interfaces — Consumes:** Task 2. **Produces:** the adapter result gains `prices: Array<{ sku, provinceCode, warehouseCode, kind: "warehouse"|"sameday", price }>` (additive; `items` unchanged).

- After the discovery and French passes: for each province, the first `config.priceWarehousesPerProvince` (default **2**) warehouses of `locationOrder` (all warehouses, not only those read for discovery) read **every found product** through the in-store shop → `kind: "warehouse"`; and the first warehouse of each province through the **DELIVERY** shop → `kind: "sameday"`. `regularOfSamedayItem` for each; null skipped. A `blocked` error stops the price pass but keeps what was read.
- [ ] Step 1: failing test with the fake client (two provinces, two warehouses each, one item on sale, one per-kg) → expected `prices`. Step 2: FAIL. Step 3: implement. Step 4: PASS + the file's existing tests. Step 5: commit `feat(catalog): Same-Day catalogue keeps in-store and delivery regular prices per province`.

### Task 4: Write regular prices; move `price_sameday` writers

**Files:** Modify `backend/repos/productCatalogRepo.js` (`writeRegularPrices`), `backend/services/catalog/catalogIngest.js` (call it with the plan), `backend/repos/savingsRepo.js:~497` and `backend/repos/costcoImportRepo.js:~125` (write the table, stop writing `price_sameday`), `costcoImportRepo.regularsForSavings` (read the table first: `warehouse` kind, `last_seen_at` ≥ now − `REGULAR_PRICE_FRESH_DAYS` (new app_config key, default 35), province row; fallback to today's `price_points` lookup); `backend/config/defaults.js` (the key); Test `backend/tests/regularPricesDb.test.js`.

**Interfaces — Produces:** `writeRegularPrices(rows: Array<{sku, provinceCode, warehouseCode|null, price}>, { channel: "costco"|"business_centre", kind: "warehouse"|"sameday"|"website", source, runId }, db?) → Promise<{ written: number, removed: number }>` — upsert on the unique key (set `regular_price`, `last_seen_at = now()`, `last_run_id`, `source_code`); then delete warehouse rows of the same (product, channel, kind, province) that this write did not include and whose price now equals the province row; fee products excluded.

- [ ] Steps: failing DB tests (write twice → same rows, `last_seen_at` advances; a warehouse that now matches its province loses its row; a fee product gets nothing; the admin upload writes `sameday` rows and no longer touches `price_sameday`; `regularsForSavings` prefers a fresh table row over an older price point and ignores one 36 days old) → FAIL → implement → PASS (+ `costcoImport*` / `savings*` suites) → commit `feat(catalog): product_regular_prices written by the harvest and the admin upload`.

### Task 5: Receipt names (EN/FR)

**Files:** Create `backend/services/catalog/receiptNames.js`; Modify `backend/repos/productCatalogRepo.js` (`receiptNameLines`, `writeReceiptNames`); Test `backend/tests/receiptNames.test.js`, `backend/tests/receiptNamesDb.test.js`.

**Interfaces — Produces:** `chooseReceiptNames(lines: Array<{productId, printedName, language: "en"|"fr"}>) → Map<productId, {en: string|null, fr: string|null}>` — per product and language the most frequent trimmed upper-cased text, ties → most recent (input order = newest first); `refreshReceiptNames(db?) → { updated }` — reads live lines that are not fee lines, not `shopper_edited_at`, not `name_from_database`, with the receipt's language = `shared/receiptLocale.receiptLabelLanguage(raw_ocr)`, else `fr` when the receipt's warehouse is in QC, else `en`; writes only products whose name differs and whose name is not admin-locked (`name_locked_at`).

- [ ] Steps: pure tests (Review Focus 4; `5 DOZ EGGS` ×2 vs `DOZ EGGS` ×1 → `5 DOZ EGGS`; FR line `OEUF 5 DOZ` → fr slot) → DB test (two receipts, one QC) → FAIL → implement → PASS → commit `feat(catalog): products keep their receipt short names in English and French`.

### Task 6: Full-length names + channel flag

**Files:** Modify `backend/repos/productCatalogRepo.js` (`writeCatalog`: `full_name` / `full_name_fr` = name + ", " + size from the same item when the size is not already in the name, same lock and outranked rules as the official name; `refreshChannels(db?) → { costco, businessCentre }`; `markWarehouseChannel(codes, channel)`), `backend/services/catalog/sources/samedayCatalogSource.js` (the Business Centre storefront's `WarehouseLocations` codes → `markWarehouseChannel(..., "business_centre")` via ingest); Test `backend/tests/catalogChannelDb.test.js`.

`refreshChannels`: `business_centre` when the product has evidence only from Business Centre (a verified listing from a BC source, a saving from a BC source, a receipt line from a BC warehouse, a BC price row) and none from regular Costco (a Costco source listing, a Costco saving, a regular-warehouse receipt line, a Costco price row, a flyer price point); otherwise `costco`. Fee products stay `costco` (the default; never counted).

- [ ] Steps: failing DB tests (Review Focus 5; full name "Large Eggs" + "60 ct" → "Large Eggs, 60 ct"; a name already containing its size stays as is; locked name → full name untouched) → FAIL → implement → PASS → commit `feat(catalog): full-length names and the costco / business_centre channel`.

### Task 7: costco.ca website price

**Files:** Modify `backend/services/catalog/catalogItems.js` (`parseProductJsonLd` returns `price` from `offers.price` / `offers[0].price` when `priceCurrency` is CAD), `backend/services/catalog/sources/costcoWebCatalogSource.js` (emit `prices` with `kind: "website"`, province null), `catalogIngest` (write them); Test `backend/tests/catalogItems.test.js` (+ a frozen JSON-LD capture with an offer).

- [ ] Steps: failing parse test → FAIL → implement → PASS → commit `feat(catalog): costco.ca and Business Centre pages keep their online price`.

### Task 8: Tick wiring, fee exclusion in the fixer, docs, dev run

**Files:** Modify `backend/jobs/harvestCatalog.js` (after a tick's runs: `refreshChannels`, `refreshReceiptNames`), `backend/repos/productCatalogRepo.suspectProducts` (exclude fee products), `scripts/harvest-catalog.mjs` (`--refresh-names`, `--refresh-channels`, `--max-pages all`); docs `Technical/Product-Catalog-Harvest.md`, `Technical/database_design.md` (exception to rule 10), task log, Bugs if any.

- [ ] Steps: failing test that a fee product is never a suspect → FAIL → implement → PASS; full backend suite; **dev run** (CLI, once each, never the scheduler): `--source sameday_costco_catalog`, `--source sameday_business_centre_catalog`, `--source costco_ca_catalog --max-pages all`, `--source costco_business_centre_catalog --max-pages all`, `--refresh-names`, `--refresh-channels`; report counts (products, with FR, with full name, with receipt name, by channel, price rows by kind); commit; PR.
