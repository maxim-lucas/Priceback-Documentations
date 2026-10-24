# Device ↔ server sync audit (2026-10-23)

**Asked by:** Maxim, /goal of 2026-10-21: *"start a deep analysis on any data that could not sync correctly between the device and the server"*.
**Code read:** `maxim-lucas/Priceback` `main` at `f834fb4` (3.1.3, build 53). Every `file:line` below is at that commit.
**Data:** only the dev database (`gnedluuylimjwdmtvswl`). Production was not queried during the audit, at Maxim's instruction. The production counts quoted in the plan were read before that instruction was given.
**Fixes:** Priceback #481 (sync safety), #482 (never merge different values), #483 (repair modes), #484 (Gemini first) and #486 (line identity and shopper edits). Everything left open is in `Roadmap/FUTURE_ROADMAP.md`, § *Sync integrity: deferred*.

---

## 1. How the phone and the server share data

The phone is the source of truth for what the shopper sees. The server is the backup, the shared price pool, and the only place that charges credits and sends drops. Data crosses between them in three ways:

- **Push:** the phone sends a write. If it fails, the write goes to a durable queue that is drained on boot, on every foreground and after sign-in.
- **Pull:** `GET /api/me/bootstrap` runs on boot, on every foreground (`App.js:507`) and on sign-in. It is followed by `GET /api/receipts?offset=` pages (`syncService._fetchRemainingReceipts`).
- **Merge:** `syncService.unionMergeReceipts` adds, updates and removes receipts by id. `mergeServerIntoLocal` folds one server receipt into the local one. The server's header wins since #477, and lines are paired **by index**.

| # | Data | On the phone | Push | Server | Pull / merge | Findings |
|---|---|---|---|---|---|---|
| 1 | Receipt header (store, date, total, tax, warehouse, channel, OCR) | `receipts_v2` | `POST /api/receipts` (`receiptSyncService.syncReceiptToBackend`; `syncPending`, retried on boot/foreground) | `receipts` | Bootstrap + pages. **The server's header wins** (#477) | S3, S6, S9, D1 |
| 2 | Receipt lines | `receipts_v2[].items` | **Only inside the receipt's upload.** No route takes a line later | `receipt_items`, plus the `receipt_ocr` price points | **Positional:** server line *i* pairs with local line *i* (`syncService.js:180-209`) | S1, S2, S8 |
| 3 | Line edits (name, price, quantity, a line added) | `receipts_v2` only | **None** | — | Replaced by the server's lines on the next pull | S1 |
| 4 | Header edits (date, store, warehouse, totals) | `receipts_v2` only | **None** | — | Replaced by the server's header on the next pull | S1 |
| 5 | Line delete | `receipt_item_deletes_pending` | `DELETE /api/receipts/:id/items/:index` + `{lineTotal, quantity}` fingerprint | `receipt_items.deleted_at` | Positional | S2, D3 |
| 6 | Claim | `receipt_item_edits_pending` (`kind: claim`, kept 90 days) | `POST …/items/:index/claim` + fingerprint | `receipt_items.claimed_at` | `claimedAt` = the later side | S2, S5, D4 |
| 7 | Watch on/off per line | Same queue (`kind: watch`) | `PUT …/items/:index/watch` + fingerprint | `receipt_items.watch_enabled` | Server value wins | S2, S5 |
| 8 | Receipt delete | `receipt_deletes_pending` (tombstones) | `DELETE /api/receipts/:id` | `receipts.deleted_at` | Bootstrap `deletedReceiptIds` | D12 |
| 9 | Drops PriceBack released (charged) | `released_drops_v1` | — (server → phone) | `price_drop_notifications` | Bootstrap `releasedDrops`, keyed by (receipt, **position**) | S2 |
| 10 | Watch registration + crowd copies | — | `POST /api/watch` on every Home focus, fire-and-forget | `watch_registrations`, `price_points` (`flyer_user_scan`) | — | D2, R1 |
| 11 | Preferences (language, warehouse, auto-reload, low-balance threshold) | `user_prefs_v1`, `app_language` | `pushCloudPrefs` → `PUT /api/me` | `users.preferences` | `_applyPrefs`: last writer wins on `preferencesUpdatedAt` | S7, S9, D11 |
| 12 | Notification switches, consents, display name, membership | `profile_sync_pending_v1` (profile outbox) | `PUT /api/me` (`flushProfileSync`) | `notification_settings`, `consents`, `users` | `_applyPrefs` (guarded against a queued change) | S4, D5 |
| 13 | Postal code / province | `user_prefs_v1` | `PUT /api/me`, fire-and-forget | `users` | `_applyPrefs` | D10 |
| 14 | Push token | `expoPushToken` | `syncPushTokenToBackend` after each hydrate | `users.push_token` | — | D6 |
| 15 | Credits | `last_known_credit_balance_v1`, `offline_scan_log_v1` | Charged inside `POST /api/receipts`; offline scans through `POST /api/me/credits/offline-scans` | `credit_ledger` | Bootstrap `credits.balance` (snapshot) | S3, D9 |
| 16 | Receipt photo / PDF | File on disk (`imageUri`) | Presigned upload after the receipt's POST; re-upload route on failure | R2 + `receipt_files` | Fetched on demand (`fetchReceiptDocumentRemote`) | D7, D13 |
| 17 | Price-tag scans | `pending_tag_scans_v1` | `POST /api/observations/tag` + photo | `price_points` (`price_tag_scan`), `tag_scan_reviews` | — | D8 |
| 18 | Gmail receipts | Local only, **by design** (Google Limited Use) | Never | — | — | — |

---

## 2. Findings

Severity:
- **High:** the shopper's data is lost or overwritten, or the wrong credits are charged.
- **Medium:** the phone shows wrong data until a later sync, or the server learns something wrong.
- **Low:** rare or cosmetic.

| # | What goes wrong | Severity | Builds hit | Status |
|---|---|---|---|---|
| S1 | A shopper's corrections never reach the server, and the next sync reverts them | High | all (2.8.3+) | **#486** (open; next build) |
| S2 | Lines have no shared identity: claims, chips and deletes land on a neighbour after a shift | High | all | **#486** (open; server additive, app next build) |
| S3 | A re-sent receipt was charged again, or refused with 402 and deleted on the phone | High | all | **Fixed #481** (server-side, all builds) |
| S4 | The profile outbox crossed the account boundary | High | all | **Fixed #481** (next build) |
| S5 | Sync merges before the queued claim/watch edits drain | Medium | all | **#486** (open; next build) |
| S6 | Restore pages could skip a receipt and repeat another | Medium | all | **Fixed #481** (server-side, all builds) |
| S7 | Sign-out pushed its auto-reload reset to the account | Medium | all | **Fixed #481** (next build) |
| S8 | A line's tax class is lost by the sync and by admin repairs | Low | all | Repairs **fixed #483**; sync **#486** |
| S9 | A restored language never applied; a US receipt restored as "watching" | Low | all | **Fixed #481** (next build) |
| R1 | A server correction is undone in the crowd pool by a phone that has not synced yet | Medium | all | **Fixed #484** (for the Gemini re-read) |
| D1–D15 | Documented, not fixed (below) | — | — | Roadmap |

### S1. Shopper corrections are local only, and the next sync reverts them (High)

**What happens.** On a receipt's detail screen (`DetailScreen.js:425-491`), the shopper can fix a line's name, price or quantity, add a missing line, and change the header (date, store, warehouse). The edit is saved by `storageService.updateReceiptItem` / `addReceiptItem` / `updateReceipt` (`storageService.js:744-897`). These functions write AsyncStorage only. No route accepts a line edit.

The next hydrate (on boot and on **every foreground**, `App.js:507`) merges the server copy back in (`syncService.js:176-265`):
- the server's lines replace the edited ones (positional merge);
- an added line disappears, because the merged list has the server's length;
- since #477 the server's header wins, so a corrected date or warehouse goes back to the scan's.

The server's prices, the drop sweep and the crowd pool never see the correction.

**Fix (#486).**
- An owner-only `PUT /api/receipts/:id/lines` that keeps positions stable: lines change in place, new lines are appended, nothing is reordered.
- A durable edit queue, with the same contract as claims and cleared at the account boundary.
- A hydrate keeps the local copy of a receipt whose edit is still pending.
- On 409 (the server's lines changed meanwhile), the edit is dropped and the server copy taken, with a translated notice.
- Store, warehouse and **purchase date** become admin-only: a new date reopens the price window (drops and commissions) and moves price points. The detail screen shows them read-only, with a translated "contact support" hint.
- Edited lines file **no** price point and are marked (`shopper_edited_at`, migration 0033). A drop on an edited line still goes through the admin review queue.

### S2. Lines have no stable identity across the phone and the server (High)

**What happens.**
- Server lines pair with local lines **by index** (`syncService.js:180-209`).
- Released drops are keyed by (receipt, **position**).
- Claim, watch and delete find the line by its index, then fall back to the first line with the same total (`receiptsRepo.js:1115-1127, 1188-1201, 1280-1293`).

A line deleted on one side, a repair that changes the line count, or two lines of one SKU shifts every pairing after it. A claim lands on the neighbour. A drop chip shows on the wrong product. A claim queued against a line that changed answers 404 and is retried for 90 days.

**Fix (#486).**
- The phone keeps each line's server id (`serverItemId`: the bootstrap `id`, plus line ids in the `POST /api/receipts` answer).
- The merge pairs by server id first, then SKU + amount, then position.
- Claim, watch and delete accept an optional `itemId`. Old builds keep index + fingerprint, which still works.
- Released drops carry `itemId`.

### S3. A re-sent receipt was charged again (High) — fixed #481

**What happened.** `POST /api/receipts` charged the scan cost **before** checking whether the receipt id already belonged to the caller (`server.js:11606-11667`). A receipt that cost 0 credits leaves no ledger row (`creditsRepo.js:199`), so the idempotency check found nothing.

A re-send (the hydrate's "not on the server, push it up", or a retry after a dropped answer) was then charged again. With a low balance it was refused with **402**, and the phone deleted its copy and photo.

**Fix.** The charge, and the 402, now apply only to a receipt id the caller does not already own. This is server-side, so it covers every build. Test: `receiptCreditRefusalDb`.

### S4. The profile outbox crossed the account boundary (High) — fixed #481

**What happened.** `profile_sync_pending_v1` survived sign-out (`clearAccountScopedStorage`, `storageService.js:1899-1910`). Account A's queued consents, notification switches and name were sent under **B's** token at B's first hydrate.

**Fix.** The key is cleared with the other account-scoped keys (`PROFILE_SYNC_PENDING_KEY`, exported). Test: `localAccountBoundary`.

### S5. Sync merges before queued claim/watch edits drain (Medium)

**What happens.** `_hydrate` merges the server copy (`syncService.js:721-774`) while claim and watch edits may still sit in `receipt_item_edits_pending`.
- A **claim** survives: the merge keeps the later `claimedAt`.
- A **watch-off** does not: the merge takes the server's `watchEnabled`, so the line shows as watched again until the queue drains and a later hydrate brings the change back.

With #486's edit queue, a pending line edit would be reverted the same way.

**Fix (#486).** The hydrate drains the claim, watch and edit queues **before** merging, and keeps the local lines and header of a receipt whose edit is still pending.

### S6. Restore pages could skip a receipt (Medium) — fixed #481

**What happened.** `listForUser` ordered by `purchase_date` only (`receiptsRepo.js:667`). Receipts with the same date have no stable order across pages, so a restore could miss one and repeat another. The missing one then looked "not on the server" and was uploaded again, which S3 then charged.

**Fix.** `ORDER BY purchase_date DESC, id DESC`. Test: `receiptsDb` (paging).

### S7. Sign-out pushed its auto-reload reset (Medium) — fixed #481

**What happened.** On sign-out, auto-reload is reset through `savePrefs`, which stamps `preferencesUpdatedAt` (`purchaseService.js:1118-1121`, `storageService.js:1469-1492`). At the next sign-in, the reset looked newer than the server's copy and was pushed up, which turned auto-reload off on the account.

**Fix.** The reset is no longer stamped (`preferencesUpdatedAt: null`), so it never wins against the server. Test: `auditMoneyBatch`.

### S8. The tax class is lost (Low) — repairs fixed #483, sync #486

**What happens.** The bootstrap omits `tax_class_id` (`receiptsRepo.js:558-586`), and the merge drops the phone's `taxClass`. Admin repairs wrote every line back with **no** tax class (`badScanRepair.validateSpec:175-183`).

**Fix.**
- #483 makes repairs carry `taxClass`, `barcode`, `unitPrice`, `priceFromDatabase` and the shopper's watch-off.
- #486 adds `taxClass` to the bootstrap lines. The merge keeps the local value when the server sends none.

### S9. Restored language and US receipts (Low) — fixed #481

**What happened.** `_applyPrefs` stored the server's language but never switched the app's language (`syncService.js:910`). The server's `unsupported_country` status restored as "watching" (`syncService.js:134-135`).

**Fix.** A newer restored language is applied (`setLanguage`). `unsupported_country` restores as a refused receipt, like `rejected`.

### R1. The crowd pool re-learns a corrected price (Medium) — fixed #484 for the re-read

**What happens.** A correction made on the server (an admin repair or the Gemini re-read) reaches the phone only at its next hydrate. Until then, the phone re-registers its **uncorrected** lines through `POST /api/watch` every time Home opens, and each registration files crowd copies (`flyer_user_scan`) at the bad prices.

`badScanRepair` takes the bad parse's crowd copies back, but only **once**, at repair time.

**Fix (#484).** For a receipt Gemini re-read, `/api/watch` files a crowd copy only when the corrected lines carry that SKU at that unit price, paid or regular (`receiptsRepo.rereadReceiptUnitPrices`). The re-read records its reader inside the repair's transaction, so the guard has no gap. **Admin repairs still have the gap:** see the roadmap.

---

## 3. Documented, not fixed (roadmap)

| # | Gap | Where | Effect |
|---|---|---|---|
| D1 | A receipt the server refuses for good keeps `syncError` on the phone, but no screen reads it | `receiptSyncService.syncReceiptToBackend` | The shopper believes the receipt is backed up |
| D2 | `/api/watch` is fire-and-forget: the answer is never checked, and an empty list is never sent | `priceService.registerForPriceWatch:497-617` | A phone whose last watched line was claimed keeps its old registration on the server |
| D3 | A 500 on the line-delete route carries `retryable:false`, so the phone drops its queued delete | `server.js:12022`; `storageService.retryPendingReceiptItemDeletes:550-568` | The line stays on the server and returns at the next sync |
| D4 | Claim and watch queue entries expire after 90 days | `storageService.js:581` | An offline claim on a receipt that never synced is lost |
| D5 | The profile outbox retries a write the server refused for good (400) forever | `profileSyncQueue.flushProfileSync:141-149` (any non-OK → `null` → stays queued) | Endless retries; nothing delivered |
| D6 | The push-token back-fill reports success without checking the answer | `notificationService.syncPushTokenToBackend:287-294` | A token the server refused looks synced; no server push reaches the phone |
| D7 | The file re-upload ends on any answer the server marks not retryable | `receiptSyncService.js:705-716` | The photo never reaches the server |
| D8 | A tag-scan photo has no retry | `tagScanQueue` | The admin review has no photo |
| D9 | An offline-scan flush whose answer names no `applied` refs treats **all** sent refs as acknowledged | `purchaseService._flushOfflineScanLogOnce:1235-1240` | Offline scans the server did not charge are cleared |
| D10 | Postal-code edits are fire-and-forget | Profile screens | A failed write is not retried; the server keeps the old province |
| D11 | Preferences use last-writer-wins, comparing the phone's clock with the server's | `_applyPrefs` | A phone with a skewed clock can win or lose a change it should not |
| D12 | The bootstrap caps `deletedReceiptIds` at 500, and a restore at 25 pages | `syncService._fetchRemainingReceipts` | Very long histories restore partially |
| D13 | Photos stay on disk after an account switch | `clearAccountScopedStorage` | Another account's photos on a shared phone |
| D14 | A receipt added from the server takes the server's `createdAt` | `mapServerReceiptToLocal` | Order on a new device follows the upload time, not the scan time |
| D15 | Restoring an account inside its grace window keeps its receipts deleted | Account deletion | Matches the copy "Your data has been erased". A product decision, not a bug |

---

## 4. What the fixes change for each live build

- **Server-side, every build at deploy:** S3, S6, and the re-read and its guard (R1). The re-read reaches 2.8.3–3.1.3 through the hydrate they already run. It only touches a receipt under 30 minutes old with no claim, push or review row, so it can never move a claimed line.
- **The next store build:** S4, S7, S9 (#481); the never-merge parser rule (#482); Gemini first (#484); line identity and shopper edits (#486).
- **Old builds and #486's server routes:** builds before #486 keep claim, watch and delete by index + fingerprint (unchanged), and never call `PUT …/lines`.
- **Migrations first:** 0032 (#484) and 0033 (#486) add columns the receipt reads select, so each must be on production **before** its PR deploys.
- **Forcing an update:** 3.0.7+ can be forced to update (Admin · App version). OTA needs EAS Enterprise (`Technical/Backend_Backward_Compatibility.md`, *Open gaps* 4).

## 5. How to verify after deploy

1. `/health` (admin): `ocrLlm.geminiFirst` and `ocrLlm.geminiReread` are `false` until switched on.
2. Re-send an existing receipt from a phone: there is no new ledger row, and the answer is `200 created:false`.
3. Turn on **Gemini re-reads** on dev only (web console → *Receipt reading*). Upload a fresh Costco scan from a 3.1.3 phone. The admin receipt shows *Read by: Gemini re-read*, `admin_reviewed_at` stays empty, and the phone shows the corrected lines after its next foreground.
4. After #486 ships in a build: edit a line, background the app and reopen it. The edit survives, and the admin desk shows the receipt as edited by the shopper.
