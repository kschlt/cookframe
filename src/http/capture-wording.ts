/**
 * What the phone shows the person (CFV1-SL5).
 *
 * Everywhere else in this product a caller reads structured fields and decides
 * what to render. On the mobile path there is no caller: there is someone
 * holding a phone, and what they see is whatever sentence comes back. So the
 * sentences are built here, server-side, from the same declared fields the
 * machine-readable half of the response carries — which is what stops the two
 * from drifting apart.
 *
 * Two things a person has to be told, and both were silent before this slice:
 *
 * **A refusal.** CFV1-MR1 made a multi-recipe source refuse instead of quietly
 * importing one of the recipes it holds, but only as a `reasonCode`, a count and
 * a list of titles. "Something went wrong" would be the worst available answer,
 * because it is indistinguishable from the instance being broken and sends the
 * user looking for a fault that is not there. The page is fine; their next
 * action is obvious once they are told what was found.
 *
 * **A title the source never gave.** PDR-0005 made `title` a declared state
 * rather than a string, because a required field with no source value was being
 * filled with a sentence from the method. The web page says "No title in the
 * source" instead of a borrowed sentence; the phone has to say the same thing,
 * or the defect PDR-0005 closed comes back through this route — a placeholder
 * shown as a name is a placeholder stored as a name, as far as the person
 * reading it can tell.
 */
import type { RecipeTitle } from "../../schema/index.js"
import type { MultipleRecipesError, UnknownRecipeCountError } from "../pipeline/recipe-inventory.js"

/** How an entry with no usable title is named, rather than dropped. */
export const UNTITLED_RECIPE = "one without a title"

/**
 * The words the web page and the library already use for a source that gives no
 * title (PDR-0005). One product, one phrase: a second wording invented here
 * would let the same gap read as two different things depending on where it is
 * met.
 */
export const NO_TITLE_IN_SOURCE = "No title in the source"

/**
 * The import, as a sentence.
 *
 * The gap is carried as a gap. There is no branch here that produces a string
 * standing in for a title — `not_in_source` yields a sentence ABOUT the absence,
 * never a name — so nothing downstream can mistake one for the other.
 */
export function importWording(title: RecipeTitle): string {
  if (title.state === "not_in_source") {
    return `Imported. ${NO_TITLE_IN_SOURCE}, so this recipe has none.`
  }
  return `Imported: ${title.sourceText}`
}

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
