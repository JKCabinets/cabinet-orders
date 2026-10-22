-- 2026-10-21  order_stage_events: when an order entered each stage (item 7 --
-- the rail's dates, Garrett's mockup).
--
-- ⚠ RECORDED BY THE DATABASE, NOT BY THE APP. Garrett chose a structured record
-- over reading "moved to" out of the trail's wording (which any rewording would
-- break). A trigger is that record made complete by construction: four writers
-- change an order's stage today (the order route, the nightly
-- production-complete job, the Shopify webhook, creation) and any future one --
-- or a hand-written UPDATE -- is caught too, because none of them has to
-- remember anything.
--
-- ⚠ THE TIME IS stage_entered_at. trg_orders_bump_stage_entered_at (BEFORE UPDATE
-- OF stage) already sets it to now() on every real stage change, for every
-- path; this AFTER trigger records the event at that value. So an event and the
-- rail's "in stage" are the same moment, by construction -- and nothing here
-- resets the time itself, because that trigger already does (item 49, raised
-- from the app's code alone and withdrawn once the database was read).
--
-- NOT ON REALTIME. The app reads events with each order (the routes embed
-- them); a live stage change reaches the screen as the order's own realtime
-- UPDATE, whose stage_entered_at is this event's time. So no read policy for
-- `authenticated` and no publication: no_direct_access only.
--
-- SEED. Each existing order gets one event: its CURRENT stage at its
-- stage_entered_at -- exact, and the only one known. Earlier stages have no
-- recorded date and the rail leaves them blank rather than guess. On 2026-10-21
-- that was one order, at New; the trail held one row and no stage change, so
-- nothing is read out of any wording, ever.
--
-- Idempotent: a second run creates nothing and seeds nothing. The LAST
-- STATEMENT is the check, so one run in the SQL editor shows its own result.

begin;

create table if not exists public.order_stage_events (
  id          bigserial primary key,
  order_id    text        not null references public.orders(id) on delete cascade,
  stage       text        not null,
  entered_at  timestamptz not null,
  recorded_at timestamptz not null default now()
);

create index if not exists order_stage_events_order_entered
  on public.order_stage_events (order_id, entered_at);

alter table public.order_stage_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'order_stage_events'
       and policyname = 'no_direct_access'
  ) then
    create policy no_direct_access on public.order_stage_events
      for all to public using (false);
  end if;
end
$$;

grant select, insert on public.order_stage_events to service_role;

create or replace function public.record_order_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.order_stage_events (order_id, stage, entered_at)
    values (new.id, new.stage, coalesce(new.stage_entered_at, pg_catalog.now()));
  end if;
  return new;
end;
$$;

comment on function public.record_order_stage_event() is
  'Item 7 (2026-10-21): one order_stage_events row per creation and per real stage change, at the order''s stage_entered_at.';

create or replace trigger orders_record_stage_event
  after insert or update of stage on public.orders
  for each row execute function public.record_order_stage_event();

insert into public.order_stage_events (order_id, stage, entered_at)
select o.id, o.stage, coalesce(o.stage_entered_at, o.created_at, now())
  from public.orders o
 where not exists (select 1 from public.order_stage_events e where e.order_id = o.id);

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'table', to_regclass('public.order_stage_events') is not null,
  'trigger', (select pg_get_triggerdef(t.oid) from pg_trigger t
               where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_record_stage_event'),
  'policies', (select json_agg(policyname order by policyname) from pg_policies
                where schemaname = 'public' and tablename = 'order_stage_events'),
  'orders', (select count(*) from public.orders),
  'orders_with_an_event', (select count(distinct order_id) from public.order_stage_events),
  'events', (select count(*) from public.order_stage_events)
) as after_migration;
-- Expect: table true; the trigger AFTER INSERT OR UPDATE OF stage; policies
-- [no_direct_access]; orders_with_an_event = orders; events = orders on a first
-- run (one seed each), unchanged on a second.
