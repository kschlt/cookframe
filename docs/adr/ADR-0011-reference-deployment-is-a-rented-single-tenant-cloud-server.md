---
id: "ADR-0011"
title: "Reference deployment: a rented single-tenant cloud server with its own domain"
status: proposed
date: 2026-09-18
tags: ["hosting", "deployment", "bring"]
constrained_by: ["PDR-0002"]
related_to: ["ADR-0001", "ADR-0010"]
decides: ["OQ-05"]
---

## Context

`ADR-0001` deliberately left the hosting target open as `OQ-05`, pending measured evidence from
the Bring compatibility spike (`CFV1-S3`). That evidence now exists
(`spikes/bring-compat/public-url-requirement.md`, `findings.md`):

- **Bring requires a publicly fetchable URL.** Bring imports a recipe by having *its own servers*
  fetch the recipe URL. A URL reachable only from a device or a private network is rejected;
  loopback, RFC-1918 and an auth-required URL all failed, a public URL succeeded. HTTP was
  accepted too, so the hard requirement is public reachability from Bring's servers, with HTTPS
  the sensible default.
- **The URL is a retained capability.** Bring keeps the source URL (surfaced as an "Öffne
  Website" button), so it must be treated as a bearer capability Bring itself retains.
- **A Bring-side share does not propagate it.** Sharing an imported recipe re-uploads it to
  Bring's own template store and shares a Bring-internal id; the recipient never receives the
  source URL. Exposure is bounded to Bring, not to arbitrary third parties.

`PDR-0002` fixes the reference deployment as **operator-controlled and single-user**. The operator
does not run a home server: the intended deployment is a server the operator **rents** (a small,
inexpensive cloud instance). That removes the concern that shaped the earlier discussion — there
is no home network to expose — and makes a plain public endpoint on a controlled server the
natural shape rather than a workaround for a closed home instance.

## Decision

The V1 reference deployment is a **single-tenant instance on an operator-rented cloud server** (a
small VPS) with its **own domain** and a standard public HTTPS endpoint (TLS via the platform or
Let's Encrypt).

- The recipe **capability URLs Bring fetches are served directly from that public endpoint.** They
  carry their secret in the URL **path** (not the query — S3 found a query token can break the
  fetch), and are made **single-recipe and revocable** at the application layer by Slice 3
  (`OQ-17`). Security is bounded by the capability token, not by the network.
- **No home-server exposure, no reverse tunnel, and no separate relay.** Those exist to keep a
  private or home instance closed; with a rented, operator-controlled server there is nothing to
  tunnel out of.
- The **own domain is the durable decision**; the specific rented host is an operational choice
  that can change without changing the domain or the capability-URL contract.

A future **authenticated, possibly multi-user library UI** — an operator's private view of "my
recipes", separating one user's library from another's — is explicitly **left open, not
foreclosed**. It would coexist on the same domain, kept architecturally separate from the
unauthenticated per-recipe capability endpoints (Bring cannot authenticate). Because it would
serve more than one user, it extends beyond `PDR-0002`'s single-user posture and is therefore a
**separate future decision**, not settled here.

## Consequences

### Positive

- Simple and standard: a public HTTPS endpoint on a controlled server, no bespoke exposure
  machinery.
- Bring import works, because the endpoint is publicly fetchable by Bring's servers — the one hard
  requirement S3 established.
- The own domain is a stable, portable asset; the rented host underneath can be swapped.
- The capability model (single-recipe, revocable, secret-in-path) bounds exposure at the
  application layer, which is where S3's evidence says the risk actually lives.
- Leaves room for a later authenticated library without committing to it now.

### Negative

- An always-on rented server has a continuous public attack surface. Mitigated by a narrow served
  surface, standard hardening, and per-recipe capability scoping — not by hiding the server.
- A recurring hosting cost, accepted as the price of Bring compatibility (which requires public
  reachability regardless of host).
- Single-user for now; a multi-user future needs its own decision (auth, tenancy, data isolation).

## Alternatives considered

- **Home server behind a reverse tunnel (Cloudflare Tunnel / Tailscale Funnel).** Rejected: it
  solves home-network exposure, a problem this operator does not have. It would add a tunnel-
  provider dependency for no benefit over a rented public endpoint.
- **Ephemeral, per-import public exposure.** Rejected as the deployment shape: on an always-on
  controlled server it is unnecessary, and per-recipe security is already provided by Slice 3's
  revocable single-recipe capability URL at the application layer.
- **A hosted relay the instance pushes to.** Rejected: it introduces a separate service to run and
  trust, against the minimal-moving-parts design (`kschlt/cookframe-aos` is already the only extra
  repository, and no separate state or relay service is wanted).
