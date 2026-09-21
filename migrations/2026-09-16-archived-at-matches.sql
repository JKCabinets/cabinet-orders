-- 2026-09-16  archived_at agrees with archived, on orders and on projects.
--
-- ⚠ SAFE TO RUN BEFORE OR AFTER ANY DEPLOY. No code changes with it: every
-- writer that remains already sets the two together (the projects route for a
-- purchase, PATCH /api/orders/[id] and /api/orders/bulk for a standalone row;
-- every insert writes archived = false and no date). The one writer that did
-- not -- /api/shopify/orders, which archived a cancelled import without a date
-- -- was deleted the same day (handoff item 15).
--
-- WHAT IT ENFORCES: a row is archived exactly when it carries a date.
--   archived = false  ->  archived_at IS NULL
--   archived = true   ->  archived_at IS NOT NULL
-- Two columns stating one fact, tied together the way
-- orders_total_price_standalone_only and the two constraints from earlier
-- today tie theirs. The Archive section sorts on archived_at and says "—" for a
-- missing one; with this, a missing one can only mean "not archived".
--
-- Checked before writing, 2026-09-16 at d534e20: no row on either table was
-- archived without a date or dated without being archived.
--
-- Idempotent: each constraint is added only if absent.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_archived_at_matches'
  ) then
    alter table public.orders add constraint orders_archived_at_matches
      check ((archived = false and archived_at is null)
          or (archived = true  and archived_at is not null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass and conname = 'projects_archived_at_matches'
  ) then
    alter table public.projects add constraint projects_archived_at_matches
      check ((archived = false and archived_at is null)
          or (archived = true  and archived_at is not null));
  end if;
end $$;

commit;

-- Verify, as a separate statement afterwards:
--
-- select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conname in ('orders_archived_at_matches', 'projects_archived_at_matches');
