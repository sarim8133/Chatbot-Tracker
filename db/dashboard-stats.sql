-- ============================================================================
-- Hi Tech dashboard — server-side analytics aggregates
-- ----------------------------------------------------------------------------
-- The dashboard used to fetch the 500 most recent rows of chat_all and derive
-- EVERY metric in the browser — Today, Active reps, Most asked, the heatmap, the
-- cache split, the 30-day trends. So `limit=500` was never a display cap, it was
-- the sample the analytics ran on. At ~30 messages/day the table crosses 500 in
-- about ten days, after which "Most asked" silently means "most asked in the last
-- fortnight" with nothing on screen saying so, and the numbers just drift wrong.
--
-- dashboard_stats() does the grouping in SQL over the WHOLE table instead:
--   payload   110 kB (growing) -> ~9.8 kB flat, whatever the row count
--   coverage  last 500 rows    -> every row, exact
--
-- Built and verified while the table was still UNDER 500 rows (192 on
-- 2026-07-23), which is the only window in which the new numbers can be checked
-- against the old ones — past the cap the old path is already wrong and there is
-- nothing to compare against. Verified: scalars match an independent
-- re-derivation; heat, volume and per-rep counts each sum to the exact row total;
-- web + whatsapp splits sum to the unfiltered total; a non-admin gets zeros and
-- anon cannot execute.
--
-- Two deliberate behaviour changes:
--   * Day/hour buckets are pinned to Asia/Karachi. The client bucketed in the
--     VIEWER's local timezone, so the same data showed different numbers
--     depending on where it was opened.
--   * The volume/cache trend spans earliest activity -> today as before, but is
--     floored at 90 days so the series cannot grow without bound.
--
-- SECURITY INVOKER is deliberate: chat_all is a security_invoker view over
-- admin-only tables, so RLS still applies and a non-admin gets empty aggregates
-- exactly as they get no rows today. No privilege escalation.
--
-- Applied 2026-07-23 via Supabase MCP migration `create_dashboard_stats_rpc`.
-- This file is the checked-in record; the live schema is the source of truth.
--
-- UPDATE 2026-07-28 (migration `dashboard_stats_reads_chat_all_identity`, NOT
-- previously recorded in this file -- see db/2026-07-28-single-identity.sql
-- for the full identity-unification story): `base` now reads ident/name/phone
-- straight off chat_all's already-resolved columns instead of re-deriving
-- identity inline. Re-deriving it here was the second half of the "one person
-- = two reps" bug -- WhatsApp rows keyed on phone, web rows on display name,
-- computed independently in this function AND in the client.
--
-- This gap in the file (a live migration never checked in here) is exactly
-- how a later change, `dashboard_stats_rep_trends` (2026-07-30), came to be
-- built from this stale checked-in copy instead of the live function and
-- briefly reintroduced the bug in production -- measured live: user_count 6
-- became 10, active_reps_last30 5 became 9, on the same test account, before
-- being caught by review and fixed same-session via migration
-- `fix_dashboard_stats_rep_trends_identity_regression`. The lesson, stated
-- plainly for whoever edits this function next: introspect the LIVE function
-- (`select pg_get_functiondef('public.dashboard_stats(text)'::regprocedure)`)
-- before writing a CREATE OR REPLACE, never trust this file's body to be
-- current on its own -- only the header comments and the "Applied via"
-- migration trail are guaranteed to be kept up to date going forward.
-- ============================================================================

create or replace function public.dashboard_stats(p_channel text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
-- Identity is resolved once, in the chat_all view, and read here. It used to be
-- computed in this function AND again in the client, which is how one person
-- ended up as two reps: WhatsApp rows keyed on the phone, web rows on the
-- display name. See db/2026-07-28-single-identity.sql.
--
-- SECURITY INVOKER is deliberate (db/dashboard-stats.sql:30): chat_all honours
-- the caller, so a non-admin gets no rows and therefore no company-wide stats.
with base as (
  select
    c."Timestamp"                                                        as ts,
    (c."Timestamp" at time zone 'Asia/Karachi')::date                    as d,
    extract(dow  from c."Timestamp" at time zone 'Asia/Karachi')::int    as dow,
    extract(hour from c."Timestamp" at time zone 'Asia/Karachi')::int    as hr,
    btrim(coalesce(c."User_Message", ''))                                as q,
    btrim(coalesce(c."AI_Response", ''))                                 as a,
    -- Roster name over the per-row one. c."Name" is free text written by
    -- whichever channel handled the message -- the JWT email local-part on web,
    -- the sender's own WhatsApp profile name on WhatsApp -- so for a rep who
    -- uses both, "most recent Name" would flip the label between 'smsarim6'
    -- and 'Sarim' depending on where they last spoke.
    coalesce(c.person_name, c."Name")                                    as nm,
    c.from_cache                                                         as cached,
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
    count(*) filter (where cached is true)          as cache_hits,
    count(*) filter (where cached is not true)      as cache_misses,
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
-- Volume + cache-rate trend. Spans earliest activity to today like the client did,
-- but floored at 90 days so the series can't grow without bound.
span as (
  select greatest(coalesce((select first_day from totals), (select t from today)),
                  (select t from today) - 89) as from_d,
         (select t from today) as to_d
),
daily as (
  select
    jsonb_agg(jsonb_build_object('date', to_char(g.d,'YYYY-MM-DD'), 'count', coalesce(x.n,0)) order by g.d) as volume,
    jsonb_agg(jsonb_build_object('date', to_char(g.d,'YYYY-MM-DD'), 'hits', coalesce(x.h,0),
                                 'total', coalesce(x.n,0),
                                 'rate', case when coalesce(x.n,0) > 0 then x.h::numeric / x.n else 0 end) order by g.d) as cache
  from generate_series((select from_d from span), (select to_d from span), interval '1 day') g(d)
  left join (select d, count(*) n, count(*) filter (where cached is true) h from base group by d) x on x.d = g.d::date
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
-- "Most asked" groups by the ANSWER, so paraphrases that hit one cache entry merge
-- into a single topic. Short answers are fallbacks and must not cluster unrelated
-- questions -- same >=20 char rule the client used.
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
-- Ranked reps. The client kept up to 50 messages each but only ever read the most
-- recent question, so only that is returned. `phone` is the roster number: once a
-- rep is merged across channels their identity is a uuid, so without this the
-- rep card and the CSV would have no number to show.
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
-- ── Added 2026-07-30: rep-activity-trend + period-comparison ────────────────
-- Top-5-by-volume reps, per day, over a SEPARATE 30-day window from `span`
-- (which floors at 90) -- a 5-line-times-90-day payload is needless weight for
-- a trend chart nobody reads back more than a month on.
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
  'cache_hits',   (select cache_hits   from totals),
  'cache_misses', (select cache_misses from totals),
  'msgs_by_day',  coalesce((select v from by_day), '[]'::jsonb),
  'volume_daily', coalesce((select volume from daily), '[]'::jsonb),
  'cache_daily',  coalesce((select cache  from daily), '[]'::jsonb),
  'heat',         coalesce((select v from heat), '[]'::jsonb),
  'top_questions',coalesce((select v from topq), '[]'::jsonb),
  'users',        coalesce((select v from users), '[]'::jsonb),
  'top_reps_daily',     coalesce((select v from top_reps_daily), '[]'::jsonb),
  'active_reps_last30', coalesce((select last30 from active_reps), 0),
  'active_reps_prev30', coalesce((select prev30 from active_reps), 0)
);
$$;

comment on function public.dashboard_stats(text) is
  'Dashboard aggregates computed server-side over the whole of chat_all. Replaces client-side derivation from a 500-row fetch, which silently turned every metric into "the last 500 messages". Day/hour buckets are Asia/Karachi. SECURITY INVOKER so chat_all RLS still applies. Reads resolved identity (ident/person_name/person_phone) from chat_all -- see db/2026-07-28-single-identity.sql. 2026-07-30: added top_reps_daily (rep-activity-trend, top 5 reps, last 30 days) and active_reps_last30/prev30 (true distinct-rep counts for period-comparison).';

grant execute on function public.dashboard_stats(text) to authenticated;
revoke execute on function public.dashboard_stats(text) from anon;

-- ============================================================================
-- 2026-07-30 — rep-activity-trend + active-rep window scalars
-- ----------------------------------------------------------------------------
-- Added two new keys, no existing key touched:
--   top_reps_daily      -- top-5-by-volume reps, per day, over their own last-30
--                           window (`trend_span`, separate from the 90-day-floored
--                           `span` the volume/cache trend uses -- a 5-line-times-
--                           90-day payload is needless weight for a trend chart
--                           nobody reads back more than a month on).
--   active_reps_last30  -- true count(distinct ident) over [today-29, today]
--   active_reps_prev30  -- true count(distinct ident) over [today-59, today-30)
--
-- Why active_reps is two scalars, not a per-day array: summing a per-day
-- distinct-count array across a 30-day window double-counts any rep active on
-- more than one day -- it sums "rep-days," not distinct reps in the window.
-- Each scalar here is a single count(distinct ident) over its whole window,
-- correct by construction.
--
-- Verified via Supabase MCP execute_sql, each check in its own rolled-back
-- transaction, impersonating real app_users rows:
--   * private.can_read_chats() baseline call executes without error.
--   * Dev account (role=dev): trend_days=30, reps_per_day=5, user_count=6,
--     active_reps_last30=5, active_reps_prev30=5 -- both <= user_count as
--     expected.
--   * Independent cross-check (raw count(distinct ident) over chat_all for the
--     last-30 window, computed outside dashboard_stats()) = 5, matching
--     active_reps_last30 exactly.
--   * CEO account (role=ceo, the OTHER role in can_read_chats()'s {dev,ceo}
--     set, and the one sharing this exact base/users code path with dev):
--     trend_days=30, reps_per_day=5, user_count=6, active_reps_last30=5,
--     active_reps_prev30=5, first_phone populated -- identical to the dev
--     account, as expected (same underlying rows, same identity resolution).
--     Added specifically because this is the code path that regressed once
--     already (see below) and dev alone doesn't prove ceo sees the same fix.
--   * Employee account (role=employee, gated to zero rows by
--     private.can_read_chats() inside chat_all's RLS): user_count=0,
--     active_reps_last30=0, active_reps_prev30=0, as expected.
--
-- REGRESSION, CAUGHT AND FIXED SAME SESSION: the first pass at this migration
-- (`dashboard_stats_rep_trends`) was built from this file's checked-in `base`/
-- `users` CTEs, which were stale -- they never picked up the 2026-07-28
-- identity-resolution fix (see the header note above this function). That
-- silently reintroduced the "one person = two reps" bug application-wide:
-- user_count measured 10 instead of 6, active_reps_last30 measured 9 instead
-- of 5, on the same dev test account, in the same rolled-back-transaction
-- pattern. Caught by the spec-compliance review (which introspected the live
-- function via pg_get_functiondef and diffed it against the true prior
-- version pulled from supabase_migrations.schema_migrations, rather than
-- trusting this file), fixed via a same-day follow-up migration
-- `fix_dashboard_stats_rep_trends_identity_regression` that restores the
-- correct base/users CTEs and keeps the 2026-07-30 additions unchanged. The
-- numbers recorded above are from the FIXED, currently-live function.
--
-- One planning assumption corrected by measurement: for an empty `base` (the
-- employee case, or any dev/ceo account with zero rows), top_reps_daily comes
-- back as a ONE-element array (today, reps: null), not an empty array. This
-- is not a bug in the new CTEs -- `trend_span` reuses the exact
-- greatest(coalesce(first_day, today), today - N) shape the pre-existing
-- `span` CTE already uses for volume_daily/cache_daily, and that CTE has the
-- identical property (confirmed: volume_daily also comes back length 1, not
-- 0, for the same empty-base employee call). coalesce(first_day, today) maps
-- a null first_day to today, and greatest(today, today-N) is today, so the
-- one-day generate_series is inherent to a pattern already live and verified
-- since 2026-07-23 -- not something this change introduced. Recorded here
-- rather than silently normalized because a future consumer of
-- top_reps_daily should not assume "empty base => empty array."
-- ============================================================================
