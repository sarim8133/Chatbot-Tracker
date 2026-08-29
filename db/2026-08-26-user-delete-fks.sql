-- ============================================================================
-- Deleting a team member from the Team tab always failed with an empty "{}"
-- error. Nothing was wrong with the Edge Function or the caller's role: the
-- delete was rejected by Postgres.
--
-- app_users.user_id is ON DELETE CASCADE from auth.users, so removing the login
-- tries to remove the profile row too. But seven columns point AT that profile
-- row (and two more point straight at auth.users), and every one of them was
-- declared with a bare `references ...` -- i.e. ON DELETE NO ACTION. One chat
-- message or one receipt is therefore enough to veto the whole delete.
--
-- Measured on 2026-08-26: 8 of 10 accounts were un-deletable for this reason
-- (Sarim 602 blocking rows, Mawavia 230, Habib 31, ... ). The only two that
-- would have worked were the two people who had never chatted or filed a
-- receipt -- which is why this looked like "delete is broken" rather than
-- "delete is broken for people who have used the system".
--
-- Fix: SET NULL, not CASCADE. Both the chat history and wap_expenses are audit
-- records -- the conversation log and the money trail have to outlive the
-- account, and they still carry sender_phone / employee_name to say whose they
-- were. CASCADE here would mean firing someone silently shreds their receipts.
--
-- Run once in the Supabase SQL editor. Idempotent: re-running finds nothing to
-- change and prints "already ON DELETE SET NULL" for each constraint.
-- ============================================================================

-- 1) The profile row must still follow the login out the door. -----------------
-- Everything below assumes this is CASCADE; assert rather than trust, because
-- if it ever became NO ACTION the delete would fail with the same empty error
-- and none of the work below would explain it.
do $$
declare
  con record;
begin
  select c.conname, c.confdeltype into con
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where c.contype = 'f' and n.nspname = 'public' and t.relname = 'app_users'
     and c.confrelid = 'auth.users'::regclass;

  if not found then
    raise exception 'app_users has no FK to auth.users -- schema is not what this migration expects';
  elsif con.confdeltype <> 'c' then
    execute format('alter table public.app_users drop constraint %I', con.conname);
    execute format('alter table public.app_users add constraint %I
                      foreign key (user_id) references auth.users(id) on delete cascade', con.conname);
    raise notice 'app_users.user_id -> auth.users: repaired to ON DELETE CASCADE';
  else
    raise notice 'app_users.user_id -> auth.users: already ON DELETE CASCADE';
  end if;
end $$;


-- 2) Every other reference to a person becomes ON DELETE SET NULL. -------------
-- Discovered from the catalogue rather than hard-coded, because four of these
-- FKs (wap_expenses.user_id, wap_expense_splits.user_id/created_by,
-- wap_expense_deletions.deleted_by) were added straight in Supabase and have
-- never been in this repo -- a hand-written list would have missed them and
-- delete would still fail.
do $$
declare
  c            record;
  child_cols   text;
  parent_cols  text;
  all_nullable boolean;
begin
  for c in
    select con.conname, con.confdeltype, con.conkey, con.confkey,
           con.conrelid, con.confrelid,
           src.relname  as child_table,
           tgtns.nspname || '.' || tgt.relname as parent_rel
      from pg_constraint con
      join pg_class     src   on src.oid   = con.conrelid
      join pg_namespace srcns on srcns.oid = src.relnamespace
      join pg_class     tgt   on tgt.oid   = con.confrelid
      join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
     where con.contype = 'f'
       and srcns.nspname = 'public'
       and (   (tgtns.nspname = 'public' and tgt.relname = 'app_users')
            or (tgtns.nspname = 'auth'   and tgt.relname = 'users') )
       -- app_users itself is handled above, and must stay CASCADE.
       and not (src.relname = 'app_users')
     order by src.relname, con.conname
  loop
    if c.confdeltype = 'n' then
      raise notice '% (%): already ON DELETE SET NULL', c.child_table, c.conname;
      continue;
    end if;

    select string_agg(quote_ident(a.attname), ', ' order by k.ord),
           bool_and(not a.attnotnull)
      into child_cols, all_nullable
      from unnest(c.conkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum;

    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into parent_cols
      from unnest(c.confkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum;

    -- SET NULL on a NOT NULL column compiles fine and then fails at delete
    -- time, which would put us right back here with a different opaque error.
    if not all_nullable then
      raise warning '% (% -> %): SKIPPED, % is NOT NULL. Decide CASCADE or make it nullable before deletes will work.',
        c.child_table, child_cols, c.parent_rel, child_cols;
      continue;
    end if;

    execute format('alter table public.%I drop constraint %I', c.child_table, c.conname);
    execute format('alter table public.%I add constraint %I foreign key (%s) references %s (%s) on delete set null',
                   c.child_table, c.conname, child_cols, c.parent_rel, parent_cols);
    raise notice '% (% -> %): now ON DELETE SET NULL', c.child_table, child_cols, c.parent_rel;
  end loop;
end $$;


-- 3) Verify. Deliberately NOT limited to `public`: the repair above only touches
-- schemas we own, so this is the check that nothing in a schema Supabase manages
-- (auth's own tables, storage.objects) is still holding the door shut. Anything
-- reading "STILL BLOCKS DELETE" outside auth.* is the next thing to fix.
select srcns.nspname || '.' || src.relname  as child_table,
       con.conname                          as constraint_name,
       tgtns.nspname || '.' || tgt.relname  as points_at,
       case con.confdeltype when 'a' then 'NO ACTION -- STILL BLOCKS DELETE'
                            when 'r' then 'RESTRICT -- STILL BLOCKS DELETE'
                            when 'c' then 'CASCADE'
                            when 'n' then 'SET NULL'
                            when 'd' then 'SET DEFAULT' end as on_delete
  from pg_constraint con
  join pg_class     src   on src.oid   = con.conrelid
  join pg_namespace srcns on srcns.oid = src.relnamespace
  join pg_class     tgt   on tgt.oid   = con.confrelid
  join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
 where con.contype = 'f'
   and (   (tgtns.nspname = 'public' and tgt.relname = 'app_users')
        or (tgtns.nspname = 'auth'   and tgt.relname = 'users') )
 order by con.confdeltype in ('a','r') desc, 1, 2;
