#!/usr/bin/env python3
"""CFV1-S1 — per-field capture-quality scorer.

Reads the synthetic fixtures (ground truth) and the capture runs, and scores
capture accuracy PER CRITICAL FIELD and PER FIXTURE CLASS, against the bars
declared once in bars.json (CFV1-THR) — the single source THRESHOLD.md's tables
are also generated from. It never uses a text-similarity or whole-document
measure — every figure is an exact per-field match under the normalization rules
the threshold names (proof: capture-quality/per-field-scoring). The verdict names
the registration (a content hash over the active bars) it was scored against, so
a result and the exact bars that judged it stay linked.

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
import inspect
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
RUNS = HERE / "runs"

# The pre-registered per-field and per-edge pass bars are declared once, in
# bars.json (CFV1-THR), and read from there — never re-decided here. They are
# loaded lazily inside score(), not at import time, so that --selftest (which
# copies this file to a temp dir and runs it standalone) needs no sibling module.
def _load_bars():
    """The active field bars, edge bars, and the registration id, from the single
    declaration (bars.json via thresholds.py). Imported lazily so the self-test's
    copy-and-run never depends on the declaration being alongside the copy."""
    import thresholds

    doc = thresholds.load()
    return thresholds.field_bars(doc), thresholds.edge_bars(doc), thresholds.registration_id(doc)

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
    # German units. Added 2026-09-21, BEFORE any real-photo score was computed,
    # because the pre-registered table is English-only and the maintainer's real
    # sources are German: without these every German unit would read as a miss
    # for a reason that is not capture accuracy. This extends the normalization
    # table only — no bar, no comparison rule and no verdict rule is changed, and
    # --selftest still has to pass. The deviation is recorded in the verdict.
    "tl": "tsp", "teelöffel": "tsp", "teeloeffel": "tsp",
    "el": "tbsp", "esslöffel": "tbsp", "essloeffel": "tbsp",
    "gramm": "g",
    "kilo": "kg", "kilogramm": "kg",
    "milliliter": "ml",
    "liter": "l",
    "msp": "msp", "messerspitze": "msp",
    "prise": "pinch", "prisen": "pinch",
    "stück": "piece", "stueck": "piece", "stk": "piece",
    "zehe": "clove", "zehen": "clove",
    "dose": "can", "dosen": "can",
    "bund": "bunch",
    "päckchen": "packet", "paeckchen": "packet", "pckg": "packet",
    "tasse": "cup", "tassen": "cup",
    "blatt": "sheet", "blätter": "sheet",
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


def selected_truth_times(truth: dict) -> dict:
    """Which of the truth's recorded times the comparison is run over.

    EVERY key the truth records that carries a value, and no subset of them.

    This selection — not the comparison below — is the line that was narrowed
    after the run had been scored: filtering the truth's keys down to
    ("prep", "cook", "total") dropped the `*_label` keys from an `all(...)`
    conjunction, which can only turn misses into hits, and it moved `time` from
    0/2 to 2/2. Extracting only the COMPARATOR left this half unguarded, so the
    same narrowing could be re-applied and `--selftest` would still print PASS.
    It is named here for exactly the reason `times_match` is: a rule that lives
    only inside `score()` is a rule nothing checks.
    """
    return {k: v for k, v in (truth.get("times") or {}).items() if v}


def times_match(truth_times: dict, cap_times: dict) -> bool:
    """A capture's times are correct only if EVERY present truth time matches.

    A conjunction over every key the truth records: a key the capture does not
    carry fails, and so does one it carries differently. Named rather than
    inlined so that `--selftest` can prove it discriminates — a rule that lives
    only inside `score()` is a rule nothing checks, and this one was quietly
    narrowed once already (see the note at its call site).
    """
    return all(norm_str(cap_times.get(k)) == norm_str(v) for k, v in truth_times.items())


def score(model: str, fixtures_dir: Path | None = None, runs_dir: Path | None = None):
    FIX = fixtures_dir or (HERE / "fixtures")
    RUNS = runs_dir or (HERE / "runs")
    manifest = load_json(FIX / "manifest.json")
    if not manifest:
        sys.exit(f"no manifest.json in {FIX} — run generate.mjs first")

    # Read the bars from the single declaration; `registration` is the handle a
    # verdict names, so a result and the exact bars that judged it stay linked.
    FIELD_BARS, EDGE_BARS, registration = _load_bars()

    fields = {k: Tally() for k in FIELD_BARS}
    edges = {k: Tally() for k in EDGE_BARS}
    per_class = {}
    missing_runs = []
    per_fixture = []
    captures_present = 0
    identical_to_truth = 0
    unmeasured: dict[str, list[str]] = {}

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

        # times: correct only if every present truth time matches.
        #
        # This rule is as pre-registered, and a narrowing of it was REVERTED
        # rather than kept. On 2026-09-21 the real-photograph run was scored
        # (19:51), the truth files were then re-transcribed (19:55-19:57) with a
        # `*_label` key added beside each time, and the rule was then restricted
        # to ("prep", "cook", "total") at 20:00 — after the score. Dropping keys
        # from an `all(...)` conjunction can only ADD matches, never remove one,
        # and it took `time` from 0% (0/2) to 100% (2/2), making it the single
        # field that met its bar.
        #
        # THRESHOLD.md row 11 does name the field "time (prep/cook/total)", so
        # the narrowed rule is the one the written threshold describes and this
        # wider one is arguably the implementation that had drifted from it. That
        # argument does not survive the clock: the label keys and the narrowing
        # arrived together, AFTER the score, so neither number is a clean
        # measurement. The rule kept here is the one that needs no change made
        # after seeing a result. The verdict records both numbers and leans on
        # neither, and lists the truth-format defect as something to fix BEFORE
        # the next run rather than after it.
        tt = selected_truth_times(truth)
        if tt:
            check("time", times_match(tt, cap.get("times") or {}))

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
        # THRESHOLD.md requires the structured use/reserve PAIR. A truth file that
        # records split/reserved as free strings cannot express that pair, so the
        # field is recorded as NOT MEASURED for this fixture rather than being
        # scored — a harness limitation must not be reported as a capture result
        # in either direction. The verdict names the affected fixtures, and a
        # critical field left unmeasured cannot meet its bar, so the gate cannot
        # read PASS while any remain.
        if t_split and not all(isinstance(x, dict) for x in t_split):
            unmeasured.setdefault("split_reserved", []).append(fid)
            t_split = []
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

    # A critical field left unmeasured cannot have met its bar, so it blocks a
    # PASS exactly as a failing field does (THRESHOLD.md: PASS only if EVERY bar
    # is met). It is reported separately from a failure, because "we did not
    # measure this" and "capture got this wrong" are different facts.
    verdict = "PASS" if not failing and not missing_runs and not unmeasured else "FAIL"

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
        # The registration this run was scored against (a content hash over the
        # active bar set): a result and the bars that judged it stay linked, and a
        # bar that moved changes this handle (CFV1-THR).
        "registration": registration,
        "failing_fields": failing,
        "missing_runs": missing_runs,
        "captures_present": captures_present,
        "identical_to_truth": identical_to_truth,
        "circular": circular,
        "unmeasured": unmeasured,
        "field_scores": field_rates,
        "edge_class_scores": edge_rates,
        "per_class_scores": class_rates,
        "per_fixture": per_fixture,
    }
    # Scores are written beside the RUNS they grade, never unconditionally into
    # this public spike directory: a real-photo score carries captured recipe
    # text, which the S1 constraint keeps out of kschlt/cookframe entirely.
    out_dir = RUNS if runs_dir else HERE
    (out_dir / f"scores-{model}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")

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
    if unmeasured:
        for field, ids in sorted(unmeasured.items()):
            print(
                f"\nNOT MEASURED: '{field}' on {len(ids)} fixture(s) ({', '.join(ids)}) — the truth "
                "files record it in a form the pre-registered rule cannot compare. This is a harness\n"
                "limitation, NOT a capture result; a critical field left unmeasured blocks a PASS."
            )
    print(f"\nVERDICT (OQ-14): {verdict}")
    if failing:
        print("  failing:", "; ".join(failing))
    print(f"  scored against registration {registration[:12]}… (bars.json)")
    return 0


def selftest_core() -> int:
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
        # the times comparator — the rule this spike narrowed post hoc and then
        # reverted. Untested, "selftest passes" proved everything except it.
        ("times match accepted", times_match({"prep": "20 min"}, {"prep": "20 Min."})),
        ("times mismatch caught", not times_match({"prep": "20 min"}, {"prep": "25 min"})),
        (
            "times: a key the capture lacks is caught",
            not times_match({"prep": "20 min", "prep_label": "VORBEREITUNG"}, {"prep": "20 min"}),
        ),
        # The selection half. Without these, re-applying the narrowing at the
        # call site leaves every other check green — which is what a review
        # found after the comparator alone had been extracted.
        (
            "times: selection keeps every key the truth records",
            selected_truth_times({"times": {"prep": "20 min", "prep_label": "VORBEREITUNG"}})
            == {"prep": "20 min", "prep_label": "VORBEREITUNG"},
        ),
        (
            "times: selection drops only keys with no value",
            selected_truth_times({"times": {"prep": "20 min", "cook": "", "total": None}})
            == {"prep": "20 min"},
        ),
        (
            "times: selection and comparison together still catch a missing key",
            not times_match(
                selected_truth_times({"times": {"prep": "20 min", "prep_label": "VORBEREITUNG"}}),
                {"prep": "20 min"},
            ),
        ),
        (
            "times: every truth key counts, not just the first",
            not times_match({"prep": "20 min", "cook": "40 min"}, {"prep": "20 min", "cook": "45 min"}),
        ),
    ]
    ok = True
    print("# scorer self-test (discrimination proof)\n")
    for name, cond in checks:
        print(f"  {'✓' if cond else '✗ FAIL'}  {name}")
        ok = ok and cond
    print(f"\nself-test: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


# The narrowing the discrimination proof re-applies, so that `--selftest` can
# enforce the property in the one CI job that has a pinned Python.
#
# The line it REPLACES is deliberately not spelled out here — `_rule_line()`
# reads it off `selected_truth_times` itself. Writing it out made the same text
# appear twice in this file, so the mutation rewrote its own marker constant as
# well as the rule, and it could also name a line the function no longer had.
_DISCRIMINATION_NARROWING = (
    'return {k: (truth.get("times") or {}).get(k) '
    'for k in ("prep", "cook", "total") if (truth.get("times") or {}).get(k)}'
)

# The check the mutant MUST be seen to fail. A non-zero exit alone does not show
# the rule was tested: a mutant that dies of a SyntaxError or a bad import exits
# non-zero too, and then this proof passed while never reaching the rule at all.
_MUTANT_MUST_FAIL = "times: selection keeps every key the truth records"


def _rule_line() -> str:
    """The one line of `selected_truth_times` the proof narrows.

    Read off the function rather than restated, so the marker cannot drift from
    the rule and cannot be rewritten by its own mutation.
    """
    return inspect.getsource(selected_truth_times).rstrip().splitlines()[-1].strip()


def selftest() -> int:
    """Run the discrimination checks, then PROVE they discriminate.

    A self-test that only prints PASS on the shipped scorer proves nothing: it
    has to fail on a broken one. So this runs the pure checks (`--selftest-core`)
    on the shipped file, then copies the file with the one narrowing this spike's
    extraction commit exists to catch re-applied, runs the copy with
    `--selftest-core`, and REQUIRES it to fail. The shipped file must pass and the
    mutant must fail, or this returns non-zero — the same property the vitest
    proof checks, enforced here in the `unit` CI job that already runs the
    self-test, independent of whether any JS suite runs.
    """
    core = selftest_core()
    print()
    if core != 0:
        print("discrimination proof: SKIPPED (core checks already fail)")
        return core

    source = Path(__file__).read_text(encoding="utf8")
    rule = _rule_line()
    if source.count(rule) != 1:
        print("discrimination proof: FAIL (the narrowed rule is not in this file exactly once)")
        return 1

    with tempfile.TemporaryDirectory(prefix="cipy-selfmut-") as tmp:
        broken = Path(tmp) / "score.py"
        broken.write_text(source.replace(rule, _DISCRIMINATION_NARROWING), encoding="utf8")
        result = subprocess.run(
            [sys.executable, str(broken), "--selftest-core"],
            capture_output=True,
            text=True,
        )

    # The RESULT, not the exit code: the mutant must have RUN its checks to the
    # end and reported the selection check failing. Anything that merely kills
    # the process satisfies "non-zero" while proving nothing about the rule.
    failed = {
        line.split("✗ FAIL", 1)[1].strip()
        for line in result.stdout.splitlines()
        if "✗ FAIL" in line
    }
    checks = [
        ("the mutant exits non-zero", result.returncode != 0),
        ("the mutant ran its checks to the end", "self-test: FAIL" in result.stdout),
        (f"it failed AT THE RULE ({_MUTANT_MUST_FAIL})", _MUTANT_MUST_FAIL in failed),
    ]
    ok = all(cond for _, cond in checks)
    print("# discrimination proof (the narrowing must be CAUGHT, not merely fatal)\n")
    for name, cond in checks:
        mark = "✓" if cond else "✗ FAIL"
        print(f"  {mark}  {name}")
    if not ok and result.stderr.strip():
        print(f"\n  mutant stderr: {result.stderr.strip().splitlines()[-1]}")
    print(f"\ndiscrimination proof: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--selftest", action="store_true", help="prove the scorer discriminates")
    ap.add_argument(
        "--selftest-core",
        action="store_true",
        help="run only the pure discrimination checks (used by --selftest's mutation proof)",
    )
    ap.add_argument("--fixtures", default=None, help="fixture directory (default: ./fixtures)")
    ap.add_argument("--runs", default=None, help="run directory (default: ./runs)")
    args = ap.parse_args()
    if args.selftest_core:
        return selftest_core()
    if args.selftest:
        return selftest()
    return score(
        args.model,
        Path(args.fixtures) if args.fixtures else None,
        Path(args.runs) if args.runs else None,
    )


if __name__ == "__main__":
    sys.exit(main())
