-- 2026-09-14  Realtime on `projects`
--
-- ⚠ THE CLAIM ON A SHOPIFY PURCHASE LIVES ON `projects`, NOT ON `orders`.
-- Since the claim moved up to the project on 2026-08-25, `orders.claimed_by` is
-- null on every project-linked row. The realtime publication carried `orders`
-- and `team_members` but NOT `projects`, so a claim taken by one person reached
-- nobody else's screen until they happened to refresh.
--
-- The subscription in lib/store.tsx (`useRealtimeProjects`) has been correct the
-- whole time and had nothing to receive. RLS was not the problem either:
-- `authenticated_read_all_projects` already grants the SELECT that realtime
-- delivers under. The table simply was not in the publication.
--
-- That is worse than a cosmetic lag. Claims exist to stop two people working the
-- same order, and a claim nobody else can see does not do that -- the second
-- person opens a row that looks free and starts a duplicate of the work.
--
-- ⚠ NOT INCLUDED, DELIBERATELY: `order_activity` and `order_attachments`. They
-- are also absent from the publication, but nothing subscribes to them in the
-- client, so adding them here would broadcast to no listener and look like a fix
-- that did nothing. They need the hook first; see lib/useRealtimeOrders.ts.
--
-- Idempotent: safe to run against a database where somebody has already added
-- the table by hand (which is how production got it on 2026-09-14).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end
$$;

-- Verification -- expects orders, projects, team_members:
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
