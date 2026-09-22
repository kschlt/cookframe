# Architectural Decision Records

How Cookframe is built: runtime, language, persistence, boundaries, mechanisms.

Decisions about *what the product is* go in [`../product-decisions/`](../product-decisions/) instead.

## Format

One file per decision, `ADR-NNNN-short-title.md`. The format itself — the front-matter keys a record
may carry, the `status` values, the section structure, and the never-rewritten supersession rule — is
defined by [ADR-0020](ADR-0020-decision-record-format-is-declared-once-and-checked.md) (which
supersedes ADR-0006). That record holds the single machine-readable key list; this README does not
repeat it, so there is exactly one definition to keep current, and a drift check fails the build if a
record and the declaration disagree.

A number belongs to one record. The filename and the record's own `id` must agree, and no second
file may claim a number already taken — `tests/records/` fails the build when either is broken, and
reports a citation that points at a number nothing defines. It checks definitions, never mentions:
records cite each other freely, and only a *claim* on a number has to be unique.

## Records

<!-- index:start -->
Until an index is generated here, the file listing above is the index.
<!-- index:end -->
