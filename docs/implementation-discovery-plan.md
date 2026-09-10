# Cookframe — Implementation Discovery Plan

Status: Working document — expected to be revised and eventually retired  
Scope: Sequences the implementation-time work that discovery deliberately left open.

This plan is **not** a decision record. It adds no product scope and states no decision of its own.
Decisions live in [`adr/`](adr/) and [`product-decisions/`](product-decisions/); this document
sequences the work that produces them and links out. When it disagrees with a record, the record
wins.

## 1. Invariants

Every decision and every slice is checked against the twelve invariants in
[PDR-0001](product-decisions/PDR-0001-adopt-discovery-baseline-as-founding-product-decisions.md).
They are not restated here.

## 2. Decisions on the table

Six records exist. Four are `proposed` and need review before Slice 1 can start.

| Record | Decision | Status |
|---|---|---|
| [ADR-0001](adr/ADR-0001-runtime-and-deployment-shape.md) | Portable containerised Node runtime as the reference self-hosting shape | proposed |
| [ADR-0002](adr/ADR-0002-implementation-language.md) | TypeScript as the implementation language | proposed |
| [ADR-0003](adr/ADR-0003-recipe-persistence.md) | Postgres with validated JSONB documents plus extracted query columns | proposed |
| [ADR-0004](adr/ADR-0004-model-provider-capability-boundary.md) | Model access behind three named capabilities | proposed |
| [ADR-0005](adr/ADR-0005-adapters-as-modules-in-one-repository.md) | Adapters are modules in one repository | accepted |
| [ADR-0006](adr/ADR-0006-decision-records-adopt-adr-kit-conventions.md) | Decision records conform to adr-kit, no bespoke tooling | accepted |

ADR-0001 is the expensive reversal: it cascades into persistence, background work, file handling and
testing. It deserves the most scrutiny of the four.

## 3. Open questions

`OQ-01`–`OQ-23` are the deferred questions in
[`decisions-and-open-questions.md`](decisions-and-open-questions.md) §2, in that order. `OQ-24`
onwards are questions found during implementation discovery itself.

| Question | Resolved by |
|---|---|
| OQ-02 language · OQ-03 database · OQ-04 persistence shape · OQ-05 hosting | ADR-0001 to ADR-0003, once accepted |
| OQ-07 model provider · OQ-08 SDK · OQ-09 provider interfaces | ADR-0004, once accepted |
| OQ-14 capture-eval thresholds | **S1** |
| OQ-16 safe URL-fetch implementation | **S2** design, **S5** validation |
| OQ-17 capability token · OQ-18 Bring mechanism | **S3** |
| OQ-24 capture and normalization: one physical model call or two | **S6** |
| OQ-01 framework/router · OQ-06 object storage · OQ-10 background jobs · OQ-11 shortcut packaging · OQ-12 mobile component system · OQ-13 Cooking Plan timing · OQ-19 hero-image variants | Deferred — decided against a real constraint, not pre-emptively |
| OQ-15 scaling classification · OQ-20 unit conversion · OQ-21 alias vocabulary · OQ-22 Focus Mode · OQ-23 food-state graph | Out of V1 |

Two of those deserve their reasoning stated:

- **OQ-12** stays open on purpose until **S4** has run. Choosing a component system first would
  pre-bias the very layout that S4 exists to evaluate.
- **OQ-15** needs no answer to ship. `scalingEligibility` defaults to `unknown`, and any affected
  `unknown` disables automatic whole-recipe scaling — so V1 ships with scaling *unavailable*. That is
  the conservative design working as designed, not a gap.

## 4. Spikes

**S1**–**S5** are required by
[`validation-and-evaluation.md`](validation-and-evaluation.md). **S6** and **S7** are additions from
implementation discovery; neither changes product scope.

### S3 — Bring compatibility (Gate D) — run first

**Questions:** What does Bring actually require and do — missing author, ingredient parsing, exact vs
vague quantities, multiple contextual yields, base vs requested scaling, no-image recipes, tokenized
URLs, return navigation, and what a Bring-side share propagates?

**Why first:** largest external unknown, and it constrains the capability-URL design and the
Schema.org mapping. Its outcome can invalidate slice ordering, which is cheapest to learn now.

**Do not sequence it behind ADR-0001.** Run it against a disposable public page; it does not need the
hosting decision settled.

**Output:** adapter constraints, regression fixtures, and an explicit finding on what Bring does with
a shared recipe URL.

### S2 — URL and structured-source extraction

**Questions:** How often is Schema.org/Recipe JSON-LD present *and* sufficient on the sources actually
used? What must the fallback cover? Is LLM assistance required at all, and precisely where?

**Output:** a deterministic-first extraction design, and an honest answer on LLM necessity.

### S6 — Structured-output fidelity

**Question (OQ-24):** Can one model call reliably return both a Source Snapshot with *stable block
ids* and a Canonical Recipe whose `sourceRefs` resolve against them — or must capture and
normalization be two calls?

**Why:** the baseline permits combining them for latency and cost while still recording separate
component versions. Whether that is achievable is empirical, and it shapes latency, cost and the
whole pipeline. Answer it before building around either assumption.

**Output:** OQ-24 closed, plus a measured latency and cost baseline for the scan-to-shop path.

### S1 — Image capture quality (Gate A)

**Question:** Does capture meet critical-field accuracy well enough that discarding the scan is safe?

**Fixtures must include:** clean pages, angled photos, glare and shadow, multi-column layouts,
ingredient groups, fractions, ranges, split and reserved instructions, small metadata text, ambiguous
units, multiple yields, source-provided nutrition and classifications.

**Scoring:** critical fields scored per field, never by text similarity.

**Fixture split:** public fixtures synthetic or self-authored only; real cookbook photos stay private
and outside this repository.

**Until it passes, scan deletion stays off.** This is a release gate, not a milestone.

### S5 — URL ingestion security (Gate E)

**Question:** Does the chosen fetch implementation hold against local and private-network access,
cloud metadata endpoints, redirect re-validation, size, content-type and time bounds, script
non-execution, indirect prompt injection, and external image handling?

**Form:** an adversarial suite in CI, not a one-off manual check.

### S4 — Cooking UX hypotheses

**Questions:** Hypothesis A (separate `NOW YOU NEED` block) or B (quantities inline)? Does
`assumedAtHand` suppression reduce clutter without hiding readiness work? Do cooking units avoid both
the wall-of-paragraph and 15–20 micro-steps?

**Prerequisite:** real recipes on a real phone, rendered as plain HTML, before any component system
is chosen.

### S7 — Reprocessing round-trip

**Question:** Can normalization vNext re-run over stored snapshots and be compared against vN without
destroying provenance?

**Why:** this is the invariant most easily broken by an implementation that updates rows in place.
Proving it costs little inside Slice 1 and is expensive to retrofit. Folded into Slice 1's
definition of done rather than run separately.

## 5. Repository and tooling setup — Slice 0

Deliberately minimal. Nothing is included merely because it is conventional.

- `.gitignore`, `.env.example` with placeholders only, `SECURITY.md`, `CONTRIBUTING.md`
- TypeScript, one lint and format toolchain, a test runner. No monorepo tooling until a second
  deployable exists (ADR-0005)
- `schema/` — the versioned Source Snapshot and Canonical Recipe contract as the single source of
  truth for validation, persistence and Schema.org mapping
- `evals/` — harness, plus `evals/fixtures/public/` committed and `evals/fixtures/private/` ignored
  and documented as living outside the repository
- `.github/workflows/ci.yml` — typecheck, lint, unit tests, schema-contract tests, normalization
  invariant tests, URL-fetch security tests. No deployment from fork pull requests
- On the GitHub repository: secret scanning with push protection, Dependabot, branch protection on
  `main`

No decision tooling is written (ADR-0006).

## 6. Vertical slices

Each slice is end-to-end, demonstrates at least one invariant, and depends only on decisions already
accepted. None is "build the data layer".

**Slice 0 — Skeleton.** Section 5. Done when CI is green on a real but empty application and
ADR-0001 to ADR-0004 are accepted or replaced.

**Slice 1 — Image → Snapshot → Canonical, persisted.** No UI beyond JSON.  
*Done when:* a photo yields a Source Snapshot with stable block ids and a Canonical Recipe whose
`sourceRefs` resolve; capture and normalization run identity, provider, model and prompt-component
versions are recorded; schema validation runs before persistence; **and a `reprocess` command
re-runs normalization over a stored snapshot into a new Canonical version without overwriting the
old one, both comparable** (S7).

**Slice 2 — Library and recipe page.** Deterministic rendering from Canonical only, no Cooking Plan.  
*Done when:* a saved recipe is fully usable with the source unavailable; discovery signals are
visible; ranges and qualitative quantities render as their source wording, never as invented numbers;
plain HTML and CSS, so S4 stays unbiased.

**Slice 3 — Shopping: Schema.org mapping → capability URL → Bring.** The primary V1 journey.  
*Done when:* the mapping is deterministic and versioned; ranges, qualitative and open-ended durations
are omitted rather than coerced; a missing author is an explicit compatibility state, never
fabricated; the capability URL exposes exactly one recipe, is revocable, and is designed assuming it
leaves the user's device. Requires S3.

**Slice 4 — URL source adapter.** JSON-LD first, safe fetch, fallback extraction.  
*Done when:* a URL import converges on the same Snapshot and Canonical contract as an image import
with no bypass path, and the S5 suite is green in CI. Requires S2, S5.

**Slice 5 — Mobile capture entry point.** Shortcut or share sheet through to shopping.  
*Done when:* the scan-to-shop path is measured end to end and no model credential is reachable from
the client. This is where the low-friction claim is tested rather than asserted.

**Slice 6 — Derived Cooking Plan and cooking presentation.**  
*Done when:* Gate C holds — no amount or temperature changes, no fabricated facts, no canonical
reordering, prerequisite look-ahead traceable to canonical facts, split and reserved amounts
unmissable — and the recipe stays viewable when no plan exists yet. Requires S4.

**Sequencing rationale.** Bring precedes URL import because scan-and-shop is the primary journey and
Bring is the largest external unknown; early is the cheapest place to be wrong. The Cooking Plan is
last because it is the only replaceable derived layer — everything before it must be right, and it
can be regenerated once it exists.

## 7. Private-state boundary

- Runtime recipe data: configured persistence, never Git.
- Secrets: environment or secret store. `.env.example` holds placeholders only.
- Private eval fixtures — real cookbook photos, personal recipes — outside this repository, in an
  ignored path documented in `evals/README.md`.
- A separate private state repository is **not created**. No concrete need exists yet, and the
  baseline says not to create one for conceptual symmetry.

## 8. What this plan does not do

- It does not decide the deferred questions in §3 in order to look complete.
- It does not add Canonical fields, abstractions or adapters beyond the published baseline.
- It does not schedule any V1 non-goal.
- It does not treat any spike outcome as already known.
