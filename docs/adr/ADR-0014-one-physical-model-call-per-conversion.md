---
id: "ADR-0014"
title: "One physical model call per conversion, on the full model tier"
status: accepted
date: 2026-09-21
tags: ["model-provider", "cost", "pipeline"]
decides: ["OQ-24"]
depends_on: ["ADR-0004"]
related_to: ["ADR-0008"]
---

## Context

`ADR-0004` fixed capture and normalization as two capability seams and deliberately left open
whether one physical model call or two serve them. That is `OQ-24`, and it was left open because
the honest answer needed measurement rather than taste.

Fidelity did not settle it. Across 33 free runs on Claude models both shapes reached 100% schema
validity and 727/727 within-run `sourceRef` resolution, and the OpenAI pass replicated the
resolution result. Both shapes work, so the choice falls to cost and latency on the provider that
will actually run — which is what `CFV1-S6` measured, 54 runs across two tiers with the same
prompts, fixtures and scorer.

**Cost is per successful conversion, not per attempt.** A call is paid for whether or not its
output conforms, and a two-call conversion counts only if both stages conform. Pricing per attempt
inverts the ranking, which is why the distinction is stated here rather than assumed.

| | tokens/attempt | conformed | tokens/success |
|---|---|---|---|
| gpt-5.4, two-call | 11,470 | 9/9 | 11,470 |
| **gpt-5.4, one-call** | 6,478 | 9/9 | **6,478** |
| mini, two-call | 11,606 | 7/9 | 14,922 |
| mini, one-call | 6,331 | 8/9 | 7,122 |

Two findings fall out, and they are separate:

- **Within a tier, one call costs roughly 45% fewer tokens.** This is structural, not a sampling
  artefact: two-call sends the schema bundle twice and sends the snapshot back in as normalization
  input. Latency is not decisive either way (per success: 16.2s two-call against 18.1s one-call on
  the full tier; 15.5s against 10.9s on mini).
- **Across tiers, the cheap model is not cheap.** mini one-call is the cheapest cell per attempt at
  6,331 tokens, below the full tier's 6,478 — and costs *more* per usable recipe, 7,122, because
  roughly one conversion in nine breaks the contract and is paid for twice. gpt-5.4 was 27/27
  schema-valid, mini 24/27.

## Decision

**One physical model call per conversion, on the full model tier.**

Which model that is remains configuration, per `ADR-0004`; this record fixes the physical call
shape and the tier class, not a vendor or a model id.

## Consequences

- The capability seam is untouched. Capture and normalization stay separately addressable in code
  even though one call serves both, so a provider whose economics differ can be re-measured without
  a schema change or an interface change.
- **Retry on contract failure becomes load-bearing rather than optional.** With one call per
  conversion, a non-conforming reply costs a whole conversion, and the first real-photograph run had
  one page in eleven rejected by `.strict()` (`spikes/s1-photo-gate/VERDICT.md`). Failing closed is
  correct and is not sufficient: the production path owes a retry.
- The cheap tier has no remaining argument here. It is worse on conformance and more expensive per
  usable recipe, so "use the small model to save money" is closed as a question, not left to taste.
- The record is re-checkable without a key. The OpenAI pass ships its usage sidecars beside each
  run in `spikes/s6-fidelity/runs/`, and `score.ts` recomputes these figures from them, so the
  evidence can be re-derived — and this record contradicted — with no spend and no credential.
- A side finding that belongs with the evidence rather than in its own record: with a second
  provider measured, model-emitted block-id stability follows no pattern by fixture, shape or model.
  Model-supplied ids are noise, which is the measured justification for the content-derived
  `BlockIdPolicy` seam rather than an assumed one.

## Alternatives considered

**Two calls, one per stage.** Rejected on cost with no fidelity advantage to buy it back: the same
schema validity and the same `sourceRef` resolution for roughly 45% more tokens. The argument for it
was that separate calls keep the stages independent — but the seam already does that at the
interface, so the physical split bought separation that was not otherwise at risk.

**The cheap tier.** Rejected by its own numbers once retries are paid for, as above. Keeping it as a
configurable option was considered and not recorded as a decision: nothing in the measurement
supports it, and an option nobody should choose is a trap rather than flexibility.
