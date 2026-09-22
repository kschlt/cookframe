/**
 * The cooking route (CFV1-SL6): `GET /recipes/:id` for the saved recipe, and
 * `GET /recipes/:id/cook` for the plan derived from it.
 *
 * It composes the repository, the derivation and the render path into the two
 * addresses a cook reaches, and it is a Hono app and nothing more — `app.fetch`
 * is the whole surface (`ADR-0007`), so it is exercised in-process with
 * `app.request(...)` and binds no socket. The server entry point that runs it is
 * the hosting concern (`ADR-0011`) and is deliberately not here.
 *
 * **Degradation is to the recipe page, never to nothing.** That is the item's
 * own constraint, and under `PDR-0004`'s `lazy` default it is not an error path
 * but the ordinary state of every recipe nobody has cooked yet. So the cook
 * address answers with a cooking view when it can and with the Slice 2 recipe
 * page when it cannot, and the only 404 is a recipe this instance does not hold:
 *
 *  - **No stored plan** — derive one now and serve it. Deriving costs nothing
 *    (`ADR-0023`: a pure function, no model call), which is what makes `lazy`
 *    cheap enough to be the default.
 *  - **Derivation fails** — serve the recipe page. A plan whose provenance has a
 *    hole is refused at the source (`UntraceablePlanFactError`), and the cook
 *    gets the recipe rather than an error: the Canonical Recipe is authoritative
 *    and the plan is the replaceable layer, so losing the plan must never take
 *    the recipe with it.
 *  - **Rendering fails** — the same. A page that half-rendered is not something
 *    to hand a person standing over a pan.
 *
 * The route derives rather than storing what it derived. Writing on a GET would
 * make a read path a write path, and `PDR-0004` already names the two moments a
 * plan is generated: `lazy`, which is this derivation, and `background`, which
 * is the import's (`ADR-0008`). A caching write here would be a third, decided
 * in passing.
 */

import { Hono } from "hono"
import { deriveCookingPlan } from "../cooking/index.js"
import type { RecipeRepository } from "../persistence/index.js"
import { renderCookingPage, renderRecipePage } from "../render/index.js"

/** The collaborators this route composes; every one injected (ADR-0004). */
export interface CookingAppDeps {
  readonly repo: RecipeRepository
  /**
   * Told when the cooking view could not show a plan and served the recipe page
   * instead. Optional, and observation only — nothing about the response depends
   * on it, so an instance that wires nothing here behaves identically.
   */
  readonly onDegraded?: (recipeId: string, reason: unknown) => void
}

const NOT_FOUND_BODY = "Not Found"
const NOT_FOUND_HEADERS = { "content-type": "text/plain; charset=utf-8" } as const
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const

/**
 * Build the cooking app. Both routes answer HTML; an unknown recipe id is the
 * one 404, and every other outcome at the cook address is a page the cook can
 * read.
 */
export function createCookingApp(deps: CookingAppDeps): Hono {
  const app = new Hono()

  app.notFound((c) => c.body(NOT_FOUND_BODY, 404, NOT_FOUND_HEADERS))

  app.get("/recipes/:id", async (c) => {
    const version = await deps.repo.loadLatestCanonical(c.req.param("id"))
    if (version === undefined) return c.notFound()
    return c.body(renderRecipePage(version.recipe), 200, HTML_HEADERS)
  })

  app.get("/recipes/:id/cook", async (c) => {
    const recipeId = c.req.param("id")
    const version = await deps.repo.loadLatestCanonical(recipeId)
    if (version === undefined) return c.notFound()

    // Keyed by version, so a recipe re-normalized since the plan was stored gets
    // a fresh derivation rather than the previous version's plan.
    const stored = await deps.repo.loadCookingPlan(recipeId, version.version)

    try {
      const plan =
        stored ?? deriveCookingPlan(version.recipe, { canonicalVersion: version.version })
      return c.body(renderCookingPage(plan), 200, HTML_HEADERS)
    } catch (error) {
      // The recipe is authoritative and the plan is derived; whatever went wrong
      // with the plan, the recipe is still readable, so that is what is served.
      deps.onDegraded?.(recipeId, error)
      return c.body(renderRecipePage(version.recipe), 200, HTML_HEADERS)
    }
  })

  return app
}
