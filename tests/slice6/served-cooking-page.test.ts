/**
 * CFV1-SL6 — the cooking route over a REAL socket, on the instance that is
 * actually served.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * Two things had to be true and only one of them was. `cooking-page.test.ts`
 * drives the routes with `app.request(...)`, which runs the whole Hono app but
 * never reaches the adapter between a response and bytes on a wire; that adapter
 * is where this route's first shipped defect lived, and the fix for it is why
 * every proof here asks TWICE. `@hono/node-server` writes the content length
 * back into the headers record a handler passed to `c.body(...)`, so a shared
 * constant gains a NUMBER-valued key on its first response and every response
 * after it throws `TypeError: v is not iterable` — measured on this route
 * before it was fixed: 200, then 500, then 500.
 *
 * The second defect is the one this file used to have itself. It started a
 * server of its OWN, around an app it built by hand, and so proved that the
 * route works when something calls it — not that anything calls it. Nothing
 * did: `composeInstance` mounted the ingest, capability and pages apps and
 * never the cooking one, so a running instance answered the library with 200,
 * the recipe page with 200, and the cook address with 404, while every proof of
 * the route passed. Measured over a socket on 2026-09-22, before the fix.
 *
 * So these proofs now start the composed instance — the same
 * {@link startTestInstance} the CFV1-RUN suites use, the same `composeInstance`
 * the process runs — and reach it by its credential over TCP. A proof that
 * builds its own server cannot see a missing mount, by construction.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { LIBRARY_CREDENTIAL, startTestInstance, type TestInstance } from "../run/harness.js"
import { bellPepper } from "./fixtures.js"

let running: TestInstance | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** Start the COMPOSED instance on an ephemeral port, holding the given recipes. */
async function serving(...recipes: readonly CanonicalRecipe[]): Promise<TestInstance> {
  const instance = await startTestInstance()
  running = instance
  for (const recipe of recipes) await instance.repo.appendCanonicalVersion(recipe)
  return instance
}

/** One GET against the running instance, carrying the library credential. */
const get = (instance: TestInstance, path: string): Promise<Response> =>
  fetch(`${instance.origin}${path}`, {
    headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
  })

describe("slice6/recipe-viewable-without-plan", () => {
  it("serves the cooking view twice over a socket, not once and then an error", async () => {
    const instance = await serving(bellPepper)
    const first = await get(instance, `/recipes/${bellPepper.id}/cook`)
    const second = await get(instance, `/recipes/${bellPepper.id}/cook`)

    expect(first.status, "the instance does not serve the cooking page at all").toBe(200)
    expect(second.status, "the second cooking view was an error page").toBe(200)
    expect(await first.text()).toContain('<ol class="units">')
    expect(await second.text()).toContain('<ol class="units">')
    expect(second.headers.get("content-type")).toBe("text/html; charset=utf-8")
    // The private library's pages are not cacheable, and the cooking page is one
    // of them. It reached review sending no `cache-control` at all, because it
    // was an app of its own with its own headers.
    expect(second.headers.get("cache-control")).toBe("no-store")
  })

  it("serves the recipe page twice over a socket", async () => {
    const instance = await serving(bellPepper)
    const first = await get(instance, `/recipes/${bellPepper.id}`)
    const second = await get(instance, `/recipes/${bellPepper.id}`)

    expect([first.status, second.status]).toEqual([200, 200])
    expect(await second.text()).toContain("<h2>Ingredients</h2>")
  })

  it("answers a miss twice, with the instance's one not-found answer", async () => {
    // Imported from `src/http/not-found.ts` rather than repeated here, so a
    // route whose miss drifted from the rest of the instance shows up as a
    // difference in body, status or content type — not only in a comment.
    const instance = await serving(bellPepper)
    const first = await get(instance, "/recipes/nobody/cook")
    const second = await get(instance, "/recipes/nobody/cook")

    expect([first.status, second.status]).toEqual([404, 404])
    expect(await second.text()).toBe("Not Found")
    expect(second.headers.get("content-type")).toBe("text/plain; charset=utf-8")
  })

  it("gives a caller without the credential the same answer as an absent recipe", async () => {
    // The cooking page is a page of the private library, so it must not be the
    // one address that tells a stranger which recipe ids exist (`ADR-0024`).
    // It was exactly that for a pull request, being served by an app that took
    // no credential — which nothing noticed, because nothing served it.
    const instance = await serving(bellPepper)
    const bare = await fetch(`${instance.origin}/recipes/${bellPepper.id}/cook`)
    const absent = await get(instance, "/recipes/nobody/cook")

    expect(bare.status).toBe(404)
    expect(await bare.text()).toBe(await absent.text())
    expect(bare.headers.get("content-type")).toBe(absent.headers.get("content-type"))
  })

  it("keeps answering when the two paths are interleaved", async () => {
    // The record each handler hands `c.body` is its own; a shared one poisons
    // the other path too, so the paths are crossed rather than each run alone.
    const instance = await serving(bellPepper)
    const statuses: number[] = []
    for (const path of [
      `/recipes/${bellPepper.id}/cook`,
      `/recipes/${bellPepper.id}`,
      "/recipes/nobody",
      `/recipes/${bellPepper.id}/cook`,
      `/recipes/${bellPepper.id}`,
    ]) {
      statuses.push((await get(instance, path)).status)
    }
    expect(statuses).toEqual([200, 200, 404, 200, 200])
  })
})
