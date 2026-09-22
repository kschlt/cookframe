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
 * One neighbour is deliberately NOT flagged, and it is measured rather than
 * assumed: the `{ headers: H }` response-INIT form
 * (`c.body(body, { status, headers: H })`) **cannot carry the defect**. Planted on
 * the same one-key 404 record over a real socket it answers `[404, 404, 404]`:
 * Hono builds a `Headers` object from the init's `headers` and never writes back
 * into the caller's record. So it is left alone on purpose — flagging a form that
 * cannot break would be the over-claim this repository keeps deleting.
 *
 * The round-three version of this paragraph listed a SECOND neighbour beside it,
 * the property-access source, as though the two were the same kind of thing. They
 * were not: one is impossible and the other was live, measured at
 * `[404, 500, 500]` in review. Two gaps declared side by side, one impossible and
 * one live, is the arrangement `CFV1-BRDTH` exists to end, and it had survived
 * inside the file that ends it elsewhere. Round four below closes it; this
 * paragraph now names only the case that is genuinely impossible.
 *
 * ## Round three: the chain follows later assignments too, and the tables prove it
 *
 * The version above resolved declaration initializers ONLY, and said so — which
 * is the honest form of a gap and still a gap. `let h = fresh(); h = SHARED;
 * c.body(body, 404, h)` binds a per-request record and then overwrites it with the
 * shared one, so the chain ended at `fresh()` and the call was spared. Measured on
 * the one-key 404 path over a real socket: `[404, 500, 500]` — the original defect,
 * through the one spelling the guard was not reading. {@link aliasTargets} now
 * collects every source of a name, the declaration's initializer and every later
 * `name = …`, and a name is fresh only if ALL of them are.
 *
 * That widening is the smaller half of this round. The larger half is that
 * **nothing in the tree executed the detector's breadth.** The tables below were
 * read by two tests that ran the detector as it stood; narrowing the chain back to
 * declaration initializers ran green, because every fixture that needed the wider
 * chain was the one being added. `a narrower alias chain misses what this detector
 * catches` holds the narrow version against the same table and requires it to lose
 * exactly the cases that are there for it — so the table pins the BREADTH and not
 * only the aim. The `{ headers: H }` neighbour above is the same measurement from
 * the other side: it is the case a detector widened for the wrong reason would
 * flag, and its `[404, 404, 404]` is why sparing it is a decision.
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
 * How wide a reference reads the alias chain. Production always uses
 * {@link THIS_GUARD}; the narrower two exist so a proof can hold the SAME
 * detector, one property changed, against the same fixtures.
 */
interface Reference {
  /** Follow `name = …` as a source, not only the declaration's initializer. */
  readonly followsAssignments: boolean
  /** Does an expression this cannot classify end the chain as FRESH? */
  readonly unrecognisedIsFresh: boolean
}

const THIS_GUARD: Reference = { followsAssignments: true, unrecognisedIsFresh: false }
/** Round two: declaration initializers only. */
const DECLARATIONS_ONLY: Reference = { followsAssignments: false, unrecognisedIsFresh: false }
/** Round three: a bare identifier is followed and anything else is fresh. */
const BARE_IDENTIFIERS_ONLY: Reference = { followsAssignments: true, unrecognisedIsFresh: true }

/** Strip the wrappers that change a value's type but not its identity. */
function unwrap(expression: ts.Expression): ts.Expression {
  let e: ts.Expression = expression
  for (;;) {
    if (
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    ) {
      e = e.expression
    } else if (ts.isAwaitExpression(e)) {
      // `await fresh()` is the value `fresh()` produced. Awaiting changes when,
      // not what — so a fresh construction stays fresh through it, and a shared
      // reference stays shared.
      e = e.expression
    } else {
      return e
    }
  }
}

/**
 * Does this expression CONSTRUCT a value, rather than name one built elsewhere?
 *
 * An object or array literal, a `new`, a call, and the primitive literals. A
 * spread lives inside an object literal, so `{ ...H }` is covered by the first.
 */
function constructs(e: ts.Expression): boolean {
  return (
    ts.isObjectLiteralExpression(e) ||
    ts.isArrayLiteralExpression(e) ||
    ts.isNewExpression(e) ||
    ts.isCallExpression(e) ||
    ts.isStringLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isTemplateExpression(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(e) && e.text === "undefined")
  )
}

/**
 * The expressions a form's value can actually BE, or `undefined` when the form
 * is not one of several values.
 *
 * `a ? b : c`, `a || b` and `a ?? b` can each hand back either side, so both
 * sides are candidates. **`a && b` can only hand back `b`**, because the other
 * outcome is `a` itself and `a` is then falsy — never a record. Reading its left
 * side as a candidate flagged `enabled && { a: 1 }`, a correct handler, which is
 * how the distinction was found: the negative table reported it before the
 * asymmetry occurred to me.
 */
function branchesOf(e: ts.Expression): ts.Expression[] | undefined {
  if (ts.isConditionalExpression(e)) return [e.whenTrue, e.whenFalse]
  if (!ts.isBinaryExpression(e)) return undefined
  if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return [e.right]
  if (
    e.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return [e.left, e.right]
  }
  return undefined
}

/**
 * Every expression `name` can take its value from inside `fn` — the
 * declaration's initializer, and, when the reference follows them, every later
 * `name = …` too. A name with no source at all (a parameter) has none.
 *
 * **Later assignments are followed, and that was round three's finding.**
 * `let h = fresh(); h = SHARED; c.body(body, 404, h)` binds a per-request
 * record and then overwrites it with the shared one; the version before that
 * followed declaration initializers only, so the chain ended at `fresh()` and
 * the call was spared. Over a real socket on the one-key 404 path it answers
 * `[404, 500, 500]`. A name is fresh only if EVERY source of it is, which is
 * why this returns all of them rather than the last.
 *
 * Deliberately not flow-sensitive, and deliberately not scoped to the function
 * the assignment sits in: an assignment AFTER the call cannot poison that call,
 * and a nested function that shadows the name assigns a different variable, yet
 * both are treated as sources here. Both errors point at flagging correct code
 * rather than sparing the defect, and neither form appears in `src/`.
 */
function sourcesOf(fn: ts.Node, name: string, reference: Reference): ts.Expression[] {
  const body = (fn as ts.FunctionLikeDeclaration).body
  if (body === undefined) return []
  const sources: ts.Expression[] = []

  // Declarations: this function's own scope only. A nested function's `const h`
  // is its own variable, not this one.
  const declarations = (node: ts.Node): void => {
    if (node !== body && isFunctionLike(node)) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      sources.push(node.initializer)
    }
    ts.forEachChild(node, declarations)
  }
  declarations(body)
  if (!reference.followsAssignments) return sources

  // Assignments: the whole subtree, nested functions included, because an inner
  // closure assigning `h = SHARED` poisons the outer handler's record.
  const assignments = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === name
    ) {
      sources.push(node.right)
    }
    ts.forEachChild(node, assignments)
  }
  assignments(body)
  return sources
}

/**
 * Whether `name`, used as a header record inside `fn`, is genuinely fresh for
 * each response — following the chain of sources to a fixpoint. A name is fresh
 * only if it is bound in `fn`'s own scope AND every source of it is fresh. It is
 * NOT fresh the moment the chain reaches a name not bound in `fn` (a module
 * const or `let`, an import, or a factory-scoped binding).
 *
 * The visited set is scoped to the PATH rather than to the whole walk, so a
 * chain that closes on itself still fails closed while a name reached twice by
 * two different sources (`let h = a; h = a`) is decided on its merits. A single
 * shared set would have called that second one a cycle and flagged correct code.
 *
 * ## The default is "shared", and inverting it is round four
 *
 * The three rounds before this one asked which SPELLINGS of sharing to follow:
 * a module const, then an import and a `let`, then an alias and a later
 * assignment. Each time the rule stayed "a bare identifier is followed, and
 * anything else ends the chain as fresh" — a deny list with one entry on it, so
 * every round found another spelling that walked past.
 *
 * `const h = HEADERS.page` was that spelling. Measured over a real socket rather
 * than argued: a nested record reached by property access and handed to
 * `c.body(body, 404, h)` answers **`[404, 500, 500]`**, and the record afterwards
 * reads `{"content-type":"text/plain","Content-Length":9}` — the same live defect
 * as the assignment alias, one spelling further out. The round-three file
 * declared it an open gap and called it "not measured", which review measured and
 * this corrects.
 *
 * So the question is inverted. **Fresh is what a reference can SHOW constructs a
 * value** ({@link constructs}): a literal, a `new`, a call. An identifier is
 * followed. A conditional or `||`/`??`/`&&` is fresh only if all of its branches
 * are. `await`, `as`, `satisfies`, `!` and parentheses are unwrapped, because
 * none of them changes which object you get. **Everything else fails closed**,
 * property and element access among them, so the next spelling nobody thought of
 * is shared by default instead of fresh by default.
 *
 * That trades a missed defect for a possible false alarm, and a guard that
 * reports correct code is one somebody switches off — so the sparing half is
 * where the fixtures went. The question each negative entry has to answer is the
 * one planting taught in `CFV1-BRDTH`: which entry dies if this condition is
 * dropped? An entry that answers "none" is measuring nothing.
 */
function isFreshName(
  fn: ts.Node,
  local: ReadonlySet<string>,
  name: string,
  path: ReadonlySet<string>,
  reference: Reference,
): boolean {
  if (path.has(name)) return false
  if (!local.has(name)) return false
  const deeper = new Set(path).add(name)
  return sourcesOf(fn, name, reference).every((source) =>
    isFreshValue(fn, local, source, deeper, reference),
  )
}

function isFreshValue(
  fn: ts.Node,
  local: ReadonlySet<string>,
  expression: ts.Expression,
  path: ReadonlySet<string>,
  reference: Reference,
): boolean {
  const e = unwrap(expression)
  if (constructs(e)) return true
  const branches = branchesOf(e)
  if (branches !== undefined && !reference.unrecognisedIsFresh) {
    return branches.every((b) => isFreshValue(fn, local, b, path, reference))
  }
  if (ts.isIdentifier(e)) return isFreshName(fn, local, e.text, path, reference)
  return reference.unrecognisedIsFresh
}

function bindsFreshly(fn: ts.Node, name: string, reference: Reference): boolean {
  return isFreshName(fn, localBindings(fn), name, new Set(), reference)
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
function sharedHeaderFindings(
  source: string,
  fileName = "in-memory.ts",
  reference: Reference = THIS_GUARD,
): Finding[] {
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
        const fresh = fn !== undefined && bindsFreshly(fn, headers.text, reference)
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

/**
 * Records the detector MUST flag. Hoisted out of the test that reads them so the
 * narrowing proof below can run the SAME table through a deliberately narrower
 * detector — a table only one detector ever sees pins that detector's aim and
 * nothing about its breadth.
 */
const MUST_FLAG = [
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
  // ASSIGNMENT ALIAS: fresh at the declaration, overwritten with the shared record
  // afterwards — round three's finding, [404, 500, 500] over a real socket
  'const SHARED_404 = { "content-type": "text/plain" }\napp.get("/", (c) => {\n  let h = notFoundHeaders()\n  h = SHARED_404\n  return c.body(NOT_FOUND_BODY, 404, h)\n})',
  // the same, one local further out: the assigned name is itself an alias
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const a = SHARED\n  let h = { b: 2 }\n  h = a\n  return c.body(x, 200, h)\n})',
  // assigned from inside a nested closure — a different scope, the same variable,
  // which is why the assignment walk does not stop at a function boundary
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  let h = { b: 2 }\n  register(() => {\n    h = SHARED\n  })\n  return c.body(x, 200, h)\n})',
  // A CHAIN THAT CLOSES ON ITSELF. The code is degenerate — `h` is never a record
  // at all — and it is here because the guard's stance on a chain it cannot
  // resolve is to refuse rather than to assume, and a stance that lives only in a
  // comment is one a later reader flips without noticing. Measured: turning the
  // cycle branch into `return true` passes every other fixture in this file.
  'app.get("/", (c) => {\n  let h = k\n  let k = h\n  return c.body(x, 200, h)\n})',
  // PROPERTY ACCESS: round four's finding, and the reason the default flipped.
  // A property access never constructs — it hands back something built
  // elsewhere. Measured over a real socket at [404, 500, 500], the record left
  // carrying Content-Length: 9.
  'const HEADERS = { page: { "content-type": "text/plain" } }\napp.get("/", (c) => {\n  const h = HEADERS.page\n  return c.body(NOT_FOUND_BODY, 404, h)\n})',
  // the same reference, spelled with brackets
  'const HEADERS = { page: { a: 1 } }\napp.get("/", (c) => {\n  const h = HEADERS["page"]\n  return c.body(x, 200, h)\n})',
  // reached through `this`, which a method-style handler has
  'app.get("/", function (c) {\n  const h = this.headers\n  return c.body(x, 200, h)\n})',
  // ASSIGNED a property access, so the inversion holds on both kinds of source
  // and not only on declarations
  'const HEADERS = { page: { a: 1 } }\napp.get("/", (c) => {\n  let h = { b: 2 }\n  h = HEADERS.page\n  return c.body(x, 200, h)\n})',
  // ONE BRANCH shared: a conditional is only as fresh as its worst branch, and
  // the old rule read the whole conditional as "not an identifier" and stopped
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const h = c.req.query("x") ? { b: 2 } : SHARED\n  return c.body(x, 200, h)\n})',
  // the same through a fallback operator
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const h = maybe() ?? SHARED\n  return c.body(x, 200, h)\n})',
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const h = maybe() || SHARED\n  return c.body(x, 200, h)\n})',
  // `&&` hands back its RIGHT side, so that is the side that has to be read
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  const h = enabled && SHARED\n  return c.body(x, 200, h)\n})',
  // unwrapping must not launder a shared reference: `as` and `await` change the
  // type or the timing, never which object comes back
  'const HEADERS = { page: { a: 1 } }\napp.get("/", (c) => {\n  const h = HEADERS.page as Record<string, string>\n  return c.body(x, 200, h)\n})',
  'const SHARED = { a: 1 }\napp.get("/", async (c) => {\n  const h = await SHARED\n  return c.body(x, 200, h)\n})',
]

/**
 * Records the detector MUST spare. Each sits one property away from an entry
 * above: a negative fixture spared for an unrelated reason reads as precision
 * and measures nothing.
 */
const MUST_NOT_FLAG = [
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
  // a Headers object from it and never writes back (measured [404, 404, 404]).
  // The load-bearing negative: a detector widened by pattern rather than by
  // mechanism flags this, and flagging a form that cannot break is the over-claim
  // this repository keeps deleting.
  'const SHARED = { "content-type": "text/plain" }\napp.get("/", (c) => c.body(x, { status: 404, headers: SHARED }))',
  // ASSIGNED, but to a freshly constructed record: following assignments must not
  // mean assuming the worst of every one of them
  'const SHARED = { a: 1 }\napp.get("/", (c) => {\n  let h = { b: 2 }\n  h = { ...SHARED }\n  return c.body(x, 200, h)\n})',
  // the same per-request local reached by TWO sources is a diamond, not a cycle;
  // the path-scoped visited set is what keeps correct code spared here
  'app.get("/", (c) => {\n  const a = { "content-type": "text/plain" }\n  let h = a\n  h = a\n  return c.body(x, 200, h)\n})',
  // A CALL constructs. This is the shipped shape (`pageHeaders()`,
  // `notFoundHeaders()`) one binding out, and it is the entry that dies if
  // `ts.isCallExpression` leaves the construction list — which is why the
  // inverted rule needs a list rather than a bare "identifiers only".
  'app.get("/", (c) => {\n  const h = pageHeaders()\n  return c.body(x, 200, h)\n})',
  // A call through a PROPERTY: `c.req.header()` and `headers.build()` are calls
  // whose callee happens to be a property access. Reading the callee instead of
  // the expression would flag every one of them.
  'app.get("/", (c) => {\n  const h = headers.build()\n  return c.body(x, 200, h)\n})',
  // `new Headers()` constructs as plainly as a literal does
  'app.get("/", (c) => {\n  const h = new Headers()\n  return c.body(x, 200, h)\n})',
  // BOTH branches construct, so the conditional does: a guard that failed closed
  // on every conditional would report this correct handler
  'app.get("/", (c) => {\n  const h = c.req.query("x") ? { a: 1 } : { b: 2 }\n  return c.body(x, 200, h)\n})',
  // awaiting a factory is still the factory's fresh object
  'app.get("/", async (c) => {\n  const h = await buildHeaders()\n  return c.body(x, 200, h)\n})',
  // a handler PARAMETER is re-established every call, so a record named by one
  // is fresh — the entry that dies if a name with no source stops being fresh
  "function serve(c, h) {\n  return c.body(x, 200, h)\n}",
  // an explicit `undefined` in the headers slot is not a record at all
  'app.get("/", (c) => {\n  const h = undefined\n  return c.body(x, 200, h)\n})',
  // THE UNWRAPPERS, from the sparing side. With the default inverted, failing to
  // unwrap a cast no longer spares a shared record — it FLAGS a fresh one, so
  // these four are where `as`, `satisfies`, `!` and parentheses are executed.
  // Found by planting: removing the `as` branch survived the table until this
  // entry existed, because the positive fixture that used a cast failed closed
  // either way.
  'app.get("/", (c) => {\n  const h = { a: 1 } as Record<string, string>\n  return c.body(x, 200, h)\n})',
  'app.get("/", (c) => {\n  const h = { a: 1 } satisfies Record<string, string>\n  return c.body(x, 200, h)\n})',
  'app.get("/", (c) => {\n  const h = pageHeaders()!\n  return c.body(x, 200, h)\n})',
  'app.get("/", (c) => {\n  const h = ({ a: 1 })\n  return c.body(x, 200, h)\n})',
  // A FALLBACK whose sides both construct. The mirror of the flagged `?? SHARED`
  // entry, and the one that dies if `||`/`??` stop being read as branches: with
  // them, this is fresh; without them, a correct handler is reported.
  'app.get("/", (c) => {\n  const h = pageHeaders() ?? { a: 1 }\n  return c.body(x, 200, h)\n})',
  // The other two fallback operators, and they are here for a reason planting
  // made plain: with the default inverted, DROPPING a recognition rule always
  // errs toward flagging, so a positive fixture cannot tell whether `||` is
  // read as a branch — it fails closed either way. Only a correct handler that
  // must be spared can. Removing `||` from the branch list survived the whole
  // table until this entry existed.
  'app.get("/", (c) => {\n  const h = pageHeaders() || { a: 1 }\n  return c.body(x, 200, h)\n})',
  'app.get("/", (c) => {\n  const h = enabled && { a: 1 }\n  return c.body(x, 200, h)\n})',
]

describe("http/shared-header-detector-is-precise", () => {
  it("flags every record that is not fresh per response", () => {
    for (const s of MUST_FLAG) {
      expect(sharedHeaderFindings(s).length, s).toBeGreaterThan(0)
    }
  })

  it("spares a record that is fresh per response", () => {
    for (const s of MUST_NOT_FLAG) {
      expect(sharedHeaderFindings(s), s).toEqual([])
    }
  })

  /** What a narrower reference loses on the same table — the breadth, executed. */
  const missedBy = (reference: Reference): string[] =>
    MUST_FLAG.filter((s) => sharedHeaderFindings(s, "in-memory.ts", reference).length === 0)

  it("a chain that reads declaration initializers only misses what this catches", () => {
    // Round two's chain. It is the same detector with one property changed, so
    // what separates the two is the widening itself and nothing else.
    expect(
      missedBy(DECLARATIONS_ONLY),
      "the narrow chain passes the whole table, so the table pins no breadth",
    ).toHaveLength(4)
  })

  it("a chain that calls everything but a bare identifier fresh misses far more", () => {
    // Round three's chain, and the rule this file inverted: follow an identifier,
    // treat anything else as a construction. Seven of the eight entries round
    // four added are lost here, which is what makes "fresh is what we can show
    // constructs" a measured change rather than a restatement.
    //
    // SEVEN rather than eight, and the exception is worth naming instead of
    // rounding away: `const h = await SHARED` is caught by this reference too,
    // because unwrapping `await` is not part of the axis being narrowed here —
    // it is a separate widening with its own mutation. An entry that survives a
    // narrowing is not a weak entry; it is an entry about a different property.
    expect(
      missedBy(BARE_IDENTIFIERS_ONLY),
      "the old default passes the whole table, so nothing pins the inversion",
    ).toHaveLength(9)
  })

  it("the sparing table is not quietly gutted to make a later change pass", () => {
    // An ANTI-SHRINK guard, and nothing more than that — review corrected the
    // comment that stood here. What executes the sparing half is the test
    // above, which runs every MUST_NOT_FLAG entry through the real detector;
    // this line only stops that table from being emptied later, which is how a
    // fail-closed default quietly becomes unshippable without anything going
    // red.
    expect(MUST_NOT_FLAG.length).toBeGreaterThan(MUST_FLAG.length / 2)
  })
})
