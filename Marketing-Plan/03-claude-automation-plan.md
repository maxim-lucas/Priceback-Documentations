# Claude + MCP Automation Plan

Goal: Claude (this assistant, in scheduled/agentic sessions) plans, generates, and publishes social content with minimal manual steps, using MCP servers as the connective tissue to the platforms and asset tools.

## Why MCP instead of native platform APIs directly

Instagram/TikTok/Facebook don't expose Claude-native integrations, and their raw Graph/TikTok APIs require an approved developer app + review process per platform (slow, and TikTok's posting API has stricter approval gates than Meta's). The pragmatic path is a **social-scheduling aggregator that already has an MCP server or a stable REST API Claude can call**, so we don't have to individually pass platform app review before we can post anything.

### Recommended stack (in priority order)

1. **Ayrshare** — has a documented MCP server (`@ayrshare/mcp-server` style integration) and a single API key that posts to Instagram, TikTok, Facebook, and others. This is the fastest path to "Claude can post today" because Ayrshare already holds the platform API approvals; you connect your own IG/TikTok/FB accounts to your Ayrshare account once, and every post after that is one API/MCP call. **Recommended starting point.**
2. **Zapier MCP server** (official, exists today) — if Ayrshare setup stalls, Zapier already has Instagram/Facebook/TikTok "create post" actions and an official MCP server Claude can call directly. Slightly clunkier for TikTok (fewer native triggers) but zero custom infra.
3. **Buffer or Late (getlate.dev)** — both have public REST APIs with scheduling; no first-party MCP server as of this writing, but a thin custom MCP wrapper (see below) is a half-day build if Ayrshare/Zapier don't fit.
4. **Custom MCP server (fallback/long-term)** — once volume justifies it, build a small in-house MCP server wrapping Meta Graph API (IG + FB) and TikTok Content Posting API directly, for full control and no per-post fee. This is the eventual end-state once we're posting daily and want no vendor lock-in — not a v1 requirement.

**Action needed from Maxim:** create an Ayrshare account (or confirm Zapier as first choice), link the `priceback.ca` Instagram + TikTok + Facebook accounts to it, and share the API key so it can be configured as an MCP server connection. This is the one manual bootstrap step; everything downstream is automatable.

## Content generation pipeline (what Claude actually does end-to-end)

1. **Data sourcing** — Claude pulls real content fuel from the product itself:
   - Weekly flyer price drops from the flyer-scan pipeline ([[flyer-scan-multipage-national]]) for "biggest drops this week" content.
   - Aggregate, anonymized refund stats (total $ returned to users, top items) via a read-only admin query — never individual user data without consent.
2. **Script + copy generation** — Claude drafts the hook, caption, and on-screen text per the pillars in [02-social-media-strategy](02-social-media-strategy.md), following the voice guide.
3. **Visual asset generation** — for carousels/static posts, Claude generates the graphic directly (HTML/SVG template → rendered image, consistent with brand system in [[brand-mark-and-startup-v2]]/BrandMark components) so all content matches in-app branding. For video, Claude can drive `claude-in-chrome`-based screen recordings of the actual app flow (real refund notification firing) as the "proof of refund" b-roll, then a lightweight external tool (e.g. CapCut/Canva via browser automation, or a text-to-video MCP once available) adds captions/music.
4. **Review gate (human-in-the-loop, at least initially)** — draft posts land in a `content-queue/` folder in this repo (or a Slack/Drive doc) for Maxim to approve before they go live, until trust is established. This can be relaxed to full autonomy once cadence and quality are proven — flag this as a decision point, don't auto-relax it silently.
5. **Publish via MCP** — approved post → Ayrshare (or chosen tool) MCP call → goes out to IG/TikTok/FB simultaneously with platform-appropriate formatting.
6. **Scheduling** — use the `/loop` or `/schedule` Claude Code capability (cron-based scheduled agent runs) to run this pipeline on a recurring cadence (e.g. daily at a fixed time) so posting doesn't require Maxim to trigger it manually each day.
7. **Performance feedback loop** — weekly, Claude pulls basic engagement metrics (via the same MCP aggregator's analytics endpoints where available) and folds "what worked" back into the next week's content choices — logged in [05-launch-calendar](05-launch-calendar.md) as a running notes section, not a separate memory.

## Guardrails

- No content states or implies a guaranteed refund amount (compliance — see [[price-drop-commission-and-policy-status]]).
- No UGC reposted without explicit consent captured in-app or via DM reply.
- No customer data (names, receipt contents, exact purchase details) in public content beyond what the user themselves shared/consented to.
- Human review stays on until Maxim explicitly says to go fully autonomous.

## Immediate next steps (this week)

- [ ] Maxim: create Ayrshare account, connect `priceback.ca` IG + TikTok (+ Facebook if used), get API key.
- [ ] Configure Ayrshare MCP server connection in Claude Code.
- [ ] Claude: produce first batch of 5 pieces of content (mix of pillars) as drafts in a new `content-queue/` folder for review.
- [ ] Set up a daily/weekly scheduled agent run via `/schedule` once the pipeline above is validated manually once.
