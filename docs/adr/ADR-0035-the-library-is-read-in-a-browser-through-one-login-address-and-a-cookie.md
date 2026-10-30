---
id: "ADR-0035"
title: "The library is read in a browser through one login address and a cookie"
status: proposed
date: 2026-10-30
tags: ["http", "credentials", "privacy", "browser"]
decides: ["OQ-42"]
constrained_by: ["PDR-0002", "ADR-0024"]
related_to: ["ADR-0011", "ADR-0016", "ADR-0021"]
---

## Context

`ADR-0024` credentials the library and recipe pages with a bearer secret and answers every miss with
one byte-identical `404`. Its fourth decision left a browser-friendly sign-in explicitly undecided
(`OQ-42`): a browser sends no bearer token on its own, so an operator opening their own library
gets "Not Found". The obvious fixes each move the secret somewhere new: a query parameter puts it in
logs and history, basic auth reopens the "this address exists" answer, and a cookie needs a session.

On 2026-10-30 Kornelius decided on a login page with a cookie. This record is a **proposal** that
extends `ADR-0024` decision 4 (that record is not rewritten); it is built by the item
`ALP`.

## Decision

**One fixed login address takes the library credential from a form and answers with a cookie;
every other address behaves as `ADR-0024` says.**

1. A single fixed path serves a login form and accepts the library credential
   (`COOKFRAME_LIBRARY_CREDENTIAL`) by `POST`. This is the one address that is allowed to exist for
   a caller without a credential.
2. A correct credential sets a session cookie for the single operator, valid about 30 days.
   There is no user table: the instance stays single-user (`PDR-0002`).
3. The library and recipe pages accept either the bearer header or that cookie. A caller with
   neither still receives the byte-identical `404` of `ADR-0024` decision 3; there is still no `401`
   on any page.
4. The cookie is `HttpOnly`, `Secure`, `SameSite` (Strict or Lax, chosen where the item measures
   what the form flow needs), scoped to the path it serves, and carries a value derived from the
   credential that is not the credential itself.
5. The login address is rate-limited per client, and a wrong credential answers with the form again
   and no detail beyond that.
6. The credential, submitted or stored, never appears in a log line, an error, or a response.
7. A way to end the session exists; changing the library credential invalidates every cookie.

The capability URLs (`ADR-0016`) and the ingest credential are not touched.

## Consequences

### Positive

- The operator reads their library in a browser with a credential they type once per 30 days.
- No new place for a secret that logs or history keep.

### Negative

- The login address is an address that answers a caller with no credential, so the "every unknown
  thing answers identically" property no longer holds for exactly one path. That path reveals only
  that a login exists. The item must state this in the proof that guards `ADR-0024` decision 3.
- A cookie is a new credential with a lifetime; stealing it grants the library for up to 30 days.
  Derivation from the credential with a rotating secret, and an end-session path, bound this.
- A cross-site form post against the login address is possible; `SameSite` and an origin check on
  the `POST` are part of the item.
