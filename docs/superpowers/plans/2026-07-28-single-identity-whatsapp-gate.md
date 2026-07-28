# Single Identity + WhatsApp Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `app_users` the single identity for every person, gate the WhatsApp bot so only Team members can use it, and make adding someone in the Team tab grant login + chat + receipts in one action.

**Architecture:** A `whatsapp_members` view over `app_users` becomes the one place that answers "who may message the bot". One n8n gate node reads it, placed before the `Switch` so it covers chat, audio, reactions and receipts at once. Both chat-history tables gain `user_id`, backfilled from phone (WhatsApp) and email (web), and the Reps tab groups on that instead of a free-text name.

**Tech Stack:** Supabase Postgres (migrations via the Supabase MCP `apply_migration`), Deno edge functions, React 19 + Vite + Tailwind v4, n8n (hand-edited in the UI).

**Spec:** `docs/superpowers/specs/2026-07-28-single-identity-whatsapp-gate-design.md`

---

## Status — 2026-07-28: COMPLETE

**Tasks 1–10 are applied and verified live.** The gate is in, both channels stamp
identity, and the dashboard groups on it.

End-to-end evidence:

| Check | Result |
| --- | --- |
| WhatsApp writes the roster identity | 17:34 row — `Name: Sarim`, `user_id` set (not `Mawavia_Hitech_khi`) |
| Web writes the roster identity | 18:01 row — `Name: Sarim`, `user_id` set (not `smsarim6`) |
| Non-members blocked | 0 rows from outside `whatsapp_members` |
| One rep per person | 6: Sarim 193, Mawavia 102, Habib 27, Iftikhar 6, Asad 6, MSBK 3 |
| No unstamped history | `web_chat_histories` 0 null `user_id` |

`MSBK` (`923362188858`) is the de-rostered mawavia2 number, kept deliberately so
its history stays visible rather than vanishing.

### Two traps hit while applying the n8n half

1. **`.item` vs `.first()`.** The web chat's insert sits after the agent, the
   cache branch and a merge, so n8n's item pairing is lost and `.item` silently
   yields nothing — rows landed with `Name` AND `user_id` null, which is worse
   than the email local-part it replaced. `.first()` is the correct form; the
   WhatsApp workflow had it right.
2. **Two different `supabaseApi` credentials.** The gate's lookup was fixed while
   the web chat's `Validate JWT2` still pointed at an anon-key credential, which
   returns `[]` for `app_users` under RLS — so the name came back undefined with
   no error anywhere.

### Deviations from the plan as written

| Plan said | What was built | Why |
| --- | --- | --- |
| Task 4: drop `spending_limit` | **Withdrawn.** Column, panel and RPC all kept | Its own step 1 grep found the live monthly-cap panel |
| Task 8 step 3: resolve identity inside `dashboard_stats` | Resolved in the **`chat_all` view**; the RPC and the client both read `ident` | The RPC and the client each had their own copy of the rule; one definition means they cannot drift apart again |
| Task 8 step 4b: client derives `uid:` keys, `_repNames` from `u.name` | Client reads `chat_all.ident` directly; phone travels separately as `person_phone` / `users[].phone` | A uuid identity carries no phone, and digit-stripping one produced a plausible but fictional phone number |
| — | Task 8a: `chat_archive` backfilled too | `chat_all` turned out to union **three** tables, not two |

### Things this plan did not anticipate

1. **`create or replace view` resets `reloptions`.** Replacing `chat_all` to add
   a column silently dropped `security_invoker = on`, so the view ran with owner
   rights and bypassed the admin-only RLS on all three chat tables. Restored, and
   flagged at `db/security-rls.sql:44`.
2. **`dashboard_stats` is SECURITY INVOKER, so verify it as a real user.** Over
   the MCP/superuser connection it reported a clean 6 reps while a logged-in
   admin still saw 8. `app_users` only had a self-read policy, so an admin
   resolved their own identity and nobody else's. Added `app_users_admin_read`.
3. **The Task 1 snapshots were world-readable.** `create table as` inherits
   Supabase default privileges granting `anon` ALL on new public tables, and a
   table with no RLS is served by PostgREST — so the full chat history, every
   `session_id` and the staff phone roster were exposed to anyone with the anon
   key. Revoked and RLS-enabled. **Run `get_advisors` after any migration that
   creates a table.**

---

## Testing note

This repo has no test runner — `package.json` defines `dev`, `build`, `lint`, `preview` and nothing else, and there are no test files. Do not add a framework as part of this change. Every task below verifies with either a SQL query whose expected output is written out, or `npm run build` / `npx eslint`. Where a step says "Expected:", the output must match before moving on.

**ESLint baseline is 8 problems (7 errors, 1 warning), all pre-existing.** Any task that raises that number introduced them.

## Ordering rule

Every database and frontend task lands **before** any n8n task. Until the gate node exists, nothing reads `app_users.phone` for authorization, so tasks 1–8 cannot lock anyone out. The n8n gate (task 9) goes in and gets verified on its own before the identity-stamping edits (task 10), because each n8n change is hand-pasted into a live bot and a paste error there takes the bot down for everyone.

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `db/2026-07-28-single-identity.sql` | The whole DB change, re-runnable, kept as the record | Create |
| `db/expense-access-rls.sql` | `admin_set_role` fix + stale comments | Modify |
| `supabase/functions/admin-create-user/index.ts` | Require phone for all roles | Modify |
| `src/mawavia-dashboard.jsx` | Team form validation; Reps grouping | Modify |
| `n8n/identity-gate-apply-checklist.md` | Hand-apply steps for the two n8n edits | Create |
| `handoff_receipt.md` | Drop the `spending_limit` reference | Modify |

---

### Task 1: Snapshot before touching data

**Files:**
- Create: `db/2026-07-28-single-identity.sql`

- [ ] **Step 1: Take the snapshots**

Run via Supabase MCP `execute_sql`:

```sql
create table if not exists backup_20260728_wap_allowed_senders as select * from public.wap_allowed_senders;
create table if not exists backup_20260728_n8n_chat_histories as select * from public.n8n_chat_histories;
create table if not exists backup_20260728_web_chat_histories as select * from public.web_chat_histories;
```

- [ ] **Step 2: Verify the snapshots are populated**

```sql
select
  (select count(*) from backup_20260728_wap_allowed_senders) as senders,
  (select count(*) from backup_20260728_n8n_chat_histories)  as wa_msgs,
  (select count(*) from backup_20260728_web_chat_histories)  as web_msgs;
```

Expected: `senders` = 12, `wa_msgs` ≥ 23, `web_msgs` ≥ 276. If `senders` is not 12, stop — the roster changed since the spec was written and Task 5's row list needs rechecking.

- [ ] **Step 3: Start the migration file**

Create `db/2026-07-28-single-identity.sql` with this header:

```sql
-- One identity per person + a gate on the WhatsApp bot.
-- Spec: docs/superpowers/specs/2026-07-28-single-identity-whatsapp-gate-design.md
--
-- Re-runnable. Snapshots taken 2026-07-28 live in backup_20260728_* and are NOT
-- dropped by this script — delete them by hand once the change has proven itself.
```

- [ ] **Step 4: Commit**

```bash
git add db/2026-07-28-single-identity.sql
git commit -m "chore(db): snapshot tables before the identity change"
```

---

### Task 2: The `whatsapp_members` view

**Files:**
- Modify: `db/2026-07-28-single-identity.sql`

- [ ] **Step 1: Confirm the authorized set before creating anything**

```sql
select a.phone, a.full_name, a.role
from public.app_users a
join auth.users u on u.id = a.user_id
where a.phone is not null
  and (u.banned_until is null or u.banned_until <= now())
order by a.full_name;
```

Expected: 8 rows — Asad, Habib, Iftikhar, Khizar Altaf, Khizar Hussain, Mawavia, Sarim, Taimoor Nasir. If any row is missing a phone, fix that row before continuing; it would be a lockout.

- [ ] **Step 2: Append the view to the migration file and apply it**

```sql
-- Who may message the WhatsApp bot. The single answer to that question.
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
```

Apply with Supabase MCP `apply_migration`, name `whatsapp_members_view`.

- [ ] **Step 3: Verify the view returns the same 8 rows**

```sql
select count(*) as members from public.whatsapp_members;
```

Expected: `members` = 8.

- [ ] **Step 4: Verify it is not readable by logged-in users**

```sql
select has_table_privilege('authenticated', 'public.whatsapp_members', 'select') as leaked;
```

Expected: `leaked` = false. If true, the revoke did not take — do not proceed, the staff phone directory is exposed.

- [ ] **Step 5: Commit**

```bash
git add db/2026-07-28-single-identity.sql
git commit -m "feat(db): whatsapp_members, one answer to who may message the bot"
```

---

### Task 3: Fix `admin_set_role` — the two live bugs

**Files:**
- Modify: `db/2026-07-28-single-identity.sql`
- Modify: `db/expense-access-rls.sql:153-173`

- [ ] **Step 1: Reproduce bug 1 before fixing it**

```sql
select full_name, role, phone from public.app_users where full_name = 'Habib';
```

Expected: phone = `923329090923`, role = `admin`. This is the row that `admin_set_role` would blank today.

- [ ] **Step 2: Write the corrected function into the migration file and apply it**

```sql
-- Two fixes, both lockouts once whatsapp_members is the gate:
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

  -- Roster follows. wap_expenses.sender_phone FKs to this table, so a number
  -- that is not rostered makes the person's next receipt fail.
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
```

Apply with `apply_migration`, name `admin_set_role_keeps_phone`.

**Note:** the `on conflict (phone)` clause needs a unique constraint on `wap_allowed_senders.phone`. The FK from `wap_expenses.sender_phone` requires one, so it exists — confirm in the next step.

- [ ] **Step 3: Confirm the unique constraint the upsert depends on**

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.wap_allowed_senders'::regclass and contype in ('p','u');
```

Expected: at least one constraint covering `(phone)`. If none exists, add `alter table public.wap_allowed_senders add constraint wap_allowed_senders_phone_key unique (phone);` to the migration before the function, and re-apply.

- [ ] **Step 4: Verify the phone survives a role edit**

```sql
select public.admin_set_role(
  (select user_id from public.app_users where full_name='Habib'),
  'admin', '923329090923', 'Habib', 'CEO');
select full_name, role, phone from public.app_users where full_name='Habib';
```

Expected: phone still `923329090923`. Before this task it would have been null.

**If this raises `not authorized`,** the MCP connection is not running as an admin. Run the check as the postgres role instead by temporarily inspecting the function body rather than calling it, and verify behaviour through the Team tab in step 6.

- [ ] **Step 5: Verify a phoneless call is now rejected**

```sql
select public.admin_set_role(
  (select user_id from public.app_users where full_name='Habib'),
  'admin', '', 'Habib', 'CEO');
```

Expected: raises `a phone number is required for every role`. Habib's row is unchanged.

- [ ] **Step 6: Replace the stale definition in the canonical RLS file**

In `db/expense-access-rls.sql`, replace the whole `admin_set_role` body (lines 153-173) with the version from Step 2, so the file that documents the security model is not lying. Also fix the stale comment at line 179, which claims `admin-create-user` writes the roster "for employees" — it writes it for anyone with a phone.

- [ ] **Step 7: Commit**

```bash
git add db/2026-07-28-single-identity.sql db/expense-access-rls.sql
git commit -m "fix(db): admin_set_role wiped non-employee phones and orphaned the roster"
```

---

### Task 4: Drop `spending_limit` — WITHDRAWN, DO NOT RUN

**Step 1 below fired and stopped this task on 2026-07-28.** `spending_limit` is
live: a monthly-cap panel at `src/mawavia-dashboard.jsx:3224` reads it, backed by
an `admin_set_spending_limit` RPC. The column, the panel and the RPC all stay.
Skip straight to Task 5. The steps are kept as the record of why.

_Original task follows._

### Task 4 (withdrawn): Drop `spending_limit`

**Files:**
- Modify: `db/2026-07-28-single-identity.sql`
- Modify: `handoff_receipt.md:78`
- Modify: `db/expense-access-rls.sql:17`

- [ ] **Step 1: Prove nothing reads it**

```bash
cd "d:/Hi-Tech doc/hitech-dashboard"
grep -rn "spending_limit" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.json" src/ supabase/ n8n/
```

Expected: no matches. If anything appears, stop and report it — the column is live after all.

- [ ] **Step 2: Append the drop and apply it**

```sql
-- Never read by any workflow, edge function or frontend, and never written by
-- admin-create-user. A column that looks like a spend control and is not one is
-- worse than no column: Habib's value was 0, which read literally would cap the
-- CEO at nothing. Values recorded in the spec if a real limit is ever built.
alter table public.wap_allowed_senders drop column if exists spending_limit;
```

Apply with `apply_migration`, name `drop_unused_spending_limit`.

- [ ] **Step 3: Verify it is gone**

```sql
select count(*) as still_there from information_schema.columns
where table_name='wap_allowed_senders' and column_name='spending_limit';
```

Expected: `still_there` = 0.

- [ ] **Step 4: Update the two docs that mention it**

In `handoff_receipt.md` line 78, remove `spending_limit` from the column list. In `db/expense-access-rls.sql` line 17, change the comment `(WhatsApp roster: may submit + spending_limit)` to `(WhatsApp roster: expense linkage + activation)`.

- [ ] **Step 5: Commit**

```bash
git add db/2026-07-28-single-identity.sql handoff_receipt.md db/expense-access-rls.sql
git commit -m "chore(db): drop spending_limit, which nothing ever enforced"
```

---

### Task 5: Roster cleanup

**Files:**
- Modify: `db/2026-07-28-single-identity.sql`

- [ ] **Step 1: Check the rows are not referenced by expenses before deleting**

```sql
select w.phone, w.employee_name, count(e.expense_id) as expense_rows
from public.wap_allowed_senders w
left join public.wap_expenses e on e.sender_phone = w.phone
where w.phone in ('923362188858','03134331423','123123123123','03159601666')
group by w.phone, w.employee_name;
```

Expected: `expense_rows` = 0 for all four. **If any is non-zero, do not delete that row** — the FK is `ON DELETE SET NULL`, so deleting would orphan real expenses from their sender. Deactivate it instead (`update … set active=false`) and note it in the commit message.

- [ ] **Step 2: Append the cleanup and apply it**

```sql
-- mawavia2 is the one deliberate loss of access: active on WhatsApp today, no
-- dashboard account, so under "only Team may message the bot" they are out.
delete from public.wap_allowed_senders
 where phone in ('923362188858','03134331423','123123123123','03159601666');

-- The active flag has been recording three different things (Taimoor false,
-- both Khizars true, none of them ever logged in). whatsapp_members reads the
-- ban instead, so reset the flag to agree rather than leave it contradicting.
update public.wap_allowed_senders w set active = true, updated_at = now()
  from public.app_users a join auth.users u on u.id = a.user_id
 where w.phone = a.phone and (u.banned_until is null or u.banned_until <= now());
```

Apply with `apply_migration`, name `roster_cleanup`.

- [ ] **Step 3: Verify the roster now mirrors Team**

```sql
select
  (select count(*) from public.wap_allowed_senders) as roster,
  (select count(*) from public.whatsapp_members)    as members,
  (select count(*) from public.wap_allowed_senders w
     where not exists (select 1 from public.app_users a where a.phone = w.phone)) as orphans;
```

Expected: `roster` = 8, `members` = 8, `orphans` = 0.

- [ ] **Step 4: Commit**

```bash
git add db/2026-07-28-single-identity.sql
git commit -m "chore(db): drop roster rows with no Team account, reset the active flag"
```

---

### Task 6: `user_id` on the history tables, and backfill

**Files:**
- Modify: `db/2026-07-28-single-identity.sql`

- [ ] **Step 1: Confirm every distinct name maps to exactly one account**

```sql
select 'wa' as ch, h."User_Number"::text as k, a.full_name
from (select distinct "User_Number" from public.n8n_chat_histories) h
left join public.app_users a on a.phone = h."User_Number"::text
union all
select 'web', h."Name", a.full_name
from (select distinct "Name" from public.web_chat_histories) h
left join public.app_users a on split_part(a.email,'@',1) = h."Name";
```

Expected: 7 rows, every `full_name` non-null — `923366179838`→Sarim, `923105603666`→Mawavia, `smsarim6`→Sarim, `mawaviahitech`→Mawavia, `habib`→Habib, `procurement`→Iftikhar, `sales01`→Asad. **A null means an unmapped author**; add it to `app_users` or accept that its rows keep a null `user_id`, but decide before running the backfill.

- [ ] **Step 2: Append the columns and backfill, and apply**

```sql
alter table public.n8n_chat_histories add column if not exists user_id uuid references public.app_users(user_id);
alter table public.web_chat_histories add column if not exists user_id uuid references public.app_users(user_id);

-- WhatsApp keys on the number, which is the one identifier the sender cannot
-- change. The Name column was contacts[0].profile.name — the sender's OWN
-- WhatsApp display name — so it was never safe to key on.
update public.n8n_chat_histories h set user_id = a.user_id
  from public.app_users a where a.phone = h."User_Number"::text and h.user_id is null;

-- Web keys on the email local-part, which is what currentUserName() stamped.
update public.web_chat_histories h set user_id = a.user_id
  from public.app_users a where split_part(a.email,'@',1) = h."Name" and h.user_id is null;

create index if not exists n8n_chat_histories_user_id_idx on public.n8n_chat_histories(user_id);
create index if not exists web_chat_histories_user_id_idx on public.web_chat_histories(user_id);
```

Apply with `apply_migration`, name `chat_history_user_id`.

- [ ] **Step 3: Verify the duplicates have collapsed**

```sql
select a.full_name, count(*) as msgs
from (select user_id from public.n8n_chat_histories
      union all select user_id from public.web_chat_histories) h
join public.app_users a on a.user_id = h.user_id
group by a.full_name order by msgs desc;
```

Expected: **one row per person** — Sarim ~167, Mawavia ~98, Habib ~26, Iftikhar ~6, Asad ~6. No `smsarim6`, no `Mawavia_Hitech_khi`. This is the screen the user complained about, proven fixed at the data layer.

- [ ] **Step 4: Verify nothing was left behind**

```sql
select
  (select count(*) from public.n8n_chat_histories where user_id is null) as wa_unmapped,
  (select count(*) from public.web_chat_histories where user_id is null) as web_unmapped;
```

Expected: both 0.

- [ ] **Step 5: Commit**

```bash
git add db/2026-07-28-single-identity.sql
git commit -m "feat(db): user_id on both chat histories, backfilled from phone and email"
```

---

### Task 7: Require a phone for every role in `admin-create-user`

**Files:**
- Modify: `supabase/functions/admin-create-user/index.ts:53-54`

- [ ] **Step 1: Replace the employee-only phone check**

Replace lines 53-54:

```ts
  if (role === 'employee' && !phone) return json({ error: 'Employees need a WhatsApp phone number (their identity)' }, 400);
  if (!realEmail && !phone) return json({ error: 'Provide an email or a phone number' }, 400);
```

with:

```ts
  // Required for EVERY role, not just employees. The phone is what links a person
  // to the WhatsApp bot (see whatsapp_members), so a Team member without one is
  // half-created: they can sign in but the bot will not answer them, with nothing
  // on screen explaining why. All eight existing rows already have a phone.
  if (!phone) return json({ error: 'A WhatsApp phone number is required — it is how the bot recognises them' }, 400);
```

- [ ] **Step 2: Update the stale header comment**

Line 3 says the roster row is written "for employees". It is written for anyone with a phone (line 106), and now that is everyone. Change the comment to:

```ts
// Creates a dashboard login + writes app_users (role/identity) and the
// wap_allowed_senders roster row. A phone is required for every role: it is the
// link to the WhatsApp bot, so one Team entry grants login, chat and receipts.
```

- [ ] **Step 3: Deploy the function**

Deploy via the Supabase MCP `deploy_edge_function` with `verify_jwt: false` (the admin check inside is the real gate — see the header comment).

- [ ] **Step 4: Verify the guard rejects a missing phone**

In the dashboard Team tab, try to add a user with a name and email but no phone.
Expected: the error `A WhatsApp phone number is required — it is how the bot recognises them`, and no auth user created. Confirm with:

```sql
select count(*) as users from public.app_users;
```

Expected: still 8.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-create-user/index.ts
git commit -m "feat(auth): require a phone for every role, not just employees"
```

---

### Task 8: Frontend — Team form and Reps grouping

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (TeamTab form; UsersTab/Reps aggregation)

- [ ] **Step 1: Find the Team form's phone field**

```bash
cd "d:/Hi-Tech doc/hitech-dashboard"
grep -n "phone" src/mawavia-dashboard.jsx | grep -in "role === 'employee'\|employee"
```

Note every line where the phone input is shown or validated conditionally on `role === 'employee'`.

- [ ] **Step 2: Make the phone unconditional and required**

Five exact sites, all in `TeamTab`:

| Line | Now | Change to |
| --- | --- | --- |
| 4005 | `&& (form.role !== 'employee' \|\| form.phone.trim())` | `&& form.phone.trim()` |
| 4012 | copy: "A phone is **required for employees**" | "A phone is **required for everyone**" |
| 4058 | `WhatsApp phone {form.role === 'employee' ? '(required)' : '(optional)'}` | `WhatsApp phone (required)` |
| 4156 | `placeholder={dr.role === 'employee' ? 'phone' : 'phone (optional)'}` | `placeholder="phone"` |
| 4157 | `aria-label={dr.role === 'employee' ? 'Phone (required)' : 'Phone (optional)'}` | `aria-label="Phone (required)"` |

Leave line 4062 (`Email … '(optional)' : '(for login)'`) alone — email genuinely still varies by role. Add `required` to the phone input and this comment above the field:

```jsx
{/* Required for every role. The phone is the link to the WhatsApp bot
    (whatsapp_members), so a Team member without one can sign in but the bot
    will never answer them — a half-created person with nothing on screen to
    explain why. The server enforces this too (admin-create-user). */}
```

- [ ] **Step 3: Fix the identity in `dashboard_stats` — this is where the duplicates are made**

The Reps list comes from the RPC, not from the raw rows. `src/mawavia-dashboard.jsx:276` says outright *"The RPC applies the same rule server-side, so both agree on identity"* — so the server and client must change together or the agreement breaks.

The `base` CTE currently builds its identity like this:

```sql
    case when c.channel = 'web' or c."User_Number" is null
         then 'web:' || coalesce(nullif(btrim(c."Name"), ''), 'Website user')
         else c."User_Number"::text
    end                                                                  as ident
```

That is the bug in one expression: WhatsApp rows key on the phone, web rows key on the display name, so one person gets two keys. Replace it with:

```sql
    -- user_id first: it is the only identifier that is the same person on both
    -- channels. The two legacy branches stay as a fallback for rows written
    -- before the backfill, so nothing vanishes from the charts — but once
    -- user_id is stamped (task 10) they stop being reached for new traffic.
    case when c.user_id is not null then 'uid:' || c.user_id::text
         when c.channel = 'web' or c."User_Number" is null
           then 'web:' || coalesce(nullif(btrim(c."Name"), ''), 'Website user')
         else c."User_Number"::text
    end                                                                  as ident
```

Fetch the current definition, apply that one substitution, and re-apply the whole function:

```sql
select pg_get_functiondef(oid) from pg_proc where proname = 'dashboard_stats';
```

- [ ] **Step 4: Check whether `MSG_SOURCE` exposes `user_id`**

Task 6 added `user_id` to the two base tables, but `base` reads a combined source with a `channel` column — if that is a view, the new column is **not** visible through it and `c.user_id` will fail to resolve.

```sql
select table_name, table_type from information_schema.tables
where table_schema='public' and table_name like '%chat%';
```

If the source is a view, recreate it with `user_id` added to its select list **before** applying Step 3. If it is a table, nothing to do.

- [ ] **Step 4a: Verify the RPC now returns one row per person**

```sql
select jsonb_array_length((public.dashboard_stats(null) -> 'users')) as rep_count;
```

Expected: 5 — Sarim, Mawavia, Habib, Iftikhar, Asad. Before the change it returns 7. If it still returns 7, `user_id` is not resolving; recheck Step 4.

- [ ] **Step 4b: Teach the client to read a `uid:` identity**

`repName` (line 92) and `initials` (line 94) both branch on `isWebRep(n)` and otherwise treat the identity as a phone, so a `uid:` key would render as a mangled phone number. The rep's real name already arrives from the RPC as `u.name`, and line 285 registers it into `_repNames` only for non-web reps:

```js
_repNames = Object.fromEntries(users.filter(u=>u.name && !isWebRep(u.number)).map(u=>[clean(u.number),u.name]));
```

Register `uid:` reps too, keyed on the raw identity rather than `clean()` (which strips non-digits and would destroy a UUID), and make `repName`/`initials` check that map before falling back to phone formatting. Then relax line 277 so it no longer overwrites an identity that the RPC already resolved:

```js
      // Only synthesise a name-based identity for rows the backfill could not
      // reach. A row with a user_id is already the same person on both channels.
      msgs.forEach(x=>{ if((x.channel==='web' || x.User_Number==null) && !x.user_id) x.User_Number = WEB + (x.Name || 'Website user'); });
```

and add `user_id` to the select at line 268:

```js
sbFetch(token, MSG_SOURCE,`select=Timestamp,User_Number,Name,user_id,User_Message,AI_Response,from_cache,channel&order=Timestamp.desc&limit=500${channelFilter!=='all'?`&channel=eq.${channelFilter}`:''}`),
```

- [ ] **Step 5: Verify the build and lint are clean**

```bash
npm run build && npx eslint src/mawavia-dashboard.jsx 2>&1 | tail -3
```

Expected: build succeeds; ESLint reports **8 problems (7 errors, 1 warning)** — the pre-existing baseline. More than 8 means this task introduced them.

- [ ] **Step 6: Verify in the browser**

Open `http://localhost:5173/`, sign in, open Reps.
Expected: one Sarim, one Mawavia. Open Team and confirm the phone field shows for an admin, not just an employee.

- [ ] **Step 7: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(ui): phone required for every role, Reps groups on user_id"
```

---

### Task 9: n8n — the gate (hand-applied)

**Files:**
- Create: `n8n/identity-gate-apply-checklist.md`

This is the risky task. It is hand-pasted into a live bot, `update_workflow` via MCP cannot be used (it regenerates from SDK code and silently drops connections), and the gate **fails closed** — a broken lookup silences the bot for the whole company.

- [ ] **Step 1: Write the checklist file**

Create `n8n/identity-gate-apply-checklist.md` documenting, for workflow `Mawavia Whatsapp Chatbot` (`E6Bi8G9MKf8tyVn0`):

Two new nodes, inserted between `WhatsApp Trigger` and `Check Msg Exist`:

**`Look Up Member`** — HTTP Request, credential `supabaseApi`, `onError: continue`:

```
={{ 'https://oocmjiuymmvwvyvwlfpd.supabase.co/rest/v1/whatsapp_members?select=user_id,full_name,role&phone=eq.' + $json.messages[0].from }}
```

**`Member?`** — Code node. It must tell "not a member" apart from "the lookup broke", because those need opposite outcomes:

```js
// The gate. Fails CLOSED by design: an unknown sender gets silence.
//
// But a Supabase outage must not read as "everyone is a stranger" — that would
// silence the bot for the whole company with no error anywhere. A lookup error
// is therefore distinguished from an empty result and rethrown, so it surfaces
// as a failed execution instead of a silent company-wide outage.
const items = $input.all();
const j = items.length ? items[0].json : null;

if (j && (j.error || j.message) && !Array.isArray(j)) {
  throw new Error('whatsapp_members lookup failed: ' + (j.message || j.error));
}

const row = Array.isArray(j) ? j[0] : (j && j.user_id ? j : null);
const trigger = $('WhatsApp Trigger').first().json;

return [{ json: {
  authorized: !!(row && row.user_id),
  user_id:    row ? row.user_id : null,
  full_name:  row ? row.full_name : null,
  role:       row ? row.role : null,
  from:       trigger.messages[0].from,
  messages:   trigger.messages,
  contacts:   trigger.contacts,
} }];
```

Then an **IF** node on `{{ $json.authorized }}` is true → `Check Msg Exist`; false → a **NoOp** named `Blocked (silent)` with nothing after it.

- [ ] **Step 2: Apply it in the n8n UI**

Follow the checklist. Do not use MCP `update_workflow`.

- [ ] **Step 3: Verify a member still gets answers**

From a number in `whatsapp_members` (e.g. Sarim's 923366179838), send `200 ton imm`.
Expected: a normal catalogue reply, and a new row in `n8n_chat_histories`.

- [ ] **Step 4: Verify a non-member gets silence**

From any number not in Team, send `hello`.
Expected: **no reply at all.** Then:

```sql
select count(*) as leaked from public.n8n_chat_histories
where "Timestamp" > now() - interval '5 minutes'
  and "User_Number"::text not in (select phone from public.whatsapp_members);
```

Expected: `leaked` = 0.

- [ ] **Step 5: Commit the checklist**

```bash
git add n8n/identity-gate-apply-checklist.md
git commit -m "feat(n8n): gate the WhatsApp bot on Team membership"
```

---

### Task 10: n8n — stamp identity instead of the profile name

**Files:**
- Modify: `n8n/identity-gate-apply-checklist.md`

Only start this once Task 9 is verified working.

- [ ] **Step 1: Add the change to the checklist**

In `Insert rows in a table` (writes `n8n_chat_histories`), change the `Name` mapping from

```
={{ $('WhatsApp Trigger').item.json.contacts[0].profile.name }}
```

to

```
={{ $('Member?').first().json.full_name }}
```

and add a `user_id` column mapped to `={{ $('Member?').first().json.user_id }}`.

- [ ] **Step 2: Apply in the n8n UI**

- [ ] **Step 3: Verify the stamp**

Send one message from a Team number, then:

```sql
select "Name", user_id is not null as has_uid
from public.n8n_chat_histories order by "Timestamp" desc limit 1;
```

Expected: `Name` is the roster name (`Sarim`, not `Mawavia_Hitech_khi`) and `has_uid` = true.

- [ ] **Step 4: Do the same for the web chat**

In `Hi-Tech Web Chat` (`JOBpBMBz05ZVmQ79`), the `Insert rows in a table` node writing `web_chat_histories` stamps `Name` from the JWT email local-part. Change it to write the caller's `user_id` and look the name up from `app_users.full_name`. Verify the same way against `web_chat_histories`.

- [ ] **Step 5: Commit**

```bash
git add n8n/identity-gate-apply-checklist.md
git commit -m "feat(n8n): stamp user_id and the roster name, not the sender's profile name"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Walk the spec's six checks**

Run each verification step from the spec's Verification section in order. All six must pass:

1. Non-member messages the bot → no reply, nothing written.
2. Member messages the bot → answer, row with correct `user_id` and `full_name`.
3. Same person on WhatsApp and web → one rep in Reps, not two.
4. Add a person in Team with a phone → login, chat and receipt all work with no further action.
5. Edit an admin in Team → phone survives, roster row follows.
6. Deactivate in Team → login, chat and receipts all stop.

- [ ] **Step 2: Check 4 is the acceptance criterion — do it for real**

Add a real person in Team with a phone. Then, without touching anything else: have them accept the invite and sign in; have them message the bot; have them send a receipt photo. All three must work.

- [ ] **Step 3: Confirm no advisor regressions**

Run the Supabase MCP `get_advisors` for both `security` and `performance`.
Expected: no new warnings versus the known-benign SECURITY DEFINER set. A new warning naming `whatsapp_members` means the grants in Task 2 need revisiting.

- [ ] **Step 4: Commit any fixes and push**

```bash
git add -A && git commit -m "test: end-to-end verification of the identity change"
git push origin main
```

---

## Rollback

If the bot goes silent for everyone, the fastest fix is to disable the `Member?` IF node in n8n (reconnect `WhatsApp Trigger` straight to `Check Msg Exist`). That restores service in seconds and leaves every database change in place, since nothing else depends on the gate.

Database rollback: `backup_20260728_*` holds the pre-change state of all three tables. `spending_limit` values are in the spec if the column has to come back.
