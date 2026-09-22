/**
 * What a source appears to HOLD, as distinct from what was read out of it
 * (CFV1-MR1).
 *
 * The first real-photograph run put a magazine spread carrying four recipes
 * through the pipeline and got one back. Not an error and not a warning — one
 * correct recipe, and no trace anywhere that three others had been on the page.
 * That is the worst failure shape this product has, because nothing in the
 * output is wrong, so nothing looks wrong, and the only evidence of the loss was
 * the page the user no longer has in front of them.
 *
 * So both entry paths report an inventory and a source holding more than one
 * recipe is REFUSED with it, rather than truncated to the first or the richest.
 *
 * An inventory is **evidence, not a fact about the source.** Where it comes from
 * a model it is a claim, and it drives the refusal without ever being recorded
 * in the contract — the same rule already settled for block ids, identity,
 * provenance and `structuredSourcePayload`: only a deterministic reader can
 * attest something about the source itself. Nothing here declares a contract
 * shape, and nothing here is persisted.
 */

/** How many recipes a source appears to hold, and the title of each. */
export interface RecipeInventory {
  /** The number of DISTINCT recipes the source appears to hold. */
  readonly count: number
  /**
   * One entry per counted recipe, in order. An entry is `undefined` where the
   * recipe carries no usable title — which is reported as such rather than
   * dropped, so the count and the titles can never disagree.
   */
  readonly titles: readonly (string | undefined)[]
}

/**
 * Thrown when a source holds more than one recipe.
 *
 * Deliberately its own type. It is NOT the "this page could not be mapped" seam
 * a model fallback catches, because a multi-recipe page is not a page to extract
 * one recipe from — importing one from it by any means, deterministic or
 * modelled, is the silent truncation this unit exists to stop, so the two must
 * not be catchable together. It is NOT a reply failure either: the count is a
 * property of the SOURCE, so retrying would spend a paid call on an input that
 * can never conform.
 *
 * `reasonCode`, `recipeCount` and `recipeTitles` are the machine-readable
 * report, in the style the safe-fetch connector's reason codes settled on: a
 * caller distinguishes "this source holds three recipes, titled A, B and C" from
 * "this source could not be read" without parsing the message.
 */
export class MultipleRecipesError extends Error {
  readonly reasonCode = "multiple_recipes" as const
  readonly recipeCount: number
  readonly recipeTitles: readonly (string | undefined)[]

  constructor(inventory: RecipeInventory) {
    super(
      `the source holds ${inventory.count} recipes and was not truncated to one: ` +
        inventory.titles.map((title) => title ?? "(untitled)").join(", "),
    )
    this.name = "MultipleRecipesError"
    this.recipeCount = inventory.count
    this.recipeTitles = inventory.titles
  }
}

/**
 * Thrown when a source's recipe count could not be established at all.
 *
 * Failing CLOSED is the whole point: a source whose count is unknown is refused,
 * never assumed to hold one. Assuming one is precisely the behaviour that lost
 * three recipes without anyone noticing, and an unknown count is the state that
 * behaviour is indistinguishable from.
 */
export class UnknownRecipeCountError extends Error {
  readonly reasonCode = "unknown_recipe_count" as const

  constructor(readonly detail: string) {
    super(`the source's recipe count could not be established, so it was refused: ${detail}`)
    this.name = "UnknownRecipeCountError"
  }
}
