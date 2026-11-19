# Deals: add a product to a watchlist (later, not started)

**Status:** documented for later (Maxim, 2026-11-10). Not built. The "+" button on each Deals row in the
Store Spaces v2 design (`redesign/spaces2-deals.jsx`, `SpDealRow`) is **hidden** until this ships.

## The idea

A shopper browsing Deals taps "+" on a product to watch it: PriceBack tells them when that product's price
drops or a new saving starts, even if they have not bought it yet.

## What exists

- `watched_items` table (backend) and the receipt-line watch flow (`/api/watch`), which today watches items
  the shopper **bought**. A watchlist of products not bought yet is a different shape: no receipt line, no
  purchase price, no refund window.

## To decide before building

- What is watched: the product (SKU) at the shopper's warehouse, or nationally.
- What triggers a push: any new saving, a price under a target, or both.
- Limits per plan (Pay as you go / Unlimited).

Design reference: `Technical/Store_Spaces_v2_Design.md` §12 Q9.
