# Google Sign-In / package-rename config recovery

Context: the Android package was renamed **`ca.priceback.app` → `com.priceback`**
in Play Console, and GCP credentials were rotated. That orphaned the Google
Sign-In OAuth client (symptom: **`DEVELOPER_ERROR`** on sign-in) and left
`google-services.json` pointing at the old package.

This doc makes the fix **device-independent**: credentials live in your EAS
cloud env (pullable from any machine with `eas login`), and a committed script
does the work. See `scripts/configure-google-signin.mjs`.

## ACTUAL root cause (resolved 2026-07-06)

Everything in Firebase/GCP already existed correctly (the `com.priceback` app, the
Play SHA-1, and the matching Android OAuth client = `googleClientIdAndroid` in
`common.js`). The break was the **`GOOGLE_SERVICES_JSON` EAS file-secret** still
holding the old `ca.priceback.app` config — EAS injects it via `app.config.js:82`,
ignoring the local repo file. Fix = overwrite that secret (in every environment)
with the correct config, and register each signing SHA-1 so all build types match.

Reference values:

| Field | Value |
|---|---|
| Firebase/GCP project | `priceback-905d4` (number `695135372222`) |
| Package | `com.priceback` |
| Web client ID (`webClientId`) | `695135372222-jgr8klsosbt39o0g9vb7s33md08jql72...` (unchanged) |
| Android OAuth client (`googleClientIdAndroid`) | `695135372222-6ap3mab4i790jv419h9n33msgou9nrs7...` (unchanged) |

Signing SHA-1s registered on the Firebase `com.priceback` app (one per signing context):

| SHA-1 | Signs | Source |
|---|---|---|
| `35:47:ED:80:89:89:EE:9C:85:65:C3:5C:B5:ED:90:88:E8:E9:69:65` | Play production builds | `deployment_cert.der` (Play App Signing) |
| `2D:43:BC:7F:8F:DF:8C:88:6F:D3:9A:7C:42:3C:A8:EC:A2:0B:D5:2B` | EAS dev/preview internal APKs | `npx eas credentials -p android` (upload keystore) |
| `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` | local `manual_build/build-and-install.ps1` | Expo default `android/app/debug.keystore` (universal) |

Play App Signing SHA-256 (also registered): `6E:9F:F1:11:04:C4:76:97:BC:A0:CF:CF:80:F9:72:B3:67:64:80:56:B3:52:4A:B8:66:6A:86:55:5C:BD:67:A7`

### The fix that was applied (repeatable per environment)
```bash
# corrected google-services.json already in repo root
for ENV in production preview development; do
  npx eas env:update --variable-name GOOGLE_SERVICES_JSON --variable-environment $ENV \
    --value ./google-services.json --type file --visibility secret \
    --environment $ENV --non-interactive || \
  npx eas env:create --environment $ENV --name GOOGLE_SERVICES_JSON --type file \
    --visibility secret --value ./google-services.json --non-interactive
done
```
Then add each SHA-1 above in Firebase console → Project settings → `com.priceback`
→ SHA certificate fingerprints → Add fingerprint (auto-provisions its OAuth client).

---

### (Optional) fully-scripted alternative — reference values

| Field | Value |
|---|---|
| Firebase/GCP project | `priceback-905d4` (number `695135372222`) |
| Package | `com.priceback` |
| Play App Signing SHA-1 | `35:47:ED:80:89:89:EE:9C:85:65:C3:5C:B5:ED:90:88:E8:E9:69:65` |
| Play App Signing SHA-256 | `6E:9F:F1:11:04:C4:76:97:BC:A0:CF:CF:80:F9:72:B3:67:64:80:56:B3:52:4A:B8:66:6A:86:55:5C:BD:67:A7` |
| Web client ID (`webClientId`) | `695135372222-jgr8klsosbt39o0g9vb7s33md08jql72...` (unchanged) |

---

## Phase 0 — one-time bootstrap (needs a GCP login ONCE, ever)

This is the only interactive step. After it, every future device just runs the
script. Do it from https://console.cloud.google.com (project `priceback-905d4`):

1. **IAM & Admin → Service Accounts → Create service account**
   - Name: `priceback-config`
   - Grant role: **Firebase Admin** (`roles/firebase.admin`).
2. On the new account → **Keys → Add key → JSON** → download `sa.json`.
3. Store it in EAS so any device can pull it (run from the repo root):
   ```bash
   eas env:create --environment production --visibility secret \
     --name GOOGLE_CONFIG_SA_JSON --value "$(cat sa.json)"
   # mirror to the dev environment too if you build dev APKs:
   eas env:create --environment development --visibility secret \
     --name GOOGLE_CONFIG_SA_JSON --value "$(cat sa.json)"
   ```
4. **Delete the local `sa.json`** (and the temporary `deployment_cert.der` in the
   repo root — it's already captured above). Never commit either.

## Phase 1 — configure sign-in (repeatable, from ANY device)

```bash
eas env:pull --environment production          # writes .env with the secret
export GOOGLE_CONFIG_SA_JSON="$(node -e "require('dotenv').config();process.stdout.write(process.env.GOOGLE_CONFIG_SA_JSON)")"
# (or just paste the value into the shell env)

node scripts/configure-google-signin.mjs --dry-run   # preview
node scripts/configure-google-signin.mjs             # apply
```

What it does, idempotently:
- ensures the Firebase **Android app `com.priceback`** exists;
- registers the **Play App Signing SHA-1** (this AUTO-PROVISIONS the Google
  Sign-In OAuth client — the actual `DEVELOPER_ERROR` fix);
- rewrites **`google-services.json`** from Firebase;
- prints the new **`googleClientIdAndroid`** to paste into
  `config/profiles/common.js`.

### Also register non-Play signing keys
If you install **EAS internal APKs** (preview/dev) directly (not via Play), those
are signed with the EAS upload keystore, not the Play key — add its SHA-1 too:
```bash
npx eas credentials -p android    # copy the SHA-1
EXTRA_SHA1="AA:BB:..." node scripts/configure-google-signin.mjs
```

## Phase 2 — RevenueCat (dashboard-only; ~2 min)

RevenueCat's REST API cannot change a Play app's package or upload Play
credentials, so this stays manual. In https://app.revenuecat.com → your project:
1. **App settings → Google Play app** → set package to `com.priceback`.
2. Re-upload the **Play service-account JSON** (the GCP credential rotation
   invalidated the old one). Grant that service account access in Play Console →
   **Users & permissions** first.
3. Products/entitlements/offerings are unaffected.

Store the RC **secret API key** in EAS (`REVENUECAT_SECRET_KEY`) if you later
want scripted RC reads; the in-app SDK key stays `REVENUECAT_API_KEY`.

## Phase 3 — verify
- `googleClientIdAndroid` in `config/profiles/common.js` matches the script output.
- `google-services.json` `package_name` == `com.priceback`.
- Rebuild (`eas build`) and sign in on a Play-track build → no `DEVELOPER_ERROR`.
