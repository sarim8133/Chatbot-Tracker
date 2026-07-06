import { createClient } from 'jsr:@supabase/supabase-js@2';

// Admin-only user management: deactivate (ban login), activate (unban), or delete a
// login. For employees it also flips their WhatsApp roster active flag. The caller's
// JWT is verified and their admin role checked; an admin cannot deactivate/delete
// their own account (no self-lockout).
//
// Deploy: supabase functions deploy admin-manage-user --no-verify-jwt

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const BAN = '876000h';   // ~100 years

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
  const target = String(b.target || '');
  const action = String(b.action || '');
  if (!target) return json({ error: 'Missing target' }, 400);
  if (!['deactivate', 'activate', 'delete'].includes(action)) return json({ error: 'Invalid action' }, 400);
  if (target === u.user.id && action !== 'activate') {
    return json({ error: "You can't deactivate or delete your own admin account." }, 400);
  }

  // target's phone (to flip their WhatsApp roster too)
  const { data: tprof } = await admin.from('app_users').select('phone').eq('user_id', target).maybeSingle();
  const phone = tprof?.phone as string | undefined;

  if (action === 'deactivate') {
    const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: BAN });
    if (error) return json({ error: error.message }, 400);
    if (phone) await admin.from('wap_allowed_senders').update({ active: false }).eq('phone', phone);
    return json({ ok: true });
  }

  if (action === 'activate') {
    const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: 'none' });
    if (error) return json({ error: error.message }, 400);
    if (phone) await admin.from('wap_allowed_senders').update({ active: true }).eq('phone', phone);
    return json({ ok: true });
  }

  // delete
  if (phone) await admin.from('wap_allowed_senders').update({ active: false }).eq('phone', phone);
  const { error } = await admin.auth.admin.deleteUser(target);   // app_users cascades
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
