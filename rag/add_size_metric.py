"""Give every competitor record its real sizing dimension, read from its own text.

    py -3 rag/add_size_metric.py --review                 # read-only, writes the review
    py -3 rag/add_size_metric.py --review --category Chiller
    py -3 rag/add_size_metric.py --apply                  # re-embed + upsert

WHY THIS EXISTS
---------------
Asking the bot for a "200 ton" competitor machine returns a machine with a
200 MILLIMETRE SCREW. Measured on production executions 20283, 20299, 20325:

    "SOUND 200 ton"  -> UN2900EPIII (screw specification 200mm)

UN2900 is a 2,900-ton machine. That is 14.5x too big, and it is not a ranking
wobble -- it is deterministic. Records are stored one per screw size and the
screw diameter sits in the embedded text right beside the model name, so the
strongest numeric signal in the text is the wrong field. Switching the query to
kN does not escape it; "2000 kN" matches ~200mm screws just as happily.

The agent recovers by searching three or four times, which is what the
Search Competitor x4 chains on comparison turns actually are.

WHY NOT A CLAMPING-FORCE FIELD
------------------------------
Only 250 of 571 records are injection moulding machines. The rest are chillers,
compressors, dryers, crushers, cap machines and conveyors, and they are not
sized by the same thing -- the objection add_competitor.py already raises in its
own docstring about hardcoding injection axes.

So this reads, per record, the spec line that category is actually sized by, and
stores ONE derived value. Every transcribed spec line is left exactly as it is.

WHY IT IS CHECKABLE RATHER THAN TRUSTED
---------------------------------------
--review writes competitor_size_review.md showing, for every record, WHICH spec
line was matched and the raw fragment it came from. A wrong mapping is then
visible as a wrong line quoted next to the number, not as a plausible number
with nothing behind it. Nothing reaches Pinecone until a human has read it.

Uses add_competitor.refresh_meta's approach: the vision pass is NOT re-run, so
no hand-verified transcription can change. This is a re-embed, not a re-ingest.
"""
import os
import re
import sys
import json
import argparse
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import add_competitor as A  # noqa: E402  (constants, embed_batch, _retry)

HERE = os.path.dirname(os.path.abspath(__file__))
REVIEW_MD = os.path.join(HERE, "competitor_size_review.md")
REVIEW_JSON = os.path.join(HERE, "competitor_size_review.json")


# ---------------------------------------------------------------------------
# Which line sizes which machine.
#
# Names are matched NORMALISED (lowercase, non-alphanumerics stripped), so
# "Crush Capacity(Kg/H)", "Crush Capacity (Kg/H)" and "crush capacity" are all
# the same key. Listed IN ORDER: the first one present wins, which is how
# "Clamping force of preform" takes precedence over "Clamping force" on a blow
# moulder that prints both.
#
# A category absent from this table, or a record whose lines are all absent, is
# left WITHOUT a size. That is a deliberate answer, not a failure: a guessed
# size puts a rep in front of a machine of the wrong class, which is the exact
# failure this file exists to remove.
# ---------------------------------------------------------------------------
# Each candidate is (normalised spec name, metric, unit). The unit travels WITH
# the name, not with the category, because the brochures put it in the name and
# it varies inside one category: a dryer prints "Capacity(kg): 45" on a tray
# dryer and "Capacity(L): 100" on a hopper. Sharing one unit per category
# silently mixes kilograms and litres into a single sortable column.
#
# First candidate present wins, so the more specific name is listed first --
# "Clamping force of preform" ahead of "Clamping force" on a blow moulder that
# prints both.
SIZE_METRICS = {
    "Injection Molding Machine": [
        ("clampingforce", "clamping_force", "kN"),
    ],
    "PET Preform Injection Molding Machine": [
        ("clampingforce", "clamping_force", "kN"),
    ],
    # Two genuinely different machines share this category. An injection-blow
    # unit prints a clamping force; a stretch-blow unit does not and is sold on
    # bottles per hour. Both are correct sizes for their own machine, which is
    # exactly why size_metric is stored alongside the number.
    "PET / Blow Molding Machine (SBM/ISBM/IBM)": [
        ("clampingforceofpreform", "clamping_force", "kN"),
        ("clampingforce", "clamping_force", "kN"),
        ("theoreticaloutput", "output_rate", "pcs/h"),
    ],
    "Chiller": [
        ("refrigerationcapacity", "refrigeration_capacity", "kW"),
    ],
    # Compressors print flow as a RANGE, repeated per pressure
    # ("MPA: 0.8, m3/min: 1.91-6.30, MPA: 1.0, m3/min: 1.60-5.33"), so flow is
    # not single-valued. Motor power is, and it is how a compressor is sold --
    # QWL-50SA carries KW: 37, and 37 kW is 49.6 HP, i.e. the 50 in the name.
    "Screw Air Compressor": [
        ("kw", "motor_power", "kW"),
        ("motorpower", "motor_power", "kW"),
        ("power", "motor_power", "kW"),
    ],
    "Mould Temperature Controller": [
        ("heatkw", "heater_power", "kW"),
        ("heat", "heater_power", "kW"),
        ("heatingpower", "heater_power", "kW"),
    ],
    # "Capacity(kg)" on a tray dryer, "Capacity(L)" on a hopper -- the unit is
    # inside the name, so each gets its own entry rather than a shared unit.
    "Plastic Material Dryer / Loader": [
        ("capacitykg", "capacity", "kg"),
        ("capacityl", "capacity", "L"),
        ("capacity", "capacity", "L"),
        ("dryingcapacity", "capacity", "kg"),
        ("hoppercapacity", "capacity", "L"),
    ],
    # SBL-* are hopper loaders, sized on throughput. SCB-* are belt conveyors,
    # which have no throughput at all and are sold on belt width.
    "Loader / Conveying System": [
        ("conveyingcapacitykghr", "throughput", "kg/h"),
        ("conveyingcapacity", "throughput", "kg/h"),
        ("beltwidthmm", "belt_width", "mm"),
    ],
    "Crusher / Granulator": [
        ("crushcapacitykgh", "throughput", "kg/h"),
        ("crushcapacity", "throughput", "kg/h"),
    ],
    "Cap Machine": [
        ("maxcapacitypcshr", "output_rate", "pcs/h"),
        ("maxcapacity", "output_rate", "pcs/h"),
        # The MINFENG machines print a plain "Capacity: 25000-30000pcs/hr".
        # Listed last so the eight records carrying the more specific
        # "Max. Capacity (pcs/hr)" keep matching that instead.
        ("capacity", "output_rate", "pcs/h"),
    ],
    "Mixing & Dosing Unit": [
        ("materialsbarrell", "barrel_volume", "L"),
        ("materialsbarrel", "barrel_volume", "L"),
        ("themaxcapacity", "throughput", "kg/h"),
    ],
}

# ---------------------------------------------------------------------------
# Records whose `category` is wrong, corrected by id.
#
# These four are SML hopper loaders filed as injection moulding machines. Their
# own machine_type says what they are -- "fully automatic hopper loader for
# injection moulding machines or material bins" -- and the phrase "for injection
# moulding machines" is almost certainly what misfiled them. None carries a
# clamping force; all four carry "Conveying Capacity (kg/hr)", which is exactly
# how the SBL-* loaders already in Loader / Conveying System are sized.
#
# Corrected rather than left unsized, because the two are not the same problem.
# An unsized record is merely absent from a size filter. A loader sized AS an
# injection machine would put a 250 kg/hr hopper loader in front of a rep who
# asked for a 250-ton press.
# ---------------------------------------------------------------------------
RECATEGORISE = {
    "SML_Auxiliaries_SAL_300C": "Loader / Conveying System",
    "SML_Auxiliaries_SAL_360":  "Loader / Conveying System",
    "SML_Auxiliaries_SAL_360E": "Loader / Conveying System",
    "SML_Auxiliaries_SAL_400":  "Loader / Conveying System",

    # Four MINFENG cap machines filed as "Other / Needs Review" -- which is what
    # that category is for. All four are cap folding, slitting, cutting or
    # lining machines and belong with the eight already in Cap Machine.
    "MINFENG_Cap_MF_80C": "Cap Machine",
    "MINFENG_Cap_MF_80D": "Cap Machine",
    "MINFENG_Cap_MF_80E": "Cap Machine",
    "MINFENG_Cap_MF_80G": "Cap Machine",
}

# How each metric reads to a rep. The number is NEVER written bare: a chiller is
# sized in TONS OF REFRIGERATION and an injection machine in tons of clamping
# force, so a lone "50 ton" would let a chiller answer a moulding question.
SIZE_DISPLAY = {
    "clamping_force":         lambda v, u: f"Clamping force: {v:g} kN ({v / 10:g} ton)",
    "refrigeration_capacity": lambda v, u: f"Refrigeration capacity: {v:g} kW ({v / 3.517:.1f} ton refrigeration, TR)",
    "motor_power":            lambda v, u: f"Motor power: {v:g} kW ({v * 1.341:.0f} HP)",
    "heater_power":           lambda v, u: f"Heater power: {v:g} kW",
    # The unit comes from the matched line, not the metric: a tray dryer prints
    # "Capacity(kg)" and a hopper prints "Capacity(L)". Writing "Capacity: 45"
    # bare would leave 45 kg and 45 L indistinguishable -- the same bare-number
    # ambiguity this whole change exists to remove.
    "capacity":               lambda v, u: f"Capacity: {v:g} {u}",
    "throughput":             lambda v, u: f"Throughput: {v:g} {u}",
    "output_rate":            lambda v, u: f"Output: {v:g} {u}",
    "barrel_volume":          lambda v, u: f"Barrel volume: {v:g} {u}",
    "belt_width":             lambda v, u: f"Belt width: {v:g} mm",
}

# Plausible ranges. A value outside these is reported as SUSPECT rather than
# silently stored -- it means the wrong line was matched, and that is precisely
# the error a number with nothing behind it would hide.
PLAUSIBLE = {
    "clamping_force":         (150, 80000),     # 15 t to 8,000 t
    "refrigeration_capacity": (1, 2000),        # kW
    "motor_power":            (0.5, 500),       # kW
    "heater_power":           (0.5, 200),       # kW
    "capacity":               (1, 10000),       # L
    "throughput":             (1, 20000),       # kg/h
    "output_rate":            (10, 1000000),    # pcs/h
    "barrel_volume":          (0.5, 5000),      # L
    "belt_width":             (50, 2000),       # mm
}

normalise = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())

# A spec name: letters, then anything up to the colon that is not itself a
# separator. Used to find where each name STARTS, so a value can run to the next
# name rather than to an arbitrary comma -- separators are inconsistent
# ("a: 1; b: 2" on chillers, "a: 1, b: 2" on compressors) and values contain
# commas of their own ("23.89x2 kW, 38700 Kcal/h").
_NAME = re.compile(r"(?:^|[;,\n])\s*([A-Za-z][A-Za-z0-9 ./%°()\-+']{0,44}?)\s*:")
# "29000", "23.89x2" (two circuits), "1.91-6.30" (a range).
_VALUE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:[x×]\s*(\d+))?(?:\s*[-–]\s*(\d+(?:\.\d+)?))?")


def parse_specs(specs):
    """Every "name: value" pair, as [(raw_name, raw_value)] in document order."""
    marks = list(_NAME.finditer(specs))
    out = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(specs)
        out.append((m.group(1).strip(), specs[m.end():end].strip().rstrip(";,")))
    return out


def extract_size(category, specs):
    """(metric, value, unit, matched_name, raw_fragment, note) or None.

    Always reports WHAT it matched, so the review shows the working. `note`
    carries anything a human should look at: a multiplier applied, a range
    collapsed, a value outside its plausible band.
    """
    candidates = SIZE_METRICS.get(category)
    if not candidates:
        return None

    pairs = parse_specs(specs)
    by_name = {}
    for raw_name, raw_value in pairs:
        by_name.setdefault(normalise(raw_name), (raw_name, raw_value))

    for key, metric, unit in candidates:
        if key not in by_name:
            continue
        raw_name, raw_value = by_name[key]
        m = _VALUE.search(raw_value)
        if not m:
            continue

        value = float(m.group(1))
        notes = []
        if m.group(2):                       # "23.89x2" -> two circuits
            value *= float(m.group(2))
            notes.append(f"x{m.group(2)} applied")
        if m.group(3):                       # "1.91-6.30" -> a range
            notes.append(f"range {m.group(1)}-{m.group(3)}, took low end")
        if value <= 0:
            continue

        lo, hi = PLAUSIBLE[metric]
        if not (lo <= value <= hi):
            notes.append(f"SUSPECT: outside {lo}-{hi} {unit}")

        return metric, value, unit, raw_name, raw_value, "; ".join(notes)
    return None


# ---------------------------------------------------------------------------


def fetch_all(index, category=None):
    ids = []
    for page in index.list(namespace=A.NAMESPACE):
        ids += [it if isinstance(it, str) else it.id for it in page]

    records = []
    for i in range(0, len(ids), 100):
        got = index.fetch(ids=ids[i:i + 100], namespace=A.NAMESPACE)
        vectors = got.vectors if hasattr(got, "vectors") else got["vectors"]
        for vid, v in vectors.items():
            md = dict(v.metadata or {})
            if category and md.get("category") != category:
                continue
            records.append({"id": vid, "md": md})
    return records


def split_specs(text):
    """The transcription, without the header. None if the marker is missing."""
    m = re.search(r"\nSpecifications:\n", text)
    return text[m.end():] if m else None


def evaluate(records):
    rows = []
    for rec in records:
        md = rec["md"]
        text = md.get("text", "")
        specs = split_specs(text)
        if specs is None:
            rows.append({"id": rec["id"], "model": md.get("model_name"),
                         "category": md.get("category"), "catalogue": md.get("catalogue"),
                         "size": None, "matched": None, "raw": None,
                         "note": "no Specifications marker"})
            continue
        category = RECATEGORISE.get(rec["id"], md.get("category"))
        got = extract_size(category, specs)
        rows.append({
            "id": rec["id"],
            "model": md.get("model_name"),
            "category": category,
            "was_category": md.get("category") if rec["id"] in RECATEGORISE else None,
            "catalogue": md.get("catalogue"),
            "size": None if not got else [got[0], got[1], got[2]],
            "matched": None if not got else got[3],
            "raw": None if not got else got[4],
            "note": "" if not got else got[5],
        })
    return rows


def write_review(rows):
    by_cat = collections.defaultdict(list)
    for r in rows:
        by_cat[r["category"] or "(none)"].append(r)

    sized = [r for r in rows if r["size"]]
    suspect = [r for r in rows if r["size"] and "SUSPECT" in (r["note"] or "")]
    unsized = [r for r in rows if not r["size"]]

    out = [
        "# Competitor size-metric review", "",
        f"- **{len(rows)}** records",
        f"- **{len(sized)}** sized",
        f"- **{len(unsized)}** with no size (left out of size filtering, never guessed)",
        f"- **{len(suspect)}** SUSPECT — value outside its plausible band, read these first",
        "",
        "Each row quotes the spec line it matched and the raw fragment, so a wrong",
        "mapping shows up as a wrong line beside the number rather than as a",
        "plausible number with nothing behind it.", "",
    ]

    if suspect:
        out += ["## SUSPECT — read these first", "",
                "| model | value | matched line | raw | note |", "|---|---|---|---|---|"]
        for r in suspect:
            _, v, u = r["size"]
            out.append(f"| {r['model']} | {v:g} {u} | `{r['matched']}` | `{r['raw']}` | {r['note']} |")
        out.append("")

    for cat in sorted(by_cat):
        rs = by_cat[cat]
        n = sum(1 for r in rs if r["size"])
        out += [f"## {cat} — {n}/{len(rs)} sized", "",
                "| model | value | display | matched line | raw | note |",
                "|---|---|---|---|---|---|"]
        # Sorted by value: a 3 kN "injection machine" or a halved chiller is
        # obvious in a sorted column and invisible in a flat list.
        for r in sorted(rs, key=lambda x: (x["size"][1] if x["size"] else -1)):
            if r["size"]:
                metric, v, u = r["size"]
                out.append(f"| {r['model']} | {v:g} {u} | {SIZE_DISPLAY[metric](v, u)} "
                           f"| `{r['matched']}` | `{r['raw'][:60]}` | {r['note']} |")
            else:
                out.append(f"| {r['model']} | **none** | — | — | — | {r['note']} |")
        out.append("")

    with open(REVIEW_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    with open(REVIEW_JSON, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)

    print(f"{len(rows)} records | {len(sized)} sized | {len(unsized)} unsized | {len(suspect)} SUSPECT")
    print("\nper category:")
    for cat in sorted(by_cat):
        rs = by_cat[cat]
        print(f"  {sum(1 for r in rs if r['size']):4}/{len(rs):<4}  {cat}")
    print(f"\nwritten {REVIEW_MD}")


def build_text_with_size(md, specs, size):
    """add_competitor.build_text plus a Size line.

    Rebuilt here rather than by editing build_text, so this script cannot change
    what a normal ingest produces. The Size line goes ABOVE Specifications
    because that is what a size query must match -- below it, it sits among the
    screw diameters that caused the problem.
    """
    base = A.build_text(md.get("competitor_brand") or md.get("company"),
                        md.get("catalogue"), md.get("model_name"),
                        md.get("machine_type"), specs, md.get("source_doc"))
    if not size:
        return base
    metric, value, unit = size
    return base.replace("\nSpecifications:\n",
                        f"\nSize: {SIZE_DISPLAY[metric](value, unit)}\nSpecifications:\n", 1)


def apply(index, records, rows):
    by_id = {r["id"]: r for r in rows}
    changed = []
    for rec in records:
        md, row = dict(rec["md"]), by_id.get(rec["id"])
        if row is None:
            continue
        specs = split_specs(md.get("text", ""))
        if specs is None:
            continue

        if rec["id"] in RECATEGORISE:
            md["category"] = RECATEGORISE[rec["id"]]

        size = row["size"]
        new_text = build_text_with_size(md, specs, size)
        # Pinecone metadata cannot hold None; absence IS the null, and it is
        # also what makes $exists the right filter for "records we can size".
        for k in ("size_metric", "size_value", "size_unit"):
            md.pop(k, None)
        if size:
            md["size_metric"], md["size_value"], md["size_unit"] = size[0], float(size[1]), size[2]
        md["text"] = new_text
        if new_text != rec["md"].get("text") or md != rec["md"]:
            changed.append({"id": rec["id"], "metadata": md, "text": new_text})

    print(f"{len(changed)} of {len(records)} record(s) need writing")
    if not changed:
        return
    print("\nnew header:\n  " + "\n  ".join(changed[0]["text"].split("\n")[:5]))

    for i in range(0, len(changed), 50):
        sub = changed[i:i + 50]
        vecs = A._retry(A.embed_batch, [c["text"] for c in sub])
        index.upsert(namespace=A.NAMESPACE, vectors=[
            {"id": c["id"], "values": vv, "metadata": c["metadata"]}
            for c, vv in zip(sub, vecs)])
        print(f"  upserted {min(i + 50, len(changed))}/{len(changed)}")
    print(f"\nrewrote {len(changed)} record(s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", action="store_true", help="read-only; write the review and exit")
    ap.add_argument("--apply", action="store_true", help="re-embed and upsert")
    ap.add_argument("--category", help="limit to one category")
    args = ap.parse_args()
    if args.review == args.apply:
        ap.error("choose exactly one of --review or --apply")

    from pinecone import Pinecone
    index = Pinecone(api_key=A._load_key("PINECONE_API_KEY", ".pinecone_key")).Index(A.INDEX_NAME)

    records = fetch_all(index, args.category)
    if not records:
        raise SystemExit("no records found")
    rows = evaluate(records)
    write_review(rows)

    if args.apply:
        suspect = sum(1 for r in rows if r["size"] and "SUSPECT" in (r["note"] or ""))
        if suspect:
            print(f"\n{suspect} SUSPECT record(s). Read {REVIEW_MD} first, then re-run.")
            raise SystemExit(1)
        apply(index, records, rows)
    else:
        print("\nREVIEW ONLY - nothing written to Pinecone.")


if __name__ == "__main__":
    main()
