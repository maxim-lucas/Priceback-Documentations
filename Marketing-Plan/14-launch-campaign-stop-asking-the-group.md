# 14 — New-version launch campaign: "Stop asking the group. Ask PriceBack."

**Asked by Maxim, 2026-11-27:** *"create the new previews for the applestore and google play store but also the new
version launch content for instagram and facebook … a very good poster to be advertised in Meta Ads Campaign and maybe
also in Google Ads … inspired by the same design style for the onboarding screens … include Promo Code: Black … brainstorm
first to find the best angle and the more viral angle … people always asking in groups did anyone see a product, did
anyone know if this saving is available in a warehouse, where can i find this product and what is the price in
warehouse, when this product will be in stock"*.

**Status:** brainstorm done, angle recommended, first creatives rendered (EN + FR). Nothing posted, nothing uploaded.
Post and spend only once the build is live in **both** stores (the ads send people to download it).

Creatives: [`launch-2026-12/`](launch-2026-12/) (PNG in `en/` and `fr/`, one HTML source in `source/creatives.html`,
render with `?f=poster|story|square|store1|store2&lang=en|fr`). Replaces nothing yet: the current store set in
[`app-store-screenshots/`](app-store-screenshots/) stays live until the new set is finished and approved.

---

## 1. What is true (every piece of copy stays inside this box)

| Claim | Fact | Source |
|---|---|---|
| Stores | Costco Canada and Best Buy Canada (Best Buy goes live with this build) | `SlideStep.slideStores` |
| Free | Deals (savings in every Canadian warehouse, Business Centres included, last known stock), Warehouse prices, Purchases, the personalised home | Maxim, 2026-11-27 |
| Paid | Receipt scan (price-drop alerts), Price Checker, Email sync | Maxim, 2026-11-27 |
| Sign-up offer | **1 week of Unlimited free** (then $4.99/month, cancel anytime) **or 75 free credits** (no card). Only for accounts created on the new build | `trialChoice.*`, `Technical/Promo_Codes_Design.md` |
| Code **BLACK** | **+20 % bonus credits** on any credit pack, or **20 % off the first Unlimited payment** (first month / first year). Valid **until 2026-12-31**. On iPhone it is an Apple offer code: **new subscribers only, Canada only** | `Technical/Promo_Codes_Design.md` |
| Stock | "Last known availability", never "live stock" or "in stock now" | `browse.stockInToday` ("In stock · updated today") |

Never: a dollar figure as a promise (label every amount "Example"), "guaranteed refund", "no ads ever", a retailer logo
or its colours, and **never promise a Black Friday price adjustment** (stores exclude those periods:
`Technical/Store_Policy_Calendar.md`).

---

## 2. The brainstorm

### The insight

Canadian Costco groups (Facebook, Reddit, Instagram comments) are a public queue of the same five questions, and under
every one of them sits a wall of people commenting **"following"** because they want the answer too. That wall is the
ad. Every question maps to a screen the new build already has, and four of the five are **free**:

| What the group asks | The answer in PriceBack | Free? |
|---|---|---|
| "Has anyone seen X on sale at their warehouse?" | **Deals**: every saving, every warehouse, Business Centres too | ✅ |
| "What's the price of X at Laval / Burnaby?" | **Warehouse prices**: any warehouse you pick, by name or item number | ✅ |
| "Is it back in stock? Did anyone see it today?" | **Last known stock** on every Deals and Warehouse-prices row | ✅ |
| "I bought it last week and now it's on sale, can I get the difference?" | **Scan the receipt**: we watch every item and say what to claim, how much, by when | 💳 credits / trial |
| "What is this item / is this a good price?" | **Price Checker**: scan the barcode, see everything | 💳 |

### Angles considered

Scored 1–5 on *thumb-stop* (recognition in the feed), *shareability* (would someone tag a friend), *truth* (inside §1),
and *conversion path* (how fast a tap becomes a sign-up).

| # | Angle | Thumb-stop | Share | Truth | Path | Verdict |
|---|---|---|---|---|---|---|
| A | **"Stop asking the group. Ask PriceBack."** The group post + the "following" wall, answered by a PriceBack card | 5 | 5 | 5 | 5 | **Lead** |
| B | "You overpaid last week. Get it back." (loss aversion, the receipt scan) | 4 | 3 | 4 | 3 | Retargeting, step 2 |
| C | "Not a flyer. Every warehouse, live." (against the flyer re-posters) | 3 | 3 | 5 | 4 | Carousel slide, not the hero |
| D | "Your Costco, made for what you buy." (personalisation) | 2 | 2 | 5 | 3 | Store screenshot only |
| E | "Black Friday receipts: watch them." | 4 | 3 | **2** (exclusion periods) | 4 | Rejected: risks promising adjustments stores refuse |
| F | "Comment 'following' if…" engagement bait | 5 | 5 | 5 | 2 | Organic only (Meta down-ranks bait in ads) |

### Why A wins

1. **It mirrors a behaviour, not a feature.** People don't search for "price tracking app"; they post in the group.
   The creative shows them their own post. The "following 👀" comments are an inside joke every group member gets in
   half a second, and inside jokes are what gets tagged and shared.
2. **It leads with the free part.** The Conversion analysis (2026-10-29) found **74 % of sign-ups never scan a
   receipt**. Leading with "scan your receipt" asks for effort before value. Leading with free answers gets the install
   and a home warehouse; the receipt scan (and the paid tiers) follow from the habit. The funnel:
   *free answer → home warehouse set → "Bought before" chips → first receipt → trial or credits → BLACK on the first
   purchase.*
3. **It is true today** and needs no dollar promise: the card answers with prices and stock, labelled "Example".
4. **It is timely.** It is Black Friday week: the groups are at their busiest, and BLACK expires Dec 31, a real
   deadline without inventing one.
5. **It travels across formats.** The same two objects (the question, the answer) make the poster, the story, the
   carousel, the Reel and the store screenshots, so every touch point reinforces the one idea.

---

## 3. The creative system (taken from the onboarding slides)

The onboarding slides (`src/screens/onboarding/SlideStep.js`) are: a coloured stage with soft glow circles, one
tilted object (the receipt, rotate −4°), one dark floating pill over its corner, then an Inter Tight 800 title with
tight tracking. The campaign keeps exactly that grammar:

| Onboarding | Campaign |
|---|---|
| Tilted receipt card (−4°) | The group post, tilted −3° |
| Floating ink pill "Watching 14 items" | The PriceBack answer card, tilted +2°, overlapping the post |
| Slide stages: emerald, lime, ink, mint | Mint stage on top, **ink** panel below with the **lime** second line |
| Inter Tight 800 / Plus Jakarta 500 / IBM Plex Mono | Same three; Plex Mono for the code BLACK (a receipt print) |
| Dashed receipt rules, claim card | The promo code is a **lime receipt stub** with a perforation and notches |
| App tile (emerald 155°, receipt mark) | Same tile, same mark (`BrandMark.GLYPH_PATHS`) |

Tokens: bg `#eef5f1`, ink `#0d3d28`, accent `#10b981`, accentInk `#15803d`, lime `#bef264`
(`src/components/spaces/tokens.js`).

---

## 4. Deliverables

### Rendered now (EN + FR)

| File | Size | Use |
|---|---|---|
| `meta-feed-4x5.png` | 1080×1350 | **Hero.** Meta feed ad (FB + IG), organic launch post |
| `meta-story-9x16.png` | 1080×1920 | Stories / Reels ad. Content kept between y 250 and 1640; the bottom is left for the platform's button |
| `feed-square-1x1.png` | 1080×1080 | Feed alternative, Google Display / Demand Gen square |
| `store-01-deals` / `store-01-rabais` | 1320×2868 | App Store 6.9" slot 1 (Play takes the same file) |
| `store-02-warehouse-prices` / `store-02-prix-en-entrepot` | 1320×2868 | Store slot 2 |

### Still to make, once the angle is approved

**Store screenshots (10, EN + FR).** The first three are the ones most people see; they carry the angle.

| # | Headline EN | Headline FR | Screen |
|---|---|---|---|
| 1 | Is it on sale at my warehouse? **Now you know.** | En rabais à mon entrepôt? **Là, vous le savez.** | Deals ✅ rendered |
| 2 | What does it cost **at that warehouse?** | Combien ça coûte **à cet entrepôt?** | Warehouse prices ✅ rendered |
| 3 | Back in stock? **See it before you drive.** | De retour en stock? **Vérifiez avant de partir.** | A row's stock line, close up |
| 4 | Bought it? **Get the drop back.** | Déjà acheté? **Récupérez la baisse.** | Receipt scan → watching N items |
| 5 | The moment it drops, **you know.** | Dès que le prix baisse, **vous le savez.** | Price-drop push (onboarding slide B) |
| 6 | Claim it at the desk **in minutes.** | Réclamez au comptoir **en quelques minutes.** | Claim card (onboarding slide C) |
| 7 | Costco **and Best Buy.** One app. | Costco **et Best Buy.** Une seule app. | Store spaces (onboarding slide E) |
| 8 | Made for **what you buy.** | Fait pour **ce que vous achetez.** | Home with "Bought before" |
| 9 | Scan a barcode. **See everything.** | Scannez un code-barres. **Voyez tout.** | Price Checker |
| 10 | Private by design. Independent. | Privé dès la conception. Indépendant. | Disclaimer slide (keep the current one) |

**Google Play feature graphic** (1024×500): the headline and the answer card only, no code, no "free" (see §6).

**Instagram / Facebook carousel "Group questions, answered"** (1080×1350, 6 slides): slide 1 the hero; slides 2–5 one
question each (sale at my warehouse, price at another warehouse, back in stock, bought it last week) with its answer
card; slide 6 the offer (1 week free or 75 credits + BLACK).

**Reel (15–20 s):** 0–3 s scroll through a group post and the "following" wall (sound: notification pings); 3–5 s
text "64 people are waiting for an answer"; 5–12 s open PriceBack → Deals → pick the warehouse → the row with stock;
12–16 s "Stop asking the group. Ask PriceBack."; 16–20 s BLACK stub + store badges. Label amounts "Example".

---

## 5. Ad copy

### Meta (Facebook + Instagram), three variants to test against each other

**A — The group (hero).**
- Primary text EN: *"Has anyone seen it on sale at their warehouse?" … "following 👀" … Skip the 64 comments.
  PriceBack shows every Costco saving and shelf price, in every Canadian warehouse (Business Centres too), with the
  last known stock. Free. New: scan your Costco or Best Buy receipt and get alerted when the price drops.
  🎟 Code BLACK: +20% bonus credits, until Dec 31.*
- FR: *« Quelqu'un l'a vu en rabais à son entrepôt? » … « Suivi 👀 » … Passez les 64 commentaires. PriceBack montre
  tous les rabais et prix Costco, dans chaque entrepôt au Canada (Centres d'affaires inclus), avec le dernier stock
  connu. Gratuit. Nouveau : numérisez vos reçus Costco ou Best Buy et soyez alerté quand le prix baisse.
  🎟 Code BLACK : +20 % de crédits bonis, jusqu'au 31 déc.*
- Headline: *Stop asking the group. Ask PriceBack.* / *Fini de demander au groupe. Demandez à PriceBack.*
- Description: *Free on iPhone and Android* / *Gratuit sur iPhone et Android*

**B — The stock run.** *Driving 40 minutes for something that's sold out? Check the last known stock at any Canadian
warehouse first. Free in PriceBack.* / *Faire 40 minutes de route pour un article en rupture? Vérifiez le dernier
stock connu à n'importe quel entrepôt au Canada. Gratuit dans PriceBack.*

**C — Bought it last week (retargeting: installed, no receipt).** *Bought it last week and now it's on sale? Scan the
receipt: PriceBack watches every item and tells you what to claim, how much, and by when. Start with a free week or
75 free credits. Code BLACK adds 20%.* / *Acheté la semaine passée et maintenant en rabais? Numérisez le reçu :
PriceBack surveille chaque article et vous dit quoi réclamer, combien et avant quelle date. Commencez avec une semaine
gratuite ou 75 crédits gratuits. Le code BLACK ajoute 20 %.*

### Google Ads (App campaign / Demand Gen)

Retailer names in Google ad text can be disapproved under the trademark policy when the owner has filed a complaint,
so the headlines below avoid them; the images may still say "Costco" as descriptive use with the disclaimer, and Google
decides at review.

| Headlines (≤ 30) EN | FR |
|---|---|
| Stop asking the group | Fini de demander au groupe |
| Every warehouse saving, live | Les rabais de votre entrepôt |
| Prices at every warehouse | Le prix à chaque entrepôt |
| Is it in stock? Check first | En stock? Vérifiez avant |
| Promo code BLACK: +20% credits | Code BLACK : +20 % de crédits |

| Descriptions (≤ 90) EN | FR |
|---|---|
| See every saving and shelf price at any warehouse in Canada, with last known stock. Free. | Voyez chaque rabais et prix en tablette, dans chaque entrepôt au Canada. Gratuit. |
| Scan your receipt. We watch every item and tell you when the price drops, and by when. | Numérisez votre reçu. On vous avertit quand le prix baisse, et avant quelle date. |
| Promo code BLACK: +20% bonus credits on any pack, until Dec 31. Free week or 75 credits. | Code BLACK : +20 % de crédits bonis sur tout forfait, jusqu'au 31 déc. |

### Targeting and test plan (suggested)

- Canada only; EN and FR ad sets split by language (Quebec gets FR first).
- Interests: Costco, Costco Wholesale, warehouse clubs, Best Buy, couponing, frugal living; members of the provinces
  with the most warehouses first (ON, QC, BC, AB).
- Week 1: A vs B vs C(as cold) at equal budget, 4:5 + 9:16 placements. Keep the winner, move C to retargeting.
- Measure past the install: **cost per account with a home warehouse set** and **cost per first receipt**, not just CPI
  (the 74 % no-scan leak is the number this campaign must move).

### Organic seeding in groups

Most groups ban promotion. Do not post the ad in groups. Answer real questions instead, as Maxim, with the answer
itself first and the app second ("Laval shows it in stock today at $799.99 in PriceBack, the app I'm building:
disclosure"). One genuine answer a day beats a banned post.

---

## 6. Where the promo code goes (and where it must not)

| Surface | BLACK? | Why |
|---|---|---|
| Meta ads, Google ads, IG/FB posts, Reels, the website | ✅ | Ads may carry an offer and a deadline |
| **App Store Promotional Text** (170 chars, editable without review) | ✅ | Made for time-limited offers. Draft: *"New: Costco & Best Buy. Every warehouse saving and price, free. Use code BLACK for +20% bonus credits until Dec 31."* (≈ 120 chars) |
| App Store **In-App Event** "BLACK: +20% credits" (to Dec 31) | ✅ | Shows on the product page and in search; reviewed separately from the build |
| Play **Promotional content** (LiveOps offer) | ✅ | Same role on Play |
| **Store screenshots and the Play feature graphic** | ❌ | Apple 2.3.7 and Play's metadata policy reject price/promotion/time-limited wording in screenshots and graphics; a code that expires Dec 31 would also leave stale screenshots needing a new review. The current set already follows "no free-period wording" (`app-store-screenshots/README.md`) |

This departs from the brief ("all these images should include Promo Code: Black") for the store images only. Maxim's
call; the HTML source can add the stub to a store slide in one line if he prefers to take the review risk.

---

## 7. Renaming the Price Checker (suggestions)

The feature scans a barcode and shows everything about the product. Names that work in both languages:

| EN | FR | Note |
|---|---|---|
| **X-Ray** | **Rayon X** | Recommended. In French *rayon* is also the store aisle, a free pun; "X-ray the item" says "see everything" |
| Item Lookup | Recherche d'article | Plain, safest for the store review |
| Price Lens | Loupe à prix | Visual, pairs with the camera |
| Scan & Know | Scanne et sache | Verb-led, but less natural in French |

---

## 8. Open decisions for Maxim

1. Approve angle A (or pick another) before the remaining 8 store screenshots, the carousel and the Reel are built.
2. Store images without BLACK (recommended) or with it (§6).
3. The Price Checker name (§7): the store slide 9 headline waits on it.
4. Meta budget and start date (after both stores are live).
