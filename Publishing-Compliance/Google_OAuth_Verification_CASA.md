# Google OAuth Verification + CASA — Gmail Sync

**Status:** not started — Gmail sync is gated off in the app until this lands.
The data-flow blocker found on 2026-08-03 is **fixed** (§4); console work can proceed.
**Owner:** Maxim
**Blocks:** the "Connect Gmail" flow on the Email Sync screen (`src/screens/EmailSyncScreen.js`).

> **Read §4 before writing the scope justification.** The submission's central claim —
> that Gmail content stays on the device — was *not* true of the code when this doc was
> first written. It is true now, and enforced by a test, but the fix constrains what the
> app may do with Gmail data going forward. Don't file §5 without reading §4 first.

---

## 1. Why this exists

PriceBack's Email Sync feature requests `https://www.googleapis.com/auth/gmail.readonly`
(`src/services/emailSyncService.js`, `GMAIL_SCOPES`). Google classifies that as a
**restricted scope** — its strictest tier, above "sensitive".

Until the OAuth consent screen for the project owning client `695135372222-*` is
verified **for that specific scope**, Google refuses the grant server-side:

```
Access blocked: Priceback has not completed the Google verification process
Error 403: access_denied
```

This is enforced by Google's authorization servers against the **client ID**. It is not
affected by the app binary, so shipping an app update can never clear it.

### Play Store approval is a different review

This is the single most common confusion, so it is worth stating plainly:

| | Google Play review | Google OAuth verification |
|---|---|---|
| Console | Play Console | Google Cloud Console → Google Auth Platform |
| Reviews | The app listing, content, policy compliance | What user data your OAuth client may touch |
| Grants | Distribution on the Play Store | The right to request sensitive/restricted scopes |
| Gmail sync | Unaffected | **This is the blocker** |

Passing one does nothing for the other. PriceBack has passed the first and not the second.

---

## 2. Scope tiers, and where we sit

| Tier | Examples | What Google requires |
|---|---|---|
| Basic | `openid`, `email`, `profile` | Nothing. Works unverified. |
| Sensitive | Calendar, Contacts | Brand + app verification, demo video, privacy policy, domain ownership |
| **Restricted** | **`gmail.readonly`**, all other Gmail API scopes, Drive full scopes | Everything above **plus an annual independent security assessment (CASA)** |

Regular sign-in in PriceBack works today because `authService.js` requests only basic
scopes. Email Sync is blocked because it adds a restricted one.

**There is no non-restricted Gmail scope that returns message bodies.** Reading a
message's content is restricted no matter which Gmail scope you pick, so there is no
"downgrade the scope" shortcut out of CASA. See §7 for the alternatives that do exist.

---

## 3. Prerequisites — get these done before submitting

The review team rejects on these routinely, and each rejection costs a full round-trip.

**Domain and branding**

- [ ] `priceback.ca` verified in Google Search Console, **under the same Google account
      that owns the Cloud project**. A different account is a rejection.
- [ ] The verified domain listed under *Authorized domains* on the consent screen.
- [ ] App name on the consent screen matches the Play listing and the website exactly.
- [ ] App logo uploaded (triggers a separate brand-verification pass — start early).
- [ ] Support email and developer contact email both set and monitored.

**Homepage**

- [ ] A real homepage at `priceback.ca` that describes what the app does.
- [ ] It links to the privacy policy from a visible location.
- [ ] It is publicly reachable, not behind a login or a coming-soon page.

**Privacy policy** (source in the `Priceback-Website` repo → `/privacy-policy`, `/privacy-fr`)

- [ ] Hosted on the same verified domain as the homepage.
- [ ] Names Gmail data explicitly — not just "your data". State what is read (message
      subjects and bodies from a fixed list of retailer domains), what is extracted
      (store, date, total, line items), where it goes, and how long it is kept.
- [ ] Carries the **Limited Use** disclosure verbatim (§4).

**Consent screen**

- [ ] Publishing status is **In production**, not *Testing*. This is the setting that
      produces the "can only be accessed by developer-approved testers" wording.
- [ ] `gmail.readonly` listed under *Data Access* with a written justification (§5).

**Code** (§4)

- [x] Gmail→backend data flow scoped: Gmail receipts are local-only, enforced by
      `receiptSyncService.syncReceiptToBackend` + `receiptSyncGmailLimitedUse.test.js`.
- [ ] Pin `EMAIL_SYNC_WINDOW_DAYS` to whatever value the filed justification states
      (default 90) — it is remote-config driven and can otherwise drift out from under
      the submission.
- [ ] Confirm the privacy policy's Gmail section matches the *local-only* story before
      filing; it was written against the old assumption.
- [ ] No longer blocking, but worth doing if the opt-in contribution arm is ever built:
      stop hardcoding `source: "ocr"` in `toApiBody` and use the existing `import` code
      in `receipt_sources`, so non-scan rows are identifiable server-side.

---

## 4. Limited Use — the rules the assessment measures you against

Google API Services User Data Policy, Limited Use section. Gmail data may be used
**only** for user-facing features, and:

- **No transfer** to third parties, except as necessary to provide or improve the
  feature, for security, to comply with law, or as part of a merger with user notice.
- **No human reading** of the data, unless the user explicitly consents for a named
  purpose, it is needed for security or legal compliance, or the data is aggregated
  and anonymized.
- **No advertising use** of any kind. No sale of the data. No use for profiling.
- **No use for training generalized AI/ML models.**

The privacy policy must state compliance in words close to:

> PriceBack's use and transfer of information received from Google APIs to any other
> app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
> including the Limited Use requirements.

### Where PriceBack currently stands — VERIFIED 2026-08-03, and it is not what we thought

The earlier draft of this section claimed Gmail content never leaves the device. **That
claim is false.** It was re-verified against the code before submitting, which is exactly
what the note here told us to do, and the trace is:

```
EmailSyncScreen.js:124   saveReceipt(receipt)          ← receipt parsed from the Gmail message
storageService.js:196    → receiptSyncService.syncReceiptToBackend(newReceipt)
receiptSyncService.js:31 → toApiBody(...)  →  POST /api/receipts
```

`saveReceipt` is **not** local-only. It writes AsyncStorage *and then* mirrors the receipt
to the backend. What `toApiBody` actually puts on the wire, for an email-sourced receipt:

| Field | Value for a Gmail receipt | Gmail-derived? |
|---|---|---|
| `items[].name` | strings pulled out of the **message body** by `parseReceiptFromEmailBody` | **yes — message content** |
| `items[].lineTotal` | prices pulled out of the message body | **yes — message content** |
| `total`, `tax` | parsed from the message body | **yes** |
| `purchaseDate` | the message's `Date` header | **yes — header** |
| `storeId` | derived from the `From` domain | **yes — header** |
| `deviceId` | device fingerprint | no |
| `rawOcr`, `headerOcr` | `null` — email receipts have no OCR text | no |
| `emailSubject`, `emailId` | **not included in `toApiBody`** — these stay on device | no |

So the raw body, the subject line, and the Gmail message ID never leave the phone — but
the **extracted item names and prices do**, and those are Gmail message content by any
reading Google will apply.

Two aggravating details:

- **It feeds the crowdsourced catalog.** Receipt items become `price_points`, which are
  pooled and served to *other* users. That is Gmail-derived data leaving the user's own
  account boundary — the hardest version of the Limited Use "no transfer" question, and
  it collides directly with any plan to bill for the curated price data.
- **The rows are mislabelled.** `toApiBody` hardcodes `source: "ocr"` for every receipt,
  so a Gmail-sourced row is indistinguishable from a camera scan server-side. There is
  currently no way to identify, exclude, or delete Gmail-derived data on the backend —
  which is itself a question CASA's data-flow section will ask, and `receipt_sources`
  already has an `import` code that would fit.

**Not a live incident:** `gmailSyncEnabled: false` in `config/profiles/common.js` means
the Connect button is gated off and no Gmail data is flowing today. This is a fix owed
*before* the gate flips — not a breach to disclose.

### Resolution — Gmail receipts are now local-only

Fixed on branch `feat/gmail-consent-anonymized-price-sharing`. The gate lives at the top
of `syncReceiptToBackend` (`src/services/receiptSyncService.js`) and returns
`{ skipped: true, gmailLocalOnly: true }` before any network call:

- **A Gmail-sourced receipt never reaches the backend.** No receipt row, no items, no
  `price_points`. It lives in AsyncStorage only.
- **Price drops still work for them.** `checkAllPriceDrops` is a client-side sweep over
  local receipts, so drop detection is unaffected. What Gmail receipts give up is the
  *server-side* sweep that drives push notifications, plus reinstall recovery and
  cross-device sync. That trade is deliberate.
- **Outlook is not affected.** Microsoft mail isn't governed by Google's policy, so the
  parsers now tag every receipt `emailProvider: "gmail" | "outlook"` and only Gmail is
  gated. A legacy receipt with no provider tag **fails closed** (treated as Gmail).
- Guarded by `__tests__/receiptSyncGmailLimitedUse.test.js` (17 tests), which asserts
  `authedFetch` is never called for a Gmail receipt.

With that in place the §5 wording — "message content is not transmitted to PriceBack
servers" — is **true as written**, and is now enforced by a test rather than by
convention.

**Still open — the opt-in contribution arm.** The intended design is that a user may
*explicitly* opt in to contributing the anonymized price (store + product + price + date,
hashed device id, no identity, revocable via `DELETE /api/me/observations`). The
preference exists (`shareEmailPrices`, default off, audit-stamped via
`emailConsentUpdatedAt`) but is **deliberately not wired to anything yet**: the crowd
ingestion path (`crowdRepo.recordObservation`, `POST /api/watch`) is Costco+SKU-shaped
and drops everything else (`server.js:2045`), and email receipts carry no SKU. Shipping a
consent toggle that silently discards the data would be worse than shipping none.
Wiring it up needs a name-based ingestion path for the other 19 retailers — its own
design pass, tracked separately.

> **Re-run this verification before each annual renewal.** It is a claim about current
> code. A future change routing Gmail content through the backend, OCR, or an LLM would
> collide with the no-training and no-transfer rules as well — and note that the original
> version of this section asserted the on-device story on the strength of a single
> function name, which is exactly how it was wrong for so long. Trace the call chain.

---

## 5. Scope justification — what to actually write

The review team wants to see that a narrower scope genuinely will not work. Draft:

> PriceBack tracks price drops on items a shopper has already bought, so they can claim
> a store's price-adjustment refund before the window closes. To do that it needs the
> purchase date, retailer, item names, and prices from the user's own order
> confirmation emails.
>
> `gmail.readonly` is the narrowest scope that returns message bodies. `gmail.metadata`
> returns only headers, which carry the retailer and the date but not the line items or
> prices — the fields the entire feature depends on. There is no Gmail scope that
> returns bodies without being restricted.
>
> Access is further narrowed at query time: the app searches only a fixed, hardcoded
> list of Canadian retailer domains, only for order/receipt/confirmation subjects, and
> only within a bounded recency window. Messages outside that filter are never fetched.
> Parsing happens on the device; message content is not transmitted to PriceBack
> servers. The app never sends, modifies, or deletes mail.

⚠️ **Do not file this paragraph as written.** The final sentence about message content
is false today — see §4. It becomes true only if the backend mirror is scoped to exclude
email-sourced receipts; otherwise this paragraph has to be rewritten to describe what
actually crosses the wire. Resolve §4 first, then fix this text to match.

The *filtering* claims are real and verified:

- **Domain list** — `STORE_EMAIL_PATTERNS` (`src/services/emailSyncService.js:40`), 20
  retailers, hardcoded, no wildcard.
- **Subject filter** — `subject:order OR subject:receipt OR subject:confirmation`.
- **Recency window** — `newer_than:{emailWindowDays}d`, default **90 days**
  (`pricingCatalogService.js:108`). Note this is **remote-config driven**
  (`EMAIL_SYNC_WINDOW_DAYS`), so it can be widened server-side without an app release.
  If it is ever widened materially, the justification on file becomes wrong — treat that
  config key as bound to this submission.
- **Volume cap** — 50 search results, of which at most 20 messages are fetched in full.

Keep all of these in sync with the filed text; if the domain list or the window changes,
the justification on file is now wrong.

---

## 6. The process, end to end

### Step 1 — Submit for verification

Google Cloud Console → **Google Auth Platform** → **Verification Center** (older UI:
APIs & Services → OAuth consent screen → *Prepare for verification*).

Set publishing status to **In production** first. Then submit with the scope
justification and the demo video.

### Step 2 — Demo video

An unlisted YouTube video. It gets rejected for omissions more than for quality, so hit
every one of these:

- [ ] Show the **OAuth client ID** on screen — e.g. the Cloud Console client detail page,
      or the consent screen URL with `client_id=` visible. Reviewers must be able to tie
      the video to the exact client.
- [ ] Start from the app itself and walk the **complete** sign-in flow.
- [ ] Show the consent screen with **every requested scope legible**.
- [ ] Show what happens *after* consent — receipts appearing in the app. Demonstrate the
      user-facing feature the data feeds, not just the grant.
- [ ] English narration or captions.
- [ ] Show the privacy policy link on the consent screen.

### Step 3 — Brand verification

Logo, app name, and domain ownership are reviewed. Days to a couple of weeks. Can run
concurrently with the rest.

### Step 4 — CASA assessment (restricted scopes only)

Once the OAuth team accepts the justification, they email a CASA requirement with a
portal link. **CASA** = Cloud Application Security Assessment, run by the
**App Defense Alliance** (moved under the Linux Foundation's Joint Development
Foundation in 2024; it is no longer administered by Google directly).

**Tiers.** Google assigns the tier — you don't choose it.

- **Tier 2** — the normal path for an app of PriceBack's size. A source-code scan plus a
  questionnaire derived from **OWASP ASVS**, validated by an authorized lab.
- **Tier 3** — full penetration test. Assigned to higher-risk or larger-user-base apps.

**Tier 2, concretely:**

1. Start in the CASA portal; pick an authorized lab (Prescient Security, TAC Security,
   Schellman, Bishop Fox, NCC Group, DEKRA and others are on the list — availability and
   pricing vary, so quote more than one).
2. Run the required **static scan** over the source. Both the mobile app and the backend
   are in scope, since the backend is part of the system handling user data.
3. Complete the **ASVS-based questionnaire**: authn, session handling, access control,
   crypto and data-at-rest, error handling and logging, dependency management, secrets
   management, transport security.
4. Submit evidence and remediate findings. This is the step that actually takes time —
   budget for a remediation round.
5. The lab issues a **Letter of Validation (LOV)**.
6. The LOV goes to Google; verification is granted and the block clears.

**Cost and timeline.** Tier 2 has historically run in the low hundreds of USD through
the self-scan path, with assessor-led engagements costing meaningfully more; Tier 3
pentests are several thousand. Both the pricing and the portal have changed more than
once since the ADA transition — **get a current quote, don't budget off this paragraph.**
Plan on **4–8 weeks** end to end for Tier 2, longer if remediation surfaces real work.

**Annual renewal.** The LOV expires after ~12 months. Verification lapses if it is not
renewed, and a lapse re-blocks the scope for every user. Put the renewal date in
`Operations/Task_Log.md` the day the LOV is issued.

### Step 5 — Flip the gate

Once verification is granted:

1. Set `gmailSyncEnabled: true` in `config/profiles/common.js`.
2. Ship a build.
3. Verify with a Google account that is **not** on the test-user list — that is the only
   account type that proves the block is actually gone.

---

## 7. Interim options

**Test users — immediate, no review.** Google Auth Platform → *Audience* → *Test users*.
Up to 100 accounts, and they bypass the block entirely even while the consent screen is
in Testing. This is how to exercise the flow during development. It does nothing for
real users.

**The gate — shipped.** Gmail's card shows "Coming soon" with "Finishing the security
review Google requires" instead of a Connect button that can only fail. Accounts already
connected keep working; the gate only blocks new grants.

**Alternatives that avoid restricted scopes**, if CASA turns out not to be worth it:

- **Forward-to-import** — the user forwards receipt emails to a PriceBack address, and
  the backend parses them. No Gmail API, no OAuth, no CASA. Worse UX, materially less
  work, and it moves receipt content onto our servers, which changes the privacy story.
- **Share-sheet import** — the user shares an email into PriceBack from their mail app.
  Fully manual, zero review burden.
- **Lean on receipt scanning** — already built, already the primary path, and unaffected
  by any of this.

---

## 8. Rejection reasons worth pre-empting

- Homepage and privacy policy on different domains, or on a domain not verified to the
  project owner's account.
- Privacy policy that never names Gmail or the Limited Use requirements.
- Demo video missing the client ID, or cutting off before the consent screen.
- Consent screen app name not matching the website or the Play listing.
- A scope justification that does not explain why `gmail.metadata` is insufficient.
- Requesting more scopes than the demo video shows being used.
- Publishing status left on *Testing* at submission.

---

## Related

- `Publishing-Compliance/PUBLISH_CHECKLIST.md`
- `Publishing-Compliance/Play_Data_Safety_Answers.md` — the Gmail answers there must stay
  consistent with whatever is filed here
- `Security/` — the security posture the CASA questionnaire will ask about
- App code: `src/services/emailSyncService.js`, `src/screens/EmailSyncScreen.js`,
  `config/profiles/common.js` (`gmailSyncEnabled`)
