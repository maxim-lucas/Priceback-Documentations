# Weekly Costco flyer ingestion

The weekly Costco flyer is Priceback's **primary** price source. There are now
three ways to feed it, all converging on the same `commitFlyerImport()` fan-out
in `backend/server.js` (in-memory overlay in `flyerPricing.js` + `price_points`
via `pricesRepo.recordPricePointsBulk`, then the region price-drop sweeps).

## 1. In-app admin Flyer Scan (fastest, interactive)

Profile → **Admin → Flyer scan** (visible only to accounts in `ADMIN_USER_SUBS`).

- Photograph one page, or **upload all pages at once** (multi-select, up to 30).
- Each page image is sent to `POST /api/admin/flyer-scan/extract`, which runs
  **multimodal Gemini 2.0 Flash** (`backend/services/flyerScanService.js`) and
  returns the structured offers it found.
- Offers from every page merge into one editable list (deduped by SKU). Set the
  province scope (default **All = national**) and the valid-from/valid-until
  range, review/edit, then **Commit** → `POST /api/admin/flyer-scan/commit`.

Requires `GEMINI_API_KEY` (extract) and the DB (commit) on the server.

## 2. Scheduled Claude-in-Chrome (national coupons.html)

`costco.ca/coupons.html` is an Akamai-protected SPA that blocks server-side
scraping, so Priceback does **not** scrape it. Instead, a scheduled
**Claude-in-Chrome** routine navigates the page, extracts the offers, and POSTs
them to the token-gated import endpoint with `region: "ALL"`.

`POST /api/flyer/import` — header `x-admin-token: <FLYER_ADMIN_TOKEN>`:

```json
{
  "region": "ALL",
  "batchKey": "costco-coupons-2026-06-22",
  "source": "costco-coupons",
  "deviceId": "flyer-importer-bot",
  "items": [
    {
      "sku": "1234567",
      "name": "Kirkland Signature …",
      "size": "2 × 1.5 L",
      "regularPrice": 22.99,
      "instantSavings": 5.00,
      "promoPrice": 17.99,
      "validFrom": "2026-06-22",
      "validUntil": "2026-07-06",
      "flags": { "costcoCaAlso": true }
    }
  ]
}
```

- `region` may be a single province (`"ON"`) or `"ALL"` (→ all 13 provinces).
  `regions: ["ON","QC"]` is also accepted.
- `promoPrice` is required per item; `regularPrice`/`instantSavings` are optional.
  `validFrom`/`validUntil` are ISO `YYYY-MM-DD`, inclusive.
- Re-posting the same `(region, batchKey)` **replaces** that batch (atomic
  corrections). The response is `{ ok, accepted, rejected, replaced, regions, perRegion }`.

## 3. CLI (`import-flyer.mjs`)

For a one-off file export:

```bash
FLYER_ADMIN_TOKEN=secret node backend/scripts/import-flyer.mjs \
  backend/data/flyer-imports/costco-coupons-2026-06-22.json \
  --region ALL --url https://priceback-production.up.railway.app
```

`--region` overrides the file's `region` field (use `ALL` for the national book).

## Notes

- A national import writes ~13× `price_points` rows (one province each) — bounded
  and intentional; the in-memory overlay is keyed `${region}:${sku}`.
- Flyer rows are admin-uploaded → instantly verified, so the post-import
  verified-drop sweep notifies eligible buyers immediately.
- `valid_from` on `price_points` is derived (Monday of the import week); the
  flyer's own `validFrom`/`validUntil` drive the overlay's active window.
