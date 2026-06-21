-- ============================================================================
-- Hi-Tech dashboard — analytics retention (Option A: archive-before-delete)
-- ----------------------------------------------------------------------------
-- n8n_chat_histories does double duty: it's the AI agent's working memory
-- (must stay lean → pruned to 5 days) AND the analytics source for the
-- dashboard (wants full history). This decouples them:
--   • n8n_chat_histories  → keep the 5-day cleanup (agent memory stays recent)
--   • chat_archive        → permanent store; rows are MOVED here before deletion
--   • chat_all (view)     → live ∪ archive; the dashboard reads THIS
-- Run this whole file once in the Supabase SQL editor.
-- ============================================================================

-- 1. Archive table — a structural mirror of the live table.
--    LIKE ... INCLUDING DEFAULTS copies every column (same names, types, ORDER,
--    and defaults) but deliberately NOT identity/PK, so we can copy original
--    rows verbatim with `SELECT *` without fighting an identity/serial column.
CREATE TABLE IF NOT EXISTS chat_archive (LIKE n8n_chat_histories INCLUDING DEFAULTS);

-- Index for the dashboard's "newest first" reads.
CREATE INDEX IF NOT EXISTS idx_chat_archive_ts ON chat_archive ("Timestamp" DESC);

-- 2. Union view the dashboard reads from: recent (live) + everything older (archive).
--    No overlap because the move (step 3) deletes from live as it inserts to archive,
--    so UNION ALL is safe and dup-free.
CREATE OR REPLACE VIEW chat_all AS
  SELECT * FROM n8n_chat_histories
  UNION ALL
  SELECT * FROM chat_archive;

-- 3. Enable RLS on the archive (security-rls.sql adds the policies; this ensures
--    re-running this file alone doesn't leave the table wide-open).
ALTER TABLE chat_archive ENABLE ROW LEVEL SECURITY;

-- Expose to authenticated users only. Anon is locked out here and in security-rls.sql.
-- security-rls.sql also does an explicit REVOKE anon — this is defense in depth.
GRANT SELECT ON chat_archive TO authenticated;
GRANT SELECT ON chat_all     TO authenticated;

-- ============================================================================
-- 4. THE CLEANER — replaces your old DELETE. Run this on your existing schedule
--    (n8n cron, pg_cron, etc.). It atomically MOVES expiring rows to the archive
--    (delete + insert in one statement = all-or-nothing) and reports the count.
-- ============================================================================
-- WITH moved AS (
--   DELETE FROM n8n_chat_histories
--   WHERE "Timestamp" < NOW() - INTERVAL '5 days'
--   RETURNING *
-- ),
-- archived AS (
--   INSERT INTO chat_archive
--   SELECT * FROM moved
--   RETURNING 1
-- )
-- SELECT count(*) AS total_archived FROM archived;
--
-- NOTE: if your live table's id column is GENERATED ALWAYS AS IDENTITY, change
-- the insert line to:  INSERT INTO chat_archive OVERRIDING SYSTEM VALUE
-- ============================================================================
