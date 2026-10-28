# Receipt parser registry, store parsers, and the lab lane

**Status:** shipped to `main` (PR pending) — 2026-08-25
**Code:** `src/services/receiptParsers/`, `src/services/bestBuyReceiptParser.js`,
`src/services/faintPrintRepair.js`, `src/services/featureLanes.js`,
`react-native.config.js`

---

## 1. How a receipt gets parsed

> **Design rule for every store parser (2026-10-13):** `Receipt_Parser_Design_Rules.md` — denoise first (EN + FR),
> keep only the item block and the totals block, then extract and verify. Same structure, same logic for every
> receipt; special cases are image problems only (tilt, curl, quality).

> The receipt **header** (`header_ocr`) and the **production-corpus** test method (every parser problem starts by
> turning new prod receipts into paper-verified fixtures) are in `Receipt_Header_And_Prod_Corpus.md`.

```
OCR text ──► detectStore() ──► resolveStoreParser(storeId) ──► the store's parser
             (pre-parser)       (the registry)                  (or the generic engine)
```

**`detectStore`** (`receiptParsingShared.js`) is the pre-parser. It reads the
retailer out of the raw OCR by five strategies in order: vendor-name keyword,
name pattern, phone number, vendor metadata, receipt keyword. All 20 launch
stores already have patterns.

**`resolveStoreParser`** (`receiptParsers/index.js`) turns that identity into a
parser. Returns `null` when the store has none, and the caller falls back to
`parseGenericReceipt` — which is what 18 of the 20 stores get.

Before this existed the dispatch was a ternary in `receiptParser.js`. That was
correct for one store parser and unextendable for two.

### The contract

```js
parse(rawText: string, annotation: {words: [...]} | null) => result
```

`annotation` is Vision word geometry for image scans, `null` for text/PDF/pasted
input. A parser that does not use geometry ignores it.

The result carries everything `parseReceiptEngine` stamps, plus:

| field | meaning |
|---|---|
| `receiptKind` | store-meaningful format label (`warehouse`, `in_store`, `online`, `gas`, `refund`, `unreadable`) |
| `trackable` | false when nothing on the receipt can be price-watched |
| `rejected` | true when recognized and deliberately NOT extracted |

**A parser must never throw on unrecognizable text.** Return a result with no
items; the scan pipeline decides what an empty parse means.

### Adding store #3

> **Superseded by `Technical/Adding_A_New_Store.md`**, which is the complete
> procedure and the one kept current. Sport Chek shipped as store #3 on
> 2026-09-11 (lab lane) — see `Technical/SportChek/`. The four steps below
> are still true; they are four of about forty.

1. Confirm `STORE_DETECTION_PATTERNS` matches the store.
2. Write `src/services/<store>ReceiptParser.js` against the contract, reusing
   `parseReceiptEngine` and its `reshapeLines` / `handleDiscountLine` /
   `isItemNameLine` hooks rather than re-implementing item extraction.
   `isItemNameLine` (2026-10-04) is additive: it admits a store's own price-less
   item row the generic three-letter name test refuses (Costco's `KS 40X500ML`),
   never refuses one it admits. Pass a store's hooks as ONE shared object to
   every engine call (Costco: `COSTCO_WAREHOUSE_HOOKS`) — a hook missing from one
   candidate is masked by the second-pass candidates that still have it.
3. Add one line to `STORE_PARSERS` — or `LAB_STORE_PARSERS` while it is being
   built.
4. **Capture real receipts.** `npm run capture:receipts`, then a
   `.realocr.test.js` suite. The Costco parser is accurate because it was built
   against 42 real captures, not because its rules looked right on paper.

> The remote `stores` payload can enable a store in production independently.
> That is safe: it enables it with the **generic** parser, exactly as the other
> 18 behave today. Getting the dedicated parser means promoting it out of
> `LAB_STORE_PARSERS` and shipping a build.

---

## 2. The lab lane

### Why a runtime flag was not enough

PR #290 shipped AdMob "dark": `adsEnabled: false`, no banner, nothing
user-visible. The native SDK was autolinked and compiled into every binary
regardless, and it broke production builds **twice**:

| | failure |
|---|---|
| **#293** | a committed `ADS_ENABLED: "true"` in `eas.json` made the config phase refuse — every production build died 30 s in |
| **#295** | `play-services-ads:25.4.0` carries Kotlin metadata 2.3.0; Expo 55 pins Kotlin 2.1.20, which cannot read it → `compileReleaseKotlin` failed |

Both are **build** failures in a dependency the app never calls. No runtime
switch could have prevented either, because neither happened at runtime.

**The rule: unfinished work is ABSENT from the production build, not inert in
it.**

### The two halves

| half | file | effect when the lane is off |
|---|---|---|
| config plugin | `app.config.js` → `filterPluginsForLane` | drops `react-native-google-mobile-ads` and `./plugins/withAdsSdkKotlinPin` |
| autolinking | `react-native.config.js` | `platforms: {android: null, ios: null}` — the SDK is not compiled |

> ⚠️ **These must never diverge.** The config plugin is what writes
> `com.google.android.gms.ads.APPLICATION_ID` into `AndroidManifest.xml`. Strip
> the plugin while the library is still linked and Google's manifest merger
> hard-fails the Android build, with an error that names neither file.
> `__tests__/adsAutolinking.test.js` asserts they agree on every lane.

Both read `labEnabled` through `config/profiles`, and both load `.env` through
`config/dotenv.js` — extracted precisely so a local `LAB_ENABLED=true` reaches
both processes. Gradle invokes node directly for the app config and the RN CLI
loads `react-native.config.js` in its own process; neither gets `@expo/env`.

### Resolution

| where | value |
|---|---|
| `config/profiles/common.js` | `labEnabled: false` — the floor |
| `config/profiles/{local,eas}.js` | `LAB_ENABLED === "true" ? true : undefined` — opt-in only, never overrides the floor with a falsy |
| `eas.json` → `lab` profile | extends `preview`, `channel: "lab"`, `LAB_ENABLED: "true"` |
| `app.config.js` → `assertLabIsOffInProduction` | **throws** if `APP_ENV=production` resolves true. **No escape hatch** — an override would be the exact shape of the mistake the guard prevents |

Runtime read: `src/services/featureLanes.js` → `isLabEnabled()`. Reads `extra`
per call, not at module scope (`Constants.expoConfig` is not guaranteed
populated at import time, and a frozen snapshot is untestable). **Fails
closed** — anything other than a literal `true` means off.

### What rides the lane today

- **Ads** — `isAdsBuildEnabled()` requires `adsEnabled && labEnabled`, so the JS
  gate can never disagree with what the binary actually contains.

**Lane contents today (2026-10-28):** `LAB_STORE_PARSERS` / `LAB_ONLY_STORES`
hold **Sport Chek** only. Best Buy came off the lane and now ships in every build
as an **admin-preview** store (`STORE_PARSERS` + `ADMIN_PREVIEW_STORES`): admins can
scan it, shoppers see "Coming soon" — see `Technical/BestBuy/Receipt_Parser.md`.
The next store under construction goes into both lane sets, in one edit.

### Working on the lane

```bash
# local
echo "LAB_ENABLED=true" >> .env.local

# device
eas build --profile lab
```

---

## 3. Store parsers — in each store's folder

A store's parser is documented in that store's own folder, not here:

- Best Buy → `Technical/BestBuy/Receipt_Parser.md` (formats, SKU width, discount
  sub-rows, service lines, online `Web ID`, and the 2026-09-02 promotion)
- Sport Chek → `Technical/SportChek/`
- Costco → `Technical/Costco-Price-Rules.md` and the receipt-parser design rules

---

## 4. Faint-print repair

Thermal paper fades, and Vision does not fail on a half-printed glyph — it
returns its best guess, confidently shaped like text. The confusions are
systematic: `5→S`, `8→B`, `0→O/D`, `1→I/l`, `6→G`, `2→Z`, and the decimal point
drops out or reads as a comma. `59.99` arrives as `S9.99`, the line carries no
price, the item silently vanishes.

### Why guessing is safe here

A receipt **states its own answers** — subtotal, tax, total — so "is this repair
correct?" is arithmetic, not judgement.

| tier | when | rule |
|---|---|---|
| **1** | the token is not a number and cannot be a word (`S9.99`, `1O.5O`) | repaired inline. The alternative is dropping the line, so repair cannot lose information |
| **2** | the token reads as a valid number but the receipt does not add up | candidates re-parsed; adopted **only when the parse LANDS on the printed total** |

### The two rules that were learned the hard way

**A decimal separator with exactly two places after it is mandatory.** The
dropped-decimal repair (`1299` → `12.99`) is deliberately NOT done. A receipt is
full of 3–7 digit numbers that are not money — street numbers, store and
register numbers, transaction ids, SKUs. The address line `2210 BANK ST` parsed
as an item called "BANK ST" costing $22.10 before this rule existed.

**Adoption requires landing, not improving.** If an item is *missing* rather
than misread, the gap to the printed total is large, and some single-digit edit
to a **correctly-read** price will always shrink it a little. Adopting on
"closer" corrupts a good price to chase a gap it can never close. Requiring the
candidate to land makes the repair self-proving. A receipt with two mangled
prices, where no single edit reconciles, is left alone — the correct
conservative answer.

The search is bounded at 24 candidate re-parses so a pathological receipt cannot
turn a scan into a spinner.

### Print quality as a measurement

`ocrService._collectWords` now captures Vision's per-word confidence as `conf`
(**additive** — omitted when Vision reports none, so every fixture captured
before this is unchanged). `assessPrintQuality()` turns it into
`{faint, meanConfidence, lowConfRatio, samples}`, stamped on every parse as
`printQuality` and carried into the second-pass telemetry.

This matters because it is the only **direct** measurement of print quality —
everything else infers faintness backwards from a parse that already went wrong.
It separates "the parser is wrong" from "the receipt is unreadable": without it,
a rising second-pass rate is ambiguous.

---

## 5. Tests

| suite | guards |
|---|---|
| `receiptParserRegistry.test.js` | dispatch, generic fallback, lane gating, **42-fixture Costco parity** |
| `bestBuyReceiptParser.test.js` | both layouts, discount netting, service lines, SKU width |
| `bestBuyReceiptParser.realocr.test.js` | real captures (green with zero, reports the count) |
| `faintPrintRepair.test.js` | what it must REFUSE, the landing rule, the search bound |
| `adsAutolinking.test.js` | the plugin/autolinking halves agree on every lane |
| `easBuildProfiles.test.js` | every profile reads; production lane off; `LAB_ENABLED=true` production **throws**; ads plugins excluded |

Reproducing a config read locally needs **both** `EAS_BUILD=true` and
`EAS_BUILD_PLATFORM` — the ads assertion returns early without the platform, so
a check missing it passes on config that cannot build:

```bash
EAS_BUILD=true EAS_BUILD_PLATFORM=android EAS_BUILD_PROFILE=production \
APP_ENV=production node -e "require('./app.config')({config:{extra:{}}})"
```

---

## 6. Open

- **Production stops compiling the ads SDK.** Config reads are asserted for both
  platforms, but this wants **one real production build** before the next store
  release.
- **An undetected store still defaults its SKU lookup to Costco.** See
  `Technical/BestBuy/Receipt_Parser.md` §2 on the promotion defect; the fallback is deliberate (it preserves the
  pre-promotion behaviour exactly) but it is a guess, and the right answer is
  probably to skip the inference entirely when the namespace is unknown.

## 7. Promoting a store off the lane

Best Buy's 2026-09-02 promotion — the five declarations that move together, why
Costco is unaffected by construction, and why go-live is the generated
`store-content-sync.sql` rather than a code change — now lives in
`Technical/BestBuy/Receipt_Parser.md` §2. The checklist for the next store is
`Technical/Adding_A_New_Store.md`.
