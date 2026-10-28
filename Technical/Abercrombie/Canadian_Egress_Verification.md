# Abercrombie — the Canadian-egress verification

**One request, from inside Canada, decides whether store #3 ships whole or
degraded.** This is the procedure for making it, what to record, and what each
outcome triggers.

**Owner:** Maxim, from Canada. **Scheduled:** on/after **2026-09-24** (back in
Canada ~2026-09-22). **Blocks:** the price feed, `hasDbPriceFeed`, and the whole
fallback question in `Fallback_Percentage_Drop.md`.

## 🔴 Run of 2026-10-28 — Canadian egress reached, storefront NOT read: A&F now runs a JavaScript bot challenge

```
Date:            2026-10-28
Egress:          Orléans (Ontario), CA / AS577 Bell Canada   (ipinfo.io, Step 0 passed)
/shop/ca lands:  unknown — no HTML served
data-storeid:    not read
priceCurrency:   not read
Fixture saved:   none (deliberately — see below)
```

- **Step 1 (curl, Windows schannel, the documented full header set):** twice, two
  minutes apart: no HTTP response at all; the server holds the connection
  60 s and closes it (`schannel: server closed abruptly`, `code=000`).
  `robots.txt` answers 200 to the same client, so this is not reachability.
- **Step 3 (Node, `abercrombie-quote-probe.js`, through the real adapter):** both
  quotes `storefront_mismatch (storeId=? currency=?)`. The saved body (3 KB) is a
  **"Client Challenge"** page: *"Please enable JavaScript to proceed"*, scripts
  under `/_fs-ch-…/`. In September the same probe got the real product HTML.
- **Not committed as a fixture:** it is not a capture of any storefront, and the
  "never commit a non-Canadian capture as Canadian" rule covers anything that is
  not the page.

**What this changes.** Whatever the currency answer turns out to be, **a plain
HTTP adapter cannot read A&F any more** — from Canada, from Railway, from a GCP
relay. Outcome A's relay plan (§"What each outcome triggers") would hit the same
wall. A feed now needs a real browser engine (a headless browser solving the
challenge, or a scraping service), which is a cost and terms-of-use decision for
Maxim, not a code change. `CANADIAN_STORE_IDS` stays empty — correctly.

**Still worth doing once:** read `data-storeid` and the currency off `/shop/ca` in
a real desktop browser on Canadian egress. That settles the CAD-vs-USD question
(outcome A vs B) even though it does not unblock the automated feed.

### Follow-up, same day: the wall is F5 Bot Defense, and headless Chrome does not pass it

- **CAD settled by Maxim (2026-10-28).** He opened A&F in his own desktop
  browser from Orléans and saw prices in **CAD**. That is outcome A: A&F Canada
  sells in CAD to Canadian egress. The storefront id (`data-storeid`) is still
  unread, so `CANADIAN_STORE_IDS` stays empty until a real Canadian page is
  captured.
- **The challenge vendor is F5** (formerly Shape Security, now F5 Distributed
  Cloud Bot Defense). The challenge page loads `/_fs-ch-<token>/script.js` and
  `errors.js` and names F5. This is an enterprise bot defense that fingerprints
  the browser and the automation layer, not a simple cookie check.
- **One headless visit, same Bell egress (ipinfo `CA`):** real Google Chrome 155
  driven by `puppeteer-core`, fresh profile, product URL
  `/shop/ca/p/lyocell-cotton-pleated-baggy-trouser-63504014`. HTTP 200, title
  **"Client Challenge"**, still on the challenge after 32 s (17 KB, no
  `data-storeid`, no `priceCurrency`). Its user agent announces
  `HeadlessChrome`. One request only, because of A&F's IP-wide throttle.
- **What this means for a self-built service.** A browser engine alone is not
  enough. Getting through would mean hiding the automation from F5's
  fingerprinting, an arms race against a vendor whose product exists to detect
  exactly that. We do not build that. The workable routes are listed in
  `Price_Adapter.md` §"Owed before the scan flag is ever flipped". They need
  Maxim's choice.

---

## Why this is open at all

The adapter refuses every page today, and that is correct rather than broken. But
the reason it refuses is **not** what the earlier write-up said.

`Price_Adapter.md` recorded the 2026-09-07 capture session's verdict as *"measured
from a non-Canadian egress"*. That is true and badly under-specified. The capture
machine egresses from **Egypt** — `41.45.134.97`, AS8452 TE-AS, Alexandria —
re-confirmed 2026-09-10. So the finding is:

> From **Egyptian** egress, A&F serves the worldwide storefront in USD.

Which is unsurprising, and says nothing about Canada. **No request has ever been
made to A&F from a Canadian IP.** Every "A&F is USD-only" conclusion in this repo,
and Maxim's own research, rests on observations taken from outside Canada.

### The evidence points the other way

| Signal | What it says |
| --- | --- |
| A&F gift-card help page | Gift cards can *only* be bought in USD, and **"purchases of merchandise in CAD will be subject to an exchange rate conversion on the day of payment."** There is nothing to convert unless merchandise sells in CAD. |
| Retail-Insider, 2026-03 | A&F is **expanding its Canadian store network**. Physical Canadian stores necessarily price in CAD. |
| Google's index | `/shop/ca/womens-clearance`, `/shop/ca/mens-clearance` and a Canada-specific `/shop/a-ca/help/currency` are all live URLs. |
| A&F's price-adjustment policy | Has a section headed *"Orders That Will Be Shipped to the US **and/or Canada**"* — Canada is a first-class market, not a "worldwide" country. |

### The counter-signal, stated fairly

From Egypt, `GET /shop/ca` → 302 → `/shop/wd`, `data-storeid="11203"`, 423 KB, and
**CAD appears nowhere in the page** — the only currency codes present are AUD, COP
and USD. Anthropic's US-egress fetcher is routed the same way. So if A&F does
serve Canada in CAD, it is *only* visible from Canadian egress, and the worldwide
storefront genuinely has no CAD option.

Both readings survive the evidence we can gather from here. That is exactly why
this is a measurement and not an argument.

---

## The procedure

> ⚠️ **A&F throttles IP-wide.** A URL that had just returned 200 answered 403
> under rapid probing, and 200 again 75 s later. Run each step once. If you get a
> 403, wait two minutes — do not retry in a loop, or you lose the session and the
> address with it.

### Step 0 — confirm you are actually egressing from Canada

A VPN that silently dropped, or a browser using a US exit, invalidates everything
below. Check first, every time:

```bash
curl -s https://ipinfo.io/json
```

**Required:** `"country": "CA"`. Record the city and the `org`. If this says
anything but `CA`, stop — the rest of the run is worthless.

### Step 1 — where does `/shop/ca` actually land?

```bash
curl -s -L --max-time 60 -o anf-ca.html \
  -w 'final=%{url_effective}\ncode=%{http_code} size=%{size_download}\n' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
  -H 'Accept-Language: en-CA,en;q=0.9,fr-CA;q=0.8' \
  -H 'Upgrade-Insecure-Requests: 1' \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
  -H 'Sec-Fetch-Site: none' -H 'Sec-Fetch-User: ?1' \
  -H 'sec-ch-ua: "Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"' \
  -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' \
  https://www.abercrombie.com/shop/ca
```

The header set is **load-bearing**, not decoration — a `User-Agent` alone gets a
149-byte 403. Keep it complete.

**Record:** the final URL. `/shop/ca` staying `/shop/ca` is the good sign;
`/shop/wd` means Canada is served the worldwide storefront even from inside
Canada.

### Step 2 — read the two facts that decide everything

```bash
grep -oE 'data-storeid="[0-9]+"' anf-ca.html | sort -u
grep -oE '"priceCurrency"[[:space:]]*:[[:space:]]*"[A-Z]{3}"' anf-ca.html | sort -u
grep -oE '"currency"[[:space:]]*:[[:space:]]*"[A-Z]{3}"' anf-ca.html | sort -u
grep -c CAD anf-ca.html
```

**Record all four.** `data-storeid` is the value the adapter needs; everything
else is corroboration.

### Step 3 — a real product page, and keep the bytes

```bash
cd <repo>/backend
node scripts/abercrombie-quote-probe.js \
  --save tests/fixtures/abercrombie-web/live-$(date +%F)
```

It will still report `storefront_mismatch` — `CANADIAN_STORE_IDS` is empty, so
nothing can pass yet. **That is expected and is not the result.** The result is
the saved HTML: run the Step 2 greps against it.

### Step 4 — write down the number

Even if everything works, **do not skip this.** Add the observed
`data-storeid` to `CANADIAN_STORE_IDS` in `backend/lib/abercrombieCatalog.js`, and
record here:

```
Date:            YYYY-MM-DD
Egress:          <city>, CA / <org>
/shop/ca lands:  <final URL>
data-storeid:    <value>
priceCurrency:   <value>
Fixture saved:   backend/tests/fixtures/abercrombie-web/live-<date>/<file>.html
```

---

## What each outcome triggers

### ✅ A — `storeId` is Canadian and `priceCurrency` is `CAD`

The expected outcome, and the one the evidence favours. A&F Canada is real and
the whole problem was our vantage point.

1. Add the observed id to `CANADIAN_STORE_IDS`. That single edit turns the gate
   from "refuse everything" to "refuse everything foreign".
2. Commit the Canadian capture as a fixture and **replace the `deriveCad()`
   helper** in `abercrombieCatalog.test.js` with it. The derived pages exist only
   because no real one did.
3. **Railway cannot reach this.** Railway has no Canadian region, so the backend's
   own egress is never Canadian and will see storeId 11203 forever. (Correction,
   2026-09-23 production audit: the egress was not even US — the service ran in
   Railway's **Singapore** region until PR #351 moved it to `us-east4`. Any
   storefront observation made "from the backend" before that move was made from
   Southeast Asia.) The feed needs a Canadian
   egress path — a thin fetch-relay on **GCP Cloud Run in
   `northamerica-northeast1` (Montréal)**, called by the Railway job. GCP project
   `695135372222` already exists; a nightly watchlist sweep sits inside the free
   tier. Verify the relay's own egress with Step 0 before trusting it.
4. Only then is `hasDbPriceFeed` a question — and it still needs the slug source.
5. `Fallback_Percentage_Drop.md` is **shelved**, not built.

### ⚠️ B — Canadian egress still lands on `/shop/wd`, storeId 11203, USD

A&F genuinely serves Canada from the worldwide storefront and Maxim's original
research was right.

1. `CANADIAN_STORE_IDS` **stays empty**. Do not add 11203 — the gate is still
   correct, there is simply no Canadian price to gate for.
2. Build `Fallback_Percentage_Drop.md`. Note its storage prerequisite: a USD
   series must never be written into `price_points`, which has no currency
   column.
3. Record the finding here with the date and the egress, so nobody re-opens it.

### 🔶 C — something in between

`/shop/ca` resolves but prices in USD; or CAD appears but only as a converted
display price; or a *third* storefront id appears. **Do not decide from the
adapter — save the page and read it.** The tell for a converted price is a
storefront that offers a currency *selector*: a real Canadian storefront prices in
CAD because that is its currency, not because a dropdown was set.

If it is a converted display price, treat it as **outcome B**. A converted number
is the exact thing the gate exists to refuse, and it does not become claimable by
being easier to fetch.

---

## What must not happen

| Never | Why |
| --- | --- |
| Guess a `CANADIAN_STORE_IDS` value | One wrong guess in the permissive direction disables the only thing standing between a USD price and a billed price drop. |
| Commit a non-Canadian capture as a Canadian one | It pins the wrong currency into the suite, and every later reader trusts it. |
| Accept `priceCurrency: "CAD"` as sufficient | A&F has a multi-currency selector. A foreign storefront can declare CAD and serve an FX-converted price. The storefront is the load-bearing signal. |
| Convert USD → CAD with an FX rate | Retailers set regional prices independently; the converted number is not A&F Canada's price and never was. |
| Re-probe in a tight loop | The block is IP-wide. It takes out the session, not just the request. |

---

## Related

- `Price_Adapter.md` — the adapter, its gates, and the slug problem
- `Price_Adjustment_Policy.md` — what a price entitles a shopper to
- `Fallback_Percentage_Drop.md` — the decided-but-unbuilt degraded mode
- `Technical/Store_Price_Adapters.md` — the store-neutral adapter checklist
