/**
 * Whole documents: the two entry points a route would call (CFV1-SL2).
 *
 * Each takes a `CanonicalRecipe` (or a list of them), narrows it through the
 * view model, and returns a complete HTML string. Rendering is a pure function
 * of that input: no clock, no random, no ambient state, so the same Canonical
 * Recipe produces byte-identical output — the property
 * `slice2/deterministic-render` checks.
 */
import type { CanonicalRecipe, CookingPlan } from "../../schema/index.js"
import { cookingBody, planTitleLine } from "./cooking-view.js"
import { page } from "./layout.js"
import { libraryBody, type RecipeHref } from "./library.js"
import { recipeBody } from "./recipe-page.js"
import { titleLine, toLibraryCardView, toRecipeView, type ViewOptions } from "./view-model.js"

export function renderRecipePage(recipe: CanonicalRecipe, options: ViewOptions = {}): string {
  const view = toRecipeView(recipe, options)
  return page(titleLine(view.title), recipeBody(view))
}

export interface LibraryPageOptions extends ViewOptions {
  readonly href?: RecipeHref
}

export function renderLibraryPage(
  recipes: readonly CanonicalRecipe[],
  options: LibraryPageOptions = {},
): string {
  const cards = recipes.map((recipe) => toLibraryCardView(recipe, options))
  return page("Recipes", libraryBody(cards, options.href))
}

/**
 * The cooking view for one derived plan (CFV1-SL6). Like the other two, a pure
 * function of its input: the plan is already numeric-free and carries its own
 * layout decision in `derivation.quantityPlacement`, so the same plan renders to
 * byte-identical HTML.
 */
export function renderCookingPage(plan: CookingPlan): string {
  return page(planTitleLine(plan.title), cookingBody(plan))
}
