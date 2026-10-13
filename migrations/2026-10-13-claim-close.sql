-- 2026-10-13-claim-close.sql
--
-- A warranty claim is CLOSED, never deleted (Garrett, 2026-10-13): Approved or
-- Denied, archived with who, when and why. Denied removes its files (the
-- route does that, storage first); both keep the claim's details and notes.
-- Restoring it from the archive reopens it and clears the outcome.
--
--   orders.claim_outcome   'approved' | 'denied'; NULL while the claim is open
--   orders.closed_at / closed_by / closed_reason
--
-- ⚠ A DENIAL CARRIES ITS REASON: enforced here as well as in the route.
--
-- Help Scout: a trigger queues `closed` (with the outcome, reason and who) or
-- `reopened` whenever claim_outcome changes -- every path, not one route. The
-- sender adds the note and sets the conversation Closed / Active.
--
-- Idempotent and DROP-free but for one check constraint, replaced so the two
-- new events are valid. Run it BEFORE deploying. The LAST statement is the check.

begin;

alter table public.orders add column if not exists claim_outcome text;
alter table public.orders add column if not exists closed_at timestamptz;
alter table public.orders add column if not exists closed_by text;
alter table public.orders add column if not exists closed_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_claim_outcome_check') then
    alter table public.orders add constraint orders_claim_outcome_check check (
      claim_outcome is null
      or (type = 'warranty'
          and claim_outcome in ('approved', 'denied')
          and closed_at is not null
          and (claim_outcome <> 'denied' or length(btrim(coalesce(closed_reason, ''))) > 0)));
  end if;
end $$;

comment on column public.orders.claim_outcome is
  'A closed warranty claim''s outcome: approved or denied. NULL while open. See migrations/2026-10-13-claim-close.sql.';

alter table public.claim_helpscout_notes add column if not exists outcome text;
alter table public.claim_helpscout_notes add column if not exists reason text;
alter table public.claim_helpscout_notes add column if not exists actor text;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check'
               and pg_get_constraintdef(oid) not like '%reopened%') then
    alter table public.claim_helpscout_notes drop constraint claim_helpscout_notes_event_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check') then
    alter table public.claim_helpscout_notes add constraint claim_helpscout_notes_event_check
      check (event in ('created', 'stage', 'deleted', 'closed', 'reopened'));
  end if;
end $$;

create or replace function public.queue_claim_close_note()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type is distinct from 'warranty'
     or new.claim_outcome is not distinct from old.claim_outcome then
    return new;
  end if;
  if new.claim_outcome is not null then
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by, outcome, reason, actor)
    values (new.id, 'closed', new.stage, new.claimed_by, new.claim_outcome, new.closed_reason, new.closed_by);
  else
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by, outcome)
    values (new.id, 'reopened', new.stage, new.claimed_by, old.claim_outcome);
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'orders_claim_close_note') then
    create trigger orders_claim_close_note
      after update of claim_outcome on public.orders
      for each row execute function public.queue_claim_close_note();
  end if;
end $$;

commit;

-- after_migration: expect columns 4, outcome check 1, event check naming 'reopened' 1, trigger 1.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders'
     and column_name in ('claim_outcome', 'closed_at', 'closed_by', 'closed_reason')) as columns,
  (select count(*) from pg_constraint where conname = 'orders_claim_outcome_check') as outcome_check,
  (select count(*) from pg_constraint where conname = 'claim_helpscout_notes_event_check'
     and pg_get_constraintdef(oid) like '%reopened%') as event_check,
  (select count(*) from pg_trigger where tgname = 'orders_claim_close_note') as close_trigger;
