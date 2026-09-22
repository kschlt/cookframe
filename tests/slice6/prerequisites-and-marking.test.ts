/**
 * CFV1-SL6 — the two safety-relevant properties, and the look-ahead.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * "A missed split or reserved amount" is one of the two failures the item is
 * written around, so these are checked from the canonical side as well as the
 * plan side: not only that what the plan marks is marked correctly, but that
 * every canonical use of a splitting or reserving kind reaches the plan at all.
 * A guard that only inspects what arrived cannot see what was dropped.
 */
import { describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { deriveCookingPlan, stepsInCanonicalOrder } from "../../src/cooking/index.js"
import {
  allRecipes,
  bellPepper,
  nerano,
  readS4Readme,
  resolvesInCanonical,
  s4Recipes,
} from "./fixtures.js"

const ORDINARY = ["use_now", "use_all"]
const SPLITTING = ["use_partial_unspecified", "use_remaining"]
const RESERVING = ["reserve_for_later"]

/**
 * How many uses of each kind a canonical step states.
 *
 * Counted per step, not per recipe, and per bucket rather than by origin id,
 * because a step may legitimately use part of something now AND reserve the
 * rest — Nerano's unit 5 does exactly that with the pasta water, so the same
 * canonical id belongs in two buckets. What must hold is that every use lands
 * in exactly one of them: a count that is short means a reserved or split
 * amount went missing, and one that is long means it was rendered twice.
 */
const bucketsOfStep = (
  step: CanonicalRecipe["instructionSections"][number]["steps"][number],
): { ordinary: number; splitting: number; reserving: number } => {
  const usages = [
    ...step.ingredientUses.map((u) => u.usage),
    ...step.componentUses.map((u) => u.usage),
  ]
  return {
    ordinary: usages.filter((u) => ORDINARY.includes(u)).length,
    splitting: usages.filter((u) => SPLITTING.includes(u)).length,
    reserving: usages.filter((u) => RESERVING.includes(u)).length,
  }
}

const canonicalSteps = (recipe: CanonicalRecipe) =>
  recipe.instructionSections.flatMap((section) => section.steps)

describe("slice6/prerequisite-lookahead-traceable", () => {
  it("names the canonical cue behind every look-ahead item, and the unit it serves", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      const plan = deriveCookingPlan(recipe)
      const ordered = stepsInCanonicalOrder(recipe)
      for (const item of plan.startNow) {
        checked++
        expect(item.origin.element).toBe("stepPrerequisiteCue")
        expect(resolvesInCanonical(recipe, item.origin), `${recipe.id}: ${item.text}`).toBe(true)
        // The cue's own words, and the unit that needs it — both read back from
        // the canonical rather than taken on trust from the plan.
        const step = ordered[item.neededAtUnit - 1]?.step
        expect(step?.id, `${recipe.id}: ${item.text}`).toBe(item.origin.id)
        expect(step?.prerequisiteCues[item.origin.index ?? -1]?.sourceText).toBe(item.text)
        expect(item.neededAtUnit).toBeGreaterThanOrEqual(2)
      }
    }
    expect(checked, "no look-ahead item is under test").toBeGreaterThan(0)
  })

  it("reproduces S4's own finding on S4's own recipes", () => {
    // The real-device pass refused two entries and kept one. All three are in
    // these fixtures, and the derivation has to sort them the same way.
    expect(deriveCookingPlan(bellPepper).startNow.map((i) => i.text)).toEqual([])
    expect(deriveCookingPlan(nerano).startNow.map((i) => i.text)).toEqual([
      "Bring a high-sided pot of salted water to a boil",
    ])
  })

  it("refuses a prerequisite the step performs itself, and keeps one it does not", () => {
    // The skillet's oil is refused because unit 2's own action heats it. Change
    // that action so it no longer does, and the same cue is admitted — which is
    // the rule being consulted rather than the fixture being lucky.
    const notSelfServed: CanonicalRecipe = structuredClone(bellPepper)
    const step = notSelfServed.instructionSections[0]?.steps[1]
    if (!step) throw new Error("the fixture's second step is gone")
    expect(step.prerequisiteCues[0]?.sourceText).toBe("Heat the oil in the skillet")
    step.normalizedActionText = "Saute the bell peppers and onion, then add the garlic."
    expect(deriveCookingPlan(notSelfServed).startNow.map((i) => i.text)).toEqual([
      "Heat the oil in the skillet",
    ])
  })

  it("reads the cue's content words, so rewording the small words does not admit it", () => {
    // The self-served test drops the cue's one- and two-letter words before
    // comparing it with the step's own action. Those are the words whose
    // placement shifts when the same act is worded differently, and requiring
    // them would admit a cue the step plainly performs. The step below still
    // heats the skillet's oil; it just does not say "in".
    const reworded: CanonicalRecipe = structuredClone(bellPepper)
    const step = reworded.instructionSections[0]?.steps[1]
    if (!step) throw new Error("the fixture's second step is gone")
    expect(step.prerequisiteCues[0]?.sourceText).toBe("Heat the oil in the skillet")
    step.normalizedActionText = "Warm the oil, heat a skillet, add peppers and onion."
    expect(deriveCookingPlan(reworded).startNow.map((i) => i.text)).toEqual([])
  })

  it("refuses a prerequisite the first unit needs, because nothing precedes it", () => {
    // Nerano's frying oil sits on unit 1, where pulling it forward gains nothing.
    const first = nerano.instructionSections[0]?.steps[0]
    expect(first?.prerequisiteCues[0]?.sourceText).toBe("Heat frying oil to 150 °C (300 °F)")
    expect(deriveCookingPlan(nerano).startNow.map((i) => i.origin.id)).not.toContain(first?.id)

    // Move the same cue to a later step whose action does not perform it, and it
    // is admitted — so the refusal above is the unit index, not the cue's words.
    const moved: CanonicalRecipe = structuredClone(nerano)
    const steps = moved.instructionSections[0]?.steps
    const cue = steps?.[0]?.prerequisiteCues.shift()
    if (!steps || !cue || !steps[3]) throw new Error("the fixture changed shape")
    steps[3].prerequisiteCues.push(cue)
    expect(deriveCookingPlan(moved).startNow.map((i) => i.text)).toContain(
      "Heat frying oil to 150 °C (300 °F)",
    )
  })
})

describe("slice6/split-amount-is-marked-element", () => {
  it("lands every splitting use in splits, exactly once, on the unit that states it", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      const plan = deriveCookingPlan(recipe)
      const steps = canonicalSteps(recipe)
      for (const unit of plan.units) {
        const expected = bucketsOfStep(steps[unit.n - 1] as never)
        expect(unit.splits.length, `${recipe.id} unit ${unit.n}: splits`).toBe(expected.splitting)
        expect(unit.amounts.length, `${recipe.id} unit ${unit.n}: ordinary amounts`).toBe(
          expected.ordinary,
        )
        checked += unit.splits.length
      }
    }
    expect(checked, "no split is under test").toBeGreaterThan(0)
  })

  it("moves a use out of splits when the canonical stops calling it a split", () => {
    // Without this the counts above could hold for a deriver that routes by
    // something other than the usage kind.
    const whole: CanonicalRecipe = structuredClone(nerano)
    for (const step of canonicalSteps(whole)) {
      for (const use of step.ingredientUses) {
        if (SPLITTING.includes(use.usage)) use.usage = "use_now"
      }
    }
    const plan = deriveCookingPlan(whole)
    expect(plan.units.reduce((t, u) => t + u.splits.length, 0)).toBe(0)
    expect(
      plan.units[5]?.amounts.filter((a) => a.itemText === "Provolone del Monaco"),
    ).toHaveLength(2)
  })

  it("names the whole and leaves the portion empty, because the source never divided it", () => {
    const cream = deriveCookingPlan(nerano).units.find((unit) => unit.splits.length > 0)
    expect(cream?.splits.map((s) => s.portion)).toEqual(["part_of", "remaining"])
    for (const split of cream?.splits ?? []) {
      expect(split.wholeText, "the whole has to be named").toBe("5.3 oz")
      expect(split.amount.text, "a division the source never made was invented").toBe("")
      expect(split.amount.measurable).toBe(false)
    }
  })

  it("keeps the whole out of the portion even when the ingredient states one", () => {
    // Without this the assertion above could hold because the fixture's
    // ingredient has no quantity — it has 5.3 oz, and a deriver that inherited
    // it would print the total on the step that uses only part.
    const provolone = nerano.ingredientGroups
      .flatMap((g) => g.ingredients)
      .find((i) => i.id === "i-provolone")
    expect(provolone?.quantityExpression?.sourceText).toBe("5.3")
  })
})

describe("slice6/reserved-amount-is-marked-element", () => {
  it("lands every reserving use in reserved, exactly once, on the unit that states it", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      const plan = deriveCookingPlan(recipe)
      const steps = canonicalSteps(recipe)
      for (const unit of plan.units) {
        const expected = bucketsOfStep(steps[unit.n - 1] as never)
        expect(unit.reserved.length, `${recipe.id} unit ${unit.n}: reserved`).toBe(
          expected.reserving,
        )
        checked += unit.reserved.length
      }
    }
    expect(checked, "no reserved amount is under test").toBeGreaterThan(0)
  })

  it("keeps the two apart on a unit that both uses and reserves the same thing", () => {
    // Nerano's unit 5 takes a ladle of pasta water now and saves the rest. The
    // same canonical id is therefore in both buckets, legitimately, and the
    // reserved half must not be reachable through the ordinary-amount path.
    const unit = deriveCookingPlan(nerano).units[4]
    expect(unit?.amounts.map((a) => a.origin.id)).toEqual(["c-pasta-water"])
    expect(unit?.reserved.map((r) => r.amount.origin.id)).toEqual(["c-pasta-water"])
    expect(unit?.amounts[0]?.text).toBe("1 ladle")
    expect(unit?.reserved[0]?.amount.text, "the reserved half took the used half's amount").toBe("")
  })

  it("does not print the whole as the portion held back, when the use states no amount", () => {
    // Nerano reserves a prepared component, which carries no total of its own,
    // so that case cannot tell an inherited whole from an empty portion. This
    // one can: reserve an ingredient that states 5.3 oz and say nothing about
    // how much is held back. The plan must not answer "5.3 oz" — the source
    // never divided it, and printing the total reads as the reserved quantity.
    const reservesTheCheese: CanonicalRecipe = structuredClone(nerano)
    const uses = canonicalSteps(reservesTheCheese).flatMap((step) => step.ingredientUses)
    const partial = uses.find((use) => use.usage === "use_partial_unspecified")
    if (!partial) throw new Error("the fixture states no partial use")
    expect(partial.quantityExpression, "the use states its own amount").toBeUndefined()
    partial.usage = "reserve_for_later"

    const held = deriveCookingPlan(reservesTheCheese).units.flatMap((unit) => unit.reserved)
    const cheese = held.find((item) => item.amount.itemText === "Provolone del Monaco")
    expect(cheese, "the reserved cheese is not in the plan").toBeDefined()
    expect(cheese?.amount.text, "the ingredient's total was printed as the portion").toBe("")
    expect(cheese?.amount.measurable).toBe(false)
  })

  it("moves a use into reserved when the canonical says reserve, and back when it does not", () => {
    const reserving = deriveCookingPlan(nerano).units.find((unit) => unit.reserved.length > 0)
    expect(reserving?.reserved[0]?.amount.itemText).toBe("pasta cooking water")

    const notReserved: CanonicalRecipe = structuredClone(nerano)
    for (const step of notReserved.instructionSections[0]?.steps ?? []) {
      for (const use of step.componentUses) {
        if (use.usage === "reserve_for_later") use.usage = "use_now"
      }
    }
    const plan = deriveCookingPlan(notReserved)
    expect(plan.units.reduce((t, u) => t + u.reserved.length, 0)).toBe(0)
    // And it did not vanish: it became an ordinary amount instead.
    expect(plan.units[4]?.amounts.filter((a) => a.itemText === "pasta cooking water")).toHaveLength(
      2,
    )
  })
})

describe("slice6/step-count-within-s4-range", () => {
  it("stays inside the unit-count range S4 recorded, on S4's own recipes", () => {
    // The bounds are read from S4's finding rather than repeated here, so the
    // two cannot drift apart.
    const readme = deriveS4Readme()
    const counts = s4Recipes.map((recipe) => deriveCookingPlan(recipe).units.length)
    expect(Math.min(...counts)).toBe(readme.min)
    expect(Math.max(...counts)).toBe(readme.max)
  })

  it("derives one unit per canonical step, merging and splitting none", () => {
    for (const recipe of allRecipes) {
      const steps = recipe.instructionSections.reduce((t, s) => t + s.steps.length, 0)
      expect(deriveCookingPlan(recipe).units.length, recipe.id).toBe(steps)
    }
  })
})

function deriveS4Readme(): { min: number; max: number } {
  const text = readS4Readme()
  const line = /Observed unit-count range:\*\* min \*\*(\d+)\*\*.*?max \*\*(\d+)\*\*/s.exec(text)
  if (!line?.[1] || !line[2]) throw new Error("S4's finding states no unit-count range")
  return { min: Number(line[1]), max: Number(line[2]) }
}
