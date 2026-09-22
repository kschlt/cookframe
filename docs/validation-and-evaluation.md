# Cookframe — Validation & Evaluation Plan

Status: Discovery baseline  
Scope: Product-level validation gates and spikes. Exact tools, thresholds and test harnesses are intentionally deferred.

## 1. Why validation is part of the product architecture

Cookframe intentionally trusts automation in the normal user flow.

There is no V1 requirement for the user to manually approve every extracted recipe.

Therefore reliability must be established through:

- representative fixtures;
- deterministic schema/invariant checks;
- regression tests;
- focused external-contract spikes;
- UX evaluation.

The purpose of this document is to define **what must be validated**, not prematurely choose the testing framework.

## 2. Gate A — capture quality before default scan deletion

The intended product behavior is to discard source scan images after successful capture.

That is irreversible.

Before this becomes the normal production policy, a representative image-capture eval must demonstrate acceptable quality on critical recipe facts.

The eval set should include real-world variation such as:

- clean cookbook pages;
- angled photos;
- shadows/glare;
- multi-column layouts;
- ingredient groups;
- fractions;
- ranges;
- split/reserved ingredient instructions;
- small metadata text;
- ambiguous units;
- multiple yields;
- source-provided nutrition/classifications.

Critical fields should be assessed separately from generic text similarity.

The exact quantitative acceptance threshold remains an implementation-time decision.

Until the gate passes, implementation may retain source images temporarily or keep deletion disabled.

## 3. Gate B — normalization correctness

Normalization fixtures should test that the system:

- preserves source facts;
- does not invent missing facts;
- handles exact/range/qualitative quantities;
- preserves contextual yields;
- preserves nutrition basis;
- preserves source-provided classifications;
- structures explicit equipment;
- captures split/reserved ingredient usage;
- captures source-explicit step time/temperature/doneness/prerequisites;
- maintains stable provenance links to Source Snapshot evidence;
- applies conservative scaling eligibility.

Regression tests should focus on domain invariants rather than exact LLM wording.

## 4. Gate C — cooking transformation safety

The Cooking Plan should be evaluated for both usefulness and semantic safety.

Required checks:

- no ingredient amount changes;
- no temperature changes;
- no fabricated cooking facts;
- no canonical action reordering in V1;
- prerequisite look-ahead remains traceable to canonical facts;
- split/reserved ingredients remain obvious;
- contextual quantities are correct;
- concurrency cues are source-explicit or highly conservative.

## 5. Cooking UX hypotheses

Research supports contextual information and structural overview, but not one frozen layout.

At minimum, evaluate:

### Contextual ingredient presentation

A. separate compact “need now” block + action  
B. action-first copy with quantities integrated inline

### Preparation projection

Evaluate whether `assumedAtHand` suppression reduces clutter without hiding meaningful readiness work.

### Mobile information density

Evaluate whether the current work unit:

- is quickly scannable;
- keeps the actual action prominent;
- exposes critical time/temperature/reservation information;
- preserves nearby look-ahead;
- avoids turning the recipe into excessive micro-steps.

The invariant is not “one screen per step”. It is “minimum sufficient local information without forced searching”.

## 6. Gate D — Bring compatibility spike

Bring is an external contract and must be tested against actual current behavior.

Test at least:

- title;
- source-provided author vs. missing author;
- ingredient parsing;
- exact and vague quantities;
- contextual/multiple yields;
- base/requested quantity scaling;
- recipes without image;
- capability/token URLs;
- return navigation;
- recipe-sharing behavior/link propagation;
- behavior when Canonical scaling semantics are not compatible with Bring-side scaling.

Do not assume valid Schema.org means Bring-compatible.

The spike should produce adapter constraints and regression fixtures.

## 7. Gate E — URL-ingestion security

URL import must be tested as hostile input.

Validate the chosen implementation against:

- local/private-network access attempts;
- redirects;
- oversized content;
- unsupported content types;
- malicious/irrelevant HTML;
- indirect prompt-injection text;
- external image handling;
- model/tool privilege boundaries.

The exact safe-fetch mechanism remains an implementation decision.

## 8. Public fixture strategy

The public repository should contain a small, useful golden fixture/eval set during implementation.

Public fixtures must be:

- synthetic;
- project-authored;
- or permissively licensed / otherwise safe to redistribute.

Real personal cookbook photos, private recipes or uncertain copyrighted fixtures should remain outside the public repository.

## 9. Performance evaluation

The user experience should feel immediate for the scan/save/shop path.

Measure end-to-end latency rather than optimizing isolated components.

The architecture should prefer:

- one fast happy path;
- no unnecessary chained model calls;
- no Cooking Plan dependency for immediate shopping;
- deterministic rendering/mapping where possible.

Exact latency targets should be chosen from real implementation measurements.

## 10. Release-readiness checks

Before presenting Cookframe as a generally usable self-hosted project, verify:

- license present (AGPL-3.0-or-later, see `PDR-0006`);
- public-safe fixtures;
- no secrets/private data in repository history;
- documented self-hosting path;
- documented required configuration;
- export/backup approach understood;
- supported external adapter behavior documented;
- security reporting/contributor basics prepared;
- capture deletion gate passed or deletion remains disabled.
