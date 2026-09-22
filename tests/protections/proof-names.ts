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
 * or anything registered through `.each` / `.for`, whose names come from a
 * table. Those are counted as {@link Composed} and left to the instrument's own
 * refusal at run time. The caller pins how many there are in each file, so a
 * regression that reclassifies literal names as composed turns red instead of
 * quietly shrinking the set this checks, and so does a new registration whose
 * name the guard cannot see.
 *
 * The path is taken from where a registration is WRITTEN. A helper function that
 * registers tests from outside the `describe` that calls it would be read with
 * the wrong path. The tree has no such helper today; if one appears, its names
 * show up here without their `describe` prefix.
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

/**
 * Every test `source` registers, by full name where the source spells it out.
 *
 * `file` is the path relative to the repository root, the way vitest prefixes
 * the names it reports.
 */
export function proofNamesIn(source: string, file: string): ProofNames {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const aliases = aliasesIn(sf)
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
        if (full === undefined) {
          composed.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            why: api.tableDriven
              ? "named from a table"
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
