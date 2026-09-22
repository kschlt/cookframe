# The scan-to-shop path, measured

Run on 2026-09-22, against `gpt-5.4`, over the eleven photographs of the S1 gate corpus, by the
method fixed in [`METHOD.md`](METHOD.md) before any figure existed. The record is
[`measurements.json`](measurements.json); `tests/slice5/scan-to-shop.test.ts` checks the summary
against the runs it claims to summarise rather than taking it on trust.

Nothing below was decided after seeing a number. Where the run departed from what the method
anticipated, it is written down here as a finding, which is what METHOD.md said would happen
instead of an edit to METHOD.md.

## The figure

Instance-side, end to end: the submission arriving at the mobile entry point, through capture,
block-id assignment, persistence and normalization, to the shopping document being read out of the
capability URL. **The shutter and the upload are not in it** — no phone and no mobile network are
reachable from where this runs — and neither is estimated or folded in.

| | n | min | p50 | p90 | max |
|---|---|---|---|---|---|
| **end to end** | 8 | 13.8 s | 19.6 s | 41.5 s | 41.5 s |
| submit leg | 8 | 13.8 s | 19.6 s | 41.5 s | 41.5 s |
| handoff leg | 8 | 0.6 ms | 0.9 ms | 2.3 ms | 2.3 ms |

The breakdown is a breakdown **of** the total, never a substitute for it. It says one thing plainly:
**the journey is the model calls.** The shopping handoff — token issue, lookup, Schema.org mapping,
document served — costs about a millisecond, roughly one part in twenty thousand. Anything done to
make this path faster has to be done to capture and normalization; nothing else in it is measurable
at this scale.

**There is no bar**, and none is invented here. This is the baseline later work regresses against;
what counts as too slow is a product decision nobody has taken.

## Three findings

### 1. `p90` carries no information in this run

METHOD.md says "with `n` around ten, `p90` is the second-slowest run and nothing more." That
sentence assumed the contributing set would be about the size of the corpus. Three photographs were
refused, so `n` is 8, and nearest rank at `q = 0.9` is `floor(0.9 × 8) = 7` — the last index. **`p90`
and `max` are the same run.** The rule was applied exactly as registered; the rule's own commentary
is what turned out not to hold. Read `p50` and `max` here and treat `p90` as a duplicate of `max`
until a run has enough contributing photographs to separate them.

### 2. Two of the three refusals are wrong, and wrong in the same way

The corpus was expected to produce **one** refusal: the cookbook spread carrying four separate
recipes that `spikes/s1-photo-gate/VERDICT.md` describes, and that `CFV1-MR1` exists for. That one
fired, correctly. Two more fired that should not have:

- a page whose recipe text is a **single** recipe, facing a full-page photograph of several
  different finished dishes;
- a **single** handwritten card, photographed lying on top of other printed recipe sheets whose
  edges are partly in frame.

Both were checked against the photographs by eye after the run. Neither source holds several
recipes, and on both the person was told their capture was refused because it did.

The two share one cause: **the count is taken from what is in the frame, not from what is being
captured.** A dish in a photograph is not a recipe, and a neighbouring sheet caught at the edge of
the shot is not part of this source. On the mobile path that distinction is not an edge case — a
phone photograph of a cookbook page is a photograph of a book on a table, and something else is
almost always in it.

**This is a refusal rate of 2 in 11 on a product whose claim is low friction, and the refusal is
final: the person is told to photograph one recipe on its own, which on both of these is what they
already did.** Registered as `OQ-41`. It is not fixed here — SL5 owns making the refusal reach the
person, which it does, and `CFV1-MR1` owns the counting. Changing the counting after seeing a rate
it produces is a decision with a threshold in it, and this unit does not get to take it quietly.

### 3. Twenty-one model calls for nineteen stages

Eight shoppable runs are two stages each; three refusals stop after capture. That is nineteen
stages, and **twenty-one calls were made** — two extra attempts, which is retry-on-contract-failure
doing its job. Nothing failed, so both retried stages went on to conform.

**Which photographs they belonged to is not in the record**, and this report does not guess: the
runner counts calls at the transport and does not carry the per-stage `attempts` the providers
already track. So a retried conversion pays roughly double the model time, and the tail here cannot
be read as page complexity without that attribution. Recording `attempts` per run is the cheap fix
and would make a re-run of this measurement say more than this one can; it is not done here because
changing the harness after seeing the figures is how a method drifts.

## What it cost

**Measured** by a counter wrapped around the transport, and reported as fact:

| calls | input tokens | output tokens |
|---|---|---|
| 21 | 145,032 | 34,338 |

**Estimated**, and flagged as an estimate because no per-token price is recorded anywhere in this
repository: **roughly $0.75 to $1.00.** The S1 gate run over the same eleven photographs, at a
comparable call count and token volume, came to about $0.75. The exact figure is readable only from
the OpenAI dashboard; the project key has no usage-read scope.

## What would make a later run incomparable

Listed in METHOD.md and unchanged by this run: a different model, a change to the capture or
normalization prompts, a different corpus or a different number of photographs, a change to what
the timed region covers, or persistence moving off the in-process provisional store.

To that list this run adds one that is worth stating because it is not obvious: **the number of
contributing runs.** Three refusals took `n` from 11 to 8 and, with it, took the meaning out of
`p90`. A later run that refuses a different number of photographs is comparable on `p50` and `max`
and is not comparable on `p90` at all.
