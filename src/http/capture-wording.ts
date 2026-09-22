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
import type { ReasonCode } from "../security/reason-codes.js"

/**
 * The one sentence every address refusal gets. Seven reason codes map to it, and
 * that collapse is the point: which range a name resolved into is what the guard
 * learned and the caller did not, so telling them apart out here would rebuild
 * the resolver oracle ADR-0010 closes.
 */
const ADDRESS_REFUSAL = "that link points at an address this instance will not fetch from."

/**
 * What `OK` would mean here: a fetch the guard did NOT refuse, answered as a
 * refusal anyway. It is a bug in the caller rather than something the person did,
 * so it says so instead of inventing a cause for them.
 */
const UNEXPECTED_OK = "this instance reported a refusal without a reason, which is a fault here."

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

/**
 * A URL refusal, as a sentence — and as LITTLE else.
 *
 * The guard's own `SafeFetchError` carries a message and, on a redirect chain,
 * the hop the refusal was taken on. Neither is relayed. A refusal message from
 * inside the connector can name the address a host resolved to, and the hop URL
 * is that address when the redirect is what was being refused; handing either
 * back would make this route answer a question the caller did not ask and the
 * resolver alone knew. What travels is the `reasonCode` — discriminable, which
 * is the whole reason `reason-codes.ts` exists — and the sentence below.
 *
 * The map is exhaustive over every code but `OK`, so a reason added to the guard
 * has to be given words here before it can reach a person. `OK` is excluded
 * because it is the guard's non-refusal value: reaching this function with it
 * would mean a successful fetch was answered as a failure.
 */
const URL_REFUSAL_WORDING: Record<Exclude<ReasonCode, "OK">, string> = {
  UNPARSEABLE_URL: "that is not a link this instance can read.",
  SCHEME_NOT_ALLOWED: "only http and https links can be imported.",
  // The seven address refusals share one sentence on purpose. Which range a
  // host resolved into is exactly what a caller should not learn from the
  // outside, and the person who submitted the link needs only to know that the
  // link, not their instance, is the problem.
  UNPARSEABLE_ADDRESS: ADDRESS_REFUSAL,
  LOOPBACK: ADDRESS_REFUSAL,
  LINK_LOCAL: ADDRESS_REFUSAL,
  PRIVATE_RANGE: ADDRESS_REFUSAL,
  CGNAT: ADDRESS_REFUSAL,
  UNIQUE_LOCAL: ADDRESS_REFUSAL,
  NON_UNICAST: ADDRESS_REFUSAL,
  SIZE_LIMIT: "that page is larger than this instance will download.",
  CONTENT_TYPE_NOT_ALLOWED: "that link did not answer with a web page.",
  TIME_LIMIT: "that page took too long to answer.",
  REDIRECT_LIMIT: "that link redirected more times than this instance will follow.",
  REDIRECT_INVALID: "that link redirected somewhere this instance could not follow.",
  TRANSPORT: "that page could not be reached.",
}

export function urlRefusalWording(reasonCode: ReasonCode): string {
  const rest = reasonCode === "OK" ? UNEXPECTED_OK : URL_REFUSAL_WORDING[reasonCode]
  return `This link was not imported: ${rest}`
}
