---
id: "ADR-0013"
title: "Model egress is its own guarded module beside safe fetch, not an extension of it"
status: accepted
date: 2026-09-21
tags: ["security", "egress", "model-provider"]
constrained_by: ["PDR-0002"]
depends_on: ["ADR-0004"]
related_to: ["ADR-0010"]
---

## Context

`ADR-0010` guards one thing: fetching a URL the user supplied. The address there is
attacker-influenced, so the whole design — resolve-and-pin, a default-deny address policy, bounded
redirects each re-checked — exists to stop the instance being aimed at its own network.

The real capture and normalization capabilities introduce a second kind of outbound call, and it is
not that shape. The endpoint is fixed and operator-configured, so nobody can redirect it. What
leaves the instance is different too: the user's photograph and an API credential. Nothing in
`ADR-0010` speaks to either.

The two are nonetheless entangled by the mechanism that enforces `ADR-0010`. The chokepoint proof
fails statically if **any** network primitive appears under `src/` outside `src/security/` — it
does not, and cannot, distinguish the two shapes. So the model transport could not live in `src/`
at all, and was parked in `spikes/`, outside the tree the proof scans, following the precedent
`spikes/s6-fidelity/openai-run.ts` already set.

That kept the first real run unblocked without pre-empting this decision, which is all it was for.
It is not a home: the production path cannot ship with its transport in a spike directory, where no
guard applies and nothing stops a second copy appearing.

## Decision

Model egress lives in **its own module under `src/security/`**, separate from `safe-fetch` and
reached through the `ModelTransport` seam `ADR-0004` already defines.

`ADR-0010` keeps its scope: URL ingestion. The chokepoint proof is unchanged, and the invariant it
enforces is read as **all egress in one directory** rather than all egress through one function.

The module owns what the fixed-endpoint shape actually needs:

- the endpoint comes from configuration — never from a request, a snapshot, or a model reply;
- the credential is read from the environment and never enters a snapshot, a Canonical Recipe,
  provenance, or a log line;
- time and response-size bounds fail closed, as `safe-fetch`'s do;
- failures surface as typed reasons rather than raw transport errors, so a caller can tell a
  refusal from an outage.

The address-policy machinery does not apply and is not reused: pinning an address that no attacker
can influence would be ceremony, and ceremony is how a guard stops being read.

## Consequences

- `safe-fetch` is not widened, so the dedicated security review it received still describes the
  module that ships.
- The "one egress function" reading of `ADR-0010` is retired deliberately, in favour of the
  directory rule the proof actually enforces. Anyone reasoning about egress now reads one directory,
  and the proof keeps that honest.
- The chokepoint guarantee becomes directory-scoped rather than function-scoped. That is a real
  loosening, and it is the cost of the decision: a future module in `src/security/` can open a
  socket without the address policy. The mitigation is that `src/security/` is small and reviewed as
  the boundary it is, not that the test will catch it.
- The transport moves out of `spikes/`, and the spike runners consume the module instead of keeping
  their own copy — otherwise the second copy this record exists to prevent survives in the spikes.
- Model-provider capabilities still contain no network primitive themselves; they receive the
  transport injected, which is what lets their proofs drive production paths with no model and no
  network.

## Alternatives considered

**Extend `safe-fetch` to carry method, headers and body.** The most faithful reading of "one egress
function", and rejected on two counts. It widens the one module that had its own dedicated security
review, invalidating that review. And it merges a guard whose whole purpose is an
attacker-influenced address with a caller whose address is fixed, leaving a module where half the
protections are inert for half the callers — harder to reason about than two modules that each mean
what they say.

**Record model egress as out of `ADR-0010`'s scope and guard it somewhere else.** Rejected because
it makes the chokepoint proof's directory rule a half-truth: egress would exist that the proof is
written to forbid, permitted by a record the proof cannot read. The next such case would land in a
third location with the same justification.
