# PriceBack — Future Roadmap

Status legend: **✅ SHIPPED** · **🟡 PARTIAL** · **🔵 OPEN**

When picking up the next round of work, **skip everything tagged ✅** and use it
as already-baseline. Treat 🟡 items as candidates for completion before any new
🔵 work is started.

---

## ✅ Recently shipped — skip in next rounds

| Item | Commit / date | Notes |
|---|---|---|
| **Receipt editing after save** | `bc37371` · 2026-05-20 | DetailScreen editor extended (qty, warehouseId, "+ Add item"). `addItemToReceipt` helper + 6 tests. |
| **PDF export — full** | `bc37371` · 2026-05-20 | `exportClaimsAsPdf({ range })` accepts month / quarter / year / all. Profile modal: range chip group + contextual pickers. 5 tests. |
| **Costco weekly-flyer overlay** | `bc37371` · 2026-05-19 | `flyerPricing.js` module, `/api/flyer/import`, `/api/flyer/active`, /api/check-price priority flyer → sameday → (crowdsourced as parallel signal), append-only price history, 103-item Ontario flyer JSON. 12 tests. |
| **Crowdsourced ≥6-user gate** | `bc37371` · 2026-05-19 | `MIN_DISTINCT_USERS_FOR_ALERT=6` — crowdsourced data only attaches to /api/check-price when ≥6 distinct devices have contributed. Median is still computed; just not broadcast below the threshold. |
| **Urgency colour codes** | `bc37371` · 2026-05-19 | Green / yellow / red tied to fraction of adjustment window remaining (>2/3, 1/3–2/3, <1/3). `priceDropUrgency()`, `COLORS.urgency`, applied across Home / Receipts / Detail / push titles. |
| **Audit pass #5** | `bc37371` · 2026-05-19 | province now flows through /api/watch, flyer import items cap, constant-time admin token, daily prune cron, scrape cron skips flyer-covered SKUs to avoid double-notify. |
| **iOS build prep** | `bc37371` · 2026-05-20 | `expo-apple-authentication` added, `usesAppleSignIn`, `googleClientIdIos` placeholder, `signInWithGoogle` passes iOS client. Still needs GCP iOS OAuth client + GoogleService-Info.plist before first build. |

Total since last roadmap touch: **187/187 mobile + 47/47 backend tests passing**.

---

## 🟡 Partial — finish before new 🔵 work

### Warehouse-pricing Phase 2 — UI surface
**Status:** Backend done (flyer + crowdsourced complement + priority chain), mobile lookup wired. **Missing:**
- "Deals this week" feed in the app — `getActiveFlyerOffers(region)` helper exists in `priceService.js` but no screen renders it yet.
- DetailScreen badge for the new `crowdsourced` complement field on /api/check-price (currently only the old "From your warehouse · N obs" chip path is wired).

### iOS first build
**Status:** All code-side prep landed in `bc37371`. **Missing user-side prep before EAS / local build:**
1. `npm install` so `expo-apple-authentication@~8.0.0` lands in `node_modules/`.
2. GCP → create iOS OAuth client for `com.priceback`. Paste client ID into `app.json` `extra.googleClientIdIos`.
3. Download `GoogleService-Info.plist` from GCP, drop in repo root.
4. App Store Connect → enable "Sign In with Apple" capability on the bundle ID.
5. `eas build --platform ios --profile preview` (needs macOS or EAS cloud; local iOS build isn't possible from Windows).

### Plan A + Plan B production rollout
**Status:** Both merged + dormant per `PLAN_AB_ROLLOUT.md`. Plan B is now superseded by the flyer overlay as the *primary* Costco price source (see strategy memo); Plan B remains as the complement signal. Plan A (LLM OCR reconciliation) is still useful and untouched.

**Open:** Backend env vars + new EAS build to enable the Profile toggles.

---

## 🔵 Open — not yet started

### Costco Pricing Accuracy — Phase 3 (paid scraper fallback chain)

> Note: Phase 2 reframed as the *flyer overlay* (shipped). This is now the
> NEXT step — a paid-API fallback when both flyer and sameday miss.

If sameday scraping ever becomes unreliable, fall back to a commercial API.
All are paid but handle anti-bot / CAPTCHA / page-structure churn for us.

| Service | Pricing | Pros | Cons |
|---|---|---|---|
| [Unwrangle](https://docs.unwrangle.com/costco-product-data-api/) | Pay-per-call | Search + product detail, UPC in search API, warehouse ID param | Paid |
| [Apify Costco Scraper](https://apify.com/sovereigntaylor/costco-scraper/api) | Pay-per-run | Search + detail + warehouse pages, member-only status | Paid |
| [ScrapingBee](https://www.scrapingbee.com/scrapers/costco-scraper-api/) | 1000 free credits | Easy setup, CA/US/UK | Paid after trial |

**Decision criteria:**
- Stay on sameday at low volume (free, current approach).
- Add a provider fallback chain after flyer: flyer → sameday → Unwrangle → ScrapingBee.
- Monitor sameday error rate. If >15% over 24h, auto-switch to paid provider.

**Sketch:**
```js
async function costcoLookup(sku, name, warehouseId, province) {
  const flyer = getActiveFlyerPrice(province, sku);  // ✅ shipped
  if (flyer) return flyer;
  try { return await scrapeSameday(sku, warehouseId); }
  catch { /* fall through */ }
  if (process.env.UNWRANGLE_KEY) {
    try { return await scrapeViaUnwrangle(sku, warehouseId); } catch {}
  }
  if (process.env.SCRAPINGBEE_KEY) {
    try { return await scrapeViaScrapingBee(sku); } catch {}
  }
  return null;
}
```

---

### Canadian "Warehouse Runner" full product

**Inspiration:** [Warehouse Runner](https://app.warehouserunner.com/) tracks
Costco prices across 600+ US warehouses and alerts on local drops.

**Canadian opportunity:** No equivalent for the Canadian market.
PriceBack already has the heavy infrastructure done (✅ flyer overlay,
✅ receipt OCR + warehouse ID, ✅ crowdsourced contributions, ✅ push pipeline).
What's left is the **product surface**.

#### Timeline (revised after flyer overlay shipped)

- **v3.0** — Warehouse price history visible in-app (read-only). Now feasible because `flyerHistory.json` already persists every flyer price observation.
- **v3.5** — ✅ Opt-in crowd contribution from scans *(shipped via Plan B + ≥6-user gate)*.
- **v4.0** — Dedicated "Deals near you" feed (🟡 backend ready, mobile screen still 🔵), push alerts for local price drops (✅ shipped via flyer sweep).

#### Revenue models still to consider
- Free tier: see prices at your warehouse only.
- Pro tier (add-on): see prices at all warehouses in a 50 km radius.
- Higher tier ($19.99/mo) for power users / cross-province comparisons.

#### Still required for the full vision
- Geocoding: warehouse ID → lat/lng for "near me" features.
- Outlier detection for OCR'd prices (prices 10× the median get flagged) — minimal version already present in `warehousePricing.js` (±30% off the high-confidence median).
- Per-region flyer ingestion beyond Ontario (currently only ON; QC / BC / AB etc. each need their own weekly upload).

---

### 🔵 Other parked ideas

#### 🔵 Flyer parser — "SAVE $N"-only banner tiles
- The geometry flyer parser (`backend/services/flyerTextParser.parseFlyerWords`,
  shipped 2026-06-26) extracts every tile that has an item number **and** a
  readable price block. Some flyer tiles are pure marketing banners — a big
  "SAVE $100" headline with **no SKU and no `was/-savings/promo` block** (e.g. a
  category teaser pointing at Costco.ca). These are intentionally **skipped** for
  now (no SKU = no `price_points` join key; no price = nothing to record).
- Future: optionally surface them as a separate "category promo" signal (banner
  text + savings headline + the section's valid-from/until), shown in review but
  not written to `price_points`. Low priority — they carry no per-item price.

#### ✅ ~~PDF export~~ — SHIPPED 2026-05-20
Annual + month/quarter/all-time PDF reports via `expo-print`. See `src/services/exportService.js`. Profile → Export Data.

#### 🔵 Family sharing (Unlimited tier)
- Share receipts across up to 6 household members
- Already listed as Unlimited tier feature in `purchaseService.js`
- Needs: real auth/user accounts beyond local — `users.json` backend table exists but no household join model
- Requires backend user schema redesign

#### 🔵 Advanced analytics (Unlimited tier)
- Category breakdown, spending trends, best-value-store-per-category
- Already listed in `purchaseService` features
- Most data already captured; needs UI work

#### 🔵 Receipt photo persistence
- Currently images live in app cache (lost on reinstall)
- Copy to permanent storage via `expo-file-system`'s persistent directory
- Low priority — receipts don't usually need viewing after claiming

#### 🔵 Barcode database
- `BarcodeScanScreen` lets users enter barcodes but doesn't look up product info
- Future: hit UPC database API (upcitemdb.com or similar) to auto-fill product name
- Would make barcode scanning much smoother

#### ✅ ~~Receipt editing after save~~ — SHIPPED 2026-05-20
DetailScreen editor now covers item name / price / qty / sku, header date / total / tax / warehouseId, and "+ Add item". See commit `bc37371`.

#### 🔵 Dark mode toggle
- Removed in v2.5.0 but can come back as proper theme context with full re-render
- Users have asked for this
