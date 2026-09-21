---
id: "ADR-0017"
title: "Bring integration is a server-side pull of a Schema.org/Recipe page at the capability URL"
status: accepted
date: 2026-09-21
tags: ["bring", "shopping", "integration", "schema-org"]
decides: ["OQ-18"]
depends_on: ["ADR-0016"]
related_to: ["ADR-0007", "ADR-0010"]
---

## Context

Slice 3 hands a saved recipe to Bring. OQ-18 left open the exact integration mechanism until
the compatibility spike (`spikes/bring-compat/`) had observed how Bring actually imports a
recipe. The spike is now complete on its API half (Q1–Q6 recorded) with the privacy question
(Q7) device-confirmed, so the mechanism is no longer open — it is observed.

What the spike established:

- **Bring imports by fetching a URL server-side.** Import opens a deep link whose payload calls
  `https://api.getbring.com/rest/bringrecipes/parser?url=<recipe url>`; that endpoint fetches
  `<recipe url>` **from Bring's own infrastructure** and parses the page's Schema.org/Recipe
  JSON-LD (`public-url-requirement.md`, `findings.md` Q1–Q6). There is no push API, no partner
  credential, no OAuth: the integration is a pull, and its entire surface is a URL Bring can
  reach over the public internet without the user's session.
- **That URL is a retained bearer credential.** Bring echoes the source URL back as `linkOutUrl`
  and may re-fetch it later (Q6). A Bring-side share does **not** propagate it — a share
  re-uploads the recipe to Bring's own template store and points at an internal id (Q7,
  device-confirmed) — so the threat the credential must survive is Bring's own *retention*, not
  downstream forwarding.
- **Bring parses the source wording as written, and is lossy in recorded ways** (Q2–Q5): it
  splits one ingredient per non-empty line into a leading quantity/unit and a name, folds
  comma-qualifiers into the quantity field, keeps ranges written with a dash but mis-splits the
  word "bis"/"to", never fabricates a missing author, silently discards all but the first
  `recipeYield`, and does not validate an image URL.

Two prior records already fix the pieces this mechanism rests on: the capability URL itself
(ADR-0016 — one recipe, secret in the path, permanent-but-revocable) and the HTTP framework the
serving route is built on (ADR-0007). This record fixes how they compose into the Bring handoff.

## Decision

**Cookframe integrates with Bring by exposing each saved recipe as a Schema.org/Recipe page at
its capability URL (ADR-0016), which Bring fetches server-side and parses. The integration is a
pull with no other coupling — no Bring API, credential, or push.**

1. **The representation is the deterministic omit-never-invent Schema.org mapping.** The page
   Bring fetches carries the Canonical Recipe's Schema.org/Recipe mapping (the CFV1-SL3 mapping
   unit) verbatim. A number reaches a numeric field only when the source expressed it exactly;
   every other quantity and duration is omitted with its source wording preserved. So Bring —
   which cannot tell a coerced number from a real one — never receives a fabricated quantity or
   author regardless of how it parses.
2. **Ingredient and instruction wording is passed through as written, never reformatted for
   Bring's parser.** Reconstructing a line from a parsed quantity to suit Bring's split would
   risk coercing a range or a qualitative amount into a shape the source never had — the same
   fabrication point (1) forbids. Bring parses verbatim lines faithfully within its recorded
   limits (Q2/Q3), so the source wording is what is served.
3. **One canonical yield is the base.** Bring adopts the first `recipeYield` and silently
   discards the rest (Q4), so the mapping's yield order is significant: the intended base yield
   is emitted first. Scaling in Bring is linear from that base; nothing here depends on Bring
   scaling a range or a qualitative yield (those carry no number to scale, by (1)).
4. **The image field is omitted unless a reachable URL is known.** Bring does not validate an
   image URL and echoes a dead one with an invented size (Q5), so an unknown or unreachable
   image is left out rather than sent. (V1 sends no image; this fixes the rule for when it does.)
5. **The capability URL's lifetime and revocation are ADR-0016's**, chosen precisely for Bring's
   retention: the token never expires on its own (an auto-expiry would break a link Bring
   legitimately kept) and revocation is the only end.

The serving route that answers `GET` at the capability path with this page is the implementing
unit, built on ADR-0007; this record fixes the mechanism, not the route's code.

## Consequences

- The Bring handoff has a single, observable contract: the Schema.org/Recipe page served at the
  capability URL. A regression in Bring's parser, or in the mapping, is caught by pinning the
  mapping's output against the spike's recorded parser behaviour (`bring-fixtures-green`) rather
  than by a live call to Bring.
- Vague and ranged amounts round-trip to Bring as text and are **not** numerically scalable
  there. This is the accepted cost of never fabricating a number: the user sees the true wording
  in Bring, and only exactly-expressed quantities scale. Resolving a vague amount before export
  is a later product choice, not a mechanism change.
- Because the integration is nothing but a publicly-fetchable URL, driving a Bring import
  requires a public surface for the recipe for the duration of the import (this couples to OQ-05,
  hosting; it does not decide it). A purely local instance with no public surface cannot drive a
  Bring import on its own — stated here as a constraint the hosting decision consumes.
- No Bring credential or secret is stored, because none exists in the mechanism. The only secret
  is the capability token, governed by ADR-0016.

## Why this is not ADR-0010's concern

ADR-0010 guards a fetch **Cookframe itself makes** (ingesting an attacker-influenced source URL);
the Bring handoff is a fetch **Bring makes** of an address Cookframe issues. Different direction,
different actor. The spike noted the symmetry — Bring rejects loopback and RFC-1918 when it is
the fetcher, as Cookframe's own guard must — but that is a confirmation of ADR-0010's posture,
not a change to it.

## Alternatives considered

- **A Bring partner/push API.** Not available: the spike observed only the server-side pull of a
  URL; there is no push or authenticated partner surface to target. The pull is the mechanism,
  not a choice among several.
- **Reformatting ingredient lines to Bring's preferred `"<qty> <unit> <name>"` shape.** Rejected
  as the default: reformatting a parsed quantity risks coercing a range or qualitative amount
  (the fabrication the mapping exists to prevent). Bring parses verbatim source lines faithfully
  within its recorded limits, so the source wording is served as-is; shaping source wording at
  capture time is a separate concern, upstream of this handoff.
- **Embedding a derived number for a ranged or vague amount so Bring can scale it.** Rejected:
  it is exactly the coercion PDR-0001 and the mapping forbid — a number the user never wrote,
  invisible to them, handed to a third party.
- **A secret in the query string instead of the path.** Rejected by ADR-0016 on the spike's Q6
  evidence (a query token's survival through Bring is host-dependent); recorded there, not
  re-decided here.
