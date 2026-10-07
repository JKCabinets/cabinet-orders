-- 2026-10-07  Deleting a warranty claim CLOSES its Help Scout conversation.
--
-- ⚠ CLOSED, NEVER DELETED (Garrett, 2026-10-07). The conversation and every
-- message in it stay in Help Scout; only its status becomes Closed, with one
-- last internal note saying why. A reply from the customer reopens it, as
-- Help Scout always does.
--
-- ⚠ CAUGHT BEFORE THE ROW GOES. A claim finds its conversation through the
-- submission it was promoted from. A BEFORE DELETE trigger reads that while the
-- claim still exists, and queues a `deleted` event carrying the conversation
-- itself -- the event has no claim row to point at, so its `order_id` is null
-- and `claim_ref` keeps the claim's number for the note. Like the progress
-- notes, it catches every deletion, from the OMS or by hand.
--
-- ⚠ AND THE SUBMISSION IS UNLINKED. `promoted_to_order_id` is plain text, not a
-- foreign key, so a deleted claim left its submission pointing at nothing --
-- and createWarranty numbers a claim as the highest existing number plus one,
-- so the NEXT claim on that order takes the deleted one's number. Its progress
-- notes would then have gone to the OLD customer's conversation. The trigger
-- clears the link and says so in the submission's review notes; this migration
-- does the same for links already pointing at deleted claims.
--
-- Idempotent and DROP-free but for one check constraint, replaced so that
-- `deleted` is a valid event. The LAST statement is the check.

begin;

alter table public.claim_helpscout_notes add column if not exists conversation_id bigint;
alter table public.claim_helpscout_notes add column if not exists claim_ref text;
alter table public.claim_helpscout_notes alter column order_id drop not null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check'
               and pg_get_constraintdef(oid) not like '%deleted%') then
    alter table public.claim_helpscout_notes drop constraint claim_helpscout_notes_event_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_event_check') then
    alter table public.claim_helpscout_notes
      add constraint claim_helpscout_notes_event_check check (event in ('created', 'stage', 'deleted'));
  end if;
  -- A `deleted` event, and only one, has no claim row -- and must carry the
  -- conversation and the claim's number instead.
  if not exists (select 1 from pg_constraint where conname = 'claim_helpscout_notes_deleted_shape') then
    alter table public.claim_helpscout_notes
      add constraint claim_helpscout_notes_deleted_shape check (
        (event = 'deleted') = (order_id is null)
        and (event <> 'deleted' or (conversation_id is not null and claim_ref is not null)));
  end if;
end
$$;

create or replace function public.queue_claim_helpscout_close()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_conv bigint;
begin
  if old.type is distinct from 'warranty' then
    return old;
  end if;
  select s.helpscout_conversation_id into v_conv
    from claim_submissions s
   where s.promoted_to_order_id = old.id
     and s.helpscout_state = 'sent'
     and s.helpscout_conversation_id is not null
   order by s.promoted_at desc nulls last
   limit 1;
  if v_conv is not null then
    insert into claim_helpscout_notes (order_id, event, to_stage, claimed_by, claim_ref, conversation_id)
    values (null, 'deleted', old.stage, old.claimed_by, old.id, v_conv);
  end if;
  update claim_submissions
     set promoted_to_order_id = null,
         review_notes = concat_ws(E'\n', nullif(review_notes, ''),
           format('Its claim %s was deleted on %s.', old.id,
                  to_char(now() at time zone 'America/Phoenix', 'Mon FMDD, YYYY')))
   where promoted_to_order_id = old.id;
  return old;
end;
$$;

create or replace trigger orders_claim_helpscout_close
  before delete on public.orders
  for each row execute function public.queue_claim_helpscout_close();

revoke all on function public.queue_claim_helpscout_close() from public, anon, authenticated;

-- Links already pointing at a claim that no longer exists. (In SET, the
-- column names read the row as it was, so the note names the old claim.)
update public.claim_submissions s
   set promoted_to_order_id = null,
       review_notes = concat_ws(E'\n', nullif(s.review_notes, ''),
         format('Its claim %s was deleted before 2026-10-07.', s.promoted_to_order_id))
 where s.promoted_to_order_id is not null
   and not exists (select 1 from public.orders o where o.id = s.promoted_to_order_id);

commit;

select json_build_object(
  'new_columns', (select json_agg(column_name order by column_name) from information_schema.columns
                   where table_schema = 'public' and table_name = 'claim_helpscout_notes'
                     and column_name in ('conversation_id', 'claim_ref')),
  'events_allowed', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'claim_helpscout_notes_event_check'),
  'close_trigger', (select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_claim_helpscout_close'),
  'unlinked', (select coalesce(json_agg(ref order by ref), '[]') from public.claim_submissions
                where review_notes like '%was deleted before 2026-10-07.%'),
  'still_dangling', (select count(*) from public.claim_submissions s
                      where s.promoted_to_order_id is not null
                        and not exists (select 1 from public.orders o where o.id = s.promoted_to_order_id))
) as after_migration;
-- Expect: both new columns; the events allowed including 'deleted'; the
-- trigger; every submission that pointed at a deleted claim listed under
-- unlinked (CR-1003, at least, which pointed at WRN-1052-1); still_dangling 0.
