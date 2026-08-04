# Security Recommendations — Deferred Hardening

These are technical hardening items intentionally **not** changed, to keep launch
risk low. None are launch blockers; each has a concrete fix for when it's worth
doing. Items that *were* fixed are listed at the bottom for reference.

Originally written for the pre-publication pass (2026-06-02); every item below
was **re-examined in the 2026-08-04 audit** and deliberately re-deferred. See
`Security_Audit_2026-08-04.md` for that audit's findings and what it fixed.

---

## Risk register — reviewed 2026-08-04

One-line status for everything knowingly carried. Detail follows in the numbered
sections; the three items added by the 2026-08-04 audit are marked **NEW**.

| Risk | Severity | Status | Trigger to revisit |
|---|---|---|---|
| R2 credential leaked in git history | High | **Rotation owed** — scrubbed from the tree, purge queued | Immediately; the token is valid until revoked in Cloudflare |
| CORS `origin: "*"` (§1) | Low | Accepted | The day any browser-based client calls the API |
| DB TLS unverified (§2) | Low | Accepted | Next time there's a staging deploy to validate against |
| No Zod request validation (§3) | Low | Accepted | When a route's manual checks get complex enough to get wrong |
| In-memory, device-keyed rate limits (§4) | Medium | Accepted | The moment the backend scales past one instance |
| RevenueCat webhook has no HMAC check (§5) | Low | Accepted | If the shared token is ever suspected leaked |
| `drizzle-orm` <0.45.2 advisory (§6) | High (not exploitable) | Accepted | A deliberate dependency-bump pass |
| `npm audit` CI gate at `critical` not `high` (§7) | Low | **NEW** — accepted | Once the 3 triaged highs clear |
| OTA channel exposure after signing (§8) | Medium | **NEW** — mitigation shipped, ops step owed | Before production gets a `channel` |
| `allowBackup="true"` copies receipts to cloud backup (§9) | Low | **NEW** — accepted | If receipt contents ever become more sensitive |

---

## 1. Tighten CORS from `origin: "*"` to an allowlist

**Where:** `backend/server.js` — `app.use(cors({ origin: "*" }))`
**Status:** Deferred by decision (2026-06-02).

The only client today is the native mobile app, which authenticates with Bearer
tokens (no cookies, no browser same-origin context), so wide-open CORS is
low-risk: there are no ambient credentials for a malicious web origin to ride
on. It still looks weak in a review and would matter the moment a browser-based
client (web dashboard, marketing site calling the API) is added.

**Fix when needed** — allow no-Origin requests (native apps send none) plus an
explicit web allowlist, and keep credentials off:

```js
const ALLOWED_ORIGINS = new Set([
  "https://priceback.ca",
  "https://app.priceback.ca",
]);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)),
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-token"],
}));
```

---

## 2. Database TLS: move from `rejectUnauthorized: false` to full verification

**Where:** `backend/db/client.js` — `ssl: { rejectUnauthorized: false }`
**Status:** Deferred (risk of breaking the prod connection right before launch).

The connection is still encrypted, but the server certificate isn't verified,
which leaves a theoretical MITM window on the DB link. Both providers support
full verification (production = **Supabase**; tests/dev = Neon).

**Fix:** pin the provider's CA and use `verify-full` — for production pin
**Supabase's** CA (download from the Supabase dashboard → Database → SSL
configuration). Validate against the production connection in a staging deploy
before flipping it:

```js
const fs = require("fs");
_pool = new Pool({
  connectionString: normalizeConnectionString(rawConnectionString),
  ssl: { rejectUnauthorized: true, ca: fs.readFileSync(process.env.PGSSLROOTCERT) },
  // ...
});
```

(Both Supabase and Neon also accept `sslmode=verify-full` in the connection string
with the system CA store on most platforms — test which path your host supports.)

---

## 3. Adopt Zod for request-body validation

**Where:** route handlers throughout `backend/server.js`
**Status:** Deferred (broad change; current manual checks are adequate).

`zod` is already a dependency but unused. Validation today is scattered manual
checks (`if (!storeId) ...`). Per-route Zod schemas would make validation
consistent, self-documenting, and harder to get wrong as routes evolve. Roll it
out incrementally, starting with the highest-risk bodies (`/api/ocr`,
`/api/receipts`, `/api/flyer/import`).

---

## 4. Distributed / device-bound rate limiting

**Where:** OCR (`/api/ocr`, `/api/ocr-llm`), `/api/check-price`, `/api/flyer/import`
**Status:** Deferred (single-instance deployment makes in-memory limits fine).

Two known limitations of the current limiters:

- **`deviceId` is client-supplied**, so an attacker can mint fresh per-device
  quota at will. The hard backstop is the project-wide Vision/Gemini budget
  ceilings (already enforced server-side), so the *bill* is bounded — but a
  single abuser can still burn the shared budget faster.
- **Limits are in-memory per process.** If the backend ever scales to more than
  one instance, each instance keeps its own counters, multiplying effective
  limits.

**Fix when scaling out:** move counters to a shared store (Redis/Postgres) and,
for OCR, consider platform attestation (Play Integrity / App Attest) or
requiring auth so quota is bound to a verified identity rather than a
client-chosen string.

---

## 5. RevenueCat webhook — add HMAC signature verification

**Where:** `backend/server.js` — `/api/revenuecat/webhook`
**Status:** Deferred (already bearer-token gated, constant-time compared).

The webhook is authenticated by a shared `REVENUECAT_WEBHOOK_TOKEN` in the
`Authorization` header, compared constant-time — that's solid. As defense in
depth, RevenueCat can also sign payloads; verifying the signature would protect
against a leaked token being replayed.

---

## 6. Dependency advisories (`npm audit`)

**Status:** Re-reviewed 2026-07-16 — none exploitable in current usage; each
would need a code path we don't exercise. `npm audit fix` (non-`--force`) does
NOT resolve any of them — every remaining fix requires a major bump — so none
were auto-applied. Revisit on a deliberate dependency-bump pass.

**Backend (production deps) — 3 high, 8 moderate:**
- **`drizzle-orm` < 0.45.2 — SQL injection via SQL *identifiers*
  (GHSA-gpj5-g38j-94v9, high).** Not exploitable: all table/column identifiers
  in `backend/repos/*` are static schema references; only *values* flow from
  user input and those are parameterized. Upgrade is breaking — schedule it.
- **`undici` — TLS certificate-validation bypass via SOCKS5 `ProxyAgent`
  (high).** Not reachable: we never construct a SOCKS5 `ProxyAgent`. Transitive
  under the Google Cloud SDK.
- **`form-data` — CRLF injection via unescaped multipart field names (high).**
  Not reachable: `form-data` is only used inside the Google Cloud Storage SDK's
  own upload machinery with library-controlled field names; no user input names
  a multipart field in our code.
- **`qs` — remotely-triggerable DoS on `qs.stringify` with null/undefined in
  comma-format arrays (moderate, via `express`).** Our routes parse JSON bodies
  and simple query strings; we don't call `qs.stringify` with comma-format
  arrays on attacker input.
- **`uuid` (v3/v5/v6 buffer bounds), `node-cron`, `gaxios`, `teeny-request`,
  `retry-request`, `@google-cloud/storage` (moderate).** All transitive under
  the Google Cloud SDK / node-cron; the vulnerable code paths (buffer-arg uuid
  generation, etc.) aren't invoked by our usage.

**Mobile — 1 critical (`shell-quote`), 1 high (`ws`), plus moderates.** All are
**dev/build-tooling** transitives under `metro` / `react-native` /
`react-devtools` — they never ship in the release bundle and run only on the
build host. No runtime exposure in the installed app.

Re-run `npm audit --omit=dev` after any dependency change and re-evaluate.

**Re-checked 2026-08-04:** unchanged — backend production deps still report
3 high / 8 moderate / 1 low, same three highs, same reasoning. `drizzle-orm`
0.36 is installed; the fix is 0.45.2, still a breaking major.

---

## 7. `npm audit` CI gate sits at `critical`, not `high` — **NEW 2026-08-04**

**Where:** `.github/workflows/test.yml`, "npm audit — backend (gate on critical)"
**Status:** Accepted.

The gate fails only on a **critical** production-runtime advisory. The three
highs in §6 are triaged as not-exploitable, so gating at `high` would leave the
build permanently red — a red gate nobody can act on gets ignored or muted, which
is precisely the failure mode that produced Bugs_Common_Fixes #146.

**Fix when the highs clear:** change `--audit-level=critical` to `high` in the
same step. Do it *with* the §6 dependency bump, not before.

---

## 8. OTA update channel exposure — **NEW 2026-08-04**

**Where:** `app.json` `updates`, `eas.json` build profiles
**Status:** Signing shipped (PR #237); one ops step owed.

`expo-updates` runs with `CHECK_ON_LAUNCH=ALWAYS`, so every launch executes
whatever the update server returns. Before the audit there was no signature at
all: the Expo account was the only thing between an attacker and JavaScript on
every install.

Code signing is now configured — the certificate is committed and embedded by the
build; the private key is gitignored (`keys/`) and belongs in the EAS
environment. Two things remain true and need holding in mind:

- **The private key still has to reach EAS** before any update is published to a
  channel that a certificate-carrying binary listens on. Until then, publishing
  an unsigned update to such a channel silently stops those installs updating.
- **Only the `dev` profile sets a `channel`.** Production builds therefore don't
  pull updates today. That is a configuration accident, not a control — treat
  adding a production `channel` as a security-relevant change and confirm signing
  works end-to-end first.

Key rotation invalidates every binary carrying the old certificate, so it means
shipping a new store build, not just regenerating files. See `certs/README.md`.

---

## 9. `android:allowBackup="true"` — **NEW 2026-08-04**

**Where:** generated `android/app/src/main/AndroidManifest.xml`
**Status:** Accepted.

Android cloud backup copies the app's AsyncStorage — receipts, postal code,
profile — into the user's Google Drive backup. `expo-secure-store`'s generated
backup/data-extraction rules already exclude the SecureStore keys, so auth and
Gmail tokens are **not** included. iOS iCloud backup behaves equivalently.

Left on because turning it off costs users restore-on-a-new-device for their
local data, which is a real feature regression for a defence against an attacker
who already has the user's Google account.

**Fix if receipt contents ever become more sensitive:** set `allowBackup: false`
via a config plugin, or — better — keep backup on and add explicit
`<exclude domain="database" .../>` rules for the receipt store, so credentials
and receipts are excluded while preferences still restore.

---

## Already fixed in the 2026-06-02 pass (for reference)

- **Helmet security headers** added (HSTS, `nosniff`, `X-Frame-Options`,
  `X-Powered-By` removed) — `backend/server.js`.
- **Global error handler + JSON 404**; stopped returning raw `err.message` to
  clients on `/api/check-price` and the Gemini 400 path.
- **IDOR — receipt image attribution:** `markImageUploaded` is now scoped by
  `userSub` (`backend/repos/receiptsRepo.js`, route in `server.js`).
- **IDOR — device-scoped data:** `/api/me/data-export` and `DELETE
  /api/me/account` now enforce device ownership via `callerOwnsDevice`
  (trust-on-first-use).
- **Rate limit** added to `/api/flyer/import` (per-IP, before the token compare).
- **base64 validation** on `/api/ocr` before any budget spend.
- **Secret hygiene:** redacted a previously-hardcoded (already-revoked) Vision
  key from `TECHNICAL_DEBT.md`. Confirmed `.env*` is gitignored and no secrets
  are committed.
- Tests: `backend/tests/security.test.js` + `backend/tests/securityDb.test.js`.

---

## Already fixed in the 2026-08-04 audit (for reference)

Full write-up: `Security_Audit_2026-08-04.md`. Code in PR #237.

- **Live Cloudflare R2 credentials scrubbed** from `backend/.env.example`
  (on `main` from 2026-05-28 to 2026-08-04 — ten weeks). Rotation in Cloudflare is still owed — the
  scrub stops it leaking again, it does not invalidate the key.
- **gitleaks CI gate re-enabled** after two weeks muted with `if: false`, plus a
  value-shaped (never path-scoped) allowlist for the six identifier false
  positives it surfaced. Bugs_Common_Fixes #146.
- **`/api/observations/tag/image-uploaded` bound to its review's own device
  hash** — the guard checked the object key's shape but not its ownership, so any
  unauthenticated caller could enumerate sequential review ids and blank another
  contributor's tag photo, blocking verification and withholding their credit.
  Rate-limited too. Bugs_Common_Fixes #145.
- **`SYSTEM_ALERT_WINDOW` stripped from the release Android manifest** via a new
  `PERMISSIONS_TO_STRIP_FROM_MAIN` list in `plugins/withAndroidPermissionCleanup.js`
  that *deletes* rather than emitting `tools:node="remove"` — RN's debug manifest
  needs the permission for the dev overlay, and a merger directive would have
  taken it from debug builds too.
- **`/api/device/sync` + `/api/device/scan` rate-limited** — both unauthenticated
  and keyed on a client-chosen `deviceId`, so id rotation minted unbounded rows.
- **expo-updates code signing configured** (§8).
