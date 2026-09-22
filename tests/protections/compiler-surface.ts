/**
 * Which parts of the TypeScript compiler API each file in the repository calls,
 * found in the tree rather than listed by hand.
 *
 * TypeScript is pinned to `5.x` because `typescript@7` no longer exports the
 * compiler API from its default entry point. The record that holds the pin says
 * what it waits for: a stable public API covering what the guards use. That
 * condition is only as good as the list of what they use, and the first list,
 * written in prose in ADR-0028, named five files and five surfaces. Twelve files
 * used the API by the time anyone counted again, and the surface had grown by a
 * type checker, a compiler host and config parsing. Nothing had gone red. A pin
 * that describes less than hangs on it invites someone to lift it early.
 *
 * So the list is measured here and pinned by name in
 * `compiler-surface.test.ts`, and the record points at that table rather than
 * restating it.
 *
 * **What counts as a use.** Every identifier whose symbol, followed through
 * imports and aliases, is declared in the compiler's own `typescript.d.ts`, when
 * that symbol is a runtime value: a function, a method, a variable or an enum.
 * It is named by where the compiler declares it, so `ts.createSourceFile` and
 * `SourceFile.getLineAndCharacterOfPosition` are named as such whichever local
 * name reached them. Two families collapse to one entry each, because a stable
 * API ships them whole or not at all: the node predicates (`ts.isIdentifier`,
 * `ts.isCallExpression`, …) are `ts.is*`, and an enum's members are the enum.
 *
 * **What does not.** Types used only as annotations are erased at runtime and
 * are not counted. Neither are the syntax tree's data fields (`.text`,
 * `.expression`, `.parent`), which are the shape of what the parser returns, not
 * an entry point. Running `tsc` from `package.json` is a use of the compiler, not
 * of its API, and `typescript@7` keeps it.
 */
import { relative } from "node:path"
import ts from "typescript"
import { filesUnder, SOURCE_EXTENSIONS } from "../support/tree.js"

/** A compiler API file: the declarations everything counted here resolves to. */
const COMPILER_DECLARATIONS = /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]typescript\.d\.ts$/

const RUNTIME =
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Method |
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.Enum |
  ts.SymbolFlags.EnumMember

/**
 * Whether a string literal names a module: in an import or export declaration,
 * `import x = require()`, `import()`, or an import type.
 */
const isModuleSpecifier = (node: ts.StringLiteralLike): boolean => {
  const parent = node.parent
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)
  )
}

/** Directories no scan of the repository's own sources enters. */
const NOT_SOURCES = new Set(["node_modules", ".git", ".aos"])

/**
 * Every TypeScript source under `root`, whatever `tsconfig.json` includes: a
 * spike or a config file that parses source hangs on the pin just the same.
 */
export const sourcesUnder = (root: string): string[] =>
  filesUnder(root, { match: SOURCE_EXTENSIONS, skip: NOT_SOURCES })

/** Build a program over `files`, typed with the repository's own compiler options. */
export function programOver(files: readonly string[], options: ts.CompilerOptions): ts.Program {
  return ts.createProgram([...files], { ...options, noEmit: true })
}

/**
 * The compiler API surface each file in `program` uses, keyed by its path
 * relative to `root`. A file that uses none is absent.
 */
export function compilerSurfaceIn(program: ts.Program, root: string): Record<string, string[]> {
  const checker = program.getTypeChecker()

  /** The symbol a name stands for, through any import or alias. */
  const resolve = (symbol: ts.Symbol | undefined): ts.Symbol | undefined =>
    symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol

  /** How the compiler names a declaration: `ts.x` in the namespace, `Owner.x` in a type. */
  const nameOf = (symbol: ts.Symbol, decl: ts.Declaration): string => {
    let owner: ts.Node = decl.parent
    while (
      !ts.isModuleBlock(owner) &&
      !ts.isInterfaceDeclaration(owner) &&
      !ts.isClassDeclaration(owner) &&
      !ts.isEnumDeclaration(owner) &&
      !ts.isSourceFile(owner)
    ) {
      owner = owner.parent
    }
    if (ts.isEnumDeclaration(owner)) return `ts.${owner.name.text}`
    if (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) {
      return `${owner.name?.text ?? "?"}.${symbol.name}`
    }
    // A module block or the source file itself: the top level of the compiler's
    // `typescript.d.ts` is the `ts` namespace's own declaration, so both name a
    // namespace member. No fixture can tell them apart in the file as it ships.
    if (/^is[A-Z]/.test(symbol.name)) return "ts.is*"
    return `ts.${symbol.name}`
  }

  // Only a file whose imports reach the compiler's declarations, directly or
  // through any chain of modules, can hold a symbol declared there. Resolving
  // every identifier in the tree costs seconds; finding those files first costs
  // a tenth of that, and it misses none: a node handed over by a helper module
  // is typed by the helper, whose imports reach the compiler. Removing this step
  // changes no result, only the time, so no proof can hold it; narrowing it can
  // change results, and the fixture for a node a helper hands over holds that.
  const importers = new Map<string, Set<string>>()
  for (const sf of program.getSourceFiles()) {
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && isModuleSpecifier(node)) {
        const target = checker
          .getSymbolAtLocation(node)
          ?.declarations?.[0]?.getSourceFile().fileName
        if (target !== undefined) {
          const set = importers.get(target) ?? new Set<string>()
          set.add(sf.fileName)
          importers.set(target, set)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const reaching = new Set<string>()
  const queue = [...importers.keys()].filter((f) => COMPILER_DECLARATIONS.test(f))
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const importer of importers.get(file) ?? []) {
      if (!reaching.has(importer)) {
        reaching.add(importer)
        queue.push(importer)
      }
    }
  }

  const surface: Record<string, string[]> = {}
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !reaching.has(sf.fileName)) continue
    const used = new Set<string>()
    const count = (symbol: ts.Symbol | undefined): void => {
      const target = resolve(symbol)
      const decl = target?.declarations?.[0]
      if (target === undefined || decl === undefined) return
      if ((target.flags & RUNTIME) === 0) return
      if (!COMPILER_DECLARATIONS.test(decl.getSourceFile().fileName)) return
      used.add(nameOf(target, decl))
    }
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        if (
          ts.isBindingElement(parent) &&
          parent.name === node &&
          parent.propertyName === undefined
        ) {
          // `const { createSourceFile } = ts`: the name declares a local, so the
          // property it takes is the use. A renamed one, `{ createSourceFile: parse }`,
          // needs nothing here: the checker resolves its property name directly.
          count(checker.getTypeAtLocation(parent.parent).getProperty(node.text))
        } else {
          count(checker.getSymbolAtLocation(node))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (used.size > 0) surface[relative(root, sf.fileName)] = [...used].sort()
  }
  return surface
}

/**
 * A program over sources held in memory, for proofs that must plant a use
 * rather than depend on the tree. They live under a directory inside `root`
 * that does not exist on disk, so `"typescript"` resolves to the repository's
 * own installed compiler, the one the tree scan reads.
 */
export function programFromSources(
  root: string,
  sources: Readonly<Record<string, string>>,
  options: ts.CompilerOptions,
): ts.Program {
  const base = `${root}/.virtual-compiler-surface`
  const files = new Map(Object.entries(sources).map(([p, text]) => [`${base}/${p}`, text]))
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile, directoryExists } = host
  host.fileExists = (f) => files.has(f) || fileExists(f)
  host.directoryExists = (d) => d === base || (directoryExists?.(d) ?? false)
  host.readFile = (f) => files.get(f) ?? readFile(f)
  host.getSourceFile = (f, lang, ...rest) => {
    const text = files.get(f)
    return text === undefined
      ? getSourceFile(f, lang, ...rest)
      : ts.createSourceFile(f, text, lang, true)
  }
  return ts.createProgram([...files.keys()], { ...options, noEmit: true }, host)
}
