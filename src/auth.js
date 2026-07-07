// Supabase Auth (email/password) → JWT, with a localStorage session + silent refresh.
//
// The credential lives in Supabase Auth, NOT in this bundle — that's what makes the
// gate real. With RLS enabled (db/security-rls.sql), the anon/publishable key reads
// nothing; only a signed-in session's JWT can read data. A hardcoded password here
// would be pointless: anyone could read it in the shipped JS.

import { SB_URL, SB_KEY } from './config';

const DOMAIN = '@hitech.local';   // bare usernames ("sarim") map to sarim@hitech.local
const LS_KEY = 'ht_session';

const read  = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } };
const write = s  => localStorage.setItem(LS_KEY, JSON.stringify(s));

// Normalize a token response into a session with an absolute expiry (ms).
const toSession = d => ({
  access_token:  d.access_token,
  refresh_token: d.refresh_token,
  expires_at:    d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
});

export const loadSession = () => read();
export const isAuthed    = () => !!read()?.access_token;
export const signOut     = () => localStorage.removeItem(LS_KEY);

// Turn a phone number (or bare username) into the account's login email via the
// resolve_login_email RPC, so people can sign in with either their phone or email.
// Falls back to the legacy "username@hitech.local" mapping if nothing matches.
async function resolveLoginEmail(identifier) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/resolve_login_email`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (typeof d === 'string' && d) ? d : null;
  } catch { return null; }
}

export async function signIn(username, password) {
  const u = String(username).trim();
  let email;
  if (u.includes('@')) email = u;                               // already an email
  else email = (await resolveLoginEmail(u)) || `${u}${DOMAIN}`; // phone/username → account email
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    if (import.meta.env.DEV) console.error('[auth] sign-in failed', r.status, d);   // dev-only diagnostic
    throw new Error(d.error_description || d.msg || d.error || `Sign in failed (HTTP ${r.status})`);
  }
  const s = toSession(d);
  write(s);
  return s;
}

async function refresh(sess) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { signOut(); throw new Error('Session expired'); }
  const s = toSession(d);
  write(s);
  return s;
}

// Change the signed-in user's own password (GoTrue PUT /user with their JWT — no
// service key needed). Throws on failure.
export async function changePassword(newPassword) {
  const token = await getAccessToken();
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: newPassword }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.msg || d.error || `Couldn't change password (HTTP ${r.status})`);
  return true;
}

// Send a password-reset email. Accepts an email OR a phone number (resolved to the
// account email via resolve_login_email). The email link brings the user back to
// this site with a recovery session in the URL hash (see consumeRecoveryHash).
export async function requestPasswordReset(identifier) {
  const u = String(identifier).trim();
  const email = u.includes('@') ? u : (await resolveLoginEmail(u));
  if (!email) throw new Error("We couldn't find an account for that phone number or email.");
  const redirect = `${window.location.origin}/`;
  const r = await fetch(`${SB_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error_description || d.msg || d.error || `Couldn't send reset email (HTTP ${r.status})`);
  }
  return email;
}

// If the page was opened from a password-reset email, Supabase leaves a short-lived
// recovery session in the URL hash. Consume it: persist the session so changePassword
// works, scrub the URL, and return true so the app can show a "set new password" screen.
export function consumeRecoveryHash() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hash || '';
  if (!h.includes('type=recovery')) return false;
  const p = new URLSearchParams(h.replace(/^#/, ''));
  const access_token = p.get('access_token');
  if (!access_token) return false;
  write({
    access_token,
    refresh_token: p.get('refresh_token'),
    expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
  });
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

// Returns a valid access token, silently refreshing within 60s of expiry.
// Throws (and clears the session) if there's no usable session.
export async function getAccessToken() {
  let s = read();
  if (!s?.access_token) throw new Error('Not authenticated');
  if (Date.now() > s.expires_at - 60000) s = await refresh(s);
  return s.access_token;
}

// Decode the current session's user id (JWT `sub`). This is NOT a security check —
// it's only used to key per-user UI state (like AUP acceptance) in localStorage.
// The token is still verified server-side by Supabase on every data request.
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}
export function currentUserId() {
  const s = read();
  if (!s?.access_token) return null;
  try {
    return JSON.parse(b64urlDecode(s.access_token.split('.')[1])).sub || null;
  } catch { return null; }
}

// First-login Acceptable-Use acknowledgment, kept per-user in localStorage. Not a
// security boundary — just records that this person clicked "I Agree" on this device
// (and when), so we don't re-prompt every sign-in. Access itself is enforced by
// Supabase Auth + RLS regardless.
const aupKey = uid => `ht_aup_${uid}`;

// Fast, synchronous check of the local cache — used to avoid a loading flash when the
// user has already accepted on THIS device. A false result isn't final: checkAupAccepted
// then asks the server (they may have accepted on another device).
export function aupAccepted() {
  const uid = currentUserId();
  return uid ? !!localStorage.getItem(aupKey(uid)) : false;
}

// Authoritative, cross-device check. Local cache first (instant); on a miss, read the
// user's own app_users.aup_accepted_at (allowed by the self-read RLS policy) so accepting
// on any one device counts everywhere. Caches a hit locally. On network failure we return
// false → the gate shows, which is the safe/harmless default (accepting again just re-stamps).
export async function checkAupAccepted() {
  const uid = currentUserId();
  if (!uid) return false;
  if (localStorage.getItem(aupKey(uid))) return true;
  try {
    const token = await getAccessToken();
    const r = await fetch(
      `${SB_URL}/rest/v1/app_users?select=aup_accepted_at&user_id=eq.${uid}`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } },
    );
    const d = await r.json().catch(() => null);
    if (Array.isArray(d) && d[0]?.aup_accepted_at) {
      localStorage.setItem(aupKey(uid), d[0].aup_accepted_at);   // cache for next load
      return true;
    }
  } catch { /* offline → show the gate; harmless */ }
  return false;
}
export function recordAupAcceptance() {
  const uid = currentUserId();
  if (!uid) return;
  localStorage.setItem(aupKey(uid), new Date().toISOString());
  stampAupAcceptance();   // best-effort server-side audit stamp (non-blocking)
}

// Populate app_users.aup_accepted_at via the record_aup_acceptance RPC so there's a
// server-side record of who accepted, when. Audit-only — the gate decision itself is
// the localStorage flag above, so a network failure here never blocks the user.
async function stampAupAcceptance() {
  try {
    const token = await getAccessToken();
    await fetch(`${SB_URL}/rest/v1/rpc/record_aup_acceptance`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });
  } catch { /* audit-only; ignore */ }
}
