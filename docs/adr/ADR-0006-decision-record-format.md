---
id: "ADR-0006"
title: "Decision records: one file each, superseded rather than edited"
status: superseded
date: 2026-09-10
tags: ["decisions", "documentation"]
constrained_by: ["PDR-0001"]
superseded_by: ["ADR-0020"]
---

## Context

Discovery produced 86 addressable items — fixed decisions, deferred questions, pre-release tasks and
required spikes — as flat bullets in a single document with no identifiers and no lifecycle. That is
a sound record of what discovery concluded, but it cannot represent a decision being revised: there
is no way to say "this was decided, then replaced, for this reason".

Cookframe is developed in public, so the reasoning behind it should be readable years later by
someone who was not there. That needs each decision to be individually addressable and its history
to survive, rather than being reconstructed from `git log`.

Two classes of decision exist, distinguished by whether the decision would survive a from-scratch
rewrite in a different stack. Survives → product decision. Does not → architectural decision.
Architectural decisions are frequently bound by a product invariant, and naming that link is what
stops architecture from quietly eroding a product constraint.

## Decision

One file per decision, in a widely used ADR shape so that the records are ordinary data rather than
a private format:

- `docs/adr/` for architectural decisions, ids `ADR-NNNN`.
- `docs/product-decisions/` for product decisions, ids `PDR-NNNN`.
- Front matter: `id`, `title`, `status`, `date`; optionally `tags`, `supersedes`, `superseded_by`,
  `depends_on`, `related_to`, and `decides` for the open question a record closes.
- `status` is one of `proposed`, `accepted`, `superseded`, `deprecated`.
- Body sections `## Context`, `## Decision`, `## Consequences`, and `## Alternatives considered`
  where the rejected options matter.
- **An accepted record is never rewritten.** A decision changes by a new record that supersedes it,
  with `supersedes` and `superseded_by` set on both sides.

Open questions carry stable `OQ-NN` ids in [`../open-questions.md`](../open-questions.md), so a
record can name the question it closes and "what is still open" is answerable in one place.

The two classes are kept in separate directories rather than distinguished by a field, so that the
split is visible without opening files.

No index is committed by hand. A list of records is derived from the records themselves; a
hand-maintained one is wrong as soon as a record is added, and silently so.

## Consequences

### Positive

- Decision history is readable: what was decided, what replaced it, and why.
- Records are plain files in a conventional shape, so tooling can be pointed at them later without
  anything needing to be migrated first.
- Naming the bound product invariant makes an architectural decision that violates one visible.
- Open questions and decisions stop competing to be the same document.

### Negative

- Nothing mechanically enforces the format; front-matter validity and bidirectional supersede links
  rest on discipline until a check exists.
- Superseding rather than editing means a reader must follow a chain to find the current position on
  a topic, which is the cost of keeping the history.
- Until an index is generated, browsing the records means reading a directory listing.

## Alternatives considered

**Keep the single discovery document as the living decision log.** Rejected: it cannot represent
supersession, and it was already at 86 undifferentiated items before implementation started.

**One directory with a `class` field instead of two directories.** Rejected: the split is easier to
see as two directories, and it costs nothing.

**Migrate all 49 founding product decisions into individual records immediately.** Rejected as a
large mechanical churn of just-published discovery output for decisions that mostly will not move.
`PDR-0001` adopts them as a whole; one gets its own record when it is actually revised.
