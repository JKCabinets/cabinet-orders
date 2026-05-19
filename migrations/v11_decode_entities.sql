-- ─────────────────────────────────────────────────────────────────────
-- v11 — backfill: decode legacy HTML entities in text columns
--
-- Before the sanitize() refactor, the API encoded every text input on
-- the way in (`'` → `&#x27;`, `"` → `&quot;`, `/` → `&#x2F;`, etc).
-- Render sites then had to call decodeHtmlEntities to display them
-- correctly, which was bug-prone — any new render site that forgot
-- showed raw entity strings like "Garrett&#x27;s" to the user.
--
-- The refactor removed the encode-on-insert step. Going forward, text
-- columns store raw characters and React handles render-time escaping.
-- This migration decodes legacy rows so they match the new convention.
--
-- Safe to run more than once. The decode is idempotent on raw strings
-- (a string with no entities passes through unchanged), so re-running
-- this migration on already-decoded rows does nothing. Same property
-- as the JS decodeHtmlEntities helper.
--
-- IMPORTANT: order matters. `&amp;` must be decoded LAST. Otherwise a
-- legacy value like "AT&amp;T" would decode `&amp;` → `&` first,
-- leaving "AT&T", which is correct — but if we decoded `&lt;` first
-- on a string like "&amp;lt;" (legit literal "&lt;"), we'd get "<"
-- by mistake. Decoding `&amp;` last preserves intentional entity
-- references in user content.
-- ─────────────────────────────────────────────────────────────────────

-- Helper: apply all the decodes in one pass per column. Avoids 11
-- separate UPDATE statements per column.
CREATE OR REPLACE FUNCTION pg_temp.decode_entities(s text)
RETURNS text AS $$
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  RETURN replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(s, '&quot;', '"'),
                    '&#x27;', ''''),
                  '&#39;', ''''),
                '&#x2F;', '/'),
              '&#47;', '/'),
            '&#x60;', '`'),
          '&#96;', '`'),
        '&lt;', '<'),
      '&gt;', '>'),
    '&apos;', ''''),
  '&amp;', '&');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── orders ──────────────────────────────────────────────────────────
-- Every text column that went through cleanInput() (formerly sanitize)
-- when written via the orders API or shopify webhook.
UPDATE orders SET
  name            = pg_temp.decode_entities(name),
  detail          = pg_temp.decode_entities(detail),
  sku             = pg_temp.decode_entities(sku),
  notes           = pg_temp.decode_entities(notes),
  internal_notes  = pg_temp.decode_entities(internal_notes),
  door_style      = pg_temp.decode_entities(door_style),
  color           = pg_temp.decode_entities(color),
  vendor          = pg_temp.decode_entities(vendor),
  ship_to         = pg_temp.decode_entities(ship_to),
  customer_phone  = pg_temp.decode_entities(customer_phone),
  customer_email  = pg_temp.decode_entities(customer_email),
  delivery_method = pg_temp.decode_entities(delivery_method),
  delivery_window = pg_temp.decode_entities(delivery_window),
  delivery_notes  = pg_temp.decode_entities(delivery_notes);

-- ─── team_members ────────────────────────────────────────────────────
UPDATE team_members SET
  name     = pg_temp.decode_entities(name),
  username = pg_temp.decode_entities(username),
  initials = pg_temp.decode_entities(initials);

-- ─── vendors ─────────────────────────────────────────────────────────
UPDATE vendors SET
  name         = pg_temp.decode_entities(name),
  contact_name = pg_temp.decode_entities(contact_name),
  notes        = pg_temp.decode_entities(notes);

-- ─── damage_reports ──────────────────────────────────────────────────
UPDATE damage_reports SET
  damage_type = pg_temp.decode_entities(damage_type),
  description = pg_temp.decode_entities(description),
  cause       = pg_temp.decode_entities(cause),
  resolution  = pg_temp.decode_entities(resolution);

-- ─────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after the migration to spot-check):
--
--   -- Any remaining entity-encoded strings?
--   SELECT id, name FROM orders WHERE name LIKE '%&#x%' OR name LIKE '%&quot;%';
--   -- Should return 0 rows.
--
--   SELECT id, notes FROM orders WHERE notes LIKE '%&#x%' OR notes LIKE '%&quot;%';
--   -- Should return 0 rows.
--
--   SELECT id, name FROM team_members WHERE name LIKE '%&#x%';
--   -- Should return 0 rows.
--
--   -- Spot check a known order — should show readable characters.
--   SELECT id, name, customer_email FROM orders ORDER BY created_at DESC LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────
