/**
 * The cooking view, rendered from a {@link CookingPlan} alone (CFV1-SL6).
 *
 * Its layout is S4's layout **A**, which the real-device pass recommended and
 * `ADR-0023` records the derivation following: the amounts a unit needs stand in
 * their own block above the action sentence, rather than being written into it.
 * Every choice below is one of S4's findings applied, not a judgement made fresh
 * here — the findings live in `spikes/s4-cooking-ux/README.md`.
 *
 * **The input is the plan itself, not a second view type.** `recipe-page.ts`
 * narrows a `CanonicalRecipe` through `view-model.ts` because the contract
 * carries numbers a formatter here could round. The Cooking Plan carries none —
 * `slice6/no-amount-changes` proves the contract declares no numeric field
 * anywhere in its tree — so it is already the shape a view type would produce,
 * and a second narrowing would only be a second place for a wording to drift
 * from the source's.
 *
 * Three rules are rendering, and all three come from S4:
 *
 *  - **A qualitative amount keeps no quantity position** (finding 5). `to taste`
 *    stood in the quantity column and was read as a count — *"two tastes Salt"*.
 *    A row whose amount is not measurable shows the item alone and lets the
 *    action sentence carry the rest.
 *  - **The NOW YOU NEED block earns its place** (finding 1). It appears where
 *    the unit is time-critical or has something to lay out, and not where it
 *    would only repeat the seasoning the sentence below already names. The rule
 *    itself is `unitNeedsItsAmountBlock`, in the derivation, so the page and the
 *    stored plan cannot disagree about it.
 *  - **START NOW never drops an entry silently** (finding 4). When the plan
 *    admits nothing, the block says so rather than vanishing — a cook who has
 *    seen it on one recipe must not read its absence on the next as "nothing to
 *    start".
 *
 * A split and a reserved amount get their own markup and their own words. They
 * are the two failures this slice is written around, and "unmissable" is settled
 * by S4's findings as a visual treatment rather than decided here: what this
 * module must not do is render either one as an ordinary quantity.
 */
import { html } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"
import type {
  CookingPlan,
  CookingUnit,
  CriticalParameter,
  PlanAmount,
  PlanTitle,
  ReservedAmount,
  SplitAmount,
} from "../../schema/index.js"
import { unitNeedsItsAmountBlock } from "../cooking/index.js"
import { NO_TITLE_IN_SOURCE } from "./source-wording.js"

type Fragment = HtmlEscapedString | Promise<HtmlEscapedString> | string

const nothing = ""

/** One line of display text for a plan's title, for `<title>` and nothing else. */
export const planTitleLine = (title: PlanTitle): string =>
  title.state === "from_source" ? title.text : NO_TITLE_IN_SOURCE

/**
 * An amount and its item, in S4's corrected form: the quantity position is for
 * a measurable amount and nothing else, so `to taste Salt` becomes `Salt`.
 */
const amountRow = (amount: PlanAmount): Fragment =>
  amount.measurable && amount.text !== ""
    ? html`<li><span class="amount">${amount.text}</span> ${amount.itemText}</li>`
    : html`<li>${amount.itemText}</li>`

/**
 * A split, named as one. The source divided nothing, so neither does this: the
 * whole is named and the portion is described, never computed.
 */
const splitRow = (split: SplitAmount): Fragment =>
  html`<li class="split"><span class="mark">Split</span> ${
    split.portion === "part_of" ? "part of" : "the rest of"
  }${split.wholeText === "" ? nothing : html` <span class="amount">${split.wholeText}</span>`} ${
    split.amount.itemText
  }</li>`

/** A reserved amount, named as one — what is held back, and for when it is known. */
const reservedRow = (held: ReservedAmount): Fragment =>
  html`<li class="reserved"><span class="mark">Keep back</span>${
    held.amount.measurable && held.amount.text !== ""
      ? html` <span class="amount">${held.amount.text}</span>`
      : nothing
  } ${held.amount.itemText}${
    held.neededAtUnit === undefined ? nothing : html` — needed at step ${held.neededAtUnit}`
  }</li>`

const CRITICAL_LABEL: Record<CriticalParameter["kind"], string> = {
  duration: "Time",
  temperature: "Temperature",
  doneness: "Done when",
  wait: "Wait",
}

const criticalRow = (parameter: CriticalParameter): Fragment =>
  html`<li>${CRITICAL_LABEL[parameter.kind]}: ${parameter.text}</li>`

/**
 * One cooking unit. The block above the sentence is layout A; whether it appears
 * is the derivation's rule, consulted rather than re-decided here.
 */
const unitItem = (unit: CookingUnit): Fragment =>
  html`<li class="unit">${
    unitNeedsItsAmountBlock(unit)
      ? html`<p class="block-label">Now you need</p><ul class="now-you-need">${[
          ...unit.amounts.map(amountRow),
          ...unit.splits.map(splitRow),
          ...unit.reserved.map(reservedRow),
        ]}</ul>`
      : nothing
  }<p class="action">${unit.actionText}</p>${
    unit.critical.length === 0
      ? nothing
      : html`<ul class="annotations">${unit.critical.map(criticalRow)}</ul>`
  }${
    unit.produces.length === 0
      ? nothing
      : html`<p class="produces">Makes: ${unit.produces.join(", ")}</p>`
  }</li>`

/** The heading, with the declared gap shown as a gap (`PDR-0005`). */
const heading = (title: PlanTitle): Fragment =>
  title.state === "from_source"
    ? html`<h1>${title.text}</h1>`
    : html`<h1><span class="source-gap">${NO_TITLE_IN_SOURCE}</span></h1>`

/**
 * START NOW, which says what it found and what it did not. S4's finding 4 is
 * the reason for the second half: the block that sends a cook away from the
 * stove must not be indistinguishable from a block nobody rendered.
 */
const startNow = (plan: CookingPlan): Fragment =>
  html`<h2>Start now</h2>${
    plan.startNow.length === 0
      ? html`<p class="empty">Nothing here has to be started before step 1.</p>`
      : html`<ul class="start-now">${plan.startNow.map(
          (item) =>
            html`<li>${item.text} <span class="for-step">— for step ${item.neededAtUnit}</span></li>`,
        )}</ul>`
  }`

/** The whole cooking body, ready for the page shell. */
export function cookingBody(plan: CookingPlan): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`${heading(plan.title)}${
    plan.setUp.length === 0
      ? nothing
      : html`<h2>Set up</h2><ul class="set-up">${plan.setUp.map(
          (item) => html`<li>${item.text}</li>`,
        )}</ul>`
  }${startNow(plan)}${
    plan.fetchPrepare.length === 0
      ? nothing
      : html`<h2>Fetch and prepare</h2><ul class="fetch-prepare">${plan.fetchPrepare.map((item) =>
          amountRow(item.amount),
        )}</ul>`
  }<h2>Cooking</h2><ol class="units">${plan.units.map(unitItem)}</ol>`
}
