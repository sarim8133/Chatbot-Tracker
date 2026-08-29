-- ============================================================================
-- Removing the semantic cache from the database — STEP 3 of 3 (final).
--
-- Drops the from_cache COLUMN from all three chat tables. Held back from step 2
-- deliberately: n8n was still writing to it, and web_chat_histories.from_cache
-- was NOT NULL, so dropping it first would have taken the web chat down.
--
-- Now safe. Confirmed 2026-08-29 by reading both live n8n workflows
-- (Mawavia Whatsapp Chatbot, Hi-Tech Web Chat) via the n8n API:
--   * Neither workflow references semantic_cache anywhere.
--   * Both Code nodes hardcode `from_cache: false` in their output (the
--     semantic-cache lookup and the purge gate it used to feed are both gone;
--     the field survives only because the Postgres insert node still maps a
--     value into the from_cache column).
--   * Step 1 (2026-08-29-remove-cache-step1.sql) already dropped NOT NULL and
--     added a default on all three columns, so even an insert node that stops
--     naming from_cache entirely -- or one that still does, harmlessly -- is
--     fine either way. Dropping the column now is safe regardless of which.
--
-- After this runs, the from_cache field n8n still writes into its insert nodes
-- becomes silently ignored by PostgREST (extra columns in a mapped insert are
-- not an error) rather than stored -- cosmetic cleanup in the n8n UI can happen
-- whenever, not before or after this in particular.
-- ============================================================================

alter table public.n8n_chat_histories drop column if exists from_cache;
alter table public.web_chat_histories drop column if exists from_cache;
alter table public.chat_archive       drop column if exists from_cache;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: no rows. Any row here means a table still has the column.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('n8n_chat_histories', 'web_chat_histories', 'chat_archive')
   and column_name = 'from_cache';

-- Whole-database confirmation that not one from_cache column survives anywhere,
-- not just the three targeted here.
select table_schema, table_name
  from information_schema.columns
 where column_name = 'from_cache';
