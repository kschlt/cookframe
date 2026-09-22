---
id: "ADR-0018"
title: "The repository interface gains loadLatestCanonical, widening ADR-0003 from five operations to six"
status: superseded
superseded_by: ["ADR-0025"]
date: 2026-09-21
tags: ["persistence", "boundaries", "repository-interface"]
supersedes: ["ADR-0003"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0016", "ADR-0007"]
---

## Context

ADR-0003 fixed the persistence boundary at a narrow repository interface of five
operations: store and load a Source Snapshot, append a Canonical version, list the
library, and read two runs of the same recipe for comparison. It anticipated this
moment in its own negative consequences: *"A repository interface designed before
the query patterns are known may need widening; it should be extended when a real
query demands it, not padded in advance."*

Two slices have since hit the same wall from opposite directions, which is evidence
about the interface rather than about either slice:

- **The shopping slice** serves one saved recipe at a capability URL (ADR-0016). To
  do that its route must load the *latest* Canonical version for a recipe id. None
  of the five operations does this: `listLibrary` gives a title and a version count,
  `readTwoRuns` needs two version ordinals and throws when they are wrong, and the
  rest write. So the route that is the whole point of the capability URL cannot be
  built.
- **The database evaluation (CFV1-DBQ)** hit the other one. Aggregating ingredients
  for a shopping list — one of the three deciding queries ADR-0003 named — has no
  operation either, and that evaluation carries it as follow-up work and a named
  negative consequence rather than quietly adding it.

The timing is right: the persistence shape is now decided and measured on real data,
so the interface is widened against a known store rather than a provisional one. Left
open, it blocks a slice and gets answered twice, differently, by two threads that
each need a read the interface does not offer.

## Decision

**Widen the interface by one read, `loadLatestCanonical`, and supersede ADR-0003 on
the operation set.** An accepted record is never rewritten, so this is a new record;
ADR-0003 stays readable in place, its `superseded_by` set to this record.

1. **The added operation.** `loadLatestCanonical(recipeId)` returns the latest
   Canonical version for the id, or `undefined` when no recipe has that id.
2. **Not-found is a return value, not a throw.** The caller that demanded this is the
   shopping slice's capability-URL route, which must tell a **revoked token** from a
   **missing recipe** and should not catch an exception to do it. So the read follows
   `loadSnapshot`, which already returns `undefined`, not `readTwoRuns`, which throws
   for a caller that named a version ordinal and got it wrong. Inside a store a throw
   is fine; at this interface, for this caller, the absence is data.
3. **The read is added for a specific, active consumer — not for completeness.**
   `loadLatestCanonical` is added for the shopping slice's capability-URL route
   (ADR-0016), the immediate next unit: its token→recipeId resolution already exists
   (`src/shopping/capability-token.ts`), and turning that resolved id into the recipe
   the route serves is exactly this read. The read is added *with* the unit that needs
   it — which is blocked only on the HTTP framework (ADR-0007), not on any design
   question — rather than ahead of any consumer. The interface is not padded with
   reads "for completeness"; such a read is a commitment every future store must
   honour, bought with nothing.
4. **The other five are unchanged.** Their signatures and behaviour are exactly as
   ADR-0003 fixed them, and the durable commitments of that record carry forward
   unchanged: all persistence goes through this interface, no storage type appears
   outside its implementation, and every document is validated against the versioned
   contract before it is written.
5. **The suite is written against the interface, not a store.** One shared contract
   is run against every store in a registry, so a store implementing the interface
   inherits the proofs rather than getting its own suite. With a single store in the
   tree today, that is also the only way to catch an operation that is in truth
   implementable in only one store: an interface operation is one *both* stores can
   answer.

**The shopping aggregation is named here as a known future need, and deliberately
NOT added.** The evidence for it is real — the database evaluation measured a total
ingredient requirement against an extracted projection, and ADR-0003 named it among
the three deciding queries — but it has **no caller in the tree today**. Adding it
now would break the very rule this record is built on (a read is added only with a
caller). It is recorded so a later reader can tell a measured need from an
anticipated one, and so it is added by the slice that first consumes it, with its
shape settled by that slice's real query rather than guessed here.

The widened operation set is therefore: `storeSnapshot`, `loadSnapshot`,
`appendCanonicalVersion`, `loadLatestCanonical`, `listLibrary`, `readTwoRuns`.

## Consequences

- The shopping slice's capability-URL route is unblocked: it can load exactly the
  recipe a token resolves to, and distinguish a missing recipe from a revoked token
  without exception handling.
- A read added with a named caller keeps the interface honest — the record says, per
  operation, which caller demanded it, so the interface does not accrete speculative
  reads that every future store must implement.
- The contract suite is the persistent store's acceptance test in advance: whatever
  store the DBQ decision lands, it joins the registry and must pass the same proofs,
  which is where an operation only one store can serve would fail loudly.
- The shopping aggregation remains a known gap with recorded evidence, not a silent
  one; the interface grows again, by the same rule, when its caller is built.

## Alternatives considered

- **Each slice adds its own read.** Rejected: two threads would make the same
  decision twice, in two shapes, and the interface both stores answer to would drift.
  Widening once, by a superseding record, is the decision made in one place.
- **Add the shopping aggregation now, while widening.** Rejected: it has no caller in
  the tree, so it would be a read "for completeness" — the exact padding ADR-0003
  warned against and this record forbids. Its shape is better fixed by the slice that
  consumes it.
- **Make `loadLatestCanonical` throw on an unknown id, like `readTwoRuns`.** Rejected:
  the public capability route would then have to catch an exception to distinguish a
  missing recipe from a revoked token — turning an ordinary control-flow case into
  exception handling on the request path. `undefined` states the absence plainly.
- **Leave the interface at five and let the route reach around it** (e.g. list, then
  read two runs of the same version). Rejected: it abuses `readTwoRuns` for a single
  version and leaks a serving concern into a comparison operation; the honest fix is
  the read the route actually needs.
