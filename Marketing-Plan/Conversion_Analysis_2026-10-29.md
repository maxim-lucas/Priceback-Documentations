# Conversion analysis — why price-drop recipients don't pay (2026-10-29)

Source: prod Supabase (`xjfrlzwonyaorwktnkpj`, schema `priceback`), real accounts only
(sandbox ledger rows excluded, deleted accounts excluded). Pricing at the time:
`CLAIM_CREDITS_PER_DOLLAR=15`, `FREE_TRIAL_CREDITS=75`, packs Starter 250 cr / $3,
Pro 500 / $5, Max 1100 / $10; Unlimited $4.99/mo or $49.99/yr.

## Funnel

| Step | Accounts |
|---|---|
| Signed up (not deleted) | 314 (287 in the last 30 days) |
| ≥ 1 receipt | 82 (26 %) |
| ≥ 3 receipts | 23 |
| ≥ 1 price drop released | 41 |
| Charged for a drop (`price_drop_charge`) | 41 |
| Balance went below zero → drops locked | 16 |
| Paid | 2 — 1 Starter pack, 1 Unlimited annual (+1 monthly sub by error, per Maxim) |

## Findings

1. **The lock ends engagement instead of converting.** Of the 14 locked accounts that
   did not pay, **none scanned another receipt after going below zero**. Most did open
   the app again (several on 3.2.0), saw the lock and left. Their debts were tiny —
   17 to 440 credits (≈ $0.17–$4.40 at pack price) — against a $3 minimum pack or a
   $4.99 subscription, and the saving they would recover is hidden behind it.
   The two payers kept scanning: the Starter buyer paid **51 minutes** after going below
   zero (push → unlock works when it lands); the annual subscriber paid 7 days in.
2. **Most drops never meet a paywall.** 25 of 41 drop recipients never went below zero —
   the 75 signup credits absorbed the 15 cr/$ charge. ≈ $107 of drops found for them free;
   ≈ $253 for the 16 locked accounts.
3. **Drops arrive late and in review batches.** Average release ≈ 15 days after purchase
   (half the 30-day window gone); some released with 0 or negative days left. Pushes cluster
   when the review queue is cleared (22 on one Monday at 20 h ET, 15 on a Tuesday at 19 h);
   14 pushes went out between midnight and 1 AM ET.
4. **Smaller leaks.** 9 of 41 drop recipients have no push token. The Unlimited plan copy
   says "best for anyone who saves more than ~$80/month"; at 15 cr/$ the subscription pays
   for itself from ≈ $33/month of drops. 74 % of signups never scan a receipt — the largest
   leak by volume, upstream of all the above.

## Levers (not yet decided — pricing/backend decisions for Maxim)

1. Show the locked total prominently and let a locked shopper claim **one** drop now, the
   rest on payment (shipped UI part: amount-first locked row, "To claim now" hero page).
2. Never let a below-zero balance stop scanning.
3. Move the first payment moment to the first drop: charge on reveal, or make signup credits
   cover a smaller first drop.
4. Send drop pushes in a local morning window; shorten review latency.
5. Fix the "$80/month" Unlimited copy to the real break-even.

## UI shipped from this analysis

Branch `feat/drop-amount-emphasis-hero-pages` (off `main`): amount-first locked row in
Products ("**$X** more to claim" + labelled Unlock), large right-aligned saving on product
and receipt rows ("$4.00 to claim"), two-page swipeable Home hero ("To claim now" first,
taps to Tracking › By product › Alerts).
