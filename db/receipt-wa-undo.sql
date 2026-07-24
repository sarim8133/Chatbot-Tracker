-- WhatsApp receipt intake: link an expense row to the summary message we sent,
-- so a reaction on that message can be resolved back to exactly one expense.
--
-- The WhatsApp Cloud API delivers a reaction as an inbound message of
-- type "reaction", carrying reaction.message_id = the WAMID of the message that
-- was reacted to. That WAMID is the only handle we get, so it has to be stored
-- on the row when we send the summary.
--
-- Nullable on purpose: web receipts never have one, and a WhatsApp receipt has
-- none until the summary send succeeds.

alter table public.wap_expenses
  add column if not exists wa_message_id text;

comment on column public.wap_expenses.wa_message_id is
  'WAMID of the WhatsApp summary message for this expense. Set by the receipt '
  'workflow after the summary is sent; used to resolve an undo reaction back to '
  'this row. Null for web receipts.';

-- The reaction handler looks up by wa_message_id alone (it is globally unique),
-- and only ever for rows that could still be undone. Partial index keeps it tiny.
create index if not exists wap_expenses_wa_message_id_idx
  on public.wap_expenses (wa_message_id)
  where wa_message_id is not null;
