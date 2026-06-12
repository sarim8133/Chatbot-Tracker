// Central Supabase config, sourced from Vite env vars (.env locally; host env in
// production) so the key isn't hardcoded in committed source. SB_KEY is a
// PUBLISHABLE/anon key — safe to expose in the bundle; RLS is what actually
// protects the data (see db/security-rls.sql). Rotate it in Supabase if needed.
export const SB_URL = import.meta.env.VITE_SB_URL;
export const SB_KEY = import.meta.env.VITE_SB_KEY;

// Dashboard reads the chat_all view (live n8n_chat_histories ∪ chat_archive).
// See db/chat-archive.sql.
export const MSG_SOURCE = 'chat_all';
