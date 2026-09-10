# Product Decision Records

What Cookframe is and does: scope, semantics, invariants, posture.

Decisions about *how it is built* go in [`../adr/`](../adr/) instead.

## Format

Identical to the architectural records, with `PDR-NNNN` ids:

- One file per decision, `PDR-NNNN-short-title.md`.
- Front matter: `id`, `title`, `status`, `date`. Optionally `tags`, `supersedes`, `superseded_by`,
  `depends_on`, `related_to`.
- `status` is one of `proposed`, `accepted`, `superseded`, `deprecated`.
- Sections: `## Context`, `## Decision`, `## Consequences`.
- **An accepted record is never rewritten.** A decision changes by a new record that supersedes it,
  with `supersedes` and `superseded_by` set on both sides.

The decisions fixed during discovery are adopted as a whole by `PDR-0001` rather than restated as
individual records. One gets its own record when it is actually revised.

## Records

<!-- index:start -->
Until an index is generated here, the file listing above is the index.
<!-- index:end -->
