# Sport Chek — the receipt parser

`src/services/sportChekReceiptParser.js`, registered in `LAB_STORE_PARSERS`.

Store-neutral material — the parser contract, the hooks, the lane, the full
procedure — lives in `Technical/Adding_A_New_Store.md` and
`Technical/Receipt_Parser_Registry_And_Store_Parsers.md`. This file is Sport
Chek's half only.

---

## The corpus

Two real eReceipt PDFs: a **purchase** (2026/03/17, ST LAURENT Ottawa, store
330, register 106) and the **return of the same product** 72 days later
(2026/05/28). One product, one store, one layout.

That pair is more useful than two unrelated receipts — every sign in the second
is the mirror of the first, and the return reprints the original transaction's
date and store, both of which are traps. It is still nowhere near enough to
promote on: see "What is owed" below.

> 🔴 **The corpus has ZERO OCR captures.** `npm run capture:receipts` needs
> `GOOGLE_VISION_API_KEY`, and there is none on the development machine (it lives
> in EAS Secrets and on Railway). Ground truth for both receipts is already
> written into `__tests__/sportChekReceiptParser.realocr.test.js`; that suite
> logs the count on every run and is green at zero **without claiming to be
> evidence**. Until the captures land, the parser is pinned only against the
> PDFs' text layer — and the text layer is not what the app receives.

---

## 1. 🔴 Detection: the receipt was attributed to NO STORE

Not "the wrong store". `detectStore` returned `null`, so the receipt reached no
parser and had nothing to attribute itself to.

Sport Chek is a **Canadian Tire Corporation** banner, so every receipt prints the
Triangle Rewards footer:

```
Triangle Rewards Account #:
CT Money Collected Today          $2.10
Collect 10X, that's 4% CT Money* when you
pay for your purchase with a Canadian Tire
Triangle Mastercard.
```

`STORE_DETECTION_PATTERNS` is first-match-wins over an ordered array and
**returns** on the first match. `canadiantire` sits at index 5 with
`/canadian\s*tire/i`; `sportchek` sits at index 16. And `canadiantire` is not one
of the six stores in `STORES`, so the lookup was `undefined`, the expression
collapsed to `null`, and strategies 3-5 never ran — including the keyword
fallback that would have matched `SPORTCHEK` in `www.sportchek.ca`.

**Two fixes, both needed.**

1. A pass now returns the first match that **resolves** to a store. 14 of the 20
   pattern ids have no store record, and each was the same black hole.
2. The CTC vocabulary is demoted to `weakPatterns`, consulted only when no
   strong pattern matched anything. Fix 1 alone would have worked *today* and
   silently reversed the day `canadiantire` joins `STORES`.

The test mock in `receiptParsingShared.test.js` **contains** `canadiantire`,
which is why the suite could never see this: in the mock the receipt resolved to
Canadian Tire — wrong, but not null — and no assertion looked.

---

## 2. The layout

```
627555628505 $524.97 H                    ← UPC · price · tax flag (NO name)
DIAMONDBACK MOTOWN 27.5 IN (Q125) BEIGE   ← the product name
24 BEIGE XL BEIGE                         ← the variant row
Qty: 1 Price: $524.97                     ← quantity and UNIT price
Serial Number: l240827662                 ← optional
Reason: Gift/Don't Want                   ← returns only
Sub total                        $524.97
ONFedHST 5.000%                   $26.25
ONProvHST 8.000%                  $42.00
Total                            $593.22
```

Re-zipped by `reshapeSportChekLines` into one `SKU NAME $PRICE FLAG` row per
product, so the shared item rules — which assume one printed row per line —
apply verbatim.

## 3. The seven rules, and what each one costs

**1. `Qty: 1 Price: $524.97` must be consumed.** It ends in an amount and is not
in `SKIP_EXACT`, so the ordinary rules make it a second product: a $524.97
basket reads as **$1,049.94**, against a receipt whose own printed total says
otherwise.

**2. The tax rows are invisible to the engine.** `TAX_LABEL_WORD_RE` needs a word
boundary before `hst`, and `onfedhst` has a `d` there. So `ONFedHST 5.000%
$26.25` was neither tax nor a summary line — it was a **$26.25 product**, and
`ONProvHST` a $42.00 one. They are now summed into a single `TAX 68.25` row that
the shared extractor reads. Summing is safe because the receipt states its own
answer: `524.97 + 68.25 = 593.22`, the printed total exactly.

**3. 🔴 A rule of hyphens under the total read as a minus sign.** The register
prints `------------------------------------------` directly beneath
`Total $593.22`. `isRefundText` reads each summary label together with the next
line looking for Costco's trailing-minus form — and a rule of hyphens satisfies
it. **Every Sport Chek PURCHASE was classified as a refund**: amounts negated,
`trackable: false`, and a receipt scanned to watch a price silently unwatchable.
The app's own `cleanReceiptOcr` strips these upstream, so the live pipeline
never hit it — which is what made it latent rather than impossible. The parser
now strips them itself before anything reads a sign.

**4. Refunds use a LEADING minus.** `-$524.97`, `Total -$593.22` — while
`Price: $524.97` stays **positive** and only `Qty: -1` goes negative. That is a
third sign convention (Costco's is trailing), so Sport Chek has its own
`preprocess` chained through the same hook. The rewrite is anchored to money
shapes only: the receipt carries `1-613-741-3378` and `01 APPROUVEE - MERCI 027`,
and turning one of those into an amount is the same class of defect as reading
`2210 BANK ST` as a $22.10 item.

**5. The identifier is a UPC, and four other long digit runs share the page.**
`isSportChekSku` accepts 12-13 digits only, which excludes the 21-digit eReceipt
barcode (`033010620260317009326`), the 16-digit survey code, the 9-digit GST/HST
number and the 8-digit terminal number.

**6. The return reprints the original purchase's date.** `Original Transaction
Information / Trn #: 009326 Date: 2026/03/17` sits above the return's own
trailer. Taking whichever date a whole-document scan meets first happens to be
right on this receipt and is not guaranteed; the cost of getting it wrong is a
return dated 72 days before it happened, which moves the 15-day adjustment
window. The parser cuts that block and then takes the labelled date.

**7. The variant row duplicates the colour.** `24 BEIGE XL BEIGE` under a
description ending in `BEIGE`. Appending it whole gives a name ending
"BEIGE 24 BEIGE XL BEIGE", and the name is what a shopper reads in a price-drop
alert; dropping it loses the SIZE, which for apparel and footwear is most of
what identifies a product. Only the tokens the description does not already say
are kept → `… (Q125) BEIGE 24 XL`. **This is the rule most likely to be wrong**,
because one product cannot show what the variant column means in general.

---

## What is owed before promotion

The bar is not "the tests are green" but **"the ways this could be wrong have
been looked for on purpose"**. Two receipts of one product cannot answer:

- [ ] **The OCR captures.** `npm run capture:receipts` with a Vision key. Until
      then nothing is pinned against what the app actually parses.
- [ ] **A multi-item basket** — does the block re-zip hold across items?
- [ ] **A discounted line** — Sport Chek's discount sub-row format is unknown;
      `handleDiscountLine` is not wired because nothing has shown what to wire.
- [ ] **A Quebec receipt** — `QCFedGST` / `QCProvQST` are handled by shape, never
      by a real receipt.
- [ ] **A sportchek.ca order** — an online format almost certainly exists and
      shares little at the line level. It gets its own branch, not a widening of
      this one.
- [ ] **The variant-row rule** against a second product.
- [ ] **A hardening pass** — Best Buy's found four defects its own corpus never
      hit.

Promotion then moves one line from `LAB_STORE_PARSERS` to `STORE_PARSERS`,
empties `sportchek` from `LAB_ONLY_STORES`, flips `enabled`, bumps
`BUNDLED_UPDATED_AT`, regenerates both generated files and applies the SQL.
