/**
 * protections/the-typescript-pin-names-what-hangs-on-it — every file that calls
 * the TypeScript compiler API, and every part of it each one calls, named here.
 *
 * TypeScript is pinned to `5.x` until a stable public compiler API covers what
 * this repository uses (ADR-0034, which supersedes ADR-0028). This table is the
 * "what this repository uses". The record points here instead of listing it, so
 * the list has one home, and the proof below holds it to the tree in both
 * directions (ADR-0029). A guard that starts calling a new part of the API is
 * red here by name until the table says so. The same goes for a new file that
 * starts parsing source. So the pin's condition cannot silently describe less
 * than hangs on it, which is how ADR-0028's list of five went stale at twelve.
 *
 * Adding a line here is the whole cost of a new use. The line is also what the
 * next person to consider `typescript@7` reads, so a red here is a question to
 * answer ("does a stable API cover this too?"), not a number to update.
 *
 * `compiler-surface.ts` says what counts as a use, and what does not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  compilerSurfaceIn,
  programFromSources,
  programOver,
  sourcesUnder,
} from "./compiler-surface.js"
import { repoRoot } from "./majors.js"

const PARSE = [
  "Node.getStart",
  "SourceFile.getLineAndCharacterOfPosition",
  "ts.ScriptTarget",
  "ts.createSourceFile",
  "ts.forEachChild",
  "ts.is*",
]

/** Each file that calls the compiler API, and what it calls. */
const COMPILER_API_IN_USE: Readonly<Record<string, readonly string[]>> = {
  "tests/protections/capture-provenance.ts": [
    ...PARSE,
    "CompilerHost.getSourceFile",
    "ModuleResolutionHost.directoryExists",
    "ModuleResolutionHost.fileExists",
    "ModuleResolutionHost.readFile",
    "Node.getText",
    "Program.getTypeChecker",
    "ScriptReferenceHost.getSourceFile",
    "Type.getSymbol",
    "Type.isUnion",
    "TypeChecker.getContextualType",
    "TypeChecker.getSymbolAtLocation",
    "ts.ModuleKind",
    "ts.ModuleResolutionKind",
    "ts.SyntaxKind",
    "ts.createCompilerHost",
    "ts.createProgram",
  ],
  "tests/protections/compiler-surface.test.ts": [
    "System.readFile",
    "ts.parseJsonConfigFileContent",
    "ts.readConfigFile",
    "ts.sys",
  ],
  "tests/protections/compiler-surface.ts": [
    "CompilerHost.getSourceFile",
    "ModuleResolutionHost.directoryExists",
    "ModuleResolutionHost.fileExists",
    "ModuleResolutionHost.readFile",
    "Node.getSourceFile",
    "Program.getSourceFiles",
    "Program.getTypeChecker",
    "Type.getProperty",
    "TypeChecker.getAliasedSymbol",
    "TypeChecker.getSymbolAtLocation",
    "TypeChecker.getTypeAtLocation",
    "ts.SymbolFlags",
    "ts.SyntaxKind",
    "ts.createCompilerHost",
    "ts.createProgram",
    "ts.createSourceFile",
    "ts.forEachChild",
    "ts.is*",
  ],
  "tests/protections/configured-database.ts": [...PARSE, "ts.SyntaxKind"],
  "tests/protections/ingest-entry-points.ts": [
    ...PARSE,
    "ts.SyntaxKind",
    "ts.canHaveModifiers",
    "ts.getModifiers",
  ],
  "tests/protections/proof-names.ts": PARSE,
  "tests/protections/scan-retention-wiring.ts": [
    "Node.getStart",
    "Node.getText",
    "ts.ScriptTarget",
    "ts.createSourceFile",
    "ts.forEachChild",
    "ts.is*",
  ],
  "tests/protections/seam-fields.test.ts": [
    "System.readFile",
    "ts.parseJsonConfigFileContent",
    "ts.readConfigFile",
    "ts.sys",
  ],
  "tests/protections/seam-fields.ts": [
    ...PARSE,
    "CompilerHost.getCurrentDirectory",
    "CompilerHost.getDefaultLibFileName",
    "CompilerHost.getSourceFile",
    "ModuleResolutionHost.directoryExists",
    "ModuleResolutionHost.fileExists",
    "ModuleResolutionHost.readFile",
    "ModuleResolutionHost.realpath",
    "Node.getSourceFile",
    "Program.getSourceFiles",
    "Program.getTypeChecker",
    "Signature.getDeclaration",
    "Signature.getParameters",
    "Type.getCallSignatures",
    "Type.getProperties",
    "Type.getProperty",
    "Type.getSymbol",
    "TypeChecker.getContextualType",
    "TypeChecker.getNonNullableType",
    "TypeChecker.getResolvedSignature",
    "TypeChecker.getSymbolAtLocation",
    "TypeChecker.getTypeAtLocation",
    "TypeChecker.getTypeOfSymbol",
    "ts.ModuleKind",
    "ts.ModuleResolutionKind",
    "ts.SymbolFlags",
    "ts.createCompilerHost",
    "ts.createProgram",
  ],
  "tests/protections/url-capture-wiring.ts": [...PARSE, "Node.getText"],
  "tests/run/mounted-apps.test.ts": [
    "Node.forEachChild",
    "Node.getText",
    "ts.ScriptTarget",
    "ts.SyntaxKind",
    "ts.canHaveModifiers",
    "ts.createSourceFile",
    "ts.getModifiers",
    "ts.is*",
  ],
  "tests/run/shopping-handoff.test.ts": [
    "ts.ScriptTarget",
    "ts.createSourceFile",
    "ts.forEachChild",
    "ts.is*",
  ],
  "tests/slice2/render.test.ts": ["ts.preProcessFile"],
  "tests/slice6/generation-policy.test.ts": ["ts.preProcessFile"],
  "tests/unit/response-header-record.test.ts": [...PARSE, "ts.SyntaxKind"],
}

const options = (() => {
  const config = ts.readConfigFile(join(repoRoot, "tsconfig.json"), ts.sys.readFile)
  return ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot).options
})()

describe("protections/the-typescript-pin-names-what-hangs-on-it", () => {
  it("names every file that calls the compiler API and everything each one calls", () => {
    const found = compilerSurfaceIn(programOver(sourcesUnder(repoRoot), options), repoRoot)
    const declared = Object.fromEntries(
      Object.entries(COMPILER_API_IN_USE).map(([file, uses]) => [file, [...new Set(uses)].sort()]),
    )
    expect(
      found,
      "the compiler API this repository calls, file by file. A new use is a line in the " +
        "table, and a question for the pin: would a stable API cover it too?",
    ).toEqual(declared)
  })

  it("reads every TypeScript source the repository holds, and nothing it installs", () => {
    // The tree holds no `.mts`, `.cts` or `.tsx` that calls the compiler today,
    // so the table above cannot hold the walk's breadth. This does.
    const root = mkdtempSync(join(tmpdir(), "compiler-surface-"))
    try {
      for (const file of [
        "a.ts",
        "b.mts",
        "c.cts",
        "d.tsx",
        "e.js",
        "spikes/f.ts",
        "node_modules/g.ts",
        ".git/h.ts",
        ".aos/i.ts",
      ]) {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), "")
      }
      expect(sourcesUnder(root).map((f) => relative(root, f))).toEqual([
        "a.ts",
        "b.mts",
        "c.cts",
        "d.tsx",
        "spikes/f.ts",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Uses planted in memory, each file carrying one way of reaching the compiler.
 * One program holds them all, because each program loads the compiler's own
 * declarations and that is the slow part.
 */
const planted = (() => {
  const sources: Record<string, string> = {
    "default.ts": `
      import ts from "typescript"
      export const parse = (s: string) => ts.createSourceFile("x.ts", s.trim(), ts.ScriptTarget.Latest)`,
    "namespace.ts": `
      import * as ts from "typescript"
      export const imports = (s: string) => ts.preProcessFile(s)`,
    "named.ts": `
      import { forEachChild, type Node } from "typescript"
      export const walk = (n: Node) => forEachChild(n, () => undefined)`,
    "destructured.ts": `
      import ts from "typescript"
      const { getModifiers, canHaveModifiers: can } = ts
      export const mods = (n: ts.Node) => (can(n) ? getModifiers(n) : undefined)`,
    "method.ts": `
      import ts from "typescript"
      export const line = (sf: ts.SourceFile) => sf.getLineAndCharacterOfPosition(0).line`,
    "predicates.ts": `
      import ts from "typescript"
      export const call = (n: ts.Node) => ts.isIdentifier(n) || ts.isCallExpression(n) || n.kind === ts.SyntaxKind.Block`,
    "helper.ts": `
      import ts from "typescript"
      export const tree = (s: string): ts.SourceFile => ts.createSourceFile("x.ts", s, 99)`,
    "handed-over.ts": `
      import { tree } from "./helper.js"
      export const text = (s: string) => tree(s).getText()`,
    "re-export.ts": `
      export { default as compiler } from "typescript"`,
    "through-re-export.ts": `
      import { compiler } from "./re-export.js"
      export const imports = (s: string) => compiler.preProcessFile(s)`,
    "import-type.ts": `
      export const text = (sf: import("typescript").SourceFile) => sf.getText()`,
    "import-call.ts": `
      export const imports = async (s: string) => (await import("typescript")).default.preProcessFile(s)`,
    "require.cts": `
      import ts = require("typescript")
      export const imports = (s: string) => ts.preProcessFile(s)`,
    "types-and-fields.ts": `
      import type ts from "typescript"
      export const name = (id: ts.Identifier): string => id.text`,
  }
  return compilerSurfaceIn(programFromSources(repoRoot, sources, options), repoRoot)
})()
const usesIn = (file: string): readonly string[] | undefined =>
  planted[`.virtual-compiler-surface/${file}`]

describe("protections/the-compiler-api-scan-sees-every-way-in", () => {
  it("names a call through the default import, and not the string method beside it", () => {
    expect(usesIn("default.ts")).toEqual(["ts.ScriptTarget", "ts.createSourceFile"])
  })

  it("names a call through a namespace import", () => {
    expect(usesIn("namespace.ts")).toEqual(["ts.preProcessFile"])
  })

  it("names a call through a named import", () => {
    expect(usesIn("named.ts")).toEqual(["ts.forEachChild"])
  })

  it("names what is destructured off the namespace, renamed or not", () => {
    expect(usesIn("destructured.ts")).toEqual(["ts.canHaveModifiers", "ts.getModifiers"])
  })

  it("names a method by the type the compiler declares it on", () => {
    expect(usesIn("method.ts")).toEqual(["SourceFile.getLineAndCharacterOfPosition"])
  })

  it("names the node predicates as one family and an enum by its name", () => {
    expect(usesIn("predicates.ts")).toEqual(["ts.SyntaxKind", "ts.is*"])
  })

  it("names a method called on a node that a helper module handed over", () => {
    expect(usesIn("handed-over.ts")).toEqual(["Node.getText"])
  })

  it("names a call through a module that re-exports the compiler", () => {
    expect(usesIn("through-re-export.ts")).toEqual(["ts.preProcessFile"])
  })

  it("names a method called on a value typed by an import type", () => {
    expect(usesIn("import-type.ts")).toEqual(["Node.getText"])
  })

  it("names a call through a dynamic import", () => {
    expect(usesIn("import-call.ts")).toEqual(["ts.preProcessFile"])
  })

  it("names a call through an import-equals require", () => {
    expect(usesIn("require.cts")).toEqual(["ts.preProcessFile"])
  })

  it("does not count types or the syntax tree's data fields", () => {
    expect(usesIn("types-and-fields.ts")).toBeUndefined()
  })
})
