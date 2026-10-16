# Backend backward compatibility — old app builds keep working

**Last updated:** 2026-10-10 (forced update added) · **Rule source:** `CLAUDE.md` in `maxim-lucas/Priceback`,
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
- Builds that don't report themselves (**3.0.6 and older**) are never refused.
  They wouldn't understand the 426. For them, rules 1–5 are the only protection.
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

## Open gaps

1. ~~No client version on requests~~ **Done** (3.0.7): `X-App-Platform`,
   `X-App-Build`, `X-App-Version` on every backend call, logged as `appBuild`.
2. ~~No minimum-supported-version gate~~ **Done** (3.0.7): Admin · App version
   plus the "Update required" screen.
3. **Builds ≤ 3.0.6 can't be forced and can't be patched.** They drain only as
   users update on their own. Until the build mix in the API audit log (`appBuild`
   is null for them) and Play Console → *Statistics → App version* show them
   gone, every backend change must keep them working.
4. **OTA is unavailable on the current EAS plan.** With OTA, a fix (or the update
   gate itself) could reach an existing binary of the same version. Worth
   weighing against the plan's cost the next time an installed build can only be
   fixed client-side.
