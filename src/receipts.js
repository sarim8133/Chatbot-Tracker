// Receipt upload helpers for the web chat. Two-step, confirm-before-save:
//   extractReceipt(file)  -> { ok, fields, is_receipt, ... }  (nothing saved yet)
//   saveReceipt(file, fields) -> { ok, expense_id }           (only on Accept)
// Identity is proven by the caller's JWT (Authorization header); n8n derives the
// real phone/name server-side, so nothing here is trusted for attribution.
import { N8N_RECEIPT_WEBHOOK, SB_URL, SB_KEY } from './config';
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
