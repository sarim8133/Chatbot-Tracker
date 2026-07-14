# Applying the voice-hallucination fix (v2) to the live workflows

**Do NOT use the n8n MCP `update_workflow` tool (or `create_workflow_from_code`/`publish_workflow`) for
this change.** It regenerates the workflow from SDK code and silently drops connections — this has
already bitten this project once (see the `n8n-mcp-update-unsafe` note). Apply everything below by
hand in the n8n editor UI.

`n8n/Hi-Tech Web Chat.json` and `n8n/Mawavia Whatsapp Chatbot (2).json` in this repo are the
fully-updated reference exports — use them to check your work, not to import over the live workflows.

**Background:** a voice note containing only background noise was transcribed as a confident
hallucination ("System start ho gaya hai") and answered by the assistant, because the `Analyze audio`
prompt gave the model no way to say "there's nothing here," and `Check Text` only guarded against an
*empty* transcript, which never happens. See
`docs/superpowers/specs/2026-07-14-voice-hallucination-fix-design.md` for the full design. This
checklist is the apply guide for both halves of the fix (n8n side).

---

## Which section applies to you

- **You are setting up voice notes from scratch** (the live workflow doesn't have the v1 voice nodes
  yet) → follow **Part A** in full for the Web Chat workflow, then **Part C** for WhatsApp.
- **You already applied v1 by hand to the live `Hi-Tech Web Chat` workflow** (per the old checklist —
  you have `Has Audio?` / `Analyze audio` / `Check Text` / `Romanizer` / `Transcript` / `Text` /
  `Respond No Speech` already wired in, and `Guardrails` already reads `{{ $json.text }}`) → skip to
  **Part B, "Delta from v1"** below. This is almost certainly you.
- **WhatsApp** always follows **Part C** — it's two node edits regardless of whether you're starting
  fresh or not.

---

## Part A — Web Chat workflow, from scratch

1. Open the live `Hi-Tech Web Chat` workflow in the n8n editor.
2. Open `n8n/voice-nodes-bundle.json` in a text editor, select all, copy.
3. Click on an empty area of the canvas above/left of the existing nodes, then paste (Ctrl+V).
4. You now have 11 new nodes, already wired to each other:
   `Has Audio?` → `Audio to Binary` → `Analyze audio` → `Transcribe Text` → `Check Text` →
   (true) `Romanizer` → `Transcript` → `Respond Transcript`; (false) `Respond No Speech`;
   `Romanizer Gemini` feeds `Romanizer`'s model input. `Has Audio?` (false) → `Text`.
5. Drag the pasted group to a clear area so it doesn't overlap the existing nodes.
6. **Re-bind credentials** on the two nodes that need them (paste does not always keep credential
   bindings if the credential wasn't already cached client-side):
   - `Analyze audio` → Google Gemini (PaLM API) credential → **Mawavia Gemini Account**
   - `Romanizer Gemini` → Google Gemini (PaLM API) credential → **Mawavia Gemini Account**
7. Wire the three connections that cross from the pasted bundle into the pre-existing graph (not
   included in the bundle, since those nodes aren't part of it):

   | From | Output | To |
   |---|---|---|
   | `Webhook` | main (its only output) | `Has Audio?` *(replaces the old `Webhook → Guardrails` connection — delete that first)* |
   | `Text` (new node) | main | `Guardrails` |
   | (nothing — `Transcript` now terminates at `Respond Transcript`, which is already wired inside the bundle) | | |

8. Edit `Guardrails`, parameter `Text`: old `{{ $json.body.message }}` → new `{{ $json.text }}`.
9. Continue to **Part B, "Everything downstream of Respond Success stays untouched"** for the
   `Respond Success` / `Respond Error` / `Respond Guardrail Fail` note, then run the verification in
   **Part D**.

---

## Part B — Delta from v1 (you already applied the v1 checklist by hand)

If the live `Hi-Tech Web Chat` workflow already has the v1 audio branch wired in and working, you only
need to make **four changes**. Nothing else in the workflow moves.

### B1. `Analyze audio` — replace the `text` parameter (prompt)

Old prompt (v1 — no escape hatch):
```
Transcribe this audio EXACTLY as spoken, word for word.

Rules:
- The speaker mixes Roman Urdu, Hindi/Sindhi/Punjabi, and English, and code-switches freely.
- Output ALL text in Latin (Roman) script ONLY. NEVER output Arabic or Urdu script.
- NEVER translate. Write what you hear phonetically in Roman letters. Keep English words in English.
- Known brand/model names — always spell exactly:
  Tederic (not Tederik, Tedrick, Tedrik, Taderik)
  UWA (not Yuwa, Uva, Ova)
  Haitian (not Haition, Hatian)
  SCR (not Skar, Eskar)
  YH, YE, YU are machine series names — keep as-is.
- Remove any timestamps like 00:00.

Output: only the transcription text, nothing else.
```

New prompt (v2 — paste this exactly, including the em dashes `—`):
```
Transcribe this audio EXACTLY as spoken, word for word.

CRITICAL — when there is no speech:
If the audio contains no intelligible human speech — silence, breathing, background or ambient
noise, music, static, or sound you cannot make out — output exactly:
[NO_SPEECH]
Do NOT guess. Do NOT invent plausible words. Do NOT transcribe noise as if it were speech.
Outputting [NO_SPEECH] is ALWAYS better than inventing a sentence. An empty or noisy recording is
a normal, expected input — not something to fill in.

Otherwise, transcribe it:
- The speaker mixes Roman Urdu, Hindi/Sindhi/Punjabi, and English, and code-switches freely.
- Output ALL text in Latin (Roman) script ONLY. NEVER output Arabic or Urdu script.
- NEVER translate. Write what you hear phonetically in Roman letters. Keep English words in English.
- Transcribe ONLY what is actually audible. If a word is unclear, omit it rather than guessing.
- Known brand/model names — always spell exactly:
  Tederic (not Tederik, Tedrick, Tedrik, Taderik)
  UWA (not Yuwa, Uva, Ova)
  Haitian (not Haition, Hatian)
  SCR (not Skar, Eskar)
  YH, YE, YU are machine series names — keep as-is.
- Remove any timestamps like 00:00.

Output: only the transcription text, or exactly [NO_SPEECH]. Nothing else.
```

The exact text is also in `n8n/voice-nodes-bundle.json` under the `Analyze audio` node's
`parameters.text` — copy it from there if you want to avoid retyping the em dashes.

### B2. `Check Text` — add a second condition

Old condition (single, combinator `and`):
- `{{ $json.text }}` **is not empty** (string / notEmpty)

New conditions (two, combinator `and` — both must hold true):
1. `{{ $json.text }}` **is not empty** (string / notEmpty) — unchanged, keep it.
2. **ADD**: `{{ $json.text }}` **does not contain** `[NO_SPEECH]` (string / notContains)

In the n8n UI: open `Check Text`, click "Add condition," set the left value to
`{{ $json.text }}`, operator to "String → Does not contain," right value to `[NO_SPEECH]`. Leave the
combinator as AND.

### B3. Add node `Respond Transcript`, then delete `Transcript → Guardrails`

The audio branch no longer runs the agent — it terminates in a response, and the browser re-sends the
confirmed text as an ordinary typed message.

1. Add a new `Respond to Webhook` node named `Respond Transcript`:
   - `respondWith`: JSON
   - Response Body: `{{ { "has_speech": true, "transcript": $json.text } }}`
2. Wire `Transcript → Respond Transcript`.
3. **Delete** the existing connection `Transcript → Guardrails`. (`Guardrails` still has one incoming
   connection left — from `Text` — which is correct; typed messages are unaffected.)

The exact node (with its id) is in `n8n/voice-nodes-bundle.json` if you'd rather paste it than build
it by hand — just re-wire the `Transcript → Respond Transcript` connection after pasting, since a
partial paste may not preserve cross-bundle wiring.

### B4. `Respond No Speech` — replace the response body

Old body:
```
{{ { "reply": "I couldn't hear anything in that voice note — try again, or type your message.", "images": [], "transcript": "" } }}
```

New body:
```
{{ { "has_speech": false, "transcript": "" } }}
```

It's now consumed by the browser (which shows its own "couldn't hear that" message and returns to the
preview state), not rendered as a chat bubble, so it no longer carries a `reply` string.

### Leave everything else exactly as it is

- `Guardrails.text` stays `{{ $json.text }}` — still fed by the `Text` node on the typed-message
  branch. No change here.
- The `transcript` field already present in `Respond Success` / `Respond Error` /
  `Respond Guardrail Fail` (added in v1) is **unused now but harmless**. Do not remove it — it already
  ships, and touching it is pointless churn.
- Nothing from `Embed Query` onward changes: `Check Semantic Cache`, `Parse Cache Result`,
  `Cache Hit?`, `Return Cached Reply`, `Execute a SQL query`, `Code in JavaScript`, `AI Agent`,
  `Gemini`, `Search Pinecone`, `Embeddings Google Gemini`, `Reranker Cohere`,
  `Structured Output Parser`, `Google Gemini Chat Model`, `Code in JavaScript1`,
  `Insert rows in a table`, `Save to Semantic Cache`, `If` — all untouched.

---

## Part B-extra — `Analyze audio` → Options → Max Output Tokens = 2048

Applies to **both** workflows, from-scratch or delta.

The node's `maxOutputTokens` **defaults to 300**, which is only ~200–225 words — roughly 1.5 minutes
of ordinary speech, and less for a fast speaker. The recording cap is 2 minutes, so a long voice note
would have its transcript silently truncated mid-sentence and the user would confirm a cut-off
question without noticing. Set it to **2048**.

Note there is no temperature control on this node — `maxOutputTokens` is the only option it exposes.

---

## Part C — WhatsApp workflow (`Mawavia Whatsapp Chatbot`)

Exactly **three** node edits, regardless of whether Web Chat is being applied from scratch or as a
delta. Change nothing else.

### C1. `Analyze audio` — replace the `text` parameter

Same v2 prompt as Web Chat's `Analyze audio`, **byte-identical** — see Part B1 above for the full
text. This matters because the two channels share one `semantic_cache`; if the prompts diverge, the
same spoken question normalizes differently per channel and stops hitting the shared cache.

### C2. `Check Text` — add the same second condition as Part B2

Same as B2: keep the existing `{{ $json.text }}` **is not empty** condition, and add
`{{ $json.text }}` **does not contain** `[NO_SPEECH]`, combinator AND.

### C3. `Analyze audio` → Options → Max Output Tokens = 2048

Same as Part B-extra. WhatsApp voice notes are frequently longer than web ones, so the 300-token
default truncates transcripts here more often, not less.

Its false branch already goes to `Send Fallback Guardrail1` ("Sorry, I couldn't understand your voice
note..."), so a no-speech voice note now correctly gets that reply instead of a hallucinated answer.
**No other WhatsApp node changes** beyond Part E below.

---

## Part E — `AI Agent` → System Message: the LANGUAGE RULE

Applies to **both** workflows. The two `AI Agent` system messages are byte-identical (7502 chars
after this change) and **must stay that way** — they share one `semantic_cache`, which stores the
*reply text*. If one channel replies in English and the other doesn't, a cached reply from either is
served to users of the other in the wrong language.

**The bug:** the system prompt contained *no language instruction whatsoever*. With nothing telling
it what to do, the model mirrored the user and drifted — a Roman Urdu question came back answered in
Hindi.

**The fix:** paste this block immediately after the `ROLE` line
("You are the Strict Machinery Lookup Assistant... search_pinecone tool.") and before
`KNOWLEDGE BOUNDARIES`:

```
LANGUAGE RULE (ABSOLUTE — OVERRIDES EVERYTHING ELSE)
Always write the "reply" field in ENGLISH. No exceptions.
🔹 Customers often write in Roman Urdu, Hindi, Sindhi or Punjabi, or mix them with English. Understand them perfectly — but ALWAYS answer in English.
🔹 NEVER reply in Urdu, Hindi, Sindhi or Punjabi — not in Roman letters, and not in Arabic or Devanagari script.
🔹 NEVER output Arabic or Devanagari characters anywhere in the reply.
🔹 Do not apologise for the language, do not offer to switch, do not comment on it. Just answer in English.
Machine and model names, specs and numbers always keep their exact catalogue spelling.
```

Then, in the reply-formatting section, append to the line ending
"Style: Keep it punchy, scannable, and concise. No long paragraphs.":

```
 Language: ENGLISH ONLY — see LANGUAGE RULE.
```

Copy both from `n8n/Hi-Tech Web Chat.json` (`AI Agent` → `parameters.options.systemMessage`) if you'd
rather not retype the em dashes and emoji.

**This change does nothing on its own until the cache is cleared.** `semantic_cache` is checked
*before* the agent runs, so every question already asked keeps returning its old, wrong-language
reply no matter what the prompt says.

---

## Part D — Verification

Do these in order; do not mark the workflow Active until all pass.

1. **Pin a noise-only WAV.** On the `Webhook` node (Web Chat) or `WhatsApp Trigger` (WhatsApp), pin a
   body/media pointing at a real audio file that has no speech — silence, static, or background noise
   only.
   - Run the workflow. `Analyze audio` must return `[NO_SPEECH]`. `Check Text` must route **false**.
   - **Web Chat**: `Respond No Speech` fires with `{ "has_speech": false, "transcript": "" }`. The
     agent (`Romanizer`, and everything from `Embed Query` onward) must **not execute** — confirm no
     new row lands in `web_chat_histories` or `semantic_cache`.
   - **WhatsApp**: `Send Fallback Guardrail1` fires with the "couldn't understand" message. Same check
     — no hallucinated answer, no cache write.

2. **Pin a real speech WAV.** `Analyze audio` returns an actual transcript (not `[NO_SPEECH]`).
   `Check Text` routes **true** → `Romanizer` → `Transcript`.
   - **Web Chat**: confirm the flow now ends at `Respond Transcript` with
     `{ "has_speech": true, "transcript": "<romanized text>" }`, and that the AI Agent /
     Pinecone / semantic-cache nodes never execute on this request. (They only run once the browser
     re-posts the confirmed transcript as an ordinary `{ message, session_id, name }` request.)
   - **WhatsApp** is unchanged here — it still answers the transcribed question directly, same as
     before this fix.

3. **Pin a typed message** (`{ "message": "pvc pipe machine", "session_id": "test", "name": "test" }`
   on Web Chat's `Webhook`). Confirm it's unaffected: routes through `Has Audio?` false →
   `Text` → `Guardrails` → ... → `Respond Success`, exactly as before.

4. **End to end (the actual bug)**: record a silent/noisy voice note in the running dashboard. It must
   be rejected without an answer — the browser shows an inline "couldn't hear anything" message — and
   confirm **nothing** was written to `web_chat_histories` or `semantic_cache`. Then record real
   speech, edit the transcript in the confirm step, send, and check the row that lands carries the
   *edited* text.

5. **WhatsApp end to end**: send a noise-only voice note to the WhatsApp number; confirm it replies
   with the fallback message, not an invented answer.

6. **Regression**: typed messages and receipt upload still work exactly as before.

Only after all six pass, save and confirm both workflows are Active.

## Watch item (unchanged from v1, still applies)

`Romanizer` is an `agent` node with a raw Gemini model and no output parser — the same shape that
previously leaked "thought" text into WhatsApp replies. It's kept identical to the proven WhatsApp
node on purpose and is gated behind `Check Text`, so it never sees the `[NO_SPEECH]` sentinel. If
voice queries start returning odd cache misses or garbled RAG results, suspect a leaked thinking
preamble in `Romanizer`'s output first; the fix is a Structured Output Parser reading the output as an
object.
