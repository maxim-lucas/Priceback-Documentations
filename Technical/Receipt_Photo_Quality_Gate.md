# Receipt photo quality gate — refuse a hopeless photo before it costs anything

> **Status: built as the *receipt quality check* (2026-10-28) — shadow on every installed build, refusal on demand
> per family.** Maxim, 2026-10-27: *"auto reject receipt with poor quality but i dont want to use it without testing
> it with live and real users receipts … only a flag to appear in the admin console so i can check if the feature is
> refusing only the bad receipts that the app never would have treat it and i want to have a setting in the admin
> console to enable the feature user side when i need (on demand)"*. §0 is what was built; §1–§6 are the 2026-10-12
> design it grew from (Layer 2 + Layer 3, with the arithmetic checks Maxim listed).
>
> Related: `Technical/Receipt_Parser_Root_Causes.md` (what bad photos do to the parse),
> `Operations/Bad_Scan_Receipt_Repair_Runbook.md` (what they cost us afterwards),
> `Technical/Receipt_Parser_Design_Rules.md` §5 (what the shopper is told).

## 0. The receipt quality check (built 2026-10-28)

**One set of rules, two places.** `shared/receiptQualityGate.js` (rules v1) judges a receipt as its upload
(`qualityInputFromApiBody`): the lines, the total and tax the phone read, the cleaned OCR and the footer, and the
photo's measures. The **server** runs it in the shadow on every upload from every installed build (the photo measured
on the receipt's linked OCR capture); the **phone** (builds after 3.2.0) runs it before the review step, sends its
verdict with the upload, and refuses the scan when the admin has switched one of its reasons' families on — free,
retake only (Maxim's decision, 2026-10-27).

| Family (admin switch) | Reason | Fires when |
|---|---|---|
| Photo (`RECEIPT_QUALITY_REFUSE_PHOTO`) | `photo_rotated` | more than 50 % of the words carry no upright baseline: upside down or sideways |
| | `photo_tilted` | the median baseline angle is above 8° |
| | `photo_faint` | more than 15 % of the words read with confidence < 0.72 (fading, glare, blur) |
| | `photo_too_far` | the median word height is below 10 px of a 1200-px-wide frame |
| | `photo_low_angle` | the top third's words are below 0.5× (or above 2×) the bottom third's |
| Items count (`…_COUNT`) | `items_sold_unread` | no printed items-sold count (the photo stops above it) |
| | `items_sold_mismatch` | the printed count differs from the units read (fees excluded) |
| Totals & tax (`…_TOTALS`) | `totals_unread` | no printed total or tax established |
| | `tax_missing` | a line carries a tax code (`FP`/`F`/`P`/`H`/`G`/`Y`/`B`) but the tax is 0 |
| Adds up (`…_BALANCE`) | `lines_off_total` | Σ lines + tax is more than **10 %** off the printed total |
| Read as an item (`…_ITEM`) | `total_read_as_item` | a line with no item number equals the lines above it (2+) or the printed subtotal/total |
| | `payment_read_as_item` | a line is named like a tender, a balance or an approval |

**Established figures.** The printed total is the one the phone read when the paper prints that amount (the app
locks it to the printed one), else the flat text's reading when its block closes; the tax likewise; the subtotal is
total − tax. The flat text alone pairs a column-split TOTAL with an item's price (3hhhj "TOTAL 5"), and the uploaded
total alone can be the doubled one (3eips, 1,584.88 for 243.73). The items-sold count is read from the footer first
(`receipts.footer_ocr`, label and count together), then the raw text.

**Limits** are admin settings (`RECEIPT_QUALITY_*`), served to the app on `GET /api/v1/app-status`, so the trial
tunes them without an app build. Starting values from the committed corpus (`receiptProdCaptures.test.js` › *the
receipt quality check on the corpus*, every verdict pinned):

- **No right parse is refused for a photo, totals, adds-up or read-as-an-item reason.** The right parses reach 7.2°
  of tilt (4qp2s), 6.6 % faint words, 11.4-px glyphs (mebfs) and a 0.72–1.67 height ratio.
- **The count family flags 12 right parses**, each explained by the paper: 11 photos that stop above the items-sold
  line (complete under the old "down to the TOTAL" guidance, incomplete under the new one) and Lévis i7aiw's
  documented unit gap (a weighed pack counted once: 69 for 70). Keep the count family off until the trial clears it.
- **Every known-bad capture is refused but one**: t7iig c259 lost a $4.00 coupon, 8.92 % off — inside the 10 %
  tolerance Maxim set "for now". The photo measures do not separate the curled parser gaps from the right parses;
  their missed lines are caught by the count and adds-up checks, as §4 expected.

**Production backtest (2026-10-28, read-only, last 30 days, `backend/scripts/receipt-quality-backtest.js
--photos`).** 187 receipts, 152 judged (35 out of scope: online, other stores, refunds, rejected): 91 pass, 61 would
refuse. The stored lines are the ones after the shopper's review and any admin repair, so this is the shadow check's
view of an old build.

| Reason | Receipts | What it says |
|---|---|---|
| `items_sold_unread` | 53 | The photos stop above the items-sold line — the guidance was "down to the TOTAL" until now. The count family stays off until the new guide (the app's "How to scan a receipt") has shipped and the trial clears it. |
| `items_sold_mismatch` | 6 | 3 with a 17–40 % gap (lines missing: right refusals); 3 whose lines add up but are 1–2 units off (19 printed, 21 read): to label. |
| `lines_off_total` | 4 | 17–45 % off (igi2v, 34jc2, 6wd4e, tl5wo): lines missing. |
| `totals_unread` | 3 | No total or tax established from the stored text (4i228, f1zo2, i7aiw). |
| `photo_tilted` / `photo_low_angle` | 2 / 1 | **Readings that add up** (u8xbn 8.3° for an 8° limit; 5bvzh a 2.43 ratio, the bottom smaller; xwkjk 12.3°): the photo limits are stricter than these photos needed. Label them, and let the suggestions move the limits. |

No receipt the admin rejected would have passed. Nothing is switched on in the app until a family's line shows no
wrong refusal.

**On the phone (builds after 3.2.0).** `GET /api/v1/app-status` carries `receiptQuality` (the families that refuse,
the limits in the gate's units); the app keeps the last word on the device (`src/services/receiptQualityConfig`) and,
never told, refuses nothing. `scanReceipt`'s last step (`applyQualityCheck`) judges the reading the shopper is about
to review, with the photo measured on the adopted OCR pass (`photoQuality`). The verdict rides with the upload
(`qualityCheck`). A refusing reason in a switched-on family turns the scan into `receiptKind: "poor_quality"`: free
(`rejectionSpendsCredit`), nothing saved, the **"Let's retake this photo"** card naming what went wrong (Retake photo /
How to scan), the guide unfolded, and a best-effort report to Admin · Receipt reading › *Refused in the app*
(`POST /api/receipts/quality-refusals`). The offline receipt queue keeps such a scan as *rejected*, with its reasons
and a Retake button. **"How to scan a receipt"** (`src/components/ReceiptScanGuide`) sits under Photo library / Upload
file, unfolded until the first saved receipt; the old one-line how-to is gone.

**The trial is a training set** (Maxim: *"these data can be a training so when we enable the feature the app have
data as reference"*). Every checked receipt stores every raw measure (`receipt_quality_checks.metrics`, migration
0040) and takes the admin's **Good / Bad** label on the receipt itself (not on the verdict, so a label stays right
when the rules change). Admin · Receipt reading shows a per-reason scoreboard over the labelled receipts (right
refusals, wrong refusals, missed, right passes) and **suggested limits**: the strictest value that refuses no receipt
labelled good. A family's switch should go on only once its line shows no wrong refusal.

---

## 1. What a hopeless photo costs today

Nothing refuses a photo before OCR. The path a photo takes, and what each step spends:

| Step | Where | Cost of a hopeless photo |
|---|---|---|
| Capture | `ScanScreen` → native document scanner (VisionKit / MLKit, auto-crop + perspective), else plain camera, else gallery (no crop) | shopper time |
| Resize to 1200 px wide, JPEG 0.80 | `ocrService.js` | — |
| Vision OCR | `POST /api/ocr` → Google Vision | **1 Vision unit** (free tier 1000/month, `OCR_MONTHLY_LIMIT`) |
| Parse | on the phone | CPU |
| Second pass at 2000 px when confidence < 1 | `receiptParser.js` | **1 more Vision unit** |
| LLM reconcile (opted-in users) | `/api/ocr-llm` → Gemini | 1 Gemini call (1400/day free) |
| Save | `POST /api/receipts` | **1 scan credit**; wrong lines become price points and watches |
| Repair | runbook / admin desk | an admin session, a datafix, a root-cause entry |

An **unreadable** result (no items, no total) is already refused and free (`receiptRejection.js`). But a photo that is
readable *enough* to produce a wrong receipt passes every gate, which is the expensive case.

## 2. What bad photos look like in production (the corpus, 2026-10-12)

From `__tests__/fixtures/receipts/prod-captures/` (53 captures + the 43 unlinked, abandoned ones) and the repaired
receipts:

| Defect | Example | What it did |
|---|---|---|
| **Zoomed out**: the receipt fills a small part of the frame | mebfs (Brossard #521) ≈ 20% of the frame width; 3mq8x ≈ 28% | 1200 px leaves the glyphs ~12 px tall; digits drop (`991230` for `9911230`), slashes vanish |
| **Tilt** | p2s1a ≈ 8°, ec7p8 ≈ 12° + curl | every price a row off its item (ec7p8, Bugs #314). For p2s1a the remaining mispairing is in the flat-text candidate on every build, not the tilt gate: see RC-12 in `Receipt_Parser_Root_Causes.md` (proof owed) |
| **Fold / crease** | p2s1a, middle rows | faint rows, Vision reads no amount for 4 rows |
| **Sideways / cut off** | 8y5tt c44/c45 (sideways), c42/c43 (cropped above the totals) | no totals to check against |
| **Faded thermal paper** | 6wd4e (top half printed white) | lines missing, the subtotal can't close |
| **Pen marks** | zm6h2 (`#542` crossed), p6cxu | a digit misread |

The readable-but-wrong photos (the expensive ones) were mostly **zoomed out or tilted**. Both can be measured before
parsing, without a model.

## 3. Options, in layers

### Layer 0: capture guidance (free, no rejection)
- Keep the document scanner the default. Today the camera fallback and the gallery path skip auto-crop, and
  those uncropped frames are the zoomed-out ones.
- Show a "fill the frame / hold flat" hint. For a long receipt, offer a second shot of the bottom half instead of
  one far-away shot (that needs stitching or a two-part parse, so it is a separate project).

### Layer 1: before OCR, on the phone (saves a Vision unit)
- **Crop coverage:** the scanner's crop rectangle against the frame. Today only `MIN_SIDE_FRAC 0.05` is checked
  (`autoCrop.js`).
- **Resolution after crop:** too few pixels across the receipt's width means the text will be too small, so ask
  for a closer shot.
- **Blur / exposure:** Laplacian variance and mean luminance. This needs pixel access, which
  `expo-image-manipulator` doesn't give: either a native module, or decoding a small downscaled copy in JS. The
  CPU cost has to be measured on a low-end Android.

### Layer 2: after OCR, before parsing (one Vision unit already spent; saves the retry, the LLM, the credit and the data)
All of these are computed from the Vision answer the app already holds:
- **Glyph height:** median word height in px; below ~14 px the misreads start.
- **Tilt:** the median word baseline angle from Vision's word polygons. The word model currently keeps only
  axis-aligned boxes (`ocrService.js` `_collectWords`), so this needs the polygon kept.
- **Text coverage:** the text bounding box against the image. A small box means zoomed out, so the second read
  should be a **crop to the text** at full resolution, not the whole frame at 2000 px. That swap alone makes the
  existing retry useful on far-away photos at no extra cost.
- **Print quality:** `assessPrintQuality` already measures the share of low-confidence words (`faintPrintRepair.js`),
  but only reports it.
- **Anchors:** COSTCO header, a TOTAL label, SKU-shaped rows. A frame missing the totals is a partial photo.

### Layer 3: after parsing (exists in part)
- Confidence below 0.8 is already "flagged". The review screen's warning should use the same signals, so that "this
  doesn't match your receipt, please check" appears whenever the paper's own arithmetic doesn't close.

## 4. Recommended order (when this is picked up)

1. **Layer 2 first.** It costs nothing new, uses data we already have, and every threshold can be set on the
   committed corpus before anyone sees it. Begin with glyph height and text coverage, the two that explain the
   readable-but-wrong cases above.
2. Pick thresholds with **zero false refusals** on every `ok` capture in `receiptProdCaptures.test.js` (a refusal of
   a good photo costs the shopper more than a flag). Pin the thresholds with a corpus test, the same way the parser
   is pinned.
3. **UX:** a friendly "Retake: hold the phone closer / flatter" card, translated, that names the reason. Always
   offer "Use this photo anyway", and spend no credit on a retake.
4. Layer 1 only after Layer 2's numbers show which pre-OCR check would have caught the same photos.

## 5. How to measure before building

- Compute the Layer-2 metrics for every committed capture (good, `parser_gap`, `partial`, `unreadable`, and the
  unlinked abandoned scans) and put them in one table. The thresholds come from that table, not from guesses.
- The **43 unlinked captures** are scans shoppers abandoned. They are the best evidence of what a "hopeless photo"
  looks like to the people taking them.

## 6. Not decided

- Whether a refused photo spends a scan credit: today an unreadable refusal is free; keep it free.
- Whether to block, or only warn, below the thresholds. This page recommends warning, plus "use anyway".
