# CFV1-S6 — findings (OQ-24)

Measured 2026-09-20 on the Claude prototyping models (Sonnet at n=3 per cell; Haiku at n=1 as a
model-sensitivity smoke test). 33 independent runs. Reproduce with
`npx tsx spikes/s6-fidelity/score.ts` over the committed `runs/`.

## Results

| shape | fixture | model | valid | sourceRefs resolved | block-id stability (n=3) |
|---|---|---|---|---|---|
| capture | freetext-heavy | sonnet | 3/3 | — | **UNSTABLE** (2 signatures) |
| capture | sparse | sonnet | 3/3 | — | **UNSTABLE** (2 signatures) |
| capture | multi-component | sonnet | 3/3 | — | STABLE |
| normalization | freetext-heavy | sonnet | 3/3 | 122/122 (100%) | n/a (fixed input) |
| normalization | sparse | sonnet | 3/3 | 46/46 (100%) | n/a |
| normalization | multi-component | sonnet | 3/3 | 101/101 (100%) | n/a |
| combined | freetext-heavy | sonnet | 3/3 | 139/139 (100%) | **UNSTABLE** (2 signatures) |
| combined | sparse | sonnet | 3/3 | 54/54 (100%) | STABLE |
| combined | multi-component | sonnet | 3/3 | 102/102 (100%) | STABLE |
| normalization | all three | haiku | 3/3 | 77/77 (100%) | not measured (n=1) |
| combined | all three | haiku | 3/3 | 86/86 (100%) | not measured (n=1) |

**Totals:** validity 33/33 (100%). sourceRef resolution **727/727 (100%)** — every ref, both shapes,
both models, every fixture.

## What the numbers say

1. **Resolution — the risk the spike was built to find — did not materialise.** Every canonical
   `sourceRef` resolved, in both the one-call and two-call shapes, on both models. The strict
   schema-as-contract plus the current prompts are enough: within a single pass the model reliably
   references ids that exist. Resolution therefore does **not** discriminate between one call and two.

2. **Structural validity is solid** (33/33). `.strict()` output — including the harder cases:
   multiple preserved yields, `ValueExpression` kinds (exact / range / approximate / qualitative /
   omitted), prepared components with cross-step `componentUses`, nutrition basis retained — came
   back conformant every time.

3. **The real fidelity variable is block-id determinism, and it is input-driven, not
   architecture-driven.** Structured sources (`multi-component`) produce identical block ids across
   independent runs. Unstructured prose (`freetext-heavy`, and `sparse` in capture) does not: the
   model re-segments the same text differently run to run (e.g. one narrative paragraph split into 1
   vs. 4 vs. 5 instruction blocks), so the id set "wanders" — the exact thing the capture prompt
   forbids. This happens in one-call and two-call alike, but note it never broke *within-run*
   resolution (still 100%), because the refs are internal to that run's own snapshot.

## Answer to OQ-24 (fidelity half)

**Fidelity does not force the one-vs-two-call choice.** Both shapes reach 100% validity and 100%
within-run sourceRef resolution. The decision should be made on the two axes fidelity leaves open:

- **Traceability robustness across re-processing.** One-call emits snapshot + canonical together, so
  refs are self-consistent *by construction* and cannot drift between a capture call and a later
  normalization call. Two-call is equally correct **only if** the exact snapshot that was normalized
  is persisted with the canonical, and never independently re-derived — because capture ids are not
  deterministic for unstructured input. Edge favours **one-call** for durability; two-call keeps the
  cleaner stage separation and independently swappable prompts (a stated goal).

- **Cost & latency per conversion** — one request vs. two. **Not measurable on Claude**; deferred to
  the OpenAI confirming run (`openai-run.ts`, ready; needs `OPENAI_API_KEY`).

### Requirement that holds regardless of the choice

Treat a snapshot block id as **local to that snapshot version** — never a stable cross-capture key.
Persist the snapshot with the canonical that cites it. For unstructured sources, make capture ids
**deterministic** (e.g. content-derived or an enforced positional scheme) rather than left to the
model, if block ids are ever to survive a re-capture.

## Status / next

- Fidelity half of OQ-24: **answered** (evidence above).
- Pending before OQ-24 can be fully closed (and an ADR written to record the decision): the OpenAI
  cost/latency confirming pass. `openai-run.ts` reproduces this exact matrix on OpenAI and records
  latency + token usage per call. The architecture decision (and any ADR) is Kornelius's to confirm.
