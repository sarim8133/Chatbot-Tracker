"""
Ingest a COMPETITOR brochure PDF into Pinecone 'hitech-v2', namespace 'competitor'.

Phase 1 of rag/DG TECH competetion/COMPETITOR_COMPARISON_PLAN.md. Pilot brand is
SOUND (two-platen series) -- one brand, proven end to end, before the other seven.

This is add_catalogue.py's pipeline (poppler render -> Gemini Vision verbatim
transcription -> embed -> upsert) with four deliberate divergences. Each one
exists because a competitor record is read under different rules than ours.

1. THE TEXT SAYS IT IS A COMPETITOR, IN THE EMBEDDING ITSELF.
   Metadata alone is not enough. n8n hands the agent the `text` field, so a record
   that only carries owner="competitor" in metadata can reach the model looking
   exactly like a HiTech machine -- and the worst failure this whole feature can
   produce is the bot recommending a competitor's machine to our customer as ours.
   Every text therefore opens "COMPETITOR MACHINE (NOT SOLD BY HiTech)". It costs
   a few tokens of embedding and makes that failure impossible rather than
   unlikely.

2. THE TYPE A/B/C RULE IS REMOVED.
   add_catalogue.py keeps only Type B injection units because HiTech sells only
   Type B. That is OUR commercial convention, not the competitor's specification.
   Dropping their Type A and C columns would be shaving a competitor's published
   numbers -- exactly what the plan's one rule forbids -- and would understate or
   overstate their range depending on which column we kept. So every screw variant
   the brochure prints is transcribed, one record per variant, with the screw
   diameter in the model name. Comparison then picks the variant nearest ours and
   says which one it used.

3. THE RIVAL DEALER IS NAMED, AND THERE IS NO "UNVERIFIED" CAVEAT.
   DG Tech is the competing DEALER; SOUND, LS, TUP and the rest are the OEM
   brands it carries -- the same shape as HiTech reselling Tederic and UWA. Both
   are recorded, and both are in the embedded text, so "what does DG Tech sell"
   retrieves as well as "SOUND DP-2800".

   An earlier version stamped verified=False and had the text say the figures
   were "not independently verified". That caveat is gone: Sarim checked the
   transcription against the brochure, so the label was simply untrue, and a bot
   that volunteers doubt about numbers a human confirmed just undermines the rep
   holding them.

4. COLLISION CHECK RUNS AGAINST THE 'hitech' NAMESPACE, NOT ITS OWN.
   A model name that exists on both sides is either a rebadge of the same OEM
   machine or a transcription error, and both need a human before they go live --
   a comparison of a machine against itself is worse than no comparison.

WHAT IS NOT NORMALIZED, ON PURPOSE.
Specs stay as transcribed lines; they are not mapped into a fixed field set. The
comparison basis is "the intersection of what both brochures state", so the axes
have to be discovered from the two retrieved records at query time. Hardcoding
injection-moulding axes here would silently define the table for compressors and
blow moulders too, which have entirely different dimensions.

Usage (PowerShell):
    py -3 rag/add_competitor.py --list
    py -3 rag/add_competitor.py --only SOUND_DP_Two_Platen --dry-run
    py -3 rag/add_competitor.py --only SOUND_DP_Two_Platen

--dry-run does the rendering and the vision extraction and writes
rag/competitor_review.md, but touches neither Supabase nor Pinecone. Read that
review before a real run -- it is the only point where a human sees the numbers
before a rep does.
"""
import os
import re
import json
import time
import base64
import hashlib
import argparse
import subprocess
import urllib.request
import urllib.error
from collections import Counter

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "DG TECH competetion")

VISION_MODEL = "gemini-2.5-flash"
EMBED_MODEL = "gemini-embedding-001"
INDEX_NAME = "hitech-v2"
NAMESPACE = "competitor"          # third namespace: hitech | knowledge | competitor
HITECH_NAMESPACE = "hitech"       # read-only here, for collision detection
BUCKET = "catalouge-images"
SUPABASE_URL = "https://oocmjiuymmvwvyvwlfpd.supabase.co"
RENDER_DPI = 150

MANIFEST = os.path.join(HERE, "competitor_manifest.json")
REVIEW_MD = os.path.join(HERE, "competitor_review.md")

# The rival DEALER. Every brand in this folder is sold in Pakistan by DG Tech,
# which is the company HiTech actually loses deals to -- the OEM brand is what a
# customer names, but DG Tech is who they are buying from.
COMPETITOR_COMPANY = "DG Tech"

POPPLER_CANDIDATES = [
    r"C:\Program Files\Release-25.12.0-0\poppler-25.12.0\Library\bin",
    r"C:\msys64\mingw64\bin",
    r"D:\Hi-Tech doc\python script\poppler-26.04.0\Library\bin",
]

# ── competitor registry ───────────────────────────────────────────────────────
# folder     = storage folder + pinecone id prefix (must stay stable across re-runs)
# brand      = the competitor OEM, as a customer would say it
# label      = what a rep sees as the source in an answer
# source_doc = the brochure name + revision, verbatim. This is the provenance a
#              rep quotes when a customer challenges a number, so it must name a
#              document that actually exists rather than our filename for it.
#
# series_type is the CLAMP DESIGN, and it exists because the comparison TYPE gate
# needs it while the page that states it is never the page with the table. This
# brochure is the normal case: the parameter table (p3) says only "injection
# moulding machine", and the evidence that it is a two-platen sits on p1 and p2.
# Per-page extraction structurally cannot see across that gap, so the series-level
# fact is asserted once, here, WITH the evidence that supports it -- and it is
# marked "derived", not "printed", because the brochure never prints the English
# words "two platen" anywhere. It positions the series AGAINST three-platen
# machines, which is a different and weaker claim. Read series_type_evidence and
# confirm it before a real run.
COMPETITORS = [
    {"folder": "SOUND_DP_Two_Platen", "brand": "SOUND", "label": "SOUND DP Two-Platen Series",
     "pdf": "SOUND-DP-Two-Platen-Series.pdf",
     "source_doc": "SOUND DP Two-Platen Series brochure (Zhejiang Sound Machinery)",
     "series_type": "Two-platen hydraulic injection moulding machine for large "
                    "logistics and material-handling mouldings, 21000-31000 kN "
                    "(2100-3100 T) clamping force",
     "series_type_source": "derived",
     "series_type_evidence": "p1 title 'DP 2100-3100T / 全新物流专用注塑机' (new "
                             "logistics-dedicated injection moulding machine); p2 "
                             "'相对于三板机, 机台占地面积小' positions the series against "
                             "THREE-platen machines; p3 clamping table lists "
                             "DPL2100-DPL3100 at 21000-31000 KN",
     },
    # The remaining DG Tech brands. Registered WITHOUT a series_type on purpose:
    # that field exists to paper over a spec page that never states the clamp
    # design, and asserting one before reading the dry run would be inventing the
    # very fact the pipeline is supposed to source. Add it per brand only where
    # the review shows a thin or blank machine_type.
    {"folder": "SOUND_UN_Standard", "brand": "SOUND", "label": "SOUND UN Standard Series",
     "pdf": "SOUND-UN-Standard-Series.pdf",
     "source_doc": "SOUND UN Standard Series brochure (Zhejiang Sound Machinery)"},
    {"folder": "LS_Thin_Wall_IMM", "brand": "LS", "label": "LS Thin-Wall Injection",
     "pdf": "LS-Thin-wall-IMM.pdf",
     "source_doc": "LS Thin-wall Injection Moulding Machine brochure"},
    {"folder": "TUP_Two_Colour", "brand": "TUP", "label": "TUP Two-Colour Solution",
     "pdf": "TUP-Two-Colour-Solution.pdf",
     "source_doc": "TUP Two-Colour Solution brochure"},
    {"folder": "OUGE_PET_Blow", "brand": "OUGE", "label": "OUGE PET Blow",
     "pdf": "OUGE-PET-Blow-Machines.pdf",
     "source_doc": "OUGE PET Blow Machines brochure"},
    {"folder": "Victor_2026", "brand": "Victor", "label": "Victor Catalogue 2026",
     "pdf": "Victor-catalogue-2026.pdf",
     "source_doc": "Victor 2026 catalogue"},
    {"folder": "SML_Auxiliaries", "brand": "SML", "label": "SML Auxiliaries",
     "pdf": "SML-Auxiliaries.pdf",
     "source_doc": "SML Auxiliaries brochure"},
    {"folder": "MINFENG_Cap", "brand": "MINFENG", "label": "MINFENG Cap Machinery",
     "pdf": "MINFENG-Cap-Machinery.pdf",
     "source_doc": "MINFENG Cap Machinery brochure"},
    # A MANUAL, not a spec brochure. Kept in the registry so the dry run says what
    # it actually contains rather than leaving it an open question; expect few or
    # no records with a real parameter table.
    {"folder": "Chi_Wai_Manual", "brand": "Chi-Wai", "label": "Chi-Wai",
     "pdf": "Chi-Wai_Manual.pdf",
     "source_doc": "Chi-Wai machine manual"},

    # ── the UN range, moulding something other than PS ────────────────────────
    # These two are NOT re-runs of SOUND_UN_Standard, which is the first thing
    # anyone will assume when they see UN180-EPIII appear a second time. They are
    # the same clamping units carrying DIFFERENT injection units, because SOUND
    # sells the UN range with a material-matched screw:
    #
    #                    screw   L:D   shot vol   plasticizing   max rpm   pump
    #   UN180 standard    45mm  20.0    358 cm3     24.8 g/s      220     18 kW
    #   UN180 UPVC        45mm  20.0    358 cm3     31.6 g/s      200     18 kW
    #   UN180 PET         53mm  24.0    496 cm3     53.6 g/s      180     22 kW
    #
    # Same clamp, three different machines to quote. The PET table's screws
    # (53-95mm) do not appear anywhere in the standard brochure's options, and its
    # 24:1 L:D is the PET barrel; the UPVC table keeps the standard screw and
    # de-rates the speed, which is what a shear-sensitive material needs. Skipping
    # these as duplicates would leave the bot answering PVC and PET enquiries with
    # polystyrene throughput.
    #
    # model_suffix is load-bearing here -- see apply_model_suffix.
    {"folder": "SOUND_UN_PVC", "brand": "SOUND", "label": "SOUND UN Series — UPVC/PVC Parameters",
     "pdf": "SOUND-UN-PVC-Parameters.pdf",
     "model_suffix": "UPVC/PVC configuration",
     "require_specs": {"screw diameter": {
         "present": r"screw (?:diameter|spec)",
         "recover": r"螺杆直径\s*(?:Screw[^\n]*)?\n?\s*mm\s+(\d+(?:\.\d+)?)",
         "as": "Screw diameter: {} mm"}},
     # One model per page and an intact text layer, so there is no column to
     # scramble and nothing to gain from making the model read digits off pixels.
     "use_text_layer": True,
     "source_doc": "SOUND UN series UPVC/PVC technical parameter tables, 2020 revision "
                   "(20版UN机型PVC技术参数表计算20200311), Zhejiang Sound Machinery",
     "series_type": "Hydraulic injection moulding machine, Universe (UN) EPIII series, "
                    "configured for UPVC/PVC with a PVC-specification screw (20:1 L:D and "
                    "reduced maximum screw speed); shot weights quoted in UPVC/PVC",
     "series_type_source": "printed",
     "series_type_evidence": "every page is headed '<model>技术参数表UPVC/PVC' (UPVC/PVC "
                             "technical parameter table) and the shot-weight row is labelled "
                             "实际注射量(UPVC) / Shot weight(UPVC)",
     },
    {"folder": "SOUND_UN_PET", "brand": "SOUND", "label": "SOUND UN Series — PET Parameters",
     "pdf": "SOUND-UN-PET-Parameters.pdf",
     "model_suffix": "PET configuration",
     "require_specs": {"screw diameter": {
         "present": r"screw (?:diameter|spec)",
         "recover": r"螺杆直径\s*(?:Screw[^\n]*)?\n?\s*mm\s+(\d+(?:\.\d+)?)",
         "as": "Screw diameter: {} mm"}},
     "source_doc": "SOUND UN series PET technical parameter table (PET UN 中文转曲), "
                   "Zhejiang Sound Machinery",
     "series_type": "Hydraulic injection moulding machine, Universe (UN) EPIII/EPII series, "
                    "configured for PET with a PET-specification screw (24:1 L:D across the "
                    "range, 53-95 mm screw diameters, uprated pump motor)",
     "series_type_source": "derived",
     "series_type_evidence": "the document is titled 'pet un'; the table lists 24.0 L:D for "
                             "every model where the standard UN brochure varies 18.0-22.5, and "
                             "its screw diameters (53/60/67/75/80/85/95 mm) appear in none of "
                             "the standard brochure's screw options for the same models",
     },

    # SOUND's hybrid line -- a genuinely new SERIES, not a re-cut of the UN range.
    # Registered without a series_type: the front matter states the hybrid drive
    # outright ("油电混动 / Hydraulic Electric Hybrid"), so the vision pass should
    # read it off the page and a series-level assertion would only override
    # better evidence with worse. Check the dry run before assuming otherwise.
    {"folder": "SOUND_EMH_PLUS", "brand": "SOUND", "label": "SOUND EMH PLUS Series",
     "pdf": "SOUND-EMH-PLUS-Series.pdf",
     "source_doc": "SOUND EMH PLUS series brochure (Chinese), Zhejiang Sound Machinery"},
]

# The rest of the DG Tech folder. Listed so --list shows the whole scope and
# nobody has to guess what is left, but deliberately NOT ingested: the plan
# pilots ONE brand and proves the schema before the other brands go in.
PENDING = {}


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
# Same two jobs as add_catalogue.py -- transcribe the table, and establish what
# the machine IS -- because machine_type is what the comparison's TYPE gate reads.
# A competitor record with a blank machine_type cannot be compared at all: the
# gate has nothing to test, so the bot must refuse rather than force a table.
PROMPT = """You are reading ONE page of a B2B plastics-machinery brochure (image supplied).
This brochure belongs to a COMPETITOR. Your transcription will be shown to a
salesperson who is standing in front of a customer holding this same brochure, so
every number must match the page exactly.

Return STRICT JSON only: an array, one object per machine model on this page.

[{
  "model_name": "<exact model designation as printed, e.g. DP-450, SD-2800/DP>",
  "machine_type": "<a DETAILED description of what this machine is and does>",
  "machine_type_source": "printed" | "derived" | "unknown",
  "machine_type_evidence": "<the exact words or spec-row labels you based it on>",
  "specs": "<every specification and number, verbatim, with units>"
}]

=== machine_type: COMPOSE IT, DO NOT COPY THE HEADING ===
Two machines can only be compared if they are the same kind of thing, and this
field is what decides that. Read the WHOLE page - title, bullets, spec-row labels,
dimension drawings, captions - and COMPOSE a description covering:

  1. Process family - injection moulding / extrusion blow moulding / injection
     blow moulding / injection stretch blow moulding (ISBM) / stretch blow
     moulding / pipe or profile extrusion / air compressor / air dryer / material
     dryer / hopper loader / mixer / crusher / chiller / mould-temperature
     controller / robot / auxiliary
  2. Automation level - fully automatic / semi-automatic / manual
  3. Layout or clamp design - two-platen / toggle-clamp / linear / rotary /
     shuttle / all-electric / hydraulic / servo-hydraulic / single-stage /
     two-stage / preform reheat
  4. What it produces - with the size range when the table gives one
  5. Material where stated - PET, HDPE, PP, PVC, CPVC
  6. Cavity count and rated output when the table gives them

Every element must be traceable to something on the page. Omit any dimension the
page does not support rather than guessing it.

=== WHERE machine_type MAY COME FROM ===
"printed"  - the core process words appear on the page.
"derived"  - the process words are NOT on the page and the spec rows decide it.
             Put the exact row labels in machine_type_evidence.
"unknown"  - nothing on the page supports it. Set machine_type to "" and
             evidence to "". This is a CORRECT and useful answer.

HARD RULE: NEVER infer the type from the model code alone. "DP" in a model name
does not establish two-platen. If the only thing suggesting a type is the model
designation, the source is "unknown". A blank field is fine. A confident wrong
answer gets a salesperson caught in front of a customer.

=== specs ===
1. Copy every number verbatim with its unit. Do NOT summarize, round, average or
   omit. This is transcription, not description. A number you adjust is a number
   the customer's own brochure will contradict.
2. If the injection unit is offered in several screw diameters or as Type A/B/C,
   transcribe ALL of them. Emit ONE object per variant and put the variant in the
   model_name, e.g. "DP-450 (screw 60mm)" / "DP-450 (Type A)". Do NOT pick one
   column and discard the others - the full range is the competitor's actual
   offering.
   EVERY variant must be labelled, including the first one. Never emit a bare
   "DP-450" alongside a "DP-450 (screw 60mm)": the bare name then silently means
   "the leftmost column", which nobody reading the answer can know. If a model has
   two screw columns you emit exactly two objects, BOTH carrying their diameter.
   Repeat the shared clamping-unit rows into every variant so each object stands
   alone as a complete machine.
3. Where a page shows two configurations of a model as separate columns, emit ONE
   object per configuration with the configuration in the model_name.
4. Do not invent fields. If the brochure does not state a dimension, OMIT it. A
   missing spec is reported as missing; it is never filled in by inference.
5. English only. Translate Chinese labels, keep the numbers exactly as printed.

=== WHAT IS NOT A MODEL ===
Return an empty array [] for covers, contents pages, factory photos, company
profiles and service/network pages. Brand logos, banner slogans and website
footers are NOT machine models. If a name has no specification table anywhere on
the page, do not emit an object for it.
"""

# specs first so the table is transcribed before any prose is written.
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
    return tool


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", (s or "")).strip("_")


def pinecone_id(folder, model):
    raw = f"{folder}_{slug(model)}"
    return re.sub(r"[^a-zA-Z0-9_\-]", "", raw)[:400]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# A real parameter table is a run of "label: number unit" pairs. A cover page that
# happens to print a model designation is not, and neither is a page of marketing
# bullets. Both showed up in the first SOUND run -- the cover yielded a record
# whose entire "specs" field was "2100-3100T", and the features page yielded one
# named "unknown" holding untranslated Chinese prose. Either would have been
# retrievable, and a bot that retrieves a slogan when asked for a spec is worse
# than one that finds nothing.
SPEC_PAIR = re.compile(r"[A-Za-z][A-Za-z .,()/³·-]{2,}:\s*[\d.]")
MIN_SPEC_PAIRS = 4
PLACEHOLDER_NAMES = {"unknown", "n/a", "na", "none", "-", "--", ""}


def is_real_spec_table(specs):
    return len(SPEC_PAIR.findall(specs or "")) >= MIN_SPEC_PAIRS


# The same degenerate-generation defect that bad_machine_type() catches, but in
# the specs field, where it is far more damaging and much harder to see.
#
# On the UN UPVC tables it emitted "Space between tie bars (H" followed by ~1400
# newlines and then stopped. is_real_spec_table() passes it -- there are still 11
# good spec pairs above the blow-up -- so the record ingests looking healthy while
# having silently lost its entire POWER UNIT and GENERAL sections. A rep then
# quotes a machine with no pump motor, no heating capacity and no weight, and has
# no way to tell that from a machine whose brochure omits them.
#
# A real transcription is dense: it is one line of "label: value" pairs. A run of
# blank lines that long is never the document.
RUNAWAY_BLANKS = 40


def degenerate_specs(specs):
    s = specs or ""
    runs = re.findall(r"\n{2,}", s)
    if runs and max(len(r) for r in runs) >= RUNAWAY_BLANKS:
        return f"runaway blank run ({max(len(r) for r in runs)} newlines)"
    return None


# Two ways the vision pass produced a machine_type that is not a description.
# Both were seen in the OUGE brochure and both would have ingested silently.
SOURCE_WORDS = {"printed", "derived", "unknown", ""}


def bad_machine_type(mt):
    """Reject a type that is not actually a description of a machine.

    1. The model answered the machine_type_source enum into the type field, so
       OUGE SJ-2W came back with machine_type = "printed" verbatim.
    2. Degenerate repetition -- OGB-2-10 came back as
       "stretch_stretch_blow_moulding_preform_preform_preform_preform...".
       A real description never repeats one token three times.
    """
    s = (mt or "").strip()
    if s.lower() in SOURCE_WORDS:
        return "type field holds the source enum, not a description"
    tokens = re.findall(r"[a-z]+", s.lower())
    if tokens:
        top, n = Counter(tokens).most_common(1)[0]
        if n >= 3 and len(top) > 3:
            return f"degenerate repetition ('{top}' x{n})"
    return None


# machine_type read off the page by hand, for records the guards above blanked.
# Keyed by (folder, model_name). Everything else is left to the vision pass.
TYPE_OVERRIDE = {
    ("OUGE_PET_Blow", "OGB-2-10"):
        ("Fully automatic PET bottle blow moulding machine, preform reheat with far-infrared "
         "rotating heaters, 2 cavities, for bottles up to 10.0 L and 430 mm height, 48 mm max "
         "neck, rated 1200 pcs/h"),
    ("OUGE_PET_Blow", "OGB-3-7"):
        ("Fully automatic PET bottle blow moulding machine, preform reheat with far-infrared "
         "rotating heaters, 3 cavities, for bottles up to 6.0 L and 350 mm height, 48 mm max "
         "neck, rated 1800 pcs/h"),
    ("OUGE_PET_Blow", "SJ-2W"):
        ("Hand-inserted PET bottle blowing machine -- manual preform loading, automatic "
         "blowing -- 2 cavities, for bottles up to 3.0 L and 320 mm height, 150 mm max neck, "
         "rated 1200 pcs/h"),
    ("OUGE_PET_Blow", "SJ-1W"):
        ("Hand-inserted PET bottle blowing machine -- manual preform loading, automatic "
         "blowing -- 1 cavity, for bottles up to 5.0 L and 360 mm height, 150 mm max neck, "
         "rated 600 pcs/h"),
    ("OUGE_PET_Blow", "SJ-1-20"):
        ("Hand-inserted PET bottle blowing machine -- manual preform loading, automatic "
         "blowing -- 1 cavity, for bottles up to 20.0 L and 490 mm height, 90 mm max neck, "
         "rated 600 pcs/h"),
}

# Records whose model also appears on a fuller parameter table elsewhere in the
# SAME brochure. Victor prints an application case study (cavity, cycle time,
# daily output for one named bottle) on p10-p11 and the real machine table on
# p16. Left alone, "D7-Pro" the case study competes with "D7-Pro (screw diameter
# 50mm)" the machine for every D7-Pro query, and the case study would often win
# on an exact-name match while carrying none of the specs a rep needs. Renaming
# keeps the application data and removes the collision.
MODEL_RENAME = {
    ("Victor_2026", "D7-Pro"): "D7-Pro (application case: 1 L pesticide bottle)",
    ("Victor_2026", "MSZ 70"): "MSZ 70 (application case: 150 ml HDPE bottle)",
    ("Victor_2026", "MSZ 70AE"): "MSZ 70AE (application case: 150 ml HDPE bottle)",
}


def apply_model_suffix(comp, model):
    """Tag every model in a document with the configuration that document is FOR.

    MODEL_RENAME fixes a collision you can enumerate. This fixes the one you
    cannot: a document that re-states models already ingested from ANOTHER
    document, under a different material configuration.

    SOUND prints the UN (Universe) range three times -- the standard PS brochure,
    a UPVC parameter table, and a PET one -- and the model designation is byte for
    byte identical in all three while the injection unit is not. UN180-EPIII is a
    45mm/20:1 screw plasticizing 24.8 g/s in the standard brochure, the same 45mm
    screw plasticizing 31.6 g/s on UPVC, and a 53mm/24:1 screw plasticizing
    53.6 g/s on PET, with a bigger pump to match. All three are correct. None of
    them is correct if the rep does not know which one they are holding.

    Left bare, the three records are near-identical neighbours in embedding space
    competing for the same query, and the retriever picks on distances that have
    nothing to do with the material the customer actually moulds. The suffix is
    what makes them three answerable questions instead of one ambiguous one -- and
    it must be in the model NAME, because that is the line the agent quotes."""
    sfx = comp.get("model_suffix")
    if not sfx or sfx.lower() in model.lower():
        return model
    return f"{model} [{sfx}]"


def apply_series_type(comp, mt, src, evidence):
    """Fill in the clamp design from the brochure's own front matter.

    Only when the page-level answer does not already carry it: a page that states
    its own clamp design is better evidence than a series-level assertion, and
    must win."""
    series = comp.get("series_type")
    if not series:
        return mt, src, evidence
    CLAMP_WORDS = ("two-platen", "two platen", "toggle", "all-electric", "three-platen")
    if mt and any(w in mt.lower() for w in CLAMP_WORDS):
        return mt, src, evidence
    merged_ev = comp["series_type_evidence"]
    if evidence:
        merged_ev = f"{merged_ev} | page: {evidence}"
    # The series claim is the weaker of the two sources, so the record inherits
    # ITS confidence, never the page's.
    return series, comp.get("series_type_source", "derived"), merged_ev


def render_pages(pdf_path, out_dir, dpi=RENDER_DPI):
    os.makedirs(out_dir, exist_ok=True)
    prefix = os.path.join(out_dir, "page")
    subprocess.run([poppler_bin("pdftoppm"), "-jpeg", "-r", str(dpi), pdf_path, prefix],
                   check=True, capture_output=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("page") and f.endswith(".jpg"))
    return [os.path.join(out_dir, f) for f in files]


def _post_json(url, payload, headers, timeout=180):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json", **headers})
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


def page_text(pdf_path, n):
    """The PDF's own text layer for one page, or "" if it has none worth using.

    Most brochures here are useless for this -- the SOUND standard catalogue
    embeds a broken font and every digit extracts as U+FFFD, which is the whole
    reason this pipeline renders and looks instead of reading. But some documents
    have an intact text layer, and where one exists it is EXACT: no OCR step, no
    pixel to misread."""
    try:
        out = subprocess.run(
            [poppler_bin("pdftotext"), "-layout", "-enc", "UTF-8",
             "-f", str(n), "-l", str(n), pdf_path, "-"],
            check=True, capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
    except Exception:
        return ""
    # A layer that lost its glyphs is worse than none: it would hand the model a
    # page of replacement characters and invite it to guess digits from context.
    if out.count("�") > 20 or len(re.findall(r"\d", out)) < 5:
        return ""
    return out.strip()


TEXT_LAYER_NOTE = """
=== THE PDF'S OWN TEXT LAYER FOR THIS PAGE ===
Reproduced below, exactly as extracted. Use it as follows:

- The IMAGE is authoritative for STRUCTURE - which value belongs to which row,
  which column, and which model. Extraction scrambles column alignment, so never
  decide from this text alone which model a number belongs to.
- This text is authoritative for CHARACTERS. Where the image and this text
  disagree on a digit, the text is right.
- Do NOT skip a row just because its label is Chinese with no English beside it.
  Translate the label and keep the value. A row present here and visible in the
  image MUST appear in your output.
- Never emit a row that appears in neither the image nor this text.

--- BEGIN TEXT LAYER ---
{text}
--- END TEXT LAYER ---
"""


def vision_page(img_path, text_layer=""):
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{VISION_MODEL}:generateContent?key={GEMINI_KEY}")
    prompt = PROMPT
    if text_layer:
        prompt = PROMPT + TEXT_LAYER_NOTE.format(text=text_layer)
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
            {"text": prompt},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json", "temperature": 0,
            "maxOutputTokens": 32768, "thinkingConfig": {"thinkingBudget": 0},
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
        if e.code not in (409,):
            raise
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest_path}"


def build_text(brand, label, model, machine_type, specs, source_doc):
    """The hitech text layout, with an ownership banner the agent cannot miss.

    The banner is INSIDE the embedded text, not just in metadata, because n8n
    passes `text` to the model. A record that reads like a HiTech machine is one
    the bot will happily offer to our customer as ours.

    The rival dealer is named on the same line as the brand so a question about
    either one reaches the record."""
    head = (f"COMPETITOR MACHINE (NOT SOLD BY HiTech) - reference only, for comparison.\n"
            f"Sold by: {COMPETITOR_COMPANY} | Brand: {brand} | Catalogue: {label} | "
            f"Model Name: {model}")
    mt = f"\nMachine type: {machine_type}" if machine_type else ""
    src = f"\nSource: {source_doc}"
    return f"{head}{mt}{src}\nSpecifications:\n{specs}"


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


def hitech_models(index):
    """Model names live in the 'hitech' namespace.

    A competitor model that matches one of ours is either the same OEM machine
    sold under two labels, or a transcription error. Either way a human decides
    before it goes live: the bot comparing a machine against itself, and telling
    a rep one side wins, is the most embarrassing output this feature could
    produce."""
    seen = {}
    for page in index.list(namespace=HITECH_NAMESPACE):
        ids = [it if isinstance(it, str) else it.id for it in page]
        for i in range(0, len(ids), 100):
            got = index.fetch(ids=ids[i:i + 100], namespace=HITECH_NAMESPACE)
            vectors = got.vectors if hasattr(got, "vectors") else got["vectors"]
            for vid, v in vectors.items():
                md = (v.metadata if hasattr(v, "metadata") else v["metadata"]) or {}
                key = norm(md.get("model_name"))
                if key:
                    seen.setdefault(key, []).append((vid, md.get("catalogue", "")))
    return seen


def missing_required(comp, specs):
    """Which of this document's defining spec rows the transcription lost.

    `require_specs` names the rows that are the POINT of the document. On the UN
    UPVC and PET tables that is the screw diameter: the clamping unit is shared
    with the standard UN brochure already in Pinecone, and the screw is the whole
    reason these tables exist separately. The source labels that row in Chinese
    only (螺杆直径, with no English beside it), so the vision pass emitted it on
    some pages and silently skipped it on others -- five of ten on the first run.
    Nothing downstream would have noticed: a record with 23 good spec pairs and no
    screw diameter is indistinguishable from a brochure that never printed one."""
    out = []
    for label, cfg in comp.get("require_specs", {}).items():
        if not re.search(cfg["present"], specs or "", re.I):
            out.append(label)
    return out


def recover_required(comp, specs, layer, n_models):
    """Read a dropped row straight off the page's own text layer.

    Only reached after the vision pass has been given VISION_ATTEMPTS to produce
    it and has deterministically refused. This is not inference and not a
    fallback value: `recover` is a regex over the text layer OF THAT PAGE, so the
    number comes from the document, the same document the rep is holding.

    Guarded by n_models == 1. On a one-model-per-page table there is exactly one
    thing the matched value can belong to. On a multi-column table there is not,
    and attaching a recovered number to the wrong model is far worse than leaving
    the row missing and saying so."""
    added = []
    if not layer or n_models != 1:
        return specs, added
    for label, cfg in comp.get("require_specs", {}).items():
        if re.search(cfg["present"], specs or "", re.I):
            continue
        rec = cfg.get("recover")
        if not rec:
            continue
        m = re.search(rec, layer)
        if not m:
            continue
        specs = cfg["as"].format(m.group(1)) + ", " + (specs or "")
        added.append(f"{label}={m.group(1)}")
    return specs, added


def score_attempt(comp, found):
    """How complete one vision attempt is, for best-of-N selection.

    Deliberately not a boolean. The defect degrades a page rather than failing it,
    so 'clean' and 'broken' are the ends of a range and the honest thing to do is
    keep the best attempt seen rather than the first one that clears a bar."""
    ok = 0
    for m in found or []:
        specs = m.get("specs") or ""
        if degenerate_specs(specs) or missing_required(comp, specs):
            continue
        ok += 1
    pairs = sum(len(SPEC_PAIR.findall(m.get("specs") or "")) for m in (found or []))
    return (ok, pairs)


VISION_ATTEMPTS = 3


def extract_page(img, comp, text_layer=""):
    """Read one page, retrying while the result is visibly damaged.

    The vision pass is NOT deterministic, temperature=0 notwithstanding: OUGE p9
    yielded five models on one run and zero on the next. An empty result is
    therefore ambiguous -- either "this page has no machines" or "the call gave up
    this time" -- and the second case silently drops a whole page of a
    competitor's range. That non-determinism is what makes retrying worth it, so
    take the best of up to VISION_ATTEMPTS and stop early once one is clean.

    BUT NOT EVERY DEFECT IS RANDOM, and retrying a deterministic one just buys the
    same wrong answer three times. The UN UPVC tables fail the same way on the
    same pages every attempt -- 1238 newlines on p4, screw diameter absent on p1 --
    because the cause is on the page, not in the sampling: the 螺杆直径 row is
    labelled in Chinese only, and the model drops it rather than translating it.
    So when an attempt reproduces the previous attempt's flaws exactly, stop:
    a different answer is not coming, and the fix is text_layer, not another call."""
    best, best_score, notes = None, (-1, -1), []
    prev_flaws = None
    for attempt in range(1, VISION_ATTEMPTS + 1):
        found = _retry(vision_page, img, text_layer)
        score = score_attempt(comp, found)
        if score > best_score:
            best, best_score = found, score
        if not found:
            notes.append(f"attempt {attempt}: empty")
            prev_flaws = None
            continue
        flaws = []
        for m in found:
            specs = m.get("specs") or ""
            why = degenerate_specs(specs)
            if why:
                flaws.append(f"{m.get('model_name')}: {why}")
            miss = missing_required(comp, specs)
            if miss:
                flaws.append(f"{m.get('model_name')}: no {', '.join(miss)}")
        if not flaws:
            note = (f"clean on attempt {attempt} ({'; '.join(notes)})"
                    if notes else "")
            return found, note
        notes.append(f"attempt {attempt}: {'; '.join(flaws[:3])}")
        if flaws == prev_flaws:
            notes.append("identical to previous attempt - deterministic, not retrying")
            break
        prev_flaws = flaws
    return best, (f"kept best of {len(notes)} — {' | '.join(notes)}"
                  if notes else "")


def process(comp, args, live_models):
    pdf = os.path.join(SRC_DIR, comp["pdf"])
    if not os.path.exists(pdf):
        print(f"  !! missing PDF: {comp['pdf']}")
        return []

    work = os.path.join(HERE, ".render", comp["folder"])
    print(f"  rendering {comp['pdf']} ...")
    pages = render_pages(pdf, work)
    print(f"  {len(pages)} page(s)")

    rows, dropped_type, bad_types = [], [], []
    incomplete = []
    for n, img in enumerate(pages, 1):
        try:
            layer = page_text(pdf, n) if comp.get("use_text_layer") else ""
            found, note = extract_page(img, comp, layer)
            if note:
                print(f"    page {n}: {note}")
        except Exception as e:
            print(f"    page {n}: FAILED {str(e)[:100]}")
            continue
        if not found:
            print(f"    page {n}: no models")
            continue
        for m in found:
            fixed, added = recover_required(comp, m.get("specs"), layer, len(found))
            if added:
                m["specs"] = fixed
                print(f"    page {n}: recovered from text layer — {', '.join(added)}")

        dest = f"{comp['folder']}/{comp['folder']}_page_{n}.jpg"
        public = (f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{dest}"
                  if args.dry_run else _retry(upload_image, img, dest))

        kept, dropped = 0, []
        for m in found:
            model = str(m.get("model_name") or "").strip()
            specs = str(m.get("specs") or "").strip()
            if model.lower() in PLACEHOLDER_NAMES or not specs:
                dropped.append(model or "(unnamed)")
                continue
            if not is_real_spec_table(specs):
                # Reported, never silent: a page dropped here looks identical to a
                # page the vision call missed, and those need opposite responses.
                dropped.append(f"{model} (no spec table: {len(specs)} chars)")
                continue

            # Survived every attempt still damaged. The good prefix is real and
            # worth keeping, but the runaway run must not reach the embedding --
            # and the record must carry a visible mark, because "the brochure
            # stops here" and "our transcription stopped here" mean opposite
            # things to the rep reading it.
            # Only for records that SURVIVE. A cover page listing "UN series" with
            # no table is dropped two lines above; warning that it lacks a screw
            # diameter is noise, and noise in this report is what stops the report
            # being read.
            miss = missing_required(comp, specs)
            if miss:
                incomplete.append(f"p{n} {model}: no {', '.join(miss)}")

            truncated = degenerate_specs(specs)
            if truncated:
                specs = re.sub(r"\n{2,}", "\n", specs).strip()
                specs += ("\n[TRANSCRIPTION INCOMPLETE: the remaining rows of this "
                          "table could not be read reliably -- check the brochure page "
                          "image before quoting anything not listed above.]")
            key = norm(model)
            mt = str(m.get("machine_type") or "").strip()
            src = str(m.get("machine_type_source") or "unknown").strip().lower()
            if src not in ("printed", "derived", "unknown"):
                src = "unknown"
            if src == "unknown":
                mt = ""

            # "never from the model code", enforced rather than trusted. SOUND's
            # own series letters (DP) name the clamp design, which makes this
            # brochure the single likeliest place for the model code to get
            # laundered into evidence.
            ev_key = norm(m.get("machine_type_evidence"))
            evidence = str(m.get("machine_type_evidence") or "").strip()
            if mt and ev_key and (ev_key in key or key in ev_key):
                dropped_type.append(model)
                mt, src, evidence = "", "unknown", ""

            why = bad_machine_type(mt) if mt else None
            if why:
                bad_types.append(f"{model} ({why})")
                mt, src, evidence = "", "unknown", ""

            # a hand-read type beats anything the vision pass produced
            fix = TYPE_OVERRIDE.get((comp["folder"], model))
            if fix:
                mt, src, evidence = fix, "printed", "read off the brochure page by hand"

            model = MODEL_RENAME.get((comp["folder"], model), model)
            model = apply_model_suffix(comp, model)

            mt, src, evidence = apply_series_type(comp, mt, src, evidence)

            rows.append({
                "id": pinecone_id(comp["folder"], model),
                "page": n, "model": model, "machine_type": mt,
                "source": src, "evidence": evidence,
                "specs": specs, "image_url": public,
                "brand": comp["brand"], "label": comp["label"],
                "source_doc": comp["source_doc"],
                "collides_with": live_models.get(key, []),
                "truncated": bool(truncated),
            })
            kept += 1
        note = f"  (dropped {len(dropped)}: no spec table -- {', '.join(dropped[:4])})" if dropped else ""
        print(f"    page {n}: {kept} model(s){note}")

    if dropped_type:
        print(f"  blanked machine_type on {len(dropped_type)} model(s) whose only evidence was "
              f"their own model code: {', '.join(dropped_type[:5])}")
    if bad_types:
        print(f"  blanked {len(bad_types)} malformed machine_type: {'; '.join(bad_types[:4])}")
    if incomplete:
        print(f"  !! {len(incomplete)} record(s) still missing a required spec row after "
              f"{VISION_ATTEMPTS} attempts:")
        for line in incomplete:
            print(f"       {line}")
    still_bad = [r["model"] for r in rows if r.get("truncated")]
    if still_bad:
        print(f"  !! {len(still_bad)} record(s) kept with an INCOMPLETE spec table: "
              f"{', '.join(still_bad)}")

    # Same model on a teaser page and on its real parameter table: keep the
    # richer transcription, not whichever page happened to come first.
    best = {}
    for r in rows:
        prev = best.get(r["id"])
        if prev is None or len(r["specs"]) > len(prev["specs"]):
            best[r["id"]] = r
    if len(best) != len(rows):
        print(f"  deduped {len(rows)} -> {len(best)} (same model on multiple pages)")
    return list(best.values())


def write_review(all_rows):
    by_brand = {}
    for r in all_rows:
        by_brand.setdefault(r["label"], []).append(r)
    n_print = sum(1 for r in all_rows if r["source"] == "printed")
    n_deriv = sum(1 for r in all_rows if r["source"] == "derived")
    n_unk = sum(1 for r in all_rows if r["source"] == "unknown")
    coll = [r for r in all_rows if r["collides_with"]]

    with open(REVIEW_MD, "w", encoding="utf-8") as f:
        f.write("# Competitor ingest review\n\n")
        f.write("Every number below will be quoted to a customer who may be holding this same\n")
        f.write("brochure. Check the figures against the PDF BEFORE a non-dry run.\n\n")
        f.write(f"- **{len(all_rows)}** models across **{len(by_brand)}** competitor catalogue(s)\n")
        f.write(f"- machine_type source: **{n_print} printed**, **{n_deriv} derived**, "
                f"**{n_unk} unknown** (left blank on purpose)\n")
        f.write(f"- **{len(coll)}** model name(s) also exist in our own `hitech` namespace\n")
        f.write(f"- rival dealer recorded as **{COMPETITOR_COMPANY}**\n\n")

        if n_unk:
            f.write("> A blank `machine_type` cannot pass the comparison TYPE gate. Those models\n")
            f.write("> are retrievable but not comparable until the type is established.\n\n")
        # A bare name beside a qualified one, with far fewer specs, is usually a
        # teaser or an application case study competing with the real parameter
        # table for the same model. Victor printed both (p10/p11 vs p16).
        shadowed = []
        for r in all_rows:
            for q in all_rows:
                if r is q or r["label"] != q["label"]:
                    continue
                if q["model"].startswith(r["model"]) and len(q["model"]) > len(r["model"]) \
                        and len(SPEC_PAIR.findall(r["specs"])) * 2 < len(SPEC_PAIR.findall(q["specs"])):
                    shadowed.append((r, q))
                    break
        if shadowed:
            f.write("## Shadowed models -- a bare name beside a fuller table\n\n")
            f.write("The short record will win an exact-name match while carrying a fraction of\n")
            f.write("the specs. Rename it (MODEL_RENAME) or drop it.\n\n")
            f.write("| p | short record | pairs | is shadowed by | pairs |\n|---|---|---|---|---|\n")
            for r, q in shadowed:
                f.write(f"| {r['page']} | {r['model']} | {len(SPEC_PAIR.findall(r['specs']))} | "
                        f"{q['model']} (p{q['page']}) | {len(SPEC_PAIR.findall(q['specs']))} |\n")
            f.write("\n")

        if coll:
            f.write("## Collisions with our own namespace -- resolve before ingesting\n\n")
            f.write("| competitor model | catalogue | also live in `hitech` as |\n|---|---|---|\n")
            for r in coll:
                where = ", ".join(f"`{i}` ({c})" for i, c in r["collides_with"][:3])
                f.write(f"| {r['model']} | {r['label']} | {where} |\n")
            f.write("\n")

        for label, rows in by_brand.items():
            f.write(f"\n## {label}\n\n")
            f.write("| p | model | machine_type | src | spec pairs |\n|---|---|---|---|---|\n")
            for r in sorted(rows, key=lambda x: (x["page"], x["model"])):
                mt = r["machine_type"] or "_(blank -- not comparable)_"
                f.write(f"| {r['page']} | {r['model']} | {mt.replace('|', '/')} | "
                        f"{r['source']} | {len(SPEC_PAIR.findall(r['specs']))} |\n")

            ev = {r["evidence"] for r in rows if r["evidence"]}
            if ev:
                f.write("\n**machine_type evidence** — confirm this supports the claim:\n\n")
                for e in sorted(ev):
                    f.write(f"- {e.replace(chr(10), ' ')}\n")

            f.write("\n### Transcribed specs\n\n")
            for r in sorted(rows, key=lambda x: (x["page"], x["model"])):
                f.write(f"<details><summary>p{r['page']} — {r['model']}</summary>\n\n")
                f.write(f"[brochure page]({r['image_url']})\n\n```\n{r['specs']}\n```\n\n")
                f.write("</details>\n\n")
    print(f"\n  review -> {REVIEW_MD}")


def refresh_meta(index, dry):
    """Bring already-ingested records onto the current metadata/text shape.

    Deliberately does NOT re-run the vision pass. The spec lines in these records
    were checked against the brochure by hand; re-extracting them would risk
    changing verified numbers to fix a header, which is a bad trade. Only the
    banner line, the source line and the metadata are rewritten."""
    ids = []
    for page in index.list(namespace=NAMESPACE):
        ids += [it if isinstance(it, str) else it.id for it in page]
    if not ids:
        print("competitor namespace is empty")
        return

    changed = []
    for i in range(0, len(ids), 100):
        got = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
        for vid, v in (got.vectors if hasattr(got, "vectors") else got["vectors"]).items():
            md = dict(v.metadata or {})
            text = md.get("text", "")
            # split the header block off the transcription and rebuild only it
            m = re.search(r"\nSpecifications:\n", text)
            if not m:
                print(f"  !! no Specifications marker, skipped: {vid}")
                continue
            specs = text[m.end():]
            new_text = build_text(md.get("competitor_brand") or md.get("company"),
                                  md.get("catalogue"), md.get("model_name"),
                                  md.get("machine_type"), specs, md.get("source_doc"))
            new_md = {k: val for k, val in md.items() if k != "verified"}
            new_md["competitor_company"] = COMPETITOR_COMPANY
            new_md["text"] = new_text
            if new_text != text or new_md != md:
                changed.append({"id": vid, "metadata": new_md, "text": new_text,
                                "had_verified": "verified" in md})
    print(f"{len(changed)} of {len(ids)} record(s) need the new shape")
    if changed:
        print("\nnew header:\n  " + "\n  ".join(changed[0]["text"].split("\n")[:4]))
    if dry or not changed:
        print("\nDRY RUN - nothing written." if dry else "")
        return
    for i in range(0, len(changed), 50):
        sub = changed[i:i + 50]
        vecs = _retry(embed_batch, [c["text"] for c in sub])
        index.upsert(namespace=NAMESPACE, vectors=[
            {"id": c["id"], "values": vv, "metadata": c["metadata"]}
            for c, vv in zip(sub, vecs)])
    print(f"\nrewrote {len(changed)} record(s); "
          f"dropped `verified` from {sum(1 for c in changed if c['had_verified'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-meta", action="store_true",
                    help="rewrite header+metadata of existing records; no vision re-run")
    ap.add_argument("--list", action="store_true", help="show the registry and exit")
    ap.add_argument("--only", help="one competitor folder name")
    ap.add_argument("--all", action="store_true", help="every registered competitor")
    ap.add_argument("--redo", action="store_true", help="re-ingest one already in the manifest")
    ap.add_argument("--dry-run", action="store_true",
                    help="extract and write the review; touch nothing remote")
    args = ap.parse_args()

    if args.list:
        print(f"{'folder':<26} {'brand':<10} {'pdf'}")
        for c in COMPETITORS:
            print(f"{c['folder']:<26} {c['brand']:<10} {c['pdf']}")
        print("\nnot yet registered (pilot one brand first):")
        for k, why in PENDING.items():
            print(f"  {k}\n      {why}")
        return

    if args.refresh_meta:
        refresh_meta(Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME), args.dry_run)
        return

    todo = COMPETITORS if args.all else [c for c in COMPETITORS if c["folder"] == args.only]
    if not todo:
        raise SystemExit("Nothing selected. Use --list, --only <folder>, or --all.")

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)

    print("reading our own model names for collision detection ...")
    live_models = hitech_models(index)
    print(f"  {len(live_models)} distinct HiTech model names live\n")

    manifest = load_manifest()
    all_rows, failed = [], []
    for comp in todo:
        print(f"=== {comp['label']}  ({comp['folder']}) ===")
        if not args.redo and comp["folder"] in manifest and not args.dry_run:
            print(f"  already ingested ({manifest[comp['folder']]['records']} records) -- skipping")
            continue
        try:
            rows = process(comp, args, live_models)
        except Exception as e:
            print(f"  !! {comp['folder']} FAILED: {str(e)[:160]}")
            failed.append(comp["folder"])
            continue
        all_rows.extend(rows)
        if args.dry_run or not rows:
            continue

        texts = [build_text(r["brand"], r["label"], r["model"], r["machine_type"],
                            r["specs"], r["source_doc"]) for r in rows]
        total = 0
        for i in range(0, len(rows), 50):
            sub, subtext = rows[i:i + 50], texts[i:i + 50]
            vecs = _retry(embed_batch, subtext)
            index.upsert(namespace=NAMESPACE, vectors=[{
                "id": r["id"], "values": v,
                "metadata": {
                    # the fields the comparison logic keys on
                    "owner": "competitor",
                    "competitor_company": COMPETITOR_COMPANY,
                    "competitor_brand": r["brand"],
                    "source_doc": r["source_doc"],
                    # mirrored from the hitech schema so one renderer serves both
                    "catalogue": r["label"], "company": r["brand"],
                    "image_url": r["image_url"], "model_name": r["model"],
                    "machine_type": r["machine_type"],
                    "machine_type_source": r["source"], "text": t,
                },
            } for r, v, t in zip(sub, vecs, subtext)])
            total += len(sub)
        print(f"  upserted {total} -> {INDEX_NAME}/{NAMESPACE}")
        manifest[comp["folder"]] = {
            "pdf": comp["pdf"], "brand": comp["brand"], "company": COMPETITOR_COMPANY,
            "sha256": file_hash(os.path.join(SRC_DIR, comp["pdf"])),
            "records": total,
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        save_manifest(manifest)

    if all_rows:
        write_review(all_rows)
    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
    print(f"\nmodels: {len(all_rows)}")
    if args.dry_run:
        print("DRY RUN - nothing uploaded, nothing upserted.")


if __name__ == "__main__":
    main()
