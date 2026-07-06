-- ============================================================================
-- Access control + unified identity   (updated 2026-07-05)
--
-- IDENTITY IS THE PHONE NUMBER (unique), not the name — two people can share a
-- name safely. One phone appears in all three places:
--   app_users.phone            (login identity)
--   wap_allowed_senders.phone  (WhatsApp roster: may submit)
--   wap_expenses.sender_phone  (stamped on each receipt — written by n8n)
-- The n8n workflow is UNCHANGED; it already writes sender_phone.
--
-- Roles (in app_users):
--   admin      : full site (all tabs) + everyone's expenses + the Team panel
--   accountant : everyone's expenses + sales tabs
--   employee   : only receipts where sender_phone = their phone
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

-- 3) RLS on receipts / roster — matched by PHONE ----------------------------
grant select on public.wap_expenses to authenticated;
drop policy if exists wap_expenses_self_or_accountant on public.wap_expenses;
create policy wap_expenses_self_or_accountant on public.wap_expenses
  for select to authenticated
  using ( private.can_view_all_expenses() or sender_phone = private.my_phone() );

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
revoke all on function public.admin_set_role(uuid,text,text,text,text) from public, anon;
grant execute on function public.admin_set_role(uuid,text,text,text,text) to authenticated;

-- Creating / managing logins needs the Auth Admin API (not SQL). Two admin-only
-- Edge Functions handle it (supabase/functions/*), each re-checking admin inside:
--   admin-create-user : creates the login + writes app_users (+ roster for employees)
--   admin-manage-user : deactivate (ban) / activate (unban) / delete a login
--                       (+ flips the employee's roster active flag; blocks self-lockout)
-- Users change their own password client-side via GoTrue PUT /auth/v1/user
-- (see changePassword in src/auth.js) — no service key needed.
