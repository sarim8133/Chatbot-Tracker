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
-- whole exchange plus reason — a preset tag, so a 👎 becomes a category
-- instead of a mood.
--
-- Applied 2026-07-21 via Supabase MCP migration `create_chat_feedback`.
-- This file is the checked-in record; the live schema is the source of truth.
-- See src/feedback.js (reason tags + submit) and the Bad responses panel.
--
-- UPDATE 2026-08-29: from_cache and cache_purged both dropped — the semantic
-- cache was retired site-wide. See the update note at the end of this file for
-- the full change and db/2026-08-29-remove-cache-step2.sql for the migration.
-- (Between 2026-07-26 and 2026-08-29, from_cache decided the fix: a disliked
-- LIVE answer meant fix the prompt or RAG; a disliked CACHED one meant the
-- semantic_cache row had to go too, or a prompt fix would look like it did
-- nothing. That distinction no longer applies — every reply is live now.)
-- ============================================================================

create table if not exists public.chat_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  session_id   text,
  channel      text not null default 'web',
  turn_ts      timestamptz,                  -- when the disliked reply was shown
  user_message text,                         -- the question that produced it
  ai_response  text,                         -- the reply, verbatim as displayed
  reason       text not null,                -- preset tag, see src/feedback.js
  note         text,                         -- optional free-text detail
  user_name    text,
  user_id      uuid
  -- from_cache and cache_purged (semantic-cache purge bookkeeping) dropped
  -- 2026-08-29 -- see the update note at the end of this file.
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
-- admin_read tables (web_chat_histories, client_errors...).
drop policy if exists chat_feedback_admin_read on public.chat_feedback;
create policy chat_feedback_admin_read
  on public.chat_feedback for select
  to authenticated
  using (private.is_admin());

grant insert, select on public.chat_feedback to authenticated;
revoke all on public.chat_feedback from anon;


-- ============================================================================
-- 2. Auto-purge — RETIRED 2026-08-29, kept below as history
-- ----------------------------------------------------------------------------
-- Applied 2026-07-26 via migration `purge_semantic_cache_on_bad_answer`.
-- Removed 2026-08-29 via db/2026-08-29-remove-cache-step2.sql, along with the
-- semantic_cache table itself — see the update note at the end of this file.
--
-- The from_cache flag used to tell an admin to go delete the row by hand.
-- Nobody reliably did, and the cost of forgetting was invisible: semantic_cache
-- was checked BEFORE the agent ran, so the bad answer kept being served and
-- every prompt or RAG fix afterwards looked like it did nothing. Three things
-- worth knowing about how it worked, for the record:
--
-- • It matched on the REPLY, not the question. The cache hit on embedding
--   similarity above 0.94, so the phrasing that got served was usually not the
--   phrasing stored in query_text — matching the question would have missed.
--
-- • It fired for uncached replies too, on purpose. "Save to Semantic Cache"
--   ran on the way OUT of a cache miss, so a reply badged "AI call" in the UI
--   was normally already in the cache by the time a rep read it.
--
-- • One report could evict more than one row — the same answer got cached
--   under each question phrasing that produced it. cache_purged recorded how
--   many.
-- ============================================================================

create or replace function public.report_bad_answer(
  p_session_id   text,
  p_turn_ts      timestamptz,
  p_user_message text,
  p_ai_response  text,
  p_reason       text,
  p_note         text
) returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- SECURITY DEFINER runs as the owner, so every gate the table's RLS would
  -- have applied has to be restated here.
  if v_uid is null then
    raise exception 'Sign in before reporting an answer.' using errcode = '42501';
  end if;
  if coalesce(p_reason, '') = '' then
    raise exception 'Pick a reason first.' using errcode = '22023';
  end if;

  insert into public.chat_feedback (
    session_id, channel, turn_ts, user_message, ai_response,
    reason, note, user_name, user_id
  ) values (
    nullif(p_session_id, ''), 'web', p_turn_ts,
    left(p_user_message, 4000), left(p_ai_response, 4000),
    p_reason, nullif(btrim(coalesce(p_note, '')), ''),
    -- Identity is the account, never a client-supplied string. Same rule as
    -- db/expense-access-rls.sql.
    (select full_name from public.app_users where user_id = v_uid),
    v_uid
  );
end
$$;

revoke all on function public.report_bad_answer(text, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.report_bad_answer(text, timestamptz, text, text, text, text) to authenticated;

-- Verified 2026-07-26 (of the ORIGINAL 7-argument, purging version — kept for
-- the record since the mechanism it proved, SECURITY DEFINER doing the whole
-- job in one transaction, carried over unchanged): impersonating a non-admin
-- employee inside a rolled-back transaction, two rows sharing one reply →
-- purged 2, a decoy row untouched, a 9-char reply → purged 0, user_name/
-- user_id stamped from the JWT and not from the request body, anon execute
-- denied, authenticated still has no direct DELETE on semantic_cache.
--
-- UPDATE 2026-08-29 (db/2026-08-29-remove-cache-step2.sql): the purge and
-- p_from_cache both removed — a genuine signature change (7 args -> 6), so the
-- old function had to be DROPped by its exact old signature before this
-- CREATE OR REPLACE could take the name; PostgREST would otherwise have had
-- two candidates to choose between. src/feedback.js was updated in the same
-- change to stop sending p_from_cache — the two are one change split across
-- two files, not independent. The function now returns void instead of the
-- purge count; src/mawavia-dashboard.jsx's BadAnswerButton was already
-- rewritten to a plain boolean "sent" flag rather than reading a count.
