import { createClient } from 'jsr:@supabase/supabase-js@2';

// Admin-only user management: deactivate (ban login), activate (unban), or delete a
// login. For employees it also flips their WhatsApp roster active flag. The caller's
// JWT is verified and their dev role checked; a dev cannot deactivate/delete
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

// supabase-js does not always get a message out of GoTrue. Its fallback is
// JSON.stringify(body), so an error body it doesn't recognise -- which is what a
// Postgres failure inside the admin delete looks like -- arrives here as the
// literal two-character string "{}". Returning that verbatim is exactly how
// "delete user" came to fail with a bare {} on screen and no way to guess why.
const describe = (e: { message?: string } | null | undefined, fallback: string) => {
  const m = (e?.message || '').trim();
  return !m || m === '{}' || m === '[object Object]' ? fallback : m;
};

// Every column that points at a person, and the table it lives on. user_id ->
// app_users; created_by / deleted_by -> auth.users directly. Kept in step with
// db/2026-08-26-user-delete-fks.sql -- that migration discovers them from
// pg_constraint, which this cannot do over PostgREST, so this list is the one
// place a new referencing column has to be added by hand. Miss one and the
// delete fails with a 23503 that names it, which blockedByMessage() surfaces.
const PERSON_REFS: Array<[table: string, column: string]> = [
  ['n8n_chat_histories',    'user_id'],
  ['web_chat_histories',    'user_id'],
  ['chat_archive',          'user_id'],
  ['wap_expenses',          'user_id'],
  ['wap_expense_splits',    'user_id'],
  ['wap_expense_splits',    'created_by'],
  ['wap_expense_deletions', 'deleted_by'],
];

// Could this failure be a lingering reference to the person?
//
// You cannot ask directly, because GoTrue redacts the answer. It only returns the
// real Postgres error to clients that DON'T send X-Supabase-Api-Version -- and
// supabase-js always sends it. Same delete, same second, two different bodies:
//
//   curl, no version header   {"code":"23503","message":"update or delete on table
//                              \"app_users\" violates foreign key constraint
//                              \"n8n_chat_histories_user_id_fkey\" ..."}
//   supabase-js (with header) {"code":"unexpected_failure",
//                              "message":"Database error deleting user"}
//
// So in here a foreign-key violation is indistinguishable from any other server-side
// delete failure, and matching on "23503" -- which is what the first version of this
// did -- matches nothing. Treat the opaque form as a maybe: attempting the detach
// costs one pass over seven tables and is harmless if the cause was something else,
// because the retry then fails identically and gets reported.
const mayBeBlockedByReference = (e: { code?: string; message?: string } | null | undefined) => {
  const m = e?.message || '';
  return e?.code === '23503' || e?.code === 'unexpected_failure'
    || /23503|violates foreign key constraint|database error deleting user/i.test(m);
};

// The unredacted form names the table. Use it when it's there -- an unknown
// referencing column then identifies itself instead of being another dead end.
const blockedByMessage = (e: { message?: string } | null | undefined, detached: string[]) => {
  const t = /on table "([^"]+)"/.exec(e?.message || '');
  if (t) {
    return `Still referenced by "${t[1]}" — add it to PERSON_REFS in admin-manage-user ` +
           `and to db/2026-08-26-user-delete-fks.sql. You can deactivate them instead.`;
  }
  return 'The database refused the delete, and GoTrue will not say which table is ' +
         `holding on. Already detached: ${detached.join(', ') || 'nothing'}. Check the ` +
         'function logs, run db/2026-08-26-user-delete-fks.sql, or deactivate them instead.';
};

// Null out every reference to this person. Returns what it actually touched.
async function detachReferences(
  admin: ReturnType<typeof createClient>,
  target: string,
): Promise<string[]> {
  const touched: string[] = [];
  for (const [table, column] of PERSON_REFS) {
    const { error, count } = await admin
      .from(table)
      .update({ [column]: null }, { count: 'exact' })
      .eq(column, target);
    // A table that does not exist in this project is not a problem -- it just
    // has nothing to detach. Anything else is worth seeing in the logs.
    if (error) console.warn(`detachReferences: ${table}.${column} -> ${error.message}`);
    else if (count) touched.push(`${table}.${column} (${count})`);
  }
  return touched;
}

const BAN = '876000h';   // ~100 years

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- authorize: caller must be a dev ---
  // 'dev' is the 2026-07-30 rename of 'admin'. This string and the CHECK
  // constraint on app_users.role must move together: while they disagreed, this
  // function 403'd for everyone (nobody holds 'admin' any more) and the Team tab
  // could list and edit people but not create or deactivate them.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing token' }, 401);
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !u?.user) return json({ error: 'Invalid session' }, 401);
  const { data: prof } = await admin.from('app_users').select('role').eq('user_id', u.user.id).maybeSingle();
  if (prof?.role !== 'dev') return json({ error: 'Not authorized (devs only)' }, 403);

  // --- input ---
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }
  const target = String(b.target || '');
  const action = String(b.action || '');
  if (!target) return json({ error: 'Missing target' }, 400);
  if (!['deactivate', 'activate', 'delete'].includes(action)) return json({ error: 'Invalid action' }, 400);
  if (target === u.user.id && action !== 'activate') {
    return json({ error: "You can't deactivate or delete your own dev account." }, 400);
  }

  // target's phone (to flip their WhatsApp roster too)
  const { data: tprof } = await admin.from('app_users').select('phone').eq('user_id', target).maybeSingle();
  const phone = tprof?.phone as string | undefined;

  if (action === 'deactivate') {
    const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: BAN });
    if (error) return json({ error: describe(error, 'Could not deactivate this account.') }, 400);
    if (phone) await admin.from('wap_allowed_senders').update({ active: false }).eq('phone', phone);
    return json({ ok: true });
  }

  if (action === 'activate') {
    const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: 'none' });
    if (error) return json({ error: describe(error, 'Could not reactivate this account.') }, 400);
    if (phone) await admin.from('wap_allowed_senders').update({ active: true }).eq('phone', phone);
    return json({ ok: true });
  }

  // delete
  //
  // app_users is ON DELETE CASCADE off auth.users, so removing the login also
  // removes the profile row -- and everything that points at that profile row
  // has to be willing to let go. db/2026-08-26-user-delete-fks.sql makes those
  // FKs ON DELETE SET NULL, which is the real fix and the one that also makes
  // deleting from the Supabase dashboard work.
  //
  // Until it has been run those FKs are ON DELETE NO ACTION, and a single chat
  // message is enough for Postgres to veto the delete with 23503. So: try the
  // plain delete first, and only if it comes back 23503 detach the references by
  // hand and try once more. With the migration applied this costs nothing (the
  // first attempt succeeds); without it, deleting still works.
  if (phone) await admin.from('wap_allowed_senders').update({ active: false }).eq('phone', phone);

  let { error } = await admin.auth.admin.deleteUser(target);
  let detached: string[] = [];

  if (error && mayBeBlockedByReference(error)) {
    // SET NULL, never delete. The chat log and wap_expenses are audit records --
    // the conversation history and the money trail have to outlive the account,
    // and they still carry sender_phone / employee_name to say whose they were.
    detached = await detachReferences(admin, target);
    console.warn(
      `admin-manage-user: delete of ${target} was refused ("${error.message}") -- detached ` +
      `${detached.join(', ') || 'nothing'} by hand and retrying. ` +
      `Run db/2026-08-26-user-delete-fks.sql to fix this properly.`,
    );
    ({ error } = await admin.auth.admin.deleteUser(target));
  }

  if (error) {
    // Never pass GoTrue's own text through here: "Database error deleting user" is
    // all it says, and it is exactly as actionable as the {} it replaced.
    return json({ error: blockedByMessage(error, detached) }, 400);
  }
  return json({ ok: true });
});
