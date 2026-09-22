/**
 * CFV1-SL6 — the plan changes no canonical fact.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * Two of these are proven on the shape of the contract as well as on derived
 * output, for the reason Slice 2 gives: a test that derives one recipe and finds
 * no altered amount says something about that recipe, while a test showing the
 * plan types carry no numeric field at all says something about every recipe and
 * every future deriver. Both halves are here, because the shape closes rounding
 * and the data check closes re-wording.
 */
import { describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { CookingPlan } from "../../schema/index.js"
import { deriveCookingPlan, UntraceablePlanFactError } from "../../src/cooking/index.js"
import {
  allRecipes,
  bellPepper,
  canonicalTemperatures,
  canonicalWordings,
  everyAmount,
  everyOrigin,
  everyOriginAgainstItsSource,
  nerano,
  resolvesInCanonical,
} from "./fixtures.js"

/** Every key the plan contract declares, anywhere in its tree. */
const contractKeys = (): ReadonlySet<string> => {
  const keys = new Set<string>()
  const walk = (schema: unknown, depth: number): void => {
    if (depth > 12 || schema === null || typeof schema !== "object") return
    const def = (schema as { _def?: Record<string, unknown> })._def
    if (def === undefined) return
    const shape = def.shape
    if (typeof shape === "function") {
      for (const [key, value] of Object.entries(shape() as Record<string, unknown>)) {
        keys.add(key)
        walk(value, depth + 1)
      }
    }
    for (const nested of ["innerType", "type", "schema"]) {
      if (def[nested] !== undefined) walk(def[nested], depth + 1)
    }
    if (Array.isArray(def.options)) for (const option of def.options) walk(option, depth + 1)
  }
  walk(CookingPlan, 0)
  return keys
}

describe("slice6/no-amount-changes", () => {
  it("declares no numeric field anywhere in the plan contract", () => {
    const keys = contractKeys()
    expect(keys.size, "the contract walk found nothing, so it proves nothing").toBeGreaterThan(15)
    for (const forbidden of ["value", "minValue", "maxValue"]) {
      expect([...keys], `the plan contract exposes ${forbidden}`).not.toContain(forbidden)
    }
    // The walk must be able to see a key it should reject, or the loop above is
    // satisfied by a walk that sees nothing.
    expect([...keys]).toContain("sourceRefs")
    expect([...keys]).toContain("measurable")
  })

  it("carries only wordings the canonical itself states", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      const stated = canonicalWordings(recipe)
      for (const { where, amount } of everyAmount(deriveCookingPlan(recipe))) {
        if (amount.text === "") continue
        checked++
        // The unit is appended beside the source's wording and never converted,
        // so an amount is the canonical wording, optionally followed by a unit.
        const matches = [...stated].some(
          (word) => amount.text === word || amount.text.startsWith(`${word} `),
        )
        expect(matches, `${recipe.id} ${where}: "${amount.text}" is not a canonical wording`).toBe(
          true,
        )
      }
    }
    expect(checked, "no amount is under test").toBeGreaterThan(25)
  })

  it("keeps a range a range, and puts no figure on a qualitative amount", () => {
    const plan = deriveCookingPlan(nerano)
    const ranged = plan.units
      .flatMap((unit) => unit.critical)
      .find((critical) => critical.text.includes("5-6"))
    expect(ranged?.text, "the range was collapsed").toBe("5-6 min per batch")

    const qualitative = everyAmount(plan).filter(({ amount }) => !amount.measurable)
    expect(qualitative.length, "no qualitative amount is under test").toBeGreaterThan(0)
    for (const { where, amount } of qualitative) {
      expect(/\d/.test(amount.text), `${where}: "${amount.text}" gained a figure`).toBe(false)
    }
  })
})

describe("slice6/no-temperature-changes", () => {
  it("carries every temperature in the canonical's own words", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      const stated = canonicalTemperatures(recipe)
      for (const unit of deriveCookingPlan(recipe).units) {
        for (const critical of unit.critical.filter((c) => c.kind === "temperature")) {
          checked++
          expect(
            stated.has(critical.text),
            `${recipe.id} unit ${unit.n}: "${critical.text}" is not a canonical temperature`,
          ).toBe(true)
        }
      }
    }
    expect(checked, "no temperature is under test").toBeGreaterThan(0)
  })
})

describe("slice6/every-fact-traces-to-canonical", () => {
  it("resolves every origin to a canonical element of the kind it claims", () => {
    let checked = 0
    for (const recipe of allRecipes) {
      for (const { where, origin } of everyOrigin(deriveCookingPlan(recipe))) {
        checked++
        expect(
          resolvesInCanonical(recipe, origin),
          `${recipe.id} ${where}: origin ${origin.element}/${origin.id} resolves to nothing`,
        ).toBe(true)
      }
    }
    expect(checked, "no origin is under test").toBeGreaterThan(80)
  })

  it("carries the title the source gave, grounded in the recipe it came from", () => {
    for (const recipe of allRecipes) {
      const title = deriveCookingPlan(recipe).title
      expect(title.state, recipe.id).toBe("from_source")
      if (title.state !== "from_source") continue
      expect(title.text, recipe.id).toBe(
        recipe.title.state === "from_source" ? recipe.title.sourceText : "",
      )
    }
  })

  it("says a title is not in the source rather than substituting one", () => {
    // `PDR-0005`: the Canonical stopped carrying `title: string` because the
    // field was being filled with a sentence from the method. A plan that fell
    // back to the recipe id, or to the first unit's action, would put that
    // substitution back one layer further out.
    const untitled: CanonicalRecipe = structuredClone(nerano)
    untitled.title = { state: "not_in_source" }
    const plan = deriveCookingPlan(untitled)
    expect(plan.title).toEqual({ state: "not_in_source" })
    expect(JSON.stringify(plan.title)).not.toContain(untitled.id)
    expect(JSON.stringify(plan.title)).not.toContain(plan.units[0]?.actionText)
  })

  it("carries the canonical's own source references, wherever the fact came from", () => {
    // `element` and `id` say which canonical object gives a fact, and a use
    // naming nothing already fails the derivation. `sourceRefs` is the other
    // half — the one that points back into the source document — and until this
    // check existed it could be emptied at any of eight places with the whole
    // suite green. The expectation is the canonical's own array rather than
    // "not empty", so an element whose refs are genuinely empty stays empty and
    // gains no invented ones.
    let checked = 0
    for (const recipe of allRecipes) {
      for (const { where, actual, expected } of everyOriginAgainstItsSource(
        recipe,
        deriveCookingPlan(recipe),
      )) {
        checked++
        expect(actual, `${recipe.id} ${where}`).toEqual(expected)
      }
    }
    expect(checked, "no source reference is under test").toBeGreaterThan(80)
  })

  it("leaves an element whose references are genuinely empty empty, and invents none", () => {
    // The half of the rule above that the corpus cannot witness: no element in
    // any fixture carries an empty `sourceRefs`, so a deriver that filled an
    // empty list with a reference of its own making passed every proof here.
    // Reproduced before this was written — `originOf` returning an invented
    // ref for an empty list left all 92 green.
    //
    // The element is emptied in the recipe rather than in a fixture: a fixture
    // element with no source references would be one the whole corpus then
    // carries, and this is a property of the deriver, not of a recipe.
    const recipe: CanonicalRecipe = structuredClone(bellPepper)
    const step = recipe.instructionSections[0]?.steps[0]
    const ingredient = recipe.ingredientGroups[0]?.ingredients[0]
    if (!step || !ingredient) throw new Error("the fixture has no first step or first ingredient")
    step.sourceRefs = []
    ingredient.sourceRefs = []
    for (const use of step.ingredientUses) use.sourceRefs = []

    const plan = deriveCookingPlan(recipe)
    const emptied = everyOriginAgainstItsSource(recipe, plan).filter(
      (pair) => pair.expected.length === 0,
    )

    expect(emptied.length, "nothing in the plan reads the emptied element").toBeGreaterThan(0)
    for (const { where, actual } of emptied) {
      expect(actual, `${where}: a source reference was invented`).toEqual([])
    }
  })

  it("resolves a use's inherited references, and does not override the ones it states", () => {
    // An empty `sourceRefs` on a use means "inherit from the element I name"
    // (`schema/canonical-recipe.ts`), so this rule is wrong in both directions:
    // dropping it leaves an amount pointing at nothing, and applying it when
    // the use has refs of its own throws away the more specific location.
    const recipe: CanonicalRecipe = structuredClone(nerano)
    const step = recipe.instructionSections[0]?.steps[3]
    const use = step?.ingredientUses[0]
    const ingredient = recipe.ingredientGroups
      .flatMap((g) => g.ingredients)
      .find((i) => i.id === use?.ingredientId)
    if (!use || !ingredient) throw new Error("the fixture's fourth step uses no ingredient")

    use.sourceRefs = []
    const inheriting = deriveCookingPlan(recipe).units[3]?.amounts[0]
    expect(inheriting?.origin.sourceRefs, "an inherited reference was dropped").toEqual(
      ingredient.sourceRefs,
    )

    use.sourceRefs = [{ blockId: "b-the-use-says-so" }]
    const stating = deriveCookingPlan(recipe).units[3]?.amounts[0]
    expect(stating?.origin.sourceRefs, "the use's own reference was overridden").toEqual([
      { blockId: "b-the-use-says-so" },
    ])
    expect(stating?.origin.sourceRefs).not.toEqual(ingredient.sourceRefs)
  })

  it("fails derivation rather than rendering when a use names nothing", () => {
    const dangling: CanonicalRecipe = structuredClone(nerano)
    const step = dangling.instructionSections[0]?.steps[0]
    const use = step?.ingredientUses[0]
    if (!use) throw new Error("the fixture's first step uses no ingredient")
    use.ingredientId = "i-does-not-exist"
    expect(() => deriveCookingPlan(dangling)).toThrow(UntraceablePlanFactError)
  })

  it("fails the same way when a component use names nothing", () => {
    const dangling: CanonicalRecipe = structuredClone(nerano)
    const step = dangling.instructionSections[0]?.steps[1]
    const use = step?.componentUses[0]
    if (!use) throw new Error("the fixture's second step uses no component")
    use.componentId = "c-does-not-exist"
    expect(() => deriveCookingPlan(dangling)).toThrow(UntraceablePlanFactError)
  })

  it("derives the untouched fixture, so the two failures above are the dangling id", () => {
    expect(() => deriveCookingPlan(nerano)).not.toThrow()
  })
})

describe("slice6/no-canonical-reordering", () => {
  const canonicalStepIds = (recipe: CanonicalRecipe): string[] =>
    recipe.instructionSections.flatMap((section) => section.steps.map((step) => step.id))

  it("emits the canonical steps in canonical order, one unit each", () => {
    for (const recipe of allRecipes) {
      const plan = deriveCookingPlan(recipe)
      expect(
        plan.units.map((unit) => unit.origin.id),
        recipe.id,
      ).toEqual(canonicalStepIds(recipe))
      expect(
        plan.units.map((unit) => unit.n),
        recipe.id,
      ).toEqual(canonicalStepIds(recipe).map((_, i) => i + 1))
    }
  })

  it("follows the canonical when its order changes, rather than a fixed sequence", () => {
    // Without this the assertion above could hold for a deriver that emits a
    // hard-coded order that happens to match every fixture.
    const shuffled: CanonicalRecipe = structuredClone(nerano)
    const steps = shuffled.instructionSections[0]?.steps
    if (!steps) throw new Error("the fixture has no steps")
    steps.reverse()
    const plan = deriveCookingPlan(shuffled)
    expect(plan.units.map((unit) => unit.origin.id)).toEqual(canonicalStepIds(shuffled))
    expect(plan.units.map((unit) => unit.origin.id)).not.toEqual(canonicalStepIds(nerano))
  })

  it("carries each unit's action text through unchanged", () => {
    for (const recipe of allRecipes) {
      const actions = recipe.instructionSections.flatMap((section) =>
        section.steps.map((step) => step.normalizedActionText),
      )
      expect(
        deriveCookingPlan(recipe).units.map((unit) => unit.actionText),
        recipe.id,
      ).toEqual(actions)
    }
  })
})
