# Fixing the exported PDF's formatting and filename (Hi-Tech Web Chat)

**Do NOT use the n8n MCP `update_workflow` tool (or `create_workflow_from_code`/`publish_workflow`)
for this change.** It regenerates the workflow from SDK code and silently drops connections — this
has already bitten this project once (see the `n8n-mcp-update-unsafe` note). `Hi-Tech Web Chat` is 65
nodes and live. Apply everything below by hand in the n8n editor UI.

**The importable file is `Hi-Tech Web Chat.json` in the repo root** — a real n8n editor export with
all three fixes patched in. Import that.

It was patched in place, anchor by anchor, and verified against its own pre-patch state rather than
against anything regenerated: 65/65 nodes, **32/32 credential blocks identical**, `connections`
byte-identical, `id`/`versionId`/`active` untouched, and no node other than `Code in JavaScript1`,
`AI Agent` and `Doc Respond PDF` differing in any way.

Do NOT build an import from an n8n **MCP** read. The MCP read strips `credentials` (0 blocks where
the editor export has 32) and also drops fields the editor keeps — `Doc Respond PDF`'s
`inputFieldName: "data"`, for one. An import built that way would unbind every credential in the
workflow. MCP reads are for diffing only.

Target: **`Hi-Tech Web Chat`** (id `JOBpBMBz05ZVmQ79`, the copy in the Hi Tech SAP folder — the one
carrying `Check_Customer_Balance` and the `Doc Webhook`).

**Background:** the first real export — the Karim Containers account statement, 08 Aug 2026 — came
out with a doubled title, a bullet in front of every line including the blank ones, `• •` on the
sub-points, `• 1.` on the numbered ones, `\"Still open\"` with its escapes showing, and a filename of
`HiTech Document.pdf`. Nothing was wrong with the download path; every one of those is generated
upstream of it. Three independent causes, three fixes.

The **older** repo mirrors are stale: `n8n/Hi-Tech Web Chat.json` (14 Jul), `n8n/Hi-Tech Web Chat
(2).json` (25 Jul) and `n8n/system-prompt-web-chat.md` (25 Jul) all predate `pdf_content` entirely.
Do not import or diff against those. The two current files are `n8n/Hi-Tech Web Chat (3).json` (the
whole workflow, all three fixes) and `n8n/code-in-javascript1.js` (just the one node, fix 1) — both
refreshed from live on 08 Aug 2026.

---

## Fix 1 — double bullets, empty bullets, visible `\"` (Code node)

**Cause.** System prompt §3.6 tells the agent, for the DOCUMENT register, to relay the tool's
`human_message` "lines exactly". The renderer at `inventory-tool:8000/tools/export-pdf` draws its
*own* bullet for every entry in a section's `bullets` array. So a relayed line that already carries
`•` or `1.` arrives double-marked, and the tool's blank spacer lines arrive as bullets with nothing
after them. The agent did what it was told; the instruction and the renderer disagree.

**Fix.** Strip the marker the renderer is about to redraw, deterministically, in the Code node —
rather than asking the model to remember not to emit one.

1. Open **`Code in JavaScript1`**.
2. Replace its entire contents with `n8n/code-in-javascript1.js` from this repo. That file was pulled
   from the live node on 08 Aug 2026 and differs from what is running **only** by the added
   `tidyBullet()` function and the `sections:` mapping in the `pdfContent` block.

If you would rather hand-edit, the whole delta is: add `tidyBullet()` immediately above
`let pdfContent = null;`, and change `sections:` from passing `parsedData.pdf_content.sections`
straight through to `rawSections.map(...)` running each section's bullets through it.

Watch for two things the regex deliberately does NOT do, both covered by tests that pass:

- `**SUMMARY**` keeps both leading asterisks — the renderer honours `**bold**`, and treating a bare
  `*` as a bullet marker wrecks it. `*` and `-` count as markers only when a space follows.
- `-500 adjustment` keeps its minus sign, for the same reason.

Not included: rewriting the tool's `--` to an em dash. It would also rewrite things like `3--5 mm`.
Add `.replace(/ -- /g, ' — ')` to `tidyBullet` if you decide you want it.

---

## Fix 2 — the doubled title (system prompt)

**Cause.** §3.6's DOCUMENT bullet says to make the section heading the statement type, and the title
is printed above it. `Karim Containers Account Statement` followed by a heading of
`Account Statement` prints the same words twice.

**Fix.** Open the **`AI Agent`** node → system message → §3.6, and replace this sentence:

> One section, its heading the statement type (e.g. "Account Statement"), its bullets the
> human_message's own lines relayed exactly, notes included.

with:

> The human_message's own group labels (SUMMARY, INVOICES, PAYMENTS RECEIVED, NOTES) each become a
> section with that label as its heading — they are the tool's own structure, not yours, so using
> them is relaying rather than restructuring. Never use the document title, or any part of it, as a
> section heading: the title is already printed above it. Its bullets are the human_message's own
> lines relayed exactly, notes included, one line per bullet — leave off each line's own leading
> "•" or "1." and its blank spacer lines, which the renderer supplies itself.

This was chosen over "leave the heading empty" because the renderer's source is not in this repo and
its handling of an empty heading is unverified. Grouping also gives a better document: four titled
sections instead of one thirty-bullet run.

Fix 1 still does the marker stripping regardless — the last sentence here just stops the bad payload
being produced in the first place.

**Also check the WhatsApp workflow.** `Mawavia Whatsapp Chatbot` writes `AI_PDF_Content` through the
same §3.6 register into `n8n_chat_histories`, and `PDF Export - WhatsApp Delivery (sub-workflow)`
renders it through the same backend. If its prompt carries the same DOCUMENT sentence, it has the
same bug and wants the same replacement.

---

## Fix 3 — `HiTech Document.pdf`

**Cause.** In `Code in JavaScript1`:

```js
const docTitle = (pdfContent && pdfContent.title) || 'HiTech Document';
```

On the turn where the rep says "send that as PDF", the reply is a bare confirmation, and §3.6 has the
agent set `pdf_content: null` for exactly that. So the title falls through to the generic. The node
cannot recover the real one: `Execute a SQL query` selects only `User_Message, AI_Response,
Timestamp`. The existing comment above `docTitle` already predicted this.

**Fix (preferred).** Let the server's own filename win. The dashboard half is already deployed —
`downloadDocument()` in `src/mawavia-dashboard.jsx` now prefers the response's `Content-Disposition`
and falls back to `doc.name`, so nothing regresses if this step is skipped.

In **`Doc Respond PDF`** → Options → **Response Headers**, add:

```
Access-Control-Expose-Headers: Content-Disposition
```

Without it the browser cannot read `Content-Disposition` on a cross-origin fetch, and the client
silently falls back to the generic name.

**Fallback, if the name is still generic after that.** Then `inventory-tool` is naming the file
generically too, and the fix moves fully into n8n: add `"AI_PDF_Content"` to the `Execute a SQL
query` SELECT, and change `docTitle` to fall back to the newest prior row's `.title`. Check what the
extra column does to the agent's history builder before shipping it — that node feeds
`Code in JavaScript`, and the goal is not to leak a blob of PDF JSON into the agent's context.

---

## Verifying

The Karim row already in `web_chat_histories` keeps its bad `pdf_content`. `Get PDF Content` takes
the newest row for the session, so:

1. New chat. Ask for the same account statement again.
2. Ask for it as a PDF, click the chip.
3. Expect: one title at the top, four titled sections, one bullet per line, no empty bullets, no
   `\"`, and a filename naming the customer.

If the chip does not appear at all, the agent did not set `export_pdf` — that is a separate question
from this checklist, and `documents` is always `[]` on a cache hit.
