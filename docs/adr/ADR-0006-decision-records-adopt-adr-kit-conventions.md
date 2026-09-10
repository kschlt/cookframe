---
id: "ADR-0006"
title: "Decision records conform to adr-kit conventions with no bespoke tooling"
status: accepted
date: 2026-09-10
tags: ["decisions", "adr", "documentation", "tooling"]
constrained_by: ["PDR-0001"]
---

## Context

The published discovery baseline records 86 addressable items — 49 fixed product decisions, 23
deferred open questions, 9 pre-release tasks, 5 required spikes — as flat bullets in a single
document with no identifiers and no lifecycle. That is a sound snapshot of discovery but cannot
absorb years of decisions being revised and superseded.

Two decision classes exist, distinguished by whether the decision would survive a from-scratch
rewrite in a different stack. Survives → product decision. Does not → architectural decision. Many
architectural decisions are bound by a product invariant, and that link is what stops architecture
from silently eroding product constraints.

The obvious move would be to design a register: front-matter, a generated index, CI validation. The
`adr-kit` project already does all of that — schema, immutability enforcement by content digest,
JSON and SQLite index generation, staged lint enforcement — so designing another would mean building
a mechanism that later has to be removed.

## Decision

Conform to `adr-kit`'s contract as **data**, and ship no decision tooling of our own.

- Architectural decisions: `docs/adr/`, ids matching `^ADR-\d{4}$`, front-matter valid against
  `adr-kit`'s `adr.schema.json`, statuses limited to `proposed | accepted | superseded | deprecated`,
  MADR body sections (`## Context`, `## Decision`, `## Consequences`).
- Accepted records are never rewritten. Substance changes only by a new record that supersedes the
  old one.
- Product decisions: `docs/product-decisions/`, ids `PDR-NNNN`, mirroring the same front-matter
  grammar and lifecycle. They live outside `docs/adr/` because `PDR-NNNN` does not match adr-kit's
  id pattern, and must not be placed where its parser would reject them.
- Deferred questions carry stable ids `OQ-NN`, so records can name what they close and "what is
  still open" is a query rather than a paragraph someone forgets to update.
- Cross-references use adr-kit's native `supersedes`, `superseded_by`, `depends_on` and `related_to`
  where tooling should traverse them, plus `decides`, `constrained_by` and `evidence` for Cookframe's
  own semantics. The schema sets `additionalProperties: true`, so those custom keys are schema-legal.
- No index is committed and no generator or validator is written. `adr-kit`'s index is a derived
  artefact; its tooling state (`.adr-kit/`, `.project-index/`, `adr-index.json`) is ignored.
- **No record carries an enforcement `policy` block until there is code to enforce against.** A
  policy block describes lint and boundary rules for a real module layout; writing one before the
  code exists means inventing constraints to satisfy a validator.

## Consequences

### Positive

- Nothing to migrate later: the repository holds conforming data, so `adr-kit` — or any successor
  decision engine — can be pointed at it and adopt the records as they stand.
- Supersede-never-edit makes decision history readable rather than reconstructed from `git log`.
- No index can drift, because none is maintained by hand.
- Product decisions get the same grammar without waiting for a tool that supports them.

### Negative

- Until a tool is wired in, nothing mechanically enforces the conventions — front-matter validity and
  bidirectional supersede links rest on discipline or a later `uvx adr-kit` check.
- With no committed index, readers browse a directory listing. Acceptable at this scale; revisit when
  the record count makes it inconvenient.
- `docs/product-decisions/` is a Cookframe-local convention with no tool behind it today.

### Neutral

- `adr-kit`'s policy-completeness check requires every `accepted` record to carry a structured
  `policy` block, so running it today reports an error for each accepted record here. That is
  expected and is not a defect in these records: no enforcement policy is written until there is a
  module layout to enforce. Nothing in this repository gates on that check.
- `adr-kit` is a development tool invoked via `uvx`, not a runtime dependency, so its being Python
  while the product is TypeScript is irrelevant.
- Whether this repository ships MCP configuration wiring `adr-kit` into an agent is a separate
  question about local versus public repository guidance, deliberately not settled here.

## Alternatives considered

**A purpose-built register with a generator and CI validation.** What was originally proposed here.
Rejected on inspection: it duplicates `adr-kit` and becomes the thing a future decision engine has to
displace. Keeping only data avoids that entirely.

**Keep the single discovery document as the living decision log.** Rejected: it is exactly the
monolith that cannot represent supersession, and it is already at 86 undifferentiated items.

**Migrate all 49 founding product decisions into individual records now.** Rejected as a large
mechanical churn of just-published discovery output for decisions that mostly will not move. They are
adopted wholesale by PDR-0001 and migrated individually only when one is actually revised.
