// Chat feedback helpers — dislike-only. A rep flags a bad assistant reply and
// picks a reason; we store the whole exchange so the vote is reconstructable
// later instead of being an anonymous 👎. Mirrors receipts.js / errlog.js.
//
// Reporting also EVICTS the reply from the semantic cache. That used to be a
// manual chore, and skipping it was silent poison: the cache is checked before
// the agent runs, so a bad cached answer keeps being served and every prompt or
// RAG fix looks like it did nothing.
//
// This goes through the report_bad_answer RPC rather than a plain PostgREST
// insert, because semantic_cache carries no DELETE grant for authenticated —
// the rep who saw the bad answer is precisely the person who can't remove it.
// The function is SECURITY DEFINER and does both halves in one transaction, so
// there is no purge without an audit row and no report that quietly failed to
// purge. See db/chat-feedback.sql.
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

// The reply is NOT clipped to MSG_MAX on the way out. The cache stores the reply
// verbatim, so the displayed text is the key the purge matches on, and a clipped
// key matches nothing — the report would still be logged but the poisoned row
// would quietly survive. The server truncates for storage; this cap only exists
// so a runaway reply can't turn into a megabyte request.
const MATCH_MAX = 20000;

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

// Reports a bad answer and evicts it from the semantic cache. Resolves with the
// number of cache rows removed (0 when the reply was never cached); throws with
// the DB's message so the caller can show it — this is user-initiated, so unlike
// errlog it should NOT fail silently.
//
// userName/userId are deliberately not sent: the function stamps both from the
// JWT, because identity is the account, not a string the browser hands over.
export async function submitFeedback({
  sessionId, turnTs, userMessage, aiResponse, fromCache, reason, note,
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
      p_from_cache:   !!fromCache,
      p_reason:       reason,
      p_note:         clip((note || '').trim(), NOTE_MAX) || null,
    }),
  });

  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.message || `Couldn't send that (HTTP ${res.status})`);
  }
  // The RPC returns a bare integer. Treat anything unexpected as "no purge"
  // rather than claiming one that didn't happen.
  const purged = await res.json().catch(() => 0);
  return { purged: Number.isFinite(purged) ? purged : 0 };
}
