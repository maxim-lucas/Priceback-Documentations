# Nationwide savings by warehouse type

**Asked by Maxim, 2026-11-26** — *"the warehouse type should be implemented inside the warehouse selection, it doesn't make any sense now or we should have an option to list the savings by warehouse types nationwide to make sense"*.

## Shipped (PR #742)
The Deals filter's warehouse type (All / Costco / Business Centre) moved under the warehouse picker.

## To build
1. **A "Nationwide" choice in the warehouse picker** on Deals (and Warehouse prices), above the nearest warehouses.
2. **Nationwide + type:** lists every official saving running today in any province for that warehouse type (Costco warehouses or Business Centres), one row per product, with the provinces/warehouses it runs in ("ON, QC · 47 warehouses").
3. **Picking a warehouse** narrows the type to that warehouse's own type (a Business Centre picked → Business Centre deals only); the type pills only show with Nationwide.
4. Same rules as today: official savings only, sold-by-the-pack savings said alone (rule 8), the province day for "running today" is the viewer's.

## Notes
- Backend: `dealsRepo.loadRawRows` is per province today; nationwide = no province filter, `DISTINCT ON (product_id)` keeping the biggest saving, plus an aggregate of province codes. New optional query parameter (`scope=national`); old builds send none and are served as before.
- Cache: one nationwide feed per type, shared by every shopper (cheap).
