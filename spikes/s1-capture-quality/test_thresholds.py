#!/usr/bin/env python3
"""CFV1-THR proofs — the capture-quality bars are declared once, and a bar is
never edited to fit a result.

Each check prints the acceptance-criterion id it proves and PASS/FAIL, and the
run exits non-zero if any fails — the same shape as `score.py --selftest`, so it
runs in the `unit` CI job (which has a pinned Python) and needs nothing from the
Node container image. Every check plants the violation it guards against and
requires it caught, so a green run means the discipline holds, not that the test
waves everything through.

Covered here (all six CFV1-THR acceptance criteria):
  thresholds/single-declaration                     (scorer AND document ↔ one declaration)
  thresholds/every-bar-is-dated-and-reasoned
  thresholds/in-place-edit-refused
  thresholds/revision-supersedes-rather-than-overwrites
  thresholds/no-bar-value-changed
  thresholds/verdict-names-its-registration
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

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
    # Scorer half: the scorer reads its bars from the SAME declaration and keeps
    # no independent copy. score._load_bars() returns exactly the declaration's
    # active bars and registration, and score.py carries no hard-coded bar dict.
    import score
    fb, eb, reg = score._load_bars()
    if fb != T.field_bars(doc) or eb != T.edge_bars(doc) or reg != T.registration_id(doc):
        return False
    src = (T.HERE / "score.py").read_text()
    # Plant: a re-introduced hard-coded bar dict (a numeric FIELD_BARS/EDGE_BARS
    # literal) would be a second source of truth — this catches it.
    if re.search(r"FIELD_BARS\s*=\s*\{[^}]*[0-9]", src) or re.search(r"EDGE_BARS\s*=\s*\{[^}]*[0-9]", src):
        return False
    return True


# --- thresholds/every-bar-is-dated-and-reasoned -----------------------------


def every_bar_is_dated_and_reasoned() -> bool:
    doc = T.load()
    # The PRODUCTION rule (validate_meta) accepts every committed active entry —
    # this proof calls that function, it does not re-implement the check.
    for e in T.active_entries(doc):
        if T.validate_meta(e.get("registered"), e.get("reasoning")):
            return False
    # The same production rule fires at rest: a blanked reason is reported by
    # verify_integrity even when the entry's hash is freshly (re)computed, so the
    # rule is not something only the hash happens to protect.
    blank = copy.deepcopy(doc)
    blank["registrations"][0]["reasoning"] = "   "
    blank = T.seal(blank)  # fresh hashes — only the meta rule can still object
    if not any("reasoning is empty" in p for p in T.verify_integrity(blank)):
        return False
    # And it fires on the WRITE path: register refuses an undated or unreasoned
    # entry, so a bad registration cannot be committed in the first place.
    syn = _synthetic()
    for registered, reasoning in [("2026-09-22", "   "), ("yesterday", "sensible")]:
        try:
            T.register(syn, "gravy_viscosity", "field", 0.42, registered, reasoning)
            return False  # should have refused
        except T.RegistryInvalid:
            pass
    return True


# --- thresholds/in-place-edit-refused ---------------------------------------

def _cli(workdir: Path, *args: str) -> subprocess.CompletedProcess:
    """Run the shipped thresholds.py CLI in a working copy — the path a human
    actually takes, not a library call the shipped commands never reach."""
    return subprocess.run(
        [sys.executable, str(workdir / "thresholds.py"), *args],
        capture_output=True,
        text=True,
    )


def in_place_edit_refused() -> bool:
    # --- write boundary: assert_append_only refuses an edit or a drop ---
    doc = _synthetic()
    edited = copy.deepcopy(doc)
    edited["registrations"][0]["value"] = 0.10
    try:
        T.assert_append_only(doc, edited)
        return False  # should have raised
    except T.InPlaceEditRefused:
        pass
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

    # --- the CLI path, on a copy of the COMMITTED registry ---
    # A review reproduced the exact documented-route violation: hand-edit a bar in
    # place, then run the tooling. This drives it through the shipped CLI and
    # requires each launder attempt caught.
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        shutil.copy(T.HERE / "thresholds.py", tmp / "thresholds.py")
        shutil.copy(T.BARS_PATH, tmp / "bars.json")
        shutil.copy(T.DOC_PATH, tmp / "THRESHOLD.md")
        base = tmp / "base.json"
        shutil.copy(T.BARS_PATH, base)  # the committed baseline to compare against

        # The laundering command is gone: `seal` is not a subcommand at all, so
        # there is no CLI path that recomputes an existing entry's hash.
        seal = _cli(tmp, "seal")
        if seal.returncode == 0 or "invalid choice" not in seal.stderr:
            return False

        # The committed registry verifies clean before any tampering.
        if _cli(tmp, "verify").returncode != 0:
            return False

        def _write(reg: dict) -> None:
            (tmp / "bars.json").write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n")

        # Plant: hand-edit `temperature` (a food-safety bar) 0.98 -> 0.80 in place,
        # no entry appended — exactly the reproduced attack.
        reg = json.loads((tmp / "bars.json").read_text())
        temp = next(e for e in reg["registrations"] if e["bar"] == "temperature" and e["kind"] == "field")
        temp["value"] = 0.80
        _write(reg)
        # At-rest catch: the stored hash is now stale, so `verify` reports INVALID.
        if _cli(tmp, "verify").returncode == 0:
            return False

        # A publication path must not carry an unverified edit into the document:
        # gen-doc --write refuses while the registry is INVALID and leaves the
        # document untouched, so gen-doc --check cannot later "agree" with a doc
        # that a hand-edit had smuggled the lowered bar into.
        doc_before = (tmp / "THRESHOLD.md").read_text()
        gw = _cli(tmp, "gen-doc", "--write")
        if gw.returncode == 0 or (tmp / "THRESHOLD.md").read_text() != doc_before:
            return False

        # Strongest launder: forge a fresh hash so `verify` alone would pass...
        temp["hash"] = T.entry_hash(temp)
        _write(reg)
        if _cli(tmp, "verify").returncode != 0:
            return False  # the forge does defeat the at-rest hash check on its own
        # ...but append-only-check against the committed baseline still refuses it.
        laundered = _cli(tmp, "append-only-check", "--baseline-file", str(base))
        if laundered.returncode == 0 or "append-only VIOLATED" not in laundered.stdout:
            return False

        # append-only-check fails CLOSED when the base ref cannot be resolved (a
        # too-shallow checkout is the real-world case): it refuses, it does not
        # wave the change through. This temp dir is not a git work tree, so any
        # ref is unresolvable — the guard must still refuse, not pass vacuously.
        unresolved = _cli(tmp, "append-only-check", "--git-base", "no-such-ref-xyz")
        if unresolved.returncode == 0:
            return False

        # A legitimate appended revision, by contrast, passes append-only-check.
        good = T.register(
            json.loads(base.read_text()), "temperature", "field", 0.97, "2026-09-22", "tightened after real runs"
        )
        _write(good)
        if _cli(tmp, "append-only-check", "--baseline-file", str(base)).returncode != 0:
            return False

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


# --- thresholds/verdict-names-its-registration ------------------------------

def verdict_names_its_registration() -> bool:
    import score
    doc = T.load()
    want = T.registration_id(doc)
    # The registration is sensitive to the bars: a moved bar changes it, so it is
    # not a constant string pasted into every verdict.
    mutated = copy.deepcopy(doc)
    mutated["registrations"][0]["value"] = 0.5
    if T.registration_id(mutated) == want:
        return False
    # A produced verdict names the current registration. Scored in a temp copy so
    # no recorded verdict in the tree is revised (CFV1-THR "What NOT").
    with tempfile.TemporaryDirectory() as d:
        fix, runs = Path(d) / "fixtures", Path(d) / "runs"
        shutil.copytree(T.HERE / "fixtures", fix)
        shutil.copytree(T.HERE / "runs", runs)
        with contextlib.redirect_stdout(io.StringIO()):
            score.score("sonnet", fix, runs)
        written = json.loads((runs / "scores-sonnet.json").read_text())
    return written.get("registration") == want


CHECKS = [
    ("thresholds/single-declaration", single_declaration),
    ("thresholds/every-bar-is-dated-and-reasoned", every_bar_is_dated_and_reasoned),
    ("thresholds/in-place-edit-refused", in_place_edit_refused),
    ("thresholds/revision-supersedes-rather-than-overwrites", revision_supersedes_rather_than_overwrites),
    ("thresholds/no-bar-value-changed", no_bar_value_changed),
    ("thresholds/verdict-names-its-registration", verdict_names_its_registration),
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
