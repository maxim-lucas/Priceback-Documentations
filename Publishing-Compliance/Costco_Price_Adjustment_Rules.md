# Costco price-adjustment rules PriceBack applies (and the open questions)

The single list of what PriceBack tells shoppers about Costco's price adjustment, why, and what is still
unconfirmed. Every user-facing sentence (app, push, website, store listing) must agree with this page.
Last reviewed: 2026-10-14 (Maxim).

## Applied

| Rule | What PriceBack does | Where |
|---|---|---|
| **30 days from purchase** (calendar days; online: order date) | the receipt's window; nothing after day 30 | `stores.adjustment_days`, `shared/claimDeadline.js` |
| **Only while the saving is still in effect** (2026-10-14) | each dropped item's deadline = the earlier of day 30 and the saving's last day. A drop whose saving has ended is not pushed, not charged, not reminded; the app says "Saving ended on …: you can still ask, but the claim will most likely be refused." | `Technical/Claim_Deadline_Per_Item.md` |
| Unknown saving end (price seen only on receipts) | the 30-day window, with "claim soon: Costco only adjusts while the saving runs"; admin fills the dates (Admin · Saving dates) | same |
| Not price matching | only Costco's own lower price on the same item | parser/sweep |
| An instant discount already on the receipt (TPD) | never offered a drop | `OFFERABLE_LINE` |
| **Sold by weight** (meat, chicken, fish by the kg) | never offered a drop: the receipt prints one pack's price | `products.is_weighted` (0024) |
| Executive-only offers | only for Executive members | `flags.executiveOnly` |
| Costco can decline or change the policy | said in the Terms §7 and the blog | website |

## Open — to confirm with Costco customer service (Maxim)

1. **Perishables.** Do price adjustments apply to perishable items (fresh meat, chicken, fish, produce,
   bakery, dairy)? Online sources disagree. Today only by-weight items are excluded. If perishables are
   excluded, the proposed change is a `products.is_perishable` flag (admin-set, like `is_weighted`, with a
   "Perishable" action on Admin · Potential drops) that removes the product from every drop path —
   **not built**, documented only (2026-10-14).
2. **A claim after the saving ended.** PriceBack says "you can still ask, but it will most likely be
   refused". Confirm that wording matches what warehouses actually do.
3. **Where to claim in a warehouse.** The app says "Returns counter", the blog and the Play listing say
   "Membership Counter", the outreach kit "Membership Services", the screenshots "customer service desk".
   New copy (2026-10-14) says "at the warehouse" until this is settled.
4. **Costco.ca refund delay.** The app says 5–10 business days, the blog 5–7.

## Known copy inconsistencies (not changed on 2026-10-14)

- The store screenshots (`Marketing-Plan/app-store-screenshots/source/screenshots.html`) use "Salmon fillets
  1.3 kg" as an example price drop — a by-weight item PriceBack never offers. Replace it at the next
  screenshot refresh.
- The support pages say windows are "typically 14–100 days depending on the store"; the bundled stores are
  15 and 30 days.
- The app links Costco's online-policy page (`a_id/1017251`) for warehouse purchases too.
