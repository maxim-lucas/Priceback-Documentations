# Security Roadmap — the one backlog

**Created 2026-09-17 (audit run 3), against `main` at `8575baf`.** This is the single list
of every security item that is known and not yet closed, across the three 2026 audits
([run 1](./Security_Audit_2026-09-14.md), [run 2](./Security_Audit_2026-09-17.md),
[run 3](./Security_Audit_2026-09-17_run3.md)), the older
[`SecurityRecommendations.md`](./SecurityRecommendations.md) register, and the operator
actions that never lived in code.

**How to use it**

- When an item closes, set **Status** to `CLOSED — PR #n` (or the date for an operator
  action). **Never delete a row**: the closed rows are how the next audit knows what not to
  re-derive.
- When a new audit finds something, append it here in the same commit as the report.
- Severity is the audit's own rating. **Effort** is S (< 1 h, one file), M (half a day, a
  test suite), L (a design + migration + client change). **Owner** says who can close it.
- Nothing here is Critical or High as of run 3. That is the reason this file exists instead
  of a hot-fix branch.

Counts at creation: **41 open rows** (42 ids — L-3 and R3-4 share one row): 15 from run 3,
8 Medium + 10 Low from run 2 (M-6 re-rated to Low), 1 from run 1 (L-C), and 8 operator /
compliance items carried from run 2, the older register and the project memory (OPS-1…6,
REC-3, COMP-1). Run 2's "Firebase key on disk" is absorbed into R3-14.

---

## Before the first users arrive

Six items, none over an hour, ordered by what they buy.

| Order | Id | Why first | Effort | Owner |
|---|---|---|---|---|
| 1 | **R3-15** | Decides whether L-1 is Low or High. One `/health?token=` call. | S | Operator |
| 2 | **R3-1** | Brand mail spoofable today; phishing risk scales with installs. DNS only. | S | Operator |
| 3 | **OPS-1** | The R2 key holds user receipt photos; four documents still say rotation is owed. Confirm or rotate. | S | Operator |
| 4 | **M-5** | A replayed Apple token buys a 60-day session; the client nonce is already in every store build. One condition flip + test. | S | Code — backend |
| 5 | **M-1** | The only destructive route with no rate limiter. One line. | S | Code — backend |
| 6 | **R3-2** | Mailbox tokens outliving the account. Two function calls + test. | S | Code — mobile |

---

## Medium

| Id | Finding | Concrete fix | Effort | Owner | Trigger to revisit | Source | Status |
|---|---|---|---|---|---|---|---|
| **M-1** | `DELETE /api/me/observations` (`backend/server.js:5503-5532`) is unauthenticated, unthrottled, and for an anonymous caller runs `revokeForDevice` **unbounded**. | Add `if (creditRateLimited(req, res, "me-observations", clientIpForRateKey(req))) return;` as the first statement. Longer term: require a Bearer once every client sends one on this route, then drop the anonymous branch. Route-level test that the limiter fires; mutation: delete the line → red. | S | Code — backend | Now | Run 2 | OPEN |
| **M-2** | `isAdminContributor` (`server.js:3620-3635`) resolves admin status from `devices.owner_sub` of a **client-supplied** `deviceId` when no Bearer is present; forged prices then bypass rule-of-N and can charge users credits. | Two steps in order: (1) make the client send `/api/watch` through `authedFetch` when signed in (`src/services/priceService.js:578` is plain `fetch`); (2) remove the device fallback so only a verified `sub` can be admin. Test both: no token → never admin. | M | Code — both | After (1) ships in a store build | Run 2 | OPEN |
| **M-3** | `express.json({limit:"10mb"})` (`server.js:50`) parses before any limiter; every limiter is a line inside a handler; the 404 path has none. In-memory counters reset on redeploy. | Mount a per-IP global brake before the body parser (e.g. 300 req/min); give `/api/ocr` and `/api/admin/flyer-scan/extract` their own 10 MB parser and drop the default to 1 MB. Test: an 11 MB body to `/api/me` → 413 before parse. Redis/Postgres-backed counters only when a second instance exists. | M | Code — backend | Before scaling past one instance, or on first abuse report | Run 2 | OPEN |
| **M-4** | `cors({origin:"*"})` (`server.js:55`) lets any web page drive `/api/ocr`, `/api/analytics`, `/api/check-price` from visitors' browsers, defeating per-IP brakes. **Run 3 verified the static site makes zero browser API calls**, so deny-by-default breaks nothing. | `cors({ origin: (o, cb) => cb(null, !o), credentials: false })` — native clients send no `Origin`. Add an allowlist the day a web client exists. Test: request with `Origin: https://evil.example` gets no `access-control-allow-origin`. | S | Code — backend | Now (free) | Run 2 / Rec §1 | OPEN |
| **M-5** | `backend/lib/appleAuth.js:228-231` accepts an Apple ID token with no `nonce` claim as "legacy". A captured token is a pure bearer for ~10 min and mints a 60-day refresh token at `POST /api/auth/session`. **Run 3 verified** the client nonce shipped in PR #259 (2026-08-12) and is inside `v2.9.0`. | Replace the `nonceLegacy` branch with a throw; keep `appleNonceStats` as a counter of rejected legacy tokens. Test: token without `nonce` → rejected. Only pre-#259 internal builds lose Apple sign-in. | S | Code — backend | Now (no live users) | Run 2 | OPEN |
| **M-7** | `receipts_v2` in AsyncStorage holds the **Costco membership number**, `rawOcr`, `headerOcr` (street address, postal code, phone); `user_prefs_v1` holds postal code + province. Plaintext on a rooted/jailbroken device. | Two halves: (a) stop persisting what nothing reads — `memberId` (see L-C, Costco-rule gated) and the address lines of `headerOcr`; (b) for what must stay, an encrypted store (`react-native-mmkv` with an encryption key held in SecureStore, or `expo-sqlite` + SQLCipher) behind the existing `storageService` API so screens do not change. | L | Code — mobile | When receipts start carrying more than Costco data, or on the first device-forensics question | Run 2 | OPEN |
| **M-8** | `plugins/withIosBackupExclusion.js` excludes the three image directories but not AsyncStorage's directory, so M-7's PII rides encrypted iCloud backups outside the published retention window. Android is covered (`allowBackup: false`). | Add the AsyncStorage directory to the exclusion list — **confirm the real path on a device first** (`RCTAsyncLocalStorage_V1` under `Documents/` on older builds, under `Application Support/` on newer `@react-native-async-storage`). Pin with the existing plugin test. | S | Code — mobile | Same as M-7 | Run 2 | OPEN |
| **R3-1** | `priceback.ca` DMARC `p=none`, SPF `~all`. Mail "from" `support@` / `security@` / `privacy@priceback.ca` is delivered. DKIM (`zmail`) is already published. | `_dmarc.priceback.ca` → `v=DMARC1; p=quarantine; pct=100; rua=…` now; `p=reject` after a week of clean reports; SPF `-all` once Zoho + the registrar forwarder are confirmed as the only senders. | S | Operator (DNS) | Now | Run 3 | OPEN |
| **R3-2** | `email_tokens_v1` (Gmail/Outlook access tokens, Outlook **refresh** token, mailbox address) is not cleared by `signOut()` (`src/services/authService.js:1003-1018`) nor by account deletion's `clearAllData()` (`src/services/storageService.js:1743-1769`). Gmail content is gated local-only; **Outlook is not**, so on a shared device the next account syncs the previous user's Outlook receipts into its own backend account. Latent: Gmail off at build time; Outlook only if `MICROSOFT_CLIENT_ID` is set in the EAS production env (unverified). | Call `clearTokens("gmail")`, `clearTokens("outlook")` and remove `email_sync_v1` inside `clearAccountScopedLocalState()` and `clearAllData()`. Test: after sign-out `getStoredTokens()` is empty. Separately verify Outlook enablement with `eas env:list --environment production`. | S | Code — mobile | Now | Run 3 | OPEN |

---

## Low

| Id | Finding | Concrete fix | Effort | Owner | Trigger | Source | Status |
|---|---|---|---|---|---|---|---|
| **L-1** | `/health?token=` (`server.js:3409-3423`) compares the admin token with **no throttle**, accepts it in the query string (edge logs, `Referer`, and the global error handler logs `req.originalUrl`). Severity depends on R3-15. | Reuse `consumeTokenAttempt(ADMIN_TOKEN_ATTEMPTS, ip, …)` before the compare; accept the header only once `scripts/import-flyer.mjs` and the ops runbook stop using `?token=`. Test: 11th bad token in an hour → 429. | S | Code — backend | After R3-15 | Run 2 | OPEN |
| **L-2** | `POST /api/auth/reviewer` mints a full-capability 60-day session for a shared reviewer account; the only defence is 10 tries / 15 min per IP. | Give `provider: "reviewer"` sessions a short refresh TTL (7 days) in `sessionsRepo.create`, and deny `/api/me/data-export`, `/api/me/account`, `/api/me/credits/topup` for `REVIEWER_SUB`. Rotate the code after each review. | S | Code — backend | Next App Review cycle | Run 2 | OPEN |
| **L-3 / R3-4** | The `/api/analytics` egress has no PII scrubber and **is live**: `reportHandledError` (`src/services/errorSupport.js:503-534`) → `track()` → unscrubbed local buffer → unauthenticated POST. Email-sync failures embed 300 chars of provider HTTP bodies. | Run `scrubObjectDeep` inside `track()` (`analyticsService.js:299-314`) so both sinks match Sentry. Test: an event with an email address in `context` is redacted before `flush()`. | S | Code — mobile | Now | Run 2, corrected run 3 | OPEN |
| **L-4** | `e?.message` echoed to the client on two admin routes (`server.js:5000`, `:5020`); a `DrizzleQueryError` message is raw SQL. | Replace with a constant message; keep the detail in the server log. | S | Code — backend | Next backend PR | Run 2 | OPEN |
| **L-5** | Sentry scrubber (`analyticsService.js:117-142`) skips `tags`, `transaction`, `request`, stack-frame `vars`; no pattern for a bare membership number or a non-`Bearer` JWT. | Extend `scrubSentryEvent` to those keys; add `\b\d{12}\b` (membership) and `eyJ[\w-]+\.[\w-]+\.[\w-]+` patterns. Test each key path. | S | Code — mobile | Next mobile PR | Run 2 | OPEN |
| **L-6** | Push payloads carry the product name + receipt id through Expo/APNs/FCM onto a lock screen (`backend/priceDropNotifier.js:271-290`). | Generic title ("A price dropped on a recent purchase"), item name only in the in-app screen; receipt id stays opaque. i18n both languages. | S | Code — backend | When a user asks why their lock screen names a purchase | Run 2 | OPEN |
| **L-7** | Receipt ids are `Date.now()` + a small random suffix (`storageService.js:186`); `hashDeviceId` is **unsalted** sha256 (`warehousePricing.js:30-32`). | Receipt ids → `Crypto.randomUUID()`. Device hash → HMAC with a server secret; needs a migration rehashing `price_points.device_hash`, `devices.device_hash`, `tag_scan_*` — or accept, now that H-2 made the input high-entropy. | M | Code — both | Only with a migration window | Run 2 | OPEN |
| **L-8** | `LIKE` metacharacters unescaped in the admin product search (`backend/repos/pricesRepo.js:248`). | Copy the escape from `usersRepo.js:191-194` (`%`, `_`, `\` + `ESCAPE '\\'`). | S | Code — backend | Next backend PR | Run 2 | OPEN |
| **L-9** | `priceback.touch_updated_at` has a role-mutable `search_path` (Supabase advisor WARN on both projects; `SECURITY INVOKER`). | Migration `0008`: `ALTER FUNCTION priceback.touch_updated_at() SET search_path = priceback, pg_temp;`. **Apply by hand to prod first** — its drizzle ledger is hand-maintained (see `Technical/Migration_Consolidation_2026-07.md`). | S | Code — backend + operator | Next migration | Run 2 | CLOSED — code in #345; **applied to prod 2026-09-24** alongside #354's migrations (a preflight found it unapplied); prod advisor WARN gone |
| **L-11** | Supabase advisor on **production**: "RLS disabled" on all 44 `priceback` tables. Not reachable on 2026-09-23 — `anon` / `authenticated` / `service_role` have no USAGE on the schema, and nothing uses the Data API — but one `GRANT` from an open door. (Dev's advisor did not flag the same tables — most likely because dev does not expose the schema to its Data API; not verified.) | Migration `0009_enable_row_level_security`: RLS on every table, no policies, never FORCEd; the backend (`postgres`) owns every table and has BYPASSRLS, so no query changes. `tests/rowLevelSecurityDb.test.js` fails any future table without it and proves a leaked grant reads 0 rows. **Apply by hand to prod** (LF hash `07fec8a1…`, `when` 1790100000000). The advisor then shows the INFO "RLS enabled, no policy" lint — intended. | S | Code — backend + operator | Now | Audit 2026-09-23 | CLOSED — Priceback PR #354; **applied to prod 2026-09-24**: 46/46 tables RLS on, advisor ERROR gone (INFO "no policy" only), dev = prod fingerprint `17e0ca84…` |
| **L-10** | The four `actions/*` in `.github/workflows/*.yml` are tag-pinned (`@v5`, `@v4`, `@v7`) while the gitleaks binary is SHA-256 pinned. | Pin each to a commit SHA with the version in a trailing comment; extend `__tests__/ciSupplyChainPolicy.test.js` to assert a 40-hex ref. | S | Process | Next CI edit | Run 2 | OPEN |
| **L-C** | `parsed.memberId` is written to the local `receipts_v2` record and nothing reads it back. Extraction is unaffected. | Drop the field at the write site. **Touches `src/services/receiptParser.js` — the shared dispatcher — so it needs Maxim's explicit go-ahead under the Costco rule.** | S (gated) | Code — mobile | Maxim's call | Run 1 | OPEN — deliberately |
| **M-6** (was Medium) | `POST /api/receipts/:id/image-uploaded` validates `objectKey` by `startsWith` (`server.js:8567`); `body.id` is unshaped and becomes part of the R2 key (`:8508`). Run 3: keys are caller-prefixed and stored literally — no cross-user path. | Validate `body.id` against `^[A-Za-z0-9_-]{1,64}$` at `POST /api/receipts`; equality check on the confirm route, as the price-tag twin does (`:4005`). | S | Code — backend | Next backend PR | Run 2, re-rated run 3 | OPEN |
| **R3-3** | Gemini via AI Studio **free tier** (`server.js:2289-2362`): Google may use submitted receipt text to improve models, incl. human review. Opt-in and disclosed as an AI pass, but not that consequence. | Enable billing on the GCP project so the key is paid-tier (no training use) — or add the sentence to the policy's AI section. | S | Operator / compliance | Now | Run 3 | OPEN |
| **R3-5** | DSAR export JSON with `memberId`, `rawOcr`, `headerOcr` written to `documentDirectory` root (`src/screens/StoresAndProfileScreens.js:932`), never deleted, outside the iCloud exclusion. | Write to `cacheDirectory`; delete when the share sheet resolves. Test the cleanup. | S | Code — mobile | Next mobile PR | Run 3 | OPEN |
| **R3-6** | Referees' Google name + photo shown to the inviter (`referralsRepo.listReferees`); policy §4 "no link back to your identity" vs the `devices.owner_sub` link used by export/erase. | Policy: name the referral disclosure; reword §4 to "not exposed to anyone; linked to your account only so you can export or erase it". Website repo. | S | Compliance | Next policy edit | Run 3 | OPEN |
| **R3-7** | CI is `workflow_dispatch`-only and there is no pre-commit hook → nothing scans a commit for secrets before it reaches `main`. | `.githooks/pre-commit` running `gitleaks protect --staged --config .gitleaks.toml`; `git config core.hooksPath .githooks` documented in README. Zero CI minutes. | S | Process | Now | Run 3 | OPEN |
| **R3-8** | RevenueCat webhook bearer compare (`server.js:6316-6330`) has no per-IP throttle and `/health` reports only presence. | `consumeTokenAttempt` on the compare; add `REVENUECAT_WEBHOOK_TOKEN` to the `secrets` strength block in `/health`. | S | Code — backend | Next backend PR | Run 3 | OPEN |
| **R3-9** | `backend/scripts/upsert-personal-care-barcodes.js` has no guard; `import-flyer.mjs` takes `--token` on argv; `ADMIN_TOKEN` / `FLYER_ADMIN_TOKEN` / `REVIEWER_ACCESS_CODE` missing from `backend/.env.example`. | Add the `PRODUCTION_PROJECT_REF` refusal + `--write` flag; read the token from env only; document the three secrets with their generation recipe. | S | Ops | Next time either script runs | Run 3 | OPEN |
| **R3-10** | `babel.config.js:14` keeps `console.warn` in release builds (138/143 statements); `priceService.js:132` logs a product name; `App.js:171` logs the whole error + component stack. | `exclude: ["error"]` only; drop the name from the log line; error boundary → `reportCrash` only. | S | Code — mobile | Next mobile PR | Run 3 | OPEN |
| **R3-11** | `BarcodeScanScreen.js:71,84` interpolate the scanned string into Open Food Facts / UPCitemdb URLs unencoded; neither party is in the policy. | `encodeURIComponent(code)`; add both to the policy's third-party table (they receive a barcode only). | S | Code — mobile + compliance | Next mobile PR | Run 3 | OPEN |
| **R3-12** | Sentry (`bootService.js:41-47`), RevenueCat (`:61-73`) and the analytics buffer start before any consent screen. | Defer `initSentry` and the analytics flush until after onboarding's consent step, with crash reporting on-by-default-with-opt-out as the policy already states. RevenueCat stays (needed to render the paywall). | M | Code — mobile / compliance | Next onboarding change | Run 3 | OPEN |
| **R3-13** | No CAA record on `priceback.ca`. | Add `0 issue` records for the CAs actually issuing (Cloudflare's — `pki.goog`, `digicert.com`, `sectigo.com`, `letsencrypt.org` — check the current cert first). | S | Operator (DNS) | With R3-1 | Run 3 | OPEN |
| **R3-14** | Live private keys unencrypted on the dev machine: Firebase admin SDK JSON in `C:\Workspace\`, `sa.json`, the upload keystore, `keys/private-key.pem`. All gitignored. | Move them into an encrypted vault (password manager attachment or a BitLocker-only folder); delete the Firebase admin JSON once confirmed unneeded. | S | Operator | Now | Run 3 (absorbs run-2 ops #2) | OPEN |
| **R3-15** | Admin-secret strength **unverified** (`FLYER_ADMIN_TOKEN`, `ADMIN_TOKEN`, `REVIEWER_ACCESS_CODE`, `REVENUECAT_WEBHOOK_TOKEN`). Decides L-1's severity. | `curl "https://priceback-production.up.railway.app/health?token=$FLYER_ADMIN_TOKEN" \| jq .secrets` — anything but `ok` → rotate to 32+ random chars; set a distinct `ADMIN_TOKEN` so `sharedWithFlyerImport` is false. | S | Operator | **First** | Run 3 | OPEN |

---

## Operator items carried from earlier registers

| Id | Item | Concrete step | Effort | Trigger | Source | Status |
|---|---|---|---|---|---|---|
| **OPS-1** | Cloudflare R2 secret key committed at `4b41643` (removed `b6c9b11`, 2026-08-04) — still readable in history. Maxim recalls rotating it; `SecurityRecommendations.md`, `Security_Audit_2026-08-04.md`, `PUBLISH_CHECKLIST.md`, `Task_Log.md` still say it is owed. | Cloudflare → R2 → API tokens: confirm the old token is gone, then correct the four documents in one commit. If it is not gone: rotate, update `R2_*` on Railway. | S | **First** | 2026-08-04, run 2 | OPEN |
| **OPS-2** | Backend connects as the `postgres` superuser role. | Create `priceback_app` with USAGE on `priceback` + DML on its tables + USAGE on sequences; point `DATABASE_URL` at it on dev first, then prod. Bounds any future SQLi/RCE. | M | Next DB maintenance window | Run 2 | OPEN |
| **OPS-3** | OTA code-signing private key must be in the EAS production environment before any `eas update` to `production` (every store binary since 2.8.5 embeds the certificate and silently refuses unsigned updates). | `eas env:create --environment production --type file --name EXPO_UPDATES_PRIVATE_KEY …` per `certs/README.md`; then `npm run ota:preflight`. Note: OTA on the free plan is blocked by the Enterprise requirement anyway — see memory `ota-code-signing-needs-enterprise`. | S | Before the first OTA | Rec §8 | OPEN |
| **OPS-4** | Older rotations: Google Vision key (2026-06-02 item); confirm `priceback-receipts` bucket has no public-read policy. | Rotate the Vision key in GCP, update Railway. Cloudflare → R2 → bucket settings → public access must be off. | S | With OPS-1 | 2026-06-02 | OPEN (status as last recorded) |
| **OPS-5** | MFA on every operator account that can change what users run: GitHub, Expo/EAS, Apple Developer, Google Play Console, Supabase, Railway, Cloudflare, GCP, RevenueCat, Sentry, Zoho. | Enable and record the recovery codes in the vault from R3-14. | S | Now | Run 3 | OPEN |
| **OPS-6** | Confirm the production Supabase plan's backup retention / PITR before real data exists. | Supabase dashboard → Database → Backups. If daily-only, decide whether a paid tier's PITR is worth it at launch. | S | Now | Run 3 | OPEN |
| **REC-3** | No schema validation on request bodies (`zod` is a dependency, unused). | Per-route schemas, starting with `/api/ocr`, `/api/receipts`, `/api/watch`, `/api/flyer/import`. | M | When a route's manual checks get complex enough to get wrong | Rec §3 | OPEN |
| **COMP-1** | Store privacy declarations vs the binary: the iOS privacy manifest, Play Data Safety, the paywall claims and RC offerings declare facts twice with nothing syncing them (memory `store-config-vs-binary-drift`). | A checklist diff before every store submission: manifest ↔ SDK list ↔ policy §3 ↔ Data Safety form. | M | Every submission | Memory | OPEN |

---

## Closed at creation (so the next audit does not re-open them)

| Id | What | Closed by |
|---|---|---|
| Run 1 H1, H2, H3, M1–M6, M8, M9, M11, M12 | Gmail egress, CI token scope, scanner integrity, consent IP, secret strength report, presign cap, `npm ci`, gitleaks allowlist, Veryfi gate, deletion comment, twelve unthrottled routes, two size caps | PR #338 |
| `form-data`, `undici`, `drizzle-orm` advisories; CI audit gate at `high` | | PRs #339, #340 |
| iOS Pass 6 L2 (resold phone erases previous owner's data) | | PR #341 |
| Run 2 H-1, H-2, H-3, D-1 | Device-row read bound, device-id entropy, Postgres TLS verification, mobile dependency measurement | PR #344 — **deployed** (run 3 verified) |
| Run 1 M7, M10 | Unrecoverable — never written down | — |
