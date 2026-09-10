---
id: "PDR-0001"
title: "Adopt the discovery baseline as Cookframe's founding product decisions"
status: accepted
date: 2026-09-10
tags: ["baseline", "product", "invariants", "discovery"]
---

## Context

Cookframe's pre-implementation discovery produced a product and architecture baseline, published as
this repository's first commit. Its decision log records 49 product decisions already fixed, as flat
bullets in one document with no identifiers and no lifecycle.

Those decisions need to become citable and supersedable — architectural records must be able to name
the product invariant that binds them — without churning a just-published document, and without
pretending that 49 separate records were each deliberated as records.

## Decision

Adopt the fixed product decisions in
[`../decisions-and-open-questions.md`](../decisions-and-open-questions.md) §1 wholesale as
Cookframe's founding product decisions, by reference rather than by copy.

That document is frozen as the historical discovery snapshot. It is not edited to reflect later
changes.

When a founding decision is revised, write a new PDR that supersedes **that specific item**, quoting
it and stating what replaces it. Migration is lazy: a founding decision gets its own record only when
it is actually revised.

The invariants below are the subset that implementation may not trade away. They are restated here
because every architectural record is checked against them; the canonical statements remain in
`docs/`.

1. Source Snapshot → Canonical Recipe → Derived projections are distinct semantic layers.
2. Preserve broadly; canonicalize deliberately; derive separately.
3. No fabrication of source facts — including authorship, exact ingredient splits, and ISO durations
   invented from range or qualitative times.
4. No canonical action reordering in V1; prerequisite promotion is presentation only.
5. Traceability is a product requirement: stable Source Snapshot block ids, `sourceRefs` on canonical
   facts, and a distinct recorded run identity per processing stage.
6. Reprocessing must be possible without re-import, and must not overwrite provenance in a way that
   prevents comparing two runs.
7. URL, HTML, file and image inputs are hostile; external content is data, never model instruction;
   extraction carries no privileged tools or unnecessary secrets.
8. Model and provider credentials never reach the browser or the iOS Shortcut.
9. No mandatory per-import user review workflow; reliability comes from evals.
10. Scan-image deletion stays disabled until the capture-quality gate passes.
11. Bring and Schema.org remain adapters; the private library is never made public to satisfy Bring.
12. Every committed file, prompt, fixture, snapshot and CI log is public.

## Consequences

### Positive

- Architectural records can cite a stable product baseline immediately via `constrained_by`.
- The published discovery output stays intact and honestly dated rather than being retrofitted.
- Product decisions gain a lifecycle without a 49-record migration nobody asked for.
- Invariants 1–12 give every slice and record one checklist to be measured against.

### Negative

- Founding decisions are not individually addressable until revised, so a citation may point at a
  document section rather than a record.
- The invariant list above duplicates statements held canonically in `docs/`, and must not be allowed
  to drift from them. It is a checklist, never the source of truth.

## Consequences for supersession

Superseding a founding decision requires the new PDR to quote the original bullet verbatim, so that a
reader can see precisely what changed without diffing a 141-line document.
