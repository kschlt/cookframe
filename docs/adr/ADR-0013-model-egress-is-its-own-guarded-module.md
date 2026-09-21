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
leaves the instance is different too: the user's photograph and an API credential. Neither is what
`ADR-0010` was written about.

That reading is `ADR-0010`'s own, not a convenient one adopted here. Its Neutral consequence states
that the record "constrains extraction, **the model boundary** and image handling **not at all**",
and names the model boundary as a property of `ADR-0004` instead. So this record sits beside
`ADR-0010` rather than superseding it: it decides something `ADR-0010` explicitly declined to
decide.

**The falsification clause needs answering all the same.** `ADR-0010` says "A second fetch surface
appears — external images, oEmbed, favicons. It must route through this module. A second outbound
path that does not is the failure this record most expects." Read as written, model egress is
literally a second outbound path that does not route through `safe-fetch`.

The distinction that survives is the one the examples share: every surface it names derives its
address from a source the user supplied, so every one of them inherits the attacker-influenced
address that `safe-fetch` exists for. A fixed, operator-configured endpoint does not. This record
narrows that clause to what its examples are about — it still binds every fetch surface, and it is
still the failure to expect there — and carves out the fixed-endpoint case only.

The two are nonetheless entangled by the mechanism that enforces `ADR-0010`. The chokepoint proof
fails statically if **any** network primitive appears under `src/` outside `src/security/` — it
does not, and cannot, distinguish the two shapes. So the model transport could not live in `src/`
at all, and was parked in `spikes/`, outside the tree the proof scans. That kept the first real run
unblocked without pre-empting this decision, which is all it was for. It is not a home: the
production path cannot ship with its transport in a spike directory, where no guard applies and
nothing stops a second copy appearing.

## Decision

Model egress lives in **its own module under `src/security/`**, separate from `safe-fetch`, and is
reached through an injected transport seam so the capabilities themselves stay free of network
primitives — the capability boundary `ADR-0004` draws, applied to a concern `ADR-0004` did not name.

`ADR-0010` keeps its scope: URL ingestion. The invariant its proof enforces is read as **all egress
in one directory** rather than all egress through one function.

The module owns what the fixed-endpoint shape actually needs:

- the endpoint is bound once from configuration and is **not a parameter of the send call**, so it
  cannot be steered by a request, a snapshot, or a model reply — structural rather than validated;
- a redirect is a refusal, not a hop, since a fixed endpoint has no reason to move;
- the credential is read from the environment and is scrubbed from any message the module builds,
  so it never reaches a snapshot, a Canonical Recipe, provenance, or a log line;
- time and response-size bounds fail closed, as `safe-fetch`'s do;
- failures surface as typed reasons rather than raw transport errors, so a caller can tell a
  refusal from an outage.

The address-policy machinery does not apply and is deliberately not reused: pinning an address that
no attacker can influence would be ceremony, and ceremony is how a guard stops being read.

**The directory rule is kept honest by a declared inventory.** Exempting a whole directory would
otherwise exempt every future file added to it, silently. The chokepoint proof therefore carries an
explicit list of the modules `src/security/` is allowed to contain: an undeclared module fails it,
including one nested in a subdirectory, as does a declared module that has been deleted.

## Consequences

- `safe-fetch` is not widened, so the dedicated security review it received still describes the
  module that ships.
- The "one egress function" reading of `ADR-0010` is retired deliberately, in favour of the
  directory rule the proof actually enforces.
- The chokepoint guarantee becomes directory-scoped rather than function-scoped. That is a real
  loosening and it is the cost of this decision. What the inventory buys is not prevention: a second
  egress path can still be added to `src/security/` without the address policy. What it guarantees
  is that doing so **cannot be silent** — it must appear in the diff as a new declared entry, with
  whatever reason its author gives. The protection is the review of a small, declared boundary, and
  the inventory is what makes the boundary reviewable.
- `ADR-0010`'s falsification clause is narrowed, not discarded: a second **fetch** surface — an
  external image, oEmbed, a favicon, anything whose address comes from a source — must still route
  through `safe-fetch`, and one that does not is still the failure that record most expects.
- The transport moves out of `spikes/`, and the spike runners consume the module instead of keeping
  their own copy — otherwise the second copy this record exists to prevent survives in the spikes.
- Model-provider capabilities contain no network primitive themselves; they receive the transport
  injected, which is what lets their proofs drive production paths with no model and no network.

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

**Supersede `ADR-0010`.** Rejected because there is nothing to supersede. `ADR-0010` decides how an
attacker-influenced address is fetched, and disclaims the model boundary in its own consequences.
A supersession would replace a record that is still correct about the thing it decides.
