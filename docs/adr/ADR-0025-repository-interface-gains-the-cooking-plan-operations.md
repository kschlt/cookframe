---
id: "ADR-0025"
title: "The repository interface gains storeCookingPlan and loadCookingPlan, widening ADR-0018 from six operations to eight"
status: superseded
superseded_by: ["ADR-0032"]
date: 2026-09-22
tags: ["persistence", "boundaries", "repository-interface", "cooking-plan"]
supersedes: ["ADR-0018"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0023", "ADR-0008", "PDR-0004"]
---

## Context

ADR-0018 widened the persistence boundary from ADR-0003's five operations to six, and
did so under a rule it stated as the reason the widening was legitimate: *"a read is
added for a specific, active consumer — not for completeness"*, because a padded
interface is *"a commitment every future store must honour, bought with nothing"*.
This record is the same widening under the same rule, for the Cooking Plan.

PDR-0004 decided **when** a plan is generated: a configured policy, `lazy` by default,
`background` as the other supported value, and blocking the import request forbidden.
ADR-0008 decided what executes `background`: in-process fire-and-forget after the
response is sent. Both decisions presuppose a place to put a plan that was generated
away from the request that will read it — and the interface has none. Under `lazy`
alone the gap is invisible, because `lazy` derives inside the request that renders the
view and stores nothing. `background` makes it load-bearing: a plan generated after an
import and never stored is a plan nobody can read, so the policy PDR-0004 names as
supported would be unimplementable.

There are two callers in the tree with this record, not one anticipated:

- **`src/http/plan-generation.ts`** — the `background` hook. It derives after the
  import's response has gone and has exactly one thing to do with the result: write it.
- **`src/http/cooking-app.ts`** — the cooking route. It asks for a stored plan first
  and derives on a miss, which is what makes `lazy` the cheap default rather than a
  degraded mode.

The plan is not a third recipe layer. It is **derived data**: ADR-0023 fixed the
derivation as deterministic and total on the Canonical Recipe, so re-deriving a version
yields the same bytes, and a plan lost to a restart costs a derivation and nothing else.
That is the property the whole shape below rests on.

## Decision

**Widen the interface by one write and one read, `storeCookingPlan` and
`loadCookingPlan`, and supersede ADR-0018 on the operation set.** An accepted record is
never rewritten, so this is a new record; ADR-0018 stays readable in place, its
`superseded_by` set to this record, and the rule it established — an operation is added
only with a named caller — is carried forward unchanged and is what admits these two.

1. **The added operations.** `storeCookingPlan(plan)` files the derived plan for one
   Canonical version; `loadCookingPlan(recipeId, version)` returns it, or `undefined`
   when none is stored.

2. **The plan is keyed by `(recipeId, version)`, never by recipe alone.** A plan derived
   from version 2 must not be served for version 3 — a recipe re-normalized since the
   plan was written would otherwise hand a cook amounts and steps from a source reading
   that no longer stands. Keying it this way makes a stale plan *impossible to store*
   rather than something a caller must remember to check. It is the same discipline
   ADR-0023 applies inside the plan: the derivation is a function of one version, so its
   result is filed against one version.

3. **The version is read from the plan, not passed beside it.** `storeCookingPlan` takes
   the plan alone and reads `derivation.canonicalVersion`. Two places to state the
   version are two places to disagree, and the disagreement would be exactly the stale
   plan point 2 exists to prevent. A plan that names no version is refused
   (`UnversionedCookingPlanError`), and so is one naming a version the store does not
   hold (`RecipeVersionNotFoundError`): a stored plan whose recipe version does not
   exist is an untraceable artefact, which this slice forbids for a plan's *contents*
   and forbids no less for the plan itself.

4. **The write is last-write-wins, not an append.** ADR-0003 made the Canonical write an
   append because two normalization runs of one recipe are two facts, and comparing them
   is a product capability. Neither holds here: the derivation is deterministic
   (ADR-0023), so re-deriving one version produces the same plan, and there is no
   comparison of two plan runs to serve. An append would accumulate identical documents
   and invite a "which plan run" question the product does not have.

5. **Absence is a return value, not a throw.** `loadCookingPlan` follows
   `loadSnapshot` and `loadLatestCanonical`. Under PDR-0004's shipped `lazy` default a
   miss is not an error but the ordinary state of every recipe nobody has cooked yet —
   the caller derives and serves. Making that path exception handling would dress the
   normal case as a failure.

6. **No plan-specific query beyond these two.** No "list plans", no "delete plans for a
   recipe", no plan in the library listing. None has a caller, and each would be a
   commitment every future store must honour, bought with nothing. A store that never
   evicts is correct today; eviction is a storage concern and gets a record when
   something measures a need for it.

7. **The contract suite carries them.** The two operations are proven in the shared
   suite that runs against every store in the registry (ADR-0018 point 5), not in a test
   written against one store — including the refusals in point 3 and the round-trip's
   isolation, so a store handing back its own stored object rather than a copy fails.

The widened operation set is therefore: `storeSnapshot`, `loadSnapshot`,
`appendCanonicalVersion`, `loadLatestCanonical`, `listLibrary`, `readTwoRuns`,
`storeCookingPlan`, `loadCookingPlan`.

**The shopping aggregation ADR-0018 named as a known-but-uncalled need stays exactly
that.** It still has no caller, and this record does not smuggle it in alongside a
widening that has two.

## Consequences

- PDR-0004's `background` becomes implementable: the plan generated after an import has
  somewhere to go, and the cooking route finds it there. Without this record the policy
  would be a configuration value with no reachable behaviour.
- The stale-plan failure is closed by construction rather than by discipline. No caller
  can file a plan against the wrong version, because no caller supplies the version.
- `CookingPlan` becomes a persisted contract, so it is bound by the same versioning and
  migration commitments as the other documents: it is validated against the versioned
  schema before it is written, like every other document ADR-0003 governs.
- The measured DBQ evaluation (`spikes/dbq/`) does **not** answer these two operations.
  It is a finished measurement of three named queries, and implementing a plan table
  there would silently add unmeasured work to a result other decisions rest on. The
  spike's stores therefore record the two operations as refusals, which keeps the
  measurement honest and states the gap where a reader of the spike will find it.
  Whatever store the DBQ decision lands must implement them before it is the real one.
- A plan lost — to a restart, to an eviction, to a store that never had it — costs one
  derivation. That is what makes points 4 and 6 affordable, and it is a property of
  ADR-0023 rather than of this record: were the derivation ever to become non-
  deterministic or expensive, this record's shape would have to be reopened, not
  patched.

## Alternatives considered

- **Store the plan inside the Canonical version document.** Rejected: it would make a
  derived artefact part of an immutable record that is appended by the normalization
  pipeline, so writing a plan would mean writing a new Canonical version. It also
  inverts the authority — the Canonical is the source of truth and the plan is the
  replaceable layer, which is why losing the plan must never take the recipe with it.
- **Key the plan by recipe id alone and overwrite on each derivation.** Rejected: the
  plan for a superseded version would be served for the current one until something
  re-derived it, and the failure would be silent and plausible-looking on the page.
- **Pass the version as a second argument to `storeCookingPlan`.** Rejected: see point
  3. The plan already states it; a second statement can only disagree.
- **Add an in-memory cache in the route instead of a repository operation.** Rejected:
  it would put persistence behind no interface at all, contradicting ADR-0003's standing
  requirement that all persistence go through the repository, and it would not survive
  the restart that ADR-0008 explicitly expects.
- **Make the cooking route write what it derived on a miss.** Rejected here as it is in
  the route's own comment: PDR-0004 names the two moments a plan is generated, and a
  write on a GET would be a third, decided in passing rather than by a decision. It
  would also turn a read path into a write path on the request a cook is waiting on.
- **Wait for the persistent store decision before widening.** Rejected: the same
  argument ADR-0018 answered. The interface is what callers are written against; a slice
  blocked on an unrelated storage decision would answer it privately, and the two
  answers would drift.
