-- ============================================================================
-- Access control + unified identity   (updated 2026-07-25)
--
-- IDENTITY IS THE ACCOUNT: wap_expenses.user_id -> app_users.user_id, stamped
-- on every receipt by both intake workflows. Neither the name nor the phone
-- survives as a key:
--   • the name is written from a hand-maintained table and its casing drifts
--     (the same person arrived as "Sarim" from the web and "sarim" from
--     WhatsApp, and totalled up as two people)
--   • the phone is typed by hand in two places in two formats (03… vs 923…),
--     and web uploads carried sender_phone = null for weeks
-- Both are still stamped, for display and for senders who have no login.
--
-- Where a person appears:
--   app_users.user_id          (login identity — the key)
--   app_users.phone            (login by phone; budgets still key on this)
--   wap_allowed_senders.phone  (WhatsApp roster: may submit + spending_limit)
--   wap_expenses.user_id       (stamped on each receipt — written by n8n)
--
-- Roles (in app_users):
--   admin      : full site (all tabs) + everyone's expenses + the Team panel
--   accountant : everyone's expenses + sales tabs
--   employee   : only receipts that are theirs (user_id, or phone for rows
--                submitted by a roster number that belongs to no account)
--
-- Login: people sign in with EITHER their email OR their phone number
--   (resolve_login_email turns a phone into the account email; see auth.js).
-- Isolation is enforced in RLS below — a crafted REST call can't cross it.
-- Verified 2026-07-05: admin/accountant→all, employee→own by phone (0 leaked).
-- ============================================================================

-- 1) Roles / identity table -------------------------------------------------
create table if not exists public.app_users (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'employee' check (role in ('admin','accountant','employee')),
  phone         text,          -- WhatsApp number = identity key (employees)
  email         text,          -- their real email (for display / email login)
  full_name     text,          -- display name
  department    text,
  employee_name text,          -- legacy label (no longer used by RLS)
  created_at    timestamptz not null default now()
);
alter table public.app_users enable row level security;
create unique index if not exists app_users_phone_key on public.app_users (phone) where phone is not null;

drop policy if exists app_users_self_read on public.app_users;
create policy app_users_self_read on public.app_users
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.app_users to authenticated;

-- 2) Private helpers (SECURITY DEFINER, non-exposed schema) ------------------
create schema if not exists private;

create or replace function private.can_view_all_expenses()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.app_users
                 where user_id = (select auth.uid()) and role in ('admin','accountant'));
$$;

create or replace function private.my_phone()
returns text language sql security definer stable set search_path = '' as $$
  select phone from public.app_users where user_id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.app_users where user_id = (select auth.uid()) and role = 'admin');
$$;

revoke all on function private.can_view_all_expenses() from public;
revoke all on function private.my_phone()              from public;
revoke all on function private.is_admin()              from public;
grant execute on function private.can_view_all_expenses() to authenticated;
grant execute on function private.my_phone()              to authenticated;
grant execute on function private.is_admin()              to authenticated;

-- 3) RLS on receipts / roster — matched by ACCOUNT --------------------------
-- Applied via migration `key_expense_identity_on_user_id` (2026-07-25). The
-- phone-only rule made an employee's own web receipts invisible to them, since
-- every web row carried sender_phone = null. Phone stays as a fallback.
grant select on public.wap_expenses to authenticated;
drop policy if exists wap_expenses_self_or_accountant on public.wap_expenses;
create policy wap_expenses_self_or_accountant on public.wap_expenses
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or user_id = (select auth.uid())
    or (sender_phone is not null and sender_phone = private.my_phone())
    or exists (
      select 1 from public.wap_expense_splits s
       where s.expense_id = wap_expenses.expense_id
         and (s.user_id = (select auth.uid())
              or (s.sender_phone is not null and s.sender_phone = private.my_phone()))
    )
  );

grant select on public.wap_expense_splits to authenticated;
drop policy if exists wap_splits_self_or_accountant on public.wap_expense_splits;
create policy wap_splits_self_or_accountant on public.wap_expense_splits
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or user_id = (select auth.uid())
    or (sender_phone is not null and sender_phone = private.my_phone())
  );

grant select on public.wap_allowed_senders to authenticated;
drop policy if exists wap_senders_self_or_accountant on public.wap_allowed_senders;
create policy wap_senders_self_or_accountant on public.wap_allowed_senders
  for select to authenticated
  using ( private.can_view_all_expenses() or phone = private.my_phone() );

grant select on public.wap_expense_monthly to authenticated;   -- security_invoker view

-- 4) Login resolver: "phone or email" -> account email (callable pre-login) --
create or replace function public.resolve_login_email(identifier text)
returns text language plpgsql security definer stable set search_path = '' as $$
declare digits text; result text;
begin
  if identifier is null or btrim(identifier) = '' then return null; end if;
  if position('@' in identifier) > 0 then return btrim(identifier); end if;
  digits := regexp_replace(identifier, '[^0-9]', '', 'g');
  if digits = '' then return null; end if;
  select u.email into result from public.app_users a join auth.users u on u.id = a.user_id
   where a.phone = digits limit 1;
  return result;
end; $$;
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

-- 5) Admin RPCs for the Team panel (admin-checked internally) ----------------
create or replace function public.admin_list_users()
returns table(user_id uuid, email text, role text, phone text, full_name text,
              department text, banned boolean, active boolean, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select u.id, coalesce(a.email, u.email::text), coalesce(a.role,'unassigned'),
           a.phone, a.full_name, a.department,
           (u.banned_until is not null and u.banned_until > now()) as banned,
           r.active, u.created_at
    from auth.users u
    left join public.app_users a on a.user_id = u.id
    left join public.wap_allowed_senders r on r.phone = a.phone
    order by u.created_at;
end; $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Params are p_* prefixed so they never collide with app_users column names
-- (a bare `full_name` in the body would be "ambiguous" between param and column).
create or replace function public.admin_set_role(p_target uuid, p_role text, p_phone text default null, p_full_name text default null, p_department text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text;
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_role not in ('admin','accountant','employee') then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;
  clean_phone := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
  update public.app_users set
      role = p_role,
      phone = case when p_role = 'employee' then clean_phone else null end,
      full_name = nullif(btrim(coalesce(p_full_name,'')), ''),
      department = nullif(btrim(coalesce(p_department,'')), '')
    where user_id = p_target;
  if not found then
    insert into public.app_users (user_id, role, phone, full_name, department)
    values (p_target, p_role, case when p_role='employee' then clean_phone else null end,
            nullif(btrim(coalesce(p_full_name,'')),''), nullif(btrim(coalesce(p_department,'')),''));
  end if;
end; $$;
-- SUPERSEDED 2026-07-28 by db/2026-07-28-single-identity.sql, which is the live
-- definition. The body above is kept only so this file still reads as the story
-- of how the security model got here; do NOT re-run it, it reintroduces two
-- lockouts. It wiped the phone of anyone who was not an employee (Sarim, Habib
-- and Mawavia are all admins WITH phones), and it never touched
-- wap_allowed_senders, so changing someone's number left a stale roster row and
-- their next receipt failed the FK on wap_expenses.sender_phone. Both were
-- harmless only while nothing authorised on app_users.phone. whatsapp_members
-- now does.
revoke all on function public.admin_set_role(uuid,text,text,text,text) from public, anon;
grant execute on function public.admin_set_role(uuid,text,text,text,text) to authenticated;

-- Creating / managing logins needs the Auth Admin API (not SQL). Two admin-only
-- Edge Functions handle it (supabase/functions/*), each re-checking admin inside:
--   admin-create-user : creates the login + writes app_users + the roster row for
--                       ANYONE with a phone (not just employees), and since
--                       2026-07-28 a phone is required for every role
--   admin-manage-user : deactivate (ban) / activate (unban) / delete a login
--                       (+ flips the employee's roster active flag; blocks self-lockout)
-- Users change their own password client-side via GoTrue PUT /auth/v1/user
-- (see changePassword in src/auth.js) — no service key needed.

-- 6) Web receipt uploads --------------------------------------------------------
-- wap_expenses.image_path holds the Supabase Storage object path (bucket "receipts")
-- for receipts submitted through the website chat. WhatsApp receipts keep using Drive
-- (drive_link). Objects are stored at "<uploader_auth_uid>/<expense_id>.jpg".
alter table public.wap_expenses add column if not exists image_path text;

-- Private receipts bucket + read policy (own folder, or admin/accountant):
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists receipts_read_own_or_admin on storage.objects;
create policy receipts_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_view_all_expenses()
    )
  );

-- ============================================================================
-- 7) Acceptable-Use acknowledgment audit trail   (added 2026-07-07)
-- Records WHEN each user accepted the first-login Acceptable-Use policy. The
-- dashboard's gate decision is a per-device localStorage flag (fast, no network),
-- so this column is the durable server-side audit record of who agreed and when.
--
-- We do NOT open a self-UPDATE policy on app_users: the table holds `role`, so a
-- blanket "update your own row" policy would let a user promote themselves to admin.
-- Instead a SECURITY DEFINER function writes ONLY aup_accepted_at, ONLY for the
-- caller's own row (user_id = auth.uid()). anon can't execute it. Applied via
-- migration `add_aup_accepted_at`.
-- ============================================================================
alter table public.app_users
  add column if not exists aup_accepted_at timestamptz;

create or replace function public.record_aup_acceptance()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.app_users
     set aup_accepted_at = now()
   where user_id = auth.uid()
  returning aup_accepted_at;
$$;

revoke all on function public.record_aup_acceptance() from public, anon;
grant execute on function public.record_aup_acceptance() to authenticated;

-- ============================================================================
-- 8) RLS penetration test — hardening   (added 2026-07-11)
-- Verified by impersonating the employee role (set role authenticated + injected
-- request.jwt.claims — the same enforcement path a REST call with that JWT hits).
-- Results, all correctly REFUSED:
--   • employee read of another employee's wap_expenses row  → blocked (sees own only)
--   • employee read of app_users                            → own row only (not others' roles)
--   • employee read of n8n_chat_histories / semantic_cache  → 0 rows
--   • employee UPDATE / forged INSERT on wap_expenses        → permission denied (SELECT-only grant)
--   • employee self-promote to admin (UPDATE app_users.role) → 0 rows (no UPDATE policy, fail-closed)
--   • Storage /object/sign for a stranger's receipt path     → refused (receipts_read_own_or_admin gates the SIGN, not just download)
--
-- Finding A (defense-in-depth): the `authenticated` role still HELD full write
-- grants (INSERT/UPDATE/DELETE/TRUNCATE) on the tables below — so writes were
-- blocked ONLY by the absence of a write RLS policy (a single layer). These
-- tables are written exclusively by service_role (n8n) or SECURITY DEFINER RPCs,
-- so signed-in users need SELECT only. Revoking removes the escalation risk if
-- RLS on app_users were ever disabled/misconfigured. Applied via migration
-- `harden_revoke_write_grants_from_authenticated`.
revoke insert, update, delete, truncate, references
  on public.app_users, public.n8n_chat_histories, public.semantic_cache
  from authenticated;

-- Finding C (bug, not security): the wap_expenses.status column default was
-- 'pending_review', which VIOLATES wap_expenses_status_check (status must be
-- 'logged' or 'rejected') — so any insert relying on the default failed. Reset to
-- the normal recorded state. Applied via migration `fix_wap_expenses_status_default`.
alter table public.wap_expenses alter column status set default 'logged';

-- Finding B (known tradeoff, NOT fixed): public.resolve_login_email(text) is
-- SECURITY DEFINER and granted to `anon` (needed so phone-or-email login can
-- resolve a phone → account email BEFORE sign-in, see §4). Side effect: an
-- unauthenticated caller can probe whether a phone is registered and get back its
-- login email — an account/PII enumeration oracle. Accepted as the cost of phone
-- login. If this becomes a concern, gate it behind an Edge Function with rate
-- limiting, or drop anon EXECUTE and resolve the email server-side at login.
