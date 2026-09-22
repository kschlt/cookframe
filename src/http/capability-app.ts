/**
 * The capability-URL serving route (CFV1-SL3, ADR-0021): the HTTP surface that
 * answers `GET /r/<token>` with a saved recipe's Schema.org/Recipe document, for a
 * third party (Bring) to fetch server-side.
 *
 * This is the unit the token model (ADR-0016) and the Bring mechanism (ADR-0017)
 * were built toward: it composes the capability store, the repository, and the
 * omit-never-invent Schema.org mapping into the one address a holder of a token can
 * reach. It is a Hono app and nothing more — `app.fetch` is the whole surface
 * (ADR-0007), so it is exercised in-process with `app.request(...)` and binds no
 * socket. The server entry point that runs it (with `@hono/node-server`, a port and
 * a public origin) is the hosting concern (OQ-05, ADR-0011) and is deliberately not
 * here: this app knows nothing of its origin, so it serves correctly under any
 * public host without a base URL, domain or port wired in.
 *
 * Two properties are load-bearing and are why the handler is shaped the way it is:
 *
 *  - **Exactly one recipe, and no ambient authority.** A token is resolved to one
 *    recipe id and that recipe alone is served; there is no listing route and no
 *    path from one token to another recipe or token (the store exposes no
 *    enumeration, ADR-0016). Possession of the URL off-device grants nothing beyond
 *    that one recipe — which is also PDR-0001 invariant 11 (the private library is
 *    never made public to satisfy Bring).
 *  - **Every miss answers with the SAME 404.** An unknown token, a revoked token,
 *    and a valid token whose recipe is absent return one byte-identical response:
 *    identical status, body and content-type, routed through one `notFound` handler.
 *    What is equalized is the response bytes, not the work behind them — a persisted
 *    repository would add a timing side-channel, out of this route's scope to close
 *    (see ADR-0021). Three distinguishable answers would be an oracle for someone
 *    trying tokens (ADR-0016 records the revoked-vs-never-issued half; ADR-0021
 *    extends it to the serving surface, including the missing-recipe case). A hit is
 *    the one legitimate distinction — it returns the recipe the holder's token grants.
 *
 * The handler takes no network primitive (the fetch is Bring's, of this address),
 * so this module sits outside `src/security/`, and declares no contract shape (the
 * contract lives only in `schema/`). The served body is the deterministic mapping's
 * output verbatim (stable field order), as `application/ld+json`.
 */

import { Hono } from "hono"
import type { RecipeRepository } from "../persistence/index.js"
import { type CapabilityStore, isPathSafeToken } from "../shopping/capability-token.js"
import { mapCanonicalToSchemaOrg } from "../shopping/schema-org-mapping.js"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders } from "./not-found.js"

/** The collaborators the serving route composes; both injected (ADR-0004). */
export interface CapabilityAppDeps {
  /** Resolves a capability token to its one recipe id, or `undefined`. */
  readonly store: CapabilityStore
  /** Loads the latest Canonical version for a recipe id, or `undefined` (ADR-0018). */
  readonly repo: RecipeRepository
}

/**
 * Build the capability-URL serving app. `GET /r/:token` serves the token's recipe
 * as Schema.org/Recipe JSON-LD; every other outcome — an unsafe or unknown token, a
 * revoked token, a token whose recipe is absent, or any other path — is the same
 * 404. The app is origin-agnostic: it reads only the request path.
 */
export function createCapabilityApp(deps: CapabilityAppDeps): Hono {
  const app = new Hono()

  // One not-found response, used for every miss (routing and handler alike), so an
  // unknown token, a revoked token and a missing recipe cannot be told apart.
  // The three values come from `not-found.ts` rather than from here, because
  // the pages CFV1-RUN added must answer an uncredentialed caller with exactly
  // these bytes. Two copies would be two things that can drift apart.
  //
  // A FRESH headers object per response, never the shared constant: the node
  // adapter writes the content length back into whatever record it is handed,
  // which turns the second miss the process serves into a 500. The reason is
  // written out in `not-found.ts`.
  app.notFound((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders()))

  app.get("/r/:token", async (c) => {
    const token = c.req.param("token")
    // A token that is not path-safe cannot be one this app minted, so it is a miss
    // like any other — never a distinct error that would confirm the guess's shape.
    if (!isPathSafeToken(token)) return c.notFound()

    const recipeId = await deps.store.resolve(token)
    if (recipeId === undefined) return c.notFound()

    const version = await deps.repo.loadLatestCanonical(recipeId)
    if (version === undefined) return c.notFound()

    const mapped = mapCanonicalToSchemaOrg(version.recipe)
    // `no-store` so no cache between the origin and the reader (browser, proxy,
    // CDN) can keep serving this recipe after its token is revoked. Revocation is
    // the grant's only end (ADR-0016) and the URL is designed to leave the device,
    // so a heuristically-cached 200 would be a kill switch a cache outlives.
    return c.body(JSON.stringify(mapped.recipe), 200, {
      "content-type": "application/ld+json",
      "cache-control": "no-store",
    })
  })

  return app
}
