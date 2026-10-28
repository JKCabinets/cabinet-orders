-- 2026-10-27  File groups, PHASE A (item 8 step 5; Garrett, 2026-10-26).
--
-- WHAT GARRETT DECIDED. Groups belong to ONE order and are named by people. A
-- file is uploaded INTO a group, so a group exists first. Deleting a group
-- deletes its files, after a prompt. The OMS creates "Customer uploads" (the
-- quote form, a promoted claim) and "Proof of delivery" (a signed receipt) --
-- ordinary groups people may rename or delete; the OMS finds them by ROLE, and
-- makes a fresh one when the next such file arrives. A custom job's rooms and
-- style groups each have a group named after them, which FOLLOWS the room:
-- created, renamed and deleted with it -- files included -- in the same
-- transaction that saves the room.
--
-- ⚠ kind IS UNTOUCHED. It says what a file IS (general / proof_of_delivery /
-- customer_upload), and the gates read it: Delivered needs a proof_of_delivery
-- file, Entered an acknowledgment or any file. A group only says where a file is
-- FILED, so moving a receipt can never undo the delivery gate.
--
-- ⚠ TWO PHASES, so uploads never break while a deploy is in flight:
--   A (this, BEFORE the deploy): the table; order_attachments.group_id NULLABLE;
--     the room functions keep groups in step. The code still live keeps working.
--   B (AFTER the deploy): group_id NOT NULL; spec_ref retired -- refusing, by
--     name, any file that arrived without a group.
--
-- ⚠ ROWS FIRST, THEN STORAGE. The functions that delete files delete their ROWS
-- and return the storage paths; the route then removes the stored files. If
-- that removal fails, the file is an orphan -- listed by storage_orphans() and
-- removed by the storage sweep -- never a row pointing at a missing file.
--
-- On 2026-10-26 the system held no files at all (5a). Idempotent; no DROP of a
-- table; the last statement is the check.

begin;

create table if not exists public.order_file_groups (
  id          bigserial primary key,
  order_id    text        not null references public.orders(id) on delete cascade,
  name        text        not null check (length(btrim(name)) between 1 and 80),
  -- NULL: a group people made. Otherwise what the OMS made it for.
  role        text        check (role in ('customer_uploads', 'proof_of_delivery', 'area', 'set')),
  -- The room's (a_…) or style group's (s_…) id, for role area / set only.
  spec_ref    text,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint order_file_groups_spec_ref_iff_room
    check ((role in ('area', 'set')) = (spec_ref is not null) or (role is null and spec_ref is null))
);

-- ONE per role per order -- so two customer uploads arriving together cannot
-- make two "Customer uploads" -- and one per room or style group.
create unique index if not exists order_file_groups_one_per_role
  on public.order_file_groups (order_id, role) where role in ('customer_uploads', 'proof_of_delivery');
create unique index if not exists order_file_groups_one_per_spec
  on public.order_file_groups (order_id, spec_ref) where spec_ref is not null;
create index if not exists order_file_groups_order on public.order_file_groups (order_id);

-- ⚠ GRANTED HERE, NOT LEFT TO DEFAULTS. Supabase usually grants a new table to
-- its roles; this does not rely on it. The server's role writes; a signed-in
-- session READS -- realtime delivers only rows the subscriber may select.
grant select, insert, update, delete on public.order_file_groups to service_role;
grant usage, select on sequence public.order_file_groups_id_seq to service_role;
grant select on public.order_file_groups to authenticated;

alter table public.order_file_groups enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_file_groups' and policyname = 'no_direct_access') then
    create policy no_direct_access on public.order_file_groups for all to public using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_file_groups' and policyname = 'authenticated_read_all_file_groups') then
    create policy authenticated_read_all_file_groups on public.order_file_groups for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_file_groups') then
    alter publication supabase_realtime add table public.order_file_groups;
  end if;
end
$$;

-- ⚠ NO ACTION, NOT RESTRICT. Both refuse deleting a group that still has files
-- -- deleting a group's files is the server's explicit job, after the prompt.
-- But RESTRICT is checked at once, mid-cascade, and would stop an ORDER being
-- deleted with its groups and files together; NO ACTION waits for the
-- statement to finish, by which time the cascade has removed both.
alter table public.order_attachments
  add column if not exists group_id bigint references public.order_file_groups(id);
create index if not exists order_attachments_group on public.order_attachments (group_id);

-- ── The OMS's own groups: get it, or make it ─────────────────────────────
create or replace function public.file_group_for_role(p_order_id text, p_role text, p_name text)
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  gid bigint;
begin
  if p_role not in ('customer_uploads', 'proof_of_delivery') then
    raise exception 'file_group_for_role: % is not a role the OMS makes', p_role;
  end if;
  insert into public.order_file_groups (order_id, name, role)
  values (p_order_id, p_name, p_role)
  on conflict (order_id, role) where role in ('customer_uploads', 'proof_of_delivery') do nothing;
  select id into gid from public.order_file_groups where order_id = p_order_id and role = p_role;
  return gid;
end
$$;

-- ── Deleting a group: its files' rows and the group, in one transaction ───
create or replace function public.delete_file_group(p_order_id text, p_group_id bigint)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  g record;
  paths text[];
begin
  select id, role into g from public.order_file_groups where id = p_group_id and order_id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if g.role in ('area', 'set') then return jsonb_build_object('result', 'follows_room'); end if;
  with gone as (delete from public.order_attachments where group_id = p_group_id returning file_path)
  select coalesce(array_agg(file_path), '{}') into paths from gone;
  delete from public.order_file_groups where id = p_group_id;
  return jsonb_build_object('result', 'ok', 'removed_files', to_jsonb(paths));
end
$$;

-- ── The room functions, keeping groups in step ───────────────────────────
-- As 2026-09-30 wrote them, plus: the room's group and each style group's,
-- created or renamed; a removed style group's (or room's) files and group
-- deleted, their paths returned as removed_files. Files still filed by spec_ref
-- alone (only possible between phase A and the deploy) are unlinked as before.
create or replace function public.custom_specs_save_area(
  p_order_id text,
  p_area jsonb,
  p_base_rev integer
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  r record;
  doc jsonb;
  incoming jsonb;
  existing jsonb;
  pos bigint;
  new_area jsonb;
  new_doc jsonb;
  problem text;
  removed text[] := '{}';
  unlinked int := 0;
  paths text[] := '{}';
begin
  select type, archived, custom_specs into r from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.type <> 'custom' then return jsonb_build_object('result', 'not_custom'); end if;
  if r.archived then return jsonb_build_object('result', 'archived'); end if;
  doc := coalesce(r.custom_specs, '{"v": 2, "areas": []}'::jsonb);
  if jsonb_typeof(p_area) is distinct from 'object' then
    return jsonb_build_object('result', 'invalid', 'problem', 'the room is not an object');
  end if;
  incoming := p_area - 'rev';
  select a, ord into existing, pos
    from jsonb_array_elements(doc -> 'areas') with ordinality as t(a, ord)
   where a ->> 'id' = incoming ->> 'id';
  if existing is null then
    if p_base_rev is not null then
      return jsonb_build_object('result', 'conflict', 'current', null, 'specs', doc);
    end if;
    new_area := incoming || '{"rev": 1}'::jsonb;
    new_doc := jsonb_set(doc, '{areas}', (doc -> 'areas') || jsonb_build_array(new_area));
  else
    if p_base_rev is null or (existing ->> 'rev')::int <> p_base_rev then
      return jsonb_build_object('result', 'conflict', 'current', existing, 'specs', doc);
    end if;
    new_area := incoming || jsonb_build_object('rev', (existing ->> 'rev')::int + 1);
    new_doc := jsonb_set(doc, array['areas', (pos - 1)::text], new_area);
  end if;
  problem := public.custom_specs_problem(new_doc);
  if problem is not null then
    return jsonb_build_object('result', 'invalid', 'problem', problem);
  end if;
  if existing is not null then
    removed := array(
      select s ->> 'id' from jsonb_array_elements(existing -> 'sets') s
      except
      select s ->> 'id' from jsonb_array_elements(new_area -> 'sets') s
    );
  end if;
  update public.orders set custom_specs = new_doc where id = p_order_id;
  -- The room's group, and each style group's, named after them.
  insert into public.order_file_groups (order_id, name, role, spec_ref)
  values (p_order_id, left(coalesce(nullif(btrim(new_area ->> 'name'), ''), 'Room'), 80), 'area', new_area ->> 'id')
  on conflict (order_id, spec_ref) where spec_ref is not null do update set name = excluded.name;
  insert into public.order_file_groups (order_id, name, role, spec_ref)
  select p_order_id,
         left(coalesce(nullif(btrim(new_area ->> 'name'), ''), 'Room') || ' — ' || coalesce(nullif(btrim(s ->> 'name'), ''), 'Style group'), 80),
         'set', s ->> 'id'
    from jsonb_array_elements(coalesce(new_area -> 'sets', '[]'::jsonb)) s
  on conflict (order_id, spec_ref) where spec_ref is not null do update set name = excluded.name;
  if cardinality(removed) > 0 then
    with gone as (
      delete from public.order_attachments
       where group_id in (select id from public.order_file_groups where order_id = p_order_id and spec_ref = any (removed))
      returning file_path)
    select coalesce(array_agg(file_path), '{}') into paths from gone;
    delete from public.order_file_groups where order_id = p_order_id and spec_ref = any (removed);
    update public.order_attachments set spec_ref = null
     where order_id = p_order_id and spec_ref = any (removed);
    get diagnostics unlinked = row_count;
  end if;
  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', new_area, 'unlinked', unlinked,
                            'removed_files', to_jsonb(paths));
end
$$;

create or replace function public.custom_specs_remove_area(
  p_order_id text,
  p_area_id text,
  p_base_rev integer
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  r record;
  doc jsonb;
  existing jsonb;
  new_doc jsonb;
  removed text[];
  unlinked int := 0;
  paths text[] := '{}';
begin
  select type, archived, custom_specs into r from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.type <> 'custom' then return jsonb_build_object('result', 'not_custom'); end if;
  if r.archived then return jsonb_build_object('result', 'archived'); end if;
  doc := coalesce(r.custom_specs, '{"v": 2, "areas": []}'::jsonb);
  select a into existing from jsonb_array_elements(doc -> 'areas') a where a ->> 'id' = p_area_id;
  if existing is null or p_base_rev is null or (existing ->> 'rev')::int <> p_base_rev then
    return jsonb_build_object('result', 'conflict', 'current', existing, 'specs', doc);
  end if;
  new_doc := jsonb_set(doc, '{areas}', coalesce((
    select jsonb_agg(a order by ord)
      from jsonb_array_elements(doc -> 'areas') with ordinality as t(a, ord)
     where a ->> 'id' <> p_area_id
  ), '[]'::jsonb));
  removed := array(select s ->> 'id' from jsonb_array_elements(existing -> 'sets') s) || p_area_id;
  update public.orders set custom_specs = new_doc where id = p_order_id;
  with gone as (
    delete from public.order_attachments
     where group_id in (select id from public.order_file_groups where order_id = p_order_id and spec_ref = any (removed))
    returning file_path)
  select coalesce(array_agg(file_path), '{}') into paths from gone;
  delete from public.order_file_groups where order_id = p_order_id and spec_ref = any (removed);
  update public.order_attachments set spec_ref = null
   where order_id = p_order_id and spec_ref = any (removed);
  get diagnostics unlinked = row_count;
  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', existing, 'unlinked', unlinked,
                            'removed_files', to_jsonb(paths));
end
$$;

-- ── Back-fill: a group for every room and style group that exists today ──
-- Groups are made when a room is SAVED; rooms saved before this migration have
-- none. Named exactly as the functions above name them; ON CONFLICT DO
-- NOTHING, so a second run, or a room saved meanwhile, is left as it is.
insert into public.order_file_groups (order_id, name, role, spec_ref)
select o.id, left(coalesce(nullif(btrim(a ->> 'name'), ''), 'Room'), 80), 'area', a ->> 'id'
  from public.orders o, jsonb_array_elements(coalesce(o.custom_specs -> 'areas', '[]'::jsonb)) a
 where o.type = 'custom'
on conflict (order_id, spec_ref) where spec_ref is not null do nothing;
insert into public.order_file_groups (order_id, name, role, spec_ref)
select o.id,
       left(coalesce(nullif(btrim(a ->> 'name'), ''), 'Room') || ' — ' || coalesce(nullif(btrim(st ->> 'name'), ''), 'Style group'), 80),
       'set', st ->> 'id'
  from public.orders o,
       jsonb_array_elements(coalesce(o.custom_specs -> 'areas', '[]'::jsonb)) a,
       jsonb_array_elements(coalesce(a -> 'sets', '[]'::jsonb)) st
 where o.type = 'custom'
on conflict (order_id, spec_ref) where spec_ref is not null do nothing;

-- service_role only, as every function here: Supabase grants new functions to
-- anon and authenticated by default, which would put them on /rest/v1/rpc.
revoke all on function public.file_group_for_role(text, text, text) from public, anon, authenticated;
revoke all on function public.delete_file_group(text, bigint) from public, anon, authenticated;
revoke all on function public.custom_specs_save_area(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.custom_specs_remove_area(text, text, integer) from public, anon, authenticated;
grant execute on function public.file_group_for_role(text, text, text) to service_role;
grant execute on function public.delete_file_group(text, bigint) to service_role;
grant execute on function public.custom_specs_save_area(text, jsonb, integer) to service_role;
grant execute on function public.custom_specs_remove_area(text, text, integer) to service_role;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'groups_table', to_regclass('public.order_file_groups') is not null,
  'group_id_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'group_id'),
  'group_id_nullable_until_phase_b', (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'group_id'),
  'policies', (select json_agg(policyname order by policyname) from pg_policies where schemaname = 'public' and tablename = 'order_file_groups'),
  'published', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_file_groups'),
  'files', (select count(*) from public.order_attachments),
  'groups', (select count(*) from public.order_file_groups)
) as after_migration;
