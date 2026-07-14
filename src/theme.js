// Theme: 'auto' | 'light' | 'dark'. Light is the default identity (see PRODUCT.md);
// dark is an opt-in accommodation for using the dashboard at night.
//
// 'auto' follows the OS and LISTENS for changes, so when the phone's night schedule
// flips at sunset the dashboard follows without a reload. That's the whole point —
// opening this at 2am should just BE dark, with no action taken.
//
// The <html data-theme> attribute is also set by an inline script in index.html before
// first paint. Without that, every night-time load flashes white for a frame. See the
// comment there.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const KEY = 'ht_theme';
const MODES = ['auto', 'light', 'dark'];

export function storedMode() {
  const m = localStorage.getItem(KEY);
  return MODES.includes(m) ? m : 'auto';
}

const systemPrefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

// A mode ('auto') resolves to a theme ('light' | 'dark'). CSS only ever sees a
// concrete theme — never the literal 'auto'.
export function resolveTheme(mode) {
  return mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [mode, setMode] = useState(storedMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Derived, not stored: theme is a pure function of mode + the OS setting, so it's
  // computed during render. `systemDark` only moves the needle while mode is 'auto'.
  const theme = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;

  // The effect only touches external systems (the DOM attribute, localStorage) — no
  // React state is set here, so there's no cascading render.
  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, mode);
  }, [theme, mode]);

  // Track the OS preference always; `theme` ignores it unless mode is 'auto', so a
  // forced light/dark stays forced even when the OS flips.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = e => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const cycle = useCallback(() => {
    setMode(m => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  }, []);

  return { mode, theme, setMode, cycle };
}

// Resolved hex values for the current theme.
//
// Charts need this because Recharts sets colors as SVG *attributes* (fill="#2258B8"),
// and a CSS var() does not resolve inside an attribute — the browser sees the literal
// string "var(--blue)" and paints nothing. So charts can't ride the variable remap that
// the rest of the app uses; they need real values.
//
// Read from the live computed styles rather than duplicating the palette here, so
// index.css stays the single source of truth and the two can't drift apart.
const TOKENS = ['accent', 'accent-dark', 'blue', 'pos', 'neg', 'ink', 'line', 'muted', 'text', 'surface', 'surface-2', 'paper'];

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const t of TOKENS) out[t.replace(/-./g, s => s[1].toUpperCase())] = cs.getPropertyValue(`--${t}`).trim();
  return out;
}

export function useThemeColors() {
  const { theme } = useTheme();
  const [colors, setColors] = useState(readTokens);
  // Re-read AFTER useTheme's effect has stamped data-theme, but BEFORE paint, so a
  // chart never shows a frame of the old theme's colors. getComputedStyle is
  // synchronous; reading from it keeps index.css the single source of truth. The
  // set-state-in-effect this trips is the codebase's accepted pattern for syncing to
  // an external system — here, the CSS engine's resolved variable values.
  useLayoutEffect(() => { setColors(readTokens()); }, [theme]);
  return colors;
}
