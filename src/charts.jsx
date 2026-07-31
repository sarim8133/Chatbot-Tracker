// Lazy-loaded chart module — isolates Recharts (the heaviest dependency) into its
// own async chunk so the dashboard's first paint (KPI cluster + log) doesn't wait
// on the charting library. Self-contained: duplicates a few small constants on
// purpose to avoid a circular import with the dashboard entry.

import { useState, useMemo, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, X, Download } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  PieChart, Pie,
} from 'recharts';
import { catColor, CAT_COLOR, fmtPKR, fmtPKRk } from './categories';
import { useThemeColors } from './theme';
import { downloadChartPNG } from './chart-export';

// Recharts sets colors as SVG *attributes* (fill="#2258B8"), where a CSS var()
// does not resolve — the browser sees the literal string and paints nothing. So
// every chart component below calls useThemeColors() for real hex values instead
// of riding the index.css variable remap the rest of the app uses.
const MONO = "'Spline Sans Mono', ui-monospace, monospace";
const mkTick = (c) => ({ fill: c.muted, fontSize: 10, fontFamily: MONO });

const ChartTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold text-zinc-900">{payload[0].value}</p>
    </div>
  );
};

// print-block (index.css) keeps a panel whole on one printed page. These panels
// are plain divs rather than the dashboard's <Panel>, so they did not inherit it
// and every chart here split across the page fold in a PDF export.
const panelCls = "print-block bg-surface border border-zinc-100 rounded-xl p-6 shadow-[0_1px_3px_0_rgba(30,41,59,0.06),0_4px_16px_-4px_rgba(30,41,59,0.1)]";

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
            className="w-full max-w-5xl bg-surface rounded-2xl shadow-2xl overflow-hidden"
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
    className="no-print flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shrink-0"
  >
    <Maximize2 size={14} />
  </button>
);

// Sits next to ExpandBtn. `hostRef` points at the element wrapping the chart;
// the first <svg> inside it is what gets saved.
const DownloadBtn = ({ hostRef, title, disabled = false }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try { await downloadChartPNG(hostRef?.current, title); }
        finally { setBusy(false); }
      }}
      aria-label={`Download ${title} as an image`}
      title="Download as image (PNG)"
      className="no-print flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
    >
      <Download size={14} />
    </button>
  );
};

// ── Message Volume + Top Reps ─────────────────────────────────────────────────
export default function ChartsRow({ volumeDaily = [], topReps }) {
  const [range,    setRange]    = useState('14');
  const [from,     setFrom]     = useState('');
  const [to,       setTo]       = useState('');
  const [expanded, setExpanded] = useState(null); // 'volume' | 'reps' | null
  const volumeRef = useRef(null);
  const repsRef   = useRef(null);
  // Unique prefix per component instance — prevents gradient ID collisions when
  // both the panel chart and the modal chart are mounted at the same time.
  const uid = useId();
  const c = useThemeColors();
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

  const dateField = "mono text-[11px] text-zinc-700 bg-surface border border-zinc-300 rounded px-2 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20";

  // Each call site needs its own gradient ID (panel vs modal are both mounted).
  const mkVolume = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={view} margin={{top:6,right:6,bottom:0,left:4}}>
        <defs>
          <linearGradient id={`${uid}af${sfx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={c.accent} stopOpacity={0.14}/>
            <stop offset="100%" stopColor={c.accent} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={16} padding={{left:12,right:12}}/>
        <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={34} allowDecimals={false}/>
        <Tooltip content={<ChartTip/>} cursor={{stroke:c.ink,strokeWidth:1,strokeDasharray:'3 3'}}/>
        <Area type="monotone" dataKey="count"
          stroke={c.accent} strokeWidth={2}
          fill={`url(#${uid}af${sfx})`} dot={false}
          activeDot={{r:4,fill:c.accent,stroke:c.surface,strokeWidth:2}}/>
      </AreaChart>
    </ResponsiveContainer>
  );

  const mkReps = () => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={topReps} layout="vertical" margin={{top:0,right:8,bottom:0,left:8}}>
        <XAxis type="number" tick={mkTick(c)} axisLine={false} tickLine={false}/>
        <YAxis type="category" dataKey="name" tick={{...mkTick(c), fill:c.text}}
          axisLine={false} tickLine={false} width={56}/>
        <Tooltip content={<ChartTip/>} cursor={{fill:`${c.ink}0A`}}/>
        <Bar dataKey="count" radius={[0,3,3,0]} maxBarSize={18}>
          {topReps.map((_,i)=>(<Cell key={i} fill={i===0 ? c.accent : c.ink}/>))}
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
            {/* no-print: on paper the range presets and the two date inputs are
                unfilled form controls. The window they select is already stated
                in plain words in the sub-heading above ("14-day window · N msgs"),
                which is what a printed report should carry. */}
            <div className="no-print flex flex-wrap items-center gap-2">
              {/* range presets */}
              <div className="inline-flex rounded-xl border border-zinc-300 overflow-hidden">
                {PRESETS.map(p=>{
                  const active = !customActive && range===p.k;
                  return (
                    <button key={p.k} type="button"
                      onClick={()=>{ setRange(p.k); setFrom(''); setTo(''); }}
                      aria-pressed={active}
                      className={`px-2.5 py-1.5 mono text-[10px] uppercase tracking-wide border-l first:border-l-0 border-zinc-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${active ? 'bg-zinc-900 text-on-ink' : 'bg-surface text-zinc-600 hover:text-zinc-900'}`}>
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
              <DownloadBtn hostRef={volumeRef} title="Message volume" disabled={!view.length} />
              <ExpandBtn onClick={() => setExpanded('volume')} />
            </div>
          </div>
          <div ref={volumeRef} data-chart-host className="h-64" role="img"
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
            <div className="flex items-center gap-0.5 shrink-0">
              <DownloadBtn hostRef={repsRef} title="Top reps" disabled={!topReps?.length} />
              <ExpandBtn onClick={() => setExpanded('reps')} />
            </div>
          </div>
          <div ref={repsRef} data-chart-host className="h-64" role="img" aria-label="Top reps ranked by message volume">
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
    <div className="bg-surface border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold" style={{color:'var(--accent-dark)'}}>{Math.round((p.rate||0)*100)}%</p>
      <p className="mono text-[9px] text-zinc-500 mt-0.5">{p.hits}/{p.total} from cache</p>
    </div>
  );
};

export function HitRateTrend({ data = [] }) {
  const [expanded, setExpanded] = useState(false);
  const hostRef = useRef(null);
  const uid = useId();
  const c = useThemeColors();
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);

  const mkChart = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:4}}>
        <defs>
          <linearGradient id={`${uid}rf${sfx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={c.accent} stopOpacity={0.16}/>
            <stop offset="100%" stopColor={c.accent} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4"/>
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={24} padding={{left:12,right:12}}/>
        <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={38} domain={[0,1]} tickFormatter={v=>`${Math.round(v*100)}%`}/>
        <Tooltip content={<RateTip/>} cursor={{stroke:c.ink,strokeWidth:1,strokeDasharray:'3 3'}}/>
        <Area type="monotone" dataKey="rate"
          stroke={c.accent} strokeWidth={2}
          fill={`url(#${uid}rf${sfx})`} dot={false}
          activeDot={{r:4,fill:c.accent,stroke:c.surface,strokeWidth:2}}/>
      </AreaChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="relative">
        <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5">
          <DownloadBtn hostRef={hostRef} title="Cache hit rate" disabled={!data.length} />
          <ExpandBtn onClick={() => setExpanded(true)} />
        </div>
        <div ref={hostRef} data-chart-host className="h-56" role="img" aria-label="Cache hit rate per day over time">
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
  const hostRef = useRef(null);
  // Reuses the app's one validated colorblind-safe categorical set
  // (src/categories.js) rather than theme tokens — c.pos/c.neg specifically
  // are reserved for delta coloring elsewhere (mawavia-dashboard.jsx), so an
  // arbitrary rep's line must not borrow "good"/"bad" semantics.
  const palette = [CAT_COLOR.Food, CAT_COLOR.Fuel, CAT_COLOR.Travel, CAT_COLOR.Supplies, CAT_COLOR.Utilities];

  // Pivot [{date,label,reps:[{ident,name,count}]}] into one row per day with
  // one column per rep — the shape Recharts' multi-<Line> wants. `reps` is
  // ranked by total volume descending, so palette[0]/accent-equivalent lands
  // on the same rep the adjacent "Top reps" bar chart highlights as #1.
  const { rows, reps } = useMemo(() => {
    const totals = new Map();
    for (const day of data) for (const r of day.reps || [])
      totals.set(r.ident, { name: r.name || r.ident, total: (totals.get(r.ident)?.total || 0) + r.count });
    const reps = [...totals.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([ident, v]) => ({ ident, name: v.name }));
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
        <Tooltip content={<RepTrendTip/>} cursor={{stroke:c.ink,strokeWidth:1,strokeDasharray:'3 3'}}/>
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
        <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5">
          <DownloadBtn hostRef={hostRef} title="Rep activity" disabled={!rows.length}/>
          <ExpandBtn onClick={()=>setExpanded(true)}/>
        </div>
        <div ref={hostRef} data-chart-host className="h-56" role="img" aria-label="Message volume per day for the top 5 reps, last 30 days">
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

// ── Expenses tab charts (lazily loaded) ───────────────────────────────────────
// Presentational only — all filtering/selection state lives in ExpensesTab.

const MoneyTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p.payload?.name || p.payload?.category || p.payload?.label || '';
  return (
    <div className="bg-surface border border-zinc-900 rounded-xl px-3 py-2 shadow-[3px_3px_0_0_rgba(30,41,59,0.12)]">
      {name && <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{name}</p>}
      <p className="mono text-[14px] font-bold text-zinc-900">{fmtPKR(p.value)}</p>
    </div>
  );
};

const EmptyChart = ({ label = 'No spend in this period' }) => (
  <div className="h-full flex items-center justify-center">
    <p className="mono text-[11px] uppercase tracking-widest text-zinc-400">{label}</p>
  </div>
);

// Horizontal employee bars — leader in accent; click to drill. When one employee
// is selected, it goes accent and the rest dim (so the selection reads clearly).
function EmployeeSpendBars({ data, selected, onSelect }) {
  const c = useThemeColors();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
        <XAxis type="number" tick={mkTick(c)} axisLine={false} tickLine={false} tickFormatter={fmtPKRk} />
        <YAxis type="category" dataKey="name" tick={{ ...mkTick(c), fill: c.text }} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<MoneyTip />} cursor={{ fill: `${c.ink}0A` }} />
        <Bar dataKey="total" radius={[0, 3, 3, 0]} maxBarSize={22} cursor="pointer"
          onClick={(d) => onSelect?.(selected === d?.pkey ? null : d?.pkey)}>
          {data.map((d, i) => {
            const isSel = selected === d.pkey;
            const dim = selected && !isSel;
            const fill = isSel ? c.accent : (!selected && i === 0 ? c.accent : c.ink);
            return <Cell key={d.pkey} fill={fill} fillOpacity={dim ? 0.32 : 1} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Category donut — fixed per-category hues, PKR total in the hole, and a legend
// carrying name + % so identity never rests on color alone (the relief rule).
//
// Click a slice (or a legend row) to filter the whole tab to that category, the
// same drill the employee bars do. The legend carries the click as well as the
// arc because on a phone the arcs are a few millimetres of ring — the legend row
// is the target a thumb can actually hit.
function CategoryDonut({ data, selected, onSelect }) {
  const c = useThemeColors();
  const total = data.reduce((a, b) => a + b.total, 0);
  const pick = (cat) => onSelect?.(selected === cat ? null : cat);
  return (
    <div className="flex flex-col h-full">
      <div className="relative flex-1 min-h-[176px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="category"
              innerRadius="62%" outerRadius="92%" paddingAngle={2}
              stroke={c.surface} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}
              cursor={onSelect ? 'pointer' : undefined}
              onClick={(d) => pick(d?.category ?? d?.payload?.category)}>
              {data.map((d) => (
                <Cell key={d.category} fill={catColor(d.category)}
                  fillOpacity={selected && selected !== d.category ? 0.32 : 1} />
              ))}
            </Pie>
            <Tooltip content={<MoneyTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="mono text-[9px] uppercase tracking-widest text-zinc-400">Total</span>
          <span className="mono text-[17px] font-bold text-zinc-900 tabular-nums">{fmtPKR(total)}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1">
        {/* px-1/py-1.5 makes each row a ~120x30 tap target rather than the bare
            18px of text it used to be — the arcs are far too thin to hit on a
            phone, so the legend has to be the real control. */}
        {data.map((d) => {
          const pct = total ? Math.round((d.total / total) * 100) : 0;
          const isSel = selected === d.category;
          return (
            <button key={d.category} type="button" onClick={() => pick(d.category)}
              aria-pressed={isSel}
              className={`flex items-center gap-2 min-w-0 text-left rounded px-1 -mx-1 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${onSelect ? 'hover:bg-zinc-100/70 cursor-pointer' : 'cursor-default'} ${selected && !isSel ? 'opacity-45' : ''}`}>
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: catColor(d.category) }} />
              <span className={`text-[12px] truncate flex-1 ${isSel ? 'text-zinc-900 font-semibold' : 'text-zinc-700'}`}>{d.category}</span>
              <span className="mono text-[11px] text-zinc-500 tabular-nums shrink-0">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SpendTrend({ data }) {
  const uid = useId();
  const c = useThemeColors();
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);

  // A trend needs two points to draw a line. With a single month of history the
  // AreaChart draws a zero-length segment and, with dot={false}, nothing visible
  // at all — which reads as a broken chart rather than as "you have one month of
  // data". One bar shows the same number on the same axes and looks deliberate.
  if (data.length === 1) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} />
          <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={52} tickFormatter={fmtPKRk} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: `${c.ink}0A` }} />
          <Bar dataKey="total" fill={c.accent} radius={[3, 3, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`${uid}sp`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.accent} stopOpacity={0.14} />
            <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false} interval={tickEvery} minTickGap={20} padding={{left:12,right:12}} />
        <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={52} tickFormatter={fmtPKRk} />
        <Tooltip content={<MoneyTip />} cursor={{ stroke: c.ink, strokeWidth: 1, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey="total" stroke={c.accent} strokeWidth={2}
          fill={`url(#${uid}sp)`} dot={false} activeDot={{ r: 4, fill: c.accent, stroke: c.surface, strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

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
  const hostRef = useRef(null);
  const tickEvery = Math.max(0, Math.ceil(data.length/8)-1);

  // One approved month draws no line — see the same note in SpendTrend. A single
  // bar is the honest rendering: it shows the number instead of an empty frame.
  const mkChart = (sfx) => (
    <ResponsiveContainer width="100%" height="100%">
      {data.length === 1 ? (
        <BarChart data={data} margin={{top:6,right:6,bottom:0,left:4}}>
          <CartesianGrid vertical={false} stroke={c.line} strokeDasharray="2 4"/>
          <XAxis dataKey="label" tick={mkTick(c)} axisLine={false} tickLine={false}/>
          <YAxis tick={mkTick(c)} axisLine={false} tickLine={false} width={34} allowDecimals={false} tickFormatter={v=>`${v}d`}/>
          <Tooltip content={<DaysTip/>} cursor={{fill:`${c.ink}0A`}}/>
          <Bar dataKey="days" fill={c.accent} radius={[3,3,0,0]} maxBarSize={56}/>
        </BarChart>
      ) : (
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
      )}
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="relative">
        <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5">
          <DownloadBtn hostRef={hostRef} title="Approval turnaround" disabled={!data.length}/>
          <ExpandBtn onClick={()=>setExpanded(true)}/>
        </div>
        <div ref={hostRef} data-chart-host className="h-56" role="img" aria-label="Average days from receipt submission to approval, by month">
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

// Panel header with download + enlarge buttons (same affordance as the Overview
// charts). A plain function, not a component, so it isn't re-created on every
// render. `hostRef`/`downloadTitle` are what the PNG export reads; omit them and
// the header renders with the enlarge button alone.
const panelHead = (title, sub, onExpand, hostRef, hasData = true) => (
  <div className="flex items-start justify-between gap-3 mb-5">
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold text-zinc-900 tracking-tight">{title}</h2>
      <p className="text-[13px] text-zinc-500 mt-1">{sub}</p>
    </div>
    <div className="flex items-center gap-0.5 shrink-0">
      {hostRef && <DownloadBtn hostRef={hostRef} title={title} disabled={!hasData} />}
      <ExpandBtn onClick={onExpand} />
    </div>
  </div>
);

// `selectedEmployee` is the person key (a uuid for anyone with a login), so it
// selects but never prints — `selectedEmployeeName` is what the titles show.
export function ExpenseCharts({ mode = 'team', byEmployee = [], byCategory = [], trend = [], selectedEmployee = null, selectedEmployeeName = '', onSelectEmployee, selectedCategory = null, onSelectCategory, topN = 14 }) {
  const [expanded, setExpanded] = useState(null); // 'emp' | 'cat' | 'trend'
  const empRef   = useRef(null);
  const catRef   = useRef(null);
  const trendRef = useRef(null);

  const empTop = byEmployee.slice(0, topN);
  const empHidden = byEmployee.length - empTop.length;

  const donut = byCategory.length
    ? <CategoryDonut data={byCategory} selected={selectedCategory} onSelect={onSelectCategory} />
    : <EmptyChart />;
  const spendTrend = trend.length ? <SpendTrend data={trend} /> : <EmptyChart label="Not enough history yet" />;
  const empBars = (data) => (data.length
    ? <EmployeeSpendBars data={data} selected={selectedEmployee} onSelect={onSelectEmployee} />
    : <EmptyChart />);

  const donutTitle = mode === 'personal' ? 'Your categories'
    : selectedEmployee ? `Categories · ${selectedEmployeeName}` : 'Categories · whole team';
  const trendSub = `${mode === 'personal' ? 'You' : (selectedEmployee ? selectedEmployeeName : 'All employees')} · PKR per month`;

  const donutPanel = (
    <div className={panelCls}>
      {panelHead(donutTitle,
        selectedCategory ? `Showing ${selectedCategory} — click it again to clear`
          : onSelectCategory ? 'Share of spend — click a category to filter'
          : 'Share of spend by category',
        () => setExpanded('cat'), catRef, byCategory.length > 0)}
      <div ref={catRef} data-chart-host className="h-72">{donut}</div>
    </div>
  );

  const trendPanel = (
    <div className={panelCls}>
      {panelHead('Monthly spend trend', trendSub, () => setExpanded('trend'), trendRef, trend.length > 0)}
      <div ref={trendRef} data-chart-host className="h-56" role="img" aria-label="Monthly spend trend">{spendTrend}</div>
    </div>
  );

  // Enlarge modals — the employee list can be long, so its modal scrolls and
  // shows every employee (the panel below only shows the top few).
  const modals = (
    <>
      <ChartModal title="Spend by employee" sub={`${byEmployee.length} employee${byEmployee.length === 1 ? '' : 's'}`}
        open={expanded === 'emp'} onClose={() => setExpanded(null)}>
        <div className="h-full overflow-y-auto pr-1">
          <div style={{ height: Math.max(340, byEmployee.length * 26) }}>{empBars(byEmployee)}</div>
        </div>
      </ChartModal>
      <ChartModal title={donutTitle} sub="Share of spend by category"
        open={expanded === 'cat'} onClose={() => setExpanded(null)}>
        <div className="h-full">{donut}</div>
      </ChartModal>
      <ChartModal title="Monthly spend trend" sub={trendSub}
        open={expanded === 'trend'} onClose={() => setExpanded(null)}>
        {spendTrend}
      </ChartModal>
    </>
  );

  if (mode === 'personal') {
    return (
      <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {donutPanel}
          {trendPanel}
        </div>
        {modals}
      </>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5 items-stretch">
          <div className={panelCls}>
            {panelHead('Spend by employee',
              selectedEmployee ? 'Showing one employee — click their bar to clear'
                : empHidden > 0 ? `Top ${topN} of ${byEmployee.length} — enlarge or search for the rest`
                : 'Click a bar to drill into one employee',
              () => setExpanded('emp'), empRef, empTop.length > 0)}
            <div ref={empRef} data-chart-host className="h-72" role="img" aria-label="Spend by employee">{empBars(empTop)}</div>
          </div>
          {donutPanel}
        </div>
        {trendPanel}
      </div>
      {modals}
    </>
  );
}
