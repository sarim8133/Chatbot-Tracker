// Supabase Auth (email/password) → JWT, with a localStorage session + silent refresh.
//
// The credential lives in Supabase Auth, NOT in this bundle — that's what makes the
// gate real. With RLS enabled (db/security-rls.sql), the anon/publishable key reads
// nothing; only a signed-in session's JWT can read data. A hardcoded password here
// would be pointless: anyone could read it in the shipped JS.

const SB_URL = 'https://oocmjiuymmvwvyvwlfpd.supabase.co';
const SB_KEY = 'sb_publishable_c1l29L8ehKEmfreuQ-txcA_vv6vy06O';
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

export async function signIn(username, password) {
  const u = String(username).trim();
  const email = u.includes('@') ? u : `${u}${DOMAIN}`;
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    console.error('[auth] sign-in failed', r.status, d);   // open DevTools console to see the exact reason
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

// Returns a valid access token, silently refreshing within 60s of expiry.
// Throws (and clears the session) if there's no usable session.
export async function getAccessToken() {
  let s = read();
  if (!s?.access_token) throw new Error('Not authenticated');
  if (Date.now() > s.expires_at - 60000) s = await refresh(s);
  return s.access_token;
}
