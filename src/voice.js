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

  // Live level metering. MediaRecorder exposes no amplitude data at all, so this taps
  // an AnalyserNode off the SAME mic stream — a parallel read, not a second recording.
  // Deliberately never connected to ctx.destination: routing the mic to the speakers
  // would echo the user back at themselves and can start a feedback howl.
  const MeterCtx = window.AudioContext || window.webkitAudioContext;
  const meterCtx = new MeterCtx();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 1024;
  meterCtx.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);

  const releaseMic = () => {
    stream.getTracks().forEach(t => t.stop());
    meterCtx.close?.();   // an un-closed AudioContext keeps the audio thread alive
  };

  return {
    start: () => { startedAt = Date.now(); rec.start(); },

    // Current mic level, 0..1, for the live waveform. Speech RMS sits low (roughly
    // 0.02–0.2), so a linear map would leave the meter looking dead even while someone
    // is talking normally — the sqrt curve lifts quiet speech into a visible range.
    getLevel: () => {
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / frame.length);
      return Math.min(1, Math.sqrt(rms) * LIVE_METER_GAIN);
    },

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

// Tuned by feel: high enough that normal speech reaches most of the bar's height,
// low enough that room tone stays near the floor. Raise it if the meter looks flat.
const LIVE_METER_GAIN = 2.2;

// How often the live meter samples while recording. ~12 fps — fast enough to feel
// reactive, slow enough that it isn't re-rendering React 60 times a second.
export const LIVE_METER_MS = 80;

// Bars in the waveform. Fixed, not proportional to length: every voice note should
// read as the same object at a glance, and a 5-second note with 5 bars would look
// broken. WhatsApp does the same.
export const WAVEFORM_BARS = 44;

// Peak amplitude per bucket, for the player's waveform. Normalized against the
// loudest bucket so a quietly-recorded note still draws a full-height wave instead
// of a flat line — the wave is there to show WHERE the speech is, not how loud the
// mic gain was.
//
// Decoded independently of blobToWav16k because the preview needs the waveform the
// moment recording stops, long before the user has decided to send anything. It's a
// second decode of a <=2 minute blob, which is a few tens of milliseconds.
export async function computeWaveform(blob, buckets = WAVEFORM_BARS) {
  const DecodeCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new DecodeCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close?.();
  }

  const data = decoded.getChannelData(0);   // channel 0 is enough — this is only for drawing
  const size = Math.floor(data.length / buckets) || 1;
  const peaks = [];
  for (let b = 0; b < buckets; b++) {
    const start = b * size;
    const end   = Math.min(start + size, data.length);
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }

  const loudest = Math.max(...peaks, 1e-6);  // guard: a fully silent take would divide by zero
  return peaks.map(p => p / loudest);
}

// Gemini's audio API accepts WAV/MP3/AIFF/AAC/OGG-Vorbis/FLAC but NOT WebM, which
// is what MediaRecorder produces in Chrome. Decode -> downmix to mono -> resample
// to 16kHz -> write a WAV header, all with Web Audio built-ins (no dependency).
// 16kHz mono isn't a quality compromise: Gemini downsamples to 16kbps internally
// regardless, so this just moves that step before the wire and shrinks the payload.
// Pure function of its input — no globals besides the Web Audio constructors — so
// it's unit-testable with a synthesized tone.
//
// Returns { wav, peak, rms, durationSec } rather than a bare Blob: peak/rms are the
// energy-gate inputs for Layer 2 of the hallucination fix (see
// docs/superpowers/specs/2026-07-14-voice-hallucination-fix-design.md) and cost
// almost nothing to compute since the rendered 16kHz mono PCM is already in hand.
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

  // Peak (max |sample|) and RMS over the same buffer we're about to encode — nearly
  // free, and exactly what isProbablySilent() below needs.
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSquares += samples[i] * samples[i];
  }
  const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  const durationSec = samples.length / SAMPLE_RATE;

  return { wav: encodeWav(samples, SAMPLE_RATE), peak, rms, durationSec };
}

// Layer 2 of the hallucination fix: reject the *obvious* nothing before a single
// byte reaches n8n. These thresholds are deliberately conservative — energy alone
// cannot tell loud background noise from real speech (a noisy room can clear both
// bars easily), so this only catches silence / near-silence. The real defense
// against a confident hallucination is Layer 1, the `[NO_SPEECH]` sentinel in the
// n8n transcription prompt; this is just the free win that skips a round trip for
// the emptiest recordings. See the design doc's "Layer 2" section for the numbers.
export const MIN_VOICE_DURATION_SEC = 0.7;    // shorter than this can't be a spoken utterance
export const SILENCE_PEAK_THRESHOLD = 0.02;   // ~ -34 dBFS
export const SILENCE_RMS_THRESHOLD  = 0.005;

export function isProbablySilent({ peak, rms, durationSec }) {
  if (durationSec < MIN_VOICE_DURATION_SEC) return true;
  if (peak < SILENCE_PEAK_THRESHOLD && rms < SILENCE_RMS_THRESHOLD) return true;
  return false;
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
