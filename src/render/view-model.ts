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
 *
 * It is told the recipe as well as the identity, because the address a running
 * instance serves a picture at names the RECIPE (`/recipes/:id/picture`), not
 * the bytes: an address by identity would serve whatever the store holds under
 * any identity a caller could name, the kept photographs included.
 */
export type MediaSrcResolver = (storageIdentity: string, recipeId: string) => string

export interface ViewOptions {
  readonly mediaSrc?: MediaSrcResolver
  /**
   * What the caller found out about this recipe's source. It is a fact about the
   * Source Snapshot, which the Canonical Recipe does not carry, so the caller
   * that loaded the snapshot says it. It changes only what the page says when
   * there is no picture of the dish: a photographed page is kept, and it is
   * deliberately not one (`docs/recipe-ontology.md` §7).
   *
   * Absent means `unread`, never "not a photograph": a caller that did not look,
   * or could not, has learned nothing, and a page that read that as a fact would
   * say "none was kept" about a recipe whose photograph the instance holds.
   */
  readonly pictureSource?: PictureSource
}

/**
 * What is known about a recipe's source, for the sentence its page says when it
 * has no picture of the dish. Three values rather than a boolean, because "it is
 * not a photograph" and "nobody could find out" are different facts and only
 * the first may be stated as one.
 */
export type PictureSource = "photographed_page" | "not_photographed" | "unread"

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

/**
 * Why a recipe page shows no picture of the dish. Each one is a different
 * sentence on the page, because each is a different fact:
 *
 *  - `photographed_page` — the source is a photographed page, which is kept and
 *    is not a picture of the dish;
 *  - `none_kept` — the recipe holds no picture of the dish, and its source is
 *    known not to be a photographed page;
 *  - `source_unread` — the recipe holds no picture of the dish, and whether its
 *    source is a photographed page could not be read, so the page says that
 *    instead of guessing either way;
 *  - `not_served` — it holds one, and this rendering was given no way to serve
 *    it.
 */
export type PictureAbsence = "photographed_page" | "none_kept" | "source_unread" | "not_served"

/**
 * The recipe page's picture: shown, or a declared absence with its reason.
 *
 * A union rather than `heroImage?`, for the reason {@link TitleView} is one: an
 * optional field leaves "there is no picture" and "this view forgot to carry
 * it" as the same value, and a page that renders nothing for both says nothing
 * where the source's gap should be stated.
 */
export type PictureView =
  | { readonly state: "shown"; readonly src: string; readonly attribution?: string }
  | { readonly state: "absent"; readonly reason: PictureAbsence }

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
  readonly picture: PictureView
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
  const src = options.mediaSrc(hero.storageIdentity, recipe.id)
  return {
    src,
    ...(hero.attribution !== undefined ? { attribution: hero.attribution } : {}),
  }
}

const pictureOf = (recipe: CanonicalRecipe, options: ViewOptions): PictureView => {
  const shown = heroImageOf(recipe, options)
  if (shown !== undefined) return { state: "shown", ...shown }
  if (recipe.media?.heroImage !== undefined) return { state: "absent", reason: "not_served" }
  const absence: Record<PictureSource, PictureAbsence> = {
    photographed_page: "photographed_page",
    not_photographed: "none_kept",
    unread: "source_unread",
  }
  return { state: "absent", reason: absence[options.pictureSource ?? "unread"] }
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
    picture: pictureOf(recipe, options),
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
