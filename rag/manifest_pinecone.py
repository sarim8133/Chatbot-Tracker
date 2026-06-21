"""
Pull the FULL inventory of the Pinecone 'hitech' index to plan the rebuild:
every record's id / model_name / catalogue / company / image_url / text,
plus a summary (unique brochure pages, per-catalogue counts, company variants).
Read-only. Writes rag/hitech_manifest.json.

    python rag/manifest_pinecone.py
"""
import os
import json
import random
from collections import defaultdict, Counter

from pinecone import Pinecone

API_KEY = os.environ.get("PINECONE_API_KEY")
if not API_KEY:
    _kf = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pinecone_key")
    if os.path.exists(_kf):
        with open(_kf, encoding="utf-8") as _f:
            API_KEY = _f.read().strip()
if not API_KEY:
    raise SystemExit("No Pinecone key (env PINECONE_API_KEY or rag/.pinecone_key).")

INDEX, NAMESPACE, DIM = "hitech", "hitech", 3072
pc = Pinecone(api_key=API_KEY)
index = pc.Index(INDEX)

stats = index.describe_index_stats()
stats_d = stats.to_dict() if hasattr(stats, "to_dict") else dict(stats)
total = stats_d["namespaces"][NAMESPACE]["vector_count"]
print("total vectors:", total)

# One query with top_k = total returns every record (only ~2k of them).
qv = [random.uniform(-1, 1) for _ in range(DIM)]
res = index.query(vector=qv, top_k=total, namespace=NAMESPACE,
                  include_metadata=True, include_values=False)
matches = res["matches"] if isinstance(res, dict) else res.matches

records = []
for m in matches:
    mid = m["id"] if isinstance(m, dict) else m.id
    md = (m.get("metadata") if isinstance(m, dict) else m.metadata) or {}
    records.append({
        "id": mid,
        "model_name": md.get("model_name"),
        "catalogue": md.get("catalogue"),
        "company": md.get("company"),
        "image_url": md.get("image_url"),
        "text": md.get("text"),
    })

by_cat = Counter(r["catalogue"] for r in records)
pages = {r["image_url"] for r in records if r["image_url"]}
comp_by_cat = defaultdict(set)
for r in records:
    comp_by_cat[r["catalogue"]].add(r["company"])
text_lens = [len(r["text"] or "") for r in records]

print(f"records pulled: {len(records)}")
print(f"unique brochure pages (image_url): {len(pages)}")
print(f"unique catalogues: {len(by_cat)}")
print(f"avg text length: {sum(text_lens)//max(len(text_lens),1)} chars "
      f"(min {min(text_lens)}, max {max(text_lens)})")
print("\nper-catalogue: records [distinct company values]")
for c, n in sorted(by_cat.items(), key=lambda x: -x[1]):
    comps = "; ".join(sorted(str(x) for x in comp_by_cat[c]))
    print(f"  {n:4d}  {c}    [company: {comps}]")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hitech_manifest.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False, indent=2)
print(f"\nSaved full manifest ({len(records)} records) to {out}")
