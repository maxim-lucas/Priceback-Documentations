# Deferred design: in-store dual-capture barcode↔SKU linking

**Status: DESIGNED, NOT IMPLEMENTED.** Complement to the weekly web image-harvester
(`backend/scripts/harvest-barcodes.mjs`). This doc captures the design so it can be built later
without re-doing the analysis.

## Why this exists

Costco keys every price by warehouse **item-number (SKU)**; the app scans the manufacturer
**UPC/EAN** off the package. Nothing bridges the two. Costco publishes **no structured GTIN** anywhere
(verified: sameday.costco.ca product pages expose only internal item numbers, no `gtin`/`upc`/`ean`),
so the web harvester can only recover a UPC by decoding it off a product image — which works only for
items sold online that happen to have a barcode visible in a gallery photo. That leaves warehouse-only
/ treasure-hunt SKUs unlinked.

**The one place the warehouse SKU and the package UPC are guaranteed to co-occur is physically at the
shelf:** the tag has the SKU, the package has the UPC. Dual-capture harvests that pairing from users
who are already there scanning a price tag.

## Flow (reuses existing infra)

The price-tag scan path already exists and already earns the user a credit:

```
PriceTagScanScreen.js → costcoTagScanner.js (extracts sku/name/price)
  → priceService.submitPriceTagObservation()
  → POST /api/observations/tag
  → crowdRepo.recordObservation() → pricesRepo.recordPricePoint() → upsertProduct()
```

Add an **optional** "scan the package barcode" step:

1. After the tag is parsed (SKU known), prompt: *"Scan the product barcode so others can find this by
   scanning."* Reuse the existing `expo-camera` barcode scanner already used by `BarcodeScanScreen`
   (`ScanCameraViewfinder mode="barcode"`, `BARCODE_TYPES = upc_a/upc_e/ean13/ean8/code128/code39`).
2. Thread `barcode` through the existing payload:
   - `src/services/priceService.js` — add `barcode` to `submitPriceTagObservation`.
   - `backend/server.js` `POST /api/observations/tag` — accept + validate `barcode`
     (`/^\d{12,13}$/` + GTIN checksum; reuse `pricesRepo.isValidUpcEan`).
   - `backend/repos/crowdRepo.js` `recordObservation` — forward `barcode`.
   - Write the link (see trust model below).

## Trust model — IMPORTANT, differs from the web path

The web harvester is authoritative (it verified the page SKU == ours and the barcode is a checksum-valid
decode), so `pricesRepo.linkBarcodeToSku` **overwrites** `products.barcode`. **Crowd data must NOT use
that path unchanged** — and must NOT go through `upsertProduct`, whose
`barcode: barcode || sql\`${products.barcode}\`` is *last-writer-wins* and would let one wrong pairing
clobber a good value. Instead pick one:

- **Gap-fill (simplest):** `UPDATE priceback.products SET barcode = $bc WHERE store_id = … AND sku = …
  AND barcode IS NULL` (first-writer-wins; never overwrites a harvested/admin value). Add this as a
  `{ gapFillOnly: true }` mode on `linkBarcodeToSku`.
- **Rule-of-N (safer, more work):** stage crowd pairings in a small `pending_barcode_links` table and
  only commit to `products.barcode` once **N distinct `device_hash`es** agree on the same
  `(sku, barcode)`. Mirrors the existing verified-price rule-of-N machinery.

Admin-verified contributors (`isAdminContributor`) and the web harvester remain authoritative and may
overwrite either way.

## Serving — already done

No serving changes are needed. Once `products.barcode` is set, `GET /api/barcode/resolve` →
`pricesRepo.latestForBarcodeByProvince` → `getProduct({ barcode })` already returns the price, and
`BarcodeScanScreen` already renders it. Same as the web harvester.

## Files to touch when implementing

- `src/screens/PriceTagScanScreen.js` — optional barcode-capture step after tag parse.
- `src/services/priceService.js` — `barcode` in the `submitPriceTagObservation` payload.
- `backend/server.js` — `POST /api/observations/tag` accepts + validates `barcode`.
- `backend/repos/crowdRepo.js` — `recordObservation` forwards `barcode`.
- `backend/repos/pricesRepo.js` — gap-fill variant of `linkBarcodeToSku` (or the
  `pending_barcode_links` staging table + a commit job for the rule-of-N option).

## Coverage note

Dual-capture is opt-in and consent-gated (`consent.shareCostcoPrices`), so coverage grows with
contributor activity. Pair the two: the harvester seeds the online-sold catalog; dual-capture fills
warehouse-only / treasure-hunt SKUs the web can't reach.
