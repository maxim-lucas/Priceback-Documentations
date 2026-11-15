# Best Buy — the receipt parser

`src/services/bestBuyReceiptParser.js`, registered in
`src/services/receiptParsers/index.js`. Moved here on 2026-10-28 from
`Technical/Receipt_Parser_Registry_And_Store_Parsers.md` (its former §3 and §7),
per the rule *one store = one parser file and one documentation folder*. The
registry, the parser contract and the lab lane stay in that store-neutral doc.

> **2026-11-15: the in-store slip was rebuilt** on `Technical/Receipt_Parser_Specification.md`
> (`feat/bestbuy-instore-parser-rebuild`). §1 below describes the new shape. Why it was rebuilt, the six production
> captures and root causes BB-RC-1 … BB-RC-7: `Receipt_Parser_Rebuild_Plan_2026-11-14.md`. The online-order path is
> unchanged.

**Where it stands (2026-10-28):** `bestbuy` is in `STORE_PARSERS`, so every build
carries the parser, and in `ADMIN_PREVIEW_STORES` (`src/constants/stores.js`):
admins can scan Best Buy, shoppers see "Coming soon". `LAB_STORE_PARSERS` /
`LAB_ONLY_STORES` now hold Sport Chek only. The history below explains how it got
there: off the lane on 2026-09-02, back on it on 2026-09-28 when `development`
was merged toward `main`, finalized admin-only by Priceback #504. See `README.md`.

## 1. The parser

Two formats, one entry point. The format is decided first, by scored evidence, and `unknown` is a result:

```
parseBestBuyReceipt(rawText, annotation)
  ├─ detectBestBuyFormat()            bestBuyReceipt/format.js → in_store | online | unknown
  ├─ isRefundText()                  → parseRefundReceipt, through the detected format's parser, signs inverted
  ├─ online                          → parseBestBuyOnlineReceipt   (bestbuy.ca order; unchanged)
  ├─ in_store                        → parseBestBuyInStoreReceipt  (bestBuyReceipt/inStore.js)
  └─ unknown                         → the slip reading, kept only when the receipt proves it; else unreadable
```

Every result carries `receiptKind` (`in_store` | `online` | `refund` | `unreadable`), `trackable` and
`formatEvidence` (the markers found). The in-store slip also carries `readingState`, `unconfirmed` and
`readingChecks`.

### 1.1 The files

| File | Stage of the specification | What it holds |
|---|---|---|
| `src/services/storeReceiptKit/` | the pre-filter kit (§5) | Mechanisms only, shared by every store parser **except Costco**: rows (`rows.js`), glyph-tolerant labels (`glyphs.js`), amounts (`money.js`), placing printed figures (`figures.js`), the arithmetic checks and the reading state (`checks.js`), the one-digit landing repair (`balance.js`). It imports nothing frozen for Costco and Costco never imports it: `storeReceiptKitIsolation.test.js`. |
| `bestBuyReceipt/vocabulary.js`, `.en.js`, `.fr.js` | vocabulary | Every Best Buy label, EN + FR. A label written with a trailing `#` (`ORDER #`, `SEND #`) needs the sign: without it `Order Date` counted as the order number. |
| `bestBuyReceipt/format.js` | 4, format | In-store markers: register header (`S-627 R-48`, read through `8-627`, `5.627`), business-date label, transaction word, item-count line, register transaction. Online markers: item-table header, order number, web id. A marker only one document prints decides alone when nothing contradicts it; else the larger count wins; a tie is `unknown`. `Delivery Date` is a marker of neither. |
| `bestBuyReceipt/sections.inStore.js` | 2 and 6, sections and denoise | Header · Body · Totals · Payment · Footer, two anchors per boundary. The header's end is looked for above the first priced row after the register row, so a header banner with an amount, or a `SALE` row under an item, does not move it. Replaces `bestBuyReceiptSections.js` (deleted). |
| `bestBuyReceipt/identity.js` | 5, identity | Store, register, transaction, the labelled **business** date (`BUS DATE`, `BUS.DATE`), never the delivery date. |
| `bestBuyReceipt/grammar.inStore.js` | 7, extraction | Name row + price column, SKU row beneath (`[1-9]\d{6,7}`, not a date), sub-rows, the register's counter beneath a service line. Flat OCR that streams names then prices is zipped back only when both runs have the same length; otherwise the amounts are reported as unexplained, never dealt to the last name. Every priced row is accounted for. |
| `bestBuyReceipt/balance.js` | 10, balance | The tax read against the slip's own `rate % of base`: a misread amount (`$461.00` for `$481.00`) is corrected only when rate × base lands on the printed TOTAL. A printed subtotal or total is never re-derived. |
| `bestBuyReceipt/inStore.js` | the pipeline | rows → sections → identity → denoise → extract → verify → balance → state. |

### 1.2 The reading state

| State | Meaning | What the scan screen shows |
|---|---|---|
| `proven` | `lines_close`, `total_closes`, `identifiers` and `names_legible` all pass against figures the slip printed | The review step, as before |
| `unproven` | Lines were read, something is not confirmed. `unconfirmed` names it: `amounts`, `lines`, `item_numbers`, `names`; a line whose print was hard to read carries `uncertain` | The review card lists what to check (`scan.unproven.*`, EN + FR); a hard-to-read line is marked until the shopper edits it. The marks are never saved. |
| `unreadable` | Nothing to show; `unreadableReason` says why (`photo_quality`, `format_unknown`) | The unreadable alert; a photo-quality reason gets the advice that fixes it (`scan.unreadablePhotoBody`) |

Codes are mapped to labels in `src/utils/readingReview.js`; a code a build does not know reads as a general label.
A parser that stamps no state (Costco, the generic engine) gets nothing from it.

Three more checks feed the `unconfirmed` list: `tax_rate` (tax = printed rate × base), `item_count`
(`n Sale item(s)` against the products, or against every kept line) and `no_unexplained_rows`.

### 1.3 In-store specifics

- **SKU width 7–8 digits**, not zero-padded, not a date. A product without one fails `identifiers`.
- **A zero-priced row** (`TV Delivery $0.00`) is a free fulfilment line: accounted for, not a line of the receipt.
- **Service lines** (`GEEK SQUAD`, `GSP`, `PRP`, protection/replacement plans, installation, delivery, EN + FR, and
  the row with the register's zero-padded counter beneath it) stay **visible** but `ignored: true`.
- **Fee lines** (eco fee, deposit, recycling fee) are flagged `ignored` by **the pipeline's own fee rule**
  (`isIgnoredItemName`), handed to the slip reader as `deps.isFeeLine`. The reader stamps `ignored` on every line
  it returns, and the pipeline's later stamp keeps an explicit flag, so a reader with its own (or no) fee rule
  hides fees from the pipeline: the hardening pass of 2026-11-15 caught exactly that. One rule, one function.
- **Discount sub-rows.** `Regular Price` / `Instant Savings` print *under* the item and **the item row already
  shows the price paid**; only `originalPrice` is recorded.
- **Amount repairs that cannot invent data**: a thousands separator read as a period (`$3.699.99`), and a price
  whose glyphs faded into letters (`S49.99`), through `faintPrintRepair`.

### 1.4 The corpus and its scorecard (measured 2026-11-15)

`__tests__/fixtures/receipts-bestbuy/`: receipts × captures. `bestBuyCaptureVariance.test.js` scores every field of
every capture as right, honest (unread, or shown and marked) or wrong. The bar is **zero wrong**, and every capture
of a sharp photo fully right. `RECEIPT_REPORT=1 npx jest __tests__/bestBuyCaptureVariance.test.js` prints the card.

Best Buy Orleans S-627, 2025-11-28, one Samsung television (SKU 19204882, $3,699.99, tax $481.00, total $4,180.99):

| Capture | Photo | Before (`main` `c40b06ed`) | Now | Right / honest / wrong |
|---|---|---|---|---|
| `c678`, `c679` | sharp (app 3.5.0) | see the rebuild plan §3 | `proven`, every field | 10 / 0 / 0 |
| `c773`, `c774` | scanner filter (app 3.6.1) | see the rebuild plan §3 | `unreadable` (`photo_quality`); store and date still read | 0 / 2 / 0 |
| `c775` | scanner filter | see the rebuild plan §3 | `unproven` (`amounts`, `names`): totals right, name and SKU shown as hard to read | 8 / 3 / 0 |
| `c776` | scanner filter | see the rebuild plan §3 | `unproven` (`amounts`, `names`): totals and SKU right, name marked | 9 / 2 / 0 |

The earlier in-store capture (`PXL_20260415…`) and the eight online PDFs still pass their pinned expectations
(`bestBuyReceiptParser.realocr.test.js`).

**Still one receipt with one product.** Nothing here proves a multi-item basket, a discounted line, a Geek Squad
plan, a Quebec slip or a return on real paper; those are covered by written cases only. The specification's bar is
three real receipts per format for admin preview and ten for shoppers. Best Buy stays admin-only.


### 1.5 Online specifics

- `Web ID: NNNNNNNN` on its own line, attached to the preceding item. Without
  this the order logs fine and can **never** be price-watched — invisible until
  a drop happens and no alert fires.
- An in-store register header (`S-### R-##`) **beats** a delivery mention: a TV
  bought in store and delivered later is still an in-store purchase, and
  misclassifying it sends the user to the wrong price-adjustment process.


## 2. Promoting Best Buy off the lane (2026-09-02)

> Historical. The 2026-09-02 promotion happened on `development`. The five
> declarations listed below moved back on 2026-09-28 and forward again in #504,
> into the admin-preview posture above, not the shopper-enabled one.
> `bestBuyStorePromotion.test.js` still pins that the declarations agree.

The lane existed because the parser had no real fixtures. It ended when it had
nine captures (one in-store photo, eight order PDFs) plus the hardening pass
that found four defects the corpus itself never hit. **That is the bar for a
promotion: not "the tests are green" but "the ways this could be wrong have been
looked for on purpose."**

#### The five declarations that had to move together

| Where | Change |
| --- | --- |
| `receiptParsers/index.js` | `bestbuy` **moved** (not copied) from `LAB_STORE_PARSERS` into `STORE_PARSERS` |
| `constants/stores.js` | `LAB_ONLY_STORES` emptied; `bestbuy.enabled` → `true`; `BUNDLED_UPDATED_AT` bumped |
| `backend/data/policies.json` | regenerated from `stores.js` |
| `backend/config/defaults.js` | `BESTBUY_SCAN_ENABLED` default → `true` |

Five declarations of one fact is exactly the shape that gets three of five
right, so `__tests__/bestBuyStorePromotion.test.js` now pins it mechanically:
every id in `STORE_PARSERS` must be an enabled store on a store build, and
`LAB_ONLY_STORES` and `LAB_STORE_PARSERS` must name the same ids. Both files
carried a comment saying they had to agree; the comment was the entire
enforcement.

#### Costco is unaffected by construction

`resolveStoreParser` reads `STORE_PARSERS` **before** it consults the lane, so
Costco's lookup does not change shape. The parity block in
`receiptParserRegistry.test.js` replays the whole Costco corpus through the
dispatcher as evidence rather than as a claim.

#### 🔴 The go-live switch is still a database UPDATE

`applyRemoteStores` gates on the payload's `rev`, which is present and strictly
greater than the runtime's initial `""` — so **the DB payload replaces the
bundled array on every launch**. A promoted binary therefore still shows Best
Buy disabled until the `stores` row is updated. Bumping the bundle changes the
offline fallback only.

That sequencing is a feature, not an oversight: the binary can ship and be
device-tested before a single user sees the store. It also means the code change
is inert for live users, which is what let this land on `development` safely.

> 🔴 **What this section did not say, and it cost eight days (audit 2026-09-10).**
> "The `stores` row is updated" is not a manual step someone performs on a
> database by hand — it is `backend/db/deploy/store-content-sync.sql`, which was
> **hand-maintained, generated by nothing and tested by nothing**, and which still
> said `enabled = false` for `bestbuy` long after this section was written. So the
> switch named here as the go-live act had already been *silently* left in the off
> position by the same PR that flipped everything else.
>
> It is now generated (`npm run db:sync-store-content`) and pinned
> (`backend/tests/storeContentSync.test.js`). Regenerating it also restored two
> French claim steps that had lost the word "canadien" — the very drift this section's
> promotion test was written about, which had reached `stores.js` and
> `policies.json` and never reached the SQL.
>
> Full detail: `Technical/BestBuy/Integration_Audit_2026-09-10.md`.

#### The defect the promotion created

Promoting a store turns every `"costco"` literal elsewhere in the app into a
potential bug at once. One had teeth — `fetchMyPriceHistory` hardcoded
`store=costco`, and `ScanScreen` calls it for any `receiptKind: "online"`, which
is what the Best Buy parser stamps on order PDFs. Full write-up: **Bugs #236**.

#### One expectation moved because a parse got BETTER

`ocrService.test.js`'s "Best Buy Orleans" receipt has printed arithmetic that
does not add up: item `$3,699.99` + printed tax `$461.00` = `$4,160.99`, against
a printed TOTAL of `$4,180.99`. 13% of $3,699.99 is **$481.00**, and
`3699.99 + 481.00` lands on the printed total exactly — the printed tax is an 8
read as a 6.

The generic engine read the tax line verbatim and shipped the misprint. The Best
Buy parser repairs it, and adopts the repair only because it LANDS. The test now
asserts `481` *and* that the repaired value reconciles, so the number cannot
drift back without the reason failing too.
