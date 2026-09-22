/**
 * CFV1-HDR — a response builder is never handed a header record that outlives one
 * response.
 *
 * The measured defect, twice now (CFV1-RUN on the 404 path, CFV1-S4 on a cooking
 * page's success path), both found by a human by hand: `@hono/node-server` writes
 * the content length back into the very record a handler passed to `c.body(...)`:
 *
 * ```js
 * header["Content-Length"] = Buffer.byteLength(body)   // dist/index.mjs
 * ```
 *
 * `header` there is the caller's own object. A record shared across responses is
 * therefore mutated by the first one that uses it, gains a `Content-Length` key
 * whose value is a NUMBER, and Hono's next response over the same record takes the
 * non-string branch (`for (const v2 of v)`) and throws `TypeError: v is not
 * iterable` — so the SECOND response the process serves over that record is a 500,
 * and every one after it. Measured directly against the real adapter: a one-key
 * shared record served over a socket answers `[200, 500, 500]`.
 *
 * `not-found.ts`, `pages-app.ts` and `cooking-app.ts` already hand `c.body` a
 * FRESH object each time (`notFoundHeaders()`, `pageHeaders()`, `htmlHeaders()`).
 * But nothing forbade the shared form, and that is exactly why it came back a
 * second time. This is that guard, and it is the STRUCTURAL half of the unit: the
 * runtime symptom is invisible on a multi-key record (Hono builds a `Headers`
 * object once there is more than one key, and never writes back into the caller's
 * record — measured: `[200, 200, 200]`), so a behavioural proof cannot catch a
 * `pageHeaders`-shaped regression at all. Only reading the source can. The
 * behavioural half — the mechanism served twice over a real socket — is
 * `tests/run/served-headers-survive-repetition.test.ts`.
 *
 * ## What "shared" means here, and why the first cut was too narrow
 *
 * The first version of this guard flagged only a *module-level object-literal
 * `const`* handed straight to a response builder. Review found three ways past it,
 * all of them the same bug wearing a different spelling:
 *
 *  - a record declared inside the app *factory* (`createPagesApp`) and closed over
 *    by an inner handler — constructed once when the factory runs, not per request,
 *    so shared across every request the handler serves;
 *  - an *imported* record (the worst case: an exported `NOT_FOUND_HEADERS` one
 *    misuse away from poisoning the process from another module);
 *  - a `let` binding, which the const-only scan never looked at.
 *
 * So the guard no longer enumerates the shared spellings. It asks the one question
 * that actually distinguishes safe from unsafe: **is the header record fresh for
 * this one response?** A record is fresh only if it is constructed inside the
 * handler each time the handler runs — i.e. bound within the nearest enclosing
 * function of the `c.body(...)` call itself (a per-request local, or that
 * function's own parameter). Anything else handed to the headers slot as a bare
 * identifier — a module const or `let`, an import, or a factory-scoped binding one
 * function out — is shared, and is flagged. A factory call (`pageHeaders()`), an
 * inline literal, and a spread into a new literal (`{ ...H }`) each construct a
 * fresh object and are not bare identifiers, so none is flagged.
 *
 * ## Aliasing follows the chain to a fixpoint
 *
 * A local binding is not fresh merely because it is local. Review's second round
 * found the hole: `const h = SHARED_404; c.body(body, status, h)` binds `h` in the
 * handler, so a naive "is it local?" calls it fresh — yet `h` is the shared record
 * under another name, and planted on the one-key 404 path over a real socket it
 * answers `[404, 500, 500]`, the original defect exactly. The suite is named
 * `are-fresh-per-response`, and an aliased record is not fresh, so this cannot be
 * out of scope. So {@link bindsFreshly} follows the alias chain: where a local
 * binding's initializer is itself a bare identifier, it resolves through it and
 * decides freshness at the END of the chain — fresh only if the chain terminates
 * at a per-request construction (a non-identifier initializer, or a parameter),
 * shared if it ever reaches a name not bound in the handler. `const a = { ... };
 * const h = a` stays spared (the chain ends at a per-request literal); `const h =
 * SHARED` is flagged.
 *
 * Two neighbours are deliberately NOT flagged, and this is measured, not assumed:
 *  - The `{ headers: H }` response-INIT form (`c.body(body, { status, headers: H })`)
 *    cannot carry the defect. Planted on the same one-key 404 record over a real
 *    socket it answers `[404, 404, 404]`: Hono builds a `Headers` object from the
 *    init's `headers` and never writes back into the caller's record. So it is left
 *    alone on purpose — flagging a form that cannot break would be the over-claim
 *    this repository keeps deleting.
 *  - Aliasing established by a later ASSIGNMENT rather than the declaration's
 *    initializer (`let h = fresh(); h = SHARED`) is not followed. No code here uses
 *    it and its behaviour was not measured; the chain resolves declaration
 *    initializers only, matching what round two proved.
 *
 * It scans all of `src/`, so it is the guard the coordinator meant when it said a
 * cooking page reintroducing the constant would trip here: this file has no
 * knowledge of which apps exist, only of the shape that breaks. It reads the AST
 * rather than grepping (`ts.createSourceFile`) so the word "headers" in a comment,
 * a string or an unrelated name cannot flag it, and a shared record cannot hide
 * behind whitespace or a line break.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")

/**
 * The `Context` methods that build a Response from a body and a caller-supplied
 * headers record — the ones the adapter can poison. Matched by method name on any
 * receiver (handlers conventionally name the context `c`, but a rename must not
 * open the hole), which is precise in practice because the flag only fires when the
 * headers argument is *also* a bare identifier not bound per-response, a
 * combination unique to this bug.
 */
const RESPONSE_BUILDERS = new Set(["body", "json", "text", "html", "newResponse"])

/** A place a non-fresh header record was handed to a response builder. */
interface Finding {
  readonly name: string
  readonly line: number
}

/** .ts/.mts/.cts/.tsx under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(?:ts|mts|cts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** A node that opens its own variable scope. */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  )
}

/**
 * The nearest function that encloses `node` — for a `c.body(...)` call, the
 * handler it lives in. `undefined` when the call is at module scope (which is never
 * per-request-fresh, so its headers identifier is treated as shared).
 */
function nearestFunction(node: ts.Node): ts.Node | undefined {
  let cur = node.parent
  while (cur !== undefined) {
    if (isFunctionLike(cur)) return cur
    cur = cur.parent
  }
  return undefined
}

/** Every identifier a binding name introduces, unwrapping object/array patterns. */
function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text)
    return
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) bindingNames(el.name, out)
  }
}

/**
 * The names bound in one function's OWN scope: its parameters, and the variables
 * and function declarations in its body — but NOT those inside a nested function,
 * which is a different scope. A name in this set is re-established every time the
 * function runs, so a header record it names is fresh per response.
 */
function localBindings(fn: ts.Node): Set<string> {
  const names = new Set<string>()
  const decl = fn as ts.FunctionLikeDeclaration
  for (const p of decl.parameters) bindingNames(p.name, names)

  const body = decl.body
  if (body === undefined) return names
  const walk = (node: ts.Node): void => {
    // Stop at a nested function: its declarations belong to its own scope, not
    // this one, and a record built there is fresh for ITS calls, not ours.
    if (node !== body && isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, names)
    else if (ts.isFunctionDeclaration(node) && node.name !== undefined) names.add(node.name.text)
    ts.forEachChild(node, walk)
  }
  walk(body)
  return names
}

/**
 * If `name` is bound in `fn`'s own scope by a `const`/`let`/`var` whose initializer
 * is itself a bare identifier (`const h = SHARED`), the name that initializer
 * refers to; otherwise `undefined`. Only the declaration's initializer is followed
 * — a parameter, an object literal, a factory call, a spread, or a later
 * assignment all return `undefined`, ending the chain at a per-request value.
 */
function aliasTarget(fn: ts.Node, name: string): string | undefined {
  const body = (fn as ts.FunctionLikeDeclaration).body
  if (body === undefined) return undefined
  let target: string | undefined
  const walk = (node: ts.Node): void => {
    if (node !== body && isFunctionLike(node)) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      let init: ts.Expression = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      target = ts.isIdentifier(init) ? init.text : undefined
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return target
}

/**
 * Whether `name`, used as a header record inside `fn`, is genuinely fresh for each
 * response — following the alias chain to a fixpoint. A name is fresh only if it is
 * bound in `fn`'s own scope AND the chain of `const x = y` aliases starting from it
 * terminates at a per-request construction (a non-identifier initializer or a
 * parameter). It is NOT fresh — and so the record is shared — the moment the chain
 * reaches a name not bound in `fn` (a module const/`let`, an import, or a
 * factory-scoped binding). A cycle fails closed (not fresh).
 */
function bindsFreshly(fn: ts.Node, name: string): boolean {
  const local = localBindings(fn)
  const seen = new Set<string>()
  let current = name
  while (!seen.has(current)) {
    seen.add(current)
    if (!local.has(current)) return false
    const next = aliasTarget(fn, current)
    if (next === undefined) return true
    current = next
  }
  return false
}

/**
 * Every response builder in `source` handed a header record that is not fresh for
 * the one response — a bare identifier in the headers slot (arg 2) that is NOT
 * fresh in the handler the call sits in (see {@link bindsFreshly}: bound locally
 * and not an alias of anything shared). The single detector both the enforcement
 * scan and its own precision proof run, so the two cannot drift.
 *
 * The body (arg 0) and status (arg 1) are not the headers slot: a shared object
 * handed as a JSON BODY is serialized, never mutated, and must not be flagged (see
 * `src/http/ingest-app.ts`, which shares `TOO_LARGE_BODY` as a body). Only the
 * third argument is the record the adapter writes `Content-Length` back into.
 */
function sharedHeaderFindings(source: string, fileName = "in-memory.ts"): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const out: Finding[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RESPONSE_BUILDERS.has(node.expression.name.text)
    ) {
      const headers = node.arguments[2]
      if (headers !== undefined && ts.isIdentifier(headers)) {
        const fn = nearestFunction(headers)
        const fresh = fn !== undefined && bindsFreshly(fn, headers.text)
        if (!fresh) {
          const { line } = sf.getLineAndCharacterOfPosition(headers.getStart(sf))
          out.push({ name: headers.text, line: line + 1 })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe("http/response-headers-are-fresh-per-response", () => {
  const scanned = sourceFiles(srcDir)

  // The scan's aim, pinned. A guard that scans nothing passes vacuously; this
  // fails loudly if `srcDir` is ever repointed at an empty or wrong tree, so the
  // green below always means "these files were read", not "no files were".
  it("scans the real src/ tree, including a known response-building module", () => {
    expect(scanned.length).toBeGreaterThan(0)
    expect(scanned.map((f) => relative(repoRoot, f))).toContain(join("src", "http", "pages-app.ts"))
  })

  it("hands no response builder in src/ a header record shared across responses", () => {
    for (const file of scanned) {
      const found = sharedHeaderFindings(readFileSync(file, "utf8"), file)
      expect(
        found.map((f) => `${f.name}@${f.line}`),
        `${relative(repoRoot, file)} hands a response builder a header record that is not built inside the handler. ` +
          "The node adapter writes Content-Length back into that record, so the SECOND response over it is a 500 " +
          "(TypeError: v is not iterable). Give c.body(...) a FRESH object each response — a factory like " +
          "pageHeaders()/notFoundHeaders(), an inline literal, or a const declared inside the handler. See src/http/not-found.ts.",
      ).toEqual([])
    }
  })
})

describe("http/shared-header-detector-is-precise", () => {
  it("flags every record that is not fresh per response", () => {
    const mustFlag = [
      // the exact regression: the module const `pages-app.ts` replaced with a factory
      'const PAGE_HEADERS = { "content-type": "text/html", "cache-control": "no-store" } as const\napp.get("/", (c) => c.body(page, 200, PAGE_HEADERS))',
      // one key — the shape that actually 500s at runtime
      'const H = { "content-type": "text/plain" }\napp.get("/", (c) => c.body(NOT_FOUND_BODY, 404, H))',
      // other response builders poison the same way
      'const H = { a: 1 }\napp.get("/", (c) => c.json(data, 200, H))',
      // a renamed context still builds a poisonable response
      'const H = { "content-type": "text/plain" }\napp.get("/", (ctx) => ctx.newResponse(body, 200, H))',
      // FACTORY-LOCAL: declared in the factory, closed over by an inner handler —
      // built once when the factory runs, shared across every request
      'function createApp() {\n  const H = { "content-type": "text/plain" }\n  app.get("/", (c) => c.body(x, 200, H))\n}',
      // IMPORTED (or otherwise never bound locally): one misuse poisons process-wide
      'app.get("/", (c) => c.body(x, 200, IMPORTED_HEADERS))',
      // a `let` binding the const-only scan never looked at
      'let H = { a: 1 }\napp.get("/", (c) => c.body(x, 200, H))',
      // a record built in an OUTER handler is not fresh for an inner handler's call
      'app.get("/", (outer) => {\n  const H = { a: 1 }\n  app.get("/x", (inner) => inner.body(x, 200, H))\n})',
      // ALIAS: a shared module const aliased to a per-request local is not fresh —
      // round two's blocking finding, the original defect on the 404 path
      'const SHARED_404 = { "content-type": "text/plain" }\napp.get("/", (c) => {\n  const h = SHARED_404\n  return c.body(NOT_FOUND_BODY, 404, h)\n})',
      // ALIAS CHAIN: follow x -> a -> SHARED to the end; still shared
      'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const a = SHARED\n  const h = a\n  return c.body(x, 200, h)\n})',
    ]
    for (const s of mustFlag) {
      expect(sharedHeaderFindings(s).length, s).toBeGreaterThan(0)
    }
  })

  it("spares a record that is fresh per response", () => {
    const mustNotFlag = [
      // the shipped fix: a nullary factory returns a fresh object each call
      'const H = { a: 1 }\nconst fresh = () => ({ ...H })\napp.get("/", (c) => c.body(x, 404, fresh()))',
      // an inline literal is fresh by construction
      'app.get("/", (c) => c.body(x, 200, { "content-type": "text/html; charset=utf-8" }))',
      // a spread INTO a new literal is a new object, not the shared reference
      'const H = { a: 1 }\napp.get("/", (c) => c.body(x, 200, { ...H }))',
      // a PER-REQUEST LOCAL declared inside the handler is rebuilt every response
      'app.get("/", (c) => {\n  const h = { "content-type": "text/plain" }\n  return c.body(x, 200, h)\n})',
      // a string-valued and a number-valued constant are immutable — the adapter
      // cannot write a key into them, so a body constant and a status constant are
      // not the defect and must not be flagged (they are args 0 and 1, not 2)
      'const BODY = "Not Found"\nconst STATUS = 404\napp.get("/", (c) => c.body(BODY, STATUS, notFoundHeaders()))',
      // a shared object handed as the JSON BODY (arg 0) is serialized, not mutated
      // — the ingest app does exactly this and it is correct
      'const TOO_LARGE_BODY = { error: "too_large" } as const\napp.get("/", (c) => c.json(TOO_LARGE_BODY, 413))',
      // the object constant exists but is never handed to a response builder
      "const H = { a: 1 }\nconst other = H\nreturn other",
      // an ALIAS of a per-request local is still fresh: the chain ends at a literal
      // built inside the handler, so aliasing it changes nothing
      'app.get("/", (c) => {\n  const a = { "content-type": "text/plain" }\n  const h = a\n  return c.body(x, 200, h)\n})',
      // the { headers: H } response-INIT form cannot carry the defect — Hono builds
      // a Headers object from it and never writes back (measured [404, 404, 404])
      'const SHARED = { "content-type": "text/plain" }\napp.get("/", (c) => c.body(x, { status: 404, headers: SHARED }))',
    ]
    for (const s of mustNotFlag) {
      expect(sharedHeaderFindings(s), s).toEqual([])
    }
  })
})
