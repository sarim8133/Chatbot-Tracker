import { createClient } from 'jsr:@supabase/supabase-js@2';

// Creates a dashboard login + writes app_users (role/identity) and, for employees,
// the wap_allowed_senders roster row. Admin-only: the caller's JWT is verified and
// their role checked before anything is created. verify_jwt is disabled at the
// platform layer because we do custom auth here (and browsers send an unauthenticated
// CORS preflight); the admin check below is the real gate.
//
// Deploy:  supabase functions deploy admin-create-user --no-verify-jwt
// (or via the Supabase MCP deploy_edge_function with verify_jwt: false)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DOMAIN = '@hitech.local';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- authorize: caller must be an admin ---
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing token' }, 401);
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !u?.user) return json({ error: 'Invalid session' }, 401);
  const { data: prof } = await admin.from('app_users').select('role').eq('user_id', u.user.id).maybeSingle();
  if (prof?.role !== 'admin') return json({ error: 'Not authorized (admins only)' }, 403);

  // --- input ---
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }
  const role = String(b.role || '').trim();
  const password = String(b.password || '');
  const fullName = String(b.full_name || '').trim();
  const department = String(b.department || '').trim();
  const realEmail = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').replace(/[^0-9]/g, '');

  if (!['admin', 'accountant', 'employee'].includes(role)) return json({ error: 'Pick a valid role' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!fullName) return json({ error: 'Name is required' }, 400);
  if (role === 'employee' && !phone) return json({ error: 'Employees need a WhatsApp phone number (their identity)' }, 400);
  if (!realEmail && !phone) return json({ error: 'Provide an email or a phone number' }, 400);
  if (realEmail && !realEmail.includes('@')) return json({ error: 'Email looks invalid' }, 400);

  // login email = their real email if given, else a synthetic phone address
  const loginEmail = realEmail || `${phone}${DOMAIN}`;

  // --- create the auth login ---
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: loginEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (cErr || !created?.user) return json({ error: cErr?.message || 'Could not create login' }, 400);
  const newId = created.user.id;

  // --- app_users identity row ---
  const { error: mErr } = await admin.from('app_users').insert({
    user_id: newId,
    role,
    phone: role === 'employee' ? phone : null,
    email: realEmail || null,
    full_name: fullName,
    department: department || null,
  });
  if (mErr) {
    await admin.auth.admin.deleteUser(newId); // avoid an orphan login
    const dup = /duplicate|unique/i.test(mErr.message);
    return json({ error: dup ? 'That phone number is already assigned to someone.' : ('Failed to save profile: ' + mErr.message) }, 400);
  }

  // --- WhatsApp roster row so employees can submit receipts ---
  let warning: string | undefined;
  if (role === 'employee' && phone) {
    const { error: rErr } = await admin.from('wap_allowed_senders')
      .insert({ phone, employee_name: fullName, department: department || 'General', active: true });
    if (rErr && !/duplicate|unique/i.test(rErr.message)) {
      warning = 'Login created, but the WhatsApp roster entry failed: ' + rErr.message;
    }
  }

  return json({ ok: true, user_id: newId, login_email: loginEmail, warning });
});
