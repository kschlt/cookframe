/**
 * Whole documents: the two entry points a route would call (CFV1-SL2).
 *
 * Each takes a `CanonicalRecipe` (or a list of them), narrows it through the
 * view model, and returns a complete HTML string. Rendering is a pure function
 * of that input: no clock, no random, no ambient state, so the same Canonical
 * Recipe produces byte-identical output — the property
 * `slice2/deterministic-render` checks.
 */
import type { CanonicalRecipe } from "../../schema/index.js"
import { page } from "./layout.js"
import { libraryBody, type RecipeHref } from "./library.js"
import { recipeBody } from "./recipe-page.js"
import { toLibraryCardView, toRecipeView, type ViewOptions } from "./view-model.js"

export function renderRecipePage(recipe: CanonicalRecipe, options: ViewOptions = {}): string {
  const view = toRecipeView(recipe, options)
  return page(view.title, recipeBody(view))
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
