// RPC wrappers for the expense approval workflow. Kept out of
// mawavia-dashboard.jsx, which is already 5,000 lines.
//
// None of these is a permission check. Each RPC re-checks the caller's
// capability server-side and raises 42501, so calling one you are not entitled
// to fails at the database, not here. What the UI does with capsFor() is decide
// which buttons to draw.
import { SB_URL, SB_KEY } from './config';
import { getAccessToken } from './auth';

async function rpc(name, args) {
  const token = await getAccessToken();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    // Postgres RAISE messages here are written for the person reading them
    // ("only the finance manager can approve it", "you cannot approve your own
    // expense"), so surface them rather than replacing them with a generic
    // failure. The distinction matters: one of those is a rule the user should
    // learn, not an error they should retry.
    throw new Error(d.message || d.hint || `Request failed (HTTP ${r.status})`);
  }
  return r.json().catch(() => null);
}

export const addRemark = (id, body, visible = true) =>
  rpc('expense_add_remark', { p_expense_id: id, p_body: body, p_visible: visible });

export const setFlag = (id, flagged, reason) =>
  rpc('expense_set_flag', { p_expense_id: id, p_flagged: flagged, p_reason: reason || null });

export const submitForApproval = (id, note) =>
  rpc('expense_submit_for_approval', { p_expense_id: id, p_note: note || null });

export const approve = (id, note) =>
  rpc('expense_approve', { p_expense_id: id, p_note: note || null });

export const revokeApproval = (id, reason) =>
  rpc('expense_revoke_approval', { p_expense_id: id, p_reason: reason || null });

export const reject = (id, reason) =>
  rpc('expense_reject', { p_expense_id: id, p_reason: reason });

export const recheckLimit = id =>
  rpc('expense_recheck_limit', { p_expense_id: id });

// Status vocabulary, shared by the badge and the filter chips. Keys match the
// CHECK constraint on wap_expenses.status exactly.
//
// 'logged' is labelled "Submitted" rather than "Logged": it is what n8n writes
// on intake, and to the person who sent the photo it means "received, nothing
// has happened to it yet".
export const STATUS_META = {
  logged:           { label: 'Submitted',         tone: 'muted' },
  pending_approval: { label: 'Awaiting approval', tone: 'warn'  },
  approved:         { label: 'Approved',          tone: 'pos'   },
  rejected:         { label: 'Rejected',          tone: 'neg'   },
};

// Past-tense verbs for the event trail, so a row reads as a sentence:
// "Mawavia left a remark · 29 Jul".
export const EVENT_VERB = {
  remark:              'left a remark',
  flag:                'flagged this',
  unflag:              'cleared the flag',
  submit_for_approval: 'sent this for approval',
  approve:             'approved',
  revoke_approval:     'revoked the approval',
  reject:              'rejected',
};
