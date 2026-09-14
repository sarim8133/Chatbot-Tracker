# Hi Tech Machinery — sales dashboard

A React + Vite SPA for Hi Tech Machinery's sales team: conversation analytics for the
WhatsApp and web chatbot, expense/receipt tracking, and an in-app chat that talks to
the same n8n assistant the WhatsApp bot uses. Supabase behind it, Vercel in front.

```
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run lint     # eslint
npm run preview  # serve the built dist/
```

Copy `.env.example` to `.env` and fill it in first — without `VITE_SB_URL` /
`VITE_SB_KEY` nothing loads, and without `VITE_N8N_CHAT_WEBHOOK` the Chat tab shows a
"not configured" notice instead of the assistant.

## Where things live

| Path | What's in it |
| --- | --- |
| `src/` | The app. `mawavia-dashboard.jsx` is the main console; `App.jsx` gates it behind `auth.js`. |
| `public/` | Static files served as-is — favicon, the header mark, `theme-init.js`, `_headers`. |
| `db/` | Supabase SQL: schema, RLS policies and dated migrations. Run them in the SQL editor. |
| `supabase/` | Edge functions and the branded auth email templates (pasted into the dashboard by hand). |
| `n8n/` | Reference copies of the assistant workflows, their system prompts, and the apply-checklists for past changes. |
| `rag/` | Python side: catalogue ingestion into Pinecone, manifests, and the review reports each pass produces. |
| `docs/` | Design specs, plans and handoffs. `docs/brand/` holds source artwork that is not shipped. |

Root-level docs: **PRODUCT.md** (what it is for and who uses it), **DESIGN.md** (the
visual system — palette, type, motion), **SECURITY.md** (the 2026-07-23 review and
what was fixed).

## A note on `n8n/`

These exports are **snapshots, not the source of truth** — the live workflows are
edited in n8n and drift from what is committed here. Read them for orientation, but
pull the current version from n8n before changing anything. One snapshot per
workflow, under the workflow's own name; the `(2)`/`(3)` copies a browser download
leaves behind are gitignored.
