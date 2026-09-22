/**
 * CFV1-SL6 — the two decisions S4's real-device pass settled, carried into the
 * derivation.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * S4's recommendations are read from its own README where they are stated as
 * data, so the two cannot drift apart, and the rules themselves are proven one
 * broken leg at a time. That is the correction S4's review round forced: a
 * check that drives a rule with an input failing several of its conditions at
 * once proves their conjunction and leaves each condition untested.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { CanonicalRecipe, CookingUnit } from "../../schema/index.js"
import { PlanDerivation } from "../../schema/index.js"
import { deriveCookingPlan, unitNeedsItsAmountBlock } from "../../src/cooking/index.js"
import { allRecipes, bellPepper, nerano, onions, readS4Readme, repoRoot } from "./fixtures.js"

const fetchedNames = (recipe: CanonicalRecipe, suppressAssumedAtHand: boolean): string[] =>
  deriveCookingPlan(recipe, { suppressAssumedAtHand }).fetchPrepare.map((item) => item.text)

const ingredientNamed = (recipe: CanonicalRecipe, name: string) => {
  const found = recipe.ingredientGroups.flatMap((g) => g.ingredients).find((i) => i.name === name)
  if (!found) throw new Error(`the fixture no longer lists "${name}"`)
  return found
}

describe("slice6/quantity-placement-follows-s4", () => {
  it("derives S4's recommended layout, and records which layout the plan was derived under", () => {
    // Read from the finding rather than repeated here: S4 recommends A, the
    // separate block, as the default and keeps B as a switch.
    const recommendation = /\*\*Recommendation:\*\* build \*\*(A|B)\*\* as the default/.exec(
      readS4Readme(),
    )
    expect(recommendation?.[1], "S4 states no layout recommendation").toBe("A")

    for (const recipe of allRecipes) {
      expect(deriveCookingPlan(recipe).derivation.quantityPlacement, recipe.id).toBe(
        "separate_block",
      )
    }
    // And B is a switch on the same plan rather than a second contract, which
    // is the other half of the recommendation.
    const placements = PlanDerivation.shape.quantityPlacement.options
    expect([...placements]).toEqual(["separate_block", "inline"])
  })

  it("reproduces S4's own verdict on S4's own seasoning unit", () => {
    // The unit the evaluation read as "you need two tastes Salt and Pepper".
    const seasoning = deriveCookingPlan(bellPepper).units[3]
    expect(seasoning?.amounts.map((a) => a.measurable)).toEqual([false, false, false])
    expect(unitNeedsItsAmountBlock(seasoning as CookingUnit)).toBe(false)
  })

  it("keeps the block where one measurable amount stands beside a qualitative one", () => {
    // S4's own second case: the block stays, and only the qualitative row loses
    // its quantity position. The plan says which row that is without anyone
    // re-reading the text.
    const mixed = deriveCookingPlan(onions).units.find(
      (unit) => unit.amounts.some((a) => a.measurable) && unit.amounts.some((a) => !a.measurable),
    )
    expect(mixed, "no unit mixes a measurable and a qualitative amount").toBeDefined()
    expect(unitNeedsItsAmountBlock(mixed as CookingUnit)).toBe(true)
  })

  it("decides the block from the canonical's own kind, not from the words of the amount", () => {
    // Make the seasoning unit's first use carry a figure and the block returns,
    // with nothing else about the recipe touched — so the rule consults
    // `measurable` rather than matching on "to taste".
    const measured: CanonicalRecipe = structuredClone(bellPepper)
    const use = measured.instructionSections[0]?.steps[3]?.ingredientUses[0]
    if (!use) throw new Error("the fixture's fourth step uses no ingredient")
    expect(use.quantityExpression?.kind).toBe("qualitative")
    use.quantityExpression = { sourceText: "1/2", kind: "exact", value: 0.5 }
    use.unit = "tsp"

    const unit = deriveCookingPlan(measured).units[3]
    expect(unit?.amounts.map((a) => a.measurable)).toEqual([true, false, false])
    expect(unitNeedsItsAmountBlock(unit as CookingUnit)).toBe(true)
  })

  it("keeps the block on a time-critical unit whose amounts are all qualitative", () => {
    // S4 kept this clause deliberately: the two clauses never disagree on its
    // sixteen units, so without a planted case it would be dead weight nobody
    // could tell was dead.
    const timed: CanonicalRecipe = structuredClone(bellPepper)
    const step = timed.instructionSections[0]?.steps[3]
    if (!step) throw new Error("the fixture's fourth step is gone")
    step.durations.push({
      durationExpression: { sourceText: "2", kind: "exact", value: 2, unit: "min" },
      sourceRefs: [...step.sourceRefs],
    })

    const unit = deriveCookingPlan(timed).units[3]
    expect(
      unit?.amounts.every((a) => !a.measurable),
      "the planted case lost its point",
    ).toBe(true)
    expect(unitNeedsItsAmountBlock(unit as CookingUnit)).toBe(true)
  })

  it("keeps the block for a split or a reserved amount, which carry no figure at all", () => {
    // A portion is empty by construction, because the source never divided it,
    // so the measurable clause alone would drop exactly the two elements the
    // slice is written around. Both are driven on a unit that has nothing else
    // to keep the block, so it is that clause answering and not another.
    const plan = deriveCookingPlan(nerano)
    const split = plan.units.find((unit) => unit.splits.length > 0)?.splits[0]
    const reserved = plan.units.find((unit) => unit.reserved.length > 0)?.reserved[0]
    if (!split || !reserved) throw new Error("the fixture carries no split or no reserved amount")
    expect(split.amount.measurable, "the split gained a figure").toBe(false)
    expect(reserved.amount.measurable, "the reserved amount gained a figure").toBe(false)

    const bare: CookingUnit = {
      n: 1,
      actionText: "Stir it in.",
      amounts: [],
      splits: [],
      reserved: [],
      critical: [],
      produces: [],
      origin: split.amount.origin,
    }
    expect(unitNeedsItsAmountBlock(bare), "a unit with nothing on it").toBe(false)
    expect(unitNeedsItsAmountBlock({ ...bare, splits: [split] }), "with only a split").toBe(true)
    expect(unitNeedsItsAmountBlock({ ...bare, reserved: [reserved] }), "with only a reserve").toBe(
      true,
    )
    // And a qualitative amount on its own still does not earn it, so the two
    // above are the split and the reserve rather than "anything in a bucket".
    expect(
      unitNeedsItsAmountBlock({ ...bare, amounts: [{ ...split.amount, text: "to taste" }] }),
      "with only a qualitative amount",
    ).toBe(false)
  })
})

describe("slice6/assumed-at-hand-follows-s4", () => {
  it("ships suppression off, as S4 recommends, and says so in every plan it derives", () => {
    expect(readS4Readme()).toMatch(
      /\*\*Recommendation:\*\* ship suppression \*\*off by default\*\*/,
    )
    for (const recipe of allRecipes) {
      const plan = deriveCookingPlan(recipe)
      expect(plan.derivation.assumedAtHandSuppressed, recipe.id).toBe(false)
      const listed = recipe.ingredientGroups.flatMap((g) => g.ingredients).map((i) => i.name)
      expect(
        plan.fetchPrepare.map((item) => item.text),
        recipe.id,
      ).toEqual(listed)
    }
  })

  it("leaves OQ-37 open, so the default cannot be flipped without the record moving", () => {
    const questions = readFileSync(join(repoRoot, "docs/open-questions.md"), "utf8")
    const row = questions.split("\n").find((line) => line.startsWith("| OQ-37 "))
    expect(row, "OQ-37 is not in the register").toBeDefined()
    expect(row).toMatch(/\|\s*open\b/)
  })

  it("removes only what the canonical gives no quantity for, never what a name suggests", () => {
    // With suppression on, exactly the three ingredients the source states no
    // amount for leave the list.
    const noAmount = bellPepper.ingredientGroups
      .flatMap((g) => g.ingredients)
      .filter((i) => i.quantityExpression === undefined)
      .map((i) => i.name)
    expect(noAmount.length, "the fixture states an amount for everything").toBeGreaterThan(0)
    expect(fetchedNames(bellPepper, true)).toEqual(
      fetchedNames(bellPepper, false).filter((name) => !noAmount.includes(name)),
    )
  })

  it("keeps a basic the source did measure, and drops a non-basic it did not", () => {
    // The two halves of the same leg. Without them the check above could hold
    // for a deriver that suppresses by the ingredient's name, which is the
    // plausible inference this slice forbids.
    const measuredSalt: CanonicalRecipe = structuredClone(bellPepper)
    const salt = ingredientNamed(measuredSalt, "salt")
    salt.quantityExpression = { sourceText: "1", kind: "exact", value: 1 }
    salt.unit = "tsp"
    expect(fetchedNames(measuredSalt, true)).toContain("salt")

    const unmeasuredPeppers: CanonicalRecipe = structuredClone(bellPepper)
    const peppers = ingredientNamed(unmeasuredPeppers, "bell peppers")
    peppers.quantityExpression = undefined
    peppers.unit = undefined
    expect(fetchedNames(unmeasuredPeppers, true)).not.toContain("bell peppers")
  })

  it("touches nothing but the retrieval list, which is what OQ-37 is open about", () => {
    // S4 could not answer whether suppression can hide a DERIVED readiness
    // step. It cannot here, because suppression reaches neither START NOW nor
    // the units — and that is asserted on recipes that have both.
    for (const recipe of allRecipes) {
      const off = deriveCookingPlan(recipe)
      const on = deriveCookingPlan(recipe, { suppressAssumedAtHand: true })
      expect(JSON.stringify(on.startNow), `${recipe.id}: START NOW`).toBe(
        JSON.stringify(off.startNow),
      )
      expect(JSON.stringify(on.units), `${recipe.id}: the units`).toBe(JSON.stringify(off.units))
      expect(JSON.stringify(on.setUp), `${recipe.id}: the equipment`).toBe(
        JSON.stringify(off.setUp),
      )
    }
    expect(deriveCookingPlan(nerano).startNow.length, "no look-ahead item is under test").toBe(1)
  })

  it("records the switch it was derived under, so a stored plan is not read the wrong way", () => {
    expect(
      deriveCookingPlan(bellPepper, { suppressAssumedAtHand: true }).derivation
        .assumedAtHandSuppressed,
    ).toBe(true)
  })
})
