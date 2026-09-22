#!/usr/bin/env python3
"""CFV1-THR — the one declaration of the capture-quality bars, and the discipline
that keeps it a pre-registration rather than a value that drifts.

The bars used to live twice: as prose in `THRESHOLD.md` and as the `FIELD_BARS`
and `EDGE_BARS` dicts hard-coded in `score.py`. Two copies of a number that must
agree can drift, and when they do nobody can say afterwards which one was the
registration. This module makes `bars.json` the single source: the scorer reads
the active bars from here, and `THRESHOLD.md`'s bar tables are generated from
here (`gen-doc`), so the two cannot silently disagree.

The registry is **append-only**, and that discipline is enforced on the path a
change actually travels, not in a review checklist:

- The one sanctioned way to change a bar is `register` — a CLI subcommand, not
  just a library call — which only ever APPENDS a new dated entry that supersedes
  the old one; the superseded entry stays in the file with its date and reasoning
  intact. It refuses an undated or unreasoned entry where the write happens.
- There is deliberately no command that recomputes an existing entry's hash over
  whatever is on disk. A raw hand-edit therefore leaves the entry's stored hash
  stale, which `verify` reports as tampering — the at-rest catch.
- `append-only-check` compares the registry against its committed baseline (a git
  ref, or a file) and refuses any change to an existing entry — so an edit that
  also forges a fresh hash, which the at-rest check alone would miss, is caught
  against what was actually committed. This is `assert_append_only` on the CLI.

A "registration" is addressable by a content hash over the ACTIVE bar set
(`registration_id`). A recorded verdict names that hash, so a result and the
exact bars that judged it can never be separated afterwards — and a bar that
moved changes the hash, so an old verdict's registration no longer matches.

This module changes NO bar value, comparison rule or verdict rule; it only moves
the bars into one place and builds the discipline around them (CFV1-THR "What
NOT"). Tuning the bars is separate work with its own evidence and registration.

Usage:
    python3 thresholds.py verify              # integrity + structure; nonzero on any problem
    python3 thresholds.py bars                # print the active field/edge bars
    python3 thresholds.py id                  # print the active registration id
    python3 thresholds.py gen-doc --check     # THRESHOLD.md tables match the declaration?
    python3 thresholds.py gen-doc --write     # regenerate THRESHOLD.md's bar tables
    python3 thresholds.py register --bar temperature --kind field \\
        --value 0.97 --registered 2026-09-22 --reasoning "…"   # append a revision
    python3 thresholds.py append-only-check --git-base <ref>    # refuse an in-place edit vs a baseline
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BARS_PATH = HERE / "bars.json"
DOC_PATH = HERE / "THRESHOLD.md"

# The identity of a registration entry: the fields a content hash is taken over.
# `hash` is derived from these and is NOT itself part of the identity.
IDENTITY_FIELDS = ("seq", "bar", "kind", "value", "registered", "reasoning", "supersedes")

# The keys every entry must carry to be structurally usable at all.
_REQUIRED_FIELDS = ("seq", "bar", "kind", "value", "registered", "reasoning")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Markers in THRESHOLD.md that bound the generated bar tables. Everything outside
# them is hand-written prose; everything between is generated from bars.json.
FIELD_BEGIN = "<!-- BEGIN GENERATED FIELD BARS -->"
FIELD_END = "<!-- END GENERATED FIELD BARS -->"
EDGE_BEGIN = "<!-- BEGIN GENERATED EDGE BARS -->"
EDGE_END = "<!-- END GENERATED EDGE BARS -->"


class InPlaceEditRefused(Exception):
    """Raised when a proposed registry would change or drop an existing entry.

    The registry is append-only: the only sanctioned change is a new entry. This
    is the refusal the item requires to live where the write happens, not in a
    review checklist.
    """


class RegistryInvalid(Exception):
    """Raised when the registry is structurally unusable (bad hash, duplicate seq,
    a missing required field, a bar with no single active entry, a dangling
    supersedes, or an undated/unreasoned entry)."""


def _canon(obj) -> str:
    """A stable, order-independent serialization for hashing."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _identity(entry: dict) -> dict:
    return {k: entry.get(k) for k in IDENTITY_FIELDS}


def entry_hash(entry: dict) -> str:
    """The content hash of an entry's identity fields (not its stored `hash`)."""
    return hashlib.sha256(_canon(_identity(entry)).encode("utf-8")).hexdigest()


def load(path: Path | None = None) -> dict:
    p = path or BARS_PATH
    return json.loads(p.read_text(encoding="utf-8"))


def save(doc: dict, path: Path | None = None) -> None:
    p = path or BARS_PATH
    p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def seal(doc: dict) -> dict:
    """Return a copy of the registry with every entry's `hash` (re)computed.

    Authoring-only helper for building a synthetic or brand-new registry in code
    (the tests use it). It is deliberately NOT a CLI command and must NEVER be run
    against the committed file: recomputing hashes there would paper over exactly
    the in-place edit `verify_integrity` and `append-only-check` exist to catch.
    New entries added through `register` get their hash at append time, so the
    committed registry never needs resealing.
    """
    out = {**doc, "registrations": []}
    for e in doc["registrations"]:
        out["registrations"].append({**{k: e[k] for k in IDENTITY_FIELDS}, "hash": entry_hash(e)})
    return out


def validate_meta(registered, reasoning) -> list[str]:
    """The date-and-reasoning rule, as a production function (not only a test).

    Every registered bar must carry an ISO date and a non-empty reason. This is
    called both where an entry is written (`register` refuses a bad one) and at
    rest (`verify_integrity` reports one), so the rule is enforced on the real
    path, not re-implemented inside a proof.
    """
    problems: list[str] = []
    if not (isinstance(registered, str) and _DATE_RE.match(registered)):
        problems.append(f"registered {registered!r} is not an ISO date (YYYY-MM-DD)")
    if not (isinstance(reasoning, str) and reasoning.strip()):
        problems.append("reasoning is empty; every bar must record why it is critical")
    return problems


def verify_integrity(doc: dict) -> list[str]:
    """Return a list of problems; empty means the registry is sound.

    Catches a raw in-place edit (an entry whose stored hash no longer matches its
    contents), a missing required field, an undated/unreasoned entry, duplicate
    sequence numbers, a `supersedes` that points at nothing, and any bar that does
    not resolve to exactly one active entry.
    """
    problems: list[str] = []
    regs = doc.get("registrations", [])
    seqs = [e.get("seq") for e in regs]
    if len(seqs) != len(set(seqs)):
        problems.append("duplicate seq numbers in the registry")
    known = set(seqs)
    for e in regs:
        missing = [k for k in _REQUIRED_FIELDS if e.get(k) is None]
        if missing:
            problems.append(f"entry seq={e.get('seq')} is missing required field(s): {', '.join(missing)}")
            # Skip the hash/meta checks for a structurally broken entry — its
            # identity is not well-defined — but keep scanning the rest.
            continue
        want = entry_hash(e)
        if e.get("hash") != want:
            problems.append(
                f"entry seq={e.get('seq')} ({e.get('bar')}) hash mismatch — an in-place edit: "
                f"stored {str(e.get('hash'))[:12]}…, recomputed {want[:12]}…"
            )
        problems.extend(
            f"entry seq={e.get('seq')} ({e.get('bar')}): {p}"
            for p in validate_meta(e.get("registered"), e.get("reasoning"))
        )
        sup = e.get("supersedes")
        if sup is not None and sup not in known:
            problems.append(f"entry seq={e.get('seq')} supersedes {sup}, which does not exist")
    # every bar must resolve to exactly one active entry
    try:
        _active_map(doc)
    except RegistryInvalid as exc:
        problems.append(str(exc))
    return problems


def _active_map(doc: dict) -> dict[tuple[str, str], dict]:
    """Map each (kind, bar) to its single active entry (the one no later entry
    supersedes). Keyed by the pair, not the bar name alone, because a bar name can
    exist under two kinds — `multiple_yields` is both a field bar and an edge bar.

    A structurally broken entry (missing seq/kind/bar) raises `RegistryInvalid`
    rather than a bare `KeyError`, so a malformed registry produces the tool's
    "registry INVALID" report instead of a traceback.
    """
    regs = doc.get("registrations", [])
    for e in regs:
        for k in ("seq", "kind", "bar"):
            if e.get(k) is None:
                raise RegistryInvalid(
                    f"entry {e.get('seq', '?')} is missing required field {k!r}"
                )
    superseded = {e["supersedes"] for e in regs if e.get("supersedes") is not None}
    active: dict[tuple[str, str], dict] = {}
    for e in regs:
        if e["seq"] in superseded:
            continue
        key = (e["kind"], e["bar"])
        if key in active:
            raise RegistryInvalid(
                f"{e['kind']} bar '{e['bar']}' has more than one active entry "
                f"(seq {active[key]['seq']} and {e['seq']}); a revision must supersede the entry "
                "it replaces"
            )
        active[key] = e
    return active


def active_entries(doc: dict) -> list[dict]:
    """The active entries, in a stable order (by kind then bar name)."""
    return [active for _, active in sorted(_active_map(doc).items())]


def field_bars(doc: dict) -> dict[str, float]:
    return {e["bar"]: e["value"] for e in active_entries(doc) if e["kind"] == "field"}


def edge_bars(doc: dict) -> dict[str, float]:
    return {e["bar"]: e["value"] for e in active_entries(doc) if e["kind"] == "edge"}


def registration_id(doc: dict) -> str:
    """A content hash over the ACTIVE bar set — the handle a verdict names.

    Taken over (bar, kind, value) alone: it identifies the numbers a run was
    judged against, so it changes if and only if an active bar changes. The date
    and reasoning are part of the entry's own hash, not of this handle.
    """
    payload = sorted([e["bar"], e["kind"], e["value"]] for e in active_entries(doc))
    return hashlib.sha256(_canon(payload).encode("utf-8")).hexdigest()


def assert_append_only(old: dict, new: dict) -> None:
    """Refuse a proposed registry that changes or drops an existing entry.

    The only sanctioned difference between the committed registry and a new one is
    appended entries. If any entry present in `old` (matched by seq) is missing
    from `new` or differs in any identity field, this raises — the write is
    refused here, at the point of writing, not flagged later in a review.

    Matched by seq AND compared over the identity fields, so a forged fresh hash
    does not help: an edit to a value, a date, a reason or a supersedes pointer of
    a committed entry is refused whatever its hash says.
    """
    old_by_seq = {e["seq"]: _identity(e) for e in old.get("registrations", [])}
    new_by_seq = {e["seq"]: _identity(e) for e in new.get("registrations", [])}
    for seq, ident in old_by_seq.items():
        if seq not in new_by_seq:
            raise InPlaceEditRefused(f"entry seq={seq} was removed; the registry is append-only")
        if new_by_seq[seq] != ident:
            raise InPlaceEditRefused(
                f"entry seq={seq} was edited in place; a revision must APPEND a new dated entry "
                "that supersedes it, leaving the old one intact"
            )


def register(doc: dict, bar: str, kind: str, value: float, registered: str, reasoning: str) -> dict:
    """Return a NEW registry with the (kind, bar) (re)registered — always by appending.

    A first registration of a new (kind, bar) has no predecessor; a revision of an
    existing one appends an entry that supersedes the current active entry, and the
    superseded entry stays. `kind` is required (field|edge) because a bar name can
    exist under both. An undated or unreasoned entry is refused here, at the write.
    This function never mutates an existing entry, so there is no in-place-edit
    path to take by accident.
    """
    if kind not in ("field", "edge"):
        raise RegistryInvalid(f"kind must be 'field' or 'edge', got {kind!r}")
    meta_problems = validate_meta(registered, reasoning)
    if meta_problems:
        raise RegistryInvalid("; ".join(meta_problems))
    active = _active_map(doc)
    key = (kind, bar)
    supersedes = active[key]["seq"] if key in active else None
    next_seq = max((e["seq"] for e in doc["registrations"]), default=0) + 1
    entry = {
        "seq": next_seq,
        "bar": bar,
        "kind": kind,
        "value": value,
        "registered": registered,
        "reasoning": reasoning,
        "supersedes": supersedes,
    }
    entry["hash"] = entry_hash(entry)
    new_doc = {**doc, "registrations": [*doc["registrations"], entry]}
    # A registration can only ever add; prove it before handing the doc back.
    assert_append_only(doc, new_doc)
    return new_doc


# --- THRESHOLD.md generation ------------------------------------------------

def _field_table(doc: dict) -> str:
    rows = [e for e in active_entries(doc) if e["kind"] == "field"]
    # Preserve the document's own ordering: descending bar, then declaration order.
    rows.sort(key=lambda e: (-e["value"], e["seq"]))
    lines = [
        "| Critical field | Registered | Why it is critical | Pass bar |",
        "|---|---|---|---|",
    ]
    for e in rows:
        pct = _fmt_pct(e["value"])
        lines.append(f"| `{e['bar']}` | {e['registered']} | {e['reasoning']} | {pct} |")
    return "\n".join(lines)


def _edge_table(doc: dict) -> str:
    rows = [e for e in active_entries(doc) if e["kind"] == "edge"]
    rows.sort(key=lambda e: (-e["value"], e["seq"]))
    lines = [
        "| Edge class | Registered | Why it is critical | Pass bar |",
        "|---|---|---|---|",
    ]
    for e in rows:
        pct = _fmt_pct(e["value"])
        lines.append(f"| `{e['bar']}` | {e['registered']} | {e['reasoning']} | {pct} |")
    return "\n".join(lines)


def _fmt_pct(v: float) -> str:
    # Render the registered value exactly, not rounded: a bar that is not a whole
    # percent (e.g. 0.985) must show as `98.5%`, so the document can never state a
    # bar that is not the one registered. Bars at or above 98% are the
    # safety-critical ones the document bolds.
    pct = f"{v * 100:g}%"
    return f"**≥ {pct}**" if v >= 0.98 else f"≥ {pct}"


def _splice(text: str, begin: str, end: str, body: str) -> str:
    i, j = text.find(begin), text.find(end)
    if i == -1 or j == -1 or j < i:
        raise RegistryInvalid(f"THRESHOLD.md is missing the {begin} / {end} markers")
    return text[: i + len(begin)] + "\n" + body + "\n" + text[j:]


def render_doc(doc: dict, current_text: str) -> str:
    """Return THRESHOLD.md with its two generated bar tables replaced from bars.json."""
    out = _splice(current_text, FIELD_BEGIN, FIELD_END, _field_table(doc))
    out = _splice(out, EDGE_BEGIN, EDGE_END, _edge_table(doc))
    return out


# --- append-only check against a committed baseline -------------------------

def _repo_rel(path: Path) -> str:
    """The path relative to the enclosing git work tree, for `git show`."""
    top = subprocess.run(
        ["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    if top.returncode != 0:
        return path.name
    root = Path(top.stdout.strip())
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return path.name


def _ref_exists(ref: str, cwd: Path) -> bool:
    r = subprocess.run(
        ["git", "-C", str(cwd), "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def baseline_from_git(ref: str, current_path: Path) -> dict | None:
    """The registry as it stood at a git ref, or None if it did not exist there
    (a genuine first registration) or the ref cannot be resolved."""
    if not _ref_exists(ref, current_path.parent):
        return None
    rel = _repo_rel(current_path)
    show = subprocess.run(
        ["git", "-C", str(current_path.parent), "show", f"{ref}:{rel}"],
        capture_output=True,
        text=True,
    )
    if show.returncode != 0:
        return None  # the file did not exist at that ref
    try:
        return json.loads(show.stdout)
    except json.JSONDecodeError:
        return None


# --- CLI --------------------------------------------------------------------

def _cmd_verify(_args) -> int:
    problems = verify_integrity(load())
    if problems:
        print("registry INVALID:")
        for p in problems:
            print(f"  - {p}")
        return 1
    doc = load()
    print(f"registry OK — {len(active_entries(doc))} active bars, id {registration_id(doc)[:12]}…")
    return 0


def _cmd_bars(_args) -> int:
    doc = load()
    print("field bars:")
    for k, v in sorted(field_bars(doc).items(), key=lambda kv: -kv[1]):
        print(f"  {k:22s} {v}")
    print("edge bars:")
    for k, v in sorted(edge_bars(doc).items(), key=lambda kv: -kv[1]):
        print(f"  {k:22s} {v}")
    return 0


def _cmd_id(_args) -> int:
    print(registration_id(load()))
    return 0


def _cmd_gen_doc(args) -> int:
    doc = load()
    current = DOC_PATH.read_text(encoding="utf-8")
    rendered = render_doc(doc, current)
    if args.write:
        DOC_PATH.write_text(rendered, encoding="utf-8")
        print("THRESHOLD.md regenerated from bars.json")
        return 0
    if rendered != current:
        print("THRESHOLD.md is OUT OF SYNC with bars.json — run `gen-doc --write`")
        return 1
    print("THRESHOLD.md matches bars.json")
    return 0


def _cmd_register(args) -> int:
    """Append a (re)registration of a bar and regenerate the document.

    The one sanctioned way to change a bar: it only ever appends, refuses an
    undated/unreasoned entry, and never touches an existing entry — so following
    the documented procedure cannot edit a bar in place.
    """
    doc = load()
    try:
        new_doc = register(doc, args.bar, args.kind, args.value, args.registered, args.reasoning)
    except (RegistryInvalid, InPlaceEditRefused) as exc:
        print(f"register refused: {exc}")
        return 1
    save(new_doc)
    # Keep the document in step with the declaration in the same command.
    current = DOC_PATH.read_text(encoding="utf-8")
    DOC_PATH.write_text(render_doc(new_doc, current), encoding="utf-8")
    print(
        f"registered {args.kind} bar '{args.bar}' at {args.value} "
        f"(seq {new_doc['registrations'][-1]['seq']}); new id {registration_id(new_doc)[:12]}…"
    )
    return 0


def _cmd_append_only_check(args) -> int:
    """Refuse an in-place edit of the committed registry.

    Loads the baseline from a git ref (`--git-base`) or a file (`--baseline-file`)
    and refuses any change to an entry that baseline already carried — the append-
    only rule enforced against what was actually committed, so an edit that also
    forges a fresh hash (which the at-rest hash check alone would miss) is caught.
    A baseline that does not exist (a genuine first registration) or a git ref
    that cannot be resolved is reported and passed: the at-rest `verify` and the
    pinned `no-bar-value-changed` proof remain the always-on catches.
    """
    current_path = Path(args.file) if args.file else BARS_PATH
    current = load(current_path)
    if args.baseline_file:
        baseline = load(Path(args.baseline_file))
    elif args.git_base:
        baseline = baseline_from_git(args.git_base, current_path)
        if baseline is None:
            print(
                f"append-only: no baseline for '{current_path.name}' at {args.git_base} "
                "(first registration or ref unavailable) — nothing to compare against"
            )
            return 0
    else:
        print("append-only-check needs --git-base or --baseline-file")
        return 2
    try:
        assert_append_only(baseline, current)
    except InPlaceEditRefused as exc:
        print(f"append-only VIOLATED: {exc}")
        return 1
    print("append-only OK — every committed entry is unchanged; only appends were added")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="the capture-quality bars declaration")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("verify").set_defaults(fn=_cmd_verify)
    sub.add_parser("bars").set_defaults(fn=_cmd_bars)
    sub.add_parser("id").set_defaults(fn=_cmd_id)
    g = sub.add_parser("gen-doc")
    g.add_argument("--write", action="store_true", help="rewrite THRESHOLD.md (default: check only)")
    g.add_argument("--check", action="store_true", help="explicit check (the default when not --write)")
    g.set_defaults(fn=_cmd_gen_doc)
    r = sub.add_parser("register", help="append a (re)registration of a bar")
    r.add_argument("--bar", required=True)
    r.add_argument("--kind", required=True, choices=("field", "edge"))
    r.add_argument("--value", required=True, type=float)
    r.add_argument("--registered", required=True, help="ISO date, YYYY-MM-DD")
    r.add_argument("--reasoning", required=True, help="why this bar is critical")
    r.set_defaults(fn=_cmd_register)
    a = sub.add_parser("append-only-check", help="refuse an in-place edit vs a committed baseline")
    a.add_argument("--git-base", help="a git ref whose bars.json is the baseline")
    a.add_argument("--baseline-file", help="a file whose contents are the baseline")
    a.add_argument("--file", help="the registry to check (default: bars.json)")
    a.set_defaults(fn=_cmd_append_only_check)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
