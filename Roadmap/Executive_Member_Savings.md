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

## Next step

Probe costco.ca for member-only offers from a Canadian vantage point (record the vantage point, Abercrombie lesson).
