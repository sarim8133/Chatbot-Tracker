"""
Rebuild the HHD-*E hopper-dryer spec blocks from Huare page 10, read at 300 dpi.

The original ingest lost a row in the TOP table (HHD-12E .. HHD-150E) and slid
everything below it up one label, so from H downward every dimension on those six
records names the wrong measurement. HHD-100E is the plainest case:

    live  H 1250   D 560   W 180
    page  H 1425   D 685   W 1010

A rep sizing floor space was being told a 1010 mm wide dryer is 180 mm wide.

The BOTTOM table (HHD-200E .. HHD-1000E) was spot-checked and looked right, but
"looked right" is how the HDL weights survived, so this script rewrites all
twelve from the same transcription and reports which fields actually moved. Six
should come out untouched; if they do not, that is a finding, not a bug here.

The label is also normalised from the PDF's "¢ d1" glyph to "Φ d1". The cent sign
is genuinely what the source font renders, so the ingest copied it faithfully --
but it reaches the customer as "cents" and it is a diameter.

Only the Specifications block is rebuilt. The Company/Catalogue/Model Name line
and the Machine type line are carried over byte-for-byte, and the script asserts
that before it upserts. Records are re-embedded because the specs are inside the
embedded text.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_hhd_dimensions.py            # dry run
    & $py rag/fix_hhd_dimensions.py --go
"""
import os
import re
import sys
import json
import time
import argparse
import urllib.request

from pinecone import Pinecone

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
EMBED_MODEL = "gemini-embedding-001"
BACKUP = os.path.join(HERE, "backups", "hhd-dimension-backup.json")

# field label -> unit, in the order the brochure prints them
ROWS = [
    ("Loading capacity", "kg"), ("Heating power", "kW"), ("Blower power", "kW"),
    ("Weight", "kg"), ("H", "mm"), ("H1", "mm"), ("H2", "mm"), ("H3", "mm"),
    ("H4", "mm"), ("H5", "mm"), ("D", "mm"), ("\u03a6 d1", "mm"), ("\u03a6 d2", "mm"),
    ("W", "mm"), ("W1", "mm"), ("W2", "mm"),
]

# Huare page 10 (book p18), both tables, transcribed at 300 dpi
PAGE = {
    #             cap   heat  blow  wt    H     H1    H2    H3   H4   H5   D     d1    d2   W     W1   W2
    "HHD-12E":   [12,   2.1,  0.14, 20,   820,  810,  380,  325, 145, 110, 470,  300,  42,  700,  110, 110],
    "HHD-25E":   [25,   2.7,  0.14, 32,   990,  945,  465,  415, 190, 160, 490,  350,  61,  745,  150, 150],
    "HHD-50E":   [50,   3.9,  0.17, 43,   1165, 1075, 530,  480, 195, 160, 545,  435,  74,  865,  160, 160],
    "HHD-75E":   [75,   5,    0.17, 48,   1250, 1140, 620,  475, 200, 160, 610,  495,  74,  920,  160, 160],
    "HHD-100E":  [100,  6.4,  0.18, 75,   1425, 1220, 735,  535, 230, 175, 685,  560,  81,  1010, 180, 180],
    "HHD-150E":  [150,  7.8,  0.18, 82,   1470, 1220, 780,  530, 230, 175, 730,  600,  81,  1060, 180, 180],
    "HHD-200E":  [200,  10,   0.36, 120,  1685, 1415, 840,  605, 205, 200, 860,  700,  115, 1200, 230, 230],
    "HHD-300E":  [300,  15,   0.38, 150,  1855, 1560, 935,  685, 215, 210, 935,  760,  120, 1305, 280, 280],
    "HHD-400E":  [400,  20,   0.38, 215,  1995, 1630, 1035, 710, 205, 210, 1015, 835,  120, 1410, 320, 320],
    "HHD-600E":  [600,  27,   0.38, 295,  2290, 1705, 1270, 765, 120, 255, 1180, 995,  135, 1580, 320, 320],
    "HHD-800E":  [800,  32,   0.38, 320,  2665, 1705, 1650, 765, 120, 255, 1180, 995,  135, 1580, 320, 320],
    "HHD-1000E": [1000, 32,   0.38, 410,  2830, 1750, 1650, 930, 155, 270, 1310, 1095, 135, 1655, 320, 320],
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
        # Pinecone drops a connection now and then; a read failure must not be
        # able to decide whether the write half of this script runs.
        for attempt in range(5):
            try:
                got = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
                break
            except Exception as e:
                if attempt == 4:
                    raise
                print(f"  fetch retry {attempt + 1}/4 at offset {i}: {type(e).__name__}")
                time.sleep(2 * (attempt + 1))
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


def fmt(v):
    return str(int(v)) if float(v) == int(v) else str(v)


def live_fields(text):
    """label -> value, as the record currently states them."""
    out = {}
    for line in text.split("Specifications:", 1)[-1].strip().split("\n"):
        m = re.match(r"^(.*?):\s*([\d.]+)\s*\S*$", line.strip())
        if m:
            out[m.group(1).replace("\u00a2", "\u03a6").strip()] = m.group(2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)

    updates, clean = [], []
    for r in recs:
        model = (r["metadata"].get("model_name") or "").strip()
        vals = PAGE.get(model)
        if vals is None:
            continue
        text = r["metadata"].get("text", "")
        head, _, _ = text.partition("Specifications:")
        specs = "\n".join(f"{label}: {fmt(v)} {unit}"
                          for (label, unit), v in zip(ROWS, vals))
        new = head + "Specifications:\n" + specs

        old = live_fields(text)
        moved = []
        for (label, _unit), v in zip(ROWS, vals):
            key = label.replace("\u03a6 ", "\u03a6 ").strip()
            cur = old.get(key, old.get(label.replace("\u03a6 ", ""), None))
            if cur is None:
                moved.append(f"{label}: (absent) -> {fmt(v)}")
            elif float(cur) != float(v):
                moved.append(f"{label}: {cur} -> {fmt(v)}")
        if new == text:
            clean.append(model)
            continue
        updates.append({"rec": r, "text": new, "model": model, "moved": moved, "head": head})

    for u in sorted(updates, key=lambda x: list(PAGE).index(x["model"])):
        print(f"\n{u['model']}   {len(u['moved'])} field(s) wrong")
        for m in u["moved"]:
            print(f"    {m}")
    if clean:
        print(f"\nalready byte-correct: {', '.join(clean)}")

    print(f"\nto update: {len(updates)} of {len(PAGE)}")
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

    # the header (company/catalogue/model + machine type) must survive untouched
    for u in updates:
        assert u["text"].startswith(u["head"]), u["model"]
        assert u["rec"]["metadata"]["text"].startswith(u["head"]), u["model"]
    print("header check passed: only the Specifications block was rebuilt")

    payload = []
    for u in updates:
        md = dict(u["rec"]["metadata"])
        md["text"] = u["text"]
        md["dimension_source"] = "Huare p10 @300dpi"
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
