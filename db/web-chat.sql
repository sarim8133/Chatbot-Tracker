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

-- Admins can read the web-chat history; anon is locked out. HARDENED 2026-07-06:
-- was "authenticated USING (true)", but self-service employee/accountant logins now
-- exist — USING(true) would let any of them read every user's web chats via REST.
-- Restricted to private.is_admin() (see db/expense-access-rls.sql). Employees still
-- chat fine; their thread persists in localStorage (only cross-device DB restore,
-- which was admin-facing analytics anyway, is gated). A proper per-user policy would
-- need a user_id column stamped from the caller's JWT by the chat webhook.
DROP POLICY IF EXISTS web_chat_authenticated_read ON web_chat_histories;
DROP POLICY IF EXISTS web_chat_admin_read         ON web_chat_histories;
CREATE POLICY web_chat_admin_read ON web_chat_histories
  FOR SELECT TO authenticated USING (private.is_admin());

-- n8n writes/maintains rows via the service_role key.
DROP POLICY IF EXISTS web_chat_service_all ON web_chat_histories;
CREATE POLICY web_chat_service_all ON web_chat_histories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON web_chat_histories TO authenticated;
REVOKE ALL  ON web_chat_histories FROM anon;

-- ============================================================================
-- 2026-07-06 — merge web chat into the sales analytics (usage moved to the site).
-- chat_all now UNIONs this table in with a channel tag, so dashboard metrics reflect
-- BOTH channels. security_invoker keeps per-table RLS (all admin-only), so the
-- analytics stay admin-only. Web rows have no phone → User_Number is null (the UI
-- attributes those reps by Name). Applied via migration chat_all_include_web_with_channel.
-- ============================================================================
CREATE OR REPLACE VIEW chat_all AS
  SELECT "Timestamp","User_Message","AI_Response","User_Number",unq_id,"Name",from_cache,
         'whatsapp'::text AS channel FROM n8n_chat_histories
  UNION ALL
  SELECT "Timestamp","User_Message","AI_Response","User_Number",unq_id,"Name",from_cache,
         'whatsapp'::text AS channel FROM chat_archive
  UNION ALL
  SELECT "Timestamp","User_Message","AI_Response",
         NULL::bigint AS "User_Number", unq_id,"Name",from_cache,
         'web'::text AS channel FROM web_chat_histories;
ALTER VIEW chat_all SET (security_invoker = on);
GRANT SELECT ON chat_all TO authenticated;

-- ============================================================================
-- 2026-08-29 — from_cache column dropped
-- ----------------------------------------------------------------------------
-- web_chat_histories.from_cache (created NOT NULL DEFAULT false, above) is
-- gone -- the semantic cache was retired site-wide. The chat_all view already
-- shown above is superseded and dead (see db/2026-07-28-single-identity.sql,
-- which is the source of truth for chat_all as of 2026-07-28, and which
-- dropped from_cache from its own definition the same day as this).
--
-- If this file is ever re-run against a fresh database, the CREATE TABLE above
-- will still create a from_cache column that no longer matches production --
-- run db/2026-08-29-remove-cache-step3.sql after it to bring a fresh table in
-- line with the live schema.
-- ============================================================================
