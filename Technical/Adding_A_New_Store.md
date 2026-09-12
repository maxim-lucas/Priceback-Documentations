# Adding a new store to PriceBack

**The complete procedure.** Read this before writing any code for a new
retailer, follow it end to end, and **append anything it was missing before you
finish** — that is the standing rule in `CLAUDE.md`, and it is the only reason
this file gets better instead of going stale.

Store-neutral by design. Per-retailer specifics live in that retailer's own
folder (`Technical/BestBuy/`, `Technical/Abercrombie/`, `Technical/SportChek/`),
never here.

> **Why this exists.** PriceBack has added three non-Costco stores. Best Buy
> (#2) needed a registry built from scratch, then a hardening pass that found
> four defects its nine-receipt corpus never hit, then an audit eight days later
> that found the go-live switch had been silently left off. Abercrombie (#3 on
> the price side) produced the wrong feasibility verdict for three days because
> a measurement's vantage point was not written down. Sport Chek (#3) was
> undetectable as a store at all, for a reason nothing in the suite could see.
>
> Each of those cost days, and **none of them was a hard problem** — they were
> steps nobody knew to take. This is that list.
>
> **Costco is deliberately not the example.** It is the launch store: a
> geometry-aware parser built on 42 real captures, a flyer-primary price source,
> a frozen code path and an Akamai-walled site. Nothing about adding store #N
> looks like it. Read Best Buy and Abercrombie for the shape; read Costco only
> for the standards.

---

## 0. Before you write anything

### 0.1 Read the log, and claim the work

`Operations/Task_Log.md` — scan for entries touching this store or these files,
then append your own entry at the top. Standing step, not a per-request ask.

### 0.2 Settle feasibility FIRST, in writing

A store has two halves and they fail independently:

| Half | Question | If the answer is no |
| --- | --- | --- |
| **Receipts** | Do we have REAL receipts, and how many? | You can still build a parser. You cannot promote it. |
| **Prices** | Can a server read this retailer's current price? | The store can still ship — receipts log, a drop is just never detected. Say so out loud rather than discovering it later. |

A retailer with a parser and no price feed is a store where **a drop can never
be detected and never earns a claim**. Best Buy was in exactly that state as
store #2 and nobody noticed for weeks. Decide it deliberately; do not arrive
there.

### 0.3 The price-side probe, in this order

Work through all six. Stopping early is what produced two wrong verdicts.

**1. `robots.txt` first, and write down what it says.** This decides whether the
store gets an adapter at all. Quote the Allow/Disallow lines into the store's
doc — a summary from memory is not a record.

**2. 🔴 Probe with a COMPLETE browser header set, not a User-Agent.** A&F
answers 403 to a `User-Agent`-only request and 200 to a full one: `Accept`,
`Accept-Language`, `Accept-Encoding`, `Upgrade-Insecure-Requests`, the four
`Sec-Fetch-*` headers and the three `sec-ch-ua*` client hints. **A 403 from a
thin request is not a verdict.** Sport Chek was called "Akamai-walled like
Costco" on exactly that mistake.

**3. 🔴 Then probe again from NODE, not from curl.** This is the step Sport Chek
added to the list, and it reverses conclusions. Measured the same minute with a
byte-identical header set:

```
curl  https://www.sportchek.ca/en.html  → 200
node  fetch(same url, same headers)     → 403, Akamai "Access Denied"
```

Akamai Bot Manager fingerprints the client **below the header layer** (TLS
ClientHello, HTTP/2 framing). curl passes, undici does not. **The job runs on
Node.** A capture taken with curl is evidence about the catalogue and is *not*
evidence that Railway can fetch it.

**4. Is the price actually in the HTML?** Fetch a product page and look for a
JSON-LD `Product`, an embedded price global, or a price attribute. Best Buy and
A&F both have one. Sport Chek's PDP carries two `ld+json` blocks and both are
site navigation — the price is a client-side call, which changes the whole
design.

**5. 🔴 What identifier does the RECEIPT print, and does it address the
catalogue?** The single most expensive question on this list, and the easiest to
assume. Take a real identifier off a real receipt and look it up:

| Store | Receipt prints | Catalogue uses | Resolves? |
| --- | --- | --- | --- |
| Best Buy | 7-8 digit SKU | the same SKU | yes |
| A&F | product name | an 8-digit id + a slug | **no** — `slug_unknown` |
| Sport Chek | 12-digit **UPC** | a 9-digit **SKU code** | **no** — `resultCount: 0` |

Two of three do not resolve. An adapter that cannot address the products your
users actually bought is inert no matter how correct it is, and that has to be
known before it is written, not after.

**6. What is the claim gate?** Whatever separates a price the shopper can claim
from one they cannot. **Every retailer has one and it is never optional.**

- Best Buy: `isMarketplace` — it does not price-adjust third-party sellers.
- Sport Chek: the published policy refuses closeout, liquidation, demo, flash
  sales and special pricing events — and the catalogue flags them as `badges`.

Read the retailer's own published policy page and list every exclusion. Then
check how common it is: Best Buy's sitemap is dominated by marketplace
accessories, and the very first Sport Chek product probed was `CLEARANCE`. **The
gate is usually the common case, not an edge case.**

> **A plausible wrong number is worse than a visible gap, because the user acts
> on it.** That sentence is the reason for most of the rules in this document.

### 0.4 Two more questions, because they are on the money path

- **Is the price national, or store-scoped?** Best Buy publishes one national
  price, which is what the reserved `NATIONAL` province exists for. Sport Chek
  takes a `storeId` on every call and the site picks a default store. Getting
  this wrong means `priceDropRepo.findNotifiable` — **the query that charges
  commission** — matches the wrong buyers.
- **Does the retailer's own policy admit a WEBSITE price as evidence?** Sport
  Chek's says price-matching "applies only to retail store locations, not to
  online orders". If a web price cannot support an in-store claim, a feed built
  on it cannot charge commission. That is a product decision; surface it.

---

## 1. Detection — make the store reachable

`src/services/receiptParsingShared.js` → `detectStore`.

Five strategies in order: vendor-name keyword, pattern match, phone, vendor
metadata, receipt keyword. Nothing downstream runs until this returns the store.

### 1.1 Confirm the store is in `STORE_DETECTION_PATTERNS` — and reachable

Most of the 20 launch retailers already have patterns. Having one is not the
same as being detectable:

**🔴 Pattern matching is first-match-wins over an ordered array, and a pattern
whose id has no `STORES` record used to return `null` and END THE SCAN.** 14 of
the 20 ids have no store record. Each was a black hole that swallowed detection
for any receipt mentioning it, including receipts of stores we *do* support.
Fixed 2026-09-11: a pass now returns the first match that RESOLVES.

### 1.2 🔴 Check the store's corporate family before trusting a pattern

**A retailer that shares a loyalty programme with a sibling banner will be
mis-detected as that sibling**, because the shared vocabulary prints on every
receipt in the family.

Sport Chek, Mark's, Atmosphere, Sports Experts, PartSource and Pro Hockey Life
are all Canadian Tire Corporation banners. Every Sport Chek receipt prints
"Triangle Rewards", "CT Money" and the words "Canadian Tire" — so
`/canadian\s*tire/i` (index 5) beat `/sport\s*che[ck]k?/i` (index 16) on every
one of them.

The mechanism: patterns are now tagged **strong** or **weak**.

```js
{ id: "canadiantire", patterns: [], weakPatterns: [/canadian\s*tire/i, /triangle\s*(rewards|mastercard|id)/i, /ct\s*money/i], … }
```

- **strong** — the retailer named itself, or printed something only it prints.
- **weak** — a programme or parent-company token shared across banners.

A weak match is consulted only when no strong pattern matched anything. When you
add a store, ask: *what does this receipt print that belongs to a PARENT or a
PROGRAMME rather than to this banner?* Put that in `weakPatterns`.

Known families to check: **Canadian Tire Corp** (above) · **Best Buy / The
Source** · **Gap / Old Navy / Banana Republic** · **Bass Pro / Cabela's** ·
**Sleep Country / Dormez-Vous** · **Rona / Réno-Dépôt** · **Costco / Costco
Business Centre**.

### 1.3 The other things `detectStore` touches

- **`getStoreByKeyword`** (strategies 1 and 5) is a plain `includes()` over
  `receiptKeywords`, scanning `STORES` in array order. A keyword that is a
  substring of another store's text will win by position.
- **`extractWarehouseId`** needs a per-store branch for the store number.
  **Require a second field as proof**: Best Buy takes `S-627 R-48` (the register
  pairs with it) because a bare `S-###` also matches a unit in a shipping
  address; Sport Chek takes `STR 330 REG 106` for the same reason — a street
  address sits four lines above it.
- **A refund reprints the ORIGINAL transaction's store and date.** Prefer this
  transaction's own trailer; an item returned at a different branch than it was
  bought at is otherwise filed under the wrong store.
- **`detectPurchaseType`** has per-store heuristics. An in-store register header
  must beat a delivery mention: a TV bought in store and delivered later is
  still an in-store purchase, and misclassifying it sends the user to the wrong
  claim process.

---

## 2. The store record — five declarations of one fact

This is the shape that gets three of five right. Best Buy's promotion touched
all of them and left the most important one off for eight days.

| # | Where | What |
| --- | --- | --- |
| 1 | `src/constants/stores.js` | the `STORES` entry — `adjustmentDays`, `policyUrl`, `policyNote`, `claimSteps`, `priceCheckUrl`, `receiptKeywords`, **en + fr for every text field**. Bump `BUNDLED_UPDATED_AT`. |
| 2 | `backend/data/policies.json` | generated: `node backend/scripts/regenerate-policies-json.mjs` |
| 3 | `backend/db/deploy/store-content-sync.sql` | generated: `npm run db:sync-store-content` (from the repo's `backend/`) |
| 4 | `src/components/Icons.js` | the store's badge — label, background, foreground |
| 5 | `src/services/emailSyncService.js` | sender domains + keywords, if the store emails receipts |

Then commit both generated files. Never hand-edit 2 or 3.

### 2.1 🔴 The go-live switch is a DATABASE row, and it is applied by hand

`applyRemoteStores` replaces the bundled array with the DB payload **on every
launch**, so bumping `stores.js` changes the offline fallback only. A promoted
binary still shows the store disabled until:

```bash
psql "$DATABASE_URL" -f backend/db/deploy/store-content-sync.sql
```

is run against each database. Best Buy sat "promoted" and switched off for eight
days because that file was hand-maintained, generated by nothing and tested by
nothing. It is now generated and pinned by
`backend/tests/storeContentSync.test.js`.

That sequencing is a feature: the binary can ship and be device-tested before a
single user sees the store.

---

## 3. The corpus — real receipts, or it does not count

> The Best Buy receipt parser passed **1,070 synthetic tests** and then got
> **all nine real receipts wrong**. Every order PDF extracted zero items.
> Synthetic payloads prove the rules; only captures prove the rules apply.

1. **Its own fixture tree**: `__tests__/fixtures/receipts-<store>/`. One store,
   one tree — sharing one would pull the new receipts into another store's
   realocr expectations.
2. **Register that tree in BOTH scripts** — `scripts/captureReceiptOcr.js` and
   `scripts/scrubReceiptFixtures.js`. Only registering the first leaves the
   corpus outside the PII re-scrub, which is how a capture ends up committed
   carrying something a newer rule would have caught.
3. **Add the `.gitignore` lines** for `*.jpg/jpeg/png/pdf` under that tree. The
   sources stay local; only the captured OCR is committed.
4. **`npm run capture:receipts`** — one Vision `DOCUMENT_TEXT_DETECTION` call
   per file, PII-scrubbed, frozen as `<name>.vision.json`. Needs
   `GOOGLE_VISION_API_KEY` in the environment or `backend/.env`.
5. **`npm run scrub:receipts`** — a dry run over the whole corpus; non-zero if
   anything still holds PII. `-- --write receipts-<store>` scopes a write.

### 3.1 🔴 A PDF's text layer is NOT the fixture

An eReceipt PDF has a clean text layer and it is tempting to test against it.
**The app never sees it.** It sends the PDF to Vision and parses Vision's OCR,
which streams a fixed-width or two-column document in an order belonging to no
column. That gap is precisely what made Best Buy's synthetic suite worthless.

If no Vision key is available, you can still write the rules suite against the
text — but say so in the realocr suite, keep the corpus count visible, and do
not treat the parser as validated.

---

## 4. The parser

`src/services/<store>ReceiptParser.js`, registered in
`src/services/receiptParsers/index.js`.

### 4.1 The contract

```js
parse(rawText: string, annotation: {words: [...]} | null) => result
```

`annotation` is Vision word geometry for image/PDF scans, `null` for pasted
text. A parser that does not use geometry ignores it.

The result carries everything `parseReceiptEngine` stamps, plus:

| field | meaning |
| --- | --- |
| `receiptKind` | `warehouse` · `in_store` · `online` · `gas` · `refund` · `unreadable` |
| `trackable` | false when nothing on it can be price-watched |
| `rejected` | true when recognized and deliberately NOT extracted |

**A parser must never throw on unrecognizable text.** Return a result with no
items; the scan pipeline decides what an empty parse means.

### 4.2 Build on the engine; never fork it

Reuse `parseReceiptEngine` with the `reshapeLines` and `handleDiscountLine`
hooks. Do not re-implement item extraction.

**🔴 Never teach a shared extractor a new store's vocabulary.** `extractDate`,
`extractWarehouseId`, `extractPrintedTotal` and `extractTax` are **Costco's live
code path**, pinned by a ~55-fixture corpus and a per-file coverage floor.
Editing one is a Costco change wearing another store's label. Both Best Buy and
Sport Chek re-derive their header fields locally instead; the duplication is the
cheaper trade. Where the shared extractor genuinely cannot read a layout,
**rewrite the store's own text into a form it already understands** — Best Buy
renames "Product Total" to a subtotal alias; Sport Chek collapses its split tax
rows into one `TAX <sum>` line.

### 4.3 The trap list

Every one of these cost a real defect. Check each against your receipts.

**Identifier width is load-bearing.** Anchor on the retailer's real SKU width and
nothing else. Best Buy is `[1-9]\d{6,7}` — the leading non-zero removes
zero-padded counters, and an 8-digit `YYYYMMDD` stamp is excluded separately.
Sport Chek is 12-13 (UPC-A/EAN-13) because the same page prints a 21-digit
receipt barcode, a 16-digit survey code, a 9-digit tax number and an 8-digit
terminal number. **An item watched under a number no product has is invisible
until the price drops and no alert fires.**

**Any row that ends in an amount is a candidate product.** Sport Chek's
`Qty: 1 Price: $524.97` is not in `SKIP_EXACT`, so it became a second item and
doubled a $524.97 basket. So did Best Buy's `You Save $10.00`. Consume the
rows that belong to an item; never leave one to the ordinary rules.

**Tax labels the engine cannot see.** `TAX_LABEL_WORD_RE` needs a word boundary
before `hst`. Sport Chek prints `ONFedHST 5.000% $26.25` — no boundary, so it was
neither tax nor a summary line, it was a $26.25 product. Check that your store's
tax rows are actually recognized, and that split rows are **summed**.

**Refund sign conventions differ per store, and there are at least three.**
Costco uses a TRAILING minus (`179.98-`). Sport Chek uses a LEADING one
(`-$524.97`) while its `Price:` field stays POSITIVE and only `Qty:` goes
negative. `refundToPurchaseText` handles Costco's; anything else needs the
store's own `preprocess`, chained through the same hook.

**Decorative rules can be read as a minus sign.** A row of hyphens directly
beneath `Total $593.22` satisfies `isRefundText`'s trailing-minus check, and
**every Sport Chek purchase was classified as a refund** — amounts negated,
`trackable: false`, silently unwatchable. `cleanReceiptOcr` strips these upstream,
so the live pipeline hid it. Do not let a classification this consequential rest
on an upstream pass having run.

**Dates: prefer a LABELLED one, and cut the blocks that are not yours.**
Receipts print delivery dates, shipment dates and — on a return — the ORIGINAL
purchase date. Taking the first parseable date mis-dates the adjustment window,
which silently shortens what the user is owed.

**Service and fee lines are visible but never tracked.** Protection plans,
installation, delivery, memberships, eco fees. There is no shelf price for a
2-year plan, and a `price_point` from one is permanent noise. Mark them
`ignored: true`; do not drop them (the user paid for them).

**Discount sub-rows: check the receipt's own arithmetic.** If `regular − savings`
already equals the printed line price, the discount is already applied and
netting it again shows a price the user never paid and would try to claim on.

**Detection can fail inside the parser too.** If the only text naming the banner
is a footer URL, a cropped photo leaves no evidence. The dispatcher already
resolved the store to choose your parser — fall back to that rather than
re-deriving `null`.

---

## 5. The lab lane — where an unfinished parser lives

**A store parser under construction produces WRONG NUMBERS on a real receipt,
and a wrong total is worse than "not supported yet" because the user acts on
it.**

Two halves, and they must move together:

| Half | File |
| --- | --- |
| the parser | `LAB_STORE_PARSERS` in `src/services/receiptParsers/index.js` |
| the picker | `LAB_ONLY_STORES` in `src/constants/stores.js` |

`__tests__/bestBuyStorePromotion.test.js` pins that they name the same ids. Both
files used to carry a comment saying they had to agree, and the comment was the
entire enforcement.

### 5.1 The promotion bar

Moving a store out of the lane is **not "the tests are green"**. It is:

> **"The ways this could be wrong have been looked for on purpose."**

Best Buy was promoted on nine real captures *plus* a hardening pass that found
four defects the corpus itself never hit. Ask, concretely: what does a
multi-item basket look like? A discounted line? A Quebec receipt? An online
order? A return? If you cannot answer from real receipts, it stays on the lane.

Promotion touches: `STORE_PARSERS` ← `LAB_STORE_PARSERS` (**moved**, not
copied), `LAB_ONLY_STORES` emptied of that id, `enabled: true`,
`BUNDLED_UPDATED_AT`, both generated files, and the DB row (§2.1).

---

## 6. Tests

| Suite | Pins |
| --- | --- |
| `__tests__/<store>ReceiptParser.test.js` | the rules, one assertion per trap, written against real receipt text |
| `__tests__/<store>ReceiptParser.realocr.test.js` | the captures, with per-receipt ground truth read off the paper |
| `__tests__/receiptParserRegistry.test.js` | dispatch, generic fallback, lane gating, the Costco parity replay |
| `__tests__/bestBuyStorePromotion.test.js` | the two lane halves agree; policies.json matches stores.js |
| `backend/tests/storePriceAdapters.test.js` | the adapter contract |
| `backend/tests/<store>Catalog.test.js` | the adapter's rules **and a replay of the real captures** |
| `backend/tests/storeContentSync.test.js` | the generated SQL is current |

**Pin ground truth including its nulls.** A store number invented out of a
shipping address is worse than none.

### 6.1 🔴 The Costco freeze will fire, and there is a protocol

`__tests__/costcoPathImmutability.test.js` hashes the Costco path *and the suites
that guard it*, including `receiptParserRegistry.test.js` — which every new store
must edit, because its inventory assertions are literal lists.

There is no "just re-pin it" path. Re-pin **one line**, in the same commit,
with a comment saying what moved and the evidence that Costco did not: the
Costco realocr suite, the golden snapshot and the other hashes passing in the
same run. Never refresh the whole table — a table refresh is indistinguishable
from an accident.

Note also: `src/services/receiptParsingShared.js` is **not** in the frozen set,
but it *is* shared parsing code, and the standing rule treats shared parsing code
as Costco. Changing it needs Maxim's confirmation and a stated regression
argument, even though no hash fires.

---

## 7. The price adapter

`backend/lib/<store>Catalog.js`, registered in
`backend/services/storePriceAdapters.js`.

```js
fetchQuote(sku, { fetchImpl, timeoutMs })  => Promise<Quote | Rejection>
fetchQuotes(skus, { fetchImpl, paceMs })   => Promise<Array<Quote|Rejection>>

Quote:     { sku, price, regularPrice, isOnSale, validUntil, isClearance,
             sellerName, currency }
Rejection: { sku, rejected: "<reason>", detail? }
```

Three rules, each learned expensively:

1. **Never throw.** A malformed payload, a 404, a timeout — all become a
   Rejection. An adapter that throws takes down the whole night's run. *Watch
   `for…of` over a field that might not be an array: `x || []` passes a truthy
   scalar straight into `is not iterable`.*
2. **A rejection is data.** Every reason distinct and counted. "Silently
   returned nothing" is how an upstream change hides for a month. **Name the
   reason after the truth**: `upc_not_addressable` says something actionable
   that a silent miss does not.
3. **Unit prices in the store's own currency.** No tax, fees or shipping.
   (Best Buy's provincial `ehf` is a fee, not the price.)

Then:

- **Injectable `fetchImpl`**, always — it is what makes the adapter testable.
- **The claim gate goes in BEFORE the price is read.** An excluded item has a
  price and it is not claimable; that combination must never become a quote.
- **Never free-text match.** `q=diamondback motown` returns 100 results and three
  plausible bikes. Resolve by code or reject.
- **Credentials belong to the retailer.** If the front end sends an API key, read
  it from the page at run start with an env override; never commit it and never
  ask the secret scanner for an exemption.
- **Capture real responses, commit them with a README, and replay them in the
  suite.**
- **Add the store to `hasDbPriceFeed` LAST** — only once the probe returns real
  quotes. `/api/check-price`'s `price_points` branch returns `null` rather than
  falling through to a live scrape, so listing a store with no feed turns a
  working price into "no price". Abercrombie and Sport Chek are both deliberately
  absent.
- **Write a probe script** (`npm run <store>:probe`) that goes through
  `resolvePriceAdapter`, so what it prints is what the JOB would have seen. Lead
  its default list with the case you expect to FAIL — a probe that lists only
  happy-path codes reports a healthy feed for a store it cannot address.

---

## 8. Go-live for the feed

Four independent things must be true, they are declared in four different
places, and **every one of them has been wrong at some point**:

| Condition | Where |
| --- | --- |
| the adapter is in this build | `PRICE_ADAPTERS` |
| `USE_DB` | the job writes `price_points` |
| the ops flag is on | `app_config`, **which outranks `backend/config/defaults.js`** |
| `/api/check-price` reads it back | `hasDbPriceFeed` |

`backend/lib/priceFeedHealth.js` reports the **conjunction** via `/health`, and
`SCHEDULED_PRICE_FEEDS` is where a store's flag is registered. Reported, never
enforced: a paused feed degrades a feature, it does not make the service
unhealthy.

🔴 **`app_config` silently wins over a code default.** Best Buy's
`BESTBUY_SCAN_ENABLED` default was flipped to `true` in code while an explicit
`false` row written days earlier sat in both databases — so the default never
applied anywhere, and nobody knew for eight days. **Query the table.**

Also owed before a feed is turned on in **production**:

- `Publishing-Compliance/REVIEWER_NOTES.md` declares every scraping source. A
  new one needs a row — and that file renders to `PriceBack_App_Review_Guide.pdf`
  with **nothing syncing the PDF to its source**, so re-render and re-upload.
- A **PIA** (Quebec Law 25 §3.3) for the new ingestion pipeline.
- **Verify Railway's egress reaches the host.** A laptop is not proof — and
  neither is curl (§0.3 step 3).

---

## 9. Labels

Every user-visible string in **every** language the app supports, in the same
edit. A store's `policyNote`, `claimSteps` and `category` are rendered by the
claim assistant: a store enabled with a missing French policy is a broken screen
in French, and nothing else in the suite would notice.
`npm run i18n:check` fails the build on drift.

---

## 10. Verification

```bash
npm test                       # mobile — jest, no database
npm run i18n:check
npm run scrub:receipts         # the new corpus is clean
cd backend && node --test tests/<the files in your blast radius>
```

Work out the blast radius rather than guessing: `grep -rl "<module>" backend/`
gives every importer. **Never dispatch GitHub Actions** — `main` only, on
Maxim's explicit request.

---

## 11. The completion checklist

Copy this into the PR and tick it.

```
FEASIBILITY
[ ] Task_Log entry appended
[ ] robots.txt read and quoted into the store's doc
[ ] probed with a COMPLETE browser header set
[ ] probed from NODE, not only curl
[ ] is the price in the HTML, or a client-side call?
[ ] receipt identifier vs catalogue identifier — does it resolve?
[ ] claim gate identified from the retailer's published policy
[ ] price national or store-scoped?
[ ] does the policy admit a website price as evidence?

DETECTION
[ ] STORE_DETECTION_PATTERNS entry exists and is REACHABLE
[ ] corporate-family / shared-loyalty tokens marked weakPatterns
[ ] extractWarehouseId branch, with a second field as proof
[ ] refund reprints of the original store/date handled
[ ] detectPurchaseType heuristic if the store has two formats

STORE RECORD (five, and they must agree)
[ ] stores.js + BUNDLED_UPDATED_AT
[ ] regenerate-policies-json.mjs
[ ] db:sync-store-content
[ ] Icons.js
[ ] emailSyncService.js

CORPUS
[ ] own fixture tree
[ ] registered in captureReceiptOcr.js AND scrubReceiptFixtures.js
[ ] .gitignore lines
[ ] capture:receipts run
[ ] scrub:receipts clean

PARSER
[ ] built on parseReceiptEngine + hooks; no shared extractor edited
[ ] identifier width anchored; competing digit runs enumerated
[ ] every amount-terminated row accounted for
[ ] tax rows recognized (and split rows summed)
[ ] refund sign convention handled
[ ] decorative rules stripped before any sign is read
[ ] labelled purchase date; foreign date blocks cut
[ ] service/fee lines ignored:true but visible
[ ] never throws on junk

LANE
[ ] LAB_STORE_PARSERS + LAB_ONLY_STORES both updated
[ ] promotion bar stated honestly in the PR

TESTS
[ ] rules suite
[ ] realocr suite with ground truth (incl. nulls)
[ ] Costco freeze re-pinned ONE line, with evidence
[ ] full mobile suite + i18n green

ADAPTER (if there is one)
[ ] contract satisfied; never throws; rejections named after the truth
[ ] injectable fetchImpl
[ ] claim gate before the price read
[ ] no retailer credential committed
[ ] real captures committed + replayed + README
[ ] probe script, leading with the expected failure
[ ] hasDbPriceFeed — LAST, and only if it really quotes

GO-LIVE
[ ] app_config row checked in BOTH databases
[ ] store-content-sync.sql applied where intended
[ ] REVIEWER_NOTES + PIA if a new scraping source
[ ] regression risk stated explicitly
```

---

## Appendix — what each store taught this document

| Store | The lesson |
| --- | --- |
| **Best Buy** | Synthetic tests are not evidence (1,070 passed, 9 real receipts failed). The go-live switch is a generated SQL file. `app_config` outranks a code default. |
| **Abercrombie** | A 403 may be header completeness, not a wall. Write down a measurement's vantage point — "non-Canadian egress" meant Egypt, and reading it loosely cost three days. |
| **Sport Chek** | A sibling banner's loyalty footer steals detection. A pattern id with no store record ends the scan. curl is not Node. The receipt's identifier may not address the catalogue at all. |
