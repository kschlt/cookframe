---
id: "PDR-0002"
title: "The reference deployment is a self-hosted single-user instance, not platform tenancy"
status: accepted
date: 2026-09-17
tags: ["deployment", "self-hosting", "product", "posture"]
related_to: ["ADR-0001", "ADR-0005"]
---

## Context

`ADR-0001` deferred the hosting target as `OQ-05`, to be decided by its own record once the Bring
compatibility spike has reported. It also named, precisely, why it could not simply pick one: an
edge platform "would redefine self-hosting as platform tenancy, which is a product concern this
record should not settle unilaterally."

That sentence separates two questions that have been travelling as one. **Which platform** the
project ships as its reference deployment genuinely waits on the spike — the spike establishes
whether Bring requires a publicly fetchable HTTPS URL, and that bears directly on what a reference
deployment has to provide. **What self-hosting means for this product** does not wait on anything.
It is a promise to the people who run their own instance, and no measurement decides it.

Leaving both halves open has a cost that is already being paid. Object and blob storage, the
background-job mechanism, the safe-fetch implementation and the database shortlist each have an
option set that differs depending on whether the answer is "a machine you control" or "a platform
account you hold". Every one of them was blocked on a question that was never really about them.

The self-hosting principles already lean the whole way: "Primary V1 deployment model: single-user,
self-hosted instance", and "V1 is not a hosted multi-tenant SaaS and should not inherit SaaS
complexity". `ADR-0005` reaches the same place from the other side — "One repository is one
`docker compose up`, which keeps ADR-0001's self-hosting promise intact." What has been missing is
a record saying so, which is why the question kept being re-opened downstream.

## Decision

The reference deployment is a **single-user instance the operator runs on infrastructure they
control**, delivered as one container composition. Self-hosting means the operator holds the
machine, the data and the credentials — not an account on a platform that holds them.

An edge or platform deployment is **not shipped and not documented for V1**. It is not ruled out,
and `ADR-0001`'s Web-standard API posture is deliberately preserved so that it stays reachable
without a rewrite; but it is not a supported path, and no V1 work may assume one.

This record settles the product concern `ADR-0001` declined to settle unilaterally. It does **not**
close `OQ-05`. The concrete reference deployment — which platform, and whether the documented path
must include a publicly reachable HTTPS URL — is still decided by its own architectural record once
the Bring compatibility spike reports, exactly as `ADR-0001` specifies. What changes is that the
record will choose *within* a settled posture rather than also deciding the posture.

Where the spike finds that Bring requires a publicly fetchable URL, that is satisfied by
configuration the operator supplies — a public base URL, and whatever reverse proxy or tunnel their
infrastructure uses. The self-hosting principles already treat the public base URL as a configurable
concept, so this does not reopen the posture.

## Consequences

### Positive

- Four questions that were waiting on this become answerable immediately: object and blob storage,
  the background-job mechanism, the safe-fetch implementation, and the database shortlist. Each had
  a platform-dependent option set and no platform.
- The promise is now stated in one place, so an implementation that quietly assumes a platform
  account is visibly wrong rather than arguably fine.
- It matches what the self-hosting principles already tell a reader, removing a gap between what the
  project says and what it has decided.
- Cost and operational burden stay with the operator, which is what a single-user self-hosted tool
  is for.

### Negative

- If the Bring spike finds that a publicly fetchable HTTPS URL is required, self-hosters carry the
  work of exposing one. That is real friction, and the documentation owes them a worked path.
- A platform deployment would have given a public URL, managed TLS and a queue for free. Declining
  it means building or documenting each where V1 needs them.
- The decision is made before the spike reports. If the spike finds something that makes the
  self-hosted path substantially worse than expected, this record is the one to revisit — by
  supersession, and the evidence for doing so will be in the spike's findings.

### Neutral

- Nothing here forecloses the edge option. It remains reachable precisely because `ADR-0001`'s
  API posture is held, and this record depends on that posture continuing to be honoured.

## Alternatives considered

**Ship the container as the reference and an edge deployment as a documented second path.**
Rejected for V1. Two supported paths is twice the surface that has to keep working, tested and
documented, and the self-hosting principles warn directly against building for portability that
nobody has asked for: "Do not build a generic multi-cloud framework merely because self-hosters may
choose another platform." A second path can be added later by a record that supersedes this one,
once someone actually needs it.

**Make an edge platform the reference deployment.** It has the better answer to the question the
spike is about — a public HTTPS URL with managed TLS, at no operator cost — and it would make the
Bring journey easy regardless of what the spike finds. Rejected because it redefines the product's
central promise: the operator would hold a platform account rather than a machine, which is the
tenancy `ADR-0001` flagged and which contradicts the primary deployment model the self-hosting
principles state. Convenience on one adapter is not worth changing what the product is.

**Keep the whole question closed until the spike reports.** Rejected as the status quo whose cost is
described in the Context. The spike bears on the platform, not on the posture, and holding the
posture hostage to it blocked four unrelated decisions for no gain.
