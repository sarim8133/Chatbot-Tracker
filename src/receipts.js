// Receipt upload helpers for the web chat. Two-step, confirm-before-save:
//   extractReceipt(file)  -> { ok, fields, is_receipt, ... }  (nothing saved yet)
//   saveReceipt(file, fields) -> { ok, expense_id }           (only on Accept)
// Identity is proven by the caller's JWT (Authorization header); n8n derives the
// real phone/name server-side, so nothing here is trusted for attribution.
import { N8N_RECEIPT_WEBHOOK, SB_URL, SB_KEY } from './config';
import { getAccessToken } from './auth';

// What the user may PICK. Generous, because compressImage() below shrinks whatever
// they choose — this only rejects the absurd. The real constraint is the request
// size (see below), which the raw file size no longer predicts.
const MAX_BYTES = 25 * 1024 * 1024;
const OK_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// nginx in front of n8n caps a request at 1MB (measured 2026-07-22: 0.5MB → 401,
// 1MB → 413). Base64 inflates by ~4/3, so the image itself has to stay near 700KB
// or the POST dies at the proxy — no CORS headers on the 413, so the browser can
// only report a bare "Failed to fetch" and n8n never even logs an execution.
// 500KB leaves comfortable headroom for the JSON wrapper.
const TARGET_BYTES = 500 * 1000;
const EDGES = [1600, 1200, 900];          // long-edge px, tried in order
const QUALITY = [0.82, 0.7, 0.6, 0.5];

export function validateImage(file) {
  if (!file) return 'No file selected.';
  if (!OK_MIME.includes(file.type)) return 'Please choose a JPG, PNG or WebP image.';
  if (file.size > MAX_BYTES) return 'Image too large (max 25MB).';
  return null;
}

// Pull an image out of a paste/drop DataTransfer, or null if there isn't one.
// items[] carries screenshots (Windows Snip, macOS Cmd+Shift+4, Android); files[]
// carries a file copied in the OS file manager. Neither alone covers every
// platform, so both are checked. Returns null for a plain-text paste, which the
// caller must treat as "not mine" and let through untouched.
export function imageFromClipboard(dt) {
  if (!dt) return null;
  for (const it of dt.items || []) {
    if (it.kind === 'file' && String(it.type || '').startsWith('image/')) {
      const f = it.getAsFile?.();
      if (f) return f;
    }
  }
  return Array.from(dt.files || []).find(f => String(f.type || '').startsWith('image/')) || null;
}

const canvasToBlob = (canvas, quality) =>
  new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));

// Decode with EXIF rotation baked into the pixels. Phone cameras store the photo
// sideways plus an orientation tag; canvas reads raw pixels and would drop it,
// handing Gemini a rotated receipt and wrecking the OCR.
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari < 16 and friends: no imageOrientation option. Best effort.
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }
}

// Downscale + re-encode to JPEG until it fits TARGET_BYTES. A receipt does not
// need 12 megapixels — 1600px on the long edge reads fine and turns a 3MB phone
// photo into ~200-400KB. Returns a Blob (its .type is 'image/jpeg', which is what
// extractReceipt/saveReceipt send as mime_type).
export async function compressImage(file) {
  const src = await decode(file);
  const sw = src.width, sh = src.height;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  let best = null;
  for (const edge of EDGES) {
    const scale = Math.min(1, edge / Math.max(sw, sh));
    canvas.width  = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of QUALITY) {
      const blob = await canvasToBlob(canvas, q);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= TARGET_BYTES) { src.close?.(); return blob; }
    }
  }
  src.close?.();
  if (!best) throw new Error('Could not process that image — try a different photo.');
  // Everything we tried is still over target. Send the smallest and let the proxy
  // decide; a 413 is at least now a genuine edge case rather than the normal path.
  return best;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.onload = () => resolve(String(r.result).split(',')[1]); // strip data: prefix
    r.readAsDataURL(file);
  });
}

async function post(body) {
  const token = await getAccessToken();
  const res = await fetch(N8N_RECEIPT_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  }
  return data;
}

export async function extractReceipt(file) {
  const image_base64 = await fileToBase64(file);
  return post({ action: 'extract', image_base64, mime_type: file.type });
}

export async function saveReceipt(file, fields) {
  const image_base64 = await fileToBase64(file);
  return post({ action: 'save', image_base64, mime_type: file.type, fields });
}

// Short-lived signed URL to view a receipt image stored in the private `receipts`
// bucket. `path` is wap_expenses.image_path ("<uid>/<expense_id>.jpg"). The bucket is
// private, so this is NOT a public URL — Storage RLS still applies, so only the
// receipt's owner (or an admin/accountant) can successfully sign it.
export async function signedReceiptUrl(path, expiresIn = 3600) {
  const token = await getAccessToken();
  const res = await fetch(`${SB_URL}/storage/v1/object/sign/receipts/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ expiresIn }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signedURL) {
    throw new Error(data.error || data.message || `Couldn't open the receipt (HTTP ${res.status})`);
  }
  return `${SB_URL}/storage/v1${data.signedURL}`;
}

// Signs many receipt paths at once, for the bulk download. Returns a
// Map(path -> url); a path the caller isn't allowed to read is simply absent
// rather than throwing, so one unreadable receipt can't sink a 200-file export.
//
// Storage RLS is what makes this safe to hand a whole month of paths: the
// receipts_read_own_or_admin policy signs only what the caller may see, so an
// employee's export physically cannot contain a colleague's receipt even if the
// client asked for it. There is no client-side check to forget here.
//
// Chunked because the path list grows with the export and a single request
// carrying two thousand of them is a timeout waiting to happen.
export async function signedReceiptUrls(paths, expiresIn = 3600, chunkSize = 100) {
  const token = await getAccessToken();
  const out = new Map();
  for (let i = 0; i < paths.length; i += chunkSize) {
    const slice = paths.slice(i, i + chunkSize);
    const res = await fetch(`${SB_URL}/storage/v1/object/sign/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expiresIn, paths: slice }),
    });
    if (!res.ok) continue;                       // whole chunk unavailable — skip it
    const list = await res.json().catch(() => []);
    for (const r of Array.isArray(list) ? list : []) {
      if (r?.signedURL && r?.path) out.set(r.path, `${SB_URL}/storage/v1${r.signedURL}`);
    }
  }
  return out;
}

// A signed URL that saves to disk instead of opening in a tab. Storage honours
// ?download=<name> by setting Content-Disposition, which is the only thing that
// works here — the <a download> attribute is ignored cross-origin, and Storage
// is a different origin from the dashboard.
export async function receiptDownloadUrl(path, filename) {
  const url = await signedReceiptUrl(path);
  return `${url}&download=${encodeURIComponent(filename)}`;
}

// Removes a receipt image from the private bucket. Called after
// admin_delete_expense() has already destroyed the row and handed back its
// image_path. Storage RLS (receipts_delete_accountant) is what actually
// authorises this — an employee gets a 4xx here.
//
// Deliberately best-effort: the row is already gone, so a failure leaves an
// orphaned object nobody can reach, which is far better than blocking the
// delete or reporting a failure for work that did in fact happen.
export async function deleteReceiptImage(path) {
  if (!path) return false;
  const token = await getAccessToken();
  const res = await fetch(`${SB_URL}/storage/v1/object/receipts/${path}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}
