// Central Supabase config, sourced from Vite env vars (.env locally; host env in
// production) so the key isn't hardcoded in committed source. SB_KEY is a
// PUBLISHABLE/anon key — safe to expose in the bundle; RLS is what actually
// protects the data (see db/security-rls.sql). Rotate it in Supabase if needed.
export const SB_URL = import.meta.env.VITE_SB_URL;
export const SB_KEY = import.meta.env.VITE_SB_KEY;

// Dashboard reads the chat_all view (live n8n_chat_histories ∪ chat_archive).
// See db/chat-archive.sql.
export const MSG_SOURCE = 'chat_all';

// n8n web-chat webhook — the Chat tab POSTs messages here; n8n runs the assistant
// (same workflow as the WhatsApp bot) and returns the reply. The URL isn't a
// secret, but keeping it in env lets prod/staging differ. Empty → the Chat tab
// shows a "not configured" notice instead of erroring.
export const N8N_CHAT_WEBHOOK = import.meta.env.VITE_N8N_CHAT_WEBHOOK || '';

// n8n web receipt webhook — the Chat tab's image upload POSTs here (action:'extract'
// then action:'save'). Separate from the chat webhook. Empty → the attach button is
// hidden. See docs/superpowers/specs/2026-07-06-web-receipt-upload-design.md.
export const N8N_RECEIPT_WEBHOOK = import.meta.env.VITE_N8N_RECEIPT_WEBHOOK || '';

// Web-chat history table — separate from the WhatsApp n8n_chat_histories so web
// traffic never distorts the rep analytics. See db/web-chat.sql.
export const WEB_CHAT_SOURCE = 'web_chat_histories';
