# Price tag translator (2026-10-02)

The price tag scanner is now also a **translator**: it tells the shopper whether a
Costco tag is a good deal, decoded **on the device** so it works with the poor
reception typical inside warehouses.

## Decoder — `shared/priceSignal.js` (`decodePriceEnding`)
| Ending | Signal | Tier |
|---|---|---|
| .99 / other | `regular` | normal |
| .97 | `markdown_97` | good |
| .X9 (not .99) | `manufacturer_promo` | good |
| .00 | `manager_markdown_00` | best |
| .88 | `clearance_88` | best |
| `*` on tag | Death Star note: item will not be restocked | (no tier change) |

One function, two callers: the app (offline) and `backend/services/priceSignalService.js`
(server `deal_signal`). Mirrored to `backend/shared` by `sync-shared.js`; a parity test
asserts server and device agree for all 100 endings.

## Where the shopper sees it
- **Intro screen — `QuickPriceCheck`**: type the price + star toggle → verdict. No camera, OCR or network.
- **Review card (`TagCard`)**: verdict from the OCR'd price, before submitting, plus a
  **Death Star toggle** — Vision often misses a faint corner star.
- **Done screen**: unchanged server `deal_signal` badges.

## Death Star detection (`costcoTagScanner.js` `ASTERISK_RE`)
Now also matches lookalike glyphs (★ ☆ ✱ ✲ ✳ ✴ ✶ ✷ ✸ ⁎ ∗ ＊) and a star glued to a price
(`21.99*`, `*21.99`). `2*500ML` / `ITEM*NAME` stay false. Only `hasAsterisk` is affected.

## Expired savings earn nothing
Server already withheld credit (`status:"expired"`; settlement filters
`valid_until >= today`). The gap was the review badge, which still promised credit.
`classifyTagSavings(tag, { today })` now returns `reason:"expired"`; `TagCard` passes the
shopper's province day and shows "Savings ended — no credit". Without `today` the
predicate is byte-for-byte the old behaviour — the server's call shape — so
submission and credit settlement are untouched.

## Regression notes
- Submission payload unchanged; `hasAsterisk` can now be true more often (stored flag only, never gates credit).
- Fixed latent bug: an invalid price produced a Death Star note (`"normal"` passed into the asterisk slot).
- Limitation: scanning a tag still needs OCR (server-side Vision). Offline, use the quick check; photos queue as before.
