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

## Result (model: sonnet)

Scorer self-test: **PASS** (every planted mismatch caught, every correct value accepted).
Every field bar and every quantity-edge bar **met** across the 13 fixture classes — including the
three hardened ones. Full figures in `oq14-verdict.md` and `scores-sonnet.json`.

## Limitations — read before acting on the PASS

This is a **synthetic floor, not the full gate.** The honest reading of the result is not "capture
is solved"; it is "within the difficulty a synthetic HTML fixture can produce, this model missed
nothing, and the scorer is proven able to fail."

- **Synthetic fixtures derive from crisp text.** Even under heavy blur, an occluding glare band,
  a steep angle, or 7px low-contrast type, the underlying glyphs are geometrically clean, and a
  capable vision model reads through the degradation. Two rounds of hardening did not produce a
  single miss. Escalating degradation until the model fails would manufacture a failure a human
  could not read either — it would test nothing. So the limiting factor on gate **confidence** is
  fixture realism, not model capability or scorer design.
- **Real photographs are the missing evidence.** Genuine phone photos of cookbook pages carry
  focus falloff, sensor noise, paper texture, ink bleed and handwriting that synthetic renders do
  not. Those live **outside** `kschlt/cookframe` (S1 constraint) as a private supplement.
- **Small-n on the rare classes.** split/reserved, multiple-yields, nutrition, classification and
  ingredient-group each have one representative fixture, so their per-field percentages are 1-for-1,
  not a distribution. They establish presence and correctness, not a rate.
- **One model, one provider.** The run records the model; provider choice is `ADR-0004`/`OQ-07`.

Because the capability is irreversible, the operational recommendation (in `oq14-verdict.md`) is
that **scan deletion stays disabled** until the same pre-registered bars are cleared on the
real-photo private set. The synthetic PASS validates the methodology and the scorer; it does not
by itself justify discarding a user's only copy of a scan.

## Reproduce

```bash
node generate.mjs                 # regenerate fixtures/ (needs Chromium; see spike notes)
python3 score.py --selftest       # prove the scorer discriminates
python3 score.py --model sonnet   # score runs/ against fixtures/ truth, print verdict
```

Capture is produced by a vision subagent per fixture; `runs/` holds the captures used for the
recorded verdict.
