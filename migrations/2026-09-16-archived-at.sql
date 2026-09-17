-- 2026-09-16  archived_at: WHEN something was archived.
--
-- ⚠ RUN THIS BEFORE DEPLOYING THE COMMIT THAT ADDS IT -- the opposite of the
-- payment/archive migration earlier today. The code that follows writes
-- archived_at whenever it archives or restores; against a table without the
-- column, PostgREST rejects the whole write and archiving stops working. A
-- column nothing writes yet is harmless, so this goes first.
--
-- WHY IT EXISTS. `archived` is a boolean on both tables and nothing records
-- when it was set. The Archive section lists what has been archived, newest
-- first, which is not answerable today without reading the activity trail for
-- every row.
--
-- WHAT IT MEANS. Set when a row or a purchase is archived, cleared when it is
-- restored: archived_at is non-null exactly while archived is true. Re-archiving
-- overwrites it, so it is "when this was last archived" -- the activity trail
-- keeps every earlier one. Not enforced by a CHECK yet: /api/shopify/orders
-- (handoff item 15) still inserts `archived: cancelled` without a date, and a
-- constraint would turn that legacy path into a failed insert.
--
-- Nothing is archived anywhere as of 2026-09-16, so there is nothing to
-- backfill; a row archived before this column existed would show no date.
--
-- Idempotent: both columns are added only if absent.

begin;

alter table public.orders   add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists archived_at timestamptz;

commit;

-- Verify, as a separate statement afterwards:
--
-- select table_name, column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and column_name = 'archived_at'
-- order by table_name;
