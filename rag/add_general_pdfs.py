"""
Ingest the PDFs in rag/General Knowledge/ into Pinecone 'hitech-v2',
namespace 'knowledge' -- the same namespace the website Knowledge Base articles
live in, which both live workflows reach through their "Search Articles" tool.

Cleaning is pure regex. There is NO LLM in this path, deliberately: summarizing
the source is exactly what made the machine specs lossy (see the note in
add_general_doc.py). Everything substantive survives; only extraction artifacts
and conversational scaffolding are removed.

WHY A CLEANER IS NEEDED AT ALL. These PDFs are Google-Docs exports of AI research
sessions, so the raw text carries three things that would poison retrieval:

  1. Layout damage -- doubled spaces everywhere, and paragraphs rendered one word
     per line ("business-opportunity\\n \\ndata\\n \\nand"). Left alone, chunking
     splits mid-sentence and the embeddings are garbage.
  2. Citation residue -- "HiTech Machinery +4", "KEBAKEBA", link anchors that got
     flattened into the prose and read as noise.
  3. Assistant scaffolding -- reasoning traces ("Investigating Huare, Jobo, and
     KEBA quality standards comprehensively"), and second-person conversation
     ("Good set of questions -- you're essentially trying to compare..."). If a
     rep asks about KEBA panels, the bot must not answer with the transcript of
     someone else asking about KEBA panels.

AFTER INGESTING, CHECK THE n8n TOOL DESCRIPTION. Both live workflows reach this
namespace through a "Search Articles" tool whose description ends: "This tool
does NOT contain machine models, prices, or spec sheets - for those you MUST use
the machinery catalogue tool instead." The compendium breaks that promise: it
carries the full UWA YH Gen 5 per-model table (shot weights, tie-bar spacing)
and published cost/ROI figures. Until the description is widened, the agent has
been told not to look here for exactly the data it would now find.

Keys (env var, or gitignored file in rag/):
    PINECONE_API_KEY / .pinecone_key
    GEMINI_API_KEY   / .gemini_key

Examples:
  py -3 rag/add_general_pdfs.py --dry-run            # print every chunk, write nothing
  py -3 rag/add_general_pdfs.py --dry-run --stats    # just the per-document summary
  py -3 rag/add_general_pdfs.py --all                # ingest new/changed documents
  py -3 rag/add_general_pdfs.py --all --force        # re-ingest even if unchanged
  py -3 rag/add_general_pdfs.py --prune              # drop chunks of deleted PDFs
"""
import os
import re
import json
import time
import hashlib
import argparse
import urllib.request

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "General Knowledge")

EMBED_MODEL = "gemini-embedding-001"
TARGET_INDEX = "hitech-v2"
NAMESPACE = "knowledge"          # same namespace as the website KB articles
CATALOGUE_LABEL = "Internal Research"   # distinguishes these from "Knowledge Base"
COMPANY = "HiTech Machinery"

TARGET_WORDS = 350               # same chunk shape as add_kb_articles.py
OVERLAP_WORDS = 50
MAX_WORDS = 500
EMBED_BATCH = 25

MANIFEST = os.path.join(HERE, "pdf_manifest.json")

# Per-document settings. `title` becomes model_name (what the bot shows as the
# source). `start_after` drops everything up to and including that string --
# used to cut assistant reasoning traces and research-log front matter, which
# are about the making of the document rather than its subject.
DOC_CONFIG = {
    "data file 1 @hitech.pdf": {
        "title": "HiTech Machinery — Complete Research Compendium",
        # Part I is a log of the research session itself ("Request 4 — Method:
        # web search"). Its findings are all restated in Parts II-VII, so
        # dropping it removes meta-noise without losing information.
        "start_after": "Research methods & limitations (applies to all parts)",
    },
    "keba and hitech benefits in pakistan.pdf": {
        "title": "Brand Comparison — Tederic, UWA, Huare, Jobo and KEBA Controls in Pakistan",
        # Page 1 is the assistant's own tool-call trace, duplicated line for line.
        "start_after": "Is the KEBA control panel good?",
        "prepend": "Is the KEBA control panel good?",
    },
    "tederic all models details.pdf": {
        "title": "Tederic Series Guide — NEO·T, NEO·M, NEO·H, NEO·E and specialised lines",
    },
}

# Site/brand names left behind when a hyperlink was flattened into the prose.
# They land AFTER a full stop, often several jammed together
# ("GoldsupplierHiTech Machinery"), which is what distinguishes them from the
# same words used legitimately mid-sentence. Removing them unconditionally would
# eat real content -- "HiTech Machinery was founded in ..." is a real sentence.
CITE_WORD = (
    r"HiTech Machinery|Hi Tech Machinery|HiTechMachinery|KEBA|"
    r"Manuals\+|Ipros|Goldsupplier|Jobomachinery|Yonghuasuji|"
    r"Facebook·Tederic Machinery Co\.,Ltd|Tederic Machinery Co\.,Ltd"
)
CITATION_RUN = re.compile(
    rf"(?<=[.!?:])\s*(?:(?:{CITE_WORD})\s*)+(?=$|\n|[A-Z0-9•])"
)

# A conversational aside is short. Anything longer is carrying content -- the
# brand-comparison table in the KEBA document is a single unpunctuated run that
# happens to contain "here's what each actually makes", and dropping it on that
# basis would delete the most useful paragraph in the file.
CHATTY_MAX_WORDS = 25

# Second-person conversational scaffolding. Matched per SENTENCE, not per line:
# layout repair reflows these into the middle of a paragraph, where a
# line-anchored pattern never sees them. A retrieved chunk that offers to go and
# fetch something ("tell me and I'll pull its details") is worse than useless --
# the bot cannot act on it, but it will happily repeat the offer to a rep.
CHATTY_SENTENCE = re.compile(
    r"\b("
    r"good (set of )?questions?"
    r"|you'?ve got|you listed|you'?re essentially|you wrote"
    r"|let me (research|start|know)|more on that below"
    r"|one thing to double-check|tell me and i'?ll|i'?ll pull its details"
    r"|here'?s what each actually makes|here'?s why it has that reputation"
    r"|so you don'?t pick|i'?ll (check|pull)|last one"
    r"|the key clarification"
    r")\b",
    re.I,
)
# Assistant reasoning traces: short, verb-first, emitted twice in a row.
CHATTY_LINE = re.compile(
    r"^(clarifying|investigating|compiling|distinguishing|synthesi[sz]ed|"
    r"researching|now (huare|jobo|i)|searching)\b",
    re.I,
)


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


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")[:60]


def extract_pdf(path):
    from pypdf import PdfReader
    reader = PdfReader(path)
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def repair_layout(s):
    """Undo the Google-Docs export damage: one-word-per-line runs and padding.

    The export writes a line containing nothing but a space between words of the
    SAME sentence, so a blank-ish line cannot be treated as a paragraph break.
    Everything is reflowed to a single stream and structure is re-derived from
    heading patterns in split_sections().
    """
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)          # doubled spaces from justified layout
    s = re.sub(r"\s*\n\s*", "\n", s)       # strip padding around every newline
    s = re.sub(r"\n{2,}", "\n", s)         # a "blank" line here is not a paragraph
    # Rejoin a line that clearly continues the previous one: previous line does
    # not end a sentence and the next does not start a new structural block.
    out = []
    for line in s.split("\n"):
        line = line.strip()
        if not line:
            continue
        if out and not re.search(r"[.:;!?•)\]]$", out[-1]) \
                and not re.match(r"^([•\-\d]|#{1,4}\s|PART\b|Part\b)", line) \
                and not re.match(r"^[A-Z][A-Z \-&]{6,}$", out[-1]):
            out[-1] = out[-1] + " " + line
        else:
            out.append(line)
    return "\n".join(out)


def _drop_chatty_sentences(line):
    """Remove conversational sentences while keeping the rest of the line.

    Split on sentence ends rather than dropping the whole line: these documents
    interleave one chatty sentence with three substantive ones, so line-level
    removal would throw away real content.
    """
    parts = re.split(r"(?<=[.!?:])\s+", line)
    kept = [p for p in parts
            if p.strip()
            and not (CHATTY_SENTENCE.search(p) and len(p.split()) <= CHATTY_MAX_WORDS)]
    return " ".join(kept)


def strip_artifacts(s):
    """Remove citation residue, duplicated anchors and assistant scaffolding."""
    s = re.sub(r"\s+\+\s?\d{1,2}\b", " ", s)      # " +4" citation counters
    s = re.sub(r"\b(\w[\w ]{2,28}?)\1\b", r"\1", s)   # doubled anchor, "KEBAKEBA"
    s = CITATION_RUN.sub(" ", s)

    lines, seen_prev = [], None
    for line in s.split("\n"):
        t = line.strip()
        if not t or t == seen_prev:   # reasoning traces are emitted twice in a row
            continue
        seen_prev = t
        if CHATTY_LINE.match(t):
            continue
        t = _drop_chatty_sentences(t)
        if t.strip():
            lines.append(t.strip())
    s = "\n".join(lines)

    # Put every bullet back on its own line. Removing a citation from between a
    # sentence and the next bullet merges them, and _split_long() chunks on line
    # boundaries — so a merged run of ten bullets can no longer be split.
    s = re.sub(r"(?<!\n)\s*•\s*", "\n• ", s)
    s = re.sub(r"\s+([,.;:])", r"\1", s)          # "HSP , HTS" -> "HSP, HTS"
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def split_sections(text):
    """[(heading, body)] using the numbered/ALL-CAPS headings these docs use."""
    head_re = re.compile(
        r"^("
        r"PART\s+[IVX]+\s*[—-].*"                    # PART IV — Master Knowledge Base
        r"|\d+(?:\.\d+)*\s+[A-Z].{3,90}"             # 2.1 Injection Molding Machine
        r"|[A-Z][A-Z0-9 &/,\-']{8,70}"               # TABLE OF CONTENTS
        r"|(?:Request|Section|Chapter)\s+\d+\s*[—-].*"
        r")$"
    )
    sections, heading, buf = [], "", []
    for line in text.split("\n"):
        if head_re.match(line.strip()) and len(line.split()) <= 14:
            if buf:
                sections.append((heading, "\n".join(buf).strip()))
            heading, buf = line.strip(), []
        else:
            buf.append(line)
    if buf:
        sections.append((heading, "\n".join(buf).strip()))
    return [(h, b) for h, b in sections if b]


def _split_long(body):
    """Force-split an over-long section on line boundaries, with overlap."""
    paras = [p for p in body.split("\n") if p.strip()]
    out, cur = [], []
    for p in paras:
        cur.append(p)
        if len(" ".join(cur).split()) >= TARGET_WORDS:
            out.append("\n".join(cur))
            tail = " ".join("\n".join(cur).split()[-OVERLAP_WORDS:])
            cur = [tail]
    if cur and len(" ".join(cur).split()) > OVERLAP_WORDS:
        out.append("\n".join(cur))
    return out or [body]


def chunk_doc(title, text):
    """Pack sections into ~TARGET_WORDS chunks; every chunk keeps its breadcrumb."""
    chunks, cur_heads, cur_body = [], [], []

    def flush():
        if not cur_body:
            return
        body = "\n".join(cur_body).strip()
        if body:
            chunks.append((next((h for h in cur_heads if h), ""), body))

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
        crumb = f"Document: {title}"
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
    for i in range(4):
        try:
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"})
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


def prepare(path, cfg):
    """PDF -> cleaned text, honouring the per-document start_after cut."""
    raw = extract_pdf(path)
    text = strip_artifacts(repair_layout(raw))
    marker = cfg.get("start_after")
    if marker:
        i = text.find(marker)
        if i == -1:
            raise SystemExit(
                f"start_after marker not found in {os.path.basename(path)!r}: {marker!r}\n"
                "The document changed -- re-check the cut before ingesting.")
        text = text[i + len(marker):].lstrip("\n :.-")
        if cfg.get("prepend"):
            text = cfg["prepend"] + "\n" + text
    return raw, text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="ingest new/changed documents")
    ap.add_argument("--dry-run", action="store_true", help="print chunks; write nothing")
    ap.add_argument("--stats", action="store_true", help="with --dry-run: summary only")
    ap.add_argument("--force", action="store_true", help="re-ingest even if unchanged")
    ap.add_argument("--prune", action="store_true", help="delete chunks of removed PDFs")
    ap.add_argument("--only", help="substring match on one filename")
    args = ap.parse_args()

    if not (args.all or args.dry_run or args.prune):
        print("Use --all to ingest, or --dry-run to preview.")
        return

    pdfs = sorted(f for f in os.listdir(SRC_DIR) if f.lower().endswith(".pdf"))
    if args.only:
        pdfs = [f for f in pdfs if args.only.lower() in f.lower()]
    if not pdfs:
        raise SystemExit(f"No PDFs found in {SRC_DIR}")

    unknown = [f for f in pdfs if f not in DOC_CONFIG]
    if unknown:
        raise SystemExit(
            "These PDFs have no entry in DOC_CONFIG:\n  " + "\n  ".join(unknown) +
            "\nAdd a title (and a start_after if the file opens with assistant "
            "chatter) before ingesting -- an untitled document is unattributable "
            "in a reply.")

    manifest = load_manifest()
    index = gemini_key = None
    if not args.dry_run:
        index = Pinecone(api_key=_load_key("PINECONE_API_KEY", ".pinecone_key")).Index(TARGET_INDEX)
        gemini_key = _load_key("GEMINI_API_KEY", ".gemini_key")

    total = ingested = skipped = 0

    for i, fname in enumerate(pdfs, 1):
        cfg = DOC_CONFIG[fname]
        path = os.path.join(SRC_DIR, fname)
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:16]

        prev = manifest.get(fname)
        if prev and prev.get("sha256") == digest and not args.force and not args.dry_run:
            skipped += 1
            print(f"[{i}/{len(pdfs)}] unchanged, skipped  {fname}")
            continue

        title = cfg["title"]
        raw, text = prepare(path, cfg)
        chunks = chunk_doc(title, text)
        total += len(chunks)
        doc_id = slug(fname)

        if args.dry_run:
            kept = len(text.split())
            drop = len(raw.split()) - kept
            print(f"\n===== [{i}] {fname}")
            print(f"      title : {title}")
            print(f"      words : {len(raw.split())} raw -> {kept} kept "
                  f"({drop} removed as artifacts/scaffolding)")
            print(f"      chunks: {len(chunks)}")
            if not args.stats:
                for n, c in enumerate(chunks):
                    print(f"\n--- PDF_{doc_id}_{n:03d}  ({len(c.split())} words) ---")
                    print(c)
            continue

        records = [{
            "id": f"PDF_{doc_id}_{n:03d}",
            "text": c,
            "metadata": {
                "catalogue": CATALOGUE_LABEL,
                "company": COMPANY,
                "model_name": title,
                # Not a URL: these are internal documents with no public page.
                # The reply renderer only linkifies http(s), so this shows as
                # plain text instead of a link that goes nowhere.
                "source_url": f"Internal document — {fname}",
                "text": c,
            },
        } for n, c in enumerate(chunks)]

        for j in range(0, len(records), EMBED_BATCH):
            sub = records[j:j + EMBED_BATCH]
            vals = embed_batch([r["text"] for r in sub], gemini_key)
            index.upsert(
                vectors=[{"id": r["id"], "values": v, "metadata": r["metadata"]}
                         for r, v in zip(sub, vals)],
                namespace=NAMESPACE,
            )
            print(f"      upserted {j + len(sub)}/{len(records)}")

        # a re-edited document can shrink: drop chunks that no longer exist
        old_n = (prev or {}).get("chunk_count", 0)
        if old_n > len(chunks):
            stale = [f"PDF_{doc_id}_{n:03d}" for n in range(len(chunks), old_n)]
            index.delete(ids=stale, namespace=NAMESPACE)
            print(f"      removed {len(stale)} stale chunk(s)")

        manifest[fname] = {"sha256": digest, "chunk_count": len(chunks), "title": title}
        save_manifest(manifest)
        ingested += 1
        print(f"[{i}/{len(pdfs)}] {len(chunks):3d} chunk(s)  {fname}")

    if args.prune and not args.dry_run:
        live = set(pdfs)
        for fname in [f for f in manifest if f not in live]:
            n = manifest[fname]["chunk_count"]
            index.delete(ids=[f"PDF_{slug(fname)}_{k:03d}" for k in range(n)],
                         namespace=NAMESPACE)
            print(f"pruned {n} chunk(s) of removed document: {fname}")
            del manifest[fname]
        save_manifest(manifest)

    print(f"\ndocuments ingested: {ingested} | skipped (unchanged): {skipped} "
          f"| chunks: {total}")
    if args.dry_run:
        print("DRY RUN — nothing written.")


if __name__ == "__main__":
    main()
