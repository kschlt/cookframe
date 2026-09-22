/**
 * Which inputs a seam's fake ignores that its shipped implementation reads,
 * found in the tree.
 *
 * The defect this exists for cost a paid model call per photograph and reached
 * main with every proof green (#104). `CaptureContext.sourceProvenance` is
 * optional, the shipped capture provider decides between the vision path and
 * the verified text path on it alone, and the photo route did not set it. Every
 * proof of the photo route ran on the deterministic fake, which does not read
 * the context at all, so a route that omitted the field and a route that set it
 * were indistinguishable to all of them. The fake was not wrong. It answered
 * correctly for every context it was handed. It simply could not see the one
 * thing that was missing.
 *
 * That is a shape, not a one-off, and ADR-0033 names it: **a fake that ignores
 * a field cannot catch a caller that omits it.** Three conditions make a field
 * dangerous in this way, and each is read here:
 *
 *  1. it is OPTIONAL on a seam's input, so the compiler accepts a caller that
 *     leaves it out;
 *  2. a SHIPPED implementation reads it, directly or through a function it
 *     hands the input to, so leaving it out changes what an instance does;
 *  3. a FAKE implementation of the same seam does not read it, so no proof that
 *     runs on the fake can tell the difference.
 *
 * A seam here is an interface a method is implemented against: an object
 * literal whose contextual type is the interface, or a class that names it in
 * `implements`. A fake is an implementation in a file whose name starts with
 * `fake-`, which is the convention `src/pipeline/fake-providers.ts` set, and
 * every other implementation is shipped. Which files that covers is decided by
 * the program the scan is handed: the proof builds it over `src/`.
 *
 * **What this does not see.** An input handed on through a spread, or to a
 * method of another interface, is not followed, because the program holds no
 * body to follow it into. So an implementation that only forwards counts as not
 * reading. On a fake that errs toward reporting a blind spot. On a shipped
 * implementation it can hide one, unless the implementation it forwards to is
 * itself counted, as the model provider behind the URL composite is. And the
 * scan compares readers, not behaviour: a fake that reads a field and then does
 * nothing with it counts as reading it.
 *
 * Unlike the text-only detectors beside it, this needs a type checker: which
 * interface an object literal implements is its contextual type, and nothing
 * in the literal's own text says so.
 */
import { basename, relative } from "node:path"
import ts from "typescript"

/** One field a fake ignores and a shipped implementation reads. */
export interface BlindSpot {
  /** `Port.method(ParameterType).field`, the stable name a table can hold. */
  readonly key: string
  /** Where a shipped implementation reads it, as `file:line`. */
  readonly readBy: readonly string[]
  /** Where a fake of the same seam implements the method without reading it. */
  readonly ignoredBy: readonly string[]
}

/** One implementation of one seam method, and the optional fields it reads. */
interface Reading {
  readonly slot: string
  readonly optional: readonly string[]
  readonly reads: ReadonlySet<string>
  readonly fake: boolean
  readonly at: string
}

const isFakeFile = (file: string): boolean => basename(file).startsWith("fake-")

/** Build a program over `files`, typed with the repository's own compiler options. */
export function programOver(files: readonly string[], options: ts.CompilerOptions): ts.Program {
  return ts.createProgram([...files], { ...options, noEmit: true })
}

/**
 * Build a program over sources held in memory, for proofs that must plant a
 * seam rather than depend on the tree. Paths are relative to a virtual `src/`.
 */
export function programFromSources(sources: Readonly<Record<string, string>>): ts.Program {
  const root = "/virtual"
  // The smallest default library the checker accepts, so a fixture is typed by
  // its own declarations and nothing else.
  const lib = [
    "Array<T>",
    "Boolean",
    "CallableFunction",
    "Function",
    "IArguments",
    "NewableFunction",
    "Number",
    "Object",
    "RegExp",
    "String",
  ]
    .map((name) => `interface ${name} {}`)
    .join("\n")
  const files = new Map([
    [`${root}/lib.d.ts`, lib],
    ...Object.entries(sources).map(([p, text]): [string, string] => [`${root}/${p}`, text]),
  ])
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  host.fileExists = (f) => files.has(f)
  host.directoryExists = (d) => [...files.keys()].some((f) => f.startsWith(`${d}/`))
  host.realpath = (f) => f
  host.readFile = (f) => files.get(f)
  host.getSourceFile = (f, lang) => {
    const text = files.get(f)
    return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true)
  }
  host.getCurrentDirectory = () => root
  host.getDefaultLibFileName = () => `${root}/lib.d.ts`
  return ts.createProgram([...files.keys()], options, host)
}

/** The blind spots in `program`: see the header for the three conditions. */
export function blindSpotsIn(program: ts.Program, srcRoot: string): BlindSpot[] {
  const checker = program.getTypeChecker()
  const at = (node: ts.Node): string => {
    const sf = node.getSourceFile()
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
    return `${relative(srcRoot, sf.fileName)}:${line + 1}`
  }

  /** The interface a type names, when it names one. */
  const interfaceOf = (type: ts.Type): ts.InterfaceDeclaration | undefined => {
    const t = checker.getNonNullableType(type)
    const decl = (t.aliasSymbol ?? t.getSymbol())?.declarations?.[0]
    return decl !== undefined && ts.isInterfaceDeclaration(decl) ? decl : undefined
  }

  // Which fields of a parameter a function reads, following the parameter into
  // any function it is handed to whose body the program holds. Memoized per
  // (function, parameter index), with a guard against recursion.
  const memo = new Map<ts.Node, Map<number, Set<string>>>()
  const readsOf = (fn: ts.SignatureDeclaration, index: number): Set<string> => {
    const byIndex = memo.get(fn) ?? new Map<number, Set<string>>()
    memo.set(fn, byIndex)
    const known = byIndex.get(index)
    if (known !== undefined) return known
    const reads = new Set<string>()
    byIndex.set(index, reads)
    const param = fn.parameters[index]
    const body = (fn as { body?: ts.Node }).body
    if (param === undefined || body === undefined) return reads
    if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        const name = el.propertyName ?? el.name
        if (!el.dotDotDotToken && ts.isIdentifier(name)) reads.add(name.text)
      }
      return reads
    }
    const symbol = checker.getSymbolAtLocation(param.name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node !== param.name &&
        checker.getSymbolAtLocation(node) === symbol
      ) {
        const parent = node.parent
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          reads.add(parent.name.text)
        } else if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
          for (const el of parent.name.elements) {
            const name = el.propertyName ?? el.name
            if (!el.dotDotDotToken && ts.isIdentifier(name)) reads.add(name.text)
          }
        } else if (
          ts.isCallExpression(parent) &&
          parent.arguments.includes(node as ts.Expression)
        ) {
          const target = checker.getResolvedSignature(parent)?.getDeclaration()
          if (target !== undefined && (target as { body?: ts.Node }).body !== undefined) {
            const argIndex = parent.arguments.indexOf(node as ts.Expression)
            for (const f of readsOf(target, argIndex)) reads.add(f)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    return reads
  }

  const readings: Reading[] = []
  const implement = (
    seam: ts.InterfaceDeclaration,
    seamType: ts.Type,
    method: string,
    fn: ts.SignatureDeclaration,
  ): void => {
    const member = seamType.getProperty(method)
    const signature =
      member === undefined ? undefined : checker.getTypeOfSymbol(member).getCallSignatures()[0]
    if (signature === undefined) return
    signature.getParameters().forEach((parameter, index) => {
      const type = checker.getNonNullableType(checker.getTypeOfSymbol(parameter))
      const input = interfaceOf(type)
      if (input === undefined) return
      const optional = type
        .getProperties()
        .filter((p) => (p.flags & ts.SymbolFlags.Optional) !== 0)
        .map((p) => p.name)
      if (optional.length === 0) return
      readings.push({
        slot: `${seam.name.text}.${method}(${input.name.text})`,
        optional,
        reads: readsOf(fn, index),
        fake: isFakeFile(fn.getSourceFile().fileName),
        at: at(fn),
      })
    })
  }

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const contextual = checker.getContextualType(node)
        const seam = contextual === undefined ? undefined : interfaceOf(contextual)
        if (contextual !== undefined && seam !== undefined) {
          const seamType = checker.getNonNullableType(contextual)
          for (const prop of node.properties) {
            if (prop.name === undefined || !ts.isIdentifier(prop.name)) continue
            if (ts.isMethodDeclaration(prop)) implement(seam, seamType, prop.name.text, prop)
            else if (
              ts.isPropertyAssignment(prop) &&
              (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
            )
              implement(seam, seamType, prop.name.text, prop.initializer)
          }
        }
      }
      if (ts.isClassDeclaration(node)) {
        for (const clause of node.heritageClauses ?? []) {
          for (const expression of clause.types) {
            const seamType = checker.getTypeAtLocation(expression)
            const seam = interfaceOf(seamType)
            if (seam === undefined) continue
            for (const m of node.members) {
              if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
                implement(seam, seamType, m.name.text, m)
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  const spots: BlindSpot[] = []
  for (const slot of [...new Set(readings.map((r) => r.slot))].sort()) {
    const here = readings.filter((r) => r.slot === slot)
    for (const field of here[0]?.optional ?? []) {
      const readBy = here.filter((r) => !r.fake && r.reads.has(field)).map((r) => r.at)
      const ignoredBy = here.filter((r) => r.fake && !r.reads.has(field)).map((r) => r.at)
      if (readBy.length > 0 && ignoredBy.length > 0) {
        spots.push({ key: `${slot}.${field}`, readBy, ignoredBy })
      }
    }
  }
  return spots
}

/** Every file this scan counts as holding fakes, relative to `srcRoot`: its breadth. */
export function fakeFilesIn(program: ts.Program, srcRoot: string): string[] {
  return program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && isFakeFile(sf.fileName))
    .map((sf) => relative(srcRoot, sf.fileName))
    .sort()
}
