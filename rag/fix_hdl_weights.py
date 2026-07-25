"""
Correct five HDL weights misread by the original Huare ingest.

Sarim supplied HDL.pdf, a single page pulled from the Huare catalogue (its own
pages 13-14, the HDL dehumidifying/drying/loading combination). All nine models on
it were already indexed, so there was nothing to add -- but diffing the page
against the live records, field by field, found five wrong weights. Everything
else agrees: 103 of 108 values matched, and the five that did not are all in the
Weight row, which is what a single misread row in a dense table looks like.

Verified at 300 dpi before writing anything, because the first read was at 160.

    kg   270  300  320  500  540  690  970  1210  1350

Only the Weight line changes. machine_type, every other spec, the image_url and
the id are left exactly as they are, and the record is re-embedded because the
weight sits inside the embedded text.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_hdl_weights.py            # dry run
    & $py rag/fix_hdl_weights.py --go
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
BACKUP = os.path.join(HERE, "backups", "hdl-weight-backup.json")

# model -> correct weight in kg, read off HDL.pdf at 300 dpi
CORRECT = {
    "HDL-120U-80F": 300,
    "HDL-450U-300F": 540,
    "HDL-600U-400F": 690,
    "HDL-900U-600F": 970,
    "HDL-1200U-800F": 1210,
}


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

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)

    updates = []
    for r in recs:
        model = (r["metadata"].get("model_name") or "").strip()
        want = CORRECT.get(model)
        if want is None:
            continue
        text = r["metadata"].get("text", "")
        m = re.search(r"^Weight:\s*([\d.]+)\s*kg\s*$", text, re.M)
        if not m:
            print(f"  !! {model}: no 'Weight: N kg' line, skipping")
            continue
        if float(m.group(1)) == want:
            print(f"  {model}: already {want} kg")
            continue
        new = re.sub(r"^Weight:\s*[\d.]+\s*kg\s*$", f"Weight: {want} kg", text, count=1, flags=re.M)
        updates.append({"rec": r, "text": new, "was": m.group(1), "now": want, "model": model})

    for u in updates:
        print(f"  {u['model']:<17} Weight {u['was']} -> {u['now']} kg")
    print(f"\nto update: {len(updates)}")
    if not args.go:
        print("DRY RUN -- re-run with --go")
        return
    if not updates:
        return

    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump([{"id": u["rec"]["id"], "metadata": u["rec"]["metadata"]} for u in updates],
                  f, indent=1, ensure_ascii=False)
    print(f"backed up -> {BACKUP}")

    payload = []
    for u in updates:
        md = dict(u["rec"]["metadata"])
        md["text"] = u["text"]
        payload.append((u["rec"]["id"], md))
    vecs = embed_batch([md["text"] for _, md in payload])
    index.upsert(namespace=NAMESPACE,
                 vectors=[{"id": rid, "values": v, "metadata": md}
                          for (rid, md), v in zip(payload, vecs)])
    print(f"updated {len(payload)}")
    time.sleep(4)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
