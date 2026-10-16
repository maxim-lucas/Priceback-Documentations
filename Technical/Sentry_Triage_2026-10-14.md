# Sentry triage — 2026-10-14

**Ask (Maxim):** "there is some errors in sentry, connect to sentry using the token, analyze the problems and fix them
all if possible" + "i dont want to see the same errors in the futur again".
**Project:** `prosoft-inc/priceback-canada`, read with the user token `SENTRY_API_TOKEN`.
**Code:** app PR #433 (`fix/sentry-errors-2026-10-14`). **Bugs:** #320.

Before: 11 unresolved. After: **0 unresolved**: 3 fixed in code, 6 archived until escalating, 2 resolved.

## Per issue

| Issue | Builds | Evidence | Verdict | Sentry status |
|---|---|---|---|---|
| **Q** `toFixed of null`, `AdminReceiptDetailScreen` (Android) | 3.0.6 | admin opened `r_1791776785814_3mq8x` (RC-4 refund: 27 negated lines, 6 originals) | **Bug, fixed (#433)**: `Number(null) === 0` in `isInstantDiscountLine` | resolved after 3.0.6 |
| **R** `toFixed of null`, `DetailScreen` (iOS) | 3.0.6 | the same shopper's re-scan; any refund receipt has this shape | **Bug, fixed (#433)** | resolved after 3.0.6 |
| **N** fatal `Cannot read file at …/receipts_pending/…jpg` | 3.0.3 | `POST /api/receipts` 200, then the crash; frame `FileSystemLegacyModule` | **Bug, fixed (#433)**: queued photo deleted under its own upload | resolved after 3.0.6 |
| **5** `Invalid access code` | 3.0.3–3.0.6 Android | `/health` `reviewerAccess: available`; `category: reviewer_code_rejected` on every event | user typo; **no longer sent to Sentry (#433)** | archived until escalating (old builds still send it) |
| **M / K** Apple `ERR_REQUEST_UNKNOWN` / Google "Unable to open Safari" (info) | 2.9.1–3.0.6 | `attemptMs` 2–91 ms on every event: no sheet was ever shown; one burst per device | restricted device (see `Sentry_Triage_2026-09-11_iOS_SignIn.md`); handled by #333/#352 | archived until escalating |
| **B / C** same pair, filed as `error` | 2.8.5–2.9.0 | builds from before #352's info level | same | archived until escalating |
| **P** App hang 2 s | 3.0.3 | main thread inside Apple's `VNDocumentCameraViewController`, "Low memory" breadcrumb, no app frame | OS document camera, not actionable | archived until escalating |
| **H** `Google Sign-In returned no ID token` | 2.9.0 only | nothing since 09-24 across six later builds (#349/#352 changed the path) | fixed earlier | resolved (a recurrence reopens) |
| **J** WatchdogTermination | 2.8.5 / 2.8.20 | no breadcrumbs; old builds | nothing to act on | resolved |

**Why "archived until escalating" and not "ignored forever":** those events keep arriving from builds already in
shoppers' hands, which no code change can reach. Archiving keeps them out of the unresolved list, and a spike (say a
server misconfiguration that makes *every* reviewer code fail) brings the issue back by itself.

**The regression alarm:** Sentry pinned Q, R and N as resolved *after PriceBack@3.0.6*, so any event from 3.0.7 or later
reopens them. **#433 must be merged before 3.0.7 is built**; otherwise the reopen is real.

## Root causes, briefly

- **Q/R:** `isInstantDiscountLine` did `Number(item.originalPrice)`. `Number(null)` is `0`, so a refund line (negative
  paid, no original) read as discounted, and the TPD box printed `null.toFixed`. Reproduced exactly in Jest against the
  unfixed source (`AdminReceiptDetailScreen.js:312`, `DetailScreen.js:1059`).
- **N:** `persistReceiptImage` returned any `documentDirectory` path unchanged. A queued scan's photo lives in
  `receipts_pending/` and is deleted by the queue on save. `createUploadTask` → native `uploadTaskStartAsync` has no
  exists check (`expo-file-system` 55.0.19, `ios/Legacy/FileSystemLegacyModule.swift`, unlike `uploadAsync`), and
  `URLSession.uploadTask(fromFile:)` raises an uncatchable ObjC exception.

## Follow-ups (noted, not changed)
1. Backend `receiptsRepo.lineToUnitPrices` has the same `Number(null) → 0` trap (`regularPrice 0` for a negative line
   without an original). It's a backend change under the compatibility rule, and no Sentry error comes from it.
2. `shared/receiptWireContract.serverWatchEnabled` coerces with `Number()` where the server uses a strict
   `Number.isFinite`. The two differ only for negative lines in a non-refund receipt (0 in prod today).
3. Android events and breadcrumbs arrive **doubled** (each xhr breadcrumb twice; every reviewer-code event as a pair).
   One capture per tap was verified (`OnboardingScreen.handleReviewerCode`), so this is SDK-side, not ours. Worth a look
   when the Sentry SDK is next upgraded.
4. Bugs #319 (presigned, never stored) has a concrete candidate mechanism in N's race. Confirm with the analytics log's
   `receipt_document_upload_failed` `stage: file_missing`.
