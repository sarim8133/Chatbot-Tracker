"""
Give the pre-existing catalogues a machine_type.

THE GAP
-------
The namespace was built by two earlier pipelines that recorded WHAT A MACHINE
MEASURES and never WHAT IT DOES. 1,723 records carry clamping forces, screw
diameters and air flows, and not one word about semi- versus fully-automatic,
extrusion versus injection blow, rotary versus linear. A rep asking "which
semi-automatic blow moulding machine do we sell" gets ranked nonsense, because
nothing in the index contains the attribute being asked about. A reranker cannot
help: it can only reorder what vector search already returned.

WHY NOT JUST RE-INGEST WITH add_catalogue.py
--------------------------------------------
Because these records are already live and already good. Their ids are referenced
nowhere else, but their image_url values point at page renders uploaded months
ago, and a fresh ingest would mint new ids, re-render every page and leave the old
records behind to be hunted down. This script changes ONE field on records that
already exist and touches nothing else.

machine_type lives inside the EMBEDDED text, not just metadata, so every record it
touches must be re-embedded. That is the entire point: a query about a rotary
turntable has to match the vector. A metadata-only write would change nothing a
user can feel.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/backfill_machine_type.py --list
    & $py rag/backfill_machine_type.py --only "Huare Machinery"          # dry run
    & $py rag/backfill_machine_type.py --only "Huare Machinery" --go
"""
import os
import re
import csv
import sys
import json
import time
import base64
import argparse
import subprocess
import concurrent.futures as cf
import urllib.request
import urllib.error

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = r"D:\Hi-Tech doc\python script\Image done"
RENDER_ROOT = os.path.join(HERE, ".render_backfill")

VISION_MODEL = "gemini-2.5-flash"
EMBED_MODEL = "gemini-embedding-001"
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
RENDER_DPI = 150
# Concurrent vision calls. 8 keeps well inside the per-minute quota while
# turning an hour of sequential round-trips into a few minutes.
PAGE_WORKERS = 8

REVIEW_MD = os.path.join(HERE, "backfill_review.md")
BACKUP_DIR = os.path.join(HERE, "backups")

POPPLER_CANDIDATES = [
    r"C:\Program Files\Release-25.12.0-0\poppler-25.12.0\Library\bin",
    r"C:\msys64\mingw64\bin",
    r"D:\Hi-Tech doc\python script\poppler-26.04.0\Library\bin",
]

# ── which live catalogue came from which brochure ────────────────────────────
# Keyed by the catalogue value stored on the live records, because that is what
# this script has to match against. Several catalogues were built from two PDFs
# (a parameters book and a product book); both are read, and the richer answer
# wins per model.
SOURCES = {
    "Huare Machinery":                ["Huare.pdf"],
    "Downstream / Filters":           ["Downstream Equipment.pdf"],
    "Shangair Compressor":            ["Shangair 01.pdf", "Shangair 02.pdf"],
    "JINHU Downstream / Extrusion":   ["JINHU 02.pdf"],
    "Air Dryer":                      ["HiTech-Air-Dryer.pdf"],
    "Demaji Extruders & Mould Steel": ["Demaji and HiTech Machinery.pdf"],
    "NEO-EII":                        ["3 NEO·EII  Parameters Brochure _20241219_EN.pdf",
                                       "3-NEO·EII  Product Brochure _20230511_EN.pdf"],
    "SCR APM Screw Air Compressor":   ["100APM.pdf"],
    "DT (Toggle-Clamp)":              ["2-DT Parameters Brochure _20241227_EN.pdf",
                                       "2-DT Product Brochure _20230623_EN.pdf"],
    "JINHU (Booklet 1)":              ["JINHU 01.pdf"],
    "Tederic DD (Double-Color)":      ["1 DD Parameters Brochure_20241224_EN.pdf",
                                       "1-DD Product Brochure _20230623_EN.pdf"],
    "NEO-HII (Two-Platen)":           ["4 NEO·HII Parameters Brochure _20250102_EN.pdf",
                                       "4-NEO·HII  Product Brochure _20230511_EN.pdf"],
    "Extrusion Auxiliaries":          ["Extrusion-Auxileries.pdf"],
    "SCR EPM / EPM2":                 ["EPM, EPM2.pdf"],
    "YH Gen 5":                       ["1 YH Generation 5.pdf"],
    "YE All-Electric Gen 5":          ["4 YE All Electric Gen5.pdf"],
    "YH Gen 5 Low-Inertia":           ["2 YH Gen 5 Low Interita(1).pdf"],
    "IBM / ISBM":                     ["HiTech-IBM-ISBM-Machines.pdf"],
    "Paint-Bucket IMM":               ["HiTech-Paint-Bucket-IMM.pdf"],
    "UPVC Gen 5":                     ["9 UPVC Gen 5.pdf"],
    "PET Preform IMM":                ["6-PET preform _ Product &Parameters Brochure_20250212_EN.pdf"],
    "CPVC Gen 5":                     ["10 CPVC Gen 5.pdf"],
    "PET Gen 5":                      ["3 PET Generation 5.pdf"],
    "JOBO Cap Machines":              ["JOBO and HiTech Machinery.pdf"],
    "Pallet IMM":                     ["5-Pallet_Product &Parameters Brochure _20240801_EN.pdf"],
    "YU Gen 5 (Two-Platen)":          ["6 YU Gen 5.pdf"],
    "Yangsen Robots":                 ["YANGSEN 01.pdf", "YANGSEN 02.pdf"],
    "Basket Series Gen 5":            ["11 Basket Series Gen 5.pdf"],
    "YHS Gen 5":                      ["8 YHS.pdf"],
    "YHSP Gen 5":                     ["7 YHSP Gen 5.pdf"],
    "YE Medical Gen 5":               ["5 YE Medical Gen 5.pdf"],
    "Laser Marking":                  ["HiTech-Laser-Marking-Machine.pdf"],
    "JINHU Heat-Transfer Fluid":      ["JINHU 04.pdf"],
    "JINHU (Booklet 3)":              ["JINHU 03.pdf"],
}

# Catalogues whose blanks are deliberate: this session's ingest already ran the
# vision pass and recorded "unknown" because the page genuinely did not say.
# Re-running them would only burn tokens to reach the same blank.
DELIBERATE_BLANKS = {
    "Aoktac Fully-Automatic SBM", "Aoktac High-Speed Tec Blow", "JINGYE Catalogue 2025",
    "JINGYE ISBM", "JINGYE IBM", "FUDL", "General Information", "SCR Compressor",
}


def _load_key(env_name, filename):
    v = os.environ.get(env_name)
    if not v:
        p = os.path.join(HERE, filename)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                v = f.read().strip()
    if not v:
        raise SystemExit(f"Missing {env_name} (env var or rag/{filename})")
    return v


PINECONE_KEY = _load_key("PINECONE_API_KEY", ".pinecone_key")
GEMINI_KEY = _load_key("GEMINI_API_KEY", ".gemini_key")

# These brochures are Chinese-English, and the model names carry middots and the
# occasional CJK character. On Windows stdout defaults to cp1252, so PRINTING a
# progress line was enough to kill a run that had already read 60 pages.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ── the prompt ────────────────────────────────────────────────────────────────
# Deliberately NOT asking for specs. The specs are already in the namespace and
# are the one thing here that must not change; asking for them again would cost
# most of the tokens and invite a rewrite of data that is already correct.
PROMPT = """You are reading ONE page of a B2B plastics-machinery or compressed-air brochure.

Return STRICT JSON only: an array, one object per machine model named on this page.

[{
  "model_name": "<exact model designation as printed, e.g. HTZ 50S-IBM, SCR100APM-10>",
  "machine_type": "<a DETAILED description of what this machine is and does>",
  "machine_type_source": "printed" | "derived" | "unknown",
  "machine_type_evidence": "<the exact words or spec-row labels you based it on>"
}]

=== machine_type: COMPOSE IT, DO NOT COPY THE HEADING ===
A rep searches by what a machine DOES, so a bare product title is close to
useless. The title is ONE input. Read the WHOLE page - title, bullets, spec-row
labels, dimension drawings, photo captions - and COMPOSE a description carrying
every dimension the page supports:

  1. Process family - injection moulding / extrusion blow moulding / injection
     blow moulding / injection stretch blow moulding (ISBM) / stretch blow
     moulding / pipe or profile extrusion / screw air compressor / piston air
     compressor / air dryer (refrigerated, desiccant) / filter / material dryer /
     hopper loader / mixer / crusher / chiller / mould-temperature controller /
     robot / auxiliary
  2. Automation level - fully automatic / semi-automatic / manual
  3. Layout or clamp design - linear / rotary / shuttle / toggle-clamp /
     two-platen / all-electric / hydraulic / servo-hydraulic / permanent-magnet
     VSD / single-stage / two-stage / oil-injected / oil-free / preform reheat
  4. What it produces or handles - PET bottles, jerry cans, preforms, caps,
     thin-wall containers, PVC pipe, profile, sheet, compressed air - with the
     size or capacity range when the table gives one
  5. Material where stated - PET, HDPE, PP, PVC, CPVC
  6. Cavity count and rated output when the table gives them

WORKED EXAMPLE. A page titled "AOK-2000 Full Automatic Blow Molding Machine"
whose bullets say "Use the linear type structure", whose spec rows include
"stretch stroke", "Max.preform height", "Number of cavity 2", "Max.container
volume 2.0 ltr" and "theoretical output 2200 B.P.H" must yield:

  "Full automatic linear-type PET stretch blow moulding machine, two-stage
   preform-reheat, 2 cavities, for containers up to 2.0 L, rated 2200 BPH"

NOT "Full Automatic Blow Molding Machine". That answer would be rejected.

Every element must be traceable to something on the page. Omit any dimension the
page does not support rather than guessing it - a shorter accurate description
beats a fuller invented one.

=== WHERE machine_type MAY COME FROM ===
"printed"  - the core process words appear on the page. You may still compose
             extra detail from the spec rows and keep the source as "printed".
"derived"  - the process words are NOT on the page and the spec rows decide it.
             "Preform system" + "Clamping force of blowing" + "Lifting H of
             rotary table" is an injection blow machine with a rotary table.
             Put the exact row labels in machine_type_evidence.
"unknown"  - nothing on the page supports it. Set machine_type to "" and
             evidence to "". This is a CORRECT and useful answer.

HARD RULE: NEVER infer the type from the model code alone. "SS" in a model name
does not establish stretch blow; "A" does not establish automatic; "PM" in
SCR100APM does not by itself establish permanent-magnet. If the only thing
suggesting a type is the model designation, the source is "unknown".
A blank field is fine. A confident wrong answer is not.

=== NAMING ===
Return the model designation EXACTLY as printed, including spaces, hyphens and
dots. These names are matched against records that already exist; a tidied-up
name matches nothing and the record keeps its blank.

=== WHAT IS NOT A MODEL ===
Return an empty array [] for covers, contents pages, factory photos, certificate
pages and company profiles. Brand logos, banner slogans and website footers are
NOT machine models.
"""

VISION_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "model_name": {"type": "STRING"},
            "machine_type": {"type": "STRING"},
            "machine_type_source": {"type": "STRING", "enum": ["printed", "derived", "unknown"]},
            "machine_type_evidence": {"type": "STRING"},
        },
        "propertyOrdering": ["model_name", "machine_type",
                             "machine_type_source", "machine_type_evidence"],
        "required": ["model_name", "machine_type",
                     "machine_type_source", "machine_type_evidence"],
    },
}


def poppler_bin(tool):
    for d in POPPLER_CANDIDATES:
        p = os.path.join(d, tool + ".exe")
        if os.path.exists(p):
            return p
    return tool


def norm(s):
    """Match key for model names. The brochures and the two earlier pipelines
    disagree about spaces, hyphens, dots and middots -- 'NEO-E160II', 'NEO E160II'
    and 'NEO·E160II' are one machine -- so all of it is stripped."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _retry(fn, what, tries=4, wait=4):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            detail = ""
            if isinstance(e, urllib.error.HTTPError):
                try:
                    detail = e.read().decode()[:200]
                except Exception:
                    pass
            if i == tries - 1:
                raise RuntimeError(f"{what} failed after {tries}: {e} {detail}") from e
            time.sleep(wait * (i + 1))


def render_pages(pdf_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    have = sorted(f for f in os.listdir(out_dir) if f.startswith("page") and f.endswith(".jpg"))
    if have:                                   # a re-run must not re-render
        return [os.path.join(out_dir, f) for f in have]
    subprocess.run([poppler_bin("pdftoppm"), "-jpeg", "-r", str(RENDER_DPI),
                    pdf_path, os.path.join(out_dir, "page")],
                   check=True, capture_output=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("page") and f.endswith(".jpg"))
    return [os.path.join(out_dir, f) for f in files]


def _post_json(url, payload, headers, timeout=240):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def read_page(img_path):
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{VISION_MODEL}:generateContent?key={GEMINI_KEY}")
    payload = {
        "contents": [{"parts": [{"text": PROMPT},
                                {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                             "responseSchema": VISION_SCHEMA},
    }
    got = _retry(lambda: _post_json(url, payload, {}), f"vision {os.path.basename(img_path)}")
    cands = got.get("candidates") or []
    if not cands:
        raise RuntimeError(f"no candidates (finishReason={got.get('promptFeedback')})")
    fin = cands[0].get("finishReason")
    parts = cands[0].get("content", {}).get("parts") or []
    raw = "".join(p.get("text", "") for p in parts).strip()
    if not raw:
        # An empty body is NOT the same as "this page has no machines". Page 31 of
        # the Huare book is a full HGM180 crusher spec table and came back empty,
        # silently, and the six live HGM180 records kept their blank type as a
        # result. Anything other than a clean STOP is a failure and must be
        # retried by _retry, not swallowed as an answer.
        raise RuntimeError(f"empty response (finishReason={fin})")
    try:
        out = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"unparseable JSON (finishReason={fin}): {str(e)[:80]}") from e
    return out if isinstance(out, list) else []


def embed_batch(texts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": t}]}} for t in texts]}
    got = _retry(lambda: _post_json(url, payload, {}), "embed")
    return [e["values"] for e in got["embeddings"]]


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


def rewrite_text(text, new_type):
    """Patch the embedded text. Records written by the two earlier pipelines have
    no 'Machine type:' line at all, so one is inserted straight after the header
    where the newer format puts it."""
    lines = (text or "").split("\n")
    for i, ln in enumerate(lines):
        if ln.startswith("Machine type:"):
            lines[i] = f"Machine type: {new_type}"
            return "\n".join(lines)
    if lines:
        lines.insert(1, f"Machine type: {new_type}")
    return "\n".join(lines)


def extract(catalogue, pdfs):
    """Read every page of every source PDF for one catalogue -> {norm_name: row}.

    Cached per PDF. The intended workflow is a dry run, read the review table,
    then --go; without a cache that second run re-reads all 45 pages of Huare to
    reach the answer it already had, which is both slow and paid for twice."""
    cache_path = os.path.join(RENDER_ROOT, "_extract_cache.json")
    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    found = {}
    for pdf in pdfs:
        if pdf in cache:
            print(f"  {pdf}: cached ({len(cache[pdf])} typed)")
            for k, v in cache[pdf].items():
                prev = found.get(k)
                if prev is None or len(v["machine_type"]) > len(prev["machine_type"]):
                    found[k] = v
            continue
        path = os.path.join(PDF_DIR, pdf)
        if not os.path.exists(path):
            print(f"  !! missing PDF: {pdf}")
            continue
        out_dir = os.path.join(RENDER_ROOT, norm(pdf))
        pages = render_pages(path, out_dir)
        per_pdf = {}
        print(f"  {pdf}: {len(pages)} page(s)")
        # Pages are independent, so read them concurrently. Sequentially this was
        # ~11s of pure round-trip per page and roughly an hour for the 250 pages
        # in these brochures, with the CPU idle throughout. Order is preserved by
        # submitting into a list and reading results back by index, because the
        # "page" field in the review table has to name the right page.
        with cf.ThreadPoolExecutor(max_workers=PAGE_WORKERS) as pool:
            futures = [pool.submit(read_page, img) for img in pages]
            results = []
            for n, fut in enumerate(futures, 1):
                try:
                    results.append((n, fut.result()))
                except Exception as e:
                    print(f"    page {n}: FAILED {str(e)[:110]}")
        for n, models in results:
            kept = 0
            for m in models:
                name = (m.get("model_name") or "").strip()
                mt = (m.get("machine_type") or "").strip()
                src = m.get("machine_type_source") or "unknown"
                if not name or not mt or src == "unknown":
                    continue
                key = norm(name)
                # The same hard rule the ingest pipeline enforces: if the only
                # evidence is the model code itself, that is not evidence.
                ev = norm(m.get("machine_type_evidence"))
                if ev and (ev in key or key in ev):
                    continue
                row = {"model_name": name, "machine_type": mt, "source": src,
                       "evidence": (m.get("machine_type_evidence") or "").strip(),
                       "page": f"{pdf} p{n}"}
                for bucket in (found, per_pdf):
                    prev = bucket.get(key)
                    if prev is None or len(mt) > len(prev["machine_type"]):
                        bucket[key] = row
                kept += 1
            print(f"    page {n}: {kept} typed" if kept else f"    page {n}: -")
        # Pages that yielded nothing. Covers and contents pages legitimately do,
        # but so did page 31 of the Huare book -- a full HGM180 crusher spec
        # table the model judged to be page furniture, which is why six live
        # HGM180 records kept their blank type. Printing them is the only way
        # anyone finds out; a silent [] looks exactly like a cover.
        got_pages = {r["page"] for r in per_pdf.values()}
        empty = [n for n in range(1, len(pages) + 1) if f"{pdf} p{n}" not in got_pages]
        if empty:
            print(f"    NO MODELS on page(s): {', '.join(map(str, empty))}"
                  f"  <- check these if records stay blank")
        cache[pdf] = per_pdf
        os.makedirs(RENDER_ROOT, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only", action="append", help="a live catalogue name; repeatable")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--go", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching namespace ...")
    recs = fetch_all(index)
    blank = [r for r in recs if not (r["metadata"].get("machine_type") or "").strip()]
    by_cat = {}
    for r in blank:
        by_cat.setdefault(r["metadata"].get("catalogue", "?"), []).append(r)
    print(f"  {len(recs)} records, {len(blank)} without machine_type\n")

    if args.list:
        print(f"{'records':>8}  {'catalogue':<34} source")
        for cat, rs in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
            if cat in DELIBERATE_BLANKS:
                src = "(deliberate blank -- vision already said unknown)"
            else:
                src = ", ".join(SOURCES.get(cat, [])) or "!! NO SOURCE REGISTERED"
            print(f"{len(rs):>8}  {cat:<34} {src}")
        return

    if args.all:
        todo = [c for c in by_cat if c in SOURCES]
    else:
        todo = list(args.only or [])
    if not todo:
        raise SystemExit("Nothing selected. Use --list, --only <catalogue>, or --all.")

    all_rows, updates = [], []
    for cat in todo:
        rs = by_cat.get(cat, [])
        if not rs:
            print(f"=== {cat}: nothing blank, skipping ===")
            continue
        pdfs = SOURCES.get(cat)
        if not pdfs:
            print(f"=== {cat}: NO SOURCE REGISTERED, skipping ===")
            continue
        print(f"=== {cat}  ({len(rs)} blank records) ===")
        found = extract(cat, pdfs)

        matched, unmatched = 0, []
        for r in rs:
            live_key = norm(r["metadata"].get("model_name"))
            hit = found.get(live_key)
            if not hit:
                # The live name and the brochure name often describe the same
                # machine at different lengths. The earlier pipelines wrote the
                # variant into the name -- "D210Db Type 1 (m150)" where the
                # brochure page says "D210Db" -- while the CPVC book does the
                # reverse, printing "(YH158)" for what is stored as
                # "LIYA YE 5-Series CPVC (YH158)".
                #
                # So fall back to containment, and take the LONGEST match. That
                # is what stops "D280Db with m210 (Type 1, B) Injection Unit"
                # from being typed as an m210 injection unit: both "d280db" and
                # "m210" are contained in it, and the longer one is the machine.
                # Bare injection-unit codes never win a containment match. They
                # are not machines -- 31 such records were deleted from this
                # namespace for exactly that reason -- and "m210" sits inside
                # plenty of machine names that have nothing to do with it.
                cands = [(k, v) for k, v in found.items()
                         if len(k) >= 4 and not re.fullmatch(r"[iem]\d{2,6}", k)
                         and (k in live_key or live_key in k)]
                if cands:
                    hit = max(cands, key=lambda kv: len(kv[0]))[1]
                else:
                    # Last resort: the base model, cut at the first space or
                    # bracket. The DD catalogue stores its variants as prose --
                    # "D280Db with m210 (Type 1, B) Injection Unit" -- so the
                    # only thing a brochure page can be expected to share with
                    # it is the D280Db at the front.
                    base = norm(re.split(r"[\s(]", (r["metadata"].get("model_name") or "").strip())[0])
                    if len(base) >= 4:
                        cands = [(k, v) for k, v in found.items()
                                 if len(k) >= 4 and not re.fullmatch(r"[iem]\d{2,6}", k)
                                 and (base == k or base in k)]
                        if cands:
                            hit = min(cands, key=lambda kv: len(kv[0]))[1]
            if not hit:
                unmatched.append(r["metadata"].get("model_name", ""))
                continue
            matched += 1
            updates.append({"rec": r, "type": hit["machine_type"], "source": hit["source"]})
            all_rows.append({"catalogue": cat, "model": r["metadata"].get("model_name", ""),
                             "machine_type": hit["machine_type"], "source": hit["source"],
                             "evidence": hit["evidence"], "page": hit["page"]})
        extra = [v["model_name"] for k, v in found.items()
                 if k not in {norm(r["metadata"].get("model_name")) for r in rs}]
        print(f"  -> {matched}/{len(rs)} matched, {len(unmatched)} still blank, "
              f"{len(extra)} extracted names not live")
        if unmatched:
            print(f"     still blank: {', '.join(sorted(set(unmatched))[:10])}")
        if extra:
            print(f"     not live   : {', '.join(sorted(set(extra))[:10])}")

    if all_rows:
        with open(REVIEW_MD, "w", encoding="utf-8") as f:
            f.write("# machine_type backfill review\n\n")
            f.write("Correct anything wrong here BEFORE the `--go` run. You know the catalogue.\n\n")
            srcs = {}
            for r in all_rows:
                srcs[r["source"]] = srcs.get(r["source"], 0) + 1
            f.write(f"- **{len(all_rows)}** records would gain a machine_type\n")
            f.write(f"- source: " + ", ".join(f"**{n} {s}**" for s, n in sorted(srcs.items())) + "\n\n")
            f.write("| catalogue | model | machine_type | src | evidence | page |\n|---|---|---|---|---|---|\n")
            flat = lambda s: " ".join(str(s or "").split()).replace("|", "/")
            for r in all_rows:
                f.write(f"| {flat(r['catalogue'])} | {flat(r['model'])} | {flat(r['machine_type'])} "
                        f"| {r['source']} | {flat(r['evidence'])[:90]} | {flat(r['page'])} |\n")
        print(f"\nreview table -> {REVIEW_MD}")

    print(f"\ntotal records to update: {len(updates)}")
    if not args.go:
        print("DRY RUN -- nothing written. Re-run with --go")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(BACKUP_DIR, f"backfill-{stamp}.json")
    with open(backup, "w", encoding="utf-8") as f:
        json.dump([{"id": u["rec"]["id"], "metadata": u["rec"]["metadata"]} for u in updates],
                  f, indent=1, ensure_ascii=False)
    print(f"backed up {len(updates)} records -> {backup}")

    for i in range(0, len(updates), 50):
        sub = updates[i:i + 50]
        payload = []
        for u in sub:
            md = dict(u["rec"]["metadata"])
            md["machine_type"] = u["type"]
            md["machine_type_source"] = u["source"]
            md["text"] = rewrite_text(md.get("text", ""), u["type"])
            payload.append((u["rec"]["id"], md))
        vecs = embed_batch([md["text"] for _, md in payload])
        index.upsert(namespace=NAMESPACE,
                     vectors=[{"id": rid, "values": v, "metadata": md}
                              for (rid, md), v in zip(payload, vecs)])
        print(f"  updated {min(i + 50, len(updates))}/{len(updates)}")

    time.sleep(5)
    print("final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
