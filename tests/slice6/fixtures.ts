/**
 * The Canonical Recipes the Slice 6 proofs derive from, and the two walks they
 * share.
 *
 * Four fixtures, chosen so the properties below are exercised rather than
 * asserted on a recipe that could not break them: the two S4 recipes carry the
 * split, the reserved amount, the prerequisite that its own step performs, and
 * the qualitative amounts; the two older fixtures carry a range, an open-ended
 * rest and a nutrition statement.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type CanonicalOrigin,
  CanonicalRecipe,
  type CookingPlan,
  type PlanAmount,
} from "../../schema/index.js"

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const load = (name: string): CanonicalRecipe =>
  CanonicalRecipe.parse(
    JSON.parse(readFileSync(join(repoRoot, "evals/fixtures/public/canonical", name), "utf8")),
  )

/** S4's simple recipe: 4 units, a prerequisite its own step performs, a seasoning unit. */
export const bellPepper = load("s4-bell-pepper-rice-skillet.json")
/** S4's complex one: 7 units, the genuine split and the reserved pasta water. */
export const nerano = load("s4-spaghetti-alla-nerano.json")
export const gratin = load("two-yields-nutrition.json")
export const onions = load("ranges-and-qualitative.json")

export const s4Recipes: readonly CanonicalRecipe[] = [bellPepper, nerano]
export const allRecipes: readonly CanonicalRecipe[] = [bellPepper, nerano, gratin, onions]

/** Every amount a plan carries, wherever it sits, with a label naming where. */
export function everyAmount(plan: CookingPlan): readonly { where: string; amount: PlanAmount }[] {
  const found: { where: string; amount: PlanAmount }[] = []
  for (const item of plan.fetchPrepare) found.push({ where: "fetchPrepare", amount: item.amount })
  for (const unit of plan.units) {
    for (const amount of unit.amounts) found.push({ where: `unit ${unit.n}`, amount })
    for (const split of unit.splits)
      found.push({ where: `unit ${unit.n} split`, amount: split.amount })
    for (const held of unit.reserved)
      found.push({ where: `unit ${unit.n} reserved`, amount: held.amount })
  }
  return found
}

/** Every origin a plan carries, with a label naming the element it belongs to. */
export function everyOrigin(
  plan: CookingPlan,
): readonly { where: string; origin: CanonicalOrigin }[] {
  const found: { where: string; origin: CanonicalOrigin }[] = []
  for (const item of plan.setUp) found.push({ where: `setUp ${item.text}`, origin: item.origin })
  for (const item of plan.startNow)
    found.push({ where: `startNow ${item.text}`, origin: item.origin })
  for (const item of plan.fetchPrepare) {
    found.push({ where: `fetchPrepare ${item.text}`, origin: item.origin })
    found.push({ where: `fetchPrepare ${item.text} amount`, origin: item.amount.origin })
  }
  for (const unit of plan.units) {
    found.push({ where: `unit ${unit.n}`, origin: unit.origin })
    for (const amount of unit.amounts)
      found.push({ where: `unit ${unit.n} amount`, origin: amount.origin })
    for (const split of unit.splits)
      found.push({ where: `unit ${unit.n} split`, origin: split.amount.origin })
    for (const held of unit.reserved)
      found.push({ where: `unit ${unit.n} reserved`, origin: held.amount.origin })
    for (const critical of unit.critical) {
      found.push({ where: `unit ${unit.n} ${critical.kind}`, origin: critical.origin })
    }
  }
  return found
}

/**
 * Whether an origin names a Canonical element that actually exists, of the kind
 * it claims. This is the check `slice6/every-fact-traces-to-canonical` turns on,
 * so it resolves the id against the recipe rather than trusting the string.
 */
export function resolvesInCanonical(recipe: CanonicalRecipe, origin: CanonicalOrigin): boolean {
  const steps = recipe.instructionSections.flatMap((section) => section.steps)
  const step = steps.find((s) => s.id === origin.id)
  const atIndex = <T>(list: readonly T[]): boolean =>
    origin.index !== undefined && origin.index < list.length
  switch (origin.element) {
    case "step":
      return step !== undefined
    case "ingredient":
      return recipe.ingredientGroups.some((g) => g.ingredients.some((i) => i.id === origin.id))
    case "equipment":
      return (recipe.equipment ?? []).some((e) => e.id === origin.id)
    case "preparedComponent":
      return (recipe.preparedComponents ?? []).some((c) => c.id === origin.id)
    case "stepPrerequisiteCue":
      return step !== undefined && atIndex(step.prerequisiteCues)
    case "stepDoneness":
      return step !== undefined && atIndex(step.donenessCues)
    case "stepWait":
      return step !== undefined && atIndex(step.waitCues)
    case "stepDuration":
      return step !== undefined && atIndex(step.durations)
    case "stepTemperature":
      return step !== undefined && atIndex(step.temperatures)
  }
}

/** Every quantity/duration wording the Canonical itself states, as its own words. */
export function canonicalWordings(recipe: CanonicalRecipe): ReadonlySet<string> {
  const words = new Set<string>()
  for (const group of recipe.ingredientGroups) {
    for (const ingredient of group.ingredients) {
      if (ingredient.quantityExpression) words.add(ingredient.quantityExpression.sourceText)
    }
  }
  for (const equipment of recipe.equipment ?? []) {
    if (equipment.quantityExpression) words.add(equipment.quantityExpression.sourceText)
  }
  for (const section of recipe.instructionSections) {
    for (const step of section.steps) {
      for (const use of step.ingredientUses) {
        if (use.quantityExpression) words.add(use.quantityExpression.sourceText)
      }
      for (const use of step.componentUses) {
        if (use.quantityExpression) words.add(use.quantityExpression.sourceText)
      }
      for (const duration of step.durations) words.add(duration.durationExpression.sourceText)
    }
  }
  return words
}

/** S4's finding, read rather than repeated, so the two cannot drift apart. */
export const readS4Readme = (): string =>
  readFileSync(join(repoRoot, "spikes/s4-cooking-ux/README.md"), "utf8")

/** Every temperature wording the Canonical states, verbatim. */
export const canonicalTemperatures = (recipe: CanonicalRecipe): ReadonlySet<string> =>
  new Set(
    recipe.instructionSections.flatMap((section) =>
      section.steps.flatMap((step) => step.temperatures.map((t) => t.sourceText)),
    ),
  )
