/**
 * protections/the-major-plants-still-describe-this-tree — the lists in
 * `majors.ts` are checked against the tree on every run of the gate, although
 * running them is a command that takes minutes.
 *
 * A plant list rots in exactly two ways, and both are silent:
 *
 *  - **The text it replaces has moved.** `plant` refuses that at run time, but
 *    the refusal only arrives the next time somebody runs the harness — which
 *    for a major-bump list is the next major bump, possibly a year later. Until
 *    then the list looks like evidence.
 *  - **The assertion it names has been renamed.** `decideMarker` refuses that
 *    too, and at the same late moment. A marker that matches nothing reports a
 *    survivor forever; one that matches several cannot say which assertion
 *    objected.
 *
 * Both are decidable against the tree without starting a single vitest process,
 * so they are asked here, cheaply, on every push. That is the whole trade: the
 * expensive half (does the guard actually go red) is a command for the next
 * bump; the cheap half (does this list still describe the code) is the gate's.
 *
 * ADR-0029 is why the assertions below name things rather than count them. "No
 * problems were found" is satisfied by a checker that looks at nothing, so the
 * inventory is pinned by name, the total is pinned by number, and the checker
 * itself is held against four deliberately broken harnesses that it must reject
 * for the right reason each time — plus a healthy one it must accept, without
 * which the four rejections would not tell a reader that the checker can say
 * yes, and an emptied one, which is the shape this whole file is about.
 */
import { describe, expect, it } from "vitest"
import {
  COMPOSED_AT_RUN_TIME,
  exitCodeFor,
  MAJOR_HARNESSES,
  type MajorHarness,
  type MutationGroup,
  type ReadFile,
  type Rot,
  readFromRepo,
  rotIn,
  sumTallies,
  type Tally,
  tallyGroup,
} from "./majors.js"
import type { HarnessReport, MutantVerdict, MutationResult } from "./mutation.js"

const fromRepo: ReadFile = readFromRepo

describe("protections/the-major-plants-still-describe-this-tree", () => {
  it("names the three majors that were settled by planting, and nothing else", () => {
    // The inventory by name, so that deleting a harness is an edit to this line
    // rather than a quietly shorter loop below. Every assertion in this file
    // iterates the list, and a loop over an emptied list passes.
    expect(MAJOR_HARNESSES.map((h) => h.id)).toEqual(["node-26", "zod-4", "hono-node-server-2"])
    expect(MAJOR_HARNESSES.map((h) => h.landedIn)).toEqual(["#72", "#76", "#77"])
  })

  it("carries every plant those three pull requests measured, counted", () => {
    const total = MAJOR_HARNESSES.flatMap((h) => h.groups).flatMap((g) => g.mutations).length
    // Twenty-two, and the number is written here rather than derived so that a
    // mutation disappearing in a refactor is a failing assertion instead of a
    // smaller sum. Node contributes ten — eight against the guard that compares
    // the four places a Node major is written down, two against product code on
    // the new runtime — zod eight, the adapter four. One of the adapter's four
    // is the same edit as one of node's, kept in both because the question each
    // asks is different; the total counts plants, not distinct edits.
    expect(total).toBe(22)
    expect(MAJOR_HARNESSES.map((h) => h.groups.flatMap((g) => g.mutations).length)).toEqual([
      10, 8, 4,
    ])
  })

  it("every plant's text is still in its subject, exactly once", () => {
    const rot = MAJOR_HARNESSES.flatMap((h) => rotIn(h, fromRepo)).filter((r) =>
      r.kind.startsWith("find-"),
    )
    expect(
      rot.map((r) => `${r.kind}: ${r.where}`),
      "a plant whose text has moved reports a survivor forever, and one that matches twice changes more than it names",
    ).toEqual([])
    // The zero above is held by the fixtures below, not by itself: on its own
    // it is exactly the empty-set assertion ADR-0029 names, satisfied by a
    // checker that looks at nothing.
  })

  it("every plant still names an assertion that exists, exactly once", () => {
    const rot = MAJOR_HARNESSES.flatMap((h) => rotIn(h, fromRepo)).filter((r) =>
      r.kind.startsWith("marker-"),
    )
    expect(
      rot.map((r) => `${r.kind}: ${r.where}`),
      "a marker naming no test reports a survivor forever; one naming several cannot say which assertion objected",
    ).toEqual([])
  })

  it("exempts exactly one marker from the static check, and says why in the set", () => {
    // Measured, and the reason the exemption is one line rather than a rule:
    // twenty-one of the twenty-two markers appear verbatim in their target's
    // source. Only the table-composed one does not.
    expect([...COMPOSED_AT_RUN_TIME]).toEqual(["ValueExpression exposes numeric fields to check"])
    const verbatim = MAJOR_HARNESSES.flatMap((h) => h.groups).flatMap((g) =>
      g.mutations.map((m) => readFromRepo(g.target).includes(m.mustFail)),
    )
    expect(verbatim.filter((seen) => seen).length).toBe(21)
  })
})

// --- the checker is held against harnesses that are wrong on purpose --------

/**
 * A subject and a target the fixtures below share, so that a broken harness is
 * the only thing that differs between a rejected one and an accepted one.
 */
const FIXTURE_FILES: Record<string, string> = {
  "subject.ts": 'const x = 1\nconst pinned = "26"\n',
  // The SAME text twice, which is the case `plant` refuses: an edit that lands
  // in two places is not the edit its name describes. A near-miss second line
  // would leave this fixture proving nothing, and did on the first run.
  "subject-twice.ts": 'const pinned = "26"\nconst pinned = "26"\n',
  "spec.ts": 'it("the pin is read from one place", () => {})\n',
  "spec-twice.ts":
    'it("the pin is read from one place", () => {})\nit("the pin is read from one place, and nowhere else", () => {})\n',
}

const fixtureRead: ReadFile = (relative) => FIXTURE_FILES[relative] ?? ""

const harness = (group: Partial<MutationGroup> = {}): MajorHarness => ({
  id: "fixture",
  threat: "a fixture",
  landedIn: "#0",
  groups: [
    {
      subject: "subject.ts",
      target: "spec.ts",
      mutations: [
        {
          name: "the pin moves",
          find: 'const pinned = "26"',
          replace: 'const pinned = "24"',
          mustFail: "the pin is read from one place",
        },
      ],
      ...group,
    },
  ],
})

describe("protections/the-major-plants-still-describe-this-tree", () => {
  it("accepts a harness that does describe its tree — so the rejections below mean something", () => {
    expect(rotIn(harness(), fixtureRead)).toEqual([])
  })

  it("rejects a harness that is wrong, and says which way it is wrong", () => {
    // Four defects, four different verdicts. A checker that answered "rot" for
    // all four would pass a table that only counted them, which is why each row
    // names its kind.
    const cases: ReadonlyArray<readonly [string, MajorHarness, Rot["kind"]]> = [
      [
        "the text to replace is gone from the subject",
        harness({
          mutations: [
            {
              name: "the pin moves",
              find: 'const pinned = "22"',
              replace: "x",
              mustFail: "the pin is read from one place",
            },
          ],
        }),
        "find-absent",
      ],
      [
        "the text to replace is in the subject twice",
        harness({ subject: "subject-twice.ts" }),
        "find-ambiguous",
      ],
      [
        "the assertion it names has been renamed away",
        harness({
          mutations: [
            {
              name: "the pin moves",
              find: 'const pinned = "26"',
              replace: "x",
              mustFail: "an assertion nobody wrote",
            },
          ],
        }),
        "marker-absent",
      ],
      [
        "the assertion it names matches two tests",
        harness({ target: "spec-twice.ts" }),
        "marker-ambiguous",
      ],
    ]

    for (const [label, broken, kind] of cases) {
      const rot = rotIn(broken, fixtureRead)
      expect(
        rot.map((r) => r.kind),
        label,
      ).toEqual([kind])
    }
  })

  it("does not let an empty harness pass as a healthy one", () => {
    // The shape this whole file is about: a harness with no groups reports no
    // rot, and reads as "nothing wrong" to anything that only asks for the
    // problem count. What separates the two is an inventory that NAMES what
    // must be there — which is the first proof above, held here against the
    // thing it must not accept.
    const emptied: MajorHarness = { id: "fixture", threat: "", landedIn: "#0", groups: [] }
    expect(rotIn(emptied, fixtureRead)).toEqual([])
    expect(emptied.groups.flatMap((g) => g.mutations).length).toBe(0)
    expect(MAJOR_HARNESSES.flatMap((h) => h.groups).length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * protections/the-majors-run-counts-what-it-planned
 *
 * `npm run majors` reports its answer twice: a line of counts and an exit code.
 * Both used to be worked out inline in `majors.run.ts`, a file only the npm
 * script reaches, and the review of #91 measured what that cost: counting
 * refusals as nothing, and exiting 0 whatever happened, both went green through
 * the whole gate. The arithmetic is now `tallyGroup`, `sumTallies` and
 * `exitCodeFor` in `majors.ts`, and it is held here the way the rest of this
 * repository holds a rule: a table of cases, a list of wrong implementations
 * the table must tell apart from the real one, and a check that every row
 * refuses at least one of them, so no row is along for the ride.
 * ------------------------------------------------------------------ */

/**
 * Every outcome a mutant can have, by name. The type below turns a new outcome
 * added to `MutantVerdict` into a compile error here, so the table cannot fall
 * behind the verdicts it counts.
 */
const OUTCOMES = ["killed", "survived", "inconclusive"] as const
type Unlisted = Exclude<MutantVerdict["outcome"], (typeof OUTCOMES)[number]>
const everyOutcomeListed: [Unlisted] extends [never] ? true : false = true

const verdictOf = (outcome: (typeof OUTCOMES)[number]): MutantVerdict =>
  outcome === "inconclusive" ? { outcome, why: "fixture" } : { outcome }

const resultOf = (outcome: (typeof OUTCOMES)[number]): MutationResult => ({
  mutation: { name: outcome, find: "a", replace: "b", mustFail: "t" },
  verdict: verdictOf(outcome),
  measuredAt: "t",
})

const reportOf = (
  outcomes: readonly (typeof OUTCOMES)[number][],
  refusals = 0,
  baselineUsable = true,
): HarnessReport => ({
  baseline: baselineUsable
    ? { usable: true, summary: "fixture" }
    : { usable: false, refusal: "fixture" },
  results: outcomes.map(resultOf),
  refusals: Array.from({ length: refusals }, (_, i) => `refusal ${i}`),
})

type TallyRow = readonly [label: string, report: HarnessReport, planned: number, expected: Tally]

const TALLY_ROWS: readonly TallyRow[] = [
  [
    "every planned mutation killed",
    reportOf(["killed", "killed", "killed"]),
    3,
    { killed: 3, notKilled: 0 },
  ],
  ["a survivor", reportOf(["killed", "killed", "survived"]), 3, { killed: 2, notKilled: 1 }],
  [
    "an inconclusive run",
    reportOf(["killed", "killed", "inconclusive"]),
    3,
    { killed: 2, notKilled: 1 },
  ],
  ["a refusal", reportOf(["killed", "killed"], 1), 3, { killed: 2, notKilled: 1 }],
  ["every mutation refused", reportOf([], 3), 3, { killed: 0, notKilled: 3 }],
  ["a refused baseline, which ran none", reportOf([], 0, false), 3, { killed: 0, notKilled: 3 }],
  // A report that arrives despite a refused baseline, and accounts for every
  // mutation: none of it counts, because a kill against a baseline that was not
  // green is not attributable to the mutation. Without this row the baseline
  // branch in tallyGroup is deletable — the row above has no results, so the
  // accounting check beneath it returns the same answer.
  [
    "a refused baseline whose report nevertheless accounts for every mutation",
    reportOf(["killed", "killed", "killed"], 0, false),
    3,
    { killed: 0, notKilled: 3 },
  ],
  ["a report that lost a mutation", reportOf(["killed", "killed"]), 3, { killed: 0, notKilled: 3 }],
  [
    "a report with more than was planned",
    reportOf(["killed", "killed", "killed", "killed"]),
    3,
    { killed: 0, notKilled: 3 },
  ],
]

type ExitRow = readonly [label: string, total: Tally, expected: 0 | 1]

const EXIT_ROWS: readonly ExitRow[] = [
  ["every mutation killed", { killed: 22, notKilled: 0 }, 0],
  ["one mutation killed and none missed", { killed: 1, notKilled: 0 }, 0],
  ["one not killed among many kills", { killed: 21, notKilled: 1 }, 1],
  ["nothing killed", { killed: 0, notKilled: 3 }, 1],
  ["nothing run at all", { killed: 0, notKilled: 0 }, 1],
]

/** For every row, whether `rule` gives the row's expected answer. */
const agreesOnEach = <R extends readonly unknown[], A>(
  rows: readonly R[],
  rule: (row: R) => A,
  expected: (row: R) => A,
): boolean[] => rows.map((row) => JSON.stringify(rule(row)) === JSON.stringify(expected(row)))

describe("protections/the-majors-run-counts-what-it-planned", () => {
  it("lists every outcome a mutant can have, and the table uses each of them", () => {
    expect(everyOutcomeListed).toBe(true)
    const used = new Set(
      TALLY_ROWS.flatMap(([, report]) => report.results.map((r) => r.verdict.outcome)),
    )
    expect([...used].sort()).toEqual([...OUTCOMES].sort())
  })

  it("counts a group against the mutations it planned", () => {
    for (const [label, report, planned, expected] of TALLY_ROWS) {
      expect(tallyGroup(report, planned), label).toEqual(expected)
    }
  })

  it("protections/tally-table-discriminates — tells the count apart from each wrong one, and every row refuses one", () => {
    type Rule = (report: HarnessReport, planned: number) => Tally
    const kills = (report: HarnessReport) =>
      report.results.filter((r) => r.verdict.outcome === "killed").length
    const candidates: ReadonlyArray<readonly [string, Rule]> = [
      [
        "the loop #91 shipped, which trusts the report to account for every mutation",
        (report, planned) =>
          report.baseline.usable
            ? {
                killed: kills(report),
                notKilled: report.results.length - kills(report) + report.refusals.length,
              }
            : { killed: 0, notKilled: planned },
      ],
      [
        "not counting refusals",
        (report, planned) =>
          report.baseline.usable
            ? { killed: kills(report), notKilled: report.results.length - kills(report) }
            : { killed: 0, notKilled: planned },
      ],
      [
        "trusting a report that arrives despite a refused baseline",
        (report, planned) =>
          tallyGroup({ ...report, baseline: { usable: true, summary: "trusted" } }, planned),
      ],
      [
        "not counting a refused baseline",
        (report, planned) =>
          report.baseline.usable ? tallyGroup(report, planned) : { killed: 0, notKilled: 0 },
      ],
      [
        "counting a survivor as a kill",
        (report, planned) => {
          const t = tallyGroup(report, planned)
          const survivors = report.results.filter((r) => r.verdict.outcome === "survived").length
          return t.killed === 0
            ? t
            : { killed: t.killed + survivors, notKilled: t.notKilled - survivors }
        },
      ],
      [
        "counting an inconclusive run as a kill",
        (report, planned) => {
          const t = tallyGroup(report, planned)
          const unclear = report.results.filter((r) => r.verdict.outcome === "inconclusive").length
          return t.killed === 0
            ? t
            : { killed: t.killed + unclear, notKilled: t.notKilled - unclear }
        },
      ],
      [
        "counting against the plan without checking the report accounts for it",
        (report, planned) =>
          report.baseline.usable
            ? { killed: kills(report), notKilled: planned - kills(report) }
            : { killed: 0, notKilled: planned },
      ],
      ["never counting a kill", (_report, planned) => ({ killed: 0, notKilled: planned })],
    ]
    const expected = ([, , , tally]: TallyRow) => tally
    expect(
      agreesOnEach(TALLY_ROWS, ([, r, p]) => tallyGroup(r, p), expected).every(Boolean),
      "the table does not agree with tallyGroup",
    ).toBe(true)
    const verdicts = candidates.map(([name, rule]) => ({
      name,
      agrees: agreesOnEach(TALLY_ROWS, ([, r, p]) => rule(r, p), expected),
    }))
    for (const { name, agrees } of verdicts) {
      expect(
        agrees.every(Boolean),
        `the tally table cannot tell the count apart from ${name}`,
      ).toBe(false)
    }
    TALLY_ROWS.forEach(([label], i) => {
      expect(
        verdicts.some(({ agrees }) => !agrees[i]),
        `the row "${label}" refuses no candidate, so it measures nothing`,
      ).toBe(true)
    })
  })

  it("adds a run's tallies up, all of them", () => {
    expect(sumTallies([])).toEqual({ killed: 0, notKilled: 0 })
    expect(
      sumTallies([
        { killed: 10, notKilled: 0 },
        { killed: 7, notKilled: 1 },
        { killed: 0, notKilled: 4 },
      ]),
    ).toEqual({ killed: 17, notKilled: 5 })
  })

  it("exits 0 only when every mutation was killed and at least one was", () => {
    for (const [label, total, expected] of EXIT_ROWS) {
      expect(exitCodeFor(total), label).toBe(expected)
    }
  })

  it("protections/exit-table-discriminates — tells the exit code apart from each wrong one, and every row refuses one", () => {
    type Rule = (total: Tally) => number
    const candidates: ReadonlyArray<readonly [string, Rule]> = [
      ["always exiting 0, as the #91 plant did", () => 0],
      ["always exiting 1", () => 1],
      ["passing a run that ran nothing", (t) => (t.notKilled === 0 ? 0 : 1)],
      ["passing on any kill", (t) => (t.killed > 0 ? 0 : 1)],
      ["passing when most were killed", (t) => (t.notKilled < t.killed ? 0 : 1)],
    ]
    const expected = ([, , code]: ExitRow) => code
    expect(agreesOnEach(EXIT_ROWS, ([, t]) => exitCodeFor(t), expected).every(Boolean)).toBe(true)
    const verdicts = candidates.map(([name, rule]) => ({
      name,
      agrees: agreesOnEach(EXIT_ROWS, ([, t]) => rule(t), expected),
    }))
    for (const { name, agrees } of verdicts) {
      expect(agrees.every(Boolean), `the exit table cannot tell the rule apart from ${name}`).toBe(
        false,
      )
    }
    EXIT_ROWS.forEach(([label], i) => {
      expect(
        verdicts.some(({ agrees }) => !agrees[i]),
        `the row "${label}" refuses no candidate, so it measures nothing`,
      ).toBe(true)
    })
  })

  it("is what majors.run.ts reports with, and that file adds nothing up itself", () => {
    // The tables prove the functions; this proves the run calls them. Without
    // it the arithmetic could be copied back inline and every row above would
    // still pass, about functions nothing uses.
    const run = readFromRepo("tests/protections/majors.run.ts")
    expect(run).toContain("tallies.push(tallyGroup(report, group.mutations.length))")
    expect(run).toContain("const total = sumTallies(tallies)")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the run file's own template is the point
    expect(run).toContain("${total.killed} killed, ${total.notKilled} not killed")
    expect(run.match(/process\.exit\([^)]*\)/g)).toEqual([
      "process.exit(2)",
      "process.exit(exitCodeFor(total)",
    ])
    // An update operator on a name, on either side: the shape a count written
    // inline takes. The `---` in the printed headings is not one.
    expect(
      run.match(/[\w\])]\s*(?:\+\+|--|\+=|-=)|(?:\+\+|--)\s*[A-Za-z_]/g),
      "arithmetic written inline in majors.run.ts",
    ).toBeNull()
  })
})
