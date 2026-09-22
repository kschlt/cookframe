/**
 * proof: cooking-ux/step-count-range (finding 3)
 *
 * The item asks for the observed range as a minimum AND a maximum, against both
 * failure modes. The bounds are read out of the finding's prose and compared
 * with the recipes the evaluation actually ran, so the two cannot drift apart.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadPrototype, spikeDir } from "./harness.js"

const readme = () => readFileSync(join(spikeDir, "README.md"), "utf8")

describe("cooking-ux/step-count-range", () => {
  it("states a minimum and a maximum that match the recipes evaluated", () => {
    const counts = loadPrototype().data.recipes.map((r) => r.units.length)
    const line = /Observed unit-count range:\*\* min \*\*(\d+)\*\*.*?max \*\*(\d+)\*\*/s.exec(
      readme(),
    )
    expect(line, "the finding states no min/max").not.toBeNull()
    expect(Number(line?.[1])).toBe(Math.min(...counts))
    expect(Number(line?.[2])).toBe(Math.max(...counts))
  })

  it("shows the same count on the page as the data carries", () => {
    const p = loadPrototype()
    for (const [i, recipe] of p.data.recipes.entries()) {
      expect(p.render({ recipe: i }).text).toContain(`${recipe.units.length} cooking units`)
      expect(p.render({ recipe: i }).units).toHaveLength(recipe.units.length)
    }
  })

  it("reports the range against both failure modes, not just a number", () => {
    const finding = /### 3\. Cooking-unit granularity([\s\S]*?)\n### /.exec(readme())?.[1] ?? ""
    expect(finding).toMatch(/wall of paragraph/i)
    expect(finding).toMatch(/micro-step/i)
    expect(finding).toMatch(/Recommendation:/)
  })

  it("re-plants the drift: a range that no longer matches the data is caught", () => {
    const counts = loadPrototype().data.recipes.map((r) => r.units.length)
    const drifted = readme().replace(/min \*\*\d+\*\*/, "min **1**")
    const line = /Observed unit-count range:\*\* min \*\*(\d+)\*\*.*?max \*\*(\d+)\*\*/s.exec(
      drifted,
    )
    expect(Number(line?.[1])).not.toBe(Math.min(...counts))
  })
})
