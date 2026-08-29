// Tailwind v4 (@import "tailwindcss" in index.css)
// Fonts (loaded in index.html): Archivo (grotesque, UI/display) + Spline Sans Mono (figures)
// Identity: "The Control Room" — a precision operations console for industrial sales.
// Ink + one hot signal-orange accent, concrete-paper blueprint grid, hairline panels.

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useContext, createContext, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, MotionConfig } from 'framer-motion';
import {
  LayoutDashboard, MessageSquare, Users,
  RefreshCw, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, AlertTriangle, Download, HelpCircle, X, ArrowRight, LogOut, Maximize2, Minimize2, Phone, CheckCircle2, Info, Bot, Send, Receipt, ExternalLink, ImageOff, Shield, UserCog, KeyRound, Power, Trash2, Eye, EyeOff, Mic, Square, Play, Pause, Sun, Moon, SunMoon, ThumbsDown, Copy, Check, Printer, FileText, MoreHorizontal, GitCompare, Gauge, Boxes, BookOpen,
} from 'lucide-react';
import { getAccessToken, changePasswordSecure } from './auth';
import { SB_URL, SB_KEY, MSG_SOURCE, N8N_CHAT_WEBHOOK, WEB_CHAT_SOURCE, N8N_RECEIPT_WEBHOOK } from './config';
import { CATS, catColor, fmtPKR } from './categories';
import { validateImage, compressImage, imageFromClipboard, extractReceipt, saveReceipt, signedReceiptUrl, signedReceiptUrls, receiptDownloadUrl, deleteReceiptImage } from './receipts';
import { exportCSV, buildCSV, saveBlob, safeName, zipStore } from './export';
import { exportXLSX } from './xlsx';
import { snapshotChartsForPrint } from './chart-export';
import { MAX_MS, LIVE_METER_MS, LIVE_METER_BARS, WAVEFORM_RES, BAR_PITCH, isRecordingSupported, createRecorder, blobToWav16k, blobToBase64, isProbablySilent, computeWaveform } from './voice';
import { REASONS, REASON_LABEL, submitFeedback } from './feedback';
import { CAPS, capsFor, ROLE_CHOICES } from './caps';
import { addRemark, setFlag, submitForApproval, approve, revokeApproval, reject, recheckLimit, STATUS_META, EVENT_VERB } from './expenses-actions';
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
const RepActivityTrend = lazy(() => import('./charts').then(m=>({default:m.RepActivityTrend})));
const ExpenseCharts = lazy(() => import('./charts').then(m=>({default:m.ExpenseCharts})));
const ApprovalTurnaround = lazy(() => import('./charts').then(m=>({default:m.ApprovalTurnaround})));
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

// NOTE: csvCell()/exportCSV() moved to src/export.js when the receipt download
// arrived and needed the same quoting and formula-injection guard.
//
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

// ── Sheet builders for the "Excel" export ────────────────────────────────────
// One sheet per chart, mirroring exactly what is on screen — the point of the
// export is "send me that report", so a number in the file and the same number
// on the panel must never disagree.
//
// The {label, get(row)} column shape is deliberately identical to exportCSV's,
// so both writers share one mental model and xlsx.js's cellXML applies the same
// formula-injection guard (guardFormula) that csvCell does. A vendor name is
// OCR'd off a photo someone chose, so it is attacker-typed text in the most
// literal sense — a formula can be written on a paper receipt.
function buildOverviewSheets(s, periodMetrics) {
  // The rep-activity chart is one line per rep, so the sheet is one COLUMN per
  // rep. Names are collected across every day because a rep who sent nothing on
  // day one still needs a column, or their later days shift into someone else's.
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
        // ?? 0, not ||: a rep with genuinely zero messages that day must read 0
        // rather than blank, or the column silently looks like missing data.
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
      // Flattened to label/count rows rather than one wide row, so the sheet
      // reads top-to-bottom like the panel does. The flagged line is a
      // percentage of the whole, not a fifth status — hence the parenthetical.
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

// NOTE: this used to be computeGaps(), which flagged questions whose reply ran
// under 20 chars. It was dead code in practice — the agent's NO RESULTS RULE
// makes it answer "I couldn't find [model] in our catalog…" (~90 chars), so
// measured over 128 turns it matched exactly 0. And the failure that actually
// hurts is a long, confident, WRONG answer, which no length test can catch.
// The signal now comes from the reps instead: see chat_feedback / db/chat-feedback.sql.


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
    Timestamp:new Date(now-i*1800000).toISOString(),
  }));
  const topQ = qs.map((text,i)=>({text,count:Math.round(18-i*1.8),answer:ansFor(text)})).sort((a,b)=>b.count-a.count);
  // Synthetic heat weighted toward weekday business hours.
  const heat = Array.from({length:7},(_,d)=>Array.from({length:24},(_,h)=>{
    const business = h>=9 && h<=18 ? 1 : 0.12;
    const weekday  = d>=1 && d<=5 ? 1 : 0.35;
    return Math.round(Math.random()*15*business*weekday);
  }));
  // Daily series for the range-selectable volume chart (30 days).
  const volumeDaily = Array.from({length:30},(_,i)=>{
    const d=new Date(now); d.setDate(d.getDate()-(29-i)); const k=localKey(d);
    return {date:k, label:labelFromKey(k), count:Math.round(8+Math.random()*22+(i>22?12:0))};
  });
  const badResponses = [
    {id:'d1', reason:'wrong_machine', user_message:'compare dt 100 and dd 250', ai_response:'DT D100 vs SCR250H-7…', note:'gave me an air compressor', user_name:'ahsan',  created_at:new Date(now-3600000*2).toISOString()},
    {id:'d2', reason:'missing_specs', user_message:'screw diameter for d170db',  ai_response:'The D170Db is a double-color…', note:'', user_name:'bilal', created_at:new Date(now-3600000*9).toISOString()},
    {id:'d3', reason:'misunderstood', user_message:'chhota wala machine dikhao', ai_response:"I couldn't find…", note:'', user_name:'ahsan',  created_at:new Date(now-3600000*26).toISOString()},
  ];
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
  // Active reps in a window are a subset of all-time reps, same invariant the
  // real RPC enforces (db/dashboard-stats.sql) — must stay <= users.length.
  return {totalMsgs:1247,todayCount:31,ystCount:24,userCount:users.length,msgsByDay,users,topQ,maxQ:topQ[0].count,recent,heat,volumeDaily,badResponses,topRepsDaily,activeRepsLast30:4,activeRepsPrev30:3};
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
  if (!r.ok) {
    // Never render the error body verbatim. An edge function can hand back an
    // error that carries no message at all -- an empty object, or one that
    // supabase-js already JSON-stringified into the literal string "{}" -- and
    // showing that is how "delete user" failed with a bare {} and no clue why.
    const e = d?.error;
    const m = (typeof e === 'string' ? e : (e?.message || e?.msg || '')).trim();
    throw new Error(m && m !== '{}' && m !== '[object Object]'
      ? m
      : `${name} failed (HTTP ${r.status})`);
  }
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
      const [agg,m,fb] = await Promise.all([
        sbRpc(token, 'dashboard_stats', chanArg),
        sbFetch(token, MSG_SOURCE,`select=Timestamp,Name,User_Message,AI_Response,channel,ident,person_phone&order=Timestamp.desc&limit=20${channelFilter!=='all'?`&channel=eq.${channelFilter}`:''}`),
        sbFetch(token, 'chat_feedback','select=id,created_at,reason,note,user_message,ai_response,user_name&order=created_at.desc&limit=100'),
      ]);
      const msgs=m.data;
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
      const totalMsgs = agg?.total_msgs ?? 0;
      const withLabels = (arr) => (arr||[]).map(d => ({...d, label: labelFromKey(d.date)}));
      setStats({
        totalMsgs, todayCount: agg?.today_count ?? 0, ystCount: agg?.yst_count ?? 0,
        userCount: agg?.user_count ?? 0,
        msgsByDay: agg?.msgs_by_day || [],
        users, topQ, maxQ:topQ[0]?.count||1, recent:msgs,
        heat: agg?.heat || null,
        volumeDaily: withLabels(agg?.volume_daily),
        badResponses: fb.data,
        topRepsDaily: withLabels(agg?.top_reps_daily),
        activeRepsLast30: agg?.active_reps_last30 ?? 0,
        activeRepsPrev30: agg?.active_reps_prev30 ?? 0,
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
// v2 (2026-07-30): the 'admin' / 'accountant' spellings no longer exist. Every
// signed-in user had one of them cached here, and a stale value would resolve
// through capsFor() to the fail-closed 'employee' nav until the background
// refetch landed — a dev briefly losing Team and Expenses on first load. A new
// key misses once and reads fresh instead.
const ROLE_LS = 'ht_role_v2';
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
// print-block keeps a panel and its chart together on one printed page. It lives
// on the primitive rather than on each panel so nothing new has to remember it.
//
// `as` picks the underlying element — 'div' by default, 'button' for a card that
// is itself the click target (e.g. a rep card). A clickable card used to be a
// <motion.div role="button"> everywhere, which works for a mouse but is exactly
// the anti-pattern a real <button> exists to avoid; motion.button gets the same
// whileHover/variants machinery for free.
const Panel = ({children, className='', hover=false, as='div', ...rest}) => {
  const MotionTag = motion[as] || motion.div;
  return (
    <MotionTag
      variants={fadeUp}
      whileHover={hover ? {
        boxShadow:'0 4px 24px -4px rgba(30,41,59,0.16)',
        transition:{duration:0.15}
      } : undefined}
      className={`print-block bg-surface border border-zinc-100 rounded-xl shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)] ${className}`}
      {...rest}
    >
      {children}
    </MotionTag>
  );
};

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

// Percentage delta for period-over-period comparisons (vs `Delta` above, which
// shows an absolute count difference like "today vs yesterday"). previous=0
// has no meaningful % change, so it reads "new" instead of dividing by zero.
const PctDelta = ({current, previous}) => {
  if (current == null || previous == null) return null;
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

// Percentage-POINT delta — for rate metrics, where a relative % change of a
// percentage reads as confusing next to the value itself. `current`/`previous`
// are 0-1 fractions. Currently unused: the cache hit rate was its only caller,
// and it is kept for the next rate metric rather than reinvented.
const PpDelta = ({current, previous}) => {
  if (current == null || previous == null) return null;
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
              {m.format ? m.format(m.current) : (m.current ?? 0).toLocaleString()}
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

// Status distribution — a single proportional bar
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

// Export a whole tab's charts — PDF via the browser's print dialog, Excel via
// a sheet-per-chart .xlsx. One control, both formats: a report reader wants
// "send me the report," not five separate downloads (design spec, 2026-07-30).
//
// PDF is window.print() rather than a bundled PDF library. The print stylesheet
// in index.css already hides the nav and every expand icon, so the browser's own
// Save-as-PDF produces the panels a reader wants — at zero bytes of dependency
// on a page that renders financial records.
//
// buildSheets is a FUNCTION, not an array: it runs on click, so the workbook is
// built from what is on screen at that moment rather than being recomputed on
// every render of a tab nobody is exporting.
const ExportTabButton = ({ buildSheets, exportName }) => {
  const ctx = useContext(ToastContext);
  const [busy, setBusy] = useState(false);
  // Swap every chart's live SVG for a pre-rendered snapshot before printing —
  // see snapshotChartsForPrint() in chart-export.js for why: window.print()
  // races Recharts' resize-driven re-render, and charts can print blank.
  const handlePdf = async () => {
    const restore = await snapshotChartsForPrint();
    const cleanup = () => { restore(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };
  const handleXlsx = async () => {
    setBusy(true);
    ctx?.pushToast({ state: 'preparing', msg: 'Preparing Excel export…' });
    try {
      await exportXLSX(exportName, buildSheets());
      ctx?.pushToast({ state: 'done', msg: 'Export complete!' });
    } catch (e) {
      // A failed export must not leave the toast stuck on "Preparing…" for ever,
      // which reads as a hung download rather than a failure.
      ctx?.pushToast({ state: 'done', msg: e?.message || 'Could not build the Excel file.' });
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
          className="fixed right-6 z-[300] flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-medium text-white shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35)]"
          /* Above the bottom tab bar, not on top of it. The toast outranks the bar
             on z-index (300 vs 40), so without this it would draw over the tabs
             rather than being hidden by them — which is worse: it covers the
             navigation while saying something the reader doesn't have to act on. */
          style={{background:INK, bottom:'calc(1.5rem + var(--app-navbar-h, 0px))'}}
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
      </div>
      {open && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-zinc-200 space-y-2">
          {r.note && <p className="text-[12.5px] text-zinc-700"><span className="text-zinc-400">Rep said:</span> {r.note}</p>}
          <p className="text-[12.5px] text-zinc-500 whitespace-pre-wrap break-words">{trunc(r.ai_response || '(no reply captured)', 600)}</p>
          <p className="text-[11px] text-zinc-400">{r.user_name || 'unknown'}</p>
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
  // "This 30 days vs the 30 before" — messages sum correctly across days from the
  // existing 90-day array; active reps is a true distinct count computed
  // server-side (see db/dashboard-stats.sql — summing a per-day distinct count
  // would double-count a rep active on more than one day).
  const periodMetrics = useMemo(() => {
    const vol = s.volumeDaily || [];
    const n = vol.length;
    const sumCount = (arr, from, to) => arr.slice(Math.max(0,from), Math.max(0,to)).reduce((a,b)=>a+(b.count??0),0);
    return [
      {label:'Messages', kind:'pct', current:sumCount(vol, n-30, n), previous:sumCount(vol, n-60, n-30),
        format:v=>v.toLocaleString(), hint:'Total messages, this 30 days vs the 30 before'},
      {label:'Active reps', kind:'pct', current:s.activeRepsLast30??0, previous:s.activeRepsPrev30??0,
        format:v=>v.toLocaleString(), hint:'Distinct reps who messaged Hi Tech AI, this 30 days vs the 30 before'},
    ];
  }, [s.volumeDaily, s.activeRepsLast30, s.activeRepsPrev30]);
  const ledger = [
    {label:'Today',       value:s.todayCount, delta, hint:'Messages today, compared with yesterday'},
    {label:'Active reps', value:s.userCount,         hint:'Reps who messaged Hi Tech AI in this period'},
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      <div className="flex justify-end">
        <ExportTabButton exportName="overview-report" buildSheets={() => buildOverviewSheets(s, periodMetrics)}/>
      </div>

      <HelpNote>Headline counts for the loaded period. "Today" shows the change vs yesterday.</HelpNote>

      {/* Readout cluster — one instrument panel, hero + ledger, divided by hairlines.
          Both column templates are written out in full rather than interpolated:
          Tailwind scans source text statically, so a `repeat(${n},1fr)` built at
          runtime never reaches the stylesheet and the grid silently collapses. */}
      <Panel className="grid grid-cols-1 divide-y md:divide-y-0 md:divide-x divide-zinc-200 overflow-hidden md:grid-cols-[1.6fr_repeat(2,1fr)]">
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

      <PeriodCompare sub="the previous 30 days" metrics={periodMetrics}/>

      {/* Charts row — lazy-loaded (Recharts in its own async chunk) */}
      <Suspense fallback={<ChartsFallback/>}>
        <ChartsRow
          volumeDaily={s.volumeDaily}
          topReps={s.users.slice(0,5).map(u=>({name:repName(u.number).split(' ')[0],count:u.count}))}
        />
      </Suspense>

      {/* top_reps_daily is NEVER [] for a zero-activity account — an empty
          base still yields one day with reps:null (db/dashboard-stats.sql).
          So the guard checks for actual rep data, not just array length. */}
      {s.topRepsDaily?.some(d => d.reps?.length) && (
        <Panel className="p-6">
          <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Rep activity</h2>
          <p className="text-[14px] text-zinc-500 mt-1">Top 5 reps by volume, last 30 days</p>
          <HelpNote>Daily message count for the 5 busiest reps this month — is activity concentrated in a few people or spread out?</HelpNote>
          <div className="mt-4">
            <Suspense fallback={<div className="h-56 rounded bg-zinc-50 animate-pulse"/>}>
              <RepActivityTrend data={s.topRepsDaily}/>
            </Suspense>
          </div>
        </Panel>
      )}

      {/* Bottom row.
          no-print on the whole row: Most asked and Bad responses are working
          tools — you click a topic to drill into Conversations, or a flagged
          reply to go fix a prompt. Neither survives being printed, and a PDF
          report is for the numbers, not the queue. */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-4">

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
                {/* scaleX, not width: up to 6 of these animate at once on every
                    Overview mount, and animating `width` forces a layout reflow
                    on every frame per bar — 6x that, every frame. scaleX is a
                    transform, so the GPU composites it with no reflow at all.
                    Same visual result: the track is full-width and clipped by
                    overflow-hidden, origin-left keeps the growth direction. */}
                <div className="mt-1.5 h-[3px] bg-zinc-100 overflow-hidden">
                  <motion.div
                    initial={{scaleX:0}} animate={{scaleX:q.count/s.maxQ}}
                    transition={{duration:0.7,delay:i*0.06,ease:[0.22,1,0.36,1]}}
                    className="h-full w-full origin-left" style={{background: i===0 ? ACCENT : INK}}/>
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
          keyed on short replies and, measured over 128 turns, never once fired.
          no-print: see the note on the row above. */}
      <Panel className="no-print p-6">
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
                {label:'Rep',      get:r=>r.user_name},
              ], s.badResponses)}
            />
          )}
        </div>
        <HelpNote>Answers a rep marked “Bad answer” in the Chat tab, newest first. Click a row to see what the bot actually replied.</HelpNote>
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
                className="no-print flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 mt-0.5">
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
                <motion.button
                  type="button" aria-expanded={ex}
                  onClick={()=>setExpanded(ex?null:rowKey)}
                  whileHover={{backgroundColor:'rgba(24,24,27,0.025)'}}
                  className={`w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 sm:px-6 py-3 border-b border-zinc-100 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 md:grid md:grid-cols-[1.8fr_3fr_1fr_28px] md:gap-0 md:items-center ${ex?'bg-zinc-50':''}`}
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
                </motion.button>

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
        <Panel key={u.number} hover as="button" type="button" className="w-full text-left p-5 cursor-pointer group outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={()=>onDrill({type:'rep', rep:u.number, label:repName(u.number)})}
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

// Documents the agent attached to a reply (a comparison PDF, a proposal). n8n sends
// a RELATIVE url — "/webhook/hitech-web-doc?session_id=…" — which we keep relative and
// resolve against the chat webhook's origin at fetch time, so the editor's
// /webhook-test/ path works the same as prod. Anything absolute is dropped: a
// malformed (or tampered) agent turn must not be able to point a chip off-host.
function cleanDocuments(docs) {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter(d => d && typeof d.name === 'string' && d.name.trim()
                   && typeof d.url === 'string' && d.url.startsWith('/'))
    .map(d => ({ kind: d.kind === 'proposal' ? 'proposal' : 'pdf', name: d.name.trim(), url: d.url }));
}

// Fetch a document and hand it to the browser as a download.
//
// The endpoint validates the Supabase JWT and scopes the lookup to that user_id, so
// nobody can pull someone else's statement by guessing a session id. That also means
// it can't be reached by NAVIGATION — <a download> and window.open() both 401,
// because browsers don't attach Authorization to navigations. Hence: fetch with the
// header, then save the blob.
async function downloadDocument(doc) {
  let token;
  // getAccessToken() refreshes a nearly-expired JWT, so the usual cause of a 401 is
  // handled before the request rather than reported after it.
  try { token = await getAccessToken(); }
  catch { throw new Error('Your session expired — sign in again to download this.'); }

  const res = await fetch(new URL(doc.url, N8N_CHAT_WEBHOOK).href, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error('Your session expired — sign in again to download this.');
  // Expected occasionally: the agent sets the attachment flag from conversation
  // history, and this webhook is the thing that actually checks. A wrong flag costs
  // one failed fetch, never a wrong document.
  if (res.status === 404) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* non-JSON body */ }
    throw new Error(detail || 'No document is available for this answer yet.');
  }
  if (!res.ok) throw new Error(`Couldn’t fetch the document (HTTP ${res.status}).`);

  // Prefer the filename the server put on the response: `doc.name` is built on the
  // turn the rep ASKS for the export, where the agent's own pdf_content is null (the
  // reply is a bare confirmation), so it falls back to a generic "HiTech Document".
  // The renderer knows the real title. Reading this cross-origin needs
  // `Access-Control-Expose-Headers: Content-Disposition` on the n8n response — until
  // that's set the header reads as null here and we fall back, which is the old
  // behaviour, so this is safe either way.
  saveBlob(await res.blob(), filenameFromResponse(res) || doc.name);
}

// Pull the filename out of a Content-Disposition header. Handles RFC 5987
// (`filename*=UTF-8''…`, which is what a name with spaces or an em dash arrives as)
// before the plain `filename=` form.
function filenameFromResponse(res) {
  const cd = res.headers.get('content-disposition');
  if (!cd) return '';
  const ext = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (ext) { try { return decodeURIComponent(ext[1]).trim(); } catch { /* malformed escape */ } }
  const plain = /filename="?([^";]+)"?/.exec(cd);
  return plain ? plain[1].trim() : '';
}

// Normalize n8n's webhook response → { text, images, documents }. The cloned
// workflow answers with { reply, images }, but we check the other common field
// names too so a tweak to the "Respond to Webhook" node won't break the UI.
async function parseChatReply(res) {
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* plain-text response */ }
  if (data == null) return { text: raw.trim() || '(empty response)', images: [], documents: [] };
  const obj = Array.isArray(data) ? (data[0] ?? {}) : data;
  if (typeof obj === 'string') return { text: obj, images: [], documents: [] };
  const t = obj.reply ?? obj.output ?? obj.response ?? obj.text ?? obj.message ?? obj.answer ?? obj.AI_Response ?? '';
  const imgs = obj.images ?? obj.image_urls ?? [];
  return {
    text: (typeof t === 'string' && t) ? t : JSON.stringify(obj),
    images: Array.isArray(imgs) ? imgs.filter(u => typeof u === 'string' && u.startsWith('https://')) : [],
    documents: cleanDocuments(obj.documents),
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
// breaks, because the web chat is a clone of the WhatsApp workflow and shares its
// prompt. Render *bold* via React nodes — never innerHTML.
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

const AssistantTag = ({error=false}) => (
  <span className="flex items-center gap-1.5 px-1">
    <span className="flex items-center justify-center w-4 h-4 rounded" style={{background:tint(ACCENT,10)}}>
      <Bot size={11} style={{color:ACCENT_DK}}/>
    </span>
    <span className="mono text-[10px] uppercase tracking-widest" style={{color: error ? NEG : ACCENT_DK}}>
      {error ? 'Error' : 'Hi Tech AI'}
    </span>
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
// See src/feedback.js.
function BadAnswerButton({ m, question, sessionId }) {
  const [open, setOpen]     = useState(false);
  const [reason, setReason] = useState(null);
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [err, setErr]       = useState('');

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true); setErr('');
    try {
      await submitFeedback({
        sessionId, turnTs: m.ts, userMessage: question,
        aiResponse: m.text, reason, note,
      });
      setDone(true);
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
        <span className="min-w-0">Thanks — logged for review.</span>
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

// Attachment chips under an answer — one per document the agent produced. Each
// carries its own busy/error state: on a thread with two attachments, a 404 on one
// must not blank the other. Full-width and 44px tall so it's a comfortable tap
// target on a 360px phone, with the filename truncating rather than wrapping.
function DocumentChips({ docs }) {
  const [busy, setBusy] = useState(null);   // url of the one being fetched
  const [err,  setErr]  = useState(null);   // { url, msg }

  const get = async doc => {
    if (busy) return;
    setBusy(doc.url); setErr(null);
    try { await downloadDocument(doc); }
    catch (e) { setErr({ url: doc.url, msg: e.message }); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      {docs.map(doc => (
        <div key={doc.url} className="w-full">
          <button
            type="button" onClick={() => get(doc)} disabled={!!busy}
            title={`Download ${doc.name}`}
            className="flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-xl border border-zinc-200 bg-surface text-left transition-shadow hover:shadow-[0_4px_16px_-4px_rgba(30,41,59,0.18)] disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {busy === doc.url
              ? <RefreshCw size={15} className="shrink-0 animate-spin text-zinc-500"/>
              : <FileText  size={15} className="shrink-0" style={{color:BLUE}}/>}
            <span className="flex-1 min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {doc.kind === 'proposal' ? 'Proposal' : 'PDF'}
              </span>
              <span className="block text-[13px] font-medium text-zinc-800 truncate">{doc.name}</span>
            </span>
            <Download size={14} className="shrink-0 text-zinc-400"/>
          </button>
          {err?.url === doc.url && (
            <p className="mt-1 px-1 text-[12px]" style={{color:'var(--danger-text)'}}>{err.msg}</p>
          )}
        </div>
      ))}
    </div>
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
        {!isUser && <AssistantTag error={m.error}/>}
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
        {!isUser && m.documents?.length > 0 && <DocumentChips docs={m.documents}/>}
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

// Layer 3 of the hallucination fix: nothing reaches the agent or
// web_chat_histories until a human approves the text. Sits in the composer in place
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
// Starter prompts for the chat's empty state — what a rep can actually do with
// this thing, in its own words, one tap away.
//
// EVERY brand and series named here is a real entry in rag/catalogue_manifest.json
// (Tederic NEO-T / NEO-M, Aoktac SBM, and the PET-preform + thin-wall articles the
// business-ideas namespace carries). That is the whole constraint: a starter that
// comes back "I couldn't find that in our catalog" teaches a rep the tool doesn't
// know its own products, which is the opposite of what an empty state is for. If
// the catalogue changes, these change with it.
//
// One line each, phrased as the rep would type it rather than as a feature name.
// The four are deliberately one per capability: compare, look up, recommend,
// explain — which between them are every route the agent's system prompt has.
const CHAT_STARTERS = [
  { icon: GitCompare, q: 'Compare the Tederic NEO-T and NEO-M series' },
  { icon: Gauge,      q: 'What is the clamping force range on the Tederic NEO-T?' },
  { icon: Boxes,      q: 'Which machine suits PET preform production?' },
  { icon: BookOpen,   q: 'What screw diameter suits thin-wall parts?' },
];

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
          `select=Timestamp,User_Message,AI_Response&session_id=eq.${encodeURIComponent(sessionId)}&order=Timestamp.asc&limit=200`);
        if (cancelled) return;
        setMessages(data.flatMap(r => [
          r.User_Message ? {role:'user',      text:r.User_Message, ts:r.Timestamp} : null,
          r.AI_Response  ? {role:'assistant', text:r.AI_Response, ts:r.Timestamp} : null,
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
    // An empty thread has no newest message to pin to, and scrolling anyway drags
    // the empty state's own heading off the top of the panel — which is the one
    // thing a first-time visitor needs to read. Pin only once there is something
    // to pin to.
    if (!messages.length) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, sending, reduce, expanded]);

  const grow = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);

  const send = useCallback(async (override) => {
    // The starter chips call this with their text. The send BUTTON calls it as an
    // onClick handler, so `override` arrives there as a MouseEvent — hence the
    // typeof check rather than a bare `override ?? input`, which would try to
    // .trim() the event.
    const text = (typeof override === 'string' ? override : input).trim();
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
      const { text: reply, images, documents } = await parseChatReply(res);
      setMessages(m => [...m, { role:'assistant', text: reply, images, documents, ts:Date.now() }]);
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
  // already works. Nothing reached the agent or web_chat_histories until this
  // point. The committed thread bubble is the existing AudioBubble (player
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
      const { text: reply, images, documents } = await parseChatReply(res);
      setMessages(m => [...m, { role:'assistant', text: reply, images, documents, ts:Date.now() }]);
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
             // Minus the bottom tab bar as well as the header. --app-navbar-h is
             // 0px at lg+, so this is the same expression at every width; below
             // lg, leaving it out puts the composer underneath the bar.
             height:'calc(100dvh - var(--app-header-h, 140px) - var(--app-navbar-h, 0px))',
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
            <div className="min-h-full flex items-center justify-center px-5 py-6">
              <div className="w-full max-w-md">
                <div className="text-center">
                  <span className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-xl" style={{background:tint(ACCENT,8)}}>
                    <Bot size={22} style={{color:ACCENT_DK}}/>
                  </span>
                  <p className="text-[15px] font-semibold text-zinc-900">Ask me anything about Hi Tech</p>
                  <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed">
                    Comparisons, specs and recommendations — straight from the catalogue. The same AI as the WhatsApp bot.
                  </p>
                </div>

                {/* Tap to send, rather than fill the box: the answer is the point,
                    and the not-found fallback lists near matches, so even a miss
                    leaves the rep somewhere useful. Disabled while a turn is in
                    flight for the same reason the send button is. */}
                <div className="mt-5 grid gap-2">
                  {CHAT_STARTERS.map(st => (
                    <button key={st.q} type="button"
                      onClick={() => send(st.q)}
                      disabled={!configured || sending}
                      className="group flex items-center gap-2.5 w-full text-left rounded-lg border border-zinc-200 bg-surface px-3 py-2.5 min-h-[44px] transition-colors hover:border-zinc-900 outline-none focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <st.icon size={15} className="shrink-0 text-zinc-400 transition-colors group-hover:text-accent-dark"/>
                      <span className="min-w-0 flex-1 text-[12.5px] text-zinc-700 leading-snug">{st.q}</span>
                      <ArrowRight size={13} className="shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-900"/>
                    </button>
                  ))}
                </div>

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
                    className="flex items-center justify-center w-11 h-11 shrink-0 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
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
                placeholder={configured ? 'Message Hi Tech AI…' : 'Configure VITE_N8N_CHAT_WEBHOOK to chat'}
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
// One button style for every workflow action, so a row of six of them reads as
// one control group. Matches the existing accountant tools (Split / Delete)
// rather than inventing a second look.
//
// Colours come from the zinc CLASSES, not from inline custom properties. The
// theme inverts the zinc scale in dark mode (index.css: zinc-700 -> #CDD3DB,
// zinc-900 -> near-white), so these read correctly in both themes. The first
// version of this used style={{ color: 'var(--ink)' }} — but --ink is a SURFACE
// fill ("the colour that owns the page"), #2E3641 in dark mode, so the labels
// came out dark-grey on a dark panel and were almost invisible.
const RowBtn = ({ children, onClick, disabled, busy, danger, title }) => (
  <button type="button" onClick={onClick} disabled={disabled || busy} title={title}
    className={`text-[12px] px-2.5 py-1.5 min-h-[34px] rounded-md border bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? 'hover:opacity-80'
        : 'border-zinc-300 text-zinc-700 hover:border-zinc-900 hover:text-zinc-900'}`}
    style={danger ? { borderColor: 'var(--danger-border)', color: NEG } : undefined}>
    {children}
  </button>
);

function ReceiptRow({ r, open, onToggle, showEmployee, canManage, team, splitRows, onChanged,
                     caps = {}, myUserId, myPhone, rowEvents = [] }) {
  const items = parseItems(r.items);
  const conf  = Math.round((Number(r.ai_confidence) || 0) * 100);
  const confColor = conf >= 85 ? POS : conf >= 70 ? 'var(--warn)' : NEG;
  const [mode, setMode] = useState(null);        // null | 'split' | 'confirmDelete' | 'remark'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');        // remark / rejection reason
  const shares = splitRows || [];

  // Mirrors private.is_own_expense() so the UI doesn't offer a button the server
  // will refuse. The server check is the real one — this only avoids showing an
  // Approve button to the person whose receipt it is.
  const isOwn = (myUserId && r.user_id === myUserId)
             || (myPhone && r.sender_phone === myPhone);

  const st = STATUS_META[r.status] || { label: r.status, tone: 'muted' };
  const stColor = st.tone === 'pos' ? POS : st.tone === 'neg' ? NEG
                : st.tone === 'warn' ? 'var(--warn)' : 'var(--muted)';

  // Every workflow action goes through one busy/error path and refetches on
  // success, so a row can never display a state the database does not hold.
  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setDraft(''); setMode(null); onChanged(); }
    catch (e) { setError(e.message || 'That didn’t work.'); setBusy(false); }
  };

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

  // Save one receipt image. Storage honours ?download=<name> by returning
  // Content-Disposition: attachment, which is the only way to name the file —
  // <a download> is ignored cross-origin, and Storage is a different origin.
  //
  // Opened via a tab rather than assigning location: if the header ever went
  // missing, the failure is a tab showing the image, not the accountant's
  // dashboard navigating away mid-review.
  const [dlBusy, setDlBusy] = useState(false);
  const downloadOne = async (e) => {
    e.stopPropagation();
    setDlBusy(true); setError('');
    const w = window.open('', '_blank');
    if (w) w.opener = null;
    try {
      const url = await receiptDownloadUrl(r.image_path, receiptFileName(r));
      if (w) w.location = url;
      else window.open(url, '_blank', 'noopener');
    } catch {
      if (w) w.close();
      setError('Could not download this receipt.');
    } finally { setDlBusy(false); }
  };
  // content-visibility:auto skips layout/paint for rows scrolled out of view —
  // the list can render up to 80 at once (see ExpensesTab), so this is what
  // keeps that cheap without pulling in a virtualization library. Suspended
  // only while collapsed: an OPEN row must never be skipped, or scrolling it
  // back into view would show it measured at the wrong (collapsed) height.
  return (
    <div className="border-t border-zinc-100 first:border-t-0"
      style={open ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 64px' }}>
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
        {/* Status + flag badges. `shrink-0` on the amount and `flex-wrap` on the
            row above keep these from pushing the total off a 320px screen —
            they wrap under the vendor line instead. */}
        {r.flagged && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}
                title={r.flag_reason || 'Flagged for review'}>Flagged</span>
        )}
        {r.status !== 'logged' && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                style={{ color: stColor, border: `1px solid ${stColor}40` }}>{st.label}</span>
        )}
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
                <span className="ml-auto flex items-center gap-3">
                  {r.image_path
                    ? <>
                        <button type="button" onClick={openStored}
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                          title="Opens a private, time-limited link (only you and the accountant can view it)">
                          <ExternalLink size={11} /> View original
                        </button>
                        <button type="button" onClick={downloadOne} disabled={dlBusy}
                          className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                          title="Save this receipt image to your device">
                          <Download size={11} /> {dlBusy ? 'Saving…' : 'Download'}
                        </button>
                      </>
                    : r.drive_link
                      ? <a href={r.drive_link} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          <ExternalLink size={11} /> View original
                        </a>
                      : <span className="inline-flex items-center gap-1 text-zinc-400"><ImageOff size={11} /> No image</span>}
                </span>
              </div>

              {/* Why it was flagged — the submitter sees this too, so it has to
                  read as an explanation rather than an internal marker. */}
              {r.flagged && r.flag_reason && (
                <div className="mt-3 text-[12.5px] leading-snug rounded-md px-3 py-2"
                     style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                  {r.flag_reason}
                </div>
              )}

              {/* Remarks & history. One chronological trail per receipt: remarks,
                  flags and sign-offs. An employee sees only the entries finance
                  marked visible — RLS decides that, not this component. */}
              {rowEvents.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-200">
                  <Label>Remarks &amp; history</Label>
                  <ul className="mt-1.5 space-y-1.5">
                    {rowEvents.map(ev => (
                      <li key={ev.id} className="text-[12.5px] leading-snug min-w-0">
                        <span className="font-medium text-zinc-800">{ev.actor_name || 'Finance'}</span>
                        <span className="text-zinc-500"> {EVENT_VERB[ev.kind] || ev.kind} · {fmtDay(ev.created_at)}</span>
                        {/* break-words is load-bearing: a remark is free text and
                            one 40-character unbroken string would otherwise push
                            the panel wider than a 320px screen. */}
                        {ev.body && <p className="text-zinc-700 break-words">{ev.body}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Approval workflow. Every button here is drawn from capsFor(),
                  and every RPC behind it re-checks the same rule server-side —
                  including "not your own receipt", which is why isOwn hides
                  Approve/Reject rather than letting the server refuse them. */}
              {(caps.manage || caps.approve) && mode === null && (
                <div className="mt-3 pt-3 border-t border-zinc-200 flex flex-wrap items-center gap-2">
                  {caps.manage && r.status === 'logged' && (
                    <RowBtn busy={busy} onClick={e => { e.stopPropagation(); run(() => submitForApproval(r.expense_id)); }}>
                      Send for approval
                    </RowBtn>
                  )}
                  {caps.approve && r.status !== 'approved' && !isOwn && (
                    <RowBtn busy={busy}
                      disabled={r.flagged && !caps.approveOverLimit}
                      title={r.flagged && !caps.approveOverLimit
                        ? 'Flagged as over-limit — the finance manager approves this one'
                        : 'Approve this expense'}
                      onClick={e => { e.stopPropagation(); run(() => approve(r.expense_id)); }}>
                      Approve
                    </RowBtn>
                  )}
                  {caps.approveOverLimit && r.status === 'approved' && (
                    <RowBtn busy={busy} onClick={e => { e.stopPropagation(); run(() => revokeApproval(r.expense_id)); }}>
                      Revoke approval
                    </RowBtn>
                  )}
                  {caps.manage && (
                    <RowBtn busy={busy} onClick={e => { e.stopPropagation(); setMode('remark'); }}>
                      Add remark
                    </RowBtn>
                  )}
                  {caps.manage && (
                    <RowBtn busy={busy} onClick={e => { e.stopPropagation(); run(() => setFlag(r.expense_id, !r.flagged)); }}>
                      {r.flagged ? 'Clear flag' : 'Flag'}
                    </RowBtn>
                  )}
                  {(caps.manage || caps.approve) && r.status !== 'rejected' && !isOwn && (
                    <RowBtn busy={busy} danger onClick={e => { e.stopPropagation(); setMode('reject'); }}>
                      Reject
                    </RowBtn>
                  )}
                </div>
              )}

              {/* Remark and rejection both need free text; a rejection REQUIRES
                  it, because the server refuses a reasonless rejection — the
                  submitter has to be told what to fix. */}
              {(mode === 'remark' || mode === 'reject') && (
                <div className="mt-3 pt-3 border-t border-zinc-200" onClick={e => e.stopPropagation()}>
                  <Label>{mode === 'reject' ? 'Why is this rejected?' : 'Remark'}</Label>
                  <textarea rows={2} value={draft} onChange={e => setDraft(e.target.value)}
                    placeholder={mode === 'reject'
                      ? 'The submitter will see this'
                      : 'The submitter will see this'}
                    className="mt-1 w-full text-[13px] rounded-md border border-zinc-300 bg-surface px-2.5 py-1.5 outline-none focus:border-zinc-900" />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RowBtn busy={busy} disabled={!draft.trim()}
                      onClick={() => run(() => (mode === 'reject'
                        ? reject(r.expense_id, draft.trim())
                        : addRemark(r.expense_id, draft.trim(), true)))}>
                      {mode === 'reject' ? 'Reject receipt' : 'Save remark'}
                    </RowBtn>
                    {mode === 'remark' && (
                      <RowBtn busy={busy} disabled={!draft.trim()}
                        title="Kept between finance — the submitter will not see it"
                        onClick={() => run(() => addRemark(r.expense_id, draft.trim(), false))}>
                        Save as internal
                      </RowBtn>
                    )}
                    <RowBtn onClick={() => { setMode(null); setDraft(''); setError(''); }}>Cancel</RowBtn>
                  </div>
                </div>
              )}

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
      // The over-limit flag was set at INSERT against the whole receipt total.
      // Reassigning who owes what can take the payer back under their cap (or
      // push someone else over), so the flag has to be re-evaluated or it stays
      // accusing the wrong person. Best-effort: the split itself already saved,
      // and a stale flag is a visible annoyance, not lost money.
      try { await recheckLimit(receipt.expense_id); } catch { /* flag left as-is */ }
      onSaved();
    } catch (e) { setError(e.message || 'Could not save the split.'); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setError('');
    try {
      const token = await getAccessToken();
      await sbRpc(token, 'admin_clear_expense_split', { p_expense_id: receipt.expense_id });
      try { await recheckLimit(receipt.expense_id); } catch { /* flag left as-is */ }
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

// ── Receipt download ──────────────────────────────────────────────────────────
// Two shapes, one scope. Whatever the filters leave on screen is exactly what
// gets exported — there is no second set of pickers in a dialog to drift out of
// step with the ledger, so "30 in view" and "30 in the zip" can never disagree.
//
// Permissions are not re-implemented here. wap_expenses RLS decides which rows
// the tab ever received, and Storage RLS decides which images will sign, so an
// employee's export is scoped twice over by the database and not once by this file.

// Above this, a bulk zip stops being a download and starts being a memory
// problem on the phone it was requested from. Receipts run ~500KB, so 400 is
// roughly a 200MB archive — already generous for one month of one company.
const MAX_ZIP_FILES = 400;

// Sorts by date, reads as a sentence, and stays unique: the expense id tail
// separates two identical lunches bought at the same shop on the same day.
//
// The TAIL, not the head. Ids look like "EXP-2026-MS67RLTWWVDX", so the first
// eight characters are "EXP-2026" on every receipt of the year — measured over
// the live table, left(id,8) had 1 distinct value across 30 rows and right(id,8)
// had 30. Slicing the wrong end silently removes the only unique part.
function receiptFileName(r) {
  const ext = (String(r.image_path || '').split('.').pop() || 'jpg').toLowerCase();
  return [
    (r.processed_at || '').slice(0, 10) || 'undated',
    safeName(r.employee_name || 'unknown', 24),
    safeName(r.vendor_name || 'receipt', 28),
    Math.round(Number(r.total) || 0),
    String(r.expense_id || '').slice(-8),
  ].join('_') + '.' + safeName(ext, 5);
}

// Raw numbers, not fmtPKR: the accountant's first act is to sum the column, and
// "PKR 4,500" is text to a spreadsheet. Currency gets its own column instead.
const receiptColumns = (splitsByExpense, fileFor) => [
  { label: 'Date',           get: r => (r.processed_at || '').slice(0, 10) },
  { label: 'Employee',       get: r => r.employee_name },
  { label: 'Department',     get: r => r.department },
  { label: 'Category',       get: r => r.category },
  { label: 'Vendor',         get: r => r.vendor_name },
  { label: 'Subtotal',       get: r => Number(r.subtotal) || '' },
  { label: 'Tax',            get: r => Number(r.tax) || '' },
  { label: 'Total',          get: r => Number(r.total) || 0 },
  { label: 'Currency',       get: r => r.currency || 'PKR' },
  { label: 'Payment method', get: r => r.payment_method },
  { label: 'Split',          get: r => (splitsByExpense.get(r.expense_id) || [])
      .map(s => `${s.employee_name || s.sender_phone}: ${s.share}`).join('; ') },
  // Ties a spreadsheet row to a file in the archive. Three outcomes worth
  // distinguishing, because an accountant reconciling against the zip needs to
  // know WHY a row has no file: legacy WhatsApp receipts only ever had a Drive
  // link, some rows genuinely have no image, and a fetch can fail. Collapsing
  // all three into a blank turns a recoverable problem into a mystery.
  { label: 'Receipt file',   get: r => fileFor?.(r) || r.drive_link
      || (r.image_path ? 'image not downloaded' : 'no image') },
  { label: 'AI confidence',  get: r => Math.round((Number(r.ai_confidence) || 0) * 100) + '%' },
  { label: 'Expense ID',     get: r => r.expense_id },
];

// Fetch the images and pack them. Returns { blob, got, missing } so the caller
// can tell the truth about a partial export instead of quietly shipping fewer
// files than the button promised.
async function buildReceiptZip(rows, splitsByExpense, onProgress) {
  const withImages = rows.filter(r => r.image_path);
  const urls = await signedReceiptUrls(withImages.map(r => r.image_path));

  // A handful at a time: enough to hide the round-trip latency, few enough that
  // peak memory is a few images rather than the whole month.
  const fetched = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(5, withImages.length) }, async () => {
    while (next < withImages.length) {
      const r = withImages[next++];
      const url = urls.get(r.image_path);
      if (url) {
        try {
          const res = await fetch(url);
          if (res.ok) fetched.push({ r, blob: await res.blob() });
        } catch { /* one unreadable image must not sink the export */ }
      }
      onProgress?.(++done, withImages.length);
    }
  }));

  // Concurrency scrambled the order; put it back to what the ledger showed.
  fetched.sort((a, b) => String(b.r.processed_at || '').localeCompare(String(a.r.processed_at || '')));

  const nameOf = new Map();
  const used = new Set();
  for (const f of fetched) {
    let name = receiptFileName(f.r);
    // The id tail makes this all but impossible; handle it anyway, because a
    // duplicate name in a zip silently overwrites on extraction.
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      name = receiptFileName(f.r).replace(/(\.[^.]+)$/, `-${i}$1`);
    }
    used.add(name.toLowerCase());
    nameOf.set(f.r.expense_id, name);
  }

  const csv = buildCSV(receiptColumns(splitsByExpense, r => nameOf.get(r.expense_id)), rows);
  const entries = fetched.map(f => ({ name: nameOf.get(f.r.expense_id), blob: f.blob }));
  entries.push({ name: 'receipts.csv', blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }) });

  return {
    blob: await zipStore(entries),
    got: fetched.length,
    noImage: rows.length - withImages.length,          // never had one
    failed: withImages.length - fetched.length,        // had one, couldn't get it
  };
}

// Download button + menu for the ledger header. Two options rather than one,
// because "the numbers" and "the paperwork" are genuinely different jobs: the
// CSV is instant and usually all that's wanted, the zip costs a fetch per image.
function ReceiptDownloadMenu({ rows, splitsByExpense, scope, disabled }) {
  const ctx = useContext(ToastContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const stamp = `${scope}-${new Date().toISOString().slice(0, 10)}`;
  const imageCount = rows.filter(r => r.image_path).length;

  const doCsv = () => {
    setOpen(false);
    exportCSV(`receipts-${scope}`, receiptColumns(splitsByExpense, null), rows);
    ctx?.pushToast({ state: 'done', msg: `Downloaded ${rows.length} receipt${rows.length === 1 ? '' : 's'} as CSV` });
  };

  const doZip = async () => {
    setOpen(false);
    if (imageCount > MAX_ZIP_FILES) {
      ctx?.pushToast({ state: 'done', msg: `Too many for one zip (${imageCount}). Filter by person or category first.` });
      return;
    }
    setBusy(true);
    ctx?.pushToast({ state: 'preparing', msg: `Preparing ${imageCount} receipts…` });
    try {
      const { blob, got, noImage, failed } = await buildReceiptZip(rows, splitsByExpense,
        (n, total) => ctx?.pushToast({ state: 'preparing', msg: `Fetching receipts… ${n}/${total}` }));
      saveBlob(blob, `hitech-receipts-${stamp}.zip`);
      // A short download that doesn't say it was short is the worst outcome
      // here — the spreadsheet is complete either way, so name the shortfall.
      const notes = [
        failed  ? `${failed} couldn’t be fetched` : null,
        noImage ? `${noImage} had no image` : null,
      ].filter(Boolean);
      ctx?.pushToast({ state: 'done', msg: notes.length
        ? `Downloaded ${got} receipts — ${notes.join(', ')}`
        : `Downloaded ${got} receipts + spreadsheet` });
    } catch {
      ctx?.pushToast({ state: 'done', msg: 'Could not build the download. Try again.' });
    } finally { setBusy(false); }
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={disabled || busy}
        aria-haspopup="menu" aria-expanded={open}
        className="flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] shrink-0 rounded-lg bg-surface border border-zinc-300 text-zinc-700 text-[12px] font-semibold tracking-tight transition-colors hover:border-zinc-900 hover:text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed">
        <Download size={13} />
        <span>{busy ? 'Preparing…' : 'Download'}</span>
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-2.5rem)] rounded-lg border border-zinc-200 bg-surface shadow-lg z-30 py-1">
          <button role="menuitem" type="button" onClick={doCsv}
            className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition-colors">
            <span className="block text-[13px] font-medium text-zinc-800">Spreadsheet only</span>
            <span className="block text-[11.5px] text-zinc-500 mt-0.5">
              {rows.length} row{rows.length === 1 ? '' : 's'} · CSV for Excel
            </span>
          </button>
          <button role="menuitem" type="button" onClick={doZip} disabled={!imageCount}
            className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition-colors border-t border-zinc-100 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent">
            <span className="block text-[13px] font-medium text-zinc-800">Receipt images + spreadsheet</span>
            <span className="block text-[11.5px] text-zinc-500 mt-0.5">
              {imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'} · ZIP` : 'No stored images in this view'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function ExpensesTab({ role, phone, onAuthError }) {
  // Identity, only so the row can hide Approve/Reject on the viewer's OWN
  // receipt. Not a permission check — private.is_own_expense() refuses it
  // server-side either way; this just avoids offering a button that will fail.
  const myUserId = currentUserId();
  const myPhone = phone || null;
  // "Employee" here means "sees only their own receipts", which is now a
  // capability rather than a role name: finance_viewer is not an employee but is
  // equally restricted to a subset, and finance_manager is not a dev but sees
  // everything. Derive it instead of comparing strings.
  const caps = capsFor(role);
  const isEmployee = !caps.allExpenses && !caps.approvedExpenses;
  const [rows,   setRows]   = useState(null);
  const [splits, setSplits] = useState([]);
  const [team,   setTeam]   = useState([]);
  const [events, setEvents] = useState([]);
  const [statusSel, setStatus] = useState('all');
  const [err,    setErr]    = useState(false);
  const [monthSel, setMonthSel] = useState(null);
  const [dept,   setDept]   = useState('all');
  const [catSel, setCat]    = useState('all');
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
        //
        // `status=neq.rejected` is deliberately GONE. It went in when 'rejected'
        // only ever meant "the OCR produced garbage". It now also means "finance
        // refused this", and a submitter who cannot see the refusal cannot act
        // on it — their receipt would simply vanish. Rejected rows are fetched
        // and rendered; they are excluded from the TOTALS instead (see
        // spendRows), so a refused receipt is visible without being counted as
        // money spent.
        const [ex, sp, team, ev] = await Promise.all([
          sbFetch(token, 'wap_expenses',
            'select=expense_id,user_id,employee_name,department,category,total,subtotal,tax,currency,payment_method,vendor_name,date,processed_at,drive_link,image_path,ai_confidence,items,status,flagged,flag_reason,approved_by,approved_at,sender_phone&order=processed_at.desc&limit=2000'),
          sbFetch(token, 'wap_expense_splits',
            'select=expense_id,user_id,sender_phone,employee_name,share&limit=5000'),
          sbRpc(token, 'expense_team_members'),
          // RLS scopes this: finance gets every trail, an employee gets only the
          // entries marked visible_to_employee on receipts that are theirs.
          sbFetch(token, 'wap_expense_events',
            'select=id,expense_id,kind,body,actor_name,actor_role,created_at&order=created_at.desc&limit=2000'),
        ]);
        if (cancelled) return;
        setRows(ex.data);
        setSplits(sp.data);
        setTeam(Array.isArray(team) ? team : []);
        setEvents(ev.data || []);
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

  // Only categories that actually occur this month, in the palette's order — a
  // dropdown offering six categories that select nothing is worse than four.
  const catsPresent = useMemo(() => {
    if (!rows) return [];
    const seen = new Set(rows
      .filter(r => (r.processed_at || '').slice(0, 7) === month)
      .map(r => (CATS.includes(r.category) ? r.category : 'Other')));
    return CATS.filter(c => seen.has(c));
  }, [rows, month]);

  // Effective category, derived exactly the way `month` is: a pick the newly
  // chosen month has no receipts for falls back to "all", instead of emptying
  // the tab behind a filter the dropdown can no longer even display.
  const cat = catsPresent.includes(catSel) ? catSel : 'all';

  // Scope = current month + department filter (team). selEmp narrows further.
  //
  // Rejected receipts are fetched (so the submitter can see the refusal and its
  // reason) but excluded from every money figure here — a receipt finance
  // refused is not spend. They reappear in listRows below via the status chip,
  // so nothing is hidden, it is only uncounted.
  const inScope = useMemo(() => {
    if (!rows) return [];
    return rows.filter(r =>
      r.status !== 'rejected' &&
      (r.processed_at || '').slice(0, 7) === month &&
      (dept === 'all' || r.department === dept));
  }, [rows, month, dept]);

  // Rejected rows for the current month/department, kept aside so they can be
  // appended to the list without ever reaching a reduce().
  const rejectedInScope = useMemo(() => {
    if (!rows) return [];
    return rows.filter(r =>
      r.status === 'rejected' &&
      (r.processed_at || '').slice(0, 7) === month &&
      (dept === 'all' || r.department === dept));
  }, [rows, month, dept]);

  // expense_id → its event trail, newest first (the fetch already orders it).
  const eventsByExpense = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      if (!m.has(e.expense_id)) m.set(e.expense_id, []);
      m.get(e.expense_id).push(e);
    }
    return m;
  }, [events]);

  // The same scope exploded per person, so a split lands on each participant.
  const inScopeShares = useMemo(
    () => toShareRows(inScope, splitsByExpense), [inScope, splitsByExpense]);

  // The donut buckets anything unrecognised as "Other", so the filter has to
  // bucket it identically — otherwise clicking the "Other" slice selects a
  // category no row literally has, and the view empties.
  const catKey = useCallback(r => (CATS.includes(r.category) ? r.category : 'Other'), []);
  const byCat = useCallback(list => (cat === 'all' ? list : list.filter(r => catKey(r) === cat)), [cat, catKey]);

  // Keyed on the account; the name comes along only to label the bar.
  const byEmployee = useMemo(() => {
    const m = new Map();
    for (const r of byCat(inScopeShares)) {
      const pkey = personKey(r);
      const hit = m.get(pkey);
      if (hit) hit.total += r.amount;
      else m.set(pkey, { pkey, name: r.employee_name || '—', total: r.amount });
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [inScopeShares, byCat]);

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

  // Everything below the donut also honours the category filter. The donut
  // itself deliberately does not (it reads focusShares), so it keeps showing the
  // whole mix and you can click straight from one category to another instead of
  // having to clear the filter first.
  const focusSharesCat = useMemo(() => byCat(focusShares), [focusShares, byCat]);

  // The ledger lists receipts, not shares — one card per physical receipt, even
  // when several people are on it. Deduped by expense_id so a split receipt
  // doesn't appear once per participant.
  const focusRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of focusSharesCat) {
      if (seen.has(s.expense_id)) continue;
      seen.add(s.expense_id);
      const original = inScope.find(r => r.expense_id === s.expense_id);
      out.push(original || s);
    }
    return out;
  }, [focusSharesCat, inScope]);

  // Accountant searched a name that matches no one this month → show a clear
  // "not found" state instead of empty charts/KPIs.
  const empNoMatch = !isEmployee && !!empQuery && !selEmp && byEmployeeShown.length === 0;

  const byCategory = useMemo(() => {
    const m = {};
    focusShares.forEach(r => { const c = catKey(r); m[c] = (m[c] || 0) + r.amount; });
    return CATS.filter(c => m[c] > 0).map(c => ({ category: c, total: m[c] }));
  }, [focusShares, catKey]);

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
  //
  // Deliberately reads raw `rows`, NOT `inScope`/`focusShares` — ignores the
  // month AND the dept/employee filter, same as statusSplit below. A CEO
  // metric like "how fast is finance approving receipts" shouldn't silently
  // narrow to whichever employee happens to be selected elsewhere on the tab.
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

  // Status distribution across ALL receipts — not scoped to one month, and
  // (like approvalTurnaround above) not scoped to the current dept/employee
  // filter either. This answers "how are we doing overall", not a filtered
  // question. `flagged` is a separate boolean column, not a status value, so
  // it's a percentage alongside the bar rather than a fifth bucket.
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

  // KPIs for the focused scope (month + dept + selEmp + category). Spend is the
  // sum of shares; the receipt count is physical receipts, so a split bill is one.
  const totalSpend = focusSharesCat.reduce((a, r) => a + r.amount, 0);
  const count = focusRows.length;
  const avg = count ? totalSpend / count : 0;
  const heroCount = useCountUp(Math.round(totalSpend));
  // With a category selected, "top category" is that category by definition —
  // and it must report the FILTERED total, or this card contradicts the spend
  // card sitting next to it.
  const topCat = cat !== 'all'
    ? { category: cat, total: totalSpend }
    : (byCategory.length ? [...byCategory].sort((a, b) => b.total - a.total)[0] : null);

  // The ledger honours the same focus — and so does the download, over the FULL
  // list rather than the 80 rows rendered below. The cap is a rendering budget,
  // not a scope: an accountant asking for July gets all of July.
  //
  // Rejected rows rejoin here — they were held out of every money figure above,
  // but the person who submitted one needs to see it and read why. Appended
  // rather than merged in date order so a refusal is never buried mid-list.
  const listRowsAll = useMemo(() => {
    const rejected = selEmp
      ? rejectedInScope.filter(r => personKey(r) === selEmp)
      : rejectedInScope;
    return [...focusRows, ...rejected];
  }, [focusRows, rejectedInScope, selEmp]);

  // Status filter. Same derived-not-stored shape as `cat` above: a status with
  // no rows this month self-corrects to 'all', so the list can never be filtered
  // into emptiness behind a chip that is no longer on screen to un-click.
  const statusesPresent = useMemo(
    () => [...new Set(listRowsAll.map(r => r.status))], [listRowsAll]);
  const status = statusesPresent.includes(statusSel) ? statusSel : 'all';
  const listRows = useMemo(
    () => (status === 'all' ? listRowsAll : listRowsAll.filter(r => r.status === status)),
    [listRowsAll, status]);
  const pendingCount = useMemo(
    () => listRowsAll.filter(r => r.status === 'pending_approval').length, [listRowsAll]);

  // One description of the current scope, used both for the line under the
  // heading and for the download filename — so the file on disk says exactly
  // what the screen said when it was asked for.
  const scopeParts = [
    monthLabel(month),
    dept !== 'all' ? dept : null,
    selEmp ? selEmpName : (!isEmployee && empQuery ? `“${empSearch}”` : null),
    cat !== 'all' ? cat : null,
  ].filter(Boolean);
  const scopeLabel = scopeParts.join(' · ');
  const scopeSlug = safeName(scopeParts.join('-').toLowerCase(), 60);

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
          {/* Print-only scope statement. On screen the <select>s below say it;
              on paper a <select> reading "All departments" looks like an
              unfilled form field, not a statement about what the report
              covers — so print gets a plain sentence instead of the controls. */}
          <p className="print-only text-[13px] text-zinc-600 mb-2">
            <span className="font-semibold text-zinc-900">{monthLabel(month)}</span>
            {' · Department: '}{dept !== 'all' ? dept : 'All departments'}
            {' · Category: '}{cat !== 'all' ? cat : 'All categories'}
            {selEmp ? ` · Employee: ${selEmpName}` : ''}
          </p>

          {/* Filters
              PHONE (< sm): a two-column grid with each label stacked over its
              control. As a wrapping flex row these did not fit two-up — "Category"
              plus its select needs ~192px against the ~166px a column gets at
              390px — so every filter took a full line of its own and the group
              came out as four ragged left-aligned rows with the export buttons
              stranded on a fifth. Stacking the label buys the control the whole
              column width, which is what lets two sit side by side.
              sm AND UP: unchanged — the same single wrapping row as before. */}
          <div className="no-print grid grid-cols-2 items-end gap-2.5 sm:flex sm:flex-wrap sm:items-center">
            <div className="flex flex-col items-stretch gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-1.5">
              <Label>Month</Label>
              <select value={month || ''} onChange={e => { setMonthSel(e.target.value); setOpenId(null); }}
                aria-label="Filter by month"
                className="mono w-full sm:w-auto text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20">
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            {!isEmployee && depts.length > 1 && (
              <div className="flex flex-col items-stretch gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-1.5">
                <Label>Dept</Label>
                <select value={dept} onChange={e => { setDept(e.target.value); setSelEmp(null); }}
                  aria-label="Filter by department"
                  className="w-full sm:w-auto text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20">
                  <option value="all">All departments</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            {catsPresent.length > 1 && (
              <div className="flex flex-col items-stretch gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-1.5">
                <Label>Category</Label>
                <select value={cat} onChange={e => { setCat(e.target.value); setOpenId(null); }}
                  aria-label="Filter by category"
                  className="w-full sm:w-auto text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20">
                  <option value="all">All categories</option>
                  {catsPresent.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {!isEmployee && (
              <div ref={comboRef} className="relative col-span-2 flex items-center sm:col-span-1">
                <Search size={13} className="absolute left-2.5 text-zinc-400 pointer-events-none z-10" />
                <input
                  type="text" value={empSearch}
                  onChange={e => { setEmpSearch(e.target.value); setSelEmp(null); setSuggestOpen(true); }}
                  onFocus={() => setSuggestOpen(true)}
                  placeholder="Search employee…"
                  aria-label="Search employee"
                  role="combobox" aria-expanded={suggestOpen && !!empQuery} aria-autocomplete="list"
                  className="text-[12px] text-zinc-800 bg-surface border border-zinc-300 rounded-md pl-8 pr-7 py-1.5 w-full sm:w-48 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20 placeholder:text-zinc-400"
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
                      // Key and value are both the person key, never the name:
                      // selEmp is compared against personKey() everywhere else,
                      // so setting a name here filtered every view to nothing.
                      // Two colleagues sharing a first name also collided on key.
                      <li key={e.pkey} role="option" aria-selected={false}>
                        <button
                          onMouseDown={ev => { ev.preventDefault(); setSelEmp(e.pkey); setEmpSearch(''); setSuggestOpen(false); }}
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
                className="col-span-2 inline-flex items-center justify-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md border border-zinc-300 bg-surface text-zinc-700 hover:border-zinc-900 transition-colors sm:col-span-1 sm:justify-start">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
                {selEmpName} <X size={12} className="text-zinc-400" />
              </button>
            )}
            {/* Export sits on the filters' own row, hard right. It used to have a
                full-width row to itself directly above, which left a band of
                empty space beside it and pushed the filters onto a second line.
                Hidden with no receipts at all: an export of nothing is six empty
                sheets, which reads as a broken file rather than an empty month. */}
            {!noData && (
              <div className="col-span-2 flex justify-end sm:col-span-1 sm:ml-auto">
                <ExportTabButton exportName="expenses-report" buildSheets={() => buildExpenseSheets({
                  byEmployee: byEmployeeShown, byCategory, trend, spendCompareMetrics, approvalTurnaround, statusSplit,
                })}/>
              </div>
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
              // Only clickable when there is more than one category to switch
              // between — otherwise the donut could set a filter the toolbar
              // isn't rendering a way to clear.
              onSelectCategory={catsPresent.length > 1 ? (c => setCat(c || 'all')) : undefined}
            />
          </Suspense>

          {!isEmployee && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Panel className="p-6">
                <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Approval turnaround</h2>
                <p className="text-[13px] text-zinc-500 mt-1 mb-4">Average days from submission to approval</p>
                <Suspense fallback={<div className="h-56 rounded bg-zinc-50 animate-pulse"/>}>
                  <ApprovalTurnaround data={approvalTurnaround}/>
                </Suspense>
              </Panel>
              {statusSplit && <StatusSplit {...statusSplit}/>}
            </div>
          )}

          {/* Monthly limits. Everyone who can see the panel sees the numbers;
              only dev / finance_manager / finance_admin can CHANGE them.
              canManage was !isEmployee, which let finance_viewer edit caps —
              including their own — when their whole role is keeping records of
              what finance decided. private.can_set_limits() refuses them
              server-side; this stops the button being offered at all. */}
          <BudgetPanel
            team={team}
            spendByPhone={spendByPhone}
            month={month}
            canManage={caps.setLimits}
            onSaved={reload}
          />

          {/* Receipt ledger */}
          <Panel className="p-6">
            {/* Button beside the heading, not beside the description. The
                description is long and scope-dependent; sharing a row with a
                110px button left it ~100px wide at 320px, which wrapped it into
                a seven-line column. On its own row it gets the full panel. */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight min-w-0 truncate">Receipts</h2>
              <ReceiptDownloadMenu
                rows={listRows}
                splitsByExpense={splitsByExpense}
                scope={scopeSlug}
                disabled={listRows.length === 0}
              />
            </div>
            <p className="text-[13px] text-zinc-500 mt-1 mb-4">
              {scopeLabel} · <span className="mono tabular-nums">{listRows.length}</span> in view — click a row for the full receipt
              {caps.approve && pendingCount > 0 && (
                <> · <span style={{ color: 'var(--warn)' }}>
                  <span className="mono tabular-nums">{pendingCount}</span> awaiting your approval
                </span></>
              )}
            </p>

            {/* Status chips. Only shown when there is more than one status to
                choose between — with everything still 'Submitted', a row of
                chips is noise offering a choice that changes nothing.
                `flex-wrap` so they drop to their own line at 320px rather than
                squeezing the row above. */}
            {statusesPresent.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4" role="group" aria-label="Filter by approval status">
                {['all', ...statusesPresent].map(s => {
                  const active = status === s;
                  const meta = s === 'all' ? { label: 'All' } : (STATUS_META[s] || { label: s });
                  const n = s === 'all' ? listRowsAll.length : listRowsAll.filter(r => r.status === s).length;
                  return (
                    <button key={s} type="button" onClick={() => setStatus(s)}
                      aria-pressed={active}
                      className={`text-[12px] px-2.5 py-1.5 min-h-[32px] rounded-md border transition-colors ${
                        active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-surface text-zinc-600 hover:border-zinc-900'}`}>
                      {meta.label} <span className="mono tabular-nums opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}

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
                      canManage={caps.manage}
                      team={selectableTeam}
                      splitRows={splitsByExpense.get(r.expense_id)}
                      onChanged={reload}
                      caps={caps}
                      myUserId={myUserId}
                      myPhone={myPhone}
                      rowEvents={eventsByExpense.get(r.expense_id) || []}
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
// dev server-side, so nothing here can be abused from the client.
//
// ROLE_CHOICES now lives in src/caps.js beside the capability map, so the picker
// and the permissions it hands out are edited in one place.

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

  if (!capsFor(role).team) {
    return <Panel className="p-8 text-center text-[14px] text-zinc-500">Only developers can manage the team.</Panel>;
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
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: tint(meta.color, 8), color: meta.color }}>
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

  // Deliberately depends on `open` ALONE, not `onClose` too. The dashboard
  // polls stats every 30s (useData's background refresh) and re-renders the
  // whole app on every tick; the caller passes onClose as `()=>setPwOpen(false)`,
  // a fresh inline function every render. With onClose in this array, every
  // 30-second poll counted as a dependency change and re-ran the reset below —
  // wiping out whatever password the user was mid-typing, on a timer, while
  // the modal just sat there open. This must only fire on the actual
  // closed→open transition.
  useEffect(() => {
    if (!open) return;
    setCur(''); setPw(''); setPw2(''); setErr(''); setDone(false); setBusy(false);
    setShowCur(false); setShowPw(false); setShowPw2(false);
  }, [open]);

  // Escape-to-close is safe to depend on onClose: re-registering the same
  // listener on every render costs nothing and always calls the current
  // onClose, unlike the reset above it doesn't destroy anything by re-running.
  useEffect(() => {
    if (!open) return;
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
//
// `short` is the bottom tab bar's label, and only exists where the full one does
// not fit. The bar gives each tab viewport/5 of width — 64px at the 320px design
// floor — and "Conversations" runs about 68px at the bar's 10px size, so it is
// the one label that would truncate. Everything else measures under 50px and
// uses `label` unchanged. Deriving a short form by slicing was the alternative
// and is worse: it would produce "Conversat…", which is not shorter to read,
// only shorter to draw.
const SALES_NAV = [
  {id:'overview',      label:'Overview',      icon:LayoutDashboard},
  {id:'conversations', label:'Conversations', short:'Convos', icon:MessageSquare},
  {id:'users',         label:'Reps',          icon:Users},
  {id:'chat',          label:'Chat',          icon:Bot, sub:'Test Hi Tech AI live'},
];
const EXPENSES_NAV = {id:'expenses', label:'Expenses', icon:Receipt, sub:'Employee receipts & spend'};
const TEAM_NAV = {id:'team', label:'Team', icon:Shield, sub:'Manage logins & roles'};
const ALL_NAV = [...SALES_NAV, EXPENSES_NAV, TEAM_NAV];   // superset, for hash/history validation

// Which tabs a role may see. Derived from the capability map (src/caps.js) so
// this list and the RLS in db/roles-and-approvals.sql cannot drift into
// disagreeing.
//
//   c.chats = may READ the transcript (Conversations, Reps, Overview)
//   c.chat  = has the Chat TAB. True for everyone, and not because the sales bot
//             is useful to Finance: the web receipt uploader lives inside that
//             composer, so withholding the tab would leave Finance owing
//             receipts with no way to file one.
//
// An unknown role (profile still loading) resolves through capsFor() to the
// employee capability set, so the fallback is the most restrictive nav, never an
// elevated one.
function navForRole(role) {
  const c = capsFor(role);
  const nav = [];
  if (c.chats) nav.push(...SALES_NAV.filter(n => n.id !== 'chat'));
  nav.push(c.allExpenses || c.approvedExpenses
    ? EXPENSES_NAV
    : {...EXPENSES_NAV, label:'My Expenses', short:'Expenses', sub:'Your receipts & spend'});
  if (c.chat) nav.push(SALES_NAV.find(n => n.id === 'chat'));
  if (c.team) nav.push(TEAM_NAV);
  return nav;
}

// How many tabs the bottom bar shows before it needs a "More" slot. Five is the
// ceiling because of width, not taste: at the 320px design floor five slots are
// 64px each, which is exactly what a 20px icon over a 10px label needs. Six
// would put every label under 54px and start truncating them.
const BAR_SLOTS = 5;

// Split a role's nav into what the bottom bar shows and what goes behind "More".
// Only `dev` is ever affected — it has six tabs; every other role has two to
// five and passes straight through untouched.
//
// The demotion order is deliberate rather than "last two lose":
//   · Team is admin housekeeping, opened rarely and never mid-task.
//   · Reps is reachable by drilling from Overview, so it has a second door.
//   · Chat is NEVER demoted, at any nav length. The web receipt uploader lives
//     inside its composer (see the `chat` note in src/caps.js), so burying it
//     would bury the only way to file an expense from a phone.
//   · nav[0] is never demoted either — it is where the wordmark sends you.
function splitNavForBar(nav) {
  if (nav.length <= BAR_SLOTS) return { bar: nav, more: [] };
  const needed = nav.length - (BAR_SLOTS - 1);   // the "More" slot costs one of the five
  const more = [];
  for (const id of ['team', 'users', 'conversations']) {
    if (more.length >= needed) break;
    const n = nav.find(x => x.id === id);
    if (n) more.push(n);
  }
  // Backstop for a future role with a nav longer than the demotion list above:
  // take from the end, still sparing Chat and the home tab.
  for (let i = nav.length - 1; i > 0 && more.length < needed; i--) {
    if (nav[i].id !== 'chat' && !more.includes(nav[i])) more.push(nav[i]);
  }
  return { bar: nav.filter(n => !more.includes(n)), more };
}

// Role display (shown in the header for everyone). Built from the same map, so
// adding a role means editing src/caps.js and nothing here.
const ROLE_META = Object.fromEntries(
  Object.entries(CAPS).map(([role, c]) => [role, {
    label: c.label,
    color: c.tone === 'accent' ? BLUE : c.tone === 'pos' ? POS : 'var(--muted)',
  }]),
);

// ── Account Menu ──────────────────────────────────────────────────────────────
// Everything that used to be its own icon in the header: identity, help, theme,
// change password, sign out. Five controls plus a 130px identity block was more
// than half the header's width spent on things pressed once a session, and it
// was the reason navigation had no room left below lg.
//
// Portalled to <body> and positioned fixed rather than absolute. The header is
// `sticky` with a z-index, which makes it a stacking context an absolutely
// positioned child cannot escape — the menu would be clipped by the header's own
// bottom border the moment it grew past 80px, which it does.
function AccountMenu({ displayName, initials, roleMeta,
                       helpOpen, onToggleHelp,
                       themeIcon: ThemeIcon, themeLabel, themeMode, onCycleTheme,
                       onChangePassword, onLogout }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btnRef  = useRef(null);
  const menuRef = useRef(null);
  const MENU_W  = 264;

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    // Same viewport→zoomed-coordinate conversion as DeptCombo. The header sits
    // outside .app-scale so z is 1 today, but reading it keeps this correct if
    // the scale is ever extended over the header.
    const z = zoomOf(el);
    const r = el.getBoundingClientRect();
    setRect({
      top:  r.bottom / z + 8,
      // Right-aligned to the trigger, then clamped so it can never hang off a
      // 320px screen — where MENU_W is most of the viewport.
      left: Math.max(8, Math.min(r.right / z - MENU_W, window.innerWidth / z - MENU_W - 8)),
      z,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = e => {
      if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();   // Escape must not strand focus in a menu that no longer exists
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  const row = 'flex items-center gap-3 w-full px-3.5 py-2.5 text-[13.5px] text-zinc-700 rounded-md transition-colors hover:bg-zinc-100 hover:text-zinc-900 outline-none focus-visible:bg-zinc-100';
  const run = fn => () => { setOpen(false); fn(); };

  return (
    <>
      <button ref={btnRef} type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account: ${displayName}${roleMeta ? ` (${roleMeta.label})` : ''}`}
        className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg transition-colors hover:bg-zinc-900/5 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full text-[12px] font-bold shrink-0"
          style={roleMeta
            ? { background: tint(roleMeta.color, 12), color: roleMeta.color }
            : { background: 'var(--color-zinc-100)', color: 'var(--muted)' }}>
          {initials}
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div ref={menuRef} role="menu"
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{ position: 'fixed', top: rect.top, left: rect.left, width: MENU_W, zoom: rect.z, zIndex: 60 }}
              className="rounded-xl border border-zinc-200 bg-surface shadow-[0_12px_32px_-8px_rgba(24,24,27,0.22)] p-1.5"
            >
              {/* Identity — the block that used to sit in the header's left corner. */}
              <div className="px-3.5 py-2.5">
                <p className="text-[13.5px] font-semibold text-zinc-900 truncate">{displayName}</p>
                {roleMeta && (
                  <p className="mono text-[9px] uppercase tracking-[0.14em] mt-1" style={{ color: roleMeta.color }}>
                    {roleMeta.label}
                  </p>
                )}
              </div>
              <div className="h-px bg-zinc-200 my-1.5"/>

              <button type="button" role="menuitemcheckbox" aria-checked={helpOpen}
                onClick={run(onToggleHelp)} className={row}>
                <HelpCircle size={15} className="shrink-0 text-zinc-400"/>
                <span className="flex-1 text-left">Help captions</span>
                {/* A word, not a coloured dot. The state has to be readable by
                    someone who can't distinguish the accent from the muted grey,
                    and aria-checked alone is invisible to everyone not using AT. */}
                <span className="mono text-[9px] uppercase tracking-[0.12em]"
                  style={{ color: helpOpen ? ACCENT_DK : 'var(--color-zinc-400)' }}>
                  {helpOpen ? 'On' : 'Off'}
                </span>
              </button>

              <button type="button" role="menuitem" onClick={run(onCycleTheme)} title={themeLabel} className={row}>
                <ThemeIcon size={15} className="shrink-0 text-zinc-400"/>
                <span className="flex-1 text-left">Theme</span>
                <span className="mono text-[9px] uppercase tracking-[0.12em] text-zinc-400">{themeMode}</span>
              </button>

              <button type="button" role="menuitem" onClick={run(onChangePassword)} className={row}>
                <KeyRound size={15} className="shrink-0 text-zinc-400"/>
                <span className="flex-1 text-left">Change password</span>
              </button>

              <div className="h-px bg-zinc-200 my-1.5"/>
              <button type="button" role="menuitem" onClick={run(onLogout)} className={row}>
                <LogOut size={15} className="shrink-0 text-zinc-400"/>
                <span className="flex-1 text-left">Sign out</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ── Bottom Navigation (below lg) ──────────────────────────────────────────────
// Replaces the dropdown tab-picker that used to live in the header. That picker
// was a single button showing only the CURRENT tab, so it answered "where am I"
// and never "where can I go", and every move cost two taps. Worse, it was last
// in the header's width queue: on a 320px screen it was left with ~14px for its
// label and rendered as "Overvi…".
//
// A bottom bar fixes that by not being in the queue at all — it has a row of its
// own. The header below lg is then just wordmark + refresh + account.
// One slot of the bottom bar. Module scope rather than nested inside BottomNav
// on purpose: a component declared in a render body is a brand-new component
// type on every render, so React unmounts and remounts the entire row each time
// the tab changes — destroying the very layoutId animation below.
function NavSlot({ active, icon: Icon, label, ...rest }) {
  return (
    <button type="button"
      className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 h-16 outline-none focus-visible:bg-zinc-900/5 transition-colors"
      {...rest}
    >
      {/* The active marker is a tinted pill behind the icon, moved between slots
          with layoutId so switching tabs reads as one object travelling rather
          than two unrelated fades. MotionConfig reducedMotion="user" at the root
          turns it into a cut for anyone who asked for that. */}
      <span className="relative flex items-center justify-center h-7 w-12 shrink-0">
        {active && (
          <motion.span layoutId="barPill"
            className="absolute inset-0 rounded-full"
            style={{ background: tint(ACCENT, 12) }}
            transition={{ type: 'spring', stiffness: 480, damping: 36 }}/>
        )}
        <Icon size={19} className="relative shrink-0" style={active ? { color: ACCENT } : undefined}/>
      </span>
      {/* ACCENT_DK for the label, not ACCENT: at 10px this counts as small text
          and needs 4.5:1, which the fill orange does not clear on white. */}
      <span className={`relative text-[10px] leading-none max-w-full truncate px-1 ${active ? 'font-semibold' : 'font-medium'}`}
        style={{ color: active ? ACCENT_DK : 'var(--color-zinc-500)' }}>
        {label}
      </span>
    </button>
  );
}

function BottomNav({ nav, tab, goTab }) {
  const { bar, more } = useMemo(() => splitNavForBar(nav), [nav]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = more.some(n => n.id === tab);
  // Derived, not corrected in an effect. A role resolving late can empty `more`
  // while the sheet is open; reading that at render closes it in the same pass,
  // where an effect would paint one frame of an empty sheet first.
  const sheetOpen = moreOpen && more.length > 0;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = e => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  return (
    <>
      {/* Floating, not edge-to-edge. Inset on all three sides with a real
          shadow so it reads as an object sitting ON the page rather than a strip
          welded to the bottom of the window — the page visibly continues
          underneath it, which is what keeps a small screen feeling taller than
          it is. overflow-hidden is what lets the slots' own hover/focus fills
          stop at the rounded corners instead of squaring them off. */}
      <nav aria-label="Main"
        className="lg:hidden no-print fixed left-4 right-4 z-40 flex items-stretch rounded-3xl bg-surface border border-zinc-200 overflow-hidden shadow-[0_6px_24px_-4px_rgba(24,24,27,0.20),0_2px_6px_-2px_rgba(24,24,27,0.12)]"
        style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
      >
        {bar.map(n => (
          <NavSlot key={n.id} active={tab === n.id} icon={n.icon} label={n.short || n.label}
            aria-current={tab === n.id ? 'page' : undefined}
            onClick={() => { if (tab !== n.id) goTab(n.id); setMoreOpen(false); }}/>
        ))}
        {more.length > 0 && (
          <NavSlot active={moreActive} icon={MoreHorizontal} label="More"
            aria-haspopup="menu" aria-expanded={sheetOpen}
            onClick={() => setMoreOpen(o => !o)}/>
        )}
      </nav>

      {createPortal(
        <AnimatePresence>
          {sheetOpen && (
            <>
              {/* The scrim sits BELOW the bar (z-38 against the bar's z-40) on
                  purpose: the bar stays lit, so the same "More" slot you opened
                  it with is still the thing you tap to close it. */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="lg:hidden fixed inset-0 z-[38]" style={{ background: 'rgba(24,24,27,0.28)' }}
                onClick={() => setMoreOpen(false)} aria-hidden="true"/>
              <motion.div role="menu" aria-label="More tabs"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="lg:hidden fixed left-4 right-4 z-[39] bg-surface border border-zinc-200 rounded-3xl p-1.5 shadow-[0_6px_24px_-4px_rgba(24,24,27,0.20)]"
                style={{ bottom: 'calc(var(--app-navbar-h) + 8px)' }}
              >
                {more.map(n => {
                  const active = tab === n.id;
                  return (
                    <button key={n.id} type="button" role="menuitem"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => { goTab(n.id); setMoreOpen(false); }}
                      className={`flex items-center gap-3 w-full px-4 py-3.5 rounded-lg text-[15px] transition-colors outline-none focus-visible:bg-zinc-100 ${active ? 'bg-zinc-100 font-semibold text-zinc-900' : 'font-medium text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <n.icon size={17} className="shrink-0" style={{ color: active ? ACCENT : 'var(--muted)' }}/>
                      <span className="flex-1 text-left">{n.label}</span>
                      {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT }}/>}
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

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

  // No toast on refresh. The button spins while the fetch is in flight and stops
  // when it lands, which says the same thing at the point the user is already
  // looking — a toast in the opposite corner only repeats it, a beat later.
  // Screen readers still get it: the button carries aria-busy, so the state
  // change is announced without a live region firing on every refresh.
  // The toast system itself stays; exports and receipt downloads use it, and
  // those DO need it because they finish somewhere the user isn't looking.

  // Drill-through: jump to Conversations with a topic (answer) or rep pre-filter.
  const goDrill    = useCallback(d => { goTab('conversations'); setDrill(d); }, [goTab]);
  const clearDrill = useCallback(() => setDrill(null), []);

  // Keyboard accelerators: number keys switch tabs, "/" jumps to Conversations search.
  useEffect(()=>{
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
      // Character keys only. The range test below is a string comparison, so
      // named keys fall into it too — 'Escape' is >= '1', and would have matched
      // the moment a role ever had nine or more tabs.
      if (e.key.length !== 1) return;
      if (e.key>='1' && e.key<=String(nav.length)) { goTab(nav[+e.key-1].id); }
      else if (e.key==='/') { e.preventDefault(); if (nav.some(n=>n.id==='conversations')) { goTab('conversations'); setSearchFocus(n=>n+1); } }
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
        <div className="w-full px-4 sm:px-6 lg:px-8 h-20 flex items-center gap-3 sm:gap-5">

          {/* The mark alone — no wordmark. It doubles as the way home, the way a
              site logo always has.

              alt="" on the image is deliberate and the aria-label carries the
              whole name instead: with the text gone this button has no readable
              content of its own, so without that label a screen reader would
              announce it as an unlabelled button. The label also says where it
              goes, which the picture never did. */}
          <button type="button"
            onClick={()=>goTab(homeTab)}
            aria-label={`Hi Tech — go to ${ALL_NAV.find(n=>n.id===homeTab)?.label || 'Overview'}`}
            className="flex items-center shrink-0 -m-1 p-1 rounded-lg transition-opacity hover:opacity-80 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <img src="/logo-icon.png" alt="" width="256" height="256" className="h-11 w-auto"/>
          </button>

          {/* Tab strip (lg+). Below lg this whole element is absent and BottomNav
              carries navigation instead — which is what finally ends the width
              war this header used to lose: the strip now competes only with a
              logo and two controls, never with six.

              A segmented track rather than the old full-height underlined row.
              Same vocabulary as the channel filter under the page title, so the
              two "pick one of these" controls on screen look like the same
              control. It also drops the strip from 80px of header height to 40px,
              which is most of what made the old header feel heavy.

              overflow-x-auto is kept as a backstop but should never engage: six
              tabs (dev, the widest role) measure ~586px, and at the lg breakpoint
              this row has ~960px to spend now that identity, help, theme and
              change-password have moved into the account menu. */}
          <nav aria-label="Main" className="hidden lg:flex items-center justify-center flex-1 min-w-0">
            {/* bg-surface, NOT bg-zinc-100. On paper (#F1F5F9) a zinc-100 track
                (#F4F4F5) is a 1% step — invisible — so the group read as a stray
                outlined box with a white blob in it. White on paper is a real
                step, and it makes the group the same floating object the phone's
                bar is.

                justify-center rather than left-aligned against the logo: with
                identity, help, theme and change-password gone from the right,
                a left-anchored strip left ~800px of dead space between the last
                tab and the refresh button. Centring in the leftover space (as
                opposed to absolute-centring on the viewport) keeps it clear of
                both the wordmark and the controls at every width. */}
            <div className="flex items-center gap-1 p-1.5 rounded-full bg-surface border border-zinc-200 shadow-[0_1px_3px_rgba(24,24,27,0.07)] max-w-full overflow-x-auto no-scrollbar">
              {nav.map((n,idx)=>{
                const active = tab===n.id;
                return (
                  <button key={n.id}
                    onClick={()=>{ if(!active) goTab(n.id); }}
                    aria-current={active ? 'page' : undefined}
                    title={`${n.label} · press ${idx+1}`}
                    className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-full shrink-0 whitespace-nowrap text-[13.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                      ${active ? 'font-semibold' : 'text-zinc-500 hover:text-zinc-900 font-medium'}`}
                    style={active ? {color:ACCENT_DK} : undefined}
                  >
                    {/* Accent tint, matching the phone bar's active pill, so the
                        two navs read as one idea in two shapes. It also needs no
                        per-theme value: color-mix against `transparent` lands on
                        whatever surface it is over, light or dark.

                        Behind the label, not around it — hence the explicit
                        `relative` on the icon and text below. layoutId keeps the
                        pill a single object sliding between tabs, which is the
                        one piece of the old underline worth keeping. */}
                    {active && (
                      <motion.span layoutId="tabPill"
                        className="absolute inset-0 rounded-full"
                        style={{background:tint(ACCENT,10)}}
                        transition={{type:'spring',stiffness:480,damping:36}}/>
                    )}
                    <n.icon size={15} className="relative shrink-0" style={active ? {color:ACCENT} : undefined}/>
                    <span className="relative">{n.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Right cluster — two controls, down from six. Refresh earns its place
              in the header because it is pressed repeatedly while reading; the
              rest are once-a-session and live behind the account menu. */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
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
              /* Icon-only and square. The 44px box stays: it is the touch target,
                 not the visual size — the button reads small because the label and
                 the extra horizontal padding are gone, not because it was shrunk
                 below what a thumb can hit. */
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-zinc-900 text-on-ink transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <motion.div
                animate={refreshing ? {rotate:360} : {}}
                transition={{duration:0.7,repeat:refreshing?Infinity:0,ease:'linear'}}
              >
                <RefreshCw size={15}/>
              </motion.div>
            </motion.button>
            {/* Renders at every width, unlike the controls it absorbed. Change
                password used to be lg-only in the header and phone-only inside
                the nav dropdown; with that dropdown gone this menu is its single
                home on both. */}
            <AccountMenu
              displayName={displayName}
              initials={initials}
              roleMeta={role ? ROLE_META[role] : null}
              helpOpen={helpOpen}
              onToggleHelp={()=>setHelpOpen(o=>!o)}
              themeIcon={ThemeIcon}
              themeLabel={themeLabel}
              themeMode={themeMode}
              onCycleTheme={cycleTheme}
              onChangePassword={()=>setPwOpen(true)}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      {/* ── Page ──
          The body renders 12.5% larger than the header on desktop (was 25%,
          dialled back 10% on request) — see .app-scale in index.css for why
          that lives here instead of in the browser's own zoom (short version:
          browser zoom enlarges the nav too, and the nav is the one strip with
          no room to spare).

          Chat is the one tab that opts out. Its enlarged panel is position:fixed
          and sized from --app-header-h and 100dvh, all real viewport pixels that a
          zoomed context would rescale — and on a chat surface a bigger message box
          is worth more than bigger text. Scaling the whole <main> rather than an
          inner wrapper is deliberate: the max-w-7xl container has to grow with the
          content, or everything just gets more cramped inside a box the same size.

          The extra top padding rides the SAME breakpoint as the scale (xl is
          1280px, exactly where --app-scale becomes 1.125) because it exists to
          pay for it. The gap between the header rule and the page title held its
          ratio when the body grew — but the header did NOT grow, so a larger
          title now crowds a nav bar that stayed put, and the old gap reads as
          cramped. It only needs the correction where the scale is live. */}
      <main className={`relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-8 xl:pt-12 pb-navbar${tab === 'chat' ? '' : ' app-scale'}`}>

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
          {capsFor(role).chats && ['overview','conversations','users'].includes(tab) && (
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
              {tab==='expenses'      && <ExpensesTab      role={role} phone={profile?.phone} onAuthError={handleLogout}/>}
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

      {/* Primary navigation below lg. Rendered as a sibling of <main> rather
          than inside the header, because it is position:fixed to the bottom of
          the viewport and the header is a sticky, z-indexed stacking context at
          the top of it. */}
      <BottomNav nav={nav} tab={tab} goTab={goTab}/>
    </div>
    <ChangePasswordModal open={pwOpen} onClose={()=>setPwOpen(false)}/>
    <ToastPortal/>
    </HelpContext.Provider>
    </ToastContext.Provider>
    </MotionConfig>
  );
}
