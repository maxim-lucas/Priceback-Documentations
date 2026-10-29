# Backend backward compatibility — old app builds keep working

**Last updated:** 2026-10-23 (audit of #481–#484 and #486) · **Rule source:** `CLAUDE.md` in `maxim-lucas/Priceback`,
section *"The backend never breaks an app build that is still installed"*.

## Why this matters

| | Backend (Railway) | App (Play / App Store) |
|---|---|---|
| Who gets a new version | **Everyone, instantly**, on deploy | Only users who update — after store review |
| Can old copies be fixed remotely? | n/a — there is one copy | **No.** OTA updates are unavailable on the current EAS plan, and even with them `runtimeVersion.policy = appVersion` only reaches the binary of the same version. A 3.0.5 phone runs 3.0.5's JS until the user updates, so **its problems are fixed on the server or not at all** |
| Can the server tell callers apart? | **From 3.0.7:** `X-App-Platform` / `X-App-Build` / `X-App-Version` on every request (logged as `appBuild` in the API audit line). 3.0.6 and older send nothing | — |
| Can an old build be made to update? | — | **From 3.0.7:** yes. Raise the minimum build (below). 3.0.6 and older: no, keep them working |

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

### When a break is unavoidable: force the update

Never ship a change that makes an installed build misbehave. If it really can't
be kept working (rules 1–3), make that build **stop and ask for the update**
instead:

1. Ship the build that works with the change, and wait until it's **live to 100%**
   in that store: Play Console → the release → *Rollout 100%*, and App Store
   Connect → *Ready for Distribution* with phased release finished or paused at 100%.
2. **Admin · App version** (console → Health): set that platform's minimum build
   to the new build's `versionCode` / `buildNumber`. You'll be asked to confirm
   who gets blocked. It applies within ~5 minutes, with no redeploy.
3. Deploy the backend change.

What a phone below the minimum does:
- At launch and on every return to the app it calls `GET /api/v1/app-status`,
  gets `updateRequired: true` and shows a full-screen, translated **"Update
  required"** screen. Its only button opens the PriceBack store listing, and the
  Android back button doesn't dismiss it.
- Every other API call it makes gets `426 update_required`, which raises the same
  screen if it's not already up.
- The verdict is stored on the phone, so it stays blocked offline. It lifts by
  itself once the installed build reaches the minimum, i.e. after the update.

Safety rails:
- **0 = off** (the default). Set per platform, because the two stores publish on
  their own schedule.
- The server refuses a minimum above the build on the admin's own phone (typo
  guard: 490 for 49). A minimum past the newest published build would lock
  everyone out with nothing to update to.
- Builds that don't report themselves (**3.0.6 and older**) are never refused by
  the minimum. They have no update screen, so a 426 alone shows no update
  message. Their way to the store is the **update reminder** (a push the OS draws
  over the open app each time they open it) and, once 3.0.7+ is live in both
  stores, **Refuse builds before 3.0.7**. Full procedure, coverage per build and
  the iOS specifics: `Operations/Forcing_An_App_Update.md`. Until those are on,
  rules 1–5 are the only protection.
- Everything fails open: a network error, a bad reply or a config read failure
  never blocks the app. Only an explicit server verdict does.
- Code: `backend/lib/appVersionGate.js` (server), `src/services/appVersionGate.js`
  and `src/components/UpdateRequiredScreen.js` (app), with tests on both sides.

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

### Degrades on 3.0.5: status after app PR #421

| # | Change | What a 3.0.5 shopper saw | Status |
|---|---|---|---|
| 1 | **Migration 0020: Unlimited plan bullets reordered** | The paywall's French bullets are translated **by position** (`catalog.tier.unlimited.features.<i>`), and 0020 inserted "Unlimited price drop claims" at index 1. In French, 3.0.5 showed every bullet from line 2 on beside the wrong French, including **"Export PDF des réclamations"** for a parked feature. | **Fixed server-side.** `/api/v1/pricing.json` now gives every tier a `featuresFr` list, keyed by the English text (`shared/catalogFeatureLabels.js`). 3.0.5's `catalogFeatures()` prefers it over the positional keys. A test keeps the table identical to the app's French. |
| 2 | **0020 removes `pdf_export` from Unlimited's `feature_keys`** | A 3.0.5 Unlimited subscriber who taps Export in Profile gets the "see plans" upgrade prompt, even though they're already on the top tier. | **Open: product decision.** Keep `pdf_export` in Unlimited's keys until 3.0.5 drains, or accept it (the feature is parked on purpose, `Parked_Features.md`). With #1 fixed, the paywall no longer advertises it. |
| 3 | **Price-tag scan cap (#414)** | The 6th tag scan of the day got `429 tag_scan_limit`, which 3.0.5 shows as *"Too many scan attempts just now… please wait a moment and try again"*: English-only and wrong. | **Fixed server-side.** The cap is enforced only for builds that declare **3.0.6+** (`scanContext.appVersion`, sent since 3.0.5, or the `X-App-Version` header). 3.0.5 keeps its pre-cap behaviour; the per-device/IP limits and the Vision budget still apply. |

Older still: builds **≤ 3.0.4** send no `scanContext`, so the tag cap never applies
to them (only the per-device/IP limits and the Vision budget do). **2.8.3** sends
no `Authorization` header, so `/api/ocr` stays optional-auth.

## Audit — 2026-10-23: the sync-integrity and Gemini-first hotfixes (#481–#484, #486)

The store build is **3.1.3** (build 53). Every live build since **2.8.3** was checked against what it does with each
change. Source: `Technical/Device_Server_Sync_Audit_2026-10-23.md`.

| Change | Why old builds are fine |
|---|---|
| `POST /api/receipts`: a re-send is never charged or 402'd (#481) | A request shape every build sends. It removes a charge; nothing new is refused. |
| Restore pages ordered `(purchase_date, id)` (#481) | Same rows, now a stable order. |
| Gemini rules, never-merge (#482) | Server Gemini paths only. `/api/ocr-llm` keeps its four item fields. |
| `badScanRepair` modes (#483) | Admin routes only. A named refusal is now a 4xx instead of a 500 (admin build only). |
| **Migration 0032** (`receipt_readers`, `receipts.reader_id`) | Additive, nullable, admin-only: stripped from every shopper payload. **Apply to prod before #484 deploys.** |
| `POST /api/receipts/gemini-read`, Admin · Receipt reading routes (#484) | New routes; no shipped build calls them. |
| `POST /api/receipts`: optional `reader` (#484) | Absent from every shipped build → NULL. An unknown code → NULL, never a 400. |
| `/api/ocr-llm`: `proven`, `checks` (#484) | Additive response fields; old builds ignore them. |
| **Server re-read** (`RECEIPT_GEMINI_REREAD`, OFF at deploy) | Changes lines old builds show: they take them on their next sync, paired **by position**. It only touches a receipt under 30 min old with no claim, push or review row. The residual risk is in the roadmap (*Sync integrity: deferred*). |
| `/api/watch`: no crowd copy a re-read or a shopper correction disproves (#484, #486) | Fire-and-forget registration, same answer. Only crowd copies are skipped; the watch registry is unchanged. |
| **Migration 0033** (`shopper_edited_at` ×2, `receipt_items.client_line_id`) | Additive, nullable. **Apply to prod before #486 deploys.** |
| `PUT /api/receipts/:id/lines` (#486) | New route; builds before it never call it. |
| Claim / watch / delete: optional `itemId` (#486) | Absent → the old index + amount rule, unchanged (tested). |
| Restore lines: `taxClass`, `clientLineId`; upload answer: line `id` + `lineTotal`; released drops: `itemId` (#486) | Additive fields; old builds ignore them. |
| Drop drain holds a drop on a **shopper-corrected** line for an admin, with review off (#486) | Only lines corrected through the new route, which old builds never call. |

Forcing builds: none needed. Every change is additive or behind a switch that ships off.

## Audit — 2026-10-27: the weekly catalogue harvest (hotfix `hotfix/catalog-harvest`, migration 0037)

Every live build back to **2.8.3**, through the newest tag **3.2.0** (build 55), against each change.
Source: `Technical/Product-Catalog-Harvest.md`.

| Change | Why old builds are fine |
|---|---|
| **Migration 0037** (`catalog_*`, `product_merges`, `receipt_items.sku_read`, `products.name_locked_at`) | Additive, nullable / defaulted. **Apply to prod before the code deploys**: every receipt save writes `sku_read`. |
| `POST /api/receipts`: a line whose item number no catalogue lists is filed under the catalogue item it misreads (`CATALOG_SKU_FIX_ENABLED`, on) | Same request, same answer shape. The line's `productId` in the answer is the real product's, which 3.0.6+ use only to show the product's label; every build keeps its own printed name and number (`applyLineProducts`). Pre-3.0.6 builds ignore the field. |
| `PUT /api/receipts/:id/lines` sending the number the phone READ back for a corrected line | Not a change: the line keeps its real product (`sku_read` guard). |
| `POST /api/watch` naming a product folded away (old id or misread number) | Answered with the real product (`resolveProductIds` → `mergedIds` / aliases). Every build; before this the entry was simply dropped as unknown. |
| Products renamed to their official English/French names weekly | Same fields. Builds that show the product's label show the official name; builds that show their own line text are unchanged. |
| Restore / bootstrap lines: `skuRead` | Additive field; old builds ignore it. |
| Console catalogue routes, `DELETE /api/admin/products/:id/name-lock` | New admin routes; no shipped shopper build calls them. |

## Audit — 2026-10-28: the receipt footer and the receipt quality check (#502, PR-2)

The store build is **3.2.0** (build 55); every build back to **2.8.3** was checked. `v3.2.0`'s
`checkAppStatus` reads only `maintenance`, `updateRequired` and `minSupportedBuild` from app-status; its admin desk
sends only its own `status=` chips and ignores unknown row and receipt fields.

| Change | Why old builds are fine |
|---|---|
| **Migration 0039** (`receipts.footer_ocr`) | Additive, nullable. **Apply to prod before #502 deploys.** |
| `POST /api/receipts`: optional `footerOcr` (#502) | Absent from every shipped build → NULL; the route answers exactly as before (tested: *an upload without footerOcr*). |
| Restore / bootstrap: `footerOcr` per receipt (#502) | Additive field; old builds ignore it. |
| `backend/shared/ocrCleanup.js` payment vocabulary (#502) | Server Gemini denoise only; no request or response shape changes. |
| **Migration 0040** (`receipt_quality_*`, four tables) | Additive; the deployed backend before PR-2 neither reads nor writes them. **Apply to prod before PR-2 deploys.** |
| `POST /api/receipts`: optional `qualityCheck` (PR-2) | Absent from every shipped build → the server judges the upload itself; a malformed one is ignored, never a 400 (tested). |
| The shadow check after `POST /api/receipts` (PR-2) | Runs after the answer is sent, after the OCR capture link (unchanged); changes no receipt, credit or push. |
| `GET /api/v1/app-status`: `receiptQuality` (PR-2) | Additive field; 3.0.7–3.2.0 read only their three fields; builds before 3.0.7 never call it. |
| Admin desk: `quality` per row, `qualityCheck` on the receipt, chips `quality_flagged` / `quality_unlabelled`, `POST …/quality-label` (PR-2) | Additive; the 3.2.0 desk never sends the new chips. |
| `POST /api/admin/receipts/:id/reject` also labels the receipt's quality verdict Bad (PR-2) | Same answer; the label is a new table only. |
| `POST /api/receipts/quality-refusals`, `/api/admin/receipt-quality-*`, `/api/admin/console/receipt-quality` (PR-2) | New routes; no shipped build calls them. |
| **Refusal in the app** (`RECEIPT_QUALITY_REFUSE_*`, all OFF at deploy) | Only builds after 3.2.0 refuse; older builds never refuse, whatever the switches say. |

Forcing builds: none needed.

## Open gaps

1. ~~No client version on requests~~ **Done** (3.0.7): `X-App-Platform`,
   `X-App-Build`, `X-App-Version` on every backend call, logged as `appBuild`.
2. ~~No minimum-supported-version gate~~ **Done** (3.0.7): Admin · App version
   plus the "Update required" screen.
3. **Builds ≤ 3.0.6 can't be patched, and can only be *asked* to update.**
   Since 2026-10-15: the update reminder push on every opening, plus *Refuse
   builds before 3.0.7* (App Store-checked) — `Operations/Forcing_An_App_Update.md`.
   A shopper with notifications off gets no reminder. Otherwise they drain only as
   users update on their own. Until the build mix in the API audit log (`appBuild`
   is null for them) and Play Console → *Statistics → App version* show them
   gone, every backend change must keep them working.
4. **OTA is unavailable on the current EAS plan.** With OTA, a fix (or the update
   gate itself) could reach an existing binary of the same version. Worth
   weighing against the plan's cost the next time an installed build can only be
   fixed client-side.
