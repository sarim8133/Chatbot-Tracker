# n8n: gate the WhatsApp bot, and stamp identity

**Apply these by hand in the n8n UI.** Do NOT use the MCP `update_workflow` — it
regenerates the workflow from SDK code and silently drops connections.

Workflow: **Mawavia Whatsapp Chatbot** (`E6Bi8G9MKf8tyVn0`), currently active.
Everything below was checked against the live workflow on 2026-07-28; node names
and expressions are quoted from it.

The database side is already live (`db/2026-07-28-single-identity.sql`). Nothing
here depends on further SQL.

> **Until part 1 is applied, the bot answers any number on earth** — catalogue
> specs and pricing included. That is the hole this closes.

---

## Part 1 — The gate

Today the trigger runs straight into the message check:

```
WhatsApp Trigger ──> Check Msg Exist ──> Switch ──> …
```

The existing `Sender Gate` / `Look Up Sender` / `Authorized?` nodes sit only on
the **receipt** branch (`Switch` output 4), so chat, audio and reactions have
never been checked. Insert the new gate before `Check Msg Exist` and all four
branches are covered at once:

```
WhatsApp Trigger ──> Look Up Member ──> Member? ──> Authorized Member? ──true──> Check Msg Exist ──> …
                                                            └───────────false──> Blocked (silent)
```

### 1.1 `Look Up Member` — HTTP Request

Copy the settings from the existing `Look Up Sender` node, which already works
against this Supabase project.

| Setting | Value |
| --- | --- |
| Type | HTTP Request (`n8n-nodes-base.httpRequest`, typeVersion 4.4) |
| Authentication | Predefined Credential Type |
| Credential type | `supabaseApi` |
| Always Output Data | **on** |
| On Error | **Continue (using regular output)** |

URL (expression):

```
={{ 'https://oocmjiuymmvwvyvwlfpd.supabase.co/rest/v1/whatsapp_members?select=user_id,full_name,role&phone=eq.' + $json.messages[0].from }}
```

`messages[0].from` and `contacts[0].wa_id` are the same digits — the existing
`Insert rows in a table` node uses the latter. Either works.

`whatsapp_members` is granted to `service_role` only, and deliberately not to
`authenticated`: it exposes every colleague's phone number.

### 1.2 `Member?` — Code node

**Always Output Data: on.**

```js
// The gate. Fails CLOSED: an unknown sender gets silence, never a reply.
//
// But a Supabase outage must NOT read as "everyone is a stranger" — that would
// silence the bot for the whole company with nothing in the logs saying why. A
// lookup error is therefore told apart from an empty result and rethrown, so it
// surfaces as a failed execution instead of a silent company-wide outage.
//
// The trigger payload is spread through untouched: everything downstream of
// Check Msg Exist still reads $json.messages / $json.contacts as before.
const trigger = $('WhatsApp Trigger').first().json;
const items   = $input.all();
const j       = items.length ? items[0].json : null;

if (j && !Array.isArray(j) && (j.error || j.message || j.code)) {
  throw new Error('whatsapp_members lookup failed: ' + (j.message || j.error || j.code));
}

const row = Array.isArray(j) ? j[0] : (j && j.user_id ? j : null);

return [{ json: {
  ...trigger,
  authorized:  !!(row && row.user_id),
  member_id:   row ? row.user_id   : null,
  member_name: row ? row.full_name : null,
  member_role: row ? row.role      : null,
} }];
```

### 1.3 `Authorized Member?` — IF node

Condition — Boolean, **is true**:

```
={{ $json.authorized }}
```

- **true** → `Check Msg Exist` (the existing connection, moved here)
- **false** → `Blocked (silent)`

### 1.4 `Blocked (silent)` — NoOp

Nothing connected after it. Silence is the decision: no reply, no error message,
nothing written to `n8n_chat_histories`.

### 1.5 Verify before going further

1. From a Team number (e.g. Sarim's `923366179838`) send `200 ton imm`.
   → a normal catalogue reply arrives.
2. From any number **not** in Team, send `hello`.
   → **no reply at all.** Then:

```sql
select count(*) as leaked
  from public.n8n_chat_histories
 where "Timestamp" > now() - interval '5 minutes'
   and "User_Number"::text not in (select phone from public.whatsapp_members);
```

Expected: `leaked` = 0.

**Do not start Part 2 until both checks pass.**

---

## Part 2 — Stamp the identity, not the sender's profile name

Only after Part 1 is verified working.

### 2.1 `Insert rows in a table` (writes `n8n_chat_histories`)

`Name` is currently the sender's **own WhatsApp display name**, which the company
does not control — rename yourself on WhatsApp and you become a new "rep" in the
analytics. Change:

| Column | From | To |
| --- | --- | --- |
| `Name` | `={{ $('WhatsApp Trigger').item.json.contacts[0].profile.name }}` | `={{ $('Member?').first().json.member_name }}` |
| `user_id` | *(not mapped)* | `={{ $('Member?').first().json.member_id }}` |

**`user_id` will not appear in the column list until you refresh the node's
schema** — n8n caches it, and the column was added to the table after this node
was last opened. Use the refresh icon on the Columns parameter.

Leave `User_Number` as `contacts[0].wa_id`; the phone is still worth recording.

### 2.2 Verify

Send one message from a Team number, then:

```sql
select "Name", user_id is not null as has_uid
  from public.n8n_chat_histories
 order by "Timestamp" desc limit 1;
```

Expected: `Name` is the roster name (`Sarim`, not `Mawavia_Hitech_khi`) and
`has_uid` is true.

### 2.3 Same for the web chat

In **Hi-Tech Web Chat** (`JOBpBMBz05ZVmQ79`), `Insert rows in a table` stamps
`Name` from the JWT email local-part (`smsarim6`). That workflow has **no
`Member?` node** — its identity comes from two nodes that already exist:

- `Validate JWT` → `GET /auth/v1/user`, so the uuid is **`.id`**, not `.user_id`
- `Validate JWT2` → `GET /rest/v1/app_users?user_id=eq.<id>&select=full_name,role`

| Column | To |
| --- | --- |
| `user_id` | `={{ $('Validate JWT').item.json.id }}` |
| `Name` | `={{ $('Validate JWT2').item.json.full_name }}` |

Verify the same way against `web_chat_histories`. If `Name` comes back empty,
check `Validate JWT2` — it uses the `supabaseApi` credential, the same one that
returned 401 on `whatsapp_members`.

### Why this is not urgent, and still worth doing

The dashboard already shows one rep per person without it: `chat_all` re-checks
phone and email local-part against `app_users`, so unstamped rows still resolve.
This makes the stamp authoritative rather than reconstructed on every read — and
it is what stops `Name` being attacker-controlled text.

---

## Unrelated, while you are in here

The `Gemini` node (the chat agent's model, `models/gemini-2.5-pro`) has
`maxOutputTokens: 4096`. The web workflow's equivalent has no cap. `cacheable`
is the **last** key in the output parser's schema, so it is the first casualty
when the model runs out of budget mid-JSON — and the parser's autoFix repairs the
truncated object with no way of knowing what the boolean was meant to be, which
is why WhatsApp answers were never being cached. Removing the cap is the other
half of that fix; the diagnostics are already in `Code in JavaScript1`.

---

## Rollback

If the bot goes silent for everyone: open `Authorized Member?` and reconnect
`WhatsApp Trigger` directly to `Check Msg Exist`. Service is restored in seconds
and every database change stays in place — nothing else depends on the gate.
