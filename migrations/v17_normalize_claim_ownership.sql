-- v17_normalize_claim_ownership.sql
--
-- Background: claimed_by and entered_by are TEXT columns that have been
-- populated inconsistently over time — sometimes with session.user.name
-- (the display name "Garrett Battles") and sometimes with
-- session.user.username (the immutable login like "battles45"). When a
-- user changes their display name or username, claims stored under the
-- old string become orphaned: the release_order() function can\'t match
-- the current session against the stored value.
--
-- Fix: standardize on username. This migration walks every non-null
-- claimed_by / entered_by value, tries to resolve it to a team_members
-- row (matching by name first, then username), and rewrites it to the
-- canonical username. Unresolved strings are left alone so we don\'t
-- silently destroy data; the orphan can be investigated manually.

-- Show what we\'re about to do (no-op for the SELECT itself; useful in
-- the Supabase SQL editor preview if you run this block by block).
DO $$
DECLARE
  row_count int;
BEGIN
  SELECT COUNT(*) INTO row_count
    FROM orders
   WHERE claimed_by IS NOT NULL
      OR entered_by IS NOT NULL;
  RAISE NOTICE 'Rows with any ownership string: %', row_count;
END $$;

-- Normalize claimed_by: try matching by name, then by username.
-- Update only when the lookup succeeds AND the current value isn\'t
-- already the canonical username.
UPDATE orders o
   SET claimed_by = tm.username
  FROM team_members tm
 WHERE o.claimed_by IS NOT NULL
   AND o.claimed_by <> tm.username
   AND (
        o.claimed_by = tm.name
     OR LOWER(o.claimed_by) = LOWER(tm.username)
   );

-- Same for entered_by. We could leave entered_by alone for now since
-- it\'s not used for permission checks (it\'s purely a display field),
-- but normalizing while we\'re here keeps the schema clean and means
-- the UI can confidently lookup-by-username everywhere.
UPDATE orders o
   SET entered_by = tm.username
  FROM team_members tm
 WHERE o.entered_by IS NOT NULL
   AND o.entered_by <> tm.username
   AND (
        o.entered_by = tm.name
     OR LOWER(o.entered_by) = LOWER(tm.username)
   );

-- Audit: show any values that DIDN\'T resolve to a team member. If
-- this query returns rows after running, those orders have an
-- ownership string that no longer matches any active or inactive
-- team_members row — probably a deleted user. Decide manually
-- whether to null them out or back-create the team member.
DO $$
DECLARE
  v_claim_orphans int;
  v_entered_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_claim_orphans
    FROM orders o
   WHERE o.claimed_by IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM team_members tm WHERE tm.username = o.claimed_by
     );
  SELECT COUNT(*) INTO v_entered_orphans
    FROM orders o
   WHERE o.entered_by IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM team_members tm WHERE tm.username = o.entered_by
     );
  RAISE NOTICE 'Unresolved claimed_by values: %', v_claim_orphans;
  RAISE NOTICE 'Unresolved entered_by values: %', v_entered_orphans;
END $$;
