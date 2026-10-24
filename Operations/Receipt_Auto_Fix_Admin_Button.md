# Admin · Receipt review — "Fix automatically" (Gemini)

> **What it is:** a button on the admin receipt screen (Admin → Receipt review → a receipt → *Correct this
> receipt* → **Fix automatically (compare with the receipt)**) that asks Gemini to compare the stored lines with the
> receipt the shopper gave us, and proposes the corrected lines. It replaces opening a Claude session to write a repair
> spec for the common case: a readable receipt whose lines are wrong (coupons lost, a price misread, a fee missing, a
> total stored as an item).
>
> **It never writes on its own.** The admin reads the proposal and taps **Apply the fix**, which saves through the
> same route as *Edit lines* (`POST /api/admin/receipts/:id/lines` → `lib/badScanRepair`). And **Apply is only
> offered when the server proved the proposal against the paper.**
>
> Added 2026-10-11 after `r_1791693864226_r06sa` (Vaudreuil #1213, 509.15 stored for a 480.15 paper —
> `Technical/Receipt_Parser_Root_Causes.md` RC-1/RC-2), which this button would have fixed in one tap.

Code: `backend/lib/receiptAutoFix.js` (proposal + checks), route `POST /api/admin/receipts/:id/auto-fix` in
`backend/server.js`, panel `AutoFixPanel` in `src/screens/AdminReceiptDetailScreen.js`, copy in
`src/services/adminAutoFix.js`. Tests: `backend/tests/receiptAutoFix.test.js` (built on the r06sa receipt),
`__tests__/adminAutoFix.test.js`, `__tests__/adminReceiptDetailScreen.test.js`.

---

## 1. Using it

1. Open the receipt. If the stored total is not the TOTAL on the paper (or a line looks wrong), tap
   **Fix automatically**. It takes 5–20 s (one Gemini call).
2. Read the panel:
   - **Headline** — *Ready to apply: N changes. Total $509.15 → $480.15.* / *Not safe to apply automatically* /
     *The stored lines already match the receipt.*
   - **Changes** — one line per changed, added or removed line, e.g.
     `STRAWBERRIES (27003): $9.99 → $7.99 (coupon −$2.00)`.
   - **Why** — Gemini's one-sentence reason per change.
   - **Safety checks** — ✓ / ✗ per check (§2), with the figures.
   - **Source** — the model, and whether it read the receipt file or only the OCR text.
3. Then one of:
   - **Apply the fix** (only when every check passed and the dry run succeeded) → confirm → the lines, price points,
     total and tax are replaced in one transaction, the receipt is stamped *admin reviewed*, the watch registration is
     rewritten — exactly what *Edit lines* does. The shopper's app picks it up on its next sync. No shopper notice is
     drafted and the parser-optimisation flag is left alone (a readable receipt the parser misread is a fixture
     candidate).
   - **Review in editor** → the line editor opens **on the proposal**; correct what the checks flagged, then
     *Replace the lines* (the editor's own reconciliation rule still applies).
   - **Close** → nothing changes.
4. **Name the root cause** in `Technical/Receipt_Parser_Root_Causes.md` and add the receipt to its case table — the
   standing rule applies to button repairs too. Then add a row to the runbook log
   (`Bad_Scan_Receipt_Repair_Runbook.md`).

## 2. Why it is safe: the checks

Gemini's answer is treated as a claim. The server computes these itself (`checkProposal`), against the receipt's
**own OCR text**; Apply needs all of them:

| Check | Rule |
|---|---|
| Lines + tax add up to the total | Σ lineTotal + tax = total, to the cent — the repair tool's own rule |
| Total is the one printed | the total equals the `TOTAL` read from the OCR text (or, if no TOTAL label was read, the amount is at least printed). A labels-first block (`SUBTOTAL` / `TAX` / `**** TOTAL`, then the three amounts) is zipped in order (2026-10-21) |
| Lines add up to the printed subtotal | when a `SUBTOTAL` / `SOUS-TOTAL` / `TOTAL PARTIEL` was read |
| Tax is the one printed | when a `TAX` / `TAXES` amount was read |
| Every item number is printed | each SKU is a digit run of the OCR, or the tail of one (a coupon ref that lost its slash, `39519127003`) |
| Every price and coupon is printed | each pre-coupon price (or its unit price on a multi-unit line) and each coupon amount appears in the OCR |
| Claimed lines are left as they are | a claimed line keeps its SKU and amount |
| Item count *(information only)* | units vs the printed `ITEMS SOLD` — registers count differently, so it never blocks |

Then the server **dry-runs** the save through `lib/badScanRepair` (rolled back): a line with a price-drop push, a
missing device hash, etc. turns Apply off and the headline says why.

So Gemini can *find* a lost coupon or a misread price, but it cannot invent a number the paper does not print, nor
make a receipt add up to anything but its printed total.

**Names never change.** A line whose item number is already on the receipt keeps its stored name and its fee flag
(the repair tool renames a product to the spec's name — right for a hand-read spec, wrong for an LLM's spelling).
Only a line the scan lost entirely takes the name Gemini read; a fee name (DEPOSIT, CONSIGNE, ECO FEE, ECOFRAIS,
ENVIRO FEE) is filed as a fee.

**The parser's rules apply to Gemini (2026-10-21, Bugs #338).** `backend/lib/receiptLlmRules.js`, shared with
`/api/ocr-llm`, enforces them in code, not only in the prompt:

- every name, stored or read, goes through the parser's banner scrub: a stored `PAY STATION PICKEREL` is proposed as
  `PICKEREL`;
- a line that is noise or a totals label (`SUBTOTAL`, `TAX`, a banner) is dropped, unless the receipt already stores it
  under an item number;
- a repeated item number is **one line only when every unit cost the same** (the parser's `pushOrMergeItem` rule). Two
  packs of a weighed item at different prices (`39602 PICKEREL` 23.30 and 20.85) stay two lines; a proposal that merges
  them fails *Every price is printed* (44.15 is not on the paper).

## 3. What Gemini gets

- The receipt **file** inline (the photo, or the PDF) when it is stored and ≤ 8 MB — so it reads the paper, not only
  our OCR of it. Otherwise text only (the panel says which).
- The OCR text **with the parser's noise removed** (`receiptLlmRules.denoiseReceiptText`: the shared EN cleanup incl.
  `***…***` banners, then Costco's French banner list) and the header OCR. The checks still read the full stored OCR.
- The stored lines (SKU, name, quantity, paid, pre-coupon, fee flag) and the stored total/tax.
- The parser's rules (`PARSER_RULES_PROMPT`: denoise first, only the item and totals blocks, a name is only the words
  after its item number, same SKU + same unit price = one line, different amounts = separate lines, never compute a
  tax or a total).
- A system prompt with the Costco coupon shapes (`/<sku>`, `/MULTIPLE`, a slash-less ref, `TPD/`), the `N @ price`
  quantity line, fee lines, tax flags, and the hard rules (every number printed; lines = SUBTOTAL; SUBTOTAL + TAX =
  TOTAL; unreadable → keep the stored line).
- Structured JSON output (`responseSchema`), temperature 0.

Nothing about the shopper (name, email, member number) is sent.

## 4. Configuration and cost

| Setting | Where | Default |
|---|---|---|
| `GEMINI_API_KEY` | Railway variables (already set for `/api/ocr-llm`) | — primary key |
| `GEMINI_API_KEY_FREE` | Railway variables | — the **free backup**: a key from an AI Studio project with **no billing attached** (it can never charge). Tried when the primary has no credit (402) or is over quota. Neither key set → *"not configured"* (503) |
| `GEMINI_RECEIPT_FIX_MODEL` / `GEMINI_MODEL` | Railway variables (optional) | unset = **automatic**: the newest stable `gemini-N.M-flash` the key lists, then the newest `-flash-lite` |

**The model is picked automatically** (`backend/lib/gemini.js`, shared with `/api/ocr-llm` and the flyer fallback):
the key's model list is read (cached 6 h), and the newest stable flash wins; preview / image / tts variants are never
picked. A retired model (404) is skipped and the next-newest is tried in the same request; a quota hit (429/503) moves
to the next model (flash-lite has its own free quota); no credit (402) moves to the free backup key and pauses the
primary for an hour. A pinned model that Google retires falls through to the automatic pick. Nothing to edit when
Google retires a model — this is what broke on 2026-10-17 (Bugs #335).

**Free tier caveat:** on a key with no billing, Google may use what it is sent (receipt photo + OCR text) to improve
its products. `/health?token=` → `ocrLlm.lastCall` shows which model and key last answered, or every refusal.

Each tap is **one** Gemini request counted against the shared daily Gemini budget (`LLM_GLOBAL_DAILY_LIMIT`, the same
counter as `/api/ocr-llm`); when it is spent the button says so and the admin edits by hand. Admin-only, under the
desk's rate limit (`ADMIN_DESK_RL`).

## 5. When it says no

| Panel says | Meaning | Do |
|---|---|---|
| *Not safe to apply automatically* + a ✗ check | Gemini's answer doesn't prove out against the paper | *Review in editor*, fix the flagged line(s) from the photo, save |
| *Checks passed, but the save would be refused: … claimed …* | a line has a claim / a charged push | runbook §2 `keepItemIds` (CLI) |
| *Gemini found nothing it could prove* | no change it could back with printed numbers | bad photo? → runbook (bad scan) |
| *not configured* / *daily capacity* / *rate limit* | key unset / budget spent / Gemini 429 | edit by hand, or try later |
| *Gemini has no credit left and no free backup key answered* | every key answered 402 | set / fix `GEMINI_API_KEY_FREE`, or top up; edit by hand meanwhile |
| *No Gemini model is available to this key* | every model tried answered 404 | check the key's project in AI Studio |
| *Gemini could not read this receipt* | other upstream error (5xx, bad answer) | edit by hand; Railway log line `[admin] receipt auto-fix failed:` lists every attempt |

A **bad photo** (unreadable, crumpled) is still the runbook's job: the button can only prove numbers the OCR text
holds.

## 6. Old app builds

New admin-only route; no shopper build calls it, and no existing route or field changed. The button ships with the
next binary (the admin console is in the app); an admin on an older build simply doesn't see it. Apply uses the
existing `/lines` route unchanged. The line editor now keeps a fee line's fee flag when it saves (it used to drop it,
re-filing a deposit as a watched product) — client-side, same request shape (`ignored` was already accepted).

## 7. The same reading, for every receipt (2026-10-23, Priceback #482–#484)

*Fix automatically* is now one of three users of the same Gemini reading:

| Who | When | Applies through |
|---|---|---|
| *Fix automatically* (this button) | an admin asks, on any receipt | the desk's line editor → `POST /api/admin/receipts/:id/lines` (`badScanRepair` mode `admin`: stamps the review, may rename, drafts the notice) |
| **Gemini reads first** | the app, at scan time (build after 3.1.3) | the phone keeps Gemini's lines only when proven; nothing on the server |
| **Gemini re-reads** | the server, within 30 min of an upload the phone did not let Gemini read | `badScanRepair` mode `reread`: no review stamp, no rename, no notice; refused whole by any line with history |

All three read the parser's lines as the draft and prove the answer with the same checks (§2). Every one of them now
follows **design rule 9** (`Technical/Receipt_Parser_Design_Rules.md`): two lines of one SKU at different values are
never folded. The diff the panel shows, and `history_kept`, pair a SKU with the line at the **same amount** first,
so a claimed pack stays the claimed pack.

The repair it applies (#483) also keeps what the scan proved about each line (tax class, barcode, a database price,
a watch the shopper turned off), treats a price-drop review row as history like a claim, and matches a kept line by
its order among the live lines (a line the shopper deleted no longer makes the save fail).

