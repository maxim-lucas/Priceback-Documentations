# Provisioning the Sign in with Apple revocation key

**Status as of 2026-08-26: configured on production.** A new Sign in with
Apple key was created in the Apple Developer portal and the three env vars
below were set on the `priceback-production` Railway service.
`GET /health` on production confirms `checks.appleAuth.status: "configured"`.

**`priceback-development` still reads `"degraded"`** — the same three vars
have not been set on that service. Set them there too if the dev backend
needs to exercise account-deletion revocation (e.g. for testing before a
release); it's not required for App Store compliance, since only the
production backend is what a reviewer's build talks to.

Do not confuse this with the APNs Push Key ("PushKey.p8" in EAS credentials)
— that one is for push notifications and is already configured. This is a
**separate** key, from a different section of the Apple Developer portal.

## What's needed

Three environment variables, read by `backend/lib/appleRevoke.js`
(`appleSigninConfig()`):

- `APPLE_SIGNIN_KEY_ID` — the Key ID of a new Sign in with Apple key.
- `APPLE_SIGNIN_PRIVATE_KEY` — the PEM contents of that key's `.p8` file.
- `APPLE_TEAM_ID` — `5D2TR5UWGM` (Prosoft Inc, already known — same team ID
  used for EAS/App Store Connect credentials).

`APPLE_BUNDLE_ID` is also read but already defaults to `com.priceback`, so it
does not need to be set explicitly unless that ever changes.

All three of `APPLE_SIGNIN_KEY_ID`, `APPLE_TEAM_ID`, and
`APPLE_SIGNIN_PRIVATE_KEY` must be present or the module reports
`unconfigured` and account deletion silently skips the Apple revoke call
(deliberate — deletion must never block on a missing key, but the gap is
loud in logs and in `/health`).

## Steps

1. **Apple Developer portal** → Certificates, Identifiers & Profiles → Keys →
   `+` to register a new key.
   - Name it something identifiable, e.g. `PriceBack Sign in with Apple`.
   - Enable the **Sign in with Apple** capability on the key, and configure
     it against the `com.priceback` primary App ID.
   - Download the `.p8` file **immediately** — Apple only allows the download
     once, same constraint as the APNs key.
   - Note the **Key ID** shown on the confirmation page (10-character
     alphanumeric, e.g. `ABCD123456`).

2. **Get the PEM contents** — open the downloaded `.p8` file in a text
   editor. It's already PEM-formatted:
   ```
   -----BEGIN PRIVATE KEY-----
   ...base64...
   -----END PRIVATE KEY-----
   ```

3. **Set the Railway env vars** on **both** backend services (production and
   priceback-development, matching how `SESSION_TOKEN_SECRET` was set):
   - `APPLE_SIGNIN_KEY_ID` = the Key ID from step 1.
   - `APPLE_TEAM_ID` = `5D2TR5UWGM`.
   - `APPLE_SIGNIN_PRIVATE_KEY` = the PEM contents from step 2. Railway's env
     var editor accepts literal newlines directly — paste the PEM as-is, do
     **not** manually escape newlines to `\n` (the code un-escapes `\n` →
     newline defensively, but a raw multi-line paste works too and is less
     error-prone).

4. **Verify** — after Railway redeploys, hit `/health` and confirm
   `checks.appleAuth.status` moves from `"degraded"` to `"configured"` (see
   `backend/server.js` for the exact health-check wiring). Do this on both
   the production and preview/dev environments if both were updated.

5. **No app rebuild needed.** This is a server-side-only change — the key
   never reaches the client. Nothing in `app.json` or the mobile bundle
   changes, so it does not require a new EAS build or store submission on
   its own; it just needs to land before Apple's reviewer tests account
   deletion on the v2.8.7 (or later) build already in review.

## Why this can't be skipped silently

`backend/lib/appleRevoke.js` explains the design rationale in its header
comment: an unconfigured deployment is a compliance gap, not a soft failure,
so it's surfaced loudly (logged, and reflected in `/health`) rather than
silently no-op'd. Once configured, account deletion exchanges a fresh
authorization code (collected from the client at the moment of deletion) for
an Apple token and revokes it — nothing long-lived is stored.
