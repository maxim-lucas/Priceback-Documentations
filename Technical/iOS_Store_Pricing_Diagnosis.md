# iOS store pricing — the diagnosis, so it stops being re-derived

> **Read this before touching anything about how a price is displayed.**
>
> **The app is showing the store's own numbers. The numbers in App Store Connect
> are wrong.** No change in the app repo can fix that. Three separate rounds were
> spent on the rendering and the report came back identical every time, because
> the rendering was never where the problem was.

Last updated: 2026-08-25.

---

## 1. The arithmetic that ends the argument

Reported on **2.8.14 (build 34)**: the credit packs show **$1.99 / $3.99 / $6.99**.

Those numbers exist in **no catalog we ship or serve**:

| Source | Starter | Pro | Max |
| --- | --- | --- | --- |
| Bundled `shared/pricing.config.js` | `$3` | `$5` | `$10` |
| Remote `GET /api/v1/pricing.json` (live, checked 2026-08-25) | `CA$3` | `CA$5` | `CA$10` |
| **What iOS displays** | **$1.99** | **$3.99** | **$6.99** |

A fallback can only ever render a value it has. Since 1.99 appears nowhere in
either catalog, **the number came from StoreKit**, through RevenueCat's
`priceString`, which is the only other source `storePrices.js` has. So:

- **RevenueCat offerings DO resolve on a real device with a store account.**
- **The client is behaving exactly as designed** — it is displaying what the
  store says it will charge.
- **The prices configured in App Store Connect are not the intended ones.** The
  intent is CA$3 / CA$5 / CA$10; the store is quoting 1.99 / 3.99 / 6.99.

That is a console data problem, not a code problem, and it is why three rounds of
client fixes changed nothing.

> **Still open, and only a device can answer it:** whether those figures are USD
> on a US storefront or CAD that merely renders with a bare `$`. §3 takes that
> reading in one tap. Either way the amounts are wrong against intent, so the App
> Store Connect prices need setting regardless of the answer.

## 2. A SECOND, separate condition — Apple's review devices

Do not confuse this with §1. On Apple's own review hardware the offering does not
resolve at all. From a Sentry breadcrumb on 2.8.14, `environment: production`,
2026-08-25 05:34:44 UTC, geo Cupertino:

```
[RevenueCat] 🍎‼️ Error fetching offerings - The operation couldn't be completed.
(RevenueCat.OfferingsManager.Error error 1.)
There's a problem with your configuration. None of the products registered in the
RevenueCat dashboard could be fetched from App Store Connect …
```

In that same session RevenueCat's own API answered 200 and the RC user was
`$RCAnonymousID:…` — nobody was signed in. **A device with no App Store account
cannot resolve products**, so this is the expected shape for a review device, and
it is a different situation from §1. Its consequence is that **App Review sees no
prices at all** (skeletons), which is its own review risk — see
`Publishing-Compliance/`.

It is *not* evidence that the products are unservable in general: §1 proves they
are served, with the wrong amounts, to a device that has a store account.

## 3. How to tell which situation you are in — in one tap

**Admin → Billing diagnostic → "Store pricing"** (added 2026-08-25). It reports
what the store answered, not what a screen drew.

| `Where these prices came from` | `Currency…` | What it means | Where the fix lives |
| --- | --- | --- | --- |
| Read live from the store | `CAD · storefront CA` | These ARE Canadian prices; a bare `$` is just how StoreKit formats for the device locale. If the amounts are still wrong, they are wrong **in App Store Connect**. | App Store Connect. **Not code.** |
| Read live from the store | `USD · storefront US` | The store account is on the **US** storefront — for a TestFlight build that is the **Sandbox Apple Account** (Settings → Developer → Sandbox Apple Account), *not* the main Apple ID. | The device's store account, and/or ASC. **Not code.** |
| Remembered… NOT yet re-checked | anything | A stale snapshot was standing in for a live price. | Fixed in 2.8.15 — see §5. |
| Nothing loaded | The store has not said | The offering is not resolving — §2's condition. | The device has no store account, or ASC. **Not code.** |

The row underneath (`Last answer from the store`) prints RevenueCat's own reason
verbatim, and each resolved product is listed with the id it answered to, so a
product-id mismatch between the catalog and App Store Connect is visible rather
than inferred.

> **Always take this reading before changing any pricing code.** It is the step
> that was skipped three times.

## 4. What each build rendered, and why it is not the cause

| Build | On iOS | Why |
| --- | --- | --- |
| ≤ 2.8.10 | The store price when resolved, else **`$3` / `$5` / `$10`** | `priceFor(id, p.priceLabel)` fell back to the bundled catalog. |
| 2.8.11 (#282) | The store price, else a skeleton | The fallback **parameter was removed from the API**, so a caller has nowhere to put a hardcoded price. |
| 2.8.13 (#291) | Same, plus storefront validation | The disk cache gained a storefront-country stamp; a cache from another region is discarded. |
| 2.8.15 (#297) | Same, plus honest confidence | A provisional cache is no longer promoted to `ready`. See §5. |

From 2.8.11 onward **there is no code path that can render a catalog price** on
Buy Credits, Subscribe or the Paywall. Every price is `priceString` verbatim.

## 5. The one genuine client defect the investigation did find

Real, fixed in #297 — **but not the cause of the reported symptom.** Recorded so
the two are not conflated.

`storePrices.js` applies a disk-cached price *provisionally* (`status: "loading"`)
when `getStorefront()` cannot name a country — correct, since "we don't know" must
never read as "it changed". But when the retry budget ran out:

```js
_status = Object.keys(_prices).length ? "ready" : "unavailable";
```

Any non-empty price map became the final answer, **including the provisional one**.
Where the live read keeps failing, an unverified cache could stand for its full
30-day life, and deleting the app account and re-creating it elsewhere does not
clear AsyncStorage. Now a price is publishable only if it came off the store this
session, or came from a cache the live storefront agreed with. Pinned by
`__tests__/storePrices.test.js` → `describe("price confidence")`.

## 6. What actually has to happen

**Owner: Maxim. Console work, not code.**

1. **Set the in-app purchase prices in App Store Connect to match intent** —
   CA$3 / CA$5 / CA$10 for the packs, CA$4.99 / CA$49.99 for Unlimited (or
   whatever the current intent is; the source of truth is the `catalog` served at
   `GET /api/v1/pricing.json`). They are currently quoting 1.99 / 3.99 / 6.99.
2. Take the **Billing diagnostic** reading first (§3) and record the
   `currencyCode`. If it says `USD`, the storefront is also wrong and the device's
   store/sandbox account needs to be Canadian before any price reading is
   meaningful.
3. Confirm the **product IDs match** App Store Connect exactly —
   `priceback_pack_starter`, `priceback_pack_pro`, `priceback_pack_max`,
   `priceback_unlimited_monthly`, `priceback_unlimited_annual` — and that all five
   are attached to the **`current` offering** in RevenueCat.
4. Re-open the diagnostic and confirm the listed prices match the table in §1.

## 7. Things that are NOT the cause

Recorded so they are not investigated again:

- ~~The rendering code on Buy Credits / Subscribe / Paywall.~~ From 2.8.11 there
  is no code path that can render a catalog price there.
- ~~A stale price cache.~~ Possible in principle (§5) and now fixed, but it cannot
  produce 1.99 either — no cache can hold a number the store never sent.
- ~~The bundled or remote catalog.~~ Neither contains 1.99 / 3.99 / 6.99. Verified
  against the live endpoint on 2026-08-25.
- ~~The RevenueCat SDK key.~~ `config/profiles/revenuecat.js` routes a per-store
  key and `app.config.js` fails the build outright if a production store build has
  no usable key. RevenueCat answering 200 proves it is valid.
- ~~The Paid Apps Agreement / bank details.~~ Active since 2026-08-17.
- ~~Deleting and re-creating the Apple account.~~ Already tried. It cannot change
  what price App Store Connect has recorded for a product.
