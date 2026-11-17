# Read-only database role for the weekly social routine (2026-11-16)

Created by Claude on Maxim's instruction ("you can create the readonly database role if you can using supabase"), in the
**production** Supabase project `xjfrlzwonyaorwktnkpj`, for the cloud routine in `maxim-lucas/social-media-manager`
(`sm-content/08-costco-price-drops/weekly/ROUTINE.md`). It was applied with `execute_sql`, not a migration, so the
`priceback` schema, the drizzle ledger and `db/deploy/schema.sql` are untouched.

## What it can do

- Role `social_ro`: `LOGIN`, no superuser / createdb / createrole, `NOINHERIT`, 3 connections, `statement_timeout` 30 s,
  `default_transaction_read_only = on`, `search_path = social_ro`.
- It can `SELECT` four views in the new schema `social_ro` and nothing else. No usage on `priceback` or `public`.
- The views expose only the columns the builder needs. They hide `device_hash`, `source_ref`, `flags`, run `details`
  and every user table.

| View | Rows from | Columns |
|---|---|---|
| `social_ro.provinces` | `priceback.provinces` | id, code, name |
| `social_ro.savings_live` | `savings` (not superseded) + products, provinces, sources, `saving_warehouses` | id, product_id, sku, display_name(_fr), full_name(_fr), is_weighted, province, source, amount, min_quantity, valid_from, valid_until, created_at, warehouses |
| `social_ro.regular_prices` | `price_points` (latest regular price per product and province) | product_id, province, regular, observed_at |
| `social_ro.harvest_runs` | `savings_source_runs` + sources, statuses | id, source, status, started_at, finished_at, items_found, savings_new, trigger |

Checked 2026-11-16: login through the session pooler works; `select` on the views works; `priceback.users` answers
`permission denied for schema priceback`; `insert` into a view answers `permission denied`; `has_table_privilege` is false
for `users`, `savings` and `price_points`.

## Connection

`postgresql://social_ro.xjfrlzwonyaorwktnkpj:<password>@aws-1-ca-central-1.pooler.supabase.com:5432/postgres`, session
pooler on 5432 like every other client. The server certificate is verified against Supabase's CA, committed at
`scripts/weekly/certs/supabase-prod-ca-2021.crt` in the social repo (public certificate). The password is only in
`%USERPROFILE%\.priceback-secrets\social-readonly-db.env` on Maxim's PC, to be set as `DATABASE_URL_SOCIAL_RO` in the
cloud environment. It was never written to a repo or a log.

## Rotate or revoke

```sql
alter role social_ro password '<new>';            -- rotate: then update DATABASE_URL_SOCIAL_RO
revoke all on all tables in schema social_ro from social_ro;
drop owned by social_ro; drop role social_ro;     -- remove entirely
drop schema social_ro cascade;                    -- removes the views too
```

## The SQL that created it (password omitted)

```sql
create schema if not exists social_ro;
create or replace view social_ro.provinces as select id, code, name from priceback.provinces;
create or replace view social_ro.savings_live as
  select sv.id, sv.product_id, p.sku, p.display_name, p.display_name_fr, p.full_name, p.full_name_fr,
         p.is_weighted, pr.code as province, src.code as source, sv.amount, sv.min_quantity,
         sv.valid_from, sv.valid_until, sv.created_at,
         coalesce((select array_agg(w.code order by w.code) from priceback.saving_warehouses sw
                   join priceback.warehouses w on w.id = sw.warehouse_id where sw.saving_id = sv.id), '{}') as warehouses
    from priceback.savings sv join priceback.products p on p.id = sv.product_id
    join priceback.provinces pr on pr.id = sv.province_id join priceback.savings_sources src on src.id = sv.source_id
   where sv.superseded_at is null;
create or replace view social_ro.regular_prices as
  select distinct on (pp.product_id, pr.code) pp.product_id, pr.code as province, pp.regular_unit_price as regular, pp.observed_at
    from priceback.price_points pp join priceback.provinces pr on pr.id = pp.province_id
   where pp.regular_unit_price is not null and pp.regular_unit_price > 0
   order by pp.product_id, pr.code, pp.observed_at desc;
create or replace view social_ro.harvest_runs as
  select r.id, s.code as source, st.code as status, r.started_at, r.finished_at, r.items_found, r.savings_new,
         r.details->>'trigger' as trigger
    from priceback.savings_source_runs r join priceback.savings_sources s on s.id = r.source_id
    join priceback.savings_run_statuses st on st.id = r.status_id;
create role social_ro login password '<password>' nosuperuser nocreatedb nocreaterole noinherit connection limit 3;
alter role social_ro set default_transaction_read_only = on;
alter role social_ro set statement_timeout = '30s';
alter role social_ro set search_path = social_ro;
grant usage on schema social_ro to social_ro;
grant select on all tables in schema social_ro to social_ro;
revoke all on schema priceback from social_ro;
revoke all on schema public from social_ro;
```

## Things to know

- **A schema change in `savings`, `products`, `price_points` or `savings_sources` can break a view** (a renamed or dropped
  column fails the `select`, not the base change). The weekly build opens an issue when its first query fails; fix the
  view here and in the SQL above.
- Views run with their owner's rights, which is why the role needs no access to the base tables.
- Not on the dev database: the routine reads production savings, which are public marketing data.
