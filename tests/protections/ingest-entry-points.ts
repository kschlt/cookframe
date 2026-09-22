/**
 * A way to get a recipe into this instance is a way somebody can USE.
 *
 * The defect this exists for, measured rather than imagined. CFV1-SL4 built the
 * URL import — the safe-fetch guard, the byte-source seam, the deterministic
 * JSON-LD adapter, `importFromUrl` composing them onto the shared ingest spine —
 * and proved all of it. Then nothing in `src/` ever called it. Measured on
 * 2026-09-22 against `a8c51ea`: `grep -rn importFromUrl src/` found the
 * declaration and no caller, so a running instance had no address that could
 * import a link. Every proof of the import was true, and not one of them was
 * about the instance.
 *
 * That is this repository's fourth recurring defect shape — a proof that builds
 * its own subject — and CFV1-SERVE met the same one when `createCookingApp` was
 * built and never mounted. The rule it wrote is the model for this one: read the
 * tree rather than hope the next author remembers.
 *
 * **The rule.** Every exported function in `src/pipeline/` whose return type
 * mentions `IngestResult` is CALLED from `src/http/`. A function producing an
 * `IngestResult` is by definition a way a source becomes a stored recipe, so one
 * the HTTP layer never calls is a capability with no door.
 *
 * "Mentions" rather than "is exactly `Promise<IngestResult>`", deliberately: a
 * batch import returning `Promise<IngestResult[]>` is the same kind of entry
 * point, and a rule keyed on the exact spelling would have been green on the day
 * someone wrote one. The spared half below is what keeps that width honest — a
 * function that merely CONSUMES an `IngestResult` is not an entry point, and
 * flagging it would push the next author into hiding the type.
 *
 * **What this can see, and what it cannot.** It sees that the http layer calls
 * the function. It does NOT see whether the call sits on a path a request can
 * reach: `void importFromUrl(...)` in a module-level statement would satisfy it.
 * Nor does it see the rest of the chain — that the calling app is mounted by
 * `composeInstance` is `serve/an app nobody mounts serves nothing`'s job, and
 * that the composed instance answers over a socket is
 * `run/a-link-can-be-imported-from-a-running-instance`'s. The three together are
 * the reachability argument; this file is one link and says so rather than
 * implying it is the whole.
 *
 * Detection is separated from the file walk on purpose, as in
 * `configured-database.ts`: both exported functions here are pure over TEXT, so
 * the table in the proof can plant violations into them instead of depending on
 * whatever the tree happens to contain today.
 */
import ts from "typescript"

/** One way a source becomes a stored recipe. */
export interface EntryPoint {
  /** The exported name the http layer has to call. */
  readonly name: string
  /** `where:line`, so a finding names a place rather than a fact. */
  readonly at: string
}

/** Does this type node mention `IngestResult` anywhere inside it? */
function mentionsIngestResult(node: ts.TypeNode | undefined): boolean {
  if (node === undefined) return false
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(n) && n.text === "IngestResult") {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** Is this declaration exported? */
function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
}

/**
 * Every exported ingest entry point declared in `source`.
 *
 * Both declaration forms are read — `export function f(): Promise<IngestResult>`
 * and `export const f = (): Promise<IngestResult> => …` — because which one an
 * author picks is a style choice, and CFV1-SERVE measured a guard that keyed on
 * one of them staying green while the other form was live in the very layer it
 * scanned.
 */
export function ingestEntryPointsIn(source: string, where = "in-memory.ts"): EntryPoint[] {
  const file = ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)
  const found: EntryPoint[] = []
  const at = (node: ts.Node): string =>
    `${where}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && isExported(node) && node.name !== undefined) {
      if (mentionsIngestResult(node.type)) found.push({ name: node.name.text, at: at(node) })
    }
    // `export const f = (…): Promise<IngestResult> => …`, and the `function`
    // expression spelling of the same thing.
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const init = decl.initializer
        const returns =
          init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
            ? init.type
            : undefined
        if (mentionsIngestResult(returns)) found.push({ name: decl.name.text, at: at(decl) })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  return found
}

/**
 * Every name `source` CALLS, as opposed to merely names.
 *
 * A call, not a mention: `void importFromUrl` references the entry point and
 * invokes nothing, and a guard that accepted a reference would go green on a
 * tree where the import is as unreachable as it was before. This is the mirror
 * of what CFV1-SERVE learned — there a rule named for mounting was checking
 * calling, and a bare call passed it; here the rule is named for calling and a
 * bare reference must not.
 *
 * Method calls (`obj.f()`) are included under their property name, because an
 * entry point reached through an injected collaborator is still reached.
 */
export function namesCalledIn(source: string, where = "in-memory.ts"): Set<string> {
  const file = ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)
  const called = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee)) called.add(callee.text)
      else if (ts.isPropertyAccessExpression(callee)) called.add(callee.name.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  return called
}
