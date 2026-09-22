---
id: "ADR-0021"
title: "The capability-URL serving route: one recipe, every miss the same 404, origin-agnostic"
status: accepted
date: 2026-09-22
tags: ["http", "security", "capability-url", "shopping", "bring"]
constrained_by: ["PDR-0001"]
depends_on: ["ADR-0016", "ADR-0017"]
related_to: ["ADR-0007", "ADR-0018"]
---

## Context

The capability token (ADR-0016) and the Bring mechanism (ADR-0017) are decided: a recipe is handed
to Bring by exposing it as a Schema.org/Recipe page at a URL carrying a single opaque secret in its
path, which Bring fetches server-side. What remained was the route itself — the HTTP surface that
answers a `GET` at that path — and two decisions it forces that neither prior record settled, because
both are properties of the *serving surface* rather than of the token or the mechanism.

The first is what a request that does not resolve to a servable recipe returns. ADR-0016 fixed that a
revoked token is indistinguishable from one that was never issued (both "resolve to nothing"), so that
probing the store reveals no state. But a route has a third miss the store does not: a token that
resolves to a recipe id whose recipe is absent (never persisted, or gone). If that answered
differently from an unknown or revoked token, the difference would tell someone trying tokens that a
guess was a *real* token — an oracle over the token space, which is exactly what ADR-0016's secret-in-
the-path design exists to deny.

The second is where the route may assume it lives. `OQ-05` (hosting) is closed by ADR-0011 (a rented
single-tenant server), but the *reference deployment* being decided does not license the route to bake
in a base URL, domain or port; a capability URL must work under whatever public origin serves it,
because the secret's whole job is to be reachable by a third party wherever that is. ADR-0007 already
put `app.fetch` — an origin-agnostic Web fetch handler — at the centre for this reason; this record
holds the route to it.

## Decision

The serving route is a Hono app exposing exactly one route, `GET /r/<token>`, that composes the
capability store (ADR-0016), the repository's `loadLatestCanonical` (ADR-0018) and the omit-never-
invent Schema.org mapping (ADR-0017), and nothing else.

1. **One recipe, no ambient authority.** The route serves the single recipe a token grants and
   exposes no other. There is no listing route and no path from a token to another recipe or token —
   the store offers no enumeration (ADR-0016), and the route adds none. This is PDR-0001 invariant 11
   in force at the boundary: the private library is never made public to satisfy Bring; one capability
   URL exposes one recipe.

2. **Every miss is the same 404.** An unsafe token, an unknown token, a revoked token, a token whose
   recipe is absent, and any unmatched path all return one identical response — same status, same
   body, same content-type — routed through a single not-found handler. The three token-space misses
   in particular (unknown / revoked / recipe-absent) are byte-identical, so no response's *bytes*
   distinguish a real token from a guessed one. This extends ADR-0016's revoked-vs-never-issued
   indistinguishability to the serving surface and adds the recipe-absent case the store alone could
   not have. A hit is the one legitimate distinction: it returns the recipe the token grants, as
   `application/ld+json`. What is equalized is the response bytes; equalizing the *work* behind them
   (a timing side-channel a persisted repository would introduce) is out of this route's scope — see
   the negative consequence below.

3. **A served recipe carries `Cache-Control: no-store`.** The one legitimate 200 sets `no-store` so
   no cache between the origin and the reader — a browser, a forward or reverse proxy, a CDN — may
   keep serving the recipe after its token is revoked. Revocation is the grant's only end (ADR-0016)
   and the URL is designed to leave the device, so a heuristically-cached 200 would be a kill switch a
   cache outlives. The served document itself is the deterministic mapping's output verbatim and
   carries no versioning of its own; the mapping version (`SCHEMA_ORG_MAPPING_VERSION`) is not
   embedded in the response — see *Alternatives considered*.

4. **Origin-agnostic.** The app reads only the request path and returns a Web `Response`; it wires in
   no base URL, domain or port and makes no assumption about its host. `app.fetch` is the whole
   surface (ADR-0007), so the route is exercised in-process without binding a socket, and the server
   entry point that gives it a public origin — the one place `@hono/node-server`, a port and a host
   appear — is the hosting unit's concern, not this route's. This record decides nothing about `OQ-05`
   and must not: it works under any public origin precisely so the hosting decision stays free.

This record closes no open question. `OQ-17` and `OQ-18` are already closed by ADR-0016 and ADR-0017;
this is their implementing route, and its own decisions (the identical miss and the origin-agnostic
surface) are what it records.

## Consequences

### Positive

- A third party — or anyone who comes to hold a token — cannot use the route as an oracle: every miss
  looks the same, so trying tokens learns nothing, and the secret-in-the-path design (ADR-0016) is not
  quietly undone at the HTTP layer.
- The route is testable with no server lifecycle: `app.request(...)` exercises the whole surface,
  which is how its properties are proven offline.
- Moving to a different origin, or to an edge target (the reversibility ADR-0007 preserves), changes
  the server entry point only; the route is unchanged because it never knew its origin.

### Negative

- The identical 404 means an operator debugging a genuinely missing recipe gets no more from the route
  than an attacker does; the distinction (a valid token whose recipe is absent is an inconsistency
  worth an alert) has to be surfaced through logs or metrics, not the response. That is the accepted
  cost of denying the oracle.
- The route depends on three modules (store, repository, mapping); a change to any of their contracts
  reaches it. This is composition working as intended (ADR-0004), but it is a real coupling.
- The byte-identical 404 equalizes the *response*, not the *work*. A hit does more work than a miss
  (a repository load, then a mapping), and a recipe-absent miss does more than an unknown one (a store
  resolve that succeeds, then a load that returns nothing), so a persisted, latency-bearing repository
  would leave a timing side-channel the equal bytes do not close. The in-memory store and provisional
  repository the route is proven against have no such gap, but a production repository could; closing
  it (constant-time work, or a response delay) is a hosting-layer concern deliberately left to the
  unit that wires the real repository, not decided here.

### Neutral

- No server binding, port, host or deployment preset is chosen here (`OQ-05`), and no token or Bring
  behaviour is re-decided (`OQ-17`, `OQ-18`). Where the route appears to need one of those, that is the
  other record surfacing, not this one being incomplete.

## Alternatives considered

**Distinct responses for the miss cases** (404 for unknown, 410 for revoked, 404-with-detail for a
missing recipe). Rejected: each distinction is an oracle bit over the token space, and a revoked-vs-
unknown distinction is the exact one ADR-0016 forbids. The debugging value is real but belongs in
server-side observability, not in a response a stranger can read.

**A listing or index route** (even an authenticated one) alongside the capability route. Rejected: it
is ambient authority by construction and would make the private library reachable as a set, against
PDR-0001 invariant 11. A token is the only handle, and it reaches one recipe.

**Binding the route to a configured base URL** so it can emit absolute links to itself. Rejected: it
would decide `OQ-05` in passing by assuming a deployment form, and the route needs no self-link — Bring
is given the capability URL by the caller that issued it, not by the page.

**Serving the recipe as `application/json` rather than `application/ld+json`.** Rejected: the payload
is a JSON-LD document (`@context`/`@type`) whose consumer is a Schema.org parser; the `ld+json` media
type is what names it correctly, and costs nothing.

**Embedding the mapping version (`SCHEMA_ORG_MAPPING_VERSION`) in the served document** — as an extra
field, or a response header. Rejected: the served body is the omit-never-invent mapping's output
*verbatim* (ADR-0017), and a Schema.org/Recipe consumer (Bring) has no use for our internal mapping
version — adding it would either pollute the Schema.org document with a non-Schema.org field or add a
header no consumer reads. The mapping version is a producer-side contract, pinned by the
`bring-fixtures-green` compatibility spike, not something the served page needs to announce. If a
future consumer ever needs to negotiate mapping versions, that is a new decision with a real
requirement behind it, not a field added speculatively now.
