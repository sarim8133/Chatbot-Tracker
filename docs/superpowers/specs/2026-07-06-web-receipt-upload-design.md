# Web Receipt Upload — Design

**Date:** 2026-07-06
**Status:** Implemented 2026-07-06 (branch `feat/web-receipt-upload`; n8n workflow `qXERnY10e57PGhfv` — pending manual credential mapping + activation). Save branch persists the client-confirmed fields (no re-OCR).

## Goal

Let a logged-in user submit a receipt **image from the website chat box** (not only
WhatsApp). The image is read by the same AI extraction as the WhatsApp bot, the user
**confirms or rejects** the result, and on confirm the receipt lands in the **same
`wap_expenses` table** — so it flows into the existing Expenses dashboard with the
same per-employee access control. This bypasses the Meta testing-mode 5-recipient
cap (a logged-in web user is not a WhatsApp recipient).

Non-goals (v1): editing extracted fields, OCR of PDFs, multi-image batches, undo
after confirm.

## Key decisions (locked)

1. **Confirm-before-save.** Upload → extract → preview card in chat → **Confirm & save**
   or **Reject**. No auto-save. No field editing.
2. **Base64 transport, Storage for the file.** The browser base64-encodes the image
   and POSTs it to a new n8n webhook. n8n saves the actual file to **Supabase Storage**
   (private bucket) and stores only the short path in the row. The base64 is **never**
   written to the database.
3. **Identity is derived from the JWT, never claimed by the client.** The browser sends
   its Supabase access token; n8n validates it via `GET /auth/v1/user` and looks up
   `app_users` to get the trusted `phone` / `full_name` / `department`. `sender_phone`
   cannot be spoofed.
4. **Nothing is saved until Accept.** Step 1 only *reads* the image and returns the
   extracted fields — it writes **nothing** to the database or Storage. On **Accept**,
   the image is uploaded to Storage and the row is inserted. On **Reject**, it is
   discarded entirely client-side (no DB row, no stored file ever existed) and the user
   is prompted to resend. The browser holds the picked image locally between the two
   steps, so Accept re-sends it; there is no server-side temp state to clean up.

## Attribution rules

Derived server-side in n8n from the validated JWT → `app_users`:

| Submitter role      | Has phone? | Behaviour                                                        |
|---------------------|------------|-----------------------------------------------------------------|
| employee            | yes        | `sender_phone` = their phone. Normal.                           |
| employee            | no         | **Rejected**: "your account isn't linked to a phone yet — ask admin." (A phone-less employee row would be invisible to them under RLS.) |
| admin / accountant  | yes        | `sender_phone` = their phone.                                   |
| admin / accountant  | no         | Allowed. `sender_phone` null; attributed by `employee_name`. They can view all expenses, so their own receipt is still visible. |

`employee_name` = `app_users.full_name` (fallback: email local-part). `department` from
`app_users`.

## Architecture

```
Browser (Chat tab)                     n8n (new workflow)                 Supabase
─────────────────                      ──────────────────                 ────────
[pick image] ──base64 + JWT──▶  POST /webhook/receipt-web  (action=extract)
                                  1. validate JWT  ──GET /auth/v1/user──▶  Auth
                                  2. lookup app_users ─────────────────▶  app_users
                                  3. gate by attribution rules
                                  4. Gemini vision extract (reuse WA sub-chain)
                                     (NOTHING written to DB or Storage yet)
                              ◀── { fields, ai_confidence } ──
[preview card]
   ├─[Reject] ── discard locally, prompt "upload again / contact accountant" (no server call needed)
   └─[Accept] ──base64 + fields + JWT──▶ POST /webhook/receipt-web  (action=save)
                                  1. re-validate JWT + re-derive identity
                                  2. upload file ─────────────────────▶  Storage: receipts/
                                  3. INSERT wap_expenses (status='logged') ▶ wap_expenses
                              ◀── { ok, expense_id } ──
[card resolves to ✓ Saved]
```

The browser keeps the picked file in memory, so **Accept** re-sends the base64; **Reject**
never contacts the server. Identity is re-derived from the JWT on save, so `sender_phone`
is trusted regardless of what the client sends.

### Components

- **New n8n workflow — "HiTech Receipt Processor (Web)".** One webhook with an `action`
  field: `extract` (read image, return fields, write nothing) and `save` (upload image +
  insert row). The **extraction sub-chain (Gemini vision → parse fields) is reused from
  the existing WhatsApp workflow**; only the trigger (webhook vs WhatsApp) and the
  identity source (JWT vs sender phone) differ. The webhook returns CORS headers (the
  existing chat webhook already proves browser calls work).
- **Supabase Storage bucket `receipts/`** — private. Read gated by RLS so an employee
  can fetch only their own receipt images (by `sender_phone`/owner), admin+accountant
  all. n8n uploads with the service-role key.
- **`wap_expenses` reuse** — existing columns: `expense_id, sender_phone, employee_name,
  department, category, total, subtotal, tax, currency, payment_method, vendor_name,
  date, processed_at, ai_confidence, items, status`. **No Google Drive in the web flow** —
  the Drive columns (`drive_file_id`/`drive_file_name`/`drive_link`) are left null; the
  Supabase Storage object path is stored in a new **`image_path`** column instead. Row is
  inserted only on **Accept**, with `status = 'logged'` (the WhatsApp flow's good-row
  status; `expense_id` format `EXP-<year>-<last6 of timestamp>`).
- **Chat UI (`ChatTab` in `src/mawavia-dashboard.jsx`)** — add an image attach button
  to the existing composer. On select: preview thumbnail, upload, then render a
  **receipt preview card** bubble (vendor / total / category / date + Confirm & save /
  Reject). Card is a new message `role: 'receipt'` variant. Reuses the existing
  send/error patterns; posts to the new webhook URL from config (`VITE_N8N_RECEIPT_WEBHOOK`).
- **`src/config.js`** — add `N8N_RECEIPT_WEBHOOK` (empty → attach button hidden / "not
  configured").
- **Dashboard display** — `ReceiptRow` / receipt drill-down renders the image via a
  short-lived **signed URL** from the stored path (private bucket + RLS = per-employee
  isolation). Unblocks the previously-deferred "display receipts" feature, securely.

## Data flow / status lifecycle

There is no `pending` state — a row exists only after Accept, created directly as
`logged` (the WhatsApp flow's good-row status, shown by the existing
`status = neq.rejected` dashboard query). A rejected upload never becomes a row at all.

## Error handling

- Invalid/expired JWT → `401`, chat shows "Please sign in again."
- Phone-less employee → `403` with the "ask admin" message.
- Gemini extraction fails / low confidence → step 1 returns the error; chat shows
  "Couldn't read that receipt clearly — try a sharper photo, or contact the accountant."
  Nothing is written (nothing ever is, before Accept).
- Reject → chat: "No problem — upload it again, or contact the accountant if the
  details keep coming out wrong." Purely client-side; no server call, no row, no file.
- Webhook unreachable / CORS → same messaging the chat already uses for the assistant.

## Security notes

- `sender_phone` is derived from the validated JWT, never from the request body →
  no cross-user impersonation.
- No field editing in the UI. The extracted fields are held client-side between the two
  steps, so a technical user could in principle alter their *own* total before Accept —
  this only affects their own expenses (which the accountant reviews) and never another
  employee's. Accepted as a v1 trade-off; can be tightened later by having n8n re-extract
  on save or hold the extraction server-side.
- Private Storage bucket + RLS → receipt **images** inherit the same per-employee
  isolation as the expense rows (amounts/vendors don't leak across employees).
- Service-role key stays inside n8n (as it already does for the WhatsApp flow); the
  browser only ever holds the anon key + its own user JWT.

## Testing

- Employee with phone: upload → preview → confirm → row visible only to them + accountant/admin.
- Employee without phone: upload → rejected with "ask admin" message; no row written.
- Admin without phone: upload → confirm → row attributed by name, visible to admin.
- Reject path: no row and no stored file are ever created; user is prompted to resend.
- Spoof attempt (POST another user's phone in body): ignored; row attributed to the
  JWT's real user on save.
- Image display: employee sees only their own receipt image; cross-account fetch denied.

## Out of scope (future)

Field editing on the preview, PDF/multi-page receipts, batch upload, edit/undo after
confirm, moving WhatsApp intake to this same confirm model.
