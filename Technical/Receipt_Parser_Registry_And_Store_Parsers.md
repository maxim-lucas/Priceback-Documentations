# Receipt parser registry, store parsers, and the lab lane

**Status:** shipped to `main` (PR pending) — 2026-08-25
**Code:** `src/services/receiptParsers/`, `src/services/bestBuyReceiptParser.js`,
`src/services/faintPrintRepair.js`, `src/services/featureLanes.js`,
`react-native.config.js`

---

## 1. How a receipt gets parsed

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

1. Confirm `STORE_DETECTION_PATTERNS` matches the store.
2. Write `src/services/<store>ReceiptParser.js` against the contract, reusing
   `parseReceiptEngine` and its `reshapeLines` / `handleDiscountLine` hooks
   rather than re-implementing item extraction.
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

- **Best Buy** — in the parser registry (`LAB_STORE_PARSERS`) *and* in
  `isStoreEnabled` (`LAB_ONLY_STORES` in `constants/stores.js`). Both halves
  must agree: a store the scan screen accepts but the registry has no parser
  for would silently save a generic parse.
- **Ads** — `isAdsBuildEnabled()` now requires `adsEnabled && labEnabled`, so
  the JS gate can never disagree with what the binary actually contains.

### Working on the lane

```bash
# local
echo "LAB_ENABLED=true" >> .env.local

# device
eas build --profile lab
```

---

## 3. The Best Buy parser

Two formats, one entry point:

```
parseBestBuyReceipt(rawText, annotation)
  ├─ isRefundText()                  → parseRefundReceipt (in-store parser, signs inverted)
  ├─ detectPurchaseType() === online  → parseBestBuyOnlineReceipt   (bestbuy.ca order)
  └─ otherwise                        → parseBestBuyInStoreReceipt  (thermal paper)
```

### In-store specifics

- **SKU width 7–8 digits.** Load-bearing, not cosmetic: faint print invents
  short numeric fragments, and the shared engine's standalone-SKU path turns a
  stray `4931` into `Item #4931` with a stolen price.
- **Discount sub-rows.** Best Buy prints `Regular Price` / `Instant Savings`
  *under* the item. **The item row already shows the price PAID**, so netting
  the saving again would show a price the user never paid and would try to claim
  on. The handler checks the receipt's own arithmetic: if `regular − savings`
  already equals the line price, only `originalPrice` is recorded.
- **Service lines** (`GEEK SQUAD`, `GSP`, `PRP`, protection/replacement plans,
  installation, delivery, EN + FR) stay **visible** but `ignored: true`. There
  is no shelf price for a 2-year plan; a `price_point` from one is permanent
  noise in the crowdsourced pool.
- **Store number** `S-0937` — already handled by `extractWarehouseId`.

### Online specifics

- `Web ID: NNNNNNNN` on its own line, attached to the preceding item. Without
  this the order logs fine and can **never** be price-watched — invisible until
  a drop happens and no alert fires.
- An in-store register header (`S-### R-##`) **beats** a delivery mention: a TV
  bought in store and delivered later is still an in-store purchase, and
  misclassifying it sends the user to the wrong price-adjustment process.

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

- **The Best Buy corpus is empty.** One paper photo and one online export are
  owed. Until they land, the parser is structurally correct and empirically
  unverified.
- **Production stops compiling the ads SDK.** Config reads are asserted for both
  platforms, but this wants **one real production build** before the next store
  release.
