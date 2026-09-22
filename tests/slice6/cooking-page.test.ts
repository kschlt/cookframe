/**
 * CFV1-SL6 — the cook's two addresses, driven through the real route.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * The other Slice 6 files prove properties of the derived plan. This one proves
 * what a phone actually gets back, which is a different claim: a plan can be
 * correct and still reach nobody if the route drops it, and — the constraint
 * this slice is written around — a plan that cannot be produced must not take
 * the recipe down with it.
 *
 * It uses `app.request(...)` rather than a bound port (`ADR-0007`): the app is
 * a fetch handler, so the whole route runs in-process and the assertions are on
 * a real `Response`, not on a handler called by hand.
 *
 * The page-level halves of three marking proofs live here too. Their derivation
 * halves are in `prerequisites-and-marking.test.ts` and `follows-s4-findings.ts`;
 * a split marked in the plan and rendered as an ordinary quantity row would
 * satisfy those and still ship the failure S4 found.
 */
import { describe, expect, it } from "vitest"
import type { CanonicalRecipe, CookingPlan, ReservedAmount } from "../../schema/index.js"
import {
  deriveCookingPlan,
  UntraceablePlanFactError,
  unitNeedsItsAmountBlock,
} from "../../src/cooking/index.js"
import { createCookingApp } from "../../src/http/cooking-app.js"
import type { RecipeRepository } from "../../src/persistence/index.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { renderCookingPage } from "../../src/render/index.js"
import { bellPepper, nerano } from "./fixtures.js"

/** Markers that tell the two pages apart without reading either one by eye. */
const COOKING_PAGE = '<ol class="units">'
const RECIPE_PAGE = "<h2>Ingredients</h2>"

interface Served {
  readonly repo: RecipeRepository
  readonly app: ReturnType<typeof createCookingApp>
  readonly degraded: { recipeId: string; reason: unknown }[]
  readonly version: number
}

async function serving(...recipes: readonly CanonicalRecipe[]): Promise<Served> {
  const repo = createProvisionalStore()
  const degraded: { recipeId: string; reason: unknown }[] = []
  let version = 0
  for (const recipe of recipes) version = (await repo.appendCanonicalVersion(recipe)).version
  const app = createCookingApp({
    repo,
    onDegraded: (recipeId, reason) => degraded.push({ recipeId, reason }),
  })
  return { repo, app, degraded, version }
}

const cook = async (s: Served, recipe: CanonicalRecipe): Promise<Response> =>
  await s.app.request(`/recipes/${recipe.id}/cook`)

const body = async (response: Response): Promise<string> => await response.text()

/** The Nerano plan a page is rendered from, for the marking proofs below. */
const neranoPage = (): string => renderCookingPage(deriveCookingPlan(nerano))

/** A recipe whose plan cannot be derived: one step uses an ingredient nobody declared. */
function withDanglingUse(recipe: CanonicalRecipe): CanonicalRecipe {
  const [section, ...otherSections] = recipe.instructionSections
  const [step, ...otherSteps] = section?.steps ?? []
  if (section === undefined || step === undefined) {
    throw new Error("the fixture no longer has a first step")
  }
  return {
    ...recipe,
    instructionSections: [
      {
        ...section,
        steps: [
          {
            ...step,
            ingredientUses: [
              { ingredientId: "ing-nobody-declared", usage: "use_now", sourceRefs: [] },
            ],
          },
          ...otherSteps,
        ],
      },
      ...otherSections,
    ],
  }
}

describe("slice6/recipe-viewable-without-plan", () => {
  it("derives and serves the cooking view when the store holds no plan", async () => {
    // `PDR-0004` ships `lazy`, so this is not a fallback: it is the ordinary
    // state of every recipe nobody has cooked yet.
    const s = await serving(bellPepper)
    expect(await s.repo.loadCookingPlan(bellPepper.id, s.version)).toBeUndefined()

    const response = await cook(s, bellPepper)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(await body(response)).toContain(COOKING_PAGE)
    expect(s.degraded, "deriving on a miss is not a degradation").toEqual([])
  })

  it("leaves the store as it found it, rather than caching what it derived", async () => {
    // A write on a GET would be a third moment a plan is generated, beside the
    // two `PDR-0004` names, decided in passing rather than by a decision.
    const s = await serving(bellPepper)
    expect((await cook(s, bellPepper)).status).toBe(200)
    expect(await s.repo.loadCookingPlan(bellPepper.id, s.version)).toBeUndefined()
  })

  it("serves the stored plan when there is one, rather than deriving again", async () => {
    const s = await serving(bellPepper)
    const stored: CookingPlan = {
      ...deriveCookingPlan(bellPepper, { canonicalVersion: s.version }),
      setUp: [
        {
          text: "This line exists only in the stored plan",
          origin: deriveCookingPlan(bellPepper).units[0]
            ?.origin as CookingPlan["units"][number]["origin"],
        },
      ],
    }
    await s.repo.storeCookingPlan(stored)

    expect(await body(await cook(s, bellPepper))).toContain(
      "This line exists only in the stored plan",
    )
  })

  it("never serves one version's plan for another", async () => {
    // Two runs of the same recipe: the plan stored against version 1 must not
    // appear at the address that now resolves to version 2.
    const s = await serving(bellPepper, bellPepper)
    expect(s.version).toBe(2)
    const first = deriveCookingPlan(bellPepper, { canonicalVersion: 1 })
    await s.repo.storeCookingPlan({
      ...first,
      setUp: [
        {
          text: "This line belongs to version 1",
          origin: first.units[0]?.origin as CookingPlan["units"][number]["origin"],
        },
      ],
    })

    const page = await body(await cook(s, bellPepper))
    expect(page).toContain(COOKING_PAGE)
    expect(page, "a stale plan reached the cook").not.toContain("This line belongs to version 1")
  })

  it("keeps the recipe page reachable, and the two pages distinct", async () => {
    const s = await serving(bellPepper)
    const recipe = await s.app.request(`/recipes/${bellPepper.id}`)
    expect(recipe.status).toBe(200)
    const page = await body(recipe)
    expect(page).toContain(RECIPE_PAGE)
    expect(page, "the recipe address served the cooking view").not.toContain(COOKING_PAGE)
  })

  it("answers 404 for a recipe this instance does not hold, at both addresses", async () => {
    // The one 404: not knowing the recipe is a different thing from not having
    // a plan for it, and collapsing them would make the degradation untestable.
    const s = await serving(bellPepper)
    expect((await s.app.request("/recipes/nobody/cook")).status).toBe(404)
    expect((await s.app.request("/recipes/nobody")).status).toBe(404)
  })
})

describe("slice6/recipe-viewable-when-derivation-fails", () => {
  it("serves the recipe page when the plan refuses to derive", async () => {
    // The refusal is the real one: a step that uses an ingredient the recipe
    // never declared is exactly what `UntraceablePlanFactError` is for, so the
    // failure under test is the derivation's own, not a stubbed throw.
    const broken = withDanglingUse(bellPepper)
    const s = await serving(broken)
    expect(() => deriveCookingPlan(broken)).toThrow(UntraceablePlanFactError)

    const response = await cook(s, broken)
    expect(response.status, "the cook got an error page").toBe(200)
    const page = await body(response)
    expect(page).toContain(RECIPE_PAGE)
    expect(page, "half a cooking view is worse than none").not.toContain(COOKING_PAGE)
  })

  it("says which recipe degraded and why, rather than swallowing it", async () => {
    const broken = withDanglingUse(bellPepper)
    const s = await serving(broken)
    await cook(s, broken)

    expect(s.degraded.map((d) => d.recipeId)).toEqual([broken.id])
    expect(s.degraded[0]?.reason).toBeInstanceOf(UntraceablePlanFactError)
  })

  it("degrades the same way with no observer wired at all", async () => {
    // `onDegraded` is optional, so an instance that wires nothing must behave
    // identically — otherwise the observer is load-bearing and the option is a
    // lie.
    const broken = withDanglingUse(nerano)
    const repo = createProvisionalStore()
    await repo.appendCanonicalVersion(broken)
    const bare = createCookingApp({ repo })

    const response = await bare.request(`/recipes/${broken.id}/cook`)
    expect(response.status).toBe(200)
    expect(await body(response)).toContain(RECIPE_PAGE)
  })

  it("leaves the recipe address untouched by the plan's failure", async () => {
    const broken = withDanglingUse(nerano)
    const s = await serving(broken)
    const recipe = await s.app.request(`/recipes/${broken.id}`)

    expect(recipe.status).toBe(200)
    expect(await body(recipe)).toContain(RECIPE_PAGE)
  })
})

describe("slice6/split-amount-is-marked-element", () => {
  it("renders a split as a split, not as an ordinary quantity row", () => {
    const page = neranoPage()
    const plan = deriveCookingPlan(nerano)
    const split = plan.units.flatMap((u) => u.splits)[0]
    if (split === undefined) throw new Error("the fixture no longer carries a split")

    // Its own row class and its own word, both of which an ordinary amount row
    // lacks — the marking is in the markup, not only in the plan.
    expect(page).toContain('<li class="split">')
    expect(page).toContain('<span class="mark">Split</span>')
    // And the whole it is part of is named rather than divided.
    expect(page).toContain(split.wholeText)
  })

  it("names each split's own portion and whole, in the plan's order", () => {
    // Nerano carries both portions of one ingredient, so counting words would
    // pass on a render that swapped them. The rows are read in page order and
    // compared to the plan's, each against its own whole.
    const rows = neranoPage().match(/<li class="split">[\s\S]*?<\/li>/g) ?? []
    const splits = deriveCookingPlan(nerano).units.flatMap((u) => u.splits)

    expect(splits.length, "the fixture no longer carries both portions").toBeGreaterThan(1)
    expect(rows).toHaveLength(splits.length)
    for (const [i, split] of splits.entries()) {
      const words = split.portion === "part_of" ? "part of" : "the rest of"
      const other = split.portion === "part_of" ? "the rest of" : "part of"
      expect(rows[i], `split ${i}`).toContain(`<span class="mark">Split</span> ${words}`)
      expect(rows[i], `split ${i}: the portions are the wrong way round`).not.toContain(other)
      // The whole is named in the row itself, not merely somewhere on the page.
      expect(rows[i], `split ${i}: the whole it is part of`).toContain(split.wholeText)
      expect(rows[i]).toContain(split.amount.itemText)
    }
  })
})

describe("slice6/reserved-amount-is-marked-element", () => {
  it("renders a reserved amount as held back, not as something to add now", () => {
    const page = neranoPage()
    expect(page).toContain('<li class="reserved">')
    expect(page).toContain('<span class="mark">Keep back</span>')
  })

  it("carries no quantity position when the source stated no amount to hold back", () => {
    // Nerano's pasta water: the source says to keep some, and says no number.
    // A row that invented one here would be the fabrication the slice forbids,
    // and a row that dropped the mark would be an ordinary ingredient.
    const held = deriveCookingPlan(nerano).units.flatMap((u) => u.reserved)[0]
    if (held === undefined) throw new Error("the fixture no longer carries a reserved amount")
    expect(held.amount.text).toBe("")

    expect(neranoPage()).toContain(
      `<li class="reserved"><span class="mark">Keep back</span> ${held.amount.itemText}`,
    )
  })

  it("says at which step the held-back amount is needed, when the plan knows", () => {
    // The look-ahead is the plan's to find and the page's to show; this fixture
    // states none, so the rendering rule is driven directly rather than left
    // unproven until a fixture happens to carry one.
    const plan = deriveCookingPlan(nerano)
    const unit = plan.units.find((u) => u.reserved.length > 0)
    if (unit === undefined) throw new Error("the fixture no longer carries a reserved amount")
    const held = unit.reserved[0] as ReservedAmount

    const withLookahead: CookingPlan = {
      ...plan,
      units: plan.units.map((u) =>
        u === unit ? { ...u, reserved: [{ ...held, neededAtUnit: 7 }] } : u,
      ),
    }

    expect(renderCookingPage(withLookahead)).toContain("needed at step 7")
    expect(renderCookingPage(plan), "a step number nobody stated").not.toContain("needed at step")
  })
})

describe("slice6/quantity-placement-follows-s4", () => {
  it("gives a qualitative amount no quantity position on the page", () => {
    // S4's finding 5, at the only place it can be read: `to taste` in the
    // quantity column was read as a count — *"two tastes Salt"*.
    //
    // The row has to be put where the page will actually render it. S4's own
    // seasoning unit has no block (that is finding 1, proven below), so its
    // qualitative rows never reach the page at all; the case that matters is
    // S4's second one, a qualitative amount standing beside a measurable one,
    // which is what this plan is.
    const plan = deriveCookingPlan(bellPepper)
    const seasoning = plan.units.find((u) => !unitNeedsItsAmountBlock(u))
    const qualitative = seasoning?.amounts.find((a) => !a.measurable && a.text !== "")
    const withBlock = plan.units.find((u) => u.amounts.some((a) => a.measurable))
    if (qualitative === undefined || withBlock === undefined) {
      throw new Error("the fixture no longer carries both kinds of amount")
    }

    const page = renderCookingPage({
      ...plan,
      units: plan.units.map((u) =>
        u === withBlock ? { ...u, amounts: [...u.amounts, qualitative] } : u,
      ),
    })

    expect(page).toContain(`<li>${qualitative.itemText}</li>`)
    expect(page, "a qualitative amount stood in the quantity column").not.toContain(
      `<span class="amount">${qualitative.text}</span>`,
    )
  })

  it("puts the amounts above the sentence rather than inside or after it (layout A)", () => {
    // Each unit is read on its own: a page-wide "block before some action" can
    // be satisfied by any other unit's sentence. A unit that has a block opens
    // on it, and a unit that does not opens on the sentence.
    for (const recipe of [bellPepper, nerano]) {
      const plan = deriveCookingPlan(recipe)
      const rows =
        renderCookingPage(plan).match(/<li class="unit">[\s\S]*?<p class="action">/g) ?? []
      expect(rows, recipe.id).toHaveLength(plan.units.length)
      for (const [i, unit] of plan.units.entries()) {
        const opensOnTheBlock = rows[i]?.startsWith(
          '<li class="unit"><p class="block-label">Now you need</p>',
        )
        expect(opensOnTheBlock, `${recipe.id} unit ${unit.n}`).toBe(unitNeedsItsAmountBlock(unit))
      }
    }
  })

  it("renders no block for the unit S4 said should not have one", () => {
    // The seasoning unit: qualitative amounts only, nothing time-critical. Its
    // markup must open on the sentence, with no block between.
    const plan = deriveCookingPlan(bellPepper)
    const seasoning = plan.units.find((u) => !unitNeedsItsAmountBlock(u))
    if (seasoning === undefined) {
      throw new Error("the fixture no longer carries a unit the rule excludes")
    }

    expect(renderCookingPage(plan)).toContain(
      `<li class="unit"><p class="action">${seasoning.actionText}</p>`,
    )
  })

  it("renders the block exactly where the derivation's rule says, and nowhere else", () => {
    // The page consults `unitNeedsItsAmountBlock` rather than deciding again,
    // so the stored plan and the page cannot disagree about which units have a
    // block. Driven by the shipped rule itself, not by a copy of its formula.
    for (const recipe of [bellPepper, nerano]) {
      const plan = deriveCookingPlan(recipe)
      const blocks = (renderCookingPage(plan).match(/class="now-you-need"/g) ?? []).length
      expect(blocks, recipe.id).toBe(plan.units.filter(unitNeedsItsAmountBlock).length)
      expect(blocks, `${recipe.id}: the rule excluded nothing`).toBeLessThan(plan.units.length)
    }
  })

  it("says so when START NOW found nothing, rather than vanishing", () => {
    // S4's finding 4. A cook who has seen the block once must not read its
    // absence on the next recipe as "nothing to start".
    const plan = deriveCookingPlan(bellPepper)
    expect(plan.startNow, "the fixture now carries a start-now entry").toEqual([])
    expect(renderCookingPage(plan)).toContain("Nothing here has to be started before step 1.")
  })
})

describe("slice6/every-fact-traces-to-canonical", () => {
  it("shows a title the source did not carry as a gap, and invents none", () => {
    // `PDR-0005`: a required field the source does not supply stays empty and
    // says so. On the cooking page that is one wording, the product's own, and
    // never the recipe id or a composed sentence.
    const plan = deriveCookingPlan(bellPepper)
    const page = renderCookingPage({ ...plan, title: { state: "not_in_source" } })

    expect(page).toContain('<span class="source-gap">')
    expect(page, "a title nobody stated reached the page").not.toContain(bellPepper.id)
  })

  it("prints every critical parameter in the source's own words", () => {
    // The page is the last place a temperature or a duration could be silently
    // converted, and the only place a cook would act on it.
    for (const recipe of [bellPepper, nerano]) {
      const plan = deriveCookingPlan(recipe)
      const page = renderCookingPage(plan)
      const parameters = plan.units.flatMap((u) => u.critical)
      expect(parameters.length, `${recipe.id} carries no critical parameter`).toBeGreaterThan(0)
      for (const parameter of parameters) {
        expect(page, `${recipe.id}: ${parameter.kind}`).toContain(parameter.text)
      }
    }
  })
})

describe("slice6/prerequisite-lookahead-traceable", () => {
  it("says which step a START NOW entry is for", () => {
    // An entry that sends a cook away from the stove without saying what for is
    // the half of S4's finding 4 that a present-but-mute block would still fail.
    const plan = deriveCookingPlan(nerano)
    const first = plan.startNow[0]
    if (first === undefined) throw new Error("the fixture no longer carries a START NOW entry")

    const page = renderCookingPage(plan)
    expect(page).toContain(first.text)
    expect(page).toContain(`for step ${first.neededAtUnit}`)
  })
})

describe("slice6/no-amount-changes", () => {
  it("prints no quantity position for an amount that has no text to put in it", () => {
    // A stored plan is only as constrained as the contract, and the contract
    // permits `measurable: true` beside an empty `text` — a shape the deriver
    // does not produce today but a store could hand back tomorrow. An empty
    // `<span class="amount">` would be a quantity column with nothing in it,
    // which reads as a number the page failed to load rather than as a source
    // that stated none.
    const plan = deriveCookingPlan(bellPepper)
    const unit = plan.units.find((u) => u.amounts.some((a) => a.measurable))
    const amount = unit?.amounts.find((a) => a.measurable)
    if (unit === undefined || amount === undefined) {
      throw new Error("the fixture no longer carries a measurable amount")
    }

    const page = renderCookingPage({
      ...plan,
      units: plan.units.map((u) => (u === unit ? { ...u, amounts: [{ ...amount, text: "" }] } : u)),
    })

    expect(page).toContain(`<li>${amount.itemText}</li>`)
    expect(page, "an empty quantity position reached the page").not.toContain(
      '<span class="amount"></span>',
    )
  })
})
