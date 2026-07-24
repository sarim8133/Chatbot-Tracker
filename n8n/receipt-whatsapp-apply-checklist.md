# Adding receipt intake to the WhatsApp chatbot

**Do NOT use the n8n MCP `update_workflow` tool (or `create_workflow_from_code` / `publish_workflow`)
for this change.** It regenerates the workflow from SDK code and silently drops connections — this has
already bitten this project once. Everything below is applied by hand in the n8n editor UI.

Files:

- `n8n/receipt-nodes-bundle.json` — the 39 new nodes, pre-wired. Paste them onto the canvas.
- `db/receipt-wa-undo.sql` — **already applied** (migration `add_wa_message_id_to_wap_expenses`).
- `n8n/HiTech Receipt Processor (Web).json` — the workflow this was ported from.

---

## What this is

The web receipt flow, moved onto WhatsApp and merged into `Mawavia Whatsapp Chatbot`
(`E6Bi8G9MKf8tyVn0`) so both live behind the one trigger Meta calls.

Two new branches hang off the chatbot's existing `Switch`:

```
Switch ─ Reaction ──→ Reaction Router → … → Delete Expense → Delete Receipt Image → Send Undone
       ├ Text ─────→ (unchanged)
       ├ Audio ────→ (unchanged)
       ├ Sticker ──→ (unchanged)
       ├ Image ────→ Receipt Guard → … → Insert Row → Send Summary → Link Reaction   ← NEW rule
       └ fallback ─→ (unchanged)
```

### Why undo, and not confirm

The obvious port of the web flow is extract → ask → save. On WhatsApp that means the receipt sits in
limbo until someone answers, and **people don't answer.** Every unanswered photo is a lost expense,
and the failure is silent — nobody finds out until the month doesn't add up. That is a worse bug than
the one it fixes.

So the reaction is an *undo*, not a gate:

1. The photo is OCR'd, deduped and **saved immediately**.
2. The bot replies with the full extracted summary, ending in the rule, stated in full:
   `Something wrong? React 👎 to this message within 24 hours and I'll remove it.`
3. A 👎 on that message **deletes the row and its stored photo**, and confirms in chat.

Nothing is ever lost, the rep still sees every extracted field the moment it's logged, and correcting
a bad read is one tap instead of a typed reply. It also can't collide with the chatbot: a reaction
arrives as `messages[0].type === "reaction"`, never as text, so the `Text` branch never sees it.

### Every reaction gets an answer, except one

The rule is stated in the summary message — the only place a rep will ever read it — but people will
still react with the wrong thing. **A reaction that doesn't remove the receipt must say so**, because
silence reads as "done" and leaves an expense logged that the rep believes they cancelled.

`Classify Reaction` resolves every case:

| Reaction, on their own receipt summary | Result |
|---|---|
| 👎 ❌ ✖ ❎ 🚫 🙅 🗑 ⛔ — under 24 h | row + photo deleted, confirmed in chat |
| 👎 — but older than 24 h | *"more than 24 hours old… ask accounts"* |
| 👍 ❤️ 😡 — anything that isn't a no | *"still logged. To remove it, react 👎"* |
| reaction removed (empty emoji) | silent — undoing a reaction isn't a signal |
| **any reaction on any other message** | **silent** |
| 👎 a second time, after the row is gone | silent — falls into the row above |

The last two rows are the only intentional silences. "Any other message" is the common one: reactions
on chatbot answers, on someone else's summary, on an old thread. The lookup is keyed on
`wa_message_id` **and** `sender_phone`, so only the person who submitted a receipt can act on it.

A second 👎 is silent because the delete is real — there is no row left to recognise. The rep was
already told it was removed, so there's nothing further to say.

### What it inherits from the web flow

- the same Gemini OCR prompt and `Parse OCR` normalisation (fixed 7 categories, PKR, subtotal
  backfill);
- the **5-layer duplicate check** (`Is Content Dup?`) — image hash → matching receipt numbers →
  differing receipt numbers → same employee → soft flag for the accountant. This is the fix for two
  colleagues on the same flight being flagged as duplicates of each other;
- **Supabase Storage** instead of Google Drive, so WhatsApp receipts now open in the dashboard's
  Expenses tab like web ones do (it prefers `image_path`, and only falls back to `drive_link`).

---

## Apply

### 1. Paste the nodes

Open `Mawavia Whatsapp Chatbot` in n8n. Open `n8n/receipt-nodes-bundle.json`, copy the **whole file**,
click an empty part of the canvas, `Ctrl+V`. All 39 nodes land pre-wired to each other; only the two
entry points need connecting.

Two clusters appear below the existing flow: the receipt chain starting at **Receipt Guard**, and the
undo chain starting at **Reaction Router**.

### 2. Add the `Image` rule to the Switch

Open `Switch` → **Add Routing Rule**:

| Field | Value |
|---|---|
| Left | `{{ $json.messages[0].type }}` |
| Operator | String → is equal to |
| Right | `image` |
| Rename output | on, `Image` |

Then wire **Switch → `Image` → Receipt Guard**.

> ⚠️ Adding a rule shifts the fallback output down a slot. Before you close the node, confirm
> `Sticker` and the fallback output are **both** still wired to `Send Fallback Type`, and reconnect
> them if not.

### 3. Rewire the Reaction output

The `Reaction` output (the first one) currently goes to `No Operation, do nothing`. Delete that
connection and wire **Switch → `Reaction` → Reaction Router** instead. Leave the NoOp node where it
is or delete it — nothing else uses it.

### 4. Check credentials on the pasted nodes

Pasted nodes carry credential IDs, which normally resolve on the same n8n instance. Confirm anyway —
open each and look for a red warning:

| Nodes | Credential |
|---|---|
| all `Send *` nodes, `Get Media URL` | Mawavia WhatsApp account |
| `Download Image` | Mawavia Header Auth account |
| `Gemini OCR` | Mawavia Gemini Query Auth |
| `Look Up Sender`, `Look Up App User`, `Check Content Dup`, `Upload to Storage`, `Insert Row`, `Link Reaction`, `Find Expense`, `Delete Expense`, `Delete Receipt Image` | Supabase account |

All eight `Send *` nodes are set to phone number ID **`1205692275964300`**.

> ⚠️ The chatbot's own existing send nodes (`Send Text Message`, `Send Waiting Message`,
> `Send Fallback Type`, `Send Pictures`, …) still point at **`1098966963303717`**. If everything is
> moving to the new number, those need changing too — otherwise a rep gets chat answers from one
> WhatsApp number and receipt confirmations from another, in the same thread. I didn't touch them;
> they're live nodes.

### 5. Verify the WAMID expression

`Link Reaction` writes the summary message's WAMID onto the expense row — without it the undo can
never resolve. It reads:

```
($json.messages && $json.messages[0] && $json.messages[0].id) || $json.id || null
```

which covers both response shapes the WhatsApp node returns. After your first test, open the
`Send Summary` node's output and confirm the ID actually landed. If it's under some third key on your
n8n version, adjust that one expression.

### 6. Save and test

1. **Happy path** — send a receipt photo from a whitelisted number. Expect the summary card within
   ~15 s. Check `wap_expenses`: new row, `status = logged`, `image_path` set, `wa_message_id` set.
   Open the row in the dashboard's Expenses tab and confirm the image opens.
2. **Undo** — react 👎 to that summary. Expect the "Removed" reply. The `wap_expenses` row must be
   **gone** (not flagged — gone), and the object must be gone from the `receipts` bucket. Check both.
3. **React 👎 again** to the same message. Expect silence — the row no longer exists.
4. **Wrong reaction** — react ❤️ to a *different, still-logged* summary. Expect "still logged. To
   remove it, react 👎" — again, not silence. Then react to one of the chatbot's own text answers:
   **that** one must be silent.
5. **Duplicate** — send the identical photo again. Expect "Already logged" with the original ID.
6. **Not a receipt** — send a photo of anything else. Expect the "couldn't find a receipt" reply, and
   **no row**.
7. **Not whitelisted** — send from a number not in `wap_allowed_senders`. Expect the "ask your admin"
   reply.
8. **Chat still works** — send a normal text question and a voice note. Both must behave exactly as
   before.

---

## Decisions left to you

### The old workflow

`HiTech Receipt Processor (Final)` (`LWBG3wrnirRbdG99`) is still active on the *other* number and
still writes to `wap_expenses` — with Drive links instead of storage paths and the old two-layer
dedup. Once this is proven, archive it, or you have two receipt paths writing the same table with
different rules.

### Which number sends

Three IDs are in play:

| ID | What it is |
|---|---|
| `1205692275964300` | **the one to use** — all eight new `Send *` nodes |
| `1098966963303717` | the chatbot's existing send nodes, unchanged |
| `1136008679592637` | the old standalone receipt bot |

Whichever number the merged workflow *receives* on is fixed by which WhatsApp Trigger Meta calls —
Meta only calls one callback URL per app, which is exactly why receipts and chat can't stay as two
workflows on one number. The send ID is separate and set per node, so **inbound and outbound can
diverge**: reps would message one number and be answered from another. Worth checking that's what you
want before going live.

---

## Known limits

- **Meta testing mode.** The app is still capped at 5 recipients. This doesn't change that; it's the
  same ceiling the old receipt bot has.
- **Cross-channel hashes don't match.** `receipt_hash` is the SHA-256 of the stored image's base64.
  The web flow compresses in the browser, WhatsApp re-encodes on their servers — so the same physical
  receipt sent through both channels produces two different hashes. Layers 2–5 of the dedup (receipt
  number, same employee, vendor+date+total) still catch it; only the instant hash match doesn't fire.
- **Unlinked phones get an admin-only folder.** Storage RLS scopes reads to a folder named after the
  viewer's auth uid. A sender with no dashboard login stores under `whatsapp/<phone>/`, which only
  accountants and admins can open. The day their phone is added to `app_users`, new receipts start
  landing under their own uid and they can see them. Old ones stay where they were.
- **The undo is a hard delete, and there is no audit trail.** `Delete Expense` removes the row
  outright and `Delete Receipt Image` removes the stored photo; neither is recoverable and nothing
  records that a receipt ever existed. That is deliberate — but it means a rep can quietly erase a
  logged expense within 24 h and the accountant will never see it happened. If you later want that
  visible, the smallest change is to write the deleted `expense_id`, phone and total to a
  `wap_expense_deletions` table just before `Delete Expense`.
- **An image delete can fail silently.** `Delete Receipt Image` is best-effort (`onError: continue`),
  because the row is deleted first — if the object delete then fails you get an orphaned file nobody
  can reach. That's the intended trade: the alternative order risks a surviving row pointing at a
  missing image, which the dashboard renders as a broken receipt.
- **The OCR prompt is duplicated.** `Gemini OCR` here and in `HiTech Receipt Processor (Web)` must
  stay identical, or the two channels will extract differently. Change one, change both.
