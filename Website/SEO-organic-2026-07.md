# Organic SEO pass — July 2026

Owner asked for carte blanche on organic SEO for priceback.ca (no paid ads).
This documents what was already solid, what shipped in this pass, and what's
left — some of it needs the owner's own accounts/assets, not more code.

## Baseline audit (what was already good)

The site (`Priceback-Website` repo) already had strong technical SEO
fundamentals before this pass:
- `<title>` / meta description / canonical / `hreflang` (en, fr, x-default)
  on every page, including utility pages (support, delete-account, legal).
- Open Graph + Twitter Card tags site-wide.
- `SoftwareApplication` + `Organization` + `FAQPage` JSON-LD on the landing
  pages.
- `robots.txt` + `sitemap.xml` with hreflang alternates, correct clean URLs
  via Cloudflare Pages `_redirects` (no `.html`, legacy `%20` paths 301'd).
- Font loading already deferred/preloaded correctly (no render-blocking).
- `_headers` cache policy correct for SEO (HTML always revalidates so
  content changes go live immediately; static assets cached hard).

## What shipped in this pass

1. **`assets/og-image.png`** — real 1200×630 branded social-preview image
   (previously referenced by OG/Twitter tags but missing — every shared
   link showed no preview). Generated from the site's own design tokens
   (brand green, mint accent, logo mark) via a headless-browser screenshot,
   not stock art.
2. **`/blog` section** — the single biggest remaining opportunity, per the
   existing [TODO-BLOG.md](TODO-BLOG.md) roadmap (deferred 2026-06-22, now
   built). The landing page's content only lives at anchors (`/#how`,
   `/#pricing`), which Google can't rank independently — a static one-pager
   has no way to capture the recurring "Costco price adjustment" search
   demand identified in
   [../Marketing-Plan/04-growth-tactics.md](../Marketing-Plan/04-growth-tactics.md#L10).
   Two cornerstone guides shipped, EN + FR, each with proper single-`<h1>`
   structure, internal cross-linking, and schema:
   - `/blog/costco-price-adjustment-policy-canada` — the pillar policy
     explainer (`BlogPosting` + `FAQPage` + `BreadcrumbList` JSON-LD).
   - `/blog/how-to-get-a-price-adjustment-at-costco` — the tactical
     step-by-step (`HowTo` + `BlogPosting` + `BreadcrumbList` JSON-LD).
   - `/blog` index page linking both, plus `Blog` added to the main nav
     and footer on `index.html`/`index-fr.html`.
   - All six URLs (2 articles + index, ×2 languages) added to
     `sitemap.xml` with `lastmod` and hreflang alternates.
3. **Fact-checked against Costco's actual published policy** (not just
   training-data recall) before writing: Costco Canada's in-warehouse
   policy (`customerservice.costco.ca/.../1017287`) and Costco.ca online
   policy (`.../1017251`) — 30 calendar days, item must still be in stock,
   not price-matching, Costco can decline/change it. Both guides cite the
   primary source directly (good for E-E-A-T, and it's simply accurate).
4. **Compliance-safe copy** — per the non-negotiables in
   [../Marketing-Plan/01-strategy-overview.md](../Marketing-Plan/01-strategy-overview.md#L23),
   neither article promises a specific dollar amount or guaranteed refund,
   and all CTAs route to the app, never a personal inbox.
5. **`sitemap.xml`** — added `lastmod` dates to every URL touched this pass.

## What's still open (needs owner action, not more code)

These can't be done from inside the repo — flagging them again since they
directly gate SEO/discoverability results:

- **Google Search Console** — verify `priceback.ca`, submit
  `sitemap.xml`, and request indexing for the new `/blog` URLs so they get
  crawled fast instead of waiting for organic discovery. This is the
  single highest-value 10-minute task left.
- **Bing Webmaster Tools** — same idea, smaller payoff, near-zero effort
  (can usually import the GSC verification).
- **Web3Forms access key** — contact form still ships with a placeholder
  (`REPLACE_WITH_WEB3FORMS_ACCESS_KEY` in `index.html`). Not an SEO item,
  but worth fixing alongside since it's a live TODO in the same repo.
- **App Store / Play Store listing URLs** — once the app is published,
  update the store badges *and* consider ASO (keywords, screenshots) per
  [../Marketing-Plan/04-growth-tactics.md](../Marketing-Plan/04-growth-tactics.md#L22)
  item 10 — cheap and complements organic search.
- **Backlinks** — content alone doesn't rank without some inbound links.
  The community-seeding tactics already documented in growth-tactics.md
  (Costco/deal Facebook groups, subreddit mods, deal-newsletter partners)
  are the free way to get the first links pointing at `/blog/...` guides —
  those guides are exactly the kind of "genuinely useful, not an ad"
  content that gets pinned/shared, by design.

## Next content batch (when picked up)

See the updated [TODO-BLOG.md](TODO-BLOG.md) — candidates are a
retailer price-match comparison piece and a Black-Friday-season post.
Prioritize whatever Search Console shows people actually searching for
once the first two guides have a few weeks of query data.
