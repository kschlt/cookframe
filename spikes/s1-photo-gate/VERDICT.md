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
delivery from 9/12 to 11/12. That probe is normalization only, so nothing measured here establishes
that a retried *capture* repairs anything — and until 2026-09-21 it could not have, because every
rejection on the capture path dropped the reply it was rejecting and the repair prompt quoted an
empty excerpt back to the model. Fixed with proofs; unmeasured. So the retry is real but not a cure,
and a caller that needs every page
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

Below is the scorer's **whole** report, not a selection from it. An earlier draft of this verdict
quoted six fields and called `split_reserved` unmeasured; that was written before the projection
derived the binding from `UsageKind`, and quoting part of a failing report reads as a kinder result
than the run earned.

| field | bar | measured | n |
|---|---|---|---|
| yield | 95% | **100%** ✓ | 9 |
| temperature | 98% | 86% | 7 |
| ingredient.name | 95% | 77% | 95 |
| ingredient.unit | 98% | 74% | 95 |
| ingredient.quantity | 98% | 67% | 95 |
| title | 95% | 70% | 10 |
| instruction.text | 95% | 47% | 53 |
| instruction.order | 95% | 10% | 10 |
| split / reserved bindings | 98% | 0% | 3 |
| time | 95% | 0% | 2 |
| ingredient_group | 90% | 0% | 1 |
| classification | 90% | 0% | 3 |
| multiple_yields | 98% | 0% | 1 |
| nutrition | 90% | n/a | 0 |

| quantity edge class | bar | measured | n |
|---|---|---|---|
| ranges | 98% | **100%** ✓ | 1 |
| ambiguous_units | 95% | 50% | 2 |
| fractions | 98% | 0% | 1 |
| multiple_yields | 98% | 0% | 1 |

By fixture class: clean-page 66%, glare-shadow 78%, handwriting 70%, unclassified 57%.

**FAIL on the all-bars-or-nothing rule** — eleven field bars and three edge-class bars are missed.
Note the denominators: several bars rest on one to three observations, so "0%" there means one or
three misses and not a rate worth reasoning about. The ingredient and instruction bars, at 95 and 53
observations, are the ones carrying real weight.

## What the misses actually are

Most of the gap is **convention and segmentation**, some is **structural**, and one is a genuine
defect. Separating them is the point of reading the report rather than the headline.

**Two fixtures dominate, and both are structural rather than misreads:**

- **A page carrying four separate recipes.** Truth records 23 ingredients; the capture returned 9 —
  the first recipe only. 14 unmatched ingredients, and its 17 truth steps against 6 captured ones,
  come from this fixture alone. See finding 1 below.
- **A handwritten partial card with no ingredient list.** Truth has **0** ingredients because the
  card has none; the capture **derived 12** from the method prose. Each one is genuinely named in
  the method, and handwritten quantities were read correctly, so this is derivation rather than
  invention. See finding 2 below.

Excluding those two, on the 8 structurally comparable photographs **names agree on 57 of 71 (80%)**,
and where names agree, quantity and unit are exact ~95-100% of the time. The residual name gaps are
head-noun convention rather than reading errors: the transcriber writes the full phrase a cook would
say, the capture writes the head noun with the rest in `qualifiers`. `classification` scores 0% for
the same kind of reason — both readers recorded the page's running footer, one under `course` and
one under `category`.

**The instruction bars are a segmentation mismatch, not missing method.** `instruction.text` is an
exact string match per step and `instruction.order` compares the whole sequence, so a capture that
splits or merges a step fails both even when every word is present. Re-checking the 53 truth steps
against the captures: 25 match exactly (47%, the scorer's figure), **12 more are close paraphrases
of a captured step** (≥0.75 similarity), and 16 have no close match — and of those 16, most come
from the four-recipe page, where three recipes were never captured. The step counts show the
mechanism plainly: two fixtures have more captured steps than truth steps (3→9, 1→5, the capture
splitting a long instruction), and one has far fewer (17→6, the four-recipe page). `instruction.order`
at 1/10 is that same fact stated all-or-nothing per fixture.

**`split_reserved` at 0/3 is two different things.** One capture did produce the binding, with the
`use` side matching the truth exactly and the `reserve` side phrased as the instruction rather than
as the ingredient phrase — a wording miss on a correct reading. The other two produced **no binding
at all**, one of them on the four-recipe page where the relevant recipe was never captured. So one
in three was read and mis-phrased; two in three were not expressed. That distinction matters for
what to fix and is invisible in the 0%.

**So: the capture reads real pages well, and several pre-registered bars are under-specified for
real sources.** Exact string matching on an ingredient name, on a step, and on a step sequence all
assumed synthetic fixtures where both sides shared a convention by construction; with an independent
transcriber they do not, and the bars charge the difference to capture accuracy. That is a
*threshold* question, and changing a pre-registered bar after seeing the score is exactly what
pre-registration forbids — so it is Kornelius's to decide, in a new threshold record, not something
to relax here.

A diagnostic, reported as a diagnostic: pairing ingredients by the schema's own name/qualifier
relationship instead of by exact name, **74 of 77 paired ingredients have an exact quantity (96%)
and 69 of 77 an exact unit (90%)** — still under the 98% bars, so the verdict is unchanged either
way. **This was computed after the failing score was seen** and therefore carries less weight than a
pre-registered measure; it is recorded because it identifies the cause, not because it changes the
outcome. The same caveat applies to the paraphrase and step-count figures above.

## Three findings that need a product decision, not a prompt tweak

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

3. **A required field with no source value gets one manufactured, and nothing says so.** On the
   handwritten card the capture stage was right: it segmented the page into four `instruction`
   blocks and **no title block**, because the card has no title. The contract then requires
   `title: z.string()` on a canonical recipe — required, and the one content field on the recipe
   root with no `sourceRefs` beside it. So normalization filled it with the full text of the first
   instruction, and the stored recipe is titled with a sentence from its own method. Nothing in the
   record marks that title as manufactured, and no ref can be checked against a block, because the
   field carries no ref. This is the mirror image of finding 1: that one loses content silently,
   this one adds it silently, and both are the class Gate A exists to catch. It is the same root
   cause as finding 2 — the contract asks for structure the source does not have — which is why
   sharpening that principle has to cover required fields, not only optional lists.

A fourth, smaller, affects any comparison harness: **a time keeps its value but moves its label.**
The source's label is captured into `sourceLabel` and the duration into the value, so a truth record
that holds the label inside `times` will not match a correct capture. That is what `time` at 0%
above measures, and it is a harness defect rather than a capture result — see the sequence recorded
under *Deviation from the pre-registered normalization*, which is also where the rule change made in
response to it, and its reversal, are set out.

## Deviation from the pre-registered normalization

`THRESHOLD.md` fixes an English unit-synonym table. The real sources are German, so every German
unit would have scored as a miss for a reason unrelated to capture accuracy. German units were added
to the scorer's synonym table **before any real score was computed**, and no bar, comparison rule or
verdict rule was touched by that change. `score.py --selftest` still passes and the synthetic
`scores-sonnet.json` is byte-identical apart from one new empty `unmeasured` key.

### A comparison rule was narrowed after a score, and has been reverted

This one is not a deviation that was recorded in advance, and it is worth stating plainly because it
is the failure mode pre-registration exists to prevent. The sequence, from the commit clock and the
file timestamps:

| when | what |
|---|---|
| 19:51 | the real-photograph run is scored and the result committed |
| 19:55-19:57 | the truth files are re-transcribed; a `*_label` key is added beside each time |
| 20:00 | `score.py`'s time check is narrowed to `("prep", "cook", "total")` |

The time check is a conjunction over every time key the truth records, so **dropping keys from it
can only add matches, never remove one.** It took `time` from **0% (0/2) to 100% (2/2)** and made it
the one critical field that met its bar — on a denominator of two, where a single fixture carries
the whole margin.

There is a real argument on the other side, and leaving it out would be its own kind of
dishonesty. `THRESHOLD.md` row 11 names the field "`time` (prep/cook/total)", so the narrowed rule
is the one the written threshold describes, and the wider rule in the code was arguably the
implementation that had drifted from it. A label is genuinely not a time, and the `*_label` keys are
a defect in the truth format.

It does not rescue the change, for one reason: **the labels and the narrowing arrived together,
after the score.** Neither number is a clean measurement of the pre-registration. 0% is the rule as
it stood when the run was scored, applied to truth files that had since grown keys it was never
written for; 100% is a rule edited after the fact, on n=2. So `time` is **not readable as a passed
bar in either direction**, and the verdict does not lean on it.

The narrowing has been **reverted** and the table above reports the pre-registered rule's 0%. Not
because that number is more true, but because it is the one that does not require a change made
after seeing a score. The field that meets its bar is `yield`, at 9/9 rather than 2/2 — a much
better-supported pass than the one this episode produced. The truth-format defect is listed under
*What a valid re-run needs*, where it can be fixed before a run is scored instead of after, and a
run scored that way will measure `time` honestly for the first time.

The comparison itself is now a named function, `times_match`, with four `--selftest` checks behind
it. It had none before: `--selftest` had twelve checks and not one of them touched the rule this
spike changed, so "selftest passes" proved everything except the thing that moved.

## The honest limit

Both readers are models. A failure mode they **share** — both misreading the same faded line the
same way — appears here as agreement and is invisible to this design. Agreement between independent
readers is real evidence and far stronger than the self-authored set, but it is not proof. **A
future PASS on this design needs a human spot-check of a sample of agreed fields**, not only the
adjudicated disagreements.

## What a valid re-run needs

The captures are already paid for, so re-scoring is free and has been redone: the corrected truth
spec and the `UsageKind`-derived split/reserved pair are what the table above reports, so no field
is left unmeasured any more. What is left is not free:

1. **A decision on the three findings**, and on whether exact matching on names, steps and step
   order is the right bar for a source an independent human transcribes. Without that, a re-run can
   only produce a better-explained FAIL.
2. **Adjudicate the remaining disagreements** — the one place human time is actually needed.
3. **Fix the truth format so `times` holds only times.** The `*_label` keys belong in a field of
   their own, or nowhere; inside `times` they make a correct capture score as a miss, which is what
   `time` at 0% above is measuring. Fix it before the run that is scored.
4. **Re-capture the one page that failed its contract check.** It now has a retry behind it, but the
   page could not be identified from what the run recorded (see *A smaller finding* above), so this
   waits on a re-run of the whole set rather than of one photograph.

Until then: **`OQ-14` stays open and scan deletion stays disabled.**
