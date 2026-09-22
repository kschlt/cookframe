/**
 * CFV1-SL3 — the capability-URL SERVING ROUTE (ADR-0021), proving the capability
 * criteria at the layer the token model could not reach: what the URL actually
 * makes reachable over HTTP.
 *
 * The token model's own proofs live in `capability-token.test.ts` (the store: one
 * recipe, revocable, no enumeration, decided format/lifetime). This suite mounts
 * the store, a repository and the Schema.org mapping behind `createCapabilityApp`
 * and exercises the whole surface in-process with `app.request(...)` — no socket,
 * no origin (ADR-0007). It proves the same three properties as *reachability*
 * facts, per the item's hint that "exposes exactly one recipe" is a property of
 * what the URL makes reachable, not only of what a page renders:
 *
 *  - `slice3/capability-url-single-recipe` — a token's URL serves exactly its one
 *    recipe as Schema.org JSON-LD, and there is no route that reaches another.
 *  - `slice3/capability-url-revocable` — once revoked, the URL no longer serves it.
 *  - `slice3/capability-url-no-ambient-authority` — an unknown token, a revoked
 *    token and a token whose recipe is absent are BYTE-IDENTICAL 404s, so the route
 *    is no oracle for someone trying tokens, and no listing route exists.
 *
 * Every recipe below is synthetic and self-authored (the public-repo content rule)
 * and validated with `CanonicalRecipe.parse`.
 */
import { describe, expect, it } from "vitest"
import { CanonicalRecipe, SCHEMA_VERSION } from "../../schema/index.js"
import { createCapabilityApp } from "../../src/http/capability-app.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import {
  type CapabilityStore,
  createInMemoryCapabilityStore,
  type TokenMinter,
} from "../../src/shopping/capability-token.js"
import { mapCanonicalToSchemaOrg } from "../../src/shopping/schema-org-mapping.js"

/** A deterministic minter yielding tok-1, tok-2, … so assertions are hermetic. */
const sequentialMinter = (): TokenMinter => {
  let n = 0
  return () => {
    n += 1
    return `tok-${n}`
  }
}

/** A complete, schema-valid synthetic Canonical Recipe; `id`/`title` vary per test. */
const canonical = (id: string, title: string): CanonicalRecipe =>
  CanonicalRecipe.parse({
    id,
    schemaVersion: SCHEMA_VERSION,
    title: { state: "from_source", sourceText: title, sourceRefs: [{ blockId: "b-title" }] },
    authors: ["Fixture Author"],
    yields: [
      {
        id: "y-1",
        sourceText: "1 loaf",
        scalingEligibility: "unknown",
        unit: "loaf",
        valueExpression: { sourceText: "1 loaf", kind: "exact", value: 1 },
        sourceRefs: [{ blockId: "b-yield" }],
      },
    ],
    ingredientGroups: [
      {
        id: "ig-1",
        sourceRefs: [{ blockId: "b-ing" }],
        ingredients: [
          {
            id: "ing-1",
            sourceText: "200 g flour",
            name: "flour",
            qualifiers: [],
            scalingEligibility: "proportional",
            sourceRefs: [{ blockId: "b-ing" }],
          },
        ],
      },
    ],
    instructionSections: [
      {
        id: "is-1",
        sourceRefs: [{ blockId: "b-step" }],
        steps: [
          {
            id: "step-1",
            sourceText: "Mix and bake.",
            normalizedActionText: "Mix and bake.",
            sourceRefs: [{ blockId: "b-step" }],
            ingredientUses: [],
            componentUses: [],
            equipmentUses: [],
            producesComponents: [],
            durations: [],
            temperatures: [],
            donenessCues: [],
            prerequisiteCues: [],
            waitCues: [],
          },
        ],
      },
    ],
    provenance: {
      sourceSnapshotId: "snap-1",
      sourceSnapshotVersion: 0,
      targetOntologyVersion: "1.0.0",
      runId: "run-1",
    },
  })

/** Mount an app over a fresh store+repo, and hand back the pieces a test drives. */
async function mount() {
  const repo = createProvisionalStore()
  const store = createInMemoryCapabilityStore({ mint: sequentialMinter() })
  const app = createCapabilityApp({ store, repo })
  return { repo, store, app }
}

/** The three fields that must match for two responses to be indistinguishable. */
async function shapeOf(res: Response) {
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  }
}

describe("slice3/capability-url-single-recipe", () => {
  it("serves exactly the token's one recipe as Schema.org JSON-LD", async () => {
    const { repo, store, app } = await mount()
    const recipe = canonical("recipe-A", "Recipe A")
    await repo.appendCanonicalVersion(recipe)
    const grant = await store.issue("recipe-A")

    const res = await app.request(`/r/${grant.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/ld+json")
    // `no-store` so no cache outlives a revocation and keeps serving the recipe
    // (ADR-0021 §Decision-3). Dropping the header on the served 200 fails here.
    expect(res.headers.get("cache-control")).toBe("no-store")
    // The served body is the deterministic mapping's output verbatim.
    expect(await res.text()).toBe(JSON.stringify(mapCanonicalToSchemaOrg(recipe).recipe))
  })

  it("a token reaches its own recipe and no path reaches another", async () => {
    const { repo, store, app } = await mount()
    const a = canonical("recipe-A", "Recipe A")
    const b = canonical("recipe-B", "Recipe B")
    await repo.appendCanonicalVersion(a)
    await repo.appendCanonicalVersion(b)
    const grantA = await store.issue("recipe-A")
    const grantB = await store.issue("recipe-B")

    const bodyA = await (await app.request(`/r/${grantA.token}`)).text()
    const bodyB = await (await app.request(`/r/${grantB.token}`)).text()
    expect(bodyA).toBe(JSON.stringify(mapCanonicalToSchemaOrg(a).recipe))
    expect(bodyB).toBe(JSON.stringify(mapCanonicalToSchemaOrg(b).recipe))
    // A's URL never serves B: distinct tokens, distinct recipes, and A's body names
    // "Recipe A", not "Recipe B".
    expect(grantA.token).not.toBe(grantB.token)
    expect(bodyA).toContain("Recipe A")
    expect(bodyA).not.toContain("Recipe B")
  })
})

describe("slice3/capability-url-revocable", () => {
  it("stops serving the recipe once the token is revoked", async () => {
    const { repo, store, app } = await mount()
    await repo.appendCanonicalVersion(canonical("recipe-A", "Recipe A"))
    const grant = await store.issue("recipe-A")

    expect((await app.request(`/r/${grant.token}`)).status).toBe(200)
    await store.revoke(grant.token)
    expect((await app.request(`/r/${grant.token}`)).status).toBe(404)
  })
})

describe("slice3/capability-url-no-ambient-authority", () => {
  it("unknown, revoked and recipe-absent tokens are byte-identical 404s", async () => {
    const { repo, store, app } = await mount()

    // (1) a valid, present recipe with a live token — the one legitimate 200.
    await repo.appendCanonicalVersion(canonical("recipe-A", "Recipe A"))
    const live = await store.issue("recipe-A")

    // (2) a revoked token for that same recipe.
    const revoked = await store.issue("recipe-A")
    await store.revoke(revoked.token)

    // (3) a token whose recipe was never persisted — resolves, but loads nothing.
    const dangling = await store.issue("recipe-never-persisted")

    // (4) a well-formed token that was never issued.
    const unknown = await shapeOf(await app.request("/r/tok-does-not-exist"))
    const revokedShape = await shapeOf(await app.request(`/r/${revoked.token}`))
    const danglingShape = await shapeOf(await app.request(`/r/${dangling.token}`))

    // The three misses are indistinguishable — no response tells a real token from
    // a guess, so the route is no oracle over the token space.
    expect(revokedShape).toEqual(unknown)
    expect(danglingShape).toEqual(unknown)
    expect(unknown.status).toBe(404)
    // The 404 body leaks no state: no recipe id, no "revoked", no library hint.
    expect(unknown.body.toLowerCase()).not.toContain("recipe")
    expect(unknown.body.toLowerCase()).not.toContain("revoked")

    // The live token still serves — the miss is not a blanket 404.
    expect((await app.request(`/r/${live.token}`)).status).toBe(200)
  })

  it("an unsafe token is the same miss, never a distinct error", async () => {
    const { app } = await mount()
    const unknown = await shapeOf(await app.request("/r/tok-does-not-exist"))
    // A space is not path-safe; it must not surface as a 400/500 that confirms the
    // guess reached the handler — it is the same 404 as any other miss.
    const unsafe = await shapeOf(await app.request("/r/has%20space"))
    expect(unsafe).toEqual(unknown)
  })

  it("short-circuits an unsafe token before it reaches the store", async () => {
    // The path-safe guard is not just cosmetic: an unsafe token must never reach
    // `store.resolve`, so a malformed guess does no store work at all. Deleting the
    // `isPathSafeToken` check leaves the other tests green (an unsafe token still
    // 404s, because resolve returns undefined for it) — this is the test that would
    // go red, because resolve WOULD then be called. It is the discriminating proof
    // that the guard guards.
    const repo = createProvisionalStore()
    let resolveCalls = 0
    const spyStore: CapabilityStore = {
      issue: () => {
        throw new Error("issue not used in this test")
      },
      resolve: async (_token: string) => {
        resolveCalls += 1
        return undefined
      },
      revoke: async () => false,
    }
    const app = createCapabilityApp({ store: spyStore, repo })

    // An unsafe token is refused before any store call.
    expect((await app.request("/r/has%20space")).status).toBe(404)
    expect(resolveCalls).toBe(0)

    // A path-safe (but unknown) token DOES reach the store — proving the guard is
    // discriminating, not a blanket refusal that never resolves anything.
    expect((await app.request("/r/tok-well-formed")).status).toBe(404)
    expect(resolveCalls).toBe(1)
  })

  it("exposes no listing or enumeration route", async () => {
    const { app } = await mount()
    const unknown = await shapeOf(await app.request("/r/tok-does-not-exist"))
    // No index of tokens or recipes is reachable — every non-recipe path is the
    // same 404, so there is nothing to enumerate.
    for (const path of ["/", "/r", "/r/", "/recipes", "/library", "/r/tok-1/extra"]) {
      expect(await shapeOf(await app.request(path))).toEqual(unknown)
    }
  })
})
