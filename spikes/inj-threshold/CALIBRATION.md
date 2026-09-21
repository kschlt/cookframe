# CFV1-INJ — choosing the claim-support threshold

The item warns that the verification threshold is the real design decision, and
that the failure mode is letting the first value whose tests pass become the
rule. This is the record of how it was chosen instead: what was measured, in
what order, what changed afterwards and why, and what the numbers were both
times.

No page content appears here. The corpus is private by the Slice 1 constraint
(`evals/fixtures/private/`, git-ignored), so what is quoted below is counts,
rates and the *classes* of divergence — never a sentence from a source.

## The rule being calibrated

A normalized fact carries the source's own wording in `sourceText`, beside the
`sourceRefs` that ground it. Verification asks whether the cited block supports
that wording:

1. **Containment.** The claim, normalized, occurs in the cited block text,
   normalized. This is the rule that carries the guarantee — the words are
   literally on the page.
2. **A bounded relaxation.** Failing that, the fraction of the claim's words
   appearing *in order* in the cited text must reach `SUPPORT_COVERAGE_THRESHOLD`.

Normalization folds Unicode form, typographic dashes and quotes, a hyphen
between two letters, whitespace runs, and case — and nothing else. Nothing is
removed or reordered, so two texts that normalize equal differ only in
presentation.

## Order of work

This matters more than the numbers, so it is stated first.

1. The threshold was calibrated **only against legitimate conversions**, where
   the correct answer is "supported". 696 claims from 20 real Canonical Recipe
   versions over 10 recipes — the CFV1-DBQ corpus.
2. A null model supplied the "should fail" population **without any adversarial
   writing**: the same real claims scored against a block from a *different*
   recipe. Real prose on both sides, so the separation is not an artifact of how
   an attack was worded.
3. The threshold was fixed, and the adversarial fixtures were written and scored
   **afterwards**. No fixture result moved it.
4. The **shipped rule** was then run over the same corpus and compared against
   the probe. It disagreed, and the disagreement was a defect in the shipped
   rule rather than in the threshold (see *Two corrections*). The table below is
   the re-measurement.

## Measurement

Measured by running **the shipped rule itself** (`src/pipeline/claim-support.ts`)
over the corpus — see *Two corrections* below for why that sentence is load-bearing.

| threshold | claims refused (of 696) | versions touched (of 20) | null-model claims accepted (of 478) |
|---|---|---|---|
| containment only | 2 | 2 | 0.21% |
| 0.90 | 2 | 2 | 0.21% |
| 0.80 | 2 | 2 | 0.21% |
| **0.70 (chosen)** | **2** | **2** | **0.21%** |
| 0.60 | 2 | 2 | 0.63% |
| **0.50** | **0** | **0** | **2.72%** |

Two classes of legitimate divergence account for the refusals, and for what the
relaxation is for:

- **A printed line break hyphenating a word.** The page broke a word across
  lines and capture kept the hyphen; the canonical spells it whole. This is
  handled entirely by normalization, so it never reaches the relaxation.
- **An inflected adjective lemmatised.** German declension. Inside a long
  quotation this scores ~0.91 and is tolerated, which is the case the relaxation
  exists for. In a **two-word** claim the same inflection scores 0.50 and is
  refused — deliberately, see below.

## The decision

**`SUPPORT_COVERAGE_THRESHOLD = 0.70`.**

Chosen because the measurement is **insensitive** there: every value from 0.60
to 1.00 refuses the same two claims. On this corpus the relaxation changes
nothing at all — and that is the argument, not an embarrassment. A threshold
that has no effect on the data it was calibrated against cannot have been fitted
to it. It is there for the long-quotation-with-one-inflection case, which this
corpus does not happen to contain in quantity and a fetched page will.

**Why it cannot go to 0.50, which is the only value that would refuse nothing.**
Not because an aggregate rate worsens — because two populations *collide* there.
Measured on self-authored examples:

| example | coverage |
|---|---|
| a lemmatised adjective in a long quotation | 0.91 |
| a two-word claim with one word inflected | **0.50** |
| a fabricated claim sharing half its words with the block it cites | **0.50** |
| a fabricated claim sharing nothing | 0.00 |

At 0.50 a legitimate short claim and a fabrication that borrows half its
vocabulary are indistinguishable, so no threshold can admit one without
admitting the other. Two words with one of them wrong is not evidence, and the
corpus's two refusals are exactly that shape. "Refuses nothing on the
calibration corpus" is precisely the criterion that would have selected 0.50,
which is why it is not the criterion.

**The failure is on the first unsupported claim, not on a rate.** A rate would
separate the populations more comfortably — a fabricated conversion scored
0.00-0.34 claim support against a real page, a legitimate one 1.00 — but the
harm from one invented ingredient is not proportional to its share of the
recipe. The cost is a small false-refusal rate on legitimate pages, and a
refusal is recoverable where an invented allergen in a persisted recipe is not.

## Two corrections, disclosed rather than folded in

Both are changes to a comparator made after numbers existed, which is the class
of change that must never be made quietly. Both are recorded with what moved.

**1. The hyphen fold was incomplete.** The first implementation folded a hyphen
only when whitespace followed it, which is not the shape the corpus has: capture
has already joined the lines, so the hyphen sits between two letters. A proof
written from the stated behaviour caught it. Corrected to fold a hyphen between
two letters, applied **identically to claim and block**, so it cannot move a
claim toward its own block in particular.

**2. The calibration probe was not the shipped rule.** The threshold was first
measured with a Python probe. Running the shipped TypeScript over the same
corpus afterwards refused **0 of 696** where the probe had refused 2 — the two
implementations disagreed, so the registered table described something other
than the code that runs. Two causes, both real:

- The probe used Python's `SequenceMatcher`, which approximates a longest common
  subsequence from below; the shipped rule computes the LCS the docstring
  describes. The shipped rule is the correct one.
- **The shipped tokenizer was ASCII-only.** `\w` is `[A-Za-z0-9_]` in JavaScript,
  so "große" tokenized as `gro` + `e` and "Schüssel" as `sch` + `ssel` — on a
  German corpus, most of the vocabulary. The fragmentation is symmetric, so
  nothing failed loudly; it silently changed what a coverage ratio counts, and
  with it what the threshold means. Fixed to `[\p{L}\p{N}_]+`, with a proof.

The table above is the re-measurement, made with the fixed rule. The threshold
did not move: 0.70 was already in the flat region under both implementations,
which is the one piece of luck in this and not something the method relied on.
The lesson worth keeping is the check itself — **calibrate the code that ships,
not a probe that resembles it** — and it was only caught by running the shipped
function over the real corpus rather than trusting that two implementations of
one paragraph agree.

## Two stages, two rules — and a reasoning error, disclosed

The measurement above scored **normalization** claims: a canonical fact against
the snapshot block it cites. Two later findings changed what the other stage
does and what "cited" means, and both were reproduced against the shipped code
before anything was changed.

### The capture stage does not use this threshold at all

A later adversarial pass found that the chain had no anchor — the snapshot is a
model output too, so a model that invents at *capture* is verified against its
own record of the invention. Closing it added a second use of the comparator:
each captured block against the decoded input.

**That reused the threshold, and reusing it was wrong.** Coverage counts a
claim's words appearing in order anywhere in the text it is scored against, so
the score depends on how big that text is — and at capture the text is a whole
page rather than one cited block. On a 21-line recipe page, seven fabricated
blocks that appear nowhere on it were all accepted, several at coverage 1.000:
"225 g Backpulver" where the page says *1 Teelöffel*, "Den Ofen auf 200 Grad
vorheizen" where it says *180*. The words are all on the page; only their
arrangement is invented. That is the recombination attack the item's own Hints
name as the strongest proof, and the shipped anchor did not catch it.

**The error in the reasoning, stated plainly.** This document justified reusing
the number like this: *"the capture comparison is strictly easier than the one
measured (a captured block is a span of the input, not a paraphrase of it), so
a threshold calibrated on the harder comparison is not being loosened for the
easier one."* That is sound for FALSE REFUSALS and backwards for FALSE
ACCEPTANCES — and the security property rests on the second. An easier
comparison means legitimate blocks clear the bar more easily; it equally means
fabricated ones do. The disclosure that the second stage was not separately
calibrated was already here and was not enough, because what changed was not
only the corpus but the SHAPE of the comparison.

**The capture rule is now containment**, on the normalized text, with no
relaxation. A captured block is a span of the input — capture segments text, it
does not paraphrase — so containment is a bar that stage can actually carry:

| | blocks | contained verbatim after normalization |
|---|---|---|
| real Slice 1 snapshots | 191 | **191 (100%)** |

So the relaxation bought no false-refusal headroom at this stage and was attack
surface only. Measured with the shipped `normalizeForSupport`, against each
snapshot's own captured text. Note what this does *not* measure: the corpus is
photographs, and the rule governs `url` and `text` sources, where no page has
been captured yet.

### Claims are scored against the best cited block, not their concatenation

The second finding: `verifyClaimSupport` joined the text of every cited block
and scored the claim against the concatenation, so citing MORE blocks could only
raise the score. The model writes its own refs, so it was choosing its own
haystack — the same failure this rule exists to prevent, reached by widening a
citation instead of inventing a ref. An invented "250 g Zwiebel" scores 0.667
against the best single block and **1.000** against every block joined.

Scored per block now, best block wins. Re-measured over the same 696 claims,
**with the shipped TypeScript rather than a probe**:

| rule | claims refused of 696 |
|---|---|
| joined citations (as calibrated) | 2 (0.29%) |
| best cited block (as shipped) | **2 (0.29%)** |
| newly refused by the change | **0** |

The same two claims, and no legitimate claim lost. The threshold did not move
and was not re-chosen: both changes TIGHTEN the rule in response to a
reproduced attack, which is the one direction that needs no timestamp defence.
Loosening either after seeing a score is what `CFV1-THR` exists to prevent.

## Round three: the threshold is gone

A third review round found the same root cause behind a third door, and closing
it removed the relaxation entirely. **This document now records how a threshold
was chosen, measured, defended — and then found not to be the right shape of
rule at all.** That sequence is kept rather than rewritten, because the reasoning
that produced the threshold was not lazy and is worth being able to re-read.

### The finding

Scoring per cited block closed citation-widening. It did not close **block
granularity**, because how large a block is is also the capture model's choice,
and `ingredient_group` and `instruction_group` are block types the schema itself
defines. Against an ordinary title / ingredients / steps segmentation of a
13-line page, six of six inventions absent from the page scored 1.000 — "250 g
Zwiebel" welded from "250 g rote Linsen" and "1 Zwiebel"; a step welded from two
separate steps. Driven end to end in the degenerate one-block case, a fact
nowhere on the page reached a valid canonical with its ref resolving.

The ADR's own sentence named the mechanism — *"the relaxation's meaning depends
on how large the text scored against is"* — and then applied it to the capture
stage only.

### The measurement that decided it

Over the same 696 claims, with the shipped TypeScript:

| rule at normalization | claims refused of 696 |
|---|---|
| best cited block, coverage 0.70 (round 2) | 2 |
| **containment in one cited block** | **3** |
| windowed coverage, window ≤ 1x claim length | 3 |
| windowed coverage, window ≤ 2x claim length | 3 |
| windowed coverage, window ≤ 3x claim length | 2 |

Two readings, and the second is the one that settled it.

**A bounded window buys nothing over containment** until the window is wide
enough (3x) to admit recombination again — so the intermediate rule would have
added a parameter to calibrate and defend while purchasing no headroom.

**The relaxation was buying exactly one claim of 696**, and of the three claims
containment refuses, two were already refused at 0.70. That one claim scores
**1.000**: every word present, in order, with a gap. That is the recombination
attack's own signature. **No rule can accept that claim and refuse the attack,
because at that point they are the same signal.** The choice was not "strict
versus tolerant"; it was "keep one legitimate claim in 696 and keep the attack
class, or lose both".

### What this costs, stated plainly

A legitimate quotation differing from its source by an inflection is now
refused. One in 696 on this corpus, which is photographs and harder than the
fetched pages the rule governs. It is a real cost and it is not zero.

### What replaced the threshold

Nothing. Both stages require containment on the normalized text, checked per
block. There is no bar to calibrate, none to protect from tuning, and no second
parameter. `SUPPORT_COVERAGE_THRESHOLD` survives so a refusal can report how
close the wording came; it decides nothing.

Normalization is what survives of this calibration and still carries weight: the
Unicode, dash, quote, hyphen and whitespace folds are what make containment a
rule about wording rather than about bytes, and they were measured here.

## What this calibration does not establish

- **The corpus is photographs; the rule governs fetched pages.** Photographs
  carry OCR hyphenation that HTML does not, so the calibration population is
  *harder* than the governed one. That is the conservative direction, but it
  means the false-refusal rate here is an upper bound rather than a prediction.
  The one class that will recur on fetched text is lemmatisation.
- **No fetched page has been measured.** Slice 4's model fallback does not exist
  yet; this item is its precondition. The first real measurement belongs to that
  unit, and the rate should be re-read then rather than assumed from here.
- **The null model is weak for one-word claims.** "Salz" appears on many pages,
  so a single-token claim scores as supported against almost any block. That is
  a limitation of the null model rather than of the rule — the cited block does
  contain the word — but it means the protection against fabrication rests on
  multi-token claims, which is where a fabricated recipe's content lives.
- **Nothing here says the model obeys the fence.** Separation and verification
  are independent halves; this document is about the second.

## Reproducing it

The measurement runs over the private corpus and is not re-derivable from this
repository. What is committed is everything that decides what the numbers mean:
the rule (`src/pipeline/claim-support.ts`), its proofs
(`tests/injection/`), and this record of the order in which they were fixed.
