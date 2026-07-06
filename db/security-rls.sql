-- ============================================================================
-- Hi-Tech dashboard — lock the data down with RLS (the anon key reads nothing)
-- ----------------------------------------------------------------------------
-- After this, the publishable/anon key alone returns ZERO rows. Only a signed-in
-- session can read: the dashboard's login page authenticates against Supabase
-- Auth and sends that user's JWT with every request.
--
-- ORDER OF OPERATIONS (do these in order):
--   1. Create the login user — Supabase dashboard → Authentication → Users →
--      Add user:   email  sarim@hitech.local    password  sarim123
--      ✅ tick "Auto Confirm User" so it works immediately (no email step).
--   2. THEN run this whole file (Supabase → SQL editor).
--   3. Deploy the frontend. The dashboard now requires login.
-- ============================================================================

-- 1. Turn on row-level security for every table the dashboard reads.
ALTER TABLE n8n_chat_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_archive       ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_cache     ENABLE ROW LEVEL SECURITY;

-- 2. Allow SELECT only for ADMINS. These are the sales-conversation / cache tables,
--    which live behind admin-only tabs. A plain "authenticated USING (true)" was safe
--    when every login was a trusted admin — but self-service employee/accountant logins
--    now exist (Team panel + roles, see db/expense-access-rls.sql), and a non-admin
--    could otherwise read all of this via REST, bypassing the UI's nav gating.
--    HARDENED 2026-07-06 → private.is_admin() (defined in db/expense-access-rls.sql).
DROP POLICY IF EXISTS authenticated_read ON n8n_chat_histories;
DROP POLICY IF EXISTS authenticated_read ON chat_archive;
DROP POLICY IF EXISTS authenticated_read ON semantic_cache;
DROP POLICY IF EXISTS admin_read        ON n8n_chat_histories;
DROP POLICY IF EXISTS admin_read        ON chat_archive;
DROP POLICY IF EXISTS admin_read        ON semantic_cache;

-- CRITICAL: drop the leftover anon-readable policies from the original (pre-login)
-- dashboard. These are what still let the public/anon key read data, even with RLS
-- on — an "anon SELECT USING (true)" policy. Dropping them is the real lock.
DROP POLICY IF EXISTS dashboard_read_history ON n8n_chat_histories;
DROP POLICY IF EXISTS dashboard_read_cache   ON semantic_cache;

CREATE POLICY admin_read ON n8n_chat_histories FOR SELECT TO authenticated USING (private.is_admin());
CREATE POLICY admin_read ON chat_archive       FOR SELECT TO authenticated USING (private.is_admin());
CREATE POLICY admin_read ON semantic_cache     FOR SELECT TO authenticated USING (private.is_admin());

-- 3. Make the chat_all view honor the CALLER's permissions (Postgres 15+).
--    Without this a view runs as its owner and BYPASSES the RLS above — letting
--    anon read everything through the view. This closes that hole.
ALTER VIEW chat_all SET (security_invoker = on);

-- 4. Grants: signed-in users may read; anon is explicitly locked out.
GRANT  SELECT ON n8n_chat_histories, chat_archive, semantic_cache, chat_all TO authenticated;
REVOKE SELECT ON n8n_chat_histories, chat_archive, semantic_cache, chat_all FROM anon;

-- ============================================================================
-- ⚠️  WRITE PATH — read this BEFORE you run the file
-- ----------------------------------------------------------------------------
-- RLS also governs INSERT / UPDATE / DELETE. Your chatbot writes to
-- n8n_chat_histories and your cleaner moves rows into chat_archive. Those keep
-- working ONLY IF they connect in a way that bypasses RLS:
--
--   • n8n Postgres node using DB host/user/password  → direct connection,
--     bypasses RLS.  ✅ nothing to do.
--   • Anything using the SERVICE ROLE key            → bypasses RLS.  ✅
--   • Anything using the ANON / publishable key      → ❌ RLS BLOCKS the writes.
--
-- Check how your n8n flow + cleaner connect. If either uses the anon key, switch
-- it to the service_role key (or a direct Postgres connection) BEFORE running
-- this — otherwise new chats and the archive job will start failing silently.
-- ============================================================================

-- Rollback (re-open to anon) if anything breaks:
--   ALTER TABLE n8n_chat_histories DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE chat_archive       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE semantic_cache     DISABLE ROW LEVEL SECURITY;
--   GRANT SELECT ON n8n_chat_histories, chat_archive, semantic_cache, chat_all TO anon;
