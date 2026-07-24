# PriceBack — Database Schema Reference

> **Status:** Human-readable reference for the full current schema.
> **Source of truth:** `backend/db/deploy/schema.sql` (generated — never hand-edit)
> and the migration chain in `backend/db/migrations/0000…0011`. Reference-table
> seed values come from `backend/db/seed.js`. Regenerate the deploy file after any
> migration with `node scripts/build-consolidated-schema.js`.

Everything lives in the dedicated Postgres schema **`priceback`** (not `public`).
Conventions used throughout:

- **PK:** every table has a single primary key — usually `serial`/`bigserial`
  `id`, except `users` (PK `sub`, the auth subject), `devices` (PK `device_id`),
  `app_config`/`kv_state` (PK `key`), and the composite-key bookkeeping tables.
- **FKs:** all cross-table references are real foreign keys. Delete behaviour is
  noted per relation (`cascade`, `set null`, or `restrict`).
- **Money:** `numeric(10,2)`; rates `numeric(5,4)`. Currency derives from the
  owning country (`countries.currency`).
- **Time:** `timestamp with time zone`, default `now()`.
- **Discriminators / lookups:** small reference tables (`*_types`, `*_statuses`,
  `*_sources`) hold `(id, code, label)` rows; business tables FK to them by `id`.

---

## Table of contents

1. [Reference / lookup tables](#1-reference--lookup-tables)
2. [Geography & catalog](#2-geography--catalog)
3. [User management](#3-user-management)
4. [Consent & preferences](#4-consent--preferences)
5. [Credit management](#5-credit-management)
6. [Subscription management](#6-subscription-management)
7. [Referrals](#7-referrals)
8. [Pricing data](#8-pricing-data)
9. [Receipts & price-drop tracking](#9-receipts--price-drop-tracking)
10. [Crowdsourced price-tag scanning](#10-crowdsourced-price-tag-scanning)
11. [Operational / system](#11-operational--system)
12. [Functions & triggers](#12-functions--triggers)
13. [Entity-relationship overview](#13-entity-relationship-overview)

---

## 1. Reference / lookup tables

Small, mostly-static `(id, code, label)` tables seeded by `seed.js`. Business
rows FK to these by `id`; application code looks them up by `code`.

| Table | Purpose | Seeded codes |
|---|---|---|
| `countries` | Supported countries; carries `currency`. | `CA, US, FR, GB, MX` |
| `provinces` | Province/state within a country (`country_id` FK). Unique `(country_id, code)`. | CA provinces + a few US states |
| `subscription_statuses` | RevenueCat-style subscription state. | `active, expired, in_grace_period, in_billing_retry, cancelled, paused, unknown` |
| `subscription_event_types` | Webhook event kinds. | `INITIAL_PURCHASE, RENEWAL, CANCELLATION, UNCANCELLATION, NON_RENEWING_PURCHASE, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE, TRANSFER, SUBSCRIPTION_PAUSED` |
| `credit_event_types` | Ledger entry kinds (see §5). | `free_trial, topup_purchase, monthly_grant, scan_consume, admin_adjust, refund, migration_seed, signup_grant, price_tag_scan, price_tag_revoke, price_drop_charge, referral_referrer_bonus, referral_referee_bonus` |
| `receipt_sources` | How a receipt entered the system. | `ocr, manual, import` |
| `receipt_statuses` | Receipt processing state. | `pending, processed, rejected, needs_review` |
| `policy_statuses` | Per-receipt price-protection lifecycle (migration 0004). | `watching, claimed, expired` |
| `price_source_types` | Provenance of a `price_points` row. | `flyer, receipt_ocr, barcode_scan, flyer_user_scan, price_tag_scan, scrape, manual` |
| `consent_types` | Legal/marketing consents tracked. Has `required` + `current_version`. | `terms_of_service, privacy_policy, marketing_push, marketing_email` |
| `consent_sources` | Where a consent was captured. | `signup, settings_screen, admin, migration` |
| `notification_types` | Toggleable push categories. Has `is_master`, `default_enabled`, `sort_order`. | `notificationsEnabled` (master), `notifUrgentClaims, notifClaimReminders, notifDailyDigest, notifDropCharge, notifFriendJoins, notifFlaggedVerified, notifOtherCredit, notifLowBalance` |

---

## 2. Geography & catalog

### `stores`
The single source for both the operational FK target **and** consumer-facing
price-protection policy content (migration 0003 merged the old `store_policies`
table into this one).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text, unique | e.g. `costco`, `walmart` |
| `name` | text | Display name |
| `country_id` | int → `countries` (set null) | |
| `visible` | bool, default true | Renamed from `active` in 0001. Hides the store app-wide. |
| `enabled` | bool, default false | Whether price-protection is offered for this store. |
| `short_name` | text | |
| `adjustment_days` | int, default 0 | Price-protection window length in days. |
| `color`, `emoji`, `icon_name` | text | UI styling. |
| `category` | jsonb | Localized category labels. |
| `website`, `price_check_url` | text | |
| `policy_url`, `policy_note`, `claim_steps`, `receipt_keywords` | jsonb | Localized policy content / receipt-matching keywords. |
| `last_verified_at`, `content_updated_at` | date | |
| `sort_order` | int, default 0 | |
| `created_at`, `updated_at` | timestamptz | `updated_at` auto-bumped by a trigger (see §12). |

Indexes: `stores_enabled_idx`, `stores_sort_idx`.

### `warehouses`
Physical Costco-style locations under a store, for location-specific pricing.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text | Unique with `store_id`. |
| `store_id` | int → `stores` (restrict) | |
| `province_id` | int → `provinces` (set null) | |
| `name`, `city` | text | |
| `latitude`, `longitude` | double precision | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: unique `(store_id, code)`, `warehouses_province_idx`.

### `products`
Catalog of items, keyed per store by SKU.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `store_id` | int → `stores` (restrict) | |
| `sku` | text | Unique with `store_id`. |
| `barcode` | text | UPC/EAN; filled by the off-Railway image harvester. Indexed. |
| `display_name` | text | |
| `created_at` | timestamptz | |

Indexes: unique `(store_id, sku)`, `products_barcode_idx`.

---

## 3. User management

### `users`
Primary account record. **PK is `sub`** (the Google/auth subject string), not an
integer id.

| Column | Type | Notes |
|---|---|---|
| `sub` | text PK | Auth subject identifier. |
| `email` | text | Indexed. |
| `name`, `picture` | text | Profile. |
| `postal_code` | text | Canonical formatted form. |
| `country_id` | int → `countries` (restrict) | |
| `province_id` | int → `provinces` (set null) | |
| `push_token` | text | Expo push token. |
| `subscription_tier_id` | int → `subscription_plans` (restrict) | Current plan. |
| `subscription_status_id` | int → `subscription_statuses` (set null) | |
| `subscription_expires_at`, `subscription_updated_at` | timestamptz | |
| `scan_credits` | int, default 0 | **Live credit balance** (mirrors the ledger's last `balance_after`). |
| `trial_credits_granted_at` | timestamptz | Guards one-time trial grant. |
| `last_topup_event_id`, `last_topup_product_id` | text | Idempotency for top-ups. |
| `referral_code` | text, unique | This user's own shareable code. |
| `referred_by` | text → `users.sub` (set null) | Who referred them. Indexed. |
| `referrals_count` | int, default 0 | |
| `status` | bool, default true | Account active flag (0002). |
| `deletion_requested_at`, `data_reset_at` | timestamptz | GDPR/data lifecycle (0002, 0006). |
| `active_subscription_device_id` | text | Single-device binding — last device wins (0007). |
| `subscription_claimed_at` | timestamptz | When the current device claimed the sub. |
| `flagged`, `flagged_at`, `flag_reason` | bool / timestamptz / text | Fraud review; blocks credits + subscription (0007). |
| `created_at`, `updated_at` | timestamptz | |

### `devices`
Per-install device records (anti-abuse + single-device subscription binding).

| Column | Type | Notes |
|---|---|---|
| `device_id` | text PK | |
| `scan_count` | int, default 0 | |
| `first_seen`, `last_seen` | timestamptz | |
| `owner_sub` | text → `users.sub` (set null) | Indexed. |
| `reset_at` | timestamptz | Device reset marker (0002). |
| `device_hash` | text | `substr(sha256(device_id),1,16)` — maps anonymous `price_points.device_hash` back to the owner at credit-settlement time (0009). Indexed. |

### `subscription_device_claims` (audit trail, 0007)
Append-only log of which device claimed a subscription and when.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_sub` | text → `users.sub` (cascade) | |
| `device_id` | text | |
| `claimed_at` | timestamptz | |

Index: `(user_sub, claimed_at)`.

---

## 4. Consent & preferences

### `consent_events`
Append-only, legally-meaningful consent log (one row per grant/revoke).

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_sub` | text → `users.sub` (cascade) | |
| `consent_type_id` | int → `consent_types` (restrict) | |
| `granted` | bool | |
| `version` | text | Version of the legal text agreed to. |
| `source_id` | int → `consent_sources` (restrict) | |
| `ip_hash`, `user_agent` | text | Audit context. |
| `occurred_at` | timestamptz | |

Index: `(user_sub, consent_type_id, occurred_at)`.

### `user_preferences` (one row per user)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `user_sub` | text → `users.sub` (cascade), **unique** | |
| `language` | text | |
| `preferred_warehouse_id` | int → `warehouses` (set null) | |
| `auto_reload_enabled` | bool, default false | Credit auto-reload (prompted, never silent). |
| `auto_reload_pack_id` | int → `credit_packs` (set null) | |
| `low_balance_warn_at` | int | Threshold for the low-balance notification. |
| `created_at`, `updated_at` | timestamptz | |

### `user_notification_settings`
Per-user, per-category push toggle. Unique `(user_sub, notification_type_id)`;
absence means "fall back to the type's `default_enabled`" (fail-open gating).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `user_sub` | text → `users.sub` (cascade) | |
| `notification_type_id` | int → `notification_types` (restrict) | |
| `enabled` | bool | |
| `updated_at` | timestamptz | |

---

## 5. Credit management

PriceBack's currency is **scan credits**. `users.scan_credits` is the live
balance; `credit_ledger` is the immutable, auditable history of every change.

### `credit_packs`
Purchasable top-up packs (catalog, per country).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text | Unique with `country_id` (RevenueCat SKU). |
| `country_id` | int → `countries` (restrict) | |
| `label` | text | |
| `credits` | int | Credits granted by the pack. |
| `price` | numeric(10,2) | |
| `description`, `best_for` | text | |
| `active`, `hidden` | bool | Catalog visibility. |
| `sort_order` | smallint | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: unique `(country_id, code)`, `active`, `sort_order`.

### `credit_ledger`
Append-only double-entry-style log. Every credit change writes one row carrying
the signed `delta` **and** the resulting `balance_after`, so the balance is
always reconstructable and tamper-evident.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_sub` | text → `users.sub` (cascade) | |
| `delta` | int | Signed change (+grant / −spend). |
| `balance_after` | int | Running balance after this row. |
| `type_id` | int → `credit_event_types` (restrict) | What caused the change (see table below). |
| `ref` | text | Correlating id (receipt id, RC event id, etc.). |
| `product_id` | text | RevenueCat SKU for purchases (text, not a catalog FK). |
| `notes` | text | Human-readable note. |
| `created_at` | timestamptz | |

Index: `(user_sub, created_at)`.

**`credit_event_types` (the `type_id` vocabulary):**

| code | Meaning | Sign |
|---|---|---|
| `free_trial` | One-time trial credits at signup. | + |
| `signup_grant` | Free signup grant. | + |
| `monthly_grant` | Recurring plan allotment. | + |
| `topup_purchase` | Bought a `credit_pack`. | + |
| `refund` | Reversal of a charge/purchase. | + |
| `admin_adjust` | Manual admin correction. | ± |
| `migration_seed` | Backfilled balance on migration. | ± |
| `scan_consume` | Spent on an OCR/scan operation. | − |
| `price_drop_charge` | Charged when a tracked price drop is detected (15 cr/$; renamed from the old "commission" in 0007). | − |
| `price_tag_scan` | Reward for a verified in-warehouse price-tag contribution (see §10). | + |
| `price_tag_revoke` | Clawback of a previously-granted tag reward (rejected on review). | − |
| `referral_referrer_bonus` | Bonus to the inviter (see §7). | + |
| `referral_referee_bonus` | Bonus to the invited friend. | + |

Tag-credit business rules are parameterised in `app_config` (keys
`PRICE_TAG_CREDIT_REWARD`, `PRICE_TAG_WEEKLY_CREDIT_CAP`,
`PRICE_TAG_MONTHLY_CREDIT_CAP`, `PRICE_TAG_ABUSE_RESCAN_THRESHOLD`).

---

## 6. Subscription management

### `subscription_plans`
Tier catalog (per country). Seeded tiers: `free`, `unlimited`.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text | Unique with `country_id`. |
| `country_id` | int → `countries` (restrict) | |
| `label` | text | |
| `active`, `hidden`, `popular` | bool | Catalog flags. |
| `precedence` | int | Ordering/upgrade ranking. |
| `scans_per_month`, `claims_per_month` | int | Quota (null = unlimited). |
| `monthly_product_id`, `annual_product_id` | text | RevenueCat SKUs. |
| `monthly_price`, `annual_price` | numeric(10,2) | |
| `icon_name`, `description`, `best_for` | text | |
| `feature_keys`, `features` | jsonb | Marketing feature lists. |
| `sort_order` | smallint | |
| `created_at`, `updated_at` | timestamptz | |

> Note: the old `commission_rate` column was dropped in 0007 (commission model removed).

Indexes: unique `(country_id, code)`, `active`, `sort_order`.

### `subscription_events`
Immutable RevenueCat webhook log; drives the user's current subscription state.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_sub` | text → `users.sub` (cascade) | |
| `rc_event_id` | text, unique | RevenueCat event id — idempotency key. |
| `type_id` | int → `subscription_event_types` (restrict) | |
| `tier_id` | int → `subscription_plans` (set null) | |
| `status_id` | int → `subscription_statuses` (set null) | |
| `product_id` | text | RevenueCat SKU. |
| `occurred_at` | timestamptz | |
| `raw_payload` | jsonb | Full webhook body. |

Indexes: `(user_sub, occurred_at)`, `(occurred_at)`.

---

## 7. Referrals

### `user_referrals`
One row per referral relationship; links each side to the ledger row that paid
its bonus (so payout can be deferred and audited).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `referrer_sub` | text → `users.sub` (set null) | Inviter. Indexed. |
| `referee_sub` | text → `users.sub` (set null) | Invited friend. **Unique** (a user can be referred once). |
| `referrer_reward_ledger_id` | bigint → `credit_ledger` (set null) | The inviter's bonus row (null until paid). |
| `referee_reward_ledger_id` | bigint → `credit_ledger` (set null) | The friend's bonus row. |
| `created_at` | timestamptz | |

`users.referral_code` / `users.referred_by` / `users.referrals_count` hold the
denormalized counters and code lookups.

---

## 8. Pricing data

### `price_points`
The central price observation table. **Every observed price** — flyer, receipt
OCR, barcode lookup, in-warehouse tag scan, scrape, manual — becomes one row
here.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `product_id` | int → `products` (cascade) | |
| `store_id` | int → `stores` (restrict) | |
| `province_id` | int → `provinces` (restrict) | |
| `warehouse_id` | int → `warehouses` (set null) | Location-specific observations. |
| `current_unit_price` | numeric(10,2) | The observed price. |
| `regular_unit_price` | numeric(10,2) | Non-sale reference price. |
| `is_on_sale` | bool, default false | |
| `source_type_id` | int → `price_source_types` (restrict) | Provenance. |
| `source_ref` | text | Dedup key (flyer id, receipt id, …). |
| `valid_from`, `valid_until` | date | Flyer/sale validity window. |
| `observed_at` | timestamptz | **Mutable** real-world observation time; an `ON CONFLICT` re-observation advances it (and it can be backdated to a receipt's purchase date). |
| `created_at` | timestamptz | **Immutable** row-insert time (0008); never touched by `ON CONFLICT`. |
| `device_hash` | text | Anonymous contributor hash (no identity stored on crowd rows). |
| `verified` | bool, default false | Admin/crowd-verified (0002); gates tag-credit release. |
| `flags` | jsonb | e.g. `{ excluded: true }` for rejected tag scans. |

Key indexes: `(product_id, observed_at)`, `(source_type_id, observed_at)`,
`(source_type_id, province_id, valid_from)` (active flyer lookups),
`(device_hash, source_type_id)`, and the unique dedup index
`(source_ref, product_id, province_id, source_type_id)`.

---

## 9. Receipts & price-drop tracking

### `receipts`
A scanned/entered purchase receipt. Soft-deletable (`deleted_at`); deleting hides
the receipt + items but **keeps** their `price_points` (the billable remnant).

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | Client-generated id. |
| `user_sub` | text → `users.sub` (cascade) | |
| `store_id` | int → `stores` (restrict) | |
| `warehouse_id` | int → `warehouses` (set null) | Specific warehouse the receipt was bought at (0002). |
| `purchase_date` | date | |
| `total`, `tax` | numeric(10,2) | |
| `source_id` | int → `receipt_sources` (set null) | |
| `status_id` | int → `receipt_statuses` (set null) | |
| `image_object_key` | text | R2 object key for the receipt image. |
| `image_uploaded_at` | timestamptz | |
| `raw_ocr` | text | Items/body OCR text. |
| `header_ocr` | text | Store + warehouse identifying OCR, kept separate from `raw_ocr` (0002). |
| `policy_status_id` | int → `policy_statuses` (set null) | watching/claimed/expired. Window read live from `stores.adjustment_days` (0002 dropped the snapshotted `policy_window`). |
| `created_at`, `deleted_at` | timestamptz | |

Index: `(user_sub, purchase_date)`.

### `receipt_items`
Line items of a receipt.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `receipt_id` | text → `receipts` (cascade) | Indexed. |
| `product_id` | int → `products` (restrict) | Indexed. |
| `position` | smallint | Line order. |
| `quantity` | numeric(8,3), default 1 | |
| `unit_price` | numeric(10,2) | |
| `line_total` | numeric(10,2) | |
| `watch_enabled` | bool, default false | Whether this line is watched for price drops. |
| `claimed_at`, `claimed_savings` | timestamptz / numeric | Price-protection claim record. |
| `ignored` | bool, default false | Fee-like lines (deposits, eco fees): stay visible but record **no** `price_point` and are never watched (0011). Distinct from `watch_enabled=false`, which still records a crowd price point. |
| `deleted_at` | timestamptz | Soft delete. |

### `price_drop_notifications`
One row per price-drop alert sent for a watched item (dedup on `(item, price)`).

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `receipt_item_id` | bigint → `receipt_items` (cascade) | |
| `price_point_id` | bigint → `price_points` (set null) | The triggering observation. |
| `price` | numeric(10,2) | Price that fired the alert. |
| `sent_at` | timestamptz | |

Indexes: unique `(receipt_item_id, price)`, `(price_point_id)`.

---

## 10. Crowdsourced price-tag scanning

Deferred, verification-gated, capped reward system for in-warehouse price-tag
photos. Credit is released only once a tag's savings is verified (rule-of-N
distinct contributors agree, or an admin verifies the `price_points` row), paid
once per contributor per (product, scope, calendar week), and capped per user.

### `tag_scan_attempts` (0009) — abuse counter
Composite PK `(device_hash, sku, scope_key)`. Incremented on **every** submission
(including duplicates); crossing `PRICE_TAG_ABUSE_RESCAN_THRESHOLD` soft-flags the
user and earns no further credit.

| Column | Type |
|---|---|
| `device_hash`, `sku`, `scope_key` | text (composite PK) |
| `attempts` | int, default 0 |
| `first_at`, `last_at` | timestamptz |

### `tag_credit_settlements` (0009) — pay-once election
Composite PK `(product_id, scope_key, week_start)`. Records that the one weekly
credit for a (product, scope) has been settled, so only one contributor is paid.

| Column | Type | Notes |
|---|---|---|
| `product_id` | int → `products` (cascade) | |
| `scope_key` | text | warehouse/province scope. |
| `week_start` | date | Monday of the settlement week. |
| `settled_at` | timestamptz | |

### `tag_scan_reviews` (0010) — admin OCR review queue
One row per tag observation that carried OCR text. An admin Verifies (marks the
linked `price_points` row `verified=true`, releasing the deferred credit) or
Rejects (sets `flags.excluded`).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `price_point_id` | bigint → `price_points` (set null) | |
| `device_hash` | text | |
| `sku` | text | |
| `raw_ocr` | text | Raw Vision OCR text. |
| `parsed` | jsonb | Parsed-field snapshot. |
| `warehouse_id` | int → `warehouses` (set null) | |
| `province_id` | int → `provinces` (set null) | |
| `image_object_key` | text | R2 tag image. |
| `status` | text, default `pending` | pending/verified/rejected. |
| `reviewed_by`, `reviewed_at` | text / timestamptz | |
| `created_at` | timestamptz | |

Indexes: `(status, created_at)`, `(price_point_id)`.

---

## 11. Operational / system

### `app_config`
Runtime configuration knobs (no hardcoded business values). PK is `key`; `value`
is jsonb. Categories include `billing`, `fraud`, etc.

| Column | Type |
|---|---|
| `key` | text PK |
| `value` | jsonb |
| `category`, `description` | text |
| `updated_at` | timestamptz |

### `kv_state`
Generic key/value store for internal job/cursor state (jsonb `value`, PK `key`).

### `api_audit_log` *(removed — migration 0008)*
The per-request audit trail moved **off the database** to structured JSON on
stdout (`backend/middleware/audit.js`), captured for free by the Railway log
stream. Each line is `{"t":"api", ts, requestId, userSub, deviceId, route,
method, statusCode, durationMs, ipHash}`. Migration `0008_drop_api_audit_log`
drops the table.

---

## 12. Functions & triggers

### `priceback.touch_updated_at()` (migration 0005)
`plpgsql` trigger function that sets `NEW.updated_at = now()` and returns `NEW`.

### Trigger `stores_touch_updated_at`
`BEFORE UPDATE ON priceback.stores FOR EACH ROW EXECUTE touch_updated_at()`.
Guarantees `stores.updated_at` advances on **every** row update — including
hand-edits via SQL/console — so the mobile app's policies payload `rev`
(`max(updated_at)` across all store rows) strictly increases on any change
(visibility/enablement toggles included), without manually bumping
`content_updated_at`.

The `pgcrypto` extension is created best-effort in 0009 to backfill
`devices.device_hash`.

---

## 13. Entity-relationship overview

```
countries ──< provinces ──< warehouses
    │             │              │
    │             └──────────────┼─────< price_points >── products >── stores
    │                            │            │                          │
    └──< stores ─────────────────┘            │                          │
    └──< subscription_plans                   │                          │
    └──< credit_packs                         │                          │
                                              │                          │
users (PK sub)                                │                          │
  ├──< devices                                │                          │
  ├──< consent_events ── consent_types        │                          │
  ├──1 user_preferences ── warehouses/credit_packs                       │
  ├──< user_notification_settings ── notification_types                  │
  ├──< user_referrals (referrer/referee, → credit_ledger)                │
  ├──< credit_ledger ── credit_event_types                               │
  ├──< subscription_events ── subscription_event_types/plans/statuses    │
  ├──< subscription_device_claims                                        │
  └──< receipts ── stores/receipt_sources/receipt_statuses/policy_statuses
            └──< receipt_items ── products
                    └──< price_drop_notifications ── price_points

Crowd tags:  price_points ──1 tag_scan_reviews ── warehouses/provinces
             products ──< tag_credit_settlements
             tag_scan_attempts (device_hash, sku, scope)

System: app_config, kv_state   (api_audit_log removed — now stdout JSON, migration 0008)
```

**Delete-cascade summary** (what disappears when a `users` row is deleted):
`consent_events`, `user_preferences`, `user_notification_settings`,
`credit_ledger`, `subscription_events`, `subscription_device_claims`, and
`receipts` (→ `receipt_items` → `price_drop_notifications`) all cascade.
`devices.owner_sub`, `users.referred_by`, and `user_referrals` sides are set
null. `price_points` are **retained** (anonymous crowd data, keyed by
`device_hash` not `user_sub`).
