#!/usr/bin/env python3
"""CFV1-S1 — per-field capture-quality scorer.

Reads the synthetic fixtures (ground truth) and the capture runs, and scores
capture accuracy PER CRITICAL FIELD and PER FIXTURE CLASS, against the bars
pre-registered in THRESHOLD.md. It never uses a text-similarity or whole-document
measure — every figure is an exact per-field match under the normalization rules
the threshold names (proof: capture-quality/per-field-scoring).

Output: scores.json (machine-readable, per field + per class + edge classes +
verdict) and a printed report. The verdict is PASS only if every field bar and
every quantity-edge bar is met (proof: capture-quality/oq14-verdict) — AND the
captures are not byte-identical to their truth. A circularity guard downgrades
the verdict to INCONCLUSIVE_CIRCULAR when every present capture equals its truth,
because a correct read of self-authored content cannot be told from a copy of the
answer, so a PASS would be tautological (see oq14-verdict.md).

Usage: python3 spikes/s1-capture-quality/score.py [--model sonnet]
       python3 spikes/s1-capture-quality/score.py --selftest
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
RUNS = HERE / "runs"

# Pre-registered per-field pass bars (THRESHOLD.md). Kept here so the scorer's
# verdict is computed against the recorded values, not re-decided.
FIELD_BARS = {
    "ingredient.quantity": 0.98,
    "ingredient.unit": 0.98,
    "split_reserved": 0.98,
    "temperature": 0.98,
    "multiple_yields": 0.98,
    "ingredient.name": 0.95,
    "instruction.text": 0.95,
    "instruction.order": 0.95,
    "title": 0.95,
    "yield": 0.95,
    "time": 0.95,
    "ingredient_group": 0.90,
    "nutrition": 0.90,
    "classification": 0.90,
}
EDGE_BARS = {"fractions": 0.98, "ranges": 0.98, "ambiguous_units": 0.95, "multiple_yields": 0.98}

UNIT_SYNONYMS = {
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "g": "g", "gram": "g", "grams": "g", "gm": "g",
    "kg": "kg", "kilogram": "kg",
    "ml": "ml", "millilitre": "ml", "milliliter": "ml",
    "l": "l", "litre": "l", "liter": "l",
    "cup": "cup", "cups": "cup",
    "clove": "clove", "cloves": "clove",
    "can": "can", "cans": "can",
    "pinch": "pinch", "stick": "stick", "handful": "handful",
    "sprig": "sprig", "sprigs": "sprig", "sheet": "sheet", "sheets": "sheet",
}

UNICODE_FRAC = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8"}


def norm_str(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).strip().lower()).rstrip(".")


def norm_unit(s) -> str:
    n = norm_str(s)
    return UNIT_SYNONYMS.get(n, n)


def _to_number(tok: str):
    """Parse 'A B/C', 'B/C', 'A.B', 'A' to a float; None if not numeric."""
    tok = tok.strip()
    m = re.fullmatch(r"(\d+)\s+(\d+)/(\d+)", tok)  # mixed 1 1/2
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.fullmatch(r"(\d+)/(\d+)", tok)  # 1/2
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.fullmatch(r"\d+(?:\.\d+)?", tok)  # 1 or 1.5
    if m:
        return float(tok)
    return None


def norm_qty(s):
    """Return a canonical comparable form: a float, a (lo, hi) tuple for a range,
    or a normalized string when not numeric. Handles unicode fractions and ranges."""
    if s is None:
        return None
    raw = str(s)
    for u, a in UNICODE_FRAC.items():
        raw = raw.replace(u, " " + a)
    raw = re.sub(r"\s+", " ", raw.strip().lower())
    # split off a trailing unit-ish word for range like "2 to 3 hours"? keep whole for ranges of numbers only
    range_split = re.split(r"\s*(?:-|–|—|to)\s*", raw)
    if len(range_split) == 2:
        lo, hi = _to_number(range_split[0]), _to_number(range_split[1].split(" ")[0])
        if lo is not None and hi is not None:
            return ("range", round(lo, 4), round(hi, 4))
    n = _to_number(raw)
    if n is not None:
        return round(n, 4)
    return raw  # non-numeric (should be rare; ambiguous units carry unit separately)


def qty_eq(a, b) -> bool:
    return norm_qty(a) == norm_qty(b)


def load_json(p: Path):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def canon_json(o) -> str:
    """Order-independent canonical form, for the circularity guard: a capture
    canonically equal to its truth measures nothing about capture accuracy."""
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def match_ingredient(truth_ing, captured_list):
    """Find the captured ingredient whose normalized name equals the truth name."""
    tn = norm_str(truth_ing.get("name"))
    for c in captured_list:
        if norm_str(c.get("name")) == tn:
            return c
    return None


class Tally:
    def __init__(self):
        self.hit = 0
        self.total = 0

    def add(self, ok: bool):
        self.total += 1
        self.hit += 1 if ok else 0

    def rate(self):
        return (self.hit / self.total) if self.total else None


def score(model: str):
    manifest = load_json(FIX / "manifest.json")
    if not manifest:
        sys.exit("no manifest.json — run generate.mjs first")

    fields = {k: Tally() for k in FIELD_BARS}
    edges = {k: Tally() for k in EDGE_BARS}
    per_class = {}
    missing_runs = []
    per_fixture = []
    captures_present = 0
    identical_to_truth = 0

    for entry in manifest["fixtures"]:
        fid, cls = entry["id"], entry["class"]
        truth = load_json(FIX / entry["truth"])
        run_path = RUNS / f"{fid}__{model}.json"
        cap = load_json(run_path)
        cls_tally = per_class.setdefault(cls, Tally())
        if cap is None:
            missing_runs.append(run_path.name)
            continue
        captures_present += 1
        # Circularity guard: a capture byte-identical to the truth it is scored
        # against proves nothing about capture accuracy — a correct read of
        # self-authored content and a copy of the answer are indistinguishable.
        if canon_json(cap) == canon_json(truth):
            identical_to_truth += 1

        fx = {"id": fid, "class": cls, "checks": []}

        def check(field_key, ok, note="", edge=None, count_class=True):
            fields[field_key].add(ok)
            if count_class:
                cls_tally.add(ok)
            if edge:
                edges[edge].add(ok)
            fx["checks"].append({"field": field_key, "ok": bool(ok), "note": note})

        # title
        check("title", norm_str(cap.get("title")) == norm_str(truth.get("title")))

        # yields (single vs multiple)
        t_yields = [norm_str(y) for y in (truth.get("yields") or [])]
        c_yields = [norm_str(y) for y in (cap.get("yields") or [])]
        if len(t_yields) > 1:
            check("multiple_yields", sorted(c_yields) == sorted(t_yields), edge="multiple_yields")
        else:
            check("yield", sorted(c_yields) == sorted(t_yields))

        # times: correct only if every present truth time matches
        tt = {k: v for k, v in (truth.get("times") or {}).items() if v}
        if tt:
            ct = cap.get("times") or {}
            check("time", all(norm_str(ct.get(k)) == norm_str(v) for k, v in tt.items()))

        # temperatures (incl ranges)
        t_temps = [norm_qty(x) for x in (truth.get("temperatures") or [])]
        if t_temps:
            c_temps = [norm_qty(x) for x in (cap.get("temperatures") or [])]
            ok = all(t in c_temps for t in t_temps) and len(c_temps) == len(t_temps)
            is_range = any(isinstance(t, tuple) for t in t_temps)
            check("temperature", ok, edge="ranges" if is_range else None)

        # ingredients: name / quantity / unit, per truth ingredient
        cap_ings = cap.get("ingredients") or []
        for ing in truth.get("ingredients") or []:
            m = match_ingredient(ing, cap_ings)
            name_ok = m is not None
            check("ingredient.name", name_ok)
            qraw = str(ing.get("quantity") or "")
            is_frac = "/" in qraw
            is_range = bool(re.search(r"-|–|—|\bto\b", qraw))
            is_ambig = norm_unit(ing.get("unit")) in {"can", "clove", "pinch", "stick", "handful"}
            check(
                "ingredient.quantity",
                name_ok and qty_eq(m.get("quantity"), ing.get("quantity")),
                edge=("fractions" if is_frac else "ranges" if is_range else None),
            )
            check(
                "ingredient.unit",
                name_ok and norm_unit(m.get("unit")) == norm_unit(ing.get("unit")),
                edge=("ambiguous_units" if is_ambig else None),
            )

        # ingredient groups (only if truth has any)
        t_groups = [i.get("group") for i in (truth.get("ingredients") or []) if i.get("group")]
        if t_groups:
            ok_g = True
            for ing in truth.get("ingredients") or []:
                if not ing.get("group"):
                    continue
                m = match_ingredient(ing, cap_ings)
                if m is None or norm_str(m.get("group")) != norm_str(ing.get("group")):
                    ok_g = False
                    break
            check("ingredient_group", ok_g)

        # instructions: text (per step present) + order (exact sequence)
        t_steps = [norm_str(s) for s in (truth.get("instructions") or [])]
        c_steps = [norm_str(s) for s in (cap.get("instructions") or [])]
        for s in t_steps:
            check("instruction.text", s in c_steps, count_class=False)
        check("instruction.order", c_steps == t_steps)
        # count instruction.text once toward the class tally (avoid over-weighting)
        cls_tally.add(all(s in c_steps for s in t_steps))

        # split / reserved
        t_split = truth.get("split_reserved") or []
        if t_split:
            c_split = cap.get("split_reserved") or []
            ok_s = True
            for sr in t_split:
                # Both the used amount AND the reserved amount must survive as a
                # STRUCTURED pair (THRESHOLD.md split/reserved rule). A loose
                # "the numbers appear somewhere in the instructions" fallback is
                # deliberately NOT accepted: losing the reserve→later-step binding
                # is exactly the silent failure this field guards, so a capture
                # that mentions "150 g" without tying it to a reserve is a miss.
                found = any(
                    norm_str(sr["use"]) in norm_str(cs.get("use"))
                    and norm_str(sr["reserve"]) in norm_str(cs.get("reserve"))
                    for cs in c_split
                )
                ok_s = ok_s and found
            check("split_reserved", ok_s)

        # nutrition (per source-provided field)
        t_nut = truth.get("nutrition") or {}
        if t_nut:
            c_nut = cap.get("nutrition") or {}
            c_nut_norm = {norm_str(k): norm_qty(v) for k, v in c_nut.items()}
            ok_n = all(
                c_nut_norm.get(norm_str(k)) == norm_qty(v) for k, v in t_nut.items()
            )
            check("nutrition", ok_n)

        # classifications
        t_cls = truth.get("classifications") or {}
        if t_cls:
            c_cls = cap.get("classifications") or {}
            c_cls_norm = {norm_str(k): norm_str(v) for k, v in c_cls.items()}
            ok_c = all(c_cls_norm.get(norm_str(k)) == norm_str(v) for k, v in t_cls.items())
            check("classification", ok_c)

        per_fixture.append(fx)

    def rates(d):
        return {k: {"rate": t.rate(), "hit": t.hit, "total": t.total} for k, t in d.items()}

    field_rates = rates(fields)
    edge_rates = rates(edges)
    class_rates = rates(per_class)

    # verdict: every field bar with data AND every edge bar with data must clear
    failing = []
    for k, bar in FIELD_BARS.items():
        r = field_rates[k]["rate"]
        if r is not None and r < bar:
            failing.append(f"{k} {r:.2%} < {bar:.0%}")
    for k, bar in EDGE_BARS.items():
        r = edge_rates[k]["rate"]
        if r is not None and r < bar:
            failing.append(f"edge:{k} {r:.2%} < {bar:.0%}")

    verdict = "PASS" if not failing and not missing_runs else "FAIL"

    # Circularity override: if every present capture is byte-identical to its
    # truth, the numeric bars are tautological and a PASS would be meaningless.
    # The gate can only be established on captures whose ground truth is
    # independent of the reader — see oq14-verdict.md.
    circular = captures_present > 0 and identical_to_truth == captures_present
    if circular:
        verdict = "INCONCLUSIVE_CIRCULAR"

    result = {
        "model": model,
        "verdict": verdict,
        "failing_fields": failing,
        "missing_runs": missing_runs,
        "captures_present": captures_present,
        "identical_to_truth": identical_to_truth,
        "circular": circular,
        "field_scores": field_rates,
        "edge_class_scores": edge_rates,
        "per_class_scores": class_rates,
        "per_fixture": per_fixture,
    }
    (HERE / f"scores-{model}.json").write_text(json.dumps(result, indent=2) + "\n")

    # report
    print(f"# CFV1-S1 capture-quality — model: {model}\n")
    if missing_runs:
        print(f"MISSING RUNS ({len(missing_runs)}): {', '.join(missing_runs)}\n")
    print("per-field (bar):")
    for k, bar in FIELD_BARS.items():
        r = field_rates[k]
        rate = r["rate"]
        flag = "" if rate is None else ("  ✓" if rate >= bar else "  ✗ FAIL")
        shown = "n/a" if rate is None else f"{rate:.0%} ({r['hit']}/{r['total']})"
        print(f"  {k:22s} bar {bar:.0%}   {shown}{flag}")
    print("\nquantity edge classes (bar):")
    for k, bar in EDGE_BARS.items():
        r = edge_rates[k]
        rate = r["rate"]
        flag = "" if rate is None else ("  ✓" if rate >= bar else "  ✗ FAIL")
        shown = "n/a" if rate is None else f"{rate:.0%} ({r['hit']}/{r['total']})"
        print(f"  {k:22s} bar {bar:.0%}   {shown}{flag}")
    print("\nper fixture class:")
    for k, r in class_rates.items():
        rate = r["rate"]
        shown = "n/a" if rate is None else f"{rate:.0%} ({r['hit']}/{r['total']})"
        print(f"  {k:34s} {shown}")
    if circular:
        print(
            f"\nCIRCULARITY GUARD: {identical_to_truth}/{captures_present} captures are "
            "byte-identical to their truth. The measurement is circular — a correct read of\n"
            "self-authored content is indistinguishable from a copy of the answer, so the "
            "numeric bars above are tautological and cannot establish OQ-14 (see oq14-verdict.md)."
        )
    print(f"\nVERDICT (OQ-14): {verdict}")
    if failing:
        print("  failing:", "; ".join(failing))
    return 0


def selftest() -> int:
    """Discrimination proof: the scorer's field comparators must reject wrong
    captures, so a 100% result means the captures were right, not that the scorer
    passes everything (the S1 analog of S5's permissive-reference check).
    """
    checks = [
        # (name, condition-that-must-be-True-for-a-discriminating-scorer)
        ("title mismatch caught", norm_str("Simple Dal") != norm_str("Simple Daal")),
        ("title match accepted", norm_str("Simple Dal") == norm_str(" simple dal. ")),
        ("quantity fraction equal", qty_eq("1 1/2", "1.5") and qty_eq("1/2", "½")),
        ("quantity mismatch caught", not qty_eq("200", "250")),
        ("range equal", qty_eq("2 to 3", "2-3") and qty_eq("120-140 °C", "120 to 140 c")),
        ("range mismatch caught", not qty_eq("2 to 3", "2 to 4")),
        ("unit synonym equal", norm_unit("teaspoon") == norm_unit("tsp")),
        ("unit mismatch caught", norm_unit("tsp") != norm_unit("tbsp")),
        ("ingredient match by name", match_ingredient({"name": "Garlic"}, [{"name": "garlic"}]) is not None),
        ("missing ingredient caught", match_ingredient({"name": "miso"}, [{"name": "tofu"}]) is None),
        # circularity guard: a capture identical to its truth is flagged circular;
        # one that differs is not (the guard that stops a tautological PASS)
        (
            "circular guard: identical flagged",
            canon_json({"title": "A", "n": 1}) == canon_json({"n": 1, "title": "A"}),
        ),
        (
            "circular guard: differing not flagged",
            canon_json({"title": "A"}) != canon_json({"title": "B"}),
        ),
    ]
    ok = True
    print("# scorer self-test (discrimination proof)\n")
    for name, cond in checks:
        print(f"  {'✓' if cond else '✗ FAIL'}  {name}")
        ok = ok and cond
    print(f"\nself-test: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--selftest", action="store_true", help="prove the scorer discriminates")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    return score(args.model)


if __name__ == "__main__":
    sys.exit(main())
