# Costco special offers: own table + manual price-drop check

Status: **planned** (2026-10-01). Origin: the 2026-10-01 coupons extraction
(`Stores/Costco/Coupons/Canada/Warehouse offers/2026/coupons_2026-10-01.json`,
`specialOffers` block). See [[Costco_Flyer_Province_Comparison]] §7 and
[[Costco_Coupons_Ingestion_Roadmap]].

## The offers

Conditional rebates that are not a single-SKU price, so they never go into
`price_points`. This cycle (valid 2026-09-28 to 2026-10-25):

- Lennox: Costco Shop Card worth 15% of a qualifying Home Comfort Systems purchase.
- Michelin: $100 instantly on 4 or more new passenger / light-truck tires.
- Hunter Douglas: free Softouch Motorization upgrade on a qualifying purchase.
- Optical: $100 off each additional pair with progressive lenses, $50 otherwise.

## Decision (Maxim, 2026-10-01)

1. Special offers are stored in **their own table** (not `price_points`).
2. They are used to **flag an eventual price drop for a manual check**:
   when a receipt contains a purchase that matches an active special offer,
   the case is surfaced to an admin for manual review.
3. **No commission is charged by Priceback** on these cases. Priceback cannot
   independently verify a conditional rebate (see [[commission-charged-once]]),
   so it never auto-deducts credit or pays out on them.
4. The user may be asked to confirm whether they actually received the rebate
   (see [[Costco_Flyer_Province_Comparison]] §7); that answer informs the
   manual check only.

## Open design points

- Table shape (follow `db-design-best-practices`): offer type discriminator
  named `type`, validity window, store/country, search term, free-text
  conditions, source batch key. Migration + `backend/db/deploy/schema.sql`
  regenerated; DDL on prod before the merge.
- Matching rule per offer type (brand/category on receipt lines).
- Admin review surface: reuse the price-drop review queue if it fits.
- Importer: read the `specialOffers` array of the coupons JSON.
