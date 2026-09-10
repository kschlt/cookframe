---
id: "ADR-0004"
title: "Model access behind three named capabilities, provider configurable"
status: proposed
date: 2026-09-10
tags: ["ai", "provider", "boundary", "prompts"]
decides: ["OQ-07", "OQ-08", "OQ-09"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0002"]
---

## Context

The baseline defers the model provider, the SDK and the exact provider adapter interfaces, while
requiring that the product call logical capabilities rather than spreading one provider's SDK
semantics through the application — and that this stay "a product boundary, not a requirement to
build a large provider framework".

It also requires that capture, normalization and cooking-plan generation remain independently
versionable even if an implementation combines some into one physical model call, and that provider
credentials never reach the browser or the iOS Shortcut.

The provider choice is cheap to reverse. The boundary is not.

## Decision

Expose exactly three capabilities to the application:

```
captureRecipe(...)
normalizeRecipe(...)
createCookingPlan(...)
```

Implement them initially against the Anthropic SDK, with the model ID supplied by configuration.
Each capability records its own prompt-component version and run identity regardless of how many
physical model calls back it. No provider type appears outside the capability implementations.

Whether capture and normalization share one physical call is deliberately not decided here — it is
question OQ-24, answered by spike S6.

## Consequences

### Positive

- Changing provider or model touches three implementations and no callers.
- Prompt-component versioning and run provenance survive any call-merging decision.
- The narrow surface directly supports the extraction-privilege requirement: these capabilities get
  recipe content and nothing else — no tools, no network access, no unrelated secrets.

### Negative

- Three functions cannot express every provider-specific feature; anything genuinely needed must
  either widen the boundary deliberately or stay inside an implementation.
- One provider in use means the boundary's portability is asserted, not yet demonstrated.

### Neutral

- Product prompts (capture, normalize, cooking plan) are public product code and ship with the
  repository. This is distinct from any prompts used to *build* Cookframe, which are not product
  artefacts and do not belong here.

## Alternatives considered

**A provider-abstraction framework with pluggable adapters.** Rejected explicitly by the baseline as
premature; three functions is the boundary, and a second provider is what would justify more.

**Calling the SDK directly at each use site.** Simplest today, and precisely what the baseline
forbids — it makes the provider choice irreversible by diffusion.
