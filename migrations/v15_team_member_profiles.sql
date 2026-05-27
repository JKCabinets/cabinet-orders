-- ──────────────────────────────────────────────────────────────────
-- v15: Team member profile fields
-- ──────────────────────────────────────────────────────────────────
--
-- This migration adds richer profile data to team_members so each user
-- has a real "profile" beyond just initials and a color. Used by:
--   - Inline profile editor in /admin (Session 4B)
--   - Photo-aware avatars site-wide (Session 4C)
--   - Profile modal/hover card (Session 4D)
--   - Dedicated /team/[username] page (Session 4F)
--
-- All new columns are nullable so existing rows stay valid. Users fill
-- in their own profiles over time via the new UI — no backfill needed.
--
-- Photo storage:
--   - photo_url holds the public URL of the uploaded image
--   - Actual bytes live in Supabase Storage bucket "team-avatars"
--   - That bucket is created separately (see comment at end)

BEGIN;

-- ── Profile fields ───────────────────────────────────────────────
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS role_title      TEXT,
  ADD COLUMN IF NOT EXISTS bio             TEXT,
  ADD COLUMN IF NOT EXISTS working_hours   TEXT,
  ADD COLUMN IF NOT EXISTS timezone        TEXT,
  ADD COLUMN IF NOT EXISTS slack_handle    TEXT,
  ADD COLUMN IF NOT EXISTS ooo_status      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ooo_message     TEXT,
  ADD COLUMN IF NOT EXISTS ooo_until       DATE;

-- ── Update the realtime publication ──────────────────────────────
-- v14 added orders to supabase_realtime so order edits broadcast.
-- For team_members we want the same: when someone updates their
-- profile (e.g. flips OOO status), other connected clients should
-- see it immediately. REPLICA IDENTITY FULL ensures UPDATE events
-- carry the full row (not just the primary key + changed columns)
-- so client-side reducers can apply diffs cleanly.
ALTER TABLE team_members REPLICA IDENTITY FULL;

-- Add team_members to the publication if not already there. The DO
-- block makes this idempotent — running the migration twice won't
-- error on "already added".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_members;
  END IF;
END $$;

-- ── RLS for Realtime subscribers ─────────────────────────────────
-- Match the pattern from v14: enable RLS, then add a SELECT policy
-- that lets any authenticated WebSocket client read team_members.
-- Service-role API requests bypass RLS, so this only governs the
-- realtime channel.
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Drop+recreate keeps the migration rerunnable.
DROP POLICY IF EXISTS "authenticated_can_read_team_members" ON team_members;
CREATE POLICY "authenticated_can_read_team_members"
  ON team_members FOR SELECT
  TO authenticated
  USING (true);

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- POST-MIGRATION: Supabase Storage bucket
-- ──────────────────────────────────────────────────────────────────
--
-- The "team-avatars" bucket must be created via the Supabase Dashboard
-- (Storage → New bucket) because SQL can't always create buckets in
-- self-hosted vs cloud configurations consistently.
--
-- Settings:
--   Name:          team-avatars
--   Public:        Yes (avatars need to render in browsers without auth)
--   File size limit: 2 MB
--   Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
--
-- After creation, no SQL is needed — uploads happen through the
-- Storage API in our /api/team/[id]/avatar route (Session 4A).
