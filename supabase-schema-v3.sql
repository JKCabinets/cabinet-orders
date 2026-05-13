-- ─── Production timeline columns ──────────────────────────────────────────────
-- Run this in Supabase SQL Editor to add production date tracking

ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_start_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_est_finish_date date;
