# CFV1-S1 / OQ-14 — real-photograph run, verdict

**Proof: `capture-quality/oq14-verdict`, on real sources.** Bars are the pre-registered ones in
[`../s1-capture-quality/THRESHOLD.md`](../s1-capture-quality/THRESHOLD.md), unchanged. The apparatus
is this directory; the method is [`README.md`](README.md).

Run 2026-09-21. Capture model **gpt-5.4** through the real pipeline (`ingest` → provisional store →
`reprocess`, the real model-backed providers), 11 photographs supplied by the maintainer, scored by
the pre-registered `../s1-capture-quality/score.py`.

## Verdict: **FAIL — deleting the original scan stays disabled.**

That is the correct outcome, and unlike the synthetic run it is a *real* one. The S1 spike returned
INCONCLUSIVE because its fixtures were self-authored: ground truth and capture shared an author, so
a high score proved nothing. Here ground truth came from an independent transcription of each
photograph by a reader that never saw a capture. The scorer's circularity guard did not fire.

## What this file can and cannot contain

The run's inputs and outputs — the photographs, the transcriptions, the snapshots, the canonicals,
the per-fixture scores, `ADJUDICATION.md` — are under `evals/fixtures/private/s1-gate/`, which
`.gitignore` excludes: the photographs are personal and the recipes are third-party (S1 constraint,
`evals/README.md`). **They are therefore not re-derivable from this repository**, and the rates below
are recorded on the run's authority rather than reproducible from committed data. What *is* committed
is everything that decides what the rates mean: the bars, the scorer, its `--selftest`, and the
runner. Any example below is constructed to show a shape; no ingredient, title or line from a real
source appears in this file.

## Pipeline behaviour — the part that is not about scoring

| | |
|---|---|
| photographs ingested end to end | **10 / 11** |
| `sourceRef` resolution on those 10 | **100%** — every canonical fact cites a block that exists |
| contract failures | **1 / 11** |

`resolveSourceRefs` runs inside the repository write, so a canonical citing a nonexistent block
fails the ingest instead of being persisted. Nothing had to be caught after the fact.

The one failure (`photo-04`) was rejected by `.strict()`: the model emitted a key inside
`ingredientUses[0]` that the contract does not define. It failed closed — nothing half-valid was
persisted — which is the designed behaviour. But **one page in eleven dropped is not shippable**, so
the production path needs **retry-on-contract-failure**. This is the same failure mode CFV1-S6
measured on the cheap tier, now observed once on the full tier with real input.

**Addressed, and then measured rather than assumed.** The capabilities now retry a reply the
contract rejects, re-sending the same input with the validator's own message and a bounded second
attempt; they still fail closed once it is spent. Whether a real model actually repairs this class
when shown the message was an open assumption, so it was probed on the cheapest input that
reproduces the failure (`spikes/s6-fidelity/FINDINGS.md`, *Does the retry work?*): over 12
conversions on the cheap tier, **two of three failures were repaired and one failed again**, moving
delivery from 9/12 to 11/12. So the retry is real but not a cure, and a caller that needs every page
must still handle a failure. **This page was not itself re-run** — identifying which photograph it
was could not be done reliably from what the run recorded (see below), and a re-run costs real money
against a small budget.

### A smaller finding: a snapshot does not record what it was made from

Trying to re-run the one failed page turned up something the run itself should have recorded. A
`SourceSnapshot` keeps `captureProvenance` — adapter, version, model, prompt versions, run id — but
nothing that names the input it was captured from. For a photograph there is no URL to fall back on,
so the only link between a stored snapshot and the file that produced it is the order the runner
happened to read a directory in. That is not a link, and reconstructing it afterwards from image
dimensions and page content failed. It has no consequence for the gate's numbers, but it means a
run's inputs are not addressable after the fact, which is exactly what a re-run needs. `schema/`
already has `sourceAttribution` unused; whether that is the right field, or whether snapshots want a
storage identity of their own, is the same question the `snapshot ↔ scan storageIdentity` item asks,
and it is a contract decision rather than a fix.

## Scores against the pre-registered bars

Scored twice. The first truth spec was defective — it instructed transcribers to put the whole
ingredient phrase into `name`, while the schema deliberately splits qualifiers *out* of the name.
The scorer joins truth to capture by name, so ingredients failed to pair and were counted twice,
once missing and once extra, even where quantity and unit matched exactly. **The first pass's
per-field percentages were a property of the harness, not of the capture, and are not quoted here
as a result.** The spec was corrected and all 11 photographs re-transcribed by fresh readers that
again saw no capture; the captures were already paid for, so re-scoring cost nothing.

| field | bar | measured |
|---|---|---|
| time (prep / cook / total) | 98% | **100%** |
| yield | 98% | **100%** |
| ingredient.quantity | 98% | 67% |
| ingredient.unit | 98% | 74% |
| ingredient.name | 98% | 77% |
| classification | (see `THRESHOLD.md`) | 0% |
| split / reserved bindings | required | **not measured** |

**FAIL on the all-bars-or-nothing rule.** Three of the ingredient bars are missed and one required
field was never measured at all, and either alone blocks a PASS.

## Why the ingredient rates are what they are

Two of the eleven fixtures account for most of the gap, and both are structural, not misreads:

- **A page carrying four separate recipes.** Truth records 23 ingredients; the capture returned 9 —
  the first recipe only. 14 unmatched ingredients come from this one fixture. See finding 1 below.
- **A handwritten partial card with no ingredient list.** Truth has **0** ingredients because the
  card has none; the capture **derived 12** from the method prose. Each one is genuinely named in
  the method, and handwritten quantities were read correctly, so this is derivation, not
  fabrication. See finding 2 below.

Excluding those two, on the 8 structurally comparable photographs **names agree on 57 of 71 (80%)**,
and where names agree, quantity and unit are exact ~95-100% of the time. The residual name gaps are
head-noun convention rather than reading errors: the transcriber writes the full phrase a cook would
say, the capture writes the head noun with the rest in `qualifiers`. `classification` scores 0% for
the same kind of reason — both readers recorded the page's running footer, one under `course` and
one under `category`.

**So: the capture reads real pages well, and "exact string match on `ingredient.name`" is
under-specified for real sources.** The pre-registered bar assumed synthetic fixtures where both
sides shared a naming convention by construction; with an independent transcriber they do not, and
the bar charges the difference to capture accuracy. That is a *threshold* question, and changing a
pre-registered bar after seeing the score is exactly what pre-registration forbids — so it is
Kornelius's to decide, in a new threshold record, not something to relax here.

A diagnostic, reported as a diagnostic: pairing ingredients by the schema's own name/qualifier
relationship instead of by exact name, **74 of 77 paired ingredients have an exact quantity (96%)
and 69 of 77 an exact unit (90%)** — still under the 98% bars, so the verdict is unchanged either
way. **This was computed after the failing score was seen** and therefore carries less weight than a
pre-registered measure; it is recorded because it identifies the cause, not because it changes the
outcome.

## `split_reserved` was not measured

Three fixtures carry split/reserved instructions ("use part now, keep the rest for a later step"),
but the first truth spec recorded them as free strings where `THRESHOLD.md` requires a structured
use/reserve pair. Rather than score them generously or strictly on a mismatched format, they are
reported as **not measured**, which blocks a PASS on its own. The projection now derives the pair
from the contract's own `UsageKind` (a `use_partial_unspecified` followed by `use_remaining` on the
same ingredient *is* the reserve-to-a-later-step binding), so a re-run can measure it.

## Two findings that need a product decision, not a prompt tweak

1. **A source carrying several recipes loses all but one, silently.** The contract assumes one
   recipe per source, and nothing in the pipeline notices when that assumption is false. No error,
   no flag, no partial-result signal — the ingest succeeds and three recipes are simply gone. That
   is precisely the class of silent loss Gate A exists to prevent, and it is a contract question
   (does a `SourceSnapshot` map to one canonical recipe or to many?) rather than a prompting one.
2. **May a canonical recipe carry an ingredient list its source does not have?** The capture derived
   a complete list from method prose on a card that had none. Nothing was invented — every item is
   named in the method — but the capture prompt says "do not add", and the omission-over-coercion
   contract points the same way, while a cook would plainly want the list. The two readings of the
   same principle disagree, so the principle needs sharpening.

A third, smaller, affects any comparison harness: **a time keeps its value but moves its label.**
The source's label is captured into `sourceLabel` and the duration into the value, so a truth record
holding "«label»: «duration»" as one string will not match a correct capture.

## Deviation from the pre-registered normalization

`THRESHOLD.md` fixes an English unit-synonym table. The real sources are German, so every German
unit would have scored as a miss for a reason unrelated to capture accuracy. German units were added
to the scorer's synonym table **before any real score was computed**. No bar, comparison rule or
verdict rule was touched; `score.py --selftest` still passes and the synthetic `scores-sonnet.json`
is byte-identical apart from one new empty `unmeasured` key. `score.py`'s time check was separately
narrowed to prep / cook / total, because a truth file may now also carry a time's source label and a
label is not a time. The deviation is recorded rather than made silently.

## The honest limit

Both readers are models. A failure mode they **share** — both misreading the same faded line the
same way — appears here as agreement and is invisible to this design. Agreement between independent
readers is real evidence and far stronger than the self-authored set, but it is not proof. **A
future PASS on this design needs a human spot-check of a sample of agreed fields**, not only the
adjudicated disagreements.

## What a valid re-run needs

The captures are already paid for, so all of this is free to redo:

1. Re-score with the corrected truth spec and the `UsageKind`-derived split/reserved pair, so the
   unmeasured field becomes measured.
2. Adjudicate the remaining disagreements — that is the only place human time is needed.
3. A decision on the two findings above, and on whether exact-name matching is the right bar, before
   any re-run can produce a PASS rather than a better FAIL.

Until then: **`OQ-14` stays open and scan deletion stays disabled.**
