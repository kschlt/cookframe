# CFV1-S1 — OQ-14 capture-quality threshold (pre-registered)

**Recorded before any measurement is read, and never to be changed to fit a result** (S1 constraint).
This file is committed ahead of `runs/` and `scores.json`; its git history is the proof of ordering
(proof: `capture-quality/threshold-recorded-before-scores`).

## The gate

S1 governs one destructive capability: **deleting the original scan after capture.** Deletion is
irreversible, so the scan may be discarded only if capture is accurate enough on the fields whose
loss would be silent at capture time and unsafe later. Until this gate is recorded as **passed**,
scan deletion stays disabled (proof: `capture-quality/scan-deletion-remains-disabled` — the verdict
in `oq14-verdict.md` never reads PASS unless every bar below is met).

## Critical fields (scored per field; never by text similarity)

Accuracy is reported **per field**, as the fraction of fixtures where the captured value matches
ground truth under the normalization named below. No whole-document or string-distance measure
stands in for any field (proof: `capture-quality/per-field-scoring`).

The two tables below are **generated from [`bars.json`](bars.json)** — the single declaration the
scorer also reads — so the document and the scorer cannot disagree (CFV1-THR, proof:
`thresholds/single-declaration`). Do not edit a table by hand: change a bar with
`python3 thresholds.py register …`, then `thresholds.py gen-doc --write`. Each bar carries the date
it was registered; a revision appends a new dated entry and the superseded one stays in `bars.json`.

<!-- BEGIN GENERATED FIELD BARS -->
| Critical field | Registered | Why it is critical | Pass bar |
|---|---|---|---|
| `ingredient.quantity` | 2026-09-20 | wrong amount ruins the dish; silent after deletion | **≥ 98%** |
| `ingredient.unit` | 2026-09-20 | 1 tsp vs 1 tbsp salt is a safety/edibility failure | **≥ 98%** |
| `split_reserved` | 2026-09-20 | losing "reserve 150 g" makes a later step impossible | **≥ 98%** |
| `temperature` | 2026-09-20 | under/over-temp is a food-safety failure | **≥ 98%** |
| `multiple_yields` | 2026-09-20 | picking the wrong yield mis-scales everything | **≥ 98%** |
| `ingredient.name` | 2026-09-20 | wrong ingredient identity | ≥ 95% |
| `instruction.text` | 2026-09-20 | the action itself | ≥ 95% |
| `instruction.order` | 2026-09-20 | reordered steps break the recipe | ≥ 95% |
| `title` | 2026-09-20 | recipe identity | ≥ 95% |
| `yield` | 2026-09-20 | scaling / shopping base | ≥ 95% |
| `time` | 2026-09-20 | planning + readiness | ≥ 95% |
| `ingredient_group` | 2026-09-20 | grouping structure when the source has it | ≥ 90% |
| `nutrition` | 2026-09-20 | preserved-not-acted-on canonical fact | ≥ 90% |
| `classification` | 2026-09-20 | preserved source fact | ≥ 90% |
<!-- END GENERATED FIELD BARS -->

The four **quantity edge classes** are reported as their **own separate figures**, not folded into
`ingredient.quantity` (proof: `capture-quality/quantity-edge-classes`):

<!-- BEGIN GENERATED EDGE BARS -->
| Edge class | Registered | Why it is critical | Pass bar |
|---|---|---|---|
| `fractions` | 2026-09-20 | ½, ¾, 1 1/2 — a misread fraction is a silently wrong amount | **≥ 98%** |
| `ranges` | 2026-09-20 | 2–3, 180-200 °C — a range matches only if both bounds survive | **≥ 98%** |
| `multiple_yields` | 2026-09-20 | makes 12 / serves 4 — the kept base yield mis-scales everything if wrong | **≥ 98%** |
| `ambiguous_units` | 2026-09-20 | 1 can, 1 clove, a pinch, 1 stick — unit-shaped words carrying the quantity | ≥ 95% |
<!-- END GENERATED EDGE BARS -->

## Verdict rule

`OQ-14` is **PASS** only if **every** field bar above **and** every quantity-edge bar is met.
A single aggregate score never decides the gate; a partial pass (some fields clear, some do not) is
reported as such and is a **fail** for the gate, with the failing fields named. This is deliberate:
the point of per-field scoring is that a high average over easy pages must not hide a critical-field
miss (S1 hint).

## Normalization for "matches ground truth" (per field, no similarity metric)

- **Quantities**: numeric equality after parsing; `0.5`, `1/2`, `½` are equal; a range matches only
  if both bounds match; a missing/extra quantity is a miss.
- **Units**: matched against a fixed synonym set (`tsp`/`teaspoon`, `g`/`gram`, `°C`/`C`); anything
  outside it is a miss.
- **Names / titles / instruction text**: case- and whitespace-insensitive exact match of the
  captured string to ground truth; **not** an edit-distance or embedding score.
- **Order**: the captured instruction sequence equals the ground-truth sequence.
- **Split/reserved**: both the used amount and the reserved amount must be captured for the fixture
  to count as correct.
- **Absent-vs-present**: a field the source does not carry must be captured as absent; inventing it
  is a miss (omission-over-coercion, per the Canonical Recipe contract).

## Fixture classes (13) — each represented, each labelled

Every public fixture is **synthetic or self-authored only**, carries a `class` label and an `origin`
field, and no fixture is a real cookbook photograph or a personal recipe (proofs:
`capture-quality/fixture-class-coverage`, `capture-quality/public-fixture-provenance`). Real photos,
if ever added, live outside `kschlt/cookframe` per the S1 constraint.

1. clean page · 2. angled photo · 3. glare and shadow · 4. multi-column layout · 5. ingredient
groups · 6. fractions · 7. ranges · 8. split and reserved instructions · 9. small metadata text ·
10. ambiguous units · 11. multiple yields · 12. source-provided nutrition · 13. source-provided
classifications.

## Model / provider

The capture model is configuration under `ADR-0004`, not decided here; this spike contributes
evidence to `OQ-07`/`OQ-08`. The run records which model produced each capture.
