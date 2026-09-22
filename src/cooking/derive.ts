/**
 * Deriving a Cooking Plan from a Canonical Recipe (CFV1-SL6, `ADR-0023`).
 *
 * The derivation is deterministic and reads nothing but the Canonical Recipe.
 * That is the slice's central claim made structural rather than tested: a fact
 * the Canonical does not carry cannot appear in the plan, because there is
 * nowhere for it to come from. `PDR-0001`'s "do not invent" and the item's
 * "fabrication includes plausible inference" are therefore closed by
 * construction rather than by a check applied to finished output — which is
 * what the item's own Hints ask for.
 *
 * Three rules from the S4 real-device evaluation are implemented here, and all
 * three are decisions over data the Canonical already holds, so none of them
 * costs a model call (`spikes/s4-cooking-ux/README.md`):
 *
 * - **START NOW admits only a prerequisite of a later unit** that no earlier
 *   unit produces. S4's rule has two further legs — slow, and safe to leave
 *   unattended — which are judgements the Canonical does not carry; `ADR-0023`
 *   records why they are not inferred here.
 * - **A qualitative amount keeps no quantity position.** `measurable` records
 *   whether the Canonical's expression carried a figure; it is read, never
 *   decided.
 * - **Canonical order is preserved.** One unit per Canonical step, in the order
 *   the Canonical gives them. Merging or splitting steps would be a judgement
 *   about the recipe, so the deriver makes none.
 */
import type {
  CanonicalOrigin,
  CanonicalRecipe,
  CookingPlan,
  CookingUnit,
  CriticalParameter,
  Cue,
  FetchItem,
  Ingredient,
  IngredientUse,
  InstructionStep,
  PlanAmount,
  PrerequisiteItem,
  ReservedAmount,
  SetUpItem,
  SplitAmount,
  ValueExpression,
} from "../../schema/index.js"
import { wording, wordingWithUnit } from "../render/source-wording.js"

/** Bumped when this derivation changes, so a stored plan can be told apart. */
export const DERIVER_VERSION = "1.0.0"

/**
 * Raised when a plan element cannot name the Canonical element it derives from.
 * Derivation fails rather than producing a plan with an untraceable fact: a
 * recipe with no plan is a supported state under `PDR-0004`'s `lazy` default,
 * and a plan whose provenance has a hole is not.
 */
export class UntraceablePlanFactError extends Error {
  constructor(
    readonly recipeId: string,
    readonly what: string,
  ) {
    super(`cannot derive a Cooking Plan for ${recipeId}: ${what} names no canonical element`)
    this.name = "UntraceablePlanFactError"
  }
}

export interface DeriveOptions {
  /**
   * Suppress retrieval reminders for at-hand basics. S4 could not answer the
   * readiness half of that claim in a prototype that marks rather than removes,
   * so the shipped default is off and `OQ-37` stays open.
   */
  readonly suppressAssumedAtHand?: boolean
  /** The stored Canonical version ordinal, when the plan derives from one. */
  readonly canonicalVersion?: number
}

const ingredientTarget = (ingredient: Ingredient): UseTarget => ({
  element: "ingredient",
  id: ingredient.id,
  name: ingredient.name,
  ...(ingredient.quantityExpression !== undefined
    ? { quantityExpression: ingredient.quantityExpression }
    : {}),
  ...(ingredient.unit !== undefined ? { unit: ingredient.unit } : {}),
  sourceRefs: ingredient.sourceRefs,
})

const originOf = (
  element: CanonicalOrigin["element"],
  id: string,
  sourceRefs: CanonicalOrigin["sourceRefs"],
  index?: number,
): CanonicalOrigin => ({
  element,
  id,
  ...(index !== undefined ? { index } : {}),
  sourceRefs: [...sourceRefs],
})

/**
 * Whether the Canonical's expression carried a figure. Read, not decided: the
 * conversion omits a qualitative amount rather than coercing it to a number, so
 * `to taste` arrives with `kind: "qualitative"` and no `value`, while a split
 * keeps whatever figure its source gave.
 */
const isMeasurable = (expression: { kind: string } | undefined): boolean =>
  expression !== undefined && expression.kind !== "qualitative" && expression.kind !== "none"

const amountText = (
  expression: { sourceText: string } | undefined,
  unit: string | undefined,
): string => (expression === undefined ? "" : wordingWithUnit(expression, unit))

/**
 * One use of an ingredient or of a prepared component, as the plan sees it.
 * Both Canonical shapes carry the same four fields this reads, so they are
 * handled once rather than twice.
 */
interface CanonicalUse {
  readonly usage: IngredientUse["usage"]
  readonly quantityExpression?: ValueExpression | undefined
  readonly unit?: string | undefined
  readonly sourceRefs: CanonicalOrigin["sourceRefs"]
}

/** What a use points at: the Canonical element that gives it its name and whole. */
interface UseTarget {
  readonly element: CanonicalOrigin["element"]
  readonly id: string
  readonly name: string
  readonly quantityExpression?: ValueExpression | undefined
  readonly unit?: string | undefined
  readonly sourceRefs: CanonicalOrigin["sourceRefs"]
}

/**
 * `inheritWhole: false` for a split. A use that takes *part* of an ingredient
 * and states no amount of its own has an unknown amount, and falling back to
 * the ingredient's total would print "5.3 oz Provolone" on the step that uses
 * only some of it — the source's whole read as the portion. The total belongs
 * in {@link SplitAmount.wholeText}, where it says what it is; the portion stays
 * empty, because the source never divided it and neither may the plan.
 */
const planAmount = (use: CanonicalUse, target: UseTarget, inheritWhole = true): PlanAmount => {
  // The use's own quantity when it states one, else the target's. Both are the
  // source's wording; neither is recomputed.
  const stated = use.quantityExpression !== undefined
  const expression =
    use.quantityExpression ?? (inheritWhole ? target.quantityExpression : undefined)
  const unit = stated ? use.unit : inheritWhole ? target.unit : undefined
  return {
    text: amountText(expression, unit),
    itemText: target.name,
    measurable: isMeasurable(expression),
    origin: originOf(
      target.element,
      target.id,
      use.sourceRefs.length > 0 ? use.sourceRefs : target.sourceRefs,
    ),
  }
}

const criticalOf = (step: InstructionStep): CriticalParameter[] => [
  ...step.durations.map((duration, index) => ({
    text: wording(duration.durationExpression),
    kind: "duration" as const,
    origin: originOf("stepDuration", step.id, duration.sourceRefs, index),
  })),
  ...step.temperatures.map((temperature, index) => ({
    // The source's own wording of the temperature, never a converted value.
    text: temperature.sourceText,
    kind: "temperature" as const,
    origin: originOf("stepTemperature", step.id, temperature.sourceRefs, index),
  })),
  ...step.donenessCues.map((cue: Cue, index: number) => ({
    text: cue.sourceText,
    kind: "doneness" as const,
    origin: originOf("stepDoneness", step.id, cue.sourceRefs, index),
  })),
  ...step.waitCues.map((cue: Cue, index: number) => ({
    text: cue.sourceText,
    kind: "wait" as const,
    origin: originOf("stepWait", step.id, cue.sourceRefs, index),
  })),
]

/** Every Canonical step, flattened in Canonical order. Nothing is resequenced. */
export const stepsInCanonicalOrder = (
  recipe: CanonicalRecipe,
): readonly { readonly step: InstructionStep; readonly sectionTitle?: string }[] =>
  recipe.instructionSections.flatMap((section) =>
    section.steps.map((step) => ({
      step,
      ...(section.title !== undefined ? { sectionTitle: section.title } : {}),
    })),
  )

/**
 * The S4 admission rule's one derivable leg.
 *
 * A prerequisite cue belongs in START NOW when the unit that needs it is not
 * the first AND no earlier unit produces it. The second half is what separated
 * the two groups in S4's own data: the skillet's oil was refused because the
 * step needing it heats it itself, while the oven and the pasta water were kept
 * because their steps bake and boil in, not preheat and bring to the boil.
 *
 * "Produces it" is read from the Canonical, not guessed: a step produces a
 * prerequisite when the cue's own words appear in the step's action text — the
 * step states the act — rather than only among its prerequisites. The cue's one-
 * and two-letter words are dropped before comparing, because those are the ones
 * whose placement shifts when the same act is worded differently, and requiring
 * them would admit a cue the step plainly performs.
 */
const producedByItsOwnStep = (step: InstructionStep, cue: Cue): boolean => {
  const action = step.normalizedActionText.toLowerCase()
  const words = cue.sourceText
    .toLowerCase()
    .split(/[^\p{L}\p{N}°]+/u)
    .filter((w) => w.length > 2)
  if (words.length === 0) return false
  const carried = words.filter((w) => action.includes(w)).length
  // Every one of those words appearing in the step's own action is the step
  // saying it does the thing itself, not that it needs it done.
  return carried === words.length
}

const startNowOf = (ordered: ReturnType<typeof stepsInCanonicalOrder>): PrerequisiteItem[] => {
  const items: PrerequisiteItem[] = []
  for (const [index, { step }] of ordered.entries()) {
    const n = index + 1
    if (n < 2) continue
    for (const [cueIndex, cue] of step.prerequisiteCues.entries()) {
      if (producedByItsOwnStep(step, cue)) continue
      items.push({
        text: cue.sourceText,
        neededAtUnit: n,
        origin: originOf("stepPrerequisiteCue", step.id, cue.sourceRefs, cueIndex),
      })
    }
  }
  return items
}

/**
 * At-hand basics, as the Canonical can express them: an ingredient the source
 * gave no quantity for at all. Nothing is inferred from an ingredient's NAME —
 * a list of "salt, pepper, oil" would be exactly the plausible inference the
 * slice forbids, and would be the mechanism by which suppression hides a
 * readiness step (`OQ-37`).
 */
const isAtHandBasic = (ingredient: Ingredient): boolean =>
  ingredient.quantityExpression === undefined

/** Derive the Cooking Plan. Pure: same recipe in, byte-identical plan out. */
export function deriveCookingPlan(
  recipe: CanonicalRecipe,
  options: DeriveOptions = {},
): CookingPlan {
  const suppress = options.suppressAssumedAtHand === true
  const ingredients = new Map<string, Ingredient>(
    recipe.ingredientGroups.flatMap((group) =>
      group.ingredients.map((ingredient) => [ingredient.id, ingredient] as const),
    ),
  )
  const components = new Map(
    (recipe.preparedComponents ?? []).map((component) => [component.id, component] as const),
  )
  const ordered = stepsInCanonicalOrder(recipe)

  const units: CookingUnit[] = ordered.map(({ step, sectionTitle }, index) => {
    const amounts: PlanAmount[] = []
    const splits: SplitAmount[] = []
    const reserved: ReservedAmount[] = []

    const targets: readonly (readonly [CanonicalUse, UseTarget])[] = [
      ...step.ingredientUses.map((use) => {
        const ingredient = ingredients.get(use.ingredientId)
        if (ingredient === undefined) {
          throw new UntraceablePlanFactError(
            recipe.id,
            `step ${step.id} uses ingredient ${use.ingredientId}, which`,
          )
        }
        return [use, ingredientTarget(ingredient)] as const
      }),
      ...step.componentUses.map((use) => {
        const component = components.get(use.componentId)
        if (component === undefined) {
          throw new UntraceablePlanFactError(
            recipe.id,
            `step ${step.id} uses prepared component ${use.componentId}, which`,
          )
        }
        return [
          use,
          {
            element: "preparedComponent" as const,
            id: component.id,
            name: component.label,
            sourceRefs: component.sourceRefs,
          },
        ] as const
      }),
    ]

    for (const [use, target] of targets) {
      const whole = amountText(target.quantityExpression, target.unit)
      switch (use.usage) {
        case "reserve_for_later":
          reserved.push({ amount: planAmount(use, target, false) })
          break
        case "use_partial_unspecified":
          splits.push({
            amount: planAmount(use, target, false),
            portion: "part_of",
            wholeText: whole,
          })
          break
        case "use_remaining":
          splits.push({
            amount: planAmount(use, target, false),
            portion: "remaining",
            wholeText: whole,
          })
          break
        default:
          amounts.push(planAmount(use, target))
      }
    }

    return {
      n: index + 1,
      // Carried through unchanged: the Canonical's own normalized action text.
      actionText: step.normalizedActionText,
      ...(sectionTitle !== undefined ? { sectionTitle } : {}),
      amounts,
      splits,
      reserved,
      critical: criticalOf(step),
      produces: step.producesComponents.map((id) => components.get(id)?.label ?? id),
      origin: originOf("step", step.id, step.sourceRefs),
    }
  })

  const setUp: SetUpItem[] = (recipe.equipment ?? []).map((equipment) => ({
    text: equipment.name,
    origin: originOf("equipment", equipment.id, equipment.sourceRefs),
  }))

  const fetchPrepare: FetchItem[] = recipe.ingredientGroups
    .flatMap((group) => group.ingredients)
    .filter((ingredient) => !(suppress && isAtHandBasic(ingredient)))
    .map((ingredient) => ({
      text: ingredient.name,
      amount: {
        text: amountText(ingredient.quantityExpression, ingredient.unit),
        itemText: ingredient.name,
        measurable: isMeasurable(ingredient.quantityExpression),
        origin: originOf("ingredient", ingredient.id, ingredient.sourceRefs),
      },
      origin: originOf("ingredient", ingredient.id, ingredient.sourceRefs),
    }))

  return {
    recipeId: recipe.id,
    title: recipe.title,
    setUp,
    startNow: startNowOf(ordered),
    fetchPrepare,
    units,
    derivation: {
      canonicalSchemaVersion: recipe.schemaVersion,
      ...(options.canonicalVersion !== undefined
        ? { canonicalVersion: options.canonicalVersion }
        : {}),
      deriverVersion: DERIVER_VERSION,
      // S4's recommendation: layout A, the separate block, as the default.
      quantityPlacement: "separate_block",
      assumedAtHandSuppressed: suppress,
    },
  }
}

/**
 * Whether a unit's NOW YOU NEED block earns its place — S4's sharpened rule,
 * in the maintainer's own terms: the block is worth its space where the step is
 * time-critical or has something to lay out in advance, and where every amount
 * is qualitative the action sentence carries it alone.
 *
 * A split or a reserved amount always keeps the block, whatever its wording:
 * missing one silently is the failure this slice is written around.
 */
export const unitNeedsItsAmountBlock = (unit: CookingUnit): boolean => {
  if (unit.splits.length > 0 || unit.reserved.length > 0) return true
  if (unit.amounts.length === 0) return false
  return unit.critical.length > 0 || unit.amounts.some((amount) => amount.measurable)
}
