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
supported by the block its `sourceRefs` cite, not merely accompanied by a ref that resolves. The
rule is normalized containment with a bounded token-coverage relaxation; the threshold, the
measurement behind it and its limits are registered in `spikes/inj-threshold/CALIBRATION.md`. The
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

So on the `url` and `text` paths every captured block is verified against **the decoded input bytes**
— the only text in the pipeline no model has touched. That is the chain's anchor; everything
downstream verifies against something already verified against it.

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
- The two stages share one comparator and one threshold. That is deliberate — two bars would be two
  things to calibrate and two to keep honest — but it means the capture stage inherits the
  calibration's limits along with its number, and the capture corpus is the same photographs.
- The relaxation threshold is a permanent contract. Changing it after seeing a result it moves is
  the failure `CFV1-THR` exists to prevent; it changes by a new record, with a new measurement.
- Verification rests on multi-token claims. A one-word claim scores as supported against almost any
  block that contains the word, which is correct — the block does contain it — but it means the
  protection lives where a fabricated recipe's content lives, not everywhere uniformly.
- Nothing here establishes that a model obeys the fence, and nothing static could. That is why the
  second half exists.
