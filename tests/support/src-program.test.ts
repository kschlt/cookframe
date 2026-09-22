/**
 * The type-checked program over `src/`, its breadth, and the census of every
 * program the suite builds.
 *
 * `src-program.ts` says why there is one program. Following ADR-0029, what it
 * reads is named rather than trusted. The guards that use it assert empty sets,
 * and a program that reads fewer files makes each of those easier to satisfy,
 * which nothing downstream can notice. The measured case is the seam guard: it
 * stayed green over a fake planted as a `.mts` file.
 *
 * Each `describe`/`it` string is the proof id it satisfies.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { programOverDir, programOverTree, programsBuiltIn } from "./src-program.js"
import { filesUnder, SOURCE_EXTENSIONS } from "./tree.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const toRepo = (paths: readonly string[], from: string): string[] =>
  paths.map((p) => relative(from, p).split("\\").join("/"))

describe("support/the-program-over-src-reads-what-the-compiler-compiles", () => {
  // Read here without going through the module, so a module that stops asking
  // the compiler disagrees with this rather than with itself.
  const config = ts.readConfigFile(join(repoRoot, "tsconfig.json"), ts.sys.readFile)
  const compiler = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot)
  const program = programOverTree()

  it("reads exactly the files tsc compiles under src/", () => {
    const src = `${join(repoRoot, "src")}/`
    expect(toRepo(program.getRootFileNames(), repoRoot)).toEqual(
      toRepo(
        compiler.fileNames.filter((f) => f.startsWith(src)),
        repoRoot,
      ).sort(),
    )
  })

  it("is typed with the options tsc uses", () => {
    expect(program.getCompilerOptions()).toEqual(compiler.options)
  })

  it("takes no directory, so a caller cannot read less of the tree", () => {
    // What holds this is the compiler, not the runner: at run time an extra
    // argument is ignored, and a guard narrowed this way stayed green under
    // vitest. So the claim is written the one way the suite can state what
    // `tsc` refuses. If `programOverTree` takes a directory again, even as a
    // default, the call below compiles and the directive fails `tsc` as
    // unused. That is the only `@ts-expect-error` in the repository, and this
    // is why. It pins that the function takes no directory; that it reads all
    // of `src/` is the case above.
    // @ts-expect-error TS2554: Expected 0 arguments, but got 1.
    const narrowed = (): ts.Program => programOverTree(join(repoRoot, "src", "pipeline"))
    expect(narrowed).toBeTypeOf("function")
  })

  // `src/` holds nothing but `.ts` today, so the case above cannot tell a
  // program that reads `.ts` alone from one that reads every source extension.
  // This tree can.
  let root: string
  const PLANTED = ["a.ts", "b.mts", "c.cts", "d.tsx", "notes.md", "nested/e.ts"]

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cookframe-src-program-"))
    for (const rel of PLANTED) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), "export {}\n")
    }
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("reads one file of every source extension, and nothing else", () => {
    expect(toRepo(programOverDir(root).getRootFileNames(), root)).toEqual([
      "a.ts",
      "b.mts",
      "c.cts",
      "d.tsx",
      "nested/e.ts",
    ])
  })
})

describe("support/every-type-checked-program-in-the-suite-is-named", () => {
  it("names each file under tests/ that builds a program, and how many it builds", () => {
    // A new entry here is a decision: a guard that wants the tree reads
    // `programOverTree`, and one that needs a program over sources of its own
    // says here why. Two copies of the tree program had already drifted apart
    // by the time there were two.
    const census = Object.fromEntries(
      filesUnder(join(repoRoot, "tests"), { match: SOURCE_EXTENSIONS })
        .map((path) => [toRepo([path], repoRoot)[0], programsBuiltIn(readFileSync(path, "utf8"))])
        .filter(([, count]) => count !== 0),
    )
    expect(census).toEqual({
      // Sources written for the provenance reader, typed as the tree is.
      "tests/protections/capture-provenance.ts": 1,
      // The whole repository, not only `src/`: every file the TypeScript pin
      // hangs on, spikes and config included (ADR-0034, #110). That is a
      // wider reach than `programOverTree`, with its own skip list. The
      // second program is its fixtures.
      "tests/protections/compiler-surface.ts": 2,
      // One test file at a time, bound with nothing resolved and no library,
      // to tell a name imported from vitest from one declared in the file
      // (#109). It never reads `src/`.
      "tests/protections/proof-names.ts": 1,
      // Seams planted in memory, one per condition of the scan.
      "tests/protections/seam-fields.ts": 1,
      // The tree itself, for every guard that reads `src/` with a checker.
      "tests/support/src-program.ts": 1,
    })
  })

  it("counts a program however the call reaches the compiler, and nothing that only names it", () => {
    expect(
      programsBuiltIn(`
import ts, { createProgram } from "typescript"
ts.createProgram(["a.ts"], {})
createProgram(["a.ts"], {})
ts.createWatchProgram(host)
ts.createLanguageService(host)
// ts.createProgram(["in a comment"], {})
const text = "ts.createProgram(['in a string'], {})"
ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest)
program.getTypeChecker()
`),
    ).toBe(4)
  })
})
