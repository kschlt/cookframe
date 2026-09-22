---
id: "ADR-0023"
title: "The Cooking Plan is derived deterministically from the Canonical Recipe, and a judgement the Canonical does not carry is not inferred"
status: accepted
date: 2026-09-22
tags: ["cooking-plan", "derivation", "boundaries", "model-egress"]
constrained_by: ["PDR-0001", "PDR-0004"]
depends_on: ["ADR-0008", "ADR-0014"]
related_to: ["ADR-0004", "ADR-0013"]
---

## Context

Slice 6 turns a stored Canonical Recipe into the Cooking Plan the cook reads at the
stove: what to set up, what to start now, what to fetch, and one unit per step with
its amounts and its time-critical parameters. Nothing had yet decided **where the
plan's facts come from**.

Two answers were open, and they are not variations on one design:

- **Derive the plan from the Canonical** — a pure function of a document the
  conversion already produced.
- **Ask a model to compose the plan** — a second physical call, with a prompt that
  turns steps into cooking units.

The product invariant settles part of it already. PDR-0001 forbids inventing a fact
the source does not state, and CFV1-SL6 sharpens that: *fabrication includes a
plausible inference.* An amount rounded, a temperature converted, a step merged with
its neighbour or a resting time filled in from cooking knowledge are all the same
failure — the cook is told something the recipe never said, at the moment they are
standing over a pan and cannot check.

The real-device evaluation in CFV1-S4 (`spikes/s4-cooking-ux/README.md`) then produced
the evidence that makes this decidable rather than a matter of taste. It ran three
recipes through a prototype on a phone and recorded, per finding, what each rule would
cost. Its finding 4 is the one that bears here. START NOW — the look-ahead block that
sends the cook to start something before the recipe reaches it — admitted the wrong
entries on two of three recipes, and the rule that fixes it reads:

> admit an entry to START NOW only when it is **slow, safe to leave unattended, and
> needed later**.

Three legs. The Canonical Recipe carries one of them.

## Decision

**The Cooking Plan is derived from the Canonical Recipe by a pure, deterministic
function, and by nothing else. No model call takes part in its generation.**

1. **`deriveCookingPlan(recipe)` is total and pure.** The same Canonical Recipe in
   yields a byte-identical plan out. It reads the recipe and its options and nothing
   further — no clock, no network, no store, no model. `ADR-0014`'s one physical model
   call per conversion therefore stands unchanged: the plan adds none.
2. **Every plan element names the Canonical element it came from.** Each amount,
   prerequisite, critical parameter and unit carries a `CanonicalOrigin` — the element
   kind, the id, an index where the element is one of a list, and the source
   references the Canonical already holds. Provenance is a field of the contract, not
   a convention the deriver is trusted to follow.
3. **An element that cannot name its origin fails the derivation.** A use pointing at
   an ingredient or prepared component the recipe does not contain raises
   `UntraceablePlanFactError` rather than producing a plan with a hole in its
   provenance. Under PDR-0004's `lazy` default a recipe with no plan is a supported
   state; a plan carrying an untraceable fact is not.
4. **The plan contract declares no numeric field.** There is no `value`, `minValue` or
   `maxValue` anywhere in its tree. An amount is the source's own wording, optionally
   followed by the unit the source stated. A deriver therefore has nowhere to put a
   rounded, converted or recomputed figure — rounding is closed by the shape of the
   contract rather than by a check applied to finished output.
5. **Canonical order is preserved: one unit per Canonical step, in the Canonical's
   own order.** Merging two steps into one unit, or splitting one into two, is a
   judgement about the recipe. The deriver makes none.

**And the part this record exists to state plainly:**

6. **A rule leg that rests on a judgement the Canonical does not carry is not
   inferred. It is left out, and it is recorded here that it was left out.**

   S4's START NOW rule has three legs. `needed later` is derivable: it is the index of
   the unit that states the prerequisite, and whether an earlier unit already performs
   it. `slow` and `safe to leave unattended` are not. The Canonical Recipe has no
   field for either, and neither is recoverable from what it does have:

   - **`slow`** is not the step's stated duration. A prerequisite cue usually carries
     no duration at all — "Bring a high-sided pot of salted water to a boil" states
     none — and the duration a step *does* state belongs to the step, not to the
     preparation the cue names. Reading one as the other would be inference.
   - **`safe to leave unattended`** is cooking knowledge about hot fat, a pot on a
     high flame, and what may stand while a kilogram of peppers is cut. It is nowhere
     in the source text and nowhere in the Canonical.

   Deriving either would mean guessing from ingredient names, from verbs, or from a
   table of cooking knowledge the product does not have — exactly the plausible
   inference PDR-0001 and this slice forbid, in the one block whose whole purpose is
   to send the cook away from the stove.

   **So the deriver implements the derivable leg only**, in the shape S4's own data
   supports: a prerequisite cue is admitted when the unit needing it is not the first
   AND that unit's own action does not perform the cue itself. On S4's three recipes
   that reproduces S4's result exactly — the skillet's frying oil refused because the
   unit needing it heats it, Nerano's frying oil refused because it sits on unit 1, the
   pasta water and the oven preheat kept. It is checked as an acceptance criterion
   (`slice6/prerequisite-lookahead-traceable`) rather than asserted here.

   The admission is therefore **narrower than S4's rule, deliberately, and in the safe
   direction**: a cue a human would call slow and unattended-safe can be refused,
   which costs the cook a look-ahead; a cue that is neither cannot be admitted by an
   inference, which would send them to an unattended pan of hot oil. Where the two
   legs are later carried — a Canonical field the conversion fills from what the
   source states, or a cook's own answer — the rule gains them by a record that
   supersedes this one, not by a deriver that starts guessing.

7. **S4's two other findings are carried the same way, as decisions over data that
   already exists.** A qualitative amount is marked, not rounded: `measurable` records
   whether the Canonical's expression carried a figure, so `to taste` never reaches a
   quantity position and no renderer has to re-read the text to find out. The default
   layout is S4's layout A, the separate block, recorded per plan in
   `derivation.quantityPlacement`; layout B remains a switch on the same plan and
   never a second pipeline. Neither costs a model call, because both omit rather than
   reformulate.

## Consequences

- **Plan generation is free and repeatable.** No token cost, no provider dependency,
  no latency on the request path — which is what makes PDR-0004's `lazy` default
  cheap to serve and ADR-0008's fire-and-forget `background` safe to lose. A
  generation lost to a restart degrades to `lazy` because re-deriving costs nothing.
- **A defect in the plan is a defect in the code or in the Canonical, and nothing
  else.** Determinism makes it reproducible from the stored recipe alone, which is
  what a non-deterministic composer would have taken away.
- **The plan cannot say more than the Canonical does.** That is the point, and it is
  also the cost: the look-ahead is narrower than an experienced cook's, and a source
  that states its prerequisites poorly yields a poor plan. The fix is the conversion
  capturing more of what the source states, never the deriver filling the gap.
- **The two missing legs are visible rather than silent.** A later reader can tell a
  rule deliberately left partial from a rule someone forgot to finish, and knows what
  a Canonical field would have to carry before the rule can be completed.
- **The deriver's output is versioned.** `derivation.deriverVersion` accompanies the
  Canonical's own schema version in every plan, so a stored plan derived by an older
  rule can be told apart from one derived by today's.

## Alternatives considered

- **Compose the plan with a second model call.** Rejected. It buys the two missing
  legs by exactly the mechanism PDR-0001 forbids — a model's cooking knowledge
  presented to the cook as the recipe's own instruction — and it would put a
  provider dependency, a token cost and a non-reproducible output on a view that is
  served repeatedly from one import. ADR-0014's one call per conversion would become
  one call per conversion plus one per plan.
- **Derive the two missing legs heuristically** (a verb list for "slow", an
  ingredient list for "safe to leave"). Rejected, and this is the alternative the
  record is really about. A heuristic is a plausible inference with the model taken
  out; it fails the same rule, and it fails it invisibly, because a table of verbs
  looks like code rather than like a guess. Its errors land in the one block that
  tells the cook to walk away from the stove.
- **Ship START NOW empty until all three legs are available.** Rejected: the derivable
  leg alone reproduces S4's measured result on S4's own recipes, so withholding it
  would discard a working look-ahead over a rule that is incomplete rather than wrong.
- **Store `slow` and `safeToLeave` as plan fields the cook fills in.** Rejected for
  this slice: it is a real option, and it is a product decision about what the cook is
  asked, not an architectural one about where facts come from. It belongs to whoever
  takes up the look-ahead's remaining legs, with this record as its starting point.
- **Let the deriver merge steps into phase-shaped units.** Rejected: S4 measured a
  four-to-seven unit range on its three recipes with one unit per step, inside the
  granularity band its evaluation recorded, so merging buys nothing measured and costs
  a judgement about the recipe.
