# Backend backward compatibility — old app builds keep working

**Last updated:** 2026-10-10 · **Rule source:** `CLAUDE.md` in `maxim-lucas/Priceback`,
section *"The backend never breaks an app build that is still installed"*.

## Why this matters

| | Backend (Railway) | App (Play / App Store) |
|---|---|---|
| Who gets a new version | **Everyone, instantly**, on deploy | Only users who update — after store review |
| Can old copies be fixed remotely? | n/a — there is one copy | **No.** `runtimeVersion.policy = appVersion`: an OTA update only reaches the binary of the same version. A 3.0.5 phone runs 3.0.5's JS until the user updates |
| Can the server tell callers apart? | **Not today** — the app sends no version header | — |

So the backend always serves a mix of builds. Today it reaches back to **v2.8.3**,
which `backend/server.js` still accommodates (`/api/ocr` stays optional-auth because
2.8.3 sends no `Authorization` header). Every deploy has to be safe for all of them.

## The checklist (every PR touching `backend/` or a migration)

The PR template's **Old app builds** section asks for these. All must hold:

1. **Additive API only.** No route, request field or response field that a shipped
   build reads is removed or renamed, and none changes type, unit or meaning.
   A changed meaning gets a *new* field or route; the old one keeps its old
   behaviour until the builds that use it are gone (step 5).
2. **New request fields are optional.** A request without them gets exactly the
   pre-change behaviour. An old request shape must never become a 400.
3. **New refusals land on a path old builds already handle.** A new error code, a
   new limit, or a new 4xx on an existing route is checked against each live
   build's handling of that route:
   ```bash
   git tag --sort=-creatordate | head          # the live builds
   git show v3.0.5:src/services/ocrService.js  # how that build reacts
   ```
   If an older build would show misleading text, crash, retry forever or drop
   data, only enforce the new behaviour for requests that prove they come from a
   build that understands it (a field only the new build sends).
4. **Expand → migrate → contract** for the database.
   - *Expand:* additive, idempotent migration (`IF NOT EXISTS`, `DO $$` guards),
     applied to prod **before** the code that needs it deploys. Prod's ledger is
     hand-maintained — run the file, then insert the ledger row.
   - *Migrate:* deploy code that writes both shapes / reads the new one with a
     fallback; backfill.
   - *Contract:* a **later** migration drops the old column/table, once no deployed
     backend and no live build depends on it. Migration 0022 (`tag_scan_reviews.sku`)
     is the reference example.
5. **Shims are labelled and removed only with evidence.** A compatibility branch
   names the build it serves in a comment. It's deleted only when Play Console /
   App Store Connect version data shows that build has gone, and the PR says so.
6. **Tests keep the old shape.** When a route's request or response changes, a
   backend test still sends the *previous* request shape and asserts it works.

### When a break is unavoidable

Don't ship it as a plain deploy. Either keep both behaviours side by side until
the old build is gone, or (once it exists — see gaps below) raise the
minimum-supported version so the old build shows a translated "please update"
screen instead of failing in some random way.

## Audit — 2026-10-10: deploying `main` while 3.0.5 is the store build

The store build is **3.0.5** (`v3.0.5`, 2026-10-04). `main` carries every backend
change from #404 to #420 (`git diff v3.0.5..HEAD -- backend`), plus migrations
0020–0023. Each change was checked against what 3.0.5 and older builds do with
the response.

### Safe: no action needed

| Change | Why old builds are fine |
|---|---|
| Routes | None removed. New ones are only `/api/price-tag/scan-quota` and admin routes. |
| Migrations 0021, 0022, 0023 | Additive and idempotent (`ADD COLUMN IF NOT EXISTS`, new table, `sku DROP NOT NULL`). Prod is applied by hand: **run them before the deploy.** The code fails open / answers 503 on admin routes if they're missing. |
| `POST /api/check-price`: SKU-only, never Costco by name (#409) | Answers `currentPrice: null` instead of a guessed price. 3.0.5's `qualifiesAsDrop` needs a finite price, so it shows "not checked" instead of a fake drop. The new `source: "scrape_sku"` is a value 3.0.5 accepts. This is an improvement for 3.0.5. |
| Legacy name-scrape push sweeps removed (#409) | Server-only. 3.0.5 users stop getting the fake "$75.00" drop pushes. Real drops still come through the review queue. |
| `POST /api/watch`: lines stored by product id (#412) | 3.0.5 sends `sku` + `storeId`, which resolve to the product id. A line with no real SKU is dropped, but nothing could alert on it anyway once the name scraper was gone. The new `503 WATCH_UNAVAILABLE` is ignored: 3.0.5's registration is fire-and-forget, keeps the previous list and re-sends on next launch. |
| `POST /api/observations/tag`: regular and expired tags refused before any write (#415) | Same `status` values (`no_savings`, `expired`) 3.0.5 already renders. `imageUploadUrl: null` makes 3.0.5 skip the photo upload, which is correct. |
| `POST /api/receipts`: optional `language`, new `items`/`products` in the reply (#412) | The request field is optional (absent before 3.0.6, ignored if invalid), and 3.0.5 ignores the extra reply fields. |
| Receipt PDFs read up to 5 pages (#416) | Server-only: more of a long receipt is read, same response shape. |
| #420: online orders don't register a warehouse | Server-only, and it fixes the fake warehouses 3.0.5 online receipts created. |

### Degrades on 3.0.5

| # | Change | What a 3.0.5 shopper sees | Fix that keeps 3.0.5 working |
|---|---|---|---|
| 1 | **Migration 0020: Unlimited plan bullets reordered** | The paywall's French bullets are translated **by position** (`catalog.tier.unlimited.features.<i>`), and 0020 inserted "Unlimited price drop claims" at index 1. In French, 3.0.5 shows: line 2 "Aucuns frais par baisse de prix" for *unlimited claims*, line 3 "Synchronisation des courriels" for *no per-drop charge*, line 4 "Vérification prioritaire des prix" for *Price Checker*, line 5 **"Export PDF des réclamations"** for *email sync* (a feature that is now parked), and line 6 in English. A paid tier listing a feature it doesn't include is an App Review / consumer-protection risk. | 3.0.5's `catalogFeatures()` already prefers a per-language array: if the tier carries `featuresFr`, it's used as-is. Add `featuresFr` (the new list, in the new order) to the Unlimited tier in `/api/v1/pricing.json`. It's additive, and 3.0.6+ is unaffected. |
| 2 | **0020 removes `pdf_export` from Unlimited's `feature_keys`** | A 3.0.5 Unlimited subscriber who taps Export in Profile gets the "see plans" upgrade prompt, even though they're already on the top tier. | A product decision: keep `pdf_export` in Unlimited's keys until 3.0.5 drains, or accept it. The feature is parked on purpose (`Parked_Features.md`). |
| 3 | **Price-tag scan cap (#414)** | 3.0.5 sends `scanContext.flow = "price_tag"`, so the cap applies. The 6th scan of the day returns `429 tag_scan_limit`, which 3.0.5 treats like any 429: *"Too many scan attempts just now — this can also happen on a weak connection. Please wait a moment and try again."* That's English-only and wrong, because the block lasts until tomorrow or next week. 3.0.5 never calls `/scan-quota`, so the shopper gets no warning first. | Accept until 3.0.5 drains, or only enforce the cap when the request carries a marker that only 3.0.6+ sends. |

Older still: builds **≤ 3.0.4** send no `scanContext`, so the tag cap never applies
to them (only the per-device/IP limits and the Vision budget do). **2.8.3** sends
no `Authorization` header, so `/api/ocr` stays optional-auth.

## Open gaps (recommended follow-ups)

1. **No client version on requests.** Have the app send `X-App-Version` and
   `X-App-Build` (from `expo-application`) on every backend call. Then the server
   can log the live-build mix, gate new behaviour per build (step 3) and prove a
   shim is dead (step 5). It only helps builds that include it, so ship it soon.
2. **No minimum-supported-version gate.** A `/api/app-config` field
   (`minSupportedBuild`), plus an in-app blocking "Update PriceBack" screen in
   `en` + `fr`. That gives a controlled lever for a truly unavoidable break.
   The same caveat applies: only builds that include the screen can show it.
3. **No server-side view of the build mix.** Until (1) exists, use Play Console
   → *Statistics → App version* and App Store Connect → *Analytics* to see
   which builds are still live before removing any shim.
