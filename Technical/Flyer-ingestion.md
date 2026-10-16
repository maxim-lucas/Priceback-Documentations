# Weekly Costco flyer ingestion

The weekly Costco flyer is Priceback's **primary** price source. There are now
three ways to feed it, all converging on the same `commitFlyerImport()` in
`backend/server.js` (in-memory overlay in `flyerPricing.js` + `price_points`
via `pricesRepo.recordPricePointsBulk`, then the price-drop sweeps). A national
batch is stored **once**, as `NATIONAL` — see §4.

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

- `region` may be a single province (`"ON"`) or `"ALL"` — a **national** batch,
  stored once as `NATIONAL` (§4). `regions: ["ON","QC"]` is also accepted; an
  `"ALL"` in that list makes the whole import national.
- `promoPrice` is required per item; `regularPrice`/`instantSavings` are optional.
  `validFrom`/`validUntil` are ISO `YYYY-MM-DD`, inclusive.
- Re-posting the same `(region, batchKey)` **replaces** that batch (atomic
  corrections). A national re-post also replaces that batch's provincial copies.
- The response is `{ ok, national, accepted, rejected, replaced, regions, perRegion }`:
  `regions` = the provinces the offers are **live** in (all 13 for a national
  batch — the admin screen's "live across N province(s)"), `accepted` and
  `perRegion` = what was **stored** (a national batch: once, under `NATIONAL`).

## 3. CLI (`import-flyer.mjs`)

For a one-off file export:

```bash
FLYER_ADMIN_TOKEN=secret node backend/scripts/import-flyer.mjs \
  backend/data/flyer-imports/costco-coupons-2026-06-22.json \
  --region ALL --url https://priceback-production.up.railway.app
```

`--region` overrides the file's `region` field (use `ALL` for the national book).

## Province differences, SKU granularity, Hot Buy handling

See `Technical/Costco_Flyer_Province_Comparison.md` for the full findings from
comparing ON/QC/BC on 2026-09-27: the catalog is national (only eco-fee/tax
vary by province, both excluded from `promoPrice`), the one-SKU-per-entry
golden rule, why Hot Buy tiles must carry `instantSavings: 0`, and why
`COSTCO.CA ONLY` tiles need a follow-up click before trusting their price.

## 4. National batches are stored ONCE, as `NATIONAL` (since 2026-09-28)

Maxim, 2026-09-28: *"all national offers should be stored as national not
duplicated even for costco"*. Until then an `"ALL"` import was copied into all
13 provinces — in the overlay and in `price_points`. `ALL-2026-09-14` alone is
119 offers × 13 = **1,547 rows** in production.

| Layer | Stored as | Read by |
| --- | --- | --- |
| Overlay (`flyerPricing.js`) | one `NATIONAL:<sku>` entry | `getActiveFlyerPrice` (price lookup, legacy sweep) and `getActiveOffers` (deals feed) consult it for **every** province |
| `price_points` | one row per offer, `province_id` = the reserved `NATIONAL` province | `findNotifiable`, `getLatestVerifiedPrice`, `latestForBarcodeByProvince`, `activeFlyerOffers` — all `(province OR NATIONAL)` |

- **Which offer a shopper gets:** their province's own active offer or the
  national one, **whichever is cheaper** (both apply there); a tie keeps the
  province's own. The drop sweep compares the same way (lowest price within the
  flyer tier). The deals feed labels a national offer with the province asked
  about — `NATIONAL` is where it is stored, not a place.
- **Re-importing a batch that was fanned out collapses it.** The overlay replaces
  the batch everywhere; in `price_points`, `collapseFlyerBatchToNational` deletes
  a provincial copy **only next to its `NATIONAL` replacement** (same product,
  same batch) — a row that failed to write keeps its copies, and a SKU the
  re-import no longer carries is left alone. So re-importing `ALL-2026-09-14`
  would take production from 1,547 rows to 119.
- **A provincial import never touches a national batch**, and stays provincial.
- **Sweeps after a national import:** the legacy overlay sweep runs per province
  (it is national-aware), and **one unscoped** verified-drop sweep reaches every
  buyer — a `NATIONAL` row matches a buyer in any province.
- **Why "wrong everywhere" is not a new risk:** a wrong national row is wrong in
  every province — and so was a wrong fanned-out batch, 13 times over.

Where Costco's money path was proven against a national row, and the bug it
found in a region-scoped sweep: `Technical/Store_Price_Adapters.md` › *Costco
national offers*.

## Notes

- Every `price_points` write of a batch is its own unit: `recordPricePointsBulk`
  logs a row that throws (with `describeError`, which prints the Postgres cause
  rather than drizzle's "Failed query") and carries on, instead of stopping at
  the first throw. A national write carries every province at once, so the old
  behaviour would have lost the rest of the batch for the whole country. The
  2026-09-27 import needed 2–3 re-runs for exactly that reason; with a national
  batch the write is also 13× smaller. What is still missing: surfacing a
  partial persist somewhere visible — `Roadmap/Costco_Coupons_Ingestion_Roadmap.md` §2.
- Flyer rows are admin-uploaded → instantly verified, so the post-import
  verified-drop sweep notifies eligible buyers immediately.
- `valid_from` / `valid_until` on `price_points` are the offer's printed dates
  (the Monday of the import week only when an offer carries none); the same
  dates drive the overlay's active window.
- `/health`'s `flyerOffers` / `activeFlyerOffers` count STORED overlay entries,
  so a national batch counts once (119, not 1,547).
