// Client-side error sink. Frontend errors are POSTed to Supabase (public.client_errors)
// for later review — the dashboard had zero frontend error visibility before this.
// Mirrors receipts.js / voice.js: one job, no React, independently testable.
//
// A logger must never make things worse. Two hard rules shape everything here:
//   1. It must never throw. A logging failure that bubbles up would re-trigger the
//      global 'error' handler and recurse — the classic error-logger footgun. Every
//      path is wrapped so the sink fails silently.
//   2. It must never flood. A render loop or a flaky-network retry storm could fire
//      thousands of errors a second. Dedupe + a per-load cap + a throttle bound the
//      volume so a bug can't turn the sink into a DoS on your own database.
//
// See docs/superpowers/specs/2026-07-16-client-error-sink-design.md.
import { SB_URL, SB_KEY } from './config';

const MSG_MAX   = 1024;   // 1 KB — a message longer than this is noise
const STACK_MAX = 4096;   // 4 KB — enough for a useful trace, not a novel
const SESSION_CAP = 25;   // hard stop per page-load; a render loop can't exceed it
const THROTTLE_MS = 2000; // at most one send every 2s

const seen = new Set();   // dedupe signatures for this page-load
let sent = 0;             // count toward SESSION_CAP
let lastSendAt = 0;       // throttle gate

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

// Stable-ish signature so an identical error firing in a loop is sent once, not 500x.
function signature(kind, message, stack) {
  const firstFrame = (stack || '').split('\n').find(l => l.includes('at ')) || '';
  return `${kind}::${message}::${firstFrame}`.slice(0, 300);
}

// The signed-in username, read from the JWT, best-effort. Never throws, never sends
// the token itself — only the derived name, for attribution.
function currentUserName() {
  try {
    const s = JSON.parse(localStorage.getItem('ht_session') || 'null');
    const b64 = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(b64)).email || '').split('@')[0] || null;
  } catch { return null; }
}

function accessToken() {
  try { return JSON.parse(localStorage.getItem('ht_session') || 'null')?.access_token || null; }
  catch { return null; }
}

// The actual POST. Fire-and-forget: no await upstream, and any failure is swallowed
// here so a dead network or a Supabase hiccup can never propagate into the app.
function post(row) {
  try {
    const token = accessToken();
    fetch(`${SB_URL}/rest/v1/client_errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SB_KEY,
        Authorization: `Bearer ${token || SB_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      keepalive: true,   // let the POST outlive a page that's unloading (error-on-navigate)
    }).catch(() => {});  // swallow — a failed log must never surface
  } catch { /* swallow — see rule 1 */ }
}

// Core entry. Safe to call from anywhere; guaranteed not to throw.
export function logError(err, { kind = 'error', context = '' } = {}) {
  try {
    if (sent >= SESSION_CAP) return;

    const now = Date.now();
    if (now - lastSendAt < THROTTLE_MS) return;

    const message = clip(
      (err && (err.message || err.reason?.message)) || String(err?.reason ?? err ?? 'Unknown error'),
      MSG_MAX,
    );
    const stack = clip(
      (err && (err.stack || err.reason?.stack)) || (context ? String(context) : ''),
      STACK_MAX,
    );

    const sig = signature(kind, message, stack);
    if (seen.has(sig)) return;   // identical error already reported this load
    seen.add(sig);

    lastSendAt = now;
    sent += 1;

    post({
      kind,
      message,
      stack,
      route: clip(location.hash || location.pathname, 256),
      user_name: currentUserName(),
      user_agent: clip(navigator.userAgent, 512),
      // eslint-disable-next-line no-undef
      app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
    });
  } catch { /* swallow — the sink must never throw */ }
}

// Registers global handlers. Call once, before render, so boot-time errors are caught.
let installed = false;
export function initErrorSink() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => logError(e.error || e.message, { kind: 'error' }));
  window.addEventListener('unhandledrejection', e => logError(e, { kind: 'unhandledrejection' }));
}
