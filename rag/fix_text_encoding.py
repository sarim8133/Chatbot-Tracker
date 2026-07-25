"""
Clean four encoding artifacts that reach the customer as wrong characters.

None of these are transcription mistakes -- the ingest copied the source
faithfully. They are artifacts that stop being harmless the moment a sales bot
reads them out loud.

1. CENT SIGN FOR PHI  (16 HAL records, Huare p21)
   The Huare PDF's own font renders Phi as a cent sign, so the records say
   "Motor power: 1.1 (1¢) kW". Verified on the page at 300 dpi: the carbon-brush
   HAL-300GE is single-phase and the inductive models are three-phase, so this is
   1Phi / 3Phi -- an electrical phase count, not currency. Glyph fix only.
   (The same artifact on the HHD hopper dryers was already cleaned by
   fix_hhd_dimensions.py.)

2. BACKSPACE FOR DEGREE  (2 Aoktac records, Fully Auto SBM p5)
   "temperature: 10-15 \x080C" carries a literal U+0008. The other eleven records
   from the same brochure say "10-15 °C", which is what this is.

3. CJK IN A SPEC LINE  (11 Aoktac records, High Speed Tec Blow p10)
   "Box x channel: 10 层/Layer". The Chinese and its English gloss are both
   present; keep the English.

4. CJK IN model_name  (3 JINHU records, JINHU 02 p16)
   model_name is "63 双出" while the record's own text already says
   "Model Name: 63 Double Outlet". The two disagree, and the prompt forbids the
   assistant from emitting CJK, so model_name is set to the English the record
   already carries. No new wording is invented -- the replacement is read out of
   the text field, not written by hand.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_text_encoding.py            # dry run
    & $py rag/fix_text_encoding.py --go
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
BACKUP = os.path.join(HERE, "backups", "text-encoding-backup.json")

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


def clean_text(t):
    """Returns (new_text, [rule names applied])."""
    hits = []
    if "\u00a2" in t:
        t = t.replace("\u00a2", PHI)
        hits.append("cent->Phi")
    if "\x08" in t:
        # "10-15 \x080C" -> "10-15 °C"
        new = re.sub(r"\x08\s*0(?=C\b)", "\u00b0", t)
        new = new.replace("\x08", "")
        if new != t:
            t = new
            hits.append("backspace->degree")
    if "\u5c42" in t:
        t = re.sub(r"\s*\u5c42\s*/\s*Layer", " Layer", t)
        t = t.replace("\u5c42", "")
        hits.append("drop CJK layer")
    return t, hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching ...")
    recs = fetch_all(index)

    updates = []
    for r in recs:
        md = r["metadata"]
        text, hits = clean_text(md.get("text", ""))
        model = (md.get("model_name") or "").strip()
        new_model = model

        if re.search(r"[^\x20-\x7e\u0391-\u03a9]", model):
            # take the English the record already states for itself
            m = re.search(r"Model Name:\s*(.+)$", text, re.M)
            if m and m.group(1).strip() != model and not re.search(r"[\u4e00-\u9fff]", m.group(1)):
                new_model = m.group(1).strip()
                hits.append("model_name CJK->English")

        if not hits:
            continue
        updates.append({"rec": r, "text": text, "model": new_model,
                        "old_model": model, "hits": hits})

    by_rule = {}
    for u in updates:
        for h in u["hits"]:
            by_rule.setdefault(h, []).append(u)
    for rule, us in by_rule.items():
        print(f"\n{rule}  ({len(us)} records)")
        for u in us[:4]:
            old = u["rec"]["metadata"]["text"]
            if rule == "model_name CJK->English":
                print(f"    {u['old_model']!r} -> {u['model']!r}")
            else:
                for a, b in zip(old.split("\n"), u["text"].split("\n")):
                    if a != b:
                        print(f"    - {a[:100]}")
                        print(f"    + {b[:100]}")
                        break
        if len(us) > 4:
            print(f"    ... and {len(us) - 4} more")

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

    # A character swap must never change how many lines or numbers a record has.
    # The one legitimate exception is the degree fix: "10-15 \x080C" holds a "0"
    # that is half of a broken degree glyph, not a value, so strip that exact
    # sequence from the old text before counting rather than loosening the check.
    def nums(s):
        return re.findall(r"\d+(?:\.\d+)?", re.sub(r"\x08\s*0(?=C\b)", "", s))

    for u in updates:
        old = u["rec"]["metadata"]["text"]
        assert len(old.split("\n")) == len(u["text"].split("\n")), u["rec"]["id"]
        assert nums(old) == nums(u["text"]), f"{u['rec']['id']}: numbers changed"
    print("safety check passed: no line count or numeric value changed")

    payload = []
    for u in updates:
        md = dict(u["rec"]["metadata"])
        md["text"] = u["text"]
        md["model_name"] = u["model"]
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
