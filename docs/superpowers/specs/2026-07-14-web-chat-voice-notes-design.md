# Voice notes in the web chat — design

**Date:** 2026-07-14
**Status:** Approved, ready for implementation plan
**Scope:** Voice input (speech → text) in the dashboard Chat tab and the `Hi-Tech Web Chat` n8n workflow.

## Goal

Let a user record a voice note in the dashboard's Chat tab and have the assistant answer it, exactly
as the WhatsApp bot already does. The voice note is transcribed, romanized, and then enters the
*existing* text pipeline unchanged.

**In scope:** voice in (record → transcribe → assistant replies in text).
**Out of scope (explicitly):** voice out / TTS replies. Uploading pre-existing audio files. Storing
audio server-side.

## Why it's cheap to build

Every node downstream of `Guardrails` in the web workflow reads the user's utterance from
`$('Guardrails').first().json.guardrailsInput`. Feed a transcript into `Guardrails` and the whole
existing pipeline — semantic cache, Pinecone RAG, the agent, `web_chat_histories` logging, the
response shape — works with no further changes. The feature is therefore an *addition in front of
`Guardrails`*, not a change to the pipeline.

The transcription and romanization prompts are copied verbatim from the WhatsApp workflow
(`Mawavia Whatsapp Chatbot`). They are tuned for Roman Urdu / Hindi / Sindhi / Punjabi code-switching
and lock the brand spellings (Tederic, UWA, Haitian, SCR, YH/YE/YU). Reusing them is the point.

## The one real technical constraint

Gemini's audio API accepts **WAV, MP3, AIFF, AAC, OGG-Vorbis, FLAC**. It does **not** accept WebM.
Chrome's `MediaRecorder` produces `audio/webm;codecs=opus` by default. The WhatsApp path never hit
this because Meta delivers voice notes as OGG.

**Therefore the browser transcodes before sending:** decode the recording, downmix to mono, resample
to 16 kHz via `OfflineAudioContext`, write a WAV header. No dependency — all Web Audio built-ins.
16 kHz mono is not a compromise: Gemini downsamples audio to 16 kbps internally regardless, so this
just moves the downsampling to before the wire, which also keeps the payload small.

Worst case payload: 2 min × 16 kHz × 16-bit mono = 3.84 MB WAV → ~5.1 MB base64. Within Gemini's
20 MB inline limit and n8n's default 16 MB payload limit. The existing receipt uploader already
posts up to 10 MB images through the same mechanism.

---

## Part 1 — Browser

### New module: `src/voice.js`

Mirrors `src/receipts.js`: one job, no React, independently testable.

| Export | Contract |
|---|---|
| `isRecordingSupported()` | `MediaRecorder` + `getUserMedia` + secure context (HTTPS or `localhost`) all present. |
| `createRecorder()` | `{ start, stop, cancel }` over `MediaRecorder`. `stop()` → `{ blob, durationMs }`. Both `stop()` and `cancel()` **always** call `track.stop()` on every track, so the browser's mic indicator never stays lit. |
| `blobToWav16k(blob)` | Decode → mono → 16 kHz → WAV `Blob`. Pure; unit-testable. |
| `MAX_MS` | `120_000` (2 minutes). |
| `blobToBase64(blob)` | Strip the `data:` prefix, same as `receipts.js#fileToBase64`. |

### `ChatTab` composer state machine

`idle → recording → preview → sending → idle`

- **idle** — mic button sits beside the existing receipt button in the composer.
- **recording** — the textarea is *replaced* by a recording bar: pulsing red dot, live `M:SS` timer,
  trash button (cancel, discards) and stop button. Auto-stops at `MAX_MS`.
- **preview** — the bar becomes an unsent audio bubble: native `<audio controls>` playing the **raw
  recording blob** (not the WAV — the original is smaller and plays natively), plus discard /
  re-record / send.
- **sending** — transcode → base64 → POST. The audio bubble is committed to the thread and the
  existing typing dots appear.

### The user's bubble

Shows the inline audio player, and — once n8n answers — the returned transcript underneath it in
muted text. This is the user's safety net: when the model mishears a model number, they can see
exactly what the assistant heard and retype instead of guessing. Before the response lands, the
bubble shows a "Transcribing…" placeholder.

### Persistence

The audio blob is **session-only**. It lives in a `useRef` map keyed by a card id, never in
`localStorage` — identical to how `receiptFiles` holds the receipt `File`. On reload the bubble
degrades to the transcript text alone (the same pattern as the receipt cards' `expired` state).

Nothing is uploaded to Supabase Storage. Nothing is stored server-side. Only the transcript lands in
`web_chat_histories`, exactly as with the WhatsApp bot.

### Feature flag

The mic button renders only when `isRecordingSupported()` — same conditional-render pattern as
`receiptEnabled`. No dead button on an unsupported browser or an insecure origin.

### Failure modes (all surfaced in-chat, never silent)

| Failure | Behaviour |
|---|---|
| Mic permission denied | Inline error bubble explaining how to re-enable it. Composer returns to `idle`. |
| No `MediaRecorder` / insecure context | Mic button not rendered at all. |
| Transcode throws | Error bubble; the recording is **preserved** in `preview` so the user can retry the send. |
| Network / workflow error | Existing error-bubble path, unchanged. |
| Empty transcript (silence) | n8n responds with the no-speech message (see Part 2); rendered as a normal assistant bubble. |

---

## Part 2 — n8n `Hi-Tech Web Chat` workflow

Nine new nodes, one new LLM sub-node, one rewire, four edits to existing nodes. **Nothing from
`Embed Query` onward changes.**

```
Webhook ─▶ Has Audio? ─true─▶ Audio to Binary ─▶ Analyze audio ─▶ Transcribe Text ─▶ Check Text
              │                                                                        │    │
              │                                            Respond No Speech ◀──false───┘    │ true
              │                                                                              ▼
              │                                                        Transcript ◀─ Romanizer (Gemini)
              │                                                             │
              └──false──▶ Text ───────────────────────────────────────────▶ Guardrails ─▶ (existing pipeline)
```

### New nodes

1. **`Has Audio?`** — `n8n-nodes-base.if`. Condition: `{{ $json.body.audio_base64 }}` **is not empty**
   (string, notEmpty). True → audio branch, false → text branch.

2. **`Audio to Binary`** — `n8n-nodes-base.convertToFile`, operation `toBinary`. Source property
   `body.audio_base64`, output binary property `data`, mime type `audio/wav`.

3. **`Analyze audio`** — `@n8n/n8n-nodes-langchain.googleGemini`, `resource: audio`,
   `operation: analyze`, `modelId: models/gemini-3.5-flash`, `inputType: binary`. **Prompt copied
   verbatim from the WhatsApp workflow's node of the same name** (phonetic Roman-script
   transcription, no translation, brand-spelling table, strip timestamps).

4. **`Transcribe Text`** — `n8n-nodes-base.set`. Assign
   `text = {{ $json.content?.parts?.[0]?.text ?? $json.output ?? $json.text ?? '' }}` — the same
   defensive read the WhatsApp workflow uses.

5. **`Check Text`** — `n8n-nodes-base.if`. `{{ $json.text }}` is not empty. True → `Romanizer`.
   False → `Respond No Speech`. (Mirrors the WhatsApp node of the same name.)

6. **`Romanizer`** — `@n8n/n8n-nodes-langchain.agent`, `promptType: define`, `text: {{ $json.text }}`,
   with the system message **copied verbatim from the WhatsApp workflow's `Romanizer`**: romanize any
   Urdu/Hindi/Sindhi/Punjabi script, apply the brand-name correction table, never translate, preserve
   model numbers, strip timestamps. Needs its own `lmChatGoogleGemini` sub-node
   (`Romanizer Gemini`) on the `ai_languageModel` input.

7. **`Transcript`** — `n8n-nodes-base.set`. Assign `text = {{ $json.output }}`.

   > **Deliberate deviation from the WhatsApp workflow:** there, this node writes a field named
   > `Transcript` while the text branch writes `text`, so `Guardrails` must cope with two shapes.
   > Here both branches converge on **`text`**, so `Guardrails` is a flat `{{ $json.text }}`.

8. **`Text`** — `n8n-nodes-base.set` on the false branch. Assign `text = {{ $json.body.message }}`.

9. **`Respond No Speech`** — `n8n-nodes-base.respondToWebhook`, JSON:
   `{ reply: "I couldn't hear anything in that voice note — try again, or type your message.", images: [], transcript: "" }`.
   Nothing is logged to `web_chat_histories` and nothing is written to `semantic_cache` on this path.

### Edits to existing nodes

| Node | Change | Why |
|---|---|---|
| `Webhook` | Main output rewired: `Guardrails` → `Has Audio?` | Branch on payload type. |
| `Guardrails` | `text`: `{{ $json.body.message }}` → `{{ $json.text }}` | **The keystone.** Both branches now converge on one field, so `guardrailsInput` is the user's utterance whether typed or spoken — and every downstream node already reads `guardrailsInput`. |
| `Respond Success` | Add `transcript: $('Guardrails').first().json.guardrailsInput` | So the browser can show what was heard. |
| `Respond Error` | Add the same `transcript` field | The bubble still shows the transcript even when the workflow fails. |
| `Respond Guardrail Fail` | Add the same `transcript` field | Same. |

### Why the Romanizer belongs on the web path too

Not merely for output quality:

- **Shared cache keys.** The web chat and the WhatsApp bot share the same `semantic_cache`. If the
  web path normalizes speech differently from the WhatsApp path, the same spoken question embeds
  differently per channel — voice notes miss the cache across channels, and the web writes entries
  under un-normalized text that WhatsApp will never hit.
- **RAG accuracy.** Pinecone is embedded over catalogue text with correct brand spellings.
  "Tederik" and "Tederic" are different vectors.
- **Separation of concerns.** Asking a transcription model for both phonetic fidelity *and* brand
  correction in one pass sets two goals against each other. Two passes, two prompts.

Cost: one extra flash call, **on the audio path only** — a typed message never touches it.

### Watch item

`Romanizer` is an `agent` node with a raw Gemini model and **no output parser** — the exact shape
that previously leaked "thought" text into WhatsApp replies (see the `n8n-gemini-thinking-leak`
note). It is behaving in production today, so the node is kept identical to the WhatsApp original
(proven beats clever). But its output feeds the *embedding*, so a leaked thinking preamble would
silently corrupt the query and poison the cache rather than merely looking wrong. **If voice queries
start returning odd results, suspect this first**; the fix is the known one — attach a Structured
Output Parser and read the output as an object.

### Delivery

**Not** via the n8n MCP `update_workflow` tool — it regenerates the workflow from SDK code and
silently drops connections (see the `n8n-mcp-update-unsafe` note). Instead:

1. A copy-paste node bundle (n8n accepts pasted node JSON directly onto the canvas).
2. A short checklist of the manual edits in the table above.
3. The checked-in `n8n/Hi-Tech Web Chat.json` export updated to match, so the repo stays in sync.

---

## Contract between the two halves

**Request** — `POST` to `VITE_N8N_CHAT_WEBHOOK` (the existing `hitech-web-chat` webhook):

```jsonc
// typed message (unchanged)
{ "message": "...", "session_id": "...", "name": "..." }

// voice note
{ "audio_base64": "<base64 WAV>", "mime_type": "audio/wav", "session_id": "...", "name": "..." }
```

**Response** — unchanged except for one added field:

```jsonc
{ "reply": "...", "images": [...], "from_cache": false, "transcript": "..." }
```

`transcript` is the post-Romanizer text. For typed messages it equals the message the user sent, and
the browser ignores it.

## Verification

- **Unit** — `blobToWav16k`: synthesize a tone, assert the WAV header (RIFF magic, 1 channel,
  16 000 Hz, 16-bit) and that the decoded samples match. `isRecordingSupported()` under mocked
  globals.
- **Workflow** — pin a base64 WAV on the `Webhook` node and run the workflow in n8n; confirm the
  audio branch reaches `Guardrails` with a romanized transcript, and that the silence case
  short-circuits to `Respond No Speech`.
- **End to end** — record a real voice note in the running dashboard; confirm the assistant answers,
  the transcript renders under the user's bubble, and a row lands in `web_chat_histories` with
  `User_Message` = the transcript and the correct `session_id`.
- **Regression** — typed messages still work, and the receipt-upload path is untouched.
