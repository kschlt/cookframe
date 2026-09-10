---
id: "ADR-0003"
title: "Postgres with validated JSONB documents plus extracted query columns"
status: proposed
date: 2026-09-10
tags: ["persistence", "postgres", "jsonb", "migrations"]
decides: ["OQ-03", "OQ-04"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001", "ADR-0002"]
---

## Context

The baseline defers both database technology and the JSON-versus-relational question, and requires
documented, versioned Source Snapshot and Canonical Recipe formats with explicit migrations and data
that is not trapped in opaque provider-specific formats.

The ontology is young. `scalingEligibility` semantics, nutrition basis and prepared-component
handling are all expected to move. A fully relational model of the Canonical Recipe is roughly
fifteen tables, each ontology change becoming a migration — expensive while the shape is still
settling.

Three queries decide the outcome: the library list (title, times, yields, source type), total
ingredient requirements for shopping, and side-by-side comparison of two normalization runs.

## Decision

Use Postgres. Store Source Snapshot and Canonical Recipe as JSONB documents validated against the
versioned contract before persistence, alongside a small set of extracted relational columns for
the queries above.

Before this ADR is accepted, write those three queries against both shapes. If any is unreasonable
in JSONB, revisit rather than absorbing the cost.

## Consequences

### Positive

- The ontology's shape lives in one versioned contract rather than spread across migrations.
- Ontology changes usually need no schema migration; reprocessing writes a new document version.
- Library and shopping queries stay honest SQL against extracted columns.
- Run comparison is a document diff, which is what the reprocessing invariant actually needs.

### Negative

- Extracted columns duplicate data and must be regenerated when the contract changes.
- JSONB defers integrity to application-level validation, so validation-before-persistence is
  load-bearing rather than optional.
- Postgres is a heavier self-hosting dependency than SQLite.

## Alternatives considered

**SQLite.** Simplest self-hosting story by a wide margin and a genuine fit for single-user V1.
Weaker JSON and query story, and the `sqlite3` CLI is absent from the current toolchain. Worth
revisiting if the container footprint becomes the dominant self-hosting complaint.

**Fully relational Postgres.** Best integrity guarantees, highest migration cost against a moving
ontology. Reconsider once the ontology has been stable across several reprocessing cycles.
