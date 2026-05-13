-- ─── v5: Customer & shipping fields ──────────────────────────────────────────
-- Run this in Supabase SQL Editor after v4

ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor          text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_to         text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone  text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email  text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT '';
