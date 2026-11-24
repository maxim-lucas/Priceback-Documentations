# Warehouse names: a place, never a number (rule, 2026-11-24)

**Standing rule (Maxim, 2026-11-24).** *"warehouses in the filters carrying the warehouse number in the name which is
not professional … we need real names for the warehouses"*, and *"for warehouse names always fix the root cause and
create rules to be followed for harvests or any other workflow."*

## The rule

1. **A warehouse is shown by its place**: city, plus the curated disambiguator (`E`, `Gloucester Business Centre`).
   Its number appears only where the design prints it on purpose (`· #1811`), never inside the name.
2. **A store label that carries the number is a city, never a name.** Same-Day's `Costco 1811 - Wasaga Beach` /
   `COSTCO 257 - SUDBURY` becomes city `Wasaga Beach` / `Sudbury`, name empty. One definition:
   `backend/lib/warehouseName.js` (`isHarvestLabel`, `splitHarvestLabel`, `HARVEST_LABEL`).
3. **Every workflow that writes `priceback.warehouses.name` goes through it**: the savings harvest
   (`savingsIngest`, `savingsRepo.writeHarvest`), `warehousesRepo.upsert`, and any later harvest, import, admin tool
   or script. A workflow that knows only the number writes code and province, and nothing else (the catalogue
   inserts in `productCatalogRepo`).
4. **The curated list wins** (`backend/data/warehouses.json`, seeded at boot). The seed fills a missing city and
   replaces a stored label with the curated name in **one** set-based UPDATE that writes only rows that need it.
   It never overwrites a real name and never changes a city that is set.
5. **Fix at the source, never at display.** No screen strips a number out of a name. A bad name is a write-path bug.
6. **Guarded**: `backend/tests/warehouseName.test.js` scans backend for warehouse writes. One that sets a name without
   `lib/warehouseName` fails the suite.

## A new warehouse (a new club opens)

Add it to `backend/data/warehouses.json` (and `src/constants/costcoWarehouses.js` for the offline list) with its
city and, when the city has several clubs, its disambiguator. Until then, a harvest that meets it stores the label's
place as the city. The app shows the city, so it is never a number.

## Root cause, 2026-11-24 (production)

| Code | Stored name | City | Created by | Shown as |
| --- | --- | --- | --- | --- |
| 257 | `COSTCO 257 - SUDBURY` | null | savings harvest, 2026-10-27 | "COSTCO 257 - SUDBURY · #257" |
| 1798 | `Costco 1798 - E. Windsor` | null | savings harvest, 2026-11-20 | "Costco 1798 - E. Windsor · #1798" |
| 1811 | `Costco 1811 - Wasaga Beach` | null | savings harvest, 2026-11-20 | "Costco 1811 - Wasaga Beach · #1811" |

The savings harvest created each row the first time it read the warehouse, using Same-Day's label as the name. The
seed's insert is `ON CONFLICT DO NOTHING` and only back-filled the address, so the curated city and name never
reached these rows. `/api/v1/warehouses.json` served them as they were. Fixed by PR #691 (`main`): the write paths
apply the rule, and the seed heals at the first boot (proven on the dev DB: Sudbury reset to the label, seed run,
all rows correct). Installed builds pick up the corrected list on their next refresh (24 h cache), with no app
update.
