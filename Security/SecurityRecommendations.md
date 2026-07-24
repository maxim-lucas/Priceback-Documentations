# Security Recommendations — Deferred Hardening

These are technical hardening items intentionally **not** changed in the
pre-publication security pass (2026-06-02), to keep launch risk low. None are
launch blockers; each has a concrete fix for when it's worth doing. Items that
*were* fixed in that pass are listed at the bottom for reference.

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
