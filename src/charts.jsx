// Lazy-loaded chart module — isolates Recharts (the heaviest dependency) into its
// own async chunk so the dashboard's first paint (KPI cluster + log) doesn't wait
// on the charting library. Self-contained: duplicates a few small constants on
// purpose to avoid a circular import with the dashboard entry.

import { useState, useMemo, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, X } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';

const INK       = '#1E293B';
const ACCENT    = '#F5471D';
const ACCENT_DK = '#D63A12';
const LINE      = '#E4E4E7';
const MONO      = "'Spline Sans Mono', ui-monospace, monospace";
const tickStyle = { fill:'#71717A', fontSize:10, fontFamily:MONO };

const ChartTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold text-zinc-900">{payload[0].value}</p>
    </div>
  );
};

const panelCls = "bg-white border border-zinc-100 rounded-xl p-6 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)]";

const PRESETS = [
  {k:'7',   label:'7D',  days:7},
  {k:'14',  label:'14D', days:14},
  {k:'30',  label:'30D', days:30},
  {k:'all', label:'All', days:null},
];

// ── Portal-rendered chart expansion modal ─────────────────────────────────────
// AnimatePresence wraps the conditional child so exit animations fire before
// the portal content unmounts. The portal itself stays mounted.
function ChartModal({ title, sub, open, onClose, children }) {
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-10"
          style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-7 py-5 border-b border-zinc-100">
              <div>
                <h2 className="text-[16px] font-semibold text-zinc-900 tracking-tight">{title}</h2>
                {sub && <p className="text-[13px] text-zinc-500 mt-0.5">{sub}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close chart"
                className="flex items-center justify-center w-9 h-9 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-7" style={{ height: 'min(62vh, 480px)' }}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// Small expand icon button for chart headers
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

// ── Message Volume + Top Reps ─────────────────────────────────────────────────
export default function ChartsRow({ volumeDaily = [], topReps }) {
  const [range,    setRange]    = useState('14');
  const [from,     setFrom]     = useState('');
  const [to,       setTo]       = useState('');
  const [expanded, setExpanded] = useState(null); // 'volume' | 'reps' | null
  // Unique prefix per component instance — prevents gradient ID collisions when
  // both the panel chart and the modal chart are mounted at the same time.
  const uid = useId();
  const customActive = !!(from || to);

  const view = useMemo(()=>{
    let rows = volumeDaily;
    if (customActive) {
      rows = rows.filter(r => (!from || r.date>=from) && (!to || r.date<=to));
    } else {
      const p = PRESETS.find(x=>x.k===range);
      if (p?.days) rows = rows.slice(-p.days);
    }
    return rows;
  },[volumeDaily, range, from, to, customActive]);

  const total     = view.reduce((a,b)=>a+b.count,0);
  const tickEvery = Math.max(0, Math.ceil(view.length/8)-1);
  const minDate   = volumeDaily[0]?.date;
  const maxDate   = volumeDaily[volumeDaily.length-1]?.date;

  const dateField = "mono text-[11px] text-zinc-700 bg-white border border-zinc-300 rounded px-2 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20";

  // Each call site needs its own gradient ID (panel vs modal are both mounted).
  const mkVolume = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={view} margin={{top:6,right:6,bottom:0,left:-20}}>
        <defs>
          <linearGradient id={`${uid}af${sfx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.14}/>
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={16}/>
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={34} allowDecimals={false}/>
        <Tooltip content={<ChartTip/>} cursor={{stroke:INK,strokeWidth:1,strokeDasharray:'3 3'}}/>
        <Area type="monotone" dataKey="count"
          stroke={ACCENT} strokeWidth={2}
          fill={`url(#${uid}af${sfx})`} dot={false}
          activeDot={{r:4,fill:ACCENT,stroke:'#fff',strokeWidth:2}}/>
      </AreaChart>
    </ResponsiveContainer>
  );

  const mkReps = () => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={topReps} layout="vertical" margin={{top:0,right:8,bottom:0,left:8}}>
        <XAxis type="number" tick={tickStyle} axisLine={false} tickLine={false}/>
        <YAxis type="category" dataKey="name" tick={{...tickStyle, fill:'#52525B'}}
          axisLine={false} tickLine={false} width={56}/>
        <Tooltip content={<ChartTip/>} cursor={{fill:'rgba(30,41,59,0.04)'}}/>
        <Bar dataKey="count" radius={[0,3,3,0]} maxBarSize={18}>
          {topReps.map((_,i)=>(<Cell key={i} fill={i===0 ? ACCENT : INK}/>))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-5">

        {/* Message volume — range-selectable area chart */}
        <div className={panelCls}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Message volume</h2>
              <p className="text-[13px] text-zinc-500 mt-1">
                {view.length}-day window · {total.toLocaleString()} msgs
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* range presets */}
              <div className="inline-flex rounded-xl border border-zinc-300 overflow-hidden">
                {PRESETS.map(p=>{
                  const active = !customActive && range===p.k;
                  return (
                    <button key={p.k} type="button"
                      onClick={()=>{ setRange(p.k); setFrom(''); setTo(''); }}
                      aria-pressed={active}
                      className={`px-2.5 py-1.5 mono text-[10px] uppercase tracking-wide border-l first:border-l-0 border-zinc-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${active ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:text-zinc-900'}`}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {/* custom date range */}
              <div className="flex items-center gap-1.5">
                <input type="date" value={from} min={minDate} max={to||maxDate}
                  onChange={e=>setFrom(e.target.value)} aria-label="From date" className={dateField}/>
                <span className="text-zinc-400 text-[11px]">→</span>
                <input type="date" value={to} min={from||minDate} max={maxDate}
                  onChange={e=>setTo(e.target.value)} aria-label="To date" className={dateField}/>
                {customActive && (
                  <button type="button" onClick={()=>{ setFrom(''); setTo(''); }}
                    aria-label="Clear custom range"
                    className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-accent/40">✕</button>
                )}
              </div>
              <ExpandBtn onClick={() => setExpanded('volume')} />
            </div>
          </div>
          <div className="h-64" role="img"
            aria-label={`Message volume over ${view.length} days, ${total} messages total`}>
            {view.length ? mkVolume('p') : (
              <div className="h-full flex items-center justify-center">
                <p className="mono text-[11px] uppercase tracking-widest text-zinc-400">No data in this range</p>
              </div>
            )}
          </div>
        </div>

        {/* Top reps — horizontal bar chart */}
        <div className={panelCls}>
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">Top reps</h2>
              <p className="text-[13px] text-zinc-500 mt-1">By volume</p>
            </div>
            <ExpandBtn onClick={() => setExpanded('reps')} />
          </div>
          <div className="h-64" role="img" aria-label="Top reps ranked by message volume">
            {mkReps()}
          </div>
        </div>
      </div>

      {/* Expansion modals */}
      <ChartModal
        title="Message volume"
        sub={`${view.length}-day window · ${total.toLocaleString()} msgs`}
        open={expanded === 'volume'}
        onClose={() => setExpanded(null)}
      >
        {mkVolume('m')}
      </ChartModal>

      <ChartModal
        title="Top reps"
        sub="By message volume"
        open={expanded === 'reps'}
        onClose={() => setExpanded(null)}
      >
        {mkReps()}
      </ChartModal>
    </>
  );
}

// ── Cache hit-rate trend (Cache tab, lazily loaded) ───────────────────────────
const RateTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold" style={{color:ACCENT_DK}}>{Math.round((p.rate||0)*100)}%</p>
      <p className="mono text-[9px] text-zinc-500 mt-0.5">{p.hits}/{p.total} from cache</p>
    </div>
  );
};

export function HitRateTrend({ data = [] }) {
  const [expanded, setExpanded] = useState(false);
  const uid = useId();

  const mkChart = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:-12}}>
        <defs>
          <linearGradient id={`${uid}rf${sfx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.16}/>
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24}/>
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={38} domain={[0,1]} tickFormatter={v=>`${Math.round(v*100)}%`}/>
        <Tooltip content={<RateTip/>} cursor={{stroke:INK,strokeWidth:1,strokeDasharray:'3 3'}}/>
        <Area type="monotone" dataKey="rate"
          stroke={ACCENT} strokeWidth={2}
          fill={`url(#${uid}rf${sfx})`} dot={false}
          activeDot={{r:4,fill:ACCENT,stroke:'#fff',strokeWidth:2}}/>
      </AreaChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setExpanded(true)}
          aria-label="Expand chart"
          title="Click to expand"
          className="absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Maximize2 size={14} />
        </button>
        <div className="h-56" role="img" aria-label="Cache hit rate per day over time">
          {mkChart('p')}
        </div>
      </div>
      <ChartModal
        title="Hit rate over time"
        sub="Daily cache hit rate — is the cache improving?"
        open={expanded}
        onClose={() => setExpanded(false)}
      >
        {mkChart('m')}
      </ChartModal>
    </>
  );
}
