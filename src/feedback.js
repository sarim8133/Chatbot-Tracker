// Chat feedback helpers — dislike-only. A rep flags a bad assistant reply and
// picks a reason; we store the whole exchange so the vote is reconstructable
// later instead of being an anonymous 👎. Mirrors receipts.js / errlog.js.
//
// The semantic cache has been removed from the n8n workflows, so a report is now
// purely a log entry — there is no cached copy left to evict.
//
// This still goes through the report_bad_answer RPC rather than a plain
// PostgREST insert: the function is SECURITY DEFINER and stamps the reporter
// from the JWT, and chat_feedback carries no INSERT grant for authenticated.
// See db/chat-feedback.sql.
import { SB_URL, SB_KEY } from './config';
import { getAccessToken } from './auth';

// Preset tags. Free text alone gets skipped, so the tag is what makes a report
// countable; the note is optional colour on top. Ordered by how often we expect
// them, since the picker renders in this order.
export const REASONS = [
  { id: 'wrong_machine',  label: 'Wrong machine' },
  { id: 'missing_specs',  label: 'Missing / wrong specs' },
  { id: 'made_up',        label: 'Made it up' },
  { id: 'misunderstood',  label: "Didn't understand me" },
  { id: 'wrong_language', label: 'Wrong language' },
  { id: 'other',          label: 'Other' },
];

export const REASON_LABEL = Object.fromEntries(REASONS.map(r => [r.id, r.label]));

// Keep rows bounded — a reply with a dozen spec sheets can run long, and the
// note is free text from a frustrated user.
const MSG_MAX  = 4000;
const NOTE_MAX = 500;

// The reply is NOT clipped to MSG_MAX on the way out — the server truncates for
// storage, and this larger cap only exists so a runaway reply can't turn into a
// megabyte request.
const MATCH_MAX = 20000;

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

// Reports a bad answer. Throws with the DB's message so the caller can show it —
// this is user-initiated, so unlike errlog it should NOT fail silently.
//
// userName/userId are deliberately not sent: the function stamps both from the
// JWT, because identity is the account, not a string the browser hands over.
export async function submitFeedback({
  sessionId, turnTs, userMessage, aiResponse, reason, note,
}) {
  if (!reason) throw new Error('Pick a reason first.');
  const token = await getAccessToken();

  const res = await fetch(`${SB_URL}/rest/v1/rpc/report_bad_answer`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_session_id:   sessionId || null,
      p_turn_ts:      turnTs ? new Date(turnTs).toISOString() : null,
      p_user_message: clip(userMessage, MSG_MAX),
      p_ai_response:  clip(aiResponse,  MATCH_MAX),
      p_reason:       reason,
      p_note:         clip((note || '').trim(), NOTE_MAX) || null,
    }),
  });

  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.message || `Couldn't send that (HTTP ${res.status})`);
  }
}
