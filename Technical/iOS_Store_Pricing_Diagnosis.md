# iOS store pricing — the diagnosis, so it stops being re-derived

> **Read this before touching anything about how a price is displayed.**
>
> **The root cause is that the iOS in-app-purchase products cannot be fetched
> from App Store Connect. No change in the app repo can fix that.** Three
> separate rounds of client-side "fixes" have been spent on this and the report
> came back identical every time, because the rendering was never where the
> problem was.

Last updated: 2026-08-25.

---

## 1. The evidence (do not re-derive this)

From a Sentry breadcrumb on **2.8.14 (build 34)**, iPhone 16 Pro, iOS 26.6.1,
`environment: production`, 2026-08-25 05:34:44 UTC — 1.1 seconds after
RevenueCat was configured:

```
[RevenueCat] 🍎‼️ Error fetching offerings - The operation couldn't be completed.
(RevenueCat.OfferingsManager.Error error 1.)
There's a problem with your configuration. None of the products registered in the
RevenueCat dashboard could be fetched from App Store Connect (or the StoreKit
Configuration file if one is being used).
More information: https://rev.cat/why-are-offerings-empty
```

In the same session the app had already reached
`GET /v1/subscribers/$RCAnonymousID:…/offerings` successfully (HTTP 200) — so
**RevenueCat itself is reachable and correctly keyed.** What fails is the step
after: StoreKit asking App Store Connect for the five products, and getting none.

That is not a transient condition and not a client bug. It is what an IAP product
that App Store Connect will not serve looks like from inside the app.

## 2. Why three rounds of code changes did not help

The offering has **never** resolved on iOS. So `storePrices.priceFor()` has never
had a real iOS price to return. What each build did with that absence is the only
thing that changed:

| Build | What Buy Credits / Subscribe rendered on iOS | Why |
| --- | --- | --- |
| ≤ 2.8.10 | **`$3` / `$5` / `$10` / `$4.99` / `$49.99`** | `priceFor(id, p.priceLabel)` fell back to the bundled catalog labels in `shared/pricing.config.js`. These are plain USD-derived amounts, so the screen read as USD while the payment sheet charged CAD. |
| 2.8.11 (#282) | Skeleton bar, disabled CTA | `src/services/storePrices.js` introduced. The fallback parameter was **removed from the API**, so a caller has nowhere to put a hardcoded price. |
| 2.8.13 (#291) | Same, plus storefront validation | The disk cache gained a storefront-country stamp, so a cache from another region is discarded instead of rendered. |
| 2.8.15 (this) | Same, plus honest confidence | A cache that was applied provisionally is no longer promoted to `ready` when the live read never lands. See §4. |

Each of those was a real improvement and none of them could produce a price,
because there was never a price to produce.

**Corollary:** recreating the Apple account, changing its country, or reinstalling
does not help either. There is no storefront that can quote a price for a product
the store will not serve.

## 3. How to tell which situation you are actually in — in one tap

**Admin → Billing diagnostic → "Store pricing"** (added 2026-08-25). It reports
what the store answered, not what a screen drew. Read three fields:

| `Where these prices came from` | `Currency…` | What it means | Where the fix lives |
| --- | --- | --- | --- |
| Read live from the store | `CAD · storefront CA` | **The app is correct.** The number just renders with a bare `$` because StoreKit formats for the device locale. | Cosmetic only, if anything. |
| Read live from the store | `USD · storefront US` | The store account really is on the **US** storefront — for a TestFlight build that is the **Sandbox Apple Account** (Settings → Developer → Sandbox Apple Account), *not* the main Apple ID. | The device's store account. **Not code.** |
| Remembered… NOT yet re-checked | anything | A stale snapshot was standing in for a live price. | Fixed in 2.8.15 — see §4. |
| Nothing loaded | The store has not said | The offering is not resolving. **This is the state described in §1.** | App Store Connect. **Not code.** |

The row underneath (`Last answer from the store`) prints RevenueCat's own reason
verbatim, including `The store returned no purchasable products`.

> **Always take this reading before changing any pricing code.** It is the step
> that was skipped three times.

## 4. The one genuine client defect this investigation did find

`src/services/storePrices.js` applies a disk-cached price *provisionally*
(`status: "loading"`) when `getStorefront()` cannot name a country — correct,
because "we don't know" must never read as "it changed". But when the retry
budget ran out, the status was set with:

```js
_status = Object.keys(_prices).length ? "ready" : "unavailable";
```

— any non-empty price map became the final answer, including the provisional one.
On iOS the live read fails **every** time, so an unverified cache was promoted to
`ready` and stood for its full 30-day life. Deleting the app account and
re-creating it in another country does not clear AsyncStorage, so the one remedy
a user would think to try never touched it.

Fixed in 2.8.15: prices are publishable only if they came off the store this
session, or came from a cache the live storefront agreed with. Anything else is
dropped when the budget is spent, and the surface falls back to its skeleton —
which is what the module's own header already said it preferred. Pinned by
`__tests__/storePrices.test.js` → `describe("price confidence")`.

## 5. What actually has to happen

**Owner: Maxim. Console work, not code.**

1. In **App Store Connect**, attach the five in-app purchases to an app version
   and get them to **Ready to Submit** (an IAP that has never been submitted with
   a version is not served to StoreKit). See
   [`Publishing-Compliance/PUBLISH_CHECKLIST.md`](../Publishing-Compliance/PUBLISH_CHECKLIST.md).
2. Confirm the **product IDs in the RevenueCat dashboard match App Store Connect
   exactly** — `priceback_pack_starter`, `priceback_pack_pro`,
   `priceback_pack_max`, `priceback_unlimited_monthly`,
   `priceback_unlimited_annual`.
3. Confirm those products are attached to the **`current` offering** in
   RevenueCat. `offerings.current` being empty produces the same silence as
   having no products at all.
4. Re-open **Admin → Billing diagnostic** on the device and confirm
   "Read live from the store just now".

Related, already settled and recorded elsewhere: the Paid Apps Agreement is
active and bank/tax details are complete — those are **not** the blocker.

## 6. Things that are NOT the cause

Recorded so they are not investigated again:

- ~~The rendering code on Buy Credits / Subscribe / Paywall.~~ From 2.8.11 there
  is no code path that can render a catalog price on those screens; every price
  is `priceString` straight from RevenueCat.
- ~~The RevenueCat SDK key.~~ `config/profiles/revenuecat.js` routes a per-store
  key and `app.config.js` fails the build outright if a production store build
  has no usable key for that store. The 200 from `/offerings` proves it is valid.
- ~~The user's Apple ID country.~~ Changing it cannot make an unserved product
  purchasable. (It *can* change the currency once products ARE served — see §3.)
- ~~The Paid Apps Agreement / bank details.~~ Active since 2026-08-17.
