# Incident Response & Breach Notification Runbook

Standing procedure for a suspected or confirmed security incident affecting
PriceBack user data. Satisfies the breach-response commitments in the privacy
policy and the legal obligations under **PIPEDA s.10.1** (federal) and **Quebec
Law 25 s.3.5–3.8**. Keep this current; review at least annually.

**Security contact:** `security@priceback.ca`
**Privacy Officer:** Maxim Lucas — `privacy@priceback.ca` (priceback.ca
mail forwarding live since 2026-07).

> PIPEDA / Law 25 require notifying the regulator and affected individuals
> **without unreasonable delay** once a breach posing a *real risk of significant
> harm* (RROSH) is confirmed. Treat **72 hours** from confirmation as the
> internal target for first notifications.

---

## 1. Detect & triage

Sources: Sentry alerts, Railway/Supabase anomalies, the API-call audit log
(structured `{"t":"api",...}` JSON lines in the Railway log stream), budget-alert
emails, or an external report to `security@`.

- Record **first-detected timestamp**, reporter, and what was observed.
- Assign a severity: does it plausibly expose personal data (email, name,
  receipts, postal code, device data)? If yes → continue this runbook.

## 2. Contain

- Rotate any credential that may be involved: Vision key, Supabase DB password,
  `FLYER_ADMIN_TOKEN`, `REVENUECAT_WEBHOOK_TOKEN`, OAuth client secrets.
  (Rotation steps: `docs/PUBLISH_CHECKLIST.md` §8A.)
- If a token/endpoint is being abused, disable or tighten it (e.g. flip the
  affected env var off, lower a rate limit, block an IP at the host).
- If the database is implicated, snapshot the production Supabase DB (or the dev
  Supabase project, for dev/test) before any cleanup so forensic state is preserved.
- If the file-based fallback store (`DATA_DIR`) may be exposed, purge it.

## 3. Investigate & scope

Determine **what data, whose, and how much**.

- Search the API-call audit log in the Railway log stream (`{"t":"api",...}`
  lines: `route`, `method`, `statusCode`, `ipHash`, `userSub`, `deviceId`,
  `requestId`, `ts`) to reconstruct the access pattern. Retention is the host
  log stream's (on the order of days) — export what you need promptly; if longer
  retention is needed, point an external log drain at stdout.
- Identify affected users: enumerate impacted `users` / `receipts` /
  `consent_events` rows. Personal data fields by table are catalogued in
  `backend/db/schema.js`.
- Decide RROSH: sensitivity of the data × probability of misuse. Document the
  reasoning either way (you must keep records of breaches **even if** you decide
  not to notify — Law 25).

## 4. Notify (if RROSH confirmed)

Target: within 72 hours of confirmation.

- **Regulators:**
  - Office of the Privacy Commissioner of Canada (PIPEDA breach report form).
  - Commission d'accès à l'information du Québec (CAI) for Quebec residents.
  - Other provincial commissioners (AB/BC) if their residents are affected.
- **Affected individuals** — email (we have addresses) including: what happened,
  what data was involved, when, what we've done, what they should do (e.g. be
  alert to phishing; revoke/re-auth if tokens were involved), and a contact.
- Keep all notifications factual and timestamped.

## 5. Record & remediate

- Log the incident in the breach register (date, scope, root cause, actions,
  notifications sent). Retain per Law 25.
- File the root-cause fix as a tracked issue; add a regression test where
  applicable (mirror `backend/tests/security*.test.js`).
- Post-incident review: what detection/control would have caught it earlier?
  Feed gaps into `SecurityRecommendations.md`.

---

## How to check Railway logs (API audit log relocated here 2026-07-23)

The API-call audit log used to live in the `api_audit_log` DB table; it is now
structured JSON (`{"t":"api","route":...,"method":...,"statusCode":...,
"ipHash":...,"userSub":...,"deviceId":...,"requestId":...,"ts":...}`) written
to stdout, which Railway captures automatically. There is no more DB table or
admin screen to query — use Railway's log stream instead.

**Dashboard (ad hoc lookup):**
1. https://railway.app → the PriceBack project → the backend service
   (`priceback-production` / `priceback-development`).
2. Open the **Deployments** tab → click the active deployment → **View Logs**
   (or the **Observability/Logs** tab on newer Railway UIs).
3. Use the log search box to filter, e.g. `"t":"api"` for audit lines only,
   or `requestId":"<id>"` to pull every log line for one request (the
   `X-Request-Id` response header ties a client report back to server lines).
4. Time-range picker in the same view narrows to an incident window.

**CLI (scripting / exporting a range):**
```
npm i -g @railway/cli   # one-time
railway login
railway link            # select the PriceBack project once per checkout
railway logs            # tails the linked service live
railway logs --json     # newline-delimited JSON, pipeable to jq/grep
railway logs --json | grep '"t":"api"' | jq .
```
`railway logs` only streams/tails — there is no built-in historical export
command. To keep a range longer than Railway's retention, redirect a live
`railway logs --json` tail to a file, or wire an external drain (see below).

**Retention:** Railway's own log retention is on the order of **days**
(exact window depends on plan tier), a regression from the old 90-day DB
window. That's an accepted trade-off for breadcrumbs, not billing data (see
`docs/Bugs_Common_Fixes.md`). If longer retention becomes a requirement, point
an external log drain at the same stdout stream — no application code change
needed, just a Railway project setting (Project → Settings → Log Drains):

| Drain | Free tier available? |
|---|---|
| **Better Stack (Logtail)** | Yes — free tier (as of 2026, ~1GB/day ingest, ~3-day retention on the free plan); paid tiers extend retention. |
| **Grafana Cloud Loki** | Yes — Grafana Cloud's free tier includes a Loki logs allotment (limited GB/month + retention on the free plan). |
| **Axiom** | Yes — has a perpetual free tier with a monthly ingest allowance, aimed at exactly this kind of low-volume app-log use case. |
| **Datadog / Sumo Logic** | Trial only — no meaningful permanent free tier for log retention. |
| Generic syslog endpoint | Free only if you're pointing it at infrastructure you already pay for (e.g. a self-hosted syslog/ELK box); Railway supports the syslog drain format itself. |

Free-tier limits change over time — re-check the provider's current pricing
page before committing to one; treat the table above as a starting shortlist,
not a guarantee.

---

## Quick reference

| Item | Where |
|---|---|
| Credential rotation steps | `docs/PUBLISH_CHECKLIST.md` §8A |
| Personal-data field catalogue | `backend/db/schema.js` |
| Access reconstruction | API audit log — `{"t":"api",...}` JSON lines in the Railway log stream |
| Crash breadcrumbs (PII-scrubbed) | Sentry |
| Deferred hardening backlog | `SecurityRecommendations.md` |
