"""
Index the 11 Demaji injection screws the original ingest never saw.

The spec table on Demaji page 9 is laid out as TWO column-pairs side by side --
columns 1-3 hold the first half of the list, columns 4-6 continue it. The
original ingest read only the left half, so the catalogue effectively stopped at
700-1000 g. Everything from 800-1250 g up to 13000-25000 g -- the entire
large-machine range, Phi75x1825 through Phi170x3415 -- was absent from Pinecone.

All 12 left-half rows were verified byte-correct against the page before this was
written, so this script only adds; it never touches an existing record. The
right-half values below were read at 400 dpi.

The brochure prints 4000-10000 between 3000-6000 and 6000-8000, which is out of
order. That is what the page says, so that is what goes in.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/add_demaji_large_screws.py            # dry run
    & $py rag/add_demaji_large_screws.py --go
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

CATALOGUE = "Demaji Extruders & Mould Steel"
COMPANY = "Demaji"
IMAGE = ("https://oocmjiuymmvwvyvwlfpd.supabase.co/storage/v1/object/public/"
         "catalouge-images/Demaji_and_HiTech_Machinery/Demaji_and_HiTech_Machinery_page_9.jpg")
MACHINE_TYPE = ("Screw and barrel set for injection moulding machines, in nitrided 38CrMoAlA "
                "with a surface hardness of HV>=900 (nitriding depth 0.5-0.8 mm) or in "
                "vacuum-quenched special stainless steel.")

# (amount of injection g, screw dia x length, barrel dia x length) -- page 9, right half
ROWS = [
    ("800-1250", "75x1825", "170x1725"),
    ("1000-1500", "80x2000", "180x1805"),
    ("1250-2000", "85x2300", "190x1900"),
    ("2000-3000", "90x2700", "210x2000"),
    ("2500-5000", "100x2600", "230x2405"),
    ("3000-6000", "110x2600", "256x2590"),
    ("4000-10000", "120x2800", "256x2800"),
    ("6000-8000", "130x3010", "256x2970"),
    ("8000-10000", "145x3010", "256x3200"),
    ("10000-15000", "160x3500", "270x3200"),
    ("13000-25000", "170x3415", "317x3380"),
]

PHI = "\u03a6"


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


def build(amt, screw, barrel):
    model = f"Screw for Injection Molding Machine ({amt}g injection)"
    text = (f"Company: {COMPANY} | Catalogue: {CATALOGUE} | Model Name: {model}\n"
            f"Machine type: {MACHINE_TYPE}\n"
            f"Specifications:\n"
            f"Amount of injection: {amt} (g)\n"
            f"screw diameter x length: {PHI}{screw} (mm)\n"
            f"barrel diameter x length: {PHI}{barrel} (mm)")
    rid = f"Demaji_and_HiTech_Machinery_Screw_for_Injection_Molding_Machine_{amt}g_injection"
    return rid, {
        "catalogue": CATALOGUE, "company": COMPANY, "image_url": IMAGE,
        "machine_type": MACHINE_TYPE, "machine_type_source": "page-heading",
        "model_name": model, "text": text,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)

    new = [build(*row) for row in ROWS]

    # never overwrite: if an id already exists, something is wrong with my reading
    # of the page, not with the record that is already there.
    existing = index.fetch(ids=[rid for rid, _ in new], namespace=NAMESPACE).vectors
    if existing:
        print("!! these ids already exist, refusing to overwrite:")
        for rid in existing:
            print(f"     {rid}")
        return

    before = index.describe_index_stats().namespaces[NAMESPACE].vector_count
    print(f"namespace before: {before}\n")
    for rid, md in new:
        print(f"  + {md['model_name']}")
        for line in md["text"].split("Specifications:")[1].strip().split("\n"):
            print(f"        {line}")

    print(f"\nto add: {len(new)}")
    if not args.go:
        print("DRY RUN -- re-run with --go")
        return

    vecs = embed_batch([md["text"] for _, md in new])
    index.upsert(namespace=NAMESPACE,
                 vectors=[{"id": rid, "values": v, "metadata": md}
                          for (rid, md), v in zip(new, vecs)])
    time.sleep(5)
    after = index.describe_index_stats().namespaces[NAMESPACE].vector_count
    print(f"added {len(new)}   namespace {before} -> {after}  "
          f"({'ok' if after == before + len(new) else 'UNEXPECTED'})")


if __name__ == "__main__":
    main()
