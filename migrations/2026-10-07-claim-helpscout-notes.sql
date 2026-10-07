-- 2026-10-07  A warranty claim's progress, as internal notes on its Help Scout
-- conversation (Help Scout part 2; Garrett, 2026-10-07).
--
-- The team answers customers in Help Scout; the claim moves in the OMS. Each
-- time a warranty claim is created or changes stage, an internal note -- seen
-- by the team, never by the customer -- goes onto the conversation the claim
-- came from, so whoever answers sees where it stands without opening the OMS.
--
-- ⚠ A DATABASE TRIGGER, NOT A LINE IN A ROUTE. A claim's stage changes in more
-- than one way: a person moving it, a tracking number advancing it, and any
-- path written later. A note sent from inside each would miss whichever was
-- forgotten. The trigger sees every change to `orders.stage` on a warranty row,
-- whatever made it, and queues it here; lib/claimHelpScout sends the queue.
-- (Bulk stage moves were removed before this existed; the trigger would catch
-- them anyway.)
--
-- ⚠ IN ORDER, PER CLAIM. claim_helpscout_note_lease() hands out only the OLDEST
-- pending note of each claim, so "In review" can never land after "Parts
-- ordered". A note that fails holds its claim's later notes back until it goes.
--
-- Every claim gets queued; one with no conversation -- logged by hand, not
-- promoted from a customer's submission -- is marked `skipped` by the sender.
-- Only events from now on: nothing is backfilled.
--
-- Idempotent and DROP-free. The LAST statement is the check.

begin;

create table if not exists public.claim_helpscout_notes (
  id          bigint generated always as identity primary key,
  order_id    text not null references public.orders(id) on delete cascade,
  event       text not null check (event in ('created', 'stage')),
  from_stage  text,
  to_stage    text not null,
  -- team_members.id holding the claim when it happened, as orders.claimed_by.
  claimed_by  text,
  -- "UPS 1Z…", when the claim had a tracking number at the time.
  tracking    text,
  happened_at timestamptz not null default now(),
  state       text not null default 'pending' check (state in ('pending', 'sent', 'skipped')),
  attempts    integer not null default 0,
  last_error  text,
  leased_at   timestamptz,
  sent_at     timestamptz
);

create index if not exists claim_helpscout_notes_pending_idx
  on public.claim_helpscout_notes (order_id, id)
  where state = 'pending';

-- Server only, like claim_submissions: no browser session reads or writes it.
alter table public.claim_helpscout_notes enable row level security;
revoke all on public.claim_helpscout_notes from anon, authenticated;
-- ⚠ GRANTED OUTRIGHT, NOT LEFT TO SUPABASE'S DEFAULT PRIVILEGES. The trigger
-- below runs as whoever updates `orders` -- the API's service_role -- and
-- inserts here. Without this grant, every stage change on a warranty claim
-- would FAIL, not merely go unnoted (found in testing, 2026-10-07).
grant select, insert, update, delete on public.claim_helpscout_notes to service_role;

create or replace function public.queue_claim_helpscout_note()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type is distinct from 'warranty' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by)
    values (new.id, 'created', new.stage, new.claimed_by);
  elsif new.stage is distinct from old.stage then
    insert into claim_helpscout_notes (order_id, event, from_stage, to_stage, claimed_by, tracking)
    values (new.id, 'stage', old.stage, new.stage, new.claimed_by,
            case when new.tracking_number is not null and new.tracking_number <> ''
                 then concat_ws(' ', nullif(new.carrier, ''), new.tracking_number) end);
  end if;
  return new;
end;
$$;

-- CREATE OR REPLACE TRIGGER (PostgreSQL 14+): a second run replaces it, no DROP.
create or replace trigger orders_claim_helpscout_note
  after insert or update of stage on public.orders
  for each row execute function public.queue_claim_helpscout_note();

-- Hands out up to p_limit pending notes -- only the OLDEST pending note of any
-- one claim -- whose lease is free or expired; marks each and counts the try.
create or replace function public.claim_helpscout_note_lease(p_order_id text default null, p_limit integer default 20)
returns setof public.claim_helpscout_notes
language sql
set search_path = public
as $$
  update public.claim_helpscout_notes n
     set leased_at = now(),
         attempts  = n.attempts + 1
   where n.id in (
     select x.id from public.claim_helpscout_notes x
      where x.state = 'pending'
        and (p_order_id is null or x.order_id = p_order_id)
        and (x.leased_at is null or x.leased_at < now() - interval '10 minutes')
        and not exists (select 1 from public.claim_helpscout_notes y
                         where y.order_id = x.order_id and y.state = 'pending' and y.id < x.id)
      order by x.id
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked)
  returning n.*;
$$;

revoke all on function public.claim_helpscout_note_lease(text, integer) from public, anon, authenticated;
grant execute on function public.claim_helpscout_note_lease(text, integer) to service_role;
revoke all on function public.queue_claim_helpscout_note() from public, anon, authenticated;

commit;

select json_build_object(
  'table', (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'claim_helpscout_notes'),
  'trigger', (select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_claim_helpscout_note'),
  'lease_callers', (select json_agg(grantee order by grantee) from information_schema.routine_privileges
                     where routine_schema = 'public' and routine_name = 'claim_helpscout_note_lease'),
  'service_role_may', (select json_agg(privilege_type order by privilege_type) from information_schema.role_table_grants
                        where table_schema = 'public' and table_name = 'claim_helpscout_notes' and grantee = 'service_role'),
  'queued_so_far', (select count(*) from public.claim_helpscout_notes)
) as after_migration;
-- Expect: table 1; the trigger; lease_callers [postgres, service_role];
-- service_role_may [DELETE, INSERT, SELECT, UPDATE];
-- queued_so_far 0 -- nothing is backfilled.
