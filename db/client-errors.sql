-- ============================================================================
-- Hi-Tech dashboard — client-side error sink
-- ----------------------------------------------------------------------------
-- The frontend had zero error visibility: errors were shown to the user but
-- recorded nowhere. src/errlog.js POSTs window.onerror / unhandledrejection /
-- React-boundary crashes here for later review in the Supabase dashboard.
--
-- Insert is open (errors can fire before login, so no JWT is required); reads are
-- admin-only via private.is_admin(), matching the other admin_read tables
-- (chat_archive, web_chat_histories, semantic_cache, ...). Client-side flood
-- control (dedupe + per-load cap + throttle + truncation) bounds the volume so a
-- render loop can't turn an open insert endpoint into a DoS. See src/errlog.js and
-- docs/superpowers/specs/2026-07-16-client-error-sink-design.md.
--
-- Applied 2026-07-16 via Supabase MCP migration `create_client_errors_sink`.
-- This file is the checked-in record; the live schema is the source of truth.
-- ============================================================================

create table if not exists public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null,                 -- 'error' | 'unhandledrejection' | 'react'
  message     text,
  stack       text,
  route       text,
  user_name   text,
  user_agent  text,
  app_version text
);

comment on table public.client_errors is
  'Frontend error sink (window.onerror / unhandledrejection / React boundary). Insert-only for clients; admin-read. Client-side flood control caps volume; see src/errlog.js.';

create index if not exists client_errors_created_at_idx
  on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Anyone (anon or authenticated) may report an error. No read-back is granted, and
-- the client truncates payloads, so an open insert endpoint carries low risk.
create policy client_errors_insert
  on public.client_errors for insert
  to anon, authenticated
  with check (true);

-- Only devs can read the log.
--
-- REPOINTED 2026-07-30 (migration `client_errors_read_by_dev_and_retire_is_admin`).
-- This policy used to gate on private.is_admin(), which tested role = 'admin' --
-- a value no row has held since the six-role migration renamed admin -> dev. The
-- policy was still there, still enabled, and matched NOBODY, so the frontend
-- error log silently became unreadable to everyone including the dev. Nothing
-- errored; the panel just showed nothing, which is indistinguishable from "no
-- errors have happened".
--
-- It was missed because the role migration swept the tables listed in
-- db/security-rls.sql, and this table was created later and never added to that
-- list. Found only when `drop function private.is_admin()` refused, naming this
-- policy as the last dependency -- which is exactly why that drop is worth
-- attempting: a function that cannot be dropped is telling you what you forgot.
--
-- is_dev() rather than can_read_chats(): this is a stack-trace sink for
-- debugging the app. The CEO reads business analytics, not React stack traces.
-- Verified by probe: dev sees an inserted row, ceo sees 0.
create policy client_errors_read
  on public.client_errors for select
  to authenticated
  using (private.is_dev());
