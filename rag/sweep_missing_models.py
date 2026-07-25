"""
Find models that exist on a catalogue page but were never indexed.

The Demaji screw table lost 11 rows because it was laid out as two column-pairs
side by side and only the left half was ever read. That defect is invisible to
any audit of the namespace itself -- there is no record to inspect -- and it was
found by accident, while a page was open for an unrelated reason.

This sweep looks for the same shape of defect everywhere else, at zero API cost,
by reusing what the machine_type backfill already saw. That pass rendered and read
all 610 pages across 38 PDFs and cached every model name it found per page. It
only ever extracted names and types, never numbers, so it could not have caught a
wrong VALUE -- but it is a complete record of which model names appeared on which
page, which is exactly what a missing-record check needs.

Output is a CANDIDATE list, not a verdict. Vision extraction drifts, brochures
repeat model names across pages, and the index legitimately spells some models
differently from the page. Every hit has to be confirmed against the page at high
dpi before anything is written -- which is how the Demaji, HHD and HDL fixes were
done.

    $py = "C:\\Users\\syedm\\PyCharmMiscProject\\.venv\\Scripts\\python.exe"
    & $py rag/sweep_missing_models.py
"""
import os
import re
import sys
import json

from pinecone import Pinecone

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
CACHE = os.path.join(HERE, ".render_backfill", "_extract_cache.json")
REPORT = os.path.join(HERE, "sweep_missing_models.md")

# same mapping the backfill used
from backfill_machine_type import SOURCES  # noqa: E402


def _load_key(env, fname):
    v = os.environ.get(env)
    if not v:
        p = os.path.join(HERE, fname)
        if os.path.exists(p):
            v = open(p, encoding="utf-8").read().strip()
    if not v:
        raise SystemExit(f"Missing {env}")
    return v


def norm(s):
    """Collapse the ways a page and the index can spell the same model."""
    s = (s or "").lower()
    s = re.sub(r"[\s\-_.()\u00b7\u2013\u2014/]", "", s)
    return s


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


def main():
    cache = json.load(open(CACHE, encoding="utf-8"))
    index = Pinecone(api_key=_load_key("PINECONE_API_KEY", ".pinecone_key")).Index(INDEX_NAME)
    print("fetching live records ...")
    recs = fetch_all(index)

    live_by_cat = {}
    for r in recs:
        live_by_cat.setdefault(r["metadata"].get("catalogue", ""), []).append(r)

    lines = ["# Sweep: models on a page but not in the index", "",
             "Candidates only. Each one needs the page opened at high dpi before any write.",
             "A hit is often a page header, a series label, or a spelling the index",
             "renders differently -- the Demaji case (11 real rows lost to a two-column",
             "table) is what a genuine hit looks like.", ""]
    total_hits = 0
    catalogues_with_hits = 0
    no_cache = []

    for catalogue, pdfs in sorted(SOURCES.items()):
        page_models = {}
        for pdf in pdfs:
            if pdf not in cache:
                no_cache.append((catalogue, pdf))
                continue
            for key, m in cache[pdf].items():
                nm = (m.get("model_name") or "").strip()
                if nm:
                    page_models.setdefault(norm(nm), (nm, m.get("page", "?")))

        if not page_models:
            continue

        live = live_by_cat.get(catalogue, [])
        live_norm = {norm(r["metadata"].get("model_name", "")) for r in live}

        missing = []
        for k, (nm, page) in sorted(page_models.items()):
            if k in live_norm:
                continue
            # a page name that is contained in an indexed name (or vice versa) is
            # almost always the same machine spelled longer -- not a missing record
            if any(k and (k in lv or lv in k) for lv in live_norm if lv):
                continue
            missing.append((nm, page))

        if missing:
            catalogues_with_hits += 1
            total_hits += len(missing)
            lines.append(f"## {catalogue}   ({len(live)} indexed, {len(missing)} candidate(s))")
            lines.append("")
            for nm, page in missing:
                lines.append(f"- `{nm}`  -- {page}")
            lines.append("")

    if no_cache:
        lines.append("## PDFs with no extraction cache")
        lines.append("")
        for cat, pdf in no_cache:
            lines.append(f"- {cat}: `{pdf}`")
        lines.append("")

    covered = {c for c in SOURCES}
    uncovered = sorted(set(live_by_cat) - covered)
    if uncovered:
        lines.append("## Catalogues this sweep cannot see")
        lines.append("")
        lines.append("No PDF is mapped for these, so nothing was compared. They need a")
        lines.append("source-vs-index pass of their own.")
        lines.append("")
        for c in uncovered:
            lines.append(f"- {c}  ({len(live_by_cat[c])} records)")
        lines.append("")

    open(REPORT, "w", encoding="utf-8").write("\n".join(lines))

    print(f"\ncatalogues compared : {len(SOURCES) - len({c for c, _ in no_cache})}")
    print(f"catalogues with hits: {catalogues_with_hits}")
    print(f"candidate models    : {total_hits}")
    print(f"catalogues NOT covered by this sweep: {len(uncovered)}")
    for c in uncovered:
        print(f"    {c}  ({len(live_by_cat[c])} records)")
    print(f"\nreport -> {REPORT}")


if __name__ == "__main__":
    main()
