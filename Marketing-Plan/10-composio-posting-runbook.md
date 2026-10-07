# 10 · Posting a carousel to Instagram + Facebook with Composio (runbook)

Proven 2026-10-03 (Costco toolkit, EN then FR). Follow it as written; no need to rediscover anything.
Persona for every post: **Instagram growth marketer**, whose job is new followers: a scroll-stopping hook as the
first caption line, one ask per caption (comment, send, save), a small relevant hashtag set (5, per the
playbook), and the non-affiliation / credit disclaimer the pack's gates require.

## Standing rules

1. **English first, French second.** Two separate posts (never bilingual in one), published about a minute apart
   (EN → FR), on both networks.
2. **Never the same image twice in one post, in any file extension.** A slide ships as ONE file, the `.jpg`
   (Instagram's carousel API is JPEG-only). The `.png` masters are never attached. Check before posting:
   `md5sum posts/<post>/*-en-*.jpg` must give N distinct hashes.
3. **Never generate the same content in two file extensions** (future pack generation). Render the slide once
   as the master, derive the single shipping format from it, and keep masters out of `posts/` so a carousel
   can never be fed both.
4. **EN and FR are different content**, never a translation overlay on the same image. Each language has its own
   slides and its own caption.
5. Captions are final text from `post.json` (`instagramCaption`, `facebookCaption`). Instagram says "link in
   bio" (no clickable links); Facebook carries the store links.
6. Honour `holdUntil` in `post.json`. Check the app build before posting a post that names a feature.

## One-time setup (done)

- Composio connections: **instagram** (`@priceback.ca`, ig_user_id `28311640755126860`) and **facebook**
  (Page **Priceback**, page_id `1213427591856904`). Re-check with `COMPOSIO_MANAGE_CONNECTIONS` (action `list`).
- `maxim-lucas/social-media-manager` is **public**, so `raw.githubusercontent.com/.../master/...` is fetchable by
  Meta. No R2 upload or Railway credentials are needed any more (that was the 2026-09-26 / launch workaround
  while the repo was private). If the repo goes private again, host the slides on a public URL first.

## Steps

1. **Pick the post** from `sm-content/<pack>/post.json` (EN + FR entries share an `order`).
2. **Get it onto `master`**: commit the pack, push, PR, merge (Meta fetches `.../master/...`).
   The pushed branch URL also works for a quick test, but post from `master`.
3. **Verify** each URL returns `200 image/jpeg` (`curl -sI`), and the slide hashes are distinct (rule 2).
4. **Load tools**: `COMPOSIO_SEARCH_TOOLS` (instagram carousel + facebook multi-photo), pass the returned
   `session_id` to every later call.
5. **Instagram, EN**: `INSTAGRAM_CREATE_CAROUSEL_CONTAINER`
   `{ig_user_id, caption: <instagramCaption>, child_image_urls: [<7 master URLs, in order>]}` → `id`, then
   `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH {ig_user_id, creation_id: <id>, max_wait_seconds: 120}`.
   (One call replaces the per-slide child containers; 2–10 slides, caption ≤ 2,200 chars.)
6. **Facebook, EN**: `FACEBOOK_CREATE_MULTI_PHOTO_POST {page_id, message: <facebookCaption>, photo_urls: [...]}`
   (one feed post with all slides; `FACEBOOK_CREATE_PHOTO_POST` is single-photo only).
7. **Repeat 5 and 6 for FR** with the FR slides and captions.
8. **Verify**: `INSTAGRAM_GET_IG_USER_MEDIA` (permalinks, order EN then FR) and note the Facebook `post_id`s.
9. **Afterwards (manual, the API cannot)**: share each post to Stories with a link sticker to the store pages;
   reply to every comment in the first hour; pin the best 3 posts.

## Pitfalls

- "The media could not be fetched from this URI": the URL is not public or not a direct JPEG. Re-check step 3.
- Publish with the **parent** `creation_id`, never a child id. Container ids expire in <24 h.
- `FACEBOOK_CREATE_MULTI_PHOTO_POST` publishes immediately; there is no draft step. Confirm captions first.
- Facebook was never connected before 2026-10-03, so the launch posts (2026-10-02) are Instagram-only.
- Stories, Reels with stickers and Highlights cannot be created by API (see
  `Operations/Instagram_Highlights_Posting_2026-09-26.md`).

## Log

| Date | Post | Network | Ref |
| --- | --- | --- | --- |
| 2026-10-02 | Launch EN / FR | Instagram | DeAIfCOGy0m / DeAIe_FG_IU |
| 2026-10-03 | Costco toolkit EN | Instagram | https://www.instagram.com/p/DeC08MFmV2A/ |
| 2026-10-03 | Costco toolkit FR | Instagram | https://www.instagram.com/p/DeC1EY_mYTi/ |
| 2026-10-03 | Costco toolkit EN | Facebook | `1213427591856904_122121228759427944` |
| 2026-10-03 | Costco toolkit FR | Facebook | `1213427591856904_122121229677427944` |

Next in the series: `scan-receipt`, `claim-drop`, `price-tag`, `community`, `best-of-money`, and `price-codes`
(its hold was the Price tag translator, which is now in production, so check `holdUntil` and remove it).
