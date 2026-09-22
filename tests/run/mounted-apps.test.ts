/**
 * CFV1-SERVE — an app the HTTP layer builds is an app the instance serves.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * The measured failure: CFV1-SL6 built `createCookingApp` with `GET
 * /recipes/:id/cook`, ninety proofs drove it, and `composeInstance` never
 * mounted it. A running instance answered the library with 200, the recipe page
 * with 200, and the cook address with **404**, for a whole pull request. Every
 * proof of the route was true and none of them was about the instance.
 *
 * That is the fourth shape of this repository's recurring defect — a proof that
 * builds its own subject. The three before it: a named proof guarding something
 * beside its name, a planted violation failing somewhere other than at its own
 * assertion, and a no-op passing because the happy path had already established
 * the state. This one is: a proof that constructs the thing it is testing proves
 * the thing works when called, never that anything calls it.
 *
 * Two rules follow, and they are checked here by reading the tree rather than by
 * hoping the next author remembers:
 *
 *  1. **Every app factory in `src/http/` is ROUTED by `composeInstance`.** An
 *     app nobody mounts is a set of addresses that do not exist. Routed, not
 *     called: `createCookingApp` WAS built, and the gap was that nothing served
 *     it, so a rule that accepted a bare call would have been green on the very
 *     tree it exists to reject. Measured — the first version of this proof did
 *     exactly that, and `void createOrphanApp()` inside `composeInstance` passed
 *     it. The rule was named for mounting and checked calling, which is this
 *     repository's FIRST recurring shape appearing inside the proof written
 *     against its fourth.
 *  2. **No two apps declare the same method and path.** Hono answers with the
 *     first mounted handler that matches, so the second one is a route that can
 *     never run — which is what would have happened had the cooking app been
 *     mounted beside the pages app, since both declared `GET /recipes/:id`.
 *
 * Both are structural, and both say what they cannot see: a route INSIDE a
 * mounted app that no one reaches for some other reason is not visible to
 * either, which is why the behavioural proof below asks the composed instance
 * for the address itself, and `tests/slice6/served-cooking-page.test.ts` asks
 * the running one over a socket.
 *
 * **The first rule reads the TypeScript syntax tree, not a regular expression,
 * and that is a correction rather than a preference.** A regex holds ONE
 * spelling. The first version of this proof matched `export function
 * create…App(`, so an app written `export const createOrphanApp = (): Hono =>`
 * was not a factory as far as it was concerned — and the arrow form is already
 * live in this layer, `pageHeaders` in the file this unit edits being written
 * that way. Both of those were planted in the shipped tree and both stayed
 * green, with `tsc` clean and all 958 proofs passing.
 *
 * So a factory is what the compiler says it is: an exported declaration in
 * `src/http/` whose return type is `Hono` — function or const, since the
 * declaration form is a style choice and this is not about style. The naming
 * convention is kept as a second net, so a factory that drops the `Hono`
 * annotation while keeping the name is still seen; and because the return type
 * is read, a factory that keeps the annotation and abandons the name
 * (`export function buildOrphanRoutes(): Hono`) is caught too, which the
 * name-matching version was not.
 *
 * Four cases, planted in the shipped tree and measured, with `tsc` clean in
 * each: the arrow-declared app, the bare call, the renamed factory — all three
 * red at `an app nobody mounts serves nothing` — and a mount written as
 * `const orphan = createOrphanApp(); app.route("/", orphan)`, which stays
 * GREEN. That last one is not a footnote: a guard that called correct code a
 * violation is a guard somebody switches off, so the binding is followed rather
 * than the syntax being dictated.
 *
 * **A guard's AIM was pinned here; its BREADTH was not.** Everything above says
 * what this scan recognises, and the tree executed none of it: narrowing the
 * return-type test back to the literal word `Hono`, or stopping the directory
 * walk at one level, ran green. The forms are held now by
 * `serve/the-factory-scan-is-precise` — a table of nine sources the scan must
 * see and ten neighbours it must spare, driven through `appFactoriesIn`, which
 * is a pure function of TEXT for exactly that reason. Separating detection from
 * the file walk is what made the table possible; before it there was no seam to
 * hand a fixture to.
 *
 * Two of those neighbours are there because planting found them missing: a type
 * that merely MENTIONS `Hono` (`readonly Hono[]`) and a module-level const that
 * is not exported. Without them, widening the type test to any mention of the
 * word, and dropping the export requirement, both survived — a negative table
 * that spares every case for a structural reason measures nothing about the
 * property it is supposed to be about.
 *
 * The second rule below still reads route declarations with a regular
 * expression, and its limits are stated where it is defined. That is left as it
 * is deliberately: a duplicate address costs a dead handler, while an unmounted
 * app costs a page nobody can reach, and only the second one has happened.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { composeInstance } from "../../src/server/instance.js"
import { canonical, LIBRARY_CREDENTIAL, testInstanceDeps } from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const httpDir = join(repoRoot, "src", "http")
const instanceFile = join(repoRoot, "src", "server", "instance.ts")

/** The layer's naming convention, kept as a second net beside the return type. */
const FACTORY_NAME = /^create[A-Za-z0-9]*App$/
/** `app.get("/path"` and friends, tolerating the newline a long call puts after the paren. */
const ROUTE = /\bapp\.(get|post|put|patch|delete|all)\(\s*"([^"]+)"/g

/** Parse source TEXT into a syntax tree, positions kept so `getText()` works. */
function parseText(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true)
}

/** Parse one file on disk. A thin caller: every rule below decides on TEXT. */
function parse(path: string): ts.SourceFile {
  return parseText(path, readFileSync(path, "utf8"))
}

/**
 * Every `.ts` under a directory, RECURSIVELY, sorted.
 *
 * Recursively, because the first version of this proof read `src/http/` one
 * level deep. The layer is flat today, so that was invisible — and it means the
 * day someone groups the pages app into `src/http/pages/`, every factory in it
 * stops being seen and `an app nobody mounts serves nothing` passes over a tree
 * it can no longer read. A guard whose coverage depends on nobody making a
 * directory is not a guard, so `serve/the-factory-scan-is-precise` builds a
 * two-level fixture tree and requires the walk to reach into it.
 */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full))
    else if (name.endsWith(".ts")) out.push(full)
  }
  return out
}

/** A path as a reader should see it: repo-relative, forward slashes. */
function where(path: string): string {
  return relative(repoRoot, path).split(sep).join("/")
}

/** Is this declaration exported? */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

/**
 * Does this type annotation describe a Hono app?
 *
 * The text has to END in `Hono`, optionally with type arguments: `Hono`,
 * `Hono<Env>`, and — for an annotation carried by the variable rather than by
 * the function — `() => Hono<Env>`. `Promise<Hono>` is not one, because the
 * word is not what the annotation resolves to.
 *
 * Two corrections live in that sentence, both of them gaps found by reading the
 * shipped proof rather than by a failure. The return-type test compared the
 * text to the literal string `"Hono"`, so a **generic** annotation was not a
 * Hono return as far as it was concerned — and paired with a name outside the
 * `create…App` convention it walked past BOTH nets at once. Hono's own type
 * parameters are how an app carries its bindings, so the generic form is the
 * one a later author is most likely to reach for. The variable-annotation test
 * used `endsWith("Hono")`, which has the same hole one level in.
 *
 * One predicate now serves both positions, which is also what lets
 * `serve/the-factory-scan-is-precise` hand the scan a deliberately narrow one
 * and require the fixtures to survive it.
 */
const HONO_TYPE = /\bHono\s*(?:<[\s\S]*>)?$/

function honoTyped(text: string | undefined): boolean {
  return text !== undefined && HONO_TYPE.test(text.trim())
}

/**
 * Every app factory ONE SOURCE TEXT exports, by name.
 *
 * A pure function of text, and that is the point rather than tidiness: the rule
 * used to read the directory and decide in one pass, so there was no seam to
 * hand a fixture to, and nothing in the tree ever executed it against a
 * violation. Detection and the file walk are separate now, so the table in
 * `serve/the-factory-scan-is-precise` can drive this directly.
 *
 * A factory is an exported declaration whose RETURN TYPE is a Hono app —
 * written as a function or as a const, because which of the two an author picks
 * is a style choice and this rule is not about style. The naming convention is
 * a second net: a factory that drops the annotation but keeps the name is still
 * found.
 *
 * `isHono` is injected so a narrower reference can be measured against the same
 * fixtures; production always takes the default.
 */
function appFactoriesIn(
  fileName: string,
  source: string,
  isHono: (text: string | undefined) => boolean = honoTyped,
): string[] {
  const found: string[] = []
  for (const node of parseText(fileName, source).statements) {
    if (ts.isFunctionDeclaration(node) && isExported(node) && node.name !== undefined) {
      const name = node.name.text
      if (isHono(node.type?.getText()) || FACTORY_NAME.test(name)) found.push(name)
      continue
    }
    if (!ts.isVariableStatement(node) || !isExported(node)) continue
    for (const declared of node.declarationList.declarations) {
      if (!ts.isIdentifier(declared.name)) continue
      const name = declared.name.text
      const init = declared.initializer
      const annotated =
        init !== undefined &&
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
        isHono(init.type?.getText())
      // `const createFooApp: () => Hono = …` annotates the variable instead.
      if (annotated || isHono(declared.type?.getText()) || FACTORY_NAME.test(name)) {
        found.push(name)
      }
    }
  }
  return found
}

/** Every app factory the HTTP layer exports, with the file that exports it. */
function appFactories(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  for (const path of sourceFilesUnder(httpDir)) {
    const file = where(path)
    for (const name of appFactoriesIn(file, readFileSync(path, "utf8"))) found.push({ name, file })
  }
  return found
}

/** Every method-and-path ONE SOURCE TEXT declares.
 *
 * Still a regular expression, and so blind to a path written as a template
 * literal, a variable, or declared through `app.on("GET", …)`. Nothing in
 * `src/http/` uses any of those, and the cost of the blindness is a dead
 * handler rather than an unserved page — which is why widening it, and pinning
 * the breadth of the widening, is not part of this unit. It is split out of the
 * file walk anyway, so the day it is widened there is somewhere to put the
 * table. */
function declaredRoutesIn(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(ROUTE)) {
    found.push(`${(match[1] as string).toUpperCase()} ${match[2]}`)
  }
  return found
}

/** Every method-and-path an app file declares, with the file that declares it. */
function declaredRoutes(): { route: string; file: string }[] {
  const found: { route: string; file: string }[] = []
  for (const path of sourceFilesUnder(httpDir)) {
    const file = where(path)
    for (const route of declaredRoutesIn(readFileSync(path, "utf8"))) found.push({ route, file })
  }
  return found
}

/** `composeInstance`'s own declaration, or a failure. */
function composeInstanceDeclaration(): ts.FunctionDeclaration {
  const source = parse(instanceFile)
  const found = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "composeInstance",
  )
  // Fail closed. A file this cannot find the function in is a failure, not a
  // pass — which is what the rename mutation confirms.
  expect(found, "composeInstance is not where this proof looks for it").toBeTruthy()
  return found as ts.FunctionDeclaration
}

/** Every identifier appearing anywhere under a node. */
function identifiersIn(node: ts.Node): string[] {
  const names: string[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) names.push(n.text)
    n.forEachChild(walk)
  }
  walk(node)
  return names
}

/**
 * Every app name `composeInstance` actually ROUTES — the argument side of an
 * `app.route(…)` call, not any call in the body.
 *
 * That distinction is the unit: `createCookingApp` was CALLED nowhere and
 * SERVED nowhere, and a rule that accepted a bare call would pass a body that
 * merely constructs an app and drops it. Measured — the first version did.
 *
 * A name bound to a local variable counts too, so
 * `const pages = createPagesApp(…); app.route("/", pages)` is a mount rather
 * than a false alarm. Resolved to a fixed point, because one binding can name
 * another, and a guard that cries wolf on correct code is a guard somebody
 * switches off.
 */
function routedApps(): Set<string> {
  const declaration = composeInstanceDeclaration()
  const body = declaration.body
  expect(body, "composeInstance has no body").toBeTruthy()

  /** local variable name -> the identifiers its initializer mentions */
  const bindings = new Map<string, string[]>()
  const routed = new Set<string>()

  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, identifiersIn(node.initializer))
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "route"
    ) {
      for (const argument of node.arguments) for (const n of identifiersIn(argument)) routed.add(n)
    }
    node.forEachChild(walk)
  }
  walk(body as ts.Block)

  // Follow the bindings until nothing new is reached.
  for (let added = true; added; ) {
    added = false
    for (const name of [...routed]) {
      for (const reached of bindings.get(name) ?? []) {
        if (!routed.has(reached)) {
          routed.add(reached)
          added = true
        }
      }
    }
  }
  return routed
}

describe("serve/every-app-is-mounted", () => {
  it("every app factory in src/http is routed by composeInstance", () => {
    const routed = routedApps()
    const factories = appFactories()
    const unmounted = factories.filter((f) => !routed.has(f.name))
    expect(
      unmounted.map((f) => `${f.name} (${f.file})`),
      "an app nobody mounts serves nothing",
    ).toEqual([])
    // Non-vacuity: a scan that found no factories would report nothing unmounted
    // either, so the emptiness above has to be read against a real list.
    //
    // Named with `toContain` rather than pinned as an exact list, and that is the
    // point rather than looseness. Pinned, this line went red the moment an app
    // was ADDED — so the proof that a new unmounted app is caught died here
    // instead of at the assertion above, and "the guard caught it" would have
    // been a claim about the wrong line. Measured: planting an unmounted app
    // turned this red before the assertion that exists to catch it.
    const names = factories.map((f) => f.name)
    expect(names).toContain("createPagesApp")
    expect(names).toContain("createIngestApp")
    expect(names).toContain("createCapabilityApp")
  })
})

/**
 * Sources the factory scan MUST see, with the name it must find in each.
 *
 * Every entry is a form a factory can actually be written in. The point of the
 * table is not that these nine are exhaustive — it is that the scan's BREADTH
 * is executed by the tree rather than asserted in a comment. Narrowing the
 * return-type test back to the bare word `Hono` runs green without it; with it,
 * `a narrower return-type test misses what this scan catches` goes red and
 * names each form that was lost.
 */
const MUST_FLAG: { why: string; source: string; name: string }[] = [
  {
    why: "the plain form: an exported function annotated Hono",
    source: "export function createPagesApp(): Hono { return app }",
    name: "createPagesApp",
  },
  {
    why: "arrow-declared const — the form pageHeaders in this layer already uses",
    source: "export const createOrphanApp = (): Hono => app",
    name: "createOrphanApp",
  },
  {
    why: "a name outside the create…App convention, caught by the return type alone",
    source: "export function buildOrphanRoutes(): Hono { return app }",
    name: "buildOrphanRoutes",
  },
  {
    why: "a GENERIC return type plus a non-conventional name walks past both nets",
    source: "export function mountTheThing(): Hono<Env> { return app }",
    name: "mountTheThing",
  },
  {
    why: "the same, arrow-declared and spaced out, since whitespace is a style choice",
    source: "export const attachRoutes = (): Hono< Env > => app",
    name: "attachRoutes",
  },
  {
    why: "the annotation carried by the variable rather than by the function",
    source: "export const createThingApp: () => Hono = () => app",
    name: "createThingApp",
  },
  {
    why: "carried by the variable AND generic — the same hole one level in",
    source: "export const buildThing: () => Hono<Env> = () => app",
    name: "buildThing",
  },
  {
    why: "a factory that drops the annotation but keeps the name",
    source: "export function createLibraryApp() { return app }",
    name: "createLibraryApp",
  },
  {
    why: "a function expression, because the declaration form is not the rule",
    source: "export const createThatApp = function (): Hono { return app }",
    name: "createThatApp",
  },
]

/**
 * Neighbours the scan MUST spare, each close enough that sparing it is a
 * decision rather than an accident.
 *
 * A negative fixture spared for the wrong reason is worse than none: it reads
 * as precision and measures nothing. So none of these is an arbitrary string —
 * each one sits one property away from an entry above. `pageHeaders` is a real
 * exported arrow const from this very layer; the import line carries the exact
 * name of the first positive; the inner const is a factory in every respect
 * except that it is not the module's.
 */
const MUST_SPARE: { why: string; source: string }[] = [
  {
    why: "not exported: a factory the module keeps to itself is nobody's to mount",
    source: "function createLocalApp(): Hono { return app }",
  },
  {
    why: "an exported arrow const that returns something else — pageHeaders, verbatim",
    source: "export const pageHeaders = (): Record<string, string> => ({})",
  },
  {
    why: "an exported function with a non-conventional name and a non-Hono return",
    source: 'export function renderRecipe(): string { return "" }',
  },
  {
    why: "an annotation on the variable that resolves to something else",
    source: "export const notAnApp: () => Response = () => new Response()",
  },
  {
    why: "a type alias ENDING in Hono declares no app, so the tail match alone is not the rule",
    source: "export type AppFactory = () => Hono",
  },
  {
    why: "importing a factory is not exporting one, or every mounting file would be a violation",
    source: 'import { createPagesApp } from "./pages-app.js"',
  },
  {
    why: "a factory bound inside a function body is not one of the module's exports",
    source: "function outer() { const createInnerApp = (): Hono => app; return createInnerApp }",
  },
  {
    why: "the word Hono as a VALUE: this reads the syntax tree, not the text",
    source: 'export const HONO_HEADER = "Hono"',
  },
  {
    // Found by planting: widening the type test to any MENTION of Hono survived
    // the table as it first stood, because every negative in it was spared for
    // a structural reason and none for the shape of its annotation.
    why: "a type that MENTIONS Hono without resolving to one — a list of apps is not a factory",
    source: "export const mountedApps: readonly Hono[] = []",
  },
  {
    // Found by planting too: dropping the export requirement survived, because
    // the only unexported fixture was a FUNCTION and the only inner one was not
    // a module statement at all. A module-level const is the case that reaches
    // the second branch.
    why: "a module-level factory nobody exports is a factory composeInstance cannot reach",
    source: "const createPrivateApp = (): Hono => app",
  },
]

describe("serve/the-factory-scan-is-precise", () => {
  it("every form an app factory is written in is seen", () => {
    for (const { why, source, name } of MUST_FLAG) {
      expect(appFactoriesIn("fixture.ts", source), why).toContain(name)
    }
  })

  it("a neighbour that is not an app factory is spared", () => {
    for (const { why, source } of MUST_SPARE) {
      expect(appFactoriesIn("fixture.ts", source), why).toEqual([])
    }
  })

  it("a narrower return-type test misses what this scan catches", () => {
    // The shipped version before this one: a type was a Hono app when its text
    // ended in the bare word. That is the LOOSER of the two tests it used — the
    // return-type path compared to the literal string — so what it misses here
    // is a floor, not a ceiling.
    const endsInTheBareWord = (text: string | undefined): boolean =>
      text?.trim().endsWith("Hono") === true
    const missed = MUST_FLAG.filter(
      ({ source, name }) => !appFactoriesIn("fixture.ts", source, endsInTheBareWord).includes(name),
    )
    expect(
      missed.map((m) => m.why),
      "the narrow reference passes the whole table, so the table pins no breadth",
    ).toHaveLength(3)
  })

  it("a one-level directory walk misses a factory grouped into a subdirectory", () => {
    // The scan's breadth is two things, and the table above holds only one of
    // them: what it recognises, and where it looks. `src/http/` is flat today,
    // so the walk's depth is invisible in the tree it actually guards — which
    // is exactly the condition under which it was wrong and green.
    const root = mkdtempSync(join(tmpdir(), "factory-scan-"))
    try {
      writeFileSync(join(root, "flat.ts"), "export function createFlatApp(): Hono { return app }")
      mkdirSync(join(root, "grouped"))
      writeFileSync(
        join(root, "grouped", "nested.ts"),
        "export function createNestedApp(): Hono { return app }",
      )

      const oneLevel = readdirSync(root)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(root, name))
      expect(
        oneLevel,
        "the narrow reference already sees the nested file, so this pins nothing",
      ).toEqual([join(root, "flat.ts")])

      expect(
        sourceFilesUnder(root),
        "a factory grouped into a subdirectory is still the layer's to mount",
      ).toEqual([join(root, "flat.ts"), join(root, "grouped", "nested.ts")])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("serve/no-two-apps-claim-one-address", () => {
  it("no method and path is declared by two app files", () => {
    const routes = declaredRoutes()
    const byRoute = new Map<string, string[]>()
    for (const { route, file } of routes) {
      const files = byRoute.get(route)
      if (files === undefined) byRoute.set(route, [file])
      else if (!files.includes(file)) files.push(file)
    }
    const shared = [...byRoute.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([route, files]) => `${route} in ${files.join(" and ")}`)
    expect(shared, "the second handler for an address can never run").toEqual([])
    // Non-vacuity: the scan really read the routes, including the one that was
    // declared twice — `GET /recipes/:id` — and the cook address beside it.
    expect(routes.map((r) => r.route)).toContain("GET /recipes/:id")
    expect(routes.map((r) => r.route)).toContain("GET /recipes/:id/cook")
  })
})

describe("serve/the-cooking-page-has-an-address", () => {
  it("the composed instance answers the cook address, credential and all", async () => {
    const built = testInstanceDeps()
    await built.repo.appendCanonicalVersion(canonical("r-cook", "A recipe to cook"))
    const app = composeInstance(built.deps)

    const cooking = await app.request("/recipes/r-cook/cook", {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })
    expect(cooking.status, "composeInstance does not serve the cooking page").toBe(200)
    expect(await cooking.text()).toContain('<ol class="units">')

    // And the recipe page is still the recipe page: the two addresses are
    // distinct, so a mount that answered both with the same handler is red here.
    const recipe = await app.request("/recipes/r-cook", {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })
    expect(recipe.status).toBe(200)
    expect(await recipe.text()).toContain("<h2>Ingredients</h2>")
  })
})
