# Audit — Findings & Resolutions

> **HISTORICAL (2026-06-01).** This audit predates the DB redesign v2 (the
> migration chain it references — e.g. `0003_trial_credit_gating` — was
> squashed into `0000_initial.sql`) and the Neon→Supabase move (Neon is
> retired). Kept for the record; for current pre-publish status see
> `docs/PUBLISH_CHECKLIST.md`.

_Full audit run 2026-06-01 on branch `feat/audit-fixes`. Scope: frontend (Jest),
backend (node:test against the Neon `Preview` branch / `priceback_db`),
typecheck, shared-code sync, git state. All four findings are now **resolved**._

## Final status

| Check | Result |
|---|---|
| Frontend Jest (`npm test`) | ✅ **608 / 608 pass** (23 suites) |
| Backend against Neon `Preview` (`DATABASE_URL=… npm test`) | ✅ **328 / 328 pass**, 0 fail, 0 skipped |
| Typecheck (`npm run typecheck`) | ✅ exit 0 |
| `shared/` → `backend/shared/` sync | ✅ in sync |
| Git working tree | ✅ all work committed to `feat/audit-fixes` |

---

## ✅ 1. RevenueCat top-up double-granted 75 trial credits — FIXED

**Was:** the RC webhook created the FK-parent user via `upsertFromOAuth`, which
granted 75 `FREE_TRIAL_CREDITS` unconditionally on creation → a purchase-first
(never-signed-in) user ended at 375, with a misleading `signup_grant` ledger row.
`dbRoutes.test.js:205` failed (`375 !== 300`).

**Fix (decision: gate on the OAuth `email_verified` claim):**
- `defaultVerifyAuth` (`backend/server.js`) now surfaces `emailVerified` from the
  provider token (Google boolean / Apple `"true"`).
- `upsertFromOAuth` (`backend/repos/usersRepo.js`) no longer grants on creation.
  It grants 75 once, only when the account has a **real, verified** email
  (`emailVerified === true` and not the synthetic `@unknown.local` placeholder),
  guarded by a new `users.trial_credits_granted_at` column so it fires **at most
  once** — including the purchase-first → later-verified-sign-in path.
- Webhook placeholders (no real email) now get **0** trial credits, so the
  top-up test passes unchanged (exactly 300).
- New column + backfill: `backend/db/migrations/0003_trial_credit_gating.sql`
  (existing rows marked already-granted so they never collect a second grant;
  historical over-grants are not clawed back). **Migration applied to the Neon
  `Preview` branch.** Apply to production with `npm run db:migrate` on deploy.
- Tests added in `backend/tests/signupCredits.test.js`: unverified email → 0
  credits; purchase-first placeholder → 0, then exactly one grant on first
  verified sign-in, none on re-sign-in; ledger reconciles.

> **Prod deploy note:** run the `0003` migration before/with the next backend
> release, and confirm the live Google/Apple tokens carry `email_verified` (they
> do by default). Until the migration runs, the new code is harmless (it just
> reads a column that the migration adds).

## ✅ 2. Uncommitted store-policy work on `main` — COMMITTED

The DB-only store-policy serving (break-glass `kv_state` flag
`policies_file_fallback_enabled`; empty/failed table → 503) plus the STORE-02
doc update is now its own commit on `feat/audit-fixes` (no longer loose on
`main`). Verified by `storePoliciesDb.test.js` / `routes.test.js`.

## ✅ 3. `pg` SSL-mode deprecation warning — FIXED

`backend/db/client.js` now strips the URL's `sslmode` / `channel_binding` /
`ssl` query params and pins TLS via the explicit `ssl` Pool option (behavior
unchanged). The deprecation warning no longer appears in the backend test run.

## ✅ 4. `tsc` errors inside `expo-modules-core` — FIXED (isolated to typecheck)

Expo SDK 55's `expo-modules-core` ships uncompiled `.ts` with an empty `build/`
dir and a `types` condition pointing at a non-existent `build/index.d.ts`, so
tsc type-checked its source and flagged its own stale `@ts-expect-error`
directives (TS2578).

Fix: an ambient stub (`src/stubs/expo-modules-core.d.ts`) plus a **dedicated**
`tsconfig.typecheck.json` that remaps the `expo-modules-core` specifier to it.
Run via **`npm run typecheck`** (exit 0).

> ⚠️ The remap is intentionally **not** in `tsconfig.json`: Metro/Babel/jest-expo
> also read `tsconfig.json` `paths`, and redirecting the runtime to a
> declaration-only stub breaks bundling/tests (verified — it broke all 23 Jest
> suites). Use `npm run typecheck`, not bare `tsc`. Bare `tsc --noEmit` will
> still surface the two upstream third-party errors; that is unavoidable without
> breaking the bundler and is not a defect in our code.

---

### Notes
- DB work ran against the Neon `Preview` branch (`br-steep-breeze-aqeg0i38`) /
  `priceback_db` per project policy — no new branches, production untouched.
- The `samedayScraper` / `notificationService` `console.warn` lines in the Jest
  output are expected (failure-path coverage); all suites pass.
</content>
