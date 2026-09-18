---
id: "PDR-0004"
title: "Cooking Plan generation is configurable, and lazy by default"
status: accepted
date: 2026-09-17
tags: ["cooking-plan", "latency", "cost", "configuration", "product"]
decides: ["OQ-13"]
related_to: ["PDR-0001", "PDR-0002"]
---

## Context

The Cooking Plan is derived, replaceable data: the recipe is fully usable without one, and a plan
can be regenerated at any time from the Canonical Recipe. When it is generated is therefore a
product choice about what the user waits for and what the operator pays for, not a correctness
question.

Two rules already bound it, and one of them has already eliminated an option. Save, import and the
Bring hand-off must not wait for a high-quality Cooking Plan, and the recipe must stay viewable when
no plan exists — so **generating the plan inside the import request, blocking it, is already
forbidden**. What remained under `OQ-13` was a choice between generating eagerly but without
blocking, generating in the background after normalization, and generating lazily on first cooking
view.

The baseline also said how to choose: the policy "should be chosen from observed latency, cost and
usage rather than guessed during discovery". That measurement does not exist yet, and will not until
the slice that implements plan derivation has run against real recipes. Meanwhile the self-hosting
principles already list "Cooking Plan generation policy" among the concepts an operator configures —
which reframes the question. The decision is not which policy holds forever. It is which seam ships
and which default sits behind it.

The cost falls on the operator, who pays a model provider per generated plan. A policy that
generates a plan for every imported recipe charges them for every recipe nobody ever cooks.

## Decision

**Cooking Plan generation is a configured policy, and the shipped default is `lazy`** — the plan is
derived on first cooking view and then stored.

The policy is a documented configuration value, so an operator who prefers plans to be ready before
they open a recipe can change it without a code change and without revising this record. The
supported values are `lazy` and `background`; blocking generation inside the import request is not
one of them, because the never-block rule forbids it.

The default is chosen on the cost argument, not on a latency measurement that does not exist yet.
When the measurement arrives, changing the **default** is a configuration change to the shipped
value and does not supersede this record; changing the **seam** — adding a policy, or removing the
configurability — would.

## Consequences

### Positive

- The operator pays only for plans that are actually used. For a library where most saved recipes
  are never cooked, that is the difference between a cost proportional to imports and one
  proportional to cooking.
- V1 may need no background-job mechanism at all. Lazy generation happens inside a request the user
  is already waiting on, which keeps `ADR-0005`'s one-`docker compose up` promise intact without a
  queue, a broker or a second service.
- The seam exists from the start, so the later measurement changes a value rather than a design.
- Import stays fast, which is the journey the product is built around.

### Negative

- The first cooking view pays the full generation latency, and that is the worst possible moment —
  the user is standing in a kitchen. The interface has to make that wait legible rather than look
  broken, and `background` exists as the escape hatch for anyone who would rather pay up front.
- A lazily generated plan is generated on demand, which means a provider outage is felt at cooking
  time rather than at import time.
- Shipping a configurable policy means both values have to work and stay tested, which is more than
  shipping one.

### Neutral

- This decides when a plan is generated, not what it contains. Its content, its traceability to
  canonical facts, and its presentation are bound by `PDR-0001`'s invariants and by the cooking-UX
  spike's findings, and are untouched here.

## Alternatives considered

**Configurable, defaulting to `background`.** Generate immediately after normalization, off the
request path. The plan is usually ready before anyone opens the recipe, which is the better cooking
experience. Rejected as the default because it charges the operator for every import regardless of
whether the recipe is ever cooked, and because it forces a background-job mechanism into V1 — a
second moving part, and pressure against the single-composition promise. It remains available as a
configured value for operators who prefer it.

**A fixed `lazy` policy with no configuration seam.** Simplest to build and to test. Rejected
because the self-hosting principles already list this policy among configurable concepts, so
shipping it fixed would contradict a published commitment, and because the evidence that should
inform the default does not exist yet — a seam is how a decision made early stays cheap to revise.

**Deciding nothing until the measurement exists.** Rejected: the slice that produces the measurement
has to generate plans somehow, so refusing to decide just means the choice gets made by whoever
writes that code, silently and without a record.
