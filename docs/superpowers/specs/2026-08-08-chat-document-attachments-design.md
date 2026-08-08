# Chat document attachments — design

**Date:** 2026-08-08
**Status:** implemented

## What changed upstream

The n8n web-chat webhook's response gained one field:

```json
{
  "reply": "...",
  "images": ["https://..."],
  "from_cache": false,
  "documents": [
    {
      "kind": "pdf",
      "name": "Tederic DT 400 vs. Sound UN420-EPIII Comparison.pdf",
      "url": "/webhook/hitech-web-doc?session_id=abc123"
    }
  ]
}
```

`documents` is usually `[]`, and **always** `[]` on a cache hit — the attachment flag
lives on the agent turn, which a cached answer never runs. `kind` is `pdf` or
`proposal`; proposals arrive as `?file_id=…` instead of `?session_id=…`, which the
client doesn't need to care about.

## The constraint that shapes the design

The document endpoint validates the Supabase JWT and scopes the lookup to that
`user_id`, so nobody can pull another user's document by guessing a session id.

That makes it unreachable by *navigation*: `<a href download>` and `window.open()`
both 401, because browsers don't attach `Authorization` to navigations. The client
must `fetch()` with the header and save the resulting blob.

## Implementation

All in `src/mawavia-dashboard.jsx`, following the existing `images` path.

1. **`cleanDocuments(docs)`** — validates the array: keeps entries with a non-empty
   string `name` and a `url` starting with `/`, normalises `kind` to `pdf` unless it
   is exactly `proposal`. Absolute URLs are dropped so a malformed or tampered agent
   turn can't point a chip off-host. The URL stays relative and is resolved against
   `N8N_CHAT_WEBHOOK` at fetch time, so the editor's `/webhook-test/` path works the
   same as prod.

2. **`downloadDocument(doc)`** — resolves the URL, takes the token from
   `getAccessToken()` (which refreshes a nearly-expired JWT, removing the common
   cause of a 401 before the request rather than reporting it after), fetches, and
   hands the blob to the existing `saveBlob()` helper from `export.js`.

   | Status | Handling |
   |---|---|
   | 200 | `saveBlob(blob, doc.name)` |
   | 401 | "Your session expired — sign in again to download this." |
   | 404 | Show the body's `detail`, else "No document is available for this answer yet." |
   | other | "Couldn't fetch the document (HTTP n)." |

   The 404 is expected occasionally: the agent sets the flag from conversation
   history and the webhook is what actually checks. A wrong flag costs one failed
   fetch, never a wrong document.

3. **`parseChatReply()`** returns `documents` alongside `images`; both send sites
   (typed `send()` and `sendConfirmedVoice()`) put it on the assistant message.
   localStorage is the thread's source of truth, so chips survive a reload; the
   text-only DB fallback has no documents, same as it has no images.

4. **`<DocumentChips>`** renders under the images grid in `ChatBubble`. One
   full-width chip per document, `min-h-[44px]` for touch, filename truncating
   rather than wrapping (checked at 360px). Per-chip busy and error state — a 404 on
   one attachment must not blank a sibling.

## Not done

Inline preview. An `<iframe>` of the same blob URL would work, but a PDF iframe on a
360px phone is close to unreadable and would dominate the thread. Download is also
what the file is for: these get forwarded to a customer.

## Verifying against the live webhook

```
curl -i -H "Authorization: Bearer <supabase-jwt>" \
  "https://bot.hitech-machinery.com/webhook/hitech-web-doc?session_id=<real-session>" \
  -o out.pdf
```

Expect 200, `Content-Type: application/pdf`, and a `Content-Disposition` naming the
file. A 401 with a known-good token points at CORS — the `Authorization` header
triggers a preflight `OPTIONS` that n8n has to answer.

CSP is not a factor: `vercel.json`'s `connect-src` already lists
`bot.hitech-machinery.com` for the chat POST, and `saveBlob` is already used in
production for CSV/XLSX exports.
