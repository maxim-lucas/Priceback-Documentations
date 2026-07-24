# Security Policy

PriceBack handles personal data (receipts, postal codes, account info)
for Canadian users. We take security seriously and we respond fast to
credible reports.

## Reporting a vulnerability

**Email:** `security@priceback.ca`

If you'd prefer to encrypt, request our PGP key in your first message
and we'll respond with one (we don't post it publicly to keep the
mailbox routing simple).

**Please include:**
- A description of the issue and its impact
- Steps to reproduce, ideally with a minimal proof of concept
- The app version (from Profile → About), backend version (from `/health`),
  device + OS, and rough date/time of discovery
- Whether you have already disclosed this elsewhere

**Please don't:**
- Disclose publicly before we've had a chance to fix
- Pivot to other users' accounts or data once you've confirmed a bug
- Run automated scanners against production at rates that look like a
  DoS (we have rate limits that may flag you)

## What to expect from us

| Stage | Target |
|---|---|
| **Acknowledgement** | Within 48 hours |
| **Initial triage + severity rating** | Within 5 business days |
| **Fix in production** | 7 days for critical, 30 days for high, 90 days for medium / low |
| **Coordinated disclosure** | 90 days after fix lands, or earlier by mutual agreement |
| **Credit in the changelog** (if you'd like) | Yes, on request |

We do not currently run a paid bug-bounty program. We may send merch
or a thank-you gift for impactful reports.

## In scope

- **PriceBack mobile app** (iOS + Android) — bundle ID `com.priceback`
- **Backend API** at `https://priceback-production.up.railway.app`
- **Flyer ingestion pipeline** including `/api/flyer/import` (admin-gated)
- **Authentication paths** — Google Sign-In, Apple Sign-In, token storage,
  session handling
- **Data-rights endpoints** — `/api/me/data-export`, `/api/me/account`
  (DELETE), `/api/me/observations` (DELETE)
- **Crowdsourced pricing pool** — privacy / integrity of the
  warehousePrices.json data
- **Push notification delivery** — CASL marketing-consent gate
- **Sentry data flow** — PII scrubber bypass attempts

## Out of scope

- **Reports of missing security headers without an exploitable scenario**
  (Strict-Transport-Security, etc. — we know, Railway terminates TLS).
- **Self-XSS** that requires the user to paste attacker-supplied code
  into their own console / browser tools.
- **DoS / volumetric attacks** against `/api/check-price` or any other
  endpoint — we have per-IP rate limits; testing them at scale is not
  in scope and may get your IP banned.
- **Vulnerabilities in third-party services** (Google Cloud Vision,
  Railway, Sentry, RevenueCat) — please report those to the upstream
  vendor.
- **Social engineering** against PriceBack staff, customers, or
  partners.
- **Decompilation revealing public configuration** (`googleClientId`,
  `eas.projectId`, `priceApiUrl`, etc.) — these are designed to ship.
- **Theoretical issues without proof of concept**.

## Safe harbour

If you make a good-faith effort to comply with this policy when
researching and disclosing vulnerabilities, PriceBack will not pursue
or support legal action against you. We consider activities conducted
consistently with this policy to be authorized.

## Privacy

This is separate from privacy-rights requests (data access / deletion /
correction). Those go to `privacy@priceback.ca` — see
the [Privacy Policy](https://priceback.ca/privacy-policy) §13 (source in
the `Priceback-Website` repo).
