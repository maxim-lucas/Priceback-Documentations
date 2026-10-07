# Potential price drops — the unverified list (2026-10-07)

App branch `hotfix/admin-potential-price-drops` (off `main`). Docs branch
`docs/admin-potential-price-drops`.

## What Maxim asked

> i want to add potential price drops (dont have verified price yet, but they have a price
> drop based on a different receipt from the same warehouse or same province) so i can check
> it out in the price drop queue (admin console and check if we can be confident to send
> this price drops or no)

Mid-task:

> they have to be differentiated from the verified queue so i dont mix anything up
>
> even if N = 1 that should be potential not verified and should be in the new queue

## What a potential drop is

A watched receipt line that a **crowd** price would undercut, where the price:

- was seen in the buyer's **own province**, strictly **after** the purchase and inside the
  store's adjustment window, and is at least `PRICE_DROP_MIN_SAVINGS` per unit cheaper
  (the same line rules as the verified sweep), and
- is backed by **fewer** distinct shoppers than the verified rule needs and by **no** admin
  evidence (flyer, `verified=true`, admin upload, admin receipt).

"One other shopper's receipt from the same warehouse" is the typical case. Each affected line
says whether the evidence came from the buyer's **own warehouse** (`SAME WAREHOUSE`) or only
from elsewhere in the province (`SAME PROVINCE ONLY`). That matters because Costco markdowns
can be club-specific, while verifying a price applies it to every watching buyer in the
province.

Not listed, same as the verified sweep: Executive-only prices for a non-Executive buyer; lines
a higher-tier verified price already decides (flyer-first); lines already notified or already
in the verified queue at that price or lower (a **rejected** queue row counts).

Unlike the verified sweep, a buyer **without a push token** is still listed (flagged): the
admin is judging the price, and a verified drop also shows in the app.

## Kept apart from the verified queue

| | Verified price-drop queue | Potential drops |
|---|---|---|
| Storage | `price_drop_review_queue` rows | **none**: computed live on each read |
| Charges / pushes | yes, on approve (or automatically with review off) | **never** |
| Screen | `AdminPriceDropQueueScreen` (green, "VERIFIED PRICE") | `AdminPotentialDropsScreen` (amber, dashed, "UNVERIFIED PRICE · POTENTIAL · NOT VERIFIED") |
| Endpoints | `/api/admin/price-drop-queue…` | `/api/admin/potential-drops…` |
| Entry | Admin home → Price-drop queue | Admin home → Potential price drops, **and** a dashed amber link at the top of the queue screen |

`potentialDropRepo` only reads. It has exactly two writers, both on `price_points`, never on
the queue:

- **Verify price** (`POST /api/admin/potential-drops/verify`): stamps the group's crowd rows
  `verified=true` (+ `flags.potentialDropVerifiedBy/At`). That is the long-standing
  admin-verification override the sweep already honours. The route then runs a
  province-scoped sweep, which **stages the drops into the verified queue** as `pending`.
  From there it is the normal approve → charge → push path. With review **off** they go out at
  once; the confirm dialog says so.
  **Side effect, on purpose:** when the evidence includes a price-tag scan with printed savings,
  the `verified` stamp also counts as admin verification for that tag's credit pool
  (`tagCreditsRepo` reads the same flag). The contributor's deferred tag credit can then be
  released at the next settlement, exactly as when the same tag is verified on the
  tag-review desk.
- **Not a real price** (`POST /api/admin/potential-drops/reject`): sets `flags.excluded=true`
  (+ `excludedReason: potential_drop_rejected`, `excludedBy`, `excludedAt`) on the group's crowd
  rows. They then drop out of every price check, like a rejected tag review.

Doing nothing leaves the price on the list until more shoppers confirm it (it then verifies
itself and leaves) or it ages out of `PRICE_VERIFY_WINDOW_DAYS`.

Both actions take `{ productId, provinceCode, price }` and answer `404` when no row is left to
act on (already handled).

## The N = 1 floor

`priceDropRepo.effectiveMinUsers(n) = max(2, n)` now feeds `findNotifiable`,
`getLatestVerifiedPrice` and `markNewlyVerified`. A single shopper can never verify a crowd
price, even if `PRICE_VERIFY_MIN_USERS` is set to 1. It stays potential instead.

- **No-op today:** both dev and prod have `PRICE_VERIFY_MIN_USERS = 3` (checked 2026-10-07).
- The admin bypasses are untouched. Prod had 13 single-contributor groups marked `verified`
  (15 rows). **All 15 were verified on the tag-review desk** (`tag_scan_reviews.status =
  'verified'`), which is legitimate admin verification, so they stay verified.
- The tag-credit rule of N (`tagCreditsRepo`) is a separate threshold and was **not** changed.

## What prod would show today

The read-only SQL equivalent of `listPotential`, run against prod on 2026-10-07 (N = 3,
window 14 d, floor $1.99): **5 potential drops, all QC, each backed by one shopper, none from
the buyer's own warehouse.** Products: ACTIVIA LACT, CARA CARA, HACHÉ MAIGRE, ORANGES,
PANTALON LVS. Two were bought on 2026-09-03, so their claim window has already closed. The
screen shows "Claim window closed" for those. "HACHÉ MAIGRE" ($30.02 vs $33.99) is
weighed meat, where the package price varies: exactly the kind of false positive this list
exists to catch.

## Files

- `backend/repos/potentialDropRepo.js` — `listPotential`, `verifyGroup`, `excludeGroup`,
  `groupKey`.
- `backend/repos/priceDropRepo.js` — `MIN_CROWD_CONTRIBUTORS`, `effectiveMinUsers`.
- `backend/server.js` — `GET /api/admin/potential-drops`, `POST …/verify`, `POST …/reject`
  (admin-only, desk rate limit). Each line carries `savings`, `chargeCredits` (if verified)
  and `daysLeft` (on the province's calendar).
- `src/screens/AdminPotentialDropsScreen.js` — admin-only, English-only (exempt from i18n).
- `App.js`, `AdminHomeScreen.js` (tile), `AdminPriceDropQueueScreen.js` (link).
- Tests: `backend/tests/potentialDropDb.test.js` (20, real Postgres, province MB),
  `__tests__/adminPotentialDropsScreen.test.js`, plus additions to the queue and home screen
  tests.

## Not done / follow-ups

- No admin push when a new potential drop appears; the list is pull-only.
- Lines past their claim window are still listed, flagged "Claim window closed", because the
  line rules mirror `findNotifiable`, which has no "today" bound either. Whether the verified
  path then pushes such a line was not investigated here.
- No migration. Nothing to apply by hand in prod.
