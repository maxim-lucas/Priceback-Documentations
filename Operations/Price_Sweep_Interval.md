# Price sweep interval

The scheduled **price sweep** looks for new verified price drops and stages them for the admin Price-drop queue (`PRICE_DROP_REVIEW_REQUIRED` is on, so nothing reaches shoppers until a drop is approved). How often it runs is the `app_config` row **`PRICE_SWEEP_INTERVAL_MINUTES`**.

## Changing it

The interval offers six choices: 1 min, 5 min, 15 min, 1 hour, 5 hours and 24 hours. You can change it in two places (Priceback #472, asked for by Monica on 2026-10-20):

- **App:** Admin home > Product > **Price sweep** (`src/screens/AdminPriceSweepScreen.js`, `GET/POST /api/admin/price-sweep-settings`, admin account). The app asks for confirmation before switching to 1 minute.
- **Web console:** `admin.priceback.ca/admin-console/`, section **4. Price sweep** (`GET/POST /api/admin/console/price-sweep`, admin token). This works from a phone browser without a new app build.

The routes accept only those six values. If a server environment variable of the same name is set, it pins the value and the routes refuse a change (409).

A change applies within about a minute on the instance that took it, because the scheduler's 60-second supervisor re-reads the setting. Other instances pick it up on their next config refresh, about 5 minutes later. No redeploy is needed. The countdown restarts on a change, so the first sweep runs one full interval after it.

## Rules (`backend/sweepScheduler.js`)

- Floor: **1 minute** (it was 15 until #472). The scraper leg that the old floor protected is gone. Overlapping ticks are skipped, and the drop ledger makes a repeat run idempotent, so a short interval costs database work only. Use 1 minute for a short test only.
- A missing or garbage value falls back to 1440 (daily).
- The newest successful run is in `job_runs` (`job_name = 'priceSweep'`), and both admin views show it.

## Current setting

- 2026-10-20 22:22Z: set to **15 minutes** on prod for the `costco-region-2026-10-19` import. Monica: "keep it at 15 mins for now, don't put it back to daily". Only she decides when it changes.
