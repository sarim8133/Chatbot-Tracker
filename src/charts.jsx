// Lazy-loaded chart module — isolates Recharts (the heaviest dependency) into its
// own async chunk so the dashboard's first paint (KPI cluster + log) doesn't wait
// on the charting library. Self-contained: duplicates a few small constants on
// purpose to avoid a circular import with the dashboard entry.

import { useState, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';

const INK       = '#18181B';
const ACCENT    = '#F5471D';
const ACCENT_DK = '#D63A12';
const LINE      = '#E4E4E7';
const MONO      = "'Spline Sans Mono', ui-monospace, monospace";
const tickStyle = { fill:'#71717A', fontSize:10, fontFamily:MONO };

const ChartTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-900 rounded-md px-3 py-2 shadow-[3px_3px_0_0_rgba(24,24,27,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold text-zinc-900">{payload[0].value}</p>
    </div>
  );
};

const PanelHead = ({title, sub}) => (
  <div className="mb-6">
    <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">{title}</h2>
    <span className="mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1 block">{sub}</span>
  </div>
);

const panelCls = "bg-white border border-zinc-200 rounded-lg p-6";

// Range presets for the volume chart. `days:null` = the full loaded window.
const PRESETS = [
  {k:'7',   label:'7D',  days:7},
  {k:'14',  label:'14D', days:14},
  {k:'30',  label:'30D', days:30},
  {k:'all', label:'All', days:null},
];

export default function ChartsRow({ volumeDaily = [], topReps }) {
  const [range, setRange] = useState('14');
  const [from,  setFrom]  = useState('');
  const [to,    setTo]    = useState('');
  const customActive = !!(from || to);

  // Slice the daily series to the active window: a custom from/to overrides the preset.
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
  const tickEvery = Math.max(0, Math.ceil(view.length/8)-1);   // ~8 labels max
  const minDate   = volumeDaily[0]?.date;
  const maxDate   = volumeDaily[volumeDaily.length-1]?.date;

  const dateField = "mono text-[11px] text-zinc-700 bg-white border border-zinc-300 rounded px-2 py-1.5 outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-accent/20";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4">

      {/* Message volume — range-selectable single accent line on datasheet grid */}
      <div className={panelCls}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-900 tracking-tight">Message volume</h2>
            <span className="mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1 block">
              {view.length}-day window · {total.toLocaleString()} msgs
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* presets */}
            <div className="inline-flex rounded-md border border-zinc-300 overflow-hidden">
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
            {/* custom from → to */}
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
          </div>
        </div>
        <div className="h-48" role="img"
          aria-label={`Message volume over ${view.length} days, ${total} messages total`}>
          {view.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={view} margin={{top:6,right:6,bottom:0,left:-20}}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#areaFill)" dot={false}
                  activeDot={{r:4,fill:ACCENT,stroke:'#fff',strokeWidth:2}}/>
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="mono text-[11px] uppercase tracking-widest text-zinc-400">No data in this range</p>
            </div>
          )}
        </div>
      </div>

      {/* Top reps — ink bars, leader in accent */}
      <div className={panelCls}>
        <PanelHead title="Top reps" sub="By volume"/>
        <div className="h-48" role="img" aria-label="Top reps ranked by message volume">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topReps} layout="vertical" margin={{top:0,right:8,bottom:0,left:8}}>
              <XAxis type="number" tick={tickStyle} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" tick={{...tickStyle, fill:'#52525B'}}
                axisLine={false} tickLine={false} width={56}/>
              <Tooltip content={<ChartTip/>} cursor={{fill:'rgba(24,24,27,0.04)'}}/>
              <Bar dataKey="count" radius={[0,2,2,0]} maxBarSize={14}>
                {topReps.map((_,i)=>(<Cell key={i} fill={i===0 ? ACCENT : INK}/>))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Cache hit-rate trend (Cache tab, lazily loaded) ───────────────────────────
const RateTip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-zinc-900 rounded-md px-3 py-2 shadow-[3px_3px_0_0_rgba(24,24,27,0.12)]">
      <p className="mono text-[9px] uppercase tracking-widest text-zinc-500 mb-0.5">{label}</p>
      <p className="mono text-[14px] font-bold" style={{color:ACCENT_DK}}>{Math.round((p.rate||0)*100)}%</p>
      <p className="mono text-[9px] text-zinc-500 mt-0.5">{p.hits}/{p.total} from cache</p>
    </div>
  );
};

export function HitRateTrend({ data = [] }) {
  return (
    <div className="h-44" role="img" aria-label="Cache hit rate per day over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{top:6,right:6,bottom:0,left:-12}}>
          <defs>
            <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
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
            fill="url(#rateFill)" dot={false}
            activeDot={{r:4,fill:ACCENT,stroke:'#fff',strokeWidth:2}}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
