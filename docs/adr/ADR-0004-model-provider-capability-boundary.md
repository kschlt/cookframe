---
id: "ADR-0004"
title: "Model access behind three named capabilities; the provider is configuration"
status: accepted
date: 2026-09-10
tags: ["ai", "boundary", "configuration", "prompts"]
decides: ["OQ-09"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0002"]
---

## Context

The baseline defers the model provider (OQ-07), the SDK (OQ-08) and the provider adapter interfaces
(OQ-09), while requiring that the product call logical capabilities rather than spread one provider's
SDK semantics through the application — and that this remain "a product boundary, not a requirement
to build a large provider framework".

It also requires that capture, normalization and cooking-plan generation stay independently
versionable even where an implementation combines them into one physical call, and that provider
credentials never reach the browser or the iOS Shortcut.

Two things were bundled here, with very different lifespans. The **boundary** is architecture: it
decides whether the provider choice stays reversible. The **provider and model** are not — they are
values read at startup, and S1 and S6 will say which model actually performs on capture. Recording
them as an architectural decision would give them a permanence they do not have, and would imply an
ADR revision every time a model is swapped.

## Decision

Expose exactly three capabilities to the application:

```
captureRecipe(...)
normalizeRecipe(...)
createCookingPlan(...)
```

No provider type, SDK type or model identifier appears outside their implementations. Each capability
records its own prompt-component version and run identity regardless of how many physical model calls
back it.

**The provider and model are configuration, not architecture.** The initial implementation targets the
Anthropic SDK with the model id supplied by configuration. Changing either is a configuration change
and does not revise this record. OQ-07 and OQ-08 therefore stay open in the sense that matters: they
are settled by evidence from S1 and S6, and by cost and latency measurement, not by this decision.

Whether capture and normalization share one physical call is **not** decided here — that is OQ-24,
answered by S6.

## Consequences

### Positive

- Changing provider or model touches three implementations and no callers.
- Prompt-component versioning and run provenance survive whatever S6 concludes about call merging.
- The narrow surface directly serves the extraction-privilege invariant: these capabilities receive
  recipe content and nothing else — no tools, no arbitrary network access, no unrelated secrets.
- Model selection can follow eval results without ceremony.

### Negative

- Three functions cannot express every provider-specific feature. Anything genuinely needed must
  widen the boundary deliberately, as its own decision, rather than leak.
- With one provider in use, the boundary's portability is asserted rather than demonstrated.
- "Provider is configuration" only holds if no provider-specific behaviour creeps into callers; that
  is a discipline until there is a lint rule for it.

### Neutral

- Product prompts — capture, normalize, cooking plan — are public product code and ship with this
  repository. Prompts used to *build* Cookframe are not product artefacts and do not belong here.

## Alternatives considered

**A provider-abstraction framework with pluggable adapters.** Rejected by the baseline as premature.
Three functions is the boundary; a second provider in real use is what would justify more.

**Calling the SDK directly at each use site.** Simplest today, and precisely what the baseline
forbids: it makes the provider choice irreversible by diffusion.

**Recording the provider choice as an accepted architectural decision.** The original form of this
record. Rejected because it misclassifies a configuration value as architecture, and would imply
this record needs superseding whenever a model changes.
