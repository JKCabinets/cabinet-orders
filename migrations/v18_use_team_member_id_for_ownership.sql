-- v18_use_team_member_id_for_ownership.sql
--
-- Builds on v17 (which normalized claimed_by / entered_by to usernames).
-- This migration goes one step further: rewrite all ownership string
-- values to the canonical, IMMUTABLE team_members.id surrogate key
-- (values like \'member-1778009392037\' or the legacy \'1\').
--
-- Why: usernames can in theory be changed by admins. The id is opaque,
-- never user-facing, and never changes for the lifetime of a team
-- member row. Storing ownership against id means every form of
-- profile edit (rename, username change, role swap) is safe.
--
-- After this runs, claimed_by and entered_by contain team_members.id
-- values. The corresponding code paths in the Next.js app will:
--   * write session.user.id to claimed_by / entered_by on claim/enter
--   * compare claimed_by === session.user.id for permission checks
--   * look up team.find(m => m.id === ownerKey) for display

DO $$
DECLARE
  v_rows int;
BEGIN
  SELECT COUNT(*) INTO v_rows
    FROM orders WHERE claimed_by IS NOT NULL OR entered_by IS NOT NULL;
  RAISE NOTICE 'Rows with any ownership string: %', v_rows;
END $$;

-- claimed_by: username -> id
UPDATE orders o
   SET claimed_by = tm.id
  FROM team_members tm
 WHERE o.claimed_by IS NOT NULL
   AND o.claimed_by = tm.username
   AND o.claimed_by <> tm.id;

-- entered_by: username -> id
UPDATE orders o
   SET entered_by = tm.id
  FROM team_members tm
 WHERE o.entered_by IS NOT NULL
   AND o.entered_by = tm.username
   AND o.entered_by <> tm.id;

-- Audit: anything still unresolvable (= a username that has no
-- matching team_members row, e.g. deleted member) is left alone.
-- Operator can decide whether to null it out or back-create.
DO $$
DECLARE
  v_claim_orphans int;
  v_entered_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_claim_orphans
    FROM orders o
   WHERE o.claimed_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = o.claimed_by);
  SELECT COUNT(*) INTO v_entered_orphans
    FROM orders o
   WHERE o.entered_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = o.entered_by);
  RAISE NOTICE 'Unresolved claimed_by values: %', v_claim_orphans;
  RAISE NOTICE 'Unresolved entered_by values: %', v_entered_orphans;
END $$;
