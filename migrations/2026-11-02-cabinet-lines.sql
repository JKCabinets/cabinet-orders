-- 2026-11-02  Feature 10, part 1 -- cabinet lines: one order, a section per
-- line. The design, every point decided with Garrett:
-- docs/SESSION-HANDOFF-2026-11-02.md §3 (§3.7 the agreed design).
--
-- RUN BEFORE THE DEPLOY THAT USES IT. The old code reads and writes none of
-- this, so the old code over this database is unchanged. Safe to run twice:
-- every statement is IF NOT EXISTS, CREATE OR REPLACE, or guarded.
--
-- What it adds -- each line of a mixed cabinet order gets its own dates, in
-- the shape of feature 9's orders.vendor_ship_dates (2026-10-29):
--   orders.vendor_start_dates        a line's production start date
--   orders.vendor_delivery_targets   a line's delivery target
--   order_attachments.vendor         the line a file is for (a proof of
--                                    delivery, an acknowledgment's file)
--
-- ⚠ THE ORDER'S OWN DATE IS HELD BY THE DATABASE, as for the ship dates:
--   production_start_date    = the EARLIEST line's start   (Garrett: what
--                              Shopify's Production Start Date shows)
--   scheduled_delivery_date  = the LATEST line's target    (the slowest line)
-- A writer that set one without the other is refused.

alter table public.orders add column if not exists vendor_start_dates jsonb;
alter table public.orders add column if not exists vendor_delivery_targets jsonb;

-- One rule for both, the earliest or the latest. The same checks as
-- vendor_ship_dates_problem (2026-10-29): an object of at least two vendors,
-- every value a real ISO date (oms_iso_date: make_date, not a cast).
create or replace function public.vendor_dates_problem(doc jsonb, group_date date, pick text)
  returns text
  language plpgsql
  immutable
  set search_path to 'pg_catalog'
as $$
declare
  k text;
  v jsonb;
  d date;
  want date;
  n int := 0;
begin
  if doc is null then return null; end if;
  if pick not in ('earliest', 'latest') then return format('unknown pick %s', pick); end if;
  if jsonb_typeof(doc) <> 'object' then return 'not an object'; end if;
  for k, v in select key, value from jsonb_each(doc) loop
    n := n + 1;
    if length(btrim(k)) = 0 or length(k) > 100 then return 'a vendor name is empty or too long'; end if;
    if jsonb_typeof(v) <> 'string' then return format('%s: the date is not text', k); end if;
    d := public.oms_iso_date(v #>> '{}');
    if d is null then return format('%s: %s is not a date (YYYY-MM-DD)', k, v #>> '{}'); end if;
    if want is null or (pick = 'earliest' and d < want) or (pick = 'latest' and d > want) then want := d; end if;
  end loop;
  -- One vendor is a single-vendor group: its date is the order's own.
  if n < 2 then return 'fewer than two vendors -- a single vendor uses the order''s date'; end if;
  if group_date is distinct from want then
    return format('the order''s date must be the %s vendor date, %s', pick, want);
  end if;
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_start_dates_cabinets_only') then
    alter table public.orders add constraint orders_vendor_start_dates_cabinets_only
      check (vendor_start_dates is null or type = 'order');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_start_dates_valid') then
    alter table public.orders add constraint orders_vendor_start_dates_valid
      check (vendor_start_dates is null
             or public.vendor_dates_problem(vendor_start_dates, production_start_date, 'earliest') is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_delivery_targets_cabinets_only') then
    alter table public.orders add constraint orders_vendor_delivery_targets_cabinets_only
      check (vendor_delivery_targets is null or type = 'order');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_vendor_delivery_targets_valid') then
    alter table public.orders add constraint orders_vendor_delivery_targets_valid
      check (vendor_delivery_targets is null
             or public.vendor_dates_problem(vendor_delivery_targets, scheduled_delivery_date, 'latest') is null);
  end if;
end
$$;

-- ⚠ A CHECK'S FUNCTION MUST BE EXECUTABLE BY EVERY ROLE THAT WRITES THE TABLE
-- (2026-09-30). Granted outright.
grant execute on function public.vendor_dates_problem(jsonb, date, text) to service_role, authenticated, anon;

-- ─── The line a file is for ─────────────────────────────────────────────────
-- Null on a file that is not a line's (general files, customer uploads, and
-- every file from before this). The order keeps ONE group per role
-- (order_file_groups_one_per_role); a line's receipts and acknowledgments sit
-- in it, each tagged with its line.
alter table public.order_attachments add column if not exists vendor text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_attachments_vendor_named') then
    alter table public.order_attachments add constraint order_attachments_vendor_named
      check (vendor is null or (length(btrim(vendor)) between 1 and 100 and vendor = btrim(vendor)));
  end if;
end
$$;

-- ─── Its own check: one row, whatever happened ──────────────────────────────
select json_build_object(
  'order_columns', (select coalesce(json_agg(column_name order by column_name), '[]')
                    from information_schema.columns
                    where table_schema = 'public' and table_name = 'orders'
                      and column_name in ('vendor_start_dates', 'vendor_delivery_targets')),
  'attachment_vendor', (select count(*) from information_schema.columns
                        where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'vendor'),
  'constraints', (select coalesce(json_agg(conname order by conname), '[]')
                  from pg_constraint
                  where conname in ('orders_vendor_start_dates_cabinets_only', 'orders_vendor_start_dates_valid',
                                    'orders_vendor_delivery_targets_cabinets_only', 'orders_vendor_delivery_targets_valid',
                                    'order_attachments_vendor_named')),
  'function_grants', (select coalesce(json_agg(distinct grantee order by grantee), '[]')
                      from information_schema.routine_privileges
                      where routine_schema = 'public' and routine_name = 'vendor_dates_problem'
                        and grantee in ('service_role', 'authenticated', 'anon')),
  'rows_using_new_columns', (select count(*) from public.orders
                             where vendor_start_dates is not null or vendor_delivery_targets is not null),
  'files_with_a_line', (select count(*) from public.order_attachments where vendor is not null)
) as cabinet_lines_migration;
