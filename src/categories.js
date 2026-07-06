// Expense category palette + money formatting — shared by the Expenses tab
// (eager) and the lazy Recharts chunk (charts.jsx), so the fixed category→hue
// mapping is defined in exactly one place.
//
// The 7 hues are a colorblind-safe categorical set (validated with the dataviz
// palette validator: worst adjacent CVD ΔE 24.2, target ≥12). Signal-orange
// (#F5471D) is deliberately NOT used here — it stays reserved for the app's
// "top spender / over budget" accent, so category color never impersonates it.
// Because 3 hues fall below 3:1 on white, the "relief rule" applies: every
// category is always shown with its NAME (legend + label), never color alone.

export const CATS = ['Food', 'Fuel', 'Travel', 'Supplies', 'Utilities', 'Repairs', 'Other'];

export const CAT_COLOR = {
  Food:      '#2a78d6', // blue
  Fuel:      '#1baf7a', // aqua
  Travel:    '#eda100', // yellow
  Supplies:  '#008300', // green
  Utilities: '#4a3aa7', // violet
  Repairs:   '#e34948', // red
  Other:     '#e87ba4', // magenta
};

export const catColor = (c) => CAT_COLOR[c] || CAT_COLOR.Other;

// "PKR 12,345" — whole rupees, grouped. Receipts are all forced to PKR upstream.
export const fmtPKR = (n) =>
  'PKR ' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// Compact form for axis ticks / tight chips: "PKR 6.3k", "PKR 1.2M".
export const fmtPKRk = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return 'PKR ' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1e3) return 'PKR ' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return 'PKR ' + Math.round(v);
};
