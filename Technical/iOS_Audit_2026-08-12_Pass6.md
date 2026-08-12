# iOS audit #6 — the paths the first five never walked

**Date:** 2026-08-12
**Branch / PR:** `audit/ios-pass6-push-i18n-health-retention` → Priceback#258
**Scope asked for:** a deep iOS-focused pass over security, authentication,
credit management, RevenueCat, account management, receipt scans and price-tag
scans, plus an iOS/Android behavioural comparison; document whatever is not
fixed; **do not re-open anything the earlier audits already documented.**

**Result: ten new findings, all fixed.** Two independent re-verifications of
earlier work. Nothing carried forward from passes #1–#5 was re-investigated.

---

## Why this pass could find anything at all

Five audits is a lot of coverage, and their *Verified clean* registers exist
precisely so a sixth does not re-read the same files. Between them they had
already settled Apple token verification, first-party sessions, keychain
accessibility, account deletion and Apple revocation, RevenueCat transfer /
sandbox / webhook replay, credit atomicity and the offline spend buffer, the scan
queues, the price-tag presign, and a 35-site `Platform.OS` inventory.

So the useful question was not "what did they get wrong" but **"what did none of
them look at."** Five areas answered that:

1. the **server-side identity/profile write path** — the eleven callers of
   `upsertFromOAuth` and what they do to a row when they carry no identity;
2. the **portability export** — read as an artifact a regulator receives, not as
   a route;
3. the **object-store presign and retention model** — who can write, how much,
   and what can still delete it afterwards;
4. **filesystem backup exposure** — what leaves the device without a network
   call;
5. the **one server push that never got localized**.

Four of the ten findings came from asking a different question about code the
earlier passes had read: *not "is this route authorized?" but "does this write
preserve what it wasn't given?"*

### Two re-verifications, so pass #7 need not redo them

- **The `Platform.OS` divergence inventory from pass #5 is still current.** The
  site count is still exactly **35**, and spot-checking confirmed no new
  branches. Pass #5's table stands as written.
- **The crowd-verification Sybil defence genuinely holds.** `priceDropRepo`'s
  rule-of-N counts `COALESCE('usr:' || r.user_sub, 'usr:' || d.owner_sub,
  'anon')`, so a single actor rotating the client-chosen `deviceId` collapses to
  one contributor and cannot manufacture consensus. Reaching N needs N real
  accounts or an admin bypass. This was worth re-testing because a client-supplied
  identifier feeding a trust threshold is exactly the shape that usually *is*
  broken.

---

## Findings at a glance

| # | Finding | Severity | Platform | Status |
|---|---|---|---|---|
| **H1** | The verified price-drop push and the credit-charge push are hardcoded English, with locale-blind money | High | Both | Fixed |
| **H2** | `/health` cannot tell an operator whether Apple credential revocation works | High | iOS | Fixed |
| **H3** | The account purge orphans every receipt photo; receipt images have no age-based retention | High | Both | Fixed |
| **M1** | Queued and persisted scan photos ride into iCloud / Google Drive backups | Medium | Both (iOS-flavoured) | Fixed |
| **M2** | The receipt image presign has no size cap, while its price-tag twin does | Medium | Both | Fixed |
| **M3** | `upsertFromOAuth` destroys `name`/`picture` on every call that lacks them | Medium | Both, iOS-amplified | Fixed |
| **M4** | The portability export builds `identity` from the token, not the row | Medium | iOS | Fixed |
| **L1** | `pushToken` and `postalCode` are written unvalidated | Low | Both | Fixed |
| **L2** | `devices.owner_sub` transfers silently on assertion | Low | Both | Fixed |
| **L3** | `/api/me/data-export` is the only unthrottled expensive route | Low | Both | Fixed |

Plus one minor, additive, found while writing a test: `creditRateLimited` was the
only limiter emitting neither `code: "RATE_LIMITED"` nor a `Retry-After` header.

---

## H1 — the flagship push was never localized

`backend/priceDropNotifier.js:236-242`, `:283-284`, with a local `_money` at
`:78`:

```js
? "Verified by PriceBack"
: `Verified by ${d.contributors} shoppers in ${d.provinceCode}`;
title: `${URGENCY_EMOJI[tier]} Price drop on ${d.displayName}`,
body:  `Now ${_money(d.newPrice)} (save ${_money(savings)}). ${verifiedBy}.`,
...
title: "💳 Price-drop credits used",
body:  `${credits} credit${credits === 1 ? "" : "s"} went toward unlocking …`,
```

Audit #3's **S4** introduced `backend/lib/pushI18n.js` for exactly this defect and
swept the server's pushes into it. This file was missed — and it is the one that
matters most. The verified price-drop alert *is* the product's core promise, and
the charge notice is the only message that tells a user credits left their
balance. Every other server push — flyer deal, referral, tag verified, low
balance — routes through `pushI18n` (`server.js:4222`, `:4751`, `:4781`, `:4804`).

A French-Canadian user, in the home market, therefore fixed their in-app
notification language and kept receiving English for the two notifications they
were most likely to act on. Both platforms.

**The fix** adds `verifiedDrop.*` and `dropCharge.*` key sets in EN + FR. They are
deliberately *not* a reuse of the existing `priceDrop.*` keys: those belong to the
legacy in-memory sweep in `server.js:6569` and carry a different message (store
rather than item, no "verified by" clause). Sharing them would let an edit to one
sender silently rewrite the other. `languageByToken` gained an optional `tokens`
argument — defaulted off so the existing bulk-sweep caller is untouched — and the
notifier passes the tokens it will actually push, matching
`notificationSettingsRepo.settingsByToken`, because an unscoped read grows with
every signup whether or not the sweep touches them.

### Why the existing guard did not catch it, and what that teaches

`pushI18n.test.js` already carried a source sweep asserting *"no bare literal
survives in a user-facing push the server sends"*. It read `server.js` **alone**.

This is the same lesson pass #5 recorded for N1 — *a "verified clean" line is only
as wide as the sweep behind it* — now proven a second time against a test rather
than a claim. The guard now derives its file list from every backend file that
calls `sendPushNotificationsAsync`, so a third sender is covered before anyone
writes it, and a meta-assertion fails if that list ever collapses back to one file.

**One detail worth keeping.** The prose heuristic alone would *still* have missed
the drop body. It looks for two adjacent plain words, and
`` `Now ${_money(x)} (save ${_money(y)}). ${verifiedBy}.` `` has none — every
whitespace boundary has an interpolation on one side. What actually catches it is
the second guard added here: **a push-sending file that defines its own money
formatter and never calls `pushI18n.formatMoney`.** Both checks are load-bearing;
either alone lets this class back in.

---

## H2 — a health check that could not fail

`backend/server.js:2807`:

```js
const appleAuthCheck = { status: "configured", audience: APPLE_BUNDLE_ID };
```

`status` is a string literal. `APPLE_BUNDLE_ID` (`:167`) falls back to
`"com.priceback"`. There is no input under which this check reports anything but
green.

What it cannot see is the thing that is genuinely missing today:
`backend/lib/appleRevoke.js` exports `isConfigured()` — checking
`APPLE_SIGNIN_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIGNIN_PRIVATE_KEY` — and **nothing
in the codebase calls it.** Without that trio, `DELETE /api/me/account` cannot
revoke the Apple credential, which is an App Store **Guideline 5.1.1(v)** failure.
The `.p8` key downloads exactly once, so "we forgot" is discovered at submission,
not at deploy.

**This is the third time this codebase has shipped a config-presence check where a
capability check was needed** — after the Google iOS client ID (audit #3, where a
bare audience *count* read "configured" while every iPhone got a 401) and the
session secret (audit #4's A7). The pattern is stable enough to name: *a check
must report whether the feature works, not whether one variable is set.*

The fix reports the conjunction, **degrades rather than failing**, leaves
`healthy` untouched (an iOS-only readiness gap must not flap Railway's deploy
gate), and keeps the named blocker admin-only — the verdict is public so a release
check is one anonymous `curl`, the reason is not.

**Ops consequence:** `GET /health` with `x-admin-token` on both Railway services
should report `checks.appleAuth.revocation: "missing"` today. That is the change
working, not a new problem.

---

## H3 — the account purge orphaned every receipt photo

Two facts that only bite together.

`jobs/purgeDeletedAccounts.js` hard-deletes the tombstone 30 days on, *"and, via
FK cascade, anything still hanging off it"* — including `receipts`, and with them
`receipts.image_object_key`. `jobs/pruneReceiptImages.js` found objects to delete
**through that column**.

So the ability to delete what we had stored rested entirely on
`RETENTION_DELETED_RECEIPT_IMAGES_DAYS` (7) staying below `DELETION_GRACE_DAYS`
(30). Both are independently tunable `app_config` values. Nothing enforces the
inequality, nothing warns when it is broken, and the old job's own docstring asked
a future maintainer to *"keep the window well under DELETION_GRACE_DAYS"* — a code
comment doing a constraint's job. Raise the first above the second in the DB and
every subsequent deleted account's photos are orphaned in the bucket permanently,
at cost, with no error anywhere.

Separately, a **live** receipt's photo had no age cap at all.

### What was built, and why it is shaped this way

`object_retention` (migration `0005`) records every object key at **presign
time** — before the object can exist — and carries **no foreign key to `users`**.
That absence *is* the design: it is the one thing a cascade cannot reach. The
headline test hard-deletes a user, confirms the receipt and its `image_object_key`
are gone, and asserts the ledger row is still present and still sweepable by age.

Recording at presign rather than at upload-confirm is deliberate: an upload that
succeeds but never confirms is still reachable, and deleting an object that was
never uploaded is a no-op on both R2 and GCS. Re-recording a key keeps its
**original** `created_at`, because the receipt route re-presigns on every POST for
the same (deterministic) key — refreshing the clock would let a client hold a
photo alive indefinitely by re-syncing.

A one-time backfill covers both existing key columns, aged from the owning row's
timestamp rather than `now()`, so nothing already stored is granted a fresh full
window.

### The retention model this unblocks

Per the product decision taken during this audit, receipt and price-tag photos are
now **kept deliberately** — through receipt deletion *and* account deletion — and
expire by age alone (`RETENTION_RECEIPT_IMAGES_DAYS`, default 90, app_config
tunable). Both sweeps run off the one ledger, so the twins cannot drift;
`pruneTagPhotos` was already a pure age sweep, which is exactly why its receipt
twin stood out.

Two consequences were handled rather than left to be discovered:

- **A live receipt can now outlive its photo.** `GET /api/receipts/:id` presigns
  from `image_object_key`, so the sweep clears that column for whatever still
  points at a purged object — otherwise the detail screen gets a URL for a missing
  object, i.e. a *broken* image rather than an absent one. The client already
  handles a null `imageUrl`.
- **A failed object delete is never marked erased.** The ledger row is the erasure
  audit trail; a row claiming an object is gone while it sits in the bucket is
  worse than a retry.

### The claim the app makes had to change with it

`profile.deleteAccountBody` promises *"We'll erase your profile, credits, history,
watched items, and contributions."* A user reasonably reads that as covering their
receipt photos. Retaining them is a defensible business decision — but shipping it
without saying so would leave an in-app claim the backend no longer honours. The
deletion screen therefore states the window, in **EN and FR**, driven from the same
`app_config` value the sweep reads, so changing the number is a DB row and the copy
follows.

---

## M1 — the photos also rode into iCloud and Google Drive

Captures are written to `documentDirectory/receipts_pending/`
(`receiptScanQueue.js:66-87`), `documentDirectory/tags/` (`tagScanQueue.js:65-86`)
and `documentDirectory/receipts/`. Nothing set `NSURLIsExcludedFromBackupKey`, and
`app.json` set neither `android.allowBackup: false` nor `dataExtractionRules`.

The striking part is that **the codebase already knew.** `src/services/autoCrop.js`
lines 70-95 state it as fact — *"That is permanent storage, it is included in
iCloud/iTunes backups by default"* — because audit #4's **S2** swept the document
scanner plugin's **orphan** captures out of `Documents/` for exactly this reason.
The same comment names `receipts/`, `receipts_pending/` and `tags/` as *"ours"* and
deliberately does not recurse into them. The orphans were fixed; the live photos —
the ones the user actually scanned — were not.

**This matters more after H3, not less.** Receipt photos are now retained on a
published schedule. A copy sitting in the user's own iCloud or Drive backup is
outside that schedule and outside our control: we would purge at 90 days while an
indefinitely-old copy survives, which makes the window we just wrote into the
deletion screen untrue. Excluding these directories is what keeps that promise
honest. On iOS it also settles a standing Apple *Data Storage Guidelines* exposure
— `Documents/` full of transient scan queues is the classic finding.

### Correcting my own first read of the blast radius

The initial plan assumed turning Android backup off would strand the photos. **It
does not**, and the correction is worth recording because it changed the decision:

- `GET /api/receipts/:id` already returns a presigned GET (`server.js:7044`);
- `syncService.mapServerReceiptToLocal` sets `imageUri: null` with the comment
  *"the image lives in R2; DetailScreen fetches a presigned URL on open"*.

So a synced receipt's photo is recoverable on a fresh device with no OS backup at
all. What `allowBackup: false` genuinely costs is narrower and worth stating
exactly: photos of receipts that **never synced**, the pending-queue captures
(drained on next launch anyway), and the local OCR cache.

### The iOS half needed a config plugin

`expo-file-system@55` exposes no JS API for the flag, so
`plugins/withIosBackupExclusion.js` patches `AppDelegate.swift` via
`CodeGenerator.mergeContents` — idiomatic here alongside
`withIosPrivacyStringCleanup` and `withIosModularHeaders`.

Two implementation points:

- **It creates each directory before flagging it.** `setResourceValues` fails on a
  missing path, and the JS side creates these lazily on first use. Without the
  create, the flag silently does nothing and the first scan lands in an
  unprotected directory.
- **It fails soft at every step.** A non-Swift AppDelegate or a missing anchor both
  warn and return the file untouched. Nothing in this project has ever run on an
  iPhone, so the guarantee worth having is that the worst case is exactly today's
  behaviour — never a broken build, never a broken scan.

Verified against a realistic Expo 55 Swift `AppDelegate`: the merge lands inside
`didFinishLaunchingWithOptions` and is idempotent across prebuilds.

---

## M2 — the receipt presign had no size cap

`server.js` minted `getPresignedPutUrl(key, "image/jpeg")` with no length. Audit
#4's **S4** capped the **price-tag** presign at `MAX_TAG_IMAGE_BYTES` (12 MB) *and*
gated it on a signed-in account; `MAX_RECEIPT_IMAGE_BYTES` did not exist. The
receipt route is authenticated, so this is not anonymous — but it is by far the
busier of the two twins, and any signed-in account could PUT an object of arbitrary
size into the production bucket.

**"The same hardening applied to one of two identical routes" is now a named defect
class here**, so the fix was not a second copy of the check. Both routes share one
`imagePresignDecision`, and the test asserts *both* call sites go through it and
that no route computes a cap inline — a test exercising only the receipt route
would pass again on the next drift.

Three outcomes, and the middle one is the deliberate compromise: a declaration
within the cap pins `Content-Length` exactly; **no** declaration still gets an
unbounded URL, because breaking image upload for builds already in the field to
close an authenticated-abuse vector is the wrong trade and the branch retires by
itself; a declaration over the cap is **refused**, because falling back to
unbounded would make the cap advisory.

**The test earned its keep on the first run.** It failed immediately: `Number(null)`
and `Number("")` are both `0`, which is finite, so an explicit `imageBytes: null`
was read as "declared zero bytes" and refused. Absence is now checked before
coercion — the same trap `pushI18n.formatMoney` documents in its own comment, and
one the tag route had carried latently since S4.

---

## M3 — an upsert that erased the fields it was not given

`backend/repos/usersRepo.js`:

```js
email:   email || sql`${users.email}`,   // preserved
name:    name || null,                    // wiped
picture: picture || null,                 // wiped
```

`email` was deliberately protected. Its two siblings, one and two lines below,
were not. `upsertFromOAuth` has eleven call sites and two of them can *never*
supply identity:

- the **RevenueCat webhook** (`server.js:5055`) passes
  `{ email: null, name: null, picture: null }` by design — so a paying customer's
  name and picture were erased on **every renewal event**, on both platforms;
- a **first-party session token** carries `name: null` by design (`server.js:229`)
  — it asserts identity, not profile — so once `SESSION_TOKEN_SECRET` is set,
  every session-authenticated iPhone request wipes them.

Apple never returns a name in the identity token after the first authorization, so
an Apple account's `users.name` is null regardless; the client keeps its own copy
in the keychain (`authService.js:399-405`), which is why no screen has ever looked
wrong and why this survived five audits.

Nothing depended on the clearing behaviour: `requestDeletion` does not null these
fields, and the 30-day purge removes the whole row. The regression the fix could
plausibly cause — *preserve* becoming *freeze* — is asserted against: a real
sign-in with a changed name still updates it.

---

## M4 — the portability export built `identity` from the token

`server.js`:

```js
identity: { sub: req.user.sub, email: req.user.email, name: req.user.name },
```

On a first-party session token both fields are `null` by design. So on iPhone the
PIPEDA §9 / Law 25 §27 / GDPR Art 20 artifact shipped with **no name and no
email** in it. Compounded by M3, which had already erased the name from the row.

It reads the stored row now. The token remains the authority on *who is asking* —
every read in the route is scoped by `req.user.sub` — it was simply never the
authority on what we stored about them. Asserted for both credential kinds, so the
fix cannot be misread as "iOS reads the row, Android reads the token".

---

## L1, L2, L3 — three smaller writes

**L1 — `pushToken` and `postalCode` written raw.** `POST /api/watch` has always
applied `Expo.isExpoPushToken` to the same value; `PUT /api/me/profile` did not.
Junk is now ignored and logged rather than written — so a bad write cannot silently
unsubscribe a user from every notification — and an explicit `null` still clears,
which sign-out depends on. `postalCode` is bounded and charset-checked rather than
matched against the Canadian pattern: `countries` is a real table and a rule
rejecting a US ZIP becomes a bug on the first expansion. What it stops is the actual
defect — arbitrary unbounded content in a column the iOS privacy manifest declares
as `PhysicalAddress`.

**L2 — device ownership transferred on assertion.** All three `devicesRepo` upserts
let any non-null `ownerSub` win, with no check that the device was unowned or
already the caller's. Downstream, `callerOwnsDevice` then authorised `DELETE
/api/me/observations` against the previous owner's entire crowdsourced
contribution history.

The fix is `COALESCE(existing, new)`, and it is **not a new policy**: it is exactly
the rule `callerOwnsDevice` already applies (refuse when owned by someone else,
claim only when unowned). The repo was the one path that disagreed with it — and it
ran *first*, which is what made the guard bypassable. Exploitation needs the
victim's `deviceId`, a hashed value never published, so this is hardening rather
than a live hole; it is recorded because the legitimate case (a handed-down phone)
and the hostile one are indistinguishable from the server. Keeping a stale owner
costs little: `resolveScanOwner` prefers the Bearer token, so a signed-in user on a
resold phone is credited correctly regardless, and account deletion removes the row.

**L3 — the export was the only unthrottled expensive route.** Every money and auth
sibling carries `creditRateLimited`. One export call reads up to 500 receipts with
items, the whole credit ledger, consent history and referrals. Budget is generous
on purpose: a portability request is deliberate and rare, and a user retrying a
failed download must not be refused.

---

## Verified clean in this pass

Recorded so pass #7 does not re-investigate.

**Backend authorization surface.** All 63 routes were enumerated and their guards
read. The two admin gates are sound: `_adminTokenOk` charges its per-IP throttle
*before* the constant-time compare and refunds on success (so the 401/429 boundary
is not an oracle and correct credentials cannot self-lock), and the account-gated
admin routes check `configService.getAdminSubs().includes(req.user.sub)` after
`requireAuth`. Every unauthenticated write path — `/api/observations/tag`,
`/api/watch`, `/api/analytics`, `/api/device/sync`, `/api/device/scan`,
`/api/ocr`, `/api/ocr-llm`, `/api/check-price` — carries a per-IP brake, and the
tag route additionally carries a per-device one with a 5× IP headroom for warehouse
NATs. `DELETE /api/me/observations` has a real IDOR guard.

**Apple token verification.** `lib/appleAuth.js` pins RS256 (no `alg: none`, no
HMAC confusion), requires a `kid`, verifies against Apple's live JWKS with exactly
one refetch on a rotation miss, and validates `iss` / `aud` / `exp` / `iat` with
60 s of skew. The audience is required, not optional. `email_verified` is read as
`=== true || === "true"`, which correctly handles Apple's string quirk — a
plausible critical (every Apple user silently getting 0 trial credits) that is
**not** present.

**Crowd verification.** See the re-verification above: the rule-of-N Sybil defence
holds against `deviceId` rotation.

**Client-side subscription trust.** `POST /api/me/subscription/sync` does not
trust the client's claimed tier — it re-fetches the subscriber from RevenueCat's
REST API with the secret key, on an 8 s budget, rate limited at 10/min per account.

**RevenueCat identity binding.** `bindRevenueCatToUser` → `logIn(sub)` on sign-in
and `unbindRevenueCatUser` → `logOut()` + clearing local premium on sign-out, so
the next account on a device cannot inherit a cached entitlement.
`_applyCustomerInfo` deliberately never treats the *absence* of an entitlement as
a downgrade — `reconcileWithServer` owns downgrades against the authoritative
server — so a transient RC cache miss cannot drop a paying user to free.

**Keychain.** `secureStore.js` remains correct, including the migration's
read-before-delete ordering and its distinction between "the key is absent" (skip,
don't hold the flag back) and "the read threw" (defer, come back later).

**`authedFetch` / session handling.** The identity-mismatch check is phrased as
"is this *definitely* someone else's" rather than "is this definitely mine", and
that asymmetry is correct: an unreadable token must not sign a user out of a good
session. The 401 retry re-issues the same *kind* of credential that was rejected
and falls back to the provider token rather than retrying blind.

---

## Documented, not fixed

- **Carried forward, unchanged:** iOS background execution remains materially
  weaker (`checkAllPriceDrops` runs only inside the background-fetch task); P3's
  app-switcher overlay still needs a handset; the IDFV-vs-SSAID device-identity
  asymmetry stands. All three are pass #4/#5 items and were explicitly out of
  scope here.
- **`requestDeletion` does not null `email` / `name` / `picture`**, although the
  route docstring says deletion "wipes the user's personal data". Retaining the
  email for the 30-day grace window is **load-bearing** — `findActiveAccountByEmail`
  and `emailEverGrantedTrial` need it to stop trial-credit farming across a
  delete-and-resignup — and the whole row goes at the hard purge. Code/comment
  drift, not a defect; recorded so it is not "fixed" into a regression later.
- **`/api/me` reactivates a soft-deleted account unconditionally**
  (`reactivate: true`), bypassing the `reason=signin` gate that audit #4's A2
  introduced on `/api/me/bootstrap`. It is dormant — the mobile client never calls
  `/api/me` — and the route's comment claims the exemption deliberately as "the
  identity route". Worth knowing before anything starts calling it.
- **The `.p8` key and `SESSION_TOKEN_SECRET` remain unset.** Now visible in
  `/health` rather than only in someone's memory (H2).

---

## Regression risk, stated proactively

| Change | What could regress | How it is controlled |
|---|---|---|
| **H1** | A missing key renders the key name into a push. | `t()` falls back active → English → key, never blank; parity asserted per-key in both blocks; the behavioural test matches real French copy, not truthiness. |
| **H2** | A health check that refuses something. | Report-only; no route reads it; `healthy` explicitly asserted unchanged between configured and degraded. |
| **H3** | An age sweep deleting a **live** receipt's photo prematurely, or a ledger row claiming an erasure that did not happen. | The cutoff is the object's own age, never a receipt's state; a live in-window receipt keeping its photo is asserted; a failed delete is never marked, so the next run retries. |
| **H3 (product)** | The app promising erasure it no longer performs. | Deletion screen states the window in EN + FR, from the same app_config value the sweep reads. |
| **M1 (Android)** | `allowBackup:false` stops device-transfer carrying local app data. | Synced photos restore from the object store on open; only never-synced captures and the OCR cache are lost. Belongs in the release notes. |
| **M1 (iOS)** | A malformed AppDelegate patch breaking the build. | Both failure modes warn and return the file untouched; nine plugin cases; the merge was driven against a realistic Expo 55 AppDelegate and is idempotent. |
| **M2** | A cap below real capture size rejecting legitimate uploads. | The client declares its size; undeclared keeps the unbounded path, so shipped builds are unaffected; 900 KB and 11 MB fixtures assert real captures pass. |
| **M3** | Preserve becoming freeze, or resurrecting a name after deletion. | A real sign-in still updates the name (asserted); deletion nulls separately. |
| **L1** | Rejecting a token shape Expo accepts, silencing notifications. | Uses `Expo.isExpoPushToken`, the predicate `/api/watch` already trusts; explicit `null` still clears; a rejected write leaves the *previous* token intact. |
| **L2** | Refusing a claim and stranding a legitimately handed-down phone. | Claim when unowned or already the caller's; `resolveScanOwner` prefers the Bearer token, so a signed-in user is unaffected; refusals are logged. |

### The CI round-trip worth keeping

The Backend job went red with **dozens of unrelated suites failing at once** —
barcode resolution, catalog reads, credit reconciliation, claim IDOR guards,
account-deletion revival. That spread is the tell: it is one cause, not thirty.

`seedLookups` now upserts `object_retention_types`. `ensureSeeded()` runs on
nearly every repo call, through `lookupId`. The table did not exist yet, so
`ensureSeeded` threw and took every DB-touching test with it.

**CI points at the shared Supabase dev database and never runs migrations.** A
new migration is therefore an out-of-band step, and *adding a row to the seeder*
is what turns a missing migration from "the new tests fail" into "everything
fails". Applied 0005 to dev additively (`CREATE TABLE IF NOT EXISTS`, guarded FK,
`ON CONFLICT DO NOTHING` backfill) with the drizzle bookkeeping row keyed on the
migration file's real SHA-256 — the same hand-maintained procedure the 0003/0004
apply used, because that ledger's rows predate the `0000_initial` squash.
Verified after: both tables present, 2 types seeded, 8 existing keys backfilled,
FK and ledger row recorded.

**Production still owes 0005**, and must be applied by hand for the same reason:
`db:migrate` there would try to re-run `0000_initial` over a live database.

A second defect was found by re-reading the diff while that job was red, and is
worth noting because CI could not have told them apart: the new export suite sent
no `Authorization` header. `requireAuth` matches the header **before** it calls
`verifyAuth`, so injecting `app.locals.verifyAuth` is not enough on its own — the
request short-circuits to 401 and never reaches the injected verifier. Every
sibling suite sends a throwaway `Bearer x` for exactly this reason. **A red CI run
hides the next bug; read the diff rather than waiting for the rerun.**

**Verification:** 58/58 non-DB backend and 47/47 mobile suites green locally;
`npm run i18n:check` passing (EN/FR, 1439 keys each); migration `0005` plus a
regenerated consolidated deploy schema (6 migrations). Four new DB-backed suites
(`objectRetentionDb`, `profileWriteGuardsDb`, `dataExportIdentityDb`,
`priceDropPushLanguage`) run in CI against the Supabase dev project.

---

## On-device checklist

Continuing from pass #5's item 29.

30. Set the app to **French**, then trigger a verified price drop on a watched
    line. Both pushes must arrive in French, and the money must read `19,99 $`,
    not `$19.99` (H1).
31. As an **English** user, confirm the same two pushes are unchanged from today —
    this is the regression side of H1.
32. Scan a receipt, then check the object store: the PUT must have been accepted
    with an exact `Content-Length` (M2).
33. **Delete the account** and confirm the deletion sheet shows the photo-retention
    notice in the active language, before the confirm button (H3).
34. On a device with iCloud Backup on: after one queued scan, confirm
    `Documents/receipts_pending` reports `NSURLIsExcludedFromBackupKey = 1`, and
    that the app still scans normally (M1). **This is the only item in this audit
    that cannot be verified without a handset.**
35. Sign in, change the Google account's display name, sign in again — the name
    must update, not stick (M3 regression side).
36. Request a **data export** on iPhone with sessions enabled: `identity.email` and
    `identity.name` must both be populated (M4).

**Android regression pass, same build:** confirm a device transfer still restores
receipts and their photos through `/api/me/bootstrap` + on-open image fetch with
`allowBackup: false`; confirm price-drop pushes are unchanged in English; confirm
the deletion sheet shows the retention notice.
