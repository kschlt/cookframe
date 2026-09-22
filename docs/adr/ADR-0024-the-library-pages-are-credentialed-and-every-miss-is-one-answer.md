---
id: "ADR-0024"
title: "The library pages are credentialed with their own secret, and every miss is one answer"
status: accepted
date: 2026-09-22
tags: ["http", "credentials", "privacy", "hosting"]
constrained_by: ["PDR-0001", "PDR-0002", "PDR-0003", "ADR-0011", "ADR-0016"]
related_to: ["ADR-0007", "ADR-0021"]
---

## Context

Slice 2 rendered the library listing and the recipe page. Nineteen pull requests later both were
still reachable from no HTTP path at all: `renderLibraryPage` and `renderRecipePage` were called by
the render barrel and by their own tests and by nothing else. `CFV1-RUN` gave the instance a
process, and giving it a process meant giving those two pages their first addresses.

An address is not wiring. Three questions arrive with it that no earlier unit had to answer, and
answering them halfway through the building — which is where they surface if nobody writes them
down — is the worst moment for a question about what the operator's private library is.

The owner stated the boundary himself while researching hosting: a visitor who has the public
address Bring fetches must not thereby be able to read his library or trigger paid imports. So the
default shape this would have drifted into — everything on one open port, because nothing said
otherwise — is ruled out before it is built.

Two constraints already in force pull in opposite directions, and that tension is the whole
decision:

- `ADR-0011` and `ADR-0017` make the per-recipe capability URL **public by design**. Bring fetches
  it server-side and cannot authenticate; the token in the path is the authority.
- `PDR-0003` scopes the phone's ingest credential to "submitting a capture to that one instance, and
  to nothing else", says it "grants no access to the library beyond submission", and records as a
  consequence that "losing the device does not expose the library".

So the same process must serve one surface that is public and another that is private, and the
private one may not be unlocked by the secret on the phone.

## Decision

**1. The library and recipe pages require an instance credential, and it is NOT the ingest
credential.** The instance is configured with two distinct secrets over one mechanism
(`src/http/instance-credential.ts`): `COOKFRAME_INGEST_CREDENTIAL` for the Shortcut and
`COOKFRAME_LIBRARY_CREDENTIAL` for the pages. Configuring one value into both is refused at startup,
by name, because every route still behaves correctly in that case and nothing else in the system
would ever report it.

**2. The capability URLs stay reachable with no credential.** They are unchanged by this record;
their security is the token, not the network (`ADR-0016`, `ADR-0011`).

**3. There is no `401` anywhere on the pages.** A caller without the library credential receives the
byte-identical response a caller receives for a recipe that does not exist, for a path that is not
an address, and for a capability token that was never issued: one status, one body, one content
type, from one definition in `src/http/not-found.ts`.

**4. A browser-friendly sign-in is explicitly not decided here.** A login, a session and a cookie
are outside this unit, and the multi-user library `ADR-0011` left open is a separate question.

## Consequences

### Positive

- `PDR-0003`'s consequence stays true rather than becoming aspirational: losing the phone costs
  submission to one instance and nothing else. A one-secret instance would have made that sentence
  false while passing every functional test.
- The enumeration oracle `ADR-0016` closed for tokens is not reopened from the other side. A `401`
  on a recipe page that exists, paired with a `404` on one that does not, tells anyone who has never
  held a credential exactly which recipe ids this library holds. `ADR-0021` equalized the serving
  route's misses for this reason; extending the same answer to the pages is the same decision
  applied to the private library rather than to a single shared recipe.
- The two surfaces' opposite rules are stated in one place, so the reader who wonders why one route
  is open and the next is not finds the answer where the routes are.

### Negative

- **An operator who forgets their credential is told "Not Found", not "you need a credential."** A
  response that explains itself is a response that confirms the address exists, and nothing can be
  both. This is the cost, it is real, and it is the reason someone will eventually propose changing
  it.
- **A browser cannot send a bearer token by itself.** Reading one's own library today means a client
  that sets a header. That is a genuine usability gap, registered as an open question rather than
  solved by reflex, because every obvious fix (a cookie, a session, a query parameter) is a
  credential in a new place with a new lifetime.
- The operator now has two secrets to configure instead of one, and a start-up refusal if they paste
  the same value twice.

### Neutral

- The pages send `cache-control: no-store`, for the reason the capability route does: a cache
  between the origin and the reader outlives whatever made the response private.

## Alternatives considered

**One instance credential for both surfaces.** Rejected: it is one line shorter and contradicts an
accepted record. `PDR-0003`'s scoping clause and its "losing the device does not expose the library"
consequence would both be false, and no test of the routes' behaviour would ever say so.

**`401` on the pages, `404` for absent recipes.** Rejected: it is the conventional answer and it is
the oracle. The pair distinguishes "exists but forbidden" from "does not exist" for a caller holding
nothing, which is precisely what `ADR-0016` and `ADR-0021` spent two records closing for tokens.

**Leave the pages unauthenticated and rely on the instance being unlisted.** Rejected on the same
ground `PDR-0003` rejected an unguarded ingest endpoint: an unguessable address is a capability, and
the self-hosting principles are explicit that a capability must be one that was decided, not one
that happens to hold.

**A login and a session, so a browser can read the library.** Deferred, not rejected. It is the
right answer to the usability gap and it is a credential model of its own — `PDR-0002` keeps the
instance single-user and `ADR-0011` leaves the multi-user library open, so this belongs to the unit
that decides both, not to the one that first gave the page an address.
