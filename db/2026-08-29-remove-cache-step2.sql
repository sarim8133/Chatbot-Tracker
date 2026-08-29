-- ============================================================================
-- Removing the semantic cache from the database — STEP 2 of 3.
--
-- Built from the LIVE definitions fetched by step 1's introspection query, not
-- from the checked-in db/ copies -- they agreed exactly this time, but see
-- db/dashboard-stats.sql:50-56 for why that is never assumed.
--
-- This step:
--   1. Rebuilds chat_all without from_cache. CREATE OR REPLACE VIEW can only
--      APPEND columns, never remove one, so this drops and recreates it.
--   2. Rebuilds dashboard_stats without cache_hits / cache_misses / cache_daily.
--   3. Rebuilds conversations_page without from_cache.
--   4. Rebuilds report_bad_answer without the semantic_cache purge and without
--      the p_from_cache parameter -- a genuine signature change (parameter
--      count differs), so the function is DROPped and recreated, not
--      CREATE OR REPLACE'd.
--   5. Drops chat_feedback.from_cache and .cache_purged.
--   6. Drops the semantic_cache table and private.can_manage_cache(), which
--      gates nothing else (grep confirms: only semantic_cache's own policies
--      reference it).
--
-- Deploy src/feedback.js alongside this. It stops sending p_from_cache to
-- match report_bad_answer's new signature. Run this SQL without that deploy
-- and "Bad answer" reporting breaks (PostgREST can't find a function matching
-- the old parameter list); ship that deploy without this SQL and it breaks the
-- other way (the live function still requires p_from_cache). They are one
-- change split across two files, not two independent changes.
--
-- NOT included: dropping the from_cache COLUMNS from n8n_chat_histories,
-- web_chat_histories and chat_archive. That is step 3. It stays separate until
-- the n8n workflows have actually stopped writing to it -- once both workflow
-- changes are live and you've watched one real message land in each with no
-- error, step 3 is safe to run.
-- ============================================================================

-- ── 1. chat_all, without from_cache ─────────────────────────────────────────
-- CASCADE is required (dashboard_stats and conversations_page both reference
-- it) and is safe here because both are recreated below, in this same
-- transaction-less script -- there is a real window where they don't exist,
-- but nothing else calls them mid-migration.
drop view public.chat_all cascade;

create view public.chat_all as
select
  r."Timestamp", r."User_Message", r."AI_Response", r."User_Number",
  r.unq_id, r."Name", r.channel, r.user_id,
  -- user_id is the stamp n8n writes; the two lookups in the lateral below cover
  -- rows written before the backfill or by a workflow not yet updated, which
  -- would otherwise key on free text and re-split the same human into a second
  -- rep the moment they sent one more message.
  case when p.user_id is not null then 'uid:' || p.user_id::text
       when r.channel = 'web' or r."User_Number" is null
         then 'web:' || coalesce(nullif(btrim(r."Name"), ''), 'Website user')
       else r."User_Number"::text
  end                                    as ident,
  p.full_name                            as person_name,
  coalesce(p.phone, case when r.channel <> 'web' then r."User_Number"::text end)
                                         as person_phone
from (
   select n8n_chat_histories."Timestamp", n8n_chat_histories."User_Message",
      n8n_chat_histories."AI_Response", n8n_chat_histories."User_Number",
      n8n_chat_histories.unq_id, n8n_chat_histories."Name",
      'whatsapp'::text as channel, n8n_chat_histories.user_id
     from n8n_chat_histories
  union all
   select chat_archive."Timestamp", chat_archive."User_Message",
      chat_archive."AI_Response", chat_archive."User_Number",
      chat_archive.unq_id, chat_archive."Name",
      'whatsapp'::text as channel, chat_archive.user_id
     from chat_archive
  union all
   select web_chat_histories."Timestamp", web_chat_histories."User_Message",
      web_chat_histories."AI_Response", null::bigint as "User_Number",
      web_chat_histories.unq_id, web_chat_histories."Name",
      'web'::text as channel, web_chat_histories.user_id
     from web_chat_histories
) r
-- LATERAL ... limit 1, not a three-way OR join: a row matching two ways would
-- come back twice and silently double that person's message count.
left join lateral (
  select a.user_id, a.full_name, a.phone
    from public.app_users a
   where a.user_id = r.user_id
      or (r.user_id is null and a.phone = r."User_Number"::text)
      or (r.user_id is null and r."User_Number" is null
          and split_part(a.email, '@', 1) = nullif(btrim(r."Name"), ''))
   limit 1
) p on true;

-- MUST follow every replace of this view: CREATE OR REPLACE / DROP+CREATE
-- resets reloptions, silently dropping security_invoker (see
-- db/supabase-migration-gotchas.md #1 in memory, and db/2026-07-28-single-
-- identity.sql section 7a).
alter view public.chat_all set (security_invoker = on);
grant select on public.chat_all to authenticated;
revoke select on public.chat_all from anon;


-- ── 2. dashboard_stats, without the cache split ─────────────────────────────
create or replace function public.dashboard_stats(p_channel text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
-- Identity is resolved once, in the chat_all view, and read here. See
-- db/2026-07-28-single-identity.sql.
--
-- SECURITY INVOKER is deliberate: chat_all honours the caller, so a non-admin
-- gets no rows and therefore no company-wide stats.
with base as (
  select
    c."Timestamp"                                                        as ts,
    (c."Timestamp" at time zone 'Asia/Karachi')::date                    as d,
    extract(dow  from c."Timestamp" at time zone 'Asia/Karachi')::int    as dow,
    extract(hour from c."Timestamp" at time zone 'Asia/Karachi')::int    as hr,
    btrim(coalesce(c."User_Message", ''))                                as q,
    btrim(coalesce(c."AI_Response", ''))                                 as a,
    coalesce(c.person_name, c."Name")                                    as nm,
    c.channel                                                            as ch,
    c.ident                                                              as ident,
    c.person_phone                                                       as ph
  from public.chat_all c
  where p_channel is null or c.channel = p_channel
),
today as (select (now() at time zone 'Asia/Karachi')::date as t),
totals as (
  select
    count(*)                                        as total_msgs,
    count(distinct ident)                           as user_count,
    count(*) filter (where d = (select t from today))              as today_count,
    count(*) filter (where d = (select t from today) - 1)          as yst_count,
    min(d)                                          as first_day
  from base
),
-- 14-day sparkline, zero-filled.
by_day as (
  select jsonb_agg(jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'), 'count', coalesce(x.n, 0)) order by g.d) as v
  from generate_series((select t from today) - 13, (select t from today), interval '1 day') g(d)
  left join (select d, count(*) n from base group by d) x on x.d = g.d::date
),
-- Volume trend. Spans earliest activity to today like before, floored at 90
-- days so the series can't grow without bound.
span as (
  select greatest(coalesce((select first_day from totals), (select t from today)),
                  (select t from today) - 89) as from_d,
         (select t from today) as to_d
),
daily as (
  select
    jsonb_agg(jsonb_build_object('date', to_char(g.d,'YYYY-MM-DD'), 'count', coalesce(x.n,0)) order by g.d) as volume
  from generate_series((select from_d from span), (select to_d from span), interval '1 day') g(d)
  left join (select d, count(*) n from base group by d) x on x.d = g.d::date
),
-- 7x24 weekday-by-hour matrix, fully populated so the client can index it directly.
heat_cells as (
  select g.dow, g.hr, coalesce(c.n, 0) as n
  from (select dw.dow, hh.hr from generate_series(0,6) dw(dow) cross join generate_series(0,23) hh(hr)) g
  left join (select dow, hr, count(*) n from base group by dow, hr) c on c.dow = g.dow and c.hr = g.hr
),
heat as (
  select jsonb_agg(r.row order by r.dow) as v
  from (select dow, jsonb_agg(n order by hr) as row from heat_cells group by dow) r
),
-- "Most asked" groups by the ANSWER, so paraphrases sharing one reply merge
-- into a single topic. Short answers are fallbacks and must not cluster
-- unrelated questions.
topq as (
  select jsonb_agg(jsonb_build_object(
           'text', rep, 'count', cnt, 'variants', variants, 'answer', a) order by cnt desc) as v
  from (
    select a,
           count(*)                              as cnt,
           count(distinct q)                     as variants,
           mode() within group (order by q)      as rep
    from base
    where length(a) >= 20 and length(q) >= 3
    group by a
    order by count(*) desc
    limit 8
  ) t
),
-- Ranked reps. `phone` is the roster number: once a rep is merged across
-- channels their identity is a uuid, so without this the rep card and the CSV
-- would have no number to show.
users as (
  select jsonb_agg(jsonb_build_object(
           'number', ident, 'name', nm, 'channel', ch, 'phone', ph,
           'count', cnt, 'lastActive', last_active, 'lastQuestion', last_q) order by cnt desc) as v
  from (
    select ident,
           count(*) as cnt,
           max(ts)  as last_active,
           (array_agg(nm order by ts desc) filter (where nullif(btrim(coalesce(nm,'')),'') is not null))[1] as nm,
           (array_agg(ch order by ts desc))[1] as ch,
           (array_agg(ph order by ts desc) filter (where ph is not null))[1] as ph,
           (array_agg(nullif(q,'') order by ts desc) filter (where nullif(q,'') is not null))[1] as last_q
    from base
    group by ident
    order by count(*) desc
    limit 500
  ) u
),
-- Top-5-by-volume reps, per day, over its own last-30 window (separate from
-- `span`, which floors at 90 -- a 5-line-times-90-day payload is needless
-- weight for a trend chart nobody reads back more than a month on).
trend_span as (
  select greatest(coalesce((select first_day from totals), (select t from today)),
                  (select t from today) - 29) as from_d,
         (select t from today) as to_d
),
top5 as (
  select ident,
         (array_agg(nm order by ts desc) filter (where nullif(btrim(coalesce(nm,'')),'') is not null))[1] as nm
  from base
  where d >= (select from_d from trend_span)
  group by ident
  order by count(*) desc
  limit 5
),
top_reps_daily as (
  select jsonb_agg(jsonb_build_object('date', to_char(g.d,'YYYY-MM-DD'), 'reps', reps.v) order by g.d) as v
  from generate_series((select from_d from trend_span), (select to_d from trend_span), interval '1 day') g(d)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
             'ident', t.ident, 'name', t.nm, 'count', coalesce(x.n, 0)) order by t.ident) as v
    from top5 t
    left join (select ident, d, count(*) n from base group by ident, d) x
      on x.ident = t.ident and x.d = g.d::date
  ) reps
),
-- True distinct-rep counts for two 30-day windows -- NOT a per-day array,
-- because summing a per-day distinct count double-counts a rep active on more
-- than one day.
active_reps as (
  select
    count(distinct ident) filter (where d >= (select t from today) - 29)                                   as last30,
    count(distinct ident) filter (where d >= (select t from today) - 59 and d < (select t from today) - 29) as prev30
  from base
)
select jsonb_build_object(
  'total_msgs',   (select total_msgs   from totals),
  'today_count',  (select today_count  from totals),
  'yst_count',    (select yst_count    from totals),
  'user_count',   (select user_count   from totals),
  'msgs_by_day',  coalesce((select v from by_day), '[]'::jsonb),
  'volume_daily', coalesce((select volume from daily), '[]'::jsonb),
  'heat',         coalesce((select v from heat), '[]'::jsonb),
  'top_questions',coalesce((select v from topq), '[]'::jsonb),
  'users',        coalesce((select v from users), '[]'::jsonb),
  'top_reps_daily',     coalesce((select v from top_reps_daily), '[]'::jsonb),
  'active_reps_last30', coalesce((select last30 from active_reps), 0),
  'active_reps_prev30', coalesce((select prev30 from active_reps), 0)
);
$$;

comment on function public.dashboard_stats(text) is
  'Dashboard aggregates computed server-side over the whole of chat_all. SECURITY INVOKER so chat_all RLS still applies. Reads resolved identity (ident/person_name/person_phone) from chat_all -- see db/2026-07-28-single-identity.sql. 2026-08-29: cache_hits/cache_misses/cache_daily removed -- the semantic cache was retired from the n8n workflows and the site no longer shows a hit rate.';

grant execute on function public.dashboard_stats(text) to authenticated;
revoke execute on function public.dashboard_stats(text) from anon;


-- ── 3. conversations_page, without from_cache ───────────────────────────────
create or replace function public.conversations_page(
  p_channel text default null,
  p_ident   text default null,
  p_search  text default null,
  p_answer  text default null,
  p_limit   int  default 25,
  p_offset  int  default 0
) returns jsonb
language sql
stable
set search_path to ''
as $$
with args as (
  select
    nullif(btrim(coalesce(p_channel,'')), '') as channel,
    nullif(btrim(coalesce(p_ident,'')),   '') as ident,
    nullif(btrim(coalesce(p_search,'')),  '') as search,
    nullif(p_answer, '')                      as answer,
    -- Clamped so a crafted call cannot ask for the whole table in one response.
    -- 2000 is the export ceiling; the UI itself asks for 25.
    least(greatest(coalesce(p_limit, 25), 1), 2000) as lim,
    greatest(coalesce(p_offset, 0), 0)              as off
),
f as (
  select c."Timestamp", c."Name", c."User_Message", c."AI_Response",
         c.channel, c.ident, c.person_phone
  from public.chat_all c, args a
  where (a.channel is null or c.channel = a.channel)
    and (a.ident   is null or c.ident   = a.ident)
    -- A topic drill has to reproduce the Most-asked panel EXACTLY, because the
    -- user clicked a number and expects that many rows. dashboard_stats()
    -- builds those groups with `where length(a) >= 20 and length(q) >= 3`, so
    -- the question-length rule has to be repeated here or the two disagree.
    --
    -- Conditional on a.answer deliberately: unfiltered, Conversations is an
    -- audit log and must still show every "hi" anyone ever sent. The rule
    -- belongs to topic grouping, not to browsing.
    and (a.answer is null or (
           btrim(coalesce(c."AI_Response", '')) = a.answer
       and length(btrim(coalesce(c."User_Message", ''))) >= 3
    ))
    and (a.search  is null
         or c."User_Message" ilike '%' || a.search || '%'
         or c."AI_Response"  ilike '%' || a.search || '%')
)
select jsonb_build_object(
  'total', (select count(*) from f),
  'rows', coalesce((
    select jsonb_agg(to_jsonb(t) order by t."Timestamp" desc)
    from (
      select f.* from f, args a
      order by f."Timestamp" desc
      limit (select lim from args) offset (select off from args)
    ) t
  ), '[]'::jsonb)
);
$$;

revoke all on function public.conversations_page(text,text,text,text,int,int) from public, anon;
grant execute on function public.conversations_page(text,text,text,text,int,int) to authenticated;


-- ── 4. report_bad_answer, without the purge and without p_from_cache ────────
-- The parameter LIST is shrinking (7 args -> 6), which CREATE OR REPLACE
-- cannot do -- Postgres treats a different argument list as a different
-- function, so the old one has to be dropped by its exact old signature first
-- or it survives alongside the new one and PostgREST has two candidates to
-- choose between.
drop function if exists public.report_bad_answer(text, timestamptz, text, text, boolean, text, text);

create function public.report_bad_answer(
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


-- ── 5. chat_feedback loses its cache columns ────────────────────────────────
alter table public.chat_feedback drop column if exists from_cache;
alter table public.chat_feedback drop column if exists cache_purged;


-- ── 6. semantic_cache and its capability function ───────────────────────────
-- Dropping the table takes its policies and grants with it. can_manage_cache()
-- gates nothing else -- confirmed by grep over every db/*.sql file, it only
-- ever appears on semantic_cache's own policies.
drop table if exists public.semantic_cache;
drop function if exists private.can_manage_cache();


-- ── 7. Verify ────────────────────────────────────────────────────────────────
select 'chat_all columns' as check,
       string_agg(column_name, ', ' order by ordinal_position) as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'chat_all'
union all
select 'chat_feedback columns',
       string_agg(column_name, ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and table_name = 'chat_feedback'
union all
select 'semantic_cache still exists?',
       case when to_regclass('public.semantic_cache') is null then 'no (dropped)' else 'YES -- drop failed' end
union all
select 'can_manage_cache() still exists?',
       case when to_regprocedure('private.can_manage_cache()') is null then 'no (dropped)' else 'YES -- drop failed' end
union all
select 'report_bad_answer arg count',
       pronargs::text from pg_proc where proname = 'report_bad_answer';
