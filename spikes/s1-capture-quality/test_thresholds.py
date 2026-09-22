#!/usr/bin/env python3
"""CFV1-THR proofs — the capture-quality bars are declared once, and a bar is
never edited to fit a result.

Each check prints the acceptance-criterion id it proves and PASS/FAIL, and the
run exits non-zero if any fails — the same shape as `score.py --selftest`, so it
runs in the `unit` CI job (which has a pinned Python) and needs nothing from the
Node container image. Every check plants the violation it guards against and
requires it caught, so a green run means the discipline holds, not that the test
waves everything through.

Covered here (declaration + tooling, independent of the scorer):
  thresholds/single-declaration                     (document ↔ declaration half)
  thresholds/every-bar-is-dated-and-reasoned
  thresholds/in-place-edit-refused
  thresholds/revision-supersedes-rather-than-overwrites
  thresholds/no-bar-value-changed

The scorer-side half of `thresholds/single-declaration` (the scorer reads its
bars from the declaration) and `thresholds/verdict-names-its-registration` are
proven where the scorer is wired to the declaration; see score.py's tests.
"""
from __future__ import annotations

import copy
import re
import sys

import thresholds as T

# The pre-registered bar values, pinned here as an independent literal. This is
# the same set score.py carried as FIELD_BARS/EDGE_BARS before CFV1-THR moved
# them into the declaration; CFV1-THR moves them and changes not one number, so
# these are the values the active declaration must still produce.
EXPECTED_FIELD_BARS = {
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
EXPECTED_EDGE_BARS = {"fractions": 0.98, "ranges": 0.98, "ambiguous_units": 0.95, "multiple_yields": 0.98}


def _synthetic() -> dict:
    """A tiny, self-contained registry (never the committed one) for mutation tests."""
    doc = {
        "note": "synthetic",
        "registrations": [
            {"seq": 1, "bar": "title", "kind": "field", "value": 0.95,
             "registered": "2026-09-20", "reasoning": "recipe identity", "supersedes": None},
            {"seq": 2, "bar": "fractions", "kind": "edge", "value": 0.98,
             "registered": "2026-09-20", "reasoning": "a misread fraction is a wrong amount",
             "supersedes": None},
        ],
    }
    return T.seal(doc)


# --- thresholds/single-declaration (document ↔ declaration) -----------------

def single_declaration() -> bool:
    doc = T.load()
    current = T.DOC_PATH.read_text()
    # The committed document already matches the declaration.
    if T.render_doc(doc, current) != current:
        return False
    # Plant: a bar changed in the declaration must change the rendered document,
    # so the two cannot silently disagree — a drift would fail `gen-doc --check`.
    drifted = copy.deepcopy(doc)
    drifted["registrations"][0]["value"] = 0.5
    if T.render_doc(drifted, current) == current:
        return False
    # Plant: a bar table hand-edited in the document no longer matches the
    # declaration, so a hand-edit is caught rather than accepted.
    tampered = current.replace("**≥ 98%**", "**≥ 50%**", 1)
    if tampered != current and T.render_doc(doc, tampered) == tampered:
        return False
    return True


# --- thresholds/every-bar-is-dated-and-reasoned -----------------------------

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def every_bar_is_dated_and_reasoned() -> bool:
    doc = T.load()
    for e in T.active_entries(doc):
        if not (isinstance(e.get("registered"), str) and _DATE.match(e["registered"])):
            return False
        if not (isinstance(e.get("reasoning"), str) and e["reasoning"].strip()):
            return False
    # Plant: an entry with a blank reasoning must be rejected by this rule.
    blank = _synthetic()
    blank["registrations"][0]["reasoning"] = "   "
    ok_blank = all(
        isinstance(e.get("reasoning"), str) and e["reasoning"].strip()
        for e in T.active_entries(blank)
    )
    return not ok_blank


# --- thresholds/in-place-edit-refused ---------------------------------------

def in_place_edit_refused() -> bool:
    doc = _synthetic()
    # A raw in-place value edit is refused at the write boundary.
    edited = copy.deepcopy(doc)
    edited["registrations"][0]["value"] = 0.10
    try:
        T.assert_append_only(doc, edited)
        return False  # should have raised
    except T.InPlaceEditRefused:
        pass
    # Dropping an entry is refused too.
    dropped = {**doc, "registrations": doc["registrations"][1:]}
    try:
        T.assert_append_only(doc, dropped)
        return False
    except T.InPlaceEditRefused:
        pass
    # A pure append (a sanctioned revision) is allowed.
    revised = T.register(doc, "title", "field", 0.97, "2026-09-22", "tightened after real runs")
    try:
        T.assert_append_only(doc, revised)
    except T.InPlaceEditRefused:
        return False
    # And a raw hand-tamper that leaves the stored hash stale is caught at rest.
    if T.verify_integrity(doc):
        return False  # the clean registry must verify
    tampered = copy.deepcopy(doc)
    tampered["registrations"][0]["value"] = 0.10  # value changed, hash left stale
    if not T.verify_integrity(tampered):
        return False  # must report the mismatch
    return True


# --- thresholds/revision-supersedes-rather-than-overwrites ------------------

def revision_supersedes_rather_than_overwrites() -> bool:
    doc = _synthetic()
    before = len(doc["registrations"])
    revised = T.register(doc, "title", "field", 0.97, "2026-09-22", "tightened after real runs")
    # The revision APPENDS: one more entry, none removed.
    if len(revised["registrations"]) != before + 1:
        return False
    # The superseded entry is still present and readable, unchanged.
    old = next((e for e in revised["registrations"] if e["seq"] == 1), None)
    if old is None or old["value"] != 0.95 or old["registered"] != "2026-09-20":
        return False
    # The active `title` bar is now the new value, and only one is active.
    actives = [e for e in T.active_entries(revised) if e["bar"] == "title" and e["kind"] == "field"]
    if len(actives) != 1 or actives[0]["value"] != 0.97:
        return False
    # The new entry records what it superseded, so the chain is followable.
    if actives[0].get("supersedes") != 1:
        return False
    # The registry still verifies after the revision.
    return not T.verify_integrity(revised)


# --- thresholds/no-bar-value-changed ----------------------------------------

def no_bar_value_changed() -> bool:
    doc = T.load()
    return T.field_bars(doc) == EXPECTED_FIELD_BARS and T.edge_bars(doc) == EXPECTED_EDGE_BARS


CHECKS = [
    ("thresholds/single-declaration", single_declaration),
    ("thresholds/every-bar-is-dated-and-reasoned", every_bar_is_dated_and_reasoned),
    ("thresholds/in-place-edit-refused", in_place_edit_refused),
    ("thresholds/revision-supersedes-rather-than-overwrites", revision_supersedes_rather_than_overwrites),
    ("thresholds/no-bar-value-changed", no_bar_value_changed),
]


def main() -> int:
    print("# CFV1-THR threshold-declaration proofs\n")
    ok = True
    for name, fn in CHECKS:
        try:
            passed = fn()
        except Exception as exc:  # a raising proof is a failing proof
            passed = False
            print(f"  ✗ FAIL  {name}  ({type(exc).__name__}: {exc})")
            ok = False
            continue
        print(f"  {'✓' if passed else '✗ FAIL'}  {name}")
        ok = ok and passed
    print(f"\nthreshold proofs: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
