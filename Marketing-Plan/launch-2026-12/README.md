# Launch creatives (new version, Dec 2026): what goes where

Plan and strategy: [`../14-launch-campaign-stop-asking-the-group.md`](../14-launch-campaign-stop-asking-the-group.md).

| What | Where |
|---|---|
| **Facebook + Instagram ads** (Meta Ads Manager), both campaigns, EN + FR, every placement at its exact size, named for upload | `social-media-manager` repo, `sm-content/14-new-version-ads/ready-to-upload/{EN,FR}/` |
| Their concept, rules, Ads Manager copy and how to add a hook | `social-media-manager` repo, `sm-content/14-new-version-ads/README.md` (short form in `RULES-README.md` §9) |
| The one source and renderer for the ads **and** the store screenshots below | `social-media-manager` repo, `sm-content/14-new-version-ads/scenes/creatives.html` (`f=store1`, `f=store2`) |
| **App Store Connect / Google Play screenshots**, slots 1–2 of 10 (no promo code, by policy) | here, [`app-store-screenshots/{en,fr}/`](app-store-screenshots/), 1320×2868 |

Social media content lives in `social-media-manager`, next to the automation that posts it (the standing split in
[`../README.md`](../README.md)). Moved there on 2026-11-27.
