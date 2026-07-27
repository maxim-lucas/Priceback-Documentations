# TODO: Blog / Guides section (deferred SEO work)

The marketing site is currently a single page where all content lives at anchors
(`/#how`, `/#pricing`, `/#faq`). Google can't rank those anchors independently,
so we're missing recurring, high-intent search demand from Costco shoppers.

## Goal
Add a standalone `/blog` (or `/guides`) section of indexable, linkable pages that
target real search queries and funnel readers to the app.

## Why this is the biggest remaining opportunity
- Topics like "Costco price adjustment policy" have steady, recurring search volume.
- A landing page can't rank for these; a dedicated guide can.
- Guides are far more linkable (other sites link to useful guides, not product pages)
  and give us something to share on Facebook/Instagram.

## Candidate articles (high-intent, lower-competition)
- "Costco Price Adjustment Policy: Everything You Need to Know (2026)"
- "How to Get a Price Adjustment Refund at Costco"
- "Costco vs [other retailer] Price Match Policy Compared"
- Seasonal: "Costco Black Friday price drops — how to claim them"

## Keyword / positioning strategy
Don't fight for the bare word "priceback" (competes with Price.com, a crypto coin,
an unrelated .app). Target specific phrases instead:
- "Costco price adjustment app"
- "Costco price drop refund app Canada"
- "get money back Costco price drop"
- "Costco price protection app"

## Implementation notes for when we build it
- Each article: standalone clean URL (`/blog/costco-price-adjustment-policy`),
  proper single `<h1>`, `<h2>` subsections.
- Add `Article` (or `BlogPosting`) JSON-LD per page; reuse `FAQPage` schema where the
  article has a Q&A block.
- Add a `/blog` index page; link articles from the main page footer.
- Add every new URL to `sitemap.xml`.
- Build EN + FR versions with matching `hreflang` alternates (mirror the existing
  index/legal-page pattern).
- Internal-link each article to the app download + relevant FAQ anchors.

## Status
**Shipped 2026-07-27** as part of a broader organic-SEO pass (see
[SEO-organic-2026-07.md](SEO-organic-2026-07.md) for the full audit and
action list). Live at `/blog` (EN) and `/blog/index-fr` (FR):

- `costco-price-adjustment-policy-canada(-fr)` — the pillar policy guide.
- `how-to-get-a-price-adjustment-at-costco(-fr)` — the tactical how-to.

Both target the keyword strategy above, cross-link to each other and to the
app download CTA, carry `BlogPosting`/`HowTo`/`FAQPage`/`BreadcrumbList`
JSON-LD, and are in `sitemap.xml` with hreflang alternates.

### Remaining candidates (next batch)
- "Costco vs [other retailer] Price Match Policy Compared"
- Seasonal: "Costco Black Friday price drops — how to claim them"
- A "which stores offer price adjustments in Canada" roundup (broader net
  than Costco-only, still funnels to the Costco-first app).

Previously deferred per owner decision (2026-06-22); technical SEO (clean
URLs, schema, redirects, font perf) had shipped separately first.
