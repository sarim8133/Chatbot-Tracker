// Tailwind v4 (@import "tailwindcss" in index.css)
// Fonts (loaded in index.html): Archivo (grotesque, UI/display) + Spline Sans Mono (figures)
// Identity: "The Control Room" — a precision operations console for industrial sales.
// Ink + one hot signal-orange accent, concrete-paper blueprint grid, hairline panels.

import React, { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useReducedMotion, MotionConfig } from 'framer-motion';
import {
  LayoutDashboard, MessageSquare, Users, Database,
  RefreshCw, Search, ChevronDown, ChevronUp, Clock, Zap, AlertTriangle, Download, HelpCircle, X, ArrowRight, Cpu, LogOut,
} from 'lucide-react';
import { getAccessToken } from './auth';
import { SB_URL, SB_KEY, MSG_SOURCE } from './config';

// ── Config ────────────────────────────────────────────────────────────────────
// SB_URL / SB_KEY / MSG_SOURCE live in src/config.js (sourced from Vite env vars).
const REP_NAMES = {
  '923366179838': 'Sarim',
  '923004471122': 'Ahmed Raza',
};

// ── Palette — disciplined: ink structure + one committed signal accent ─────────
const INK       = '#18181B';   // zinc-900 — text, structure, the color that "owns" the page
const ACCENT    = '#F5471D';   // hot signal-orange — hero markers, active state, alerts
const ACCENT_DK = '#D63A12';   // pressed/hover accent + accent-as-text (AA-safe)
const POS       = '#16794C';   // muted emerald — positive delta only
const NEG       = '#B91C1C';   // alert red — negative delta only

// Charts live in a lazily-loaded chunk so Recharts doesn't block first paint.
const ChartsRow = lazy(() => import('./charts'));
const HitRateTrend = lazy(() => import('./charts').then(m=>({default:m.HitRateTrend})));
const ChartsFallback = () => (
  <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4">
    <div className="h-[300px] rounded-lg bg-white border border-zinc-200 animate-pulse"/>
    <div className="h-[300px] rounded-lg bg-white border border-zinc-200 animate-pulse"/>
  </div>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const clean    = n => String(n).replace(/\D/g, '');
const fmtPhone = n => {
  const s = clean(n);
  if (s.startsWith('92') && s.length === 12)
    return `+92 ${s.slice(2,5)} ${s.slice(5,8)} ${s.slice(8)}`;
  return `+${s}`;
};
const repName  = n => REP_NAMES[clean(n)] || fmtPhone(n);
const initials = n => {
  const nm = REP_NAMES[clean(n)];
  if (nm) { const p = nm.trim().split(/\s+/); return (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase(); }
  return String(n).slice(-2);
};
const fmtDay = ts => { const d = new Date(ts); return `${d.getDate()} ${d.toLocaleString('default',{month:'short'})}`; };
const ago = ts => {
  const ms = Date.now() - new Date(ts);
  if (ms < 60000)    return 'just now';
  if (ms < 3600000)  return `${~~(ms/60000)}m ago`;
  if (ms < 86400000) return `${~~(ms/3600000)}h ago`;
  return `${~~(ms/86400000)}d ago`;
};
const trunc = (s, n = 65) => !s ? '—' : s.length > n ? s.slice(0,n)+'…' : s;

// ── CSV export ────────────────────────────────────────────────────────────────
// Quote fields containing commas, quotes, or newlines (double internal quotes).
const csvCell = v => {
  let s = v == null ? '' : String(v);
  // Neutralize spreadsheet formula injection (CWE-1236): a cell starting with
  // = + - @ (or tab/CR) can execute as a formula when opened in Excel/Sheets.
  // Prefix with an apostrophe so it's forced to plain text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// 7×24 weekday-by-hour activity matrix from a list of timestamped items.
function buildHeat(items, getTs) {
  const heat = Array.from({length:7}, ()=>Array(24).fill(0));
  items.forEach(x => {
    const d = new Date(getTs(x));
    if (!isNaN(d)) heat[d.getDay()][d.getHours()]++;
  });
  return heat;
}

// Local YYYY-MM-DD key (timezone-safe day bucketing) + display label from a key.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const localKey = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const labelFromKey = k => { const [,m,d] = k.split('-'); return `${+d} ${MONTHS[+m-1]}`; };

// Zero-filled daily series across the loaded window (earliest msg → today).
// Returns a volume series and a cache-hit-rate series sharing one day axis.
function buildDaily(msgs, now) {
  const times = msgs.map(x=>+new Date(x.Timestamp)).filter(t=>!isNaN(t));
  const start = new Date(times.length ? Math.min(...times) : now); start.setHours(0,0,0,0);
  const end   = new Date(now); end.setHours(0,0,0,0);
  const days  = [];
  for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) days.push(localKey(d));
  const idx = Object.fromEntries(days.map(k=>[k,{count:0,hits:0}]));
  msgs.forEach(x=>{ const b=idx[localKey(x.Timestamp)]; if(!b) return; b.count++; if(x.from_cache===true) b.hits++; });
  return {
    volumeDaily: days.map(k=>({date:k, label:labelFromKey(k), count:idx[k].count})),
    cacheDaily:  days.map(k=>({date:k, label:labelFromKey(k), hits:idx[k].hits, total:idx[k].count, rate: idx[k].count ? idx[k].hits/idx[k].count : 0})),
  };
}

// Knowledge gaps: questions the assistant couldn't answer. By this project's
// definition a near-empty reply (<20 chars) is the bot's fallback / failure mode
// — the same threshold "Most asked" uses to exclude fallbacks. Grouped by question.
function computeGaps(msgs) {
  const gm = {};
  msgs.forEach(x=>{
    const ans=(x.AI_Response||'').trim();
    const q  =(x.User_Message||'').trim();
    if (q.length<3 || ans.length>=20) return;
    if (!gm[q]) gm[q]={count:0, last:x.Timestamp};
    gm[q].count++;
    if (new Date(x.Timestamp) > new Date(gm[q].last)) gm[q].last = x.Timestamp;
  });
  return Object.entries(gm).map(([text,g])=>({text, count:g.count, last:g.last}))
    .sort((a,b)=>b.count-a.count).slice(0,8);
}

// columns: [{label, get(row)}]. Prepends a BOM so Excel reads UTF-8 (emoji) right.
function exportCSV(name, columns, rows) {
  const head = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(c.get(r))).join(',')).join('\n');
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `hitech-${name}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Demo Data ─────────────────────────────────────────────────────────────────
function demoStats() {
  const now  = new Date();
  const nums = ['923366179838','923004471122','923218890541','923451200390','923099112233'];
  const qs   = ['scr 100apm compressor','tederic d100 specs','heavy duty air compressor','pet preform machine','compare d100 and d200','air tank options','uwa injection molding','screw compressor 75kw'];
  const msgsByDay = Array.from({length:14},(_,i)=>{
    const d=new Date(now); d.setDate(d.getDate()-(13-i));
    return {date:fmtDay(d),count:Math.round(8+Math.random()*22+(i>9?12:0))};
  });
  const users = nums.map((n,i)=>({
    number:n, count:Math.round(60-i*9+Math.random()*8),
    lastActive:new Date(now-i*3600000*5).toISOString(),
    msgs:[{User_Message:qs[i%qs.length],AI_Response:'Sample response.'}],
  }));
  // Distinct answer per query so answer-grouping + drill-through behave like prod.
  const ansFor = q => `🔹 ${q}\n🔹 75 KW power · 10 BAR pressure\n🔹 2.6–11 m³/min capacity`;
  const recent = Array.from({length:60},(_,i)=>({
    User_Number:nums[i%nums.length], User_Message:qs[i%qs.length],
    AI_Response:ansFor(qs[i%qs.length]),
    from_cache:Math.random()<0.42,
    Timestamp:new Date(now-i*1800000).toISOString(),
  }));
  const topQ = qs.map((text,i)=>({text,count:Math.round(18-i*1.8),answer:ansFor(text)})).sort((a,b)=>b.count-a.count);
  const cacheEntries = qs.map((text,i)=>({query_text:text,created_at:new Date(now-i*4200000).toISOString()}));
  // Synthetic heat weighted toward weekday business hours.
  const heat = Array.from({length:7},(_,d)=>Array.from({length:24},(_,h)=>{
    const business = h>=9 && h<=18 ? 1 : 0.12;
    const weekday  = d>=1 && d<=5 ? 1 : 0.35;
    return Math.round(Math.random()*15*business*weekday);
  }));
  const hitRate=0.42, cacheHits=Math.round(1247*hitRate), cacheMisses=1247-cacheHits;
  // Daily series for the range-selectable volume chart + hit-rate trend (30 days).
  const volumeDaily = Array.from({length:30},(_,i)=>{
    const d=new Date(now); d.setDate(d.getDate()-(29-i)); const k=localKey(d);
    return {date:k, label:labelFromKey(k), count:Math.round(8+Math.random()*22+(i>22?12:0))};
  });
  const cacheDaily = volumeDaily.map((v,i)=>{
    const rate=Math.min(0.86, 0.18 + i*0.021 + (Math.random()*0.08-0.04));   // climbs as the cache fills
    const hits=Math.round(v.count*rate);
    return {date:v.date, label:v.label, hits, total:v.count, rate: v.count ? hits/v.count : 0};
  });
  const gaps = [
    {text:'do you have spare parts for tederic d100', count:4, last:new Date(now-3600000*2).toISOString()},
    {text:'warranty period for screw compressor',     count:3, last:new Date(now-3600000*9).toISOString()},
    {text:'emi / installment options available',      count:2, last:new Date(now-3600000*26).toISOString()},
  ];
  return {totalMsgs:1247,todayCount:31,ystCount:24,userCount:users.length,cacheTotal:84,msgsByDay,users,topQ,maxQ:topQ[0].count,recent,cacheEntries,heat,volumeDaily,cacheDaily,gaps,cacheHits,cacheMisses,hitRate};
}

// ── Data Fetching ─────────────────────────────────────────────────────────────
// Reads carry the signed-in user's JWT (not the bare anon key) so RLS lets them
// through; the apikey just identifies the project.
async function sbFetch(token, table, params='') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`,{
    headers:{"apikey":SB_KEY,"Authorization":`Bearer ${token}`,"Prefer":"count=exact"},
  });
  const d = await r.json();
  const rng = r.headers.get('content-range');
  return {data:Array.isArray(d)?d:[],total:rng?parseInt(rng.split('/')[1])||0:(Array.isArray(d)?d.length:0)};
}

function useData(onAuthError) {
  const [stats,      setStats]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [demo,       setDemo]       = useState(false);
  const [lastUp,     setLastUp]     = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh=false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let token;
    try { token = await getAccessToken(); }
    catch { onAuthError?.(); setLoading(false); setRefreshing(false); return; }   // session gone → back to login
    try {
      const [m,c] = await Promise.all([
        sbFetch(token, MSG_SOURCE,'select=Timestamp,User_Number,User_Message,AI_Response,from_cache&order=Timestamp.desc&limit=500'),
        sbFetch(token, 'semantic_cache','select=query_text,created_at&order=created_at.desc&limit=300'),
      ]);
      const msgs=m.data, cache=c.data, now=new Date();
      const tStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      const yStart=new Date(+tStart-86400000);
      const today=msgs.filter(x=>new Date(x.Timestamp)>=tStart).length;
      const yest =msgs.filter(x=>new Date(x.Timestamp)>=yStart&&new Date(x.Timestamp)<tStart).length;
      const bk={};
      for(let i=13;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);bk[fmtDay(d)]=0;}
      msgs.forEach(x=>{const k=fmtDay(x.Timestamp);if(k in bk)bk[k]++;});
      const um={};
      msgs.forEach(x=>{
        const u=String(x.User_Number);
        if(!um[u])um[u]={number:u,count:0,lastActive:x.Timestamp,msgs:[]};
        um[u].count++;
        if(um[u].msgs.length<50)um[u].msgs.push(x);
        if(new Date(x.Timestamp)>new Date(um[u].lastActive))um[u].lastActive=x.Timestamp;
      });
      const users=Object.values(um).sort((a,b)=>b.count-a.count);
      // "Most asked" groups by the cached ANSWER, not the question text: paraphrases
      // that hit the same cache entry share an identical answer, so they merge into
      // one topic. Skip empty/short answers so generic fallbacks can't cluster
      // unrelated questions. Representative label = the most common phrasing.
      const am={};
      msgs.forEach(x=>{
        const ans=(x.AI_Response||'').trim();
        const q  =(x.User_Message||'').trim();
        if(ans.length<20 || q.length<3) return;
        if(!am[ans]) am[ans]={count:0, qc:{}};
        am[ans].count++;
        am[ans].qc[q]=(am[ans].qc[q]||0)+1;
      });
      const topQ=Object.entries(am).sort((a,b)=>b[1].count-a[1].count).slice(0,8).map(([answer,g])=>{
        const [text]=Object.entries(g.qc).sort((a,b)=>b[1]-a[1])[0];
        return {text, count:g.count, variants:Object.keys(g.qc).length, answer};
      });
      const cacheHits = msgs.filter(x=>x.from_cache===true).length;
      const cacheMisses = msgs.length - cacheHits;
      const {volumeDaily, cacheDaily} = buildDaily(msgs, now);
      const gaps = computeGaps(msgs);
      setStats({
        totalMsgs:m.total||msgs.length, todayCount:today, ystCount:yest,
        userCount:users.length, cacheTotal:c.total||cache.length,
        msgsByDay:Object.entries(bk).map(([date,count])=>({date,count})),
        users, topQ, maxQ:topQ[0]?.count||1, recent:msgs.slice(0,300), cacheEntries:cache,
        heat:buildHeat(msgs, x=>x.Timestamp),
        volumeDaily, cacheDaily, gaps,
        cacheHits, cacheMisses, hitRate: msgs.length ? cacheHits/msgs.length : 0,
      });
      setDemo(false);
    } catch {
      setStats(demoStats());
      setDemo(true);
    }
    setLastUp(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [onAuthError]);

  useEffect(()=>{
    load();
    const iv=setInterval(()=>load(true),30000);
    return()=>clearInterval(iv);
  },[load]);

  return {stats,loading,demo,lastUp,refreshing,refresh:()=>load(true)};
}

// ── Count-up (instrument boot) — animates once on first mount, then snaps ──────
function useCountUp(target, dur=900) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(typeof target==='number' ? 0 : target);
  const done = useRef(false);
  useEffect(()=>{
    if (typeof target!=='number') { setV(target); return; }
    if (reduce || done.current) { setV(target); done.current=true; return; }
    let raf, start;
    const tick = t => {
      if (!start) start=t;
      const p = Math.min(1,(t-start)/dur);
      setV(Math.round(target*(1-Math.pow(1-p,3))));   // ease-out cubic
      if (p<1) raf=requestAnimationFrame(tick); else done.current=true;
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[target,reduce,dur]);
  return typeof v==='number' ? v.toLocaleString() : v;
}

// ── Motion Variants ───────────────────────────────────────────────────────────
const stagger = { hidden:{}, show:{ transition:{ staggerChildren:0.05, delayChildren:0.03 } } };
const fadeUp  = { hidden:{opacity:0,y:10}, show:{opacity:1,y:0,transition:{duration:0.4,ease:[0.22,1,0.36,1]}} };

// ── Shared primitives ─────────────────────────────────────────────────────────

// Hairline-bordered instrument panel. Hover sharpens the border to ink (fast).
const Panel = ({children, className='', hover=false, ...rest}) => (
  <motion.div
    variants={fadeUp}
    whileHover={hover ? {borderColor:INK, transition:{duration:0.12}} : undefined}
    className={`bg-white border border-zinc-200 rounded-lg ${className}`}
    {...rest}
  >
    {children}
  </motion.div>
);

// Mono uppercase micro-label — the system's field-tag voice
const Label = ({children, className=''}) => (
  <span className={`mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 ${className}`}>{children}</span>
);

// Signed delta in mono with an arrow glyph (never color-alone)
const Delta = ({value}) => {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span className="inline-flex items-center gap-0.5 mono text-[11px] font-semibold"
      style={{color: up ? POS : NEG}}>
      <span className="text-[9px]">{up ? '▲' : '▼'}</span>{Math.abs(value)}
    </span>
  );
};

// Square equipment-tag avatar (ink chip, mono initials)
const Tag = ({number, lg=false}) => (
  <div
    className={`${lg?'w-10 h-10 text-[12px] rounded-md':'w-7 h-7 text-[10px] rounded'} flex items-center justify-center font-semibold shrink-0 bg-zinc-900 text-white mono`}
  >
    {initials(number)}
  </div>
);

// Secondary action — ghost button matching the system (white, hairline, ink on hover)
const ExportButton = ({onClick, disabled=false, label='Export'}) => (
  <button
    onClick={onClick} disabled={disabled}
    aria-label={`${label} as CSV`} title={`${label} as CSV`}
    className="flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] shrink-0 rounded-md bg-white border border-zinc-300 text-zinc-700 text-[12px] font-semibold tracking-tight transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <Download size={13}/>
    <span>{label}</span>
  </button>
);

// Inline SVG sparkline — single accent stroke, last point marked
function Sparkline({data, w=128, h=36, color=ACCENT}) {
  if (!data?.length) return null;
  const ys  = data.map(d=>d.count);
  const max = Math.max(...ys, 1), min = Math.min(...ys, 0);
  const span = max - min || 1;
  const xy = ys.map((y,i)=>[ (i/(ys.length-1))*w, h - ((y-min)/span)*h ]);
  const pts = xy.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx,ly] = xy[xy.length-1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={lx} cy={ly} r={2.6} fill={color}/>
    </svg>
  );
}


// ── Contextual help ───────────────────────────────────────────────────────────
// A page-level "?" toggle reveals plain-language captions inline (no popovers to
// clip or position, fully keyboard/touch accessible).
const HelpContext = createContext(false);
const HelpNote = ({children}) => {
  const on = useContext(HelpContext);
  if (!on) return null;
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-zinc-600 leading-snug bg-zinc-50 border border-zinc-200 rounded px-2.5 py-1.5 mb-3">
      <HelpCircle size={12} className="mt-0.5 shrink-0 text-zinc-500"/>
      <span>{children}</span>
    </p>
  );
};

// ── Activity heatmap (weekday × hour) ─────────────────────────────────────────
const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtHour = h => `${String(h).padStart(2,'0')}:00`;
const heatPeak = heat => {
  let p = {d:-1, h:-1, c:0};
  heat?.forEach((row,d)=>row.forEach((c,h)=>{ if (c>p.c) p = {d,h,c}; }));
  return p;
};

function Heatmap({heat}) {
  const max = Math.max(1, ...heat.flat());
  const dayOrder = [1,2,3,4,5,6,0];   // Mon-first
  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div className="inline-grid gap-[3px] min-w-full" style={{gridTemplateColumns:'30px repeat(24, minmax(13px, 1fr))'}}>
        {/* hour header */}
        <div/>
        {Array.from({length:24},(_,h)=>(
          <div key={h} className="mono text-[8px] text-zinc-500 tabular-nums text-center">
            {h%6===0 ? String(h).padStart(2,'0') : ''}
          </div>
        ))}
        {/* day rows */}
        {dayOrder.map(d=>(
          <React.Fragment key={d}>
            <div className="mono text-[9px] uppercase tracking-wide text-zinc-500 flex items-center">{DAY[d]}</div>
            {heat[d].map((c,h)=>{
              const a = c===0 ? 0 : 0.12 + 0.88*(c/max);
              return (
                <div key={h}
                  title={`${DAY[d]} ${fmtHour(h)} — ${c} message${c===1?'':'s'}`}
                  className="aspect-square rounded-[2px]"
                  style={{background: c===0 ? '#f4f4f5' : `rgba(245,71,29,${a.toFixed(3)})`}}/>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({s, onDrill}) {
  const delta  = s.todayCount - s.ystCount;
  const total  = useCountUp(s.totalMsgs);
  const peak   = heatPeak(s.heat);
  const ledger = [
    {label:'Today',       value:s.todayCount, delta, hint:'Messages today, compared with yesterday'},
    {label:'Active reps', value:s.userCount,         hint:'Reps who messaged the assistant in this period'},
    {label:'Cache',       value:s.cacheTotal,        hint:'Answers served instantly from cache — no AI call'},
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">

      <HelpNote>Headline counts for the loaded period. “Today” shows the change vs yesterday; “Cache” is answers served instantly without an AI call.</HelpNote>

      {/* Readout cluster — one instrument panel, hero + ledger, divided by hairlines */}
      <Panel className="grid grid-cols-1 md:grid-cols-[1.6fr_repeat(3,1fr)] divide-y md:divide-y-0 md:divide-x divide-zinc-200 overflow-hidden">
        {/* Primary readout */}
        <div className="p-6" title="All messages exchanged with the assistant">
          <div className="flex items-center justify-between">
            <Label>Total messages</Label>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:ACCENT}}/>
              <span className="mono text-[9px] uppercase tracking-widest text-zinc-500">live</span>
            </span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <span className="text-[46px] leading-[0.85] font-extrabold tracking-[-0.035em] text-zinc-900 tabular-nums">{total}</span>
            <Sparkline data={s.msgsByDay}/>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Delta value={delta}/>
            <span className="mono text-[10px] uppercase tracking-wide text-zinc-500">vs yesterday</span>
          </div>
        </div>
        {/* Ledger cells */}
        {ledger.map(c=>(
          <div key={c.label} title={c.hint} className="p-6 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between">
              <Label>{c.label}</Label>
              {c.delta!=null && <Delta value={c.delta}/>}
            </div>
            <span className="mono text-[30px] leading-none font-bold tracking-tight text-zinc-900">
              {typeof c.value==='number' ? c.value.toLocaleString() : c.value}
            </span>
          </div>
        ))}
      </Panel>

      {/* Charts row — lazy-loaded (Recharts in its own async chunk) */}
      <Suspense fallback={<ChartsFallback/>}>
        <ChartsRow
          volumeDaily={s.volumeDaily}
          topReps={s.users.slice(0,5).map(u=>({name:repName(u.number).split(' ')[0],count:u.count}))}
        />
      </Suspense>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Most asked — ledger rows, leader bar in accent */}
        <Panel className="p-6">
          <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Most asked</h2>
          <Label className="mt-1 mb-5 block">By topic · paraphrases merged</Label>
          <HelpNote>Grouped by the assistant’s answer, so different wordings of the same question count as one topic. “2 phrasings merged” shows when wordings were combined.</HelpNote>
          <div className="space-y-3.5">
            {s.topQ.slice(0,6).map((q,i)=>(
              <button key={i} type="button"
                onClick={()=>onDrill({type:'answer', answer:q.answer, label:q.text})}
                aria-label={`Show conversations for: ${q.text}`}
                className="group block w-full text-left -mx-2 px-2 py-1 rounded-md transition-colors hover:bg-zinc-50 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] text-zinc-700 group-hover:text-zinc-900 truncate">{trunc(q.text,40)}</span>
                    <ArrowRight size={11} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{color:ACCENT}}/>
                  </span>
                  <span className="mono text-[11px] text-zinc-500 shrink-0 tabular-nums">{q.count}</span>
                </div>
                <div className="mt-1.5 h-[3px] bg-zinc-100 overflow-hidden">
                  <motion.div
                    initial={{width:0}} animate={{width:`${(q.count/s.maxQ)*100}%`}}
                    transition={{duration:0.7,delay:i*0.06,ease:[0.22,1,0.36,1]}}
                    className="h-full" style={{background: i===0 ? ACCENT : INK}}/>
                </div>
                {q.variants>1 && (
                  <p className="mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 mt-1">{q.variants} phrasings merged</p>
                )}
              </button>
            ))}
          </div>
        </Panel>

        {/* Recent activity — mono log feed, diamond markers, latest in accent */}
        <Panel className="p-6">
          <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Recent activity</h2>
          <Label className="mt-1 mb-4 block">Live message log</Label>
          <HelpNote>The latest messages reps sent the assistant, newest first.</HelpNote>
          <div>
            {s.recent.slice(0,7).map((m,i)=>(
              <motion.div key={i}
                whileHover={{x:2,transition:{duration:0.12}}}
                className="flex items-start gap-3 py-2.5 border-t border-zinc-100 first:border-t-0 cursor-default">
                <span className="mt-[7px] w-1.5 h-1.5 rotate-45 shrink-0"
                  style={{background: i===0 ? ACCENT : INK}}/>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-zinc-800 truncate leading-snug">{trunc(m.User_Message,46)}</p>
                  <p className="mono text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wide truncate">
                    {repName(m.User_Number)} · {ago(m.Timestamp)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Knowledge gaps — questions that got no real answer (the bot's fallback) */}
      <Panel className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Knowledge gaps</h2>
            <Label className="mt-1 block">Questions the assistant couldn’t answer</Label>
          </div>
          {s.gaps?.length > 0 && (
            <ExportButton
              onClick={()=>exportCSV('gaps', [
                {label:'Question',    get:g=>g.text},
                {label:'Times asked', get:g=>g.count},
                {label:'Last asked',  get:g=>new Date(g.last).toISOString()},
              ], s.gaps)}
            />
          )}
        </div>
        <HelpNote>Questions where the assistant gave no real answer (a near-empty reply). These are the highest-value things to teach it next — sorted by how often reps hit them.</HelpNote>
        {!s.gaps?.length
          ? <div className="py-10 text-center">
              <p className="mono text-[12px] uppercase tracking-widest text-zinc-500">No gaps detected</p>
              <p className="text-[12px] text-zinc-500 mt-2">Every question in the loaded period got a real answer.</p>
            </div>
          : <ul className="mt-2 divide-y divide-zinc-100">
              {s.gaps.map((g,i)=>(
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="w-1.5 h-1.5 rotate-45 shrink-0" style={{background:ACCENT}}/>
                  <span className="flex-1 text-[13px] text-zinc-800 truncate">{trunc(g.text,72)}</span>
                  <span className="mono text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 hidden sm:inline">{ago(g.last)}</span>
                  <span className="mono text-[11px] font-semibold text-zinc-900 tabular-nums shrink-0 w-9 text-right">{g.count}×</span>
                </li>
              ))}
            </ul>
        }
      </Panel>

      {/* Busiest hours — weekday × hour heatmap */}
      {s.heat && (
        <Panel className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Busiest hours</h2>
              <Label className="mt-1 block">When reps message · by weekday &amp; hour</Label>
            </div>
            <div className="text-right shrink-0">
              <Label>Peak</Label>
              <p className="mono text-[13px] font-bold text-zinc-900 mt-1">
                {peak.c>0 ? `${DAY[peak.d]} ${fmtHour(peak.h)}` : '—'}
              </p>
            </div>
          </div>
          <HelpNote>When reps message the assistant, by weekday and hour. Darker cells = busier; hover a cell for the exact count.</HelpNote>
          <div className="mt-4" role="img"
            aria-label={peak.c>0 ? `Activity heatmap. Busiest is ${DAY[peak.d]} at ${fmtHour(peak.h)} with ${peak.c} messages.` : 'Activity heatmap — no activity yet.'}>
            <Heatmap heat={s.heat}/>
          </div>
        </Panel>
      )}
    </motion.div>
  );
}

// ── Conversations Tab ─────────────────────────────────────────────────────────
function ConversationsTab({s, focusSignal, drill, onDrillConsumed}) {
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState('all');
  const [expanded,   setExpanded]   = useState(null);
  const [topicDrill, setTopicDrill] = useState(null);   // {answer, label} from a Most-asked drill
  const searchRef = useRef(null);
  // Focus the search box when the parent fires the "/" shortcut.
  useEffect(()=>{ if (focusSignal) searchRef.current?.focus(); }, [focusSignal]);

  // Apply an incoming drill (Most-asked → answer filter, rep card → rep filter), then clear it upstream.
  useEffect(()=>{
    if (!drill) return;
    if (drill.type==='answer') { setTopicDrill({answer:drill.answer, label:drill.label}); setFilter('all'); setSearch(''); }
    else if (drill.type==='rep') { setFilter(drill.rep); setTopicDrill(null); setSearch(''); }
    onDrillConsumed?.();
  },[drill,onDrillConsumed]);

  const filtered = useMemo(()=>
    s.recent.filter(m=>{
      const u = filter==='all' || String(m.User_Number)===filter;
      const t = !topicDrill || (m.AI_Response||'').trim() === topicDrill.answer;
      const q = !search || m.User_Message?.toLowerCase().includes(search.toLowerCase())
                        || m.AI_Response?.toLowerCase().includes(search.toLowerCase());
      return u && t && q;
    })
  ,[s,search,filter,topicDrill]);

  const field = "bg-white border border-zinc-300 rounded-md text-[13px] text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20";

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Filters */}
      <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[160px] relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"/>
          <input
            ref={searchRef}
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search messages…"
            aria-label="Search messages"
            title="Focus with /"
            className={`w-full pl-10 ${search?'pr-9':'pr-4'} py-3 placeholder-zinc-500 ${field}`}
          />
          {search && (
            <button onClick={()=>{ setSearch(''); searchRef.current?.focus(); }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <X size={14}/>
            </button>
          )}
        </div>
        <select value={filter} onChange={e=>setFilter(e.target.value)}
          aria-label="Filter by rep"
          className={`px-4 py-3 text-zinc-700 cursor-pointer appearance-none ${field}`}>
          <option value="all">All reps</option>
          {s.users.map(u=><option key={u.number} value={u.number}>{repName(u.number)}</option>)}
        </select>
        <ExportButton
          disabled={!filtered.length}
          onClick={()=>exportCSV('conversations', [
            {label:'Rep',         get:m=>repName(m.User_Number)},
            {label:'Phone',       get:m=>fmtPhone(m.User_Number)},
            {label:'Message',     get:m=>m.User_Message},
            {label:'AI response', get:m=>m.AI_Response},
            {label:'Timestamp',   get:m=>new Date(m.Timestamp).toISOString()},
          ], filtered)}
        />
      </motion.div>

      <HelpNote>Every message reps exchanged with the assistant, newest first. Search by text, filter by rep, click a row to see the full reply. Export sends all matches to CSV.</HelpNote>

      {topicDrill && (
        <motion.div variants={fadeUp}
          className="flex items-center gap-2 rounded-md border px-3 py-2"
          style={{borderColor:`${ACCENT}40`, background:`${ACCENT}0D`}}>
          <span className="mono text-[10px] uppercase tracking-wide font-semibold shrink-0" style={{color:ACCENT_DK}}>Topic</span>
          <span className="text-[13px] text-zinc-800 truncate">{trunc(topicDrill.label,60)}</span>
          <button onClick={()=>setTopicDrill(null)} aria-label="Clear topic filter"
            className="ml-auto shrink-0 flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-white outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <X size={14}/>
          </button>
        </motion.div>
      )}

      {/* Log table */}
      <Panel className="overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.8fr_3fr_1fr_28px] px-6 py-3 border-b border-zinc-200 bg-zinc-50">
          {['Rep','Message','Time',''].map((t,i)=>(
            <Label key={i}>{t}</Label>
          ))}
        </div>

        {!filtered.length
          ? <div className="py-16 text-center">
              <p className="mono text-[12px] uppercase tracking-widest text-zinc-500">No conversations found</p>
              <p className="text-[12px] text-zinc-500 mt-2">Try a different search term, or set the rep filter back to “All reps”.</p>
            </div>
          : filtered.slice(0,40).map((m)=>{
            const rowKey = `${m.Timestamp}__${m.User_Number}`;
            const ex = expanded===rowKey;
            return (
              <React.Fragment key={rowKey}>
                <motion.div
                  role="button" tabIndex={0} aria-expanded={ex}
                  onClick={()=>setExpanded(ex?null:rowKey)}
                  onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setExpanded(ex?null:rowKey); } }}
                  whileHover={{backgroundColor:'rgba(24,24,27,0.025)'}}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 sm:px-6 py-3 border-b border-zinc-100 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 md:grid md:grid-cols-[1.8fr_3fr_1fr_28px] md:gap-0 md:items-center ${ex?'bg-zinc-50':''}`}
                >
                  <div className="order-1 md:order-none flex items-center gap-3 min-w-0 basis-[calc(100%-3rem)] md:basis-auto">
                    <Tag number={m.User_Number}/>
                    <span className="text-[13px] text-zinc-900 font-medium truncate">{repName(m.User_Number)}</span>
                  </div>
                  <span className="order-3 md:order-none basis-full md:basis-auto text-[13px] text-zinc-500 truncate md:pr-4">{trunc(m.User_Message,52)}</span>
                  <span className="order-4 md:order-none basis-full md:basis-auto mono text-[11px] text-zinc-500 tabular-nums">{ago(m.Timestamp)}</span>
                  <div className="order-2 md:order-none ml-auto md:ml-0 flex items-center justify-center transition-colors"
                    style={{color: ex ? ACCENT : '#71717A'}}>
                    {ex ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </div>
                </motion.div>

                <AnimatePresence>
                  {ex && (
                    <motion.div
                      initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}}
                      exit={{height:0,opacity:0}} transition={{duration:0.2}}
                      className="overflow-hidden border-b border-zinc-200"
                    >
                      <div className="px-6 py-5 bg-zinc-50 space-y-4">
                        <p className="mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          {repName(m.User_Number)} · {fmtPhone(m.User_Number)}
                        </p>
                        <div>
                          <Label className="mb-1.5 block" >Inbound</Label>
                          <div className="rounded-md p-3.5 bg-white border border-zinc-300">
                            <p className="text-[13px] text-zinc-800 leading-relaxed">{m.User_Message}</p>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="mono text-[10px] uppercase tracking-[0.16em]" style={{color:ACCENT_DK}}>Assistant</span>
                            <span className="mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                              style={m.from_cache ? {color:ACCENT_DK, background:`${ACCENT}14`} : {color:'#52525B', background:'#f4f4f5'}}>
                              {m.from_cache ? 'from cache' : 'AI call'}
                            </span>
                          </div>
                          <div className="rounded-md p-3.5 bg-white border border-zinc-300 max-h-36 overflow-y-auto">
                            <p className="text-[13px] text-zinc-600 leading-relaxed whitespace-pre-wrap">{m.AI_Response}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </React.Fragment>
            );
          })
        }
      </Panel>
      {filtered.length > 40 && (
        <p className="mono text-[10px] uppercase tracking-wide text-zinc-500 text-center">
          Showing 40 of {filtered.length} — export includes all {filtered.length}
        </p>
      )}
    </motion.div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({s, onDrill}) {
  if (!s.users.length) return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <Panel className="py-16 text-center">
        <p className="mono text-[12px] uppercase tracking-widest text-zinc-500">No reps yet</p>
        <p className="text-[12px] text-zinc-500 mt-2">Once reps message the WhatsApp assistant, they’ll appear here ranked by activity.</p>
      </Panel>
    </motion.div>
  );
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <HelpNote>Your sales reps, ranked by how many messages they sent the assistant. Each card shows their message count, rank, latest question, and last-active time.</HelpNote>
      <motion.div variants={fadeUp} className="flex items-center justify-between gap-3">
        <Label>{s.users.length} {s.users.length===1?'rep':'reps'}</Label>
        <ExportButton
          onClick={()=>exportCSV('reps', [
            {label:'Rank',        get:r=>r._rank},
            {label:'Rep',         get:r=>repName(r.number)},
            {label:'Phone',       get:r=>fmtPhone(r.number)},
            {label:'Messages',    get:r=>r.count},
            {label:'Last active', get:r=>new Date(r.lastActive).toISOString()},
          ], s.users.map((u,i)=>({...u, _rank:i+1})))}
        />
      </motion.div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {s.users.map((u,i)=>(
        <Panel key={u.number} hover className="p-5 cursor-pointer group outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          role="button" tabIndex={0}
          onClick={()=>onDrill({type:'rep', rep:u.number, label:repName(u.number)})}
          onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onDrill({type:'rep', rep:u.number, label:repName(u.number)}); } }}
          aria-label={`Show conversations from ${repName(u.number)}`}>
          <div className="flex items-center gap-3 mb-5">
            <Tag number={u.number} lg/>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-zinc-900 truncate">{repName(u.number)}</p>
              <p className="mono text-[11px] text-zinc-500 mt-0.5 truncate">{fmtPhone(u.number)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-b border-zinc-200 divide-x divide-zinc-200">
            {[['Messages', u.count.toLocaleString(), INK], ['Rank', `#${i+1}`, i===0 ? ACCENT : INK]].map(([l,v,c])=>(
              <div key={l} className="py-3.5 px-1 first:pr-3">
                <p className="mono text-[24px] font-bold leading-none tracking-tight" style={{color:c}}>{v}</p>
                <Label className="mt-1.5 block">{l}</Label>
              </div>
            ))}
          </div>
          {u.msgs[0] && (
            <p className="text-[12px] text-zinc-500 leading-snug mt-4">{trunc(u.msgs[0].User_Message,56)}</p>
          )}
          <div className="flex items-center gap-1.5 mt-3.5">
            <Clock size={11} className="text-zinc-500"/>
            <span className="mono text-[10px] uppercase tracking-wide text-zinc-500">{ago(u.lastActive)}</span>
            <ArrowRight size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{color:ACCENT}}/>
          </div>
        </Panel>
      ))}
      </div>
    </motion.div>
  );
}

// ── Cache Tab ─────────────────────────────────────────────────────────────────
function CacheTab({s}) {
  const pct = Math.round((s.hitRate||0)*100);
  const trend = (s.cacheDaily||[]).filter(d=>d.total>0);   // only days with activity
  const cells = [
    {label:'Hit rate',   value:`${pct}%`,          icon:Zap,      hint:'Share of messages answered from cache instead of calling the AI', accent:true},
    {label:'From cache', value:s.cacheHits ?? 0,   icon:Database, hint:'Messages answered instantly from cache — AI calls (and their cost/latency) saved'},
    {label:'AI calls',   value:s.cacheMisses ?? 0, icon:Cpu,      hint:'Messages that required a live AI call (cache miss)'},
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <HelpNote>“Hit rate” is the share of reps’ messages answered straight from cache. Every cache hit is one AI call — and its cost and latency — saved.</HelpNote>

      <Panel className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 overflow-hidden">
        {cells.map(c=>(
          <div key={c.label} title={c.hint} className="p-6 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between">
              <Label>{c.label}</Label>
              <c.icon size={14} style={c.accent ? {color:ACCENT} : undefined} className={c.accent ? '' : 'text-zinc-500'}/>
            </div>
            <span className="mono text-[30px] leading-none font-bold tracking-tight"
              style={{color: c.accent ? ACCENT : INK}}>
              {typeof c.value==='number' ? c.value.toLocaleString() : c.value}
            </span>
          </div>
        ))}
      </Panel>

      {/* Cache vs AI proportion */}
      <Panel className="p-6">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <Label>Cache vs AI</Label>
          <span className="mono text-[11px] text-zinc-500 tabular-nums">
            {(s.cacheHits??0).toLocaleString()} cached · {(s.cacheMisses??0).toLocaleString()} AI
          </span>
        </div>
        <div className="h-2.5 flex rounded-full overflow-hidden bg-zinc-100"
          role="img" aria-label={`${pct} percent of messages answered from cache, ${100-pct} percent required an AI call`}>
          <div style={{width:`${pct}%`, background:ACCENT}}/>
        </div>
        <div className="flex justify-between mt-2 mono text-[10px] uppercase tracking-wide">
          <span style={{color:ACCENT_DK}}>{pct}% from cache</span>
          <span className="text-zinc-500">{100-pct}% AI</span>
        </div>
      </Panel>

      {/* Hit rate over time — is the cache improving as it fills? */}
      {trend.length >= 2 && (
        <Panel className="p-6">
          <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Hit rate over time</h2>
          <Label className="mt-1 block">Daily · is the cache improving?</Label>
          <HelpNote>Cache hit rate for each day with activity. As reps ask more, the cache fills and this should trend upward — flat or falling means new questions keep missing.</HelpNote>
          <div className="mt-4">
            <Suspense fallback={<div className="h-44 rounded bg-zinc-50 animate-pulse"/>}>
              <HitRateTrend data={trend}/>
            </Suspense>
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Cached queries</h2>
            <p className="text-[12px] text-zinc-500 mt-1 leading-snug">Questions the assistant has answered before — served instantly from cache instead of calling the AI. {(s.cacheTotal||0).toLocaleString()} cached in total, most recent first.</p>
          </div>
          <ExportButton
            disabled={!s.cacheEntries.length}
            onClick={()=>exportCSV('cache', [
              {label:'Query',     get:c=>c.query_text},
              {label:'Cached at', get:c=>new Date(c.created_at).toISOString()},
            ], s.cacheEntries)}
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {!s.cacheEntries.length
            ? <div className="py-16 text-center">
                <p className="mono text-[12px] uppercase tracking-widest text-zinc-500">Nothing cached yet</p>
                <p className="text-[12px] text-zinc-500 mt-2">The assistant caches answers as reps ask new questions — entries will appear here.</p>
              </div>
            : s.cacheEntries.map((c,i)=>(
              <div key={i} className="flex items-center gap-4 px-6 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
                <span className="mono text-[10px] text-zinc-500 w-6 shrink-0 text-right tabular-nums">{String(i+1).padStart(2,'0')}</span>
                <span className="flex-1 text-[13px] text-zinc-700 truncate">{trunc(c.query_text,82)}</span>
                <span className="mono text-[11px] text-zinc-500 shrink-0 tabular-nums">{ago(c.created_at)}</span>
              </div>
            ))
          }
        </div>
      </Panel>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton() {
  const block = "rounded-lg bg-white border border-zinc-200 animate-pulse";
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <div className={`h-32 ${block}`}/>
      <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4">
        <div className={`h-64 ${block}`}/>
        <div className={`h-64 ${block}`}/>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`h-56 ${block}`}/>
        <div className={`h-56 ${block}`}/>
      </div>
    </motion.div>
  );
}

// ── Nav Config ────────────────────────────────────────────────────────────────
const NAV = [
  {id:'overview',      label:'Overview',      icon:LayoutDashboard},
  {id:'conversations', label:'Conversations', icon:MessageSquare},
  {id:'users',         label:'Reps',          icon:Users},
  {id:'cache',         label:'Cache',         icon:Database},
];

// ── Root Component ────────────────────────────────────────────────────────────
export default function Dashboard({ onLogout }) {
  const [tab, setTab] = useState('overview');
  const [searchFocus, setSearchFocus] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drill, setDrill] = useState(null);
  const {stats,loading,demo,lastUp,refreshing,refresh} = useData(onLogout);

  // Drill-through: jump to Conversations with a topic (answer) or rep pre-filter.
  const goDrill    = useCallback(d => { setTab('conversations'); setDrill(d); }, []);
  const clearDrill = useCallback(() => setDrill(null), []);

  // Keyboard accelerators: 1–4 switch tabs, "/" jumps to Conversations search.
  useEffect(()=>{
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
      if (e.key>='1' && e.key<=String(NAV.length)) setTab(NAV[+e.key-1].id);
      else if (e.key==='/') { e.preventDefault(); setTab('conversations'); setSearchFocus(n=>n+1); }
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[]);

  // Idle auto-logout — sign out after 30 min of no interaction, so a session left
  // open on a shared/kiosk machine doesn't stay readable.
  useEffect(()=>{
    if (!onLogout) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(onLogout, 30*60*1000); };
    const evts = ['mousemove','keydown','click','scroll','touchstart'];
    evts.forEach(e=>window.addEventListener(e, reset, {passive:true}));
    reset();
    return ()=>{ clearTimeout(timer); evts.forEach(e=>window.removeEventListener(e, reset)); };
  },[onLogout]);

  return (
    <MotionConfig reducedMotion="user">
    <HelpContext.Provider value={helpOpen}>
    <div className="relative min-h-screen text-zinc-900">

      {/* Blueprint grid on concrete paper — static, no motion */}
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true"
        style={{
          background:'#eeeff0',
          backgroundImage:`linear-gradient(rgba(24,24,27,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,0.045) 1px, transparent 1px)`,
          backgroundSize:'34px 34px',
        }}/>

      {/* ── Top navigation ── */}
      <header className="sticky top-0 z-20 bg-[#eeeff0] border-b border-zinc-300">
        {/* signal strip */}
        <div className="h-[3px] w-full" style={{background:ACCENT}}/>
        <div className="max-w-6xl mx-auto px-6 lg:px-8 h-16 flex items-center gap-6">

          {/* Wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-md bg-zinc-900 text-white flex items-center justify-center mono text-[13px] font-bold tracking-tight">HT</div>
            <div className="leading-none hidden sm:block">
              <p className="text-[14px] font-bold tracking-tight text-zinc-900">HI-TECH</p>
              <p className="mono text-[8px] uppercase tracking-[0.2em] text-zinc-500 mt-1">Sales Intelligence</p>
            </div>
          </div>

          {/* Tab strip */}
          <nav className="flex items-stretch h-16 flex-1">
            {NAV.map((n,idx)=>{
              const active = tab===n.id;
              return (
                <button key={n.id}
                  onClick={()=>{ if(!active) setTab(n.id); }}
                  aria-current={active ? 'page' : undefined}
                  title={`${n.label} · press ${idx+1}`}
                  className={`relative flex items-center gap-2 px-4 text-[13px] transition-colors outline-none focus-visible:bg-zinc-900/5
                    ${active ? 'text-zinc-900 font-semibold' : 'text-zinc-500 hover:text-zinc-900 font-medium'}`}
                >
                  <n.icon size={15} style={active ? {color:ACCENT} : undefined}/>
                  <span className="hidden md:inline">{n.label}</span>
                  {active && (
                    <motion.span layoutId="tabUnderline"
                      className="absolute bottom-0 left-2 right-2 h-[2px]"
                      style={{background:ACCENT}}
                      transition={{type:'spring',stiffness:480,damping:36}}/>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={()=>setHelpOpen(o=>!o)}
              aria-pressed={helpOpen}
              aria-label="Toggle help captions"
              title="Toggle help"
              className={`flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${helpOpen ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-900 hover:text-zinc-900'}`}
            >
              <HelpCircle size={15}/>
            </button>
            <div aria-live="polite" className="flex items-center gap-3 empty:hidden">
              {lastUp && (
                <span className="hidden md:inline mono text-[10px] uppercase tracking-wide text-zinc-500 tabular-nums">
                  upd {ago(lastUp)}
                </span>
              )}
              {demo && (
                <span className="mono text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded"
                  style={{color:ACCENT_DK, background:`${ACCENT}14`, border:`1px solid ${ACCENT}40`}}>
                  Demo
                </span>
              )}
            </div>
            <motion.button
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh data"
              aria-busy={refreshing}
              whileTap={{scale:0.96}}
              className="flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] min-w-[44px] rounded-md bg-zinc-900 text-white text-[12px] font-semibold tracking-tight transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <motion.div
                animate={refreshing ? {rotate:360} : {}}
                transition={{duration:0.7,repeat:refreshing?Infinity:0,ease:'linear'}}
              >
                <RefreshCw size={12}/>
              </motion.div>
              <span className="hidden sm:inline">Refresh</span>
            </motion.button>
            <button
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md border bg-white text-zinc-700 border-zinc-300 transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <LogOut size={15}/>
            </button>
          </div>
        </div>
      </header>

      {/* ── Page ── */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 lg:px-8 py-8">

        {/* Backend unreachable — sample data is showing. Make it unmistakable. */}
        {demo && (
          <div role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-md border px-4 py-3"
            style={{borderColor:`${ACCENT}66`, background:`${ACCENT}10`}}>
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle size={16} style={{color:ACCENT_DK}} className="shrink-0"/>
              <p className="text-[13px] text-zinc-800 leading-snug">
                <span className="font-semibold">Couldn't reach the database.</span>
                <span className="text-zinc-600"> Showing sample data — the figures below are not live.</span>
              </p>
            </div>
            <button onClick={refresh} disabled={refreshing}
              className="shrink-0 mono text-[11px] uppercase tracking-wide font-semibold px-3 py-2 rounded text-white bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              Retry
            </button>
          </div>
        )}

        {/* Page heading */}
        <motion.div
          initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
          transition={{duration:0.4,delay:0.05}}
          className="mb-7 flex items-end justify-between gap-4"
        >
          <div>
            <h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-zinc-900 leading-none">
              {NAV.find(n=>n.id===tab)?.label}
            </h1>
            <p className="mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mt-2.5">
              WhatsApp sales assistant · analytics
            </p>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {loading && !stats ? (
            <motion.div key="skel" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
              <Skeleton/>
            </motion.div>
          ) : stats ? (
            <motion.div
              key={tab}
              initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
              transition={{duration:0.22}}
            >
              {tab==='overview'      && <OverviewTab      s={stats} onDrill={goDrill}/>}
              {tab==='conversations' && <ConversationsTab s={stats} focusSignal={searchFocus} drill={drill} onDrillConsumed={clearDrill}/>}
              {tab==='users'         && <UsersTab         s={stats} onDrill={goDrill}/>}
              {tab==='cache'         && <CacheTab         s={stats}/>}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
    </HelpContext.Provider>
    </MotionConfig>
  );
}
