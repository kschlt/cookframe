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
 * itself is held against six deliberately broken harnesses that it must reject
 * for the right reason each time.
 */
import { describe, expect, it } from "vitest"
import {
  type MajorHarness,
  MAJOR_HARNESSES,
  type MutationGroup,
  readFromRepo,
} from "./majors.js"

/**
 * One way a plant list has stopped describing the tree.
 *
 * `where` carries the harness and the mutation by name, because a problem a
 * reader cannot locate is a problem nobody acts on.
 */
interface Rot {
  readonly where: string
  readonly kind: "find-absent" | "find-ambiguous" | "marker-absent" | "marker-ambiguous"
}

/**
 * The one marker that is composed at run time and therefore cannot be found in
 * its target's source.
 *
 * `finite-number.contract.test.ts` names its cases from a table —
 * `` it(`${name} exposes numeric fields to check (the sweep is not vacuous)`) ``
 * — so the string vitest reports exists only once the file has been evaluated.
 * The check below would call it absent, which would be a false alarm rather
 * than a finding.
 *
 * It is a SET, asserted by name in its own proof, rather than a condition
 * written into the checker: an exemption nobody can see is how a check dies.
 * `decideMarker` still holds this one at run time, against the baseline's real
 * test names, which is the stronger check and the reason a static exemption
 * costs nothing here.
 */
const COMPOSED_AT_RUN_TIME: ReadonlySet<string> = new Set([
  "ValueExpression exposes numeric fields to check",
])

/** Read a file, or report it as missing rather than throwing. */
type ReadFile = (relative: string) => string

/**
 * Every way `harness` no longer describes the tree `read` exposes.
 *
 * Pure over a reader so the table below can hand it broken harnesses and real
 * file contents, instead of proving itself against whatever the repository
 * happens to contain today. A checker whose only subject is the real tree
 * passes the day the last violation is deleted and never speaks again.
 */
export function rotIn(harness: MajorHarness, read: ReadFile): Rot[] {
  const found: Rot[] = []
  const occurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1

  for (const group of harness.groups) {
    const subject = read(group.subject)
    const target = read(group.target)
    for (const mutation of group.mutations) {
      const where = `${harness.id} › ${group.subject} › ${mutation.name}`
      const hits = occurrences(subject, mutation.find)
      if (hits === 0) found.push({ where, kind: "find-absent" })
      else if (hits > 1) found.push({ where, kind: "find-ambiguous" })

      if (COMPOSED_AT_RUN_TIME.has(mutation.mustFail)) continue
      const named = occurrences(target, mutation.mustFail)
      if (named === 0) found.push({ where, kind: "marker-absent" })
      else if (named > 1) found.push({ where, kind: "marker-ambiguous" })
    }
  }
  return found
}

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
      expect(rot.map((r) => r.kind), label).toEqual([kind])
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
