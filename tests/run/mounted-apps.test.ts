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
 *  1. **Every app factory in `src/http/` is mounted by `composeInstance`.** An
 *     app nobody mounts is a set of addresses that do not exist.
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
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { composeInstance } from "../../src/server/instance.js"
import { canonical, LIBRARY_CREDENTIAL, testInstanceDeps } from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const httpDir = join(repoRoot, "src", "http")
const instanceFile = join(repoRoot, "src", "server", "instance.ts")

/** `export function createSomethingApp(` — an app factory, by the layer's own convention. */
const APP_FACTORY = /export function (create[A-Za-z0-9]*App)\s*\(/g
/** `app.get("/path"` and friends, tolerating the newline a long call puts after the paren. */
const ROUTE = /\bapp\.(get|post|put|patch|delete|all)\(\s*"([^"]+)"/g

/** Every app factory the HTTP layer exports, with the file that exports it. */
function appFactories(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  for (const file of readdirSync(httpDir).sort()) {
    if (!file.endsWith(".ts")) continue
    const text = readFileSync(join(httpDir, file), "utf8")
    for (const match of text.matchAll(APP_FACTORY)) {
      found.push({ name: match[1] as string, file: `src/http/${file}` })
    }
  }
  return found
}

/** Every method-and-path an app file declares, with the file that declares it. */
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

/**
 * The body of `composeInstance`, by brace matching — not the whole file.
 *
 * Reading the whole file instead would count any call anywhere in it as a mount
 * — a helper, a re-export, a commented-out line brought back. Measured: with the
 * whole file read, an app that is constructed at module level and never routed
 * passes this proof; with the body read, it does not. Fail closed: a file this
 * cannot find the function in is a failure, not a pass, which is what the rename
 * mutation confirms.
 */
function composeInstanceBody(): string {
  const text = readFileSync(instanceFile, "utf8")
  const start = text.indexOf("export function composeInstance")
  expect(start, "composeInstance is not where this proof looks for it").toBeGreaterThan(-1)
  const open = text.indexOf("{", start)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth += 1
    else if (text[i] === "}") {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  throw new Error("composeInstance has no closing brace")
}

describe("serve/every-app-is-mounted", () => {
  it("every app factory in src/http is called by composeInstance", () => {
    const body = composeInstanceBody()
    const factories = appFactories()
    const unmounted = factories.filter((f) => !body.includes(`${f.name}(`))
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
