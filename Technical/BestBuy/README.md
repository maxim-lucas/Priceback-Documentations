# Best Buy

Everything specific to Best Buy Canada as a PriceBack store. Per the standing
rule — **one store = one parser file and one documentation folder** — nothing
here describes another retailer, and no other store's folder describes Best Buy.

**Status (2026-09-28): launch held — "Coming soon" in production, lab lane
only.** When `development` was merged into `main` (branch
`merge/main-and-development`), Maxim's standing call was that every store
except Costco stays "Coming soon" in production. So the promotion's five
declarations moved back together — the parser into `LAB_STORE_PARSERS`,
`bestbuy` into `LAB_ONLY_STORES`, `enabled: false` in the bundle and in
`policies.json`, the store-content sync SQL regenerated, and
`BESTBUY_SCAN_ENABLED` defaulting to `false`. That is exactly the posture `main`
always shipped; none of the parser, adapter or job work was removed, and lab
builds (dev backend) still accept Best Buy with its dedicated parser.
Re-promoting is the documented one-line move plus the flags and the sync — the
agreement is pinned by `__tests__/bestBuyStorePromotion.test.js`.

*Earlier (2026-09-10):* store #2 on `development` (PR #320), price feed built
and tested, live in the dev environment only — see the audit.

## Files

| File | What it covers |
| --- | --- |
| `Price_Feed.md` | The price adapter (`backend/lib/bestBuyCatalog.js`) and the nightly job. The marketplace gate, the ~10 s API, the live probe, and what is still owed before the production scan flag is turned on. |
| `Integration_Audit_2026-09-10.md` | The end-to-end audit: what was missing between "the code is complete" and "a shopper can use it", what was fixed, and what is owed. **Start here.** |

## Where the code lives

| Concern | File |
| --- | --- |
| Receipt parser | `src/services/bestBuyReceiptParser.js` |
| Parser registration | `src/services/receiptParsers/index.js` |
| Store record (bundled fallback) | `src/constants/stores.js` |
| Price adapter | `backend/lib/bestBuyCatalog.js` |
| Nightly job | `backend/jobs/bestBuyPriceRefresh.js` |
| Live probe | `backend/scripts/bestbuy-quote-probe.js` (`npm run bestbuy:probe`) |
| Real-OCR corpus | `__tests__/fixtures/receipts-bestbuy/` (9 captures) |
| API captures | `backend/tests/fixtures/bestbuy-api/` |

## Store-neutral material lives elsewhere — on purpose

- `Technical/Store_Price_Adapters.md` — the adapter contract, the NATIONAL
  province, the `scrape` source type, and the checklist for adding a store.
- `Technical/Receipt_Parser_Registry_And_Store_Parsers.md` — the registry, the
  parser contract and the lab lane.
- `Technical/priceDrop.md` — what a price becomes once it is stored.

## Owed: two sections still in the shared parser doc

`Receipt_Parser_Registry_And_Store_Parsers.md` **§3 "The Best Buy parser"** and
**§7 "Promoting Best Buy off the lane"** are Best Buy-specific and belong here as
`Receipt_Parser.md`. They were left in place during the 2026-09-10 split because
moving them means re-threading the registry doc's numbered sections, which is
worth doing on its own rather than inside an audit. Until then, read §3 and §7
there — not in another store's folder.
