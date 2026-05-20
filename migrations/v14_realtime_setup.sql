-- ──────────────────────────────────────────────────────────────────
-- v14: Realtime Phase 1 — orders table setup
-- ──────────────────────────────────────────────────────────────────
--
-- This migration:
--   1. Adds claim/lock columns to orders
--   2. Enables Row Level Security (RLS) on orders table
--   3. Creates a SELECT policy for authenticated users
--   4. Adds orders to the supabase_realtime publication
--   5. Sets REPLICA IDENTITY FULL so DELETE events carry the full row
--
-- IMPORTANT: enabling RLS does NOT affect our existing API routes.
-- All API queries use the Supabase service-role key, which bypasses
-- RLS entirely. The RLS policy here only governs what Supabase Realtime
-- WebSocket clients can subscribe to.
--
-- Mutations (INSERT/UPDATE/DELETE) are intentionally NOT given RLS
-- policies — browsers cannot write to the database directly. All writes
-- flow through our /api/orders/* endpoints which run with service-role.

BEGIN;

-- 1. Claim columns
-- claimed_by_user_id: NULL means unclaimed; otherwise references team_members.id
-- claimed_at: when the claim was placed (used for "stale claim" indicators later)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS claimed_by_user_id text NULL REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_orders_claimed_by
  ON orders(claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

-- 2. Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 3. SELECT policy — any authenticated user can read all orders
-- This matches current product behavior: anyone signed in sees everything.
-- If we later want to restrict (e.g., regional teams only see their region),
-- we'd tighten this policy.
DROP POLICY IF EXISTS "authenticated_read_all_orders" ON orders;
CREATE POLICY "authenticated_read_all_orders"
  ON orders FOR SELECT
  TO authenticated
  USING (true);

-- 4. Add orders to the realtime publication
-- This enables Postgres to publish INSERT/UPDATE/DELETE events on this
-- table to subscribers via logical replication.
-- ALTER PUBLICATION is idempotent enough — if already added, it errors;
-- we catch and ignore.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE orders;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- already in the publication, no-op
END $$;

-- 5. REPLICA IDENTITY FULL — include the full row in WAL for DELETEs
-- Without this, DELETE events from Realtime only include the primary key.
-- FULL is slightly heavier on WAL volume but worth it for richer events.
ALTER TABLE orders REPLICA IDENTITY FULL;

COMMIT;

-- Verification queries (run these after applying):
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'orders'
--     AND column_name IN ('claimed_by_user_id', 'claimed_at');
--   -- Should return 2 rows.
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'orders';
--   -- Should return: t  (true, RLS enabled)
--
--   SELECT policyname FROM pg_policies WHERE tablename = 'orders';
--   -- Should return: authenticated_read_all_orders
--
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND tablename = 'orders';
--   -- Should return: orders
