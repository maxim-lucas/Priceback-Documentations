# Launch creatives (new version, Dec 2026): what goes where

Plan and copy: [`../14-launch-campaign-stop-asking-the-group.md`](../14-launch-campaign-stop-asking-the-group.md).

| Folder | Where it goes | Sizes |
|---|---|---|
| `meta-ads/campaign-1-free-tools/<lang>/<hook>/` | **Facebook + Instagram ads** (Meta Ads Manager), campaign 1: Deals + Warehouse prices, free. No code, no scanner. Five hooks in EN (`1-stop-asking-the-group` … `5-not-the-flyer`); FR has hook 1 until the EN hooks are chosen | `feed-4x5` 1080×1350 (Feed), `story-reel-9x16` 1080×1920 (Stories, Reels), `square-1x1` 1080×1080 (Feed alt., Google Display / Demand Gen) |
| `meta-ads/campaign-2-receipt-scan-black/{en,fr}/` | **Facebook + Instagram ads**, campaign 2: receipt scan (Costco + Best Buy), start free, code BLACK | same three |
| `app-store-screenshots/{en,fr}/` | **App Store Connect** (iPhone 6.9" slot) and **Google Play** (phone screenshots). Slots 1–2 of 10; no promo code, by policy | 1320×2868 |

Every ad ends with a footer band: Download free · priceback.ca · Follow @priceback.ca. The ad images carry no paragraph: in Ads Manager, the **primary text**, the **headline** and the
**Install** button are typed in the ad, under the image (copy in §5 of the plan).

Everything renders from `source/creatives.html`:
`?c=free|scan&v=1..5&f=poster|story|square|store1|store2|info4x5|info9x16|info1x1&lang=en|fr`
(`info*` = the earlier info-sheet layouts, kept for organic posts and the carousel's last slide).
