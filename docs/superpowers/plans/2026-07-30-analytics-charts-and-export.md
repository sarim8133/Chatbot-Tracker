# Analytics Charts + Non-Technical Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five CEO-facing analytics charts (rep activity trend + period comparison on Overview;
spend comparison + approval turnaround + status split on Expenses), a per-tab PDF + Excel export, and
fix the pre-existing chart axis-label overflow bug the new trend charts would otherwise inherit.

**Architecture:** One additive SQL migration (`dashboard_stats()` gains two new keys) feeds two new
Overview charts; the three new Expense charts need zero backend change — `wap_expenses` rows are
already fetched client-side. A new `src/xlsx.js` hand-rolls a minimal `.xlsx` writer (reusing the
existing zip writer in `export.js`, same rationale: avoid a dependency for something this small). A
`@media print` stylesheet plus `window.print()` gives the PDF path.

**Tech Stack:** React 19, Recharts 3, Supabase (Postgres + PostgREST + Supabase MCP for migrations),
Tailwind v4. No test runner exists in this repo — verification is manual/impersonation-based,
matching every other `db/*.sql` migration and UI change already in this codebase.

**Spec:** `docs/superpowers/specs/2026-07-30-analytics-charts-and-export-design.md`

---

## Correction made during planning (read before Task 2)

The spec's data-layer section described an `active_reps_daily` per-day array for the Overview
period-comparison. Working out the exact math: summing a *distinct-count-per-day* array across a
30-day window overcounts any rep active on more than one day (it sums "rep-days," not distinct reps
in the window). The fix used below replaces that with two **direct SQL scalars** —
`active_reps_last30` / `active_reps_prev30`, each a true `count(distinct ident)` over its window —
which is both simpler and correct by construction. Messages and hit-rate deltas are unaffected: daily
message counts and daily cache hit/total pairs both sum correctly across days, so those still derive
client-side from the existing `volume_daily`/`cache_daily` arrays exactly as the spec described.

Also, re-reading `ExpensesTab`'s real code (mawavia-dashboard.jsx:4122-4131): it already computes a
`trend` array of `{month, label, total}` from a month-based UI (there's a `Month` dropdown, not a
rolling 30-day window). So "spend period-over-period" is implemented as **this month vs last month**,
read directly off the existing `trend` array — not a new 30-day computation. This matches the mockup
text shown during brainstorming ("vs last month") and is simpler than what the spec's summary table
literally said ("30-day boundary").

---

## Task 1: Fix the chart axis-overflow bug (all three existing trend charts)

**Files:**
- Modify: `src/charts.jsx` (three chart components: `ChartsRow`'s volume chart ~line 146-165,
  `HitRateTrend` ~line 285-309, `SpendTrend` ~line 439-460)

The bug: a negative left margin drags the plot area left until the first X-axis tick collides with
the Y-axis's `0` label, and `HitRateTrend`'s `interval="preserveStartEnd"` forces uneven tick spacing.
Fix, applied identically to all three: replace the negative margin with a small positive one, add
`padding` on the X-axis, and standardize on an evenly-spaced tick interval computed from data length.

- [ ] **Step 1: Fix `ChartsRow`'s volume chart**

In `src/charts.jsx`, find `mkVolume` (around line 146-165). Change:

```jsx
      <AreaChart data={view} margin={{top:6,right:6,bottom:0,left:-20}}>
```
to:
```jsx
      <AreaChart data={view} margin={{top:6,right:6,bottom:0,left:4}}>
```

And change:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={16}/>
```
to:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={16} padding={{left:12,right:12}}/>
```

- [ ] **Step 2: Fix `HitRateTrend`**

In `src/charts.jsx`, find `HitRateTrend` (around line 285-309). Inside the component body, right after
`const c = useThemeColors();`, add:

```jsx
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);
```

Change:
```jsx
      <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:-12}}>
```
to:
```jsx
      <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:4}}>
```

Change:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24}/>
```
to:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={24} padding={{left:12,right:12}}/>
```

- [ ] **Step 3: Fix `SpendTrend`**

In `src/charts.jsx`, find `SpendTrend` (around line 439-460). Inside the component body, right after
`const c = useThemeColors();`, add:

```jsx
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);
```

Change:
```jsx
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -6 }}>
```
to:
```jsx
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
```

Change:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} minTickGap={20} />
```
to:
```jsx
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={20} padding={{left:12,right:12}} />
```

- [ ] **Step 4: Visual verification**

Run: `npm run dev`

Sign in, open Overview (message volume chart) and Cache (hit-rate trend) tabs at 1280px width, then
resize to 375px (phone). Confirm no tick label overlaps the Y-axis `0`/percentage label at either
width, in both light and dark theme (toggle via the theme icon in the header). Open Expenses and check
the "Monthly spend trend" panel the same way.

- [ ] **Step 5: Commit**

```bash
git add src/charts.jsx
git commit -m "fix(charts): trend-chart X-axis ticks were colliding with the Y-axis"
```

---

## Task 2: Extend `dashboard_stats()` — rep activity trend + active-rep windows

**Files:**
- Modify: `db/dashboard-stats.sql` (append new section documenting the extension, matching this
  repo's existing pattern of recording every migration inline)
- Apply via: Supabase MCP `apply_migration`

- [ ] **Step 1: Write the new CREATE OR REPLACE FUNCTION**

The full function body, unchanged parts kept byte-identical to what's live today, with two additions:
a `trend_span`/`top5`/`top_reps_daily` CTE chain (rep-activity-trend, top 5 reps by volume, last 30
days) and an `active_reps` CTE (true distinct-rep counts for the two comparison windows — see the
correction note at the top of this plan for why these are scalars, not a per-day array).

```sql
create or replace function public.dashboard_stats(p_channel text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with base as (
  select
    c."Timestamp"                                                        as ts,
    (c."Timestamp" at time zone 'Asia/Karachi')::date                    as d,
    extract(dow  from c."Timestamp" at time zone 'Asia/Karachi')::int    as dow,
    extract(hour from c."Timestamp" at time zone 'Asia/Karachi')::int    as hr,
    btrim(coalesce(c."User_Message", ''))                                as q,
    btrim(coalesce(c."AI_Response", ''))                                 as a,
    c."Name"                                                             as nm,
    c.from_cache                                                         as cached,
    c.channel                                                            as ch,
    case when c.channel = 'web' or c."User_Number" is null
         then 'web:' || coalesce(nullif(btrim(c."Name"), ''), 'Website user')
         else c."User_Number"::text
    end                                                                  as ident
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
by_day as (
  select jsonb_agg(jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'), 'count', coalesce(x.n, 0)) order by g.d) as v
  from generate_series((select t from today) - 13, (select t from today), interval '1 day') g(d)
  left join (select d, count(*) n from base group by d) x on x.d = g.d::date
),
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
heat_cells as (
  select g.dow, g.hr, coalesce(c.n, 0) as n
  from (select dw.dow, hh.hr from generate_series(0,6) dw(dow) cross join generate_series(0,23) hh(hr)) g
  left join (select dow, hr, count(*) n from base group by dow, hr) c on c.dow = g.dow and c.hr = g.hr
),
heat as (
  select jsonb_agg(r.row order by r.dow) as v
  from (select dow, jsonb_agg(n order by hr) as row from heat_cells group by dow) r
),
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
users as (
  select jsonb_agg(jsonb_build_object(
           'number', ident, 'name', nm, 'channel', ch,
           'count', cnt, 'lastActive', last_active, 'lastQuestion', last_q) order by cnt desc) as v
  from (
    select ident,
           count(*) as cnt,
           max(ts)  as last_active,
           (array_agg(nm order by ts desc) filter (where nullif(btrim(coalesce(nm,'')),'') is not null))[1] as nm,
           (array_agg(ch order by ts desc))[1] as ch,
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
-- than one day. See this plan's "Correction made during planning" note.
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
  'Dashboard aggregates computed server-side over the whole of chat_all. Replaces client-side derivation from a 500-row fetch, which silently turned every metric into "the last 500 messages". Day/hour buckets are Asia/Karachi. SECURITY INVOKER so chat_all RLS still applies. 2026-07-30: added top_reps_daily (rep-activity-trend, top 5 reps, last 30 days) and active_reps_last30/prev30 (true distinct-rep counts for period-comparison).';

grant execute on function public.dashboard_stats(text) to authenticated;
revoke execute on function public.dashboard_stats(text) from anon;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `mcp__supabase__apply_migration` with `name: "dashboard_stats_rep_trends"` and the full SQL from
Step 1 as `query`.

- [ ] **Step 3: Verify — baseline + new-field impersonation**

Run via `mcp__supabase__execute_sql`, each inside its own rolled-back transaction, matching this
repo's standing verification style (see `db/roles-and-approvals.sql`'s own Verification sections for
the pattern):

```sql
begin;
  select private.can_read_chats();  -- sanity: exists and callable by the session running this
rollback;
```

Then, for a **dev** account's real user_id (find one via `select user_id, role from app_users where
role in ('dev','ceo','employee') limit 3;`), run inside a rolled-back transaction:

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<dev-user-id>","role":"authenticated"}';
  select
    jsonb_array_length(dashboard_stats()->'top_reps_daily')       as trend_days,
    dashboard_stats()->'active_reps_last30'                       as ar_last30,
    dashboard_stats()->'active_reps_prev30'                       as ar_prev30,
    jsonb_array_length((dashboard_stats()->'top_reps_daily'->0->'reps')) as reps_per_day;
rollback;
```

Expected: `trend_days` = 30 (or fewer if the account is younger than 30 days — must equal
`least(30, days since first_day)`), `reps_per_day` <= 5, `ar_last30`/`ar_prev30` are non-negative
integers no larger than `user_count` from the same call.

Repeat with an **employee** user_id — expected: `trend_days` = 0 (empty array, since `can_read_chats()`
already gates the whole function to dev/ceo and an employee's `base` CTE resolves to zero rows),
`ar_last30`/`ar_prev30` = 0.

- [ ] **Step 4: Verify — independent cross-check**

Inside a rolled-back transaction impersonating a dev, confirm `active_reps_last30` matches an
independent re-derivation:

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<dev-user-id>","role":"authenticated"}';
  select count(distinct case when c."User_Number" is not null then c."User_Number"::text
                              else 'web:' || coalesce(nullif(btrim(c."Name"),''),'Website user') end)
  from public.chat_all c
  where (c."Timestamp" at time zone 'Asia/Karachi')::date >= (now() at time zone 'Asia/Karachi')::date - 29;
rollback;
```

This must equal the `active_reps_last30` value from Step 3. If it doesn't, stop and re-check the CTE
before proceeding — do not paper over a mismatch.

- [ ] **Step 5: Record the migration in the SQL file**

Append a new dated section to `db/dashboard-stats.sql` (after the existing `grant`/`revoke` lines at
the bottom) documenting what changed, why (this plan's correction note, condensed), and the
verification numbers actually observed in Steps 3-4 — matching the file's existing documentation
style (see the big comment block at the top of that file for the tone/format to match).

- [ ] **Step 6: Commit**

```bash
git add db/dashboard-stats.sql
git commit -m "feat(dashboard): add rep-activity-trend + active-rep window scalars to dashboard_stats()"
```

---

## Task 3: Wire the new fields into `useData()` and `demoStats()`

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (`useData()` ~line 296-306, `demoStats()` ~line 148-199)

- [ ] **Step 1: Add to `useData()`'s `setStats` call**

Find (around line 296-306):

```jsx
      const withLabels = (arr) => (arr||[]).map(d => ({...d, label: labelFromKey(d.date)}));
      setStats({
        totalMsgs, todayCount: agg?.today_count ?? 0, ystCount: agg?.yst_count ?? 0,
        userCount: agg?.user_count ?? 0, cacheTotal:c.total||cache.length,
        msgsByDay: agg?.msgs_by_day || [],
        users, topQ, maxQ:topQ[0]?.count||1, recent:msgs, cacheEntries:cache,
        heat: agg?.heat || null,
        volumeDaily: withLabels(agg?.volume_daily), cacheDaily: withLabels(agg?.cache_daily),
        badResponses: fb.data,
        cacheHits, cacheMisses, hitRate: totalMsgs ? cacheHits/totalMsgs : 0,
      });
```

Replace with:

```jsx
      const withLabels = (arr) => (arr||[]).map(d => ({...d, label: labelFromKey(d.date)}));
      setStats({
        totalMsgs, todayCount: agg?.today_count ?? 0, ystCount: agg?.yst_count ?? 0,
        userCount: agg?.user_count ?? 0, cacheTotal:c.total||cache.length,
        msgsByDay: agg?.msgs_by_day || [],
        users, topQ, maxQ:topQ[0]?.count||1, recent:msgs, cacheEntries:cache,
        heat: agg?.heat || null,
        volumeDaily: withLabels(agg?.volume_daily), cacheDaily: withLabels(agg?.cache_daily),
        badResponses: fb.data,
        cacheHits, cacheMisses, hitRate: totalMsgs ? cacheHits/totalMsgs : 0,
        topRepsDaily: withLabels(agg?.top_reps_daily),
        activeRepsLast30: agg?.active_reps_last30 ?? 0,
        activeRepsPrev30: agg?.active_reps_prev30 ?? 0,
      });
```

(`withLabels` already adds `.label` to any `{date, ...}` array — `top_reps_daily` rows carry `date`,
so it works unchanged.)

- [ ] **Step 2: Add synthetic data to `demoStats()`**

Find the end of `demoStats()` (around line 183-199, right after `cacheDaily` is built and before the
`badResponses` array). Insert:

```jsx
  // Rep-activity-trend + period-comparison demo data. Names are inline (not a
  // module-level helper) — demoStats() is the only place that needs them.
  const demoRepNames = ['Ahsan','Bilal','Usman','Zain','Hamza'];
  const topRepsDaily = volumeDaily.map(v => ({
    date: v.date, label: v.label,
    reps: users.slice(0,5).map((u,i) => ({
      ident: u.number, name: demoRepNames[i] || 'Rep',
      count: Math.round(Math.random() * (u.count / 20)),
    })),
  }));
```

- [ ] **Step 3: Add the two new scalars and return them**

Find the `return {...}` at the end of `demoStats()` (around line 199):

```jsx
  return {totalMsgs:1247,todayCount:31,ystCount:24,userCount:users.length,cacheTotal:84,msgsByDay,users,topQ,maxQ:topQ[0].count,recent,cacheEntries,heat,volumeDaily,cacheDaily,badResponses,cacheHits,cacheMisses,hitRate};
```

Replace with:

```jsx
  return {totalMsgs:1247,todayCount:31,ystCount:24,userCount:users.length,cacheTotal:84,msgsByDay,users,topQ,maxQ:topQ[0].count,recent,cacheEntries,heat,volumeDaily,cacheDaily,badResponses,cacheHits,cacheMisses,hitRate,topRepsDaily,activeRepsLast30:18,activeRepsPrev30:15};
```

- [ ] **Step 4: Verify**

Run: `npm run dev`. Sign out (or use an unconfigured Supabase env) so the app falls into demo mode, or
add a temporary `console.log(stats.topRepsDaily, stats.activeRepsLast30)` inside `useData`'s `load` to
confirm both real and demo paths populate the new fields without throwing. Remove the temporary log
before committing.

- [ ] **Step 5: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(dashboard): wire rep-activity-trend + active-rep fields into useData/demoStats"
```

---

## Task 4: Shared period-comparison stat components

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (add right after the existing `Delta` component, ~line 583)

- [ ] **Step 1: Add `PctDelta`, `PpDelta`, and `PeriodCompare`**

Find the end of the `Delta` component (around line 583, right before `// Circular avatar...` /
`const Tag = ...`). Insert after it:

```jsx
// Percentage delta for period-over-period comparisons (vs `Delta` above, which
// shows an absolute count difference like "today vs yesterday"). previous=0
// has no meaningful % change, so it reads "new" instead of dividing by zero.
const PctDelta = ({current, previous}) => {
  if (previous === 0) {
    return current > 0
      ? <span className="mono text-[11px] font-semibold" style={{color:POS}}>new</span>
      : <span className="mono text-[11px] font-semibold text-zinc-400">flat</span>;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="mono text-[11px] font-semibold text-zinc-400">flat</span>;
  const up = pct > 0;
  return (
    <span className="inline-flex items-center gap-0.5 mono text-[11px] font-semibold" style={{color: up ? POS : NEG}}>
      <span className="text-[9px]">{up ? '▲' : '▼'}</span>{Math.abs(pct)}%
    </span>
  );
};

// Percentage-POINT delta — for rate metrics (e.g. cache hit rate) where a
// relative % change of a percentage reads as confusing next to the value
// itself. `current`/`previous` are 0-1 fractions.
const PpDelta = ({current, previous}) => {
  const pp = Math.round((current - previous) * 100);
  if (pp === 0) return <span className="mono text-[11px] font-semibold text-zinc-400">flat</span>;
  const up = pp > 0;
  return (
    <span className="inline-flex items-center gap-0.5 mono text-[11px] font-semibold" style={{color: up ? POS : NEG}}>
      <span className="text-[9px]">{up ? '▲' : '▼'}</span>{Math.abs(pp)}pp
    </span>
  );
};

// Period-over-period stat row — "this window vs the one before it". Shared by
// Overview (messages/active reps/hit rate) and Expenses (spend), so the visual
// language and delta math live in exactly one place. `metrics`:
// [{label, current, previous, format(v), hint, kind:'pct'|'pp'}].
//
// The grid-cols class is written as an explicit ternary, NOT
// `sm:grid-cols-${metrics.length}` — Tailwind v4 scans source text
// statically (the same trap already documented at OverviewTab's KPI ledger
// panel, ~line 797), so a class built by runtime interpolation never reaches
// the compiled stylesheet. This covers every call site in this plan (Overview
// passes 3 metrics, Expenses passes 1).
function PeriodCompare({ sub, metrics }) {
  return (
    <Panel className={`grid grid-cols-1 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 overflow-hidden ${
      metrics.length >= 3 ? 'sm:grid-cols-3' : metrics.length === 2 ? 'sm:grid-cols-2' : ''}`}>
      {metrics.map(m => (
        <div key={m.label} className="p-6 flex flex-col justify-between gap-6">
          <span className="flex items-center gap-1">
            <Label>{m.label}</Label>
            {m.hint && <HintIcon text={m.hint}/>}
          </span>
          <div>
            <span className="mono text-[26px] leading-none font-bold tracking-tight text-zinc-900">
              {m.format ? m.format(m.current) : m.current.toLocaleString()}
            </span>
            <div className="mt-2 flex items-center gap-2">
              {m.kind === 'pp'
                ? <PpDelta current={m.current} previous={m.previous}/>
                : <PctDelta current={m.current} previous={m.previous}/>}
              <span className="text-[11px] text-zinc-400">vs {sub}</span>
            </div>
          </div>
        </div>
      ))}
    </Panel>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`. Expected: no errors. (Nothing calls `PeriodCompare` yet — this step only proves
the new code is syntactically valid and Tailwind's static scan still finds the literal classes.)

- [ ] **Step 3: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(dashboard): add PctDelta/PpDelta/PeriodCompare shared stat components"
```

---

## Task 5: `RepActivityTrend` chart component

**Files:**
- Modify: `src/charts.jsx` (imports at top; new component after `HitRateTrend`, ~line 336)

- [ ] **Step 1: Add `LineChart`/`Line` to the recharts import**

Find:
```jsx
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  PieChart, Pie,
} from 'recharts';
```
Replace with:
```jsx
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  PieChart, Pie,
} from 'recharts';
```

- [ ] **Step 2: Add `RepActivityTrend` right after `HitRateTrend`**

Find the end of `HitRateTrend` (the closing `}` right before `// ── Expenses tab charts...` comment,
around line 336). Insert after it:

```jsx
// ── Rep activity trend (Overview tab, lazily loaded) ──────────────────────────
const RepTrendTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-1">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-1.5 text-[12px]">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{background:p.stroke}}/>
          <span className="text-zinc-700">{p.name}</span>
          <span className="mono font-semibold text-zinc-900 ml-auto">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

const RepLegend = ({ reps, palette }) => (
  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
    {reps.map((r,i) => (
      <span key={r.ident} className="flex items-center gap-1.5 text-[11px] text-zinc-600">
        <span className="w-2 h-2 rounded-sm shrink-0" style={{background:palette[i % palette.length]}}/>
        {r.name}
      </span>
    ))}
  </div>
);

// One line per rep — the top 5 by volume, from dashboard_stats()'s
// top_reps_daily (db/dashboard-stats.sql). Never color-alone (the codebase's
// relief rule, see src/categories.js): every line is also named in the legend.
export function RepActivityTrend({ data = [] }) {
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const palette = [c.accent, c.ink, c.blue, c.pos, c.neg];

  // Pivot [{date,label,reps:[{ident,name,count}]}] into one row per day with
  // one column per rep — the shape Recharts' multi-<Line> wants.
  const { rows, reps } = useMemo(() => {
    const names = new Map();
    for (const day of data) for (const r of day.reps || []) names.set(r.ident, r.name || r.ident);
    const reps = [...names.entries()].map(([ident, name]) => ({ ident, name }));
    const rows = data.map(day => {
      const row = { label: day.label };
      for (const r of day.reps || []) row[r.ident] = r.count;
      return row;
    });
    return { rows, reps };
  }, [data]);

  const tickEvery = Math.max(0, Math.ceil(rows.length/8)-1);

  const mkChart = () => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{top:6,right:6,bottom:0,left:4}}>
        <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false}
          interval={tickEvery} minTickGap={16} padding={{left:12,right:12}}/>
        <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={30} allowDecimals={false}/>
        <Tooltip content={<RepTrendTip/>}/>
        {reps.map((r,i)=>(
          <Line key={r.ident} type="monotone" dataKey={r.ident} name={r.name}
            stroke={palette[i % palette.length]} strokeWidth={2} dot={false}
            activeDot={{r:4, stroke:c.surface, strokeWidth:2}}/>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="relative">
        <button onClick={()=>setExpanded(true)} aria-label="Expand chart" title="Click to expand"
          className="no-print absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Maximize2 size={14}/>
        </button>
        <div className="h-56" role="img" aria-label="Message volume per day for the top 5 reps, last 30 days">
          {mkChart()}
        </div>
        <RepLegend reps={reps} palette={palette}/>
      </div>
      <ChartModal title="Rep activity" sub="Message volume per day, top 5 reps, last 30 days"
        open={expanded} onClose={()=>setExpanded(false)}>
        {mkChart()}
        <RepLegend reps={reps} palette={palette}/>
      </ChartModal>
    </>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`. Expected: no errors. `RepActivityTrend` is exported but unused until Task 6 —
that's fine, this step only proves it's valid.

- [ ] **Step 4: Commit**

```bash
git add src/charts.jsx
git commit -m "feat(charts): add RepActivityTrend (top-5-rep multi-line trend)"
```

---

## Task 6: Wire `PeriodCompare` + `RepActivityTrend` into `OverviewTab`

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (lazy-import declarations ~line 69-72; `OverviewTab` ~line
  774-997)

- [ ] **Step 1: Add the lazy import**

Find (around line 71):
```jsx
const HitRateTrend = lazy(() => import('./charts').then(m=>({default:m.HitRateTrend})));
```
Add right after it:
```jsx
const RepActivityTrend = lazy(() => import('./charts').then(m=>({default:m.RepActivityTrend})));
```

- [ ] **Step 2: Compute `periodMetrics` inside `OverviewTab`**

Find the start of `OverviewTab` (around line 774-778):
```jsx
function OverviewTab({s, onDrill, showCache}) {
  const delta  = s.todayCount - s.ystCount;
  const total  = useCountUp(s.totalMsgs);
  const peak   = heatPeak(s.heat);
  const [heatExpanded, setHeatExpanded] = useState(false);
```

Add right after `const [heatExpanded, setHeatExpanded] = useState(false);`:

```jsx
  // "This 30 days vs the 30 before" — messages/hit-rate sum correctly across
  // days from the existing 90-day arrays; active reps is a true distinct count
  // computed server-side (see db/dashboard-stats.sql — summing a per-day
  // distinct count would double-count a rep active on more than one day).
  const periodMetrics = useMemo(() => {
    const vol = s.volumeDaily || [];
    const cd  = s.cacheDaily  || [];
    const n = vol.length;
    const sumCount = (arr, from, to) => arr.slice(Math.max(0,from), Math.max(0,to)).reduce((a,b)=>a+(b.count??0),0);
    const curMsgs  = sumCount(vol, n-30, n);
    const prevMsgs = sumCount(vol, n-60, n-30);
    const cdSlice = (from,to) => cd.slice(Math.max(0,from), Math.max(0,to));
    const rateOf = (rows) => {
      const hits  = rows.reduce((a,r)=>a+(r.hits??0),0);
      const total = rows.reduce((a,r)=>a+(r.total??0),0);
      return total ? hits/total : 0;
    };
    const curRate  = rateOf(cdSlice(n-30, n));
    const prevRate = rateOf(cdSlice(n-60, n-30));
    return [
      {label:'Messages', kind:'pct', current:curMsgs, previous:prevMsgs,
        format:v=>v.toLocaleString(), hint:'Total messages, this 30 days vs the 30 before'},
      {label:'Active reps', kind:'pct', current:s.activeRepsLast30??0, previous:s.activeRepsPrev30??0,
        format:v=>v.toLocaleString(), hint:'Distinct reps who messaged Hi Tech AI, this 30 days vs the 30 before'},
      {label:'Hit rate', kind:'pp', current:curRate, previous:prevRate,
        format:v=>`${Math.round(v*100)}%`, hint:'Cache hit rate, this 30 days vs the 30 before'},
    ];
  }, [s.volumeDaily, s.cacheDaily, s.activeRepsLast30, s.activeRepsPrev30]);
```

- [ ] **Step 3: Render `PeriodCompare` and `RepActivityTrend`**

Find the end of the KPI readout `<Panel>` in `OverviewTab` (the `</Panel>` right before the `{/* Charts
row */}` comment, around line 835-838):

```jsx
      </Panel>

      {/* Charts row — lazy-loaded (Recharts in its own async chunk) */}
      <Suspense fallback={<ChartsFallback/>}>
        <ChartsRow
          volumeDaily={s.volumeDaily}
          topReps={s.users.slice(0,5).map(u=>({name:repName(u.number).split(' ')[0],count:u.count}))}
        />
      </Suspense>
```

Replace with:

```jsx
      </Panel>

      <PeriodCompare sub="the previous 30 days" metrics={periodMetrics}/>

      {/* Charts row — lazy-loaded (Recharts in its own async chunk) */}
      <Suspense fallback={<ChartsFallback/>}>
        <ChartsRow
          volumeDaily={s.volumeDaily}
          topReps={s.users.slice(0,5).map(u=>({name:repName(u.number).split(' ')[0],count:u.count}))}
        />
      </Suspense>

      {s.topRepsDaily?.length > 0 && (
        <Panel className="p-6">
          <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Rep activity</h2>
          <p className="text-[14px] text-zinc-500 mt-1 mb-5">Top 5 reps by volume, last 30 days</p>
          <HelpNote>Daily message count for the 5 busiest reps this month — is activity concentrated in a few people or spread out?</HelpNote>
          <Suspense fallback={<div className="h-56 rounded bg-zinc-50 animate-pulse"/>}>
            <RepActivityTrend data={s.topRepsDaily}/>
          </Suspense>
        </Panel>
      )}
```

- [ ] **Step 4: Verify**

Run: `npm run dev`. Sign in as a dev/ceo account, open Overview. Confirm: a 3-cell "period comparison"
row appears above the volume/reps charts with a `%`/`pp` delta on each cell; a "Rep activity" panel
appears below the charts row with up to 5 colored lines and a legend naming each rep. Resize to 375px
and confirm the period-comparison cells stack (not overflow) and the rep-trend legend wraps instead of
overflowing horizontally.

- [ ] **Step 5: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(overview): show period-over-period comparison + rep activity trend"
```

---

## Task 7: Expense derivations (spend comparison, approval turnaround, status split)

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (inside `ExpensesTab`, after the existing `trend` useMemo ~line
  4122-4131)

- [ ] **Step 1: Add the three new `useMemo`s**

Find the end of the `trend` useMemo in `ExpensesTab` (around line 4122-4131):

```jsx
  const trend = useMemo(() => {
    if (!rows) return [];
    const scope = byCat(toShareRows(
      rows.filter(r => dept === 'all' || r.department === dept),
      splitsByExpense,
    ).filter(r => !selEmp || personKey(r) === selEmp));
    const m = {};
    scope.forEach(r => { const k = (r.processed_at || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + r.amount; });
    return Object.keys(m).sort().map(k => ({ month: k, label: monthLabel(k), total: m[k] }));
  }, [rows, dept, selEmp, splitsByExpense, byCat]);
```

Add right after it:

```jsx
  // "This month vs last month" — read straight off `trend` (already one entry
  // per month, ascending) rather than a separate computation.
  const spendCompareMetrics = useMemo(() => {
    const idx = trend.findIndex(t => t.month === month);
    const cur  = idx >= 0 ? trend[idx].total : 0;
    const prev = idx > 0 ? trend[idx - 1].total : 0;
    return [{
      label: isEmployee ? 'Your spend' : 'Total spend', kind: 'pct', current: cur, previous: prev,
      format: fmtPKR, hint: `Total spend, ${monthLabel(month)} vs the month before`,
    }];
  }, [trend, month, isEmployee]);

  // Approval turnaround: days from submission to approval, for APPROVED
  // receipts only. approved_at/processed_at both live on wap_expenses already
  // (no new fetch). A time-to-reject variant would need wap_expense_events'
  // reject-kind row, which isn't bulk-fetched here — out of scope, see design
  // spec 2026-07-30 §2.
  const approvalTurnaround = useMemo(() => {
    if (!rows) return [];
    const m = {};
    for (const r of rows) {
      if (r.status !== 'approved' || !r.approved_at || !r.processed_at) continue;
      const days = (new Date(r.approved_at) - new Date(r.processed_at)) / 86400000;
      const k = (r.processed_at || '').slice(0, 7);
      if (!k) continue;
      if (!m[k]) m[k] = { sum: 0, n: 0 };
      m[k].sum += days; m[k].n += 1;
    }
    return Object.keys(m).sort().map(k => ({ month: k, label: monthLabel(k), days: m[k].sum / m[k].n }));
  }, [rows]);

  // Status distribution across ALL receipts (not scoped to one month — this
  // answers "how are we doing overall", not a monthly question). `flagged` is
  // a separate boolean column, not a status value, so it's a percentage
  // alongside the bar rather than a fifth bucket.
  const statusSplit = useMemo(() => {
    if (!rows) return null;
    const counts = { logged: 0, pending_approval: 0, approved: 0, rejected: 0 };
    let flaggedCount = 0;
    for (const r of rows) {
      if (counts[r.status] != null) counts[r.status]++;
      if (r.flagged) flaggedCount++;
    }
    const total = rows.length;
    return { counts, total, flaggedPct: total ? Math.round((flaggedCount / total) * 100) : 0 };
  }, [rows]);
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`. Expected: no errors (these three values are unused until Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(expenses): derive spend comparison, approval turnaround, status split"
```

---

## Task 8: `ApprovalTurnaround` chart component

**Files:**
- Modify: `src/charts.jsx` (new component after `SpendTrend`, ~line 460)

- [ ] **Step 1: Add `ApprovalTurnaround`**

Find the end of `SpendTrend` (the closing `}` right before the `// Panel header with an enlarge
button...` comment, around line 460). Insert after it:

```jsx
const DaysTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold text-zinc-900">{payload[0].value.toFixed(1)} days</p>
    </div>
  );
};

// Average days from submission (processed_at) to approval (approved_at), by
// month. Approved receipts only — see ExpensesTab's approvalTurnaround useMemo
// for why (mawavia-dashboard.jsx).
export function ApprovalTurnaround({ data = [] }) {
  const uid = useId();
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);

  const mkChart = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:4}}>
        <defs>
          <linearGradient id={`${uid}at${sfx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.accent} stopOpacity={0.14}/>
            <stop offset="100%" stopColor={c.accent} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={16} padding={{left:12,right:12}}/>
        <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={34} allowDecimals={false} tickFormatter={v=>`${v}d`}/>
        <Tooltip content={<DaysTip/>} cursor={{stroke:c.ink,strokeWidth:1,strokeDasharray:'3 3'}}/>
        <Area type="monotone" dataKey="days" stroke={c.accent} strokeWidth={2}
          fill={`url(#${uid}at${sfx})`} dot={false}
          activeDot={{r:4,fill:c.accent,stroke:c.surface,strokeWidth:2}}/>
      </AreaChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="relative">
        <button onClick={()=>setExpanded(true)} aria-label="Expand chart" title="Click to expand"
          className="no-print absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Maximize2 size={14}/>
        </button>
        <div className="h-56" role="img" aria-label="Average days from receipt submission to approval, by month">
          {data.length ? mkChart('p') : <EmptyChart label="Not enough approvals yet"/>}
        </div>
      </div>
      <ChartModal title="Approval turnaround" sub="Average days from submission to approval, by month"
        open={expanded} onClose={()=>setExpanded(false)}>
        {data.length ? mkChart('m') : <EmptyChart label="Not enough approvals yet"/>}
      </ChartModal>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/charts.jsx
git commit -m "feat(charts): add ApprovalTurnaround trend chart"
```

---

## Task 9: `StatusSplit` panel + wire all three into `ExpensesTab`

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (lazy-import ~line 72; new `StatusSplit` component near `Delta`;
  render wiring in `ExpensesTab` ~line 4344-4360)

- [ ] **Step 1: Add the lazy import for `ApprovalTurnaround`**

Find (around line 72):
```jsx
const ExpenseCharts = lazy(() => import('./charts').then(m=>({default:m.ExpenseCharts})));
```
Add right after it:
```jsx
const ApprovalTurnaround = lazy(() => import('./charts').then(m=>({default:m.ApprovalTurnaround})));
```

- [ ] **Step 2: Add the `StatusSplit` component**

Add this right after the `PeriodCompare` component from Task 4 (same file, so it can reuse `POS`/`NEG`
and the `Panel`/`Label` primitives already in scope):

```jsx
// Status distribution — same visual language as CacheTab's "Cache vs AI"
// proportion bar. Four buckets from wap_expenses.status; `flagged` is a
// separate boolean column (a flagged receipt can still end up approved), so
// it's a callout beside the bar, not a fifth bucket.
function StatusSplit({ counts, total, flaggedPct }) {
  const order = ['logged','pending_approval','approved','rejected'];
  const toneColor = (tone) => tone === 'pos' ? POS : tone === 'neg' ? NEG
    : tone === 'warn' ? 'var(--warn)' : 'var(--muted)';
  return (
    <Panel className="p-6">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <Label>Status</Label>
        <span className="mono text-[11px] text-zinc-500 tabular-nums">{flaggedPct}% ever flagged</span>
      </div>
      {total === 0 ? (
        <p className="mono text-[11px] uppercase tracking-widest text-zinc-400 py-4 text-center">No receipts yet</p>
      ) : (
        <>
          <div className="h-2.5 flex rounded-full overflow-hidden bg-zinc-100"
            role="img" aria-label={order.map(k => `${Math.round((counts[k]/total)*100)}% ${STATUS_META[k].label}`).join(', ')}>
            {order.map(k => counts[k] > 0 && (
              <div key={k} style={{ width: `${(counts[k]/total)*100}%`, background: toneColor(STATUS_META[k].tone) }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {order.map(k => (
              <span key={k} className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{background:toneColor(STATUS_META[k].tone)}}/>
                {STATUS_META[k].label} <span className="mono text-zinc-400">{counts[k]}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 3: Render all three in `ExpensesTab`**

Find the `ExpenseCharts` block in `ExpensesTab` (around line 4344-4360):

```jsx
          {/* Charts */}
          <Suspense fallback={<ChartsFallback />}>
            <ExpenseCharts
              mode={isEmployee ? 'personal' : 'team'}
              byEmployee={byEmployeeShown}
              byCategory={byCategory}
              trend={trend}
              selectedEmployee={selEmp}
              selectedEmployeeName={selEmpName}
              onSelectEmployee={setSelEmp}
              selectedCategory={cat === 'all' ? null : cat}
              onSelectCategory={catsPresent.length > 1 ? (c => setCat(c || 'all')) : undefined}
            />
          </Suspense>
```

Replace with:

```jsx
          <PeriodCompare sub="the month before" metrics={spendCompareMetrics}/>

          {/* Charts */}
          <Suspense fallback={<ChartsFallback />}>
            <ExpenseCharts
              mode={isEmployee ? 'personal' : 'team'}
              byEmployee={byEmployeeShown}
              byCategory={byCategory}
              trend={trend}
              selectedEmployee={selEmp}
              selectedEmployeeName={selEmpName}
              onSelectEmployee={setSelEmp}
              selectedCategory={cat === 'all' ? null : cat}
              onSelectCategory={catsPresent.length > 1 ? (c => setCat(c || 'all')) : undefined}
            />
          </Suspense>

          {!isEmployee && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-surface border border-zinc-100 rounded-xl p-6 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)]">
                <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Approval turnaround</h2>
                <p className="text-[13px] text-zinc-500 mt-1 mb-4">Average days from submission to approval</p>
                <Suspense fallback={<div className="h-56 rounded bg-zinc-50 animate-pulse"/>}>
                  <ApprovalTurnaround data={approvalTurnaround}/>
                </Suspense>
              </div>
              {statusSplit && <StatusSplit {...statusSplit}/>}
            </div>
          )}
```

- [ ] **Step 4: Verify**

Run: `npm run dev`. Sign in as a non-employee role, open Expenses. Confirm: a 1-cell spend-comparison
row appears above the existing charts; below the existing charts, two new panels appear
side-by-side on desktop (stacked on mobile) — an approval-turnaround trend and a status bar with a
"% ever flagged" readout. Sign in as an employee and confirm the two bottom panels do NOT appear (only
`spendCompareMetrics`, gated by `isEmployee` in its own label but always rendered, is visible) —
this matches the design's "CEO-level" framing for the bottom two.

- [ ] **Step 5: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(expenses): show spend comparison, approval turnaround, status split"
```

---

## Task 10: `.xlsx` writer (`src/xlsx.js`)

**Files:**
- Create: `src/xlsx.js`

- [ ] **Step 1: Write the full file**

```js
// Minimal, dependency-free .xlsx (OOXML spreadsheet) writer, reusing the
// hand-rolled zip writer already in export.js instead of adding SheetJS —
// same rationale as that file's zipStore: everything this writes is small,
// and a real dependency buys nothing but supply-chain surface for a page that
// handles financial and chat records.
//
// An .xlsx is a zip of XML parts. This writes the minimum Excel/Sheets/
// LibreOffice all agree on: no shared-strings table (cells carry inline
// strings instead — fully valid OOXML, one less part to get wrong), one
// worksheet per input sheet, a single default cell style.
import { zipStore, saveBlob } from './export';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML text-node escaping. Distinct from export.js's csvCell escaping — a
// different container with different special characters.
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Same rule as export.js's csvCell: a cell whose text starts with = + - @ (or
// tab/CR) can execute as a formula when opened in Excel. Force it to plain
// text with a leading apostrophe, except a bare negative number ("-1500"),
// which must stay numeric-looking text so it still sums correctly.
function guardFormula(s) {
  return (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
}

// 0-indexed column number -> spreadsheet column letters ("A", "Z", "AA", ...).
function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXML(colIdx, rowNum, value) {
  const ref = `${colLetter(colIdx)}${rowNum}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = guardFormula(value == null ? '' : String(value));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function sheetXML(columns, rows) {
  const headerRow = `<row r="1">${columns.map((col, i) => cellXML(i, 1, col.label)).join('')}</row>`;
  const bodyRows = rows.map((row, r) =>
    `<row r="${r + 2}">${columns.map((col, i) => cellXML(i, r + 2, col.get(row))).join('')}</row>`
  ).join('');
  return XML_HEADER +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${headerRow}${bodyRows}</sheetData>` +
    '</worksheet>';
}

// Excel sheet-name rules: <=31 chars, none of : \ / ? * [ ]. Dedupes if two
// input names collide after sanitizing.
function safeSheetName(name, taken) {
  const base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base, n = 2;
  while (taken.has(out)) out = `${base.slice(0, 28)} ${n++}`;
  taken.add(out);
  return out;
}

const contentTypesXML = (n) => XML_HEADER +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  Array.from({length:n},(_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
  '</Types>';

const ROOT_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const STYLES_XML = XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
  '<cellXfs count="1"><xf/></cellXfs>' +
  '</styleSheet>';

function workbookXML(names) {
  const sheets = names.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  return XML_HEADER +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets>` +
    '</workbook>';
}

function workbookRelsXML(n) {
  const sheetRels = Array.from({length:n},(_,i)=>
    `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
  return XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels +
    `<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
}

/**
 * Build an .xlsx Blob from `sheets: [{name, columns:[{label,get(row)}], rows}]`
 * — the same columns/get(row) shape export.js's exportCSV already takes, so a
 * chart's data feeds both without a second mapping.
 */
export async function buildXLSX(sheets) {
  const taken = new Set();
  const names = sheets.map(s => safeSheetName(s.name, taken));
  const xml = (s) => new Blob([s], { type: 'application/xml' });
  const files = [
    { name: '[Content_Types].xml', blob: xml(contentTypesXML(sheets.length)) },
    { name: '_rels/.rels', blob: xml(ROOT_RELS) },
    { name: 'xl/workbook.xml', blob: xml(workbookXML(names)) },
    { name: 'xl/_rels/workbook.xml.rels', blob: xml(workbookRelsXML(sheets.length)) },
    { name: 'xl/styles.xml', blob: xml(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i+1}.xml`, blob: xml(sheetXML(s.columns, s.rows)) })),
  ];
  return zipStore(files);
}

export async function exportXLSX(name, sheets) {
  const blob = await buildXLSX(sheets);
  saveBlob(blob, `hitech-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
```

- [ ] **Step 2: Verify with a manual smoke test**

Create a temporary scratch file (do NOT commit it) to exercise the writer outside the app:

Run in the project root:
```bash
node -e "
import('./src/export.js').then(async ({zipStore, saveBlob}) => {
  // saveBlob needs a DOM; skip it here and just prove buildXLSX doesn't throw
  // and produces a non-trivial Blob.
});
"
```

This won't work directly under plain Node (export.js's `saveBlob` uses `document`/`URL`), so instead
verify through the running app:

Run: `npm run dev`. Temporarily add a throwaway button anywhere already mounted (e.g. inside
`OverviewTab`'s return, right after the opening `<motion.div ...>`):

```jsx
<button onClick={async () => {
  const { exportXLSX } = await import('./xlsx');
  await exportXLSX('smoke-test', [{
    name: 'Test', columns: [{label:'A', get:r=>r.a}, {label:'B', get:r=>r.b}],
    rows: [{a:'hello', b:1}, {a:'=cmd', b:-5}],
  }]);
}}>xlsx smoke test</button>
```

Click it, open the downloaded `hitech-smoke-test-*.xlsx` in an actual spreadsheet app (Excel, Google
Sheets, or LibreOffice — not just a text editor). Confirm: two columns "A"/"B", row 2 reads `hello` /
`1`, row 3's A column reads `'=cmd` as **plain text** (not evaluated as a formula — this is the
security check) and B reads `-5` as a real negative number. Remove the throwaway button afterward —
it must not ship.

- [ ] **Step 3: Commit**

```bash
git add src/xlsx.js
git commit -m "feat(export): add dependency-free .xlsx writer"
```

---

## Task 11: Print stylesheet

**Files:**
- Modify: `src/index.css` (append at end)
- Modify: `src/charts.jsx` (mark `ExpandBtn` and the chart-panel expand buttons `.no-print` — several
  already got `.no-print` in Tasks 5/8; this task covers the ones from Task 1's untouched charts and
  the shared `ExpandBtn`)

- [ ] **Step 1: Append print rules to `index.css`**

Add at the end of `src/index.css`:

```css

/* ── Print export (Overview / Expenses "PDF" button, or a manual Ctrl+P) ──────
   Hides interactive chrome so a print / Save-as-PDF shows the panels a report
   reader actually wants, not the nav bar, filter widgets, or expand icons.
   Pure @media print — unlike vercel.json's CSP/Permissions-Policy headers
   (prod-only), this renders identically in `vite dev` and production, so it's
   directly testable locally. */
@media print {
  header, .no-print { display: none !important; }
  body, .bg-paper { background: #fff !important; }
  main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
  .app-scale { zoom: 1 !important; }
}
```

- [ ] **Step 2: Mark the shared `ExpandBtn` (charts.jsx) `.no-print`**

Find `ExpandBtn` in `src/charts.jsx` (around line 104-113):

```jsx
const ExpandBtn = ({ onClick }) => (
  <button
    onClick={onClick}
    aria-label="Expand chart"
    title="Click to expand"
    className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shrink-0"
  >
    <Maximize2 size={14} />
  </button>
);
```

Add `no-print` to the className:

```jsx
    className="no-print flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shrink-0"
```

This single change covers `ChartsRow`'s two expand buttons and `ExpenseCharts`'s three (they all use
this shared component) — the only expand buttons NOT covered are `HitRateTrend`'s standalone one and
the two new ones added in Tasks 5/8, which already got `no-print` directly in their own className.

- [ ] **Step 3: Mark `HitRateTrend`'s standalone expand button**

Find in `HitRateTrend` (around line 314-321):

```jsx
        <button
          onClick={() => setExpanded(true)}
          aria-label="Expand chart"
          title="Click to expand"
          className="absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
```

Add `no-print`:

```jsx
          className="no-print absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
```

- [ ] **Step 4: Verify**

Run: `npm run dev`. Open Overview, press Ctrl+P (or Cmd+P). In the print preview: header/nav must be
gone, no expand (⤢) icons should appear on any chart panel, and the panels should span the full
printable width rather than a centered `max-w-7xl` column. Cancel the print dialog (don't actually
print). Repeat on Expenses.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/charts.jsx
git commit -m "feat(export): add print stylesheet, hide chart chrome when printing"
```

---

## Task 12: `ExportTabButton` — wire PDF + Excel into Overview and Expenses

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (lucide-react import; new component after `ExportButton` ~line
  618; sheet-builder helpers; render wiring in `OverviewTab` and `ExpensesTab`)

- [ ] **Step 1: Add the `Printer` icon import**

Find (line 11):
```jsx
  LayoutDashboard, MessageSquare, Users, Database,
  RefreshCw, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, Zap, AlertTriangle, Download, HelpCircle, X, ArrowRight, Cpu, LogOut, Maximize2, Minimize2, Phone, CheckCircle2, Info, Bot, Send, Receipt, ExternalLink, ImageOff, Shield, UserCog, KeyRound, Power, Trash2, Eye, EyeOff, Mic, Square, Play, Pause, Sun, Moon, SunMoon, ThumbsDown, Copy, Check,
```
Add `Printer` to the list (anywhere; appended at the end here):
```jsx
  LayoutDashboard, MessageSquare, Users, Database,
  RefreshCw, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, Zap, AlertTriangle, Download, HelpCircle, X, ArrowRight, Cpu, LogOut, Maximize2, Minimize2, Phone, CheckCircle2, Info, Bot, Send, Receipt, ExternalLink, ImageOff, Shield, UserCog, KeyRound, Power, Trash2, Eye, EyeOff, Mic, Square, Play, Pause, Sun, Moon, SunMoon, ThumbsDown, Copy, Check, Printer,
```

- [ ] **Step 2: Import `exportXLSX`**

Find (line 17):
```jsx
import { exportCSV, buildCSV, saveBlob, safeName, zipStore } from './export';
```
Add right after it:
```jsx
import { exportXLSX } from './xlsx';
```

- [ ] **Step 3: Add `ExportTabButton`**

Find the end of the existing `ExportButton` component (around line 599-618, right before `// Inline
SVG sparkline...`). Insert after it:

```jsx
// Export a whole tab's charts — PDF via the browser's print dialog, Excel via
// a sheet-per-chart .xlsx. One control, both formats: a report reader wants
// "send me the report," not five separate downloads (design spec, 2026-07-30).
const ExportTabButton = ({ buildSheets, exportName }) => {
  const ctx = useContext(ToastContext);
  const [busy, setBusy] = useState(false);
  const handlePdf = () => window.print();
  const handleXlsx = async () => {
    setBusy(true);
    ctx?.pushToast({ state: 'preparing', msg: 'Preparing Excel export…' });
    try {
      await exportXLSX(exportName, buildSheets());
      ctx?.pushToast({ state: 'done', msg: 'Export complete!' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="no-print inline-flex rounded-lg border border-zinc-300 overflow-hidden">
      <button type="button" onClick={handlePdf}
        aria-label="Export tab as PDF" title="Export as PDF (print)"
        className="flex items-center gap-1.5 px-3 min-h-[44px] bg-surface text-zinc-700 text-[12px] font-semibold border-r border-zinc-300 hover:text-zinc-900 hover:bg-zinc-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <Printer size={13}/><span>PDF</span>
      </button>
      <button type="button" onClick={handleXlsx} disabled={busy}
        aria-label="Export tab as Excel" title="Export as Excel (.xlsx)"
        className="flex items-center gap-1.5 px-3 min-h-[44px] bg-surface text-zinc-700 text-[12px] font-semibold hover:text-zinc-900 hover:bg-zinc-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed">
        <Download size={13}/><span>Excel</span>
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Add the Overview sheet builder**

Add this as a module-level function, anywhere above `OverviewTab`'s definition (e.g. right after the
`labelFromKey` helper, around line 137):

```jsx
// Sheet builders for the "Excel" export — mirrors exactly what's on screen,
// so the columns/get(row) shape matches exportCSV's (same formula-injection
// guard applies inside xlsx.js's cellXML).
function buildOverviewSheets(s, periodMetrics) {
  const repNames = new Map();
  for (const day of s.topRepsDaily || []) for (const r of day.reps || []) repNames.set(r.ident, r.name || r.ident);
  const repList = [...repNames.entries()];
  return [
    {
      name: 'Message volume',
      columns: [{label:'Date', get:r=>r.date}, {label:'Messages', get:r=>r.count}],
      rows: s.volumeDaily || [],
    },
    {
      name: 'Top reps',
      columns: [{label:'Rep', get:r=>r.name}, {label:'Messages', get:r=>r.count}],
      rows: (s.users || []).slice(0,5).map(u=>({name:repName(u.number).split(' ')[0], count:u.count})),
    },
    {
      name: 'Rep activity',
      columns: [
        {label:'Date', get:r=>r.date},
        ...repList.map(([ident,name]) => ({label:name, get:r => (r.reps||[]).find(x=>x.ident===ident)?.count ?? 0})),
      ],
      rows: s.topRepsDaily || [],
    },
    {
      name: 'Period comparison',
      columns: [
        {label:'Metric', get:r=>r.label},
        {label:'This 30 days', get:r=>r.format ? r.format(r.current) : r.current},
        {label:'Previous 30 days', get:r=>r.format ? r.format(r.previous) : r.previous},
      ],
      rows: periodMetrics,
    },
  ];
}

function buildExpenseSheets({ byEmployee, byCategory, trend, spendCompareMetrics, approvalTurnaround, statusSplit }) {
  return [
    {
      name: 'Spend by employee',
      columns: [{label:'Employee', get:r=>r.name}, {label:'Total (PKR)', get:r=>r.total}],
      rows: byEmployee,
    },
    {
      name: 'Categories',
      columns: [{label:'Category', get:r=>r.category}, {label:'Total (PKR)', get:r=>r.total}],
      rows: byCategory,
    },
    {
      name: 'Monthly spend',
      columns: [{label:'Month', get:r=>r.label}, {label:'Total (PKR)', get:r=>r.total}],
      rows: trend,
    },
    {
      name: 'Spend comparison',
      columns: [
        {label:'Metric', get:r=>r.label},
        {label:'This month', get:r=>r.format ? r.format(r.current) : r.current},
        {label:'Last month', get:r=>r.format ? r.format(r.previous) : r.previous},
      ],
      rows: spendCompareMetrics,
    },
    {
      name: 'Approval turnaround',
      columns: [{label:'Month', get:r=>r.label}, {label:'Avg days', get:r=>Math.round(r.days*10)/10}],
      rows: approvalTurnaround,
    },
    {
      name: 'Status split',
      columns: [{label:'Status', get:r=>r.label}, {label:'Count', get:r=>r.count}],
      rows: statusSplit ? [
        {label: STATUS_META.logged.label, count: statusSplit.counts.logged},
        {label: STATUS_META.pending_approval.label, count: statusSplit.counts.pending_approval},
        {label: STATUS_META.approved.label, count: statusSplit.counts.approved},
        {label: STATUS_META.rejected.label, count: statusSplit.counts.rejected},
        {label: '(of which flagged)', count: `${statusSplit.flaggedPct}%`},
      ] : [],
    },
  ];
}
```

- [ ] **Step 5: Render the button in `OverviewTab`**

Find the very start of `OverviewTab`'s JSX return (around line 788-791):

```jsx
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      <HelpNote>Headline counts for the loaded period. "Today" shows the change vs yesterday{showCache ? '; "Cache" is answers served instantly without an AI call' : ''}.</HelpNote>
```

Replace with:

```jsx
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      <div className="flex justify-end">
        <ExportTabButton exportName="overview-report" buildSheets={() => buildOverviewSheets(s, periodMetrics)}/>
      </div>

      <HelpNote>Headline counts for the loaded period. "Today" shows the change vs yesterday{showCache ? '; "Cache" is answers served instantly without an AI call' : ''}.</HelpNote>
```

- [ ] **Step 6: Render the button in `ExpensesTab`**

Find the start of `ExpensesTab`'s successful-load JSX (around line 4189-4194):

```jsx
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <HelpNote>
        {isEmployee
          ? 'Your submitted receipts and spending. Only you and the accountant can see these.'
          : 'Every employee’s receipts and spending, from the WhatsApp receipt bot. Click an employee’s bar to drill into just their spend.'}
      </HelpNote>
```

Replace with:

```jsx
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {!noData && (
        <div className="flex justify-end">
          <ExportTabButton exportName="expenses-report" buildSheets={() => buildExpenseSheets({
            byEmployee: byEmployeeShown, byCategory, trend, spendCompareMetrics, approvalTurnaround, statusSplit,
          })}/>
        </div>
      )}
      <HelpNote>
        {isEmployee
          ? 'Your submitted receipts and spending. Only you and the accountant can see these.'
          : 'Every employee’s receipts and spending, from the WhatsApp receipt bot. Click an employee’s bar to drill into just their spend.'}
      </HelpNote>
```

`noData` is already computed earlier in `ExpensesTab` (`const noData = rows.length === 0;`, around
line 4186) — confirm this line is still above where you're inserting; if `ExpensesTab`'s structure
shifted from earlier tasks, `noData` must be defined before this return block, which it already is
(it's set right before `return (`).

- [ ] **Step 7: Verify**

Run: `npm run dev`. Open Overview — a "PDF | Excel" control appears top-right, above the help note.
Click "Excel": a `hitech-overview-report-<date>.xlsx` downloads; open it and confirm 4 sheets (Message
volume, Top reps, Rep activity, Period comparison) with real data. Click "PDF": the browser's print
dialog opens showing the Overview panels without nav/expand-icons. Repeat on Expenses (non-employee
account) — 6 sheets. Sign in as an employee on Expenses — confirm the export button still appears (an
employee's own spend report is still useful to them) and the Excel file's "Approval turnaround" /
"Status split" sheets are empty (since those derivations return rows only for non-employee views today
— acceptable, as those two panels are gated `!isEmployee` in Task 9's render).

- [ ] **Step 8: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(export): add per-tab PDF + Excel export to Overview and Expenses"
```

---

## Task 13: Final verification pass

No new files — this task is pure verification across everything Tasks 1-12 built.

- [ ] **Step 1: Mobile-width check (per this project's standing mobile-first rule)**

Run: `npm run dev`. At 320px, 360px, and 412px width (per this project's own standing rule — see
`db/dashboard-stats.sql`-adjacent conventions and this repo's existing mobile-testing pattern), check:
- Overview: period-comparison cells stack vertically without overflow; rep-activity legend wraps;
  export button doesn't collide with other header controls.
- Expenses: spend-comparison cell, approval-turnaround chart, and status-split bar all fit without
  horizontal scroll; the export button doesn't crowd the Month/Dept/Category filter row.

- [ ] **Step 2: Dark theme check**

Toggle the theme icon in the header to dark. Re-check every new panel from Step 1 — text contrast,
chart line colors (via `useThemeColors()`, which all new charts already use), and the status-split bar
colors (`var(--warn)`/`var(--pos)`/`var(--neg)`/`var(--muted)` must all resolve visibly against the
dark panel background).

- [ ] **Step 3: RLS re-verification for the new dashboard_stats() fields**

Repeat Task 2 Step 3's impersonation queries for a **finance_admin** and a **ceo** account (not just
dev/employee), confirming `top_reps_daily`/`active_reps_last30`/`active_reps_prev30` follow the same
access pattern as every other field `dashboard_stats()` already returns for those roles (ceo: full
data; finance_admin: empty, since `can_read_chats()` is `{dev, ceo}` only).

- [ ] **Step 4: Run the linter and build**

```bash
npm run lint
npm run build
```

Expected: both exit 0. Fix anything either flags before proceeding.

- [ ] **Step 5: Final commit (if Step 4 required fixes)**

```bash
git add -A
git commit -m "chore: lint/build fixes from final verification pass"
```

(Skip this step entirely if Step 4 was already clean — don't create an empty commit.)
