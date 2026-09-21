#!/usr/bin/env python3
"""CFV1-S1 — project a real CanonicalRecipe onto the scorer's flat shape.

The S1 scorer (`spikes/s1-capture-quality/score.py`) compares a capture to its
ground truth field by field, over a flat record: title / yields / times /
temperatures / ingredients / instructions / split_reserved / nutrition /
classifications. That shape predates the pipeline; the real pipeline emits the
full `CanonicalRecipe` contract.

This script is the adapter between them, and it is deliberately ONLY an adapter:
it moves values, it never decides whether a value is right. All judgement stays
in the pre-registered scorer, so the real run is graded by the same code and the
same bars as the synthetic one.

Usage:
  python3 spikes/s1-photo-gate/project.py \
      --in evals/fixtures/private/s1-gate --out evals/fixtures/private/s1-gate/runs \
      --model gpt-5.4
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def expr_text(node, key="sourceText"):
    """The verbatim source text of a ValueExpression-like node, or None."""
    if isinstance(node, dict):
        v = node.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return None


def project(recipe: dict) -> dict:
    ingredients = []
    for group in recipe.get("ingredientGroups") or []:
        heading = group.get("heading")
        for ing in group.get("ingredients") or []:
            ingredients.append(
                {
                    "name": ing.get("name"),
                    "quantity": expr_text(ing.get("quantityExpression")),
                    "unit": ing.get("unit"),
                    "group": heading,
                }
            )

    instructions = []
    temperatures = []
    split_reserved = []
    for section in recipe.get("instructionSections") or []:
        for step in section.get("steps") or []:
            text = step.get("sourceText") or step.get("normalizedActionText")
            if text:
                instructions.append(text)
            for temp in step.get("temperatures") or []:
                t = temp.get("sourceText")
                if t:
                    temperatures.append(t)
            # A step that sets a component aside is the split/reserved case.
            for produced in step.get("producesComponents") or []:
                label = produced.get("componentId") or produced.get("sourceText")
                if label and text:
                    split_reserved.append(text)

    times = {}
    for t in recipe.get("times") or []:
        kind = t.get("type")
        value = expr_text(t.get("durationExpression"))
        if kind and value:
            times[kind] = value

    nutrition = {}
    for n in recipe.get("nutritionStatements") or []:
        name = n.get("nutrient") or n.get("label")
        value = expr_text(n.get("valueExpression")) or n.get("sourceText")
        if name and value:
            nutrition[name] = value

    classifications = {}
    for c in recipe.get("sourceClassifications") or []:
        kind = c.get("kind") or c.get("type")
        value = c.get("value") or c.get("sourceText")
        if kind and value:
            classifications[kind] = value

    return {
        "title": recipe.get("title"),
        "yields": [y for y in (expr_text(y) or y.get("sourceText") for y in recipe.get("yields") or []) if y],
        "times": {
            "prep": times.get("prep"),
            "cook": times.get("cook"),
            "total": times.get("total"),
        },
        "temperatures": temperatures,
        "ingredients": ingredients,
        "instructions": instructions,
        "split_reserved": split_reserved,
        "nutrition": nutrition,
        "classifications": classifications,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--out", dest="outdir", required=True)
    ap.add_argument("--model", required=True)
    args = ap.parse_args()

    indir, outdir = Path(args.indir), Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in sorted(indir.glob("*.canonical.json")):
        stem = path.name.replace(".canonical.json", "")
        doc = json.loads(path.read_text())
        # The runner writes the appended CanonicalVersion; unwrap to the recipe.
        recipe = doc.get("recipe", doc)
        out = outdir / f"{stem}__{args.model}.json"
        out.write_text(json.dumps(project(recipe), ensure_ascii=False, indent=2) + "\n")
        count += 1
    print(f"projected {count} capture(s) -> {outdir}")


if __name__ == "__main__":
    main()
