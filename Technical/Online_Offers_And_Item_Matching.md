# Online offers ("Offers Ending Sunday") and item matching

**Status: FINDINGS + PROPOSED DESIGN (2026-10-02).** The extraction and the import-ready file exist; the
matching system below is **not built**. Source page: `costco.ca/offers-ending.html`.

Files (this repo, `Stores/Costco/Offers-ending/Canada/2026/`):
- `offers-ending_2026-10-02.json` — all 258 tiles; the 81 discounted ones carry `itemNumber`.
- `flyer-import_2026-10-02.json` — the 78 importable tiles in `/api/flyer/import` shape (region `ON`).

## 1. What the page is

| Fact | Value |
|---|---|
| Tiles at extraction | 258 (259 earlier the same hour — the list moves) |
| Show a discount (was-price and/or "After $X OFF") | 81 |
| Price only, no discount known | 168 (not deals) |
| No price shown (members-only / sign-in) | 12 |
| Online Only | 135 of 258; 42 of the 78 importable |
| End date | none per tile — "Ending Sunday" in the title → 2026-10-04 (inferred) |
| Region | one view only (Ontario, stock shown for Gloucester). **Not verified national.** |

3 of the 81 (Duracell 9V / C / D) show "After $3 OFF" but **no price**: skipped, so 78 are importable.
`regularPrice` is derived as `promo + savings` when the tile shows no was-price (same rule as the coupons file).

## 2. The identifier problem

The tile exposes Costco's **catalog id** (`100122566`, `4000399694`, `4101000160`, `4201001416`), **not** the
warehouse **item number** the app keys everything by (`products.sku`, receipts, flyer). `flyerPricing.normalizeOffer`
accepts only `^\d{4,8}$`, so every raw tile id would be **rejected** — importing them as-is is impossible, not just wrong.

**The item number is recoverable.** Each product page carries it twice — `Item 2633624` in the text and `"sku":"2633624"`
in the JSON-LD — and the two agreed on **81/81** pages. A same-origin `fetch('/p/-/x/<catalogId>')` from the
Claude-in-Chrome session returns it (≈1.7 MB per page, ~0.5 s each, no Akamai block). Item numbers seen are 5, 6 and
7 digits (`71408`, `825806`, `1993875`), so never assume 7.

**The barcode is not recoverable from the page.** No `gtin`/`upc`/`ean` field exists in the JSON-LD or HTML (0/81).
It still needs the existing image-read path ([`Claude-Chrome-barcode-harvest.md`](Claude-Chrome-barcode-harvest.md)).
That runbook's guard — "page item number must equal our SKU" — is **exactly the check this lookup provides**, so the
81 item numbers can be fed straight into the harvest queue.

**Open question the page cannot answer:** is an online-only item's item number the *same* as the warehouse item
number of the "same" product? For items sold in both channels the number is shared (Charmin 2633624 matches the
image file name); for online-only listings it is an online-only number and will never appear on a receipt.

## 3. Gaps in the current pipeline (verified in code)

1. **Provenance is dropped.** `normalizeOffer` keeps only `deliveryAvailable`, `costcoCaAlso`, `sameDayDelivery`,
   `executiveOnly`. Any `priceSource` / `catalogId` flag we send is silently discarded; `price_points` has no channel
   column. Once imported, an online price is indistinguishable from a warehouse price.
2. **An online price can raise a warehouse price drop.** The post-import sweep compares any valid price against a
   buyer's receipt price. For the 36 importable items sold in both channels, an online instant-saving may not apply
   in the warehouse ("prices may vary"). Risk = a push saying "price dropped" for a price the shopper cannot get in
   store. The 42 online-only items are low-risk (rarely on a receipt).
3. **Region is asserted, not measured.** `region: ALL` would fan one Ontario view out to 13 provinces. The file uses `ON`.
4. **One id space.** `products.sku` holds item numbers only; there is nowhere to store a catalog id, an online-only
   number, or a GTIN as an *alias* of the same product.
5. **Extraction cost.** The 81 lookups are a manual step today; nothing records which catalog id mapped to which item.

## 4. Proposed system (not built)

**a. Identifier aliases table** — `product_identifiers(store_id, id_type, value, product_id, source, confidence, created_at)`,
unique on `(store_id, id_type, value)`. `id_type` ∈ `warehouse_item`, `online_item`, `catalog_id`, `gtin`.
Discriminator named `type`-style per the DB rules (see `db-design-best-practices`). `products.sku` stays the warehouse key.

**b. Channel on price observations** — `price_points.channel` (`warehouse` | `online`), default `warehouse`. The drop sweep
compares **like with like**; an online price may only raise a drop for a warehouse receipt if the item is flagged
`sameInBothChannels` (verified), otherwise it is shown as an *online deal* only.

**c. Matching ladder** (stop at the first hit, record `source` + `confidence`):
1. exact `warehouse_item` = tile item number → link;
2. known `catalog_id` alias → reuse its product;
3. GTIN, once harvested (Chrome harvest, §2);
4. normalized name + size/count fuzzy match → **admin review queue**, never auto-link;
5. no match → create an online-only product row, `channel = online`.

**d. Server-side resolution on import** — accept `items[].ids = { itemNumber?, catalogId?, gtin? }` and resolve through (c),
returning `{ accepted, rejected, unmatched[] }` so the scheduled routine stops needing a manual lookup step.

**e. Honest provenance** — keep `catalogId`, `channel` and `region-verified` on the stored offer; stop discarding flags
silently (log or reject unknown flags instead).

**f. Weekly runbook** — extract → look up item numbers → import to the **observed** region → verify QC/BC in the
Chrome session before widening to `ALL` → enqueue unmatched ids for the barcode harvest.

## 5. Decisions needed before building

- Should online-only items drive push notifications at all, or only appear as an in-app "online deals" list?
- Is one Ontario observation acceptable as `ALL`, or must QC and BC be re-checked each week (the coupons batch was)?
- Does an alias table replace the current `products.barcode`-only linking, or sit beside it?

## 6. Regression risk of acting on this

Documentation only. Building §4 touches `price_points` (migration + every reader), the drop sweep and the flyer
normalizer — all money paths; it needs its own design and the full-coverage test pass.
