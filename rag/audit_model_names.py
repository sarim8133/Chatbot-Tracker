"""
Find model_name values that are probably NOT real models.

Read-only. Writes rag/model_name_audit.md ranked by suspicion, so a human reads
brochure pages in priority order instead of all 260 of them.

WHY THESE SIGNALS. Three real defects were found by hand in July 2026 and each
one was an OUTLIER AMONG ITS OWN SIBLINGS, not something odd in isolation:

  MF-S        printed MF-5. Siblings MF-7 / MF-9 / MF-11 all transcribed fine, so
              the shape "AA-A" sat alone on a page where "AA-9" appeared 3 times.
  21-35VZ     printed 2I-35VZ. Every sibling used the 2- / 3- prefix; this one
              claimed a two-digit prefix no other model on the page had.
  JH100       never on the page at all. The printed series runs JH25..JH200 and
              skips 100, so it was a gap-filler the model invented.

So the detector is comparative, never absolute: a name is suspicious when the
page it came from disagrees with it. Absolute rules (\"looks like prose\") are kept
but ranked below, because several catalogues legitimately name machines in words.

Usage:
    py -3 rag/audit_model_names.py
    py -3 rag/audit_model_names.py --catalogue Huare
"""
import os
import re
import json
import argparse
from collections import Counter, defaultdict

from pinecone import Pinecone

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_NAME = "hitech-v2"
NAMESPACE = "hitech"
OUT = os.path.join(HERE, "model_name_audit.md")

# Characters an OCR pass swaps for one another. A one-character difference from a
# sibling is only interesting when the difference is one of these.
HOMOGLYPHS = [set("0OoQD"), set("1IilL"), set("5S"), set("8B"), set("2Z"),
              set("6G"), set("9g"), set("VY"), set("UV"), set("MN")]

PROSE_WORDS = re.compile(
    r"\b(machine|machinery|line|system|series|solution|equipment|unit|type|for|with|and|"
    r"technical|parameter|specification|introduction|application|advantage|feature|"
    r"production|station|cavity|automatic|molding|moulding)\b", re.I)


def _load_key(env, fname):
    v = os.environ.get(env)
    if not v:
        p = os.path.join(HERE, fname)
        if os.path.exists(p):
            v = open(p, encoding="utf-8").read().strip()
    if not v:
        raise SystemExit(f"Missing {env}")
    return v


def shape(s):
    """Model code reduced to its pattern: 'MF-11' -> 'AA-99', '2I-35VZ' -> '9A-99AA'."""
    out = []
    for ch in s or "":
        if ch.isdigit():
            out.append("9")
        elif ch.isalpha():
            out.append("A")
        else:
            out.append(ch)
    return "".join(out)


def homoglyph_pairs(a, b):
    """True when a and b differ at exactly one position, by a known OCR swap."""
    if len(a) != len(b) or a == b:
        return False
    diff = [(x, y) for x, y in zip(a, b) if x != y]
    if len(diff) != 1:
        return False
    x, y = diff[0]
    return any(x in g and y in g for g in HOMOGLYPHS)


def page_of(url):
    m = re.search(r"_page_(\d+)\.jpg", url or "")
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", help="substring filter")
    args = ap.parse_args()

    index = Pinecone(api_key=_load_key("PINECONE_API_KEY", ".pinecone_key")).Index(INDEX_NAME)
    print("fetching every record ...")
    recs = []
    for page in index.list(namespace=NAMESPACE):
        ids = [it if isinstance(it, str) else it.id for it in page]
        for i in range(0, len(ids), 100):
            g = index.fetch(ids=ids[i:i + 100], namespace=NAMESPACE)
            for vid, v in (g.vectors if hasattr(g, "vectors") else g["vectors"]).items():
                md = dict(v.metadata or {})
                recs.append({
                    "id": vid,
                    "model": (md.get("model_name") or "").strip(),
                    "cat": md.get("catalogue") or "(none)",
                    "company": md.get("company") or "",
                    "img": md.get("image_url") or "",
                    "page": page_of(md.get("image_url")),
                    "specs_len": len(md.get("text") or ""),
                })
    if args.catalogue:
        recs = [r for r in recs if args.catalogue.lower() in r["cat"].lower()]
    print(f"  {len(recs)} records")

    by_page = defaultdict(list)
    by_cat = defaultdict(list)
    for r in recs:
        by_page[(r["cat"], r["page"])].append(r)
        by_cat[r["cat"]].append(r)

    flags = defaultdict(list)   # id -> [(score, reason)]

    # 1. shape outlier on its own page -- the signal that caught MF-S and 21-35VZ
    for (cat, pg), group in by_page.items():
        if len(group) < 3:
            continue
        counts = Counter(shape(r["model"]) for r in group)
        dominant = counts.most_common(1)[0]
        if dominant[1] < 2:
            continue
        for r in group:
            if counts[shape(r["model"])] == 1:
                flags[r["id"]].append(
                    (40, f"shape `{shape(r['model'])}` is unique on {cat} p{pg}, "
                         f"where `{dominant[0]}` appears {dominant[1]}x"))

    # 2. one homoglyph away from a sibling in the same catalogue -- one of the two
    #    is almost certainly a misread of the other
    for cat, group in by_cat.items():
        names = [r for r in group if r["model"]]
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                if homoglyph_pairs(a["model"], b["model"]):
                    flags[a["id"]].append((35, f"one OCR-swap away from sibling `{b['model']}`"))
                    flags[b["id"]].append((35, f"one OCR-swap away from sibling `{a['model']}`"))

    # 3. a letter sitting where every sibling of the same shape has a digit
    for (cat, pg), group in by_page.items():
        if len(group) < 3:
            continue
        for r in group:
            s = r["model"]
            peers = [q["model"] for q in group if q is not r and len(q["model"]) == len(s)]
            if len(peers) < 2:
                continue
            for pos, ch in enumerate(s):
                if not ch.isalpha():
                    continue
                col = [p[pos] for p in peers]
                if col and all(c.isdigit() for c in col):
                    flags[r["id"]].append(
                        (30, f"`{ch}` at position {pos+1} where all {len(col)} peers "
                             f"on p{pg} have a digit"))
                    break

    # 4. prose rather than a model code
    for r in recs:
        m = r["model"]
        words = m.split()
        if len(words) >= 4 and PROSE_WORDS.search(m) and not re.search(r"\d{2,}", m):
            flags[r["id"]].append((20, "reads as a heading/description, not a model code"))
        elif len(words) >= 6:
            flags[r["id"]].append((15, f"{len(words)} words -- likely a page heading"))

    # 5. thin record: a real parameter table is not this short
    for r in recs:
        if r["specs_len"] < 200:
            flags[r["id"]].append((25, f"only {r['specs_len']} chars of text -- no real table"))

    # 6. alone on its page while the catalogue has real tables elsewhere
    for (cat, pg), group in by_page.items():
        if len(group) == 1 and len(by_cat[cat]) > 8:
            r = group[0]
            flags[r["id"]].append((10, f"only record from {cat} p{pg}"))

    scored = []
    for r in recs:
        f = flags.get(r["id"])
        if f:
            scored.append((sum(s for s, _ in f), r, [t for _, t in f]))
    scored.sort(key=lambda x: (-x[0], x[1]["cat"], x[1]["model"]))

    lines = ["# Model-name audit", "",
             f"{len(scored)} of {len(recs)} records raised at least one flag. Ranked by score;",
             "read the brochure page for anything above ~35 before trusting the name.", "",
             "Signals are comparative: a name is suspicious when the page it came from",
             "disagrees with it. See the script docstring for why each one exists.", ""]
    cur = None
    for score, r, reasons in scored:
        if r["cat"] != cur:
            cur = r["cat"]
            lines += [f"\n## {cur}\n"]
        pg = f"[p{r['page']}]({r['img']})" if r["img"] else "-"
        lines.append(f"- **{score}** `{r['model']}` — {pg}")
        for t in reasons:
            lines.append(f"  - {t}")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\n{len(scored)} flagged -> {OUT}\n")
    print("top 30:")
    for score, r, reasons in scored[:30]:
        print(f"  {score:3d}  {r['cat'][:28]:<28} p{str(r['page']):<4} {r['model'][:46]}")
        for t in reasons[:2]:
            print(f"        - {t[:104]}")


if __name__ == "__main__":
    main()
