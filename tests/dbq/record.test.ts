/**
 * CFV1-DBQ — the record half of the acceptance criteria.
 *
 * These read documents rather than a database, so they run everywhere and need
 * nothing set up. What they guard is the part of DBQ that is easiest to leave
 * half done: a measurement that never becomes a decision, a decision that never
 * reaches the register, or a provisional store that stays provisional because
 * nobody wrote down what happened to it — which is the exact neglect ADR-0003
 * warned about.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...p: string[]): string => readFileSync(join(repoRoot, ...p), "utf8")

/** The record that closes OQ-03/OQ-04, found by what it declares, not by name. */
function decidingRecord(): { file: string; text: string } {
  const dir = join(repoRoot, "docs", "adr")
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".md") || file === "README.md") continue
    const text = readFileSync(join(dir, file), "utf8")
    const front = text.split("---")[1] ?? ""
    if (/decides:.*OQ-03/.test(front) && /decides:.*OQ-04/.test(front)) return { file, text }
  }
  throw new Error("no decision record declares that it closes OQ-03 and OQ-04")
}

describe("CFV1-DBQ decision record", () => {
  it("dbq/decision-record-opened-and-cites-results — the record exists and carries the measurement", () => {
    const { file, text } = decidingRecord()
    const front = text.split("---")[1] ?? ""

    // ADR-0006's format: front matter with id, title, status, date, and the
    // four body sections.
    expect(front, file).toMatch(/^id: "ADR-\d{4}"$/m)
    expect(front, file).toMatch(/^status: accepted$/m)
    expect(front, file).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m)
    for (const section of [
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives considered",
    ]) {
      expect(text, `${file} is missing ${section}`).toContain(section)
    }

    // It cites results rather than reasoning alone: ADR-0003 asked for the three
    // queries over real data, so all three have to appear with numbers beside
    // them, and the corpus has to be described.
    for (const query of ["library list", "shopping", "comparison"]) {
      expect(text.toLowerCase(), `${file} does not report the ${query} query`).toContain(query)
    }
    for (const shape of ["document", "hybrid", "relational"]) {
      expect(text.toLowerCase(), `${file} does not report the ${shape} shape`).toContain(shape)
    }
    // Timings, in a table, for every shape — not a prose verdict.
    expect(text, `${file} reports no measured timings`).toMatch(/\|\s*[\d.]+ ms\s*\|/)
    // And it says the data was real, which is the condition ADR-0003 set.
    expect(text, file).toMatch(/real|Slice 1/)
  })

  it("dbq/register-names-the-record — OQ-03 and OQ-04 both name it, and neither is still open", () => {
    const { text } = decidingRecord()
    const id = /^id: "(ADR-\d{4})"$/m.exec(text.split("---")[1] ?? "")?.[1]
    expect(id).toBeDefined()

    const register = read("docs", "open-questions.md")
    for (const oq of ["OQ-03", "OQ-04"]) {
      const row = register.split("\n").find((l) => l.startsWith(`| ${oq} `))
      expect(row, `${oq} has no row in the register`).toBeDefined()
      expect(row, `${oq} does not name ${id}`).toContain(id as string)
      expect(row, `${oq} is still marked open`).not.toMatch(/\|\s*open/)
    }
  })

  it("dbq/provisional-store-outcome-recorded — the record says what happened to the provisional store", () => {
    const { file, text } = decidingRecord()
    // ADR-0003: "A provisional store can quietly become permanent by neglect."
    // The record has to say which of the two happened to it, in its own words.
    expect(text, `${file} never mentions the provisional store`).toMatch(/provisional store/i)
    expect(
      /confirm/i.test(text) && /replace/i.test(text),
      `${file} does not say whether the evaluation confirmed or replaced the provisional store`,
    ).toBe(true)
    // Migration is out of scope, and saying so is what keeps the gap from being
    // the neglect ADR-0003 named.
    expect(text, `${file} does not name the migration as follow-on work`).toMatch(/migration/i)

    // And the store itself says it, so someone reading the code finds the
    // decision without knowing a record exists.
    const store = read("src", "persistence", "provisional-store.ts")
    const id = /^id: "(ADR-\d{4})"$/m.exec(text.split("---")[1] ?? "")?.[1] as string
    expect(store, "the provisional store does not name the record that decided its fate").toContain(
      id,
    )
  })

  it("dbq/record-is-new-not-a-rewrite — ADR-0003 is left as it was", () => {
    // ADR-0006: an accepted record is never rewritten. ADR-0003 already says
    // OQ-03 and OQ-04 stay open and that a later record closes them, so it
    // must still say exactly that.
    const adr0003 = read("docs", "adr", "ADR-0003-recipe-persistence.md")
    expect(adr0003).toMatch(/^status: accepted$/m)
    expect(adr0003).toContain("**OQ-03 and OQ-04 stay open.**")
    expect(
      adr0003,
      "ADR-0003 was edited to point at its successor instead of being superseded",
    ).not.toMatch(/superseded_by/)
  })
})
