// Tailwind v4 (@import "tailwindcss" in index.css)
// Fonts (loaded in index.html): Archivo (grotesque, UI/display) + Spline Sans Mono (figures)
// Identity: "The Control Room" — a precision operations console for industrial sales.
// Ink + one hot signal-orange accent, concrete-paper blueprint grid, hairline panels.

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useContext, createContext, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, MotionConfig } from 'framer-motion';
import {
  LayoutDashboard, MessageSquare, Users, Database,
  RefreshCw, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, Zap, AlertTriangle, Download, HelpCircle, X, ArrowRight, Cpu, LogOut, Maximize2, Minimize2, Phone, CheckCircle2, Info, Bot, Send, Receipt, ExternalLink, ImageOff, Shield, UserCog, KeyRound, Power, Trash2, Eye, EyeOff, Mic, Square, Play, Pause, Sun, Moon, SunMoon, ThumbsDown, Copy, Check,
} from 'lucide-react';
import { getAccessToken, changePasswordSecure } from './auth';
import { SB_URL, SB_KEY, MSG_SOURCE, N8N_CHAT_WEBHOOK, WEB_CHAT_SOURCE, N8N_RECEIPT_WEBHOOK } from './config';
import { CATS, catColor, fmtPKR } from './categories';
import { validateImage, compressImage, imageFromClipboard, extractReceipt, saveReceipt, signedReceiptUrl, deleteReceiptImage } from './receipts';
import { MAX_MS, LIVE_METER_MS, LIVE_METER_BARS, WAVEFORM_RES, BAR_PITCH, isRecordingSupported, createRecorder, blobToWav16k, blobToBase64, isProbablySilent, computeWaveform } from './voice';
import { REASONS, REASON_LABEL, submitFeedback } from './feedback';
import { useTheme } from './theme';

// ── Config ────────────────────────────────────────────────────────────────────
// SB_URL / SB_KEY / MSG_SOURCE live in src/config.js (sourced from Vite env vars).
// Rep names are populated from the Name column in n8n_chat_histories when data loads.
let _repNames = {};

// Deterministic pastel color per rep — assigned from the last 2 digits of their number
const AVATAR_PALETTE = [
  { bg:'#DBEAFE', fg:'#1E40AF' }, // sky blue
  { bg:'#D1FAE5', fg:'#065F46' }, // emerald
  { bg:'#EDE9FE', fg:'#5B21B6' }, // violet
  { bg:'#FCE7F3', fg:'#9D174D' }, // pink
  { bg:'#FEF3C7', fg:'#92400E' }, // amber
  { bg:'#CFFAFE', fg:'#155E75' }, // cyan
  { bg:'#FFE4E6', fg:'#9F1239' }, // rose
  { bg:'#E0E7FF', fg:'#3730A3' }, // indigo
];
const avatarColor = n => {
  // Phone reps: index by the last 2 digits. Web reps (name, no digits): hash the string,
  // so parseInt(NaN) can't index the palette out of bounds (which crashed the rep tabs).
  let idx = parseInt(clean(n).slice(-2), 10);
  if (Number.isNaN(idx)) { idx = 0; for (const ch of String(n)) idx = (idx * 31 + ch.charCodeAt(0)) >>> 0; }
  return AVATAR_PALETTE[idx % AVATAR_PALETTE.length];
};

// ── Palette — disciplined: ink structure + one committed signal accent ─────────
// Values live in src/index.css now (--ink, --accent, … under :root / [data-theme="dark"]).
// These constants hold var(--…) strings rather than literal hex, so every inline
// style={{…}} that references them resolves to the current theme automatically —
// see the big comment at the top of index.css for the mechanism.
const INK       = 'var(--ink)';           // the color that "owns" the page; the user's chat bubble
const ACCENT    = 'var(--accent)';        // hot signal-orange — hero markers, active state, alerts (unchanged in dark)
const ACCENT_DK = 'var(--accent-dark)';   // pressed/hover accent + accent-as-text (AA-safe in both themes)
const BLUE      = 'var(--blue)';          // brand blue (logo hex) — secondary/informational
const POS       = 'var(--pos)';           // muted emerald — positive delta only
const NEG       = 'var(--neg)';           // alert red — negative delta only

// `${ACCENT}14`-style hex-alpha suffixes broke once these constants held var(--…)
// strings instead of literal hex (you can't append an alpha hex digit to a var()
// reference and get a valid color). color-mix() is the CSS-native replacement:
// mixing `pct`% of the color with transparent reproduces the same effective alpha,
// and it re-resolves the var() live, so the tint still flips with the theme.
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const PER_PAGE = 25;

// Charts live in a lazily-loaded chunk so Recharts doesn't block first paint.
const ChartsRow = lazy(() => import('./charts'));
const HitRateTrend = lazy(() => import('./charts').then(m=>({default:m.HitRateTrend})));
const ExpenseCharts = lazy(() => import('./charts').then(m=>({default:m.ExpenseCharts})));
const ChartsFallback = () => (
  <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4">
    <div className="h-[300px] rounded-xl bg-surface border border-zinc-100 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)] animate-pulse"/>
    <div className="h-[300px] rounded-xl bg-surface border border-zinc-100 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)] animate-pulse"/>
  </div>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
// A rep identity comes from chat_all.ident and takes one of three forms:
//   "uid:<uuid>"  a person with a Team account — the same human on WhatsApp AND
//                 the web, which is the whole point of the identity change
//   "web:<name>"  a web chatter with no account (a name can itself contain
//                 digits, e.g. "sales01", so it is marked rather than inferred)
//   "<digits>"    a WhatsApp number with no account
// Only the third form IS a phone number; the other two carry none, so the phone
// travels separately (person_phone on rows, u.phone on reps).
const WEB = 'web:';
const UID = 'uid:';
const isWebRep = v => String(v).startsWith(WEB);
const isUidRep = v => String(v).startsWith(UID);
const clean    = n => String(n).replace(/\D/g, '');
const fmtPhone = n => {
  // Never digit-strip a uuid identity: clean('uid:2a7c…') yields a run of digits
  // that formats into a convincing, entirely fictional phone number.
  if (n == null || isWebRep(n) || isUidRep(n)) return '—';
  const s = clean(n);
  if (!s) return '—';
  if (s.startsWith('92') && s.length === 12)
    return `+92 ${s.slice(2,5)} ${s.slice(5,8)} ${s.slice(8)}`;
  return `+${s}`;
};
// _repNames is keyed on the raw identity for uid:/web: reps and on the digits for
// phone reps, so this one lookup covers all three forms.
const repLabel = n => _repNames[n] || (isWebRep(n) ? String(n).slice(WEB.length) : _repNames[clean(n)]);
const repName  = n => repLabel(n) || fmtPhone(n);
const initials = n => {
  const nm = repLabel(n);
  if (nm) { const p = nm.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] || '') + (p[1]?.[0] ?? '')).toUpperCase() || nm.slice(0,2).toUpperCase(); }
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
// NOTE: buildHeat() and buildDaily() used to live here, deriving the heatmap and
// the daily trends in the browser from the 500-row fetch. Both now come from
// dashboard_stats() so they cover the whole table instead of a sliding window —
// see db/dashboard-stats.sql.

// Local YYYY-MM-DD key (timezone-safe day bucketing) + display label from a key.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const localKey = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const labelFromKey = k => { const [,m,d] = k.split('-'); return `${+d} ${MONTHS[+m-1]}`; };

// NOTE: this used to be computeGaps(), which flagged questions whose reply ran
// under 20 chars. It was dead code in practice — the agent's NO RESULTS RULE
// makes it answer "I couldn't find [model] in our catalog…" (~90 chars), so
// measured over 128 turns it matched exactly 0. And the failure that actually
// hurts is a long, confident, WRONG answer, which no length test can catch.
// The signal now comes from the reps instead: see chat_feedback / db/chat-feedback.sql.

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
  // Demo reps are phone-identified (no Team accounts behind them), so `number` and
  // `phone` are the same string here. In prod `number` is a "uid:<uuid>" identity
  // and `phone` comes from the roster — see dashboard_stats.
  const users = nums.map((n,i)=>({
    number:n, phone:n, count:Math.round(60-i*9+Math.random()*8),
    lastActive:new Date(now-i*3600000*5).toISOString(),
    msgs:[{User_Message:qs[i%qs.length],AI_Response:'Sample response.'}],
  }));
  // Distinct answer per query so answer-grouping + drill-through behave like prod.
  const ansFor = q => `🔹 ${q}\n🔹 75 KW power · 10 BAR pressure\n🔹 2.6–11 m³/min capacity`;
  const recent = Array.from({length:60},(_,i)=>({
    User_Number:nums[i%nums.length], ident:nums[i%nums.length], person_phone:nums[i%nums.length],
    User_Message:qs[i%qs.length],
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
  // One row per purge state, so demo mode exercises all three hint variants:
  // purged, served-from-cache-but-not-purged (a pre-auto-purge report), neither.
  const badResponses = [
    {id:'d1', reason:'wrong_machine', user_message:'compare dt 100 and dd 250', ai_response:'DT D100 vs SCR250H-7…', note:'gave me an air compressor', from_cache:false, cache_purged:1, user_name:'ahsan',  created_at:new Date(now-3600000*2).toISOString()},
    {id:'d2', reason:'missing_specs', user_message:'screw diameter for d170db',  ai_response:'The D170Db is a double-color…', note:'', from_cache:true,  cache_purged:0, user_name:'bilal', created_at:new Date(now-3600000*9).toISOString()},
    {id:'d3', reason:'misunderstood', user_message:'chhota wala machine dikhao', ai_response:"I couldn't find…", note:'', from_cache:false, cache_purged:0, user_name:'ahsan',  created_at:new Date(now-3600000*26).toISOString()},
  ];
  return {totalMsgs:1247,todayCount:31,ystCount:24,userCount:users.length,cacheTotal:84,msgsByDay,users,topQ,maxQ:topQ[0].count,recent,cacheEntries,heat,volumeDaily,cacheDaily,badResponses,cacheHits,cacheMisses,hitRate};
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

// Calls a Postgres RPC (the admin-only SECURITY DEFINER role functions). Throws
// on a non-2xx so the caller can surface the DB's "not authorized" message.
async function sbRpc(token, fn, body) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`,{
    method:'POST',
    headers:{"apikey":SB_KEY,"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify(body||{}),
  });
  const d = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(d?.message || `RPC ${fn} failed (HTTP ${r.status})`);
  return d;
}

// Calls a Supabase Edge Function (e.g. admin-create-user, which needs the
// server-side service key to create Auth logins). Throws on non-2xx.
async function sbFunction(token, name, body) {
  const r = await fetch(`${SB_URL}/functions/v1/${name}`,{
    method:'POST',
    headers:{ apikey:SB_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json" },
    body:JSON.stringify(body||{}),
  });
  const d = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(d?.error || `Request failed (HTTP ${r.status})`);
  return d;
}

function useData(onAuthError) {
  const [stats,      setStats]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [demo,       setDemo]       = useState(false);
  const [lastUp,     setLastUp]     = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [channelFilter, setChannelFilter] = useState('all');   // 'all' | 'whatsapp' | 'web'

  const load = useCallback(async (isRefresh=false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let token;
    try { token = await getAccessToken(); }
    catch { onAuthError?.(); setLoading(false); setRefreshing(false); return; }   // session gone → back to login
    try {
      // Aggregates come from dashboard_stats(), which groups server-side over the
      // WHOLE table. They used to be derived here from a 500-row fetch, which meant
      // `limit=500` wasn't a display cap — it was the sample every metric ran on, so
      // past 500 rows the numbers quietly became "the last 500 messages". See
      // db/dashboard-stats.sql.
      //
      // The row fetch below now feeds ONLY the Overview activity feed, which shows
      // seven. Conversations pages itself through the conversations_page RPC, so it
      // no longer depends on how many rows happen to be sitting in this array —
      // which is what let "All" list fewer messages of each channel than that
      // channel's own chip did.
      //
      // chat_feedback is admin-read; for a non-admin RLS just returns [], which
      // renders the panel's empty state rather than erroring the whole load.
      const chanArg = channelFilter !== 'all' ? { p_channel: channelFilter } : {};
      const [agg,m,c,fb] = await Promise.all([
        sbRpc(token, 'dashboard_stats', chanArg),
        sbFetch(token, MSG_SOURCE,`select=Timestamp,Name,User_Message,AI_Response,from_cache,channel,ident,person_phone&order=Timestamp.desc&limit=20${channelFilter!=='all'?`&channel=eq.${channelFilter}`:''}`),
        sbFetch(token, 'semantic_cache','select=query_text,created_at&order=created_at.desc&limit=300'),
        sbFetch(token, 'chat_feedback','select=id,created_at,reason,note,user_message,ai_response,from_cache,cache_purged,user_name&order=created_at.desc&limit=100'),
      ]);
      const msgs=m.data, cache=c.data;
      // `ident` is resolved once in the chat_all view and read by BOTH this fetch and
      // the RPC. It used to be derived here in JS and again in SQL from the same rule,
      // which is exactly how the two drifted: the RPC keyed WhatsApp rows on the phone
      // and web rows on the display name, so one person showed up as two reps.
      // See db/2026-07-28-single-identity.sql §5.
      //
      // The Reps tab reads u.msgs[0].User_Message for the latest-question preview;
      // the RPC returns just that value, so re-wrap it in the shape the UI expects.
      const users = (agg?.users || []).map(u => ({
        ...u, msgs: u.lastQuestion ? [{ User_Message: u.lastQuestion }] : [],
      }));
      // Key uid:/web: reps on the raw identity — clean() strips non-digits and would
      // shred a uuid. Phone reps stay keyed on their digits.
      _repNames = Object.fromEntries(
        users.filter(u=>u.name)
             .map(u=>[isUidRep(u.number)||isWebRep(u.number) ? u.number : clean(u.number), u.name]));
      const topQ = agg?.top_questions || [];
      const cacheHits = agg?.cache_hits ?? 0;
      const cacheMisses = agg?.cache_misses ?? 0;
      const totalMsgs = agg?.total_msgs ?? 0;
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
      setDemo(false);
    } catch {
      setStats(demoStats());
      setDemo(true);
    }
    setLastUp(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [onAuthError, channelFilter]);

  // Poll every 30s, but ONLY while the tab is actually being looked at. Polling a
  // backgrounded tab burns phone battery and mobile data for data nobody is reading —
  // and this dashboard is used on a phone. On return we refetch immediately rather
  // than waiting out the interval, so you never stare at stale numbers.
  useEffect(()=>{
    load();
    let iv = null;
    const start = () => { if (!iv) iv = setInterval(()=>load(true), 30000); };
    const stop  = () => { if (iv) { clearInterval(iv); iv = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { load(true); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  },[load]);

  return {stats,loading,demo,lastUp,refreshing,refresh:()=>load(true),channelFilter,setChannelFilter};
}

// ── Profile (role + employee mapping) ─────────────────────────────────────────
// Reads the signed-in user's own app_users row. Cached in localStorage so a
// reload doesn't flash the wrong tab set. An account with no profile row falls
// back to 'employee' (the most restrictive role → sees only its own expenses),
// never to an elevated one.
//
// The user_id filter is NOT redundant with RLS. This query used to carry no
// filter at all and leaned on the self-read policy to return exactly one row —
// so the day an admin-read policy was added (app_users_admin_read, needed by
// dashboard_stats to resolve identities), admins started getting all eight rows
// and data[0] silently became whoever sorts first. That was Asad, an employee,
// so every admin login rendered as Asad AND lost its admin tabs.
//
// Never let RLS be the reason a [0] is correct: filter for the row you want.
const ROLE_LS = 'ht_role';
function useProfile(onAuthError) {
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ROLE_LS) || 'null'); } catch { return null; }
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token;
      try { token = await getAccessToken(); } catch { onAuthError?.(); return; }
      try {
        const uid = currentUserId();
        if (!uid) { onAuthError?.(); return; }
        const { data } = await sbFetch(token, 'app_users', `select=role,full_name,phone,email&user_id=eq.${uid}`);
        if (cancelled) return;
        const p = data[0] || { role: 'employee', full_name: null };
        setProfile(p);
        localStorage.setItem(ROLE_LS, JSON.stringify(p));
      } catch { /* keep last-known profile */ }
    })();
    return () => { cancelled = true; };
  }, [onAuthError]);
  return profile;
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

// The chat Panel's entrance, replacing the `fadeUp` that Panel carries by default.
// Two reasons it has to differ, and the first is a bug fix:
//
// NO `y`. Panel's default fadeUp translates 10px, and the enlarged chat panel is
// position:fixed and fills the viewport below the header — so that translate slid
// the whole surface down, opening a 10px gap under the nav and pushing the composer
// past the bottom edge for the length of the animation. A transform on it also makes
// it the containing block for any fixed descendant. Opacity does neither: it creates
// a stacking context, not a containing block. On a panel this size the fade IS the
// entrance; the movement belongs to the rows inside it.
//
// It also staggers, which plain `fadeUp` cannot — that is what gives the tab
// something to render on the way in rather than arriving in a single frame.
const chatPanel = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.18, ease: [0.22,1,0.36,1], staggerChildren: 0.06, delayChildren: 0.04 } },
};

// ── Content expand modal (portal-rendered, used for heatmap + inline panels) ──
function ContentModal({ title, sub, open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
          transition={{duration:0.2}}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-10"
          style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(4px)'}}
          onClick={onClose}
        >
          <motion.div
            initial={{opacity:0,scale:0.96,y:16}} animate={{opacity:1,scale:1,y:0}}
            exit={{opacity:0,scale:0.96,y:16}}
            transition={{duration:0.22,ease:[0.22,1,0.36,1]}}
            onClick={e=>e.stopPropagation()}
            className="w-full max-w-5xl bg-surface rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-7 py-5 border-b border-zinc-100">
              <div>
                <h2 className="text-[16px] font-semibold text-zinc-900 tracking-tight">{title}</h2>
                {sub && <p className="text-[14px] text-zinc-500 mt-0.5">{sub}</p>}
              </div>
              <button onClick={onClose} aria-label="Close"
                className="flex items-center justify-center w-9 h-9 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors outline-none">
                <X size={16}/>
              </button>
            </div>
            <div className="p-7 overflow-auto max-h-[72vh]">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

// Soft-shadow card — depth through shadow, not a heavy border
const Panel = ({children, className='', hover=false, ...rest}) => (
  <motion.div
    variants={fadeUp}
    whileHover={hover ? {
      boxShadow:'0 4px 24px -4px rgba(30,41,59,0.16)',
      transition:{duration:0.15}
    } : undefined}
    className={`bg-surface border border-zinc-100 rounded-xl shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)] ${className}`}
    {...rest}
  >
    {children}
  </motion.div>
);

// Mono uppercase micro-label — the system's field-tag voice
const Label = ({children, className=''}) => (
  <span className={`mono text-[11px] font-medium tracking-[0.02em] text-zinc-500 ${className}`}>{children}</span>
);

// The zoom in force at an element — measured, not assumed. `.app-scale`
// (index.css) enlarges the page body, and the two ways to measure an element
// disagree under it by exactly that factor: getBoundingClientRect() reports
// VISUAL pixels, offsetWidth reports LAYOUT pixels. Their ratio is the scale.
//
// Measuring beats reading --app-scale, for two reasons. It stays right for
// anything rendered outside the scaled region — the Chat tab opts out, so a
// global constant would be a lie there. And on a browser that ignores `zoom` it
// returns 1, which collapses every conversion below back to the original
// arithmetic instead of pushing overlays off their triggers.
const zoomOf = (el) => {
  const w = el?.offsetWidth;
  if (!w) return 1;
  const z = el.getBoundingClientRect().width / w;
  return z > 0 ? z : 1;
};

// Hover tooltip for metric labels — portal-rendered so overflow:hidden panels can't clip it.
function HintIcon({ text }) {
  const ref   = useRef(null);
  const [pos, setPos] = useState(null);
  const show = () => {
    if (!ref.current) return;
    // The tooltip is portalled to <body>, outside the body's content scale, so it
    // carries the scale itself and its coordinates are converted to match: a
    // zoomed element multiplies its own left/top by that factor, so divide the
    // visual rect going in. The 220 cap and the 7px gap are unzoomed design
    // values; only the clamp, which works in viewport pixels, needs the visual one.
    const z   = zoomOf(ref.current);
    const r   = ref.current.getBoundingClientRect();
    const vpW = window.innerWidth;
    const W   = 220 * z;
    let x = r.left + r.width / 2;
    if (x - W / 2 < 8)       x = W / 2 + 8;
    if (x + W / 2 > vpW - 8) x = vpW - W / 2 - 8;
    setPos({ x: x / z, y: r.bottom / z + 7, z });
  };
  return (
    <>
      <button ref={ref} type="button" tabIndex={0}
        onMouseEnter={show} onMouseLeave={()=>setPos(null)}
        onFocus={show}      onBlur={()=>setPos(null)}
        aria-label={text}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded text-zinc-400 hover:text-zinc-600 outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 transition-colors"
      >
        <Info size={10}/>
      </button>
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              key="hint"
              initial={{opacity:0, y:-4, scale:0.97}}
              animate={{opacity:1, y:0,  scale:1}}
              exit={{opacity:0,   y:-4,  scale:0.97}}
              transition={{duration:0.12, ease:[0.22,1,0.36,1]}}
              style={{
                position:'fixed', left:pos.x, top:pos.y,
                transform:'translateX(-50%)',
                zoom:pos.z,
                background:INK,
                zIndex:400,
              }}
              className="pointer-events-none max-w-[220px] px-3 py-2 rounded-lg text-[11.5px] text-white leading-snug shadow-[0_8px_24px_-4px_rgba(0,0,0,0.4)]"
            >
              {text}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

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

// Circular avatar with deterministic pastel color per rep
const Tag = ({number, lg=false}) => {
  const {bg, fg} = avatarColor(number);
  return (
    <div
      className={`${lg?'w-10 h-10 text-[13px]':'w-7 h-7 text-[11px]'} rounded-full flex items-center justify-center font-bold shrink-0`}
      style={{background: bg, color: fg}}
    >
      {initials(number)}
    </div>
  );
};

// Secondary action — ghost button matching the system (white, hairline, ink on hover)
const ExportButton = ({exportFn, disabled=false, label='Export'}) => {
  const ctx = useContext(ToastContext);
  const handleClick = async () => {
    if (!exportFn) return;
    ctx?.pushToast({state:'preparing', msg:'Preparing CSV export…'});
    await new Promise(r => setTimeout(r, 60));
    exportFn();
    ctx?.pushToast({state:'done', msg:'Export complete!'});
  };
  return (
    <button
      onClick={handleClick} disabled={disabled}
      aria-label={`${label} as CSV`} title={`${label} as CSV`}
      className="flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] shrink-0 rounded-lg bg-surface border border-zinc-300 text-zinc-700 text-[12px] font-semibold tracking-tight transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download size={13}/>
      <span>{label}</span>
    </button>
  );
};

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

const ToastContext = createContext(null);
function ToastPortal() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  const { toast } = ctx;
  return createPortal(
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{opacity:0, y:14, scale:0.96}}
          animate={{opacity:1, y:0,  scale:1}}
          exit={{opacity:0,   y:8,   scale:0.96}}
          transition={{duration:0.2, ease:[0.22,1,0.36,1]}}
          className="fixed bottom-6 right-6 z-[300] flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-medium text-white shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35)]"
          style={{background:INK}}
          role="status" aria-live="polite"
        >
          {toast.state === 'preparing'
            ? <motion.div animate={{rotate:360}} transition={{duration:0.7,repeat:Infinity,ease:'linear'}}><RefreshCw size={13} className="text-zinc-400"/></motion.div>
            : <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
          }
          <span>{toast.msg}</span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
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
                  style={{background: c===0 ? 'var(--color-zinc-100)' : tint(ACCENT, a*100)}}/>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
// One flagged reply. Collapsed it shows the question; expanded it shows what the
// bot actually said plus the rep's note — the point of the panel is that a 👎 is
// reconstructable, so the answer has to be one click away, not a DB query away.
function BadResponseRow({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5">
      <button type="button" onClick={()=>setOpen(o=>!o)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg">
        <span className="w-1.5 h-1.5 rotate-45 shrink-0" style={{background:ACCENT}}/>
        <span className="flex-1 min-w-0 text-[14px] text-zinc-800 truncate">{trunc(r.user_message || '(no question captured)', 72)}</span>
        {r.from_cache && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded hidden sm:inline"
            style={{color:BLUE, background:'var(--info-bg)'}}>CACHED</span>
        )}
        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 hidden sm:inline">
          {REASON_LABEL[r.reason] || r.reason}
        </span>
        <span className="text-[11px] text-zinc-400 shrink-0">{ago(r.created_at)}</span>
        <ChevronDown size={13} className={`shrink-0 text-zinc-400 transition-transform ${open?'rotate-180':''}`}/>
      </button>
      {/* Below sm the badges are hidden above to keep the row on one line, so
          repeat them here — otherwise a phone never sees the reason at all. */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pl-4 sm:hidden">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{REASON_LABEL[r.reason] || r.reason}</span>
        {r.from_cache && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{color:BLUE, background:'var(--info-bg)'}}>CACHED</span>}
      </div>
      {open && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-zinc-200 space-y-2">
          {r.note && <p className="text-[12.5px] text-zinc-700"><span className="text-zinc-400">Rep said:</span> {r.note}</p>}
          <p className="text-[12.5px] text-zinc-500 whitespace-pre-wrap break-words">{trunc(r.ai_response || '(no reply captured)', 600)}</p>
          <p className="text-[11px] text-zinc-400">
            {r.user_name || 'unknown'}
            {/* Three distinct states, and the difference is what to do next.
                Reports filed before auto-purge shipped default to 0, so they
                correctly keep the old do-it-by-hand warning. */}
            {r.cache_purged > 0
              ? ` · ${r.cache_purged === 1 ? 'cached copy' : `${r.cache_purged} cached copies`} removed automatically — this reply won't be served again`
              : r.from_cache
                ? ' · served from cache and NOT purged — delete the semantic_cache row by hand, or a prompt fix will look like it did nothing'
                : ''}
          </p>
        </div>
      )}
    </li>
  );
}

function OverviewTab({s, onDrill}) {
  const delta  = s.todayCount - s.ystCount;
  const total  = useCountUp(s.totalMsgs);
  const peak   = heatPeak(s.heat);
  const [heatExpanded, setHeatExpanded] = useState(false);
  const ledger = [
    {label:'Today',       value:s.todayCount, delta, hint:'Messages today, compared with yesterday'},
    {label:'Active reps', value:s.userCount,         hint:'Reps who messaged Hi Tech AI in this period'},
    {label:'Cache',       value:s.cacheTotal,        hint:'Answers served instantly from cache — no AI call'},
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      <HelpNote>Headline counts for the loaded period. "Today" shows the change vs yesterday; "Cache" is answers served instantly without an AI call.</HelpNote>

      {/* Readout cluster — one instrument panel, hero + ledger, divided by hairlines */}
      <Panel className="grid grid-cols-1 md:grid-cols-[1.6fr_repeat(3,1fr)] divide-y md:divide-y-0 md:divide-x divide-zinc-200 overflow-hidden">
        {/* Primary readout */}
        <div className="p-6">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Label>Total messages</Label>
              <HintIcon text="All messages exchanged with Hi Tech AI, across every rep"/>
            </span>
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
            <span className="text-[12px] text-zinc-400">vs yesterday</span>
          </div>
        </div>
        {/* Ledger cells */}
        {ledger.map(c=>(
          <div key={c.label} className="p-6 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Label>{c.label}</Label>
                {c.hint && <HintIcon text={c.hint}/>}
              </span>
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
          <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Most asked</h2>
          <p className="text-[14px] text-zinc-500 mt-1 mb-5">By topic — paraphrases merged</p>
          <HelpNote>Grouped by Hi Tech AI’s answer, so different wordings of the same question count as one topic. "2 phrasings merged" shows when wordings were combined.</HelpNote>
          <div className="space-y-3.5">
            {s.topQ.slice(0,6).map((q,i)=>(
              <button key={i} type="button"
                onClick={()=>onDrill({type:'answer', answer:q.answer, label:q.text})}
                aria-label={`Show conversations for: ${q.text}`}
                className="group block w-full text-left -mx-2 px-2 py-1 rounded-lg transition-colors hover:bg-zinc-50 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[14px] text-zinc-700 group-hover:text-zinc-900 truncate">{trunc(q.text,40)}</span>
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
                  <p className="text-[11px] text-zinc-400 mt-1">{q.variants} phrasings merged</p>
                )}
              </button>
            ))}
          </div>
        </Panel>

        {/* Recent activity — mono log feed, diamond markers, latest in accent */}
        <Panel className="p-6">
          <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Recent activity</h2>
          <p className="text-[14px] text-zinc-500 mt-1 mb-4">Live message log</p>
          <HelpNote>The latest messages reps sent Hi Tech AI, newest first.</HelpNote>
          <div>
            {s.recent.slice(0,7).map((m,i)=>(
              <motion.div key={i}
                whileHover={{x:2,transition:{duration:0.12}}}
                className="flex items-start gap-3 py-2.5 border-t border-zinc-100 first:border-t-0 cursor-default">
                <span className="mt-[7px] w-1.5 h-1.5 rotate-45 shrink-0"
                  style={{background: i===0 ? ACCENT : INK}}/>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-zinc-800 truncate leading-snug">{trunc(m.User_Message,46)}</p>
                  <p className="text-[12px] text-zinc-500 mt-0.5 truncate">
                    {repName(m.ident)} · {ago(m.Timestamp)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Bad responses — replies the reps flagged. Replaces "Knowledge gaps", which
          keyed on short replies and, measured over 128 turns, never once fired. */}
      <Panel className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Bad responses</h2>
            <p className="text-[14px] text-zinc-500 mt-1">Replies reps flagged as wrong</p>
          </div>
          {s.badResponses?.length > 0 && (
            <ExportButton
              exportFn={()=>exportCSV('bad-responses', [
                {label:'When',     get:r=>new Date(r.created_at).toISOString()},
                {label:'Reason',   get:r=>REASON_LABEL[r.reason] || r.reason},
                {label:'Question', get:r=>r.user_message},
                {label:'Reply',    get:r=>r.ai_response},
                {label:'Note',     get:r=>r.note},
                {label:'Cached',   get:r=>r.from_cache ? 'yes' : 'no'},
                {label:'Purged',   get:r=>r.cache_purged ?? 0},
                {label:'Rep',      get:r=>r.user_name},
              ], s.badResponses)}
            />
          )}
        </div>
        <HelpNote>Answers a rep marked “Bad answer” in the Chat tab, newest first. Click a row to see what the bot actually replied. A <strong>CACHED</strong> badge means the reply came from the semantic cache — delete that cache row, or a prompt fix will look like it changed nothing.</HelpNote>
        {(() => {
          const rows = s.badResponses || [];
          if (!rows.length) return (
            <div className="py-10 text-center">
              <p className="text-[13px] text-zinc-500">Nothing flagged</p>
              <p className="text-[12px] text-zinc-500 mt-2">Reps haven’t reported a bad answer yet.</p>
            </div>
          );
          // Reason counts up top: which failure mode dominates is the thing that
          // decides what to fix next, and that's lost in a flat reverse-chron list.
          const byReason = Object.entries(
            rows.reduce((a,r)=>{ a[r.reason]=(a[r.reason]||0)+1; return a; }, {})
          ).sort((a,b)=>b[1]-a[1]);
          return (
            <>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {byReason.map(([id,n])=>(
                  <span key={id} className="text-[11px] px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700">
                    {REASON_LABEL[id] || id} <span className="mono font-semibold tabular-nums">{n}</span>
                  </span>
                ))}
              </div>
              <ul className="mt-2 divide-y divide-zinc-100">
                {rows.map(r => <BadResponseRow key={r.id} r={r}/>)}
              </ul>
            </>
          );
        })()}
      </Panel>

      {/* Busiest hours — weekday × hour heatmap */}
      {s.heat && (
        <Panel className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Busiest hours</h2>
              <p className="text-[14px] text-zinc-500 mt-1">When reps message — by weekday &amp; hour</p>
            </div>
            <div className="flex items-start gap-4 shrink-0">
              <div className="text-right">
                <Label>Peak</Label>
                <p className="mono text-[14px] font-bold text-zinc-900 mt-1">
                  {peak.c>0 ? `${DAY[peak.d]} ${fmtHour(peak.h)}` : '—'}
                </p>
              </div>
              <button onClick={() => setHeatExpanded(true)} aria-label="Expand heatmap" title="Click to expand"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 mt-0.5">
                <Maximize2 size={14}/>
              </button>
            </div>
          </div>
          <HelpNote>When reps message Hi Tech AI, by weekday and hour. Darker cells = busier; hover a cell for the exact count.</HelpNote>
          <div className="mt-4" role="img"
            aria-label={peak.c>0 ? `Activity heatmap. Busiest is ${DAY[peak.d]} at ${fmtHour(peak.h)} with ${peak.c} messages.` : 'Activity heatmap — no activity yet.'}>
            <Heatmap heat={s.heat}/>
          </div>
        </Panel>
      )}

      <ContentModal
        title="Busiest hours"
        sub={peak.c>0 ? `Peak: ${DAY[peak.d]} at ${fmtHour(peak.h)} — ${peak.c} messages` : 'When reps message Hi Tech AI'}
        open={heatExpanded}
        onClose={() => setHeatExpanded(false)}
      >
        {s.heat && <Heatmap heat={s.heat}/>}
      </ContentModal>
    </motion.div>
  );
}

// ── Paginator ─────────────────────────────────────────────────────────────────
// Hoisted to module scope so it has a stable identity across Paginator re-renders.
// Defined inline, it was a new component type every render, so React replaced the
// underlying <button> DOM node each time — which dropped keyboard focus off the
// prev/next control every time you changed page. It closes over nothing; it's pure props.
const NavBtn = ({ children, disabled, onClick }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className="flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-35 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors">
    {children}
  </button>
);

function Paginator({ page, total, perPage = PER_PAGE, onChange }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  const from = (page - 1) * perPage + 1;
  const to   = Math.min(page * perPage, total);

  // Always show 1 and last; cluster ±1 around current; fill with ellipses for gaps
  const raw    = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages));
  const sorted = [...raw].sort((a, b) => a - b);
  const items  = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push('…');
    items.push(sorted[i]);
  }

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3.5 border-t border-zinc-200">
      <span className="mono text-[11px] text-zinc-500 tabular-nums select-none">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-0.5">
        <NavBtn disabled={page === 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={13}/>
        </NavBtn>
        {items.map((item, i) =>
          item === '…'
            ? <span key={`e${i}`} className="mono text-[12px] text-zinc-400 w-7 text-center select-none">…</span>
            : <button key={item} type="button"
                onClick={() => onChange(item)}
                aria-current={item === page ? 'page' : undefined}
                className={`mono text-[12px] w-7 h-7 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${item === page ? 'font-semibold text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`}
                style={item === page ? { background: INK } : undefined}
              >{item}</button>
        )}
        <NavBtn disabled={page === totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={13}/>
        </NavBtn>
      </div>
    </div>
  );
}

// ── Conversations Tab ─────────────────────────────────────────────────────────
// Paged in the DATABASE, via the conversations_page RPC. Filtering and counting a
// slice of rows the client happened to hold made every filter a lie by omission
// once traffic outgrew the fetch: the array was cut AFTER both channels were
// merged, so "All" listed fewer messages of each channel than that channel's own
// chip did. Now the page you see and the total you are told come from the same
// complete set, and the tab costs 25 rows instead of 500.
function ConversationsTab({s, channelFilter, focusSignal, drill, onDrillConsumed, onAuthError}) {
  const [search,     setSearch]     = useState('');
  const [dq,         setDq]         = useState('');   // debounced search — one request per pause, not per keystroke
  const [filter,     setFilter]     = useState('all');
  const [expanded,   setExpanded]   = useState(null);
  const [topicDrill, setTopicDrill] = useState(null);   // {answer, label} from a Most-asked drill
  const [page,       setPage]       = useState(1);
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [busy,       setBusy]       = useState(true);
  const [err,        setErr]        = useState('');
  const searchRef = useRef(null);
  // Focus the search box when the parent fires the "/" shortcut.
  useEffect(()=>{ if (focusSignal) searchRef.current?.focus(); }, [focusSignal]);
  useEffect(()=>{ const t = setTimeout(()=>setDq(search.trim()), 300); return ()=>clearTimeout(t); }, [search]);
  // Reset to page 1 whenever the active filter set changes — page 7 of the old
  // result set is meaningless against the new one, and usually empty.
  useEffect(()=>{ setPage(1); setExpanded(null); }, [dq, filter, topicDrill, channelFilter]);

  // Apply an incoming drill (Most-asked → answer filter, rep card → rep filter), then clear it upstream.
  useEffect(()=>{
    if (!drill) return;
    if (drill.type==='answer') { setTopicDrill({answer:drill.answer, label:drill.label}); setFilter('all'); setSearch(''); }
    else if (drill.type==='rep') { setFilter(drill.rep); setTopicDrill(null); setSearch(''); }
    onDrillConsumed?.();
  },[drill,onDrillConsumed]);

  // The filter set, in the shape the RPC wants. Shared by the page fetch and the
  // CSV export so the file can never disagree with what's on screen.
  const args = useMemo(()=>({
    p_channel: channelFilter === 'all' ? null : channelFilter,
    p_ident:   filter        === 'all' ? null : filter,
    p_search:  dq || null,
    p_answer:  topicDrill ? topicDrill.answer : null,
  }), [channelFilter, filter, dq, topicDrill]);

  // s.totalMsgs is the refresh trigger: it changes when the underlying data does
  // (the 30s poll, or the Refresh button), so the list stays live without this
  // effect firing on every unrelated parent render.
  useEffect(()=>{
    let cancelled = false;
    (async()=>{
      setBusy(true); setErr('');
      let token;
      try { token = await getAccessToken(); } catch { onAuthError?.(); return; }
      try {
        const d = await sbRpc(token, 'conversations_page',
          { ...args, p_limit: PER_PAGE, p_offset: (page-1)*PER_PAGE });
        if (cancelled) return;
        setRows(d?.rows || []); setTotal(d?.total || 0);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message || 'Could not load conversations.'); setRows([]); setTotal(0);
      } finally { if (!cancelled) setBusy(false); }
    })();
    return ()=>{ cancelled = true; };
  },[args, page, s.totalMsgs, onAuthError]);

  // Export every match, not the 25 on screen. Capped at the RPC's own ceiling.
  const exportAll = async () => {
    const token = await getAccessToken();
    const d = await sbRpc(token, 'conversations_page', { ...args, p_limit: 2000, p_offset: 0 });
    exportCSV('conversations', [
      {label:'Rep',         get:m=>repName(m.ident)},
      {label:'Phone',       get:m=>fmtPhone(m.person_phone)},
      {label:'Message',     get:m=>m.User_Message},
      {label:'AI response', get:m=>m.AI_Response},
      {label:'Timestamp',   get:m=>new Date(m.Timestamp).toISOString()},
    ], d?.rows || []);
  };

  const field = "bg-surface border border-zinc-300 rounded-lg text-[14px] text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20";

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
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
        <ExportButton disabled={!total} exportFn={exportAll}/>
      </motion.div>

      <HelpNote>Every message reps exchanged with Hi Tech AI, newest first. Search by text, filter by rep, click a row to see the full reply. Export sends all matches to CSV.</HelpNote>

      {topicDrill && (
        <motion.div variants={fadeUp}
          className="flex items-center gap-2 rounded-lg border px-3 py-2"
          style={{borderColor:tint(ACCENT,25), background:tint(ACCENT,5)}}>
          <span className="text-[11px] font-semibold shrink-0" style={{color:ACCENT_DK}}>Topic</span>
          <span className="text-[14px] text-zinc-800 truncate">{trunc(topicDrill.label,60)}</span>
          <button onClick={()=>setTopicDrill(null)} aria-label="Clear topic filter"
            className="ml-auto shrink-0 flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <X size={14}/>
          </button>
        </motion.div>
      )}

      {/* Log table */}
      {/* Dimmed, not blanked, while a refetch is in flight: the rows on screen are
          still the right answer to the previous question, and replacing them with a
          spinner on every page turn makes paging feel slower than it is. */}
      <Panel className={`overflow-hidden transition-opacity duration-150 ${busy && rows.length ? 'opacity-60' : ''}`}>
        <div className="hidden md:grid grid-cols-[1.8fr_3fr_1fr_28px] px-6 py-3 border-b border-zinc-200 bg-zinc-50">
          {['Rep','Message','Time',''].map((t,i)=>(
            <Label key={i}>{t}</Label>
          ))}
        </div>

        {err
          ? <div className="py-16 text-center">
              <p className="text-[13px]" style={{color:NEG}}>{err}</p>
              <p className="text-[12px] text-zinc-500 mt-2">The list will reload on the next refresh.</p>
            </div>
          : busy && !rows.length   /* cold load only — see the Panel comment above */
          ? <div className="py-16 text-center" role="status" aria-live="polite">
              <p className="text-[13px] text-zinc-500">Loading conversations…</p>
            </div>
          : !rows.length
          ? <div className="py-16 text-center">
              <p className="text-[13px] text-zinc-500">No conversations found</p>
              <p className="text-[12px] text-zinc-500 mt-2">Try a different search term, or set the rep filter back to "All reps".</p>
            </div>
          : rows.map((m)=>{
            const rowKey = `${m.Timestamp}__${m.ident}`;
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
                    <Tag number={m.ident}/>
                    <span className="text-[14px] text-zinc-900 font-medium truncate">{repName(m.ident)}</span>
                  </div>
                  <span className="order-3 md:order-none basis-full md:basis-auto text-[14px] text-zinc-500 truncate md:pr-4">{trunc(m.User_Message,52)}</span>
                  <span className="order-4 md:order-none basis-full md:basis-auto mono text-[11px] text-zinc-500 tabular-nums">{ago(m.Timestamp)}</span>
                  <div className="order-2 md:order-none ml-auto md:ml-0 flex items-center justify-center transition-colors"
                    style={{color: ex ? ACCENT : 'var(--muted)'}}>
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
                        <p className="text-[12px] text-zinc-400">
                          {repName(m.ident)} · {fmtPhone(m.person_phone)}
                        </p>
                        <div>
                          <p className="text-[12px] text-zinc-500 mb-1.5">Inbound</p>
                          <div className="rounded-lg p-3.5 bg-surface border border-zinc-300">
                            <p className="text-[14px] text-zinc-800 leading-relaxed">{m.User_Message}</p>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[12px] font-medium" style={{color:ACCENT_DK}}>Hi Tech AI</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={m.from_cache ? {color:BLUE, background:'var(--info-bg)'} : {color:'var(--color-zinc-600)', background:'var(--color-zinc-100)'}}>
                              {m.from_cache ? 'From cache' : 'AI call'}
                            </span>
                          </div>
                          <div className="rounded-lg p-3.5 bg-surface border border-zinc-300 max-h-36 overflow-y-auto">
                            <p className="text-[14px] text-zinc-600 leading-relaxed whitespace-pre-wrap">{m.AI_Response}</p>
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
        <Paginator page={page} total={total} onChange={p => { setPage(p); setExpanded(null); }}/>
      </Panel>
    </motion.div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({s, onDrill}) {
  if (!s.users.length) return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <Panel className="py-16 text-center">
        <p className="text-[13px] text-zinc-500">No reps yet</p>
        <p className="text-[12px] text-zinc-500 mt-2">Once reps message Hi Tech AI on WhatsApp, they’ll appear here ranked by activity.</p>
      </Panel>
    </motion.div>
  );
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <HelpNote>Your sales reps, ranked by how many messages they sent Hi Tech AI. Each card shows their message count, rank, latest question, and last-active time.</HelpNote>
      <motion.div variants={fadeUp} className="flex items-center justify-between gap-3">
        <p className="text-[14px] text-zinc-500">{s.users.length} {s.users.length===1?'rep':'reps'}</p>
        <ExportButton
          exportFn={()=>exportCSV('reps', [
            {label:'Rank',        get:r=>r._rank},
            {label:'Rep',         get:r=>repName(r.number)},
            // r.number is a uuid identity for anyone with a Team account, so the
            // number comes from the roster (dashboard_stats -> users[].phone).
            {label:'Phone',       get:r=>fmtPhone(r.phone)},
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
              <p className="flex items-center gap-1 text-[11px] text-zinc-500 mt-0.5 truncate">
                <Phone size={10} className="shrink-0 text-zinc-400"/>
                {fmtPhone(u.phone)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-b border-zinc-200 divide-x divide-zinc-200">
            {[['Messages', u.count.toLocaleString(), INK], ['Rank', `#${i+1}`, i===0 ? ACCENT : INK]].map(([l,v,c])=>(
              <div key={l} className="py-3.5 px-1 first:pr-3">
                <p className="mono text-[24px] font-bold leading-none tracking-tight" style={{color:c}}>{v}</p>
                <p className="text-[12px] text-zinc-400 mt-1.5">{l}</p>
              </div>
            ))}
          </div>
          {u.msgs[0] && (
            <div className="mt-4 rounded-lg px-3 py-2.5" style={{background:'var(--surface-2)'}}>
              <p className="text-[12px] text-zinc-500 leading-snug">{trunc(u.msgs[0].User_Message,56)}</p>
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-3.5">
            <Clock size={11} className="text-zinc-400 shrink-0"/>
            <span className="text-[12px] text-zinc-400">Last active {ago(u.lastActive)}</span>
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
  const [cachePage, setCachePage] = useState(1);
  const cells = [
    {label:'Hit rate',   value:`${pct}%`,          icon:Zap,      hint:'Share of messages answered from cache instead of calling the AI', accent:true},
    {label:'From cache', value:s.cacheHits ?? 0,   icon:Database, hint:'Messages answered instantly from cache — AI calls (and their cost/latency) saved'},
    {label:'AI calls',   value:s.cacheMisses ?? 0, icon:Cpu,      hint:'Messages that required a live AI call (cache miss)'},
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <HelpNote>"Hit rate" is the share of reps’ messages answered straight from cache. Every cache hit is one AI call — and its cost and latency — saved.</HelpNote>

      <Panel className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 overflow-hidden">
        {cells.map(c=>(
          <div key={c.label} className="p-6 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Label>{c.label}</Label>
                {c.hint && <HintIcon text={c.hint}/>}
              </span>
              <c.icon size={14} style={c.accent ? {color:BLUE} : undefined} className={c.accent ? '' : 'text-zinc-500'}/>
            </div>
            <span className="mono text-[30px] leading-none font-bold tracking-tight"
              style={{color: c.accent ? BLUE : INK}}>
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
          <div style={{width:`${pct}%`, background:BLUE}}/>
        </div>
        <div className="flex justify-between mt-2 text-[12px]">
          <span style={{color:ACCENT_DK}}>{pct}% from cache</span>
          <span className="text-zinc-500">{100-pct}% AI</span>
        </div>
      </Panel>

      {/* Hit rate over time — is the cache improving as it fills? */}
      {trend.length >= 2 && (
        <Panel className="p-6">
          <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Hit rate over time</h2>
          <p className="text-[14px] text-zinc-500 mt-1">Daily — is the cache improving?</p>
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
            <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Cached queries</h2>
            <p className="text-[12px] text-zinc-500 mt-1 leading-snug">Questions Hi Tech AI has answered before — served instantly from cache instead of calling the AI. {(s.cacheTotal||0).toLocaleString()} cached in total, most recent first.</p>
          </div>
          <ExportButton
            disabled={!s.cacheEntries.length}
            exportFn={()=>exportCSV('cache', [
              {label:'Query',     get:c=>c.query_text},
              {label:'Cached at', get:c=>new Date(c.created_at).toISOString()},
            ], s.cacheEntries)}
          />
        </div>
        {!s.cacheEntries.length
          ? <div className="py-16 text-center">
              <p className="text-[13px] text-zinc-500">Nothing cached yet</p>
              <p className="text-[12px] text-zinc-500 mt-2">Hi Tech AI caches answers as reps ask new questions — entries will appear here.</p>
            </div>
          : <>
              {s.cacheEntries.slice((cachePage-1)*PER_PAGE, cachePage*PER_PAGE).map((c,i) => {
                const absIdx = (cachePage - 1) * PER_PAGE + i;
                return (
                  <div key={absIdx} className="flex items-baseline gap-4 px-6 py-3.5 border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
                    <span className="mono text-[11px] text-zinc-400 w-7 shrink-0 text-right tabular-nums">{String(absIdx+1).padStart(2,'0')}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] text-zinc-700 truncate">{trunc(c.query_text,82)}</span>
                    </span>
                    <span className="mono text-[11px] text-zinc-500 shrink-0 tabular-nums">{ago(c.created_at)}</span>
                  </div>
                );
              })}
              <Paginator page={cachePage} total={s.cacheEntries.length} onChange={setCachePage}/>
            </>
        }
      </Panel>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton() {
  const block = "rounded-xl bg-surface border border-zinc-100 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)] animate-pulse";
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
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

// ── Chat Tab ──────────────────────────────────────────────────────────────────
// Talk to the n8n assistant live from inside the dashboard. Posts to the n8n
// webhook (VITE_N8N_CHAT_WEBHOOK), which runs the same AI/RAG path as the WhatsApp
// bot and writes each turn to web_chat_histories (separate table → web traffic
// never distorts the WhatsApp rep analytics). This session's history is restored
// on mount so a page refresh doesn't lose the thread.

const genSessionId = () =>
  globalThis.crypto?.randomUUID?.() ?? `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// The rendered thread — including image URLs, which the DB doesn't store — lives
// in localStorage so it survives tab switches and reloads. Keyed per session.
const threadKey  = sid => `ht_web_chat_thread_${sid}`;
// Which session this browser is on, per signed-in user. Named rather than inlined
// because three places have to agree on it: the boot resolver, "New chat", and the
// check for whether a session pre-dates this page load.
const sessionKey = user => `ht_web_chat_session_${user}`;
const loadThread = sid => { try { return JSON.parse(localStorage.getItem(threadKey(sid)) || '[]'); } catch { return []; } };

// The signed-in username, pulled from the JWT, to tag rows (Name column).
function jwtPayload() {
  try {
    const s = JSON.parse(localStorage.getItem('ht_session') || 'null');
    // JWT uses base64url (- and _ instead of + and /); atob() needs standard base64.
    const b64 = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch { return null; }
}
function currentUserName() {
  const p = jwtPayload();
  return p ? ((p.email || '').split('@')[0] || null) : null;
}
function currentUserId() {
  return jwtPayload()?.sub || null;
}

// Headers for the chat webhook, carrying the signed-in user's bearer token. The
// webhook is being moved behind JWT validation (see SECURITY.md) — this is the
// client half. Best-effort ON PURPOSE: until the workflow enforces the token, a
// failure here must not break chat, and every dashboard user is signed in anyway.
// Once the server validates it, an absent/expired token is correctly rejected
// there, and the workflow can derive Name from the JWT instead of trusting the
// body — closing the attribution-spoofing gap.
async function chatWebhookHeaders() {
  const h = { 'Content-Type': 'application/json' };
  try { const t = await getAccessToken(); if (t) h.Authorization = `Bearer ${t}`; }
  catch { /* not signed in — the server will reject once validation is live */ }
  return h;
}

// Normalize n8n's webhook response → { text, images, from_cache }. The cloned
// workflow answers with { reply, images }, but we check the other common field
// names too so a tweak to the "Respond to Webhook" node won't break the UI.
async function parseChatReply(res) {
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* plain-text response */ }
  if (data == null) return { text: raw.trim() || '(empty response)', images: [], from_cache: false };
  const obj = Array.isArray(data) ? (data[0] ?? {}) : data;
  if (typeof obj === 'string') return { text: obj, images: [], from_cache: false };
  const t = obj.reply ?? obj.output ?? obj.response ?? obj.text ?? obj.message ?? obj.answer ?? obj.AI_Response ?? '';
  const imgs = obj.images ?? obj.image_urls ?? [];
  return {
    text: (typeof t === 'string' && t) ? t : JSON.stringify(obj),
    images: Array.isArray(imgs) ? imgs.filter(u => typeof u === 'string' && u.startsWith('https://')) : [],
    from_cache: !!(obj.from_cache ?? obj.cached),
    // Post-Romanizer text for voice notes (see n8n's "Respond Success" node); empty
    // string for a typed message, which the browser just ignores.
    transcript: obj.transcript ?? '',
  };
}

// Response shape for the transcribe-only call (Layer 3 of the hallucination fix,
// step 1 of the two-round-trip voice flow): { has_speech, transcript }. The workflow
// no longer answers the question on this call — see
// docs/superpowers/specs/2026-07-14-voice-hallucination-fix-design.md.
async function parseTranscribeReply(res) {
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* non-JSON body — treat as no speech */ }
  const obj = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
  return {
    has_speech: !!obj.has_speech,
    transcript: typeof obj.transcript === 'string' ? obj.transcript : '',
  };
}

// M:SS for the recording timer and the preview player's duration readout.
const fmtClock = ms => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// The assistant replies in WhatsApp style: *single-asterisk bold* and \n line
// breaks (the web clone shares the WhatsApp semantic_cache, so cached hits arrive
// pre-formatted that way). Render *bold* via React nodes — never innerHTML.
// Knowledge-base answers cite a source URL, so links are turned into real anchors.
// Only http(s) is matched, so a javascript:/data: URL in a reply can never become a
// clickable href. Still React nodes throughout — never innerHTML.
const REPLY_TOKEN = /(\*[^*\n]+\*|https?:\/\/[^\s<>"']+)/g;

function formatReply(text) {
  return String(text).split(REPLY_TOKEN).map((p, i) => {
    if (/^\*[^*\n]+\*$/.test(p)) return <strong key={i} className="font-semibold">{p.slice(1, -1)}</strong>;
    if (/^https?:\/\//i.test(p)) {
      // Trailing punctuation is almost always the sentence's, not the URL's —
      // "see https://x.com/page." should link the page, not a 404 ending in a dot.
      const m = p.match(/^(.*?)([.,;:!?)\]}'"]*)$/);
      const href = m[1], tail = m[2];
      return (
        <span key={i}>
          <a href={href} target="_blank" rel="noreferrer noopener"
             className="underline underline-offset-2 break-all hover:opacity-80 transition-opacity"
             style={{ color: BLUE }}>{href}</a>
          {tail}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Hi Tech AI is typing">
      {[0,1,2].map(i=>(
        <motion.span key={i}
          className="w-1.5 h-1.5 rounded-full bg-zinc-400"
          animate={{opacity:[0.3,1,0.3], y:[0,-2,0]}}
          transition={{duration:0.9, repeat:Infinity, ease:'easeInOut', delay:i*0.15}}
        />
      ))}
    </span>
  );
}

const AssistantTag = ({error=false, from_cache=false}) => (
  <span className="flex items-center gap-1.5 px-1">
    <span className="flex items-center justify-center w-4 h-4 rounded" style={{background:tint(ACCENT,10)}}>
      <Bot size={11} style={{color:ACCENT_DK}}/>
    </span>
    <span className="mono text-[10px] uppercase tracking-widest" style={{color: error ? NEG : ACCENT_DK}}>
      {error ? 'Error' : 'Hi Tech AI'}
    </span>
    {from_cache && (
      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{color:BLUE, background:'var(--info-bg)'}}>From cache</span>
    )}
  </span>
);

// Gemini OCR takes several seconds with no progress to report, so a single static
// line reads as a hang. Cycling stage labels name what's plausibly happening and
// keep the card visibly alive. The labels are indicative, not measured — they're
// paced slower than the usual round-trip so the last one holds rather than the
// list looping and implying a stall.
const OCR_STAGES = ['Reading receipt…', 'Finding the vendor…', 'Reading the total…', 'Sorting the category…', 'Almost there…'];

function OcrProgress({ reduce }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(n => Math.min(n + 1, OCR_STAGES.length - 1)), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <RefreshCw size={13} className={reduce ? '' : 'animate-spin'} style={{ color: ACCENT }}/>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={i}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="text-[13px] font-semibold text-zinc-800">
          {OCR_STAGES[i]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// A receipt preview bubble: shows extracted fields with Accept / Reject. Until the
// user accepts, NOTHING is saved server-side. Reject is purely local.
function ReceiptCard({ card, onAccept, onReject }) {
  const reduce = useReducedMotion();
  const scanning = card.status === 'extracting';
  const f = card.fields || {};
  const rows = [
    ['Vendor', f.vendor_name || '—'],
    ['Total', `PKR ${(Number(f.total) || 0).toLocaleString('en-US')}`],
    ['Category', f.category || 'Other'],
    ['Date', f.date || '—'],
  ];
  return (
    <div className="max-w-[420px] rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm">
      {/* While scanning there is nothing to confirm yet, so the header states what's
          happening instead of asking a question about empty fields. */}
      <div className="flex items-center gap-2 mb-3">
        <Receipt size={15} className="text-zinc-500" />
        <span className="text-[13px] font-semibold text-zinc-800">{scanning ? 'Scanning receipt' : 'Is this right?'}</span>
      </div>
      {card.thumb && (
        <div className="relative overflow-hidden rounded-lg mb-3 border border-zinc-100">
          <img src={card.thumb} alt="receipt" className="max-h-40 w-auto block"/>
          {/* Scan line sweeping the image — the clearest signal that the RECEIPT
              itself is being read, rather than something generic loading. */}
          {scanning && !reduce && (
            <motion.div
              className="absolute inset-x-0 h-1/3 pointer-events-none"
              style={{ background:`linear-gradient(to bottom, transparent, ${tint(ACCENT,28)}, transparent)` }}
              initial={{ top:'-33%' }} animate={{ top:'100%' }}
              transition={{ duration:1.6, repeat:Infinity, ease:'easeInOut' }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {/* Shimmering placeholders instead of a column of em-dashes: it reads as
          "these are coming" rather than "these came back empty". */}
      {scanning ? (
        <dl className="space-y-1.5 mb-3">
          {rows.map(([k]) => (
            <div key={k} className="flex justify-between items-center gap-4 text-[13px]">
              <dt className="text-zinc-400">{k}</dt>
              <dd className="flex-1 max-w-[140px]">
                <motion.span className="block h-3 rounded bg-zinc-200"
                  animate={reduce ? undefined : { opacity:[0.45,0.9,0.45] }}
                  transition={{ duration:1.2, repeat:Infinity, ease:'easeInOut' }}/>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="space-y-1.5 mb-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 text-[13px]">
              <dt className="text-zinc-400">{k}</dt><dd className="text-zinc-800 font-medium text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {scanning && <OcrProgress reduce={reduce}/>}
      {card.status === 'pending' && (
        <div className="flex gap-2">
          <button onClick={onAccept} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-on-ink text-[13px] font-semibold py-2 hover:bg-accent transition-colors">
            <CheckCircle2 size={14} /> Confirm & save
          </button>
          <button onClick={onReject} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 text-zinc-700 text-[13px] font-medium px-3 py-2 hover:border-zinc-900 transition-colors">
            <X size={14} /> Reject
          </button>
        </div>
      )}
      {card.status === 'saving' && <p className="text-[12.5px] text-zinc-500">Saving…</p>}
      {card.status === 'saved' && <p className="text-[12.5px] font-medium" style={{ color: POS }}>✓ Saved to your expenses.</p>}
      {card.status === 'rejected' && <p className="text-[12.5px] text-zinc-500">Discarded — upload it again, or contact the accountant if it keeps coming out wrong.</p>}
      {card.status === 'error' && <p className="text-[12.5px] text-zinc-500">Couldn’t read that receipt — attach a clearer photo, or contact the accountant.</p>}
      {card.status === 'notreceipt' && <p className="text-[12.5px] text-zinc-500">That doesn’t look like a receipt — attach a photo of the receipt itself.</p>}
      {card.status === 'expired' && <p className="text-[12.5px] text-zinc-500">This upload expired when you left the chat — please attach the receipt again.</p>}
    </div>
  );
}

// Copy a reply to the clipboard. Reps relay these answers to customers, so the
// text is copied RAW, *asterisks* included — that's WhatsApp's bold syntax and
// the usual destination, where it renders as intended rather than as literal
// punctuation. navigator.clipboard needs a secure context; the textarea fallback
// covers anything serving this over plain http.
function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const legacyCopy = (s) => {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { return document.execCommand('copy'); }
    finally { document.body.removeChild(ta); }   // remove even if the copy threw
  };

  const copy = async () => {
    const s = String(text ?? '');
    if (!s) return;
    let ok;
    try {
      await navigator.clipboard.writeText(s);
      ok = true;
    } catch {
      try { ok = legacyCopy(s); } catch { ok = false; }
    }
    if (!ok) return;
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  };

  return (
    <button type="button" onClick={copy} title="Copy this reply"
      aria-label={done ? 'Copied' : 'Copy this reply'}
      className="inline-flex items-center gap-1.5 min-h-[28px] px-1.5 text-[11px] text-zinc-400 rounded-md transition-colors hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {done
        ? <><Check size={12} style={{color:POS}}/> <span style={{color:POS}}>Copied</span></>
        : <><Copy size={12}/> Copy</>}
    </button>
  );
}

// Dislike-only feedback under an assistant reply. There is no "like" — only
// failures are actionable. A bare vote isn't actionable either, so the picker
// insists on a reason tag and the row we write carries the whole exchange.
//
// Reporting also evicts the reply from the semantic cache, which is why the
// confirmation distinguishes the two outcomes: a purge means the next rep to
// ask gets a fresh answer, no purge means the reply was never cached and the
// fix is a prompt or RAG change. Note this fires for uncached replies too — the
// workflow writes cacheable answers to the cache on the way out, so a reply
// tagged "AI call" is usually already sitting in the cache by the time the rep
// reads it. See src/feedback.js.
function BadAnswerButton({ m, question, sessionId }) {
  const [open, setOpen]     = useState(false);
  const [reason, setReason] = useState(null);
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(null);   // null = not sent; else { purged }
  const [err, setErr]       = useState('');

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true); setErr('');
    try {
      const { purged } = await submitFeedback({
        sessionId, turnTs: m.ts, userMessage: question,
        aiResponse: m.text, fromCache: m.from_cache, reason, note,
      });
      setDone({ purged });
    } catch (ex) {
      setErr(ex?.message || "Couldn't send that.");
      setBusy(false);
    }
  };

  // Copy stays available after reporting — a wrong answer is often still worth
  // pasting somewhere, and losing the control on report would be a surprise.
  if (done) return (
    <div className="flex items-center flex-wrap gap-1">
      <CopyButton text={m.text}/>
      {/* min-w-0 + shrink-0: after a one-word reply the bubble column is only
          ~50px wide, and without these the tick gets squashed and the sentence
          overflows instead of wrapping. Checked at 320px. */}
      <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-zinc-400 px-1.5">
        <CheckCircle2 size={11} className="shrink-0"/>
        <span className="min-w-0">
          {done.purged > 0
            ? 'Thanks — logged, and cleared from cache.'
            : 'Thanks — logged for review.'}
        </span>
      </span>
    </div>
  );

  if (!open) return (
    <div className="flex items-center flex-wrap gap-1">
      <CopyButton text={m.text}/>
      <button type="button" onClick={() => setOpen(true)} title="Report a bad answer"
        className="inline-flex items-center gap-1.5 min-h-[28px] px-1.5 text-[11px] text-zinc-400 rounded-md transition-colors hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <ThumbsDown size={12}/> Bad answer
      </button>
    </div>
  );

  return (
    // Deliberately NOT w-full: the parent column is shrink-to-fit (items-start,
    // max-w-[80%]), so w-full would inherit the BUBBLE's width — and after a
    // one-word reply that's ~50px, which a 135px chip then overflows. Sizing to
    // its own content lets the panel widen up to the column cap and wrap there.
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-surface p-3">
      <p className="text-[12px] font-semibold text-zinc-700 mb-2">What went wrong?</p>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {REASONS.map(r => {
          const on = reason === r.id;
          return (
            <button key={r.id} type="button" onClick={() => setReason(r.id)} aria-pressed={on}
              className={`min-h-[36px] px-2.5 text-[11px] font-medium rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                on ? 'text-white border-transparent' : 'text-zinc-600 border-zinc-300 hover:border-zinc-900'}`}
              style={on ? { background: INK } : undefined}>
              {r.label}
            </button>
          );
        })}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
        placeholder="What were you expecting? (optional)"
        className="w-full px-2.5 py-2 text-[12px] text-zinc-900 bg-surface border border-zinc-300 rounded-lg outline-none transition-colors focus:border-zinc-900 placeholder-zinc-400"/>
      {err && <p className="text-[11px] mt-1.5" style={{ color: NEG }}>{err}</p>}
      <div className="flex gap-2 mt-2.5">
        <button type="button" onClick={send} disabled={!reason || busy}
          className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-zinc-900 text-on-ink text-[12px] font-semibold transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <><RefreshCw size={12} className="animate-spin"/> Sending…</> : 'Send'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(''); }}
          className="min-h-[36px] px-3 rounded-lg border border-zinc-300 text-zinc-600 text-[12px] font-medium transition-colors hover:border-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Thread skeleton — shown only while a session's history is being pulled back from
// the DB, which is the one path in this tab that waits on the network (localStorage
// is synchronous, so a thread already cached locally renders on the first frame and
// never sees this). Without it those turns render the "Ask me anything" empty state
// and then snap to a full conversation — the tab looked like it had nothing in it,
// then abruptly did, which reads as a glitch rather than as loading.
//
// Bubble-shaped rather than generic bars: the shape IS the content here, so it says
// "a conversation is coming back" instead of "something is coming back". Widths are
// staggered and the sides alternate so it reads as speech, not as a loading grid.
// Heights match ChatBubble's one- and two-line cases so nothing jumps when the real
// thread lands. The pulse is neutralised by the reduced-motion block in index.css.
function ChatThreadSkeleton() {
  const rows = [
    { user:false, w:'72%', h:'h-16' },
    { user:true,  w:'44%', h:'h-9'  },
    { user:false, w:'86%', h:'h-24' },
    { user:true,  w:'36%', h:'h-9'  },
    { user:false, w:'62%', h:'h-16' },
  ];
  return (
    <>
      <div className="space-y-4" aria-hidden="true">
        {rows.map((r, i) => (
          <div key={i} className={`flex ${r.user ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`${r.h} animate-pulse rounded-2xl ${r.user ? 'rounded-br-sm' : 'rounded-bl-sm border border-zinc-200 bg-surface'}`}
              style={{ width: r.w, maxWidth: '80%', ...(r.user ? { background: 'var(--color-zinc-200)' } : null) }}
            />
          </div>
        ))}
      </div>
      {/* The shapes are decorative; this is what the screen reader gets instead. */}
      <p role="status" className="sr-only">Loading conversation…</p>
    </>
  );
}

function ChatBubble({ m, question, sessionId }) {
  const isUser = m.role === 'user';
  return (
    <motion.div
      initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
      transition={{duration:0.22, ease:[0.22,1,0.36,1]}}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex flex-col gap-1.5 max-w-[80%] sm:max-w-[68%] ${isUser ? 'items-end' : 'items-start'}`}>
        {!isUser && <AssistantTag error={m.error} from_cache={m.from_cache}/>}
        <div
          className={`px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words rounded-2xl ${
            isUser ? 'text-white rounded-br-sm'
            : m.error ? 'rounded-bl-sm border'
            : 'bg-surface border border-zinc-200 text-zinc-800 rounded-bl-sm'
          }`}
          style={
            isUser ? {background:INK}
            : m.error ? {background:'var(--danger-bg)', borderColor:'var(--danger-border)', color:'var(--danger-text)'}
            : undefined
          }
        >
          {isUser ? m.text : formatReply(m.text)}
        </div>
        {!isUser && m.images?.length > 0 && (
          <div className={`grid gap-1.5 w-full ${m.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {m.images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer noopener"
                 title="Open full spec sheet"
                 className="block rounded-lg overflow-hidden border border-zinc-200 bg-surface transition-shadow hover:shadow-[0_4px_16px_-4px_rgba(30,41,59,0.18)] outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <img src={src} alt={`Spec sheet ${i+1}`} loading="lazy"
                     className="w-full h-auto object-cover"/>
              </a>
            ))}
          </div>
        )}
        {/* Not on error bubbles — a failed request is already logged by errlog.js,
            and asking "what went wrong?" about a network error is just noise. */}
        {!isUser && !m.error && <BadAnswerButton m={m} question={question} sessionId={sessionId}/>}
      </div>
    </motion.div>
  );
}

// Voice-note player. Deliberately NOT <audio controls>: the native widget is browser
// chrome — its own typeface, its own greys, its own overflow menu — and it can't be
// themed, so it reads as a foreign object dropped into the thread. Same reasoning as
// the styled combobox that replaced the native datalist.
// `dark` = sitting on the ink user-bubble; otherwise the white composer.
function VoicePlayer({ src, durationMs, peaks, dark = false }) {
  const ref    = useRef(null);
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [pos, setPos]         = useState(0);
  // Chrome reports duration:Infinity for a MediaRecorder blob until it's been seeked,
  // so trust the length we measured while recording and only take the element's own
  // reading once it turns out to be finite.
  const [dur, setDur]         = useState((durationMs || 0) / 1000);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onTime = () => setPos(el.currentTime);
    const onMeta = () => { if (Number.isFinite(el.duration) && el.duration > 0) setDur(el.duration); };
    const onEnd  = () => { setPlaying(false); setPos(0); el.currentTime = 0; };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const el = ref.current; if (!el) return;
    if (el.paused) { el.play().catch(() => {}); setPlaying(true); }
    else           { el.pause(); setPlaying(false); }
  };

  const seek = e => {
    const el = ref.current; if (!el || !dur) return;
    const v = Number(e.target.value);
    el.currentTime = v;
    setPos(v);
  };

  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;

  // The player is fully fluid: it measures its own track and draws one bar every
  // BAR_PITCH px, so bars stay ~3px wide at any width instead of being stretched into
  // slabs on a wide screen or overflowing on a phone. This is why the peaks are stored
  // at WAVEFORM_RES (256) rather than at a fixed bar count — there's always enough
  // resolution to downsample to whatever fits.
  const trackRef = useRef(null);
  const [barCount, setBarCount] = useState(48);
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const fits = Math.floor(entry.contentRect.width / BAR_PITCH);
      setBarCount(Math.max(8, Math.min(WAVEFORM_RES, fits)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Max-pool down to barCount: peaks are amplitudes, so averaging them would flatten the
  // wave into mush. Taking the loudest sample per bucket keeps the shape of the speech.
  const bars = useMemo(() => {
    if (!peaks?.length) return null;
    if (barCount >= peaks.length) return peaks;
    const out = [];
    for (let i = 0; i < barCount; i++) {
      const start = Math.floor((i * peaks.length) / barCount);
      const end   = Math.floor(((i + 1) * peaks.length) / barCount);
      let max = 0;
      for (let j = start; j < Math.max(end, start + 1); j++) if (peaks[j] > max) max = peaks[j];
      out.push(max);
    }
    return out;
  }, [peaks, barCount]);

  // w-full + min-w-0 on the root: a flex item defaults to min-width:auto, so without this
  // the player refuses to shrink below its content and shoves the composer's buttons off
  // the right edge of a phone screen.
  return (
    <div className="flex items-center gap-2.5 py-0.5 w-full min-w-0">
      <audio ref={ref} src={src} preload="metadata" className="hidden"/>

      <button type="button" onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={`flex items-center justify-center w-8 h-8 shrink-0 rounded-full text-white transition-transform active:scale-95 outline-none focus-visible:ring-2 ${dark ? 'focus-visible:ring-white/70' : 'focus-visible:ring-accent/40'}`}
        style={{background:ACCENT}}>
        {playing
          ? <Pause size={13} fill="currentColor"/>
          : <Play  size={13} fill="currentColor" className="translate-x-[1px]"/>}
      </button>

      {/* The look is the bars; the semantics and keyboard seeking are a transparent range
          input laid over them. Styling ::-webkit-slider-thumb consistently across browsers
          is a losing game — this way arrow keys work for free, and the waveform is free to
          be whatever we want. Bars are aria-hidden: the input already announces position.
          `peaks` can be absent (an older persisted message), so the flat track stays as the
          fallback rather than rendering nothing. */}
      <div ref={trackRef} className="relative flex-1 min-w-[40px] h-8 flex items-center overflow-hidden">
        {bars?.length ? (
          <div className="w-full flex items-center gap-[2px] h-6" aria-hidden="true">
            {bars.map((p, i) => {
              // Colour whole bars, like WhatsApp — a partially-filled bar reads as a
              // rendering artifact, not as progress.
              const played = (i + 1) / bars.length <= pct / 100;
              return (
                <span key={i}
                  className={`flex-1 min-w-[2px] rounded-full ${reduce ? '' : 'transition-colors duration-150'}`}
                  style={{
                    // Floor of 2px so a silent stretch still reads as part of the wave
                    // rather than a gap in it.
                    height: `${Math.max(2, Math.round(p * 22))}px`,
                    background: played ? ACCENT : (dark ? 'rgba(255,255,255,0.28)' : 'var(--color-zinc-300)'),
                  }}/>
              );
            })}
          </div>
        ) : (
          <div className={`w-full h-1 rounded-full ${dark ? 'bg-[rgba(255,255,255,0.25)]' : 'bg-zinc-200'}`}>
            <div className="h-1 rounded-full" style={{width:`${pct}%`, background:ACCENT}}/>
          </div>
        )}
        <span className={`absolute w-2.5 h-2.5 rounded-full pointer-events-none shadow-sm ${dark ? 'bg-[rgba(255,255,255,1)]' : 'bg-zinc-900'}`}
              style={{left:`${pct}%`, marginLeft:'-5px'}}/>
        <input type="range" min={0} max={dur || 0} step={0.01} value={pos} onChange={seek}
          aria-label="Seek voice note" aria-valuetext={fmtClock(pos * 1000)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
      </div>

      <span className={`mono text-[11px] tabular-nums shrink-0 w-[30px] text-right ${dark ? 'text-white/70' : 'text-zinc-500'}`}>
        {fmtClock((pos > 0 ? pos : dur) * 1000)}
      </span>
    </div>
  );
}

// The user's voice-note bubble: the player over the session-only recording blob, plus
// the transcript once n8n answers. The transcript is the user's safety net — if the
// model mishears a model number they can see what it heard and retype instead of
// guessing. Ink background, like every other message the user sent.
function AudioBubble({ m }) {
  return (
    <motion.div
      initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
      transition={{duration:0.22, ease:[0.22,1,0.36,1]}}
      className="flex justify-end"
    >
      <div className="flex flex-col gap-1.5 max-w-[80%] sm:max-w-[68%] items-end">
        <div className="px-3 py-1.5 rounded-2xl rounded-br-sm w-full min-w-[220px] max-w-[340px]" style={{background:INK}}>
          {m.audioUrl
            ? <VoicePlayer src={m.audioUrl} durationMs={m.durationMs} peaks={m.peaks} dark/>
            : <span className="flex items-center gap-1.5 text-[12.5px] text-white/70 px-1 py-2">
                <Mic size={13}/> Voice note (expired — reload started a fresh session)
              </span>}
        </div>
        {m.transcript == null
          ? <p className="text-[12px] text-zinc-500 px-1 italic">Transcribing…</p>
          : <p className="text-[12px] text-zinc-500 px-1 max-w-[320px] text-right">
              {m.transcript === '' ? 'No transcript available.' : m.transcript}
            </p>}
      </div>
    </motion.div>
  );
}

// Layer 3 of the hallucination fix: nothing reaches the agent, web_chat_histories,
// or semantic_cache until a human approves the text. Sits in the composer in place
// of the textarea (mirrors how 'preview' takes over the same slot) — styled like
// ReceiptCard (rounded-2xl / border-zinc-200 / bg-surface / shadow-sm, same button
// language) since it's the same confirm-before-commit discipline, just for what was
// heard instead of what was read off a receipt. The transcript is EDITABLE — that's
// the whole point of showing it: fix a misheard model number before it ever sends.
function VoiceCard({ preview, transcript, onTranscriptChange, onConfirm, onDiscard }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Mic size={15} className="text-zinc-500" />
        <span className="text-[13px] font-semibold text-zinc-800">Is this what you said?</span>
      </div>
      <div className="flex items-center min-w-0 px-3 py-1 mb-3 border border-zinc-200 rounded-xl">
        <VoicePlayer src={preview?.url} durationMs={preview?.durationMs} peaks={preview?.peaks} />
      </div>
      <textarea
        value={transcript}
        onChange={e => onTranscriptChange(e.target.value)}
        rows={2}
        maxLength={1500}
        aria-label="Edit transcript before sending"
        className="w-full resize-none px-3 py-2 mb-3 bg-surface border border-zinc-300 rounded-lg text-[13.5px] text-zinc-800 leading-relaxed outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20"
      />
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={!transcript.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-on-ink text-[13px] font-semibold py-2 hover:bg-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Send size={14} /> Confirm &amp; send
        </button>
        <button onClick={onDiscard}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 text-zinc-700 text-[13px] font-medium px-3 py-2 hover:border-zinc-900 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <X size={14} /> Discard
        </button>
      </div>
    </div>
  );
}

// `active` drives the entrance instead of mount, because this component never
// unmounts: it stays alive across tab switches so an in-flight receipt upload, the
// thread's scroll position and the composer caret all survive. Mount-time
// initial/animate therefore fires exactly once, on app boot — which is why every
// visit to this tab after the first one arrived as a hard cut.
function ChatTab({ active }) {
  const reduce = useReducedMotion();
  // Two questions answered from ONE reading of localStorage, resolved together
  // because the second is unanswerable after the first: which session is this, and
  // could the DB still be holding a thread for it? Minting an id WRITES it, so once
  // that has happened "was there already a session here?" is gone.
  //
  // That distinction is the whole point. A freshly minted session has no history by
  // definition, so it must skip the restore skeleton and land straight on the empty
  // state — otherwise every first-time visitor gets a pulse for a round-trip that is
  // guaranteed to come back empty, which is a worse flash than the one being fixed.
  const [boot] = useState(() => {
    const key    = sessionKey(currentUserName() || 'anon');
    const stored = localStorage.getItem(key);
    if (stored) return { id: stored, mayRestore: loadThread(stored).length === 0 };
    const id = genSessionId();
    try { localStorage.setItem(key, id); } catch { /* private mode */ }
    return { id, mayRestore: false };
  });
  const [sessionId, setSessionId] = useState(boot.id);
  const [messages, setMessages] = useState(() => loadThread(boot.id));
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  // Set from the initialiser rather than from the effect, so the very first frame
  // already shows the skeleton instead of a frame of the empty state.
  const [restoring, setRestoring] = useState(boot.mayRestore);
  // Enlarged is the normal way to read a long, spec-heavy answer, so it is the
  // default. Minimising is remembered — someone who wants the chat as one card
  // among others shouldn't have to say so on every visit.
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('ht_chat_minimized') !== '1');
  const scrollRef = useRef(null);
  const taRef     = useRef(null);
  const fileRef   = useRef(null);
  const receiptFiles = useRef(new Map());   // cid -> File (in-memory only, never persisted)
  const objectUrls   = useRef([]);          // created blob: URLs, revoked on unmount
  const voiceRun       = useRef(0);         // generation token — invalidates an in-flight transcription
  const recorderRef    = useRef(null);      // active createRecorder() instance while voicePhase==='recording'
  const recordTimerRef = useRef(null);      // setInterval id driving the M:SS ticker

  const configured     = !!N8N_CHAT_WEBHOOK;
  const receiptEnabled = !!N8N_RECEIPT_WEBHOOK;
  const recordingEnabled = useMemo(() => isRecordingSupported(), []); // computed once, like receiptEnabled

  // Composer state machine: idle -> recording -> preview -> transcribing -> confirm
  // -> (idle, via a successful send). transcribing falls back to preview (recording
  // intact) on a Layer-2 energy-gate rejection, a fetch error, or has_speech:false —
  // see docs/superpowers/specs/2026-07-14-voice-hallucination-fix-design.md.
  const [voicePhase,    setVoicePhase]    = useState('idle');
  const [recordElapsed, setRecordElapsed] = useState(0);   // ms, ticks during 'recording'
  const [liveLevels,    setLiveLevels]    = useState([]);  // rolling mic levels (0..1) during 'recording'
  const [preview,       setPreview]       = useState(null); // { blob, url, durationMs } during 'preview'/'transcribing'/'confirm'
  const [voiceTranscript, setVoiceTranscript] = useState(''); // editable transcript text during 'confirm'

  // Restore on mount / "New chat". localStorage is the source of truth (it keeps
  // image URLs); only fall back to the DB (text-only) when there's no local thread.
  useEffect(() => {
    if (loadThread(sessionId).length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const { data } = await sbFetch(token, WEB_CHAT_SOURCE,
          `select=Timestamp,User_Message,AI_Response,from_cache&session_id=eq.${encodeURIComponent(sessionId)}&order=Timestamp.asc&limit=200`);
        if (cancelled) return;
        setMessages(data.flatMap(r => [
          r.User_Message ? {role:'user',      text:r.User_Message, ts:r.Timestamp} : null,
          r.AI_Response  ? {role:'assistant', text:r.AI_Response, from_cache:r.from_cache, ts:r.Timestamp} : null,
        ].filter(Boolean)));
      } catch { /* no history / unreachable → start empty */ }
      // finally, not inside the try: a failed restore has to clear the skeleton
      // too, or an unreachable DB leaves the thread pulsing forever instead of
      // falling through to the empty state.
      finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // The question each reply answered, by index — a dislike report is only useful
  // if it carries the exchange, and a bubble doesn't know what came before it.
  // Voice turns count as questions too, via their transcript.
  const questionFor = useMemo(() => {
    const out = []; let last = null;
    for (const m of messages) {
      if (m.role === 'user')       last = m.text;
      else if (m.role === 'audio') last = m.transcript || '(voice note)';
      out.push(last);
    }
    return out;
  }, [messages]);

  // Persist the thread so switching tabs / reloading keeps it intact. Receipt cards
  // carry a live blob: thumb (and their File lives in the receiptFiles ref, never here);
  // neither survives serialization, so strip the thumb and downgrade any in-flight
  // receipt to 'expired' — a reloaded card then asks the user to re-attach instead of
  // offering a Confirm that would fail. Audio bubbles are the same story: the
  // recording lives only behind a blob: URL, session-only by design (never uploaded,
  // never stored server-side) — so the persisted copy drops audioUrl, and a
  // still-in-flight transcript (null) collapses to '' rather than showing
  // "Transcribing…" forever, since a reload kills the request it was waiting on.
  useEffect(() => {
    try {
      const safe = messages.map(m => {
        if (m.role === 'audio') return { ...m, audioUrl: null, transcript: m.transcript ?? '' };
        if (m.role !== 'receipt') return m;
        const s = m.card?.status;
        const status = (s === 'extracting' || s === 'pending' || s === 'saving') ? 'expired' : s;
        return { ...m, card: { ...m.card, thumb: null, status } };
      });
      localStorage.setItem(threadKey(sessionId), JSON.stringify(safe));
    } catch { /* storage full — ignore */ }
  }, [messages, sessionId]);

  // Revoke receipt/voice blob URLs on unmount, and make sure a recording in
  // progress can't leave the browser's mic-in-use indicator lit.
  useEffect(() => () => {
    objectUrls.current.forEach(u => URL.revokeObjectURL(u));
    recorderRef.current?.cancel();
  }, []);

  // Keep the thread pinned to the newest message. `expanded` is a dependency
  // because enlarging changes the container's height without changing its
  // scrollTop, which would otherwise strand the newest message off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, sending, reduce, expanded]);

  const grow = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !configured) return;
    setMessages(m => [...m, { role:'user', text, ts:Date.now() }]);
    setInput('');
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto'; });
    setSending(true);
    try {
      const res = await fetch(N8N_CHAT_WEBHOOK, {
        method: 'POST',
        headers: await chatWebhookHeaders(),
        body: JSON.stringify({ message: text, session_id: sessionId, name: currentUserName() }),
      });
      // The request reached n8n but the workflow errored (e.g. a failing node).
      // Surface the status + server message so it's clear this isn't a CORS issue.
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.clone().json(); if (j?.message) detail += ` — ${j.message}`; } catch { /* non-JSON body */ }
        setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
          text:`The Hi Tech AI workflow returned an error (${detail}). Open the failed run in n8n → Executions to see which node failed.` }]);
        return;
      }
      const { text: reply, images, from_cache } = await parseChatReply(res);
      setMessages(m => [...m, { role:'assistant', text: reply, images, from_cache, ts:Date.now() }]);
    } catch {
      // fetch itself threw → the request never completed (network down, wrong URL,
      // or a genuine CORS block where no response is readable).
      setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
        text:'Couldn’t reach Hi Tech AI — the request never completed. Check the webhook URL and that n8n is reachable.' }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, configured, sessionId]);

  // Stops the M:SS ticker; always called before the recorder itself is torn down
  // so a slow stop() can't let one more tick sneak in.
  const clearRecordTimer = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
  };

  const stopRecording = useCallback(async () => {
    clearRecordTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    const { blob, durationMs } = await recorder.stop();
    const url = URL.createObjectURL(blob);
    objectUrls.current.push(url);
    // The waveform is decoration on top of a working player — if decoding it fails,
    // fall back to the flat track rather than losing the recording.
    const peaks = await computeWaveform(blob).catch(() => null);
    setPreview({ blob, url, durationMs, peaks });
    setVoicePhase('preview');
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const recorder = await createRecorder(); // throws (e.g. NotAllowedError) before any UI changes
      recorderRef.current = recorder;
      const startedAt = Date.now();
      recorder.start();
      setRecordElapsed(0);
      setLiveLevels([]);
      setVoicePhase('recording');
      // One ticker drives both the clock and the live meter. It runs at the meter's
      // rate (~12fps) rather than the clock's, because a level meter that lags is
      // worse than a clock that updates more often than it strictly needs to.
      recordTimerRef.current = setInterval(() => {
        const ms = Date.now() - startedAt;
        setRecordElapsed(ms);
        // Newest bar on the right; the window scrolls once it's full.
        setLiveLevels(l => [...l, recorder.getLevel()].slice(-LIVE_METER_BARS));
        if (ms >= MAX_MS) stopRecording(); // auto-stop at the cap
      }, LIVE_METER_MS);
    } catch (ex) {
      setVoicePhase('idle'); // always reset — this can also fire mid-'preview' via reRecord()
      setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
        text: ex.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it in your browser’s site settings (the padlock icon next to the address bar), then try again.'
          : 'Couldn’t access the microphone — check that it’s connected and not already in use by another app.' }]);
    }
  }, [stopRecording]);

  // Trash button while 'recording' — discard, no send, mic released.
  const cancelRecording = useCallback(() => {
    clearRecordTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setVoicePhase('idle');
  }, []);

  // Trash button while 'preview' — discard the take, release its object URL.
  const discardPreview = useCallback(() => {
    voiceRun.current++;
    setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });
    setVoicePhase('idle');
  }, []);

  // Re-record button while 'preview' — drop this take and start a fresh one.
  const reRecord = useCallback(() => {
    setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });
    startRecording();
  }, [startRecording]);

  // Step 1 of the two-round-trip voice flow (Layer 3 of the hallucination fix): run
  // the Layer-2 energy gate, transcode, and ask n8n only "was there speech, and what
  // was it" — the workflow no longer answers the question on this call. A Layer-2
  // rejection, a fetch error, or has_speech:false all fall back to 'preview' with the
  // recording INTACT so the user can replay it and decide, never touching n8n at all
  // in the energy-gate case.
  const transcribeVoice = useCallback(async () => {
    if (!preview || sending || !configured) return;
    const { blob: rawBlob } = preview;
    setVoicePhase('transcribing');

    // Abandoning the take (Discard, New chat) bumps voiceRun, so a transcription
    // that was already in flight lands stale and is dropped. Without this, a slow
    // response could drag us into 'confirm' with a recording that no longer exists.
    const run = ++voiceRun.current;
    const stale = () => voiceRun.current !== run;

    let wav, peak, rms, durationSec;
    try {
      ({ wav, peak, rms, durationSec } = await blobToWav16k(rawBlob));
    } catch {
      if (stale()) return;
      // Transcode failed — preserve the recording in 'preview' so Send can be retried.
      setVoicePhase('preview');
      setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
        text:'Couldn’t process that recording — try sending it again, or re-record it.' }]);
      return;
    }

    if (stale()) return;

    // Layer 2: obvious silence never leaves the browser — no fetch at all.
    if (isProbablySilent({ peak, rms, durationSec })) {
      setVoicePhase('preview');
      setMessages(m => [...m, { role:'assistant', ts:Date.now(),
        text:'I couldn’t hear anything in that voice note — try again, or type your message.' }]);
      return;
    }

    try {
      const audio_base64 = await blobToBase64(wav);
      const res = await fetch(N8N_CHAT_WEBHOOK, {
        method: 'POST',
        headers: await chatWebhookHeaders(),
        body: JSON.stringify({ audio_base64, mime_type: 'audio/wav', session_id: sessionId, name: currentUserName() }),
      });
      // Same error handling as the typed-message path — mirror it verbatim.
      if (!res.ok) {
        if (stale()) return;
        let detail = `HTTP ${res.status}`;
        try { const j = await res.clone().json(); if (j?.message) detail += ` — ${j.message}`; } catch { /* non-JSON body */ }
        setVoicePhase('preview');
        setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
          text:`The Hi Tech AI workflow returned an error (${detail}). Open the failed run in n8n → Executions to see which node failed.` }]);
        return;
      }
      const { has_speech, transcript } = await parseTranscribeReply(res);
      if (stale()) return;
      if (!has_speech) {
        setVoicePhase('preview');
        setMessages(m => [...m, { role:'assistant', ts:Date.now(),
          text:'I couldn’t hear anything in that voice note — try again, or type your message.' }]);
        return;
      }
      setVoiceTranscript(transcript);
      setVoicePhase('confirm');
    } catch {
      if (stale()) return;
      setVoicePhase('preview');
      setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
        text:'Couldn’t reach Hi Tech AI — the request never completed. Check the webhook URL and that n8n is reachable.' }]);
    }
  }, [preview, sending, configured, sessionId]);

  // Discard button in 'confirm' — same housekeeping as discardPreview: drop the
  // take, release its object URL.
  const discardConfirm = useCallback(() => {
    voiceRun.current++;
    setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });
    setVoiceTranscript('');
    setVoicePhase('idle');
  }, []);

  // Step 2: post the (possibly user-edited) transcript as an ORDINARY typed message —
  // same payload shape and response handling as send(), reusing the pipeline that
  // already works. Nothing reached the agent, web_chat_histories, or semantic_cache
  // until this point. The committed thread bubble is the existing AudioBubble (player
  // + final transcript), so the thread still shows it was spoken.
  const sendConfirmedVoice = useCallback(async () => {
    const text = voiceTranscript.trim();
    if (!text || sending || !configured || !preview) return;
    const { url: audioUrl, durationMs, peaks } = preview;
    // Commit the bubble and flip `sending` synchronously (before the first await),
    // same as send() does — the existing `sending` flag drives the typing dots.
    setPreview(null);
    setVoicePhase('idle');
    setSending(true);
    const cid = crypto.randomUUID?.() || `v_${Date.now()}_${Math.random()}`;
    setMessages(m => [...m, { role:'audio', cid, ts:Date.now(), audioUrl, durationMs, peaks, transcript: text }]);
    try {
      const res = await fetch(N8N_CHAT_WEBHOOK, {
        method: 'POST',
        headers: await chatWebhookHeaders(),
        body: JSON.stringify({ message: text, session_id: sessionId, name: currentUserName() }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.clone().json(); if (j?.message) detail += ` — ${j.message}`; } catch { /* non-JSON body */ }
        setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
          text:`The Hi Tech AI workflow returned an error (${detail}). Open the failed run in n8n → Executions to see which node failed.` }]);
        return;
      }
      const { text: reply, images, from_cache } = await parseChatReply(res);
      setMessages(m => [...m, { role:'assistant', text: reply, images, from_cache, ts:Date.now() }]);
    } catch {
      setMessages(m => [...m, { role:'assistant', error:true, ts:Date.now(),
        text:'Couldn’t reach Hi Tech AI — the request never completed. Check the webhook URL and that n8n is reachable.' }]);
    } finally {
      setSending(false);
      setVoiceTranscript('');
    }
  }, [voiceTranscript, sending, configured, preview, sessionId]);

  const newChat = useCallback(() => {
    const user = currentUserName() || 'anon';
    localStorage.removeItem(threadKey(sessionId));
    const id = genSessionId();
    localStorage.setItem(sessionKey(user), id);
    voiceRun.current++;   // a transcription still in flight belongs to the old thread — drop it
    // Don't leave a recording running or a take stranded when the thread resets.
    clearRecordTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });
    setVoiceTranscript('');
    setVoicePhase('idle');
    setSessionId(id);
    setMessages([]);
    setInput('');
  }, [sessionId]);

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // One path for every way a receipt image can arrive — the file picker and a
  // clipboard paste both land here, so the OCR/dedup/confirm flow can't drift
  // between them.
  const startReceipt = useCallback(async (file) => {
    if (!file) return;
    const bad = validateImage(file);
    if (bad) { setMessages(m => [...m, { role:'assistant', error:true, text:bad, ts:Date.now() }]); return; }
    // Unique id per card (a spend-write target — don't reuse a millisecond timestamp).
    // The File stays in a ref map, never in `messages` (unserializable + would bloat storage).
    const cid = (crypto.randomUUID?.() || `r_${Date.now()}_${Math.random()}`);
    const thumb = URL.createObjectURL(file);
    objectUrls.current.push(thumb);
    setMessages(m => [...m, { role:'receipt', ts:Date.now(), cid, card:{ status:'extracting', thumb } }]);
    try {
      // Shrink before anything leaves the browser. nginx caps the webhook request
      // at 1MB and base64 adds a third on top, so a raw phone photo 413s at the
      // proxy — n8n never sees it and the browser only reports "Failed to fetch".
      // Store the COMPRESSED blob: Confirm & save re-sends the image, so both legs
      // have to be under the cap, and both should send identical bytes.
      const img = await compressImage(file);
      receiptFiles.current.set(cid, img);
      const { fields, is_receipt } = await extractReceipt(img);
      const notReceipt = is_receipt === false || fields?.is_receipt === false;
      if (notReceipt) receiptFiles.current.delete(cid);
      setMessages(m => m.map(msg => msg.cid===cid
        ? { ...msg, card:{ ...msg.card, status: notReceipt ? 'notreceipt' : 'pending', fields } }
        : msg));
    } catch (ex) {
      receiptFiles.current.delete(cid);
      setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'error' } } : msg)
        .concat({ role:'assistant', error:true, ts:Date.now(),
                  text: ex.message || 'Couldn’t read that receipt — try a sharper photo.' }));
    }
  }, []);

  const onPickReceipt = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // same file twice in a row must still fire onChange
    startReceipt(file);
  }, [startReceipt]);

  // Paste a screenshot straight into the chat (Ctrl/Cmd+V). Bound to the document
  // rather than the textarea so it works wherever the caret is in this tab — a
  // screenshot is usually taken, then pasted, with nothing focused.
  useEffect(() => {
    if (!receiptEnabled) return;
    const onPaste = (e) => {
      // Don't hijack a paste into some other input (the rename field, a search box).
      const t = e.target;
      const tag = t?.tagName;
      if (t?.isContentEditable || ((tag === 'INPUT' || tag === 'TEXTAREA') && t !== taRef.current)) return;
      // Mid-recording or mid-send, a receipt would race the composer's state machine.
      if (sending || voicePhase !== 'idle') return;

      const file = imageFromClipboard(e.clipboardData);
      if (!file) {
        // Silence here is indistinguishable from a broken feature. If the paste
        // carried NOTHING we can use but the user clearly meant to paste an image
        // (WhatsApp Web is the common case: its own context menu has no "Copy
        // image", so the clipboard only ever gets text/html), say so. A normal
        // text paste has text/plain and must still pass through untouched.
        const types = Array.from(e.clipboardData?.types || []);
        const looksLikeImageAttempt = types.length > 0 && !types.includes('text/plain');
        if (looksLikeImageAttempt) {
          setMessages(m => [...m, { role:'assistant', ts:Date.now(),
            text:'That paste didn’t carry an image. Some apps (WhatsApp Web especially) copy only a link, not the picture. Save the image first, then paste it or use the receipt button.' }]);
        }
        return;
      }

      e.preventDefault();  // otherwise the image can also drop into the textarea
      startReceipt(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [receiptEnabled, sending, voicePhase, startReceipt]);

  const acceptReceipt = useCallback(async (cid) => {
    const card = messages.find(m => m.cid===cid)?.card;
    const file = receiptFiles.current.get(cid);
    if (!card) return;
    if (!file) {   // binary was dropped (tab switch / reload) — can't save, ask to re-attach
      setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'expired' } } : msg));
      return;
    }
    setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'saving' } } : msg));
    try {
      await saveReceipt(file, card.fields);
      receiptFiles.current.delete(cid);
      setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'saved' } } : msg));
    } catch (ex) {
      setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'pending' } } : msg)
        .concat({ role:'assistant', error:true, ts:Date.now(), text: ex.message || 'Couldn’t save — try again.' }));
    }
  }, [messages]);

  const rejectReceipt = useCallback((cid) => {
    receiptFiles.current.delete(cid);
    setMessages(m => m.map(msg => msg.cid===cid ? { ...msg, card:{ ...msg.card, status:'rejected' } } : msg));
  }, []);

  const toggleSize = useCallback(() => {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem('ht_chat_minimized', next ? '0' : '1'); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // No body-scroll lock and no aria-modal here, unlike ContentModal: enlarged is
  // the resting state, not a temporary overlay, and it deliberately stops below
  // the header so the nav stays reachable. Calling it a modal would be a lie to
  // a screen reader, and locking scroll would be locking the page you're on.
  useEffect(() => {
    if (!expanded) return;
    const onKey = e => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      // Escape in the composer belongs to the composer, not to the layout.
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      toggleSize();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, toggleSize]);

  // The root is an orchestrator only — it carries the variant label down and does
  // nothing visual. It must stay that way: it is the ancestor of a position:fixed
  // panel, so the moment it animated a transform it would become that panel's
  // containing block. `stagger` holds no properties, only timing, which is why it is
  // safe here where chatPanel would not be.
  return (
    <motion.div variants={stagger} initial="hidden" animate={active ? 'show' : 'hidden'}>
      {/* Enlarged fills everything BELOW the sticky header, never over it — the
          header is the navigation, so covering it would strand you on this tab.
          The panel is toggled in place rather than portalled: rendering it
          elsewhere would rebuild the DOM nodes and lose the thread's scroll
          position and the caret in the composer.

          Height is dvh-derived rather than driven by `bottom`, because a fixed
          element is sized against the LAYOUT viewport — on a phone `bottom: 0`
          alone lets the soft keyboard cover the composer instead of shortening
          the panel. */}
      <Panel
        variants={chatPanel}
        className={`flex flex-col overflow-hidden ${expanded ? 'fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0' : ''}`}
        style={expanded
          ? {top:'var(--app-header-h, 140px)',
             height:'calc(100dvh - var(--app-header-h, 140px))',
             minHeight:0}
          : {height:'calc(100vh - 260px)', minHeight:'440px'}}>

        {/* Header — bot identity + new-chat reset.
            These three rows are the tab's entrance: identity, then thread, then
            composer, in the order you'd read them. They were plain divs before, so
            the only thing that ever animated here was the Panel itself — one element
            moving as a block, which is why an empty thread had nothing to show on the
            way in and the tab read as a hard cut. */}
        <motion.div variants={fadeUp} className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-zinc-200">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{background:tint(ACCENT,8)}}>
              <Bot size={18} style={{color:ACCENT_DK}}/>
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-zinc-900 leading-tight">Hi Tech AI</p>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:ACCENT}}/>
                <span className="mono text-[10px] uppercase tracking-widest text-zinc-500">live · n8n</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onClick={newChat}
              aria-label="Start a new chat"
              className="flex items-center gap-1.5 px-3 min-h-[40px] shrink-0 rounded-lg bg-surface border border-zinc-300 text-zinc-700 text-[12px] font-semibold transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <RefreshCw size={13}/><span className="hidden sm:inline">New chat</span>
            </button>
            {/* Square 40px so it stays a comfortable touch target once the label
                is dropped on narrow screens. */}
            <button onClick={toggleSize}
              aria-label={expanded ? 'Minimize chat' : 'Enlarge chat'}
              aria-pressed={expanded}
              title={expanded ? 'Minimize (Esc)' : 'Enlarge chat'}
              className="flex items-center justify-center w-10 min-h-[40px] shrink-0 rounded-lg bg-surface border border-zinc-300 text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
            </button>
          </div>
        </motion.div>

        {/* Thread */}
        <motion.div variants={fadeUp} ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4" style={{background:'var(--surface-2)'}}>
          {!configured ? (
            <div className="h-full flex items-center justify-center text-center px-6">
              <div className="max-w-sm">
                <span className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-xl" style={{background:tint(ACCENT,8)}}>
                  <AlertTriangle size={22} style={{color:ACCENT_DK}}/>
                </span>
                <p className="text-[15px] font-semibold text-zinc-900">Chat webhook not configured</p>
                <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed">
                  Set <span className="mono text-[12px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-700">VITE_N8N_CHAT_WEBHOOK</span> in your <span className="mono text-[12px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-700">.env</span> to your n8n webhook URL, then reload.
                </p>
              </div>
            </div>
          ) : restoring ? (
            // Ahead of the empty state on purpose: an empty `messages` during the
            // restore means "not back yet", not "nothing to show".
            <ChatThreadSkeleton/>
          ) : messages.length === 0 && !sending ? (
            <div className="h-full flex items-center justify-center text-center px-6">
              <div className="max-w-sm">
                <span className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-xl" style={{background:tint(ACCENT,8)}}>
                  <Bot size={22} style={{color:ACCENT_DK}}/>
                </span>
                <p className="text-[15px] font-semibold text-zinc-900">Ask me anything about Hi Tech</p>
                <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed">
                  Product specs, pricing, and availability — answered straight from the Hi Tech catalogue. The same AI as the WhatsApp bot, right here.
                </p>
                {receiptEnabled && (
                  <div className="mt-4 flex items-start gap-2 text-left rounded-lg border border-zinc-200 bg-surface px-3 py-2.5">
                    <Receipt size={15} className="text-zinc-500 shrink-0 mt-0.5"/>
                    <p className="text-[12.5px] text-zinc-600 leading-relaxed">
                      <span className="font-semibold text-zinc-800">Log an expense:</span> tap the receipt icon below, or just paste a screenshot — I’ll read the vendor, total and category, and you just confirm before it’s saved.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m,i)=>(
                m.role === 'receipt'
                  ? <ReceiptCard key={`${m.cid || m.ts}_${i}`} card={m.card} onAccept={() => acceptReceipt(m.cid)} onReject={() => rejectReceipt(m.cid)} />
                  : m.role === 'audio'
                  ? <AudioBubble key={`${m.cid || m.ts}_${i}`} m={m}/>
                  : <ChatBubble key={`${m.ts}_${i}`} m={m} question={questionFor[i]} sessionId={sessionId}/>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex flex-col gap-1 items-start">
                    <AssistantTag/>
                    <div className="px-4 py-3 bg-surface border border-zinc-200 rounded-2xl rounded-bl-sm"><TypingDots/></div>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Composer — idle / recording / preview / transcribing / confirm, see the state machine above */}
        <motion.div variants={fadeUp} className="border-t border-zinc-200 px-3 sm:px-4 py-3 bg-surface">
          {voicePhase === 'recording' ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 border border-zinc-300 rounded-xl">
                <span className="relative flex items-center justify-center w-2.5 h-2.5 shrink-0">
                  <span className="absolute inset-0 rounded-full animate-ping" style={{background:NEG, opacity:0.5}}/>
                  <span className="relative w-2.5 h-2.5 rounded-full" style={{background:NEG}}/>
                </span>
                <span className="mono text-[13px] text-zinc-700 tabular-nums shrink-0">{fmtClock(recordElapsed)}</span>

                {/* Live mic level. Newest bar on the right, so the wave grows in from the
                    right edge and then scrolls — it reads as "now" rather than as a static
                    picture. No CSS transition: at 80ms per bar a transition would smear one
                    bar's height into the next and turn the wave to mush.
                    aria-hidden — the timer already announces recording state; a bar chart
                    updating 12x/second would be screen-reader noise. */}
                <div className="flex-1 min-w-0 flex items-center justify-end gap-[2px] h-6 overflow-hidden" aria-hidden="true">
                  {liveLevels.map((lv, i) => (
                    <span key={i} className="w-[3px] shrink-0 rounded-full"
                      style={{ height:`${Math.max(2, Math.round(lv * 22))}px`, background:ACCENT }}/>
                  ))}
                </div>

                <span className="mono text-[10px] text-zinc-400 tabular-nums shrink-0 hidden sm:inline">max {fmtClock(MAX_MS)}</span>
              </div>
              <button type="button" onClick={cancelRecording} aria-label="Discard recording"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-red-600 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Trash2 size={18}/>
              </button>
              <button type="button" onClick={stopRecording} aria-label="Stop recording"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                style={{background:ACCENT}}>
                <Square size={16} fill="currentColor"/>
              </button>
            </div>
          ) : voicePhase === 'preview' ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex-1 min-w-0 flex items-center px-3 py-1 border border-zinc-300 rounded-xl">
                <VoicePlayer src={preview?.url} durationMs={preview?.durationMs} peaks={preview?.peaks}/>
              </div>
              <button type="button" onClick={discardPreview} aria-label="Discard recording"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-red-600 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Trash2 size={18}/>
              </button>
              <button type="button" onClick={reRecord} aria-label="Re-record"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Mic size={18}/>
              </button>
              <button type="button" onClick={transcribeVoice} disabled={sending} aria-label="Send voice note"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed"
                style={{background: sending ? 'var(--color-zinc-400)' : ACCENT}}>
                <Send size={17}/>
              </button>
            </div>
          ) : voicePhase === 'transcribing' ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex-1 min-w-0 flex items-center px-3 py-1 border border-zinc-300 rounded-xl opacity-60 pointer-events-none">
                <VoicePlayer src={preview?.url} durationMs={preview?.durationMs} peaks={preview?.peaks}/>
              </div>
              <span className="mono text-[12px] text-zinc-400 px-2 shrink-0 whitespace-nowrap">Listening…</span>
            </div>
          ) : voicePhase === 'confirm' ? (
            <VoiceCard
              preview={preview}
              transcript={voiceTranscript}
              onTranscriptChange={setVoiceTranscript}
              onConfirm={sendConfirmedVoice}
              onDiscard={discardConfirm}
            />
          ) : (
            <div className="flex items-end gap-2">
              {receiptEnabled && (
                <>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickReceipt} />
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label="Upload a receipt"
                    className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
                    <Receipt size={18} />
                  </button>
                </>
              )}
              {recordingEnabled && (
                <button type="button" onClick={startRecording} disabled={!configured || sending} aria-label="Record a voice note"
                  className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed">
                  <Mic size={18} />
                </button>
              )}
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                maxLength={1500}
                disabled={!configured}
                onChange={e=>{ setInput(e.target.value); grow(); }}
                onKeyDown={onKeyDown}
                placeholder={configured ? 'Message Hi Tech AI…  (Enter to send · Shift+Enter for newline)' : 'Configure VITE_N8N_CHAT_WEBHOOK to chat'}
                aria-label="Message Hi Tech AI"
                className="flex-1 resize-none max-h-[140px] px-4 py-2.5 bg-surface border border-zinc-300 rounded-xl text-[14px] text-zinc-900 leading-relaxed placeholder-zinc-500 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                onClick={send}
                disabled={!configured || sending || !input.trim()}
                aria-label="Send message"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed"
                style={{background: (!configured || sending || !input.trim()) ? 'var(--color-zinc-400)' : ACCENT}}
              >
                <Send size={17}/>
              </button>
            </div>
          )}

          {/* Accuracy disclaimer. Deliberately quiet and always present — it is a
              standing caveat, not a notification, and reps quoting specs to
              customers are exactly who needs to see it. */}
          <p className="text-[11px] text-zinc-500 text-center mt-2.5 px-2 leading-snug">
            Hi Tech AI can make mistakes. Please verify important information.
          </p>
        </motion.div>

      </Panel>
    </motion.div>
  );
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────
// Reads wap_expenses + wap_allowed_senders (both RLS-scoped: an employee only
// ever gets their own rows; the accountant gets everyone's). Everything below is
// derived client-side from those rows, so the same component serves both the
// team view (accountant) and the personal view (employee) off one fetch.

const monthLabel = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
const parseItems = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

// One receipt row → expands into the "digital receipt" card built from OCR data.
function ReceiptRow({ r, open, onToggle, showEmployee, canManage, team, splitRows, onChanged }) {
  const items = parseItems(r.items);
  const conf  = Math.round((Number(r.ai_confidence) || 0) * 100);
  const confColor = conf >= 85 ? POS : conf >= 70 ? 'var(--warn)' : NEG;
  const [mode, setMode] = useState(null);        // null | 'split' | 'confirmDelete'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shares = splitRows || [];

  // Deleting a receipt destroys a financial record, so it asks first, in place,
  // naming what will go. The DB writes an audit row before the delete lands.
  const doDelete = async () => {
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      const imagePath = await sbRpc(token, 'admin_delete_expense', { p_expense_id: r.expense_id });
      // Best-effort: the row is already gone, so a storage failure must not be
      // reported as a failed delete.
      if (imagePath) { try { await deleteReceiptImage(imagePath); } catch { /* orphaned object */ } }
      onChanged();
    } catch (e) { setError(e.message || 'Could not delete this receipt.'); setBusy(false); }
  };

  // Web receipts live in private Storage (image_path) → open via a short-lived signed
  // URL. Legacy WhatsApp receipts only have a Drive link. Open a blank tab first so the
  // async signing doesn't trip the popup blocker.
  const openStored = async (e) => {
    e.stopPropagation();
    const w = window.open('', '_blank');   // no 'noopener' → we get a real handle to reuse
    if (w) w.opener = null;                // sever opener for safety (tabnabbing)
    try {
      const url = await signedReceiptUrl(r.image_path);
      if (w) w.location = url;
      else window.open(url, '_blank', 'noopener');   // only if the blank tab was blocked
    } catch { if (w) w.close(); }
  };
  return (
    <div className="border-t border-zinc-100 first:border-t-0">
      <button type="button" onClick={onToggle}
        aria-expanded={open}
        className="group flex items-center gap-3 w-full text-left py-3 px-1 -mx-1 rounded-lg transition-colors hover:bg-zinc-50 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: catColor(r.category) }} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <span className="text-[14px] text-zinc-800 truncate font-medium block">{r.vendor_name || 'Unknown vendor'}</span>
          <p className="text-[12px] text-zinc-500 mt-0.5 truncate">
            {r.category}
            {showEmployee && <> · {r.employee_name}</>}
            {' · '}{(r.processed_at || '').slice(0, 10)}
            {shares.length > 0 && (
              <> · <span className="text-zinc-600 font-medium">split {shares.length} ways</span></>
            )}
          </p>
        </div>
        <span className="mono text-[13px] font-bold text-zinc-900 tabular-nums shrink-0">{fmtPKR(r.total)}</span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden">
            <div className="mb-3 mx-1 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
              {/* header line */}
              <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-dashed border-zinc-300">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-zinc-900 truncate">{r.vendor_name || 'Unknown vendor'}</p>
                  <p className="mono text-[10px] uppercase tracking-widest text-zinc-400 mt-0.5">{r.expense_id}</p>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-md text-white shrink-0" style={{ background: catColor(r.category) }}>{r.category}</span>
              </div>
              {/* line items */}
              {items.length > 0 ? (
                <div className="space-y-1.5">
                  {items.slice(0, 12).map((it, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-zinc-600 truncate">
                        {it.qty > 1 && <span className="mono text-zinc-400 mr-1">{it.qty}×</span>}
                        {it.description || 'Item'}
                      </span>
                      <span className="mono text-zinc-700 tabular-nums shrink-0">{fmtPKR(it.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[12px] text-zinc-400 italic">No line items detected</p>}
              {/* totals */}
              <div className="mt-3 pt-3 border-t border-dashed border-zinc-300 space-y-1">
                {Number(r.subtotal) > 0 && (
                  <div className="flex justify-between text-[12px] text-zinc-500"><span>Subtotal</span><span className="mono tabular-nums">{fmtPKR(r.subtotal)}</span></div>
                )}
                {Number(r.tax) > 0 && (
                  <div className="flex justify-between text-[12px] text-zinc-500"><span>Tax</span><span className="mono tabular-nums">{fmtPKR(r.tax)}</span></div>
                )}
                <div className="flex justify-between items-baseline pt-1">
                  <span className="text-[13px] font-semibold text-zinc-800">Total</span>
                  <span className="mono text-[16px] font-bold text-zinc-900 tabular-nums">{fmtPKR(r.total)}</span>
                </div>
              </div>

              {/* Who actually owes what. Shown to everyone who can see the
                  receipt, including an employee who is only on the split. */}
              {shares.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-zinc-300">
                  <p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1.5">Split between</p>
                  <div className="space-y-1">
                    {shares.map(s => (
                      <div key={s.sender_phone} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="text-zinc-600 truncate">{s.employee_name || s.sender_phone}</span>
                        <span className="mono text-zinc-800 font-medium tabular-nums shrink-0">{fmtPKR(s.share)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-2">
                    Paid by {r.employee_name || 'unknown'} · each person’s spend counts only their share
                  </p>
                  {/* An employee only ever sees their OWN share row (RLS), so the
                      lines won't add up to the total on their screen. Say so,
                      rather than leaving them to wonder where the rest went. */}
                  {Math.abs(shares.reduce((a, s) => a + (Number(s.share) || 0), 0) - (Number(r.total) || 0)) > 0.01 && (
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Other people’s shares of this bill aren’t shown to you.
                    </p>
                  )}
                </div>
              )}
              {/* meta footer */}
              <div className="mt-3 pt-3 border-t border-zinc-200 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
                <span>Paid: <span className="text-zinc-700">{r.payment_method || 'Unknown'}</span></span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: confColor }} />
                  AI confidence {conf}%
                </span>
                {r.image_path
                  ? <button type="button" onClick={openStored}
                      className="inline-flex items-center gap-1 text-accent hover:underline ml-auto"
                      title="Opens a private, time-limited link (only you and the accountant can view it)">
                      <ExternalLink size={11} /> View original
                    </button>
                  : r.drive_link
                    ? <a href={r.drive_link} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline ml-auto"
                        onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={11} /> View original
                      </a>
                    : <span className="inline-flex items-center gap-1 text-zinc-400 ml-auto"><ImageOff size={11} /> No image</span>}
              </div>

              {/* Accountant tools. Employees never see this block at all — and
                  the RPCs behind it re-check the role server-side regardless. */}
              {canManage && mode === null && (
                <div className="mt-3 pt-3 border-t border-zinc-200 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={e => { e.stopPropagation(); setMode('split'); }}
                    className="text-[12px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
                    {shares.length ? 'Edit split' : 'Split bill'}
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); setMode('confirmDelete'); }}
                    className="text-[12px] px-2.5 py-1.5 rounded-md border bg-surface transition-colors ml-auto hover:opacity-80"
                    style={{ borderColor: 'var(--danger-border)', color: NEG }}>
                    Delete
                  </button>
                </div>
              )}

              {canManage && mode === 'split' && (
                <SplitEditor
                  receipt={r} team={team} existing={shares}
                  onClose={() => setMode(null)}
                  onSaved={() => { setMode(null); onChanged(); }}
                />
              )}

              {canManage && mode === 'confirmDelete' && (
                <div className="mt-3 pt-3 border-t border-zinc-200" onClick={e => e.stopPropagation()}>
                  <p className="text-[13px] font-semibold text-zinc-900">Delete this receipt?</p>
                  <p className="text-[12.5px] text-zinc-600 mt-1">
                    {fmtPKR(r.total)} from {r.vendor_name || 'an unknown vendor'}, logged by{' '}
                    {r.employee_name || 'unknown'}. The receipt image is deleted too, and{' '}
                    {shares.length > 0 ? 'its split is removed. ' : ''}
                    this can’t be undone from here.
                  </p>
                  <p className="text-[11.5px] text-zinc-400 mt-1.5">
                    A record of the deletion is kept for the audit trail.
                  </p>
                  {error && <p role="alert" className="text-[12px] mt-2" style={{ color: NEG }}>{error}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button type="button" onClick={doDelete} disabled={busy}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded-md text-white disabled:opacity-40 transition-opacity hover:opacity-90"
                      style={{ background: 'var(--neg-solid)' }}>
                      {busy ? 'Deleting…' : 'Delete permanently'}
                    </button>
                    <button type="button" onClick={() => { setMode(null); setError(''); }} disabled={busy}
                      className="text-[12px] px-3 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Accountant: split a receipt across employees ──────────────────────────────
// Money must land exactly, so the editor refuses to save until the shares add up
// to the receipt total. The remainder is shown live rather than silently
// corrected — an accountant who mistypes 400 as 40 should see it, not have it
// quietly absorbed.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function SplitEditor({ receipt, team, existing, onClose, onSaved }) {
  // Seed from the existing split, else from the payer alone so the first click
  // starts from "everything is theirs" and the accountant peels people in.
  const [lines, setLines] = useState(() => {
    if (existing && existing.length) {
      return existing.map(s => ({ phone: s.sender_phone, amount: String(round2(s.share)) }));
    }
    // Seed line 1 with the payer only if they're a team member. Older receipts
    // were submitted by WhatsApp-roster numbers that belong to no account, and
    // seeding one of those puts a value in the <select> that has no <option> —
    // which renders as blank and silently fails validation on save.
    const payerIsOnTeam = team.some(p => p.phone === receipt.sender_phone);
    return [
      { phone: payerIsOnTeam ? receipt.sender_phone : '', amount: String(round2(receipt.total)) },
      { phone: '', amount: '' },
    ];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = round2(receipt.total);
  const allocated = round2(lines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0));
  const remainder = round2(total - allocated);
  const filled = lines.filter(l => l.phone && parseFloat(l.amount) > 0);
  const dupes = new Set(filled.map(l => l.phone)).size !== filled.length;
  const canSave = filled.length >= 2 && Math.abs(remainder) <= 0.01 && !dupes && !busy;

  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines(ls => [...ls, { phone: '', amount: '' }]);
  const dropLine = (i) => setLines(ls => ls.filter((_, j) => j !== i));

  // Even split across whoever is already named. Remainder pennies go to the
  // first line so the sum is exact rather than a rounded-down near-miss.
  const splitEvenly = () => {
    const named = lines.filter(l => l.phone);
    if (named.length < 2) return;
    const each = Math.floor((total / named.length) * 100) / 100;
    const drift = round2(total - each * named.length);
    let seen = 0;
    setLines(ls => ls.map(l => {
      if (!l.phone) return l;
      const amt = seen === 0 ? round2(each + drift) : each;
      seen += 1;
      return { ...l, amount: String(amt) };
    }));
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      await sbRpc(token, 'admin_set_expense_split', {
        p_expense_id: receipt.expense_id,
        p_shares: filled.map(l => ({ phone: l.phone, share: round2(l.amount) })),
      });
      onSaved();
    } catch (e) { setError(e.message || 'Could not save the split.'); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      await sbRpc(token, 'admin_clear_expense_split', { p_expense_id: receipt.expense_id });
      onSaved();
    } catch (e) { setError(e.message || 'Could not clear the split.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200" onClick={e => e.stopPropagation()}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
        <p className="text-[13px] font-semibold text-zinc-800">Split this receipt</p>
        <span className="mono text-[11px] text-zinc-400 tabular-nums">Total {fmtPKR(total)}</span>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={l.phone} onChange={e => setLine(i, { phone: e.target.value })}
              aria-label={`Employee ${i + 1}`}
              className="flex-1 min-w-0 text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2 py-1.5 outline-none focus:border-zinc-900">
              <option value="">Choose team member…</option>
              {team.map(p => (
                <option key={p.phone} value={p.phone}>{p.full_name}</option>
              ))}
            </select>
            <input
              type="number" inputMode="decimal" min="0" step="0.01"
              value={l.amount} onChange={e => setLine(i, { amount: e.target.value })}
              placeholder="0.00" aria-label={`Share ${i + 1}`}
              className="mono w-20 sm:w-24 shrink-0 text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2 py-1.5 text-right outline-none focus:border-zinc-900"
            />
            <button type="button" onClick={() => dropLine(i)} disabled={lines.length <= 2}
              aria-label={`Remove person ${i + 1}`}
              className="shrink-0 w-8 h-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        <button type="button" onClick={addLine}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
          + Add person
        </button>
        <button type="button" onClick={splitEvenly}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
          Split evenly
        </button>
        <span className="mono text-[11.5px] tabular-nums ml-auto"
          style={{ color: Math.abs(remainder) <= 0.01 ? POS : 'var(--warn)' }}>
          {Math.abs(remainder) <= 0.01
            ? 'Balances exactly'
            : remainder > 0 ? `${fmtPKR(remainder)} unallocated` : `${fmtPKR(-remainder)} over`}
        </span>
      </div>

      {dupes && (
        <p className="text-[12px] mt-2" style={{ color: 'var(--warn)' }}>
          The same person is listed twice — give them one combined share.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12px] mt-2" style={{ color: NEG }}>{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" onClick={save} disabled={!canSave}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-md text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Saving…' : 'Save split'}
        </button>
        <button type="button" onClick={onClose}
          className="text-[12px] px-3 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
          Cancel
        </button>
        {existing && existing.length > 0 && (
          <button type="button" onClick={clear} disabled={busy}
            className="text-[12px] px-3 py-1.5 rounded-md ml-auto hover:underline" style={{ color: NEG }}>
            Remove split
          </button>
        )}
      </div>
    </div>
  );
}

// ── Accountant: monthly spending limits ───────────────────────────────────────
// wap_allowed_senders.spending_limit is the monthly cap. This panel is the only
// place it can be set, and it sits next to the actual spend so the number is
// chosen against evidence rather than from memory. 0 means no cap.
function BudgetPanel({ team, spendByPhone, month, canManage, onSaved }) {
  const [editing, setEditing] = useState(null);   // phone being edited
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = (p) => { setEditing(p.phone); setDraft(String(round2(p.spending_limit))); setError(''); };
  const cancel = () => { setEditing(null); setError(''); };

  const save = async (phone) => {
    const value = parseFloat(draft);
    if (!(value >= 0)) { setError('Enter a number — 0 for no limit.'); return; }
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      await sbRpc(token, 'admin_set_spending_limit', { p_phone: phone, p_limit: round2(value) });
      setEditing(null);
      onSaved();
    } catch (e) { setError(e.message || 'Could not save the limit.'); }
    finally { setBusy(false); }
  };

  const people = team
    .map(p => {
      const spent = spendByPhone.get(p.phone) || 0;
      const limit = Number(p.spending_limit) || 0;
      return { ...p, spent, limit, pct: limit > 0 ? Math.min(spent / limit, 1.5) : 0 };
    })
    .sort((a, b) => (b.limit > 0 ? b.spent / b.limit : 0) - (a.limit > 0 ? a.spent / a.limit : 0));

  if (people.length === 0) return null;

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Monthly limits</h2>
        <span className="mono text-[11px] text-zinc-400">{monthLabel(month)}</span>
      </div>
      <p className="text-[13px] text-zinc-500 mb-4">
        {canManage
          ? 'Spend so far this month against each person’s cap. Their share of a split bill counts, not the whole receipt.'
          : 'Your spending this month against your monthly cap.'}
      </p>

      <div className="space-y-3.5">
        {people.map(p => {
          const over = p.limit > 0 && p.spent > p.limit;
          const near = p.limit > 0 && !over && p.spent >= p.limit * 0.8;
          const barColor = over ? NEG : near ? 'var(--warn)' : POS;
          return (
            <div key={p.phone}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-zinc-800 truncate min-w-0">{p.full_name}</span>
                <span className="mono text-[12px] tabular-nums shrink-0 text-zinc-600">
                  {fmtPKR(p.spent)}
                  <span className="text-zinc-400"> / {p.limit > 0 ? fmtPKR(p.limit) : 'no limit'}</span>
                </span>
              </div>

              <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.min(p.pct, 1) * 100}%`, background: barColor }} />
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                {p.limit > 0 && (
                  <span className={`text-[11.5px] ${over || near ? '' : 'text-zinc-400'}`}
                    style={over ? { color: NEG } : near ? { color: 'var(--warn)' } : undefined}>
                    {over
                      ? `${fmtPKR(p.spent - p.limit)} over budget`
                      : `${fmtPKR(p.limit - p.spent)} left`}
                  </span>
                )}
                {canManage && editing !== p.phone && (
                  <button type="button" onClick={() => start(p)}
                    className="text-[11.5px] text-accent hover:underline ml-auto">
                    {p.limit > 0 ? 'Change limit' : 'Set a limit'}
                  </button>
                )}
              </div>

              {canManage && editing === p.phone && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input
                    type="number" inputMode="decimal" min="0" step="1" autoFocus
                    value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') save(p.phone); if (e.key === 'Escape') cancel(); }}
                    aria-label={`Monthly limit for ${p.full_name}`}
                    className="mono w-32 text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2 py-1.5 text-right outline-none focus:border-zinc-900"
                  />
                  <button type="button" onClick={() => save(p.phone)} disabled={busy}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-md text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={cancel} disabled={busy}
                    className="text-[12px] px-3 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
                    Cancel
                  </button>
                  <span className="text-[11px] text-zinc-400 w-full sm:w-auto">0 = no limit</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="text-[12px] mt-3" style={{ color: NEG }}>{error}</p>}
    </Panel>
  );
}

// A receipt with a split no longer belongs to whoever paid — it belongs, in
// pieces, to the people on the split. Everything downstream (per-employee bars,
// totals, budgets) has to count those pieces, or one person's card carries the
// whole table's dinner.
//
// Returns one row per person per receipt: the split shares if there are any,
// otherwise a single row for the payer. `amount` is what that person owes;
// `total` stays the receipt's face value so the ledger can still show it.
function toShareRows(rows, splitsByExpense) {
  const out = [];
  for (const r of rows) {
    const parts = splitsByExpense.get(r.expense_id);
    if (!parts || parts.length === 0) {
      out.push({ ...r, amount: Number(r.total) || 0, isSplit: false });
      continue;
    }
    for (const p of parts) {
      out.push({
        ...r,
        user_id: p.user_id || r.user_id,
        employee_name: p.employee_name || r.employee_name,
        sender_phone: p.sender_phone,
        amount: Number(p.share) || 0,
        isSplit: true,
      });
    }
  }
  return out;
}

// One person is one account, not one spelling of a name. The two intake paths
// used to write the name from two hand-maintained tables, so the same human
// arrived as "Sarim" from the web and "sarim" from WhatsApp and totalled up as
// two people. Receipts submitted by a roster number that belongs to no login
// have no account to key on, so those still fall back to the stamped name.
const personKey = (r) => r.user_id || `name:${(r.employee_name || '').trim().toLowerCase()}`;

function ExpensesTab({ role, onAuthError }) {
  const isEmployee = role === 'employee';
  const [rows,   setRows]   = useState(null);
  const [splits, setSplits] = useState([]);
  const [team,   setTeam]   = useState([]);
  const [err,    setErr]    = useState(false);
  const [monthSel, setMonthSel] = useState(null);
  const [dept,   setDept]   = useState('all');
  const [selEmp, setSelEmp] = useState(null);
  const [empSearch, setEmpSearch] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const comboRef = useRef(null);
  const [openId, setOpenId] = useState(null);

  // Close the employee suggestion dropdown when clicking outside the combobox.
  useEffect(() => {
    if (!suggestOpen) return;
    const onDoc = (e) => { if (comboRef.current && !comboRef.current.contains(e.target)) setSuggestOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [suggestOpen]);

  // Bumped to force a refetch after a delete/split/limit edit, so the numbers
  // can never drift from what the database actually holds.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token;
      try { token = await getAccessToken(); } catch { onAuthError?.(); return; }
      try {
        // All three are RLS-scoped, so an employee gets their own receipts, their
        // own shares, and only themselves as a team member — one path, both roles.
        // People come from expense_team_members() — the Team section — NOT from
        // the WhatsApp roster. The roster is "who may submit by WhatsApp": it
        // contains entries that are nobody's account, and misses team members
        // who have never submitted. Both are wrong for charging money to.
        const [ex, sp, team] = await Promise.all([
          sbFetch(token, 'wap_expenses',
            'select=expense_id,user_id,employee_name,department,category,total,subtotal,tax,currency,payment_method,vendor_name,date,processed_at,drive_link,image_path,ai_confidence,items,status,sender_phone&status=neq.rejected&order=processed_at.desc&limit=2000'),
          sbFetch(token, 'wap_expense_splits',
            'select=expense_id,user_id,sender_phone,employee_name,share&limit=5000'),
          sbRpc(token, 'expense_team_members'),
        ]);
        if (cancelled) return;
        setRows(ex.data);
        setSplits(sp.data);
        setTeam(Array.isArray(team) ? team : []);
        setErr(false);
      } catch { if (!cancelled) { setErr(true); setRows([]); } }
    })();
    return () => { cancelled = true; };
  }, [onAuthError, reloadKey]);

  // Deactivated logins can't be charged on a NEW split. An existing split still
  // renders them, because the split rows carry their own names.
  const selectableTeam = useMemo(() => team.filter(p => !p.banned), [team]);

  // expense_id → its shares. Built once; every derived figure below reads it.
  const splitsByExpense = useMemo(() => {
    const m = new Map();
    for (const s of splits) {
      if (!m.has(s.expense_id)) m.set(s.expense_id, []);
      m.get(s.expense_id).push(s);
    }
    return m;
  }, [splits]);

  const months = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => (r.processed_at || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  }, [rows]);
  // Effective month = the user's pick if still valid, else the latest available.
  // Derived (not stored) so it self-corrects when the data changes, no effect needed.
  const month = (monthSel && months.includes(monthSel)) ? monthSel : (months[0] || null);

  const depts = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => r.department).filter(Boolean))].sort();
  }, [rows]);

  // Scope = current month + department filter (team). selEmp narrows further.
  const inScope = useMemo(() => {
    if (!rows) return [];
    return rows.filter(r =>
      (r.processed_at || '').slice(0, 7) === month &&
      (dept === 'all' || r.department === dept));
  }, [rows, month, dept]);

  // The same scope exploded per person, so a split lands on each participant.
  const inScopeShares = useMemo(
    () => toShareRows(inScope, splitsByExpense), [inScope, splitsByExpense]);

  // Keyed on the account; the name comes along only to label the bar.
  const byEmployee = useMemo(() => {
    const m = new Map();
    for (const r of inScopeShares) {
      const pkey = personKey(r);
      const hit = m.get(pkey);
      if (hit) hit.total += r.amount;
      else m.set(pkey, { pkey, name: r.employee_name || '—', total: r.amount });
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [inScopeShares]);

  // selEmp holds the person key, which is a uuid for anyone with a login — so
  // every label that used to print it needs the human name instead.
  const selEmpName = useMemo(() => {
    if (!selEmp) return '';
    const hit = byEmployee.find(e => e.pkey === selEmp);
    if (hit) return hit.name;
    const anyRow = (rows || []).find(r => personKey(r) === selEmp);
    return anyRow?.employee_name || '';
  }, [selEmp, byEmployee, rows]);

  // Budgets are per-person and per-month, and ignore the department/employee
  // filters — a cap is a property of the person, not of the current view.
  //
  // These still key on PHONE, unlike everything else here, which keys on the
  // account (see personKey). That is deliberate: the cap itself lives on
  // wap_allowed_senders.spending_limit, which is a phone-keyed roster, and
  // expense_team_members() hands back phones rather than account ids. Moving
  // budgets to user_id means changing both, so it stays a separate job.
  //
  // Older receipts carry sender_phone = null (they predate admins having a
  // phone on app_users). Keying on the phone alone dropped them and counted
  // only split rows, which always carry one. Fall back to the name the receipt
  // was stamped with, resolved against the team.
  //
  // Only when exactly one team member bears that name: two people can share a
  // name, and guessing would charge the wrong person's budget.
  const phoneByName = useMemo(() => {
    const counts = new Map();
    for (const p of team) {
      const k = (p.full_name || '').trim().toLowerCase();
      if (!k) continue;
      counts.set(k, counts.has(k) ? null : p.phone);   // null marks "ambiguous"
    }
    return counts;
  }, [team]);

  const spendByPhone = useMemo(() => {
    if (!rows) return new Map();
    const monthRows = rows.filter(r => (r.processed_at || '').slice(0, 7) === month);
    const m = new Map();
    for (const s of toShareRows(monthRows, splitsByExpense)) {
      const phone = s.sender_phone
        || phoneByName.get((s.employee_name || '').trim().toLowerCase())
        || null;
      if (!phone) continue;
      m.set(phone, (m.get(phone) || 0) + s.amount);
    }
    return m;
  }, [rows, month, splitsByExpense, phoneByName]);

  // Search narrows the bars + list to matching employees (accountant, many staff).
  const empQuery = empSearch.trim().toLowerCase();
  const byEmployeeShown = useMemo(
    () => (empQuery ? byEmployee.filter(e => (e.name || '').toLowerCase().includes(empQuery)) : byEmployee),
    [byEmployee, empQuery]);

  // Focus is applied to the share rows, so drilling into one employee shows
  // their portion of a split receipt rather than the whole bill.
  const focusShares = useMemo(() => {
    if (selEmp) return inScopeShares.filter(r => personKey(r) === selEmp);
    if (!isEmployee && empQuery) return inScopeShares.filter(r => (r.employee_name || '').toLowerCase().includes(empQuery));
    return inScopeShares;
  }, [inScopeShares, selEmp, empQuery, isEmployee]);

  // The ledger lists receipts, not shares — one card per physical receipt, even
  // when several people are on it. Deduped by expense_id so a split receipt
  // doesn't appear once per participant.
  const focusRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of focusShares) {
      if (seen.has(s.expense_id)) continue;
      seen.add(s.expense_id);
      const original = inScope.find(r => r.expense_id === s.expense_id);
      out.push(original || s);
    }
    return out;
  }, [focusShares, inScope]);

  // Accountant searched a name that matches no one this month → show a clear
  // "not found" state instead of empty charts/KPIs.
  const empNoMatch = !isEmployee && !!empQuery && !selEmp && byEmployeeShown.length === 0;

  const byCategory = useMemo(() => {
    const m = {};
    focusShares.forEach(r => { const c = CATS.includes(r.category) ? r.category : 'Other'; m[c] = (m[c] || 0) + r.amount; });
    return CATS.filter(c => m[c] > 0).map(c => ({ category: c, total: m[c] }));
  }, [focusShares]);

  const trend = useMemo(() => {
    if (!rows) return [];
    const scope = toShareRows(
      rows.filter(r => dept === 'all' || r.department === dept),
      splitsByExpense,
    ).filter(r => !selEmp || personKey(r) === selEmp);
    const m = {};
    scope.forEach(r => { const k = (r.processed_at || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + r.amount; });
    return Object.keys(m).sort().map(k => ({ month: k, label: monthLabel(k), total: m[k] }));
  }, [rows, dept, selEmp, splitsByExpense]);

  // KPIs for the focused scope (month + dept + selEmp). Spend is the sum of
  // shares; the receipt count is physical receipts, so a split bill is one.
  const totalSpend = focusShares.reduce((a, r) => a + r.amount, 0);
  const count = focusRows.length;
  const avg = count ? totalSpend / count : 0;
  const heroCount = useCountUp(Math.round(totalSpend));
  const topCat = byCategory.length ? [...byCategory].sort((a, b) => b.total - a.total)[0] : null;

  const listRows = focusRows;  // receipt ledger honours the same focus

  if (rows === null) return <Skeleton />;

  const noData = rows.length === 0;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <HelpNote>
        {isEmployee
          ? 'Your submitted receipts and spending. Only you and the accountant can see these.'
          : 'Every employee’s receipts and spending, from the WhatsApp receipt bot. Click an employee’s bar to drill into just their spend.'}
      </HelpNote>

      {err && (
        <div role="alert" className="rounded-lg border px-4 py-3 text-[13px]" style={{ borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
          Couldn’t load expenses. If this persists, your account may not be mapped to an employee yet — ask the accountant.
        </div>
      )}

      {noData ? (
        <Panel className="p-10 text-center">
          <Receipt size={28} className="mx-auto text-zinc-300" />
          <p className="text-[15px] font-semibold text-zinc-800 mt-3">No receipts yet</p>
          <p className="text-[13px] text-zinc-500 mt-1 max-w-sm mx-auto">
            {isEmployee
              ? 'Send a photo of a receipt to the HiTech WhatsApp bot and it’ll show up here.'
              : 'Once employees submit receipts through the WhatsApp bot, their spending appears here.'}
          </p>
        </Panel>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <Label>Month</Label>
              <select value={month || ''} onChange={e => { setMonthSel(e.target.value); setOpenId(null); }}
                className="mono text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20">
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            {!isEmployee && depts.length > 1 && (
              <div className="flex items-center gap-1.5">
                <Label>Dept</Label>
                <select value={dept} onChange={e => { setDept(e.target.value); setSelEmp(null); }}
                  className="text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20">
                  <option value="all">All departments</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            {!isEmployee && (
              <div ref={comboRef} className="relative flex items-center">
                <Search size={13} className="absolute left-2.5 text-zinc-400 pointer-events-none z-10" />
                <input
                  type="text" value={empSearch}
                  onChange={e => { setEmpSearch(e.target.value); setSelEmp(null); setSuggestOpen(true); }}
                  onFocus={() => setSuggestOpen(true)}
                  placeholder="Search employee…"
                  aria-label="Search employee"
                  role="combobox" aria-expanded={suggestOpen && !!empQuery} aria-autocomplete="list"
                  className="text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md pl-8 pr-7 py-1.5 w-48 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20 placeholder:text-zinc-400"
                />
                {empSearch && (
                  <button onClick={() => { setEmpSearch(''); setSuggestOpen(false); }} aria-label="Clear search"
                    className="absolute right-1.5 flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-zinc-900 z-10">
                    <X size={12} />
                  </button>
                )}
                {suggestOpen && empQuery && (
                  <ul role="listbox" className="absolute top-full left-0 mt-1.5 w-64 max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-surface shadow-lg z-30 py-1">
                    {byEmployeeShown.length === 0 ? (
                      <li className="px-3 py-2.5 text-[12px] text-zinc-400">No employee matches “{empSearch}”.</li>
                    ) : byEmployeeShown.slice(0, 8).map(e => (
                      <li key={e.name} role="option" aria-selected={false}>
                        <button
                          onMouseDown={ev => { ev.preventDefault(); setSelEmp(e.name); setEmpSearch(''); setSuggestOpen(false); }}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-50 transition-colors">
                          <span className="text-[12.5px] text-zinc-800 truncate">{e.name}</span>
                          <span className="mono text-[11px] text-zinc-400 shrink-0">{fmtPKR(e.total)}</span>
                        </button>
                      </li>
                    ))}
                    {byEmployeeShown.length > 8 && (
                      <li className="px-3 py-1.5 text-[11px] text-zinc-400 border-t border-zinc-100 mt-1">
                        +{byEmployeeShown.length - 8} more — keep typing to narrow.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
            {!isEmployee && selEmp && (
              <button onClick={() => setSelEmp(null)}
                className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
                {selEmpName} <X size={12} className="text-zinc-400" />
              </button>
            )}
          </div>

          {empNoMatch ? (
            <Panel className="p-10 text-center">
              <Search size={26} className="mx-auto text-zinc-300" />
              <p className="text-[15px] font-semibold text-zinc-800 mt-3">No employee found</p>
              <p className="text-[13px] text-zinc-500 mt-1">
                Nothing matches “{empSearch}” in {monthLabel(month)}. Check the spelling, or pick a different month.
              </p>
              <button onClick={() => setEmpSearch('')}
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors">
                <X size={12} /> Clear search
              </button>
            </Panel>
          ) : (
          <>
          {/* KPI cluster */}
          <Panel className="grid grid-cols-1 md:grid-cols-[1.6fr_repeat(3,1fr)] divide-y md:divide-y-0 md:divide-x divide-zinc-200 overflow-hidden">
            <div className="p-6">
              <span className="flex items-center gap-1">
                <Label>{isEmployee ? 'Your spend' : (selEmp ? `${selEmpName}’s spend` : 'Total spend')}</Label>
                <HintIcon text={`Total logged spend for ${monthLabel(month)}${selEmp ? ` · ${selEmpName}` : ''}`} />
              </span>
              <div className="mt-4 flex items-end gap-2">
                <span className="mono text-[13px] font-semibold text-zinc-400 mb-1.5">PKR</span>
                <span className="text-[40px] leading-[0.85] font-extrabold tracking-[-0.03em] text-zinc-900 tabular-nums">{heroCount}</span>
              </div>
              <p className="text-[12px] text-zinc-400 mt-3">{monthLabel(month)}</p>
            </div>
            {[
              { label: 'Receipts', value: count, hint: isEmployee ? 'Receipts you submitted this month' : 'Receipts logged in this view' },
              { label: 'Avg receipt', value: fmtPKR(avg), hint: 'Average value per receipt' },
              { label: 'Top category', value: topCat ? topCat.category : '—', sub: topCat ? fmtPKR(topCat.total) : null, hint: 'Biggest spending category in this view' },
            ].map(c => (
              <div key={c.label} className="p-6 flex flex-col justify-between gap-6">
                <span className="flex items-center gap-1">
                  <Label>{c.label}</Label>{c.hint && <HintIcon text={c.hint} />}
                </span>
                <div>
                  <span className="mono text-[26px] leading-none font-bold tracking-tight text-zinc-900">
                    {typeof c.value === 'number' ? c.value.toLocaleString() : c.value}
                  </span>
                  {c.sub && <p className="mono text-[11px] text-zinc-400 mt-1.5">{c.sub}</p>}
                </div>
              </div>
            ))}
          </Panel>

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
            />
          </Suspense>

          {/* Monthly limits — the accountant sets them, an employee sees only
              their own row (expense_team_members returns only them). */}
          <BudgetPanel
            team={team}
            spendByPhone={spendByPhone}
            month={month}
            canManage={!isEmployee}
            onSaved={reload}
          />

          {/* Receipt ledger */}
          <Panel className="p-6">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Receipts</h2>
              <span className="mono text-[11px] text-zinc-400 tabular-nums">{listRows.length} in view</span>
            </div>
            <p className="text-[13px] text-zinc-500 mb-4">{monthLabel(month)}{selEmp ? ` · ${selEmpName}` : (empQuery ? ` · “${empSearch}”` : '')} — click a row for the full receipt</p>
            {listRows.length === 0
              ? <p className="text-[13px] text-zinc-400 py-6 text-center">No receipts in this view.</p>
              : (
                <div>
                  {listRows.slice(0, 80).map(r => (
                    <ReceiptRow key={r.expense_id}
                      r={r}
                      open={openId === r.expense_id}
                      onToggle={() => setOpenId(id => id === r.expense_id ? null : r.expense_id)}
                      showEmployee={!isEmployee && !selEmp}
                      canManage={!isEmployee}
                      team={selectableTeam}
                      splitRows={splitsByExpense.get(r.expense_id)}
                      onChanged={reload}
                    />
                  ))}
                  {listRows.length > 80 && (
                    <p className="text-[12px] text-zinc-400 pt-3 mt-1 border-t border-zinc-100 text-center">
                      Showing 80 of {listRows.length} — filter by employee or department to narrow.
                    </p>
                  )}
                </div>
              )}
          </Panel>
          </>
          )}
        </>
      )}
    </motion.div>
  );
}

// ── Team / Roles Tab (admin only) ─────────────────────────────────────────────
// Add a team member directly (creates the Supabase login + writes app_users and,
// for employees, the WhatsApp roster) via the admin-create-user Edge Function, and
// edit existing people's role/identity via the admin_set_role RPC. Both re-check
// admin server-side, so nothing here can be abused from the client.

const ROLE_CHOICES = [
  { value: 'admin',      label: 'Admin',      desc: 'Full access — all tabs + everyone’s expenses' },
  { value: 'accountant', label: 'Accountant', desc: 'Everyone’s expenses + sales tabs' },
  { value: 'employee',   label: 'Employee',   desc: 'Only their own expenses (linked by phone)' },
];

const genPassword = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 12; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};

const teamInput = 'text-[13px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20 placeholder:text-zinc-400';

const emptyForm = { full_name: '', role: 'employee', department: '', email: '', phone: '', password: '', invite: true };

// Department picker: a styled combobox (not the native datalist). Lets you pick an
// existing department from a nice dropdown — matching the app's look — or type a new
// one. `options` are the departments already in use, so admins reuse the exact spelling
// instead of creating "AI" vs "ai" duplicates.
function DeptCombo({ value, onChange, options, placeholder, className = 'w-full' }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);   // input position, for the portalled menu
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    // Portalled to <body>, outside the body's content scale — same conversion as
    // HintIcon: the menu carries the scale, so the input's visual rect is divided
    // back into the menu's own zoomed coordinates or it lands low and to the right
    // of the field it belongs to. The 6px gap and 176px floor are design values in
    // that same zoomed space, so they stay as written.
    const z = zoomOf(el);
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom / z + 6, left: r.left / z, width: Math.max(r.width / z, 176), z });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Close on outside click (the menu lives in a portal, so check it too), and on
    // scroll/resize (the fixed-position menu would otherwise drift from the input).
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  const q = (value || '').trim().toLowerCase();
  const list = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
  const isNew = !!q && !options.some(o => o.toLowerCase() === q);
  const showPanel = open && !!rect && (list.length > 0 || isNew);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        role="combobox" aria-expanded={showPanel} aria-autocomplete="list"
        className={`${teamInput} w-full pr-7`}
      />
      <button type="button" tabIndex={-1} aria-label="Toggle departments" onClick={() => { setOpen(o => !o); place(); }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 text-zinc-400 hover:text-zinc-700">
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {showPanel && createPortal(
        <ul ref={menuRef} role="listbox"
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zoom: rect.z, zIndex: 60 }}
          className="max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-surface shadow-lg py-1">
          {list.map(o => (
            <li key={o} role="option" aria-selected={o.toLowerCase() === q}>
              <button type="button"
                onMouseDown={ev => { ev.preventDefault(); onChange(o); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[12.5px] text-zinc-800 hover:bg-zinc-50 transition-colors">
                {o}
              </button>
            </li>
          ))}
          {isNew && (
            <li className="px-3 py-1.5 text-[11px] text-zinc-400 border-t border-zinc-100">
              New department: <span className="text-zinc-600 font-medium">{value.trim()}</span>
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}

function TeamTab({ role, onAuthError }) {
  const [users,  setUsers]  = useState(null);
  const [drafts, setDrafts] = useState({});   // user_id -> { role, phone, full_name, department }
  const [saving, setSaving] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [err,    setErr]    = useState('');
  // Add-member form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [adding, setAdding]   = useState(false);
  const [addErr, setAddErr]   = useState('');
  const [addOk,  setAddOk]    = useState(null); // { login, password }
  const [acting, setActing]   = useState(null); // user_id being deactivated/deleted
  const [confirmDel, setConfirmDel] = useState(null);
  const myId = currentUserId();

  const load = useCallback(async () => {
    let token; try { token = await getAccessToken(); } catch { onAuthError?.(); return; }
    try {
      const data = await sbRpc(token, 'admin_list_users');
      const list = Array.isArray(data) ? data : [];
      setUsers(list);
      const d = {};
      list.forEach(u => { d[u.user_id] = {
        role: u.role === 'unassigned' ? 'employee' : u.role,
        phone: u.phone || '', full_name: u.full_name || '', department: u.department || '',
      }; });
      setDrafts(d);
      setErr('');
    } catch (e) { setErr(e.message || 'Failed to load users'); setUsers([]); }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  const setDraft = (id, patch) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }));
  const setF = (patch) => setForm(f => ({ ...f, ...patch }));

  const save = async (u) => {
    const dr = drafts[u.user_id];
    // admin_set_role raises on a blank phone rather than nulling it (which is the
    // bug that used to strip an admin's number on every edit). Catch it here so
    // the admin gets a sentence instead of a Postgres exception.
    if (!String(dr.phone || '').trim()) {
      setErr('A phone number is required — it is how the WhatsApp bot recognises them.');
      return;
    }
    setSaving(u.user_id); setErr('');
    let token; try { token = await getAccessToken(); } catch { onAuthError?.(); setSaving(null); return; }
    try {
      await sbRpc(token, 'admin_set_role', {
        p_target: u.user_id, p_role: dr.role,
        // Required for every role: it is the bot's link to this person.
        p_phone: dr.phone || null,
        p_full_name: dr.full_name || null,
        p_department: (dr.department || '').trim() || null,
      });
      setSavedId(u.user_id);
      setTimeout(() => setSavedId(s => (s === u.user_id ? null : s)), 1800);
      await load();
    } catch (e) { setErr(e.message || 'Save failed'); }
    setSaving(null);
  };

  const addMember = async () => {
    setAdding(true); setAddErr(''); setAddOk(null);
    let token; try { token = await getAccessToken(); } catch { onAuthError?.(); setAdding(false); return; }
    try {
      const useInvite = !!form.email.trim() && form.invite;
      const payload = { ...form, invite: useInvite, redirect_to: window.location.origin + '/' };
      const res = await sbFunction(token, 'admin-create-user', payload);
      setAddOk({ login: res.login_email, password: form.password, invited: res.invited, warning: res.warning });
      setForm(emptyForm);
      await load();
    } catch (e) { setAddErr(e.message || 'Could not add member'); }
    setAdding(false);
  };

  const manage = async (userId, action) => {
    setActing(userId); setErr(''); setConfirmDel(null);
    let token; try { token = await getAccessToken(); } catch { onAuthError?.(); setActing(null); return; }
    try { await sbFunction(token, 'admin-manage-user', { target: userId, action }); await load(); }
    catch (e) { setErr(e.message || 'Action failed'); }
    setActing(null);
  };

  if (role !== 'admin') {
    return <Panel className="p-8 text-center text-[14px] text-zinc-500">Only admins can manage the team.</Panel>;
  }
  if (users === null) return <Skeleton />;

  const stored = Object.fromEntries((users || []).map(u => [u.user_id, {
    role: u.role === 'unassigned' ? 'employee' : u.role,
    phone: u.phone || '', full_name: u.full_name || '', department: u.department || '',
  }]));

  // Departments already in use — offered as suggestions so admins reuse the exact
  // spelling instead of creating "AI" vs "ai" duplicates. Case-insensitive de-dupe.
  const departments = [...new Map(
    (users || []).map(u => (u.department || '').trim()).filter(Boolean)
      .map(d => [d.toLowerCase(), d])
  ).values()].sort((a, b) => a.localeCompare(b));

  // Invite when a real email is present and the invite toggle is on; otherwise the admin
  // sets a password (the only option for phone-only staff, who have no inbox).
  const useInvite = !!form.email.trim() && form.invite;
  // The phone is required for every role, not just employees: it is what links a
  // person to the WhatsApp bot (the whatsapp_members view matches on it), so a
  // member without one is half-created — they can sign in, but the bot will never
  // answer them and nothing on screen would explain why. admin-create-user
  // enforces the same rule server-side.
  const canAdd = form.full_name.trim()
    && form.phone.trim()
    && (useInvite || form.password.length >= 8);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <HelpNote>
        Add a team member and they can log in right away — with their <b>email or their phone number</b>.
        A phone is <b>required for everyone</b>: it’s their identity (unique, so two people can share a
        name safely), it’s how the WhatsApp bot recognises them, and it’s what links their receipts to
        them. Adding someone here grants all three — login, WhatsApp chat and receipts — in one step.
      </HelpNote>

      {/* Add member */}
      <Panel className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCog size={16} className="text-zinc-400" />
            <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Add team member</h2>
          </div>
          <button onClick={() => { setShowAdd(v => !v); setAddErr(''); setAddOk(null); }}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-zinc-300 text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 transition-colors">
            {showAdd ? 'Close' : 'New member'}
          </button>
        </div>

        {addOk && (
          <div className="mt-4 rounded-lg border px-4 py-3 text-[13px]" style={{ borderColor: 'var(--success-border)', background: 'var(--success-bg)', color: 'var(--success-text)' }}>
            {addOk.invited ? (
              <>✓ Invite sent to <b>{addOk.login}</b>. They'll get an email to set their own password and finish signing in.</>
            ) : (
              <>✓ Created. They can sign in with <b>{addOk.login}</b> and the temporary password{' '}
              <span className="mono px-1.5 py-0.5 rounded bg-surface border border-zinc-200 text-zinc-800">{addOk.password}</span> — share it with them.</>
            )}
            {addOk.warning && <div className="mt-1 text-[12px]" style={{ color: 'var(--warn-text)' }}>{addOk.warning}</div>}
          </div>
        )}

        <AnimatePresence initial={false}>
          {showAdd && (
            <motion.div key="addform" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <Label>Full name</Label>
                  <input className={teamInput} value={form.full_name} onChange={e => setF({ full_name: e.target.value })} placeholder="e.g. Ali Raza" />
                </label>
                <label className="flex flex-col gap-1">
                  <Label>Role</Label>
                  <select className={teamInput} value={form.role} onChange={e => setF({ role: e.target.value })}>
                    {ROLE_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                {/* Required for every role. The phone is the link to the WhatsApp bot
                    (the whatsapp_members view matches on it), so a Team member without
                    one can sign in but the bot will never answer them — a half-created
                    person with nothing on screen to explain why. The server enforces
                    this too, in admin-create-user. */}
                <label className="flex flex-col gap-1">
                  <Label>WhatsApp phone (required)</Label>
                  <input className={teamInput} value={form.phone} onChange={e => setF({ phone: e.target.value })} placeholder="923001234567" inputMode="numeric" required />
                </label>
                <label className="flex flex-col gap-1">
                  <Label>Email {form.role === 'employee' ? '(optional)' : '(for login)'}</Label>
                  <input className={teamInput} value={form.email} onChange={e => setF({ email: e.target.value })} placeholder="name@company.com" type="email" />
                </label>
                <label className="flex flex-col gap-1">
                  <Label>Department</Label>
                  <DeptCombo value={form.department} onChange={v => setF({ department: v })} options={departments} placeholder="e.g. sales" />
                </label>
                {useInvite ? (
                  <div className="flex flex-col gap-1">
                    <Label>Password</Label>
                    <div className={`${teamInput} flex items-center text-zinc-400`}>They set their own via the invite</div>
                  </div>
                ) : (
                  <label className="flex flex-col gap-1">
                    <Label>Temporary password</Label>
                    <div className="flex gap-1.5">
                      <input className={`${teamInput} flex-1`} value={form.password} onChange={e => setF({ password: e.target.value })} placeholder="min 8 characters" />
                      <button type="button" onClick={() => setF({ password: genPassword() })}
                        className="text-[11px] font-semibold px-2.5 rounded-md border border-zinc-300 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 transition-colors shrink-0">Generate</button>
                    </div>
                  </label>
                )}
              </div>

              {form.email.trim() && (
                <label className="flex items-center gap-2 mt-3 text-[12px] text-zinc-600 cursor-pointer select-none">
                  <input type="checkbox" checked={form.invite} onChange={e => setF({ invite: e.target.checked })} className="accent-zinc-900" />
                  Email them an invite to set their own password
                </label>
              )}

              <p className="text-[12px] text-zinc-400 mt-3">
                {`Identified by phone — the WhatsApp bot recognises them by it, and their receipts link to it. ${
                  form.role === 'employee'
                    ? 'They log in with phone or email.'
                    : 'They log in with email, or with their phone.'
                } ${useInvite ? 'They’ll set their own password from the invite email.' : 'Uses the password you set here.'}`}
              </p>

              {addErr && <div role="alert" className="mt-3 text-[13px]" style={{ color: NEG }}>{addErr}</div>}

              <div className="mt-4 flex justify-end">
                <button onClick={addMember} disabled={!canAdd || adding}
                  className="text-[13px] font-semibold px-4 py-2 rounded-md text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {adding ? (useInvite ? 'Sending…' : 'Creating…') : (useInvite ? 'Send invite' : 'Create login')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      {err && (
        <div role="alert" className="rounded-lg border px-4 py-3 text-[13px]" style={{ borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
          {err}
        </div>
      )}

      {/* Existing members */}
      <Panel className="p-2 sm:p-4">
        <div className="divide-y divide-zinc-100">
          {users.map(u => {
            const dr = drafts[u.user_id] || { role: 'employee', phone: '', full_name: '', department: '' };
            const st = stored[u.user_id];
            const dirty = dr.role !== st.role || (dr.full_name || '') !== (st.full_name || '')
              || (dr.department || '') !== (st.department || '')
              || (dr.phone || '') !== (st.phone || '');
            const meta = ROLE_META[dr.role] || ROLE_META.employee;
            return (
              <div key={u.user_id} className={`flex flex-col lg:flex-row lg:items-center gap-3 p-3 ${u.banned ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3 min-w-0 lg:w-64">
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: `${meta.color}14`, color: meta.color }}>
                    <UserCog size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-zinc-800 truncate">
                      {u.full_name || u.email}
                      {u.banned && <span className="ml-2 mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded align-middle" style={{ color: NEG, background: tint(NEG, 7) }}>Inactive</span>}
                    </p>
                    <p className="mono text-[10px] text-zinc-400 mt-0.5 truncate">{u.phone || u.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <select value={dr.role} onChange={e => setDraft(u.user_id, { role: e.target.value })}
                    aria-label={`Role for ${u.email}`} className={teamInput}>
                    {ROLE_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input type="text" value={dr.full_name} onChange={e => setDraft(u.user_id, { full_name: e.target.value })}
                    placeholder="name" aria-label="Name" className={`${teamInput} w-32`} />
                  <DeptCombo value={dr.department} onChange={v => setDraft(u.user_id, { department: v })}
                    options={departments} placeholder="dept" className="w-28" />
                  {/* Required for every role — admin_set_role now raises if it is
                      blank rather than silently nulling it, which is what used to
                      strip an admin's phone (and their bot access) on every edit. */}
                  <input type="text" value={dr.phone} onChange={e => setDraft(u.user_id, { phone: e.target.value })}
                    placeholder="phone" aria-label="Phone (required)"
                    inputMode="numeric" className={`${teamInput} w-36`} />
                  <div className="flex items-center gap-1.5 ml-auto">
                    {savedId === u.user_id && <span className="mono text-[11px]" style={{ color: POS }}>Saved ✓</span>}
                    <button onClick={() => save(u)} disabled={!dirty || saving === u.user_id}
                      className="text-[12px] font-semibold px-3.5 py-1.5 rounded-md text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {saving === u.user_id ? 'Saving…' : 'Save'}
                    </button>
                    {u.user_id !== myId && (confirmDel === u.user_id ? (
                      <span className="flex items-center gap-1">
                        <button onClick={() => manage(u.user_id, 'delete')} disabled={acting === u.user_id}
                          className="text-[11px] font-semibold px-2 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: 'var(--neg-solid)' }}>
                          {acting === u.user_id ? '…' : 'Delete'}
                        </button>
                        <button onClick={() => setConfirmDel(null)}
                          className="text-[11px] px-2 py-1.5 rounded-md border border-zinc-300 text-zinc-600">Cancel</button>
                      </span>
                    ) : (
                      <>
                        <button onClick={() => manage(u.user_id, u.banned ? 'activate' : 'deactivate')} disabled={acting === u.user_id}
                          title={u.banned ? 'Reactivate login' : 'Deactivate (block login)'}
                          className="w-8 h-8 flex items-center justify-center rounded-md border border-zinc-300 text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 transition-colors disabled:opacity-40">
                          <Power size={14} style={u.banned ? { color: POS } : undefined} />
                        </button>
                        <button onClick={() => setConfirmDel(u.user_id)} title="Delete login"
                          className="w-8 h-8 flex items-center justify-center rounded-md border border-zinc-300 text-zinc-500 hover:border-red-500 hover:text-red-600 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <p className="text-[12px] text-zinc-400">
        Tip: a login with no role assigned defaults to <b>Employee</b> with no data — the safe default.
      </p>
    </motion.div>
  );
}

// ── Change-password modal (available to everyone after login) ─────────────────
function ChangePasswordModal({ open, onClose }) {
  const [cur, setCur] = useState('');
  const [pw, setPw]   = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState(false);
  const [showCur, setShowCur] = useState(false);
  const [showPw, setShowPw]   = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCur(''); setPw(''); setPw2(''); setErr(''); setDone(false); setBusy(false);
    setShowCur(false); setShowPw(false); setShowPw2(false);
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const submit = async () => {
    if (!cur)          { setErr('Enter your current password.'); return; }
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return; }
    if (pw !== pw2)    { setErr('Passwords don’t match.'); return; }
    if (pw === cur)    { setErr('New password must be different from the current one.'); return; }
    setBusy(true); setErr('');
    try { await changePasswordSecure(cur, pw); setDone(true); setTimeout(onClose, 1400); }
    catch (e) { setErr(e.message || 'Failed to update'); }
    setBusy(false);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-zinc-400" />
                <h2 className="text-[15px] font-semibold text-zinc-900">Change password</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><X size={15} /></button>
            </div>
            <div className="p-5 space-y-3">
              {done ? (
                <p className="text-[14px]" style={{ color: POS }}>✓ Password updated.</p>
              ) : (
                <>
                  <div className="relative">
                    <input type={showCur ? 'text' : 'password'} value={cur} onChange={e => setCur(e.target.value)} placeholder="Current password" autoFocus autoComplete="current-password" className={`${teamInput} w-full pr-11`} />
                    <button type="button" onClick={() => setShowCur(s => !s)} tabIndex={-1}
                      aria-label={showCur ? 'Hide password' : 'Show password'} aria-pressed={showCur}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                      {showCur ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" className={`${teamInput} w-full pr-11`} />
                    <button type="button" onClick={() => setShowPw(s => !s)} tabIndex={-1}
                      aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <div className="relative">
                    <input type={showPw2 ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password"
                      onKeyDown={e => { if (e.key === 'Enter') submit(); }} className={`${teamInput} w-full pr-11`} />
                    <button type="button" onClick={() => setShowPw2(s => !s)} tabIndex={-1}
                      aria-label={showPw2 ? 'Hide password' : 'Show password'} aria-pressed={showPw2}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                      {showPw2 ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {err && <p className="text-[12px]" style={{ color: NEG }}>{err}</p>}
                  <button onClick={submit} disabled={busy}
                    className="w-full text-[13px] font-semibold px-4 py-2 rounded-md text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-50">
                    {busy ? 'Updating…' : 'Update password'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Nav Config ────────────────────────────────────────────────────────────────
// Sales-analytics tabs (the original dashboard). Shown to admin + accountant.
const SALES_NAV = [
  {id:'overview',      label:'Overview',      icon:LayoutDashboard},
  {id:'conversations', label:'Conversations', icon:MessageSquare},
  {id:'users',         label:'Reps',          icon:Users},
  {id:'cache',         label:'Cache',         icon:Database},
  {id:'chat',          label:'Chat',          icon:Bot, sub:'Test Hi Tech AI live'},
];
const EXPENSES_NAV = {id:'expenses', label:'Expenses', icon:Receipt, sub:'Employee receipts & spend'};
const TEAM_NAV = {id:'team', label:'Team', icon:Shield, sub:'Manage logins & roles'};
const ALL_NAV = [...SALES_NAV, EXPENSES_NAV, TEAM_NAV];   // superset, for hash/history validation

// Which tabs a role may see:
//   employee            → Chat + their own expenses ("My Expenses")
//   accountant          → only the all-employee Expenses tab
//   admin               → every sales tab + all-employee Expenses + Team panel
//   unknown (loading)   → sales tabs only, until the profile resolves
function navForRole(role) {
  const myExpenses = {...EXPENSES_NAV, label:'My Expenses', sub:'Your receipts & spend'};
  const chat = SALES_NAV.find(n => n.id === 'chat');
  if (role === 'employee')   return [myExpenses, chat];
  if (role === 'accountant') return [EXPENSES_NAV];
  if (role === 'admin')      return [...SALES_NAV, EXPENSES_NAV, TEAM_NAV];
  return SALES_NAV;
}

// Role display (shown in the header for everyone).
const ROLE_META = {
  admin:      { label:'Admin',      color:BLUE },
  accountant: { label:'Accountant', color:POS },
  employee:   { label:'Employee',   color:'var(--muted)' },
};

// ── Root Component ────────────────────────────────────────────────────────────
export default function Dashboard({ onLogout }) {
  const [tab, setTab] = useState(() => {
    const hash = window.location.hash.slice(1);
    return ALL_NAV.some(n => n.id === hash) ? hash : 'overview';
  });
  // Guarded here rather than at each call site: the mobile nav called this
  // without checking whether you were already on the tab, so re-tapping the
  // current one pushed a duplicate entry and the phone's Back button popped
  // straight back to the same tab — looking like Back was broken.
  const goTab = useCallback(id => {
    setTab(prev => {
      if (prev === id) return prev;
      history.pushState(null, '', `#${id}`);
      return id;
    });
  }, []);
  const [searchFocus, setSearchFocus] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen,  setNavOpen]  = useState(false);
  const [pwOpen,   setPwOpen]   = useState(false);
  const [drill, setDrill] = useState(null);

  // Clear this user's chat thread from localStorage before signing out so
  // the next person on the same machine can't see it in devtools.
  const handleLogout = useCallback(() => {
    const key       = sessionKey(currentUserName() || 'anon');
    const sessionId = localStorage.getItem(key);
    if (sessionId) localStorage.removeItem(threadKey(sessionId));
    localStorage.removeItem(key);
    onLogout?.();
  }, [onLogout]);

  const {stats,loading,demo,refreshing,refresh,channelFilter,setChannelFilter} = useData(handleLogout);

  // Theme toggle (auto -> light -> dark -> auto), header-mounted so it's reachable
  // from every tab. See src/theme.js for the mechanism.
  const { mode: themeMode, cycle: cycleTheme } = useTheme();
  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : SunMoon;
  const themeNext  = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
  const themeLabel = themeMode === 'auto'
    ? `Theme: auto (follows your device). Click to switch to ${themeNext}.`
    : `Theme: ${themeMode}. Click to switch to ${themeNext}.`;

  // Role → which tabs are visible. Employees only ever see "My Expenses".
  const profile = useProfile(handleLogout);
  const role    = profile?.role;
  const nav     = useMemo(() => navForRole(role), [role]);
  // Identity shown in the top-left: employee's roster name if we have it, else the
  // login name (email local-part).
  const displayName = profile?.full_name || currentUserName() || 'User';
  const initials = (displayName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase()) || 'U';
  // Where the logo goes. Overview for anyone who has it; an employee doesn't, so
  // send them to their first real tab rather than to a tab the next effect would
  // immediately bounce them off.
  const homeTab = useMemo(
    () => (nav.some(n => n.id === 'overview') ? 'overview' : (nav[0]?.id || 'overview')),
    [nav]);

  // If the current tab isn't allowed for this role (e.g. role resolved to
  // 'employee' but the URL hash was #overview), fall back to the first allowed.
  // replaceState, not pushState: this is a correction, and giving it a history
  // entry would mean Back lands on the tab they were just bounced off.
  useEffect(() => {
    if (nav.some(n => n.id === tab)) return;
    history.replaceState(null, '', `#${nav[0].id}`);
    setTab(nav[0].id);
  }, [nav, tab]);

  // Toast notifications
  const [toast, setToast]    = useState(null);
  const toastTimer            = useRef(null);
  const pushToast = useCallback(({ state, msg }) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), state, msg });
    if (state === 'done') {
      toastTimer.current = setTimeout(() => setToast(null), 2500);
    }
  }, []);

  // Show "Data refreshed" toast when a refresh completes.
  const prevRefreshing = useRef(false);
  useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      pushToast({ state: 'done', msg: 'Data refreshed' });
    }
    prevRefreshing.current = refreshing;
  }, [refreshing, pushToast]);

  // Drill-through: jump to Conversations with a topic (answer) or rep pre-filter.
  const goDrill    = useCallback(d => { goTab('conversations'); setDrill(d); }, [goTab]);
  const clearDrill = useCallback(() => setDrill(null), []);

  // Keyboard accelerators: number keys switch tabs, "/" jumps to Conversations search.
  useEffect(()=>{
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
      if (e.key==='Escape') { setNavOpen(false); return; }
      if (e.key>='1' && e.key<=String(nav.length)) { goTab(nav[+e.key-1].id); setNavOpen(false); }
      else if (e.key==='/') { e.preventDefault(); if (nav.some(n=>n.id==='conversations')) { goTab('conversations'); setSearchFocus(n=>n+1); } setNavOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[goTab, nav]);

  // Publish the sticky header's height as --app-header-h. The enlarged chat is
  // position:fixed and must start exactly below the nav — hardcoding a number
  // would break the moment the header wraps, which it does between breakpoints
  // and when a long name pushes the identity block onto a second line.
  const headerRef = useRef(null);
  // Layout effect, not effect: this has to land BEFORE the first paint, or the
  // enlarged chat renders one frame at the fallback height and visibly jumps.
  useLayoutEffect(()=>{
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--app-header-h', el.offsetHeight + 'px');
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  // Sync tab from browser back/forward.
  useEffect(()=>{
    const onPop = () => {
      const hash = window.location.hash.slice(1);
      setTab(ALL_NAV.some(n => n.id === hash) ? hash : 'overview');
      // Back while the mobile drawer is open would otherwise switch the tab
      // behind it and leave the picker sitting there over the new page.
      setNavOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return ()=>window.removeEventListener('popstate', onPop);
  },[]);

  // Idle auto-logout — sign out after 30 min of no interaction, so a session left
  // open on a shared/kiosk machine doesn't stay readable.
  useEffect(()=>{
    if (!onLogout) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(handleLogout, 30*60*1000); };
    const evts = ['mousemove','keydown','click','scroll','touchstart'];
    evts.forEach(e=>window.addEventListener(e, reset, {passive:true}));
    reset();
    return ()=>{ clearTimeout(timer); evts.forEach(e=>window.removeEventListener(e, reset)); };
  },[onLogout]);

  return (
    <MotionConfig reducedMotion="user">
    <ToastContext.Provider value={{ toast, pushToast }}>
    <HelpContext.Provider value={helpOpen}>
    <div className="relative min-h-screen text-zinc-900">

      {/* Clean slate surface — cards float via shadow, no grid texture */}
      <div className="fixed inset-0 -z-10 bg-paper pointer-events-none" aria-hidden="true"/>

      {/* ── Top navigation ── */}
      <header ref={headerRef} className="sticky top-0 z-20 bg-paper border-b border-slate-200">
        {/* signal strip */}
        <div className="h-[3px] w-full" style={{background:BLUE}}/>
        {/* Tighter gutters/gaps on phones: at px-6 + gap-5 the mobile tab-picker was left
            with 14px for its label, so it truncated to nothing and the chevron drifted away
            from the icon with an empty gap between them. */}
        <div className="w-full px-4 sm:px-6 lg:px-8 h-20 flex items-center gap-3 sm:gap-5">

          {/* Wordmark — doubles as the way home, the way a site logo always has.
              The whole lockup is the target, not just the mark, so it stays an
              easy tap on a phone where the text is hidden. */}
          <button type="button"
            onClick={()=>{ goTab(homeTab); setNavOpen(false); }}
            aria-label={`Hi Tech Sales Intelligence — go to ${ALL_NAV.find(n=>n.id===homeTab)?.label || 'Overview'}`}
            className="flex items-center gap-2.5 shrink-0 -m-1 p-1 rounded-lg transition-opacity hover:opacity-80 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <img src="/logo-icon.png" alt="" width="256" height="256" className="h-11 w-auto"/>
            <div className="leading-none hidden md:block text-left">
              <p className="text-[16px] font-bold tracking-tight" style={{color:BLUE}}>Hi Tech</p>
              <p className="text-[12px] text-zinc-400 mt-0.5">Sales Intelligence</p>
            </div>
          </button>

          {/* Identity — who's signed in + their role (left corner, out of the tabs' way) */}
          {role && ROLE_META[role] && (
            <div className="hidden lg:flex items-center gap-2.5 shrink-0 pl-5 border-l border-zinc-200">
              <span className="flex items-center justify-center w-9 h-9 rounded-full text-[12px] font-bold shrink-0" style={{background:`${ROLE_META[role].color}1a`, color:ROLE_META[role].color}}>
                {initials}
              </span>
              <div className="leading-tight">
                <p className="text-[13px] font-semibold text-zinc-800 truncate max-w-[130px]">{displayName}</p>
                <p className="mono text-[9px] uppercase tracking-[0.14em] mt-0.5" style={{color:ROLE_META[role].color}}>{ROLE_META[role].label}</p>
              </div>
            </div>
          )}

          {/* Mobile nav picker — visible below lg, replaced by full strip above */}
          {(()=>{ const cur = nav.find(n=>n.id===tab)||nav[0]; return (
            <div className="flex-1 min-w-0 lg:hidden flex items-center overflow-hidden">
              <button onClick={()=>setNavOpen(o=>!o)}
                aria-haspopup="listbox" aria-expanded={navOpen}
                className="flex items-center gap-2 min-w-0 max-w-full px-3 py-2 rounded-lg border border-zinc-200 bg-surface text-[14px] font-medium text-zinc-800 hover:border-zinc-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {/* No icon on phones. There isn't room for icon + label + chevron on a narrow
                    screen, and when it's tight the label is what loses — it truncates to
                    nothing and you're left with an icon and a chevron and no idea which tab
                    you're on. The label always wins; the icon returns at sm. */}
                <cur.icon size={15} className="shrink-0 hidden sm:block" style={{color:ACCENT}}/>
                <span className="truncate">{cur.label}</span>
                <ChevronDown size={13} className={`shrink-0 text-zinc-400 transition-transform duration-200${navOpen?' rotate-180':''}`}/>
              </button>
            </div>
          ); })()}

          {/* Tab strip (lg+) — scrolls (scrollbar hidden) if more tabs than fit,
              so admin's extra Expenses/Team tabs are never clipped. */}
          <nav className="hidden lg:flex items-stretch h-20 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {nav.map((n,idx)=>{
              const active = tab===n.id;
              return (
                <button key={n.id}
                  onClick={()=>{ if(!active) goTab(n.id); }}
                  aria-current={active ? 'page' : undefined}
                  title={`${n.label} · press ${idx+1}`}
                  className={`relative flex items-center gap-1.5 px-3 shrink-0 whitespace-nowrap text-[14px] transition-colors outline-none focus-visible:bg-zinc-900/5
                    ${active ? 'text-zinc-900 font-semibold' : 'text-zinc-500 hover:text-zinc-900 font-medium'}`}
                >
                  <n.icon size={15} className="shrink-0" style={active ? {color:ACCENT} : undefined}/>
                  <span>{n.label}</span>
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
              className={`hidden lg:flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${helpOpen ? 'bg-zinc-900 text-on-ink border-zinc-900' : 'bg-surface text-zinc-700 border-zinc-300 hover:border-zinc-900 hover:text-zinc-900'}`}
            >
              <HelpCircle size={15}/>
            </button>
            <div aria-live="polite" className="flex items-center gap-3 empty:hidden">
              {demo && (
                <span className="mono text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded"
                  style={{color:ACCENT_DK, background:tint(ACCENT,8), border:`1px solid ${tint(ACCENT,25)}`}}>
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
              title="Refresh data"
              /* Icon-only and square, matching the help and theme buttons either side
                 of it. The 44px box stays: it is the touch target, not the visual
                 size — the button reads small because the label and the extra
                 horizontal padding are gone, not because it was shrunk below what a
                 thumb can hit. */
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-zinc-900 text-on-ink transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <motion.div
                animate={refreshing ? {rotate:360} : {}}
                transition={{duration:0.7,repeat:refreshing?Infinity:0,ease:'linear'}}
              >
                <RefreshCw size={15}/>
              </motion.div>
            </motion.button>
            <button
              onClick={cycleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border bg-surface text-zinc-700 border-zinc-300 transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ThemeIcon size={15}/>
            </button>
            {/* Change password moves to the mobile nav dropdown below lg — see the width
                math in the commit that adds this button: a 4th 44px icon + gap doesn't fit
                the phone header without either crushing the tab-picker's label budget again
                (the exact bug db5b013 fixed) or dropping a button. Change-password is the
                least-frequent of the four actions, so it's the one that moves; it's still one
                tap away via the tab picker → "Change password" row, and unchanged on desktop. */}
            <button
              onClick={()=>setPwOpen(true)}
              aria-label="Change password"
              title="Change password"
              className="hidden lg:flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border bg-surface text-zinc-700 border-zinc-300 transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <KeyRound size={15}/>
            </button>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border bg-surface text-zinc-700 border-zinc-300 transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <LogOut size={15}/>
            </button>
          </div>
        </div>
      </header>

      {/* ── Page ──
          The body renders 25% larger than the header on desktop — see .app-scale
          in index.css for why that lives here instead of in the browser's own zoom
          (short version: browser zoom enlarges the nav too, and the nav is the one
          strip with no room to spare).

          Chat is the one tab that opts out. Its enlarged panel is position:fixed
          and sized from --app-header-h and 100dvh, all real viewport pixels that a
          zoomed context would rescale — and on a chat surface a bigger message box
          is worth more than bigger text. Scaling the whole <main> rather than an
          inner wrapper is deliberate: the max-w-7xl container has to grow with the
          content, or everything just gets more cramped inside a box the same size.

          The extra top padding rides the SAME breakpoint as the scale (xl is
          1280px, exactly where --app-scale becomes 1.25) because it exists to pay
          for it. The gap between the header rule and the page title held its ratio
          when the body grew — but the header did NOT grow, so a 25%-larger title
          now crowds a nav bar that stayed put, and the old gap reads as cramped.
          It only needs the correction where the scale is live. */}
      <main className={`relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-8 xl:pt-12 pb-8${tab === 'chat' ? '' : ' app-scale'}`}>

        {/* Backend unreachable — sample data is showing. Make it unmistakable. */}
        {demo && (
          <div role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
            style={{borderColor:tint(ACCENT,40), background:tint(ACCENT,6)}}>
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle size={16} style={{color:ACCENT_DK}} className="shrink-0"/>
              <p className="text-[14px] text-zinc-800 leading-snug">
                <span className="font-semibold">Couldn't reach the database.</span>
                <span className="text-zinc-600"> Showing sample data — the figures below are not live.</span>
              </p>
            </div>
            <button onClick={refresh} disabled={refreshing}
              className="shrink-0 text-[12px] font-semibold px-3 py-2 rounded text-on-ink bg-zinc-900 hover:bg-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
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
              {nav.find(n=>n.id===tab)?.label}
            </h1>
            <p className="text-[14px] text-zinc-500 mt-2">
              {nav.find(n=>n.id===tab)?.sub || 'WhatsApp Sales Analytics'}
            </p>
          </div>
          {/* Channel filter — the analytics source combines WhatsApp + website chat. */}
          {role==='admin' && ['overview','conversations','users'].includes(tab) && (
            <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 border border-zinc-200 shrink-0" role="group" aria-label="Filter by channel">
              {[['all','All'],['whatsapp','WhatsApp'],['web','Website']].map(([v,label])=>(
                <button key={v} type="button" onClick={()=>setChannelFilter(v)}
                  aria-pressed={channelFilter===v}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${channelFilter===v?'bg-surface text-zinc-900 shadow-sm':'text-zinc-500 hover:text-zinc-800'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
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
              {tab==='conversations' && <ConversationsTab s={stats} channelFilter={channelFilter} focusSignal={searchFocus} drill={drill} onDrillConsumed={clearDrill} onAuthError={handleLogout}/>}
              {tab==='users'         && <UsersTab         s={stats} onDrill={goDrill}/>}
              {tab==='cache'         && <CacheTab         s={stats}/>}
              {tab==='expenses'      && <ExpensesTab      role={role} onAuthError={handleLogout}/>}
              {tab==='team'          && <TeamTab          role={role} onAuthError={handleLogout}/>}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Chat stays MOUNTED across tab switches (just hidden) so an in-progress
            receipt upload — its image preview and pending Confirm — isn't destroyed
            when the user pops over to another tab. Only mounted for roles that have it. */}
        {nav.some(n => n.id === 'chat') && (
          <div className={tab === 'chat' ? '' : 'hidden'} aria-hidden={tab !== 'chat'}>
            {/* The entrance lives inside ChatTab, driven by this flag rather than by
                mount — the component deliberately never unmounts. Animating here
                instead would be the wrong place twice over: it would fade a wrapper
                whose contents still arrive in one frame, and the moment it reached
                for `y` it would become the containing block for the enlarged panel,
                which is position:fixed. */}
            <ChatTab active={tab === 'chat'}/>
          </div>
        )}
      </main>
      {/* Mobile nav dropdown — AnimatePresence must live INSIDE the portal, not around it */}
      {createPortal(
        <AnimatePresence>
          {navOpen && (
            <>
              <div className="fixed inset-0 z-[98]" onClick={()=>setNavOpen(false)} aria-hidden="true"/>
              <motion.div
                initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
                transition={{duration:0.15,ease:[0.22,1,0.36,1]}}
                className="fixed left-0 right-0 z-[99] bg-surface border-b border-zinc-200 shadow-[0_8px_24px_-4px_rgba(30,41,59,0.12)]"
                style={{top:'83px'}}
              >
                {nav.map(n=>{
                  const active = tab===n.id;
                  return (
                    <button key={n.id} role="option" aria-selected={active}
                      onClick={()=>{ goTab(n.id); setNavOpen(false); }}
                      className={`flex items-center gap-3 w-full px-6 py-4 text-[15px] transition-colors border-b border-zinc-100 last:border-b-0 outline-none focus-visible:bg-zinc-50 ${active?'bg-zinc-50':'hover:bg-zinc-50'}`}
                    >
                      <n.icon size={16} style={{color:active?ACCENT:'var(--muted)'}}/>
                      <span className={active?'font-semibold':'font-medium'} style={{color:active?INK:'var(--color-zinc-600)'}}>{n.label}</span>
                      {active && <span className="ml-auto w-2 h-2 rounded-full" style={{background:ACCENT}}/>}
                    </button>
                  );
                })}
                {/* Change password lives only here on phones — its header icon is lg-only
                    (see the width-budget comment by that button) so this is its one mobile home. */}
                <button
                  onClick={()=>{ setPwOpen(true); setNavOpen(false); }}
                  className="flex items-center gap-3 w-full px-6 py-4 text-[15px] font-medium text-zinc-700 transition-colors border-b border-zinc-100 last:border-b-0 outline-none hover:bg-zinc-50 focus-visible:bg-zinc-50"
                >
                  <KeyRound size={16} style={{color:'var(--muted)'}}/>
                  <span>Change password</span>
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
    <ChangePasswordModal open={pwOpen} onClose={()=>setPwOpen(false)}/>
    <ToastPortal/>
    </HelpContext.Provider>
    </ToastContext.Provider>
    </MotionConfig>
  );
}
