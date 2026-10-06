-- 2026-10-05  Every claim from the website becomes a Help Scout conversation.
--
-- The OMS records a claim first -- checked, scrubbed, stamped with the time it
-- arrived, given its reference -- and then hands it to Help Scout, where the team
-- answers customers (Garrett, 2026-10-05). These columns say where each
-- submission is in that hand-off; claim_helpscout_lease() is the only way a
-- sender gets one to send.
--
-- ⚠ ONLY CLAIMS FROM NOW ON. Every row already here is `skipped`: CR-1001 to
-- CR-1003 are test claims, and pushing them would make the website's Help Scout
-- workflow email a confirmation for each. The column is added with DEFAULT
-- 'skipped' -- which existing rows take -- and the default is then changed to
-- 'pending' for every row inserted after. A second run changes neither: the
-- column already exists, so no existing row is touched again.
--
-- ⚠ ONE SENDER PER CLAIM. The claims route pushes a claim the moment it is
-- recorded, and a retry job sweeps every 15 minutes. Both take claims ONLY
-- through claim_helpscout_lease(), which marks what it hands out (FOR UPDATE
-- SKIP LOCKED, then a ten-minute lease), so the two can never send one claim
-- twice. A lease that is never released -- the container restarted mid-send --
-- expires, and the next sweep takes the claim again.
--
-- Idempotent and DROP-free. The LAST statement is the check.

begin;

alter table public.claim_submissions
  add column if not exists helpscout_state text not null default 'skipped';
alter table public.claim_submissions
  alter column helpscout_state set default 'pending';

alter table public.claim_submissions add column if not exists helpscout_conversation_id bigint;
alter table public.claim_submissions add column if not exists helpscout_url text;
alter table public.claim_submissions add column if not exists helpscout_attempts integer not null default 0;
alter table public.claim_submissions add column if not exists helpscout_last_error text;
alter table public.claim_submissions add column if not exists helpscout_leased_at timestamptz;
alter table public.claim_submissions add column if not exists helpscout_sent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_helpscout_state_check') then
    alter table public.claim_submissions
      add constraint claim_submissions_helpscout_state_check
      check (helpscout_state in ('pending', 'sent', 'skipped'));
  end if;
  -- Sent means a conversation, and a conversation means sent. Both sides are
  -- NOT NULL booleans, so this cannot pass on a NULL.
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_helpscout_sent_has_id') then
    alter table public.claim_submissions
      add constraint claim_submissions_helpscout_sent_has_id
      check ((helpscout_state = 'sent') = (helpscout_conversation_id is not null));
  end if;
end
$$;

create index if not exists claim_submissions_helpscout_pending_idx
  on public.claim_submissions (received_at)
  where helpscout_state = 'pending';

comment on column public.claim_submissions.helpscout_state is
  'pending: to be sent to Help Scout. sent: a conversation exists (helpscout_conversation_id). skipped: never to be sent -- every row from before 2026-10-05.';

-- Hands out up to p_limit pending claims (or the one named by p_id) whose lease
-- is free or expired, oldest first; marks each leased and counts the attempt.
create or replace function public.claim_helpscout_lease(p_id uuid default null, p_limit integer default 10)
returns setof public.claim_submissions
language sql
set search_path = public
as $$
  update public.claim_submissions c
     set helpscout_leased_at = now(),
         helpscout_attempts  = c.helpscout_attempts + 1
   where c.id in (
     select s.id from public.claim_submissions s
      where s.helpscout_state = 'pending'
        and (p_id is null or s.id = p_id)
        and (s.helpscout_leased_at is null or s.helpscout_leased_at < now() - interval '10 minutes')
      order by s.received_at
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked)
  returning c.*;
$$;

-- service_role only, like every function that writes claim_submissions.
revoke all on function public.claim_helpscout_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_helpscout_lease(uuid, integer) to service_role;

commit;

select json_build_object(
  'columns', (select json_agg(column_name order by column_name) from information_schema.columns
               where table_schema = 'public' and table_name = 'claim_submissions' and column_name like 'helpscout%'),
  'state_default', (select column_default from information_schema.columns
                     where table_schema = 'public' and table_name = 'claim_submissions' and column_name = 'helpscout_state'),
  'states', (select coalesce(json_object_agg(helpscout_state, n), '{}') from
              (select helpscout_state, count(*) n from public.claim_submissions group by 1) t),
  'lease_callers', (select json_agg(grantee order by grantee) from information_schema.routine_privileges
                     where routine_schema = 'public' and routine_name = 'claim_helpscout_lease')
) as after_migration;
-- Expect: seven helpscout_ columns; state_default 'pending'::text; every
-- existing row skipped (no pending, no sent); lease_callers [postgres, service_role].
