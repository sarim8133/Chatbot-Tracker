"""
Inspect the existing Pinecone 'hitech' index to see how the current
(Gemini-summarized) records are actually stored: schema, metadata fields,
and the text that was embedded. This is read-only.

Usage (PowerShell):
    pip install pinecone
    $env:PINECONE_API_KEY = "your-pinecone-key"
    python rag/inspect_pinecone.py

Prints index stats + a sample of records (full metadata), and writes the
sample to rag/hitech_sample.json for closer analysis.
"""
import os
import json
import random

try:
    from pinecone import Pinecone
except ImportError:
    raise SystemExit("Pinecone SDK not installed. Run:  pip install pinecone")

API_KEY = os.environ.get("PINECONE_API_KEY")
if not API_KEY:
    # Fallback: a gitignored local key file so the key never goes in chat/source.
    _key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pinecone_key")
    if os.path.exists(_key_file):
        with open(_key_file, encoding="utf-8") as _f:
            API_KEY = _f.read().strip()
if not API_KEY:
    raise SystemExit(
        "No Pinecone key found. Either:\n"
        "  - PowerShell:  $env:PINECONE_API_KEY = 'your-key'   (then re-run), or\n"
        "  - put the key (one line) in rag/.pinecone_key"
    )

INDEX_NAME = "hitech"
NAMESPACE = "hitech"
DIM = 3072
SAMPLE_N = 25

pc = Pinecone(api_key=API_KEY)
index = pc.Index(INDEX_NAME)

print("=== INDEX STATS ===")
stats = index.describe_index_stats()
stats_d = stats.to_dict() if hasattr(stats, "to_dict") else dict(stats)
print(json.dumps(stats_d, indent=2, default=str))

print(f"\n=== SAMPLING {SAMPLE_N} RECORDS (namespace='{NAMESPACE}') ===")
# A random query vector is the reliable way to pull a sample with metadata
# from a serverless index that has no integrated inference.
qv = [random.uniform(-1, 1) for _ in range(DIM)]
res = index.query(
    vector=qv,
    top_k=SAMPLE_N,
    namespace=NAMESPACE,
    include_metadata=True,
    include_values=False,
)
matches = res["matches"] if isinstance(res, dict) else res.matches

sample = []
for i, m in enumerate(matches, 1):
    mid = m["id"] if isinstance(m, dict) else m.id
    md = (m.get("metadata") if isinstance(m, dict) else m.metadata) or {}
    md = dict(md)
    sample.append({"id": mid, "metadata": md})
    print(f"\n--- Record {i}  id={mid} ---")
    print("  metadata fields:", list(md.keys()))
    for k, v in md.items():
        s = str(v).replace("\n", " ")
        print(f"  {k}: {s[:400]}{'…' if len(s) > 400 else ''}")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hitech_sample.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(sample, f, ensure_ascii=False, indent=2)
print(f"\nSaved {len(sample)} full records to {out}")
