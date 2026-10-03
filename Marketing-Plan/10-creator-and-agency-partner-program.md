# Creator & agency partner program

**Status:** built in the app (Priceback PR `feat/partner-codes`, migration 0017). Admin console → **Dashboard → Partners**.
**Engineering reference:** [`Technical/Partner_Program.md`](../Technical/Partner_Program.md).

## 1. The problem this solves

Instagram creators and marketing agencies want to promote PriceBack, but each one asks for something different:
- a share of sales;
- a free plan "for a few years" or "for life";
- for agencies, payment for the traffic they send.

PriceBack has had no attribution data, so there was no basis for deciding what any partner is worth. Agencies price traffic as if they know your numbers. You don't, so any per-traffic price is a guess that favours them.

**The fix is to measure first and pay on proof.** Every partner gets their own code. The app records who signed up with it, who scanned a receipt, who paid and how much. Every deal is priced against those events, never against clicks, views or installs.

## 2. What the market calls this (Canada / US)

This is an **affiliate program** (with creators it's often called a **creator** or **ambassador program**) paid on **performance**. The shapes below are standard; the app can express all of them, alone or combined, on a per-code basis.

| Model | The partner gets | Typical use |
|---|---|---|
| **CPA** (cost per acquisition) | A fixed $ per *qualified* user | Default for agencies and unproven creators |
| **Revenue share / commission** | A % of what referred users spend, for a set window (12 months is common), usually on revenue net of the store fee | Creators who ask for "sales shares" |
| **Hybrid** | A small flat fee per post, plus CPA or commission | Established micro-creators who won't work with no guarantee |
| **Product seeding / comp** | A free paid plan on *their own* account | The "free plan for years" ask; costs almost nothing at the margin |
| **Flat fee per post** | A fixed $ per post or story | Only *after* a CPA test proves the audience converts |
| **Credit reward** (your "45 credits per user" idea) | PriceBack credits per referred user | Small creators who are also users; most professionals want cash |

Rates vary a lot by niche and audience. Treat any number you are quoted as a starting point to negotiate, not a price list. That is exactly why the pilot below comes first.

## 3. How to answer each ask

### "Pay us for the traffic" (agencies)
Decline cost-per-click and cost-per-impression. Offer instead:
1. **A 30-day pilot**, paid by **CPA on a paying user**: someone who signed up with the code and paid for a pack or a subscription. Optionally add a **minimum spend** (e.g. $5) so a single $3 pack doesn't trigger a $5 CPA.
2. **A hard budget cap**, set with **Max uses** on the code. When it's full, it stops.
3. **After the pilot**, the partner statement shows real cost per paying user, paid conversion and spend, and the next contract is priced from those numbers.

If an agency insists on a commission, combine it: a small CPA plus **10–20% of spend for 12 months**.

### "Give me a revenue share"
Yes, with three limits that are already built in:
- **a window** (e.g. 12 months after the user signed up);
- **a hold** (30 days by default) so a refunded purchase is never paid out;
- the amount is computed from **catalog CAD prices**, i.e. gross. If the contract says "net of store fees", lower the % accordingly (Apple and Google take 15% at our size).

### "Give me a free plan for life"
Give the comp to the **creator's own account**, **with an end date** (12 months, renewable while they keep posting). Record it on the partner (*comped until*), and grant it in RevenueCat as a promotional entitlement; the app doesn't grant it automatically. **Never promise lifetime access to their audience.** Their audience gets welcome credits instead.

### "Give me credits per user" (small creators who use the app)
Set **Partner credits** on the code (e.g. 45) and choose when they pay: *after the first receipt scan* or *after the first purchase*. This requires linking the creator's own PriceBack account. Credits are never paid at bare sign-up, because that would pay for installs nobody uses.

## 4. Rules that protect the money

- **One code per user, at sign-up only.** A friend's PB- code and a creator code are mutually exclusive. A code can't be used after onboarding, or by the partner on their own code.
- **Codes expire and can be capped.** Set *end date* and *max uses*. A leaked code can't run forever.
- **The deal is frozen once a code has users.** Changing terms would silently re-price people who signed up under the old ones. To change a deal, retire the code and create a new one.
- **Sandbox purchases never count.** TestFlight, App Review and Play testers cost $0, so they earn nobody anything.
- **The statement never names users.** The CSV you send a partner has counts and amounts only.

## 5. Compliance checklist (put it in every contract)

- **Disclosure.** Canada: the Ad Standards *Influencer Marketing Disclosure Guidelines* and the Competition Act require a clear label on paid or rewarded posts (#ad, #sponsored / #pub, #commandité). US: the FTC Endorsement Guides. A creator code with a commission or credits *is* a material connection, so it must be disclosed.
- **No promised savings.** Creators must not claim a guaranteed refund amount. Same rule as all our marketing ([04-growth-tactics](04-growth-tactics.md)).
- **No "free months" wording** for the welcome bonus. It is *bonus credits*. (App Store 3.1.2(c) rejected 2.8.20 for free-period copy.)
- **Never tie a reward to a rating or a follow** (App Store 3.2.2, Play policy). Codes reward sign-ups, scans and purchases, which the server can verify.
- **Audience location.** The app is available in **Canada and Egypt only**. Ask for an Instagram Insights screenshot of audience countries before signing. A mostly US audience mostly can't install the app.
- **Quebec.** Content aimed at Quebec should be in French. The app is bilingual, so give FR creators FR talking points.
- **Tax.** Cash paid to a Canadian contractor goes on a T4A once it passes the CRA reporting threshold (currently $500 a year). Keep the e-Transfer reference in each recorded payout. Confirm with the accountant.

## 6. Deal sheet (copy for each partner)

```
Partner:            ______________________   Type: influencer / agency
Instagram:          @_____________   Audience in Canada: ___ %  (Insights screenshot attached)
PriceBack account:  linked yes / no   (needed for credit rewards)
Code:               __________   Starts: ____-__-__   Ends: ____-__-__   Max uses: _____
New user gets:      ___ credits, at: sign-up / first receipt scan / first purchase
Partner gets:
  - credits:        ___ per user, at: first receipt scan / first purchase
  - CPA:            $____ per paying user, once they have spent $____
  - commission:     ___ % of what they spend, for ___ months (empty = no end)
  - hold:           ___ days before an amount is payable (default 30)
  - flat fee:       $____ per post (paid outside the app)
  - comp plan:      Unlimited until ____-__-__ (granted in RevenueCat)
Payout:             monthly, by e-Transfer / PayPal, from the app statement
Disclosure:         #ad / #pub on every post — required
```

## 7. Negotiation script

> "Thanks for your interest in PriceBack. Here's how we work with creators: you get your own code, and your followers get bonus credits when they sign up with it. We pay on results: **$X for each follower who becomes a paying user**, plus **Y% of what they spend for 12 months**. You'll get a monthly statement from the app showing signups, paying users and what you've earned, and we pay by e-Transfer. To start, we suggest a 30-day pilot capped at Z users. If it works for both of us, we extend it and can add a per-post fee."

To an agency asking per traffic:

> "We don't buy clicks or impressions. We only pay for people who actually use and pay for the app, and our app tracks that per code. We're happy to start a 30-day pilot at $X per paying user, capped at $Y in total. After that, you'll have the real numbers to price the next contract, and so will we."

## 8. KPIs the partner desk reports

| KPI | Definition |
|---|---|
| Signups | Users who redeemed the code at sign-up |
| Scanned | Of those, users who saved at least one receipt |
| Paying users | Users with at least one paid, non-sandbox charge after signing up |
| Qualified (CPA) | Paying users whose spend inside the window reached the minimum spend |
| Spend | Sum of their charges, priced from the CAD catalog |
| Earned | CPA + commission |
| Pending | Earned, but still inside the refund hold |
| Payable | Earned and past the hold |
| Owed | Payable − payouts recorded |

**Cost per paying user** = (payouts + flat fees + comp value) ÷ paying users. Compare it with what a paying user is worth over 12 months before renewing any deal.

## 9. Running a partner in the app

1. Admin console → **Partners** → *Add a partner* (name, type, Instagram, email, and their PriceBack account id if they get credits).
2. Open the partner → *New code*. Fill in the deal. The line under the form says in words what the deal is; check it.
3. Send the creator their code and the talking points.
4. Monthly: open the partner → *Share statement (CSV)* → send it. Pay **Owed now**, then use *Record payout* with the e-Transfer reference.
5. To end a campaign: *Retire* the code. To end the relationship: *Retire this partner* (all their codes stop working).
