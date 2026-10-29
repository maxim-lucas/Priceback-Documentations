# Best Buy — the receipt parser

`src/services/bestBuyReceiptParser.js`, registered in
`src/services/receiptParsers/index.js`. Moved here on 2026-10-28 from
`Technical/Receipt_Parser_Registry_And_Store_Parsers.md` (its former §3 and §7),
per the rule *one store = one parser file and one documentation folder*. The
registry, the parser contract and the lab lane stay in that store-neutral doc.

**Where it stands (2026-10-28):** `bestbuy` is in `STORE_PARSERS`, so every build
carries the parser, and in `ADMIN_PREVIEW_STORES` (`src/constants/stores.js`):
admins can scan Best Buy, shoppers see "Coming soon". `LAB_STORE_PARSERS` /
`LAB_ONLY_STORES` now hold Sport Chek only. The history below explains how it got
there: off the lane on 2026-09-02, back on it on 2026-09-28 when `development`
was merged toward `main`, finalized admin-only by Priceback #504. See `README.md`.

## 1. The parser

Two formats, one entry point:

```
parseBestBuyReceipt(rawText, annotation)
  ├─ isRefundText()                  → parseRefundReceipt (in-store parser, signs inverted)
  ├─ detectPurchaseType() === online  → parseBestBuyOnlineReceipt   (bestbuy.ca order)
  └─ otherwise                        → parseBestBuyInStoreReceipt  (thermal paper)
```

#### In-store specifics

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

#### Online specifics

- `Web ID: NNNNNNNN` on its own line, attached to the preceding item. Without
  this the order logs fine and can **never** be price-watched — invisible until
  a drop happens and no alert fires.
- An in-store register header (`S-### R-##`) **beats** a delivery mention: a TV
  bought in store and delivered later is still an in-store purchase, and
  misclassifying it sends the user to the wrong price-adjustment process.


## 2. Promoting Best Buy off the lane (2026-09-02)

> Historical. The 2026-09-02 promotion happened on `development`. The five
> declarations listed below moved back on 2026-09-28 and forward again in #504,
> into the admin-preview posture above, not the shopper-enabled one.
> `bestBuyStorePromotion.test.js` still pins that the declarations agree.

The lane existed because the parser had no real fixtures. It ended when it had
nine captures (one in-store photo, eight order PDFs) plus the hardening pass
that found four defects the corpus itself never hit. **That is the bar for a
promotion: not "the tests are green" but "the ways this could be wrong have been
looked for on purpose."**

#### The five declarations that had to move together

| Where | Change |
| --- | --- |
| `receiptParsers/index.js` | `bestbuy` **moved** (not copied) from `LAB_STORE_PARSERS` into `STORE_PARSERS` |
| `constants/stores.js` | `LAB_ONLY_STORES` emptied; `bestbuy.enabled` → `true`; `BUNDLED_UPDATED_AT` bumped |
| `backend/data/policies.json` | regenerated from `stores.js` |
| `backend/config/defaults.js` | `BESTBUY_SCAN_ENABLED` default → `true` |

Five declarations of one fact is exactly the shape that gets three of five
right, so `__tests__/bestBuyStorePromotion.test.js` now pins it mechanically:
every id in `STORE_PARSERS` must be an enabled store on a store build, and
`LAB_ONLY_STORES` and `LAB_STORE_PARSERS` must name the same ids. Both files
carried a comment saying they had to agree; the comment was the entire
enforcement.

#### Costco is unaffected by construction

`resolveStoreParser` reads `STORE_PARSERS` **before** it consults the lane, so
Costco's lookup does not change shape. The parity block in
`receiptParserRegistry.test.js` replays the whole Costco corpus through the
dispatcher as evidence rather than as a claim.

#### 🔴 The go-live switch is still a database UPDATE

`applyRemoteStores` gates on the payload's `rev`, which is present and strictly
greater than the runtime's initial `""` — so **the DB payload replaces the
bundled array on every launch**. A promoted binary therefore still shows Best
Buy disabled until the `stores` row is updated. Bumping the bundle changes the
offline fallback only.

That sequencing is a feature, not an oversight: the binary can ship and be
device-tested before a single user sees the store. It also means the code change
is inert for live users, which is what let this land on `development` safely.

> 🔴 **What this section did not say, and it cost eight days (audit 2026-09-10).**
> "The `stores` row is updated" is not a manual step someone performs on a
> database by hand — it is `backend/db/deploy/store-content-sync.sql`, which was
> **hand-maintained, generated by nothing and tested by nothing**, and which still
> said `enabled = false` for `bestbuy` long after this section was written. So the
> switch named here as the go-live act had already been *silently* left in the off
> position by the same PR that flipped everything else.
>
> It is now generated (`npm run db:sync-store-content`) and pinned
> (`backend/tests/storeContentSync.test.js`). Regenerating it also restored two
> French claim steps that had lost the word "canadien" — the very drift this section's
> promotion test was written about, which had reached `stores.js` and
> `policies.json` and never reached the SQL.
>
> Full detail: `Technical/BestBuy/Integration_Audit_2026-09-10.md`.

#### The defect the promotion created

Promoting a store turns every `"costco"` literal elsewhere in the app into a
potential bug at once. One had teeth — `fetchMyPriceHistory` hardcoded
`store=costco`, and `ScanScreen` calls it for any `receiptKind: "online"`, which
is what the Best Buy parser stamps on order PDFs. Full write-up: **Bugs #236**.

#### One expectation moved because a parse got BETTER

`ocrService.test.js`'s "Best Buy Orleans" receipt has printed arithmetic that
does not add up: item `$3,699.99` + printed tax `$461.00` = `$4,160.99`, against
a printed TOTAL of `$4,180.99`. 13% of $3,699.99 is **$481.00**, and
`3699.99 + 481.00` lands on the printed total exactly — the printed tax is an 8
read as a 6.

The generic engine read the tax line verbatim and shipped the misprint. The Best
Buy parser repairs it, and adopts the repair only because it LANDS. The test now
asserts `481` *and* that the repaired value reconciles, so the number cannot
drift back without the reason failing too.
