# Price tags: only SAVINGS tags earn credit

**Since:** 2026-09-29 (branch `hotfix/price-tag-savings-only`). Standing rule for the price-tag scanner.

## The rule

A scanned tag is a **savings tag** only when BOTH are true:

1. **a discount** — an instant-savings amount > 0, *or* a price-before-discount higher than the discounted price; and
2. **a validity date** — a real ISO `YYYY-MM-DD` end date (a real promo always prints `EXP <date>`).

Anything else is a **regular-price tag**: it is still read, still reaches the review screen, and is still stored as a
`price_points` row (SKU, product, price — the price pool's reference data). It just never earns credit.

One predicate, `shared/tagSavings.js` (`classifyTagSavings` → `{savings, reason: null|"no_discount"|"no_date"}`),
mirrored into `backend/shared/` by `sync-shared.js` (parity-tested). Used by:

| Where | How |
|---|---|
| `TagCard` (both scan flows + the offline PendingTagScan review) | live badge, recomputed on every edit |
| `POST /api/observations/tag` | `hasSavings` → status `no_savings` (no settlement attempted) |
| `tagCreditsRepo.settleVerifiedTagCredits` + `settleAllVerified` | SQL now `pp.valid_until >= today` — the old `IS NULL OR` escape is gone, so an admin **Verify** or the sweep can't pay a dateless tag either |
| `AdminTagReviewScreen` | per-card verdict; button reads "Verify · no credit" for regular tags |

The server copy is the one that matters: OTA updates are unavailable on the current EAS plan, so installed binaries keep
sending the old payload — the server rule covers them at once.

## Screen copy (en + fr, `priceTag.*`)

`savingsOnlyNotice` (intro banner), `badgeSavings` / `badgeNoDate` / `badgeRegular` (per tag), reworded
`creditPerTag`, `statusNoSavings` (done screen — "Saved as a regular price — thank you!").

## Pending review = price points

A tag waiting in the admin queue already has its unverified `price_points` row (created at submit). Nothing extra
is needed for "keep it as a reference"; what changed is that the credit can't be released for a non-savings tag.
Prod check 2026-09-29: the six pending rows had **0 ledger rows**; three had `regular > current` with `valid_until NULL`
(would have been payable under the old rule; not now).

## Parser (`src/services/costcoTagScanner.js`) — tag parser only; the receipt parser is untouched

Grounded on the real OCR of the six tags (fixtures in `__tests__/costcoTagFrenchEcoFee.test.js`):

- **ÉCOFRAIS / eco fee:** OCR order ≠ layout ("299.64 / +35 / 299.99 … TOTAL"). The fee amount pairs the two prices
  (`base + fee = total`) → the total is the price paid; original = total (+ savings when present).
- **`TOTAL` label** as the fallback final price when no eco-fee pair exists.
- **`FXP` / `EXR` for `EXP`** in both date parsers.
- **French savings words:** "rabais instantané", "économisez".
- **Cluttered read:** no price label + 3 or more distinct amounts → confidence drops from *high* to *medium*.

## Review photo "Couldn't load the image"

`ZoomableImage`: a failed load retries twice on its own (remounting the `<Image>`, asking `onRefreshUri` for a
freshly signed URL each time), then shows the message with **Try again**. Admin screen supplies
`GET /api/admin/price-tag-reviews/:id/image-url` (admin-only, rate-limited like its siblings). Root cause is not
proven on-device (transient download vs. expired signature both fit); both are now recoverable.
