/**
 * proof: cooking-ux/start-now-admission (finding 4)
 *
 * START NOW sent the cook to hot fat before the prep that precedes it, on two of
 * the three recipes. The rule that separates those two entries from the oven and
 * the pasta water is: slow, safe to leave unattended, and needed by a later unit
 * than the first. Every assertion here runs the prototype's own
 * `admitsToStartNow` and its own `render()`, and the violation is re-planted at
 * the end so a green run cannot mean the rule stopped being consulted.
 */
import { describe, expect, it } from "vitest"
import { allOf, loadPrototype, type StartNowEntry } from "./harness.js"

const legs = (e: StartNowEntry) => ({
  slow: e.slow === true,
  safeToLeave: e.safeToLeave === true,
  neededLater: Number.isInteger(e.neededAtUnit) && e.neededAtUnit >= 2,
})

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9°]+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "into", "with", "heat"].includes(w))

describe("cooking-ux/start-now-admission", () => {
  it("renders exactly the declared entries that satisfy all three legs", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      const admitted = recipe.beforeYouStart.startNow.filter(
        (e) => legs(e).slow && legs(e).safeToLeave && legs(e).neededLater,
      )
      const shown = allOf(p.render({ recipe: i }), "startnow-item")
      expect(shown, recipe.title).toEqual(admitted.map((e) => e.do))
    }
  })

  it("keeps the positive cases, so the rule is not just an empty START NOW", () => {
    const p = loadPrototype()
    expect(p.render({ recipe: 1 }).text).toContain(
      "Bring a high-sided pot of salted water to a boil",
    )
    expect(p.render({ recipe: 2 }).text).toContain("Preheat oven to 200 °C")
  })

  it("refuses every rejected entry, with a stated reason", () => {
    const p = loadPrototype()
    const admits = p.evaluate<(e: StartNowEntry, n: number) => boolean>("admitsToStartNow")
    let rejected = 0
    for (const recipe of p.data.recipes) {
      for (const e of recipe.beforeYouStart.startNowRejected) {
        rejected++
        const l = legs(e)
        expect(l.slow && l.safeToLeave && l.neededLater, `${recipe.title}: ${e.do}`).toBe(false)
        expect(admits(e, recipe.units.length), `${recipe.title}: ${e.do}`).toBe(false)
        expect(e.why?.length ?? 0, `${recipe.title}: ${e.do} carries no reason`).toBeGreaterThan(20)
      }
    }
    expect(rejected, "the recipes no longer carry the refused entries").toBe(2)
  })

  // The assertion above only ever sees entries that fail SEVERAL legs at once —
  // both refused entries are neither slow nor safe to leave — so on its own it
  // holds with any single leg of the rule deleted. Each leg therefore gets its
  // own case, broken one at a time on an entry that genuinely qualifies, and
  // required to be refused by the shipped predicate AND absent from the page.
  describe("each leg refuses on its own", () => {
    const qualifying = () => {
      const p = loadPrototype()
      const recipe = p.data.recipes[2]
      const entry = recipe?.beforeYouStart.startNow[0]
      if (!recipe || !entry) throw new Error("the qualifying oven entry is gone")
      return { p, recipe, entry, unitCount: recipe.units.length }
    }

    it("admits the untouched entry, so every case below starts from a real yes", () => {
      const { p, entry, unitCount } = qualifying()
      const admits = p.evaluate<(e: StartNowEntry, n: number) => boolean>("admitsToStartNow")
      expect(admits(entry, unitCount)).toBe(true)
      expect(allOf(p.render({ recipe: 2 }), "startnow-item")).toEqual([entry.do])
    })

    const broken: readonly (readonly [string, (e: StartNowEntry, unitCount: number) => unknown])[] =
      [
        ["it has no action to do", (e) => ({ ...e, do: 42 })],
        ["it is not slow", (e) => ({ ...e, slow: false })],
        ["it cannot be left unattended", (e) => ({ ...e, safeToLeave: false })],
        ["the unit it is needed at is not a whole number", (e) => ({ ...e, neededAtUnit: 2.5 })],
        ["the first unit needs it, so it is not needed later", (e) => ({ ...e, neededAtUnit: 1 })],
        ["it points past the last unit", (e, n) => ({ ...e, neededAtUnit: n + 1 })],
      ]

    for (const [why, breakIt] of broken) {
      it(`refuses it when ${why}`, () => {
        const { p, recipe, entry, unitCount } = qualifying()
        const mutated = breakIt(entry, unitCount) as StartNowEntry
        const admits = p.evaluate<(e: StartNowEntry, n: number) => boolean>("admitsToStartNow")
        expect(admits(mutated, unitCount), `admitted although ${why}`).toBe(false)

        recipe.beforeYouStart.startNow = [mutated]
        const rendered = p.render({ recipe: 2 })
        expect(allOf(rendered, "startnow-item"), `rendered although ${why}`).toEqual([])
        expect(rendered.text, "and the refusal is not silent").toContain(
          "did not qualify for START NOW",
        )
      })
    }
  })

  it("shows that each refused entry is already carried by the unit that needs it", () => {
    const p = loadPrototype()
    for (const recipe of p.data.recipes) {
      for (const e of recipe.beforeYouStart.startNowRejected) {
        const unit = recipe.units.find((u) => u.n === e.neededAtUnit)
        expect(unit, `${recipe.title}: no unit ${e.neededAtUnit}`).toBeDefined()
        const carried = `${JSON.stringify(unit)}`.toLowerCase()
        const overlap = words(e.do).filter((w) => carried.includes(w))
        expect(
          overlap.length,
          `${recipe.title}: "${e.do}" vs unit ${e.neededAtUnit}`,
        ).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it("re-plants the defect: the oil put back into START NOW is still refused", () => {
    const p = loadPrototype()
    const recipe = p.data.recipes[0]
    if (!recipe) throw new Error("no first recipe")
    const oil = recipe.beforeYouStart.startNowRejected[0]
    if (!oil) throw new Error("the refused oil entry is gone from the data")

    recipe.beforeYouStart.startNow.push(oil)
    const withDefect = p.render({ recipe: 0 })
    expect(allOf(withDefect, "startnow-item")).toEqual([])
    expect(withDefect.text, "the refusal has to be visible, not silent").toContain(
      "did not qualify for START NOW",
    )

    // Control: the same entry rendering once its legs hold proves the assertion
    // above is the rule refusing it, not START NOW being broken.
    recipe.beforeYouStart.startNow = [{ ...oil, slow: true, safeToLeave: true, neededAtUnit: 2 }]
    expect(allOf(p.render({ recipe: 0 }), "startnow-item")).toEqual([oil.do])
  })
})
