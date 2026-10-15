-- 2026-10-14  A claim's tracking number, noted on its Help Scout conversation
-- when it changes AFTER the claim shipped (item 2 of the 2026-10-13 handoff).
--
-- The 2026-10-07 trigger notes a claim's stage changes, and copies the tracking
-- number into the note for a move to Shipped. A claim needs nothing to reach
-- Shipped, and its number usually arrives after the move (item 45) -- so the
-- usual case put a Shipped note in Help Scout with no number, and nothing when
-- the number came. A claim's number never moves its stage (2026-10-13), so no
-- stage event ever carried it.
--
-- ⚠ WHAT GETS A NOTE (Garrett, 2026-10-14): a number ADDED, CORRECTED (the note
-- gives old and new) or CLEARED, on a claim at Shipped or Resolved. A carrier
-- changed on its own gets none; the same number saved again is not a change.
-- A closed claim gets none: its conversation is closed and its outcome
-- recorded. Before Shipped there is nothing to note -- the move to Shipped
-- carries whatever number is on the row by then.
--
-- ⚠ NOT TWICE. An update that moves a claim INTO Shipped and sets its number
-- is noted once, by the stage note, which already carries the number. An
-- update that moves it to Resolved and changes the number gets both, in that
-- order: the Resolved note does not show tracking.
--
-- ⚠ SENT BY THE 15-MINUTE SWEEP (Garrett, 2026-10-14), not at once: the order
-- PATCH route pushes notes only for a stage change, and is unchanged.
--
-- ⚠ RUN IT AFTER THE CODE IS DEPLOYED, NOT BEFORE. The sender before this
-- change does not know a `tracking` event: it words any event that is not
-- `created` as a stage move, so a number saved between this migration and the
-- deploy would reach Help Scout as "moved to Shipped". The new sender is safe
-- with or without this migration.
--
-- Only changes from now on: nothing is backfilled. Idempotent and DROP-free
-- but for one check constraint, replaced so that `tracking` is a valid event,
-- as the 2026-10-07 and 2026-10-13 migrations did. The LAST statement is the
-- check.

begin;

-- "UPS 1Z…" as it was before the change. The new value goes in `tracking`.
alter table public.claim_helpscout_notes add column if not exists tracking_before text;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check'
               and pg_get_constraintdef(oid) not like '%tracking%') then
    alter table public.claim_helpscout_notes drop constraint claim_helpscout_notes_event_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check') then
    alter table public.claim_helpscout_notes add constraint claim_helpscout_notes_event_check
      check (event in ('created', 'stage', 'deleted', 'closed', 'reopened', 'tracking'));
  end if;
end $$;

create or replace function public.queue_claim_helpscout_note()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_was text;
  v_now text;
begin
  if new.type is distinct from 'warranty' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by)
    values (new.id, 'created', new.stage, new.claimed_by);
    return new;
  end if;
  if new.stage is distinct from old.stage then
    insert into claim_helpscout_notes (order_id, event, from_stage, to_stage, claimed_by, tracking)
    values (new.id, 'stage', old.stage, new.stage, new.claimed_by,
            case when new.tracking_number is not null and new.tracking_number <> ''
                 then concat_ws(' ', nullif(new.carrier, ''), new.tracking_number) end);
  end if;
  -- The number, compared as the route stores it: trimmed, and empty is none.
  v_was := nullif(btrim(coalesce(old.tracking_number, '')), '');
  v_now := nullif(btrim(coalesce(new.tracking_number, '')), '');
  if v_now is distinct from v_was
     and new.stage in ('Shipped', 'Resolved')
     and new.claim_outcome is null
     and not (new.stage is distinct from old.stage and new.stage = 'Shipped') then
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by, tracking, tracking_before)
    values (new.id, 'tracking', new.stage, new.claimed_by,
            case when v_now is not null then concat_ws(' ', nullif(btrim(coalesce(new.carrier, '')), ''), v_now) end,
            case when v_was is not null then concat_ws(' ', nullif(btrim(coalesce(old.carrier, '')), ''), v_was) end);
  end if;
  return new;
end;
$$;

-- Now ALSO on a change to the number. CREATE OR REPLACE TRIGGER (PostgreSQL
-- 14+): a second run replaces it, no DROP. Not on `carrier`: a carrier changed
-- on its own gets no note, and the route sends the number with every carrier.
create or replace trigger orders_claim_helpscout_note
  after insert or update of stage, tracking_number on public.orders
  for each row execute function public.queue_claim_helpscout_note();

revoke all on function public.queue_claim_helpscout_note() from public, anon, authenticated;

commit;

select json_build_object(
  'tracking_before', (select count(*) from information_schema.columns where table_schema = 'public'
                        and table_name = 'claim_helpscout_notes' and column_name = 'tracking_before'),
  'events_allowed', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'claim_helpscout_notes_event_check'),
  'trigger_fires_on', (select pg_get_triggerdef(oid) from pg_trigger
                         where tgrelid = 'public.orders'::regclass and tgname = 'orders_claim_helpscout_note'),
  'function_knows_tracking', (select count(*) from pg_proc
                                where proname = 'queue_claim_helpscout_note' and prosrc like '%''tracking''%'),
  'queued_tracking_so_far', (select count(*) from public.claim_helpscout_notes where event = 'tracking')
) as after_migration;
-- Expect: tracking_before 1; events_allowed naming 'tracking'; the trigger
-- firing AFTER INSERT OR UPDATE OF stage, tracking_number; function_knows_tracking 1;
-- queued_tracking_so_far 0 -- nothing is backfilled.
