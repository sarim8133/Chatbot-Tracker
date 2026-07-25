"""
Ingest a machinery brochure PDF into Pinecone 'hitech-v2', namespace 'hitech'.

WHAT THIS DOES THAT THE EARLIER PIPELINES DID NOT
-------------------------------------------------
It records what the machine IS, not only how big it is.

Script.py (v1) asked Gemini for "a 2-3 sentence summary" of the specs, which is
what made the numbers lossy. extract_specs.py (v2) fixed that by transcribing
tables verbatim -- but neither ever asked what the machine DOES. The result was a
namespace where 0 of 1888 records stated an automation level and 0 stated a blow
sub-type, so "semi automatic blow moulding machine" retrieved a machine whose own
name says Fully Automatic, and the bot happily invented the classification.

So every record here carries a MACHINE TYPE line, and it is deliberately verbose:
process family, automation level, layout, what it produces, and material. That
line is embedded along with the specs, which is what makes a functional query
("linear PET stretch blow machine") match on meaning instead of on the accident
of a model code containing the right letters.

WHERE THE TYPE COMES FROM -- AND WHERE IT DOES NOT
--------------------------------------------------
Only from the page. Three sources, always recorded so a claim can be audited:

  printed   the brochure says it in words. "Full Automatic Blow Molding Machine",
            "Use the linear type structure". Copied, not paraphrased.
  derived   no heading, but the spec rows settle it. "Preform system" + "Clamping
            force of blowing" + "Lifting H of rotary table" is an injection blow
            machine with a rotary table whether or not the page says so. The rows
            that carried the decision are stored next to the claim.
  unknown   nothing on the page supports it. The field is left EMPTY.

Never from the model code. "MG-SS4SF looks like semi-automatic stretch blow" is a
guess wearing a lab coat, and guessing is the failure this whole file exists to
undo. An empty machine_type makes the bot say it does not know; a wrong one makes
it say "semi-automatic" with total confidence to a customer.

Usage (PowerShell):
    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/add_catalogue.py --list
    & $py rag/add_catalogue.py --only Aoktac_Fully_Auto_SBM --dry-run
    & $py rag/add_catalogue.py --only Aoktac_Fully_Auto_SBM
    & $py rag/add_catalogue.py --all

--dry-run does everything except touch Supabase and Pinecone, and writes a review
table to rag/machine_type_review.md. Read that before a real run: you know the
catalogue and this script does not.
"""
import os
import re
import io
import csv
import json
import time
import base64
import hashlib
import argparse
import subprocess
import urllib.request
import urllib.error

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
NEW_DIR = os.path.join(HERE, "new catalogues")

VISION_MODEL = "gemini-2.5-flash"
EMBED_MODEL = "gemini-embedding-001"
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
BUCKET = "catalouge-images"
SUPABASE_URL = "https://oocmjiuymmvwvyvwlfpd.supabase.co"
RENDER_DPI = 150

MANIFEST = os.path.join(HERE, "catalogue_manifest.json")
REVIEW_MD = os.path.join(HERE, "machine_type_review.md")

# Poppler ships the page renderer. Both known locations on this machine.
POPPLER_CANDIDATES = [
    r"C:\Program Files\Release-25.12.0-0\poppler-25.12.0\Library\bin",
    r"C:\msys64\mingw64\bin",
    r"D:\Hi-Tech doc\python script\poppler-26.04.0\Library\bin",
]


# ── catalogue registry ────────────────────────────────────────────────────────
# folder  = storage folder + pinecone id prefix (must stay stable across re-runs)
# company = the OEM, not the dealer. HiTech resells these.
# label   = what a rep sees in an answer.
#
# "JINGYE ISBM Machine Introduction (1).pdf" is byte-identical to the copy
# without the suffix (same sha256), so only one is listed.
CATALOGUES = [
    {"folder": "Aoktac_Fully_Auto_SBM", "company": "Aoktac", "label": "Aoktac Fully-Automatic SBM",
     "pdf": "Fully Auto SBM AOK Brochure- Aoktac.pdf"},
    {"folder": "Aoktac_High_Speed_Tec_Blow", "company": "Aoktac", "label": "Aoktac High-Speed Tec Blow",
     "pdf": "High Speed Tec Blow Brochure- Aoktac(1).pdf"},
    {"folder": "JINGYE_IBM", "company": "JINGYE", "label": "JINGYE IBM",
     "pdf": "JINGYE IBM Machine Introduction.pdf"},
    {"folder": "JINGYE_ISBM", "company": "JINGYE", "label": "JINGYE ISBM",
     "pdf": "JINGYE ISBM Machine Introduction.pdf"},
    {"folder": "JINGYE_2025", "company": "JINGYE", "label": "JINGYE Catalogue 2025",
     "pdf": "JINGYE Catalogue 2025.pdf"},
    {"folder": "Tederic_NEO-T", "company": "Tederic", "label": "NEO-T (Toggle Clamp)",
     "pdf": "NEO·T Parameters Brochure _20241217_EN.pdf"},
    {"folder": "Tederic_NEO-T_Product", "company": "Tederic", "label": "NEO-T (Toggle Clamp)",
     "pdf": "NEO T.pdf"},
    {"folder": "Tederic_NEO-M", "company": "Tederic", "label": "NEO-M",
     "pdf": "NEO·M Parameters Brochure _20240410_EN.pdf"},
    {"folder": "Tederic_NEO-M_Product", "company": "Tederic", "label": "NEO-M",
     "pdf": "NEO M .pdf"},
    # FUDL is the manufacturer; HiTech resells it. The storage folder keeps its
    # original name because the image URLs are already live in Pinecone.
    {"folder": "HiTech_FUDL", "company": "FUDL", "label": "FUDL",
     "pdf": "HiTech FUDL Catalogue.pdf"},
    {"folder": "UWA_YHE_Gen5", "company": "UWA", "label": "YHE Gen 5",
     "pdf": "YHE Generation 5.pdf"},
    # The 14-page SCR booklet is a DIFFERENT file from the 5-page one already
    # ingested as "SCR Compressor" (different sha256, 9 more pages). Its models
    # will collide with the 104 existing SCR records, so --dry-run and read the
    # collision report before letting this one through.
    {"folder": "SCR_Compressor_Booklet_2", "company": "SCR", "label": "SCR Compressor",
     "pdf": "SCR Compressor_Booklet.pdf", "collision_risk": True},
]

# Not machines. The partnership A4 is corporate news and belongs in the
# 'knowledge' namespace with the other general documents, not in a namespace the
# bot searches for equipment -- see add_general_pdfs.py.
SKIP = {
    "2026 02 04 - HiTech & General Petroleum Partnership - A4.pdf":
        "corporate/partnership document, not a machine catalogue -> knowledge namespace",
    "JINGYE ISBM Machine Introduction (1).pdf":
        "byte-identical duplicate of 'JINGYE ISBM Machine Introduction.pdf'",
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
SUPABASE_KEY = _load_key("SUPABASE_SERVICE_KEY", ".supabase_key")


# ── the prompt ────────────────────────────────────────────────────────────────
# Two jobs on one page, because they need each other: the spec rows are often the
# only evidence for the type, and the type is what makes the specs findable.
PROMPT = """You are reading ONE page of a B2B plastics-machinery brochure (image supplied).

Return STRICT JSON only: an array, one object per machine model on this page.

[{
  "model_name": "<exact model designation as printed, e.g. AOK-2000, NEO-T90, HTZ 50S-IBM>",
  "machine_type": "<a DETAILED description of what this machine is and does>",
  "machine_type_source": "printed" | "derived" | "unknown",
  "machine_type_evidence": "<the exact words or spec-row labels you based it on>",
  "specs": "<every specification and number, verbatim, with units>"
}]

=== machine_type: COMPOSE IT, DO NOT COPY THE HEADING ===
This is the most important field on the page. A rep searches by what a machine
DOES, so a bare heading is close to useless.

Copying the product title is NOT acceptable on its own. The title is ONE input.
Read the WHOLE page - title, bullet points, spec-row labels, the dimension
drawings, photo captions - and COMPOSE a description carrying every dimension the
page supports:

  1. Process family - injection moulding / extrusion blow moulding / injection
     blow moulding / injection stretch blow moulding (ISBM) / stretch blow
     moulding / pipe or profile extrusion / air compressor / air dryer / material
     dryer / hopper loader / mixer / crusher / chiller / mould-temperature
     controller / robot / auxiliary
  2. Automation level - fully automatic / semi-automatic / manual
  3. Layout or clamp design - linear / rotary / shuttle / toggle-clamp /
     two-platen / all-electric / hydraulic / servo-hydraulic / single-stage /
     two-stage / preform reheat
  4. What it produces - PET bottles, jerry cans, cosmetic jars, preforms, caps,
     thin-wall containers, kegs, PVC pipe, profile, sheet - with the size range
     when the table gives one
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
"printed"  - the core process words appear on the page. A heading "Full
             Automatic Blow Molding Machine" or a bullet "Use the linear type
             structure" is printed evidence. You may still compose extra detail
             from the spec rows and keep the source as "printed".
"derived"  - the process words are NOT on the page, and the spec rows decide it.
             "Preform system" + "Clamping force of blowing" + "Lifting H of
             rotary table" is an injection blow machine with a rotary table.
             Put the exact row labels in machine_type_evidence.
"unknown"  - nothing on the page supports it. Set machine_type to "" and
             evidence to "". This is a CORRECT and useful answer.

HARD RULE: NEVER infer the type from the model code alone. "SS" in a model name
does not establish stretch blow; "A" does not establish automatic. If the only
thing suggesting a type is the model designation, the source is "unknown".
A blank field is fine. A confident wrong answer is not.

=== specs ===
1. Copy every number verbatim with its unit. Do NOT summarize, round, average or
   omit. This is transcription, not description.
2. If a screw/injection unit is offered as Type A/B/C (or several screw-diameter
   columns), include ONLY the Type B values. The company sells Type B.
3. Where one page shows two variants of a model as separate columns (e.g.
   "Standard" and "Feeding By Hand"), emit ONE object per variant and put the
   variant in the model_name.
4. Do not invent fields. Omit what is not shown.
5. English only. Translate Chinese labels, keep the numbers exactly.

=== WHAT IS NOT A MODEL ===
Return an empty array [] for covers, contents pages, factory photos and company
profiles. Also ignore page furniture: brand logos of unrelated companies, banner
slogans and website footers are NOT machine models. If a name has no
specification table anywhere on the page, do not emit an object for it.
"""


# specs sits first so the model transcribes the table before it starts writing
# prose; propertyOrdering is honoured by Gemini's structured-output decoder.
VISION_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "model_name": {"type": "STRING"},
            "specs": {"type": "STRING"},
            "machine_type": {"type": "STRING"},
            "machine_type_source": {"type": "STRING", "enum": ["printed", "derived", "unknown"]},
            "machine_type_evidence": {"type": "STRING"},
        },
        "propertyOrdering": ["model_name", "specs", "machine_type",
                             "machine_type_source", "machine_type_evidence"],
        "required": ["model_name", "specs", "machine_type",
                     "machine_type_source", "machine_type_evidence"],
    },
}


def poppler_bin(tool):
    for d in POPPLER_CANDIDATES:
        p = os.path.join(d, tool + ".exe")
        if os.path.exists(p):
            return p
    return tool  # hope it is on PATH


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")


def pinecone_id(folder, model):
    raw = f"{folder}_{slug(model)}"
    return re.sub(r"[^a-zA-Z0-9_\-]", "", raw)[:400]


def render_pages(pdf_path, out_dir, dpi=RENDER_DPI):
    os.makedirs(out_dir, exist_ok=True)
    prefix = os.path.join(out_dir, "page")
    subprocess.run([poppler_bin("pdftoppm"), "-jpeg", "-r", str(dpi), pdf_path, prefix],
                   check=True, capture_output=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("page") and f.endswith(".jpg"))
    return [os.path.join(out_dir, f) for f in files]


def _post_json(url, payload, headers, timeout=180):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _retry(fn, *a, tries=4, delay=3, **kw):
    for i in range(tries):
        try:
            return fn(*a, **kw)
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"      retry {i+1}/{tries-1}: {str(e)[:120]}")
            time.sleep(delay * (i + 1))


def vision_page(img_path):
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{VISION_MODEL}:generateContent?key={GEMINI_KEY}")
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json", "temperature": 0,
            "maxOutputTokens": 32768, "thinkingConfig": {"thinkingBudget": 0},
            # Without a schema the model answers the loudest instruction and
            # quietly omits the rest -- an early draft of the machine_type
            # section made it return every type field and NO specs at all, which
            # silently dropped 4 real machines off a page. Marking the fields
            # required makes that failure impossible rather than unlikely.
            "responseSchema": VISION_SCHEMA,
        },
    }
    data = _post_json(url, payload, {})
    try:
        raw = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return []
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", raw)
        if not m:
            return []
        try:
            out = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    return out if isinstance(out, list) else []


def embed_batch(texts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": t}]}} for t in texts]}
    data = _post_json(url, payload, {})
    return [e["values"] for e in data["embeddings"]]


def upload_image(local_path, dest_path):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{dest_path}"
    with open(local_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            r.read()
    except urllib.error.HTTPError as e:
        if e.code not in (409,):          # 409 = already there, x-upsert should stop this
            raise
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest_path}"


def build_text(company, label, model, machine_type, specs):
    """The v2 layout from extract_specs.py, plus the line this whole file is for.

    The image URL is deliberately NOT embedded -- v1 put it in the text and a URL
    contributes nothing to meaning while diluting every other token."""
    head = f"Company: {company} | Catalogue: {label} | Model Name: {model}"
    mt = f"\nMachine type: {machine_type}" if machine_type else ""
    return f"{head}{mt}\nSpecifications:\n{specs}"


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(m):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1, ensure_ascii=False)


def file_hash(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def existing_models(index):
    """Model names already live, so a new catalogue cannot silently duplicate one.

    This is not hypothetical: 294 records (15.6%) were duplicates before the
    YIJIU/MEGA/ECENG cleanup, mostly the same machine re-printed under a second
    brand label, and they crowded real answers out of the top 10."""
    seen = {}
    for page in index.list(namespace=NAMESPACE):
        # SDK 9 yields a ListResponse of ListItem(id=...), not bare strings.
        ids = [it if isinstance(it, str) else it.id for it in page]
        for i in range(0, len(ids), 100):
            got = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
            vectors = got.vectors if hasattr(got, "vectors") else got["vectors"]
            for vid, v in vectors.items():
                md = (v.metadata if hasattr(v, "metadata") else v["metadata"]) or {}
                key = re.sub(r"[^a-z0-9]", "", (md.get("model_name") or "").lower())
                if key:
                    seen.setdefault(key, []).append((vid, md.get("catalogue", "")))
    return seen


def process(cat, args, index, live_models):
    pdf = os.path.join(NEW_DIR, cat["pdf"])
    if not os.path.exists(pdf):
        print(f"  !! missing PDF: {cat['pdf']}")
        return []

    work = os.path.join(HERE, ".render", cat["folder"])
    print(f"  rendering {cat['pdf']} ...")
    pages = render_pages(pdf, work)
    print(f"  {len(pages)} page(s)")

    rows, dropped_type = [], []
    for n, img in enumerate(pages, 1):
        try:
            found = _retry(vision_page, img)
        except Exception as e:
            print(f"    page {n}: FAILED {str(e)[:100]}")
            continue
        if not found:
            print(f"    page {n}: no models")
            continue

        dest = f"{cat['folder']}/{cat['folder']}_page_{n}.jpg"
        # Retried like the Gemini calls: storage returned a one-off 400 midway
        # through a 170-page run and killed everything after it, even though the
        # very same upload succeeded on retry.
        public = (f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest}"
                  if args.dry_run else _retry(upload_image, img, dest))

        kept, dropped = 0, []
        for m in found:
            model = str(m.get("model_name") or "").strip()
            specs = str(m.get("specs") or "").strip()
            if not model or not specs:
                # Usually a cover or intro page naming a model with no table
                # behind it. Reported rather than dropped quietly, because a
                # silent drop looks identical to a page the vision call missed.
                dropped.append(model or "(unnamed)")
                continue
            key = re.sub(r"[^a-z0-9]", "", model.lower())
            mt = str(m.get("machine_type") or "").strip()
            src = str(m.get("machine_type_source") or "unknown").strip().lower()
            if src not in ("printed", "derived", "unknown"):
                src = "unknown"
            if src == "unknown":
                mt = ""                      # never keep a type we cannot source

            # Enforce the "never from the model code" rule mechanically rather
            # than trusting the prompt. If the only evidence offered is the model
            # designation itself ("RL SERIES" -> "stretch blow moulding machine"),
            # that is the exact guess this pipeline exists to prevent.
            ev_key = re.sub(r"[^a-z0-9]", "", (m.get("machine_type_evidence") or "").lower())
            if mt and ev_key and (ev_key in key or key in ev_key):
                dropped_type.append(model)
                mt, src = "", "unknown"
            rows.append({
                "id": pinecone_id(cat["folder"], model),
                "page": n, "model": model, "machine_type": mt,
                "source": src, "evidence": str(m.get("machine_type_evidence") or "").strip(),
                "specs": specs, "image_url": public,
                "company": cat["company"], "label": cat["label"],
                "collides_with": live_models.get(key, []),
            })
            kept += 1
        note = f"  (dropped {len(dropped)}: no spec table -- {', '.join(dropped[:4])})" if dropped else ""
        print(f"    page {n}: {kept} model(s){note}")

    if dropped_type:
        print(f"  blanked machine_type on {len(dropped_type)} model(s) whose only evidence was "
              f"their own model code: {', '.join(dropped_type[:5])}")

    # A model often appears on several pages -- a cover teaser AND its real
    # parameter table. Both share a Pinecone id, so without this the surviving
    # record is decided by page order: AOK-6000 was picked up off the cover with
    # a slogan as its only evidence. Keep the richest transcription instead.
    best = {}
    for r in rows:
        prev = best.get(r["id"])
        if prev is None or len(r["specs"]) > len(prev["specs"]):
            best[r["id"]] = r
    if len(best) != len(rows):
        print(f"  deduped {len(rows)} -> {len(best)} (same model on multiple pages)")
    return list(best.values())


def write_review(all_rows):
    by_cat = {}
    for r in all_rows:
        by_cat.setdefault(r["label"], []).append(r)
    n_print = sum(1 for r in all_rows if r["source"] == "printed")
    n_deriv = sum(1 for r in all_rows if r["source"] == "derived")
    n_unk = sum(1 for r in all_rows if r["source"] == "unknown")
    coll = [r for r in all_rows if r["collides_with"]]

    with open(REVIEW_MD, "w", encoding="utf-8") as f:
        f.write("# machine_type review\n\n")
        f.write("Correct anything wrong here BEFORE a non-dry run. You know the catalogue.\n\n")
        f.write(f"- **{len(all_rows)}** models across **{len(by_cat)}** catalogues\n")
        f.write(f"- machine_type source: **{n_print} printed**, **{n_deriv} derived**, "
                f"**{n_unk} unknown** (left blank on purpose)\n")
        f.write(f"- **{len(coll)}** model names already exist in the live namespace\n\n")
        if coll:
            f.write("## Collisions -- resolve before ingesting\n\n")
            f.write("| new model | catalogue | already exists as |\n|---|---|---|\n")
            for r in coll:
                where = ", ".join(f"`{i}` ({c})" for i, c in r["collides_with"][:3])
                f.write(f"| {r['model']} | {r['label']} | {where} |\n")
            f.write("\n")
        for label, rows in by_cat.items():
            f.write(f"\n## {label}\n\n")
            f.write("| p | model | machine_type | src | evidence |\n|---|---|---|---|---|\n")
            for r in sorted(rows, key=lambda x: (x["page"], x["model"])):
                mt = r["machine_type"] or "_(blank -- nothing on the page supported it)_"
                ev = (r["evidence"] or "")[:110].replace("|", "/").replace("\n", " ")
                f.write(f"| {r['page']} | {r['model']} | {mt.replace('|', '/')} | "
                        f"{r['source']} | {ev} |\n")
    print(f"\n  review table -> {REVIEW_MD}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="show the registry and exit")
    ap.add_argument("--only", help="one catalogue folder name")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--include-risky", action="store_true",
                    help="with --all, also run catalogues flagged collision_risk")
    ap.add_argument("--redo", action="store_true",
                    help="re-ingest catalogues already recorded in the manifest")
    ap.add_argument("--dry-run", action="store_true",
                    help="extract and write the review table; touch nothing remote")
    args = ap.parse_args()

    if args.list:
        print(f"{'folder':<30} {'company':<18} {'pdf'}")
        for c in CATALOGUES:
            flag = "  [COLLISION RISK]" if c.get("collision_risk") else ""
            print(f"{c['folder']:<30} {c['company']:<18} {c['pdf']}{flag}")
        print("\nskipped:")
        for k, why in SKIP.items():
            print(f"  {k}\n      {why}")
        return

    if args.all:
        # --all deliberately holds back anything flagged collision_risk. The SCR
        # booklet re-states 104 machines that are already live; ingesting it
        # blind would either duplicate them or silently overwrite records nobody
        # asked to change. Run it by name once that call has been made.
        todo = [c for c in CATALOGUES if not (c.get("collision_risk") and not args.include_risky)]
        held = [c["folder"] for c in CATALOGUES if c not in todo]
        if held:
            print(f"holding back (collision risk, run by name or --include-risky): {', '.join(held)}\n")
    else:
        todo = [c for c in CATALOGUES if c["folder"] == args.only]
    if not todo:
        raise SystemExit("Nothing selected. Use --list, --only <folder>, or --all.")

    pc = Pinecone(api_key=PINECONE_KEY)
    index = pc.Index(INDEX_NAME)

    print("reading live model names for collision detection ...")
    live_models = existing_models(index)
    print(f"  {len(live_models)} distinct model names live\n")

    manifest = load_manifest()
    all_rows = []
    failed = []
    for cat in todo:
        print(f"=== {cat['label']}  ({cat['folder']}) ===")
        if not args.redo and cat["folder"] in manifest and not args.dry_run:
            print(f"  already ingested ({manifest[cat['folder']]['records']} records) -- skipping")
            continue
        try:
            rows = process(cat, args, index, live_models)
        except Exception as e:
            # One bad catalogue must not cost the other eleven their vision calls.
            print(f"  !! {cat['folder']} FAILED: {str(e)[:160]}")
            failed.append(cat["folder"])
            continue
        all_rows.extend(rows)
        if args.dry_run or not rows:
            continue

        texts = [build_text(r["company"], r["label"], r["model"], r["machine_type"], r["specs"])
                 for r in rows]
        total = 0
        for i in range(0, len(rows), 50):
            sub, subtext = rows[i:i + 50], texts[i:i + 50]
            vecs = _retry(embed_batch, subtext)
            index.upsert(namespace=NAMESPACE, vectors=[{
                "id": r["id"], "values": v,
                "metadata": {"catalogue": r["label"], "company": r["company"],
                             "image_url": r["image_url"], "model_name": r["model"],
                             "machine_type": r["machine_type"],
                             "machine_type_source": r["source"], "text": t},
            } for r, v, t in zip(sub, vecs, subtext)])
            total += len(sub)
        print(f"  upserted {total}")
        manifest[cat["folder"]] = {"pdf": cat["pdf"], "sha256": file_hash(os.path.join(NEW_DIR, cat["pdf"])),
                                   "records": total, "at": time.strftime("%Y-%m-%d %H:%M:%S")}
        save_manifest(manifest)

    if all_rows:
        write_review(all_rows)
        with open(os.path.join(HERE, "machine_type_review.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["catalogue", "page", "model", "machine_type", "source", "evidence", "collides"])
            for r in all_rows:
                # Specs and evidence contain newlines; left raw they turn one CSV
                # record into several and every downstream count is wrong.
                flat = lambda s: " ".join(str(s or "").split())
                w.writerow([r["label"], r["page"], r["model"], flat(r["machine_type"]), r["source"],
                            flat(r["evidence"]), "; ".join(i for i, _ in r["collides_with"])])
    if failed:
        print(f"\nFAILED catalogues (re-run by name): {', '.join(failed)}")
    print("\ndone." + ("  (dry run -- nothing was written remotely)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
