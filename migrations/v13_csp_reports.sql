-- ─────────────────────────────────────────────────────────────────────
-- v13 — csp_reports table for Content-Security-Policy violation reports
--
-- Receives POSTs from browsers when a CSP-Report-Only header fires.
-- We're using report-only mode to observe what would be blocked under
-- a strict nonce-based policy before flipping the enforcement switch.
--
-- See:
--   - proxy.ts (sets the CSP-Report-Only header with report-uri)
--   - app/api/csp-report/route.ts (POST handler that inserts here)
--
-- Once the policy is tuned and we flip to enforcing mode, this table
-- still collects production violations — useful for catching regressions
-- (e.g. a future PR that adds an inline script without a nonce).
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS csp_reports (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Header fields the browser includes in the report (we flatten the
  -- common ones for easy querying; full payload also stored as JSONB).
  document_uri       TEXT,
  referrer           TEXT,
  violated_directive TEXT,
  effective_directive TEXT,
  original_policy    TEXT,
  disposition        TEXT,         -- "report" or "enforce"
  blocked_uri        TEXT,
  status_code        INT,
  script_sample      TEXT,
  source_file        TEXT,
  line_number        INT,
  column_number      INT,

  -- Useful for grouping
  user_agent         TEXT,
  ip_hash            TEXT,         -- truncated for privacy; we don't need full IPs

  -- The raw report body, in case the browser sent fields we didn't extract
  raw                JSONB
);

-- Index for the most common query: "what's been violated lately"
CREATE INDEX IF NOT EXISTS csp_reports_created_at_idx
  ON csp_reports (created_at DESC);

-- Index for grouping by directive
CREATE INDEX IF NOT EXISTS csp_reports_directive_idx
  ON csp_reports (effective_directive, blocked_uri);

-- ─────────────────────────────────────────────────────────────────────
-- Useful queries:
--
--   -- What's getting flagged, grouped:
--   SELECT effective_directive, blocked_uri, COUNT(*) AS n
--   FROM csp_reports
--   GROUP BY effective_directive, blocked_uri
--   ORDER BY n DESC;
--
--   -- Recent reports with context:
--   SELECT created_at, violated_directive, blocked_uri, source_file, line_number
--   FROM csp_reports
--   ORDER BY created_at DESC
--   LIMIT 50;
-- ─────────────────────────────────────────────────────────────────────
