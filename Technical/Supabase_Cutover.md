# Supabase cutover

Both environments now run on **Supabase** (Neon retired). The backend is provider-neutral —
vanilla `pg`, every runtime query schema-qualified to `priceback`, a per-connection
`SET search_path TO priceback, public` for raw/test SQL, connection chosen entirely by
`DATABASE_URL` — so a provider/env swap is **env + a one-time migration**, no app-code changes.

## Two Supabase projects

| Environment | Supabase project | Where `DATABASE_URL` is set |
|---|---|---|
| Tests / local dev | **dev** (`gnedluuylimjwdmtvswl`) | `backend/.env` (loaded via `node --env-file=.env`) |
| Production runtime | **prod** (`xjfrlzwonyaorwktnkpj`) | Railway service env var |

Nothing in code branches on provider. Tests always run against the **dev** project
(team rule: never test/seed against production).

## Supabase connection string

Use the **Session pooler** or **Direct** connection — **NOT** the `6543` transaction pooler.
The backend keeps a long-lived `pg` Pool (`max: 5`) and the migration runner needs a stable
session, both of which the transaction pooler doesn't support.

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

TLS is handled by the Pool (`ssl: { rejectUnauthorized: false }`); `sslmode`/`channel_binding`
query params are stripped automatically (`normalizeConnectionString` in `db/client.js`), so a
copy-pasted Supabase URL works as-is.

## One-time migration (run once, before the first prod deploy on Supabase)

From `backend/`, with the Supabase URL (do **not** put it in `.env` — that file is for Neon):

```bash
# bash
DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  npm run db:migrate
```

```powershell
# PowerShell
$env:DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres'
npm run db:migrate
```

This applies the full chain `0000_initial … 0009_tag_credit_rules`. `0000_initial` self-creates
the `priceback` schema (`CREATE SCHEMA IF NOT EXISTS`), and `db/client.js` pins `search_path` per
connection, so no manual schema/role setup is needed on a brand-new project.

Then boot the backend once against Supabase so `seedLookups()` populates the reference tables
(countries, provinces, stores, warehouses, source/event types, plans, packs, app_config).

## Verify

- `priceback` schema exists with the full table set, incl. `price_points.created_at`.
- `DATABASE_URL=<supabase> npm run db:generate` reports **no** new SQL (no drift) — note the
  drizzle meta snapshots lag intentionally (migrations are hand-written), so confirm by
  inspecting the listed statements, not just exit code.
- Smoke a DB-backed route (e.g. `GET /api/v1/warehouses.json`) returns seeded rows.

## Production runtime config (Railway)

```
USE_DB=true
DATABASE_URL=<supabase session-pooler/direct URL>
```

## Migration authoring note

Migrations in `backend/db/migrations/` are **hand-written, idempotent SQL** (`IF NOT EXISTS`,
`DO $$ … $$` guards) with a manual entry in `meta/_journal.json`. `drizzle-kit generate` is
**not** used to author them (its snapshots are intentionally not kept in lockstep, so it
reports phantom drift). Follow the existing `0007`/`0008` style when adding the next one.
