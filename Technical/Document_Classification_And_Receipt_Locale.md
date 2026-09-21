# Document classification and receipt locale

Two small shared modules, both added on 2026-09-21, both answering a question
the pipeline had never asked: **what is this page, and what language is it
printed in?** Neither is a parser. They sit in front of the parsers and hand
them something they can read.

See also: `Receipt_Parser_Registry_And_Store_Parsers.md` for what happens after.

---

## 1. `shared/documentKind.js` — is this a price tag or a receipt?

### Why it exists

On 2026-09-21 a shopper photographed a Costco receipt inside the **price tag**
scanner. Nothing refused it, and two invented products reached the live catalog.

The parser did not fail on the receipt — it *succeeded* on one.
`parseCostcoTags` segments text on SKU-shaped numbers, and a receipt is a table
of `<sku> <NAME> <price>` rows, so the item table became N plausible "tags".
Every one cleared `tagSubmittable`.

### The contract

```js
detectDocumentKind(rawText) -> "tag" | "receipt"
```

`"receipt"` **only** when both hold:

- **≥ 2 distinct receipt marker FAMILIES.** Ten families, grouped so that three
  regexes matching the same totals block still count as one piece of evidence:
  `totals`, `transactionFooter`, `membershipNumber`, `itemsSold`,
  `taxRegistration`, `payment`, `cartBanner`, `cashier`, `orderHistory`, and
  three structural ones — `itemTable`, `taxFlagColumn`, `trailingNegative`.
- **Zero Costco register labels.** `PRICE AT REGISTER`, `SELL PRICE` /
  `PRIX DE VENTE`, `PRICE PER` / `PRIX PAR`, `INSTANT SAVINGS`, `MEMBER ONLY`.
  A receipt never prints any of them, so one is enough to veto.

Everything else — empty, garbled, unrecognisable — is `"tag"`, i.e. carry on as
before. This module exists to catch one confidently-identified mistake, not to
become a second gate that can dead-end a user on an unlucky photo.

### Why both halves are load-bearing

Neither test alone works, and the fixtures prove it:

- `hotDogAndMandu` is a **genuine multi-tag photo** that trips two structural
  families (several SKU rows, a trailing-negative savings line). It reads as a
  tag only because of its register labels. Remove the veto and it breaks first.
- The PII-scrubbed **Gloucester** captures carry no membership number and no
  transaction footer — the compliance scrub removed them — and a tightly
  cropped photo would not have them either. They are caught purely by SHAPE.

That is why the structural families exist: they survive both the compliance
scrub and a crop, and they are the same thing that makes the tag parser
mis-segment in the first place.

### Where it is enforced — both sides, and the server is the important one

| Side | What happens |
|---|---|
| Client (`scanCostcoTags`, one added early return) | Returns `{ tags: [], documentKind: "receipt" }`. The screen offers the receipt scanner, carrying the photo already taken (`navigate("Scan", { preloadedUri })`). Nothing is refunded because a tag scan costs nothing. |
| Server (`POST /api/observations/tag`) | Refuses with `400 RECEIPT_NOT_A_TAG`, `retryable:false`, **before any write** — no product, no price point, no review row, no admin push. |

**OTA is unavailable on the current EAS plan.** A client-only gate therefore
reaches nobody until every user installs a new build from the store, while the
API gate covers every binary already in the field the moment it redeploys.
This is the general rule for any guard of this kind.

The gate lives inside `scanCostcoTags` rather than in the screens because the
offline queue worker (`tagScanQueue`) is the other caller and would otherwise
keep its own copy.

### The offline queue needed a third terminal state

`ready_review` would announce *"your price-tag scan is ready"* for a photo
holding no tag. `error` renders as *"couldn't read automatically — enter by
hand"*, which invites hand-typing a receipt into a price-tag form. So:
`status: "receipt"` — no tags, nothing submittable, and the pending screen
offers the receipt scanner instead of a submit button.

---

## 2. `shared/receiptLocale.js` — what language is this receipt?

### Why it exists

Turning the receipt above into a fixture produced the first French capture in
the corpus. It parsed **3 of its 11 items**, reported a $48.67 subtotal for a
$220.50 receipt, and `reconciled=true` — because it reconciled its own subset
against a total it had also failed to read. The whole realocr suite passed.

### One parser, two notations — deliberately not two parsers

The obvious reading of "support French receipts" is a second parser. It is the
wrong shape: a Costco receipt's **structure** is identical in both languages —
same SKU·NAME·PRICE table, same column-split *bas du panier* block, same TPD
discount chains, same refund markers, same geometry. Only the decimal separator
and a handful of labels differ.

A second parser would duplicate every hard part of the first and then drift from
it — the failure this repo already names in `ocrCleanup.js` and
`receiptPiiScrub.js`. So: **detect the language, normalise the notation, and let
one parser read it.**

### The contract

```js
detectReceiptLanguage(text)   -> "fr" | "en"     // "en" is the default
normalizeFrenchNotation(text) -> text            // idempotent, no-op on English
localizeReceiptOcr({text, words}) -> {text, words, language}
```

Called once at the top of `parseCostcoReceipt`, **before** the gas and refund
dispatch — `countPurchaseLines` counts price-shaped lines, so an unnormalised
French receipt could be read as having no purchases at all.

Both the flat text **and** the word geometry are normalised. The parser runs
them as separate candidates and keeps whichever better matches the printed
self-checks; normalising one would have them disagree for a reason unrelated to
which read the page better.

### What "notation" means here

| Quebec prints | Normalised to | Why |
|---|---|---|
| `29,99` | `29.99` | Every price pattern required a period and read a comma as a *thousands* separator. Distinguished by the negative lookahead: a thousands comma is always followed by **three** digits. |
| `12.99 FP` | `12.99 F` | `F` = TPS, `P` = TVQ, `FP` = both. Every price pattern allows ONE flag character, so `FP` matched none of the eighteen of them. The flag is only ever *evidence that a line carries a price* — nothing reads it to decide which tax applies — so collapsing it costs nothing. |

Detection markers are chosen to survive `ocrCleanup` (the parser sees cleaned
text, and the scrub removes the membership row, the cashier line and the whole
payment block): `SOUS-TOTAL`, `TAXE`, `NOMBRE D'ARTICLES`, `TOTAL RABAIS`,
`T.V.Q.`, `T.P.S.`, `MERCI`, `COMPTE TOTAL`, and others. **Two** are required —
one French word on a bilingual footer is not a French receipt.

### The four label fixes that went with it

Normalising notation was necessary but not sufficient. Four label patterns were
bilingual in principle and asymmetric in practice:

1. `tax(?:es)?` cannot match **`TAXE`** — the boundary after `TAX` fails on the
   following `E`. The tax row became a $19.61 *line item*.
2. `includes("sous-total")` cannot match **`SOUS - TOTAL`**, which is what
   geometry produces when Vision reads the hyphen as its own word. The SUBTOTAL
   was returned as the grand total, and a 10-item parse outscored the correct
   11-item one. The English half of that same alternation was already
   spacing-tolerant.
3. The Quebec coupon prints as a bare `<barcode> / <sku>` with no `TPD`/`CPN`
   keyword. Accepted now **only** when the next line is a bare negative amount
   AND the referenced SKU is an item already parsed — so, unlike the keyworded
   forms, it can never fall through to the most-recent-item fallback.
4. Both printed self-checks scanned ±3 lines from their label; on a Quebec
   summary column the count sits 4 lines below. Now ±6, which is safe because a
   count is a **bare integer** among decimals and the discount total is the only
   amount printed with a leading `$`.

> **The self-checks are the real lesson.** Both returned `null`, so `scoreParse`
> had nothing to disagree with and scored a 3-of-11 parse as fine. A self-check
> that returns null is not a passing self-check. Assert that a check **fired**,
> not merely that it did not object.

### Measured, not asserted

Across all 45 committed captures: exactly **one** is French (9 markers, 0
English), and the other **44 round-trip byte-for-byte** through the normaliser.
Both are assertions in `__tests__/receiptLocale.test.js`, not claims in prose.

It is deliberately **not** in `sync-shared.js`'s mirror list: receipt parsing is
client-side, nothing on the server requires it at runtime, and that list means
"modules the backend needs". A copy nothing reads is a copy nothing keeps in
step.

---

## 3. Capturing a fixture without a Vision key

`npm run capture:receipts` now falls back to the backend's own `/api/ocr` proxy
when no `GOOGLE_VISION_API_KEY` is on disk. **That is the normal case, not an
edge one** — the key is deliberately server-side — which meant nobody could
capture a receipt fixture locally at all. The proxy returns Google's response
verbatim, so the fixture is identical; it costs one Vision unit and defaults to
the **development** backend for that reason. Override with `PRICE_API_URL`.

One caveat worth knowing: an iPhone photo may be **HEIC** even under a `.jpg`
key. Vision refuses it ("Bad image data"). Transcode before capturing — see
Bugs_Common_Fixes #268.
