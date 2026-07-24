# Costco Personal Care — barcode harvest (Google-search method)

Started 2026-07-10 via the `/goal` workflow: browse `costco.ca/personal-care.html` (149 items,
7 pages of 24), pull each product's warehouse **Item # (SKU)** from its detail page, then
Google-search `"<name>" "<size/count>" barcode UPC` to try to recover the manufacturer UPC/EAN.
Only pairs with an unambiguous, cross-confirmed exact name+size/count match are written to
`products.barcode`; everything else is recorded here for a human (or the image-decode harvester,
see below) to resolve later.

**Method note:** this is a *different, lower-yield* method than the existing
`docs/Claude-Chrome-barcode-harvest.md` runbook, which reads the UPC directly off the product's
gallery photo (near-100% hit rate when a photo is available) rather than guessing from a generic
web search. Generic search only turns up a barcode when some third-party retailer/database happens
to have indexed that *exact* pack size — most Costco multi-packs are club-exclusive sizes that
don't appear elsewhere, so the miss rate is high (see page 1 results: 2/24). If this file grows,
prefer switching remaining pages to the photo-read runbook instead of more searching.

**Where written:** originally dev Supabase only (`gnedluuylimjwdmtvswl`); **promoted to prod**
(`xjfrlzwonyaorwktnkpj`) 2026-07-11 by running `backend/scripts/upsert-personal-care-barcodes.js`
directly against the prod `DATABASE_URL` — verified via a direct prod query (product ids
19986/19987). The two SKUs below are the only ones written; run the same script again (it's
upsert-idempotent) if more pairs are confirmed from the remaining pages.

## Page 1 of 7 (24 products)

| SKU (Item #) | Product | Barcode found | Confidence |
|---|---|---|---|
| 2001849 | Nature's Way Cortisol Control, 100 Tablets | — | Not found (only a 90-tablet variant UPC turned up) |
| 5357952 | Kirkland Signature Women's Protective Underwear | — | Not found |
| 169940 | Cetaphil Moisturizing Lotion, 1 L | — | Not found (only 16 oz / other sizes found) |
| **3975107** | **Always Ultra Thin Overnight Pads, 76-count** | **0037000561538** | ✅ Written (dev DB) — exact count match across multiple retailers |
| 2670056 | Philips Sonicare DiamondClean Brush Heads, 6-pack | — | Not found |
| 1366250 | Kirkland Signature Citrus Body Wash, 2 x 800 mL | — | Not found (only single-bottle listings) |
| 2244860 | Sensodyne Whitening Toothpaste, 145 mL, 4-pack | — | Not found (only 4oz single UPCs found) |
| 1711050 | Dove Deep Moisture Body Wash, 2 x 1.04 L | — | Not found (only 24oz 2-pk UPC found, wrong size) |
| 120902 | Philips Sonicare Confident Clean w/ UV Sanitizing Travel Case Edition | — | Not searched (electronics, low barcode-reuse value) |
| 2004968 | Crabtree & Evelyn 5-piece Body Care Tin Set - Nantucket Briar | — | Not searched |
| 2777483 | Oral-B iO Series Professional Clean Electric Toothbrush, 2-pack | — | Not searched |
| 1398164 | Dove Advanced Care Antiperspirant, 4-pack | — | Not found (multiple scent variants, no single confident match) |
| 3231001 | Philips Sonicare DiamondClean Connected Series 9000, 2-pack | — | Not searched |
| 120902 (dup ref) | Cetaphil Sensitive Gentle Skin Cleanser, 1 L | — | Not found (only 8oz/20oz UPCs found) |
| 2058377 | Aveeno Stress Relief Body Wash, 2 x 975 mL | — | Not found (975 mL UPC found is for a different variant — Daily Moisturizing, not Stress Relief) |
| 1426812 | Crest Complete Plus Scope Advanced Active Foam Toothpaste, 5 x 170 mL | — | Not found (Costco listing confirmed but no UPC surfaced) |
| 1840146 | Waterpik Cordless Enhance Water Flosser Combo Pack | — | Not searched |
| 1753925 | Braun IPL 5157 w/ 3-in-1 FaceSpa Pro 911 Epilator Bundle | — | Not searched |
| 2005662 | VEET Professional Wax Strips Dry Skin - Legs & Body, 60-count | — | Not found |
| 1846214 | U by Kotex Balance Ultra Thin Pads w/ Wings, Heavy Absorbency, 72-count | — | Not found (only 46/32-count UPCs found) |
| 2702338 | Waterpik Ultra Plus & Cordless Enhance Water Flosser Combo Pack | — | Not searched |
| 7774114 | Philips Shaver Series 6000 Wet & Dry Electric Shaver | — | Not searched |
| 2011884 | Depend Women's Maximum Absorbency Underwear | — | Not searched |
| 2742263 | Olay Ultra Moisture Body Wash w/ Vitamin B3 Complex, 2 x 887 mL | — | Not searched |
| 1656851 | Philips Sonicare ProtectiveClean 5100 Toothbrush | — | Not searched |
| 366500 | Softsoap Soothing Aloe Vera Liquid Moisturizing Hand Soap, 2 x 2.36 L | — | Not found (only smaller refill sizes found) |
| 2011881 | Depend Men's Maximum Absorbency Underwear | — | Not searched |
| **1652990** | **Kirkland Signature Flushable Wipes, 640 Wipes** | **096619885671** | ✅ Written (dev DB) — listing's own MPN (1652990) matches our SKU exactly |
| 1896371 | Gillette Fusion5 Razor Cartridge Refills, 18-count | — | Not found |
| 2027209 | Apothecary 101 Hand Soap Collection, 4 x 576 mL | — | Not searched |
| 1555497 | Dove Sensitive Skin Soap Bar, 16 x 106 g | — | Not found (only smaller multipack UPCs found) |

**Note on SKU extraction:** the Costco.ca product URL contains an internal catalog ID
(e.g. `...product.100798449.html`), which is **not** the warehouse SKU. The real Item # (SKU) was
pulled from `Item #` text on the rendered product page (e.g. product 100798449 →
warehouse Item # 1366250). Always use the on-page Item #, never the URL number, when writing to
`products.sku`.

## Remaining pages (2–7, ~125 more products)

Not yet processed. Continue the same procedure per page:
1. `fetch()` each product URL from within the Chrome tab (bypasses Akamai once the tab has a live
   session) and regex `Item\s*#?\s*[:\s]?\s*(\d{5,10})` to get the SKU fast, in batches.
2. Google-search `"<name>" "<size>" barcode UPC` per product.
3. Only write pairs where the barcode is corroborated by an exact size/count match (ideally a
   listing whose own MPN/model number equals our SKU, as with the flushable wipes above).
