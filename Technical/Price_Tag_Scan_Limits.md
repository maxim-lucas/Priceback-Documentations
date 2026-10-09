# Price-tag scan limits (5/day, 15/week) and the Price translator mode

_Added 2026-10-09 · app repo `maxim-lucas/Priceback`, branch `claude/compassionate-newton-bayz77`_

## Why

Every price-tag photo is one Google Vision read through `POST /api/ocr`, which is the
**same monthly Vision budget the receipt scanner uses** (`OCR_MONTHLY_LIMIT`). A few
heavy tag scanners could use it up, and then every receipt scan would get a 503 until the month ends.

## The rule

| Cap | Default | Window | Config key |
|---|---|---|---|
| Daily | 5 scans | Eastern calendar day | `PRICE_TAG_SCAN_DAILY_LIMIT` |
| Weekly | 15 scans | Mon–Sun, Eastern | `PRICE_TAG_SCAN_WEEKLY_LIMIT` |

- One **scan** = one photo that Vision **successfully** read. A failed read costs nothing.
- **Admins** (`ADMIN_USER_SUBS`, or a device paired to an admin account) are exempt.
- When both caps are used up, the **weekly** message wins, so we never say "come back tomorrow" when tomorrow is still blocked.
- Both keys can be changed in `app_config` (no redeploy needed). Setting a key to `0` turns that cap off.
- Receipt OCR is never counted toward these caps.

## How it works

**Backend**
- `backend/lib/priceTagScanQuota.js` (pure): `evaluate(used, limits)` and `scannerKeyFor({sub, deviceId})`.
  The scanner key is a one-way SHA-256 hash of the account (or, when signed out, the device), so no identifier is stored.
- `backend/repos/priceTagScansRepo.js`: `usage()` counts scans today and this week. `record()` writes one row and deletes rows older than 14 days.
  Both are best-effort. On any error, `usage()` returns null and the cap **fails open**.
- `POST /api/ocr`: when `scanContext.flow === "price_tag"`, the cap is checked **before** any budget is spent or Vision is called.
  A refusal returns `429 { error: "tag_scan_limit", period: "daily"|"weekly", dailyLimit, weeklyLimit }`.
  A successful read is recorded.
- `GET /api/price-tag/scan-quota?deviceId=…` (optional auth) returns `{ unlimited, allowed, blocked, daily:{used,limit,remaining}, weekly:{…} }`.
- Migration **`0023_price_tag_ocr_scans`**. **Apply it by hand in production before the code merges**, then add the drizzle ledger row.
  Until it is applied, the cap fails open. The per-device OCR rate limit and the monthly budget still apply.

**App**
- `src/services/tagScanQuota.js`: fetches the quota and holds the pure helpers (`scansRemaining`, `consumeScans`, `limitAlertCopy`).
- `PriceTagScanScreen`: the cap is checked **before** the camera or gallery opens and before any OCR call. So the 6th scan of the day (or the 16th of the week) shows the popup and never reaches Vision.
  A library batch reads only as many photos as the cap allows, then explains why the rest were skipped.
  If the server refuses a read (for example, the account was used on another device), the app shows the same popup. It never shows the throttle message and never sends the photo to the offline queue.
- The intro page shows "Up to 5 price-tag scans per day and 15 per week…", plus the remaining counts, **directly under the savings-only notice**. Admins don't see it.
- Offline queue (`tagScanQueue`): a cap refusal leaves the photo pending without using up a retry attempt, and the worker stops for that run.

## Price translator: its own scan mode

The offline translator (`QuickPriceCheck`) moved off the price-tag page into a new
`PriceTranslator` screen. The scan-mode toggle now reads, in this order:
**Receipt · Price tag · Price translator · Price Checker**. It needs no camera, OCR or network, and it never uses up a scan.

## Credits are unchanged

Tag credits still pay only on **real savings inside the validity window**:
`regular > sale`, a printed validity date, and `valid_until >= today` (on the shopper's provincial calendar), verified by the crowd or an admin.
Admin **Verify** runs the same `settleVerifiedTagCredits` gate, so approving an expired or no-savings tag pays nothing.
