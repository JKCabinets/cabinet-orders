-- 2026-09-30  Custom job specs: saved ONE ROOM at a time, atomically, with a
-- revision per room. Handoff item 24, step 1 of the Files work.
--
-- ⚠ RUN BEFORE DEPLOYING the commit that calls these functions.
--
-- WHY. custom_specs is one jsonb document and the panel wrote it whole. Proven
-- on 2026-09-30 against the real CustomSpecsPanel: "Save room" sent every room,
-- a refused save reverted every room, removing a room could not be saved on
-- its own, and nothing detected a stale write. And nothing unlinked a deleted
-- room's files -- the behaviour three documents describe was never built. Room
-- files cannot be allowed to point into a document with those properties.
--
-- WHAT THIS DOES
--   1. custom_specs_problem(doc)   what is wrong with a document, or NULL
--   2. Converts every v1 document to v2 -- or refuses, naming each row, and
--      writes NOTHING. A document it cannot read is never emptied: emptying is
--      what PATCH /api/orders/[id] does today and exactly what this replaces.
--   3. Two CHECKs: a stored document is a valid v2, and only a custom job has
--      one. Every writer -- the routes, a script, the SQL editor -- is held to it.
--   4. custom_specs_save_area / custom_specs_remove_area: lock the row, check
--      the room's revision, merge, and clear spec_ref on every file that pointed
--      at something removed -- in ONE transaction, so "room removed" and "its
--      files unlinked" cannot disagree. PostgREST has no multi-statement
--      transactions; a function is the only way to get one.
--   5. EXECUTE on the two functions: service_role only. Supabase grants new
--      public functions to anon and authenticated by default, which would put
--      them on /rest/v1/rpc behind the key every browser holds. The validator
--      the CHECK calls is service_role-only too -- section 5 says why that is
--      enough, and what would make it wrong.
--
-- THE v2 SHAPE -- v1 plus a revision on every area:
--   { "v": 2, "areas": [ { "id": "a_1a2b3c4d", "name": "Kitchen", "rev": 3,
--       "sets": [ { "id": "s_5e6f7a8b", "name": "Island", "manufacturer": "",
--                   "door_style": "", "color": "", "notes": "" } ] } ] }
--
--   ⚠ THE REVISION IS PER ROOM, not per document and not orders.updated_at.
--   updated_at moves on every edit to the row (a note, a stage, a tracking
--   number), and a document-wide counter makes saving Kitchen conflict with a
--   colleague's save of Bath. A room's counter answers exactly "has THIS room
--   changed since you loaded it". Sets live inside a room, so it covers them.
--
--   ⚠ v IS 2 BECAUSE THE SHAPE CHANGED. A reader must not infer the shape from
--   which keys are present. A tab still running the v1 reader shows a v2 job as
--   having no specs until it reloads -- accepted by Garrett 2026-09-30: custom
--   jobs are one designer each -- and a save from it is refused, by the route
--   and by the CHECK below.
--
-- ⚠ DEPLOY WINDOW. Between this migration and the deploy, the OLD PATCH route
-- writes v1 documents; the CHECK refuses them, so such a save fails (500)
-- rather than writing. It fails closed, and it lasts minutes.
--
-- Idempotent: a second run converts nothing (v2 rows are only validated),
-- recreates the constraints and functions identically, and re-applies grants.

begin;

-- ── 1. The validator ─────────────────────────────────────────────────────
--
-- IMMUTABLE and total: it never raises, whatever it is given, because a CHECK
-- that throws reports the wrong thing. Strict where readCustomSpecs is lenient:
-- that reader renders whatever it can; this decides what may be STORED.
--
-- ⚠ ITS COST IS BOUNDED. It runs on every write of a custom job's row. The
-- first version checked each id against every id before it: 2,000 rooms took
-- 228 ms, 8,000 took 3.2 s. So the counts are capped BEFORE anything iterates,
-- and duplicates are found in one grouped pass at the end. 100 rooms of 50 style groups is far past any real
-- kitchen; a job that needs more is a conversation, not a silent limit.
create or replace function public.custom_specs_problem(doc jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  area jsonb;
  s jsonb;
  k text;
  seen text[] := '{}';
  dup text;
  ai int := 0;
  si int;
begin
  if doc is null then return null; end if;
  if jsonb_typeof(doc) <> 'object' then return 'the document is not an object'; end if;
  for k in select jsonb_object_keys(doc) loop
    if k not in ('v', 'areas') then return format('unknown key "%s"', k); end if;
  end loop;
  if (doc -> 'v') is distinct from '2'::jsonb then
    -- As JSON, so the text "2" does not read as the number 2.
    return format('v is %s, expected 2', coalesce((doc -> 'v')::text, 'missing'));
  end if;
  if jsonb_typeof(doc -> 'areas') is distinct from 'array' then return 'areas is not an array'; end if;
  if jsonb_array_length(doc -> 'areas') > 100 then return 'more than 100 rooms'; end if;

  for area in select value from jsonb_array_elements(doc -> 'areas') loop
    ai := ai + 1;
    if jsonb_typeof(area) <> 'object' then return format('area %s is not an object', ai); end if;
    for k in select jsonb_object_keys(area) loop
      if k not in ('id', 'name', 'rev', 'sets') then return format('area %s: unknown key "%s"', ai, k); end if;
    end loop;
    if jsonb_typeof(area -> 'id') is distinct from 'string' or (area ->> 'id') !~ '^a_[0-9a-f]{8}$' then
      return format('area %s: id must look like a_1a2b3c4d', ai);
    end if;
    seen := seen || (area ->> 'id');
    if jsonb_typeof(area -> 'name') is distinct from 'string' then return format('area %s: name is not text', ai); end if;
    if char_length(area ->> 'name') > 200 then return format('area %s: name is longer than 200', ai); end if;
    if jsonb_typeof(area -> 'rev') is distinct from 'number'
       or (area ->> 'rev')::numeric <> trunc((area ->> 'rev')::numeric)
       or (area ->> 'rev')::numeric < 1
       or (area ->> 'rev')::numeric > 2147483647 then
      return format('area %s: rev must be a whole number from 1', ai);
    end if;
    if jsonb_typeof(area -> 'sets') is distinct from 'array' then return format('area %s: sets is not an array', ai); end if;
    if jsonb_array_length(area -> 'sets') > 50 then return format('area %s: more than 50 style groups', ai); end if;

    si := 0;
    for s in select value from jsonb_array_elements(area -> 'sets') loop
      si := si + 1;
      if jsonb_typeof(s) <> 'object' then return format('area %s, set %s is not an object', ai, si); end if;
      for k in select jsonb_object_keys(s) loop
        if k not in ('id', 'name', 'manufacturer', 'door_style', 'color', 'notes') then
          return format('area %s, set %s: unknown key "%s"', ai, si, k);
        end if;
        if jsonb_typeof(s -> k) <> 'string' then return format('area %s, set %s: %s is not text', ai, si, k); end if;
        if char_length(s ->> k) > (case when k = 'notes' then 4000 else 200 end) then
          return format('area %s, set %s: %s is too long', ai, si, k);
        end if;
      end loop;
      if (s ->> 'id') is null or (s ->> 'id') !~ '^s_[0-9a-f]{8}$' then
        return format('area %s, set %s: id must look like s_1a2b3c4d', ai, si);
      end if;
      if (s ->> 'name') is null then return format('area %s, set %s: name is missing', ai, si); end if;
      seen := seen || (s ->> 'id');
    end loop;
  end loop;

  -- Every room and set id, once: attachments point at them by id, and the
  -- room functions find a room by id. One grouped pass, not a scan per id.
  select x into dup from unnest(seen) as x group by x having count(*) > 1 order by x limit 1;
  if dup is not null then return format('duplicate id %s', dup); end if;
  return null;
end
$$;

comment on function public.custom_specs_problem(jsonb) is
  'What is wrong with a custom_specs document, or NULL if it is a valid v2. '
  'Backs orders_custom_specs_valid. Never raises.';


-- ── 2. v1 -> v2, or refuse ───────────────────────────────────────────────
--
-- ONE DO BLOCK, NO HELPER. The conversion was a pg_temp function; whether the
-- Supabase SQL editor lets `postgres` create one was unverified, and "find out
-- on the night" is the wrong test. A DO block is what the 2026-08-18 migration
-- already ran there. The v1 -> v2 expression is written ONCE, below: each row's
-- candidate is computed a single time, checked, and -- only if EVERY row
-- passed -- written from that same value.
--
-- Everything in a document is carried over untouched: only v changes and each
-- area gains "rev": 1. Anything unexpected (an extra key, a missing field) is
-- NOT tidied; the validator refuses the row and the migration names it.
--
-- ⚠ ARCHIVED JOBS ARE CONVERTED TOO (confirmed with Garrett 2026-09-30). The
-- archive is read-only to HUMAN edits; a schema migration is not one, and a
-- row left on v1 would sit permanently in violation of the CHECK below.
--
-- FOR UPDATE: nothing can change a row between its check and its write.
do $$
declare
  rec record;
  candidate jsonb;
  problem text;
  bad text := '';
  converted jsonb := '{}';
begin
  for rec in
    select id, type, custom_specs from public.orders
     where custom_specs is not null
     order by id
       for update
  loop
    candidate := case
      when jsonb_typeof(rec.custom_specs) = 'object'
       and (rec.custom_specs -> 'v') = '1'::jsonb
       and jsonb_typeof(rec.custom_specs -> 'areas') = 'array'
      then rec.custom_specs || jsonb_build_object(
        'v', 2,
        'areas', coalesce((
          select jsonb_agg(case when jsonb_typeof(a) = 'object' then a || '{"rev": 1}'::jsonb else a end order by ord)
            from jsonb_array_elements(rec.custom_specs -> 'areas') with ordinality as t(a, ord)
        ), '[]'::jsonb))
      else rec.custom_specs   -- already v2 (a second run), or unreadable: the check decides
    end;

    problem := case
      when rec.type <> 'custom' then 'specifications on a row that is not a custom job'
      else public.custom_specs_problem(candidate)
    end;

    if problem is not null then
      bad := bad || format(E'\n  %s (%s): %s', rec.id, rec.type, problem);
    elsif candidate is distinct from rec.custom_specs then
      converted := converted || jsonb_build_object(rec.id, candidate);
    end if;
  end loop;

  if bad <> '' then
    raise exception 'custom_specs NOT converted -- nothing was written. These rows need a decision first:%', bad;
  end if;

  update public.orders o
     set custom_specs = converted -> o.id
   where converted ? o.id;
end
$$;


-- ── 3. The database holds every writer to it ─────────────────────────────
alter table public.orders drop constraint if exists orders_custom_specs_valid;
alter table public.orders
  add constraint orders_custom_specs_valid
  check (custom_specs is null or public.custom_specs_problem(custom_specs) is null);

alter table public.orders drop constraint if exists orders_custom_specs_custom_only;
alter table public.orders
  add constraint orders_custom_specs_custom_only
  check (custom_specs is null or type = 'custom');


-- ── 4. One room at a time ────────────────────────────────────────────────
--
-- Both answer with a result object rather than raising, so the route can map
-- each outcome to its own status and message instead of parsing error text:
--   ok          specs (the stored document), area, unlinked (files cleared)
--   conflict    the room changed or went since it was loaded; carries
--               current (the stored room, or null) and specs
--   invalid     problem -- what custom_specs_problem said; nothing written
--   not_found | not_custom | archived
--
-- The row lock (FOR UPDATE) is what makes a revision check mean anything: a
-- second save of the same room waits for the first to commit, then sees the
-- revision it produced.

create or replace function public.custom_specs_save_area(
  p_order_id text,
  p_area jsonb,
  p_base_rev integer   -- NULL: this is a new room
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
begin
  select type, archived, custom_specs into r from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.type <> 'custom' then return jsonb_build_object('result', 'not_custom'); end if;
  if r.archived then return jsonb_build_object('result', 'archived'); end if;
  doc := coalesce(r.custom_specs, '{"v": 2, "areas": []}'::jsonb);

  if jsonb_typeof(p_area) is distinct from 'object' then
    return jsonb_build_object('result', 'invalid', 'problem', 'the room is not an object');
  end if;
  -- The revision is the server's to set; whatever the client sent is ignored.
  incoming := p_area - 'rev';

  select a, ord into existing, pos
    from jsonb_array_elements(doc -> 'areas') with ordinality as t(a, ord)
   where a ->> 'id' = incoming ->> 'id';

  if existing is null then
    if p_base_rev is not null then
      -- They were editing a room that has since been removed.
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

  -- Sets this save dropped: their files fall back to the job.
  if existing is not null then
    removed := array(
      select s ->> 'id' from jsonb_array_elements(existing -> 'sets') s
      except
      select s ->> 'id' from jsonb_array_elements(new_area -> 'sets') s
    );
  end if;

  update public.orders set custom_specs = new_doc where id = p_order_id;
  if cardinality(removed) > 0 then
    update public.order_attachments set spec_ref = null
     where order_id = p_order_id and spec_ref = any (removed);
    get diagnostics unlinked = row_count;
  end if;

  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', new_area, 'unlinked', unlinked);
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
begin
  select type, archived, custom_specs into r from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.type <> 'custom' then return jsonb_build_object('result', 'not_custom'); end if;
  if r.archived then return jsonb_build_object('result', 'archived'); end if;
  doc := coalesce(r.custom_specs, '{"v": 2, "areas": []}'::jsonb);

  select a into existing from jsonb_array_elements(doc -> 'areas') a where a ->> 'id' = p_area_id;
  if existing is null or p_base_rev is null or (existing ->> 'rev')::int <> p_base_rev then
    -- Gone already, or changed since they looked: either way it is not the
    -- room they chose to remove.
    return jsonb_build_object('result', 'conflict', 'current', existing, 'specs', doc);
  end if;

  new_doc := jsonb_set(doc, '{areas}', coalesce((
    select jsonb_agg(a order by ord)
      from jsonb_array_elements(doc -> 'areas') with ordinality as t(a, ord)
     where a ->> 'id' <> p_area_id
  ), '[]'::jsonb));

  -- The room and every set in it: their files fall back to the job.
  removed := array(select s ->> 'id' from jsonb_array_elements(existing -> 'sets') s) || p_area_id;

  update public.orders set custom_specs = new_doc where id = p_order_id;
  update public.order_attachments set spec_ref = null
   where order_id = p_order_id and spec_ref = any (removed);
  get diagnostics unlinked = row_count;

  return jsonb_build_object('result', 'ok', 'specs', new_doc, 'area', existing, 'unlinked', unlinked);
end
$$;

comment on function public.custom_specs_save_area(text, jsonb, integer) is
  'Save one room of a custom job''s specs, checked against the revision the caller loaded. '
  'Clears spec_ref on files of sets the save removed. service_role only.';
comment on function public.custom_specs_remove_area(text, text, integer) is
  'Remove one room of a custom job''s specs, checked against the revision the caller loaded. '
  'Clears spec_ref on files of the room and its sets. service_role only.';


-- ── 5. Who may call them ─────────────────────────────────────────────────
--
-- ⚠ THE VALIDATOR IS NOT AN ENDPOINT, AND WHO NEEDS IT IS DECIDED BY RLS.
--
-- A CHECK's function must be executable by EVERY ROLE THAT WRITES THE TABLE:
-- proven 2026-09-30, a role without EXECUTE on it cannot write ANY row --
-- Postgres checks the permission before `custom_specs is null` short-circuits.
--
-- In production only two roles can write `orders`, and that is decided by its
-- row policies, read 2026-09-30: no_direct_insert / no_direct_update /
-- no_direct_delete are `false` for public, so anon and authenticated write
-- nothing whatever their table grants say. postgres writes as the table's
-- owner and service_role bypasses RLS. So: service_role, and the owner, who
-- needs no grant. anon and authenticated are revoked, which keeps it off
-- /rest/v1/rpc for the key every browser holds.
--
-- ⚠ IF A POLICY EVER LETS ANOTHER ROLE WRITE `orders`, that role needs EXECUTE
-- here too, or its writes fail -- loudly: "permission denied for function
-- custom_specs_problem". Grant it with the policy; do not widen this to PUBLIC.
revoke all on function public.custom_specs_problem(jsonb) from public, anon, authenticated;
grant execute on function public.custom_specs_problem(jsonb) to service_role;

revoke all on function public.custom_specs_save_area(text, jsonb, integer)   from public, anon, authenticated;
revoke all on function public.custom_specs_remove_area(text, text, integer)  from public, anon, authenticated;
grant execute on function public.custom_specs_save_area(text, jsonb, integer)  to service_role;
grant execute on function public.custom_specs_remove_area(text, text, integer) to service_role;

commit;

-- Verify, as separate statements afterwards, and READ the rows:
--
-- select id, custom_specs -> 'v' as v, jsonb_array_length(custom_specs -> 'areas') as rooms
-- from orders where custom_specs is not null order by id;
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.orders'::regclass and conname like 'orders_custom_specs_%';
--
-- select routine_name, grantee, privilege_type from information_schema.routine_privileges
-- where routine_schema = 'public' and routine_name like 'custom_specs_%' order by 1, 2;
