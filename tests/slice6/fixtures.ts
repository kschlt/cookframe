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
  type SourceRef,
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
  if (plan.title.state === "from_source") found.push({ where: "title", origin: plan.title.origin })
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
    case "title":
      // The title's grounding is the recipe's own, so the origin names the
      // recipe and the state has to be the one that carries a wording.
      return origin.id === recipe.id && recipe.title.state === "from_source"
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

/**
 * Every origin a plan carries, paired with the source references the Canonical
 * states at the place that fact was read.
 *
 * `element` and `id` say WHICH canonical object gives a fact; `sourceRefs` is
 * the half that points back into the source document, and it was the half no
 * proof touched — emptying it anywhere left the whole suite green. This walk
 * exists so the pairing can be asserted rather than assumed.
 *
 * The expectation is the canonical's own array, never "not empty": an element
 * whose refs are genuinely empty must stay empty. An empty `sourceRefs` on a
 * use means refs are inherited from the element it names (`schema/canonical-
 * recipe.ts`), so a use that states none is expected to carry its target's —
 * which is a rule of its own, and wrong in both directions if the deriver
 * either drops it or applies it when the use has refs of its own.
 */
export function everyOriginAgainstItsSource(
  recipe: CanonicalRecipe,
  plan: CookingPlan,
): readonly { where: string; actual: readonly SourceRef[]; expected: readonly SourceRef[] }[] {
  const pairs: { where: string; actual: readonly SourceRef[]; expected: readonly SourceRef[] }[] =
    []
  const add = (where: string, actual: CanonicalOrigin, expected: readonly SourceRef[]): void => {
    pairs.push({ where, actual: actual.sourceRefs, expected })
  }

  if (plan.title.state === "from_source" && recipe.title.state === "from_source") {
    add("title", plan.title.origin, recipe.title.sourceRefs)
  }

  const equipment = recipe.equipment ?? []
  for (const [index, item] of plan.setUp.entries()) {
    add(`setUp ${item.text}`, item.origin, equipment[index]?.sourceRefs ?? [])
  }

  const ingredients = recipe.ingredientGroups.flatMap((group) => group.ingredients)
  const byIngredientId = new Map(ingredients.map((i) => [i.id, i] as const))
  const byComponentId = new Map((recipe.preparedComponents ?? []).map((c) => [c.id, c] as const))
  for (const item of plan.fetchPrepare) {
    const stated = byIngredientId.get(item.origin.id)?.sourceRefs ?? []
    add(`fetchPrepare ${item.text}`, item.origin, stated)
    add(`fetchPrepare ${item.text} amount`, item.amount.origin, stated)
  }

  const steps = recipe.instructionSections.flatMap((section) => section.steps)
  for (const item of plan.startNow) {
    const cue = steps.find((s) => s.id === item.origin.id)?.prerequisiteCues[
      item.origin.index ?? -1
    ]
    add(`startNow ${item.text}`, item.origin, cue?.sourceRefs ?? [])
  }

  for (const unit of plan.units) {
    const step = steps[unit.n - 1]
    if (step === undefined) continue
    add(`unit ${unit.n}`, unit.origin, step.sourceRefs)

    // Replayed in the deriver's own order — ingredient uses then component uses,
    // each routed by its usage kind — so a use is paired with the amount it
    // produced rather than matched by id, which two uses of one ingredient
    // (Nerano's Provolone) would make ambiguous.
    const uses: { refs: readonly SourceRef[]; target: readonly SourceRef[]; usage: string }[] = [
      ...step.ingredientUses.map((use) => ({
        refs: use.sourceRefs,
        target: byIngredientId.get(use.ingredientId)?.sourceRefs ?? [],
        usage: use.usage as string,
      })),
      ...step.componentUses.map((use) => ({
        refs: use.sourceRefs,
        target: byComponentId.get(use.componentId)?.sourceRefs ?? [],
        usage: use.usage as string,
      })),
    ]
    const inherited = (u: (typeof uses)[number]): readonly SourceRef[] =>
      u.refs.length > 0 ? u.refs : u.target
    const ordinary = uses.filter((u) => u.usage === "use_now" || u.usage === "use_all")
    const splitting = uses.filter(
      (u) => u.usage === "use_partial_unspecified" || u.usage === "use_remaining",
    )
    const reserving = uses.filter((u) => u.usage === "reserve_for_later")

    for (const [i, amount] of unit.amounts.entries()) {
      add(
        `unit ${unit.n} amount ${i}`,
        amount.origin,
        inherited(ordinary[i] as (typeof uses)[number]),
      )
    }
    for (const [i, split] of unit.splits.entries()) {
      add(
        `unit ${unit.n} split ${i}`,
        split.amount.origin,
        inherited(splitting[i] as (typeof uses)[number]),
      )
    }
    for (const [i, held] of unit.reserved.entries()) {
      add(
        `unit ${unit.n} reserved ${i}`,
        held.amount.origin,
        inherited(reserving[i] as (typeof uses)[number]),
      )
    }

    const critical = [
      ...step.durations.map((d) => d.sourceRefs),
      ...step.temperatures.map((t) => t.sourceRefs),
      ...step.donenessCues.map((c) => c.sourceRefs),
      ...step.waitCues.map((c) => c.sourceRefs),
    ]
    for (const [i, parameter] of unit.critical.entries()) {
      add(`unit ${unit.n} ${parameter.kind} ${i}`, parameter.origin, critical[i] ?? [])
    }
  }

  return pairs
}
