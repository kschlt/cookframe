# OQ-14 verdict — capture-quality gate (Gate A)

**Proof: `capture-quality/oq14-verdict`.** Bars are the pre-registered ones in
[`THRESHOLD.md`](THRESHOLD.md), recorded before any capture was read
(proof: `capture-quality/threshold-recorded-before-scores`). Model: **sonnet** (vision subagent,
given no ground truth). Figures in `scores-sonnet.json`.

## Verdict: **INCONCLUSIVE — OQ-14 cannot be established on synthetic fixtures.**

The gate does **not** read PASS. Scan deletion stays disabled (proof:
`capture-quality/scan-deletion-remains-disabled`).

## Why not PASS, despite every bar reading 100%

The apparatus is sound and the numbers are real, but they measure nothing about capture accuracy,
because the evaluation is **circular by construction**:

1. Every public fixture is **self-authored** — the same author wrote the recipe rendered into the
   PNG *and* the `*.truth.json` it is scored against.
2. On legible content, a correct read therefore reproduces the truth **exactly**. Confirmed
   directly: all 13 captures in `runs/` are byte-for-byte identical (canonical JSON) to their
   truth files — every field, including the three fixtures hardened for difficulty.
3. So the eval cannot distinguish a genuine perfect capture from an answer copied from the truth.
   A 100% score is the **expected** outcome of either, and thus evidence of neither.

A second, independent signal points the same way: the vision model read through every degradation
a synthetic HTML render could produce (steep angle + perspective + blur; an occluding glare band
washing out three ingredient lines; 7px low-contrast metadata) across two rounds of hardening,
with no miss. Pushing degradation further until the model fails would only manufacture a failure a
human could not read either. The circularity is not a bug to fix in these files; it is inherent to
self-authored synthetic fixtures — the one party who could make truth and image diverge is the
author, and they wrote both.

The scorer itself is **not** the problem and is retained as validated apparatus: `score.py
--selftest` plants a wrong value in every comparator (title, quantity-fraction, range,
unit-synonym, ingredient) and requires each to be caught, and each correct value to be accepted —
it passes. The gate *can* fail; it just cannot be made to fail, or credibly pass, on inputs whose
truth the reader effectively already holds.

## What is required to establish OQ-14

The measurement needs a fixture set whose ground truth is **independent of the capture** — real
cookbook photographs and personal recipes, transcribed by a human, where "what the page says" was
not authored to be trivially machine-readable and carries real focus falloff, sensor noise, paper
texture, ink bleed and handwriting. Per the S1 constraint that set lives **outside**
`kschlt/cookframe` and is owner-controlled. Until the same pre-registered bars are cleared on it,
OQ-14 stays open and scan deletion stays disabled.

## What this spike does deliver

The reusable, validated apparatus for that run, all pre-registered and proven before any result:

- `THRESHOLD.md` — the per-field and per-edge-class bars and the all-bars-or-fail verdict rule,
  committed ahead of any capture (git history is the ordering proof).
- `generate.mjs` — the 13-class fixture generator (HTML → PNG), each fixture labelled by class and
  `origin` (proofs: `capture-quality/fixture-class-coverage`, `capture-quality/public-fixture-provenance`).
- `score.py` — per-field scoring with numeric-equality quantities and a fixed unit-synonym set,
  never text similarity; the four quantity edge classes reported separately; a structured (not
  loose) split/reserved matcher; and a `--selftest` discrimination proof (proofs:
  `capture-quality/per-field-scoring`, `capture-quality/quantity-edge-classes`,
  `capture-quality/split-and-reserved`).

`runs/` and `scores-sonnet.json` are kept as the concrete demonstration of the circularity above —
they are **not** OQ-14 evidence and are labelled as such.

## Contribution to the open questions

Evidence toward `OQ-14`: **apparatus built and validated; the synthetic-fixture measurement is
circular and cannot serve as evidence; a real-photo, owner-controlled set is required.** Model /
provider choice remains `ADR-0004` / `OQ-07`; the run records that sonnet produced the captures.
