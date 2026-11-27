# 14 — New-version launch: two campaigns, the free tools and the receipt scanner

**Asked by Maxim, 2026-11-27:** *"create the new previews for the applestore and google play store but also the new
version launch content for instagram and facebook … a very good poster to be advertised in Meta Ads Campaign and maybe
also in Google Ads … inspired by the same design style for the onboarding screens … include Promo Code: Black … brainstorm
first to find the best angle and the more viral angle … people always asking in groups did anyone see a product, did
anyone know if this saving is available in a warehouse, where can i find this product and what is the price in
warehouse, when this product will be in stock"*.

**Revised the same day (Maxim):** *"it makes the audience think it is paid only or it is free, only the scan a receipt
is paid … warehouse prices tools and savings should be a campaign and the scanner + code in another campaign. you have
to mention that it is free. xray is refused"*. One poster that mixed the free tools, the paid scanner and a promo code
told the viewer two things at once. Now:

| | Campaign 1: **Free tools** | Campaign 2: **Receipt scanner + BLACK** |
|---|---|---|
| Says | "Stop asking the group. Ask PriceBack." **100 % free, no credit card** | "Bought it. Then it dropped? Get the difference back." **Start free**, code BLACK |
| Shows | Deals + Warehouse prices + last known stock (Costco) | Receipt scan, price-drop alerts (Costco + Best Buy) |
| Never mentions | The scanner, credits, the code, the trial | Nothing hidden: the free start and the code are the offer |
| Role | Cold audiences, installs, home warehouse set | Retargeting (installed, no receipt) + cold "bought it" audiences |
| Creatives | `launch-2026-12/free/{en,fr}/` | `launch-2026-12/scan/{en,fr}/` |

**Status:** creatives rendered (EN + FR, 4:5, 9:16, 1:1 for each campaign; store screenshots 1–2). Nothing posted,
nothing uploaded. Post and spend only once the build is live in **both** stores.

Source: `launch-2026-12/source/creatives.html`, render with `?c=free|scan&f=poster|story|square|store1|store2&lang=en|fr`
(1080×1350, 1080×1920, 1080×1080, 1320×2868). The current store set in [`app-store-screenshots/`](app-store-screenshots/)
stays live until the new set is finished and approved.

---

## 1. What is true (every piece of copy stays inside this box)

| Claim | Fact | Source |
|---|---|---|
| Stores | Costco Canada and Best Buy Canada (Best Buy goes live with this build) | `SlideStep.slideStores` |
| **Free** | Deals (savings in every Canadian warehouse, Business Centres included, last known stock), Warehouse prices, Purchases, the personalised home | Maxim, 2026-11-27 |
| **Paid** | Receipt scan (price-drop alerts), Price Checker, Email sync | Maxim, 2026-11-27 |
| Sign-up offer | **1 week of Unlimited free** (then $4.99/month, cancel anytime) **or 75 free credits** (no card). Only for accounts created on the new build | `trialChoice.*`, `Technical/Promo_Codes_Design.md` |
| Code **BLACK** | **+20 % bonus credits** on any credit pack, or **20 % off the first Unlimited payment** (first month / first year). Valid **until 2026-12-31**. On iPhone it is an Apple offer code: **new subscribers only, Canada only** | `Technical/Promo_Codes_Design.md` |
| Stock | "Last known stock", never "live stock" or "in stock now" | `browse.stockInToday` ("In stock · updated today") |

Never: a dollar figure as a promise (label every amount "Example"), "guaranteed refund", "no ads ever", a retailer logo
or its colours, and **never promise a Black Friday price adjustment** (stores exclude those periods:
`Technical/Store_Policy_Calendar.md`). Campaign 1 never says "free" next to a paid feature; campaign 2 says "start
free", never "free" alone.

---

## 2. The brainstorm

### The insight

Canadian Costco groups (Facebook, Reddit, Instagram comments) are a public queue of the same questions, and under every
one sits a wall of people commenting **"following"** because they want the answer too. Each question maps to a screen
the new build already has:

| What the group asks | The answer in PriceBack | Campaign |
|---|---|---|
| "Has anyone seen X on sale at their warehouse?" | **Deals**: every saving, every warehouse, Business Centres too | 1 (free) |
| "What's the price of X at Laval / Burnaby?" | **Warehouse prices**: any warehouse you pick, by name or item number | 1 (free) |
| "Is it back in stock? Did anyone see it today?" | **Last known stock** on every Deals and Warehouse-prices row | 1 (free) |
| "I bought it last week and now it's on sale, can I get the difference?" | **Scan the receipt**: we watch every item and say what to claim, how much, by when | 2 (start free, BLACK) |

### Angles considered

Scored 1–5 on *thumb-stop*, *shareability*, *truth* (inside §1) and *conversion path*.

| # | Angle | Thumb-stop | Share | Truth | Path | Verdict |
|---|---|---|---|---|---|---|
| A | **"Stop asking the group. Ask PriceBack."** The group post + the "following" wall, answered by a PriceBack card | 5 | 5 | 5 | 5 | **Campaign 1** |
| B | **"Bought it. Then it dropped? Get the difference back."** (the receipt scan, loss aversion) | 4 | 3 | 4 | 4 | **Campaign 2** |
| C | "Not a flyer. Every warehouse, live." (against the flyer re-posters) | 3 | 3 | 5 | 4 | Carousel slide in campaign 1 |
| D | "Your Costco, made for what you buy." (personalisation) | 2 | 2 | 5 | 3 | Store screenshot only |
| E | "Black Friday receipts: watch them." | 4 | 3 | **2** | 4 | Rejected: risks promising adjustments stores refuse |
| F | "Comment 'following' if…" engagement bait | 5 | 5 | 5 | 2 | Organic only (Meta down-ranks bait in ads) |

### Why two campaigns, and why A leads

1. **One message per ad.** Free tools, a paid scanner and a promo code on one poster read as "is it free or not?".
   Split, each ad answers that in a word: campaign 1 says FREE, campaign 2 says START FREE + BLACK.
2. **A mirrors a behaviour, not a feature.** People don't search for "price tracking app"; they post in the group. The
   "following 👀" comments are an inside joke every group member gets in half a second.
3. **The free campaign fixes the biggest leak.** The Conversion analysis (2026-10-29) found **74 % of sign-ups never
   scan a receipt**. Campaign 1 brings people in for free answers with nothing to pay and nothing to scan; campaign 2
   then retargets those installs with the scanner. The funnel: *free answer → home warehouse set → "Bought before" chips
   → campaign 2 → first receipt → free week or 75 credits → BLACK on the first purchase.*
4. **Both are timely.** Black Friday week: the groups are at their busiest, and BLACK expires Dec 31, a real deadline.

---

## 3. The creative system (taken from the onboarding slides)

The onboarding slides (`src/screens/onboarding/SlideStep.js`): a coloured stage with soft glow circles, a tilted object,
a dark floating pill over it, then an Inter Tight 800 title with tight tracking. Both campaigns keep that grammar and
share the bottom half, so they read as one launch:

| Onboarding | Campaign 1 (free) | Campaign 2 (scan) |
|---|---|---|
| Tilted receipt (−4°), slide A | The group post, tilted −3° | The Costco receipt (−4°) and a Best Buy receipt behind it, the bought line in lime |
| Floating ink pill "Watching 14 items" | The PriceBack answer card (+2°) with **Answered** and **Free** chips | The same pill, verbatim |
| Price-drop notes + big lime amount, slide B | — | Two notes (Best Buy faded, Costco in front) and the ink "+$170.00" block |
| Ink panel, lime second line | Same | Same |
| A receipt stub (perforation, notches) | **FREE** stub: "Savings + warehouse prices · No credit card needed" | **BLACK** stub: "+20 % bonus credits · until Dec 31" |
| Primary button | "Download free" + "Free on iPhone and Android. No credit card." | "Start free" + "1 week of Unlimited or 75 free credits" |

Tokens: bg `#eef5f1`, ink `#0d3d28`, accent `#10b981`, accentInk `#15803d`, lime `#bef264`
(`src/components/spaces/tokens.js`). Fonts: Inter Tight, Plus Jakarta Sans, IBM Plex Mono (the stubs and receipts).

---

## 4. Deliverables

### Rendered (EN + FR)

| Folder / file | Size | Use |
|---|---|---|
| `free/*/meta-feed-4x5.png`, `scan/*/meta-feed-4x5.png` | 1080×1350 | Meta feed ads (FB + IG), organic launch posts |
| `free/*/meta-story-9x16.png`, `scan/*/…` | 1080×1920 | Stories / Reels. Content kept between y 250 and 1640; the bottom is left for the platform's button |
| `free/*/feed-square-1x1.png`, `scan/*/…` | 1080×1080 | Feed alternative, Google Display / Demand Gen square |
| `store/en/01-deals`, `store/fr/01-rabais` | 1320×2868 | App Store 6.9" slot 1 (Play takes the same file) |
| `store/en/02-warehouse-prices`, `store/fr/02-prix-en-entrepot` | 1320×2868 | Store slot 2 |

Store slots 1–2 carry a lime **Free** chip beside the logo: the two screens they show are free.

### Still to make, once approved

**Store screenshots 3–10 (EN + FR).** The free screens first, then the paid ones; no code, no trial wording (§6).

| # | Headline EN | Headline FR | Screen | Free chip |
|---|---|---|---|---|
| 1 | Is it on sale at my warehouse? **Now you know.** | En rabais à mon entrepôt? **Là, vous le savez.** | Deals ✅ | ✅ |
| 2 | What does it cost **at that warehouse?** | Combien ça coûte **à cet entrepôt?** | Warehouse prices ✅ | ✅ |
| 3 | Back in stock? **See it before you drive.** | De retour en stock? **Vérifiez avant de partir.** | A row's stock line, close up | ✅ |
| 4 | Made for **what you buy.** | Fait pour **ce que vous achetez.** | Home with "Bought before" | ✅ |
| 5 | Bought it? **Get the drop back.** | Déjà acheté? **Récupérez la baisse.** | Receipt scan → watching N items | — |
| 6 | The moment it drops, **you know.** | Dès que le prix baisse, **vous le savez.** | Price-drop push (onboarding slide B) | — |
| 7 | Claim it at the desk **in minutes.** | Réclamez au comptoir **en quelques minutes.** | Claim card (onboarding slide C) | — |
| 8 | Costco **and Best Buy.** One app. | Costco **et Best Buy.** Une seule app. | Store spaces (onboarding slide E) | — |
| 9 | Scan a barcode. **See everything.** | Scannez un code-barres. **Voyez tout.** | Price Checker (name pending, §7) | — |
| 10 | Private by design. Independent. | Privé dès la conception. Indépendant. | Disclaimer slide (keep the current one) | — |

**Google Play feature graphic** (1024×500): campaign 1's headline and answer card, no code.

**Campaign 1 carousel "Group questions, answered"** (1080×1350, 5 slides): the hero; then one question per slide (sale
at my warehouse, price at another warehouse, back in stock) with its answer card and the FREE stub; last slide
"Every saving. Every warehouse. Free." with the download button.

**Campaign 1 Reel (15–20 s):** 0–3 s scroll a group post and the "following" wall (notification pings); 3–5 s "64
people are waiting for an answer"; 5–12 s open PriceBack → Deals → pick the warehouse → the row with stock; 12–16 s
"Stop asking the group. Ask PriceBack."; 16–20 s FREE stub + store badges.

**Campaign 2 Reel (15–20 s):** a receipt on the counter → scan → "Watching 14 items" → a week later the push
"Price drop! +$120" → the claim card at the desk → BLACK stub + "Start free". Label amounts "Example".

---

## 5. Ad copy

### Campaign 1 — Free tools (cold audiences)

**1a — The group.**
- Primary text EN: *"Has anyone seen it on sale at their warehouse?" … "following 👀" … Skip the 64 comments.
  PriceBack shows every Costco saving and shelf price, in every Canadian warehouse (Business Centres too), with the
  last known stock. 100% free. No credit card.*
- FR: *« Quelqu'un l'a vu en rabais à son entrepôt? » … « Suivi 👀 » … Passez les 64 commentaires. PriceBack montre
  tous les rabais et prix Costco, dans chaque entrepôt au Canada (Centres d'affaires inclus), avec le dernier stock
  connu. 100 % gratuit. Aucune carte de crédit.*
- Headline: *Stop asking the group. Ask PriceBack.* / *Fini de demander au groupe. Demandez à PriceBack.*
- Description: *Free on iPhone and Android* / *Gratuit sur iPhone et Android*

**1b — The stock run.** *Driving 40 minutes for something that's sold out? Check the last known stock at any Canadian
warehouse first. Free in PriceBack, no credit card.* / *Faire 40 minutes de route pour un article en rupture? Vérifiez
le dernier stock connu à n'importe quel entrepôt au Canada. Gratuit dans PriceBack, aucune carte de crédit.*

**1c — Not a flyer.** *Not a flyer. Every Costco saving running right now, at your warehouse and every other one in
Canada, with the regular price beside it. Free.* / *Pas une circulaire. Tous les rabais Costco en cours, à votre
entrepôt et dans tous les autres au Canada, avec le prix régulier à côté. Gratuit.*

### Campaign 2 — Receipt scanner + BLACK (retargeting first)

**2a — Bought it.** *Bought it last week and now it's on sale? Scan your Costco or Best Buy receipt: PriceBack watches
every item and tells you what to claim, how much, and by when. Start free with 1 week of Unlimited or 75 free
credits. 🎟 Code BLACK: +20% bonus credits, until Dec 31.*
FR: *Acheté la semaine passée et maintenant en rabais? Numérisez votre reçu Costco ou Best Buy : PriceBack surveille
chaque article et vous dit quoi réclamer, combien et avant quelle date. Commencez gratuitement avec 1 semaine
d'Unlimited ou 75 crédits gratuits. 🎟 Code BLACK : +20 % de crédits bonis, jusqu'au 31 déc.*
- Headline: *Bought it. Then it dropped? Get the difference back.* / *Acheté, puis le prix a baissé? Récupérez la
  différence.*
- Description: *Start free. Code BLACK until Dec 31.* / *Commencez gratuitement. Code BLACK jusqu'au 31 déc.*

**2b — Best Buy is here.** *Best Buy receipts now work in PriceBack. TV, laptop, headphones: scan the receipt and
we'll tell you if the price drops while Best Buy can still adjust it. Start free. Code BLACK adds 20%.* /
*Les reçus Best Buy fonctionnent maintenant dans PriceBack. Télé, portable, écouteurs : numérisez le reçu et on vous
avertit si le prix baisse tant que Best Buy peut encore l'ajuster. Commencez gratuitement. Le code BLACK ajoute 20 %.*

### Google Ads (App campaign / Demand Gen)

Retailer names in Google ad text can be disapproved under the trademark policy, so the text below avoids them; the
images say "Costco" as descriptive use with the disclaimer, and Google decides at review. One asset group per campaign.

| Campaign 1 headlines (≤ 30) EN | FR |
|---|---|
| Stop asking the group | Fini de demander au groupe |
| Every warehouse saving, free | Les rabais de votre entrepôt |
| Prices at every warehouse | Le prix à chaque entrepôt |
| Is it in stock? Check first | En stock? Vérifiez avant |
| 100% free. No credit card | 100 % gratuit, aucune carte |

| Campaign 1 descriptions (≤ 90) EN | FR |
|---|---|
| See every saving and shelf price at any warehouse in Canada, with last known stock. Free. | Voyez chaque rabais et prix en tablette, dans chaque entrepôt au Canada. Gratuit. |

| Campaign 2 headlines (≤ 30) EN | FR |
|---|---|
| Bought it? Then it dropped? | Acheté, puis le prix a baissé? |
| Get the difference back | Récupérez la différence |
| Promo code BLACK: +20% credits | Code BLACK : +20 % de crédits |
| Start free today | Commencez gratuitement |

| Campaign 2 descriptions (≤ 90) EN | FR |
|---|---|
| Scan your receipt. We watch every item and tell you when the price drops, and by when. | Numérisez votre reçu. On vous avertit quand le prix baisse, et avant quelle date. |
| Promo code BLACK: +20% bonus credits on any pack, until Dec 31. Free week or 75 credits. | Code BLACK : +20 % de crédits bonis sur tout forfait, jusqu'au 31 déc. |

### Targeting and test plan (suggested)

- Canada only; EN and FR ad sets split by language (Quebec gets FR first). Provinces with the most warehouses first
  (ON, QC, BC, AB).
- **Campaign 1 (cold):** interests Costco, warehouse clubs, couponing, frugal living. Week 1: 1a vs 1b vs 1c at equal
  budget, 4:5 + 9:16. Keep the winner. Measure **cost per account with a home warehouse set**, not just CPI.
- **Campaign 2:** retarget campaign 1 installs who have no receipt after 3 days, plus a cold "Best Buy / electronics
  buyers" set for 2b. Measure **cost per first receipt** and BLACK redemptions (`promo_redemptions`).
- Budget split to start: 70 % campaign 1, 30 % campaign 2, then follow cost per first receipt.

### Organic seeding in groups

Most groups ban promotion. Do not post the ads in groups. Answer real questions instead, as Maxim, with the answer
first and the app second ("Laval shows it in stock today at $799.99 in PriceBack, a free app I'm building:
disclosure"). Campaign 1's free tools are what make this possible: the answer costs the reader nothing.

---

## 6. Where the promo code goes (and where it must not)

| Surface | BLACK? | Why |
|---|---|---|
| Campaign 2 ads and posts, the website's offer section | ✅ | Ads may carry an offer and a deadline |
| Campaign 1 ads and posts | ❌ | Keeps campaign 1 a clean "free" message (Maxim, 2026-11-27) |
| **App Store Promotional Text** (170 chars, editable without review) | ✅ | Made for time-limited offers. Draft: *"New: Costco & Best Buy. Every warehouse saving and price, free. Use code BLACK for +20% bonus credits until Dec 31."* (≈ 120 chars) |
| App Store **In-App Event** "BLACK: +20% credits" (to Dec 31) | ✅ | Shows on the product page and in search; reviewed separately from the build |
| Play **Promotional content** (LiveOps offer) | ✅ | Same role on Play |
| **Store screenshots and the Play feature graphic** | ❌ | Apple 2.3.7 and Play's metadata policy reject promotion / time-limited wording in screenshots and graphics; a code that expires Dec 31 would also leave stale screenshots needing a new review |

The "Free" chip on store slots 1–4 describes the feature, not a time-limited offer; the current set already avoids
free-*period* wording (`app-store-screenshots/README.md`) and so does this one.

---

## 7. Renaming the Price Checker

**X-Ray / Rayon X: refused (Maxim, 2026-11-27).** Other names that work in both languages:

| EN | FR | Note |
|---|---|---|
| Item Lookup | Fiche produit | Plain, says what the screen is; "fiche produit" is the natural French term |
| Barcode Lookup | Recherche code-barres | Names the gesture; long in French |
| Product Scan | Scan produit | Short; close to "Scan a receipt", which may confuse |
| Item Check | Vérif article | Short and verb-like; informal in French |
| Know Before You Buy | Avant d'acheter | A promise, not a name; works as a tagline under any of the above |

Store slot 9's headline waits on the choice.

---

## 8. Open decisions for Maxim

1. Approve the two campaigns before store screenshots 3–10, the carousel and the two Reels are built.
2. The Price Checker name (§7).
3. Meta budget, the 70/30 split and the start date (after both stores are live).
