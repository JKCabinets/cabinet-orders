-- 2026-09-15  Realtime on `order_activity`
--
-- The activity trail only ever arrived by refetch. A row the server wrote --
-- a stage move by a colleague, an admin override, a cron advance -- did not
-- reach an open Activity tab until something triggered a full reload.
--
-- That matters more since 2026-09-15 than it did before: the acknowledgment
-- override, the claim override and the webhook refusals all write their record
-- here, and the point of writing them is that somebody sees them. A trail that
-- updates only on reload is a trail people learn not to trust.
--
-- ⚠ `order_attachments` IS DELIBERATELY NOT ADDED. It is absent from the
-- publication too, but nothing in the client subscribes to it, so adding it
-- here would broadcast to no listener and look like a fix that did nothing.
-- The store has no attachment state to update; the panel fetches its own list
-- per modal. That needs a code change first -- see the handoff's open items.
--
-- Idempotent.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_activity'
  ) then
    alter publication supabase_realtime add table public.order_activity;
  end if;
end
$$;

-- ⚠ INSERT PAYLOADS CARRY THE NEW ROW UNDER THE DEFAULT REPLICA IDENTITY, which
-- is all this needs -- the client appends inserts and ignores updates and
-- deletes, because nothing in the app edits or removes an activity row.
--
-- Verification -- expects order_activity, orders, projects, team_members:
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
