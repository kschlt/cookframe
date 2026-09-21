# CFV1-S1 — the real-photograph run (OQ-14, Gate A)

**Result: [`VERDICT.md`](VERDICT.md) — FAIL. Deleting the original scan stays disabled.**

The S1 spike built a pre-registered threshold, a self-tested per-field scorer and a verdict format,
then returned **INCONCLUSIVE**: its fixtures were self-authored, so ground truth and capture shared
an author and 100% proved nothing. What it said it needed was *"a fixture set whose ground truth is
independent of the capture"*. This directory is that run.

Nothing here re-implements the product or the scorer. The runner composes `src/` — `ingest`, the
provisional store, the content-derived block-id policy, the real model-backed providers and the
OpenAI transport (`src/pipeline/openai-transport.ts`, whose egress goes through
`src/security/model-egress.ts` per ADR-0013) — and the scoring is done by
`spikes/s1-capture-quality/score.py` against the bars recorded in its `THRESHOLD.md`. This
directory holds only what is specific to *this run*.

## The pieces

| File | Role |
|---|---|
| `run.ts` | Drives the maintainer's photographs through the real pipeline and writes snapshots + canonicals. |
| `project.py` | Adapter only: `CanonicalRecipe` → the flat record the scorer compares. Moves values, decides nothing. |
| `manifest.py` | Derives the fixture manifest and class labels from each truth file's own notes, by an explicit keyword table. |
| `adjudicate.py` | The human ask: the disagreements between the two independent readings, side by side. |
| `VERDICT.md` | **The result.** Bars, measured rates, reasoning and the two product findings — no page content, since none may be committed. |

## Where the data lives

Inputs and every output are under `evals/fixtures/private/s1-gate/`, which `.gitignore` excludes.
The photographs are personal and the recipes are third-party, so **nothing produced by this run may
be committed** (S1 constraint; `evals/README.md`). This directory holds the apparatus only.

## Method

1. **Capture.** `run.ts` puts each photograph through the real capture and normalization
   capabilities. `resolveSourceRefs` runs inside the repository write, so a canonical citing a block
   that does not exist fails the ingest rather than being persisted.
2. **Independent truth.** Each photograph is transcribed separately, verbatim, with an explicit
   instruction to omit rather than guess and to flag anything unreadable — and with no access to any
   capture output. That independence is the whole point; it is what the synthetic set could not have.
3. **Score.** `project.py`, then `score.py --fixtures … --runs …` against the pre-registered bars.
4. **Adjudicate.** `adjudicate.py` lists only the disagreements. Where the two readings differ,
   exactly one is wrong and a human decides which.

## The honest limit

Both readers are models. A failure mode they **share** — both misreading the same bleached line the
same way — appears here as agreement and is invisible to this design. Agreement between independent
readers is real evidence and far stronger than the self-authored set, but it is not proof, so the
verdict records this and asks for a spot-check of agreed fields alongside the adjudicated
disagreements ([`VERDICT.md`](VERDICT.md), *The honest limit*).

## Deviation from the pre-registered normalization

`THRESHOLD.md` fixes an English unit-synonym table. The real sources are German, so every German
unit would have scored as a miss for a reason that is not capture accuracy. German units were added
to the table **before any real score was computed**, and no bar, comparison rule or verdict rule was
touched; `score.py --selftest` still passes and the synthetic `scores-sonnet.json` is unchanged.
The deviation is recorded here and in [`VERDICT.md`](VERDICT.md) rather than being made silently.
