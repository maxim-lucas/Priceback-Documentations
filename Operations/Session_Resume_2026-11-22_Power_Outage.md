# Session resume — power outage, 2026-11-22 (~01:00 Toronto)

A power cut closed every open Claude Code terminal in VS Code. This page has the **final output** of each Claude Code
session that was open (or had just finished) on 2026-11-21/22. It also lists **what is left to do**, the steps the
sessions recommended, and anything they skipped. Read it before restarting work.

State checked from GitHub and the working tree at 01:05 Toronto, 2026-11-22.

---

## 0. Start here: the work the outage cut off

**Session `0703b004` — admin times on the Toronto clock, shopper times on the phone's clock.** It was mid-way through
when the power cut. The work is **uncommitted** in `C:\Users\Maxim\StudioProjects\Priceback` on branch
`fix/admin-toronto-shopper-device` (based on `b4131c1f`, today's `main`).

The 20 uncommitted files:
- `CLAUDE.md` — new standing rule "Times on screen: the shopper's own clock, the admin's Toronto clock". It is already
  written and on disk.
- `shared/displayTime.js`, with `backend/shared/displayTime.js` as its generated copy. They add `adminDay` /
  `adminDateTime` / `isCalendarLike`.
- `src/services/i18n.js` and `src/components/StockCheckButton.js`, which put shopper screens back on the device zone.
  This undoes that part of #633.
- `src/components/AccordionSection.js`, `src/services/adminAccountActions.js`, `adminReceiptView.js`,
  `adminShopperPreview.js`, and the admin screens CreditRecon, NotificationApprovals, PartnerDetail, PotentialDrops,
  PriceDropQueue, ReceiptReader and UnlinkedStock. All of them now show times on Toronto.
- `backend/lib/dropReminderRecap.js` (the admin email recap) and `backend/services/savings/dropConfidence.js`.
- `__tests__/displayTime.test.js` and `__tests__/formatDateCalendar.test.js`.

Where it stopped: backend tests near the change **passed**, and the targeted mobile tests **passed**. The **full mobile
suite was running** when the power went, so its result is lost. Docs for this step are already pushed to docs PR #260.

**To finish it:**
1. `npm test` (full mobile suite), then `npm run i18n:check`. Then run the backend files in the blast radius:
   `cd backend && node --env-file=.env --env-file=test.env --test tests/<dropReminderRecap|dropConfidence>*.test.js`.
2. Re-check the change against Maxim's ask: *"admin should also see based on their timezone even the other users
   events … also the activity dashboard and the other scans da[shboards]"*. The **Activity dashboard** and the **scans
   dashboards** are not in the uncommitted file list. Grep them for `slice(0, 10)`, `slice(0, 16)`, `toLocaleString(`
   and `toISOString` before committing.
3. Commit, open a PR to `main`, and merge it. Then sync it into `main-test-features` with a second PR, the same way
   #633 was synced by #634.
4. Merge docs PR **#260** (Toronto display time + RC-63 + the 11-22 task-log entry).

---

## 1. Final output of each session

### 1a. `0703b004` — Toronto timestamps + the production receipt (02:48 → 06:00 UTC, cut off)
- **Done: #633 (main) and #634 (main-test-features), both merged 05:52 UTC.**
  - One display function, `shared/displayTime.js`. Stored `timestamptz` values were **not** rewritten, because
    rewriting them would shift every value by 4–5 h and break the price-match windows and the jobs.
  - 11 new tests. The full mobile suite passed on main-test-features (14,486).
  - Production runs `b4131c1f`.
- **Done: receipt `r_1795303592862_gwltb` repaired in production** (Costco Rimouski #1720, QC, French). Maxim asked
  for it.
  - Before: lines `sterCard` $51.34 / `RTICLES VENDUS` $24.99, tax $11.43, total $87.76, warehouse #1446 Anjou.
  - After: 1640008 + 1640007 ×2 PANTALON CAT, each $24.99 − $5 coupon. Subtotal $59.97, tax $8.98, total $68.95,
    warehouse #1720.
  - Method: `repairBadScanReceipt.js` run from a worktree of the exact prod commit, dry run first. Two guarded SQL
    updates then moved the warehouse and its 3 new price points from Anjou to Rimouski. No push went to the shopper.
  - Root cause **RC-63** is documented in docs PR #260, with its case table and the runbook log.
- **Started, not finished:** the refinement in §0.

### 1b. `3f28f764` — Harvest jobs screen, desk menu, promo codes, CI, Sentry (11-21 20:06 → 11-22 02:47 UTC)
- **Merged to `main`:**
  - #623 Admin · Harvest jobs screen: run any harvest for one warehouse or for all warehouses, Business Centres
    included. It also regroups the desk menu: Users section above Product management, General = Stores / Partners /
    Promo codes, a new Support section, Flyer scan second.
  - #626 promo codes, without the new design.
  - Fixes #624, #625, #627, #630 and #631.
- **Merged to `main-test-features`:** #632, which is all of `main` merged in.
- **Production:** the promo codes migration is applied and verified. FAMILY, FRIENDS10 and BLACK are active until
  Dec 31 (Toronto time). Shoppers see promo codes **only from the next app build**.
- **Sentry:**
  - The 3.6.5 crash when saving the warehouse is fixed on the server, so installed builds are fixed too.
  - The offline Expo-token error is no longer filed.
  - Google sign-in `INTERNAL_ERROR` needed no change.
- **CI:** `main` was green at `b4aa3603`. The last check (from session `0703b004`) says `7b68f336` passed all three
  jobs too.

### 1c. `99975f30` — roadmap batch (11-21 03:17 → 20:04 UTC, finished)
- **Merged to `main` and synced to `main-test-features`:**
  - #614: refuse $0 phantom receipts; `/health` reports the version and the commit; `/api/check-all` removed.
  - #615: Restore runs once per tap; a refused scan says why.
  - #616: Vision OCR soft line at 1,000 a month and a ceiling at 5,000; subscribers are never limited.
  - #617: admin "Check stock now", stock across warehouses, the Unlinked warehouses screen, the back-in-stock push.
  - #619: daily stock read.
  - #621: hotfix RC-61/62.
- **Production:**
  - Migration 0057 (`warehouse_stock_reads`) is applied, and RLS was turned on for 3 tables.
  - The migration ledger is fixed (0041/0042), and `NODE_ENV=production` is set.
  - `WAREHOUSE_STOCK_READ_ENABLED=true` and `SAVING_LIVE_CHECK_ENABLED` are on.
- **Phone screens for all of this need the next app build.**

---

## 2. Open items, most urgent first

| # | Item | Where it stands | Who |
|---|------|-----------------|-----|
| 1 | Finish §0 (admin Toronto / shopper device clock) | uncommitted on `fix/admin-toronto-shopper-device` | Claude |
| 2 | Merge docs PR **#260** | open | Claude/Maxim |
| 3 | Merge app PR **#635** (gwltb repair spec, kept as a record) | open; remove worktree `E:/tools/pb-prod-b4131c1f` after | Claude/Maxim |
| 4 | Docs PR **#252** (sweep rule 10, purchase province) | open since 11-20; check whether it is superseded, then merge or close | Claude |
| 5 | **App release** (`<build app>`) | needed for promo codes, the stock screens, the Harvest jobs menu, the hero card, the price-history toggle, the parser fixes since the last tag | Maxim's call |
| 6 | RC-63 parser follow-up | 5 proposed parser changes await Maxim's go. Not traced yet: where the made-up $11.43 tax came from, and why the warehouse was saved as Anjou | Maxim decides |
| 7 | CI headroom | the backend job takes ~56 of its 60 minutes; the next slow day may time out | watch / decide |
| 8 | $0-receipt refusal (#614) shipped **on** | the session asked whether it should ship behind a switch set to off (standing rule 6 of the ground rules). #614 merged. Confirm Maxim's answer is recorded | Maxim |
| 9 | Promotion of `main-test-features` | `0058_warehouse_address` still has to be applied to prod by hand. Promo is now on prod. | at promotion |
| 10 | Stock item 13 / 15 | stock for a drop without a saving needs the Same-Day product ID. Recommendation: a weekly listing of one warehouse (~186 req), then a daily read of the watched pairs (~100–150 req). Not built | Maxim decides |
| 11 | Leftover worktree `C:\Users\Maxim\StudioProjects\pb-scan-guide` (`hotfix/receipt-scan-guide`) | not touched by these sessions; check whether it is still needed | Claude |
| 12 | Old stash `stash@{0}` on `fix/reinstall-bootstrap-backend-target` | old; review before dropping | Maxim |

### Roadmap items still not started (from the 11-21 list, `99975f30`)
Items 1–2 (Store Spaces v2 and Paywall V2) are on `main-test-features`. Items 4, 6–11, 14 and 12 are done.
- **Stock and price drops:** 13 and 15 (stock), 16 costco.ca auto-check (Akamai), 17 special-offers table, 18
  closing-window alert, 19 out-of-stock wording on a no-charge push (EN + FR), 20 drop-charge refund path and pruning
  dead Expo tokens.
- **Features and launches:** 21 Best Buy for shoppers, 22 "Deals this week" screen, 23 Deals watchlist (3 decisions),
  24 accounts with no push token, 25 Gemini re-read switch, 26 Plan A, 27 fee lines linked to their item (a Costco
  parser rule, needs Maxim's OK), 28 Costco US, 29 Warehouse Runner, 30 barcode dual capture, 31 coupons ingestion,
  32 status labels the backend still sends in English.
- **Earlier audit items:** 3 A-H1 (the phone side of auto-claimed drops) and 5 A-M3 ("Being verified" state).

---

## 3. Skipped or unverified in these sessions
- None of the three sessions ran the **full backend suite**. Only files near each change were run.
- CI was not run on the **Toronto-time commits** (#633, and the unfinished §0).
- `/health` was not re-read after the 05:52 deploy of #633. Last seen healthy at `8446f865` and `7b68f336`.
- The session-recap memory (`RECAP.md`) was last refreshed on 2026-11-16. Run `/wrapup` at the end of the next
  session.

## 4. How to resume
1. Open a terminal in `C:\Users\Maxim\StudioProjects\Priceback`. Run `git status`; it should list the 20 files from §0.
2. Tell Claude Code: *"resume from `Operations/Session_Resume_2026-11-22_Power_Outage.md`, start with §0"*.
3. Then go through §2 in order. Rows marked "Maxim decides" need your answer before any work starts.

---

## 5. Progress after the restart (2026-11-22, morning)
- **§0 (admin / shopper clocks): moved to another session.** Maxim: *"the UTC problem has been handled by another
  session, skip this one"*. That session owns branch `fix/admin-toronto-shopper-device` and docs PR #260, which it is
  still updating. Leave both to it.
- **#635 (gwltb repair spec):** merged 07:23 UTC. Worktree `E:/tools/pb-prod-b4131c1f` and branch `datafix/gwltb-spec`
  removed.
- **Docs #252 (sweep rule 10):** it was not superseded; `CLAUDE.md` already cites rule 10. Its Task_Log conflict was
  resolved by keeping both entries, and it is merged.
- **Item 8 ($0-receipt refusal): settled.** Maxim answered on 11-21: *"it should be configured in the admin with the
  receipt read settings but already on"*. #614 shipped it as `RECEIPT_REFUSE_PHANTOM` on Admin · Receipt reading, on.
- **Item 11:** worktree `pb-scan-guide` (`hotfix/receipt-scan-guide`) removed. It was clean, and its work had merged
  as #505.
- **Still Maxim's:** item 5 (app release), 6 (RC-63 parser changes), 7 (CI headroom), 10 (stock 13/15), 12 (old
  stash), and the roadmap list.

## 6. Items 7 and 12 closed (2026-11-22, later)
- **Item 7 (CI headroom): done in Priceback #639 (main) and #640 (main-test-features).** The backend job's ceiling is
  now 90 minutes instead of 60. It costs nothing when the run passes, because Actions bills only the minutes used.
  - Measured on run 44976566135: 4,814 tests in 46 min. The 3,513 top-level tests add up to 2,560 s. The slowest is
    73 s (`listPotential`), followed by a long tail. Nothing is worth cutting: the time goes to round trips to the
    remote dev database.
  - Not chosen:
    - **Parallel jobs.** Every run shares one dev database and the cross-machine run lock, so parallel jobs would wipe
      each other's data.
    - **A Postgres container on the runner.** It would be fast, but CI's database would then differ from the local
      one, which breaks local/CI parity. If it is ever wanted, it is Maxim's decision.
- **Item 12 (old stash on `fix/reinstall-bootstrap-backend-target`, 2026-07-05): dropped.** Everything in it was
  either on `main` or later replaced:
  - "Continue anyway" was removed on purpose by #147.
  - `ca.priceback.app` was renamed to `com.priceback`.
  - Its 3 docs are in this repo: Bugs #62, `Technical/RevenueCat_Paywall_Config.md` and the Task_Log entry.
  - A patch copy is kept at `E:/tools/archive/stash-2026-07-05-reinstall-bootstrap.patch` (commit `309691c9`).
- **Repo split (Maxim's question):** not recommended.
  - `shared/`, the phone/server parity tests, the old-builds diff audit and the single release tag all depend on one
    repo.
  - The backend is not in the app's download anyway: Metro bundles only what `src/` imports, and nothing in `src/`
    imports `backend/`.
  - Same-repo alternatives: Railway watch paths (`backend/**`, `shared/**`) and `CODEOWNERS`.

## 7. Later the same day: the CI database option, RC-63 traced, `/health`

- **The faster CI option is now written up:** `Technical/CI_Test_Database_Option.md`. GitHub creates a throwaway
  Postgres 17 inside the test run's own temporary machine, so no server, Railway or Supabase change is needed. The
  catch is parity: keeping it needs Docker Desktop on Maxim's PC. Three choices (A, B, C) are in the doc.
  **Maxim decides.**
- **RC-63, the two untraced points (item 6), now proven** by replaying the shipped 3.6.4 code on the stored text. The
  replay gives exactly the stored lines, $11.43 and $87.76:
  - **The store was never identified.** The photo has no `COSTCO` word (the header is `#1720` / address / Rimouski), so
    `parseReceiptText` returns `storeId: null`. The generic reader ran instead of the Costco parser. That is also why
    `extractWarehouseId` never read the register stamp `17:31:24 1720 8 531 224`, which gives 1720 on its own.
  - **The $11.43 tax.** The generic reader read tax $24.99 against lines of $76.33 (`sterCard` 51.34 + 24.99).
    `receiptValidator.validateReceipt` step 3 ("province tax cap") saw a tax above Quebec's 14.975 % and replaced it
    with rate × lines = 76.33 × 0.14975 = **11.43**, then rebuilt the total as 76.33 + 11.43 = **87.76**. So a tax was
    derived from the lines, which design rule 4 forbids. It happened because the lines were junk. The file is
    unchanged on `main`, so this still ships.
  - **The Anjou warehouse.** With nothing detected, `resolveReceiptWarehouse` tries the header. Its last-resort
    pattern needs a newline *before* `#1720`, and the stored header starts with it, so it returns null (checked: with
    a leading newline it gives 1720). It never looks at `footer_ocr`, which has the stamp. The shopper had no saved
    warehouse and no location, so the **province** fallback took the first Quebec warehouse in the app's list,
    **#1446 Anjou**. The receipt and its price points were filed under a warehouse the shopper never went to, and
    nothing said it was a guess. This file is also unchanged on `main`.
  - **Proposed (documented only; the shared and Costco parser files need Maxim's go):**
    - (a) `resolveReceiptWarehouse` also reads `footer_ocr`, the register stamp. This file is not one of the frozen
      Costco files.
    - (b) A tax over the province cap is **unread** (the total then comes from `receiptTotalToShow`), never rate × lines.
    - (c) A guessed warehouse (province or nearest) is marked as a guess, or not used to file price points.
    - (d) Detect a Costco receipt from its Quebec stamp or tax lines when the word `COSTCO` is missing. That one
      belongs in `receiptParsingShared.js`, which is frozen, so it needs Maxim's go.

    This belongs in RC-63's items 4 and 5 when docs PR #260 (owned by the other session) merges.
- **`/health` re-read** (open from §3): production is healthy, at `8a90e1b7` (#638, the Toronto calendar days), with
  the database at 16 ms.
- **Still Maxim's:** item 5 (app release, `<build app>`), item 6's fixes above and the 5 earlier RC-63 parser changes,
  item 10 (stock 13/15), the CI option (A/B/C), and the roadmap list.

## 8. Two CI workflows; RC-63 fixed with known warehouses only (2026-11-22, evening)

- **Two workflows, merged** (Priceback #644 → main, #645 → main-test-features). Maxim: *"duplicate the workflow with the
  Github database solution and we use this more often and use the actual setup before deploy only"*.
  - `test-github-db.yml`, *Fast Checkup Tests (GitHub database)*: the everyday run. The backend gets a throwaway
    Postgres 17.6 inside the job (`backend/scripts/github-test-db.sh`, image pinned by digest, TLS on, schema from the
    migrations). It never touches Supabase dev.
  - `test.yml`: before a deploy or a release only.
  - `ciParity` pins both workflows. **The new workflow hasn't run yet; its first dispatch is the real test.**
- **RC-63 fix: Priceback #646, open, not merged.** Maxim: *"yes if only the warehouse number is verified against the
  existing known warehouses in the database, no warehouse should be created from now on"* and *"no items parsing
  regression"*.
  - The server never creates a warehouse (`warehousesRepo.findKnown`). An observation naming an unknown number is
    refused (`unknown_warehouse`).
  - The phone keeps a number only when it is known: parser, then header, then the footer stamp, the footer only if
    needed. This happens after parsing.
  - A tax over the cap stays unread.
  - Proof: no item line moved on the 180 golden receipts; only vdxrw's tax/total moved, and they were made up before
    too. Mobile 13,816 tests pass. 112 backend DB files pass, 1,276 tests.
  - New standing rule in `CLAUDE.md`: "Warehouses come from the official list only".
- **Still Maxim's:**
  - dispatch the fast workflow on #646, then merge it;
  - a datafix for the junk warehouse rows already in production;
  - detecting Costco without the word "COSTCO" (frozen file);
  - the app release, stock 13/15, and the roadmap.

## 9. First fast CI run, the warehouse datafix, the Costco claim (2026-11-22, evening)

- **The fast workflow works.** The whole backend suite took **4 min 55 s** on its own database, against 46–56 min on
  Supabase dev.
  - First run on #646: 13 failures. They were rows that exist only on the old dev database:
    - warehouse `811`;
    - the 20 legacy retailers;
    - the store `visions`;
    - an unordered tie on savings-source rank.
  - All fixed in the tests, in #646. Second run: 4,806 passed, **1 failed**.
  - The one left, `adminPriceLookupDb` "the official line … Savings only finds it", fails only on a fresh database. It
    passes on dev with #646, and #646 doesn't touch price history or savings. Cause not found yet.
- **Production datafix: misread warehouses** (Maxim: "do the junk warehouses datafix"). Backup and rollback notes:
  `E:/tools/archive/datafix-2026-11-22-junk-warehouses.md`.
  - 41 crowd price points moved to the warehouse their own receipt names:
    - 136 → 1362 Gloucester;
    - 3518 → 518 Trois-Rivières;
    - 3532 → 532 Boucherville;
    - 628 → 528 Pointe Claire.
  - The 4 misread rows were deleted (guarded: nothing references them). Verified.
  - **Kept: 4 real warehouses missing from the app's official list:**
    - 257 Sudbury, 1798 E. Windsor and 1811 Wasaga Beach, created by Costco's own savings harvest;
    - 1391 SW Calgary (Tsuut'ina), from a receipt.

    `src/constants/costcoWarehouses.js` (frozen) needs them, with Maxim's OK.
- **Costco without the word "COSTCO": Priceback #647, open.**
  - A registry claim (`costcoWithoutWordClaim`) that runs only when no store was detected. It needs both the register
    stamp naming a known warehouse and a Costco-only line.
  - No frozen file changed.
  - Corpus of 227 receipts: every detected store kept its store, and the claim fired on none.
  - gwltb is now read as Costco #1720. Mobile 13,824 tests pass.

## 10. Cause found, everything merged, warehouses added (2026-11-22, evening)

- **The last fresh-database failure, found.** Two savings sources share rank 1. Migration 0036 inserts them through a
  JOIN whose row order Postgres doesn't promise, and the database CI builds gave the Business Centre source the lower
  id. The test took "the first official source" and got the Business Centre one, whose saving the Costco line
  correctly ignores.
  - Reproduced on a throwaway database on the dev project (dropped afterwards).
  - The test now names the source by its storefront (#649).
  - With that fix, run 45058194542 of the fast workflow on #646 was **fully green**. No product code reads a source
    by id.
- **Merged to `main`:**
  - #646 (known warehouses only);
  - #647 (Costco without the word);
  - #648 (the warehouse list);
  - #649 (the test fix).

  #646 and #647 were merged by Maxim at 18:35, before the #649 commit existed, so #649 brought it in.
  `main-test-features` got all of `main` through #651 (another session). #653 added the 3 new warehouses' costco.ca
  addresses there. My #652 sync was closed as superseded.
- **Warehouses:**
  - Added to the official list: 257 Sudbury (1465 Kingsway), 1811 Wasaga Beach (345 Lyons Court) and 1798 Windsor E
    (6670 Catherine St).
  - 1391 was **another misread**: its receipt's register stamp prints 1381. It was folded into 1381 Calgary SW in
    production (the receipt and 45 price points, then the row deleted; backup on E:).
- **Already failing on `main-test-features` (not from this work):**
  - `officialWarehouses` "Gloucester … junk numbers": the address work made `officialWarehouse()` return more fields.
  - Mobile coverage floor for `subscriptionManager.js` (82% against 97%), since Store Spaces v2 #602.
- **Before deploy:** run `test.yml` (Supabase) on `main`, per the two-workflow rule.
