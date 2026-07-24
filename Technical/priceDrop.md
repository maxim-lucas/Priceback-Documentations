# Price-Drop System — Technical Reference

How PriceBack detects that something a user bought is now cheaper, surfaces it, and
lets them claim a refund. This is a map of the **actual current behaviour**, not a spec.

Primary source files:

| Layer | File |
| --- | --- |
| Mobile price logic | `src/services/priceService.js` |
| Mobile storage / claim state | `src/services/storageService.js` |
| Mobile notifications + bg task | `src/services/notificationService.js` |
| Mobile UI | `src/screens/DetailScreen.js`, `src/screens/ClaimAssistantScreen.js` |
| Backend price/watch routes | `backend/server.js` |
| Verified-drop sweep | `backend/priceDropNotifier.js` |
| Verified-price reads/writes | `backend/repos/priceDropRepo.js`, `backend/repos/crowdRepo.js` |
| Commission/credit math | `shared/pricing.js` (mirrored in `backend/shared/pricing.js`) |

---

## 1. Lifecycle

```
Scan receipt ─► OCR parse ─► receipt saved
                              (sets purchaseType, warehouseId, items[].sku/price/quantity)
                                   │
                                   ▼
                       registerForPriceWatch(receipts)  ──►  POST /api/watch
                       (consent-gated crowd ingestion)        (server tracks the line for the sweep)
                                   │
              ┌────────────────────┼─────────────────────────┐
              ▼                    ▼                          ▼
   Manual "Refresh prices"   Background task            Server verified-drop sweep
   (DetailScreen)            (once a day, app)          (cron + post-flyer-import)
   handleCheckPricesNow()    checkAllPriceDrops()       priceDropNotifier.run()
              │                    │                          │
              └─ checkPrice() ─► POST /api/check-price        └─ push notification
                         │                                       (commission DEBITED here)
                         ▼
              item.priceDrop written to local storage
              (DetailScreen shows "NOW" card, % chip, eligibility, claim CTA)
                                   │
                                   ▼
                    User claims ─► markItemClaimed() ─► POST /api/receipts/:id/items/:i/claim
                    (status only — credits already moved at detection)
```

There are **three independent triggers** that can populate a drop:

1. **Manual** — the user taps *Refresh prices* on a receipt (`handleCheckPricesNow` in
   `DetailScreen.js`), which runs `checkPrice` per item with `force:true`.
2. **Background** — `checkAllPriceDrops` runs from the Expo background task on a **once-a-day**
   floor and on app resume (`notificationService.js`), over **active receipts only**
   (non-expired, non-claimed, watchable). It writes a `priceDrop` when a real drop is found,
   **clears any stale `priceDrop` when a check finds none**, and fires a **local** notification
   on a new drop.
3. **Server sweep** — `priceDropNotifier.js` runs on a cron and immediately after each
   weekly flyer import, and sends a **server push** for *verified* drops. This is also
   where the **commission is charged**.

---

## 2. Data model

### `item.priceDrop` (written on a receipt item)

Written by `DetailScreen.handleCheckPricesNow` and by the background task in
`notificationService.js`:

| Field | Meaning |
| --- | --- |
| `detected` | `true` when a drop (or active sale label) was found |
| `savings` | Total CAD opportunity = per-unit savings × `quantity` |
| `currentPrice` | Current **per-unit** price found online |
| `unitPaid` | Per-unit price paid (= line total ÷ quantity) |
| `quantity` | Units bought (multi-unit lines are normalised before comparing) |
| `percentDrop` | Integer % off |
| `saleLabel` | Costco online sale label, when the drop came from the sale-label path |
| `hasPromo` | A promo/sale was active on the product page |
| `checkedAt` | ISO timestamp of the check |
| `url` | Direct product page link, when known |
| `history` | Optional real price series. **Usually absent** — the 30-day chart was interpolated from `paid → current` when missing, which is why it is currently hidden in the UI |

### Relevant `receipt` fields

- **`purchaseType`** — `"online" | "warehouse" | "unknown"`. Set by the OCR/parse layer.
  Drives the comparison strategy (below). Defaults to `"unknown"`.
- **`warehouseId`** — Costco-specific numeric warehouse code (1–6 digits, e.g. `802`).
  Optional. Editable from the DetailScreen header editor. Enables warehouse-scoped crowd
  pricing and is the gate for the "same warehouse" eligibility row.
- **`items[].claimed` / `claimedSavings` / `claimedAt`** — claim state, locked in at claim.
- **`items[].watchEnabled`** — `false` stops the item from being checked/notified.

---

## 3. Mobile price logic (`src/services/priceService.js`)

### `checkPrice(storeId, itemQuery, sku, warehouseId, opts)`
- Calls `POST /api/check-price`. **SKU is preferred** over name for exact matching.
- **24-hour local cache** keyed by store + (sku|query) + warehouseId + postal code, so users
  in different regions never collide. `opts.force` bypasses the cache (manual refresh).
- 8s abort timeout; on backend failure returns a `currentPrice: null` stub so the UI
  degrades gracefully.

### `checkAllPriceDrops(receipts)`
- Batch-checks active (non-expired, non-claimed, watchable) lines.
- **Quantity-aware**: receipt `price` is a *line total*; scrapers return *per-unit*. It
  divides to a unit price, compares, then multiplies savings back out by qty — this is the
  guard against false drops on multi-unit lines.
- **Comparison strategy**: paid unit price is compared **directly** to the verified current
  price for every purchase type — the backend `price_points` source is already
  warehouse/province-scoped, so the client applies **no estimate**. (A previous `online × 0.96`
  warehouse adjustment fabricated a ~4% phantom drop on every Costco warehouse line and is
  removed.) A drop is only recorded when the resulting savings is **strictly positive**.
- **Two drop paths**: (1) *classic* — effective online price strictly below paid; (2)
  *sale-label* (Costco) — an active online sale (`hasPromo` + `saleLabel`) counts as a drop
  even if the online price isn't below paid, because Costco honours online sales for
  in-warehouse price adjustments within the window.

### Window helpers
- `daysRemaining(purchaseDate, storeId)` — days left in `store.adjustmentDays`, **clamped to
  `[0, adjustmentDays]`** so a bad/future date can't show 100+ days.
- `adjustmentExpiry(purchaseDate, storeId)` — exact expiry `Date` (null on bad data).
- `priceDropUrgency(...)` — `green` (>2/3 window left) / `yellow` (1/3–2/3) / `red` (<1/3 or
  expired); drives the urgency colouring in DetailScreen.

### `registerForPriceWatch(receipts)`
- `POST /api/watch`. Registers each active line for the server sweep and (consent-gated)
  feeds crowdsourced warehouse pricing. Only sends crowd data when the user opted in
  (`shareCostcoPrices`); TPD/discounted lines are excluded from the crowd median.

### `compareItemAcrossStores(...)`
- Fans `checkPrice` out across peer retailers, cheapest-first. Powers the "Compare at other
  stores" feature (**currently hidden in the UI**, logic retained).

---

## 4. Backend price source (`backend/server.js`)

### `POST /api/check-price`
Per-IP rate limited. Source resolution for **Costco with DB on + `sku` + `province`**:

1. **`price_points` verified price is the single source of truth.** Read via
   `priceDropRepo.getLatestVerifiedPrice(...)` using the *same* verification rule the sweep
   uses. A price counts only when it is **admin-fed/verified** *or* observed by
   **≥ `PRICE_VERIFY_MIN_USERS` distinct users** (default 3) in the caller's province within
   `PRICE_VERIFY_WINDOW_DAYS` (default 14). `source` is `price_points_admin` or
   `price_points_crowd`.
2. If nothing is verified, it returns `currentPrice: null` (`source: price_points`) rather
   than falling back to a live scrape — the in-app check and the sweep can never disagree.
3. **Crowd median is a complement, never the price.** When ≥ `MIN_DISTINCT_USERS_FOR_ALERT`
   distinct devices contributed, a `crowdsourced` block (median, confidence, observation
   count, warehouse|province scope) is attached as metadata for the UI ("your warehouse paid
   $X across N observations").

**Fallback paths** (Costco without sku/province, or DB off, or non-Costco stores): the
in-memory weekly **flyer overlay** (best-effort, not province-verified) and then the
per-store **scrapers** (e.g. `sameday.costco.ca`). This is the legacy path the top-of-handler
comment describes; the verified `price_points` path above supersedes it whenever sku +
province + DB are available.

This implements the [flyer-primary strategy](../docs) — the weekly Costco flyer is the
primary price source, crowdsourcing complements it (see memory `flyer_primary_pricing_strategy`).

### `POST /api/watch`
Registers lines for the sweep; consent-gated crowd ingestion into `price_points` via
`crowdRepo` (non-TPD lines only).

### `POST /api/observations/tag`
Single in-warehouse price-tag scan upload (consent-gated), with a scan-credit reward.

---

## 5. Verified-drop sweep + commission (`backend/priceDropNotifier.js`, `priceDropRepo.js`)

Runs on a cron and immediately after each flyer import.

1. **Find verified drops** — `priceDropRepo.findNotifiable()` returns the *lowest verified
   price* per (product, province) from `price_points`, applying the **rule-of-3** (≥
   `PRICE_VERIFY_MIN_USERS` distinct users at the same price/province, **or** an
   admin/flyer row, **or** a contributor in `ADMIN_USER_SUBS`). Excludes admin-flagged and
   stale rows.
2. **Match receipt lines** — a line qualifies if: unclaimed, `watch_enabled`, paid strictly
   more per unit than the verified price, buyer's province matches, buyer has a push token,
   and no prior notification at the same-or-lower price (dedup ledger).
   **Appeared-after-purchase rule (2026-07-01, Bugs #64):** the verified price must have at
   least one observation that became *available* strictly AFTER the line's purchase date and
   no later than `purchase_date + policy_days` (`COALESCE(receipts.policy_window,
   stores.adjustment_days, 30)` — store-configured, never hardcoded). Availability is the
   flyer's printed `valid_from` for flyer-tier rows and `observed_at::date` for point
   sources (receipt/tag — their Monday-bucketed `valid_from` is ignored here). A price
   already available at checkout — including the scanned receipt's OWN instant-discount
   `receipt_ocr` echoes — is never a drop, so a receipt can't self-trigger; a sale that
   started after the purchase counts even if it already ended.
3. **Charge commission — incrementally, once per item.** Commission is debited **at detection**
   (in the same tx as the notification insert), but only on the **new price difference**: a
   per-item transaction advisory lock + a lookup of the lowest previously-notified price gives a
   `baseline` (the prior lowest, or the unit price paid on the very first drop), and the debit is
   `dropCommissionCredits((baseline − newPrice) × qty)`. So the first drop bills the full first
   savings, a *deeper* drop bills only the extra delta, and an equal/higher price bills 0 — the
   portion already charged is **never re-billed**. Across an item's life total commission =
   `dropCommissionCredits(paidPrice − lowestPrice)`. This is **once per receipt item** even with
   multiple devices on the same sub (one server `receipt_item` row per line).
   **Unlimited-tier (frozen-balance) users are skipped.** The notification row *is* the billing
   record; its `(receipt_item_id, price)` unique index still prevents a recurring price from
   re-charging.
   - Formula: `dropCommissionCredits(savings$) = round(savings$ × CLAIM_CREDITS_PER_DOLLAR)`
     (`shared/pricing.js`), returns 0 for non-positive input.
4. **Push** — sends a CASL-exempt transactional notification, gated by the user's
   `notifUrgentClaims` preference (fail-open if settings are unreadable).

> ⚠️ `ADMIN_USER_SUBS` must contain Maxim's sub for the admin bypass to work — see memory
> `verified-price-drop-notifications`.

### Policy-status lifecycle (migration 0004)
`policy_statuses` (lookup) + `receipts.policy_window` + `receipts.policy_status_id` exist in
the DB to track the claim workflow, but are **not yet surfaced in the mobile app**.
Commission is charged at drop detection; **claiming is status-only**. Prod still owes
migration 0004 (memory `price-drop-commission-and-policy-status`).

---

## 6. Claiming & watch state (`src/services/storageService.js`)

- **`markItemClaimed(receiptId, index, savings)`** — sets `claimed/claimedAt/claimedSavings`,
  `watchEnabled:false`; best-effort `POST /api/receipts/:id/items/:index/claim`
  (idempotent, status-only, **never moves credits** — commission was already charged at
  detection).
- **`markAsClaimed(receiptId)`** — receipt-level claim.
- **`stopWatchingItem(receiptId, index)`** — sets `watchEnabled:false`, clears `priceDrop`;
  best-effort `POST /api/receipts/:id/items/:index/watch` (survives reinstall).

The **Claim email assistant** (`ClaimAssistantScreen.js`, reached via the *Generate claim
email* CTA) drafts the refund request to the store.

---

## 7. Eligibility checklist (DetailScreen)

Shown when the focused item has an unclaimed drop. Current rows:

| Row | `ok` condition | Notes |
| --- | --- | --- |
| Receipt within N-day window | `daysRemaining > 0` | N = `store.adjustmentDays` |
| SKU matched on retailer site | `!!focusItem.sku` | |
| Same warehouse / store as purchase | shown **only when `receipt.warehouseId` is set** (then always ✓) | Hidden when we can't verify the warehouse, instead of showing a misleading ✗ |

**Removed for now:** the *"In stock at current price"* row (it was noise tied to
`focusDrop.currentPrice`). The i18n key `detail.checkInStock` is retained for easy restore.

---

## 8. Currently hidden in the UI (logic retained)

These are turned off in `DetailScreen.js` but their code/state remain so they can be
switched back on:

- **30-day price-history chart** (`PriceHistoryCard`) — the curve is interpolated when
  `priceDrop.history` is absent (the common case), so it isn't trustworthy yet.
- **"Compare at other stores"** multi-store live compare section.

When real `priceDrop.history` is wired and compare is ready, re-render those blocks.
