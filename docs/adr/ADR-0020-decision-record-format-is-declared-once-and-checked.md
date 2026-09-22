---
id: "ADR-0020"
title: "Decision-record format: declared once, machine-checked against use"
status: accepted
date: 2026-09-21
tags: ["decisions", "documentation"]
constrained_by: ["PDR-0001"]
supersedes: ["ADR-0006"]
---

## Context

[ADR-0006](ADR-0006-decision-record-format.md) fixed the record format and listed the front-matter
keys a record may carry. It declared that list in prose, and the directory
[README](README.md) repeated it. Prose drifts silently: `constrained_by` came into use across the
tree — 16 records carry it, ADR-0006 among them — while neither declaration ever named it. The
format's definition was stale for as long as the key was in use, and nothing noticed.

The format record is the one kind of record that goes out of date through ordinary use rather than
through a change of mind. A superseding record is the tool the format gives for a decision that
changed; there was no tool for a declaration that a later, unrelated record quietly outgrew.

The obvious repair — a line in the README mirroring the format — was tried on a branch and taken
back, because it makes things worse: the README and the accepted record then state two formats, and
nothing says which governs. Whoever wants to know whether their front matter is valid gets a
different answer depending on which file they open, and neither announces that the other exists.

The project's own rule closes the easy exit. An accepted record is never rewritten; a decision
changes by a new record that supersedes it. That rule is right and is not the problem — the problem
is that no mechanism kept the declaration and the records from diverging.

## Decision

Supersede ADR-0006 with this record, which names the format as it is actually practiced and adds a
check that keeps the declaration and the records from drifting apart again.

- **One definition of the key list, here.** The block below is the single machine-readable
  declaration of the front-matter keys a record may carry. The README references this record instead
  of repeating the list, so there is exactly one place that says what the format is.
- **A drift check fails the build in both directions.** A record carrying a key this record does not
  declare fails; a declared `required` or `optional` key that no record uses fails as a *stale
  declaration*. The first direction is the error that happened; the second is its mirror, and only
  checking both prevents the next drift.
- **"Declared but unused" means stale, not reserved — unless the record says reserved.** A key kept
  ahead of a use that does not exist yet (for a coming supersession, say) is legitimate, but it must
  declare itself by sitting in `reserved`, where the stale check exempts it. Reading an unused key as
  reserved-by-default would blunt the check and leave open exactly the direction this item exists to
  close; so the default is stale, and reservation is a deliberate, recorded act. There are no
  reserved keys today.

Everything ADR-0006 decided about the format otherwise stands: one file per decision, the two
directories, the section structure, the never-rewritten rule with `supersedes`/`superseded_by` on
both sides, and no hand-committed index. This record changes none of that; it makes the key
declaration single and enforced.

The keys, unchanged in meaning from ADR-0006 with `constrained_by` now named:

- `required` — every record carries these: `id`, `title`, `status`, `date`.
- `optional` — `tags`; `constrained_by` for the product invariant an architectural decision is bound
  by; `depends_on`; `related_to`; `decides` for the open question a record closes; and
  `supersedes` / `superseded_by` for a supersession, set on both sides.
- `status` is one of `proposed`, `accepted`, `superseded`, `deprecated`.

<!-- format-keys:start -->
```yaml
# The single machine-readable declaration of the record front-matter keys.
# The drift check (tests/unit/adr-format.test.ts) parses this block; the README
# references this record rather than repeating it. required/optional keys must
# each be used by at least one record — a declared-but-unused key is stale and
# fails the build. A key reserved ahead of its first use goes under `reserved`,
# which the stale check exempts; there are none today.
required:
  - id
  - title
  - status
  - date
optional:
  - tags
  - constrained_by
  - depends_on
  - related_to
  - decides
  - supersedes
  - superseded_by
reserved: []
```
<!-- format-keys:end -->

## Consequences

### Positive

- The declaration cannot silently fall behind the records again: a new key in either the records or
  the declaration, without the other, fails the build.
- There is one definition of the format. A reader who wants the current key list has one place to
  look, and the README points there.
- The check is a pure function over loaded data with path-based loaders, so it can be aimed at the
  product-decision records (`docs/product-decisions/`, where the same drift is possible) without
  being rewritten. Doing so is out of this item's scope.

### Negative

- The one definition is a fenced block inside a Markdown record, so the check parses a region out of
  prose. The markers make that unambiguous, but it is not front matter and a schema tool would not
  validate it.
- Reserving a key is now a deliberate act with a recorded reason, rather than something an unused
  declaration expresses by default. That is the intended cost of the sharp direction.

## Alternatives considered

**Edit ADR-0006 to add the missing key.** Rejected: an accepted record is never rewritten. The
format record is superseded like any other, and stays readable in place.

**A line in the README that mirrors the format.** Rejected: that is the two-definitions state this
item removes. The README references the record instead.

**Read an unused declared key as reserved by default.** Rejected: it blunts the check and leaves the
stale-declaration direction — the mirror of the error that occurred — unguarded. Reservation is
explicit instead.

**A JSON Schema or a front-matter validation library.** Rejected: more machinery than the problem
needs. A list of key names and set arithmetic is the smallest thing that fails on drift.
