/**
 * proof: cooking-ux/assumed-at-hand-suppression (finding 2)
 *
 * The item asks for both halves of the claim to be reported separately. The
 * clutter half was not reported by the evaluation, and is not closed here by
 * inference. The readiness half has a structural answer that IS the finding:
 * this prototype marks an at-hand row rather than removing it, and never touches
 * START NOW, so no readiness step could disappear in it — which is why the half
 * that matters, a Cooking Plan whose readiness steps are DERIVED, stays open as
 * OQ-37 and suppression ships off by default. These assertions hold the
 * structural claim in place so the finding cannot quietly stop being true.
 */
import { describe, expect, it } from "vitest"
import { allOf, loadPrototype } from "./harness.js"

describe("cooking-ux/assumed-at-hand-suppression", () => {
  it("leaves START NOW untouched, on every recipe, with suppression on", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      const off = allOf(p.render({ recipe: i, suppress: false }), "startnow-item")
      const on = allOf(p.render({ recipe: i, suppress: true }), "startnow-item")
      expect(on, recipe.title).toEqual(off)
    }
  })

  it("marks an at-hand row instead of removing it, so nothing can go missing unseen", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      const atHand = recipe.beforeYouStart.fetchPrepare.filter((f) => f.assumedAtHand)
      const rendered = p.render({ recipe: i, suppress: true })
      expect(allOf(rendered, "fetch-item"), recipe.title).toHaveLength(
        recipe.beforeYouStart.fetchPrepare.length,
      )
      expect(allOf(rendered, "suppressed"), recipe.title).toEqual(atHand.map((f) => f.item))
      for (const f of atHand) expect(rendered.text, `${recipe.title}: ${f.item}`).toContain(f.item)
    }
  })

  it("marks nothing while suppression is off", () => {
    const p = loadPrototype()
    for (const i of p.data.recipes.keys()) {
      expect(allOf(p.render({ recipe: i, suppress: false }), "suppressed")).toEqual([])
    }
  })

  it("re-plants the readiness loss: a measured amount flagged at-hand is still shown", () => {
    const p = loadPrototype()
    const recipe = p.data.recipes[0]
    const rice = recipe?.beforeYouStart.fetchPrepare.find((f) => f.item.startsWith("rice"))
    if (!recipe || !rice) throw new Error("the rice row is gone from the first recipe")
    rice.assumedAtHand = true
    const rendered = p.render({ recipe: 0, suppress: true })
    expect(allOf(rendered, "suppressed")).toContain(rice.item)
    expect(rendered.text, "suppression removed a measured amount").toContain(rice.item)
  })

  it("keeps the diagnostic honest: it counts what suppression touched", () => {
    const p = loadPrototype()
    const recipe = p.data.recipes[0]
    if (!recipe) throw new Error("no first recipe")
    const atHand = recipe.beforeYouStart.fetchPrepare.filter((f) => f.assumedAtHand).length
    expect(p.render({ recipe: 0, suppress: true }).text).toContain(
      `Suppression on: ${atHand} at-hand basic(s) struck through`,
    )
    for (const f of recipe.beforeYouStart.fetchPrepare) f.assumedAtHand = false
    expect(p.render({ recipe: 0, suppress: true }).text).toContain(
      "nothing was at-hand to hide here",
    )
  })
})
