# Cookframe Documentation

<!-- index:start -->

## Product and architecture baseline

The outcome of pre-implementation discovery. Product constraints, not a frozen implementation design.

- [`product-vision-and-scope.md`](product-vision-and-scope.md) — intent, jobs-to-be-done, V1 boundaries
- [`recipe-ontology.md`](recipe-ontology.md) — Source Snapshot, Canonical Recipe and derived layers
- [`cooking-ux.md`](cooking-ux.md) — cooking UX and transformation principles
- [`adapter-architecture.md`](adapter-architecture.md) — source and output adapter boundaries
- [`ai-processing-and-reprocessing.md`](ai-processing-and-reprocessing.md) — processing stages and versioning
- [`open-source-self-hosting-principles.md`](open-source-self-hosting-principles.md) — public/private boundary and security posture
- [`validation-and-evaluation.md`](validation-and-evaluation.md) — validation gates and required spikes

## Decisions

- [`adr/`](adr/) — architectural decisions: how Cookframe is built
- [`product-decisions/`](product-decisions/) — product decisions: what Cookframe is and does
- [`open-questions.md`](open-questions.md) — what is still undecided, and what will close it

Which of the two a decision belongs in: would it survive a from-scratch rewrite in a different
stack? If yes, it is a product decision. If no, it is architectural.

## History

- [`decisions-and-open-questions.md`](decisions-and-open-questions.md) — the frozen discovery
  snapshot. Kept as a record of what discovery fixed and deferred; superseded by the decision
  records above.

<!-- index:end -->
