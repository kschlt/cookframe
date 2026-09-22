/**
 * proofs: cooking-ux/hypothesis-a-vs-b, cooking-ux/findings-carry-recommendations
 *
 * The point of the item is that Slice 6 can build against the findings without
 * re-running the spike. That fails in exactly two ways: a placeholder left
 * behind, and a finding that describes what was seen without saying what to do.
 * Both are checked, and the A-vs-B finding additionally has to name the
 * preferred layout and the condition under which the other one wins.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { spikeDir } from "./harness.js"

const readme = readFileSync(join(spikeDir, "README.md"), "utf8")
const findings = readme.slice(readme.indexOf("\n## Findings"))
const sections = [...findings.matchAll(/\n### (?!Still open)(.+)\n([\s\S]*?)(?=\n### |\n## |$)/g)]

describe("cooking-ux/findings-carry-recommendations", () => {
  it("covers the three hypotheses the item names, plus what the evaluation exposed", () => {
    const titles = sections.map((s) => s[1] ?? "")
    expect(titles.length).toBeGreaterThanOrEqual(3)
    expect(titles[0]).toMatch(/Hypothesis A vs B/)
    expect(titles[1]).toMatch(/assumedAtHand/)
    expect(titles[2]).toMatch(/granularity/i)
  })

  it("gives every finding a decision for Slice 6 and a recommendation", () => {
    for (const [, title = "", body = ""] of sections) {
      expect(body, `"${title}" names no decision for Slice 6`).toMatch(
        /\*\*Decision for Slice 6:\*\*/,
      )
      const recommendation = /\*\*Recommendation:\*\*([\s\S]*?)(?=\n- \*\*|\n### |$)/.exec(
        body,
      )?.[1]
      expect(recommendation, `"${title}" carries no recommendation`).toBeDefined()
      expect((recommendation ?? "").trim().length, `"${title}"`).toBeGreaterThan(40)
    }
  })

  it("leaves no placeholder behind", () => {
    expect(findings).not.toMatch(/_pending_|_TBD_|TODO/i)
  })

  it("catches a placeholder when there is one", () => {
    // So the assertion above cannot be green because the pattern is wrong.
    expect("- Recommendation: _pending_").toMatch(/_pending_|_TBD_|TODO/i)
  })

  it("names the preferred layout and the condition under which the other wins", () => {
    const body = sections[0]?.[2] ?? ""
    expect(body).toMatch(/build \*\*A\*\* as the default/)
    expect(body).toMatch(/\*\*B\*\* is better where/)
    expect(body, "a condition that is measured and one that is not must be told apart").toMatch(
      /stated, not measured/,
    )
  })

  it("reports both halves of the suppression claim separately", () => {
    const body = sections[1]?.[2] ?? ""
    expect(body).toMatch(/\*\*Clutter reduced\?\*\*/)
    expect(body).toMatch(/\*\*Readiness work hidden\?\*\*/)
    expect(body, "the unanswered half must not be closed by a default").toMatch(/off by default/)
    expect(body).toMatch(/OQ-37/)
  })

  it("registers what the spike could not answer in the open-questions file", () => {
    const register = readFileSync(join(spikeDir, "..", "..", "docs", "open-questions.md"), "utf8")
    for (const id of ["OQ-36", "OQ-37"]) {
      const row = new RegExp(`\\| ${id} \\|.*`).exec(register)?.[0] ?? ""
      expect(row, `${id} is not registered`).toContain("open")
      expect(row, `${id} does not point back at the spike`).toContain("spikes/s4-cooking-ux")
    }
  })
})
