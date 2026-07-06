# Web Receipt Upload — Design

**Date:** 2026-07-06
**Status:** Approved for planning

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
4. **Two-step status flip, no client-held data.** Step 1 writes the row immediately with
   `status = 'pending'`; the dashboard hides pending rows. Confirm flips it to the normal
   status; Reject flips it to `rejected` (already hidden) and deletes the stored image.
   The extracted numbers live in the DB from the start, so there is nothing for the client
   to tamper with between the two steps.

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
[pick image] ──base64 + JWT──▶  POST /webhook/receipt-web
                                  1. validate JWT  ──GET /auth/v1/user──▶  Auth
                                  2. lookup app_users ─────────────────▶  app_users
                                  3. gate by attribution rules
                                  4. upload file ─────────────────────▶  Storage: receipts/
                                  5. Gemini vision extract (reuse WA sub-chain)
                                  6. INSERT wap_expenses(status='pending')▶ wap_expenses
                              ◀── { expense_id, fields, image_url } ──
[preview card] ──[Confirm]/[Reject] + expense_id + JWT──▶ POST /webhook/receipt-web-confirm
                                  1. validate JWT + ownership (row.sender_phone == caller)
                                  2. Confirm → UPDATE status='processed'
                                     Reject  → UPDATE status='rejected' + delete Storage object
                              ◀── { ok } ──
[card resolves to ✓ Saved / ✗ Discarded]
```

### Components

- **New n8n workflow — "HiTech Receipt Processor (Web)".** Two webhook entry points
  (or one webhook with an `action` field): `submit` and `confirm`. The **extraction
  sub-chain (Gemini vision → parse fields) is reused from the existing WhatsApp
  workflow**; only the trigger (webhook vs WhatsApp) and the identity source (JWT vs
  sender phone) differ. Both webhooks return CORS headers (the existing chat webhook
  already proves browser calls work).
- **Supabase Storage bucket `receipts/`** — private. Read gated by RLS so an employee
  can fetch only their own receipt images (by `sender_phone`/owner), admin+accountant
  all. n8n uploads with the service-role key.
- **`wap_expenses` reuse** — existing columns: `expense_id, sender_phone, employee_name,
  department, category, total, subtotal, tax, currency, payment_method, vendor_name,
  date, processed_at, drive_link, ai_confidence, items, status`. The image path is
  stored in `drive_link` (or a new `image_url` column — decide at build time based on
  what the WhatsApp flow already puts in `drive_link`). `status = 'pending'` on insert.
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

`pending` (created, awaiting confirm) → `processed` (confirmed, shows in dashboard)
or `rejected` (hidden, image deleted). The ExpensesTab query already filters
`status = neq.rejected`; it will also exclude `pending` so unconfirmed uploads never
appear in anyone's ledger.

## Error handling

- Invalid/expired JWT → `401`, chat shows "Please sign in again."
- Phone-less employee → `403` with the "ask admin" message.
- Gemini extraction fails / low confidence → return the error; chat shows "Couldn't
  read that receipt clearly — try a sharper photo, or contact the accountant." No row
  is committed (or the pending row is cleaned up).
- Reject → chat: "No problem — upload it again, or contact the accountant if the
  details keep coming out wrong." Pending row set to `rejected`, image deleted.
- Confirm on a row the caller doesn't own → `403` (ownership check).
- Webhook unreachable / CORS → same messaging the chat already uses for the assistant.

## Security notes

- `sender_phone` is derived from the validated JWT, never from the request body →
  no cross-user impersonation.
- No field editing + server-side pending row → the confirm step carries only an
  `expense_id`; totals cannot be altered by the client.
- Private Storage bucket + RLS → receipt **images** inherit the same per-employee
  isolation as the expense rows (amounts/vendors don't leak across employees).
- Service-role key stays inside n8n (as it already does for the WhatsApp flow); the
  browser only ever holds the anon key + its own user JWT.

## Testing

- Employee with phone: upload → preview → confirm → row visible only to them + accountant/admin.
- Employee without phone: upload → rejected with "ask admin" message; no row written.
- Admin without phone: upload → confirm → row attributed by name, visible to admin.
- Reject path: pending row ends `rejected`, image removed, dashboard never shows it.
- Spoof attempt (POST another user's phone in body): ignored; row attributed to the
  JWT's real user.
- Confirm someone else's `expense_id`: `403`.
- Image display: employee sees only their own receipt image; cross-account fetch denied.

## Out of scope (future)

Field editing on the preview, PDF/multi-page receipts, batch upload, edit/undo after
confirm, moving WhatsApp intake to this same confirm model.
