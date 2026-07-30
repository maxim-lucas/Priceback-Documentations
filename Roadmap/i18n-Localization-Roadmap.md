# Localization (i18n) roadmap

**Status:** app-facing French coverage complete as of 2026-07-29. This document
records what was fixed, what is deliberately left in English, and what still
needs work — mostly on the backend side.

Languages shipped: **English (`en`)** and **French (`fr`)**. Bundle:
`src/services/i18n.js` (1334 keys per language, enforced in parity).

---

## 1. The standing rule

Written into the app repo's `CLAUDE.md` so it applies to every contributor and
every agent on the project:

> **No feature is deliverable until every language the app supports has every
> label that feature needs.** A feature with base-language-only labels is
> incomplete, not "done pending translation".

Two points are deliberate and were called out explicitly by the product owner:

* **The rule is written against the supported *set*, not against French.** The
  supported set is whatever `translations` in `src/services/i18n.js` defines
  (today `en` + `fr`). When a third language is added, every existing key must
  be filled for it, and from then on no new feature ships without it. Nothing
  in the app or the tooling hardcodes a language list — `getSupportedLanguages()`
  / `isSupportedLanguage()` derive it from the bundle, `getLocale()` maps it via
  a `LOCALES` table, and the checker discovers language blocks by parsing the
  bundle. Adding a language is: add its block, add its BCP 47 code, fill every
  key.
* **Fallback is always English, never blank.** `t()` resolves active language →
  English (`BASE_LANG`) → the key itself. Every helper that overlays
  translations onto other data ends its chain in readable English too. Returning
  `""` / `null` / `undefined` so a label silently disappears is treated as a
  bug: a user seeing English is a minor defect, a user seeing an empty button is
  a broken screen.

`npm run i18n:check` (`scripts/checkI18n.js`) enforces the mechanical half. It
**derives the language list from the bundle**, so a newly added language comes
under enforcement automatically with no checker changes:

1. **Key parity** — every language must define exactly the same key set as the
   base language. This matters because `t()` silently falls back to English on a
   missing key, so drift shows up only as English leaking into a translated UI.
2. **No empty values** — a key defined as `""` would render a blank label.
3. **No undefined keys** — every `t("literal")` in `src/` must exist in the base
   language, so a typo can't render the raw key on screen.
4. **Base completeness** — the base language is what everything else falls back
   to, so it must be populated for every key.

Verified behaviour: adding a stub third language with 3 keys makes the checker
fail with 1334 problems, one per missing key, and name the language in the
failure message.

The fallback contract itself is pinned by tests in `__tests__/i18n.test.js`
("fallback is always English, never empty") so a future refactor of `t()` can't
quietly reintroduce blank labels.

**Action:** wire `npm run i18n:check` into the CI workflow alongside
`typecheck`. Not yet done — `.github/workflows/test.yml` is mid-rewrite on a
dirty working tree, so the hook wasn't added to avoid conflicting with that
change.

---

## 2. What was fixed (2026-07-29)

### Reported by the user

| Symptom | Cause | Fix |
|---|---|---|
| "Buy Credits" / "Manage" buttons in English | Hardcoded JSX in `ProfileKit.js` | `profile.cardBuyCredits`, `profile.cardManage` |
| "MEMBER" on the membership card | Hardcoded | `profile.cardMemberTag` |
| "Never expires" pill | Hardcoded | Reused `buyCredits.neverExpiresLine` |
| "Unlimited" / "credits" on the card | Hardcoded | `profile.balanceUnlimited`, `profile.balanceUnit(One)` — now singular-aware |
| Subscription plan names in English | `TIERS[].name` is catalog data | Catalog overlay (§3) |
| Credit history showing `price_tag_scan`-style codes | `ledgerLabel()` fell back to the raw code | Codes now always resolve to a translated label |

### Credit ledger specifically

* `ledgerLabel()` **never** returns a raw code. An unrecognised type resolves to
  the generic translated label plus a `__DEV__` warning naming the missing key.
* Added the missing `reconcile_adjust` type (`credits.type.reconcile`), the last
  code in `backend/db/seed.js`'s `CREDIT_EVENT_TYPES` that had no mapping.
* Added `ledgerNote()`. The backend writes **free-form English notes** on ledger
  rows (`"offline scan"`, `"credit pack purchase"`, …) and both the Credit
  History screen and Plan & Credits rendered them verbatim. They are now mapped
  to translated labels. An unrecognised note falls back to the backend's own
  English text, capitalised — per the fallback rule, English beats a blank row.
  Only a genuinely absent note renders nothing.

### Newly localized surfaces

* **Onboarding "Finish setting up"** — the entire screen was untranslated:
  country/postal/province fields, consent rows (split into prefix + link so the
  sentence and link text translate independently), the CTA and footnote.
* **Postal-code validation errors** — were hardcoded English returns in
  `storageService.postalErrorMessage()`.
* **PDF savings report** (`exportService.js`) — headings, table columns, claim
  counts, footer, share-sheet title.
* **Android notification channels** and the test/reminder notifications.
* **Receipt snapshot** (`ReceiptSnapshot.js`) — the card shown at the Costco
  returns counter: ITEMS / Subtotal / Tax / TOTAL / store number.
* Camera overlay hints, `ZoomableImage`, `LIVE`/`AUTO` badges, Home "View ›",
  scan validation ("Total can't be less than subtotal"), "New item".
* **Restore-purchases failures** — `purchaseService` returned English `message`
  strings that the paywall rendered *instead of* the translated fallback. It now
  returns `reason` codes; the UI picks translated copy and the English `message`
  is diagnostic-only.

---

## 3. Labels that come from the database

This was the subtlest class of bug: text that is **data**, not display copy.

### Pricing catalog — solved

Subscription tiers and credit packs come from `shared/pricing.config.js` or,
when available, the DB-authoritative `GET /api/v1/pricing.json`
(`subscription_tiers` + `credit_packs`). Their `name` / `description` /
`bestFor` / `highlight` / `priceNote` / `features` fields are English.

`src/services/catalogLabels.js` resolves each field in three steps:

1. **A localized field on the payload** (`nameFr` / `name_fr`) — so the backend
   can start serving translations later and have them take effect with **no app
   release**.
2. **A bundled translation keyed by the stable SKU id** —
   `catalog.tier.unlimited.name`, `catalog.pack.priceback_pack_pro.description`,
   … This covers every SKU shipping today.
3. **The English catalog string** — last-resort fallback so a brand-new SKU
   pushed from the DB still renders, with a `__DEV__` warning.

Pack display names (`Starter` / `Pro` / `Max`) are intentionally identical in
both languages: they are the product names shown on the App Store and Google
Play listings, and a mismatch between the in-app name and the store receipt
would be worse than leaving them untranslated. The tier name **is** translated
(`Unlimited` → `Illimité`) because it's a plain adjective, not a brand.

**Action (backend, medium priority):** add `name_fr` / `description_fr` /
`best_for_fr` columns to `subscription_tiers` and `credit_packs`, and serve them
in `pricing.json`. Step 1 of the resolver already consumes them, so this needs
no app release and makes new SKUs translatable the day they ship. Until then,
every new SKU needs an app release to be translated.

### Provinces — solved, with a caveat

`CANADIAN_PROVINCES[].name` is deliberately kept in **English** because
`locationService` matches it against reverse-geocoder output, which is always
English. Display now goes through `getProvinceName(code)` /
`getLocalizedProvinces()`, backed by `province.<CODE>` keys. Do not "fix" the
English names in that array — it will break location inference.

### Still English on the backend

These never reach the UI today, but would if a new screen rendered them
naively. Any future admin/reporting surface must map codes → i18n keys rather
than displaying the DB `label` column:

* `credit_event_types.label`, `subscription_tiers.label`,
  `subscription_statuses.label`, `notification_types.label`,
  `purchase_types.label`, `policy_statuses.label`, `price_source_types.label`,
  `consent_types.label` — all seeded English in `backend/db/seed.js`.
* **Ledger `notes`** are still written as English prose by the backend
  (`creditsRepo`, `server.js`). The app maps the known ones, but any new note
  string appears untranslated-then-hidden until it's added to `LEDGER_NOTES`.

  **Action (backend, low priority but the cleanest fix):** write a stable
  `note_code` alongside (or instead of) the prose, so the client can translate
  without string matching.

* **Push notification bodies composed server-side.** Any notification text the
  backend generates is English regardless of the user's app language. The app
  does not currently send its language preference to the server.

  **Action:** persist the user's language on the profile (`users.language`) and
  have the notification builder select copy accordingly. This is the largest
  remaining gap and the most user-visible one — a French user gets English push
  notifications today.

---

## 4. Deliberately left in English

Not bugs. Documented so they aren't "fixed" by mistake.

| Surface | Why |
|---|---|
| `src/screens/Admin*.js` (4 screens: barcode feeder, tag reviews, credit audit, flyer scan) | Internal operator tooling, gated to admin accounts. Exempted explicitly in `CLAUDE.md`. Must still read as plain English, never raw codes. |
| `BrandChartScreen.js` | Internal brand/design reference sheet, not a shipped user surface. |
| `dsarService.js` — the `note` on an unreachable-backend export | The DSAR bundle is a machine-readable document consumed by regulators and import tools, and the module is deliberately dependency-free so its JSON contract can be unit-tested in isolation. Importing i18n would break both properties. |
| Store names (`constants/stores.js`), Costco warehouse names (`costcoWarehouses.js`) | Proper nouns — "Best Buy", "Home Depot", "Business Centre" are not translated in Canadian French either. |
| `BrandMark.js` "Price" / "Back", `ProfileKit` "PriceBack" | The wordmark. |
| `purchaseService` `message` fields | Now diagnostic-only; the UI reads `reason` codes instead. |
| ISO dates in the PDF table | Locale-neutral by design (`YYYY-MM-DD`), for expense/tax filing. |

---

## 5. Verification

```
npm run i18n:check   # 2 language(s) [en=1334, fr=1334], all keys in sync
npm run typecheck    # clean
npx jest             # 3087 passing
```

Test changes made alongside the code:

* `__tests__/creditLedger.test.js` — three tests asserted the *old* raw-code
  fallback (they encoded the reported bug). Rewritten to assert the new
  contract, plus new coverage for `ledgerNote()`.
* Four suites needed an AsyncStorage mock: components that now render
  translated strings import `i18n`, which imports AsyncStorage, whose native
  module throws on import under `jest-expo`. Added per-suite, matching the
  existing pattern in this repo. A **global** mock in `jest.setup.js` was tried
  first and rejected — it changed module-init behaviour in
  `scanScreenCreditGate.test.js` and broke it.
* Partial `jest.mock("../src/services/i18n", …)` factories in six suites needed
  the new `getLanguage` / `hasKey` exports.

**Pre-existing, unrelated failure:** `__tests__/ciParity.test.js` (3 tests) fails
on `main` independently of this work — it asserts against
`.github/workflows/test.yml`, which has uncommitted local changes (29
insertions / 129 deletions) from separate in-flight work.

---

## 6. Prioritized next steps

1. **Send the user's language to the backend and localize server-composed push
   notifications.** Highest user impact — French users get English pushes today.
2. **Add `*_fr` columns to `subscription_tiers` / `credit_packs`** and serve them
   in `pricing.json`. The client resolver already consumes them; unlocks
   translating new SKUs without an app release.
3. **Wire `npm run i18n:check` into CI** once the `test.yml` rewrite lands.
4. **Emit `note_code` on credit-ledger rows** instead of English prose.
5. Consider extracting the i18n bundle out of one ~3100-line JS file into
   per-locale JSON if a third language is ever added. The tooling is already
   language-agnostic, so this is an ergonomics change (smaller diffs, easier
   handoff to a translator), not a correctness one — `scripts/checkI18n.js`
   would need its parser pointed at the JSON files.
