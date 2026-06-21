"""
Rebuild the machinery catalogue with FULL specs via Gemini Vision, then
(optionally) embed + upsert into Pinecone 'hitech-v2'.

HYBRID structure:
  - Tederic / UWA injection-machine brochures  -> one COHERENT record per machine
        (clamping + Type-B injection + speeds + features assembled together)
  - everything else (MEGA, JINHU, SCR, Demaji, robots, compressors, ...)
        -> faithful per-model refresh, keeping the existing ids

Type B: where a screw/injection unit is offered as Type A/B/C, only B is kept.

Examples:
  python rag/extract_specs.py --find "NEO-E470" --dry-run
  python rag/extract_specs.py --find "MG-7380" --dry-run
  python rag/extract_specs.py --limit 5
  python rag/extract_specs.py --all
"""
import os
import re
import json
import time
import argparse
import urllib.request
import concurrent.futures
from collections import defaultdict

from google import genai
from google.genai import types
from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
VISION_MODEL = "gemini-2.5-flash"
EMBED_MODEL = "gemini-embedding-001"
TARGET_INDEX = "hitech-v2"
NAMESPACE = "hitech"


def _load_key(env_name, filename):
    v = os.environ.get(env_name)
    if not v:
        p = os.path.join(HERE, filename)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                v = f.read().strip()
    if not v:
        raise SystemExit(f"Missing {env_name} (env or rag/{filename})")
    return v


PINECONE_KEY = _load_key("PINECONE_API_KEY", ".pinecone_key")
GEMINI_KEY = _load_key("GEMINI_API_KEY", ".gemini_key")

with open(os.path.join(HERE, "catalogue_map.json"), encoding="utf-8") as f:
    CAT_MAP = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
with open(os.path.join(HERE, "hitech_manifest.json"), encoding="utf-8") as f:
    MANIFEST = json.load(f)

# Tederic + UWA brochures get the "assemble one record per machine" treatment.
IMM_CATALOGUES = {k for k, v in CAT_MAP.items() if v.get("company") in ("Tederic", "UWA")}

client = genai.Client(api_key=GEMINI_KEY, http_options=types.HttpOptions(timeout=180_000))

PROMPT_PERMODEL = """You are extracting machine specifications from ONE page of a B2B machinery brochure (image provided).

This page is expected to contain the following model(s): {models}. Include any additional models on the page too.

For EACH model, transcribe EVERY specification and number from its table, with units, exactly as printed.

HARD RULES:
1. Do NOT summarize, round, average, omit, or paraphrase numbers. Copy them verbatim with units.
2. If a screw/injection unit is offered as Type A/B/C (or several screw-diameter columns), include ONLY the Type B values. Discard A and C.
3. If there are no A/B/C columns, include all values shown.
4. Do not invent fields. Omit missing ones.
5. English only.

Return STRICT JSON only -- an array, one object per model:
[{{"model_name": "<exact model name>", "specs": "<all specs as clean readable lines with units>"}}]
"""

PROMPT_IMM = """This is ONE page from an injection-molding-machine brochure (image provided).
A single machine model's data is often split on the page into separate tables: a clamping-unit table, one or more injection-unit tables, injection-speed rows, and standard/optional feature lists.

Expected model(s) on this page (hint): {models}.

Assemble the page into COMPLETE machine record(s). USUALLY this page describes ONE machine model (e.g. "NEO-E470II") -- combine its clamping specs AND its injection-unit specs AND speeds into a SINGLE object. Occasionally a page is a shared standard/optional features table covering a RANGE of models.

Return STRICT JSON only -- an array. For each distinct machine model:
[{{"model_name": "<the machine model, e.g. NEO-E470II>", "specs": "<ALL specs assembled: [Clamping] ... [Injection - Type B] ... [Speeds] ... [Features] ...>"}}]
If the page is a shared features/options table for a range, return one object: model_name = the range label, specs = the feature list.

HARD RULES:
1. Copy every number verbatim with units. Do NOT summarize, round, or omit.
2. For injection units offered as screw Type A/B/C (or multiple screw-diameter columns), include ONLY Type B. The company sells only Type B. Discard A and C.
3. Do NOT split one machine's clamping and injection specs into separate objects -- combine them.
4. Do not invent missing values.
5. English only.
"""


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")


def _retry(fn, *a, tries=4, delay=2, **kw):
    for i in range(tries):
        try:
            return fn(*a, **kw)
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"    retry {i+1}/{tries-1} after error: {e}")
            time.sleep(delay * (i + 1))


def specs_to_text(specs, indent=0):
    """Gemini may return specs as a string, dict, or list. Flatten to readable text."""
    if specs is None:
        return ""
    if isinstance(specs, str):
        return specs
    pad = "  " * indent
    lines = []
    if isinstance(specs, dict):
        for k, v in specs.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{pad}{k}:")
                lines.append(specs_to_text(v, indent + 1))
            else:
                lines.append(f"{pad}{k}: {v}")
    elif isinstance(specs, list):
        for item in specs:
            if isinstance(item, (dict, list)):
                lines.append(specs_to_text(item, indent))
            else:
                lines.append(f"{pad}- {item}")
    else:
        return str(specs)
    return "\n".join(lines)


_EXEC = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def _with_timeout(fn, *a, timeout=200, **kw):
    return _EXEC.submit(fn, *a, **kw).result(timeout=timeout)


def fetch_image(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def _vision_once(image_url, prompt):
    img = fetch_image(image_url)
    resp = client.models.generate_content(
        model=VISION_MODEL,
        contents=[types.Part.from_bytes(data=img, mime_type="image/jpeg"), prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0,
            max_output_tokens=16384,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    raw = resp.text or ""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", raw)
        return json.loads(m.group(0)) if m else []


def vision(image_url, prompt):
    # hard 200s wall-clock timeout so a stalled call can't freeze the run
    return _retry(_with_timeout, _vision_once, image_url, prompt)


def _embed_batch_once(texts):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}"
    body = json.dumps({"requests": [
        {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t}]}} for t in texts
    ]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    return [e["values"] for e in data["embeddings"]]


def embed_batch(texts):
    # one API call for all of a page's records (batchEmbedContents)
    return _retry(_embed_batch_once, texts)


def build_text(company, catalogue, model_name, specs):
    return (f"Company: {company} | Catalogue: {catalogue} | Model Name: {model_name}\n"
            f"Specifications:\n{specs}")


def records_for_page(url, recs):
    """Return a list of {id, metadata} for one brochure page."""
    catalogue = recs[0]["catalogue"]
    cm = CAT_MAP.get(catalogue, {})
    company = cm.get("company") or recs[0].get("company") or "HiTech Machinery"
    catalogue_label = cm.get("catalogue") or catalogue
    expected = [r["model_name"] for r in recs]
    out = []

    if catalogue in IMM_CATALOGUES:
        # assemble one record per machine
        for e in vision(url, PROMPT_IMM.format(models=", ".join(expected))):
            model = str(e.get("model_name") or "").strip()
            specs = specs_to_text(e.get("specs")).strip()
            if not model or not specs:
                continue
            out.append({"id": f"{catalogue}_{slug(model)}",
                        "metadata": {"catalogue": catalogue_label, "company": company,
                                     "image_url": url, "model_name": model,
                                     "text": build_text(company, catalogue_label, model, specs)}})
    else:
        # per-model refresh, keep existing ids
        extracted = vision(url, PROMPT_PERMODEL.format(models=", ".join(expected)))
        by_model = {norm(e.get("model_name", "")): specs_to_text(e.get("specs")) for e in extracted}
        for r in recs:
            specs = by_model.get(norm(r["model_name"]))
            if not specs:
                for k, v in by_model.items():
                    if k and (k in norm(r["model_name"]) or norm(r["model_name"]) in k):
                        specs = v
                        break
            if not specs:
                specs = "(specs not found on page - needs manual review)"
            out.append({"id": r["id"],
                        "metadata": {"catalogue": catalogue_label, "company": company,
                                     "image_url": url, "model_name": r["model_name"],
                                     "text": build_text(company, catalogue_label, r["model_name"], specs)}})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--find", help="only pages containing this model substring")
    ap.add_argument("--limit", type=int, help="process first N pages")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print records, do NOT embed/upsert")
    args = ap.parse_args()

    pages = defaultdict(list)
    for r in MANIFEST:
        if r.get("image_url"):
            pages[r["image_url"]].append(r)

    urls = list(pages.keys())
    if args.find:
        needle = norm(args.find)
        urls = [u for u in urls if any(needle in norm(r["model_name"]) for r in pages[u])]
        print(f"matched {len(urls)} page(s) for '{args.find}'")
    elif args.limit:
        urls = urls[:args.limit]
    elif not args.all:
        print("Use --find <model>, --limit N, or --all (add --dry-run to preview).")
        return

    index = None if args.dry_run else Pinecone(api_key=PINECONE_KEY).Index(TARGET_INDEX)
    done_file = os.path.join(HERE, "done_pages.txt")
    done = set()
    if not args.dry_run and os.path.exists(done_file):
        with open(done_file, encoding="utf-8") as df:
            done = {ln.strip() for ln in df if ln.strip()}
    pages_done = upserts = skipped = 0
    CHUNK = 50  # batchEmbedContents + Pinecone upsert both prefer <=100 per call
    for i, url in enumerate(urls, 1):
        if url in done:
            skipped += 1
            continue
        mode = "IMM" if pages[url][0]["catalogue"] in IMM_CATALOGUES else "per-model"
        print(f"[{i}/{len(urls)}] {mode:9s} {url.split('/')[-1]}", flush=True)
        try:
            built = records_for_page(url, pages[url])
            if args.dry_run:
                print(f"\n===== {url.split('/')[-1]}  [{mode}]  -> {len(built)} record(s) =====")
                for rec in built:
                    print(f"\n--- id={rec['id']} ---")
                    print(rec["metadata"]["text"])
            else:
                total = 0
                for j in range(0, len(built), CHUNK):
                    sub = built[j:j + CHUNK]
                    embs = embed_batch([rec["metadata"]["text"] for rec in sub])
                    vectors = [{"id": rec["id"], "values": v, "metadata": rec["metadata"]}
                               for rec, v in zip(sub, embs)]
                    index.upsert(vectors=vectors, namespace=NAMESPACE)
                    total += len(vectors)
                if total:
                    print(f"  [{mode:9s}] upserted {total:3d}  <- {url.split('/')[-1]}", flush=True)
                with open(done_file, "a", encoding="utf-8") as df:
                    df.write(url + "\n")
            pages_done += 1
        except Exception as e:
            print(f"  ! failed {url.split('/')[-1]}: {e}", flush=True)
            continue
        time.sleep(0.2)

    print(f"\nPages: {pages_done} | skipped(already done): {skipped} | upserts: {upserts}", flush=True)


if __name__ == "__main__":
    main()
