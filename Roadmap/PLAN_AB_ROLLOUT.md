# Plan A + Plan B — Rollout Steps

Both plans are committed to `main` and merged. Code is dormant until the
steps below are completed.

| Plan | What it does | Code commit |
|---|---|---|
| **A — OCR LLM reconciliation** | When the heuristic parser produces an inconsistent receipt (items missing, totals don't reconcile, mostly placeholder names), POST raw OCR text to Claude Sonnet 4.6 on the backend for a structured second pass. Merges back conservatively. | `d979511` |
| **B — Crowdsourced Costco pricing** | Every opted-in Costco scan contributes `(warehouseId, sku, unitPaid, date)` to the backend. Aggregated as a per-SKU median; serves as the primary price source for Costco price checks, falling back to the sameday.costco.ca scrape only when confidence is low. | `ce1e1bb` |

---

## Step-by-step to go live

### 1. Verify the backend deploy

The new code is already on `main`. Railway should have auto-redeployed.
Confirm:

```sh
curl https://priceback-production.up.railway.app/health
```

Look for:
- `"version": "2.6.0"` (was 2.5.0)
- `"crowdsourcedSkus": 0` and `"totalObservations": 0` (Plan B fields)
- `"ocrLlm": "missing ANTHROPIC_API_KEY env var"` (until step 3)

If still on 2.5.0, trigger a manual redeploy from the Railway dashboard.

### 2. Get an Anthropic API key

1. Go to https://console.anthropic.com
2. Settings → API Keys → Create Key (name: "PriceBack backend")
3. Copy the `sk-ant-...` string — only shown once
4. Settings → Plans & Billing → add ≥ $5 credit. Sonnet 4.6 at our budget
   (~$0.003 per misparse, daily cap of 20/device) means $5 ≈ 1,700 calls.

### 3. Set `ANTHROPIC_API_KEY` on Railway

```
Railway dashboard → priceback-production → Variables → New Variable
  Name:  ANTHROPIC_API_KEY
  Value: sk-ant-...
```

Railway restarts automatically. Verify:

```sh
curl https://priceback-production.up.railway.app/health | grep ocrLlm
# Expect:  "ocrLlm": "configured"
```

### 4. SDK install on Railway

The `@anthropic-ai/sdk` dep is in `backend/package.json`. Railway runs
`npm install` on every deploy, so this is automatic. **The cert error
that hit during local testing was a local-machine-only problem (corporate
CA chain); Railway's environment doesn't have it.**

If Railway's deploy logs ever show install failure, check the build
output for `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — that would be unusual but
fixable by adding `npm config set strict-ssl=false` to the build command.

To install locally (only needed if running the backend on your dev box):

```sh
cd backend
npm install --use-system-ca
# Or if that fails:
NODE_TLS_REJECT_UNAUTHORIZED=0 npm install
```

### 5. New mobile build with the toggles

The Profile screen now has two new toggle rows:
- **Share Costco prices** (people-outline icon) — Plan B
- **AI receipt cleanup** (sparkles-outline icon) — Plan A

Your currently-installed APK (build 16, v2.5.0) doesn't have them.
Ship a new build:

```sh
npm run build:android
# or
eas build --platform android --profile preview
```

Wait for EAS to finish; install the new APK on your device.

### 6. Toggle both features ON

In the app: **Profile** tab → scroll to the menu → toggle:
- ☑ Share Costco prices
- ☑ AI receipt cleanup

The Share Costco modal will appear on your next Costco save instead if
you flip neither toggle but scan a Costco receipt — that's the
first-save consent path.

### 7. Test Plan A — LLM reconciliation

The LLM call fires only on misparses. The 5 trigger criteria
(`isInconsistent()` in `src/services/ocrService.js`):
1. `items.length === 0` AND `rawText.length > 200`
2. `total < itemsSum - 0.01` (impossible)
3. `tax > 0.50` AND `|total - itemsSum - tax| > max(0.50, total * 0.02)`
4. >40% of names match `/^Item #\d+$/`
5. every item priced at $0

To force one: photograph a receipt at a steep angle, scan an out-of-store
receipt, or wait for a real misparse (few % of scans).

Watch Railway logs:

```sh
railway logs --tail
# Look for:
#   [OCR-LLM] OK abcd1234… items=N confidence=0.X
```

Per-receipt sha256 cache is 30 days; per-device daily cap is 20.

### 8. Test Plan B — crowdsourced pricing

Just scan a Costco receipt with the "Share Costco prices" toggle on.
Backend records observations. Watch the counts:

```sh
curl https://priceback-production.up.railway.app/health
# crowdsourcedSkus + totalObservations should go up
```

After ≥3 observations for the same (warehouseId, sku) within 14 days,
that pair flips from "scrape" to "crowdsourced" in `/api/check-price`,
and the **Detail** screen shows a blue "From your warehouse · N obs"
chip when you tap **Refresh prices**.

Your own contribution count:

```sh
curl "https://priceback-production.up.railway.app/api/me/contributions?deviceId=YOUR_DEVICE_ID"
```

(deviceId is the sha256 stored locally under
`AsyncStorage["device_fingerprint_v1"]`.)

### 9. Revoke (Plan B only)

Toggle **Share Costco prices** OFF. The client fires `DELETE
/api/me/observations`, the server scrubs everything tied to your hashed
deviceId, and an Alert confirms the removed count.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/health` still 2.5.0 | Railway hasn't redeployed | Manual redeploy in Railway dashboard |
| `/health` shows `ocrLlm: "missing ANTHROPIC_API_KEY env var"` | Step 3 not done | Set env var, wait for restart |
| LLM endpoint returns `503 "Anthropic SDK not available"` | Install failed on Railway | Check deploy logs for npm errors |
| Mobile shows no toggle | Old APK | Rebuild + reinstall (step 5) |
| LLM never fires despite misparses | Toggle OFF, or `isInconsistent()` not triggering | Check `prefs.ocrLlmFallback`; misparses are <10% of scans |
| Costco price check still says "scrape" | <3 observations or all >14d old | Need more receipts to clear the medium→high confidence threshold |

The two plans are independent — A first, B first, or both in parallel
all work.

---

## Cost expectations

**Plan A (LLM):** ~$0.003 per call (Sonnet 4.6, ~600 input + ~200 output
tokens). Fires on ~5-10% of scans. Hard cap of 20/device/day. With ~100
scans/month from a single user, expect ~$0.03-0.06/month/user.

**Plan B (crowdsourced):** No marginal cost. Backend file storage only
(~200 bytes per SKU observation, capped at 20 obs/SKU). Negligible.

---

## Where the code lives

| Component | File |
|---|---|
| LLM endpoint | `backend/server.js` → `/api/ocr-llm` route |
| LLM schema + system prompt | `backend/server.js` → `LLM_SYSTEM_PROMPT`, `LLM_RECEIPT_SCHEMA` |
| Pure crowdsourcing logic | `backend/warehousePricing.js` |
| Crowdsourcing wired into routes | `backend/server.js` → `/api/watch`, `/api/check-price`, `/api/me/*` |
| Backend tests | `backend/tests/warehousePricing.test.js` (16 tests, `npm test`) |
| Mobile inconsistency detector | `src/services/ocrService.js` → `isInconsistent()` + `reconcileWithLLM()` |
| Mobile pref | `src/services/storageService.js` → `DEFAULT_PREFS.ocrLlmFallback` + `shareCostcoPrices` |
| Mobile toggles | `src/screens/StoresAndProfileScreens.js` |
| Mobile consent modal | `src/screens/ScanScreen.js` → after first Costco save |
| Mobile crowdsourced chip | `src/screens/DetailScreen.js` → check-prices flow |
| Spec (this doc's source) | Earlier conversation; mirrored here for reference |

---

## What we did NOT do (intentional)

- **No Plan A few-shot examples in the prompt.** Sonnet 4.6 handles
  Canadian receipts well without them. Add if you start seeing systematic
  misses on a specific store format.
- **No backfill of existing Costco receipts to Plan B.** Only new scans
  after opt-in get observed. Safer consent story.
- **No Quebec legal review of the consent modal copy.** If you market in
  Quebec heavily, run the French strings past a Quebec consumer-law
  reviewer (separate STORE-04 item in tech debt).
- **No Costco TPD prices in the crowdsourced median.** TPD-discounted
  items are excluded — we want regular prices in the median, not
  promotional ones. The observation count includes only TPD-free items.
