/**
 * The render view model: a Canonical Recipe narrowed to the strings a page may
 * show (CFV1-SL2).
 *
 * Two of this slice's properties are enforced here rather than by discipline:
 *
 * 1. **No invented numbers.** Every quantity, duration, temperature and yield
 *    crosses into the view as an already-rendered `string`, produced only by
 *    {@link wording} / {@link wordingWithUnit}. The view types carry no `value`,
 *    `minValue` or `maxValue` anywhere, so a formatter downstream of this module
 *    cannot average a range or put a number on "a splash": the numbers are not
 *    on the type it receives. `tests/slice2` checks the property on the shape
 *    itself, not on one sample of output.
 *
 * 2. **Canonical-only.** The view is built from a `CanonicalRecipe` and nothing
 *    else. Bytes are the one thing a page needs that the Canonical does not
 *    hold, and rather than reaching into storage this module takes a caller-
 *    supplied {@link MediaSrcResolver} — the same injected-seam shape as
 *    `ADR-0004`. With no resolver the page renders without its image, which is
 *    exactly the "source is gone" case the slice exists to demonstrate.
 *
 * 3. **A title the source never gave stays absent.** {@link TitleView} carries a
 *    `text` only in its `from_source` variant, so a page that shows a title has
 *    to name the variant it is showing. There is no string to reach for on the
 *    `not_in_source` side and no fallback that quietly supplies one — the same
 *    shape as property 1, applied to the field `spikes/s1-photo-gate/VERDICT.md`
 *    found manufactured.
 */
import type {
  CanonicalRecipe,
  Equipment,
  Ingredient,
  IngredientGroup,
  InstructionSection,
  InstructionStep,
  NutritionStatement,
  RecipeTime,
  RecipeYield,
} from "../../schema/index.js"
import { NO_TITLE_IN_SOURCE, wording, wordingWithUnit } from "./source-wording.js"

/**
 * Resolves a stored hero image's `storageIdentity` to something an `<img src>`
 * can use. Injected, because how bytes are served is a storage concern and a
 * render module that knew it could no longer claim to be Canonical-only.
 */
export type MediaSrcResolver = (storageIdentity: string) => string

export interface ViewOptions {
  readonly mediaSrc?: MediaSrcResolver
}

/**
 * The recipe's name as a page may show it: the source's own wording, or the
 * declared gap.
 *
 * A discriminated union rather than `title?: string`, for the reason
 * `RecipeTitle` is one in the contract. An optional string leaves "the source
 * had no title" and "this view forgot to carry it" as the same value, and a
 * page that renders `title ?? something` is one `??` away from putting a
 * sentence from the method back in the heading.
 */
export type TitleView =
  | { readonly state: "from_source"; readonly text: string }
  | { readonly state: "not_in_source" }

/**
 * A title reduced to one line of display text, for the places that can hold
 * nothing else: `<title>`, an image's `alt`.
 *
 * The gap keeps saying it is a gap here too — {@link NO_TITLE_IN_SOURCE} is a
 * sentence about the source, so a browser tab reading "No title in the source"
 * is still telling the truth, where a blank or a recipe id would not.
 */
export const titleLine = (title: TitleView): string =>
  title.state === "from_source" ? title.text : NO_TITLE_IN_SOURCE

export interface AmountView {
  /** The source's own wording, with its unit when the unit sits beside it. */
  readonly text: string
}

export interface LabelledTextView {
  readonly label: string
  readonly text: string
}

export interface IngredientView {
  readonly id: string
  readonly name: string
  readonly amount?: AmountView
  readonly qualifiers: readonly string[]
  readonly optional: boolean
}

export interface IngredientGroupView {
  readonly id: string
  readonly title?: string
  readonly ingredients: readonly IngredientView[]
}

export interface StepView {
  readonly id: string
  readonly text: string
  readonly durations: readonly string[]
  readonly temperatures: readonly string[]
  readonly donenessCues: readonly string[]
  readonly prerequisiteCues: readonly string[]
  readonly waitCues: readonly string[]
  readonly produces: readonly string[]
}

export interface SectionView {
  readonly id: string
  readonly title?: string
  readonly steps: readonly StepView[]
}

export interface EquipmentView {
  readonly id: string
  readonly name: string
  readonly quantity?: AmountView
  readonly qualifiers: readonly string[]
}

export interface NutritionView {
  readonly id: string
  readonly basisText: string
  readonly facts: readonly LabelledTextView[]
}

export interface HeroImageView {
  readonly src: string
  readonly attribution?: string
}

export interface RecipeView {
  readonly id: string
  readonly title: TitleView
  readonly description?: string
  readonly authors: readonly string[]
  /** Source-provided attribution; absent stays absent, never a placeholder. */
  readonly sourceAttribution?: string
  readonly classifications: readonly string[]
  readonly yields: readonly string[]
  readonly times: readonly LabelledTextView[]
  readonly equipment: readonly EquipmentView[]
  readonly ingredientGroups: readonly IngredientGroupView[]
  readonly sections: readonly SectionView[]
  readonly nutrition: readonly NutritionView[]
  readonly heroImage?: HeroImageView
}

/**
 * The listing's view of one recipe. Deliberately NOT `ADR-0003`'s
 * `LibraryEntry`: that interface is the repository's, is under evaluation in
 * `CFV1-DBQ`, and carries what a query returns rather than what a listing shows.
 */
export interface LibraryCardView {
  readonly id: string
  readonly title: TitleView
  readonly description?: string
  readonly authors: readonly string[]
  readonly sourceAttribution?: string
  readonly classifications: readonly string[]
  readonly totalTime?: string
  readonly primaryYield?: string
  readonly heroImage?: HeroImageView
}

const amountOf = (
  expression: { sourceText: string } | undefined,
  unit: string | undefined,
): AmountView | undefined =>
  expression === undefined ? undefined : { text: wordingWithUnit(expression, unit) }

const timeLabel = (time: RecipeTime): string => time.sourceLabel ?? time.type

/** A yield keeps the source's own complete phrase, including its context. */
const yieldText = (recipeYield: RecipeYield): string => recipeYield.sourceText

const ingredientView = (ingredient: Ingredient): IngredientView => {
  const amount = amountOf(ingredient.quantityExpression, ingredient.unit)
  return {
    id: ingredient.id,
    name: ingredient.name,
    ...(amount !== undefined ? { amount } : {}),
    qualifiers: [...ingredient.qualifiers],
    optional: ingredient.optional === true,
  }
}

const groupView = (group: IngredientGroup): IngredientGroupView => ({
  id: group.id,
  ...(group.title !== undefined ? { title: group.title } : {}),
  ingredients: group.ingredients.map(ingredientView),
})

const equipmentView = (equipment: Equipment): EquipmentView => {
  const quantity = amountOf(equipment.quantityExpression, undefined)
  return {
    id: equipment.id,
    name: equipment.name,
    ...(quantity !== undefined ? { quantity } : {}),
    qualifiers: [...equipment.qualifiers],
  }
}

const stepView = (
  step: InstructionStep,
  componentLabels: ReadonlyMap<string, string>,
): StepView => ({
  id: step.id,
  text: step.normalizedActionText,
  durations: step.durations.map((d) => wording(d.durationExpression)),
  temperatures: step.temperatures.map((t) => t.sourceText),
  donenessCues: step.donenessCues.map((c) => c.sourceText),
  prerequisiteCues: step.prerequisiteCues.map((c) => c.sourceText),
  waitCues: step.waitCues.map((c) => c.sourceText),
  produces: step.producesComponents.map((id) => componentLabels.get(id) ?? id),
})

const sectionView = (
  section: InstructionSection,
  componentLabels: ReadonlyMap<string, string>,
): SectionView => ({
  id: section.id,
  ...(section.title !== undefined ? { title: section.title } : {}),
  steps: section.steps.map((step) => stepView(step, componentLabels)),
})

const nutritionView = (statement: NutritionStatement): NutritionView => ({
  id: statement.id,
  basisText: statement.basis.sourceText ?? statement.basis.kind,
  facts: statement.facts.map((fact) => ({
    label: fact.sourceLabel ?? fact.nutrient,
    text: wordingWithUnit(fact.valueExpression, fact.unit),
  })),
})

/**
 * Source attribution as the source gave it. A recipe with neither a publisher
 * nor a source name has none — the field is absent rather than empty or
 * invented (recipe-ontology §5.1).
 */
const attributionOf = (recipe: CanonicalRecipe): string | undefined =>
  recipe.sourcePublisher ?? recipe.sourceName

const classificationsOf = (recipe: CanonicalRecipe): string[] =>
  (recipe.sourceClassifications ?? []).map((c) => c.sourceText)

const heroImageOf = (recipe: CanonicalRecipe, options: ViewOptions): HeroImageView | undefined => {
  const hero = recipe.media?.heroImage
  if (hero === undefined || options.mediaSrc === undefined) return undefined
  const src = options.mediaSrc(hero.storageIdentity)
  return {
    src,
    ...(hero.attribution !== undefined ? { attribution: hero.attribution } : {}),
  }
}

/**
 * The contract's title, narrowed to the view's.
 *
 * The two states map one to one — nothing is folded together here, because the
 * whole point of the contract's union is that a reader can tell them apart.
 */
const titleView = (recipe: CanonicalRecipe): TitleView =>
  recipe.title.state === "from_source"
    ? { state: "from_source", text: recipe.title.sourceText }
    : { state: "not_in_source" }

/** The whole recipe, narrowed to what a page may show. */
export function toRecipeView(recipe: CanonicalRecipe, options: ViewOptions = {}): RecipeView {
  const componentLabels = new Map(
    (recipe.preparedComponents ?? []).map((component) => [component.id, component.label]),
  )
  const attribution = attributionOf(recipe)
  const hero = heroImageOf(recipe, options)
  return {
    id: recipe.id,
    title: titleView(recipe),
    ...(recipe.description !== undefined ? { description: recipe.description } : {}),
    authors: [...(recipe.authors ?? [])],
    ...(attribution !== undefined ? { sourceAttribution: attribution } : {}),
    classifications: classificationsOf(recipe),
    yields: recipe.yields.map(yieldText),
    times: (recipe.times ?? []).map((time) => ({
      label: timeLabel(time),
      text: wording(time.durationExpression),
    })),
    equipment: (recipe.equipment ?? []).map(equipmentView),
    ingredientGroups: recipe.ingredientGroups.map(groupView),
    sections: recipe.instructionSections.map((section) => sectionView(section, componentLabels)),
    nutrition: (recipe.nutritionStatements ?? []).map(nutritionView),
    ...(hero !== undefined ? { heroImage: hero } : {}),
  }
}

/**
 * The listing's view. The discovery signals are all source-provided: title,
 * description, authors, attribution, classifications, total time and the first
 * yield. A recipe without a `total` time contributes no time signal rather than
 * a summed one — summing `prep` and `cook` would be a derived number the source
 * never stated.
 */
export function toLibraryCardView(
  recipe: CanonicalRecipe,
  options: ViewOptions = {},
): LibraryCardView {
  const total = (recipe.times ?? []).find((time) => time.type === "total")
  const primaryYield = recipe.yields[0]
  const attribution = attributionOf(recipe)
  const hero = heroImageOf(recipe, options)
  return {
    id: recipe.id,
    title: titleView(recipe),
    ...(recipe.description !== undefined ? { description: recipe.description } : {}),
    authors: [...(recipe.authors ?? [])],
    ...(attribution !== undefined ? { sourceAttribution: attribution } : {}),
    classifications: classificationsOf(recipe),
    ...(total !== undefined ? { totalTime: wording(total.durationExpression) } : {}),
    ...(primaryYield !== undefined ? { primaryYield: yieldText(primaryYield) } : {}),
    ...(hero !== undefined ? { heroImage: hero } : {}),
  }
}
