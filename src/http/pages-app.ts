/**
 * The library and the recipe page, given addresses for the first time
 * (CFV1-RUN, ADR-0024).
 *
 * Slice 2 rendered both of these nineteen pull requests ago, and until this file
 * existed they were reachable from no HTTP path at all: `renderLibraryPage` and
 * `renderRecipePage` were called by the render barrel and by their own tests and
 * by nothing else. So this module does not expose existing routes. It *creates*
 * them, and three decisions come with them that no earlier unit had to make.
 * They are written here, where a reader meets the route, rather than only in a
 * test.
 *
 * **1. The library is not public, and it does not share the phone's secret.**
 * PDR-0003 says the ingest credential "grants no access to the library beyond
 * submission", and that losing the device "does not expose the library". Wiring
 * these pages to the ingest secret would have been one line shorter and would
 * have made both sentences false. The instance therefore configures two distinct
 * secrets over one mechanism (`instance-credential.ts`), and this app is given
 * the library one. A phone's credential presented here is simply not the
 * configured secret, and is refused like any other wrong guess — which is what
 * `run/the-library-is-not-public` and its companion proof check, by presenting
 * the ingest credential to this app and requiring a miss.
 *
 * **2. There is no 401 anywhere on these pages.** A caller without the library
 * credential gets the same bytes as a caller who asked for a recipe that does
 * not exist, and the same bytes the capability route gives an unknown token —
 * one shared definition in `not-found.ts`, so the three cannot drift. The reason
 * is that the alternative is an enumeration oracle: `401` on a recipe that
 * exists and `404` on one that does not tells anyone who has never held a
 * credential exactly which recipe ids this library holds. ADR-0016 closed that
 * oracle for capability tokens and ADR-0021 extended it to the serving surface;
 * a helpful `401` here would have reopened it from the other side, on the
 * private library rather than on a single shared recipe.
 *
 * **The cost is real and is not hidden:** an operator who forgets their
 * credential is told "Not Found", not "you need a credential". A response that
 * explains itself is a response that confirms the address exists, and no
 * response can be both.
 *
 * **3. A browser cannot send a bearer token by itself.** That is a genuine
 * usability gap and it is registered as an open question rather than solved
 * here: a login, a session and a cookie are all "What NOT" for this unit
 * (`PDR-0002` keeps the instance single-user, and ADR-0011 left the multi-user
 * library open). Today the pages are reachable with a client that sets a header.
 *
 * It is a Hono app and nothing more — `app.fetch` is the whole surface
 * (ADR-0007), so it is exercised in process and binds no socket. It knows
 * nothing of its own origin.
 */
import { Hono } from "hono"
import type { CanonicalRecipe } from "../../schema/index.js"
import type { RecipeRepository } from "../persistence/index.js"
import { renderLibraryPage, renderRecipePage } from "../render/index.js"
import type { InstanceCredential } from "./instance-credential.js"
import { bearerCredential } from "./instance-credential.js"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders } from "./not-found.js"

/** The collaborators these pages compose; both injected (ADR-0004). */
export interface PagesAppDeps {
  /**
   * The LIBRARY credential — not the ingest one. See decision 1 above; handing
   * this the ingest credential is the mistake PDR-0003 forbids, and the reason
   * the two are separate values in `src/server/config.ts`.
   */
  readonly credential: InstanceCredential
  readonly repo: RecipeRepository
}

/**
 * Served with every page.
 *
 * `no-store` because this is the operator's private library and the instance
 * sits behind their own reverse proxy (PDR-0002): a cache between the origin and
 * the reader that kept a library listing would serve it to whoever asked next,
 * credential or not. The capability route says the same thing for the same kind
 * of reason (a revoked token must not outlive its revocation in a cache).
 */
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
} as const

/**
 * A FRESH copy for one response, for the same measured reason `notFoundHeaders`
 * exists: the node adapter writes the content length back into whatever headers
 * record a handler hands `c.body`, so a shared constant is poisoned after its
 * first response. A two-key record happens to dodge it today, because Hono
 * builds a `Headers` object once there is more than one key — which means the
 * bug would come back the day someone removes a header here.
 *
 * **No proof guards this one**, and saying so is the point: reverting it to the
 * shared constant changes nothing measurable today, so a mutation planted here
 * survives honestly. It is a precaution against a future one-key edit, not a
 * checked property, and calling it checked is the defect this repository keeps
 * finding.
 */
const pageHeaders = (): Record<string, string> => ({ ...PAGE_HEADERS })

/**
 * Build the pages app. `GET /` is the library, `GET /recipes/:id` is one recipe.
 * Both require the library credential as a bearer token; every other outcome —
 * no credential, a wrong credential, an unknown recipe id, an unknown path — is
 * the one shared not-found answer.
 */
export function createPagesApp(deps: PagesAppDeps): Hono {
  const app = new Hono()

  // The same three values the capability route uses, imported rather than
  // repeated, so `run/absent-and-forbidden-are-one-answer` compares two
  // responses that cannot drift apart in a later edit.
  //
  // Measured while planting violations: once this app is MOUNTED, Hono answers
  // a miss with the composed app's handler, not this one, so this line is
  // reached only when the pages are served standalone. It is kept for that case
  // and because an app whose misses depend on who mounted it is a trap; the
  // handler the running instance actually uses is in `src/server/instance.ts`,
  // and that is where the mutation has to be planted to mean anything.
  app.notFound((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders()))

  /** True only for a request carrying this instance's library credential. */
  const admitted = (authorization: string | undefined): boolean =>
    deps.credential.accepts(bearerCredential(authorization))

  app.get("/", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    // `listLibrary` returns one row per recipe — id, latest version, and the
    // title if the source gave one — but the card the library renders needs the
    // whole Canonical Recipe (its hero image, its attribution, PDR-0005's title
    // state). So each row is followed by a load.
    //
    // **That is an N+1 read and it is deliberate here, not overlooked.** The
    // alternative is a listing projection, which is a store decision and belongs
    // to CFV1-PG, not to the unit that first gives the page an address. It is
    // registered rather than silently accepted: see the open question this unit
    // filed. Against the provisional in-memory store the cost is not measurable;
    // against a sleeping database it will be, and that is the moment to move it.
    const entries = await deps.repo.listLibrary()
    const loaded = await Promise.all(entries.map((e) => deps.repo.loadLatestCanonical(e.recipeId)))
    // A row whose recipe vanished between the two reads is dropped rather than
    // rendered as a gap: the listing says what the library holds now.
    const recipes: CanonicalRecipe[] = []
    for (const version of loaded) {
      if (version !== undefined) recipes.push(version.recipe)
    }
    return c.body(renderLibraryPage(recipes), 200, pageHeaders())
  })

  app.get("/recipes/:id", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const version = await deps.repo.loadLatestCanonical(c.req.param("id"))
    if (version === undefined) return c.notFound()

    return c.body(renderRecipePage(version.recipe), 200, pageHeaders())
  })

  return app
}
