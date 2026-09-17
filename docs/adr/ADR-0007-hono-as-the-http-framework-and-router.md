---
id: "ADR-0007"
title: "Hono as the HTTP framework and router"
status: accepted
date: 2026-09-17
tags: ["http", "framework", "router", "rendering", "portability"]
decides: ["OQ-01"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001", "ADR-0002", "ADR-0005", "PDR-0002"]
---

## Context

Slice 0 establishes a toolchain and explicitly refuses to pick a framework — it *"establishes a
toolchain, not a framework, and must not settle it by picking one in passing"*. Slice 1 then needs a
JSON surface and Slice 2 needs server-rendered HTML, so the question is forced between them. It is
forced now because five HTTP surfaces are already specified across V1, and they do not agree about
what a framework is for:

- a Shortcut-driven image ingest endpoint with a bounded upload,
- a JSON-only pipeline surface with no UI at all,
- server-rendered library and recipe pages in plain HTML and CSS,
- a public, revocable, single-recipe capability URL serving a complete Schema.org/Recipe document to
  a non-browser fetcher,
- and a `reprocess` **command** that must not become a job, because implementing it as one would
  settle `OQ-10` in passing.

`PDR-0002` settled today that the reference deployment is a container, single-user and self-hosted.
That deliberately does not decide this question. `ADR-0001` kept the API posture separate from the
host on the grounds that it *"is decidable today, on principle, without naming a host"* and that it
*"is what decides whether a later hosting decision is cheap or a rewrite"*. An edge deployment is
not shipped and not documented, but it remains reachable — and a framework choice is exactly where
that reachability is either preserved or quietly spent, because the framework decides whether a
handler sees a Web `Request` or a Node `IncomingMessage`.

Two backlog constraints narrow the field before ergonomics or performance enter.

Slice 2 requires plain HTML and CSS with **no component system introduced**, and names `OQ-12` and
`OQ-01` as staying open because *"introducing one here would settle both in passing and bias S4"*.
The cooking-UX spike exists to measure a design; a full-stack SSR framework brings the component
system whose absence is that spike's prerequisite.

And S5 writes its adversarial fetch suite **before** an implementation exists, against a fetch
contract. Outbound fetch must therefore stay a framework-independent module — which makes a
framework's own HTTP client a liability rather than a convenience.

## Decision

Use **Hono** as Cookframe's HTTP framework and router, served on Node 22 through
**`@hono/node-server`**.

Application handlers take a Web `Request` and return a Web `Response`. Nothing above the server
entry point imports `@hono/node-server`, and no `node:http` type appears in application code.
`app.fetch` — a Web fetch handler — is the whole application's HTTP surface.

Three commitments follow from the backlog rather than from Hono, and are recorded here so they are
not re-litigated per slice:

- **Rendering uses `hono/html` tagged templates, never `hono/jsx`.** Hono ships a JSX runtime; using
  it would introduce a component system and bias the cooking-UX spike. `OQ-12` stays open.
- **Outbound fetch is a module with no Hono import**, so S5's suite runs against it without a
  server. `OQ-16` stays open and is closed by Slice 4.
- **The pipeline is callable with no HTTP request in scope**, so `reprocess` is a command.
  `OQ-10` stays open.

## Consequences

### Positive

- `ADR-0001`'s posture is satisfied by construction rather than by discipline. That record admits
  *"nothing enforces it until there is code and a lint rule to check"*; here, a handler that wants a
  Node request object has to go out of its way to find one.
- The dependency footprint is two packages, both with zero dependencies of their own — against 53
  for Fastify with multipart and 76 for Express 5 with an upload parser. For a public repository
  whose security baseline includes dependency scanning and Dependabot, that is a materially smaller
  supply-chain surface.
- Bounded multipart upload is in core (`hono/body-limit`), so the ingest endpoint needs no
  third-party parser.
- Server-rendered HTML with no client runtime and no second language — what `ADR-0002` promised and
  what Slice 2 requires.
- The router can be exercised in-process without binding a socket, so Slice 0's six CI jobs need no
  server lifecycle, no port allocation and no build step.
- If `OQ-05` ever moves to an edge target, the change is the server entry point only: the platform
  adapters ship in the same zero-dependency package and `app.fetch` is unchanged.
- This record decides nothing about storage, jobs, deployment presets or layout, so `OQ-03`,
  `OQ-04`, `OQ-05`, `OQ-10`, `OQ-12` and `OQ-16` all survive it intact.

### Negative

- **`hono/body-limit` buffers an accepted chunked body in memory** up to the bound. Where
  `content-length` is present it short-circuits on the header, but otherwise it accumulates chunks
  and aborts past the threshold. The ingest bound must be set with that in mind, and a capture large
  enough to make that unacceptable would need a streaming-to-disk path Hono does not provide and
  Fastify's multipart plugin does.
- **Two release lines to track.** Core and the Node adapter version independently, so version skew
  is a maintenance surface that Fastify and Express do not have.
- **No batteries.** No logger, no validation layer, no view engine beyond tagged templates, no
  built-in auth. Each is small to add, and each is now a small decision with no default.
- **Tagged templates are a floor, not a ceiling.** They are right for Slice 2 deliberately. If the
  cooking-UX spike concludes the presentation needs more structure, `OQ-12` is answered on top of
  Hono rather than by it, and that may be more work than a full-stack framework would have been.
- **Hono's centre of gravity is edge runtimes**, so Node is the adapter case rather than the home
  case. That cuts both ways: cheap reversibility toward edge must not be mistaken for a reason to go
  there. `PDR-0002` settled the posture and this record does not reopen it.
- `hono/jsx` ships in the package and will be tempting. Nothing mechanically stops a later slice
  from importing it and settling `OQ-12` silently — the same erosion-by-diffusion `ADR-0004` names
  about provider leakage.

### Neutral

- No CSS framework, component or layout system (`OQ-12`), database (`OQ-03`, `OQ-04`), hosting
  platform (`OQ-05`), safe-fetch implementation (`OQ-16`) or job mechanism (`OQ-10`) is chosen here.
  Where an implementation appears to need one, that is the other question surfacing, not this record
  being incomplete.
- Node 22 reaches end of life on 2027-04-30. That is a fact about `ADR-0001`'s runtime rather than
  about this record; nothing in this analysis changes under a later Node.

## Alternatives considered

**Fastify.** The strongest Node-native option: actively released, an excellent inject-based testing
story, and the best streaming multipart handling of any candidate — which is the one place it beats
this decision. Rejected because its handler boundary is a Fastify object wrapping Node core's
`IncomingMessage`. That is precisely the Node-specific equivalent `ADR-0001` says not to write
against, and closing the gap would mean adopting a `Request`/`Response` compatibility plugin — the
*"explicit abstraction layer"* that record already rejected as abstraction theatre.

**Express 5.** Ubiquitous and universally understood, which has real value in a public repository
open to contribution. Rejected on two counts: it is Node-native at the handler boundary, same as
Fastify; and the maintenance evidence is poor — the 5 line has not shipped since 2025-12-01 while
the 4 line shipped as recently as 2026-09-14, so the actively maintained line is the one we would
not be on.

**h3 v2 with srvx.** The closest call, and the only other candidate that is natively Web-standard: a
zero-dependency Web-standard server, three packages installed. Rejected on stability, not on design
— v2 entered release candidate in October 2025 and is still an RC nearly a year later, with dozens
of prereleases and no stable release. The stable line, v1, is Node-native and therefore fails the
`ADR-0001` test that is the whole reason to consider it. Committing Slice 0's toolchain to a release
candidate is not a trade this project should take.

**Nitro.** Solves deployment portability directly, which is attractive given `OQ-05`. Rejected as
deciding far more than is asked: seventy direct dependencies and a 390-package install, a bundler
that becomes a second toolchain against Slice 0's *"One lint and format toolchain, not several"* and
`ADR-0005`'s *"No monorepo tooling until a second deployable exists"*, and deployment presets that
are opinions about a question `ADR-0001` deliberately left open.

**Plain `node:http` with a hand-rolled router.** Zero dependencies and complete control — the honest
baseline every framework should justify itself against. Rejected because Node 22 provides no bridge
from `IncomingMessage`/`ServerResponse` to `Request`/`Response`, so writing against Web standards
here means hand-building the adapter that already exists as a maintained package, plus a router,
plus multipart parsing, plus body bounds. That hand-rolled code would sit directly on the path
handling hostile input under `PDR-0001` invariant 7, maintained by one person and reviewed by
nobody else.

**Next.js, and React Router v7.** Both are Web-standard at the route-handler boundary and both would
give a mature SSR story. Rejected because each declares React as a peer dependency and therefore
*is* a component system. Slice 2 requires plain HTML and CSS with no component system introduced,
and names `OQ-12` and `OQ-01` as staying open precisely so the cooking-UX spike measures a design
rather than a renderer; the spike independently forbids choosing one before it runs. Adopting either
decides `OQ-12` months before the evidence that should inform it exists. Both also add a bundler
against Slice 0's one-toolchain constraint, and would be carried unused through Slice 1, which is
specified as having no UI beyond JSON output.

## What would falsify this decision

Each is an observation that should open a superseding record, not a fear:

1. **The ingest bound cannot be held in memory.** If the measured scan-to-shop distribution or the
   capture-quality fixture set shows real captures at a size where buffering the bounded body is
   unacceptable, `hono/body-limit` is the wrong mechanism and a streaming-to-disk multipart path is
   needed. Fastify's multipart handling is the specific thing that would then be worth a Node-native
   handler boundary.
2. **The cooking-UX spike concludes the presentation needs a component system whose natural home is
   a full-stack framework**, and answering `OQ-12` on top of Hono costs more than adopting that
   framework would have. Note this arrives *after* the spike, which is the sequence this record
   exists to protect.
3. **The Node adapter stops tracking core** — a persistent Node incompatibility, or core releases
   continuing while the adapter goes stale for a cycle. The two-package split is the exposure; this
   is what it failing looks like.
4. **h3 v2 ships stable and demonstrates a materially better bounded-body or streaming story.** This
   would be a cheap supersession rather than an expensive one, because both are Web-native: same
   `Request` in, same `Response` out, with only the entry point and the router API changing. Worth
   naming precisely because it is the low-cost escape hatch this decision buys.
5. **`OQ-05` closes on a target whose handler is not a Web fetch handler.** What is falsified then is
   `ADR-0001`'s posture rather than this record's choice within it, and `ADR-0001` is what needs
   superseding first.
6. **A second deployable appears**, triggering `ADR-0005`'s second clause. One application with one
   router stops being the right shape, and how the HTTP layer is packaged becomes live again.
