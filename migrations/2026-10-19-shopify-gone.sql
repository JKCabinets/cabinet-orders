-- 2026-10-19  A purchase Shopify no longer has, kept because warranty claims
-- refer to it: MARKED, and archived (Garrett, 2026-10-19).
--
-- The webhook and the hourly check used to REFUSE to remove such a purchase --
-- rightly: a claim is evidence and outlives the purchase -- and stop there. The
-- check then went red every hour, and the purchase, still "gone", counted
-- toward the one-removal-per-run limit, so it blocked every other removal too
-- (SHO-1059, 2026-10-19). Now the removal marks it -- `shopify_gone_at`, and
-- `shopify_gone_how` deleted or cancelled -- and archives it, as a manual
-- archive does; the hourly check skips a marked purchase. A label says so on
-- the purchase and in the Archive.
--
-- Additive and idempotent. The LAST statement is the check.

begin;
alter table public.projects add column if not exists shopify_gone_at timestamptz;
alter table public.projects add column if not exists shopify_gone_how text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_shopify_gone_how_check') then
    alter table public.projects add constraint projects_shopify_gone_how_check
      check (shopify_gone_how is null or shopify_gone_how in ('deleted', 'cancelled'));
  end if;
end $$;
commit;

select json_build_object(
  'columns', (select json_agg(column_name order by column_name) from information_schema.columns
               where table_schema = 'public' and table_name = 'projects' and column_name in ('shopify_gone_at', 'shopify_gone_how')),
  'check', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'projects_shopify_gone_how_check'),
  'marked_now', (select count(*) from public.projects where shopify_gone_at is not null)
) as after_migration;
-- Expect: both columns; the check naming deleted and cancelled; marked_now 0.
