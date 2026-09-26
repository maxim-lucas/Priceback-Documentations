# Price-Drop Guarantee

> **Subscribe to Unlimited Annual. If PriceBack finds no price drop on your receipts
> during that year, we add another year of Unlimited to your account.**
>
> Asked by Maxim on 2026-09-25 (/goal) as "our strongest marketing campaign (money is
> guaranteed)". Built on `feat/price-drop-guarantee` off `main`. Official terms:
> https://priceback.ca/guarantee (EN) · /guarantee-fr (FR). Marketing backlog:
> `social-media-manager/docs/material-ideas-to-be-created.md`.

## 1 · The decisions that shape it

| Decision | Chosen | Why |
| --- | --- | --- |
| How the free year is granted | **Locally, in our database** — the backend writes `users.subscription_*` itself | Maxim: *"it shouldn't be on RevenueCat, we don't refund, we renew the subscription locally in the database, this should avoid any commission for apple or android platforms"* |
| The store keeps auto-renewing | Judge the year **14 days before** renewal, tell the customer to turn auto-renew off; the free year starts **when the paid subscription ends** — a customer charged anyway keeps it (**banked**) | A local grant cannot stop an App Store / Play charge; nothing is ever refunded |
| Who is covered | Paid annual years that **start on or after `GUARANTEE_START_DATE`** (2026-09-25) — new purchases and existing subscribers' next renewal | "start schedule in 1 year": the first free years are granted about a year after launch |
| How often | **One free year per account, ever**; every paid annual year is covered until it is earned once | caps the cost; simple to explain |
| In-app wording | *"we add another year of Unlimited to your account"* — never "free" on purchase surfaces | App Review rejected 2.8.20 under 3.1.2(c) for a free-period word; `noFreeTrialClaims.test.js` now guards `guarantee.*` too |

## 2 · The four conditions — and how each is checked

| Condition (ask) | Implemented as | Anti-gaming note |
| --- | --- | --- |
| Account subscribed annually | Enrolment only from a **paid** annual year: RevenueCat `INITIAL_PURCHASE` / `RENEWAL` / `UNCANCELLATION` for the catalog's annual SKU (Play's `:baseplan` suffix tolerated), `period_type = NORMAL`, not sandbox. A switch off annual (`PRODUCT_CHANGE` → monthly) ends the year. | Trials, intro/promotional periods and sandbox (TestFlight / App Review) never enrol |
| Scanned at least 15 receipts | `countQualifyingReceipts`: **distinct** (store, purchase date, total) receipts uploaded in the covered year, **not deleted**. `GUARANTEE_MIN_RECEIPTS` (15). | One receipt scanned 15 times counts once |
| Didn't get any drops | A price drop **found** during the year ends it: the verified-drop sweep stamps `first_drop_at` from its **raw** `findNotifiable` candidates — **before** the push-token and mute filters. Defence in depth: the drop ledger (`price_drop_notifications`) for the user's items, **including soft-deleted** receipts. | The ledger alone would have been gameable: a drop is recorded only when a push is actually sent, so denying notifications or muting drop alerts would have "earned" the year. *Reset All Data* hard-deletes receipts (and their ledger rows) — the stamp on the guarantee row survives it. |
| Didn't cancel / get a refund | A refund (`CANCELLATION` with `cancel_reason = CUSTOMER_SUPPORT`, or the REST subscriber's `refunded_at` on a sync) ends the year **and takes back an earned year that has not started**. Auto-renew off at the check → waits (it can be turned back on) until the renewal date, then `lost_cancelled`. An early end (`EXPIRATION`, a `TRANSFER` away) → `lost_lapsed`. | After earning, turning auto-renew off is exactly what the customer is asked to do — it is not a disqualification |

## 3 · Data (migration `0012_price_drop_guarantee`)

- **`guarantee_statuses`** (lookup, seeded): `enrolled`, `earned`, `granted`, `completed`,
  `lost_price_drop`, `lost_receipts`, `lost_refund`, `lost_cancelled`, `lost_switched`,
  `lost_lapsed`. The seed insert is **guarded** — if this code ever boots against a
  database without 0012, the seed logs a warning instead of failing (every `lookupId`
  in the app awaits the seed).
- **`price_drop_guarantees`** — one row per covered annual year: `user_sub` (FK users,
  cascade), `status_id`, `period_starts_at`, `period_ends_at`, `first_drop_at`,
  `receipts_counted`, `evaluated_at`, `free_starts_at`, `free_ends_at`. Unique
  `(user_sub, period_starts_at)`; index `(status_id, period_ends_at)`. **RLS on.**
  Kept apart from `subscription_events` on purpose: that table is pruned at 365 days,
  exactly the span this record must cover. Data-cleanup coverage: cascade bucket.
- Seeded extras: `subscription_event_types.guarantee_grant` (audit row when a year
  starts), `notification_types.notifGuarantee`.

## 4 · Lifecycle

```
            RC webhook / sync (paid annual year, start ≥ GUARANTEE_START_DATE,
            account never rewarded)
                          │
                          ▼
   ┌──────────── enrolled ─────────────┐   refund / switch off annual / early end
   │  sweep stamps first_drop_at       ├──► lost_refund · lost_switched · lost_lapsed
   │  daily job judges from D−14       │
   └───────┬───────────────┬───────────┘
           │ all 4 met     │ drop found → lost_price_drop
           │               │ at renewal: receipts short → lost_receipts
           ▼               │             auto-renew off → lost_cancelled
        earned  ── refund before it starts ──► lost_refund
           │  (store keeps renewing? the year stays banked)
           │  paid plan ends: RC EXPIRATION → setSubscriptionState floor
           ▼  (or the daily job's backstop)
        granted  ── free_ends_at passes (daily job) ──► completed
```

## 5 · The local renewal — the floor in `usersRepo.setSubscriptionState`

`setSubscriptionState` is the single writer of subscription state (RC webhook ×2,
TRANSFER, sync ×2, the daily job). Every write first passes `_guaranteeFloor`:

- **A year is running** (`granted`, `free_ends_at > now`): a write that would drop the
  customer (tier free, status expired, an expiry in the past) is replaced by
  `{ tier: unlimited, status: active, expiresAt: free_ends_at }`; a paid write with an
  earlier dated expiry is raised to `free_ends_at`; a longer store plan or a lifetime
  (`null`) expiry is left alone.
- **An earned year is waiting** and the write would end the paid plan: the year
  **starts in this write** (`activateEarned` → `granted`, one calendar year from now),
  plus a `guarantee_grant` row in `subscription_events`.
- **Fail-open:** any error applies the write exactly as requested — a floor that
  threw would fail the RevenueCat webhook itself. The daily job re-applies a running
  year the users row lost (self-healing within a day).

Everything downstream is untouched and simply sees Unlimited:
`effectiveScanTier` / `isCreditExempt` (no scan or drop charges), `/api/me`, the
single-device claim, and the app's server-wins `reconcileWithServer` — **including app
versions already installed**. `/api/me` adds `subscription.subscriptionSource =
"guarantee"` and a `guarantee` object for the new app screens.

## 6 · The daily job — `backend/jobs/priceDropGuarantee.js`

Cron `30 17 * * *` (17:30 UTC, after the 17:00 re-engagement slot) + a boot catch-up at
4 minutes. Each run:

1. **Judge** every `enrolled` year whose check date (`period_ends_at − GUARANTEE_NOTICE_DAYS`)
   has arrived — `lib/priceDropGuarantee.judgeYear`. Receipts and ledger drops are counted
   up to the **period end**, never "now": they are stamped by the database clock, and a
   bound taken from the app server's clock dropped just-uploaded receipts whenever the two
   disagreed (caught by the full backend suite, fixed before merge).
2. **Start** earned years whose paid plan is no longer in force — written as the lapse
   RevenueCat never delivered, so the floor starts the year (one code path for every start).
3. **Close** running years past `free_ends_at` (→ `completed`, customer written back to
   free unless a store plan bought since keeps them paid); **heal** running years the users
   row lost.
4. **Push** — elected once per slot (`kv_state` key `job:guarantee:slot`), daytime only
   (until 22:30 UTC), to the `explicitOnly` audience of `notifGuarantee`:
   `guarantee_earned` (years earned since the previous slot), `guarantee_renewal_reminder`
   (earned, still auto-renewing, `GUARANTEE_REMINDER_DAYS` before the store would charge —
   repeats every year while the year stays banked), `guarantee_ending` (14 days before the
   free year ends). Copy: `lib/pushI18n.js` (EN + FR), the deadline is the day **before**
   the renewal (stores renew in the final 24 h).

State steps run on every call (idempotent, serialised per customer by an advisory lock);
a failed step fails the run in `job_runs` after the others have run.

## 7 · Configuration (`app_config`, category `guarantee`)

| Key | Default | Note |
| --- | --- | --- |
| `GUARANTEE_ENROLLMENT_OPEN` | `true` | Stops **new** covered years and hides the promotion in the app. Never takes back an enrolled or earned year. |
| `GUARANTEE_START_DATE` | `2026-09-25` | Only years starting on/after it are covered. **Must never be later than the first day the promise was shown anywhere** (site, app, social). |
| `GUARANTEE_MIN_RECEIPTS` | `15` | Published in the terms. Lowering is always safe; **raising it breaks the terms for open years** — don't. |
| `GUARANTEE_NOTICE_DAYS` | `14` | Published in the terms. 2–60. |
| `GUARANTEE_REMINDER_DAYS` | `3` | Must be inside the notice window. |

## 8 · The app

`src/services/guaranteeService.js` caches the `/api/me` object in the account cache (wiped
on sign-out / reset) and maps every code to a label (unknown → a generic label, never a
code). Surfaces: a **one-time launch sheet** on Home (`GuaranteeIntroSheet`; new installs
see onboarding's 4th slide instead), the **Home card** (`GuaranteeCard`: promo / progress
X/15 / earned + "Manage in App Store/Google Play" / active / outcome), the **Guarantee
screen** (steps, the four conditions, the auto-renew note, terms link), the Annual
**callout** on the paywall (links to the terms page) and on *Plan & credits* (opens the
screen; during a guarantee year the plan row reads "Guarantee year · until …" and the plan
switch / cancel controls are hidden), FAQ 15–16, the *Your plan → Price-Drop Guarantee*
notification switch, and the admin account report (plain-English outcome per year).

## 9 · Claims & disclosures

- **App Store 3.1.2(c):** no free-period word on purchase surfaces; the guarantee is not
  an introductory/promotional offer and nothing about the App Store product changes. See
  `Publishing-Compliance/REVIEWER_NOTES.md`.
- **Competition Act s. 74.01(1)(c) (guarantees) / Quebec LPC s. 219:** a guarantee must be
  carried out and not materially misleading in its general impression. Every material
  condition — including that the store keeps renewing and what happens if it charges — is
  on the terms page, the app screen, the FAQ and the store listing, and the conditions line
  travels with every marketing asset (`social-media-manager` doc § 2).
- The website is the legal source of truth: `/guarantee#terms` (EN) and
  `/guarantee-fr#terms` (FR), referenced from Terms of Service § 4.8.

## 10 · Production runbook

**Order:** apply 0012 to production **before** the app PR merges (Railway deploys `main`).
The code degrades safely without it (every guarantee path is try/catch'd and the seed is
guarded), but the feature does nothing and the daily job fails until it is applied.

1. Run `backend/db/migrations/0012_price_drop_guarantee.sql` against production (idempotent
   DDL, session pooler 5432).
2. Insert the ledger row — LF-normalised hash, per `Migration_Consolidation_2026-07.md`:
   `hash = 30b6e9be07ed6114a5254d40e3ba6f9b93a311ddd67e58bbdcf8f57e189c53d7`,
   `created_at = 1790400000000`, guarded by `WHERE NOT EXISTS (… hash = …)`.
3. Verify: both tables exist with `relrowsecurity = true`; after the deploy boots,
   `guarantee_statuses` has 10 rows.
4. Regenerate `backend/db/deploy/schema.sql` (`scripts/build-consolidated-schema.js`) —
   **still owed**: the session that built this could not run it.
5. Dev (`gnedluuylimjwdmtvswl`) was migrated on 2026-09-25 (ledger id 36).

**Done 2026-09-26:** production (`xjfrlzwonyaorwktnkpj`) migrated through the Supabase
connector in one transaction — both tables, RLS on, both FKs, three indexes, ledger row
**id 23** — before Priceback#361 merged (`a47e88d`). After the deploy booted: 10
`guarantee_statuses`, `notifGuarantee`, `guarantee_grant` and the five `GUARANTEE_*`
`app_config` rows were seeded, and the job's boot catch-up ran **ok** (01:27 UTC, 72 ms,
nothing to judge yet).

**Support — "why didn't I get my free year?"** Admin → Accounts → the account → *Purchases
→ Price-Drop Guarantee*: each covered year with its outcome in plain English, the date a
drop was found, the receipts counted and the free-year dates.

## 11 · Known limits

- After the paid year ends, the **device** may show free until its next cold start: the
  local premium cache expires at the old store date and `reconcileWithServer` only runs at
  boot. The server honours the year throughout (scans and drops are never charged).
- If a refund's `CANCELLATION` arrives **after** the `EXPIRATION` that started the year,
  the running year is not taken back (RevenueCat normally sends the cancellation first).
- An account deleted and re-created is a new account (a new paid annual year is needed).

## 12 · Tests

Backend: `tests/priceDropGuarantee.test.js` (rules, 34), `tests/priceDropGuaranteeJob.test.js`
(orchestration, 10), `tests/priceDropGuaranteeDb.test.js` (real Postgres: enrolment rules,
refund, switch, the no-push-token drop, receipt de-duplication, earn → EXPIRATION → start,
the floor holding against a second EXPIRATION and the sync's lapse write, banking,
one-per-account, completion, `/api/me`). Mutation-checked: the drop verdict, the sweep's
stamp and the floor each turn their tests red when disabled. App: `__tests__/guarantee.test.js`
(20), the reconcile case in `purchaseService.test.js`, `noFreeTrialClaims.test.js` (scope
extended), routing and category registry pins.
