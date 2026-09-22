/**
 * CFV1-BRD2 — the structural guards' file walk, and its breadth.
 *
 * Every guard that uses {@link filesUnder} asserts that some set of violations
 * is empty. ADR-0029 names why that makes this module dangerous: an assertion
 * of the form "no file does X" is satisfied just as well by a walk that returns
 * no files, so nothing downstream can ever notice the walk getting narrower.
 * Measured before this module existed — narrowing the extension pattern in each
 * of the three suites that had widened it left the whole gate green, 1011
 * passed, byte for byte.
 *
 * So the breadth is named here. The tree below is planted, every file in it is
 * named in the expectation, and the walk has to find each one.
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { filesUnder, SOURCE_EXTENSIONS, type WalkOptions } from "./tree.js"

let root: string

/**
 * The planted tree. Each entry is here to kill something specific:
 *
 * - the four source extensions, because the pattern is the half that measured
 *   green when narrowed;
 * - `nested/deep/`, because a walk that stops descending is the other half, and
 *   it is two levels down so that "descends once" does not pass either;
 * - `notes.md` and `data.json`, because a filter that returns everything is as
 *   wrong as one that returns too little — a guard reading a `.json` as source
 *   reports findings nobody can act on;
 * - `bundle.ts.bak`, because `includes(".ts")` is the substring mistake that
 *   #75 found in a matcher, and this is where it would land in a walk;
 * - `node_modules/`, because the skip set is a third kind of breadth and a
 *   guard that walks into it takes minutes and reports other people's code.
 */
const PLANTED = [
  "a.ts",
  "b.mts",
  "c.cts",
  "d.tsx",
  "notes.md",
  "data.json",
  "bundle.ts.bak",
  "nested/deep/e.ts",
  "nested/deep/f.tsx",
  "node_modules/pkg/index.ts",
]

/** What a source scan must come back with, in full. */
const SOURCES = ["a.ts", "b.mts", "c.cts", "d.tsx", "nested/deep/e.ts", "nested/deep/f.tsx"]

const SKIP = new Set(["node_modules"])

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cookframe-tree-"))
  for (const rel of PLANTED) {
    const full = join(root, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, "// planted\n")
  }
})

afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

const walked = (options: WalkOptions): string[] =>
  filesUnder(root, options).map((p) => relative(root, p).split("\\").join("/"))

describe("support/the-source-walk-reads-every-source-extension", () => {
  it("returns each planted source file, and nothing that is not one", () => {
    // `toEqual` on the whole set rather than a membership check per file: a
    // walk that returned the four extensions AND `data.json` would satisfy
    // every `toContain` and still be wrong in the direction that floods a guard
    // with unreadable input.
    expect(walked({ match: SOURCE_EXTENSIONS, skip: SKIP })).toEqual([...SOURCES].sort())
  })

  it("descends more than one level", () => {
    // Named separately from the case above because the failure reads differently
    // — a walk that stops at the top returns a shorter list that is otherwise
    // correct, and a reader comparing two sorted arrays cannot see which half
    // broke. This one says it.
    expect(
      walked({ match: SOURCE_EXTENSIONS, skip: SKIP }),
      "the walk did not reach a file two directories down",
    ).toContain("nested/deep/e.ts")
  })

  it("does not enter a skipped directory", () => {
    expect(walked({ match: SOURCE_EXTENSIONS, skip: SKIP })).not.toContain(
      "node_modules/pkg/index.ts",
    )
    // And the skip is the caller's, not a built-in: without it the same file is
    // returned. Otherwise this proof would pass against a walk that hard-codes
    // a list, and the `skip` argument could be dropped with nothing noticing.
    expect(walked({ match: SOURCE_EXTENSIONS })).toContain("node_modules/pkg/index.ts")
  })

  it("an unfiltered walk is what a guard that reads every file gets", () => {
    // `tests/unit/repo-config.test.ts` walks without a pattern and filters at
    // the call site. That is a real caller, so the no-pattern arm is a real arm.
    expect(walked({ skip: SKIP })).toEqual(
      [...PLANTED].filter((p) => !p.startsWith("node_modules/")).sort(),
    )
  })

  it("hands back a stable order, because callers compare whole arrays", () => {
    const got = walked({ skip: SKIP })
    expect(
      got,
      "the walk returned directory order, so a caller's `toEqual` reads the filesystem",
    ).toEqual([...got].sort())
    // Stated rather than claimed: this asserts the postcondition, not the
    // `.sort()` call. Measured on this container, `readdirSync` already answers
    // in sorted order for these directories, so removing the sort leaves this
    // green here and reddens wherever it does not. That is the honest strength
    // of the proof — it holds the contract callers rely on, and it does not
    // pretend to pin the line that implements it.
  })

  it("an unreadable directory is empty rather than a throw", () => {
    expect(filesUnder(join(root, "does-not-exist"))).toEqual([])
  })
})

describe("support/the-source-walk-rejects-a-narrower-reference", () => {
  it("every plausibly-narrower walk fails the table above", () => {
    // The lesson from #75, applied here rather than left in a session: plants
    // against the INPUT prove the walk reads the input correctly, never that it
    // has the shape the text claims. What proves the shape is holding the same
    // table against implementations that are wrong in the ways a later reader
    // would actually write — and requiring each to fail it.
    //
    // If a candidate ever agrees with `filesUnder`, either the table stopped
    // discriminating or that candidate is in fact correct. Both need reading,
    // which is why the failure message names the candidate.
    const candidates: ReadonlyArray<readonly [string, (dir: string) => string[]]> = [
      [
        "only .ts, the extension set every suite had drifted back to",
        (dir) => filesUnder(dir, { match: /\.ts$/, skip: SKIP }),
      ],
      [
        "`.ts` and `.mts`, the containment guard's set",
        (dir) => filesUnder(dir, { match: /\.m?ts$/, skip: SKIP }),
      ],
      [
        "a substring test, so `bundle.ts.bak` counts as source",
        (dir) => filesUnder(dir, { skip: SKIP }).filter((f) => f.includes(".ts")),
      ],
      [
        "no pattern at all, so a JSON file is handed to a source scan",
        (dir) => filesUnder(dir, { skip: SKIP }),
      ],
      [
        "top level only, no descent",
        (dir) =>
          filesUnder(dir, { match: SOURCE_EXTENSIONS, skip: SKIP }).filter(
            (f) => !relative(dir, f).includes("/"),
          ),
      ],
    ]

    const expected = [...SOURCES].sort()
    for (const [name, candidate] of candidates) {
      const got = candidate(root)
        .map((p) => relative(root, p).split("\\").join("/"))
        .sort()
      expect(
        got,
        `the walk "${name}" agrees with the real one, so the table above does not discriminate it`,
      ).not.toEqual(expected)
    }
  })
})
