/**
 * Where a running instance keeps the photographs it is sent, read from the tree.
 *
 * `PDR-0001`'s tenth invariant keeps scan deletion disabled until the
 * capture-quality gate passes, and ADR-0009 built the store that keeps them.
 * Then nothing on the running path constructed it: `STORAGE_ROOT` was read
 * nowhere under `src/`, `createFilesystemByteStore` had no caller outside the
 * test tree, and every photograph was read by the model and dropped with the
 * request. The store was built, guarded and proved, and the instance broke the
 * invariant anyway — the third finding of that shape, after the URL import and
 * its capture path.
 *
 * **What this sees.** Three facts, one per file on the path:
 *
 *  1. the photo route (`POST /capture` in `src/http/ingest-app.ts`) calls
 *     `deps.scanStore.put(body)`, and calls it BEFORE `ingest(` — the order is
 *     the decision, and the route says why;
 *  2. the instance hands the ingest app its own `scanStore` (`src/server/instance.ts`);
 *  3. the composition root hands `startInstance` a `scanStore` bound to
 *     `createFilesystemByteStore(...)` (`src/server/main.ts`).
 *
 * **What it does not see.** Whether the bytes are really kept — the store's own
 * suite (`slice1/byte-store`) and `run/a-photograph-is-kept-on-the-volume` own
 * that — and what directory the store is built on, which
 * `slice1/storage-identity-confinement` pins to `config.storageRoot` and
 * `run/the-process-serves-and-stops` checks the process actually wrote.
 *
 * Pure over TEXT, like `url-capture-wiring.ts`, so the proof can plant each
 * violation rather than depend on what the tree holds today.
 */
import ts from "typescript"

const parse = (source: string, where: string): ts.SourceFile =>
  ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)

const calleeName = (node: ts.CallExpression): string | undefined => {
  const { expression } = node
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** The handler function of `app.post("<path>", ..., handler)`, or `undefined`. */
function routeHandler(file: ts.SourceFile, path: string): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (node: ts.Node): void => {
    if (
      found === undefined &&
      ts.isCallExpression(node) &&
      calleeName(node) === "post" &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === path
    ) {
      found = node.arguments[node.arguments.length - 1]
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** What the photo route does with the photograph, in source order. */
export interface PhotoRouteReading {
  /** False when no `app.post(path, …)` was found at all. */
  readonly routeFound: boolean
  /** The receiver and argument text of every `.put(…)` in the handler, e.g. `deps.scanStore(body)`. */
  readonly puts: readonly {
    readonly receiver: string
    readonly argument: string
    readonly at: number
  }[]
  /** Source offsets of every `ingest(…)` call in the handler. */
  readonly ingests: readonly number[]
}

/**
 * Read the handler of `app.post(path, …)` in `source`.
 *
 * Scoped to the one route rather than the file, because the file holds two:
 * the URL route fetches a page, not a photograph, and a `put` there would say
 * nothing about whether a photograph is kept.
 */
export function readPhotoRoute(
  source: string,
  path = "/capture",
  where = "in-memory.ts",
): PhotoRouteReading {
  const file = parse(source, where)
  const handler = routeHandler(file, path)
  if (handler === undefined) return { routeFound: false, puts: [], ingests: [] }
  const puts: { receiver: string; argument: string; at: number }[] = []
  const ingests: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (name === "put" && ts.isPropertyAccessExpression(node.expression)) {
        puts.push({
          receiver: node.expression.expression.getText(file),
          argument: node.arguments.map((a) => a.getText(file)).join(", "),
          at: node.getStart(file),
        })
      }
      if (name === "ingest" && ts.isIdentifier(node.expression)) ingests.push(node.getStart(file))
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return { routeFound: true, puts, ingests }
}

/**
 * The expression given to `field` in the object literal passed as the first
 * argument of every call to `callee`, with a shorthand property (`{ scanStore }`)
 * reported as the identifier it names.
 */
export function fieldPassedTo(
  source: string,
  callee: string,
  field: string,
  where = "in-memory.ts",
): string[] {
  const file = parse(source, where)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node) === callee) {
      const first = node.arguments[0]
      if (first !== undefined && ts.isObjectLiteralExpression(first)) {
        for (const property of first.properties) {
          if (ts.isShorthandPropertyAssignment(property) && property.name.text === field) {
            out.push(property.name.text)
          }
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
            property.name.text === field
          ) {
            out.push(property.initializer.getText(file).replace(/\s+/g, " ").trim())
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/**
 * The callee of the call that initializes the `const`/`let` named `name`, or
 * `undefined` when there is no such declaration or it is not initialized by a
 * call. Reads a binding, so a composition root that builds the store once and
 * probes it before passing it on reads the same as one that builds it inline.
 */
export function initializerCallee(
  source: string,
  name: string,
  where = "in-memory.ts",
): string | undefined {
  const file = parse(source, where)
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (
      found === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      const init = node.initializer
      const call = ts.isAwaitExpression(init) ? init.expression : init
      if (ts.isCallExpression(call)) found = calleeName(call)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
