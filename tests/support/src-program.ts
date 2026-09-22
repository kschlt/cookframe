/**
 * The one type-checked program over `src/` that the structural guards read.
 *
 * ## Why one program
 *
 * Two guards read the tree with a type checker, and each built its own program.
 * The copies had already drifted into two answers to both halves of "which
 * program". Measured on `main` at `ac1b39b`:
 *
 * | guard | files | options |
 * | --- | --- | --- |
 * | `protections/a-fake-cannot-hide-a-missing-field` | `/\.ts$/` | the repository's `tsconfig.json` |
 * | `protections/every-capture-context-states-its-provenance` | `SOURCE_EXTENSIONS` | its own, with `types: []` and no `lib` |
 *
 * `src/` holds 55 `.ts` files and nothing else. Both programs type-check it
 * without a diagnostic, and the seam scan reports the same two fields on
 * either. So the drift is invisible today, the way the walk's was before
 * `tree.ts`. It is not harmless. A fake capture provider planted as
 * `src/pipeline/fake-late.mts`, which `tsc` compiles, left the seam guard
 * green. The same file named `fake-late.ts` turned it red at the fakes it
 * names. That is the narrowing `tree.ts` took out of seven walks, back in an
 * eighth.
 *
 * ## Why one program and not one scan
 *
 * The two guards share the program and nothing else. They ask different
 * questions, and their claims have different shapes. The seam scan answers per
 * FIELD: every optional input a fake ignores has a named answer in its table.
 * The provenance scan answers per CONSTRUCTION: every place a capture context
 * is built is named, with what it states. Measured with both on `main`
 * (#107), neither holds the other. A context built from a spread alone is red
 * only at the provenance guard. A new optional field that a fake ignores is
 * red only at the seam guard. A merged scan would have to give both claims one
 * shape, and under ADR-0029 the shape of a claim decides what a guard holds.
 * So what is shared is the part that had drifted, the program. The questions
 * stay apart.
 *
 * ## What holds it
 *
 * `src-program.test.ts` holds three things. The program reads one file of each
 * source extension from a planted tree. It reads exactly what `tsc` compiles
 * under `src/`, and it is typed with the options `tsc` uses. Every place the
 * suite builds a type-checked program is also named there, with how many
 * programs it builds, so a fourth program arrives as a decision rather than as
 * another copy.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { filesUnder, SOURCE_EXTENSIONS } from "./tree.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The options `tsc` type-checks the repository with, read from its `tsconfig.json`. */
export function repositoryCompilerOptions(): ts.CompilerOptions {
  const config = ts.readConfigFile(join(repoRoot, "tsconfig.json"), ts.sys.readFile)
  return ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot).options
}

/**
 * A program over every source file under `dir`, typed the way `tsc` types the
 * repository. `dir` is `src/` except in the proof of this function's own
 * breadth.
 */
export function programOverTree(dir: string = join(repoRoot, "src")): ts.Program {
  return ts.createProgram(
    filesUnder(dir, { match: SOURCE_EXTENSIONS }),
    repositoryCompilerOptions(),
  )
}

/** The compiler API calls that build a program, each of which type-checks what it is handed. */
const BUILDS_A_PROGRAM = new Set(["createProgram", "createWatchProgram", "createLanguageService"])

/**
 * How many places in `text` build a program: calls to one of the functions
 * above, whether they are reached through a namespace (`ts.createProgram`) or
 * imported by name. A mention in a comment or a string is not a call.
 */
export function programsBuiltIn(text: string): number {
  const sf = ts.createSourceFile("census.ts", text, ts.ScriptTarget.Latest, true)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee
      if (ts.isIdentifier(name) && BUILDS_A_PROGRAM.has(name.text)) count++
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return count
}
