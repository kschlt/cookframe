/**
 * Rendering (CFV1-SL2): the library listing and the recipe page, from the
 * Canonical Recipe and nothing else.
 *
 * This barrel deliberately exports no way to reach a Source Snapshot, a stored
 * byte or the original URL, and no module under `src/render/` imports one. That
 * is the slice's central claim made structural rather than tested: a saved
 * recipe renders in full with its source gone, because the render path has no
 * door to the source to begin with.
 */

export { page } from "./layout.js"
export { libraryBody, type RecipeHref } from "./library.js"
export { renderLibraryPage, renderRecipePage } from "./pages.js"
export { recipeBody } from "./recipe-page.js"
export { type SourceWorded, wording, wordingWithUnit } from "./source-wording.js"
export {
  type AmountView,
  type EquipmentView,
  type HeroImageView,
  type IngredientGroupView,
  type IngredientView,
  type LabelledTextView,
  type LibraryCardView,
  type MediaSrcResolver,
  type NutritionView,
  type RecipeView,
  type SectionView,
  type StepView,
  toLibraryCardView,
  toRecipeView,
  type ViewOptions,
} from "./view-model.js"
