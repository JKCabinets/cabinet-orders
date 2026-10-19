-- 2026-10-19  A member who leaves does not take their open work with them
-- (gap 11 of the 2026-10-13 handoff, "orphaned claims").
--
-- ⚠ WHAT WAS WRONG. A claim is a lock: nobody but its holder (and, for a
-- purchase, an admin) may release it -- and for a custom job, a warranty
-- claim or a customer submission, not even an admin. Deactivating or deleting
-- a member left every claim they held in place, so their open work was locked
-- against everyone else for good. The two id formats ("1", "member-…") were
-- never the problem: both are real team_members ids (2026-10-19, queried).
--
-- ⚠ WHAT HAPPENS NOW (Garrett, 2026-10-19):
--   · DEACTIVATING a member releases their OPEN work -- back to unclaimed, a
--     note on each order's trail. Finished work (an archived purchase or job,
--     a closed claim, a promoted or rejected submission) keeps them: there the
--     claim records who handled it.
--   · DELETING a member (admins only) first lists their open work; each item
--     may be handed to an active member, and whatever is not is released.
--     Finished work keeps the deleted id.
--   · A submission has no trail: the audit log (written by the route) lists it.
--   · One of their submissions MID-PROMOTION refuses the whole thing, as
--     release_submission() refuses: try again in a few minutes.
--
-- ⚠ projects.claimed_by LOSES ITS FOREIGN KEY. It was the only claim column
-- with one, so a member named on any archived purchase could not be deleted;
-- Garrett chose that purchases keep the deleted id like everything else.
--
-- Rows are locked as the release functions lock them, and moved or released as
-- they would be: a purchase's claimed_at follows its claim, as claim_project()
-- and release_project() set it. Idempotent and DROP-free but for that one
-- constraint. Run BEFORE deploying the code that calls it. The LAST statement
-- is the check.

begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.projects'::regclass and contype = 'f'
              and pg_get_constraintdef(oid) like 'FOREIGN KEY (claimed_by) REFERENCES team_members(id)%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end $$;

-- What a member holds that is still open: the delete dialog's list.
create or replace function public.member_open_work(p_member text)
returns table(kind text, id text, label text)
language sql
stable
set search_path to ''
as $$
  select * from (
    select 'project'::text, p.id, coalesce(nullif(p.name, ''), p.id)
      from public.projects p
     where p.claimed_by = p_member and not coalesce(p.archived, false)
    union all
    select case when o.type = 'warranty' then 'claim' else 'job' end, o.id, coalesce(nullif(o.name, ''), o.id)
      from public.orders o
     where o.claimed_by = p_member and o.project_id is null and not coalesce(o.archived, false)
    union all
    select 'submission'::text, s.id::text,
           concat_ws(' · ', coalesce(s.ref, left(s.id::text, 8)), nullif(s.claimant_name, ''))
      from public.claim_submissions s
     where s.claimed_by = p_member and s.status = 'new'
  ) w(kind, id, label)
  order by 1, 2;
$$;

-- Moves the assigned items, releases the rest of the member's OPEN work, and
-- notes it on every order touched -- in one transaction, or not at all.
-- p_assign: {"project:SHO-1050": "member-…", "job:CST-…": "…", "submission:<uuid>": "…"}.
-- p_event: 'deactivated' or 'removed'. p_time: the app's activityDate().
create or replace function public.retire_member_claims(
  p_member text, p_by text, p_event text, p_time text, p_assign jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_name      text;
  v_to        text;
  v_to_name   text;
  v_note      text;
  v_key       text;
  v_moved     jsonb := '[]'::jsonb;
  v_released  jsonb := '[]'::jsonb;
  v_held      text[] := '{}';
  v_promoting text[];
  r           record;
begin
  if p_event not in ('deactivated', 'removed') then
    raise exception 'retire_member_claims: p_event must be deactivated or removed, not %', p_event;
  end if;
  select t.name into v_name from public.team_members t where t.id = p_member;
  v_name := coalesce(v_name, p_member);

  -- Every assignee must be an ACTIVE member, and not the one leaving.
  if exists (select 1 from jsonb_each_text(coalesce(p_assign, '{}'::jsonb)) a
              where a.value = p_member
                 or not exists (select 1 from public.team_members t where t.id = a.value and t.active)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_assignee');
  end if;

  -- Lock what they hold, in one order, as the release functions lock it.
  perform 1 from public.projects p where p.claimed_by = p_member and not coalesce(p.archived, false) order by p.id for update;
  perform 1 from public.orders o where o.claimed_by = p_member and o.project_id is null and not coalesce(o.archived, false) order by o.id for update;
  perform 1 from public.claim_submissions s where s.claimed_by = p_member and s.status = 'new' order by s.id for update;

  -- A submission of theirs being promoted right now refuses all of it.
  select array_agg(coalesce(s.ref, s.id::text) order by s.id) into v_promoting
    from public.claim_submissions s
   where s.claimed_by = p_member and s.status = 'new'
     and s.promoting_since is not null and s.promoting_since > now() - interval '5 minutes';
  if v_promoting is not null then
    return jsonb_build_object('ok', false, 'reason', 'promoting', 'submissions', to_jsonb(v_promoting));
  end if;

  for r in select p.id from public.projects p
            where p.claimed_by = p_member and not coalesce(p.archived, false) order by p.id loop
    v_key := 'project:' || r.id;  v_held := v_held || v_key;
    v_to := p_assign ->> v_key;
    select t.name into v_to_name from public.team_members t where t.id = v_to;
    update public.projects
       set claimed_by = v_to, claimed_at = case when v_to is null then null else now() end, updated_at = now()
     where id = r.id;
    v_note := case when v_to is null
      then format('Claim released — %s was %s by %s', v_name, p_event, p_by)
      else format('Claim moved from %s to %s by %s (%s was %s)', v_name, v_to_name, p_by, v_name, p_event) end;
    -- A purchase has no trail of its own: the note goes on each of its groups.
    insert into public.order_activity (order_id, text, time)
      select o.id, v_note, p_time from public.orders o where o.project_id = r.id;
    if v_to is null then v_released := v_released || jsonb_build_object('kind', 'project', 'id', r.id);
    else v_moved := v_moved || jsonb_build_object('kind', 'project', 'id', r.id, 'to', v_to); end if;
  end loop;

  for r in select o.id, o.type from public.orders o
            where o.claimed_by = p_member and o.project_id is null and not coalesce(o.archived, false) order by o.id loop
    v_key := (case when r.type = 'warranty' then 'claim:' else 'job:' end) || r.id;  v_held := v_held || v_key;
    v_to := p_assign ->> v_key;
    select t.name into v_to_name from public.team_members t where t.id = v_to;
    update public.orders set claimed_by = v_to where id = r.id;
    v_note := case when v_to is null
      then format('Claim released — %s was %s by %s', v_name, p_event, p_by)
      else format('Claim moved from %s to %s by %s (%s was %s)', v_name, v_to_name, p_by, v_name, p_event) end;
    insert into public.order_activity (order_id, text, time) values (r.id, v_note, p_time);
    if v_to is null then v_released := v_released || jsonb_build_object('kind', split_part(v_key, ':', 1), 'id', r.id);
    else v_moved := v_moved || jsonb_build_object('kind', split_part(v_key, ':', 1), 'id', r.id, 'to', v_to); end if;
  end loop;

  for r in select s.id, coalesce(s.ref, s.id::text) as ref from public.claim_submissions s
            where s.claimed_by = p_member and s.status = 'new' order by s.id loop
    v_key := 'submission:' || r.id::text;  v_held := v_held || v_key;
    v_to := p_assign ->> v_key;
    update public.claim_submissions
       set claimed_by = v_to, claimed_at = case when v_to is null then null else now() end
     where id = r.id;
    if v_to is null then v_released := v_released || jsonb_build_object('kind', 'submission', 'id', r.ref);
    else v_moved := v_moved || jsonb_build_object('kind', 'submission', 'id', r.ref, 'to', v_to); end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'moved', v_moved, 'released', v_released,
    -- Assigned in the dialog but no longer theirs (or no longer open) when this ran.
    'not_held', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(coalesce(p_assign, '{}'::jsonb)) k
                          where not (k = any (v_held))), '[]'::jsonb));
end;
$$;

revoke all on function public.member_open_work(text) from public, anon, authenticated;
revoke all on function public.retire_member_claims(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.member_open_work(text) to service_role;
grant execute on function public.retire_member_claims(text, text, text, text, jsonb) to service_role;

commit;

select json_build_object(
  'projects_claimed_by_foreign_key', (select count(*) from pg_constraint
      where conrelid = 'public.projects'::regclass and contype = 'f'
        and pg_get_constraintdef(oid) like 'FOREIGN KEY (claimed_by)%'),
  'functions', (select coalesce(json_agg(json_build_object('fn', p.proname,
        'callers', (select json_agg(g.grantee order by g.grantee) from information_schema.routine_privileges g
                     where g.routine_schema = 'public' and g.routine_name = p.proname)) order by p.proname), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('member_open_work', 'retire_member_claims')),
  'claims_held_now', (select count(*) from public.projects where claimed_by is not null)
                   + (select count(*) from public.orders where claimed_by is not null)
                   + (select count(*) from public.claim_submissions where claimed_by is not null)
) as after_migration;
-- Expect: projects_claimed_by_foreign_key 0; two functions, each callable by
-- [postgres, service_role]; claims_held_now 11 on 2026-10-19 (unchanged --
-- the migration moves nothing).
