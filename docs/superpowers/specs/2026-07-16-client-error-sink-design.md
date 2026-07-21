# Client-side error sink — design

**Date:** 2026-07-16
**Status:** Approved, implementing
**Motivation:** The dashboard has **zero** frontend error visibility today. Errors are shown to the
user (red bubbles) but recorded nowhere; ~34 `catch` blocks swallow silently; the one `console.error`
is DEV-only. The n8n error workflow covers the backend, but a client crash, a mobile-only exception,
or a dark-mode glitch leaves no trace unless a user reports it. This adds a lightweight sink.

## Decision: pool to Supabase, no push

Chosen over an n8n webhook (push) and a table+digest hybrid. Reasons:

- **Supabase is already CSP-allowed** (`connect-src … https://*.supabase.co`). No header change, unlike
  Sentry or a new n8n webhook. Lowest-effort by a clear margin.
- **Frontend errors are noisier than backend ones.** Pushing every one would cause alert fatigue and
  erode the n8n backend pushes Sarim just set up. Pooling for review keeps signal high.
- A row insert is **flood-tolerant and cheap** — unlike an n8n execution, which is metered.

Reviewing is done in the Supabase dashboard via SQL. **No admin UI is built** (YAGNI); a read-only
panel is a clean follow-up if reviewing becomes tedious.

## 1. Table `public.client_errors`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `created_at` | timestamptz default now() | |
| `kind` | text | `'error'` \| `'unhandledrejection'` \| `'react'` |
| `message` | text | truncated client-side to 1 KB |
| `stack` | text | truncated client-side to 4 KB |
| `route` | text | `location.hash`/path at time of error |
| `user_name` | text | from JWT if logged in, else null |
| `user_agent` | text | |
| `app_version` | text | build commit (Vite env), for "which deploy" |

**RLS: `INSERT` allowed to `anon` + `authenticated`; `SELECT` allowed only to admin.**
Errors can fire before login, so insert must not require a JWT. Safe because there is no read-back
for non-admins and columns are size-capped. The admin SELECT policy reuses the project's existing
admin check (matched to the pattern already used by other tables — see implementation).

## 2. `src/errlog.js` (no React; mirrors receipts.js / voice.js)

- `initErrorSink()` — registers `window.addEventListener('error', …)` and `'unhandledrejection'`.
- `logError(err, { kind, context })` — manual capture. Exposed so the currently-silent `catch`
  blocks *can* opt in later. **This change does not modify those catch blocks** — it only makes the
  function available.
- Posts to `${SB_URL}/rest/v1/client_errors` with the `apikey` (anon) header, plus the JWT as
  `Authorization` when present (for `user_name` attribution via the insert).

### Flood guard (the central constraint — a logger must never flood or self-amplify)

- **Dedupe:** signature = hash(`message` + first stack line). Each signature sends once per page-load.
- **Session cap:** hard stop at 25 sends per load. A render loop cannot exceed it.
- **Throttle:** ≤ 1 send per 2 s.
- **Truncate:** message ≤ 1 KB, stack ≤ 4 KB.
- **Self-protection:** the sink's own `fetch` is wrapped so a failing sink can NEVER throw — otherwise
  a logging failure would trip the global `error` handler and recurse. This is the classic
  error-logger footgun and is guarded explicitly.

## 3. `src/ErrorBoundary.jsx` (the high-value bonus)

There is no error boundary today, so a render-time throw white-screens the entire app — giving the
user nothing and leaving no record. The boundary:
- catches via `getDerivedStateFromError` + `componentDidCatch`,
- renders a small themed "Something broke — reload" card (uses the theme tokens, works in dark),
- calls `logError(err, { kind: 'react', context: componentStack })`.

Wraps `<App/>` in `main.jsx`.

## 4. Wiring (`src/main.jsx`)

```jsx
initErrorSink();                       // before render, to catch boot-time errors
createRoot(...).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
```

## PII stance

Send: message, stack, route, username, user-agent, app version.
**Do not send:** JWTs, chat message bodies, receipt contents, expense figures. Truncation caps
accidental leakage. `message`/`stack` are the exception content only, never app data we pass in.

## Out of scope (YAGNI)

- No admin UI to browse errors (query in Supabase).
- No change to the existing ~34 silent `catch` blocks (the hook is made available, not wired in).
- No push/notification (explicitly rejected above).

## Verification

- **Migration:** table + policies exist; `anon` can INSERT; a non-admin JWT cannot SELECT; admin can.
- **Flood guard (unit-testable, pure):** feed 100 identical errors → 1 send; 100 distinct → capped at
  25; verify truncation and the 2 s throttle.
- **Boundary:** a deliberately-thrown render error shows the fallback card (not a white screen) and
  writes one `react` row.
- **Global handlers:** a thrown async error and an unhandled promise rejection each write one row.
- **Self-protection:** with the network offline, triggering an error does not throw or recurse.
- **CSP:** confirm the POST succeeds in production (Supabase host already allow-listed).
- **Both themes / mobile:** the fallback card is legible in dark and at 360px.
