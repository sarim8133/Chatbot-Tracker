"""
Rebuild the SCR High-efficiency Oil Remover line on Downstream Equipment p5.

Downstream p5 carries four tables: Heatless Absorption Dryer (WXF), Micro-thermal
Absorption Dryer (MXF), Water Separator (WS) and High-efficiency Oil Remover (OR).
The first three ingested cleanly -- 20, 20 and 19 records with full specs. The
fourth did not, in three compounding ways:

  NAMES  The letter O in "OR" was read as a zero, so SCR-1520OR was indexed as
         SCR-15200R (and, on a second pass, as SCR-1520R). A rep typing the real
         model name matched nothing.

  SPECS  14 of the 17 records carry no specifications at all. Their entire spec
         block is the literal string "(specs not found on page - needs manual
         review)" -- a marker the ingest wrote and nobody ever came back to.

  GHOSTS SCR-185OR, SCR-260OR and SCR-360OR do not exist on the page at all.
         Verified against the table at 300 dpi: it runs SCR-20OR to SCR-1520OR,
         19 rows, and ends there.

So the 17 existing records are replaced by the 19 rows the page actually prints,
read at 300 dpi. The three that did carry correct specs (SCR-1100R, SCR-1350R,
SCR-1520R) are superseded by correctly-named records holding the same numbers.

Deletion is the unusual step here, so it is listed explicitly in the dry run and
the removed records are backed up first.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/rebuild_oil_removers.py            # dry run
    & $py rag/rebuild_oil_removers.py --go
"""
import os
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
BACKUP = os.path.join(HERE, "backups", "oil-remover-backup.json")

CATALOGUE = "Downstream / Filters"
COMPANY = "SCR"
IMAGE = ("https://oocmjiuymmvwvyvwlfpd.supabase.co/storage/v1/object/public/"
         "catalouge-images/Downstream_Equipment/Downstream_Equipment_page_5.jpg")
MACHINE_TYPE = ("High-efficiency oil remover for compressed air, with a working pressure of "
                "0.7-1.0 MPa, an intake temperature of 0-50 \u2103 and an outlet gas oil "
                "content of \u22640.1-0.001 ppm")

# Downstream Equipment p5, "High-efficiency Oil Remover", read at 300 dpi
# model suffix, capacity m3/min, connector, H1 mm, H2 mm, L mm, weight kg
ROWS = [
    ("20", 2.6, 'Rc1"', 380, 920, 154, 30),
    ("30", 3.6, 'Rc1"', 405, 1050, 170, 40),
    ("70", 7.2, 'Rc1 1/2"', 465, 1246, 180, 45),
    ("85", 8.5, 'Rc2"', 545, 1350, 210, 75),
    ("100", 11, 'Rc2"', 580, 1420, 190, 86),
    ("130", 13.5, "DN65", 605, 1530, 190, 95),
    ("150", 15.2, "DN80", 650, 1480, 240, 130),
    ("180", 18.5, "DN100", 650, 1600, 240, 140),
    ("220", 22, "DN100", 650, 1640, 265, 160),
    ("300", 30, "DN100", 650, 1640, 265, 165),
    ("350", 35, "DN125", 650, 1710, 265, 170),
    ("450", 45, "DN125", 650, 1720, 290, 210),
    ("550", 55, "DN150", 740, 1780, 300, 230),
    ("650", 65, "DN150", 740, 1890, 315, 260),
    ("720", 72, "DN150", 835, 2000, 335, 310),
    ("850", 85, "DN150", 850, 2030, 360, 360),
    ("1100", 110, "DN200", 830, 2220, 380, 400),
    ("1350", 135, "DN200", 855, 2270, 430, 450),
    ("1520", 152, "DN250", 855, 2270, 430, 450),
]

# the corrupted records this replaces
DOOMED = [
    "SCR-15200R", "SCR-1850R", "SCR-3000R", "SCR-11000R", "SCR-2600R", "SCR-2200R",
    "SCR-13500R", "SCR-3600R", "SCR-4500R", "SCR-6500R", "SCR-8500R", "SCR-7200R",
    "SCR-5500R", "SCR-3500R", "SCR-1100R", "SCR-1350R", "SCR-1520R",
]


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


def build(suffix, cap, conn, h1, h2, L, wt):
    model = f"SCR-{suffix}OR"
    specs = (f"Capacity: {fmt(cap)} m\u00b3/min, Enter/Exit/Connector: {conn}, "
             f"Dimension H1: {h1} mm, Dimension H2: {h2} mm, Dimension L: {L} mm, "
             f"Weight: {wt} kg")
    text = (f"Company: {COMPANY} | Catalogue: {CATALOGUE} | Model Name: {model}\n"
            f"Machine type: {MACHINE_TYPE}\n"
            f"Specifications:\n{specs}")
    return f"Downstream_Equipment_{model}", {
        "catalogue": CATALOGUE, "company": COMPANY, "image_url": IMAGE,
        "machine_type": MACHINE_TYPE, "machine_type_source": "printed",
        "model_name": model, "text": text,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    new = [build(*r) for r in ROWS]
    doomed_ids = [f"Downstream_Equipment_{m}" for m in DOOMED]

    found = index.fetch(ids=doomed_ids, namespace=NAMESPACE).vectors
    before = index.describe_index_stats().namespaces[NAMESPACE].vector_count

    print(f"namespace before: {before}\n")
    print(f"--- REMOVE {len(found)} corrupted records ---")
    for rid in doomed_ids:
        v = found.get(rid)
        if not v:
            print(f"    (already gone) {rid}")
            continue
        t = (v.metadata or {}).get("text", "")
        state = "no specs" if "needs manual review" in t else "has specs"
        print(f"    {(v.metadata or {}).get('model_name'):<14} {state}")

    print(f"\n--- ADD {len(new)} records read off the page ---")
    for rid, md in new:
        print(f"    {md['model_name']:<12} "
              f"{md['text'].split('Specifications:')[1].strip()[:95]}")

    print(f"\nnet: {before} - {len(found)} + {len(new)} = {before - len(found) + len(new)}")
    if not args.go:
        print("DRY RUN -- re-run with --go")
        return

    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump([{"id": rid, "metadata": dict(v.metadata or {})}
                   for rid, v in found.items()], f, indent=1, ensure_ascii=False)
    print(f"backed up {len(found)} doomed records -> {BACKUP}")

    vecs = embed_batch([md["text"] for _, md in new])
    index.upsert(namespace=NAMESPACE,
                 vectors=[{"id": rid, "values": v, "metadata": md}
                          for (rid, md), v in zip(new, vecs)])
    print(f"upserted {len(new)}")

    # delete only after the replacements are safely in
    index.delete(ids=list(found.keys()), namespace=NAMESPACE)
    print(f"deleted {len(found)}")

    time.sleep(6)
    after = index.describe_index_stats().namespaces[NAMESPACE].vector_count
    expect = before - len(found) + len(new)
    print(f"namespace {before} -> {after}   expected {expect}  "
          f"({'ok' if after == expect else 'UNEXPECTED'})")


if __name__ == "__main__":
    main()
