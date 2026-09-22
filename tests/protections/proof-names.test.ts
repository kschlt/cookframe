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
import { IN_A_HELPER, proofNamesIn, unnameableIn } from "./proof-names.js"

const tsFiles = filesUnder(join(repoRoot, "tests"), { match: /\.ts$/ }).map((path) =>
  relative(repoRoot, path).split("\\").join("/"),
)
const testFiles = tsFiles.filter((file) => file.endsWith(".test.ts"))
/** Every other file under `tests/`: vitest runs none of them, but a test file may call one. */
const helperFiles = tsFiles.filter((file) => !file.endsWith(".test.ts"))
const read = (file: string): string => readFileSync(join(repoRoot, file), "utf8")
const byFile = [
  ...testFiles.map((file) => ({ file, ...proofNamesIn(read(file), file) })),
  ...helperFiles.map((file) => ({ file, ...proofNamesIn(read(file), file, { helper: true }) })),
]
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

  it("reads the helpers too, and hears a registration by where it comes from", () => {
    // A helper registers proofs when a test file calls it, and vitest reports
    // them under that test file. So every other file under `tests/` is read as
    // well, and a call registers only when its function is bound to vitest's
    // own. Named rather than counted, both ways: the helper that registers, and
    // the one that has a function of its own called `describe` and registers
    // nothing. A scan that went by the name would count that one's three calls.
    for (const file of ["tests/persistence/repository-contract.ts", "tests/slice5/plist.ts"]) {
      expect(helperFiles, file).toContain(file)
    }
    const registering = byFile
      .filter((f) => helperFiles.includes(f.file) && f.named.length + f.composed.length > 0)
      .map((f) => f.file)
    expect(registering).toEqual(["tests/persistence/repository-contract.ts"])
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
      // Registered through `.each`, so these names come from a table. The
      // reader renders them the way vitest does, and each string below is the
      // one vitest reported for that test (measured 2026-09-22, vitest 5.0.1).
      // One per rule the renderer applies: `%s` over an inline table, `%j`,
      // single-value rows from a `const`, `$key` from a `const` declared inside
      // a `describe`, and `$key` cut at vitest's 40 characters.
      "tests/slice5/plist.test.ts > slice5/plist-reader-reads-the-subset > refuses an unclosed element rather than reading past it",
      'tests/run/configuration.test.ts > run/absent-configuration-refuses-by-name > refuses PUBLIC_BASE_URL "cookframe.test", and says which fault it is',
      "tests/run/fly-configuration.test.ts > run/the-platform-file-carries-no-secret > rejects OPENAI_API_KEY pasted into the environment table",
      "tests/protections/scan-retention-wiring.test.ts > serve/a-photograph-is-kept-before-it-is-read > catches: the put removed",
      "tests/run/fly-configuration.test.ts > run/the-dockerfile-reader-is-precise > rejects: no build table at all — the platform sc…",
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

  it("names every registration whose name it cannot read, and why", () => {
    // What the reader cannot name is left to the instrument's refusal at run
    // time, and listed here by file and reason. Measured 2026-09-22 against
    // vitest's own report of all 1233 tests: every name the reader gives is a
    // name vitest reports, and these are the sites it does not give.
    //
    // This used to be a total, 38. Rendering `.each` titles named 19 of the 21
    // table-driven sites, and the list replaced the total because a total is
    // the weaker form, measured: a registration that moved from one file to
    // another left it green, where a list goes red and names both files.
    //
    // Two kinds are left:
    // - A loop that registers one test per element, with a template name. The
    //   values come from whatever the loop walks, often a directory listing or
    //   another module, which a static reader cannot give.
    // - Two tables the reader does not render: one imported from `src/`, one
    //   built by `.map` over a table of regular expressions.
    // - Everything `runRepositoryContract` registers: 7 suites and the 25 proofs
    //   in them, once per store. vitest reports them under
    //   `tests/persistence/repository-contract.test.ts`, which calls the helper
    //   in a loop over its store registry, and every suite name carries the
    //   store's label. Until the scan read helpers, these were neither named
    //   nor counted.
    //
    // When this is red, look at the new site before moving the list. A name the
    // reader should be able to read belongs in the reader, not in this list.
    //
    // An entry holds file, reason and how often, not which registration: one
    // the reader cannot name has no name to carry. A registration that moves
    // within one file is therefore invisible here, and cannot be otherwise. The
    // 32 helper entries are the widest case of it: one file, one reason.
    const survivors = byFile.flatMap((f) => f.composed.map((c) => `${c.file}: ${c.why}`)).sort()
    const contract = `tests/persistence/repository-contract.ts: ${IN_A_HELPER}`
    const contractSuites = 7
    const contractProofs = 25
    expect(survivors).toEqual([
      "tests/cooking-ux/start-now-admission.test.ts: composed name",
      "tests/dbq/queries.test.ts: composed name",
      "tests/fixtures/public-fixtures.test.ts: composed name",
      "tests/fixtures/public-fixtures.test.ts: composed name",
      "tests/fixtures/public-fixtures.test.ts: composed name",
      "tests/fixtures/public-fixtures.test.ts: composed name",
      "tests/multi-recipe/multi-recipe.test.ts: composed name",
      ...Array.from({ length: contractSuites + contractProofs }, () => contract),
      "tests/run/process.test.ts: composed name",
      "tests/schema/finite-number.contract.test.ts: composed name",
      "tests/schema/finite-number.contract.test.ts: composed name",
      "tests/schema/finite-number.contract.test.ts: composed name",
      "tests/schema/finite-number.contract.test.ts: composed name",
      "tests/schema/finite-number.contract.test.ts: composed name",
      "tests/slice2/render.test.ts: composed name",
      "tests/slice2/render.test.ts: composed name",
      "tests/slice2/render.test.ts: composed name",
      "tests/slice3/schema-org-mapping.test.ts: composed name",
      "tests/slice5/mobile-entry-point.test.ts: named from a table the reader cannot render",
      "tests/slice6/generation-policy.test.ts: named from a table the reader cannot render",
    ])
  })
})

// --- the reader and the checker, held against sources written for them -------

const FIXTURE = `
import { describe, it, suite, test, it as check } from "vitest"
const OBJECTS = [
  { name: "short" },
  { name: "a name longer than forty characters, which vitest cuts" },
  { name: "abcdefghijklmnopqrstuvwxyzabcdefghijkl\u{1F34B}tail" },
] satisfies readonly { name: string }[]
const OBJECTS_TWICE = [{ name: "first" }]
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
  check("through an import under another name", () => {})
  ;[1].forEach((it) => it("a parameter called it"))
  it(\`composed \${x}\`, () => {})
  it.each([1, 2])("row %s", () => {})
  it.for([1, 2])("for row %s", () => {})
  it.each([["a", 1], ["b", 2]] as const)("pair %s", () => {})
  it.each([["x"]])("json %j", () => {})
  it.each(OBJECTS)("object: $name", () => {})
  it.each(make())("from a call %s", () => {})
  it.each([[1]])("a format it does not render %d", () => {})
  it.each([{ name: "o" }])("an object row read as %s", () => {})
  it.each([["a"]])("a key on an array row $name", () => {})
  it.each(OBJECTS_TWICE)("a const declared twice $name", () => {})
  it.each([["a", "b"]])("100% %s", () => {})
  it.each([["a"]])("index %#", () => {})
  it.each([["a"]])("ordinal %$", () => {})
  it.each([{ "a.b": "flat", a: { b: "nested" } }])("a key path $a.b", () => {})
  it.each([[1], ...more])("a table with a spread", () => {})
  it.each([[1], , [2]])("a table with a hole", () => {})
  describe.each([1])("a describe %s", () => {
    it("under a table-driven describe", () => {})
  })
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
;(it as typeof it)("behind a cast", () => {})
{
  const OBJECTS_TWICE = [{ name: "second" }]
}
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
      "f.test.ts > outer > through an import under another name",
      // Rendered from their tables. Each expected string is the name vitest
      // reported when these same registrations ran (measured 2026-09-22,
      // vitest 5.0.1), including the two cut at 40 characters, the second of
      // which is cut one short so as not to split the emoji's surrogate pair.
      "f.test.ts > outer > row 1",
      "f.test.ts > outer > row 2",
      "f.test.ts > outer > for row 1",
      "f.test.ts > outer > for row 2",
      "f.test.ts > outer > pair a",
      "f.test.ts > outer > pair b",
      'f.test.ts > outer > json "x"',
      "f.test.ts > outer > object: short",
      "f.test.ts > outer > object: a name longer than forty characters, wh…",
      "f.test.ts > outer > object: abcdefghijklmnopqrstuvwxyzabcdefghijkl…",
      "f.test.ts > outer > 100% a",
      "f.test.ts > bound > inside a bound describe",
    ])
    expect(composed.map((c) => c.why)).toEqual([
      "composed name",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "named from a table the reader cannot render",
      "a describe named from a table",
      "inside a describe with a composed name",
      "composed name",
      "inside a describe with a composed name",
    ])
    // A KNOWN LIMIT, held as an assertion rather than written as a sentence:
    // a registration called through a cast, `(it as typeof it)("…")`, is
    // read as nothing at all, neither named nor counted. The tree has none.
    // Measured with it: moving one registration out of one file this way and
    // into another left the total unchanged. A reader taught to see through the
    // cast turns this red, and the expectation then changes on purpose.
    expect([...named, ...composed.map((c) => c.why)].join("\n")).not.toContain("behind a cast")
    expect(named.length + composed.length).toBe(35)
  })

  it("counts everything a helper registers, and names none of it", () => {
    // The file a helper's names start with is the caller's, and the helper
    // does not say which caller, or how many. So a helper's suites and proofs
    // are counted even where every name in them is written out.
    const helper = `
import { describe, it } from "vitest"
export function runContract(label: string): void {
  describe(\`contract (\${label})\`, () => {
    it("a proof", () => {})
  })
  describe("a literal suite", () => {
    it("still reported under its caller", () => {})
  })
}
`
    expect(proofNamesIn(helper, "h.ts", { helper: true })).toEqual({
      named: [],
      composed: [4, 5, 7, 8].map((line) => ({
        file: "h.ts",
        line,
        why: IN_A_HELPER,
      })),
    })
  })

  it("registers nothing through a function that is not vitest's, whatever it is called", () => {
    // The shape of \`tests/slice5/plist.ts\`: a function of its own called
    // \`describe\`, and no vitest in sight. And an import of \`test\` from
    // somewhere that is not vitest. Neither registers anything.
    const notVitest = `
import { test } from "./somewhere-else"
function describe(token: unknown): string {
  return String(token)
}
export const found = \`found \${describe("a token")}\`
describe("reads like a suite", () => {})
test("reads like a proof", () => {})
`
    expect(proofNamesIn(notVitest, "p.ts", { helper: true })).toEqual({ named: [], composed: [] })
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
