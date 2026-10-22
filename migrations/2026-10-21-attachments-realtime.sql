-- 2026-10-21  order_attachments on Realtime (item 6): a colleague's upload or
-- delete reaches a screen already showing that order's files.
--
-- Two halves, as order_activity needed (2026-09-15 published it, 2026-09-30 made
-- it readable -- and between the two, no browser received a row):
--
--   1. READABLE. Realtime sends a row only to a subscriber whose ROLE MAY SELECT
--      IT, and this table's only policy is no_direct_access (ALL, false, public).
--      `authenticated` is a signed-in NextAuth session's JWT from
--      POST /api/realtime-token (401 otherwise, 30 minutes) -- the role that
--      already reads all of `orders` and the trail. A file row holds a name,
--      size, type, storage path and uploader; signed-in staff see all of that
--      through GET /api/orders/attachments already. The FILE itself stays behind
--      the private bucket and the download route. READ ONLY: permissive policies
--      are OR'd per command, so SELECT becomes `true` and INSERT, UPDATE and
--      DELETE stay `false`. Writes remain service_role's.
--
--   2. PUBLISHED, so changes are sent at all. The client
--      (lib/useRealtimeOrders: useRealtimeAttachments) treats an event as a signal
--      to refetch the lists on screen -- never as the data.
--
-- ⚠ NO `REPLICA IDENTITY FULL`, ON PURPOSE. With row-level security on, Supabase
-- sends a DELETE's old record as the PRIMARY KEY ONLY, whatever the replica
-- identity (Supabase docs, Postgres Changes: "When RLS is enabled and replica
-- identity is set to full on a table, the old record contains only the primary
-- key(s)"). FULL would enlarge the WAL and buy nothing, so the client finds a
-- deleted file's order from the lists on screen, by the file's id.
--
-- Idempotent, and no DROP: a second run finds both and does nothing. The LAST
-- STATEMENT is the check, so one run in the SQL editor shows its own result.

begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'order_attachments'
       and policyname = 'authenticated_read_all_attachments'
  ) then
    create policy authenticated_read_all_attachments
      on public.order_attachments
      for select
      to authenticated
      using (true);
  end if;
end
$$;

comment on policy authenticated_read_all_attachments on public.order_attachments is
  'Signed-in sessions (JWTs from /api/realtime-token) may READ file rows, so Realtime delivers them. '
  'Writes stay refused by no_direct_access. The files themselves stay in the private bucket. Added 2026-10-21.';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'order_attachments'
  ) then
    alter publication supabase_realtime add table public.order_attachments;
  end if;
end
$$;

commit;

select json_build_object(
  'attachment_policies', (select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'qual', qual) order by policyname)
                            from pg_policies where schemaname = 'public' and tablename = 'order_attachments'),
  'published', exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_attachments'),
  'publication_tables', (select json_agg(tablename order by tablename) from pg_publication_tables where pubname = 'supabase_realtime')
) as after_migration;
-- Expect: authenticated_read_all_attachments (SELECT, {authenticated}, true) and
-- no_direct_access (ALL, {public}, false); published: true; publication_tables:
-- order_activity, order_attachments, orders, projects, team_members.
