-- ─────────────────────────────────────────────────────────────────────
-- Schema v9 — stage_entered_at
--
-- Adds a timestamp that records when the order last entered its current
-- stage. This lets the SLA page show real per-stage age instead of
-- "days since the order was created" (which is misleading for orders
-- in later stages).
--
-- Safe to run more than once. Idempotent.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Add the column. Default to NOW() so any newly inserted row gets a
--    timestamp automatically; backfill existing rows below.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Backfill existing rows that are still NULL. We use `created_at`
--    as a best-guess starting point because that's the closest signal
--    we have for when the order existed. Accuracy will be perfect from
--    this point forward; historical data is approximate.
UPDATE orders
  SET stage_entered_at = created_at
  WHERE stage_entered_at IS NULL
    AND created_at IS NOT NULL;

-- 3. As a final safety net for rows where created_at is also NULL, use
--    NOW() so days-in-stage doesn't go negative.
UPDATE orders
  SET stage_entered_at = NOW()
  WHERE stage_entered_at IS NULL;

-- 4. Make the column NOT NULL going forward so we never have to handle
--    missing values in queries.
ALTER TABLE orders
  ALTER COLUMN stage_entered_at SET NOT NULL;

-- 5. Trigger: when `stage` changes, automatically bump
--    `stage_entered_at` to NOW(). This means the API code doesn't have
--    to remember to set it — the DB does it for free, even if a stage
--    change happens via SQL console, a future cron, or anywhere else.
--    Defense in depth: app code SHOULD still set it, but if anything
--    misses the trigger catches it.

CREATE OR REPLACE FUNCTION orders_bump_stage_entered_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_bump_stage_entered_at ON orders;

CREATE TRIGGER trg_orders_bump_stage_entered_at
  BEFORE UPDATE OF stage ON orders
  FOR EACH ROW
  EXECUTE FUNCTION orders_bump_stage_entered_at();

-- ─────────────────────────────────────────────────────────────────────
-- Verification queries (run these manually after the migration to spot
-- check the result):
--
--   SELECT id, stage, stage_entered_at, created_at FROM orders
--     ORDER BY created_at DESC LIMIT 10;
--
--   -- Should match `created_at` for old rows, NOW() for new rows.
--
--   SELECT COUNT(*) FROM orders WHERE stage_entered_at IS NULL;
--   -- Should be 0.
--
-- ─────────────────────────────────────────────────────────────────────
