"""
UWA read as LIWA / LIYA. 12 records, two catalogues.

The brand heading on these pages is a stylized wordmark -- an angular W and a
two-tone A -- so "UWA" came through the vision pass as "LIWA" (YE All-Electric
Gen 5 p18) and "LIYA" (CPVC Gen 5 p17). Both pages were re-read at full size to
confirm: the printed heading is "Technical Parameters of UWA YE 5-Series ...".

The ingest already got `company` right on all 12 records -- every one of them is
tagged company="UWA". Only the model_name (and the "Model Name:" line the text
field repeats) carries the misread, which is why the audit's sibling comparison
never caught it: all twelve agree with each other.

The record id embeds the model name, so it is corrected too. Leaving stale ids
would mean a future re-ingest of either catalogue writes a SECOND copy under the
corrected id instead of overwriting -- so this deletes the old ids after the new
ones are confirmed present. That ordering matters: upsert first, verify, then
delete, so a crash mid-run leaves duplicates rather than a hole.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_uwa_ocr.py            # dry run
    & $py rag/fix_uwa_ocr.py --go
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
BACKUP = os.path.join(HERE, "backups", "uwa-ocr-backup.json")

BAD = re.compile(r"LI[WY]A")
GOOD = "UWA"


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)
    print(f"  {len(recs)} records")

    updates = []
    for r in recs:
        md = dict(r["metadata"])
        touched = [k for k, v in md.items() if isinstance(v, str) and BAD.search(v)]
        if not touched and not BAD.search(r["id"]):
            continue
        for k in touched:
            md[k] = BAD.sub(GOOD, md[k])
        updates.append({"old_id": r["id"], "new_id": BAD.sub(GOOD, r["id"]),
                        "old_md": r["metadata"], "md": md, "fields": touched})

    for u in updates:
        print(f"\n  {u['old_id']}")
        print(f"    -> {u['new_id']}")
        print(f"    model_name: {u['old_md'].get('model_name')!r}")
        print(f"             -> {u['md'].get('model_name')!r}")
        print(f"    company={u['md'].get('company')!r}  fields={u['fields']}")

    print(f"\nto fix: {len(updates)}")
    if not updates:
        print("nothing to do")
        return
    if not args.go:
        print("DRY RUN -- re-run with --go")
        return

    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump([{"id": u["old_id"], "metadata": u["old_md"]} for u in updates],
                  f, indent=1, ensure_ascii=False)
    print(f"backed up -> {BACKUP}")

    # A brand-name correction must not disturb anything else in the record: same
    # line count, same numbers, and the only textual difference is LIWA/LIYA->UWA.
    def nums(s):
        return re.findall(r"\d+(?:\.\d+)?", s)

    for u in updates:
        old, new = u["old_md"].get("text", ""), u["md"].get("text", "")
        assert len(old.split("\n")) == len(new.split("\n")), u["old_id"]
        assert nums(old) == nums(new), f"{u['old_id']}: numbers changed"
        assert BAD.sub(GOOD, old) == new, f"{u['old_id']}: unexpected edit"
        assert not BAD.search(json.dumps(u["md"])), f"{u['old_id']}: LIWA/LIYA left"
    print("safety check passed: only the brand token changed")

    # upsert under the corrected ids first ...
    payload = [(u["new_id"], u["md"]) for u in updates]
    for i in range(0, len(payload), 50):
        chunk = payload[i:i + 50]
        vecs = embed_batch([md["text"] for _, md in chunk])
        index.upsert(namespace=NAMESPACE,
                     vectors=[{"id": rid, "values": v, "metadata": md}
                              for (rid, md), v in zip(chunk, vecs)])
        print(f"  upserted {i + len(chunk)}/{len(payload)}")

    # ... confirm every one landed, and only then drop the misread ids
    time.sleep(4)
    got = index.fetch(ids=[u["new_id"] for u in updates], namespace=NAMESPACE)
    landed = set(got.vectors)
    missing = [u["new_id"] for u in updates if u["new_id"] not in landed]
    if missing:
        raise SystemExit(f"ABORT before delete -- {len(missing)} not readable: {missing}")
    print(f"verified {len(landed)}/{len(updates)} new ids present")

    stale = [u["old_id"] for u in updates if u["old_id"] != u["new_id"]]
    if stale:
        index.delete(ids=stale, namespace=NAMESPACE)
        print(f"deleted {len(stale)} stale ids")

    time.sleep(4)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
