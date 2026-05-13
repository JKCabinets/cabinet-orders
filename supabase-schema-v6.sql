-- ─── v6: entered_by field ────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

ALTER TABLE orders ADD COLUMN IF NOT EXISTS entered_by text;

-- Backfill existing orders that are past the New stage
-- by pulling the name from their activity log
UPDATE orders o
SET entered_by = (
  SELECT regexp_replace(text, '^.*Moved to "Entered" by\s+', '')
  FROM order_activity
  WHERE order_id = o.id
    AND text LIKE '%Moved to "Entered" by%'
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE stage != 'New'
  AND entered_by IS NULL;
