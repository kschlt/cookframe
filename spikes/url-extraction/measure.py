#!/usr/bin/env python3
"""CFV1-S2 — Schema.org/Recipe JSON-LD presence & sufficiency measurement.

Spike (OQ-07/OQ-08 evidence; shapes the Slice 4 URL adapter). Lives under
spikes/ (outside build/lint/eval-harness). Measures, over a corpus of real
recipe sources, two rates the adapter's whole design hinges on:

  1. PRESENCE   — does the page carry a Schema.org/Recipe JSON-LD block at all?
  2. SUFFICIENCY — when present, does it carry the fields the Canonical Recipe
                   contract needs (name, ingredients, instructions, yield),
                   not merely parse?

It reads already-fetched raw HTML (kept private/uncommitted — third-party page
content) plus the committed corpus.json, and writes results.json holding only
STRUCTURAL FACTS (booleans, counts, shape labels) — never recipe text — so the
measurement is pinned in the public repo without copying copyrighted content.

Usage:
    python3 measure.py --html-dir <dir with src_NN.html> [--out results.json]

The fetch step (curl per corpus URL into src_NN.html) is intentionally separate
and private; see README.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

LD_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)

# The fields the Canonical Recipe contract needs to build a record without
# inventing. Ingredients + instructions + name + yield are the "sufficient" set;
# the rest are tracked for the per-field coverage characterization.
REQUIRED = ["name", "recipeIngredient", "recipeInstructions", "recipeYield"]
TRACKED = REQUIRED + [
    "author",
    "prepTime",
    "cookTime",
    "totalTime",
    "nutrition",
    "image",
    "recipeYield",
    "description",
    "recipeInstructions_structured",  # HowToStep/HowToSection vs bare string
]


def load_ld_objects(html: str) -> list:
    """Every JSON object found in any ld+json block, flattening @graph."""
    objs: list = []
    for m in LD_RE.finditer(html):
        raw = m.group(1).strip()
        # Some sites emit multiple concatenated JSON values or trailing commas;
        # be tolerant: try whole, then salvage the first {...} balanced blob.
        parsed = _try_json(raw)
        if parsed is None:
            continue
        for node in _iter_nodes(parsed):
            objs.append(node)
    return objs


def _try_json(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        # strip HTML comments and CDATA wrappers occasionally seen
        cleaned = raw.replace("<!--", "").replace("-->", "").strip()
        cleaned = re.sub(r"^/\*.*?\*/", "", cleaned, flags=re.DOTALL).strip()
        try:
            return json.loads(cleaned)
        except Exception:
            return None


def _iter_nodes(parsed):
    """Yield candidate objects: the value itself, list items, and @graph items."""
    stack = [parsed]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            yield node
            if "@graph" in node and isinstance(node["@graph"], list):
                stack.extend(node["@graph"])


def is_recipe(obj: dict) -> bool:
    t = obj.get("@type")
    if isinstance(t, str):
        return t == "Recipe"
    if isinstance(t, list):
        return "Recipe" in t
    return False


def non_empty(v) -> bool:
    if v is None:
        return False
    if isinstance(v, (list, str, dict)):
        return len(v) > 0
    return True


def instructions_shape(v) -> str:
    if v is None:
        return "absent"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list) and v:
        first = v[0]
        if isinstance(first, dict):
            t = first.get("@type", "?")
            return f"list<{t}>"
        return "list<string>"
    return "other"


def score_recipe(obj: dict) -> dict:
    fields = {}
    for f in ["name", "recipeIngredient", "recipeInstructions", "recipeYield",
              "author", "prepTime", "cookTime", "totalTime", "nutrition",
              "image", "description"]:
        fields[f] = non_empty(obj.get(f))
    fields["recipeInstructions_structured"] = instructions_shape(obj.get("recipeInstructions"))
    sufficient = all(non_empty(obj.get(f)) for f in REQUIRED)
    missing = [f for f in REQUIRED if not non_empty(obj.get(f))]
    return {"fields": fields, "sufficient": sufficient, "missing_required": missing}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--html-dir", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "results.json"))
    ap.add_argument("--corpus", default=str(Path(__file__).parent / "corpus.json"))
    ap.add_argument("--status", default="", help="optional JSON map {index: http_code}; non-200 = blocked")
    args = ap.parse_args()

    corpus = json.loads(Path(args.corpus).read_text())
    entries = corpus["sources"]
    html_dir = Path(args.html_dir)
    status = json.loads(Path(args.status).read_text()) if args.status else {}

    results = []
    for i, entry in enumerate(entries, start=1):
        rec = {"n": i, "site": entry["site"], "lang": entry["lang"], "url": entry["url"]}
        code = status.get(str(i))
        if code is not None:
            rec["http_status"] = code
        f = html_dir / f"src_{i:02d}.html"
        # A source counts as fetched only on a real 200; a 403/blocked page is
        # NOT a valid "JSON-LD absent" observation and is excluded from rates.
        if (code is not None and code != 200) or not f.exists() or f.stat().st_size == 0:
            rec.update(fetched=False, note=f"blocked/unfetched (http {code})" if code else "not fetched")
            results.append(rec)
            continue
        html = f.read_text(errors="replace")
        rec["fetched"] = True
        rec["bytes"] = len(html)
        objs = load_ld_objects(html)
        recipes = [o for o in objs if is_recipe(o)]
        rec["jsonld_blocks"] = len(LD_RE.findall(html))
        rec["recipe_present"] = len(recipes) > 0
        if recipes:
            # score the richest recipe object (max satisfied required fields)
            scored = max((score_recipe(r) for r in recipes),
                         key=lambda s: sum(1 for f in REQUIRED if s["fields"][f]))
            rec.update(scored)
        results.append(rec)

    fetched = [r for r in results if r.get("fetched")]
    present = [r for r in fetched if r.get("recipe_present")]
    sufficient = [r for r in present if r.get("sufficient")]

    def rate(a, b):
        return f"{len(a)}/{len(b)}" + (f" ({100*len(a)//len(b)}%)" if b else "")

    # per-field coverage among present recipes
    field_cov = {}
    for f in ["name", "recipeIngredient", "recipeInstructions", "recipeYield",
              "author", "prepTime", "cookTime", "totalTime", "nutrition", "image", "description"]:
        field_cov[f] = sum(1 for r in present if r.get("fields", {}).get(f))
    shapes = {}
    for r in present:
        s = r.get("fields", {}).get("recipeInstructions_structured", "?")
        shapes[s] = shapes.get(s, 0) + 1

    summary = {
        "corpus_total": len(entries),
        "fetched": len(fetched),
        "blocked_or_unfetched": len(entries) - len(fetched),
        "presence_over_fetched": rate(present, fetched),
        "sufficiency_over_present": rate(sufficient, present),
        "sufficiency_over_fetched": rate(sufficient, fetched),
        "field_coverage_over_present": {k: f"{v}/{len(present)}" for k, v in field_cov.items()},
        "recipeInstructions_shapes": shapes,
    }
    out = {"summary": summary, "results": results}
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n")

    print(f"# CFV1-S2 — URL/JSON-LD extraction over {len(entries)} sources\n")
    print(f"fetched:                 {len(fetched)}/{len(entries)} (blocked/unfetched: {len(entries)-len(fetched)})")
    print(f"Recipe JSON-LD present:  {summary['presence_over_fetched']} of fetched")
    print(f"sufficient (name+ing+instr+yield): {summary['sufficiency_over_present']} of present, {summary['sufficiency_over_fetched']} of fetched\n")
    print("per-field coverage (of present):")
    for k, v in summary["field_coverage_over_present"].items():
        print(f"  {k:32s} {v}")
    print("\nrecipeInstructions shapes:", summary["recipeInstructions_shapes"])
    print("\nper-source:")
    for r in results:
        if not r.get("fetched"):
            print(f"  {r['n']:2d} {r['site']:22s} NOT FETCHED")
        elif not r.get("recipe_present"):
            print(f"  {r['n']:2d} {r['site']:22s} no Recipe JSON-LD ({r.get('jsonld_blocks',0)} ld blocks)")
        else:
            miss = ",".join(r.get("missing_required", [])) or "-"
            print(f"  {r['n']:2d} {r['site']:22s} present  sufficient={r['sufficient']!s:5s} missing_required={miss}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
