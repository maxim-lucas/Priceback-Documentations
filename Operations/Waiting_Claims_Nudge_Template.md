# Waiting-claims nudge for inactive shoppers — query + notification template

Reusable recipe (Maxim, 2026-10-21). Run the query, read the audience, **show the texts to Maxim in chat**, then — only after he approves — load them into the admin review screen (Admin · Notifications to approve). Never send directly.

## Standing rules for this campaign

1. **Same numbers as the app, always.** Amount, count and days left come from the app's logic (`lib/shopperPreview.js` + `priceDropQueueRepo.releasedForUser`), never from a looser rule. **Locked drops count** (a locked drop is hidden in the app, not cancelled). Saving = line total − lowest alerted price × quantity. A claim closes on the earlier of the store window and the day after the saving ends. A shopper must never be sent a figure that differs from the app.
2. **Never skip an account because its balance is negative** (Maxim, 2026-10-21).
3. **Verify before sending:** run `adminConsoleRepo.shopperPreview(sub)` for each audience member and compare `summary.openDrops`, `openSavings`, `fewestDaysLeft` with the query. On 2026-10-21 the query matched the app for all 14 shoppers with waiting claims.
4. Drops alerted within the last `min_days_since_last_alert` days (default 1) are left alone.
5. **Goal of the push:** bring the shopper back to open the app, claim, update the claim status — and, for locked or missed claims, make buying credits or subscribing the natural next step **without saying so**. No mention of credits, plans, or money to pay.

## 0. The daily job (built 2026-10-21)

`backend/jobs/inactiveClaimsNudge.js` runs at 18:30 UTC (setting `INACTIVE_CLAIMS_NUDGE_ENABLED`, default OFF) and **drafts** one notice per due shopper on the review screen (Admin · Notifications to approve, kind `inactive_claims_nudge`); an admin approves each. Rules live in `backend/lib/inactiveClaimsNudge.js`: due 4 days after the last alert with no app opening since, or 2 days when the nearest drop has < 5 days left; skipped if the shopper got any claim push (drop alert or reminder) or an earlier nudge in the last 2 days, or one is already waiting. The figures come from `shopperPreview` (the app's), not from the SQL below — the SQL is the human-readable twin for the Supabase editor and matched the app for all 14 shoppers on 2026-10-21. Dry run in prod: `railway run -e production node -e "require('./backend/lib/inactiveClaimsNudge').draft({dryRun:true}).then(r=>console.log(r))"` from the repo root.

## 1. The query

Read-only; run in the Supabase SQL editor. One setting (`min_days_since_last_alert`) at the top. Columns: sub, name, total_alerts, total_saving, last_alert_at, nearest_end_days, days_since_last_alert, missed_claims, missed_saving, scan_credits, subscription_tier, last_seen, app_version, os, device, language, inactive ("inactive" = last seen on or before the last alert, or never seen).

```sql
-- Shoppers with price-drop claims waiting, plus the claims they MISSED, and whether they came back
-- since the last alert.  Read-only. Run in the Supabase SQL editor (prod: xjfrlzwonyaorwktnkpj).
--
-- Same rules as the app (backend/lib/shopperPreview.js + priceDropQueueRepo.releasedForUser):
--   * a drop = a line the shopper was alerted about (price_drop_notifications). LOCKED drops
--     (balance below zero) count too — locking only hides the price in the app.
--   * saving       = (line total - lowest alerted price x quantity), never below 0
--   * WAITING      = never claimed AND not expired
--   * EXPIRED      = today is on/after the day the claim closes = the EARLIER of
--                    store window (purchase + adjustment_days) and the day after the saving ends
--   * MISSED       = expired and never claimed by the shopper (unclaimed, or auto-closed as 'expired')
--   * negative-balance accounts are NEVER skipped.

-- SETTING: skip shoppers whose LAST alert is more recent than this many days.
--   1 = nobody alerted in the last 24 h (drops announced today are left alone)
--   0 = no filter, 0.5 = last 12 h, 2 = last 2 days
WITH params AS (
  SELECT 1::numeric AS min_days_since_last_alert,
         (now() AT TIME ZONE 'America/Toronto')::date AS today
),

-- STEP 1: every alerted line that is not deleted and was not claimed by the shopper.
lines AS (
  SELECT
    r.user_sub,
    i.id                                                      AS item_id,
    i.product_id,
    u.province_id,
    r.purchase_date,
    COALESCE(st.adjustment_days, 30)                          AS window_days,
    r.purchase_date + COALESCE(st.adjustment_days, 30)        AS store_closes,
    MIN(n.price)                                              AS lowest_price,
    MAX(n.sent_at)                                            AS alerted_at,
    GREATEST(0, ROUND(i.line_total - MIN(n.price) * COALESCE(NULLIF(i.quantity, 0), 1), 2)) AS saving,
    (i.claimed_at IS NOT NULL)                                AS auto_closed   -- true only for 'expired' below
  FROM priceback.price_drop_notifications n
  JOIN priceback.receipt_items i   ON i.id = n.receipt_item_id AND i.deleted_at IS NULL
  JOIN priceback.receipts r        ON r.id = i.receipt_id      AND r.deleted_at IS NULL
  JOIN priceback.users u           ON u.sub = r.user_sub
  LEFT JOIN priceback.products p   ON p.id = i.product_id
  LEFT JOIN priceback.stores st    ON st.id = p.store_id
  LEFT JOIN priceback.claim_sources cs ON cs.id = i.claim_source_id
  WHERE i.line_total IS NOT NULL
    AND (i.claimed_at IS NULL OR cs.code = 'expired')     -- unclaimed, or closed by the system when it expired
  GROUP BY r.user_sub, i.id, i.product_id, u.province_id, r.purchase_date, st.adjustment_days,
           i.line_total, i.quantity, i.claimed_at
),

-- STEP 2: the last day of the saving, with the app's order of trust (priceDropRepo.savingEndsJoin):
--   1 printed dates (flyer window / tag expiry) for this province+price, 2 admin dates for it,
--   then 1 and 2 again from ANY province/price of the same product, 3 social-post dates.
-- A date only counts if the saving was running during the purchase's store window.
dated AS (
  SELECT
    l.*,
    COALESCE(
      MAX(c.end_day) FILTER (WHERE c.tier = 1 AND c.same_group),
      MAX(c.end_day) FILTER (WHERE c.tier = 2 AND c.same_group),
      MAX(c.end_day) FILTER (WHERE c.tier = 1),
      MAX(c.end_day) FILTER (WHERE c.tier = 2),
      MAX(c.end_day) FILTER (WHERE c.tier = 3 AND c.same_group)
    ) AS saving_ends
  FROM lines l
  LEFT JOIN LATERAL (
    SELECT t.tier, t.end_day,
           (sp.province_id = l.province_id AND sp.current_unit_price = l.lowest_price) AS same_group
    FROM priceback.price_points sp
    JOIN priceback.price_source_types src ON src.id = sp.source_type_id
    CROSS JOIN LATERAL (
      SELECT 1 AS tier,
             CASE WHEN src.code = 'flyer' AND sp.valid_from IS NOT NULL AND sp.valid_until >= sp.valid_from
                    THEN sp.valid_until
                  WHEN src.code = 'price_tag_scan' AND COALESCE(sp.flags ->> 'expiryDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                       AND (sp.flags ->> 'expiryDate')::date >= sp.observed_at::date
                    THEN (sp.flags ->> 'expiryDate')::date
                  WHEN src.code = 'price_tag_scan' AND COALESCE(sp.flags ->> 'printedExpiry', '') = 'true'
                       AND sp.valid_until >= sp.observed_at::date
                    THEN sp.valid_until END AS end_day,
             CASE WHEN src.code = 'flyer' THEN COALESCE(sp.valid_from, sp.observed_at::date)
                  ELSE sp.observed_at::date END AS from_day
      UNION ALL
      SELECT 2,
             CASE WHEN COALESCE(sp.flags -> 'savingDates' ->> 'until', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN (sp.flags -> 'savingDates' ->> 'until')::date END,
             CASE WHEN COALESCE(sp.flags -> 'savingDates' ->> 'from', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN (sp.flags -> 'savingDates' ->> 'from')::date END
      UNION ALL
      SELECT 3,
             CASE WHEN src.code = 'price_tag_scan' AND COALESCE(sp.flags ->> 'sourceKind', '') = 'social_price_tag'
                       AND sp.valid_from IS NOT NULL AND sp.valid_until >= sp.valid_from
                  THEN sp.valid_until END,
             sp.observed_at::date
    ) t
    WHERE sp.product_id = l.product_id
      AND COALESCE((sp.flags ->> 'excluded')::boolean, false) = false
      AND t.end_day IS NOT NULL
      AND t.end_day >= l.purchase_date                                             -- not over before the purchase
      AND COALESCE(t.from_day, t.end_day) <= l.purchase_date + l.window_days      -- started within the store window
  ) c ON true
  GROUP BY l.user_sub, l.item_id, l.product_id, l.province_id, l.purchase_date, l.window_days,
           l.store_closes, l.lowest_price, l.alerted_at, l.saving, l.auto_closed
),

-- STEP 3: the day each claim closes, then waiting vs missed.
judged AS (
  SELECT d.*,
         LEAST(d.store_closes, COALESCE(d.saving_ends + 1, d.store_closes)) AS closes_on
  FROM dated d
  WHERE d.saving > 0
),
per_user AS (
  SELECT
    j.user_sub,
    COUNT(*)      FILTER (WHERE NOT j.auto_closed AND j.closes_on >  params.today)      AS total_alerts,
    SUM(j.saving) FILTER (WHERE NOT j.auto_closed AND j.closes_on >  params.today)      AS total_saving,
    MAX(j.alerted_at) FILTER (WHERE NOT j.auto_closed AND j.closes_on > params.today)   AS last_alert_at,
    MIN(j.closes_on) FILTER (WHERE NOT j.auto_closed AND j.closes_on > params.today) - params.today AS nearest_end_days,
    COUNT(*)      FILTER (WHERE j.auto_closed OR j.closes_on <= params.today)           AS missed_claims,
    SUM(j.saving) FILTER (WHERE j.auto_closed OR j.closes_on <= params.today)           AS missed_saving
  FROM judged j CROSS JOIN params
  GROUP BY j.user_sub, params.today
)

-- STEP 4: who they are, their plan, and when they were last in the app.
SELECT
  u.sub,
  u.name,
  p.total_alerts,
  p.total_saving,
  p.last_alert_at,
  p.nearest_end_days,
  ROUND(EXTRACT(EPOCH FROM now() - p.last_alert_at) / 86400, 1) AS days_since_last_alert,
  p.missed_claims,
  p.missed_saving,
  u.scan_credits,
  plan.label                                                    AS subscription_tier,
  u.app_seen_at                                                 AS last_seen,          -- the app's own opening stamp (what the admin account screen shows); NULL = never reported
  seen.last_known_activity,
  COALESCE(u.app_seen_at, seen.last_known_activity)             AS away_since,         -- date to quote in the notification (NULL = none known)
  u.app_version,
  u.app_platform                                                AS os,
  dev.device,
  COALESCE(pref.language, 'en')                                 AS language,
  -- Inactive = the app has not opened since the last alert (or never reported an opening).
  (u.app_seen_at IS NULL OR u.app_seen_at <= p.last_alert_at)   AS inactive
FROM per_user p
JOIN priceback.users u                  ON u.sub = p.user_sub
LEFT JOIN priceback.subscription_plans plan ON plan.id = u.subscription_tier_id
LEFT JOIN priceback.user_preferences pref   ON pref.user_sub = u.sub
LEFT JOIN LATERAL (
  -- last_known_activity: the latest device ping or sign-in. Information only; it does NOT
  -- decide who is inactive (a ping can come from the server side, not from the shopper).
  SELECT GREATEST(
           (SELECT MAX(d.last_seen)  FROM priceback.devices d       WHERE d.owner_sub = u.sub),
           (SELECT MAX(s.created_at) FROM priceback.user_sessions s WHERE s.user_sub  = u.sub)
         ) AS last_known_activity
) seen ON true
LEFT JOIN LATERAL (
  SELECT concat_ws(' ', d.brand, d.model) AS device
  FROM priceback.devices d
  WHERE d.owner_sub = u.sub
  ORDER BY d.last_seen DESC
  LIMIT 1
) dev ON true
CROSS JOIN params
WHERE p.total_alerts > 0                                   -- something is still waiting
  AND p.last_alert_at <= now() - params.min_days_since_last_alert * interval '1 day'  -- SETTING above
  AND u.status = true                                      -- account active
  AND u.deletion_requested_at IS NULL
  AND u.push_token IS NOT NULL                             -- can receive a push
ORDER BY inactive DESC, p.nearest_end_days, p.total_saving DESC;
```

## 2. Notification template (one language per shopper — theirs only)

**Never ask the shopper to do anything** (no "open", "claim", "update", "buy"). The push only informs; the title carries the money and urgency, the body carries facts about their account. The goal is curiosity, so they open the app on their own. No mention of credits, plans or prices to pay.

| | English | Français |
|---|---|---|
| Title | `💰 {total} to claim ({daysLeft})` | `💰 {total} à réclamer ({daysLeft})` |
| Body A — they already missed some (`missed_claims` > 0) | `You already missed {missedCount} price drop(s) — {missed} in total. {count} still running.` | `Vous avez déjà manqué {missedCount} baisse(s) de prix — {missed} au total. {count} encore en cours.` |
| Body B — nothing missed | `You've been away since {lastSeen} — {count} price drop(s) found while you were gone.` | `Vous êtes absent depuis le {lastSeen} — {count} baisse(s) de prix trouvée(s) pendant votre absence.` |

- `{total}` = `total_saving` (`$5.00` / `5,00 $`); `{missed}` = `missed_saving`, same format; `{missedCount}` = `missed_claims`; `{count}` = `total_alerts`.
- `{daysLeft}` = `nearest_end_days`: `3 days left` / `1 day left` / `last day` · `3 jours restants` / `1 jour restant` / `dernier jour`.
- `{lastSeen}` = the date of `away_since` in their language and province day (`October 14, 2026` / `14 octobre 2026`, `pushI18n.formatDay`).
- Plural forms: "1 price drop" / "2 price drops"; "1 baisse de prix" / "2 baisses de prix" (and matching verbs: vous attend / vous attendent not used — wording above avoids them).
- Push `data.type` = `pending_claims_reminder` (category Claim reminders) with the `receiptId` of the receipt whose drop closes first.

## 3. Last seen — what counts

`last_seen` = `users.app_seen_at`, the stamp written each time the app opens — the same value the admin account screen shows. NULL means the app never reported an opening (older builds): the shopper counts as inactive. `last_known_activity` (latest device ping or sign-in) is shown for information and is used only as the date to quote when `last_seen` is NULL (`away_since` = `COALESCE(last_seen, last_known_activity)`). It never decides who is inactive: device pings and sign-ins can come from the server side or a background refresh, which made shoppers like Claudiu Blaga look active when the app had never seen them (2026-10-21).
