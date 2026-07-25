"""
Ingest a hitech-machinery.com blog category into Pinecone 'hitech-v2', namespace
'knowledge' (kept SEPARATE from the 'hitech' machine records so that article
prose can never compete with spec tables in a machine lookup).

Source is the WordPress REST API, not scraped HTML. Cleaning is pure regex --
there is NO LLM in this path, so nothing gets summarized away.

Any category can be ingested with --category <slug>. Each one keeps its OWN
manifest, because --prune drops every manifest entry missing from the category
it just fetched -- one shared manifest would make pruning either category delete
the other's records. Post ids are unique site-wide, so the KB_ record-id prefix
stays correct everywhere and two categories cannot collide.

Keys (env var, or gitignored file in rag/):
    PINECONE_API_KEY / .pinecone_key
    GEMINI_API_KEY   / .gemini_key

Examples:
  py -3 rag/add_kb_articles.py --limit 1 --dry-run     # inspect chunks, write nothing
  py -3 rag/add_kb_articles.py --all                   # Knowledge Base (the default)
  py -3 rag/add_kb_articles.py --all --category business-ideas
  py -3 rag/add_kb_articles.py --all --force           # re-ingest even if unchanged
  py -3 rag/add_kb_articles.py --all --prune           # also delete posts removed from the site
"""
import os
import re
import json
import html
import time
import argparse
import urllib.request

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))

SITE = "https://hitech-machinery.com"
CATEGORY_ID = 363          # "Knowledge Base" -- the default when --category is absent
CATALOGUE_LABEL = "Knowledge Base"
COMPANY = "HiTech Machinery"

EMBED_MODEL = "gemini-embedding-001"
TARGET_INDEX = "hitech-v2"
NAMESPACE = "knowledge"    # NOT 'hitech' -- isolation is the whole point

TARGET_WORDS = 350         # chunk size
OVERLAP_WORDS = 50
MAX_WORDS = 500            # hard ceiling before a section is force-split
EMBED_BATCH = 25
PER_PAGE = 20              # 50 makes the theme inject markup into the JSON body

# Posts that carry the category on the site but are not reference material. The
# bot must never cite these in a customer chat. Keyed by category slug; anything
# not listed ingests. (Fix the category in WordPress and they can come off.)
# Post ids are unique site-wide, so the KB_ id prefix stays correct for every
# category and no two categories can collide on a record id.
BLOCKED_BY_CATEGORY = {
    "knowledge-base": {
        "662": "Kashmir - Heaven On The Earth is in Lock-down",
        "6758": "UAE Visa Issues for Pakistanis",
        "6860": "International Labour Day",
    },
    "business-ideas": {
        # Environmental advocacy, not a manufacturing or buying guide. It is
        # ~450 words of prose about the Indus with no costs, no machine and no
        # process, so retrieving it can only crowd out a chunk that answers the
        # question. Delete this line to let it in.
        "6778": "Plastics Threaten Pakistan's Mighty Indus: A Call to Action",
    },
}
BLOCKED_POST_IDS = set(BLOCKED_BY_CATEGORY["knowledge-base"])

MANIFEST = os.path.join(HERE, "kb_manifest.json")


def _load_key(env_name, filename):
    v = os.environ.get(env_name)
    if not v:
        p = os.path.join(HERE, filename)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                v = f.read().strip()
    if not v:
        raise SystemExit(f"Missing {env_name} (env var, or put the key in rag/{filename})")
    return v


def _parse_json(b):
    """The Woodmart theme sometimes echoes a <link rel=stylesheet> tag around the
    JSON body on large pages, so slice to the actual payload before parsing."""
    s = b.decode("utf-8", "replace")
    if s.lstrip().startswith("["):
        return json.loads(s)
    i, j = s.find('[{"'), s.rfind("}]")
    if i == -1 or j == -1:
        raise ValueError("no JSON array found in response")
    return json.loads(s[i:j + 2])


def _get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return _parse_json(r.read())
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"    retry {i+1} after: {e}")
            time.sleep(2 * (i + 1))


def resolve_category(slug):
    """slug -> (id, display name). Fails loudly rather than silently ingesting
    the wrong category, which would be invisible until a rep got a bad answer."""
    cats = _get(f"{SITE}/wp-json/wp/v2/categories?slug={slug}&_fields=id,name,slug,count")
    if not cats:
        raise SystemExit(f"No category with slug {slug!r} on {SITE}")
    c = cats[0]
    print(f"category: id={c['id']} slug={c['slug']} name={c['name']} count={c['count']}")
    return c["id"], c["name"]


def fetch_posts(category_id=None):
    """All posts in the category, following pagination."""
    category_id = CATEGORY_ID if category_id is None else category_id
    posts, page = [], 1
    while True:
        url = (f"{SITE}/wp-json/wp/v2/posts?categories={category_id}"
               f"&per_page={PER_PAGE}&page={page}&_fields=id,title,link,modified,content")
        batch = _get(url)
        if not batch:
            break
        posts.extend(batch)
        if len(batch) < PER_PAGE:
            break
        page += 1
    return posts


def _tables_to_rows(s):
    """One table row per line: '| ABS | 3.0 - 4.0 | 400-500'.

    Done as a pre-pass on the raw HTML, because the source has newlines between
    <td>s -- if the generic rules ran first, every CELL would land on its own line
    and a material would no longer be visibly tied to its value.
    """
    def repl(m):
        t = re.sub(r"\s+", " ", m.group(0))        # collapse newlines inside the table
        t = re.sub(r"</tr\s*>", "\n", t, flags=re.I)
        t = re.sub(r"<t[hd][^>]*>", " | ", t, flags=re.I)
        t = re.sub(r"<[^>]+>", "", t)
        rows = [re.sub(r"\s+", " ", r).strip() for r in t.split("\n")]
        rows = [r for r in rows if r.strip(" |")]
        return "\n\n" + "\n".join(rows) + "\n\n"

    return re.sub(r"<table[\s\S]*?</table>", repl, s, flags=re.I)


def clean_html(raw):
    """WPBakery + HTML -> readable text. Deterministic; keeps tables and headings."""
    s = raw
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", s, flags=re.I | re.S)
    # page-builder shortcodes
    s = re.sub(r"\[/?vc_[^\]]*\]", "\n", s)
    s = re.sub(r"\[/?woodmart[^\]]*\]", "\n", s)
    # tables first, as whole blocks, so rows stay on one line
    s = _tables_to_rows(s)
    # any stray cells outside a <table>
    s = re.sub(r"<t[hd][^>]*>", " | ", s, flags=re.I)
    s = re.sub(r"</tr>", "\n", s, flags=re.I)
    # headings -> markers we can chunk on
    for lvl in (1, 2, 3, 4):
        s = re.sub(rf"<h{lvl}[^>]*>", f"\n\n{'#' * lvl} ", s, flags=re.I)
        s = re.sub(rf"</h{lvl}>", "\n", s, flags=re.I)
    s = re.sub(r"<li[^>]*>", "- ", s, flags=re.I)
    s = re.sub(r"</(p|div|li|ul|ol|table)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(html.unescape(s))       # WP double-encodes some entities
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n\s*\|\s*\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def split_sections(text):
    """[(heading, body)] split on markdown-ish heading markers produced by clean_html."""
    sections, heading, buf = [], "", []
    for line in text.split("\n"):
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            if buf:
                sections.append((heading, "\n".join(buf).strip()))
            heading, buf = m.group(2).strip(), []
        else:
            buf.append(line)
    if buf:
        sections.append((heading, "\n".join(buf).strip()))
    return [(h, b) for h, b in sections if b]


def _split_long(body):
    """Force-split an over-long section on paragraph boundaries, with overlap."""
    paras = [p for p in body.split("\n\n") if p.strip()]
    out, cur = [], []
    for p in paras:
        cur.append(p)
        if len(" ".join(cur).split()) >= TARGET_WORDS:
            out.append("\n\n".join(cur))
            tail = " ".join("\n\n".join(cur).split()[-OVERLAP_WORDS:])
            cur = [tail]
    if cur and len(" ".join(cur).split()) > OVERLAP_WORDS:
        out.append("\n\n".join(cur))
    return out or [body]


def chunk_post(title, text):
    """Pack sections into ~TARGET_WORDS chunks; every chunk keeps its breadcrumb."""
    chunks, cur_heads, cur_body = [], [], []

    def flush():
        if not cur_body:
            return
        body = "\n\n".join(cur_body).strip()
        if not body:
            return
        head = next((h for h in cur_heads if h), "")
        chunks.append((head, body))

    for heading, body in split_sections(text):
        if len(body.split()) > MAX_WORDS:
            flush()
            cur_heads, cur_body = [], []
            for piece in _split_long(body):
                chunks.append((heading, piece))
            continue
        if len(" ".join(cur_body + [body]).split()) > TARGET_WORDS and cur_body:
            flush()
            cur_heads, cur_body = [], []
        cur_heads.append(heading)
        cur_body.append(body)
    flush()

    out = []
    for head, body in chunks:
        crumb = f"Article: {title}"
        if head:
            crumb += f"\nSection: {head}"
        out.append(f"{crumb}\n\n{body}")
    return out


def embed_batch(texts, gemini_key):
    """Same call shape as extract_specs.py -- no taskType, same vector space."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={gemini_key}")
    body = json.dumps({"requests": [
        {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t}]}} for t in texts
    ]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return [e["values"] for e in json.loads(r.read())["embeddings"]]
        except Exception as e:
            if i == 3:
                raise
            print(f"    embed retry {i+1} after: {e}")
            time.sleep(2 * (i + 1))


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(m):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, help="only the first N posts")
    ap.add_argument("--dry-run", action="store_true", help="print chunks; write nothing")
    ap.add_argument("--force", action="store_true", help="re-ingest even if unchanged")
    ap.add_argument("--prune", action="store_true", help="delete chunks of posts removed from the site")
    ap.add_argument("--category", help="category slug, e.g. business-ideas. "
                                       "Omit for the Knowledge Base (the original behaviour).")
    args = ap.parse_args()

    if not (args.all or args.limit):
        print("Use --all (or --limit N). Add --dry-run to preview.")
        return

    global MANIFEST, CATALOGUE_LABEL
    if args.category:
        cat_id, CATALOGUE_LABEL = resolve_category(args.category)
        # A manifest PER CATEGORY. --prune deletes every manifest entry that is
        # not in the category it just fetched, so sharing one file would make
        # pruning either category wipe the other category's records.
        MANIFEST = os.path.join(HERE, f"{args.category}_manifest.json")
        blocked_ids = BLOCKED_BY_CATEGORY.get(args.category, {})
    else:
        cat_id = CATEGORY_ID
        blocked_ids = BLOCKED_BY_CATEGORY["knowledge-base"]

    print(f"fetching {CATALOGUE_LABEL} posts ...")
    posts = fetch_posts(cat_id)
    print(f"  {len(posts)} post(s) in category {cat_id}")
    print(f"  manifest: {os.path.basename(MANIFEST)}")
    if args.limit:
        posts = posts[:args.limit]

    manifest = load_manifest()
    index = None
    if not args.dry_run:
        index = Pinecone(api_key=_load_key("PINECONE_API_KEY", ".pinecone_key")).Index(TARGET_INDEX)
        gemini_key = _load_key("GEMINI_API_KEY", ".gemini_key")

    total_chunks = skipped = ingested = blocked = 0

    for i, p in enumerate(posts, 1):
        pid = str(p["id"])
        title = html.unescape(p["title"]["rendered"]).strip()
        modified = p["modified"]
        prev = manifest.get(pid)

        if pid in blocked_ids:
            blocked += 1
            # Printed on dry runs too, so a preview shows what is being left out
            # rather than silently omitting it.
            print(f"[{i}/{len(posts)}] BLOCKED  {title[:55]}  -- {blocked_ids[pid]}")
            # if it was indexed by an earlier run, take it back out
            if prev and not args.dry_run:
                n = prev.get("chunk_count", 0)
                index.delete(ids=[f"KB_{pid}_{k:02d}" for k in range(n)], namespace=NAMESPACE)
                del manifest[pid]
                save_manifest(manifest)
                print(f"          removed {n} previously indexed chunk(s)")
            continue

        if prev and prev.get("modified") == modified and not args.force and not args.dry_run:
            skipped += 1
            continue

        text = clean_html(p["content"]["rendered"])
        chunks = chunk_post(title, text)
        total_chunks += len(chunks)

        if args.dry_run:
            print(f"\n===== [{i}] {title}")
            print(f"      {p['link']}")
            print(f"      {len(text.split())} words -> {len(chunks)} chunk(s)")
            for n, c in enumerate(chunks):
                print(f"\n--- KB_{pid}_{n:02d}  ({len(c.split())} words) ---")
                print(c)
            continue

        records = []
        for n, c in enumerate(chunks):
            records.append({
                "id": f"KB_{pid}_{n:02d}",
                "text": c,
                "metadata": {
                    "catalogue": CATALOGUE_LABEL,
                    "company": COMPANY,
                    "model_name": title,
                    "source_url": p["link"],
                    "text": c,
                },
            })

        for j in range(0, len(records), EMBED_BATCH):
            sub = records[j:j + EMBED_BATCH]
            vals = embed_batch([r["text"] for r in sub], gemini_key)
            index.upsert(
                vectors=[{"id": r["id"], "values": v, "metadata": r["metadata"]}
                         for r, v in zip(sub, vals)],
                namespace=NAMESPACE,
            )

        # an edited post can shrink: drop chunks that no longer exist
        old_n = (prev or {}).get("chunk_count", 0)
        if old_n > len(chunks):
            stale = [f"KB_{pid}_{n:02d}" for n in range(len(chunks), old_n)]
            index.delete(ids=stale, namespace=NAMESPACE)
            print(f"      removed {len(stale)} stale chunk(s)")

        manifest[pid] = {"modified": modified, "chunk_count": len(chunks), "title": title}
        save_manifest(manifest)
        ingested += 1
        print(f"[{i}/{len(posts)}] {len(chunks):2d} chunk(s)  {title[:60]}")

    if args.prune and not args.dry_run:
        live = {str(p["id"]) for p in posts}
        gone = [pid for pid in manifest if pid not in live]
        for pid in gone:
            n = manifest[pid]["chunk_count"]
            index.delete(ids=[f"KB_{pid}_{k:02d}" for k in range(n)], namespace=NAMESPACE)
            print(f"pruned {n} chunk(s) of deleted post: {manifest[pid]['title'][:50]}")
            del manifest[pid]
        if gone:
            save_manifest(manifest)

    print(f"\nposts ingested: {ingested} | skipped (unchanged): {skipped} "
          f"| blocked: {blocked} | chunks: {total_chunks}")
    if args.dry_run:
        print("DRY RUN - nothing written.")


if __name__ == "__main__":
    main()
