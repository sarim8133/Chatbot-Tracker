# Design: Ingest website Knowledge Base articles into hitech-v2

Date: 2026-07-12
Status: approved

## Problem

hitech-machinery.com has a Knowledge Base blog (61 posts) of technical explainers —
clamping force, hydraulic vs electric, machine parts, materials. None of it is in the
RAG index, so the chatbot cannot answer conceptual questions from company-authored
content. It either answers from Gemini's training data (which produced a hallucinated
"L/D 25:1" on 2026-07-11) or fails.

## Constraints discovered

- Articles are 1,200–1,700 words → ~1,600–2,300 tokens. `gemini-embedding-001` accepts
  2,048 input tokens, so **one record per article is not viable**. Chunking is mandatory.
- Content is WordPress + WPBakery: `[vc_row]`, `[vc_column_text]`, inline CSS wrapped
  around clean prose and comparison tables.
- Text is clean UTF-8 (U+2019 etc., no replacement chars). Verified, not assumed.
- The existing `hitech` namespace holds 1,888 machine records and is in production.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Knowledge Base only (cat 363, 61 posts) | User's call. Business Ideas / Success Stories / News excluded. |
| Source | WordPress REST API `?categories=363` | Structured, no scraping, gives `modified` for idempotency. |
| Extraction | Deterministic regex, **no LLM** | Summarization is what made the machine specs lossy. Validated: 0 leftover markup. |
| Retrieval | **Separate namespace `knowledge` + 2nd n8n tool** | Guarantees the 1,888-record spec lookup cannot regress. 430 blog chunks would otherwise compete with spec tables in every search. |
| Citation | Article link, no image | Hero images are decorative stock; would look inconsistent next to real spec sheets. |

## Pipeline (`rag/add_kb_articles.py`)

1. **Fetch** — WP REST, paginated, fields `id,title,link,modified,content`.
2. **Clean** — strip `vc_*`/`woodmart` shortcodes; `<h1..h4>` → `##` markers; table cells →
   pipe-delimited rows (comparison tables must survive); `<li>` → `- `; double-unescape
   HTML entities; collapse whitespace.
3. **Chunk** — split on heading boundaries, pack to ~350 words, overflow splits on paragraph
   breaks with ~50-word overlap. Each chunk prefixed:
   `Article: <title>\nSection: <heading>\n\n<text>` so an isolated chunk keeps its context.
4. **Embed** — `gemini-embedding-001`, `batchEmbedContents`, **no `taskType`** (must match
   `extract_specs.py` or the vectors land in a different space).
5. **Upsert** — index `hitech-v2`, namespace `knowledge`.

### Record shape

```
id:       KB_{post_id}_{chunk_index}     e.g. KB_1482_03
metadata:
  catalogue  = "Knowledge Base"
  company    = "HiTech Machinery"
  model_name = <article title>
  source_url = <post permalink>
  text       = <breadcrumbed chunk>
  (no image_url)
```

### Idempotency

`rag/kb_manifest.json` stores `post_id -> {modified, chunk_count, title}`.
- Unchanged `modified` → skip (unless `--force`).
- Edited post yielding fewer chunks → delete orphaned `KB_{id}_{n}` for n >= new count.
- `--prune` → delete all chunks for posts no longer returned by the API.

## n8n changes (applied manually in the UI)

- Duplicate `Search Pinecone` → `Search Knowledge Base`, namespace `knowledge`, exposed as
  `search_articles`.
- Agent prompt: concepts/how-to/comparisons → `search_articles`; **specs and model numbers
  still come only from the catalogue tool**; cite `source_url` when answering from an article.

## Verification

- `--dry-run` prints chunks for a single post before anything is written.
- After upsert: query ~6 realistic questions against `knowledge`, assert the correct article
  ranks first.
- Assert `hitech` namespace count is still exactly **1,888** — the proof of no regression.

## Known risk (accepted)

The 61 articles are SEO marketing prose, not vetted engineering reference. If an article is
sloppy, the bot will now repeat it confidently *with a citation*. The namespace split confines
this to concept questions and keeps it away from spec answers, but it does not make the
content correct. Spot-checking article quality is a content problem, not a pipeline problem.
