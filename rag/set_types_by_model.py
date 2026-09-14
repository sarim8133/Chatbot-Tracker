"""
Set machine_type on NAMED records, one model at a time.

set_machine_types.py applies catalogue- and series-level rules ("every NEO-T is a
toggle machine"). This is the other half: auxiliaries and compressors, where one
brochure page carries several unrelated product families and the only workable
key is the record id.

Four operations, all driven by the tables below:

  DELETE  drop a whole vector. For entries that are not products at all.
  RENAME  correct a mis-transcribed model_name. The name is inside the embedded
          text AND inside the record id, so a rename is delete-then-insert, not
          an update.
  TYPES   set machine_type on an existing record, keyed by record id.
  BY_MODEL  same, but keyed by (catalogue, model_name) for records whose id is
          not obvious. Resolved against the live namespace.
  ADD     insert a model the vision pass missed entirely, copying catalogue,
          company and image_url from a named sibling on the same page.

The tables are CUMULATIVE across batches: a record already carrying the wanted
type is skipped, so re-running costs nothing and the file stays a record of every
correction made.

machine_type is part of the EMBEDDED text, not just metadata, so every change
here re-embeds the record. That is the entire reason it helps: a rep searching
"stainless steel material hopper" has to match the vector, not filter a field
nobody queries.

Source is recorded as "supplied" — a human asserted it. That is weaker provenance
than "printed" and the field says so honestly.

Usage:
    py -3 rag/set_types_by_model.py          # dry run, prints every change
    py -3 rag/set_types_by_model.py --go
"""
import os
import re
import json
import time
import argparse
import urllib.request

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
EMBED_MODEL = "gemini-embedding-001"
BACKUP_DIR = os.path.join(HERE, "backups")


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


# ── not a product ─────────────────────────────────────────────────────────────
DELETE = {
    # Huare p6. A whole-factory piping and data-acquisition SCHEME, not a machine
    # anyone can be quoted or sold. It has no model, no spec table and no type,
    # so every retrieval that surfaces it displaces a machine that could answer.
    "Huare_Central_Water_Supply_System__Data_Acquisition":
        "central water supply scheme + data acquisition, not a sellable machine",
}

# Same thing, but keyed by (catalogue, model_name) where the id is not obvious.
DELETE_BY_MODEL = {
    ("JINHU Heat-Transfer Fluid", "RS22A5200SR/AA"): "heat-transfer fluid, not a machine",
    ("JINHU Heat-Transfer Fluid", "Uranus HTP-16"): "heat-transfer fluid, not a machine",
    ("SCR Compressor", "Booster Air Compressor"): "withdrawn from the catalogue",
    ("JINGYE Catalogue 2025", "automatic double-station double-row IBM machine"):
        "withdrawn from the catalogue",
}

# ── mis-transcribed names ─────────────────────────────────────────────────────
# Huare p16 prints the Magnetic Frame series as MF-5 / MF-7 / MF-9 / MF-11. The
# vision pass read the 5 as an S. MF-7, MF-9 and MF-11 all came through correctly,
# which is what makes the odd one out obvious.
RENAME = {
    "Huare_MF-S": "MF-5",
}

# ── machine_type, keyed by record id ──────────────────────────────────────────
# Wording deliberately matches the already-typed siblings on the same page, so
# one query reaches the whole family instead of half of it.
HOPPER_DRYER = ("Combined hopper dryer and vacuum auto-loader machine for plastic granules, "
                "movable with caster frame")
MIXER = "Vertical screw plastic color mixer for granular materials, {} drying function"
MAG_FRAME = ("Magnetic frame installed at the bottom of the hopper, effectively removes "
             "ferrous impurities from raw material and prevents them entering the screw "
             "barrel; can be combined with a magnetic base. Suitable for HHD-12E, "
             "5 magnetic tubes")
AUTOLOADER = ("Dual-stage industrial vacuum auto-loader (two-stage hopper loader) with "
              "inductive motor, separate type, EUL configuration, {}")
MH_HOPPER = ("Mechanical stainless steel material hopper for plastic granules; capacity in "
             "litres is given by the number in the model name ({})")
PH_HOPPER = ("Electric eye stainless steel material hopper for plastic granules, with "
             "photoelectric level sensing; capacity in litres is given by the number in "
             "the model name ({})")

# Shangair p4 is the 中压系列 MEDIUM pressure series (3.0-4.0 MPa), three-stage,
# with low-oil-level protection as standard -- so these are LUBRICATED, not the
# oil-free machines on p10. The bare 83SH and 8ASH are SINGLE engine; only the
# 2- / 2I- / 3- prefixes are multi-unit, and "2I-" means double-deck construction
# specifically (p4 note 4), not merely two engines.
SH = ("Medium-pressure three-stage reciprocating piston air compressor, {}, "
      "{} air discharge, {} discharge pressure, {}")

TYPES = {
    # Huare p12 -- hopper dryer + loader combination
    "Huare_HLD-150E25P_EU": HOPPER_DRYER,
    "Huare_HLD-150E25P-D_EUH": HOPPER_DRYER,

    # Huare p16 -- magnetic frame (id changes with the rename, handled below)
    "Huare_MF-S": MAG_FRAME,

    # Huare p20 -- vertical screw colour mixer; the T suffix is the drying option
    "Huare_HHSL-800": MIXER.format("without"),
    "Huare_HHSL-800T": MIXER.format("with"),

    # Huare p21 -- the two largest auto-loaders in the -D family
    "Huare_HAL-5P-D_EUL": AUTOLOADER.format("4.0 kW, 700 kg/hr conveying capacity"),
    "Huare_HAL-10P-D_EUL": AUTOLOADER.format("7.5 kW, 1400 kg/hr conveying capacity"),

    # Huare p22 -- TWO families on one page. MH is mechanical, PH is electric eye.
    "Huare_MH_75L": MH_HOPPER.format("7.5 L"),
    "Huare_MH_12L": MH_HOPPER.format("12 L"),
    "Huare_MH_24L": MH_HOPPER.format("24 L"),
    "Huare_MH_36L": MH_HOPPER.format("36 L"),
    "Huare_PH_75L": PH_HOPPER.format("7.5 L"),
    "Huare_PH_12L": PH_HOPPER.format("12 L"),
    "Huare_PH_24L": PH_HOPPER.format("24 L"),
    "Huare_PH_36L": PH_HOPPER.format("36 L"),

    # Shangair p4 -- medium pressure 83SH / 8ASH series
    "Shangair_02_83SH": SH.format("single engine", "2.0 m³/min", "3.0-4.0 MPa", "22 kW"),
    "Shangair_02_2-83SH": SH.format("two-engine set", "4.0 m³/min", "3.0-4.0 MPa", "22 kW x 2"),
    "Shangair_02_2I-83SH": SH.format("two-engine double-deck set", "4.0 m³/min",
                                     "3.0-4.0 MPa", "22 kW x 2"),
    "Shangair_02_3-83SH": SH.format("three-engine set", "6.0 m³/min", "3.0-4.0 MPa", "22 kW x 3"),
    "Shangair_02_8ASH": SH.format("single engine", "3.0 m³/min", "4.0 MPa", "30 kW"),
    "Shangair_02_2I-8ASH": SH.format("two-engine double-deck set", "6.0 m³/min",
                                     "4.0 MPa", "30 kW x 2"),

    # Shangair p10 -- oil-free family (distinct from p4: no oil, electric adjustment)
    "Shangair_02_2-10WW-2109": ("Oil-free double-engine set reciprocating piston air compressor "
                                "with electric adjustment, air-cooled after-cooler and air "
                                "induction silencer filter"),
}


# ── batch 2: types supplied by Hi-Tech against rag/missing_machine_type.md ────
# Keyed by (catalogue, model_name) because these ids are not predictable.
YH_PVC_PET = ("Servo-hydraulic plastic injection moulding machine, available in specialised "
              "configurations including PVC and PET preform processing")
YH_LARGE = ("Large-tonnage plastic injection moulding machine with a double-servo hydraulic "
            "system, high-rigidity platen design and advanced computer controls")
YH_CLOUD = ("Plastic injection moulding machine with an advanced servo-hydraulic system, "
            "high-rigidity clamping unit and smart cloud-based controls")
PET_EMBRYO = "UWA PET EMBRYO Generation 5 PET preform injection moulding machine"
SOCKET = "Full automatic socket (belling) machine for plastic pipe"

BY_MODEL = {
    # JINGYE 2025
    ("JINGYE Catalogue 2025", "INJECTION-BLOW MOLDING MACHINE"):
        "Injection-blow moulding machine for making light bulbs",
    ("JINGYE Catalogue 2025", "THREE-STATION DOUBLE-ROW MOLD ISBM MACHINE MODEL"):
        "Three-station double-row mould injection stretch blow moulding (ISBM) machine",
    ("JINGYE Catalogue 2025", "THREE-STATION ISBM MACHINE"):
        "Three-station injection stretch blow moulding (ISBM) machine",
    ("JINGYE Catalogue 2025", "THREE-STATION MULTI-COLOR BOTTLE ISBM MACHINE MODEL"):
        "Three-station multi-colour bottle injection stretch blow moulding (ISBM) machine",
    ("JINGYE Catalogue 2025", "WIB-60D-G"):
        ("Injection-blow moulding machine for pharmaceutical packaging, yogurt bottles and "
         "cosmetic packaging containers"),
    ("JINGYE ISBM", "ISBM Machine"):
        "Injection stretch blow moulding (ISBM) machine",

    # UWA YH Gen 5
    ("YH Gen 5", "YH-288"): YH_PVC_PET,
    ("YH Gen 5", "YH-308"): YH_PVC_PET,
    ("YH Gen 5", "YH-358"): YH_PVC_PET,
    ("YH Gen 5", "YH-408"): YH_CLOUD,
    ("YH Gen 5", "YH-488"): YH_CLOUD,
    ("YH Gen 5", "YH-2880"): YH_LARGE,
    ("PET Gen 5", "YH 188 Gen5 PET"): PET_EMBRYO,
    ("PET Gen 5", "YH 288 Gen5 PET"): PET_EMBRYO,
    ("YE All-Electric Gen 5", "YE5-190W 430Ve/430V (B)"):
        "UWA all-electric plastic injection moulding machine",

    # Extrusion auxiliaries. HT-630 is the dual-pipe online variant -- the model
    # name says BELLING MACHINE and the supplied type says socket machine; they
    # are the same operation (forming the socket/bell on pipe end).
    ("Extrusion Auxiliaries", "Full Automatic Socket Machine Big Size"): SOCKET + ", big size",
    ("Extrusion Auxiliaries", "Full Automatic Socket Machine Big Size 630"):
        SOCKET + ", big size, up to 630 mm pipe",
    ("Extrusion Auxiliaries", "Full Automatic Socket Machine High Efficiency"):
        SOCKET + ", high-efficiency type",
    ("Extrusion Auxiliaries", "HT-630 BIG SIZE BELLING MACHINE"):
        SOCKET + ", dual-pipe online type, big size up to 630 mm",

    # misc
    ("Laser Marking", "Co2 Laser Marking Machine"):
        "CO2 laser marking machine",
    ("Laser Marking", "Fiber Laser Marking Machine"):
        "Fibre laser marking machine",
    ("FUDL", "SQ-100-1000ML"):
        ("Blow moulding machine capable of producing multi-layer plastic bottles and "
         "containers, 100-1000 ml"),
    ("JINHU (Booklet 3)", "PVC Crust Foamed Plate Production Line"):
        "PVC crust foamed plate (PVC foam board) extrusion production line",
    ("JOBO Cap Machines", "JOBO-27CS"):
        ("Plastic bottle cap folding machine, used to fold the extension part of a bottle "
         "cap's anti-theft (tamper-evident) ring inward"),
}


# ── JINHU Booklet 1: the BCF winders ─────────────────────────────────────────
# Pages 7-9 carry TEN winder models across six tables (卷绕头 = winding head, for
# BCF bulked-continuous-filament yarn). All ten are already indexed; five simply
# never got a type. Wording below copies the already-typed JHW B600G/2 and
# JHW B600SRG/2, so one query reaches the whole family.
#
# Every figure is double-confirmed: read off the brochure page image AND already
# present in the record's own stored spec table.
#
# NOTE: JHW B600/2 and JHW B920/3 already carry a DIFFERENT description -- "...
# integrating melting extrusion, metered spinning, quenching, bulking, cooling,
# mesh, and winding equipment as a complete set". That describes the whole BCF
# LINE, not the winding head its own spec table lists. Two records describe a
# line, eight describe a winder. Left alone here because changing them is a call
# for Hi-Tech, not a transcription fix.
WINDER = ("Automatic winder for BCF yarn, with {n} chucks, chuck length {L}mm, stroke length "
          "250mm, for PP, PET, PA6, winding speed {s} m/min, tube specification "
          "Φ75×Φ82×290mm, volume 14.1 dm³")
ADD = []          # nothing to add: all ten winders are already in the namespace

BY_MODEL.update({
    ("JINHU (Booklet 1)", "JHW B600SR/2"): WINDER.format(n=2, L=600, s="1000-2500"),
    ("JINHU (Booklet 1)", "JHW B600SSR/2"): WINDER.format(n=2, L=600, s="1000-2500"),
    ("JINHU (Booklet 1)", "JHW B920G/3"): WINDER.format(n=3, L=920, s="1800-3000"),
    ("JINHU (Booklet 1)", "JHW B920SR/3"): WINDER.format(n=3, L=920, s="1000-2500"),
    ("JINHU (Booklet 1)", "JHW B920SRG/3"): WINDER.format(n=3, L=920, s="1800-3000"),
})


# ── batch 3: read off the brochure pages, not supplied ───────────────────────
# A (text, source) tuple overrides the default "supplied". These were composed
# from the printed page, so they claim "printed" -- the honest label, and the one
# the comparison logic will eventually weigh.
P = "printed"

AOK_JAR = ("Fully automatic two-stage reheat PET stretch blow moulding machine for wide-mouth "
           "jars and cosmetic containers, {n} cavities, containers up to {v}, max neck diameter "
           "{d} mm, rated {o} BPH")
AOK_BOTTLE = ("Fully automatic two-stage reheat PET stretch blow moulding machine for "
              "narrow-neck bottles, {n} cavities, containers up to {v}, 38 mm max neck "
              "diameter, servo spindle drive, rated {o} BPH")
# p9 prints PE/PP/PPR/PERT. The MODEL NAMES say "PE.ABS.PVDF", which the page does
# not support -- flagged for Hi-Tech; the type follows the page, the name is left
# alone because renaming five records on an inference is not a transcription fix.
PIPE_LINE = ("Plastic pipe extrusion production line for PE/PP/PPR/PERT pipe, pipe diameter "
             "{d} mm, {e} main extruder, single-outlet die head, {ds} downstream equipment, "
             "{p} kW total power")
COILER = ("{st}-station pipe coiler (winder) for an extrusion downstream line, for pipe "
          "Ø{pd} mm, coil inner diameter {id_} mm, coil width {w} mm, winding speed {s} m/min, "
          "{t} N·m torque motor")

BY_MODEL.update({
    # Aoktac SBM p6 (JAR / wide-mouth) and p11 (narrow-neck bottles)
    ("Aoktac Fully-Automatic SBM", "AOK-2000JAR"):
        (AOK_JAR.format(n=2, v="3 L", d=130, o="1200-1600"), P),
    ("Aoktac Fully-Automatic SBM", "AOK-2000JAR-L"):
        (AOK_JAR.format(n=2, v="5 L", d=150, o="1000-1200"), P),
    ("Aoktac Fully-Automatic SBM", "AOK-4000JAR"):
        (AOK_JAR.format(n=4, v="0.5 L", d=80, o=2400), P),
    ("Aoktac Fully-Automatic SBM", "AOK-6000JAR"):
        (AOK_JAR.format(n=6, v="0.6 L", d=65, o=3800), P),
    ("Aoktac Fully-Automatic SBM", "AOK-6000"):
        (AOK_BOTTLE.format(n=6, v="1.5 L", o=6000), P),
    ("Aoktac Fully-Automatic SBM", "AOK-6000E"):
        (AOK_BOTTLE.format(n=6, v="0.6 L", o=9000), P),

    # Shangair p6 boosting series (this record is also RENAMEd below) and the two
    # p7 series headers, whose compression stage count is a printed column.
    ("Shangair Compressor", "21-35VZ-8.00/10/40"):
        ("Pressure-boosting reciprocating piston air compressor, one-stage boosting, two-engine "
         "double-deck set, 8.0 m³/min air discharge, 1.0 MPa suction pressure, 4.0 MPa discharge "
         "pressure, 18.5 kW x 2, electronic pressure adjustment", P),
    ("Shangair Compressor", "30V, 37V, 38V, 39V medium pressure series (two-stage)"):
        ("Two-stage medium-pressure reciprocating piston air compressor series (30VM, 37VM, "
         "38VM, 39VM), 0.35-0.8 m³/min air discharge, 3.0-7.0 MPa discharge pressure, "
         "7.5-11 kW motor", P),
    ("Shangair Compressor", "46W, 60W, 70W, 71W medium pressure series (three-stage)"):
        ("Three-stage medium-pressure reciprocating piston air compressor series (46WH, 60WH, "
         "70WH, 71WH), 0.4-4.4 m³/min air discharge, 5.0-10.0 MPa discharge pressure, "
         "7.5-60 kW motor", P),

    # JINHU_02 p9 pipe production lines
    ("JINHU Downstream / Extrusion",
     "JINHU GROUP PE.ABS.PVDF Pipe Production Line (Pipe Diameter 16-63mm, Main Extruder 45/33)"):
        (PIPE_LINE.format(d="16-63", e="45/33", ds="LG63", p=70), P),
    ("JINHU Downstream / Extrusion",
     "JINHU GROUP PE.ABS.PVDF Pipe Production Line (Pipe Diameter 16-63mm, Main Extruder 60/33)"):
        (PIPE_LINE.format(d="16-63", e="60/33", ds="SLG63", p=90), P),
    ("JINHU Downstream / Extrusion",
     "JINHU GROUP PE.ABS.PVDF Pipe Production Line (Pipe Diameter 75-160mm, Main Extruder 60/33)"):
        (PIPE_LINE.format(d="75-160", e="60/33", ds="LG160", p=130), P),
    ("JINHU Downstream / Extrusion",
     "JINHU GROUP PE.ABS.PVDF Pipe Production Line (Pipe Diameter 75-160mm, Main Extruder 75/33)"):
        (PIPE_LINE.format(d="75-160", e="75/33", ds="LG160", p=150), P),
    ("JINHU Downstream / Extrusion",
     "JINHU GROUP PE.ABS.PVDF Pipe Production Line (Pipe Diameter 110-250mm, Main Extruder 75/33)"):
        (PIPE_LINE.format(d="110-250", e="75/33", ds="LG250", p=225), P),

    # JINHU_02 p17 pipe coilers
    ("JINHU Downstream / Extrusion", "SP-110 single station"):
        (COILER.format(st="Single", pd="63-110", id_="2500-3500", w=700, s="0.5-5", t=40), P),
    ("JINHU Downstream / Extrusion", "SPS-32 double stations"):
        (COILER.format(st="Double", pd="16-32", id_="480-800", w="200-370", s="1-20", t=10), P),
    ("JINHU Downstream / Extrusion", "SPS-63 double stations"):
        (COILER.format(st="Double", pd="32-63", id_="600-1200", w="360-560", s="1-20", t=25), P),

    # JINHU_01 p10 FDY line
    ("JINHU (Booklet 1)", "Polypropylene Fiber Filature And Drafting (FDY) Machine JHM65/28"):
        ("Polypropylene (PP) fibre filature and drafting (FDY, fully-drawn-yarn) spinning line: "
         "JHM65/28 extruder, 15 kW, max output 1.3 t/d; spinning beam with 4 packages per "
         "position and Φ100 mm spinneret plate; side-blow quench chamber, 45 kW refrigerating "
         "output, 1500 mm quench height; 8-godet drawing system; finish system; JHW435 winding "
         "system up to 2500 m/min", P),
})

# Shangair p6 prints "2I-" (the double-deck marker used throughout this brochure,
# see p4 note 4). The vision pass read the letter I as a digit 1.
#
# The id is given explicitly because this catalogue DELETES dots and slashes
# rather than replacing them ("2-10WW-2.10/9" -> Shangair_02_2-10WW-2109), which
# the generic derivation cannot infer.
RENAME["Shangair_02_21-35VZ-8001040"] = ("2I-35VZ-8.00/10/40", "Shangair_02_2I-35VZ-8001040")

DELETE_BY_MODEL.update({
    # Aoktac "High-Speed Tec Blow" p3 is a DEVELOPMENT HISTORY timeline: 2004,
    # 2008, 2012, 2016 ... Each milestone was captured as if it were a sellable
    # model. They have no spec table and no model code, and retrieving a company
    # anniversary when a rep asks for a blow moulder is worse than finding nothing.
    ("Aoktac High-Speed Tec Blow", "4-cavity 5L automatic blow molding machine"):
        "development-history milestone (2012), not a model",
    ("Aoktac High-Speed Tec Blow", "4-cavity servo-driven automatic wide-mouth blow molding machine"):
        "development-history milestone (2008), not a model",
    ("Aoktac High-Speed Tec Blow", "6-cavity servo-driven automatic blow molding machine"):
        "development-history milestone (2010), not a model",
    ("Aoktac High-Speed Tec Blow", "6/8/10-cavity monobloc system"):
        "development-history milestone (2019-2025), not a model",
    ("Aoktac High-Speed Tec Blow", "TEC BLOW 8/10/12-cavity fully electric blow molding machine"):
        "development-history milestone (2016), not a model",
    ("Aoktac High-Speed Tec Blow", "TEC BLOW RL-4 fully electric blow molding machine"):
        "development-history milestone (2014), not a model",

    # JINHU_01 p12 lists JH25...JH200 -- nineteen models, and JH100 is NOT among
    # them. The namespace holds twenty. This one was never on the page.
    ("JINHU (Booklet 1)", "JH100 Chemical Fiber Spinning Extruder"):
        "not present on p12; the printed table runs JH25-JH200 with no JH100",

    # JINHU_02 p26 is a "Standard 标准" page of pipe dimension/weight tables
    # (PE80, PE100, PVC-U, PVC). Reference data about PIPE, not equipment -- it
    # belongs in the 'knowledge' namespace if anywhere.
    ("JINHU Downstream / Extrusion", "PVC Pipe for water Supply (ISO4422-2:1996)"):
        "pipe dimension standard, not a machine",
})


def embed_batch(texts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": t}]}} for t in texts]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return [e["values"] for e in json.loads(r.read())["embeddings"]]


def rewrite_text(text, new_type=None, old_model=None, new_model=None):
    """Patch the embedded text. A metadata-only edit would leave the vector still
    saying the old thing, which is the failure this script exists to avoid."""
    lines = (text or "").split("\n")
    if new_model and lines:
        lines[0] = re.sub(r"(Model Name:\s*).*$", lambda m: m.group(1) + new_model, lines[0])
    if new_type:
        for i, ln in enumerate(lines):
            if ln.startswith("Machine type:"):
                lines[i] = f"Machine type: {new_type}"
                break
        else:
            if lines:
                lines.insert(1, f"Machine type: {new_type}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="apply; otherwise dry run")
    args = ap.parse_args()

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)

    # Scan once: BY_MODEL, DELETE_BY_MODEL and ADD's sibling lookup all need to
    # resolve (catalogue, model_name) -> id against the live namespace.
    print("scanning namespace ...")
    live = {}
    for page in index.list(namespace=NAMESPACE):
        ids = [it if isinstance(it, str) else it.id for it in page]
        for i in range(0, len(ids), 100):
            g = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
            for vid, v in (g.vectors if hasattr(g, "vectors") else g["vectors"]).items():
                md = dict(v.metadata or {})
                live[(md.get("catalogue"), md.get("model_name"))] = (vid, md)
    print(f"  {len(live)} records")

    def resolve(pairs, what, strict):
        """(catalogue, model) -> id. `strict` fails on a miss; non-strict treats a
        miss as work a previous run already did, which is what makes the tables
        cumulative. Types are strict: a mistyped model name that silently does
        nothing is exactly the failure a review table cannot catch."""
        out, gone = {}, []
        for k in pairs:
            if k in live:
                out[live[k][0]] = pairs[k]
            else:
                gone.append(k)
        if gone and strict:
            raise SystemExit(f"{what}: not found in the namespace:\n  " +
                             "\n  ".join(f"{c} :: {m}" for c, m in gone))
        if gone:
            print(f"  {what}: {len(gone)} already applied in an earlier run")
        return out

    types_all = dict(TYPES)
    types_all.update(resolve(BY_MODEL, "BY_MODEL", strict=True))
    delete_all = dict(DELETE)
    delete_all.update(resolve(DELETE_BY_MODEL, "DELETE_BY_MODEL", strict=False))

    want = sorted(set(types_all) | set(delete_all) | set(RENAME))
    got = index.fetch(ids=want, namespace=NAMESPACE)
    vectors = got.vectors if hasattr(got, "vectors") else got["vectors"]
    # ids gone from the namespace are earlier batches already applied (a deleted
    # vector, or a record that has since been renamed away from this id)
    done_before = [i for i in want if i not in vectors]
    if done_before:
        print(f"  {len(done_before)} id(s) already applied in an earlier run")
        for d in done_before:
            types_all.pop(d, None)
            delete_all.pop(d, None)

    backup = {vid: dict(v.metadata or {}) for vid, v in vectors.items()}

    plan, already = [], 0
    for vid in sorted(types_all):
        md = dict(vectors[vid].metadata or {})
        # a value may be plain text (defaults to "supplied") or (text, source)
        want = types_all[vid]
        want, src = want if isinstance(want, tuple) else (want, "supplied")
        # cumulative tables: skip what is already right, so a re-run is free
        if md.get("machine_type") == want and vid not in RENAME:
            already += 1
            continue
        # a RENAME value is either a new model name, or (new_model, explicit_id)
        ren = RENAME.get(vid)
        forced_id = None
        if isinstance(ren, tuple):
            ren, forced_id = ren
        new_model = ren
        old_model = md.get("model_name", "")
        new_text = rewrite_text(md.get("text", ""), want, old_model, new_model)
        new_id = vid
        if new_model and forced_id:
            new_id = forced_id
        elif new_model:
            # Derive the new id by swapping the model part of the OLD id, so the
            # record keeps its family's id style. Building it fresh from a slug
            # would drop the hyphen and file MF-5 as Huare_MF_5 while its
            # siblings stay Huare_MF-7 / MF-9 / MF-11.
            tail = re.sub(r"[^A-Za-z0-9_\-]+", "_", old_model)
            new_tail = re.sub(r"[^A-Za-z0-9_\-]+", "_", new_model)
            if tail and vid.endswith(tail):
                new_id = vid[: -len(tail)] + new_tail
            else:
                new_id = f"{vid.rsplit('_', 1)[0]}_{new_tail}"
        plan.append({"old_id": vid, "new_id": new_id, "old_model": old_model,
                     "new_model": new_model or old_model, "type": want, "source": src,
                     "metadata": md, "text": new_text})

    # new records, built from a sibling on the same brochure page
    adds = []
    for a in ADD:
        if (a["catalogue"], a["model"]) in live:
            print(f"  ADD skipped, already present: {a['model']}")
            continue
        sib_key = (a["catalogue"], a["sibling"])
        if sib_key not in live:
            raise SystemExit(f"ADD sibling not found: {a['catalogue']} :: {a['sibling']}")
        sid, smd = live[sib_key]
        tail = re.sub(r"[^A-Za-z0-9_\-]+", "_", a["sibling"])
        prefix = sid[: -len(tail)] if tail and sid.endswith(tail) else sid.rsplit("_", 1)[0] + "_"
        new_id = prefix + re.sub(r"[^A-Za-z0-9_\-]+", "_", a["model"])
        text = (f"Company: {smd.get('company')} | Catalogue: {a['catalogue']} | "
                f"Model Name: {a['model']}\nMachine type: {a['type']}\n"
                f"Specifications:\n{a['specs']}")
        adds.append({"id": new_id, "model": a["model"], "text": text, "type": a["type"],
                     "metadata": {"catalogue": a["catalogue"], "company": smd.get("company"),
                                  "image_url": smd.get("image_url"), "model_name": a["model"],
                                  "machine_type": a["type"],
                                  "machine_type_source": "printed", "text": text}})

    print(f"=== DELETE ({len(delete_all)})")
    for vid, why in delete_all.items():
        print(f"  {vid}\n      {backup[vid].get('model_name')}  -- {why}")

    print(f"\n=== ADD ({len(adds)})")
    for a in adds:
        print(f"  {a['model']:<16} id={a['id']}\n      {a['type'][:100]}")

    renames = [p for p in plan if p["old_id"] != p["new_id"]]
    print(f"\n=== RENAME ({len(renames)})")
    for p in renames:
        print(f"  {p['old_model']!r} -> {p['new_model']!r}   id {p['old_id']} -> {p['new_id']}")

    print(f"\n=== SET machine_type ({len(plan)}"
          + (f", {already} already correct and skipped" if already else "") + ")")
    for p in plan:
        print(f"  {p['new_model']:<22} {p['type'][:96]}")

    if not args.go:
        print("\nDRY RUN -- nothing written. Re-run with --go to apply.")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    bpath = os.path.join(BACKUP_DIR,
                         f"machine_type-by-model-{time.strftime('%Y-%m-%d')}.json")
    with open(bpath, "w", encoding="utf-8") as f:
        json.dump(backup, f, ensure_ascii=False, indent=1)
    print(f"\nbackup -> {bpath}")

    if delete_all:
        index.delete(ids=list(delete_all), namespace=NAMESPACE)
        print(f"deleted {len(delete_all)} vector(s)")

    if plan:
        vecs = embed_batch([p["text"] for p in plan])
        index.upsert(namespace=NAMESPACE, vectors=[{
            "id": p["new_id"], "values": v,
            "metadata": {**p["metadata"],
                         "model_name": p["new_model"],
                         "machine_type": p["type"],
                         "machine_type_source": p["source"],
                         "text": p["text"]},
        } for p, v in zip(plan, vecs)])
        print(f"upserted {len(plan)} record(s)")

    if adds:
        vecs = embed_batch([a["text"] for a in adds])
        index.upsert(namespace=NAMESPACE, vectors=[
            {"id": a["id"], "values": v, "metadata": a["metadata"]}
            for a, v in zip(adds, vecs)])
        print(f"added {len(adds)} new record(s)")

    stale = [p["old_id"] for p in plan if p["old_id"] != p["new_id"]]
    if stale:
        index.delete(ids=stale, namespace=NAMESPACE)
        print(f"removed {len(stale)} renamed-away id(s): {', '.join(stale)}")


if __name__ == "__main__":
    main()
