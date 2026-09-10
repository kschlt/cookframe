# Cookframe — Decision Status

Status: Living index — regenerate by reading the records, not by trusting this table  
Scope: What is decided, what is still open, and what will close it.

This document states no decisions of its own. Decisions live in [`adr/`](adr/) and
[`product-decisions/`](product-decisions/); where this page disagrees with a record, the record wins.

## Invariants

Every decision is checked against the twelve invariants in
[PDR-0001](product-decisions/PDR-0001-adopt-discovery-baseline-as-founding-product-decisions.md).
They are not restated here.

## Decisions taken

| Record | Decision | Status |
|---|---|---|
| [PDR-0001](product-decisions/PDR-0001-adopt-discovery-baseline-as-founding-product-decisions.md) | Adopt the discovery baseline as the founding product decisions | accepted |
| [ADR-0001](adr/ADR-0001-runtime-and-api-posture.md) | Node 22 runtime, code written against Web-standard APIs | accepted |
| [ADR-0002](adr/ADR-0002-implementation-language.md) | TypeScript as the implementation language | accepted |
| [ADR-0003](adr/ADR-0003-recipe-persistence.md) | Recipe layers persist as JSON documents behind a narrow repository interface | accepted |
| [ADR-0004](adr/ADR-0004-model-provider-capability-boundary.md) | Model access behind three named capabilities; the provider is configuration | accepted |
| [ADR-0005](adr/ADR-0005-adapters-as-modules-in-one-repository.md) | Adapters are modules in one repository | accepted |
| [ADR-0006](adr/ADR-0006-decision-records-adopt-adr-kit-conventions.md) | Decision records conform to adr-kit, no bespoke tooling | accepted |

Each of these decides only what is currently forced. Three deliberately leave their expensive half
open — see below.

## Open questions

`OQ-01`–`OQ-23` are the deferred questions in
[`decisions-and-open-questions.md`](decisions-and-open-questions.md) §2, in that order. `OQ-24`
onwards are questions found during implementation discovery.

| Question | What will close it |
|---|---|
| **OQ-05** hosting platform / reference deployment | A later ADR, once the Bring compatibility spike establishes whether a publicly fetchable HTTPS URL is genuinely required. ADR-0001 deliberately does not decide this. |
| **OQ-03** database technology · **OQ-04** JSON vs relational | A later ADR, once the first Canonical Recipe exists and the three deciding queries — library list, shopping aggregation, run comparison — can be written against real data. ADR-0003 commits to the repository boundary, not the store. |
| **OQ-07** model provider · **OQ-08** model SDK | Capture-quality and cost/latency evidence. Under ADR-0004 these are configuration values, so they change without revising a record. |
| **OQ-14** capture-eval thresholds | The image-capture quality eval. Until it passes, scan deletion stays disabled. |
| **OQ-16** safe URL-fetch implementation | Design during the URL-extraction spike, validated by the URL-ingestion security suite. |
| **OQ-17** capability-token format, lifetime, revocation · **OQ-18** Bring integration mechanism | The Bring compatibility spike. Token decisions must assume the access path leaves the originating device. |
| **OQ-24** capture and normalization: one physical model call or two | The structured-output fidelity spike. ADR-0004 records provenance per capability either way. |
| **OQ-01** framework/router · **OQ-06** object storage · **OQ-10** background jobs · **OQ-11** shortcut packaging · **OQ-12** mobile component system · **OQ-13** Cooking Plan generation timing · **OQ-19** hero-image variants | Decided against a real constraint when one appears, not pre-emptively. |
| **OQ-15** scaling classification · **OQ-20** unit conversion · **OQ-21** ingredient alias vocabulary · **OQ-22** Focus Mode · **OQ-23** intermediate food-state graph | Out of V1 scope. |

Two of those deserve their reasoning stated:

- **OQ-12** stays open until the cooking-UX evaluation has run. Choosing a component system first
  would pre-bias the very layout the evaluation exists to test.
- **OQ-15** needs no answer to ship. `scalingEligibility` defaults to `unknown`, and any affected
  `unknown` disables automatic whole-recipe scaling — so V1 ships with scaling *unavailable*. That is
  the conservative design working as intended, not a gap.

## The rule being applied

> Decide when the decision is forced, or when waiting costs more than being wrong. Not when the topic
> comes up.

Three records above were narrowed by that rule after first being drafted wider: ADR-0001 dropped the
hosting target, ADR-0003 dropped the database, and ADR-0004 reclassified the provider as
configuration. In each case the deferred half is closed by evidence that work already scheduled will
produce.

## Validation gates

The release gates and the spikes that feed them are defined in
[`validation-and-evaluation.md`](validation-and-evaluation.md). Their scheduling is planning state and
is tracked outside this repository.
