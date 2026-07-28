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


-- 3) Roster cleanup. ----------------------------------------------------------
-- mawavia2 is the one deliberate loss of access: active on WhatsApp, no
-- dashboard account, so under "only Team may message the bot" they are out.
-- Verified before running: all four rows had zero rows in wap_expenses, so the
-- ON DELETE SET NULL on wap_expenses.sender_phone orphaned nothing.
delete from public.wap_allowed_senders
 where phone in ('923362188858','03134331423','123123123123','03159601666');

-- The active flag had been recording three different things (Taimoor false,
-- both Khizars true, none of them ever logged in). whatsapp_members reads the
-- ban instead, so the flag is reset to agree rather than left contradicting.
update public.wap_allowed_senders w set active = true, updated_at = now()
  from public.app_users a join auth.users u on u.id = a.user_id
 where w.phone = a.phone and (u.banned_until is null or u.banned_until <= now());

-- NOTE: spending_limit was NOT dropped. It looked unused but is live -- there is
-- a monthly-cap panel at src/mawavia-dashboard.jsx:3224 backed by an
-- admin_set_spending_limit RPC. See the plan's task 4, whose first step is the
-- grep that caught this.


-- 4) user_id on both chat histories, backfilled. -----------------------------
alter table public.n8n_chat_histories add column if not exists user_id uuid references public.app_users(user_id);
alter table public.web_chat_histories add column if not exists user_id uuid references public.app_users(user_id);

-- WhatsApp keys on the number, the one identifier the sender cannot change. The
-- Name column was contacts[0].profile.name -- the sender's OWN WhatsApp display
-- name -- so it was never safe to key on.
update public.n8n_chat_histories h set user_id = a.user_id
  from public.app_users a where a.phone = h."User_Number"::text and h.user_id is null;

-- Web keys on the email local-part, which is what currentUserName() stamped.
update public.web_chat_histories h set user_id = a.user_id
  from public.app_users a where split_part(a.email,'@',1) = h."Name" and h.user_id is null;

create index if not exists n8n_chat_histories_user_id_idx on public.n8n_chat_histories(user_id);
create index if not exists web_chat_histories_user_id_idx on public.web_chat_histories(user_id);


-- 5) chat_archive + chat_all. -------------------------------------------------
-- chat_archive is a THIRD source behind chat_all (older WhatsApp traffic), found
-- only when chat_all's definition was read. Without it, archived messages keep
-- counting as a separate rep.
create table if not exists backup_20260728_chat_archive as select * from public.chat_archive;
alter table public.chat_archive add column if not exists user_id uuid references public.app_users(user_id);
update public.chat_archive h set user_id = a.user_id
  from public.app_users a where a.phone = h."User_Number"::text and h.user_id is null;
create index if not exists chat_archive_user_id_idx on public.chat_archive(user_id);

-- chat_all is what dashboard_stats and the client both read, so user_id is
-- invisible to both until it is projected here. It goes LAST in the select list:
-- create-or-replace can only append columns to a view, never insert one, and
-- putting it mid-list fails with "cannot change name of view column".
create or replace view public.chat_all as
 SELECT n8n_chat_histories."Timestamp", n8n_chat_histories."User_Message",
    n8n_chat_histories."AI_Response", n8n_chat_histories."User_Number",
    n8n_chat_histories.unq_id, n8n_chat_histories."Name",
    n8n_chat_histories.from_cache, 'whatsapp'::text AS channel,
    n8n_chat_histories.user_id
   FROM n8n_chat_histories
UNION ALL
 SELECT chat_archive."Timestamp", chat_archive."User_Message",
    chat_archive."AI_Response", chat_archive."User_Number",
    chat_archive.unq_id, chat_archive."Name",
    chat_archive.from_cache, 'whatsapp'::text AS channel,
    chat_archive.user_id
   FROM chat_archive
UNION ALL
 SELECT web_chat_histories."Timestamp", web_chat_histories."User_Message",
    web_chat_histories."AI_Response", NULL::bigint AS "User_Number",
    web_chat_histories.unq_id, web_chat_histories."Name",
    web_chat_histories.from_cache, 'web'::text AS channel,
    web_chat_histories.user_id
   FROM web_chat_histories;

-- 329 rows, 326 mapped. The 3 unmapped are 923362188858 (mawavia2), removed from
-- the roster by design - their history stays visible under the name fallback.
