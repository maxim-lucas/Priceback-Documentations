# Sport Chek

Everything specific to Sport Chek Canada as a PriceBack store. Per the standing
rule — **one store = one parser file and one documentation folder** — nothing
here describes another retailer.

**Status (2026-09-11):** store #3. Receipt parser built and registered on the
**lab lane**; price adapter built and **inert by design**. `enabled: false` in
every database. Nothing user-visible has changed.

## Files

| File | What it covers |
| --- | --- |
| `Receipt_Parser.md` | The layout, the seven rules it needed, and what is owed before promotion. **Start here.** |
| `Price_Feed.md` | The feasibility investigation, the three walls, the addressability gap, and the two money-path questions still open. |

## Where the code lives

| Concern | File |
| --- | --- |
| Receipt parser | `src/services/sportChekReceiptParser.js` |
| Parser registration (lab) | `src/services/receiptParsers/index.js` → `LAB_STORE_PARSERS` |
| Picker registration (lab) | `src/constants/stores.js` → `LAB_ONLY_STORES` |
| Detection | `src/services/receiptParsingShared.js` → `STORE_DETECTION_PATTERNS` |
| Price adapter | `backend/lib/sportChekCatalog.js` |
| Live probe | `backend/scripts/sportchek-quote-probe.js` (`npm run sportchek:probe`) |
| Receipt corpus | `__tests__/fixtures/receipts-sportchek/` (2 PDFs, **0 captures**) |
| API captures | `backend/tests/fixtures/sportchek-api/live-2026-09-11/` |

## Store-neutral material lives elsewhere — on purpose

- `Technical/Adding_A_New_Store.md` — the full procedure for any store. **This
  store is the reason that document exists**; three of its rules were written
  from defects found here.
- `Technical/Store_Price_Adapters.md` — the adapter contract, the NATIONAL
  province, the `scrape` source type.
- `Technical/Receipt_Parser_Registry_And_Store_Parsers.md` — the registry, the
  parser contract, the lab lane.

## The three things to know

1. 🔴 **A Sport Chek receipt used to be detected as no store at all** — not the
   wrong store, *none*. Sport Chek is a Canadian Tire Corporation banner and its
   Triangle Rewards footer matched `canadiantire` first, which has no `STORES`
   record, which ended the scan at `null`. Fixed; see `Receipt_Parser.md` §1.

2. 🔴 **The receipt's identifier cannot address the catalogue.** Receipts print
   a 12-digit UPC; Sport Chek addresses products by a 9-digit SKU code. The live
   search API answers `resultCount: 0` for the UPC. See `Price_Feed.md`.

3. 🔴 **Node cannot reach sportchek.ca.** Not a policy problem — `robots.txt`
   permits everything the feed would do — but Akamai fingerprints the client
   below the header layer, and curl gets 200 where Node gets 403.
