-- 2026-10-28  One file group per ROOM, not per style group (Garrett, after 4b:
-- "instead of file groups per style group. Just have one per overall room
-- group. It gets to busy with all the different groups.").
--
-- 1. Every file in a style group's group MOVES into its room's group -- nothing
--    is deleted. A style group no longer in any room (should not exist) keeps
--    its group as an ordinary one, files and all.
-- 2. The emptied style-group groups are deleted.
-- 3. The room functions: saving a room makes and renames only the ROOM's group;
--    removing a style group touches no files (they are the room's); removing a
--    room deletes its group and files, as before.
-- 4. 'set' leaves the allowed roles, so a style-group group cannot come back.
--
-- Idempotent. The last statement is the check.

begin;

-- 1a. A room's group, for any room with style-group files that lacks one.
insert into public.order_file_groups (order_id, name, role, spec_ref)
select distinct g.order_id, left(coalesce(nullif(btrim(a ->> 'name'), ''), 'Room'), 80), 'area', a ->> 'id'
  from public.order_file_groups g
  join public.orders o on o.id = g.order_id
  cross join lateral jsonb_array_elements(coalesce(o.custom_specs -> 'areas', '[]'::jsonb)) a
 where g.role = 'set'
   and exists (select 1 from jsonb_array_elements(coalesce(a -> 'sets', '[]'::jsonb)) s where s ->> 'id' = g.spec_ref)
on conflict (order_id, spec_ref) where spec_ref is not null do nothing;

-- 1b. Each style group's files into its room's group.
update public.order_attachments f
   set group_id = room.id
  from public.order_file_groups sg
  join public.orders o on o.id = sg.order_id
  cross join lateral jsonb_array_elements(coalesce(o.custom_specs -> 'areas', '[]'::jsonb)) a
  join public.order_file_groups room on room.order_id = sg.order_id and room.role = 'area' and room.spec_ref = a ->> 'id'
 where f.group_id = sg.id
   and sg.role = 'set'
   and exists (select 1 from jsonb_array_elements(coalesce(a -> 'sets', '[]'::jsonb)) s where s ->> 'id' = sg.spec_ref);

-- 1c. A style-group group still holding files has no room to go to: kept, as an
--     ordinary group (role and spec_ref cleared together, as the constraint asks).
update public.order_file_groups g
   set role = null, spec_ref = null
 where g.role = 'set'
   and exists (select 1 from public.order_attachments f where f.group_id = g.id);

-- 2. The rest are empty now.
delete from public.order_file_groups where role = 'set';

-- 4. No style-group groups from here on.
alter table public.order_file_groups
  drop constraint if exists order_file_groups_role_check;
alter table public.order_file_groups
  add constraint order_file_groups_role_check
  check (role in ('customer_uploads', 'proof_of_delivery', 'acknowledgments', 'area'));

-- 3. The room functions.
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
  unlinked int := 0;
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
  update public.orders set custom_specs = new_doc where id = p_order_id;
  -- The ROOM's file group, named after it (2026-10-28: one per room, not per
  -- style group -- Garrett). A style group's files are its room's.
  insert into public.order_file_groups (order_id, name, role, spec_ref)
  values (p_order_id, left(coalesce(nullif(btrim(new_area ->> 'name'), ''), 'Room'), 80), 'area', new_area ->> 'id')
  on conflict (order_id, spec_ref) where spec_ref is not null do update set name = excluded.name;
  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', new_area, 'unlinked', unlinked,
                            'removed_files', '[]'::jsonb);
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
  update public.orders set custom_specs = new_doc where id = p_order_id;
  with gone as (
    delete from public.order_attachments
     where group_id in (select id from public.order_file_groups where order_id = p_order_id and spec_ref = p_area_id)
    returning file_path)
  select coalesce(array_agg(file_path), '{}') into paths from gone;
  delete from public.order_file_groups where order_id = p_order_id and spec_ref = p_area_id;
  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', existing, 'unlinked', unlinked,
                            'removed_files', to_jsonb(paths));
end
$$;

revoke all on function public.custom_specs_save_area(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.custom_specs_remove_area(text, text, integer) from public, anon, authenticated;
grant execute on function public.custom_specs_save_area(text, jsonb, integer) to service_role;
grant execute on function public.custom_specs_remove_area(text, text, integer) to service_role;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'style_group_groups_left', (select count(*) from public.order_file_groups where role = 'set'),
  'room_groups', (select count(*) from public.order_file_groups where role = 'area'),
  'group_roles', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_file_groups_role_check'),
  'functions_make_no_style_group_groups', not exists (select 1 from pg_proc where proname in ('custom_specs_save_area', 'custom_specs_remove_area') and prosrc like '%''set''%')
) as after_migration;
