# Costco price upload console

The admin console at **`https://admin.priceback.ca`** (path `/admin-console/` on the backend) lets an admin upload a week of Costco prices and the product photos without a hand-run import. Asked for by Monica on 2026-10-20 after the `costco-region-2026-10-19` import.

Code (Priceback repo):

| Piece | File |
|---|---|
| Page, template, field guide | `backend/public/admin-console/` (`index.html`, `costco-prices-template.json`, `guide.html`) |
| Rules (pure, unit-tested) | `backend/lib/costcoPriceImport.js` (`planImport`) |
| Database writes | `backend/repos/costcoImportRepo.js` |
| Photo bucket | `backend/lib/productImages.js` |
| Routes | `backend/server.js`: `/admin-console`, `POST /api/admin/costco-import/preview`, `POST /api/admin/costco-import/apply`, `PUT /api/admin/product-images/:store/:sku`, `GET /api/product-images/:store/:sku` |
| Tests | `backend/tests/costcoPriceUpload.test.js` |

Needs migration `0030_product_price_sameday` (`products.price_sameday`, Priceback #469) applied first.

## Rules

The same rules the `costco-region-2026-10-19` import was written with; uploading that file through the console reproduces it row for row (340 SKUs, warehouse rows and 279 Same-Day regular prices; the Same-Day savings depend on the regulars in the database at upload time).

- **Every SKU** becomes a Costco product if missing (`display_name = product_name`). An existing product keeps its name.
- **Warehouse prices** (`price_type: "warehouse"`) become price points, one per province in `provinces[]` (else the region key), province-wide (`warehouse_id NULL`): source `price_tag_scan`, `verified = true`, device hash `d8c1b0f3a9e44d27` (no devices row, so no tag credits), `source_ref = <batch>:<price in cents>`, `flags.sourceKind = "social_price_tag"`, `flags.importBatch = <batch>`, plus posts, locations, platform and recency. `regular = regular_price`, or the price itself when missing or lower.
- **Same-Day prices** (`price_type: "sameday_delivery"`) set `products.price_sameday`, the online REGULAR price (`regular_price`, or `price_discounted` when none is printed; latest upload wins). A Same-Day **saving** never carries the Same-Day price into the pool (online runs above the shelf; Monica, 2026-10-20). It becomes a warehouse price for its province: the item's known warehouse regular minus the saving (`discount_amount`, else regular − discounted). The regular comes from the latest price point for the SKU in the same province (last 180 days, Same-Day rows excluded), then this file's warehouse rows for the SKU (Ontario first), then the latest point in any province. `source_ref = <batch>:sameday:<cents>`, `flags.priceType = "sameday_saving"`, plus `flags.saving` and `flags.regularFrom`. With no known regular the saving is skipped and listed as a warning. On the 2026-10-19 file: 226 of 263 resolved (167 same province, 58 file, 1 any province), 37 skipped.
- A Same-Day item's `warehouse_price_discounted` becomes a price point for its province (regular = price, until = `warehouse_expiry_date`).
- **Start date**: `item.start_date`, else the date picked on the page, which defaults to the file's `start_date`, else its `generated` date.
- **Batch**: defaults to `costco-region-<generated>`, so the same file uploaded twice upserts the same rows and changes nothing. A corrected price gets a new `source_ref` (the cents change) and is added beside the old one.
- Bad lines (bad SKU, price, date, unknown province or `price_type`, expiry before start) are skipped and listed as warnings; the rest import.
- **Preview** writes nothing. **Import** runs in one transaction: all or nothing.

## Photos

Bucket **`priceback-product-images`** (R2), key `<store>/<sku>.<ext>` (`costco/1850321.jpg`), separate from the private receipts bucket. Uploaded from the page as a zip or loose files named `<sku>.jpg|png|webp`, 5 MB max each. Read back by SKU at `GET /api/product-images/costco/<sku>`, or from the bucket's public domain when one is set.

## Setup (one time)

1. **Railway env vars** on the production backend service (and on `priceback-development` to try it on dev first):
   - `ADMIN_TOKEN` is the console's password (falls back to `FLYER_ADMIN_TOKEN`). Already set if the flyer importer works.
   - `PRODUCT_IMAGES_ACCESS_KEY_ID` and `PRODUCT_IMAGES_SECRET_ACCESS_KEY`: an R2 API token with *Object Read & Write* on `priceback-product-images` (Cloudflare dashboard > R2 > Manage API tokens). Not needed if the existing `R2_ACCESS_KEY_ID` token already covers all buckets. `R2_ACCOUNT_ID` is already set.
   - Optional: `PRODUCT_IMAGES_BUCKET` (default `priceback-product-images`), `PRODUCT_IMAGES_PUBLIC_BASE` (for example `https://images.priceback.ca`, if the bucket gets a public custom domain).
2. **Subdomain** `admin.priceback.ca`:
   - Railway > backend service > Settings > Networking > *Custom Domain* > add `admin.priceback.ca`. Railway shows a CNAME target.
   - At the DNS host for `priceback.ca`, add a `CNAME` record `admin` pointing to that target (on Cloudflare, set it to *DNS only*, grey cloud, until Railway shows the certificate as issued).
   - The bare root of `admin.*` redirects to `/admin-console/`. Until the domain is live, the page also works at `<backend URL>/admin-console/`.
3. Optional public photo URLs: Cloudflare > R2 > `priceback-product-images` > Settings > *Custom Domains* > `images.priceback.ca`, then set `PRODUCT_IMAGES_PUBLIC_BASE`.

## Security

- The page is static and public (no data in it); every write needs the admin token, checked by `_adminTokenOk` (constant time, failed guesses rate limited per IP).
- The page is served from the API host, so its calls are same-origin and the deny-by-default CORS policy stays unchanged.
- `noindex` and `Cache-Control: no-store` on the console. The token is kept in the tab's `sessionStorage` only.
