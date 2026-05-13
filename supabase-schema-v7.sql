-- Migration: add internal_notes column to orders table
-- Run this in Supabase SQL Editor before deploying the #15 changes.
--
-- Background: `notes` becomes the customer-facing notes field (synced to
-- Shopify, shown on the customer-facing parts of the export). `internal_notes`
-- is the new staff-only field — never synced to Shopify, shown in a clearly
-- marked red section of the export PDF.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '';

-- Audit-log this migration so it shows up in the timeline if anyone wonders
-- where the column came from.
INSERT INTO audit_log (event, username, details)
VALUES (
  'schema_migration',
  'system',
  '{"migration": "v7-split-notes", "added": "orders.internal_notes"}'::jsonb
);
