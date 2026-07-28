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
-- invisible to both until it is projected here. Appended columns go LAST:
-- create-or-replace can only append to a view, never insert, and putting one
-- mid-list fails with "cannot change name of view column".
--
-- This view is also where identity is now RESOLVED, once, for both readers. The
-- old client comment said "the RPC applies the same rule server-side, so both
-- agree on identity" -- an agreement held together by two copies of one rule in
-- two languages, which is how they drifted apart.
--
-- Three appended columns: ident (the person), person_name (roster name),
-- person_phone (roster number, so a rep merged across channels still shows one).
create or replace view public.chat_all as
select
  r."Timestamp", r."User_Message", r."AI_Response", r."User_Number",
  r.unq_id, r."Name", r.from_cache, r.channel, r.user_id,
  -- user_id is the stamp n8n writes; the two lookups in the lateral below cover
  -- rows written before the backfill or by a workflow not yet updated, which
  -- would otherwise key on free text and re-split the same human into a second
  -- rep the moment they sent one more message. Keying straight off user_id was
  -- tried first and gave 8 reps, not 6: web messages sent that same afternoon
  -- arrived unstamped. n8n does not stamp it until task 10.
  case when p.user_id is not null then 'uid:' || p.user_id::text
       when r.channel = 'web' or r."User_Number" is null
         then 'web:' || coalesce(nullif(btrim(r."Name"), ''), 'Website user')
       else r."User_Number"::text
  end                                    as ident,
  p.full_name                            as person_name,
  coalesce(p.phone, case when r.channel <> 'web' then r."User_Number"::text end)
                                         as person_phone
from (
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
     FROM web_chat_histories
) r
-- LATERAL ... limit 1, not a three-way OR join: a row matching two ways would
-- come back twice and silently double that person's message count. The branches
-- are mutually exclusive anyway (two require user_id to be null).
left join lateral (
  select a.user_id, a.full_name, a.phone
    from public.app_users a
   where a.user_id = r.user_id
      or (r.user_id is null and a.phone = r."User_Number"::text)
      or (r.user_id is null and r."User_Number" is null
          and split_part(a.email, '@', 1) = nullif(btrim(r."Name"), ''))
   limit 1
) p on true;

-- MUST follow every replace of this view -- see section 7a.
alter view public.chat_all set (security_invoker = on);
grant select on public.chat_all to authenticated;
revoke select on public.chat_all from anon;

-- 329 rows, 326 mapped. The 3 unmapped are 923362188858 (mawavia2), removed from
-- the roster by design - their history stays visible under the name fallback.


-- 6) dashboard_stats: group the Reps tab on the person, not on a name. --------
--
-- This is the function that actually produced "three Mawavias, two Sarims". Its
-- base CTE keyed WhatsApp rows on the phone and web rows on the display name:
--
--   case when c.channel = 'web' or c."User_Number" is null
--        then 'web:' || coalesce(nullif(btrim(c."Name"), ''), 'Website user')
--        else c."User_Number"::text end as ident
--
-- One person, two channels, two keys. The full body is applied via migration
-- (dashboard_stats_reads_chat_all_identity); the substantive changes are:
--
-- a) base now reads c.ident from chat_all instead of building its own key. The
--    resolution lives in the view (section 5) so this function and the client
--    read the same column and cannot drift apart again.
--
-- b) nm = coalesce(c.person_name, c."Name"). Once two channels collapse into one
--    rep, "most recent Name" would flip the label between 'smsarim6' and 'Sarim'
--    depending on which channel they last used.
--
-- c) The users payload gains 'phone' (c.person_phone). A merged rep's identity is
--    a uuid, so without it the rep card and the CSV would have no number to show.
--
-- The legacy branches in the view stay as a fallback so a sender with no Team
-- account keeps their history on screen instead of vanishing.
--
-- VERIFY THIS AS A REAL USER, NOT OVER THIS CONNECTION. dashboard_stats is
-- SECURITY INVOKER, so the MCP/superuser connection bypasses every policy the
-- function actually runs under. Measured that way it reported a clean 6 reps
-- while a logged-in admin still got 8 with smsarim6 and mawaviahitech intact --
-- see section 7, which is the RLS gap that caused it. Impersonate instead:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin-uuid>","role":"authenticated"}';
--   select jsonb_array_length(public.dashboard_stats(null) -> 'users');
--   rollback;
--
-- Verified as admin Habib: 6 reps, 332 msgs - Sarim 188, Mawavia 102, Habib 27,
-- Iftikhar 6, Asad 6, and MSBK/923362188858 (mawavia2, off the roster by design,
-- still keyed on the phone). Channel filters still sum to the total: 281 + 51.
-- Verified as employee Asad: 0 rows, 0 reps.


-- 7) The RLS gap section 6 depended on -- and a hole this change opened. -------

-- 7a) SECURITY REGRESSION, introduced in section 5 and fixed here.
--
-- CREATE OR REPLACE VIEW resets reloptions when no WITH clause is given, so
-- replacing chat_all in section 5 silently dropped the security_invoker = on
-- that db/security-rls.sql:47 had set. Without it the view runs with its OWNER's
-- rights (postgres) and bypasses RLS on all three base tables -- each of which
-- restricts SELECT to private.is_admin(). For as long as that was live, any
-- authenticated employee could have read the entire company's chat history.
--
-- Any future replace of this view MUST re-assert this line.
alter view public.chat_all set (security_invoker = on);

-- 7b) Admins can read app_users, not just their own row.
--
-- dashboard_stats is SECURITY INVOKER deliberately (db/dashboard-stats.sql:30):
-- that is what stops a non-admin seeing company-wide stats, because chat_all now
-- returns them nothing. But it means section 6's app_users lookups also run as
-- the caller, and the only SELECT policy was app_users_self_read -- so an admin
-- resolved their OWN identity and nobody else's, and the Reps tab went on
-- showing smsarim6, mawaviahitech, sales01 and procurement as separate people.
--
-- This grants admins nothing new: admin_list_users() is SECURITY DEFINER and
-- already returns every column of this table to any admin. It aligns the
-- direct-table permission with the RPC that was already handing it over.
--
-- No recursion risk: private.is_admin() is SECURITY DEFINER, so it does not
-- re-enter this policy when it queries app_users.
create policy app_users_admin_read on public.app_users
  for select to authenticated using (private.is_admin());
