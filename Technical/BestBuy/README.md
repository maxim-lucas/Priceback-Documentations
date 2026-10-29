# Best Buy

Everything specific to Best Buy Canada as a PriceBack store. Per the standing
rule — **one store = one parser file and one documentation folder** — nothing
here describes another retailer, and no other store's folder describes Best Buy.

**Status (2026-10-28): finished, shipping in production builds ADMIN-ONLY.**
Branch `feat/bestbuy-finalize` (cut from `main`, PR into `main-test-features`)
brings everything from `development` except the ads: the parser hardening
(#317, #335), the price feed and adapter registry (#312), the go-live tooling and
health check (#329), the price lock for a charged drop (#321). Maxim's rule for
every store from now on: *"ship it in the next versions in production it wont be
available yet for users, but i can test it live in production as an admin."*

- The parser is in `STORE_PARSERS`, so every build carries it.
- `bestbuy` is in `ADMIN_PREVIEW_STORES` (`src/constants/stores.js`): an admin
  account can pick and scan it; shoppers see "Coming soon"; the Stores tab badges
  it "Admins only".
- `stores.enabled` stays `false` in both databases and in the bundle. **Opening it
  to shoppers is that row** (Admin console store editor, or the generated
  `store-content-sync.sql` after flipping `enabled` in `stores.js`), and is
  Maxim's call.
- `BESTBUY_SCAN_ENABLED` defaults OFF. Dev carries an explicit `true`, prod an
  explicit `false`. To test the feed in production as an admin, turn prod's on;
  it can only price Best Buy lines that exist, which are the admin's own.
- Costco is untouched: `receiptParsingShared.js` is byte-identical to `main` and
  frozen; Best Buy's SKU-coverage signal is applied by the registry's
  `scoreParse`, which returns a Costco score unchanged.

*Earlier (2026-09-28):* launch held on the lab lane when `development` was merged
into `main` on `merge/main-and-development` (never merged).

*Earlier (2026-09-10):* store #2 on `development` (PR #320), price feed built
and tested, live in the dev environment only — see the audit.

## Files

| File | What it covers |
| --- | --- |
| `Price_Feed.md` | The price adapter (`backend/lib/bestBuyCatalog.js`) and the nightly job. The marketplace gate, the ~10 s API, the live probe, and what is still owed before the production scan flag is turned on. |
| `Receipt_Parser.md` | The receipt parser: in-store and online formats, SKU width, discount sub-rows, service lines, and the 2026-09-02 promotion off the lab lane. Moved here from the shared registry doc on 2026-10-28. |
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
