---
id: "ADR-0016"
title: "The capability URL for the shopping handoff: one recipe, secret in the path, permanent-but-revocable"
status: accepted
date: 2026-09-21
tags: ["security", "capability-url", "shopping", "bring"]
decides: ["OQ-17"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0010", "ADR-0007"]
---

## Context

Slice 3 hands a saved recipe to a third party. Bring imports a recipe by fetching a URL
**server-side from its own infrastructure** (`api.getbring.com/rest/bringrecipes/parser?url=…`;
S3 findings), so Cookframe must expose a recipe at a URL a third party can reach without the
user's session. That URL is a bearer credential: whoever holds it can fetch the recipe. The
question OQ-17 left open was its exact format, lifetime and revocation mechanism.

Two spike findings constrain the design, and they pull in different directions:

- **S3 Q6 — Bring retains the URL and re-fetches it.** Bring echoes the source URL back as
  `linkOutUrl` and may re-fetch it later, server-side. So the credential is not single-use from
  Bring's side; it is a *retained* bearer token. A lifetime that lapses on its own would break a
  link Bring legitimately kept.
- **S3 Q6 — a query token's survival is host-dependent.** Bring forwards the URL as given and
  does not itself preserve or strip a query string; whether a `?token=…` survives depends
  entirely on the host. A secret in the query string is therefore unreliable as well as more
  exposure-prone (query strings leak into logs and referrers).
- **S3 Q7 (device-confirmed) — a Bring-side share does NOT propagate the URL.** When a user
  shares an imported recipe from within Bring, Bring re-uploads the recipe to its own template
  store and shares an internal id; the source/capability URL is not handed to the recipient. So
  downstream forwarding is not the threat the token must survive; Bring's own *retention* is.

The credential must therefore be designed on the assumption that it leaves the user's device
(it reaches Bring's servers and is retained there), while not assuming it is forwarded further.

## Decision

Cookframe issues a **capability URL** that carries a single opaque secret in its **path**, and
that secret is a bearer capability with exactly the following properties:

1. **One recipe per token.** A token resolves to exactly one recipe and grants nothing else.
   There is no operation that turns a token into another recipe, another token, or a listing —
   the issuing store exposes no enumeration. Possession off-device grants no ambient authority
   beyond that one recipe.
2. **Secret in the path, never the query.** The token is a URL path segment
   (`/r/<token>`), because a query token's survival through Bring is host-dependent (S3 Q6) and
   query strings are more prone to logging and referrer leakage. The token is a base64url string,
   which is path-safe by construction and needs no escaping.
3. **Format: 256 bits of CSPRNG randomness, base64url.** A 32-byte random value encoded as
   base64url (43 characters, no padding). This is unguessable — enumeration of the space is
   infeasible — which is what lets a path segment carry authority safely.
4. **Lifetime: permanent-but-revocable.** The token has **no expiry**. It resolves indefinitely
   until it is revoked, and revocation is its only end. This follows directly from S3 Q6: Bring
   retains the URL and may re-fetch it, so an auto-expiring token would break a legitimately
   retained link. Revocation is the deliberate kill switch for a link the user believes is
   exposed.
5. **Revocation is a hard stop and leaks nothing.** A revoked token resolves to nothing, and a
   revoked token is indistinguishable from one that was never issued (both resolve to "not
   found"), so probing reveals no state. Revoked secrets are retained as revoked (not deleted),
   so a secret can never be re-minted onto a different recipe.

The token model — issue / resolve / revoke behind a store interface, with the secret minted
through an injected minter (CSPRNG in production) — is implemented in `src/shopping/`. This
record fixes the contract; the HTTP route that serves a recipe at `/r/<token>` is a separate
unit built on the framework of ADR-0007.

## Consequences

- A capability URL is safe to place where Bring will retain it, because its authority is scoped
  to one recipe and can be withdrawn at any time. If a user believes a link is exposed, revoking
  it is sufficient and complete; no other link or recipe is affected.
- Because the token never expires on its own, a store of issued tokens grows until tokens are
  revoked; revoked tokens are retained (as revoked) rather than evicted. This is acceptable for
  V1's scale and keeps re-minting impossible; a durable store with its own retention policy is a
  later concern (it does not change this contract).
- The recipe reachable at a capability URL is the Schema.org mapping of the Canonical Recipe
  (the deterministic, omit-never-invent mapping), so the third party never sees a fabricated
  quantity or author regardless of how it fetches.

## Why this supersedes neither ADR-0010 nor ADR-0013

A capability URL is a **third kind of boundary**, distinct from the two egress-adjacent records,
and it neither supersedes nor is superseded by either:

- **ADR-0010** guards traffic **inbound to a fetch Cookframe itself makes** — the safe-fetch
  connector for ingesting attacker-influenced *source* URLs. Its concern is that *Cookframe's own
  outbound fetch* cannot be turned against the instance's network position. A capability URL is
  not something Cookframe fetches; it is an address Cookframe *issues* for someone else to fetch.
  Different direction, different threat, no overlap.
- **ADR-0013** governs Cookframe's **outbound calls to the model provider** (model egress). A
  capability URL involves no model call and no provider. Different subsystem entirely.

The capability URL is an address **Cookframe issues, that is publicly reachable, and that a third
party fetches server-side**. Neither of the other records decides anything about issuing such an
address, its scope, or its revocation, so this record stands alongside them rather than replacing
either.

## Alternatives considered

- **Auto-expiring token (TTL).** Rejected on the S3 Q6 evidence: Bring retains the URL and may
  re-fetch it after any fixed window, so a TTL would break legitimate later imports while adding
  little — the exposure risk is retention, which revocation addresses directly and precisely.
- **Secret in the query string.** Rejected: its survival through Bring is host-dependent (S3 Q6),
  and query strings leak more readily into logs and referrers. The path placement is both more
  reliable and less exposure-prone.
- **A shorter or human-readable token.** Rejected: a bearer credential on a public address must
  be infeasible to enumerate; 256 bits of CSPRNG output is the floor, and readability is not a
  goal for a secret.
- **One token per recipe, reused.** Not adopted as a constraint: issuing a fresh token per grant
  (and allowing more than one live token for the same recipe) lets a user revoke one exposed link
  without invalidating another they still rely on. The invariant that matters is one-recipe-*per
  token*, not one-token-per-recipe.
