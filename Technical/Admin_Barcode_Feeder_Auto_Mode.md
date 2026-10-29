# Admin · Barcode feeder: Auto mode + Undo

*2026-10-27. Screen: `src/screens/AdminBarcodeFeederScreen.js`. Rules: `src/services/barcodeFeeder.js`.*

The barcode feeder links a Costco item number (SKU, from the shelf tag) to the
manufacturer UPC/EAN on the package, so a shopper's barcode scan resolves to a
Costco price (`products.barcode`). It now has two modes, chosen by a toggle at the top.

## Auto mode (default): one camera feed, no taps per pair

1. **Tag step.** Aim the feed at the price tag. The tag's item number is printed
   as a barcode (Code 128 / Code 39), so the SKU is read by the **live barcode
   decoder**: no photo, no OCR and no server call. Only the digits are kept
   (letters, spaces and separators are dropped) and leading zero padding is
   stripped. The result must be 3–12 digits, the server's rule.
   - A checksum-valid UPC-A/EAN-13 from a non-tag symbology is refused here with
     a hint ("that's a package barcode — aim at the price tag first").
2. **Package step.** The feed's hint switches to the package. The first
   checksum-valid UPC-A / EAN-13 (the only shapes `POST /api/admin/barcode-link`
   accepts) that is **not the tag just read** is linked automatically. A haptic
   pulse confirms it, and the feed goes back to the tag step for the next pair.
3. **Photo fallback.** If the tag's barcode won't decode, the feed has a
   shutter during the tag step. The still goes through the existing price-tag
   reader (`scanCostcoTags`, one `/api/ocr` call; admins are not capped), and
   only the SKU digits are kept (`skuFromTagScan`). A receipt photo or a photo
   with no SKU is refused with a hint. This is the only path that uses OCR, and
   it runs only when you tap the shutter.
4. **Typed fallback.** Type the SKU under the feed and press **Use**. The
   package step then continues as usual. **Wrong SKU — read the tag again**
   returns to step 1.

**Repeat guard.** The live decoder fires many times a second. A value that was
*used* (a tag read, a package linked) is ignored while it stays in frame and
becomes usable again after 2.5 s out of view. Values that were never used are
never suppressed, so a package already in frame during the tag step links as
soon as the tag is read.

## Manual mode: unchanged

Pick an unlinked product by name, or type the SKU. Tap **Scan package
barcode**, and the pair is submitted on decode.

## Undo last link (both modes)

`POST /api/admin/barcode-link` now also returns `previousBarcode`, the value it
overwrote (`null` if the product had none). It is read under a row lock in the
same transaction as the write. **Undo** calls the new
`POST /api/admin/barcode-link/undo { sku, barcode, previousBarcode }`
(`pricesRepo.restoreBarcodeForSku`). This is a **compare-and-swap**: the old
value is restored only while the product still carries the barcode that link
wrote. If the harvester or another link has changed it since, the route answers
`409 CONFLICT` and leaves the row alone. The route uses the same admin gate
(`ADMIN_USER_SUBS`) and the same `admin-catalog` rate-limit bucket as the link
route.

## Old app builds

Additive only. The new route is new, and `previousBarcode` is an extra response
field. Older builds read only `ok` from the link response. Nothing changed for
the bulk token-gated `/api/admin/barcode-links`.

## To verify on device

The tag step assumes that the Canadian shelf tag's barcode encodes the item
number (as `ScanCameraViewfinder`'s tag auto-capture already assumes). If a tag
design carries a different payload or no barcode at all, the photo fallback and
the typed SKU still work. Adjust `skuFromTagBarcode` (the tag symbologies and the
padding rule) rather than the screen.
