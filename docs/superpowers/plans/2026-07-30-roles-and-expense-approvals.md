# Roles & Expense Approvals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-role model (`admin`/`accountant`/`employee`) with a 6-role model (`dev`/`ceo`/`finance_manager`/`finance_admin`/`finance_viewer`/`employee`), and build the expense approval workflow — limits, flags, remarks and sign-off — on top of it.

**Architecture:** Every permission is carried by `app_users.role` and enforced by RLS through named `private.*` capability functions. Department stays purely descriptive. The approval workflow is a status column on `wap_expenses` plus one append-only `wap_expense_events` table that records remarks, flags and sign-offs as a single chronological trail per receipt.

**Tech Stack:** Postgres 15 + Supabase RLS, Deno Edge Functions, React 19 + Vite 8, Tailwind v4.

---

## Decisions I made for you

The request left these open. I picked an answer for each so the plan is executable. **Flip any of them and tell me — most are a one-line change in Phase A.**

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | "Employee of dept Finance" — is department a permission? | **No. Department stays descriptive; the permission is a role called `finance_viewer`.** Their card still reads "Finance". | `department` is free text typed into a combobox and it has *already* drifted in production — the roster holds `ai`/`sarim` where `app_users` holds `AI`/`Sarim`. If department became a security boundary, typing "finance" instead of "Finance" would silently grant or revoke access to every receipt in the company. Same class of bug as the three-Mawavias split. |
| 2 | What happens to `accountant`? | **Becomes `finance_admin`.** Mawavia migrates automatically. | `finance_admin` as described (review, manage, set limits) *is* today's accountant plus flag/remark/send-up. Keeping both would leave two spellings for one permission. |
| 3 | Does every expense need the manager's signature? | **No — delegated authority.** `finance_admin` approves anything **within** the person's limit. Anything over-limit is auto-flagged and **only** `finance_manager` can approve it. The manager can revoke any approval at any time. | Strict reading ("everything goes up") makes the manager approve a ₨700 rickshaw ride. With 5 sales staff submitting daily, that queue never gets cleared and the Finance records tab stays permanently empty. |
| 4 | Can the CEO act, or only look? | **Look only.** CEO reads every expense and every conversation, but cannot approve, delete, split or set limits. | "analysis of everything" is a reading verb. Also keeps the CEO out of their own approval chain. |
| 5 | Can the CEO manage the team? | **No** — Team stays `dev`-only, as asked. | Consequence worth knowing: **the CEO cannot appoint a finance manager.** Only a dev can. Say the word and I'll add a `ceo` branch to `admin_set_role`. |
| 6 | Who gets the Chat tab? | **Everyone.** | Not because the sales bot is useful to Finance — it isn't. Because **the receipt upload lives inside the chat composer** (web receipt upload, live since 2026-07-06: you attach a photo to the chat box, OCR runs, you confirm the card). Take the Chat tab off Finance and they lose the only way to submit their own receipts on the web, while still being expected to file expenses like everyone else. Splitting a receipts-only uploader out of `ChatTab` would fix that properly, but it is a separate piece of work — see below. |
| 7 | Does "manage expenses" include editing the amount? | **No.** Manage = categorise, split, flag, remark, send up, approve, reject, delete. | The photo is the evidence for the amount. An editable total with an approval stamp on it is worse than no approval at all. If you want amount edits, that's a follow-up and it must force re-approval. |

---

## Things you didn't mention that will bite

These are in the plan as real tasks, not footnotes.

1. **Nobody may approve their own expense.** Every role has a phone and a roster row, so the finance manager submits receipts like everyone else. Enforced in the RPC (Task 13), not the UI.
2. **Approving the CEO will flag him on every receipt** unless `0` is honoured. `wap_allowed_senders.spending_limit` is `0.00` for Habib, and the column comment defines `0 = no limit` — but read literally it means "zero rupees allowed". Task 13 honours the comment in SQL; Task 17 makes the UI print "No limit", never "₨0".
3. **Giving the CEO the Conversations tab without also giving him `app_users` read will re-split every rep into multiple people.** `dashboard_stats` and `conversations_page` are both SECURITY INVOKER and resolve identity *inside* the `chat_all` view, which joins `app_users` as the caller. Today only `app_users_admin_read` opens that, and it's `is_admin()`-only. Task 4.
4. **The CEO's Overview will report "Cache: 0" and it will be a lie.** `s.cacheTotal` comes from a direct client fetch of `semantic_cache` ([mawavia-dashboard.jsx:270](src/mawavia-dashboard.jsx#L270)), not from `dashboard_stats`. Deny that table and the fetch returns `[]` with a 200 — no error, just a tile that silently reads zero. Task 10 hides the tile instead.
5. **Every signed-in admin has `{"role":"admin"}` cached in localStorage.** The moment the migration lands, `navForRole('admin')` stops matching and falls through to the loading default — sales tabs, no Team, no Expenses — until the profile refetch completes. Task 9 bumps the cache key so it can't happen.
6. **`create or replace view` drops `security_invoker`.** Not triggered by this plan, but Task 4 touches policies around `chat_all` — if anyone replaces that view, re-assert it. It has already caused one full-history exposure.
7. **Storage RLS must follow the read rules or every thumbnail 403s.** `receipts_read_own_or_admin` gates on `can_view_all_expenses()`. `finance_viewer` needs an approved-only branch or their tab lists rows with broken images — and the ZIP download that just shipped signs paths in bulk through that same policy. Task 5.
8. **A rejected receipt currently vanishes from the UI.** The client fetches `status=neq.rejected` ([mawavia-dashboard.jsx:3710](src/mawavia-dashboard.jsx#L3710)). Once finance can reject, the submitter needs to *see* that it was rejected and why. Task 15.
9. **Approval has to be undoable.** People approve the wrong row. `expense_revoke_approval` is in Task 13, and every transition writes an event, so the trail survives.
10. **Advisors after every migration.** This repo has already shipped four world-readable backup tables that inspection missed and `get_advisors` caught. Tasks 11 and 18.
11. **The Chat tab is load-bearing for expenses, not just for the bot.** The web receipt uploader lives in the chat composer, so "who may use the bot" and "who may file a receipt from the website" are currently the same switch. Finance file expenses like everyone else, so the tab has to stay — and that in turn is exactly why item 1 (no self-approval) matters: the finance manager reviewing the queue is also submitting into it. Separating the uploader from the bot is the clean fix and is listed as out of scope.

---

## Out of scope (deliberately)

- **WhatsApp notification when a remark lands.** Natural next step, but it needs edits to the live n8n workflows, and `update_workflow` over MCP silently drops connections — those must be hand-edited in the n8n UI. Separate piece of work.
- **Per-category or per-department limits.** Today's limit is one monthly number per person. Left as-is.
- **Moving `spending_limit` off phone onto `user_id`.** It is the last phone-keyed thing in the expense system and it grates against the single-identity work — but it works, `expense_team_members()` already joins it, and changing it here would double the blast radius of this migration.
- **Splitting the receipt uploader out of the Chat tab.** Right now they are one screen, so "may use the sales bot" and "may file a receipt on the web" cannot be granted separately. A standalone uploader — the same drop zone, OCR card and Confirm step, mounted in the Expenses tab — would let Finance file receipts without being handed a machinery bot they have no use for, and would let the `chat` flag in `CAPS` finally mean what it says. Worth doing; not worth entangling with a role migration.

  The WhatsApp side would need its own change if you ever pursue this: `whatsapp_members` grants bot access to **anyone with a phone**, and `admin_set_role` requires a phone for every role, so the same person is reachable on WhatsApp regardless of what the website shows. Filtering that view by role is a one-line edit, but check in the n8n UI **first** whether the receipt workflow gates on `whatsapp_members` or on `wap_allowed_senders` — if it is the former, the filter would stop Finance submitting receipts by WhatsApp too, which is the same own-goal in a different channel.

---

## Role → capability matrix

This table is the spec. Phase A implements it; every later task refers back to it.

| Capability | `dev` | `ceo` | `finance_manager` | `finance_admin` | `finance_viewer` | `employee` |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Overview / Conversations / Reps | ✅ | ✅ | — | — | — | — |
| Cache tab | ✅ | — | — | — | — | — |
| Team tab (create/edit logins & roles) | ✅ | — | — | — | — | — |
| Chat (Hi Tech AI **+ receipt upload**) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See **all** expenses | ✅ | ✅ | ✅ | ✅ | — | — |
| See **approved** expenses | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| See **own** expenses | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Split / delete / set limits | ✅ | — | — | ✅ | — | — |
| Flag / unflag, add remarks | ✅ | — | ✅ | ✅ | — | — |
| Approve within limit | ✅ | — | ✅ | ✅ | — | — |
| Approve **over** limit | ✅ | — | ✅ | — | — | — |
| Reject | ✅ | — | ✅ | ✅ | — | — |
| Revoke an approval | ✅ | — | ✅ | — | — | — |

Departments stay free text and stay descriptive: `AI`, `CEO`, `Finance`, `Media`, `Sales`, `Technical`.

## Expense status machine

```
  logged ──────────────────────────────► approved
  (intake, unchanged)     finance_admin (within limit)
     │                    finance_manager (any)
     │                          ▲
     │                          │
     └──► pending_approval ─────┘
          finance_admin sends up,      finance_manager approves
          or auto on over-limit flag

  any ──► rejected        (finance_admin | finance_manager)
  approved ──► logged     (finance_manager revokes)
```

`logged` is kept as the intake state on purpose. **n8n writes `'logged'` on every WhatsApp and web receipt**, and the live workflows can only be edited by hand in the n8n UI — so renaming it to `submitted` would mean either a coordinated deploy or silently broken intake. Nothing about the intake path changes in this plan.

`flagged` is a **separate boolean, not a status.** A receipt can be flagged *and* pending *and* then approved anyway, with the flag surviving as a permanent note on the record. Fold flagging into status and approving a receipt erases the reason it was ever questioned.

## Existing data at migration time

8 accounts, 8 roster rows. The migration maps them:

| Person | Dept | Today | After |
|---|---|---|---|
| Sarim | AI | `admin` | `dev` |
| Habib | CEO | `admin` | `dev` → **set to `ceo` by hand** (see Task 3) |
| Mawavia | Media | `accountant` | `finance_admin` |
| Asad, Iftikhar, Khizar Altaf, Taimoor Nasir | Sales | `employee` | `employee` |
| Khizar Hussain | Technical | `employee` | `employee` |

There is no `finance_manager` and no `finance_viewer` yet — you create those two people in the Team tab after Phase A ships.

---

## File structure

**Database (new):**
- `db/roles-and-approvals.sql` — the repo record for everything in Phase A + B, in the house style: what changed, why, and the impersonation probes that prove it.

**Database (modified):**
- `db/expense-access-rls.sql` — add a pointer at the role table to say the role list moved.

**Client (new):**
- `src/caps.js` — one map from role → capability booleans, plus role labels. Cosmetic only; the loud comment saying so is part of the file.

**Client (modified):**
- `src/mawavia-dashboard.jsx` — nav, role display, Team role picker, Expenses gating, approval UI, Overview cache tile.
- `src/expenses-actions.js` *(new)* — the RPC wrappers for approve/reject/flag/remark, kept out of the 5,000-line component.

**Edge Functions (modified):**
- `supabase/functions/admin-create-user/index.ts` — admin check + role allow-list.
- `supabase/functions/admin-manage-user/index.ts` — admin check.

---

# PHASE A — the role model

**Phase A ships on its own.** At the end of it the six roles exist, every tab and every table is gated correctly, and nothing about expenses has changed except who can see them. Deploy and use it before starting Phase B.

---

### Task 1: Prove the current gates, so the change has a baseline

No code. This is the "write the failing test" step — in this repo a test is an impersonation probe, because there is no test runner (`package.json` has `dev`/`build`/`lint`/`preview` only).

**Files:** none.

- [ ] **Step 1: Record who is who**

```sql
select a.role, a.department, a.full_name,
       (u.banned_until is not null and u.banned_until > now()) as banned
from public.app_users a join auth.users u on u.id = a.user_id
order by a.role, a.full_name;
```

Expected: 2 `admin`, 1 `accountant`, 5 `employee`. Save this output — Task 3 diffs against it.

- [ ] **Step 2: Prove the role names that do not exist yet are refused**

```sql
begin;
update public.app_users set role = 'ceo' where full_name = 'Habib';
rollback;
```

Expected: `ERROR: new row for relation "app_users" violates check constraint "app_users_role_check"`.

- [ ] **Step 3: Capture the impersonation harness you will reuse in every later task**

Save this snippet; every verification step below is a variation of it. **Run probes this way, never over the plain MCP/superuser connection** — `dashboard_stats`, `conversations_page` and `chat_all` are all SECURITY INVOKER, so a superuser connection bypasses every policy they actually run under and reports a clean result that a real login does not get.

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
  -- probe goes here
rollback;
```

Get the uuids once:

```sql
select user_id, full_name, role from public.app_users order by full_name;
```

---

### Task 2: Capability functions

**Files:**
- Migration: `role_capability_functions`
- Record: `db/roles-and-approvals.sql` (create)

- [ ] **Step 1: Write the failing probe**

```sql
select private.can_read_chats();
```

Expected: `ERROR: function private.can_read_chats() does not exist`.

- [ ] **Step 2: Apply the migration**

Migration name: `role_capability_functions`

```sql
-- One function reads the column; every other capability derives from it. A new
-- role means editing this file and nothing else.
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
revoke all on function private.can_read_chats()              from public;
revoke all on function private.can_manage_cache()            from public;
revoke all on function private.can_view_all_expenses()       from public;
revoke all on function private.can_view_approved_expenses()  from public;
revoke all on function private.can_manage_expenses()         from public;
revoke all on function private.can_approve_expenses()        from public;
revoke all on function private.can_approve_over_limit()      from public;

grant execute on function private.my_role()                    to authenticated;
grant execute on function private.is_dev()                     to authenticated;
grant execute on function private.can_read_chats()             to authenticated;
grant execute on function private.can_manage_cache()           to authenticated;
grant execute on function private.can_view_all_expenses()      to authenticated;
grant execute on function private.can_view_approved_expenses() to authenticated;
grant execute on function private.can_manage_expenses()        to authenticated;
grant execute on function private.can_approve_expenses()       to authenticated;
grant execute on function private.can_approve_over_limit()     to authenticated;
```

`can_view_all_expenses()` is **redefined, not created** — it already exists and is referenced by five policies. `create or replace` swaps the body in place; a `drop` would be refused.

- [ ] **Step 3: Verify the probe now passes**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<sarim-uuid>","role":"authenticated"}';
  select private.my_role(), private.is_dev(), private.can_read_chats(),
         private.can_view_all_expenses(), private.can_manage_expenses();
rollback;
```

Expected right now: `admin, false, false, false, false` — Sarim is still spelled `admin`, and every new function correctly refuses a role it has never heard of. That is the fail-closed default working. Task 3 flips the data.

- [ ] **Step 4: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(roles): capability functions for the six-role model"
```

---

### Task 3: Migrate the role column

This is the lockout-risk task. Everything in it goes in **one migration = one transaction**, so there is no instant where the data and the constraint disagree.

**Files:**
- Migration: `roles_dev_ceo_finance`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Write the failing probe**

```sql
select role, count(*) from public.app_users group by role order by role;
```

Expected: `accountant 1, admin 2, employee 5`.

- [ ] **Step 2: Apply the migration**

Migration name: `roles_dev_ceo_finance`

Order matters: the constraint must come **off** before the data moves, or the `update` fails against the old CHECK, and it must go back **on** after, or a typo can land.

```sql
-- 1) Constraint off, data across, constraint back on — one transaction.
alter table public.app_users drop constraint app_users_role_check;

update public.app_users set role = 'dev'           where role = 'admin';
update public.app_users set role = 'finance_admin' where role = 'accountant';

alter table public.app_users add constraint app_users_role_check
  check (role in ('dev','ceo','finance_manager','finance_admin','finance_viewer','employee'));

-- 2) admin_set_role's allow-list. Without this the Team panel cannot save ANY
--    role: it validates against a hardcoded list that no longer matches reality.
--    Body is otherwise the live 2026-07-24 version (db/expense-accountant-tools.sql §8)
--    reproduced unchanged, so the roster upsert and the phone rule survive.
create or replace function public.admin_set_role(
  p_target uuid, p_role text, p_phone text default null,
  p_full_name text default null, p_department text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text; clean_name text; clean_dept text;
begin
  if not private.is_dev() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_role not in ('dev','ceo','finance_manager','finance_admin','finance_viewer','employee') then
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

-- 3) admin_list_users: same is_admin -> is_dev swap, body otherwise unchanged.
create or replace function public.admin_list_users()
returns table(user_id uuid, email text, role text, phone text, full_name text,
              department text, banned boolean, active boolean, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_dev() then raise exception 'not authorized' using errcode = '42501'; end if;
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
```

- [ ] **Step 3: Verify the counts moved**

```sql
select role, count(*) from public.app_users group by role order by role;
```

Expected: `dev 2, employee 5, finance_admin 1`.

- [ ] **Step 4: Put Habib on the CEO role**

He is `dev` after the automatic map (he was `admin`), and the request says CEO. Do it explicitly so it is a recorded decision, not a side effect:

```sql
update public.app_users set role = 'ceo' where full_name = 'Habib';
select full_name, role, department from public.app_users order by full_name;
```

Expected: `Habib | ceo | CEO`, `Sarim | dev | AI`, `Mawavia | finance_admin | Media`, five `employee`.

**Sarim must stay `dev`** — he is the only account that can reach the Team tab, and demoting both devs is an unrecoverable lockout that needs a service-key repair.

- [ ] **Step 5: Verify the capability functions now answer correctly**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<sarim-uuid>","role":"authenticated"}';
  select private.my_role() r, private.is_dev() dev, private.can_read_chats() chats,
         private.can_manage_cache() cache, private.can_view_all_expenses() allexp,
         private.can_manage_expenses() manage, private.can_approve_over_limit() over;
rollback;
```

Expected for Sarim (`dev`): `dev, t, t, t, t, t, t`.

Repeat for Habib (`ceo`) — expect `ceo, f, t, f, t, f, f` — and Mawavia (`finance_admin`) — expect `finance_admin, f, f, f, t, t, f`.

- [ ] **Step 6: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(roles): migrate admin->dev, accountant->finance_admin, add ceo"
```

---

### Task 4: Repoint the chat / cache / team policies

`is_admin()` is still what gates the chat tables, so right now the CEO can reach nothing. Split the one predicate into two.

**Files:**
- Migration: `chat_and_cache_policies_by_capability`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Write the failing probe**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<habib-uuid>","role":"authenticated"}';
  select count(*) as chats from public.chat_all;
rollback;
```

Expected now: `0`. The CEO cannot see a single message.

- [ ] **Step 2: Apply the migration**

Migration name: `chat_and_cache_policies_by_capability`

```sql
-- Conversations / Reps / Overview: dev + ceo.
drop policy if exists admin_read on public.n8n_chat_histories;
drop policy if exists admin_read on public.chat_archive;
create policy chats_read on public.n8n_chat_histories
  for select to authenticated using (private.can_read_chats());
create policy chats_read on public.chat_archive
  for select to authenticated using (private.can_read_chats());

-- web_chat_histories is the third source behind chat_all. It is listed
-- separately because db/security-rls.sql predates it and never covered it.
alter table public.web_chat_histories enable row level security;
drop policy if exists admin_read on public.web_chat_histories;
drop policy if exists chats_read on public.web_chat_histories;
create policy chats_read on public.web_chat_histories
  for select to authenticated using (private.can_read_chats());
grant select on public.web_chat_histories to authenticated;
revoke select on public.web_chat_histories from anon;

-- The Cache tab stays dev-only.
drop policy if exists admin_read on public.semantic_cache;
create policy cache_read on public.semantic_cache
  for select to authenticated using (private.can_manage_cache());

-- chat_feedback: same reading audience as the transcript it annotates.
drop policy if exists admin_read on public.chat_feedback;
create policy feedback_read on public.chat_feedback
  for select to authenticated using (private.can_read_chats());

-- Identity resolution. chat_all joins app_users INSIDE the view, and the view is
-- security_invoker, so this join runs as the caller. Without this policy the CEO
-- resolves only his own identity and every other person re-splits into one rep
-- per channel — the exact "three Mawavias, two Sarims" bug that
-- db/2026-07-28-single-identity.sql §7b was written to fix.
drop policy if exists app_users_admin_read on public.app_users;
create policy app_users_staff_read on public.app_users
  for select to authenticated
  using (private.can_read_chats() or private.can_view_all_expenses());
```

- [ ] **Step 3: Verify the CEO now reads chats but not the cache**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<habib-uuid>","role":"authenticated"}';
  select (select count(*) from public.chat_all)      as chats,
         (select count(*) from public.semantic_cache) as cache,
         jsonb_array_length(public.dashboard_stats(null) -> 'users') as reps;
rollback;
```

Expected: `chats 384, cache 0, reps 6`.

**`reps` must be 6, not 8.** 8 means the `app_users` policy did not take and identities are re-splitting.

- [ ] **Step 4: Verify an employee still gets nothing**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<asad-uuid>","role":"authenticated"}';
  select (select count(*) from public.chat_all)       as chats,
         (select count(*) from public.semantic_cache)  as cache,
         (select count(*) from public.app_users)       as people;
rollback;
```

Expected: `0, 0, 1` — Asad sees only his own `app_users` row, via the untouched `app_users_self_read` policy.

- [ ] **Step 5: Verify `chat_all` still runs as the caller**

```sql
select relname, reloptions from pg_class where relname = 'chat_all';
```

Expected: `{security_invoker=on}`. If this is null, RLS above is decorative and every employee can read the whole history — stop and re-assert `alter view public.chat_all set (security_invoker = on);`.

- [ ] **Step 6: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(roles): split chat access from cache access, open identity read to staff"
```

---

### Task 5: Expense and storage policies

**Files:**
- Migration: `expense_policies_by_capability`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Write the failing probe**

There is no `finance_viewer` yet, so borrow an account for the duration of the probe:

```sql
begin;
  update public.app_users set role = 'finance_viewer' where full_name = 'Khizar Hussain';
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<khizar-hussain-uuid>","role":"authenticated"}';
  select count(*) from public.wap_expenses;
rollback;
```

Expected now: only his own rows. He should be seeing every approved receipt.

- [ ] **Step 2: Apply the migration**

Migration name: `expense_policies_by_capability`

```sql
-- Everything the old policy allowed, plus one branch: approved receipts are
-- visible to the finance records-keeper. can_view_all_expenses() is a subset of
-- can_view_approved_expenses(), so that branch only ever fires for finance_viewer.
drop policy if exists wap_expenses_self_or_accountant on public.wap_expenses;
create policy wap_expenses_read on public.wap_expenses
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or (status = 'approved' and private.can_view_approved_expenses())
    or user_id = (select auth.uid())
    or (sender_phone is not null and sender_phone = private.my_phone())
    or exists (
      select 1 from public.wap_expense_splits s
       where s.expense_id = wap_expenses.expense_id
         and (s.user_id = (select auth.uid())
              or (s.sender_phone is not null and s.sender_phone = private.my_phone()))
    )
  );

-- ⚠️ CORRECTED AFTER A LIVE FAILURE. The obvious form of the last branch —
-- `exists (select 1 from public.wap_expenses e where ... e.status = 'approved')`
-- — closes an RLS CYCLE: wap_expenses_read already contains an EXISTS against
-- wap_expense_splits, so pointing the splits policy back at wap_expenses makes
-- each policy need the other expanded first. Postgres detects that structurally,
-- not by data, so it raised `42P17: infinite recursion detected in policy for
-- relation "wap_expenses"` for EVERY role on a bare `select count(*)` — the
-- Expenses tab hard-errored for every signed-in user, not just finance_viewer.
--
-- The fix is a SECURITY DEFINER helper, the same pattern every other private.*
-- function here uses: it bypasses RLS, so the dependency stays one-directional.
create or replace function private.expense_is_approved(p_expense_id text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.wap_expenses e
     where e.expense_id = p_expense_id and e.status = 'approved'
  );
$$;
revoke all on function private.expense_is_approved(text) from public;
grant execute on function private.expense_is_approved(text) to authenticated;

drop policy if exists wap_splits_self_or_accountant on public.wap_expense_splits;
create policy wap_splits_read on public.wap_expense_splits
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or user_id = (select auth.uid())
    or (sender_phone is not null and sender_phone = private.my_phone())
    or (private.can_view_approved_expenses()
        and private.expense_is_approved(wap_expense_splits.expense_id))
  );

drop policy if exists wap_senders_self_or_accountant on public.wap_allowed_senders;
create policy wap_senders_read on public.wap_allowed_senders
  for select to authenticated
  using ( private.can_view_approved_expenses() or phone = private.my_phone() );

-- Storage. Miss this and finance_viewer's tab lists rows whose every thumbnail
-- 403s — and the bulk ZIP export signs paths through this same policy, so their
-- "download all" would silently come back short.
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
         where e.image_path = storage.objects.name
           and e.status = 'approved'
           and private.can_view_approved_expenses()
      )
      or exists (
        select 1 from public.wap_expenses e
          join public.wap_expense_splits s on s.expense_id = e.expense_id
         where e.image_path = storage.objects.name
           and s.sender_phone = private.my_phone()
      )
    )
  );

-- Deletion of the stored photo follows the manage capability, not the view one:
-- the CEO can see every receipt but must not be able to destroy one.
drop policy if exists receipts_delete_accountant on storage.objects;
create policy receipts_delete_manage on storage.objects
  for delete to authenticated
  using ( bucket_id = 'receipts' and private.can_manage_expenses() );
```

- [ ] **Step 3: Verify each role sees the right slice**

```sql
create temporary table probe(who text, role text, expenses int, senders int);

do $$
declare r record; n int; m int;
begin
  for r in select user_id, full_name, role from public.app_users loop
    execute format('set local role authenticated');
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', r.user_id, 'role','authenticated')::text);
    select count(*) into n from public.wap_expenses;
    select count(*) into m from public.wap_allowed_senders;
    insert into probe values (r.full_name, r.role, n, m);
    reset role;
  end loop;
end $$;

select * from probe order by role, who;
```

Expected: `dev`/`ceo`/`finance_admin` see every expense; each `employee` sees only rows that are theirs or that they are split into.

- [ ] **Step 4: Verify the CEO cannot destroy anything**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<habib-uuid>","role":"authenticated"}';
  select public.admin_delete_expense('<any-expense-id>', 'probe');
rollback;
```

Expected: `ERROR: not authorized` (SQLSTATE 42501). `admin_delete_expense` still gates on `can_view_all_expenses()`, which now *includes* the CEO — so this probe **will pass when it should fail** until Task 6 tightens it. Record the failure and move on.

- [ ] **Step 5: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(roles): expense + storage policies read from capability functions"
```

---

### Task 6: Tighten the manage RPCs

Task 5 widened `can_view_all_expenses()` to include the CEO, which silently handed him delete and split. Close it.

**Files:**
- Migration: `manage_rpcs_require_manage_capability`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Confirm the hole is real**

Re-run Task 5 Step 4. Expected: it **succeeds**, deleting a row inside a rolled-back transaction. That is the bug.

- [ ] **Step 2: Apply the migration**

Migration name: `manage_rpcs_require_manage_capability`

Four functions change one line each — the guard. Every other line is the live body, reproduced so the function is replaced whole.

```sql
-- admin_delete_expense: guard only.
create or replace function public.admin_delete_expense(p_expense_id text, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare row_rec public.wap_expenses;
begin
  if not private.can_manage_expenses() then
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
  delete from public.wap_expenses where expense_id = p_expense_id;
  return row_rec.image_path;
end; $$;

create or replace function public.admin_clear_expense_split(p_expense_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.can_manage_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.wap_expense_splits where expense_id = p_expense_id;
  get diagnostics n = row_count;
  return n;
end; $$;
```

`admin_set_expense_split` and `admin_set_spending_limit` were redefined by the 2026-07-24 `split_picker_uses_team_members_not_roster` migration and their live bodies are **not** in the repo files. Fetch each one, swap `private.can_view_all_expenses()` for `private.can_manage_expenses()`, and re-apply:

```sql
select pg_get_functiondef('public.admin_set_expense_split(text,jsonb)'::regprocedure);
select pg_get_functiondef('public.admin_set_spending_limit(text,numeric)'::regprocedure);
```

- [ ] **Step 3: Verify the CEO is refused and the finance admin is not**

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<habib-uuid>","role":"authenticated"}';
  select public.admin_delete_expense('<any-expense-id>', 'probe');
rollback;
```

Expected: `ERROR: not authorized`, SQLSTATE `42501`.

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<mawavia-uuid>","role":"authenticated"}';
  select public.admin_set_spending_limit('923104309666', 50000);
rollback;
```

Expected: `50000.00`.

- [ ] **Step 4: Prove no stale predicate survives**

```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and pg_get_functiondef(p.oid) like '%can_view_all_expenses%'
order by 1;
```

Expected: `expense_team_members` only — it is a read, and read is correct there.

- [ ] **Step 5: Retire `private.is_admin()`**

```sql
drop function private.is_admin();
```

Expected: success. **If Postgres refuses**, a policy or function you have not repointed still depends on it — read the error, fix that object, retry. A successful drop is the proof that nothing references the old predicate.

- [ ] **Step 6: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "fix(roles): delete/split/limits need manage, not view — the CEO had both"
```

---

### Task 7: Edge Functions

Both functions hardcode `'admin'`. After Task 3 nobody holds that string, so **the Team tab is dead until this ships** — no one can create or deactivate a login.

**Files:**
- Modify: `supabase/functions/admin-create-user/index.ts:42,56`
- Modify: `supabase/functions/admin-manage-user/index.ts:35`

- [ ] **Step 1: Confirm both are broken**

```bash
grep -n "'admin'" supabase/functions/*/index.ts
```

Expected: three hits — `admin-create-user:42`, `admin-create-user:56`, `admin-manage-user:35`.

- [ ] **Step 2: Fix `admin-create-user`**

Line 42:

```ts
  if (prof?.role !== 'dev') return json({ error: 'Not authorized (devs only)' }, 403);
```

Line 56:

```ts
  const ROLES = ['dev', 'ceo', 'finance_manager', 'finance_admin', 'finance_viewer', 'employee'];
  if (!ROLES.includes(role)) return json({ error: 'Pick a valid role' }, 400);
```

- [ ] **Step 3: Fix `admin-manage-user`**

Line 35:

```ts
  if (prof?.role !== 'dev') return json({ error: 'Not authorized (devs only)' }, 403);
```

- [ ] **Step 4: Deploy both**

```bash
supabase functions deploy admin-create-user --no-verify-jwt
supabase functions deploy admin-manage-user --no-verify-jwt
```

`--no-verify-jwt` is required: these do custom auth internally and browsers send an unauthenticated CORS preflight. The admin check inside the function is the real gate.

- [ ] **Step 5: Verify from the app**

Sign in as Sarim, open Team, create a throwaway `finance_viewer` with a spare phone number. Expected: it saves, appears in the list, and gets a `wap_allowed_senders` row.

```sql
select a.full_name, a.role, w.phone is not null as rostered
from public.app_users a
left join public.wap_allowed_senders w on w.phone = a.phone
where a.role = 'finance_viewer';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-create-user/index.ts supabase/functions/admin-manage-user/index.ts
git commit -m "feat(roles): edge functions accept the six-role model"
```

---

### Task 8: Client capability map

**Files:**
- Create: `src/caps.js`

- [ ] **Step 1: Write the file**

```js
// Role → what the UI shows. ONE map, mirroring the private.* functions in
// db/roles-and-approvals.sql.
//
// ⚠️  THIS IS COSMETIC. Not one of these booleans is a security boundary. The
// database refuses the same things via RLS and the SECURITY DEFINER guard in
// every RPC, and it refuses them to a crafted REST call that never loads this
// file. What this map buys is a UI that doesn't offer a button the server will
// reject. If it ever disagrees with the SQL, the SQL is right.

// `chats` is READING the transcript (Conversations / Reps). `chat` is the Chat
// TAB. Two different things that both sound like "chat" — hence the two names.
//
// `chat` is true for every role, and it is not about the bot: the web receipt
// uploader lives inside the chat composer, so this flag also controls whether a
// person can file their own expenses from the website. Setting it false for
// Finance would leave them owing receipts with no way to submit one.
export const CAPS = {
  dev: {
    label: 'Developer', tone: 'accent',
    chats: true, cache: true, team: true, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: true, approve: true, approveOverLimit: true,
  },
  ceo: {
    label: 'CEO', tone: 'accent',
    chats: true, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: false, approve: false, approveOverLimit: false,
  },
  finance_manager: {
    label: 'Finance Manager', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: false, approve: true, approveOverLimit: true,
  },
  finance_admin: {
    label: 'Finance Admin', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: true, approve: true, approveOverLimit: false,
  },
  finance_viewer: {
    label: 'Finance', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: false, approvedExpenses: true,
    manage: false, approve: false, approveOverLimit: false,
  },
  employee: {
    label: 'Employee', tone: 'muted',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: false, approvedExpenses: false,
    manage: false, approve: false, approveOverLimit: false,
  },
};

// An unknown or not-yet-loaded role gets the most restrictive answer, never an
// elevated one. Same fail-closed rule as useProfile's 'employee' fallback.
export const capsFor = role => CAPS[role] || CAPS.employee;

// The Team tab's role picker. Order is deliberate: most privileged first, so the
// dangerous option is never the one you land on by accident.
export const ROLE_CHOICES = [
  { value: 'dev',             label: 'Developer',       desc: 'Everything — all tabs, all data, manages the team' },
  { value: 'ceo',             label: 'CEO',             desc: 'All analytics + every expense, read-only. No Cache, no Team' },
  { value: 'finance_manager', label: 'Finance Manager', desc: 'Approves expenses, including over-limit ones' },
  { value: 'finance_admin',   label: 'Finance Admin',   desc: 'Reviews & manages expenses, sets limits, flags, remarks' },
  { value: 'finance_viewer',  label: 'Finance (records)', desc: 'Read-only view of approved expenses' },
  { value: 'employee',        label: 'Employee',        desc: 'Chatbot + only their own expenses' },
];
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run lint && npm run build
```

Expected: no errors. (Nothing imports it yet, so this only proves syntax.)

- [ ] **Step 3: Commit**

```bash
git add src/caps.js
git commit -m "feat(roles): one client-side capability map for the six roles"
```

---

### Task 9: Wire the client to the new roles

**Files:**
- Modify: `src/mawavia-dashboard.jsx:350` (`ROLE_LS`)
- Modify: `src/mawavia-dashboard.jsx:4177-4181` (`ROLE_CHOICES`)
- Modify: `src/mawavia-dashboard.jsx:4703-4717` (`navForRole`, `ROLE_META`)
- Modify: `src/mawavia-dashboard.jsx:4362` (Team tab gate)
- Modify: `src/mawavia-dashboard.jsx:5085` (channel chips gate)

- [ ] **Step 1: Bump the profile cache key**

At line 350. **This is the one that prevents a support call.** Every currently signed-in admin has `{"role":"admin"}` in localStorage under `ht_role`; on first load after the migration `navForRole('admin')` matches nothing and falls through to the loading default — sales tabs, no Team, no Expenses — until the background refetch lands. A new key means the cache misses once and reads fresh.

```js
const ROLE_LS = 'ht_role_v2';   // v2: the admin/accountant spellings are gone (2026-07-30)
```

- [ ] **Step 2: Replace `ROLE_CHOICES`**

Delete lines 4177-4181 entirely and import the shared one. At the top of the file, beside the other local imports:

```js
import { capsFor, ROLE_CHOICES } from './caps';
```

- [ ] **Step 3: Rewrite `navForRole` and `ROLE_META`**

Replace lines 4698-4717:

```js
// Which tabs a role may see. Derived from the capability map so this list and
// the RLS in db/roles-and-approvals.sql cannot drift into disagreeing.
//
// c.chats = may READ the transcript (Conversations, Reps, Overview).
// c.chat  = has the Chat TAB. True for everyone, because that tab is also the
//           web receipt uploader — the flag stays in the map rather than being
//           hardcoded so it can be withdrawn once uploading lives on its own.
function navForRole(role) {
  const c = capsFor(role);
  const nav = [];
  if (c.chats) nav.push(...SALES_NAV.filter(n => n.id !== 'chat' && (n.id !== 'cache' || c.cache)));
  if (c.allExpenses || c.approvedExpenses) nav.push(EXPENSES_NAV);
  else nav.push({ ...EXPENSES_NAV, label: 'My Expenses', sub: 'Your receipts & spend' });
  if (c.chat) nav.push(SALES_NAV.find(n => n.id === 'chat'));
  if (c.team) nav.push(TEAM_NAV);
  return nav;
}

// Role display (shown in the header for everyone).
const ROLE_META = Object.fromEntries(
  Object.entries(CAPS).map(([role, c]) => [role, {
    label: c.label,
    color: c.tone === 'accent' ? BLUE : c.tone === 'pos' ? POS : 'var(--muted)',
  }]),
);
```

Extend the import from Step 2 to `import { CAPS, capsFor, ROLE_CHOICES } from './caps';`.

Note the tab **order** changed: expenses now come before Chat for everyone, where before an employee got `[myExpenses, chat]` and an admin got Chat in the middle of the sales block. That is intentional — one ordering rule for every role.

- [ ] **Step 4: Fix the two remaining hardcoded role checks**

Line 4362, inside `TeamTab`:

```js
  if (!capsFor(role).team) {
```

Line 5085, the channel filter chips:

```js
          {capsFor(role).chats && ['overview','conversations','users'].includes(tab) && (
```

- [ ] **Step 5: Prove no hardcoded role string survives**

```bash
grep -rn "'admin'\|'accountant'\|role === 'employee'" src/
```

Expected: no hits. Every remaining decision goes through `capsFor()`.

- [ ] **Step 6: Verify**

```bash
npm run lint && npm run build
```

Then sign in as each of Sarim (`dev`), Habib (`ceo`) and Mawavia (`finance_admin`) and confirm the tab set matches the capability matrix. Habib must have **no Cache tab and no Team tab**.

- [ ] **Step 7: Commit**

```bash
git add src/mawavia-dashboard.jsx src/caps.js
git commit -m "feat(roles): nav, role badges and team picker read the capability map"
```

---

### Task 10: Hide the Cache tile from anyone who cannot read the cache

`s.cacheTotal` comes from the direct `semantic_cache` fetch at line 270, not from `dashboard_stats`. Denied by RLS it returns `[]` with a 200 — so the CEO's Overview renders **Cache · 0**, which is not zero, it is "none of your business" printed as a fact.

**Files:**
- Modify: `src/mawavia-dashboard.jsx:767-780` (`OverviewTab` tiles)
- Modify: `src/mawavia-dashboard.jsx:5100-5115` (pass the prop)

- [ ] **Step 1: Reproduce it**

Sign in as Habib. Overview shows a Cache tile reading `0`.

- [ ] **Step 2: Make the tile conditional**

`OverviewTab` gains a `showCache` prop, and the tile at line 775 is filtered out when it is false:

```js
function OverviewTab({s, onDrill, showCache}) {
```

and where the tile array is built:

```js
    // The cache count comes from a direct semantic_cache fetch, which RLS empties
    // for anyone without can_manage_cache(). An empty array renders as 0, which
    // reads as "the cache is empty" rather than "you can't see it" — so the tile
    // is removed rather than shown lying.
    ...(showCache ? [{label:'Cache', value:s.cacheTotal, hint:'Answers served instantly from cache — no AI call'}] : []),
```

- [ ] **Step 3: Pass it at the call site**

```js
              {tab==='overview' && <OverviewTab s={stats} onDrill={goDrill} showCache={capsFor(role).cache}/>}
```

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
```

As Habib: no Cache tile, and the "From cache / AI calls" tiles on Overview still show real numbers — those come from `dashboard_stats`'s `from_cache` column on the chat rows, which he *can* read. As Sarim: the Cache tile is back.

- [ ] **Step 5: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "fix(overview): Cache tile read 0 for roles that simply can't see the cache"
```

---

### Task 11: Phase A verification sweep

**Files:** none — this is the gate before Phase B.

- [ ] **Step 1: Run the advisors**

Use `get_advisors` for both `security` and `performance`.

Expected: **0 ERROR-level**. The known, documented survivors are the SECURITY DEFINER admin RPCs (each re-checks its capability), the two always-true INSERT policies on `chat_feedback` and `client_errors`, and INFO notices about the `backup_20260728_*` tables having RLS and no policies. Anything else is new and yours.

- [ ] **Step 2: Confirm `whatsapp_members` is still service-role only**

```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'whatsapp_members';
```

Expected: `service_role | SELECT` and nothing else. It is a definer-rights view exposing every colleague's phone number; a grant to `authenticated` hands the staff directory to any login.

- [ ] **Step 3: Full role sweep from the browser**

Sign in as each real account and walk every tab. Check at 360px too — the nav is a bottom sheet on mobile and the role badge sits in the header.

| Account | Expect exactly |
|---|---|
| Sarim (`dev`) | Overview, Conversations, Reps, Cache, Expenses, Chat, Team |
| Habib (`ceo`) | Overview, Conversations, Reps, Expenses, Chat |
| Mawavia (`finance_admin`) | Expenses, Chat |
| Asad (`employee`) | My Expenses, Chat |

Mawavia is the one to look at twice: a two-tab dashboard is easy to render as an empty shell. Confirm Expenses is selected on load, that the logo click goes there rather than to a tab she does not have (`homeTab` already falls back to `nav[0]`), and that she can still **attach a receipt in the Chat composer** — that path is how Finance file their own expenses, and it is the reason the Chat tab is granted to every role.

- [ ] **Step 4: Commit the repo record**

```bash
git add db/roles-and-approvals.sql
git commit -m "docs(db): record the six-role model and its verification"
```

**Phase A is shippable here.** Deploy, let people use it for a day, then start Phase B.

---

# PHASE B — approvals, limits, flags and remarks

---

### Task 12: Status, flags and the event log

**Files:**
- Migration: `expense_approval_schema`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Write the failing probe**

```sql
select flagged from public.wap_expenses limit 1;
```

Expected: `ERROR: column "flagged" does not exist`.

- [ ] **Step 2: Apply the migration**

Migration name: `expense_approval_schema`

```sql
-- 'logged' is KEPT as the intake state. n8n writes it on every WhatsApp and web
-- receipt, and those workflows can only be edited by hand in the n8n UI, so
-- renaming it would mean a coordinated deploy or silently broken intake.
alter table public.wap_expenses drop constraint wap_expenses_status_check;
alter table public.wap_expenses add constraint wap_expenses_status_check
  check (status in ('logged','pending_approval','approved','rejected'));

-- Flag is a BOOLEAN, not a status. A receipt can be flagged, sent up, and then
-- approved anyway with the flag surviving as the permanent note of why it was
-- ever questioned. Fold it into status and approving erases that.
alter table public.wap_expenses
  add column if not exists flagged      boolean not null default false,
  add column if not exists flag_reason  text,
  add column if not exists approved_by  uuid references auth.users(id),
  add column if not exists approved_at  timestamptz;

create index if not exists wap_expenses_status_idx  on public.wap_expenses (status);
create index if not exists wap_expenses_flagged_idx on public.wap_expenses (flagged) where flagged;

-- One append-only trail per receipt: remarks, flags and sign-offs in one
-- chronological list, which is what the UI renders anyway. A single `remark`
-- column would let the second remark destroy the first and would carry no
-- author — unacceptable in a ledger, and the reason wap_expense_deletions
-- exists in the same shape.
create table if not exists public.wap_expense_events (
  id          uuid primary key default gen_random_uuid(),
  expense_id  text not null references public.wap_expenses(expense_id) on delete cascade,
  kind        text not null check (kind in
                ('remark','flag','unflag','submit_for_approval','approve','revoke_approval','reject')),
  body        text,
  -- Lets finance keep an internal note. Default true because the request was
  -- "remarks reflected on sales emp" — visible is the norm, hidden the exception.
  visible_to_employee boolean not null default true,
  actor       uuid references auth.users(id),
  -- Snapshot: the trail must still read correctly after someone changes role.
  actor_role  text,
  actor_name  text,
  -- What was approved. Without it, an approval stamp says nothing about the
  -- number it was given for.
  amount_at_event numeric,
  created_at  timestamptz not null default now()
);
alter table public.wap_expense_events enable row level security;
create index if not exists wap_expense_events_expense_idx
  on public.wap_expense_events (expense_id, created_at desc);

-- Read: anyone who can see the expense can see its trail, except that an
-- employee sees only the entries marked visible.
grant select on public.wap_expense_events to authenticated;
create policy wap_expense_events_read on public.wap_expense_events
  for select to authenticated
  using (
    private.can_view_all_expenses()
    or (
      visible_to_employee
      and exists (
        select 1 from public.wap_expenses e
         where e.expense_id = wap_expense_events.expense_id
           and (e.user_id = (select auth.uid())
                or (e.sender_phone is not null and e.sender_phone = private.my_phone())
                or (e.status = 'approved' and private.can_view_approved_expenses()))
      )
    )
  );

-- Writes go exclusively through the RPCs in Task 13. Same Finding A hardening as
-- every other table here: RLS refusing the write is one layer, and the grant
-- being absent is the second.
revoke insert, update, delete, truncate, references, trigger
  on public.wap_expense_events from authenticated;
revoke all on public.wap_expense_events from anon;
```

- [ ] **Step 3: Verify the shape**

```sql
select status, count(*) from public.wap_expenses group by status;
select count(*) from public.wap_expense_events;
```

Expected: every existing row still `logged`, 0 events. No backfill — nothing has genuinely been approved, and pretending otherwise would put a signature on records nobody signed.

- [ ] **Step 4: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(expenses): approval status, flags and an append-only event trail"
```

---

### Task 13: Limit checking + the approval RPCs

**Files:**
- Migration: `expense_approval_rpcs`
- Record: `db/roles-and-approvals.sql`

- [ ] **Step 1: Write the failing probe**

```sql
select public.expense_month_usage('<asad-uuid>', '2026-07-01'::date);
```

Expected: `ERROR: function public.expense_month_usage(...) does not exist`.

- [ ] **Step 2: Apply the migration**

Migration name: `expense_approval_rpcs`

```sql
-- ── Month-to-date usage vs the cap ──────────────────────────────────────────
-- Returns the person's calendar-month total and their limit. Definer-rights so
-- an employee can be told "you are at 4,200 of 5,000" without being handed read
-- access to anyone else's rows.
--
-- ⚠️  0 MEANS NO LIMIT, not zero rupees. The column comment has said so since
-- 2026-07-24 and Habib's row is literally 0.00 — read it literally and the CEO
-- is flagged on every receipt he ever submits. Callers must print "No limit".
--
-- Uses the receipt TOTAL, not the split share: splits are a correction applied
-- after the fact, so at insert time there is nothing to apportion. Re-run
-- expense_recheck_limit() after saving a split.
create or replace function public.expense_month_usage(p_user uuid, p_month date)
returns table(spent numeric, cap numeric, over boolean)
language plpgsql security definer stable set search_path = '' as $$
declare v_phone text; v_cap numeric; v_spent numeric;
begin
  select a.phone into v_phone from public.app_users a where a.user_id = p_user;
  select w.spending_limit into v_cap
    from public.wap_allowed_senders w where w.phone = v_phone;

  select coalesce(sum(e.total), 0) into v_spent
    from public.wap_expenses e
   where e.status <> 'rejected'
     and (e.user_id = p_user or (v_phone is not null and e.sender_phone = v_phone))
     and date_trunc('month', coalesce(e.date, e.processed_at::date))
         = date_trunc('month', p_month);

  return query select v_spent,
                      coalesce(v_cap, 0),
                      coalesce(v_cap, 0) > 0 and v_spent > coalesce(v_cap, 0);
end; $$;
revoke all on function public.expense_month_usage(uuid, date) from public, anon;
grant execute on function public.expense_month_usage(uuid, date) to authenticated;


-- ── Auto-flag on insert ─────────────────────────────────────────────────────
-- A TRIGGER, not client code: WhatsApp receipts arrive from n8n over the service
-- role and never touch the app at all. This is the only place both intake paths
-- pass through.
create or replace function private.flag_when_over_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u record; owner uuid;
begin
  owner := coalesce(new.user_id,
                    (select a.user_id from public.app_users a where a.phone = new.sender_phone));
  if owner is null then return new; end if;

  select * into u from public.expense_month_usage(
    owner, coalesce(new.date, new.processed_at::date));

  if u.over then
    new.flagged := true;
    new.flag_reason := format('Over the monthly limit: %s of %s PKR spent this month',
                              round(u.spent), round(u.cap));
  end if;
  return new;
end; $$;

drop trigger if exists wap_expenses_flag_over_limit on public.wap_expenses;
create trigger wap_expenses_flag_over_limit
  before insert on public.wap_expenses
  for each row execute function private.flag_when_over_limit();


-- ── The workflow ────────────────────────────────────────────────────────────
-- Every transition writes an event. One helper keeps the trail consistent.
create or replace function private.log_expense_event(
  p_expense_id text, p_kind text, p_body text default null,
  p_visible boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select role, full_name into a from public.app_users where user_id = (select auth.uid());
  insert into public.wap_expense_events
    (expense_id, kind, body, visible_to_employee, actor, actor_role, actor_name, amount_at_event)
  values
    (p_expense_id, p_kind, nullif(btrim(coalesce(p_body,'')), ''), p_visible,
     (select auth.uid()), a.role, a.full_name,
     (select total from public.wap_expenses where expense_id = p_expense_id));
end; $$;

-- Nobody approves their own receipt. Every role has a phone and a roster row, so
-- the finance manager submits expenses like everyone else — this is the single
-- most obvious way an approval workflow becomes theatre.
create or replace function private.is_own_expense(p_expense_id text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.wap_expenses e
     where e.expense_id = p_expense_id
       and (e.user_id = (select auth.uid())
            or (e.sender_phone is not null and e.sender_phone = private.my_phone()))
  );
$$;

create or replace function public.expense_add_remark(
  p_expense_id text, p_body text, p_visible boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.can_manage_expenses() or private.can_approve_expenses()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_body,'')), '') is null then
    raise exception 'a remark needs some text' using errcode = '22023';
  end if;
  perform private.log_expense_event(p_expense_id, 'remark', p_body, p_visible);
end; $$;

create or replace function public.expense_set_flag(
  p_expense_id text, p_flagged boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.wap_expenses
     set flagged = p_flagged,
         flag_reason = case when p_flagged then nullif(btrim(coalesce(p_reason,'')),'') end,
         updated_at = now()
   where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;
  perform private.log_expense_event(
    p_expense_id, case when p_flagged then 'flag' else 'unflag' end, p_reason);
end; $$;

create or replace function public.expense_submit_for_approval(
  p_expense_id text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.wap_expenses set status = 'pending_approval', updated_at = now()
   where expense_id = p_expense_id and status in ('logged','rejected');
  if not found then
    raise exception 'that expense is not waiting to be sent up' using errcode = '22023';
  end if;
  perform private.log_expense_event(p_expense_id, 'submit_for_approval', p_note);
end; $$;

-- The delegated-authority rule lives here: within limit, a finance_admin signs
-- off; flagged (which is what over-limit sets) requires the manager.
create or replace function public.expense_approve(
  p_expense_id text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare is_flagged boolean;
begin
  if not private.can_approve_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if private.is_own_expense(p_expense_id) then
    raise exception 'you cannot approve your own expense' using errcode = '42501';
  end if;

  select flagged into is_flagged from public.wap_expenses where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;
  if is_flagged and not private.can_approve_over_limit() then
    raise exception 'this one is flagged — only the finance manager can approve it'
      using errcode = '42501';
  end if;

  update public.wap_expenses
     set status = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), updated_at = now()
   where expense_id = p_expense_id;
  perform private.log_expense_event(p_expense_id, 'approve', p_note);
end; $$;

create or replace function public.expense_revoke_approval(
  p_expense_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_approve_over_limit() then
    raise exception 'only the finance manager can revoke an approval'
      using errcode = '42501';
  end if;
  update public.wap_expenses
     set status = 'logged', approved_by = null, approved_at = null, updated_at = now()
   where expense_id = p_expense_id and status = 'approved';
  if not found then
    raise exception 'that expense is not approved' using errcode = '22023';
  end if;
  perform private.log_expense_event(p_expense_id, 'revoke_approval', p_reason);
end; $$;

create or replace function public.expense_reject(
  p_expense_id text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.can_manage_expenses() or private.can_approve_expenses()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if private.is_own_expense(p_expense_id) then
    raise exception 'you cannot reject your own expense' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'a rejection needs a reason — the submitter will see it'
      using errcode = '22023';
  end if;
  update public.wap_expenses
     set status = 'rejected', approved_by = null, approved_at = null, updated_at = now()
   where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;
  perform private.log_expense_event(p_expense_id, 'reject', p_reason);
end; $$;

-- Re-evaluate a flag after a split changed who owes what.
create or replace function public.expense_recheck_limit(p_expense_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e record; u record; owner uuid;
begin
  if not private.can_manage_expenses() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into e from public.wap_expenses where expense_id = p_expense_id;
  if not found then
    raise exception 'no such expense: %', p_expense_id using errcode = 'P0002';
  end if;
  owner := coalesce(e.user_id,
                    (select a.user_id from public.app_users a where a.phone = e.sender_phone));
  if owner is null then return false; end if;
  select * into u from public.expense_month_usage(owner, coalesce(e.date, e.processed_at::date));
  update public.wap_expenses
     set flagged = u.over,
         flag_reason = case when u.over then
           format('Over the monthly limit: %s of %s PKR spent this month',
                  round(u.spent), round(u.cap)) end,
         updated_at = now()
   where expense_id = p_expense_id;
  return u.over;
end; $$;

revoke all on function public.expense_add_remark(text,text,boolean)  from public, anon;
revoke all on function public.expense_set_flag(text,boolean,text)    from public, anon;
revoke all on function public.expense_submit_for_approval(text,text) from public, anon;
revoke all on function public.expense_approve(text,text)             from public, anon;
revoke all on function public.expense_revoke_approval(text,text)     from public, anon;
revoke all on function public.expense_reject(text,text)              from public, anon;
revoke all on function public.expense_recheck_limit(text)            from public, anon;

grant execute on function public.expense_add_remark(text,text,boolean)  to authenticated;
grant execute on function public.expense_set_flag(text,boolean,text)    to authenticated;
grant execute on function public.expense_submit_for_approval(text,text) to authenticated;
grant execute on function public.expense_approve(text,text)             to authenticated;
grant execute on function public.expense_revoke_approval(text,text)     to authenticated;
grant execute on function public.expense_reject(text,text)              to authenticated;
grant execute on function public.expense_recheck_limit(text)            to authenticated;
```

- [ ] **Step 3: Verify "0 means no limit"**

```sql
select * from public.expense_month_usage(
  (select user_id from public.app_users where full_name = 'Habib'), current_date);
```

Expected: `over = false`, whatever `spent` says. If this returns `true`, the CEO is about to be flagged on every receipt — stop and fix the `> 0` guard.

- [ ] **Step 4: Verify self-approval is refused**

Create a probe receipt owned by Mawavia, then have Mawavia try to approve it:

```sql
begin;
  insert into public.wap_expenses (expense_id, total, sender_phone, employee_name, status)
  values ('PROBE-SELF', 100, '923105603666', 'Mawavia', 'logged');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<mawavia-uuid>","role":"authenticated"}';
  select public.expense_approve('PROBE-SELF');
rollback;
```

Expected: `ERROR: you cannot approve your own expense`, SQLSTATE `42501`.

- [ ] **Step 5: Verify a flagged receipt refuses the finance admin**

```sql
begin;
  insert into public.wap_expenses (expense_id, total, sender_phone, employee_name, status, flagged)
  values ('PROBE-FLAG', 100, '923104309666', 'Asad', 'logged', true);
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<mawavia-uuid>","role":"authenticated"}';
  select public.expense_approve('PROBE-FLAG');
rollback;
```

Expected: `ERROR: this one is flagged — only the finance manager can approve it`.

- [ ] **Step 6: Verify the auto-flag trigger fires**

Asad's cap is 50,000. Insert one receipt above it:

```sql
begin;
  insert into public.wap_expenses (expense_id, total, sender_phone, employee_name, status, date)
  values ('PROBE-OVER', 999999, '923104309666', 'Asad', 'logged', current_date);
  select expense_id, flagged, flag_reason from public.wap_expenses where expense_id = 'PROBE-OVER';
rollback;
```

Expected: `flagged = true`, and a reason naming both numbers.

- [ ] **Step 7: Verify the employee sees the remark and not the internal one**

```sql
begin;
  insert into public.wap_expenses (expense_id, total, sender_phone, employee_name, status)
  values ('PROBE-REM', 100, '923104309666', 'Asad', 'logged');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<mawavia-uuid>","role":"authenticated"}';
  select public.expense_add_remark('PROBE-REM', 'Please attach the itemised bill', true);
  select public.expense_add_remark('PROBE-REM', 'Third time this month', false);
  reset role;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<asad-uuid>","role":"authenticated"}';
  select kind, body from public.wap_expense_events where expense_id = 'PROBE-REM';
rollback;
```

Expected: **exactly one row** — "Please attach the itemised bill". The internal note must not appear.

- [ ] **Step 8: Confirm no probe rows survived**

```sql
select count(*) from public.wap_expenses where expense_id like 'PROBE-%';
```

Expected: `0`. Every probe above is inside a `rollback`; this proves it.

- [ ] **Step 9: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "feat(expenses): limits, auto-flagging and the approval RPCs"
```

---

### Task 14: Client action wrappers

**Files:**
- Create: `src/expenses-actions.js`

- [ ] **Step 1: Write the file**

```js
// RPC wrappers for the expense approval workflow. Kept out of
// mawavia-dashboard.jsx, which is already 5,000 lines.
//
// None of these is a permission check. Each RPC re-checks the caller's
// capability server-side and raises 42501, so calling one you are not entitled
// to fails at the database. What the UI does with capsFor() is decide which
// buttons to draw.
import { SB_URL, SB_KEY } from './config';
import { getAccessToken } from './auth';

async function rpc(name, args) {
  const token = await getAccessToken();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    // Postgres RAISE messages are written for the person reading them, so
    // surface them rather than replacing them with a generic failure.
    throw new Error(d.message || d.hint || `Request failed (HTTP ${r.status})`);
  }
  return r.json().catch(() => null);
}

export const addRemark        = (id, body, visible = true) =>
  rpc('expense_add_remark', { p_expense_id: id, p_body: body, p_visible: visible });
export const setFlag          = (id, flagged, reason) =>
  rpc('expense_set_flag', { p_expense_id: id, p_flagged: flagged, p_reason: reason || null });
export const submitForApproval = (id, note) =>
  rpc('expense_submit_for_approval', { p_expense_id: id, p_note: note || null });
export const approve          = (id, note) =>
  rpc('expense_approve', { p_expense_id: id, p_note: note || null });
export const revokeApproval   = (id, reason) =>
  rpc('expense_revoke_approval', { p_expense_id: id, p_reason: reason || null });
export const reject           = (id, reason) =>
  rpc('expense_reject', { p_expense_id: id, p_reason: reason });
export const recheckLimit     = id =>
  rpc('expense_recheck_limit', { p_expense_id: id });

// Status vocabulary, shared by the badge and the filter chips.
export const STATUS_META = {
  logged:           { label: 'Submitted', tone: 'muted' },
  pending_approval: { label: 'Awaiting approval', tone: 'warn' },
  approved:         { label: 'Approved', tone: 'pos' },
  rejected:         { label: 'Rejected', tone: 'neg' },
};
```

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/expenses-actions.js
git commit -m "feat(expenses): client wrappers for the approval RPCs"
```

---

### Task 15: Show status, flags and remarks on a receipt

**Files:**
- Modify: `src/mawavia-dashboard.jsx:3710` (fetch the new columns + stop hiding rejected)
- Modify: `src/mawavia-dashboard.jsx:2927` (`ReceiptRow`)

- [ ] **Step 1: Reproduce the gap**

Sign in as Asad. A rejected receipt of his is simply absent from the list — no row, no reason, nothing to act on.

- [ ] **Step 2: Fetch the new columns and keep rejected rows**

At line 3710, extend the select and drop the `status=neq.rejected` filter:

```js
          sbFetch(token, 'wap_expenses',
            'select=expense_id,user_id,employee_name,department,category,total,subtotal,tax,currency,payment_method,vendor_name,date,processed_at,drive_link,image_path,ai_confidence,items,status,flagged,flag_reason,approved_by,approved_at,sender_phone&order=processed_at.desc&limit=2000'),
```

The filter went in when `rejected` meant "the OCR produced garbage". It now also means "finance refused this", and a submitter who cannot see the refusal cannot act on it. Totals must exclude rejected rows explicitly instead — find every `reduce` over `rows` in `ExpensesTab` and filter `r.status !== 'rejected'` first, so a refused receipt is visible without being counted as spend.

- [ ] **Step 3: Add the events fetch**

Alongside the existing three parallel fetches in the same `Promise.all`:

```js
          sbFetch(token, 'wap_expense_events',
            'select=id,expense_id,kind,body,actor_name,actor_role,created_at&order=created_at.desc&limit=2000'),
```

RLS scopes it: finance gets every trail, an employee gets only the visible entries on their own receipts.

- [ ] **Step 4: Render the badges and the trail in `ReceiptRow`**

`ReceiptRow` gains `events`, `caps` and `onAction`. In the collapsed row, beside the amount:

```jsx
        {r.flagged && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}
                title={r.flag_reason || 'Flagged for review'}>Flagged</span>
        )}
        {r.status !== 'logged' && (
          <span className="text-[11px] px-1.5 py-0.5 rounded"
                style={{ color: STATUS_META[r.status]?.tone === 'pos' ? POS
                              : STATUS_META[r.status]?.tone === 'neg' ? NEG : 'var(--muted)' }}>
            {STATUS_META[r.status]?.label || r.status}
          </span>
        )}
```

In the expanded body, the trail — newest first, the same order the fetch returns:

```jsx
        {rowEvents.length > 0 && (
          <div className="mt-3 border-t border-zinc-200 pt-3">
            <Label>Remarks & history</Label>
            <ul className="mt-1.5 space-y-1.5">
              {rowEvents.map(ev => (
                <li key={ev.id} className="text-[12.5px] leading-snug min-w-0">
                  <span className="font-medium">{ev.actor_name || 'Finance'}</span>
                  <span className="text-zinc-500"> · {EVENT_VERB[ev.kind] || ev.kind} · {fmtDate(ev.created_at)}</span>
                  {ev.body && <p className="text-zinc-700 break-words">{ev.body}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
```

with, beside the other module-level constants:

```js
const EVENT_VERB = {
  remark: 'left a remark', flag: 'flagged this', unflag: 'cleared the flag',
  submit_for_approval: 'sent this for approval', approve: 'approved',
  revoke_approval: 'revoked the approval', reject: 'rejected',
};
```

`break-words` and `min-w-0` are load-bearing: a remark is free text and a 40-character unbroken string otherwise pushes the panel wider than a 320px screen.

- [ ] **Step 5: Verify on mobile**

```bash
npm run lint && npm run build && npm run dev
```

Check at **320, 360 and 412px**. The badge row must wrap rather than push the amount off-screen, and every button stays a 44px touch target. Do the width arithmetic before assuming it fits.

- [ ] **Step 6: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(expenses): show status, flags and the remark trail on each receipt"
```

---

### Task 16: The action buttons

**Files:**
- Modify: `src/mawavia-dashboard.jsx:2927` (`ReceiptRow` action bar)

- [ ] **Step 1: Add the action bar**

In the expanded body, beneath the trail. Each button appears only when the capability map says the server would accept it:

```jsx
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {caps.manage && r.status === 'logged' && (
            <ActionBtn onClick={() => run(() => submitForApproval(r.expense_id))}>
              Send for approval
            </ActionBtn>
          )}
          {caps.approve && r.status !== 'approved' && !isOwn && (
            <ActionBtn
              onClick={() => run(() => approve(r.expense_id))}
              disabled={r.flagged && !caps.approveOverLimit}
              title={r.flagged && !caps.approveOverLimit
                ? 'Flagged as over-limit — the finance manager approves this one'
                : 'Approve this expense'}>
              Approve
            </ActionBtn>
          )}
          {caps.approveOverLimit && r.status === 'approved' && (
            <ActionBtn onClick={() => askReason('Revoke this approval?', reason =>
              run(() => revokeApproval(r.expense_id, reason)))}>
              Revoke approval
            </ActionBtn>
          )}
          {(caps.manage || caps.approve) && r.status !== 'rejected' && !isOwn && (
            <ActionBtn tone="neg" onClick={() => askReason('Why is this rejected?', reason =>
              run(() => reject(r.expense_id, reason)))}>
              Reject
            </ActionBtn>
          )}
          {caps.manage && (
            <ActionBtn onClick={() => setRemarkOpen(true)}>Add remark</ActionBtn>
          )}
          {caps.manage && (
            <ActionBtn onClick={() => run(() => setFlag(r.expense_id, !r.flagged))}>
              {r.flagged ? 'Clear flag' : 'Flag'}
            </ActionBtn>
          )}
        </div>
        {actionErr && <p role="alert" className="text-[12px] mt-2" style={{ color: NEG }}>{actionErr}</p>}
```

`isOwn` mirrors `private.is_own_expense()` so the UI does not offer a button the server will refuse:

```js
  const isOwn = r.user_id === myUserId
             || (r.sender_phone && r.sender_phone === myPhone);
```

and `run` funnels every action through one busy/error path, refetching on success so the row can never show a state the database does not hold:

```js
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');
  const run = async (fn) => {
    setBusy(true); setActionErr('');
    try { await fn(); onChanged?.(); }
    catch (e) { setActionErr(e.message); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 2: Pass `caps` and identity down**

In `ExpensesTab`, replace `const isEmployee = role === 'employee';` at line 3669:

```js
  const caps = capsFor(role);
  const isEmployee = !caps.allExpenses && !caps.approvedExpenses;
```

and hand `caps`, `myUserId`, `myPhone` and `events` to each `ReceiptRow`. `canManage` (already a prop) becomes `caps.manage`.

- [ ] **Step 3: Recheck the flag after a split**

`SplitEditor`'s save path already calls `admin_set_expense_split`. Chain the recheck so a receipt reassigned away from someone stops being flagged against them:

```js
      await sbRpc(token, 'admin_set_expense_split', { p_expense_id: receipt.expense_id, p_shares: shares });
      await recheckLimit(receipt.expense_id);
```

- [ ] **Step 4: Verify each role's buttons**

```bash
npm run lint && npm run build
```

| Signed in as | On a normal receipt | On a flagged receipt | On their own |
|---|---|---|---|
| `finance_admin` | Send for approval, Approve, Reject, Add remark, Flag | Approve **disabled** with the tooltip | no Approve, no Reject |
| `finance_manager` | Approve, Reject | Approve **enabled** | no Approve, no Reject |
| `ceo` | none | none | none |
| `employee` | none — sees status + visible remarks only | none | none |

- [ ] **Step 5: Verify the server refuses a forged call**

The buttons are cosmetic; prove the boundary. As Habib (`ceo`), from the browser console:

```js
await fetch(`${SB_URL}/rest/v1/rpc/expense_approve`, {
  method:'POST',
  headers:{ apikey: SB_KEY, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
  body: JSON.stringify({ p_expense_id: '<any>' }),
}).then(r => r.json());
```

Expected: `{ code: '42501', message: 'not authorized' }`.

- [ ] **Step 6: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(expenses): approve, reject, flag and remark from the receipt row"
```

---

### Task 17: Status filter + limit display

**Files:**
- Modify: `src/mawavia-dashboard.jsx` (`ExpensesTab` filter row, `BudgetPanel` at 3326)

- [ ] **Step 1: Add status chips beside the category filter**

Same derived-not-stored pattern as `cat` — a status that is not present this month self-corrects to `all`, so the view can never be filtered to nothing with no way back:

```js
  const [statusSel, setStatus] = useState('all');
  const statusesPresent = useMemo(
    () => [...new Set(focusRows.map(r => r.status))],
    [focusRows]);
  const status = statusesPresent.includes(statusSel) ? statusSel : 'all';
  const byStatus = useCallback(
    list => (status === 'all' ? list : list.filter(r => r.status === status)),
    [status]);
```

For `finance_manager`, default the chip to `pending_approval` — that is their queue and it is the reason they opened the tab.

- [ ] **Step 2: Print "No limit" for a cap of 0**

In `BudgetPanel` at line 3326, wherever the cap renders:

```jsx
  {Number(m.spending_limit) > 0
    ? fmtPKR(m.spending_limit)
    : <span className="text-zinc-500">No limit</span>}
```

`0` is the documented "no limit" value and Habib's row holds it. Rendered as `₨0` it reads as "this person may spend nothing", which is the opposite of what it means.

- [ ] **Step 3: Verify**

```bash
npm run lint && npm run build
```

Check at 320px that the status chips wrap onto their own line rather than squeezing the month picker.

- [ ] **Step 4: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat(expenses): filter by approval status, show 0 as 'No limit'"
```

---

### Task 18: Final verification

**Files:**
- Modify: `db/roles-and-approvals.sql` (append the verification block)

- [ ] **Step 1: Advisors**

`get_advisors` for `security` and `performance`. Expected: **0 ERROR**. `wap_expense_events` has RLS with a read policy and no write grant, which is the intent.

- [ ] **Step 2: End-to-end, in the browser, with real accounts**

1. As Asad, submit a receipt through the chat box → it lands as **Submitted**.
2. As Mawavia (`finance_admin`), open it → **Add remark** "Please attach the itemised bill".
3. As Asad, reopen it → the remark is visible, attributed to Mawavia, with a date.
4. As Mawavia, **Approve** → it becomes **Approved**.
5. As the `finance_viewer` account → the receipt appears, with its image, and nothing that is still Submitted does.
6. As Mawavia, submit a receipt over Asad's 50,000 cap → it arrives **Flagged**, and **Approve** is disabled with the tooltip.
7. As the `finance_manager` account → **Approve** is enabled on that same receipt.
8. As the finance manager, try to approve one of your **own** receipts → refused, with the server's message shown.

- [ ] **Step 3: Confirm the trail is complete**

```sql
select e.expense_id, e.kind, e.actor_name, e.actor_role, e.amount_at_event, e.created_at
from public.wap_expense_events e
order by e.created_at desc limit 20;
```

Every transition from Step 2 must be present, in order, with an actor.

- [ ] **Step 4: Write the record**

Append to `db/roles-and-approvals.sql`, in the house style used by `db/expense-accountant-tools.sql`: what each role may do, the probes that were run, and their measured results. That file is what the next person reads instead of re-deriving the model.

- [ ] **Step 5: Commit**

```bash
git add db/roles-and-approvals.sql
git commit -m "docs(db): record the approval workflow and its verification"
```

---

## Self-review

**Spec coverage**

| Requested | Task |
|---|---|
| admin → dev, full control | 3, 9 |
| finance_manager: approves, views all | 2, 5, 13, 16 |
| finance_admin: review, manage, set limits, request approval, flag, remarks | 2, 6, 13, 16, 17 |
| remarks reflected on sales emp | 12 (RLS), 15 (render) |
| CEO: all analysis, all convos + employees, no team, no cache | 2, 4, 9, 10 |
| employee Sales/Technical: chatbot + own expenses | 8, 9 |
| employee dept Finance: all approved expenses | 2, 5 (`finance_viewer`) |

**Placeholder scan:** clean — every code step carries the code, every command its expected output. Two places deliberately say "fetch the live body first" (Task 6 Step 2, for `admin_set_expense_split` and `admin_set_spending_limit`) because those two functions were redefined by a migration and their current bodies are *not* in the repo; pasting the stale repo version would silently revert the 2026-07-24 team-members fix. The step gives the exact `pg_get_functiondef` calls.

**Type consistency:** `capsFor()` returns the same key set everywhere (`chats`, `cache`, `team`, `allExpenses`, `approvedExpenses`, `manage`, `approve`, `approveOverLimit`). SQL predicates map one-to-one: `can_read_chats`/`can_manage_cache`/`is_dev`/`can_view_all_expenses`/`can_view_approved_expenses`/`can_manage_expenses`/`can_approve_expenses`/`can_approve_over_limit`. Status strings are identical in the CHECK constraint, `STATUS_META` and every RPC: `logged`, `pending_approval`, `approved`, `rejected`. Event kinds match between the CHECK and `EVENT_VERB`.

**Known residue, accepted:**
- `spending_limit` stays keyed on phone while everything else keys on `user_id`. Documented in Task 13; moving it would double this migration's blast radius.
- Auto-flagging uses the receipt total, not the post-split share. `expense_recheck_limit()` (Task 13) is the correction, wired into the split save in Task 16 Step 3.
