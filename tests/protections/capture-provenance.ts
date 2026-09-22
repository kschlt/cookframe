/**
 * Where the running instance builds a capture context, and whether each one
 * says where its bytes came from.
 *
 * The defect this exists for, measured. `CaptureContext.sourceProvenance` is
 * optional, and a model-backed provider that finds it absent fails CLOSED to the
 * verified text path (ADR-0019). The photo route in `src/http/ingest-app.ts` was
 * written in parallel with the provenance re-key and never set it. So every
 * photograph a running instance was sent went to the model as its bytes decoded
 * as UTF-8, was refused against that mojibake, and answered 500 after one paid
 * model call (#104). Nothing noticed, because every proof of the route ran on a
 * deterministic fake that ignores the field: a seam fake that ignores a field
 * cannot catch a caller that omits it.
 *
 * **Beside ADR-0033, not instead of it.** That record answers the same incident
 * per FIELD: `protections/a-fake-cannot-hide-a-missing-field` names every
 * optional seam input a shipped implementation reads and a fake ignores, and
 * holds each to a proof over the shipped implementation. For `sourceProvenance`
 * that proof drives the photo route, and only the photo route. This file answers
 * it per CONSTRUCTION: every caller that builds a context states the field. The
 * record rejects "grep for callers that build a `CaptureContext` without the
 * field" as a replacement for its guard, and rightly, since it covers one field
 * of one seam; here it is the other half. Measured with both merged: a new
 * context built from a spread alone stays green at that guard and at the photo
 * proof, and is red only here. A new optional field a fake ignores is red there
 * and invisible here.
 *
 * **The rule.** Every capture context built in `src/` states `sourceProvenance`
 * as its own property. "Built" is a place where an object literal becomes a
 * `CaptureContext`: an argument, an annotated `const`, a `return`, a
 * `satisfies`, or an unannotated `const` that is later handed over as one. The
 * type checker says which literals those are, so the rule does not depend on
 * which function takes the context or at which position.
 *
 * A context a function merely forwards (`capture(input, ctx)` with `ctx` its own
 * parameter) is not built there. Whoever called that function built it, in a
 * position this reads too.
 *
 * **What it cannot read, it reports.** An expression in a `CaptureContext`
 * position that is neither a literal nor a name for one, such as a call to a
 * helper that returns a context, is recorded as unreadable rather than passed
 * over. The caller pins the full set of places, so an unreadable one turns red
 * instead of being trusted.
 *
 * Detection is pure over TEXT, as in `ingest-entry-points.ts`, so the proof can
 * plant violations into sources written for it instead of depending on whatever
 * the tree happens to contain today.
 */
import { relative } from "node:path"
import ts from "typescript"

/** The type whose literals this reads. */
const CAPTURE_CONTEXT = "CaptureContext"

/** The property a capture context has to state. */
const PROVENANCE = "sourceProvenance"

/** A place a capture context is built. */
export interface Construction {
  /** `file > consumer`: the file, and what the context is handed to. */
  readonly site: string
  /** `file:line` of the literal, so a finding names a place. */
  readonly at: string
  /**
   * What the literal states: the provenance when it is a string literal,
   * `"<computed>"` when it is stated as an expression, `"<unreadable>"` for a
   * construction this cannot see into, and `undefined` when it is not stated.
   */
  readonly provenance: string | undefined
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  exactOptionalPropertyTypes: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
}

function isCaptureContext(type: ts.Type | undefined): boolean {
  if (type === undefined) return false
  if (type.getSymbol()?.name === CAPTURE_CONTEXT) return true
  // `ctx: CaptureContext | undefined`, and an optional parameter under
  // `strictNullChecks`, which is the same type.
  return type.isUnion() && type.types.some(isCaptureContext)
}

/** Expressions that hand their operand's value on unchanged. */
function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isConditionalExpression(node)
  )
}

/** Is `node` the name its parent declares or accesses, rather than a value? */
function isNameOfParent(node: ts.Node): boolean {
  return (node.parent as { readonly name?: ts.Node }).name === node
}

/**
 * What `literal` states as its provenance. The LAST of an explicit property and
 * a spread decides, the way the object is built at run time: a spread after the
 * property can put back whatever the spread object carries, which is the
 * absence this rule is about.
 */
function provenanceOf(literal: ts.ObjectLiteralExpression): string | undefined {
  let stated: string | undefined
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      stated = undefined
    } else if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === PROVENANCE
    ) {
      // Only a plain string literal is read as a value. Anything else, a
      // template or an expression, is `<computed>` and counted as unstated:
      // failing closed, the way the provider does.
      const value = property.initializer
      stated = ts.isStringLiteral(value) ? value.text : "<computed>"
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === PROVENANCE) {
      stated = "<computed>"
    }
  }
  return stated
}

function enclosingFunctionName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name !== undefined) {
      return n.name.getText()
    }
    if (ts.isArrowFunction(n) && ts.isVariableDeclaration(n.parent)) {
      return n.parent.name.getText()
    }
  }
  return "<anonymous>"
}

/** What the value at `node` is handed to, in a few words. */
function consumerOf(node: ts.Node): string {
  let position = node
  while (isWrapper(position.parent)) position = position.parent
  const parent = position.parent
  if (ts.isCallExpression(parent)) return parent.expression.getText()
  if (ts.isVariableDeclaration(parent)) return `const ${parent.name.getText()}`
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) {
    return `return from ${enclosingFunctionName(position)}`
  }
  if (ts.isPropertyAssignment(parent)) return `${parent.name.getText()}:`
  return ts.SyntaxKind[parent.kind] ?? "unknown"
}

/**
 * Every capture context `files` build, in the order they are reached: a
 * context built in a `const` is reached where it is handed over.
 *
 * `files` maps absolute paths to source text; a path not in the map is read
 * from disk, which is how the tree's own imports resolve. `root` is what the
 * reported paths are relative to.
 */
export function captureContextsIn(
  files: ReadonlyMap<string, string>,
  root: string,
): Construction[] {
  const base = ts.createCompilerHost(OPTIONS, true)
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (path) => files.has(path) || base.fileExists(path),
    // Module resolution asks for the directory before the file, so a source
    // that exists only in `files` needs its directory to exist too.
    directoryExists: (dir) =>
      [...files.keys()].some((path) => path.startsWith(`${dir}/`)) ||
      (base.directoryExists?.(dir) ?? false),
    readFile: (path) => files.get(path) ?? base.readFile(path),
    getSourceFile: (path, language, onError, create) => {
      const text = files.get(path)
      return text === undefined
        ? base.getSourceFile(path, language, onError, create)
        : ts.createSourceFile(path, text, language, true)
    },
  }
  const program = ts.createProgram([...files.keys()], OPTIONS, host)
  const checker = program.getTypeChecker()
  // A literal reached twice, once where it is written and once through a name
  // for it, is one construction.
  const seen = new Set<ts.Node>()
  const found: Construction[] = []

  for (const path of files.keys()) {
    const sf = program.getSourceFile(path)
    if (sf === undefined) continue
    const file = relative(root, path).split("\\").join("/")
    const record = (literal: ts.Node, consumer: string, provenance: string | undefined): void => {
      if (seen.has(literal)) return
      seen.add(literal)
      const line = sf.getLineAndCharacterOfPosition(literal.getStart(sf)).line + 1
      found.push({
        site: `${file} > ${consumer}`,
        at: `${file}:${line}`,
        provenance,
      })
    }

    const visit = (node: ts.Node): void => {
      // A wrapper is not a construction; its operand is, and is read below it.
      // Nor is a name: in `{ ctx: {…} }` the checker gives the property's NAME
      // the context type as well, and it is not a value.
      if (
        ts.isExpression(node) &&
        !isWrapper(node) &&
        !isNameOfParent(node) &&
        isCaptureContext(checker.getContextualType(node))
      ) {
        if (ts.isObjectLiteralExpression(node)) {
          record(node, consumerOf(node), provenanceOf(node))
        } else if (ts.isIdentifier(node)) {
          // An imported name has no value declaration here and is reported as
          // unreadable, which is failing closed.
          const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
          if (declaration !== undefined && ts.isParameter(declaration)) {
            // Forwarded, not built: its caller's argument is read where it is written.
          } else if (
            declaration !== undefined &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer !== undefined &&
            ts.isObjectLiteralExpression(declaration.initializer)
          ) {
            const literal = declaration.initializer
            record(
              literal,
              `${consumerOf(node)} (via ${declaration.name.getText()})`,
              provenanceOf(literal),
            )
          } else {
            record(node, consumerOf(node), "<unreadable>")
          }
        } else {
          record(node, consumerOf(node), "<unreadable>")
        }
        // A literal's own properties are not contexts; nothing under it is read.
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return found
}

/**
 * The constructions that do not state a provenance this can read as a value:
 * left out, put back by a later spread, computed, or unreadable. A computed
 * value counts, because nothing here can show it is never `undefined`.
 */
export function unstated(constructions: readonly Construction[]): Construction[] {
  return constructions.filter((c) => c.provenance === undefined || c.provenance.startsWith("<"))
}
