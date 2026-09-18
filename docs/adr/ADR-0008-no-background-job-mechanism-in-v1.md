---
id: "ADR-0008"
title: "No background-job mechanism in V1; background generation is in-process"
status: accepted
date: 2026-09-17
tags: ["jobs", "cooking-plan", "runtime", "self-hosting"]
decides: ["OQ-10"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0005", "PDR-0002", "PDR-0004"]
---

## Context

`PDR-0004` made Cooking Plan generation a configured policy with `lazy` as the shipped default and
`background` as its other supported value. It did not say what *executes* `background`, and that gap
is this record's reason to exist: a supported configuration value with no mechanism behind it is a
promise the product cannot keep.

Two workloads could plausibly want a job mechanism. Background plan generation is one. Library-wide
reprocessing is the other — but Slice 1 already specifies `reprocess` as a **command**, and its
constraints say implementing it as a job would settle this very question in passing. So the only
live demand is the `background` policy value.

The pressure against a mechanism is strong and comes from two directions. `ADR-0005` states that
one repository is one `docker compose up`, and `PDR-0002` made that composition the reference
deployment an operator runs on their own machine. A broker — Redis, a queue service, a separate
worker container — is a second moving part the operator has to run, monitor and back up, for a
policy that is not even the default.

What makes the answer cheap is a property of the data rather than of the infrastructure. The Cooking
Plan is derived, replaceable data: `PDR-0001`'s first invariant separates it as its own semantic
layer, and it can be regenerated from the Canonical Recipe at any time. Nothing in the baseline
requires a plan generation to survive a restart, and the recipe stays fully viewable when no plan
exists — which Slice 6 carries as an acceptance criterion.

## Decision

**V1 ships no background-job mechanism.** This is a decision, not an omission.

`background` is implemented as **in-process, fire-and-forget generation after the response has been
sent** — the import request returns, and generation proceeds in the same process without the client
waiting. No queue, no broker, no worker, no second container.

A generation lost to a process restart is **not an error path**. The plan is derived data, so the
next cooking view regenerates it: under `background`, a crash mid-generation degrades to exactly the
behaviour of `lazy`, which is the shipped default and a supported state of the system. Slice 6's
criterion that the recipe stays viewable when no plan exists is what makes that degradation
invisible to the user.

`reprocess` stays a command, as Slice 1 specifies. It is not routed through this mechanism, because
there is no mechanism to route it through.

## Consequences

### Positive

- One `docker compose up` stays true. The operator runs one composition, and `ADR-0005`'s
  self-hosting promise survives contact with the second workload that would have broken it.
- `PDR-0004`'s seam becomes honest: both configured values now have an implementation, so the
  record's claim that `background` is supported is something the product actually does.
- Nothing is built in V1 for a policy that is not the default. The work lands where the measurement
  later says it should, rather than ahead of it.
- The failure mode is designed rather than tolerated: a lost plan is regenerated, and the system has
  a name for that state already.
- This record does not depend on `OQ-03`/`OQ-04`. A database-backed job table would have needed the
  persistence decision that is still waiting on Slice 1's deciding queries; in-process generation
  needs none of it.

### Negative

- A plan generation interrupted by a restart is silently lost. The user sees the `lazy` wait on
  their next cooking view without being told why, and nothing records that a generation was
  abandoned.
- Under `background`, plan generation competes with request serving in the same process. On a small
  self-hosted instance that is a real resource interaction, and there is no queue to smooth it.
- No retry, no backoff, no dead-letter. A provider error during background generation is simply a
  plan that does not appear, and the next cooking view pays the cost again.
- There is no operator-visible signal that background generation is running or has failed. Adding
  one later is work this record does not do.

### Neutral

- Adding a mechanism later is a bounded change and a supersession of this record, not a rewrite: the
  natural next step is a database-backed job table with a poller, which adds no container and
  becomes available once `OQ-03`/`OQ-04` are closed.
- This record decides nothing about the Cooking Plan's content, its traceability or its presentation,
  which are bound by `PDR-0001` and by the cooking-UX spike's findings.

## Alternatives considered

**A database-backed job table with a poller.** The strongest alternative: it survives restarts, adds
no container, and reuses the persistence Slice 1 builds anyway. Rejected for V1 on two grounds. It
presupposes the database decision — `OQ-03` and `OQ-04` are closed by their own record only after
Slice 1's three deciding queries exist — so building it now would mean choosing a store in order to
schedule a job, which is exactly the accidental decision this project keeps guarding against. And it
is a mechanism built in V1 for a non-default policy whose value has not been measured.

**An external broker with a worker process.** Redis and a queue library is the conventional answer
and would give retries, backoff and visibility. Rejected because it adds a second required service
to the composition, directly against `ADR-0005`, and doubles what a self-hoster has to operate for a
feature that is off by default.

**Removing `background` from V1 so that only `lazy` ships.** Honest and smaller. Rejected because
`PDR-0004` records that a change to the *seam* — as opposed to the default value — supersedes that
record, and because in-process generation costs little enough that removing the value buys less than
it gives up. An operator who would rather pay the cost at import keeps that option.

## What would falsify this decision

- **Background generation measurably degrades request serving** on a reference-sized instance. That
  is the observation that makes a queue worth its cost.
- **Lost generations turn out to be frequent enough to notice** — an operator restarting often
  enough that `background` behaves like `lazy` in practice, which would make the value pointless
  rather than cheap.
- **A second background workload appears** that is not regenerable derived data. The whole argument
  here rests on the plan being reproducible; anything that is not reproducible cannot use this
  mechanism and would justify a real one.
- **`OQ-03`/`OQ-04` close on a store whose job-table pattern is trivial**, at which point the
  database-backed alternative becomes nearly free and the reasoning above is worth re-running.
