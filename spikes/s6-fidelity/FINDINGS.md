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
- Cost/latency half: **answered** by the OpenAI confirming run below (2026-09-21).

---

# OpenAI confirming run (2026-09-21) — closes OQ-24

Measured on `kschlt/cookframe` with `OPENAI_API_KEY` present, via `openai-run.ts --runs 3`:
**54 further runs**, 27 per model, same prompts / fixtures / scorer as above.
Models: **gpt-5.4** (full tier) and **gpt-5.4-mini** (cheap tier). Reproduce with
`npx tsx spikes/s6-fidelity/score.ts` over the committed `runs/` (87 runs, 33 cells total).

## Fidelity on OpenAI

| model | structural validity | sourceRefs resolved |
|---|---|---|
| gpt-5.4 | **27/27 (100%)** | **564/564 (100%)** |
| gpt-5.4-mini | 24/27 (89%) | 455/455 (100%) |

The Claude-side finding **replicates on the production provider**: within-run sourceRef resolution
is 100% in both the one-call and the two-call shape. Resolution still does not discriminate between
one call and two.

The three gpt-5.4-mini failures are all *contract* failures, not reference failures — an invented
key (`sourceSite`), a `null` where the schema wants a string, and two omitted required `sourceRefs`
arrays. `.strict()` caught every one. This is a **model-tier** signal, not an architecture signal:
the cheap tier breaks the schema in ~11% of calls, the full tier in none.

## Cost and latency — the half the Claude pass could not produce

Per conversion, mean over 9 runs per shape (two-call = capture + normalization summed):

| model | | latency | input tok | output tok | total tok |
|---|---|---|---|---|---|
| gpt-5.4 | two-call | 16.2 s | 9 134 | 2 336 | 11 470 |
| gpt-5.4 | **one-call** | 18.1 s | 4 253 | 2 225 | **6 478** |
| gpt-5.4-mini | two-call | 12.1 s | 9 134 | 2 472 | 11 606 |
| gpt-5.4-mini | **one-call** | 9.7 s | 4 253 | 2 077 | **6 330** |

**One-call costs ~45% fewer tokens per conversion**, on both tiers. The saving is structural, not
incidental: two-call sends the schema bundle twice and additionally sends the whole snapshot back
in as normalization input, so its input is 2.1x the one-call input. Output volume is near-identical
(~2.1-2.3k either way), which is the tell that the *work* is the same and only the framing differs.

Latency splits by tier: one-call is 20% faster on mini, 11% slower on gpt-5.4. Neither is decisive.
Roughly 71-80% of input tokens came back `cached` (automatic prompt caching on the stable schema
prefix), so the real billed input is well below the raw figure — which further favours the shape
with fewer, larger calls.

## Block-id stability: the earlier reading was too kind to the models

Across all three models now measured, STABLE/UNSTABLE lands in **no consistent pattern** — not by
fixture, not by shape, not by model:

| capture · fixture | sonnet | gpt-5.4 | gpt-5.4-mini |
|---|---|---|---|
| freetext-heavy | UNSTABLE | STABLE | UNSTABLE |
| sparse | UNSTABLE | UNSTABLE | UNSTABLE |
| multi-component | STABLE | UNSTABLE | UNSTABLE |

The Claude-only pass read this as "structured input is stable, prose is not". With a second provider
in the table that reading does not hold: gpt-5.4 was stable on the *prose* fixture and unstable on
the *structured* one, exactly inverting sonnet. **Model-emitted block-id stability is noise.** It
cannot be relied on, tuned for, or predicted from the input.

That is a stronger form of the requirement the first pass already stated, and it is already
discharged in the product: `src/pipeline/block-id-policy.ts` (PR #14) derives block ids from block
content in code, and `RawBlock = Omit<SnapshotBlock, "id">` makes it structurally impossible for a
model-chosen id to reach a snapshot. The spike now supplies the evidence for why that seam has to
exist rather than being a precaution.

## OQ-24 — answer

**Both shapes are correct; one-call is the cheaper one, and its traceability is safer by
construction.** Evidence: identical validity at a given model tier, 100% within-run sourceRef
resolution in both, ~45% fewer tokens for one-call, no decisive latency difference.

The residual argument for two-call is stage separation and independently swappable prompts. The
residual argument against it is that its correctness depends on persisting the exact snapshot that
was normalized — which the repository spine does do (PR #12/#16), so it is a live option, not a
broken one.

Separately and independently of the one-vs-two choice: **the full tier is required for
contract conformance.** gpt-5.4-mini's 89% validity would mean roughly one in nine conversions
failing `.parse` in production. A mini tier is only viable behind a retry, and a retry erases the
cost advantage that is the only reason to pick it.

**Still Kornelius's to confirm**, and the ADR recording the decision is his call. What the spike
owed — evidence on both axes — is now delivered.
