# Voice-note hallucination fix — design (v2)

**Date:** 2026-07-14
**Status:** Approved, ready to implement
**Supersedes parts of:** `2026-07-14-web-chat-voice-notes-design.md` (the audio branch's tail end and
the browser's send flow). Everything else in v1 still stands.

## The bug

An empty voice note containing only background noise came back transcribed as
*"System start ho gaya hai"* — a confident, fluent hallucination.

**Root cause: the prompt forbids the model from saying "nothing."** The `Analyze audio` prompt opens
with *"Transcribe this audio EXACTLY as spoken, word for word"* and offers no escape hatch. Given
noise and an instruction that presupposes speech, an autoregressive model emits the most likely
Roman-Urdu sentence. This is the classic ASR hallucination-on-silence failure.

Three things then make it worse:

1. **The `Check Text` silence guard never fires.** It tests for an *empty* transcript. Gemini didn't
   return empty — it returned a lie.
2. **The `Romanizer` launders it.** A hallucination goes in, clean confident text comes out.
3. **It reaches the shared `semantic_cache`.** A hallucinated question gets answered *and cached* —
   the known cache-poisoning failure mode. Both channels share one cache, so a hallucination from
   either poisons the other.

**The WhatsApp bot has the identical bug** — same prompt, same missing escape hatch.

## The fix — three layers

### Layer 1 — let the model say "no speech" (both workflows)

Rewrite the `Analyze audio` prompt to make refusal a legal, explicitly-preferred move. It emits the
sentinel `[NO_SPEECH]` when there is nothing intelligible to transcribe.

A sentinel, **not** JSON/structured output: nothing to parse, no code-fence stripping, no schema to
drift. The full prompt text is in "Prompt: Analyze audio (v2)" below.

Gating changes accordingly — a transcript is only real if it is non-empty **and** is not the
sentinel:
- **Web Chat** — `Check Text` condition becomes: `{{ $json.text }}` is not empty **AND** does not
  contain `[NO_SPEECH]`.
- **WhatsApp** — same change to its `Check Text` node. Its false branch already goes to
  `Send Fallback Guardrail1`, so a no-speech voice note now correctly gets the "couldn't hear that"
  reply instead of a hallucinated answer. **No other WhatsApp change is needed** — two node edits
  total (`Analyze audio` prompt, `Check Text` condition).

### Layer 2 — never send silence at all (browser)

`blobToWav16k` already decodes the recording to raw PCM, so an energy check there is nearly free and
runs before any API call.

`blobToWav16k(blob)` now returns `{ wav, peak, rms, durationSec }` instead of a bare Blob. `ChatTab`
rejects the recording client-side, without calling n8n, when:
- `durationSec < 0.7` — too short to be an utterance, or
- `peak < 0.02` (≈ −34 dBFS) **and** `rms < 0.005` — no meaningful signal at all.

Both conditions are deliberately conservative: this layer only catches *obvious* nothing. Energy
alone cannot distinguish loud background noise from speech, which is why this is layer 2 and layer 1
does the real work.

### Layer 3 — confirm before send (browser + a rewired web workflow)

**Nothing reaches the agent, the history table, or the cache until a human approves the text.** This
mirrors the confirm-before-save pattern the receipt cards already use.

This makes the audio path a **two-step, two-round-trip flow**, which *simplifies* the n8n graph: the
audio branch no longer runs the agent at all. It becomes a pure transcription service.

1. Browser POSTs the audio → n8n transcribes, romanizes, and **responds with just the transcript**.
2. The user sees the transcript in an editable field with Send / Discard.
3. On Send, the browser posts it as an **ordinary typed message** (`{ message, session_id, name }`)
   through the pipeline that already works.

The transcript is **editable** before sending — the whole point of showing it is to let the user fix
a misheard model number, and it costs about ten lines to let them.

## Web Chat workflow — the rewire

```
Webhook ─▶ Has Audio? ─true─▶ Audio to Binary ─▶ Analyze audio ─▶ Transcribe Text ─▶ Check Text
              │                                                                       │      │
              │                                        Respond No Speech ◀──false──────┘      │ true
              │                                                                               ▼
              │                                            Respond Transcript ◀─ Transcript ◀─ Romanizer
              │
              └──false──▶ Text ──▶ Guardrails ──▶ (existing pipeline, unchanged)
```

**Changes from v1:**
- **DELETE** the connection `Transcript → Guardrails`. The audio branch now terminates at a response.
- **ADD** node `Respond Transcript` (`respondToWebhook`, JSON):
  `{ has_speech: true, transcript: $json.text }`
- **EDIT** `Respond No Speech` body to `{ has_speech: false, transcript: "" }` — it is now consumed
  by the browser, not shown to the user, so it carries no `reply` text.
- **EDIT** `Check Text` condition per Layer 1.
- **EDIT** `Analyze audio` prompt per Layer 1.
- `Guardrails.text` stays `{{ $json.text }}` (now fed only by the `Text` node). Unchanged.
- The `transcript` field added to `Respond Success` / `Respond Error` / `Respond Guardrail Fail` in v1
  is now **unused but harmless**. Leave it — it already ships, and removing it is pointless churn.

## Contract

```jsonc
// 1. transcribe (voice only)
POST → { "audio_base64": "<base64 WAV>", "mime_type": "audio/wav", "session_id": "...", "name": "..." }
     ← { "has_speech": true,  "transcript": "kitna hai Tederic ka rate" }
     ← { "has_speech": false, "transcript": "" }

// 2. send the confirmed text — an ordinary typed message, no new shape
POST → { "message": "kitna hai Tederic ka rate", "session_id": "...", "name": "..." }
     ← { "reply": "...", "images": [...], "from_cache": false }
```

## Browser state machine

`idle → recording → preview → transcribing → confirm → sending → idle`

- **transcribing** — after Send in `preview`: energy gate (layer 2), transcode, POST. On a layer-2
  rejection, or on `has_speech: false`, show an inline "couldn't hear anything" message and return to
  **preview** with the recording intact, so the user can play it back and decide.
- **confirm** — a `VoiceCard` (styled like `ReceiptCard`): the `VoicePlayer` over the recording, an
  editable transcript textarea, and Send / Discard.
- **sending** — posts the confirmed text via the *existing* typed-message path. The committed thread
  bubble is the `AudioBubble` (player + final transcript), so the thread still shows it was spoken.

## Prompt: Analyze audio (v2)

Replaces the `text` parameter of `Analyze audio` in **both** workflows, verbatim and identically —
the two channels share a semantic cache, so their normalization must not diverge.

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

The `Romanizer` prompt is **unchanged**. It is gated behind `Check Text`, so it never sees the
sentinel.

## Verification

- **Unit** — the energy gate: a synthesized silent buffer and a synthesized tone must land on
  opposite sides of the threshold. A <0.7 s buffer must be rejected on duration.
- **Workflow** — pin a noise-only WAV and confirm `Analyze audio` returns `[NO_SPEECH]`, `Check Text`
  routes false, and `Respond No Speech` answers `has_speech: false`. Pin a speech WAV and confirm the
  transcript comes back through `Respond Transcript` with the agent never running.
- **End to end (the actual bug)** — record a silent/noisy voice note in the dashboard. It must be
  rejected without an answer, and **nothing** may be written to `web_chat_histories` or
  `semantic_cache`. Then record real speech, edit the transcript, confirm, and check the row that
  lands carries the *edited* text.
- **WhatsApp** — send a noise-only voice note; it must reply with the fallback, not an invented
  answer.
- **Regression** — typed messages unchanged; receipt upload unchanged.
