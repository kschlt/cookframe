# `prompts/` — versioned model prompts

The capture/normalization pipeline is driven by model prompts, and each prompt is a
**versioned, swappable artifact** so we can change one without touching code, A/B two versions,
and let the eval harness measure which version hits the contract better.

## Layout

```
prompts/
  capture/         raw source (image or text) → Source Snapshot (Layer A)
    v1.md
  normalization/   Source Snapshot → Canonical Recipe (Layer B)
    v1.md
  combined/        raw source → { Source Snapshot, Canonical Recipe } in ONE call
    v1.md
```

- `capture/` and `normalization/` are the **two-call** shape.
- `combined/` is the **one-call** shape.
- CFV1-S6 measures both shapes for structured-output fidelity (block-id stability and `sourceRef`
  resolution) to close OQ-24. The prompts here are the measurement subjects.

## Conventions

- **One concern per file, one version per file.** `v1.md`, `v2.md`, … Never edit a released
  version in place to change behavior — add `v2.md`, so a measured rate always names the exact
  prompt it was measured against.
- **The prompt targets the contract, not a copy of it.** The one source of truth for the output
  shape is `schema/` (recipe-ontology §5). A prompt describes the rules and points at the schema;
  it never restates the field list, which would be a second copy that drifts.
- **Provider-agnostic wording.** A prompt must not depend on one provider's quirks. The active
  provider is configuration (`MODEL_PROVIDER`), not part of the prompt.
- **Each file names the version it is and the stage it serves** in a short header, so a prompt
  pulled out of context is still identifiable.

## Prototyping vs. production

First-round prompt optimization runs against the **Claude models available in this workspace**
(cost-free), scored by the eval harness against the fixtures. Only once a prompt is good is it
validated against the production provider (OpenAI) — model behavior does not transfer 1:1, so a
prompt tuned on one model gets a confirming run on the other before we trust it.
