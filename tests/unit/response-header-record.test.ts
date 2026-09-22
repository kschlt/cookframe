/**
 * CFV1-HDR — a response builder is never handed a SHARED header record.
 *
 * The measured defect, twice now (CFV1-RUN on the 404 path, CFV1-S4 on a cooking
 * page's success path), both found by a human by hand: `@hono/node-server` writes
 * the content length back into the very record a handler passed to `c.body(...)`:
 *
 * ```js
 * header["Content-Length"] = Buffer.byteLength(body)   // dist/index.mjs
 * ```
 *
 * `header` there is the caller's own object. A module-level constant handed to
 * `c.body` is therefore mutated by the first response that uses it, gains a
 * `Content-Length` key whose value is a NUMBER, and Hono's next response over the
 * same record takes the non-string branch (`for (const v2 of v)`) and throws
 * `TypeError: v is not iterable` — so the SECOND response the process serves over
 * that record is a 500, and every one after it. Measured directly against the
 * real adapter: a one-key shared constant served over a socket answers
 * `[200, 500, 500]`.
 *
 * `not-found.ts` and `pages-app.ts` already hand `c.body` a FRESH object each time
 * (`notFoundHeaders()`, `pageHeaders()`). But nothing forbade the shared form, and
 * that is exactly why it came back a second time. This is that guard, and it is
 * the STRUCTURAL half of the unit: the runtime symptom is invisible on a
 * multi-key record (Hono builds a `Headers` object once there is more than one
 * key, and never writes back into the caller's record — measured:
 * `[200, 200, 200]`), so a behavioural proof cannot catch a `pageHeaders`-shaped
 * regression at all. Only reading the source can. The behavioural half — the
 * mechanism served twice over a real socket — is `tests/run/served-headers-survive-repetition.test.ts`.
 *
 * It scans all of `src/`, so it is the guard the coordinator meant when it said a
 * cooking page reintroducing the constant would trip here: this file has no
 * knowledge of which apps exist, only of the shape that breaks.
 *
 * It reads the AST rather than grepping (`ts.createSourceFile`) so the word
 * "headers" in a comment, a string or an unrelated name cannot flag it, and a
 * shared record cannot hide behind whitespace or a line break.
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
 * open the hole), which is precise in practice because the flag only fires when an
 * argument is *also* a shared object constant, a combination unique to this bug.
 */
const RESPONSE_BUILDERS = new Set(["body", "json", "text", "html", "newResponse"])

/** A place a shared header record was handed to a response builder. */
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

/**
 * The module-level `const` names in one file whose initializer is an object
 * literal — unwrapping `as const` and parentheses. These are the shared, mutable
 * records; handing one to a response builder is the defect. A `const` bound to a
 * factory (an arrow or function) is not one of these, which is why the fix
 * (`const pageHeaders = () => ({ ... })`) is spared and the constant it replaced
 * (`const PAGE_HEADERS = { ... } as const`) is not.
 */
function sharedObjectConstNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue
      let init: ts.Expression = decl.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) names.add(decl.name.text)
    }
  }
  return names
}

/**
 * Every response builder in `source` handed a shared object constant DIRECTLY as
 * an argument (`c.body(body, status, HEADERS)`) — the measured defect. The single
 * detector both the enforcement scan and its own precision proof run, so the two
 * cannot drift.
 *
 * It flags only a bare identifier that names a shared object constant. A spread
 * into a new literal (`{ ...HEADERS }`), an inline literal, and a factory call
 * (`pageHeaders()`) all construct a fresh object and are the correct forms, so
 * none is flagged. It deliberately does not reason about `{ headers: HEADERS }`
 * response-init records: no code here uses that form and its poisoning behaviour
 * was not measured, and a guard that flags what it has not measured is the
 * over-claim this repository keeps deleting.
 */
function sharedHeaderFindings(source: string, fileName = "in-memory.ts"): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const shared = sharedObjectConstNames(sf)
  const out: Finding[] = []
  if (shared.size === 0) return out

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RESPONSE_BUILDERS.has(node.expression.name.text)
    ) {
      // The headers record is the THIRD argument of Hono's `(data, status,
      // headers)` signature — the only slot the adapter writes back into. The
      // body (arg 0) and status (arg 1) are not it: a shared object handed as a
      // JSON BODY is serialized, never mutated, and must not be flagged (see
      // `src/http/ingest-app.ts`, which shares `TOO_LARGE_BODY` as a body).
      const headers = node.arguments[2]
      if (headers !== undefined && ts.isIdentifier(headers) && shared.has(headers.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(headers.getStart(sf))
        out.push({ name: headers.text, line: line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe("http/response-headers-are-fresh-per-response", () => {
  it("hands no response builder in src/ a shared module-level header record", () => {
    for (const file of sourceFiles(srcDir)) {
      const found = sharedHeaderFindings(readFileSync(file, "utf8"), file)
      expect(
        found.map((f) => `${f.name}@${f.line}`),
        `${relative(repoRoot, file)} hands a shared module-level object constant straight to a response builder. ` +
          "The node adapter writes Content-Length back into that record, so the SECOND response over it is a 500 " +
          "(TypeError: v is not iterable). Give c.body(...) a FRESH object each time — a factory like " +
          "pageHeaders()/notFoundHeaders(), or an inline literal. See src/http/not-found.ts.",
      ).toEqual([])
    }
  })
})

describe("http/shared-header-detector-is-precise", () => {
  it("flags a shared object constant handed straight to a response builder", () => {
    const mustFlag = [
      // the exact regression: the constant `pages-app.ts` replaced with a factory
      'const PAGE_HEADERS = { "content-type": "text/html", "cache-control": "no-store" } as const\nc.body(page, 200, PAGE_HEADERS)',
      // one key — the shape that actually 500s at runtime
      'const H = { "content-type": "text/plain" }\nc.body(NOT_FOUND_BODY, 404, H)',
      // other response builders poison the same way
      "const H = { a: 1 }\nc.json(data, 200, H)",
      // a renamed context still builds a poisonable response
      'const H = { "content-type": "text/plain" }\nctx.newResponse(body, 200, H)',
    ]
    for (const s of mustFlag) {
      expect(sharedHeaderFindings(s).length, s).toBeGreaterThan(0)
    }
  })

  it("spares a fresh copy: a factory call, an inline literal, or a spread into a new object", () => {
    const mustNotFlag = [
      // the shipped fix: a nullary factory returns a fresh object each call
      "const H = { a: 1 }\nconst fresh = () => ({ ...H })\nc.body(x, 404, fresh())",
      // an inline literal is fresh by construction
      'c.body(x, 200, { "content-type": "text/html; charset=utf-8" })',
      // a spread INTO a new literal is a new object, not the shared reference
      "const H = { a: 1 }\nc.body(x, 200, { ...H })",
      // a string-valued and a number-valued constant are immutable — the adapter
      // cannot write a key into them, so a body constant and a status constant are
      // not the defect and must not be flagged
      'const BODY = "Not Found"\nconst STATUS = 404\nc.body(BODY, STATUS, notFoundHeaders())',
      // a shared object handed as the JSON BODY (arg 0) is serialized, not mutated
      // — the ingest app does exactly this and it is correct
      'const TOO_LARGE_BODY = { error: "too_large" } as const\nc.json(TOO_LARGE_BODY, 413)',
      // the object constant exists but is never handed to a response builder
      "const H = { a: 1 }\nconst other = H\nreturn other",
    ]
    for (const s of mustNotFlag) {
      expect(sharedHeaderFindings(s), s).toEqual([])
    }
  })
})
