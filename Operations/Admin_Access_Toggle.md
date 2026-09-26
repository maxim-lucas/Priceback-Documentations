# Admin access, granted from the console instead of `app_config`

**2026-09-25, `feat/admin-access-toggle` off `main`.** `ADMIN_USER_SUBS` — the
allow-list every `/api/admin/*` route and the Profile menu's Admin entry check —
used to be edited by hand in the `app_config` table (or as a Railway env var).
It is now a button: Admin · Accounts → ⋯ → **Grant/Revoke admin access**, and the
same button on `AdminAccountDetail`'s Account access group. An **ADMIN** badge
marks a row that already has it.

Related: `Operations/Admin_Console_And_Data_Cleanup.md` (the allow-list itself),
`Operations/Admin_Account_Desk_Merge.md` (the desk this button lives on),
`Operations/DEPLOYMENT.md` (the env-var precedence this feature has to respect).

---

## The route

`POST /api/admin/users/:sub/admin-access` — body `{ admin: boolean }`. Same
guard shape as every other account-desk route (`requireAuth` + `ADMIN_USER_SUBS`
membership + the shared per-admin rate limit), plus two refusals specific to it:

- **An admin cannot change their own admin access** (`400 VALIDATION_FAILED`) —
  revoking your own access cuts you off from the only surface that could undo
  it, the same reasoning `_refuseSelfTargetedAdminAction` already encodes for
  suspend/flag and the admin-allow-list check on delete.
- **`409 ADMIN_SUBS_ENV_OVERRIDE`** when `ADMIN_USER_SUBS` is *also* set as an
  environment variable. `configService.getAdminSubs()` reads env → `app_config`
  → default, so writing the DB row while the env var is still set would report
  success and silently do nothing — the worst kind of bug, because the console
  says the grant worked. The route checks for this and refuses with a message
  naming the fix, instead.

The write goes through `configService.setAdminAccess(sub, isAdmin)`: it upserts
the `app_config` row via `appConfigRepo.set` **and** updates the in-memory
snapshot (`_ops`) immediately, so the very next admin-gated request sees the
change rather than waiting for the 5-minute `configService.startAutoRefresh()`
tick.

`GET /api/admin/users` and `GET /api/admin/users/:sub/report` both decorate
their account payload with `isAdmin`, read live from `configService.
getAdminSubs()` at request time — not a `users` table column, so a grant/revoke
is visible immediately without touching the users row.

## Railway

Production had `ADMIN_USER_SUBS` set as a Railway env var (same single `sub`
already in `app_config`) — a leftover from before the console toggle existed.
Removed 2026-09-25 (`railway variable delete ADMIN_USER_SUBS`) so the `app_config`
row — and therefore the console toggle — is what actually governs prod. No
behavior changed: the env var and the DB row held the same value. See the
`ADMIN_USER_SUBS` row in `Operations/DEPLOYMENT.md` for why it must stay unset
outside a deliberate break-glass override.

## Tests

- `backend/tests/configServiceAdminAccess.test.js` — `setAdminAccess()` unit
  behavior (env-var refusal, grant/revoke idempotency, immediate snapshot
  update), injected fake `appConfigRepo`, no DB.
- `backend/tests/adminAccountsRoutesDb.test.js` — the route against the real dev
  DB: gate, self-target refusal, grant/revoke round-trips the real
  `app_config` row (captured and restored around the run), non-boolean/404
  validation, the env-override 409, and the `isAdmin` decoration on the list
  route.
- `backend/tests/adminConsoleRoutesDb.test.js` — the same decoration on
  `GET /api/admin/users/:sub/report`.
- `__tests__/adminAccountActions.test.js`, `adminAccountsScreen.test.js`,
  `adminAccountDetailScreen.test.js` — the badge, the confirm-dialog wording,
  and both screens' render + confirm + post flow, including the self-target
  grey-out (the signed-in operator's own row).
