# Security Audit — 2026-09-17 (run 3)

**Scope as requested:** a full audit of the code that is live for the 2.9.0 launch —
cybersecurity, data leaks, anything that would hurt once real users start installing —
with **Critical and High fixed now** and everything else kept in a **separate roadmap
document** for later.

**Scope as performed: `main` at `8575baf`**, six merges past the `v2.9.0` tag. Maxim's
instruction mid-session was explicit: *"there were new merges since 2.9.0, run the audit on
the latest code version."* The tag was not the target; the head was.

> **Written before any fix, and pushed on its own** — the standing rule from run 1, where
> two findings were lost because the list lived only in commit messages on an unpushed
> branch. There happen to be no fixes this time; the rule still applies.

**Previous audits:** [`Security_Audit_2026-09-14.md`](./Security_Audit_2026-09-14.md)
(run 1) and [`Security_Audit_2026-09-17.md`](./Security_Audit_2026-09-17.md) (run 2).
**The backlog now lives in one place:** [`Security_Roadmap.md`](./Security_Roadmap.md).

---

## The headline: nothing Critical or High is open, and the fixes are actually deployed

Runs 1 and 2 closed 3 High + 3 High findings between them. This run's job was to ask the
question the previous two could not: **is the shipped backend the audited one?** It is.

| Check | Result |
|---|---|
| Railway production deployment | `54f0f6e3`, status **SUCCESS**, built from commit **`8575baf`** on `main`, created 2026-09-17 19:40:31Z — three minutes after PR #344 merged |
| `/health` (public tier) | `healthy: true`, `db: ok` (latency 1.9 s), auth/appleAuth/sessions/ocr/ocrLlm/email/revenuecat all `configured` — so the verified-TLS Postgres path from run 2's H-3 is what production is connecting through |
| Transport | `strict-transport-security: max-age=31536000; includeSubDomains`, helmet's header set, plain `http://` answers **301** to `https://` |
| Error surfaces | 404 body is `{error:"not_found", …, requestId}`; the global handler returns a constant message — no stack, SQL, or path |

Run 3 found **0 Critical, 0 High, 2 Medium (one latent), 13 Low or informational.** Under the
"Critical/High now" rule there is nothing to hot-fix. Every item below is on the roadmap.

---

## Findings

Severity is this audit's own. "Kind" says who can close it.

| # | Finding | Severity | Kind |
|---|---|---|---|
| R3-1 | `priceback.ca` mail can be spoofed: DMARC `p=none` | **Medium** | Operator (DNS) |
| R3-2 | Mailbox OAuth grants outlive sign-out and account deletion; Outlook receipts are not local-only | **Medium** (latent) | Code — mobile |
| R3-3 | Opt-in receipt text goes to Gemini on the AI Studio free tier, whose terms allow training use | Low–Medium | Compliance / operator |
| R3-4 | Run 2's L-3 was wrong about dormancy: the unscrubbed `/api/analytics` sink is live | Low | Code |
| R3-5 | The DSAR export file (receipts + membership number) sits in `Documents/` forever, outside the iCloud exclusion | Low–Medium | Code — mobile |
| R3-6 | Referral list shows referees' name + photo to the inviter; policy §4 wording contradicts the device→account link | Low | Compliance |
| R3-7 | No automatic gate between a commit and `main`: CI is dispatch-only and there is no pre-commit hook | Low (process) | Process |
| R3-8 | RevenueCat webhook token: no throttle, no strength report | Low | Code — backend |
| R3-9 | Three ops-hygiene gaps in scripts and `.env.example` | Low | Ops |
| R3-10 | `console.warn` survives release builds; one line logs a product name | Low | Code — mobile |
| R3-11 | Barcode strings unencoded into two third-party URLs; those parties not in the policy | Low | Code + compliance |
| R3-12 | Sentry, RevenueCat and the analytics buffer start before any consent screen | Low | Compliance |
| R3-13 | No CAA record on `priceback.ca` | Low | DNS |
| R3-14 | Live private keys unencrypted on the developer machine, outside the repo | Low | Operator |
| R3-15 | Admin-secret strength **unverified** — and it decides whether L-1 is Low or High | Unknown | Operator (one call) |

### R3-1 — `priceback.ca` mail can be spoofed

DNS, queried live 2026-09-17:

```
priceback.ca          TXT  "v=spf1 include:spf.efwd.registrar-servers.com include:zohomail.com ~all"
_dmarc.priceback.ca   TXT  "v=DMARC1; p=none; rua=mailto:…@dmarc-reports.cloudflare.net"
zmail._domainkey…     TXT  v=DKIM1; k=rsa; p=…        (present — Zoho signs outbound mail)
```

SPF is a **softfail** (`~all`) and DMARC is **`p=none`**: receivers are told to *report*
spoofed mail, not to reject it. Anyone can send "from" `support@priceback.ca`,
`security@priceback.ca` or `privacy@priceback.ca` — the three addresses shipped in the app
(`src/constants/contact.js`), the store listings and `SECURITY.md` — and Gmail/Outlook will
deliver it, at worst to spam. That is the setup for "PriceBack support asks you to re-enter
your Costco membership number". Nothing in code; scales exactly with the user count.

**Fix (operator, ~5 minutes):** `p=quarantine; pct=100` now, `p=reject` after a week of clean
aggregate reports; SPF `-all` once Zoho and the registrar forwarder are confirmed as the only
senders. DKIM is already in place, which is what makes `p=reject` safe.

### R3-2 — mailbox OAuth grants outlive sign-out and account deletion

`src/services/emailSyncService.js:160-168` stores Gmail/Outlook access tokens, the Outlook
**refresh token**, and the connected mailbox address under SecureStore key `email_tokens_v1`.
`clearTokens()` (`:184`) is reachable only from the two Disconnect buttons
(`disconnectGmail :631`, `disconnectOutlook :901`, wired at `EmailSyncScreen.js:114`).

- `signOut()` deletes the eight auth keys at `authService.js:1003-1018` — **not**
  `email_tokens_v1`.
- Account deletion's `clearAllData()` (`storageService.js:1743-1769`) removes receipts,
  prefs, queues — **not** `email_tokens_v1` or `email_sync_v1`.

So on a shared or resold device, the next account to sign in finds the previous user's
mailbox still "Connected". Gmail content is harmless here: `isGmailSourcedReceipt` keeps it
local-only on both egress paths. **Outlook is not gated** — `parseOutlookMessage` tags
`emailProvider: "outlook"` (`:1003`), the predicate returns false for it
(`src/utils/receiptSource.js:36`), and those receipts POST to `/api/receipts` and
`/api/watch` **under the new account's identity**. One user's purchase history lands in
another user's server-side account.

**Why latent:** Gmail sync is off at build time (`gmailSyncEnabled: false`). Outlook is
hidden unless `MICROSOFT_CLIENT_ID` is set in the EAS production environment — the
`common.js` default is the `YOUR_` placeholder that gates the card off. Whether production
sets it could not be verified this session (`eas env:list` is interactive-only).

**Fix:** call `clearTokens("gmail")` and `clearTokens("outlook")` (and remove
`email_sync_v1`) from `clearAccountScopedLocalState()` and `clearAllData()`. A re-sign-in then
has to reconnect the mailbox, which is the behaviour a user would expect.

### R3-3 — Gemini free tier

`backend/server.js:2289-2362` calls `generativelanguage.googleapis.com` with an AI Studio key
(`GEMINI_MODEL = "gemini-2.0-flash"`, the comment says "free tier, 1500 req/day"). Google's
terms for **unpaid** Gemini API use allow submitted content to be used to improve products,
including human review; the **paid** tier excludes that. The content is the receipt's OCR
text — items, prices, warehouse address (membership number is stripped client-side first).
The feature is opt-in (`ocrLlmFallback` default `false`) and the policy names an AI second
pass, but it does not say the text may be used to train a third party's models.

**Fix:** one of — enable billing on the Vision/Gemini GCP project so the key is paid-tier, or
add the sentence to the privacy policy's AI section. The first is cleaner.

### R3-4 — the analytics sink is live, not dormant

Run 2's L-3 said `reportCrash` had zero call sites, so the unscrubbed egress was inert.
`reportHandledError` (`src/services/errorSupport.js:503-534`) is the call site that was
missed: every handled error surface feeds `track()` (`analyticsService.js:299-314`, no
redaction) → the local `analytics_events_v1` buffer (`:376`) → unauthenticated
`POST /api/analytics` (`:386`). The email-sync failure path embeds up to 300 chars of the
provider's HTTP body in the error message (`emailSyncService.js:365-372`). The PII scrubber
(`PII_PATTERNS`, `:83-88`) runs for Sentry only.

**Fix:** run `scrubObjectDeep` inside `track()` so both sinks get the Sentry treatment.

### R3-5 — the DSAR export file

`StoresAndProfileScreens.js:932-933` writes
`${documentDirectory}priceback-data-export-YYYY-MM-DD.json` — the full local receipt array
including `memberId`, `rawOcr` and `headerOcr` — hands it to the share sheet, and never
deletes it. `plugins/withIosBackupExclusion.js` excludes `Documents/receipts/`,
`receipts_pending/` and `tags/`; the `Documents/` root is not excluded, so this file rides
iCloud backup indefinitely. Same family as run 2's M-7/M-8.

**Fix:** write to `cacheDirectory`, delete when the share sheet resolves.

### R3-6 — referral list and policy wording

`referralsRepo.listReferees` returns each referee's Google `name` and `picture` to the
inviter. That is a deliberate social feature, but the referee is never told. Separately,
privacy policy §4 says crowd observations carry "no link back to your identity", while
`devices.owner_sub` is precisely that link — it is what lets export and erase work. Neither
is a leak; both are sentences that would answer a Law 25 question wrongly.

### R3-7 — nothing gates a commit automatically

`.github/workflows/test.yml:47-48` is `workflow_dispatch` only (a deliberate minutes-budget
decision), and there is no `.husky`, `lefthook` or `core.hooksPath`. gitleaks therefore runs
only when a human dispatches CI. A local `gitleaks protect --staged` pre-commit costs zero
minutes and is the cheapest control in this whole document.

### R3-8 — RevenueCat webhook token

`server.js:6316-6330`: constant-time compare, fail-closed when unset — good. No per-IP
throttle on the compare and no strength report on `/health` (`rcChecks.webhook` says only
`configured`). A leaked or short token forges entitlements and credit grants.

### R3-9 — ops hygiene

- `backend/scripts/upsert-personal-care-barcodes.js` has no `DATABASE_URL` check, no
  dry-run, no production-ref refusal. Every other write script has at least one.
- `backend/scripts/import-flyer.mjs:33-37` accepts `--token <secret>` on argv (shell history,
  process list); its own header documents pointing it at production.
- `ADMIN_TOKEN`, `FLYER_ADMIN_TOKEN`, `REVIEWER_ACCESS_CODE` — the three highest-privilege
  backend secrets — do not appear in `backend/.env.example`.

### R3-10 to R3-14 — the rest

- **R3-10** `babel.config.js:14` `transform-remove-console` with `exclude: ["error","warn"]`;
  138 of 143 `console.*` in `src/` are `warn`. `priceService.js:132` logs the item name;
  `App.js:171` logs the full error object and component stack.
- **R3-11** `BarcodeScanScreen.js:71,84` interpolate the scanned string into Open Food Facts
  and UPCitemdb URLs without `encodeURIComponent`; `code128`/`code39` can carry `/`, `?`,
  `#`. Path control on a fixed third-party host only. Neither service is in the policy.
- **R3-12** `bootService.js:41-47` (Sentry) and `:61-73` (RevenueCat) run on cold start
  before onboarding; the analytics buffer has no consent gate. `sendDefaultPii: false` and a
  random install id keep the impact small.
- **R3-13** No CAA record; any public CA can issue for the domain.
- **R3-14** `C:\Workspace\priceback-905d4-firebase-adminsdk-*.json`, `sa.json` (Play
  service account, referenced by `eas.json:85`), the upload keystore and
  `keys/private-key.pem` (OTA signing) sit unencrypted on disk. All gitignored and untracked
  — verified with `git status --ignored`.

### R3-15 — the one thing this audit could not measure

`/health?token=` (`server.js:3409-3423`) compares against `FLYER_ADMIN_TOKEN` with **no
throttle** (run 2's L-1, still open), and `ADMIN_TOKEN` falls back to that same value
(`server.js:839`). If the token is 32+ random characters, L-1 is a Low. If it is short, an
unthrottled compare at network speed makes it the key to every admin route — mass purge,
credit grants, flyer import — and L-1 is a High.

I tried to read the lengths (not the values) from Railway's production variables; the
permission classifier refused the production read and I did not work around it. **Maxim can
settle this in one call** — `/health?token=…` already reports
`secrets.adminToken.strength`, `secrets.reviewerAccessCode.strength` and
`sharedWithFlyerImport` without printing a value. Anything other than `ok` → rotate to a
random 32+ char value and set a distinct `ADMIN_TOKEN`.

---

## Prior open items, re-rated on this head

| Id | Status on `8575baf` | Change |
|---|---|---|
| M-1 anonymous unbounded `DELETE /api/me/observations`, no limiter | Open (`server.js:5503-5532`) | Still Medium. Reaching it now requires the victim's device id, which H-2 made unguessable; the missing per-IP brake is one line |
| M-2 `isAdminContributor` trusts the device owner | Open (`:3620-3635`) | Medium. Note the client sends `/api/watch` **without** a Bearer (`priceService.js:578`), so dropping the fallback needs the client change first |
| M-3 no pre-handler throttle, 10 MB parse | Open (`:50`) | Medium |
| M-4 `cors({origin:"*"})` | Open (`:55`) | Medium. **New fact:** no page in the website repo calls the API from a browser, so deny-by-default breaks nothing |
| M-5 Apple tokens without `nonce` accepted | Open (`appleAuth.js:228-231`) | Medium. **New fact:** the client nonce shipped in PR #259 (2026-08-12), which is in `v2.9.0`; with no live users, enforcing now locks out nothing in a store |
| M-6 receipt `objectKey` prefix check | Open (`:8567`) | **Downgraded to Low.** The key is prefixed with the caller's own sub; R2 stores keys literally; a `..` id either fails the signature (clients normalise the path) or lands in the caller's own namespace. No cross-user read or write |
| M-7 / M-8 plaintext PII in AsyncStorage / not excluded from iCloud | Open | Medium; R3-5 is the same family |
| L-1 … L-10 | All open | L-3's premise corrected by R3-4; L-1's severity now hangs on R3-15 |
| L-C membership number retained locally | Open — deliberately (Costco rule) | Unchanged |
| Ops: R2 rotation confirmation, Firebase key on disk, least-privilege DB role | Open | Firebase key folded into R3-14 |

---

## Verified clean — the negative results

Recorded so run 4 does not spend its budget re-deriving them.

**Deployment.** Production = `main` HEAD (Railway deployment metadata, not inference).
Uptime at probe time (2 h 10 m) matches the deploy timestamp.

**Secrets.** `git ls-files` carries no credential: the only tracked `.pem`/`.crt` are the
public OTA certificate and Supabase's public root CA; `backend/test.env` holds two non-secret
knobs. The six commits since `v2.9.0` add one JWT-shaped string — the canonical
`{"sub":"1234567890","name":"John"}` example, a gitleaks negative test. `.jks`, `sa.json`,
`google-services.json`, `keys/`, both `.env` files: present on disk, all ignored, none
tracked. `.gitleaks.toml` allowlists by value shape only (four regexes, no path entries).

**Database.** Supabase security advisors on prod (`xjfrlzwonyaorwktnkpj`) and dev
(`gnedluuylimjwdmtvswl`): one WARN each, the known `touch_updated_at` search_path (L-9).
Every table lives in `priceback`; no RLS/GRANT exists and none is needed — run 2 proved no
API role holds USAGE on the schema. `db/client.js` verifies the server certificate against
the bundled root with no env flag that can disable it; a missing CA throws at pool
construction.

**Dependencies.** Backend production tree: 0 critical / 0 high / 7 moderate (all under the
dormant `@google-cloud/storage` SDK or `express→qs`). Mobile: 1 critical / 11 high,
unchanged from run 2's measurement that 12 of 13 are build-time only; `nanoid` floor pinned.

**Injection and SSRF.** No `sql.raw` takes request data (the five sites are constants or
regex-validated registry keys). No `child_process`/`eval`/`vm` on any request path. Every
outbound `fetch` is fixed-host — the closest thing to an SSRF surface is
`lib/costcoSameday.js` following a DuckDuckGo result, validated against
`sameday.costco.ca`. No multipart parser exists; uploads are presigned PUTs with size pins.
No `express.static`, no `sendFile`.

**Mobile.** No `http://` URL, no ATS exception, no cleartext flag, no network-security
override. No WebView, no HTML renderer, no JS deep-link handler (`NavigationContainer` has no
`linking`), the only native inbound handler is the crash probe gated on `referrer.host ==
packageName`. QR is deliberately absent from the scanner symbologies. All session and OAuth
tokens are in SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; only the push token and
the device fingerprint are in AsyncStorage, and neither is a bearer credential. The client
Apple nonce is generated, hashed for Apple and sent raw on `x-apple-nonce`.

**Money paths.** `/api/me/subscription/sync` reads RevenueCat server-to-server with the
secret key and never trusts the client's claim. `claimSubscriptionDevice` updates only the
caller's own row — passing someone else's device id moves *your* claim, not theirs. Referral
redemption blocks self-referral and deleted accounts; sandbox purchases never settle a
referral bonus. Top-up grants are idempotent on the RC event id.

**Logging.** The request audit log hashes IPs with a per-process-day salt, logs no bodies,
headers or tokens; `auth_outcomes.detail` is scrubbed of `Bearer` and `eyJ…` material before
insert; user subs and device ids are truncated to 8 chars wherever logged. No `console.*` in
either tree prints a token, an email address or OCR text.

**Web.** DKIM is published. The static site makes no browser API calls, so the CORS decision
is free.

---

## Operational actions — outside the repository

1. **R3-15 — read the admin-secret strength** from `/health?token=…` and rotate if not `ok`.
   This is the single measurement that changes a severity in this report.
2. **R3-1 — DMARC to `p=quarantine`**, then `p=reject`. Before users arrive.
3. **R2 rotation — still unconfirmed in writing.** Run 2 listed the four documents that still
   say it is owed. One look at Cloudflare → R2 → API tokens settles it either way.
4. **R3-3 — check the Gemini key's tier** in the GCP console.
5. **R3-14 — move the four private keys** into an encrypted store; delete the Firebase admin
   JSON from `C:\Workspace\` once it is confirmed unneeded.
6. **Verify Outlook enablement** (`eas env:list --environment production`, interactive) —
   it decides whether R3-2 is latent or live.

---

## Verification performed

| | result |
|---|---|
| Railway | `railway deployment list -e production --json` → head deployment commit `8575baf`, `SUCCESS` |
| Live backend | `/health` public tier, response headers, `http://` redirect, 404 body |
| DNS | SPF, DMARC, DKIM (`zmail`), MX, CAA on `priceback.ca` |
| Supabase | `get_advisors(security)` on both projects |
| Git | `git ls-files` credential sweep, `git status --ignored`, `git log -p v2.9.0..main` secret-pattern grep, ancestry check of PR #259 against `v2.9.0` |
| Code | Three inventory passes (backend routes/auth/scoping/input/logging/secrets/jobs; mobile storage/PII/network/telemetry/platform/deep-links/email-sync/SDKs/secrets; infra CI/scanner/deps/DB/config/scripts/OTA), then direct reads of every handler cited above |

No test suite was run — no code was changed. **No GitHub Actions run was dispatched.**
The production variable read was refused by the permission classifier and not retried.

## Method

Same shape as run 2, with one addition: the deployment check. An audit of `main` that does
not confirm `main` is what production runs is an audit of a document. Every `file:line` in
this report was read this session against `8575baf`; nothing was carried over from a summary.
