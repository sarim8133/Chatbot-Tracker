-- ============================================================================
-- Accountant tools for expenses   (added 2026-07-24)
--
-- Three capabilities, all gated on private.can_view_all_expenses()
-- (admin + accountant), none of them reachable by an employee:
--
--   1. DELETE an expense            -> admin_delete_expense()
--   2. SPLIT a receipt across staff -> admin_set_expense_split() / _clear_
--   3. MONTHLY SPENDING LIMIT       -> admin_set_spending_limit()
--
-- Identity stays what it already is everywhere else: the PHONE NUMBER.
-- Splits reference wap_allowed_senders.phone, receipts carry sender_phone, and
-- RLS matches on private.my_phone(). No new identity concept is introduced.
-- ============================================================================


-- ── 1. Deletion audit ───────────────────────────────────────────────────────
-- A deleted expense is gone from wap_expenses, so without this there is no
-- record that money was ever claimed. For a financial ledger that is not
-- acceptable: the row here is the only surviving evidence.
--
-- Deliberately NOT readable by `authenticated` — no policy, no grant. Only
-- service_role and SECURITY DEFINER functions can see it, so an accountant
-- cannot quietly prune their own trail from the app.
create table if not exists public.wap_expense_deletions (
  id            uuid primary key default gen_random_uuid(),
  expense_id    text not null,
  deleted_by    uuid references auth.users(id),
  deleted_at    timestamptz not null default now(),
  -- Snapshot of what was destroyed, so the audit stands alone.
  employee_name text,
  sender_phone  text,
  vendor_name   text,
  total         numeric,
  expense_date  date,
  image_path    text,
  reason        text,
  row_snapshot  jsonb
);
alter table public.wap_expense_deletions enable row level security;
create index if not exists wap_expense_deletions_at_idx
  on public.wap_expense_deletions (deleted_at desc);


-- ── 2. Splits ───────────────────────────────────────────────────────────────
-- One receipt, several people. Two colleagues eat together, one pays and sends
-- the photo; the accountant reassigns who actually owes what.
--
-- A row here means "this much of that receipt belongs to this phone". The payer
-- is NOT implicitly included: if a split exists it is the complete allocation of
-- the receipt, so a payer who kept a share must appear in it like anyone else.
-- That invariant (shares sum to the receipt total) is enforced in the RPC.
create table if not exists public.wap_expense_splits (
  id            uuid primary key default gen_random_uuid(),
  expense_id    text not null references public.wap_expenses(expense_id) on delete cascade,
  sender_phone  text not null,
  employee_name text,
  share         numeric(12,2) not null check (share > 0),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  -- One share per person per receipt; re-splitting updates rather than stacks.
  unique (expense_id, sender_phone)
);
alter table public.wap_expense_splits enable row level security;
create index if not exists wap_expense_splits_expense_idx on public.wap_expense_splits (expense_id);
create index if not exists wap_expense_splits_phone_idx   on public.wap_expense_splits (sender_phone);

-- Read: everyone's if you're admin/accountant, otherwise only shares that are
-- yours. Writes go exclusively through the RPCs below (no write policy, and the
-- grant is SELECT only).
grant select on public.wap_expense_splits to authenticated;
drop policy if exists wap_splits_self_or_accountant on public.wap_expense_splits;
create policy wap_splits_self_or_accountant on public.wap_expense_splits
  for select to authenticated
  using ( private.can_view_all_expenses() or sender_phone = private.my_phone() );


-- ── 3. Being on a split grants sight of the receipt ─────────────────────────
-- Without this the feature is inert: Bilal has a share of a receipt Ali paid
-- for, but the wap_expenses row is still filtered out by the old policy, so his
-- own share joins to nothing and he sees neither the receipt nor the amount.
drop policy if exists wap_expenses_self_or_accountant on public.wap_expenses;
create policy wap_expenses_self_or_accountant on public.wap_expenses
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or sender_phone = private.my_phone()
    or exists (
      select 1 from public.wap_expense_splits s
       where s.expense_id = wap_expenses.expense_id
         and s.sender_phone = private.my_phone()
    )
  );

-- Same reasoning for the image: a receipt you are being charged for is a
-- receipt you are entitled to look at. The stored object lives in the PAYER's
-- folder, so folder-name matching alone can never reach it.
drop policy if exists receipts_read_own_or_admin on storage.objects;
create policy receipts_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_view_all_expenses()
      or exists (
        select 1 from public.wap_expenses e
          join public.wap_expense_splits s on s.expense_id = e.expense_id
         where e.image_path = storage.objects.name
           and s.sender_phone = private.my_phone()
      )
    )
  );

-- Deleting the stored photo alongside the row. Accountants only — an employee
-- has no DELETE path to storage at all.
drop policy if exists receipts_delete_accountant on storage.objects;
create policy receipts_delete_accountant on storage.objects
  for delete to authenticated
  using ( bucket_id = 'receipts' and private.can_view_all_expenses() );


-- ── 4. Delete an expense ────────────────────────────────────────────────────
-- Returns the storage path (or null) so the caller can remove the object too.
-- The row is snapshotted into wap_expense_deletions first; if that insert fails
-- the whole statement rolls back and nothing is destroyed.
create or replace function public.admin_delete_expense(p_expense_id text, p_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare row_rec public.wap_expenses;
begin
  if not private.can_view_all_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into row_rec from public.wap_expenses where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;

  insert into public.wap_expense_deletions
    (expense_id, deleted_by, employee_name, sender_phone, vendor_name, total,
     expense_date, image_path, reason, row_snapshot)
  values
    (row_rec.expense_id, (select auth.uid()), row_rec.employee_name, row_rec.sender_phone,
     row_rec.vendor_name, row_rec.total, row_rec.date, row_rec.image_path,
     nullif(btrim(coalesce(p_reason, '')), ''), to_jsonb(row_rec));

  -- Splits cascade via the FK.
  delete from public.wap_expenses where expense_id = p_expense_id;

  return row_rec.image_path;
end; $$;
revoke all on function public.admin_delete_expense(text, text) from public, anon;
grant execute on function public.admin_delete_expense(text, text) to authenticated;


-- ── 5. Split a receipt ──────────────────────────────────────────────────────
-- p_shares is [{"phone":"92...","share":1200.50}, ...]. Names are looked up
-- from the roster rather than trusted from the client, so a split can never
-- introduce an employee who doesn't exist.
--
-- Replaces the whole allocation atomically: the previous split is deleted and
-- the new one inserted in the same statement, so a receipt is never briefly
-- half-split.
create or replace function public.admin_set_expense_split(p_expense_id text, p_shares jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  exp_total numeric;
  sum_share numeric;
  n_shares  integer;
  n_known   integer;
  n_bad     integer;
begin
  if not private.can_view_all_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select total into exp_total from public.wap_expenses where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_shares) <> 'array' then
    raise exception 'shares must be a JSON array' using errcode = '22023';
  end if;

  -- Parsed inline as a CTE rather than a temp table: this function runs with
  -- search_path = '', where an unqualified temp relation cannot be resolved.
  with parsed as (
    select distinct
           regexp_replace(coalesce(s->>'phone', ''), '[^0-9]', '', 'g') as phone,
           round((s->>'share')::numeric, 2)                             as share
      from jsonb_array_elements(p_shares) s
  )
  select count(*),
         coalesce(sum(p.share), 0),
         count(*) filter (where p.phone = '' or p.share is null or p.share <= 0),
         count(*) filter (where exists (select 1 from public.wap_allowed_senders w
                                         where w.phone = p.phone))
    into n_shares, sum_share, n_bad, n_known
    from parsed p;

  if n_shares < 2 then
    raise exception 'a split needs at least two people' using errcode = '22023';
  end if;
  if n_bad > 0 then
    raise exception 'every share needs a phone and a positive amount' using errcode = '22023';
  end if;

  -- Everyone on the split must be on the roster. Otherwise a typo silently
  -- parks money against a phone that no one owns and it never surfaces again.
  if n_known <> n_shares then
    raise exception 'one or more phone numbers are not on the employee roster'
      using errcode = '22023';
  end if;

  -- Tolerance covers rounding when an odd total is divided evenly.
  if abs(sum_share - exp_total) > 0.01 then
    raise exception 'shares total % but the receipt is %', sum_share, exp_total
      using errcode = '22023';
  end if;

  delete from public.wap_expense_splits where expense_id = p_expense_id;

  with parsed as (
    select distinct
           regexp_replace(coalesce(s->>'phone', ''), '[^0-9]', '', 'g') as phone,
           round((s->>'share')::numeric, 2)                             as share
      from jsonb_array_elements(p_shares) s
  )
  insert into public.wap_expense_splits (expense_id, sender_phone, employee_name, share, created_by)
  select p_expense_id, p.phone, w.employee_name, p.share, (select auth.uid())
    from parsed p join public.wap_allowed_senders w on w.phone = p.phone;

  return n_shares;
end; $$;
revoke all on function public.admin_set_expense_split(text, jsonb) from public, anon;
grant execute on function public.admin_set_expense_split(text, jsonb) to authenticated;


create or replace function public.admin_clear_expense_split(p_expense_id text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.can_view_all_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.wap_expense_splits where expense_id = p_expense_id;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.admin_clear_expense_split(text) from public, anon;
grant execute on function public.admin_clear_expense_split(text) to authenticated;


-- ── 6. Monthly spending limit ───────────────────────────────────────────────
-- wap_allowed_senders.spending_limit already existed (the old WhatsApp bot read
-- it and nothing ever set it). It is now defined as the MONTHLY cap and is
-- editable from the app.
comment on column public.wap_allowed_senders.spending_limit is
  'Monthly spending cap in PKR for this employee. Compared against their share '
  'of the calendar month''s receipts. 0 = no limit. Set via admin_set_spending_limit().';

create or replace function public.admin_set_spending_limit(p_phone text, p_limit numeric)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare clean_phone text; result numeric;
begin
  if not private.can_view_all_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  clean_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  if clean_phone is null then
    raise exception 'a phone number is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'limit must be zero or more' using errcode = '22023';
  end if;

  update public.wap_allowed_senders
     set spending_limit = round(p_limit, 2), updated_at = now()
   where phone = clean_phone
  returning spending_limit into result;

  if not found then
    raise exception 'no roster entry for that phone' using errcode = 'P0002';
  end if;
  return result;
end; $$;
revoke all on function public.admin_set_spending_limit(text, numeric) from public, anon;
grant execute on function public.admin_set_spending_limit(text, numeric) to authenticated;


-- ── 7. Revoke the default grants on the new tables ──────────────────────────
-- Supabase's default privileges hand anon + authenticated full DML on every new
-- table in `public`. RLS already refuses the writes (neither table has a write
-- policy), but that leaves a single layer — the same Finding A pattern hardened
-- in the 2026-07-11 pen-test. Both tables are written only by the SECURITY
-- DEFINER functions above. Applied via migration
-- `harden_revoke_grants_on_split_and_deletion_tables`.
revoke insert, update, delete, truncate, references, trigger
  on public.wap_expense_splits from authenticated;
revoke all on public.wap_expense_splits from anon;

-- The deletion audit is invisible to the app entirely: an accountant must not be
-- able to read, and above all not erase, the record of what they deleted.
revoke all on public.wap_expense_deletions from authenticated, anon;


-- ── 8. Phone is optional for every role ────────────────────────────────────
-- Previously admin_set_role forced phone = null for anyone who wasn't an
-- employee. Admins and accountants may now have one, so they can sign in by
-- phone and so receipts they submit attribute to them rather than to nobody
-- (wap_expenses.sender_phone comes straight off their app_users row, and was
-- null for every admin — which is why their spend counted toward no budget).
--
-- The trap: wap_expenses.sender_phone has an FK to wap_allowed_senders(phone).
-- Verified by probe — an insert carrying an unrostered phone is REFUSED. So a
-- phone handed out without a roster row would silently break that person's next
-- receipt upload. Setting a phone therefore also guarantees the roster row.
-- ON CONFLICT DO NOTHING: an existing roster entry's employee_name, department
-- and spending_limit are accountant-curated and must survive a Team-panel edit.
-- Applied via migration `allow_optional_phone_for_all_roles`; the matching
-- change is in supabase/functions/admin-create-user (it had the same rule).
create or replace function public.admin_set_role(p_target uuid, p_role text, p_phone text default null, p_full_name text default null, p_department text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text; clean_name text; clean_dept text;
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_role not in ('admin','accountant','employee') then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;

  clean_phone := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
  clean_name  := nullif(btrim(coalesce(p_full_name,'')), '');
  clean_dept  := nullif(btrim(coalesce(p_department,'')), '');

  -- An employee has no identity without a phone; everyone else may leave it null.
  if p_role = 'employee' and clean_phone is null then
    raise exception 'employees need a phone number (it is their identity)' using errcode = '22023';
  end if;

  update public.app_users set
      role = p_role, phone = clean_phone,
      full_name = clean_name, department = clean_dept
    where user_id = p_target;
  if not found then
    insert into public.app_users (user_id, role, phone, full_name, department)
    values (p_target, p_role, clean_phone, clean_name, clean_dept);
  end if;

  if clean_phone is not null then
    insert into public.wap_allowed_senders (phone, employee_name, department, active)
    values (clean_phone, coalesce(clean_name, clean_phone), coalesce(clean_dept, 'General'), true)
    on conflict (phone) do nothing;
  end if;
end; $$;
revoke all on function public.admin_set_role(uuid,text,text,text,text) from public, anon;
grant execute on function public.admin_set_role(uuid,text,text,text,text) to authenticated;


-- ── 9. People come from the Team section, not the WhatsApp roster ──────────
-- BUG FIX (2026-07-24). §5 and §6 above were built against wap_allowed_senders,
-- which is the WhatsApp SUBMIT roster, not the team. Three consequences:
--   • it listed people who have no account at all (mawavia2, test rows);
--   • it showed roster labels rather than real names ("sarim" vs "Sarim");
--   • it OMITTED a real employee with no roster row (Asad), and rejected any
--     split to him as "not on the employee roster".
--
-- app_users is the source of truth for who a person is, and it is the only one
-- that makes a share visible: employee RLS matches sender_phone against
-- private.my_phone(), which reads app_users. A share assigned to a roster-only
-- phone is invisible to everyone but the accountant, permanently.
--
-- Applied via migration `split_picker_uses_team_members_not_roster`, which
-- redefines expense_team_members(), admin_set_expense_split() (validates
-- against app_users, and takes the stored name from there) and
-- admin_set_spending_limit() (creates the roster row on demand, so a team
-- member who has never used WhatsApp can still be given a cap).
--
-- The roster keeps its two real jobs: gating who may submit over WhatsApp, and
-- holding spending_limit.
create or replace function public.expense_team_members()
returns table(phone text, full_name text, department text, role text,
              spending_limit numeric, banned boolean)
language plpgsql security definer set search_path = '' as $$
begin
  -- No explicit role gate: the WHERE clause is the gate. An accountant/admin
  -- gets everyone, anyone else gets only their own row, so the employee's
  -- budget panel and the accountant's split picker share one call.
  return query
    select a.phone,
           coalesce(nullif(btrim(a.full_name), ''), w.employee_name, a.phone) as full_name,
           coalesce(nullif(btrim(a.department), ''), w.department)            as department,
           a.role,
           w.spending_limit,   -- null when they have no roster row yet
           (u.banned_until is not null and u.banned_until > now())            as banned
      from public.app_users a
      join auth.users u on u.id = a.user_id
      left join public.wap_allowed_senders w on w.phone = a.phone
     where a.phone is not null
       and (private.can_view_all_expenses() or a.user_id = (select auth.uid()))
     order by 2;
end; $$;
revoke all on function public.expense_team_members() from public, anon;
grant execute on function public.expense_team_members() to authenticated;
-- (the redefined admin_set_expense_split / admin_set_spending_limit bodies live
--  in the migration; §5 and §6 above show the original shape for context)


-- ============================================================================
-- Verified 2026-07-24 by impersonating each role (set role authenticated +
-- injected request.jwt.claims — the same enforcement path a REST call takes):
--
-- Employee (Khizar Hussain), on a receipt someone else paid for:
--   • sees the receipt he has a share of                      → yes (1 row)
--   • sees the other participants' share amounts              → NO (1 of 3 rows)
--   • admin_delete_expense / _set_expense_split / _set_limit   → 42501 not authorized
--   • read wap_expense_deletions                              → 42501 permission denied
--
-- Accountant/admin (Sarim):
--   • split a receipt 3 ways                                  → 3 rows written
--   • shares that don't sum to the total (900 vs 1000)        → refused, 22023
--   • a phone that isn't on the roster                        → refused, 22023
--   • a negative share that balances arithmetically           → refused, 22023
--   • a "split" with one person                              → refused, 22023
--   • delete: row gone, splits cascaded, audit row written    → confirmed
--
-- Optional phone for an admin (Habib, previously phone = null):
--   • app_users.phone set, roster row auto-created            → confirmed
--   • receipt insert carrying that phone (was an FK violation) → now accepted
--   • resolve_login_email('92 300 111 2233')                   → his account email
--   • re-saving a profile whose phone is ALREADY rostered      → roster row's
--     name / department / spending_limit left untouched
-- All probe data reverted; production is back to 11 expenses, 8 roster rows.
--
-- Team-members fix (§9), re-verified after the change:
--   • accountant (Mawavia) sees 6 team members; mawavia2 gone; "Sarim" not
--     "sarim"; Asad present with no limit yet; Habib absent (no phone)
--   • employee sees exactly 1 row — themselves
--   • split to Asad (a team member with NO roster row) → now accepted
--   • split to mawavia2 (roster row, no account)       → refused, 22023
--   • stored employee_name now reads from app_users
--   • setting Asad's limit creates his roster row on demand → 12000
-- All reverted again; 11 expenses, 0 splits, 8 roster rows.
-- ============================================================================
