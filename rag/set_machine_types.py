"""
Apply authoritative machine_type values supplied by Hi-Tech.

These override whatever the vision pass derived. The brochures state the process
thinly or not at all -- NEO-T90's page yielded only "Hydraulic injection moulding
machine" -- while the person selling them knows the series-level truth. Sarim
gave these directly, so they outrank anything read off a page.

machine_type is part of the EMBEDDED text, not just metadata, so changing it
means re-embedding the record. That is the whole reason it helps retrieval: a
query about a rotary turntable has to be able to match the vector, not merely
filter on a field nobody queries.

Usage:
    & $py rag/set_machine_types.py            # dry run, prints what would change
    & $py rag/set_machine_types.py --go
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
BACKUP = os.path.join(HERE, "backups", "machine_type-override-backup.json")


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

# Catalogue -> correct OEM. FUDL was registered against HiTech Machinery, but
# HiTech resells it; the company field names the manufacturer everywhere else in
# the namespace, so this one was inconsistent as well as wrong.
COMPANY_FIX = {"FUDL": "FUDL"}

NEO_T = "Toggle-system servo-hydraulic plastic injection moulding machine"
NEO_MS = ("Multi-component plastic injection moulding machine (IMM) with a horizontal "
          "rotary turntable and opposite injection units")
NEO_MV = ("Multi-component plastic injection moulding machine (IMM) with a vertical "
          "rotary turntable")
YHE = ("Hybrid plastic injection moulding machine combining electric precision with "
       "hydraulic power")


def clean_name(model):
    """Tederic's text layer leaks control characters into model designations --
    one record is literally "NEO\\bMv", with a backspace where the hyphen belongs.
    Nobody will ever type that, and it hides the record from every name rule."""
    s = re.sub(r"[\x00-\x1f\x7f]+", "-", model or "")
    return re.sub(r"-{2,}", "-", s).strip(" -")


def classify(cat, model):
    """Return the authoritative type, or None to leave the record alone."""
    m = clean_name(model)
    # A series-level record like "NEO-Mv" carries the orientation with no size.
    if cat == "NEO-M":
        bare = re.match(r"^NEO[\s\-·]*M\s*([sv])$", m, re.I)
        if bare:
            return NEO_MS if bare.group(1).lower() == "s" else NEO_MV
    if cat.startswith("NEO-T"):
        return NEO_T
    if cat == "YHE Gen 5":
        return YHE
    if cat == "NEO-M":
        # NEO-M1120s vs NEO-M1920v: the letter after the size is the turntable
        # orientation, and it is the only thing separating the two machines.
        hit = re.search(r"NEO[\s\-·]*M\s*\d+\s*([sv])\b", m, re.I)
        if hit:
            return NEO_MS if hit.group(1).lower() == "s" else NEO_MV
        return None          # bare injection units (m1100, m2500) are not machines
    return None


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


def rewrite_text(text, new_type=None, new_company=None):
    """Patch the embedded text in place. Both fields live inside what was
    embedded, so a metadata-only edit would leave the vector saying the old
    thing -- the record would still retrieve on 'HiTech FUDL'."""
    lines = (text or "").split("\n")
    if new_company and lines:
        lines[0] = re.sub(r"^Company:\s*[^|]*", f"Company: {new_company} ", lines[0])
    if new_type:
        for i, ln in enumerate(lines):
            if ln.startswith("Machine type:"):
                lines[i] = f"Machine type: {new_type}"
                break
        else:
            if lines:
                lines.insert(1, f"Machine type: {new_type}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)
    print(f"  {len(recs)} records")

    targets, skipped = {}, []

    # 1. company corrections
    for r in recs:
        cat = r["metadata"].get("catalogue", "") or ""
        want = COMPANY_FIX.get(cat)
        if want and r["metadata"].get("company") != want:
            targets[r["id"]] = {"rec": r, "type": None, "company": want}

    # 2. series machine_type corrections
    for r in recs:
        cat = r["metadata"].get("catalogue", "") or ""
        model = r["metadata"].get("model_name", "") or ""
        if not (cat.startswith("NEO-T") or cat in ("NEO-M", "YHE Gen 5")):
            continue
        new = classify(cat, model)
        if new is None:
            skipped.append((cat, model))
            continue
        # A series rule covers the MACHINES in a catalogue, not everything printed
        # in it. YHE Gen 5 also lists A-BOX ("IoT gateway") and C-BOX ("Wireless
        # communication module"); calling those hybrid moulding machines would
        # replace a correct description with a wrong one. Anything already typed
        # as something other than a moulding machine keeps its own type.
        cur = (r["metadata"].get("machine_type") or "").lower()
        if cur and not re.search(r"injection|mould|mold", cur):
            skipped.append((cat, f"{model}  [keeps: {r['metadata']['machine_type']}]"))
            continue
        if r["metadata"].get("machine_type") == new:
            continue
        targets.setdefault(r["id"], {"rec": r, "type": None, "company": None})["type"] = new

    by_type = {}
    for t in targets.values():
        if t["type"]:
            by_type.setdefault(t["type"], []).append(t["rec"]["metadata"].get("model_name", ""))
    ncomp = sum(1 for t in targets.values() if t["company"])
    if ncomp:
        print(f"\n{ncomp:3d}  company -> " + ", ".join(sorted(set(COMPANY_FIX.values()))))
    for t, models in by_type.items():
        print(f"\n{len(models):3d}  {t}")
        print(f"     {', '.join(sorted(set(models))[:10])}")
    if skipped:
        print(f"\n{len(skipped)} record(s) in these catalogues left unchanged "
              f"(no s/v marker -- injection units, not machines):")
        for cat, m in sorted(set(skipped))[:12]:
            print(f"     [{cat}] {m}")

    print(f"\ntotal to update: {len(targets)}")
    if not args.go:
        print("DRY RUN -- re-run with --go")
        return

    items = list(targets.values())
    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump([{"id": t["rec"]["id"],
                    "machine_type": t["rec"]["metadata"].get("machine_type", ""),
                    "company": t["rec"]["metadata"].get("company", ""),
                    "text": t["rec"]["metadata"].get("text", "")} for t in items],
                  f, indent=1, ensure_ascii=False)
    print(f"backed up -> {BACKUP}")

    for i in range(0, len(items), 50):
        sub = items[i:i + 50]
        payload = []
        for t in sub:
            md = dict(t["rec"]["metadata"])
            if t["type"]:
                md["machine_type"] = t["type"]
                md["machine_type_source"] = "supplied"   # not read off a page
            if t["company"]:
                md["company"] = t["company"]
            fixed = clean_name(md.get("model_name", ""))
            if fixed != md.get("model_name"):
                md["text"] = (md.get("text") or "").replace(md["model_name"], fixed)
                md["model_name"] = fixed
            md["text"] = rewrite_text(md.get("text", ""), t["type"], t["company"])
            payload.append((t["rec"]["id"], md))
        vecs = embed_batch([md["text"] for _, md in payload])
        index.upsert(namespace=NAMESPACE,
                     vectors=[{"id": rid, "values": v, "metadata": md}
                              for (rid, md), v in zip(payload, vecs)])
        print(f"  updated {min(i+50, len(items))}/{len(items)}")

    time.sleep(5)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
