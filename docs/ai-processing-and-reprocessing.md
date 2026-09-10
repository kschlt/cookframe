# Cookframe — AI Processing & Reprocessing Principles

Status: Discovery baseline  
Scope: Logical processing stages, versioning, validation and replaceability. This document does not prescribe a model SDK or orchestration framework.

## 1. Logical stages

Cookframe distinguishes three logical transformations:

```text
source input
   ↓
1. capture
   ↓
Source Snapshot
   ↓
2. normalize
   ↓
Canonical Recipe
   ↓
3. derive
   ↓
Cooking Plan / future enrichments
```

These are semantic boundaries even if an implementation combines some work into one physical model request.

## 2. Capture

Question:

> What recipe-relevant information did the source contain?

Capture should be source-faithful and broad.

For image input it may use multimodal extraction. For URL input it should prefer deterministic structured extraction.

Capture output is a Source Snapshot with stable evidence references.

The Source Snapshot is not pixel-equivalent ground truth; capture errors remain possible.

## 3. Normalization

Question:

> What structured recipe facts does this Source Snapshot describe?

Normalization may:

- parse value expressions;
- separate ingredient quantity/unit/name/qualifiers;
- structure multiple yields;
- structure source-provided nutrition and its basis;
- identify explicit equipment;
- structure step-local allocations, reservations, durations, temperatures, waits, doneness cues and prerequisites;
- preserve source-provided classifications.

Normalization must not:

- fabricate missing facts;
- infer unsupported authorship;
- change culinary quantities/temperatures/outcomes;
- optimize the action sequence;
- infer health/recommendation scores or user preferences into Canonical.

## 4. Derived Cooking Plan

Question:

> How can the same canonical recipe be presented for low-stress execution?

The Cooking Plan may reorganize visibility and grouping, but not culinary truth.

V1 constraints:

- preserve canonical action order;
- prerequisite promotion is look-ahead/duplicate presentation, not action reordering;
- source-explicit concurrency is safe to expose;
- inferred concurrency should be highly conservative;
- generalized scheduling optimization is out of scope.

## 5. Prompt/component versioning

Capture, normalization and cooking transformation are independently versionable product artifacts.

Conceptually:

```text
capture prompt component vN
normalization prompt component vM
cooking prompt component vK
```

An implementation may compose capture + normalization into one call for latency/cost while still recording the separate component versions and returning separate semantic outputs.

## 6. Provider replaceability

The product should call logical capabilities such as:

```text
captureRecipe(...)
normalizeRecipe(...)
createCookingPlan(...)
```

rather than spreading one provider's SDK semantics throughout the application.

This is a product boundary, not a requirement to build a large provider framework.

The exact model provider, library and adapter shape remain implementation decisions.

## 7. Structured output and validation

Model output should be validated against the relevant versioned product schema/contract.

Validation should distinguish:

- structural validity;
- semantic/domain invariants;
- source-grounding checks where feasible.

Schema-valid output is not proof of semantic correctness.

The normal path should avoid unnecessary model chains.

A targeted repair call may be used when a response violates deterministic output constraints. A generic multi-model judge chain is not a V1 requirement.

## 8. No mandatory end-user review workflow

V1 should not compensate for weak extraction by forcing the user to approve every import.

Instead:

- build representative fixtures;
- evaluate critical-field accuracy;
- improve prompts/models/pipeline;
- gate irreversible behavior such as scan deletion on capture quality.

The product may later add editing as a feature, but it is not a V1 dependency.

## 9. Reprocessing

Persisted processing layers allow selective reprocessing:

```text
Source Snapshot
→ normalization vNext
→ Canonical Recipe vNext

Canonical Recipe
→ Cooking Plan vNext
→ Derived Cooking Plan vNext
```

Reprocessing should preserve run provenance and allow comparison.

A deleted scan image cannot be re-captured; improved capture quality applies only to retained/new source assets.

## 10. Cooking Plan generation timing remains open

The Cooking Plan may eventually be:

- eager;
- background;
- lazy on first cooking view.

The product requirement is only:

> import/save/shopping must not wait for an expensive high-quality Cooking Plan when that plan is not needed for the immediate job.

The policy should be chosen from observed latency, cost and usage rather than guessed during discovery.

## 11. Future derived enrichment

Later capabilities may derive:

- semantic aliases;
- inferred dietary properties;
- embeddings;
- recommendation features;
- meal plans;
- multi-recipe shopping plans;
- agent planning artifacts.

They require separate provenance/versioning and must not be confused with source-provided Canonical facts.
