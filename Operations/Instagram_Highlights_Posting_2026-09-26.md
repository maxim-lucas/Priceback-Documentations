# Instagram Highlights Story posting — 2026-09-26

Posted the 05-highlights content pack (`social-media-manager/sm-content/05-highlights`) to
`@priceback.ca` via Composio's Instagram Content Publishing tools. This covers the "post the
Story frames" half of the pack; the Highlight trays themselves still need a manual phone step
(see below — this is a hard Instagram platform limit, not a choice).

## What was posted

All 50 non-sticker Story frames, in the order `HIGHLIGHTS.md` specifies (bilingual intro → FR
card → tray by tray: How it works, Stores, Earn, Plans, The app, Tips, FAQ, About), each as a
two-call Graph API flow (`INSTAGRAM_POST_IG_USER_MEDIA` with `media_type: STORIES` to create the
container, then `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`). Verified live via
`INSTAGRAM_GET_IG_USER_STORIES` immediately after.

**Not posted — 2 frames, by design:** `hl-stores-03-en` / `hl-stores-03-fr` carry an interactive
"question" sticker (the follow ask). The Graph API cannot attach a poll/quiz/question/slider/link
sticker to a published Story — the sticker band would publish empty, which is worse than not
posting it. These two need to be posted from the Instagram app directly, with the real sticker
attached, using the local files at
`social-media-manager/sm-content/05-highlights/02-stores/priceback-hl-stores-03-{en,fr}.png`.

## Asset hosting

The Graph API pulls each image from a public URL it fetches itself — it does not accept an
upload — and `social-media-manager` is a private repo, so `raw.githubusercontent.com` 404s to
Meta. With Maxim's confirmation, pulled R2 credentials live from Railway (`Priceback-App`, prod
env) and uploaded the 50 frames to the existing `priceback-receipts` bucket under a separate
`marketing/priceback-highlights/<timestamp>/` prefix, using presigned GET URLs (6h TTL) minted via
the same S3 client pattern as `backend/storage/r2.js`. The bucket's ACL was never changed — nothing
was made public; each URL is a time-limited signed link, generated fresh right before use.

## What is still a manual step, and why

**Building the actual 10 Highlight trays is not automatable at all** — Instagram exposes no API
for Highlights, desktop web or Graph, mobile app only. This was true before this run and stays
true regardless of what posts via API; `HIGHLIGHTS.md` in the content-pack repo documents the
full manual procedure (order, cover selection, titles). With the 50 frames now live in the
account's Story archive, the remaining steps are:

1. Post `hl-stores-03-en`/`-fr` from the phone with the real question sticker attached.
2. Build each of the 10 Highlight trays from the archive: intro → English frames → FR card →
   French frames, in the order and titles `HIGHLIGHTS.md` gives, picking the matching cover PNG
   from `sm-content/05-highlights/covers/`.

Story archive entries expire from the *profile grid* after 24h but remain in the *archive*
indefinitely and can still be added to a Highlight — this should be done reasonably soon after
posting to keep the frames easy to find while building each tray, per the pack's own guidance.

## Related

- [[Task_Log.md]] — task entry for this request.
- `social-media-manager/sm-content/05-highlights/HIGHLIGHTS.md` — the full manual build procedure.
- `social-media-manager/sm-content/evergreen/AUTOMATION.md` — the platform-limits table this run
  confirmed in practice (Highlights row).
