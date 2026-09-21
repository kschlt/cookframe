# `inj-threshold` — choosing CFV1-INJ's claim-support threshold

One document: [`CALIBRATION.md`](CALIBRATION.md).

The item that produced it warned that the verification threshold is the real
design decision, and that the way it goes wrong is letting the first value whose
tests pass become the rule. This directory is the answer to "how was 0.70
chosen", kept where it can be read without reading the code, and it records the
**order** the work happened in as carefully as it records the numbers — the
threshold was fixed against legitimate conversions before any adversarial
fixture existed.

There is no runner here. The measurement reads the private Slice 1 corpus
(`evals/fixtures/private/`, git-ignored by the S1 constraint), so it is not
re-derivable from this repository and the document says so. What ships instead
is everything that decides what the numbers mean: the rule in
`src/pipeline/claim-support.ts`, its proofs in `tests/injection/`, and the
record of what changed after the fact and why.

The decision itself is `docs/adr/ADR-0019`.
