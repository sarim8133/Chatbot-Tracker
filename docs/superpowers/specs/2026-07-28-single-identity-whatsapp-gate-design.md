# One person, one identity — and a gate on the WhatsApp bot

**Date:** 2026-07-28
**Status:** approved, not yet implemented

## The problem

Two symptoms, one root cause, plus a hole nobody had noticed.

**Symptom.** The dashboard shows three Mawavias and two Sarims. Four different
places write the same person's name as free text, and every rollup groups on the
string:

| Written by | Sarim | Mawavia |
| --- | --- | --- |
| `web_chat_histories.Name` — JWT email local-part | `smsarim6` | `mawaviahitech` |
| `n8n_chat_histories.Name` — `contacts[0].profile.name` | `Sarim` | `Mawavia_Hitech_khi` |
| `app_users.full_name` — the real roster | `Sarim` | `Mawavia` |
| `wap_allowed_senders.employee_name` — hand-kept | `sarim` | `Mawavia`, `mawavia2`, `mawavia Safi` |

The WhatsApp one is the worst of the four: it is the sender's own WhatsApp
profile name, so a rep who renames themselves becomes a new "rep" in the
analytics, and the company does not control it.

**The hole.** The chat path has no sender gate at all. `Sender Gate` /
`Look Up Sender` / `Authorized?` sit only on the receipt branch (`Switch`
output 4). Chat runs `Switch → Text → Guardrails → Embed Query → agent` with
nothing checking who is asking, so any number on earth can message the bot today
and get catalogue specs and pricing back.

**Root cause.** Identity is a string stamped at write time from whichever source
that channel happened to have, instead of a key.

## Decisions

| Question | Decision |
| --- | --- |
| Does every WhatsApp user need a dashboard login? | Yes. Team = `app_users`, full stop. |
| What does an unknown number get? | Silence. Log it, do not reply. |
| What happens to the duplicate history rows? | Backfill to one identity. |
| Is a phone number optional? | No. Mandatory for every role. |

**Acceptance criterion, in the user's words:** adding a person in the Team tab
must grant login, WhatsApp chat and WhatsApp receipts. One action, three
capabilities, no follow-up steps.

## Constraints discovered

These bound the design and were verified against the live database, not assumed.

- **`wap_allowed_senders` cannot be dropped.** `wap_expenses.sender_phone` holds
  `FOREIGN KEY → wap_allowed_senders(phone) ON DELETE SET NULL`; the table carries
  its own RLS policy (`wap_senders_self_or_accountant`); and `admin_list_users()`
  joins it for the `active` flag. It stays, demoted from "roster" to "expense
  linkage + activation flag", written only by Team.
- **`spending_limit` IS live — corrected 2026-07-28.** An earlier draft of this
  spec said nothing read it and planned to drop it. That was wrong: there is a
  monthly-cap panel at `src/mawavia-dashboard.jsx:3224` backed by an
  `admin_set_spending_limit` RPC. The mistake came from a repo-wide grep whose
  output was truncated before it reached that line — absence of evidence reported
  as evidence of absence. The column stays, untouched by this change.
- **`app_users.user_id` is `FOREIGN KEY → auth.users(id)`.** A Team member without
  a login cannot exist, which is why the roster question above only had one
  workable answer.
- **`admin-create-user` already writes the roster row for anyone with a phone**
  (`index.ts:106`), not just employees. Its own header comment and the SQL comment
  at `expense-access-rls.sql:179` both say "for employees" and are stale.

## Two live bugs this must fix

Both are in `admin_set_role` (`db/expense-access-rls.sql:153-173`), and both are
harmless today only because nothing depends on `app_users.phone` yet. The moment
the gate keys on it, they become lockouts.

1. **Non-employee phones are wiped on edit.**
   `phone = case when p_role = 'employee' then clean_phone else null end`.
   Sarim, Habib and Mawavia are all admins with phones set. Editing any of them
   through the Team tab clears the phone, which under this design removes their
   WhatsApp access.
2. **The roster row is never updated on edit.** `admin_set_role` touches
   `app_users` only. Changing someone's number in Team leaves a stale
   `wap_allowed_senders` row, so their next receipt fails the foreign key.

## Design

### 1. One authorization source: `public.whatsapp_members`

A view, not a column check in an n8n node, so that "who may message the bot" is
written down in one legible, testable place and n8n never has to change again
when the policy moves.

A member is authorized when all three hold:

- an `app_users` row exists,
- `phone` is non-null,
- the `auth.users` account is not banned (`banned_until` null or past).

**The ban is the single source of activation, and `wap_allowed_senders.active` is
not consulted.** That is deliberate: `admin-manage-user` already sets both when an
admin deactivates someone, so the ban is the same decision recorded upstream of
the flag. Reading only the ban means the flag can never disagree with the gate —
which is precisely the class of drift this whole change exists to remove.

The consequence is that a stale `active: false` on a member who is not banned
stops having any effect. Taimoor is exactly that case today: he is in `app_users`,
not banned, invited but never logged in, and his roster row says inactive. After
this he can use the bot, which is correct — he is in Team. The cleanup in §6
resets those flags so the column stops implying something it no longer controls.

Exposes `phone, user_id, full_name, role, department`. Phone is stored digits-only
following the existing `regexp_replace(…, '[^0-9]', '', 'g')` convention;
WhatsApp's `wa_id` already arrives in that form, so the match is direct.

### 2. The gate: one node, not five

Inserted immediately after `WhatsApp Trigger`, **before** `Check Msg Exist →
Switch`. Gating there covers chat, audio, reactions and receipts in a single
insertion rather than one per `Switch` output, and it closes the receipt path's
dependence on the drifted table at the same time.

```
WhatsApp Trigger → Look Up Member → Member? ──true──→ Check Msg Exist → Switch → …
                                        └────false─→ NoOp   (silence)
```

The lookup returns `user_id` and `full_name`, which the rest of the workflow then
carries — the gate and the identity resolver are the same call.

### 3. Stamp identity, not names

- `user_id uuid` column added to `n8n_chat_histories` and `web_chat_histories`.
- n8n's `Insert rows in a table` writes the `user_id` and `full_name` the gate
  resolved, replacing `contacts[0].profile.name`.
- The web chat writes the JWT uid and `app_users.full_name`, replacing the email
  local-part from `currentUserName()`.
- The Reps tab groups on `user_id`.

`Name` stays as a denormalised label for readability; it stops being the key.

### 4. Backfill

History rows get `user_id` by matching phone (WhatsApp) and email local-part
(web). All seven distinct names in the current data map onto the eight
`app_users` rows, so the duplicates collapse with nothing orphaned.

### 5. Team as the single grant point

- `admin_set_role` keeps the phone for **every** role, and upserts the
  `wap_allowed_senders` row (phone, name, department) so an edit cannot desync.
- Phone becomes **required for all roles** in `admin-create-user` and in the Team
  form, not just employees. All eight existing rows already have one, so no
  existing data breaks.
- `admin-manage-user` already bans the login and flips the roster `active` flag on
  deactivate. The gate reads the ban (§1), which is the same admin action recorded
  one level up, so deactivating in Team cuts login, chat and receipts together
  without the two flags needing to be kept in agreement.

### 6. Roster cleanup

| Row | Phone | Action | Why |
| --- | --- | --- | --- |
| `mawavia2` | 923362188858 | **loses bot access** | active today, no dashboard account |
| `mawavia Safi` | 03134331423 | remove | inactive, no account, local-format duplicate |
| `test` | 123123123123 | remove | test data |
| `Iftikhar` (dup) | 03159601666 | remove | inactive local-format duplicate of 923159601666 |

`mawavia2` is the one deliberate loss of access, confirmed by the user. If that
person needs the bot, they get invited to Team like anyone else.

Alongside the removals, the surviving roster rows get their `active` flag reset to
agree with ban state, so the column stops claiming authority it no longer has
(see §1). Today Taimoor is `active: false` while Khizar Altaf and Khizar Hussain
are `active: true`, and none of the three has ever logged in — the flag has been
recording three different things.

### 7. `spending_limit` — withdrawn, not done

This section previously specified dropping the column. It was withdrawn on
2026-07-28 when the plan's own pre-flight grep found the monthly-cap panel that
reads it. Dropping it would have deleted a working feature, which is a different
decision from deleting dead weight, and the user chose to keep it once the facts
were straight.

Left in place: the column, the panel at `src/mawavia-dashboard.jsx:3224`, the
`admin_set_spending_limit` RPC, and the current caps.

Worth noting for whoever picks this up: Habib's cap is `0`. If the panel enforces
literally, that caps the CEO at nothing — probably meaning "unlimited" by
accident. Not in scope here, but it is the kind of thing that bites at month end.

## Unchanged

Web login and session handling, the AUP gate, email invites, expense RLS
policies, the `wap_expenses` foreign key, and the receipt OCR pipeline.

## Risks

- **Every n8n change is hand-pasted in the UI.** `update_workflow` via MCP
  regenerates from SDK code and silently drops connections, so it cannot be used.
  A paste error in the gate takes the bot down for everyone; the gate node should
  be added and verified before the identity-stamping edits.
- **The gate fails closed.** If the Supabase lookup errors, every sender looks
  unauthorized and the bot goes silent for the whole company. The lookup node
  needs an explicit error path that is distinguishable from "not a member".
- **Backfill is a data migration.** Take a snapshot of both history tables and
  `wap_allowed_senders` before running it.

## Verification

1. A number not in Team messages the bot → no reply, nothing written to
   `n8n_chat_histories`.
2. A Team member messages the bot → normal answer, row written with the correct
   `user_id` and `full_name`.
3. The same person messages on WhatsApp and on the web → one rep in the Reps tab,
   not two.
4. Add a person in Team with a phone → they can log in, chat on WhatsApp, and
   submit a receipt, with no further admin action.
5. Edit an admin's row in Team → phone survives, roster row follows, WhatsApp
   access intact.
6. Deactivate in Team → login, chat and receipts all stop.

## Out of scope

Building a real spend control to replace the dropped column; migrating WhatsApp
receipts off Drive; the `maxOutputTokens` cacheable investigation (tracked
separately).
