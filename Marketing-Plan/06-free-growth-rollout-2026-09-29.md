# Free growth rollout — 2026-09-29

Context: app live in production ~1 week, too few users, **zero budget**. Everything here is free.

## State found today
- Metricool brand `Priceback` (id 7106442) is connected to Instagram `priceback.ca` + Facebook page; **0 posts scheduled**.
- The 14-day evergreen pack (`social-media-manager/sm-content/evergreen`, 9 feed / 10 stories, EN+FR) is dated 7–20 Sep — **already past**; needs re-dating.
- Website has 2 blog posts + EN/FR guarantee pages, sitemap live.
- Meta MCP exposes only *ads* tools → paid, out of scope.

## Standing instruction (Maxim, 2026-09-29)
**Do not post anything to Instagram or Facebook** (this includes scheduling in Metricool) until Maxim says so. Nothing was scheduled or published.

## Hosting the images (only needed when posting is allowed)
Meta/Metricool fetch images by public URL; the social repo is private. Maxim confirmed the R2 credentials are in the Railway variables and may be used. Route: upload `sm-content/evergreen/{posts,stories}` to the public R2 bucket, set `ASSET_BASE_URL` per `AUTOMATION.md`. A website-hosting PR route was tried and denied by the permission classifier, so it was dropped.

## When posting is greenlit
1. Re-date the pack from the go date, schedule via Metricool (IG + FB, 18:30 ET feed / 12:00 stories), disclaimer + hashtags appended from `schedule.json`.
2. Guarantee-campaign content stays unpublished until its 3 gates pass (backend live, store release live, priceback.ca/guarantee live).

## Free tactics for you (need a human account/voice)
- Reddit r/PersonalFinanceCanada, r/Costco, r/CanadianCoupons, r/Quebec: answer real "price adjustment" threads with the blog explainer; never spam, disclose you built the app.
- Facebook groups (Costco Canada deals, Quebec bons plans): same rule.
- Ask every existing user for a store rating (in-app prompt after a successful drop).
- Product Hunt / Indie Hackers / r/SideProject launch post (Canada angle).
- Link-in-bio + email signature → store links; Google Business Profile not applicable (no storefront).
- SEO: keep publishing the FR/EN blog per `Website/` roadmap — slowest but compounding.

## Tracking
Fill the KPI table in `05-launch-calendar.md` weekly (IG followers, installs from social).
