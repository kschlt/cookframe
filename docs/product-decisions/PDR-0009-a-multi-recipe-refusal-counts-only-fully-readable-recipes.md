---
id: "PDR-0009"
title: "A multi-recipe refusal counts only fully readable recipes"
status: accepted
date: 2026-10-30
tags: ["capture", "refusal", "multi-recipe", "product"]
decides: ["OQ-41"]
related_to: ["PDR-0005", "PDR-0001"]
---

## Context

`CFV1-MR1` refuses a source that holds several recipes, because the capture contract assumes one
recipe per source and losing the others silently is the failure Gate A exists to prevent. The
run in `spikes/sl5-scan-to-shop/RESULT.md` showed the refusal firing on three of eleven
photographs while only one of them holds several recipes. The other two are one recipe beside a
photograph of several finished dishes, and one card lying on other printed recipe sheets whose
edges are in frame. The count was taken from what is in the shot instead of from what is being
captured (`OQ-41`). What a recipe in a photograph *is*, for the purpose of counting, is a product
boundary with a precision/recall trade-off: refusing a page that holds two recipes protects
against silent loss, refusing a page that holds one costs a capture.

On 2026-10-30 Kornelius decided: when counting recipes before a refusal, only fully readable
recipes count. The cut-off edges of other pages and photographs of finished dishes do not count.

## Decision

**A recipe counts toward the multi-recipe refusal only if it is fully readable in the source.**

- A recipe that is cut off at the frame, such as the edge of another sheet or page, does not count.
- A photograph of a finished dish is not a recipe and does not count.
- The refusal fires when more than one fully readable recipe is counted, as before; only what
  counts changes.

The implementation is its own item; this record does not build it.

## Consequences

### Positive

- A single card on a table, or a recipe facing a picture of the dish, is captured instead of refused.
- The count follows what is being captured, not what happens to be in the shot.

### Negative

- Recall drops at the margin: a second recipe that is only partly in frame is not counted, so its
  loss is not announced. That is accepted for the sake of not refusing single recipes on a phone.
- "Fully readable" needs a working definition and fixtures covering the two measured cases and the
  four-recipe spread; the implementation item carries them. Measurements and rates are taken
  after the rule is written down, not used to set it.
