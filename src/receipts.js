// Receipt upload helpers for the web chat. Two-step, confirm-before-save:
//   extractReceipt(file)  -> { ok, fields, is_receipt, ... }  (nothing saved yet)
//   saveReceipt(file, fields) -> { ok, expense_id }           (only on Accept)
// Identity is proven by the caller's JWT (Authorization header); n8n derives the
// real phone/name server-side, so nothing here is trusted for attribution.
import { N8N_RECEIPT_WEBHOOK } from './config';
import { getAccessToken } from './auth';

const MAX_BYTES = 10 * 1024 * 1024;
const OK_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file) {
  if (!file) return 'No file selected.';
  if (!OK_MIME.includes(file.type)) return 'Please choose a JPG, PNG or WebP image.';
  if (file.size > MAX_BYTES) return 'Image too large (max 10MB).';
  return null;
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
