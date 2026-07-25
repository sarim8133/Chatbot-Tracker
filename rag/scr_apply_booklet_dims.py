"""
Adopt the SCR booklet's dimensions on the dedicated APM / EPM records.

SCR published two documents describing the same compressors. Every figure agreed
except the overall dimensions -- SCR100APM-10 is 1800*1200*1550 in the booklet and
1800*1300*1550 in the APM catalogue -- and reading both source PDFs showed each had
been transcribed correctly. See scr-source-conflict.md.

Hi-Tech asked SCR. The BOOKLET is the current revision.

This does not re-ingest the booklet. Re-ingesting would reintroduce the 64
duplicate records that were removed and would still leave the 34 models the
booklet never mentions -- SCR4APM through SCR20APM and every T-D variant --
untouched. Instead the one disputed field is rewritten in place on the records
that are already live, from the booklet copies preserved in
backups/scr-dedupe-backup.json.

The 34 models with no booklet counterpart keep their catalogue dimensions. That is
not a decision, it is the absence of one: the booklet has nothing to say about
them, so there is nothing to adopt.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/scr_apply_booklet_dims.py            # dry run, full field diff
    & $py rag/scr_apply_booklet_dims.py --go
"""
import os
import re
import json
import time
import argparse
import urllib.request

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
EMBED_MODEL = "gemini-embedding-001"
BACKUP_SRC = os.path.join(HERE, "backups", "scr-dedupe-backup.json")
BACKUP_OUT = os.path.join(HERE, "backups", "scr-booklet-dims-backup.json")
CATALOGUES = ("SCR APM Screw Air Compressor", "SCR EPM / EPM2")


def _load_key(env, fname):
    v = os.environ.get(env)
    if not v:
        p = os.path.join(HERE, fname)
        if os.path.exists(p):
            v = open(p, encoding="utf-8").read().strip()
    if not v:
        raise SystemExit(f"Missing {env}")
    return v


PINECONE_KEY = _load_key("PINECONE_API_KEY", ".pinecone_key")
GEMINI_KEY = _load_key("GEMINI_API_KEY", ".gemini_key")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def fields(text):
    """Pull 'Label: value' pairs out of a spec block. The two catalogues disagree
    about layout -- APM puts everything on one comma-separated line, EPM uses one
    line per field -- so both separators end a value."""
    body = (text or "").split("Specifications:", 1)[-1]
    out = {}
    for m in re.finditer(r"([A-Za-z][^:,\n]*?):\s*([^,\n]+)", body):
        out[m.group(1).strip()] = m.group(2).strip()
    return out


def set_dimension(text, value):
    """Replace only the dimension value, leaving the layout exactly as it was."""
    return re.sub(r"(Dimension\s*\(mm\):\s*)([^,\n]+)", lambda m: m.group(1) + value, text, count=1)


def fetch_all(index):
    ids = []
    for page in index.list(namespace=NAMESPACE):
        ids += [it if isinstance(it, str) else it.id for it in page]
    out = []
    for i in range(0, len(ids), 100):
        got = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
        for vid, v in got.vectors.items():
            out.append({"id": vid, "metadata": dict(v.metadata or {})})
    return out


def embed_batch(texts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": t}]}} for t in texts]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return [e["values"] for e in json.loads(r.read())["embeddings"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    with open(BACKUP_SRC, encoding="utf-8") as f:
        book = {norm(r["metadata"].get("model_name")): r["metadata"]
                for r in json.load(f)["deleted"]}
    print(f"booklet records available: {len(book)}")

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = [r for r in fetch_all(index) if r["metadata"].get("catalogue") in CATALOGUES]
    print(f"  {len(recs)} dedicated APM/EPM records\n")

    updates, agreed, no_source, other_diffs = [], 0, [], {}
    for r in recs:
        src = book.get(norm(r["metadata"].get("model_name")))
        if not src:
            no_source.append(r["metadata"].get("model_name", ""))
            continue
        mine, theirs = fields(r["metadata"].get("text")), fields(src.get("text"))

        # Check EVERY field, not just the one we came for. If the booklet and the
        # catalogue disagree about weight or capacity too, that changes what this
        # script is and it must not be applied silently as a "dimension fix".
        for k, v in theirs.items():
            if k in mine and norm(mine[k]) != norm(v) and k != "Dimension (mm)":
                other_diffs.setdefault(k, []).append(
                    f"{r['metadata'].get('model_name')}: {mine[k]} -> {v}")

        want = theirs.get("Dimension (mm)")
        if not want:
            continue
        if norm(mine.get("Dimension (mm)", "")) == norm(want):
            agreed += 1
            continue
        updates.append({"rec": r, "dim": want, "was": mine.get("Dimension (mm)", "")})

    print(f"dimensions to change : {len(updates)}")
    print(f"already agreed       : {agreed}")
    print(f"no booklet counterpart (keep catalogue value): {len(no_source)}")
    if no_source:
        print(f"   {', '.join(sorted(set(no_source))[:12])}"
              f"{' ...' if len(set(no_source)) > 12 else ''}")

    if other_diffs:
        print("\n!! the booklet ALSO disagrees on these fields -- read before applying:")
        for k, v in other_diffs.items():
            print(f"   {k}: {len(v)} record(s)")
            for line in v[:4]:
                print(f"      {line}")
    else:
        print("\nevery other field agrees -- this really is a dimensions-only change")

    print("\nsample:")
    for u in updates[:8]:
        print(f"   {u['rec']['metadata'].get('model_name'):<20} {u['was']}  ->  {u['dim']}")

    if not args.go:
        print("\nDRY RUN -- re-run with --go")
        return
    if not updates:
        print("nothing to do")
        return

    with open(BACKUP_OUT, "w", encoding="utf-8") as f:
        json.dump([{"id": u["rec"]["id"], "metadata": u["rec"]["metadata"]} for u in updates],
                  f, indent=1, ensure_ascii=False)
    print(f"\nbacked up {len(updates)} -> {BACKUP_OUT}")

    for i in range(0, len(updates), 50):
        sub = updates[i:i + 50]
        payload = []
        for u in sub:
            md = dict(u["rec"]["metadata"])
            md["text"] = set_dimension(md.get("text", ""), u["dim"])
            md["dimension_source"] = "SCR booklet (current revision, confirmed with SCR)"
            payload.append((u["rec"]["id"], md))
        vecs = embed_batch([md["text"] for _, md in payload])
        index.upsert(namespace=NAMESPACE,
                     vectors=[{"id": rid, "values": v, "metadata": md}
                              for (rid, md), v in zip(payload, vecs)])
        print(f"  updated {min(i + 50, len(updates))}/{len(updates)}")

    time.sleep(5)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
