# Kickstarter campaign: "PriceBack: Your receipts are hiding money. We find it." (v3, 2026-11-02)

Status: **draft, not submitted.** Kickstarter project id `1124340796/1412635062` (Maxim's account), location Ottawa, target launch **Tue 2027-01-12, 9:00 ET**, 30 days. Maxim approves the full preview before *Submit for review*. Identity, bank and tax (Payment tab) are Maxim's own steps.

**Angle (Maxim):** a new Canadian app with a proven, working concept, launching nationwide. Vision: every store with a price-adjustment policy, then Costco in every country it operates in, then each country's local stores. Internal metrics are never published.

## 0. Guard-rails

| Rule | What it means for the copy |
|---|---|
| Never "not released" / "coming soon" | The app is in both stores. Say "new", "proven", "national launch". The *funded end goal* is the expansion (every price-adjustment store, then other countries) and the national launch. Kickstarter requires something new. |
| No "no competitors" | CostPal tracks Costco drops from receipts, including in Canada. Use *"Other trackers watch one store. We're building for all of them."* |
| Backing ≠ investing | Kickstarter bans any financial return, and "invest" invites securities-law trouble in Canada. Use "back", "Founding Backer", "be there at the start". |
| No promised savings | Credits are described by what they cover, never by dollars saved. |
| No fake person names | Example codes use reward prefixes (`KSY…`), never names. |
| Trademarks | Store names as plain text, no logos. Footer: independent, not affiliated with any retailer. |

## 1. How rewards are delivered (built 2026-11-02, branch `feat/partner-code-plan-grant`)

- One **partner** "Kickstarter" in the admin desk. Codes come from `backend/scripts/generate-partner-codes.js`: **unique and random (PREFIX + 8 characters), with a hard use cap:** 1 for a personal reward, N for a group pack (one code, blocked after N).
- A plan reward = a code with `--plan-months N`, granted as a RevenueCat promotional Unlimited (works on every build already in the stores, and never renews). A credit reward = `--credits N`.
- Backers get their codes through the Kickstarter backer survey after the campaign. They redeem in the app's **"Got a code?" field at sign-up**. Existing users get theirs by hand (RevenueCat → grant promotional `unlimited`, or the admin credit grant).
- Prefixes: see the Code column in §3. A group pack is one code with `--uses N`, blocked after N redemptions.

## 2. Goal: CA$10,000

**Why CA$10,000 and not more:**
1. **All or nothing.** Miss the goal and you get $0, so the goal is the minimum that still lets you deliver, not the ambition. There's no ceiling: everything above it is kept.
2. **Kickstarter's algorithm rewards speed.** Being 100% funded in the first hours puts a project on "Popular", in category pages and in Kickstarter's emails, and raises the odds of "Projects We Love". A project stuck at 20% stops being shown.
3. **Benchmarks.** Cook Well's $100K goal had a large YouTube audience behind it; Seedtime's $30K goal had an established audience of gardening students. PriceBack is launching its audience *with* this campaign.
4. **Five figures reads as serious.** CA$10,000 ≈ 220 backers at a ~$45 average pledge. After fees (~5% Kickstarter + ~3–5% payments) about **CA$9,000** lands.

The ambition shows in the stretch goals, up to CA$250K.

## 3. Rewards — APPROVED by Maxim 2026-11-02 (CA$; plans prepaid, never auto-renew; credits never expire)

**Price floor (Maxim): no reward below 60% of PriceBack's real price.** After Kickstarter (~5%) and payment fees (~3–5%), 60% nets about 55% of the app price. App reference: Unlimited $4.99/month or $49.99/year; credits priced at the best pack (1,100 for $10).

| # | Reward | Pledge | Limit | App price | % | Code |
|---|---|---|---|---|---|---|
| 1 | Starter Crate: 750 credits | $5 | — | $6.82 | 73% | `KSC` 1 use |
| 2 | 3-Month Pass | $11 | — | $14.97 | 73% | `KS3M` 1 use |
| 3 | 6-Month Pass | $20 | — | $29.94 | 67% | `KS6M` 1 use |
| 4 | ⚡ VIP Launch Hour: 1 year | $30 | 100, first 48 h | $49.99 | 60% | `KSV` 1 use |
| 5 | 🐦 Super Early Bird: 1 year | $33 | 300 | $49.99 | 66% | `KSSE` 1 use |
| 6 | Credit Crate: 4,000 credits | $25 | — | $36.36 | 69% | `KSC` 1 use |
| 7 | 🐤 Early Bird: 1 year | $36 | 700 | $49.99 | 72% | `KSE` 1 use |
| 8 | Kickstarter Special: 1 year | $40 | — | $49.99 | 80% | `KSY` 1 use |
| 9 | Mega Crate: 10,000 credits | $59 | — | $90.91 | 65% | `KSC` 1 use |
| 10 | Shopping Buddies: 1 code for 2 people, 1 year each | $65 | — | $99.98 | 65% | `KSB` 2 uses |
| 11 | Double Down: 2 years | $69 | — | $99.98 | 69% | `KS2Y` 1 use |
| 12 | 🏆 Founding Member: 3 years + vote on the next store + priority support + thanked by name in an update | $95 | 1,000 | $149.97 | 63% | `KS3Y` 1 use |
| 13 | 🚀 Visionary: 5 years + Founding Member perks | $155 | 500 | $249.95 | 62% | `KS5Y` 1 use |
| 14 | Squad Pack: 1 code for 5 people, 1 year each | $159 | — | $249.95 | 64% | `KSQ` 5 uses |
| 15 | Club Pack: 1 code for 10 people, 1 year each | $309 | 50 | $499.90 | 62% | `KSO` 10 uses |

**Add-ons:** +1 year $35 (70%) · +4,000 credits $25 (69%). **Flash tier** (24 h, ~30 units, one per mid-campaign week): 1 year at $31 (62%).

**Delivery (automatic, nothing manual):** after the campaign, Claude runs `generate-partner-codes.js` per tier (count = backers of the tier, `--uses` = seats) and uploads the CSV to the pledge manager, which sends each backer their own code. A group pack is ONE code capped at its seat count. Codes aren't bound to emails; the parked binding design is in `Technical/Partner_Program.md`.

## 4. Stretch goals (shown at the top of the story, as Seedtime did)

- **$15K**: next store unlocked, chosen by Founding Members.
- **$25K**: two more stores.
- **$40K**: family sharing on Unlimited (backer plans included).
- **$60K**: hourly price checks for every backer.
- **$100K**: every Canadian store with a price-adjustment policy we can track goes on the roadmap.
- **$150K**: 🇺🇸 Costco USA.
- **$250K**: 🌍 Costco worldwide begins: UK, Mexico, Australia, Japan, Korea, Taiwan, Spain, France, Sweden, Iceland, New Zealand, China (order voted by backers).

Community goals: **500 backers** → +250 credits for everyone · **1,500** → 1-year plans become 13 months · **3,000** → +1,000 credits each + live founder Q&A.

## 5. First hours: the plan to be funded on day one

0. **Ride Black Friday (Nov 27) and Boxing Week (Dec 26 →) for the follower list.** Post "Scan your Black Friday / Boxing Day receipts with PriceBack: prices keep dropping after the sale" plus the pre-launch link, in EN + FR, in the deal communities. This is the best moment of the year for the message.
1. **Pre-launch page now.** Kickstarter "Notify me on launch" followers get Kickstarter's own launch email at 9:00. Target **2,000+ followers** by 2027-01-11.
2. **Own audience first.** In-app banner + push + email to current users: "Be a Founding Backer, VIP price for 48 h". They're the warmest audience there is.
3. **Launch squad.** 30–50 people (friends, family, partners, early users) committed to back in the **first 60 minutes**. Early velocity is what the algorithm reads.
4. **VIP Launch Hour tier** (100 × $30, 48 h). Scarcity plus a reason to come at 9:00. Post "VIP 60% gone" mid-morning.
5. **Coordinated 9:05 posts.** r/PersonalFinanceCanada, r/Costco, RedFlagDeals, Costco-Canada and Quebec deal Facebook groups, Instagram and TikTok (07-outreach-kit), in EN + FR.
6. **"Funded in X hours" post** the moment it crosses 100%, then reveal the $15K stretch goal.
7. **Page quality for "Projects We Love":** a 60–90 s founder video, a GIF-rich story (Seedtime used ~145 images), the Kickstarter budget graphic (Funding tab, "increases odds of being featured"), clear risks, replies to every comment within hours.
8. **Weekly rhythm:** one flash tier, one stretch or community goal, one real shopper story (with permission). Update every 2–3 days.
9. **Last 72 h:** Kickstarter reminder emails go to followers; post "last chance at $40 a year".
10. **After the campaign:** Late Pledge on at Kickstarter Special prices.

## 6. Story (Kickstarter Story tab)

> **Stretch goals:** banner image at the top (see §4).

### ⚡ Prices drop after you buy. Every. Single. Week.
You check out. Ten days later, the same item is cheaper. Many stores have a **price-adjustment policy**: bring your receipt back within the window and they refund the difference. Almost nobody claims it, because nobody re-checks every receipt, every day.

**PriceBack does.** Scan your receipt once. We watch every line on it, every day, for your whole adjustment window. When a price drops, your phone lights up with what dropped, by how much, and how many days you have left to claim it.

### 🎄 Bought on Boxing Day? Your window may still be open.
Holiday prices keep moving after the big sales. Many price-adjustment windows run 30 days, so Boxing Week receipts can still be inside theirs when this campaign opens. Scan them now. (Some stores exclude Black Friday or Boxing Week sales from their policy; PriceBack shows each store's rules.)

**Find one $40 price drop and your Kickstarter plan has paid for itself.** One drop on a big-ticket item can pay for years of PriceBack.

> Copy rule (Maxim asked for "users can save 20× what they paid", 2026-11-02): not used as written. It's a savings performance claim, which needs proof under the Competition Act and Kickstarter's rules, and the October data doesn't support it for a typical user. Use the arithmetic line above, or a real anonymized example from prod data once approved.

### 🚀 Brand new. Proven. Ready to go national.
PriceBack is a new Canadian app, and it already works. We built it, tested it on real receipts, and proved the concept: price drops are real, they're frequent, and shoppers are leaving that money on the counter. Now we're launching PriceBack across Canada.

> **If a store will refund you a price drop, PriceBack will watch it for you.**

### 🧭 Other trackers watch one store. We're building for all of them.
Groceries, electronics, home improvement, sporting goods: one app, every receipt, every store with a price-adjustment policy, in English **and** French.

### 🌍 Canada first. Then the world.
Costco alone operates in 14 countries. Our road is simple: **every Canadian store with a price-adjustment policy, then Costco in the USA, then Costco everywhere it operates** (UK, Mexico, Australia, Japan, Korea, Taiwan, Spain, France, Sweden, Iceland, New Zealand, China), **then each country's own stores.** Every backer helps push that map forward, and Founding Members vote on the order.

### 🔍 How it works
1. **Scan** your receipt. 2. **We watch** every item, every day. 3. **Drop?** You get an alert with the amount and the deadline. 4. **Claim** it at the store.

### 🙌 Be there at the start
Every big idea has a moment before everybody knows about it. This is PriceBack's. Picture a couple of years from now: friends at checkout saying *"wait, scan it with PriceBack first."* You'll be able to say you were there on day one, as a **Founding Backer**.

### 🎁 The best price PriceBack will ever have
A year of Unlimited costs $49.99 in the app and **starts at $30 here**, for the first 100 backers. There are no lifetime deals: we're building this to last. Every plan is prepaid and **never renews on its own**. Your reward arrives as a private, single-use code you enter when you create your account.

### 👋 Meet the founder
**[Maxim to write 3–4 sentences, in his own words: who he is, why he built PriceBack, what drives him. Real story only.]**

### 🛠️ Where your support goes
National launch and getting the word out 30% · connecting new stores' price data 30% · servers, receipt reading and price checks at national scale 25% · Kickstarter and payment fees ~10% · reward delivery 5%.

### ⚠️ Risks and challenges
PriceBack works today; the risk is in scaling it. Every store publishes prices differently and changes its website; adding each one takes real engineering, and some may prove impossible to track reliably. If that happens, Founding Members vote on the replacement. International expansion depends on each country's store data and rules. Stores set and can change their own price-adjustment policies: we alert you, and the store decides the refund. We never promise how much you'll save. Rewards are single-use codes delivered within 30 days of the campaign's end.

### 🇫🇷 En français
**PriceBack : vos reçus cachent de l'argent. On le trouve.** Les prix baissent après votre achat. PriceBack surveille chaque article de votre reçu, chaque jour, et vous avertit pour réclamer la différence dans tout magasin qui offre un ajustement de prix. Nouvelle application canadienne, éprouvée, bilingue, lancée partout au Canada, puis Costco partout dans le monde. Soyez parmi les premiers à la soutenir : forfaits prépayés, jamais renouvelés automatiquement, livrés sous forme de code unique.

*PriceBack is independent and not affiliated with or endorsed by any retailer.*

## 7. FAQ
- *Outside Canada?* Not yet; Canadian stores only. The USA is the $150K stretch goal.
- *iPhone or Android?* Both.
- *Charged again?* Never. Every reward is prepaid and does not renew.
- *How do I get my reward?* A private single-use code by email after the campaign, entered when you create your PriceBack account. Already a user? Reply to the survey and we'll add it to your account.
- *Can a code be shared?* A personal code works once. A group code works for exactly the number of people in the pack, then stops.
- *Does PriceBack get the refund for me?* No. The store refunds you under its policy; we tell you when, how much, and how.

## 8. Research: what the $320K+ app campaigns did

| | Seedtime (garden planner) | Cook Well (cooking app, 2026) |
|---|---|---|
| Raised / goal | $341,796 / **$30,000** (1,139%) | $320,368 / **$100,000** (320%), Project We Love |
| Backers / avg pledge | 2,212 / ~$155 | 2,167 / ~$148 |
| Audience | Gardening students and channel | YouTube channel (7 years), cookwell.com launched first |
| Rewards | Waves: VIP Special → Launch Special → Super Early → Early, plus **daily FLASH SALE** and webinar tiers; 3 plan sizes + lifetime | Plain ladder: 3 months $30 → 6 months $48 → 1 year $80 → 2 years $144 (+ lifetime $300, merch) |
| Story | "First … app"; stretch goals at the **top**; "current apps are lacking"; origin story; ~145 images | Problem → frameworks → features → rewards → "Why trust us" (founder) → team → timeline |

What we copy: wave pricing + flash tiers (Seedtime), a simple time ladder + a founder trust section (Cook Well), stretch goals up top, heavy visuals, and a high-value top tier to lift the average pledge (our 5-year and group packs replace their lifetime tiers).

## 9. Forecast: what to really expect (2026-11-02)

**Assumptions.** Average pledge ~CA$45 (1-year tiers at $30–40 dominate, lifted by the packs). Day-1 conversion of Kickstarter pre-launch followers is usually cited at 10–30%. Kickstarter's own traffic adds roughly 20–30% on top of what the creator brings, but only for a project that is trending. Technology/Apps is one of Kickstarter's weakest categories: roughly 1 in 5 projects fund. PriceBack has no large existing audience. Cook Well and Seedtime each brought one (a YouTube channel, a teaching audience), and that audience is the main reason they reached $320K+.

| Scenario | What has to happen | Backers | Pledged (CA$) | Net after fees | Outcome |
|---|---|---|---|---|---|
| **Pessimistic** | < 500 pre-launch followers; the in-app push and posts get little traction; no viral post | 60–150 | $3K–7K | **$0**: goal missed, all or nothing | Fails, but the page + video stay reusable for a relaunch |
| **Realistic** | 1,000–1,500 followers; current users respond to the in-app push; Reddit/RFD posts land moderately | 250–450 | $11K–20K | $10K–18K | Funded on day 2–7 (not in hours); first stretch goal ($15K) likely |
| **Optimistic** | 3,000+ followers; one viral post ("Costco owes you money" style) or a creator/media mention; Projects We Love | 900–2,000 | $40K–90K | $36K–82K | Funded in hours; trending; several stretch goals |
| **Breakout** (< 5%) | National media consumer segment (CBC/CTV) or a large creator during the campaign | 3,000+ | $150K+ | — | Costco USA stretch goal in play |

**Users gained** ≈ backers × ~1.2 (group packs add seats), plus non-backers who discover the app through the campaign and install it free. In the realistic case: ~300–550 committed users and several thousand page visitors.

**Decision gate (protects against the pessimistic case).** "Funded in the first hours" means ~220 backers by early afternoon on launch day, which needs ~1,100+ followers at a 20% day-1 conversion. **Check on 2027-01-05:** if the pre-launch page has fewer than ~1,000 followers, postpone the launch by 2–4 weeks and keep building the list. Launching early into a slow start is the most common way a project that could have funded fails.

## 10. Option C timing (Maxim, 2026-11-02): launch Tue Nov 10, 28 days → ends Tue Dec 8

Backers get their codes Dec 9–10, while Black Friday receipts (Nov 27) are still inside a 30-day window and before Boxing Day. Kickstarter pays out ~14 days after the end, so **about Dec 22, before 2026 ends**. Goal **CA$5,000** (no time to build a pre-launch list, so a lower goal makes funding far more likely; there's no ceiling). Reward delivery: **December 2026**.

## 11. Drafts for Maxim's review: founder paragraph, creator bio, AI disclosure

**Founder paragraph (Story → "Meet the founder")**: v2, Maxim's facts, 2026-11-02. No city of residence or building is named, by Maxim's choice.
> I'm Maxim Lucas. I lived in France before moving to Canada a few years ago, and in both countries I saw the same thing: prices change after you've paid, and when they drop inside the store's price-adjustment window, that difference is yours to claim. But nobody has the time or the tools to re-check every receipt, at every store, every day. In Montréal, Laval, Québec City, Lévis, Sherbrooke, Trois-Rivières, Bromont and Toronto, I kept hearing people complain about exactly that. So I built an app that does the checking for you. PriceBack reads your receipt, watches every item through its window, and tells you the moment you can claim money back. It's made in Canada, in English and French, and it already works on real receipts. Now I want to put it in every Canadian pocket, and then take it everywhere Costco goes. Back it, and you're with me from day one.

**Creator bio (People tab, ≤300 characters)**
> Founder of PriceBack, the Canadian app that watches your receipts and tells you when to claim a price drop. From France to Québec and Ontario, I heard the same complaint everywhere: prices drop after you pay, and nobody has time to check.

**AI disclosure (short form, Maxim's choice)**
- *Does the project use AI?* **Yes.**
- *How:* PriceBack uses OCR and AI to read receipts and match prices. Your data is protected and stays yours: we never sell it, and you can delete all of it yourself, anytime, from the app.
- *The campaign:* the page text was drafted with the help of an AI assistant and approved by the creator. The video recreates the app's real screens from its own design; no imagery is AI-generated.

**Project location:** "Canada" if Kickstarter allows a country-level location; otherwise the city stays hidden from the story and bio. Maxim asked that no city be named.

## 12. Video: real footage only (Maxim, 2026-11-02)

- **Real UI, recreated from code** (Maxim, 2026-11-02: the emulator is too slow on his machines): screens rebuilt from the app's own theme colours, BrandMark logo, i18n strings and screen layouts, then rendered frame by frame to MP4. They are not invented designs.
- **Receipt:** a generic sample receipt (not Maxim's) with every item masked; only the printed "COSTCO WHOLESALE" header, a date and the total are visible. No Costco logo artwork: it's a registered trademark and a takedown risk.
- **Real big numbers** (Costco savings caught by PriceBack's daily harvest, public price data): Samsung QN80H TV **$600 off on Oct 26** (then $500 Oct 27–29 and Oct 31–Nov 5); Samsung S85H OLED **$500 off Oct 26–29**; Generac Guardian generator **$1,000 off Oct 26–Nov 8**. Wording: "Costco took $600 off this TV on October 26. PriceBack caught it the same day." The data shows one day at $600, not 48 hours.
- **Real grocery drops:** anonymized, product + before/after price only, never another user's receipt or identity.
- **Not used (refused):** fabricated price drops presented as real results. That's deceptive under the Competition Act and Kickstarter's rules.
