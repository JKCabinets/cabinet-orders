-- ═══════════════════════════════════════════════════════════════════════
-- 2026-09-01 · projects: row level security
-- SECURITY FIX — the public anon key had full read and write on this table
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS WRONG
--   `projects` was the only table in the database with relrowsecurity = false.
--   Supabase's default privileges grant ALL to `anon` and `authenticated` on
--   new tables in the public schema, and RLS is what normally makes that
--   harmless. Without it, the grants stood on their own:
--
--     anon → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
--   Verified 2026-09-01 from inside the running container:
--     projects      HTTP 200  [{"id":"SHO-1046"}]     ← a real row
--     orders        HTTP 200  []                      ← RLS on, correct
--     team_members  HTTP 401  permission denied       ← no grant, correct
--
--   The key used was NEXT_PUBLIC_SUPABASE_ANON_KEY, which ships in the client
--   bundle on every page load INCLUDING the login page. It is public by
--   design; RLS and grants are the controls, and this table had neither.
--
--   Exposed: customer_email, customer_phone, ship_to, name, total_price,
--   subtotal_price, total_tax, total_shipping, payment_status. PostgREST
--   honours limit and offset, so the exposure was the whole table, not a row.
--
--   And it was not read-only. PostgREST exposes DELETE, and a filter such as
--   ?id=neq.__none__ matches every row.
--
-- WHY THIS TABLE AND NO OTHER
--   `projects` is also the only table created outside migrations/ -- it was
--   made by hand when the project model landed on 2026-08-25. Every table that
--   went through a migration got RLS. That is one fact, not two, and it is the
--   argument for the schema living in the repo.
--
-- WHAT THIS DOES
--   Makes `projects` identical to `orders`, which is correct and in use:
--   authenticated may read, nobody may write directly, and `anon` matches no
--   policy at all so it gets nothing.
--
--   service_role BYPASSES RLS entirely, so every OMS route is unaffected. The
--   app reads and writes this table exclusively through lib/supabase.ts, which
--   is the service-role client.
--
-- RUN: Supabase SQL editor. Save a copy to ~/cabinet-orders/migrations/.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Before: confirm the gap is still open ─────────────────────────────
--
-- Run this FIRST. Expect projects = false and orders = true.

select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('projects', 'orders')
 order by relname;

-- And the policies that already exist on projects. Expect ZERO rows: if
-- something is already there, stop and read it before running section 2,
-- because the names below would collide.

select policyname, roles, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'projects';


-- ── 2. The fix, in one transaction ───────────────────────────────────────
--
-- ⚠ ATOMIC ON PURPOSE. Enabling RLS before the policies exist would deny
-- `authenticated` for as long as the two statements are apart, and realtime
-- subscriptions run as that role. One transaction means there is no window
-- where the table is closed to the app.

begin;

alter table public.projects enable row level security;

-- Mirrors orders.authenticated_read_all_orders. `authenticated` here means a
-- staff member holding a token minted by /api/realtime-token; there is no
-- customer-facing Supabase login, so this is not a public grant.
create policy "authenticated_read_all_projects"
  on public.projects for select
  to authenticated
  using (true);

-- Mirrors orders.no_direct_insert / no_direct_update / no_direct_delete.
-- Every write goes through the OMS as service_role, which bypasses RLS. These
-- exist so that a direct write is refused rather than merely unused.
create policy "no_direct_insert"
  on public.projects for insert
  to public
  with check (false);

create policy "no_direct_update"
  on public.projects for update
  to public
  using (false);

create policy "no_direct_delete"
  on public.projects for delete
  to public
  using (false);

commit;


-- ── 3. After: confirm ────────────────────────────────────────────────────

select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace and relname = 'projects';
-- expect: projects | true

select policyname, roles, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'projects'
 order by policyname;
-- expect 4 rows, matching the orders policy set

-- ⚠ THE REAL CONFIRMATION IS FROM OUTSIDE, NOT FROM HERE. The SQL editor runs
-- as postgres and bypasses RLS, so it cannot show you what anon sees. Re-run
-- the container probe:
--
--   CID=$(docker ps -q --filter label=service=cabinet-orders)
--   docker exec "$CID" node -e '
--   const url=process.env.SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
--   (async()=>{for(const t of ["projects","orders"]){
--     const r=await fetch(`${url}/rest/v1/${t}?select=id&limit=1`,
--       {headers:{apikey:key,Authorization:`Bearer ${key}`}});
--     console.log(t.padEnd(10),"HTTP",r.status,(await r.text()).slice(0,140));
--   }})();'
--
-- expect: projects HTTP 200 []   ← same as orders. 200 with an empty array is
-- the correct result; RLS filters rows rather than refusing the request.


-- ── Not done here, deliberately ──────────────────────────────────────────
--
-- NO `revoke all on public.projects from anon`. It would also close the hole,
-- and defensibly, but it would make this table the only one configured
-- differently from every other -- and being the odd one out is what caused
-- this. RLS is the pattern here; matching it is worth more than a second
-- mechanism.
--
-- NO CHANGE TO orders.authenticated_read_all_orders. Its qual=true is a known,
-- accepted risk documented on the website side, and narrowing it is a separate
-- decision about what a staff token may see. Not smuggled into a hotfix.
--
-- NO public_api ROLE. The role intended to be the real boundary for public
-- endpoints does not exist; /api/public/lookup currently runs as service_role.
-- That is its own piece of work and is not what this migration is for.
