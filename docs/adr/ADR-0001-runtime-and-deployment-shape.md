---
id: "ADR-0001"
title: "Portable containerised Node runtime as the reference self-hosting shape"
status: proposed
date: 2026-09-10
tags: ["runtime", "deployment", "self-hosting", "portability"]
decides: ["OQ-05"]
constrained_by: ["PDR-0001"]
---

## Context

Cookframe's product baseline makes self-hosting a first-class constraint: "each user runs
their own instance and controls their own credentials and data", and the reference deployment
must not make the Canonical Recipe model depend on one platform.

Two pressures pull in opposite directions.

A managed edge platform (Cloudflare Workers with D1 and R2 was named in discovery as a possible
reference deployment) gives the maintainer a zero-cost, always-on public HTTPS URL. That URL is
not a convenience: the Bring adapter requires a publicly fetchable recipe URL, so an instance
reachable only on a home LAN cannot use the product's primary shopping path without tunnelling.

Against that, an edge-platform-first design makes "self-hosted" effectively mean "hold an account
with that platform", which weakens the product's own posture. Its constraints — no long-running
work, platform-specific storage bindings, a restricted subset of Node APIs — would also leak
upward into the layers the baseline says must stay portable, despite the explicit warning against
"abstraction theatre".

This decision is the most expensive one to reverse in the project: it cascades into persistence,
background work, file handling and testing.

## Decision

Build Cookframe as a portable Node 22 HTTP server, distributed as a container, with
`docker compose up` as the documented reference self-hosting path.

Treat "reachable over public HTTPS" as an explicit, documented deployment requirement that each
instance satisfies however it chooses — a VPS, a managed container host, or a tunnel from a home
server. Deployment to a managed platform remains a supported option, never the substrate the code
is written against.

## Consequences

### Positive

- Self-hosting means running a container, with no mandatory third-party account.
- No platform-specific runtime constraints reach the ontology, adapter or projection layers.
- Local development and CI run the same runtime as production.
- Long-running and background work stays available if later needed, rather than being designed out.

### Negative

- The maintainer's own instance costs more to run than a free edge deployment.
- Public HTTPS reachability becomes the self-hoster's problem, and must be documented honestly
  as a prerequisite for the Bring path rather than glossed over.
- A container is a heavier artefact than a platform-native deploy.

### Neutral

- The Bring compatibility spike (S3) does not depend on this decision: it can run against a
  disposable public page, so it must not be sequenced behind it.

## Alternatives considered

**Cloudflare Workers + D1 + R2 as the primary target.** Free always-on public HTTPS, which the
Bring path wants. Rejected as the *substrate* because it redefines self-hosting as platform
tenancy and its constraints would not stay contained. Still viable as one documented deployment.

**"Both, behind clean boundaries" from day one.** Rejected as the abstraction theatre the baseline
warns about: paying for a portability layer before a second consumer exists.
