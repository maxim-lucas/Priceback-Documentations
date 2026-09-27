# Receipts keep the customer's original document

**Since:** 2026-09-26 · **App PR:** Priceback `feat/receipt-original-document` · **Store-neutral**

A receipt's stored file is now **the file the customer gave us** — a camera
photo, a gallery screenshot, a PDF (e.g. a costco.ca order), or a text/HTML
e-receipt. It is kept on the device, uploaded to R2 under its real type, and
shown in the app's Receipt section. The app no longer draws a picture of its
own summary and passes it off as the receipt.

---

## 1. What was wrong

`ScanScreen.doSave` treated any non-image upload (PDF, `.txt`, `.csv`, `.html`,
`.eml`, `.md`) — and any receipt with no file at all — the same way:

1. It rendered an off-screen `ReceiptSnapshotView` of the parsed summary and
   captured it with `react-native-view-shot` (a PNG).
2. That **screenshot** became `receipt.imageUri`. The real document was kept
   only as `originalFileUri` — a **cache** path that was never persisted, so
   the OS could evict it at any time.
3. Sync uploaded `imageUri` — the screenshot — to R2 as `<id>.jpg` with
   `Content-Type: image/jpeg` (it was a PNG).
4. The Detail screen and Claim Assistant showed the screenshot; the "Open
   original PDF" button pointed at the cache path.

So the object in R2, and what a shopper would show at the Costco counter, was a
document PriceBack had drawn. Seen in production on 2026-09-26 (receipt
`r_1790469584273_xstgw`, Rimouski).

A second, older gap surfaced on the way: **the app never read a receipt's R2
copy back.** `syncService` restores receipts with `imageUri: null` and a
comment promising *"DetailScreen fetches a presigned URL on open"* — nothing
did. A reinstalled phone had no receipt pictures at all. And a failed upload
after the receipt POST was never retried.

## 2. The model now

| Field (local receipt) | Meaning |
|---|---|
| `imageUri` | The receipt's stored file, **any format** (name kept: every sync, delete and export path already follows it). Persisted under `documentDirectory/receipts/` with the extension of its real type. |
| `imageMimeType` | Its type (`application/pdf`, `text/html`, `image/jpeg`…). Absent on old receipts → derived from the extension. |
| `documentUploadPending` | The receipt synced but its file did not reach R2 yet. |
| `originalFileUri` | Legacy only. No longer written. |

Kind → display (`src/utils/receiptDocument.js`, `src/components/ReceiptDocumentPreview.js`):

| Kind | Types | In the app |
|---|---|---|
| image | jpeg, png, webp, heic, heif | drawn inline |
| pdf | application/pdf | "Open your receipt (PDF)" → OS share sheet / viewer (local) or browser (remote) |
| text | text/*, message/rfc822 | shown as selectable text (HTML/e-mail markup stripped) + an Open button |

A **manual entry has no file and now gets none** — the Receipt card is hidden
rather than showing a fabricated image.

## 3. Upload contract (backward compatible)

`backend/lib/receiptDocument.js` is the allowlist.

| Client declares `imageContentType` | Key | Stored `Content-Type` | Cap |
|---|---|---|---|
| *(nothing — every build before this one)* | `<id>.jpg` | `image/jpeg` | 8 MB |
| `image/png`, `image/webp`, `image/heic`… | `<id>.png` … | same | 8 MB |
| `application/pdf` | `<id>.pdf` | `application/pdf` | 15 MB (= the picker's limit) |
| `text/plain`, `text/csv`, `text/html`, `message/rfc822`… | `<id>.txt/.csv/.html/.eml` | **`text/plain; charset=utf-8`** | 15 MB |
| anything else | — | **refused** (no URL; the receipt itself still saves) | — |

- Text-like files are stored **inert** as `text/plain`: the key keeps `.html`
  so the app knows to strip markup, but R2 never serves live HTML.
- `POST /api/receipts` → response adds `imageContentType`; the client PUTs with
  exactly that header (it is part of the signature). An old server returns none
  → the client sends `image/jpeg`, matching what the old server signed.
- `POST /api/receipts/:id/image-uploaded` accepts **any allowed extension for
  THIS receipt id under THIS user** (M-6 binding preserved). When the key
  changes (legacy `.jpg` snapshot → real `.pdf`) the superseded object is
  deleted best-effort; the retention sweep covers a failed delete.
- **New:** `POST /api/receipts/:id/image-upload-url` `{ imageContentType, imageBytes }`
  → a fresh presigned PUT for a receipt the caller owns (404 otherwise, 422
  `UPLOAD_UNAVAILABLE` for a refused type/size or a down object store). Used to
  retry a failed upload and to replace legacy snapshots.
- `GET /api/receipts/:id` and `GET /api/admin/receipts` add `imageContentType`.
- Retention unchanged: every key is recorded at presign (`object_retention`,
  `receipt_image`) and pruned by `RETENTION_RECEIPT_IMAGES_DAYS`.
- No DB migration: `receipts.image_object_key` simply carries the real extension.

## 4. Recovery paths

- **Failed upload** — `syncReceiptToBackend` returns `documentPending: true`;
  `recordSyncOutcome` sets `documentUploadPending`; `retryPendingDocumentUploads`
  (run at the end of every `retryPendingReceiptSyncs` pass: boot, foreground,
  sign-in, sync) finishes it via the re-upload route. Stops on signed-out / 401;
  a terminal answer (file gone, type refused) clears the flag.
- **Legacy receipts** — migration `2026-09-26-original-receipt-documents`: where
  `originalFileUri` still exists on the phone, it is copied into
  `documentDirectory/receipts/`, becomes `imageUri`, the snapshot file is
  deleted, and (if already synced) the receipt is queued for re-upload — the
  server then deletes the R2 snapshot. **Where the OS already evicted the
  original, the snapshot stays**: it is all that is left, and there is no copy
  of the real file anywhere to recover.
- **Restored receipts** — `useReceiptDocument` fetches `GET /api/receipts/:id`
  when there is no local file and the receipt is on the server, and shows the
  R2 copy through the presigned GET (60 min TTL).

## 5. What is NOT covered

- **Gmail receipts** stay local-only and have no file anyway (Limited Use —
  `reuploadReceiptDocument` carries the same gate as the receipt sync).
- **The receipt already in production today** keeps its snapshot in R2 until
  its owner opens an updated build **with the original PDF still in the phone's
  cache**. The server cannot recover a file it never received.
- **Store-listing declarations** — see §6.

## 6. ⚠️ Compliance follow-up (owner's decision, not edited)

`Publishing-Compliance/Play_Data_Safety_Answers.md` (Photos row) says receipt
images are *"sent to OCR and **not retained by us**"*. That was already
inaccurate — receipt photos have been kept in R2 under a 90-day purge — and
this change extends retention to original **documents**, which for an online
order can include the customer's name and delivery address. The Play Data
Safety form (Photos, and probably "Files and docs"), the App Store privacy
label, and the privacy policy's wording on receipt images should be reviewed
together. Not edited here: these are filed declarations.

## 7. Files

App: `src/utils/receiptDocument.js`, `src/components/ReceiptDocumentPreview.js`,
`src/screens/{ScanScreen,DetailScreen,ClaimAssistantScreen,AdminReceiptsReviewScreen}.js`,
`src/services/{receiptSyncService,storageService}.js`, `src/services/i18n.js`
(`receiptDoc.*`, EN + FR). Removed: `src/components/ReceiptSnapshot.js`.

Backend: `backend/lib/receiptDocument.js`, `backend/server.js`
(`presignReceiptDocument`, the three receipt routes, admin list).

Tests: `backend/tests/receiptDocument.test.js`, `backend/tests/receiptDocumentDb.test.js`,
`__tests__/receiptDocument{Utils,Preview,Storage}.test.js`,
`__tests__/scanScreenKeepsOriginalDocument.test.js`, plus updated
`receiptSyncServiceImageAndErrors`, `adminOnlyDiagnosticSurfaces`,
`adminReceiptsReviewScreen.smoke`.
