"""
Add a general-information document (an infographic / reference sheet that is NOT
a machine model) to Supabase storage + the Pinecone 'hitech-v2' index.

The image goes to  catalouge-images/General_Information/<slug>.<ext>  (public bucket)
and one record is upserted to Pinecone with the SAME metadata schema the machine
records use (catalogue / company / image_url / model_name / text), so the n8n
retrieval tool can serve it without any workflow change.

The text is taken from a file you write by hand -- deliberately NOT auto-summarized,
because summarizing the source is what made the machine specs lossy.

Keys (env var, or gitignored file in rag/):
    SUPABASE_SERVICE_ROLE_KEY  /  .supabase_key      (storage upload needs service role)
    PINECONE_API_KEY           /  .pinecone_key
    GEMINI_API_KEY             /  .gemini_key

Examples:
  py -3 rag/add_general_doc.py --image "rag/screw dia.jpeg" \
      --text rag/general_docs/screw_diameter_guide.txt \
      --title "Screw Diameter Selection Guide (Injection Molding)" --dry-run
  ... same without --dry-run to actually upload + upsert
"""
import os
import re
import json
import mimetypes
import argparse
import urllib.request

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

EMBED_MODEL = "gemini-embedding-001"
TARGET_INDEX = "hitech-v2"
NAMESPACE = "hitech"
BUCKET = "catalouge-images"
FOLDER = "General_Information"
CATALOGUE_LABEL = "General Information"
COMPANY = "HiTech Machinery"


def _load_key(env_name, filename):
    v = os.environ.get(env_name)
    if not v:
        p = os.path.join(HERE, filename)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                v = f.read().strip()
    if not v:
        raise SystemExit(f"Missing {env_name} (set the env var, or put the key in rag/{filename})")
    return v


def _sb_url():
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("VITE_SB_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise SystemExit("VITE_SB_URL not found in .env")


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")


def upload_image(sb_url, service_key, image_path, object_name):
    """Upload to the public catalogue bucket (x-upsert, so re-runs replace)."""
    with open(image_path, "rb") as f:
        blob = f.read()
    key = f"{FOLDER}/{object_name}"
    url = f"{sb_url}/storage/v1/object/{BUCKET}/{key}"
    mime = mimetypes.guess_type(image_path)[0] or "application/octet-stream"
    req = urllib.request.Request(url, data=blob, method="POST", headers={
        "Authorization": f"Bearer {service_key}",
        "Content-Type": mime,
        "x-upsert": "true",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()
    return f"{sb_url}/storage/v1/object/public/{BUCKET}/{key}"


def embed(text, gemini_key):
    """Same call shape as extract_specs.py: no taskType, so the vector lands in
    the same space as the 1,887 existing records."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={gemini_key}")
    body = json.dumps({"requests": [
        {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": text}]}}
    ]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["embeddings"][0]["values"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True, help="local image file")
    ap.add_argument("--text", required=True, help="file holding the extracted content")
    ap.add_argument("--title", required=True, help="document title (stored as model_name)")
    ap.add_argument("--dry-run", action="store_true", help="print the record; no upload, no upsert")
    args = ap.parse_args()

    image_path = args.image if os.path.isabs(args.image) else os.path.join(ROOT, args.image)
    text_path = args.text if os.path.isabs(args.text) else os.path.join(ROOT, args.text)
    for p in (image_path, text_path):
        if not os.path.exists(p):
            raise SystemExit(f"Not found: {p}")

    with open(text_path, encoding="utf-8") as f:
        content = f.read().strip()

    doc_slug = slug(args.title)
    ext = os.path.splitext(image_path)[1].lower() or ".jpeg"
    object_name = f"{doc_slug}{ext}"
    rec_id = f"{FOLDER}_{doc_slug}"

    if args.dry_run:
        sb_url = _sb_url()
        image_url = f"{sb_url}/storage/v1/object/public/{BUCKET}/{FOLDER}/{object_name}"
        text = (f"Company: {COMPANY} | Catalogue: {CATALOGUE_LABEL} | Model Name: {args.title}\n"
                f"{content}")
        print(f"--- id={rec_id} ---")
        print(f"image_url: {image_url}  (would upload {os.path.basename(image_path)})")
        print(f"chars: {len(text)}\n")
        print(text)
        return

    sb_url = _sb_url()
    service_key = _load_key("SUPABASE_SERVICE_ROLE_KEY", ".supabase_key")
    gemini_key = _load_key("GEMINI_API_KEY", ".gemini_key")
    pinecone_key = _load_key("PINECONE_API_KEY", ".pinecone_key")

    image_url = upload_image(sb_url, service_key, image_path, object_name)
    print(f"uploaded -> {image_url}")

    text = (f"Company: {COMPANY} | Catalogue: {CATALOGUE_LABEL} | Model Name: {args.title}\n"
            f"{content}")
    values = embed(text, gemini_key)
    print(f"embedded -> {len(values)} dims")

    index = Pinecone(api_key=pinecone_key).Index(TARGET_INDEX)
    index.upsert(vectors=[{
        "id": rec_id,
        "values": values,
        "metadata": {
            "catalogue": CATALOGUE_LABEL,
            "company": COMPANY,
            "image_url": image_url,
            "model_name": args.title,
            "text": text,
        },
    }], namespace=NAMESPACE)
    print(f"upserted -> {TARGET_INDEX}/{NAMESPACE}  id={rec_id}")


if __name__ == "__main__":
    main()
