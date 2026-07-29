-- Server-side paging for the Conversations tab.
--
-- WHY THIS EXISTS
--
-- The tab used to fetch a batch of rows and then filter, count and slice them in
-- JavaScript. That works right up until the table outgrows the batch, and then it
-- fails in the least visible way possible: the array was truncated AFTER both
-- channels were merged and sorted by time, so the oldest rows fell off — and the
-- oldest rows were mostly archived WhatsApp traffic. The result was that the
-- "All" channel chip listed FEWER messages of each channel than that channel's
-- own chip did (55 WhatsApp under "WhatsApp", 44 of the same messages under
-- "All"). Nothing errored. The only symptom was a total that quietly disagreed
-- with itself.
--
-- Raising the cap only moves that cliff, so the count and the slice now happen in
-- one place, over the complete set, whatever the volume.
--
-- SECURITY INVOKER (the default) is load-bearing, exactly as in dashboard_stats:
-- chat_all is a security_invoker view over three tables that each restrict SELECT
-- to private.is_admin(), so a non-admin caller gets an empty page rather than a
-- page of everyone's conversations. Verified: as an employee, total = 0, rows = 0.
--
-- Applied via migration `conversations_page_rpc` on 2026-07-28.

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
         c.from_cache, c.channel, c.ident, c.person_phone
  from public.chat_all c, args a
  where (a.channel is null or c.channel = a.channel)
    and (a.ident   is null or c.ident   = a.ident)
    -- A topic drill has to reproduce the Most-asked panel EXACTLY, because the
    -- user clicked a number and expects that many rows. dashboard_stats() builds
    -- those groups with `where length(a) >= 20 and length(q) >= 3`, so the
    -- question-length rule has to be repeated here or the two disagree.
    --
    -- It disagreed: the top topic "hello" counted 5 in the panel and returned 12
    -- here, because six "hi" and one "ye" share that one cached greeting answer
    -- and are excluded from the count but not from the drill. The list opened on
    -- "hi, hi, Hi, ye, bro" — which reads as a filter that simply isn't working.
    --
    -- Conditional on a.answer deliberately: unfiltered, Conversations is an audit
    -- log and must still show every "hi" anyone ever sent. The rule belongs to
    -- topic grouping, not to browsing.
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

comment on function public.conversations_page(text,text,text,text,int,int) is
  'One filtered, counted page of chat_all for the Conversations tab. SECURITY INVOKER so chat_all RLS still applies — a non-admin gets nothing. When p_answer is set it mirrors dashboard_stats()''s topic-grouping rule (question >= 3 chars) so a Most-asked count and its drill agree.';


-- Verified as admin Sarim, 2026-07-28:
--
--   all                   total 337   page 25     <- 282 + 55, agrees with the chips
--   whatsapp              total  55   page 25
--   web                   total 282   page 25
--   ident = Sarim         total 193   page 25     <- matches his rep count exactly
--   search 'bottle'       total  35   page 25
--   offset 325            total 337   page 12     <- last page returns its remainder
--
-- As employee Asad: total 0, rows 0.
--
-- Re-verified 2026-07-29 after the topic-grouping fix (migration
-- `conversations_page_match_topic_grouping_rule`). Every one of the 8 Most-asked
-- topics now returns exactly the count the panel shows, measured both over this
-- connection and impersonating admin Sarim:
--
--   hello 5=5   rotary 4=4   blow 3=3   yhe gen 5 2=2   250 ton tederic 2=2
--   neo dt dd 2=2   Rotary machines 2=2   pvc pipe 2=2
--
-- Browsing is unchanged: unfiltered 384 = every row in chat_all, whatsapp 97 +
-- web 287 = 384, and all 13 sub-3-character questions are still listed. Employee
-- Asad still gets 0. Grants survived the replace (authenticated=X, no anon) and
-- prosecdef is still false.
--
-- NOTE ON SEARCH: p_search goes into ILIKE unescaped, so a literal % or _ typed
-- into the search box acts as a wildcard. That is a search box behaving slightly
-- generously, not an injection risk -- the value is a bound parameter, never
-- concatenated into SQL text.
