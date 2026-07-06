# Web Receipt Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user upload a receipt image in the website chat box, review the AI-extracted fields, and on Accept save it to the same `wap_expenses` table the WhatsApp bot writes to.

**Architecture:** A new n8n webhook workflow ("HiTech Receipt Processor (Web)") reuses the WhatsApp workflow's Gemini extraction. It has two actions: `extract` (read image → return fields, writes nothing) and `save` (validate JWT → upload image to a private Supabase Storage bucket → insert the row). Identity comes from the caller's Supabase JWT (validated server-side), never from the request body. The React chat composer gains an image-attach button and a Confirm/Reject preview card.

**Tech Stack:** n8n (Webhook + Code + HTTP Request nodes), Supabase (Postgres, Storage, GoTrue auth), React + Vite, Tailwind, lucide-react.

**Reference spec:** `docs/superpowers/specs/2026-07-06-web-receipt-upload-design.md`

**Verification note:** This repo has no unit-test runner — verification is `npm run build`, `mcp__n8n-mcp__validate_workflow`, SQL checks via the Supabase MCP, and driving the real flow in the browser (the `verify` skill). Steps below use those as the "test".

---

## Environment facts (confirmed 2026-07-06)

- WhatsApp workflow id: `LWBG3wrnirRbdG99`. Good rows use `status = 'logged'`; non-receipts use `status = 'rejected'` (dashboard filters `status=neq.rejected`).
- `expense_id` format: `EXP-<fullYear>-<last 6 digits of Date.now()>`.
- Gemini call: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent` with `httpQueryAuth` (API key as query param), body carries `inlineData` base64 + a fixed JSON prompt (7 categories: Food, Fuel, Travel, Supplies, Utilities, Repairs, Other; PKR default).
- `wap_expenses` columns already exist: `id, expense_id, receipt_hash, vendor_name, date, total, subtotal, tax, currency, payment_method, receipt_number, items(jsonb), category, ai_confidence, ai_flag, employee_name, department, sender_phone, drive_file_id, drive_file_name, drive_link, status, processed_at, updated_at, is_receipt, tax_id`. `total/subtotal/tax/currency/status/processed_at/updated_at` are NOT NULL.
- Storage buckets today: `catalouge-images`, `Project` (both public). No `receipts` bucket.
- `app_users(user_id, role, phone, email, full_name, department, ...)`; helper `private.can_view_all_expenses()` exists (admin OR accountant).
- Supabase project ref + service-role key already configured inside n8n (the WhatsApp workflow uses them). The n8n instance base URL for webhooks matches the existing `VITE_N8N_CHAT_WEBHOOK` host.

---

## File / resource structure

**Supabase (via MCP `apply_migration`):**
- `wap_expenses.image_path text` — new nullable column, Storage object path for web receipts.
- Storage bucket `receipts` (private).
- RLS policies on `storage.objects` for the `receipts` bucket: owner-folder read + admin/accountant read.

**n8n (via MCP):**
- New workflow "HiTech Receipt Processor (Web)" — one Webhook node, action-switched.

**Frontend:**
- `src/config.js` — add `N8N_RECEIPT_WEBHOOK`.
- `.env.example` — document `VITE_N8N_RECEIPT_WEBHOOK`.
- `src/receipts.js` (new) — `fileToBase64`, `extractReceipt`, `saveReceipt` helpers (keeps `mawavia-dashboard.jsx` from growing further).
- `src/mawavia-dashboard.jsx` — `ChatTab`: attach button + upload state; new `ReceiptCard` bubble; wire extract/accept/reject.

---

## Phase A1 — Database & Storage

### Task 1: Add `image_path` column to `wap_expenses`

**Files:** Supabase migration (MCP `apply_migration`), and mirror into `db/expense-access-rls.sql` doc.

- [ ] **Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `add_image_path_to_wap_expenses`:

```sql
alter table public.wap_expenses
  add column if not exists image_path text;

comment on column public.wap_expenses.image_path is
  'Supabase Storage object path (bucket: receipts) for receipts uploaded via the website. Null for WhatsApp receipts (those use drive_link).';
```

- [ ] **Step 2: Verify the column exists**

Run via `mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='wap_expenses' and column_name='image_path';
```

Expected: one row, `text`, `YES`.

- [ ] **Step 3: Record it in the tracked SQL doc**

Append to `db/expense-access-rls.sql` (end of file), so version control reflects reality:

```sql
-- 6) Web receipt uploads --------------------------------------------------------
-- wap_expenses.image_path holds the Supabase Storage object path (bucket "receipts")
-- for receipts submitted through the website chat. WhatsApp receipts keep using Drive
-- (drive_link). Objects are stored at "<uploader_auth_uid>/<expense_id>.jpg".
alter table public.wap_expenses add column if not exists image_path text;
```

- [ ] **Step 4: Commit**

```bash
git add db/expense-access-rls.sql
git commit -m "db: add wap_expenses.image_path for web receipt uploads"
```

### Task 2: Create the private `receipts` Storage bucket

**Files:** Supabase (MCP `apply_migration`).

- [ ] **Step 1: Create the bucket (idempotent)**

`mcp__supabase__apply_migration`, name `create_receipts_bucket`:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];
```

- [ ] **Step 2: Verify**

`mcp__supabase__list_storage_buckets` → expect a `receipts` bucket with `public: false`.

### Task 3: RLS on `storage.objects` for `receipts`

Objects are stored at path `"<uploader_auth_uid>/<expense_id>.jpg"`. A user may read files in their own uid folder; admins/accountants may read all. n8n uploads with the service-role key (bypasses RLS), so no INSERT policy is needed for the app.

**Files:** Supabase (MCP `apply_migration`).

- [ ] **Step 1: Apply policies**

`mcp__supabase__apply_migration`, name `receipts_bucket_rls`:

```sql
-- Read: your own folder, or any if you can view all expenses.
drop policy if exists receipts_read_own_or_admin on storage.objects;
create policy receipts_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_view_all_expenses()
    )
  );
```

- [ ] **Step 2: Verify the policy exists**

```sql
select policyname from pg_policies
where schemaname='storage' and tablename='objects' and policyname='receipts_read_own_or_admin';
```

Expected: one row.

- [ ] **Step 3: Record in the tracked SQL doc**

Append the same two SQL blocks (bucket + policy) under the "Web receipt uploads" section of `db/expense-access-rls.sql`, then commit:

```bash
git add db/expense-access-rls.sql
git commit -m "db: private receipts bucket + read RLS (own folder or admin/accountant)"
```

---

## Phase A2 — n8n web receipt workflow

The workflow has ONE Webhook node (`POST /webhook/receipt-web`) whose body carries `action: 'extract' | 'save'`. A Switch routes on the action. Both branches first validate the JWT.

**Shared contract (frontend ⇄ n8n):**
- Request headers: `Authorization: Bearer <supabase access_token>`, `Content-Type: application/json`.
- `extract` body: `{ action:'extract', image_base64, mime_type }` → returns `{ ok:true, fields:{...}, ai_confidence, ai_flag, is_receipt } | { ok:false, error }`.
- `save` body: `{ action:'save', image_base64, mime_type, fields }` → returns `{ ok:true, expense_id } | { ok:false, error }`.
- On non-2xx, body is `{ ok:false, error }`. All responses include CORS headers.

### Task 4: Learn the n8n SDK + confirm node types

- [ ] **Step 1: Read the SDK reference**

Call `mcp__n8n-mcp__get_sdk_reference` (sections: default, then `guidelines`, `design`).

- [ ] **Step 2: Confirm node type ids**

Call `mcp__n8n-mcp__get_node_types` for: `n8n-nodes-base.webhook`, `n8n-nodes-base.respondToWebhook`, `n8n-nodes-base.switch`, `n8n-nodes-base.if`, `n8n-nodes-base.code`, `n8n-nodes-base.httpRequest`.
Expected: exact parameter names for each (confirm `respondToWebhook` supports response headers for CORS, and `webhook` supports an OPTIONS method / CORS option). Note them for Task 5.

### Task 5: Author the workflow code

**Files:** n8n workflow code (built in-session, validated, then created).

Node graph:

```
Webhook (POST + OPTIONS, CORS)
  → Validate JWT (HTTP Request: GET {SB_URL}/auth/v1/user, header Authorization + apikey)
  → Load Profile (Code: from getUser + a Supabase REST call to app_users)  ── on fail → Respond 401/403
  → Switch on action
      ├─ extract → Gemini OCR (HTTP) → Parse OCR (Code) → Respond {fields}
      └─ save    → Gemini re-parse (trust client fields) → Upload to Storage (HTTP, service role)
                    → Insert Row (HTTP, service role, Prefer: return=representation) → Respond {expense_id}
```

- [ ] **Step 1: Write the Webhook node**

`n8n-nodes-base.webhook`, `httpMethod` = `POST`, `path` = `receipt-web`, `responseMode` = `responseNode`. In options enable CORS: `allowedOrigins` = `*` (or the site origin). This makes n8n answer the browser preflight automatically.

- [ ] **Step 2: Write "Validate JWT" (HTTP Request)**

`GET {{$env.SB_URL}}/auth/v1/user` with headers `Authorization: {{ $json.body.__auth || $request.headers.authorization }}` and `apikey: {{$env.SB_ANON_KEY}}`. Set `onError: continueErrorOutput`. (Store `SB_URL`, `SB_ANON_KEY`, `SB_SERVICE_KEY` as n8n env/credentials; the WhatsApp flow already has the service key.)

> Note for implementer: the browser puts the token in the `Authorization` header; in n8n access it via the Webhook node's incoming headers (`$('Webhook').item.json.headers.authorization`). Use that exact expression rather than a body field.

- [ ] **Step 3: Write "Load Profile" (Code, runOnceForEachItem)**

```javascript
// Auth user came back from GET /auth/v1/user. Reject if missing.
const authUser = $json; // { id, email, ... } on success
if (!authUser || !authUser.id) {
  return { json: { __halt: true, status: 401, error: 'Please sign in again.' } };
}
// Fetch the app_users profile with the service role (RLS-free) via HTTP is done in a
// separate node; here we just carry the uid forward.
return { json: { uid: authUser.id, email: authUser.email } };
```

Then a second HTTP node "Get app_users": `GET {{$env.SB_URL}}/rest/v1/app_users?user_id=eq.{{ $json.uid }}&select=role,phone,full_name,department` with headers `apikey` + `Authorization: Bearer {{$env.SB_SERVICE_KEY}}`. Follow with a Code node "Gate":

```javascript
const uid = $('Load Profile').item.json.uid;
const email = $('Load Profile').item.json.email;
const rows = $input.all();
const p = rows.length ? rows[0].json : null;
const role = p?.role || 'employee';
const phone = p?.phone || null;
const name = p?.full_name || (email ? email.split('@')[0] : 'User');
const dept = p?.department || null;

// A phone-less EMPLOYEE cannot be attributed (their own RLS is phone-keyed).
if (role === 'employee' && !phone) {
  return { json: { __halt: true, status: 403,
    error: "Your account isn't linked to a phone number yet — ask your admin." } };
}
return { json: { uid, role, phone, employee_name: name, department: dept } };
```

- [ ] **Step 4: Add "Respond — Error" (Respond to Webhook)**

A `respondToWebhook` node used by every halt path: `responseCode` = `={{ $json.status || 400 }}`, body `={{ { ok:false, error: $json.error } }}`, response headers include `Access-Control-Allow-Origin: *`. Route any node emitting `__halt:true` here (use IF nodes checking `$json.__halt === true`).

- [ ] **Step 5: Add "Gemini OCR" (HTTP Request) — copied from the WhatsApp flow**

Copy the exact node config from workflow `LWBG3wrnirRbdG99` node **"🤖 Gemini OCR"** (same URL, `httpQueryAuth`, same `jsonBody` prompt). Change only the two `inlineData` expressions to read the web payload:

```
"mimeType": "{{ $('Webhook').item.json.body.mime_type }}",
"data": "{{ $('Webhook').item.json.body.image_base64 }}"
```

Keep `onError: continueRegularOutput`.

- [ ] **Step 6: Add "Parse OCR" (Code) — adapted from the WhatsApp flow**

Copy the body of node **"⚙️ Parse OCR Data"** from `LWBG3wrnirRbdG99` verbatim, then change ONLY the identity block. Replace the WhatsApp lines:

```javascript
const sd = $('✅ Validate Sender').first().json;
const receiptHash = $('WhatsApp Trigger').first().json.messages?.[0]?.image?.sha256 || null;
```
with:
```javascript
const sd = $('Gate').first().json;                 // { employee_name, department, phone }
const receiptHash = null;                          // web has no WhatsApp sha256
```
and change the two attribution fields in BOTH return objects:
```javascript
sender_phone: sd?.phone || null,
employee_name: sd?.employee_name || null,
department: sd?.department || null,
```
Leave `normalizeCategory`, item cleanup, `expense_id`, `status:'logged'`, and the `is_receipt:false → status:'rejected'` branch exactly as-is.

- [ ] **Step 7: `extract` branch — Respond with fields**

After Parse OCR on the `extract` path, add "Respond — Extract" (`respondToWebhook`): `responseCode` 200, body:

```
={{ { ok: true, is_receipt: $json.is_receipt, ai_confidence: $json.ai_confidence, ai_flag: $json.ai_flag, fields: $json } }}
```

CORS header as before. **No Storage upload, no insert on this path.**

- [ ] **Step 8: `save` branch — upload image to Storage**

On the `save` path (re-run Validate JWT + Gate + Parse OCR so identity/fields are fresh and server-derived), add "Upload to Storage" (HTTP Request):
- Method `POST`
- URL: `={{$env.SB_URL}}/storage/v1/object/receipts/{{ $('Gate').item.json.uid }}/{{ $('Parse OCR').item.json.expense_id }}.jpg`
- Headers: `Authorization: Bearer {{$env.SB_SERVICE_KEY}}`, `Content-Type: {{ $('Webhook').item.json.body.mime_type }}`, `x-upsert: true`
- Body: send raw binary. Convert the base64 to binary first with a Code node "Base64→Binary":

```javascript
const b64 = $('Webhook').item.json.body.image_base64;
const mime = $('Webhook').item.json.body.mime_type || 'image/jpeg';
const buffer = Buffer.from(b64, 'base64');
return {
  json: { path: `${$('Gate').item.json.uid}/${$('Parse OCR').item.json.expense_id}.jpg` },
  binary: { data: await this.helpers.prepareBinaryData(buffer, 'receipt.jpg', mime) },
};
```
Set the Upload node's Body to "Binary File", input field `data`. `onError: continueRegularOutput` (a failed upload should still let the row save with `image_path` null — best-effort, mirroring the WhatsApp Drive step).

- [ ] **Step 9: `save` branch — insert the row**

Add "Insert Row" (HTTP Request):
- `POST {{$env.SB_URL}}/rest/v1/wap_expenses`
- Headers: `apikey`, `Authorization: Bearer {{$env.SB_SERVICE_KEY}}`, `Content-Type: application/json`, `Prefer: return=representation`
- Body (JSON) — build in a preceding Code node "Build Row" so `image_path` is included:

```javascript
const r = $('Parse OCR').first().json;
const uploaded = $('Upload to Storage').first();
const okUpload = uploaded && !uploaded.json?.error;
return { json: {
  expense_id: r.expense_id,
  vendor_name: r.vendor_name, date: r.date, receipt_number: r.receipt_number,
  payment_method: r.payment_method, tax_id: r.tax_id, category: r.category,
  currency: r.currency || 'PKR', subtotal: r.subtotal, tax: r.tax, total: r.total,
  items: r.items, is_receipt: true, ai_confidence: r.ai_confidence, ai_flag: r.ai_flag,
  sender_phone: r.sender_phone, employee_name: r.employee_name, department: r.department,
  status: 'logged', processed_at: new Date().toISOString(),
  image_path: okUpload ? `${$('Gate').first().json.uid}/${r.expense_id}.jpg` : null,
} };
```

Then "Respond — Saved" (`respondToWebhook`): 200, body `={{ { ok:true, expense_id: $('Parse OCR').item.json.expense_id } }}`, CORS header.

- [ ] **Step 10: Validate the workflow code**

Call `mcp__n8n-mcp__validate_workflow` with the full code. Fix errors, re-validate until clean.
Expected: `valid: true`.

- [ ] **Step 11: Create the workflow**

Call `mcp__n8n-mcp__create_workflow_from_code` with `description`: "Web receipt intake: JWT-authed webhook, reuses WhatsApp Gemini OCR, uploads to Supabase Storage, inserts wap_expenses (status logged). Two actions: extract (preview) and save (confirm)."
Record the returned workflow id and the production webhook URL.

- [ ] **Step 12: Smoke-test the webhook (no token)**

```bash
curl -i -X POST '<RECEIPT_WEBHOOK_URL>' -H 'Content-Type: application/json' \
  -d '{"action":"extract","image_base64":"","mime_type":"image/jpeg"}'
```
Expected: `401` with `{"ok":false,"error":"Please sign in again."}` and an `Access-Control-Allow-Origin` header.

- [ ] **Step 13: Smoke-test with a real token + tiny image**

Get a token: sign in via the app (DevTools → `localStorage.ht_session.access_token`) or the GoTrue password grant. POST `action:'extract'` with a small base64 JPEG.
Expected: `200`, `ok:true`, `fields.total` a number, `fields.category` one of the 7. Then `action:'save'` → `200` with an `expense_id`; verify a row:

```sql
select expense_id, employee_name, sender_phone, total, category, status, image_path
from public.wap_expenses order by processed_at desc limit 1;
```
Expected: `status='logged'`, `image_path='<uid>/<expense_id>.jpg'`, and the object exists in the `receipts` bucket.

---

## Phase A3 — Frontend: config + upload helpers

### Task 6: Add the receipt webhook to config

**Files:** Modify `src/config.js`; modify `.env.example`.

- [ ] **Step 1: Add the config export**

In `src/config.js`, after `N8N_CHAT_WEBHOOK`:

```javascript
// n8n web receipt webhook — the Chat tab's image upload POSTs here (action:'extract'
// then action:'save'). Separate from the chat webhook. Empty → the attach button is
// hidden. See docs/superpowers/specs/2026-07-06-web-receipt-upload-design.md.
export const N8N_RECEIPT_WEBHOOK = import.meta.env.VITE_N8N_RECEIPT_WEBHOOK || '';
```

- [ ] **Step 2: Document the env var**

Add to `.env.example`:

```
# n8n webhook for receipt image uploads from the website chat (extract + save)
VITE_N8N_RECEIPT_WEBHOOK=
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.js .env.example
git commit -m "feat: add N8N_RECEIPT_WEBHOOK config for web receipt upload"
```

### Task 7: Receipt API helpers

**Files:** Create `src/receipts.js`.

- [ ] **Step 1: Write the helpers**

```javascript
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
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ built`, no errors (helpers are tree-shaken until imported — fine).

- [ ] **Step 3: Commit**

```bash
git add src/receipts.js
git commit -m "feat: receipt upload helpers (extract/save, base64, validation)"
```

---

## Phase A4 — Frontend: chat upload UI

### Task 8: Receipt preview card component

**Files:** Modify `src/mawavia-dashboard.jsx` (add `ReceiptCard` near `ChatBubble`, ~line 1354).

- [ ] **Step 1: Add the component**

```jsx
// A receipt preview bubble: shows extracted fields with Accept / Reject. Until the
// user accepts, NOTHING is saved server-side. Reject is purely local.
function ReceiptCard({ card, onAccept, onReject }) {
  const f = card.fields || {};
  const rows = [
    ['Vendor', f.vendor_name || '—'],
    ['Total', `PKR ${(Number(f.total) || 0).toLocaleString('en-US')}`],
    ['Category', f.category || 'Other'],
    ['Date', f.date || '—'],
  ];
  return (
    <div className="max-w-[420px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Receipt size={15} className="text-zinc-500" />
        <span className="text-[13px] font-semibold text-zinc-800">Is this right?</span>
      </div>
      {card.thumb && <img src={card.thumb} alt="receipt" className="max-h-40 rounded-lg mb-3 border border-zinc-100" />}
      <dl className="space-y-1.5 mb-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-[13px]">
            <dt className="text-zinc-400">{k}</dt><dd className="text-zinc-800 font-medium text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {card.status === 'pending' && (
        <div className="flex gap-2">
          <button onClick={onAccept} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-white text-[13px] font-semibold py-2 hover:bg-accent transition-colors">
            <CheckCircle2 size={14} /> Confirm & save
          </button>
          <button onClick={onReject} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 text-zinc-700 text-[13px] font-medium px-3 py-2 hover:border-zinc-900 transition-colors">
            <X size={14} /> Reject
          </button>
        </div>
      )}
      {card.status === 'saved' && <p className="text-[12.5px] font-medium" style={{ color: '#16794C' }}>✓ Saved to your expenses.</p>}
      {card.status === 'rejected' && <p className="text-[12.5px] text-zinc-500">Discarded — upload it again, or contact the accountant if it keeps coming out wrong.</p>}
      {card.status === 'saving' && <p className="text-[12.5px] text-zinc-500">Saving…</p>}
    </div>
  );
}
```

`Receipt`, `CheckCircle2`, `X` are already imported. Confirm `CheckCircle2` is in the import list at line 11; if not, add it.

- [ ] **Step 2: Build**

Run: `npm run build` → `✓ built`.

### Task 9: Wire upload into `ChatTab`

**Files:** Modify `src/mawavia-dashboard.jsx` (`ChatTab`, ~1395–1600).

- [ ] **Step 1: Import helpers + a hidden file input + state**

At top of file add: `import { validateImage, extractReceipt, saveReceipt } from './receipts';` and `import { N8N_RECEIPT_WEBHOOK } from './config';` (extend existing config import). In `ChatTab` add:

```jsx
const fileRef = useRef(null);
const receiptEnabled = !!N8N_RECEIPT_WEBHOOK;
const [pendingFile, setPendingFile] = useState(null);
```

Represent a receipt card as a message: `{ role:'receipt', card:{ fields, thumb, status, file }, ts }`.

- [ ] **Step 2: Handle file selection (extract)**

```jsx
const onPickReceipt = useCallback(async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';                 // allow re-picking the same file
  if (!file) return;
  const bad = validateImage(file);
  if (bad) { setMessages(m => [...m, { role:'assistant', error:true, text:bad, ts:Date.now() }]); return; }
  const thumb = URL.createObjectURL(file);
  const idx = Date.now();
  setMessages(m => [...m, { role:'receipt', ts:idx, card:{ status:'extracting', thumb, file } }]);
  try {
    const { fields } = await extractReceipt(file);
    setMessages(m => m.map(msg => msg.ts===idx ? { ...msg, card:{ ...msg.card, status:'pending', fields } } : msg));
  } catch (ex) {
    setMessages(m => m.map(msg => msg.ts===idx ? { ...msg, card:{ ...msg.card, status:'error' } } : msg)
      .concat({ role:'assistant', error:true, ts:Date.now(),
                text: ex.message || 'Couldn’t read that receipt — try a sharper photo.' }));
  }
}, []);
```

- [ ] **Step 3: Accept / Reject handlers**

```jsx
const acceptReceipt = useCallback(async (ts) => {
  setMessages(m => m.map(msg => msg.ts===ts ? { ...msg, card:{ ...msg.card, status:'saving' } } : msg));
  const card = messages.find(m => m.ts===ts)?.card;
  try {
    await saveReceipt(card.file, card.fields);
    setMessages(m => m.map(msg => msg.ts===ts ? { ...msg, card:{ ...msg.card, status:'saved', file:null } } : msg));
  } catch (ex) {
    setMessages(m => m.map(msg => msg.ts===ts ? { ...msg, card:{ ...msg.card, status:'pending' } } : msg)
      .concat({ role:'assistant', error:true, ts:Date.now(), text: ex.message || 'Couldn’t save — try again.' }));
  }
}, [messages]);

const rejectReceipt = useCallback((ts) => {
  setMessages(m => m.map(msg => msg.ts===ts ? { ...msg, card:{ ...msg.card, status:'rejected', file:null } } : msg));
}, []);
```

- [ ] **Step 4: Render receipt messages + the attach button**

In the message map, branch on role:

```jsx
{m.role === 'receipt'
  ? <ReceiptCard card={m.card} onAccept={() => acceptReceipt(m.ts)} onReject={() => rejectReceipt(m.ts)} />
  : <ChatBubble m={m} />}
```

Next to the composer's send button add (only when enabled):

```jsx
{receiptEnabled && (
  <>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickReceipt} />
    <button type="button" onClick={() => fileRef.current?.click()} aria-label="Upload a receipt"
      className="flex items-center justify-center w-10 h-10 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
      <Receipt size={18} />
    </button>
  </>
)}
```

- [ ] **Step 5: Build + lint**

Run: `npm run build`
Expected: `✓ built`, no new lint errors. Fix any unused-import / hook-dep warnings to match the file's existing baseline.

- [ ] **Step 6: Drive the real flow (verify skill)**

With `VITE_N8N_RECEIPT_WEBHOOK` set in `.env`, `npm run dev`, sign in as the employee with a phone, open Chat, click the receipt button, pick a real receipt photo. Confirm: preview card appears with sane fields → Confirm → "Saved" → the row shows in the Expenses tab (as that employee) and nowhere else. Then test Reject (no row), and a non-receipt image (graceful error).

- [ ] **Step 7: Commit**

```bash
git add src/mawavia-dashboard.jsx
git commit -m "feat: upload receipts from the chat box with confirm-before-save"
```

---

## Phase A5 — Wrap-up

### Task 10: Update memory + spec status

- [ ] **Step 1: Update the expense-access-control memory**

Add a line noting web upload is live: intake now works via WhatsApp OR the website chat (n8n "HiTech Receipt Processor (Web)", `image_path` + `receipts` bucket), bypassing Meta testing-mode. Cross-link `[[whatsapp-meta-testing-mode]]`.

- [ ] **Step 2: Mark the spec Status: Implemented** and commit docs.

```bash
git add docs/ && git commit -m "docs: mark web receipt upload implemented"
```

---

## Phase B (follow-up, separate deliverable) — Display receipt images in the dashboard

Not required for upload to work. When ready, its own plan covers: a `getReceiptSignedUrl(image_path)` helper (`supabase.storage.from('receipts').createSignedUrl`), rendering the image in `ReceiptRow`/drill-down (web rows via signed URL from `image_path`; legacy WhatsApp rows via `drive_link`), a graceful `ImageOff` fallback, and verifying an employee can load only their own receipt image (cross-account fetch denied by the Task 3 RLS).

---

## Self-review notes

- **Spec coverage:** confirm-before-save (Tasks 8–9), base64 transport + Storage file (Tasks 5,7), JWT identity/attribution incl. phone-less employee reject (Task 5 Gate), no-Drive + `image_path` (Tasks 1,5,9), `status='logged'` (Task 5,9), reject = nothing saved (Task 9 rejectReceipt), image display deferred to Phase B. All mapped.
- **No pending-row state** anywhere — insert happens only in the `save` branch. ✓
- **Type consistency:** `fields` object shape from `extractReceipt` is passed straight back to `saveReceipt`; n8n re-derives identity and ignores client-sent attribution. Card statuses used consistently: `extracting|pending|saving|saved|rejected|error`.
