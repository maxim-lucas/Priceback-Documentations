# Receipt photo quality gate — refuse a hopeless photo before it costs anything

> **Status: design only — not implemented (Maxim, 2026-10-12: "leave it till the end, just document it and we will
> try to have a solution later").** This page records what a bad photo costs today, what the production corpus says
> bad photos look like, the options, and the order to build them in.
>
> Related: `Technical/Receipt_Parser_Root_Causes.md` (what bad photos do to the parse),
> `Operations/Bad_Scan_Receipt_Repair_Runbook.md` (what they cost us afterwards).

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
| **Tilt** | p2s1a ≈ 8°, ec7p8 ≈ 12° + curl | every price a row off its item (RC-12) |
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
