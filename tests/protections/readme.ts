/**
 * What `README.md` says a running instance can do, read so that it can be held
 * against the tree — as a module rather than as exports from a test file.
 *
 * ## Why this exists
 *
 * The README is the one page of this repository an outsider reads first, and
 * until this module nothing held a word of it. Measured in the review of #79:
 * a feature that does not exist was added to "Working today", a limitation was
 * deleted from "Not there yet", and the old Node version was put back — and
 * the whole suite stayed green all three times.
 *
 * The same page then went stale on its own, which is the case that matters
 * more. #94 made the Bring handoff reachable from a running instance, and the
 * README went on saying it was not: once in the list of things "built and
 * tested, but not reachable", once in "Not there yet" as "today only a test
 * harness can reach one". Nobody wrote anything false. The page was true when
 * it was written, and the tree moved under it. That list goes stale BY DESIGN
 * — every item on it is waiting to be wired — so it is the part of the page
 * this guard exists for.
 *
 * ## The rule, and why it is mechanical
 *
 * "Reachable from a running instance" is read literally. The process is
 * `src/server/main.ts`; what it can reach is every module in its import
 * closure; and a capability is reached when a named function is CALLED from a
 * module in that closure. Each capability the README talks about is a row in
 * `readme.test.ts` naming that function, so "is the Bring handoff wired" is
 * decided by whether `issue` is called from a module the process loads, and
 * not by anybody's reading of the prose.
 *
 * The prose side is kept just as blunt. The three lists are found by the
 * sentence that introduces each, and every bullet in them has to be claimed by
 * exactly one row, by a phrase the row names. A bullet nobody claims is a
 * claim nobody checks, so it is red — that is where an invented feature
 * arrives.
 *
 * ## What is deliberately out of reach
 *
 * - **A call is not a path.** `callsTo` sees that a function is called in a
 *   module the process loads, not that a request can reach the call. The
 *   rows for the working features lean on the proofs that do exercise them
 *   over a socket (`run/…`); this module is the link from the page to those,
 *   not a replacement for them.
 * - **The prose outside the three lists** is not read, apart from three
 *   places held elsewhere by name: the release warning and the setup commands
 *   in `readme.test.ts`, and the Node version with every other Node pin in
 *   `tests/unit/repo-config.test.ts`. "Serves its three pages", the measured
 *   figures from the scan-to-shop spike and the date in the Status section are
 *   stated, not measured.
 * - **Two limits in "Not there yet" are not measurable here at all** — the
 *   capture-quality gate and the absence of search and accounts. Their rows
 *   pin that the page keeps saying so, and nothing more. Deleting either is
 *   red; making either false is not.
 *
 * Every function below is pure over TEXT, so the tables in the proof
 * can plant violations into them rather than depend on what the tree holds.
 */
import { posix } from "node:path"
import ts from "typescript"

/**
 * The items of the markdown list that follows the paragraph starting with
 * `lead`, each flattened to one line — or `null` if no line starts with it.
 *
 * `lead` must start exactly one line. A second one is thrown on, not resolved:
 * a page that introduces the same list twice has two lists, and choosing one
 * would guard the other by accident.
 *
 * The list is the first run of `- ` items after the paragraph, with an item's
 * continuation lines (indented) joined onto it. It ends at the first line that
 * is neither, so a blank line ends it too — the README writes its lists tight.
 */
export function bulletsAfter(text: string, lead: string): string[] | null {
  const lines = text.split("\n")
  const starts = lines.flatMap((line, index) => (line.startsWith(lead) ? [index] : []))
  if (starts.length > 1)
    throw new Error(`${starts.length} lines start with ${JSON.stringify(lead)}`)
  const start = starts[0]
  if (start === undefined) return null

  let index = start + 1
  // The rest of the introducing paragraph, then the blank lines after it.
  while (index < lines.length && (lines[index] ?? "").trim() !== "") index += 1
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1

  const items: string[] = []
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (line.startsWith("- ")) items.push(line.slice(2).trim())
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`
    else break
  }
  return items
}

/** Resolution of one relative module specifier against the file importing it. */
function candidates(from: string, specifier: string): string[] {
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier))
  const swapped = joined.replace(/\.([mc]?)js$/, ".$1ts").replace(/\.jsx$/, ".tsx")
  return [...new Set([swapped, joined])]
}

/** The module specifiers a source file loads at run time. */
function loadedSpecifiers(source: string): string[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      // `import type` loads nothing. `import { type X }` still loads the module.
      if (node.importClause?.isTypeOnly !== true) out.push(node.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) out.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** What a process starting at one module loads, and what it failed to find. */
export interface Closure {
  /** Every module reached, the entry included, repository-relative. */
  readonly reached: ReadonlySet<string>
  /** `from -> specifier` for each relative import that resolved to no module. */
  readonly unresolved: readonly string[]
}

/**
 * Every module `entry` loads, directly or through another, following relative
 * specifiers only — a package is not this repository's code.
 *
 * `sources` is the tree as text, keyed by repository-relative path. A relative
 * specifier that resolves to no key is reported rather than dropped: a closure
 * that silently stops at an import it could not read is smaller than the
 * process, and a smaller closure makes every "not reachable" claim easier to
 * pass.
 */
export function moduleClosure(entry: string, sources: ReadonlyMap<string, string>): Closure {
  const reached = new Set<string>()
  const unresolved: string[] = []
  const pending = [entry]
  while (pending.length > 0) {
    const path = pending.pop() as string
    if (reached.has(path)) continue
    const source = sources.get(path)
    if (source === undefined) {
      unresolved.push(`(entry) -> ${path}`)
      continue
    }
    reached.add(path)
    for (const specifier of loadedSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue
      const target = candidates(path, specifier).find((candidate) => sources.has(candidate))
      if (target === undefined) unresolved.push(`${path} -> ${specifier}`)
      else pending.push(target)
    }
  }
  return { reached, unresolved }
}

/**
 * The names `source` declares as something callable or constructible: a
 * function, a class, a method, or a variable (which may hold an arrow).
 *
 * This is what keeps a row in `readme.test.ts` from measuring a function that
 * does not exist. A misspelt name is never called, so a row claiming "not
 * reachable yet" would stay true forever under a typo — green for the wrong
 * reason. Requiring the name to be declared somewhere in `src/` turns the typo
 * red on the day it is written.
 */
export function declaredNames(source: string): Set<string> {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true)
  const out = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isPropertySignature(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      out.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** The name a call or `new` is made to, through parentheses and `!`. */
function calleeName(expression: ts.Expression): string | undefined {
  let node = expression
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  return undefined
}

/**
 * How many times `source` calls `name`, or constructs it with `new`.
 *
 * A call, not a mention: an import, a reference passed along, a comment or a
 * string naming the function do not count, because none of them runs it.
 * `new` counts because a refusal in this codebase is a class thrown, and
 * `throw new MultipleRecipesError(…)` is how that capability is exercised.
 */
export function callsTo(source: string, name: string): number {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      calleeName(node.expression) === name
    ) {
      count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return count
}
