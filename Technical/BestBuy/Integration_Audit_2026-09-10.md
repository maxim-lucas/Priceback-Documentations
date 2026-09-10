# Best Buy — full-integration audit, 2026-09-10

A path-by-path audit of Best Buy on `development`, asking one question at every
hop: **if a shopper photographed a Best Buy receipt today, what would actually
happen?**

Short answer before the detail: **the code was complete and the configuration was
not.** Every parser rule, every adapter rule, every test and every registry entry
was in place and correct. Best Buy was nonetheless switched **off** for every
user, in both databases, by three stale rows and one stale generated file that
nothing tested — and the nightly price feed could not have run even if it had
been on.

Audited branch: `development` @ `a244c2d`. Fixes on `feat/bestbuy-integration-audit`.

---

## The headline

PR #320 (2026-09-06) promoted Best Buy to "store #2, off the lab lane". It moved
five declarations together and pinned their agreement with
`__tests__/bestBuyStorePromotion.test.js` — genuinely careful work.

It moved five of **six**.

The sixth is `backend/db/deploy/store-content-sync.sql`, and it is the only one
that reaches a running app. `seed.js` inserts stores with `onConflictDoNothing`,
so it only ever fills an empty table; on a database that already has store rows —
both of ours, since 2026-07-26 — that SQL is the *only* supported way to push new
`policies.json` content. And `applyRemoteStores` replaces the app's bundled
`STORES` array with the DB payload on **every launch**.

So the bundle said `enabled: true`, the DB said `enabled: false`, and the DB won
every time. Best Buy was "promoted" for eight days while the Stores tab showed it
as *Coming soon* to everyone.

The file even carried the instruction — *"Regenerate from policies.json rather
than hand-editing"* — with **no regenerator behind it**. A generator nobody can
run is a generator nobody runs. That is the same lesson
`regenerate-policies-json.mjs` taught in August, when Node could not resolve the
app's imports and the two files drifted unnoticed for weeks.

---

## Findings

Ordered by how far they were from a working feature.

### 🔴 1. The store was disabled in both databases

| | `stores.enabled` for `bestbuy` | after |
| --- | --- | --- |
| dev (`gnedluuylimjwdmtvswl`) | `false` | **`true`** ✅ |
| prod (`xjfrlzwonyaorwktnkpj`) | `false` | `false` — **deliberately** |

**Prod is left off on purpose, and this is the important part of the finding.**
`main` still registers the Best Buy parser in `LAB_STORE_PARSERS`, not
`STORE_PARSERS`. Enabling the store in the prod DB would let the shipped 2.8.20
binary *accept* Best Buy receipts and parse them with the **generic** parser —
plausible wrong numbers on a real receipt, filed against a real purchase, which
is exactly the failure the lab lane exists to prevent and is strictly worse than
"not supported yet". Prod's row flips when the parser reaches `main`, not before.

### 🔴 2. `store-content-sync.sql` was stale in three ways

Regenerating it from `policies.json` produced exactly three substantive changes,
and every one of them was live in both databases:

1. `bestbuy` `enabled` `false` → `true` — finding 1's mechanism.
2. `content_updated_at` `2026-07-25` → `2026-09-02` on all six rows. Not
   cosmetic: the served payload's `updatedAt` is `max(content_updated_at)`, and
   `applyRemoteStores` compares it to the client's `BUNDLED_UPDATED_AT`. Left
   behind, the SQL runs, the rows change, and every client **ignores the result**.
3. **Two French claim steps had lost the word "canadien"** — `bestbuy` and
   `thesource`, both reading *"détaillant autorisé"* where English says
   *"authorized retailer"*. This is the very drift
   `bestBuyStorePromotion.test.js` was written about; it was fixed in
   `stores.js` and `policies.json` and never reached the SQL, so both databases
   have been serving pre-#320 French copy to the claim assistant.

**Fixed** — `backend/lib/storeContentSync.js` renders the file,
`backend/scripts/regenerate-store-content-sync.js` is the CLI
(`npm run db:sync-store-content`, `-- --check` to verify), and
`backend/tests/storeContentSync.test.js` pins it. That the generator reproduced
the hand-written file byte-for-byte apart from those three changes is the evidence
it is faithful.

Verified non-vacuous: against the stale committed file, **5 of the 9 new tests
fail**, naming all three defects.

### 🔴 3. The nightly price feed could never have run

`config/defaults.js` flipped `BESTBUY_SCAN_ENABLED` to `true` on 2026-09-02 —
with a comment explaining exactly why. But `app_config` rows **outrank
defaults.js**, and both databases carried an explicit `false` written *before*
the flip:

| | written | value | after |
| --- | --- | --- | --- |
| dev | 2026-08-31 | `false` | **`true`** ✅ |
| prod | 2026-09-01 | `false` | `false` — still owed |

The dev flip is doubly inert right now, which is why it is safe: dev holds **zero**
Best Buy receipts, so `selectTargetSkus` returns an empty list; and the deployed
dev backend runs `main`, which does not contain `jobs/bestBuyPriceRefresh.js`,
`lib/bestBuyCatalog.js` or `services/storePriceAdapters.js` at all. It is the
precondition for testing the feed, not the act of turning it loose.

Prod stays off — `Price_Feed.md` §"Owed before `BESTBUY_SCAN_ENABLED` is turned
on" lists what is still owed there, now split by environment. The prod flag writes
`verified=true` price points, which reach `priceDropRepo.findNotifiable`, which
**charges commission**.

### 🟠 4. `/health` said nothing about any of this

Four independent things must be true before a nightly feed can put a price in
front of a shopper, they are declared in four different files, and **three of the
four were false** — with no surface reporting it. `/health` reported `db`, `auth`,
`ocr`, `llm`, `email`, `revenuecat` and nothing about price feeds.

**Fixed** — `checks.priceFeeds.<store>` is a **conjunction**, in the same shape as
the `auth` and `appleAuth` checks and for the same reason (this codebase has now
shipped the "is one env var set?" half-truth three times):

```json
"priceFeeds": { "bestbuy": { "status": "unavailable",
                             "reasons": ["no_adapter", "scan_disabled"] } }
```

Every failed term is named, not just the first — fixing one cause and redeploying
to find the next is how a ten-minute repair becomes an afternoon, and this feed
genuinely had two wrong at once. The verdict lives in `backend/lib/priceFeedHealth.js`
(pure, unit-tested, 7 cases, each term switched off on its own) and reads the
scan flag through `sweepScheduler`'s **own** `isConfigEnabled`, so the health
check and the scheduler cannot disagree about what "false" means. It reports and
never enforces: a paused feed degrades a feature, it must not fail a deploy.

### 🟠 5. Best Buy had no documentation folder

The standing rule is one store = one parser file **and** one doc folder. Best Buy
had a parser file and no folder; its material lived in
`Technical/Store_Price_Adapters_And_The_BestBuy_Feed.md`, whose own text
acknowledged the mixture.

**Fixed** — that file is split into `Technical/Store_Price_Adapters.md`
(store-neutral: the adapter contract, the NATIONAL province, the `scrape` source
type, the add-a-store checklist) and `Technical/BestBuy/Price_Feed.md` (Best Buy's
half). Cross-references updated. Still owed: §3 and §7 of
`Receipt_Parser_Registry_And_Store_Parsers.md` are Best Buy-specific and should
move to `Technical/BestBuy/Receipt_Parser.md` — see this folder's `README.md`.

### 🟡 6. Two comments still described Best Buy as unfinished

`src/services/featureLanes.js` and `jest.config.js` both said the lab lane carries
"the Best Buy parser and the AdMob SDK". Best Buy left the lane on 2026-09-02.
Both rewritten to keep Best Buy as the lane's **worked example** — it is the best
evidence the mechanism pays — while stating plainly that it is no longer gated.

### 🟡 7. The drizzle ledger under-reports both databases

`Price_Feed.md` owed "apply migration 0007 on production by hand". Audited: the
**DDL is applied** — a real `NATIONAL` provinces row exists in prod (id 49640) and
dev (id 383365), so the national clauses resolve and the feed would write usable
rows. What is missing is the bookkeeping: prod's `drizzle.__drizzle_migrations`
stops at `0006_auth_outcomes`, dev's stops at `0005_object_retention`.

Not a Best Buy blocker. It is a reconciliation hazard: the next person to ask "is
0007 on prod?" gets `no` from the ledger and `yes` from the data. **Left for
Maxim** — writing to a production migration ledger is not something to do
unprompted.

### 🟡 8. Dev has never had `store-content-sync.sql` applied at all

Prod matches the launch-set design: 6 consumer-facing stores visible, 14 legacy
retailers hidden. **Dev shows all 20.** So the Stores tab a dev build renders does
not resemble the one prod renders, and it has been that way since 2026-07-26 —
which is a poor basis for testing anything store-related.

Deliberately **not** fixed here: hiding 14 stores on dev is a real change well
outside a Best Buy audit's scope, and it is what running the full script does. The
remedy is one command, and it now also carries the Best Buy row and the French
copy fix:

```
psql "$DEV_DATABASE_URL" -f backend/db/deploy/store-content-sync.sql
```

### 🟢 9. Flagged, not changed: the SKU-coverage confidence signal is Costco-only

`computeParseConfidence` (`receiptParsingShared.js:508`) penalises low SKU
coverage **only** when `storeId === "costco"`. A Best Buy receipt whose SKUs were
all lost therefore scores full confidence — and the SKU is precisely what makes an
item price-watchable, as this store's own real-OCR suite asserts.

Not changed, and flagged instead, because `receiptParsingShared.js` is Costco's
live code path and the standing rule is that it stays byte-identical without
Maxim's confirmation. The Best Buy-local fix — stamping the signal inside
`bestBuyReceiptParser.js` — is possible but `computeParseConfidence` is called by
the *caller*, not the parser, so it needs a design decision rather than an edit.

---

## What was already right

Worth recording, because the audit's conclusion is "configuration, not code" and
that only means something if the code was actually checked.

- **Parser registry** — `bestbuy` in `STORE_PARSERS`, `LAB_STORE_PARSERS` and
  `LAB_ONLY_STORES` both correctly empty, agreement pinned mechanically.
- **Detection** — `STORE_DETECTION_PATTERNS` matches name, `bestbuy`, `geek squad`
  and the 1-866 number; `detectPurchaseType` gives the `S-n R-n` register header
  precedence over a delivery mention.
- **Service lines** — Geek Squad / protection / membership rows are stamped
  `ignored: true`, and `ignored` is genuinely honoured downstream:
  `receiptsRepo` writes **no** `price_point` for them, `receiptMath` excludes
  them, `storageService` leaves them unwatched. The gate is live, not decorative.
- **Eco-fees are correctly NOT service lines** — pinned by two fixtures
  (`49.99 + 0.25 = 50.24`).
- **The money path is store-agnostic** — `priceDropRepo` ranks `scrape` below
  flyer and above price tags; a `NATIONAL` row matches a provincial receipt;
  `receiptsRepo` special-cases Costco only for warehouse scoping.
- **i18n** — `2 language(s) [en=1501, fr=1501], all keys in sync`. No Best Buy
  string is English-only, and the store-type pill has an `In-Store` / `En magasin`
  label rather than reusing Costco's "Warehouse".
- **The live Best Buy API, re-probed today (2026-09-10).** Shape unchanged, so per
  the capture README's own instruction **no new fixture directory was taken**.
  What the probe confirms:
  - **9.5–10.5 s to first byte** on all three SKUs — the measurement the 30 s
    `TIMEOUT_MS` was set from, still true, and still far outside the 10 s house
    default that would make SKUs fail intermittently.
  - `18145276` **still rejects `marketplace`** — the gate fires on live data.
  - `10255247` still carries `offerEndDate: 2020-08-10`, six years stale — the
    past-date guard is still load-bearing.
  - `19204884` still `isOnClearance: true`.

---

## Coverage of the nine real captures

All **127** real-OCR assertions pass; every capture reconciles against its own
printed total, carries a date, and yields at least one named, priced, SKU'd item.
What the corpus does **not** reach is worth naming, because "the tests are green"
is not the bar this parser was held to:

| Path | Real captures exercising it |
| --- | --- |
| Online order (geometry) | 8 |
| In-store thermal slip (geometry) | **1** |
| **Flat-text path** (`annotation: null` — pasted/`.txt`) | **0** |
| **Tier-2 glyph repair** (`glyphRepaired`) | **0** |
| Tax repair from printed rate | 1 |
| **A discount sub-row** (`originalPrice` set) | **0** |
| **A refund, either format** | **0** |

Each of those is covered by the synthetic suite (29 `describe` blocks, including
returns in both formats). But the standing lesson of this parser is that it
*passed 1,070 synthetic tests and got all nine real receipts wrong* — so these
rows are where the next real capture is worth the most. In priority order: a
**Best Buy return**, an **in-store slip with a markdown**, and a **second in-store
slip** of any kind.

Per Maxim (2026-09-10), the corpus stays at these nine for now; a public search
for more turned up only fake-receipt generators and strangers' documents on
Scribd, neither of which belongs in a committed corpus.

---

## Owed, in order

1. 🔴 **Apply the regenerated SQL to dev**, which also fixes findings 2 and 8:
   `psql "$DEV_DATABASE_URL" -f backend/db/deploy/store-content-sync.sql`
2. 🔴 **Get the Best Buy parser onto `main`** before prod's store row is flipped.
   Until then prod would parse Best Buy receipts generically.
3. 🔴 **Deploy the `development` backend** so `jobs/bestBuyPriceRefresh.js` exists
   where the sweep can call it. `/health` → `checks.priceFeeds.bestbuy` is now the
   one-curl check for whether it landed.
4. 🟠 The production items in `Price_Feed.md` §"Owed" — reviewer notes + PDF
   re-render, the Law 25 PIA, and the drizzle ledger rows.
5. 🟡 Decide finding 9 (the SKU-coverage signal), and split §3/§7 of the receipt
   parser doc into this folder.

---

## Regression risk

**Low, and it does not touch any parsing path.**

- **No parser, engine or shared-parsing file was modified.** `receiptParsingShared.js`
  and `costcoReceiptParser.js` are byte-identical; Costco cannot regress through
  this branch. The two app-side edits are a **comment** in `featureLanes.js` and a
  **comment** in `jest.config.js`.
- `server.js` gains two imports and a read-only block inside the `/health`
  handler. It adds a key to the public payload and changes none.
- `store-content-sync.sql` is generated rather than hand-written; the generator's
  output differs from the committed file only in the three ways listed above,
  which is itself the proof it is faithful.
- New files (`lib/storeContentSync.js`, `lib/priceFeedHealth.js`,
  `scripts/regenerate-store-content-sync.js`, two test files) have no importers
  other than the CLI, the test suite and the `/health` block.
- **Database:** dev only, two reversible `UPDATE`s (`stores.enabled` +
  `claim_steps` + `content_updated_at` for `bestbuy`; `app_config`
  `BESTBUY_SCAN_ENABLED`). Prod untouched. `store_launch_subscriptions` is empty
  on both databases, so enabling the store fired no launch notifications.
- **Coverage:** 16 new assertions across two non-DB backend test files; no
  existing test was modified or deleted.
