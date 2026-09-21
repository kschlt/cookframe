#!/usr/bin/env python3
"""CFV1-S1 — build the real-photo fixture manifest the scorer consumes.

The scorer reads `manifest.json` for the fixture ids, their class labels and the
path to each truth file. For the synthetic set `generate.mjs` wrote it; for the
real set the fixtures are photographs, so the manifest is derived here.

Class assignment is by explicit keyword rule over each truth file's own `notes`
field — the transcriber's description of the photograph, written before any
capture was scored and without access to any capture. The rules are in one table
below so the assignment is inspectable and reproducible rather than hand-picked
per fixture.

Two classes appear here that the pre-registered thirteen do not name, because
synthetic HTML renders cannot produce them: `handwriting` and `partial-recipe`.
They are recorded rather than forced into a neighbouring label; the verdict says
which pre-registered classes the real set does and does not cover.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

# First match wins; order is most-specific first.
RULES = [
    ("handwriting", ("handwritten", "cursive", "handschrift")),
    ("partial-recipe", ("partial", "continuation", "only steps")),
    ("glare-shadow", ("glare", "specular", "sleeve", "laminated")),
    ("angled-photo", ("angle", "angled", "perspective")),
    ("multi-column", ("dot-leader", "two-column", "double-page", "multi-column")),
    ("clean-page", ("crisp", "clean", "flat", "well lit", "legible")),
]


def classify(notes: str) -> str:
    low = (notes or "").lower()
    for label, keys in RULES:
        if any(k in low for k in keys):
            return label
    return "unclassified"


def main() -> None:
    base = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    fixtures = []
    for truth_path in sorted(base.glob("*.truth.json")):
        fid = truth_path.name.replace(".truth.json", "")
        doc = json.loads(truth_path.read_text())
        fixtures.append(
            {
                "id": fid,
                "class": classify(doc.get("notes", "")),
                "truth": truth_path.name,
                "origin": "real-photograph",
                "uncertain": len(doc.get("uncertain") or []),
            }
        )
    out = base / "manifest.json"
    out.write_text(json.dumps({"fixtures": fixtures}, ensure_ascii=False, indent=2) + "\n")
    for f in fixtures:
        print(f"  {f['id']}  {f['class']}  (uncertain fields: {f['uncertain']})")
    print(f"\nwrote {out} — {len(fixtures)} fixture(s)")


if __name__ == "__main__":
    main()
