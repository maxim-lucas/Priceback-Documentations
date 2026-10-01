# Admin dashboard — what each number means

Screen: Admin console → **Dashboard** (`src/screens/AdminDashboardScreen.js`).
Route: `GET /api/admin/overview?sinceHours=` — every row below is computed over the
window the toggle picks (**24 hours / 7 days / 30 days**; the server clamps to 30 days).
Reads: `adminConsoleRepo.overview()` → `businessCounters()` in the app repo.

Rows, in screen order:

| Row | Value | Subtitle | Source |
|---|---|---|---|
| New accounts | accounts created | total accounts | `users.created_at` |
| **Price drop notifications** | notifications sent | — | `price_drop_notifications.sent_at` |
| **Price drops amount** | CAD | — | per notified receipt line: `(paid unit price − lowest notified price) × quantity`, floored at 0 — same formula as the monthly re-engagement summary |
| **User subscribed** | distinct accounts with `INITIAL_PURCHASE` or `free_trial` | trials · renewals | `subscription_events` |
| **User bought credits** | distinct buyers | packs bought | `topup_refs.created_at` |
| **Total gain** | CAD | subscriptions · credits | see below |
| Receipts scanned | live receipts created | — | `receipts.created_at` |
| **Price tag scanned** | tag reads | — | `price_points` with source `price_tag_scan` |
| **Price checker scanned** | Price Checker lookups | how many found a price | `price_checker_scans` (migration 0016) |
| Sign-in refusals | needing action | total refused | `auth_outcomes` |
| Scheduled jobs that failed | — | — | `job_runs` |

## Total gain — how it is priced

- **Official catalog prices in CAD, not store payouts.** Each paid charge is priced at
  the `subscription_plans` (monthly/annual) or `credit_packs` price whose country
  currency is `CAD`. It is the price the shopper was shown — **before** Apple/Google
  fees and taxes. A product id with no CAD catalog row adds nothing (never a guess).
- **Paid charges** = `INITIAL_PURCHASE` + `RENEWAL`. `free_trial` costs nothing and is
  excluded. Credit packs come from `topup_refs` (not from `NON_RENEWING_PURCHASE`
  events, which would double-count).
- **Sandbox is excluded everywhere** — `subscription_events.is_sandbox`, and for packs
  the `credit_ledger.is_sandbox` row carrying the same `ref`.
- **One charge, one row.** The RevenueCat webhook and the client `/subscription/sync`
  can record the same purchase under different event ids; charges are counted once
  per (account, product, UTC day).
- Play product ids carry a `:base-plan` suffix; it is stripped before matching.

## Price checker scans (new table)

`priceback.price_checker_scans (id, found, scanned_at)` — anonymous by design: the
`/api/barcode/resolve` route is public, and the dashboard needs a count, not a person.
No barcode, IP, or device is stored. The write is fire-and-forget and never fails or
slows the lookup. Classified as `KEEP_TABLES` in `lib/dataCleanup.js`. **Counting
starts on the day the migration is applied** — there is no history before it.

Applied by hand (prod's drizzle ledger is hand-maintained): run
`backend/db/migrations/0016_price_checker_scans.sql`, then insert the ledger row
`hash = b8814abbc105f074ff863197c2669d680b00ae1b513ab57541e2b84d0633d54e`,
`created_at = 1790800000000`. Until applied, the row reads 0 and lookups are unaffected.
