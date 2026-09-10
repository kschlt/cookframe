# Product Decision Records

Product decisions live here. Architectural decisions live in [`../adr/`](../adr/).

## Which is which

> Would this decision survive a from-scratch rewrite in a different stack?

- **Survives → product decision (PDR).** Canonical Recipe is the durable center. No fabrication of
  source facts. No canonical action reordering in V1. Bring is an adapter. A capability URL is not
  authentication. MIT license.
- **Does not survive → architectural decision (ADR).** Runtime, language, persistence shape, model
  SDK, token format, safe-fetch implementation, generation timing.

Most architectural decisions are bound by a product invariant. An ADR names that link with
`constrained_by`, so architecture cannot quietly erode a product constraint.

## Conventions

These mirror [`adr-kit`](https://github.com/kschlt/adr-kit) exactly, so that the same lifecycle,
grammar and tooling apply to both classes:

- Filename `PDR-NNNN-short-title.md`, id matching `PDR-\d{4}`.
- Front-matter keys as in adr-kit's `adr.schema.json`: `id`, `title`, `status`, `date`, plus optional
  `deciders`, `tags`, `supersedes`, `superseded_by`, `depends_on`, `related_to`, and Cookframe's
  `decides`, `constrained_by`, `evidence`.
- Status is one of `proposed`, `accepted`, `superseded`, `deprecated`. Nothing else.
- Body sections `## Context`, `## Decision`, `## Consequences`.
- **An accepted record is never rewritten.** Substance changes only by a new record that supersedes
  it, with `supersedes` and `superseded_by` set on both sides.

PDRs sit outside `docs/adr/` deliberately: `PDR-NNNN` does not match adr-kit's `^ADR-\d{4}$` id
pattern, so keeping them separate means its parser never sees a record it must reject.

## No tooling

There is no generator, no committed index and no bespoke validator here — see
[ADR-0006](../adr/ADR-0006-decision-records-adopt-adr-kit-conventions.md). These files are data in a
known format. Any decision engine can be pointed at them later and adopt them as they stand, with
nothing to migrate. Today the directory listing is the index.

## Relationship to the discovery baseline

[`../decisions-and-open-questions.md`](../decisions-and-open-questions.md) is the frozen discovery
snapshot. Its fixed product decisions are adopted wholesale by
[PDR-0001](PDR-0001-adopt-discovery-baseline-as-founding-product-decisions.md) rather than copied
here. An individual record is written only when one of them is actually revised — at which point that
record supersedes the specific item, not the document.

Its deferred questions carry stable `OQ-NN` ids so records can name what they close.
