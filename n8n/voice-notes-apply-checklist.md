# Applying voice notes to the live `Hi-Tech Web Chat` workflow

**Do NOT use the n8n MCP `update_workflow` tool (or `create_workflow_from_code`/`publish_workflow`) for
this change.** It regenerates the workflow from SDK code and silently drops connections — this has
already bitten this project once (see the `n8n-mcp-update-unsafe` note). Apply everything below by
hand in the n8n editor UI.

`n8n/Hi-Tech Web Chat.json` in this repo is the fully-updated reference export — use it to check your
work, not to import over the live workflow.

---

## Step 1 — Paste the new nodes

1. Open the live `Hi-Tech Web Chat` workflow in the n8n editor.
2. Open `n8n/voice-nodes-bundle.json` in a text editor, select all, copy.
3. Click on an empty area of the canvas above/left of the existing nodes, then paste (Ctrl+V).
4. You should now have 10 new nodes, already wired to each other:
   `Has Audio?` → `Audio to Binary` → `Analyze audio` → `Transcribe Text` → `Check Text` →
   (true) `Romanizer` → `Transcript`; (false) `Respond No Speech`; `Romanizer Gemini` feeds
   `Romanizer`'s model input. `Has Audio?` (false) → `Text`.
5. Drag the pasted group to a clear area so it doesn't overlap the existing nodes (they landed on
   the bundle's own coordinates, which sit above/left of the current canvas — just confirm nothing
   overlaps after paste).
6. **Re-bind credentials** on the two nodes that need them (paste does not always keep credential
   bindings if the credential wasn't already cached client-side):
   - `Analyze audio` → Google Gemini (PaLM API) credential → **Mawavia Gemini Account**
   - `Romanizer Gemini` → Google Gemini (PaLM API) credential → **Mawavia Gemini Account**

## Step 2 — Wire the new nodes into the existing graph

These three connections cross from the pasted bundle into nodes that already existed, so they are
**not** included in the bundle's own wiring — add them manually:

| From | From output | To |
|---|---|---|
| `Webhook` | main (its only output) | `Has Audio?` *(replaces the existing `Webhook → Guardrails` connection — delete that old connection first)* |
| `Text` (the new node) | main | `Guardrails` |
| `Transcript` (the new node) | main | `Guardrails` |

After this, `Guardrails` should have exactly two incoming connections (from `Text` and from
`Transcript`) and zero remaining direct connection from `Webhook`.

## Step 3 — Edit existing nodes (old value → new value)

### `Guardrails` — parameter `Text`

- Old: `{{ $json.body.message }}`
- New: `{{ $json.text }}`

This is the keystone edit — everything downstream already reads
`$('Guardrails').first().json.guardrailsInput`, so this one change makes the whole pipeline work
for both typed and spoken input.

### `Respond Success` — parameter `Response Body` (JSON mode)

- Old:
  ```
  {{ { "reply": $json.reply_text, "images": $json.image_urls, "from_cache": $json.from_cache } }}
  ```
- New:
  ```
  {{ { "reply": $json.reply_text, "images": $json.image_urls, "from_cache": $json.from_cache, "transcript": $('Guardrails').first().json.guardrailsInput } }}
  ```

### `Respond Error` — parameter `Response Body`

- Old:
  ```
  {{ { "reply": "Sorry, we are facing a temporary issue. Our team will assist you shortly.", "images": [] } }}
  ```
- New:
  ```
  {{ { "reply": "Sorry, we are facing a temporary issue. Our team will assist you shortly.", "images": [], "transcript": $('Guardrails').first().json.guardrailsInput } }}
  ```

### `Respond Guardrail Fail` — parameter `Response Body`

- Old:
  ```
  {{ { "reply": "Your message couldn't be processed as it contains restricted content (links or inappropriate language). Please rephrase and try again.", "images": [] } }}
  ```
- New:
  ```
  {{ { "reply": "Your message couldn't be processed as it contains restricted content (links or inappropriate language). Please rephrase and try again.", "images": [], "transcript": $('Guardrails').first().json.guardrailsInput } }}
  ```

## Step 4 — Do NOT touch

Nothing from `Embed Query` onward changes. Leave `Embed Query`, `Check Semantic Cache`,
`Parse Cache Result`, `Cache Hit?`, `Return Cached Reply`, `Execute a SQL query`,
`Code in JavaScript`, `AI Agent`, `Gemini`, `Search Pinecone`, `Embeddings Google Gemini`,
`Reranker Cohere`, `Structured Output Parser`, `Google Gemini Chat Model`, `Code in JavaScript1`,
`Insert rows in a table`, `Save to Semantic Cache`, and `If` exactly as they are.

## Step 5 — Verify before saving as active

1. Pin test data on `Webhook`: a body of `{ "audio_base64": "<some short base64 WAV>", "mime_type": "audio/wav", "session_id": "test", "name": "test" }`. Run the workflow manually and confirm it
   reaches `Guardrails` with a romanized transcript, then flows through to `Respond Success` with a
   non-empty `transcript` field in the response.
2. Pin a body whose `audio_base64` is a **silent** WAV (a real file, just no speech). It must take the
   *audio* branch, transcribe to an empty string, and short-circuit at `Check Text` to
   `Respond No Speech` with `images: []` / `transcript: ""`. Note this is NOT the same as an empty
   `audio_base64` string — that takes the `Has Audio?` false branch and is treated as a typed message.
3. Pin a typed body `{ "message": "pvc pipe machine", "session_id": "test", "name": "test" }` and
   confirm the existing typed-message behaviour is unchanged (still reaches `Respond Success` with
   `transcript` equal to the typed message).
4. Only after all three pass, save and confirm the workflow is Active.

## Watch item (per the design spec)

`Romanizer` is an `agent` node with a raw Gemini model and no output parser — the same shape that
previously leaked "thought" text into WhatsApp replies. It's kept identical to the proven WhatsApp
node on purpose. If voice queries start returning odd cache misses or garbled RAG results, suspect a
leaked thinking preamble in `Romanizer`'s output first; the fix is a Structured Output Parser reading
the output as an object.
