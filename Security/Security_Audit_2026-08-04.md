# Security Audit — 2026-08-04

Full audit of the PriceBack mobile app and backend. The previous pass was
**2026-06-02**; everything shipped after it had never been security-reviewed:
the flyer scan pipeline and its admin routes, the offline tag-scan queue and the
admin OCR review flow, the credit ledger and price-drop commission paths, Gmail
sync, granular notification preferences, profile restore, and the Neon→Supabase
cutover. Play is live and an App Store submission is days away, so this was the
last cheap moment to look.

Scope: `backend/` (all 60 routes, repos, middleware, storage adapters, jobs),
`src/` (services, screens, native config), the Expo config plugins and generated
Android manifest, CI, and the tracked tree's secret hygiene.

---

## What held up

Worth recording, because it's most of the system and it means the findings below
are isolated defects rather than a pattern:

- **Auth.** Bearer ID tokens verified by issuer — Google via `OAuth2Client`
  against both the web and Android audiences, Apple via its own RS256 path
  (`lib/appleAuth.js`), with deliberately opaque 401s that don't leak which check
  rejected. `requireAuth` distinguishes a 503 misconfiguration from a 401
  rejection, and Apple tokens are exempt from the Google-config gate so an
  unrelated misconfiguration can't take iOS sign-in down.
- **Admin gating** is consistently doubled: operator routes take a constant-time
  `x-admin-token` compare with a length guard before `timingSafeEqual`; in-app
  admin routes take `requireAuth` **plus** an `ADMIN_USER_SUBS` membership check
  inside the handler. Every `/api/admin/*` route has one or the other.
- **IDOR.** Every `:id` route scopes by `req.user.sub` — either in the query
  (`softDeleteForUser`, `listForUser`) or by comparing `r.userSub` and returning
  404, not 403, so ids aren't confirmable. Device-keyed routes go through
  `callerOwnsDevice` (trust-on-first-use), which **fails closed** on a DB error.
- **SQL.** All Drizzle; every interpolation in `repos/*` is a parameterized
  `sql\`${value}\`` template. Identifiers are static schema references — which is
  also why the open `drizzle-orm` advisory isn't exploitable here.
- **Rate-limit key integrity.** `app.set("trust proxy", 1)` with a comment
  explaining that the leftmost `X-Forwarded-For` hop is attacker-controlled and
  the rightmost is not. `clientIpForRateKey` has one notion of the client IP.
- **Audit log** hashes IPs with a daily-rotating salt, so entries can't trivially
  link a user across days.
- **Mobile.** Auth and Gmail tokens in `SecureStore`; no cleartext HTTP; no
  WebView; no hardcoded keys in `src/`; a Sentry PII scrubber that redacts email,
  postal codes, push tokens and Bearer strings by pattern *and* drops known PII
  keys outright. Vision API keys never reach a production bundle — only the EAS
  `dev` profile carries one.

---

## Findings

### 1. Live Cloudflare R2 credentials committed — **High** — FIXED (rotation owed)

`backend/.env.example` carried real values for `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID` and a 64-hex `R2_SECRET_ACCESS_KEY`. Those credentials open
`priceback-receipts`, the bucket holding user receipt images and price-tag
photos. The repo is **private**, which is the only reason this wasn't critical.

**Exposure window: 2026-05-28 → 2026-08-04, about ten weeks.** Introduced in
`4b41643` ("Add Postgres persistence layer"), confirmed with
`git log --all -S <secret> -- backend/.env.example` — the file's recent commits
merely touched it without changing those lines, so reading the log by
last-modified date understates the window by three weeks.

Scrubbed to blanks (PR #237). **The file change is not the fix** — the token has
to be revoked in Cloudflare, because it remains valid, remains in git history,
and remains in any existing clone. See "Open actions".

### 2. Secret-scanning gate disabled for two weeks — **High** — FIXED

`.github/workflows/test.yml` carried `if: false` on the gitleaks step from
2026-07-23, added to mute the findings from #1, with a comment that it must be
re-enabled before publishing.

The compounding effect is the real damage: a muted scanner doesn't just miss the
leak it was muted for, it misses every leak added afterwards. Re-enabled in
PR #237.

Re-enabling surfaced 6 remaining findings, all **false positives** — five i18n
lookup keys (`streak.badge.saved50.desc`) and one AsyncStorage queue key
(`pending_receipt_scans_v1`), which trip gitleaks' `generic-api-key` rule because
they're assigned to names containing "key". Allowlisted by **value shape**, never
by path, per `.gitleaks.toml`'s own hard rule. Both patterns are anchored
end-to-end and admit only lowercase words joined by dots or underscores — no
entropy, so nothing worth stealing can be spelled that way.

Verified two ways: clean against a tracked-files-only tree mirroring the CI
checkout, and still biting when an R2-shaped secret is planted *in one of the
allowlisted files* (proving the allowlist isn't path-scoped) plus a PEM key
elsewhere → 2 findings.

### 3. `/api/observations/tag/image-uploaded` cross-review write — **Medium** — FIXED

The route is unauthenticated by design (so is the tag POST it pairs with). Its
only guard checked the object key's **shape**, not its **ownership**:

```js
new RegExp(`^tag-reviews/[a-f0-9]+/${Number(reviewId)}\\.jpg$`)
```

`[a-f0-9]+` matches any device hash, not the one the review was created with, and
`tagReviewsRepo.setImageKey` overwrites unconditionally. Review ids are
sequential integers, and the route had no rate limit, so they were trivially
enumerable.

**Impact is integrity, not disclosure.** An attacker can't upload to someone
else's key — the presigned PUT is issued for one exact key and the regex pins the
filename to the review id. What they *can* do is repoint any pending review at a
key that doesn't exist: the admin queue presigns a GET for a missing object, the
photo reads as broken, the tag can't be verified, and that contributor never
receives their credit. A cheap, unauthenticated way to suppress crowd price
verification and withhold rewards.

Fixed by binding to the review's own stored `deviceHash` (404 unknown id, 403
mismatch) and adding the per-IP limiter. Legacy rows with no stored hash fall
back to the old shape check rather than hard-failing, so an unattributable row
doesn't get its image orphaned. Recorded as Bugs_Common_Fixes **#145**.

### 4. `SYSTEM_ALERT_WINDOW` shipped in release — **Low-Medium** — FIXED

The generated `android/app/src/main/AndroidManifest.xml` declares
`android.permission.SYSTEM_ALERT_WINDOW` ("display over other apps") even though
`app.json` never requests it — the Expo prebuild template writes it into `main`,
and `main` ships in release. PriceBack draws no overlay. The permission is
tapjacking-relevant and a Play review flag.

Fixed with a **deliberately different mechanism** from the six permissions the
cleanup plugin already handles. Those use a manifest-merger `tools:node="remove"`
directive; this one is **deleted from `main` outright**, because React Native's
own `src/debug/AndroidManifest.xml` legitimately declares it for the dev overlay
and a merger directive operates on the merged result — it would risk stripping it
from debug builds too, breaking local development to fix a release-only problem.

`usesCleartextTraffic="true"` also appears in that debug manifest. That is normal
(Metro serves over HTTP) and does not ship.

### 5. `/api/device/sync` + `/api/device/scan` unthrottled — **Low** — FIXED

Both unauthenticated, both keyed on a client-chosen `deviceId`, neither
rate-limited, so rotating ids created unbounded `devices` rows. Every comparable
route (`obs-tag`, `watch`, `check-price`, `analytics`) already carried a per-IP
brake; these now do too, each with its own bucket.

### 6. expo-updates OTA was unsigned — **Risk** — FIXED (key upload owed)

`updates.url` is set with `EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS` and no
`codeSigningCertificate`, so every launch ran whatever the update server
returned. The Expo account was the only thing between an attacker and JavaScript
execution on every install — one credential, no second factor in the protocol.

Partially mitigated today by configuration accident: only the `dev` profile sets
a `channel` in `eas.json`, so production builds don't currently pull updates. That
is one line from changing, and it is not a control.

Code signing added in PR #237 — certificate committed (public, embedded by the
build), private key gitignored behind a `keys/` rule and destined for the EAS
environment. `certs/README.md` documents the trust root, the ordering rule, and
what rotation costs. **No effect on already-shipped binaries**: builds through
2.8.4 carry no certificate and behave exactly as before.

---

## Re-confirmed, deliberately unchanged

Each was re-examined this pass and left alone on purpose. Full reasoning and
concrete fixes are in `SecurityRecommendations.md`.

| Item | Why it stays |
|---|---|
| CORS `origin: "*"` | Native-only client, Bearer auth, no cookies — no ambient credentials for a hostile origin to ride |
| DB TLS `rejectUnauthorized: false` | Encrypted but unverified; flipping it risks the prod connection and needs a staging validation first |
| `drizzle-orm` <0.45.2 SQL-injection-via-identifiers (high) | Not exploitable — every identifier is a static schema reference; the fix is a breaking major bump |
| `npm audit` CI gate at `critical`, not `high` | The 3 known highs are triaged-not-exploitable; gating at `high` would sit permanently red |
| `DELETE /api/me/observations` skips ownership for anonymous callers | Deliberate — a never-signed-in user must keep their data-rights delete |
| `android:allowBackup="true"` | AsyncStorage (receipts, postal code) reaches Google cloud backup; turning it off costs users restore-on-new-device |

---

## Open actions (cannot be done from the repo)

1. **Rotate the R2 token.** Cloudflare → R2 → API Tokens: revoke the leaked one,
   create a replacement, update `R2_*` on the Railway backend. Until this
   happens the credential is live regardless of the scrub or the history purge.
2. **Upload the OTA signing private key to EAS** so `eas update` can sign. Must
   be in place before the first update is published to any channel a
   certificate-carrying binary listens on.
3. **Confirm `priceback-receipts` has no public-read policy.**
4. **Git history purge** of the leaked key — queued after PR #237 merges.
   Caveat worth stating plainly: a force-push does **not** remove the old objects
   from GitHub. They stay reachable through PR refs until GitHub runs gc, which
   normally requires a support request. Rotation, not the purge, is the
   load-bearing control.

## Verification performed

- CI on PR #237: Mobile Jest, Backend node:test, typecheck, `i18n:check`, and the
  re-enabled gitleaks gate.
- gitleaks 8.18.4 run locally against a tracked-files-only tree (`git archive
  HEAD`) to mirror the CI checkout exactly — the local working tree reports more
  findings only because it holds gitignored real files (`sa.json`,
  `google-services.json`, `keys/`, `coverage/`), none of which are committed.
- Negative test: planted secrets are still caught (see finding 2).
- **Still owed:** `aapt dump permissions <apk> | grep SYSTEM_ALERT_WINDOW` → no
  output, against a real release artifact rather than the stale local `android/`
  directory. Folds into the R8 hardware test already outstanding.
