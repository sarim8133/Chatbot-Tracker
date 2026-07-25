"""
Attach shared equipment lists to the machines they actually describe.

THE PROBLEM
-----------
Tederic brochures print each machine's spec table early and then, at the back,
one combined standard/optional equipment list covering a whole span of models -
"NEO-T90-NEO-T360", "NEO-E160II~NEO-E1400II", "D100-D250".

Every extractor we have ever run treated that span label as if it were a machine.
extract_specs.py even said so out loud: "If the page is a shared features/options
table for a range, return one object: model_name = the range label". So the
namespace ended up with a record called NEO-E160II~NEO-E1400II holding 44
features - KEBA controller, EUROMAP 67 robot interface, safety relay monitoring -
while NEO-E160II itself holds clamping and injection numbers and mentions none of
them. Ask "does the NEO-E160II have a KEBA controller?" and the answer is sitting
in a record nobody would ever type the name of.

A span is inclusive of everything between its endpoints: D100-D250 covers D130,
D160 and D200 as well, not merely D100 and D250.

WHY A SEPARATE RECORD PER MODEL, NOT A MERGE
--------------------------------------------
The obvious fix - append the feature list to each member's spec record - makes
retrieval worse. A NEO-T90 spec record is ~140 words of clamping and injection
numbers; the equipment list is ~190 more. Merged, the numbers carry under half
the weight they used to, so "900 kN clamping force" starts matching a machine it
used to own. Instead each member gets its own equipment record, named for that
member. Spec queries hit the spec record, feature queries hit the equipment
record, and neither dilutes the other.

Usage:
    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/fix_ranges.py --dry-run
    & $py rag/fix_ranges.py --go
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
BACKUP = os.path.join(HERE, "backups", "range-records-backup.json")
REPORT = os.path.join(HERE, "range_fix_report.md")


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

SEP = re.compile(r"\s*(?:-|\u2013|\u2014|~|\bto\b|/)\s*")


def stem(s):
    return re.sub(r"[^A-Za-z]", "", (re.match(r"^[^0-9]*", s or "") or [""])[0]).lower()


def first_num(s):
    m = re.search(r"(\d+)", s or "")
    return int(m.group(1)) if m else None


def range_parts(name):
    """Try EVERY separator. Splitting on the first one turns 'NEO-T90-NEO-T360'
    into 'NEO' + 'T90-NEO-T360', which is why the first version of this check
    could not see the very records it was written to find."""
    s = (name or "").strip()
    best = None
    for m in SEP.finditer(s):
        a, b = s[:m.start()].strip(), s[m.end():].strip()
        if not a or not b:
            continue
        sa, sb, na, nb = stem(a), stem(b), first_num(a), first_num(b)
        if not sa or sa != sb or na is None or nb is None or nb <= na:
            continue
        if best is None or len(a) > len(best[0]):
            best = (a, b, sa, na, nb)
    if not best:
        return None
    a, b, st, lo, hi = best
    return {"lo_label": a, "hi_label": b, "stem": st, "lo": lo, "hi": hi}


def body_of(text):
    i = (text or "").find("Specifications:")
    return (text or "") if i == -1 else text[i + len("Specifications:"):]


def feature_lines(text):
    """Range records store features either newline-separated (old pipeline) or
    semicolon-separated on one line (new one). Normalise both."""
    out = []
    for chunk in re.split(r"[\n;]", body_of(text)):
        c = " ".join(chunk.split())
        if c and len(c) > 2:
            out.append(c)
    return out


def is_feature_list(text):
    b = body_of(text)
    opts = len(re.findall(r":\s*(Standard|Optional)\b", b, re.I))
    units = len(re.findall(r"\b\d+(?:\.\d+)?\s*(?:mm|kN|MPa|kW|cm|rpm|ton|bar|kg|°C)\b", b, re.I))
    return opts >= 5 and opts > units


UNIT_IN_NAME = None  # set per range


def unit_codes(rec, letter):
    """Injection-unit codes carried by a machine, e.g. 'NEO-E90II (e110)' -> 110,
    'D350 i 1900 B' -> 1900, or the body's 'Injection unit e360:' -> 360."""
    found = set()
    name = rec["metadata"].get("model_name", "") or ""
    for m in re.finditer(rf"\b{letter}\s?(\d{{2,6}})\b", name, re.I):
        found.add(int(m.group(1)))
    for m in re.finditer(rf"Injection unit\s+{letter}\s?(\d{{2,6}})", rec["metadata"].get("text", ""), re.I):
        found.add(int(m.group(1)))
    return found


def fetch_all(index):
    ids = []
    for page in index.list(namespace=NAMESPACE):
        ids += [it if isinstance(it, str) else it.id for it in page]
    recs = []
    for i in range(0, len(ids), 100):
        got = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
        for vid, v in got.vectors.items():
            recs.append({"id": vid, "metadata": dict(v.metadata or {})})
    return recs


def embed_batch(texts):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}")
    payload = {"requests": [{"model": f"models/{EMBED_MODEL}",
                             "content": {"parts": [{"text": t}]}} for t in texts]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return [e["values"] for e in json.loads(r.read())["embeddings"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args()
    dry = not args.go

    index = Pinecone(api_key=PINECONE_KEY).Index(INDEX_NAME)
    print("fetching namespace ...")
    recs = fetch_all(index)
    print(f"  {len(recs)} records")

    # Anything whose NAME parses as a span is excluded from member pools, even if
    # its content did not qualify it as a source range. Otherwise a span record
    # gets attached as a "member" of a wider span -- i9500-i66600 was collecting
    # i22300-i66600 and i41000-i108000 as if they were machines.
    parses = {r["id"]: range_parts(r["metadata"].get("model_name")) for r in recs}
    span_ids = {rid for rid, p in parses.items() if p}

    sources = [r for r in recs
               if parses[r["id"]] and is_feature_list(r["metadata"].get("text", ""))]
    print(f"  {len(sources)} shared-equipment span records")

    by_cat = {}
    for r in recs:
        by_cat.setdefault(r["metadata"].get("catalogue", "?"), []).append(r)

    # member id -> {"rec":…, "ranges":[label], "features":[…]}
    attach = {}
    orphans = []
    for src in sources:
        p = parses[src["id"]]
        cat = src["metadata"].get("catalogue", "?")
        label = src["metadata"].get("model_name", "")
        pool = [r for r in by_cat.get(cat, []) if r["id"] not in span_ids]

        members = [r for r in pool
                   if stem(r["metadata"].get("model_name", "")) == p["stem"]
                   and first_num(r["metadata"].get("model_name", "")) is not None
                   and p["lo"] <= first_num(r["metadata"].get("model_name", "")) <= p["hi"]]

        # A brochure may shorten the series prefix on its equipment page: the PET
        # preform book labels that page "D250-D500" while the machines in the very
        # same book are DT-250, DT-350, DT 400 and DT 500. Only ever a fallback,
        # and only within the one catalogue, so "D" cannot reach across to DD or Db.
        if not members:
            members = [r for r in pool
                       if stem(r["metadata"].get("model_name", "")).startswith(p["stem"])
                       and first_num(r["metadata"].get("model_name", "")) is not None
                       and p["lo"] <= first_num(r["metadata"].get("model_name", "")) <= p["hi"]]

        # Spans whose endpoints are injection units (i380-i600, e80-e220,
        # m150-m2500) name no machine, so the stem test finds nothing. Match on
        # the unit code each machine carries instead.
        if not members:
            members = [r for r in pool
                       if any(p["lo"] <= u <= p["hi"] for u in unit_codes(r, p["stem"]))]

        if not members:
            orphans.append(label)
            continue

        feats = feature_lines(src["metadata"].get("text", ""))
        for m in members:
            e = attach.setdefault(m["id"], {"rec": m, "ranges": [], "features": []})
            e["ranges"].append(label)
            for f in feats:
                if f not in e["features"]:      # a model covered by D100-D250 AND
                    e["features"].append(f)     # D100-D500 must not list twice
        src["_used"] = True

    used = [s for s in sources if s.get("_used")]
    print(f"  {len(used)} spans resolved | {len(orphans)} unresolved | "
          f"{len(attach)} machines gain an equipment record")

    # ── build the equipment records ──
    new = []
    for mid, e in attach.items():
        md = e["rec"]["metadata"]
        model = md.get("model_name", "")
        mt = md.get("machine_type") or ""
        if not mt:
            # A span record often carries a better type than its members:
            # NEO-T90-NEO-T360 says "Toggle-clamp injection moulding machine"
            # where NEO-T90 says only "Hydraulic injection moulding machine".
            for s in used:
                if s["metadata"].get("model_name") in e["ranges"]:
                    mt = s["metadata"].get("machine_type") or ""
                    if mt:
                        break
        head = (f"Company: {md.get('company','')} | Catalogue: {md.get('catalogue','')} "
                f"| Model Name: {model}")
        mtl = f"\nMachine type: {mt}" if mt else ""
        src_note = ", ".join(e["ranges"])
        text = (f"{head}{mtl}\nStandard and optional equipment for {model}\n"
                f"(printed in the brochure for {src_note}):\n" + "\n".join(e["features"]))
        new.append({
            "id": f"{mid}__equipment",
            "text": text,
            "metadata": {"catalogue": md.get("catalogue", ""), "company": md.get("company", ""),
                         "image_url": md.get("image_url", ""), "model_name": model,
                         "machine_type": mt, "record_kind": "equipment",
                         "equipment_from": src_note, "text": text},
        })

    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("# Shared-equipment span fix\n\n")
        f.write(f"- span records found: **{len(sources)}**\n")
        f.write(f"- resolved to members: **{len(used)}**, unresolved: **{len(orphans)}**\n")
        f.write(f"- equipment records created: **{len(new)}**\n\n")
        if orphans:
            f.write(f"Unresolved spans (kept as-is): {', '.join(sorted(set(orphans)))}\n\n")
        f.write("| machine | features | from span(s) |\n|---|---|---|\n")
        for mid, e in sorted(attach.items(), key=lambda kv: kv[1]["rec"]["metadata"].get("model_name", "")):
            f.write(f"| {e['rec']['metadata'].get('model_name','')} | {len(e['features'])} "
                    f"| {', '.join(e['ranges'])} |\n")
    print(f"  report -> {REPORT}")

    if dry:
        print("\nDRY RUN -- nothing written. Re-run with --go")
        return

    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump([{"id": s["id"], "metadata": s["metadata"]} for s in used], f, indent=1, ensure_ascii=False)
    print(f"  backed up {len(used)} span records -> {BACKUP}")

    for i in range(0, len(new), 50):
        sub = new[i:i + 50]
        vecs = embed_batch([r["text"] for r in sub])
        index.upsert(namespace=NAMESPACE, vectors=[
            {"id": r["id"], "values": v, "metadata": r["metadata"]} for r, v in zip(sub, vecs)])
        print(f"  upserted {min(i+50, len(new))}/{len(new)}")

    doomed = [s["id"] for s in used]
    for i in range(0, len(doomed), 100):
        index.delete(ids=doomed[i:i + 100], namespace=NAMESPACE)
    print(f"  deleted {len(doomed)} span records")
    time.sleep(6)
    print("  final:", index.describe_index_stats().namespaces)


if __name__ == "__main__":
    main()
