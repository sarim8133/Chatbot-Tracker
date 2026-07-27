"""Ingest ONE machine -- the HT-880 -- from a sales proposal, into hitech-v2/hitech.

WHY THIS IS NOT add_catalogue.py
--------------------------------
The source is a 14-page SALES PROPOSAL, not a brochure, and only one page of it
is catalogue material. add_catalogue.py OCRs every page and ingests every machine
it finds, which here would pull in four things that must never reach the bot:

  Annexure 1 (p3)  prices -- $5,290 / PKR 1,829,815 -- for a four-item BUNDLE,
                   explicitly valid for one week from 8 July 2025. A price in a
                   vector index has no expiry date and would be quoted as current
                   long after it stopped being true.
  page 2           a named customer (Dr. Usman) and a rep's mobile number. This
                   is somebody's personal data; it is not machine data.
  Annexure 5,6,7   the Shangair compressor, the air dryer and the filter. Real
                   machines, but they are the accessories bundled with THIS quote,
                   and the instruction was the HT-880 table only.
  Annexure 4,8     free spare parts and a customer-reference blurb.

So this file transcribes the two tables that describe the machine itself --
Annexure 2 (p5, technical specifications) and Annexure 3 (p6, machine
configurations) -- into ONE record. One machine, one vector: splitting them would
put two records under the same model_name, which is exactly the record-pair the
system prompt's de-duplication rule has to work around, and there is no reason to
create that problem when the tables are two views of one machine.

THE MODEL IS HT-880, NOT HT-88
------------------------------
The filename says "HT-88". Every page inside says HT-880: the cover, the annexure
headings, the contents page. The catalogue's spelling wins, the same rule §6 of
the system prompt applies to the bot.

WHY THE SPECS ARE TYPED OUT HERE RATHER THAN OCR'd BY A MODEL
-------------------------------------------------------------
One table, read directly off the page. Putting the literal text in source makes
it reviewable and diffable by someone who knows the catalogue -- which is the
whole lesson of hitech_manifest.json, where a summarising model quietly dropped
fields and nobody could see what had gone.

Usage (PowerShell):
    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/add_ht880.py --dry-run
    & $py rag/add_ht880.py --go
"""
import os
import re
import json
import time
import argparse
import subprocess
import urllib.request
import urllib.error

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
NEW_DIR = os.path.join(HERE, "new catalogues")
PDF = os.path.join(NEW_DIR, "Sales Proposal of Semi Automatic Pet blow HT-88.pdf")

INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
BUCKET = "catalouge-images"
SUPABASE_URL = "https://oocmjiuymmvwvyvwlfpd.supabase.co"
EMBED_MODEL = "gemini-embedding-001"
RENDER_DPI = 150

FOLDER = "HiTech_HT880"
COMPANY = "HiTech"
LABEL = "HT-880 Semi-Automatic PET Blow"
MODEL = "HT-880"
IMAGE_PAGE = 1          # the machine photo; the specs come from page 5

POPPLER_CANDIDATES = [
    r"C:\Program Files\poppler\Library\bin",
    r"C:\Program Files\poppler-24.08.0\Library\bin",
    r"C:\poppler\Library\bin",
]

# ── the table, verbatim from page 5 ──────────────────────────────────────────
# All 18 printed rows are here. Every VALUE is exactly as printed -- including
# "0.5ml" where the page plainly means 0.5 L, and the 8~10C temperature range.
# Three structural changes, all of them flattening, none of them rewording:
#
#   Output   one printed cell holding two lines becomes two rows, so the 600-1200
#            BPH figure stays attached to the 0.5ml-2.5L range it belongs to.
#   Cavity   same: "2 Cavity: 0.5ml - 2.5L / 1 Cavity: 3L - 6L" becomes two rows.
#   Weight   printed twice as a bare "Weight". On the page the layout says which
#            is which -- one sits under Blower Dimension, one under Heater
#            Dimension -- but a flat key:value list loses that, and two identical
#            keys would have the bot answer "650Kg" for a question about the
#            heater. The printed label is kept, the owning unit added in brackets.
SPECS = """Output (0.5ml - 2.5L): 600-1200 [BPH]
Output (5L - 6L): 350-400 [BPH]
Volume: 0.5ml - 6L
Max-Bottle Body Diameter: 180 [mm]
Max Bottle Height: 450 [mm]
Max Bottle Neck Diameter: 120 [mm]
Cavity (0.5ml - 2.5L): 2
Cavity (3L - 6L): 1
Mold Thickness: 180~240 [mm]
Max. Stretching Distance: 350*400 [mm]
Power Voltage: 3Phase 380V/50HZ
Rated Power: 17 [kw]
Lamp Power: 16 [kw]
High Pressure Air Compressor: 1.2m3/Min 3.0mpa
Air Dryer: 1.6m3/Min 3.0mpa
Temperature Range: 8~10 [C]
Blower Dimension (LxWxH): 1900*700*1980 [mm]
Weight (Blower): 650 [Kg]
Heater Dimension (LxWxH): 1800*720*1800 [mm]
Weight (Heater): 350 [Kg]"""

# ── Annexure 3, page 6: "Machine Configurations" ─────────────────────────────
# Component makes, not measurements, which is why they sit in their own block
# rather than being mixed into Specifications -- a rep asking "what PLC does the
# HT-880 use" and a rep asking "what's the clamping force" want different halves
# of this record, and keeping them labelled stops the brand names reading like
# specs.
#
# The left-hand column of the printed table is a group label spanning several
# rows; it is folded into each line so every line stands on its own. Transcribed
# as printed, including "Temperature Controller" being grouped under Valves --
# which is odd, since it is not a valve, but the page says what it says and this
# is not the place to correct the manufacturer.
CONFIG = """Electrical Components / PLC: DELTA
Electrical Components / Circuit Breaker Of Blower: Zhengtai
Electrical Components / Start Button: Schneider
Electrical Components / Scram Button: Schneider
Electrical Components / Power Supply: DELTA
Electrical Components / Temperature Control Module: Zhenyu
Electrical Components / Pressure Regulator: Zhenyu
Valves / Temperature Controller: Zhenyu
Valves / High Pressure Blowing Valve: MINGGE China Brand
Valves / High Pressure Exhaust Valve: MINGGE China Brand
Valves / Low Pressure Muffler: Tuoen China Brand
Valves / High Pressure Muffler: Tuoen China Brand
Cylinders / Clamping Cylinder: Yongcheng
Cylinders / Stretching Cylinder: Yongcheng
Air Filtration / Low Pressure Press-Regulating Valve: Airtac
Air Filtration / Low Pressure Lubricator: Airtac"""

# Printed, not inferred: "Semi-Automatic Pet Stretch Blow Molding Machine" on the
# cover, "Semi-Automatic Blow Molding Machine HT-880" on this annexure heading and
# on the price summary. The two-stage reading is derived and the evidence is in
# the table itself -- a separate Heater unit with its own dimensions and 16 kW of
# lamp power is a reheat oven, which is what makes this two-stage rather than
# injection-blow.
MACHINE_TYPE = ("Semi-automatic PET stretch blow moulding machine (two-stage reheat stretch blow, "
                "separate heater and blower units, manual preform loading, 1-2 cavities) for blowing "
                "PET bottles and containers from 0.5 ml to 6 L")
MACHINE_TYPE_SOURCE = "printed"


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


def poppler_bin(tool):
    for d in POPPLER_CANDIDATES:
        p = os.path.join(d, tool + ".exe")
        if os.path.exists(p):
            return p
    return tool


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")


def build_text():
    """Same layout as add_catalogue.py:build_text -- one namespace, one shape.

    Configuration is appended as its own labelled block. The header/type/
    Specifications prefix is byte-identical to every other record in the
    namespace, so nothing downstream that keys on "Specifications:" cares that
    this record carries an extra section."""
    head = f"Company: {COMPANY} | Catalogue: {LABEL} | Model Name: {MODEL}"
    return (f"{head}\nMachine type: {MACHINE_TYPE}\nSpecifications:\n{SPECS}"
            f"\nConfiguration (component makes):\n{CONFIG}")


def render_page(n, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    prefix = os.path.join(out_dir, "page")
    subprocess.run([poppler_bin("pdftoppm"), "-jpeg", "-r", str(RENDER_DPI),
                    "-f", str(n), "-l", str(n), PDF, prefix],
                   check=True, capture_output=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("page") and f.endswith(".jpg"))
    if not files:
        raise SystemExit("pdftoppm produced no image -- is poppler installed?")
    return os.path.join(out_dir, files[0])


def upload_image(local_path, dest_path, key):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{dest_path}"
    with open(local_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {key}", "apikey": key,
        "Content-Type": "image/jpeg", "x-upsert": "true",
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            r.read()
    except urllib.error.HTTPError as e:
        if e.code not in (409,):
            raise
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest_path}"


def embed(text, key):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={key}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": text}]}}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())["embeddings"][0]["values"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print the record, touch nothing")
    ap.add_argument("--go", action="store_true", help="upload the image and upsert")
    args = ap.parse_args()
    if not (args.dry_run or args.go):
        raise SystemExit("pass --dry-run or --go")

    if not os.path.exists(PDF):
        raise SystemExit(f"missing PDF: {PDF}")

    rec_id = re.sub(r"[^a-zA-Z0-9_\-]", "", f"{FOLDER}_{slug(MODEL)}")[:400]
    text = build_text()
    dest = f"{FOLDER}/{FOLDER}_page_{IMAGE_PAGE}.jpg"
    image_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest}"

    print(f"id         : {rec_id}")
    print(f"company    : {COMPANY}")
    print(f"catalogue  : {LABEL}")
    print(f"model_name : {MODEL}")
    print(f"image_url  : {image_url}")
    print(f"type source: {MACHINE_TYPE_SOURCE}")
    print(f"\n--- embedded text ({len(text)} chars) ---\n{text}\n--- end ---\n")

    if args.dry_run:
        print("dry run -- nothing written.")
        return

    pkey = _load_key("PINECONE_API_KEY", ".pinecone_key")
    gkey = _load_key("GEMINI_API_KEY", ".gemini_key")
    skey = _load_key("SUPABASE_SERVICE_KEY", ".supabase_key")

    pc = Pinecone(api_key=pkey)
    index = pc.Index(INDEX_NAME)

    # Nothing here overwrites an existing record silently: if this id is already
    # present, keep a copy of what it held before the upsert.
    existing = index.fetch(ids=[rec_id], namespace=NAMESPACE)
    if existing.vectors:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path = os.path.join(HERE, "backups", f"ht880-preupsert-{stamp}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({k: v.metadata for k, v in existing.vectors.items()}, f,
                      indent=1, ensure_ascii=False)
        print(f"existing record backed up -> {path}")

    # Inside .render/ because that whole tree is already gitignored as rebuildable
    # pdftoppm scratch; the subdirectory keeps it from colliding with the page
    # renders add_catalogue.py drops there.
    out_dir = os.path.join(HERE, ".render", "ht880")
    img = render_page(IMAGE_PAGE, out_dir)
    image_url = upload_image(img, dest, skey)
    print(f"image uploaded -> {image_url}")

    vec = embed(text, gkey)
    print(f"embedded: dim {len(vec)}")

    index.upsert(namespace=NAMESPACE, vectors=[{
        "id": rec_id, "values": vec,
        "metadata": {"catalogue": LABEL, "company": COMPANY, "image_url": image_url,
                     "model_name": MODEL, "machine_type": MACHINE_TYPE,
                     "machine_type_source": MACHINE_TYPE_SOURCE, "text": text},
    }])
    print(f"upserted 1 record into {INDEX_NAME}/{NAMESPACE}")

    man_path = os.path.join(HERE, "catalogue_manifest.json")
    man = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {}
    man[FOLDER] = {"pdf": os.path.basename(PDF), "records": 1,
                   "note": "HT-880 spec table only (Annexure 2, p5); prices, "
                           "customer data and the bundled compressor/dryer/filter "
                           "deliberately excluded",
                   "at": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(man_path, "w", encoding="utf-8") as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
    print("manifest updated.")


if __name__ == "__main__":
    main()
