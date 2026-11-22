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
