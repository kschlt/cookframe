#!/usr/bin/env python3
"""CFV1-S1 — build the human adjudication report for the real-photo run.

Two independent readers transcribed each photograph: the ground-truth
transcription and the pipeline's own capture. Where they AGREE, the reading is
corroborated by two independent readers and needs no human time. Where they
DISAGREE, exactly one of them is wrong and only a human looking at the
photograph can say which.

This report is therefore the whole human ask: the disagreements, side by side,
with the photograph named. It decides nothing — the pass/fail call stays in the
pre-registered scorer, and this only pairs the values the scorer compared so
they can be adjudicated.

Honest limit, which the verdict must carry: both readers are models. A failure
mode they SHARE — both misreading the same glare-bleached line the same way —
shows up here as agreement and is invisible. Agreement is evidence, not proof,
so the verdict also asks for a spot-check of agreed fields.

Usage: python3 spikes/s1-photo-gate/adjudicate.py <dir> <model>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def norm(s) -> str:
    return " ".join(str(s or "").split()).strip().lower().rstrip(".")


def ingredient_key(i: dict) -> str:
    return norm(i.get("name"))


def compare(truth: dict, cap: dict) -> list[dict]:
    """Field-level disagreements between the two readings."""
    out = []

    def add(field, t, c, note=""):
        out.append({"field": field, "truth": t, "capture": c, "note": note})

    if norm(truth.get("title")) != norm(cap.get("title")):
        add("title", truth.get("title"), cap.get("title"))

    t_y = [norm(y) for y in truth.get("yields") or []]
    c_y = [norm(y) for y in cap.get("yields") or []]
    if t_y != c_y:
        add("yields", truth.get("yields"), cap.get("yields"))

    for kind in ("prep", "cook", "total"):
        t = (truth.get("times") or {}).get(kind)
        c = (cap.get("times") or {}).get(kind)
        if norm(t) != norm(c):
            add(f"times.{kind}", t, c)

    t_temp = sorted(norm(x) for x in truth.get("temperatures") or [])
    c_temp = sorted(norm(x) for x in cap.get("temperatures") or [])
    if t_temp != c_temp:
        add("temperatures", truth.get("temperatures"), cap.get("temperatures"))

    # Ingredients, matched by name so a quantity difference is reported as such
    # rather than as two unrelated missing/extra lines.
    t_ings = {ingredient_key(i): i for i in truth.get("ingredients") or []}
    c_ings = {ingredient_key(i): i for i in cap.get("ingredients") or []}
    for name in sorted(set(t_ings) - set(c_ings)):
        add("ingredient.missing", t_ings[name], None, "in truth, not in capture")
    for name in sorted(set(c_ings) - set(t_ings)):
        add("ingredient.extra", None, c_ings[name], "in capture, not in truth")
    for name in sorted(set(t_ings) & set(c_ings)):
        t, c = t_ings[name], c_ings[name]
        if norm(t.get("quantity")) != norm(c.get("quantity")):
            add(f"ingredient.quantity [{name}]", t.get("quantity"), c.get("quantity"))
        if norm(t.get("unit")) != norm(c.get("unit")):
            add(f"ingredient.unit [{name}]", t.get("unit"), c.get("unit"))

    t_steps = [norm(s) for s in truth.get("instructions") or []]
    c_steps = [norm(s) for s in cap.get("instructions") or []]
    if len(t_steps) != len(c_steps):
        add(
            "instruction.count",
            len(t_steps),
            len(c_steps),
            "segmentation difference — may be structure imposed on prose, not a misread",
        )
    for idx, (t, c) in enumerate(zip(t_steps, c_steps)):
        if t != c:
            add(
                f"instruction[{idx}]",
                (truth.get("instructions") or [])[idx],
                (cap.get("instructions") or [])[idx],
            )
    return out


def main() -> None:
    base = Path(sys.argv[1])
    model = sys.argv[2]
    runs = base / "runs"
    manifest = json.loads((base / "manifest.json").read_text())

    lines = [
        "# CFV1-S1 — adjudication report (real photographs)",
        "",
        f"Capture model: **{model}**. Two independent readings per photograph; only the",
        "**disagreements** are listed. For each one, look at the photograph named and say which",
        "column is right — that is the whole ask. Agreements are not listed (they are corroborated",
        "by two independent readers), but see the verdict's note on shared blind spots.",
        "",
    ]
    total_disagreements = 0
    for entry in manifest["fixtures"]:
        fid = entry["id"]
        truth = json.loads((base / entry["truth"]).read_text())
        cap_path = runs / f"{fid}__{model}.json"
        if not cap_path.exists():
            lines += [f"## {fid} ({entry['class']})", "", "**No capture produced.**", ""]
            continue
        cap = json.loads(cap_path.read_text())
        diffs = compare(truth, cap)
        total_disagreements += len(diffs)
        lines += [
            f"## {fid} — {entry['class']}  ·  `photos/{fid}.jpg`",
            "",
        ]
        if entry.get("uncertain"):
            lines += [
                f"_The transcriber flagged {entry['uncertain']} field(s) as unreadable here; "
                "those are listed in the truth file's `uncertain` list._",
                "",
            ]
        if not diffs:
            lines += ["Both readings agree on every scored field.", ""]
            continue
        lines += ["| field | ground truth | pipeline capture | note |", "|---|---|---|---|"]
        for d in diffs:
            t = json.dumps(d["truth"], ensure_ascii=False) if not isinstance(d["truth"], str) else d["truth"]
            c = json.dumps(d["capture"], ensure_ascii=False) if not isinstance(d["capture"], str) else d["capture"]
            lines.append(
                f"| `{d['field']}` | {str(t)[:120]} | {str(c)[:120]} | {d['note']} |"
            )
        lines.append("")

    lines += [
        "---",
        "",
        f"**{total_disagreements} disagreement(s)** across {len(manifest['fixtures'])} photograph(s).",
        "",
    ]
    out = base / "ADJUDICATION.md"
    out.write_text("\n".join(lines))
    print(f"wrote {out} — {total_disagreements} disagreement(s)")


if __name__ == "__main__":
    main()
