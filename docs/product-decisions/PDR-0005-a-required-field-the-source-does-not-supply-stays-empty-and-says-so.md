---
id: "PDR-0005"
title: "A required field the source does not supply stays empty and says so"
status: accepted
date: 2026-09-22
tags: ["contract", "capture", "normalization", "omission", "product"]
decides: ["OQ-39"]
related_to: ["PDR-0001"]
---

## Context

The real-photograph run found a stored recipe titled with a sentence from its own method
(`spikes/s1-photo-gate/VERDICT.md`, finding 3). The capture stage was right about the page: a
handwritten card with no heading was segmented into four `instruction` blocks and **no `title`
block**, because the card has no title. The contract then required `title: z.string()`, so
normalization put something there — the full text of the first instruction — and the record kept
no sign that it had done so.

Two things made that silent rather than merely wrong.

The field was **required**, so "the source did not give one" was not a value the normalizer could
return. Every other shape in the contract has a way to say nothing: an optional field is omitted, a
quantity takes `kind: "none"`, an array is empty. `title` had none, and a stage that must produce a
string will produce one.

The field was also **ungrounded**. Measuring rather than assuming it — the walk is
`tests/schema/required-fields.contract.test.ts` — `title` was the ONLY required content field in
the whole Canonical Recipe carrying neither `sourceText` (the source's own wording, which claim
verification compares against the page) nor `sourceRefs` (the evidence, which ref resolution proves
exists). Every other required field without grounding is the pipeline's own: `id`, `schemaVersion`,
`provenance`, a stored image's identity — or a container whose emptiness already says "none". A
field with neither is unfalsifiable by construction: whatever is in it, no check can disagree.

So this is not a prompting problem. A prompt asking the model not to invent a title is asking it to
violate the schema it is also told to satisfy, and nothing downstream could tell whether it had
obeyed. The same root cause produced finding 2 of the same run — a complete ingredient list derived
from method prose on a card that had none — which is recorded separately as `OQ-40` and is NOT
decided here.

## Decision

**A required field the source does not supply stays empty and carries an explicit state saying so,
instead of receiving a value.** The alternatives were to refuse the import outright, losing real
recipes over a missing heading, or to allow derivation with a marker — which would mean trusting
generation to be right, and that needs rules and tests that do not exist yet. Kornelius decided for
the declared gap on 2026-09-22, for that reason.

Applied to the one field that has the problem today:

- **`title` becomes a declared state, not a string.** Either
  `{ state: "from_source", sourceText, sourceRefs }` — the source's own wording with the evidence
  for it, both non-empty — or `{ state: "not_in_source" }`. It stays **required**: a producer must
  say which of the two it is. An optional field would have let a title be omitted with no statement
  about why, which is the same silence moved one step.
- **The two field names are load-bearing.** `sourceText` beside `sourceRefs` is what
  `collectClaims` walks and what `collectSourceRefs` collects, so the title became a verified claim
  and a resolved reference by acquiring the shape every other fact already had. No new check was
  needed for the `url` and `text` paths.
- **A manufactured title is refused at the chokepoint, on every source type.** A title in state
  `from_source` must cite at least one snapshot block whose `type` is `title`
  (`verifyTitleGrounding`, called by `reprocess` before anything is persisted). This is the half
  that governs photographs: claim verification is deliberately off for `image` sources, and the
  observed defect was a photograph. Wording-based checks could not have caught it in any case — the
  manufactured title WAS the cited block's text, so containment scores it 1.00. What is wrong with
  it is the evidence, not the wording: a method step is not where a source names a recipe.
- **The gap is visible to whoever reads the recipe.** The page heads with "No title in the source"
  rather than a borrowed sentence, the library lists the card the same way, and the view model
  carries no title string at all in that state — so a renderer cannot fall back to one. The
  Schema.org mapping omits `name` and records the omission, exactly as it already does for a
  missing author.
- **The contract version goes to 2.0.0.** A record written against 1.0.0 does not parse against
  this shape, so this is a break and not an addition, and `SCHEMA_VERSION` is the only
  discriminator a later reader has.

**Nothing is migrated.** No persisted 1.0.0 record exists in this repository and the application is
not deployed, so there is no corpus to move. That is the reason, rather than an assumption that
none can exist: if a 1.0.0 store is ever found, the way forward is `reprocess` from its snapshots,
never a synthesized grounding. A migration could not do better — it would have to invent
`sourceRefs` for an old title, which is precisely the rule this record exists to establish, broken
by the code enforcing it.

**Two things this record deliberately does not decide.** Whether a canonical recipe may carry an
ingredient list derived from method prose (`OQ-40`), and whether the fields that are required and
*parsed* rather than quoted — `Ingredient.name`, `Equipment.name`,
`InstructionStep.normalizedActionText`, `PreparedComponent.label` — need their own answer. Those
cite evidence but are excluded from verbatim verification by design
(`src/pipeline/claim-support.ts`), which is a narrower question than the one settled here.

## Consequences

- A recipe from a titleless source is now importable and readable, and says what it is. Before this
  it was importable and read as if its method's first sentence were its name.
- A normalizer that manufactures a title is refused rather than persisted, and the refusal names
  which block types were cited, so it is diagnosable. The refusal costs a conversion; the
  alternative cost a false record, and a refusal is recoverable where a stored invention is not.
- The check fails closed on evidence no path produces today: a title grounded only on a
  `payloadPointer` is refused, although the structured payload is not a model's account of the
  page. The one adapter that emits a payload emits a `title` block beside it, so this cannot arise
  on a path that exists. A later source shape that grounds a title elsewhere extends the rule
  deliberately.
- The class is now visible instead of remembered. `tests/schema/required-fields.contract.test.ts`
  walks the contract and fails when a required field carries content with no grounding, so the next
  one is caught when it is added rather than when a photograph finds it.
- Every consumer of `title` had to say what it does with a gap — the library listing, the recipe
  page, the Schema.org mapping, the repository's `LibraryEntry`. That is the intended cost: each of
  those was previously guaranteed a string that might have been invented.
