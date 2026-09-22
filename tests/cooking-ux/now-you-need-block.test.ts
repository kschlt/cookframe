/**
 * proof: cooking-ux/now-you-need-block (findings 1 and 5)
 *
 * Two rules, both decided by data the conversion already produces, so neither
 * costs a second model call: a qualitative amount never enters the quantity
 * position, and the NOW YOU NEED block earns its place only where the unit is
 * time-critical or has a measurable amount to lay out. The danger in both is
 * losing something, so the assertions are written against loss — and each one
 * reads the unit it is about, never the page, so that a word appearing
 * elsewhere (`salt` also sits in FETCH / PREPARE) cannot satisfy it.
 */
import { describe, expect, it } from "vitest"
import { allOf, loadPrototype, type Rendered } from "./harness.js"

const QUALITATIVE = /\b(to taste|as needed)\b/i
const measurable = (qty: string) => /[0-9]/.test(qty)
const contentWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(
      (w) => w.length > 3 && !["fine", "fresh", "with", "into", "extra", "virgin"].includes(w),
    )

const earnsItsBlock = (u: { critical: string | null; nowYouNeed: { qty: string }[] }) =>
  u.nowYouNeed.length > 0 && (Boolean(u.critical) || u.nowYouNeed.some((r) => measurable(r.qty)))

describe("cooking-ux/now-you-need-block", () => {
  it("never puts a qualitative amount in the quantity position", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      for (const row of allOf(p.render({ recipe: i }), "items")) {
        expect(row, `${recipe.title}: "${row}" reads as a count`).not.toMatch(QUALITATIVE)
      }
    }
  })

  it("gives the block to exactly the units that earn it, and to no other", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      const rendered: Rendered = p.render({ recipe: i })
      expect(rendered.units, recipe.title).toHaveLength(recipe.units.length)
      for (const [k, unit] of recipe.units.entries()) {
        const view = rendered.units[k]
        expect(view?.block === undefined, `${recipe.title}: unit ${unit.n}`).toBe(
          !earnsItsBlock(unit),
        )
      }
    }
  })

  it("drops no measurable amount from the unit it belongs to", () => {
    const p = loadPrototype()
    let checked = 0
    for (const [i, recipe] of p.data.recipes.entries()) {
      const rendered = p.render({ recipe: i })
      for (const [k, unit] of recipe.units.entries()) {
        for (const row of unit.nowYouNeed.filter((r) => measurable(r.qty))) {
          checked++
          expect(
            rendered.units[k]?.block,
            `${recipe.title}: unit ${unit.n} dropped ${row.qty} ${row.item}`,
          ).toContain(`${row.qty} ${row.item}`)
        }
      }
    }
    expect(checked, "no measurable amount is under test").toBeGreaterThan(20)
  })

  it("keeps the split amount with its figure, in both layouts", () => {
    const p = loadPrototype()
    const a = p.render({ recipe: 1, hyp: "A" })
    const b = p.render({ recipe: 1, hyp: "B" })
    expect(allOf(a, "split")).toEqual(["part of 5.3 oz grated Provolone del Monaco"])
    expect(a.units[5]?.reserve).toContain("Remaining Provolone")
    expect(b.units[5]?.action).toContain("part of the 5.3 oz Provolone")
    expect(b.units[5]?.reserve).toContain("Remaining Provolone")
  })

  it("names every row of a suppressed block in that unit's own action sentence", () => {
    const p = loadPrototype()
    let suppressed = 0
    for (const [i, recipe] of p.data.recipes.entries()) {
      const rendered = p.render({ recipe: i })
      for (const [k, unit] of recipe.units.entries()) {
        if (unit.nowYouNeed.length === 0 || earnsItsBlock(unit)) continue
        suppressed++
        const sentence = (rendered.units[k]?.action ?? "").toLowerCase()
        for (const row of unit.nowYouNeed) {
          const named = contentWords(row.item).some((w) => sentence.includes(w))
          expect(named, `${recipe.title}: unit ${unit.n} dropped "${row.item}" unnamed`).toBe(true)
        }
      }
    }
    expect(suppressed, "no unit exercises the suppression rule any more").toBe(2)
  })

  it("re-plants both defects: a figure brings the block back, a qualitative amount loses its column", () => {
    const p = loadPrototype()
    const season = p.data.recipes[0]?.units[3]
    const row = season?.nowYouNeed[0]
    if (!season || !row) throw new Error("the Season unit is gone from the first recipe")
    expect(p.render({ recipe: 0 }).units[3]?.block).toBeUndefined()

    row.qty = "2 tsp"
    expect(p.render({ recipe: 0 }).units[3]?.block, "the rule is not reading the data").toBe(
      "2 tsp salt and pepper · sweet paprika powder",
    )

    // And back: where a block stays for another reason, the qualitative row
    // still loses its quantity position rather than reading as a count.
    row.qty = "to taste"
    season.critical = "forces the block to stay"
    expect(p.render({ recipe: 0 }).units[3]?.block).toBe("salt and pepper · sweet paprika powder")
  })

  it("re-plants the loss the suppression rule could cause", () => {
    const p = loadPrototype()
    const season = p.data.recipes[0]?.units[3]
    if (!season) throw new Error("the Season unit is gone from the first recipe")
    // A row the action sentence does NOT name must be visible as a loss: with
    // the block suppressed, nothing on the unit mentions it.
    season.nowYouNeed = [{ qty: "to taste", item: "sumac" }]
    const view = p.render({ recipe: 0 }).units[3]
    expect(view?.block).toBeUndefined()
    expect(`${view?.action} ${view?.critical ?? ""}`.toLowerCase()).not.toContain("sumac")
  })
})
