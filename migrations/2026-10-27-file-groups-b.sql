-- 2026-10-27  File groups, PHASE B (item 8 step 5) -- run AFTER the deploy.
--
-- Phase A added order_attachments.group_id NULLABLE so the code still live
-- during the deploy kept working; the deployed code always files into a group.
-- This makes a group REQUIRED -- the database's own "a group exists before
-- files are attached" (Garrett, 2026-10-26) -- and retires spec_ref, the room
-- link a group now carries.
--
-- ⚠ IT REFUSES, NAMING EACH ONE, if any file still has no group (only a file the
-- old code uploaded in the deploy window could). File it -- the Files tab shows
-- it under "Not in a group" -- and run this again. Nothing is changed by a
-- refusal: it is one transaction.
--
-- The room functions are redefined first, in the same transaction, without the
-- spec_ref unlink they kept for that window -- they would fail once the column
-- is gone. Their answer keeps `unlinked`, now always 0, so the route reads it
-- unchanged. The last statement is the check.

begin;

do $$
declare
  n int;
  which text;
begin
  select count(*), string_agg(order_id || ' / ' || file_name, ', ' order by order_id)
    into n, which
    from public.order_attachments where group_id is null;
  if n > 0 then
    raise exception 'Phase B stopped: % file(s) are in no group yet: %. File each one (the Files tab shows them under "Not in a group"), then run this again.', n, which;
  end if;
end
$$;

alter table public.order_attachments alter column group_id set not null;

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
  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', existing, 'unlinked', unlinked,
                            'removed_files', to_jsonb(paths));
end
$$;

revoke all on function public.custom_specs_save_area(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.custom_specs_remove_area(text, text, integer) from public, anon, authenticated;
grant execute on function public.custom_specs_save_area(text, jsonb, integer) to service_role;
grant execute on function public.custom_specs_remove_area(text, text, integer) to service_role;

alter table public.order_attachments drop column if exists spec_ref;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'group_id_required', (select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'group_id'),
  'spec_ref_gone', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'spec_ref'),
  'functions_free_of_spec_ref', not exists (select 1 from pg_proc where proname in ('custom_specs_save_area', 'custom_specs_remove_area') and prosrc like '%spec_ref = null%'),
  'files', (select count(*) from public.order_attachments),
  'groups', (select count(*) from public.order_file_groups)
) as after_phase_b;
