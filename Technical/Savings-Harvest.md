# Automated savings harvest (daily, $0) and savings-based price drops

Built 2026-10-26 (Maxim's request; "Solution B" confirmed twice by Monica the same day,
with every resulting drop held for admin approval). Backend migration **0036**.

**2026-10-27 — data checks, order of trust, confidence, automatic approval** (Maxim:
*"some products are having valid to date before valid from which is impossible. the 600$
saving on the TV has valid to date = valid from date … i need the confidence based on the
harvesting to be accurate 100% so i dont check the prices manualy … the target is to
automate the whole process"*; then *"the order should always be costco.ca … along with the
sameday … then start harvesting the websites (yepsavings…) and import only if missing in
sameday to be confirmed. dont import something already in database by official websites
(source of truth always)"*). No migration — Priceback #496. See [Data checks](#data-checks-2026-10-27),
[Order of trust](#order-of-trust-2026-10-27) and
[Confidence and automatic approval](#confidence-and-automatic-approval-2026-10-27).

## What it does

Every hour (minute 5) the API process checks `savings_sources` and runs the sources due
that hour. No extra Railway service, no browser, no OCR — **no extra cost**. Each source
is read by a script (an adapter), never by hand:

| Source (`savings_sources.code`) | What is read | Schedule (seeded) | Trust |
|---|---|---|---|
| `sameday_costco` | sameday.costco.ca **"Warehouse Savings"** collection (`rc-weekly-savings`) for **every warehouse** Same-Day lists (106) — in-store price, regular, saving, end date; delivery price; product photo | daily 00:00 | **1 = source of truth** |
| `sameday_business_centre` | the same on sameday.costcobusinesscentre.ca (11 Business Centres) | daily 01:00 | 1 |
| `costco_coupons` | costco.ca/o/-/coupons (coupon book: item numbers incl. ranges, "Valid … to …", "SAVE $N") | daily 02:00 | 10 |
| `costco_business_centre_web` | costcobusinesscentre.ca/o/-/warehouse-instant-savings | daily 02:00 | 10 |
| `yepsavings` | yepsavings.com store pages (≈20 warehouses): price-tag photos, clearance prices, amounts off | Mon + Thu 03:00 | 20 |

Hours are America/Toronto. A full Same-Day run takes ~25 min (~1,200 GraphQL GETs,
politely spaced). Facebook / Instagram are registered source **types** with no adapter
yet (Meta needs Graph API access): such a source's runs end `failed: adapter_not_implemented`.

### How Same-Day is read (no browser)

The storefront is an Apollo app on persisted queries. The script loads the storefront
(guest cookie `__Host-instacart_sid`), finds the lazy chunk named `operation-hashes` in the
webpack runtime (its file name changes every Instacart deploy, so it is rediscovered each
run) and calls `/graphql?operationName=…&extensions={persistedQuery:{sha256Hash}}` with
the operations the site itself uses: `WarehouseLocations` (every warehouse with its
warehouse number and postal code), `RetailersZone`, `ShopByRetailerLocation` (INSTORE and
DELIVERY shops), `CollectionProductsWithFeaturedProducts`, `Items`. Code:
`backend/services/savings/samedayClient.js`. If Instacart changes its app the run ends
`failed: layout_changed` (and the 09:00 stale alert emails ops).

## What is stored (and never duplicated)

- **`savings`** — an AMOUNT OFF (never a price) per product, province, end date, amount,
  minimum quantity — unique `NULLS NOT DISTINCT`, so reading the same saving again only
  updates `last_run_id` / `updated_at`. `saving_warehouses` links it to the warehouses that
  listed it (none = every warehouse of the province, e.g. the national coupon book).
- **Source of truth:** a less trusted source that disagrees with an active Same-Day saving
  (same product, province, end, different amount) is not written; a less trusted saving
  Same-Day contradicts gets `superseded_at`. Same for prices: a yepsavings tag price that
  Same-Day's in-store price contradicts is excluded (`flags.excluded`). Since 2026-10-27 a
  third-party source never writes a product an official source has in the province at all
  ([Order of trust](#order-of-trust-2026-10-27)).
- **Prices** (`price_points`, `price_tag_scan`, device `d8c1b0f3a9e44d27` like the admin
  uploads): Same-Day in-store prices (`flags.sourceKind = "sameday_instore"`) and yepsavings
  tag photos (`"social_price_tag"` — a photographed tag is a warehouse price, Maxim; since
  2026-10-27 imported unverified, `flags.toConfirm`).
  In-store prices count as **verified** only when uniform in the province and matching a
  real warehouse regular (receipts / tags / flyers); `.97`/`.00`/`.88` prices stay on their
  warehouse, never verified (`Technical/Costco-Price-Rules.md`). Delivery prices only set
  `products.price_sameday`.
- **Photos**: Same-Day product photos are copied to the R2 bucket
  `priceback-product-images` as `costco/<sku>.jpg`, once per SKU (HEAD check first).
- **Run history**: `savings_source_runs` — start/finish, status (`success`, `partial`,
  `failed`, `blocked`, `sanity_skipped`), warehouses checked, items found, savings confirmed
  / new, prices written, duplicates skipped, conflicts resolved, photos uploaded, error,
  details. Kept 180 days (`RETENTION_SAVINGS_RUNS_DAYS`). A saving's `first_run_id` /
  `last_run_id` say which run found it and which last confirmed it.
- **Sanity floor**: a run finding fewer than the source's `min_items`, or under half its
  last good run, writes nothing (`sanity_skipped`) — a layout change can't wipe data.

## Missing end dates (Admin · Saving dates)

A saving is **never skipped for a missing date** (Maxim, 2026-10-26): it is kept with
`valid_until` NULL. Every run dates what it can (an undated read of an offer already on
file with a date takes that date; an undated row on file is dated when a run reads the
offer with one — folded into its dated twin if one exists), then runs a capped per-item
lookup (costco.ca pages, yepsavings' item API). What is still undated waits on
**Admin · Saving dates → "Harvested savings without an end date"**, where the admin can
**Find dates** (one item or all — the server looks each item up: costco.ca pages,
yepsavings, one Same-Day warehouse of the province, the Same-Day product page; never the
full harvest) or enter the dates. An undated saving is never offered as a drop.

## Savings-based price drops ("Solution B")

`priceDropRepo.findNotifiable` now adds, for lines that have **no price-group drop**, the
drops found by `repos/savingDropRepo.js`: a live watched line whose receipt line carried
**no TPD** (`OFFERABLE_LINE`), bought at a warehouse the saving is linked to (or the saving
is province-wide, or the receipt names no warehouse), no later than the saving's last day
and no more than the store window before it started, while the saving still runs and the
store window is open — unless the shopper already paid the sale price. Same materiality
floor, same reachability rule, same dedupe ledger. The queue row carries `saving_id`; the
admin desk shows "Saving $X off · <source> · no TPD on the receipt".

**The new price (2026-10-27)** is what the shelf charges *now*: Same-Day's in-store sale
price for the saving's window at the receipt's warehouse (else the province's single
price), and only without one `paid − saving`. Costco refunds the difference between what
was paid and today's price, so a regular that moved since the purchase moves the refund:
the pizza approved on 2026-10-27 was paid $17.99, the regular is now $18.49 with $4.50 off
→ $13.99, a **$4.00** refund, not the $4.50 the old formula sent (Bugs #352). The floor is
applied to the real drop. Only savings PriceBack stands behind are offered: an official
source's, or a third-party one an admin confirmed — never one still to be confirmed, never
one sold by weight. The claim deadline is the **earliest** end any running official
saving of the same amount prints (costco.ca's coupon book and Same-Day can disagree by a
week — the ASUS laptop: Nov 22 vs Nov 29).

Switches (app_config, live): `SAVING_DROPS_ENABLED` (default on),
`SAVING_DROP_REVIEW_REQUIRED` (default on — savings drops wait for an admin even when
`PRICE_DROP_REVIEW_REQUIRED` is off), `SAVINGS_HARVEST_ENABLED` (master switch),
`SAVING_DROP_AUTO_APPROVE` (**default off** since 2026-10-27 — every drop waits for an
admin; on, a drop at confidence 100% is approved without a person) and `SAVING_LIVE_CHECK_ENABLED` (default on — the confidence's live Same-Day read).

## Data checks (2026-10-27)

`services/savings/savingRules.js`, applied by `savingsIngest` to every source, before
anything is written:

| What the harvest read | What happens | Why |
|---|---|---|
| A saving whose printed end is **before the warehouse's own day** (its province's clock) | **Not stored** (`skipped.ended`) | Same-Day keeps a badge up past its end — the $600 Samsung QN80H (5708165) still read "Ends Oct 26" at 00:45 on Oct 27; yepsavings keeps last week's tags online (246 of 357 prod rows ended before they "started"). A BC warehouse read at 00:30 Toronto is still on Oct 26: there the saving runs till midnight Pacific |
| A saving **not below its regular price** | Not stored (`skipped.not_below_regular`) | Impossible |
| Sold **by weight** (`per kg`, `per lb`…) | Stored, `flags.weighted`; its shelf price (a rate) is not filed; **never a drop** | The saving is per package, the price per kg |
| Deeper than **half** the regular | Stored, `flags.deepDiscount`; never confidence 100% | Comté 15 months: $15 off $23.89 (rejected by the admin) |
| Ending more than **120 days** out | Stored, `flags.longWindow`; never confidence 100% | Costco savings run days or weeks |
| A **multi-unit limit** ("limit 3") | `flags.limit` (smallest seen) | The refund stops at the limit |

**Start dates.** Only costco.ca prints a start ("Valid October 26 to November 22"):
`flags.startPrinted = true`, and it stays printed when Same-Day re-reads the same saving.
Same-Day and yepsavings print none: the start is the day the harvest first saw the saving
on the warehouse's clock (`startPrinted = false` — "first seen", not "valid from"), and it
is never after the end. A saving first seen on its last day reads `first seen Oct 26 until
Oct 26`: logical, and over the next day.

**Same-Day identity.** Each Same-Day saving keeps Instacart's product id
(`flags.samedayProductId`, the same at every warehouse of a storefront) and the item's own
page (`flags.samedayUrl`, `…/store/costco-canada/products/<id>-<slug>`) — the page an admin
opens when costco.ca's search does not know a warehouse-only item number, and what the live
re-read uses. And the official name (`flags.officialName`) the name check compares the
receipt with.

**The repair pass.** Every run starts with `savingsRepo.repairIllogical` (also `POST
/api/admin/savings/repair`, `--repair`): a saving that ends before it starts is superseded
(`flags.invalid = "read_after_end"`, its start set to its end); a third-party saving for a
product an official source has on file in the province is superseded (`supersededBy:
"official"`); a third-party saving imported before 2026-10-27 is marked `toConfirm`. Never
deleted. On prod it was run by hand right after the deploy (2026-10-27, `--repair` against
prod, at Maxim's request): `readAfterEnd` 246, `officialOnFile` 4, `markedToConfirm` 357 — 0
savings ending before they start remain.

## Order of trust (2026-10-27)

1. **Official** — Costco's own sites: costco.ca (coupon book + Business Centre page,
   trust 10) and Same-Day (Costco + Business Centre, trust 1). They run first and are the
   source of truth. Between them Same-Day wins an amount conflict (it is read per
   warehouse).
2. **Third parties** (yepsavings, any later blog or social source) wait until every
   official source scheduled today has finished its run (`waiting_for_official` on the
   tick; a run still `running` past its timeout counts as finished). They only **fill a
   gap**: a saving is imported only when no official source has that product in that
   province on file (any amount, any end — `skipped.official_on_file`), a price only when
   no official in-store price is on file (`official_price_on_file`). What is imported waits
   **to be confirmed** (`flags.toConfirm`, prices unverified) and is never a drop until an
   admin confirms it (Admin · Saving dates → *Third-party savings to confirm*) — or an
   official run lists the product: the same saving merges into the official row (the upsert
   lifts `source_id` and clears `toConfirm`), any other is superseded
   (`supersededBy: <source>`, `details.thirdPartyReplaced`).

The tick also **catches up** a slot a restart missed, the same day, within
`config.catchUpHours` (default 6): `already_ran_this_slot` replaces `already_ran_this_hour`.

## Confidence and automatic approval (2026-10-27)

`services/savings/dropConfidence.js` (pure) runs, for each savings drop, the checks an admin
used to do by hand on the website; `services/savings/dropVerifier.js` gathers what they need.
**100% = every hard check passed** — and only then is the drop approved without a person.

| Check | Passes when |
|---|---|
| `official_source` | the saving is an official source's (or a third-party one an admin confirmed) |
| `listed_at_warehouse` | the receipt names its warehouse and Same-Day listed the saving there (or the live read did) |
| `live_confirmed` | a **live Same-Day read of that item at that warehouse** (`services/savings/liveCheck.js`, `items_<location>-<productId>`, else the warehouse's savings collection by item number; Business Centres on their own storefront) within 12 h shows the same amount off and an end not yet passed |
| `paid_regular` | the line's unit price is that warehouse's regular price **to the cent** |
| `new_price_matches` | the drop's new price is that warehouse's sale price to the cent |
| `dates_valid` | the end is printed, the start is not after it, it has not passed, it is not months away |
| `bought_in_window` | bought no later than the deadline and the store's 30-day window is open |
| `receipt_reads` | the receipt's lines add up to its total, and to the printed SUBTOTAL when one was read (a missed TPD line breaks both), and **this line's** item number and price are printed on the paper. Another line's misread or a misread TAX label is shown ("whole receipt: low — …") but never blocks: it says nothing about this drop |
| `line_clean` | read from the paper (not edited by the shopper, nothing filled from the database), no TPD on the line, a whole quantity |
| `no_tpd_on_paper` | the receipt's text prints no `TPD/<item>` (or `TPD/<name>`) for it: a TPD the parser hung on another line means the shopper already got the saving |
| `name_matches` | the printed name fits the official name (register abbreviations, OCR slips, glued words; a misread item number would not) |
| `not_weighted`, `plausible_discount`, `within_limit` | per unit; at most half the price; within the saving's limit |

Advisory, never blocking: official end dates agree (else the shopper gets the earliest);
the amount is the same at every warehouse of the province.

- **When:** every global drop sweep stages, then `dropVerifier.autoApprove` assesses the
  pending savings drops (a live read per saving and warehouse at most every 6 h, kept on
  the saving as `flags.liveChecks.<warehouse>`), approves those at 100%, then the drain
  sends. A shopper's own refresh never triggers live reads. Fails closed.
- **Who approved:** an automatic approval stamps `reviewed_at` and leaves `reviewed_by`
  NULL (a foreign key to `users`: only a person reviews) — `isAutoApproved`. A delivery that
  fails gives the row back as pending; the next sweep re-checks it before approving again.
- **The desk:** each savings drop shows *Confidence N% · passed of checks*, every failed
  check in words ("Paid the regular price: paid $17.99, regular $18.49"), *Re-check live on
  Same-Day* (`POST /api/admin/price-drop-queue/:id/verify`) and *Open the item on
  Same-Day*; a third switch, *Approve 100% savings drops automatically*. The badge needs the
  next app build; the automatic approval does not.
- **Off by default, picked by confidence (Maxim, 2026-10-27):** "all price drops should
  still be in the admin console and approved by admin, I will change the settings if it
  should go." `SAVING_DROP_AUTO_APPROVE` ships `false` (dev's stored row set to false too),
  so the sweep approves nothing on its own. The queue shows confidence filter chips with
  counts — *All · 100% · 90–99% · 80–89% · Below 80% · Not scored* — and *Select all* /
  *Approve selected* act on the filtered band only (changing the filter clears the
  selection, so nothing hidden is approved). A drop without a score says why: a
  price-group drop, or a savings drop whose checks could not run.
- **Backtest on prod's whole savings-drop queue (2026-10-27 14:51 UTC, read-only):** the
  exact code path (`dropVerifier.assess`) with prod's rows, receipts and harvested prices
  injected and the real live Same-Day checker, nothing written. 13 drops:

  | Queue | Item (warehouse) | Admin decided | Confidence |
  |---|---|---|---|
  | #690, #696, #697, #699 | Yoplait YOP (1186, 802, 1446, 1446) | sent | **100% — auto-approve** |
  | #691 | Crunchmaster (540) | sent | **100%** |
  | #692 | 32 Degrees heated vest (159) | sent | **100%** |
  | #694, #695 | Tide Pods, Dove body wash (1213) | sent | **100%** |
  | #698 | Sprague lentil soup (521) | sent | **100%** |
  | #689 | Pizza variety (1213) | **sent — wrongly** | 64% hold: Same-Day does not list the saving at 1213; paid $17.99 vs regular $18.49; staged $13.49 vs sale $13.99 |
  | #693 | Pizza (159) | superseded | 64% hold: not listed at 159 |
  | #688 | Ferrero 48 ct (802) | rejected | 85% hold: paid $17.97 (clearance) vs regular $21.99 |
  | #733 | Comté 15 months (no warehouse) | rejected | 64% hold: receipt names no warehouse; the Business Centre price is a different pack ($28.66) |

  Every correct drop reaches 100%; no wrong one does. The first run of the backtest, when
  `receipt_reads` asked the WHOLE receipt to read "high", held five correct drops for a
  misread TAX label or another line's item number — hence the line-level check.

## Operating it

- **Sources** (admin token, `x-admin-token`): `GET/POST /api/admin/savings/sources`,
  `PATCH /api/admin/savings/sources/:code` (`enabled`, `runsPerDay` 1–24, `daysPerWeek`
  1–7, `startHour` 0–23, `trustRank`, `minItems`, `config`), `POST …/:code/run` (starts a
  run now, 202), `GET /api/admin/savings/runs[?source=&limit=]`, `GET …/runs/:id` (the run
  and the savings it found / confirmed). Or SQL on `priceback.savings_sources`.
- **CLI** (from `backend/`, `.env` → DEV): `node --env-file=.env scripts/harvest-savings.mjs
  --list | --source <code> [--dry-run] [--only 531,524] [--limit 5] | --due | --run <id> |
  --repair | --to-confirm | --verify-queue [--ids 12,13] [--live auto|force|never] [--status pending|all]`
  (the last prints every check of every savings drop in the queue).
- **Admin · Saving dates** (Bearer + ADMIN_USER_SUBS): `GET /api/admin/savings/to-confirm`,
  `POST /api/admin/savings/:id/confirm | /reject`. **Admin · Price-drop queue**: the list
  carries `confidence`, `autoApproved`, `samedayUrl` on savings rows; `POST
  /api/admin/price-drop-queue/:id/verify`; settings `{ savingAutoApprove }`.
- **Health**: `select s.code, st.code, r.started_at, r.items_found, r.savings_confirmed, r.error
  from priceback.savings_source_runs r join priceback.savings_sources s on s.id = r.source_id
  join priceback.savings_run_statuses st on st.id = r.status_id order by r.id desc limit 20;`
  A source with no good run in its period + 36 h is emailed at 09:00 (Toronto).
- **Production**: migration 0036 must be applied (by hand, then the ledger row) **before**
  the code deploys — the review queue reads `saving_id`.

## Risks

- Costco's and yepsavings' terms restrict automated access / reuse; every source can be
  switched off (`enabled = false`). Runs are once a day, spaced, idempotent.
- Same-Day is Instacart's view of Costco; yepsavings a third party. Since 2026-10-27 the
  safety net is the confidence: a drop is approved without a person only when the saving is
  re-read live at the shopper's own warehouse and every other check passes; anything less
  waits for the admin with its failed checks named. `SAVING_DROP_AUTO_APPROVE=false`
  returns to approving every savings drop by hand.
- The live reads are a few Same-Day GETs per pending drop at most every 6 h; switch them
  off with `SAVING_LIVE_CHECK_ENABLED=false` (then nothing reaches 100%).
