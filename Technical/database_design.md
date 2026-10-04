# PriceBack — Database Design (v2, full redesign)

> **Status:** canonical reference for the from-scratch DB redesign. This document is the
> source of truth that `backend/db/schema.js` must mirror exactly. Read it before changing any
> table or column.
>
> **Context:** the DB grew through 9 migrations (`0000`–`0008`); `0003`–`0008` were
> Preview-branch only and never reached production. The app is **pre-launch with no production
> data**, so we squash everything into one clean `0000_initial.sql` and reset the Preview DB.

---

## Design best practices (enforce on every future table/column)

1. **One identity column per table.** A single surrogate `id` (`serial`/`bigserial`).
   Integer **when possible**. Documented exception: external/client identifiers stay `text`
   because an integer is not possible — `users.sub` (OAuth subject), `receipts.id` (client
   UUID for idempotent upload), `devices.device_id`. Their inbound FKs are `text` to match.
2. **Every relationship is a real FK** with an explicit `onDelete` (`cascade` for owned
   children, `restrict` for protected references, `set null` for soft links the audit trail
   must outlive).
3. **A PK and the FKs that point at it share the same data type.**
4. **No free-text enums.** Any small fixed value set is a lookup table (`int id` + unique
   `code` + `label`); add values by seeder upsert, never `ALTER TYPE`.
5. **No ghost columns/tables.** A column (or table) is only created if it has a live **writer**
   *and* a live **reader** (a `SELECT` that reaches business logic or the client) on day one.
   Otherwise it does not exist.
6. **No redundant/derivable stored data.** If a value is a pure function of other columns,
   derive it on save/load instead of storing it (e.g. `instant_savings = regular_price − price`).
7. **Logical placement & naming.** Every column lives in the table it semantically belongs to;
   table/column names are representative of their content.
8. **Lookup values are seeded, not migrated.** New codes are appended to `db/seed.js`.
9. **All money/price columns are `numeric`** (`numeric(10,2)`, CAD/local minor units) — never
   text. Display strings (`"$12"`) are formatted in code from the numeric value + the row's
   country `currency`.
10. **Every price observation — from any source, including API endpoints — is one
    `price_points` row** (discriminated by `source_type`). `price_points` is the single source
    of price truth; no other table stores an observed price.

**One deliberate, documented denormalization:** `price_points.store_id` duplicates
`products.store_id` (a price point's store equals its product's store). It is kept on purpose
so store-scoped price queries (crowd/warehouse aggregation, the active-flyer index) don't join
`products` on the hottest table. This is the single allowed exception to rule #6, justified by
read-path performance.

---

## Conventions

- **Schema:** all application tables live in a dedicated **`priceback`** schema (not `public`).
  Drizzle declares it via `pgSchema("priceback")` and qualifies every query automatically; the
  two raw `db.execute(sql)` queries qualify `priceback.` explicitly. The Neon pooler rejects a
  `search_path` startup option, so the app does NOT rely on `search_path` — everything is
  schema-qualified. The squashed migration begins with `CREATE SCHEMA IF NOT EXISTS "priceback"`.
- Every `timestamp` is `timestamptz`. `created_at`/`updated_at` default `now()`.
- Money is `numeric(10,2)`; `commission_rate` is `numeric(5,4)`.
- Lookup tables share the shape `{ id serial PK, code text UNIQUE, label text }`.
- Repos translate user-facing codes (`'costco'`, `'flyer'`, `'free'`) ↔ integer FK ids.

---

## Tables

### Lookups

#### `countries`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| code | text UNIQUE NOT NULL | ISO 3166-1 alpha-2 (`CA`, `US`) |
| name | text NOT NULL | |
| **currency** | text NOT NULL | **NEW.** ISO 4217 (`CAD`, `USD`). Read when formatting plan/pack prices. |

#### `provinces`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| country_id | int NOT NULL → countries.id (restrict) | |
| code | text NOT NULL | `QC`, `ON`, `CA`(California)… |
| name | text NOT NULL | |
| | UNIQUE (country_id, code) | |

#### `stores`
`id serial PK · code text UNIQUE · name text · country_id int → countries.id (set null) · visible bool default true · enabled bool default false · short_name text · adjustment_days int default 0 · color · emoji · icon_name · category jsonb · website · policy_url jsonb · policy_note jsonb · claim_steps jsonb · price_check_url · receipt_keywords jsonb · last_verified_at date · sort_order int default 0 · content_updated_at date · created_at · updated_at` · index(enabled) · index(sort_order)
- The **single** store table: both the operational FK target (receipts/products/price_points/warehouses) **and** the consumer-facing policy content. The former `store_policies` table was merged in here (migration `0003_broken_psynapse`) — splitting them broke visibility, because the app's store list came from `store_policies` while `visible` lived on `stores` and the two only matched on a few overlapping codes, so `visible=false` on a display-only retailer did nothing. One row per store ⇒ `visible` always gates the store it names.
- `visible=false` hides the store from the app **entirely** (omitted from `GET /api/v1/policies.json`). Distinct from `enabled=false`, which keeps the store in the list but renders it disabled ("coming soon"). `visible` renamed from `active` (migration `0001_stores_visible`).
- A row is **consumer-facing** (served in `policies.json`) when it carries policy content — `short_name` is the presence marker (NOT NULL for every policy row, NULL for operational-only stores like metro/loblaws that exist purely as FK anchors). Seeded from `data/policies.json` on first boot; DB-authoritative after.

#### Lookup value tables (all `{id, code UNIQUE, label}`)
- `subscription_statuses` — active, expired, in_grace_period, in_billing_retry, cancelled, paused, unknown
- `subscription_event_types` — INITIAL_PURCHASE, RENEWAL, CANCELLATION, UNCANCELLATION, NON_RENEWING_PURCHASE, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE, TRANSFER, SUBSCRIPTION_PAUSED, **free_trial** *(NEW)*
- `credit_event_types` — topup_purchase, monthly_grant, scan_consume, admin_adjust, refund, migration_seed, signup_grant, price_tag_scan, price_tag_revoke, **referral_referrer_bonus**, **referral_referee_bonus** *(NEW)*
- `receipt_sources` — ocr, manual, import
- `receipt_statuses` — pending, processed, rejected, needs_review
- `price_source_types` — flyer, receipt_ocr, barcode_scan, **flyer_user_scan** *(was `crowdsourced`)*, price_tag_scan, scrape, manual
- `consent_sources` — signup, settings_screen, admin, migration

#### `consent_types`
`id serial PK · code text UNIQUE · label text · required bool default false · current_version text NOT NULL`

#### `notification_types`  *(NEW — backs `user_notification_settings`)*
`id serial PK · code text UNIQUE · label text · is_master bool default false · default_enabled bool default true · sort_order smallint default 0`
The `code`s ARE the categories of `shared/notificationCategories.js` (the one registry both sides read) that live in this table — i.e. `settingCodes()`: notificationsEnabled [master], notifUrgentClaims, notifClaimReminders, notifDailyDigest, notifDropCharge, notifFriendJoins, notifFlaggedVerified, notifOtherCredit, notifLowBalance, notifStoreLaunch, and since 2026-09-25 notifScanReminders, notifMonthlyRecap, notifScanResults, notifAdminAlerts (14). The mobile `NOTIFICATION_PREF_KEYS` and the server's `PUT /api/me/profile` whitelist are DERIVED from the same registry. `default_enabled` mirrors the registry (and the app's `DEFAULT_PREFS`) so a user with no setting row folds to the same (fail-open) default — pinned by `backend/tests/notificationCategoriesRegistry.test.js`. The marketing consent ("Tips & offers") is deliberately NOT a row here: it lives in `consent_events`.
> **Read by the re-engagement job as a capability, not only a preference.** For the `explicitOnly` categories (notifScanReminders, notifMonthlyRecap) the server sends ONLY to users with an explicit enabled row — which only an app version that shows the switch writes — so an older binary never receives a notification it has no switch for. Details: `Technical/Notification_Categories.md`.

### Config

#### `app_config`  *(unchanged)*
`key text PK · value jsonb NOT NULL · category text · description text · updated_at timestamptz` · index(category)

#### `subscription_plans`  *(was `user_plans` rows where type='subscription'; slimmed + country-scoped)*
Only `free` + `unlimited` seeded. All money columns numeric.
| column | type | notes |
|---|---|---|
| id | serial PK | |
| code | text NOT NULL | `free`, `unlimited` |
| country_id | int NOT NULL → countries.id (restrict) | **NEW.** Country-scoped catalog |
| label | text NOT NULL | |
| active | bool NOT NULL default true | |
| hidden | bool NOT NULL default false | off the paywall when true |
| popular | bool NOT NULL default false | "Most Popular" badge |
| precedence | int | highest wins in tier resolution; NULL = free/base |
| scans_per_month | int | NULL = unlimited |
| claims_per_month | int | NULL = unlimited |
| commission_rate | numeric(5,4) | |
| monthly_product_id | text | RevenueCat SKU |
| monthly_price | **numeric(10,2)** | was text "$12" |
| annual_product_id | text | |
| annual_price | **numeric(10,2)** | was text |
| icon_name | text | |
| description | text | |
| best_for | text | |
| feature_keys | jsonb | string[] of unlocked FEATURE_KEYS |
| features | jsonb | string[] paywall bullet lines |
| sort_order | smallint NOT NULL default 0 | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (country_id, code) | same code may exist per country |

#### `credit_packs`  *(split back out of `user_plans`; country-scoped)*
| column | type | notes |
|---|---|---|
| id | serial PK | |
| code | text NOT NULL | the RevenueCat SKU |
| country_id | int NOT NULL → countries.id (restrict) | **NEW** |
| label | text NOT NULL | |
| credits | int NOT NULL | one-time credits granted |
| price | **numeric(10,2)** | was `price_usd`; currency from country |
| description | text | |
| best_for | text | |
| active | bool NOT NULL default true | |
| hidden | bool NOT NULL default false | |
| sort_order | smallint NOT NULL default 0 | |
| created_at / updated_at | timestamptz | |
| | UNIQUE (country_id, code) | |

> Dropped vs old `user_plans`: `type` discriminator (no longer merged), `price_label` (text —
> formatted from `price`+currency in code).

### Core

#### `users`
Changed: **add** `country_id` (NOT NULL → countries, default `CA` at signup) — the authoritative
country for the country-scoped catalog (`subscription_plans`/`credit_packs`) + currency, present
even before `province_id` is set (`decorateUserRow` reads `countryCode` from it). **Drop**
`monthly_scans_used` + `scan_month_key` (no live DB writer —
`incrementMonthlyScan` was never called; the gate's monthly counter is transient), and
**drop** `notification_prefs` jsonb (per-category toggles normalized into
`user_notification_settings`). **Keep**
`lifetime_pack_commission_rate` (written by `applyTopup`, read by `subscriptionGate` — sticky
pack loyalty, a real round-trip), and `last_topup_event_id`/`last_topup_product_id`/
`trial_credits_granted_at` (read as idempotency guards). `referral_code`/`referred_by`/
`referrals_count` stay as fast denormalized fields alongside the new `user_referrals` edge.
| column | type | notes |
|---|---|---|
| sub | text PK | OAuth subject (text exception) |
| email | text NOT NULL | index |
| name, picture | text | |
| postal_code | text | |
| country_id | int NOT NULL → countries.id (restrict) | **NEW.** The user's country; default `CA` at signup. Authoritative for country-scoped catalog + currency |
| province_id | int → provinces.id (set null) | the user's province (default for price_points) |
| push_token | text | |
| subscription_tier_id | int NOT NULL → **subscription_plans.id** (restrict) | |
| subscription_status_id | int → subscription_statuses.id (set null) | |
| subscription_expires_at / subscription_updated_at | timestamptz | |
| scan_credits | int NOT NULL default 0 | live balance (history in `credit_ledger`) |
| trial_credits_granted_at | timestamptz | one-time-grant guard |
| last_topup_event_id / last_topup_product_id | text | idempotency guards |
| referral_code | text UNIQUE | |
| referred_by | text → users.sub (set null) | the inviter's sub — fast denormalized pointer (edge in `user_referrals`); index supports the set-null cascade |
| referrals_count | int NOT NULL default 0 | |
| status | boolean NOT NULL default true | account lifecycle flag — true=active (1), false=deleted (0). A soft-deleted row stays present so the one-time trial grant can't re-fire on re-signup and the audit trail survives; re-signin reactivates it |
| deletion_requested_at | timestamptz | stamp of the erasure request (mirrors `receipts.deleted_at`); set on soft delete, cleared on reactivation |
| created_at / updated_at | timestamptz | |

#### `devices`
`device_id text PK · scan_count int default 0 · first_seen · last_seen · owner_sub text → users.sub (set null) · reset_at timestamptz` · index(owner_sub)
`reset_at` is stamped when the user runs "Reset All Data" from the device (credit balance is zeroed server-side at the same moment; the trial grant never re-fires).

#### `consent_events`  *(unchanged)*
`id bigserial PK · user_sub text → users.sub (cascade) · consent_type_id int → consent_types.id (restrict) · granted bool · version text · source_id int → consent_sources.id (restrict) · ip_hash · user_agent · occurred_at` · index(user_sub, consent_type_id, occurred_at)

#### `user_preferences`  *(NEW — cloud-backed, 1:1 with users)*
The settings that must survive a device change / factory reset. Marketing consent is NOT here (it lives in `consent_events`). `updated_at` is the last-write-wins clock the mobile sync compares against its local stamp.
`id serial PK · user_sub text UNIQUE → users.sub (cascade) · language text ('en'|'fr', whitelisted in repo) · preferred_warehouse_id int → warehouses.id (set null) · auto_reload_enabled bool default false · auto_reload_pack_id int → credit_packs.id (set null) · low_balance_warn_at int (0 = banner off) · created_at · updated_at`

#### `user_notification_settings`  *(NEW — replaces `users.notification_prefs`)*
One row per (user, category) the user has EXPLICITLY set; absence folds to `notification_types.default_enabled` (this is what preserves fail-open delivery).
`id serial PK · user_sub text → users.sub (cascade) · notification_type_id int → notification_types.id (restrict) · enabled bool NOT NULL · updated_at` · UNIQUE(user_sub, notification_type_id) · index(user_sub)

#### `user_referrals`  *(NEW — referral edge / friends-invited list)*
One row per accepted redemption; enables the "friends you invited" list and ties each redemption to the two `credit_ledger` rows that paid the bonuses. `referrer`/`referee` are real FKs with `set null` so the audit row outlives either deletion. `users.referrals_count` stays the fast denormalized counter; `referee_sub` UNIQUE enforces "redeem once".
`id serial PK · referrer_sub text → users.sub (set null) · referee_sub text → users.sub (set null) · referrer_reward_ledger_id bigint → credit_ledger.id (set null) · referee_reward_ledger_id bigint → credit_ledger.id (set null) · created_at` · UNIQUE(referee_sub) · index(referrer_sub)

### Products & prices

#### `products`
| column | type | notes |
|---|---|---|
| id | serial PK | the ONLY identifier for a product |
| store_id | int NOT NULL → stores.id (restrict) | |
| sku | text NOT NULL | store SKU, or `bc:<barcode>` / `ln:<receiptId>:<idx>` synthetic |
| barcode | text | UPC/EAN; index |
| display_name | text NOT NULL | moved from receipt_items.name |
| created_at | timestamptz | |
| | UNIQUE (store_id, sku) · index(barcode) | |

> **Dropped** `unit_price` — the catalog/preload price was write-only (flyer import) with no
> reader; every observed price already lives in `price_points`.

> **Dropped** `last_seen_at` (ghost). `name`/`sku`/`barcode` from receipt lines now live here —
> a product is created/upserted for **every** receipt line so items reference it by `product_id`.

#### `price_points`
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| product_id | int NOT NULL → products.id (cascade) | |
| store_id | int NOT NULL → stores.id (restrict) | denormalized (see best-practices note) |
| **province_id** | int NOT NULL → provinces.id (restrict) | **was `region` text.** Defaults to user province at write time |
| **warehouse_id** | int → warehouses.id (set null) | nullable FK; repo resolves the warehouse # (`warehouses.code`) → id on write; NULL for non-warehouse sources |
| **current_unit_price** | numeric(10,2) **NOT NULL** | **was `price`.** The current effective/paid/shelf UNIT price. Always a unit price, never a line total. |
| **regular_unit_price** | numeric(10,2) **NOT NULL** | **was `regular_price`.** The regular (was) UNIT price; **mirrors `current_unit_price` when not on sale** (never null). |
| **is_on_sale** | boolean NOT NULL default false | explicit on-sale flag (`regular_unit_price > current_unit_price`), set on write |
| **verified** | boolean NOT NULL default false | source-of-truth override for price-drop eligibility. `true` → treat as a confirmed drop **immediately** (admin/cross-checked), bypassing the rule-of-N crowd threshold in `app_config`; `false` → fall back to rule-of-N. Read by `priceDropRepo` (an extra disjunct in the verified-group test). **Also written by the crowd:** once a (product, province, price) group reaches the rule-of-N, `priceDropRepo.markNewlyVerified` (called every sweep) stamps `verified=true` on every fresh row in that group. This makes verification **sticky** — the group stays verified even after its observations age past `PRICE_VERIFY_WINDOW_DAYS`, so the in-app trust badge and drop eligibility don't flip back to "unverified" once the crowd has agreed. Intentional; only genuine crowd agreement is written (flyer/admin rows verify through their own disjuncts, not this stamp). |
| source_type_id | int NOT NULL → price_source_types.id (restrict) | |
| source_ref | text | `receiptId:idx` · flyer batch · scrape job · deviceHash:date:price |
| **valid_from** | date | **always the first Monday (UTC) of the `observed_at` week** — set on every write, all sources |
| **valid_until** | date | **only ever set from a price-tag `EXP` date** (fanned out by product + province/warehouse). NULL otherwise. **NOT a price-drop input in this version** (see below). |
| observed_at | timestamptz NOT NULL default now() | real-world OBSERVATION time. **Mutable** — an ON CONFLICT re-observation advances it (and it can be backdated, e.g. a receipt's purchase date) |
| **created_at** | timestamptz NOT NULL default now() | **immutable** row-creation time — never touched by an ON CONFLICT update, so it preserves the original insert time even as `observed_at` moves. Tells "when we first recorded this row" apart from "when the price was observed". Migration `0008` backfills existing rows from `observed_at`. |
| **device_hash** | text **NOT NULL** | every observation carries a device hash (receipts/flyer-import now send a deviceId) |
| flags | jsonb | `{ obsSource, excluded, … }` |
| | index(product_id, observed_at) · index(source_type_id, observed_at) · index(source_type_id, province_id, valid_from) (active-flyer reads = this week's Monday) · UNIQUE(source_ref, product_id, province_id, source_type_id) — source_ref leads so the admin exclude-by-ref path is indexed; uniqueness/ON CONFLICT are order-insensitive | |

> **Dropped** `promo_price` (== current price, never read), stored `instant_savings` (derived =
> `regular_unit_price − current_unit_price` via shared helper), `ingested_at` (ghost), `region` (→ `province_id`).

**Price-point business rules (enforced in `pricesRepo`):**
1. Logged prices are **unit** prices, never line totals.
2. `regular_unit_price` **mirrors** `current_unit_price` when there's no discount (so it's never null).
3. `is_on_sale` is stored explicitly (`regular_unit_price > current_unit_price`).
4. `current_unit_price` and `regular_unit_price` are **NOT NULL**.
5. (column rename + dropped `products.unit_price` — see above).
6. `valid_from` is **always** the first Monday (UTC) of the `observed_at` week, for every source.
7. `device_hash` is **NOT NULL** — every writer supplies a device hash.
8. `valid_until` is set **only** from a price-tag `EXP` date, via `pricesRepo.applyTagExpiry`, which
   updates **all** matching `price_points` for that product within the scope (the exact warehouse when
   warehouse-keyed, else province-wide). It is **metadata only** — this version does **not** use
   `valid_until` as a price-drop signal (the verified-drop pipeline keys off `observed_at` recency).
   That is reserved for a future app version.

### Receipts

#### `receipts`
| column | type | notes |
|---|---|---|
| id | text PK | client UUID (idempotent upload) |
| user_sub | text NOT NULL → users.sub (cascade) | |
| store_id | int NOT NULL → stores.id (restrict) | receipt header store |
| warehouse_id | int → warehouses.id (set null) | specific warehouse bought at (resolved from the printed number); NULL for non-warehouse stores |
| purchase_date | date NOT NULL | |
| total | numeric(10,2) NOT NULL | |
| tax | numeric(10,2) | |
| source_id | int → receipt_sources.id (set null) | |
| status_id | int → receipt_statuses.id (set null) | |
| image_object_key | text | R2 object key |
| image_uploaded_at | timestamptz | |
| **raw_ocr** | **text NOT NULL** | **was `raw_ocr_hash`.** ITEMS/body OCR text/JSON; client sends it |
| header_ocr | text | store + warehouse identifying OCR, kept separate from raw_ocr |
| policy_status_id | int → policy_statuses.id (set null) | watching/claimed/expired; window read live from stores.adjustment_days (no snapshotted policy_window) |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete (price_points stay active) |
| | index(user_sub, purchase_date) | |

> **Dropped** `raw_ocr_hash` + `receipts_hash_idx` (the index was never queried — idempotency is
> on the client UUID `id`).

#### `receipt_items`
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| receipt_id | text NOT NULL → receipts.id (cascade) | |
| **product_id** | int **NOT NULL** → products.id (restrict) | the ONLY product identity |
| position | smallint NOT NULL | line order |
| quantity | numeric(8,3) NOT NULL default 1 | |
| unit_price | numeric(10,2) | |
| line_total | numeric(10,2) NOT NULL | |
| watch_enabled | bool NOT NULL default false | **full-price lines only** (no client override) |
| claimed_at | timestamptz | surfaced to client |
| claimed_savings | numeric(10,2) | surfaced to client |
| deleted_at | timestamptz | cascaded from receipt |
| | index(receipt_id) · index(product_id) | |

> **Dropped** `name`/`sku`/`barcode` (→ products; reads join products), `refund_received_at`.

#### `ocr_captures`  *(NEW 2026-10-03, migration 0017 — exact input/output of every live OCR call)*
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| user_sub | text → users.sub (set null) | the signed-in caller; NULL for an anonymous (older-build) call |
| receipt_id | text → receipts.id (set null) | linked AFTER the receipt arrives, by matching its raw_ocr item lines; NULL for abandoned scans |
| image_object_key | text NOT NULL UNIQUE | the exact bytes Google Vision received |
| response_object_key | text NOT NULL UNIQUE | gzipped envelope: Vision's verbatim response + request params, client scan context, timing |
| created_at | timestamptz NOT NULL default now() | |
| | index(user_sub, created_at) · index(receipt_id) | |

> Writer: `POST /api/ocr` → `lib/ocrCapture.captureInBackground` (after the response is sent, best-effort,
> kill switch `OCR_CAPTURE_ENABLED`). Linker: `POST /api/receipts` → `linkReceiptInBackground`.
> Readers: `GET /api/admin/receipts/:id` (`ocrCaptures` with presigned URLs) and
> `scripts/exportOcrCaptures.js` (turns captures into parser fixtures). Both objects are recorded in
> `object_retention` as `ocr_capture` before they are written and expire by age
> (`RETENTION_OCR_CAPTURES_DAYS`, 90) via `jobs/pruneOcrCaptures`, which also deletes the index row.
> Why the objects are not columns: the response is hundreds of KB of JSON per scan — object-store
> material, not row material. Full rationale: `Technical/OCR_Capture.md`.

#### `price_drop_notifications`  *(NEW — verified price-drop dedupe ledger)*
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| receipt_item_id | bigint NOT NULL → receipt_items.id (cascade) | the line whose buyer was notified |
| price_point_id | bigint → price_points.id (set null) | provenance: representative row of the verified price group; `set null` because crowd rows are deleted on consent revoke |
| price | numeric(10,2) NOT NULL | the verified price the push announced |
| sent_at | timestamptz NOT NULL default now() | |
| | UNIQUE (receipt_item_id, price) · index(price_point_id) | |

> Writer: the verified-drop sweep (`priceDropNotifier.runVerifiedDropSweep` → `priceDropRepo.recordNotified`),
> which records the row *before* the Expo send (at-most-once; the unique index is the race guard) and,
> in the same transaction, applies the incremental price-drop credit charge. Reader:
> the same sweep's `findNotifiable` `NOT EXISTS` dedupe — a line is re-notified only at a strictly lower
> verified price. **Documented exception to rule #6:** `price` duplicates the referenced
> price point's price because the FK is `set null` (consent revoke deletes crowd rows) and
> the dedupe comparison must survive that deletion. The user/province are NOT stored —
> derived via receipt_items → receipts → users.
>
> **Why it can look empty / unused:** a row is only ever written when the verified-drop sweep
> actually fires, which requires a drop to clear the crowd threshold — `PRICE_VERIFY_MIN_USERS`
> distinct contributors (rule-of-N, default 3) within `PRICE_VERIFY_WINDOW_DAYS`, *or* an
> admin-`verified` price point (`ADMIN_USER_SUBS` bypass). With few contributors and an empty
> `ADMIN_USER_SUBS`, no sweep elects a winner, so the table stays empty. That is expected — the
> table is **load-bearing** (dedupe + incremental billing), not dead. To exercise it in testing,
> add your sub to `ADMIN_USER_SUBS` so a single observation counts as verified.

### Credits, subscriptions, config

#### `credit_ledger`  *(renamed from `credits_ledger`; now also logs `scan_consume`)*
`id bigserial PK · user_sub text → users.sub (cascade) · delta int NOT NULL · balance_after int NOT NULL · type_id int → credit_event_types.id (restrict) · ref text · product_id text (external) · notes text · created_at` · index(user_sub, created_at)

> Every credit movement (grant, top-up, trial, price-tag, **and scan_consume**) is appended
> here atomically with the `users.scan_credits` mutation via `creditsRepo.applyCreditChange`.
> History served at `GET /api/me/credits`.

#### `credit_reconciliations`  *(new — admin-validated balance corrections)*
`id serial PK · user_sub text → users.sub (cascade) · balance int NOT NULL · ledger_sum int NOT NULL · drift int NOT NULL · breakdown jsonb · status text NOT NULL default 'pending' · detected_at timestamptz · last_checked_at timestamptz · resolved_by text · resolved_at timestamptz · resolution_ledger_id bigint → credit_ledger.id (set null) · notes text` · index(status, detected_at) · UNIQUE(user_sub) WHERE status='pending'

> The daily `reconcileCredits` cron replays every user's full `credit_ledger` history (all
> input/output paths) against the live `users.scan_credits`. Since every movement writes the
> ledger and a data reset deletes it outright, `balance == sum(delta)` must hold exactly —
> any drift means an out-of-band write (e.g. a manual edit done by error). A mismatch opens
> ONE pending case here (partial unique; repeat sweeps refresh it, vanished drift is closed
> as self-healed). Nothing is auto-corrected: an admin approves in-app (like the tag
> verifications) — apply sets balance := ledger sum and writes a delta-0 `reconcile_adjust`
> audit ledger row (`resolution_ledger_id`). `status` is free text like
> `tag_scan_reviews.status` (same review-queue lifecycle precedent, 3 fixed values).

#### `subscription_events`  *(unchanged; tier_id now → subscription_plans)*
`id bigserial PK · user_sub → users.sub (cascade) · rc_event_id text UNIQUE · type_id int → subscription_event_types.id (restrict) · tier_id int → subscription_plans.id (set null) · status_id int → subscription_statuses.id (set null) · product_id text · occurred_at timestamptz NOT NULL · raw_payload jsonb` · index(user_sub, occurred_at) · index(occurred_at)

#### `api_audit_log`  *(REMOVED — migration 0008_drop_api_audit_log)*
The per-request audit log moved off the database to structured JSON on stdout
(`backend/middleware/audit.js`), captured for free by the Railway log stream —
breadcrumbs, not authoritative data. No table remains.

#### `kv_state`  *(unchanged structure; now also persists the OCR-budget snapshot)*
`key text PK · value jsonb NOT NULL · updated_at timestamptz`

> Made functional: the in-memory OCR budget is snapshotted to `kv_state` on interval + graceful
> shutdown and restored on boot (replacing the `ocrBudget.json` file).

#### `warehouses`  *(unchanged; data backfilled)*
`id serial PK · code text · store_id int NOT NULL → stores.id (restrict) · province_id int → provinces.id (set null) · name text · city text · latitude double · longitude double · created_at · updated_at` · UNIQUE(store_id, code) · index(province_id)

> `city`/`latitude`/`longitude` already populated from `data/warehouses.json` (114/114 city,
> 113/114 coords). Action: backfill the 1 missing coordinate; no schema change.

#### `store_policies`  *(MERGED into `stores` — migration `0003_broken_psynapse`)*
The consumer-facing 20-retailer policy content (seeded from `data/policies.json`) now lives as
columns on `stores` (see above). The standalone table was dropped so `stores.visible` actually
gates every displayed store.

### Commented out / deleted

- **`watched_items` — table-creation code kept in `schema.js` but commented out** (not created
  by the migration). v1 price-drop notifications run off flyer `price_points` +
  `receipt_items.watch_enabled` (client-side check in `notificationService`). `watchedRepo.js`
  stays as dormant code with its call sites commented. Re-enable when a server-push registry is
  wanted.
- **`user_disabled_stores` — DROPPED.** Removes the `disabledStoreSubscriptions` profile opt-in.

---

## Seed changes (`backend/db/seed.js`)
- `countries`: add `currency` (CA→CAD, US→USD, FR→EUR, GB→GBP, MX→MXN).
- `price_source_types`: `crowdsourced` → `flyer_user_scan` ("Weekly flyer user scan").
- `subscription_event_types`: add `free_trial`.
- `subscription_plans`: seed `free` + `unlimited` for country CA, numeric prices.
- `credit_packs`: seed in its own table for country CA, numeric `price`.
- `notification_types`: seed the categories (defaults mirror the mobile `DEFAULT_PREFS`). 2026-09-25: + `notifScanReminders` (10), `notifMonthlyRecap` (11), `notifScanResults` (12), `notifAdminAlerts` (13), all default ON — seed rows only, no migration.
- `app_config` (notifications, 2026-09-25): `REENGAGEMENT_PUSHES_ENABLED` (default true — kill switch for the daily re-engagement job) and `SCAN_REMINDER_DAYS` (default 7). `kv_state` gains one row, `job:reengagement:slot` (the job's once-per-slot election).
- `credit_event_types`: add `referral_referrer_bonus` + `referral_referee_bonus`.
- `app_config`: add `REFERRAL_REFERRER_CREDITS` + `REFERRAL_REFEREE_CREDITS` (default 15 each, DB-tunable; read via `configService.getOpsConfig`, surfaced in the pricing payload).
- `app_config` (crowd_verification): `PRICE_VERIFY_MIN_USERS` (default 3 — distinct contributors that must observe the same price in the same province+country before a drop is push-worthy), `PRICE_VERIFY_WINDOW_DAYS` (default 14 — agreement freshness window), `ADMIN_USER_SUBS` (default `[]` — user subs whose own uploads bypass the rule of N; admin uploads still carry a province like every price point).
- Remove disabled-store seed paths. `seedWarehouses` unchanged.

## Derived values (compute in code, never stored)
- `instant_savings = regular_price − price` (when `regular_price` set, else 0) — shared helper
  used by `pricesRepo.shapeBarcodePrice`, receipt math, mobile.
- Plan/pack display price = format(`monthly_price`/`annual_price`/`price`, `country.currency`).

---

## Migration & Preview reset (no production; Preview branch only) — DONE 2026-06-06
1. `backend/db/schema.js` rewritten (pgSchema "priceback") to match this doc.
2. Delete `backend/db/migrations/*.sql` + `meta/`, then `cd backend && npm run db:generate`
   → fresh `0000_initial.sql`; manually prepend `CREATE SCHEMA IF NOT EXISTS "priceback";`
   (drizzle-kit omits it).
3. Reset the **Preview** Neon branch (`br-steep-breeze-aqeg0i38`, DB `priceback_db`) ONLY —
   never prod (`br-nameless-night-aq2jp9rm`), never a new branch:
   `DROP SCHEMA IF EXISTS priceback CASCADE; DROP SCHEMA IF EXISTS public CASCADE;
   CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO neondb_owner, public;`
   then `npm run db:migrate` (applies the migration → creates `priceback` + tables).
4. Seed: `node -e "require('dotenv').config(); require('./db/client').ensureSeeded()…"`
   (or boot the server) → populates lookups / plans / packs / warehouses / policies.
5. **Production deploy later:** run `npm run db:migrate` against the prod branch (creates
   `priceback`), then boot to seed. No `search_path`/role setup needed — fully qualified.

## Test-env note (Preview only)
The **app code is fully schema-qualified** and needs no `search_path`. A few **backend test
files** use raw `db.execute(sql)` with unqualified table names, so the Preview branch has a
role default set once for the test suite:
`ALTER ROLE neondb_owner IN DATABASE priceback_db SET search_path = priceback, public;`
This is a Preview test convenience only — production does not need it (the app qualifies every
query). Verified state: backend suite green, mobile suite 1301/1301, typecheck clean.

## Verification checklist
- `cd backend && npm test` (node --test vs Preview) · root `npm test` (jest) · `npm run typecheck`.
- `npm run db:generate` shows **no diff** after schema edits (schema ↔ migration in sync).
- Smoke on Preview:
  - Receipt POST → `receipt_items.product_id` NOT NULL, `receipts.raw_ocr` set, a `scan_consume`
    row in `credit_ledger`, `price_points.province_id` set.
  - Barcode lookup → derived `instant_savings`, province-aware price.
  - Flyer import → `products.unit_price` set, `price_points.source_type = flyer`.
  - `GET /api/v1/pricing.json` → plans/packs for the user's country with currency-formatted prices.
  - Restart → OCR budget restored from `kv_state`.
