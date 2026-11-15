# Receipt parser specification — how to build a store parser that works

> **Status: DRAFT, waiting for Maxim's approval (written 2026-11-14).** Until it is approved, §9 lists the decisions
> that are his. Once approved, this page is the specification every store parser is built and reviewed against,
> and `Adding_A_New_Store.md` §4 points here.
>
> **Asked (Maxim, 2026-11-14):** *"i want the best buy to have a specific parser as costco … each store has his own
> parser, parser (others than costco) can have shared code as a prefilter, all parser should remove noise and filter
> the real receipt content, header and footer then proceed (same logic always) this is the only way we have succedded
> with costco parser … plan the full specifications on how to create a successful parser then attack the best buy
> receipt problem. plan should be documented and available always for next developments."*
>
> **Where this page sits.** `Receipt_Parser_Design_Rules.md` is the rule (denoise first, then extract) and its
> Costco history. This page is the **build specification** that turns the rule into stages, contracts, files, tests
> and a promotion bar for any store. `Adding_A_New_Store.md` is the end-to-end procedure for a store (feasibility,
> store record, price feed, go-live); its parser section defers to this page. A store's own facts (its layouts, its
> vocabulary, its root causes) live in that store's folder, never here: `Technical/BestBuy/`, `Technical/SportChek/`.

---

## 1. Why a specification, and what it is built from

Two things are known to work and two are known to fail. The specification is the first two, written so the last two
cannot be repeated.

**What made Costco work** (`Receipt_Parser_Design_Rules.md`):

1. The receipt is cut into **sections** before anything is extracted, and each figure is read **from its own
   section only**.
2. **Noise is removed first**, as vocabulary per language. Extraction never learns to step around junk.
3. The receipt **states its own answers** (subtotal, tax, total, item count). A reading is accepted when it closes on
   them, worked on when it does not, and flagged when the tries run out.
4. A figure that cannot be placed is **unread, never guessed**.
5. Every change is **proven on a corpus of real captures**, with the truth read off the paper.

**What failed** (each is a rule below):

| Failure | What happened | Rule it becomes |
|---|---|---|
| Best Buy, 2026-09 | 1,070 synthetic tests green, all 9 real receipts wrong. | §6: only real captures count. |
| Best Buy, 2026-11 (`BestBuy/Receipt_Parser_Rebuild_Plan_2026-11-14.md`) | One real receipt scanned 6 times in production: 5 of 6 captures were sent to the wrong format's parser by **one regex that needed a perfectly read `S`**, and a town name became a $5.62 product. | §3 stage 4 and §4 rule 2: a decision never rests on one exactly-read glyph. |
| Same receipt, forced through the right parser | A damaged `SUBTOTAL` label was not recognised, so the denoise step **failed open** and the subtotal became a second $3,699.99 product. The parse then reported itself as reconciled, because no total had been read to check against. | §4 rules 3 and 4: fail closed; "closes" needs a printed figure. |
| Mailbox import, 2026-11-07 | 12 "receipts" whose one item was the email's subject. The import used one regex for every store and never reached a store parser. | §3 stage 0 and §7: every source goes through the store's parser or is refused. |

## 2. Principles

1. **One store, one parser, one folder, one rule set.** A store's vocabulary, row grammar, identifier shape,
   thresholds and noise list live in that store's files. Two stores never share a rule, even when today's values
   are equal.
2. **Costco shares nothing a non-Costco change could reach** (Maxim, 2026-10-28). Costco's parser, the files frozen
   by `costcoPathImmutability.test.js` and `shared/costcoReceiptSections.js` are never edited for another store.
3. **Other stores may share a pre-filter kit, and only mechanisms go into it** (§5). The kit knows how to cut a
   receipt at anchors it is *given*; it never knows what any store's anchors are.
4. **Same stages, same order, for every store and every receipt** (§3). A new receipt shape changes a store's
   vocabulary or its section boundaries. It never adds a branch to extraction.
5. **Right or unread, never plausibly wrong.** A wrong price is worse than a missing one, because the shopper acts
   on it. Every stage has an honest "I could not read this" output, and the pipeline carries it to the screen.
6. **The paper is the proof.** A reading is trusted when it closes on figures the receipt printed. With no printed
   figure read, nothing is proven, and the result says so.
7. **OCR is a noisy witness.** The same receipt photographed six times gives six different texts (§6.2). Anything
   that works on one capture and not the others is not done.
8. **Special cases are image problems only** (tilt, curl, fold, faint print). They are handled in geometry or by
   the photo-quality gate, never by a text rule aimed at one receipt.

## 3. The pipeline

Thirteen stages. Stages 0 to 2 and 12 belong to the app's pipeline (`receiptParser.parseReceiptText` and the
server); stages 3 to 11 are the store parser. Each stage has one input, one output and one honest failure.

```
 0  INTAKE      photo · PDF · screenshot · email  →  { text, words | null, sourceKind }
 1  CLASSIFY    is this a receipt at all?            (a notice, a price tag, a flyer is refused here)
 2  STORE       which store?                         (detectStore + the registry's claims)
 ── the store's parser ───────────────────────────────────────────────────────────────────────
 3  ROWS        words → rows (geometry), safe glyph and money-notation repairs
 4  FORMAT      which of THIS store's formats?       (in-store slip, online order, email, return)
 5  SECTIONS    cut the rows into sections           (header, body, totals, payment, footer, …)
 6  IDENTITY    store number, purchase date, order number, from header/footer sections only
 7  DENOISE     drop every row that is not item block or totals block (EN + FR)
 8  EXTRACT     items from the body's rows · subtotal, tax, total from the totals section
 9  VERIFY      Σ lines = subtotal · subtotal + tax = total · item count · tax rate
10  BALANCE     bounded tries that correct the LINES to the printed figures; adopted only on landing
11  SCORE       confidence + the store's own signals; reading state: proven · unproven · unreadable
 ── back in the pipeline ─────────────────────────────────────────────────────────────────────
12  CATALOGUE   server: is each identifier a product this store sells? (name and price agree)
```

### Stage 0 — Intake

| Source | What the parser is handed | Note |
|---|---|---|
| Photo | Vision text + word boxes (pixels) | The only source with image problems. |
| PDF | Vision text + word boxes (page-relative), one to several pages | Rows are exact (`shared/pdfReceiptRows`). A PDF's text layer is never the fixture: the app sends the PDF to Vision. |
| Screenshot | as a photo | A store app's digital receipt is its own *format* (stage 4), not a photo of the paper one. |
| Email | the message's text, `words: null`, `sourceKind: "email"` | §7. Never parsed by a store-agnostic regex. |

Every source is handed to the **same entry point** and reaches the same store parser. A new way in (share sheet,
mailbox, file import) is a new *source*, never a second parser.

### Stage 1 — Classify the document

A receipt has a store, a date, at least one priced line and a total. A pickup notice, a shipping update, a price
tag, a flyer page or a returns-policy back side has not. The document kind is decided before the store parser runs,
and what is not a receipt is refused with its reason. A store parser may also refuse (`rejected: true`,
`receiptKind`) when it recognises a document of its own store that is not a purchase.

*Today:* the receipt path has the country gate and the unknown-retailer gate (`receiptParser.parseReceiptText`),
and `shared/documentKind.js` tells a price tag from a receipt for the **tag** scanner only. A receipt-or-notice
test in the receipt path is new work; it is the same conjunction idea (two distinct families of receipt markers:
a totals block, a tax line, a tender line, an item count), and it is what refuses an emailed notice (§7).

### Stage 2 — Identify the store

`detectStore` plus the registry's `claimDetectedStore` (a store with a parser may claim a receipt on its own
evidence; a Costco detection is never re-examined). Unchanged by this specification. The store is decided **once**;
the parser falls back to the dispatcher's answer and never re-derives "no store" from a cropped photo.

### Stage 3 — Rows

- With word boxes, the parser works on **rows rebuilt from geometry** (one printed line = one row, columns kept by
  x-position). Flat text is the fallback for sources without boxes.
- Each row keeps what later stages need: its text, its words, its x-extent, the amount in its price column if any,
  and Vision's confidence.
- Repairs allowed here are the ones that cannot invent data: a thousands separator read as a period
  (`$3.699.99` → `$3,699.99`), currency spacing, the faint-glyph tier 1 (`S9.99` → `59.99`: the token is not a
  number and cannot be a word). A decimal point is never added to a bare integer.
- **Output:** rows. **Honest failure:** fewer than a store-defined minimum of rows or of confidence →
  `unreadable`, with the photo-quality reason, so the app asks for a new photo instead of parsing fog.

### Stage 4 — Format

A store prints more than one document (Best Buy: thermal slip, bestbuy.ca order, return; Costco: warehouse slip,
app receipt, costco.ca order). The **store's parser decides its own format**; the shared `detectPurchaseType` is
Costco's and is not extended.

The decision is **scored evidence**, never one pattern:

- each format lists several independent markers (a slip: register header, business-date label, transaction word,
  item-count line, tender block; an order: order number, table header, shipping block, web-id label);
- markers are matched **glyph-tolerantly** (§4 rule 2);
- no marker is "impossible on the other format" unless real receipts prove it (a slip for a delivered TV prints
  `Delivery Date` twice);
- the result records the evidence (`formatEvidence`), so a wrong routing is diagnosable from the stored result;
- a tie or no evidence is `format: unknown`. An unknown format is **not** handed to whichever parser is the
  default: it goes to stage 11 as `unreadable`.

### Stage 5 — Sections

Each format declares its sections and the anchors that bound them. The common skeleton is:

| Section | Holds | Read by |
|---|---|---|
| Header | banner, slogan, address, store/register line, date line, cashier | identity |
| Body | item rows and what belongs to an item (identifier, discount sub-rows, fees, quantity) | extraction |
| Totals | item-count line, subtotal, tax line(s), total | the printed figures |
| Payment | card, approval, tender, change | nothing |
| Footer | return policy, survey, barcode, thanks | identity (when the store prints the date or store there) |

A store adds its own (Costco: Void, Summary; a Best Buy slip: fulfilment rows inside the body). Rules:

1. **Every boundary has at least two independent anchors**, so one unread label does not move it. A totals block is
   found by its labels *or* by its shape (an amount equal to the sum above it, followed by a tax line whose rate ×
   base is the next amount, followed by their sum).
2. **Anchors tolerate OCR damage** (§4 rule 2): `SUBTOTAL` is also `S6#FOTAL`, `SueraTAL`, `SU8TOTAL`.
3. **A section that cannot be found is reported missing.** The segmenter never "fails open" by handing the whole
   receipt to extraction. Missing body or missing totals → the reading can be at best `unproven`.
4. The sections are computed once and are the **only** way any later stage, or any other consumer, reads the paper
   (the phone's checks and, once the store has server-side checks, the server: §8).

### Stage 6 — Identity

Read from the header and footer sections **before** they are dropped: the store number, the purchase date, the
order or transaction number.

- A **labelled** purchase date outranks every other date; delivery, shipment, expiry and "original transaction"
  dates are named as such in the store's vocabulary so they can never be taken for it. Labels are matched
  glyph-tolerantly (`BUS DATE`, `BUS.DATE`, `BUS. DATE`, `8US DATE`).
- An identifier the format does not have is `null` (an online order has no store number).
- Unread is `null`. The date is never defaulted to today inside the parser.

### Stage 7 — Denoise

Everything that is not the body or the totals section is dropped as a section. **Inside** the body, the store's
noise vocabulary (EN + FR) removes the rows that are not items: fulfilment and delivery rows, serial numbers,
promotional banners, survey lines. Noise is removed at row level, before extraction; scrubbing a name afterwards
is a backstop, and each time it fires the vocabulary has a gap to close.

### Stage 8 — Extract

- **Items come from body rows only**, by the store's **row grammar**: which rows make one item (name row, identifier
  row, price column, sub-rows) and which rows belong to it (discount, fee, quantity).
- An item needs a **name from the body**, an **amount in the price column**, and for a watchable line an
  **identifier of the store's exact shape** (§4 rule 5). A row that has an amount but fits no part of the grammar is
  **not** promoted to an item; it is counted as an *unexplained row* and lowers the score.
- **Printed figures come from the totals section only**, each from its own label's row. As many bare amounts as
  labels are assigned in order; any other shape is read only when exactly one assignment closes. Nothing is read
  from "the whole text" or "the next line".
- Service and fee lines (plans, delivery, installation, eco fees, deposits) are kept, visible, and never watched.

### Stage 9 — Verify

The checks are arithmetic the receipt supplies about itself. Each is `pass`, `fail` or `unverified` (a figure was
not read):

| Check | Passes when |
|---|---|
| `lines_close` | Σ lines = printed subtotal (or = total − tax when the store prints no subtotal) |
| `total_closes` | printed subtotal + printed tax = printed total |
| `item_count` | lines counted the store's way = the printed item count, when the store prints one |
| `tax_rate` | printed tax = printed rate × printed base, when the store prints the rate |
| `identifiers` | every watchable line carries an identifier of the store's shape |
| `no_unexplained_rows` | no priced body row was left outside the grammar |

**`unverified` is never `pass`.** A reading whose lines sum to themselves, with no printed figure read, has proven
nothing (§4 rule 4).

### Stage 10 — Balance

A reading that does not close is worked on, in a fixed and bounded order, each try adopted **only when it lands
exactly on the printed figures**:

1. re-cluster the rows at other tolerances (a tilted or curled photo merges or splits rows);
2. faint-glyph tier 2: a single-glyph edit of one amount (bounded number of candidates);
3. the store's own arithmetic repairs (a tax misread by one digit when the printed rate × base and the total agree);
4. the pipeline's second pass (high-resolution OCR), then the AI readers **where the store is opened to them**
   (`shared/receiptReaders.js`; today Costco only).

Balancing corrects the **lines**. A printed subtotal, tax or total is never re-derived from the lines. "Closer" is
never adopted, only "lands".

### Stage 11 — Score, and the reading's state

The parser stamps its own signals (`parserSignals: [{name, cost}]`), applied by the registry's `scoreParse`. On
top of the score, every result carries one **reading state**, which decides what the shopper sees:

| State | Meaning | The app |
|---|---|---|
| `proven` | every check passed against printed figures | shows the receipt; may be saved |
| `unproven` | items were read, but a check failed or is unverified | shows it **marked for review**, names what could not be confirmed, and runs the second pass first |
| `unreadable` | no format, no body, no totals, or the photo is below the store's print-quality floor | shows no items; asks for a new photo, with the reason |

A receipt is never shown as a list of confident-looking lines when its state is not `proven`.

### Stage 12 — Catalogue check (server)

An identifier that has the right shape can still be a misread (`19204882` read as `9204882`: seven digits, valid
shape, another product or none). On save, each identifier is checked against the store's catalogue or price feed:
the product must exist **and** its name must agree with the printed name (or its price with the printed price).
A line that fails keeps the number as read (`sku_read`) and is not watched until corrected. Prices and totals are
never touched by this stage. Each store has its own matcher over its own feed.

## 4. Robustness rules (each one cost a production failure)

1. **No single point of failure.** Any decision that changes the path of a receipt (format, section boundary,
   refund or purchase) needs two independent pieces of evidence, or it is `unknown`.
2. **Glyph-tolerant anchors.** Vision's confusions are systematic: `S↔5↔8`, `O↔0↔D`, `I↔1↔l↔T`, `B↔8`, `G↔6`,
   `Z↔2`, a lost first letter, `-` read as `.` or a space, a label's inner letters replaced (`S6#FOTAL`). An anchor
   is written as the label **and** its tolerated damage (an edit distance within the store's limit, over the
   confusion table). Tolerance applies to **labels and layout tokens**, never to amounts or identifiers.
3. **Fail closed.** When a stage cannot do its job it says so; it never passes its whole input through for the
   next stage to guess at.
4. **"Closes" needs a printed figure.** Self-consistency without a printed anchor is `unverified`.
5. **Identifier shape is exact, and shape is not proof.** Width, leading digit and excluded look-alikes (dates,
   counters, phone numbers) are the store's; stage 12 is what proves the number.
6. **Any row that ends in an amount is a candidate product, so every such row is accounted for** (item, sub-row,
   totals, noise, or *unexplained*). None is left to a default.
7. **Dates: labelled first, and every other date named.**
8. **A zero is a price.** `$0.00` on a service row is data; it is neither "no price" nor repaired to another digit
   without landing.
9. **Languages are vocabulary.** EN and FR lists per store; a third language adds a list and changes no stage.
10. **The same answer on every capture.** A rule is accepted when every capture of the same receipt gives the same
    reading, or an honest `unproven`/`unreadable`. One capture reading differently and wrong is a failure of the
    rule, not of the photo.

## 5. Files, and what may be shared

**Per store** (`<store>` = `bestBuy`, `sportChek`, …):

| File | Holds |
|---|---|
| `src/services/<store>ReceiptParser.js` | the entry point and the stage order; nothing else |
| `src/services/<store>Receipt/format.js` | the formats and their evidence |
| `src/services/<store>Receipt/sections.<format>.js` | the sections and anchors of one format |
| `src/services/<store>Receipt/vocabulary.<lang>.js` | labels and noise, one file per language |
| `src/services/<store>Receipt/grammar.<format>.js` | the row grammar and the identifier shape |
| `src/services/<store>Receipt/balance.js` | the store's arithmetic repairs |
| `__tests__/fixtures/receipts-<store>/` | the corpus (§6) |
| `Technical/<Store>/` | the docs: layouts, vocabulary, root causes, corpus status |

**The pre-filter kit** (`src/services/storeReceiptKit/`, for every store **except Costco**):

| Module | Mechanism (it is handed the store's data; it holds none) |
|---|---|
| `rows` | words → rows, column positions, per-row confidence |
| `glyphs` | the confusion table, tolerant label matching, the safe money-notation repairs |
| `segment` | cut rows into sections from a format's anchor declaration; report a missing section |
| `denoise` | drop rows by a vocabulary it is given |
| `figures` | place the totals section's amounts under its labels, by the rules of stage 8 |
| `checks` | the stage 9 arithmetic and the reading state |
| `balance` | run a store's tries in order, adopt only on landing, bounded |

Rules for the kit:

- **A store's rule never goes into the kit.** If a change to the kit is "for Best Buy", it belongs in Best Buy's
  files. The kit changes only when a mechanism is missing for *any* store.
- **Costco never imports the kit, and the kit never edits a frozen file.** Pinned by a test
  (`__tests__/storeReceiptKitIsolation.test.js`): no Costco module imports `storeReceiptKit`, and the kit imports
  nothing from the frozen set.
- A kit change is proven on **every** non-Costco store's corpus, as a parser change is.
- Existing non-Costco parsers that call the frozen shared engine (`parseReceiptEngine`) keep working until they are
  rebuilt on this specification; a rebuilt format no longer calls it (§9, decision 1).

## 6. The corpus and the bar

### 6.1 Only real captures count

Synthetic text proves that a rule does what its author imagined. Only Vision's output for a real receipt proves the
rule applies. The corpus is `*.vision.json` (text + words + confidence), PII-scrubbed, committed; sources stay
local. First places to look for a new store's receipts: **Admin · Receipt reading › Unsupported stores** (refused
scans held with their photo) and the store's unlinked `ocr_captures`.

### 6.2 One receipt, several captures

The same paper photographed again gives a different text. So the corpus is **receipts × captures**:

- every receipt is captured at least **three times** (the app's standard pass, its high-resolution pass, and one
  poor photo: tilted, or after the scanner's enhancement), and production captures of it are added as they appear;
- the ground truth is **per receipt**, read off the paper, including its nulls; every capture is tested against it.

### 6.3 The scorecard

For every capture, every field (format, date, store number, each line's name, identifier and price, subtotal, tax,
total) is one of:

- **right**: equals the truth;
- **honest**: unread, and the reading state says so;
- **wrong**: a value that is not the truth, presented as read.

| Bar | Requirement |
|---|---|
| Any merge | **0 wrong fields on the whole corpus**; no capture that was `right` becomes anything else |
| Admin preview (ships in builds, admins only) | every format the store has is covered by at least 3 real receipts, each with its captures; 0 wrong; every capture of a good photo fully right |
| Everyone (`stores.enabled`) | at least 10 real receipts per format, covering: multi-item, a discounted line, a service or fee line, a Quebec (FR, two-tax) receipt, a return; 0 wrong; and Maxim's call |

"The ways this could be wrong have been looked for on purpose" stays the last line of the bar: a hardening pass
that reads the parser against its captures for failures the corpus never hit.

### 6.4 Tests every store has

| Suite | Pins |
|---|---|
| `<store>ReceiptParser.realocr.test.js` | the scorecard: every capture against its receipt's truth; the counts printed |
| `<store>ReceiptParser.test.js` | one assertion per rule, written against real receipt text |
| `<store>ReceiptFormat.test.js` | routing: every capture reaches its format; damaged markers; `unknown` on a tie |
| `<store>ReceiptSections.test.js` | boundaries under glyph damage; a missing section is reported, never passed through |
| `<store>CaptureVariance.test.js` | every capture of one receipt gives one reading (§4 rule 10) |
| `storeReceiptKitIsolation.test.js` | Costco imports no kit; the kit imports no frozen file |
| `receiptParserRegistry.test.js`, `costcoPathImmutability.test.js` | unchanged: dispatch and the Costco freeze |

## 7. Email

An email is a **source** (stage 0), not a parser.

- The mailbox import hands the message to the same entry point; the store's parser needs an `email` **format**
  (its own sections, vocabulary and grammar, its own corpus of real emails) to read it.
- A store with no `email` format refuses email (`no_parser_for_source`); nothing is imported. The store-agnostic
  body regex (`parseReceiptFromEmailBody`) and "the subject as the item" are removed.
- Stage 1 refuses notices (ready for pickup, shipped, survey) before any parser runs.
- The store gates of `Adding_A_New_Store.md` §2.2 stay (locked store, expired), and Gmail-sourced receipts stay
  local-only (Google's Limited Use policy; `receiptSyncService.isGmailSourcedReceipt`).

## 8. The rest of the system reads the same paper

Today the server's checks (`shared/receiptPrintedFigures`, `shared/receiptChecks`, the quality gate, the reading
confidence, the app approval) read every receipt through **Costco's** sections, and the AI readers are open to
Costco only (`shared/receiptReaders.js`). For another store this means its receipts are judged with another
store's sections. So, per store, in this order:

1. the parser on the phone (this specification);
2. the store's sections available to the server (`shared/<store>ReceiptSections.js`, the phone's own module moved,
   not copied), and the printed-figure reader choosing the sections **by the receipt's store**, with Costco's branch
   untouched;
3. only then: the quality check, the reading confidence and the app approval for that store, and whether an AI
   reader may read it.

Until step 2 exists for a store, its receipts are not app-approved and not sent to an AI reader, and the admin desk
shows them as *not checked* rather than checked with Costco's rules.

## 9. Decisions that are Maxim's (2026-11-14)

1. **A rebuilt store parser stops calling the shared engine.** `Adding_A_New_Store.md` §4.2 says *"Build on the
   engine; never fork it."* The engine (`parseReceiptEngine`, `receiptParsingShared.js`) is on Costco's frozen
   path, so another store can neither change it nor rely on it changing. This specification replaces §4.2 with:
   the store's own grammar over the kit's rows. *Proposed: yes.*
2. **The kit** (§5) as the one place non-Costco stores share code, mechanisms only. *Proposed: yes.*
3. **`unproven` and `unreadable` on the scan screen** (§3 stage 11): a receipt that does not close is shown marked
   for review or not shown at all, instead of as confident lines. Needs two labels in EN and FR. *Proposed: yes.*
4. **Email** (§7): remove the generic body parser now, so email imports nothing for a store until that store has an
   `email` format; Costco's email format is then its own piece of work, with real emails. *Proposed: yes; say if
   Costco email import must keep working as it is in the meantime.*
5. **The bar** (§6.3): 3 real receipts per format for admin preview, 10 for everyone.

## 10. Checklist for a store parser (copy into the PR)

```
[ ] Formats listed, each with ≥ 3 independent markers, matched glyph-tolerantly; unknown is a result
[ ] Sections per format, each boundary with ≥ 2 anchors; a missing section is reported
[ ] Identity read from header/footer only; purchase date labelled; other dates named
[ ] Noise vocabulary EN + FR; nothing scrubbed out of names afterwards
[ ] Row grammar; identifier shape exact; every priced row accounted for
[ ] Printed figures from the totals section only; unread is null
[ ] Checks: unverified is not pass; reading state stamped
[ ] Balance tries bounded; adopted only on landing; printed figures never re-derived
[ ] parserSignals declared; the negative case tested
[ ] Corpus: receipts × captures, truth per receipt; scorecard prints 0 wrong
[ ] Capture-variance test: one reading per receipt
[ ] No store rule in the kit; Costco freeze green; kit isolation test green
[ ] Store folder updated: layouts, vocabulary, root causes, corpus status
[ ] Labels in every language (npm run i18n:check)
```

## 11. How this page changes

A new failure is first a root cause in the store's folder (the printed shape, the stage that mishandled it, the
proof by replay). If the stage's *rule* was missing, the rule is added here in the same PR, with the case it came
from. If a step here turns out wrong, it is fixed here, not worked around in one store.
