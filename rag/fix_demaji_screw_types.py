"""
Replace the gearbox machine_type wrongly attached to 13 Demaji screw records.

Every record built from Demaji pages 9 and 10 carries:

    Machine type: Auxiliary gearbox, a special reducer for single screw rod
    extruders, widely used for top and middle grade plastic, rubber, and
    chemical fiber extruders.

Neither page sells a gearbox. Page 9 is titled "Screw for injection molding
machine" and page 10 "Screw & Barrel for single screw extruder". Page 9 does
carry a small decorative photo of a reducer inset in its materials box, which is
almost certainly what the vision pass described instead of the product.

The replacements below are taken from each page's own heading and material/spec
box, nothing else:

  p9  38CrMoAlA, nitriding HV>=900, nitriding depth 0.5-0.8mm; or special
      stainless steel, vacuum quenched.
  p10 spec Phi15-Phi360MM, L/D=12-45.

Only the "Machine type:" line is rewritten. Every other line, the model_name,
image_url and the id are left alone, and the script proves that by diffing each
record against its backup before it upserts. The record is re-embedded because
machine_type lives inside the embedded text.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_demaji_screw_types.py            # dry run
    & $py rag/fix_demaji_screw_types.py --go
"""
import os
import re
import sys
import json
import time
import argparse
import urllib.parse
import urllib.request

from pinecone import Pinecone

# Printing a bare Phi kills the whole run on a cp1252 console, which has already
# cost one 60-page backfill. Never let stdout decide whether a write happens.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
EMBED_MODEL = "gemini-embedding-001"
BACKUP = os.path.join(HERE, "backups", "demaji-screw-type-backup.json")

WRONG = "Auxiliary gearbox"

# page image basename -> the machine_type that page's heading actually supports
BY_PAGE = {
    "Demaji_and_HiTech_Machinery_page_9.jpg":
        "Screw and barrel set for injection moulding machines, in nitrided 38CrMoAlA "
        "with a surface hardness of HV>=900 (nitriding depth 0.5-0.8 mm) or in "
        "vacuum-quenched special stainless steel.",
    "Demaji_and_HiTech_Machinery_page_10.jpg":
        "Screw and barrel for single screw extruders, with screw diameters from "
        "\u03a615 to \u03a6360 mm and length-to-diameter ratios of L/D=12-45.",
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


def page_of(rec):
    return urllib.parse.unquote(rec["metadata"].get("image_url", "")).split("/")[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)

    updates = []
    for r in recs:
        page = page_of(r)
        want = BY_PAGE.get(page)
        if not want:
            continue
        text = r["metadata"].get("text", "")
        m = re.search(r"^Machine type:\s*(.+)$", text, re.M)
        if not m:
            print(f"  !! {r['id']}: no 'Machine type:' line, skipping")
            continue
        if not m.group(1).startswith(WRONG):
            print(f"  -- {r['metadata'].get('model_name')}: type is not the gearbox one, leaving it")
            continue
        new = re.sub(r"^Machine type:\s*.+$", "Machine type: " + want, text, count=1, flags=re.M)
        updates.append({"rec": r, "text": new, "type": want, "page": page})

    by_page = {}
    for u in updates:
        by_page.setdefault(u["page"], []).append(u)
    for page, us in sorted(by_page.items()):
        print(f"\n{page}  ({len(us)} records)")
        print(f"    - {WRONG} ...")
        print(f"    + {us[0]['type']}")
        for u in us:
            print(f"        {u['rec']['metadata'].get('model_name')}")

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

    # prove nothing but the Machine type line moves
    for u in updates:
        old_lines = u["rec"]["metadata"]["text"].split("\n")
        new_lines = u["text"].split("\n")
        assert len(old_lines) == len(new_lines), u["rec"]["id"]
        diff = [i for i, (a, b) in enumerate(zip(old_lines, new_lines)) if a != b]
        assert diff == [1], f"{u['rec']['id']}: unexpected diff at lines {diff}"
    print("diff check passed: exactly one line changed in every record")

    payload = []
    for u in updates:
        md = dict(u["rec"]["metadata"])
        md["text"] = u["text"]
        md["machine_type"] = u["type"]
        md["machine_type_source"] = "page-heading"
        payload.append((u["rec"]["id"], md))

    for i in range(0, len(payload), 50):
        chunk = payload[i:i + 50]
        vecs = embed_batch([md["text"] for _, md in chunk])
        index.upsert(namespace=NAMESPACE,
                     vectors=[{"id": rid, "values": v, "metadata": md}
                              for (rid, md), v in zip(chunk, vecs)])
        print(f"  upserted {i + len(chunk)}/{len(payload)}")

    time.sleep(4)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
