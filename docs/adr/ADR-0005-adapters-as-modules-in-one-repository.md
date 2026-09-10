---
id: "ADR-0005"
title: "Adapters are modules in one repository, not separate repositories"
status: accepted
date: 2026-09-10
tags: ["repository", "adapters", "boundaries", "packaging"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001"]
---

## Context

Cookframe's architecture is organised around adapters: image and URL source adapters converging on
one core, and Schema.org and Bring adapters as outputs. That naturally raises whether adapters
should be separate repositories or packages.

The baseline already lists "application and adapter code" among the public repository's contents, so
single-repository was the implicit default — but it was never argued, and it is worth deciding
explicitly before the layout sets.

## Decision

Keep all adapters as modules within the single public `cookframe` repository, with boundaries
enforced by module structure and tests rather than by repository separation.

Revisit only on a concrete trigger:

1. a third party wants to write an adapter — which needs the *contract* published as a package, and
   a package can be published from this repository without splitting it;
2. an adapter becomes a separately deployable artefact;
3. an adapter acquires a genuinely different release cadence or license.

## Consequences

### Positive

- One repository is one `docker compose up`, which keeps ADR-0001's self-hosting promise intact.
- Canonical Recipe, its Schema.org mapping and its fixtures change in one atomic commit — a large
  benefit while the ontology is still moving.
- No cross-repository lockstep releases against an unstable contract.

### Negative

- Module boundaries are easier to violate than repository boundaries, so boundary tests carry real
  weight rather than being decoration.
- A future split costs more than starting split would have.

## Alternatives considered

**Separate repository per adapter.** Would demonstrate modularity structurally. Rejected as the
"abstraction theatre" the baseline explicitly warns against: it degrades self-hosting, forces
lockstep releases against a young contract, and buys separation the project has no consumer for.

**Monorepo tooling now (workspaces, package graph).** Deferred until a second deployable exists.
