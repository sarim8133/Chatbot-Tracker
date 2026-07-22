// Chat feedback helpers — dislike-only. A rep flags a bad assistant reply and
// picks a reason; we store the whole exchange so the vote is reconstructable
// later instead of being an anonymous 👎. Mirrors receipts.js / errlog.js.
//
// Writes go straight to PostgREST with the caller's JWT (the chat_feedback
// insert policy is `to authenticated`), so a signed-out browser can't post.
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

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

// Reports a bad answer. Resolves on success, throws with the DB's message so the
// caller can show it — this is user-initiated, so unlike errlog it should NOT
// fail silently.
export async function submitFeedback({
  sessionId, turnTs, userMessage, aiResponse, fromCache, reason, note, userName, userId,
}) {
  if (!reason) throw new Error('Pick a reason first.');
  const token = await getAccessToken();

  const res = await fetch(`${SB_URL}/rest/v1/chat_feedback`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      session_id:   sessionId || null,
      channel:      'web',
      turn_ts:      turnTs ? new Date(turnTs).toISOString() : null,
      user_message: clip(userMessage, MSG_MAX),
      ai_response:  clip(aiResponse,  MSG_MAX),
      from_cache:   !!fromCache,
      reason,
      note:         clip((note || '').trim(), NOTE_MAX) || null,
      user_name:    userName || null,
      user_id:      userId   || null,
    }),
  });

  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.message || `Couldn't send that (HTTP ${res.status})`);
  }
  return true;
}
