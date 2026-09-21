# Architectural Decision Records

How Cookframe is built: runtime, language, persistence, boundaries, mechanisms.

Decisions about *what the product is* go in [`../product-decisions/`](../product-decisions/) instead.

## Format

- One file per decision, `ADR-NNNN-short-title.md`.
- Front matter: `id`, `title`, `status`, `date`. Optionally `tags`, `supersedes`, `superseded_by`,
  `depends_on`, `constrained_by`, `related_to`, and `decides` for the
  [open question](../open-questions.md) it closes.
- `status` is one of `proposed`, `accepted`, `superseded`, `deprecated`.
- Sections: `## Context`, `## Decision`, `## Consequences`. Add `## Alternatives considered` where
  the rejected options matter.
- **An accepted record is never rewritten.** A decision changes by a new record that supersedes it,
  with `supersedes` and `superseded_by` set on both sides.

## Records

<!-- index:start -->
Until an index is generated here, the file listing above is the index.
<!-- index:end -->
