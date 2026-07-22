-- ============================================================================
-- Hi Tech dashboard — chat feedback ("Bad responses")
-- ----------------------------------------------------------------------------
-- Replaces the old "Knowledge gaps" panel. That panel flagged questions whose
-- reply was under 20 characters — but the agent's NO RESULTS RULE tells it to
-- answer "I couldn't find [model] in our catalog. Could you double-check…",
-- which is ~90 chars. Measured 2026-07-21: 0 of 128 turns ever matched, so the
-- panel was structurally incapable of firing. Worse, the failures that matter
-- (a confident, long, WRONG answer) can never be caught by a length heuristic.
--
-- So the signal now comes from the reps: a dislike button under each assistant
-- reply. Dislike-only — there is no "like", because only failures are
-- actionable. A bare vote is not actionable either, so every row carries the
-- whole exchange plus:
--   • reason     — a preset tag, so a 👎 becomes a category instead of a mood
--   • from_cache — decides the fix. A disliked LIVE answer means fix the prompt
--                  or the RAG; a disliked CACHED answer means delete the
--                  semantic_cache row, and until you do, no prompt fix will
--                  appear to work at all.
--
-- Applied 2026-07-21 via Supabase MCP migration `create_chat_feedback`.
-- This file is the checked-in record; the live schema is the source of truth.
-- See src/feedback.js (reason tags + submit) and the Bad responses panel.
-- ============================================================================

create table if not exists public.chat_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  session_id   text,
  channel      text not null default 'web',
  turn_ts      timestamptz,                  -- when the disliked reply was shown
  user_message text,                         -- the question that produced it
  ai_response  text,                         -- the reply, verbatim as displayed
  from_cache   boolean not null default false,
  reason       text not null,                -- preset tag, see src/feedback.js
  note         text,                         -- optional free-text detail
  user_name    text,
  user_id      uuid
);

comment on table public.chat_feedback is
  'Rep-reported bad chat answers (dislike-only). Replaces the old "Knowledge gaps" panel, which keyed on replies under 20 chars and could never fire — the agent is prompted to always answer in a full sentence. Insert by any signed-in user; admin-read.';

create index if not exists chat_feedback_created_at_idx on public.chat_feedback (created_at desc);
create index if not exists chat_feedback_reason_idx     on public.chat_feedback (reason);

alter table public.chat_feedback enable row level security;

-- Any signed-in rep may report a bad answer (they can only report what they saw).
drop policy if exists chat_feedback_insert on public.chat_feedback;
create policy chat_feedback_insert
  on public.chat_feedback for insert
  to authenticated
  with check (true);

-- Reading the reports is analytics — admin-only, same gate as the other
-- admin_read tables (web_chat_histories, semantic_cache, client_errors...).
drop policy if exists chat_feedback_admin_read on public.chat_feedback;
create policy chat_feedback_admin_read
  on public.chat_feedback for select
  to authenticated
  using (private.is_admin());

grant insert, select on public.chat_feedback to authenticated;
revoke all on public.chat_feedback from anon;
