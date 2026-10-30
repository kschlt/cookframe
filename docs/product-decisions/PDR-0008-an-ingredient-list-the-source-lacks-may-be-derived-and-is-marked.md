---
id: "PDR-0008"
title: "An ingredient list the source lacks may be derived from the method, and is marked as derived"
status: accepted
date: 2026-10-30
tags: ["capture", "normalization", "provenance", "omission", "product"]
decides: ["OQ-40"]
related_to: ["PDR-0005", "PDR-0001"]
---

## Context

`PDR-0005` decided that a required field the source does not supply stays empty and says so. It
left one sibling open on purpose. The real-photograph run (`spikes/s1-photo-gate/VERDICT.md`,
finding 2) derived a complete ingredient list from method prose on a handwritten card that had
none. Nothing was invented, every item was named in the method, but the capture prompt says "do not
add" and the omit-never-invent rule points the same way, while a cook shopping for the recipe
plainly wants the list. That was registered as `OQ-40`.

An empty `ingredientGroups` is already expressible, so the question was never whether the field can
say nothing. It was whether derivation is permitted and how it would be marked.

On 2026-10-30 Kornelius decided: a list the source lacks may be derived from the method text, but
it must be visibly marked as derived, and not presented as the source's own.

## Decision

**Derivation is permitted; unmarked derivation is not.**

- An ingredient list that comes from the method text rather than from an ingredient list in the
  source carries an explicit **derived** state in the Canonical Recipe, with provenance pointing at
  the method passages it was read from. It is never stored in the shape of a source-supplied list.
- The mark is visible wherever the list is shown: the recipe view says the list was derived from
  the method, and does not show it as "from the source".
- The Bring export still serves the list (a shopping handoff is the reason to derive it) but
  carries the same marking in what it exposes, to the extent the exported format allows.
- Only what the method names may be derived. Quantities the method does not give stay absent;
  `PDR-0005`'s and the shopping mapping's omit-never-invent rule is unchanged.
- A source that has an ingredient list is not affected: the source's list wins and nothing is
  derived beside it.

The change is a contract change (a Canonical field and its provenance), so it is built as its own
item; this record does not build it.

## Consequences

### Positive

- The cook gets a usable list from a card that has none, and can always tell it is not the source's.
- The marking reuses the declared-state shape of `PDR-0005` rather than inventing a second one.

### Negative

- Every consumer of the ingredient list (view, shopping export, scaling) must handle the derived
  state; a consumer that ignores it presents derived data as the source's. A proof per consumer is
  part of the item.
- Verification cannot check a derived list against an ingredient block that does not exist; it
  checks it against the method passages it cites.
