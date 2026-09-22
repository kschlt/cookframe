/**
 * The recipe page, rendered from {@link RecipeView} alone (CFV1-SL2).
 *
 * The input type is the view, not the `CanonicalRecipe`: every quantity,
 * duration and temperature has already become a string in `view-model.ts`, so
 * there is no numeric field on this function's parameter for a formatter here
 * to average, round or midpoint. A range arrives as "1–2 tsp" and leaves as
 * "1–2 tsp" because nothing else is available.
 *
 * Everything shown comes from the Canonical Recipe. Nothing on this path reads
 * the Source Snapshot or the original URL, which is the claim the slice exists
 * to demonstrate: a saved recipe stays usable when its source is gone.
 */
import { html } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"
import { NO_TITLE_IN_SOURCE } from "./source-wording.js"
import type {
  EquipmentView,
  IngredientGroupView,
  IngredientView,
  LabelledTextView,
  RecipeView,
  SectionView,
  StepView,
  TitleView,
} from "./view-model.js"
import { titleLine } from "./view-model.js"

type Fragment = HtmlEscapedString | Promise<HtmlEscapedString> | string

const nothing = ""

const qualifierSuffix = (qualifiers: readonly string[]): string =>
  qualifiers.length === 0 ? "" : `, ${qualifiers.join(", ")}`

const ingredientItem = (ingredient: IngredientView): Fragment =>
  html`<li>${
    ingredient.amount === undefined
      ? nothing
      : html`<span class="amount">${ingredient.amount.text}</span> `
  }${ingredient.name}${qualifierSuffix(ingredient.qualifiers)}${
    ingredient.optional ? html` <span class="optional">(optional)</span>` : nothing
  }</li>`

const ingredientGroup = (group: IngredientGroupView): Fragment =>
  html`${
    group.title === undefined ? nothing : html`<h3>${group.title}</h3>`
  }<ul>${group.ingredients.map(ingredientItem)}</ul>`

const equipmentItem = (equipment: EquipmentView): Fragment =>
  html`<li>${
    equipment.quantity === undefined
      ? nothing
      : html`<span class="amount">${equipment.quantity.text}</span> `
  }${equipment.name}${qualifierSuffix(equipment.qualifiers)}</li>`

const annotation = (label: string, values: readonly string[]): Fragment =>
  values.length === 0 ? nothing : html`<li>${label}: ${values.join("; ")}</li>`

const stepItem = (step: StepView): Fragment =>
  html`<li>${step.text}<ul class="annotations">${[
    annotation("Prerequisite", step.prerequisiteCues),
    annotation("Time", step.durations),
    annotation("Temperature", step.temperatures),
    annotation("Wait", step.waitCues),
    annotation("Done when", step.donenessCues),
    annotation("Produces", step.produces),
  ]}</ul></li>`

const section = (view: SectionView): Fragment =>
  html`${
    view.title === undefined ? nothing : html`<h3>${view.title}</h3>`
  }<ol>${view.steps.map(stepItem)}</ol>`

/**
 * The page's heading.
 *
 * The gap gets its own markup rather than a placeholder string in an ordinary
 * `<h1>`: a reader scanning the page sees that this card carried no title,
 * which is the whole point of the declared state. Nothing here can fall back to
 * recipe text — the view has no such string to fall back to.
 */
const titleHeading = (title: TitleView): Fragment =>
  title.state === "from_source"
    ? html`<h1>${title.text}</h1>`
    : html`<h1 class="untitled"><span class="source-gap">${NO_TITLE_IN_SOURCE}</span></h1>`

const timeItem = (time: LabelledTextView): Fragment => html`<li>${time.label}: ${time.text}</li>`

const signals = (view: RecipeView): Fragment => {
  const items: Fragment[] = [
    ...view.yields.map((text) => html`<li>${text}</li>`),
    ...view.times.map(timeItem),
    ...view.classifications.map((text) => html`<li class="tag">${text}</li>`),
  ]
  return items.length === 0 ? nothing : html`<ul class="signals">${items}</ul>`
}

const attributionLine = (view: RecipeView): Fragment => {
  const parts = [
    view.authors.length === 0 ? undefined : view.authors.join(", "),
    view.sourceAttribution,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? nothing : html`<p class="meta">${parts.join(" · ")}</p>`
}

/** The recipe page body, without the document shell. */
export function recipeBody(view: RecipeView): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<article>
${titleHeading(view.title)}
${attributionLine(view)}
${
  view.heroImage === undefined
    ? nothing
    : html`<img src="${view.heroImage.src}" alt="${titleLine(view.title)}">${
        view.heroImage.attribution === undefined
          ? nothing
          : html`<p class="meta">${view.heroImage.attribution}</p>`
      }`
}
${view.description === undefined ? nothing : html`<p>${view.description}</p>`}
${signals(view)}
${
  view.equipment.length === 0
    ? nothing
    : html`<h2>Equipment</h2><ul>${view.equipment.map(equipmentItem)}</ul>`
}
<h2>Ingredients</h2>
${view.ingredientGroups.map(ingredientGroup)}
<h2>Method</h2>
${view.sections.map(section)}
${
  view.nutrition.length === 0
    ? nothing
    : html`<h2>Nutrition as stated by the source</h2>${view.nutrition.map(
        (statement) =>
          html`<h3>${statement.basisText}</h3><ul>${statement.facts.map(
            (fact) => html`<li>${fact.label}: ${fact.text}</li>`,
          )}</ul>`,
      )}`
}
</article>`
}
