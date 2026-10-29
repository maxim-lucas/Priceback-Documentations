# Receipt desk — Gemini must balance, never split; database fill; deleted receipts

**Status:** approved by Maxim 2026-10-24 · **Date:** 2026-10-24 · **Branch:** hotfix off `main` → PR into `main`
**Trigger:** prod receipt `r_1792860056497_170i0` (warehouse 68, $325.19, read by the parser, correct and checked twice). Admin pressed *Fix automatically* to double-check it, and Gemini proposed splitting `1025480 FETA 3KG` (qty 2, $55.98 paid, $71.98 regular) into two lines "because they had different coupons". The paper prints `FETA 3KG 35.99` twice, each followed by `0000396985 /1025480 8.00-`, so both units have the same price and the same coupon. The OCR text is scrambled at that spot: Scotties' `6.00- H` coupon sits between the two Feta units.

## 1. Intent

The admin desk is where a receipt is proved right. A second opinion that makes a correct receipt wrong is worse than no second opinion. So:

- Gemini's proposal must close to the printed totals before it is offered, and Gemini gets several tries to get there.
- Gemini may never undo the parser's grouping, except for a weighed item.
- When the receipt is missing an item number, a name or a price, the database may fill the gap. The receipt always comes first; the database is used only for what is missing, and every value it supplies is tagged on its line so the admin can double-check it.
- The desk shows how confident we are, both in the stored reading and in Gemini's proposal.
- The desk can find deleted receipts and shows who deleted each one.

## 2. Goals, non-goals, anti-goals

**Goals**
1. *Fix automatically* retries Gemini until its proposal passes every check, up to a limit. If no try passes, it shows the best try with a clear "not confident" warning.
2. A hard **grouping** check: Gemini cannot split a line the parser grouped, unless the paper prints that item number at different prices (a weighed item).
3. A confidence level on the stored reading (receipt header in the desk) and on every Gemini proposal.
4. Database fill, used only when the receipt is missing the value: name from item number, item number from name (best match), price from item number. Every filled value is tagged on its line.
5. A per-line **Check database** button in the desk's line editor that forces a database lookup of the line's item number, name and price.
6. The "Database prices" chip is replaced by a **Deleted** chip on the all-accounts desk. Each deleted row shows who deleted it. The database-price information moves to a per-line tag, and those receipts stay in "Not reviewed".
7. An admin **Delete receipt** button.

**Non-goals**
- Gemini-first reading and the server re-read stay as they are: off in prod (`RECEIPT_GEMINI_FIRST` / `RECEIPT_GEMINI_REREAD` = false since 2026-10-24 18:08 UTC). No code change.
- The phone's scan review screen is unchanged. The existing shopper "Check price in database" button stays.
- No parser change. This is the desk and the server, not extraction.

**Anti-goals (a failure even if it "works")**
- A proposal that splits a correctly grouped line, or that adds a coupon the paper doesn't print, being offered as "Ready to apply".
- A value from the database overwriting what the receipt printed.
- A guessed item number causing a price-drop push or a commission charge before an admin has seen it (see §6.4).
- An installed build (2.8.3 → 3.1.4) seeing anything new break: an error, a missing receipt, a blank label.

## 3. Constraints

- **Backend backward compatibility** (CLAUDE.md): additive only. New request fields are optional. The `database_prices` filter value keeps working for the 3.1.4 desk. Migrations are additive and idempotent, and are applied to prod before the code that needs them.
- **One write path for receipt lines**: `POST /api/admin/receipts/:id/lines` → `lib/badScanRepair`. The new button and the database fill in a proposal go through it. Nothing else writes lines from the desk.
- **DB design rules**: lookup table + FK for any fixed set of values, numeric money, and no column without a writer and a reader on day one.
- **Admin screens** are exempt from translation but must read as plain English, never raw codes. Any shopper-visible text that changes still needs `en` + `fr`. None is planned.
- **Gemini budget**: every try is one call against `LLM_GLOBAL_DAILY_LIMIT`. Every try runs inside the desk's existing 150 s deadline (`DESK_BUDGET`).
- **Release split**: everything server-side reaches prod when the hotfix merges (a Railway deploy, which needs Maxim's go). Everything in `src/screens/Admin*` and `src/services/admin*` reaches Maxim only with tonight's build (3.1.5). The server must work with the 3.1.4 desk in the meantime: new response fields are simply ignored there.

## 4. *Fix automatically* — balance or retry (`backend/lib/receiptAutoFix.js`)

### 4.1 The retry loop (desk route only)

`proposeReceiptFix` gains an `attempts` option. Only `POST /api/admin/receipts/:id/auto-fix` passes it (default **3**). `receiptGeminiReader` keeps exactly one bounded try (25 s, phone-facing, currently switched off).

```
try 1: today's prompt
  → normalise → database fill (§6.2) → checks
  applicable?  → done
  otherwise:
try n+1: the same prompt, plus a "Your previous answer failed these checks" block
         that lists each failed check's key and detail in plain English
         (e.g. "lines add to 327.21, the printed SUBTOTAL is 319.21",
          "you split 1025480 FETA 3KG into 2 lines at the same regular price;
           the parser printed it as one line, quantity 2 — keep it as one line")
         and the previous answer's lines
  … until a try is applicable, the try limit is reached, or the 150 s deadline has no room left for another call
```

- Each try reserves one unit of the Gemini daily budget. If the budget refuses a retry, the loop stops and returns the best try so far.
- A try that throws (timeout, 5xx) counts as a try. Already-tried models are not retried inside the same try; that is `lib/gemini`'s job.
- **Best try**: the first applicable one. Otherwise the one that passes the most non-advisory checks; on a tie, the one that changes the fewest lines.

### 4.2 Deterministic fallback edit

If no try is applicable, the best try gets one deterministic repair before it is returned:

- **Restore grouping**: every line Gemini split against §5's rule is replaced by the stored grouped line, with its stored values.

After the repair, the checks run again. If everything then passes, the proposal is applicable, but at **Medium** confidence, with the repair listed under "Automatic edits" (*my call*: a fully checked proposal is safe to apply, and the warning tells the admin why it isn't High). If anything still fails, the proposal is not applicable and is shown as it is today ("Not safe to apply automatically… Review it in the line editor"), with the Low confidence level.

### 4.3 Response (additive)

New fields on the auto-fix response: `attempts` (number of tries made), `autoEdits` (plain-English sentences, one per deterministic edit) and `confidence` (§7). The existing `confidence` field is Gemini's self-reported number. It is renamed in the response to `geminiConfidence`, and `confidence` becomes the object from §7. *Checked*: the 3.1.4 desk never reads `result.confidence`, so changing its meaning is safe, because no shipped build reads it. This route is admin-only.

## 5. The grouping rule (`checkProposal`, shared by every Gemini path)

New hard check **`grouping_kept`**.

For each stored line with an item number and **quantity > 1** (the parser grouped it), look at the proposal's lines with that item number:

- exactly one line → ok (its amounts are checked by the other checks);
- several lines **whose regular unit prices differ** (regular unit price = `(originalPrice ?? lineTotal) / quantity`) → ok: a weighed item, the only allowed split;
- several lines at the **same** regular unit price → **fail**: a split by coupon. Detail: `"split 1025480 FETA 3KG into 2 lines; keep the parser's single line"`.

Lines the parser kept separate are not affected. Gemini may still fold them only at the same unit cost, as today (`groupSameUnitPrice`).

Since `receiptGeminiReader` uses the same `checkProposal`, a Gemini-first read that splits a grouped line is also refused, and the parser's reading stands.

The prompt (`SYSTEM_PROMPT` and `PARSER_RULES_PROMPT`) gets the same rule in words: "A line the stored reading groups (quantity above 1) stays ONE line. Never split it because you believe the units had different coupons; split it only if the paper prints the item number at different prices (weighed items)." The 2026-10-21 sentence "one unit with its coupon beside one without stays separate" is kept only for lines the stored reading already has separate.

## 6. Database fill

### 6.1 Order of authority

1. What the receipt printed (the parser's reading, the admin's edit, or Gemini's reading of the paper).
2. Only when a value is **missing**: the database.

"Missing" means:
- **Name**: empty, `(unnamed)`, or a parser stand-in (`Item #…`, `Item <sku>`, `Unknown item`); the same test as `src/utils/receiptDatabasePrice.nameIsUnread`, ported to the server.
- **Item number**: not a real one, i.e. not 3–12 digits (`displaySku` returns null).
- **Price**: the line total is missing or 0 on a line that isn't a refund or a fee.

A value the receipt printed is never replaced, even when the database disagrees.

### 6.2 Lookups (new `backend/lib/receiptDatabaseFill.js`, pure core plus one repo read)

All lookups are scoped to the receipt's store (`products.store_id`).

| Missing | Have | Lookup | Tag on the line |
|---|---|---|---|
| name | item number | `products.display_name` for (store, sku), only when it is a real name and not a stand-in or the digits | **Name from database** |
| item number | name | **best match** over the store's products with a real SKU (normalised name similarity; see below) | **Item number from database — check it** |
| price | item number | today's database price at the receipt's warehouse, else its province (`/api/check-price`'s logic) × quantity | **Price from database** (existing flag) |

**Best match** (Maxim: "best match, with a tag so I can double-check"):
- Normalise both names: upper-case, accents and tax letters removed, punctuation becomes spaces.
- Score: character-bigram Dice coefficient, with a bonus for an exact token-set match.
- Take the highest score. *My call*: no fill below **0.6**, and none when the top two candidates are within 0.05 of each other, because a coin-flip is not a match. Both thresholds are named constants and get unit tests.
- The response and the tag carry the matched product's name and score, so the desk can show "matched *KS ORGANIC PASTE* (0.82)".

### 6.3 Where it runs

- **On save** (shopper upload `create` and the back-fill path, through `persistReceiptItems`). It reaches every installed build at once: phones take the server's lines on sync (`mergeServerIntoLocal` spreads `...sit`), so a filled name shows up on the shopper's phone after its next sync.
- **In every Gemini proposal**, after normalisation and before the checks. `skus_on_paper` skips a line whose item number came from the database. A new advisory check, `database_fill`, lists what was filled ("2 values filled from the database — check the tagged lines").
- **In the desk's Check database button** (§8), on demand.
- **Not** on the phone's scan screen (Maxim's answer).

### 6.4 Safety of a guessed item number — **decided (Maxim, 2026-10-24: keep the safeguard)**

A best-match item number links the line to a real product. That product's price drops then reach this shopper: a push, and a commission when a drop is detected (15 cr/$). Rule: an admin marks the receipt reviewed, a line whose item number came from the database files **no price point** (like `priceFromDatabase` today) and is **not watched**. Marking the receipt reviewed confirms the tagged lines and turns their watch on (if the line is otherwise watchable). Name and price fills don't need this.

### 6.5 Storage (migration `0035`, additive)

- `receipt_items.name_from_database boolean NOT NULL DEFAULT false`. Writer: database fill / desk save. Reader: desk tag, filter of §9.
- `receipt_items.sku_from_database boolean NOT NULL DEFAULT false`. Same writer and reader, plus §6.4's watch rule.
- `price_from_database` already exists (0028).
- `badScanRepair` carries all three flags through a repair, as it does `priceFromDatabase` today. The line-editor body accepts `nameFromDatabase` / `skuFromDatabase` (optional; absent = false; 3.1.4's desk never sends them).
- `getForAdmin` returns the three flags per line.

## 7. Confidence

One function, `receiptConfidence({ checks, attempts, autoEdits })`, gives `{ level: "high" | "medium" | "low", passed, of, reasons[] }`:

- **High**: every hard check passes, with no automatic edit and no database fill.
- **Medium**: every hard check passes, but an automatic edit or a database fill was needed (or Gemini needed more than one try).
- **Low**: any hard check fails.

Where it shows:
- **Desk receipt header**: the stored reading's confidence. The server runs `checkProposal` on the stored lines against the stored OCR in `GET /api/admin/receipts/:id` (new field `readingConfidence`; nothing is written). A receipt with no OCR text shows "No OCR text to check against".
- **Fix automatically panel**: the proposal's confidence badge above the changes, plus "N of M checks passed · tries: k", the automatic edits, and Gemini's own number in small print.
- The receipt list does not show it (*my call*: the list deliberately never loads the OCR).

## 8. Desk: **Check database** button (line editor)

- In `AdminReceiptDetailScreen`'s line editor, each line gets a **Check database** button.
- It calls the new admin route `GET /api/admin/receipts/:id/database-check?sku=&name=&quantity=`. It is read-only, with admin auth and the desk rate limit. It returns, for the receipt's store, warehouse and province:
  - by item number: the product name and today's database price (warehouse, else province, with the date it was observed);
  - by name: the top 3 best matches (item number, name, score, price).
- A small panel under the line shows the answer, with **Use name**, **Use item number** and **Use price** buttons that fill the editor's fields and set the matching flag. Saving is the usual **Save** (→ `POST /lines`). The button forces the lookup, so the admin may replace a printed value; that is the admin's decision and the line is tagged.
- "Nothing found" and "Database unavailable" are separate messages.

## 9. Desk list: filters, deleted receipts, admin delete

### 9.1 Chips

- **Remove** the "Database prices" chip from the desk. The server keeps accepting `status=database_prices`, because the 3.1.4 desk and its admin-home counter still send it.
- The admin-home "Database prices" counter is removed in 3.1.5. Those receipts are in "Not reviewed" already, and the tags show which lines.
- **Deleted** becomes an all-accounts chip (no longer per-account only). Bug fixed: `listForAdmin` always adds `deleted_at IS NULL` on the all-accounts desk, so `status=deleted` there could never match anything. With `status=deleted`, the live condition is not added.
- Deleted rows sort by deletion date, newest first.

### 9.2 Who deleted it (migration `0035`)

- Lookup table `receipt_deletion_types` (`id`, `code`, `label`), seeded with `owner` ("Shopper"), `owner_last_line` ("Shopper — removed the last line"), `data_reset` ("Shopper — reset their data"), `account_deletion` ("Account deletion"), `admin` ("Admin").
- `receipts.deleted_by_type_id` FK → it (`on delete restrict`), nullable: null = not recorded.
- `receipts.deleted_by_sub` FK → `users.sub` (`on delete set null`), the admin who deleted it, null for every other type.
- Every soft-delete path stamps them: `softDeleteForUser` (owner), `softDeleteItemForUser`'s empty-receipt branch (owner_last_line), `usersRepo` data reset (data_reset) and deletion request (account_deletion), and the new admin delete (admin + the admin's sub).
- **Backfill** (in 0035, idempotent): a deleted receipt whose `deleted_at` equals its owner's `data_reset_at` → `data_reset`. Everything else stays null and shows "Deleted — who not recorded". *Checked*: prod has 11 deleted receipts out of 155.
- The list row and the detail screen show "Deleted by Shopper · Oct 24, 2026" or "Deleted by Admin maxim@… · Oct 24, 2026".

### 9.3 Admin delete

- `POST /api/admin/receipts/:id/delete`: admin auth, desk rate limit, idempotent. It is the same soft delete as the shopper's (`deleted_at` on the receipt and its lines, price points kept), stamped `admin` + sub. A 409 comes back if it is already deleted.
- The shopper's phone removes the receipt on its next sync through the existing deleted-ids path (`deletedIdsForUser`). Every live build already handles a receipt deleted elsewhere.
- No notification to the shopper (*my call*).
- In the desk: a **Delete receipt** button in the detail screen, behind a confirm ("The shopper's app removes it on its next sync. Price points are kept.").

### 9.4 One pair of store-lookup buttons everywhere (Maxim, 2026-10-24)

The same two buttons, with the same logic, on **Saving dates**, **Potential price drops**, **Price drops** (the queue) and the **receipt desk** (on each line of the receipt detail):

- **Check on costco.ca**: opens `costco.ca/CatalogSearch?dept=All&keyword=<sku>`. Without a real item number it searches by name instead. Below it, where the screen knows the clubs, the hint "Set your costco.ca warehouse to: …" (Potential drops' existing text).
- **Check on Sameday**: asks `POST /api/admin/saving-dates/lookup` (existing; server-proven product page for the province), opens the proven page, else Sameday's search by item number. It shows the server's note (price, sale end), and when no page was proven, a "Search Sameday by name instead" link. The province is the screen's own: the Saving dates chip, the drop's province, or the receipt owner's province, else ON.
- **Item number first, always**: both buttons search by the real item number (3–12 digits) when there is one, and by name only when there isn't (or through the explicit "by name" link).
- One shared component (`src/components/StoreLookupButtons.js`) with the URL builders in a pure helper (`src/services/storeLookup.js`). Each screen passes `{ sku, name, provinceCode, clubs? }`, and Saving dates also gets the lookup result (`onSamedayResult`) to prefill its "Last day". Any non-Costco store hides both buttons.
- Admin-only, plain English (exempt from translation).

### 9.5 Product names review screen (Maxim, 2026-10-24, mid-build)

> "add a screen to review product names with the same buttons based on sku so i can click and the app should retrieve the real and official names in english or if the app cant i will copy paste manualy using these buttons."

- New admin screen **Product names** (Admin home → Product names), listing the store's products with a real item number. Newest first, searchable by item number or name, and filterable to *Names to check*: names the database fill tagged on any receipt line, names that are only a stand-in, and names in ALL CAPS register shorthand.
- Each row shows the item number and the current name, plus the shared **Check on costco.ca** / **Check on Sameday** buttons (§9.4, item number first).
- **Get official names**: `POST /api/admin/products/:id/official-name`. The server finds the item's Sameday page and keeps it only when the page proves the item number (`retailerReferenceCodeString`, the same proof as the Saving dates lookup), then reads the product's English name from the page's JSON-LD. Found → the name is offered in the edit field (**Save** applies it). Not found → "No official name found. Open costco.ca or Sameday and paste it below."
- **Both languages** (Maxim: "one for english and one for french … or the app retrieve both of them"): *Get official names* reads the proven page twice, as an `en-CA` and as an `fr-CA` shopper, and answers `{ en, fr }`. The row has two fields, **English name** and **French name**, prefilled with what was found and editable for pasting, each with its own **Save**.
- **Save**: `PUT /api/admin/products/:id/name { displayName, language: "en" | "fr" }` → `pricesRepo.renameProduct` (that language's slot), the one rename path. Receipts keep their printed names (`receipt_items.printed_name`); the product's label is what desks, pushes and catalogue views show.
- `scrapeSamedayProduct` gains `productName` (JSON-LD `name`, additive). The Saving dates lookup response gains `officialName` (additive) so the shared Sameday button can show it anywhere.

## 10. Old builds (rule 0–7)

| Change | 2.8.3 – 3.1.4 |
|---|---|
| Auto-fix retries, new response fields, `confidence` meaning | admin-only route; the 3.1.4 desk reads `checks`, `applicable`, `diff`, `proposal`, `explanation`, `source`, all unchanged |
| `grouping_kept` check | admin desk shows it as "Another safety check" in 3.1.4 (existing fallback label); the Gemini-first path is off |
| Database fill on save | changes only a line with a missing value; phones take server lines on sync, as for any repair; old builds ignore the new flags |
| `database_prices` filter | still accepted |
| Deleted chip / `deleted_by_*` | additive fields; the shopper bootstrap shape is unchanged |
| Admin delete | new admin route; shoppers see it as a delete from another device |

## 11. Left to the builder

- Prompt wording for the retry block, within §4.1's content.
- Exact layout of the confidence badge, the database-check panel and the deleted row, following the desk's existing styles.
- Test structure: every check, threshold and fallback gets a unit test that fails on the old code (mutation-checked), plus a DB test per delete path and the 0035 backfill. The Feta receipt becomes a fixture: Gemini's split answer must come back `grouping_kept: false`, and the restore must make it applicable at Medium.

## 12. Calls made in this document (for Maxim to check)

1. 3 tries maximum, inside the existing 150 s desk deadline.
2. A proposal that passes every check after the automatic grouping restore is applicable, at Medium confidence.
3. Best-match thresholds: 0.6 minimum, no fill when the top two are within 0.05.
4. The receipt list shows no confidence; the detail and the auto-fix panel do.
5. The admin delete sends no notification to the shopper.
6. The 3.1.4 desk keeps working against the new server; the new chips, tags and buttons arrive with 3.1.5.
