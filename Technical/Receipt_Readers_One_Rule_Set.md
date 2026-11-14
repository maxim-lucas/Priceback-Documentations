# Receipt readers — one rule set for every reader

**Status:** shipped 2026-11-12, hotfix `hotfix/receipt-readers-one-rule-set` (Priceback). No migration, no flag changed.

**The rule (Maxim, 2026-11-12):** *"all parsers (local, Gemini paid, Gemini free tier, future ocr, ...) has always the
same behavior, logic and rules and these rules should be centralized without any regression for today's behavior."*

A receipt's lines can be read by several readers. Whoever reads, the same rules decide what the reader is given, how
its lines are named and grouped, whether the paper proves the reading, and whether it replaces the parser's. Each rule
has **one definition**. This page maps every rule to that definition.

---

## 1. The readers, in the order they are asked

| # | Reader | Where it runs | Key | State today |
|---|---|---|---|---|
| 0 | **The parser** | on the phone | — | Always reads first. It reads the store, the warehouse, the date, the refusals, and the **draft** every other reader is given. It is the reading every fallback keeps. |
| 1 | **Gemini, paid key** | server | `GEMINI_API_KEY` | Out of credit (HTTP 402) since October. A key that answers 402 is skipped for an hour. |
| 2 | **Gemini, free key** | server | `GEMINI_API_KEY_FREE` | **The fallback of the first.** The only AI reader answering in production today. |
| 3 | **Groq** (`openai/gpt-oss-120b`) | server | `GROQ_API_KEY` | Free tier, text only. Off until its key is set (#576, 2026-11-13). |
| 4 | **Cloudflare Workers AI** (`llama-3.3-70b-instruct-fp8-fast`) | server | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | Free tier, text only. Off until its key is set. The account id is the one R2 uses (`lib/cloudflareAccount`; `R2_ACCOUNT_ID` is no longer read). |

Readers 1 to 4 are **AI readers**. They sit behind one module, `backend/lib/receiptReaderProviders.js`. A reader that
cannot answer hands what is left of the caller's time to the next one.

**The order is measured (#579, 2026-11-13).** Maxim: *"Flash lite if it is frequently unavailable compared to the new
AI we added then they can become before flash lite."* The table above is the order of a fresh process. After that:

- Each reader's last outcomes are kept in the process: answered, or refused (quota, overloaded, timeout, an empty or
  malformed answer, no credit). At most 20 per reader, none older than 6 hours. Our own bad request and a missing key
  are not outcomes.
- A reader is asked before the one in front of it only when it is measured to answer **at least 25 points more
  often**. Fewer than 4 asks is not a measure: the reader counts as answering and keeps its place.
- **A reader whose paid key can answer keeps its place**, whatever was measured. It is the only one sent the photo.
  For Gemini that is: `GEMINI_API_KEY` is set and not paused for no credit. Today the paid key is out of credit, so
  Gemini is measured like Groq and Cloudflare, and what is measured is its free key.
- On the free Gemini key a receipt read asks **Flash-Lite first** (`backupLiteFirst`, set by the Gemini adapter). The
  flyer scan does not set it and keeps Flash first.
- Best of two (`askEach`) takes its two readers from the same order.
- One definition: `receiptReaderProviders.orderFor`. `/health` shows it under `checks.llm.readers[]`: `position`
  (1 = asked first, null = not asked) and `availability` `{ asked, answered }`.

A deploy or a restart starts again from the table's order. The 6 hours mean a reader whose daily quota ran out is
tried in front again within the day; if it still refuses, four asks later it is behind again.

Who calls an AI reader:

| Caller | Route / job | Draft it sends | Photo sent | Tries |
|---|---|---|---|---|
| The phone's scan, *Gemini reads first* | `POST /api/receipts/gemini-read` | the parser's reading | never | 1 |
| The server re-read | after `POST /api/receipts` | the stored lines | never | 1 |
| The desk's *Fix automatically* | `POST /api/admin/receipts/:id/auto-fix` | the stored lines | to the **paid** key only, when stored; the free key reads the text (§7.4, decided 2026-11-12) | up to 3 |
| The old reconcile (builds from 2.8.3) | `POST /api/ocr-llm` | none | never | 1 |

Both switches (`RECEIPT_GEMINI_FIRST`, `RECEIPT_GEMINI_REREAD`) are **off** in production. This hotfix does not turn
them on.

---

## 2. The rule map — one definition each

| Rule | The one definition | Who calls it |
|---|---|---|
| **Reader codes** (`parser`, `parser_checked`, `gemini`, `gemini_reread`) | `shared/receiptReaders.js` → `READERS`, `READER_CODES`, `PHONE_READER_CODES` | the phone's scan and upload, `receiptsRepo`, the re-read, `badScanRepair`; the seed's lookup rows are checked against it |
| **An AI reader already judged this receipt** | `shared/receiptReaders.js` → `wasReadByAi` | the upload route, the re-read |
| **Which receipt an AI reader may read** (a processed Costco in-warehouse purchase, not a refund, with at least 20 characters of OCR) | `shared/receiptReaders.js` → `aiReadRefusal` | the phone (`geminiReader.isGeminiReadable`), the re-read (`receiptGeminiReread`) |
| **Which draft line a reader's line is** (same item number and amount first, then the item number, one to one) — decides which line keeps the scan's tax class and barcode | `shared/receiptReaders.js` → `matchDraftLines` | the phone's adoption, the re-read |
| **How long the phone waits, and the server's cut inside it** (30 s / 25 s) | `shared/receiptReaders.js` → `PHONE_AI_READ_WAIT_MS`, `SERVER_AI_READ_TIMEOUT_MS` | the phone, both server reads |
| **How an AI reader is reached** (provider order, time handed on, one failure vocabulary, JSON parsing) | `backend/lib/receiptReaderProviders.js` → `ask`, `askJson` | every receipt read: `/api/ocr-llm`, the phone's read, the re-read, the desk |
| **What a tier is sent** (a free tier: the text only, never the photo or the PDF) | `backend/lib/receiptReaderProviders.js` → `requestFor(tier, request)`, `sentImage` | the chain, for a reader with one tier; Gemini's adapter, once per key |
| **What a reader is given** (the OCR with the parser's noise removed, EN + FR) | `backend/lib/receiptLlmRules.js` → `denoiseReceiptText` (vocabulary: `shared/ocrCleanup`, `shared/costcoReceiptNoise.fr` — the parser's own lists) | both prompts |
| **The parser's rules, as a reader is told them** | `backend/lib/receiptLlmRules.js` → `PARSER_RULES_PROMPT` | both prompts |
| **How a line is named** (banner scrub, noise and totals labels are never items) | `backend/lib/receiptLlmRules.js` → `cleanItemName`, `isNoiseItemName` | both answer normalizers |
| **How lines are grouped** (same item number + same unit price = one line; two amounts are never one line) | `backend/lib/receiptLlmRules.js` → `groupSameUnitPrice`, the twin of the parser's `pushOrMergeItem` | both answer normalizers; pinned to the parser by `__tests__/receiptReadersParity.test.js` |
| **What an item number is** (2 to 12 digits) | `shared/itemNumber.js` | the parser, the checks, the normalizer, the repos |
| **What the paper prints** (SUBTOTAL / TAX / TOTAL / items sold, each from its own section) | `shared/receiptPrintedFigures.js` over `shared/costcoReceiptSections.js` | the quality check, the reading confidence, every proof |
| **The checks on a reading** | `shared/receiptChecks.js` → `evaluateReading` | the quality check (phone and server), the reading confidence, every proof |
| **The proof of an AI reading** (no blocking check fails) | `backend/lib/receiptAutoFix.js` → `checkProposal` | the phone's read, the re-read, the desk, `/api/ocr-llm` |
| **Which of two readings is better** (proven first, then more checks passed, then fewer changes) | `backend/lib/receiptAutoFix.js` → `betterTry` | the desk's retries (and best-of-two, next round) |
| **When an AI reading replaces the parser's** (only when proven) | the server's `proven`; the phone adopts on it (`geminiReader.adoptGeminiReading`), the re-read applies on it | the phone, the re-read |
| **How sure we are of a stored reading** | `backend/lib/receiptAutoFix.js` → `readingConfidence` | the desk badge, the app's approval |
| **The one write path for lines** | `backend/lib/badScanRepair.js` | the desk's Apply, the re-read, the quantity check |
| **One AI read = one unit of the day's budget** | `backend/server.js` → `reserveAiRead` | all six call sites |

A new rule about readers goes into the module that owns its row. A second copy of any row is a bug.

---

## 3. What this hotfix changed

Most of the proof was already one piece of code (rules 10 to 13 of `Receipt_Parser_Design_Rules.md`, 2026-10-29).
The audit found **eight places where a reader still carried its own copy of a rule**. Two of the copies had already
drifted.

| # | What was written twice (or more) | Where | Now |
|---|---|---|---|
| 1 | The reader codes | the phone's `geminiReader`, the phone's upload, `receiptsRepo`, the re-read, the upload route, `badScanRepair`, the seed | `shared/receiptReaders.js`; the seed is pinned to it by a test |
| 2 | "An AI reader already read it" | the re-read (three codes) and the upload route (two codes) | `wasReadByAi` |
| 3 | Which receipt an AI reader may read | the phone and the re-read, with different shortest-OCR rules (20 characters / any) | `aiReadRefusal` |
| 4 | Which draft line a reader's line is | the phone's adoption and the re-read | `matchDraftLines` |
| 5 | The paper a proof reads | the phone's read and the desk read the footer OCR; **the re-read did not** | the re-read passes `footerOcr` |
| 6 | How Gemini is called | `receiptAutoFix.callGemini` and `server.js callGeminiForReceipt` each built their own request and parsed their own JSON | `receiptReaderProviders.askJson` |
| 7 | The day's budget reservation | six inline copies in `server.js` | `reserveAiRead` |
| 8 | The 25 s cut "under the phone's 30 s wait" | a literal on the phone and two on the server | two shared constants |

**The provider seam is the piece that makes a third reader safe.** A provider only transports: it gets the request
every reader gets (system prompt, user text, optional image, the answer's schema) and returns the answer's JSON. It
never sees a rule. `tests/receiptReaderProviders.test.js` gives the same answer to Gemini's paid key, to its free key
and to a reader that is not Gemini, and requires the same lines, the same checks and the same verdict from all three.

### No regression

- The Gemini request is byte for byte the one both prompts always sent (pinned by a test).
- No prompt, schema, temperature, timeout or retry changed. `lib/gemini` (models, rounds, the paused key, the hung
  model) is untouched.
- No route, request field or response field was removed or changed. Three fields are new and additive: the desk's
  `source.tier` (`"paid"` or `"free"`: which Gemini key answered), `e.providers` on a failure, and `quotas` in
  `/health`'s Gemini key status (§7.2).
- The two behaviour differences, both on the re-read, which is **off** in production:
  1. its proof now reads the footer OCR too (the paper the desk's badge already reads);
  2. a stored receipt with under 20 characters of OCR is `no_ocr` instead of being sent to Gemini.

### What still differs on purpose

`POST /api/ocr-llm` is the reconcile every build since 2.8.3 calls. It keeps its own prompt, its own schema and its
own answer normalizer (`receiptLlmRules.applyRulesToLlmItems`), because its wire shape is frozen for those builds. It
shares everything else: the denoise, the name scrub, the grouping, the proof, the provider chain and the budget.

Its normalizer differs from the reader's (`receiptAutoFix.normalizeProposal`) in three edge cases:

| Edge case | `/api/ocr-llm` | The reader (phone's read, re-read, desk) |
|---|---|---|
| A line whose name is only noise, with an item number | kept, named `Item <number>` | dropped unless the draft already stores that number |
| An item number that is not 2 to 12 digits | kept as sent | set to none |
| A line at 0.00 or below | kept | dropped |

Folding them changes what one of the two paths returns, so it is a decision, not a refactor. It goes away with
best-of-two (§7.1): a current build then never needs `/api/ocr-llm`, which stays as a labelled shim for old builds.

---

## 4. Tests that pin it

| Test | What it requires |
|---|---|
| `backend/tests/receiptReaderProviders.test.js` | the Gemini request is unchanged; the free key is the fallback of the paid key and reads the same reading; **a free tier is never sent the image** (the paid key gets it, the free key gets the same text without it, a later free reader is handed the text by the chain); a non-Gemini reader given the same answer yields the same reading; the chain hands time on; one failure vocabulary; no receipt path calls `lib/gemini` directly; the budget is reserved in one place |
| `backend/tests/receiptReaders.test.js` | the codes are one list (seed, repo, shared); `aiReadRefusal`, `matchDraftLines`; the re-read's skip reasons, its footer OCR, its carry-over; no reader code spelled out where a rule is decided |
| `__tests__/receiptReadersParity.test.js` | loads the backend next to the app: the phone's scan and the server's re-read agree on which receipt may be read for all 48 combinations of the facts; both carry the same tax class to the same line; **an AI reader's lines are grouped exactly as the parser groups the same printed lines** |
| `__tests__/sharedMirrorParity.test.js` | `shared/receiptReaders.js` and `backend/shared/receiptReaders.js` are byte-identical |

---

## 5. Adding a reader

1. Write one adapter with this contract and add it to `PROVIDERS` in `backend/lib/receiptReaderProviders.js`, after
   Gemini:
   - `id` (what `source.provider` says), `label` (how a failure names it);
   - `tier`: `"free"` or `"paid"`, for a reader with one tier. The chain then hands it `requestFor(tier, request)`,
     so a free reader's adapter never holds the image;
   - `ask(request, opts)` → `{ text, model, tier, sentImage, usage: { input, output, cached } }`;
   - it throws an `Error` with `.status` and `.code` in `lib/gemini`'s vocabulary (`no_provider`, `quota`,
     `overloaded`, `no_credit`, `no_model`, `timeout`, `empty_answer`, `bad_request`, `upstream`), so the desk words
     the failure the same way.
2. Translate the answer schema to the provider's dialect inside the adapter. Gemini takes its own OpenAPI-style
   schema; an OpenAI-compatible API takes JSON Schema. The **answer's shape stays the one shape**.
3. Change nothing else. The prompt, the denoise, the naming, the grouping, the proof and the adoption are applied by
   the pipeline to whatever the adapter returns.
4. Update `providerIds()`'s test (it lists the order on purpose) and run the parity tests.
5. State its tier. What it may be sent follows from it (§7.4): a free tier gets text only.
6. Give it its own budget in `reserveAiRead` (§7.2).

---

## 6. Measured (2026-11-12)

**Receipts in production** (`priceback.receipts`, SELECT only):

| Span | Receipts | Average per active day | Median | 95th percentile | Peak day |
|---|---|---|---|---|---|
| Last 7 days | 105 | 13.1 | 13 | 23 | 26 |
| Last 30 days | 274 | 9.4 | 9 | 17 | 26 |
| Last 90 days | 345 | 7.5 | 6.5 | 16 | 26 |

All 345 were read by the parser (no AI reader's reading was adopted: both switches are off). Since the app's approval
shipped (2026-11-06), 23 of November's 122 receipts were proven with no AI read at all.

**One AI read** is about 5,000 tokens (an estimate: the prompt and rules ~1,500, the OCR ~1,200, the draft ~700, the
answer ~1,200). Production logs carry the real figure on every `[gemini]` line (`tokens=in/out/thinking`).

**Free quotas, as found on 2026-11-12.** Only the rows marked *official* come from the provider's own page.

| Provider | Free quota | Source | Reads per day it covers |
|---|---|---|---|
| Gemini, Flash (free key) | about 20 requests a day, 5 a minute | third-party reports, October and November 2026 | about 20 |
| Gemini, Flash-Lite (free key) | about 500 requests a day, 10 to 15 a minute | third-party reports | about 500 |
| Gemini, how limits apply | per **project**, not per key; the daily quota resets at midnight Pacific; the numbers are shown per project in AI Studio | official | — |
| Groq | 30 requests a minute, 1,000 a day, 8,000 tokens a minute, 200,000 tokens a day, per model | official rate-limit page (shown as the base limits) | about 35 per model (the daily tokens bind) |
| Cloudflare Workers AI | 10,000 Neurons a day, reset at 00:00 UTC; $0.011 per 1,000 beyond | official | about 120 on an 8B model, about 24 on a 70B model |
| OpenRouter, `:free` models | 20 a minute, 50 a day; 1,000 a day once the account has bought $10 of credits, one time | official | 50, or 1,000 |
| GitHub Models | about 150 a day (low tier), 8,000 tokens in per request | third-party | about 150 |
| Mistral, free plan | limits not published; prompts may be used for training unless opted out | third-party | unknown |

This matches production: Flash answers 429 or hangs, and only Flash-Lite answers. **`LLM_GLOBAL_DAILY_LIMIT = 1400`
describes no real quota.** It is our own ceiling, set when the free tier was 1,500 a day.

---

## 6b. Best of two, mixed item by item — shipped (#576, 2026-11-13)

**Maxim, 2026-11-13:** *"Best of the two responded AI parsers + local parser. also we can mix and match if needed
between few results to get the best of each reader."*

| Rule | The one definition |
|---|---|
| **Two readers at once** — the first two configured readers in `PROVIDERS` order, each with the caller's full time; a reader that fails hands its slot to the next (with what is left of the time, not under 5 s); a reader with no key is skipped | `receiptReaderProviders.askEach` |
| **Each extra reader is one unit of the day's budget** (the caller paid for the first) | `askEach`'s `reserve` → `server.reserveAiRead` |
| **The parser's reading competes** with every answer | `receiptAutoFix.storedReading` |
| **The mix** — per item number (each reader's version of it: its lines, or none), every combination while there are at most 256, each with each reading's printed TOTAL / TAX; the one reader who read a coupon right can replace a wrong line the other two agree on | `lib/receiptReadingMerge.candidates` |
| **Which candidate wins** — proven first, then more checks passed, then more agreement, then fewer minority versions, then a reading as it came over a mix, then fewer changes | `receiptReadingMerge.better` |
| **The proof** is the one every reading goes through; a mix is applied only when proven | `receiptAutoFix.checkProposal` |
| **Who read it** — `source.provider` (`gemini`, `the parser+groq` …), `source.mixed`, `source.from`, `source.readers` (who answered, proven or not, who refused) | `receiptAutoFix.proposeFromSeveral` |

Callers: the desk's *Fix automatically* (`readers: 2`, then up to 2 retries with one reader each, every answer kept in
the pool), the phone's *Gemini reads first* and the re-read (`readers: 2`, one round, 25 s). `readers: 1` (the default)
is the single reader of before. Both phone switches stay off in production.

Proven on production's `afuor` (Nepean #540): reader A misses LIQUID IV's coupon, reader B and the parser miss
CRMYDILLPCKL's — no reading closes, the mix closes to the cent (`backend/tests/receiptReadingMerge.test.js`).

**Item numbers from the database** (same PR, RC-53): a line with no readable number is matched on the digits printed
for it first, in their positions, then on its name; when not clearly one product it keeps no number
(`services/catalog/skuMatch.choosePositionalMatch`).

## 7. Recommendations for the next round

### 7.1 Ask an AI reader only when the parser's reading is not proven (best of two)

Today *Gemini reads first* would send every scan. The cheaper rule, and the one that fits every free quota:

1. The parser reads. Its reading is judged by the same checks (`evaluateReading`).
2. Every check passed → keep it, no AI read.
3. Otherwise → one AI read with the parser's reading as the draft. Keep the better of the two by the one comparison
   (`betterTry`): proven first, then more checks passed, then fewer changes.

It needs the checks on the phone before the call (they are already in `shared/`), and it replaces the old
`/api/ocr-llm` reconcile in new builds. At today's volume it is 5 to 15 AI reads a day instead of 10 to 26.

### 7.2 Budget per reader, from the measured quota

- **Shipped with this hotfix (measurement only):** Google states the quota it refused on in every 429
  (`QuotaFailure.violations[].quotaValue`). `lib/gemini` keeps it per key and model, and `/health` shows it under
  `checks.llm.keyStatus.primary.quotas` and `.backup.quotas` (`{ model, quota, limit, at }`). After a few days of
  production the real numbers of Maxim's own project are there, in place of the invented 1,400. Nothing is decided on
  them yet.
- Next: `reserveAiRead` takes a budget per reader (the paid key, the free key, the third reader), each from its
  measured quota, in place of one number for all.
- On the free key, ask **Flash-Lite first**. Flash's 20 a day are gone by mid-morning, and every later call pays a
  refused round trip (or a 90 s hang) before Flash-Lite answers. **Shipped in #579 (Maxim, 2026-11-13: "yes")**, for
  receipt reads; with it, the readers are asked by measured availability (§1).

### 7.3 The third reader

All four call paths except the desk send **text only**, so the third reader does not need vision. It needs a JSON
schema answer and a daily quota.

| Rank | Reader | Why | Limit |
|---|---|---|---|
| 1 | **Groq** (`openai/gpt-oss-120b`, then its other models) | OpenAI-compatible, strict JSON schema, answers in 1 to 3 s, three models with their own quotas | about 35 reads a day per model, about 100 across three |
| 2 | **Cloudflare Workers AI** | already a vendor (R2), one account, no new contract | about 24 reads a day on a model large enough to read coupons |
| 3 | **OpenRouter** `:free` | 1,000 a day across many models after a one-time $10 | not free on day one; free endpoints may log prompts |

With §7.1 in place, Gemini Flash-Lite (about 500 a day) plus Groq (about 100) covers roughly 40 times today's need.
No single free tier other than Flash-Lite covers growth alone, which is why the chain matters and why the proof makes
it safe: a weaker model's wrong reading is unproven, and the parser's stands.

Do not create a second Google project to double the free quota: limits are per project, and splitting usage across
projects to get around them is against Google's terms.

### 7.4 What a free tier may be sent — decided 2026-11-12: text only

A free tier may use what it receives to improve its products. The phone's read and the re-read send the **OCR text
with the member line and the payment block removed**. Until 2026-11-12 the desk's *Fix automatically* sent the
**photo** (member number, card digits) to whichever key answered, the free one included. The recommendation was: a
free tier gets text only. Maxim: *"yes"*.

**Shipped (hotfix `hotfix/free-tier-text-only`):**

- The rule is `receiptReaderProviders.requestFor(tier, request)`: for a free tier the request loses its image and
  nothing else (same prompt, same OCR text, same schema).
- Gemini's adapter builds one body per key: the paid key (`GEMINI_API_KEY`) is sent the whole request, the free key
  (`GEMINI_API_KEY_FREE`) the text. `lib/gemini.generateContent` takes the second body as `backupBody`; without it
  both keys get `body`, so the flyer scan and every text-only read send what they always sent.
- A later reader states `tier: "free"` and the chain strips the image before its adapter is called.
- The desk says which it was: `source.usedImage` is true only when the reader that answered was sent the image
  (the existing line *"read the receipt file and the OCR text"* / *"read the OCR text only"*).

**What it costs today.** The paid key is out of credit, so every *Fix automatically* is answered by the free key
and now reads the text only. A fix that needs the photo (a line the OCR did not read at all) is no longer found by
the free key; it waits for the paid key or a person. The proof is unchanged, so nothing wrong is applied.

**Which key is "free".** The tier follows the variable, not the account: `GEMINI_API_KEY` is treated as paid and
`GEMINI_API_KEY_FREE` as free. A free-tier key put in `GEMINI_API_KEY` would be sent photos.

### 7.5 A smarter app approval

Today the app approves a receipt when every check passed and it is not a copy. Each addition below is a check in
`shared/receiptChecks`, so the quality check, the reading confidence and the proofs share it:

| Check | What it catches |
|---|---|
| The payment amount equals the TOTAL (the Payment section prints it again) | a total read from the wrong block |
| The purchase date is read from the header and from the register footer, and the two agree; it is not in the future | the cropped copy of 2026-11-11, whose date was read six days late |
| The warehouse is a known one | a header misread |
| The tax is possible for the province and the taxed lines | a tax misread that still closes |
| **Two readers agree** (the AI reader's proven reading equals the parser's) | lets the app approve a receipt whose items-sold count is unread, which today always waits for a person |
| The same paper on another account | a shared receipt |

**Decided 2026-11-13 (Maxim: "yes" to all). Two shipped in #579, four are their own PRs:**

| Check | State | Notes |
|---|---|---|
| Purchase date | **Shipped**: `date_on_paper` | The register stamps a date with its time several times (payment, summary, footer). Pass: every stamp prints the purchase date, or at least two do and they outnumber the rest (OCR misreads a digit of one stamp now and then). Fail: no stamp prints it, or it is after the owner's today (`shared/trackingTime`). Unverified: no stamp in the photo, no date read, or one stamp against one. A year-last stamp (`03/09/2026`) is read both ways. A date without a time is not a stamp. |
| Tax possible | **Shipped**: `tax_possible` | The tax is at most the province's rate × the lines, plus a cent per line; never negative on a purchase. The province is the warehouse's (`taxProvince`); unknown is judged on 15 %. One rate table, `shared/salesTax` (the phone's validator re-exports it). It does not use the tax codes of each line yet, so it catches an impossible tax, not a slightly wrong one. |
| Payment amount equals the TOTAL | Not built | The compliance cleanup removes the payment lines before the text is stored, and on most receipts the amount goes with its label. The stored text cannot answer it. It needs the phone to read the amount before the cleanup and send it (a new optional field, a new build). Where the amount does survive, it is now used the other way: a TOTAL one digit off is taken from it (RC-56). |
| Warehouse is a known one | Not built | The reference list is the phone's `src/constants/costcoWarehouses.js` (a frozen Costco file). The server's `warehouses` table is filled from receipts, so a misread creates the warehouse it is checked against. Needs the list moved to `shared/`. |
| Two readers agree | Not built | Needs the AI reading's agreement with the parser stored with the receipt, and changes what the app may approve (an unread items-sold count). |
| Same paper on another account | Not built | `lib/duplicateReceipt` compares one shopper's receipts. Across accounts it needs a fingerprint column and an index (a migration). |

Both shipped checks run for a **Costco warehouse** receipt only (`readingConfidence`), are counted in "n of n", and
inform a Gemini proof without blocking it. Measured on 268 captures (every store, before the two-of-three rule for a
misread stamp was added): the date passes on 195 and fails on 3, all Best Buy online orders (the order date against
the invoice date, which is why another store is not judged). 12 have no stamp in the photo, 5 had stamps that
disagreed, and on 53 the parser read no date. The tax passes on all 268.

---

## 8. Sources (read 2026-11-12)

- Google, Gemini API rate limits: <https://aistudio.google.com/docs/rate-limits>
- Groq, rate limits: <https://console.groq.com/docs/rate-limits>
- Cloudflare, Workers AI pricing: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- OpenRouter, limits: <https://openrouter.ai/docs/api-reference/limits>
- Third-party, Gemini free tier in October and November 2026:
  <https://imisofts.com/blog/gemini-api-free-tier-limits/>,
  <https://www.aifreeapi.com/en/posts/google-gemini-api-free-tier>,
  <https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits>
- Third-party, free LLM tiers compared: <https://openrouter.ai/blog/tutorials/free-llm-apis-compared/>,
  <https://dev.to/tariqnasser/free-llm-api-tiers-in-october-2026-whats-left-and-how-i-chain-them-227l>,
  <https://github.com/mnfst/awesome-free-llm-apis>
