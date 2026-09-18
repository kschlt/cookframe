---
id: "ADR-0010"
title: "Safe URL fetch is guarded at the connector, with a default-deny address allowlist"
status: accepted
date: 2026-09-17
tags: ["security", "ssrf", "fetch", "url-ingestion"]
decides: ["OQ-16"]
constrained_by: ["PDR-0001", "PDR-0002"]
depends_on: ["ADR-0001"]
related_to: ["ADR-0007"]
---

## Context

Slice 4 fetches attacker-influenced URLs from the instance's own network position. `PDR-0002`
settled that the instance is a container on infrastructure the operator controls, so there is no
platform egress isolation to fall back on and none can be shipped. **The guard is the only
boundary.** S5 has already written the adversarial suite against a fetch contract; this record
chooses the mechanism that suite constrains.

The requirement list is settled — the self-hosting principles enumerate it and Gate E gives the test
matrix. What was open is the mechanism, and the obvious mechanism is wrong.

**The naive shape is bypassable, and measurably so.** Validate the URL, resolve the host, classify
the address, then call `fetch` — against a rebinding authority answering with TTL 0, that consumes
*two* DNS answers: the first is classified, the second is connected to. Node's `fetch` re-resolves
at connect time, so any check completing before the call is a check of a different address than the
one used. Per-hop re-validation does not help, because it re-validates the *URL*.

**The obvious guard point is also wrong.** The socket `lookup` option does not fire for IP-literal
hosts, so a `lookup`-only guard is walked straight through by `http://127.0.0.1/` and its decimal,
hexadecimal and octal spellings. This is not hypothetical: a published advisory describes exactly
this class against `request-filtering-agent`'s 1.x line, whose patched line is `2.0.0`.

**And the obvious policy is wrong.** A denylist of loopback, private, link-local and carrier-grade
NAT — the list anyone writes first — is defeated by address families that *embed* a forbidden
address: `2002:7f00:1::1` is 6to4 carrying `127.0.0.1`, and `64:ff9b::a9fe:a9fe` is NAT64 carrying
`169.254.169.254`. A classifier labels these `6to4` and `rfc6052` and does not unwrap them, so an
enumerated denylist admits them.

Each of the three was reproduced before this record was written, not reasoned about.

## Decision

Build the safe-fetch guard **in-repo as a single module**, and take **`ipaddr.js`** for address
parsing and range classification only.

1. **One chokepoint: a custom undici `connect` connector.** Every TCP connection the guard makes
   passes through it. It fires for IP-literal hosts, which the socket `lookup` option does not —
   that gap is the advisory class above.
2. **Literal hosts** are classified on `url.hostname`, which WHATWG `URL` has already normalized —
   decimal, hexadecimal and octal spellings all fold to canonical form, so spelling bypasses are a
   parsing problem the platform already solved.
3. **Named hosts** are resolved *inside* the connector; **every** returned address is classified,
   and the connection is pinned to the single address that was validated. There is no window
   between check and connect. This also closes Happy Eyeballs: `autoSelectFamily` defaults to true
   on Node 22, so returning a multi-address answer with only the first classified lets the runtime
   race to an unvalidated one.
4. **Policy is default-deny: an address is permitted only if its range classifies as `unicast`.**
   An unparseable address is a refusal, never a pass. This is what defeats 6to4 and NAT64, and it
   refuses ranges allocated in future until someone decides otherwise.
5. **The policy predicate is ours, not the library's.** The library supplies parsing and the range
   table; the allow decision is written here and fails closed by construction. Library predicates in
   this space commonly return "not private" for unparseable input, which is a wide-open door when
   called on a hostname.
6. **Redirects** are followed manually, bounded in count, each hop re-checked for scheme and
   re-connected through the connector.
7. **Bounds are ours**: content type checked on headers before the body is read; size counted on the
   **decompressed** stream rather than `Content-Length`; one deadline spanning the whole chain,
   translated into a typed refusal in both the header phase and the body phase. Every bound aborts
   the connection rather than merely rejecting a promise.
8. **Refusals carry a discriminable `code`.** Error identity does not survive the connector boundary
   — the transport rewraps it — and S5's criteria are per-reason, so a tag that survives is required
   rather than `instanceof`.
9. **`undici` is a direct dependency and the guard uses its own `fetch` export.** Node exposes
   `fetch` but no dispatcher, so there is no way to guard the platform's fetch without it; and
   dispatchers do not interoperate across undici majors, so binding to whatever Node bundles would
   make a routine runtime upgrade a security-relevant breaking change.
10. **The guard returns a typed result, not a `Response`.** Callers receive the validated bytes with
    their content type and final URL. This keeps the cross-major `instanceof` hazard out of the
    codebase and, more importantly, denies callers a raw stream that has not been through the bounds.
11. **The test-only seam that permits loopback is a constructor argument production never passes** —
    never an environment variable, never a default. S5's suite needs it, because a CI test server
    lives on `127.0.0.1` and is otherwise refused as the *allowed* leg of a redirect chain.

`ADR-0001` is not weakened by point 9. That record asks for Web-standard APIs *"wherever a standard
equivalent exists"*, and there is no standard equivalent for an egress policy hook. The module's API
surface remains `fetch`, `Request`, `Response` and `URL`.

## Consequences

### Positive

- DNS rebinding is closed **by construction** rather than by checking harder: one resolution, and
  the address classified is the address connected to.
- One chokepoint covers literal hosts, named hosts and every redirect hop, so there is no second
  path to keep in sync — and no second path to forget.
- Default-deny means an address family nobody anticipated is refused rather than admitted, which is
  the correct direction for a guard to be wrong in.
- The classification table — the part most likely to be got wrong by hand — comes from a
  single-file, MIT, zero-production-dependency library covering IPv6, IPv4-mapped IPv6 and
  carrier-grade NAT.
- All twelve of S5's criteria are satisfiable by this mechanism, and a deliberately permissive
  reference implementation fails the must-refuse set — so the suite discriminates rather than
  passing vacuously, which S5 requires of itself.
- Gate E's bounds half had to be ours regardless: no available library implements size, content-type
  or elapsed-time bounds.

### Negative

- **The guard is ours to maintain.** A new bypass class — a future address family, a new transfer
  encoding — is our bug, and the blast radius is the product's only network boundary.
- `undici` becomes a direct dependency, so this module is not built purely on platform APIs. The
  API surface is unchanged, but the claim "no dependency on the outbound path" is not available.
- Recovering a redirect target from a manual redirect is server-runtime behaviour; a browser returns
  an opaque redirect with no location. This module is the one place the codebase is not portable in
  the sense `ADR-0001` means. `PDR-0002` makes that acceptable; it does not make it untrue.
- Default-deny over-refuses a few genuinely routable reserved addresses. Acceptable for a recipe
  importer — but a future false-negative report should be recognised as this decision working, not
  as a defect.
- Every test of the *allowed* path needs the loopback seam, which is itself a security-relevant
  surface that must never be reachable in production.

### Neutral

- The connector is small — tens of lines, not a subsystem. `ipaddr.js` is a supply-chain entry, but
  a single file with no production dependencies.
- This record constrains extraction, the model boundary and image handling not at all. Indirect
  prompt injection and external-image handling remain S5 criteria answered elsewhere: the first is a
  property of the extraction prompt boundary under `ADR-0004`, the second of whether images are
  fetched at all.

## Alternatives considered

**Take an existing SSRF-guard package for the whole job.** The strongest candidate's architecture is
the one adopted here, and its core predicate is independently the same unicast test — convergent
evidence that the design is right. Rejected on three counts: it declares a Node engine above the one
`ADR-0001` pins; it depends on an undici major that cannot dispatch for the bundled fetch of that
runtime; and it implements none of the size, content-type or elapsed-time bounds, so four Gate E
criteria would still be ours. Worth revisiting if the runtime moves — the orchestration half would
then be a real candidate.

**Take an `http.Agent`-based filtering agent.** Rejected on a factual basis: Node's `fetch` does not
use `http.Agent`, so these cannot guard this code path at all — regardless of how good they are.

**Hand-write the address ranges, no library.** Rejected: this is where SSRF protection classically
fails, and the 6to4 and NAT64 cases show that even a careful enumeration misses embedded addresses.
The range table is the part with no upside to owning.

**Import a library's policy predicate as well as its parser.** Rejected: predicates in this space
commonly answer "not private" for unparseable input — safe inside their own flow, wide open when
called on a URL hostname, which is the obvious misuse. A guard's predicate must fail closed, so it
is ours.

**Pre-flight validation then an ordinary `fetch`.** Rejected: this is the TOCTOU pattern, and it was
reproduced — two DNS answers consumed, the second connected to. A pre-flight check is kept only as a
cheap early reject; the guarantee never rests on it.

**Guard with the socket `lookup` option rather than a connector.** Rejected: `lookup` does not fire
for IP-literal hosts, so the loopback address and its numeric spellings walk through. This is the
published advisory class named in the Context.

**Platform-level egress isolation.** Unavailable under `PDR-0002` and not shippable. It remains
worthwhile as defence in depth for an operator whose infrastructure offers it, and the documentation
should say so — but it cannot be the guarantee.

## What would falsify this decision

- **Node or undici ships a supported egress policy for `fetch`.** A first-party hook would make the
  connector redundant and this record should be superseded.
- **The classification library stops being maintained, or a range-classification advisory is filed
  against it.** The classification half would move in-repo against the registries; the orchestration
  would be unaffected.
- **A bypass passes a green S5 suite.** Any address form reaching a non-public destination through a
  passing suite falsifies the unicast policy, not merely the test.
- **The runtime moves to a newer Node.** The whole-package alternative becomes eligible and its
  orchestration half is worth re-testing against — with the bounds still ours.
- **A second fetch surface appears** — external images, oEmbed, favicons. It must route through this
  module. A second outbound path that does not is the failure this record most expects.

## Note on verification

The three bypasses in the Context, the connector behaviour, the multi-address race, the
decompression bound and the suite's discrimination were each reproduced by execution on the pinned
runtime before this record was written. The classification library's version, licence, publication
date and zero-dependency status were confirmed against the registry.

The advisory referenced in the Context was **not** independently retrievable from the environment
where this record was written, so no identifier is cited: the mechanism it describes is what this
record relies on, and that mechanism was reproduced directly. The patched line of the affected
package was confirmed from the registry.
