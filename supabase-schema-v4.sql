-- ─── v4: Claim system + cleanup ──────────────────────────────────────────────
-- Run this in Supabase SQL Editor

-- Add claimed_by column to track who is currently entering a New order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_by text;

-- Optional index for quick lookups of claimed orders
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON orders(claimed_by) WHERE claimed_by IS NOT NULL;

-- Auto-clear claims when an order leaves the New stage
-- (belt-and-suspenders: the API already clears it, but this catches any edge cases)
CREATE OR REPLACE FUNCTION clear_claim_on_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage <> OLD.stage AND NEW.stage <> 'New' THEN
    NEW.claimed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_claim_on_stage_change ON orders;
CREATE TRIGGER trg_clear_claim_on_stage_change
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION clear_claim_on_stage_change();
