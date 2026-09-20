# CFV1-S6 — structured-output fidelity spike (OQ-24)

**Question (OQ-24):** capture and normalization — one physical model call or two?

This spike measures the *structured-output fidelity* of both shapes so the choice rests on evidence
rather than intuition. It is a spike: everything here lives under `spikes/` (excluded from the
build, from Biome, and from the committed eval harness) and depends on nothing in the product.

## What is measured

For each candidate shape we measure three things against the real contract in `schema/`:

1. **Structural validity** — does the output parse against the strict Zod schema (`.strict()`, so an
   unknown key is a failure)?
2. **sourceRef resolution** — does every canonical `sourceRef.blockId` name a block that actually
   exists in the snapshot? (Two-call: against the input snapshot. One-call: against the snapshot the
   same call emitted.)
3. **Block-id stability** — across *independent* runs on the *same* input, is the set of snapshot
   block ids identical? The capture prompt promises ids that "do not wander between runs"; this tests it.

Cost and latency per successful conversion — the other half of OQ-24 — are **not** measurable on the
Claude prototyping models; they are produced by the OpenAI confirming run (see below).

## The three shapes

- **`capture`** — raw source → `SourceSnapshot`. (Two-call, stage 1.) Measures validity + stability.
- **`normalization`** — `SourceSnapshot` → `CanonicalRecipe`. (Two-call, stage 2.) Measures validity
  + resolution, against a fixed reference snapshot in `fixtures/`.
- **`combined`** — raw source → `{ snapshot, canonical }` in one call. (One-call.) Measures validity
  of both halves, self-consistent resolution, and stability.

Decomposing two-call into its two stages is deliberate: end-to-end two-call fidelity is
`capture stability × normalization resolution`, and the two failure modes want measuring apart.

## Method — prototyping on Claude, cost-free

Following `prompts/README.md` ("Prototyping vs. production"), the first-round measurement runs the
versioned prompts against the **Claude models available in this workspace** via subagents acting as
"the model": each subagent gets one versioned prompt + the schema + one input, and emits one JSON
output in a single pass (no tooling, no iteration), into `runs/`. Independent subagents (fresh
context each) are what make the stability measurement fair.

Run-file naming (consumed by the scorer): `<shape>__<fixture>__<model>__runNN.json`.

## Fixtures

Synthetic, committed, safe to share — built to exercise the human-curation variance that a real UGC
platform (chefkoch et al.) produces from one template:

- **`freetext-heavy`** — a prose recipe with almost everything in one narrative block.
- **`sparse`** — missing yield/nutrition/times, qualitative and range quantities ("nach Geschmack",
  "2–3 EL", "eine Prise").
- **`multi-component`** — dough + filling, two ingredient groups, prepared components across steps.

Each has a `.source.txt` (input to capture/combined) and a `.snapshot.json` (reference input to
normalization). Real third-party recipes are **not** committed here (copyright); they belong in the
git-ignored `evals/fixtures/private/`.

## Running it

```bash
# score whatever run files are present
npx tsx spikes/s6-fidelity/score.ts

# OpenAI confirming run (next session, once OPENAI_API_KEY is set):
OPENAI_MODEL="<model-id>" npx tsx spikes/s6-fidelity/openai-run.ts --runs 3
npx tsx spikes/s6-fidelity/score.ts
```

See [`FINDINGS.md`](FINDINGS.md) for the results and the OQ-24 answer.
