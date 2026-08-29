-- ============================================================================
-- Removing the semantic cache from the database — STEP 1 of 2.
--
-- The website no longer references the cache at all (that change is already in
-- src/). This step does the two things that are safe to do RIGHT NOW, and ends
-- by printing what step 2 needs.
--
-- Why it is split. Three things still read or write `from_cache` and cannot be
-- unpicked in one pass:
--
--   1. n8n still writes it. Both workflows inserted from_cache = false as
--      recently as 2026-08-29 10:18. web_chat_histories.from_cache is NOT NULL
--      with no default, so dropping the column before the workflows stop
--      sending it takes the web chat down.
--
--   2. chat_all, dashboard_stats and conversations_page all select from_cache,
--      so the column cannot be dropped until those three are rebuilt.
--
--   3. report_bad_answer deletes from semantic_cache, so the table cannot be
--      dropped until that function is rebuilt.
--
-- And rebuilding those functions from the copies in db/ is NOT safe. That is
-- not caution for its own sake — db/dashboard-stats.sql:50-56 records a
-- production regression caused by exactly that mistake (user_count 6 -> 10,
-- active_reps 5 -> 9), and says plainly: introspect the LIVE function before
-- writing a CREATE OR REPLACE, never trust the checked-in body. So step 2 gets
-- written from the output of the query at the bottom of this file, not from
-- the repo.
-- ============================================================================


-- ── 1. Let n8n stop writing from_cache ──────────────────────────────────────
-- Nothing breaks today: existing writers keep working, and once this has run
-- the from_cache field can be deleted from the n8n insert nodes at leisure.
-- This is the prerequisite for dropping the columns in step 2 without an
-- outage -- expand/contract, not a flag day.
alter table public.n8n_chat_histories alter column from_cache drop not null;
alter table public.n8n_chat_histories alter column from_cache set default false;
alter table public.web_chat_histories alter column from_cache drop not null;
alter table public.web_chat_histories alter column from_cache set default false;
alter table public.chat_archive       alter column from_cache drop not null;
alter table public.chat_archive       alter column from_cache set default false;


-- ── 2. Confirm nothing else points at semantic_cache ─────────────────────────
-- If this returns any row, step 2 has to deal with it too.
select 'FK pointing at semantic_cache' as finding,
       srcns.nspname || '.' || src.relname as from_table, con.conname
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_namespace srcns on srcns.oid = src.relnamespace
 where con.contype = 'f' and con.confrelid = 'public.semantic_cache'::regclass;


-- ── 3. What step 2 needs: the LIVE definitions ───────────────────────────────
-- Run this and send the output back. These four are the only things standing
-- between here and the cache being gone completely.
select 'chat_all' as object, pg_get_viewdef('public.chat_all'::regclass, true) as definition
union all
select 'dashboard_stats',    pg_get_functiondef('public.dashboard_stats(text)'::regprocedure)
union all
select 'conversations_page', pg_get_functiondef('public.conversations_page(text,text,text,text,int,int)'::regprocedure)
union all
select 'report_bad_answer',  pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'report_bad_answer';
