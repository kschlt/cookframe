# CFV1-S6 — findings (OQ-24)

Measured 2026-09-20 on the Claude prototyping models (Sonnet at n=3 per cell; Haiku at n=1 as a
model-sensitivity smoke test). 33 independent runs.

**Reproducing this table.** `npx tsx spikes/s6-fidelity/score.ts` scores every run committed under
`runs/`, which since 2026-09-21 also holds the 54 OpenAI runs of the confirming run below — so it
now prints **87 runs in 33 cells**, not the 33 of this section. The cells below are the ones whose
model label is `sonnet` or `haiku`; the scorer prints one `## shape · fixture · model` heading per
cell, so read those off directly rather than expecting the totals to match.

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
Models: **gpt-5.4** (full tier) and **gpt-5.4-mini** (cheap tier).

**Reproducing this section.** `npx tsx spikes/s6-fidelity/score.ts` prints all 87 runs in 33 cells;
the `openai-gpt54` and `openai-gpt54mini` cells are this run's, and the per-model totals below are
those cells summed. The cost figures are the scorer's own
`# Cost and latency per successful conversion` section, which it computes from the `.meta.json`
usage sidecars committed beside each OpenAI run. No key and no network are needed to re-score:
every run and its usage record is in the repository. Re-*producing* new runs is what needs
`OPENAI_API_KEY`, via `npx tsx spikes/s6-fidelity/openai-run.ts --runs 3`.

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

The criterion is cost **per conversion**, and a conversion that fails `.parse` is not one. You pay
for a call whether or not its output conforms, so a mean over attempts flatters the tier that fails
more often. Both figures are below; the right-hand one is what a caller pays to obtain one usable
recipe, because a failed conversion has to be retried. A two-call conversion counts as successful
only if **both** stages conform.

| model | | latency/attempt | input tok | output tok | tok/attempt | conformed | **tok/success** | **latency/success** |
|---|---|---|---|---|---|---|---|---|
| gpt-5.4 | two-call | 16.2 s | 9 134 | 2 336 | 11 470 | 9/9 | 11 470 | 16.2 s |
| gpt-5.4 | **one-call** | 18.1 s | 4 253 | 2 225 | 6 478 | 9/9 | **6 478** | 18.1 s |
| gpt-5.4-mini | two-call | 12.1 s | 9 134 | 2 472 | 11 606 | 7/9 | 14 922 | 15.5 s |
| gpt-5.4-mini | one-call | 9.7 s | 4 253 | 2 077 | 6 331 | 8/9 | 7 122 | 10.9 s |

Two readings, and they point in different directions:

1. **Within a tier, one-call costs ~45% fewer tokens per conversion.** The saving is structural, not
   incidental: two-call sends the schema bundle twice and additionally sends the whole snapshot back
   in as normalization input, so its input is 2.1x the one-call input. Output volume is
   near-identical (~2.1-2.5k either way), which is the tell that the *work* is the same and only the
   framing differs. This holds on both tiers and on both measures.

2. **Across tiers, the cheap tier's advantage disappears once failures are paid for.** Per attempt,
   mini one-call is the cheapest cell in the table at 6 331 tokens, nominally below gpt-5.4's 6 478.
   Per successful conversion it is **7 122 — above the full tier**, because one call in nine has to
   be paid for twice. The ranking inverts. Mini's two-call shape is worse still: 7/9 conformed, so
   14 922 tokens per usable recipe against gpt-5.4's 11 470.

Latency behaves the same way. Per attempt mini looks 20% faster in one-call; per success the gap
narrows to 10.9 s against 18.1 s, and mini's two-call shape loses its lead entirely (15.5 s against
gpt-5.4's 16.2 s). Neither difference is decisive for the one-vs-two choice.

Roughly 71-80% of input tokens came back `cached` (automatic prompt caching on the stable schema
prefix), so the real billed input is well below the raw figure — which further favours the shape
with fewer, larger calls, and does not change the per-success ranking, since a failed call's input
is cached too.

These figures come from the `# Cost and latency per successful conversion` section printed by
`npx tsx spikes/s6-fidelity/score.ts`, which reads the `.meta.json` usage sidecar committed beside
each run.

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

Separately and independently of the one-vs-two choice: **the full tier is required, and it is also
the cheaper one per usable recipe.** gpt-5.4-mini's 89% validity would mean roughly one in nine
conversions failing `.parse` in production. That is not only a correctness problem: priced per
successful conversion, mini one-call costs **7 122 tokens against the full tier's 6 478**, so the
cheap tier is not actually cheap once its retries are paid for. The apparent saving in the
per-attempt column is the failed calls going unbilled in the arithmetic but not in reality. There
is therefore no remaining argument for the mini tier here.

**Still Kornelius's to confirm**, and the ADR recording the decision is his call. What the spike
owed — evidence on both axes — is now delivered.

---

# Does the retry work? (2026-09-21)

ADR-0014 counts **retry-on-contract-failure** as load-bearing: the cheap tier is only viable behind
one, and the real-photograph run (CFV1-S1) lost one page in eleven on the *full* tier to a
`.strict()` violation. But "a retry fixes it" was an assumption. The proofs in
`tests/slice1/model-providers.test.ts` script their replies, so they prove the mechanism — a
rejected reply is re-sent with the validator's own message, a conforming second reply is used, the
stage still fails closed once attempts are spent — and cannot prove that a real model, shown a real
`.strict()` message, actually produces a conforming reply.

`retry-probe.ts` measures that, on the cheapest input that reliably produces the failure: the
`sparse` fixture, normalization only, on gpt-5.4-mini — the tier S6 already measured at 24/27, every
failure a contract violation. Text in, text out, so the whole probe costs a few cents rather than
the ~75 cents a photograph re-run would.

**12 conversions, one retry allowed each:**

| | |
|---|---|
| conformed on the first attempt | 9 |
| **repaired by the retry** | **2** |
| still failed after the retry | 1 |
| delivered without the retry | 9/12 (75%) |
| **delivered with the retry** | **11/12 (92%)** |

Cost: 15 calls, 74 898 input + 14 529 output tokens.

Three things follow.

1. **The premise holds.** A real model shown the validator's own message does repair the violation —
   two of three failures, including the `Unrecognized key(s) in object: 'sourceSite'` class that S6
   recorded on this exact cell and that is the same shape as the key the real photograph run lost a
   page to. The retry is not a hopeful gesture.

2. **One retry is not a cure.** One conversion in twelve failed again after being shown what was
   wrong — a different violation the second time (a string where the contract wants an object). A
   caller that needs every page must still handle a failure; the retry moves the rate, it does not
   remove the case. This is why the stage still fails closed rather than returning something partial.

3. **It does not rescue the cheap tier.** 92% delivered is better than 75% and still not shippable,
   and the retried calls are billed, so the per-successful-conversion cost that already put mini
   above the full tier only rises. ADR-0014's choice of the full tier stands; the retry is what makes
   the *full* tier's occasional failure survivable, not what makes the cheap tier viable.

Reproduce (needs `OPENAI_API_KEY`, costs a few cents):
`OPENAI_MODEL=gpt-5.4-mini npx tsx spikes/s6-fidelity/retry-probe.ts --runs 12`. Rates will differ
run to run — this is a 12-sample probe of an ~11% failure rate, not a measurement with a confidence
interval on it.
