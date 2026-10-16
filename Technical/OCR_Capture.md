# OCR capture — replaying a live scan under the shopper's own conditions

**Status:** built 2026-10-03 on `feat/ocr-capture` (app repo). Migration `0017_ocr_captures`.
**Owner decision (Maxim, 2026-10-03):** *"keep the Vision response in prod and save any necessary data
to reach our goal for a perfect receipt parser … we have to save the exact and same conditions as real
live scan from users."*

## Why

The receipt parser is tuned against real receipts. Until this change, the only copies of a live scan
that survived were:

| What | Why it is not the shopper's scan |
|---|---|
| The stored receipt photo (R2) | A **post-OCR derivative**: cropped to the text bounds (or resized to 1400px) and re-compressed. Vision read a *different* image — the 1200px / q0.80 resize (`ocrService.js`, `OCR_RESIZE_WIDTH`), or 2000px / q0.92 on the high-res second pass. |
| `receipts.raw_ocr` | The **cleaned, header-stripped** flat text — no word geometry, so the geometry path (the one the app actually takes on a photo) cannot be replayed. |

Measured on 2026-10-03: re-OCRing the 24 stored prod photos gave measurably different text from what
prod stored — `2652709 DAWN` came back `DAWNY`, `0000392563/3139415` came back with spaces, lines
re-ordered. Hand-corrected text fixtures had additionally hidden real failures (one receipt passed on
its corrected text and failed on its real OCR). A fixture that is not the shopper's input measures
something else.

## What is kept

Every successful `POST /api/ocr` call (receipts, price tags, PDFs — any flow), **after** the response
has been sent to the app:

1. **The image** — the exact base64 bytes the route sent to Google Vision, stored as-is
   (`<env>/ocr-captures/<sub | anon-<deviceHash>>/<stamp>-<rand>.<jpg|png|webp|pdf>`).
2. **The envelope** — gzipped JSON next to it (`.json.gz`):
   `{ version, capturedAt, request: { feature, mimeType, isPdf, pages, imageBytes, imageObjectKey },
   client: { userAgent, scanContext }, visionMs, response }` where `response` is **Vision's JSON
   verbatim** — the very object the app parsed.
3. **The index row** — `priceback.ocr_captures` (id, user_sub, receipt_id, both keys, created_at).

`scanContext` is sent by builds from this release on (`ocrService.buildScanContext`): flow
(`receipt` / `price_tag`), pass (`standard` / `high_res`), resize width + quality, processed image
size, app version, platform, OS version. The server keeps only those whitelisted, type-checked fields
(`sanitizeScanContext`). Older builds send none — their captures are still exact; they just do not
say which pass they were.

Replaying the envelope's `response` through the parser reproduces the shopper's parse byte-for-byte —
that is the whole point.

## Linking a capture to its receipt

The OCR call comes first and carries no receipt id, so the link is made when the receipt arrives:
`POST /api/receipts` (new receipts and back-fills only) → `linkReceiptInBackground` reads the user's
unlinked captures from the last 3 days and links every one whose text contains the receipt's
**item lines** (`<number> NAME`) — threshold 0.6.

Measured on the prod corpus (18 stored receipts × 24 captures): the same receipt scored **0.76–1.00**,
any other receipt **≤ 0.33**. Counting every line instead of item lines did not separate them
(two different Gloucester receipts of one shopper scored 0.75 — they share the address, SUBTOTAL, TAX).
Both passes of a receipt read twice (standard + high-res) link to it. Scans the shopper abandoned stay
unlinked — and are kept: they are exactly the failures worth studying.

## Retention and deletion

Same model as receipt photos (`jobs/pruneReceiptImages`, audit #6 H3):

- Both keys are written to `object_retention` (type `ocr_capture`) **before** either object exists.
- `jobs/pruneOcrCaptures` (daily maintenance) deletes objects older than
  `RETENTION_OCR_CAPTURES_DAYS` (**90**), then the index row, then marks the ledger.
- Kept through receipt deletion and account deletion (FKs are `set null`), removed by age alone.

Kill switch: `OCR_CAPTURE_ENABLED` (app_config, read with `getOpsFlag` so an operator's `"false"`
means off). The OCR call is unaffected either way.

## ⚠️ Privacy / store-declaration impact — decision needed

The envelope is **verbatim** by design, so it contains everything Vision read, including the
**Costco membership number** and the card's last digits as printed. Two declarations rest on
"we don't collect that":

- `receipts.member_id` was descoped on 2026-07-24 "so the Play Data Safety form can truthfully answer
  'not collected'" (comment in `server.js`).
- The stored receipt photo already shows the same number, so the *image* data type is unchanged —
  but the number now also exists as machine-readable text in our storage for 90 days.

Options (Maxim's call): (a) keep verbatim and update the privacy policy + Data Safety wording to say
OCR text of the receipt is retained 90 days for quality; (b) scrub member/card digits from the stored
response before writing (the replay would then differ from the live parse only on those tokens — the
parser does not use them). The code today does (a)'s storage; the declarations have **not** been
changed. Committed fixtures are always scrubbed (`scripts/lib/receiptPiiScrub.js`); the unscrubbed
envelope is gitignored.

Also owed: the DSAR export (`src/services/dsarExport.js`) does not yet list captures.

## Turning captures into fixtures

```
railway run -e production node scripts/exportOcrCaptures.js                # everything not yet exported
railway run -e production node scripts/exportOcrCaptures.js --receipt r_…  # one receipt
railway run -e production node scripts/exportOcrCaptures.js --since 2026-10-01
```

Writes to `__tests__/fixtures/receipts/prod-captures/`:
`<receiptId>__c<id>.vision.json` (committed — the app's own `{text, words}` conversion of the verbatim
response via `scripts/lib/visionFixture.js`, confidence **unrounded** because the faint-print repair
compares it to thresholds, then the PII scrub), the image (gitignored) and the raw envelope
(gitignored). The real-OCR suites pick up the new `.vision.json` automatically.

Standing rule (memory `parser-bug-pull-prod-receipts-as-fixtures`): every receipt-parser problem
starts by exporting the captures not yet in fixtures and tuning against the whole corpus.

## Deploying

1. **Prod DB first** (prod's drizzle ledger is hand-maintained): apply
   `backend/db/migrations/0017_ocr_captures.sql` by hand, then insert its ledger row with the file's
   LF hash. Every statement is idempotent. Until it is applied, captures fail and are logged
   (`[ocr-capture] capture failed (non-fatal)`); scans are unaffected.
2. Merge → Railway deploys the backend. Captures start immediately for every build in the field.
3. The `scanContext` field ships with the next app build.

## Files

Backend: `lib/ocrCapture.js`, `repos/ocrCapturesRepo.js`, `jobs/pruneOcrCaptures.js`,
`db/migrations/0017_ocr_captures.sql`, `db/schema.js`, `db/seed.js`, `config/defaults.js`,
`storage/{index,gcs}.js` (`putObject`/`getObject`), `server.js` (`/api/ocr`, `/api/receipts`,
admin receipt detail, maintenance job). App: `src/services/ocrService.js` (`buildScanContext`),
`scripts/exportOcrCaptures.js`, `scripts/lib/visionFixture.js`.
Tests: `backend/tests/{ocrCapture,ocrCaptureRouteDb,ocrCapturesDb,pruneOcrCaptures,storageAdapters}.test.js`,
`__tests__/{ocrScanContext,exportOcrCaptures}.test.js`.
