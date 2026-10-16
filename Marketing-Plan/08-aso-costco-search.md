# ASO — ranking for "costco" in the App Store and Google Play (2026-09-30)

Goal: appear 1st–2nd when users search "costco". **Honest ceiling:** Costco's own
app will hold #1 for the bare word "costco" in both stores; realistic target is
top 3–5 for "costco price adjustment / receipt / price drop" long-tail searches,
where PriceBack has no real competitor. Nobody can guarantee a rank.

## What each store indexes
| Store | Indexed text | Costco allowed there? |
|---|---|---|
| Google Play | Title, short description, **full description**, developer name | Description + short description: yes (nominative use + disclaimer). Title: no (third-party brand). |
| App Store | Name (30), subtitle (30), **keyword field (100)** — description is NOT indexed | **No** in name/subtitle/keywords (Guideline 5.2.1; see `marketing/app-store-description.md`). |

## Done (PR #381, copy only — console edits are manual)
- Play short description: "Costco price adjustment refunds: scan receipts, track drops, claim cash back" (76/80).
- Play full description EN + FR: Costco phrases in first paragraph + a "Built for Costco Canada shoppers" block + non-affiliation disclaimer + tutorial link.
- Apple description: tutorial link (not indexed, but converts).

## Manual steps (owner)
1. Play Console → Main store listing → paste short + full description EN, then fr-CA. **Save, reload, read back** (Console stages edits).
2. Apple: keep subtitle/keywords Costco-free. Use descriptive terms: `price adjustment,price drop,refund,receipt,scan,canada,price match,savings`.

## Levers that actually move rank (no trademark risk)
- **Ratings/reviews**: in-app review prompt after a successful claim; reply to every review.
- **Install velocity + retention**: the strongest ranking signal in both stores. Drive installs from the site (/blog guides, /blog/tutorials, YouTube @priceback) with store badges.
- **Play**: add the YouTube tutorial as the listing promo video; localize fr-CA; screenshots with "Costco receipt" captions (images are not indexed on Play, but lift conversion).
- **Apple**: Custom Product Pages + in-app events titled around the use case; screenshot captions are OCR-indexed since 2025 — verify before relying on it.
- **Backlinks**: website → store links (badges currently `#` per site README TODO — fix this first).

## Website (priceback-website PR #17)
`/blog/tutorials` (+ `-fr`) embeds every video from the @priceback channel
automatically via `/api/tutorials` (YouTube RSS, channel `UC_astrJdh3yPbLXHxc2bw8g`,
15-min cache). YouTube link added to every footer. Upload a video → it appears
within ~15 min, no deploy. Titles/descriptions shown are the YouTube ones (English
or French as written) — write each in the language of the video.
