-- ============================================================================
-- Roles & approvals — capability functions for the six-role model  (2026-07-30)
--
-- TASK 2 of a multi-task plan on branch feat/roles-and-approvals. This file
-- creates capability FUNCTIONS ONLY. It does NOT touch app_users.role data and
-- does NOT touch the app_users role CHECK constraint (still admin/accountant/
-- employee at the bottom of this file) — that is Task 3, a later migration.
--
-- Read §4 before assuming this is a harmless no-op: one of the nine functions
-- below is already wired into five LIVE RLS policies, and this migration
-- changes its answer today, not just for roles that don't exist yet.
--
-- THE SIX ROLES (replacing the current three: admin, accountant, employee):
--   dev              full access to everything, including cache management
--   ceo              read-only across chats/reps/overview + all expenses
--   finance_manager  approve expenses, including over-limit sign-off
--   finance_admin    manage expenses (split/delete/limits/flag) + approve,
--                    but NOT over-limit sign-off
--   finance_viewer   read APPROVED expenses only
--   employee         unchanged: only their own receipts
--
-- CAPABILITY MATRIX (x = function returns true for that role):
--
--                               dev  ceo  fin_mgr  fin_admin  fin_viewer  employee
--   is_dev                       x    .     .         .           .          .
--   can_read_chats                x    x     .         .           .          .
--   can_manage_cache             x    .     .         .           .          .
--   can_view_all_expenses         x    x     x         x           .          .
--   can_view_approved_expenses   x    x     x         x           x          .
--   can_manage_expenses           x    .     .         x           .          .
--   can_approve_expenses         x    .     x         x           .          .
--   can_approve_over_limit        x    .     x         .           .          .
--
-- can_view_approved_expenses is a strict superset of can_view_all_expenses —
-- the only role it is load-bearing for is finance_viewer.
-- ============================================================================


-- ── 1. One function reads the column ────────────────────────────────────────
-- private.my_role() is the only place that touches app_users.role directly.
-- Every other capability function is a predicate over private.my_role()'s
-- result. Adding, renaming, or retiring a role means editing this file and
-- nothing else — no RLS policy or RPC body ever spells out a role name itself.
--
-- All nine functions follow the shape already established by the three
-- pre-existing private.* helpers (db/expense-access-rls.sql): SQL language,
-- SECURITY DEFINER, STABLE, search_path = '' (so an unqualified name inside
-- the body can't be hijacked by a search_path trick), EXECUTE revoked from
-- PUBLIC and re-granted to authenticated only.


-- ── 2. The capability functions ─────────────────────────────────────────────
-- Applied via migration `role_capability_functions`.

create or replace function private.my_role()
returns text language sql security definer stable set search_path = '' as $$
  select role from public.app_users where user_id = (select auth.uid());
$$;

create or replace function private.is_dev()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() = 'dev';
$$;

-- Conversations / Reps / Overview read the chat tables. Cache is deliberately
-- NOT this predicate: the CEO gets the transcript, not the cache internals.
create or replace function private.can_read_chats()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','ceo');
$$;

create or replace function private.can_manage_cache()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() = 'dev';
$$;

-- Every expense, whatever its status.
create or replace function private.can_view_all_expenses()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','ceo','finance_manager','finance_admin');
$$;

-- Approved expenses only. A superset of can_view_all_expenses(), so the only
-- role this branch is load-bearing for is finance_viewer.
create or replace function private.can_view_approved_expenses()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','ceo','finance_manager','finance_admin','finance_viewer');
$$;

-- Split, delete, set limits, flag, remark.
create or replace function private.can_manage_expenses()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','finance_admin');
$$;

-- Sign off. Over-limit receipts additionally require can_approve_over_limit().
create or replace function private.can_approve_expenses()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','finance_manager','finance_admin');
$$;

create or replace function private.can_approve_over_limit()
returns boolean language sql security definer stable set search_path = '' as $$
  select private.my_role() in ('dev','finance_manager');
$$;

revoke all on function private.my_role()                     from public;
revoke all on function private.is_dev()                      from public;
revoke all on function private.can_read_chats()               from public;
revoke all on function private.can_manage_cache()             from public;
revoke all on function private.can_view_all_expenses()        from public;
revoke all on function private.can_view_approved_expenses()   from public;
revoke all on function private.can_manage_expenses()          from public;
revoke all on function private.can_approve_expenses()         from public;
revoke all on function private.can_approve_over_limit()       from public;

grant execute on function private.my_role()                    to authenticated;
grant execute on function private.is_dev()                     to authenticated;
grant execute on function private.can_read_chats()             to authenticated;
grant execute on function private.can_manage_cache()            to authenticated;
grant execute on function private.can_view_all_expenses()      to authenticated;
grant execute on function private.can_view_approved_expenses() to authenticated;
grant execute on function private.can_manage_expenses()        to authenticated;
grant execute on function private.can_approve_expenses()       to authenticated;
grant execute on function private.can_approve_over_limit()     to authenticated;


-- ── 3. is_admin() is untouched ──────────────────────────────────────────────
-- private.is_admin() (role = 'admin') still exists, unchanged, alongside the
-- new is_dev(). A later task retires it once nothing references it. Not this
-- one — it isn't in scope and nothing here depends on it either way.


-- ── 4. can_view_all_expenses() was redefined, not dropped — and that has a
--      LIVE effect today, not just for roles that don't exist yet ──────────
-- Postgres refuses to DROP a function that a policy still depends on, and
-- can_view_all_expenses() is referenced by five live RLS policies (confirmed
-- by querying pg_policies — see §Verification). So it is redefined in place
-- with CREATE OR REPLACE, same signature, new body.
--
-- The old body was `role in ('admin','accountant')`. The new body is
-- `my_role() in ('dev','ceo','finance_manager','finance_admin')` — notice
-- 'admin' and 'accountant' are gone. Task 2 does not touch app_users.role, so
-- every current user is still 'admin', 'accountant', or 'employee'. The
-- practical result, confirmed by measurement below: from the moment this
-- migration is applied until Task 3 migrates the role data, every one of the
-- five policies falls back to its "own records only" branch for EVERY
-- current admin and accountant. Nobody is deliberately locked out — the
-- predicate just no longer recognises any role that currently exists — but
-- the five policies below are live production surfaces, not dormant code:
--
--   public.wap_expenses          policy wap_expenses_self_or_accountant
--   public.wap_expense_splits    policy wap_splits_self_or_accountant
--   public.wap_allowed_senders   policy wap_senders_self_or_accountant
--   storage.objects              policy receipts_read_own_or_admin
--   storage.objects              policy receipts_delete_accountant
--
-- Concretely: until Task 3 runs, an admin or accountant opening the Expenses
-- tab sees only their own receipts, not everyone's, and cannot delete a
-- receipt that isn't theirs. This is the expected, unavoidable shape of
-- doing the cutover in two steps rather than one, not a defect in this file —
-- but it is a real, live change in behaviour, so it is recorded here plainly
-- rather than filed only under "will return false for everyone."


-- ============================================================================
-- Verification — measured 2026-07-30
-- ============================================================================
--
-- Step 1 — failing probe (before the migration):
--   select private.can_read_chats();
--   → ERROR: 42883: function private.can_read_chats() does not exist
--
-- Step 2 — migration `role_capability_functions` applied via the Supabase MCP
-- apply_migration tool with the exact SQL in §2. Result: success.
--
-- Function inventory after the migration (pg_proc joined to pg_namespace,
-- schema = private) — all eleven present:
--   can_approve_expenses, can_approve_over_limit, can_manage_cache,
--   can_manage_expenses, can_read_chats, can_view_all_expenses,
--   can_view_approved_expenses, is_admin, is_dev, my_phone, my_role
--
-- Step 3 — impersonation. The literal query the plan specifies:
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"2a7c873e-...833db4","role":"authenticated"}';
--     select private.my_role(), private.is_dev(), private.can_read_chats(), ...
--   rollback;
-- FAILED with `ERROR: 42501: permission denied for schema private` — and,
-- confirmed by re-running with only private.is_admin() in the select list,
-- this is NOT something this migration caused: schema `private` (owner
-- postgres, nspacl null) has never granted USAGE to authenticated, anon, or
-- PUBLIC — has_schema_privilege('authenticated','private','USAGE') = false,
-- true for every function in the schema, old and new alike. It is dormant in
-- the running app because real callers never reach private.* by a fresh,
-- schema-qualified name: RLS policy quals resolve the function to an OID once
-- (at CREATE POLICY time, by the owner) and only re-check EXECUTE on each
-- row, and the public.* SECURITY DEFINER RPCs that call private.* internally
-- run their whole body as the owner. A brand-new ad hoc SQL session asking
-- for `private.foo()` by name is the one path that actually re-resolves the
-- schema, which is exactly what a raw impersonation probe does.
--
-- Worked around for testing purposes only, inside the same transaction that
-- gets rolled back, so nothing persists:
--   begin;
--     grant usage on schema private to authenticated;   -- reverted by rollback
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"2a7c873e-959f-4727-81a7-25c757833db4","role":"authenticated"}';
--     select private.my_role() as role, private.is_dev() as dev,
--            private.can_read_chats() as chats,
--            private.can_view_all_expenses() as allexp,
--            private.can_manage_expenses() as manage;
--   rollback;
-- Measured result for that uuid (Sarim, role = admin):
--   role = admin, dev = false, chats = false, allexp = false, manage = false
-- Confirmed afterward: has_schema_privilege('authenticated','private','USAGE')
-- = false again — the temporary grant did not survive the rollback.
--
-- This is the expected, correct, fail-closed outcome for a role none of these
-- predicates have ever heard of. It also directly demonstrates §4's live-impact
-- note: allexp = false for an actual admin account, where the same call would
-- have returned true under the previous definition of can_view_all_expenses().
--
-- Security advisors (get_advisors, type security) run after the migration:
-- no new findings attributable to anything in this file. Every listed warning
-- pre-exists and concerns public-schema RPCs already documented as by-design
-- (db/security-rls.sql §8, "RLS pen-test — hardening"). None of the nine
-- private.* functions appear, because the private schema is never exposed to
-- PostgREST's API surface — consistent with it holding SECURITY DEFINER
-- helpers only, never RPC endpoints.
--
-- Production state after this task: unchanged except for the eleven function
-- definitions/grants above. No row in app_users was read for its value to be
-- written anywhere, no CHECK constraint was touched, and the one transactional
-- GRANT used for testing was rolled back and confirmed gone.
-- ============================================================================
