---
id: "ADR-0003"
title: "Recipe layers persist as JSON documents behind a narrow repository interface"
status: accepted
date: 2026-09-10
tags: ["persistence", "boundaries", "reprocessing"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001", "ADR-0002"]
---

## Context

The baseline defers both database technology (OQ-03) and physical persistence shape (OQ-04), and
requires documented, versioned Source Snapshot and Canonical Recipe formats, explicit migrations, and
data that is not trapped in provider-specific formats.

This record originally chose Postgres with JSONB. It also specified the test that should decide the
question: write the three hardest queries — the library list, total ingredient requirements for
shopping, and side-by-side comparison of two normalization runs — against both a document and a
relational shape, and compare.

Those queries cannot be written honestly yet. They need one real Canonical Recipe, with real
`sourceRefs`, and two normalization runs to compare. **Slice 1 produces exactly that.** Choosing the
database now means choosing it with no data, days before the data exists.

What Slice 1 does require is somewhere to put a Source Snapshot and a Canonical Recipe, and the
ability to write a second normalization run without destroying the first.

## Decision

Two commitments, of deliberately different durability.

**Durable:** all persistence goes through a narrow repository interface — store and load a Source
Snapshot, store and load a Canonical Recipe version, list the library, and read two runs of the same
recipe for comparison. No storage type appears outside its implementation. Every document is
validated against the versioned contract before it is written.

**Provisional, for Slice 1 only:** implement that interface over JSON documents in the simplest store
that works. The document shape is the part that matters for versioning and reprocessing; the store
behind it is not yet a decision.

**OQ-03 and OQ-04 stay open.** They are closed by a later ADR once Slice 1 exists and the three
queries can be written against real data.

## Consequences

### Positive

- Slice 1 is unblocked without prejudging the database.
- The three deciding queries get written against a real Canonical Recipe rather than an imagined one.
- Validate-before-write is established from the first stored document, when it is cheap, rather than
  retrofitted.
- The reprocessing invariant is exercised by the interface itself: two comparable runs is one of the
  five operations, so an implementation that overwrites cannot satisfy it.
- For a single-user library of a few dozen recipes, migrating a JSON-document store to a database
  later is a small, bounded job.

### Negative

- Two implementations get written rather than one: the provisional store, then the chosen one.
- A repository interface designed before the query patterns are known may need widening; it should be
  extended when a real query demands it, not padded in advance.
- A provisional store can quietly become permanent by neglect. The trigger is explicit: OQ-03 and
  OQ-04 are decided when Slice 1 is done, not "later".

## Alternatives considered

**Postgres with validated JSONB documents plus extracted query columns.** The original form of this
record, and still the most likely outcome of OQ-03/OQ-04 — the reasoning that favoured it (a moving
ontology makes fifteen tables expensive) has not changed. Rejected only as premature: it is the
answer this record cannot yet justify with evidence.

**SQLite.** Simplest self-hosting story, a genuine fit for single-user V1, weaker JSON and query
story. Still open under OQ-03.

**Decide nothing and let Slice 1 improvise.** Rejected: the repository boundary and
validate-before-write are worth committing to now, and improvised persistence is exactly how the
reprocessing invariant gets broken.
