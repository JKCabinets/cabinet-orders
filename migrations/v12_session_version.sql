-- ─────────────────────────────────────────────────────────────────────
-- v12 — add session_version column to team_members
--
-- Used by the JWT callback (lib/authOptions.ts) to invalidate stale
-- sessions when a user's privileges change. The column starts at 1 and
-- is bumped by privilege-affecting operations:
--   - Role change (admin ↔ member)
--   - Account deactivation
--   - Password change
--
-- The JWT carries a snapshot of session_version at sign-in. Every JWT
-- callback (effectively every authenticated request, modulo a short
-- cache) compares the snapshot to the live DB value; a mismatch
-- triggers a forced re-login.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1;

-- Existing rows pick up the DEFAULT 1 automatically. New sessions for
-- those users will snapshot 1 into their JWT, which matches, so they
-- stay logged in. No mass-logout side effect from this migration.

-- ─────────────────────────────────────────────────────────────────────
-- Verification:
--
--   SELECT id, username, role, session_version FROM team_members ORDER BY id;
--   -- Every row should show session_version = 1
-- ─────────────────────────────────────────────────────────────────────
