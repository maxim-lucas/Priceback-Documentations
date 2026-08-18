# Production test-data purge — 2026-08-18

**Status: DONE. Irreversible — executed as direct SQL with no backup table, by
explicit instruction.** This document is the only record of what was removed.

Target: Supabase project `xjfrlzwonyaorwktnkpj` (production), schema `priceback`.

---

## Why

Two sources of non-production data had accumulated:

1. **The backend test suite ran against the production database** between
   2026-06-11 and 2026-06-29. Established from prod data in the 2026-08-17
   session; the recurrence is guarded by PR #278 (`getPool()` now refuses when a
   test runner is detected *and* `DATABASE_URL` names the prod project ref).
   The suite deletes user rows as a fixture reset, so the *users* it created were
   already gone — what survived was the residue with no user FK: price points,
   products and warehouses.
2. **Simulated billing.** The owner account carried nine `dev_priceback_pack_*`
   top-ups (sideloaded purchase simulation), plus the drift reconciliation and
   admin chargeback that existed only to cancel them out.

Plus eight accounts that were testers rather than customers.

---

## What was deleted, and the evidence for each predicate

Every predicate was measured against production **before** deleting, and every
post-purge count matched the prediction exactly.

| Step | Predicate | Rows | Evidence |
|---|---|---|---|
| 2a | 8 named `users.sub` | 8 users + 8 cascaded `credit_ledger` rows | see below |
| 2e | simulated billing on `118191783519567339335` | 9 `topup_refs`, 11 `credit_ledger`, 1 `credit_reconciliations` | `ref LIKE 'dev\_priceback\_pack\_%'` |
| 2b | `price_points.source_ref ~ '^(rcpt-\|br-exp-\|br-nodisc-\|bc-\|created-\|flyer-batch-\|seed-)'` | 350 | every prefix traced to the test file that writes it |
| 2c | `products` with no barcode, no price point, no receipt item | 3,174 | referential, not date-based |
| 2d | `warehouses.code LIKE 'wh-%'` | 436 | `wh-<epoch>`, `wh-bf-*`, `wh-geo-*`, `wh-list-*` from the DB suites |

### Result

| Table | Before | After |
|---|---|---|
| `users` | 15 | **7** |
| `price_points` | 505 | **155** |
| `products` | 3,288 | **114** (26 with barcodes, all kept) |
| `warehouses` | 619 | **183** |
| `topup_refs` | 9 | **0** |
| `credit_reconciliations` | 1 | **0** |
| `receipts` | 3 | **3** (untouched) |
| `receipt_items` | 29 | **29** (untouched) |
| `tag_scan_reviews` | 3 | **3** (untouched) |

Post-purge integrity check: **0** orphaned FKs across `receipt_items → products`,
`price_points → products`, and `tag_scan_reviews → price_points`.

---

## The three predicates that needed care

**Products could not be deleted by date.** 3,280 of the 3,288 products were
created inside the 2026-06-21…29 test window — but **real receipt items point at
products created in that window**. A date-based delete would have destroyed live
receipts; `receipt_items → products` is `ON DELETE RESTRICT`, so it would have
failed loudly rather than silently, but the correct filter is referential:
a product with no surviving price point and no receipt line.

**`barcode IS NULL` is load-bearing.** Without that clause the same query also
removes 20 barcode-carrying products, including real catalog rows
(`359474=CRISPY ONION`, `1218213=ORIGL TORTIL`) and both products written by the
2026-07-12 barcode harvester. A barcode↔SKU link is worth keeping even with no
price attached — it is the whole point of the barcode-lookup feature. A row with
no barcode, no price and no receipt line carries nothing.

**The chargeback had to go with the top-ups.** The owner's ledger was:

```
signup_grant      +75
price_tag_scan    +10
topup_purchase  +3400   (9 rows, all dev_ simulated)
scan_consume       -6
reconcile_adjust     0   (drift -2907)
admin_adjust    -3350   (admin:chargeback)
                -----
                  129   = users.scan_credits
```

The −3,350 chargeback exists **only** to cancel the fake top-ups. Removing the
+3,400 while keeping it would have driven the balance to **−3,271**. Deleting
both leaves `75 + 10 − 6 = 79`; `balance_after` was rewritten as a running sum
over the 11 surviving rows and `users.scan_credits` set to 79, so Credit History
and the `reconcileCredits` job both read clean.

---

## Accounts

**Deleted (8).** Verified inert first — 0 receipts, 0 devices, 0 consent events,
0 sessions, 0 preferences, 0 referrals between them. Each held only its untouched
75-credit signup grant.

```
114209029659364468983  4HSAQ2HA2DQISDLINTEBG4-LVL-01@cloudtestlabaccounts.com
101446085712940706613  graceperez.86505@gmail.com
114659400490236112186  dominicklucas.04905@gmail.com
101667940979358253167  gretchenmccormick.57709@gmail.com
103444261817369604507  conradlane.53783@gmail.com
106859259655114858402  thwalters.10038@gmail.com
105888376302559105813  rubyflowers.60659@gmail.com
115329627175512368359  derekpeters.56489@gmail.com
```

The first is Google's Play pre-launch **robo test** account. The other seven have
the signature of Play **closed-testing testers** — created in tight clusters on
2026-08-10 and 2026-08-18, signed in once, never scanned.

⚠️ **Known consequence, accepted at the time:** Play counts closed testers toward
the 12-tester requirement. If any of those seven reopens the app they get a fresh
account and a fresh 75-credit grant — the deletion does not block them.

**Kept (7).** Both owner accounts (Google `118191783519567339335` + Apple
`000563…0942`), the Apple private-relay referral `000747…0958`,
`sandrasharobim@hotmail.com`, both `monicasharobim`/`sharobimmonica` accounts,
and `jeanette.rezkalla@gmail.com`.

---

## Deliberately left alone

- **`job_runs` (1,954), `auth_outcomes` (31), `consent_events` (45)** — real
  operational and audit history, not generated data. `auth_outcomes` in
  particular is the evidence trail for the August sign-in outage.
- **`price_points` that survived (155)** — 70 from real `r_*` app receipts, 42
  from the real `costco-national-2026-05-25` flyer import across 8 provinces
  (real product names, e.g. "BOUNTY 12X91"), 40 `flyer_user_scan`, 3
  `price_tag_scan`. `flyer-batch-1/2` was **not** in this set: its products are
  named `pp-flyer-5061185`, which is `pricePointUpsertDb.test.js`.
- The 3 pending `tag_scan_reviews` and their R2 objects — real scans.
- `stores`, `provinces`, `app_config`, `credit_packs` and the other reference
  tables.

---

## Side effect worth knowing

The previous Task_Log entry set this acceptance criterion for PR #282: *"a
`topup_purchase` row must carry a real store transaction id rather than
`dev_…`"*. After this purge there are **zero** `topup_purchase` rows and zero
`topup_refs` in production, so the check is now unambiguous — the next such row
to appear can only have come from a real store transaction.

---

## If this needs doing again

Do not re-derive the predicates from scratch. The durable rules:

1. **Classify by `source_ref` shape, never by row count or date.** Orphaned price
   points are *normal* by design (`price_points` deliberately outlive a deleted
   receipt — see `Bugs_Common_Fixes.md`); dev holds 15,424 of them. The shape of
   the reference is the discriminator.
2. **Delete children before parents, and re-read between steps.** Data-modifying
   CTEs all see the same snapshot, so a single statement cannot delete fixture
   price points *and then* find the products they orphaned.
3. **Read `information_schema` FK delete rules first.** `users` cascades widely,
   `products → receipt_items` is RESTRICT, `warehouses` is SET NULL everywhere.
   Those three facts decide the whole ordering.
