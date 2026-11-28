# Executive member savings, per shopper (roadmap, 2026-11-24)

**Ask (Maxim, 2026-11-24):** *"on the long run we should also have the executive membership special savings, i dont
know if we can harvest them on the same run from sameday or they are not available. this should be customized for
users based on their membership."*

## What was measured (2026-11-24)

- The Same-Day savings harvest reads as a **guest** (no account). Its operation manifest (1,690 operations) has the
  member-tier operations: `LoyaltyClubMemberships`, `LoyaltyClubMembershipModalTiersQuery`, `LoyaltyCartSavings`,
  `RetailerLoyalty`, `ContentManagementDataQueriesLoyaltyOfferItems`, but they act on a **signed-in account with a
  linked membership card**. A guest session sees no Executive-only price or saving, so the same run cannot read them.
- The storefront menu (`DepartmentNavCollections`) has no Executive collection.
- Today `savings.flags.executiveOnly` is written by no source (dealsRepo header), so the app hides the Executive chip
  and quick filter.

## Options, cheapest first

1. **costco.ca / the weekly flyer.** Read the member-only offers that costco.ca publishes (the Executive member
   offers page and the coupon book's "Executive members" items), through the existing costco_web savings source.
   They become savings rows with `flags.executiveOnly = true`. No account needed. To probe first: whether the page
   exists in Canada and is readable without signing in.
2. **A Same-Day Executive account.** A dedicated Executive membership signed in to Same-Day, read by the harvest. It
   costs a membership, raises Terms-of-Service questions and needs a stored credential. Only if option 1 finds nothing.
3. **Shoppers.** An Executive member's receipt that shows a member-only instant saving is evidence (rule of N), as
   today. This is the fallback, not the source.

## Per shopper

The one rule already exists: `users.costco_membership_type = 'executive'`. The price-drop sweep and Potential already
gate Executive-only prices on it (`g.executive_only = false OR u.costco_membership_type = 'executive'`). Once a source
writes `executiveOnly`, Deals shows the chip and the quick filter and lists those savings only to Executive members,
with no new rule.

## Probe, 2026-11-28 (Maxim: the soundbar SKU 2336300 shows "Executive Members Only" in green on costco.ca)

Vantage point: the dev workstation, through `services/savings/httpFetch` (the harvest's own client), not Railway.

- **`https://www.costco.ca/kirkland-signature-exec-coupons.html`** (Maxim's link, "Executive Member Offers"): HTTP 200,
  server-rendered like the coupon book, but the slot `r-ks-exec-coupon_Slot 1` held Costco's *expired offers*
  placeholder ("Content is currently unavailable, please check back soon"). No offer tile, no item number. Its tiles,
  when the book is live, are expected in the coupon book's template (`costcoWebSource.parseOfferLines`): to confirm on
  the first live capture.
- **`https://www.costco.ca/s?keyword=executive%20only`** (Maxim's link): the results are rendered in the browser from
  costco.ca's search API (`gdx-api.costco.com/catalog/search/api/v1/search`, POST, named with its headers in the page's
  own published config). The server-rendered HTML holds no product. Reading that API is a different kind of access
  from reading a public page; the call was held for Maxim's decision (not made).
- The product page (`/p/-/samsung-hw-b630fzc-31-ch-soundbar-with-subwoofer/4000357885`) server-renders only the
  JSON-LD offer (online price $248, out of stock); the "Executive Members Only" mark comes from the browser-side product
  API too.
- Same-Day (guest) still shows the $50 off at every warehouse with no member mark.

**Decision needed (Maxim):** which source to read: (a) the exec coupon page, parsed like the coupon book, read when it is
live (cheap, public HTML, but empty between books); (b) costco.ca's search API for "executive only" (complete, but an
undocumented API); (c) both, (a) first.

## Next step

Probe costco.ca for member-only offers from a Canadian vantage point (record the vantage point, Abercrombie lesson).
