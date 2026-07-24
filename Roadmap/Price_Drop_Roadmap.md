# Price-Drop Mechanism — Security, Coverage & Optimization Roadmap

The price-drop mechanism (verified-drop detection → credit commission at
detection → push notification → claim) is PriceBack's revenue engine: real
credits move automatically, so every gap is a financial-integrity risk. This
doc records what was hardened, and what remains — split by priority so the app
can go live on the **go-live set alone**.

Companion: recurring-bug details in `docs/Bugs_Common_Fixes.md` #87–#89.

---

## ✅ Go-live blockers — FIXED in this branch (`test/price-drop-hardening-and-coverage`)

| # | Issue | Severity | Fix | Proof |
|---|-------|----------|-----|-------|
| H1 | Top-up minted credits from an unverified `transactionId` | High | Verify against RevenueCat before crediting (Bugs #88) | `creditTopupSecurity.test.js` |
| H2 | Rule-of-N Sybil bypass (self-farm + credit-drain) | High | Count distinct device **owners**, anon collapses to one (Bugs #87) | `sybilVerificationDb.test.js` |
| M1 | No rate limiting on credit endpoints | Medium | `checkCreditRateLimit` on 6 routes (Bugs #89) | `creditRateLimit.test.js` |

Regression net added alongside: HTTP claim route (`claimRouteDb.test.js`),
push-failure billing isolation + `check-drops` + verified-stickiness
(`dropSweepResilienceDb.test.js`), mobile notification tap-routing +
tag-scans-ready (`notificationTapRouting.test.js`), claim-assistant logic
(`claimAssistantScreen.test.js`).

### Audit follow-up (2026-07-12, Bugs #90/#91) — residual holes in H1/M1 closed

A post-merge audit of the three fixes found and closed:

| # | Issue | Fix |
|---|-------|-----|
| H1a | One store transaction credited MANY accounts (RC restore/transfer re-homes the receipt; dedupe was per-user) | `recordTopupOnce` dedupe + advisory lock now GLOBAL on the transaction ref |
| H1b | Sandbox ($0 license-tester) purchases passed the REST check the webhook refuses | topup 402s on `is_sandbox`; `/subscription/sync` tier mapper skips sandbox-backed entitlements; `RC_ALLOW_SANDBOX=1` opts dev back in |
| M1a | `CREDIT_RATE_LIMITS` never swept → unauthenticated key-minting = slow OOM | enrolled in `sweepInMemoryState()` |
| M1b | obs-tag budget keyed on client-chosen `deviceId` → rotation minted fresh budgets | secondary per-IP budget (5× per-device max, rightmost XFF hop) |
| H2a | Latent: `'ref:'` contributor fallback made every NULL-`device_hash` row a distinct shopper (schema is nullable; only app-enforced) | all unattributable rows now collapse to `'anon'` in all three rule-of-N queries |

---

## 🟡 Should-fix soon — NOT go-live blocking

### 1. No drop-charge refund path
Deleting/soft-deleting a receipt item **after** a `price_drop_charge` strands the
debit — there is no compensating ledger entry, so the user keeps paying for a
drop they no longer hold. `creditsRepo` has `revokePriceTagCredit` for tag
rewards but nothing reverses a `price_drop_charge`.
**Direction:** add a `price_drop_refund` event type; on item soft-delete, if a
`price_drop_charge` exists for that item and the window hasn't lapsed, append a
compensating credit (idempotent on the same `drop:item:cents` ref).

### 2. No Expo receipt/ticket polling — dead tokens never reaped
`priceDropNotifier` sends pushes but never polls Expo **receipts**, so
`DeviceNotRegistered` / invalid-token tickets are silently dropped and stale
`users.push_token` values accumulate (wasted sends, skewed "N shoppers" nothing
but noise). Failed send **chunks** are also not retried.
**Direction:** a post-send receipt-poll job that nulls `push_token` on
`DeviceNotRegistered`; optional one-shot retry of a failed chunk.

### 3. CI blind spot — every DB-backed drop test skips without `DATABASE_URL`
All drop/commission/claim/Sybil tests are `skip: !HAS_DB`. A CI runner without a
database reports **green while running none of them** — only the pure-math legs
actually execute. This is how a real regression could slip through.
**Direction:** either provision a test DB in CI (point `DATABASE_URL` at the DEV
Supabase / a disposable branch), or add an explicit guard test that **fails** CI
when the DB leg didn't run (asserts `HAS_DB` in the CI environment).

---

## 🟢 Future / nice-to-have

- **Bind crowd ingest to authenticated / attested devices.** The anon-collapse
  in #87 neutralizes Sybil *consensus*, but `/api/observations/tag` + `/api/watch`
  still accept anonymous writes into the price pool. Binding ingest to an
  authenticated `sub` (or an attested device) would let anonymous contributions
  count toward N again *safely*, and close price-pool poisoning entirely.
  Related accepted residual: the shared `anon` bucket COUNTS as one contributor,
  so consensus really needs N−1 real accounts + any anonymous sighting — the
  bucket keeps signed-out shoppers' contributions useful, and the marginal cost
  reduction for an attacker is one Google account.
- **True concurrent-transaction test of the `recordNotified` election.** The
  single-sender billing race is proven only sequentially (the "second sweep"
  cases). A real two-connection concurrent test (as `creditLedgerAccuracy` does
  for tag credits) would lock in the advisory-lock guarantee.
- **Further coverage opportunities (lower leverage):**
  - Backend: `runDailyDigest` / `recentDropCountsByUser` soft-delete filtering;
    `unit_price`-null → `line_total/quantity` fallback (`priceDropRepo.js`).
  - Mobile: `registerBackgroundTask` body (SKU→name match, stale `priceDrop:null`
    clearing, `BackgroundFetchResult` mapping); claim-from-Detail/Home
    (`markItemClaimed` confirm → claimed banner); `getPrefs` merge for older
    installs missing granular keys; offline `checkPrice` synthetic-result path.

---

## Operational note (unchanged, tracked elsewhere)
Prod owes migrations per [[db-redesign-v2]] / [[db-provider-neon-test-supabase-prod]];
`REVENUECAT_SECRET_KEY` must stay set on prod for the #88 top-up verification to
credit (it currently is — see the recent prod-confirm commits). Empty
`ADMIN_USER_SUBS` = deny-all (verified), so the admin bypass is inert until
Maxim's sub is added.
