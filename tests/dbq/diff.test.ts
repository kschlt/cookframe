/**
 * CFV1-DBQ — the run comparison distinguishes a value from its type.
 *
 * `diffRecipes` compared leaves as `String(value)`, so `4` against `"4"`,
 * `null` against `"null"` and `true` against `"true"` all counted as no
 * difference. A review reproduced it against the shipped code. That makes the
 * "445 of 2,079 leaves differ" figure in ADR-0015 a LOWER BOUND: it was
 * measured with the comparator below still blind to type changes, and an
 * accepted record is not rewritten to say otherwise. The correction therefore
 * lives in the open-questions register as **OQ-34**, where a reader of ADR-0015
 * can find it; a docstring here would have been a disclosure only someone
 * already reading the tests would meet. `tests/dbq/record.test.ts` keeps the
 * two tied together.
 *
 * No database: the comparison is pure, and the defect was pure too.
 */
import { describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { diffRecipes, flatten } from "../../spikes/dbq/queries.js"

const recipe = (leaves: Record<string, unknown>): CanonicalRecipe =>
  leaves as unknown as CanonicalRecipe

describe("dbq/run-comparison-distinguishes-type-from-text", () => {
  it("reports a JSON type change as a difference", () => {
    // The review's own case, verbatim.
    const r = diffRecipes(
      recipe({ servings: 4, note: null, ok: true }),
      recipe({ servings: "4", note: "null", ok: "true" }),
    )
    expect(r.differences.map((d) => d.path).sort()).toEqual(["/note", "/ok", "/servings"])
    expect(r.same).toBe(0)
  })

  it("names the type when only the type differs, so the row is readable", () => {
    const r = diffRecipes(recipe({ servings: 4 }), recipe({ servings: "4" }))
    expect(r.differences[0]).toEqual({ path: "/servings", a: "4 (number)", b: "4 (string)" })
  })

  it("leaves an ordinary difference printed exactly as before", () => {
    const r = diffRecipes(recipe({ title: "Gratin" }), recipe({ title: "Auflauf" }))
    expect(r.differences[0]).toEqual({ path: "/title", a: "Gratin", b: "Auflauf" })
  })

  it("still counts equal leaves as equal", () => {
    const same = { title: "Gratin", servings: 4, note: null }
    const r = diffRecipes(recipe(same), recipe({ ...same }))
    expect(r.differences).toEqual([])
    expect(r.same).toBe(3)
  })

  it("keeps the type beside the text at every leaf", () => {
    const f = flatten({ a: 1, b: "1", c: null, d: false })
    expect(f.get("/a")).toEqual({ type: "number", text: "1" })
    expect(f.get("/b")).toEqual({ type: "string", text: "1" })
    expect(f.get("/c")).toEqual({ type: "null", text: "null" })
    expect(f.get("/d")).toEqual({ type: "boolean", text: "false" })
  })
})
