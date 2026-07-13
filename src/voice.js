// Voice-note helpers for the web chat. Mirrors receipts.js: one job, no React,
// independently testable. Recording stays session-only — nothing here talks to
// n8n or Supabase; ChatTab owns the POST.
// See docs/superpowers/specs/2026-07-14-web-chat-voice-notes-design.md.

export const MAX_MS = 120_000; // 2 minutes — matches the n8n/Gemini worst-case payload math in the spec

// MediaRecorder + getUserMedia both require a secure context (HTTPS or localhost);
// on plain HTTP they're either undefined or throw, so check isSecureContext up front
// rather than let the user hit a confusing runtime error.
export function isRecordingSupported() {
  return !!(
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    window.MediaRecorder &&
    navigator.mediaDevices?.getUserMedia
  );
}

// Chrome/Firefox give opus-in-webm; Safari doesn't support that at all and needs
// mp4. Empty string falls through to the browser's own default as a last resort.
function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4'];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return '';
}

// Thin wrapper over MediaRecorder. getUserMedia happens here (async, throws
// NotAllowedError on a denied permission) so the caller can await createRecorder()
// behind a try/catch before flipping the UI to "recording". CRITICAL: stop() and
// cancel() both call track.stop() on every track of the mic stream — skipping
// that leaves the browser's mic-in-use indicator lit even after recording ends.
export async function createRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks = [];
  let startedAt = 0;
  rec.addEventListener('dataavailable', e => { if (e.data.size > 0) chunks.push(e.data); });

  const releaseMic = () => stream.getTracks().forEach(t => t.stop());

  return {
    start: () => { startedAt = Date.now(); rec.start(); },
    stop: () => new Promise(resolve => {
      rec.addEventListener('stop', () => {
        releaseMic();
        resolve({ blob: new Blob(chunks, { type: mimeType || rec.mimeType || 'audio/webm' }), durationMs: Date.now() - startedAt });
      }, { once: true });
      rec.stop();
    }),
    cancel: () => {
      if (rec.state !== 'inactive') rec.stop();
      releaseMic();
    },
  };
}

// Gemini's audio API accepts WAV/MP3/AIFF/AAC/OGG-Vorbis/FLAC but NOT WebM, which
// is what MediaRecorder produces in Chrome. Decode -> downmix to mono -> resample
// to 16kHz -> write a WAV header, all with Web Audio built-ins (no dependency).
// 16kHz mono isn't a quality compromise: Gemini downsamples to 16kbps internally
// regardless, so this just moves that step before the wire and shrinks the payload.
// Pure function of its input — no globals besides the Web Audio constructors — so
// it's unit-testable with a synthesized tone.
export async function blobToWav16k(blob) {
  const SAMPLE_RATE = 16000;
  const arrayBuffer = await blob.arrayBuffer();

  // Safari has no unprefixed AudioContext in some versions.
  const DecodeCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new DecodeCtx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close?.();
  }

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = offline.createBufferSource();

  // Downmix to mono ourselves: OfflineAudioContext's implicit channel mixing on
  // render is fine for stereo->mono, but source buffers with >1 channel need a
  // single-channel buffer to feed a 1-channel destination predictably.
  let monoBuffer = decoded;
  if (decoded.numberOfChannels > 1) {
    monoBuffer = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const mono = monoBuffer.getChannelData(0);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] = (mono[i] || 0) + data[i] / decoded.numberOfChannels;
    }
  }

  src.buffer = monoBuffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  return encodeWav(samples, SAMPLE_RATE);
}

// 44-byte canonical RIFF/WAVE header + 16-bit PCM samples, mono.
function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // 1 channel
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // fmt chunk size
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// Same shape as receipts.js#fileToBase64 — strip the `data:` prefix, works on any Blob.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the recording.'));
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}
