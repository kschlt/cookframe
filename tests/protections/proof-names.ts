/**
 * Which proofs in this tree the mutation instrument cannot name.
 *
 * `tests/protections/mutation.ts` has a plant name the assertion that must go
 * red, and a marker is a SUBSTRING: `decideMarker` keeps every test the
 * baseline ran whose full name contains the marker, and refuses unless exactly
 * one does. So a proof whose full name sits inside another proof's full name in
 * the same file cannot be named by any marker at all. The tightest marker there
 * is, the proof's own full name, still matches both.
 *
 * Measured when the three major-bump lists were ported (#91). A plant whose
 * natural assertion was `url-security/redirect-revalidation` had to be aimed
 * elsewhere, because a sibling was called `url-security/redirect-revalidation
 * (named host re-classified on connect)`. The same file held three more pairs of
 * that shape and `tests/base/merge-gate.test.ts` one more. Nothing flagged any of
 * them: the instrument refuses at run time, and only for a plant that happens to
 * aim there, which is the next dependency major, possibly a year later.
 *
 * This module answers the question statically, from the source, so the gate
 * can ask it on every push without starting a vitest process.
 *
 * ## What it reads, and what it cannot
 *
 * A test's full name is its file, the names of the `describe` blocks it sits in,
 * and its own name, joined by ` > ` the way vitest reports it. That is decidable
 * from the source when every one of those names is written out as a literal.
 * It is not decidable when a name is composed: a template with a substitution,
 * or a loop that registers one test per element of an array.
 *
 * A test registered through `.each` / `.for` takes its names from a table, and
 * those ARE decidable when the source spells the table out. The reader renders
 * them the way vitest does ({@link renderTable}): the table must be an array
 * literal, written inline or bound to a `const` in the same file, and every
 * value the title uses must be a string or number literal. The title may use
 * `%s`, `%j` and `$key`, and no other sequence vitest formats. Anything outside
 * that subset is counted, not guessed.
 *
 * Everything the reader cannot name is counted as {@link Composed} and left to
 * the instrument's own refusal at run time. The caller pins that set, so a
 * regression that reclassifies literal names as composed turns red instead of
 * quietly shrinking the set this checks.
 *
 * Whether the reader agrees with vitest is not something the suite can check.
 * It is measured, and the measurement is to be repeated whenever the renderer
 * changes: run the whole suite with `--reporter=json`, collect every
 * `fullName`, and compare it with the names this module gives for every
 * `.test.ts` file. A name the reader gives that vitest does not report is a
 * renderer bug; a name vitest reports that the reader neither gives nor counts
 * is a blind spot. Done on 2026-09-22 against vitest 5.0.1: 992 names given,
 * every one reported, and one blind spot, below.
 *
 * The path is taken from where a registration is WRITTEN, and only `.test.ts`
 * files are read. A helper that registers tests from another file is therefore
 * invisible: its proofs are neither named nor counted. The tree has one,
 * `runRepositoryContract` in `tests/persistence/repository-contract.ts`, found
 * by comparing this reader's names with vitest's report. The caller says so
 * beside the list it pins.
 */
import ts from "typescript"
import { decideMarker, type Reading } from "./mutation.js"

/** The registration functions vitest offers. `suite` is `describe`'s alias. */
const TEST_API: ReadonlySet<string> = new Set(["describe", "suite", "it", "test"])

/**
 * Modifiers whose registrations take their names from a table:
 * `it.each(table)("row %s", …)`. The call they return is what registers, and a
 * name like `row %s` is a format, not the name vitest reports.
 */
const TABLE_DRIVEN: ReadonlySet<string> = new Set(["each", "for"])

/**
 * Modifiers that hand back a registration function instead of registering:
 * `describe.skipIf(cond)`, `it.each(table)`. A call to one of these is not a
 * test, and its argument is a condition or a table, not a name.
 */
const FACTORIES: ReadonlySet<string> = new Set(["skipIf", "runIf", ...TABLE_DRIVEN])

/** A registration whose full name the source does not spell out. */
export interface Composed {
  readonly file: string
  readonly line: number
  /** Why the name cannot be read, in a few words. */
  readonly why: string
}

export interface ProofNames {
  /** Full names, `file > describe > … > it`, of every test spelled out in full. */
  readonly named: readonly string[]
  readonly composed: readonly Composed[]
}

interface Api {
  readonly kind: "describe" | "test"
  readonly tableDriven: boolean
}

/**
 * What a call's callee registers, walking through `.skip`, `.only`,
 * `.skipIf(c)` and the like, and through a name bound to one of those.
 */
function apiOf(callee: ts.Expression, aliases: ReadonlyMap<string, Api>): Api | undefined {
  let node: ts.Expression = callee
  let tableDriven = false
  for (;;) {
    if (ts.isIdentifier(node)) {
      const alias = aliases.get(node.text)
      if (alias !== undefined)
        return { kind: alias.kind, tableDriven: tableDriven || alias.tableDriven }
      if (!TEST_API.has(node.text)) return undefined
      const kind = node.text === "describe" || node.text === "suite" ? "describe" : "test"
      return { kind, tableDriven }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (TABLE_DRIVEN.has(node.name.text)) tableDriven = true
      node = node.expression
      continue
    }
    // `describe.skipIf(cond)("name", …)` and `it.each(table)("row %s", …)`: the
    // registering call's callee is itself a call, which hands back the function.
    if (ts.isCallExpression(node)) {
      node = node.expression
      continue
    }
    return undefined
  }
}

/** A call like `describe.skipIf(cond)`: it hands back a registration function. */
function isFactoryCall(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression) && FACTORIES.has(call.expression.name.text)
}

/**
 * Names bound to a registration function, like
 * `const withDatabase = describe.skipIf(baseUrl === undefined)`. The tree
 * registers six suites that way, and without this their proofs would be read
 * with no `describe` in their path.
 */
function aliasesIn(sf: ts.SourceFile): Map<string, Api> {
  const aliases = new Map<string, Api>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const init = node.initializer
      const bindsFunction =
        ts.isPropertyAccessExpression(init) || (ts.isCallExpression(init) && isFactoryCall(init))
      const api = bindsFunction ? apiOf(init, aliases) : undefined
      if (api !== undefined) aliases.set(node.name.text, api)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return aliases
}

function literalText(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/** `x as const`, `x satisfies T`, `(x)`: the value underneath. */
function unwrap(node: ts.Expression): ts.Expression {
  let e = node
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression
  }
  return e
}

/**
 * Every `const` in the file, by name, bound to what it is initialised with.
 * A name declared twice maps to `undefined`: which one a table refers to is a
 * question of scope this reader does not answer, so it does not guess.
 */
function constsIn(sf: ts.SourceFile): Map<string, ts.Expression | undefined> {
  const consts = new Map<string, ts.Expression | undefined>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const name = node.name.text
      consts.set(name, consts.has(name) ? undefined : node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return consts
}

/** The array literal a table is, written inline or bound to a `const`. */
function tableLiteral(
  table: ts.Expression,
  consts: ReadonlyMap<string, ts.Expression | undefined>,
): ts.ArrayLiteralExpression | undefined {
  const e = unwrap(table)
  if (ts.isArrayLiteralExpression(e)) return e
  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text)
    if (init === undefined) return undefined
    const bound = unwrap(init)
    return ts.isArrayLiteralExpression(bound) ? bound : undefined
  }
  return undefined
}

/** A cell's value, when the source spells it out as a string or number. */
function cellValue(node: ts.Expression | undefined): string | number | undefined {
  if (node === undefined) return undefined
  const e = unwrap(node)
  const text = literalText(e)
  if (text !== undefined) return text
  if (ts.isNumericLiteral(e)) return Number(e.text)
  return undefined
}

/**
 * vitest's `truncateString`, which it applies to a `$key` value that is a
 * string, at its default `taskTitleValueFormatTruncate` of 40. `%s` and `%j`
 * are not truncated.
 */
function truncated(value: string, max = 40): string {
  if (value.length <= max) return value
  let end = max - 1
  const before = value[end - 1] ?? ""
  if (before >= "\ud800" && before <= "\udbff") end -= 1
  return `${value.slice(0, end)}…`
}

/** A property of an object literal, by a plain key. */
function propertyOf(row: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const p of row.properties) {
    if (!ts.isPropertyAssignment(p)) continue
    const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined
    if (name === key) return p.initializer
  }
  return undefined
}

/** vitest's `formatRegExp`: every `%` sequence its title formatter consumes. */
const FORMAT = /%[sdjifoOc%]/g
const ATTRIBUTE = /\$([$\p{ID_Continue}.]+)/gu

/**
 * The names vitest gives the rows of `table` under `title`, or `undefined` when
 * any row, value or format is outside the subset this reader renders.
 *
 * The subset is what the tree uses and no more: a row is an array literal, an
 * object literal or a single literal; the title uses `%s` and `%j` against an
 * array row's cells, and `$key` against an object row's properties. Each rule
 * is vitest's own, read from its `formatTitle` in vitest 5, and held by a row
 * of the fixture in `proof-names.test.ts`.
 */
export function renderTable(
  table: ts.Expression,
  title: string,
  consts: ReadonlyMap<string, ts.Expression | undefined>,
): string[] | undefined {
  const rows = tableLiteral(table, consts)
  if (rows === undefined) return undefined
  // `%#` and `%$` are replaced by the row's index before anything else, and
  // `FORMAT` does not see them. A `%` that neither consumes nor rewrites stays
  // in the name as written: `100% %s` renders as `100% a`, measured.
  if (title.includes("%#") || title.includes("%$")) return undefined
  const specs = [...title.matchAll(FORMAT)]
  if (specs.some((m) => m[0] !== "%s" && m[0] !== "%j")) return undefined

  const names: string[] = []
  for (const element of rows.elements) {
    // A spread hides how many rows there are, and a hole is a row vitest
    // skips: two rows written around one register two tests, measured.
    if (ts.isSpreadElement(element)) return undefined
    if (ts.isOmittedExpression(element)) return undefined
    const row = unwrap(element)
    const objectRow = ts.isObjectLiteralExpression(row) ? row : undefined
    const cells = ts.isArrayLiteralExpression(row) ? row.elements : [row]

    let out = ""
    let at = 0
    let next = 0
    const attributes = (segment: string): string | undefined => {
      let failed = false
      const text = segment.replace(ATTRIBUTE, (whole, key: string) => {
        const value =
          objectRow !== undefined && /^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(key)
            ? cellValue(propertyOf(objectRow, key))
            : undefined
        if (typeof value !== "string") failed = true
        return typeof value === "string" ? truncated(value) : whole
      })
      return failed ? undefined : text
    }
    for (const spec of specs) {
      const before = attributes(title.slice(at, spec.index))
      if (before === undefined) return undefined
      // An object row, or a spread cell, is not a literal, so it stops here.
      const value = cellValue(cells[next++])
      if (value === undefined) return undefined
      out += before + (spec[0] === "%j" ? JSON.stringify(value) : String(value))
      at = spec.index + spec[0].length
    }
    const rest = attributes(title.slice(at))
    if (rest === undefined) return undefined
    names.push(out + rest)
  }
  return names
}

/**
 * The rendered names of a table-driven registration, `it.each(table)("title")`,
 * when both the table and the title are written out. A table reached any other
 * way, such as through a name bound to `it.each(table)`, is not rendered.
 */
function rowsOf(
  call: ts.CallExpression,
  consts: ReadonlyMap<string, ts.Expression | undefined>,
): string[] | undefined {
  const title = literalText(call.arguments[0])
  const factory = call.expression
  if (title === undefined || !ts.isCallExpression(factory)) return undefined
  if (!ts.isPropertyAccessExpression(factory.expression)) return undefined
  if (!TABLE_DRIVEN.has(factory.expression.name.text)) return undefined
  const table = factory.arguments[0]
  return table === undefined ? undefined : renderTable(table, title, consts)
}

/**
 * Every test `source` registers, by full name where the source spells it out.
 *
 * `file` is the path relative to the repository root, the way vitest prefixes
 * the names it reports.
 */
export function proofNamesIn(source: string, file: string): ProofNames {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const aliases = aliasesIn(sf)
  const consts = constsIn(sf)
  const named: string[] = []
  const composed: Composed[] = []

  // `path` is undefined under a describe whose own name is composed: the tests
  // inside have a full name the source cannot give either.
  const visit = (node: ts.Node, path: readonly string[] | undefined): void => {
    if (ts.isCallExpression(node) && !isFactoryCall(node)) {
      const api = apiOf(node.expression, aliases)
      if (api !== undefined) {
        const own = api.tableDriven ? undefined : literalText(node.arguments[0])
        const full = path === undefined || own === undefined ? undefined : [...path, own]
        const rows =
          api.tableDriven && api.kind === "test" && path !== undefined
            ? rowsOf(node, consts)
            : undefined
        if (rows !== undefined && path !== undefined) {
          for (const row of rows) named.push([file, ...path, row].join(" > "))
        } else if (full === undefined) {
          composed.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            why: api.tableDriven
              ? api.kind === "describe"
                ? "a describe named from a table"
                : "named from a table the reader cannot render"
              : own === undefined
                ? "composed name"
                : "inside a describe with a composed name",
          })
        } else if (api.kind === "test") {
          named.push([file, ...full].join(" > "))
        }
        // The first argument is the name. What follows is the body, which runs
        // under this block's path. The callee is not visited: when it is a call
        // like `describe.skipIf(cond)`, its argument is a condition or a table,
        // and it registers nothing by itself.
        for (const argument of node.arguments.slice(1)) {
          visit(argument, api.kind === "describe" ? full : path)
        }
        return
      }
    }
    ts.forEachChild(node, (child) => visit(child, path))
  }
  visit(sf, [])
  return { named, composed }
}

/** A proof no marker can single out, and every name its own full name matches. */
export interface Unnameable {
  readonly name: string
  readonly matches: readonly string[]
}

/**
 * The proofs among `names` that `decideMarker` would refuse to name, asked of
 * `decideMarker` itself.
 *
 * Not a re-implementation of its matching rule: if the instrument ever matched
 * differently, this answer would move with it, which is the only way the two
 * stay one rule. `names` are the full names of ONE file, because one file is
 * what a plant runs as its target.
 */
export function unnameableIn(names: readonly string[]): Unnameable[] {
  const baseline: Reading = {
    passed: names.length,
    failed: 0,
    failing: [],
    ran: names,
    reportedATally: true,
  }
  const out: Unnameable[] = []
  for (const name of names) {
    const verdict = decideMarker(baseline, { name, find: "", replace: "", mustFail: name })
    if (!verdict.usable) {
      out.push({ name, matches: names.filter((other) => other.includes(name.trim())) })
    }
  }
  return out
}
