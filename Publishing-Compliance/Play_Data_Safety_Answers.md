# Google Play — Data Safety form & content-rating answers (copy-paste)

Last updated: 2026-07-24 · App version 2.8.1 · Package `com.priceback`

This is a fill-in-the-blanks sheet for the two Play Console screens that most
often draw review remarks: **App content → Data safety** and **App content →
Content rating (IARC)**. Answers are derived from the real data model
(`backend/db/schema.js`) and the shipped permission set (after
`plugins/withAndroidPermissionCleanup.js`). Enter them verbatim; where a field
needs your judgement it's marked **⟨decide⟩**.

Companion: `PUBLISH_CHECKLIST.md` §10 (permissions, deletion URL) and
`REVIEWER_NOTES.md` (review-notes copy + demo account).

---

## A. Data safety — top-level answers

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS everywhere) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — URL: `https://priceback.ca/delete-account` |
| **Does your app use an advertising ID?** | **No** (the `AD_ID` permission is stripped from the manifest — see permission hygiene) |

> **Scope note — Costco membership number is deliberately NOT declared.** It is
> not a live feature: it isn't shown anywhere in the UI and isn't used by any
> user-facing function (currently only captured as a trial/test remnant). It is
> therefore out of scope for this release and excluded from the form below. ⚠️
> **To keep the declaration strictly truthful, the backend should stop extracting/
> storing `receipts.member_id` while it's undeclared** — see the reminder at the
> bottom; ping me to make that code change if you want the form to match the DB
> exactly.

> **"Collected" vs "Shared" (Google's definitions):** *Collected* = transmitted
> off the device. *Shared* = transferred to a **third party** who uses it for
> their **own** purposes. Our vendors (Google Cloud Vision, Gemini, RevenueCat,
> Sentry, Supabase, Cloudflare, Railway) are **processors acting on our behalf**
> under contract — that is **not "sharing"** per Google's policy. So every row
> below is **Collected = Yes, Shared = No.** (Do not tick "shared" for a
> service provider; that's a common source of a mismatched-declaration remark.)

---

## B. Data safety — per data type

For every row: **Collected = Yes**, **Shared = No**, **Processed ephemerally = No**
unless noted. "Required" = the user can't avoid it in normal use; "Optional" =
only if they use that feature.

### Location
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Approximate location** | Yes | App functionality | **Optional** | Coarse only (`ACCESS_COARSE_LOCATION`, `Accuracy.Low`) to pick the nearest Costco. Also the user-entered **postal code / province** (`users.postal_code`). No precise location (FINE_LOCATION stripped). |

> Do **not** declare **Precise location** — `ACCESS_FINE_LOCATION` is removed from
> the manifest. Declaring it would mismatch the APK.

### Personal info
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Name** | Yes | App functionality, Account management | Optional | From Google/Apple sign-in (`users.name`). |
| **Email address** | Yes | App functionality, Account management | **Required** | Sign-in identity (`users.email`). |
| **User IDs** | Yes | App functionality, Account management | Required | OAuth `sub` (`users.sub`) — the sign-in identifier. |

### Financial info
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Purchase history** | Yes | App functionality | Optional | Subscription / scan-credit state via RevenueCat + the credit ledger. Receipt line items (store, date, totals, item names, SKUs) are user content used to detect price drops. |

> Payment card details are handled entirely by Google Play Billing / RevenueCat —
> **we never receive or store them**, so do **not** tick "Payment info".

### Photos and videos
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Photos** | Yes | App functionality | Optional | Receipt images are sent to OCR and **not retained by us** (processed then discarded). Price-tag photos are retained up to **30 days** for admin OCR review, then auto-pruned. |

### App activity
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **App interactions** | Yes | Analytics | Optional | Product-interaction events (PII-scrubbed) for reliability/analytics. |

### App info and performance
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Crash logs** | Yes | Analytics (crash diagnostics) | Optional | Sentry; PII scrubbed before send (`sendDefaultPii:false`). |
| **Diagnostics** | Yes | Analytics | Optional | Performance/diagnostic data via Sentry. |

### Device or other IDs
| Data type | Collected | Purposes | Required/Optional | Notes |
|---|---|---|---|---|
| **Device or other IDs** | Yes | App functionality, Fraud prevention | Required | Expo **push token** (`users.push_token`) for notifications; a **hashed** device fingerprint (`devices.device_hash`) for anti-abuse. Not the advertising ID. |

---

## C. Account deletion (App content → Data deletion)

- Deletion URL: **`https://priceback.ca/delete-account`**
- In-app path exists: **Yes** — Profile → *Delete my account* (`DELETE /api/me/account`).
- What's deleted / briefly retained: documented on the URL above and mirrors the
  server behaviour (identity, receipts+items, watched items, credit balance &
  ledger, push token, crowdsourced obs + device row, processing photos deleted;
  a minimal non-profile legal/anti-fraud record — deletion timestamp, consent
  audit, settled-purchase refs — retained briefly then purged).

---

## D. Content rating (IARC questionnaire)

Category: **Utility, Productivity, Communication, or Other** (PriceBack is a
shopping/finance utility).

| Question theme | Answer |
|---|---|
| Violence / scary content | **No** |
| Sexual content / nudity | **No** |
| Profanity / crude humour | **No** |
| Controlled substances (drugs, alcohol, tobacco reference) | **No** — but see note ⟨decide⟩ below |
| Gambling (simulated or real) | **No** |
| User-generated content shared publicly | **No** — crowdsourced *prices* are aggregated numeric data, not user-to-user messaging or public profiles |
| Users can interact / share content / exchange info | **No** |
| Shares user's current physical location with other users | **No** |
| Digital purchases (in-app purchases) | **Yes** — subscriptions + credit packs |
| Data collection & sharing | Reflect the Data Safety answers above |

> **⟨decide⟩ Free-text receipt content note:** because the app OCRs receipts,
> product names from any retailer *can* contain alcohol/tobacco/medication
> terms. This is incidental text the user photographs, not app content — answering
> **No** to the substance questions is defensible and yields an **Everyone/PEGI 3
> / ESRB Everyone** rating. (Note: iOS App Store §9 of the checklist chose 12+
> for the same reason out of caution; the two stores' questionnaires differ.
> IARC "Everyone" for a receipt-scanning utility is standard.) Keep the answer
> consistent with whatever you tell Apple if you later ship iOS.

Expected result: **Everyone / PEGI 3 / ESRB Everyone / USK 0+**, with the
"in-app purchases" and "collects data" interactive-elements labels.

---

## E. Other App-content declarations (quick answers)

| Screen | Answer |
|---|---|
| **Ads** — Does your app contain ads? | **No** |
| **Target audience & content** | Age groups **13+** (sign-in is Google/Apple, 13+ by their ToS). Not "designed for children". |
| **News app** | No |
| **COVID-19 contact tracing/status** | No |
| **Government app** | No |
| **Financial features** | It handles subscriptions & in-app credits, **not** banking/lending/crypto — answer the specific sub-questions **No** (no personal loans, no crypto exchange, no debt-management). Purchases are standard Play Billing IAP. |
| **Data safety → data used for tracking across apps** | **None** |
| **App access** (for review) | Provide the demo Google account + steps — see `REVIEWER_NOTES.md`. Sign-in is required, so a working test account is mandatory or the reviewer is blocked. |

---

## F. Why this should pass review cleanly

- **Advertising ID = No** matches the shipped APK (AD_ID stripped) — no auto-flag.
- **No unjustified sensitive permissions** — RECORD_AUDIO, FINE_LOCATION and the
  broad media-read trio (READ_MEDIA_IMAGES / READ_MEDIA_VIDEO /
  READ_MEDIA_AUDIO) are removed; every remaining permission maps to a visible
  feature, so no Permissions Declaration form is triggered. Photo import uses
  the Android system photo picker, which needs no permission — this is what
  Play's photo-and-video permissions policy asks for, and what got version code
  20 flagged before the trio was stripped in version code 21.
- **Deletion URL is live and specific** — satisfies the User Data policy.
- **Data Safety matches observable behaviour** — Google cross-checks the form
  against the APK's network calls and permissions; the rows above are the actual
  data flows, and vendors are correctly classified as processors (not "sharing").
- **Sign-in resilience** — full GMS status-code handling (Bug #128) reduces the
  chance a reviewer on a flaky network hits a hard sign-in failure.
