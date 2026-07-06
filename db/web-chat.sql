-- ============================================================================
-- Hi-Tech dashboard — web-chat history (in-app Chat tab)
-- ----------------------------------------------------------------------------
-- The dashboard's Chat tab talks to an n8n webhook (a clone of the WhatsApp
-- workflow). n8n runs the assistant and writes each turn HERE, not into
-- n8n_chat_histories — keeping web traffic out of the WhatsApp rep analytics.
--
-- Trust model (same as the WAP tables):
--   • n8n writes with the service_role key  → bypasses RLS
--   • the dashboard reads with a signed-in JWT → authenticated SELECT policy
--   • anon (the publishable key alone) gets nothing
-- Run this once in the Supabase SQL editor (already applied via MCP migration
-- `create_web_chat_histories`).
-- ============================================================================

CREATE TABLE IF NOT EXISTS web_chat_histories (
  unq_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     text NOT NULL,                 -- one browser conversation
  "Timestamp"    timestamptz NOT NULL DEFAULT now(),
  "User_Message" text,
  "AI_Response"  text,
  "Name"         text,                          -- signed-in dashboard user (optional)
  from_cache     boolean NOT NULL DEFAULT false
);

-- "newest first" reads + per-session history lookups
CREATE INDEX IF NOT EXISTS idx_web_chat_ts      ON web_chat_histories ("Timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_web_chat_session ON web_chat_histories (session_id, "Timestamp");

ALTER TABLE web_chat_histories ENABLE ROW LEVEL SECURITY;

-- Dashboard (signed-in) can read; anon is locked out.
DROP POLICY IF EXISTS web_chat_authenticated_read ON web_chat_histories;
CREATE POLICY web_chat_authenticated_read ON web_chat_histories
  FOR SELECT TO authenticated USING (true);

-- n8n writes/maintains rows via the service_role key.
DROP POLICY IF EXISTS web_chat_service_all ON web_chat_histories;
CREATE POLICY web_chat_service_all ON web_chat_histories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON web_chat_histories TO authenticated;
REVOKE ALL  ON web_chat_histories FROM anon;
