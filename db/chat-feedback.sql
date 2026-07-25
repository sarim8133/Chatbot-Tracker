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
--                  or the RAG; a disliked CACHED answer means the semantic_cache
--                  row has to go, and until it does, no prompt fix will appear
--                  to work at all.
--
-- Applied 2026-07-21 via Supabase MCP migration `create_chat_feedback`.
-- Amended 2026-07-26 via `purge_semantic_cache_on_bad_answer` — that last step
-- is no longer manual; see section 2.
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
  user_id      uuid,
  cache_purged integer not null default 0  -- semantic_cache rows this report evicted
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


-- ============================================================================
-- 2. Auto-purge — reporting a bad answer evicts it from the semantic cache
-- ----------------------------------------------------------------------------
-- Applied 2026-07-26 via migration `purge_semantic_cache_on_bad_answer`.
--
-- The from_cache flag above told an admin to go delete the row by hand. Nobody
-- reliably does, and the cost of forgetting is invisible: semantic_cache is
-- checked BEFORE the agent runs, so the bad answer keeps being served and every
-- prompt or RAG fix afterwards looks like it did nothing.
--
-- Three things are worth knowing about how this works:
--
-- • It matches on the REPLY, not the question. The cache hits on embedding
--   similarity above 0.94, so the phrasing that got served is usually not the
--   phrasing stored in query_text — matching the question would miss. The reply
--   is stored verbatim and returned unchanged by the webhook, so the text on
--   screen is the exact key. That also means no n8n change was needed: the
--   cache SELECT never returned an id, and adding one is a manual paste.
--
-- • It fires for uncached replies too, on purpose. "Save to Semantic Cache"
--   runs on the way OUT of a cache miss, so a reply badged "AI call" in the UI
--   is normally already in the cache by the time a rep reads it. Purging only
--   from_cache replies would leave exactly those rows behind.
--
-- • One report can evict more than one row — the same answer gets cached under
--   each question phrasing that produced it. cache_purged records how many.
--
-- SECURITY DEFINER is load-bearing: semantic_cache is admin-read with no DELETE
-- grant, so the rep who saw the bad answer is the one person who cannot remove
-- it, and widening the grant would let any signed-in user delete anything.
-- Every gate RLS would have applied is therefore restated inside the function.
-- ============================================================================

create or replace function public.report_bad_answer(
  p_session_id   text,
  p_turn_ts      timestamptz,
  p_user_message text,
  p_ai_response  text,
  p_from_cache   boolean,
  p_reason       text,
  p_note         text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid    := auth.uid();
  v_purged integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in before reporting an answer.' using errcode = '42501';
  end if;
  if coalesce(p_reason, '') = '' then
    raise exception 'Pick a reason first.' using errcode = '22023';
  end if;

  -- The length floor is the authorisation check. An exact whole-string match on
  -- a reply of real length means the caller demonstrably has that reply in hand;
  -- without it, a signed-in user could evict rows by guessing short common
  -- strings. Replies this short are not worth a cache row anyway.
  if length(coalesce(p_ai_response, '')) >= 24 then
    delete from public.semantic_cache where reply_text = p_ai_response;
    get diagnostics v_purged = row_count;
  end if;

  insert into public.chat_feedback (
    session_id, channel, turn_ts, user_message, ai_response,
    from_cache, reason, note, user_name, user_id, cache_purged
  ) values (
    nullif(p_session_id, ''), 'web', p_turn_ts,
    left(p_user_message, 4000), left(p_ai_response, 4000),
    coalesce(p_from_cache, false), p_reason,
    nullif(btrim(coalesce(p_note, '')), ''),
    -- Identity is the account, never a client-supplied string. Same rule as
    -- db/expense-access-rls.sql.
    (select full_name from public.app_users where user_id = v_uid),
    v_uid, v_purged
  );

  return v_purged;
end
$$;

revoke all on function public.report_bad_answer(text, timestamptz, text, text, boolean, text, text) from public, anon;
grant execute on function public.report_bad_answer(text, timestamptz, text, text, boolean, text, text) to authenticated;

-- Verified 2026-07-26, impersonating a non-admin employee inside a rolled-back
-- transaction: two rows sharing one reply → purged 2, a decoy row untouched,
-- a 9-char reply → purged 0, user_name/user_id stamped from the JWT and not
-- from the request body, anon execute denied, authenticated still has no direct
-- DELETE on semantic_cache.
