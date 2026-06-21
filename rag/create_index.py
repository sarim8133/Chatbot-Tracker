"""
Create the new Pinecone index 'hitech-v2' with the SAME config as 'hitech'
(3072-dim, cosine, serverless AWS us-east-1, dense, external embeddings).
Idempotent: does nothing if it already exists.

    python rag/create_index.py
"""
import os
import time

from pinecone import Pinecone, ServerlessSpec

API_KEY = os.environ.get("PINECONE_API_KEY")
if not API_KEY:
    _kf = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pinecone_key")
    if os.path.exists(_kf):
        with open(_kf, encoding="utf-8") as _f:
            API_KEY = _f.read().strip()
if not API_KEY:
    raise SystemExit("No Pinecone key (env PINECONE_API_KEY or rag/.pinecone_key).")

NAME = "hitech-v2"
pc = Pinecone(api_key=API_KEY)

try:
    exists = pc.has_index(NAME)
except Exception:
    exists = NAME in [getattr(i, "name", i) for i in pc.list_indexes()]

if exists:
    print(f"Index '{NAME}' already exists — leaving it as-is.")
else:
    pc.create_index(
        name=NAME,
        dimension=3072,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    print(f"Creating '{NAME}' (3072-dim, cosine, serverless aws/us-east-1)…")
    # wait until ready
    for _ in range(60):
        desc = pc.describe_index(NAME)
        ready = (desc["status"]["ready"] if isinstance(desc, dict) else desc.status.ready)
        if ready:
            break
        time.sleep(1)
    print(f"'{NAME}' is ready.")

print(pc.describe_index(NAME))
