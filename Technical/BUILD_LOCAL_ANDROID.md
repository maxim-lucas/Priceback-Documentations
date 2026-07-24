# Build the Android app locally (no EAS)

The default deployment path uses EAS Build (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).
This doc covers building the **same APK on your own machine** by invoking
Gradle directly. Useful when:

- you want to iterate without burning EAS build minutes / quota,
- EAS is unreachable / offline,
- you need to debug a native-side build error EAS hides, or
- you just want a debug APK to sideload right now.

> **Output (debug APK):**
> `android/app/build/outputs/apk/debug/app-debug.apk`
>
> Debug APKs fetch their JS bundle from Metro at runtime, so you still need
> `npx expo start --dev-client` on the same network as the device.
> If you want a fully standalone APK with the JS bundle baked in, build a
> release APK (see [Release APK](#release-apk-debug-signed) at the bottom).

---

## Prerequisites

Already required (same as EAS):

- Node.js 18+
- `npm install` completed in the repo
- `npx expo prebuild --platform android` once, to generate the `android/`
  folder. It's gitignored (`.gitignore:12`), so a fresh clone has no
  `android/` directory. **Re-running prebuild regenerates the folder from the
  Expo template and wipes the local overrides in
  [One-time setup](#one-time-setup) below — re-apply them after any
  prebuild, or you'll hit the [Windows-ROOT SSL error](#ssl-errors-from-maven-central--foojay-windows-proxyantivirus-tls-interception)
  again.**

Added for local builds:

| Tool | Why | Install |
|---|---|---|
| **Android SDK** | provides `aapt2`, `adb`, build-tools, platform jars | Comes with Android Studio. Default location: `%LOCALAPPDATA%\Android\Sdk` |
| **JDK 21** (Android Studio JBR) | runs Android Gradle Plugin | Installed by Android Studio at `C:\Program Files\Android\Android Studio\jbr` |
| **JDK 17** | required by Expo's `:gradle-plugin:settings-plugin` toolchain; also runs the Gradle daemon (needed because Android Studio's JBR strips the Windows truststore provider — see [SSL gotcha](#ssl-errors-from-maven-central--foojay-windows-proxyantivirus-tls-interception)) | `winget install --id Microsoft.OpenJDK.17 -e --source winget --accept-package-agreements` |

---

## Build config: how local differs from EAS

As of 2026-05-25, the two paths are split cleanly via per-profile config
modules. You do **not** need EAS secrets for the happy path — a freshly
cloned repo can produce a working local APK with no env file at all.

```
config/profiles/
├── common.js   ← shared defaults (backend URL, OAuth web client, contact
│                  emails, Sentry DSN) — applied to both paths
├── local.js    ← this build path. Always routes OCR via the Railway
│                  backend (no Vision key bundled). Reads .env.local for
│                  optional secret overrides (RevenueCat, iOS OAuth, etc.).
├── eas.js      ← EAS Build path. Reads EAS secrets from process.env.
│                  `dev` profile bundles the Vision key; preview/prod don't.
└── index.js    ← picker: EAS_BUILD=true → eas, otherwise → local
```

`app.config.js` is a thin wrapper that loads `.env.local` + `.env`, asks the
picker for the resolved config, and spreads it into Expo's `extra` block.

### What a local APK gets out of the box

| Concern | Default behavior in a local APK |
|---|---|
| Backend (`/api/*` calls) | `priceback-production.up.railway.app` |
| Receipt OCR | POSTs to `/api/ocr` — Railway holds the Vision key server-side |
| Sentry crash reports | Lands in `prosoft-inc/priceback-canada` (same as prod) |
| Google Sign-In (web + Android OAuth client) | Works — public client IDs in `common.js` |
| Paywall / RevenueCat | **Gated off** — free-tier limits apply until you set `REVENUECAT_API_KEY` |
| Outlook email sync | **Hidden** — until you set `MICROSOFT_CLIENT_ID` |
| iOS sign-in | Placeholder — set `GOOGLE_CLIENT_ID_IOS` if you build for iOS |

If those defaults are enough, skip the rest of this section and jump to
[Build commands](#build-commands). If you want a fuller-featured local
build (e.g., test the paywall, swap in a different backend), drop the env
vars into `.env.local` per [.env.example](../.env.example).

### Optional: mirror EAS preview secrets into `.env.local`

For a local build that matches the EAS `preview` profile feature-for-feature:

```powershell
npm run env:pull
```

That wraps `eas env:pull --environment preview`. It writes a gitignored
`.env.local` at the repo root and downloads file variables into `.eas/.env/`
(also gitignored). `app.config.js`'s dotenv loader picks them up on the
next build.

This is a convenience, not a requirement. It does **not** affect OCR (local
builds route OCR through Railway regardless of what's in `.env.local`).

### Google Sign-In on locally-built APKs (one-time GCP setup)

`npm run env:pull` only solves the secrets gap. Google Sign-In via
`@react-native-google-signin/google-signin` v16 uses Android Credential
Manager, which verifies the calling app by looking up its package +
signing-cert SHA-1 against the **Android OAuth clients in GCP** (project
`priceback-905d4`). Out of the box, the only Android OAuth client there is
`Priceback-Android`, registered with EAS's upload-keystore SHA-1 — so EAS
APKs work but locally-built APKs (signed with the stock debug keystore)
return `DEVELOPER_ERROR`.

**Do not edit the existing `Priceback-Android` client** — its single SHA-1
slot must keep matching EAS's upload key, or EAS / Play Store builds break.
Instead, create a **second** Android OAuth client (GCP supports multiple per
package, one per fingerprint):

1. https://console.cloud.google.com/apis/credentials?project=priceback-905d4
2. **+ CREATE CREDENTIALS** → **OAuth client ID** → Application type
   **Android**.
3. Fill in:
   - **Name:** `Priceback-Android-LocalDebug` (label only)
   - **Package name:** `com.priceback`
   - **SHA-1 certificate fingerprint:**
     `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
     (the stock Android SDK debug keystore — same on every dev machine, not
     a secret)
4. **CREATE**. Propagation is ~1-5 min.

Trap to skip: adding the SHA-1 to **Firebase Console** → Android app
fingerprints feels like it should work, but Firebase only updates its own
list + regenerates `google-services.json` — it does **not** push new SHAs
into the GCP Android OAuth client. Credential Manager only consults GCP, so
the Firebase entry alone is ignored. Use the GCP Console route above.

To re-derive the SHA-1 if you ever rotate or recreate your debug keystore:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -list -v -keystore android\app\debug.keystore `
  -alias androiddebugkey -storepass android -keypass android |
  Select-String -Pattern "SHA1:"
```

---

## One-time setup

These three files configure Gradle to find the SDK + correct JDK without
needing global `JAVA_HOME` / `ANDROID_HOME` env vars.

> **Two of them — `android/local.properties` and the additions to
> `android/gradle.properties` — live inside the gitignored `android/` folder
> and are wiped every time you run `expo prebuild`.** Re-apply the edits
> below after any prebuild. The user-level `gradle.properties` (step 3)
> persists across prebuilds.

### 1. `android/local.properties` — Android SDK location

Already in `.gitignore` (per Android convention). Create it once:

```properties
sdk.dir=C\:\\Users\\Maxim\\AppData\\Local\\Android\\Sdk
```

Adjust the path if your SDK lives elsewhere.

### 2. `android/gradle.properties` — JDK 17 daemon + truststore

`expo prebuild` regenerates this file from the Expo template, so you must
**re-apply** these two additions after each prebuild:

```properties
# JDK 17 runs the Gradle daemon (also satisfies Expo's settings-plugin
# toolchain spec without auto-download). JBR is unsuitable — it strips the
# SunMSCAPI provider, breaking Windows-ROOT below.
org.gradle.java.home=C:/Program Files/Microsoft/jdk-17.0.19.10-hotspot

# Delegate Java TLS trust to the Windows certificate store. Required because
# the user-level gradle.properties already sets this JVM arg, and project-
# level jvmargs override user-level — so without re-adding it here, the
# daemon JVM never receives the Windows-ROOT directive.
# (Also harmless on networks without AV/proxy MITM.)
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m \
  -Djavax.net.ssl.trustStoreType=Windows-ROOT
```

If your Microsoft JDK installed to a different version directory, update the
path (`Get-ChildItem 'C:\Program Files\Microsoft'` to confirm).

### 3. `%USERPROFILE%\.gradle\gradle.properties` — user-wide toolchain hints

Needed once per user account. Put the toolchain discovery info here so
**included builds** (Expo's composite `:gradle-plugin:*` projects) inherit it:

```properties
org.gradle.java.installations.paths=C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot,C:\\Program Files\\Android\\Android Studio\\jbr
org.gradle.java.installations.auto-download=false
```

`auto-download=false` prevents Gradle from trying foojay.io (which is
typically blocked or MITM'd on developer networks); we tell it to use only
the JDKs you already have on disk.

---

## Build commands

Run all of these from the repo root in **PowerShell**.

### Debug APK (fastest)

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
cd android
.\gradlew.bat assembleDebug --console=plain
```

First cold build: **8–15 min** (downloads AGP, Kotlin, react-native, all
expo modules, plus CMake-compiles `react-native-reanimated` and
`expo-modules-core` per ABI). Subsequent builds: **30–90 s** incremental.

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

To watch progress without scrollback noise, write to a log and tail:

```powershell
cmd /c ".\gradlew.bat assembleDebug --console=plain > build-debug.log 2>&1"
# in another terminal:
Get-Content android\build-debug.log -Wait -Tail 40
```

### Install + run on a connected device

```powershell
# device plugged in via USB with Developer Options + USB debugging on
adb devices                                          # confirm it's listed
adb install -r android\app\build\outputs\apk\debug\app-debug.apk

# in another terminal, serve the JS bundle:
npx expo start --dev-client
```

The app will hot-reload from Metro just like an Expo Go session, but with
all native modules included.

### Release APK (debug-signed)

Useful for internal QA — minified and Hermes-precompiled, but signed with
the bundled debug keystore (so **not suitable for the Play Store**):

```powershell
cd android
.\gradlew.bat assembleRelease --console=plain
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

This APK has the JS bundle embedded — no Metro needed at runtime.

### Release APK / AAB (production-signed)

For a Play-Store-quality artifact you'd need to wire `signingConfigs.release`
in `android/app/build.gradle` to the real keystore (`@maximlucas__priceback-canada.jks`
at repo root) — currently the file signs release builds with the debug key.
That's the same artifact EAS's `production` profile produces; it's outside
the scope of this doc — use EAS for now (`npx eas build --platform android
--profile production`) or open a follow-up to add a local signing config.

---

## Troubleshooting

### `Cannot find a Java installation … matching: {languageVersion=17}`

Foojay (Gradle's auto-download service) is unreachable or being TLS-blocked.

```
Some toolchain resolvers had internal failures: foojay
((certificate_unknown) PKIX path building failed …)
```

**Fix:** confirm you ran step 1 (install JDK 17) and step 3 (user-level
`gradle.properties` with `installations.paths` + `auto-download=false`).

### SSL errors from Maven Central / foojay (Windows + proxy/antivirus TLS interception)

Two flavors of the same root cause — Gradle's JVM can't verify HTTPS to a
Maven repo. Common stacktraces:

**Flavor A** — PKIX (cert chain not trusted, typical when AV/proxy is MITMing):
```
Got SSL handshake exception during request.
(certificate_unknown) PKIX path building failed:
sun.security.provider.certpath.SunCertPathBuilderException
```

**Flavor B** — Windows-ROOT not found (the user-level `Windows-ROOT` JVM arg
is set but the daemon is running on JBR, which lacks `SunMSCAPI`). Often
surfaces as a failed dep resolution like:
```
Could not resolve org.bouncycastle:bcprov-jdk15to18:[1.81,1.82).
  > Failed to list versions for org.bouncycastle:bcprov-jdk15to18.
     > Unable to load Maven meta-data from https://repo.maven.apache.org/...
        > org.apache.http.ssl.SSLInitializationException: Windows-ROOT not found
```
This is the form you hit immediately after `expo prebuild` — the template
reset wiped `org.gradle.java.home` from `android/gradle.properties`, so the
daemon defaulted back to JBR. Re-apply step 2 of [One-time setup](#one-time-setup).

Your browser works because Windows trusts the proxy/AV root CA. Java has its
own truststore (`cacerts`) that doesn't.

Diagnose what's signing requests:

```powershell
$r = [Net.HttpWebRequest]::Create('https://repo.maven.apache.org/maven2/')
$r.Timeout = 10000
try { $r.GetResponse() | Out-Null } catch { }
"Issuer: $($r.ServicePoint.Certificate.Issuer)"
```

If the issuer is `CN=AVG Web/Mail Shield Root`, `CN=Zscaler Root CA`,
`Symantec Web Security`, or similar — that's the MITM.

**Fix:** the `Windows-ROOT` truststore setting in `android/gradle.properties`
(step 2) delegates to the Windows store, where the AV root already lives.
It only works on JDKs that ship the `SunMSCAPI` provider (Microsoft OpenJDK,
Adoptium Temurin, Oracle JDK — **but not Android Studio's JBR**), which is
why we route the daemon through Microsoft JDK 17 via `org.gradle.java.home`.

If you're seeing `Windows-ROOT not found`, your daemon is running on JBR.
Confirm `org.gradle.java.home` in `android/gradle.properties` points at the
Microsoft JDK.

### `> Task :app:packageDebug FAILED — INSTALL_PARSE_FAILED_NO_CERTIFICATES`

The debug keystore went missing.

```powershell
keytool -genkeypair -v -keystore android\app\debug.keystore `
  -storepass android -alias androiddebugkey -keypass android `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -dname "CN=Android Debug,O=Android,C=US"
```

### `JAVA_HOME is set to an invalid directory`

Your shell's `JAVA_HOME` env var points somewhere else. The repo-level
`gradle.properties` overrides what Gradle uses, but `gradlew.bat` checks
`JAVA_HOME` first. Either unset it for the session:

```powershell
Remove-Item Env:JAVA_HOME
```

…or point it at the same JDK 17:

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
```

### Build hangs forever on `> IDLE`

Gradle daemon stalled. Kill and retry:

```powershell
cd android
.\gradlew.bat --stop
.\gradlew.bat assembleDebug --no-daemon --console=plain
```

`--no-daemon` forces a single-use JVM (slightly slower, but reliable).

---

## What this gives up vs. EAS

| Feature | Local | EAS |
|---|---|---|
| APK / AAB output | ✅ same artifact | ✅ |
| Signing with your release keystore | ⚠️ requires editing `build.gradle` | ✅ automatic |
| Sentry DSN | ✅ in `config/profiles/common.js` (public ingest token) | ✅ |
| Google Sign-In OAuth clients | ✅ web + Android in `common.js`; iOS via `.env.local` | ✅ |
| OCR (Google Vision) | ✅ routed through Railway backend — no key bundled | ✅ |
| RevenueCat / Microsoft / Veryfi keys | ⚠️ gated off until you put them in `.env.local` (optional) | ✅ via EAS Secrets |
| `google-services.json` | ⚠️ committed placeholder works for everything except Sign-In on locally-signed APK (see below) | ✅ |
| Update channels / OTA via `expo-updates` | ❌ | ✅ |
| Submit to Play Store | ❌ (build it, upload manually) | ✅ `eas submit` |
| Build minutes / quota | none — your CPU | metered |

For day-to-day debugging and sideload testing, local is faster and free.
For shipping, EAS still wins because of secrets + signing + submit.
