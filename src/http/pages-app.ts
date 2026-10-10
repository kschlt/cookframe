/**
 * The library, the recipe page and the cooking page — every page of the
 * operator's private library, behind one credential (CFV1-RUN, ADR-0024).
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
 * **4. The cooking page is one of these pages, not a surface of its own.**
 * CFV1-SL6 built `GET /recipes/:id/cook` in a separate app, and the composition
 * root never mounted it: a running instance answered the library and the recipe
 * with `200` and the cook address with `404`, for a whole pull request, while
 * every proof of the route passed. Both apps also declared `GET /recipes/:id`,
 * so mounting the second one beside this app would have added a route that can
 * never be reached, and it sent no `cache-control`, so the cook page of a
 * private library would have been the one cacheable page on the instance. The
 * route lives here instead, under the same credential, the same miss and the
 * same headers as the pages it belongs with, and `src/http/cooking-app.ts` is
 * gone rather than left as a second door nobody walks through.
 *
 * **5. Handing a recipe to Bring is one of these addresses too, and it is not a
 * page.** CFV1-SHOP found the shopping half of ADR-0016 built and unreachable:
 * `CapabilityStore.issue` and `CapabilityStore.revoke` had no caller anywhere in
 * `src/`, so a running instance could serve a capability URL and had no way to
 * mint one or take one back. The two addresses that close that live HERE rather
 * than in an app of their own, and the reason is decision 2 above: a miss on them
 * has to be the SAME bytes as a miss on a page, and the credential has to be the
 * SAME object. A second app would have meant a second `admitted` and a second
 * `notFound`, which is two things that can drift apart — and the layer already
 * paid for that once, in the cooking app decision 4 describes.
 *
 * They answer JSON, not HTML, because they are submissions rather than pages and
 * the instance's other submission (`POST /capture`) answers JSON. `no-store` on
 * them for a sharper reason than the pages have: the response CARRIES the
 * capability secret.
 *
 * The one thing decision 5 needed that no page did is an absolute address to
 * hand out, and this app still does not know its own: it is given a function
 * that builds one (`capabilityUrlFor`), so the address stays where ADR-0026's
 * third cut puts it — in configuration, read by the composition root.
 *
 * It is a Hono app and nothing more — `app.fetch` is the whole surface
 * (ADR-0007), so it is exercised in process and binds no socket. It knows
 * nothing of its own origin.
 */
import { Hono } from "hono"
import type { CanonicalRecipe } from "../../schema/index.js"
import { deriveCookingPlan } from "../cooking/index.js"
import { servedImageType } from "../media/image-signature.js"
import type { RecipeRepository } from "../persistence/index.js"
import {
  type PictureSource,
  renderCookingPage,
  renderLibraryPage,
  renderRecipePage,
} from "../render/index.js"
import { bringImportUrl } from "../shopping/bring-handoff.js"
import { type CapabilityStore, isPathSafeToken } from "../shopping/capability-token.js"
import { type ByteStore, recordedIdentity } from "../storage/index.js"
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
  /**
   * Mints and revokes the capability grants the Bring handoff is made of
   * (ADR-0016). The SAME object the capability route resolves against — a second
   * store here would mint tokens the serving route has never heard of.
   */
  readonly capabilityStore: CapabilityStore
  /**
   * The absolute URL a token is served at. A FUNCTION from the composition root,
   * not the base URL itself, and that is ADR-0026's third cut kept rather than
   * worked around: "no app learns its host, port or base URL", and the capability
   * URL's origin comes from `PUBLIC_BASE_URL`. Both hold only if the URL is built
   * outside the app — so this app never holds an address, it asks for one.
   */
  readonly capabilityUrlFor: (token: string) => string
  /**
   * Where a recipe's picture of the dish is kept: the byte store on the volume
   * (ADR-0009 keeps retained scans and hero media behind one interface). The
   * picture route reads it by the identity the recipe's own Canonical Recipe
   * names, and by no other.
   */
  readonly mediaStore: ByteStore
  /**
   * Told when the cooking page could not show a plan and served the recipe page
   * instead. Optional, and observation only — nothing about the response depends
   * on it, so an instance that wires nothing here behaves identically.
   */
  readonly onDegraded?: (recipeId: string, reason: unknown) => void
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
 * exists: up to `@hono/node-server` 2.1.1 the node adapter wrote the content
 * length back into whatever headers record a handler handed `c.body`, so a
 * shared constant was poisoned after its first response. A two-key record
 * dodged it even then, because Hono builds a `Headers` object once there is
 * more than one key. 2.1.2 removed the write-back altogether (#402, taken here
 * in #122), so neither hazard is live right now — but a shared mutable record
 * handed across responses is the thing the structural guard forbids on sight,
 * and the adapter could regain the mutation in any release. The copy stays for
 * that reason, not for a symptom; the tripwire that reports a return of the
 * write-back is `tests/run/served-headers-survive-repetition.test.ts`.
 *
 * **No proof guards this one**, and saying so is the point: reverting it to the
 * shared constant changes nothing measurable today, so a mutation planted here
 * survives honestly. It is a precaution against a future one-key edit, not a
 * checked property, and calling it checked is the defect this repository keeps
 * finding.
 */
const pageHeaders = (): Record<string, string> => ({ ...PAGE_HEADERS })

/**
 * Served with both handoff answers.
 *
 * `no-store` is not the pages' reason repeated. A share response contains the
 * capability token itself, in clear, and a token is permanent until it is revoked
 * (ADR-0016) — so a cache that kept this response would be holding a working
 * credential for whoever it serves next. A fresh object per response, for the
 * measured reason `notFoundHeaders` exists.
 */
/**
 * Served with a picture of the dish, built per response for the measured reason
 * `notFoundHeaders` exists.
 *
 * The content type is the one {@link servedImageType} read from the bytes, never
 * a stored or claimed label, and `nosniff` tells the browser to take it at its
 * word rather than guess past it. `no-store` for the pages' reason: the picture
 * is part of the operator's private library.
 */
const pictureHeaders = (contentType: string): Record<string, string> => ({
  "content-type": contentType,
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
})

/** Where a recipe's picture of the dish is served: by the recipe, never by the bytes' identity. */
export const pictureHref = (recipeId: string): string =>
  `/recipes/${encodeURIComponent(recipeId)}/picture`

/** How every page this app renders names a picture: by its recipe's picture route. */
const servedPicture = { mediaSrc: (_identity: string, recipeId: string) => pictureHref(recipeId) }

const handoffHeaders = (): Record<string, string> => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
})

/**
 * Build the pages app. `GET /` is the library, `GET /recipes/:id` is one recipe,
 * `GET /recipes/:id/picture` is its picture of the dish, and
 * `GET /recipes/:id/cook` is the plan derived from it. All of them require the
 * library credential as a bearer token; every other outcome — no credential, a
 * wrong credential, an unknown recipe id, an unknown path — is the one shared
 * not-found answer.
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

  /**
   * What this recipe's Source Snapshot says about it, for the one sentence the
   * page says when there is no picture of the dish.
   *
   * Reading it must never cost the page: the recipe is authoritative and this is
   * a footnote to it. A store does more than answer `undefined` here — the
   * Postgres store validates the row on the way out and THROWS for a snapshot
   * that no longer satisfies the contract, on purpose — so a failed read is
   * caught, and the recipe page and the page the cooking address degrades to
   * stay readable. Measured in review: without this both answered 500.
   *
   * And a read that failed, or found nothing, is `unread`, never "not a
   * photograph": the page then says its source could not be read, instead of
   * saying "none was kept" about a recipe whose photograph the instance holds.
   * Nothing else observes the failure; the stated gap on the page is its trace.
   */
  const pictureSourceOf = async (recipe: CanonicalRecipe): Promise<PictureSource> => {
    try {
      const snapshot = await deps.repo.loadSnapshot(recipe.provenance.sourceSnapshotId)
      if (snapshot === undefined) return "unread"
      return snapshot.sourceType === "image" ? "photographed_page" : "not_photographed"
    } catch {
      return "unread"
    }
  }

  /**
   * The recipe page as this instance serves it, wherever it is served from: its
   * own address, and the cooking address when that degrades to it.
   */
  const recipePage = async (recipe: CanonicalRecipe): Promise<string> =>
    renderRecipePage(recipe, { ...servedPicture, pictureSource: await pictureSourceOf(recipe) })

  app.get("/", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    // `listLibrary` returns one row per recipe — id, latest version, and the
    // title if the source gave one — but the card the library renders needs the
    // whole Canonical Recipe (its hero image, its attribution, PDR-0005's title
    // state). So each row is followed by a load.
    //
    // **That is an N+1 read and it is deliberate here, not overlooked.** The
    // alternative is a listing projection, which is a store decision and belongs
    // to the store, not to the unit that first gives the page an address. It is
    // registered rather than silently accepted: see the open question this unit
    // filed (OQ-43). Since CFV1-WIRE these reads go to PostgreSQL, so the cost is
    // now real rather than hypothetical — one round trip per recipe, measured
    // against OQ-25a's unanswered threshold before anyone moves it.
    const entries = await deps.repo.listLibrary()
    const loaded = await Promise.all(entries.map((e) => deps.repo.loadLatestCanonical(e.recipeId)))
    // A row whose recipe vanished between the two reads is dropped rather than
    // rendered as a gap: the listing says what the library holds now.
    const recipes: CanonicalRecipe[] = []
    for (const version of loaded) {
      if (version !== undefined) recipes.push(version.recipe)
    }
    return c.body(renderLibraryPage(recipes, servedPicture), 200, pageHeaders())
  })

  app.get("/recipes/:id", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const version = await deps.repo.loadLatestCanonical(c.req.param("id"))
    if (version === undefined) return c.notFound()

    return c.body(await recipePage(version.recipe), 200, pageHeaders())
  })

  /**
   * A recipe's picture of the dish.
   *
   * **By the recipe, not by the bytes.** The identity read is the one the
   * recipe's latest Canonical Recipe names, so this address can serve that
   * picture and nothing else the store holds — the kept photographs above all,
   * which a route taking an identity from the request would hand to anyone
   * holding the library credential. Held by
   * `picture/the-address-is-the-librarys`, which names another image's identity
   * in the request and requires the recipe's own bytes back; before that proof,
   * a route reading `?identity=` passed every other one.
   *
   * **The type comes from the bytes.** The picture was somebody else's to begin
   * with, and a stored file carries no label; bytes that are not one of the
   * three formats {@link servedImageType} recognises are never served, under any
   * type. That answer is the shared miss, like every other "nothing to show
   * you" on this layer.
   */
  app.get("/recipes/:id/picture", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const version = await deps.repo.loadLatestCanonical(c.req.param("id"))
    const hero = version?.recipe.media?.heroImage
    if (hero === undefined) return c.notFound()

    // The contract holds the identity as a plain string; the store mints the
    // brand and resolves an identity it could not have issued to nothing.
    const bytes = await deps.mediaStore.get(recordedIdentity(hero.storageIdentity))
    if (bytes === undefined) return c.notFound()
    const contentType = servedImageType(bytes)
    if (contentType === undefined) return c.notFound()

    // A copy, because a response body has to own a plain ArrayBuffer.
    return c.body(new Uint8Array(bytes), 200, pictureHeaders(contentType))
  })

  /**
   * The cooking page (CFV1-SL6).
   *
   * **Degradation is to the recipe page, never to nothing.** Under `PDR-0004`'s
   * `lazy` default that is not an error path but the ordinary state of every
   * recipe nobody has cooked yet, so the cook address answers with a cooking
   * view when it can and with the Slice 2 recipe page when it cannot. The only
   * 404 is a recipe this instance does not hold — or a caller without the
   * credential, which is the same answer for the reason decision 2 gives.
   *
   *  - **No stored plan** — derive one now and serve it. Deriving costs nothing
   *    (`ADR-0023`: a pure function, no model call), which is what makes `lazy`
   *    cheap enough to be the default.
   *  - **Derivation fails** — serve the recipe page. A plan whose provenance has
   *    a hole is refused at the source (`UntraceablePlanFactError`), and the cook
   *    gets the recipe rather than an error: the Canonical Recipe is
   *    authoritative and the plan is the replaceable layer, so losing the plan
   *    must never take the recipe with it.
   *  - **Rendering fails** — the same. A page that half-rendered is not
   *    something to hand a person standing over a pan.
   *
   * It derives rather than storing what it derived. Writing on a GET would make
   * a read path a write path, and `PDR-0004` already names the two moments a
   * plan is generated: `lazy`, which is this derivation, and `background`, which
   * is the import's (`ADR-0008`). A caching write here would be a third, decided
   * in passing.
   */
  app.get("/recipes/:id/cook", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const recipeId = c.req.param("id")
    const version = await deps.repo.loadLatestCanonical(recipeId)
    if (version === undefined) return c.notFound()

    // Keyed by version, so a recipe re-normalized since the plan was stored gets
    // a fresh derivation rather than the previous version's plan.
    const stored = await deps.repo.loadCookingPlan(recipeId, version.version)

    try {
      const plan =
        stored ?? deriveCookingPlan(version.recipe, { canonicalVersion: version.version })
      return c.body(renderCookingPage(plan), 200, pageHeaders())
    } catch (error) {
      // The recipe is authoritative and the plan is derived; whatever went wrong
      // with the plan, the recipe is still readable, so that is what is served.
      deps.onDegraded?.(recipeId, error)
      return c.body(await recipePage(version.recipe), 200, pageHeaders())
    }
  })

  /**
   * Mint a capability URL for one recipe — the Bring handoff (ADR-0016, ADR-0017).
   *
   * **A POST, and that is the decision this route makes.** Minting creates a
   * permanent bearer credential for a recipe, so a GET that did it would mean
   * every crawl, prefetch or reload of the address issued another live token for
   * the same recipe and nobody could say how many exist — the store deliberately
   * offers no enumeration to count them with. It is the same rule the cooking
   * page above keeps by deriving rather than writing, applied where the write is
   * a secret.
   *
   * **A recipe this instance does not hold is the same 404 as a wrong
   * credential**, per decision 2: minting first and checking after would answer a
   * caller with a token, which is a yes/no on whether a recipe id exists.
   *
   * Each call mints a NEW token rather than returning an existing one. That is
   * ADR-0016's model, not a shortcut: the store maps a token to a recipe and
   * never the other way, because the reverse index is the enumeration the record
   * refuses. Two tokens for one recipe both work, and each is revoked on its own.
   */
  app.post("/recipes/:id/share", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const recipeId = c.req.param("id")
    const version = await deps.repo.loadLatestCanonical(recipeId)
    if (version === undefined) return c.notFound()

    const grant = await deps.capabilityStore.issue(recipeId)
    const url = deps.capabilityUrlFor(grant.token)
    // Both links, because they are two different acts: `url` is the address to
    // revoke or to hand somewhere else, `bringImport` is the one that starts an
    // import. Building the second one from the first is Bring's documented
    // shape (ADR-0017) and not something the operator should have to remember.
    return c.body(
      JSON.stringify({ recipeId, token: grant.token, url, bringImport: bringImportUrl(url) }),
      200,
      handoffHeaders(),
    )
  })

  /**
   * Revoke a capability URL — the token's only end (ADR-0016).
   *
   * It takes the TOKEN rather than a recipe id, because that is the only handle
   * that exists: a grant is reachable from its token and from nothing else, and
   * a route that revoked "this recipe's tokens" would need the reverse index
   * ADR-0016 refuses to keep.
   *
   * The `revoked` field says whether an ACTIVE grant was ended, so revoking
   * twice answers `true` then `false`. Telling those apart is information about
   * the store, and the caller who gets it has already presented the library
   * credential — the indistinguishability ADR-0016 requires is owed to a HOLDER
   * of a token, which is the serving route's side, not this one's.
   */
  app.post("/shares/:token/revoke", async (c) => {
    if (!admitted(c.req.header("authorization"))) return c.notFound()

    const token = c.req.param("token")
    // A token that is not path-safe cannot be one this instance minted. The
    // store would answer `false` for it anyway; refusing it here keeps this
    // route's reading of a token identical to the serving route's.
    if (!isPathSafeToken(token)) return c.notFound()

    return c.body(
      JSON.stringify({ revoked: await deps.capabilityStore.revoke(token) }),
      200,
      handoffHeaders(),
    )
  })

  return app
}
