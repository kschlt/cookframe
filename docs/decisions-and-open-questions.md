# Cookframe — Decisions & Intentionally Open Questions

Status: Frozen discovery snapshot — later revisions live in [`product-decisions/`](product-decisions/) and [`adr/`](adr/), not here  
Purpose: Distinguish product decisions from implementation-time discovery so missing detail is not mistaken for an omission.

This document is not edited to reflect later changes. Its §1 decisions are adopted wholesale as Cookframe's founding product decisions by [PDR-0001](product-decisions/PDR-0001-adopt-discovery-baseline-as-founding-product-decisions.md); a revision is made by a new record that supersedes the specific item. Its §2 questions carry stable `OQ-NN` ids so records can name which question they close.

## 1. Decisions fixed during discovery

### Product identity

- Product name: **Cookframe**
- Public repository target name: `cookframe`
- License: **MIT**
- Product posture: open-source, self-hosted, single-user-first

### Repository/publication boundary

- Discovery begins in a private workbench.
- The private workbench is never converted into the public repository.
- The public `cookframe` repository starts with a new Git history.
- The first public commit is a curated, public-safe baseline.
- Product development moves into the public repository immediately after that baseline.
- Private runtime state, secrets and non-public eval data remain separate.

### Product core

- Canonical Recipe is the durable center.
- Source Snapshot, Canonical Recipe and Derived Cooking Plan are distinct semantic layers.
- Source Snapshot is a durable capture record, not pixel-equivalent ground truth.
- Schema.org is an adapter, not the ontology.
- Bring is an adapter, not the ontology.
- image and URL ingestion are source adapters converging into the same core.
- HTML is rendered from recipe data rather than stored as the source of truth.

### Information model

- Preserve broadly; canonicalize deliberately; derive separately.
- Common source-grounded facts may be Canonical even when V1 does not use them.
- Multiple contextual yields are representable.
- Source-provided nutrition is preserved with its reference basis.
- Source-provided cuisine/category/meal type/diet/difficulty/keywords may be Canonical.
- Explicit source equipment may be Canonical.
- Source-provided classifications and later inferred classifications are distinct.
- Exact/range/qualitative quantities and times are preserved.
- Split/reserved ingredient semantics are explicit.
- Scaling eligibility is conservative derived policy metadata.
- unknown scaling behavior blocks automatic whole-recipe scaling.

### Cooking UX

- Discovery, Shopping, Preparation and Active Cooking are information jobs, not mandatory separate UI modes.
- Cooking presentation must reduce searching and mental reconstruction.
- Contextual ingredient quantities are important.
- `assumedAtHand` may suppress retrieval clutter but not required measurement/preparation/reservation/current-step information.
- V1 does not reorder Canonical actions.
- prerequisite promotion is look-ahead presentation, not action rewriting.
- generalized scheduling/parallel optimization is out of scope.
- exact mobile layout remains an eval hypothesis.

### AI / processing

- Capture and normalization are separately versionable logical steps.
- They may initially run in one physical model call.
- Cooking Plan is separately replaceable/regenable derived data.
- Prompts/components and processing runs are versioned.
- provider-specific code should remain behind narrow capability boundaries.
- no mandatory per-import end-user approval workflow.
- scan deletion is gated on capture-quality evaluation.

### Security / privacy

- URL/HTML/file/image inputs are hostile.
- URL fetching must respect SSRF/network boundaries.
- external content is data, not trusted model instruction.
- extraction models should have no unnecessary privileged tools/secrets.
- private library is not made public for Bring.
- Bring-facing recipe access is a narrow capability boundary and may be re-shared downstream.

## 2. Explicitly deferred to implementation discovery

Do not decide these only to make the spec look complete:

- **OQ-01** exact framework/router;
- **OQ-02** TypeScript vs. another implementation language if real constraints justify a change;
- **OQ-03** database technology;
- **OQ-04** JSON vs. relational physical persistence;
- **OQ-05** hosting platform/reference deployment;
- **OQ-06** object/blob storage implementation;
- **OQ-07** model provider;
- **OQ-08** model SDK/library;
- **OQ-09** exact provider adapter interfaces;
- **OQ-10** background-job mechanism;
- **OQ-11** exact shortcut packaging/distribution mechanism;
- **OQ-12** exact mobile component/layout system;
- **OQ-13** eager vs. background vs. lazy Cooking Plan generation;
- **OQ-14** exact capture-eval thresholds;
- **OQ-15** exact scaling-classification algorithm;
- **OQ-16** exact safe URL-fetch implementation;
- **OQ-17** exact capability-token format/lifetime/revocation mechanism;
- **OQ-18** exact Bring integration mechanism after spike;
- **OQ-19** exact hero-image compression/storage variants;
- **OQ-20** exact unit conversion behavior;
- **OQ-21** semantic ingredient alias vocabulary;
- **OQ-22** Focus Mode;
- **OQ-23** sophisticated intermediate-food-state graph.

## 3. Open product tasks before broader public release

These do not block the first implementation commit but must be resolved before treating the project as mature/publicly consumable:

- final self-hosting instructions;
- configuration/secrets documentation;
- data export/backup contract;
- public fixture licensing/provenance;
- contributor guidance;
- dependency/third-party attribution;
- security reporting process;
- product/repository description polish;
- name/domain/package collision check if broader distribution requires it.

## 4. Implementation-time spikes already required

The first implementation plan should explicitly schedule:

1. image-capture quality baseline;
2. URL/structured-source extraction spike;
3. Bring compatibility spike;
4. minimal cooking UX hypothesis evaluation;
5. runtime URL-ingestion security validation.

## 5. Decision rule for future changes

Before adding a new abstraction or Canonical field, ask:

1. Is this a real recurring recipe phenomenon or a hypothetical future feature?
2. Is it source-grounded, derived or instance-specific?
3. Would losing it now force future re-capture?
4. Can it remain in Source Snapshot until semantics are better understood?
5. Does V1 actually need behavior around it, or only preservation?
6. Is the proposed abstraction solving a current replacement boundary or future-proofing speculation?

Prefer the smallest model that preserves real information and keeps future reprocessing possible.
