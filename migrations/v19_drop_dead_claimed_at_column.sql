-- v19_drop_dead_claimed_at_column.sql
-- Drops orders.claimed_at: a v14 placeholder for a never-built "stale-claim indicator".
-- Audited 2026-05-28: no code / function / index / view / trigger / policy / constraint
-- references it; 0 of 13 rows populated; pg_depend dependency sweep returned zero dependents.
-- Realtime publication on orders is whole-table and auto-propagates the column drop.
ALTER TABLE public.orders DROP COLUMN IF EXISTS claimed_at;
