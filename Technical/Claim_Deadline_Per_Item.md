# Claim deadline per item: the saving's window inside the 30-day store window (2026-10-14)

Maxim, 2026-10-14: *"the reminders say remaining 21 days to claim or more, this is not usually possible. The
policy is clear: you can claim the price drop in the 30 days after purchase, but you can only claim in the
savings validity window. If an item dropped 2 days after purchase but the validity of the saving is 1 week,
the client has only 1 week left for this specific item but still 28 remaining days for the rest of the
items in the same receipt."* After the saving ends a shopper may still ask, but the claim will most likely
be refused. Hotfix on `main` (`hotfix/claim-window-per-item`).

## The rule — `shared/claimDeadline.js`

One item's claim period closes on the **earlier** of:

| Limit | Close (exclusive) | Source |
|---|---|---|
| Store window | `purchase_date + stores.adjustment_days` (30 for Costco) | the receipt |
| The saving | `saving's last day + 1` (the last day is inclusive) | the price group (below) |

`claimDeadline({purchaseDate, adjustmentDays, savingEnds, today})` → `status` (`open` / `saving_ended` /
`expired`), `daysLeft` (this item, 0 unless open, clamped to the window), `storeDaysLeft`, `lastDayISO`,
`endKnown`, `limitedBySaving`, `urgency` (the same 2/3–1/3 ratio as before, on the item's days).
`today` is the **shopper's** day (province clock, `shared/trackingTime.js`). Mirrored into `backend/shared`
by `scripts/sync-shared.js`; the app reads it through `src/services/claimDeadline.js`.

## Where the saving's last day comes from

Per **price group** `(product, province, price)` — never one row: the ledger's `price_point_id` is the group's
`MAX(id)` row, usually a `receipt_ocr` row with no date. `priceDropRepo._savingEndsJoin` (LEFT JOIN LATERAL)
trusts, in order (Maxim's precedence):

1. a **flyer** row's own window (`valid_until ≥ valid_from`; `flyerPricing.normalizeOffer` validated it);
2. a **price tag**'s printed EXP: `flags.expiryDate` (written since this change), or for older rows
   `valid_until` when `flags.printedExpiry` is true and `valid_until ≥ observed day`; and the admin's
   **imported tag deals** (coupon-cycle imports of deals seen on social posts, batches `costco-muse-*`:
   `price_tag_scan`, `flags.sourceKind = 'social_price_tag'`) by their own `valid_from..valid_until`.
   Without this rule the Oct 18 savings (lines 506, 1646, 1661, 2047) read as "unknown end";
3. **admin-entered** dates (`flags.savingDates = {from, until, by, at}`), only when 1 and 2 have nothing;
4. otherwise **unknown**: the store window is the only limit and the copy says "claim soon".

With a purchase, only windows that could apply count (ending on/after the purchase, starting within its
store window) — another run of the same price is ignored.

**Why `valid_until` alone is not trusted.** `pricesRepo.applyTagExpiry` ("rule 8") stamped a tag's date on
EVERY price row of the product in the province — any source, any price, any week — so receipt rows carried
other savings' dates and some tag rows ended before they started (prod: `min(valid_until − valid_from) = −85`).
It now stamps only the **same saving**: same price, not a flyer, window starting on/before the date; a call
without `price` stamps nothing.

## What uses it

| Surface | Change |
|---|---|
| `findNotifiable` (sweep + queue drain re-check) | a group whose saving ended before the buyer's day is dropped **before** the `DISTINCT ON` tier pick, so a still-running cheaper tier can win over an ended flyer. **No push, no commission** for an ended saving. A queued row whose saving ended meanwhile is superseded. A line claimed while held is exempt (as for the store window). Rows carry `savingEnds`. |
| Drop push (`priceDropNotifier`) | per-item `daysLeft`, emoji/priority from per-item urgency; `data.savingEnds`, `data.endKnown` (additive). Unknown end → `verifiedDrop.endUnknown` ("Claim soon: Costco only adjusts while the saving runs."). |
| Reminder (`lib/pendingClaims`) | an ended saving is not waiting (no reminder, not in "N more waiting"); `soonestDaysLeft` per item. |
| `/api/check-price` | `currentPrice` never from an ended saving (old builds see the regular price / no price and clear the chip); additive `savingEnds`, `savingEndKnown`, `endedSaving: {price, endedOn}`; `validUntil` = the group's end. |
| Admin potential drops | per-line `daysLeft` from the rule, `savingEnds`, `endKnown`, group `savingEndKnown`; ended savings not listed. |
| App | `ClaimDeadlineChip` ("Claim by Oct 18 · 4d left", "Saving ended Oct 11 · may be refused", "25d left · claim soon") + sentence on the receipt; Home "ready to claim" / "expiring soon", Receipts alerts, locked card, local reminders (earliest per-item close, savings closing that day). An ended saving is kept as `priceDrop {detected:false, savingEnded:true, endedOn}`. |

## Admin · Saving dates

`GET /api/admin/saving-dates` — every group a told-and-unclaimed line, a held drop (pending/approved) or a
potential drop depends on with **no trusted end**, with lines affected, first sighting and an **estimate**
(Monday on/before the first sighting, 1 week if the offer's past flyer windows have a median ≤ 10 days, else
2; no history → no pre-fill). `PUT /api/admin/saving-dates` `{productId, provinceCode, price, from?, until|null}`
writes `flags.savingDates` + `valid_until` on the group's non-flyer rows (last 120 days), then runs the
province sweep. `POST /api/admin/saving-dates/lookup {sku}` reads the Costco Sameday (Instacart) page:
`saleDisclaimerString: "Ends Oct 25 …"` (probed 2026-10-14 on SKU 1208941: it matched the flyer's
`valid_until` to the day) → `saleEnds`. A pre-fill only: Sameday is the online store; the admin confirms.
The price-tag review's EXP edit is validated (real date) and writes `flags.expiryDate`.

### 2026-10-16 — one card per SKU, sources, trusted dates hide a SKU, Sameday fixed

Asked by Maxim before 3.1.1 (hotfix on `main`, branch `hotfix/admin-saving-dates-sameday`):

- **One SKU = one date check.** The server still lists price groups (product · province · price —
  unchanged, so older admin builds keep working). The 3.1.1 screen folds every group of a SKU into one
  card (`groupBySku`), and *Save dates* sends the same `PUT` for each group. Trigger: SKU 1763195
  (Sheep yogurt) was listed twice, QC $7.99 and ON $7.99, both dated only by social posts.
- **A SKU a trusted source already dates is never listed** — a flyer window, a printed tag EXP or an
  admin date, in **any province, at any price** (`savingDatesRepo.trustedWindows` +
  `isCoveredByTrusted`), if that window can apply to the group's first purchase (ends on/after it,
  starts within the 30-day store window). A social post's date doesn't count. Another run of the
  offer (an old flyer that ended before the purchase) doesn't hide it.
  ⚠️ **The list only.** The drop engine (`_savingEndsJoin`) still matches the end date on the same
  province **and** price. So a QC drop hidden here because an ON flyer dates the SKU still gets the
  receipt window ("claim soon") until a QC/same-price date exists. Carrying a date across provinces
  into shopper deadlines is a separate decision (Maxim).
- **Sources.** Every listed group carries `sources` (additive): one entry per source type, one per
  social post with its link (`by`, `url`, https only), plus count, distinct shoppers, last sighting
  and window. Labels are plain English (`SOURCE_LABELS`), never codes.
- **Sameday lookup opened the wrong product.** Cause: `findSamedayUrlForSku` takes the *first*
  Sameday product link in DuckDuckGo's `site:sameday.costco.ca <sku>` results. For a SKU it doesn't
  know, that's a random product (reproduced: 1763195 → a Michelin wiper blade; Duracell batteries on
  Maxim's phone). The route returned that URL even when the page failed the SKU check (and trusted a
  page with no SKU code at all), and the app opened it with `Linking.openURL`, which hands
  `sameday.costco.ca` to the Costco app. Fix: the route returns the product page **only** when its
  `retailerReferenceCodeString` equals the SKU; otherwise `url` = `searchUrl` = a Sameday search by
  the product's **name** (Sameday doesn't index warehouse SKUs). The app opens pages with
  `expo-web-browser` (in-app browser), with `Linking` only as a fallback. `findSamedayUrlForSku` itself
  is unchanged: check-price and the barcode harvester already reject a page that fails the SKU check.
- **Province.** The card has a province picker (the 10 provinces with a warehouse). The lookup sends
  `provinceCode`, and the server reads Sameday with that province's downtown postal code as the
  delivery cookie (`PROVINCE_POSTAL_CODES` in `lib/costcoSameday.js`). Not yet proven: that Sameday
  prices by that cookie from a data-centre IP. The page opened on the phone uses whatever address is
  set in that browser, so the note tells the admin to set the province there.

## Correcting what shoppers were already told

Before this fix, 7 shoppers got the reminder on 2026-10-14 20:37 UTC (it counted savings that ended Oct 11),
and drop pushes said 25–29 days for savings ending Oct 18. `scripts/draftClaimDeadlineCorrections.js`
(dry run, then `--write`) drafts **one pending** `claim_deadline_correction` notice per affected receipt
(told, unclaimed, store window open, saving ending before it), in the shopper's language only, no item name:
"…Claim by October 18, 2026." / "The saving ended on October 11, 2026: you can still ask at the warehouse,
but it will most likely be refused." Nothing is sent until Maxim approves each on Admin · Notifications to
approve. The kind is seeded at boot (`db/seed.js`).

The reminder kill switch `PENDING_CLAIMS_REMINDER_ENABLED` was set **false** in prod on 2026-10-15 00:00 UTC
until the hotfix is deployed and verified.

## Old app builds

Additive only; nothing removed or renamed. Push copy is text; `data.savingEnds/endKnown` are new optional
fields. Fewer pushes/charges for ended savings is strictly safer. check-price's `currentPrice` for an ended
saving lands on the "regular price / no price" path every build (v2.8.3+) handles: the chip clears.
`claim_deadline_correction` is an unknown type on old builds → a tap opens the app. The Costco policy text
(`policies.json` / `store-content-sync.sql`, `content_updated_at` 2026-10-14) reaches every build.
No migration: admin dates live in `price_points.flags`.

## Open question — perishables (document only)

Online sources disagree on whether Costco Canada adjusts perishables (meat, chicken, fish, produce, bakery).
Items sold **by weight** are already excluded (`products.is_weighted`, migration 0024). A `products.is_perishable`
flag is **not** built: Maxim will confirm with Costco customer service first. See
`Publishing-Compliance/Costco_Price_Adjustment_Rules.md`.
