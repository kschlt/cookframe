/**
 * The refusal, in the words a person reads (CFV1-SL5).
 *
 * CFV1-MR1 made a multi-recipe source refuse instead of silently importing one
 * of the recipes it holds. That refusal has so far been machine-readable only —
 * a `reasonCode`, a count and a list of titles that a caller can branch on. On
 * the mobile path there is no caller to branch: there is a person holding a
 * phone, and what they see is whatever sentence comes back.
 *
 * "Something went wrong" would be the worst possible answer here, because it is
 * indistinguishable from the instance being broken. The page is fine, the
 * instance is fine, and the user's next action is obvious once they are told
 * what was found: photograph one of the recipes on its own. So the sentence
 * names the count and EVERY title — not the first, not a sample. A truncated
 * list would reintroduce, in the message, the very loss the refusal exists to
 * report.
 *
 * The wording is built from the error's own declared fields, so it cannot drift
 * from the machine-readable half that travels beside it.
 */
import type { MultipleRecipesError, UnknownRecipeCountError } from "../pipeline/recipe-inventory.js"

/** How an entry with no usable title is named, rather than dropped. */
export const UNTITLED_RECIPE = "one without a title"

/** The refusal as a sentence, for either of the two refusals a person can meet. */
export function refusalWording(error: MultipleRecipesError | UnknownRecipeCountError): string {
  if (error.reasonCode === "unknown_recipe_count") {
    return (
      "This photo was not imported: how many recipes it holds could not be established, " +
      "and importing one of an unknown number is how recipes go missing. " +
      "Try a clearer photo of a single recipe."
    )
  }
  const titles = error.recipeTitles.map((title) => title ?? UNTITLED_RECIPE)
  return (
    `This photo holds ${error.recipeCount} recipes, so none was imported rather than ` +
    `picking one and losing the rest: ${listed(titles)}. ` +
    "Photograph one of them on its own to import it."
  )
}

/** `a`, `a and b`, `a, b and c` — every entry, never an ellipsis. */
function listed(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? ""
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`
}
