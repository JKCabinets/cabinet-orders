-- 2026-09-30  order_activity becomes readable by signed-in sessions, so Realtime
-- actually delivers the activity trail.
--
-- ⚠ PUBLISHED IS NOT DELIVERED. 2026-09-15-realtime-activity.sql added the table
-- to supabase_realtime and verified exactly that. But Realtime sends a row only to
-- a subscriber whose ROLE MAY SELECT IT, and order_activity's only policy is
-- `no_direct_access` -- ALL, `false`, for public. So from 2026-09-15 to today no
-- browser received any trail row. Only stage moves and archiving add their row
-- locally, so their actor saw it; every other trail row -- notes, dates, claims,
-- overrides, a colleague's anything -- appeared only on a refresh, which came to
-- read as normal. A room save's missing row (2026-09-30) is what got questioned.
--
-- WHO `authenticated` IS. The browser subscribes with a JWT minted by
-- POST /api/realtime-token: signed-in NextAuth session only (401 otherwise),
-- `role: "authenticated"`, 30 minutes. The same role already reads all of
-- `orders` through authenticated_read_all_orders, customer phone and address
-- included; the trail is about those orders. anon gains nothing.
--
-- READ ONLY. no_direct_access stays: permissive policies are OR'd per command, so
-- SELECT becomes `true` and INSERT, UPDATE and DELETE stay `false`. Writes remain
-- service_role's. Proven 2026-09-30 against production's exact policy and grants.
--
-- Idempotent, and no DROP: a second run finds the policy and does nothing. The
-- LAST STATEMENT is the check, so one run in the SQL editor shows its own result
-- -- "Success. No rows returned" would mean it did not run to the end.

begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'order_activity'
       and policyname = 'authenticated_read_all_activity'
  ) then
    create policy authenticated_read_all_activity
      on public.order_activity
      for select
      to authenticated
      using (true);
  end if;
end
$$;

comment on policy authenticated_read_all_activity on public.order_activity is
  'Signed-in sessions (JWTs from /api/realtime-token) may READ the trail, so Realtime delivers it. '
  'Writes stay refused by no_direct_access. Added 2026-09-30.';

commit;

select json_build_object(
  'activity_policies', (select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'qual', qual) order by policyname)
                          from pg_policies where schemaname = 'public' and tablename = 'order_activity'),
  'published', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_activity')
) as after_migration;
-- Expect: authenticated_read_all_activity (SELECT, {authenticated}, true) and
-- no_direct_access (ALL, {public}, false); published: true.
