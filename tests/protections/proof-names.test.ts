/**
 * protections/every-proof-can-be-named — no proof's full name sits inside
 * another's in the same file, so every proof in the tree can be the assertion a
 * plant names.
 *
 * `proof-names.ts` says why that matters and how the names are read. This file
 * holds the answer to the same standard as every other structural guard here
 * (ADR-0029): the empty set it asserts on the tree means nothing by itself,
 * because a scan that reads nothing also finds no collision. So the breadth is
 * held by names. The scan must read the files vitest runs, and must find, by
 * full name, the proofs that were hidden when this guard was written. What it
 * cannot read is counted. The checker is held against sources that are wrong
 * on purpose, and against one that is right, so the rejections show it can
 * also say yes.
 */
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { filesUnder } from "../support/tree.js"
import { repoRoot } from "./majors.js"
import { proofNamesIn, unnameableIn } from "./proof-names.js"

const testFiles = filesUnder(join(repoRoot, "tests"), { match: /\.test\.ts$/ }).map((path) =>
  relative(repoRoot, path).split("\\").join("/"),
)
const read = (file: string): string => readFileSync(join(repoRoot, file), "utf8")
const byFile = testFiles.map((file) => ({ file, ...proofNamesIn(read(file), file) }))
const everyName = byFile.flatMap((f) => f.named)

describe("protections/every-proof-can-be-named", () => {
  it("reads the files vitest runs", () => {
    // The scan's own pattern is `tests/**/*.test.ts` written as a walk. It is
    // the set vitest runs only while vitest's include says the same, so that is
    // asserted here too: widening the include without widening this scan is red
    // here instead of a set of proofs nothing checks.
    const config = read("vitest.config.ts")
    expect(config.split('include: ["tests/**/*.test.ts"]').length - 1).toBe(1)
    for (const file of [
      "tests/url-fetch/url-security.connector.test.ts",
      "tests/base/merge-gate.test.ts",
      "tests/run/process.test.ts",
      "tests/persistence/postgres-store.test.ts",
      "tests/protections/proof-names.test.ts",
    ]) {
      expect(testFiles, file).toContain(file)
    }
  })

  it("finds, by full name, the proofs that were hidden inside another's name", () => {
    // Each of these was, until this guard, a prefix of a sibling in its own
    // file, so no marker could single it out. They are named here rather than
    // counted: a scan that stops reading one of these files, or stops reading
    // names under a `describe`, loses them and goes red.
    const suite = "tests/url-fetch/url-security.connector.test.ts > CFV1-S5 safe-fetch connector"
    for (const name of [
      `${suite} > url-security/dns-rebinding-refused (one resolution, nothing to rebind to)`,
      `${suite} > url-security/redirect-revalidation (a later hop to a private literal)`,
      `${suite} > url-security/size-bound-fails-closed (declared length over the bound)`,
      `${suite} > url-security/content-type-bound-fails-closed (a type outside the allowlist)`,
      "tests/base/merge-gate.test.ts > base/green-merge-is-not-slowed > lets a green merge result through when the gate is quiet",
      // Registered through `describe.skipIf(cond)("…", …)`, which a reader that
      // only knows the bare `describe(` would pass over, and with it every name
      // the database-backed suites carry.
      "tests/run/process.test.ts > run/the-process-serves-and-stops > starts from the declared command, answers on a real socket, and stops cleanly",
      // Registered through `const withDatabase = describe.skipIf(…)`, a name
      // bound to the registration function. Read without the binding, these
      // proofs lose their `describe` and the factory call reads as a test.
      "tests/persistence/postgres-store.test.ts > persistence/the-migration-builds-the-store > builds a store the repository can immediately write to and read back",
    ]) {
      expect(everyName, name).toContain(name)
    }
  })

  it("no proof's full name is contained in another's in the same file", () => {
    const hidden = byFile.flatMap(({ file, named }) =>
      unnameableIn(named).map((u) => `${file}: ${u.matches.join("  |  ")}`),
    )
    expect(
      hidden,
      "a marker is a substring, so a proof whose name is inside a sibling's can never be the assertion a plant names",
    ).toEqual([])
  })

  it("counts, file by file, the registrations whose names it cannot read", () => {
    // Composed names (a template with a substitution, or a title from an
    // `.each` table) are left to the instrument's refusal at run time. This
    // table is what holds the TREE rather than the reader: a registration whose
    // name the guard cannot see never arrives silently. It is expected to move.
    // Measured twice while this guard waited for review, both times as the only
    // red in the file: #89 took the total from 25 to 26 with one `it.each` in
    // `url-capture-wiring.test.ts`, and #94 took it to 35 with seven in
    // `shopping-handoff.test.ts` and two in `configuration.test.ts`.
    //
    // It is a table and not a total so that a red names the file, and so that
    // a registration moving from one file to another is red too. When a row is
    // red, look at the new sites in that file before touching the row. A name
    // the reader should be able to read belongs in the reader, not in this
    // table. Move the row only when the names there really come from a table
    // or a substitution. A row changed by reflex guards nothing.
    //
    // Against the reader this is redundant, and kept anyway: none of the
    // thirteen plants measured against the reader dies here alone; each also
    // reddens a fixture or a named proof above.
    const perFile = Object.fromEntries(
      byFile.filter((f) => f.composed.length > 0).map((f) => [f.file, f.composed.length]),
    )
    expect(perFile).toEqual({
      "tests/base/merge-gate.test.ts": 1,
      "tests/cooking-ux/start-now-admission.test.ts": 1,
      "tests/dbq/queries.test.ts": 1,
      "tests/fixtures/public-fixtures.test.ts": 4,
      "tests/multi-recipe/multi-recipe.test.ts": 2,
      "tests/protections/url-capture-wiring.test.ts": 1,
      "tests/records/record-ids.test.ts": 1,
      "tests/run/configuration.test.ts": 2,
      "tests/run/fly-configuration.test.ts": 3,
      "tests/run/shopping-handoff.test.ts": 7,
      "tests/schema/finite-number.contract.test.ts": 5,
      "tests/slice2/render.test.ts": 3,
      "tests/slice3/schema-org-mapping.test.ts": 1,
      "tests/slice5/mobile-entry-point.test.ts": 1,
      "tests/slice5/plist.test.ts": 1,
      "tests/slice6/generation-policy.test.ts": 1,
    })
  })
})

// --- the reader and the checker, held against sources written for them -------

const FIXTURE = `
describe("outer", () => {
  it("plain", () => {})
  test("alias", () => {})
  it.skip("skipped", () => {})
  it.skipIf(cond)("conditional", () => {})
  describe.skipIf(cond)("inner", () => {
    it("nested", () => {})
  })
  suite("aliased suite", () => {
    it("in alias", () => {})
  })
  it(\`no substitution\`, () => {})
  it(\`composed \${x}\`, () => {})
  it.each([1, 2])("row %s", () => {})
  describe(\`composed \${x}\`, () => {
    it("lost", () => {})
  })
})
const withDb = describe.skipIf(cond)
withDb("bound", () => {
  it("inside a bound describe", () => {})
})
const pattern = /x/
pattern.test("not a registration")
`

describe("protections/every-proof-can-be-named", () => {
  it("reads full names through every way this tree registers a test", () => {
    const { named, composed } = proofNamesIn(FIXTURE, "f.test.ts")
    expect(named).toEqual([
      "f.test.ts > outer > plain",
      "f.test.ts > outer > alias",
      "f.test.ts > outer > skipped",
      "f.test.ts > outer > conditional",
      "f.test.ts > outer > inner > nested",
      "f.test.ts > outer > aliased suite > in alias",
      "f.test.ts > outer > no substitution",
      "f.test.ts > bound > inside a bound describe",
    ])
    expect(composed.map((c) => c.why)).toEqual([
      "composed name",
      "named from a table",
      "composed name",
      "inside a describe with a composed name",
    ])
  })

  it("accepts names that share a stem but are not inside one another", () => {
    // The shape the renamed proofs now have. Without this row the rejections
    // below would not show that the checker can say yes.
    expect(
      unnameableIn([
        "f > s > url-security/size-bound (declared length)",
        "f > s > url-security/size-bound (decompressed)",
        "f > s > url-security/size-bound-extra (chunked)",
      ]),
    ).toEqual([])
  })

  it("rejects each way one name hides inside another, and says which name hides it", () => {
    const cases: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
      [
        "a name that is a prefix of a sibling's",
        ["f > s > redirect-revalidation", "f > s > redirect-revalidation (named host)"],
        ["f > s > redirect-revalidation"],
      ],
      [
        "the same name twice",
        ["f > s > twice", "f > s > twice"],
        ["f > s > twice", "f > s > twice"],
      ],
      ["a test named like a describe beside it", ["f > x", "f > x > inside"], ["f > x"]],
    ]
    for (const [label, names, hidden] of cases) {
      expect(
        unnameableIn(names).map((u) => u.name),
        label,
      ).toEqual(hidden)
    }
    // The report names the sibling, which is what someone fixing it needs.
    expect(unnameableIn(["f > a", "f > a (b)"])[0]?.matches).toEqual(["f > a", "f > a (b)"])
  })
})
