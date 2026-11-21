# The admin desk restructure: Today tiles, three severity levels, settings behind gears

**2026-11-17, hotfix (`hotfix/admin-desk-restructure`).** Maxim: *"reduce the time i lose on following and
managing the app."* Supersedes the menu grouping in `Admin_Console_Triage_Rework.md` (five categories); the
cleanup registry in `Admin_Console_And_Data_Cleanup.md` is unchanged.

## What the home screen is now

| Part | Behaviour |
| --- | --- |
| Top bar | `PRD` (red) or `DEV` (green) badge instead of the "Production · Live shoppers" banner. A tap opens the caution and the connection details. Same badge on Dashboard, Health, Incidents, Quotas, Price sweep. |
| Today | Four fixed tiles: **Receipt review** (count = "Not reviewed"; App-approved is not counted), **Price drops** (high-confidence waiting), **Potential drops**, **Run sweep** (starts the full price sweep at once, **no confirmation**; hold for the sweep screen). |
| Needs action | One collapsible section; its header always shows `N to act · M warnings`. |
| Menu | Price Management · User Management · Product Management · General · Support, highest priority first, each collapsible (reordered 2026-11-21, see below). |

Every section's open/closed state is saved on the phone (`admin.home.layout.v1`) and restored after a relaunch.

## Severity levels

| Level | Rows |
| --- | --- |
| Act now (red) | Tag reviews waiting, credit drift, flagged accounts, failed jobs, sign-in failures needing action |
| Warning (orange) | Drops that reached nobody, shoppers we can't reach, suspended accounts, deletions in grace, real cleanup rows |
| Information (green, never counted) | Products with no barcode (`residue_orphan_products`), signups with no footprint (`stale_signups`) |

The two information groups keep their classifier and counter in the cleanup scan (Maxim: "keep the classifier
and the counter"); the home subtracts them from the warning count (`cleanupSplit`).

## Settings live on the feature, behind a gear

| Gear on | Opens |
| --- | --- |
| Tag reviews | Price-tag settings |
| Receipt review | Receipt reading (Gemini) |
| Price sweep (was "Price checks") | Sweep settings (interval; was the "Price sweep" row) |
| Service health | App version |
| Price-drop queue | Sending, approval, release gate, 100% auto-approval switches and the auto-approval summary |

The Price-drop queue also shows Potential price drops as a header icon with the low-confidence count, a red strip
when sending is paused, and one wrapped row of filter chips. Receipt review keeps Not reviewed / App-approved /
Rejected (and the picked chip) in sight; the rest open under **More filters**.

Renamed: Saving dates → **Saving Window**. Hidden from the menu: Shopper account (still reached from Accounts).

## Server

Additive only: `GET /api/admin/overview` gains `receiptsAwaitingReview`, counted by
`receiptsRepo.countForAdmin("unreviewed")`, the same condition the desk list filters with. The Price drops and
Potential tiles read the endpoints their screens list from. No route, field or migration changed; admin-only, no
shopper build calls it.

## 2026-11-21: menu regrouped (Maxim)

*"Accounts, Activity dashboard and user segments to be grouped together in the user section and this section should go
above Product management, also repartition the general section (same order): Stores, Partners, Promo codes and split
to a new section Support: Service health, Quotas, Incidents. Flyer scan should move 2nd position in product management
after Barcode feeder."*

| Section | Rows, in order |
| --- | --- |
| Price Management | Receipt review · Price-drop queue · Potential price drops · Unlinked warehouses · Price sweep · **Harvest jobs** (new, `Technical/Admin_Harvest_Jobs.md`) · Tag reviews · Price lookup |
| User Management | Accounts · Activity dashboard · User segments · Manage credits · Credit drift · Notifications to approve |
| Product Management | Barcode feeder · Flyer scan · Product names · Saving Window · Data cleanup |
| General | Stores · Partners · (Promo codes, when `feat/store-spaces-v2-main` reaches `main`: the screen is not on `main` yet) |
| Support | Service health · Quotas · Incidents |

`src/screens/AdminHomeScreen.js` `TOOL_SECTIONS`; pinned by `__tests__/adminHomeScreen.test.js`.
