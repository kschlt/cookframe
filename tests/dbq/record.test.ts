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

  it("dbq/record-is-new-not-a-rewrite — ADR-0003's decision is not edited", () => {
    // ADR-0006: an accepted record is never rewritten; a decision changes by a
    // new record that supersedes it.
    //
    // This test used to read that as "ADR-0003 must still say `status:
    // accepted` and must carry no `superseded_by`". That was wrong, and it
    // broke main the moment ADR-0018 landed. `docs/adr/README.md` says
    // supersession is recorded "with `supersedes` and `superseded_by` set on
    // BOTH sides" — so the front matter of a superseded record is exactly what
    // the convention expects to change, and forbidding it forbade the
    // convention.
    //
    // What the rule actually protects is the DECISION: ADR-0003's own body
    // must still say what it said, rather than being quietly edited to close
    // the questions a later record closes. That is what is asserted now.
    const adr0003 = read("docs", "adr", "ADR-0003-recipe-persistence.md")
    expect(adr0003).toContain("**OQ-03 and OQ-04 stay open.**")
    expect(
      adr0003,
      "ADR-0003's body was edited to close the questions instead of being superseded",
    ).not.toMatch(/closed by ADR-0015/)
    // Superseded is allowed; superseded-without-saying-by-what is not.
    if (/^status: superseded$/m.test(adr0003)) {
      expect(adr0003, "a superseded record names its successor").toMatch(/^superseded_by:/m)
    }
  })

  it("dbq/lower-bound-correction-reaches-the-register — the corrected figure has a home outside a test", () => {
    // ADR-0015 reports "445 differed (21%)". That was measured with a
    // comparator that compared leaves as `String(value)`, so a JSON type change
    // counted as no change (see `tests/dbq/diff.test.ts`, which proves the fix).
    // The figure is therefore a lower bound. An accepted record is not
    // rewritten, so the correction has to live somewhere a reader of ADR-0015
    // can find — and a docstring in a test file is not that place, which is
    // exactly the gap a review named.
    const { text } = decidingRecord()
    expect(text, "the record no longer carries the figure this correction is about").toMatch(
      /445 differed/,
    )

    const register = read("docs", "open-questions.md")
    const rows = register.split("\n").filter((l) => /^\| OQ-\d+[a-z]? \|/.test(l))
    const carrying = rows.filter((l) => /445/.test(l) && /lower bound/i.test(l))
    expect(
      carrying,
      "no register row records that ADR-0015's 445/2079 figure is a lower bound",
    ).toHaveLength(1)
    const row = carrying[0] as string
    // It must say WHY it is a bound, or a reader cannot judge how loose it is.
    expect(row, "the row does not say what made the figure a bound").toMatch(/String\(value\)/)
    // And it must stay open: the true figure has not been re-measured.
    expect(row, "the row is marked closed while nothing has re-measured the figure").toMatch(
      /\|\s*open/,
    )
  })

  it("dbq/query-1-timing-correction-reaches-the-register — a figure made incomparable says so", () => {
    // Same class as the lower-bound correction above, and recorded the same way
    // rather than left in a review ledger. ADR-0015's query-1 row was measured
    // when `listLibrary` read whatever `search_path` already pointed at; it now
    // sets the path itself, so a later run's query-1 time carries a round-trip
    // the recorded figure does not. The record is not rewritten, so the register
    // is where a reader of it can meet the caveat.
    //
    // Its own row rather than a line on OQ-34: the two corrections have
    // different subjects (how many leaves differ, versus whether a latency is
    // comparable), they are made wrong by different causes, and each is open on
    // a different re-measurement — so one row carrying both could not be cited
    // precisely, and "closed" would be ambiguous.
    const { text } = decidingRecord()
    expect(text, "the record no longer carries the query-1 row this is about").toMatch(
      /\|\s*1 — library list\s*\|/,
    )

    const register = read("docs", "open-questions.md")
    const rows = register.split("\n").filter((l) => /^\| OQ-\d+[a-z]? \|/.test(l))
    const carrying = rows.filter((l) => /search_path/.test(l) && /listLibrary/.test(l))
    expect(
      carrying,
      "no register row records that ADR-0015's query-1 timing is not comparable",
    ).toHaveLength(1)
    const row = carrying[0] as string
    expect(row, "the row does not say the figure is not comparable").toMatch(
      /\*{0,2}not comparable/,
    )
    expect(row, "the row is marked closed while nothing has re-measured it").toMatch(/\|\s*open/)
    // And it must not be the same row as the lower-bound one: a row carrying two
    // corrections cannot be cited for either.
    expect(row, "the two corrections were merged into one row").not.toMatch(/445/)
  })
})
