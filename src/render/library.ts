/**
 * The library listing (CFV1-SL2).
 *
 * The listing is where discovery lives: it is what has to stay useful as the
 * library grows, while the recipe page only has to be complete. Every signal it
 * shows is source-provided — title, description, authors, attribution,
 * classifications, the source's own total time and its first yield phrase. None
 * is derived, and a recipe that carries none of them still lists.
 *
 * A card whose source had no title lists as the declared gap rather than under
 * a borrowed sentence, so the listing tells the truth about what was captured
 * — and a reader looking for that card knows why it has no name.
 */
import { html } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"
import { NO_TITLE_IN_SOURCE } from "./source-wording.js"
import type { LibraryCardView, TitleView } from "./view-model.js"
import { titleLine } from "./view-model.js"

type Fragment = HtmlEscapedString | Promise<HtmlEscapedString> | string

const nothing = ""

/** Where a card links. Injected so routing stays out of the render module. */
export type RecipeHref = (recipeId: string) => string

const defaultHref: RecipeHref = (recipeId) => `/recipes/${encodeURIComponent(recipeId)}`

/** The card's link text: the source's title, or the gap said out loud. */
const cardTitle = (title: TitleView): Fragment =>
  title.state === "from_source"
    ? html`${title.text}`
    : html`<span class="source-gap">${NO_TITLE_IN_SOURCE}</span>`

const signals = (card: LibraryCardView): Fragment => {
  const items: Fragment[] = [
    card.primaryYield === undefined ? nothing : html`<li>${card.primaryYield}</li>`,
    card.totalTime === undefined ? nothing : html`<li>${card.totalTime}</li>`,
    ...card.classifications.map((text) => html`<li class="tag">${text}</li>`),
  ]
  return html`<ul class="signals">${items}</ul>`
}

const attributionLine = (card: LibraryCardView): Fragment => {
  const parts = [
    card.authors.length === 0 ? undefined : card.authors.join(", "),
    card.sourceAttribution,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? nothing : html`<p class="meta">${parts.join(" · ")}</p>`
}

const cardItem = (card: LibraryCardView, href: RecipeHref): Fragment => html`<li class="card">${
  card.heroImage === undefined
    ? nothing
    : html`<img src="${card.heroImage.src}" alt="${titleLine(card.title)}">`
}
<h2><a href="${href(card.id)}">${cardTitle(card.title)}</a></h2>
${attributionLine(card)}
${signals(card)}
${card.description === undefined ? nothing : html`<p>${card.description}</p>`}
</li>`

/** The library body, without the document shell. */
export function libraryBody(
  cards: readonly LibraryCardView[],
  href: RecipeHref = defaultHref,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<h1>Recipes</h1>
${
  cards.length === 0
    ? html`<p class="empty">No recipes saved yet.</p>`
    : html`<ul class="cards">${cards.map((card) => cardItem(card, href))}</ul>`
}`
}
