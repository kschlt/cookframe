---
id: "ADR-0002"
title: "TypeScript as the implementation language"
status: accepted
date: 2026-09-10
tags: ["language", "typescript", "schema"]
decides: ["OQ-02"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001", "ADR-0003"]
---

## Context

Slice 0 cannot be written without a language, so this decision is forced now. The only argument
against TypeScript — that evaluation work is more pleasant in Python — turns out not to bear on it:
the eval harness can be Python reading committed JSON fixtures whatever the product is written in. No
evidence is pending, so there is nothing to wait for.

The product baseline deferred the language explicitly, allowing a change away from TypeScript "if
real constraints justify a change".

The dominant constraint is that the Canonical Recipe contract is used in four places: model-output
validation, persistence, the Schema.org mapping, and server-side rendering of the recipe page. Every
language boundary crossed between those points is a place where the contract can drift, and the
ontology is expected to keep moving for some time.

## Decision

Implement Cookframe in TypeScript on Node 22, with the Source Snapshot and Canonical Recipe
contract defined once and reused for validation, persistence and mapping.

## Consequences

### Positive

- One definition of the recipe contract, shared by validation, storage, mapping and rendering.
- Server-rendered HTML needs no second language or serialisation boundary.
- Matches the runtime chosen in ADR-0001.

### Negative

- Evaluation and scoring work (S1, S4) is more pleasant in Python; expect either a small
  TypeScript harness or a separate Python eval tool reading committed fixtures.
- Multimodal and ML tooling ecosystems are richer in Python.

### Neutral

- `adr-kit` being a Python tool is unrelated: it is a development tool invoked via `uvx`, never a
  runtime dependency of the product.

## Alternatives considered

**Python.** Stronger eval, notebook and ML ecosystem — relevant given how much of this product's
risk sits in extraction quality. Rejected because it splits the recipe contract across a language
boundary for the server-rendered UI, and the contract's integrity is the higher-value property.

**Go.** Good deployment story, weakest of the three for schema-driven work and structured model output.
