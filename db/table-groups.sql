-- Which table belongs to what. Applied via migration `label_tables_by_domain`.
--
-- WHY COMMENTS AND NOT SCHEMAS
--
-- Supabase Studio has no folders for tables. The only real grouping mechanism in
-- Postgres is schemas — and moving these tables would mean updating every
-- SECURITY DEFINER function (they all schema-qualify public.X, because they run
-- with search_path = ''), every RLS policy, every hardcoded REST URL in the two
-- n8n workflows, both edge functions, and every frontend call. That is a large
-- amount of breakage across a live bot and a live dashboard, bought purely for
-- organisation. So the grouping is recorded as descriptions instead, which Studio
-- shows in the table list.
--
-- THREE GROUPS, NOT TWO. Identity is genuinely shared and forcing it to one side
-- would misrepresent it: wap_allowed_senders carries the receipts foreign key AND
-- the WhatsApp roster, and app_users is now the single key behind login, the bot
-- and receipts alike.
--
--   [Chatbot / WhatsApp]  n8n_chat_histories, chat_archive
--   [Chatbot / Website]   web_chat_histories
--   [Chatbot]             chat_all, semantic_cache, chat_feedback
--   [Receipts]            wap_expenses, wap_expense_splits,
--                         wap_expense_deletions, wap_expense_monthly
--   [Identity — shared]   app_users, wap_allowed_senders, whatsapp_members
--   [Platform]            client_errors
--   [Backup — safe to drop]  backup_20260728_* (4)
--
-- Re-runnable. If you add a table, add its comment here too — an unlabelled table
-- is the one nobody can place a year from now.

-- ── Chatbot: WhatsApp + website ──────────────────────────────────────────────
comment on table public.n8n_chat_histories is
  '[Chatbot / WhatsApp] One row per exchange with the WhatsApp bot, written by the "Mawavia Whatsapp Chatbot" n8n workflow. Since 2026-07-28 it stamps user_id and the roster full_name; before that, Name was the sender''s own WhatsApp profile name, which they control. Admin-read.';

comment on table public.web_chat_histories is
  '[Chatbot / Website] One row per exchange with the Chat tab, written by the "Hi-Tech Web Chat" n8n workflow. Same shape as the WhatsApp log plus session_id. Stamps user_id and the roster full_name; before 2026-07-28 Name was the JWT email local-part ("smsarim6"). Admin-read.';

comment on table public.chat_archive is
  '[Chatbot / WhatsApp] Older WhatsApp traffic moved out of n8n_chat_histories. Read-only history — nothing writes here — but it is still unioned into chat_all, so it counts toward every dashboard metric.';

comment on view public.chat_all is
  '[Chatbot] The analytics source: n8n_chat_histories + chat_archive + web_chat_histories, plus the resolved identity (ident / person_name / person_phone). Read by dashboard_stats, conversations_page and the dashboard. security_invoker = on — re-assert that after ANY create-or-replace, or it silently starts bypassing the admin-only RLS on all three base tables.';

comment on table public.semantic_cache is
  '[Chatbot] Answers cached by query embedding and served before the agent runs, on both channels. A wrong answer cached here masks any prompt or RAG fix until the row is deleted.';

comment on table public.chat_feedback is
  '[Chatbot] Rep-reported bad chat answers (dislike-only). Replaces the old "Knowledge gaps" panel, which keyed on replies under 20 chars and could never fire — the agent is prompted to always answer in a full sentence. Insert by any signed-in user; admin-read.';

-- ── Receipts / expenses ──────────────────────────────────────────────────────
comment on table public.wap_expenses is
  '[Receipts] One row per receipt, from the WhatsApp photo bot or the web upload. sender_phone has a foreign key to wap_allowed_senders; access is keyed on user_id (employee sees their own, accountant sees all).';

comment on table public.wap_expense_splits is
  '[Receipts] Splits one receipt across several people — a share row per person. Used when a bill is shared rather than attributed to the payer alone.';

comment on table public.wap_expense_deletions is
  '[Receipts] Audit trail for deleted receipts: who deleted it, when, why, plus a full row_snapshot so a deletion is recoverable and reviewable.';

comment on view public.wap_expense_monthly is
  '[Receipts] Per-person, per-category monthly rollup of wap_expenses — receipt count, total and average spend in PKR. Excludes rejected receipts. Keys on user_id, falling back to the lowercased employee_name for older rows that predate it.';

-- ── Identity: shared by BOTH sides ───────────────────────────────────────────
comment on table public.app_users is
  '[Identity — shared] The roster. One row per person: role, phone, email, full_name, department. The single identity behind login, the WhatsApp bot and receipts — adding someone in the Team tab grants all three. Phone is required for every role because it is what the bot matches on. RLS: own row, plus admins read all.';

comment on table public.wap_allowed_senders is
  '[Identity — shared] WhatsApp expense linkage and the activation flag. Kept because wap_expenses.sender_phone has a foreign key to it and admin_list_users() joins it — NOT because it decides who may use the bot. That question is answered by whatsapp_members, which reads the ban state instead. Written only by the Team tab.';

comment on view public.whatsapp_members is
  '[Identity — shared] The single answer to "who may message the WhatsApp bot": an app_users row, a phone, and an unbanned login. The n8n gate reads it with the service role. SECURITY: granted to service_role ONLY — it is a definer-rights view exposing every colleague''s phone number, so granting it to authenticated would hand over the staff directory.';

-- ── Platform ─────────────────────────────────────────────────────────────────
comment on table public.client_errors is
  '[Platform] Frontend error sink (window.onerror / unhandledrejection / React boundary). Insert-only for clients; admin-read. Client-side flood control caps volume; see src/errlog.js.';

-- ── Backups: temporary, safe to drop ─────────────────────────────────────────
comment on table public.backup_20260728_wap_allowed_senders is
  '[Backup — safe to drop] Snapshot taken before the 2026-07-28 single-identity change. Revoked from anon/authenticated and RLS-enabled after the advisors caught it exposed. Delete once the change has proven itself.';
comment on table public.backup_20260728_n8n_chat_histories is
  '[Backup — safe to drop] Snapshot taken before the 2026-07-28 single-identity change. Holds a full copy of the WhatsApp log. Delete once the change has proven itself.';
comment on table public.backup_20260728_web_chat_histories is
  '[Backup — safe to drop] Snapshot taken before the 2026-07-28 single-identity change. Holds a full copy of the website log, session ids included. Delete once the change has proven itself.';
comment on table public.backup_20260728_chat_archive is
  '[Backup — safe to drop] Snapshot taken before the 2026-07-28 single-identity change. Delete once the change has proven itself.';


-- Check the grouping, or find anything unlabelled:
--
--   select substring(obj_description(c.oid) from '\[(.*?)\]') as grp, c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('r','v')
--    order by 1 nulls first, 2;
