-- 2026-10-06  A claim submission can be CLAIMED, like an order -- and promoting
-- one claims it first.
--
-- ⚠ WHY (Garrett, 2026-10-06): "Once claimed, the order is locked to that
-- person to avoid duplicate communication and duplicate orders." Orders have
-- had that since v16_order_claims.sql; the submissions waiting in the triage
-- queue had nothing, so two people could each answer the same customer and
-- each promote the same report.
--
-- ⚠ AND A RACE THAT WAS ON THE OPEN LIST. The promote route checked
-- `status = 'new'` when it started and only marked the submission promoted
-- when it finished, so two promotions pressed together both created a
-- warranty claim -- the second merely failed to mark. A claim alone does not
-- stop the same person pressing twice. begin_promotion() does both in one
-- locked step: it claims the submission for the caller AND takes a five-minute
-- promotion lease, and refuses while another promotion holds one. The route
-- clears the lease when it marks the submission promoted, or when it fails.
-- Five minutes only matters if a promotion dies outright mid-way.
--
-- The functions mirror claim_order() / release_order(): the row locked FOR
-- UPDATE, first writer wins, (ok, claimed_by, reason) back. As with orders,
-- releasing is the owner's alone and nobody claims over somebody else.
--
-- Idempotent and DROP-free. The LAST statement is the check.

begin;

alter table public.claim_submissions add column if not exists claimed_by text;
alter table public.claim_submissions add column if not exists claimed_at timestamptz;
alter table public.claim_submissions add column if not exists promoting_since timestamptz;

comment on column public.claim_submissions.claimed_by is
  'team_members.id of whoever has claimed this submission, as orders.claimed_by. Set by claim_submission() and begin_promotion() only.';

create or replace function public.claim_submission(p_id uuid, p_user text)
returns table(ok boolean, claimed_by text, reason text)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_claimed text;
  v_status  text;
begin
  select s.claimed_by, s.status into v_claimed, v_status
    from claim_submissions s where s.id = p_id for update;
  if not found then
    return query select false, null::text, 'not_found'::text; return;
  end if;
  if v_status <> 'new' then
    return query select false, v_claimed, 'closed'::text; return;
  end if;
  if v_claimed is not null and v_claimed <> p_user then
    return query select false, v_claimed, 'already_claimed'::text; return;
  end if;
  if v_claimed is null then
    update claim_submissions set claimed_by = p_user, claimed_at = now() where id = p_id;
  end if;
  return query select true, p_user, null::text;
end;
$$;

create or replace function public.release_submission(p_id uuid, p_user text)
returns table(ok boolean, claimed_by text, reason text)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_claimed   text;
  v_promoting timestamptz;
begin
  select s.claimed_by, s.promoting_since into v_claimed, v_promoting
    from claim_submissions s where s.id = p_id for update;
  if not found then
    return query select false, null::text, 'not_found'::text; return;
  end if;
  if v_claimed is null then
    return query select true, null::text, null::text; return;
  end if;
  if v_claimed <> p_user then
    return query select false, v_claimed, 'not_owner'::text; return;
  end if;
  -- Not mid-promotion: letting go while your own promotion runs would let a
  -- colleague claim a submission that is about to be promoted.
  if v_promoting is not null and v_promoting > now() - interval '5 minutes' then
    return query select false, v_claimed, 'promoting'::text; return;
  end if;
  update claim_submissions set claimed_by = null, claimed_at = null where id = p_id;
  return query select true, null::text, null::text;
end;
$$;

create or replace function public.begin_promotion(p_id uuid, p_user text)
returns table(ok boolean, claimed_by text, reason text)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_claimed   text;
  v_status    text;
  v_promoting timestamptz;
begin
  select s.claimed_by, s.status, s.promoting_since into v_claimed, v_status, v_promoting
    from claim_submissions s where s.id = p_id for update;
  if not found then
    return query select false, null::text, 'not_found'::text; return;
  end if;
  if v_status <> 'new' then
    return query select false, v_claimed, 'closed'::text; return;
  end if;
  if v_claimed is not null and v_claimed <> p_user then
    return query select false, v_claimed, 'already_claimed'::text; return;
  end if;
  if v_promoting is not null and v_promoting > now() - interval '5 minutes' then
    return query select false, v_claimed, 'promoting'::text; return;
  end if;
  update claim_submissions
     set claimed_by      = p_user,
         claimed_at      = case when v_claimed = p_user then claimed_at else now() end,
         promoting_since = now()
   where id = p_id;
  return query select true, p_user, null::text;
end;
$$;

-- service_role only, like claim_order() and release_order().
revoke all on function public.claim_submission(uuid, text)   from public, anon, authenticated;
revoke all on function public.release_submission(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_promotion(uuid, text)    from public, anon, authenticated;
grant execute on function public.claim_submission(uuid, text)   to service_role;
grant execute on function public.release_submission(uuid, text) to service_role;
grant execute on function public.begin_promotion(uuid, text)    to service_role;

commit;

select json_build_object(
  'columns', (select json_agg(column_name order by column_name) from information_schema.columns
               where table_schema = 'public' and table_name = 'claim_submissions'
                 and column_name in ('claimed_by', 'claimed_at', 'promoting_since')),
  'functions', (select json_agg(json_build_object('fn', p.proname, 'callers',
                  (select json_agg(g.grantee order by g.grantee) from information_schema.routine_privileges g
                    where g.routine_schema = 'public' and g.routine_name = p.proname)) order by p.proname)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('claim_submission', 'release_submission', 'begin_promotion')),
  'claimed_now', (select count(*) from public.claim_submissions where claimed_by is not null)
) as after_migration;
-- Expect: three columns; three functions, each callable by [postgres, service_role];
-- claimed_now 0.
