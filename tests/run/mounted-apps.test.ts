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
 * The second rule below still reads route declarations with a regular
 * expression, and its limits are stated where it is defined. That is left as it
 * is deliberately: a duplicate address costs a dead handler, while an unmounted
 * app costs a page nobody can reach, and only the second one has happened.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
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

/** Parse one file into a syntax tree, positions kept so `getText()` works. */
function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  )
}

/** Is this declaration exported? */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

/** Does this function say it returns a Hono app? */
function returnsHono(node: { readonly type?: ts.TypeNode | undefined }): boolean {
  return node.type !== undefined && node.type.getText().trim() === "Hono"
}

/**
 * Every app factory the HTTP layer exports, with the file that exports it.
 *
 * A factory is an exported declaration whose RETURN TYPE is `Hono` — written as
 * a function or as a const, because which of the two an author picks is a style
 * choice and this rule is not about style. The naming convention is a second
 * net: a factory that drops the annotation but keeps the name is still found.
 */
function appFactories(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  for (const file of readdirSync(httpDir).sort()) {
    if (!file.endsWith(".ts")) continue
    const where = `src/http/${file}`
    const source = parse(join(httpDir, file))
    for (const node of source.statements) {
      if (ts.isFunctionDeclaration(node) && isExported(node) && node.name !== undefined) {
        const name = node.name.text
        if (returnsHono(node) || FACTORY_NAME.test(name)) found.push({ name, file: where })
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
          returnsHono(init)
        // `const createFooApp: () => Hono = …` annotates the variable instead.
        const onTheVariable = declared.type?.getText().trim().endsWith("Hono") === true
        if (annotated || onTheVariable || FACTORY_NAME.test(name)) {
          found.push({ name, file: where })
        }
      }
    }
  }
  return found
}

/** Every method-and-path an app file declares, with the file that declares it.
 *
 * Still a regular expression, and so blind to a path written as a template
 * literal, a variable, or declared through `app.on("GET", …)`. Nothing in
 * `src/http/` uses any of those, and the cost of the blindness is a dead
 * handler rather than an unserved page — which is why widening it is not part
 * of this unit. */
function declaredRoutes(): { route: string; file: string }[] {
  const found: { route: string; file: string }[] = []
  for (const file of readdirSync(httpDir).sort()) {
    if (!file.endsWith(".ts")) continue
    const text = readFileSync(join(httpDir, file), "utf8")
    for (const match of text.matchAll(ROUTE)) {
      found.push({ route: `${(match[1] as string).toUpperCase()} ${match[2]}`, file })
    }
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
