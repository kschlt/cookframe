# OQ-14 verdict — capture-quality gate (Gate A)

**Proof: `capture-quality/oq14-verdict`.** Bars are the pre-registered ones in
[`THRESHOLD.md`](THRESHOLD.md), recorded before any capture was read
(proof: `capture-quality/threshold-recorded-before-scores`). Model: **sonnet** (vision subagent,
given no ground truth). Full figures in `scores-sonnet.json`.

## Numeric gate (as pre-registered): **PASS**

Scorer discrimination proven first (`score.py --selftest`: every planted mismatch caught, every
correct value accepted). Then, on the 13 self-authored fixtures:

| Field | Bar | Result |
|---|---|---|
| `ingredient.quantity` | ≥ 98% | 100% (54/54) ✓ |
| `ingredient.unit` | ≥ 98% | 100% (54/54) ✓ |
| `split_reserved` | ≥ 98% | 100% (1/1) ✓ |
| `temperature` | ≥ 98% | 100% (3/3) ✓ |
| `multiple_yields` | ≥ 98% | 100% (1/1) ✓ |
| `ingredient.name` | ≥ 95% | 100% (54/54) ✓ |
| `instruction.text` | ≥ 95% | 100% (40/40) ✓ |
| `instruction.order` | ≥ 95% | 100% (13/13) ✓ |
| `title` | ≥ 95% | 100% (13/13) ✓ |
| `yield` (single) | ≥ 95% | 100% (12/12) ✓ |
| `time` | ≥ 95% | 100% (13/13) ✓ |
| `ingredient_group` | ≥ 90% | 100% (1/1) ✓ |
| `nutrition` | ≥ 90% | 100% (1/1) ✓ |
| `classification` | ≥ 90% | 100% (1/1) ✓ |

Quantity edge classes (reported separately, proof `capture-quality/quantity-edge-classes`):

| Edge class | Bar | Result |
|---|---|---|
| `fractions` | ≥ 98% | 100% (5/5) ✓ |
| `ranges` | ≥ 98% | 100% (3/3) ✓ |
| `ambiguous_units` | ≥ 95% | 100% (6/6) ✓ |
| `multiple_yields` | ≥ 98% | 100% (1/1) ✓ |

Every field bar and every edge bar met. Per the verdict rule (all bars or fail), the pre-registered
gate reads **PASS** — recorded faithfully, numbers unfudged.

## What this PASS does and does not license

It is a **synthetic floor cleared**, not a solved capture problem. The scorer is proven able to
fail and every real capture still passed, including the three fixtures hardened twice (steep
angle + perspective + blur; an occluding glare band washing out three ingredient lines; 7px
low-contrast metadata). The honest reading: within the difficulty a synthetic HTML fixture can
produce, this model missed nothing. The limiting factor on **confidence** is therefore fixture
realism, not model capability or scorer design — synthetic renders derive from geometrically clean
glyphs a capable vision model reads through, and pushing degradation until the model fails would
manufacture a failure a human could not read either. See `README.md` § Limitations.

## Operational recommendation (the irreversible capability)

**Scan deletion stays disabled** (proof: `capture-quality/scan-deletion-remains-disabled`). The
gate governs discarding a user's only copy of a scan; that is not justified on synthetic evidence
alone. To lift it, clear the **same** pre-registered bars on the real-photo private set (held
outside `kschlt/cookframe`, S1 constraint), which carries the focus falloff, sensor noise, paper
texture and handwriting synthetic fixtures cannot. This spike delivers the reusable apparatus for
that run: the threshold, the generator, the proven-discriminating scorer, and the verdict format.

## Contribution to the open questions

Evidence toward `OQ-14` (capture accuracy sufficient to delete the scan): **methodology validated,
synthetic floor cleared, real-photo confirmation outstanding.** Model/provider choice remains
`ADR-0004` / `OQ-07`; the run records that sonnet produced these captures.
