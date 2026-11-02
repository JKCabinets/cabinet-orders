-- 2026-10-29  Feature 9 phase 1 -- the OMS marks cabinet lines fulfilled in
-- Shopify on their ship date, so Shopify's shipping confirmation goes out.
-- The design, every point decided with Garrett: docs/SESSION-HANDOFF-2026-10-29.md
-- §4, and the 2026-10-29 rulings recorded with it.
--
-- RUN BEFORE THE DEPLOY. The new code writes these columns and this table; the
-- old code reads and writes none of them, so the old code over this database is
-- unchanged. Safe to run twice: every statement is IF NOT EXISTS, CREATE OR
-- REPLACE, or guarded; the start day is written once and never overwritten.
--
-- What it adds:
--   orders.vendor_ship_dates    a MIXED group's ship date per vendor
--   orders.ship_checks          "Still on schedule?" answered "On schedule", per vendor
--   orders.shipped_in_shopify   what is marked shipped -- written ONLY by the record's trigger
--   shopify_fulfilments         THE RECORD: every fulfilment, attempt and skip
--   cabinet_fulfilment_start    the day the run began; nothing earlier is fulfilled
--
-- ⚠ THE START DAY IS ARIZONA'S DATE WHEN THIS RUNS (Garrett: "only for ship
-- dates on or after the day the run is deployed -- not a date chosen in
-- advance"). Run it in the deploy sitting. If the deploy does not happen that
-- Arizona day, move the day to the deploy's with:
--   update public.cabinet_fulfilment_start
--      set starts_on = (now() at time zone 'America/Phoenix')::date;

-- ─── orders.vendor_ship_dates ───────────────────────────────────────────────
--
-- A mixed cabinet group (Waypoint + J&K, say) ships per vendor: one date each,
-- {"J&K Cabinetry": "2026-11-01", "Waypoint Cabinetry": "2026-11-10"}. NULL on a
-- single-vendor group, whose one date is production_est_finish_date as today.
--
-- ⚠ THE GROUP'S DATE IS THE LATEST VENDOR'S, HELD HERE, not by convention:
-- production-complete moves the group to At cross dock on
-- production_est_finish_date, and that must be when the LAST vendor ships
-- (Garrett). A writer that set one without the other is refused.

alter table public.orders add column if not exists vendor_ship_dates jsonb;

-- An ISO date, or null. make_date is immutable where a text-to-date cast is not.
create or replace function public.oms_iso_date(t text)
  returns date
  language plpgsql
  immutable
  set search_path to 'pg_catalog'
as $$
declare
  m text[];
begin
  if t is null then return null; end if;
  m := regexp_match(t, '^(\d{4})-(\d{2})-(\d{2})$');
  if m is null then return null; end if;
  return make_date(m[1]::int, m[2]::int, m[3]::int);
exception when others then
  return null;  -- 2026-02-30 and the like
end
$$;

create or replace function public.vendor_ship_dates_problem(doc jsonb, finish date)
  returns text
  language plpgsql
  immutable
  set search_path to 'pg_catalog'
as $$
declare
  k text;
  v jsonb;
  d date;
  latest date;
  n int := 0;
begin
  if doc is null then return null; end if;
  if jsonb_typeof(doc) <> 'object' then return 'not an object'; end if;
  for k, v in select key, value from jsonb_each(doc) loop
    n := n + 1;
    if length(btrim(k)) = 0 or length(k) > 100 then return 'a vendor name is empty or too long'; end if;
    if jsonb_typeof(v) <> 'string' then return format('%s: the date is not text', k); end if;
    d := public.oms_iso_date(v #>> '{}');
    if d is null then return format('%s: %s is not a date (YYYY-MM-DD)', k, v #>> '{}'); end if;
    if latest is null or d > latest then latest := d; end if;
  end loop;
  -- One vendor is a single-vendor group: its date is production_est_finish_date.
  if n < 2 then return 'fewer than two vendors -- a single vendor uses the group''s date'; end if;
  if finish is distinct from latest then
    return format('production_est_finish_date must be the latest vendor date, %s', latest);
  end if;
  return null;
end
$$;

-- ─── orders.ship_checks ─────────────────────────────────────────────────────
--
-- "Still on schedule?" answered "On schedule", per vendor:
-- {"J&K Cabinetry": {"date": "2026-11-01", "by": "<team member id>", "at": "<iso>"}}.
-- An answer counts ONLY for the date it was given: a changed date asks again,
-- with no clearing needed. A single-vendor group keys its one vendor too.
-- (A backordered line's answer lives on the line, in sku_items.)

alter table public.orders add column if not exists ship_checks jsonb;

create or replace function public.ship_checks_problem(doc jsonb)
  returns text
  language plpgsql
  immutable
  set search_path to 'pg_catalog'
as $$
declare
  k text;
  v jsonb;
  f text;
begin
  if doc is null then return null; end if;
  if jsonb_typeof(doc) <> 'object' then return 'not an object'; end if;
  for k, v in select key, value from jsonb_each(doc) loop
    if length(btrim(k)) = 0 or length(k) > 100 then return 'a vendor name is empty or too long'; end if;
    if jsonb_typeof(v) <> 'object' then return format('%s: not an object', k); end if;
    for f in select jsonb_object_keys(v) loop
      if f not in ('date', 'by', 'at') then return format('%s: unknown key "%s"', k, f); end if;
    end loop;
    if public.oms_iso_date(v ->> 'date') is null then return format('%s: date is not a date (YYYY-MM-DD)', k); end if;
    if jsonb_typeof(v -> 'by') is distinct from 'string' or length(btrim(v ->> 'by')) = 0 then
      return format('%s: by is missing', k);
    end if;
    if jsonb_typeof(v -> 'at') is distinct from 'string' then return format('%s: at is missing', k); end if;
  end loop;
  return null;
end
$$;

-- ─── orders.shipped_in_shopify ──────────────────────────────────────────────
--
-- What the OMS has marked shipped, keyed "vendor:<name>" and "line:<line key>",
-- each with when: {"vendor:J&K Cabinetry": "2026-11-01T15:00:04Z", ...}. It is a
-- COPY of the record below, on the row, so the lock, its refusal and "Marked
-- shipped in Shopify on MM/DD/YYYY" reach every screen by realtime.
--
-- ⚠ WRITTEN ONLY BY THE RECORD'S TRIGGER, in the same transaction as the
-- record -- so the two cannot disagree. Any other write is refused below.

alter table public.orders add column if not exists shipped_in_shopify jsonb;

-- ─── The constraints ────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_ship_dates_cabinets_only') then
    alter table public.orders add constraint orders_vendor_ship_dates_cabinets_only
      check (vendor_ship_dates is null or type = 'order');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_ship_dates_valid') then
    alter table public.orders add constraint orders_vendor_ship_dates_valid
      check (vendor_ship_dates is null
             or public.vendor_ship_dates_problem(vendor_ship_dates, production_est_finish_date) is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_ship_checks_cabinets_only') then
    alter table public.orders add constraint orders_ship_checks_cabinets_only
      check (ship_checks is null or type = 'order');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_ship_checks_valid') then
    alter table public.orders add constraint orders_ship_checks_valid
      check (ship_checks is null or public.ship_checks_problem(ship_checks) is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_shipped_in_shopify_object') then
    alter table public.orders add constraint orders_shipped_in_shopify_object
      check (shipped_in_shopify is null or jsonb_typeof(shipped_in_shopify) = 'object');
  end if;
end
$$;

-- ⚠ A CHECK'S FUNCTION MUST BE EXECUTABLE BY EVERY ROLE THAT WRITES THE TABLE
-- (2026-09-30): Postgres checks the permission before the check's own IS NULL
-- short-circuits. Granted outright, not left to defaults.
grant execute on function public.oms_iso_date(text) to service_role, authenticated, anon;
grant execute on function public.vendor_ship_dates_problem(jsonb, date) to service_role, authenticated, anon;
grant execute on function public.ship_checks_problem(jsonb) to service_role, authenticated, anon;

-- ─── The record: shopify_fulfilments ────────────────────────────────────────
--
-- ONE ROW PER (group, vendor | line | skip reason), and the unique key is what
-- makes "never twice" a fact of the database rather than of the code:
--
--   scope 'vendor'  a vendor's lines on its ship date; scope_key the vendor
--   scope 'line'    a backordered line on its own date; scope_key the line key
--   scope 'skip'    a group the run will not fulfil, once per reason (Garrett);
--                   scope_key the reason, e.g. 'stage:Entered'
--
-- An attempt is written as 'pending' BEFORE Shopify is asked, then settled:
-- 'fulfilled' (with Shopify's fulfilment id), or 'failed' (with Shopify's
-- reason; the next run tries again). A 'pending' whose answer never came is
-- settled from Shopify's fulfilment orders, never by sending again. 'fulfilled'
-- and 'skipped' are final.

create table if not exists public.shopify_fulfilments (
  id                     bigserial primary key,
  order_id               text not null references public.orders(id) on delete cascade,
  scope                  text not null check (scope in ('vendor', 'line', 'skip')),
  scope_key              text not null check (length(btrim(scope_key)) between 1 and 200),
  -- The date that was due; for a skip, the date the run saw.
  ship_date              date,
  outcome                text not null check (outcome in ('pending', 'fulfilled', 'failed', 'skipped')),
  -- What was (to be) fulfilled: [{"key", "line_item_id", "variant_id", "sku", "quantity"}].
  lines                  jsonb check (lines is null or jsonb_typeof(lines) = 'array'),
  shopify_fulfillment_id text,
  -- Shopify's reason for a failure; the skip's sentence; how a pending settled.
  reason                 text,
  attempts               integer not null default 1 check (attempts >= 1),
  -- 'run' (the daily run), or 'shopify' when Shopify already had it fulfilled.
  fulfilled_by           text not null default 'run',
  created_at             timestamptz not null default now(),
  settled_at             timestamptz,
  constraint shopify_fulfilments_once unique (order_id, scope, scope_key),
  constraint shopify_fulfilments_skip_is_skipped check ((scope = 'skip') = (outcome = 'skipped')),
  constraint shopify_fulfilments_settled check (
    (outcome in ('fulfilled', 'skipped', 'failed')) = (settled_at is not null)),
  constraint shopify_fulfilments_fulfilled_lines check (
    outcome <> 'fulfilled' or (lines is not null and jsonb_array_length(lines) > 0))
);

create index if not exists shopify_fulfilments_pending
  on public.shopify_fulfilments (created_at) where outcome in ('pending', 'failed');

-- ⚠ SERVER ONLY, as order_stage_events: RLS on and no policy, so only the
-- service role (the API and the run) reads or writes it. What a screen needs is
-- on the row (shipped_in_shopify). Granted outright (2026-10-07: a table a
-- trigger writes needs service_role granted outright).
alter table public.shopify_fulfilments enable row level security;
grant select, insert, update, delete on public.shopify_fulfilments to service_role;
grant usage, select on sequence public.shopify_fulfilments_id_seq to service_role;

-- ─── The record settles once; its copy goes on the row ─────────────────────
create or replace function public.shopify_fulfilments_settle()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $$
declare
  stamp text;
  marks jsonb := '{}'::jsonb;
  ln jsonb;
begin
  -- 'fulfilled' and 'skipped' are final: nothing about them changes again.
  if tg_op = 'UPDATE' and old.outcome in ('fulfilled', 'skipped') then
    raise exception 'shopify_fulfilments % is % and final', old.id, old.outcome
      using errcode = 'check_violation';
  end if;
  if new.outcome = 'fulfilled' and (tg_op = 'INSERT' or old.outcome <> 'fulfilled') then
    stamp := to_char(new.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    if new.scope = 'vendor' then
      marks := marks || jsonb_build_object('vendor:' || new.scope_key, stamp);
    end if;
    -- Every line it fulfilled, whichever scope: a line shipped with its vendor
    -- is as locked as a backordered one shipped on its own.
    for ln in select value from jsonb_array_elements(new.lines) loop
      if coalesce(ln ->> 'key', '') <> '' then
        marks := marks || jsonb_build_object('line:' || (ln ->> 'key'), stamp);
      end if;
    end loop;
    perform set_config('oms.shipped_in_shopify_writer', 'record', true);
    update public.orders
       set shipped_in_shopify = coalesce(shipped_in_shopify, '{}'::jsonb) || marks
     where id = new.order_id;
    perform set_config('oms.shipped_in_shopify_writer', '', true);
  end if;
  return new;
end
$$;

create or replace trigger shopify_fulfilments_settle
  before insert or update on public.shopify_fulfilments
  for each row execute function public.shopify_fulfilments_settle();

-- ⚠ NO OTHER WRITER OF THE COPY. An update that changes shipped_in_shopify is
-- refused unless the record's trigger is the one making it, and a new row
-- cannot arrive with one.
create or replace function public.orders_shipped_in_shopify_guard()
  returns trigger
  language plpgsql
  set search_path to 'pg_catalog'
as $$
begin
  if tg_op = 'INSERT' then
    if new.shipped_in_shopify is not null then
      raise exception 'orders.shipped_in_shopify is written only by shopify_fulfilments'
        using errcode = 'check_violation';
    end if;
  elsif new.shipped_in_shopify is distinct from old.shipped_in_shopify
        and coalesce(current_setting('oms.shipped_in_shopify_writer', true), '') <> 'record' then
    raise exception 'orders.shipped_in_shopify is written only by shopify_fulfilments'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace trigger orders_shipped_in_shopify_guard
  before insert or update of shipped_in_shopify on public.orders
  for each row execute function public.orders_shipped_in_shopify_guard();

-- ─── The start day ──────────────────────────────────────────────────────────
create table if not exists public.cabinet_fulfilment_start (
  only_row    boolean primary key default true check (only_row),
  starts_on   date not null,
  recorded_at timestamptz not null default now()
);
alter table public.cabinet_fulfilment_start enable row level security;
grant select on public.cabinet_fulfilment_start to service_role;

-- Written once. A second run leaves the first day standing.
insert into public.cabinet_fulfilment_start (starts_on)
values ((now() at time zone 'America/Phoenix')::date)
on conflict (only_row) do nothing;

-- ─── Its own check: one row, whatever happened ──────────────────────────────
select json_build_object(
  'columns', (select coalesce(json_agg(column_name order by column_name), '[]')
              from information_schema.columns
              where table_schema = 'public' and table_name = 'orders'
                and column_name in ('vendor_ship_dates', 'ship_checks', 'shipped_in_shopify')),
  'constraints', (select coalesce(json_agg(conname order by conname), '[]')
                  from pg_constraint
                  where conrelid = 'public.orders'::regclass
                    and conname in ('orders_vendor_ship_dates_cabinets_only', 'orders_vendor_ship_dates_valid',
                                    'orders_ship_checks_cabinets_only', 'orders_ship_checks_valid',
                                    'orders_shipped_in_shopify_object')),
  'triggers', (select coalesce(json_agg(tgname order by tgname), '[]')
               from pg_trigger
               where not tgisinternal
                 and tgname in ('shopify_fulfilments_settle', 'orders_shipped_in_shopify_guard')),
  'record_table', to_regclass('public.shopify_fulfilments') is not null,
  'record_rls', (select relrowsecurity from pg_class where oid = to_regclass('public.shopify_fulfilments')),
  'service_role_on_record', (select coalesce(json_agg(privilege_type order by privilege_type), '[]')
                             from information_schema.role_table_grants
                             where table_schema = 'public' and table_name = 'shopify_fulfilments'
                               and grantee = 'service_role'),
  'starts_on', (select starts_on from public.cabinet_fulfilment_start),
  'start_rows', (select count(*) from public.cabinet_fulfilment_start),
  'rows_using_new_columns', (select count(*) from public.orders
                             where vendor_ship_dates is not null or ship_checks is not null
                                or shipped_in_shopify is not null),
  'records', (select count(*) from public.shopify_fulfilments)
) as cabinet_fulfilment_migration;
