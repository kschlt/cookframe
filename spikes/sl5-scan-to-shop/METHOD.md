# How the scan-to-shop path will be measured

**Written before the run, and committed before any figure exists.** A rule relaxed after seeing the
number it moves stops being evidence, however good the reason — the reason is always available
afterwards, which is what makes the timing rather than the argument the thing that decides. This
project has paid for that lesson once already, in the S1 scoring on 2026-09-21.

So everything below is fixed now. If any of it turns out to be the wrong choice, that is a **finding
to record beside the result**, not an edit to make before publishing it.

## What is being measured

`CFV1-SL5` asks for the scan-to-shop path "measured **end to end**, reported with its distribution
rather than a single best case". The friction a user feels is the slow tail, so one good run answers
nothing.

The timed region opens **before the submission reaches the mobile entry point** and closes **when the
shopping document has been read out of the capability URL**. Inside it: capture, block-id assignment,
persistence, normalization, token issue, and the Schema.org mapping being served. That is the whole
journey the instance owns.

## What is NOT in the figure, and why

**The shutter and the upload.** No phone and no mobile network are reachable from the environment
this runs in, so the figure is instance-side: from the request arriving to the shopping document
being served. Both missing legs are real friction and neither is estimated, folded in, or
approximated — a number nobody measured does not belong beside numbers that were.

This is a limit on the measurement, not a substitution. The item's `What NOT` forbids substituting a
component-level timing for the end-to-end one, and the stage split (submit / handoff) is reported as
a breakdown **of** the total, never in its place.

## Population

**Every photograph in the corpus, in filename order, with no selection after the fact.** The corpus
is the eleven images from the S1 gate run: one continuous burst, iPhone 17, 2026-09-21. They are not
this measurement's to choose, and choosing a subset after seeing the times is how a tail disappears.

They stay outside this repository. Nothing about their content is recorded here — only durations,
outcomes and byte counts.

**One run per photograph.** The spread this reports is therefore **across inputs** — page complexity,
image size, how much text the model returns — and **not** across repetitions of the same input. Those
are different distributions and this one is the first. A repeat-variance figure would need repeated
calls on the same image, which is spend this run does not have authorisation for.

## Which runs contribute

Only runs that reach a served shopping document contribute to the end-to-end distribution. A page
that never becomes shoppable has no scan-to-shop time to report.

Refusals and failures are **counted and reported separately, never dropped silently.** At least one
refusal is expected before the run: the corpus contains the page carrying four separate recipes that
`spikes/s1-photo-gate/VERDICT.md` describes, and `CFV1-MR1` refuses a source holding several recipes
rather than truncating it. A refusal on that image is the pipeline working, and its absence would be
the surprising result — it would mean the guard that unit added does not fire on the very page that
motivated it.

The record identifies each image by its **position in filename order** — `photo-01` and so on —
never by the camera's filename. The corpus is private and stays out of this repository, so whoever
holds the photographs can map a row back to one and nobody else can. What is recorded per run is a
position, a byte count, an outcome and three durations.

## The statistic

Nearest-rank, over the contributing runs sorted ascending: the value at index `floor(q · n)`, clamped
to the last element. Reported as `n`, `min`, `p50`, `p90`, `max`, in milliseconds.

With `n` around ten, `p90` is the second-slowest run and nothing more. It is reported because the tail
is the point, and it is named here as a rank rather than an estimate of a population quantile so that
nobody later reads more into it than eleven samples can carry.

## There is no bar

The criterion asks for a measurement recorded with its distribution. **It does not name a threshold,
and none is invented here.** A figure recorded now is what later work regresses against; what counts
as "too slow" is a product decision nobody has taken, and inventing one during a measurement is how a
threshold ends up fitted to the result it was supposed to judge.

## Cost

The run makes real model calls and costs real money. Token counts are **measured** by a counter
wrapped around the transport and reported as fact; any dollar figure is an estimate and is labelled
as one, because no per-token price is recorded anywhere in this repository.

The run happens only with the owner's explicit go-ahead, and the estimate is given before it, not
after.

## What would make a later run incomparable with this one

Recorded now so a future reader does not have to reconstruct it:

- a different model, or a change to the capture or normalization prompts
- a different corpus, or a different number of photographs
- a change to what the timed region covers — in particular, if the shutter or the upload ever enter it
- persistence moving off the in-process provisional store to a real database

Any of these makes the figures two different measurements that happen to share a name.

## Reproducing it

```
tsx spikes/sl5-scan-to-shop/run.mts --photos <dir> --out spikes/sl5-scan-to-shop/measurements.json
```

`--fake` runs the identical path against deterministic providers with no network and no spend. That
is how the harness was got right before anything was paid for, and it is how a change to the harness
should be checked before it is paid for again.
