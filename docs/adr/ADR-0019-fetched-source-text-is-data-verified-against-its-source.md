---
id: "ADR-0019"
title: "Fetched source text is data, and a conversion driven by it is verified against the text it came from"
status: accepted
date: 2026-09-21
tags: ["security", "prompt-injection", "model-boundary", "url-ingestion"]
constrained_by: ["PDR-0001"]
depends_on: ["ADR-0004"]
related_to: ["ADR-0003", "ADR-0010"]
---

## Context

Slice 4's fallback extracts recipe fields from the *text* of a fetched page when the page's
structured data is absent or insufficient. That text is written by whoever controls the page, and
it goes into a model prompt. Until now nothing governed what it could do once it was there.

`ADR-0010` answers a different question and says so itself: it decides where we connect, how much
we read and under what bounds, and it constrains extraction and the model boundary not at all. A
page that is entirely legitimate as bytes can still carry text whose purpose is to steer the model.

The obvious threat is a page that tells the model to ignore its instructions. **The damaging one
for this product is quieter: a page that makes the model emit a recipe whose content is not on the
page.** The contract's defence against invention is `sourceRef` resolution — every fact points at
the block it came from — but a model that fabricates content fabricates the refs beside it, and a
ref that points at a block which exists resolves whether or not the fact is in it. Against a page
written to induce invention, resolution passes by construction.

This had to be settled before the fallback unit landed, because afterwards the first page that
exercises it is a live one.

## Decision

**Fetched source text is data, structurally separated from instructions; and a conversion driven by
it is verified against the text it came from.** Two halves, neither sufficient alone.

### 1. Separation

Untrusted text reaches a model only through one boundary (`src/pipeline/untrusted-source-text.ts`).
It travels as its own part, inside a fence whose marker is drawn at random and re-drawn if the text
happens to contain it, so a page cannot terminate a region whose marker it cannot predict.
Instructions live in the exchange's system channel, which no source byte reaches. The text is
passed **verbatim** — nothing is stripped or rewritten, because the record has to keep what the
source actually said and the verification below depends on exactly that.

The boundary covers the rejected-reply excerpt on the repair path too. It is the model's own
output rather than the page's, but a page that steers the model steers what it emits, and the
repair path is the one where the model has already demonstrably left its contract.

### 2. Verification

A fact's `sourceText` — the field the ontology defines as the source's own wording (§5.2) — must be
**contained** in one of the blocks its `sourceRefs` cite, after normalization, checked against each
cited block on its own and never against their concatenation.

**Containment rather than a coverage threshold, because the size of the text a claim is scored
against is the model's to choose.** A word-coverage rule says "these words appear, in order,
somewhere in that text", so its meaning depends on how much text it is given — and the model chose
that at every level available to it. It chose by citing more blocks; when scoring moved per block
it chose by capturing coarser, and `ingredient_group` is a block type the schema itself defines.
Bounding block size would have treated the symptom. Containment removes the dependency: a larger
haystack cannot manufacture a contiguous substring, so segmentation stops being a lever. The
measurement behind this, and what it cost, are registered in `spikes/inj-threshold/CALIBRATION.md`.
The
refusal is its own type, distinct from a contract failure and from a transport failure, and it is
**not retried**: a page that steered the model will steer it again, and a second billed call buys
the same answer.

Verification governs `url` and `text` sources, derived from the snapshot rather than passed as a
flag so no caller can forget it. The image path is excluded: a photograph is a page the user
physically holds, which is a different threat model.

**Both stages are anchored, because otherwise the chain has a hole at its start.** Normalization
verifies a canonical fact against the snapshot block it cites — but the snapshot is itself a model
output. A model that invents at *capture* produces a snapshot whose blocks contain the invention,
and normalization then verifies the fabrication against its own record of the fabrication and finds
it supported. Demonstrated before it was closed, end to end, on a page written to induce invention:
an ingredient absent from the page reached a valid canonical with every ref resolving.

So on the `url` and `text` paths every captured block must be **contained in the decoded input**,
normalized — the only text in the pipeline no model has touched. That is the chain's anchor;
everything downstream verifies against something already verified against it.

A captured block is a SPAN of the input — capture segments text, it does not paraphrase — so
containment is a bar this stage can carry, and every block of every real snapshot measured clears
it. Coarse segmentation is not itself an attack and is not forbidden; it simply stops being useful,
because the same rule applies to the claims that cite those blocks.

This makes an architectural requirement of Slice 4's fallback structural rather than advisory: the
fallback must hand capture the **extracted text** it is asking the model to read, not the raw HTML
it was extracted from. Handing over raw markup would mean verifying prose against tags, which fails
every legitimate page. The requirement was implicit before; now the build states it.

### 3. Not content filtering

**The defence is separation and verification, and deliberately not a filter.** No list of
suspicious phrases is consulted, and none should be added. A blocklist of wordings is a promise the
next wording breaks, and — worse — its passing tests read as evidence while proving only that the
attacks someone already thought of are caught. Separation and verification hold regardless of
wording, and verification is the same mechanism the contract already relies on.

This is the rule already set for block ids, identity, provenance and `structuredSourcePayload`,
applied to content: **a model's claim about the source is evidence, never authority.**

## Consequences

- A second path that puts source text in front of a model fails the build rather than being caught
  in review. `tests/injection/prompt-boundary.test.ts` declares the inventory of prompt-assembling
  modules and scans them, in the style `ADR-0010`'s chokepoint settled on.
- **Some legitimate pages will be refused.** Verification is strict on purpose — it fails on the
  first unsupported claim rather than on a rate, because the harm from one invented ingredient is
  not proportional to its share of the recipe. The calibration measured this cost on a corpus
  harder than the one the rule governs; it is an upper bound rather than a prediction, and the real
  rate belongs to Slice 4's fallback unit to measure.
- A refusal names the claim and the block it failed against, so it is diagnosable rather than
  mysterious. A capture-stage refusal names the block and the input it failed against.
- **Only `sourceText` is verified. An invented value in a PARSED field beside it is not caught.**
  `sourceText` is a quotation and can be checked against the source; `name`, `quantityExpression`
  and the rest are the contract's split-out forms, which a source need not contain verbatim, so
  there is nothing to compare them to. The consequence is concrete and worth stating in the terms
  this record itself uses: an ingredient whose `sourceText` is the verbatim, verified "250 g rote
  Linsen" and whose `name` is "Erdnussbutter" passes. That is an invented allergen in a persisted
  recipe — the exact harm this record cites when it argues a refusal is the recoverable direction.
  Verification narrows where invention can live; it does not eliminate it. Whether parsed fields
  get their own check is a separate decision and its own item; Slice 4 will be built against this
  record, so the limit is named here rather than left to be discovered.
- **The threshold is gone, not merely lowered.** Both stages require containment, so there is no
  bar to calibrate and none to protect from being tuned. `SUPPORT_COVERAGE_THRESHOLD` survives only
  so a refusal can report how close the wording came.
- No rule was loosened in response to a score. Each was TIGHTENED in response to a reproduced
  attack, which is the one direction needing no timestamp defence. The measured cost of the last
  tightening is one claim in 696, and `CALIBRATION.md` records what that claim looked like.
- **Reintroducing any relaxation is a new record, with a new measurement.** That is what `CFV1-THR`
  exists to prevent, and it now applies to the rule's SHAPE rather than to a number: a coverage
  bar, a bounded window, a similarity score — each one reopens the question of who chooses the text
  being scored against, and each needs the false-acceptance direction measured, not only the
  false-refusal one.
- Verification rests on multi-token claims. A one-word claim is contained in almost any block that
  uses the word, which is correct — the block does contain it — but it means the protection lives
  where a fabricated recipe's content lives, not everywhere uniformly.
- **Legitimate quotations that differ from the source by an inflection are now refused.** That is
  the measured cost of dropping the relaxation: one claim in 696. It was not a free choice. That
  claim had every word present, in order, with a gap — which is also the recombination attack's
  signature, so no rule could accept it and refuse the attack.
- Nothing here establishes that a model obeys the fence, and nothing static could. That is why the
  second half exists.
