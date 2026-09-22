---
id: "ADR-0022"
title: "Every merge is decided against its result, by the repository's own gate"
status: accepted
date: 2026-09-22
tags: ["ci", "repository-protections", "quality-gate"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0006"]
---

## Context

Twice in one night, two pull requests that were each green against their own base produced a broken
`main` when both landed. Neither author was wrong, and no CI run could have caught either, because
each ran against a base that did not yet contain the other.

The two failed **differently**, and that difference decides the shape of the answer.

The first was a typecheck failure. `ADR-0018` widened `RecipeRepository` to six operations in `#31`
while `spikes/dbq/stores.ts` implemented five in `#30`. Both merged; `main` stopped compiling at
`spikes/dbq/stores.ts(43,3)`, TS2741. A person branching from `main` found it, not the gate, and
`main` stayed broken until `#33` repaired it.

The second was not a typecheck failure. `#28` added a suite whose proofs construct an infinite
duration through a parsing helper, resting on the contract admitting one; `#34` made the contract
reject it. The merge result **typechecks perfectly** and three tests die at construction.

So the obvious answer — run a typecheck on `main` after each merge, which is what was proposed when
the first case was found — is known by measurement to be insufficient. It would have caught one of
the two and looked like it worked.

Neither case had a textual conflict. Both pairs touched no file in common, and git merged them
silently. A mechanism that waits for a conflict to notice would have caught neither.

A repository whose default branch can be red for an hour teaches everyone to distrust the gate, and
the distrust is correct.

## Decision

**Every merge is decided against the merge RESULT, measured by the repository's own declared gate,
at the moment of merging.**

Three parts, each chosen against a specific failure:

**It measures the result, not the base afterwards.** Measuring after the merge reports the breakage
but leaves `main` red in the meantime, which is exactly the state both incidents produced. The
merge result is computed and gated *before* the merge is allowed.

**It runs the whole declared gate, not a typecheck.** The gate command is read from
`package.json`'s `quality` script rather than restated, so this introduces no second definition of
green — a second definition is a second thing to keep in step, and the copy is what drifts. The
second incident is the measurement that forbids the cheaper option.

**It recomputes the merge at check time.** A merge result computed once and trusted an hour later
has precisely the fault this record exists to close. The check fetches the base tip and performs the
merge itself, rather than reading a ref GitHub calculated when the pull request was last pushed.

The mechanism is `scripts/merge-gate.ts`, invoked by the `merge-gate` job in `.github/workflows/ci.yml`.
A refusal names **both** changes, not only the failing check: the head's own diff contains nothing
wrong, and a report naming one side sends the reader to the wrong place.

**This decision has a half that is not code.** The job makes the measurement; it does not withhold
the merge button. Two repository settings do that, and they are the owner's to apply:

- the `merge-gate` check listed under **Required status checks**, and
- **Require branches to be up to date before merging**.

Without the second, a pull request checked an hour ago can still be merged onto a base that has
moved since — the staleness this record is about, reintroduced at the last step. The code half is
inert on its own, and saying so here is the point of writing it down.

## Consequences

**Every merge now waits for a full gate run, and that cost is accepted.** On this repository the
gate is a few minutes. Set against it: `main` was red for an hour in the first incident and until a
repair pull request in the second, and a red default branch costs every parallel thread, not just
the one that caused it. The cost is also paid only where it buys something — when the head already
contains the base, the merge result is the head's own tree, which the other jobs have already
measured, and the job says so instead of measuring it twice.

**Dependencies are installed from the merge result's own lockfile**, not borrowed from the caller's
tree. Where two sides disagree about a dependency, that disagreement is one of the things this check
exists to find; borrowing would hide it. A failed install is therefore reported as a disagreement
between the two sides rather than as an infrastructure fault.

**Parallel branches are not discouraged.** Parallelism is why the project moves at all. The gap was
never that changes overlap; it was that the merge step trusted a stale measurement.

**This does not retro-fix the two incidents.** Both are already repaired on `main`. They survive as
the two fixtures in `tests/base/merge-gate.test.ts`, and they are kept distinct on purpose: a
mechanism that catches only the typecheck case looks exactly like one that works.

## Alternatives considered

**A typecheck on `main` after each merge.** Rejected by measurement rather than by argument: the
second incident typechecks and fails its tests. It would also have reported breakage only once
`main` was already broken.

**A merge queue.** Rejected. It answers a different question — ordering many concurrent merges — and
this project has one human. It would add a queue to administer for a problem that a check on the
merge result closes directly.

**Requiring reviewers.** Rejected for the same reason: the two incidents were not review failures.
Both changes were correct, and reviewed. Nothing a reviewer could have read in either diff would
have shown the other.

**Recreating the merge without git, by comparing declared interfaces.** Rejected. It would
re-implement a merge, and the second incident is not visible in any interface — it is a premise a
test rests on. The gate already knows how to find both; the only question was what tree to run it
against.
