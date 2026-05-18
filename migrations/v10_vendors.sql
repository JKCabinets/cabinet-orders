-- ──────────────────────────────────────────────────────────────────────
-- Schema v10: vendors table for RMA email lookup
-- ──────────────────────────────────────────────────────────────────────
-- Adds a vendors table indexed by vendor name. The name matches the
-- `vendor` column on shopify_products (and on orders for manual orders).
-- Currently the only operational field is `rma_email`, used by the
-- DamageReportPanel's "Draft email" button to pre-fill mailto recipients
-- when filing an RMA. `contact_name` and `notes` are for human reference.
--
-- Safe to run multiple times: uses IF NOT EXISTS throughout.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  rma_email   TEXT,
  contact_name TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-bump updated_at on any row change so the admin UI can show
-- "Last edited" without us managing the timestamp manually.
CREATE OR REPLACE FUNCTION vendors_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendors_updated_at_trigger ON vendors;
CREATE TRIGGER vendors_updated_at_trigger
  BEFORE UPDATE ON vendors
  FOR EACH ROW
  EXECUTE FUNCTION vendors_set_updated_at();

-- Pre-populate from distinct vendor names already in shopify_products.
-- ON CONFLICT DO NOTHING so re-running this migration doesn't error
-- on existing rows. RMA email is left NULL — the admin fills those in
-- via the /admin/vendors UI.
--
-- Wrapped in a DO block so an environment where shopify_products
-- hasn't been created yet (e.g. fresh dev DB) skips the seed instead
-- of erroring out. The vendors table itself is still created above.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shopify_products'
  ) THEN
    INSERT INTO vendors (name)
      SELECT DISTINCT vendor
        FROM shopify_products
        WHERE vendor IS NOT NULL
          AND TRIM(vendor) <> ''
      ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;
