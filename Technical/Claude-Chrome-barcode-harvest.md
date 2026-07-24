# Runbook: Claude-on-Chrome weekly barcode↔SKU harvest

**Status: OPERATIONAL PROCEDURE (no app code).** Bulk complement to the in-app admin
[barcode feeder](#see-also) and the off-Railway script harvester
(`backend/scripts/harvest-barcodes.mjs`). This is the manual/assisted browser flow Maxim runs
weekly to populate `products.barcode` for Costco SKUs that are sold online.

## Why this exists

Costco keys every price by warehouse **SKU**; the app scans the manufacturer **UPC/EAN**. Costco
publishes **no structured GTIN** (see [`Dual-capture.md`](Dual-capture.md)), and `costco.ca` is
Akamai-walled — a plain `fetch`/script can't read product pages. A real browser session driven by
**Claude in Chrome** gets past the wall: it can open the product page, view the gallery image, and
read the UPC/EAN printed on the package, then hand the `{ sku, barcode }` pairs to the backend.

The whole serving path already exists — `products.barcode` → `GET /api/barcode/resolve` → the
mobile barcode screen. This runbook only *populates* `products.barcode`.

## Weekly procedure

1. **Get the unlinked SKUs.** Either run `harvest-barcodes.mjs --dry-run` to see which SKUs are
   still `barcode IS NULL`, or query the DB directly (Preview/prod) for unlinked Costco products
   ordered by most-recent price (highest-value first). Hand Claude a batch (≤ a few hundred).
2. **In Chrome, for each SKU**, ask Claude to:
   - open the Costco product page (search `site:sameday.costco.ca <sku>` or `costco.ca <sku>`),
   - **verify the page's item number matches the SKU** (the sameday `retailerReferenceCodeString`
     == our warehouse SKU — the warehouse/online split guard; skip if it doesn't match),
   - read the **UPC/EAN off the package gallery image** (12 or 13 digits),
   - record `{ sku, barcode }`.
3. **Submit the batch** to the existing bulk endpoint (no new endpoint needed):

   ```
   POST /api/admin/barcode-links
   Headers: x-admin-token: <FLYER_ADMIN_TOKEN>
   Body:    { "items": [ { "sku": "1654321", "barcode": "066700123456" }, ... ] }   # ≤ 2000 items
   ```

   The endpoint validates each pair with a **GTIN mod-10 checksum** (`pricesRepo.linkBarcodeToSku`)
   and writes authoritatively. Response: `{ ok, linked, unmatched, invalid, total }`.
   - `linked` — barcode written to a matching product
   - `unmatched` — valid pair but we have no Costco product with that SKU (skip / investigate)
   - `invalid` — checksum-invalid barcode or bad SKU (Claude likely misread — re-check)
4. **Spot-check**: scan one freshly-linked barcode in the app → it should resolve to the Costco
   price. Re-run with the next batch.

## Trust / safety

- Web-decoded links are **high-confidence** (SKU-verified on the page + checksum-valid decode), so
  they bypass any rule-of-N and overwrite authoritatively — same trust level as the script
  harvester. Only an admin (token holder) can call this route.
- Never accept a barcode whose page item-number didn't match the SKU; that's the warehouse/online
  mismatch that pollutes the catalog.

## See also

- `backend/scripts/harvest-barcodes.mjs` — the automated script version of this flow (zxing-wasm
  image decode); use whichever recovers more pairs that week.
- In-app **admin barcode feeder** (`src/screens/AdminBarcodeFeederScreen.js`, route
  `AdminBarcodeFeeder`, Profile → Admin) — manual dual-capture for **warehouse-only** SKUs that
  never appear online; posts single pairs to the sub-gated `POST /api/admin/barcode-link`.
- `docs/Dual-capture.md` — the deferred user-facing crowd dual-capture design (not built).
