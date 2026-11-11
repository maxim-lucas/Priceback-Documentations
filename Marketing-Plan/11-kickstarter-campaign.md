# Kickstarter campaign: "PriceBack: Your receipts are hiding money. We find it." (v4, 2026-11-03)

> **Superseded timing (2026-11-11):** the project was approved on 2026-11-10 and NOT launched. Launch plan, date and the road to CA$500K: [12-kickstarter-launch-plan.md](12-kickstarter-launch-plan.md).

Status: **draft complete, not submitted (2026-11-03).** Kickstarter project id `1124340796/1412635062` (Maxim's account). Every required tab is green: Basics, Funding, Rewards, Story, People, Payment. Maxim reviews the preview, then clicks *Submit for review* himself (1–3 business days). The pre-launch page can only be activated **after** approval.

**Timing (Maxim, 2026-11-03):** launch **Tue 2026-11-10 at 10:00 ET** (Maxim clicks *Launch*: Kickstarter can't schedule it) → fixed end **Tue 2026-12-08 at 21:00 ET** (stored `deadline=2026-12-08T21:00:00-05:00`). The end is in the evening, so the last-hours rush happens when people are home on both coasts. Goal CA$5,000; payout ~Dec 22.

**What's on the draft (2026-11-03):**
- Creator name **Maxim Lucas** (Maxim's choice; can't change after launch). Payment profile: Business.
- Project and profile location: **Ottawa, Canada**. Kickstarter only offers cities; Maxim confirmed Ottawa. The story and bio name no city of residence.
- Profile: the PriceBack app icon as avatar (Maxim), bio from §11, website priceback.ca. The **vanity URL is not set**: Kickstarter makes it permanent, so Maxim decides (`priceback` is the suggestion).
- Project image: the two-phone still (TV +$500 / $547 to claim) rendered from the video scene with no captions (`scratchpad cover2.js`; source `sm-content/12-kickstarter/scenes/app-recording.html`, t=37 and t=43.5).
- Project video: `priceback-kickstarter-16x9-en.mp4` v6 (44.6 s). Discovery Mode: `priceback-kickstarter-9x16-en.mp4`.
- Story = §6 below, as published. Risks = §6 "Risks and challenges". AI = §11 (updated for the AI voice).
- Preferences, "Pledge Over Time" (pledges of CA$175+ paid in 3 parts, paid out over ~12 weeks): **not set.** Recommendation: **No**, so all the money lands in December.
- Preview shows every reward under "All gone": that's how a project that hasn't launched looks in preview. All 15 tiers are unlimited or capped as in §3.

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

## 6. Story (Kickstarter Story tab): as published on the draft, 2026-11-03

Changes from the v3 draft, for Maxim's review:
- **Boxing Day → Black Friday**, because the campaign now runs Nov 10 → Dec 8.
- **Honesty line.** "Today, PriceBack watches Costco Canada… Next: Best Buy, Home Depot, Rona, Sport Chek". The app lists those four as "Coming soon"; the old line read as if every store were live.
- **New "Every price drop in our video is real" section**, matching the v6 voice-over.
- **The §7 FAQ is folded into a "Questions" section** at the end.
- **The 🇺🇸 / 🇫🇷 flag emojis are removed**: Windows shows them as "US" / "FR" letters.

Editor: CKEditor 5 (h3 = Heading, h4 = Subheading, bold, italic, lists, links, images). The text was set with `editor.setData(html)`. The source HTML is in the session scratchpad (`story/story-en.html`).

**Intro.** **PriceBack watches your receipts and tells you when a price drops, so you can claim the difference.** It's a new Canadian app, in English and French, on iPhone and Android. This campaign launches it across Canada, then beyond.

### 🎯 Stretch goals
- **CA$15,000:** the next store is unlocked, chosen by Founding Members.
- **CA$25,000:** two more stores.
- **CA$40,000:** family sharing on Unlimited (backer plans included).
- **CA$60,000:** hourly price checks for every backer.
- **CA$100,000:** every Canadian store with a price-adjustment policy we can track goes on the roadmap.
- **CA$150,000:** Costco USA.
- **CA$250,000:** 🌍 Costco worldwide begins: UK, Mexico, Australia, Japan, Korea, Taiwan, Spain, France, Sweden, Iceland, New Zealand and China, in the order backers vote for.

**Community goals:** 500 backers → +250 credits for everyone · 1,500 backers → every 1-year plan becomes 13 months · 3,000 backers → +1,000 credits each and a live Q&A with the founder.

### ⚡ Prices drop after you buy. Every. Single. Week.
You check out. Ten days later, the same item is cheaper. Costco and many other stores have a **price-adjustment policy**: bring your receipt back within the window (30 days at Costco) and they refund the difference. Almost nobody claims it, because nobody re-checks every receipt, every day.

**PriceBack does.** Scan your receipt once, paper or PDF. We watch every line on it, every day, for your whole adjustment window. When a price drops, your phone lights up with what dropped, by how much, and how many days you have left to claim it.

### 🎥 Every price drop in our video is real
The video shows PriceBack's real screens with real Costco Canada prices from October 2026. A $497 grocery run at a Costco Business Centre: six days later, five real price drops, **$47 to claim**. A Samsung TV bought two weeks earlier and uploaded today: minutes later, **$500 to claim**. Had that receipt been uploaded on the day of purchase, PriceBack would also have caught the TV's one-day flash sale: $600 off. The receipts in the video are masked.

### 🛍️ Black Friday is coming. Prices keep moving after it.
Holiday prices keep changing after the big sales. Costco's price-adjustment window is 30 days, so a receipt from Black Friday (November 27) is still inside its window when backer codes go out in December. Scan your holiday receipts and let PriceBack watch them. (Some stores exclude certain sale events from their policy; PriceBack shows each store's rules.)

**Find one $40 price drop and your Kickstarter plan has paid for itself.** One drop on a big-ticket item can pay for years of PriceBack.

> Copy rule (Maxim asked for "users can save 20× what they paid", 2026-11-02): not used as written. It's a savings performance claim, which needs proof under the Competition Act and Kickstarter's rules, and the October data doesn't support it for a typical user. Use the arithmetic line above, or a real anonymized example from prod data once approved.

### 🚀 Brand new. Proven. Ready to go national.
PriceBack is a new Canadian app, and it already works. We built it, tested it on real receipts, and proved the concept: price drops are real, they're frequent, and shoppers are leaving that money on the counter. Now we're launching PriceBack across Canada.

**If a store will refund you a price drop, PriceBack will watch it for you.**

### 🧭 Other trackers watch one store. We're building for all of them.
Today, PriceBack watches **Costco Canada**: warehouses and Business Centres, in store or online. Next on the list: Best Buy, Home Depot, Rona and Sport Chek, each with its own price guarantee. Groceries, electronics, home improvement, sporting goods: one app for every receipt, in English **and** French.

### 🌍 Canada first. Then the world.
Costco alone operates in 14 countries. Our road is simple: **every Canadian store with a price-adjustment policy, then Costco in the USA, then Costco everywhere it operates** (UK, Mexico, Australia, Japan, Korea, Taiwan, Spain, France, Sweden, Iceland, New Zealand, China), **then each country's own stores.** Every backer helps push that map forward, and Founding Members vote on the order.

### 🔍 How it works
1. **Scan** your receipt, paper or PDF. PriceBack reads every item and the warehouse it came from.
2. **We watch** every item, every day, for the whole adjustment window.
3. **Drop?** You get an alert with the amount and the deadline.
4. **Claim** it: show your receipt at the store and get the difference back.

### 🙌 Be there at the start
Every big idea has a moment before everybody knows about it. This is PriceBack's. Picture a couple of years from now: friends at checkout saying *"wait, scan it with PriceBack first."* You'll be able to say you were there on day one, as a **Founding Backer**.

### 🎁 The best price PriceBack will ever have
A year of Unlimited costs $49.99 in the app and **starts at CA$30 here**, for the first 100 backers in the first 48 hours. There are no lifetime deals: we're building this to last. Every plan is prepaid and **never renews on its own**, and credits never expire. Your reward arrives as a private code you enter when you create your PriceBack account. A group pack is one code that works for exactly the number of people in the pack.

### 👋 Meet the founder
Founder paragraph v2 (§11), verbatim.

### 🛠️ Where your support goes
- National launch and getting the word out: 30%
- Connecting new stores' price data: 30%
- Servers, receipt reading and price checks at national scale: 25%
- Kickstarter and payment fees: about 10%
- Reward delivery: 5%

### ❓ Questions
- **Outside Canada?** Not yet: Canadian stores only for now. The USA is our CA$150,000 stretch goal.
- **iPhone or Android?** Both.
- **Will I be charged again?** Never. Every reward is prepaid and doesn't renew.
- **How do I get my reward?** After the campaign, the Kickstarter backer survey sends you a private code. Enter it when you create your PriceBack account. Already a PriceBack user? Tell us in the survey and we'll add it to your account.
- **Can a code be shared?** A personal code works once. A group code works for exactly the number of people in the pack, then stops.
- **Does PriceBack get the refund for me?** No. The store refunds you under its own policy; PriceBack tells you when, how much, and how to claim.
- **What about my data?** PriceBack uses OCR and AI to read receipts and match prices. Your data stays yours: we never sell it, and you can delete all of it yourself, anytime, from the app.

### En français
**PriceBack : vos reçus cachent de l'argent. On le trouve.** Les prix baissent après votre achat. Numérisez votre reçu une fois, papier ou PDF : PriceBack surveille chaque article, chaque jour, pendant toute la période d'ajustement de prix, et vous avertit dès que vous pouvez réclamer la différence. Aujourd'hui chez Costco Canada (entrepôts et centres d'affaires, en magasin ou en ligne), ensuite dans tous les magasins canadiens qui offrent un ajustement de prix, puis chez Costco partout dans le monde. Nouvelle application canadienne, en français et en anglais, sur iPhone et Android. Soyez parmi les premiers à la soutenir : forfaits prépayés, jamais renouvelés automatiquement, livrés sous forme de code privé.

*PriceBack is independent and not affiliated with or endorsed by any retailer. Store names are used only to describe their price-adjustment policies.*

### ⚠️ Risks and challenges (separate field)
PriceBack works today; the risk is in scaling it. Every store publishes prices differently and changes its website; adding each one takes real engineering, and some may prove impossible to track reliably. If that happens, Founding Members vote on the replacement. International expansion depends on each country's store data and rules. Stores set and can change their own price-adjustment policies: we alert you, and the store decides the refund. We never promise how much you'll save. Rewards are private codes sent through the Kickstarter backer survey in December 2026, after the campaign ends; there is nothing to manufacture or ship.

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

**As filed on Kickstarter (Story tab → Use of AI, 2026-11-03).** Answer: **Yes**. Boxes ticked: "I plan to use AI-generated content" and "I am incorporating AI in my project in another way". Not ticked: "seeks funding for AI technology".
- *What parts use AI-generated content:* only two parts of the campaign page; nothing in the rewards. (1) The video narration is Maxim's own voice, generated with an open-source AI voice tool from his recordings and checked word by word against the approved script. (2) The page text was drafted with an AI writing assistant, then edited and approved by the creator. No imagery is AI-generated: the video recreates the real screens from the app's design and code, with real Costco price data.
- *Consent:* yes for everything we provide. The voice is the creator's own, used for his own project, and the script and facts are ours. We trained no model. For the third-party models' training data, we rely on their providers' published licences and terms (the voice tool is MIT-licensed open source).
- *Other AI:* the short form above (OCR and AI read receipts and match prices; data never sold; users delete it themselves).
- **Why the voice line was added:** the v1 disclosure was approved before the narration became an AI-generated voice (2026-11-02, after the draft). Kickstarter's AI policy covers the page itself, so the voice has to be declared.

**Project location:** Kickstarter accepts only a city, never a country alone. **Ottawa, Canada** on both the project and the profile (Maxim, 2026-11-03). The story and bio still name no city of residence.

## 12. Video: real footage only (Maxim, 2026-11-02)

- **Real UI, recreated from code** (Maxim, 2026-11-02: the emulator is too slow on his machines): screens rebuilt from the app's own theme colours, BrandMark logo, i18n strings and screen layouts, then rendered frame by frame to MP4. They are not invented designs.
- **Receipt:** a generic sample receipt (not Maxim's) with every item masked; only the printed "COSTCO WHOLESALE" header, a date and the total are visible. No Costco logo artwork: it's a registered trademark and a takedown risk.
- **Real big numbers** (Costco savings caught by PriceBack's daily harvest, public price data): Samsung QN80H TV **$600 off on Oct 26** (then $500 Oct 27–29 and Oct 31–Nov 5); Samsung S85H OLED **$500 off Oct 26–29**; Generac Guardian generator **$1,000 off Oct 26–Nov 8**. Wording: "Costco took $600 off this TV on October 26. PriceBack caught it the same day." The data shows one day at $600, not 48 hours.
- **Real grocery drops:** anonymized, product + before/after price only, never another user's receipt or identity.
- **Not used (refused):** fabricated price drops presented as real results. That's deceptive under the Competition Act and Kickstarter's rules.
