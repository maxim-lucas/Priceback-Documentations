# Address price reader — the price at a warehouse's exact address (admin only)

**Ask (Maxim, 2026-11-20):** from an admin check, get the price of an item *at the
exact address of any warehouse*, automatically, because prices read at the wrong
location led to wrong approvals on the price-drop queue. Admin only.

## Why a URL or a cookie cannot do it
Sameday (Instacart) prices by the delivery address; costco.ca by the warehouse
choice. Both come from the session. Tested 2026-11-20: a `postal_code` URL
parameter and cookies are ignored; Sameday uses the connection's location (or an
address saved in the session). The in-app browser tab (`expo-web-browser`) cannot
carry cookies or scripts. Sameday's GraphQL is not a stable door either: the client
computes each query's sha256 from the query text inside ~120 minified chunks.

## What was built
- **Postal codes** (`backend/scripts/collect-warehouse-postal.js`): street address +
  postal code of every official warehouse from costco.ca's own page (JSON-LD
  `LocalBusiness`, resolved by warehouse number alone). 115 of 116; #156 (Edmonton
  "E") has no page. Stored in `data/warehouses.json`, `warehouses.street_address` /
  `postal_code` (migration 0058), `officialWarehouses()`.
- **Reader** (`backend/lib/addressPriceReader.js`): a headless Chromium via
  `playwright-core` opens Sameday as a guest, types the warehouse's address into its
  own address box (street in full words, e.g. `1900 Cyrville Road`; a *street*
  suggestion is what Sameday saves, a postal-code suggestion is forgotten on reload),
  proves the address applied (postal code in the page's data, or the delivery pill),
  then reads the search result before "Related items". No "Related items" heading =
  the item is not listed there (Sameday shows popular products instead).
- **Route** `POST /api/admin/address-price { sku, warehouseCode }` (admin only, 30/min,
  one browser read at a time, 24 h cache, 75 s timeout). A refusal is typed
  (`disabled`, `browser_unavailable`, `warehouse_has_no_address`, `address_not_accepted`,
  `no_result`, `timeout`, `blocked`, `failed`), never a guessed price.
- **Phone**: a "locate" button on the shared lookup buttons (`StoreLookupButtons`,
  `warehouseCode` prop) — on the price-drop queue it reads at the receipt's warehouse.
  Also: costco.ca, Business Centre and Sameday Business Centre buttons.

## Going live
Off unless `ADDRESS_PRICE_READER=on`. The host needs a browser: `BROWSER_EXECUTABLE_PATH`,
or `chromium` on the PATH. **Railway (NIXPACKS) has none today:** add `chromium` to the
build (`nixpacks.toml` `nixPkgs = ["...", "chromium"]`) — about 0.5 GB more image and
~300 MB memory while a read runs. Not added yet (cost decision, Maxim). Also apply
migration 0058 to production by hand before the backend deploys.

## Known limits / open
- Measured only from a Canadian residential connection; Railway's US East egress may be
  blocked or priced differently (check `blocked` rate first).
- Sameday throttles new sessions from one IP: the reader keeps ONE guest session and
  retries the address box once.
- ~1 in 10 addresses is not found by the autocomplete (new developments, e.g. Kanata
  #541) → `address_not_accepted`; check by hand.
- costco.ca and Business Centre readers are not built (Sameday first).
- A Sameday result is Sameday's online price; the warehouse item number is not
  Sameday's id (the search finds it by number; verify the name).
