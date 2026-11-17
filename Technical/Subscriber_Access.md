# Subscriber access: never paywalled, one phone, everything logged

**Standing rule (Maxim, 2026-11-17).** *"subscribers are our priority this is a very BIG BUG to be sure always this
never happens"*. The rule text is in the app repo's `CLAUDE.md` ("Subscribers come first"). This page explains how the
rule is built and how to investigate a subscriber who reports a block.

Background: Bugs #387. Sally's annual Unlimited (iOS 3.6.2) was shown a -55 balance and the paywall on every scan for
a day, while the server held her plan correctly and charged nothing.

## 1. Who is a subscriber

There is one definition: `isCreditExempt(profile)` in `backend/subscriptionGate.js`. It is true for a paid tier still in
force: active, cancelled but not expired, or in billing retry. Every charge site uses it (scan, drop commission, claim).

The phone never decides this alone. The server sends its verdict, `creditExempt`, on:

| Route | When the phone calls it |
| --- | --- |
| `GET /api/me/credits` (+ `subscription` when exempt) | every balance read: the scan gate, the drop lock's live read, Profile, credit history |
| `GET /api/me/bootstrap` | every opening, every foreground (throttled 5 min), every sign-in |

`purchaseService.applyServerSubscription` heals the phone's subscription cache (`premium_status_v2`) from the verdict.

- It only upgrades. A downgrade stays with `reconcileWithServer`.
- A plan claimed by another phone is not healed.
- After the heal, `canAddReceipt` answers `remaining: Infinity`, so there is no paywall, no balance and no low-balance
  banner. Every other gate reads the same cache.

The balance stays in `users.scan_credits`, hidden and unused while the plan is in force. When the plan lapses, it is
the balance again.

## 2. One subscribed account, one signed-in phone

*"when you signin with an account (subscribed) on another device, the first signin device should logout automaticaly"*.

| Piece | Where |
| --- | --- |
| The rule (pure) | `backend/lib/subscriberAccess.js` → `deviceVerdict` |
| The per-request check | `server.js` → `enforceSubscriberDevice`, called inside `requireAuth` |
| Taking the claim | `POST /api/me/device/claim {reason: signin \| purchase \| restore}` |
| The device id | header `X-Device-Id` (the install fingerprint), set by boot (`installDeviceIdHeader`) |
| The sign-out | `appVersionGate` sees `409 signed_in_elsewhere` → `App.js` reports, signs out, shows `auth.signedInElsewhere*`, resets to Splash |

How the claim moves:

1. Sign-in, purchase and restore await `claimThisDevice` before anything else calls the backend. That phone holds the
   claim.
2. Any other phone that carries a device id gets `409 signed_in_elsewhere` on its next call and signs itself out.
3. When there is no claim, or the claim is older than the plan's last change (`subscription_updated_at`), the first
   phone that presents itself takes it. This covers a purchase made while another phone held the claim as a free
   account. The holder re-stamps its claim (`touchSubscriptionClaim`).
4. Never judged:
   - a request without a device id (builds before 3.6.3);
   - a free account (any number of phones);
   - the App Review account;
   - `/api/auth/*`, the claim route and the events route.
5. The rule fails open. A database error never refuses a request.

Old builds: before 3.6.3, `/api/me` still claims on a cold boot (last-device-wins). An old phone that cold-boots
therefore takes the claim back from a 3.6.3+ phone, which is then signed out. This goes away as the old builds do;
raising `MIN_SUPPORTED_BUILD_*` once 3.6.3 is at 100% closes it.

The existing auto-flag still applies: 3 distinct devices claiming within 10 minutes flags the account
(`SUBSCRIPTION_DEVICE_CONFLICT_*`).

## 3. Logs: `subscriber_access_events` (migration 0050)

Every decision is one row, and one Railway log line with the prefix `[subscriber-access]`.

| type | written by | means | alarm |
| --- | --- | --- | --- |
| `device_claimed` | server | a phone took the claim (`detail.reason`: signin / purchase / restore / first; `previousDeviceId`; `signsOut`) | no |
| `signed_in_elsewhere` | server | a phone was refused (one row per phone per 10 min) | no |
| `signed_out_elsewhere` | phone | it signed itself out on that answer | no |
| `cache_healed` | phone | its cache had lost a plan the server holds (`detail.from`: credits / bootstrap) | **email** |
| `paywall_shown_to_subscriber` | phone, recorded only if the server holds a plan | a subscriber saw a paywall (`detail.reason`) | **email** |

Every row carries `platform` and `app_build` from the `X-App-*` headers. `/health` (admin) → `subscriberAccess.last24h`
counts each type; `status: attention` when either alarm type is above 0.

## 4. A subscriber says they are blocked

1. Read their rows:
   `select * from priceback.subscriber_access_events where user_sub = '<sub>' order by occurred_at desc;`
2. Read their plan: `users.subscription_tier_id / status / expires_at`, and `subscription_events`.
3. Read their claim: `active_subscription_device_id`, `subscription_claimed_at`, `subscription_device_claims`.
4. Use the table below to decide what happened.

| You see | It means |
| --- | --- |
| `cache_healed` | the phone had lost the plan and the server put it back |
| `paywall_shown_to_subscriber` with no heal | a gate does not read the healed cache: a bug (rule 2 in `CLAUDE.md`) |
| `signed_in_elsewhere` | another phone holds the claim |
| nothing at all | a build before 3.6.3: a cold restart of the app (boot reconcile) is the workaround |

## 5. Tests

- Phone: `__tests__/subscriberNeverPaywalled.test.js` (the heal, the logs, the claim) and `__tests__/appVersionGate.test.js`
  (the header, the 409 signal).
- Server: `backend/tests/subscriberAccess.test.js` (the rule) and `backend/tests/subscriberAccessDb.test.js` (sign-in on B
  signs A out, old builds and free accounts never refused, logs written, the alarm events). Also
  `backend/tests/dbRoutesExtra.test.js` (the verdict on both routes).

## 6. Deploying

1. Apply `0050_subscriber_access_events.sql` to production **before** the backend deploys, then insert the ledger row
   (the prod ledger is hand-maintained).
2. Deploy the backend.
3. Ship the app build (3.6.3+).

Until the build ships, the server half changes nothing for any phone; only the logs and `/health` start.
