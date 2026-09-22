/**
 * The credentialed pages app, as the slice-6 proofs build it.
 *
 * The cooking page used to live in an app of its own with no credential on it,
 * and these proofs called that app directly. It is now one of the library's
 * pages (`ADR-0024`, and the fourth decision in `src/http/pages-app.ts`), so
 * every request here carries the library credential — which is also what the
 * running instance requires, and the gap between the two is what let a route
 * pass every proof while no instance served it.
 *
 * The credential is assembled rather than written down, for the reason
 * `tests/run/harness.ts` gives: a credential-shaped literal in a public
 * repository is one `secret-scan` cannot tell from a real secret.
 */
import type { Hono } from "hono"
import { createInstanceCredential } from "../../src/http/instance-credential.js"
import { createPagesApp, type PagesAppDeps } from "../../src/http/pages-app.js"

/** Long enough for `createInstanceCredential` (32), and obviously not a secret. */
export const PAGES_CREDENTIAL = `library-${"not-a-secret-".repeat(3)}`

/** The pages app under this suite's credential. */
export const pagesApp = (deps: Omit<PagesAppDeps, "credential">): Hono =>
  createPagesApp({
    ...deps,
    credential: createInstanceCredential(PAGES_CREDENTIAL, "library credential"),
  })

/** The bearer header every page request carries. */
export const pagesAuth = (): Record<string, string> => ({
  authorization: `Bearer ${PAGES_CREDENTIAL}`,
})

/** One in-process GET against the pages app, credential attached. */
export const getPage = async (app: Hono, path: string): Promise<Response> =>
  await app.request(path, { headers: pagesAuth() })
