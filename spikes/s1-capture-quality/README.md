# CFV1-S1 — Image capture-quality gate (Gate A)

S1 governs one **irreversible** capability: deleting the original scan after capture. A scan may
be discarded only once capture is accurate enough that nothing critical is lost silently. This
spike measures that accuracy against a **pre-registered** threshold and records a verdict.

The point of the design is that the gate must be able to **fail**. A high average over easy pages
is exactly the failure mode it is written to prevent, so accuracy is reported **per field**, the
bar for each field is fixed **before** any result is read, and the scorer itself is proven able to
reject a wrong capture. A number that cannot come out the other way proves nothing.

## What's here

| File | Role |
|---|---|
| `THRESHOLD.md` | The pre-registered gate: per-field and per-edge-class bars, the verdict rule, the normalization rules. Committed **before** `runs/` and any score (git history is the proof of ordering). |
| `generate.mjs` | Renders 13 self-authored recipe fixtures (HTML → PNG via Chromium), each carrying its ground truth. Three classes are hardened for difficulty (angle+perspective+blur, an occluding glare band, 7px low-contrast metadata). Writes `fixtures/`. |
| `fixtures/` | 13 PNGs + `<id>.truth.json` + `manifest.json`. Every fixture is `origin: self-authored`; each carries its `class`. No real cookbook photo or personal recipe (S1 constraint). |
| `runs/` | The captures: `<id>__<model>.json`, one per fixture, produced by a vision-capable Claude subagent given **no** ground truth (honest capture). |
| `score.py` | Per-field scorer. Numeric-equality quantities (unicode fractions, ranges, mixed fractions), a fixed unit-synonym set, exact name/title/text match — **never** text similarity. `--selftest` proves discrimination. Writes `scores-<model>.json`. |
| `oq14-verdict.md` | The verdict, citing the pre-registered bars. |

## Method

1. **Pre-register.** `THRESHOLD.md` fixes 14 field bars and 4 quantity-edge bars, the all-bars-or-fail
   verdict rule, and the normalization for "matches ground truth". Committed and pushed first.
2. **Generate.** 13 fixtures, one per class, self-authored, each with machine-readable truth.
   The visual classes are degraded in CSS/Chromium so the render is not a crisp page.
3. **Capture.** A vision subagent transcribes each PNG to the Canonical-Recipe shape, with no
   access to the truth files and instructed to omit rather than invent (omission-over-coercion).
4. **Score.** Per field, per edge class, per fixture class. The scorer is self-tested first:
   `python3 score.py --selftest` plants a wrong value in every comparator and requires each to be
   caught (title/quantity-fraction/range/unit-synonym/ingredient), and each correct value to be
   accepted. Only then are the real captures scored.
5. **Verdict.** PASS only if **every** bar is met; a partial pass is a fail with the fields named.

## Result: **INCONCLUSIVE** — the synthetic measurement is circular

Scorer self-test: **PASS** (every planted mismatch caught, every correct value accepted). Every
field bar reads 100% across all 13 classes. **But the verdict is not PASS**, because those numbers
measure nothing about capture accuracy — the evaluation is circular by construction, and scan
deletion stays disabled. Full reasoning in `oq14-verdict.md`. In short:

- Every fixture is **self-authored**: the same author wrote the recipe rendered into the PNG and
  the truth it is scored against. On legible content a correct read reproduces the truth exactly —
  confirmed: all 13 captures in `runs/` are byte-for-byte identical to their truth files. The eval
  therefore cannot tell a genuine perfect capture from an answer copied from the truth; 100% is the
  expected outcome of either and evidence of neither.
- Independently, the vision model read through every degradation a synthetic HTML render can
  produce (steep angle + perspective + blur, an occluding glare band, 7px low-contrast metadata)
  across two rounds of hardening, with no miss. Pushing degradation further would manufacture a
  failure a human could not read either. The circularity is inherent to self-authored synthetic
  fixtures, not a defect in these files.

`runs/` and `scores-sonnet.json` are kept as the concrete **demonstration** of that circularity —
they are not OQ-14 evidence.

## What establishing OQ-14 requires

A fixture set whose ground truth is **independent of the capture**: real cookbook photographs and
personal recipes, human-transcribed, carrying focus falloff, sensor noise, paper texture, ink
bleed and handwriting that synthetic renders cannot. Per the S1 constraint that set is
owner-controlled and lives **outside** `kschlt/cookframe`. This spike delivers the reusable,
pre-registered, self-tested apparatus (threshold, generator, scorer, verdict format) for that run;
it does not, and on synthetic data cannot, produce the measurement itself.

- **Small-n on the rare classes.** split/reserved, multiple-yields, nutrition, classification and
  ingredient-group each have one representative fixture — enough to exercise the apparatus, not to
  yield a rate.
- **One model, one provider.** The run records the model; provider choice is `ADR-0004`/`OQ-07`.

## Reproduce

```bash
node generate.mjs                 # regenerate fixtures/ (needs Chromium; see spike notes)
python3 score.py --selftest       # prove the scorer discriminates
python3 score.py --model sonnet   # score runs/ against fixtures/ truth, print verdict
```

Capture is produced by a vision subagent per fixture; `runs/` holds the captures used for the
recorded verdict.
