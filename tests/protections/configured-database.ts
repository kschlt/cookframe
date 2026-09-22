/**
 * Which database a suite uses is a CONFIGURATION question. This finds the places
 * that answer it with a value nobody configured.
 *
 * The defect this exists for, measured rather than imagined. `spikes/dbq/db.ts`
 * read `process.env.DATABASE_URL ?? DEFAULT_URL` and `tests/dbq/queries.test.ts`
 * gated its suites on whether that URL answered. So the set of proofs that ran
 * was decided by what happened to be listening on the machine: with
 * `DATABASE_URL` unset, `vitest run tests/dbq` answered `34 passed | 1 skipped`
 * with a local server up and `27 passed | 8 skipped` with it stopped (measured
 * 2026-09-22, with a server answering at `DEFAULT_URL` specifically — on a machine
 * whose PostgreSQL listens on another port the old suite read 27/8 either way, so the
 * total depended on which port a correctly set-up machine happened to use). Two correctly set-up machines, one command, seven proofs of
 * difference — and the bigger number is the dishonest one, because nobody had
 * asked for those seven to run. The same substitution wrote a wrong figure into
 * a pull request description, which is how it surfaced.
 *
 * The rule the tree must keep: a test decides what to run from what was
 * CONFIGURED, never from what is REACHABLE. Reachability is still asked — it
 * decides run-versus-fail — but only after configuration has decided
 * skip-versus-not. `decideDatabaseAvailability` in
 * `tests/persistence/postgres-harness.ts` is that rule, and it is reused rather
 * than restated wherever a suite needs it.
 *
 * Detection is separated from the file walk on purpose: `defaultedDatabaseUrls`
 * is a pure function over text, so the breadth table below can hold it against
 * fixtures instead of against whatever the tree happens to contain today. A
 * guard whose subject is only the real tree passes the day someone deletes the
 * last violation and never speaks again.
 */
import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ts from "typescript"

/** One place a database URL is conjured rather than read. */
export interface Finding {
  /** `where:line` — the site, for a message a reader can act on. */
  readonly at: string
  /** Which spelling was found, so a fixture can assert the reason and not just the count. */
  readonly kind: "defaulted-env-read" | "defaulting-import"
}

/** The module whose defaulting accessors the test tree must not reach. */
const SPIKE_DB_MODULE = /spikes\/dbq\/db(\.js)?$/

/**
 * The exports of that module which substitute a URL.
 *
 * `connect` is here as well as `databaseUrl`, and finding that out is the reason
 * this set is a named constant rather than two inline names. `connect()` reads
 * nothing from its caller — it is `connectTo(databaseUrl())` — so a test that
 * imports it has the whole defect back, one call deeper, while a guard keyed on
 * the accessor alone reports nothing. Asking "which spelling still gets past
 * this?" is what turned it up; reading the guard would not have.
 *
 * `connectTo` is deliberately NOT here: it takes the URL it is given, which is
 * the point of the split, and a guard that flagged it would push callers back to
 * the defaulting one.
 */
const DEFAULTING_EXPORTS = new Set(["databaseUrl", "DEFAULT_URL", "connect"])

/** Is this expression a read of `process.env.DATABASE_URL`, in either spelling? */
function readsDatabaseUrl(node: ts.Node): boolean {
  const isEnv = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) &&
    e.name.text === "env" &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "process"

  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "DATABASE_URL" && isEnv(node.expression)
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression
    return ts.isStringLiteralLike(arg) && arg.text === "DATABASE_URL" && isEnv(node.expression)
  }
  return false
}

/**
 * Does `parent` supply a stand-in for `child` when `child` is absent?
 *
 * `??` and `||` both do, and only from the LEFT side: `X ?? fallback` defaults
 * X, while `fallback ?? X` defaults something else and merely mentions X. A
 * conditional counts the same way — `X === undefined ? stand_in : X` is the
 * spelling that survives someone being told not to write `??`.
 */
function suppliesAStandIn(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isBinaryExpression(parent)) {
    const token = parent.operatorToken.kind
    const defaulting =
      token === ts.SyntaxKind.QuestionQuestionToken || token === ts.SyntaxKind.BarBarToken
    return defaulting && parent.left === child
  }
  if (ts.isConditionalExpression(parent)) return true
  return false
}

/**
 * Every place in `source` that turns "no database was configured" into a URL.
 *
 * Pure over text so the table below can plant violations into it. `where` is
 * carried through rather than derived, because a finding a reader cannot locate
 * is a finding nobody acts on.
 */
export function defaultedDatabaseUrls(source: string, where = "in-memory.ts"): Finding[] {
  const file = ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)
  const findings: Finding[] = []
  const at = (node: ts.Node): string =>
    `${where}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`

  const visit = (node: ts.Node): void => {
    // An env read that someone stands in for.
    if (readsDatabaseUrl(node)) {
      // Climb past parentheses and casts, so `(process.env.DATABASE_URL) ?? X`
      // and `(process.env.DATABASE_URL as string) ?? X` are the same finding.
      let child: ts.Node = node
      let parent = node.parent
      while (
        parent !== undefined &&
        (ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isNonNullExpression(parent) ||
          ts.isSatisfiesExpression(parent))
      ) {
        child = parent
        parent = parent.parent
      }
      if (parent !== undefined && suppliesAStandIn(parent, child)) {
        findings.push({ at: at(node), kind: "defaulted-env-read" })
      }
    }

    // An import of an accessor that does the same thing one module away.
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (SPIKE_DB_MODULE.test(node.moduleSpecifier.text)) {
        const bindings = node.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            // The imported NAME, not the local alias: `databaseUrl as u` is the
            // same import, and a guard keyed on the alias is one rename from
            // silent.
            const imported = (element.propertyName ?? element.name).text
            if (DEFAULTING_EXPORTS.has(imported)) {
              findings.push({ at: at(element), kind: "defaulting-import" })
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(file)
  return findings
}

/** Every `.ts` file under `dir`, at any depth. */
export function typeScriptFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...typeScriptFilesUnder(path))
    else if (entry.endsWith(".ts")) out.push(path)
  }
  return out
}

/** `relative`, in one spelling, so a finding reads the same on every platform. */
export function where(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split(sep).join("/")
}
