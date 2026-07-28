-- One identity per person + a gate on the WhatsApp bot.
-- Spec: docs/superpowers/specs/2026-07-28-single-identity-whatsapp-gate-design.md
-- Plan: docs/superpowers/plans/2026-07-28-single-identity-whatsapp-gate.md
--
-- Re-runnable. Snapshots taken 2026-07-28 live in backup_20260728_* and are NOT
-- dropped by this script -- delete them by hand once the change has proven itself.
--
--   backup_20260728_wap_allowed_senders   12 rows
--   backup_20260728_n8n_chat_histories    29 rows
--   backup_20260728_web_chat_histories   278 rows


-- 1) Who may message the WhatsApp bot. The single answer to that question. ----
--
-- Deliberately does NOT consult wap_allowed_senders.active. Deactivating someone
-- in Team bans their login AND flips that flag, so the ban is the same decision
-- recorded one level up; reading only the ban means the two can never disagree,
-- which is the drift this whole change exists to remove.
--
-- SECURITY: no grant to `authenticated`. This view exposes every colleague's
-- phone number, and it is a definer-rights view, so granting it to logged-in
-- users would hand the whole staff directory to any of them. n8n reads it with
-- the service role. The dashboard uses admin_list_users() instead.
create or replace view public.whatsapp_members as
  select a.phone, a.user_id, a.full_name, a.role, a.department
  from public.app_users a
  join auth.users u on u.id = a.user_id
  where a.phone is not null
    and (u.banned_until is null or u.banned_until <= now());

revoke all on public.whatsapp_members from public, anon, authenticated;
grant select on public.whatsapp_members to service_role;


-- 2) admin_set_role: two lockouts fixed. -------------------------------------
--
-- 1. The old body did `phone = case when p_role = 'employee' then clean_phone
--    else null end`, so editing any admin or accountant wiped their number.
--    Sarim, Habib and Mawavia are all admins WITH phones. Phone is now kept for
--    every role, and required (raises rather than silently nulling).
-- 2. It only ever touched app_users, so changing someone's number left a stale
--    wap_allowed_senders row and their next receipt failed the FK on
--    wap_expenses.sender_phone. The roster row now follows.
create or replace function public.admin_set_role(
  p_target uuid, p_role text, p_phone text default null,
  p_full_name text default null, p_department text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text; old_phone text; clean_name text; clean_dept text;
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_role not in ('admin','accountant','employee') then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;

  clean_phone := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
  if clean_phone is null then
    raise exception 'a phone number is required for every role' using errcode = '22023';
  end if;
  clean_name := nullif(btrim(coalesce(p_full_name,'')), '');
  clean_dept := nullif(btrim(coalesce(p_department,'')), '');

  select phone into old_phone from public.app_users where user_id = p_target;

  update public.app_users set
      role = p_role, phone = clean_phone,
      full_name = clean_name, department = clean_dept
    where user_id = p_target;
  if not found then
    insert into public.app_users (user_id, role, phone, full_name, department)
    values (p_target, p_role, clean_phone, clean_name, clean_dept);
  end if;

  if old_phone is not null and old_phone <> clean_phone then
    update public.wap_allowed_senders set phone = clean_phone,
           employee_name = clean_name, department = coalesce(clean_dept,'General'),
           updated_at = now()
      where phone = old_phone;
  end if;
  insert into public.wap_allowed_senders (phone, employee_name, department, active)
  values (clean_phone, clean_name, coalesce(clean_dept,'General'), true)
  on conflict (phone) do update
    set employee_name = excluded.employee_name,
        department    = excluded.department,
        updated_at    = now();
end; $$;
revoke all on function public.admin_set_role(uuid,text,text,text,text) from public, anon;
grant execute on function public.admin_set_role(uuid,text,text,text,text) to authenticated;
