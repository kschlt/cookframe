/**
 * CFV1-SL6 — the cooking route over a REAL socket.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * `cooking-page.test.ts` drives the same routes with `app.request(...)`, which
 * runs the whole Hono app but never reaches the adapter between a response and
 * bytes on a wire. That adapter is where this route's one shipped defect lived:
 * `@hono/node-server` writes the content length back into the headers record a
 * handler passed to `c.body(...)`, so a module-level constant gains a
 * NUMBER-valued key on its first response and every response after it throws
 * `TypeError: v is not iterable` — a 500. Measured on this route before it was
 * fixed: 200, then 500, then 500, with the constant left holding
 * `{"content-type":"text/html; charset=utf-8","Content-Length":13}`.
 *
 * CFV1-RUN found the same defect on the miss path and wrote it down in
 * `src/http/not-found.ts`. This route had it on the SUCCESS path, which is
 * worse: the second cooking plan a running instance served would have been an
 * error page.
 *
 * So every proof here asks TWICE. One request passes either way, which is why
 * a single-request proof would have been no proof at all.
 */

import type { AddressInfo } from "node:net"
import { serve } from "@hono/node-server"
import { afterEach, describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { createCookingApp } from "../../src/http/cooking-app.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { bellPepper } from "./fixtures.js"

interface Served {
  readonly origin: string
  stop(): Promise<void>
}

let running: Served | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** Start the cooking app on an ephemeral port, holding the given recipes. */
async function serving(...recipes: readonly CanonicalRecipe[]): Promise<Served> {
  const repo = createProvisionalStore()
  for (const recipe of recipes) await repo.appendCanonicalVersion(recipe)
  const server = serve({ fetch: createCookingApp({ repo }).fetch, port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  const { port } = server.address() as AddressInfo
  running = {
    origin: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
  return running
}

describe("slice6/recipe-viewable-without-plan", () => {
  it("serves the cooking view twice over a socket, not once and then an error", async () => {
    const { origin } = await serving(bellPepper)
    const first = await fetch(`${origin}/recipes/${bellPepper.id}/cook`)
    const second = await fetch(`${origin}/recipes/${bellPepper.id}/cook`)

    expect(first.status).toBe(200)
    expect(second.status, "the second cooking view was an error page").toBe(200)
    expect(await first.text()).toContain('<ol class="units">')
    expect(await second.text()).toContain('<ol class="units">')
    expect(second.headers.get("content-type")).toBe("text/html; charset=utf-8")
  })

  it("serves the recipe page twice over a socket", async () => {
    const { origin } = await serving(bellPepper)
    const first = await fetch(`${origin}/recipes/${bellPepper.id}`)
    const second = await fetch(`${origin}/recipes/${bellPepper.id}`)

    expect([first.status, second.status]).toEqual([200, 200])
    expect(await second.text()).toContain("<h2>Ingredients</h2>")
  })

  it("answers a miss twice, with the instance's one not-found answer", async () => {
    // Imported from `src/http/not-found.ts` rather than repeated here, so a
    // route whose miss drifted from the rest of the instance shows up as a
    // difference in body, status or content type — not only in a comment.
    const { origin } = await serving(bellPepper)
    const first = await fetch(`${origin}/recipes/nobody/cook`)
    const second = await fetch(`${origin}/recipes/nobody/cook`)

    expect([first.status, second.status]).toEqual([404, 404])
    expect(await second.text()).toBe("Not Found")
    expect(second.headers.get("content-type")).toBe("text/plain; charset=utf-8")
  })

  it("keeps answering when the two paths are interleaved", async () => {
    // The record each handler hands `c.body` is its own; a shared one poisons
    // the other path too, so the paths are crossed rather than each run alone.
    const { origin } = await serving(bellPepper)
    const statuses: number[] = []
    for (const path of [
      `/recipes/${bellPepper.id}/cook`,
      `/recipes/${bellPepper.id}`,
      "/recipes/nobody",
      `/recipes/${bellPepper.id}/cook`,
      `/recipes/${bellPepper.id}`,
    ]) {
      statuses.push((await fetch(`${origin}${path}`)).status)
    }
    expect(statuses).toEqual([200, 200, 404, 200, 200])
  })
})
