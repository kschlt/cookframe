/**
 * The entry point: the one file in this repository that binds a socket
 * (CFV1-RUN, ADR-0007).
 *
 * Nineteen pull requests landed before this file existed, and there was no way
 * to start Cookframe. That was not an oversight — ADR-0007 fixed Hono as the
 * framework and `app.fetch` as the whole HTTP surface precisely so that every
 * route could be exercised in process, and it named the adapter as "an
 * implementation detail of the entry point". This is that entry point, and the
 * containment is the point of it:
 *
 *  - `@hono/node-server` is imported **here and nowhere else**, and no module
 *    outside `src/server/` names a socket, a `node:http` type, `listen` or
 *    `createServer`. `run/only-the-entry-point-binds` reads the tree and fails
 *    if a second file does, because the day one does is the day moving to a
 *    different runtime stops being a change to one file.
 *  - Everything above stays framework-shaped and testable without a port. The
 *    three apps this composes are the same objects their own suites exercise
 *    with `app.request(...)`.
 *
 * **Composition, and why it is separate from `main.ts`.** This module takes its
 * collaborators as arguments and constructs none of them: no provider, no store,
 * no credential, no environment read. `main.ts` is the process — it reads the
 * configuration once, builds the real providers and the real store, and calls
 * {@link startInstance}. Keeping the two apart is what lets a proof start a real
 * server, on a real port, against a repository it can see into, without an API
 * key and without a model call.
 *
 * **Stopping.** ADR-0008 forbids a queue, a broker and a worker, so there is no
 * background process to drain and the instance holds no work that exists only in
 * memory. What {@link RunningInstance.stop} does is therefore small and exactly
 * stated: stop accepting connections, let the requests already in flight finish,
 * release idle keep-alive sockets that would otherwise hold the process open,
 * and then close the store. The operating model this has to tolerate is a
 * process started on a request and stopped again when idle, so a stop that cut a
 * request off halfway would leave a snapshot stored with no recipe against it —
 * `run/a-stop-leaves-nothing-half-written` stops an instance mid-request and
 * requires the record to be whole.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { createCapabilityApp } from "../http/capability-app.js"
import { createIngestApp, type IngestAppDeps } from "../http/ingest-app.js"
import type { InstanceCredential } from "../http/instance-credential.js"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders } from "../http/not-found.js"
import { createPagesApp } from "../http/pages-app.js"
import type { RecipeRepository } from "../persistence/index.js"
import type { CapabilityStore } from "../shopping/capability-token.js"

/**
 * Everything the composed instance runs on. Every collaborator is injected
 * (ADR-0004); this module constructs none of them.
 */
export interface InstanceDeps {
  /**
   * The ONE repository. The import path, the capability path and the pages all
   * read through this object — `run/one-store-per-process` proves it by writing
   * through the first and reading the result out of the other two, which a
   * second store anywhere in the process would make impossible.
   */
  readonly repo: RecipeRepository
  readonly capabilityStore: CapabilityStore
  /** The secret the Shortcut submits with (PDR-0003). */
  readonly ingestCredential: InstanceCredential
  /** The secret that opens the library. A different value; see `pages-app.ts`. */
  readonly libraryCredential: InstanceCredential
  readonly capture: IngestAppDeps["capture"]
  readonly normalization: IngestAppDeps["normalization"]
  readonly policy: IngestAppDeps["policy"]
  readonly identity: IngestAppDeps["identity"]
  readonly targetOntologyVersion: string
  readonly sourceAdapter: string
  readonly adapterVersion: string
  /**
   * Released after the last in-flight request, when the instance stops. The
   * store's own teardown (CFV1-PG hands one back from its factory); absent for a
   * store that holds nothing to release.
   */
  readonly closeStore?: () => Promise<void>
}

/**
 * Compose the three apps into the one surface the process serves.
 *
 * Binds nothing: this is a Hono app like the three it mounts, so the composition
 * itself — which addresses exist, and that a miss on any of them is one answer —
 * is provable with `app.request(...)`.
 */
export function composeInstance(deps: InstanceDeps): Hono {
  const app = new Hono()

  // One not-found answer for the composed surface, from the same definition the
  // capability route and the pages use. An unknown path, an unknown token, a
  // recipe that does not exist and a library request with no credential are
  // byte-identical, which is what keeps a caller who holds nothing from learning
  // which recipe ids exist (ADR-0016, ADR-0021, ADR-0024).
  app.notFound((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders()))

  app.route(
    "/",
    createIngestApp({
      credential: deps.ingestCredential,
      repo: deps.repo,
      capture: deps.capture,
      normalization: deps.normalization,
      policy: deps.policy,
      identity: deps.identity,
      targetOntologyVersion: deps.targetOntologyVersion,
      sourceAdapter: deps.sourceAdapter,
      adapterVersion: deps.adapterVersion,
    }),
  )
  app.route("/", createCapabilityApp({ store: deps.capabilityStore, repo: deps.repo }))
  app.route("/", createPagesApp({ credential: deps.libraryCredential, repo: deps.repo }))

  return app
}

/** A bound instance, and the one way to stop it. */
export interface RunningInstance {
  /** The port actually bound — the requested one, or the assigned one for `0`. */
  readonly port: number
  /**
   * Stop accepting, let in-flight requests finish, then close the store.
   * Resolves when the socket is closed. Calling it twice is safe.
   */
  stop(): Promise<void>
}

/**
 * Bind a port and serve the composed instance.
 *
 * `port: 0` asks the operating system for a free one and the assigned port comes
 * back on {@link RunningInstance.port} — which is how the proofs run several
 * instances at once without choosing numbers that collide.
 */
export function startInstance(deps: InstanceDeps, port: number): Promise<RunningInstance> {
  const app = composeInstance(deps)

  return new Promise<RunningInstance>((resolve, reject) => {
    let server: ReturnType<typeof serve>
    try {
      server = serve({ fetch: app.fetch, port }, (info) => {
        resolve({ port: info.port, stop: () => stopServer(server, deps.closeStore) })
      })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    // A port already in use arrives as an event, not a throw.
    server.on("error", reject)
  })
}

/** Stop accepting, drain, then release the store. */
async function stopServer(
  server: ReturnType<typeof serve>,
  closeStore: (() => Promise<void>) | undefined,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // `close` stops new connections and calls back once the last in-flight
    // request has been answered. On its own that can wait forever: a browser's
    // idle keep-alive socket is an open connection with no request on it, and
    // the callback does not fire while one is held. Releasing the IDLE ones —
    // never the busy ones — is what makes a stop both prompt and complete.
    server.close((error) => (error ? reject(error) : resolve()))
    // Guarded rather than asserted: the adapter's server type is a union that
    // includes an HTTP/2 server, which has no such method. A cast would compile
    // and throw at the one moment this code exists for.
    if ("closeIdleConnections" in server) server.closeIdleConnections()
  })
  await closeStore?.()
}
